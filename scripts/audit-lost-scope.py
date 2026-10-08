"""Does a rule carry the conditions its own clause states?

    python scripts/audit-lost-scope.py [--doc "Parramatta%"] [--limit 30] [--csv out.csv]

THE DEFECT THIS LOOKS FOR. Housing SEPP s 159 reads

    Development consent must not be granted to development for the purposes of residential flat
    buildings, independent living units or shop top housing ON A LOT IN A TRANSPORT ORIENTED
    DEVELOPMENT AREA, unless the lot is at least 21m wide.

and the rule we extracted is

    width >= 21 m   scope: land_use = residential flat building

The Transport Oriented Development Area is gone, so a 21 m minimum is recorded as binding every
residential flat building in the State. That is not an undecided answer - it is a confident wrong
one, which is the only kind worth hunting first.

HOW IT DECIDES. A clause's text is searched for the terms in nsw.scope_layer - the exact vocabulary
the engine can evaluate against a lot, so a hit is both recognisable and testable. If the clause
names one and the rule's applicability does not, the condition was lost in extraction.

Using scope_layer rather than a hand-written word list is the point: the audit can only accuse the
extractor of dropping something the evaluator could have used. It is a SCREEN, not a verdict - an
earlier version keyed on the word "unless" and flagged Randwick cl 5.4, where the land_use scope
genuinely is the condition. Read the hits before acting on them.

It reports. It changes nothing. --csv writes the full list for working through.
"""
import argparse, collections, csv, pathlib, re, sys
import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = re.search(r'^DATABASE_URL=(.+)$', (ROOT / '.env').read_text(encoding='utf-8'), re.M).group(1).strip()

# the Land Use Table is read by nsw.lep_permissibility, not by these rules
LUT = re.compile(r'^sec\.(2\.[123]|[1-4])(-|$)|-oc\.')
# terms that are a word of ordinary planning English as well as a layer name: matching them in prose
# says nothing, so they are left to the longer, unambiguous terms
STOP = {'slope', 'coastal', 'heritage', 'flood', 'airport', 'wetland', 'strata', 'adjoins',
        'landslide', 'bushfire', 'salinity', 'groundwater', 'watercourse', 'bushland', 'subsidence',
        'contamination', 'biodiversity', 'hydrological', 'acid_sulfate', 'environmentally sensitive'}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--doc', default='%')
    ap.add_argument('--limit', type=int, default=30)
    ap.add_argument('--csv')
    a = ap.parse_args()
    db = psycopg2.connect(URL); cur = db.cursor()

    cur.execute("SELECT term FROM nsw.scope_layer WHERE source_kind <> 'none'")
    terms = [t for (t,) in cur.fetchall() if len(t) > 8 and t.lower() not in STOP]
    print(f"{len(terms)} testable scope_layer terms long enough to match on\n")

    cur.execute("""
    /*
     * The rule's OWN words, not the whole clause.
     *
     * Matching across the clause subtree made a Note about heritage flag an unrelated height rule
     * two subclauses away. A condition binds a number when it is in the same sentence or in a
     * parent that governs it, so the text searched is the rule's own section plus its ancestors -
     * which is exactly where Housing SEPP s 159 keeps "in a Transport Oriented Development Area".
     */
    WITH cl AS (
      SELECT r.id AS rule_id, cl.local_id, coalesce(cl.heading,'') AS heading,
             (SELECT string_agg(coalesce(x.raw_text,''), ' ' ORDER BY x.sort_order)
                FROM nsw.section x
               WHERE x.document_id = r.document_id
                 AND (x.local_id = s.local_id OR x.local_id LIKE s.local_id || '-%%'
                      OR s.local_id LIKE x.local_id || '-%%')) AS txt
        FROM nsw.rule r
        JOIN nsw.document d ON d.id = r.document_id AND d.doc_type IN ('lep','sepp') AND d.title LIKE %s
        JOIN nsw.section s ON s.id = r.section_id
        JOIN nsw.section cl ON cl.document_id = r.document_id AND cl.level = 'clause'
                           AND (s.local_id = cl.local_id OR s.local_id LIKE cl.local_id || '-%%'))
    SELECT d.title, cl.local_id, cl.heading, cl.txt, r.clause,
           (SELECT string_agg(e.topic || ' ' || e.comparator || ' ' || e.value, ', ')
              FROM nsw.rule_effect e WHERE e.rule_id = r.id AND e.value IS NOT NULL) AS effects,
           (SELECT string_agg(DISTINCT lower(a.value), ' | ') FROM nsw.rule_applicability a
             WHERE a.rule_id = r.id) AS scope
      FROM cl
      JOIN nsw.rule r ON r.id = cl.rule_id
      JOIN nsw.document d ON d.id = r.document_id
     WHERE EXISTS (SELECT 1 FROM nsw.rule_effect e WHERE e.rule_id = r.id AND e.value IS NOT NULL)
    """, (a.doc,))

    rows = [r for r in cur.fetchall() if not LUT.match(r[1])]
    tally = collections.Counter()
    found = []
    for title, local_id, heading, txt, clause, effects, scope in rows:
        flat = lambda x: re.sub(r'[^a-z0-9]+', ' ', (x or '').lower())
        body = flat(f"{heading} {txt or ''}")
        held = flat(scope)
        named = [t for t in terms if flat(t) in body]
        if not named:
            tally['no testable term in the clause'] += 1
            continue
        # a rule that names the condition MORE precisely has not lost it
        # Inner West cl 6.20(3) holds site_ref "Haberfield Heritage Conservation" for a clause whose
        # text says "heritage conservation area". The specific IS the condition, so a term counts as
        # held when the scope shares a distinctive word with it, not only on an exact match.
        def heldAlready(term: str) -> bool:
            if flat(term) in held:
                return True
            words = [w for w in flat(term).split() if len(w) > 4 and w not in ('area', 'areas', 'land')]
            return bool(words) and all(w in held for w in words[:1])
        missing = [t for t in named if not heldAlready(t)]
        if not missing:
            tally['every term it names is held'] += 1
        elif len(missing) < len(named):
            tally['some held, some lost'] += 1
            found.append((title, local_id, clause, heading, effects, missing, 'partial'))
        else:
            tally['LOST - names a term, holds none'] += 1
            found.append((title, local_id, clause, heading, effects, missing, 'lost'))

    print(f"{len(rows)} rules carrying a number, outside the Land Use Table\n")
    for k in ['every term it names is held', 'some held, some lost',
              'LOST - names a term, holds none', 'no testable term in the clause']:
        print(f"  {tally[k]:5}  ({100*tally[k]//max(len(rows),1):3}%)  {k}")

    worst = [f for f in found if f[6] == 'lost']
    print(f"\n\n{len(worst)} rules state a number while naming a condition they do not hold")
    print('-' * 92)
    for d, n in collections.Counter(f[0] for f in worst).most_common(12):
        print(f"  {n:4}  {d}")

    print(f"\n\nUp to {a.limit}, at most two per plan\n" + '-' * 92)
    seen: collections.Counter = collections.Counter()
    shown = 0
    for title, local_id, clause, heading, effects, missing, _ in worst:
        if seen[title] >= 2 or shown >= a.limit:
            continue
        seen[title] += 1; shown += 1
        short = title.replace(' Local Environmental Plan', ' LEP').replace('State Environmental Planning Policy', 'SEPP')
        print(f"  {short} cl {clause}  -  {heading[:62]}")
        print(f"       states   : {effects}")
        print(f"       but drops: {', '.join(missing[:4])}")

    if a.csv:
        with open(a.csv, 'w', newline='', encoding='utf-8') as fh:
            w = csv.writer(fh)
            w.writerow(['instrument', 'section', 'clause', 'heading', 'effects', 'terms_dropped', 'severity'])
            for f in found:
                w.writerow([f[0], f[1], f[2], f[3], f[4], '; '.join(f[5]), f[6]])
        print(f"\nwrote {len(found)} rows to {a.csv}")
    db.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
