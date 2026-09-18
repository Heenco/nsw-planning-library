/**
 * The SEPP-conferred permissibility table behind /sepp.
 *
 * `nsw.sepp_permissible_landuse` is 263 rows - a land use, the SEPP that permits it, and the zone
 * it is permitted in - so the whole table is returned and the page filters it in the browser. The
 * counts come back from the database rather than being recomputed there, and the table's own
 * COMMENT is passed through as the provenance line the page prints.
 */
import { nswQuery } from '../utils/nsw-kg/pool'

export interface SeppRow { zone: string; sepp: string; landUse: string }

export interface SeppPermissibility {
  ok: boolean
  reason?: string
  /** What the table says about itself: where the rows came from, and when. */
  note: string | null
  rows: SeppRow[]
  summary: {
    rows: number
    zones: number
    sepps: number
    uses: number
    bySepp: { sepp: string; rows: number; zones: number; uses: number }[]
    byZone: { zone: string; rows: number; uses: string[] }[]
  }
}

export default defineEventHandler(async (event): Promise<SeppPermissibility> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  const empty = { rows: 0, zones: 0, sepps: 0, uses: 0, bySepp: [], byZone: [] }

  const present = await nswQuery<{ t: string | null }>(
    "SELECT to_regclass('nsw.sepp_permissible_landuse')::text AS t")
  if (!present.rows[0]?.t) {
    return {
      ok: false,
      reason: 'nsw.sepp_permissible_landuse is not in this database yet - it is loaded by "05 - Import SEPP '
        + 'Permissible Landuse" and copied across from UrbanPortalDBP.',
      note: null,
      rows: [],
      summary: empty,
    }
  }

  const [rows, note, bySepp, byZone] = await Promise.all([
    nswQuery<SeppRow>(`SELECT zone, sepp, land_use AS "landUse" FROM nsw.sepp_permissible_landuse
                       ORDER BY zone, sepp, land_use`),
    nswQuery<{ note: string | null }>(
      "SELECT obj_description('nsw.sepp_permissible_landuse'::regclass, 'pg_class') AS note"),
    nswQuery<{ sepp: string; rows: number; zones: number; uses: number }>(
      `SELECT sepp, count(*)::int AS rows, count(DISTINCT zone)::int AS zones, count(DISTINCT land_use)::int AS uses
       FROM nsw.sepp_permissible_landuse GROUP BY sepp ORDER BY count(*) DESC`),
    nswQuery<{ zone: string; rows: number; uses: string[] }>(
      `SELECT zone, count(*)::int AS rows, array_agg(land_use ORDER BY land_use) AS uses
       FROM nsw.sepp_permissible_landuse GROUP BY zone ORDER BY zone`),
  ])

  return {
    ok: true,
    note: note.rows[0]?.note ?? null,
    rows: rows.rows,
    summary: {
      rows: rows.rows.length,
      zones: byZone.rows.length,
      sepps: bySepp.rows.length,
      uses: new Set(rows.rows.map(r => r.landUse)).size,
      bySepp: bySepp.rows,
      byZone: byZone.rows,
    },
  }
})
