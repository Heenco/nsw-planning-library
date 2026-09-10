/**
 * Address -> lot/DP, for the frontage page's search box.
 *
 *   /api/frontage-lot-search?q=84a princes
 *
 * The frontage tool is keyed on `lotidstring` ("A//DP408911"), which nobody
 * knows off the top of their head. up_property_d_3 already carries
 * `lot_section_plan` in exactly that form beside the street address, so this is
 * a straight lookup rather than a geocode.
 *
 * COVERAGE IS NARROWER THAN THE TOOL
 *
 * The table holds Randwick and Hornsby only — 149,532 properties — while the
 * frontage calculation works on any lot in NSW, because it reads the statewide
 * SIX Maps cadastre. So this route reports `coverage` and the page says which
 * councils it can search, rather than letting an address elsewhere in NSW look
 * like it does not exist. Typing the lot/DP directly always works.
 *
 * Kept separate from /api/address-autocomplete, which several pages depend on
 * and does not select `lot_section_plan`. Widening that query for one caller
 * would change every other page's payload.
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { PROPERTY_LGAS } from '../../shared/property-columns'

const LIMIT = 8

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).q ?? '').trim()
  const coverage = [...PROPERTY_LGAS].join(', ')
  if (raw.length < 3) return { results: [], coverage }

  const norm = raw.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  // Words carry the street; a leading number is matched separately so "84a
  // princes" ranks 84A ahead of 184.
  const words = norm.split(' ').filter((t) => t.length >= 2 && !/^\d/.test(t))
  const num = (norm.match(/\d+\s*\/\s*(\d+)/) || norm.match(/(\d+)/) || [])[1] ?? null

  const where = ['lot_section_plan IS NOT NULL', "lot_section_plan <> ''"]
  const params: unknown[] = []
  for (const w of words) {
    params.push(`%${w}%`)
    where.push(`address ILIKE $${params.length}`)
  }
  if (num) {
    params.push(`%${num}%`)
    where.push(`address ILIKE $${params.length}`)
  }
  if (!words.length && !num) return { results: [], coverage }

  params.push(LIMIT)

  const { rows } = await nswQuery(
    `SELECT DISTINCT ON (address)
       address, lga_name, lot_section_plan, lotnumber, planlabel,
       centroid_lat, centroid_lon
     FROM nsw.up_property_d_3
     WHERE ${where.join(' AND ')}
     ORDER BY address
     LIMIT $${params.length}`,
    params,
  )

  return {
    coverage,
    results: rows.map((r: any) => ({
      address: r.address,
      lga: r.lga_name,
      lotId: String(r.lot_section_plan).toUpperCase(),
      lat: r.centroid_lat,
      lon: r.centroid_lon,
    })),
  }
})
