/**
 * Step 2a of docs/precinct-sepp-pipeline.md: which map polygon names which unit of an instrument.
 *
 *     npx tsx scripts/build-instrument-unit-map.ts            # propose, write nsw.instrument_unit_map, print
 *     npx tsx scripts/build-instrument-unit-map.ts --dry      # propose and print only
 *     npx tsx scripts/build-instrument-unit-map.ts --doc 'State Environmental Planning Policy (Precincts—Regional) 2021'
 *
 * A lot's governing unit is (document, top-level unit). For an LEP the unit is the whole plan. For a
 * SEPP that carries several former instruments as chapters and appendices, the unit is whichever
 * chapter or appendix the lot's land application polygon (else its zoning polygon) belongs to. The
 * ePlanning layers do not carry the unit id; they carry a map name, a layer class and a label, and
 * the appendix NUMBERS in them are stale (the North West Growth Centre map says "Appendix 4" for
 * Alex Avenue and Riverstone, which the current instrument numbers Appendix 7). Names are stable,
 * numbers are not, so the match is by name.
 *
 * For every instrument in nsw.document that the zoning layer names, every distinct
 * (layer, map_name, lay_class, label) key is matched against the document's top-level units by:
 *   1. the key's name equal to a unit heading (normalised),
 *   2. the key's name tokens a subset of exactly one unit heading's tokens,
 *   3. the key's name a phrase inside exactly one unit's "land to which this ... applies" clause,
 *   4. 2 again with the map name's tokens added (disambiguates "Town centre" on the Wilton map);
 *   5. a Precinct Boundary Map label, only for a unit whose "land to which this plan applies" clause
 *      names the precinct and no Land Application Map ("This Precinct Plan applies to land within the
 *      Oran Park and Turner Road Precincts"): such a plan binds its land by the precinct's name, so the
 *      Precinct Boundary Map is the map it means. A plan that names a Land Application Map is never
 *      bound by a precinct boundary (its own note says the two maps differ).
 * A key that matches nothing, or more than one unit, gets no unit: the lot resolves to "unit not
 * held" (fail closed) until the instrument profile (step 3) confirms a row by hand. Every row is
 * written with status 'proposed' and the rule that produced it, so the review is a table, not code.
 * Nothing here names an instrument.
 */
import 'dotenv/config'
import pg from 'pg'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const ONLY = (() => { const i = argv.indexOf('--doc'); return i >= 0 ? argv[i + 1] : null })()

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params)

/** words that carry no identity: instrument words, map words, structural words */
const NOISE = new Set(['sepp', 'srep', 'state', 'environmental', 'planning', 'policy', 'plan', 'regional', 'environment', 'no',
  'land', 'application', 'zoning', 'zone', 'map', 'maps', 'sheet', 'area', 'areas', 'the', 'of', 'to', 'and', 'or', 'a', 'an', 'in',
  'precinct', 'precincts', 'site', 'sites', 'subject', 'boundary', 'boundaries', 'clause', 'appendix', 'schedule', 'chapter',
  'significant', 'which', 'applies', 'amendment', 'growth', 'centre', 'centres', 'wpc', 'gmac', 'ssp', 'sydney', 'region'])
/* roman sheet numbers and "(Part)" carry nothing; digits DO (Stage 1 and 2 is not Stage 3, Area 20 is only its number) */
const NUMBERISH = /^([ivx]+|part|\(part\))$/i

export function tokens(s: string | null | undefined): string[] {
  if (!s) return []
  // years, and "No 26" / "Map 2" / "Appendix 12, Clause 1.3": a map's or a layer class's numbering, never a unit's name
  return s.toLowerCase().replace(/\b(19|20)\d\d\b/g, ' ').replace(/\b(no|map|maps|sheet|appendix|schedule|clause|cl)\s*\d+[a-z]?(\.\d+)*\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(w => w && !NOISE.has(w) && !NUMBERISH.test(w))
}
const norm = (s: string | null | undefined) => tokens(s).join(' ')

interface Unit { local_id: string; heading: string; applies: string }
interface Key { layer: string; map_name: string | null; lay_class: string | null; label: string | null; n: number }

/** the name a key carries: the label unless it is a bare letter or empty, else the layer class, else the map name */
function keyNames(k: Key): { name: string; from: 'label' | 'lay_class' | 'map_name' }[] {
  const out: { name: string; from: 'label' | 'lay_class' | 'map_name' }[] = []
  const label = (k.label ?? '').trim()
  if (label && !/^(<null>|none|null|[a-z])$/i.test(label) && tokens(label).length) out.push({ name: label, from: 'label' })
  const lc = (k.lay_class ?? '').trim()
  if (lc && tokens(lc).length) out.push({ name: lc, from: 'lay_class' })
  if (k.map_name && tokens(k.map_name).length) out.push({ name: k.map_name, from: 'map_name' })
  return out
}

/**
 * A map name carries the instrument's own title ("SEPP (Precincts—Eastern Harbour City) 2021 Cooks Cove
 * Land Zoning Map"); those words are the document, not the unit, so they are removed from a map name's
 * tokens before matching. Where several units tie and exactly one is a chapter, the chapter wins: a
 * schedule that shares a chapter's name ("Penrith Lakes Scheme" as ch.5 and sch.4) is subordinate to it.
 */
/** the tokens with every occurrence of the phrase (a contiguous token run) removed - "City West" survives under "Eastern Harbour City" */
function minusPhrase(ts: string[], phrase: string[]): string[] {
  if (!phrase.length) return ts
  const out: string[] = []
  for (let i = 0; i < ts.length;) {
    if (phrase.every((p, j) => ts[i + j] === p)) i += phrase.length
    else out.push(ts[i++]!)
  }
  return out
}

function match(units: Unit[], k: Key, docPhrase: string[]): { unit: Unit | null; rule: string; name: string | null } {
  if (k.layer === 'epi.epi_precinct_boundaries') {
    // rule 5 only: the precinct's whole name among the precincts the applies clause names ("land within the Oran Park and
    // Turner Road Precincts", "applies to the Leppington Town Centre"), for a unit that names no Land Application Map.
    // "Riverstone" is not "Riverstone West": names are compared whole, never as a phrase inside another name.
    const name = (k.label ?? '').trim(); const ns = norm(name)
    if (!ns) return { unit: null, rule: 'no name', name: null }
    const named = (u: Unit) => {
      const t = (u.applies || '').replace(/\s+/g, ' ')
      const out: string[] = []
      for (const m of t.matchAll(/(?:within|in|to) (?:land (?:within|in) )?(?:the )?([^.;:]+?) precincts?\b/gi)) out.push(...m[1]!.split(/,\s*|\s+and\s+/))
      for (const m of t.matchAll(/applies to (?:land (?:within|in) )?(?:the )?([^.;:,]+?)(?:[.,;]|$)/gi)) out.push(m[1]!)
      return new Set(out.map(x => norm(x)).filter(Boolean))
    }
    const anyPlan = units.filter(u => u.applies && named(u).has(ns))
    const byName = anyPlan.filter(u => !/land application map/i.test(u.applies))
    if (byName.length === 1) return { unit: byName[0]!, rule: '5 precinct named in applies clause, no Land Application Map (label)', name }
    if (byName.length > 1) return { unit: null, rule: `ambiguous (label: ${byName.map(u => u.local_id).join(', ')})`, name }
    return { unit: null, rule: anyPlan.length ? 'named only by a plan bound by its Land Application Map' : 'no match', name }
  }
  const one = (c: Unit[]) => c.length === 1 ? c[0]! : (c.filter(u => u.local_id.startsWith('ch.')).length === 1 && c.length > 1 ? c.find(u => u.local_id.startsWith('ch.'))! : null)
  const tag = (c: Unit[], rule: string) => c.length > 1 ? `${rule}, chapter preferred over ${c.filter(u => !u.local_id.startsWith('ch.')).map(u => u.local_id).join(', ')}` : rule
  /*
   * Every name the key carries is tried, and the STRONGEST rule wins, label before layer class before
   * map name on a tie. A label that only shares tokens with a unit ("Bays Precinct" under the City West
   * map) must not beat a map name that equals a chapter heading.
   */
  const found: { unit: Unit; strength: number; rule: string; name: string }[] = []
  const ambiguous: string[] = []
  for (const { name, from } of keyNames(k)) {
    const nt = (from === 'map_name' ? minusPhrase(tokens(name), docPhrase) : tokens(name)); if (!nt.length) continue
    const ns = nt.join(' ')
    const eq = units.filter(u => norm(u.heading) === ns)
    if (one(eq)) { found.push({ unit: one(eq)!, strength: 1, rule: tag(eq, `1 equals heading (${from})`), name }); continue }
    const sub = units.filter(u => { const ut = new Set(tokens(u.heading)); return nt.every(t => ut.has(t)) })
    if (one(sub)) { found.push({ unit: one(sub)!, strength: 2, rule: tag(sub, `2 tokens in heading (${from})`), name }); continue }
    const ph = units.filter(u => u.applies && (' ' + norm(u.applies) + ' ').includes(' ' + ns + ' '))
    if (ph.length === 1) { found.push({ unit: ph[0]!, strength: 3, rule: `3 phrase in applies clause (${from})`, name }); continue }
    if (from !== 'map_name' && k.map_name) {
      const all = [...new Set([...nt, ...minusPhrase(tokens(k.map_name), docPhrase)])]
      const sub4 = units.filter(u => { const ut = new Set(tokens(u.heading)); return nt.every(t => ut.has(t)) && all.filter(t => ut.has(t)).length > nt.length })
      if (one(sub4)) { found.push({ unit: one(sub4)!, strength: 4, rule: tag(sub4, `4 tokens + map name in heading (${from})`), name }); continue }
    }
    if (eq.length > 1 || sub.length > 1 || ph.length > 1) ambiguous.push(`${from}: ${[...new Set([...eq, ...sub, ...ph].map(u => u.local_id))].join(', ')}`)
  }
  if (found.length) { const best = found.reduce((a, b) => (b.strength < a.strength ? b : a)); return { unit: best.unit, rule: best.rule, name: best.name } }
  if (ambiguous.length) return { unit: null, rule: `ambiguous (${ambiguous.join('; ')})`, name: keyNames(k)[0]?.name ?? null }
  return { unit: null, rule: 'no match', name: keyNames(k)[0]?.name ?? null }
}

async function main() {
  const docs = (await q(`
    SELECT d.id, d.title, d.doc_type FROM nsw.document d
     WHERE d.doc_type IN ('lep', 'sepp') AND ($1::text IS NULL OR d.title = $1)
       AND EXISTS (SELECT 1 FROM epi.epi_land_zoning z WHERE z.epi_name = d.title)
     ORDER BY d.title`, [ONLY])).rows
  console.log(`${docs.length} instruments named by the zoning layer and held in nsw.document`)
  if (!DRY) await q(`
    CREATE TABLE IF NOT EXISTS nsw.instrument_unit_map (
      document_id   uuid NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
      layer         text NOT NULL,              -- epi.epi_land_application | epi.epi_land_zoning | epi.epi_precinct_boundaries
      map_name      text,
      lay_class     text,
      label         text,
      unit_local_id text,                       -- NULL = no unit proposed: a lot here resolves to "unit not held"
      unit_heading  text,
      rule          text NOT NULL,              -- which rule proposed it, or why none did
      matched_name  text,
      polygons      integer NOT NULL,
      status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'rejected')),
      note          text,
      computed_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (document_id, layer, map_name, lay_class, label)
    )`)
  let total = 0, resolved = 0
  for (const d of docs) {
    // top-level units with the text of their "land to which ... applies" clause (the clause row plus everything under it)
    // descendants by parent_id, never by id prefix: a chapter's clauses are 'sec.2.6', not 'ch.2-...' (1,037 of
    // Central River City's sections carry no unit prefix), while an appendix's are 'app.5-inc-pt.1-sec.1.3'
    const units: Unit[] = (await q(`
      WITH RECURSIVE u AS (SELECT id, local_id, heading FROM nsw.section WHERE document_id = $1 AND depth = 1 AND heading IS NOT NULL AND level IN ('chapter', 'schedule', 'appendix', 'part')),
      d AS (SELECT u.id AS unit, s.id, s.local_id, s.level, s.heading, s.raw_text, s.sort_order FROM u JOIN nsw.section s ON s.parent_id = u.id
            UNION ALL SELECT d.unit, s.id, s.local_id, s.level, s.heading, s.raw_text, s.sort_order FROM d JOIN nsw.section s ON s.parent_id = d.id),
      a AS (SELECT DISTINCT ON (unit) unit, id AS clause, sort_order FROM d WHERE level = 'clause'
              AND heading ~* '(land|area|sites?) to which|application of (this )?(chapter|appendix|plan|policy|precinct)|subject land' ORDER BY unit, sort_order),
      ad AS (SELECT a.unit, t.raw_text, t.sort_order FROM a JOIN d t ON t.unit = a.unit AND (t.id = a.clause OR t.sort_order > a.sort_order)
             WHERE t.sort_order <= (SELECT min(n.sort_order) FROM d n WHERE n.unit = a.unit AND n.level IN ('clause', 'part', 'division') AND n.sort_order > a.sort_order)
                OR t.id = a.clause)
      SELECT u.local_id, u.heading, COALESCE((SELECT string_agg(ad.raw_text, ' ' ORDER BY ad.sort_order) FROM ad WHERE ad.unit = u.id), '') AS applies
        FROM u ORDER BY u.local_id`, [d.id])).rows
    const lepRoot: Unit | null = d.doc_type === 'lep' ? { local_id: '', heading: d.title, applies: '' } : null
    const keys: Key[] = (await q(`
      SELECT 'epi.epi_land_application' AS layer, map_name, lay_class, label, count(*)::int AS n FROM epi.epi_land_application WHERE epi_name = $1 GROUP BY 1, 2, 3, 4
      UNION ALL
      SELECT 'epi.epi_land_zoning', map_name, NULL, NULL, count(*)::int FROM epi.epi_land_zoning WHERE epi_name = $1 GROUP BY 1, 2, 3, 4
      UNION ALL
      SELECT 'epi.epi_precinct_boundaries', map_name, lay_class, label, count(*)::int FROM epi.epi_precinct_boundaries WHERE epi_name = $1 GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3, 4`, [d.title])).rows
    const rows = keys.map(k => {
      // an LEP is one unit: every key resolves to its root
      const m = lepRoot ? { unit: lepRoot, rule: '0 single-unit instrument', name: null } : match(units, k, tokens(d.title))
      return { k, m }
    })
    const ok = rows.filter(r => r.m.unit).length
    total += rows.length; resolved += ok
    if (!lepRoot || ONLY) {
      console.log(`\n${d.title}  (${units.length} units; ${rows.length} keys, ${ok} resolved)`)
      for (const { k, m } of rows) console.log(`  ${String(k.n).padStart(4)} ${k.layer.replace('epi.epi_', '').padEnd(16)} ${(k.map_name ?? '').slice(0, 58).padEnd(58)} | ${(k.lay_class ?? '').slice(0, 30).padEnd(30)} | ${(k.label ?? '').slice(0, 36).padEnd(36)} -> ${m.unit ? (m.unit.local_id || 'root').padEnd(8) + ' ' + m.unit.heading.slice(0, 44) : '(none)'}   [${m.rule}]`)
    }
    if (!DRY) {
      await q(`DELETE FROM nsw.instrument_unit_map WHERE document_id = $1 AND status = 'proposed'`, [d.id])
      for (const { k, m } of rows) {
        // a key with a NULL part never conflicts under the UNIQUE constraint (NULLs are distinct), so a rerun would add a
        // second row beside a confirmed one: an existing row is found NULL-safely and only a proposed one is rewritten
        const have = (await q(`SELECT status FROM nsw.instrument_unit_map WHERE document_id = $1 AND layer = $2
                               AND map_name IS NOT DISTINCT FROM $3 AND lay_class IS NOT DISTINCT FROM $4 AND label IS NOT DISTINCT FROM $5`, [d.id, k.layer, k.map_name, k.lay_class, k.label])).rows[0]
        if (have && have.status !== 'proposed') {
          await q(`UPDATE nsw.instrument_unit_map SET matched_name = $6, polygons = $7, computed_at = now() WHERE document_id = $1 AND layer = $2
                   AND map_name IS NOT DISTINCT FROM $3 AND lay_class IS NOT DISTINCT FROM $4 AND label IS NOT DISTINCT FROM $5`, [d.id, k.layer, k.map_name, k.lay_class, k.label, m.name, k.n])
          continue
        }
        await q(`INSERT INTO nsw.instrument_unit_map (document_id, layer, map_name, lay_class, label, unit_local_id, unit_heading, rule, matched_name, polygons)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [d.id, k.layer, k.map_name, k.lay_class, k.label, m.unit ? (m.unit.local_id || null) : null, m.unit?.heading ?? null, m.rule, m.name, k.n])
      }
    }
  }
  console.log(`\n${resolved} of ${total} keys resolved to a unit${DRY ? ' (dry: nothing written)' : ' - written to nsw.instrument_unit_map as proposed'}`)
  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
