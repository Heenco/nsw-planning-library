/**
 * GET /api/report/uses?cadid=          the housing land uses complying development and the Pattern Book require, each
 *                                      answered by the RAG engine for this lot, and what that means for every CDC type and
 *                                      Pattern Book category - for /report-2
 * GET /api/report/uses?cadid=&use=     one use's full trace: the answer text, every claim tested and why, the precedence
 *                                      steps, the limits, what could not be checked - and the words of every provision
 *                                      involved, with its link on the NSW legislation website
 *
 * The deterministic RAG engine (shared/rag/evaluate.ts over rag.claim - Randwick LEP 2012 and the Housing SEPP 2021, variant
 * D on /rag) with the lot's facts from shared/rag/lot-facts.ts. No model anywhere: the same lot and graph always give the
 * same answer and the same trace.
 *
 * WHICH USES. Read live from the two catalogues that need them, so this cannot drift from /cdc or /pattern-book:
 *   CDC           cdc.type.land_uses - eleven types; the Codes SEPP cl 1.18(1)(b) test
 *   Pattern Book  PATTERN_DESIGNS' requiredUse through the pattern-book endpoint's USE_TERMS - seven categories; cl 1.18(1)(b)
 *                 for the low rise designs, Housing SEPP s 183(1)(a) for the mid rise (DA) ones
 * Both clauses ask the same thing: the use permissible WITH CONSENT under an instrument applying to the land. Permitted
 * without consent does not meet it (docs/permissible-use-by-type.md). A type listing several spellings, or two uses (manor
 * houses: residential flat buildings or multi dwelling housing), has its use when any one of them passes.
 */
import { evaluate, explain, loadEngine, writeAnswer, type Engine, type Explained, type Result, claimsFor, lepFor } from '#shared/rag/evaluate'
import { ragLotFacts } from '#shared/rag/lot-facts'
import { lotFacts } from '#shared/norms/facts'
import { landUseKey } from '#shared/land-use-key'
import { PATTERN_DESIGNS } from '#shared/pattern-book'
import { RESIDENTIAL_DEVELOPMENT } from '#shared/housing-evaluate'
import { nswQuery } from '../../utils/nsw-kg/pool'
import { ragEngine } from '../../utils/rag-engine'
import { idsNamedIn, provisionIds, ragProvisions, type RagProvision } from '../../utils/rag-provisions'
import { USE_TERMS } from '../pattern-book/at.get'

const q = (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])

const CACHE_MS = 10 * 60 * 1000
/** the shared engine, reloaded when the rag tables change (server/utils/rag-engine.ts) */
const engineOf = (): Promise<Engine> => ragEngine()

export interface UseSummary {
  use: string
  /** permitted | prohibited | maybe | none (no clause in the graph names the use for this lot) */
  verdict: string
  consent: 'with' | 'without' | null
  /** Meets cl 1.18(1)(b) / s 183(1)(a): permitted with consent. null when the engine cannot say. */
  meets: boolean | null
  /** The provisions the answer rests on. */
  by: { label: string; provision_id: string }[]
  /** The answer's own note, and what it could not check, in one line. */
  caveat: string | null
  /** Which CDC types and Pattern Book categories need this use. */
  neededBy: string[]
}
export interface UseDetail extends UseSummary {
  text: string
  explained: Explained
  provisions: Record<string, RagProvision>
}
export interface Requirement {
  surface: 'CDC' | 'Pattern Book' | 'Housing SEPP'
  key: string
  name: string
  /** The code (CDC) or how many designs share the category (Pattern Book). */
  sub: string
  pathway: 'cdc' | 'da'
  clause: string
  /** The uses that satisfy it, as the engine keys them - any one is enough. */
  uses: string[]
  inferred: string | null
  /** true when one of its uses is permitted with consent; false when none can be; null when it turns on a fact. */
  meets: boolean | null
  /** The use that settles it, when one does. */
  via: string | null
}
export interface ReportUsesResponse {
  engine: 'rag' | 'none'
  reason?: string
  plan: string | null
  zone: string | null
  /** Every use the catalogues require, answered once each. */
  uses: UseSummary[]
  requirements: Requirement[]
  /** Every other use the plan names for the zone - context, collapsed on the page. */
  others: UseSummary[]
  ms: number
}

function summarise(E: Engine, use: string, r: Result): UseSummary {
  const won = (r.ruling?.answer?.claims ?? []).map(id => r.tested.find(t => t.claim.id === id)?.claim).filter(Boolean) as any[]
  const consent = r.verdict === 'permitted' ? (won.some(c => c.consent === 'without') && !won.some(c => c.consent === 'with') ? 'without' : 'with') : null
  const nc = [...new Set(r.notChecked)]
  return {
    use, verdict: r.verdict, consent,
    meets: r.verdict === 'permitted' ? consent === 'with' : r.verdict === 'prohibited' ? false : null,
    // a decided answer rests on the claims that won; an undecided one on every claim that holds or might
    by: [...new Map((won.length ? won : r.tested.filter(t => t.holds !== false).map(t => t.claim))
      .map(c => [c.provision_id, { label: E.label(c.provision_id), provision_id: c.provision_id }])).values()],
    caveat: [r.note, nc.length ? `not checked: ${nc.join('; ')}` : null].filter(Boolean).join(' - ') || null,
    neededBy: [],
  }
}

/** The CDC types and Pattern Book categories, each with the uses (engine keys) that satisfy it. */
async function requirementsOf(): Promise<Omit<Requirement, 'meets' | 'via'>[]> {
  const keys = (terms: string[]) => [...new Set(terms.map(landUseKey))]
  const cdc = (await q(`SELECT key, name, code, land_uses, land_uses_inferred FROM cdc.type ORDER BY ord`).catch(() => ({ rows: [] as any[] }))).rows
  const out: Omit<Requirement, 'meets' | 'via'>[] = cdc.map((t: any) => ({
    surface: 'CDC' as const, key: t.key, name: t.name, sub: t.code ?? '', pathway: 'cdc' as const, clause: 'Codes SEPP cl 1.18(1)(b)',
    uses: keys(t.land_uses ?? []), inferred: t.land_uses_inferred ? String(t.land_uses_inferred === true ? 'inferred - not the instrument\'s own term' : t.land_uses_inferred) : null,
  }))
  const cats = new Map<string, { pathway: 'cdc' | 'da'; requiredUse: string; n: number }>()
  for (const d of PATTERN_DESIGNS) {
    const c = cats.get(d.category)
    if (c) c.n++
    else cats.set(d.category, { pathway: d.pathway, requiredUse: d.requiredUse, n: 1 })
  }
  for (const [category, c] of cats) {
    const spec = USE_TERMS[c.requiredUse]
    out.push({ surface: 'Pattern Book', key: `pb:${category}`, name: category, sub: `${c.n} design${c.n === 1 ? '' : 's'} · ${c.pathway === 'da' ? 'DA' : 'complying development'}`,
      pathway: c.pathway, clause: c.pathway === 'da' ? 'Housing SEPP s 183(1)(a)' : 'Codes SEPP cl 1.18(1)(b)',
      uses: keys(spec?.terms ?? [c.requiredUse]), inferred: spec?.inferred ?? null })
  }
  // the two Housing SEPP pathways whose tests are a land use: build-to-rent's "residential flat buildings permitted with
  // consent under another plan" (s 72(2)(a)(i)) and the bonus's "residential development permitted with consent" (s 15C(1)(a),
  // the s 15B(1) list of forms - shared/housing-evaluate.ts RESIDENTIAL_DEVELOPMENT)
  out.push({ surface: 'Housing SEPP', key: 'btr', name: 'Build-to-rent', sub: 'Housing SEPP Chapter 3 Part 4', pathway: 'da',
    clause: 'Housing SEPP s 72(2)(a)(i)', uses: keys(['residential flat buildings']), inferred: null })
  out.push({ surface: 'Housing SEPP', key: 'ahb', name: 'Affordable housing bonus', sub: 'Housing SEPP Chapter 2 Part 2 Division 1', pathway: 'da',
    clause: 'Housing SEPP s 15C(1)(a)', uses: keys(RESIDENTIAL_DEVELOPMENT), inferred: null })
  return out
}

export default defineEventHandler(async (event): Promise<ReportUsesResponse | UseDetail> => {
  const started = Date.now()
  const query = getQuery(event)
  const precinct = String(query.precinct ?? '') === '1'   // the governing-unit path (docs/precinct-sepp-pipeline.md); off = as before
  const cadid = String(query.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const one = query.use ? landUseKey(String(query.use)) : null

  let f: any
  try { f = await lotFacts(q as any, cadid, landUseKey, [], [], { precinct }) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }
  // the instruments the RAG holds that can govern a lot: the LEPs, and any SEPP whose units the zoning layer draws (a Precinct SEPP)
  const plans = (await q(precinct ? `SELECT title FROM rag.instrument WHERE kind = 'lep' OR EXISTS (SELECT 1 FROM nsw.instrument_unit_map m WHERE m.document_id = rag.instrument.document_id AND m.unit_local_id IS NOT NULL)` : `SELECT title FROM rag.instrument WHERE kind = 'lep'`).catch(() => ({ rows: [] as any[] }))).rows.map(r => String(r.title))
  if (!f.epi || !plans.includes(f.epi)) {
    if (one) throw createError({ statusCode: 404, statusMessage: 'The RAG does not hold this lot\'s plan' })
    return { engine: 'none', reason: `The RAG holds ${plans.join(', ') || 'no plan'}; this lot is under ${f.epi ?? 'no mapped LEP'}.`,
      plan: f.epi ?? null, zone: f.zone ?? null, uses: [], requirements: [], others: [], ms: Date.now() - started }
  }
  const [E, lot, reqs] = await Promise.all([engineOf(), ragLotFacts(q, cadid, 'rag', { precinct }), requirementsOf()])
  setHeader(event, 'cache-control', 'public, max-age=60')

  if (one) {
    const r = evaluate(E, { kind: 'permissibility', use: one }, lot)
    const x = explain(E, r)
    const s = summarise(E, one, r)
    s.neededBy = reqs.filter(rq => rq.uses.includes(one)).map(rq => `${rq.surface}: ${rq.name}`)
    return { ...s, text: writeAnswer(E, r, lot), explained: x, provisions: await ragProvisions(idsNamedIn(E, x, provisionIds(x))) }
  }

  // each required use answered once, in the order the catalogues first need it
  const answered = new Map<string, UseSummary>()
  for (const rq of reqs) for (const u of rq.uses) {
    if (!answered.has(u)) answered.set(u, summarise(E, u, evaluate(E, { kind: 'permissibility', use: u }, lot)))
    answered.get(u)!.neededBy.push(`${rq.surface}: ${rq.name}`)
  }
  const requirements: Requirement[] = reqs.map((rq) => {
    const rs = rq.uses.map(u => answered.get(u)!)
    const yes = rs.find(r => r.meets === true)
    return { ...rq, meets: yes ? true : rs.every(r => r.meets === false) ? false : null, via: yes?.use ?? null }
  })

  // the uses the instruments that speak to THIS lot name for its zone (claimsFor): not every instrument the corpus holds
  // (precinct mode narrows the list to the governing plan's own; without the switch every held LEP's tables feed it, as before)
  const zoneUses = new Set(claimsFor(E, lot, precinct ? lepFor(E, lot).doc : null).filter(c => (c.kind === 'permit' || c.kind === 'prohibit') && (!c.zones.length || c.zones.includes(lot.zone)))
    .flatMap(c => c.uses))
  const others = [...zoneUses].filter(u => !answered.has(landUseKey(u))).sort()
    .map(u => summarise(E, u, evaluate(E, { kind: 'permissibility', use: u }, lot)))
  return { engine: 'rag', plan: f.epi, zone: lot.zone ?? null, uses: [...answered.values()], requirements, others, ms: Date.now() - started }
})
