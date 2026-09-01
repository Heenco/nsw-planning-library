// ── constrains edge builder ─────────────────────────────────────────────
//
// Threshold propositions in section X `constrain` non-threshold rule
// propositions in section X (same section) and all descendant sections.
//
// Semantics: if clause 4.3 says "maximum height is as shown on the map"
// (a threshold) and clause 4.3(1) says "development consent must have
// regard to…" (an obligation), the threshold constrains the obligation.
//
// Simpler rule: for every threshold T in section S, find every non-
// threshold proposition P in the same section or any descendant section
// of S, and emit T ——constrains——▶ P.
//
// We cap the depth walk at 3 levels to keep edge counts manageable.

import { withNswTx } from '../pool'

export interface ConstrainsResult {
  thresholds: number
  edges_inserted: number
}

export async function buildConstrainsEdges(documentId: string): Promise<ConstrainsResult> {
  return withNswTx(async (client) => {
    // Wipe existing
    await client.query(`
      DELETE FROM edge
      WHERE type = 'constrains'
        AND from_id IN (SELECT id FROM proposition WHERE document_id = $1::uuid)
    `, [documentId])

    // Count thresholds for reporting
    const threshCount = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n
      FROM proposition
      WHERE document_id = $1::uuid AND type = 'threshold'
    `, [documentId])
    const thresholds = Number(threshCount.rows[0]?.n ?? 0)

    if (thresholds === 0) return { thresholds: 0, edges_inserted: 0 }

    // For each threshold, find all non-threshold propositions in the same
    // section or in any section whose parent chain includes the threshold's
    // section (limit depth to 3).
    const result = await client.query(`
      WITH RECURSIVE descendants AS (
        SELECT id AS section_id, id AS origin_section_id, 0 AS depth
        FROM section WHERE document_id = $1::uuid
        UNION ALL
        SELECT child.id, d.origin_section_id, d.depth + 1
        FROM descendants d
        JOIN section child ON child.parent_id = d.section_id
        WHERE d.depth < 3 AND child.document_id = $1::uuid
      ),
      thresholds AS (
        SELECT id, section_id FROM proposition
        WHERE document_id = $1::uuid AND type = 'threshold'
      ),
      constraint_targets AS (
        SELECT DISTINCT
          t.id AS from_id,
          p.id AS to_id
        FROM thresholds t
        JOIN descendants d ON d.origin_section_id = t.section_id
        JOIN proposition p ON p.section_id = d.section_id
        WHERE p.type <> 'threshold'
          AND p.document_id = $1::uuid
          AND t.id <> p.id
      )
      INSERT INTO edge (from_id, to_id, type, target_kind, source, confidence, cross_document)
      SELECT from_id, to_id, 'constrains', 'proposition', 'structural', 0.8, false
      FROM constraint_targets
      RETURNING 1
    `, [documentId])

    return { thresholds, edges_inserted: result.rowCount ?? 0 }
  })
}
