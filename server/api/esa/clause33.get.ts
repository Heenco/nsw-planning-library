/**
 * The state-wide half of clause 3.3, for the second panel on /esa.
 *
 * `esa.additional_exceptions` (served by ./index.get.ts) is only what 30 local plans ADD to the
 * definition. This is the definition itself: one row per paragraph of clause 3.3, saying which layer
 * serves it, where that layer came from and whether it reconciled against its source.
 *
 * The registry is the authority on what exists; the tiles manifest is the authority on what can be
 * drawn. They are merged here on the layer key, so an item with a table but no tiles (a layer too
 * large to tile) and an item with neither (nobody publishes the dataset) both stay visible, and the
 * page can say which is which instead of showing a silent absence where an exclusion should be.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { manifestFor } from '../../utils/sepp-pmtiles'

export interface Clause33Layer {
  key: string
  paragraph: string | null
  item: string
  table: string | null
  provenance: 'epi' | 'download' | 'derived' | 'gap'
  source: string | null
  sourceCount: number | null
  rowCount: number | null
  invalidGeoms: number | null
  verified: boolean
  note: string | null
  builtAt: string | null
  /** From the tiles manifest; null when no archive has been built yet. */
  tiled: boolean
  features: number | null
  minZoom: number | null
  bbox: [number, number, number, number] | null
  geometry: 'point' | 'linestring' | 'polygon' | null
  categories: { name: string; features: number }[]
}

export interface Clause33Build {
  ok: boolean
  reason?: string
  tiles: { archive: string; builtAt: string; minZoom: number; maxZoom: number } | null
  note: string | null
  summary: {
    items: number
    withLayer: number
    verified: number
    gaps: number
    drawn: number
    polygons: number
  }
  layers: Clause33Layer[]
}

export default defineEventHandler(async (event): Promise<Clause33Build> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  const empty = { items: 0, withLayer: 0, verified: 0, gaps: 0, drawn: 0, polygons: 0 }

  const present = await nswQuery<{ t: string | null }>(
    "SELECT to_regclass('esa.clause33_layers')::text AS t")
  if (!present.rows[0]?.t) {
    return {
      ok: false,
      reason: 'esa.clause33_layers is not in this database yet - it is built by the notebook '
        + '"07C - ESA - clause 3.3 state-wide".',
      tiles: null,
      note: null,
      summary: empty,
      layers: [],
    }
  }

  const [registry, note, tiles] = await Promise.all([
    nswQuery<Omit<Clause33Layer, 'tiled' | 'features' | 'minZoom' | 'bbox' | 'geometry' | 'categories'>>(`
      SELECT key, paragraph, item, table_name AS "table", provenance, source,
             source_count AS "sourceCount", row_count AS "rowCount",
             invalid_geoms AS "invalidGeoms", verified, note,
             to_char(built_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "builtAt"
      FROM esa.clause33_layers
      ORDER BY coalesce(paragraph, 'z'), item`),
    nswQuery<{ note: string | null }>(
      "SELECT obj_description('esa.clause33_layers'::regclass, 'pg_class') AS note"),
    // a missing archive is not an error: the panel still lists every item, just without a map switch
    manifestFor('esa33').catch(() => null),
  ])

  const drawn = new Map((tiles?.layers ?? []).map(l => [l.key, l]))
  const layers: Clause33Layer[] = registry.rows.map(r => {
    const t = drawn.get(r.key)
    return {
      ...r,
      verified: Boolean(r.verified),
      tiled: Boolean(t?.tiled),
      features: t?.features ?? null,
      minZoom: t?.minZoom ?? null,
      bbox: t?.bbox ?? null,
      geometry: t?.geometry ?? null,
      categories: t?.categories ?? [],
    }
  })

  return {
    ok: true,
    tiles: tiles && { archive: tiles.archive, builtAt: tiles.builtAt, minZoom: tiles.minZoom, maxZoom: tiles.maxZoom },
    note: note.rows[0]?.note ?? null,
    summary: {
      items: layers.length,
      withLayer: layers.filter(l => l.table).length,
      verified: layers.filter(l => l.verified).length,
      gaps: layers.filter(l => l.provenance === 'gap').length,
      drawn: layers.filter(l => l.tiled).length,
      polygons: layers.reduce((t, l) => t + (l.rowCount ?? 0), 0),
    },
    layers,
  }
})
