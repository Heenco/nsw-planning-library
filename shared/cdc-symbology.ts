/**
 * How each /cdc-map layer is drawn: the NSW Planning Portal Spatial Viewer's own symbol where it has one,
 * so a layer reads here the way it reads on the map people already check a property against.
 *
 * Every `from` names the ArcGIS layer the symbol was read from (mapprod3.environment.nsw.gov.au, the
 * renderer in its drawingInfo, swept 2026-09-27). "ours" means the Spatial Viewer does not carry the layer
 * - the dataset came from BCT, EPA, Forestry, DCCEEW or was derived here - and the colour was chosen to sit
 * with its neighbours: water blue-green, vegetation green, contamination rust, tenure earth.
 *
 * `by` says which tile property a category renderer keys on. The tiles carry `name` and `class` from the
 * cdc views, and that is not always the field ePlanning keys on:
 *   class  lay_class - heritage, acid sulfate, flood, foreshore, riparian, native vegetation ...
 *   name   bush fire (d_category), ANEF (the view prefixes 'ANEF '), minimum lot size (the SYM_CODE letter)
 *   zone   zoning: the first word of `name`, because the view's name is 'SP2 Classified Road', not 'SP2'
 *
 * Colour of a hit is a different question and is not answered here: the verdict list and the caught overlay
 * are coloured by scope (what the clause rules out), because that is what the verdict is about.
 */
import { ZONE_COLOURS } from './lmr-layers'

/** ESRI simple-fill hatch styles, as the renderers name them. */
export type Hatch = 'bdiag' | 'fdiag' | 'vertical' | 'horizontal' | 'dcross'

export interface Sym {
  /** Fill colour; null for an outline-only symbol. With `hatch` it is the colour of the hatch lines. */
  fill?: string | null
  /** Outline colour; null for no outline. */
  line?: string | null
  /** Outline width in px. */
  width?: number
  hatch?: Hatch
}

export interface CdcSymbology extends Sym {
  from: string
  /** Fill opacity. The portal draws its layers opaque over a basemap; stacked here they need to let the lot show. */
  opacity?: number
  by?: 'class' | 'name' | 'zone'
  /** Per-category overrides of the base symbol, keyed on the `by` property. */
  classes?: Record<string, Sym>
}

const SV = 'Spatial Viewer'
const BLACK = '#000000'
const GREY = '#6e6e6e'

// ── category tables ──────────────────────────────────────────────────────────

/** Planning_Portal_Principal_Planning/22 Minimum Lot Size, by SYM_CODE letter. */
const LOT_SIZE: Record<string, string> = {
  A: '#c9fff9', B: '#99fffd', C: '#66f2ff', D: '#33daff', E: '#d3ffbf',
  F: '#c3f0aa', F1: '#c3f0aa', F2: '#c3f0aa',
  G: '#b4e096', G1: '#b4e096', G2: '#b4e096',
  H: '#a3d182', I: '#95c270', J: '#89b560',
  K: '#ffffbf', K1: '#ffffbf', K2: '#ffffbf',
  L: '#ffff00', M: '#dbdb00', N: '#edd8ad', O: '#e3c891', P: '#dbbb7b', Q: '#d1ac62', R: '#c79e4c',
  S: '#ffd9d9', S1: '#ffd9d9', S2: '#ffd9d9',
  T: '#ffa6a3',
  U: '#ff776e', U1: '#ff776e', U2: '#ff776e', U3: '#ff776e', U4: '#ff776e',
  V: '#ff483b', V1: '#ff483b', V2: '#ff483b',
  W: '#cc6666', W1: '#cc6666', W2: '#cc6666', W3: '#cc6666', W4: '#cc6666',
  X: '#e9bfff', X1: '#e9bfff', X2: '#e9bfff', X3: '#e9bfff', X4: '#e9bfff', X5: '#e9bfff',
  Y: '#d489fa', Y1: '#d489fa', Y2: '#d489fa', Y3: '#d489fa',
  Z: '#be51f0', Z1: '#be51f0', Z1A: '#be51f0', Z2: '#be51f0', Z3: '#be51f0', Z4: '#be51f0', Z5: '#be51f0',
  AA: '#ff73de', AA1: '#ff73de', AA2: '#ff73de', AA3: '#ff73de', AA4: '#ff73de', AA5: '#ff73de',
  AB: '#cc6699', AB1: '#cc6699', AB2: '#cc6699', AB3: '#cc6699', AB4: '#cc6699',
  AB5: '#cc6699', AB6: '#cc6699', AB7: '#cc6699', AB8: '#cc6699', AB9: '#cc6699',
  AC: '#ba5487', AC1: '#ba5487', AC2: '#ba5487', AC3: '#ba5487',
  AD: '#ffebad', AD1: '#ffebad', AD2: '#ffebad',
  AE: '#ffd68f', AE1: '#ffd68f', AE2: '#ffd68f',
  AF: '#ffc700', AG: '#ffaa00', AH: '#e69800',
  AI: '#ff8c00', AI1: '#ff8c00', AI2: '#ff8c00',
}

const fills = (m: Record<string, string>): Record<string, Sym> =>
  Object.fromEntries(Object.entries(m).map(([k, fill]) => [k, { fill }]))

/** Planning_Portal_Principal_Planning/16 EPI Heritage, by LAY_CLASS - items and conservation areas alike. */
const EPI_HERITAGE: Record<string, Sym> = {
  'Item - General': { fill: '#dbbb7b' },
  'Local Heritage - General': { fill: '#dbbb7b' },
  'Item - Archaeological': { fill: '#ffffbf' },
  'Item - Landscape': { fill: '#b3e096' },
  'Item - Aboriginal': { fill: '#ffc700' },
  'Aboriginal Object': { fill: '#ffc700' },
  'Aboriginal Place of Heritage Significance': { fill: null, line: '#ffc700', width: 1.5 },
  'Conservation Area - General': { fill: '#ff0000', line: '#ff0000', hatch: 'bdiag' },
  'Conservation Area - Landscape': { fill: '#38a800', line: '#38a800', hatch: 'bdiag' },
  'Conservation Area - Aboriginal': { fill: null, line: '#ffc700', width: 1.5 },
  'Conservation Area - Archaeological': { fill: '#e4df17', line: '#e4df17' },
  'Heritage Conservation Area': { fill: '#38a800', line: '#38a800', hatch: 'vertical' },
}

/** Local provisions coastal maps: Coastline Hazard (444) and Coastal Risk Planning (443), by LAY_CLASS. */
const COASTAL_RISK: Record<string, Sym> = {
  'Area of Reduced Foundation Capacity': { fill: '#1f6ee0', hatch: 'dcross' },
  'Area of Wave Impact and Slope Adjustment': { fill: '#e60000', hatch: 'dcross' },
  'Bluff/Cliff Instability': { fill: '#c79e4c' },
  'Wave Inundation': { fill: '#33daff' },
  'Coastal Erosion/Wave Inundation': { fill: '#95c270' },
}

/** River Front Building Line (553) and River Front Area (552). */
const RIVER_FRONT: Record<string, Sym> = {
  'River Front Building Line': { fill: '#e60000', line: '#e60000' },
  'River Front Building Line (Indicative)': { fill: '#e60000', line: '#e60000', hatch: 'bdiag' },
  'River Front Area': { fill: '#e87d1a', line: '#e87d1a' },
  'River Front Area - Refer to Clause 7.6': { fill: '#ffa1c9', line: '#ffa1c9' },
}

/** Clause 7.15-style buffer zones: the portal hatches a buffer black (Landfill Buffer Map, 495). */
const BUFFER: Sym = { fill: BLACK, line: BLACK, hatch: 'bdiag' }

const WATERCOURSE = '#00c5ea'
const RIPARIAN = '#b3e096'

// ── the layers ───────────────────────────────────────────────────────────────

export const CDC_SYMBOLOGY: Record<string, CdcSymbology> = {
  // hazard
  airport_development_area: { from: `${SV} · Local Provisions/421 Airport Development Area`, fill: '#c9fff9', line: BLACK, width: 0.8 },
  airport_noise: {
    from: `${SV} · Protection/235 Airport Noise (ANEF_CODE)`, by: 'name', opacity: 0.6,
    // a contour with no ANEF code is outlined only: the portal would not draw it at all
    fill: null, line: GREY, width: 0.6,
    classes: {
      'ANEF 20 - 25': { fill: '#ffffbe' }, 'ANEF ANEI 20 ': { fill: '#ffffbe' }, 'ANEF ANEI 20': { fill: '#ffffbe' },
      'ANEF 25 - 30': { fill: '#ffd500' }, 'ANEF ANEI 25': { fill: '#ffd500' },
      'ANEF 30 - 35': { fill: '#ffa0a0' }, 'ANEF ANEI 30': { fill: '#ffa0a0' },
      'ANEF 35 - 40': { fill: '#f56464' },
      'ANEF 40 +': { fill: '#e60000' },
      'ANEF RUNWAY': { fill: '#686868', line: '#373737' },
      'ANEF Low Noise': { fill: GREY, hatch: 'bdiag' },
      'ANEF High Noise': { fill: GREY, hatch: 'bdiag' },
    },
  },
  bushfire_prone_land: {
    from: `${SV} · Hazard/229 Bushfire Prone Land (Category)`, by: 'name', opacity: 0.45,
    fill: '#ff8000', line: null,
    classes: {
      'Vegetation Category 1': { fill: '#ff0000' },
      'Vegetation Category 2': { fill: '#ffd200' },
      'Vegetation Category 3': { fill: '#ff8000' },
      'Vegetation Buffer': { fill: '#ffff73' },
    },
  },
  coastal_hazard: { from: `${SV} · Local Provisions/441 Coastal Hazard Areas`, fill: '#a851ff', line: BLACK, width: 0.8 },
  coastline_hazard: {
    from: `${SV} · Local Provisions/444 Coastline Hazard + 443 Coastal Risk Planning`, by: 'class',
    fill: '#c748ff', line: BLACK, width: 0.8, classes: COASTAL_RISK,
  },
  flood_planning: {
    from: `${SV} · Hazard/230 Flood Planning Map (LAY_CLASS)`, by: 'class',
    fill: '#00c2ed', line: BLACK, width: 0.6,
    classes: {
      'Flood Prone and Major Creeks Land': { fill: '#73b2ff' },
      'Flood Planning Area': { fill: '#00c2ed' },
      '1 in 100 AEP Flood Extent': { fill: '#1976d2', line: null },
      'Area 1': { fill: '#002673', line: '#002673', hatch: 'bdiag' },
      'Transitional Land': { fill: '#ff52d7', line: '#ff52d7', hatch: 'bdiag' },
      'Level of Probable Maximum Flood': { fill: null, line: '#000aff', width: 2 },
      'Land Identified in Section 3.27': { fill: null, line: '#ff0000', width: 2 },
    },
  },
  flood_sfd_1aep: { from: `${SV} · SEPP/293 1 in 100 AEP Flood Extents`, fill: '#1976d2', line: '#1976d2', width: 0.4 },
  geotechnical: { from: `${SV} · SEPP/99 Geotechnical`, fill: '#d7c29e', line: '#734c00', width: 1 },
  landfill_buffer: { from: `${SV} · Local Provisions/495 Landfill Buffer`, ...BUFFER, width: 0.8 },
  landslide_risk: { from: `${SV} · Hazard/232 Landslide Risk Land`, fill: '#e69800', line: BLACK, width: 0.5 },
  mine_subsidence: { from: `${SV} · Subsidence Advisory/248 Mine Subsidence District`, fill: '#e6e600', line: BLACK, width: 0.5 },

  // nature
  biodiversity_stewardship: {
    // BCT sites are not in ePlanning: a deep conservation green, darker than terrestrial biodiversity
    from: 'ours - BCT stewardship sites are not in the Spatial Viewer', fill: '#2e7d32', line: '#1b5e20', width: 1,
  },
  critical_habitat: {
    from: `${SV} · BiodiversityValuesMap/1 (AOBV slice)`, fill: '#c29ed7', line: '#6a1b9a', width: 1.5,
  },
  crown_reserves: { from: `${SV} · Crown Land/312 Crown Reserves`, fill: '#4ce600', line: '#267300', width: 1, hatch: 'fdiag' },
  environmentally_sensitive_land: {
    from: `${SV} · Protection/245 Environmentally Sensitive Land (LAY_CLASS)`, by: 'class',
    fill: '#55ff00', line: '#55ff00', width: 0.8, hatch: 'bdiag',
    classes: {
      'Environmental Protection Land': { fill: '#55ff00', line: GREY, hatch: undefined },
      'Environmentally Significant Land': { fill: '#d1ff73', line: BLACK, hatch: undefined },
    },
  },
  aboriginal_significance: {
    from: `${SV} · Local Provisions/414, 557, 539 + Principal Planning/16`, by: 'class',
    fill: '#ffc700', line: BLACK, width: 0.8,
    classes: {
      ...EPI_HERITAGE,
      'Sensitive Aboriginal Landscape Area': { fill: '#00a884', line: '#00a884', hatch: 'bdiag' },
      'Potential Archaeological Site and Potential Place of Aboriginal Heritage Significance': { fill: '#f57a7a' },
    },
  },
  koala_core_habitat: {
    from: `${SV} · Local Provisions/490 Koala Management Plan (nearest ePlanning map)`, fill: '#89b560', line: BLACK, width: 0.5,
  },
  koala_corridor: { from: `${SV} · SEPP/788 Koala Corridors`, fill: '#d7c29e', line: '#686868', width: 2 },
  koala_habitat: { from: `${SV} · Local Provisions/489 Koala Habitat`, fill: '#b4d79e', line: '#8d9688', width: 0.8 },
  bct_agreement_lots: {
    from: 'ours - BCT agreement lots are not in the Spatial Viewer', fill: '#66bb6a', line: '#2e7d32', width: 0.6, hatch: 'fdiag',
  },
  npws_estate: { from: `${SV} · Protection/365 NPWS Estate`, fill: null, line: '#98e600', width: 1.5 },
  native_vegetation: {
    from: `${SV} · SEPP/142 Native Vegetation Protection (LAY_CLASS)`, by: 'class',
    fill: '#abcd66', line: BLACK, width: 0.6,
    classes: {
      'Existing native vegetation area': { fill: '#aaff00' }, 'Existing Native Vegetation Area': { fill: '#aaff00' },
      'Native vegetation retention area': { fill: '#38a800' }, 'Native Vegetation Retention Area': { fill: '#38a800' },
      'Native Vegetation Area': { fill: '#abcd66', line: null },
    },
  },
  private_native_forestry: {
    from: 'ours - PNF approvals are not in the Spatial Viewer', fill: '#8d6e3f', line: '#5d4037', width: 0.8, hatch: 'vertical',
  },
  scenic_protection: {
    from: `${SV} · Protection/242 Scenic Protection Land + SEPP/183 (significance)`, by: 'class',
    fill: '#ffa699', line: BLACK, width: 0.6,
    classes: {
      'Local significance': { fill: '#ffbee8' },
      'Regional significance': { fill: '#ffa77f' },
      'Significance beyond the region': { fill: '#73b2ff' },
    },
  },
  terrestrial_biodiversity: { from: `${SV} · Protection/243 Terrestrial Biodiversity`, fill: '#95c270', line: BLACK, width: 0.3, opacity: 0.45 },
  wilderness: { from: 'EDP/Identified_Wilderness (not an ePlanning layer)', fill: '#e3f2d5', line: GREY, width: 0.8, opacity: 0.7 },

  // water
  marine_protected_areas: {
    // the portal colours by zone type, which esa's copy does not carry; General Use is most of every park
    from: `${SV} · Protection/599 NSW Marine Protected Areas (General Use colour)`, fill: '#c2fbfe', line: '#4065eb', width: 1,
  },
  coastal_environment_area: { from: `${SV} · SEPP/37 Coastal Environment Area`, fill: '#bed2ff', line: null },
  coastal_vulnerability: { from: `${SV} · SEPP/251 Coastal Vulnerability Area`, fill: '#9c9c9c', line: '#9c9c9c', width: 1.5, hatch: 'bdiag' },
  coastal_wetlands: { from: `${SV} · SEPP/35 Coastal Wetlands`, fill: '#006fff', line: '#002474', width: 0.5 },
  drinking_water_catchment: { from: `${SV} · Protection/236 Drinking Water Catchment`, fill: '#8cf1fc', line: BLACK, width: 0.8 },
  foreshore_building_line: {
    from: `${SV} · Principal Planning/26 Foreshore Building Line (LAY_CLASS)`, by: 'class',
    fill: '#ff0000', line: '#ff0000', width: 0.8,
    classes: {
      'Foreshore Area': { fill: '#ff80c0' },
      'Foreshore Building Area': { fill: '#ff80c0' },
      'Land Below Foreshore Building Line': { hatch: 'bdiag' },
    },
  },
  groundwater_vulnerability: { from: `${SV} · Protection/237 Groundwater Vulnerability`, fill: '#99fffd', line: BLACK, width: 0.5 },
  hawkesbury_nepean: {
    from: `${SV} · SEPP/183 Hawkesbury-Nepean Riverine Scenic Area (LAY_CLASS)`, by: 'class',
    fill: '#ffa77f', line: BLACK, width: 0.8,
    classes: {
      'Local significance': { fill: '#ffbee8' },
      'Regional significance': { fill: '#ffa77f' },
      'Significance beyond the region': { fill: '#73b2ff' },
    },
  },
  littoral_rainforest: { from: `${SV} · SEPP/34 Littoral Rainforest`, fill: '#38a800', line: '#267300', width: 0.5 },
  ramsar_wetlands: {
    from: 'ours - Ramsar sites are not in the Spatial Viewer', fill: '#00897b', line: '#004d40', width: 1,
  },
  riparian_land: {
    from: `${SV} · Protection/240 Riparian Lands and Watercourses (LAY_CLASS)`, by: 'class',
    fill: RIPARIAN, line: BLACK, width: 0.4,
    classes: {
      ...Object.fromEntries([
        'Watercourse', 'Waterway', 'Category 1 Watercourse', 'Category 2 Watercourse', 'Category 3 Watercourse',
        'Protected-Watercourses', 'Key fish Habitat', 'Environmentally Sensitive Land',
      ].map(k => [k, { fill: WATERCOURSE }])),
      '10m': { fill: '#ff483b' },
      '30m': { fill: '#c651f0' },
    },
  },
  river_front: {
    from: `${SV} · Local Provisions/553 River Front Building Line, 552 River Front Area`, by: 'class',
    fill: '#e87d1a', line: '#e87d1a', width: 1, classes: RIVER_FRONT,
  },
  special_areas: { from: `${SV} · SEPP/127 Special Areas`, fill: '#ffd37f', line: BLACK, width: 0.5 },
  wetlands: { from: `${SV} · Protection/244 Wetlands`, fill: '#c9fff9', line: BLACK, width: 0.8 },
  // the 100 m proximity areas: the portal draws each as its parent's colour in a backward hatch
  marine_proximity: { from: `${SV} · proximity hatch, as SEPP/35`, fill: '#4065eb', line: '#4065eb', width: 1, hatch: 'bdiag' },
  ramsar_proximity: { from: 'ours - proximity hatch in the Ramsar colour', fill: '#00897b', line: '#00897b', width: 1, hatch: 'bdiag' },
  coastal_wetlands_proximity: { from: `${SV} · SEPP/35 Coastal Wetlands Proximity Area`, fill: '#0070ff', line: '#004da8', width: 1, hatch: 'bdiag' },
  littoral_rainforest_proximity: { from: `${SV} · SEPP/34 Littoral Rainforest Proximity Area`, fill: '#38a800', line: '#38a800', width: 1, hatch: 'bdiag' },
  world_heritage: { from: 'HMS/Heritage/19 World Heritage Areas NSW (not an ePlanning layer)', fill: '#00a884', line: GREY, width: 0.8 },

  // heritage
  heritage_conservation_areas: {
    from: `${SV} · Principal Planning/16 EPI Heritage (LAY_CLASS)`, by: 'class',
    fill: '#ff0000', line: '#ff0000', width: 0.8, hatch: 'bdiag', classes: EPI_HERITAGE,
  },
  heritage_items: {
    from: `${SV} · Principal Planning/16 EPI Heritage (LAY_CLASS)`, by: 'class',
    fill: '#dbbb7b', line: BLACK, width: 0.6, classes: EPI_HERITAGE,
  },
  heritage_points: {
    // SEPP/285 draws these with a picture marker; a heritage-brown dot is the nearest thing a style can say
    from: `${SV} · SEPP/285 Sydney Harbour Heritage (points)`, fill: '#a0522d', line: '#ffffff', width: 1,
  },
  shr_curtilage: { from: `${SV} · Principal Planning/221 State Heritage Register Curtilage`, fill: '#0070ff', line: GREY, width: 1, hatch: 'vertical' },

  // land
  acid_sulfate_soils: {
    from: `${SV} · Protection/234 Acid Sulfate Soils (LAY_CLASS)`, by: 'class',
    fill: '#ff00c5', line: BLACK, width: 0.5,
    classes: { 'Class 1': { fill: '#00c5ff' }, 'Class 2': { fill: '#ff00c5' } },
  },
  active_street_frontages: { from: `${SV} · Development Control/224 Active Street Frontages`, fill: null, line: '#ff0000', width: 3 },
  asbestos_encapsulation: { from: 'ePlanningHistoric/41 Asbestos Encapsulation Area Map', fill: null, line: '#005ce6', width: 2 },
  contamination_sites: {
    // context: every notified site, drawn quietly so the filtered exclusion below reads over it
    from: 'ours - EPA notified sites are not in the Spatial Viewer', fill: '#d7a86e', line: '#8d5524', width: 0.6, opacity: 0.4,
  },
  contaminated_land: {
    from: 'ours - the five regulated EPA statuses', fill: '#b23c17', line: '#7f1d1d', width: 1.2, hatch: 'dcross',
  },
  land_reservation: { from: `${SV} · Principal Planning/24 Land Reservation Acquisition`, fill: '#ffff73', line: BLACK, width: 0.8 },
  mineral_resource_land: { from: `${SV} · Protection/238 Mineral and Resource Land`, fill: '#cc6666', line: BLACK, width: 0.8 },

  // where each code applies
  tod_accelerated: { from: `${SV} · SEPP/759 Accelerated TOD Precincts`, fill: '#df73ff', line: '#c500ff', width: 0.8 },
  local_complying_exclusion: { from: `${SV} · SEPP/92 Complying Local Exclusion`, fill: '#d79e9e', line: '#a05a5a', width: 0.5 },
  catchments_georges_hawkesbury: {
    from: `${SV} · SEPP/147 Georges River Catchment, SEPP/157 Hawkesbury-Nepean Catchment`, by: 'class',
    fill: null, line: '#ff0000', width: 2,
    classes: {
      'Georges River Catchment': { fill: '#ffebe8', line: BLACK, width: 0.8 },
      'Hawkesbury Nepean Catchment': { fill: null, line: '#ff0000', width: 2 },
      'Hawkesbury-Nepean Sub-Catchments': { fill: '#ffa77f', line: '#ff5500', width: 2 },
    },
  },
  greenfield_housing_code: { from: `${SV} · Development Control/222 Greenfield Housing Code Area`, fill: '#ffbebe', line: '#ff0000', width: 1.5 },
  inland_code_area: {
    // derived from zoning in 69 named councils; ochre, the colour of the rural zones it is mostly made of
    from: 'ours - the Inland Code area is defined by council names, not a map', fill: '#e0b25c', line: '#9a6b16', width: 1, opacity: 0.35,
  },
  land_zoning: {
    from: `${SV} · Principal Planning/19 Land Zoning Map (SYM_CODE)`, by: 'zone',
    fill: '#cbd5e1', line: BLACK, width: 0.4, opacity: 0.6, classes: fills(ZONE_COLOURS),
  },
  local_provisions_hazard: {
    from: `${SV} · Local Provisions/444, 443, 553, 495 - the four named provisions`, by: 'class',
    fill: '#c748ff', line: BLACK, width: 0.8,
    classes: {
      ...COASTAL_RISK, ...RIVER_FRONT,
      'Buffer Zone': BUFFER, 'Buffer Zone (Cl 7.15)': BUFFER, 'Subject to Buffer Zone': BUFFER,
    },
  },
  lmr_exclusion: { from: `${SV} · SEPP/776 Low and Mid Rise Housing Exclusion`, fill: '#6b6b6b', line: '#3a3a3a', width: 1.2, hatch: 'bdiag' },
  lot_size: {
    from: `${SV} · Principal Planning/22 Minimum Lot Size (SYM_CODE)`, by: 'name',
    fill: null, line: '#33daff', width: 0.6, opacity: 0.6,
    // CA is 'Complex Area' in the renderer: outline only
    classes: { ...fills(LOT_SIZE), CA: { fill: null, line: '#33daff', width: 1.5 } },
  },
  tod_areas: { from: `${SV} · SEPP/752 Transport Oriented Development Sites`, fill: '#004da8', line: '#ffffff', width: 1.5, opacity: 0.4 },
}

const FALLBACK: CdcSymbology = { from: 'ours - no symbol recorded', fill: '#94a3b8', line: '#475569', width: 0.8 }

export function cdcSymbology(key: string): CdcSymbology {
  return CDC_SYMBOLOGY[key] ?? FALLBACK
}

/** The symbol one category draws with: the base, with the category's own values laid over it. */
export function cdcSymFor(key: string, category: string | null): Sym {
  const s = cdcSymbology(key)
  const own = category != null ? s.classes?.[classKey(s, category)] : undefined
  return { fill: s.fill, line: s.line, width: s.width, hatch: s.hatch, ...own }
}

/** A zoning category in the legend is the code, not the zone name the panel lists. */
function classKey(s: CdcSymbology, category: string): string {
  return s.by === 'zone' ? category.split(' ')[0]! : category
}

/** CSS for a legend swatch that looks like the map: a flat fill, or hatch lines, inside the outline colour. */
export function swatchCss(sym: Sym, opacity = 0.6): Record<string, string> {
  const fill = sym.fill ?? null
  const border = sym.line ?? fill ?? '#94a3b8'
  const style: Record<string, string> = { border: `1.5px solid ${border}` }
  if (!fill) {
    style.background = 'transparent'
  } else if (sym.hatch) {
    // stripes run across the gradient's direction, so a 45deg gradient draws '\'
    const angle = { bdiag: '45deg', fdiag: '135deg', vertical: '90deg', horizontal: '0deg', dcross: '45deg' }[sym.hatch]
    const lines = `repeating-linear-gradient(${angle}, ${fill} 0 1.5px, transparent 1.5px 4px)`
    style.background = sym.hatch === 'dcross'
      ? `${lines}, repeating-linear-gradient(135deg, ${fill} 0 1.5px, transparent 1.5px 4px)`
      : lines
  } else {
    style.background = withAlpha(fill, Math.max(opacity, 0.55))
  }
  return style
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// ── mapbox expressions ───────────────────────────────────────────────────────

const CLEAR = 'rgba(0,0,0,0)'

/** The tile property a layer's categories key on, as an expression. */
function propExpr(by: CdcSymbology['by']): any {
  if (by === 'zone') {
    // first word of name: 'SP2 Classified Road' -> 'SP2'. A trailing space makes index-of always find one.
    return ['let', 'n', ['concat', ['coalesce', ['get', 'name'], ''], ' '],
      ['slice', ['var', 'n'], 0, ['index-of', ' ', ['var', 'n']]]]
  }
  return ['coalesce', ['get', by ?? 'class'], '']
}

/**
 * One `match` on layer_key; inside it, for a layer with categories, a `match` on the category. `pick` turns
 * a resolved symbol into the paint value, so fill, line, width and pattern are all built the same way.
 */
export function byLayerExpr(keys: string[], pick: (s: Sym, layer: CdcSymbology) => any, fallback: any): any {
  if (!keys.length) return fallback
  const out: any[] = ['match', ['get', 'layer_key']]
  for (const key of keys) {
    const s = cdcSymbology(key)
    const base = pick({ fill: s.fill, line: s.line, width: s.width, hatch: s.hatch }, s)
    const entries = Object.entries(s.classes ?? {})
    if (!entries.length) { out.push(key, base); continue }
    const inner: any[] = ['match', propExpr(s.by)]
    for (const [value, own] of entries) {
      inner.push(value, pick({ fill: s.fill, line: s.line, width: s.width, hatch: s.hatch, ...own }, s))
    }
    inner.push(base)
    out.push(key, inner)
  }
  out.push(fallback)
  return out
}

export const fillColour = (s: Sym) => (s.fill && !s.hatch ? s.fill : CLEAR)
export const lineColour = (s: Sym) => s.line ?? CLEAR
export const lineWidth = (s: Sym) => (s.line ? Math.max(s.width ?? 0.8, 0.4) : 0)
export const patternId = (s: Sym) => (s.fill && s.hatch ? hatchId(s.hatch, s.fill) : HATCH_NONE)

export const HATCH_NONE = 'cdc-hatch-none'
export const hatchId = (h: Hatch, colour: string) => `cdc-hatch-${h}-${colour.replace('#', '')}`

/** Every hatch image the layers need, so the page can register them before drawing. */
export function hatchesNeeded(keys: string[]): { id: string; hatch: Hatch; colour: string }[] {
  const seen = new Map<string, { id: string; hatch: Hatch; colour: string }>()
  for (const key of keys) {
    const s = cdcSymbology(key)
    for (const own of [{}, ...Object.values(s.classes ?? {})]) {
      const sym: Sym = { fill: s.fill, hatch: s.hatch, ...own }
      if (sym.fill && sym.hatch) {
        const id = hatchId(sym.hatch, sym.fill)
        seen.set(id, { id, hatch: sym.hatch, colour: sym.fill })
      }
    }
  }
  return [...seen.values()]
}

/**
 * A hatch tile: lines of the colour on transparent, 16 px drawn at pixelRatio 2 so the spacing is 8 css px.
 * The lines wrap at the tile edge, so the pattern repeats without a seam.
 */
export function hatchImage(h: Hatch | 'none', colour: string): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  if (h === 'none') return { width: size, height: size, data }
  const n = parseInt(colour.slice(1), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const on = (x: number, y: number): boolean => {
    const d1 = (x - y + size) % size // '\' when drawn top-down
    const d2 = (x + y) % size // '/'
    switch (h) {
      case 'bdiag': return d1 < 2
      case 'fdiag': return d2 < 2
      case 'vertical': return x % size < 2
      case 'horizontal': return y % size < 2
      case 'dcross': return d1 < 2 || d2 < 2
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!on(x, y)) continue
      const i = (y * size + x) * 4
      data[i] = rgb[0]!; data[i + 1] = rgb[1]!; data[i + 2] = rgb[2]!; data[i + 3] = 235
    }
  }
  return { width: size, height: size, data }
}
