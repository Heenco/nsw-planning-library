/**
 * Coverage of every ingested document, for the /graph monitor page.
 *
 * Cached briefly because each call reads every source file from disk -- around
 * 30MB across 15 documents -- to count what the source declares. That is the
 * whole point of the measure (the database cannot report what is missing from
 * itself), but it is not something to repeat on every render.
 */

import { withNswClient } from '../utils/nsw-kg/pool'
import { getGraphCoverage, type DocCoverage } from '../utils/nsw-kg/coverage'

let cache: { at: number; rows: DocCoverage[] } | null = null
const TTL_MS = 60_000

export default defineEventHandler(async (event) => {
  const fresh = String(getQuery(event).refresh ?? '') === '1'
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
    return { cachedAt: cache.at, documents: cache.rows }
  }

  const rows = await withNswClient(c => getGraphCoverage(c))
  cache = { at: Date.now(), rows }
  return { cachedAt: cache.at, documents: rows }
})
