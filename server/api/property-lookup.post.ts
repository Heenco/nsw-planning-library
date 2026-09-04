import { withNswClient } from '../utils/nsw-kg/pool'
import { PROPERTY_TABLE, PROPERTY_SELECT } from '../../shared/property-columns'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const lat = body?.lat
  const lng = body?.lng

  if (!lat || !lng) {
    throw createError({ statusCode: 400, message: 'Missing lat/lng' })
  }

  const result = await withNswClient(async (client) => {
    // Nearest-neighbour by Euclidean distance on centroid_lat/lon
    // Columns are stored as text, so cast to float for arithmetic
    const res = await client.query(
      `SELECT ${PROPERTY_SELECT}
      FROM ${PROPERTY_TABLE}
      WHERE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
      ORDER BY (centroid_lat::float8 - $1)^2 + (centroid_lon::float8 - $2)^2
      LIMIT 1`,
      [lat, lng]
    )

    return res.rows.length > 0 ? res.rows[0] : null
  })

  if (!result) {
    return { found: false, property: null }
  }

  return { found: true, property: result }
})
