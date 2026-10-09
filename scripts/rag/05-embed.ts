/**
 * RAG pilot, Phase 3.3 - embeddings in three variants (schema rag; plan shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/05-embed.ts               # every (chunk, variant) not yet embedded
 *
 *   plain        the chunk's words only                                  (R0)
 *   structural   its deterministic header + the words                    (R1)
 *   contextual   the model-written context + header + words (04-context) (R2)
 *
 * bge-en-icl, 4096 dims, the model the app already embeds with. A chunk whose text changed lost its embeddings in
 * 03-chunks.ts, so re-running embeds only what is new. 'contextual' waits for its chunk's llm_context.
 */
import 'dotenv/config'
import pg from 'pg'
import { embed, costOf, MODELS } from '../../shared/rag/deepinfra'

const EMBED_TEXT: Record<string, (c: { header: string; body: string; llm_context: string | null }) => string | null> = {
  plain: c => c.body,
  structural: c => `${c.header}\n${c.body}`,
  contextual: c => c.llm_context ? `${c.llm_context}\n${c.header}\n${c.body}` : null,
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('embed', $1) RETURNING id`, [JSON.stringify({ model: MODELS.embed })])).rows[0].id
  const counts: Record<string, number> = {}; let tokens = 0
  for (const [variant, textOf] of Object.entries(EMBED_TEXT)) {
    const todo = (await q(`SELECT c.id, c.header, c.body, c.llm_context FROM rag.chunk c
                            WHERE NOT EXISTS (SELECT 1 FROM rag.embedding e WHERE e.chunk_id = c.id AND e.variant = $1 AND e.model = $2)`, [variant, MODELS.embed])).rows
      .map(c => ({ id: c.id as string, text: textOf(c) })).filter(c => c.text) as { id: string; text: string }[]
    for (let i = 0; i < todo.length; i += 64) {
      const batch = todo.slice(i, i + 64)
      // bge-en-icl reads 8k tokens; a chunk is capped near 4k chars, the contextual text a little more
      const r = await embed(batch.map(b => b.text.slice(0, 24_000)))
      tokens += r.tokens
      await q(`INSERT INTO rag.embedding (chunk_id, variant, model, vec)
               SELECT x.id, $2, $3, x.v::vector FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, v text)
               ON CONFLICT (chunk_id, variant, model) DO UPDATE SET vec = excluded.vec`,
        [JSON.stringify(batch.map((b, k) => ({ id: b.id, v: `[${r.vecs[k]!.join(',')}]` }))), variant, MODELS.embed])
    }
    counts[variant] = todo.length
    console.log(variant, todo.length)
  }
  const result = { embedded: counts, tokens, cost_usd: +costOf(MODELS.embed, tokens, 0).toFixed(4) }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify(result)])
  console.log(result)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
