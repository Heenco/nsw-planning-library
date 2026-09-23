/**
 * The CDC layer catalogue: every layer a complying development check needs, and where it comes from.
 *
 * Read from cdc.layers rather than hardcoded here, because the schema is generated from a registry and a
 * second copy of the list in TypeScript would be a second thing to keep right. The table is written by
 * the notebook that builds the schema.
 *
 * Most of these are views. The cdc schema does not copy epi, esa or lmr: copying terrestrial biodiversity,
 * bush fire and riparian would duplicate about a gigabyte and go stale the next time 01A reloads epi. A
 * view also lets a layer be the layer the *rule* needs - cdc.coastline_hazard is the sixty-seven rows of
 * epi_local_provisions called Coastline Hazard, not the whole 34,000-row table.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { cdcIndex } from '../../utils/sepp-pmtiles'
import { kindOf, scopeOf, type CdcKind, type CdcScope } from './at.get'

export interface CdcLayer {
  key: string
  title: string
  group: string
  groupTitle: string
  /** As the Department workbook numbers them. Empty when the layer answers no clause directly. */
  clauses: string[]
  /** The column 07 - CDC rules tests, or null where the rule exists but we run no test. */
  columnTested: string | null
  note: string | null
  /**
   * 'exclusion' when land inside cannot be complying development, 'condition' when the clause asks for
   * an approval rather than clear land, 'context' when it is just a fact about the lot.
   */
  kind: CdcKind
  /** What the layer bears on, derived from its clause: general, code, midrise, unmapped or context. */
  scope: CdcScope
  /**
   * 'view' over a schema we already hold, 'download' fetched from a service into a real table,
   * 'pulled' copied from UrbanPortalDBP, 'none' when no dataset exists anywhere.
   */
  sourceKind: 'view' | 'download' | 'pulled' | 'none'
  source: string
  filter: string | null
  srid: number | null
  features: number | null
  /** When a copied layer was last pulled. Null for a view, which cannot be stale. */
  pulledAt: string | null
  /** From the tile build: null until one has run, which is how the page knows it cannot draw the layer. */
  minZoom: number | null
  bbox: [number, number, number, number] | null
  /** The distinct values of `class`, biggest first, for the layer's own detail. */
  categories: { name: string; features: number }[]
}

export interface CdcLayersResponse {
  layers: CdcLayer[]
  /** One tiled archive per group; `archive` is null where no build has produced one yet. */
  groups: { key: string; title: string; count: number; archive: string | null; minZoom: number; maxZoom: number }[]
  /** Layers with no dataset behind them, which is why a lot can never be fully cleared here. */
  gaps: number
  generatedAt: string | null
}

export default defineEventHandler(async (event): Promise<CdcLayersResponse> => {
  setHeader(event, 'cache-control', 'public, max-age=300')

  const index = await cdcIndex()
  const tiled = new Map((index?.layers ?? []).map(l => [l.key, l]))

  const res = await nswQuery<any>(`
    SELECT key, title, grp, grp_title, clauses, column_tested, note, kind,
           source_kind, source, filter, srid, features, checked_at, pulled_at
    FROM cdc.layers
    ORDER BY grp_order, title`)

  const layers: CdcLayer[] = res.rows.map(r => ({
    key: r.key,
    title: r.title,
    group: r.grp,
    groupTitle: r.grp_title,
    clauses: r.clauses ?? [],
    columnTested: r.column_tested,
    note: r.note,
    kind: kindOf(r.kind),
    scope: scopeOf(r.clauses ?? [], r.kind),
    sourceKind: r.source_kind,
    source: r.source,
    filter: r.filter,
    srid: r.srid,
    features: r.features == null ? null : Number(r.features),
    pulledAt: r.pulled_at ? new Date(r.pulled_at).toISOString() : null,
    minZoom: tiled.get(r.key)?.minZoom ?? null,
    bbox: tiled.get(r.key)?.bbox ?? null,
    categories: tiled.get(r.key)?.categories ?? [],
  }))

  const groups: CdcLayersResponse['groups'] = []
  for (const l of layers) {
    const found = groups.find(g => g.key === l.group)
    if (found) { found.count += 1; continue }
    const g = index?.groups?.[l.group]
    groups.push({
      key: l.group,
      title: l.groupTitle,
      count: 1,
      archive: g?.archive ?? null,
      minZoom: g?.minZoom ?? 4,
      maxZoom: g?.maxZoom ?? 14,
    })
  }

  return {
    layers,
    groups,
    gaps: layers.filter(l => l.sourceKind === 'none').length,
    generatedAt: res.rows[0]?.checked_at ? new Date(res.rows[0].checked_at).toISOString() : null,
  }
})
