"""
RAG pilot, Phase 2.2 - definitions as provisions (schema rag; plan shared/rag-plan.ts, page /rag).

    python scripts/rag/02a-terms.py          # rebuild the terms of both instruments
    python scripts/rag/02a-terms.py --dry

Both dictionaries are stored in the graph as one flattened section (Randwick 109k chars, Housing Sch 10 11k), so a term
cannot be cut from the prose reliably. The legislation XML marks every definition with <defterm id="<scope>-def.<slug>">,
and the id says where it is scoped: 'dict' / 'sch.10' plan-wide, 'sec.4.3A-ssec.6' only inside that subclause. Each one
becomes a provision of kind 'term', parented to the provision that scopes it, with the whole definition as its text (the
defterm's sentence and any list that completes it, up to the next defterm).

XML: Notebooks/Data/rag_pilot/ - Randwick 2026-04-07 (the date the pilot used), Housing SEPP 2026-10-09.
Python rather than TypeScript because lxml reads this XML as-is; the relations that use the terms are 02-relations.ts.
"""
import json, os, re, sys, uuid
from pathlib import Path
import psycopg2
from lxml import etree

DRY = '--dry' in sys.argv
APP = Path(__file__).resolve().parents[2]
DATA = APP.parent / 'Notebooks' / 'Data' / 'rag_pilot'
SOURCES = [
    ('Randwick Local Environmental Plan 2012', DATA / 'epi-2013-0036.2026-04-07.xml', ('dict',)),
    ('State Environmental Planning Policy (Housing) 2021', DATA / 'epi-2021-0714.2026-10-09.xml', ('sch.10',)),
]

def env(key):
    for line in (APP / '.env').read_text(encoding='utf-8').splitlines():
        if line.startswith(key + '='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")

norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()

def definitions(xml_path):
    raw = xml_path.read_text(encoding='utf-8')
    raw = re.sub(r'<!DOCTYPE[^>]*>', '', raw)              # an external DTD ElementTree cannot fetch
    root = etree.fromstring(raw.encode('utf-8'), parser=etree.XMLParser(recover=True, huge_tree=True))
    out = []
    for d in root.iter('defterm'):
        did = d.get('id')
        if not did or '-def.' not in did:
            continue
        term = norm(''.join(d.itertext()))
        # the definition: from the defterm's own <txt> to the sibling before the next <txt> that holds a defterm
        txt = d
        while txt is not None and txt.tag != 'txt':
            txt = txt.getparent()
        if txt is None:
            continue
        holder, parts, started = txt.getparent(), [], False
        for child in holder:
            if child is txt:
                started = True
            elif started and child.tag == 'txt' and child.find('.//defterm') is not None:
                break
            if started:
                parts.append(norm(' '.join(child.itertext())))
        out.append({'xml_id': did, 'scope': did.split('-def.')[0], 'term': term, 'text': norm(' '.join(parts))})
    return out

def main():
    con = psycopg2.connect(env('DATABASE_URL')); cur = con.cursor()
    report = {}
    run = None
    if not DRY:
        cur.execute("INSERT INTO rag.run (stage, config) VALUES ('terms', %s) RETURNING id",
                    (json.dumps({'sources': [str(p.name) for _, p, _ in SOURCES]}),))
        run = cur.fetchone()[0]
    for title, path, planwide in SOURCES:
        cur.execute("SELECT document_id FROM rag.instrument WHERE title = %s", (title,))
        doc = cur.fetchone()[0]
        cur.execute("SELECT id, local_id, path, container, sort FROM rag.provision WHERE document_id = %s AND kind <> 'term'", (doc,))
        by_local = {r[1]: r for r in cur.fetchall()}
        defs = definitions(path)
        kept, out_of_scope, seen = [], 0, set()
        for i, d in enumerate(defs):
            # a definition inside a note ('dict-note-oc.17', 'sec.2.6-ssec.2-note') is scoped by the nearest provision we hold
            scope = d['scope']
            while scope not in by_local and '-' in scope:
                scope = scope.rsplit('-', 1)[0]
            parent = by_local.get(scope)
            if parent is None:
                out_of_scope += 1
                continue
            if d['xml_id'] in seen:
                continue
            seen.add(d['xml_id'])
            pid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"rag:{doc}:{d['xml_id']}"))
            kept.append({'id': pid, 'document_id': str(doc), 'parent_id': str(parent[0]), 'local_id': d['xml_id'], 'kind': 'term',
                         'heading': d['term'], 'own_text': d['text'], 'ordinal': i, 'path': list(parent[2] or []) + [parent[1]],
                         'container': parent[3], 'sort': parent[4], 'planwide': scope in planwide})
        report[title] = {'defterms': len(defs), 'kept': len(kept), 'planwide': sum(k['planwide'] for k in kept), 'out_of_scope': out_of_scope,
                         'empty_text': sum(1 for k in kept if len(k['own_text']) < len(k['heading']) + 5)}
        if DRY:
            continue
        cur.execute("DELETE FROM rag.relation WHERE from_provision IN (SELECT id FROM rag.provision WHERE document_id = %s AND kind = 'term') "
                    "OR to_provision IN (SELECT id FROM rag.provision WHERE document_id = %s AND kind = 'term')", (doc, doc))
        cur.execute("DELETE FROM rag.provision WHERE document_id = %s AND kind = 'term'", (doc,))
        cur.execute("""INSERT INTO rag.provision (id, document_id, parent_id, local_id, kind, heading, own_text, ordinal, path, container, sort, content_sha, snapshot_run)
                       SELECT id, document_id, parent_id, local_id, kind, heading, own_text, ordinal, path, container, sort, md5(local_id || own_text), %s
                         FROM jsonb_to_recordset(%s::jsonb) AS x(id uuid, document_id uuid, parent_id uuid, local_id text, kind text, heading text,
                              own_text text, ordinal int, path text[], container text, sort int)""", (run, json.dumps(kept)))
    if not DRY:
        cur.execute("UPDATE rag.run SET finished_at = now(), counts = %s WHERE id = %s", (json.dumps(report), run))
        con.commit()
    print(json.dumps(report, indent=1))

main()
