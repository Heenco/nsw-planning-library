/**
 * One lot intersected against one NSW layer, returning the attributes that hit.
 *
 *   /api/lot-intersect?lot=A//DP408911&id=principal-planning-epi-heritage     (from /frontage)
 *   /api/lot-intersect?cadid=102169538&id=principal-planning-epi-heritage     (from /epi)
 *
 * The two differ only in how the lot is found. `cadid` reads the parcel straight from our cadastre and
 * shrinks it 10 cm first, matching what /api/epi/at tests locally so the live and local answers on that
 * page cannot disagree over a shared boundary; `lot` keeps the older path exactly as /frontage had it.
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
import { fetchLotRing } from '../utils/cadastre'
import { arcgisQuery } from '../utils/arcgis-retry'
import { nswQuery } from '../utils/nsw-kg/pool'

const TIMEOUT_MS = 18000
const MAX_RECORDS = 50

/**
 * The lot ring from our own cadastre, validated against the property record.
 * fetchLotRing caches per process, so 137 layer calls for one lot cost one
 * tile read. This asked SIX Maps until the app stopped relying on SIX; see
 * server/utils/cadastre-tiles.ts.
 */
async function lotRing(lotId: string): Promise<number[][] | null> {
  return (await fetchLotRing(lotId)).ring
}

const ringCache = new Map<string, { at: number; rings: number[][][] | null }>()
const RING_TTL_MS = 10 * 60 * 1000

/**
 * The same lot /epi tests locally, shrunk the same way, as ArcGIS rings.
 *
 * Two differences from the lot-id path above, both deliberate:
 *
 *   - 10 cm is taken off the inside first. Cadastre and planning layers share their boundaries, so the
 *     raw parcel makes every neighbour that merely touches an edge come back as a hit. /api/epi/at
 *     already shrinks by the same amount, and without this the live panel and the local one would
 *     disagree about the same lot while both were working correctly.
 *   - every ring is sent, not just the outer one, so a lot with a hole or one in several parts is asked
 *     about as it really is. ST_ForcePolygonCW gives the winding ArcGIS reads as exterior-then-hole.
 */
async function lotRingsByCadid(cadid: string): Promise<number[][][] | null> {
  const hit = ringCache.get(cadid)
  if (hit && Date.now() - hit.at < RING_TTL_MS) return hit.rings

  const res = await nswQuery<{ gj: string | null }>(`
    SELECT ST_AsGeoJSON(ST_ForcePolygonCW(ST_Transform(
             CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END, 4326)), 7) AS gj
    FROM (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1) s,
    LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x`, [cadid])

  let rings: number[][][] | null = null
  const gj = res.rows[0]?.gj
  if (gj) {
    const geom = JSON.parse(gj)
    const polys: any[] = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates]
    const flat = polys.flat().filter((r: any) => Array.isArray(r) && r.length >= 4)
    rings = flat.length ? flat : null
  }
  ringCache.set(cadid, { at: Date.now(), rings })
  return rings
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lotId = String(q.lot ?? '').trim().toUpperCase()
  const cadid = String(q.cadid ?? '').trim()
  const id = String(q.id ?? '').trim()

  const svc = findService(id)
  if (!svc) return { ok: false as const, id, reason: 'unknown_layer', message: `No layer "${id}".` }
  if (!lotId && !cadid) return { ok: false as const, id, reason: 'no_lot', message: 'Pass ?lot= or ?cadid=' }

  // cadid is /epi's way in: the shrunk lot, every ring. lot= is /frontage's, unchanged.
  const rings = cadid
    ? await lotRingsByCadid(cadid)
    : await lotRing(lotId).then(r => (r ? [r] : null))
  if (!rings) {
    return { ok: false as const, id, name: svc.name, reason: 'no_lot_geometry',
      message: `Our cadastre holds no boundary for ${cadid ? `cadid ${cadid}` : lotId}.` }
  }

  // POSTed, not in the query string: a cadastral ring can carry hundreds of
  // vertices and would blow a URL length limit.
  const body = new URLSearchParams({
    f: 'geojson',
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
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
