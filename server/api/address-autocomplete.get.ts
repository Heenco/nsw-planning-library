import { nswQuery } from '../utils/nsw-kg/pool'

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
  const wordTokens = allTokens.filter(t => !/^\d/.test(t))

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
  } else if (numberTokens.length > 0) {
    // No word tokens — require at least one number to match
    params.push('%' + numberTokens[0] + '%')
    whereParts.push(`address ILIKE $${params.length}`)
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
      SELECT DISTINCT ON (address)
        address, lga_name, suburbname, postcode,
        centroid_lat, centroid_lon, lzn_sym_code AS zone,
        ${rankCols}
      FROM up_property_comprehensive
      WHERE ${whereParts.join(' AND ')}
      ORDER BY address
    )
    SELECT * FROM matches
    ORDER BY _exact, _dist, address
    LIMIT 10
  `

  const res = await nswQuery(sql, params)
  return { results: res.rows }
})
