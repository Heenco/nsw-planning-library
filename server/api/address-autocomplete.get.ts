/**
 * Address type-ahead for the home page, the map and /prop-width.
 *
 * Reads the same table the property report reads its facts from, so what you
 * can search for and what you can get a report on are the same set. That used
 * to be `up_property_d_3` — Hornsby and Randwick, 149,532 properties — while
 * the report had already moved to `up_property_d_4`. An address anywhere else
 * in NSW returned nothing here and a full report one click later.
 *
 * WHY TOKENS SHORTER THAN THREE CHARACTERS ARE NOT FILTERS
 *
 * d_4 is 5.48M rows against d_3's 149,532, and the only thing making
 * `address ILIKE '%x%'` survive that is the GIN trigram index (migration 12).
 * A trigram index cannot serve a pattern with fewer than three characters, so
 * a two-letter token silently falls back to a sequential scan. Measured on
 * this table:
 *
 *   '%GEORGE%' AND '%STREET%'    881 ms   bitmap index scan
 *   '%GEORGE%'                  1,583 ms  bitmap index scan
 *   '%GEORGE%' AND '%ST%'       8,098 ms  index scan, 25,951 rows rechecked
 *   '%ST%'                     88,718 ms  parallel seq scan, 1,040,103 rows
 *
 * On d_3 every one of those was ~120 ms, so nothing here needed a floor
 * before. Now "st", "rd" and "dr" are dropped from the WHERE — they are
 * street-type noise that narrows almost nothing and costs everything. They
 * still reach the ranking, which is where they were doing any good.
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { MIN_TRIGRAM, PROPERTY_TABLE } from '../../shared/property-columns'

// Extract all number-like tokens (e.g. "505-535" → ["505", "535"]).
// For "unit/streetnum" patterns like "1/500", both numbers are captured but the
// last one is treated as the street number (what users search against).
function extractNumbers(s: string): string[] {
  const matches = s.match(/\d+/g)
  return matches ? Array.from(new Set(matches)) : []
}

/** Extract the street number from user input. Handles "1/500", "500", "500-505", etc.
 *  For slash patterns, returns the number AFTER the slash (street number).
 *  Otherwise returns the first number. */
function extractStreetNumber(s: string): string | null {
  const slashMatch = s.match(/\d+\s*\/\s*(\d+)/)
  if (slashMatch) return slashMatch[1]
  const firstMatch = s.match(/\d+/)
  return firstMatch ? firstMatch[0] : null
}

export default defineEventHandler(async (event) => {
  const raw = (getQuery(event).q as string || '').trim()
  if (raw.length < 3) return { results: [] }

  const norm = raw.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

  // Split input into:
  //   - numeric tokens (street numbers): "505", "535"
  //   - word tokens (street/suburb name): "FIFTEENTH", "AVENUE", "AUSTRAL"
  const allTokens = norm.split(' ').filter(t => t.length >= 2)
  const numberTokens = extractNumbers(norm)
  // Only tokens the trigram index can serve become filters; see the note above.
  const wordTokens = allTokens.filter(t => !/^\d/.test(t) && t.length >= MIN_TRIGRAM)

  if (allTokens.length === 0) return { results: [] }

  // Strategy: require all WORD tokens (street/suburb) to match. Numbers are
  // used for ranking but not required — so the user can search "535 Fifteenth
  // Austral" and still see close alternatives if 535 isn't in the DB.
  const whereParts: string[] = ['centroid_lat IS NOT NULL']
  const params: string[] = []

  if (wordTokens.length > 0) {
    wordTokens.forEach((t) => {
      params.push('%' + t + '%')
      whereParts.push(`address ILIKE $${params.length}`)
    })
  } else if (numberTokens.some(n => n.length >= MIN_TRIGRAM)) {
    // No word tokens — require a number to match. Only one the trigram index
    // can serve: "15" alone is two characters, and a full scan.
    params.push('%' + numberTokens.find(n => n.length >= MIN_TRIGRAM) + '%')
    whereParts.push(`address ILIKE $${params.length}`)
  } else {
    // Everything the user typed was too short to index — "st", "ku", "7a".
    // Without this the query is `centroid_lat IS NOT NULL` over 5.48M rows.
    return { results: [] }
  }

  // DB-side ranking. Use the street number from the user input for distance
  // matching. For "unit/streetnum" patterns (e.g. "1/500"), we match against
  // the street number (500), not the unit (1).
  const userStreetNum = extractStreetNumber(norm)

  let rankCols = '0 AS _exact, 0 AS _dist'
  if (userStreetNum) {
    params.push(userStreetNum)
    const streetIdx = params.length

    // _exact = 0 if address starts with either:
    //            - "UNIT/streetnum " (e.g. "1/500 DEAN...") OR
    //            - "streetnum " (e.g. "500 DEAN...")
    // _dist  = |extracted street number - user street number|
    //   where the extracted street number is the part AFTER '/' if present,
    //   else the leading integer
    rankCols = `
      (CASE
         WHEN address ~ ('^[0-9]+[A-Za-z]?\\s*/\\s*' || $${streetIdx} || '[A-Za-z]?\\s') THEN 0
         WHEN address ~ ('^' || $${streetIdx} || '[A-Za-z]?\\s') THEN 0
         ELSE 1
       END) AS _exact,
      ABS(
        COALESCE(
          NULLIF(substring(address from '^[0-9]+[A-Za-z]?\\s*/\\s*([0-9]+)'), '')::int,
          NULLIF(substring(address from '^([0-9]+)'), '')::int,
          999999
        ) - $${streetIdx}::int
      ) AS _dist
    `
  }

  const sql = `
    WITH matches AS (
      -- COLLATE "C": halves the sort on a common street name. The reasoning
      -- and the measurements are in property/search.get.ts.
      SELECT DISTINCT ON (address COLLATE "C")
        address, lga_name, suburbname, postcode,
        centroid_lat, centroid_lon, lzn_sym_code_p AS zone,
        ${rankCols}
      FROM ${PROPERTY_TABLE}
      WHERE ${whereParts.join(' AND ')}
      ORDER BY address COLLATE "C"
    )
    SELECT * FROM matches
    ORDER BY _exact, _dist, address COLLATE "C"
    LIMIT 10
  `

  const res = await nswQuery(sql, params)
  return { results: res.rows }
})
