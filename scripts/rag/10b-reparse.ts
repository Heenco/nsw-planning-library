/**
 * RAG pilot - re-read answers stored as unparsed (an answer cut off at the output limit), with the salvaging parser in
 * shared/rag/answer.ts, and recompute their checks. The stored raw text is the answer's first 2,000 characters; the
 * decision (verdict, value, controlling) comes first in it, the quotes are what the limit cut.
 *
 *   npx tsx scripts/rag/10b-reparse.ts
 */
import 'dotenv/config'
import pg from 'pg'
import { loadCorpus } from '../../shared/rag/retrieve'
import { parseAnswer, checks } from '../../shared/rag/answer'

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const C = await loadCorpus(q)
  const rows = (await q(`SELECT id, variant, answer->>'unparsed' raw FROM rag.answer WHERE answer ? 'unparsed'`)).rows
  const tally: Record<string, number> = {}
  for (const r of rows) {
    const a = parseAnswer(r.raw ?? '')
    const k = `${r.variant}:${a ? 'salvaged' : 'still unparsed'}`; tally[k] = (tally[k] ?? 0) + 1
    if (!a) continue
    await q(`UPDATE rag.answer SET answer = $2, checks = $3 WHERE id = $1`, [r.id, JSON.stringify({ ...a, raw_head: String(r.raw).slice(0, 2000) }), JSON.stringify({ ...checks(C, a), truncated: true })])
  }
  console.log(tally)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
