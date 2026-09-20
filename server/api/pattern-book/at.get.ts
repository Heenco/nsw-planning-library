/**
 * Which Pattern Book designs a lot can take, measured rather than looked up.
 *
 *   /api/pattern-book/at?cadid=123456
 *
 * /report answers this from d_4's stored flags. This recomputes it from the lot itself: the area and
 * width that "02C - Lot profile with frontage" measured, the slope that 03 measured, whether the lot is
 * a corner, and whether it sits in a transport oriented development precinct - tested against the
 * thresholds in shared/pattern-book.ts, which is the Pattern Book's own table.
 *
 * THE ONE THING IT CANNOT DECIDE, AND WHY IT SAYS SO INSTEAD OF GUESSING
 *
 * Every design's `areaLogic` turns on whether the lot is in a low and mid-rise housing area, and
 * planningai does not hold one. `in_lmr_housing_area` comes from urbanportaldbp.lmr_base, which is
 * d_4's own source; the inputs are all in the lmr schema but nobody has built the area from them, and
 * the one that exists applies no exclusions at all.
 *
 * So this endpoint does not pick. Every design carries its blocks already - `In an LMR area` and
 * `Outside an LMR area` - and both are evaluated and returned. A design whose thresholds the lot clears
 * either way is a real answer; one that turns on the branch is reported as turning on it. That is more
 * use on a testing page than a single number resting on a flag we did not compute.
 *
 * TOD IS computed, because the precinct map is a layer we hold (lmr.sepp_tod_areas). So a design gated
 * on `lmr_or_tod` can be settled outright whenever the lot is in a precinct.
 *
 * SLOPE IS MEASURED IN MAGNITUDE ONLY. The designs distinguish up-slope, down-slope and cross-fall;
 * derived.lot_slope carries mean/min/max gradient without direction. Each directional limit is
 * therefore tested against the lot's maximum gradient, which is the conservative reading - it can call
 * a lot short that a directional measure would pass, never the other way round - and the check says so.
 */
import { PATTERN_DESIGNS, type PatternDesign } from '#shared/pattern-book'
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface PatternCheck {
  label: string
  /** What the lot has. Null when nothing measured it. */
  actual: number | null
  required: number
  unit: string
  /** null when `actual` is null - unknown is not the same as failed. */
  pass: boolean | null
  note?: string
}

export interface PatternBlockResult {
  block: string
  checks: PatternCheck[]
  /** true only when every check passed; null when any is unknown. */
  qualifies: boolean | null
}

export interface PatternDesignResult {
  key: string
  category: string
  designer: string
  requiredUse: string
  areaLogic: string
  areaWords: string
  requiresCornerLot: boolean
  /** Settled from the TOD layer where the design's gate allows it; null when it turns on the LMR area. */
  areaGate: boolean | null
  areaGateWhy: string
  blocks: PatternBlockResult[]
}

export interface PatternBookAtResponse {
  lot: {
    cadid: string | null
    lotId: string | null
    areaM2: number | null
    widthM: number | null
    widthBasis: string | null
    isCorner: boolean | null
    maxSlopePct: number | null
    meanSlopePct: number | null
    inTod: boolean
  }
  designs: PatternDesignResult[]
  summary: {
    /** Designs the lot clears whichever way the LMR question goes. */
    qualifiesEitherWay: number
    /** Designs it clears only inside an LMR area. */
    onlyInLmr: number
    /** Designs ruled out on measurements alone, whatever the LMR answer. */
    ruledOut: number
    /** Designs that could not be decided because something was not measured. */
    unknown: number
    total: number
  }
  /** What stopped a full answer, named rather than left as a silent null. */
  caveats: string[]
  ms: number
}

const num = (v: any): number | null => (v == null || v === '' ? null : Number(v))

function check(label: string, actual: number | null, required: number, unit: string, ok: (a: number) => boolean, note?: string): PatternCheck {
  return { label, actual, required, unit, pass: actual == null ? null : ok(actual), note }
}

/** Every threshold in one block, against what the lot measured. */
function evaluateBlock(d: PatternDesign, b: any, lot: any): PatternBlockResult {
  const checks: PatternCheck[] = [
    check('Lot size', lot.areaM2, b.minLotSizeM2, 'm²', a => a >= b.minLotSizeM2),
    check('Lot width', lot.widthM, b.minLotWidthM, 'm', a => a >= b.minLotWidthM,
      lot.widthBasis ? `measured as ${lot.widthBasis}` : undefined),
  ]
  const s = b.slopes ?? {}
  /*
   * Slope is the weakest check here, and the note has to carry why.
   *
   * The Pattern Book's limits are about the ground a house stands on. derived.lot_slope measures the
   * WHOLE parcel and has no direction, so a directional limit can only be read against the steepest
   * gradient anywhere on the lot. On a suburban block those are close. On a 21-hectare rural lot they
   * are not - one gully takes the maximum to 20% while the mean is 2% - and the check then rejects a
   * design the building platform would clear. So the mean travels with the result and the note says
   * what was actually compared.
   */
  const slopeNote = lot.meanSlopePct == null
    ? 'the steepest gradient anywhere on the lot, not the building platform'
    : `the steepest gradient anywhere on the lot; its mean is ${lot.meanSlopePct.toFixed(1)}% - the limit `
      + 'is about the building platform, which this does not measure'
  for (const [k, label] of [['max_slope', 'Slope'], ['max_upslope', 'Up-slope'],
    ['max_downslope', 'Down-slope'], ['max_crossfall', 'Cross-fall']] as const) {
    if (s[k] == null) continue
    checks.push(check(label, lot.maxSlopePct, Number(s[k]), '%', a => a <= Number(s[k]),
      k === 'max_slope' ? slopeNote : `${slopeNote}; the slope data has no direction`))
  }
  if (d.requiresCornerLot) {
    checks.push({
      label: 'Corner lot', actual: null, required: 1, unit: '',
      pass: lot.isCorner == null ? null : lot.isCorner === true,
      note: lot.isCorner == null ? 'not measured' : lot.isCorner ? 'is a corner lot' : 'is not a corner lot',
    })
  }
  const anyUnknown = checks.some(c => c.pass === null)
  return { block: b.block, checks, qualifies: anyUnknown ? null : checks.every(c => c.pass) }
}

/** Whether the design's area gate can be settled without an LMR area, and what to say when it cannot. */
function areaGate(d: PatternDesign, inTod: boolean): { gate: boolean | null; why: string } {
  switch (d.areaLogic) {
    case 'any':
      return { gate: true, why: 'Available anywhere the use is permitted.' }
    case 'lmr_or_tod':
      return inTod
        ? { gate: true, why: 'In a transport oriented development precinct, so the gate is met whatever the LMR answer.' }
        : { gate: null, why: 'Not in a TOD precinct, so this turns on whether the lot is in an LMR area - which we do not hold.' }
    case 'lmr_and_tod':
      return inTod
        ? { gate: null, why: 'In a TOD precinct, but this also needs the lot to be in an LMR area - which we do not hold.' }
        : { gate: false, why: 'Needs both a TOD precinct and an LMR area; the lot is in no TOD precinct.' }
    case 'non_lmr_and_non_tod':
      return inTod
        ? { gate: false, why: 'Only applies outside a TOD precinct, and the lot is in one.' }
        : { gate: null, why: 'Outside a TOD precinct, but this also needs the lot to be OUTSIDE an LMR area - which we do not hold.' }
    case 'lmr_vs_non_lmr':
    default:
      return { gate: null, why: 'The thresholds differ inside and outside an LMR area; both are shown.' }
  }
}

export default defineEventHandler(async (event): Promise<PatternBookAtResponse> => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'Give a cadid' })
  setHeader(event, 'cache-control', 'public, max-age=60')

  const res = await nswQuery<any>(`
    SELECT l.cadid, l.lotidstring AS "lotId",
           ST_Area(l.geom::geography) AS "areaM2",
           p.lot_width_max_m, p.width_at_setback_m, p.core_width_min_m, p.is_corner_lot,
           s.max_slope_pct, s.mean_slope_pct,
           EXISTS (SELECT 1 FROM lmr.sepp_tod_areas t
                    WHERE t.geom && l.geom AND ST_Intersects(t.geom, l.geom)) AS in_tod
    FROM cadastre.lot l
    LEFT JOIN derived.lot_profile p ON p.cadid = l.cadid
    LEFT JOIN derived.lot_slope   s ON s.cadid = l.cadid
    WHERE l.cadid = $1 LIMIT 1`, [cadid])

  const r = res.rows[0]
  if (!r) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  // the Pattern Book measures the frontage width; width_at_setback_m is the one taken at the building
  // line, which is what the thresholds mean, with the lot's maximum as the fallback
  const widthM = num(r.width_at_setback_m) ?? num(r.lot_width_max_m)
  const widthBasis = r.width_at_setback_m != null ? 'width at the setback'
    : r.lot_width_max_m != null ? 'maximum lot width' : null

  const lot = {
    cadid: r.cadid, lotId: r.lotId, areaM2: num(r.areaM2), widthM, widthBasis,
    isCorner: r.is_corner_lot == null ? null : Boolean(r.is_corner_lot),
    maxSlopePct: num(r.max_slope_pct), meanSlopePct: num(r.mean_slope_pct),
    inTod: Boolean(r.in_tod),
  }

  const designs: PatternDesignResult[] = PATTERN_DESIGNS.map((d) => {
    const { gate, why } = areaGate(d, lot.inTod)
    return {
      key: d.key, category: d.category, designer: d.designer, requiredUse: d.requiredUse,
      areaLogic: d.areaLogic, areaWords: d.areaWords, requiresCornerLot: d.requiresCornerLot,
      areaGate: gate, areaGateWhy: why,
      blocks: d.blocks.map(b => evaluateBlock(d, b, lot)),
    }
  })

  // a design "qualifies either way" only when every block it could fall under passes; one that passes
  // in an LMR area and fails outside is reported as turning on the branch, not as a pass
  const verdict = (d: PatternDesignResult) => {
    if (d.areaGate === false) return 'ruledOut'
    const qs = d.blocks.map(b => b.qualifies)
    if (qs.some(q => q === null)) return 'unknown'
    if (qs.every(q => q === true)) return d.areaGate === true ? 'qualifiesEitherWay' : 'qualifiesEitherWay'
    if (qs.some(q => q === true)) return 'onlyInLmr'
    return 'ruledOut'
  }
  const tally = { qualifiesEitherWay: 0, onlyInLmr: 0, ruledOut: 0, unknown: 0 }
  for (const d of designs) tally[verdict(d) as keyof typeof tally]++

  const caveats: string[] = [
    'No low and mid-rise housing area is held in planningai, so every design gated on one is shown both ways rather than decided.',
  ]
  if (lot.maxSlopePct == null) caveats.push('No slope has been measured for this lot, so every slope check is unknown.')
  else if (lot.meanSlopePct != null && lot.maxSlopePct > lot.meanSlopePct * 3 && lot.maxSlopePct > 10) {
    caveats.push(`Slope is judged on this lot's steepest gradient (${lot.maxSlopePct.toFixed(1)}%) while its mean `
      + `is ${lot.meanSlopePct.toFixed(1)}%. On a lot that uneven it will rule out designs a building platform `
      + 'would clear - read every slope failure below as a prompt to look, not as an answer.')
  }
  else if (lot.meanSlopePct != null && lot.maxSlopePct > lot.meanSlopePct * 3 && lot.maxSlopePct > 10) {
    caveats.push(`Slope is judged on the lot's steepest gradient (${lot.maxSlopePct.toFixed(1)}%) while its mean is `
      + `${lot.meanSlopePct.toFixed(1)}%. On a lot this uneven that is likely to rule out designs a building `
      + 'platform would clear - treat every slope failure here as a prompt to look, not an answer.')
  }
  if (widthM == null) caveats.push('No width has been measured for this lot, so every width check is unknown.')
  if (lot.isCorner == null) caveats.push('Whether this is a corner lot has not been measured.')
  caveats.push('The use each design needs is not tested here - check it against the zone\'s Land Use Table above.')

  return { lot, designs, summary: { ...tally, total: designs.length }, caveats, ms: Date.now() - started }
})
