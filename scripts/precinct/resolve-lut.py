"""Step 6 of docs/precinct-sepp-pipeline.md: the Land Use Tables of a multi-unit instrument, as written and as resolved.

    python -I scripts/precinct/resolve-lut.py            # every rag instrument that carries tables and 01E has not resolved
    python -I scripts/precinct/resolve-lut.py --dry      # resolve and report, write nothing

What 01D + 01E do for a standard LEP (public.lep_zones -> nsw.lep_permissibility), done for an instrument whose tables
sit in its appendices and chapters: a Precinct SEPP has one table per precinct plan, so a table is keyed by its own
provision (zone_id = its local id, "app.7-inc-pt-cg1.Zone_R3") and carries the unit it belongs to. Two drafting forms
are read, both of them the instrument's own words:
  - the Standard Instrument table: a group headed "Zone R3 Medium Density Residential" whose items are headed
    "Permitted without consent" / "Permitted with consent" / "Prohibited" (the growth centre precinct plans);
  - the clause form of the older State significant precinct plans: a clause headed "Zone RE1 Public Recreation" (or
    "General Residential Zone") whose subclauses say "The objectives of ...", "Development for any of the following
    purposes is permitted without consent ...", "... permitted only with consent ...", "... is prohibited ...", with the
    uses listed in the paragraph under each, or inline ("Development for roads is permitted without consent"), or as a
    whole ("development for any purpose may be carried out with consent", "development is prohibited unless ...").
The rows go to schema `precinct`, two tables of the SAME shape as 01D/01E's plus unit_local_id / unit_heading, and a run log:

    precinct.lut_zones            the table as written: objectives and the item 2 / 3 / 4 lines, in document order
    precinct.lut_permissibility   the table resolved: one row per leaf term of the universe, how it got its status
    precinct.lut_unmapped         every listed string outside 01E's vocabulary, per run
    precinct.lut_run              one row per run: when, 01E run used, instruments, tables, rows, problems

They are separate tables on purpose (progress doc, D4 amended): every legacy reader joins nsw.lep_permissibility on
(epi_name, zone_code), and a SEPP with nine R3 tables would answer those joins nine times over, in prod, with no code
pushed. Nothing here touches nsw.lep_zones or nsw.lep_permissibility.

The resolution is 01E's, read from what 01E left in the database rather than retyped:
  - the universe and the hierarchy of the latest 01E run (nsw.lep_permissibility_universe / _hierarchy): the closed
    vocabulary, parents expanded to leaves transitively, with the chain each leaf came through;
  - explicit > inherited (nearest parent) > catch-all, prohibited winning a tie; parents rolled up from their leaves
    and the plan's own naming of a parent kept beside it (named_status);
  - the residual clause read from the items it names, not the item it sits in ("any other development not specified
    in item 2 or 3", "... in subsection (2) or (3)", "Any other development", "development is prohibited unless ...",
    "development for any purpose may be carried out with consent"); a permission that names a statute or "the purpose
    shown on the Land Zoning Map" kept verbatim.
A zone's code is the heading's ("Zone R3"); a heading with no code ("Zone 1 Urban Development", "General Residential
Zone") takes the code the instrument's own zoning map gives that name (UD, R1); a heading whose code the map no longer
draws ("Zone E2 Environmental Conservation" where the map says C2, the 2021 renaming) is keyed by the map's code, the
one a lot carries, with the heading kept in zone_name.
What 01E cannot do here it does not guess: a listed term outside the universe is written as it is (level 'verbatim',
BASIS_LABEL: "as written, not a Standard Instrument term") - the plan's own Dictionary says whether it defines it - and
every such string is reported to precinct.lut_unmapped and docs/precinct-lut-unmapped.csv for the vocabulary decision (Q3).
"""
import sys, os, re, csv, json, datetime
from collections import defaultdict
import psycopg2
from psycopg2.extras import execute_values

DRY = '--dry' in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split('=', 1) for l in open(os.path.join(ROOT, '.env'), encoding='utf-8').read().splitlines() if '=' in l and not l.startswith('#'))
DB = env['DATABASE_URL'].strip().strip('"').strip("'")
RUN_ID = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')

# the residual clause, in the forms the instruments write it: (pattern, the item it excludes - or None when the words
# name it: group 'b' is an item number, or a subsection number the clause form has to translate into its item)
CATCHALL_PATTERNS = [
    (r'any\s+(?:other\s+)?development\s+not\s+(?:otherwise\s+)?(?:specified|listed)(?:\s+in)?\s+(?P<kind>items?|subsections?|subclauses?)\s*\(?(?P<a>\d)\)?\s*(?:or|and|,)\s*\(?(?P<b>\d)\)?', None),
    (r'any\s+(?:other\s+)?development\s+not\s+(?:otherwise\s+)?(?:specified|listed)(?:\s+in)?\s+(?P<kind>item|subsection|subclause)\s*\(?(?P<b>\d)\)?(?!\d)', None),
    (r'any\s+development\s+not\s+specified\s+in\s+permitted\s+categories', '3'),
    (r'^any\s+other\s+development\.?$', '3'),
    (r'^any\s+other\s+development\b.*\bis\s+prohibited', '3'),
    (r'development\s+for\s+any\s+purpose\s+may\s+be\s+carried\s+out\s+(?:only\s+)?with\s+(?:development\s+)?consent', '4'),
    (r'^(?:except\s+as\s+otherwise\s+provided\s+by\s+[^,]+,\s*)?development\s+is\s+permitted\s+(?:only\s+)?with\s+(?:development\s+)?consent\s+on\s+land', '4'),
    (r'development\s+is\s+prohibited\b.*\bunless\b.*?(?P<kind>subsection|subclause|item)s?\s*\(?(?P<b>\d)\)?', None),
]
VERBATIM_PATTERNS = [r'^the purpose shown on the land zoning map', r'\bauthorised under the .*\bact\b', r'\bpermitted by or under the .*\bact\b']
ITEM_HEAD = {'permitted without consent': '2', 'permitted with consent': '3', 'prohibited': '4'}
STATUS_OF = {'2': 'permitted_without_consent', '3': 'permitted_with_consent', '4': 'prohibited'}
CATEGORY_OF = {'2': 'Permitted Without Consent', '3': 'Permitted With Consent', '4': 'Prohibited'}
SEVERITY = {'prohibited': 0, 'permitted_without_consent': 1, 'permitted_with_consent': 2}
ZONE_HEAD = re.compile(r'^Zone\s+([A-Z]{1,2}\d{1,2}[A-Z]?)\b\s*(.*)$')
OBJECTIVES = """with recursive d as (select id, coalesce(own_text,'') t, sort from rag.provision where parent_id = %s
                union all select p.id, coalesce(p.own_text,''), p.sort from rag.provision p join d on p.parent_id = d.id)
                select t from d where t <> '' order by sort"""

def norm(s): return ' '.join(str(s or '').split()).lower()
def canon(s): return norm(s).replace("'", '’')   # the universe spells rural workers’ with a curly quote
def split_list(text):
    parts = re.split(r';', text) if ';' in text else re.split(r',\s*(?![^(]*\))', text)   # commas outside brackets when there is no ";"
    return [x.strip(' .,') for x in parts if x.strip(' .,')]
def dash(s): return re.sub(r'\s*[-\u2013\u2014]\s*', ' - ', norm(s))   # a zone's name with any dash written " - ", as the map writes it

c = psycopg2.connect(DB); cur = c.cursor()

# ── 01E's universe and hierarchy, latest run ──────────────────────────────────────────────────────────────────────
cur.execute("select max(run_id) from nsw.lep_permissibility_universe"); URUN = cur.fetchone()[0]
cur.execute("select land_use, is_parent from nsw.lep_permissibility_universe where run_id = %s", (URUN,))
UNIVERSE, PARENTS = set(), set()
for u, p in cur.fetchall(): (PARENTS if p else UNIVERSE).add(u)
cur.execute("select parent, child, depth, chain from nsw.lep_permissibility_hierarchy where run_id = (select max(run_id) from nsw.lep_permissibility_hierarchy)")
LEAVES, CHAIN = defaultdict(set), {}
for p, ch, d, chain in cur.fetchall(): LEAVES[p].add(ch); CHAIN[(p, ch)] = chain.split(' > ')
ALIAS = {}
for t in UNIVERSE | PARENTS: ALIAS[t.replace('’', "'")] = t; ALIAS[t] = t
print(f"01E run {URUN}: {len(UNIVERSE)} leaf uses, {len(PARENTS)} parents, {sum(len(v) for v in LEAVES.values())} parent->leaf rows")

def leaves(term): return LEAVES[term] if term in PARENTS else {term}
def chain_to(leaf, root): return CHAIN.get((root, leaf)) or [root, leaf]

# ── the instruments: every rag instrument with tables that 01E has not resolved ───────────────────────────────────
cur.execute("""select i.document_id, i.title, substring(replace(d.raw_path, '\\', '/') from 'epi-[0-9]{4}-[0-9]{3,4}[a-z]?') from rag.instrument i join nsw.document d on d.id = i.document_id
               where exists (select 1 from rag.provision p where p.document_id = i.document_id and (p.kind = 'group' and p.heading ~ '^Zone ' or p.kind = 'clause' and p.heading ~* '(^zone\\s|\\szone$|\\mzone\\s*[—–-])'))
                 and not exists (select 1 from nsw.lep_permissibility z where z.epi_name = i.title)""")
INSTS = [r for r in cur.fetchall() if r[2]]
print(f"{len(INSTS)} instrument(s) with Land Use Tables outside nsw.lep_permissibility: {[s for _, _, s in INSTS]}")

unmapped = []     # (epicode, unit, zone, string, defined_by_plan)
problems = []     # (epicode, zone_id, issue, detail)
zone_rows, perm_rows = [], []
stats = defaultdict(int)

def classify(line, ref_item, own_item=None):
    """-> ('catchall', excluded_item) | ('verbatim', None) | ('use', None). ref_item maps a referenced subsection number
    to the item it is (the clause form numbers its subclauses, not its items); a residual that names the item it sits
    in ("not specified in subsection (2) or (4)", sitting in (4)) excludes the other listing item."""
    t = norm(line)
    for rx, fixed in CATCHALL_PATTERNS:
        m = re.search(rx, t, re.I)
        if not m: continue
        if fixed: return 'catchall', fixed
        g = m.groupdict()
        refs = [g[k] for k in ('a', 'b') if g.get(k)]
        if not g.get('kind', 'item').startswith('item'): refs = [ref_item.get(r) for r in refs]   # subsections -> items
        other = {'3': '4', '4': '3'}.get(own_item or '', '3')
        return 'catchall', next((r for r in refs if r and r != '2' and r != own_item), other)
    if any(re.search(rx, t, re.I) for rx in VERBATIM_PATTERNS): return 'verbatim', None
    return 'use', None

def resolve(epicode, title, zone_id, zone_code, zone_name, unit, unit_heading, cls, DEFINED):
    """01E section 5 on one table: cls = [(item, kind, excl, source_text)]"""
    claims = defaultdict(list); explicit = {'2': set(), '3': set(), '4': set()}; named = {}; verbatim = []
    for item, kind, excl, src in cls:
        if kind == 'verbatim': verbatim.append((item, src)); continue
        if kind != 'use': continue
        term = ALIAS.get(canon(src)) or ALIAS.get(norm(src))
        if term is None:
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
    if len({x[0] for x in cc}) > 1: problems.append((epicode, zone_id, 'circular_residual', 'residual clauses in more than one item')); return
    for item, _, excl, src in cc:
        excluded = {'2', excl}
        if item in excluded: problems.append((epicode, zone_id, 'self_referential', src)); continue
        rest = UNIVERSE - explicit[list(excluded - {item})[0]] - explicit['2']
        for lf in rest: claims[lf].append((3, 0, STATUS_OF[item], 'catchall', norm(src), None))
    if not cc: problems.append((epicode, zone_id, 'no_residual_clause', 'explicit lists only'))
    res = {}
    for lf, cl in claims.items():
        cl = sorted(cl, key=lambda x: (x[0], x[1], SEVERITY.get(x[2], 9))); win = cl[0]
        lost = next((x for x in cl[1:] if x[2] != win[2]), None)
        res[lf] = win + ((f"{lost[3]}:{lost[4] or ''} ({lost[2]})" if lost else None),)
    for lf, (rk, dp, st, bs, df, src, lost) in res.items():
        perm_rows.append((epicode, title, zone_id, zone_code, zone_name, lf, 'leaf', st, bs, df, dp, lost, src, RUN_ID, None, None, unit, unit_heading))
    for p in PARENTS:
        ls = [res[l][2] for l in leaves(p) if l in res]
        if not ls: continue
        nm = named.get(p)
        perm_rows.append((epicode, title, zone_id, zone_code, zone_name, p, 'parent', ls[0] if len(set(ls)) == 1 else 'mixed', 'rolled_up', None, None, None, None, RUN_ID, nm[0] if nm else None, nm[1] if nm else None, unit, unit_heading))
        if nm and nm[2]: problems.append((epicode, zone_id, 'named_in_two_items', f"{p}: kept {nm[0]} from {nm[1]!r}"))
    for item, src in verbatim:
        perm_rows.append((epicode, title, zone_id, zone_code, zone_name, norm(src), 'verbatim', STATUS_OF[item], 'verbatim', None, 0, None, src, RUN_ID, None, None, unit, unit_heading))

for doc_id, title, epicode in INSTS:
    cur.execute("select lower(heading) from rag.provision where document_id = %s and kind = 'term' and heading is not null", (doc_id,))
    DEFINED = {r[0] for r in cur.fetchall()}
    cur.execute("select distinct lower(lay_class), sym_code from epi.epi_land_zoning where epi_name = %s and sym_code is not null and lay_class is not null", (title,))
    NAMED = defaultdict(set)          # the map's name for a zone -> the codes it draws under that name (B4 and MU1 are both "Mixed Use" on a half-renamed map)
    for k, v in cur.fetchall(): NAMED[dash(k)].add(v)
    CODE_NAME = {v: k for k, vs in NAMED.items() for v in vs}
    cur.execute("select local_id, heading from nsw.section where document_id = %s and depth = 1", (doc_id,)); UNIT_HEAD = dict(cur.fetchall())
    UNIT_CACHE = {}
    def unit_of(local_id):
        head = local_id.split('-')[0]
        if head in UNIT_HEAD: return head
        if local_id in UNIT_CACHE: return UNIT_CACHE[local_id]
        cur.execute("""with recursive up as (select id, parent_id, local_id, depth from nsw.section where document_id = %s and local_id = %s
                       union all select s.id, s.parent_id, s.local_id, s.depth from nsw.section s join up on s.id = up.parent_id)
                       select local_id from up where depth = 1 limit 1""", (doc_id, local_id.split('-')[0]))
        r = cur.fetchone(); UNIT_CACHE[local_id] = r[0] if r else head
        return UNIT_CACHE[local_id]

    def zone_of(zone_id, heading):
        """-> ([codes], name): the codes a lot in this zone carries, from the heading and the instrument's own zoning map"""
        h = ' '.join(heading.split())
        m = ZONE_HEAD.match(h)
        if m: code, name = m.group(1), m.group(2).strip()
        else:
            # "Zone 1 Urban Development", "General Residential Zone", "Business Zone—Business Park" (the map writes it
            # "Business Zone - Business Park"), "Zone 2 (c)" (the map writes "2(c)"): the map's own name or bare code
            bare = re.sub(r'^Zone\s+', '', h); squeezed = bare.replace(' ', '')
            cands = [h, bare, re.sub(r'^\S+\s+', '', bare), re.sub(r'\s+Zone$', '', bare, flags=re.I)]
            name = next((x for x in cands if dash(x) in NAMED), None)
            if name is None and squeezed in CODE_NAME: name = CODE_NAME[squeezed]; return [squeezed], name
            if name is None: problems.append((epicode, zone_id, 'zone_code_unknown', h)); return [], None
            code = None
        # the codes the map draws under the heading's name: the heading's own code when the map still knows it by that
        # name; a renamed one ("Zone E2 Environmental Conservation" where the map says C2 - the 2021 renaming); both
        # where a half-renamed map has B4 and MU1 as "Mixed Use" - a lot carries any of them, so the table answers each
        by_name = sorted(NAMED.get(dash(name), set()))
        if code and not by_name: return [code], name
        if code and code not in by_name: problems.append((epicode, zone_id, 'zone_code_renamed', f"{code} -> {'/'.join(by_name)} ({name})"))
        return by_name, name

    def emit(zone_id, zone_code, zone_name, unit, objectives, items):
        """items: [(item, [lines], ref_item)] in document order -> the written lines and the resolved table"""
        ord_ = 0
        for t in objectives:
            ord_ += 1; zone_rows.append((epicode, zone_id, zone_code, zone_name, 'Objective', 'Zone Objective', t, unit, UNIT_HEAD.get(unit), ord_))
        cls = []
        for item, lines, ref_item in items:
            for line in lines:
                ord_ += 1; zone_rows.append((epicode, zone_id, zone_code, zone_name, 'Land Use', CATEGORY_OF[item], line, unit, UNIT_HEAD.get(unit), ord_))
                if norm(line) == 'nil': continue                 # "Nil": the item lists nothing
                kind, excl = classify(line, ref_item, item)
                cls.append((item, kind, excl, line))
        if cls:
            stats[epicode] += 1
            resolve(epicode, title, zone_id, zone_code, zone_name, unit, UNIT_HEAD.get(unit), cls, DEFINED)

    # ── form 1: the Standard Instrument table (a group with headed items) ─────────────────────────────────────
    cur.execute("""select g.id, g.local_id, g.heading from rag.provision g where g.document_id = %s and g.kind = 'group' and g.heading ~ '^Zone '
                   and exists (select 1 from rag.provision k where k.parent_id = g.id and lower(k.heading) in ('permitted without consent','permitted with consent','prohibited')) order by g.sort""", (doc_id,))
    for gid, glocal, gheading in cur.fetchall():
        zone_codes, zone_name = zone_of(glocal, gheading)
        if not zone_codes: continue
        cur.execute("select id, lower(heading), coalesce(own_text,'') from rag.provision where parent_id = %s order by sort", (gid,))
        objectives, items = [], []
        for iid, ihead, itext in cur.fetchall():
            if ihead and ihead.startswith('objectives'):
                cur.execute(OBJECTIVES, (iid,)); objectives += [' '.join(t.split()) for (t,) in cur.fetchall()]
            elif ITEM_HEAD.get(ihead or ''): items.append((ITEM_HEAD[ihead], split_list(itext), {}))
        for i, zone_code in enumerate(zone_codes): emit(glocal if i == 0 else f"{glocal}~{zone_code}", zone_code, zone_name, unit_of(glocal), objectives, items)

    # ── form 2: the clause form (a clause headed by the zone, subclauses that say what is permitted) ──────────
    cur.execute("""select p.id, p.local_id, p.heading from rag.provision p where p.document_id = %s and p.kind = 'clause' and p.heading ~* '(^zone\\s|\\szone$|\\mzone\\s*[—–-])' and p.heading !~* '^(zone objectives|zones? indicated|land use zones|how land is zoned|development near zone)'
                   and (exists (select 1 from rag.provision k where k.parent_id = p.id and k.kind = 'subclause' and coalesce(k.own_text,'') ~* '(permitted|allowed|prohibited|may be carried out)')
                        or exists (select 1 from rag.provision k join rag.provision s on s.id = k.parent_id where s.parent_id = p.id and s.kind = 'subclause' and k.kind = 'paragraph' and coalesce(k.own_text,'') ~* '(permitted|allowed|prohibited|may be carried out)'))
                   order by p.sort""", (doc_id,))
    for cid, clocal, cheading in cur.fetchall():
        zone_codes, zone_name = zone_of(clocal, cheading)
        if not zone_codes: continue
        cur.execute("select id, local_id, coalesce(own_text,'') from rag.provision where parent_id = %s and kind = 'subclause' order by sort", (cid,))
        subs = cur.fetchall()
        def item_of(t):
            if re.search(r'(?:permitted|allowed) without (?:development )?consent', t): return '2'
            if re.search(r'(?:permitted|allowed) (?:only )?with (?:development )?(?:the )?consent|may be carried out (?:only )?with (?:development )?consent', t): return '3'
            if 'prohibited' in t: return '4'
            return None
        if not any(item_of(norm(lead)) for _, _, lead in subs):
            # the items sit one level down, as paragraphs of a subclause that only names the zone ("In the Urban zone—")
            cur.execute("""select k.id, k.local_id, coalesce(k.own_text,'') from rag.provision k join rag.provision s on s.id = k.parent_id
                           where s.parent_id = %s and s.kind = 'subclause' and k.kind = 'paragraph' order by s.sort, k.sort""", (cid,))
            deeper = cur.fetchall()
            if any(item_of(norm(t)) for _, _, t in deeper): subs = [x for x in subs if norm(x[2]).startswith('the objectives')] + deeper
        ref_item = {slocal.rsplit('ssec.', 1)[-1].rsplit('.', 1)[-1]: item_of(norm(lead)) for _, slocal, lead in subs if item_of(norm(lead))}
        objectives, items = [], []
        for sid, slocal, lead in subs:
            t = norm(lead)
            if t.startswith('the objectives'):
                cur.execute(OBJECTIVES, (sid,)); objectives += [' '.join(x.split()) for (x,) in cur.fetchall()]; continue
            item = item_of(t)
            if not item: continue
            cur.execute(OBJECTIVES, (sid,))
            listed = split_list('; '.join(' '.join(x.split()) for (x,) in cur.fetchall()))
            before, _, tail = lead.partition('—')
            if tail.strip() and re.search(r'(following purposes|the following|as follows)\s*$', norm(before)): listed = split_list(' '.join(tail.split())) + listed
            if not listed:
                # the sentence is the rule: a whole-zone residual ("development for any purpose may be carried out with
                # consent", "development is prohibited unless ... subsection (2)") is kept as one line for classify(); an
                # inline list ("Development for roads and drainage is permitted without consent") is split into its uses
                m = re.match(r'(?:except as otherwise provided by [^,]+,\s*)?development for (?:the purposes? of )?(.+?)\s+(?:is|are|may be)\s+(?:permitted|carried out|prohibited)', t)
                if classify(t, ref_item, item)[0] == 'catchall': listed = [' '.join(lead.split())]
                elif m and 'any of the following' not in m.group(1): listed = split_list(re.sub(r',\s*|\s+and\s+|\s+or\s+', '; ', m.group(1)))
                else: continue
            items.append((item, listed, ref_item))
        if len({it for it, _, _ in items}) < 2 and not any(classify(l, ref_item, it)[0] == 'catchall' for it, ls, _ in items for l in ls):
            problems.append((epicode, clocal, 'not_a_table', cheading)); continue
        for i, zone_code in enumerate(zone_codes): emit(clocal if i == 0 else f"{clocal}~{zone_code}", zone_code, zone_name, unit_of(clocal), objectives, items)
    print(f"  {epicode} {title[:60]}: {stats[epicode]} tables")

by_basis = defaultdict(int)
for r in perm_rows: by_basis[(r[6], r[8])] += 1
print(f"as written: {len(zone_rows)} lines; resolved: {len(perm_rows)} rows " + ', '.join(f"{k[0]}/{k[1]} {v}" for k, v in sorted(by_basis.items())))
print(f"outside the vocabulary: {len(unmapped)} listings, {len({u[3] for u in unmapped})} distinct strings ({sum(1 for u in unmapped if u[4])} listings of terms the plan itself defines)")
pc = defaultdict(int)
for p in problems: pc[p[2]] += 1
print(f"problems: {dict(pc)}")

with open(os.path.join(ROOT, 'docs', 'precinct-lut-unmapped.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['string', 'listings', 'defined_by_plan', 'instruments', 'units'])
    agg = defaultdict(lambda: [0, False, set(), set()])
    for e, u, z, s, d in unmapped: a = agg[s]; a[0] += 1; a[1] = a[1] or d; a[2].add(e); a[3].add(f"{e}:{u}")
    for s, (n, d, es, us) in sorted(agg.items(), key=lambda x: -x[1][0]): w.writerow([s, n, d, '; '.join(sorted(es)), '; '.join(sorted(us))])
if DRY: print('dry run: nothing written'); sys.exit(0)

cur.execute("create schema if not exists precinct")
cur.execute("""create table if not exists precinct.lut_zones (epicode text, zone_id text, zone_code text, zone_name text, land_use_type text, land_use_category text,
               land_use_description text, unit_local_id text, unit_heading text, ord integer)""")
cur.execute("""create table if not exists precinct.lut_permissibility (epicode text, epi_name text, zone_id text, zone_code text, zone_name text, land_use text, level text,
               status text, basis text, derived_from text, inherit_depth integer, resolved_against text, source_text text, run_id text, named_status text, named_source_text text,
               unit_local_id text, unit_heading text)""")
cur.execute("create table if not exists precinct.lut_unmapped (run_id text, epicode text, unit_local_id text, zone_code text, string text, defined_by_plan boolean)")
cur.execute("""create table if not exists precinct.lut_run (run_id text primary key, ran_at timestamptz, universe_run text, instruments text[], tables integer,
               lines integer, rows integer, unmapped_strings integer, problems jsonb)""")
cur.execute("create index if not exists idx_precinct_lut_zones_key on precinct.lut_zones (epicode, zone_id)")
cur.execute("create index if not exists idx_precinct_lut_perm_key on precinct.lut_permissibility (epicode, zone_id)")
cur.execute("create index if not exists idx_precinct_lut_perm_name on precinct.lut_permissibility (epi_name, unit_local_id, zone_code)")
cur.execute("create index if not exists idx_precinct_lut_perm_use on precinct.lut_permissibility (land_use)")
for e in {i[2] for i in INSTS}:
    cur.execute("delete from precinct.lut_zones where epicode = %s", (e,)); cur.execute("delete from precinct.lut_permissibility where epicode = %s", (e,))
execute_values(cur, "insert into precinct.lut_zones values %s", zone_rows, page_size=2000)
execute_values(cur, "insert into precinct.lut_permissibility values %s", perm_rows, page_size=2000)
execute_values(cur, "insert into precinct.lut_unmapped values %s", [(RUN_ID, e, u, z, s_, d) for e, u, z, s_, d in unmapped], page_size=2000)
cur.execute("insert into precinct.lut_run values (%s, now(), %s, %s, %s, %s, %s, %s, %s)",
            (RUN_ID, URUN, sorted({i[2] for i in INSTS}), len({(r[0], r[2]) for r in perm_rows}), len(zone_rows), len(perm_rows), len({u[3] for u in unmapped}), json.dumps(problems)))
cur.execute("analyze precinct.lut_zones"); cur.execute("analyze precinct.lut_permissibility")
c.commit()
cur.execute("select count(*) from precinct.lut_zones"); a = cur.fetchone()[0]
cur.execute("select count(*), count(distinct (epicode, zone_id)) from precinct.lut_permissibility"); b = cur.fetchone()
print(f"written: precinct.lut_zones {a} rows; precinct.lut_permissibility {b[0]} rows over {b[1]} tables; run {RUN_ID}")
