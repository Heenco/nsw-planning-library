/**
 * RAG pilot, Phase 3.4 - a model-written context for every chunk: Anthropic's contextual retrieval (variant R2).
 *
 *   npx tsx scripts/rag/04-context.ts             # every chunk without a context (rag.chunk.llm_context IS NULL)
 *   npx tsx scripts/rag/04-context.ts --limit 20  # a sample
 *
 * The prompt is Anthropic's, unchanged in substance: the whole document, the chunk, "give a short succinct context to
 * situate this chunk within the overall document for the purposes of improving search retrieval". Kept pure on purpose -
 * it is variant R2, and R3 (relation expansion) is measured separately, so no relation is given to the model here.
 *
 * "The whole document" is the chunk's Part, Chapter or Schedule (rendered from the chunks under it, headers included),
 * capped at DOC_CHARS around the chunk: a Part is what a reader has in view, and the whole LEP (~100k tokens) per call
 * would cost 15x more for a context about the same clause. A definition's document is its dictionary entry and the
 * headers of the provisions that use the word (rag.relation defines).
 */
import 'dotenv/config'
import pg from 'pg'
import { chat, pool, MODELS } from '../../shared/rag/deepinfra'

const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity
const DOC_CHARS = 40_000
const CONCURRENCY = 8

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const chunks = (await q(`
    SELECT c.id, c.role, c.header, c.body, c.llm_context, p.id AS pid, p.document_id, p.path, p.kind, p.local_id
      FROM rag.chunk c JOIN rag.provision p ON p.id = c.provision_id ORDER BY p.document_id, p.sort, p.path, p.ordinal`)).rows
  // the top container (Part / Chapter / Schedule / Dictionary) a chunk sits in: the first two path levels for a SEPP chapter
  const containerOf = (c: any) => { const path: string[] = c.path ?? []; const top = path.find(x => /^(pt|sch|dict)/.test(x) || /^ch\.[^-]+-pt\./.test(x)) ?? path[0] ?? c.local_id; return `${c.document_id}|${top}` }
  const groups = new Map<string, any[]>()
  for (const c of chunks) if (c.role !== 'definition') { const k = containerOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c) }
  const uses = new Map<string, string[]>()
  for (const r of (await q(`SELECT r.from_provision, string_agg(DISTINCT left(c.header, 160), ' | ') h FROM rag.relation r JOIN rag.chunk c ON c.provision_id = r.to_provision
                            WHERE r.kind = 'defines' GROUP BY 1`)).rows) uses.set(r.from_provision, String(r.h).split(' | ').slice(0, 12))

  const docFor = (c: any): string => {
    if (c.role === 'definition') return [`${c.header}\n${c.body}`, '', 'Provisions that use this term:', ...(uses.get(c.pid) ?? ['(none in scope)'])].join('\n')
    const g = groups.get(containerOf(c)) ?? [c]
    const parts = g.map(x => `${x.header}\n${x.body}`)
    let i = g.findIndex(x => x.id === c.id), lo = i, hi = i, len = parts[i]?.length ?? 0
    while ((lo > 0 || hi < parts.length - 1) && len < DOC_CHARS) {
      if (hi < parts.length - 1) { hi++; len += parts[hi]!.length }
      if (lo > 0 && len < DOC_CHARS) { lo--; len += parts[lo]!.length }
    }
    return parts.slice(lo, hi + 1).join('\n\n')
  }

  const todo = chunks.filter(c => !c.llm_context).slice(0, LIMIT)
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('context', $1) RETURNING id`, [JSON.stringify({ model: MODELS.context, doc_chars: DOC_CHARS, chunks: todo.length })])).rows[0].id
  console.log('chunks without a context:', todo.length, 'of', chunks.length)
  let done = 0, cost = 0, tin = 0, tout = 0, failed = 0
  await pool(todo, CONCURRENCY, async c => {
    try {
      const r = await chat({ model: MODELS.context, maxTokens: 160, messages: [{ role: 'user', content:
        `<document>\n${docFor(c)}\n</document>\nHere is the chunk we want to situate within the whole document\n<chunk>\n${c.header}\n${c.body}\n</chunk>\n`
        + 'Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. '
        + 'Answer only with the succinct context and nothing else.' }] })
      const ctx = r.content.trim()
      if (!ctx) throw new Error('empty context')
      await q(`UPDATE rag.chunk SET llm_context = $2 WHERE id = $1`, [c.id, ctx])
      cost += r.cost_usd; tin += r.tokens_in; tout += r.tokens_out
    } catch (e) { failed++; console.error('fail', c.header.slice(0, 80), String(e).slice(0, 200)) }
    if (++done % 50 === 0) console.log(done, '/', todo.length, `$${cost.toFixed(3)}`)
  })
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ written: done - failed, failed, tokens_in: tin, tokens_out: tout, cost_usd: +cost.toFixed(4) })])
  console.log({ written: done - failed, failed, tokens_in: tin, tokens_out: tout, cost_usd: +cost.toFixed(4) })
  const sample = (await q(`SELECT header, llm_context FROM rag.chunk WHERE llm_context IS NOT NULL ORDER BY random() LIMIT 3`)).rows
  for (const s of sample) console.log('\n--', s.header, '\n', s.llm_context)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
