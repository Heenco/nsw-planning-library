// ── Stage 5b — BM25 (tsvector) backfill for nsw.proposition ────────────
//
// Single SQL UPDATE per document. Idempotent — only fills NULL rows.

import { withNswClient, nswQuery } from '../pool'

export interface Bm25Result {
  updated: number
  ms:      number
}

export async function backfillBm25(documentId?: string): Promise<Bm25Result> {
  const t0 = Date.now()

  const result = await withNswClient(async (client) => {
    const sql = documentId
      ? `
        UPDATE proposition
        SET search_vector = to_tsvector('english',
              coalesce(subject, '') || ' ' ||
              coalesce(predicate, '') || ' ' ||
              coalesce(object, '') || ' ' ||
              coalesce(source_span, ''))
        WHERE document_id = $1::uuid AND search_vector IS NULL
      `
      : `
        UPDATE proposition
        SET search_vector = to_tsvector('english',
              coalesce(subject, '') || ' ' ||
              coalesce(predicate, '') || ' ' ||
              coalesce(object, '') || ' ' ||
              coalesce(source_span, ''))
        WHERE search_vector IS NULL
      `
    const params = documentId ? [documentId] : []
    return await client.query(sql, params)
  })

  return { updated: result.rowCount ?? 0, ms: Date.now() - t0 }
}

/** Sanity check: how many propositions still have NULL search_vector? */
export async function countMissingBm25(documentId?: string): Promise<number> {
  const sql = documentId
    ? `SELECT count(*)::int AS n FROM proposition WHERE document_id = $1::uuid AND search_vector IS NULL`
    : `SELECT count(*)::int AS n FROM proposition WHERE search_vector IS NULL`
  const params = documentId ? [documentId] : []
  return (await nswQuery<{ n: number }>(sql, params)).rows[0]?.n ?? 0
}
