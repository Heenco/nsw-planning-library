/**
 * Address autocomplete over nsw.up_property_d_3.
 *
 * Replaces the lookup against up_property_comprehensive, which no longer
 * exists in this database — every property route was querying a dropped table.
 * The LGA filter is explicit rather than implied, so the page never offers an
 * address the table cannot report on. The supported list lives in
 * shared/property-columns.ts, which the landing-page copy reads too: widening
 * coverage is one edit, and the promise and the filter cannot drift apart.
 */

import { nswQuery } from '../../utils/nsw-kg/pool'
import { PROPERTY_LGAS } from '../../../shared/property-columns'

const LGAS = [...PROPERTY_LGAS]

/** "1/500" → 500: the street number, not the unit. */
function streetNumber(s: string): string | null {
  return (s.match(/\d+\s*\/\s*(\d+)/) || s.match(/(\d+)/) || [])[1] ?? null
}

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).q ?? '').trim()
  if (raw.length < 3) return { results: [], lga: LGAS.join(', ') }

  const norm = raw.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  const words = norm.split(' ').filter(t => t.length >= 2 && !/^\d/.test(t))
  const num = streetNumber(norm)

  const where: string[] = ['centroid_lat IS NOT NULL', 'lga_name = ANY($1)']
  const params: unknown[] = [LGAS]

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
       FROM nsw.up_property_d_3
       WHERE ${where.join(' AND ')}
       ORDER BY address
     )
     SELECT * FROM m ORDER BY _exact, _dist, address LIMIT 10`,
    params,
  )

  return { lga: LGAS.join(', '), results: res.rows }
})
