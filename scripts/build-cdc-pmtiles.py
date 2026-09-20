"""Build the CDC PMTiles archives behind /cdc-map.

Reads the `cdc` schema on planningai - every layer a complying development check needs - and produces,
into OUT_DIR, one archive per group plus a combined index:

  cdc-<group>-<stamp>.pmtiles   one MVT layer "cdc", zoom 4-14 (tippecanoe)
  cdc-<group>.json              that group's manifest: which archive is current, and its layer catalogue
  cdc-layers.json               the index the app reads: every layer, which group and archive holds it

Runs in the sedona container on the planningai host (tippecanoe, psycopg2). DATABASE_URL comes from the
environment or the first line of stdin. Publish everything to /var/www/static/pmtiles/ on the host, the
index last. Re-run after the schema is rebuilt, which happens after every EPI load.

SIMPLER THAN THE EPI BUILD, because the hard part is already done. Every cdc layer is a view with the same
four columns - id, name, class, geom - so there is no per-table column sniffing here: the schema builder
decided what `name` and `class` mean for each layer and this just streams them.

The groups are the ones the page already shows in its panel, smallest first, so a run that stops half way
still leaves a usable map and the index is rewritten after each one.

FIVE LAYERS HAVE NO DATA at all - critical habitat, private native forestry, contaminated land, unsewered
land and the Agritourism map. They are in cdc.layers with features NULL and are skipped here, but the page
still lists them, because a layer nobody can draw is exactly the thing a reader needs told.

The verdict on /cdc-map does NOT come from these tiles - it is a PostGIS query against the lot polygon
across all 59 layers, which takes about 300 ms and is exact. The tiles are only for drawing.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2

OUT_DIR = os.environ.get("CDC_OUT_DIR", "/opt/workspace/cdc_pmtiles/out")
MIN_ZOOM, MAX_ZOOM = 4, 14
# Above this, a layer is drawn only from HEAVY_MIN_ZOOM: the low-zoom tiles of all NSW should not be spent
# on the biodiversity and bush fire blankets, which cover most of the state.
HEAVY_VERTICES = 20_000_000
HEAVY_MIN_ZOOM = 9
ONLY = {g.strip() for g in os.environ.get("CDC_ONLY", "").split(",") if g.strip()}

# Smallest first, so a broken run still leaves most of the map working.
GROUP_ORDER = ["heritage", "code", "land", "water", "hazard", "nature"]


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def catalogue(cur):
    """The layers, from the catalogue the schema builder wrote. Empty ones are carried but not tiled."""
    cur.execute("""
        SELECT key, title, grp, grp_title, clauses, column_tested, note, kind,
               source_kind, source, filter, srid, features
        FROM cdc.layers ORDER BY grp_order, title""")
    out = []
    for (key, title, grp, grp_title, clauses, column_tested, note, kind,
         source_kind, source, filt, srid, features) in cur.fetchall():
        out.append({"key": key, "title": title, "group": grp, "groupTitle": grp_title,
                    "clauses": list(clauses or []), "columnTested": column_tested, "note": note,
                    "kind": kind, "sourceKind": source_kind, "source": source, "filter": filt,
                    "srid": srid or 4283, "rows": int(features or 0)})
    return out


def export_group(conn, cur, group, members, geojson_path):
    """Stream every layer of one group into a single GeoJSONL. Returns (layers, features)."""
    layers, total = [], 0
    with open(geojson_path, "w", encoding="utf-8") as out:
        for spec in members:
            key, srid = spec["key"], spec["srid"]
            entry = {**spec, "features": 0, "minZoom": 0, "bbox": None,
                     "geometry": None, "categories": []}
            if not spec["rows"]:
                log(f"  {key}: no features, skipped")
                layers.append(entry)
                continue

            cur.execute(f'SELECT sum(ST_NPoints(geom)), min(ST_GeometryType(geom)) FROM cdc."{key}"')
            vertices, sample_type = cur.fetchone()
            # everything in cdc is a polygon layer; the extract keeps a stray collection from breaking the run
            min_zoom = HEAVY_MIN_ZOOM if (vertices or 0) > HEAVY_VERTICES else 0

            stream = conn.cursor(name=f"s_{group}_{key}"[:60])
            stream.itersize = 500
            geom = "geom" if srid in (4283, 4326) else "ST_Transform(geom, 4283)"
            stream.execute(f"""
                SELECT name, class,
                       ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g),
                       ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(ST_MakeValid(g), 3), 4326), 6)
                FROM (SELECT name, class, ST_Force2D({geom}) AS g FROM cdc."{key}") s
                WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)""")

            count, cats, bbox = 0, {}, [180.0, 90.0, -180.0, -90.0]
            t1 = time.time()
            for name, klass, w, s, e, nth, gj in stream:
                if not gj or '"coordinates":[]' in gj:
                    continue
                feature = {"type": "Feature",
                           "properties": {"layer_key": key, "name": name, "class": klass},
                           "geometry": json.loads(gj)}
                if min_zoom:
                    feature["tippecanoe"] = {"minzoom": min_zoom}
                out.write(json.dumps(feature, separators=(",", ":")) + "\n")
                count += 1
                label = klass or name
                if label is not None:
                    cats[label] = cats.get(label, 0) + 1
                bbox = [min(bbox[0], w), min(bbox[1], s), max(bbox[2], e), max(bbox[3], nth)]
            stream.close()
            total += count
            entry.update({"features": count, "minZoom": min_zoom, "bbox": bbox if count else None,
                          "geometry": "polygon", "vertices": int(vertices or 0),
                          "categories": [{"name": c, "features": f}
                                         for c, f in sorted(cats.items(), key=lambda x: -x[1])[:40]]})
            layers.append(entry)
            log(f"  {key}: {count:,} features, {int(vertices or 0):,} vertices, "
                f"minzoom {min_zoom}, {time.time() - t1:.0f} s")
    return layers, total


def write_index():
    """Rebuild cdc-layers.json from whatever group manifests exist, so a partial run still serves."""
    groups, layers = {}, []
    for group in GROUP_ORDER:
        path = os.path.join(OUT_DIR, f"cdc-{group}.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            m = json.load(f)
        groups[group] = {"label": m["label"], "archive": m["archive"], "builtAt": m["builtAt"],
                         "minZoom": m["minZoom"], "maxZoom": m["maxZoom"], "features": m["features"]}
        for lyr in m["layers"]:
            layers.append({**lyr, "archive": m["archive"]})
    index = {"builtAt": datetime.now(timezone.utc).isoformat(),
             "groupOrder": [g for g in GROUP_ORDER if g in groups],
             "groups": groups, "layers": layers}
    with open(os.path.join(OUT_DIR, "cdc-layers.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1)
    log(f"index rewritten: {len(groups)} groups, {len(layers)} layers, "
        f"{sum(l['features'] for l in layers):,} features")


def main():
    dsn = os.environ.get("DATABASE_URL") or sys.stdin.readline().strip()
    if not dsn:
        sys.exit("DATABASE_URL missing")
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = time.time()

    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30,
                            keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")
    all_layers = catalogue(cur)
    wanted = [g for g in GROUP_ORDER if not ONLY or g in ONLY]
    live = sum(1 for x in all_layers if x["rows"])
    log(f"{len(all_layers)} layers in cdc, {live} with features; building {', '.join(wanted)}")

    for group in wanted:
        members = [x for x in all_layers if x["group"] == group]
        if not members:
            log(f"{group}: no layers, skipped")
            continue
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        geojson = os.path.join(OUT_DIR, f"cdc-{group}-{stamp}.geojsonl")
        pmtiles = os.path.join(OUT_DIR, f"cdc-{group}-{stamp}.pmtiles")
        label = members[0]["groupTitle"] or group
        log(f"=== {group}: {len(members)} layers, {sum(m['rows'] for m in members):,} rows")

        t1 = time.time()
        layers, n = export_group(conn, cur, group, members, geojson)
        gb = os.path.getsize(geojson) / 1e9
        log(f"{group}: {n:,} features exported in {(time.time() - t1) / 60:.1f} min ({gb:.2f} GB)")
        if n == 0:
            os.remove(geojson)
            log(f"{group}: nothing to tile")
            continue

        t2 = time.time()
        cmd = ["tippecanoe", "-o", pmtiles, "--force", "-l", "cdc",
               "-Z", str(MIN_ZOOM), "-z", str(MAX_ZOOM),
               "--read-parallel", "--simplify-only-low-zooms",
               "--no-tiny-polygon-reduction-at-maximum-zoom",
               "--drop-smallest-as-needed", "--drop-densest-as-needed",
               "--maximum-tile-bytes=1500000", "-r1",
               "--attribution", "NSW DPHI ePlanning", "--name", f"CDC {label}", geojson]
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

        manifest = {"group": group, "label": label, "archive": os.path.basename(pmtiles),
                    "builtAt": datetime.now(timezone.utc).isoformat(),
                    "minZoom": MIN_ZOOM, "maxZoom": MAX_ZOOM, "features": n, "layers": layers}
        with open(os.path.join(OUT_DIR, f"cdc-{group}.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=1)
        write_index()
        log(f"{group}: done, {(time.time() - t0) / 60:.1f} min elapsed overall")

    conn.close()
    write_index()
    log(f"all groups finished in {(time.time() - t0) / 60:.1f} min")
    with open(os.path.join(OUT_DIR, "cdc-layers.json"), encoding="utf-8") as f:
        index = json.load(f)
    print(json.dumps({"groups": len(index["groups"]), "layers": len(index["layers"]),
                      "features": sum(l["features"] for l in index["layers"])}))


if __name__ == "__main__":
    main()
