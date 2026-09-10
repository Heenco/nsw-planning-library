/**
 * The lot at a coordinate.
 *
 *   /api/frontage-lot-at?lon=150.9418&lat=-34.2447  ->  { lotId: "A//DP408911" }
 *
 * The other half of statewide address search. up_property_d_3 maps an address
 * straight to `lot_section_plan`, but it holds Randwick and Hornsby only, while
 * the frontage calculation works anywhere in NSW. For everywhere else the page
 * geocodes with Mapbox — which it already does on /prop-width — and this turns
 * the resulting point into a lot id against the statewide SIX cadastre.
 *
 * Answers with `ok: false` rather than throwing when the point falls outside any
 * parcel, which is an ordinary outcome for a geocoded street or suburb centroid.
 */

import { assertOk, lotAtPointUrl } from '#shared/cadastre-query.mjs'

const TIMEOUT_MS = 12000

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lon = Number(q.lon)
  const lat = Number(q.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { ok: false as const, reason: 'bad_point', message: 'Pass ?lon= and ?lat=' }
  }

  let json: any
  try {
    const res = await fetch(lotAtPointUrl(lon, lat), { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`cadastre service returned ${res.status}`)
    json = assertOk(await res.json())
  } catch (err: any) {
    return {
      ok: false as const, reason: 'cadastre_unavailable',
      message: `The SIX Maps cadastre did not respond (${String(err?.message ?? err)}).`,
    }
  }

  const lotId = json?.features?.[0]?.properties?.lotidstring
  if (!lotId) {
    return {
      ok: false as const, reason: 'no_lot_here',
      message: 'No parcel at that point — the geocoder may have landed on a road or a suburb centre.',
    }
  }
  return { ok: true as const, lotId: String(lotId).toUpperCase() }
})
