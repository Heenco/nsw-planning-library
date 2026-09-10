/**
 * Depth, width, and the access handle — measured by sweeping the lot from its
 * frontage rather than by offsetting its outline.
 *
 * THE PROBLEM THIS REPLACES
 *
 * `lot_metrics_3` derived every width and depth from the bounding box of the
 * whole lot, so a battle-axe's handle inflated its depth (55 m recorded against
 * a real 30 m) and collapsed its width (4 m against a real 20 m). `min_width_m`
 * came from `minimum_clearance`, which measures how far a vertex can move before
 * the geometry self-invalidates — vertex spacing, not width — so a plain 20x40 m
 * lot with survey vertices 1 cm apart returned 0.01 m and was flagged a
 * battle-axe. The G-NAF rebuild fixed both with a morphological opening.
 *
 * WHY A SWEEP AND NOT AN OPENING
 *
 * Two reasons, one of them only available now.
 *
 * An opening finds *any* thin part of a polygon. It cannot tell an access handle
 * from a narrow drainage strip at the rear, so a lot with a thin tail away from
 * the street reads as a battle-axe. Since the frontage is now known
 * topologically, a handle can be defined properly: a thin part **that contains
 * the frontage**. Thin and at the back is an irregular lot; thin and at the
 * street is a handle.
 *
 * And the opening's `handle_width_m` is `area / length` — the *mean* width. A
 * handle that pinches to 2.5 m but averages 4.2 m passes a 4 m DCP minimum on
 * that number. Compliance needs the minimum, which a sweep gives directly.
 *
 * HOW
 *
 * Rotate the lot so the primary frontage lies along X and depth runs +Y into the
 * lot, then step inwards measuring how wide the lot is at each depth:
 *
 *   depth   0.5   1.0   1.5  ...  8.0   8.5   9.0   9.5  ...
 *   width   4.1   3.9   3.6  ...  3.6   3.8  18.4  19.1  ...
 *           |<-------- handle -------->|  |<---- core ---->|
 *
 * Everything falls out of that one pass: the neck is the minimum over the handle
 * run, the handle area is the integral under it, and the core depth is what
 * remains — which is the depth that matters, because the handle is not buildable
 * and LEPs exclude it from lot size anyway.
 *
 * Needs only line-segment intersection, so it stays dependency-free like
 * frontage-topo.mjs and runs in a script, the server, or a test.
 */

import { localFrame } from './frontage-topo.mjs'

/**
 * Widest stem still called an access handle.
 *
 * Calibrated against a lot confirmed by hand: 1//DP199788, 6 George Street
 * Randwick, whose stem is 9.15 m. Across 142 sampled Randwick and Hornsby
 * parcels only three have a stem at all — 9.27 m, 9.29 m and 11.05 m — so 10 m
 * separates the confirmed case and its two neighbours-in-kind from the 139 lots
 * with no stem, at a cost of 2 in 142 (1.4%, against the 2.2% the old pipeline
 * reported statewide).
 *
 * Treat this as policy, not geometry, and a consequential one: a stem called a
 * handle is excluded from lot size, and on that 714 m2 lot the stem is 216 m2 —
 * 30% of it. `stem_width_m` is always reported, so a different threshold can be
 * applied to stored results without recomputing anything.
 *
 * Caveat on the calibration: the sample contained no classic 3-4 m driveway
 * handle, so the low end of this range is unverified against real data.
 */
export const HANDLE_MAX_WIDTH_M = 10.0

/**
 * Widest stem the sweep will *look* for, as opposed to call a handle.
 *
 * Finding the shape and judging it are separate jobs. 1//DP199788 — 6 George
 * Street, Randwick — runs 9.2 m wide for 24 m then opens to 15.6 m: an
 * unmistakable stem and head, but wider than any driveway. Detecting only up to
 * the policy width meant that lot came back "regular", which is plainly wrong,
 * while widening the policy width would call every narrow-fronted lot a
 * battle-axe. So the stem is always measured and reported, and `is_battleaxe`
 * is the stem width tested against HANDLE_MAX_WIDTH_M.
 */
export const STEM_MAX_WIDTH_M = 12.0

/** A nick in the boundary is not a handle; a handle is something you drive down. */
export const HANDLE_MIN_LENGTH_M = 5.0

/** The core must be meaningfully wider than the neck, or this is just a thin lot. */
export const CORE_MIN_WIDTH_M = 8.0
export const CORE_WIDEN_RATIO = 1.5

/**
 * How far in from the frontage to read the lot's width.
 *
 * LEPs say "the width of the lot at the front building line", and the building
 * line depends on the *proposed* setback, so it is not knowable from cadastre
 * alone — every one of the 147 NSW LEPs states the phrase without a measurement
 * rule. This is a stated proxy, not a derivation, which is why the depth it was
 * taken at travels with the number.
 *
 * A minimum width over the whole lot is not a substitute: a lot tapering to a
 * point has a minimum width near zero, which is true and useless.
 */
export const WIDTH_SETBACK_M = 4.5

/** Sweep step. 0.25 m resolves a neck to the centimetre without much work. */
export const SWEEP_STEP_M = 0.25

/**
 * When a narrow run reaching the far end is the lot closing to a point rather
 * than a strip of constant width.
 *
 * Reaching the end is not enough on its own: a 3 m rear access strip runs to the
 * boundary at constant width and is a real feature, while a triangular lot
 * closes to 0.08 m and is not. The distinction is whether it pinches out.
 */
export const TAPER_TIP_M = 1.0
export const TAPER_TIP_RATIO = 0.25

const rad = (d) => (d * Math.PI) / 180

/**
 * Total width of the polygon at depth `y`, and the spans making it up.
 *
 * More than one span means the lot has separate arms at that depth — a shape the
 * handle logic must not average over, so the count is kept.
 */
export function widthAt(ringLocal, y) {
  const xs = []
  for (let i = 0; i < ringLocal.length - 1; i++) {
    const [x1, y1] = ringLocal[i]
    const [x2, y2] = ringLocal[i + 1]
    if (y1 === y2) continue
    // Half-open test, so a vertex exactly on the line is counted once.
    if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
    }
  }
  xs.sort((a, b) => a - b)
  const spans = []
  let total = 0
  for (let i = 0; i + 1 < xs.length; i += 2) {
    spans.push([xs[i], xs[i + 1]])
    total += xs[i + 1] - xs[i]
  }
  return { total, spans }
}

/**
 * Rotate the ring so `bearingDeg` runs along +X, with depth increasing +Y from
 * the frontage.
 *
 * A bearing is clockwise from north, and a counter-clockwise rotation by
 * (bearing - 90) sends it to 90 — due east. The sign of "into the lot" is then
 * decided by where the lot's own centre sits relative to the frontage, so a
 * frontage digitised either way round still measures inwards.
 */
export function orientToFrontage(ringLocal, frontageLocal, bearingDeg) {
  const t = rad(bearingDeg - 90)
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const rot = ([x, y]) => [x * cos - y * sin, x * sin + y * cos]

  const ring = ringLocal.map(rot)
  const front = frontageLocal.map(rot)

  const frontY = front.reduce((s, p) => s + p[1], 0) / front.length
  const centreY = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const inward = centreY >= frontY ? 1 : -1

  // Re-express as depth from the frontage, so y = 0 is the street boundary.
  //
  // y = 0 is the frontage's MEAN depth, so a curved or kinked frontage has
  // vertices either side of it. `frontDepths` reports that spread, because a
  // sweep line drawn inside it cuts the frontage itself rather than the lot.
  return {
    ring: ring.map(([x, y]) => [x * inward, (y - frontY) * inward]),
    frontX: front.map((p) => p[0] * inward),
    frontDepths: front.map((p) => (p[1] - frontY) * inward),
  }
}

/**
 * Width of the lot a stated distance in from the frontage.
 *
 * Falls back to the deepest sample on a lot shallower than the setback, so a
 * tiny parcel still reports something rather than null.
 */
function widthAtDepth(profile, depth) {
  if (!profile.length) return null
  let best = profile[0]
  for (const p of profile) {
    if (Math.abs(p.depth - depth) < Math.abs(best.depth - depth)) best = p
  }
  return best.width
}

/** Contiguous runs of the profile where the lot is no wider than `maxW`. */
function narrowRuns(profile, maxW) {
  const runs = []
  let start = null
  for (let i = 0; i < profile.length; i++) {
    const narrow = profile[i].width > 0 && profile[i].width <= maxW
    if (narrow && start == null) start = i
    if (!narrow && start != null) { runs.push([start, i - 1]); start = null }
  }
  if (start != null) runs.push([start, profile.length - 1])
  return runs
}

/**
 * Sweep a lot from its frontage and report its shape.
 *
 * `ring` and `frontage` are [lng, lat]; `bearingDeg` is the frontage bearing.
 * `origin` should be the one the boundary classification used, so both sit in
 * one local frame.
 */
export function sweepLot(ring, frontage, bearingDeg, origin, opts = {}) {
  const maxHandle = opts.handleMaxWidthM ?? HANDLE_MAX_WIDTH_M
  const maxStem = Math.max(opts.stemMaxWidthM ?? STEM_MAX_WIDTH_M, maxHandle)
  const minHandleLen = opts.handleMinLengthM ?? HANDLE_MIN_LENGTH_M
  const step = opts.stepM ?? SWEEP_STEP_M

  const empty = {
    lot_depth_m: null, core_depth_m: null, lot_width_max_m: null,
    is_battleaxe: false, handle_shape: null, handle_neck_min_m: null,
    handle_neck_mean_m: null, handle_length_m: null, handle_area_sqm: null,
    core_width_min_m: null, core_width_max_m: null,
    stem_width_m: null, stem_length_m: null, stem_area_sqm: null,
    width_at_setback_m: null, width_setback_depth_m: null, profile: [],
  }
  if (!Array.isArray(ring) || ring.length < 4 || !Array.isArray(frontage) || frontage.length < 2
      || bearingDeg == null || !Number.isFinite(Number(bearingDeg))) {
    return empty
  }

  const { toLocal } = localFrame(origin)
  const { ring: r, frontDepths } = orientToFrontage(
    ring.map(toLocal), frontage.map(toLocal), Number(bearingDeg))

  let maxY = -Infinity
  for (const [, y] of r) if (y > maxY) maxY = y
  if (!(maxY > 0)) return empty

  /**
   * Start past the frontage, not at half a step.
   *
   * A curved frontage straddles y = 0: on 236//DP832775 the three frontage
   * edges arc 5 degrees, putting its vertices at depths -0.20 to +0.14, so the
   * first sample at 0.125 sliced through the frontage and returned 5.37 m for a
   * lot 10.06 m wide at the street. That one bogus sample became the neck, and
   * the neck is a compliance number — checked against a DCP minimum. Every lot
   * on a circuit or cul-de-sac has a curved frontage, so this was systematic.
   */
  const y0 = Math.max(step / 2, Math.max(...frontDepths) + step / 2)

  // Sampled just inside each end: a line exactly on the frontage or the far
  // vertex grazes the outline and reports a width of zero.
  const profile = []
  for (let y = y0; y < maxY; y += step) {
    const { total, spans } = widthAt(r, y)
    profile.push({ depth: Math.round(y * 100) / 100, width: Math.round(total * 100) / 100, arms: spans.length })
  }
  if (!profile.length) return empty

  const widths = profile.map((p) => p.width)
  const lotWidthMax = Math.max(...widths)

  const out = {
    ...empty,
    lot_depth_m: Math.round(maxY * 100) / 100,
    core_depth_m: Math.round(maxY * 100) / 100,
    lot_width_max_m: Math.round(lotWidthMax * 100) / 100,
    profile,
  }

  out.width_at_setback_m = widthAtDepth(profile, opts.widthSetbackM ?? WIDTH_SETBACK_M)
  out.width_setback_depth_m = opts.widthSetbackM ?? WIDTH_SETBACK_M

  const runs = narrowRuns(profile, maxStem)
  const last = profile.length - 1

  /**
   * A narrow run touching the far end is the lot tapering to a point, not a
   * feature. Nearly every non-rectangular parcel has one — 260//DP979237 closes
   * to 0.49 m and A//DP408911 to 0.08 m — and treating it as a rear tail
   * mislabelled both, while reporting it as the lot's width was meaningless.
   */
  const isTaper = (run) => run[1] === last
    && widths[last] <= Math.max(TAPER_TIP_M, TAPER_TIP_RATIO * widths[run[0]])
  const feature = runs.filter((r) => !isTaper(r))

  /** Widths excluding a trailing taper, so a minimum means something. */
  const trailing = runs.find(isTaper)
  const bodyEnd = trailing ? trailing[0] : profile.length
  const body = widths.slice(0, Math.max(1, bodyEnd))

  // A handle starts at the street. A narrow stretch anywhere else is a thin lot
  // or a rear tail, and calling either a battle-axe is the error this replaces.
  const lead = feature.length && feature[0][0] === 0 ? feature[0] : null
  if (!lead) {
    // A narrow stretch bounded by wider lot on both sides is a waist; one that
    // runs out to the far boundary at constant width is a rear tail. Neither is
    // an access handle, because neither touches the street.
    out.handle_shape = feature.length
      ? (feature[feature.length - 1][1] === last ? 'rear_tail' : 'waisted')
      : (trailing ? 'tapered' : 'regular')
    out.core_width_min_m = Math.round(Math.min(...body) * 100) / 100
    out.core_width_max_m = out.lot_width_max_m
    return out
  }

  const [a, b] = lead
  const handleLen = (b - a + 1) * step
  const handleWidths = widths.slice(a, b + 1)
  const neckMin = Math.min(...handleWidths)
  const after = widths.slice(b + 1, Math.max(b + 2, bodyEnd))
  const coreMax = after.length ? Math.max(...after) : 0

  /**
   * Measured against the width where the stem ENDS, not its minimum.
   *
   * A handle ends where the lot opens out; a wedge never opens out relative to
   * where it already is. 236//DP832775 is a fan lot widening evenly from 10 m at
   * the street to 16.4 m at the rear — comparing the far end against a minimum
   * 30 m away made a gradual ramp look like a step, and the widening at the
   * actual boundary was 11.96 -> 12.01 m. The margins are wide either way:
   * that lot needs 17.94 and reaches 16.37; 1//DP199788 needs 13.89 and reaches
   * 15.65.
   */
  const opensOut = coreMax >= CORE_MIN_WIDTH_M && coreMax >= widths[b] * CORE_WIDEN_RATIO
  const longEnough = handleLen >= minHandleLen

  if (!longEnough || !opensOut) {
    // Narrow at the street but never widening is a thin lot, not a battle-axe.
    out.handle_shape = opensOut ? 'short_neck' : 'uniform_narrow'
    out.core_width_min_m = Math.round(Math.min(...body) * 100) / 100
    out.core_width_max_m = out.lot_width_max_m
    return out
  }

  // Trapezoidal, because the stem tapers rather than stepping.
  let area = 0
  for (let i = a; i <= b; i++) area += widths[i] * step

  // The stem is a fact about the shape; the handle is a judgement about width.
  out.stem_width_m = Math.round(neckMin * 100) / 100
  out.stem_length_m = Math.round(handleLen * 100) / 100
  out.stem_area_sqm = Math.round(area * 100) / 100

  out.is_battleaxe = neckMin <= maxHandle
  out.handle_shape = feature.length > 1 ? 'irregular'
    : (out.is_battleaxe ? 'straight' : 'wide_stem')
  out.handle_neck_min_m = Math.round(neckMin * 100) / 100
  out.handle_neck_mean_m = Math.round((handleWidths.reduce((s, w) => s + w, 0) / handleWidths.length) * 100) / 100
  out.handle_length_m = Math.round(handleLen * 100) / 100
  out.handle_area_sqm = Math.round(area * 100) / 100
  out.core_depth_m = Math.round((maxY - y0 - handleLen) * 100) / 100
  out.core_width_min_m = after.length ? Math.round(Math.min(...after) * 100) / 100 : null
  out.core_width_max_m = Math.round(coreMax * 100) / 100
  return out
}
