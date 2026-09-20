"""Load the LMBC Biodiversity Values Map data pack into the planningai schema `bio_values`.

    python scripts/load-bio-values.py [--zip PATH] [--keep-load-schema]

The server-side pattern of "01A dump-gdal", cut down to one geodatabase: copy the zip to the database
host once and let ogr2ogr there load Postgres over localhost, rather than pushing ~1 GB of geometry up
from a laptop. Same ogr2ogr flags as 01A, so the result matches what the cadastre and epi schemas get -
curves linearised, Z and M dropped, single parts promoted to multi, FID preserved, GiST on geom, COPY
mode.

WHY THE DATA PACK AND NOT THE REST SERVICE

Both describe themselves as version 19.5 of 11 September 2026, and they do not agree:

                                      data pack        service
    features                            600,625        625,779
    riparian Area_GEO total          13,784 km2    1,914,060 km2   (NSW is 800,642 km2)

Per-class vertex totals are within half a percent (littoral rainforest 98,488 against 98,495; the two
AOBV polygons identical at 630), so this is the same mapping either way - the service carries about
25,000 more rows, and they are small: the extra Ramsar and koala rows average ~15 vertices each. The
service's aggregate statistics are the part that cannot be right, which is why the area anomaly seen
while loading from the REST endpoint disappears here. The data pack is also what SEED publishes as the
citable version. The difference is recorded in the table comment rather than smoothed over: it has not
been explained and should be put to LMBC.

WHAT THIS IS NOT

The Biodiversity Values Map is the Biodiversity Offsets Scheme ENTRY map - land where the scheme is
triggered by a clearing or development proposal. Only one of its ten BOSET_Class values, "Declared Area
of Outstanding Biodiversity Value", is an environmentally sensitive area under clause 3.3 of the Codes
SEPP. Nothing built on this schema may treat the other nine as exempt-or-complying-development
exclusions.
"""

import argparse
import os
import shlex
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, unquote

try:
    import paramiko
    import psycopg2
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "paramiko", "psycopg2-binary"], check=True)
    import paramiko
    import psycopg2

SCHEMA = "bio_values"
LOAD = f"{SCHEMA}__load"
GDB = "BV195_Web.gdb"
LAYER = "BiodiversityValues"
FID = "objectid"
REMOTE_DIR = "/root/geodaas"
SSH_HOST, SSH_USER, SSH_PORT = "172.105.184.178", "root", 22
DEFAULT_ZIP = Path(r"C:\Users\manni.kheradmandi\Downloads\biodiversity_biodiversity_values_map_v19p5.zip")

ENV_FILES = [
    Path(r"C:\Users\manni.kheradmandi\OneDrive - COSOL GLOBAL\Notebooks\.env"),
    Path(r"C:\Users\manni.kheradmandi\OneDrive - COSOL GLOBAL\nsw-planning-library\.env"),
]

TABLE_COMMENT = """\
The NSW Biodiversity Values (BV) Map, version 19.5 published 11 September 2026: land of high \
biodiversity value that is sensitive to development and clearing. This is the Biodiversity Offsets \
Scheme ENTRY map - one of the triggers for whether the Offsets Scheme applies to a proposal - and NOT a \
list of clause 3.3 environmentally sensitive areas. Of its ten BOSET_Class values only "Declared Area \
of Outstanding Biodiversity Value" (2 polygons) is a clause 3.3 item; the other nine carry no exempt or \
complying development consequence and must not be applied as exclusions. BV_Category marks the {added} \
polygons added in the last 90 days - during that window a landholder can lodge a development \
application without the BV Map triggering the scheme - so it is a deadline, not a separate dataset. \
Source: the SEED data pack biodiversity_biodiversity_values_map_v19p5.zip ({gdb}, layer {layer}, \
GDA94), {rows} features loaded by ogr2ogr on the database host on {today}. NOT loaded from the REST \
service at https://www.lmbc.nsw.gov.au/arcgis/rest/services/BV/BiodiversityValues/MapServer/0, which \
reports 625,779 features for the same version date - about 25,000 more, and small ones - while its \
aggregate statistics are unusable (it sums biodiverse riparian land to 1.9M km2 against a state of \
800,642 km2). Per-class vertex totals agree to within half a percent, so the mapping is the same; the \
row-count difference is unexplained and is one for LMBC. The map is revised at least four times a year \
and each revision is a new data pack, so check the BV Map webpage for the current version before \
relying on this."""


def log(*a):
    print(f"[{datetime.now():%H:%M:%S}]", *a, flush=True)


def dotenv(key):
    for f in ENV_FILES:
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", type=Path, default=DEFAULT_ZIP)
    ap.add_argument("--keep-load-schema", action="store_true",
                    help="load into bio_values__load but do not swap it into place")
    args = ap.parse_args()
    if not args.zip.exists():
        sys.exit(f"{args.zip} does not exist")

    dsn = os.environ.get("DATABASE_URL") or dotenv("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL not found in the environment or any .env file")
    u = urlsplit(dsn)
    # ogr2ogr runs ON the database host, so it connects over localhost whatever the URL says
    pgc = dict(host="127.0.0.1", port=u.port or 5432, dbname=u.path.lstrip("/"),
               user=unquote(u.username or ""), password=unquote(u.password or ""))

    # how many features the pack actually holds, read here so the load can be reconciled against it
    expected, added = count_source(args.zip)
    log(f"{args.zip.name}: {expected:,} features in {GDB}/{LAYER}, {added:,} added in the last 90 days")

    ssh = connect(dotenv("SSH_PASSWORD"), dotenv("SSH_KEY"))
    try:
        run(ssh, dsn, pgc, args, expected, added)
    finally:
        ssh.close()


def count_source(zp):
    """Feature count and 90-day count from the pack itself, without unzipping it."""
    import warnings
    warnings.filterwarnings("ignore")
    import pyogrio
    src = f"/vsizip/{zp}/{GDB}"
    df = pyogrio.read_dataframe(src, layer=LAYER, read_geometry=False,
                                columns=["BV_Category"], use_arrow=True)
    return len(df), int((df.BV_Category.astype(str).str.contains("90 days")).sum())


def connect(password, key):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kw = dict(hostname=SSH_HOST, port=SSH_PORT, username=SSH_USER, timeout=30)
    if key:
        c.connect(key_filename=key, **kw)
    else:
        c.connect(password=password, **kw)
    return c


def sh(ssh, cmd, raw=False):
    _, out, err = ssh.exec_command(cmd)
    o = out.read()
    e = err.read()
    rc = out.channel.recv_exit_status()
    return (rc, o, e) if raw else (rc, o.decode(errors="replace"), e.decode(errors="replace"))


def run(ssh, dsn, pgc, args, expected, added):
    q = shlex.quote
    rc, o, e = sh(ssh, f"mkdir -p {q(REMOTE_DIR)} && ogr2ogr --version && df -h {q(REMOTE_DIR)} | tail -1")
    if rc:
        sys.exit(f"server check failed: {e}")
    log("server:", o.strip().replace("\n", " | "))

    # ── upload, skipping a file of the same size already there ──────────────────────────────────
    remote = f"{REMOTE_DIR}/{args.zip.name}"
    size = args.zip.stat().st_size
    sftp = ssh.open_sftp()
    try:
        if sftp.stat(remote).st_size == size:
            log(f"already on the server: {args.zip.name} ({size/1e6:.0f} MB)")
        else:
            raise IOError
    except IOError:
        log(f"uploading {args.zip.name} ({size/1e6:.0f} MB)")
        t0, last = time.time(), [0.0]

        def progress(done, total):
            if time.time() - last[0] > 10:
                last[0] = time.time()
                rate = done / max(time.time() - t0, 1e-9)
                log(f"  {done/1e6:.0f}/{total/1e6:.0f} MB, {rate/1e6:.1f} MB/s,"
                    f" eta {(total-done)/max(rate,1)/60:.1f} min")
        sftp.put(str(args.zip), remote, callback=progress)
        log(f"  uploaded in {(time.time()-t0)/60:.1f} min")
    sftp.close()

    # ── ogr2ogr into the load schema, under nohup so a laptop sleep cannot kill it ───────────────
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(f'DROP SCHEMA IF EXISTS "{LOAD}" CASCADE; CREATE SCHEMA "{LOAD}"')

    logfile, pidfile = f"{REMOTE_DIR}/{LOAD}.log", f"{REMOTE_DIR}/{LOAD}.pid"
    src = f"/vsizip/{remote}/{GDB}"
    pg_dsn = f"PG:host={pgc['host']} port={pgc['port']} dbname={pgc['dbname']} user={pgc['user']}"
    cmd = (f"PGPASSWORD={q(pgc['password'])} ogr2ogr -f PostgreSQL {q(pg_dsn)} {q(src)}"
           f" -lco SCHEMA={LOAD} -lco GEOMETRY_NAME=geom -lco FID={FID} -preserve_fid"
           f" -lco SPATIAL_INDEX=GIST"
           f" -nlt CONVERT_TO_LINEAR -nlt PROMOTE_TO_MULTI -dim XY"
           f" --config PG_USE_COPY YES --config OGR_ORGANIZE_POLYGONS ONLY_CCW -progress")
    rc, pid, e = sh(ssh, f"nohup bash -c {q(cmd + '; echo EXIT=$?')} > {q(logfile)} 2>&1 & echo $! | tee {q(pidfile)}")
    pid = pid.strip()
    if not pid:
        sys.exit(f"could not start ogr2ogr: {e}")
    log(f"ogr2ogr started on the server (pid {pid}, log {logfile})")

    t0, pos = time.time(), 0
    while True:
        time.sleep(15)
        rc, chunk, _ = sh(ssh, f"tail -c +{pos + 1} {q(logfile)}", raw=True)
        if chunk:
            pos += len(chunk)
            sys.stdout.write(chunk.decode(errors="replace"))
            sys.stdout.flush()
        _, alive, _ = sh(ssh, f"kill -0 {pid} 2>/dev/null && echo alive || echo done")
        if "done" in alive:
            break
    _, tail, _ = sh(ssh, f"tail -n 3 {q(logfile)}")
    log(f"ogr2ogr finished in {(time.time()-t0)/60:.1f} min: {tail.strip().splitlines()[-1]}")
    if "EXIT=0" not in tail:
        sys.exit(f"ogr2ogr did not exit 0 - {LOAD} left in place for inspection:\n{tail}")

    # ── reconcile before anything is swapped into place ─────────────────────────────────────────
    cur.execute(f'SELECT count(*) FROM "{LOAD}"."{LAYER.lower()}"')
    got = cur.fetchone()[0]
    log(f"{LOAD}.{LAYER.lower()}: {got:,} rows against {expected:,} in the pack")
    if got != expected:
        sys.exit(f"row count does not match the data pack ({got:,} vs {expected:,})"
                 f" - {LOAD} left in place for inspection")

    if args.keep_load_schema:
        log(f"--keep-load-schema: left as {LOAD}, nothing swapped")
        return

    # ── index, comment, swap ────────────────────────────────────────────────────────────────────
    t = f'"{LOAD}"."{LAYER.lower()}"'
    log("indexing…")
    cur.execute(f'CREATE INDEX ON {t} (boset_class)')
    cur.execute(f'CREATE INDEX ON {t} (bv_category)')
    cur.execute(f'ANALYZE {t}')
    cur.execute(f"COMMENT ON TABLE {t} IS %s", (TABLE_COMMENT.format(
        rows=f"{got:,}", added=f"{added:,}", gdb=GDB, layer=LAYER,
        today=datetime.now(timezone.utc).strftime("%Y-%m-%d")),))

    log(f"swapping {LOAD} into {SCHEMA}")
    cur.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
    cur.execute(f'ALTER SCHEMA "{LOAD}" RENAME TO "{SCHEMA}"')

    cur.execute(f'''
        SELECT count(*), count(*) FILTER (WHERE NOT ST_IsValid(geom)),
               sum(ST_NPoints(geom)), min(ST_SRID(geom)), max(ST_SRID(geom)),
               pg_size_pretty(pg_total_relation_size('{SCHEMA}.{LAYER.lower()}'))
        FROM {SCHEMA}.{LAYER.lower()}''')
    n, invalid, verts, srid_lo, srid_hi, sz = cur.fetchone()
    log("")
    log(f"{SCHEMA}.{LAYER.lower()}: {n:,} rows, {int(verts):,} vertices, {invalid:,} invalid, "
        f"SRID {srid_lo}{'' if srid_lo == srid_hi else f'-{srid_hi}'}, {sz}")
    cur.execute(f'''
        SELECT boset_class, count(*), round(sum(area_geo)::numeric / 100, 0)
        FROM {SCHEMA}.{LAYER.lower()} GROUP BY 1 ORDER BY 2 DESC''')
    for cls, k, km2 in cur.fetchall():
        log(f"  {k:>7,}  {str(km2):>10} km2  {cls}")
    conn.close()


if __name__ == "__main__":
    main()
