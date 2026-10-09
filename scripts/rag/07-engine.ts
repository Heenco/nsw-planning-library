/**
 * RAG pilot, Phase 4.5 - the deterministic side's answers, frozen (schema rag; plan shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/07-engine.ts
 *
 * Every question with a lot and a permissibility or subdivision question goes to the engine exactly as the CDC session's
 * engine keys do (scripts/norms/pilot-key.ts against the plan's pilot shadow), and the verdict, the controlling clauses and
 * the land use table status are stored with the pilot run they read. Questions the engine does not answer (a figure, a
 * precedence question, a lot-free question) are stored as 'not_answered' - that is part of the comparison, not a gap to hide.
 */
import 'dotenv/config'
import pg from 'pg'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  // the pilot runs on one plan: the corpus's LEP (with more than one, the plan each question's lot falls under is needed - not built)
  const leps = (await q(`SELECT document_id, title FROM rag.instrument WHERE kind = 'lep'`)).rows
  if (leps.length !== 1) throw new Error(`the pilot runs on one plan; the corpus holds ${leps.length} LEPs`)
  const PLAN: string = leps[0].title
  const pilotRun = (await q(`SELECT id FROM pilot.run WHERE document_id = $1 AND stage = 'propositions' ORDER BY started_at DESC LIMIT 1`, [leps[0].document_id])).rows[0]?.id ?? null
  const questions = (await q(`SELECT id, set_name, cadid, kind, use_term, text FROM rag.question ORDER BY set_name, clause`)).rows
  const stage = (await q(`INSERT INTO rag.run (stage, config) VALUES ('engine', $1) RETURNING id`, [JSON.stringify({ plan: PLAN, pilot_run: pilotRun })])).rows[0].id
  await q(`DELETE FROM rag.engine_answer`)
  const tally: Record<string, number> = {}
  for (const x of questions) {
    let verdict = 'not_answered', controlling: string[] = [], payload: any = { why: 'the engine answers permissibility and subdivision for a lot; not figures, precedence or lot-free questions' }
    if (x.cadid && ['permissibility', 'subdivision'].includes(x.kind) && x.use_term) {
      const args = ['tsx', 'scripts/norms/pilot-key.ts', '--plan', PLAN, '--cadid', x.cadid, '--use', x.use_term, ...(x.kind === 'subdivision' ? ['--proposal', 'subdivision', '--lots', '2'] : [])]
      try {
        // npx needs a shell on Windows, and a shell splits on spaces: quote what has them (the plan title, the use)
        const { stdout } = await run('npx', args.map(a => /\s/.test(a) ? `"${a}"` : a), { cwd: process.cwd(), shell: true, timeout: 600_000, maxBuffer: 50 << 20 })
        const m = stdout.match(/^RESULT (\{.*\})$/m)
        const res = m ? JSON.parse(m[1]!) : null
        if (res) {
          verdict = res.outcome ?? 'unknown'; controlling = res.by ?? []
          payload = { ...res, depends: [...stdout.matchAll(/^\s+depends \(([^)]+)\): cl (\S+) - (.*)$/gm)].map(d => ({ who: d[1], clause: d[2], why: d[3] })),
            standards: [...stdout.matchAll(/^\s+standard (\S+): holds=(\S+)$/gm)].map(s => ({ id: s[1]!.replace(/^.*:graph:/, '').replace(/:.*$/, ''), holds: s[2] })).slice(0, 30) }
        } else { verdict = 'error'; payload = { tail: stdout.slice(-500) } }
      } catch (e: any) { verdict = 'error'; payload = { error: String(e.stderr ?? e).slice(-500) } }
    }
    tally[verdict] = (tally[verdict] ?? 0) + 1
    await q(`INSERT INTO rag.engine_answer (question_id, run_id, pilot_run, verdict, controlling, payload) VALUES ($1, $2, $3, $4, $5, $6)`, [x.id, stage, pilotRun, verdict, controlling, payload])
    if (verdict !== 'not_answered') console.log(verdict.padEnd(12), (controlling.join(',') || '-').padEnd(16), x.set_name.padEnd(9), x.text.slice(0, 110))
  }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [stage, JSON.stringify({ questions: questions.length, verdicts: tally, pilot_run: pilotRun })])
  console.log(tally)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
