/**
 * Name the request behind every server error.
 *
 * Nitro reports an h3 error by showing where the error object was built —
 * `createError` in h3's own dist — which is identical for a 400 guard, a 404
 * and a genuine crash. The message and the route that produced it are the two
 * things you actually need, and neither is in that frame, so a caller reading
 * the overlay cannot tell a missing request field from a broken endpoint.
 *
 * One line per error, on the server, with method, path, status and message.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error: any, ctx: any) => {
    const req = ctx?.event?.node?.req
    const method = req?.method ?? '?'
    const path = ctx?.event?.path ?? req?.url ?? '?'
    const status = error?.statusCode ?? 500
    const message = error?.statusMessage || error?.message || String(error)

    // 4xx is the caller's request, 5xx is ours: keep them visually distinct so
    // a wall of 400s does not read as the server falling over.
    const tag = status >= 500 ? '[server error]' : '[bad request]'
    console.error(`${tag} ${method} ${path} -> ${status} ${message}`)

    // The stack matters only when we broke, not when a guard did its job.
    if (status >= 500 && error?.stack) console.error(error.stack)
  })
})
