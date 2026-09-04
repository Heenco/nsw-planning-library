/**
 * Where the client should fetch Martin vector tiles from.
 *
 * The tile server is HTTP-only. On an HTTPS page a browser blocks HTTP
 * subresources as mixed content, so the direct URL works in local development
 * (an HTTP page) and silently fails everywhere it is deployed. The failure is
 * invisible from the app's side: mapbox-gl fetches tiles on a worker thread,
 * the request never leaves the browser, and the map just renders without
 * boundaries.
 *
 * So the base is chosen at call time rather than baked in: direct when the page
 * can reach the server, and via /api/tiles when it cannot. The proxy costs a
 * hop, which is why it is not used unconditionally.
 */
export function martinTileBase(martinUrl: string): string {
  const base = String(martinUrl || '').replace(/\/+$/, '')
  if (!base) return '/api/tiles'

  // On the server there is no page origin to compare against, and no mixed
  // content rule to satisfy.
  if (typeof window === 'undefined') return base

  const pageIsSecure = window.location.protocol === 'https:'
  const tilesAreSecure = base.startsWith('https://')
  return pageIsSecure && !tilesAreSecure ? '/api/tiles' : base
}
