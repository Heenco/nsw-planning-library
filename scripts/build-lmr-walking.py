"""400 m and 800 m walking catchments around the LMR train stations and town centres, from the Mapbox Isochrone API.

Writes three tables in the planningai `lmr` schema:

  lmr.walking_isochrone_origin        one row per Mapbox request: the origin point and its 400 m / 800 m isochrones.
                                      The cache - a re-run skips every origin already fetched, so an interrupted run
                                      resumes, and a rebuild only asks Mapbox for new origins.
  lmr.station_walking_catchments      one row per station per distance
  lmr.town_centre_walking_catchments  one row per town centre (label) per distance

  python scripts/build-lmr-walking.py            DATABASE_URL and NUXT_PUBLIC_MAPBOX_TOKEN from .env
  python scripts/build-lmr-walking.py --limit 5  a trial: 5 origins of each kind

HOW THE CATCHMENTS ARE MADE

Mapbox walking isochrones (profile walking, contours_meters=400,800, polygons, generalize=0 - the default
simplification returns an 800 m catchment with ~28 vertices, generalize=0 with ~136). Walking distance is along
Mapbox's walkable network, snapped from the origin to the nearest walkable way.

- Stations: one request from the station point (lmr.lmr_train_stations - the station's single FOI point). The
  Housing SEPP measures from a public entrance, so at a large station the catchment starts a little off.
- Town centres: the policy measures from the EDGE of the town centre, and an isochrone has one origin. So points
  are placed every SPACING_M metres along every boundary ring of the centre (NSW Lambert, EPSG:3308, for metres),
  one request each, and the catchment is the union of all of them plus the centre itself. Centres with the same
  label (some are several polygons) are merged into one catchment.

Mapbox allows 300 requests a minute; this runs WORKERS requests at once under a 280-a-minute limiter.
"""
import argparse
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

SPACING_M = 100
DISTANCES = (400, 800)
WORKERS = 4
PER_MINUTE = 280
LIB = Path(__file__).resolve().parent.parent


def env(key):
    for line in (LIB / ".env").read_text(encoding="utf-8").splitlines():
        if line.split("=", 1)[0].strip() == key:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"{key} missing from .env")


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


class Limiter:
    """At most `per_minute` calls in any 60 s, shared across threads."""
    def __init__(self, per_minute):
        self.gap = 60.0 / per_minute
        self.next = time.monotonic()
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            if now < self.next:
                time.sleep(self.next - now)
            self.next = max(now, self.next) + self.gap


DDL = """
CREATE TABLE IF NOT EXISTS lmr.walking_isochrone_origin (
  origin_type text NOT NULL,              -- 'station' | 'town_centre'
  origin_key  text NOT NULL,              -- station name, or town centre label
  seq         int  NOT NULL,              -- 0 for a station; the point's order along the centre's boundary
  lon float8, lat float8,
  distance_m  int  NOT NULL,
  geom        geometry(MultiPolygon, 4283),
  fetched_at  timestamptz DEFAULT now(),
  PRIMARY KEY (origin_type, origin_key, seq, distance_m)
);
COMMENT ON TABLE lmr.walking_isochrone_origin IS
 'Mapbox Isochrone API walking isochrones (400 m and 800 m, generalize=0), one row per origin point per distance: the cache behind lmr.station_walking_catchments and lmr.town_centre_walking_catchments. Built by nsw-planning-library/scripts/build-lmr-walking.py.';
"""


def origins(cur, limit):
    """[(type, key, seq, lon, lat)] for every station and every town-centre boundary point."""
    cur.execute(f"""SELECT 'station', station, 0, ST_X(geom), ST_Y(geom) FROM lmr.lmr_train_stations
                    ORDER BY station {'LIMIT %s' % limit if limit else ''}""")
    out = cur.fetchall()
    cur.execute(f"""
        WITH centres AS (
          SELECT label, ST_Transform(ST_MakeValid(ST_Force2D(geom)), 3308) AS g FROM lmr.sepp_town_centres
          WHERE label IN (SELECT DISTINCT label FROM lmr.sepp_town_centres ORDER BY label {'LIMIT %s' % limit if limit else ''})),
        rings AS (
          SELECT label, (ST_DumpRings((ST_Dump(g)).geom)).geom AS ring FROM centres),
        lines AS (
          SELECT label, ST_ExteriorRing(ring) AS line FROM rings),
        pts AS (
          SELECT label, (ST_DumpPoints(
                   CASE WHEN ST_Length(line) <= {SPACING_M} THEN ST_PointN(line, 1)
                        ELSE ST_LineInterpolatePoints(line, {SPACING_M} / ST_Length(line)) END)).geom AS p
          FROM lines)
        SELECT 'town_centre', label, (row_number() OVER (PARTITION BY label ORDER BY ST_X(p), ST_Y(p)) - 1)::int,
               ST_X(ST_Transform(p, 4283)), ST_Y(ST_Transform(p, 4283))
        FROM pts""")
    return out + cur.fetchall()


def fetch(token, lon, lat, limiter):
    params = urllib.parse.urlencode({"contours_meters": ",".join(map(str, DISTANCES)), "polygons": "true",
                                     "generalize": "0", "access_token": token})
    url = f"https://api.mapbox.com/isochrone/v1/mapbox/walking/{lon:.6f},{lat:.6f}?{params}"
    for attempt in range(5):
        limiter.wait()
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt * 2)
                continue
            body = e.read().decode(errors="replace")[:200]
            if e.code == 422:          # no walkable network near the point (in water, in a rail yard): not an error
                return {"features": [], "unreachable": body}
            raise RuntimeError(f"HTTP {e.code} for {lon},{lat}: {body}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 4:
                time.sleep(2 ** attempt * 2)
                continue
            raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    dsn, token = env("DATABASE_URL"), env("NUXT_PUBLIC_MAPBOX_TOKEN")
    conn = psycopg2.connect(dsn, keepalives=1, keepalives_idle=30)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")
    cur.execute(DDL)

    todo_all = origins(cur, args.limit)
    cur.execute("SELECT DISTINCT origin_type, origin_key, seq FROM lmr.walking_isochrone_origin")
    done = set(cur.fetchall())
    todo = [o for o in todo_all if (o[0], o[1], o[2]) not in done]
    log(f"{len(todo_all):,} origins ({sum(1 for o in todo_all if o[0] == 'station')} stations, "
        f"{sum(1 for o in todo_all if o[0] == 'town_centre'):,} town-centre boundary points); {len(todo):,} to fetch")

    limiter = Limiter(PER_MINUTE)
    lock = threading.Lock()
    t0, n_done, unreachable = time.time(), 0, 0

    def one(o):
        return o, fetch(token, o[3], o[4], limiter)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for fut in as_completed([pool.submit(one, o) for o in todo]):
            (otype, key, seq, lon, lat), res = fut.result()
            rows = []
            for f in res.get("features", []):
                d = int(f["properties"]["contour"])
                rows.append((otype, key, seq, lon, lat, d, json.dumps(f["geometry"])))
            with lock:
                if not rows:
                    unreachable += 1
                    # remember the miss so a re-run does not ask again
                    rows = [(otype, key, seq, lon, lat, d, None) for d in DISTANCES]
                for r in rows:
                    cur.execute("""
                        INSERT INTO lmr.walking_isochrone_origin (origin_type, origin_key, seq, lon, lat, distance_m, geom)
                        VALUES (%s, %s, %s, %s, %s, %s,
                                CASE WHEN %s::text IS NULL THEN NULL
                                     ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4283)), 3)) END)
                        ON CONFLICT DO NOTHING""", (*r[:6], r[6], r[6]))
                n_done += 1
                if n_done % 100 == 0 or n_done == len(todo):
                    rate = n_done / max(time.time() - t0, 1e-9) * 60
                    log(f"  {n_done:,}/{len(todo):,} fetched, {rate:.0f}/min, {unreachable} with no walkable network, "
                        f"eta {(len(todo) - n_done) / max(rate, 1):.1f} min")

    # ── the catchments ───────────────────────────────────────────────────────
    log("building the catchment tables")
    cur.execute("""
        DROP TABLE IF EXISTS lmr.station_walking_catchments;
        CREATE TABLE lmr.station_walking_catchments AS
        SELECT s.station, s.light_rail, o.distance_m, o.geom, o.fetched_at
        FROM lmr.lmr_train_stations s
        JOIN lmr.walking_isochrone_origin o ON o.origin_type = 'station' AND o.origin_key = s.station AND o.geom IS NOT NULL;
        CREATE INDEX ON lmr.station_walking_catchments USING gist (geom);
        COMMENT ON TABLE lmr.station_walking_catchments IS
         '400 m and 800 m walking catchments around the 59 LMR train stations: Mapbox Isochrone API walking isochrones (generalize=0) from each station''s single FOI point in lmr.lmr_train_stations. The Housing SEPP measures from a public entrance, so at large stations the catchment starts a little off. One row per station per distance. Built by nsw-planning-library/scripts/build-lmr-walking.py (cache: lmr.walking_isochrone_origin).';

        DROP TABLE IF EXISTS lmr.town_centre_walking_catchments;
        CREATE TABLE lmr.town_centre_walking_catchments AS
        WITH iso AS (
          SELECT origin_key AS label, distance_m, count(*) AS origins, ST_UnaryUnion(ST_Collect(geom)) AS g, max(fetched_at) AS fetched_at
          FROM lmr.walking_isochrone_origin WHERE origin_type = 'town_centre' AND geom IS NOT NULL
          GROUP BY 1, 2),
        centre AS (
          SELECT label, string_agg(DISTINCT lga_name, ', ') AS lga_name, ST_UnaryUnion(ST_Collect(ST_MakeValid(ST_Force2D(geom)))) AS g
          FROM lmr.sepp_town_centres GROUP BY label)
        SELECT c.label, c.lga_name, i.distance_m, i.origins,
               ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_UnaryUnion(ST_Collect(i.g, c.g))), 3)) AS geom,
               i.fetched_at
        FROM iso i JOIN centre c USING (label);
        CREATE INDEX ON lmr.town_centre_walking_catchments USING gist (geom);
        COMMENT ON TABLE lmr.town_centre_walking_catchments IS
         '400 m and 800 m walking catchments around the Housing SEPP town centres (lmr.sepp_town_centres), measured from the edge: Mapbox Isochrone API walking isochrones (generalize=0) from points every 100 m along every boundary ring of the centre, unioned with each other and the centre itself; centres with the same label are one catchment. One row per centre per distance. Built by nsw-planning-library/scripts/build-lmr-walking.py (cache: lmr.walking_isochrone_origin).';
    """)
    cur.execute("SELECT distance_m, count(*), round((sum(ST_Area(geom::geography))/1e6)::numeric, 1) FROM lmr.station_walking_catchments GROUP BY 1 ORDER BY 1")
    log("stations:", cur.fetchall())
    cur.execute("SELECT distance_m, count(*), sum(origins), round((sum(ST_Area(geom::geography))/1e6)::numeric, 1) FROM lmr.town_centre_walking_catchments GROUP BY 1 ORDER BY 1")
    log("town centres:", cur.fetchall())
    log(f"done in {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
