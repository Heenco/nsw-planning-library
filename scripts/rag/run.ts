/**
 * RAG pilot - the whole pipeline, in order, for every instrument in scripts/rag/corpus.json.
 *
 *   npx tsx scripts/rag/run.ts                       # the pipeline and side D, scored against the expected answers - no paid model
 *   npx tsx scripts/rag/run.ts --with-llm-variants   # also the model-written RAG variants (contexts, embeddings, retrieval, R0-R4 / L0
 *                                                    # answers) - paid; D is the answer, these were only ever the comparison
 *   npx tsx scripts/rag/run.ts --no-llm              # only the stages that call no paid model (the deterministic side D)
 *   npx tsx scripts/rag/run.ts --from questions      # start at a stage
 *   npx tsx scripts/rag/run.ts --only claims,bindings
 *   npx tsx scripts/rag/run.ts --skip engine
 *   npx tsx scripts/rag/run.ts --plan                # print what would run, run nothing
 *   npx tsx scripts/rag/run.ts --variants R3,L0      # which RAG variants the answers stage runs (default R0,R1,R2,R3,L0,R4)
 *   npx tsx scripts/rag/run.ts --with-pilot          # also run side P, the CDC engine, as a comparison (slow: one run per question)
 *   npx tsx scripts/rag/run.ts --refresh-controls    # re-copy the maps' additional controls from UrbanPortalDBP first (SSH)
 *   npx tsx scripts/rag/run.ts --lep "<title>"        # the answers stage asks only that plan's questions (a newly added LEP)
 *
 * The rag engine (side D) and the RAG variants never call the CDC engine. Side P exists only to compare against it, so
 * it is off unless asked for.
 *
 * Adding an LEP: name it in corpus.json and run this. The CDC pilot must have built its structure (pilot.node) - the
 * snapshot says so if not. Every stage is incremental or idempotent: the snapshot replaces only instruments whose text
 * changed, contexts and embeddings are made only for chunks without them, answers resume (--resume) rather than repeat.
 *
 * Models: the paid stages use shared/rag/deepinfra.ts - RAG_LLM=anthropic (and ANTHROPIC_API_KEY) in .env puts contexts
 * and answers on Claude; embeddings stay on DeepInfra. `npx tsx scripts/rag/check-llm.ts` tests the keys first.
 */
import { spawnSync } from 'node:child_process'

interface Stage { id: string; what: string; cmd: string[]; paid?: string; optIn?: string }
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const list = (k: string) => (arg(k) ?? '').split(',').map(s => s.trim()).filter(Boolean)
const tsx = (f: string, ...a: string[]) => ['npx', 'tsx', `scripts/rag/${f}`, ...a]
const py = (f: string, ...a: string[]) => ['python', `scripts/rag/${f}`, ...a]

const STAGES: Stage[] = [
  { id: 'controls', what: 'the maps’ additional controls, copied from UrbanPortalDBP (rag.additional_controls)', cmd: py('01c-additional-controls.py'), optIn: '--refresh-controls' },
  { id: 'snapshot', what: 'provisions of every instrument in corpus.json (only new or changed ones replaced)', cmd: tsx('01-snapshot.ts') },
  { id: 'currency', what: 'is the text still the law: clauses added / changed / removed since its as-at date (legislation XML)', cmd: py('01d-currency.py') },
  { id: 'groups', what: 'Land Use Table zones and other clause groups, from each instrument\'s XML', cmd: py('01b-groups.py') },
  { id: 'terms', what: 'definitions as provisions, from the XML', cmd: py('02a-terms.py') },
  // claims before relations (cl 4.6 reads the standards) and again after (frames read applies_only_if)
  { id: 'claims-pre', what: 'claims, first pass', cmd: tsx('02c-claims.ts') },
  { id: 'relations', what: 'relations: references, definitions, overrides, statutory rules', cmd: tsx('02-relations.ts') },
  { id: 'claims', what: 'claims, with frames from the relations', cmd: tsx('02c-claims.ts') },
  { id: 'bindings', what: 'how each condition is tested on a lot (or why it cannot be)', cmd: tsx('02d-bindings.ts') },
  { id: 'chunks', what: 'retrieval chunks (unchanged chunks keep their embeddings)', cmd: tsx('03-chunks.ts') },
  { id: 'context', what: 'a model-written context for each chunk without one', cmd: tsx('04-context.ts'), paid: 'context model', optIn: '--with-llm-variants' },
  { id: 'embed', what: 'embeddings for chunks without them (DeepInfra bge-en-icl)', cmd: tsx('05-embed.ts'), paid: 'embeddings', optIn: '--with-llm-variants' },
  { id: 'questions', what: 'the question bank with frozen lot facts, per LEP', cmd: tsx('06-questions.ts') },
  { id: 'drafts', what: 'Claude\'s draft keys for the hand-written plan\'s grid', cmd: tsx('11-grid-drafts.ts') },
  { id: 'engine', what: 'side P, for comparison only: the CDC engine on each question\'s plan', cmd: tsx('07-engine.ts'), optIn: '--with-pilot' },
  { id: 'resolver', what: 'the resolver\'s precedence keys', cmd: tsx('08-resolver-check.ts') },
  { id: 'deterministic', what: 'side D: the deterministic engine answers every question', cmd: tsx('15-deterministic.ts') },
  { id: 'retrieval', what: 'retrieval recall per variant (embeds the questions)', cmd: tsx('09-retrieval.ts'), paid: 'query embeddings', optIn: '--with-llm-variants' },
  { id: 'answers', what: 'RAG answers, resuming', cmd: tsx('10-answer.ts', '--variants', arg('--variants') ?? 'R0,R1,R2,R3,L0,R4', '--resume'), paid: 'answer model', optIn: '--with-llm-variants' },
  { id: 'score', what: 'scores for every side', cmd: tsx('12-score.ts') },
]

const from = arg('--from'), only = list('--only'), skip = list('--skip')
// a plan title has spaces, and npx runs through a shell on Windows: the answers stage reads it from the environment
if (arg('--lep')) process.env.RAG_LEP = arg('--lep')
const noLlm = process.argv.includes('--no-llm'), planOnly = process.argv.includes('--plan')
for (const id of [from, ...only, ...skip].filter(Boolean) as string[]) if (!STAGES.some(s => s.id === id)) { console.error(`no stage "${id}" - stages: ${STAGES.map(s => s.id).join(', ')}`); process.exit(2) }
const start = from ? STAGES.findIndex(s => s.id === from) : 0
const todo = STAGES.filter((s, i) => i >= start && (!only.length || only.includes(s.id)) && !skip.includes(s.id) && !(noLlm && s.paid)
  && !(s.optIn && !process.argv.includes(s.optIn) && !only.includes(s.id)))

console.log(`rag pipeline: ${todo.length} stage(s)${noLlm ? ' (no paid model stages)' : ''}`)
for (const s of STAGES) console.log(`  ${todo.includes(s) ? '>' : ' '} ${s.id.padEnd(14)} ${s.what}${s.paid ? `  [paid: ${s.paid}]` : ''}${s.optIn ? `  [only with ${s.optIn}]` : ''}`)
if (planOnly) process.exit(0)

const t0 = Date.now()
for (const s of todo) {
  const t = Date.now()
  console.log(`\n=== ${s.id} - ${s.cmd.slice(1).join(' ')}`)
  // npx needs a shell on Windows; arguments here have no spaces
  const r = spawnSync(s.cmd[0]!, s.cmd.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) { console.error(`\n${s.id} failed (exit ${r.status}) after ${Math.round((Date.now() - t) / 1000)} s - fix it and resume with --from ${s.id}`); process.exit(r.status ?? 1) }
  console.log(`=== ${s.id} done in ${Math.round((Date.now() - t) / 1000)} s`)
}
console.log(`\nall ${todo.length} stage(s) done in ${Math.round((Date.now() - t0) / 60000)} min`)
