/**
 * The lot under a point.
 *
 *   /api/frontage-lot-at?lon=150.9418&lat=-34.2447  ->  { lotId: "A//DP408911" }
 *
 * The other half of statewide address search. The frontage page geocodes what
 * the user typed with Mapbox, and this turns the resulting coordinate into a
 * lot id against our own cadastre - the Martin `lot` tiles, the same parcels
 * the map draws. It asked SIX Maps until the app stopped relying on SIX; see
 * server/utils/cadastre-tiles.ts for why.
 *
 * Answers with `ok: false` rather than throwing when the point falls outside
 * any parcel, which is an ordinary outcome for a geocoded street or suburb
 * centroid.
 */

import { lotAtPoint } from '../utils/cadastre-tiles'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lon = Number(q.lon)
  const lat = Number(q.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { ok: false as const, reason: 'bad_point', message: 'Pass ?lon= and ?lat=' }
  }

  let hit: { lotId: string, area: number } | null
  try {
    hit = await lotAtPoint(lon, lat)
  } catch (err: any) {
    return {
      ok: false as const, reason: 'cadastre_unavailable',
      message: `The cadastre tile server did not respond (${String(err?.message ?? err)}).`,
    }
  }

  if (!hit) {
    return {
      ok: false as const, reason: 'no_lot_here',
      message: 'No parcel at that point — the geocoder may have landed on a road or a suburb centre.',
    }
  }
  return { ok: true as const, lotId: hit.lotId.toUpperCase() }
})
