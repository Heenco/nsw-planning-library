/**
 * The overlays of /build-to-rent and /affordable-housing, as GeoJSON clipped to the view.
 *
 *   /api/housing/features?layer=iso_train&bbox=150.9,-33.9,151.1,-33.7&z=13
 *
 * One layer per request so the page can drop a slow one without losing the rest. Geometry is simplified to
 * roughly a pixel at the requested zoom and capped at MAX features; a capped answer says so (`capped`), and
 * the page shows it rather than drawing a partial layer as if it were whole. The layer list and its zoom
 * floors are shared/housing-layers.ts; a request below a layer's floor is refused rather than run.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { HOUSING_LAYERS } from '#shared/housing-layers'
import { RELEVANT_ZONES } from '#shared/housing-evaluate'

const MAX = 4000

/** Per key: the table, the geometry's SRID, the filter, and the label. */
const SQL: Record<string, { from: string; srid: number; where?: string; label: string }> = {
  btr_zones: { from: 'epi.epi_land_zoning', srid: 4283, where: `sym_code IN ('E2','MU1','B3','B4','B8','SP5')`, label: `sym_code || ' ' || coalesce(lay_class, '')` },
  tod_areas: { from: 'lmr.sepp_tod_areas', srid: 4283, label: `coalesce(nullif(precinct, ''), 'TOD area')` },
  lmr_area: { from: 'lmr.lmr_area', srid: 4283, label: `band || ' area'` },
  westconnex: { from: 'epi.epi_state_significant_dev_sites', srid: 4283, where: `label = 'WestConnex Dive Site'`, label: 'label' },
  iso_train: { from: 'access.iso_train', srid: 4326, label: 'source_name' },
  iso_bus: { from: 'access.iso_bus', srid: 4326, label: 'source_name' },
  relevant_zones: { from: 'epi.epi_land_zoning', srid: 4283, where: `sym_code IN (${RELEVANT_ZONES.map(z => `'${z}'`).join(',')})`, label: `sym_code || ' ' || coalesce(lay_class, '')` },
  atod: { from: 'lmr.sepp_tod_accelerated_precincts', srid: 4283, label: `coalesce(nullif(precinct, ''), 'Accelerated TOD Precinct')` },
  ssd_excluded: { from: 'epi.epi_state_significant_dev_sites', srid: 4283, where: `label IN ('Warrawong Site', 'Kanwal Site')`, label: 'label' },
  sop: { from: 'epi.epi_land_application', srid: 4283, where: `label = 'Sydney Olympic Park'`, label: 'label' },
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const key = String(q.layer ?? '')
  const layer = HOUSING_LAYERS.find(l => l.key === key)
  const def = SQL[key]
  if (!layer || !def) throw createError({ statusCode: 400, statusMessage: `Unknown layer ${key}` })
  const z = Math.round(Number(q.z))
  const bbox = String(q.bbox ?? '').split(',').map(Number)
  if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n))) throw createError({ statusCode: 400, statusMessage: 'bbox=w,s,e,n' })
  if (!Number.isFinite(z) || z < layer.minZoom) throw createError({ statusCode: 400, statusMessage: `${key} is drawn from zoom ${layer.minZoom}` })

  // about a pixel at this zoom, in degrees (256-px tiles)
  const tol = 360 / (256 * 2 ** z)
  const [w, s, e, n] = bbox as [number, number, number, number]
  const env = `ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, ${def.srid})`
  const res = await nswQuery<any>(`
    SELECT ${def.label} AS label,
           ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(ST_ClipByBox2D(geom, ${env}), ${tol}), 4326), 6)::json AS g
      FROM ${def.from}
     WHERE geom && ${env} ${def.where ? `AND ${def.where}` : ''}
     LIMIT ${MAX + 1}`)
  const rows = res.rows.filter((r: any) => r.g)
  setHeader(event, 'cache-control', 'public, max-age=300')
  return {
    type: 'FeatureCollection',
    capped: rows.length > MAX,
    features: rows.slice(0, MAX).map((r: any) => ({ type: 'Feature', properties: { label: r.label }, geometry: r.g })),
  }
})
