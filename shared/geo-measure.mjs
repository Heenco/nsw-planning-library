/**
 * Geodesic measurement for map tools.
 *
 * Shared because the tile-catalog map and the property report both offer a
 * measuring tool and must agree to the metre — a report that disagrees with
 * the map about a boundary length is worse than one that offers neither.
 *
 * Spherical, not ellipsoidal. Over a suburban parcel the difference from the
 * WGS-84 ellipsoid is well under a centimetre, and these numbers are read
 * against council controls quoted to 0.1 m.
 */

/** Mean Earth radius, metres (IUGG). */
export const EARTH_R = 6371008.8

const rad = (d) => (d * Math.PI) / 180

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversine(a, b) {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

/** Total length in metres along a run of [lng, lat] points. */
export function pathLength(pts) {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += haversine(pts[i - 1], pts[i])
  return total
}

/** Spherical excess area in m² of a closed ring of [lng, lat] points. */
export function ringArea(pts) {
  if (pts.length < 3) return 0
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % pts.length]
    total += (rad(p2[0]) - rad(p1[0])) * (2 + Math.sin(rad(p1[1])) + Math.sin(rad(p2[1])))
  }
  return Math.abs((total * EARTH_R * EARTH_R) / 2)
}

/** Midpoint of two [lng, lat] points, good enough for label placement. */
export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** Initial bearing in degrees (-180..180) from a to b. */
export function bearing(a, b) {
  const lat1 = rad(a[1])
  const lat2 = rad(b[1])
  const dLon = rad(b[0] - a[0])
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180) / Math.PI
}

export function fmtDistance(m) {
  return m < 1000 ? `${m.toFixed(m < 10 ? 2 : 1)} m` : `${(m / 1000).toFixed(2)} km`
}

export function fmtArea(m2) {
  if (m2 < 10000) return `${Math.round(m2).toLocaleString()} m²`
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`
  return `${(m2 / 1e6).toFixed(2)} km²`
}
