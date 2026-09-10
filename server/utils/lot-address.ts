/**
 * The addresses sitting on a lot, from the SIX Maps address point layer.
 *
 * Statewide, and authoritative. The previous source was `up_property_d_3`, which
 * holds Randwick and Hornsby only — so everywhere else the primary frontage fell
 * back to a guess about lot geometry when NSW could simply have been asked.
 * 121//DP836880 is the case: no row in the property table, and SIX returns
 * "7 PAVILION PLACE CARDIFF".
 *
 * That matters more than it sounds. Choosing the primary frontage by address is
 * a fact; choosing it by shortest-or-longest is a heuristic that measurement put
 * at roughly a coin flip. Widening address coverage shrinks how often the
 * heuristic is reached at all, which is worth more than tuning it.
 *
 * All points are returned, not one. A corner lot can carry addresses on both
 * streets, and the useful answer is which street MOST of them name — the modal
 * street — rather than whichever happened to come back first.
 */

const SERVICE = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Query/MapServer/0'
const TIMEOUT_MS = 12000
const MAX_POINTS = 25

const cache = new Map<string, string[]>()
const CACHE_MAX = 300

/**
 * Every address point falling inside `ring`, as plain strings.
 *
 * Returns [] rather than throwing: an address is an input to choosing the
 * primary frontage, never a precondition for having one.
 */
export async function lotAddresses(lotId: string, ring: number[][]): Promise<string[]> {
  if (cache.has(lotId)) return cache.get(lotId)!

  const body = new URLSearchParams({
    f: 'geojson',
    geometry: JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'address',
    returnGeometry: 'false',
    resultRecordCount: String(MAX_POINTS),
  })

  let out: string[] = []
  let answered = false
  try {
    const res = await fetch(`${SERVICE}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) {
      const json: any = await res.json()
      if (!json?.error) {
        answered = true
        out = (json.features ?? [])
          .map((f: any) => String(f?.properties?.address ?? '').trim())
          .filter(Boolean)
      }
    }
  } catch {
    out = []
  }

  // Only cache a real answer. Caching a timeout would make one slow moment
  // permanent for that lot — 121//DP836880 lost "7 PAVILION PLACE CARDIFF" to
  // exactly that.
  if (answered) {
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(lotId, out)
  }
  return out
}
