/**
 * RAG pilot, Phase 6.1 - retrieval only: is the controlling clause among the first k, per variant? Measured before any
 * answering, so no answer is paid for on top of bad retrieval.
 *
 *   npx tsx scripts/rag/09-retrieval.ts
 *
 * Gold = the clauses in a question's expected answer (controlling, and displaced where the answer turns on an override).
 * Questions without an expected answer (the grid, until adjudicated) are not scored here. A hit is the clause, not the
 * exact subclause: chunks are whole clauses.
 */
import 'dotenv/config'
import pg from 'pg'
import { embed } from '../../shared/rag/deepinfra'
import { loadCorpus, search, expand, provisionOf, clauseKey, queryVec, type Corpus } from '../../shared/rag/retrieve'

export function goldOf(C: Corpus, expected: any): string[] {
  const refs: string[] = [...(expected?.controlling ?? []), ...(expected?.displaced ?? [])]
  const out = new Set<string>()
  for (const r of refs) {
    const [inst, rest] = r.split(':') as [string, string]
    const id = provisionOf(C, `${inst === 'housing' ? 'Housing SEPP' : 'Randwick LEP'} ${rest}`, inst === 'housing' ? 'sepp' : 'lep')
    const p = id ? C.provs.get(id) : null
    if (p) out.add(`${p.document_id}|${clauseKey(p.local_id, p.path)}`)
  }
  return [...out]
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const C = await loadCorpus(q)
  const questions = (await q(`SELECT id, set_name, clause, text, expected FROM rag.question WHERE expected->>'status' <> 'none' ORDER BY set_name, clause`)).rows
  const K = [3, 5, 8]
  const rows: any[] = []
  const tally: Record<string, Record<string, number>> = {}
  for (const x of questions) {
    const gold = goldOf(C, x.expected)
    if (!gold.length) continue
    const qv = await queryVec(x.text, embed)
    for (const v of ['R0', 'R1', 'R2', 'R3']) {
      const hits = search(C, v, x.text, qv, 8).map(h => h.chunk)
      const listAt = (k: number) => v === 'R3' ? [...hits.slice(0, k), ...expand(C, hits.slice(0, k), k).map(e => e.chunk)] : hits.slice(0, k)
      const keys = listAt(8).map(c => `${c.document_id}|${c.clause}`)
      const t = (tally[v] ??= { n: 0 })
      t.n!++
      for (const k of K) {
        const top = new Set(listAt(k).map(c => `${c.document_id}|${c.clause}`))   // R3: the k hits and what they pull in (at most k more)
        const any = gold.some(g => top.has(g)), all = gold.every(g => top.has(g))
        t[`any@${k}`] = (t[`any@${k}`] ?? 0) + (any ? 1 : 0); t[`all@${k}`] = (t[`all@${k}`] ?? 0) + (all ? 1 : 0)
      }
      rows.push({ q: x.id, v, gold, got: keys.slice(0, 8), missing: gold.filter(g => !keys.includes(g)) })
    }
  }
  const pct = (a: number, n: number) => `${Math.round(100 * a / n)}%`
  console.log('variant  n   ' + K.map(k => `any@${k} all@${k}`).join('  '))
  const summary: Record<string, any> = {}
  for (const [v, t] of Object.entries(tally)) {
    summary[v] = Object.fromEntries(Object.entries(t).map(([k, n]) => [k, k === 'n' ? n : +(n / t.n!).toFixed(3)]))
    console.log(v.padEnd(8), String(t.n).padEnd(3), K.map(k => `${pct(t[`any@${k}`]!, t.n!).padStart(5)} ${pct(t[`all@${k}`]!, t.n!).padStart(6)}`).join('  '))
  }
  // what R2 most often misses, by clause
  const miss: Record<string, number> = {}
  for (const r of rows.filter(r => r.v === 'R2')) for (const m of r.missing) miss[m] = (miss[m] ?? 0) + 1
  const named = Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k.split('|')[0] === C.docs.sepp ? 'Housing ' : 'LEP '}${k.split('|')[1]} x${n}`)
  console.log('R2 misses (k=8):', named.join(', '))
  await q(`INSERT INTO rag.run (stage, config, counts, finished_at) VALUES ('retrieval', $1, $2, now())`, [JSON.stringify({ k: K, fusion: 'rrf60' }), JSON.stringify({ summary, r2_misses: named, rows })])
  await client.end()
}
if (process.argv[1]?.includes('09-retrieval')) main().catch(e => { console.error(e); process.exit(1) })
