import { withNswClient } from '../utils/nsw-kg/pool'

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
      `SELECT
        address, lga_name, suburbname, postcode,
        lzn_sym_code AS zone, lzn_lay_class AS zone_class, lzn_label AS zone_label,
        lep_name, dcp_plan_name,
        fsr_value, hob_max_height_m AS max_height_m, mls_lot_size AS min_lot_size,
        area_sqm, area_h, lotnumber, sectionnumber, planlabel AS plan_label,
        h_name AS heritage_name, h_id AS heritage_id,
        floodmapping, bushfireproneland, biodiversity, ass_lay_class AS acid_sulfate,
        centroid_lat, centroid_lon,
        permissible_uses
      FROM up_property_comprehensive
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
