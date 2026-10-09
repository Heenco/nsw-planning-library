/**
 * RAG pilot - ask the deterministic engine one question about one lot, no model (shared/rag/evaluate.ts over rag.claim).
 *
 *   npx tsx scripts/rag/14-ask.ts --lot B//DP402228 --use "secondary dwelling"
 *   npx tsx scripts/rag/14-ask.ts --lot 5008//DP752015 --use "dual occupancy (attached)" --topic fsr
 *   add --proposal subdivision, --detached yes|no, --trace to print every claim tested
 * The lot is found by its lot id or cadid among the questions' frozen lot facts.
 */
import 'dotenv/config'
import pg from 'pg'
import { loadEngine, evaluate, writeAnswer } from '../../shared/rag/evaluate'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d }

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const id = arg('--lot')
  const lot = (await q(`SELECT lot_facts FROM rag.question WHERE lot_facts->>'lot' = $1 OR cadid = $1 LIMIT 1`, [id])).rows[0]?.lot_facts
  if (!lot) throw new Error(`no frozen lot facts for ${id}`)
  const E = await loadEngine(q)
  const topic = arg('--topic'), det = arg('--detached')
  const r = evaluate(E, { kind: topic ? 'standard' : 'permissibility', use: arg('--use', 'dual occupancy'), topic: topic || undefined, proposal: (arg('--proposal', 'development') as any), detached: det ? det === 'yes' : null }, lot)
  console.log(writeAnswer(E, r, lot))
  if (process.argv.includes('--trace')) {
    console.log('\n--- claims tested')
    for (const t of r.tested) console.log(`  ${t.holds == null ? '?' : t.holds ? '+' : '-'} ${E.label(t.claim.provision_id)} ${t.claim.kind} ${t.claim.value ?? ''}  <- ${t.why.join('; ')}`)
  }
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
