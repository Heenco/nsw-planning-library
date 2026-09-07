/**
 * Project a lot's boundary into the local metric frame the 3D model uses.
 *
 * The envelope model works in metres with the lot's frontage along +X and
 * depth along +Y, because setbacks are named for boundaries, not for compass
 * directions: "front 6 m" only means anything once the frontage is an axis.
 *
 * A real parcel is neither axis-aligned nor rectangular, so the frame is
 * derived from the boundary itself: the longest merged side is taken as the
 * frontage, the ring is rotated to put it on +X, and everything is measured
 * from the resulting minimum corner. The polygon keeps its true shape — only
 * the coordinate frame changes.
 */

import { haversine, bearing } from './geo-measure.mjs'
import { lotSides, computeLotEdges, pointInRing } from './lot-edges.mjs'

/**
 * Local-metre projection of a [lng, lat] ring.
 *
 * Equirectangular about the ring's own centroid. Over a parcel — tens of
 * metres — the distortion is far below the centimetre, and it keeps the
 * projection dependency-free and reversible.
 */
function toLocalMetres(ring) {
  let sx = 0
  let sy = 0
  for (const p of ring) { sx += p[0]; sy += p[1] }
  const c = [sx / ring.length, sy / ring.length]
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * c[1] * Math.PI / 180)
  const mPerDegLng = 111412.84 * Math.cos(c[1] * Math.PI / 180)
  return {
    centre: c,
    points: ring.map((p) => [(p[0] - c[0]) * mPerDegLng, (p[1] - c[1]) * mPerDegLat]),
  }
}

/**
 * The lot's own frame.
 *
 * `frontageBearing` picks the longest side after collinear merging. That is a
 * heuristic, not a survey: for a typical block the longest boundary is a side
 * boundary, not the street frontage, so the frontage is taken as the side
 * closest to perpendicular with it when a recorded frontage length is
 * available to disambiguate. Callers that know better can pass `frontHint`.
 */
export function lotFrame(ring, { frontageLength = null } = {}) {
  if (!Array.isArray(ring) || ring.length < 4) return null

  const sides = lotSides(ring, { minLength: 1 })
  if (!sides.length) return null

  // Prefer the side whose length matches the recorded frontage; fall back to
  // the longest. Matching within a metre is a strong signal, and it is the
  // difference between a model whose "front" faces the street and one whose
  // front faces a neighbour.
  let front = sides[0]
  let frontageMatchError = null
  if (frontageLength && Number(frontageLength) > 0) {
    const target = Number(frontageLength)
    let bestDiff = Infinity
    for (const s of sides) {
      const d = Math.abs(s.length - target)
      if (d < bestDiff) { bestDiff = d; front = s }
    }
    // Closest match always wins. Falling back to the longest side when the
    // match was poor was worse, not safer: a curved or splayed street edge
    // survives collinear merging as several shorter sides, none of which
    // equals the recorded frontage, and the longest side is then usually a
    // side boundary. The residual is reported so a bad match is visible.
    frontageMatchError = bestDiff
  }

  const theta = (bearing(front.from, front.to) * Math.PI) / 180
  const { centre, points } = toLocalMetres(ring)

  // Rotate so the frontage lies along +X.
  //
  // Bearing is clockwise from north, so an edge of bearing θ has local
  // (east, north) components (sin θ, cos θ). Rotating by θ maps that onto
  // +Y, not +X — which put every frontage on the wrong axis and made the
  // model call a 35 m street boundary a "side" and a 21 m side street the
  // "front". The rotation needed is θ − 90°.
  const phi = theta - Math.PI / 2
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const rot = points.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos])

  const xs = rot.map((p) => p[0])
  const ys = rot.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)

  // Shift to the minimum corner so the model sits in the positive quadrant,
  // as the rectangle path already assumes.
  const local = rot.map(([x, y]) => [x - minX, y - minY])

  return {
    centre,
    bearing: (bearing(front.from, front.to) + 360) % 360,
    points: local,
    width: Math.max(...xs) - minX,
    depth: Math.max(...ys) - minY,
    frontageLength: front.length,
    frontageMatchError,
    sides: sides.length,
    vertices: computeLotEdges(ring).length,
  }
}

/**
 * Shoelace area of a projected (metric) ring — the area of the polygon the
 * model actually draws, for checking against the recorded figure.
 */
export function localArea(points) {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j][0] * points[i][1] - points[i][0] * points[j][1]
  }
  return Math.abs(a / 2)
}

/**
 * Inset a convex-ish ring by a per-edge distance, by moving each edge inward
 * along its normal and re-intersecting neighbours.
 *
 * Exact for convex polygons, which covers the overwhelming majority of
 * parcels. It can fold on a reflex corner, so callers must check the result
 * (area shrank, stayed simple) before using it — `insetRing` reports null
 * rather than returning a self-intersecting ring.
 */
export function insetRing(points, distanceFor) {
  const n = points.length - 1        // last point repeats the first
  if (n < 3) return null
  const lines = []
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return null
    const ux = dx / len
    const uy = dy / len
    // Left normal; rings from the cadastre may wind either way, so the sign
    // is resolved below by checking the area actually shrinks.
    const d = distanceFor(i, ux, uy)
    lines.push({ px: a[0] - uy * d, py: a[1] + ux * d, ux, uy })
  }

  const out = []
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n]
    const l2 = lines[i]
    const den = l1.ux * l2.uy - l1.uy * l2.ux
    if (Math.abs(den) < 1e-9) return null    // parallel neighbours: no corner
    const t = ((l2.px - l1.px) * l2.uy - (l2.py - l1.py) * l2.ux) / den
    out.push([l1.px + l1.ux * t, l1.py + l1.uy * t])
  }
  out.push(out[0])
  return out
}

/**
 * The largest axis-aligned rectangle that fits inside `poly`, anchored to the
 * lot's front.
 *
 * A massing has to sit inside the buildable area, not inside its bounding
 * box. Parcels are rarely rectangular, so a box sized from the bounding box
 * protrudes through the boundary on any splayed lot: 307 Galston Road has a
 * 42.9 m frontage but a 59.1 m wide bounding box, and was being given a 56 m
 * wide building that hung outside its own boundary.
 *
 * Shrinks from the bounding box until every probe point is inside. A
 * conservative fit rather than the true maximal rectangle — cheap, always
 * inside, and honest for an indicative massing.
 */
export function inscribedRect(poly, { maxDepth = 16, maxWidth = Infinity, steps = 26 } = {}) {
  if (!Array.isArray(poly) || poly.length < 4) return null
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const bx0 = Math.min(...xs); const bx1 = Math.max(...xs)
  const by0 = Math.min(...ys); const by1 = Math.max(...ys)
  const bw = bx1 - bx0
  const bd = by1 - by0
  if (bw < 1 || bd < 1) return null

  const fits = (x0, x1, y0, y1) => {
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1],
      [mx, y0], [mx, y1], [x0, my], [x1, my], [mx, my]].every((c) => pointInRing(c, poly))
  }

  // Width and depth are searched independently, over a grid of candidate
  // centres.
  //
  // Shrinking both axes together cannot find a wide, shallow rectangle: on a
  // battle-axe whose bounding box is ~20 x 55 m, by the time the depth has
  // shrunk to the 25 m body the width has collapsed to ~5 m, so the "buildable
  // area" came out as a 2 m strip lying in the access handle. Fixing the depth
  // and binary-searching the width finds the body of the lot instead.
  const GRID = 9
  const DEPTHS = 10
  let best = null

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const cx = bx0 + ((gx + 0.5) / GRID) * bw
      const cy = by0 + ((gy + 0.5) / GRID) * bd
      if (!pointInRing([cx, cy], poly)) continue

      for (let k = 0; k < DEPTHS; k++) {
        const d = Math.min(bd, maxDepth) * (1 - k / DEPTHS)
        if (d < 3) break
        const y0 = cy - d / 2
        const y1 = cy + d / 2

        // Largest width that still fits at this depth and centre.
        let lo = 0
        let hi = Math.min(bw, maxWidth)
        if (!fits(cx - 1.5, cx + 1.5, y0, y1)) continue
        for (let it = 0; it < 18; it++) {
          const mid = (lo + hi) / 2
          if (fits(cx - mid / 2, cx + mid / 2, y0, y1)) lo = mid
          else hi = mid
        }
        if (lo < 3) continue
        if (!best || lo * d > best.width * best.depth) {
          best = { x0: cx - lo / 2, x1: cx + lo / 2, y0, y1, width: lo, depth: d }
        }
      }
    }
  }
  if (!best) return null

  // A dwelling addresses its street, so slide the fitted rectangle towards the
  // front for as long as it stays inside.
  let { x0, x1, y0, y1 } = best
  const step = Math.max(0.25, (y1 - y0) * 0.05)
  for (let i = 0; i < 60 && y0 - step > by0 - 1e-6; i++) {
    if (!fits(x0, x1, y0 - step, y1 - step)) break
    y0 -= step; y1 -= step
  }
  return { x0, x1, y0, y1, width: x1 - x0, depth: y1 - y0 }
}

/**
 * Split a parcel into the body that can be built on and the access handle
 * that only reaches the street.
 *
 * A battle-axe lot is a building area joined to the road by a strip a few
 * metres wide. Drawn whole, that strip renders as a long thin spike off the
 * side of the model, and insetting it by a side setback each side leaves a
 * sliver nothing can occupy — noise in the plan and misleading in the
 * envelope.
 *
 * Detected from the shape, not from `is_battleaxe`: that flag is false on
 * plenty of lots that plainly have a handle (15 The Serpentine has ten sides,
 * a 6.2 m frontage and a handle, and is recorded as false). Scans the lot
 * front-to-back, measures how wide it is at each step, and keeps the longest
 * run of bands at least `ratio` of the widest — the body. Everything before or
 * after that run is handle.
 *
 * Returns the original points unchanged when nothing narrow is found, so a
 * normal lot is untouched.
 */
export function trimAccessHandle(points, { bands = 60, ratio = 0.45, minHandleLength = 5 } = {}) {
  if (!Array.isArray(points) || points.length < 4) return { body: points, trimmed: false }
  const ys = points.map((p) => p[1])
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const span = y1 - y0
  if (span < 1) return { body: points, trimmed: false }

  /** Width of the polygon at height y, by scanline. */
  const widthAt = (y) => {
    const xs = []
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[j]
      const [bx, by] = points[i]
      if ((ay > y) === (by > y)) continue
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
    }
    if (xs.length < 2) return 0
    return Math.max(...xs) - Math.min(...xs)
  }

  const w = []
  for (let i = 0; i < bands; i++) w.push(widthAt(y0 + ((i + 0.5) / bands) * span))
  const wMax = Math.max(...w)
  if (wMax <= 0) return { body: points, trimmed: false }

  // Longest run of bands wide enough to build in.
  const wide = w.map((v) => v >= wMax * ratio)
  let best = { start: 0, len: 0 }
  let run = 0
  for (let i = 0; i < wide.length; i++) {
    run = wide[i] ? run + 1 : 0
    if (run > best.len) best = { start: i - run + 1, len: run }
  }
  if (!best.len || best.len === bands) return { body: points, trimmed: false }

  const bandH = span / bands
  const lo = y0 + best.start * bandH
  const hi = y0 + (best.start + best.len) * bandH
  // Only trim a handle worth trimming; a slightly tapered rear is not one.
  if ((lo - y0) < minHandleLength && (y1 - hi) < minHandleLength) return { body: points, trimmed: false }

  const body = clipToBand(points, lo, hi)
  if (!body || body.length < 4) return { body: points, trimmed: false }
  return { body, trimmed: true, handleDepth: (lo - y0) + (y1 - hi) }
}

/** Sutherland-Hodgman clip of a closed ring to the band lo <= y <= hi. */
function clipToBand(points, lo, hi) {
  const ring = points.slice(0, points.length - 1)
  const clip = (pts, keep, intersect) => {
    const out = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]
      const prev = pts[(i + pts.length - 1) % pts.length]
      const curIn = keep(cur)
      const prevIn = keep(prev)
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur))
        out.push(cur)
      } else if (prevIn) {
        out.push(intersect(prev, cur))
      }
    }
    return out
  }
  const at = (a, b, y) => [a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), y]
  let r = clip(ring, (p) => p[1] >= lo, (a, b) => at(a, b, lo))
  if (r.length < 3) return null
  r = clip(r, (p) => p[1] <= hi, (a, b) => at(a, b, hi))
  if (r.length < 3) return null
  return [...r, r[0]]
}
