import { nswQuery } from '../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const q = (getQuery(event).q as string || '').trim()
  if (q.length < 3) return { results: [] }

  // Trigram similarity + prefix fallback. Deduplicate on address so we get
  // distinct addresses (not one row per unit variant).
  const res = await nswQuery(
    `SELECT DISTINCT ON (address)
       address, lga_name, suburbname, postcode,
       centroid_lat, centroid_lon, lzn_sym_code AS zone
     FROM up_property_comprehensive
     WHERE address ILIKE $1 || '%'
       AND centroid_lat IS NOT NULL
     ORDER BY address
     LIMIT 10`,
    [q.toUpperCase()]
  )

  if (res.rows.length > 0) return { results: res.rows }

  // Fallback: trigram fuzzy match
  const res2 = await nswQuery(
    `SELECT DISTINCT ON (address)
       address, lga_name, suburbname, postcode,
       centroid_lat, centroid_lon, lzn_sym_code AS zone
     FROM up_property_comprehensive
     WHERE address % $1
       AND centroid_lat IS NOT NULL
     ORDER BY address, similarity(address, $1) DESC
     LIMIT 10`,
    [q.toUpperCase()]
  )

  return { results: res2.rows }
})
