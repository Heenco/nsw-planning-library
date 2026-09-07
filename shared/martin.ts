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
 *
 * The proxy URL is absolute, and has to be. mapbox-gl loads tiles on a worker
 * thread, and the bundled worker runs from a blob: URL — which is not a valid
 * base for resolving a relative path, so `new Request('/api/tiles/...')` inside
 * it throws "Failed to parse URL" and every tile fails before it is fetched.
 *
 * That failure could only ever appear in production. The proxy branch is taken
 * when the page is HTTPS and the tile server is not; development runs on
 * http://localhost, takes the direct branch, and never constructs the relative
 * URL at all.
 */
export function martinTileBase(martinUrl: string): string {
  const base = String(martinUrl || '').replace(/\/+$/, '')

  // On the server there is no page origin to build on, no worker to satisfy and
  // no mixed content rule. The relative form is correct here and is replaced on
  // the client, where setup() runs again before the map is created.
  if (typeof window === 'undefined') return base || '/api/tiles'

  const proxy = `${window.location.origin}/api/tiles`
  if (!base) return proxy

  const pageIsSecure = window.location.protocol === 'https:'
  const tilesAreSecure = base.startsWith('https://')
  return pageIsSecure && !tilesAreSecure ? proxy : base
}
