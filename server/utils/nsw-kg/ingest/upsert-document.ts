// ── Document upsert ─────────────────────────────────────────────────────
//
// Insert (or replace) a document in nsw.document. If a document with the
// same source_url + as_at_date already exists, delete it first (CASCADE
// removes all sections / propositions / edges) and re-insert. v1 is full
// rebuild every run.

import { withNswTx } from '../pool'
import type { DocumentSource, NswDocument } from '../types'

export async function upsertDocument(src: DocumentSource & {
  consolidation_id?: string | null
  ingest_model: string
  ingest_provider: string
}): Promise<NswDocument> {
  return withNswTx(async (client) => {
    // Delete prior version (CASCADE wipes sections / props / edges)
    await client.query(
      `DELETE FROM document WHERE source_url = $1 AND lga_name IS NOT DISTINCT FROM $2`,
      [src.source_url, src.lga_name],
    )

    const { rows } = await client.query<NswDocument>(
      `INSERT INTO document (
        title, doc_type, scope, hierarchy_level, lga_name,
        source_url, raw_path, md_path, as_at_date, consolidation_id,
        ingest_model, ingest_provider
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, NULL, $8, $9,
        $10, $11
      ) RETURNING *`,
      [
        src.title, src.doc_type, src.scope, src.hierarchy_level, src.lga_name,
        src.source_url, src.raw_path, src.as_at_date, src.consolidation_id ?? null,
        src.ingest_model, src.ingest_provider,
      ],
    )
    return rows[0]!
  })
}

/** Update prop_count and edge_count after ingest stages complete. */
export async function updateDocumentCounts(
  documentId: string,
  counts: { prop_count?: number; edge_count?: number },
): Promise<void> {
  const sets: string[] = []
  const params: any[] = []
  let i = 1
  if (counts.prop_count !== undefined) { sets.push(`prop_count = $${i++}::int`); params.push(counts.prop_count) }
  if (counts.edge_count !== undefined) { sets.push(`edge_count = $${i++}::int`); params.push(counts.edge_count) }
  if (sets.length === 0) return
  params.push(documentId)
  const idIdx = i
  await withNswTx(async (client) => {
    await client.query(`UPDATE document SET ${sets.join(', ')} WHERE id = $${idIdx}::uuid`, params)
  })
}
