/**
 * One shared password in front of the whole app.
 *
 * Runs on every request the Nuxt server handles: pages, the API routes, the
 * report's event stream. A visitor without the password sees a small login
 * page instead of whatever they asked for; entering it sets a cookie that lets
 * them straight through for thirty days, on every page and every fetch the
 * pages make.
 *
 * The password is `appPassword` in runtimeConfig: its default is in
 * nuxt.config.ts, and setting NUXT_APP_PASSWORD in the deployment's environment
 * overrides it without a code change. Setting it to an empty string turns the
 * check off. Changing it logs everyone out, because the cookie is derived from
 * it.
 *
 * Off in local development unless NUXT_APP_PASSWORD is set, so `npm run dev`
 * does not ask on every reload but the flow can still be tried locally.
 *
 * The page is the app's own rather than the browser's Basic-auth prompt. That
 * prompt is a policy matter on managed browsers, which can refuse to show it
 * over plain HTTP, and localhost is plain HTTP. A request that carries a Basic
 * `Authorization` header is still accepted, for curl and scripts.
 *
 * What this is not: it is one password for everyone, so removing one person
 * means changing it for all; and on Vercel the built assets under /_nuxt are
 * served by the CDN, not by this function, so they are reachable without it.
 * That is bundled page code, not data. Anything that reads the database or an
 * API key goes through here.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE = 'planning_access'
const LOGIN_PATH = '/__login'
const COOKIE_DAYS = 30

/** The cookie's value: a digest of the password, so a new password voids old cookies. */
function tokenFor(password: string): string {
  return createHmac('sha256', password).update('planning-library-access').digest('hex')
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Only a path on this site can be returned to after login. */
function safeNext(raw: unknown): string {
  const s = String(raw ?? '/')
  return s.startsWith('/') && !s.startsWith('//') ? s : '/'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wantsHtml(accept: string | undefined): boolean {
  return (accept ?? '').includes('text/html')
}

function loginPage(next: string, wrong: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Planning Library</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafb; color: #1e293b;
         font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  form { width: min(360px, calc(100vw - 2rem)); background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.5rem 1.5rem 1.4rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.15rem; font-weight: 800; color: #0f172a; }
  p { margin: 0 0 1rem; font-size: 0.82rem; color: #64748b; }
  label { display: block; margin-bottom: 0.35rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
  input { display: block; width: 100%; box-sizing: border-box; padding: 0.55rem 0.7rem; border: 1px solid #e2e8f0; border-radius: 8px; font: inherit; font-size: 0.9rem; }
  input:focus { outline: none; border-color: #15803d; box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.12); }
  button { margin-top: 0.8rem; width: 100%; padding: 0.6rem; border: none; border-radius: 8px; background: #0f172a; color: #fff; font: inherit; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
  button:hover { background: #1e293b; }
  .wrong { margin: 0.6rem 0 0; font-size: 0.78rem; color: #b91c1c; }
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>Planning Library</h1>
  <p>This site needs a password.</p>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <button type="submit">Continue</button>
  ${wrong ? '<p class="wrong">That password is not right.</p>' : ''}
</form>
</body>
</html>`
}

export default defineEventHandler(async (event) => {
  if (import.meta.dev && !process.env.NUXT_APP_PASSWORD) return

  const expected = String(useRuntimeConfig(event).appPassword ?? '')
  if (!expected) {
    // No password configured on a deployed build. The repository is public,
    // so the password can only come from the environment, and a deployment
    // that forgot it must not quietly become a public site.
    setResponseStatus(event, 503)
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return 'This site has no password configured yet. Set NUXT_APP_PASSWORD in its environment.'
  }
  const token = tokenFor(expected)
  const url = getRequestURL(event)

  // ── The login form coming back ─────────────────────────────────────────
  if (url.pathname === LOGIN_PATH && event.method === 'POST') {
    const body = await readBody<Record<string, string>>(event).catch(() => ({} as Record<string, string>))
    const next = safeNext(body?.next)
    if (sameSecret(String(body?.password ?? ''), expected)) {
      setCookie(event, COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: COOKIE_DAYS * 24 * 60 * 60,
        // Behind Vercel the app sees plain HTTP; the visitor's connection is what counts.
        secure: (getRequestHeader(event, 'x-forwarded-proto') ?? '').split(',')[0]!.trim() === 'https',
      })
      return sendRedirect(event, next, 303)
    }
    setResponseStatus(event, 401)
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return loginPage(next, true)
  }

  // ── Already in ─────────────────────────────────────────────────────────
  const cookie = getCookie(event, COOKIE)
  if (cookie && sameSecret(cookie, token)) return

  // ── curl and scripts ───────────────────────────────────────────────────
  const [scheme, encoded] = (getRequestHeader(event, 'authorization') ?? '').split(' ')
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    if (sameSecret(decoded.slice(decoded.indexOf(':') + 1), expected)) return
  }

  // ── Not in: the page for a person, a plain 401 for a program ───────────
  setResponseStatus(event, 401)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (event.method === 'GET' && wantsHtml(getRequestHeader(event, 'accept'))) {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return loginPage(url.pathname + url.search, false)
  }
  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="NSW Planning Library"')
  return 'This site needs a password.'
})
