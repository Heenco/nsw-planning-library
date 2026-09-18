"""Build the ESA exceptions PMTiles archive behind /esa.

Reads `esa.additional_exceptions` on planningai - the additional clause 3.3 environmentally sensitive areas that
30 local plans add, built by the Notebooks "07 - ESA - exceptions" - and writes, into OUT_DIR:

  esa-exceptions-<stamp>.pmtiles   one MVT layer "esa", zoom 4-14 (tippecanoe)
  esa-exceptions.json              the manifest: which archive is current, and one entry per item

Runs in the sedona container on the planningai host (tippecanoe, psycopg2). DATABASE_URL comes from the
environment or the first line of stdin. Publish both files to /var/www/static/pmtiles/ on the host, manifest
last. Rebuild whenever the layer is rebuilt.

EACH FEATURE carries the item's id, its plan and council, the clause reference and wording, its tier
(precise or advisory) and the layers it was drawn from - everything /esa shows when a shape is clicked, so the
page needs no database call to answer a click.

The two tiers are one layer, not two: the page filters on `tier`, and drawing them from the same tiles keeps a
precise item on top of the advisory blanket it sits inside.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2

OUT_DIR = os.environ.get("ESA_OUT_DIR", "/opt/workspace/esa_pmtiles/out")
MIN_ZOOM, MAX_ZOOM = 4, 14


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def main():
    dsn = os.environ.get("DATABASE_URL") or sys.stdin.readline().strip()
    if not dsn:
        sys.exit("DATABASE_URL missing")
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    geojson = os.path.join(OUT_DIR, f"esa-{stamp}.geojsonl")
    pmtiles = os.path.join(OUT_DIR, f"esa-exceptions-{stamp}.pmtiles")
    t0 = time.time()

    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")
    stream = conn.cursor(name="esa_items")
    stream.itersize = 20
    stream.execute("""
        SELECT id, lep_name, lga_name, ref, exception_text, coverage_type, verify_required,
               source_layers, n_source_features::int, area_km2,
               ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), ST_YMax(geometry),
               ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(geometry), 3), 7)
        FROM esa.additional_exceptions
        WHERE geometry IS NOT NULL
        ORDER BY id""")

    items, n = [], 0
    with open(geojson, "w", encoding="utf-8") as out:
        for (item_id, lep, lga, ref, text, tier, verify, layers, feats, km2, w, s, e, nth, gj) in stream:
            if not gj or '"coordinates":[]' in gj:
                log(f"SKIP item {item_id}: no polygon left after repair")
                continue
            out.write(json.dumps({
                "type": "Feature",
                "properties": {"id": item_id, "lep": lep, "lga": lga, "ref": ref, "text": text,
                               "tier": tier, "verify": bool(verify), "layers": layers,
                               "features": feats, "km2": km2},
                "geometry": json.loads(gj),
            }, separators=(",", ":")) + "\n")
            items.append({"id": item_id, "lep": lep, "ref": ref, "tier": tier,
                          "bbox": [w, s, e, nth], "km2": km2})
            n += 1
    stream.close()
    conn.close()
    log(f"{n} items exported in {(time.time() - t0) / 60:.1f} min ({os.path.getsize(geojson) / 1e6:.0f} MB)")

    t1 = time.time()
    cmd = ["tippecanoe", "-o", pmtiles, "--force", "-l", "esa", "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM),
           "--read-parallel", "--simplify-only-low-zooms", "--no-tiny-polygon-reduction-at-maximum-zoom",
           "--drop-smallest-as-needed", "--maximum-tile-bytes=1500000", "-r1",
           "--attribution", "NSW DPHI", "--name", "ESA additional exceptions", geojson]
    log("tippecanoe: " + " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"tippecanoe failed ({proc.returncode}):\n" + "\n".join((proc.stderr or "").splitlines()[-12:]))
    log(f"tippecanoe done in {(time.time() - t1) / 60:.1f} min: {os.path.getsize(pmtiles) / 1e6:.0f} MB")
    os.remove(geojson)

    manifest = {"archive": os.path.basename(pmtiles), "builtAt": datetime.now(timezone.utc).isoformat(),
                "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM, "features": n, "items": items}
    with open(os.path.join(OUT_DIR, "esa-exceptions.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    log(f"manifest written; total {(time.time() - t0) / 60:.1f} min")
    print(json.dumps({"archive": manifest["archive"], "features": n}))


if __name__ == "__main__":
    main()
