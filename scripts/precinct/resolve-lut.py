"""Step 6 of docs/precinct-sepp-pipeline.md: the Land Use Tables of a multi-unit instrument, as written and as resolved.

    python -I scripts/precinct/resolve-lut.py            # every rag instrument that carries tables and is not in nsw.lep_zones
    python -I scripts/precinct/resolve-lut.py --dry      # resolve and report, write nothing

What 01D + 01E do for a standard LEP (public.lep_zones -> nsw.lep_permissibility), done for an instrument whose tables
sit in its appendices and chapters: a Precinct SEPP has one table per precinct plan, so a table is keyed by its own
group (zone_id = the group's local id, "app.7-inc-pt-cg1.Zone_R3") and carries the unit it belongs to. The rows go to
two tables of the SAME shape as 01D/01E's, plus unit_local_id / unit_heading:

    nsw.lep_zones_unit            the table as written: objectives and the item 2 / 3 / 4 lines, in document order
    nsw.lep_permissibility_unit   the table resolved: one row per leaf term of the universe, how it got its status

They are separate tables on purpose (progress doc, D4 amended): every legacy reader joins nsw.lep_permissibility on
(epi_name, zone_code), and a SEPP with nine R3 tables would answer those joins nine times over, in prod, with no code
pushed. Nothing here touches nsw.lep_zones or nsw.lep_permissibility.

The resolution is 01E's, read from what 01E left in the database rather than retyped:
  - the universe and the hierarchy of the latest 01E run (nsw.lep_permissibility_universe / _hierarchy): the closed
    vocabulary, parents expanded to leaves transitively, with the chain each leaf came through;
  - explicit > inherited (nearest parent) > catch-all, prohibited winning a tie; parents rolled up from their leaves
    and the plan's own naming of a parent kept beside it (named_status);
  - the residual clause read from the items it names, not the item it sits in; a permission that names a statute or
    "the purpose shown on the Land Zoning Map" kept verbatim.
What 01E cannot do here it does not guess: a listed term outside the universe is written as it is (level 'verbatim',
BASIS_LABEL: "as written, not a Standard Instrument term") - the plan's own Dictionary says whether it defines it - and
every such string is reported to docs/precinct-lut-unmapped.csv for the vocabulary decision (Q3).
"""
import sys, os, re, csv, json, datetime
from collections import defaultdict
import psycopg2

DRY = '--dry' in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split('=', 1) for l in open(os.path.join(ROOT, '.env'), encoding='utf-8').read().splitlines() if '=' in l and not l.startswith('#'))
DB = env['DATABASE_URL'].strip().strip('"').strip("'")
RUN_ID = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')

CATCHALL_PATTERNS = [
    (r'any\s+(?:other\s+)?development\s+not\s+(?:specified|listed)(?:\s+in)?\s+items?\s*2\s*(?:or|and|,)\s*([34])', None),
    (r'any\s+development\s+not\s+specified\s+in\s+permitted\s+categories', '3'),
]
VERBATIM_PATTERNS = [r'^the purpose shown on the land zoning map', r'\bauthorised under the .*\bact\b']
ITEM_HEAD = {'permitted without consent': '2', 'permitted with consent': '3', 'prohibited': '4'}
STATUS_OF = {'2': 'permitted_without_consent', '3': 'permitted_with_consent', '4': 'prohibited'}
CATEGORY_OF = {'2': 'Permitted Without Consent', '3': 'Permitted With Consent', '4': 'Prohibited'}
SEVERITY = {'prohibited': 0, 'permitted_without_consent': 1, 'permitted_with_consent': 2}

def norm(s): return ' '.join(str(s or '').split()).lower()
def canon(s): return norm(s).replace('’', '’').replace("'", '’')   # the universe spells rural workers’ with a curly quote

c = psycopg2.connect(DB); cur = c.cursor()

# ── 01E's universe and hierarchy, latest run ──────────────────────────────────────────────────────────────────────
cur.execute("select max(run_id) from nsw.lep_permissibility_universe"); URUN = cur.fetchone()[0]
cur.execute("select land_use, is_parent from nsw.lep_permissibility_universe where run_id = %s", (URUN,))
UNIVERSE, PARENTS = set(), set()
for u, p in cur.fetchall(): (PARENTS if p else UNIVERSE).add(u)
cur.execute("select parent, child, depth, chain from nsw.lep_permissibility_hierarchy where run_id = (select max(run_id) from nsw.lep_permissibility_hierarchy)")
LEAVES, CHAIN = defaultdict(set), {}
for p, ch, d, chain in cur.fetchall(): LEAVES[p].add(ch); CHAIN[(p, ch)] = chain.split(' > ')
VOCAB = UNIVERSE | PARENTS
# a curly-quote variant of every term, so "rural workers' dwellings" in either spelling is the same term
ALIAS = {}
for t in VOCAB: ALIAS[t.replace('’', "'")] = t; ALIAS[t] = t
print(f"01E run {URUN}: {len(UNIVERSE)} leaf uses, {len(PARENTS)} parents, {sum(len(v) for v in LEAVES.values())} parent->leaf rows")

def leaves(term): return LEAVES[term] if term in PARENTS else {term}
def chain_to(leaf, root): return CHAIN.get((root, leaf)) or [root, leaf]

# ── the instruments: every rag instrument with tables that 01E has not resolved ───────────────────────────────────
# the epicode is the XML's name (nsw.document holds no code); an instrument 01E has resolved is left to 01E
cur.execute("""select i.document_id, i.title, substring(replace(d.raw_path, '\', '/') from 'epi-[0-9]{4}-[0-9]{3,4}[a-z]?') from rag.instrument i join nsw.document d on d.id = i.document_id
               where exists (select 1 from rag.provision p where p.document_id = i.document_id and p.kind = 'group' and p.heading ~ '^Zone ')
                 and not exists (select 1 from nsw.lep_permissibility z where z.epi_name = i.title)""")
INSTS = [r for r in cur.fetchall() if r[2]]
print(f"{len(INSTS)} instrument(s) with Land Use Tables outside nsw.lep_zones: {[s for _, _, s in INSTS]}")

unmapped = []     # (epicode, unit, zone, string, defined_by_plan)
problems = []
zone_rows, perm_rows = [], []

for doc_id, title, epicode in INSTS:
    # the plan's own Dictionary: a term it defines is a term of the plan even when the Standard Instrument has none
    cur.execute("select lower(heading) from rag.provision where document_id = %s and kind = 'term' and heading is not null", (doc_id,))
    DEFINED = {r[0] for r in cur.fetchall()}
    # the zoning map names a zone the heading does not code ("Zone 1 Urban Development" -> UD)
    cur.execute("select distinct lower(lay_class), sym_code from epi.epi_land_zoning where epi_name = %s and sym_code is not null and lay_class is not null", (title,))
    NAMED = dict(cur.fetchall())
    cur.execute("select local_id, heading from nsw.section where document_id = %s and depth = 1", (doc_id,)); UNIT_HEAD = dict(cur.fetchall())
    cur.execute("""select g.id, g.local_id, g.heading from rag.provision g where g.document_id = %s and g.kind = 'group' and g.heading ~ '^Zone '
                   and exists (select 1 from rag.provision k where k.parent_id = g.id and lower(k.heading) in ('permitted without consent','permitted with consent','prohibited')) order by g.sort""", (doc_id,))
    groups = cur.fetchall()
    n_tables = 0
    for gid, glocal, gheading in groups:
        h = ' '.join(gheading.split())
        m = re.match(r'^Zone\s+([A-Z]{1,2}\d{1,2}[A-Z]?)\b\s*(.*)$', h)
        if m: zone_code, zone_name = m.group(1), m.group(2).strip()
        else:
            zone_name = re.sub(r'^Zone\s+\S+\s*', '', h).strip(); zone_code = NAMED.get(zone_name.lower())
            if not zone_code: problems.append((epicode, glocal, 'zone_code_unknown', h)); continue
        unit = glocal.split('-')[0]
        unit_heading = UNIT_HEAD.get(unit)
        cur.execute("select id, lower(heading), coalesce(own_text,''), sort from rag.provision where parent_id = %s order by sort", (gid,))
        items = cur.fetchall()
        ord_ = 0
        cls = []   # (item, kind, excl, source_text)
        for iid, ihead, itext, _ in items:
            if ihead and ihead.startswith('objectives'):
                cur.execute("""with recursive d as (select id, coalesce(own_text,'') t, sort from rag.provision where parent_id = %s
                               union all select p.id, coalesce(p.own_text,''), p.sort from rag.provision p join d on p.parent_id = d.id)
                               select t from d where t <> '' order by sort""", (iid,))
                for (t,) in cur.fetchall():
                    ord_ += 1; zone_rows.append((epicode, glocal, zone_code, zone_name, 'Objective', 'Zone Objective', ' '.join(t.split()), unit, unit_heading, ord_))
                continue
            item = ITEM_HEAD.get(ihead or '')
            if not item: continue
            for line in [x.strip(' .') for x in itext.split(';')]:
                if not line: continue
                ord_ += 1; zone_rows.append((epicode, glocal, zone_code, zone_name, 'Land Use', CATEGORY_OF[item], line, unit, unit_heading, ord_))
                t = norm(line)
                if t == 'nil': continue                      # "Nil": the item lists nothing
                kind, excl = 'use', None
                for rx, fixed in CATCHALL_PATTERNS:
                    mm = re.search(rx, t, re.I)
                    if mm: kind, excl = 'catchall', (fixed or mm.group(1)); break
                if kind == 'use' and any(re.search(rx, t, re.I) for rx in VERBATIM_PATTERNS): kind = 'verbatim'
                cls.append((item, kind, excl, line))
        if not cls: continue
        n_tables += 1
        # ── resolve one table (01E section 5) ────────────────────────────────────────────────────────────────
        claims = defaultdict(list); explicit = {'2': set(), '3': set(), '4': set()}; named = {}; verbatim = []
        for item, kind, excl, src in cls:
            if kind == 'verbatim': verbatim.append((item, src)); continue
            if kind != 'use': continue
            term = ALIAS.get(canon(src)) or ALIAS.get(norm(src))
            if term is None:
                # outside 01E's vocabulary: as written, and reported; the plan's Dictionary says whether it is the plan's own term
                defined = norm(src) in DEFINED or canon(src) in DEFINED or norm(src).rstrip('s') in DEFINED
                unmapped.append((epicode, unit, zone_code, norm(src), defined)); verbatim.append((item, src)); continue
            st = STATUS_OF[item]
            if term in PARENTS:
                prev = named.get(term)
                if prev is None: named[term] = (st, src, False)
                elif prev[0] != st:
                    keep = min((prev[0], st), key=lambda s: SEVERITY[s]); named[term] = (keep, prev[1] if keep == prev[0] else src, True)
            explicit[item] |= leaves(term)
            for lf in leaves(term):
                if lf == term: claims[lf].append((1, 0, st, 'explicit', None, src))
                else:
                    ch = chain_to(lf, term); claims[lf].append((2, len(ch) - 1, st, 'inherited', ' > '.join(ch[:-1]), src))
        cc = [x for x in cls if x[1] == 'catchall']
        if len({x[0] for x in cc}) > 1: problems.append((epicode, glocal, 'circular_residual', 'residual clauses in more than one item')); continue
        for item, _, excl, src in cc:
            excluded = {'2', excl}
            if item in excluded: problems.append((epicode, glocal, 'self_referential', src)); continue
            rest = UNIVERSE - explicit[list(excluded - {item})[0]] - explicit['2']
            for lf in rest: claims[lf].append((3, 0, STATUS_OF[item], 'catchall', norm(src), None))
        if not cc: problems.append((epicode, glocal, 'no_residual_clause', 'explicit lists only'))
        res = {}
        for lf, cl in claims.items():
            cl = sorted(cl, key=lambda x: (x[0], x[1], SEVERITY.get(x[2], 9))); win = cl[0]
            lost = next((x for x in cl[1:] if x[2] != win[2]), None)
            res[lf] = win + ((f"{lost[3]}:{lost[4] or ''} ({lost[2]})" if lost else None),)
        for lf, (rk, dp, st, bs, df, src, lost) in res.items():
            perm_rows.append((epicode, title, glocal, zone_code, zone_name, lf, 'leaf', st, bs, df, dp, lost, src, RUN_ID, None, None, unit, unit_heading))
        for p in PARENTS:
            ls = [res[l][2] for l in leaves(p) if l in res]
            if not ls: continue
            nm = named.get(p)
            perm_rows.append((epicode, title, glocal, zone_code, zone_name, p, 'parent', ls[0] if len(set(ls)) == 1 else 'mixed', 'rolled_up', None, None, None, None, RUN_ID, nm[0] if nm else None, nm[1] if nm else None, unit, unit_heading))
            if nm and nm[2]: problems.append((epicode, glocal, 'named_in_two_items', f"{p}: kept {nm[0]} from {nm[1]!r}"))
        for item, src in verbatim:
            perm_rows.append((epicode, title, glocal, zone_code, zone_name, norm(src), 'verbatim', STATUS_OF[item], 'verbatim', None, 0, None, src, RUN_ID, None, None, unit, unit_heading))
    print(f"  {epicode} {title[:60]}: {n_tables} tables, {len(groups)} zone groups")

by_basis = defaultdict(int)
for r in perm_rows: by_basis[(r[6], r[8])] += 1
print(f"as written: {len(zone_rows)} lines; resolved: {len(perm_rows)} rows " + ', '.join(f"{k[0]}/{k[1]} {v}" for k, v in sorted(by_basis.items())))
print(f"outside the vocabulary: {len(unmapped)} listings, {len({u[3] for u in unmapped})} distinct strings ({sum(1 for u in unmapped if u[4])} listings of terms the plan itself defines)")
print(f"problems: {len(problems)} " + json.dumps(sorted({p[2] for p in problems})))

os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
with open(os.path.join(ROOT, 'docs', 'precinct-lut-unmapped.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['string', 'listings', 'defined_by_plan', 'instruments', 'units'])
    agg = defaultdict(lambda: [0, False, set(), set()])
    for e, u, z, s, d in unmapped: a = agg[s]; a[0] += 1; a[1] = a[1] or d; a[2].add(e); a[3].add(f"{e}:{u}")
    for s, (n, d, es, us) in sorted(agg.items(), key=lambda x: -x[1][0]): w.writerow([s, n, d, '; '.join(sorted(es)), '; '.join(sorted(us))])
if DRY: print('dry run: nothing written'); sys.exit(0)

cur.execute("""create table if not exists nsw.lep_zones_unit (epicode text, zone_id text, zone_code text, zone_name text, land_use_type text, land_use_category text,
               land_use_description text, unit_local_id text, unit_heading text, ord integer)""")
cur.execute("""create table if not exists nsw.lep_permissibility_unit (epicode text, epi_name text, zone_id text, zone_code text, zone_name text, land_use text, level text,
               status text, basis text, derived_from text, inherit_depth integer, resolved_against text, source_text text, run_id text, named_status text, named_source_text text,
               unit_local_id text, unit_heading text)""")
cur.execute("create index if not exists idx_lep_zones_unit_key on nsw.lep_zones_unit (epicode, zone_id)")
cur.execute("create index if not exists idx_lep_perm_unit_key on nsw.lep_permissibility_unit (epicode, zone_id)")
cur.execute("create index if not exists idx_lep_perm_unit_name on nsw.lep_permissibility_unit (epi_name, unit_local_id, zone_code)")
for e in {i[2] for i in INSTS}:
    cur.execute("delete from nsw.lep_zones_unit where epicode = %s", (e,)); cur.execute("delete from nsw.lep_permissibility_unit where epicode = %s", (e,))
from psycopg2.extras import execute_values
execute_values(cur, "insert into nsw.lep_zones_unit values %s", zone_rows, page_size=2000)
execute_values(cur, "insert into nsw.lep_permissibility_unit values %s", perm_rows, page_size=2000)
cur.execute("analyze nsw.lep_zones_unit"); cur.execute("analyze nsw.lep_permissibility_unit")
c.commit()
cur.execute("select count(*) from nsw.lep_zones_unit"); a = cur.fetchone()[0]
cur.execute("select count(*), count(distinct (epicode, zone_id)) from nsw.lep_permissibility_unit"); b = cur.fetchone()
print(f"written: nsw.lep_zones_unit {a} rows; nsw.lep_permissibility_unit {b[0]} rows over {b[1]} tables; run {RUN_ID}")
