/**
 * Lot facts for the norms engine (trial): what our data can say about a lot, with nothing guessed.
 *   zone / plan  epi.epi_land_zoning at the lot's point on surface
 *   area         the cadastre polygon
 *   Lot Size Map epi.epi_lot_size at the same point; "not on the map" only when the plan HAS polygons in our copy -
 *                if it has none, whether the lot is on the map cannot be told (null)
 *   Land Use Table  nsw.lep_permissibility for the plan and zone
 *   site         only what the lot record itself shows: a strata plan ('//SP') means a strata scheme exists
 * Takes the query function, so the API route (nswQuery) and the scripts (a pg client) share it.
 */
import type { LotFacts } from './engine'

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>

export async function lotFacts(query: Query, cadid: string, key: (u: string) => string): Promise<LotFacts> {
  const row = (await query(`
    WITH p AS (SELECT l.cadid, l.lotidstring, ST_Area(l.geom::geography) AS area, ST_PointOnSurface(l.geom) AS pt FROM cadastre.lot l WHERE l.cadid::text = $1)
    SELECT p.cadid, p.lotidstring, p.area,
           (SELECT upper(lga_name) FROM derived.lot_lga g WHERE g.cadid::text = p.cadid::text) AS lga,
           (SELECT json_build_object('zone', z.sym_code, 'epi', z.epi_name) FROM epi.epi_land_zoning z
             WHERE z.geom && p.pt AND ST_Intersects(z.geom, p.pt) AND z.sym_code IS NOT NULL LIMIT 1) AS zoning
      FROM p`, [cadid])).rows[0]
  if (!row) throw new Error(`no lot ${cadid}`)
  const epi: string | null = row.zoning?.epi ?? null
  const zone: string | null = row.zoning?.zone?.trim() ?? null
  let lotSizeMinM2: number | null = null, onLotSizeMap: boolean | null = null
  if (epi) {
    const ls = (await query(`
      SELECT z.lot_size, z.units FROM epi.epi_lot_size z, cadastre.lot l
       WHERE l.cadid::text = $1 AND z.epi_name = $2 AND z.geom && ST_PointOnSurface(l.geom) AND ST_Intersects(z.geom, ST_PointOnSurface(l.geom)) LIMIT 1`, [cadid, epi])).rows[0]
    if (ls) { onLotSizeMap = true; lotSizeMinM2 = /ha/i.test(String(ls.units)) ? Number(ls.lot_size) * 10000 : Number(ls.lot_size) }
    else onLotSizeMap = (await query(`SELECT EXISTS (SELECT 1 FROM epi.epi_lot_size WHERE epi_name = $1) AS e`, [epi])).rows[0].e ? false : null
  }
  const lut: Record<string, string> = {}
  if (epi && zone) {
    for (const r of (await query(`SELECT land_use, status FROM nsw.lep_permissibility WHERE epi_name = $1 AND zone_code = $2`, [epi, zone])).rows) {
      const k = key(r.land_use)
      // a permitted row wins over a prohibited one under the same key ("dual occupancies" vs "(attached)")
      if (!lut[k] || /^permitted/.test(r.status)) lut[k] = r.status
    }
  }
  const lotId: string | null = row.lotidstring ?? null
  return { cadid, lotId, zone, epi, lga: row.lga ?? null, areaM2: row.area == null ? null : Math.round(Number(row.area)),
           lotSizeMinM2, onLotSizeMap, lut, site: { [key('strata scheme')]: /\/\/SP\d/i.test(String(lotId ?? '')) } }
}
