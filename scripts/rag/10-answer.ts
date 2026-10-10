/**
 * RAG pilot, Phase 6.2 / 6.3 - answer the question bank with every variant, check every answer.
 *
 *   npx tsx scripts/rag/10-answer.ts --variants R0,R1,R2,R3,L0,R4 [--sets hard_case,propcode] [--limit 5] [--repeat 3] [--concurrency 6]
 *
 *   R0-R3  retrieve 8 chunks (R3: + up to 8 by relation expansion), one call
 *   L0     the whole corpus in the prompt, no retrieval - Anthropic's advice for a corpus under ~200k tokens; definitions
 *          are cut to their first sentence to fit Llama's 128k window, and that is recorded
 *   R4     the navigating agent with the resolver as a tool
 * Every answer stores what was retrieved, the parsed answer, the checks (shared/rag/answer.ts), tokens, cost and latency.
 * Re-running adds rows (a new rag.run); --repeat measures stability.
 */
import 'dotenv/config'
import pg from 'pg'
import { chat, embed, pool, MODELS } from '../../shared/rag/deepinfra'
import { loadCorpus, search, expand, queryVec, scoped, docsFor, type Corpus } from '../../shared/rag/retrieve'
import { systemPrompt, showChunk, userPrompt, parseAnswer, checks } from '../../shared/rag/answer'
import { runAgent } from '../../shared/rag/agent'

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d }
const VARIANTS = arg('--variants', 'R0,R1,R2,R3,L0,R4').split(',')
const SETS = arg('--sets', '').split(',').filter(Boolean)
const LIMIT = Number(arg('--limit', '0')) || Infinity
const REPEAT = Number(arg('--repeat', '1'))
const CONC = Number(arg('--concurrency', '6'))

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const C0 = await loadCorpus(q)
  const questions = (await q(`SELECT id, set_name, document_id, clause, kind, text, lot_facts FROM rag.question WHERE coalesce(expected->>'status', '') <> 'retired' ${SETS.length ? 'AND set_name = ANY($1)' : ''} ORDER BY set_name, clause, cadid`, SETS.length ? [SETS] : [])).rows.slice(0, LIMIT)

  // L0: the operative text of the question's own instruments (its LEP and the SEPPs), in instrument order, definitions
  // cut to their first sentence - built once per LEP
  const l0s = new Map<string, string>()
  const l0Of = (Cq: Corpus) => {
    const key = [...(Cq.scope ?? [])].sort().join(',')
    if (!l0s.has(key)) l0s.set(key, [...Cq.chunks].filter(c => !Cq.scope || Cq.scope.has(c.document_id)).sort((a, b) => a.document_id.localeCompare(b.document_id) || a.header.localeCompare(b.header))
      .map(c => c.role === 'definition' ? `### ${c.header}\n${c.body.split(/(?<=\.)\s/)[0]}` : `### ${c.header}\n${c.body}`).join('\n\n'))
    return l0s.get(key)!
  }
  console.log('questions', questions.length, 'variants', VARIANTS.join(','), 'x', REPEAT, '| model', MODELS.answer)

  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('answer', $1) RETURNING id`, [JSON.stringify({ variants: VARIANTS, sets: SETS, repeat: REPEAT, model: MODELS.answer, k: 8, l0_definitions: 'first sentence' })])).rows[0].id
  // --resume: skip (question, variant) pairs that already have an answer from this model
  const done0 = process.argv.includes('--resume')
    ? new Set((await q(`SELECT question_id || '|' || variant k FROM rag.answer WHERE model = $1`, [MODELS.answer])).rows.map(r => r.k)) : new Set<string>()
  const jobs = questions.flatMap(x => VARIANTS.flatMap(v => Array.from({ length: REPEAT }, (_, r) => ({ x, v, r })))).filter(j => !done0.has(`${j.x.id}|${j.v}`))
  let done = 0, cost = 0, failed = 0
  await pool(jobs, CONC, async ({ x, v }) => {
    const t0 = Date.now()
    // the question reads its own LEP and the SEPPs, never another council's plan
    const C = scoped(C0, docsFor(C0, x.document_id))
    try {
      let answer, raw = '', retrieved: any[] = [], trace: any = null, tin = 0, tout = 0, c = 0
      if (v === 'R4') {
        // seeded with what R3 finds, then free to navigate (unseeded, Llama answered 3 in 4 questions without reading anything - kept as R4u)
        const hits = search(C, 'R3', x.text, await queryVec(x.text, embed), 8)
        const extra = expand(C, hits.map(h => h.chunk), 8)
        retrieved = [...hits.map(h => ({ chunk: h.chunk.id, header: h.chunk.header, why: 'search' })), ...extra.map(e => ({ chunk: e.chunk.id, header: e.chunk.header, why: e.why }))]
        const seed = [...hits.map(h => showChunk(h.chunk, 'R3')), ...extra.map(e => showChunk(e.chunk, 'R3', e.why))].join('\n\n')
        const r = await runAgent(C, x.text, x.lot_facts, { seed })
        answer = r.answer; raw = r.raw; trace = r.trace; tin = r.tokens_in; tout = r.tokens_out; c = r.cost_usd
      } else {
        let context: string
        if (v === 'L0') context = l0Of(C)
        else {
          const hits = search(C, v, x.text, await queryVec(x.text, embed), 8)
          const extra = v === 'R3' ? expand(C, hits.map(h => h.chunk), 8) : []
          retrieved = [...hits.map(h => ({ chunk: h.chunk.id, header: h.chunk.header, why: 'search' })), ...extra.map(e => ({ chunk: e.chunk.id, header: e.chunk.header, why: e.why }))]
          context = [...hits.map(h => showChunk(h.chunk, v)), ...extra.map(e => showChunk(e.chunk, v, e.why))].join('\n\n')
        }
        const r = await chat({ messages: [{ role: 'system', content: systemPrompt(C.insts) }, { role: 'user', content: userPrompt(x.text, x.lot_facts, context) }], maxTokens: 1200, json: true })
        answer = parseAnswer(r.content); raw = r.content; tin = r.tokens_in; tout = r.tokens_out; c = r.cost_usd
      }
      cost += c
      await q(`INSERT INTO rag.answer (run_id, question_id, variant, model, retrieved, answer, checks, trace, latency_ms, tokens_in, tokens_out, cost_usd)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [run, x.id, v, MODELS.answer, JSON.stringify(retrieved), JSON.stringify(answer ?? { unparsed: raw.slice(0, 2000) }), JSON.stringify(answer ? checks(C, answer) : { unparsed: true }),
         JSON.stringify(trace), Date.now() - t0, tin, tout, c])
    } catch (e) { failed++; console.error('fail', v, x.text.slice(0, 60), String(e).slice(0, 200)) }
    if (++done % 25 === 0) console.log(done, '/', jobs.length, `$${cost.toFixed(3)}`)
  })
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ answers: done - failed, failed, cost_usd: +cost.toFixed(4) })])
  console.log({ run, answers: done - failed, failed, cost_usd: +cost.toFixed(4) })
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
