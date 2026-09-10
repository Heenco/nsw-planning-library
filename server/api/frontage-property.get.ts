/**
 * Everything `up_property_d_4` holds for one lot.
 *
 *   /api/frontage-property?lot=A//DP408911
 *
 * The frontage page answers "what is this lot's shape". This answers the
 * neighbouring question - "what else do we know about it" - by returning all 307
 * columns, grouped, so the panel can be read rather than scrolled.
 *
 * `includeEmpty: true`, unlike the property report. The report asks "what
 * applies here" and hiding nulls is the point; this panel asks "what do we
 * hold", and a column that is empty for this lot is still an answer. Most of the
 * 307 are empty for any given lot, so hiding them would make the panel look far
 * thinner than the table is.
 *
 * COVERAGE
 *
 * `up_property_d_4` is statewide - 5,485,081 rows over 3,317,214 distinct lots
 * across all 132 NSW councils - so a lot clicked anywhere on the map now has
 * attributes, where `up_property_d_3` held Hornsby and Randwick only and
 * everything else came back empty.
 *
 * A miss is still a result rather than a fault, and is still reported as
 * `found: false`: the table is a snapshot, and a parcel created since it was
 * cut has a shape from the live cadastre and no row here.
 *
 * DISTINCT ON, because d_4 carries duplicate rows - Randwick is loaded twice
 * (152,816 rows for 73,132 distinct keys, the same objectid and propid on
 * both) - so an unguarded select returns one lot's attributes several times.
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { categorise } from '../../shared/property-fields'

export default defineEventHandler(async (event) => {
  const lotId = String(getQuery(event).lot ?? '').trim().toUpperCase()
  // Not PROPERTY_LGAS: that names the two councils the RULE layer covers, which
  // is what the property report is scoped to. This route reads d_4, and its
  // coverage is the whole state — saying "Hornsby, Randwick" here told a reader
  // outside those councils that a miss was expected when it is not.
  const coverage = 'all 132 NSW councils'

  if (!lotId) {
    return { ok: false as const, reason: 'no_input', coverage, message: 'Pass ?lot=' }
  }

  let rows: any[] = []
  try {
    // A lot can carry several rows - strata units share one lot_section_plan -
    // so one is chosen deterministically rather than arbitrarily.
    const res = await nswQuery(
      `SELECT DISTINCT ON (address) * FROM nsw.up_property_d_4
        WHERE upper(lot_section_plan) = $1
        ORDER BY address
        LIMIT 1`,
      [lotId],
    )
    rows = res.rows
  } catch (err: any) {
    return {
      ok: false as const, reason: 'unavailable', coverage,
      message: `The property table did not respond (${String(err?.message ?? err).slice(0, 90)}).`,
    }
  }

  if (!rows.length) {
    return {
      ok: false as const, reason: 'not_covered', coverage, lotId,
      message: `No row in up_property_d_4 for ${lotId}. The table is statewide, so `
        + `this is a parcel it does not hold - most often one created since the `
        + `snapshot was cut. Frontage still works: the shape comes from the live cadastre.`,
    }
  }

  const row = rows[0]
  const categories = categorise(row, { includeEmpty: true })

  return {
    ok: true as const,
    lotId,
    coverage,
    address: row.address ?? null,
    lga_name: row.lga_name ?? null,
    column_count: Object.keys(row).length,
    // How many actually carry a value for this lot - the honest headline, since
    // most of the table is empty for any one parcel.
    populated_count: Object.values(row).filter(
      (v) => v !== null && v !== undefined && v !== '' && v !== 'null').length,
    categories,
  }
})
