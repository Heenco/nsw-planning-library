"""Build the LMR constraints PMTiles archive behind /lmr.

Reads the `lmr` schema on planningai - the datasets the Low and Mid-Rise Housing Policy is checked against,
each table documented by its own COMMENT - and writes, into OUT_DIR:

  lmr-constraints-<stamp>.pmtiles   one MVT layer "lmr", zoom 4-14 (tippecanoe)
  lmr-constraints.json              the manifest: which archive is current, and the layer catalogue

Runs in the sedona container on the planningai host (tippecanoe, psycopg2). DATABASE_URL comes from the
environment or the first line of stdin. Publish both files to /var/www/static/pmtiles/ on the host, manifest
last. Rebuild whenever the lmr schema is refreshed.

WHICH TABLES

Every table in LAYERS below. Four tables of the schema are deliberately left out because /lmr already draws
the same rows from the SEPP land application archive (scripts/build-sepp-pmtiles.py): sepp_lmr_exclusion_areas,
sepp_tod_accelerated_precincts, sepp_tod_areas and sepp_town_centres are copies of Housing SEPP rows of
epi.epi_land_application. Both pipeline tables and their 200 m buffers are kept whole - they cover all of Australia,
and oil_pipelines has no NSW rows at all - so the four layers show the same national extent.

The walking catchments (station_walking_catchments, town_centre_walking_catchments) are built first by
scripts/build-lmr-walking.py from the Mapbox Isochrone API; their category is the distance, "400 m" or "800 m".

EACH FEATURE carries layer_key (the table name), category (what the page colours by, where a table has one),
name and detail (what the click popup shows). A table with more than HEAVY_VERTICES vertices is drawn from
HEAVY_MIN_ZOOM, so the low-zoom tiles of all NSW are not spent on bushfire and wetland proximity polygons.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2

OUT_DIR = os.environ.get("LMR_OUT_DIR", "/opt/workspace/lmr_pmtiles/out")
MIN_ZOOM, MAX_ZOOM = 4, 14
HEAVY_VERTICES = 20_000_000
HEAVY_MIN_ZOOM = 9

# table -> SQL for category, name, detail (over the table's own columns) and an optional WHERE
LAYERS = {
    "lmr_train_stations": dict(category="CASE WHEN light_rail THEN 'Light rail' ELSE 'Train' END",
                               name="station", detail="'LMR station' || CASE WHEN light_rail THEN ' (light rail)' ELSE '' END"),
    "station_walking_catchments": dict(category="distance_m || ' m'", name="station",
                                       detail="distance_m || ' m walk from the station (Mapbox walking isochrone)'"),
    "town_centre_walking_catchments": dict(category="distance_m || ' m'", name="label",
                                           detail="distance_m || ' m walk from the edge of the town centre (Mapbox walking isochrones)'"),
    "shr_curtilage": dict(category="NULL", name="itemname", detail="'SHR ' || btrim(listingno) || coalesce(' · ' || lga, '')"),
    "epi_heritage_items": dict(category="lay_class", name="h_name",
                               detail="concat_ws(' · ', lay_class, nullif(sig, ''), epi_name)"),
    "epi_heritage_conservation_areas": dict(category="lay_class", name="coalesce(h_name, label)",
                                            detail="concat_ws(' · ', lay_class, epi_name)"),
    "bushfire_prone_land": dict(category="d_category", name="d_category", detail="'RFS bush fire prone land'"),
    "flood_planning": dict(category="lay_class", name="lay_class", detail="concat_ws(' · ', epi_name, lga_name)"),
    "flood_sfd_1aep": dict(category="NULL", name="'1% AEP flood extent'", detail="'first load (GDA94)'"),
    "flood_sfd_1aep_1": dict(category="NULL", name="'1% AEP flood extent'", detail="'second load (Web Mercator)'"),
    "sepp_coastal_vulnerability_areas": dict(category="NULL", name="label", detail="concat_ws(' · ', amendment, lga_name)"),
    "sepp_coastal_wetlands": dict(category="NULL", name="label", detail="lga_name"),
    "sepp_coastal_wetlands_proximity": dict(category="NULL", name="label", detail="lga_name"),
    "sepp_littoral_rainforest": dict(category="NULL", name="label", detail="lga_name"),
    "sepp_littoral_rainforest_proximity": dict(category="NULL", name="label", detail="lga_name"),
    "airport_noise": dict(category="btrim(anef_code)", name="coalesce(btrim(anef_code), name, lay_name)",
                          detail="coalesce(epi_name, name, folderpath)"),
    "gas_pipelines": dict(category="operational_status", name="name", detail="concat_ws(' · ', state, operational_status)"),
    "oil_pipelines": dict(category="operational_status", name="name", detail="concat_ws(' · ', state, operational_status)"),
    "gas_pipelines_buffer_200m": dict(category="operational_status", name="name",
                                      detail="'within 200 m of the pipeline · ' || concat_ws(' · ', state, operational_status)"),
    "oil_pipelines_buffer_200m": dict(category="operational_status", name="name",
                                      detail="'within 200 m of the pipeline · ' || concat_ws(' · ', state, operational_status)"),
}
EXTRACT = {"POINT": 1, "LINESTRING": 2, "POLYGON": 3}


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def main():
    dsn = os.environ.get("DATABASE_URL") or sys.stdin.readline().strip()
    if not dsn:
        sys.exit("DATABASE_URL missing")
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    geojson = os.path.join(OUT_DIR, f"lmr-{stamp}.geojsonl")
    pmtiles = os.path.join(OUT_DIR, f"lmr-constraints-{stamp}.pmtiles")
    t0 = time.time()
    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")

    layers, n = [], 0
    with open(geojson, "w", encoding="utf-8") as out:
        for table, spec in LAYERS.items():
            cur.execute("""SELECT f_geometry_column, upper(type), srid, obj_description(format('lmr.%%I', %s)::regclass)
                           FROM geometry_columns WHERE f_table_schema = 'lmr' AND f_table_name = %s""", (table, table))
            row = cur.fetchone()
            if not row:
                log(f"SKIP {table}: no geometry column")
                continue
            gcol, gtype, srid, comment = row
            where = f"WHERE {spec['where']}" if spec.get("where") else ""
            cur.execute(f'SELECT sum(ST_NPoints("{gcol}")), min(ST_GeometryType("{gcol}")) FROM lmr."{table}" {where}')
            vertices, sample_type = cur.fetchone()
            kind = next((k for k in EXTRACT if k in (sample_type or "").upper()), "POLYGON")
            min_zoom = HEAVY_MIN_ZOOM if (vertices or 0) > HEAVY_VERTICES else 0
            stream = conn.cursor(name=f"s_{table}")
            stream.itersize = 1000
            geom = f'ST_Force2D("{gcol}")' if srid in (4283, 4326) else f'ST_Transform(ST_Force2D("{gcol}"), 4283)'
            stream.execute(f"""
                SELECT ({spec['category']})::text, ({spec['name']})::text, ({spec['detail']})::text,
                       ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g),
                       ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(ST_MakeValid(g), {EXTRACT[kind]}), 4326), 7)
                FROM (SELECT *, ST_SetSRID({geom}, CASE WHEN {srid} = 4326 THEN 4326 ELSE 4283 END) AS g FROM lmr."{table}" {where}) s
                WHERE g IS NOT NULL""")
            count, cats, bbox = 0, {}, [180.0, 90.0, -180.0, -90.0]
            t1 = time.time()
            for category, name, detail, w, s, e, nth, gj in stream:
                if not gj or '"coordinates":[]' in gj:
                    continue
                feature = {"type": "Feature",
                           "properties": {"layer_key": table, "category": category, "name": name, "detail": detail},
                           "geometry": json.loads(gj)}
                if min_zoom:
                    feature["tippecanoe"] = {"minzoom": min_zoom}
                out.write(json.dumps(feature, separators=(",", ":")) + "\n")
                count += 1
                if category is not None:
                    cats[category] = cats.get(category, 0) + 1
                bbox = [min(bbox[0], w), min(bbox[1], s), max(bbox[2], e), max(bbox[3], nth)]
            stream.close()
            n += count
            layers.append({"key": table, "table": f"lmr.{table}", "geometry": kind.lower(), "features": count,
                           "vertices": int(vertices or 0), "minZoom": min_zoom, "bbox": bbox if count else None,
                           "categories": [{"name": c, "features": f} for c, f in sorted(cats.items(), key=lambda x: -x[1])],
                           "comment": comment})
            log(f"{table}: {count:,} {kind.lower()} features, {int(vertices or 0):,} vertices, minzoom {min_zoom}, {time.time() - t1:.0f} s")
    conn.close()
    log(f"{n:,} features exported in {(time.time() - t0) / 60:.1f} min ({os.path.getsize(geojson) / 1e9:.2f} GB)")

    t2 = time.time()
    cmd = ["tippecanoe", "-o", pmtiles, "--force", "-l", "lmr", "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM),
           "--read-parallel", "--simplify-only-low-zooms", "--no-tiny-polygon-reduction-at-maximum-zoom",
           "--drop-smallest-as-needed", "--maximum-tile-bytes=1500000", "-r1",
           "--attribution", "NSW DPHI, NSW RFS, Heritage NSW, Geoscience Australia", "--name", "LMR constraints", geojson]
    log("tippecanoe: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    tail = "\n".join((proc.stderr or "").strip().splitlines()[-12:])
    if proc.returncode != 0:
        sys.exit(f"tippecanoe failed ({proc.returncode}):\n{tail}")
    log(f"tippecanoe done in {(time.time() - t2) / 60:.1f} min: {os.path.getsize(pmtiles) / 1e6:.0f} MB")
    os.remove(geojson)

    manifest = {"archive": os.path.basename(pmtiles), "builtAt": datetime.now(timezone.utc).isoformat(),
                "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM, "features": n, "layers": layers}
    with open(os.path.join(OUT_DIR, "lmr-constraints.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    log(f"manifest written; total {(time.time() - t0) / 60:.1f} min")
    print(json.dumps({"archive": manifest["archive"], "features": n, "layers": len(layers)}))


if __name__ == "__main__":
    main()
