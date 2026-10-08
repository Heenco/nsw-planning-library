/**
 * GET /api/norms/use - can this land use be carried out on this lot, under the LEP AND the SEPPs?
 *
 *   ?cadid=102537951
 *   &site=secondary dwelling=no          (what the asker knows, same shape as /api/norms/subdivision)
 *
 * One tab per land use that a CDC type or a Pattern Book design turns on - the nine in
 * docs/permissible-use-by-type.md. For each:
 *
 *   answer      the Land Use Table, from the LEP and the SEPPs TOGETHER (shared/norms/facts.ts).
 *               /api/cdc/types and the Pattern Book already join both; what neither does is say
 *               what STANDARDS come with the answer, which is the whole reason this page exists.
 *   because     every instrument that spoke, named - a SEPP permission over an LEP prohibition is
 *               reported as both, never silently merged, because the two say different things.
 *   standards   the lot's own arithmetic against the plan's rules, through shared/norms/engine.ts -
 *               the same reading /subdivision shows, asked of a use instead of a subdivision.
 *
 * WHY NOT /api/norms/at. That route reads nsw.norm, and nsw.norm holds only the subdivision family
 * (324 norms, nothing for a use), so it answers no_permission for every land use on every lot. The
 * Land Use Table is the grant here; the graph's rules supply the standards.
 */
import { evaluate } from '#shared/norms/engine'
import { lotFacts, lotTerm, refHitsFor } from '#shared/norms/facts'
import { graphNorms } from '#shared/norms/from-graph'
import type { Cond, Norm, Question } from '#shared/norms/schema'
import { landUseKey } from '#shared/land-use-key'
import { nswQuery } from '../../utils/nsw-kg/pool'

/**
 * The nine uses, and every spelling the two sources use for each.
 *
 * Straight from docs/permissible-use-by-type.md, which is the union of what the eleven CDC types
 * and the seven Pattern Book categories require. The duplicate spellings are a join detail:
 * nsw.lep_permissibility says "dual occupancies", nsw.sepp_permissible_landuse says "Dual
 * occupancy". Matching is lower-cased through landUseKey.
 */
const USES: { key: string; label: string; terms: string[]; inferred?: string; needs: string[] }[] = [
  { key: 'dual-occupancy', label: 'Dual occupancy',
    terms: ['dual occupancies', 'dual occupancies (attached)', 'dual occupancies (detached)',
            'dual occupancy', 'dual occupancy (attached)', 'dual occupancy (detached)'],
    needs: ['CDC: Dual occupancy', 'Pattern Book: Semis'] },
  { key: 'multi-dwelling-housing', label: 'Multi dwelling housing', terms: ['multi dwelling housing'],
    needs: ['CDC: Multi dwelling housing (terraces)', 'Pattern Book: Terraces, Row Homes'] },
  { key: 'secondary-dwelling', label: 'Secondary dwelling', terms: ['secondary dwellings', 'secondary dwelling'],
    needs: ['CDC: Secondary dwelling'] },
  { key: 'dwelling-house', label: 'Dwelling house', terms: ['dwelling houses', 'dwelling house'],
    needs: ['CDC: Dwelling houses, Rural housing, Inland dwelling houses, Greenfield housing'] },
  { key: 'residential-flat-building', label: 'Residential flat building', terms: ['residential flat buildings'],
    needs: ['Pattern Book: Small, Large and Corner Lot Apartments'] },
  { key: 'manor-house', label: 'Manor house', terms: ['residential flat buildings', 'multi dwelling housing'],
    inferred: '"manor house" is not one of the Standard Instrument\'s 203 terms. A manor house is three or four '
            + 'dwellings in one building, which the instruments reach through either form, so either satisfies it.',
    needs: ['CDC: Manor houses', 'Pattern Book: Manor Homes'] },
  { key: 'farm-building', label: 'Farm building', terms: ['farm buildings'], needs: ['CDC: Inland farm buildings'] },
  { key: 'agritourism', label: 'Agritourism', terms: ['agritourism'], needs: ['CDC: Agritourism'] },
  { key: 'farm-stay-accommodation', label: 'Farm stay accommodation', terms: ['farm stay accommodation'],
    needs: ['CDC: Farm stay accommodation'] },
]

const leaves = (c: Cond): any[] => 'all' in c ? c.all.flatMap(leaves) : 'any' in c ? c.any.flatMap(leaves) : 'not' in c ? leaves(c.not) : [c]
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const q = getQuery(event)
  const cadid = String(q.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const site: Record<string, boolean> = {}
  for (const part of String(q.site ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = part.lastIndexOf('=')
    if (i > 0) site[part.slice(0, i).trim()] = /^(yes|true|1)$/i.test(part.slice(i + 1).trim())
  }

  const q2 = (sql: string, p?: unknown[]) => nswQuery<any>(sql, p as any[])
  let lot
  try { lot = await lotFacts(q2, cadid, landUseKey) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }

  const lepDoc = (await q2(`SELECT id, title, instrument_slug FROM nsw.document WHERE title = $1 LIMIT 1`, [lot.epi ?? ''])).rows[0]
  /*
   * The clauses a land-use question can turn on.
   *
   * Part 4 is "Principal development standards" and binds development generally, so 4.1/4.3/4.4 are
   * in for every use. Beyond that, only clauses whose heading names the use itself - a height
   * control for dual occupancies is not a control on a farm building.
   */
  const wordsFor = (u: typeof USES[number]) =>
    [...new Set(u.terms.map(x => x.replace(/\s*\([^)]*\)\s*$/, '').replace(/ies$/, 'y').replace(/s$/, '')))]
  // 4.3 height and 4.4 floor space ratio bind development generally; 4.1 is the minimum SUBDIVISION
  // lot size and says so in its heading, so it is not a standard on carrying out a use
  const GENERAL = ['sec.4.3', 'sec.4.4']
  // ONE pass over the plan for all nine, not one each: graphNorms re-reads every section and rule of
  // the LEP on each call, so nine calls was nine full scans per request - slow enough to be killing
  // the dev worker. The clauses are selected once and handed to the use they name afterwards.
  const allWords = [...new Set(USES.flatMap(wordsFor))]
  const unionFilter = `local_id IN ('sec.4.3', 'sec.4.4') OR heading ~* '${allWords.map(esc).join('|').replace(/'/g, "''")}'`

  const sources = Object.fromEntries((await q2(
    `SELECT DISTINCT ON (title) title, source_url FROM nsw.document WHERE source_url IS NOT NULL ORDER BY title, ingested_at DESC`)).rows
    .map((d: any) => [d.title, d.source_url]))
  const link = (instrument: string, section: string | undefined) => sources[instrument] && section ? `${sources[instrument]}#${section}` : null

  /*
   * The plan's clauses, read once, with each clause's heading so a norm can be handed to the use it
   * names. A clause that names no use (4.3, 4.4) belongs to every use; one that names a use belongs
   * only to that use - a height control for dual occupancies is not a control on a farm building.
   */
  const graph = lepDoc
    ? await graphNorms(q2, lepDoc.id, lepDoc.title, lepDoc.instrument_slug, { clauseFilter: unionFilter, covered: [], assumeKind: null })
    : null
  const headings = new Map<string, string>()
  if (lepDoc) for (const r of (await q2(
    `SELECT local_id, coalesce(heading, '') AS heading FROM nsw.section WHERE document_id = $1 AND level = 'clause'`,
    [lepDoc.id])).rows) headings.set(r.local_id, String(r.heading).toLowerCase())
  const clauseOf = (section: string) => section.replace(/-.*$/, '')
  if (graph) {
    lot.handleRule = graph.handleRule
    const all = graph.norms.flatMap(n => leaves(n.when))
    const termsAsked = [...new Set(all.filter(l => l.fact === 'lot.in').map(l => String(l.value).toLowerCase()))]
    const tested = await Promise.all(termsAsked.map(t => lotTerm(q2, cadid, t, lot!.lga)))
    lot.terms = { ...(lot.terms ?? {}), ...Object.fromEntries(termsAsked.map((t, i) => [t, tested[i]!])) }
    lot.refHits = { ...(lot.refHits ?? {}), ...(await refHitsFor(q2, cadid, graph.refIds)) }
  }

  const tabs = []
  for (const u of USES) {
    // ── the grant: the Land Use Table, both instruments ───────────────────────────────────────
    const said = [...new Set(u.terms.map(t => landUseKey(t)))].flatMap(k => (lot!.permits?.[k] ?? []).map(p => ({ ...p, term: k })))
    const lepSaid = said.filter(s => s.source === 'lep')
    const permits = lepSaid.filter(s => /^permitted/.test(s.status))
    const prohibits = lepSaid.filter(s => s.status === 'prohibited')
    const mixed = lepSaid.filter(s => s.status === 'mixed')
    const seppOnly = !permits.length && said.some(s => s.source === 'sepp')
    /*
     * A SEPP-only permission is a MAYBE, not a yes.
     *
     * nsw.sepp_permissible_landuse is keyed by ZONE ALONE, but Housing SEPP s 166 permits the use
     * "on land to which this chapter applies", and Chapter 6 excludes heritage items, bush fire
     * prone land, flood planning areas, land within 800 m of a Schedule 12 station and more.
     * Calling that a yes said "dual occupancy permitted" on a heritage-listed R2 lot. Whether the
     * chapter reaches this land is a separate test the zone table cannot answer.
     */
    const answer = permits.length ? 'yes' : seppOnly || mixed.length ? 'maybe' : prohibits.length ? 'no' : 'unknown'
    const because = said.length
      ? [...new Map(said.map(s => [`${s.instrument}|${s.status}|${s.term}`,
          { instrument: s.instrument, source: s.source, status: s.status, term: s.term,
            url: sources[s.instrument] ?? null }])).values()]
      : []

    // ── the standards that come with it ───────────────────────────────────────────────────────
    let standards: any[] = [], gaps: any[] = [], dependsOn: any[] = []
    if (lepDoc && graph) {
      const words = wordsFor(u)
      const mine = (section: string) => {
        const h = headings.get(clauseOf(section)) ?? ''
        return GENERAL.includes(clauseOf(section)) || words.some(w => h.includes(w.toLowerCase()))
      }
      const norms = graph.norms.filter(n => mine(n.section))
      const question: Question = { cadid, site, proposal: { kind: 'use', use: u.terms[0] } }
      const o = evaluate(norms, question, lot!, landUseKey)
      const sectionOf = new Map(norms.map(n => [n.id, n.section]))
      standards = o.standards.map(s => ({ ...s, instrument: lepDoc.title, url: link(lepDoc.title, sectionOf.get(s.id)) }))
      dependsOn = o.dependsOn
      const g = { gaps: graph.gaps.filter(x => mine(x.section)) }
      gaps = g.gaps.map(x => ({ clause: x.parts.length ? x.parts.join(', ') : x.clause, section: x.section,
        heading: x.heading, url: link(lepDoc.title, x.section) }))
    }

    tabs.push({ key: u.key, label: u.label, terms: u.terms, inferred: u.inferred ?? null, needs: u.needs,
                answer, because, standards, dependsOn, gaps })
  }

  return {
    ms: Date.now() - started,
    lot: { cadid, lotId: lot.lotId, zone: lot.zone, epi: lot.epi, lga: lot.lga, areaM2: lot.areaM2,
           frontageM: lot.frontageM, lotSizeMinM2: lot.lotSizeMinM2,
           isBattleaxe: lot.isBattleaxe ?? null, handleAreaM2: lot.handleAreaM2 ?? null },
    tabs, sources,
  }
})
