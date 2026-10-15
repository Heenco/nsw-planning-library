import sys, json, re, psycopg2
DB, S, REPO = sys.argv[1], sys.argv[2], sys.argv[3]
units_all = json.load(open(f"{S}/precinct-units.json", encoding="utf-8"))
c = psycopg2.connect(DB); cur = c.cursor()
EM = '—'
META = {
 f'State Environmental Planning Policy (Precincts{EM}Central River City) 2021': ('epi-2021-0725', 'precincts-central-river-city-2021'),
 f'State Environmental Planning Policy (Precincts{EM}Eastern Harbour City) 2021': ('epi-2021-0726', 'precincts-eastern-harbour-city-2021'),
 f'State Environmental Planning Policy (Precincts{EM}Regional) 2021': ('epi-2021-0727', 'precincts-regional-2021'),
 f'State Environmental Planning Policy (Precincts{EM}Western Parkland City) 2021': ('epi-2021-0728', 'precincts-western-parkland-city-2021'),
}
# hand readings for keys the proposer could not settle (reviewed in the progress file)
HAND = {
 # Manni, 2026-10-15, Q1(e): growth centre land with no released precinct plan at the point stays "unit not held"
 'precincts-central-river-city-2021': [
   ("epi.epi_land_zoning", "SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Zoning Map", None, None, None, "REVIEWED: zoned by the growth centre map with no released precinct plan at the point - no unit (fail closed), not Chapter 3"),
   ("epi.epi_land_zoning", "SEPP (Precincts-Central River City) 2021 North West Growth Centre Land Zoning Map", None, None, None, "REVIEWED: as above"),
   ("epi.epi_land_application", "SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Map", "Growth Centres", "North West Growth Centre", None, "REVIEWED: the growth centre boundary, not a precinct plan - no unit"),
 ],
 'precincts-western-parkland-city-2021': [
   ("epi.epi_land_zoning", "SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Land Zoning Map", None, None, None, "REVIEWED: zoned by the growth centre map with no released precinct plan at the point - no unit (fail closed)"),
   ("epi.epi_land_zoning", "SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Land Zoning Map", None, None, None, "REVIEWED: as above"),
   ("epi.epi_land_application", "SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Map", "Growth Centres", "South West Growth Centre", None, "REVIEWED: the growth centre boundary - no unit"),
   ("epi.epi_land_application", "SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Map", "Growth Centres", "Wilton Growth Area", None, "REVIEWED: the growth area boundary - no unit"),
 ],
 'precincts-eastern-harbour-city-2021': [
   ("epi.epi_land_application", f"SEPP (Precincts{EM}Eastern Harbour City) 2021 Sydney Opera House Buffer Zone Map", "Sydney Opera House Buffer Zone", "Sydney Opera House Buffer Zone", "app.1", "the buffer zone the Opera House appendix defines"),
   ("epi.epi_land_application", "SEPP (SSP) 2005 Land Application Map", "Sydney Harbour Foreshore Sites", "Circular Quay", None, "REVIEW: a foreshore site under the former SSP SEPP; no unit of this instrument names Circular Quay"),
   ("epi.epi_land_application", "SEPP (SSP) 2005 Land Application Map", "Sydney Harbour Foreshore Sites", "The Rocks", None, "REVIEW: as Circular Quay"),
   ("epi.epi_land_application", "SEPP (SSP) 2005 Land Application Map", "Sydney Harbour Port and Related Employment Lands", "Sydney Harbour Port and Related Employment Lands", None, "REVIEW: Chapter 2 names the Port and Related Employment Lands Map; which unit governs is a reading"),
 ],
 'precincts-regional-2021': [
   ("epi.epi_land_application", f"SEPP (Precincts{EM}Regional) 2021 Kosciuszko Alpine Region Aboriginal Archaeological Heritage Map", "Archaeologically Sensitive Land", None, "ch.4", "a Chapter 4 overlay, not a unit of its own"),
 ],
}
def ts(s): return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"
def tsn(s): return 'null' if s is None else ts(s)
def clause_no(local_id):
    return (local_id or '').split('-')[-1].replace('sec.', '')
for title, units in units_all.items():
    epi, slug = META[title]
    short_name = 'Precincts—' + re.search(r'Precincts.(.*?)\) 2021', title).group(1) + ' SEPP'
    cur.execute("select id from nsw.document where title=%s", (title,)); doc = cur.fetchone()[0]
    cur.execute("select layer, map_name, lay_class, label, unit_local_id, unit_heading, rule, polygons from nsw.instrument_unit_map where document_id=%s order by layer, map_name, lay_class, label", (doc,))
    keys = cur.fetchall()
    chapters = [u for u in units if u['level'] == 'chapter']
    def chapter_of(u):
        m = re.search(r'Chapter (\d+)', u['heading'])
        if m: return f"ch.{m.group(1)}"
        for ch in chapters:
            if ch['local_id'] != 'ch.1' and ch['heading'].lower() in u['heading'].lower(): return ch['local_id']
        return None
    own_frame, under = [], {}
    for u in units:
        if u['level'] == 'chapter':
            if u['local_id'] != 'ch.1': own_frame.append(u)
        elif re.search(r'Precinct Plan|Precincts Plan|State significant precinct|Activation Precinct|Bays West', u['heading']):
            own_frame.append(u)
        else:
            ch = chapter_of(u)
            if ch: under.setdefault(ch, []).append(u['local_id'])
    out = []
    out.append(f"""/**
 * Instrument profile — {title} ({epi}).
 *
 * The per-instrument input to the rule pipeline (docs/sepp-rule-pipeline.md §4) and to the governing-unit
 * table (docs/precinct-sepp-pipeline.md §3). This SEPP carries former instruments as CHAPTERS and growth
 * centre precinct plans and State significant sites as APPENDICES; each is a unit with its own reach, so
 * each is a frame here, and a lot is under exactly one of them (derived.lot_instrument, basis the land
 * application map, else the zoning map, through nsw.instrument_unit_map).
 *
 * GENERATED 2026-10-15 (scratchpad gen_profiles.py) from the graph - nsw.section: unit headings, each unit's
 * "land to which ... applies" clause and its relationship clause - and from the proposed nsw.instrument_unit_map
 * rows; the `basis: 'hand'` rows in `unitKeys` and every `note` are readings to review. Spans are quoted from the
 * XML as at 2026-10-15. Schedules named for a chapter ("Environmental heritage—Chapter 5") are governed by that
 * chapter's frame; list-only schedules with no chapter in their name sit under the instrument frame.
 * REVIEW STATUS: reviewed - Manni answered Q1 (a)-(f) in session on 2026-10-15 (docs/precinct-sepp-progress.md):
 * prevails over the LEP only; "the only instruments that apply" and a clause disapplying the LEP both read as
 * prevailing over the LEP; parents by kind, not by citation count; growth centre land with no released precinct
 * plan has no unit; the Opera House buffer is app.1 and the three EHC foreshore / port keys stay null.
 */
import type {{ InstrumentProfile, TermMapping }} from './housing-sepp-2021'

const TITLE = {ts(title)}
/** the instrument's short name, inside every unit term: a heading like "State significant precincts" repeats across the four */
const SHORT = {ts(short_name)}
const UNIT = (local_id: string, heading: string): TermMapping => ({{
  dimension: 'defined_area', term: `governed by ${{heading}} (${{SHORT}})`, source_kind: 'derived', source: 'derived.lot_instrument',
  test: 'attribute', column_tested: 'unit_local_id', filter: `document_title = '${{TITLE.replace(/'/g, "''")}}' AND unit_local_id = '${{local_id}}' AND governing`,
  kind: 'condition', note: `the lot's governing unit is ${{local_id}} (${{heading}}) - derived.lot_instrument, docs/precinct-sepp-pipeline.md §1`,
}})
""")
    frames = [f"""    {{
      id: 'instrument',
      title: {ts(title)},
      parent: null,
      clause: '1.1',
      section: 'ch.1',
      governs: [{', '.join(ts(u['local_id']) for u in units)}],
      conditions: [],
      note: 'No instrument-wide prevails clause: each chapter and appendix states its own relationship to other instruments (its frame).',
    }},"""]
    terms = []
    for u in own_frame:
        lid, h = u['local_id'], u['heading']
        rel = u.get('relationship') or {}
        app = u.get('applies') or {}
        reltext = (rel.get('text') or '').strip()
        prevails = ''
        notes = []
        if re.search(r'prevails', reltext, re.I):
            span = re.split(r'(?<=inconsistency\.)', reltext, 1)[0].strip()
            prevails = f"\n      prevails: {{ over: ['lep'], clause: {ts(clause_no(rel.get('id')))}, span: {ts(span[:400])} }},"
            rest = reltext[len(span):].strip()
            if rest: notes.append("further wording of the relationship clause (exceptions, step 4): " + rest[:350])
        elif re.search(r'only environmental planning instruments that apply', reltext, re.I):
            prevails = f"\n      prevails: {{ over: ['lep'], clause: {ts(clause_no(rel.get('id')))}, span: {ts(reltext[:400])} }},"
            notes.append("the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP")
        elif re.search(r'cease to apply|do not apply|does not apply', reltext, re.I):
            # Manni, 2026-10-15, Q1(f): where the clause disapplies the LEP (or every other instrument), write prevails over
            # the LEP now; a SEPP it disapplies (the Parklands chapter on Housing Ch 3 Pts 8-9 and the Codes SEPP) waits
            # for the excludes edge in step 4
            if re.search(r'local environmental plan|all other environmental planning instruments|any other environmental planning instrument', reltext, re.I):
                prevails = f"\n      prevails: {{ over: ['lep'], clause: {ts(clause_no(rel.get('id')))}, span: {ts(reltext[:400])} }},"
                notes.append("the relationship clause disapplies the LEP (or every other instrument) on this land: written as prevailing over the LEP; any SEPP it also disapplies is an excludes edge (step 4)")
            else:
                notes.append("the relationship clause disapplies other SEPPs, not the LEP (an excludes edge, step 4): " + reltext[:350])
        elif reltext:
            notes.append("relationship clause: " + reltext[:300])
        elif u['level'] == 'chapter' or not u.get('parent_chapter'):
            notes.append("no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency)")
        # instruments the relationship clause takes this land out of: every "<instrument>[, Chapter N[, Parts ...]] does
        # not apply" / "do not apply" / "cease to apply" sentence, instrument names read by their statutory form
        disapplies = []
        for sent in re.split(r'(?<=[.])\s+', reltext):
            if not re.search(r'(do|does) not apply|cease to apply', sent, re.I): continue
            if re.search(r'\b(a|any) local environmental plan\b', sent, re.I):
                disapplies.append(('doc_type:lep', None, sent))
            # an instrument name in its statutory form: "SEPP (Name) 2021", "SEPP No 1—Development Standards", "Penrith LEP
            # No 201 (Rural Lands)", "Penrith LEP No 255—Exempt and Complying Development"; then an optional ", Chapter N"
            # and ", Parts 8 and 9". The dash-suffix stops before "does/do not apply", a comma or a full stop.
            name_re = (r'(State Environmental Planning Policy(?: No \d+)?(?: \([^)]*\))?(?:[—–-][A-Za-z ]+?(?= (?:does|do) not| apply|,|\.|$))?(?: \d{4})?'
                       r'|[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)* Local Environmental Plan(?: No \d+)?(?: \([^)]*\))?(?:[—–-][A-Za-z ]+?(?= (?:does|do) not| apply|,|\.|$))?(?: \d{4})?)'
                       r'((?:, Chapter \d+)?(?:, Parts? \d+(?:(?:, | and )\d+)*)?)')
            for m in re.finditer(name_re, sent):
                name, part = m.group(1).strip(), (m.group(2) or '').strip(', ')
                if re.search(r'^State Environmental Planning Policy \(Precincts', name): continue   # this instrument itself
                disapplies.append((name, part or None, sent))
        if disapplies:
            notes.append(f"disapplies {len(disapplies)} instrument(s) or part(s) on this land - written as disapplies edges (step 4)")
        governs = [lid] + under.get(lid, [])
        # An appendix's parent is the chapter of its KIND (Manni, 2026-10-15, Q1(c)): a State significant site under the
        # "State significant precincts" chapter, a precinct plan under the growth centres chapter, an activation precinct
        # under the Activation Precincts chapter. Citation counts are a note only (they put Olympic Park under Homebush
        # Bay and Gilead under the Parklands, which the review rejected).
        parent, how = 'instrument', ''
        if u['level'] != 'chapter':
            kind = ('State significant precinct' if re.search(r'State significant precinct', h, re.I)
                    else 'growth centre' if re.search(r'Precincts? Plan', h, re.I)
                    else 'Activation Precincts' if re.search(r'Activation Precinct', h, re.I) else None)
            cands = [ch for ch in chapters if kind and re.search(kind, ch['heading'], re.I)]
            if len(cands) == 1:
                parent, how = cands[0]['local_id'], f"the chapter of its kind ({cands[0]['heading']})"
                if u.get('parent_chapter') and u['parent_chapter'] != parent:
                    how += f"; the chapter citing it most is {u['parent_chapter']} ({u.get('parent_mentions', 0)} citations), a note only"
            elif u.get('parent_chapter'):
                parent, how = u['parent_chapter'], f"the chapter that cites it most ({u.get('parent_mentions', 0)} citations); no chapter of its kind"
        if parent != 'instrument' and not reltext:
            notes.append(f"no relationship clause of its own: inherits the frame of {parent}, {how}")
        cond_clause = clause_no(app.get('id')) if app else lid
        cond_span = (app.get('text') or f"the unit {h}")[:300]
        frames.append(f"""    {{
      id: {ts(lid)},
      title: {ts(h)},
      parent: {ts(parent)},
      clause: {ts(cond_clause)},
      section: {ts(app.get('id') or lid)},
      governs: [{', '.join(ts(g) for g in governs)}],
      conditions: [
        {{ dimension: 'defined_area', value: {ts(f'governed by {h} ({short_name})')}, polarity: 'applies', clause: {ts(cond_clause)},
          span: {ts(cond_span)}, term: {ts(f'governed by {h} ({short_name})')} }},
      ],{prevails}{(chr(10) + '      disapplies: [' + chr(10) + chr(10).join(f"        {{ instrument: {ts(nm)}, part: {tsn(pt)}, clause: {ts(clause_no(rel.get('id')))}, span: {ts(sn[:300])} }}," for nm, pt, sn in disapplies) + chr(10) + '      ],') if disapplies else ''}
      note: {ts(' | '.join(notes))},
    }},""")
        terms.append(f"    UNIT({ts(lid)}, {ts(h)}),")
    # one row per key: a hand reading replaces the proposer's row for the same key
    ukeys_by = {}
    for layer, mn, lc, lb, uid, uh, rule, n in keys:
        ukeys_by[(layer, mn, lc, lb)] = f"    {{ layer: {ts(layer)}, map_name: {tsn(mn)}, lay_class: {tsn(lc)}, label: {tsn(lb)}, unit: {tsn(uid)}, basis: 'proposed', note: {ts(rule)} }},"
    for layer, mn, lc, lb, uid, note in HAND.get(slug, []):
        if (layer, mn, lc, lb) not in ukeys_by: print(f"  NOTE: hand key not among the proposer's keys (check spelling): {layer} | {mn} | {lc} | {lb}")
        ukeys_by[(layer, mn, lc, lb)] = f"    {{ layer: {ts(layer)}, map_name: {tsn(mn)}, lay_class: {tsn(lc)}, label: {tsn(lb)}, unit: {tsn(uid)}, basis: 'hand', note: {ts(note)} }},"
    ukeys = list(ukeys_by.values())
    nl = "\n"
    out.append(f"""const profile: InstrumentProfile = {{
  instrument: {ts(epi)},
  slug: {ts(re.sub(r'(^-|-$)', '', re.sub(r'[^a-z0-9]+', '-', title.lower())))},
  label: {ts('sepp-' + slug)},
  rank: 30,
  chapters: [{', '.join(ts(u['local_id']) for u in units)}],
  frames: [
{nl.join(frames)}
  ],
  terms: [
{nl.join(terms)}
  ],
  signals: {{
    permission: ['is permitted with development consent', 'may be carried out with development consent', 'may be carried out only with development consent'],
    prohibition: ['is prohibited', 'must not be granted', 'must not be carried out'],
    override: ['despite any other provision', 'despite the provisions of another environmental planning instrument'],
  }},
  /** which map polygon key names which unit - the authority for nsw.instrument_unit_map once reviewed (scripts/pipeline/units.ts) */
  unitKeys: [
{nl.join(ukeys)}
  ],
}}
export default profile
""")
    open(f"{REPO}/profiles/{slug}.ts", "w", encoding="utf-8", newline="").write("\n".join(out))
    print(f"wrote profiles/{slug}.ts: {len(own_frame)} unit frames, {len(ukeys)} unit keys ({len(keys)} proposed + {len(HAND.get(slug, []))} hand), schedules folded under chapters: {sum(len(v) for v in under.values())}")

p = f'{REPO}/profiles/housing-sepp-2021.ts'; s = open(p, encoding='utf-8').read()
if 'export interface UnitKey' not in s:
    a = "export interface InstrumentProfile {"
    b = """/** Which map polygon key names which unit of the instrument (docs/precinct-sepp-pipeline.md §3): the reviewed
 *  authority for nsw.instrument_unit_map. basis 'proposed' = copied from the proposer's row; 'hand' = a reading. */
export interface UnitKey {
  layer: 'epi.epi_land_application' | 'epi.epi_land_zoning'
  map_name: string | null
  lay_class: string | null
  label: string | null
  /** top-level section local_id, or null = no unit (a lot here is "unit not held") */
  unit: string | null
  basis: 'proposed' | 'hand'
  note?: string
}

export interface InstrumentProfile {"""
    assert s.count(a) == 1; s = s.replace(a, b)
    a = "  /** Clauses step 5 does not read as rules, with the reason (a frame's own source, a clause that only lists others). */\n  skip?: Record<string, string>"
    b = a + "\n  /** map polygon keys -> units, for an instrument with more than one unit (Precinct SEPPs) */\n  unitKeys?: UnitKey[]"
    assert s.count(a) == 1; s = s.replace(a, b)
    open(p, 'w', encoding='utf-8', newline='').write(s); print("UnitKey added to the profile interface")
