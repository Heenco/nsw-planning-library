"""
RAG pilot - is the corpus text still the law? (schema rag; page /rag, coverage "text changed since")

    python scripts/rag/01d-currency.py            # every instrument in rag.instrument
    python scripts/rag/01d-currency.py --dry      # print, write nothing

Each instrument's text is as at one date (rag.instrument.as_at). The legislation XML of that version says when it stopped
being in force (exdoc end.valid.date). If that date has passed, the version in force today is fetched and compared unit
by unit - a clause, a schedule item or part, a definition - and every unit added, changed or removed since is written to
rag.coverage as 'text_changed_since', with the provision it is (when the corpus holds it). A SEPP is compared only within
its scope (corpus.json). Nothing here changes the corpus: re-snapshotting is a separate decision; this says what is stale.
"""
import json, re, sys
from datetime import datetime
from zoneinfo import ZoneInfo
import psycopg2
from lxml import etree

from corpus_xml import env, sources, xml_for

DRY = '--dry' in sys.argv
TODAY = datetime.now(ZoneInfo('Australia/Sydney')).date().isoformat()
# the units compared: a clause, a schedule's item or part, a definition
UNIT = re.compile(r'^(sec\.[^-]+|sch\.[^-]+-sec(?:\.[^-]+|-oc\.\d+)|sch\.[^-]+-pt\.[^-]+|dict-def\.[^-]+|sch\.[^-]+-def\.[^-]+)$')


def parse(path):
    raw = re.sub(r'<!DOCTYPE[^>]*>', '', path.read_text(encoding='utf-8'))
    return etree.fromstring(raw.encode('utf-8'), parser=etree.XMLParser(recover=True, huge_tree=True))


def units(root, scope):
    """{unit id: (normalised text, heading)} for the units in scope (an ancestor id in the scope list, or no scope)"""
    out = {}
    for el in root.iter():
        i = el.get('id')
        if not i or not UNIT.match(i):
            continue
        if scope and not any(a.get('id') in scope for a in el.iterancestors()) and i not in scope:
            continue
        text = re.sub(r'\s+', ' ', ' '.join(el.itertext())).strip()
        head = el.find('.//heading')
        out[i] = (text, re.sub(r'\s+', ' ', ''.join(head.itertext())).strip() if head is not None else '')
    return out


def main():
    con = psycopg2.connect(env('DATABASE_URL')); cur = con.cursor()
    cur.execute("SELECT document_id::text, scope FROM rag.instrument")
    scopes = {d: s for d, s in cur.fetchall()}
    rows, summary = [], {}
    for title, doc, kind, path in sources(cur):
        old = parse(path)
        as_at = path.name.split('.')[-2]
        end = old.get('end.valid.date') or ''
        code = path.name.split('.')[0]
        if not end or end > TODAY:
            summary[title] = {'as_at': as_at, 'in_force_to': end or None, 'stale': False}
            print(f'{title}: as at {as_at}, still in force (to {end or "-"})')
            continue
        # today's version is a check, not an input: the site unreachable leaves it unchecked, never stops the pipeline
        try:
            new = parse(xml_for(code, TODAY))
        except RuntimeError as e:
            summary[title] = {'as_at': as_at, 'in_force_to': end, 'stale': True, 'checked': False, 'why': str(e)[:160]}
            print(f'{title}: as at {as_at}, superseded {end} - the version in force today not fetched ({str(e)[:100]}): not compared')
            continue
        scope = set(scopes.get(doc) or [])
        a, b = units(old, scope), units(new, scope)
        cur.execute("SELECT local_id, id::text FROM rag.provision WHERE document_id = %s", (doc,))
        prov = dict(cur.fetchall())
        added = [i for i in b if i not in a]
        removed = [i for i in a if i not in b]
        changed = [i for i in a if i in b and a[i][0] != b[i][0]]
        for what, ids, src in (('added', added, b), ('changed', changed, b), ('removed', removed, a)):
            for i in ids:
                text, head = src[i]
                rows.append((doc, 'text_changed_since', None, i, prov.get(i), f'{as_at} -> {TODAY}',
                             f'{what} since {as_at} (superseded {end}): {head + " - " if head else ""}{text[:220]}'))
        summary[title] = {'as_at': as_at, 'in_force_to': end, 'stale': True, 'added': len(added), 'changed': len(changed), 'removed': len(removed)}
        print(f'{title}: as at {as_at}, superseded {end} - since then {len(added)} added, {len(changed)} changed, {len(removed)} removed')
        for i in (added + changed + removed)[:12]:
            print('   ', i, (b.get(i) or a.get(i))[1][:80])
    if DRY:
        return
    cur.execute("INSERT INTO rag.run (stage, config) VALUES ('currency', %s) RETURNING id", (json.dumps({'today': TODAY}),))
    run = cur.fetchone()[0]
    cur.execute("DELETE FROM rag.coverage WHERE check_kind = 'text_changed_since'")
    for r in rows:
        cur.execute("INSERT INTO rag.coverage (document_id, check_kind, map, label, provision_id, source, note, run_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", (*r, run))
    cur.execute("UPDATE rag.run SET finished_at = now(), counts = %s WHERE id = %s", (json.dumps(summary), run))
    con.commit()
    print(f'written {len(rows)} rows')


if __name__ == '__main__':
    main()
