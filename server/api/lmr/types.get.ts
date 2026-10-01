/**
 * Low and mid-rise housing, type by type, for one lot: Housing SEPP 2021 Chapter 6.
 *
 *   /api/lmr/types?cadid=123456      or   /api/lmr/types?lon=151.1&lat=-33.8
 *
 * The LMR twin of /api/cdc/types. Three layers, as there:
 *
 *   s 163   does the chapter reach the lot at all - is it within the 400 m or 800 m walking catchment of
 *           a Town Centre or Schedule 11 station (lmr.station_walking_catchments,
 *           lmr.town_centre_walking_catchments). The band decides the R3/R4 standards.
 *   s 164   the "general prerequisites": the kinds of land the chapter does not apply to, each read from
 *           the layers lmr.general names for it. One hit rules out every type.
 *   s 166-180  per type: zone, permissibility, lot area, lot width, and what the lot is then ALLOWED -
 *           FSR, height, storeys, parking - for its band. Those are standards a design meets, so they are
 *           returned beside the verdict, never tested as if they were facts about the land.
 *
 * The facts are read here; the verdict comes from shared/lmr-evaluate.ts, which scripts/build-lmr-lots.ts
 * also uses for every lot of the LMR layer - so a lot's tab and its colour on the map cannot disagree.
 *
 * WHAT IS NEVER CALLED CLEAR
 *
 *   - an s 164 item with coverage 'none' (the Georges River / Hawkesbury-Nepean PMF, the Schedule 12
 *     stations): listed as a gap, as /api/cdc/types lists generalGaps
 *   - s 164(1)(g) in one of its 23 councils we hold no flood planning map for: undecided, because the
 *     missing map is ours, not the council's
 *   - an aircraft noise contour the data cannot judge (lmr.airport_noise.lmr_verdict = 'undetermined')
 *
 * Every layer is read with the lot shrunk 10 cm, as /api/lmr/at and /api/cdc/at do, so a neighbour that
 * only touches the boundary is not a hit; and the lot is transformed into each layer's SRID, never the
 * layer into the lot's, so the GiST index is used.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { loadLmrCriteria, type LmrGeneralItem } from './criteria.get'
import {
  bandFrom, evaluateGeneral, evaluateType, NAME_COLUMNS,
  type LmrGeneralResult, type LmrLotFacts, type LmrTypeResult, type Perm,
} from '#shared/lmr-evaluate'

export type { Band, LmrGeneralResult, LmrTypeCheck, LmrTypeResult } from '#shared/lmr-evaluate'

export interface LmrTypesResponse {
  lot: LmrLotFacts
  general: LmrGeneralResult[]
  types: LmrTypeResult[]
  summary: { eligible: number; notEligible: number; unknown: number; total: number; excludedBy: string[]; gaps: string[] }
  ms: number
}

// ── the s 164 sweep, built from lmr.general ─────────────────────────────────────────────────────

const CACHE_MS = 5 * 60 * 1000
let sweep: { at: number; sql: string } | null = null

async function buildSweep(general: LmrGeneralItem[]): Promise<string> {
  if (sweep && Date.now() - sweep.at < CACHE_MS) return sweep.sql
  const meta = await nswQuery<any>(`
    SELECT g.f_table_name AS t, g.f_geometry_column AS gcol, g.srid,
           (SELECT array_agg(column_name::text) FROM information_schema.columns c
             WHERE c.table_schema = 'lmr' AND c.table_name = g.f_table_name) AS columns
      FROM geometry_columns g WHERE g.f_table_schema = 'lmr'`)
  const byTable = new Map(meta.rows.map(r => [r.t, r]))

  const parts: string[] = []
  for (const item of general) {
    for (const layer of item.layerKeys) {
      const m = byTable.get(layer)
      if (!m) continue
      const srid = Number(m.srid)
      // the lot goes to the layer's SRID; a layer declared without one is GDA94 with the SRID stripped
      const lotX = srid === 4326 ? 'ST_Transform(t.g, 4326)' : srid === 0 ? 'ST_SetSRID(t.g, 0)' : 't.g'
      const name = NAME_COLUMNS.find(c => (m.columns ?? []).includes(c))
      const fail = item.failWhere ? `(${item.failWhere})` : 'true'
      const unknown = item.unknownWhere ? `(${item.unknownWhere})` : 'false'
      parts.push(`SELECT '${item.clause}'::text AS clause, '${layer}'::text AS layer,
          count(*) FILTER (WHERE ${fail}) AS fail_n,
          count(*) FILTER (WHERE ${unknown}) AS unknown_n,
          (array_agg(DISTINCT ${name ? `c."${name}"::text` : 'NULL::text'})
             FILTER (WHERE ${name ? `c."${name}" IS NOT NULL AND (${fail} OR ${unknown})` : 'false'}))[1:3] AS names
        FROM lmr."${layer}" c, t
        WHERE c."${m.gcol}" && ${lotX} AND ST_Intersects(c."${m.gcol}", ${lotX})`)
    }
  }
  const sql = `${SHRUNK_LOT}\n${parts.join('\nUNION ALL\n')}`
  sweep = { at: Date.now(), sql }
  return sql
}

/**
 * The lot, shrunk 10 cm in NSW Lambert so a neighbour that only touches the boundary is not a hit. A sliver
 * narrower than 20 cm would vanish, so the unshrunk shape is kept then.
 */
const SHRUNK_LOT = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
  t AS MATERIALIZED (
    SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g
      FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x)`

// ── the route ───────────────────────────────────────────────────────────────────────────────────

export default defineEventHandler(async (event): Promise<LmrTypesResponse> => {
  const cadid = await cadidFromQuery(getQuery(event))
  setHeader(event, 'cache-control', 'public, max-age=60')
  return lmrTypesFor(cadid)
})

/** `?cadid=` as given, or the smallest lot under `?lon=&lat=`. Shared with /api/housing/at. */
export async function cadidFromQuery(q: Record<string, any>): Promise<string> {
  let cadid = String(q.cadid ?? '').trim()
  const lon = Number(q.lon)
  const lat = Number(q.lat)
  if (!cadid) {
    const inNsw = Number.isFinite(lon) && Number.isFinite(lat) && lon >= 140 && lon <= 155 && lat >= -38 && lat <= -27
    if (!inNsw) throw createError({ statusCode: 400, statusMessage: 'Give a cadid, or lon and lat inside NSW' })
    const hit = await nswQuery<any>(
      `SELECT cadid FROM cadastre.lot WHERE geom && $1::geometry AND ST_Intersects(geom, $1::geometry)
        ORDER BY ST_Area(geom) LIMIT 1`, [`SRID=4283;POINT(${lon} ${lat})`])
    cadid = hit.rows[0]?.cadid
    if (!cadid) throw createError({ statusCode: 404, statusMessage: 'No lot at that point' })
  }
  return String(cadid)
}

/**
 * The whole Chapter 6 answer for one lot. Exported so /api/housing/at can ask whether multi dwelling housing,
 * residential flat buildings or shop top housing are permissible under Chapter 6 (Housing SEPP s 72(2)(a2),
 * s 15C(1)(a)) with the same reading /lmr gives, rather than a second one.
 */
export async function lmrTypesFor(cadid: string): Promise<LmrTypesResponse> {
  const started = Date.now()
  const criteria = await loadLmrCriteria()

  const facts = await nswQuery<any>(`${SHRUNK_LOT}
    SELECT l.cadid, l.lotidstring AS lot_id, ST_Area(l.geom::geography) AS area_m2,
           p.primary_frontage_length_m, p.is_battleaxe,
           (SELECT upper(lga_name) FROM derived.lot_lga WHERE cadid = l.cadid) AS lga,
           (SELECT array_agg(DISTINCT z.sym_code::text) FROM epi.epi_land_zoning z
             WHERE z.geom && t.g AND ST_Intersects(z.geom, t.g) AND z.sym_code IS NOT NULL) AS zones,
           (SELECT array_agg(DISTINCT w.station || ' (' || w.distance_m || ' m)') FROM lmr.station_walking_catchments w
             WHERE w.geom && t.g AND ST_Intersects(w.geom, t.g)) AS stations,
           (SELECT min(w.distance_m) FROM lmr.station_walking_catchments w
             WHERE w.geom && t.g AND ST_Intersects(w.geom, t.g)) AS station_min,
           -- declared plain geometry (geometry_columns says SRID 0), but every row is 4283
           (SELECT array_agg(DISTINCT w.label || ' (' || w.distance_m || ' m)') FROM lmr.town_centre_walking_catchments w
             WHERE w.geom && t.g AND ST_Intersects(w.geom, t.g)) AS centres,
           (SELECT min(w.distance_m) FROM lmr.town_centre_walking_catchments w
             WHERE w.geom && t.g AND ST_Intersects(w.geom, t.g)) AS centre_min
      FROM cadastre.lot l CROSS JOIN t
      LEFT JOIN derived.lot_profile p ON p.cadid = l.cadid
     WHERE l.cadid = $1 LIMIT 1`, [cadid])
  const r = facts.rows[0]
  if (!r) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  const lot: LmrLotFacts = {
    cadid: r.cadid, lotId: r.lot_id, lga: r.lga ?? null,
    areaM2: r.area_m2 == null ? null : Number(r.area_m2),
    // lot width is the property's primary frontage (Manni, 2026-09-30): the same figure /cdc and the Pattern
    // Book test. A landlocked lot has none, and its width checks are then undecided rather than guessed.
    widthM: r.primary_frontage_length_m != null ? Number(r.primary_frontage_length_m) : null,
    isBattleaxe: r.is_battleaxe == null ? null : Boolean(r.is_battleaxe),
    zones: (r.zones ?? []).sort(),
    band: bandFrom(r.station_min == null ? null : Number(r.station_min), r.centre_min == null ? null : Number(r.centre_min)),
    measuredFrom: [...(r.stations ?? []), ...(r.centres ?? [])].sort(),
  }

  // permissibility of every use the types turn on, from the same zoning polygons the zone check reads
  const uses = [...new Set(criteria.types.flatMap(t => t.landUses))].map(u => u.toLowerCase())
  const perm = await nswQuery<any>(`${SHRUNK_LOT},
    z AS (SELECT DISTINCT z.epi_name, z.sym_code FROM epi.epi_land_zoning z, t
           WHERE z.geom && t.g AND ST_Intersects(z.geom, t.g) AND z.sym_code IS NOT NULL)
    SELECT z.epi_name AS epi, z.sym_code AS zone, p.land_use, p.status
      FROM z JOIN nsw.lep_permissibility p ON p.epi_name = z.epi_name AND p.zone_code = z.sym_code
     WHERE lower(p.land_use) = ANY($2)`, [cadid, uses])
  const permRows: Perm[] = perm.rows.map((x: any) => ({ epi: x.epi, zone: x.zone, landUse: x.land_use, status: x.status }))

  const sweepRows = (await nswQuery<any>(await buildSweep(criteria.general), [cadid])).rows
  const general = criteria.general.map((g) => {
    const mine = sweepRows.filter(s => s.clause === g.clause)
    return evaluateGeneral(g, {
      failN: mine.reduce((n, s) => n + Number(s.fail_n), 0),
      unknownN: mine.reduce((n, s) => n + Number(s.unknown_n), 0),
      names: [...new Set(mine.flatMap(s => s.names ?? []))] as string[],
    }, lot.lga)
  })
  const excluded = general.filter(g => g.status === 'excluded')
  const undecided = general.filter(g => g.status === 'unknown')

  const ORDER = (e: boolean | null) => (e === true ? 0 : e === null ? 1 : 2)
  const types = criteria.types
    .map((t, i) => ({ ...evaluateType(t, lot, permRows, excluded, undecided), _i: i }))
    .sort((a, b) => ORDER(a.eligible) - ORDER(b.eligible) || a._i - b._i)
    .map(({ _i, ...rest }) => rest)

  return {
    lot,
    general,
    types,
    summary: {
      eligible: types.filter(t => t.eligible === true).length,
      notEligible: types.filter(t => t.eligible === false).length,
      unknown: types.filter(t => t.eligible === null).length,
      total: types.length,
      excludedBy: excluded.map(e => e.clause),
      gaps: general.filter(g => g.status === 'gap').map(g => g.clause),
    },
    ms: Date.now() - started,
  }
}
