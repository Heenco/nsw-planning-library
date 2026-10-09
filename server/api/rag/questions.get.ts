/**
 * GET /api/rag/questions - every question of the RAG pilot with each side's latest answer in one line, for the /rag
 * question browser. The full answer with its clause trace is /api/rag/question?id=.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export default defineEventHandler(async () => {
  const q = async (sql: string, p: unknown[] = []) => { try { return (await nswQuery<any>(sql, p as any[])).rows } catch { return [] } }
  const [questions, answers, engine] = await Promise.all([
    q(`SELECT id, set_name, clause, kind, text, expected->>'status' AS status, expected->>'verdict' AS e_verdict, expected->>'value' AS e_value, expected->'values' AS e_values, expected->>'source' AS e_source
         FROM rag.question ORDER BY CASE set_name WHEN 'hard_case' THEN 1 WHEN 'local' THEN 2 WHEN 'propcode' THEN 3 WHEN 'pilot_key' THEN 4 ELSE 5 END, clause, text`),
    q(`SELECT DISTINCT ON (a.question_id, a.variant) a.question_id, a.variant, a.answer->>'verdict' AS verdict, a.answer->>'value' AS value, (a.answer ? 'unparsed') AS unparsed
         FROM rag.answer a JOIN rag.run r ON r.id = a.run_id WHERE a.variant IN ('D', 'R3', 'L0', 'R4') ORDER BY a.question_id, a.variant, r.started_at DESC`),
    q(`SELECT question_id, verdict FROM rag.engine_answer`),
  ])
  const by = new Map<string, Record<string, { verdict: string | null; value: string | null }>>()
  for (const a of answers) by.set(a.question_id, { ...(by.get(a.question_id) ?? {}), [a.variant]: { verdict: a.unparsed ? 'unparsed' : a.verdict, value: a.value } })
  for (const e of engine) by.set(e.question_id, { ...(by.get(e.question_id) ?? {}), P: { verdict: e.verdict, value: null } })
  return questions.map(x => ({ ...x, sides: by.get(x.id) ?? {} }))
})
