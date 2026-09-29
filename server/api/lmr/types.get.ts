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
 *   s 164   the "general prerequisites": thirteen kinds of land the chapter does not apply to, each read
 *           from the layers lmr.general names for it. One hit rules out every type.
 *   s 166-180  per type: zone, permissibility, lot area, lot width, and what the lot is then ALLOWED -
 *           FSR, height, storeys, parking - for its band. Those are standards a design meets, so they are
 *           returned beside the verdict, never tested as if they were facts about the land.
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
import { loadLmrCriteria, type LmrAllowanceRow, type LmrGeneralItem, type LmrType } from './criteria.get'

export type Band = 'inner' | 'outer'

export interface LmrTypeCheck {
  column: string
  says: string
  actual: string | null
  /** null when nothing measured it - unknown is not failure. */
  pass: boolean | null
}

export interface LmrGeneralResult {
  clause: string
  text: string
  href: string
  coverage: 'full' | 'partial' | 'none'
  caveat: string | null
  /** excluded: the lot is in it. unknown: the data cannot say. gap: nothing answers it. n/a: the clause does not reach this council. */
  status: 'clear' | 'excluded' | 'unknown' | 'gap' | 'n/a'
  why: string
  layers: string[]
  names: string[]
}

export interface LmrTypeResult {
  key: string
  name: string
  part: string
  sections: string
  eligible: boolean | null
  checks: LmrTypeCheck[]
  /** What the lot is allowed for this type in its band: standards the design has to meet. */
  allowances: LmrAllowanceRow[]
  untested: number
  untestedReasons: { reason: string; count: number }[]
  requirements: number
  verdict: string
}

export interface LmrTypesResponse {
  lot: {
    cadid: string
    lotId: string | null
    lga: string | null
    areaM2: number | null
    widthM: number | null
    isBattleaxe: boolean | null
    zones: string[]
    band: Band | null
    /** What the band was measured from: '<station> (400 m)', '<town centre> (800 m)'. */
    measuredFrom: string[]
  }
  general: LmrGeneralResult[]
  types: LmrTypeResult[]
  summary: { eligible: number; notEligible: number; unknown: number; total: number; excludedBy: string[]; gaps: string[] }
  ms: number
}

// ── the s 164 sweep, built from lmr.general ─────────────────────────────────────────────────────

// noise_verdict first: the Sydney Airport ANEI rows carry no name, and the verdict sentence is the useful label
const NAME_COLUMNS = ['noise_verdict', 'label', 'name', 'itemname', 'h_name', 'council_name', 'station', 'lay_class', 'd_category']
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

function evaluateGeneral(item: LmrGeneralItem, rows: any[], lga: string | null): LmrGeneralResult {
  const mine = rows.filter(r => r.clause === item.clause)
  const failN = mine.reduce((n, r) => n + Number(r.fail_n), 0)
  const unknownN = mine.reduce((n, r) => n + Number(r.unknown_n), 0)
  const names = [...new Set(mine.flatMap(r => r.names ?? []))].slice(0, 4)
  const base = { clause: item.clause, text: item.text, href: item.href, coverage: item.coverage,
                 caveat: item.caveat, layers: item.layerKeys, names }

  if (item.coverage === 'none') return { ...base, status: 'gap', why: 'No dataset answers this, so the lot is untested against it.' }
  if (item.lgaScope && lga && !item.lgaScope.includes(lga)) {
    return { ...base, status: 'n/a', why: `Only reaches ${item.lgaScope.length} named councils; this lot is in ${lga}.` }
  }
  if (failN) return { ...base, status: 'excluded', why: names.length ? `On the lot: ${names.join(', ')}.` : 'The lot is in it.' }
  if (unknownN) return { ...base, status: 'unknown', why: `On the lot, but the data cannot decide it: ${names.join(', ') || 'see the layer'}.` }
  if (item.lgaScope && lga && item.heldLgas && !item.heldLgas.includes(lga)) {
    return { ...base, status: 'unknown', why: `${lga} is one of the councils this reaches, and we hold no map of it there.` }
  }
  if (item.lgaScope && !lga) return { ...base, status: 'unknown', why: 'The lot\'s council is not recorded, so whether this reaches it is not known.' }
  return { ...base, status: 'clear', why: 'Nothing on the lot.' }
}

// ── the per-type checks ─────────────────────────────────────────────────────────────────────────

function zonesFrom(says: string): string[] {
  const m = says.match(/zone is (.+)$/i)
  return m ? m[1]!.split(/,\s*/).map(z => z.trim().toUpperCase()) : []
}
function thresholdFrom(says: string): number | null {
  const m = says.replace(/,/g, '').match(/([\d.]+)\s*m/i)
  return m ? Number(m[1]) : null
}

interface Perm { epi: string; zone: string; landUse: string; status: string }

function permissibility(t: LmrType, says: string, zones: string[], perm: Perm[]): LmrTypeCheck {
  const inTypeZones = zones.filter(z => t.zones.includes(z))
  // the SEPP's own grant wins whatever the LEP says: s 166 dual occupancies in R2, s 170, s 174, s 169(1A), s 173(1A)
  const granted = inTypeZones.filter(z => t.seppPermitsIn.includes(z))
  if (granted.length) {
    return { column: 'permissibility', says, pass: true,
             actual: `permitted with consent by s ${t.seppPermitsClause} in ${granted.join(', ')}, whatever the LEP says` }
  }
  if (!inTypeZones.length) return { column: 'permissibility', says, pass: null, actual: 'not in a zone this type applies in' }
  if (!t.landUses.length) return { column: 'permissibility', says, pass: null, actual: 'no land-use term to test' }
  const want = new Set(t.landUses.map(u => u.toLowerCase()))
  const rows = perm.filter(p => inTypeZones.includes(p.zone) && want.has(p.landUse.toLowerCase()))
  const yes = rows.find(p => p.status === 'permitted_with_consent')
  if (yes) return { column: 'permissibility', says, pass: true, actual: `${yes.landUse} permitted with consent in ${yes.zone} under ${yes.epi}` }
  if (!rows.length) {
    return { column: 'permissibility', says, pass: null,
             actual: `no permissibility recorded for ${t.landUses[0]} in ${inTypeZones.join(', ')}` }
  }
  const mixed = rows.find(p => p.status === 'mixed')
  if (mixed) return { column: 'permissibility', says, pass: null, actual: `${mixed.landUse} is permitted only in part of ${mixed.zone} under ${mixed.epi}` }
  const r = rows[0]!
  return { column: 'permissibility', says, pass: false, actual: `${r.landUse} ${r.status.replace(/_/g, ' ')} in ${r.zone} under ${r.epi}` }
}

function evaluate(t: LmrType, lot: LmrTypesResponse['lot'], perm: Perm[], excluded: LmrGeneralResult[], undecided: LmrGeneralResult[]): LmrTypeResult {
  const checks: LmrTypeCheck[] = t.checks.map((c) => {
    switch (c.column) {
      case 'lmr_area':
        return { ...c, pass: lot.band != null,
                 actual: lot.band ? `${lot.band === 'inner' ? 'inner area, within 400 m' : 'outer area, 400-800 m'} of ${lot.measuredFrom.join(', ')}`
                   : 'outside the 800 m walking catchments of every Town Centre and Schedule 11 station' }
      case 'zone': {
        const want = zonesFrom(c.says)
        return { ...c, actual: lot.zones.length ? lot.zones.join(', ') : null,
                 pass: lot.zones.length ? lot.zones.some(z => want.includes(z)) : null }
      }
      case 'permissibility':
        return permissibility(t, c.says, lot.zones, perm)
      case 'area': {
        const need = thresholdFrom(c.says)
        return { ...c, actual: lot.areaM2 == null ? null : `${Math.round(lot.areaM2).toLocaleString()} m²`,
                 pass: lot.areaM2 == null || need == null ? null : lot.areaM2 >= need }
      }
      case 'width': {
        const need = thresholdFrom(c.says)
        return { ...c, actual: lot.widthM == null ? null : `${lot.widthM.toFixed(1)} m at the setback line`,
                 pass: lot.widthM == null || need == null ? null : lot.widthM >= need }
      }
      case 'derived:not_battleaxe':
        return { ...c, actual: lot.isBattleaxe == null ? null : lot.isBattleaxe ? 'is a battle-axe lot' : 'is not a battle-axe lot',
                 pass: lot.isBattleaxe == null ? null : !lot.isBattleaxe }
      default:
        return { ...c, actual: null, pass: null }
    }
  })

  const failed = checks.filter(c => c.pass === false)
  const unknown = checks.filter(c => c.pass === null)
  const eligible = excluded.length || failed.length ? false : (undecided.length || unknown.length) ? null : true

  const allowances = t.allowances.filter(a => a.band === 'any' || a.band === lot.band)
  const tally: Record<string, number> = {}
  for (const r of t.requirements) if (!r.tested && r.untestedWhy) tally[r.untestedWhy] = (tally[r.untestedWhy] ?? 0) + 1
  const untestedReasons = Object.entries(tally).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  const untested = untestedReasons.reduce((n, r) => n + r.count, 0)

  let verdict: string
  // an exclusion is the stronger answer: it holds wherever the catchments are later redrawn
  if (excluded.length) verdict = `Excluded by s ${excluded.map(e => e.clause).join(', s ')}: the chapter does not apply to this land.`
  else if (!lot.band) verdict = 'The chapter does not reach this lot: it is outside every low and mid rise housing area (s 163).'
  else if (failed.length) verdict = 'Fails ' + failed.map(c => c.says).join('; ') + '.'
  else if (undecided.length) verdict = `Clears its own checks, but s ${undecided.map(e => e.clause).join(', s ')} cannot be decided for this lot.`
  else if (unknown.length) verdict = 'Cannot be decided: ' + unknown.map(c => `${c.column} (${c.actual ?? 'not measured'})`).join('; ') + '.'
  else verdict = `Clears every check that reduces to a lot (${checks.length}).`
  if (eligible !== false && allowances.length) {
    verdict += ' Allowed: ' + allowances.map(a => [
      a.forUse, a.fsr != null ? `FSR ${a.fsr}:1` : null, a.heightM != null ? `${a.heightM} m` : null,
      a.storeys ? `${a.storeys} storeys` : null,
    ].filter(Boolean).join(' ')).join('; ') + '.'
  }
  if (untested) {
    verdict += ` ${untested} of its ${t.requirements.length} requirements are not tested here: `
      + untestedReasons.map(r => `${r.count} ${r.reason}`).join('; ') + '.'
  }

  return { key: t.key, name: t.name, part: t.part, sections: t.sections, eligible, checks, allowances,
           untested, untestedReasons, requirements: t.requirements.length, verdict }
}

// ── the route ───────────────────────────────────────────────────────────────────────────────────

export default defineEventHandler(async (event): Promise<LmrTypesResponse> => {
  const started = Date.now()
  const q = getQuery(event)
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
  setHeader(event, 'cache-control', 'public, max-age=60')

  const criteria = await loadLmrCriteria()

  const facts = await nswQuery<any>(`${SHRUNK_LOT}
    SELECT l.cadid, l.lotidstring AS lot_id, ST_Area(l.geom::geography) AS area_m2,
           p.width_at_setback_m, p.lot_width_max_m, p.is_battleaxe,
           (SELECT upper(lga_name) FROM derived.lot_lga WHERE cadid = l.cadid) AS lga,
           (SELECT array_agg(DISTINCT z.sym_code::text) FROM epi.epi_land_zoning z
             WHERE z.geom && t.g AND ST_Intersects(z.geom, t.g) AND z.sym_code IS NOT NULL) AS zones,
           (SELECT array_agg(DISTINCT w.station || ' (' || w.distance_m || ' m)') FROM lmr.station_walking_catchments w
             WHERE w.geom && t.g AND ST_Intersects(w.geom, t.g)) AS stations,
           (SELECT min(w.distance_m) FROM lmr.station_walking_catchments w
             WHERE w.geom && t.g AND ST_Intersects(w.geom, t.g)) AS station_min,
           (SELECT array_agg(DISTINCT w.label || ' (' || w.distance_m || ' m)') FROM lmr.town_centre_walking_catchments w
             WHERE w.geom && ST_SetSRID(t.g, 0) AND ST_Intersects(w.geom, ST_SetSRID(t.g, 0))) AS centres,
           (SELECT min(w.distance_m) FROM lmr.town_centre_walking_catchments w
             WHERE w.geom && ST_SetSRID(t.g, 0) AND ST_Intersects(w.geom, ST_SetSRID(t.g, 0))) AS centre_min
      FROM cadastre.lot l CROSS JOIN t
      LEFT JOIN derived.lot_profile p ON p.cadid = l.cadid
     WHERE l.cadid = $1 LIMIT 1`, [cadid])
  const r = facts.rows[0]
  if (!r) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  const nearest = Math.min(Number(r.station_min ?? Infinity), Number(r.centre_min ?? Infinity))
  const band: Band | null = nearest <= 400 ? 'inner' : nearest <= 800 ? 'outer' : null
  const lot: LmrTypesResponse['lot'] = {
    cadid: r.cadid, lotId: r.lot_id, lga: r.lga ?? null,
    areaM2: r.area_m2 == null ? null : Number(r.area_m2),
    widthM: r.width_at_setback_m != null ? Number(r.width_at_setback_m) : r.lot_width_max_m != null ? Number(r.lot_width_max_m) : null,
    isBattleaxe: r.is_battleaxe == null ? null : Boolean(r.is_battleaxe),
    zones: (r.zones ?? []).sort(),
    band,
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
  const general = criteria.general.map(g => evaluateGeneral(g, sweepRows, lot.lga))
  const excluded = general.filter(g => g.status === 'excluded')
  const undecided = general.filter(g => g.status === 'unknown')

  const ORDER = (e: boolean | null) => (e === true ? 0 : e === null ? 1 : 2)
  const types = criteria.types
    .map((t, i) => ({ ...evaluate(t, lot, permRows, excluded, undecided), _i: i }))
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
})
