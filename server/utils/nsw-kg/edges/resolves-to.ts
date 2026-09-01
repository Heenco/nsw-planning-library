// ── resolves_to edge builder ────────────────────────────────────────────
//
// For every threshold proposition with a non-null `value_source`
// ('map:Height_of_Buildings_Map' etc.), create a `resolves_to` edge with
// target_kind='spatial_layer' and target_ref = the map name.
//
// Since the spatial track isn't built yet, to_id stays NULL — the edge
// carries only the string reference. When the spatial track lands and
// creates one threshold_source proposition per (map × LGA), we'll run
// a follow-up pass that links to_id to those UUIDs.

import { withNswTx } from '../pool'

export interface ResolvesToResult {
  thresholds_with_value_source: number
  edges_inserted: number
  unique_map_refs: string[]
}

export async function buildResolvesToEdges(documentId: string): Promise<ResolvesToResult> {
  return withNswTx(async (client) => {
    // Wipe existing
    await client.query(`
      DELETE FROM edge
      WHERE type = 'resolves_to'
        AND from_id IN (SELECT id FROM proposition WHERE document_id = $1::uuid)
    `, [documentId])

    // Fetch propositions with value_source
    const { rows } = await client.query<{ id: string; value_source: string }>(`
      SELECT id, value_source
      FROM proposition
      WHERE document_id = $1::uuid
        AND value_source IS NOT NULL
    `, [documentId])

    if (rows.length === 0) {
      return { thresholds_with_value_source: 0, edges_inserted: 0, unique_map_refs: [] }
    }

    const uniqueMaps = new Set<string>()
    for (const r of rows) uniqueMaps.add(r.value_source)

    // Insert one edge per proposition
    const ids = rows.map((r) => r.id)
    const refs = rows.map((r) => r.value_source)
    const res = await client.query(`
      INSERT INTO edge (from_id, to_id, type, target_kind, target_ref, source, confidence, cross_document)
      SELECT f, NULL, 'resolves_to', 'spatial_layer', ref, 'llm', 0.95, false
      FROM unnest($1::uuid[], $2::text[]) AS u(f, ref)
      RETURNING 1
    `, [ids, refs])

    return {
      thresholds_with_value_source: rows.length,
      edges_inserted: res.rowCount ?? 0,
      unique_map_refs: Array.from(uniqueMaps).sort(),
    }
  })
}
