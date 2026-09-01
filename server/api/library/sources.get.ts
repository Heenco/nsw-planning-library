/**
 * GET /api/library/sources
 *
 * Lists the document source registry (nsw.source_registry) for the library
 * upload page. Returns registered rows plus any labels still resolving from
 * the static SOURCES fallback, so the UI can show what has not been seeded.
 */

import { listRegistered, listSources } from '../../utils/nsw-kg/ingest/registry'

export default defineEventHandler(async () => {
  const [registered, allLabels] = await Promise.all([
    listRegistered(),
    listSources(),
  ])

  const registeredLabels = new Set(registered.map((s) => s.label))
  const unseeded = allLabels.filter((l) => !registeredLabels.has(l))

  return {
    registered,
    unseeded,
    counts: {
      registered: registered.length,
      unseeded: unseeded.length,
      total: allLabels.length,
    },
  }
})
