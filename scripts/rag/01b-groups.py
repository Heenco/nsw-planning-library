"""
RAG pilot, Phase 1 - clause groups (schema rag; plan shared/rag-plan.ts, page /rag).

    python scripts/rag/01b-groups.py          # after 01-snapshot.ts, before 02a-terms.py and 02-relations.ts
    python scripts/rag/01b-groups.py --dry

The legislation XML has a level the pilot structure drops: <level type="clausegroup">, which is how the Land Use Table
holds its zones ("Zone R1" / "General Residential") and how some instruments group clauses. Without it, "Permitted with
consent" under the Land Use Table does not say which zone it is for - the one fact a retrieval chunk most needs. Each
clausegroup becomes a provision of kind 'group' (heading "Zone R1 General Residential"), parented to the provision that
holds it, and the clauses inside it are reparented to it; paths are rebuilt from the parent chain. Generic: every
clausegroup in every instrument, nothing named.

Re-run 02a-terms.py and 02-relations.ts after this (part_of edges and term paths follow the new parents).
"""
import json, re, sys, uuid
from pathlib import Path
import psycopg2
from lxml import etree

DRY = '--dry' in sys.argv
sys.path.insert(0, str(Path(__file__).resolve().parent))
from corpus_xml import env, sources, remove_provisions   # every instrument in rag.instrument, its XML at its own as-at date

norm = lambda s: re.sub(r'\s+', ' ', s or '').strip()

def groups(xml_path):
    raw = re.sub(r'<!DOCTYPE[^>]*>', '', xml_path.read_text(encoding='utf-8'))
    root = etree.fromstring(raw.encode('utf-8'), parser=etree.XMLParser(recover=True, huge_tree=True))
    out = []
    for g in root.iter('level'):
        if g.get('type') != 'clausegroup' or not g.get('id'):
            continue
        head = g.find('head')
        no = norm(''.join(head.find('no').itertext())) if head is not None and head.find('no') is not None else ''
        heading = norm(''.join(head.find('heading').itertext())) if head is not None and head.find('heading') is not None else ''
        # the nearest enclosing level with an id: where the group sits
        anc = g.getparent()
        while anc is not None and not (anc.tag == 'level' and anc.get('id')) and anc.tag not in ('part', 'schedule', 'division'):
            anc = anc.getparent()
        holder = anc.get('id') if anc is not None else None
        # the clauses directly inside it (not those of a nested group)
        members = [l.get('id') for l in g.iter('level') if l is not g and l.get('id') and l.get('type') != 'clausegroup'
                   and next((a for a in l.iterancestors('level') if a.get('type') == 'clausegroup'), None) is g]
        out.append({'xml_id': g.get('id'), 'no': no, 'heading': heading, 'holder': holder, 'members': members})
    return out

def main():
    con = psycopg2.connect(env('DATABASE_URL')); cur = con.cursor()
    report, run = {}, None
    SOURCES = sources(cur)
    if not DRY:
        cur.execute("INSERT INTO rag.run (stage, config) VALUES ('groups', %s) RETURNING id", (json.dumps({'sources': [p.name for _, _, _, p in SOURCES]}),))
        run = cur.fetchone()[0]
    for title, doc, _kind, path in SOURCES:
        # idempotent and in place: an earlier run's groups (stamped with a 'groups' run - never a group the snapshot itself
        # brought in) are read as if undone - their members under the group's parent - and the groups are then upserted
        # with the same ids, so nothing that hangs off them (chunks, claims, adjudications) is lost
        mine = "SELECT p.id FROM rag.provision p JOIN rag.run r ON r.id = p.snapshot_run WHERE p.document_id = %s AND p.kind = 'group' AND r.stage = 'groups'"
        cur.execute(f"SELECT id, local_id, parent_id, container, sort, kind FROM rag.provision WHERE document_id = %s AND id NOT IN ({mine})", (doc, doc))
        rows = cur.fetchall()
        cur.execute(f"SELECT id, parent_id FROM rag.provision WHERE id IN ({mine})", (doc,))
        gp = dict(cur.fetchall())
        rows = [(r[0], r[1], gp.get(r[2], r[2]), r[3], r[4], r[5]) for r in rows]
        by_local = {r[1]: r for r in rows}
        parent_of = {r[0]: r[2] for r in rows}
        gs = groups(path)
        made, moves, no_holder, no_members, already = [], [], 0, 0, 0
        for g in gs:
            # the snapshot already holds this group (the pilot structure is to carry clausegroups with these same ids):
            # nothing to restore, and a second provision on the same anchor would break every local_id lookup
            if g['xml_id'] in by_local:
                already += 1
                continue
            held = [by_local[m] for m in g['members'] if m in by_local]
            if not held:
                no_members += 1
                continue
            # the group's parent is the members' current parent (where the snapshot put them), else the XML holder
            parents = {parent_of[h[0]] for h in held}
            parent = parents.pop() if len(parents) == 1 else (by_local[g['holder']][0] if g['holder'] in by_local else None)
            if parent is None:
                no_holder += 1
                continue
            gid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"rag:{doc}:{g['xml_id']}"))
            made.append({'id': gid, 'document_id': str(doc), 'parent_id': str(parent), 'local_id': g['xml_id'], 'kind': 'group',
                         'heading': norm(f"{g['no']} {g['heading']}"), 'own_text': '', 'ordinal': min(h[4] or 0 for h in held) - 1,
                         'container': held[0][3], 'sort': min(h[4] or 0 for h in held) - 1})
            moves += [{'id': str(h[0]), 'p': gid} for h in held]
        report[title] = {'clausegroups': len(gs), 'made': len(made), 'clauses_moved': len(moves), 'without_held_members': no_members, 'without_holder': no_holder,
                         'already_in_snapshot': already, 'sample': [m['heading'] for m in made[:4]]}
        if DRY:
            continue
        cur.execute("""INSERT INTO rag.provision (id, document_id, parent_id, local_id, kind, heading, own_text, ordinal, path, container, sort, content_sha, snapshot_run)
                       SELECT id, document_id, parent_id, local_id, kind, heading, own_text, ordinal, '{}', container, sort, md5(local_id || heading), %s
                         FROM jsonb_to_recordset(%s::jsonb) AS x(id uuid, document_id uuid, parent_id uuid, local_id text, kind text, heading text,
                              own_text text, ordinal int, container text, sort int)
                       ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, heading = EXCLUDED.heading, ordinal = EXCLUDED.ordinal,
                         container = EXCLUDED.container, sort = EXCLUDED.sort, content_sha = EXCLUDED.content_sha""", (run, json.dumps(made)))
        # every clause sits where this run puts it: under its group, else back under the parent of the group it had
        cur.execute(f"UPDATE rag.provision c SET parent_id = g.parent_id FROM rag.provision g WHERE c.parent_id = g.id AND g.id IN ({mine}) AND NOT (c.id = ANY(%s::uuid[]))",
                    (doc, [m['id'] for m in moves]))
        cur.execute("UPDATE rag.provision c SET parent_id = x.p FROM jsonb_to_recordset(%s::jsonb) AS x(id uuid, p uuid) WHERE c.id = x.id", (json.dumps(moves),))
        # a group this run no longer makes: its members were moved off it above
        report[title]['removed'] = remove_provisions(cur, [g for g in gp if str(g) not in {m['id'] for m in made}])
        # paths from the parent chain: the ancestors' local ids, root first
        cur.execute("""WITH RECURSIVE ch AS (
                         SELECT id, parent_id, ARRAY[]::text[] AS path FROM rag.provision WHERE document_id = %s AND parent_id IS NULL
                         UNION ALL
                         SELECT c.id, c.parent_id, ch.path || p.local_id FROM rag.provision c JOIN ch ON c.parent_id = ch.id JOIN rag.provision p ON p.id = ch.id)
                       UPDATE rag.provision p SET path = ch.path FROM ch WHERE p.id = ch.id AND p.path IS DISTINCT FROM ch.path""", (doc,))
        report[title]['paths_rebuilt'] = cur.rowcount
    if not DRY:
        cur.execute("UPDATE rag.run SET finished_at = now(), counts = %s WHERE id = %s", (json.dumps(report), run))
        con.commit()
    print(json.dumps(report, indent=1))

main()
