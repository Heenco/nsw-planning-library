"""Build the EPI PMTiles archives behind /epi.

Reads the whole `epi` schema on planningai - every planning-instrument map layer the GEODAAS load writes -
and produces, into OUT_DIR, one archive per group plus a combined index:

  epi-<group>-<stamp>.pmtiles   one MVT layer "epi", zoom 4-14 (tippecanoe)
  epi-<group>.json              that group's manifest: which archive is current, and its layer catalogue
  epi-layers.json              the index the app reads: every layer, which group and archive holds it

Runs in the sedona container on the planningai host (tippecanoe, psycopg2). DATABASE_URL comes from the
environment or the first line of stdin. Publish everything to /var/www/static/pmtiles/ on the host, the
index last. Re-run after every EPI load, because 01A replaces the schema wholesale.

WHY GROUPS

The schema is 4 GB of geometry. Tiled in one pass the intermediate GeoJSONL alone would be ~12 GB, on a
host that has ~45 GB free, and a failure anywhere would cost the whole run. So it is built in six groups,
smallest first, and each group's GeoJSONL is deleted as soon as its archive exists - peak disk is one
group, not the schema. The index is rewritten after every group, so a run that stops half way still leaves
a usable site: the groups that finished are on the map and the rest are simply absent.

GROUP_OF below assigns each table. A table that is not listed falls into `development`, so a layer added by
a future EPI load is still tiled without editing this file.

EACH FEATURE carries layer_key (the table name), category (what the page colours by), name and detail. A
table with more than HEAVY_VERTICES vertices is drawn from HEAVY_MIN_ZOOM, so the low-zoom tiles of all NSW
are not spent on the biodiversity and land-application polygons.

The click answer on /epi does NOT come from these tiles - it is a PostGIS point query across all 56 tables,
which takes about 200 ms and is exact. The tiles are only for drawing.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2

OUT_DIR = os.environ.get("EPI_OUT_DIR", "/opt/workspace/epi_pmtiles/out")
MIN_ZOOM, MAX_ZOOM = 4, 14
HEAVY_VERTICES = 20_000_000
HEAVY_MIN_ZOOM = 9
ONLY = {g.strip() for g in os.environ.get("EPI_ONLY", "").split(",") if g.strip()}

# Smallest first: a broken run still leaves most of the map working, and the two monsters come last.
GROUP_ORDER = ["hazard", "resources", "principal", "development", "biodiversity", "application"]

GROUP_OF = {
    # the standard LEP maps a planner opens first
    "epi_land_zoning": "principal", "epi_lot_size": "principal",
    "epi_height_of_building": "principal", "epi_floor_space_ratio": "principal",
    "epi_land_reservation_acquisition": "principal", "epi_land_reclassification": "principal",
    "epi_dwelling_density": "principal", "epi_gross_floor_area": "principal",
    "epi_reduced_level": "principal",
    # what each instrument applies to - one enormous table
    "epi_land_application": "application",
    # protection: living things
    "epi_terrestrial_biodiversity": "biodiversity", "epi_riparian_lands_watercourses": "biodiversity",
    "epi_wetlands": "biodiversity", "epi_native_veg_protection": "biodiversity",
    "epi_environmental_cons_area": "biodiversity", "epi_critical_habitat": "biodiversity",
    "epi_wetlands_protection_area": "biodiversity", "epi_environmentally_sensitive_land": "biodiversity",
    "epi_special_areas": "biodiversity", "epi_scenic_protection": "biodiversity",
    # protection: land, soil and water
    "epi_acid_sulfate_soils": "resources", "epi_csg_exclusions": "resources",
    "epi_salinity": "resources", "epi_groundwater_vulnerability": "resources",
    "epi_strategic_agricultural_land": "resources", "epi_drinking_water_catchments": "resources",
    "epi_water_zoning": "resources", "epi_mineral_and_extractive": "resources",
    "epi_referral_area": "resources",
    # hazards
    "epi_flood": "hazard", "epi_landslide_risk": "hazard", "epi_geotechnical": "hazard",
    "epi_noise_exposure_forecast": "hazard", "epi_obstacle_limitation_surface": "hazard",
    "epi_foreshore_building_line": "hazard",
    # everything else is a development control or a site-specific provision
}
DEFAULT_GROUP = "development"

GROUP_LABEL = {
    "principal": "Principal planning",
    "application": "Land application",
    "biodiversity": "Biodiversity and protection",
    "resources": "Land, soil and water",
    "hazard": "Hazard",
    "development": "Development controls and local provisions",
}

# The epi tables share one schema, so the display columns are resolved generically; only the few whose
# best category is not lay_class are named here.
CATEGORY_OVERRIDE = {
    "epi_land_zoning": "sym_code",
    "epi_heritage": "lay_class",
    "epi_map_tiles": "map_type",
}
EXTRACT = {"POINT": 1, "LINESTRING": 2, "POLYGON": 3}


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def build_sql(table, columns):
    """(category, name, detail) SQL over whichever of the standard epi columns this table has."""
    have = {c.lower() for c in columns}
    first = lambda *names: next((n for n in names if n in have), None)

    cat = CATEGORY_OVERRIDE.get(table)
    if cat not in have:
        cat = first("lay_class", "sym_code", "lay_name", "map_type")
    name = first("label", "lay_class", "lay_name", "h_name")
    detail_cols = [c for c in ("epi_name", "lga_name", "lay_name", "legis_ref_clause") if c in have][:3]

    cat_sql = f'nullif(btrim(("{cat}")::text), \'\')' if cat else "NULL::text"
    name_sql = f'nullif(btrim(("{name}")::text), \'\')' if name else "NULL::text"
    detail_sql = ("concat_ws(' · ', "
                  + ", ".join(f'nullif(btrim(("{c}")::text), \'\')' for c in detail_cols) + ")"
                  ) if detail_cols else "NULL::text"
    # counted while the rows stream past, so the catalogue costs no extra pass over the table
    plan_sql = 'nullif(btrim(("epi_name")::text), \'\')' if "epi_name" in have else "NULL::text"
    map_sql = 'nullif(btrim(("map_name")::text), \'\')' if "map_name" in have else "NULL::text"
    return cat_sql, name_sql, detail_sql, plan_sql, map_sql


def catalogue(cur):
    """Every table of the epi schema with geometry, in build order."""
    cur.execute("""
        SELECT c.relname, g.f_geometry_column, upper(g.type), g.srid,
               obj_description(c.oid, 'pg_class'),
               pg_total_relation_size(c.oid)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN geometry_columns g ON g.f_table_schema = 'epi' AND g.f_table_name = c.relname
        WHERE n.nspname = 'epi' AND c.relkind = 'r'
        ORDER BY c.relname""")
    rows = []
    for name, gcol, gtype, srid, comment, size in cur.fetchall():
        rows.append({"table": name, "geom_column": gcol, "geom_type": gtype, "srid": srid,
                     "comment": comment, "bytes": int(size),
                     "group": GROUP_OF.get(name, DEFAULT_GROUP)})
    return rows


def export_group(conn, cur, group, tables, geojson_path):
    """Stream every table of one group into a single GeoJSONL. Returns (layers, features)."""
    layers, total = [], 0
    with open(geojson_path, "w", encoding="utf-8") as out:
        for spec in tables:
            table, gcol, srid = spec["table"], spec["geom_column"], spec["srid"]
            cur.execute("""SELECT column_name FROM information_schema.columns
                           WHERE table_schema = 'epi' AND table_name = %s""", (table,))
            columns = [r[0] for r in cur.fetchall()]
            cat_sql, name_sql, detail_sql, plan_sql, map_sql = build_sql(table, columns)

            cur.execute(f'SELECT count(*), sum(ST_NPoints("{gcol}")), min(ST_GeometryType("{gcol}")) FROM epi."{table}"')
            n_rows, vertices, sample_type = cur.fetchone()
            entry = {"key": table, "group": group, "table": f"epi.{table}", "rows": int(n_rows or 0),
                     "vertices": int(vertices or 0), "features": 0, "minZoom": 0, "bbox": None,
                     "geometry": None, "categories": [], "plans": 0, "maps": [],
                     "comment": spec["comment"]}
            if not n_rows:
                log(f"  {table}: empty, skipped")
                layers.append(entry)
                continue
            kind = next((k for k in EXTRACT if k in (sample_type or "").upper()), "POLYGON")
            min_zoom = HEAVY_MIN_ZOOM if (vertices or 0) > HEAVY_VERTICES else 0

            stream = conn.cursor(name=f"s_{group}_{table}"[:60])
            stream.itersize = 500
            geom = (f'ST_Force2D("{gcol}")' if srid in (4283, 4326)
                    else f'ST_Transform(ST_Force2D("{gcol}"), 4283)')
            stream.execute(f"""
                SELECT ({cat_sql}), ({name_sql}), ({detail_sql}), ({plan_sql}), ({map_sql}),
                       ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g),
                       ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(ST_MakeValid(g), {EXTRACT[kind]}), 4326), 6)
                FROM (SELECT *, ST_SetSRID({geom}, CASE WHEN {srid} = 4326 THEN 4326 ELSE 4283 END) AS g
                      FROM epi."{table}") s
                WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)""")
            count, cats, bbox = 0, {}, [180.0, 90.0, -180.0, -90.0]
            plans, maps = set(), {}
            t1 = time.time()
            for category, nm, detail, plan, map_name, w, s, e, nth, gj in stream:
                if not gj or '"coordinates":[]' in gj:
                    continue
                if plan:
                    plans.add(plan)
                if map_name:
                    maps[map_name] = maps.get(map_name, 0) + 1
                feature = {"type": "Feature",
                           "properties": {"layer_key": table, "category": category,
                                          "name": nm, "detail": detail},
                           "geometry": json.loads(gj)}
                if min_zoom:
                    feature["tippecanoe"] = {"minzoom": min_zoom}
                out.write(json.dumps(feature, separators=(",", ":")) + "\n")
                count += 1
                if category is not None:
                    cats[category] = cats.get(category, 0) + 1
                bbox = [min(bbox[0], w), min(bbox[1], s), max(bbox[2], e), max(bbox[3], nth)]
            stream.close()
            total += count
            entry.update({"features": count, "minZoom": min_zoom, "bbox": bbox if count else None,
                          "geometry": kind.lower(), "plans": len(plans),
                          "maps": [{"name": m, "features": f}
                                   for m, f in sorted(maps.items(), key=lambda x: -x[1])[:6]],
                          "categories": [{"name": c, "features": f}
                                         for c, f in sorted(cats.items(), key=lambda x: -x[1])[:60]]})
            layers.append(entry)
            log(f"  {table}: {count:,} {kind.lower()} features, {int(vertices or 0):,} vertices, "
                f"{len(plans)} plans, minzoom {min_zoom}, {time.time() - t1:.0f} s")
    return layers, total


def write_index():
    """Rebuild epi-layers.json from whatever group manifests exist, so a partial run still serves."""
    groups, layers = {}, []
    for group in GROUP_ORDER:
        path = os.path.join(OUT_DIR, f"epi-{group}.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
        groups[group] = {"label": GROUP_LABEL.get(group, group), "archive": m["archive"],
                         "builtAt": m["builtAt"], "minZoom": m["minZoom"], "maxZoom": m["maxZoom"],
                         "features": m["features"]}
        for lyr in m["layers"]:
            layers.append({**lyr, "archive": m["archive"]})
    index = {"builtAt": datetime.now(timezone.utc).isoformat(),
             "groupOrder": [g for g in GROUP_ORDER if g in groups],
             "groups": groups, "layers": layers}
    with open(os.path.join(OUT_DIR, "epi-layers.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1)
    log(f"index rewritten: {len(groups)} groups, {len(layers)} layers, "
        f"{sum(l['features'] for l in layers):,} features")


def main():
    dsn = os.environ.get("DATABASE_URL") or sys.stdin.readline().strip()
    if not dsn:
        sys.exit("DATABASE_URL missing")
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = time.time()

    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")
    tables = catalogue(cur)
    wanted = [g for g in GROUP_ORDER if not ONLY or g in ONLY]
    log(f"{len(tables)} tables in epi; building {', '.join(wanted)}")

    for group in wanted:
        members = [t for t in tables if t["group"] == group]
        if not members:
            log(f"{group}: no tables, skipped")
            continue
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        geojson = os.path.join(OUT_DIR, f"epi-{group}-{stamp}.geojsonl")
        pmtiles = os.path.join(OUT_DIR, f"epi-{group}-{stamp}.pmtiles")
        size_mb = sum(t["bytes"] for t in members) / 1e6
        log(f"=== {group}: {len(members)} tables, {size_mb:,.0f} MB in postgres")

        t1 = time.time()
        layers, n = export_group(conn, cur, group, members, geojson)
        gb = os.path.getsize(geojson) / 1e9
        log(f"{group}: {n:,} features exported in {(time.time() - t1) / 60:.1f} min ({gb:.2f} GB)")
        if n == 0:
            os.remove(geojson)
            log(f"{group}: nothing to tile")
            continue

        t2 = time.time()
        cmd = ["tippecanoe", "-o", pmtiles, "--force", "-l", "epi", "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM),
               "--read-parallel", "--simplify-only-low-zooms", "--no-tiny-polygon-reduction-at-maximum-zoom",
               "--drop-smallest-as-needed", "--drop-densest-as-needed", "--maximum-tile-bytes=1500000", "-r1",
               "--attribution", "NSW DPHI ePlanning", "--name", f"EPI {GROUP_LABEL.get(group, group)}", geojson]
        log("tippecanoe: " + " ".join(cmd[:12]) + " …")
        proc = subprocess.run(cmd, capture_output=True, text=True)
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-10:])
        if proc.returncode != 0:
            os.remove(geojson)
            log(f"{group}: TIPPECANOE FAILED ({proc.returncode}):\n{tail}")
            continue
        log(f"{group}: tippecanoe done in {(time.time() - t2) / 60:.1f} min "
            f"({os.path.getsize(pmtiles) / 1e6:.0f} MB)")
        os.remove(geojson)          # peak disk is one group, not the schema

        manifest = {"group": group, "label": GROUP_LABEL.get(group, group),
                    "archive": os.path.basename(pmtiles),
                    "builtAt": datetime.now(timezone.utc).isoformat(),
                    "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM, "features": n, "layers": layers}
        with open(os.path.join(OUT_DIR, f"epi-{group}.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=1)
        write_index()
        log(f"{group}: done, {(time.time() - t0) / 60:.1f} min elapsed overall")

    conn.close()
    write_index()
    log(f"all groups finished in {(time.time() - t0) / 60:.1f} min")
    with open(os.path.join(OUT_DIR, "epi-layers.json"), encoding="utf-8") as f:
        index = json.load(f)
    print(json.dumps({"groups": len(index["groups"]), "layers": len(index["layers"]),
                      "features": sum(l["features"] for l in index["layers"])}))


if __name__ == "__main__":
    main()
