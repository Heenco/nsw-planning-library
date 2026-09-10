/**
 * Asking SIX Maps for a lot and the parcels around it.
 *
 * URL building and response parsing only — no fetch, no cache. The two callers
 * want different caches and cannot share one: scripts/frontage-check.mjs caches
 * to disk so a fixture run works with no network, while the server route caches
 * in memory because a serverless filesystem is read-only. Keeping the query
 * shape here means they cannot drift into asking the service different
 * questions and quietly disagreeing about the same lot.
 *
 * The service is the one server/utils/cadastre.ts already validated: measured
 * against two lots, area and perimeter agree with the recorded figures to within
 * 0.1%, and Lot A DP408911's four edges come back matching
 * `all_edges_measurements` from lot_metrics_gnaf exactly.
 */

export const CADASTRE_SERVICE =
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query'

/**
 * How far around the lot to gather neighbours, in metres.
 *
 * The one way the topological method fails is an incomplete neighbour set: a
 * parcel left out makes its shared boundary look open, and the lot gains
 * frontage it does not have. 300 m clears a typical urban block. Large rural
 * parcels need more, so callers surface both the pad and the resulting count
 * rather than trusting a default silently.
 */
export const DEFAULT_PAD_M = 300

/** Only these fields are requested — asking for more returns HTTP 400. */
const OUT_FIELDS = 'lotidstring'

export function lotQueryUrl(lotId) {
  const url = new URL(CADASTRE_SERVICE)
  url.searchParams.set('where', `lotidstring='${String(lotId).replace(/'/g, "''")}'`)
  url.searchParams.set('outFields', OUT_FIELDS)
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('f', 'geojson')
  return url
}

/** Envelope around `ring`, padded by `padM` metres on every side. */
export function paddedEnvelope(ring, padM = DEFAULT_PAD_M) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity
  for (const [x, y] of ring) {
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  const dLat = padM / 111320
  const dLon = padM / (111320 * Math.cos((((ymin + ymax) / 2) * Math.PI) / 180))
  return {
    xmin: xmin - dLon, ymin: ymin - dLat, xmax: xmax + dLon, ymax: ymax + dLat,
    spatialReference: { wkid: 4326 },
  }
}

export function neighbourQueryUrl(ring, padM = DEFAULT_PAD_M) {
  const url = new URL(CADASTRE_SERVICE)
  url.searchParams.set('geometry', JSON.stringify(paddedEnvelope(ring, padM)))
  url.searchParams.set('geometryType', 'esriGeometryEnvelope')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('outFields', OUT_FIELDS)
  url.searchParams.set('returnGeometry', 'true')
  url.searchParams.set('f', 'geojson')
  return url
}

/**
 * The parcel containing one point.
 *
 * This is what makes address search work outside the two councils in
 * up_property_d_3: a geocoder gives a coordinate, and the cadastre turns that
 * coordinate into a lot id anywhere in NSW. Geometry is not requested — the
 * caller only needs the id, and then fetches the lot properly by that id.
 */
export function lotAtPointUrl(lon, lat) {
  const url = new URL(CADASTRE_SERVICE)
  url.searchParams.set('geometry', JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }))
  url.searchParams.set('geometryType', 'esriGeometryPoint')
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
  url.searchParams.set('inSR', '4326')
  url.searchParams.set('outSR', '4326')
  url.searchParams.set('outFields', OUT_FIELDS)
  url.searchParams.set('returnGeometry', 'false')
  url.searchParams.set('f', 'geojson')
  return url
}

/** Outer rings of one GeoJSON feature — a parcel can be recorded in parts. */
export function ringsOf(feature) {
  const g = feature?.geometry
  const polys = g?.type === 'Polygon' ? [g.coordinates]
    : g?.type === 'MultiPolygon' ? g.coordinates
      : []
  return polys.map((p) => p?.[0]).filter((r) => Array.isArray(r) && r.length >= 4)
}

/** Every parcel in a neighbour response except the subject lot itself. */
export function neighboursFrom(json, lotId) {
  const out = []
  for (const f of json?.features ?? []) {
    const id = f?.properties?.lotidstring
    if (id === lotId) continue
    for (const ring of ringsOf(f)) out.push({ id: id ?? '(unnamed parcel)', ring })
  }
  return out
}

/** Raise the service's own error shape rather than returning an empty result. */
export function assertOk(json) {
  if (json?.error) throw new Error(`cadastre service: ${json.error.message ?? 'query failed'}`)
  return json
}
