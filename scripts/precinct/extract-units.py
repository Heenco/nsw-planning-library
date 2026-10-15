"""Units of each Precinct SEPP from the graph, by parent chain (never by id prefix): heading, the "land to which ...
applies" clause, the relationship clause, and - for an appendix - the chapter that cites it most."""
import sys, json, re, psycopg2
DB, S = sys.argv[1], sys.argv[2]
c = psycopg2.connect(DB); cur = c.cursor()
out = {}
cur.execute("select id, title from nsw.document where title like 'State Environmental Planning Policy (Precincts%' order by title")
for doc, title in cur.fetchall():
    cur.execute("select id, local_id, level, heading from nsw.section where document_id=%s and depth=1 order by sort_order", (doc,))
    tops = cur.fetchall()
    units = []
    desc_cache = {}
    def descendants(uid):
        if uid in desc_cache: return desc_cache[uid]
        cur.execute("""with recursive d as (select id, local_id, level, heading, raw_text, sort_order, parent_id from nsw.section where parent_id=%s
                       union all select s.id, s.local_id, s.level, s.heading, s.raw_text, s.sort_order, s.parent_id from d join nsw.section s on s.parent_id=d.id)
                       select id, local_id, level, heading, raw_text, sort_order, parent_id from d order by sort_order""", (uid,))
        desc_cache[uid] = cur.fetchall(); return desc_cache[uid]
    def clause_text(rows, idx):
        # the clause row plus every row until the next clause/part/division at any depth (its subclauses and paragraphs)
        base = rows[idx]; txt = [base[4] or '']
        for r in rows[idx+1:]:
            if r[2] in ('clause', 'part', 'division', 'schedule', 'chapter'): break
            txt.append(r[4] or '')
        return re.sub(r'\s+', ' ', ' '.join(t for t in txt if t)).strip()
    def find(rows, pattern):
        for i, r in enumerate(rows):
            if r[2] == 'clause' and r[3] and re.search(pattern, r[3], re.I):
                return {'id': r[1], 'heading': r[3], 'text': clause_text(rows, i)[:900]}
        return None
    for uid, lid, lvl, h in tops:
        rows = descendants(uid)
        units.append({'local_id': lid, 'level': lvl, 'heading': re.sub(r'\s+', ' ', h or ''),
                      'applies': find(rows, r'(land|area|sites?|precinct) to which|application of (this )?(chapter|appendix|plan|policy|precinct)|^subject land'),
                      'relationship': find(rows, r'relationship (to|with) other|other (environmental )?planning instruments|cease to apply'),
                      'clauses': sum(1 for r in rows if r[2] == 'clause')})
    # an appendix's parent chapter: the chapter whose text cites "Appendix N" (or the appendix heading) most
    chapters = [(uid, lid) for uid, lid, lvl, h in tops if lvl == 'chapter']
    for u, (uid, lid, lvl, h) in zip(units, tops):
        if lvl == 'chapter': continue
        m = re.search(r'^(app|sch)\.(\d+[A-Z]?)$', lid)
        if not m: continue
        kind, n = ('Appendix' if m.group(1) == 'app' else 'Schedule'), m.group(2)
        # the appendix cited by number ("Appendix 11", "Schedule 1"), else by its distinctive name (the heading less
        # "State significant precinct", "site", "Precinct Plan"): the chapter that names it most sets it out
        core = re.sub(r'(State significant precinct\W*|\bsite\b|\bPrecincts? Plan\b|\bActivation Precinct\b)', ' ', u['heading'], flags=re.I)
        core = re.sub(r'\s+', ' ', core).strip()
        pats = [r'\b' + kind + r' ' + re.escape(n) + r'\b'] + ([r'\b' + re.escape(core) + r'\b'] if len(core) > 3 else [])
        best, bestn = None, 0
        for cuid, clid in chapters:
            if clid == 'ch.1': continue
            text = ' '.join(r[4] for r in descendants(cuid) if r[4])
            cnt = sum(len(re.findall(pt, text, re.I)) for pt in pats)
            if cnt > bestn: best, bestn = clid, cnt
        u['parent_chapter'] = best; u['parent_mentions'] = bestn
    out[title] = units
json.dump(out, open(f"{S}/precinct-units.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
for title, units in out.items():
    print("\n#####", title[45:80])
    for u in units:
        if u['level'] == 'chapter' or re.search(r'Precinct Plan|Precincts Plan|State significant precinct|Activation|Bays West', u['heading']):
            print(f"  {u['local_id']:8} {u['heading'][:40]:40} parent={u.get('parent_chapter') or '-':5} ({u.get('parent_mentions', 0)}) | applies={(u['applies'] or {}).get('id', '-')[-20:]:20} | relation={(u['relationship'] or {}).get('id', '-')[-20:]:20} :: {((u['relationship'] or {}).get('text') or '')[:90]}")
