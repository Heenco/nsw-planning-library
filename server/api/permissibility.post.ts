/**
 * Permitted land uses for a zone.
 *
 * `up_permissiblelanduse` — the zone x instrument lookup this route was built
 * on — was dropped with up_property_comprehensive and has no replacement in
 * this database. nsw.up_property_d_3 instead stores each lot's own resolved
 * list, so the zone's set is the union of the lists on lots in that zone.
 *
 * That is a weaker source than the original lookup and the response says so:
 * `derived: true` and the lot count behind the answer. A use missing from a
 * zone here may simply not occur on any sampled lot, which is a coverage gap
 * rather than a finding of prohibition.
 */

import { withNswClient } from '../utils/nsw-kg/pool'
import { PROPERTY_TABLE, parsePermissibleUses } from '../../shared/property-columns'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const epititle = body?.epititle?.trim()
  const zone = body?.zone?.trim()?.toUpperCase()
  const landUse = body?.landUse?.trim()

  if (!epititle || !zone) {
    throw createError({ statusCode: 400, message: 'Missing epititle or zone' })
  }

  return await withNswClient(async (client) => {
    const res = await client.query(
      `SELECT permissible_uses, count(*)::int AS lots
       FROM ${PROPERTY_TABLE}
       WHERE lzn_sym_code_p = $2
         AND ($1 = '' OR epi_name ILIKE $1)
         AND permissible_uses IS NOT NULL
       GROUP BY permissible_uses
       ORDER BY lots DESC
       LIMIT 200`,
      [epititle, zone],
    )

    const allUses = [...new Set(res.rows.flatMap(r => parsePermissibleUses(r.permissible_uses)))]
      .sort((a, b) => a.localeCompare(b))
    const lots = res.rows.reduce((n, r) => n + Number(r.lots), 0)
    const base = { derived: true, source: 'nsw.up_property_d_3.permissible_uses', lots, allUses }

    if (!allUses.length) return { ...base, status: 'no_data', matchedEntries: [] }
    if (!landUse) return { ...base, status: 'enumerated', matchedEntries: [] }

    // Fuzzy match the requested use against the zone's set.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const needle = norm(landUse)
    const matched = allUses.filter((u) => {
      const hay = norm(u)
      return hay.includes(needle) || needle.includes(hay) || hay.split(' ')[0] === needle.split(' ')[0]
    })

    return matched.length
      ? { ...base, status: 'permitted', matchedEntries: matched }
      : { ...base, status: 'not_found', matchedEntries: [] }
  })
})
