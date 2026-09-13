/**
 * One NSW ArcGIS layer, clipped to a bounding box, as GeoJSON.
 *
 *   /api/map-layer?id=principal-planning-land-zoning-map&bbox=151.23,-33.93,151.25,-33.91
 *
 * The layers come from `01A - Read and write - Geojson.ipynb`, which downloads
 * them in bulk for the warehouse. Every one answers a bbox query directly, so
 * for a map there is nothing to download first - ask for what is on screen.
 *
 * WHY A SERVER PROXY AND NOT A DIRECT FETCH
 *
 * Three reasons, in order of how much they matter:
 *
 * 1. The client never supplies a URL. It sends an `id`, which is looked up in
 *    shared/nsw-map-services.ts. An endpoint that fetched whatever URL it was
 *    handed would fetch anything on the internal network too.
 * 2. These hosts do not send CORS headers, so a browser cannot read them
 *    directly whatever the map does.
 * 3. Responses are cached in memory, and panning back over ground already seen
 *    is the common case.
 */

import { findService } from '#shared/nsw-map-services'
import { findCouncilLayer } from '#shared/council-map-catalogue'

const TIMEOUT_MS = 20000

/**
 * Records returned per request.
 *
 * These are statewide layers; a zoomed-out box over Sydney can intersect tens of
 * thousands of polygons. The cap keeps one careless pan from pulling megabytes,
 * and `truncated` tells the page to say so rather than quietly drawing a partial
 * layer as if it were the whole thing.
 */
const MAX_RECORDS = 400

const cache = new Map<string, any>()
const CACHE_MAX = 120

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const id = String(q.id ?? '').trim()
  const bbox = String(q.bbox ?? '').trim()

  /**
   * Two registries, one id space.
   *
   * nsw-map-services.ts is the hand-curated NSW list; council-map-catalogue.ts
   * is generated from the safebuy.app report configs and covers seven
   * Australian states and four Canadian provinces. Catalogue ids are prefixed
   * `cc-` so the two can never collide, and both are closed lists — which is
   * the point. The client sends an id and gets whatever URL the server has on
   * file for it; it cannot name a host.
   */
  const svc = findService(id) ?? findCouncilLayer(id)
  if (!svc) {
    return { ok: false as const, reason: 'unknown_layer', message: `No layer with id "${id}".` }
  }
  // Read once, so everything below is blind to which registry answered.
  const label = svc.name
  const section = svc.section
  // Some layers are only correct with their filter: the NSW school services
  // return closed campuses without `operationalstatus = 1`.
  const where = 'where' in svc && svc.where ? svc.where : '1=1'

  const parts = bbox.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return { ok: false as const, reason: 'bad_bbox', message: 'bbox must be minx,miny,maxx,maxy' }
  }

  const key = `${id}|${parts.map((n) => n.toFixed(4)).join(',')}`
  if (cache.has(key)) return cache.get(key)

  const url = new URL(`${svc.url}/query`)
  url.searchParams.set('geometry', parts.join(','))
  url.searchParams.set('geometryType', 'esriGeometryEnvelope')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('outFields', '*')
  url.searchParams.set('where', where)
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('resultRecordCount', String(MAX_RECORDS))
  url.searchParams.set('f', 'geojson')

  let json: any
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      return { ok: false as const, reason: 'upstream', id, name: label,
        message: `${label} returned HTTP ${res.status}.` }
    }
    json = await res.json()
  } catch (err: any) {
    // A slow or unreachable NSW service is routine and must not look like a bug
    // in the page. Reported per layer so the others keep working.
    return { ok: false as const, reason: 'unreachable', id, name: label,
      message: err?.name === 'TimeoutError'
        ? `${label} timed out after ${TIMEOUT_MS / 1000}s.`
        : `${label} is unreachable (${String(err?.message ?? err).slice(0, 80)}).` }
  }

  // ArcGIS reports failures inside a 200.
  if (json?.error) {
    return { ok: false as const, reason: 'upstream', id, name: label,
      message: `${label}: ${json.error.message ?? 'query failed'}` }
  }

  const features = Array.isArray(json?.features) ? json.features : []
  const out = {
    ok: true as const,
    id,
    name: label,
    section: section,
    count: features.length,
    truncated: features.length >= MAX_RECORDS,
    geojson: { type: 'FeatureCollection', features },
  }

  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, out)
  return out
})
