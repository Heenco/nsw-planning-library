// ── Stage C — graph expansion ──────────────────────────────────────────
//
// Walks edges from each retrieved proposition to pull in related context.
// Capped at +30 propositions to keep the synthesis prompt small.
//
// Edges followed:
//   defines      (incoming)  → dictionary entries that define terms used
//   requires     (outgoing)  → conditions / referenced clauses
//   constrains   (incoming)  → thresholds qualifying a rule
//   parent_of    (outgoing)  → containing section (target_kind = 'section')
//                              skipped here — Stage E uses section_local_id
//                              from the retrieved row directly
//   resolves_to  (outgoing)  → spatial layer ref (target_kind = 'spatial_layer')
//                              skipped here — surfaced as-is in retrieved row

import { withNswClient } from '../pool'
import type { RetrievalCandidate, ExpandedContext } from './types'

const MAX_EXPANSION = 30

const SELECT_FIELDS = `
  p.id, p.document_id,
  d.title AS document_title,
  d.doc_type AS document_doc_type,
  d.lga_name AS document_lga,
  d.hierarchy_level AS document_hierarchy_level,
  d.source_url AS document_source_url,
  p.section_id,
  s.local_id AS section_local_id,
  s.number AS section_number,
  s.heading AS section_heading,
  s.source_file AS section_source_file,
  s.page AS section_page,
  p.type, p.subject, p.predicate, p.object,
  p.numeric_value, p.numeric_unit, p.numeric_comparator, p.value_source,
  p.source_span, p.conditional_on
`

const JOINS = `
  FROM proposition p
  JOIN section s ON s.id = p.section_id
  JOIN document d ON d.id = p.document_id
`

function rowToCandidate(r: any, source: 'expanded', expandedVia: string): RetrievalCandidate {
  return {
    id: r.id,
    document_id: r.document_id,
    document_title: r.document_title,
    document_doc_type: r.document_doc_type,
    document_lga: r.document_lga,
    document_hierarchy_level: r.document_hierarchy_level,
    document_source_url: r.document_source_url ?? null,
    section_id: r.section_id,
    section_local_id: r.section_local_id,
    section_number: r.section_number,
    section_heading: r.section_heading,
    section_source_file: r.section_source_file ?? null,
    section_page: r.section_page !== null && r.section_page !== undefined
      ? Number(r.section_page)
      : null,
    type: r.type,
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    numeric_value: r.numeric_value !== null ? Number(r.numeric_value) : null,
    numeric_unit: r.numeric_unit,
    numeric_comparator: r.numeric_comparator,
    value_source: r.value_source,
    source_span: r.source_span,
    conditional_on: r.conditional_on,
    vector_rank: null,
    bm25_rank: null,
    vector_distance: null,
    bm25_score: null,
    rrf_score: 0,
    source,
    expanded_via: expandedVia,
  }
}

export async function expandGraph(retrieved: RetrievalCandidate[]): Promise<ExpandedContext> {
  if (retrieved.length === 0) {
    return { retrieved: [], expanded: [], total: 0, by_doc_type: {} }
  }

  const retrievedIds = retrieved.map((r) => r.id)
  const expanded = new Map<string, RetrievalCandidate>()
  const seenIds = new Set(retrievedIds)

  await withNswClient(async (client) => {
    // ── 1. defines: edges where to_id is in retrievedIds → bring in from_id ──
    // (definitions that define terms used in retrieved propositions)
    const definesRes = await client.query(`
      SELECT DISTINCT ON (p.id) ${SELECT_FIELDS}
      ${JOINS}
      WHERE p.id IN (
        SELECT e.from_id FROM edge e
        WHERE e.type = 'defines' AND e.to_id = ANY($1::uuid[])
      )
    `, [retrievedIds])
    for (const r of definesRes.rows) {
      if (seenIds.has(r.id)) continue
      seenIds.add(r.id)
      expanded.set(r.id, rowToCandidate(r, 'expanded', 'defines'))
      if (expanded.size >= MAX_EXPANSION) break
    }

    if (expanded.size < MAX_EXPANSION) {
      // ── 2. requires: edges where from_id is in retrievedIds → bring in to_id ──
      const requiresRes = await client.query(`
        SELECT DISTINCT ON (p.id) ${SELECT_FIELDS}
        ${JOINS}
        WHERE p.id IN (
          SELECT e.to_id FROM edge e
          WHERE e.type = 'requires'
            AND e.from_id = ANY($1::uuid[])
            AND e.to_id IS NOT NULL
        )
      `, [retrievedIds])
      for (const r of requiresRes.rows) {
        if (seenIds.has(r.id)) continue
        seenIds.add(r.id)
        expanded.set(r.id, rowToCandidate(r, 'expanded', 'requires'))
        if (expanded.size >= MAX_EXPANSION) break
      }
    }

    if (expanded.size < MAX_EXPANSION) {
      // ── 3. constrains: edges where to_id is in retrievedIds → bring in from_id ──
      // (the threshold proposition that constrains a retrieved rule)
      const constrainsRes = await client.query(`
        SELECT DISTINCT ON (p.id) ${SELECT_FIELDS}
        ${JOINS}
        WHERE p.id IN (
          SELECT e.from_id FROM edge e
          WHERE e.type = 'constrains' AND e.to_id = ANY($1::uuid[])
        )
      `, [retrievedIds])
      for (const r of constrainsRes.rows) {
        if (seenIds.has(r.id)) continue
        seenIds.add(r.id)
        expanded.set(r.id, rowToCandidate(r, 'expanded', 'constrains'))
        if (expanded.size >= MAX_EXPANSION) break
      }
    }
  })

  const expandedList = Array.from(expanded.values())
  const all = [...retrieved, ...expandedList]

  const byDocType: Record<string, number> = {}
  for (const c of all) {
    byDocType[c.document_doc_type] = (byDocType[c.document_doc_type] ?? 0) + 1
  }

  return {
    retrieved,
    expanded: expandedList,
    total:    all.length,
    by_doc_type: byDocType,
  }
}
