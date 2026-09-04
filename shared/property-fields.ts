/**
 * Categorising nsw.up_property_d_3.
 *
 * The table carries 307 columns for one lot — identity, measured geometry,
 * planning controls, a dozen constraint layers, CDC and pattern-book
 * eligibility, amenity and valuation. Presented flat it is unreadable, and a
 * hand-written list of 307 names would rot the moment the notebooks add a
 * column.
 *
 * So groups are matched by pattern, in order, first match wins. A column the
 * patterns miss lands in "other" rather than disappearing — a new column shows
 * up in the UI as soon as it exists, which is the behaviour we want while the
 * upstream pipeline is still moving.
 */

export interface FieldGroup {
  key: string
  label: string
  /** Short note shown under the group heading. */
  blurb?: string
  /** Columns listed here lead the group, in this order. */
  lead?: string[]
  /** Anything matching joins the group after the leads. */
  match?: RegExp
}

/** Order matters: a column joins the first group that claims it. */
export const FIELD_GROUPS: FieldGroup[] = [
  {
    key: 'identity',
    label: 'Identity',
    lead: ['address', 'lot_section_plan', 'lotnumber', 'sectionnumber', 'planlabel',
      'suburbname', 'postcode', 'lga_name', 'council_name', 'region_name',
      'propid', 'gurasid', 'objectid', 'property_id', 'property_description'],
  },
  {
    key: 'lot',
    label: 'Lot & geometry',
    blurb: 'Measured from the cadastre — the inputs an envelope is built from.',
    lead: ['area_sqm', 'area_h', 'primary_frontage_length_m', 'lot_depth_m', 'width', 'depth',
      'all_frontages', 'primary_frontage_road', 'propertyfrontagecount',
      'is_corner_lot', 'is_battleaxe', 'average_slope', 'orientation_degrees', 'perimeter_m'],
    match: /^(all_edges|all_frontage|corners_count|do_width|do_depth|effective_diameter|longest_axis|elongation|convexity|rectangularity|circular_compactness|square_compactness|equivalent_rectangular|frontage_area_ratio|neck_ratio|shape_index|min_width|centroid_|area$|area_type|kcorr_area)/,
  },
  {
    key: 'controls',
    label: 'Planning controls',
    blurb: 'Zone, height, floor space and minimum lot size — LEP Part 4 standards.',
    lead: ['epi_name', 'lzn_sym_code_p', 'lzn_label', 'lzn_lay_class', 'hob_max_b_h_m', 'hob_units',
      'fsr_fsr', 'fsr_label', 'lot_size', 'lot_size_units', 'dualoccupancy'],
    match: /^(lzn_|hob_|fsr_|lsz_|lot_size|epi_name|in_lmr|in_tod|lmr_|tod_|historic_zone|historic_amendment|historic_commenced)/,
  },
  {
    key: 'uses',
    label: 'Permissible uses',
    lead: ['permissible_uses', 'sepp_landuses', 'sepps'],
  },
  {
    key: 'constraints',
    label: 'Constraints & hazards',
    blurb: 'Overlays that restrict what can be built, each from its own source layer.',
    lead: ['bushfireproneland', 'floodmapping', 'landslidrisk', 'biodiversity',
      'coastalmanagement', 'contaminationactivitytype', 'h_name', 'h_id',
      'salinity', 'wetland', 'riparianlandwatercouse', 'scenicprotectionland',
      'drinking_water_catchment', 'groundwatervulnerability', 'mine_subsidence_district',
      'mineralresoureland', 'australian_noise_exposure_forecast',
      'ols_minimum_height', 'ols_maximum_height'],
    match: /^(ada_|asb_|asf_|biomap_|biovalue_|bct_|cenv_|chaz_|crown_|cuse_|cwet_|dwc_|envsensi_|fbl_|koala|mls_|npws_|nrbio_|nrsensi_|nrwater_|ramsar_|rfa_|rip_|salinity_|sca_|scenic_|wilderness|buffer$|coastalmanagement_|activestreetfrontage|ass_lay_class|pnf_)/,
  },
  {
    key: 'cdc',
    label: 'Complying development',
    blurb: 'CDC pathway eligibility, with the exclusions that were tested.',
    lead: ['cdc_eligible', 'total_cdc_eligible', 'cdc_reasons'],
    match: /^cdc_/,
  },
  {
    key: 'patterns',
    label: 'Pattern Book eligibility',
    blurb: 'NSW Housing Pattern Book designs this lot was assessed against.',
    match: /_(eligible|reasons)$/,
  },
  {
    key: 'amenity',
    label: 'Amenity & market',
    lead: ['closest_school', 'closest_school_distance', 'closest_railway_station',
      'closest_railway_station_distance', 'closest_hospital', 'closest_hospital_distance',
      'walkable_score', 'land_value_1', 'estimated_price', 'no_of_beds', 'no_of_baths', 'no_of_cars'],
  },
  {
    key: 'dcp',
    label: 'Applicable DCP',
    lead: ['dcp_plan_name', 'dcp_plan_type', 'dcp_council_name', 'dcp_lga_name'],
  },
]

/** Geometry blobs and internals — never worth showing. */
const HIDDEN = /^(geom_1|centroid_geom|buffered_geom|normalized_address|rule_ids|propid_count)$/

/** Columns whose value is a metre measurement, for unit display. */
const METRES = /(_m|_length_m|_depth_m|height|_distance)$/

export interface Field { key: string; label: string; value: unknown; unit?: string }
export interface Category { key: string; label: string; blurb?: string; fields: Field[] }

/** `lot_depth_m` → `Lot depth`, `hob_max_b_h_m` → `Hob max b h`. */
export function humanise(key: string): string {
  const s = key
    .replace(/_m$/, '')
    .replace(/_/g, ' ')
    .replace(/\bfsr\b/gi, 'FSR')
    .replace(/\bhob\b/gi, 'HOB')
    .replace(/\bcdc\b/gi, 'CDC')
    .replace(/\blzn\b/gi, 'Zone')
    .replace(/\bepi\b/gi, 'EPI')
    .replace(/\blga\b/gi, 'LGA')
    .replace(/\bdcp\b/gi, 'DCP')
    .replace(/\bols\b/gi, 'OLS')
    .replace(/\blmr\b/gi, 'LMR')
    .replace(/\btod\b/gi, 'TOD')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Split one row into ordered categories.
 *
 * `includeEmpty: false` drops nulls, which is usually what a reader wants —
 * most of the 307 columns are empty for any given lot. Pass true when the
 * question is "what do we hold" rather than "what applies here".
 */
export function categorise(
  row: Record<string, unknown>,
  { includeEmpty = false }: { includeEmpty?: boolean } = {},
): Category[] {
  const claimed = new Set<string>()
  const keys = Object.keys(row).filter(k => !HIDDEN.test(k))

  const keep = (k: string) => {
    const v = row[k]
    return includeEmpty || (v !== null && v !== undefined && v !== '' && v !== 'null')
  }

  const toField = (k: string): Field => ({
    key: k,
    label: humanise(k),
    value: row[k],
    unit: METRES.test(k) ? 'm' : k === 'area_sqm' ? 'm²' : k === 'area_h' ? 'ha' : undefined,
  })

  const out: Category[] = []
  for (const g of FIELD_GROUPS) {
    const fields: Field[] = []
    for (const k of g.lead ?? []) {
      if (k in row && !claimed.has(k) && keep(k)) { fields.push(toField(k)); claimed.add(k) }
      else if (k in row) claimed.add(k)   // claimed but empty: do not let a later group take it
    }
    if (g.match) {
      for (const k of keys) {
        if (claimed.has(k) || !g.match.test(k)) continue
        claimed.add(k)
        if (keep(k)) fields.push(toField(k))
      }
    }
    if (fields.length) out.push({ key: g.key, label: g.label, blurb: g.blurb, fields })
  }

  // Anything the patterns missed still gets shown — new upstream columns
  // surface here rather than vanishing.
  const rest = keys.filter(k => !claimed.has(k) && keep(k))
  if (rest.length) {
    out.push({ key: 'other', label: 'Other', blurb: 'Not yet categorised.', fields: rest.map(toField) })
  }
  return out
}

/**
 * The pattern-book flags, paired with their reasons.
 *
 * Column naming is `<pattern>_eligible` / `<pattern>_reasons`, so the pairing is
 * mechanical. `semis_01_anthony_gill` → "Semis 01 — Anthony Gill".
 */
export function patternEligibility(row: Record<string, unknown>) {
  return Object.keys(row)
    .filter(k => k.endsWith('_eligible') && !k.startsWith('cdc') && k !== 'total_cdc_eligible')
    .map((k) => {
      const base = k.replace(/_eligible$/, '')
      const parts = base.split('_')
      const family = parts[0]
      const rest = parts.slice(1).join(' ')
      return {
        key: base,
        family,
        label: humanise(base),
        detail: rest,
        eligible: row[k] === true || row[k] === 1,
        reasons: (row[`${base}_reasons`] as string | null) ?? null,
      }
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.key.localeCompare(b.key))
}
