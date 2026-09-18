"""Build the SEPP land application PMTiles archive behind /lmr.

Reads the SEPP rows of epi.epi_land_application (All-EPI geodatabase, loaded into planningai by "01A dump-gdal")
and writes, into OUT_DIR:

  sepp-land-application-<stamp>.pmtiles   the vector tiles, one MVT layer "sepp", zoom 4-14 (tippecanoe)
  sepp-land-application.json              the manifest: which archive is current, and the layer catalogue

Runs in the sedona container on the planningai host, which has tippecanoe and psycopg2. DATABASE_URL is read
from the environment or, if absent, from the first line of stdin, so it never appears on a command line:

  docker exec -i -w /opt/workspace/sepp_pmtiles sedona python3 build-sepp-pmtiles.py < <(echo "$DATABASE_URL")

then publish OUT_DIR's two files to /var/www/static/pmtiles/ on the host (nginx serves them at /pmtiles/).
Rebuild after every EPI load: the archive is a snapshot of the epi schema.

WHAT GOES INTO EACH FEATURE

Geometry is repaired (169 SEPP polygons are invalid), reduced to polygons and reprojected to WGS84 in the query.
Properties are what /lmr styles and shows on click: layer_key, layer_group, sepp, lay_name, lay_class, label,
clause, lga, commenced. A layer is one (SEPP, lay_name) pair - "SEPP Land Application" alone is a lay_name in
eleven SEPPs - and layer_key names it.

The Resilience and Hazards SEPP's two land application layers hold 109 of the 115 million vertices. A layer
whose source has more than HEAVY_VERTICES vertices gets tippecanoe minzoom HEAVY_MIN_ZOOM, so the low-zoom tiles
of all of NSW are not spent on the coastline.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2

OUT_DIR = os.environ.get("SEPP_OUT_DIR", "/opt/workspace/sepp_pmtiles/out")
MIN_ZOOM, MAX_ZOOM = 4, 14
HEAVY_VERTICES = 5_000_000
HEAVY_MIN_ZOOM = 9
LMR_LAYERS = ("Low and Mid Rise Housing Exclusion Area", "Town Centre",
              "Transport Oriented Development Area", "Accelerated TOD Precinct")


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def clean_epi(name):
    # the geodatabase's em dash arrives as U+FFFD: "Precincts�Central River City"
    return name.replace("�", " – ")


def short_sepp(epi):
    m = re.match(r"^State Environmental Planning Policy \((.*)\) (\d{4})$", epi)
    return f"{m.group(1)} {m.group(2)}" if m else epi


def layer_key(sepp, lay_name):
    base = re.sub(r" \d{4}$", "", sepp)
    return re.sub(r"[^a-z0-9]+", "_", f"{base} {lay_name}".lower()).strip("_")


def main():
    dsn = os.environ.get("DATABASE_URL") or sys.stdin.readline().strip()
    if not dsn:
        sys.exit("DATABASE_URL missing")
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    geojson = os.path.join(OUT_DIR, f"sepp-{stamp}.geojsonl")
    pmtiles = os.path.join(OUT_DIR, f"sepp-land-application-{stamp}.pmtiles")
    t0 = time.time()

    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")

    # ── the heavy layers, by source vertex count ─────────────────────────────────
    cur.execute("""SELECT epi_name, lay_name, sum(ST_NPoints(geom))
                   FROM epi.epi_land_application WHERE epi_type = 'SEPP' GROUP BY 1, 2""")
    heavy = {layer_key(short_sepp(clean_epi(e)), l) for e, l, v in cur.fetchall() if v > HEAVY_VERTICES}
    log(f"heavy layers (minzoom {HEAVY_MIN_ZOOM}): {sorted(heavy)}")

    source = None
    cur.execute("""SELECT loaded_at, source_date FROM public.geodaas_latest_load
                   WHERE schema_name = 'epi' AND table_name = 'epi_land_application'""")
    row = cur.fetchone()
    if row:
        source = {"loadedAt": row[0].isoformat() if row[0] else None, "sourceDate": row[1].isoformat() if row[1] else None}

    # ── stream the features ──────────────────────────────────────────────────────
    stream = conn.cursor(name="sepp_features")
    stream.itersize = 500
    stream.execute("""
        SELECT objectid, epi_name, lay_name, btrim(lay_class),
               nullif(nullif(btrim(label), ''), '<Null>'), nullif(nullif(btrim(legis_ref_clause), ''), '<Null>'),
               lga_name, commenced_date::date::text, ST_NPoints(geom),
               ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom),
               ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(ST_MakeValid(ST_Force2D(geom)), 3), 4326), 7)
        FROM epi.epi_land_application
        WHERE epi_type = 'SEPP' AND geom IS NOT NULL
        ORDER BY epi_name, lay_name, objectid""")
    layers = {}
    n = 0
    with open(geojson, "w", encoding="utf-8") as out:
        for (oid, epi, lay, cls, label, clause, lga, commenced, npts, w, s, e, nth, gj) in stream:
            if not gj or '"coordinates":[]' in gj:
                continue
            epi = clean_epi(epi)
            sepp = short_sepp(epi)
            key = layer_key(sepp, lay)
            group = "lmr" if sepp.startswith("Housing ") and lay in LMR_LAYERS else "sepp"
            L = layers.setdefault(key, {
                "key": key, "group": group, "sepp": sepp, "epiName": epi, "layName": lay, "features": 0,
                "classes": {}, "lgas": set(), "commenced": None, "bbox": [180.0, 90.0, -180.0, -90.0],
                "vertices": 0, "minZoom": HEAVY_MIN_ZOOM if key in heavy else 0,
            })
            L["features"] += 1
            L["classes"][cls] = L["classes"].get(cls, 0) + 1
            if lga:
                L["lgas"].add(lga)
            if commenced and (L["commenced"] is None or commenced > L["commenced"]):
                L["commenced"] = commenced
            L["bbox"] = [min(L["bbox"][0], w), min(L["bbox"][1], s), max(L["bbox"][2], e), max(L["bbox"][3], nth)]
            L["vertices"] += npts
            feature = {
                "type": "Feature", "id": oid,
                "properties": {"layer_key": key, "layer_group": group, "sepp": sepp, "lay_name": lay, "lay_class": cls,
                               "label": label, "clause": clause, "lga": lga, "commenced": commenced},
                "geometry": json.loads(gj),
            }
            if key in heavy:
                feature["tippecanoe"] = {"minzoom": HEAVY_MIN_ZOOM}
            out.write(json.dumps(feature, separators=(",", ":")) + "\n")
            n += 1
            if n % 2000 == 0:
                log(f"  {n:,} features written")
    stream.close()
    conn.close()
    log(f"{n:,} features in {len(layers)} layers exported in {(time.time() - t0) / 60:.1f} min "
        f"({os.path.getsize(geojson) / 1e9:.2f} GB of GeoJSON)")

    # ── tiles ────────────────────────────────────────────────────────────────────
    t1 = time.time()
    cmd = ["tippecanoe", "-o", pmtiles, "--force", "-l", "sepp", "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM),
           "--read-parallel",
           # keep every feature at every zoom it is visible from; simplify rather than drop, and let
           # tiny slivers go only where a tile would otherwise be over the size limit
           "--simplify-only-low-zooms", "--no-tiny-polygon-reduction-at-maximum-zoom",
           "--drop-smallest-as-needed", "--maximum-tile-bytes=1500000",
           "--attribution", "NSW DPHI All-EPI geodatabase",
           "--name", "SEPP land application", geojson]
    log("tippecanoe: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    tail = "\n".join((proc.stderr or "").strip().splitlines()[-25:])
    if proc.returncode != 0:
        sys.exit(f"tippecanoe failed ({proc.returncode}):\n{tail}")
    log(f"tippecanoe done in {(time.time() - t1) / 60:.1f} min: {os.path.getsize(pmtiles) / 1e6:.0f} MB\n{tail}")
    os.remove(geojson)

    # ── manifest ─────────────────────────────────────────────────────────────────
    manifest = {
        "archive": os.path.basename(pmtiles),
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM,
        "features": n,
        "layers": [
            {**{k: v for k, v in L.items() if k not in ("classes", "lgas")},
             "classes": [{"name": c, "features": f} for c, f in sorted(L["classes"].items(), key=lambda x: (-x[1], x[0] or ""))],
             "lgas": len(L["lgas"])}
            for L in sorted(layers.values(), key=lambda x: (x["group"], x["sepp"], x["layName"]))
        ],
    }
    with open(os.path.join(OUT_DIR, "sepp-land-application.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    log(f"manifest written; total {(time.time() - t0) / 60:.1f} min")
    print(json.dumps({"archive": manifest["archive"], "features": n, "layers": len(layers)}))


if __name__ == "__main__":
    main()
