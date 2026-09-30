/**
 * The layers on /lmr: SEPP land application layers from the All-EPI geodatabase (epi.epi_land_application),
 * baked into a PMTiles archive by scripts/build-sepp-pmtiles.py. Shared by the page and /api/lmr/*.
 *
 * A layer is one (SEPP, lay_name) pair - "SEPP Land Application" alone is a lay_name in eleven SEPPs - and its
 * key is the layer_key property on every tile feature.
 *
 * COLOUR (2026-09-28)
 *
 * Every layer takes the NSW Planning Portal Spatial Viewer's own symbol where it has one - the renderer in
 * the drawingInfo of the ArcGIS layer each `from` names (mapprod3.environment.nsw.gov.au). The SEPP layers
 * are matched to the consolidated Planning/SEPP_<name>_2021 services, which are organised the way this page
 * is; the ePlanning Planning_Portal_SEPP service still groups its layers under the pre-2021 SEPP names.
 *   TOD Area                  SEPP/752  dark blue fill, white outline
 *   Accelerated TOD Precinct  SEPP/759  violet fill, purple outline
 *   Town Centre               SEPP/766  blue outline, no fill
 *   LMR Exclusion             SEPP/776  black backward-diagonal hatch
 * These replaced the colours of the Planning Portal's separate LMR map legend (TOD Area pink-mauve, LMR
 * Centre pale blue with a purple outline, exclusion grey hatch), which the page followed until now.
 *
 * A SEPP layer the Spatial Viewer does not carry keeps the colour of its family with a dashed outline, which is
 * how every non-LMR SEPP layer used to be drawn; every layer is also named in the panel and the click popup.
 */

import { hatchCss, type Hatch } from './hatch'

export type LmrFamily = 'lmr' | 'housing' | 'precincts' | 'environment' | 'systems'

export const LMR_LAYER_NAMES = [
  'Transport Oriented Development Area',
  'Town Centre',
  'Low and Mid Rise Housing Exclusion Area',
  'Accelerated TOD Precinct',
] as const

/** How a SEPP layer is drawn. `fillOpacity: 0` is an outline-only symbol; with `hatch`, `fill` is the line colour. */
export interface SeppStyle {
  fill: string
  fillOpacity: number
  line: string
  lineWidth: number
  hatch?: Hatch
  /** Outline dashed - only the family fallback, so a layer we styled ourselves never passes for a portal one. */
  dashed?: boolean
  /** The ArcGIS layer the symbol was read from, or why there is none. */
  from: string
}

export interface LmrStyle extends SeppStyle {
  /** The name the Planning Portal's LMR map legend uses. */
  portalName: string
}

const SV = 'Spatial Viewer'

/** LMR layers by lay_name. */
export const LMR_STYLE: Record<string, LmrStyle> = {
  'Transport Oriented Development Area': { portalName: 'TOD Area', fill: '#004da8', fillOpacity: 0.55, line: '#ffffff', lineWidth: 1.5, from: `${SV} · Planning_Portal_SEPP/752 Transport Oriented Development Sites` },
  'Town Centre': { portalName: 'LMR Centre', fill: '#005ce6', fillOpacity: 0, line: '#005ce6', lineWidth: 2.5, from: `${SV} · Planning_Portal_SEPP/766 Town Centres` },
  'Low and Mid Rise Housing Exclusion Area': { portalName: 'Low and Mid Rise Housing Exclusion', fill: '#000000', fillOpacity: 0, line: '#000000', lineWidth: 0.8, hatch: 'bdiag', from: `${SV} · Planning_Portal_SEPP/776 Low and Mid Rise Housing Exclusion` },
  'Accelerated TOD Precinct': { portalName: 'TOD Accelerated Rezoning Area', fill: '#df73ff', fillOpacity: 0.6, line: '#c500ff', lineWidth: 1, from: `${SV} · Planning_Portal_SEPP/759 Accelerated TOD Precincts` },
}

const FALLBACK_STYLE: LmrStyle = { portalName: '', fill: '#cbd5e1', fillOpacity: 0.6, line: '#475569', lineWidth: 1, from: 'ours - no symbol recorded' }

export function lmrStyle(layName: string): LmrStyle {
  return LMR_STYLE[layName] ?? FALLBACK_STYLE
}

/** A SEPP layer's Spatial Viewer symbol from its consolidated SEPP service, Planning/SEPP_<svc>/<id>. */
const sv = (svc: string, id: number, name: string, s: Omit<SeppStyle, 'from'>): SeppStyle =>
  ({ ...s, from: `${SV} · Planning/SEPP_${svc}/${id} ${name}` })
const outline = (line: string, lineWidth = 2) => ({ fill: line, fillOpacity: 0, line, lineWidth })

/** The other SEPP layers, by layer key. A key missing here falls back to its family's dashed outline. */
export const SEPP_STYLE: Record<string, SeppStyle> = {
  // Biodiversity and Conservation
  biodiversity_and_conservation_sepp_land_application: sv('Biodiversity_and_Conservation_2021', 1, 'Land Application', outline('#a83800')),
  biodiversity_and_conservation_allowable_clearing: sv('Biodiversity_and_Conservation_2021', 15, 'Allowable Clearing', outline('#4e4e4e', 1)),
  biodiversity_and_conservation_foreshores_and_waterways_area: sv('Biodiversity_and_Conservation_2021', 2, 'Foreshores and Waterways Area', outline('#e60000')),
  biodiversity_and_conservation_georges_river_catchment: sv('Biodiversity_and_Conservation_2021', 5, 'Georges River Catchment', { fill: '#ffebe8', fillOpacity: 0.5, line: '#000000', lineWidth: 0.8 }),
  biodiversity_and_conservation_hawkesbury_nepean_catchment: sv('Biodiversity_and_Conservation_2021', 3, 'Hawkesbury-Nepean Catchment', outline('#ff0000')),
  biodiversity_and_conservation_hawkesbury_nepean_sub_catchments: sv('Biodiversity_and_Conservation_2021', 3, 'Hawkesbury-Nepean Sub-Catchments', { fill: '#ffa77f', fillOpacity: 0.4, line: '#ff5500', lineWidth: 2 }),
  biodiversity_and_conservation_special_purposes_commercial_marinas_and_boat_building_and_repair_facilities: sv('Biodiversity_and_Conservation_2021', 7, 'Special Purposes (Commercial Marinas ...)', outline('#a80000')),
  biodiversity_and_conservation_strategic_foreshore_sites_map: sv('Biodiversity_and_Conservation_2021', 8, 'Strategic Harbour Foreshore Sites', outline('#8400a8')),
  biodiversity_and_conservation_sydney_harbour_catchment: sv('Biodiversity_and_Conservation_2021', 9, 'Sydney Harbour Catchment', outline('#00a9e6')),
  // Codes SEPP
  exempt_and_complying_development_codes_sepp_land_application: sv('Exempt_and_Complying_Development_Codes_2008', 2, 'Land Application', outline('#ffd37f')),
  exempt_and_complying_development_codes_greenfield_housing_code_area: { fill: '#ffbebe', fillOpacity: 0.55, line: '#ff0000', lineWidth: 1.5, from: `${SV} · Planning_Portal_Development_Control/222 Greenfield Housing Code Area` },
  // Housing, other than the four LMR layers
  housing_sepp_land_application: sv('Housing_2021', 1, 'Land Application', outline('#a83800')),
  housing_short_term_rental_accommodation_area: sv('Housing_2021', 2, 'Short-term Rental Accommodation Area', outline('#a83800')),
  // the rest
  industry_and_employment_sepp_land_application: sv('Industry_and_Employment_2021', 1, 'Land Application', outline('#000000')),
  planning_systems_sepp_land_application: sv('Planning_Systems_2021', 1, 'Land Application', outline('#f57ab6')),
  precincts_central_river_city_sepp_land_application: sv('Precincts_Central_River_City_2021', 2, 'Land Application', outline('#ff0000')),
  precincts_central_river_city_growth_centres: sv('Precincts_Central_River_City_2021', 17, 'Growth Centres', outline('#000000')),
  precincts_eastern_harbour_city_sepp_land_application: sv('Precincts_Eastern_Harbour_City_2021', 2, 'Land Application', outline('#00a884')),
  precincts_eastern_harbour_city_land_application: sv('Precincts_Eastern_Harbour_City_2021', 2, 'Land Application', outline('#00a884')),
  precincts_eastern_harbour_city_sydney_opera_house_buffer_zone: { fill: '#0070ff', fillOpacity: 0, line: '#000000', lineWidth: 2, hatch: 'bdiag', from: `${SV} · Planning_Portal_SEPP/296 Sydney Opera House Buffer Zone` },
  precincts_regional_sepp_land_application: sv('Precincts_Regional_2021', 2, 'Land Application', outline('#000000')),
  precincts_western_parkland_city_sepp_land_application: sv('Precincts_Western_Parkland_City_2021', 2, 'Land Application', outline('#ff0000')),
  precincts_western_parkland_city_growth_centres: sv('Precincts_Western_Parkland_City_2021', 13, 'Growth Centres', outline('#000000')),
  primary_production_sepp_land_application: sv('Primary_Production_2021', 2, 'Land Application', outline('#000000')),
  resilience_and_hazards_sepp_land_application: sv('Resilience_and_Hazards_2021', 1, 'Land Application Map', outline('#ff0000', 3)),
  resources_and_energy_sepp_land_application: sv('Resources_and_Energy_2021', 1, 'Land Application', outline('#000000')),
  transport_and_infrastructure_sepp_land_application: sv('Transport_and_Infrastructure_2021', 2, 'Land Application', outline('#66cdab')),
  transport_and_infrastructure_subject_land: sv('Transport_and_Infrastructure_2021', 1, 'Subject Land', outline('#ff0000')),
  transport_and_infrastructure_renewables_zone: { fill: '#ffebaf', fillOpacity: 0.5, line: '#ffaa00', lineWidth: 2, from: 'REI/AEMO_Zones/0 Renewable Energy Zones (the NSW renewable energy viewer; not an ePlanning layer)' },
  // not in the Spatial Viewer, so the family fallback: planning_systems_darkinjung_lalc_land,
  // resilience_and_hazards_cockle_creek_smelter_land, sustainable_buildings_sepp_land_application,
  // transport_and_infrastructure_affected_land
}

/** How a SEPP layer is drawn: an LMR layer by name, another by key, and the family's dashed outline otherwise. */
export function seppStyle(layer: { key?: string; family: LmrFamily; layName: string }): SeppStyle {
  if (layer.family === 'lmr') return lmrStyle(layer.layName)
  const own = layer.key ? SEPP_STYLE[layer.key] : undefined
  if (own) return own
  const color = FAMILY[layer.family].color
  return { fill: color, fillOpacity: 0.12, line: color, lineWidth: 1.4, dashed: true, from: 'ours - not in the Spatial Viewer, so the colour of its SEPP family' }
}

export const FAMILY: Record<Exclude<LmrFamily, 'lmr'>, { title: string; color: string; blurb: string }> = {
  housing: { title: 'Housing SEPP, other layers', color: '#e87ba4', blurb: 'Where the Housing SEPP applies, and short-term rental accommodation areas.' },
  precincts: { title: 'Precincts SEPPs', color: '#eda100', blurb: 'The Central River City, Eastern Harbour City, Western Parkland City and Regional precincts.' },
  environment: { title: 'Environment and hazards', color: '#008300', blurb: 'Biodiversity and Conservation, Resilience and Hazards, Primary Production.' },
  systems: { title: 'Systems, infrastructure and codes', color: '#e34948', blurb: 'Planning Systems, Transport and Infrastructure, Industry and Employment, Resources and Energy, Sustainable Buildings, and the Codes SEPP.' },
}

/** Which family a SEPP belongs to, by its short name (e.g. "Housing 2021", "Precincts – Regional 2021"). */
export function familyOf(sepp: string, layerGroup: string): LmrFamily {
  if (layerGroup === 'lmr') return 'lmr'
  if (/^Housing\b/.test(sepp)) return 'housing'
  if (/^Precincts\b/.test(sepp)) return 'precincts'
  if (/^(Biodiversity|Resilience|Primary Production)\b/.test(sepp)) return 'environment'
  return 'systems'
}

/** The layer's outline colour, for the few places that show one colour. A white outline reads as its fill. */
export function colorOf(layer: { key?: string; family: LmrFamily; layName: string }): string {
  const s = seppStyle(layer)
  return s.line.toLowerCase() === '#ffffff' ? s.fill : s.line
}

/** CSS for a legend swatch, matching the map: the fill (or hatch) inside the outline, dashed for the fallback. */
export function swatchCss(layer: { key?: string; family: LmrFamily; layName: string }): Record<string, string> {
  return styleSwatch(seppStyle(layer))
}

function styleSwatch(s: { fill: string; fillOpacity: number; line?: string; lineWidth?: number; hatch?: Hatch; dashed?: boolean }): Record<string, string> {
  // a white outline would vanish on the white panel, so the swatch borders in the fill instead
  const border = !s.lineWidth || !s.line || s.line.toLowerCase() === '#ffffff' ? s.fill : s.line
  const base = { borderColor: border, borderStyle: s.dashed ? 'dashed' : 'solid' }
  if (s.hatch) return { ...base, background: hatchCss(s.hatch, s.fill) }
  if (s.fillOpacity === 0) return { ...base, background: 'transparent' }
  return { ...base, background: s.fill, opacity: String(Math.max(0.55, s.fillOpacity + 0.3)) }
}

/** What each LMR layer means, in one line, for the panel. */
export const LMR_BLURB: Record<string, string> = {
  'Transport Oriented Development Area': 'Land around the TOD stations, mapped for the Housing SEPP\'s transport oriented development provisions.',
  'Town Centre': 'Town centres mapped under the Housing SEPP for the low and mid rise housing provisions.',
  'Low and Mid Rise Housing Exclusion Area': 'Land the Housing SEPP maps as excluded from the low and mid rise housing provisions.',
  'Accelerated TOD Precinct': 'The accelerated TOD precincts mapped in the Housing SEPP.',
}

export interface LmrLayer {
  key: string
  group: 'lmr' | 'sepp'
  family: LmrFamily
  sepp: string
  epiName: string
  layName: string
  features: number
  classes: { name: string; features: number }[]
  lgas: number
  areaKm2: number | null
  commenced: string | null
  bbox: [number, number, number, number] | null
  /** Heavy layers are off by default and drawn only from this zoom. */
  minZoom: number
}

export interface LmrCatalogue {
  layers: LmrLayer[]
  /** When the tile tables were last built, and the EPI load they were built from. */
  builtAt: string | null
  sourceLoadedAt: string | null
  sourceDate: string | null
}

// ── LMR constraints: the lmr schema (scripts/build-lmr-pmtiles.py) ──────────────────────────────────────────

/**
 * Where each constraint table sits in the panel. `housing` puts it beside the Housing SEPP's LMR layers - the
 * stations are the Planning Portal's "LMR Station", the points low and mid rise housing areas are measured from.
 */
export type ConstraintGroup = 'housing' | 'zoning' | 'heritage' | 'hazards' | 'coastal' | 'noise'

export const CONSTRAINT_GROUPS: Record<Exclude<ConstraintGroup, 'housing'>, { title: string; lead: string }> = {
  zoning: { title: 'Land zoning', lead: 'The LEP and SEPP land zoning maps, in the zone colours of the NSW Planning Portal. The low and mid-rise provisions apply in R1, R2, R3 and R4.' },
  heritage: { title: 'Heritage', lead: 'State Heritage Register land and the LEP heritage maps.' },
  hazards: { title: 'Bushfire and flood', lead: 'RFS bush fire prone land, the flood maps, and the catchments a floodplain risk management study or flood study speaks for.' },
  coastal: { title: 'Coast and water', lead: 'The Resilience and Hazards SEPP coastal wetland, littoral rainforest and vulnerability maps.' },
  noise: { title: 'Noise and pipelines', lead: 'Aircraft noise contours, the national gas and oil pipeline maps, and the 200 m around each pipeline.' },
}

export interface ConstraintStyle {
  group: ConstraintGroup
  title: string
  kind: 'fill' | 'line' | 'point'
  /** Fill colour, line colour for a line layer, dot colour for points. */
  color: string
  fillOpacity?: number
  line?: string
  lineWidth?: number
  dashed?: boolean
  /** Drawn as hatch lines of `color` instead of a flat fill, as the portal draws its proximity areas. */
  hatch?: Hatch
  /** The ArcGIS layer the symbol was read from, or why there is none. */
  from?: string
  /** Colours by the feature's category (bushfire vegetation categories) instead of one colour. */
  classes?: Record<string, string>
  /**
   * Put `classes` on the OUTLINE rather than the fill, for a layer drawn line-only (`fillOpacity: 0`).
   * Without it a nested layer's legend would promise colours the map never draws.
   */
  classLine?: boolean
  defaultOn?: boolean
  portalName?: string
}

/**
 * Zone colours, taken from the NSW Planning Portal's own Land Zoning Map renderer
 * (Planning_Portal_Principal_Planning/MapServer/19), matched to each code by the zone name our data uses -
 * E2 and E are in the renderer twice, once for the old environmental zones and once for the employment ones.
 * CA is the one code in the data the renderer does not colour; it falls back to the layer's grey.
 */
export const ZONE_COLOURS: Record<string, string> = {
  '2(a)': '#ffa6a3',
  '2(c)': '#ffbee8',
  '7(a)': '#ffd37f',
  '7(l)': '#ffaa00',
  'A': '#fc776e',
  'AGB': '#fae8c5',
  'B': '#63f0f5',
  'B1': '#c9fff9',
  'B2': '#62f0f5',
  'B3': '#00c2ed',
  'B4': '#959dc2',
  'B5': '#7da0ab',
  'B6': '#95bfcc',
  'B7': '#bad6de',
  'C': '#bad6de',
  'C1': '#e69900',
  'C2': '#f0ae3c',
  'C3': '#f7c568',
  'C4': '#ffda96',
  'D': '#959dc2',
  'DM': '#ffffff',
  'DR': '#ffff70',
  'E': '#f0ae3c',
  'E1': '#99ccff',
  'E2': '#b4c6e7',
  'E3': '#8ea9db',
  'E4': '#9999ff',
  'E5': '#9966ff',
  'ECO': '#ecffbe',
  'EM': '#95bfcc',
  'ENP': '#ffd640',
  'ENT': '#76c0d6',
  'ENZ': '#73b273',
  'EP': '#fcf9b6',
  'F': '#ffffa1',
  'G': '#ffff70',
  'H': '#55ff00',
  'I': '#d3ffbf',
  'IN1': '#deb8f5',
  'IN2': '#f3dbff',
  'IN3': '#c595e8',
  'MAP': '#e6ffff',
  'MU': '#959dc2',
  'MU1': '#959dc2',
  'OSP': '#55ff00',
  'P': '#b3ccfc',
  'PAE': '#f4ec49',
  'PEP': '#74b374',
  'PRC': '#549980',
  'PRR': '#70a600',
  'R': '#b3fcb3',
  'R1': '#ffcfff',
  'R2': '#ffa6a3',
  'R3': '#ff776e',
  'R4': '#ff483b',
  'R5': '#ffd9d9',
  'RAC': '#e6cb97',
  'RAZ': '#e6cb97',
  'RE1': '#55ff00',
  'RE2': '#d3ffbe',
  'REC': '#aef2b3',
  'REPL': '#f0f0f0',
  'RESB': '#f3fd36',
  'RESI': '#d3163e',
  'REZ': '#deb8f5',
  'RLWY': '#0000ac',
  'RO': '#55ff00',
  'RP': '#d3ffbe',
  'RU1': '#edd8ad',
  'RU2': '#e6cb97',
  'RU3': '#dec083',
  'RU4': '#d6b46f',
  'RU5': '#d7a39e',
  'RU6': '#c79e4c',
  'RUR': '#efe4be',
  'RW': '#d3b8f5',
  'SET': '#ffd2dc',
  'SP1': '#ffffa0',
  'SP2': '#ffff70',
  'SP3': '#ffff00',
  'SP4': '#ffff00',
  'SP5': '#e6e600',
  'SPU': '#ffff00',
  'SUS': '#ffffa1',
  'T': '#fcd2ef',
  'U': '#cafced',
  'UD': '#ff7f63',
  'UL': '#ffffff',
  'UR': '#ff776e',
  'W': '#fcc4b8',
  'W1': '#d9fff2',
  'W2': '#99ffdd',
  'W3': '#33ffbb',
  'W4': '#00e6a9',
  'WFU': '#1182c2',
}

/**
 * Constraint styling (2026-09-28): the NSW Planning Portal Spatial Viewer's own symbol wherever it has the
 * layer - `from` names the ArcGIS layer it was read from - so bush fire prone land, heritage, flood, the
 * coastal wetlands and the noise contours look here the way they look on the portal. Categories key on what
 * the tiles carry, which for these layers is the very field the portal's renderer keys on (d_category,
 * lay_class, anef_code, sym_code). The proximity areas are the portal's backward-diagonal hatches.
 *
 * Ours, because no Spatial Viewer layer exists: the LMR Station dot and the walking catchments (the portal's
 * separate LMR map legend), the FRMSP catchments, the 200 m pipeline buffers and the whole-LGA exclusion.
 * The pipelines take the NSW renewable energy viewer's gas and petroleum pipeline colours.
 *
 * The FRMSP catchments are the one layer in `hazards` that is not a hazard extent: they say which study
 * speaks for a catchment, not which land floods. They take an indigo the flood blues do not use, drawn
 * dashed and barely filled, so they never read as an extent - and are coloured by the kind of report.
 */
export const CONSTRAINT_STYLE: Record<string, ConstraintStyle> = {
  lmr_train_stations: { group: 'housing', title: 'LMR Station', portalName: 'LMR Station', kind: 'point', color: '#7a7a7a', defaultOn: true, from: 'Planning Portal LMR map legend' },
  // walking catchments: the portal's "Indicative LMR Housing Area" pale yellow for 800 m, a stronger amber for
  // 400 m drawn over it; town centres with a dashed outline so the two catchment layers stay apart
  station_walking_catchments: {
    group: 'housing', title: 'Station walking catchments (400 m, 800 m)', kind: 'fill', color: '#fde3ae', fillOpacity: 0.55,
    line: '#c9912f', lineWidth: 1, classes: { '800 m': '#fde3ae', '400 m': '#f5b95a' }, defaultOn: true,
    from: 'Planning Portal LMR map legend (Indicative LMR Housing Area)',
  },
  town_centre_walking_catchments: {
    group: 'housing', title: 'Town centre walking catchments (400 m, 800 m)', kind: 'fill', color: '#fde3ae', fillOpacity: 0.55,
    line: '#c9912f', lineWidth: 1, dashed: true, classes: { '800 m': '#fde3ae', '400 m': '#f5b95a' }, defaultOn: true,
    from: 'Planning Portal LMR map legend (Indicative LMR Housing Area)',
  },
  // The LMR layer itself (scripts/build-lmr-lots.ts). Ours: no published layer is this - the Department's map
  // is indicative and applies no exclusions. Blue for land the chapter reaches, amber where the data cannot
  // decide an s 164 item, grey where s 164 takes the lot out - so the product reads apart from the pale amber
  // catchments it is built from. The dissolved outline is for low zoom; the pink lots are 05_lmr's disagreements.
  lot_lmr: {
    group: 'housing', title: 'LMR layer - lots (in, undecided, excluded)', kind: 'fill', color: '#1971c2', fillOpacity: 0.6,
    line: '#1864ab', lineWidth: 0.4, classes: { in: '#1971c2', undecided: '#f08c00', excluded: '#adb5bd' }, defaultOn: true,
    from: 'ours - built by scripts/build-lmr-lots.ts from Chapter 6',
  },
  lmr_area: {
    group: 'housing', title: 'LMR layer - outline (inner, outer)', kind: 'fill', color: '#1864ab', fillOpacity: 0,
    line: '#1864ab', lineWidth: 2, classLine: true, classes: { inner: '#1864ab', outer: '#4dabf7' },
    from: 'ours - the in-class lots dissolved by band',
  },
  lot_lmr_05_only: {
    group: 'housing', title: 'In 05_lmr but not in this build', kind: 'fill', color: '#c2255c', fillOpacity: 0.35,
    line: '#a61e4d', lineWidth: 0.8, dashed: true,
    classes: { 'outside our walking catchments': '#c2255c', 'no part in R1-R4 on our zoning': '#e64980', 'only touches our catchment at the boundary': '#f783ac' },
    from: 'ours - nsw.up_property_d_4.in_lmr_housing_area lots missing from lmr.lot_lmr',
  },
  // Schedule 12: the Spatial Viewer's own symbol for the Deferred TOD Areas map (Planning/SEPP_Housing_2021/5) -
  // a black vertical hatch in a red outline - though that map is published empty and these areas are ours.
  deferred_tod_areas: {
    group: 'housing', title: 'Deferred TOD areas (800 m)', kind: 'fill', color: '#000000', hatch: 'vertical',
    line: '#e60000', lineWidth: 1.5, from: 'Spatial Viewer · Planning/SEPP_Housing_2021/5 Deferred TOD Areas (symbol only - the layer is empty)',
  },
  deferred_tod_stations: {
    group: 'housing', title: 'Deferred TOD stations (Schedule 12)', kind: 'point', color: '#e60000',
    from: 'ours - the Schedule 12 stations, in the deferred TOD outline red',
  },
  // The Department names four councils rather than mapping them, so there is no portal symbol. A dark red
  // hatch under a heavy outline: an exclusion, like the black LMR exclusion hatch, but never mistaken for it,
  // and the hatch lets the land underneath show through across 10,000 km2.
  whole_lga_exclusion: {
    group: 'housing', title: 'Whole-LGA exclusion', kind: 'fill', color: '#9f1239', hatch: 'bdiag',
    line: '#9f1239', lineWidth: 2.5, from: 'ours - the four councils are named, not mapped; boundaries from ePlanning Administration/5',
  },
  epi_land_zoning: {
    group: 'zoning', title: 'Land zoning (LEP and SEPP maps)', portalName: 'Land Zoning Map', kind: 'fill',
    color: '#cbd5e1', fillOpacity: 0.55, lineWidth: 0, classes: ZONE_COLOURS,
    from: 'Spatial Viewer · Planning_Portal_Principal_Planning/19 Land Zoning Map',
  },
  shr_curtilage: {
    group: 'heritage', title: 'State Heritage Register curtilage', kind: 'fill', color: '#0070ff', hatch: 'vertical',
    line: '#6e6e6e', lineWidth: 1, from: 'Spatial Viewer · Planning_Portal_Principal_Planning/221 State Heritage Register Curtilage',
  },
  epi_heritage_items: {
    group: 'heritage', title: 'Heritage items (LEP maps)', kind: 'fill', color: '#dbbb7b', fillOpacity: 0.6, line: '#000000', lineWidth: 0.6,
    classes: {
      'Item - General': '#dbbb7b', 'Local Heritage - General': '#dbbb7b', 'Item - Archaeological': '#ffffbf',
      'Item - Landscape': '#b3e096', 'Item - Aboriginal': '#ffc700', 'Aboriginal Object': '#ffc700',
      'Aboriginal Place of Heritage Significance': '#ffc700',
    },
    from: 'Spatial Viewer · Planning_Portal_Principal_Planning/16 EPI Heritage',
  },
  bushfire_prone_land: {
    group: 'hazards', title: 'Bush fire prone land', kind: 'fill', color: '#ff8000', fillOpacity: 0.45, lineWidth: 0,
    classes: { 'Vegetation Category 1': '#ff0000', 'Vegetation Category 2': '#ffd200', 'Vegetation Category 3': '#ff8000', 'Vegetation Buffer': '#ffff73' },
    from: 'Spatial Viewer · Planning_Portal_Hazard/229 Bushfire Prone Land',
  },
  flood_planning: {
    group: 'hazards', title: 'Flood planning (LEP maps)', kind: 'fill', color: '#00c2ed', fillOpacity: 0.5, line: '#000000', lineWidth: 0.6,
    classes: {
      'Flood Prone and Major Creeks Land': '#73b2ff', 'Flood Planning Area': '#00c2ed', '1 in 100 AEP Flood Extent': '#1976d2',
      'Area 1': '#002673', 'Transitional Land': '#ff52d7', 'Level of Probable Maximum Flood': '#000aff',
      'Land Identified in Section 3.27': '#ff0000',
    },
    from: 'Spatial Viewer · Planning_Portal_Hazard/230 Flood Planning Map',
  },
  // flood_sfd_1aep, the other load of this same extent, is no longer drawn (2026-09-23), so this one is
  // titled plainly and solid rather than "second load" dashed against a first that is not on the page.
  flood_sfd_1aep_1: {
    group: 'hazards', title: '1% AEP flood extent (SFD)', kind: 'fill', color: '#1976d2', fillOpacity: 0.5, line: '#1976d2', lineWidth: 0.4,
    from: 'Spatial Viewer · Planning_Portal_SEPP/293 1 in 100 AEP Flood Extents',
  },
  // Drawn as an outline and not filled, because these catchments NEST: one row per report, and a
  // whole-of-river flood study, a council-wide study and a single-creek plan all cover the same land.
  // 60 of the 66 overlap another by more than 5% of their area and 24 stack at one point, so even a 0.12
  // fill composes to about 95% opaque over the Georges River and buries the flood extents underneath it.
  frmsp_georges_river: {
    group: 'hazards', title: 'Floodplain risk management studies (Georges River)', kind: 'fill',
    color: '#7b93c7', fillOpacity: 0, line: '#3d5591', lineWidth: 1.4, dashed: true, classLine: true,
    classes: {
      'Flood Study': '#aebfdf',
      'Floodplain Risk Management Study': '#8ba1cf',
      'Floodplain Risk Management Study and Plan': '#6079b5',
      'Floodplain Risk Management Plan': '#41598f',
    },
    from: 'ours - an FRMSP deliverable, not a Spatial Viewer layer',
  },
  // epi_drinking_water_catchments taken off the page 2026-09-29: a Codes SEPP complying development test,
  // not in Chapter 6's list, so it changed no low and mid-rise result. /cdc-map still draws and tests it.
  sepp_coastal_vulnerability_areas: {
    group: 'coastal', title: 'Coastal vulnerability areas', kind: 'fill', color: '#9c9c9c', hatch: 'bdiag', line: '#9c9c9c', lineWidth: 1.5,
    from: 'Spatial Viewer · Planning_Portal_SEPP/251 Coastal Vulnerability Area',
  },
  sepp_coastal_wetlands: {
    group: 'coastal', title: 'Coastal wetlands', kind: 'fill', color: '#006fff', fillOpacity: 0.6, line: '#002474', lineWidth: 0.5,
    from: 'Spatial Viewer · Planning_Portal_SEPP/35 Coastal Wetlands',
  },
  sepp_coastal_wetlands_proximity: {
    group: 'coastal', title: 'Coastal wetlands proximity area', kind: 'fill', color: '#0070ff', hatch: 'bdiag', line: '#004da8', lineWidth: 1,
    from: 'Spatial Viewer · Planning_Portal_SEPP/35 Coastal Wetlands Proximity Area',
  },
  sepp_littoral_rainforest: {
    group: 'coastal', title: 'Littoral rainforest', kind: 'fill', color: '#38a800', fillOpacity: 0.6, line: '#267300', lineWidth: 0.5,
    from: 'Spatial Viewer · Planning_Portal_SEPP/34 Littoral Rainforest',
  },
  sepp_littoral_rainforest_proximity: {
    group: 'coastal', title: 'Littoral rainforest proximity area', kind: 'fill', color: '#38a800', hatch: 'bdiag', line: '#38a800', lineWidth: 1,
    from: 'Spatial Viewer · Planning_Portal_SEPP/34 Littoral Rainforest Proximity Area',
  },
  // Coloured by band in the portal's ANEF_CODE colours - the Defence "25 +" style bands and the Sydney Airport
  // ANEI contours take the colour of the band with the same number. HOW STRONGLY a contour is drawn is the
  // verdict against the policy (scripts/add-lmr-noise-bands.mjs): filled where excluded (ANEF 25+, ANEC 20+),
  // half where the data cannot say (Defence 20-25, every ANEI, Gloucester's unnumbered contours), and only a
  // faint outline where it is not excluded (ANEF 20-25, Defence 15-20) - see VERDICT_OPACITY in lmr.vue.
  airport_noise: {
    group: 'noise', title: 'Aircraft noise contours (ANEF / ANEI)', kind: 'fill', color: '#b0b0b0', fillOpacity: 0.55, line: '#6e6e6e', lineWidth: 0.4,
    classes: {
      '15 - 20': '#f0f0d8', '20 - 25': '#ffffbe', 'ANEI 20': '#ffffbe', '25 - 30': '#ffd500', '25 +': '#ffd500', 'ANEI 25': '#ffd500',
      '30 - 35': '#ffa0a0', '30 +': '#ffa0a0', 'ANEI 30': '#ffa0a0', '35 - 40': '#f56464', '35 +': '#f56464', 'ANEI 35': '#f56464',
      '40 +': '#e60000', 'Low Noise': '#b0b0b0', 'High Noise': '#6e6e6e',
    },
    from: 'Spatial Viewer · Planning_Portal_Protection/235 Airport Noise',
  },
  gas_pipelines: { group: 'noise', title: 'Gas pipelines', kind: 'line', color: '#a900e6', lineWidth: 2.2, from: 'REI/Topo_Infrastructure/16 Gas_Pipeline (the NSW renewable energy viewer)' },
  // the 200 m the Low and Mid-Rise Housing Policy excludes, drawn like a proximity area: the pipeline's colour, faint, dashed
  gas_pipelines_buffer_200m: {
    group: 'noise', title: 'Gas pipelines, 200 m buffer', kind: 'fill', color: '#a900e6', fillOpacity: 0.15, line: '#a900e6', lineWidth: 1.2, dashed: true,
    from: 'ours - the pipeline colour, faint and dashed',
  },
  oil_pipelines: { group: 'noise', title: 'Oil pipelines (none in NSW)', kind: 'line', color: '#732600', lineWidth: 2.2, from: 'REI/Topo_Infrastructure/17 Petroleum_Pipeline (the NSW renewable energy viewer)' },
  oil_pipelines_buffer_200m: {
    group: 'noise', title: 'Oil pipelines, 200 m buffer (none in NSW)', kind: 'fill', color: '#732600', fillOpacity: 0.12, line: '#732600', lineWidth: 1.2, dashed: true,
    from: 'ours - the pipeline colour, faint and dashed',
  },
}


const FALLBACK_CONSTRAINT: ConstraintStyle = { group: 'noise', title: '', kind: 'fill', color: '#94a3b8', fillOpacity: 0.3, line: '#475569', lineWidth: 1 }

export function constraintStyle(key: string): ConstraintStyle {
  return CONSTRAINT_STYLE[key] ?? FALLBACK_CONSTRAINT
}

/** A legend swatch for a constraint layer, or one of its categories. */
export function constraintSwatchCss(key: string, category?: string | null): Record<string, string> {
  const s = constraintStyle(key)
  const fill = (category && s.classes?.[category]) || s.color
  if (s.kind === 'point') return { background: fill, borderColor: '#ffffff', borderStyle: 'solid', borderRadius: '50%' }
  if (s.kind === 'line') return { background: 'transparent', borderColor: 'transparent', borderStyle: 'solid', boxShadow: `inset 0 -3px 0 ${fill}`, borderRadius: '0' }
  if (s.hatch) return { background: hatchCss(s.hatch, fill), borderColor: s.line ?? fill, borderStyle: s.dashed ? 'dashed' : 'solid' }
  // an unfilled layer is drawn as its outline, so its swatch is an outline too
  if (s.fillOpacity === 0) return { background: 'transparent', borderColor: fill, borderStyle: s.dashed ? 'dashed' : 'solid' }
  return {
    background: fill,
    borderColor: s.lineWidth ? (s.line ?? fill) : fill,
    borderStyle: s.dashed ? 'dashed' : 'solid',
    opacity: String(Math.max(0.55, (s.fillOpacity ?? 0.4) + 0.35)),
  }
}

export interface ConstraintLayer {
  key: string
  table: string
  group: ConstraintGroup
  title: string
  geometry: 'point' | 'linestring' | 'polygon'
  features: number
  minZoom: number
  bbox: [number, number, number, number] | null
  categories: { name: string; features: number }[]
  /** The table's own COMMENT: what it is, where it was copied from, and when. */
  comment: string | null
}

export interface ConstraintCatalogue {
  archive: string
  builtAt: string | null
  layers: ConstraintLayer[]
}

export interface LmrHit {
  key: string
  /** 'constraint' for a layer of the lmr schema; sepp is then the group title and layName the layer title. */
  family: LmrFamily | 'constraint'
  sepp: string
  layName: string
  layClass: string | null
  label: string | null
  clause: string | null
  lga: string | null
  commenced: string | null
}
