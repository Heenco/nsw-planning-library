/**
 * The twelve frontage and dimension columns `up_property_d_4` carries, for one
 * lot.
 *
 *   /api/frontage-metrics?lot=100//DP1139278
 *
 * A deliberately narrow route, separate from /api/frontage-property, which
 * returns all 327 columns grouped for reading. This one exists to be looked at
 * beside the map and photographed: the twelve figures the frontage pipeline
 * writes back, in a fixed order, with the derivation of each recorded next to
 * it so a screenshot carries its own provenance.
 *
 * The `source` and `transform` strings are not decoration. Several of these
 * columns are the same measurement under different names — `lot_depth_m` and
 * `depth` are both `lot_frontage.lot_depth_m`, and `do_depth` is the same
 * measurement with the access handle removed — and a reader comparing two
 * numbers that differ needs to know which is which without leaving the page.
 *
 * DISTINCT ON because d_4 carries duplicate rows: Randwick is loaded twice
 * (152,816 rows for 73,132 distinct keys, the same objectid on both).
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { PROPERTY_TABLE, scrubSentinels } from '../../shared/property-columns'

/**
 * The columns, in the order they should be read, with where each comes from.
 *
 * `kind` decides formatting only. `source` and `transform` are quoted from the
 * pipeline that writes the column, so the panel can show what a figure means
 * rather than just what it is.
 */
export const METRIC_FIELDS: Array<{
  column: string
  label: string
  kind: 'road' | 'metres' | 'count' | 'bool' | 'text' | 'ratio'
  /**
   * What the figure means, for a reader who is not holding the pipeline.
   *
   * Separate from `transform`, which says how the column was computed. A
   * planner reading the report needs to know that `width` is measured at the
   * setback line rather than at the street; how it got there is a different
   * question, and answering both in one string answers neither.
   */
  definition: string
  source: string
  transform: string
}> = [
  {
    column: 'primary_frontage_road', label: 'Primary frontage road', kind: 'road',
    definition: 'The street the lot is taken to face. Setbacks are measured from this boundary.',
    source: 'lot_frontage.primary_frontage_road',
    transform: 'as is, now the full street name',
  },
  {
    column: 'primary_frontage_length_m', label: 'Primary frontage', kind: 'metres',
    definition: 'How much of the boundary meets that street, measured along the boundary.',
    source: 'lot_frontage.primary_frontage_length_m',
    transform: 'coalesce(x, 0), so a lot with no street frontage gets 0',
  },
  {
    column: 'propertyfrontagecount', label: 'Frontage count', kind: 'count',
    definition: 'How many separate streets the lot touches. Two or more usually means a corner.',
    source: 'lot_frontage.frontage_count',
    transform: "cast to the column's existing type, text on both copies today",
  },
  {
    column: 'is_corner_lot', label: 'Corner lot', kind: 'bool',
    definition: 'Touches two streets that meet, so a secondary setback applies to the second.',
    source: 'lot_frontage.is_corner_lot', transform: 'as is',
  },
  {
    column: 'is_battleaxe', label: 'Battle-axe', kind: 'bool',
    definition: 'Reached by a narrow access handle, with the usable land set behind it.',
    source: 'lot_frontage.is_battleaxe', transform: 'as is',
  },
  {
    column: 'lot_depth_m', label: 'Lot depth', kind: 'metres',
    definition: 'Front boundary to rear, including any access handle.',
    source: 'lot_frontage.lot_depth_m',
    transform: 'as is, whole lot including any handle',
  },
  {
    column: 'depth', label: 'Depth', kind: 'metres',
    definition: 'The same measurement as Lot depth; d_4 stores it under both names.',
    source: 'lot_frontage.lot_depth_m', transform: 'same value as lot_depth_m',
  },
  {
    column: 'do_depth', label: 'Core depth', kind: 'metres',
    definition: 'Depth of the usable land only, with the access handle excluded.',
    source: 'lot_frontage.core_depth_m', transform: 'depth excluding the access handle',
  },
  {
    column: 'width', label: 'Width at setback', kind: 'metres',
    definition: 'Measured across the lot at the 4.5 m setback line, not at the street.',
    source: 'lot_frontage.width_at_setback_m', transform: 'width at the 4.5 m setback line',
  },
  {
    column: 'do_width', label: 'Core width (min)', kind: 'metres',
    definition: 'The narrowest the usable land gets, handle excluded. This is what limits a building.',
    source: 'lot_frontage.core_width_min_m',
    transform: 'narrowest width of the core, handle excluded',
  },
  {
    column: 'all_frontages', label: 'All frontages', kind: 'text',
    definition: 'Every street boundary with its length, primary first then longest.',
    source: 'lot_frontage_run joined on lot_id',
    transform: 'ROAD NAME:12.34m,… primary first then longest; unnamed runs as '
      + "Unnamed_<seq>; runs with road_basis = 'motorway_only' excluded",
  },
  {
    column: 'frontage_area_ratio', label: 'Frontage : area', kind: 'ratio',
    definition: 'Frontage divided by the square root of area. Low means deep and narrow.',
    source: 'lot_frontage.primary_frontage_length_m, area_sqm',
    transform: 'round(length / sqrt(area), 4), 0 when area is null or zero',
  },
]

export default defineEventHandler(async (event) => {
  const lotId = String(getQuery(event).lot ?? '').trim().toUpperCase()
  if (!lotId) return { ok: false as const, reason: 'no_input', message: 'Pass ?lot=' }

  const cols = METRIC_FIELDS.map(f => `"${f.column}"`).join(', ')
  const { rows } = await nswQuery(
    `SELECT DISTINCT ON (lot_section_plan) address, area_sqm, ${cols}
       FROM ${PROPERTY_TABLE}
      WHERE upper(lot_section_plan) = $1
      ORDER BY lot_section_plan, address`,
    [lotId],
  )
  // `<Null>` arrives as a string in seven of d_4's columns and would otherwise
  // be printed to the panel verbatim; see scrubSentinels.
  const row = scrubSentinels(rows[0] as Record<string, unknown>)
  if (!row) {
    return {
      ok: false as const, reason: 'not_found', lotId,
      message: `${PROPERTY_TABLE} holds no row for ${lotId}.`,
    }
  }

  setHeader(event, 'cache-control', 'public, max-age=300')
  return {
    ok: true as const,
    lotId,
    address: row.address ?? null,
    areaSqm: row.area_sqm ?? null,
    fields: METRIC_FIELDS.map(f => ({ ...f, value: row[f.column] ?? null })),
  }
})
