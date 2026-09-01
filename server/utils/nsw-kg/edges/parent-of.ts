// ── parent_of edge builder ──────────────────────────────────────────────
//
// For every proposition, emit one `parent_of` edge per ancestor section
// in the section tree. The edge's target is the section itself
// (target_kind='section', to_id=NULL, target_ref=the section's local_id).
//
// Rationale: we decompose only leaf clauses into propositions, so parent
// sections never have propositions of their own. To answer "which Part
// does this clause live under?", we store structural containment as
// section-targeted edges.
//
// To keep the count reasonable we only emit edges to structural ancestors
// (part, chapter, division, schedule, dictionary) — not to intermediate
// subclause/paragraph wrappers, since those are already reachable via
// the section tree within the same "leaf unit".

import { withNswTx } from '../pool'

// Section levels that count as "containing" levels worth pointing at.
const STRUCTURAL_LEVELS = ['chapter', 'part', 'division', 'subdivision', 'schedule', 'dictionary', 'clause']

export interface ParentOfResult {
  edges_inserted: number
}

export async function buildParentOfEdges(documentId: string): Promise<ParentOfResult> {
  return withNswTx(async (client) => {
    // Wipe existing
    await client.query(`
      DELETE FROM edge
      WHERE type = 'parent_of'
        AND from_id IN (SELECT id FROM proposition WHERE document_id = $1::uuid)
    `, [documentId])

    // Walk ancestors of every proposition's section and emit one edge per
    // structural ancestor.
    const result = await client.query(`
      WITH RECURSIVE ancestor_of AS (
        -- start from each proposition's own section (depth=0, not emitted)
        SELECT p.id AS prop_id,
               s.id AS section_id,
               s.parent_id,
               s.level,
               s.local_id,
               0 AS depth
        FROM proposition p
        JOIN section s ON s.id = p.section_id
        WHERE p.document_id = $1::uuid

        UNION ALL

        -- walk up the tree
        SELECT ao.prop_id,
               parent.id,
               parent.parent_id,
               parent.level,
               parent.local_id,
               ao.depth + 1
        FROM ancestor_of ao
        JOIN section parent ON parent.id = ao.parent_id
        WHERE ao.parent_id IS NOT NULL AND ao.depth < 20
      )
      INSERT INTO edge (from_id, to_id, type, target_kind, target_ref, source, confidence, cross_document)
      SELECT DISTINCT ON (prop_id, section_id)
             prop_id, NULL, 'parent_of', 'section', local_id, 'structural', 1.0, false
      FROM ancestor_of
      WHERE depth > 0
        AND level = ANY($2::text[])
      RETURNING 1
    `, [documentId, STRUCTURAL_LEVELS])

    return { edges_inserted: result.rowCount ?? 0 }
  })
}
