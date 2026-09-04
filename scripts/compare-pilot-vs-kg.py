"""
Compare the LEP Part 4 pilot store against the production KG, to decide what
can be reused and what would be lost by a reload. Read-only on both.

Usage: python scripts/compare-pilot-vs-kg.py
"""
import os
import re
import sqlite3
import sys

SQLITE = r"C:\Users\manni.kheradmandi\OneDrive - COSOL GLOBAL\Notebooks\Data\lep_part4\lep_store.sqlite"

# DATABASE_URL out of .env, without adding a dependency.
url = os.environ.get("DATABASE_URL", "")
if not url:
    try:
        for line in open(".env", encoding="utf-8"):
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
                break
    except OSError:
        pass

con = sqlite3.connect(SQLITE)
con.row_factory = sqlite3.Row

pilot = {}
for r in con.execute("SELECT epi_id, epi_name, lga FROM land_application"):
    pilot[r["epi_name"].strip()] = {"epi_id": r["epi_id"], "lga": r["lga"]}

print("=" * 74)
print("LEP Part 4 pilot — coverage per LEP")
print("=" * 74)
print(f"  {'epi_id':16} {'LEP':44} {'rules':>6} {'effects':>8} {'applic':>7} {'spatial':>8}")
for name, meta in sorted(pilot.items(), key=lambda kv: kv[1]["epi_id"]):
    e = meta["epi_id"]
    n = lambda t, w="epi_id=?": con.execute(
        f"SELECT count(*) FROM {t} WHERE {w}", (e,)).fetchone()[0]
    print(f"  {e:16} {name[:43]:44} {n('rule'):>6} {n('rule_effect'):>8} "
          f"{n('rule_applicability'):>7} {n('spatial_ref'):>8}")

# What does the pilot hold for Hornsby specifically?
horn = [m["epi_id"] for nm, m in pilot.items() if "Hornsby" in nm]
if horn:
    e = horn[0]
    print(f"\nHornsby ({e}) — what the pilot already knows:")
    for tbl in ("rule", "rule_effect", "rule_applicability", "rule_edge",
                "spatial_ref", "objective", "proposition", "numeric"):
        try:
            c = con.execute(f"SELECT count(*) FROM {tbl} WHERE epi_id=?", (e,)).fetchone()[0]
            print(f"    {tbl:22} {c:6}")
        except sqlite3.Error:
            pass
    print("\n  sample rules:")
    for r in con.execute(
        "SELECT clause, kind, role, precedence FROM rule WHERE epi_id=? "
        "ORDER BY clause LIMIT 8", (e,)):
        print(f"    cl {str(r['clause']):8} {str(r['kind']):20} {str(r['role'] or ''):24} p={r['precedence']}")

con.close()

# ── production side ────────────────────────────────────────────────────
if not url:
    print("\n(DATABASE_URL not set — skipping the production comparison)")
    sys.exit(0)

try:
    import psycopg
    conn = psycopg.connect(url)
except ImportError:
    print("\n(psycopg not installed — production side compared from the known inventory instead)")
    prod_leps = [
        "Albury Local Environmental Plan 2010",
        "Georges River Local Environmental Plan 2021",
        "Liverpool Local Environmental Plan 2008",
        "Parramatta Local Environmental Plan 2023",
        "Randwick Local Environmental Plan 2012",
        "Sydney Local Environmental Plan 2012",
    ]
    conn = None
except Exception as ex:
    print(f"\n(could not connect: {ex})")
    sys.exit(0)

if conn is not None:
    with conn.cursor() as cur:
        cur.execute("SELECT title FROM nsw.document WHERE doc_type='lep' ORDER BY title")
        prod_leps = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT doc_type, count(*) FROM nsw.document GROUP BY 1 ORDER BY 1")
        by_type = cur.fetchall()
    conn.close()
    print("\nproduction documents by type: "
          + ", ".join(f"{t}={n}" for t, n in by_type))

norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()
pilot_names = {norm(n) for n in pilot}
prod_names = {norm(n) for n in prod_leps}

print("\n" + "=" * 74)
print("overlap")
print("=" * 74)
both = pilot_names & prod_names
only_pilot = pilot_names - prod_names
only_prod = prod_names - pilot_names
print(f"  in BOTH          ({len(both)}): " + "; ".join(sorted(both)) or "  none")
print(f"  pilot ONLY       ({len(only_pilot)}): " + "; ".join(sorted(only_pilot)))
print(f"  production ONLY  ({len(only_prod)}): " + "; ".join(sorted(only_prod)))
print("\n  ^ 'production ONLY' plus every SEPP and DCP is what a reload would destroy:")
print("    the pilot covers Parts 4-6 of LEPs only — no SEPPs, no DCPs, no whole documents.")
