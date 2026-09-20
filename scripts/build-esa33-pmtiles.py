"""Build the state-wide clause 3.3 PMTiles archive behind /esa.

Reads the `esa` schema on planningai - the state-wide environmentally sensitive areas built by the
Notebooks "07C - ESA - clause 3.3 state-wide" - and writes, into OUT_DIR:

  esa-clause33-<stamp>.pmtiles   one MVT layer "esa33", zoom 4-14 (tippecanoe)
  esa-clause33.json              the manifest: which archive is current, and the layer catalogue

Runs in the sedona container on the planningai host (tippecanoe, psycopg2). DATABASE_URL comes from the
environment or the first line of stdin. Publish both files to /var/www/static/pmtiles/ on the host, manifest
last. Rebuild whenever 07C is re-run.

WHICH TABLES

The registry drives the build. Every row of `esa.clause33_layers` that names a table is drawn, so a layer
added by the notebook reaches the map without editing this script. Two things are left out:

  * rows with provenance 'gap' - there is no table, because nobody publishes the dataset;
  * anything named in ESA33_SKIP (default: biodiversity_values, 625k polygons that are the Offsets Scheme
    entry map rather than a clause 3.3 item). A skipped layer still appears in the manifest, flagged
    tiled=false, so the page can say it exists in the database but is not drawn.

EACH FEATURE carries layer_key (the registry key), paragraph, category (what the page colours by, where a
table has a column worth colouring by), name and detail. The attribute columns differ from layer to layer -
these are eleven different agencies - so the name, detail and category columns are resolved per table from
the preference lists below rather than hard-coded.

A table with more than HEAVY_VERTICES vertices is drawn from HEAVY_MIN_ZOOM, so the low-zoom tiles of all
NSW are not spent on the biodiversity polygons.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2

OUT_DIR = os.environ.get("ESA33_OUT_DIR", "/opt/workspace/esa33_pmtiles/out")
MIN_ZOOM, MAX_ZOOM = 4, 14
HEAVY_VERTICES = 20_000_000
HEAVY_MIN_ZOOM = 9
SKIP = {s.strip() for s in os.environ.get("ESA33_SKIP", "biodiversity_values").split(",") if s.strip()}

# The column each role is taken from, first match wins. These tables come from eleven publishers and
# share no schema, so the build reads what is actually there instead of assuming.
NAME_COLUMNS = ["label", "name", "itemname", "h_name", "reservename", "reserve_name", "wha_name",
                "ramsar_nam", "site_name", "decname", "idname", "mpa_name", "lay_class", "lep_name"]
DETAIL_COLUMNS = ["epi_name", "lga_name", "lay_name", "type", "purpose", "authority", "tenure",
                  "state", "status", "comments", "reservepurpose"]
CATEGORY_COLUMNS = ["lay_class", "type", "category", "d_category", "tenure", "class",
                    "high_significance", "coverage_type"]
EXTRACT = {"POINT": 1, "LINESTRING": 2, "POLYGON": 3}


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def pick(columns, preferences):
    lower = {c.lower(): c for c in columns}
    for want in preferences:
        if want in lower:
            return lower[want]
    return None


def expressions(columns, item):
    """(category, name, detail) SQL for one table, from whichever columns it happens to have."""
    cat = pick(columns, CATEGORY_COLUMNS)
    name = pick(columns, NAME_COLUMNS)
    detail_cols = [c for c in DETAIL_COLUMNS if c in {c2.lower() for c2 in columns}][:3]
    lower = {c.lower(): c for c in columns}
    literal = item.replace("'", "''")
    return (
        f'("{cat}")::text' if cat else "NULL::text",
        f'nullif(btrim(("{name}")::text), \'\')' if name else f"'{literal}'",
        ("concat_ws(' · ', " + ", ".join(f'nullif(btrim(("{lower[c]}")::text), \'\')' for c in detail_cols) + ")")
        if detail_cols else f"'{literal}'",
    )


def main():
    dsn = os.environ.get("DATABASE_URL") or sys.stdin.readline().strip()
    if not dsn:
        sys.exit("DATABASE_URL missing")
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    geojson = os.path.join(OUT_DIR, f"esa33-{stamp}.geojsonl")
    pmtiles = os.path.join(OUT_DIR, f"esa-clause33-{stamp}.pmtiles")
    t0 = time.time()

    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")
    cur.execute("""
        SELECT key, paragraph, item, table_name, provenance, source, row_count, verified, note
        FROM esa.clause33_layers
        WHERE table_name IS NOT NULL
        ORDER BY coalesce(paragraph, 'z'), item""")
    registry = cur.fetchall()
    log(f"{len(registry)} registered layers, skipping {sorted(SKIP) or 'nothing'}")

    layers, n = [], 0
    with open(geojson, "w", encoding="utf-8") as out:
        for key, paragraph, item, table_name, provenance, source, row_count, verified, note in registry:
            schema, _, table = table_name.partition(".")
            entry = {"key": key, "paragraph": paragraph, "item": item, "table": table_name,
                     "provenance": provenance, "source": source, "verified": bool(verified),
                     "note": note, "tiled": False, "features": 0, "vertices": 0,
                     "minZoom": 0, "bbox": None, "categories": [], "geometry": None}
            if key in SKIP:
                log(f"SKIP {key}: named in ESA33_SKIP")
                layers.append(entry)
                continue
            cur.execute("""SELECT f_geometry_column, upper(type), srid FROM geometry_columns
                           WHERE f_table_schema = %s AND f_table_name = %s""", (schema, table))
            row = cur.fetchone()
            if not row:
                log(f"SKIP {key}: {table_name} has no geometry column")
                layers.append(entry)
                continue
            gcol, gtype, srid = row
            cur.execute("""SELECT column_name FROM information_schema.columns
                           WHERE table_schema = %s AND table_name = %s""", (schema, table))
            columns = [r[0] for r in cur.fetchall()]
            cat_sql, name_sql, detail_sql = expressions(columns, item)

            cur.execute(f'SELECT sum(ST_NPoints("{gcol}")), min(ST_GeometryType("{gcol}")) FROM {schema}."{table}"')
            vertices, sample_type = cur.fetchone()
            if not vertices:
                log(f"SKIP {key}: {table_name} is empty")
                layers.append(entry)
                continue
            kind = next((k for k in EXTRACT if k in (sample_type or "").upper()), "POLYGON")
            min_zoom = HEAVY_MIN_ZOOM if (vertices or 0) > HEAVY_VERTICES else 0

            stream = conn.cursor(name=f"s_{key}"[:60])
            stream.itersize = 1000
            geom = (f'ST_Force2D("{gcol}")' if srid in (4283, 4326)
                    else f'ST_Transform(ST_Force2D("{gcol}"), 4283)')
            stream.execute(f"""
                SELECT ({cat_sql}), ({name_sql}), ({detail_sql}),
                       ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g),
                       ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(ST_MakeValid(g), {EXTRACT[kind]}), 4326), 7)
                FROM (SELECT *, ST_SetSRID({geom}, CASE WHEN {srid} = 4326 THEN 4326 ELSE 4283 END) AS g
                      FROM {schema}."{table}") s
                WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)""")
            count, cats, bbox = 0, {}, [180.0, 90.0, -180.0, -90.0]
            t1 = time.time()
            for category, name, detail, w, s, e, nth, gj in stream:
                if not gj or '"coordinates":[]' in gj:
                    continue
                feature = {"type": "Feature",
                           "properties": {"layer_key": key, "paragraph": paragraph or "?",
                                          "category": category, "name": name, "detail": detail},
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
            entry.update({"tiled": count > 0, "features": count, "vertices": int(vertices or 0),
                          "minZoom": min_zoom, "bbox": bbox if count else None,
                          "geometry": kind.lower(),
                          "categories": [{"name": c, "features": f}
                                         for c, f in sorted(cats.items(), key=lambda x: -x[1])[:40]]})
            layers.append(entry)
            log(f"{key}: {count:,} {kind.lower()} features, {int(vertices or 0):,} vertices, "
                f"minzoom {min_zoom}, {time.time() - t1:.0f} s")
    conn.close()
    log(f"{n:,} features exported in {(time.time() - t0) / 60:.1f} min ({os.path.getsize(geojson) / 1e9:.2f} GB)")

    t2 = time.time()
    cmd = ["tippecanoe", "-o", pmtiles, "--force", "-l", "esa33", "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM),
           "--read-parallel", "--simplify-only-low-zooms", "--no-tiny-polygon-reduction-at-maximum-zoom",
           "--drop-smallest-as-needed", "--maximum-tile-bytes=1500000", "-r1",
           "--attribution", "NSW DPHI, NSW DCCEEW, Crown Lands, DPI Fisheries, Commonwealth DCCEEW",
           "--name", "Clause 3.3 environmentally sensitive areas", geojson]
    log("tippecanoe: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    tail = "\n".join((proc.stderr or "").strip().splitlines()[-12:])
    if proc.returncode != 0:
        sys.exit(f"tippecanoe failed ({proc.returncode}):\n{tail}")
    log(f"tippecanoe done in {(time.time() - t2) / 60:.1f} min: {os.path.getsize(pmtiles) / 1e6:.0f} MB")
    os.remove(geojson)

    manifest = {"archive": os.path.basename(pmtiles), "builtAt": datetime.now(timezone.utc).isoformat(),
                "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM, "features": n, "layers": layers}
    with open(os.path.join(OUT_DIR, "esa-clause33.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    log(f"manifest written; total {(time.time() - t0) / 60:.1f} min")
    print(json.dumps({"archive": manifest["archive"], "features": n,
                      "layers": sum(1 for lyr in layers if lyr["tiled"])}))


if __name__ == "__main__":
    main()
