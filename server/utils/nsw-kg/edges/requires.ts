// ── requires edge builder ───────────────────────────────────────────────
//
// For every proposition P with refs_resolved (populated by the reference
// resolver), create one `requires` edge per resolved reference:
//
//   P ——requires——▶ target_section's first proposition
//
// Also creates `requires` edges from the `conditional_on` field: if P
// has conditional_on = Q, then P requires Q (if the condition fails,
// the rule doesn't fire).
//
// Edges point to the first proposition in the target section (by
// created_at). If the target section has no propositions (e.g., the
// Dictionary heading itself), the edge has target_kind='section' and
// target_ref = the section's local_id.

import { withNswTx } from '../pool'

export interface RequiresResult {
  from_refs_resolved: number
  from_conditional_on: number
  edges_inserted: number
}

export async function buildRequiresEdges(documentId: string): Promise<RequiresResult> {
  return withNswTx(async (client) => {
    // Wipe existing requires edges for this document
    await client.query(`
      DELETE FROM edge
      WHERE type = 'requires'
        AND from_id IN (SELECT id FROM proposition WHERE document_id = $1::uuid)
    `, [documentId])

    // 1. edges from refs_resolved
    //    For each (proposition, resolved ref), find the first proposition in
    //    the target section and emit an edge.
    const refsResult = await client.query(`
      WITH refs_flat AS (
        SELECT
          p.id AS from_id,
          (ref->>'section_id')::uuid AS target_section_id
        FROM proposition p, jsonb_array_elements(p.refs_resolved) AS ref
        WHERE p.document_id = $1::uuid
          AND p.refs_resolved IS NOT NULL
      ),
      target_props AS (
        SELECT DISTINCT ON (rf.from_id, rf.target_section_id)
          rf.from_id,
          tp.id AS to_id
        FROM refs_flat rf
        JOIN LATERAL (
          SELECT id FROM proposition
          WHERE section_id = rf.target_section_id
          ORDER BY created_at ASC
          LIMIT 1
        ) tp ON true
      )
      INSERT INTO edge (from_id, to_id, type, target_kind, source, confidence, cross_document)
      SELECT from_id, to_id, 'requires', 'proposition', 'regex', 0.85, false
      FROM target_props
      WHERE from_id <> to_id
      RETURNING 1
    `, [documentId])

    const fromRefs = refsResult.rowCount ?? 0

    // 2. edges from conditional_on
    const condResult = await client.query(`
      INSERT INTO edge (from_id, to_id, type, target_kind, source, confidence, cross_document)
      SELECT p.id, p.conditional_on, 'requires', 'proposition', 'llm', 0.9, false
      FROM proposition p
      WHERE p.document_id = $1::uuid
        AND p.conditional_on IS NOT NULL
        AND p.id <> p.conditional_on
      RETURNING 1
    `, [documentId])

    const fromCond = condResult.rowCount ?? 0

    return {
      from_refs_resolved:  fromRefs,
      from_conditional_on: fromCond,
      edges_inserted:      fromRefs + fromCond,
    }
  })
}
