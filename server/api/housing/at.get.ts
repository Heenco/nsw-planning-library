/**
 * Build-to-rent and the affordable housing bonus for one lot.
 *
 *   /api/housing/at?cadid=123456     or   /api/housing/at?lon=151.1&lat=-33.8
 *
 * Read by /build-to-rent and /affordable-housing. One route for both because the bonus counts build-to-rent
 * as one way of being "permitted with consent" (s 15C(1)(a)), so the second answer needs the first.
 *
 * Facts are read here, verdicts come from shared/housing-evaluate.ts. Chapter 6 is not re-derived: the LMR
 * route's own answer (lmrTypesFor) is reduced to "is this use permissible under Chapter 6", so a lot cannot
 * be permissible here and not on /lmr. Every layer is read with the lot shrunk 10 cm, and the lot goes into
 * each layer's SRID (access.* is 4326, the rest 4283).
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { cadidFromQuery, lmrTypesFor, type LmrTypesResponse } from '../lmr/types.get'
import {
  evaluateAhb, evaluateBtr, RELEVANT_ZONES, RESIDENTIAL_DEVELOPMENT,
  type Ch6Type, type HousingFacts, type HousingVerdict,
} from '#shared/housing-evaluate'

export interface HousingAtResponse {
  facts: HousingFacts
  btr: HousingVerdict
  ahb: HousingVerdict
  geometry: any
  ms: number
}

const SHRUNK_LOT = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
  t AS MATERIALIZED (
    SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g
      FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x),
  t4 AS MATERIALIZED (SELECT ST_Transform(g, 4326) AS g FROM t)`

/** The residential Chapter 6 types (not the subdivision ones), reduced to permissibility. */
const CH6_HOUSING = ['dual-occupancy', 'multi-dwelling-housing', 'multi-dwelling-terraces', 'rfb-shop-top-r1-r2', 'rfb-shop-top-r3-r4']

/**
 * "Permissible under Chapter 6" is the chapter reaching the lot (s 163), the land not excluded (s 164), the
 * zone and the use - not the lot size and width, which are development standards a design meets.
 */
function ch6From(lmr: LmrTypesResponse): Ch6Type[] {
  const excluded = lmr.general.filter(g => g.status === 'excluded')
  const undecided = lmr.general.filter(g => g.status === 'unknown')
  return lmr.types.filter(t => CH6_HOUSING.includes(t.key)).map((t) => {
    const get = (c: string) => t.checks.find(x => x.column === c)
    const gate = [get('lmr_area'), get('zone'), get('permissibility')].filter(Boolean) as { pass: boolean | null; says: string; actual: string | null }[]
    if (excluded.length) return { key: t.key, name: t.name, permissible: false, why: `Chapter 6 does not apply: excluded by s ${excluded.map(e => e.clause).join(', s ')}.` }
    const fail = gate.find(c => c.pass === false)
    if (fail) return { key: t.key, name: t.name, permissible: false, why: `${t.name} needs ${fail.says.replace(/^zone is/, 'zone')}; this lot: ${fail.actual ?? 'not measured'}.` }
    const open = gate.find(c => c.pass === null)
    if (open) return { key: t.key, name: t.name, permissible: null, why: `${t.name}: ${open.actual ?? open.says}.` }
    if (undecided.length) return { key: t.key, name: t.name, permissible: null, why: `s ${undecided.map(e => e.clause).join(', s ')} cannot be decided for this lot (see /lmr).` }
    return { key: t.key, name: t.name, permissible: true, why: `${t.name} permissible under Chapter 6.` }
  })
}

export default defineEventHandler(async (event): Promise<HousingAtResponse> => {
  const started = Date.now()
  const cadid = await cadidFromQuery(getQuery(event))
  setHeader(event, 'cache-control', 'public, max-age=60')

  const [lmr, factsRes, permRes] = await Promise.all([
    lmrTypesFor(cadid),
    nswQuery<any>(`${SHRUNK_LOT}
      SELECT l.cadid, l.lotidstring AS lot_id, ST_Area(l.geom::geography) AS area_m2,
             ST_AsGeoJSON(l.geom, 7)::json AS geometry,
             (SELECT upper(lga_name) FROM derived.lot_lga WHERE cadid = l.cadid) AS lga,
             (SELECT array_agg(DISTINCT z.sym_code::text) FROM epi.epi_land_zoning z
               WHERE z.geom && t.g AND ST_Intersects(z.geom, t.g) AND z.sym_code IS NOT NULL) AS zones,
             (SELECT array_agg(DISTINCT coalesce(nullif(a.precinct, ''), 'unnamed')) FROM lmr.sepp_tod_areas a
               WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g)) AS tod,
             (SELECT array_agg(DISTINCT coalesce(nullif(a.precinct, ''), nullif(a.label, ''), 'unnamed')) FROM lmr.sepp_tod_accelerated_precincts a
               WHERE a.geom && t.g AND ST_Intersects(a.geom, t.g)) AS accelerated,
             (SELECT array_agg(DISTINCT s.label::text) FROM epi.epi_state_significant_dev_sites s
               WHERE s.label IS NOT NULL AND s.geom && t.g AND ST_Intersects(s.geom, t.g)) AS ssd,
             EXISTS (SELECT 1 FROM epi.epi_land_application a
               WHERE a.label = 'Sydney Olympic Park' AND a.geom && t.g AND ST_Intersects(a.geom, t.g)) AS sop,
             (SELECT array_agg(DISTINCT f.fsr) FROM epi.epi_floor_space_ratio f
               WHERE f.geom && t.g AND ST_Intersects(f.geom, t.g) AND f.fsr > 0) AS fsr,
             (SELECT array_agg(DISTINCT h.max_b_h) FROM epi.epi_height_of_building h
               WHERE h.geom && t.g AND ST_Intersects(h.geom, t.g) AND h.max_b_h > 0) AS hob,
             (SELECT array_agg(DISTINCT i.source_name ORDER BY i.source_name) FROM access.iso_train i
               WHERE i.geom && t4.g AND ST_Intersects(i.geom, t4.g)) AS train_iso,
             (SELECT json_build_object('n', count(*), 'names', (array_agg(i.source_name ORDER BY i.source_name))[1:3],
                                       'fallback', count(*) FILTER (WHERE i.method <> 'isochrone'))
                FROM access.iso_bus i WHERE i.geom && t4.g AND ST_Intersects(i.geom, t4.g)) AS bus_iso,
             (SELECT json_build_object('zone', z.sym_code, 'distanceM', ST_Distance(z.geom::geography, t.g::geography))
                FROM epi.epi_land_zoning z
               WHERE z.sym_code = ANY($2) AND z.geom && ST_Expand(t.g, 0.0105)
               ORDER BY ST_Distance(z.geom::geography, t.g::geography) LIMIT 1) AS relevant_zone
        FROM cadastre.lot l, t, t4 WHERE l.cadid = $1 LIMIT 1`, [cadid, RELEVANT_ZONES]),
    nswQuery<any>(`${SHRUNK_LOT},
      z AS (SELECT DISTINCT z.epi_name, z.sym_code FROM epi.epi_land_zoning z, t
             WHERE z.geom && t.g AND ST_Intersects(z.geom, t.g) AND z.sym_code IS NOT NULL)
      SELECT z.epi_name AS epi, z.sym_code AS zone, p.land_use, p.status
        FROM z JOIN nsw.lep_permissibility p ON p.epi_name = z.epi_name AND p.zone_code = z.sym_code
       WHERE lower(p.land_use) = ANY($2)`, [cadid, RESIDENTIAL_DEVELOPMENT]),
  ])

  const r = factsRes.rows[0]
  if (!r) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })
  const num = (xs: any[] | null) => (xs ?? []).map(Number).filter(Number.isFinite)

  const facts: HousingFacts = {
    cadid: String(r.cadid),
    lotId: r.lot_id ?? null,
    lga: r.lga ?? null,
    areaM2: r.area_m2 == null ? null : Number(r.area_m2),
    zones: (r.zones ?? []).sort(),
    perm: permRes.rows.map((x: any) => ({ epi: x.epi, zone: x.zone, landUse: x.land_use, status: x.status })),
    tod: (r.tod ?? []).sort(),
    accelerated: (r.accelerated ?? []).sort(),
    ssd: r.ssd ?? [],
    sydneyOlympicPark: Boolean(r.sop),
    fsr: num(r.fsr),
    heightM: num(r.hob),
    trainIso: r.train_iso ?? [],
    busIso: { n: Number(r.bus_iso?.n ?? 0), names: r.bus_iso?.names ?? [], fallback: Number(r.bus_iso?.fallback ?? 0) },
    relevantZone: r.relevant_zone ? { zone: r.relevant_zone.zone, distanceM: Number(r.relevant_zone.distanceM) } : null,
    ch6: ch6From(lmr),
    lmrBand: lmr.lot.band ? `${lmr.lot.band} area, from ${lmr.lot.measuredFrom.join(', ')}` : null,
  }

  const btr = evaluateBtr(facts)
  const ahb = evaluateAhb(facts, btr)
  return { facts, btr, ahb, geometry: r.geometry, ms: Date.now() - started }
})
