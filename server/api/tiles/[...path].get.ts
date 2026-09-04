/**
 * Same-origin proxy for the Martin vector tile server.
 *
 * The tile server speaks HTTP only — there is no listener on :443 and none on
 * :3000 with TLS. The deployed site is HTTPS, and a browser blocks HTTP
 * subresources on an HTTPS page as mixed content, so every vector tile request
 * from production was dropped before it left the browser. Nothing appeared in
 * the console the page could act on and no request reached the server: the map
 * simply drew the basemap and no boundaries. Locally the page is HTTP, so
 * nothing was blocked and the same code worked.
 *
 * Proxying through the app puts the tiles on the site's own origin and
 * inherits its certificate. It also removes the CORS dependency, since the
 * request is no longer cross-origin.
 *
 * Used only where it is needed — see martinTileBase() in shared/martin.ts. In
 * development the client still talks to Martin directly, so this route adds no
 * latency to the common case.
 */

// The three shapes the client asks for: the layer catalog, a layer's TileJSON,
// and a tile. Anything else is refused rather than relayed. Written as a regex
// literal because inside a template literal `\d` collapses to a literal 'd',
// which silently turned every tile path into a 400.
const ALLOWED_PATH =
  /^(catalog|[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\/\d{1,2}\/\d{1,10}\/\d{1,10})$/

export default defineEventHandler(async (event) => {
  const parts = (getRouterParam(event, 'path') || '').split('/').filter(Boolean)
  const path = parts.join('/')

  // Only `<layer>/<z>/<x>/<y>` is forwarded. Without this the route would relay
  // anything on the tile server's host, including its catalog and any other
  // service bound to that address.
  if (!ALLOWED_PATH.test(path)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Expected catalog, <layer>, or <layer>/<z>/<x>/<y>',
    })
  }

  const base = String(useRuntimeConfig().public.martinUrl || '').replace(/\/+$/, '')
  if (!base) throw createError({ statusCode: 503, statusMessage: 'Tile server not configured' })

  let upstream: Response
  try {
    upstream = await fetch(`${base}/${path}`)
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `Tile server unreachable: ${(err as Error).message}`,
    })
  }

  // Martin answers 204 for a tile with no features in it. That is a normal
  // result, not an error, and mapbox-gl expects the empty response.
  if (upstream.status === 204) {
    setResponseStatus(event, 204)
    return null
  }
  if (!upstream.ok) {
    throw createError({ statusCode: upstream.status, statusMessage: 'Tile server error' })
  }

  // fetch() has already decompressed the gzip Martin sends, so the encoding
  // header must not be forwarded — passing it on would tell the browser to
  // inflate bytes that are already plain.
  const isJson = (upstream.headers.get('content-type') || '').includes('json')
  setHeader(event, 'content-type', isJson ? 'application/json' : 'application/x-protobuf')
  setHeader(event, 'cache-control', 'public, max-age=3600')

  if (!isJson) return Buffer.from(await upstream.arrayBuffer())

  // A TileJSON advertises its own tile URLs, on the tile server's host and
  // without the port it is served on. Both are wrong for a client reaching it
  // through here, and the callers build their own tile template anyway, so the
  // field is dropped rather than relayed misleadingly.
  //
  // Only when it is an array. Martin's catalog is itself shaped
  // `{ tiles: { <layer>: {...} } }`, so deleting the key unconditionally
  // returned an empty catalog and the map page lost all 441 layers.
  const body: any = await upstream.json()
  if (body && typeof body === 'object' && Array.isArray(body.tiles)) delete body.tiles
  return body
})
