/**
 * The ESA additional-exceptions layer behind /esa.
 *
 * 52 rows and 20 source layers, so everything is returned at once and the page filters in the
 * browser. The geometry never leaves the database - it is up to 2.3M vertices and the page draws
 * no map - but its area does, because an advisory item covering a whole council area is the one
 * number that says how little it pins down. That area is a stored column: measuring it per request
 * cost 2.7 s.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { manifestFor } from '../../utils/sepp-pmtiles'

export interface EsaItem {
  id: number
  epiCode: string | null
  lepName: string | null
  lgaName: string | null
  ref: string | null
  exceptionText: string | null
  status: string | null
  coverageType: string | null
  attributeFilter: string | null
  verifyRequired: boolean | null
  sourceLayers: string | null
  sourceFeatures: number | null
  areaKm2: number | null
  /** The item's extent, so the map can be sent to it. */
  bbox: [number, number, number, number] | null
}

export interface EsaSourceLayer {
  layerName: string
  role: string
  service: string
  endpoint: string
  items: number
  leps: number
}

export interface EsaBuild {
  ok: boolean
  reason?: string
  /** The tile archive the map draws, when one has been built. */
  tiles: { archive: string; builtAt: string; minZoom: number; maxZoom: number } | null
  /** What the table says about itself. */
  note: string | null
  summary: {
    items: number
    leps: number
    lgas: number
    precise: number
    advisory: number
    verifyRequired: number
    preciseKm2: number
    advisoryKm2: number
    layers: number
  }
  items: EsaItem[]
  layers: EsaSourceLayer[]
}

export default defineEventHandler(async (event): Promise<EsaBuild> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  const empty = { items: 0, leps: 0, lgas: 0, precise: 0, advisory: 0, verifyRequired: 0, preciseKm2: 0, advisoryKm2: 0, layers: 0 }

  const present = await nswQuery<{ t: string | null }>(
    "SELECT to_regclass('esa.additional_exceptions')::text AS t")
  if (!present.rows[0]?.t) {
    return {
      ok: false,
      reason: 'esa.additional_exceptions is not in this database yet - it is built by "07 - ESA - exceptions" and '
        + 'copied across from UrbanPortalDBP.',
      note: null,
      tiles: null,
      summary: empty,
      items: [],
      layers: [],
    }
  }

  const [items, layers, note, tiles] = await Promise.all([
    nswQuery<EsaItem>(`
      SELECT id, epi_code AS "epiCode", lep_name AS "lepName", lga_name AS "lgaName", ref,
             exception_text AS "exceptionText", status, coverage_type AS "coverageType",
             attribute_filter AS "attributeFilter", verify_required AS "verifyRequired",
             source_layers AS "sourceLayers", n_source_features::int AS "sourceFeatures",
             area_km2 AS "areaKm2",
             ARRAY[ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), ST_YMax(geometry)] AS bbox
      FROM esa.additional_exceptions
      ORDER BY lep_name, ref`),
    nswQuery<EsaSourceLayer>(`
      SELECT layer_name AS "layerName", role, service, endpoint, items, leps
      FROM esa.source_layers ORDER BY role DESC, items DESC, layer_name`),
    nswQuery<{ note: string | null }>(
      "SELECT obj_description('esa.additional_exceptions'::regclass, 'pg_class') AS note"),
    // a missing archive is not an error: the page falls back to its panels without a map
    manifestFor('esa').catch(() => null),
  ])

  const rows = items.rows
  const sum = (kind: string) => rows.filter(r => r.coverageType === kind).reduce((t, r) => t + (r.areaKm2 ?? 0), 0)
  return {
    ok: true,
    note: note.rows[0]?.note ?? null,
    tiles: tiles && { archive: tiles.archive, builtAt: tiles.builtAt, minZoom: tiles.minZoom, maxZoom: tiles.maxZoom },
    summary: {
      items: rows.length,
      leps: new Set(rows.map(r => r.lepName)).size,
      lgas: new Set(rows.map(r => r.lgaName).filter(Boolean)).size,
      precise: rows.filter(r => r.coverageType === 'precise').length,
      advisory: rows.filter(r => r.coverageType === 'advisory').length,
      verifyRequired: rows.filter(r => r.verifyRequired).length,
      preciseKm2: Math.round(sum('precise')),
      advisoryKm2: Math.round(sum('advisory')),
      layers: layers.rows.filter(l => l.role === 'source').length,
    },
    items: rows,
    layers: layers.rows,
  }
})
