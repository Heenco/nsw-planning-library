/**
 * The guard registry — the closed vocabulary a control may branch on, and what can answer each one.
 *
 * THE RULE THIS FILE ENFORCES: a guard term may only be used if something can answer it. Not "should be
 * able to"; can, today, named here. Everything else is declared unresolvable rather than quietly dropped.
 *
 * This is the vocabulary gate from the LEP work, applied to the half of a DCP control that has never had
 * one. The measured failure it exists to prevent: Hornsby and Randwick each hold ~890 and ~954 numeric
 * effects of which roughly half cannot be told apart from a sibling that says something different,
 * because the thing that selects between them — "local road" vs "designated road" — was categorical and
 * had nowhere to go. Giving the model an open field to describe conditions in would reproduce that in
 * prose instead of losing it; giving it a closed list turns extraction into a membership test, which is
 * checkable.
 *
 * THREE STATES, NEVER SILENCE:
 *   site          we can resolve it from data we hold, for any lot, now
 *   ask           it is a property of the PROPOSAL, not the site — the applicant supplies it
 *   exclude_only  we can prove a lot is OUTSIDE it, but not that it is inside
 *   none          nothing can answer it; the control is recorded, flagged and shown as undetermined
 *
 * `exclude_only` exists because of what the place scopes turned out to be. Measured over 254 place
 * and site scopes in the three councils: 84 of them (33%) name a precinct — "Dural Village",
 * "Melrose Park Urban Renewal Precinct", "Hornsby Town Centre" — whose boundary is a FIGURE IN THE
 * DCP PDF. Only 2 of the 21 distinct names have a polygon anywhere in epi. But 82% of those names
 * CONTAIN a suburb we hold, so a lot in the wrong suburb is excluded with confidence while a lot in
 * the right suburb stays undetermined. For filtering that is most of the value, because the job is to
 * remove the 83% of the document that is about somewhere else.
 *
 * Resolvable today: 80 of 254 (31%) — 43 plain suburbs, 26 road lists, 11 heritage conservation
 * areas. The registry previously claimed all of it resolved, which was never tested.
 *
 * The third state is the one that matters. Camden, Newcastle and Central Coast all lead their front
 * setback with a prevailing-building-line average we cannot compute. Saying so beats guessing, and it is
 * precisely what a scalar-only schema hides.
 */

export type Resolution = 'site' | 'ask' | 'none' | 'exclude_only'

export interface Guard {
  /** The term the model may emit. Closed vocabulary. */
  key: string
  /** What it means, in the words a planner would use. Shown in the UI beside the answer. */
  label: string
  /** 'enum' guards compare against `values`; 'number' guards compare with an operator. */
  type: 'enum' | 'number' | 'boolean'
  values?: string[]
  unit?: string
  resolution: Resolution
  /** Where the answer comes from. For 'none', why it cannot be answered. */
  source: string
}

export const GUARDS: Guard[] = [
  // ── resolvable from the lot, today ──────────────────────────────────────
  {
    key: 'frontage_road_class',
    label: 'Class of the road the lot fronts',
    type: 'enum',
    values: ['local', 'designated', 'classified', 'state', 'regional', 'arterial'],
    resolution: 'site',
    source: "the plan's own designated-road annexure joined to derived.lot_frontage_run.road_hierarchy "
      + '(proven on Hornsby: 12,942 of 68,101 lots front a designated road)',
  },
  {
    key: 'zone',
    label: 'Land zone',
    type: 'enum',
    resolution: 'site',
    source: 'epi.epi_land_zoning / up_property_d_4',
  },
  {
    key: 'lot_area',
    label: 'Site area',
    type: 'number',
    unit: 'sqm',
    resolution: 'site',
    source: 'cadastre lot area (derived.lot_metrics_gnaf.area_sqm)',
  },
  {
    key: 'frontage_length',
    label: 'Length of the primary frontage',
    type: 'number',
    unit: 'metre',
    resolution: 'site',
    source: 'derived.lot_metrics_gnaf.primary_frontage_length_m (04D)',
  },
  {
    key: 'lot_width',
    label: 'Width of the lot',
    type: 'number',
    unit: 'metre',
    resolution: 'site',
    source: 'derived.lot_metrics_gnaf.width_at_setback_m — note PropCode distinguishes frontage from lot '
      + 'width, and "at the building line" is legally undefined',
  },
  { key: 'is_corner', label: 'Corner lot', type: 'boolean', resolution: 'site', source: 'up_property_d_4' },
  { key: 'is_battleaxe', label: 'Battle-axe / hatchet lot', type: 'boolean', resolution: 'site', source: 'up_property_d_4' },
  {
    key: 'slope',
    label: 'Slope of the land',
    type: 'number',
    unit: 'percent',
    resolution: 'site',
    source: 'derived.lot_slope (03) — grids are degrees, converted',
  },
  {
    key: 'locality',
    label: 'Named suburb or locality',
    type: 'enum',
    resolution: 'site',
    source: 'derived.lot_address.suburb, 4,499 distinct. Answers a plain suburb ("in Cherrybrook"), '
      + 'which is 43 of the 254 place scopes measured.',
  },
  {
    key: 'precinct',
    label: 'A precinct, centre or village the plan names',
    type: 'enum',
    resolution: 'exclude_only',
    source: 'THE BOUNDARY IS A FIGURE IN THE DCP PDF. 84 of 254 place scopes; only Parramatta City '
      + 'Centre (epi_local_provisions) and North Rocks Village Precinct (epi_key_sites) have a '
      + 'polygon in epi. Excluded by the suburb inside the name until the figures are digitised.',
  },
  {
    key: 'heritage_area',
    label: 'A named heritage conservation area',
    type: 'enum',
    resolution: 'site',
    source: 'epi.epi_heritage, 316 distinct conservation area labels',
  },
  {
    key: 'site_ref',
    label: 'A specific address the control singles out',
    type: 'enum',
    resolution: 'site',
    source: 'derived.lot_address, NOT YET BUILT. The values are compound and ranged - "65-79 '
      + 'Macquarie Street, 38 Hunter Street, 195 Church Street and 45 Hunter Street, Parramatta" is '
      + 'ONE value - so it needs a splitter, a range expander and a GNAF match. 21 of 254.',
  },
  {
    key: 'road_name',
    label: 'A road the control names',
    type: 'enum',
    resolution: 'site',
    source: 'derived.lot_frontage_run.road_name, the join the designated-road guard already uses. '
      + 'Expand the road type first: centrelines abbreviate it, GURAS spells it out. A name-only '
      + 'join collides (George St, Boundary Rd, Bay Rd each recur within one LGA). 26 of 254.',
  },
  {
    key: 'map_area',
    label: 'An area shown on a map in the plan',
    type: 'enum',
    resolution: 'site',
    source: 'epi / cdc / lmr layers, resolved through nsw.scope_layer',
  },
  {
    key: 'heritage',
    label: 'Heritage item or conservation area',
    type: 'boolean',
    resolution: 'site',
    source: 'epi.epi_heritage',
  },
  {
    key: 'foreshore',
    label: 'Seaward of the foreshore building line',
    type: 'boolean',
    resolution: 'site',
    source: 'epi.epi_foreshore_building_line',
  },

  // ── properties of the proposal: the applicant answers ───────────────────
  {
    key: 'land_use',
    label: 'What is proposed',
    type: 'enum',
    resolution: 'ask',
    source: 'the proposal; vocabulary is the Standard Instrument 203-term universe '
      + '(nsw.lep_permissibility_universe), so a parent term resolves to its children',
  },
  { key: 'storeys', label: 'Number of storeys proposed', type: 'number', resolution: 'ask', source: 'the proposal' },
  { key: 'building_height', label: 'Height of the building proposed', type: 'number', unit: 'metre', resolution: 'ask', source: 'the proposal' },
  { key: 'dwelling_count', label: 'Number of dwellings proposed', type: 'number', resolution: 'ask', source: 'the proposal' },
  { key: 'bedrooms', label: 'Bedrooms per dwelling', type: 'number', resolution: 'ask', source: 'the proposal — drives most parking rates' },
  { key: 'gfa', label: 'Gross floor area proposed', type: 'number', unit: 'sqm', resolution: 'ask', source: 'the proposal' },
  { key: 'wall_height', label: 'Height of the wall at the boundary', type: 'number', unit: 'metre', resolution: 'ask', source: 'the proposal' },
  { key: 'basement', label: 'Includes a basement', type: 'boolean', resolution: 'ask', source: 'the proposal' },

  // ── declared unresolvable ───────────────────────────────────────────────
  {
    key: 'prevailing_building_line',
    label: 'The average setback of neighbouring buildings',
    type: 'number',
    unit: 'metre',
    resolution: 'none',
    source: 'needs neighbouring building footprints with their setbacks; we hold no building footprint '
      + 'layer. Camden, Newcastle and Central Coast all lead their front setback with this.',
  },
  {
    key: 'existing_building_line',
    label: 'The setback of a building already on this lot',
    type: 'number',
    unit: 'metre',
    resolution: 'none',
    source: 'needs the existing building footprint on the subject lot',
  },
  {
    key: 'streetscape_character',
    label: 'The established character of the street',
    type: 'enum',
    resolution: 'none',
    source: 'a merit judgement — Solihin & Eastman Class 4, not automatable. Recorded so it is visible, '
      + 'never evaluated.',
  },
  {
    key: 'adjoining_development',
    label: 'What is built on the neighbouring lots',
    type: 'enum',
    resolution: 'none',
    source: 'needs neighbouring development data we do not hold',
  },
]

export const GUARD_BY_KEY = new Map(GUARDS.map(g => [g.key, g]))
export const GUARD_KEYS = GUARDS.map(g => g.key)

/** A guard the model emitted that is not in the registry is a finding, not a new guard. */
export const isGuard = (k: string): boolean => GUARD_BY_KEY.has(k)

export const resolutionOf = (k: string): Resolution | null => GUARD_BY_KEY.get(k)?.resolution ?? null

/**
 * The frames. A frame decides which slots are MANDATORY, so an empty one is noticed rather than silently
 * omitted — the defect that let Parramatta cl 4.1C reach the pilot store with no numbers and one zone
 * where the clause names three. Role classification comes before extraction: the frame picks the slots.
 */
export const FRAMES = {
  dimensional: {
    label: 'A measurable limit on the building or the site',
    blurb: 'setback, height, site coverage, landscaped area, deep soil, floor space ratio, lot size',
    required: ['topic', 'comparator', 'unit', 'branches'],
  },
  rate: {
    label: 'A quantity per unit of something proposed',
    blurb: 'car spaces per dwelling, bicycle spaces per 100 sqm — a function of the proposal, not the site',
    required: ['topic'],
  },
  deferral: {
    label: 'Points at another instrument or a map instead of stating a value',
    blurb: '"See Clause 6.1 of HLEP Foreshore Building Line Map"',
    required: ['defers_to'],
  },
  merit: {
    label: 'Explicitly left to assessment',
    blurb: '"merit assessment", "to Council satisfaction", anything about character or amenity',
    required: [],
  },
  narrative: {
    label: 'A requirement with no measurable quantity',
    blurb: 'a design direction, a procedural must',
    required: [],
  },
} as const

export type FrameName = keyof typeof FRAMES
export const FRAME_NAMES = Object.keys(FRAMES) as FrameName[]

/**
 * Topics. Closed, and deliberately the same vocabulary already in nsw.rule_effect.topic so the new
 * controls join to the old ones. `unspecified` is NOT in the list: it is 576 of 1,850 DCP effects today
 * and it means the extractor did not know, which is a finding, not a topic.
 */
export const TOPICS = [
  'setback', 'height', 'storeys', 'site_coverage', 'landscaping', 'deep_soil', 'open_space',
  'fsr', 'floor_area', 'lot_size', 'width', 'frontage', 'density', 'parking', 'bicycle_parking',
  'driveway', 'privacy', 'solar_access', 'overshadowing', 'ceiling_height', 'excavation',
  'fencing', 'waste', 'stormwater', 'tree_canopy', 'separation', 'balcony', 'storage',
  // Added after measuring what the three documents actually control. The original list was seeded
  // from nsw.rule_effect.topic, which came from a setback-and-parking-centric extraction, so it
  // inherited that extraction's blind spots: 37 of 510 controls in the first spread used a topic
  // outside it, and most were real subjects rather than model invention.
  'noise', 'flood', 'bushfire', 'heritage', 'contamination', 'salinity', 'acid_sulfate',
  'pedestrian_access', 'vehicle_access', 'sight_distance', 'loading', 'basement',
  'energy', 'water_reuse', 'sustainability', 'views', 'hours_of_operation', 'signage',
  'accessibility', 'adaptable_housing', 'dwelling_mix', 'street_wall', 'awning',
  'erosion_sediment', 'earthworks', 'retaining_wall', 'services', 'lighting',
] as const
export type Topic = (typeof TOPICS)[number]
