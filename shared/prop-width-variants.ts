/**
 * The two lot-metrics datasets /prop-width can be pointed at.
 *
 * Both are the same cadastral parcels with frontage metrics attached, and both
 * publish a matching `*_edges` layer keyed on `objectid`, so one page renders
 * either. They disagree about how the primary frontage is decided, which is the
 * reason for having both side by side:
 *
 *   lot_metrics_3     the original. Carries `min_width_m`.
 *   lot_metrics_gnaf  decides the primary road from the GNAF address — every
 *                     sampled feature reports `primary_road_basis: "address"` —
 *                     and states the basis on the row rather than leaving it
 *                     implied. It has no `min_width_m`; instead it publishes
 *                     three named widths and a `width_datum` saying which datum
 *                     they were measured from, plus `total_frontage_m` for lots
 *                     fronting more than one road.
 *
 * A row naming a field the layer does not publish would render as an em dash,
 * so the two lists are kept separate rather than merged and filtered.
 */

export interface LotRow {
  label: string
  /** Read off the tile feature as-is; `type` only decides how it is written. */
  field: string
  type?: 'number' | 'road' | 'bool' | 'text'
  unit?: string
  digits?: number
}

export interface PropWidthVariant {
  lotLayer: string
  edgeLayer: string
  title: string
  subtitle: string
  rows: LotRow[]
}

/** Shared by both — the fields that mean the same thing in each layer. */
const COMMON_TAIL: LotRow[] = [
  { label: 'Depth', field: 'lot_depth_m', unit: ' m' },
  { label: 'Area', field: 'area_sqm', unit: ' m²', digits: 0 },
  { label: 'Perimeter', field: 'perimeter_m', unit: ' m' },
  { label: 'Corner lot', field: 'is_corner_lot', type: 'bool' },
  { label: 'Battle-axe', field: 'is_battleaxe', type: 'bool' },
  { label: 'Frontage bearing', field: 'frontage_bearing_degrees', unit: '°', digits: 1 },
]

export const LOT_METRICS_3: PropWidthVariant = {
  lotLayer: 'lot_metrics_3',
  edgeLayer: 'lot_metrics_3_edges',
  title: 'Property width',
  subtitle: 'Frontage length and road name, on the boundary',
  rows: [
    { label: 'Frontages', field: 'num_frontages', type: 'text' },
    { label: 'Primary road', field: 'primary_frontage_road', type: 'road' },
    { label: 'Primary frontage', field: 'primary_frontage_length_m', unit: ' m' },
    { label: 'Min width', field: 'min_width_m', unit: ' m' },
    ...COMMON_TAIL,
  ],
}

export const LOT_METRICS_GNAF: PropWidthVariant = {
  lotLayer: 'lot_metrics_gnaf',
  edgeLayer: 'lot_metrics_gnaf_edges',
  title: 'Property width — GNAF',
  subtitle: 'lot_metrics_gnaf: primary road resolved from the address',
  rows: [
    { label: 'Frontages', field: 'num_frontages', type: 'text' },
    { label: 'Primary road', field: 'primary_frontage_road', type: 'road' },
    { label: 'Primary frontage', field: 'primary_frontage_length_m', unit: ' m' },
    { label: 'Total frontage', field: 'total_frontage_m', unit: ' m' },
    // Why that road was called the primary one, and which address it came from.
    { label: 'Primary road basis', field: 'primary_road_basis', type: 'text' },
    { label: 'Address road', field: 'address_primary_road', type: 'road' },
    // Three widths rather than one, and the datum they were taken from.
    { label: 'Width (core)', field: 'lot_width_min_core_m', unit: ' m' },
    { label: 'Width (setback)', field: 'lot_width_setback_m', unit: ' m' },
    { label: 'Width (bbox)', field: 'lot_width_bbox_m', unit: ' m' },
    { label: 'Width datum', field: 'width_datum', type: 'text' },
    ...COMMON_TAIL,
    { label: 'Road bearing', field: 'road_bearing_degrees', unit: '°', digits: 1 },
  ],
}
