/**
 * GET /api/rag/answer?cadid=&kind=permissibility&use=dual occupancy
 *     /api/rag/answer?cadid=&kind=standard&topic=height|fsr|lot_size|lot_width|floor_area&use=dwelling house
 *     /api/rag/answer?cadid=&kind=subdivision&use=dual occupancy&lots=2&tenure=torrens|strata|community
 *   optional: pathway=da|complying|exempt, consent_date=YYYY-MM-DD, under=<instrument title> (that instrument only)
 *
 * Side D answering live, with no model: the verdict or figure, the sentences writeAnswer() makes from the result only,
 * and the whole trace (explain(): every claim tested and why, the precedence steps, the cases, the limits, the checks that
 * could and could not be made), plus the currency caveats for the provisions it rests on - so a report section can show
 * the answer and why, from the same engine the /rag scores measure.
 */
import { ragLotFacts } from '#shared/rag/lot-facts'
import { evaluate, explain, writeAnswer, type Ask } from '#shared/rag/evaluate'

const KINDS = ['permissibility', 'standard', 'subdivision'] as const
const TOPICS = ['height', 'fsr', 'lot_size', 'lot_width', 'floor_area']

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const g = getQuery(event)
  const cadid = String(g.cadid ?? '').trim(), kind = String(g.kind ?? 'permissibility') as Ask['kind'], use = String(g.use ?? '').trim()
  if (!/^\d+$/.test(cadid)) throw createError({ statusCode: 400, statusMessage: 'cadid is required (digits)' })
  if (!KINDS.includes(kind as any)) throw createError({ statusCode: 400, statusMessage: `kind is one of ${KINDS.join(', ')}` })
  if (!use) throw createError({ statusCode: 400, statusMessage: 'use is required (a land use term, e.g. "dual occupancy")' })
  const topic = g.topic ? String(g.topic) : undefined
  if (kind === 'standard' && (!topic || !TOPICS.includes(topic))) throw createError({ statusCode: 400, statusMessage: `topic is one of ${TOPICS.join(', ')}` })
  const E = await ragEngine()
  const under = g.under ? E.insts.find(i => i.title.toLowerCase() === String(g.under).toLowerCase()) : undefined
  if (g.under && !under) throw createError({ statusCode: 400, statusMessage: `under: no instrument "${g.under}" in the corpus` })
  const ask: Ask = { kind, use, ...(topic ? { topic } : {}), proposal: kind === 'subdivision' ? 'subdivision' : 'development', pathway: (g.pathway as any) ?? undefined,
    ...(kind === 'subdivision' ? { lots: Number(g.lots ?? 2), tenure: (g.tenure as any) ?? 'torrens', consentDate: g.consent_date ? String(g.consent_date) : null, combinedDa: null } : {}),
    ...(under ? { only: under.document_id } : {}) }
  const lot: any = await ragLotFacts(ragQuery as any, cadid).catch((e: any) => { throw createError({ statusCode: 404, statusMessage: String(e?.message ?? e).slice(0, 200) }) })
  const r = evaluate(E, ask, lot)
  const trace = explain(E, r)
  // the provisions the answer rests on, and which of them changed since the corpus text
  const ids = new Set<string>()
  const walk = (x: any) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) { x.forEach(walk); return }
    for (const k of ['provision_id', 'winner_id', 'loser_id']) if (typeof x[k] === 'string') ids.add(x[k])
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v) }
  walk(trace)
  const changed = ids.size ? (await ragQuery(`SELECT c.note, c.source FROM rag.coverage c WHERE c.check_kind = 'text_changed_since' AND c.provision_id = ANY($1::uuid[])`, [[...ids]])).rows : []
  return {
    cadid, ask, verdict: r.verdict, answer: r.answer, text: writeAnswer(E, r, lot), trace,
    currency: { asAt: trace.asAt, clausesChanged: changed },
    lot: { address: lot.address, lot: lot.lot, zone: lot.zone, area_m2: lot.area_m2, epi: lot.epi },
    ms: Date.now() - started,
  }
})
