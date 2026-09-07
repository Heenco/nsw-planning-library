/**
 * One projection over nsw.up_property_d_3, shared by every property route.
 *
 * The routes were written against `up_property_comprehensive`, which has since
 * been dropped — every one of them was querying a table that no longer exists.
 * d_3 replaces it but renames a lot of columns, so this file holds the mapping
 * in one place and keeps the *aliases* the frontend already reads. app/pages
 * needs no changes, and the next rename happens here rather than in four files.
 *
 * Two source typos are preserved deliberately, because that is what the column
 * is actually called: `landslidrisk` and `riparianlandwatercouse`.
 */

export const PROPERTY_TABLE = 'nsw.up_property_d_3'

/**
 * LGAs `up_property_d_3` actually holds, in the order the UI should name them.
 *
 * Stated rather than implied, so a route never promises coverage the table
 * cannot honour. Widen this when a council's property rows land — the search
 * filter and the landing-page copy both read it, so they cannot drift apart.
 */
export const PROPERTY_LGAS = ['HORNSBY', 'RANDWICK'] as const

/**
 * Truthiness for the table's yes/no columns.
 *
 * `is_corner_lot`, `is_battleaxe`, `cdc_eligible` and `in_lmr_housing_area` are
 * real Postgres booleans, so `pg` hands back `true`, not `'true'`. Comparing
 * them to the string was silently false everywhere: corner and battle-axe lots
 * never reached the use analysis, and every property was told "CDC flagged: No"
 * whatever its data said. Accepts the string forms too, because some columns
 * elsewhere in this table are varchar 'Y'/'true'.
 */
export function isYes(v: unknown): boolean {
  return v === true || v === 'true' || v === 't' || v === 'Y' || v === 'y' || v === 1 || v === '1'
}

/**
 * The DCP currently in force for each covered LGA, by instruments.json slug.
 *
 * Only a fallback for linking a clause when a rule row carries no document of
 * its own — the rule layer records which document each rule came from, and
 * that is always the better answer. Kept beside PROPERTY_LGAS so a new
 * council is one edit in one file.
 */
export const DCP_SLUG_BY_LGA: Record<string, string> = {
  HORNSBY: 'hornsby-dcp-2024',
  RANDWICK: 'randwick-dcp-2025',
}

/** Title case for prose: "Hornsby and Randwick". */
export const PROPERTY_LGA_LABEL = PROPERTY_LGAS
  .map((l) => l.charAt(0) + l.slice(1).toLowerCase())
  .reduce((acc, l, i, arr) => (i === 0 ? l : i === arr.length - 1 ? `${acc} and ${l}` : `${acc}, ${l}`), '')

/**
 * The rest of the table.
 *
 * The projection above was written to keep the frontend's existing field names
 * working, so it only ever named the columns the page already read — 117 of
 * 307. An audit against the field lineage in the Notebooks repo
 * (`d3-field-lineage.html`, which traces all 308 documented columns back to the
 * notebook or GIS layer that produced them) found 117 more that carry real data
 * for Hornsby and Randwick and were never fetched at all: every Pattern Book
 * apartment type, the zoning history, the lot shape metrics, the reason CDC was
 * refused, and the map/instrument provenance behind each control.
 *
 * They are selected under their own names — no aliases — so a reader of the
 * report is looking at the column as the table spells it.
 *
 * Deliberately left out:
 *   geom, geom_1, centroid_geom, buffered_geom   WKT blobs, megabytes per lot
 *   width                                        not lot width. 1.38 m on 307
 *                                                Galston Road, whose frontage
 *                                                is 42.88 m, and 0.78 m at 15
 *                                                Mildred Avenue. Whatever it
 *                                                measures, it is not a
 *                                                dimension anyone can use, and
 *                                                wiring it to min_width_m would
 *                                                put a wrong number on the page.
 *   rule_ids                                     an id list, not a fact
 * and the 68 columns that are null on every row of both councils — an airport
 * development area or a Ramsar wetland reference for lots that have neither.
 * Those are for parts of NSW this table does not yet cover; selecting them
 * would add 68 empty rows to every report.
 */
const PROPERTY_EXTRA_SELECT = `
  -- Identity and keys
  , objectid, gurasid, property_id, propid_count, lot_section_plan, postcode_1,
  area, area_type,

  -- Which map and which instrument each control was read from. The standards
  -- above are map values; these say which map, under which plan, as at when.
  epi_name_p, lzn_epi_name_p, lep_lga_name, lep_lay_class, lep_currency_date,
  hob_epi_name, hob_sym_code,
  fsr_sym_code, fsr_label, fsr_sym_code_p, fsr_label_p, fsr_lay_class_p,
  mls_epi_name, lsz_sym_code, lsz_lay_class_p, lsz_lay_size_p,
  dcp_council_name, dcp_lga_name, dcp_plan_type,

  -- Zoning history: what this land was zoned before the current instrument,
  -- which amendment changed it and when that commenced.
  historic_zone, historic_lay_class, historic_amendment,
  historic_commenced_date, historic_published_date,

  -- Lot shape, measured off the cadastre in notebook 04D. Present on 98.4% of
  -- lots. Between them they say whether a parcel is a clean rectangle or an
  -- awkward one, which is the first thing a feasibility asks and the report
  -- could not previously answer.
  corners_count, rectangularity, convexity, elongation, shape_index,
  circular_compactness, square_compactness, equivalent_rectangular_index,
  fractal_dimension, effective_diameter_m, frontage_area_ratio, neck_ratio,
  all_frontage_road_ids,

  -- CDC: the overall reason, and the inland pathways the projection omitted.
  cdc_reasons,
  cdc_inland_dwelling_houses,
  cdc_inland_dwelling_houses_ru1246, cdc_inland_dwelling_houses_ru1246_exclusions,
  cdc_inland_dwelling_houses_ru5_r1_r2_r3_r4, cdc_inland_dwelling_houses_ru5_r1_r2_r3_r4_exclusions,
  cdc_inland_dwelling_houses_r5, cdc_inland_dwelling_houses_r5_exclusions,
  cdc_inland_farm_buildings, cdc_inland_farm_buildings_exclusions,

  -- Pattern Book: the apartment patterns. The report assessed eight patterns
  -- and the table holds fourteen more, each with its own reason — 2,296 lots
  -- are eligible for large_lot_apt_02 at 3-4 storeys and were shown nothing.
  corner_lot_apt_01_4_6storeys_eligible, corner_lot_apt_01_4_6storeys_reasons,
  corner_lot_apt_02_4_6storeys_eligible, corner_lot_apt_02_4_6storeys_reasons,
  large_lot_apt_01_4storeys_eligible, large_lot_apt_01_4storeys_reasons,
  large_lot_apt_01_6storeys_eligible, large_lot_apt_01_6storeys_reasons,
  large_lot_apt_02_3_4storeys_eligible, large_lot_apt_02_3_4storeys_reasons,
  large_lot_apt_02_5_6storeys_eligible, large_lot_apt_02_5_6storeys_reasons,
  large_lot_apt_03_4_6storeys_eligible, large_lot_apt_03_4_6storeys_reasons,
  small_lot_apt_01_3storeys_eligible, small_lot_apt_01_3storeys_reasons,
  small_lot_apt_01_3storeys_min_eligible, small_lot_apt_01_3storeys_min_reasons,
  small_lot_apt_01_4storeys_eligible, small_lot_apt_01_4storeys_reasons,
  small_lot_apt_02_3storeys_eligible, small_lot_apt_02_3storeys_reasons,
  small_lot_apt_02_4storeys_eligible, small_lot_apt_02_4storeys_reasons,
  small_lot_apt_03_4_6storeys_eligible, small_lot_apt_03_4_6storeys_reasons,
  small_lot_apt_04_4_5storeys_eligible, small_lot_apt_04_4_5storeys_reasons,

  -- LMR and TOD detail behind the flag the report already showed.
  in_tod_area, lmr_sym_code, lmr_fsr, lmr_lotsize, lmr_lot_width,
  lmr_train_stations, buffer,

  -- Overlays the constraint list never asked about.
  localprov_lay_class, localprov_lay_name,
  landres_lay_class, landres_lra_type,
  fbl_epi_name, fbl_lay_class, fbl_lga_name,
  biovalue_category, biovalue_boset_class,
  hawkesbury_lay_class, hawkesbury_lay_name,
  crown_reserve_name, bct_controllin, npws_ogc_fid, floodsdf_ogc_fid,
  activestreetfrontage, asf_epi_name, asf_lga_name,
  localcomplying_lay_class, wetland,
  coastalmanagement_env, coastalmanagement_use,
  cenv_map_name, cuse_map_name, cwet_map_name,
  scenic_epi_name, scenic_lga_name
`

/**
 * Aliased to the names the report page already consumes.
 *
 * `min_width_m` and `lmr_height_sth` have no equivalent in d_3. They are
 * selected as NULL rather than mapped onto a near-miss column: an absent
 * measurement should read as absent, not as some other measurement.
 */
export const PROPERTY_SELECT = `
  propid, address, lga_name, council_name, suburbname, postcode, lotnumber, sectionnumber,
  planlabel AS plan_label, property_description, land_value_1,

  -- Zoning and instrument
  lzn_sym_code_p AS zone, lzn_lay_class AS zone_class, lzn_label AS zone_label,
  epi_name AS lep_name, dcp_plan_name,

  -- Development standards
  fsr_fsr AS fsr_value, fsr_lay_class, fsr_epi_name,
  hob_max_b_h AS max_height, hob_max_b_h_m AS max_height_m, hob_units AS height_units,
  lot_size AS min_lot_size, lsz_lay_class AS lot_size_class, lot_size_units,

  -- Lot geometry
  area_sqm, area_h, perimeter_m, longest_axis_m,
  NULL::numeric AS min_width_m,
  propertyfrontagecount AS num_frontages, is_corner_lot, is_battleaxe,
  primary_frontage_road, primary_frontage_length_m, all_frontages,
  -- Per-edge lengths of the parcel boundary, e.g. "14.10m,1.19m,12.14m,...".
  -- The report renders these as the lot's dimension chips; without the
  -- column that panel silently renders nothing, because its only guard is
  -- a length check on the parsed list. Present on 72,898 of 73,595 lots,
  -- and the values sum exactly to perimeter_m.
  all_edges_measurements,
  average_slope, orientation_degrees, lot_depth_m,

  -- Environmental constraints
  floodmapping, bushfireproneland, biodiversity,
  ass_lay_class AS acid_sulfate, groundwatervulnerability,
  landslidrisk AS landsliderisk,
  cwet_epi_name AS coastal_wetlands,
  cenv_epi_name AS coastal_environment_area,
  cuse_epi_name AS coastal_use_area,
  riparianlandwatercouse AS riparianlandwatercourse,
  drinking_water_catchment, scenicprotectionland, mine_subsidence_district,
  contaminationactivitytype AS contamination_sitename,

  -- Heritage
  h_name AS heritage_name, h_id AS heritage_id, heritage_class,

  -- CDC eligibility
  cdc_eligible, total_cdc_eligible, cdc_general, cdc_general_exclusions,
  cdc_dwelling_houses, cdc_dwelling_houses_exclusions,
  cdc_dual_occupancy, cdc_dual_occupancy_exclusions,
  cdc_secondary_dwellings, cdc_secondary_dwellings_exclusions,
  cdc_multi_dwelling_terraces, cdc_multi_dwelling_terraces_exclusions,
  cdc_manor_homes, cdc_manor_homes_exclusions,
  cdc_greenfield_housing, cdc_greenfield_housing_exclusions,
  cdc_rural_housing, cdc_rural_housing_exclusions,
  cdc_agritourism, cdc_agritourism_exclusions,
  cdc_farmstay, cdc_farmstay_exclusions,

  -- LMR and Pattern Book
  in_lmr_housing_area, lmr_landuse AS lmr_permissible,
  lmr_hob AS lmr_height_rfb, NULL::text AS lmr_height_sth,
  -- Pattern Book: the flag and the reason it was decided. Without the reasons
  -- an ineligible pattern is just a grey dot, and the reason is the useful part.
  semis_01_anthony_gill_eligible, semis_01_anthony_gill_reasons,
  semis_02_sibling_eligible, semis_02_sibling_reasons,
  manor_homes_01_studio_eligible, manor_homes_01_studio_reasons,
  row_homes_01_saha_eligible, row_homes_01_saha_reasons,
  terraces_01_carter_eligible, terraces_01_carter_reasons,
  terraces_02_sam_crawford_eligible, terraces_02_sam_crawford_reasons,
  terraces_03_officer_woods_eligible, terraces_03_officer_woods_reasons,
  terraces_04_other_eligible, terraces_04_other_reasons,

  -- Multi-value control columns: a comma means the lot is split across two
  -- zones, FSRs or minimum lot sizes. The single-value columns above hide it.
  lzn_sym_code_p, fsr_fsr_p, lsz_sym_code_p, lzn_lay_class_p,

  -- Proximity and market
  closest_hospital, closest_hospital_distance AS closest_hospital_distance_m,
  closest_school, closest_school_distance AS closest_school_distance_m,
  closest_railway_station, closest_railway_station_distance AS closest_railway_station_distance_m,
  walkable_score, estimated_price, no_of_beds, no_of_baths, no_of_cars,

  -- Location
  centroid_lat, centroid_lon, region_name, permissible_uses, sepp_landuses, sepps
  ${PROPERTY_EXTRA_SELECT}
`

/**
 * Permitted uses now come from the lot's own `permissible_uses`.
 *
 * `up_permissiblelanduse` — a zone x instrument lookup — was dropped with
 * up_property_comprehensive and has no replacement in this database. d_3 stores
 * the resolved list per lot as one delimited string, which is a narrower fact:
 * it is what applies *here*, not everything permissible in the zone.
 */
export function parsePermissibleUses(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  return [...new Set(
    value.split(/[;,]/).map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null'),
  )].sort((a, b) => a.localeCompare(b))
}
