"""Does the precinct schema's Land Use Table cover every zone a lot is in?  (docs/precinct-sepp-pipeline.md, step 6 gate)

    python -I scripts/precinct/lut-coverage.py          # report; exit 1 when a governed lot has no table or a table breaks the invariant

Three checks, all measured from the data:
  1. coverage   every (instrument, unit, zone) that derived.lot_instrument puts a governing lot in has a resolved table in
                precinct.lut_permissibility (and the reverse: tables no lot is in, listed for information);
  2. universe   every resolved table has exactly the universe's leaf count (171 in 01E run 20260914-101512) - the same
                invariant 01E's tables hold: a closed or open zone answers every leaf use, by listing, inheritance or the
                residual clause; a table short of it has no residual clause (or a self-referential one);
  3. zones      every zone code a lot carries is a zone the instrument's tables know - a code on the zoning map with no
                table is a map/table mismatch, not a resolver gap.
Writes docs/precinct-lut-coverage.csv (one row per unit x zone with lots: lots, table?, leaves) beside the report.
"""
import sys, os, csv
import psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split('=', 1) for l in open(os.path.join(ROOT, '.env'), encoding='utf-8').read().splitlines() if '=' in l and not l.startswith('#'))
c = psycopg2.connect(env['DATABASE_URL'].strip().strip('"').strip("'")); cur = c.cursor()
short = lambda t: t.replace('State Environmental Planning Policy (Precincts', 'SEPP (').replace(') 2021', ')')

cur.execute("select count(*) from nsw.lep_permissibility_universe where run_id = (select max(run_id) from nsw.lep_permissibility_universe) and not is_parent")
LEAVES = cur.fetchone()[0]
cur.execute("select max(run_id) from precinct.lut_run"); RUN = cur.fetchone()[0]
print(f"precinct.lut run {RUN}; the universe has {LEAVES} leaf uses")

# 1 + 3: every unit x zone with governing lots, against the tables
cur.execute("""
  with lots as (select document_title, unit_local_id, zone, count(*) lots from derived.lot_instrument
                 where governing and document_title in (select distinct epi_name from precinct.lut_permissibility) group by 1, 2, 3),
       tabs as (select epi_name, unit_local_id, zone_code, zone_id, count(*) filter (where level = 'leaf') leaves,
                       count(*) filter (where level = 'verbatim') verbatim from precinct.lut_permissibility group by 1, 2, 3, 4)
  select coalesce(l.document_title, t.epi_name) inst, coalesce(l.unit_local_id, t.unit_local_id) unit, coalesce(l.zone, t.zone_code) zone,
         coalesce(l.lots, 0) lots, t.zone_id, t.leaves, t.verbatim
    from lots l full join tabs t on t.epi_name = l.document_title and t.unit_local_id = l.unit_local_id and t.zone_code = l.zone
   order by 1, 2, 3""")
rows = cur.fetchall()
with_lots = [r for r in rows if r[3] > 0]
missing = [r for r in with_lots if r[4] is None]
no_lots = [r for r in rows if r[3] == 0]
print(f"\n1. coverage: {len(with_lots)} unit x zone combinations hold governing lots; {len(with_lots) - len(missing)} have a resolved table; {len(missing)} do not")
for r in missing: print(f"     MISSING  {short(r[0])} {r[1]} zone {r[2]}: {r[3]} lots, no table")
print(f"   tables no governing lot is in (fine - land the build has not reached, or a zone with no lots): {len(no_lots)}")
for r in no_lots[:12]: print(f"     {short(r[0])} {r[1]} zone {r[2]} ({r[4]})")

# 2: the universe invariant on every table
cur.execute("""select epi_name, unit_local_id, zone_id, count(*) filter (where level = 'leaf') leaves
                 from precinct.lut_permissibility group by 1, 2, 3 having count(*) filter (where level = 'leaf') <> %s order by 1, 2, 3""", (LEAVES,))
broken = cur.fetchall()
cur.execute("select count(distinct (epicode, zone_id)) from precinct.lut_permissibility"); n_tables = cur.fetchone()[0]
print(f"\n2. universe: {n_tables - len(broken)} of {n_tables} tables answer all {LEAVES} leaf uses; {len(broken)} do not")
for e, u, z, n in broken:
    cur.execute("select land_use_description from precinct.lut_zones where epicode = (select epicode from precinct.lut_permissibility where zone_id = %s limit 1) and zone_id = %s and land_use_type = 'Land Use' order by ord", (z, z))
    lines = [x[0] for x in cur.fetchall()]
    residual = [x for x in lines if 'not specified' in x.lower() or 'not listed' in x.lower()]
    print(f"     {short(e)} {u} {z}: {n} leaves - {'no residual clause' if not residual else 'residual: ' + residual[0]}; {len(lines)} lines as written")

# 3: zone codes on lots that no table of the instrument knows at all
cur.execute("""select i.document_title, i.zone, count(*) from derived.lot_instrument i
                where i.governing and i.document_title in (select distinct epi_name from precinct.lut_permissibility)
                  and not exists (select 1 from precinct.lut_permissibility p where p.epi_name = i.document_title and p.zone_code = i.zone)
                group by 1, 2 order by 1, 3 desc""")
unknown = cur.fetchall()
print(f"\n3. zones: {len(unknown)} zone codes on governing lots that no table of their instrument carries")
for t, z, n in unknown: print(f"     {short(t)} zone {z!r}: {n} lots")

with open(os.path.join(ROOT, 'docs', 'precinct-lut-coverage.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['instrument', 'unit', 'zone', 'lots', 'table', 'leaves', 'verbatim'])
    for r in rows: w.writerow([r[0], r[1], r[2], r[3], r[4] or '', r[5] if r[5] is not None else '', r[6] if r[6] is not None else ''])
print(f"\nwritten docs/precinct-lut-coverage.csv ({len(rows)} rows)")
sys.exit(1 if missing or broken else 0)
