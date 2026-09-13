/**
 * Address -> lot/DP, for the frontage page's search box.
 *
 *   /api/frontage-lot-search?q=84a princes
 *
 * The frontage tool is keyed on `lotidstring` ("A//DP408911"), which nobody
 * knows off the top of their head. up_property_d_4 already carries
 * `lot_section_plan` in exactly that form beside the street address, so this is
 * a straight lookup rather than a geocode.
 *
 * COVERAGE
 *
 * d_4 is statewide — 5,485,081 rows across 132 councils — so search reaches
 * wherever the frontage calculation does. It did not always: this read
 * `up_property_d_3` (Hornsby and Randwick, 149,532 properties) while the
 * calculation already worked on any lot in NSW, so an address elsewhere looked
 * like it did not exist. The route still reports `coverage` so the page can say
 * what it searched. Typing the lot/DP directly always works.
 *
 * Kept separate from /api/address-autocomplete, which several pages depend on
 * and does not select `lot_section_plan`. Widening that query for one caller
 * would change every other page's payload.
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { MIN_TRIGRAM } from '../../shared/property-columns'

const LIMIT = 8

export default defineEventHandler(async (event) => {
  const raw = String(getQuery(event).q ?? '').trim()
  // Not PROPERTY_LGAS: that names the councils the RULE layer covers, which is
  // what the property report is scoped to. This route reads d_4 and its reach
  // is the whole state.
  const coverage = 'all 132 NSW councils'
  if (raw.length < 3) return { results: [], coverage }

  const norm = raw.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  // Words carry the street; a leading number is matched separately so "84a
  // princes" ranks 84A ahead of 184.
  // Only tokens the trigram index can serve become filters; see MIN_TRIGRAM.
  const words = norm.split(' ').filter((t) => t.length >= MIN_TRIGRAM && !/^\d/.test(t))
  const num = (norm.match(/\d+\s*\/\s*(\d+)/) || norm.match(/(\d+)/) || [])[1] ?? null

  const where = ['lot_section_plan IS NOT NULL', "lot_section_plan <> ''"]
  const params: unknown[] = []
  for (const w of words) {
    params.push(`%${w}%`)
    where.push(`address ILIKE $${params.length}`)
  }
  // The street number is required here, unlike the two autocomplete routes,
  // because a lot search for "84a princes" wants 84 PRINCES and not every
  // Princes Street in the state. But it must not reach the trigram index: a
  // number shorter than three characters yields no trigram, and pg_trgm then
  // scans the whole index and drags the real token down with it (measured:
  // '%GEORGE%' 1.6 s, '%GEORGE%' AND '%ST%' 8.1 s). `position()` is not an
  // indexable operator, so the planner applies it as a recheck on the rows the
  // words already found. When there are no words, the number carries the search
  // alone and has to be long enough to index.
  if (!words.length && !(num && num.length >= MIN_TRIGRAM)) return { results: [], coverage }
  if (num) {
    params.push(num)
    where.push(words.length ? `position($${params.length} in address) > 0` : `address ILIKE '%' || $${params.length} || '%'`)
  }

  params.push(LIMIT)

  const { rows } = await nswQuery(
    // COLLATE "C": halves the sort on a common street name; see property/search.get.ts.
    `SELECT DISTINCT ON (address COLLATE "C")
       address, lga_name, lot_section_plan, lotnumber, planlabel,
       centroid_lat, centroid_lon
     FROM nsw.up_property_d_4
     WHERE ${where.join(' AND ')}
     ORDER BY address COLLATE "C"
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
