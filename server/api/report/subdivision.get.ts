/**
 * GET /api/report/subdivision?cadid= - can this lot be subdivided, by title type, for /report-2.
 *
 * Where the RAG holds the lot's plan (rag.instrument - its LEPs and the SEPPs read with them), the answer is the
 * deterministic RAG engine's (shared/rag/evaluate.ts over rag.claim, variant D on /rag): one subdivision question per
 * title type, into 2 lots for dwelling houses, with the claims it tested, the precedence steps and what it could not check.
 * Anywhere else the response says so (`engine: 'none'`) and the page falls back to /api/norms/subdivision.
 *
 * The lot facts are shared/rag/lot-facts.ts ragLotFacts - the recipe scripts/rag/06-questions.ts freezes for the question
 * bank, run live here, so the two cannot drift.
 */
import { evaluate, explain, loadEngine, writeAnswer, type Engine, type Explained } from '#shared/rag/evaluate'
import { lotFacts } from '#shared/norms/facts'
import { ragLotFacts } from '#shared/rag/lot-facts'
import { landUseKey } from '#shared/land-use-key'
import { nswQuery } from '../../utils/nsw-kg/pool'
import { ragEngine } from '../../utils/rag-engine'
import { idsNamedIn, provisionIds, ragProvisions, type RagProvision } from '../../utils/rag-provisions'

const q = (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])

const CACHE_MS = 10 * 60 * 1000
/** the shared engine, reloaded when the rag tables change (server/utils/rag-engine.ts) */
const engineOf = (): Promise<Engine> => ragEngine()

const TENURES = [
  { key: 'torrens', label: 'Torrens title' },
  { key: 'strata', label: 'Strata' },
  { key: 'community', label: 'Community title' },
] as const

export interface SubdivisionAnswer {
  tenure: string
  label: string
  verdict: string
  /** The engine's own answer text (writeAnswer). */
  text: string
  explained: Pick<Explained, 'claims' | 'steps' | 'limits' | 'notChecked' | 'checks' | 'asAt' | 'branches'>
}
/**
 * What the new lots are for. The minimum differs by purpose: the LEP sets one for any subdivision, and the Housing SEPP
 * its own for a dual occupancy (s 169) or terraces (s 173) in a low and mid rise housing area - which only a question
 * about that purpose reaches.
 */
export const PURPOSES = [
  { use: 'dwelling house', label: 'Dwelling houses' },
  { use: 'dual occupancy', label: 'Dual occupancy' },
  { use: 'multi dwelling housing (terraces)', label: 'Terraces' },
] as const
export interface SubdivisionPurpose { use: string; label: string; answers: SubdivisionAnswer[] }
export interface ReportSubdivisionResponse {
  engine: 'rag' | 'none'
  /** Why the RAG cannot answer this lot, when it cannot. */
  reason?: string
  plan: string | null
  lot: { zone: string | null; areaM2: number | null; lotSizeMinM2: number | null; lots: number } | null
  purposes: SubdivisionPurpose[]
  /** The words and link of every provision any trace names. */
  provisions: Record<string, RagProvision>
  ms: number
}

export default defineEventHandler(async (event): Promise<ReportSubdivisionResponse> => {
  const started = Date.now()
  const query = getQuery(event)
  const cadid = String(query.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const lots = query.lots ? Math.max(2, Number(query.lots)) : 2
  const only = query.use ? landUseKey(String(query.use)) : null

  let f: any
  try { f = await lotFacts(q as any, cadid, landUseKey) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }

  const plans = (await q(`SELECT title FROM rag.instrument WHERE kind = 'lep'`).catch(() => ({ rows: [] as any[] }))).rows.map(r => String(r.title))
  if (!f.epi || !plans.includes(f.epi)) {
    return { engine: 'none', reason: `The RAG holds ${plans.join(', ') || 'no plan'}; this lot is under ${f.epi ?? 'no mapped LEP'}.`,
      plan: f.epi ?? null, lot: null, purposes: [], provisions: {}, ms: Date.now() - started }
  }

  const [E, lot] = await Promise.all([engineOf(), ragLotFacts(q, cadid)])
  const ids = new Set<string>()
  const purposes = PURPOSES.filter(p => !only || landUseKey(p.use) === only).map(p => ({
    use: p.use, label: p.label,
    answers: TENURES.map((t) => {
      const r = evaluate(E, { kind: 'subdivision', use: p.use, lots, tenure: t.key, proposal: 'subdivision', consentDate: null, combinedDa: null }, lot)
      const x = explain(E, r)
      provisionIds(x, ids)
      idsNamedIn(E, x, ids)
      return { tenure: t.key, label: t.label, verdict: r.verdict, text: writeAnswer(E, r, lot),
        explained: { claims: x.claims, steps: x.steps, limits: x.limits, notChecked: x.notChecked, checks: x.checks, asAt: x.asAt, branches: x.branches } }
    }),
  }))
  const provisions = await ragProvisions(ids)
  setHeader(event, 'cache-control', 'public, max-age=60')
  return { engine: 'rag', plan: f.epi, lot: { zone: f.zone ?? null, areaM2: f.areaM2 ?? null, lotSizeMinM2: f.lotSizeMinM2 ?? null, lots }, purposes, provisions, ms: Date.now() - started }
})
