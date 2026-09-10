/**
 * Address autocomplete over the property table.
 *
 * This used to filter to the two councils the table held, so the page never
 * offered an address it could not report on. The table is now the whole state,
 * and the filter had become the thing standing between a user and a report:
 * typing a Blacktown address returned nothing, while the report itself answers
 * for it perfectly well.
 *
 * So the filter is gone, and what varies by council is depth rather than
 * availability. `lgaHasRules` marks the councils whose instruments are
 * decomposed, and the page can say which suggestions carry clause-level
 * analysis without withholding the rest.
 */

import { nswQuery } from '../../utils/nsw-kg/pool'
import { PROPERTY_LGAS, PROPERTY_TABLE } from '../../../shared/property-columns'

const RULE_LGAS = new Set<string>(PROPERTY_LGAS)

/** "1/500" → 500: the street number, not the unit. */
function streetNumber(s: string): string | null {
  return (s.match(/\d+\s*\/\s*(\d+)/) || s.match(/(\d+)/) || [])[1] ?? null
}

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).q ?? '').trim()
  if (raw.length < 3) return { results: [] }

  const norm = raw.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  const words = norm.split(' ').filter(t => t.length >= 2 && !/^\d/.test(t))
  const num = streetNumber(norm)

  const where: string[] = ['centroid_lat IS NOT NULL']
  // Placeholders are numbered from params.length, so the array must start
  // empty now that the LGA filter is gone -- a dead first element would shift
  // every $n by one.
  const params: unknown[] = []

  for (const w of words) {
    params.push(`%${w}%`)
    where.push(`address ILIKE $${params.length}`)
  }
  if (!words.length && num) {
    params.push(`%${num}%`)
    where.push(`address ILIKE $${params.length}`)
  }

  // Rank an exact street-number match first, then by how far off the number is,
  // so "15 smith" puts 15 above 150.
  let rank = '0 AS _exact, 0 AS _dist'
  if (num) {
    params.push(num)
    const i = params.length
    rank = `
      (CASE WHEN address ~ ('^[0-9]+[A-Za-z]?\\s*/\\s*' || $${i} || '[A-Za-z]?\\s')
              OR address ~ ('^' || $${i} || '[A-Za-z]?\\s') THEN 0 ELSE 1 END) AS _exact,
      ABS(COALESCE(
        NULLIF(substring(address from '^[0-9]+[A-Za-z]?\\s*/\\s*([0-9]+)'), '')::int,
        NULLIF(substring(address from '^([0-9]+)'), '')::int, 999999) - $${i}::int) AS _dist`
  }

  const res = await nswQuery(
    `WITH m AS (
       SELECT DISTINCT ON (address)
         address, lot_section_plan, suburbname, postcode, lga_name,
         lzn_sym_code_p AS zone, area_sqm, centroid_lat, centroid_lon, ${rank}
       FROM ${PROPERTY_TABLE}
       WHERE ${where.join(' AND ')}
       ORDER BY address
     )
     SELECT * FROM m ORDER BY _exact, _dist, address LIMIT 10`,
    params,
  )

  return {
    results: res.rows.map(r => ({
      ...r,
      // Whether a report on this address gets the clause-level sections or
      // only the record and its mapped standards. The page shows the
      // difference; it no longer hides the address.
      hasRuleLayer: RULE_LGAS.has(String(r.lga_name ?? '').toUpperCase()),
    })),
  }
})
