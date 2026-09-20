/**
 * The EPI layer catalogue behind /epi.
 *
 * Two sources, merged on the table name:
 *   the database  - every table in the `epi` schema, its row count and its COMMENT, which is the
 *                   authority on what exists after the last load;
 *   epi-layers.json - the tile index, which is the authority on what can be drawn.
 *
 * They are kept apart on purpose. A table that exists but has no archive yet (a build still running,
 * or a group that failed) is listed as present and not drawn, rather than vanishing from the page.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { epiIndex, EPI_GROUPS, type EpiGroup } from '../../utils/sepp-pmtiles'
import { epiDescription, epiTitle } from '#shared/epi-layers'

export interface EpiPageLayer {
  key: string
  /** The name the map is published under, rather than the GEODAAS export table name. */
  title: string
  table: string
  group: EpiGroup | 'unbuilt'
  /** One sentence on what the layer holds. The tables carry no COMMENT, so this is editorial. */
  description: string | null
  /** The table COMMENT, if a future load ever writes one. */
  comment: string | null
  rows: number
  /** How many instruments draw the layer, and the map names it is published under. */
  plans: number | null
  maps: { name: string; features: number }[]
  /** From the tile index; null when nothing has been built for this table. */
  archive: string | null
  features: number | null
  minZoom: number | null
  bbox: [number, number, number, number] | null
  geometry: 'point' | 'linestring' | 'polygon' | null
  categories: { name: string; features: number }[]
  drawn: boolean
}

export interface EpiGroupInfo {
  key: string
  label: string
  archive: string
  builtAt: string
  minZoom: number
  maxZoom: number
  features: number
}

export interface EpiLayersResponse {
  ok: boolean
  reason?: string
  builtAt: string | null
  groupOrder: string[]
  groups: EpiGroupInfo[]
  layers: EpiPageLayer[]
  summary: { tables: number; drawn: number; empty: number; rows: number; features: number }
}

const GROUP_LABEL: Record<string, string> = {
  principal: 'Principal planning',
  application: 'Land application',
  biodiversity: 'Biodiversity and protection',
  resources: 'Land, soil and water',
  hazard: 'Hazard',
  development: 'Development controls and local provisions',
}

export default defineEventHandler(async (event): Promise<EpiLayersResponse> => {
  setHeader(event, 'cache-control', 'public, max-age=300')

  const [tables, index] = await Promise.all([
    nswQuery<{ table: string; rows: number; comment: string | null }>(`
      SELECT c.relname AS "table",
             coalesce(s.n_live_tup, 0)::bigint AS rows,
             obj_description(c.oid, 'pg_class') AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN geometry_columns g ON g.f_table_schema = 'epi' AND g.f_table_name = c.relname
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'epi' AND c.relkind = 'r'
      ORDER BY c.relname`),
    epiIndex(),
  ])

  if (!tables.rows.length) {
    return {
      ok: false,
      reason: 'The epi schema is empty in this database. It is written by the notebook "01A - Read and write - Geojson".',
      builtAt: null, groupOrder: [], groups: [], layers: [],
      summary: { tables: 0, drawn: 0, empty: 0, rows: 0, features: 0 },
    }
  }

  const tiled = new Map((index?.layers ?? []).map(l => [l.key, l]))
  const layers: EpiPageLayer[] = tables.rows.map((t) => {
    const l = tiled.get(t.table)
    return {
      key: t.table,
      title: epiTitle(t.table),
      table: `epi.${t.table}`,
      group: (l?.group ?? 'unbuilt') as EpiGroup | 'unbuilt',
      description: epiDescription(t.table),
      comment: t.comment ?? l?.comment ?? null,
      rows: Number(t.rows ?? 0),
      plans: l?.plans ?? null,
      maps: l?.maps ?? [],
      archive: l?.archive ?? null,
      features: l?.features ?? null,
      minZoom: l?.minZoom ?? null,
      bbox: l?.bbox ?? null,
      geometry: l?.geometry ?? null,
      categories: l?.categories ?? [],
      drawn: Boolean(l?.features),
    }
  })

  const groups: EpiGroupInfo[] = Object.entries(index?.groups ?? {}).map(([key, g]) => ({
    key, label: g.label ?? GROUP_LABEL[key] ?? key, archive: g.archive, builtAt: g.builtAt,
    minZoom: g.minZoom, maxZoom: g.maxZoom, features: g.features,
  }))
  const order = index?.groupOrder?.length ? index.groupOrder : [...EPI_GROUPS]

  return {
    ok: true,
    reason: index ? undefined : 'No tile index has been published yet, so nothing can be drawn. '
      + 'Run the notebook "01A-pmtiles-epi" to build the archives. The catalogue below still works.',
    builtAt: index?.builtAt ?? null,
    groupOrder: order,
    groups,
    layers,
    summary: {
      tables: layers.length,
      drawn: layers.filter(l => l.drawn).length,
      empty: layers.filter(l => !l.rows).length,
      rows: layers.reduce((t, l) => t + l.rows, 0),
      features: layers.reduce((t, l) => t + (l.features ?? 0), 0),
    },
  }
})
