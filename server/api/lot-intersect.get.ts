/**
 * One lot intersected against one NSW layer, returning the attributes that hit.
 *
 *   /api/lot-intersect?lot=A//DP408911&id=principal-planning-epi-heritage
 *
 * A true polygon intersect, not a bounding box: `esriSpatialRelIntersects`
 * against the lot's own ring, so a heritage item beside the lot does not come
 * back as though it were on it. That distinction is the whole point of the tool
 * — a bbox answer would be wrong in exactly the cases someone is checking.
 *
 * ONE LAYER PER CALL, DELIBERATELY
 *
 * There are 137 layers. Doing them server-side in one request means a single
 * response that takes as long as the slowest NSW service and shows nothing until
 * it does. Per layer, the page runs a small concurrency pool and fills results in
 * as they land, so a lot with three hits shows the first within a second or two
 * and one dead service costs one row rather than the whole answer.
 *
 * Geometry is not requested. The question is "what applies to this lot", which
 * is answered by attributes; the shapes would be megabytes for nothing.
 */

import { findService } from '#shared/nsw-map-services'
import { lotQueryUrl, assertOk, ringsOf } from '#shared/cadastre-query.mjs'
import { ringArea } from '#shared/geo-measure.mjs'
import { arcgisQuery } from '../utils/arcgis-retry'

const TIMEOUT_MS = 18000
const MAX_RECORDS = 50

/** Lot rings, so 137 layer calls for one lot cost one cadastre fetch. */
const ringCache = new Map<string, number[][] | null>()
const RING_MAX = 200

async function lotRing(lotId: string): Promise<number[][] | null> {
  if (ringCache.has(lotId)) return ringCache.get(lotId)!
  let ring: number[][] | null = null
  try {
    const res = await fetch(lotQueryUrl(lotId), { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const json = assertOk(await res.json())
      const rings: number[][][] = (json.features ?? []).flatMap(ringsOf)
      if (rings.length) ring = rings.sort((a, b) => ringArea(b as any) - ringArea(a as any))[0]
    }
  } catch {
    ring = null
  }
  if (ringCache.size >= RING_MAX) ringCache.clear()
  ringCache.set(lotId, ring)
  return ring
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lotId = String(q.lot ?? '').trim().toUpperCase()
  const id = String(q.id ?? '').trim()

  const svc = findService(id)
  if (!svc) return { ok: false as const, id, reason: 'unknown_layer', message: `No layer "${id}".` }
  if (!lotId) return { ok: false as const, id, reason: 'no_lot', message: 'Pass ?lot=' }

  const ring = await lotRing(lotId)
  if (!ring) {
    return { ok: false as const, id, name: svc.name, reason: 'no_lot_geometry',
      message: `No boundary published for ${lotId}.` }
  }

  // POSTed, not in the query string: a cadastral ring can carry hundreds of
  // vertices and would blow a URL length limit.
  const body = new URLSearchParams({
    f: 'geojson',
    geometry: JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: String(MAX_RECORDS),
  })

  const q2 = await arcgisQuery(svc.url, body, { timeoutMs: TIMEOUT_MS })
  if (!q2.ok) {
    return {
      ok: false as const, id, name: svc.name, section: svc.section,
      reason: q2.reason, message: q2.message, attempts: q2.attempts,
      // False means asking again cannot help — a 403, or a query this layer
      // refuses. The panel says "could not be searched" rather than implying a
      // maybe, which for an intersect is the difference that matters.
      retryable: q2.retryable !== false,
    }
  }
  const json = q2.json


  const feats = Array.isArray(json?.features) ? json.features : []
  return {
    ok: true as const,
    id,
    name: svc.name,
    section: svc.section,
    count: feats.length,
    truncated: feats.length >= MAX_RECORDS,
    // Attributes only, and empties dropped: these layers carry a lot of nulls
    // and a hit is worth reading, not scrolling.
    features: feats.map((f: any) => {
      const p = f?.properties ?? {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(p)) {
        if (v !== null && v !== undefined && v !== '' && v !== 'null') out[k] = v
      }
      return out
    }),
  }
})
