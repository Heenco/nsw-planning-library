/**
 * Keep the CDN from handing a logged-in visitor's response to a stranger.
 *
 * Several API routes send `Cache-Control: public, max-age=…` because their
 * answers are the same for everyone and slow to compute. Behind the password
 * gate that is a hole: Vercel's edge stores a `public` response the first time
 * an authorised visitor fetches it and then serves the stored copy to anyone
 * who asks for the same URL, password or not, until it expires. Seen on the
 * live site: an unauthorised request for an API URL returned 401, an
 * authorised one 200, and the next unauthorised one 200 with X-Vercel-Cache: HIT.
 *
 * So while the gate is on, every response leaves as `private`: the visitor's
 * own browser may still keep it for as long as the route said, but no shared
 * cache may. Runs after the route has set its header, which a middleware
 * cannot, and matches the gate's own switch so a dev server with the gate off
 * is untouched.
 */

/**
 * The tile proxy stays cacheable. It relays a tile server that is reachable by
 * anyone who knows its address, so a cached tile gives away nothing, and a map
 * view is hundreds of tile requests that the edge answers for free while the
 * function would answer one at a time.
 */
const KEEP_PUBLIC = /^\/api\/tiles\//

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    if (import.meta.dev && !process.env.NUXT_APP_PASSWORD) return
    if (!useRuntimeConfig(event).appPassword) return
    if (KEEP_PUBLIC.test(event.path)) return

    const current = String(getResponseHeader(event, 'cache-control') ?? '')
    if (!current) {
      setResponseHeader(event, 'Cache-Control', 'private, no-store')
      return
    }
    if (/\bno-store\b/i.test(current)) return
    const directives = current
      .split(',')
      .map(d => d.trim())
      .filter(d => d && !/^(public|s-maxage=\d+)$/i.test(d))
    if (!directives.some(d => /^private$/i.test(d))) directives.unshift('private')
    setResponseHeader(event, 'Cache-Control', directives.join(', '))
  })
})
