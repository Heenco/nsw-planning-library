/**
 * Exact parcel boundaries from the NSW cadastre.
 *
 * No parcel polygon is stored in our own database — `geom_1` and
 * `centroid_geom` are empty on every row of up_property_d_3, and
 * `buffered_geom` is an inward buffer whose area runs ~15% under the recorded
 * `area_sqm`. The Martin tile layer has the real boundary, but only as
 * simplified, tile-clipped vector tiles, and only in the browser.
 *
 * SIX Maps publishes the authoritative cadastre as a public ArcGIS service,
 * queryable by `lotidstring` — the exact value up_property_d_3 already holds
 * as `lot_section_plan` ("711//DP752053", or "//SP16231" for a strata plan).
 * Measured against two lots, area and perimeter both agree with the recorded
 * figures to within 0.1%.
 *
 * Callers must still validate: the service can return a neighbouring parcel
 * for a malformed id, and a lot may have been resubdivided since the property
 * row was written. `fetchLotRing` checks the geometry against the recorded
 * area and perimeter and returns null rather than a boundary it cannot stand
 * behind.
 */

import { ringPerimeter } from '#shared/lot-edges.mjs'
import { ringArea } from '#shared/geo-measure.mjs'

const SERVICE = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query'

/** How far the fetched polygon may differ from the recorded figures. */
const AREA_TOLERANCE = 0.05
const PERIMETER_TOLERANCE = 0.05

const TIMEOUT_MS = 6000

/**
 * Process-local cache.
 *
 * A parcel boundary does not change between requests, and the 3D model is
 * fetched once per view — but the report and the viewer can ask for the same
 * lot in quick succession. Bounded so a long-lived server cannot grow without
 * limit; `null` results are cached too, so a lot the service cannot resolve is
 * not retried on every request.
 */
const cache = new Map<string, [number, number][] | null>()
const CACHE_MAX = 500

export interface LotRingResult {
  ring: [number, number][] | null
  /** Why the boundary was rejected, for the model's own provenance note. */
  reason?: string
}

/**
 * The outer ring of one parcel, as [lng, lat] pairs, or null.
 *
 * `recorded` is used only to validate — never to correct. A boundary that
 * disagrees with it is discarded, because the alternative is a 3D envelope
 * built on the wrong parcel.
 */
export async function fetchLotRing(
  lotIdString: string,
  recorded: { area?: number | null; perimeter?: number | null } = {},
): Promise<LotRingResult> {
  const id = String(lotIdString ?? '').trim()
  if (!id) return { ring: null, reason: 'no lot/plan identifier on the property record' }

  if (cache.has(id)) {
    const hit = cache.get(id)!
    return hit ? { ring: hit } : { ring: null, reason: 'boundary previously unavailable for this lot' }
  }

  const url = new URL(SERVICE)
  url.searchParams.set('where', `lotidstring='${id.replace(/'/g, "''")}'`)
  url.searchParams.set('outFields', 'lotidstring')
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('f', 'geojson')

  let ring: [number, number][] | null = null
  let reason: string | undefined
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      reason = `cadastre service returned ${res.status}`
    } else {
      const json: any = await res.json()
      const feats: any[] = json?.features ?? []
      // A lot id can return several features when a parcel is recorded in
      // parts; the largest ring is the parcel, the rest are slivers.
      let best: [number, number][] | null = null
      let bestArea = 0
      for (const f of feats) {
        const g = f?.geometry
        const polys = g?.type === 'Polygon' ? [g.coordinates]
          : g?.type === 'MultiPolygon' ? g.coordinates
            : []
        for (const poly of polys) {
          const r = poly?.[0]
          if (!Array.isArray(r) || r.length < 4) continue
          const a = ringArea(r)
          if (a > bestArea) { bestArea = a; best = r }
        }
      }
      if (!best) reason = 'no boundary published for this lot/plan'
      else ring = best
    }
  } catch (err: any) {
    reason = err?.name === 'TimeoutError'
      ? 'cadastre service timed out'
      : `cadastre service unreachable (${String(err?.message ?? err).slice(0, 60)})`
  }

  // Validate before trusting. A strata plan covers the whole building, so its
  // polygon is the parcel rather than the unit — that is still the right
  // footprint for a planning envelope, and the recorded figures agree.
  if (ring) {
    const area = ringArea(ring)
    const perim = ringPerimeter(ring)
    const ra = Number(recorded.area) || 0
    const rp = Number(recorded.perimeter) || 0
    if (ra > 0 && Math.abs(area - ra) / ra > AREA_TOLERANCE) {
      reason = `boundary area ${area.toFixed(0)} m² disagrees with the recorded ${ra} m²`
      ring = null
    } else if (rp > 0 && Math.abs(perim - rp) / rp > PERIMETER_TOLERANCE) {
      reason = `boundary perimeter ${perim.toFixed(0)} m disagrees with the recorded ${rp} m`
      ring = null
    }
  }

  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(id, ring)
  return ring ? { ring } : { ring: null, reason }
}
