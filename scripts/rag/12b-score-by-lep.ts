/**
 * RAG pilot - side D's scores per LEP: how the deterministic engine does on each plan's keyed questions, and which ones it
 * gets wrong or leaves at "maybe" - so a newly added LEP is judged on its own, not hidden inside the totals.
 *
 *   npx tsx scripts/rag/12b-score-by-lep.ts            # D's latest answer per question, scored as 12-score.ts scores it
 *   npx tsx scripts/rag/12b-score-by-lep.ts --misses   # and list every wrong or unanswered keyed question
 */
import 'dotenv/config'
import pg from 'pg'
import { loadCorpus } from '../../shared/rag/retrieve'
import { score } from './12-score'

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const C = await loadCorpus(q)
  const rows = (await q(`
    SELECT DISTINCT ON (a.question_id) a.question_id, a.answer, qn.text, qn.set_name, qn.clause, qn.expected, coalesce(i.title, '(no LEP)') AS lep
      FROM rag.answer a JOIN rag.run r ON r.id = a.run_id JOIN rag.question qn ON qn.id = a.question_id LEFT JOIN rag.instrument i ON i.document_id = qn.document_id
     WHERE a.variant = 'D' ORDER BY a.question_id, r.started_at DESC`)).rows
  const by: Record<string, { answers: number; keyed: number; scored: number; correct: number; wrong: number; cw: number; abstained: number; misses: string[] }> = {}
  for (const r of rows) {
    const t = (by[r.lep] ??= { answers: 0, keyed: 0, scored: 0, correct: 0, wrong: 0, cw: 0, abstained: 0, misses: [] })
    t.answers++
    if (r.expected?.status && r.expected.status !== 'none') t.keyed++
    const s = score(C, r.expected, r.answer)
    if (!s) continue
    t.scored++
    if (s.correct) t.correct++; else t.wrong++
    if (s.confidently_wrong) t.cw++
    if (s.abstained) t.abstained++
    if (!s.correct) t.misses.push(`${s.confidently_wrong ? 'WRONG ' : 'maybe '} [${r.expected?.status}] ${r.set_name} ${r.clause ?? ''}: ${r.text.slice(0, 110)} -> D ${r.answer?.verdict ?? r.answer?.value ?? '-'}, key ${r.expected?.verdict ?? r.expected?.value ?? JSON.stringify(r.expected?.values ?? null)}`)
  }
  const pct = (a: number, n: number) => n ? `${Math.round(100 * a / n)}%` : '-'
  console.log('LEP'.padEnd(42), 'answers keyed scored  correct  conf.wrong  abstained')
  for (const [lep, t] of Object.entries(by).sort()) {
    console.log(lep.padEnd(42), String(t.answers).padStart(7), String(t.keyed).padStart(5), String(t.scored).padStart(6), pct(t.correct, t.scored).padStart(8), pct(t.cw, t.scored).padStart(11), pct(t.abstained, t.scored).padStart(10))
    if (process.argv.includes('--misses')) for (const m of t.misses) console.log('   ', m)
  }
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
