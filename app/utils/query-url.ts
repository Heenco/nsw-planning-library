/**
 * Put a value in the page's query string without navigating.
 *
 * A page that keeps what you are looking at in its URL - /datasources keeps the
 * traced address, the traced lot and the state - has to rewrite the query as you
 * click. Doing that through the router (`router.replace`) counts as a route
 * change even when the page never changes, and a route change moves the reader
 * to the top of the page. That is the whole reason this exists: history.replaceState
 * changes the address bar and nothing else, so the reader stays exactly where
 * they were.
 *
 * The trade-off: Vue Router's own `route.query` no longer reflects the URL
 * afterwards, so a page using this must not read `route.query` except on first
 * load, and must pass the value around itself.
 *
 * Pass null to remove the parameter.
 */
export function setQueryParam(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (value == null || value === '') url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  if (url.href === window.location.href) return
  window.history.replaceState(window.history.state, '', url)
}
