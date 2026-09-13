/**
 * Low and Mid-Rise Housing standards, resolved for a lot.
 *
 * A mirror of `landuse_config` in the Notebooks repo's `05_lmr.ipynb`, which
 * builds `urbanportaldbp.lmr_landuse_resolved` by exploding six rules across
 * the zones each applies to and the two distance bands.
 *
 * WHY THIS IS RE-DERIVED RATHER THAN READ
 *
 * The resolved table is one row per (LMR polygon x land use), and notebook 06
 * flattens it into the property table with `STRING_AGG(DISTINCT ...)` applied
 * to each column INDEPENDENTLY. The lists that arrive are therefore different
 * lengths in unrelated order, and cannot be zipped back into rows. A real lot
 * (26 Waratah Avenue Randwick, R3, 400 m):
 *
 *   lmr_landuse    (5)  Apartment, Shop top Housing, Manor Homes & Dual
 *                       Occupancies, Multi-dwelling houses, Multi-dwelling
 *                       (terraces) houses
 *   lmr_lotsize    (3)  500.0, 600.0, 450.0
 *   lmr_lot_width  (2)  18.0, 12.0
 *   lmr_fsr        (3)  0.65, 2.2, 0.7
 *   lmr_hob        (3)  24.0, 22.0, 9.5
 *
 * Five uses, three lot sizes, two widths. The ordering is not stable either —
 * R3 at 800 m produces 80 distinct orderings of the same five-use set across
 * lots. So the stored strings can confirm WHICH uses apply, and nothing more.
 * The standards are recomputed here from the zone and the band, which are the
 * two things the join actually keyed on.
 *
 * WHAT GATES IT
 *
 * Membership of a mapped LMR area, and nothing else. `lmr_base` is the area
 * geometry and the resolved table is an INNER JOIN onto it, so a lot outside
 * those polygons has no rows, no band and no standards. `in_lmr_housing_area`
 * is defined in the field catalogue as exactly "lmr_landuse not null", and the
 * two agree on all 5.4M rows with no exceptions in either direction.
 *
 * Zoning alone grants nothing: 2,849,934 lots are zoned R1-R4 and outside the
 * LMR area. Resolving on zone and distance without the flag would invent LMR
 * rights for every one of them.
 */

/** The distance bands, in metres from the station or centre. */
export type LmrBuffer = 400 | 800

export interface LmrRule {
  landUse: string
  zones: string[]
  /** Minimum lot size in m², or null where the policy sets none. */
  minLotSizeSqm: number | null
  minLotWidthM: number | null
  /** Floor space ratio by band. null means the policy states none for it. */
  fsr: Record<LmrBuffer, number | null>
  /** Height of building in metres by band. */
  hobM: Record<LmrBuffer, number | null>
}

/**
 * The six rules, verbatim from `landuse_config`.
 *
 * Apartment appears twice because R1/R2 and R3/R4 carry different standards —
 * in the notebook the join on `sym_code` routes each row to the right rule, and
 * the same split is kept here rather than collapsing them into one entry with a
 * conditional inside it.
 */
export const LMR_RULES: LmrRule[] = [
  {
    landUse: 'Apartment',
    zones: ['R1', 'R2'],
    minLotSizeSqm: 500, minLotWidthM: 12,
    fsr: { 400: 0.80, 800: 0.80 }, hobM: { 400: 9.5, 800: 9.5 },
  },
  {
    landUse: 'Apartment',
    zones: ['R3', 'R4'],
    minLotSizeSqm: null, minLotWidthM: null,
    fsr: { 400: 2.20, 800: 1.50 }, hobM: { 400: 22.0, 800: 17.5 },
  },
  {
    // Nothing is stated for the 800 m band, which is why both figures are null
    // there rather than repeated from the 400 m one.
    landUse: 'Shop top Housing',
    zones: ['R3', 'R4'],
    minLotSizeSqm: null, minLotWidthM: null,
    fsr: { 400: 2.20, 800: null }, hobM: { 400: 24.0, 800: null },
  },
  {
    landUse: 'Manor Homes & Dual Occupancies',
    zones: ['R1', 'R2', 'R3', 'R4'],
    minLotSizeSqm: 450, minLotWidthM: 12,
    fsr: { 400: 0.65, 800: 0.65 }, hobM: { 400: 9.5, 800: 9.5 },
  },
  {
    landUse: 'Multi-dwelling houses',
    zones: ['R1', 'R2', 'R3', 'R4'],
    minLotSizeSqm: 600, minLotWidthM: 12,
    fsr: { 400: 0.70, 800: 0.70 }, hobM: { 400: 9.5, 800: 9.5 },
  },
  {
    landUse: 'Multi-dwelling (terraces) houses',
    zones: ['R1', 'R2', 'R3', 'R4'],
    minLotSizeSqm: 500, minLotWidthM: 18,
    fsr: { 400: 0.70, 800: 0.70 }, hobM: { 400: 9.5, 800: 9.5 },
  },
]

/**
 * The bands a lot sits in.
 *
 * `buffer` is aggregated the same way everything else is, so a lot touching
 * both bands stores "800, 400" — 15,065 of them. The order carries no meaning,
 * so it is sorted, and both are kept: which part of the lot is in which band is
 * not recorded, and at 400 m an R3/R4 apartment gets FSR 2.20 and 22 m against
 * 1.50 and 17.5 m at 800 m. Choosing one silently would be choosing a number.
 */
export function parseLmrBuffers(raw: unknown): LmrBuffer[] {
  const out = new Set<LmrBuffer>()
  for (const part of String(raw ?? '').split(',')) {
    const n = Number(part.trim())
    if (n === 400 || n === 800) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Zone codes for a lot, as a list.
 *
 * A lot can span two zones, so `lzn_sym_code_p` reads "R2, C2" on 52,366 of
 * them. Splitting means an R2 half is still matched.
 */
export function parseZones(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map(z => z.trim().toUpperCase())
    .filter(Boolean)
}

export interface LmrResolvedStandard {
  landUse: string
  buffer: LmrBuffer
  zone: string
  minLotSizeSqm: number | null
  minLotWidthM: number | null
  fsr: number | null
  hobM: number | null
  /** True when this lot's own area clears the rule's minimum. */
  meetsLotSize: boolean | null
  /** True when this lot's own width clears the rule's minimum. */
  meetsLotWidth: boolean | null
}

export interface LmrResolution {
  /** False when the lot is outside every mapped LMR area — the whole answer. */
  inLmrArea: boolean
  buffers: LmrBuffer[]
  zones: string[]
  /** The zones that actually matched a rule, which is R1-R4 only. */
  matchedZones: string[]
  standards: LmrResolvedStandard[]
  /** Land uses named by the stored column, for cross-checking the derivation. */
  storedLandUses: string[]
}

/**
 * What the LMR policy permits on this lot, and under what standards.
 *
 * `inLmrArea` false is a complete answer, not an empty one: the policy does not
 * reach this lot. Callers should say so rather than render nothing.
 */
export function resolveLmr(row: Record<string, any> | null | undefined): LmrResolution {
  const inLmrArea = row?.in_lmr_housing_area === true
    || String(row?.in_lmr_housing_area ?? '').toLowerCase() === 'true'

  // `lmr_permissible` is the property report's alias for the same column.
  const storedLandUses = String(row?.lmr_landuse ?? row?.lmr_permissible ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  if (!inLmrArea) {
    return { inLmrArea: false, buffers: [], zones: [], matchedZones: [], standards: [], storedLandUses }
  }

  const buffers = parseLmrBuffers(row?.buffer)
  // lmr_sym_code is the zone the spatial join actually matched on, so it is
  // preferred; the lot's own zoning is the fallback for a row that predates it.
  const zones = parseZones(row?.lmr_sym_code ?? row?.lzn_sym_code_p)

  const areaSqm = Number(row?.area_sqm)
  /**
   * Frontage length, because that is what the pipeline calls lot width.
   *
   * `07 - Pattern book.ipynb` tests its min_lot_width against
   * `row.get('primary_frontage_length_m')`, so the stored `*_eligible` flags
   * were decided on that figure. Using `width` here — the width at the 4.5 m
   * setback line — would be a better measure of a lot and would disagree with
   * every eligibility flag the report shows beside it.
   */
  const widthM = Number(row?.primary_frontage_length_m)

  const standards: LmrResolvedStandard[] = []
  const matched = new Set<string>()
  for (const buffer of buffers) {
    for (const rule of LMR_RULES) {
      const zone = zones.find(z => rule.zones.includes(z))
      if (!zone) continue
      matched.add(zone)
      const minLot = rule.minLotSizeSqm
      const minWidth = rule.minLotWidthM
      standards.push({
        landUse: rule.landUse,
        buffer,
        zone,
        minLotSizeSqm: minLot,
        minLotWidthM: minWidth,
        fsr: rule.fsr[buffer],
        hobM: rule.hobM[buffer],
        meetsLotSize: minLot == null || !Number.isFinite(areaSqm) ? null : areaSqm >= minLot,
        meetsLotWidth: minWidth == null || !Number.isFinite(widthM) ? null : widthM >= minWidth,
      })
    }
  }

  return { inLmrArea: true, buffers, zones, matchedZones: [...matched], standards, storedLandUses }
}
