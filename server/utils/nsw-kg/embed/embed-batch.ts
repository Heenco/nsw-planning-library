// ── Stage 5a — embedding backfill for nsw.proposition ──────────────────
//
// Pulls propositions that don't yet have an embedding, builds the input
// text per proposition (subject + predicate + source_span + section
// context), embeds in batches via DeepInfra BAAI/bge-en-icl, writes back
// to the embedding column.
//
// Idempotent: only processes rows where embedding IS NULL.
// Resumable on crash.

import { embedTexts } from '../../embeddings'
import { withNswClient, nswQuery } from '../pool'

export interface EmbedBatchOptions {
  documentId?: string         // limit to one doc, or null for all
  batchSize?:  number         // default 32
  apiKey:      string
  onProgress?: (done: number, total: number) => void
}

export interface EmbedBatchResult {
  total:    number
  embedded: number
  skipped:  number
  ms:       number
}

interface PropRow {
  id:               string
  type:             string
  subject:          string
  predicate:        string
  object:           string | null
  source_span:      string
  section_local_id: string | null
  document_title:   string | null
  lga_name:         string | null
  scope:            string | null
}

/** Build the embedding input text for a proposition. Includes provenance
 *  prefix (document/LGA/section) for contextual retrieval. */
function propositionToEmbeddingText(p: PropRow): string {
  const parts: string[] = []
  if (p.document_title) parts.push(p.document_title)
  if (p.lga_name) parts.push(p.lga_name)
  else if (p.scope === 'state') parts.push('State-wide')
  if (p.section_local_id) parts.push(p.section_local_id)

  const core = `[${p.type}] ${p.subject} ${p.predicate}${p.object ? ' ' + p.object : ''}`
  const span = p.source_span ? ` — ${p.source_span}` : ''
  return parts.length > 0 ? `${parts.join(' | ')} — ${core}${span}` : `${core}${span}`
}

export async function embedNswPropositions(opts: EmbedBatchOptions): Promise<EmbedBatchResult> {
  const t0 = Date.now()
  const batchSize = opts.batchSize ?? 32

  // Count work to do (for progress reporting)
  const countSql = opts.documentId
    ? `SELECT count(*)::int AS n FROM proposition WHERE document_id = $1::uuid AND embedding IS NULL`
    : `SELECT count(*)::int AS n FROM proposition WHERE embedding IS NULL`
  const countParams = opts.documentId ? [opts.documentId] : []
  const total = (await nswQuery<{ n: number }>(countSql, countParams)).rows[0]?.n ?? 0

  if (total === 0) {
    return { total: 0, embedded: 0, skipped: 0, ms: Date.now() - t0 }
  }

  let embedded = 0

  // Process in batches. We hold one client for the duration of each batch
  // (fetch + insert) but release it between batches so other operations can
  // run.
  while (embedded < total) {
    const fetchSql = opts.documentId
      ? `
        SELECT
          p.id, p.type, p.subject, p.predicate, p.object, p.source_span,
          s.local_id AS section_local_id,
          d.title AS document_title,
          d.lga_name,
          d.scope
        FROM proposition p
        JOIN section s ON s.id = p.section_id
        JOIN document d ON d.id = p.document_id
        WHERE p.document_id = $1::uuid AND p.embedding IS NULL
        ORDER BY p.created_at
        LIMIT $2
      `
      : `
        SELECT
          p.id, p.type, p.subject, p.predicate, p.object, p.source_span,
          s.local_id AS section_local_id,
          d.title AS document_title,
          d.lga_name,
          d.scope
        FROM proposition p
        JOIN section s ON s.id = p.section_id
        JOIN document d ON d.id = p.document_id
        WHERE p.embedding IS NULL
        ORDER BY p.created_at
        LIMIT $1
      `
    const fetchParams = opts.documentId ? [opts.documentId, batchSize] : [batchSize]

    const { rows } = await nswQuery<PropRow>(fetchSql, fetchParams)
    if (rows.length === 0) break

    const texts = rows.map(propositionToEmbeddingText)
    const vectors = await embedTexts(texts, opts.apiKey)

    // Write embeddings back. pgvector accepts text format like '[1.0,2.0,...]'.
    await withNswClient(async (client) => {
      // Build parallel arrays for unnest
      const ids: string[] = []
      const embs: string[] = []
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!
        const vec = vectors[i]!
        ids.push(row.id)
        embs.push(`[${vec.join(',')}]`)
      }
      // Write the full-precision embedding AND the 2000-dim halfvec that
      // retrieve.ts queries via HNSW. Without setting embedding_2k here,
      // vector search silently skips these rows (they match embedding
      // IS NOT NULL but embedding_2k IS NULL). See also
      // scripts/backfill-embedding-2k.mts for the one-shot fixup.
      await client.query(`
        UPDATE proposition AS p
        SET embedding    = u.emb::vector,
            embedding_2k = subvector(u.emb::vector, 1, 2000)::halfvec(2000)
        FROM unnest($1::uuid[], $2::text[]) AS u(id, emb)
        WHERE p.id = u.id
      `, [ids, embs])
    })

    embedded += rows.length
    opts.onProgress?.(embedded, total)
  }

  return { total, embedded, skipped: 0, ms: Date.now() - t0 }
}
