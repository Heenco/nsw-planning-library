"""Step 8 of docs/precinct-sepp-pipeline.md: answer keys for the four Precinct SEPPs.

    python -I scripts/precinct/answer-keys.py            # writes tests/answer-keys/precincts-<slug>-2021.json
    python -I scripts/precinct/answer-keys.py --record   # and records the current answers beside each expectation

For every instrument: the six baseline lots that fall in it, plus up to 10 governing lots per unit KIND (a growth
centre precinct plan, a State significant site, a chapter), with:
  - the expected unit (what derived.lot_instrument says, which steps 2-3 verified by hand on the baseline lots),
  - for a unit with a Land Use Table: the status of dual occupancies, secondary dwellings and seniors housing in the
    lot's zone, read from the instrument's own XML - an explicit row, a listed parent (nsw.lep_permissibility_hierarchy),
    or the catch-all item - with the table text quoted beside it,
  - for a unit without one: null (not decidable from a table; the sentence rules of step 9 answer there),
  - the mapped height band at the lot's point (epi.epi_height_of_building, the instrument's own layer).
The current answers (--record) come from /api/report/standards (governing) and /api/rules/at (the verdict), so a
later run can say what changed. Nothing here names an instrument.
"""
import sys, os, re, json, random, base64, urllib.request, xml.etree.ElementTree as ET
import psycopg2

RECORD = '--record' in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env = dict(l.split('=', 1) for l in open(os.path.join(ROOT, '.env'), encoding='utf-8').read().splitlines() if '=' in l and not l.startswith('#'))
DB = env['DATABASE_URL'].strip().strip('"').strip("'")
PW = env.get('NUXT_APP_PASSWORD', '').strip().strip('"')
USES = ['dual occupancies', 'secondary dwellings', 'seniors housing']
BASELINE = {'173688603': 'The Ponds (CRC, Alex Avenue and Riverstone, R2)', '183806086': 'Austral (WPC, Liverpool Growth Centres, R2)',
            '101874531': 'Luddenham (WPC, Aerotropolis, SP2)', '104226091': 'Gosford (Regional, Gosford city centre, B3)',
            '102043114': 'Olympic Park (CRC, SSP Sydney Olympic Park, C2)', '102531074': 'Normanhurst (EHC, SSP Wahroonga Estate, R2)'}
random.seed(20261015)

c = psycopg2.connect(DB); cur = c.cursor()
cur.execute("select parent, child from nsw.lep_permissibility_hierarchy")
PARENTS = {}
for p, ch in cur.fetchall(): PARENTS.setdefault(ch.lower(), set()).add(p.lower())

def dictionary_parents(doc_id):
    """the instrument's own group terms ("residential accommodation ... includes any of the following- (a) attached
    dwellings, ..."), as the claims reader reads them: member -> {group, group's groups}. nsw.lep_permissibility_hierarchy
    is 01E's older list (no seniors housing under residential accommodation; dual occupancies only as its two kinds), so
    the Dictionary is read first and the hierarchy fills in behind it."""
    cur.execute("select lower(heading), own_text from rag.provision where document_id = %s and kind = 'term' and heading is not null and own_text ~* 'any of the following'", (doc_id,))
    groups = {}
    for head, body in cur.fetchall():
        tail = re.split(r'but does not include', re.sub(r'\s+Note\.?\s.*$', '', body or ''), flags=re.I)[0]
        m = re.search(r'any of the following\s*[—:-]?\s*(.*)$', tail, flags=re.I | re.S)
        if not m: continue
        members = [re.sub(r'[,;.]?\s*(?:or|and)?\s*$', '', x.strip(), flags=re.I).lower() for x in re.findall(r'\([a-z]{1,3}\)\s*(.+?)(?=\s*\([a-z]{1,3}\)\s|$)', m.group(1), flags=re.S)]
        if members: groups[head] = [re.sub(r'\s+', ' ', x) for x in members if x]
    out = {}
    for g, ms in groups.items():
        for mem in ms:
            todo, seen = [g], set()
            while todo:
                x = todo.pop()
                if x in seen: continue
                seen.add(x); out.setdefault(mem, set()).add(x)
                todo += [gg for gg, mms in groups.items() if x in mms]
    return out

def txt(e): return re.sub(r'\s+', ' ', ''.join(e.itertext())).strip()

def tables(xml_path):
    """{(unit, zone): {'permitted_without_consent': [...], 'permitted_with_consent': [...], 'prohibited': [...]}}"""
    root = ET.fromstring(re.sub(r'<!DOCTYPE[^>]*>', '', open(xml_path, encoding='utf-8').read(), count=1))
    parent = {ch: p for p in root.iter() for ch in p}
    out = {}
    for g in root.iter('level'):
        if g.get('type') != 'clausegroup' or 'Zone_' not in (g.get('id') or ''): continue
        x = g
        while x is not None and not (x.tag == 'level' and x.get('type') in ('chapter', 'schedule') and (x.get('id') or '').count('-') == 0): x = parent.get(x)
        unit = x.get('id') if x is not None else None
        zone = re.search(r'Zone_([A-Za-z0-9()]+)', g.get('id')).group(1).upper()
        items = {}
        for cl in g.iter('level'):
            if cl.get('type') != 'clause': continue
            hd = cl.find('head'); h = (txt(hd.find('heading')) if hd is not None and hd.find('heading') is not None else '').lower().rstrip('.')
            key = {'permitted without consent': 'permitted_without_consent', 'without development consent': 'permitted_without_consent',
                   'permitted with consent': 'permitted_with_consent', 'only with development consent': 'permitted_with_consent',
                   'prohibited': 'prohibited'}.get(h)
            if not key: continue
            items[key] = [re.sub(r'\s+', ' ', s).strip(' .').lower() for s in re.split(r';', ' ; '.join(txt(t) for t in cl.iter('txt'))) if s.strip(' .')]
        if items: out[(unit, zone)] = items
    return out

def status(items, use, parents=None):
    """the use's status in one zone table: explicit, a listed parent (the instrument's Dictionary, then 01E's hierarchy;
    a use the table splits into kinds - dual occupancies (attached) - inherits through its kinds), else the catch-all"""
    use = use.lower(); parents = parents or {}
    fam = {use} | parents.get(use, set()) | PARENTS.get(use, set())
    for kind_, ps in list(parents.items()) + list(PARENTS.items()):
        if kind_.startswith(use + ' ('): fam |= ps
    for key in ('permitted_without_consent', 'permitted_with_consent', 'prohibited'):
        for row in items.get(key, []):
            if row == use: return key, 'explicit', row
    for key in ('permitted_without_consent', 'permitted_with_consent', 'prohibited'):
        for row in items.get(key, []):
            if row in fam: return key, f'inherited from "{row}"', row
    for key in ('prohibited', 'permitted_with_consent'):
        for row in items.get(key, []):
            if re.match(r'any (other )?development not (otherwise )?specified', row): return key, 'catch-all', row
    return None, 'no row and no catch-all', None

def api(path):
    if not PW: return None
    try:
        req = urllib.request.Request('http://localhost:3000' + path, headers={'Authorization': 'Basic ' + base64.b64encode(f'x:{PW}'.encode()).decode()})
        return json.loads(urllib.request.urlopen(req, timeout=180).read())
    except Exception as e:
        return {'error': str(e)[:120]}

cur.execute("select id, title, instrument_slug from nsw.document where title like 'State Environmental Planning Policy (Precincts%' order by title")
for doc, title, slug in cur.fetchall():
    code = {'Central River City': '0725', 'Eastern Harbour City': '0726', 'Regional': '0727', 'Western Parkland City': '0728'}[re.search(r'Precincts.(.*?)\) 2021', title).group(1)]
    short = 'precincts-' + re.search(r'Precincts.(.*?)\) 2021', title).group(1).lower().replace(' ', '-') + '-2021'
    T = tables(os.path.join(ROOT, 'public', 'EPI', 'SEPP', f'epi-2021-{code}_2026-10-15.xml'))
    cur.execute("select document_id from rag.instrument where title = %s", (title,)); rr = cur.fetchone()
    DP = dictionary_parents(rr[0]) if rr else {}
    cur.execute("select local_id, heading from nsw.section where document_id=%s and depth=1", (doc,)); heads = dict(cur.fetchall())
    def kind(u):
        h = heads.get(u) or ''
        return 'precinct_plan' if re.search(r'Precincts? Plan', h) else 'ssp_site' if re.search(r'State significant precinct', h) else 'chapter' if u.startswith('ch.') else 'schedule'
    # lots: the baseline ones in this instrument, then up to 10 governing lots per unit kind, residential zones first
    # the lots keyed last time stay keyed (their recorded answers stay comparable); the baseline lots; then a fresh sample
    prev_path = os.path.join(ROOT, 'tests', 'answer-keys', f'{short}.json')
    prev_ids = [c['cadid'] for c in json.load(open(prev_path, encoding='utf-8')).get('cases', [])] if os.path.exists(prev_path) else []
    cur.execute("select cadid, unit_local_id, unit_heading, unit_basis, zone from derived.lot_instrument where governing and document_title=%s and cadid = any(%s)", (title, list(BASELINE) + prev_ids))
    picked = {r[0]: r for r in cur.fetchall()}
    for k in ('precinct_plan', 'ssp_site', 'chapter'):
        cur.execute("""select cadid, unit_local_id, unit_heading, unit_basis, zone from derived.lot_instrument tablesample system (5)
                       where governing and document_title=%s and unit_local_id is not null and zone ~ '^(R[1-5]|B[1-4]|E[1-4]|MU1|SP[1-4]|C[1-4]|IN[1-2]|RU[1-6])$'""", (title,))
        rows = [r for r in cur.fetchall() if kind(r[1]) == k and r[0] not in picked]
        random.shuffle(rows)
        rows.sort(key=lambda r: 0 if r[4].startswith('R') else 1)
        have_k = sum(1 for r in picked.values() if kind(r[1]) == k and r[0] not in BASELINE)
        for r in rows[:max(0, 10 - have_k)]: picked[r[0]] = r
    cases = []
    for cadid, unit, heading, basis, zone in picked.values():
        cur.execute("""select h.max_b_h from epi.epi_height_of_building h, cadastre.lot l where l.cadid=%s and h.epi_name=%s
                       and h.geom && st_pointonsurface(l.geom) and st_intersects(h.geom, st_pointonsurface(l.geom)) order by h.max_b_h limit 1""", (cadid, title))
        hrow = cur.fetchone()
        items = T.get((unit, zone))
        perm = {}
        for use in USES:
            if items is None: perm[use] = {'status': None, 'basis': 'no Land Use Table in this unit (sentence rules, step 9)', 'row': None}
            else:
                st, basis_, row = status(items, use, DP); perm[use] = {'status': st, 'basis': basis_, 'row': row}
        case = {'name': BASELINE.get(cadid, f'{heading} {zone}'), 'cadid': cadid, 'zone': zone,
                'expect': {'unit': unit, 'unitHeading': heading, 'unitKind': kind(unit), 'unitBasis': basis,
                           'frames': {f'{short}:{unit}': True},
                           'permissibility': perm,
                           'heightMapM': float(hrow[0]) if hrow and hrow[0] is not None else None}}
        if RECORD:
            std = api(f'/api/report/standards?cadid={cadid}&precinct=1') or {}   # the precinct path (the switch /precinct uses)
            g = (std.get('governing') or {}) if isinstance(std, dict) else {}
            cur_ = {'governing': {'instrument': g.get('instrument'), 'unit': g.get('unit'), 'basis': g.get('basis')},
                    'height': [p.get('number') for p in (std.get('height') or []) if p.get('governing')][:1] if isinstance(std, dict) else None,
                    'rules': {}}
            for use in USES:
                r = api(f'/api/rules/at?cadid={cadid}&use={urllib.request.quote(use)}&precinct=1') or {}
                v = (r.get('verdict') or {}) if isinstance(r, dict) else {}
                cur_['rules'][use] = {'permissible': v.get('permissible'), 'wording': (v.get('wording') or '')[:140]} if v else {'error': (r.get('error') or r.get('statusMessage') or '')[:100]}
            case['current'] = cur_
        cases.append(case)
    out = {'instrument': f'epi-2021-{code}', 'title': title, 'note': 'Step 8 keys (docs/precinct-sepp-pipeline.md). expect.permissibility reads the instrument\'s own Land Use Table for the lot\'s unit and zone (explicit row, listed parent, or catch-all), with the row quoted; null = the unit has no table. "current" is what the app answered on the day the key was written (--record).',
           'cases': cases}
    path = os.path.join(ROOT, 'tests', 'answer-keys', f'{short}.json')
    if not RECORD and os.path.exists(path):   # keep the answers an earlier --record run wrote beside each case
        prev = {c['cadid']: c.get('current') for c in json.load(open(path, encoding='utf-8')).get('cases', [])}
        for cs in cases:
            if prev.get(cs['cadid']): cs['current'] = prev[cs['cadid']]
    json.dump(out, open(path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    kinds = {}
    for cs in cases: kinds[cs['expect']['unitKind']] = kinds.get(cs['expect']['unitKind'], 0) + 1
    decided = sum(1 for cs in cases for u in USES if cs['expect']['permissibility'][u]['status'])
    print(f"{short}: {len(cases)} cases {kinds}; LUT expectations decided {decided}/{len(cases) * len(USES)}" + (f"; current answers recorded" if RECORD else ''))
