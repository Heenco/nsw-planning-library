/**
 * Synthetic lots with known answers for the cross-section sweep.
 *
 *   node scripts/lot-shape-selftest.mjs
 *
 * Synthetic on purpose, unlike scripts/frontage-selftest.mjs: these pin the
 * arithmetic, where a hand-built 4 x 25 m handle on a 20 x 30 m core has an
 * answer known to the centimetre and a real lot does not. The pair that matters
 * most is the plain rectangle and the battle-axe — the defect this replaces
 * flagged a plain 20x40 m lot as a battle-axe because `minimum_clearance`
 * measured vertex spacing rather than width, so a true negative is as important
 * here as a true positive.
 *
 * Shapes are built in metres and converted to degrees about a Sydney origin,
 * because sweepLot takes [lng, lat] like everything else in the pipeline.
 */

import { sweepLot } from '../shared/lot-shape.mjs'

const ORIGIN = [151.2412, -33.9173]
const M_PER_DEG_LAT = (Math.PI / 180) * 6371008.8
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180)
/** Metres east/north of ORIGIN -> [lng, lat]. */
const pt = ([x, y]) => [ORIGIN[0] + x / M_PER_DEG_LON, ORIGIN[1] + y / M_PER_DEG_LAT]

/** Close a ring of metre coordinates and project it. */
const lot = (pts) => [...pts, pts[0]].map(pt)

/**
 * Frontage along the south edge, so depth runs north. Bearing 90 = due east,
 * which is the direction the frontage line itself runs.
 */
const southFrontage = (x0, x1) => ({ line: [pt([x0, 0]), pt([x1, 0])], bearing: 90 })

const CASES = [
  {
    name: 'plain 20 x 40 rectangle',
    why: 'the false positive the old neck_ratio produced',
    ring: lot([[0, 0], [20, 0], [20, 40], [0, 40]]),
    front: southFrontage(0, 20),
    expect: { is_battleaxe: false, lot_depth_m: 40, core_depth_m: 40, lot_width_max_m: 20 },
  },
  {
    name: 'battle-axe: 4 x 25 handle, 20 x 30 core',
    why: 'the true positive — neck, handle length and core depth all known',
    ring: lot([[0, 0], [4, 0], [4, 25], [20, 25], [20, 55], [-10, 55], [-10, 25], [0, 25]]),
    front: southFrontage(0, 4),
    expect: {
      is_battleaxe: true, handle_neck_min_m: 4, handle_length_m: 25,
      handle_area_sqm: 100, core_depth_m: 30, lot_depth_m: 55, core_width_max_m: 30,
    },
  },
  {
    name: 'tapered handle 5 m -> 3 m',
    why: 'the neck must be the minimum, not the mean — a DCP minimum is a minimum',
    ring: lot([[0, 0], [5, 0], [4, 20], [20, 20], [20, 50], [-10, 50], [-10, 20], [1, 20]]),
    front: southFrontage(0, 5),
    expect: { is_battleaxe: true, handle_length_m: 20 },
    check: (r) => (r.handle_neck_min_m < r.handle_neck_mean_m
      ? null : `neck min ${r.handle_neck_min_m} should be below mean ${r.handle_neck_mean_m}`),
  },
  {
    name: 'thin rear tail, wide street frontage',
    why: 'thin but away from the street — an irregular lot, not a battle-axe',
    ring: lot([[0, 0], [25, 0], [25, 30], [14, 30], [14, 60], [11, 60], [11, 30], [0, 30]]),
    front: southFrontage(0, 25),
    expect: { is_battleaxe: false, handle_shape: 'rear_tail' },
  },
  {
    name: 'uniformly narrow 5 x 40 strip',
    why: 'narrow at the street but never widening — a thin lot, not a handle',
    ring: lot([[0, 0], [5, 0], [5, 40], [0, 40]]),
    front: southFrontage(0, 5),
    expect: { is_battleaxe: false, handle_shape: 'uniform_narrow' },
  },
  {
    name: 'short 2 m nick at the street',
    why: 'a notch in the boundary is not something you drive down',
    ring: lot([[0, 0], [4, 0], [4, 2], [20, 2], [20, 40], [-10, 40], [-10, 2], [0, 2]]),
    front: southFrontage(0, 4),
    expect: { is_battleaxe: false, handle_shape: 'short_neck' },
  },
]

/** Sweep resolution is 0.25 m, so agreement inside half a step is exact. */
const TOL = 0.3
let failures = 0

for (const c of CASES) {
  const r = sweepLot(c.ring, c.front.line, c.front.bearing, ORIGIN)
  const problems = []

  for (const [k, want] of Object.entries(c.expect)) {
    const got = r[k]
    const ok = typeof want === 'number' ? (got != null && Math.abs(got - want) <= TOL) : got === want
    if (!ok) problems.push(`${k} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
  }
  if (c.check) {
    const msg = c.check(r)
    if (msg) problems.push(msg)
  }

  if (problems.length) {
    failures++
    console.log(`FAIL  ${c.name}`)
    console.log(`      ${c.why}`)
    for (const p of problems) console.log(`      - ${p}`)
  } else {
    const bits = r.is_battleaxe
      ? `battle-axe · neck ${r.handle_neck_min_m} m (mean ${r.handle_neck_mean_m}) · `
        + `handle ${r.handle_length_m} m / ${r.handle_area_sqm} m² · core depth ${r.core_depth_m} m`
      : `${r.handle_shape} · depth ${r.core_depth_m} m · width ${r.lot_width_max_m} m`
    console.log(`ok    ${c.name.padEnd(38)} ${bits}`)
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} shape cases passed`)
process.exit(failures ? 1 : 0)
