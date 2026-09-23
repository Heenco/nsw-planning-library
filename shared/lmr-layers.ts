/**
 * The layers on /lmr: SEPP land application layers from the All-EPI geodatabase (epi.epi_land_application),
 * baked into a PMTiles archive by scripts/build-sepp-pmtiles.py. Shared by the page and /api/lmr/*.
 *
 * A layer is one (SEPP, lay_name) pair - "SEPP Land Application" alone is a lay_name in eleven SEPPs - and its
 * key is the layer_key property on every tile feature.
 *
 * COLOUR
 *
 * The four Low and Mid Rise layers follow the NSW Planning Portal's own LMR legend, so the page reads the same
 * as the map people already know:
 *   LMR Centre (our Town Centre)                    very light blue fill, dark purple outline
 *   TOD Accelerated Rezoning Area (Accelerated TOD) mauve fill, dark grey outline
 *   TOD Area                                        light pink-mauve fill, no outline
 *   Low and Mid Rise Housing Exclusion              grey diagonal hatch, dark outline
 * The portal's other two entries, LMR Station and Indicative LMR Housing Area, are not in the SEPP land
 * application data, so they are not on this page.
 *
 * Every other SEPP layer takes the colour of its family and draws with a dashed outline, so it is never told
 * apart from an LMR layer by colour alone; every layer is also named in the panel and in the click popup.
 */

export type LmrFamily = 'lmr' | 'housing' | 'precincts' | 'environment' | 'systems'

export const LMR_LAYER_NAMES = [
  'Transport Oriented Development Area',
  'Town Centre',
  'Low and Mid Rise Housing Exclusion Area',
  'Accelerated TOD Precinct',
] as const

export interface LmrStyle {
  /** The name the NSW Planning Portal's legend uses. */
  portalName: string
  fill: string
  fillOpacity: number
  line: string
  lineWidth: number
  /** Drawn as a diagonal hatch rather than a flat fill. */
  hatch?: boolean
}

/** LMR layers by lay_name: the Planning Portal's legend, sampled from its symbols. */
export const LMR_STYLE: Record<string, LmrStyle> = {
  'Transport Oriented Development Area': { portalName: 'TOD Area', fill: '#d4acd0', fillOpacity: 0.85, line: '#d4acd0', lineWidth: 0.5 },
  'Town Centre': { portalName: 'LMR Centre', fill: '#e6eaf8', fillOpacity: 0.85, line: '#2f1c86', lineWidth: 2 },
  'Low and Mid Rise Housing Exclusion Area': { portalName: 'Low and Mid Rise Housing Exclusion', fill: '#6b6b6b', fillOpacity: 1, line: '#3a3a3a', lineWidth: 1.2, hatch: true },
  'Accelerated TOD Precinct': { portalName: 'TOD Accelerated Rezoning Area', fill: '#c296b9', fillOpacity: 0.85, line: '#4d4d4d', lineWidth: 2 },
}

const FALLBACK_STYLE: LmrStyle = { portalName: '', fill: '#cbd5e1', fillOpacity: 0.6, line: '#475569', lineWidth: 1 }

export function lmrStyle(layName: string): LmrStyle {
  return LMR_STYLE[layName] ?? FALLBACK_STYLE
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

/** The layer's outline colour: an LMR layer's portal outline, else its family colour. */
export function colorOf(layer: { family: LmrFamily; layName: string }): string {
  return layer.family === 'lmr' ? lmrStyle(layer.layName).line : FAMILY[layer.family].color
}

/** CSS for a legend swatch, matching the map: LMR fill + outline (or hatch), other layers a dashed family outline. */
export function swatchCss(layer: { family: LmrFamily; layName: string }): Record<string, string> {
  if (layer.family !== 'lmr') return { background: 'transparent', borderColor: FAMILY[layer.family].color, borderStyle: 'dashed' }
  const s = lmrStyle(layer.layName)
  return {
    borderColor: s.line,
    borderStyle: 'solid',
    background: s.hatch
      ? `repeating-linear-gradient(135deg, ${s.fill} 0 1.5px, #ffffff 1.5px 4px)`
      : s.fill,
  }
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
  coastal: { title: 'Coast and water', lead: 'The Resilience and Hazards SEPP coastal wetland, littoral rainforest and vulnerability maps, and the LEP drinking water catchment maps.' },
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
 * Constraint styling. Bush fire prone land uses the RFS's own category colours; the Planning Portal's LMR
 * Station is a grey dot. The rest take one hue family per group - heritage browns, flood blues, coastal greens,
 * noise purple, pipeline orange - with proximity areas and pipeline buffers drawn dashed, so two layers of
 * a group are never told apart by colour alone. Every layer is named in the panel and the click popup.
 *
 * The FRMSP catchments are the one layer in `hazards` that is not a hazard extent: they say which study
 * speaks for a catchment, not which land floods. They take an indigo the flood blues do not use, drawn
 * dashed and barely filled, so they never read as an extent - and are coloured by the kind of report.
 */
export const CONSTRAINT_STYLE: Record<string, ConstraintStyle> = {
  lmr_train_stations: { group: 'housing', title: 'LMR Station', portalName: 'LMR Station', kind: 'point', color: '#7a7a7a', defaultOn: true },
  // walking catchments: the portal's "Indicative LMR Housing Area" pale yellow for 800 m, a stronger amber for
  // 400 m drawn over it; town centres with a dashed outline so the two catchment layers stay apart
  station_walking_catchments: {
    group: 'housing', title: 'Station walking catchments (400 m, 800 m)', kind: 'fill', color: '#fde3ae', fillOpacity: 0.55,
    line: '#c9912f', lineWidth: 1, classes: { '800 m': '#fde3ae', '400 m': '#f5b95a' }, defaultOn: true,
  },
  town_centre_walking_catchments: {
    group: 'housing', title: 'Town centre walking catchments (400 m, 800 m)', kind: 'fill', color: '#fde3ae', fillOpacity: 0.55,
    line: '#c9912f', lineWidth: 1, dashed: true, classes: { '800 m': '#fde3ae', '400 m': '#f5b95a' }, defaultOn: true,
  },
  epi_land_zoning: {
    group: 'zoning', title: 'Land zoning (LEP and SEPP maps)', portalName: 'Land Zoning Map', kind: 'fill',
    color: '#cbd5e1', fillOpacity: 0.55, lineWidth: 0, classes: ZONE_COLOURS,
  },
  shr_curtilage: { group: 'heritage', title: 'State Heritage Register curtilage', kind: 'fill', color: '#8c2d19', fillOpacity: 0.35, line: '#8c2d19', lineWidth: 1.5 },
  epi_heritage_items: { group: 'heritage', title: 'Heritage items (LEP maps)', kind: 'fill', color: '#c98b4a', fillOpacity: 0.4, line: '#8a5a2b', lineWidth: 1 },
  bushfire_prone_land: {
    group: 'hazards', title: 'Bush fire prone land', kind: 'fill', color: '#f46d43', fillOpacity: 0.45, lineWidth: 0,
    classes: { 'Vegetation Category 1': '#e31a1c', 'Vegetation Category 2': '#fdae61', 'Vegetation Category 3': '#f46d43', 'Vegetation Buffer': '#ffe34d' },
  },
  flood_planning: { group: 'hazards', title: 'Flood planning (LEP maps)', kind: 'fill', color: '#2171b5', fillOpacity: 0.3, line: '#08519c', lineWidth: 1 },
  // flood_sfd_1aep, the other load of this same extent, is no longer drawn (2026-09-23), so this one is
  // titled plainly and solid rather than "second load" dashed against a first that is not on the page.
  flood_sfd_1aep_1: { group: 'hazards', title: '1% AEP flood extent (SFD)', kind: 'fill', color: '#6baed6', fillOpacity: 0.35, line: '#3182bd', lineWidth: 1 },
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
  },
  // Filled, unlike the FRMSP catchments: these do not nest - only 2 of the 117 overlap another by more
  // than 5% of their area and nothing stacks deeper than 2. A dark cyan, well below the group's lighter
  // #41b6c4 in lightness, so it is not read as a coastal vulnerability area.
  epi_drinking_water_catchments: { group: 'coastal', title: 'Drinking water catchment (LEP maps)', kind: 'fill', color: '#00838f', fillOpacity: 0.3, line: '#005662', lineWidth: 1.2 },
  sepp_coastal_vulnerability_areas: { group: 'coastal', title: 'Coastal vulnerability areas', kind: 'fill', color: '#41b6c4', fillOpacity: 0.35, line: '#1d91c0', lineWidth: 1.5 },
  sepp_coastal_wetlands: { group: 'coastal', title: 'Coastal wetlands', kind: 'fill', color: '#1b9e77', fillOpacity: 0.5, line: '#137259', lineWidth: 1 },
  sepp_coastal_wetlands_proximity: { group: 'coastal', title: 'Coastal wetlands proximity area', kind: 'fill', color: '#1b9e77', fillOpacity: 0.1, line: '#1b9e77', lineWidth: 1.2, dashed: true },
  sepp_littoral_rainforest: { group: 'coastal', title: 'Littoral rainforest', kind: 'fill', color: '#4d7d2a', fillOpacity: 0.55, line: '#3a5f1f', lineWidth: 1 },
  sepp_littoral_rainforest_proximity: { group: 'coastal', title: 'Littoral rainforest proximity area', kind: 'fill', color: '#4d7d2a', fillOpacity: 0.1, line: '#4d7d2a', lineWidth: 1.2, dashed: true },
  airport_noise: { group: 'noise', title: 'Aircraft noise contours (ANEF / ANEI)', kind: 'fill', color: '#8856a7', fillOpacity: 0.18, line: '#6e3f91', lineWidth: 1.2 },
  gas_pipelines: { group: 'noise', title: 'Gas pipelines', kind: 'line', color: '#e6550d', lineWidth: 2.2 },
  // the 200 m the Low and Mid-Rise Housing Policy excludes, drawn like a proximity area: the pipeline's colour, faint, dashed
  gas_pipelines_buffer_200m: { group: 'noise', title: 'Gas pipelines, 200 m buffer', kind: 'fill', color: '#e6550d', fillOpacity: 0.15, line: '#e6550d', lineWidth: 1.2, dashed: true },
  oil_pipelines: { group: 'noise', title: 'Oil pipelines (none in NSW)', kind: 'line', color: '#3d3d3d', lineWidth: 2.2 },
  oil_pipelines_buffer_200m: { group: 'noise', title: 'Oil pipelines, 200 m buffer (none in NSW)', kind: 'fill', color: '#3d3d3d', fillOpacity: 0.12, line: '#3d3d3d', lineWidth: 1.2, dashed: true },
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
