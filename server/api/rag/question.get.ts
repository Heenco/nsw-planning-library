/**
 * GET /api/rag/question?id= - one question of the RAG pilot, every side's answer and how it was reached, with the words
 * of every provision involved and a link to it on the NSW legislation website.
 *
 *   D        the rag engine with no model: its full trace (claims tested and why, precedence steps, case splits, limits,
 *            sub-questions), from rag.answer.trace.explain (scripts/rag/15-deterministic.ts)
 *   P        the CDC session's engine (LEP pilot): verdict and the clauses it named (rag.engine_answer)
 *   R3 L0 R4 the LLM variants: the answer the model wrote, what was retrieved, the automatic checks
 *   expected the answer key, and who wrote it (pilot key, Manni's ruling, Claude's draft)
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { labelOf, urlOf, refToLocal } from '#shared/rag/refs'

export default defineEventHandler(async (event) => {
  const id = String(getQuery(event).id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'id must be a question uuid' })
  const q = async (sql: string, p: unknown[] = []) => (await nswQuery<any>(sql, p as any[])).rows
  const question = (await q(`SELECT id, set_name, clause, kind, use_term, text, expected, lot_facts, tags FROM rag.question WHERE id = $1`, [id]))[0]
  if (!question) throw createError({ statusCode: 404, statusMessage: 'no such question' })
  const answers = await q(`SELECT DISTINCT ON (a.variant) a.variant, a.model, a.answer, a.checks, a.retrieved, a.trace, a.latency_ms, a.cost_usd
                             FROM rag.answer a JOIN rag.run r ON r.id = a.run_id WHERE a.question_id = $1 ORDER BY a.variant, r.started_at DESC`, [id])
  const engine = (await q(`SELECT verdict, controlling, payload FROM rag.engine_answer WHERE question_id = $1`, [id]))[0] ?? null
  const insts = await q(`SELECT document_id, kind, title, source_url FROM rag.instrument`)

  // every provision the answers touch: D's trace (by id), citations written as text (by reference), retrieved chunks
  const ids = new Set<string>(), refs: { ref: string; hint?: 'lep' | 'sepp' }[] = []
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x)) { x.forEach(walk); return }
    for (const k of ['provision_id', 'winner_id', 'loser_id']) if (typeof x[k] === 'string') ids.add(x[k])
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v)
  }
  for (const a of answers) {
    if (a.variant === 'D') { walk(a.trace?.explain); for (const c of a.trace?.cited ?? []) ids.add(c) }
    for (const c of a.answer?.controlling ?? []) refs.push({ ref: String(c) })
  }
  for (const c of engine?.controlling ?? []) if (c !== 'LUT') refs.push({ ref: `Randwick LEP cl ${c}`, hint: 'lep' })
  const chunkIds = answers.flatMap(a => (a.retrieved ?? []).map((r: any) => r.chunk)).filter(Boolean)
  const chunkProv = chunkIds.length ? await q(`SELECT id, provision_id FROM rag.chunk WHERE id = ANY($1::uuid[])`, [chunkIds]) : []
  for (const c of chunkProv) ids.add(c.provision_id)
  // a written citation -> the most specific provision we hold
  const refMap: Record<string, string | null> = {}
  for (const { ref, hint } of refs) {
    const r = refToLocal(ref, hint); if (!r) { refMap[ref] = null; continue }
    const doc = insts.find(i => i.kind === r.kind)?.document_id
    const hit = (await q(`SELECT id, local_id FROM rag.provision WHERE document_id = $1 AND local_id = ANY($2)`, [doc, r.ids]))
      .sort((a: any, b: any) => r.ids.indexOf(a.local_id) - r.ids.indexOf(b.local_id))[0]
    refMap[ref] = hit?.id ?? null; if (hit) ids.add(hit.id)
  }
  const rows = ids.size ? await q(`
    SELECT p.id, p.local_id, p.heading, coalesce(p.path, '{}') path, p.kind, i.kind doc_kind, i.source_url,
           left(concat_ws(' ', p.own_text, (SELECT string_agg(c.own_text, ' ' ORDER BY c.sort, c.local_id) FROM rag.provision c WHERE c.document_id = p.document_id AND c.local_id LIKE p.local_id || '-%' AND c.kind NOT IN ('cell', 'term'))), 1200) AS text,
           (SELECT pa.own_text FROM rag.provision pa WHERE pa.id = p.parent_id) AS stem
      FROM rag.provision p JOIN rag.instrument i USING (document_id) WHERE p.id = ANY($1::uuid[])`, [[...ids]]) : []
  const provisions = Object.fromEntries(rows.map((p: any) => [p.id, { label: labelOf(p), local_id: p.local_id, kind: p.kind, heading: p.heading, text: p.text, stem: p.stem, url: urlOf(p.source_url, p.local_id) }]))
  for (const c of chunkProv) for (const a of answers) for (const r of a.retrieved ?? []) if (r.chunk === c.id) r.provision_id = c.provision_id
  return { question, answers, engine, provisions, refs: refMap, instruments: insts.map(i => ({ kind: i.kind, title: i.title, url: i.source_url })) }
})
