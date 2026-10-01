"""Copy notebook 24's walking isochrones from UrbanPortalDBP into the planningai schema `access`.

    python scripts/copy-accessible-area.py [--dry]

The app reads only planningai, and the accessible area is built on the other box: "24 - Accessible Area -
Bus & Train Buffers", cell 4b, fetches one Mapbox walking isochrone per stop and caches it in
urbanportaldbp._iso_train (800 m, operational stations incl. light rail stops) and urbanportaldbp._iso_bus
(400 m, every GTFS boarding point; stops whose isochrone failed fall back to a 400 m circle, method
'buffer_fallback'). Those two caches are the source here rather than accessible_area, because they carry
the method column and nothing the dissolve step added.

Re-run after notebook 24 is re-run. The copy is a full replace inside one transaction.

WHAT THE LAYER IS NOT

The Housing SEPP's accessible area (Schedule 10 Dictionary) counts a bus stop only if it has at least one
bus an hour 6am-9pm weekdays and 8am-6pm weekends, and also counts Sydney Ferries wharves. These
isochrones include every boarding point and no wharves, so a lot reached ONLY by a bus isochrone is
"accessible if that stop meets the frequency test", never simply accessible.

Streams COPY from psql on the UrbanPortalDBP host over SSH (root, PIPELINE_SSH_PASSWORD) straight into
COPY FROM on planningai (DATABASE_URL); both read from the library .env, never written here.
"""

import argparse
import io
import sys
import time
from pathlib import Path

try:
    import paramiko
    import psycopg2
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "paramiko", "psycopg2-binary"], check=True)
    import paramiko
    import psycopg2

ROOT = Path(__file__).resolve().parent.parent
SOURCE_HOST = "172.105.183.89"
SCHEMA = "access"
TABLES = {
    # planningai table   <- UrbanPortalDBP table, walking metres
    "iso_train": ("urbanportaldbp._iso_train", 800),
    "iso_bus": ("urbanportaldbp._iso_bus", 400),
}


def env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def fetch(ssh: paramiko.SSHClient, source: str) -> bytes:
    """The source table as COPY text: source_id, source_name, method, hex EWKB geometry."""
    sql = f"COPY (SELECT source_id, source_name, method, geometry FROM {source}) TO STDOUT"
    cmd = f"sudo -u postgres psql -X -q -d UrbanPortalDBP -c \"{sql}\""
    _, out, err = ssh.exec_command(cmd, timeout=600)
    data = out.read()
    status = out.channel.recv_exit_status()
    if status != 0:
        raise RuntimeError(f"psql on {SOURCE_HOST} failed for {source}: {err.read().decode()[:500]}")
    return data


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="fetch and count, write nothing")
    args = ap.parse_args()
    e = env()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SOURCE_HOST, username="root", password=e["PIPELINE_SSH_PASSWORD"],
                look_for_keys=False, allow_agent=False, timeout=30)
    payloads = {}
    try:
        for table, (source, metres) in TABLES.items():
            t0 = time.time()
            payloads[table] = fetch(ssh, source)
            rows = payloads[table].count(b"\n")
            print(f"  {source}: {rows:,} rows, {len(payloads[table]) / 1e6:.1f} MB in {time.time() - t0:.0f}s")
    finally:
        ssh.close()
    if args.dry:
        return

    conn = psycopg2.connect(e["DATABASE_URL"])
    try:
        with conn, conn.cursor() as cur:
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
            for table, (source, metres) in TABLES.items():
                cur.execute(f"DROP TABLE IF EXISTS {SCHEMA}.{table}")
                cur.execute(f"""
                    CREATE TABLE {SCHEMA}.{table} (
                      source_id   text PRIMARY KEY,
                      source_name text,
                      method      text,
                      walk_m      integer NOT NULL DEFAULT {metres},
                      geom        geometry(Polygon, 4326) NOT NULL)""")
                cur.copy_expert(
                    f"COPY {SCHEMA}.{table} (source_id, source_name, method, geom) FROM STDIN",
                    io.BytesIO(payloads[table]))
                cur.execute(f"CREATE INDEX ON {SCHEMA}.{table} USING gist (geom)")
                cur.execute(f"ANALYZE {SCHEMA}.{table}")
                cur.execute(f"""COMMENT ON TABLE {SCHEMA}.{table} IS %s""", (
                    f"{metres} m Mapbox walking isochrones, one per stop, copied from UrbanPortalDBP {source} "
                    f"(notebook 24, cell 4b) by scripts/copy-accessible-area.py on {time.strftime('%Y-%m-%d')}. "
                    + ("Every GTFS boarding point: NO bus-frequency filter, so not the Housing SEPP accessible "
                       "area on its own." if table == "iso_bus" else
                       "Operational stations incl. light rail stops; no Sydney Ferries wharves."),))
                cur.execute(f"SELECT count(*), count(*) FILTER (WHERE method <> 'isochrone') FROM {SCHEMA}.{table}")
                n, fallback = cur.fetchone()
                print(f"  {SCHEMA}.{table}: {n:,} rows ({fallback:,} circle fallbacks)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
