/**
 * One line per column the "02C - Lot profile with frontage" build writes, for
 * the field notes on /testing-spatial-services.
 *
 * Columns copied from the source tables take their codes from CODE_LISTS in
 * datasources-nsw.ts, so /datasources and this page cannot drift apart. The
 * derived columns are described from the build itself - frontage_planningai/
 * worker.py and frontage_topo.py in the Notebooks repo - not from what the
 * names suggest: neighbour_count, for one, is not the number of lots that touch.
 */
import { CODE_LISTS } from './datasources-nsw'

export interface FieldDoc {
  /** One sentence: what the column holds. */
  meaning: string
  /** Code -> label, for columns that hold a code. */
  codes?: Record<string, string>
}

/** A CODE_LISTS entry as a lookup, keyed by the source column's name. */
function codesOf(field: string): Record<string, string> {
  const list = CODE_LISTS.find(c => c.field === field)
  return list ? Object.fromEntries(list.values.map(v => [v.code, v.label])) : {}
}

const PRIMARY_BASIS = {
  address_match: 'A run is on the address\'s road',
  access_point: 'The address\'s access line crosses this run',
  access_road: 'A run is on the road the access line leads to',
  address: 'The road most of the lot\'s addresses name',
  only_street_frontage: 'The lot\'s only street frontage',
  shortest: 'No road matched the address, so the shortest run',
  shortest_no_address: 'No address, so the shortest run',
  none: 'No street frontage',
}

/** Columns of derived.lot_frontage. */
export const LOT_FIELD_DOCS: Record<string, FieldDoc> = {
  // ── the lot ──
  lot_id: { meaning: 'The lot reference as text, lot/section/plan. A strata site has no lot number: //SP67869.' },
  lotnumber: { meaning: 'The lot number on the plan. Empty for a strata site.' },
  sectionnumber: { meaning: 'The section of the plan, when the plan has sections.' },
  planlabel: { meaning: 'The plan: DP is a deposited plan, SP a strata plan.' },
  plan_number: { meaning: 'The plan\'s number without its DP or SP prefix.' },
  classsubtype: { meaning: 'The kind of lot.', codes: codesOf('classsubtype') },
  hasstratum: { meaning: 'Whether the lot is limited in height or depth. A code, not a true/false.', codes: codesOf('hasstratum') },
  stratumlevel: { meaning: 'For a stratum lot, the level it sits at, from -10 to 10. 0 is the ground.' },
  itstitlestatus: { meaning: 'The state of the lot\'s title.', codes: codesOf('itstitlestatus') },
  urbanity: { meaning: 'Urban, semi-rural or rural, as the cadastre classes the lot.', codes: codesOf('urbanity') },
  lga_name: { meaning: 'The council the lot sits in, from a spatial join. The cadastre\'s own council column is empty.' },
  lot_start_date: { meaning: 'When this version of the lot began.' },
  lot_last_update: { meaning: 'When this version of the lot was last changed.' },
  its_lot_id: { meaning: 'The lot\'s id in the land titles system.' },
  controlling_authority: { meaning: 'The id of the authority that controls the lot, when one does.' },
  status: {
    meaning: 'Whether the build could measure the lot.',
    codes: {
      ok: 'Measured',
      no_unshared_boundary: 'Every edge is shared with another lot, so there is no frontage',
      abuts_motorway_only: 'The only open boundary faces a motorway',
      no_named_frontage: 'Open boundary, but no street frontage to measure from',
      error: 'The measurement failed; see status_reason',
    },
  },
  status_reason: { meaning: 'The error, when status is error. Empty otherwise.' },

  // ── size and shape ──
  area_sqm: { meaning: 'The lot\'s area in square metres, measured on the outline of its largest part. Holes are not taken out.' },
  effective_area_sqm: { meaning: 'The area less the access handle. Empty when the lot has no handle.' },
  plan_lot_area: { meaning: 'The area written on the plan, when it states one. The units are not copied, so check planlotareaunits on cadastre.lot.' },
  supplied_shape_area: { meaning: 'The area the cadastre export ships, in the export\'s own units. Kept to compare with; nothing uses it.' },
  total_boundary_m: { meaning: 'The lot\'s perimeter in metres.' },
  total_open_m: { meaning: 'How much of the perimeter no other lot shares. It faces a road, reserve, water or a gap.' },
  neighbour_count: { meaning: 'How many nearby lots the build checked against, in a block about 1.5 km across. Not the number that touch the lot.' },
  part_count: { meaning: 'How many separate pieces the lot polygon has. Only the largest is measured.' },
  ring_count: { meaning: 'How many outlines the polygon has, holes included.' },
  whole_lot_analysed: { meaning: 'True when the lot is one piece with no holes, so the figures describe all of it.' },

  // ── frontage ──
  frontage_count: { meaning: 'How many street frontages the lot has. Runs on the same named road count once.' },
  total_frontage_m: { meaning: 'Total length of those street frontages, in metres.' },
  primary_frontage_road: { meaning: 'The road the primary frontage faces.' },
  primary_frontage_length_m: { meaning: 'Length of the primary frontage. This is lot width in every eligibility test.' },
  primary_frontage_basis: { meaning: 'Why that frontage was chosen as primary.', codes: PRIMARY_BASIS },
  road_parcel_frontage_m: { meaning: 'Boundary shared with road parcels, measured directly. A second, independent measure of frontage.' },
  road_parcel_count: { meaning: 'How many road parcels the lot touches.' },
  frontage_agreement: {
    meaning: 'Whether the two frontage measures agree.',
    codes: {
      agree: 'Within 10% of each other',
      differ: 'More than 10% apart',
      topological_only: 'Only the boundary method finds frontage',
      road_parcel_only: 'Only the road parcels show frontage',
      both_zero: 'Neither finds frontage',
    },
  },
  abuts_motorway: { meaning: 'Names of frontage runs that face a motorway, freeway, tollway or tunnel.' },
  is_corner_lot: { meaning: 'Two street frontages at least 45° apart.' },
  is_through_lot: { meaning: 'Two street frontages less than 45° apart, such as a front street and a rear lane.' },
  corner_streets: { meaning: 'The two roads that make it a corner lot.' },
  corner_basis: {
    meaning: 'What the corner test compared.',
    codes: {
      roads: 'Two different named roads',
      geometry: 'Run directions, as fewer than two roads are named',
      single_frontage: 'Only one frontage, so nothing to compare',
    },
  },
  waypoint_road: { meaning: 'The road nearest the GURAS access point of the lot\'s main address.' },

  // ── depth and width ──
  lot_depth_m: { meaning: 'From the primary frontage to the furthest point, at right angles to the frontage.' },
  core_depth_m: { meaning: 'Depth without the access handle. The same as lot_depth_m when there is no handle.' },
  lot_width_max_m: { meaning: 'The widest cross-section parallel to the frontage, sampled every 0.25 m.' },
  core_width_min_m: { meaning: 'The narrowest cross-section of the main body, after any handle and before a tapering tip.' },
  core_width_max_m: { meaning: 'The widest cross-section of the main body.' },
  width_at_setback_m: { meaning: 'The width at width_setback_depth_m in from the frontage.' },
  width_setback_depth_m: { meaning: 'How far in width_at_setback_m is taken, in metres. 4.5 in this build.' },

  // ── battle-axe ──
  is_battleaxe: { meaning: 'A stem at the street 10 m wide or less and at least 5 m long, opening into a body at least 8 m and 1.5 times wider.' },
  handle_shape: {
    meaning: 'The lot\'s shape seen from the street.',
    codes: {
      straight: 'Battle-axe with one straight handle',
      irregular: 'Battle-axe with more than one narrow stretch',
      wide_stem: 'A stem, but wider than 10 m, so not a handle',
      short_neck: 'Narrow at the street but under 5 m long',
      uniform_narrow: 'Narrow all the way and never opens out',
      rear_tail: 'A narrow strip at the back',
      waisted: 'Narrow in the middle',
      tapered: 'Closes to a point at the back',
      regular: 'No narrow stretch',
      no_frontage: 'No frontage to measure from',
    },
  },
  stem_width_m: { meaning: 'The narrowest width of the stem at the street.' },
  stem_length_m: { meaning: 'How far the stem runs before the lot opens out.' },
  stem_area_sqm: { meaning: 'The stem\'s area.' },
  handle_neck_min_m: { meaning: 'The narrowest width of the handle. The same figure as stem_width_m.' },
  handle_neck_mean_m: { meaning: 'The handle\'s average width along its length.' },
  handle_length_m: { meaning: 'The handle\'s length. The same figure as stem_length_m.' },
  handle_area_sqm: { meaning: 'The handle\'s area, taken off area_sqm to give effective_area_sqm.' },

  // ── addresses and property ──
  address: { meaning: 'The lot\'s main address: a primary address first, then alphabetical.' },
  address_count: { meaning: 'How many addresses are linked to the lot.' },
  unit_address_count: { meaning: 'How many of those have a unit number.' },
  valnet_property_type: { meaning: 'The Valuer General\'s kind of property.', codes: codesOf('valnetpropertytype') },
  valnet_property_status: { meaning: 'The state of the valuation record.', codes: codesOf('valnetpropertystatus') },
  property_type: { meaning: 'Spatial Services\' own property category. Values 1, 5 and 6 occur, with no published labels.' },
  parcel_count: { meaning: 'How many lots the property polygon was drawn from. Fewer than valnet_lot_count means some are missing from the map.' },
  valnet_lot_count: { meaning: 'How many lots the valuation property covers. For a strata scheme, how many strata lots.' },
  is_superlot: { meaning: 'The property carries more than one address: units, shops or a number range. Not strata, and not several lots.' },

  // ── how it was computed ──
  method_version: { meaning: 'The version of the measuring method that wrote this row.' },
  roadlike_open: { meaning: 'Whether long, thin neighbouring parcels were treated as open boundary. False in this build.' },
  computed_at: { meaning: 'When this row was written.' },
  tile_gx: { meaning: 'Column of the 0.1° tile holding the lot\'s centre. Kept for older tables.' },
  tile_gy: { meaning: 'Row of the 0.1° tile holding the lot\'s centre.' },
  cell_gx: { meaning: 'Column of the 0.005° cell (about 550 m) used to find the lot\'s neighbours.' },
  cell_gy: { meaning: 'Row of the 0.005° cell used to find the lot\'s neighbours.' },
}

/** Columns of derived.lot_frontage_run. */
export const RUN_FIELD_DOCS: Record<string, FieldDoc> = {
  seq: { meaning: 'Order, longest first' },
  road_name: { meaning: 'Road the run faces' },
  road_basis: {
    meaning: 'How the road was named',
    codes: {
      parallel: 'A road running alongside within 80 m',
      cul_de_sac: 'A road ending at the run',
      motorway_only: 'Only a motorway is near',
      none: 'No road near enough',
      no_road_data: 'No roads were loaded',
    },
  },
  length_m: { meaning: 'Length in metres' },
  road_distance_m: { meaning: 'Closest gap to that road' },
  bearing_deg: { meaning: 'Direction, degrees from north' },
  arc_deg: { meaning: 'How far the run curves' },
  is_primary: { meaning: 'The primary frontage' },
}

/** Columns of derived.lot_address. */
export const ADDRESS_FIELD_DOCS: Record<string, FieldDoc> = {
  msoid: { meaning: 'The address\'s id' },
  address: { meaning: 'Written out' },
  unit_number: { meaning: 'Unit number' },
  unit_type: { meaning: 'Kind of unit', codes: codesOf('unittype') },
  title_lot: { meaning: 'The address\'s own title lot' },
  sppropid: { meaning: 'Strata unit\'s property id' },
  propidtype: { meaning: 'How it reaches the lot', codes: codesOf('propidtype') },
  propid: { meaning: 'Valuation property' },
  house_number: { meaning: 'Street number' },
  road_name: { meaning: 'Street' },
  suburb: { meaning: 'Suburb' },
  postcode: { meaning: 'Postcode' },
  is_primary_address: { meaning: 'The property\'s primary address' },
  link_method: {
    meaning: 'How it was linked',
    codes: { property_lot: 'Through its property', lot_only: 'Lot with no property or address' },
  },
  point_type: { meaning: 'What the map point marks', codes: codesOf('addresspointtype') },
  point_containment: { meaning: 'Point inside the property?', codes: codesOf('containment') },
  address_confidence: { meaning: 'GURAS\'s own confidence' },
}

/** The label for a coded value, or null when the column has no codes or the value is not one of them. */
export function codeLabel(doc: FieldDoc | undefined, value: unknown): string | null {
  if (!doc?.codes || value == null || value === '') return null
  return doc.codes[String(value).trim().toUpperCase()] ?? doc.codes[String(value)] ?? null
}
