// ── Phase 4 edge orchestrator ───────────────────────────────────────────
//
// Runs all 5 edge builders (+ the Stage 3 reference resolver) for a
// document. Emits IngestEvents so the CLI and page can show progress.

import { buildSectionLookup, resolveReferencesForDocument } from '../resolvers/references'
import { buildParentOfEdges } from './parent-of'
import { buildDefinesEdges } from './defines'
import { buildRequiresEdges } from './requires'
import { buildConstrainsEdges } from './constrains'
import { buildResolvesToEdges } from './resolves-to'
import { withNswTx } from '../pool'
import type { IngestEvent } from '../types'

export interface BuildEdgesResult {
  resolution: { scanned: number; found: number; resolved: number; unresolved: number }
  parent_of:   number
  defines:     number
  requires:    number
  constrains:  number
  resolves_to: number
  total_edges: number
  ms:          number
}

export async function buildAllEdges(
  documentId: string,
  onEvent?: (evt: IngestEvent) => void,
): Promise<BuildEdgesResult> {
  const emit = onEvent ?? (() => {})
  const t0 = Date.now()

  // ── Stage 3: reference resolution ──────────────────────────────────
  emit({ type: 'stage_start', stage: 'resolve', message: 'Resolving cross-references…' })
  const resolveT0 = Date.now()
  const lookup = await buildSectionLookup(documentId)
  const resolution = await resolveReferencesForDocument(documentId, lookup)
  emit({
    type: 'stage_done',
    stage: 'resolve',
    ms: Date.now() - resolveT0,
    counts: {
      scanned:    resolution.propositions_scanned,
      refs_found: resolution.references_found,
      refs_resolved: resolution.references_resolved,
      refs_unresolved: resolution.references_unresolved,
      propositions_updated: resolution.propositions_updated,
    },
  })

  // ── Stage 4: edge construction (5 builders, run sequentially
  //    since they all write to the same table) ─────────────────────────
  emit({ type: 'stage_start', stage: 'edges', message: 'Building parent_of…' })
  let t = Date.now()
  const parentOf = await buildParentOfEdges(documentId)
  emit({ type: 'stage_done', stage: 'edges', ms: Date.now() - t, counts: { parent_of: parentOf.edges_inserted } })

  emit({ type: 'stage_start', stage: 'edges', message: 'Building defines…' })
  t = Date.now()
  const defines = await buildDefinesEdges(documentId)
  emit({ type: 'stage_done', stage: 'edges', ms: Date.now() - t, counts: { defines: defines.edges_inserted, terms: defines.dictionary_terms } })

  emit({ type: 'stage_start', stage: 'edges', message: 'Building requires…' })
  t = Date.now()
  const requires = await buildRequiresEdges(documentId)
  emit({ type: 'stage_done', stage: 'edges', ms: Date.now() - t, counts: { requires: requires.edges_inserted, from_refs: requires.from_refs_resolved, from_cond: requires.from_conditional_on } })

  emit({ type: 'stage_start', stage: 'edges', message: 'Building constrains…' })
  t = Date.now()
  const constrains = await buildConstrainsEdges(documentId)
  emit({ type: 'stage_done', stage: 'edges', ms: Date.now() - t, counts: { constrains: constrains.edges_inserted, thresholds: constrains.thresholds } })

  emit({ type: 'stage_start', stage: 'edges', message: 'Building resolves_to…' })
  t = Date.now()
  const resolvesTo = await buildResolvesToEdges(documentId)
  emit({
    type: 'stage_done',
    stage: 'edges',
    ms: Date.now() - t,
    counts: {
      resolves_to: resolvesTo.edges_inserted,
      map_refs: resolvesTo.unique_map_refs.length,
    },
  })

  const totalEdges =
    parentOf.edges_inserted +
    defines.edges_inserted +
    requires.edges_inserted +
    constrains.edges_inserted +
    resolvesTo.edges_inserted

  // Update document counts
  await withNswTx(async (c) => {
    await c.query(`UPDATE document SET edge_count = $1::int WHERE id = $2::uuid`, [totalEdges, documentId])
  })

  return {
    resolution: {
      scanned:    resolution.propositions_scanned,
      found:      resolution.references_found,
      resolved:   resolution.references_resolved,
      unresolved: resolution.references_unresolved,
    },
    parent_of:   parentOf.edges_inserted,
    defines:     defines.edges_inserted,
    requires:    requires.edges_inserted,
    constrains:  constrains.edges_inserted,
    resolves_to: resolvesTo.edges_inserted,
    total_edges: totalEdges,
    ms:          Date.now() - t0,
  }
}
