/**
 * The map layers of /build-to-rent and /affordable-housing: each one a dataset a clause is read from, so the
 * panel is the legend and every swatch names its clause.
 *
 * Served by /api/housing/features as GeoJSON clipped to the view - none of these needs a tile archive at the
 * zooms it is shown from. `minZoom` is what keeps that true: the bus isochrones are 66k polygons and only
 * drawn close in. The SQL for each key lives in that route; this file is what the page needs to draw it.
 */

export type HousingPage = 'btr' | 'ahb'

export interface HousingLayer {
  key: string
  title: string
  clause: string
  blurb: string
  pages: HousingPage[]
  /** On when the page opens. */
  defaultOn: HousingPage[]
  fill: string
  fillOpacity: number
  line: string
  lineWidth: number
  dashed?: boolean
  minZoom: number
  table: string
}

export const HOUSING_LAYERS: HousingLayer[] = [
  // ── where build-to-rent is permitted ─────────────────────────────────────
  {
    key: 'btr_zones', title: 'Zones E2, MU1, B3, B4, B8, SP5', clause: '72(2)(a)(ia)–(v)',
    blurb: 'Build-to-rent is permitted here by the zone alone, whatever the LEP says.',
    pages: ['btr'], defaultOn: ['btr'],
    fill: '#7c3aed', fillOpacity: 0.28, line: '#6d28d9', lineWidth: 1, minZoom: 11,
    table: 'epi.epi_land_zoning',
  },
  {
    key: 'tod_areas', title: 'Transport Oriented Development Areas', clause: '72(2)(a1) · 15C(1)(a)',
    blurb: 'Chapter 5. Residential flat buildings are permitted in their R1-R4 and E1 land (s 154).',
    pages: ['btr', 'ahb'], defaultOn: ['btr'],
    fill: '#004da8', fillOpacity: 0.3, line: '#004da8', lineWidth: 1, minZoom: 11,
    table: 'lmr.sepp_tod_areas',
  },
  {
    key: 'lmr_area', title: 'Low and mid rise housing (our LMR layer)', clause: '72(2)(a2) · 15C(1)(a)',
    blurb: 'Lots Chapter 6 reaches and does not exclude, dissolved by band. Whether MDH, RFB or shop top housing is permissible is decided per lot.',
    pages: ['btr', 'ahb'], defaultOn: ['btr'],
    fill: '#e6a100', fillOpacity: 0.25, line: '#b45309', lineWidth: 0.8, minZoom: 10,
    table: 'lmr.lmr_area',
  },
  {
    key: 'westconnex', title: 'WestConnex Dive Site', clause: '72(2)(c)',
    blurb: 'Named on the State Significant Development Sites Map.',
    pages: ['btr'], defaultOn: ['btr'],
    fill: '#0d9488', fillOpacity: 0.45, line: '#0f766e', lineWidth: 2, minZoom: 5,
    table: 'epi.epi_state_significant_dev_sites',
  },

  // ── the bonus: location ──────────────────────────────────────────────────
  {
    key: 'iso_train', title: 'Stations: 800 m walking', clause: '15C(1)(c)(i)',
    blurb: 'Operational railway, metro and light rail stops (Mapbox walking isochrones, notebook 24). Counts inside the Six Cities.',
    pages: ['ahb'], defaultOn: ['ahb'],
    fill: '#16a34a', fillOpacity: 0.22, line: '#15803d', lineWidth: 1, minZoom: 10,
    table: 'access.iso_train',
  },
  {
    key: 'iso_bus', title: 'Bus stops: 400 m walking', clause: '15C(1)(c)(i)',
    blurb: 'Every boarding point (Mapbox walking isochrones, notebook 24). A lot inside one counts as in an accessible area.',
    pages: ['ahb'], defaultOn: ['ahb'],
    fill: '#84cc16', fillOpacity: 0.05, line: '#65a30d', lineWidth: 0.6, dashed: true, minZoom: 14,
    table: 'access.iso_bus',
  },
  {
    key: 'relevant_zones', title: 'Zones E1, E2, MU1, B1, B2, B4', clause: '15C(1)(c)(ii), 15C(3)',
    blurb: 'Outside the Six Cities, the bonus needs 800 m walking distance of one of these.',
    pages: ['ahb'], defaultOn: ['ahb'],
    fill: '#2563eb', fillOpacity: 0.25, line: '#1d4ed8', lineWidth: 1, minZoom: 11,
    table: 'epi.epi_land_zoning',
  },

  // ── the bonus: exclusions ────────────────────────────────────────────────
  {
    key: 'atod', title: 'Accelerated TOD Precincts', clause: '15C(2A)(a)',
    blurb: 'No in-fill affordable housing bonus.',
    pages: ['ahb'], defaultOn: ['ahb'],
    fill: '#df73ff', fillOpacity: 0.5, line: '#c500ff', lineWidth: 1.5, minZoom: 5,
    table: 'lmr.sepp_tod_accelerated_precincts',
  },
  {
    key: 'ssd_excluded', title: 'Warrawong and Kanwal Sites', clause: '15C(2A)(b)–(c)',
    blurb: 'Named on the State Significant Development Sites Map.',
    pages: ['ahb'], defaultOn: ['ahb'],
    fill: '#dc2626', fillOpacity: 0.45, line: '#991b1b', lineWidth: 2, minZoom: 5,
    table: 'epi.epi_state_significant_dev_sites',
  },
  {
    key: 'sop', title: 'Sydney Olympic Park', clause: '15C(2A)',
    blurb: 'The Central River City SEPP land application area. The exclusion\'s wording is later than our copy and not yet read.',
    pages: ['ahb'], defaultOn: ['ahb'],
    fill: '#dc2626', fillOpacity: 0.3, line: '#991b1b', lineWidth: 1.5, dashed: true, minZoom: 5,
    table: 'epi.epi_land_application',
  },
]

export function layersFor(page: HousingPage): HousingLayer[] {
  return HOUSING_LAYERS.filter(l => l.pages.includes(page))
}
