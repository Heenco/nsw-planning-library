/**
 * The design scheme: what a model is allowed to hand back, and how it becomes
 * geometry.
 *
 * The envelope generator (shared/envelope-model.mjs) answers "what does this
 * lot allow". This module is the other half — it takes a *design* proposed for
 * that lot and turns it into the same craftbot-model JSON the viewer already
 * reads, so a generated scheme and a rule-derived envelope can be shown in the
 * same window with the same controls.
 *
 * The split matters. A language model is asked for the design decisions it is
 * actually good at — how many volumes, where they sit, which way the roof runs,
 * where the private open space goes — and never for the 15-number transform
 * rows the format stores. Those are derived here, deterministically, from a
 * small declarative schema. A malformed scheme therefore fails validation with
 * a readable message instead of rendering as broken geometry, and every
 * dimension in the model traces back to a number the design actually stated.
 *
 * Coordinate frame is the envelope's own local metric frame: X along the street
 * frontage, Y running from the front boundary into the lot, Z up from natural
 * ground. Metres throughout.
 */

import { pointInRing } from './lot-edges.mjs'

export const SCHEME_COLLECTIONS = [
  '', 'Lot', 'Envelope', 'Building', 'Roof', 'Open_space', 'Parking',
]

export const SCHEME_LAYERS = ['frame', 'cladding ext', 'cladding int', 'interior',
  'roof', 'floors', 'foundations', 'fixtures', 'other']

/** Mass kind -> the viewer layer it is drawn on. */
const LAYER_FOR_KIND = {
  habitable: 'cladding ext',
  garage: 'frame',
  deck: 'floors',
  balcony: 'floors',
  basement: 'foundations',
  ancillary: 'interior',
}

/** Which mass kinds count as gross floor area for the FSR test. */
export const GFA_KINDS = new Set(['habitable'])

/** Which mass kinds sit on the ground and therefore count as site coverage. */
export const COVERAGE_KINDS = new Set(['habitable', 'garage', 'ancillary'])

// -- polygon helpers -----------------------------------------------------

/** Signed shoelace area; positive when the ring winds counter-clockwise. */
export function signedArea(pts) {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % n]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function polygonArea(pts) {
  return Math.abs(signedArea(openRing(pts)))
}

/** Drop a repeated closing point so a ring is a list of distinct vertices. */
export function openRing(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return Array.isArray(pts) ? pts.slice() : []
  const [fx, fy] = pts[0]
  const [lx, ly] = pts[pts.length - 1]
  return (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) ? pts.slice(0, -1) : pts.slice()
}

/** Close a ring by repeating its first point, as pointInRing expects. */
export function closeRing(pts) {
  const open = openRing(pts)
  return [...open, open[0]]
}

export function bbox(pts) {
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** Shortest distance from a point to a ring's boundary. */
export function distanceToRing(pt, ring) {
  const pts = openRing(ring)
  let best = Infinity
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 > 0
      ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2))
      : 0
    best = Math.min(best, Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy)))
  }
  return best
}

// -- validation ----------------------------------------------------------

const MASS_KINDS = new Set(['habitable', 'garage', 'deck', 'balcony', 'basement', 'ancillary'])
const ROOF_TYPES = new Set(['gable', 'hip', 'skillion', 'flat'])
const OPEN_SPACE_KINDS = new Set(['private_open_space', 'deep_soil', 'landscaped', 'driveway', 'communal'])

/**
 * Structural validation, before any geometry is built.
 *
 * Returns a list of human-readable problems, which is also what gets fed back
 * to the model on the repair pass — so each message is written to be
 * actionable on its own and names the element it came from.
 */
export function validateScheme(scheme) {
  const errs = []
  if (!scheme || typeof scheme !== 'object') return ['scheme is not a JSON object']

  const masses = Array.isArray(scheme.masses) ? scheme.masses : null
  if (!masses || !masses.length) errs.push('masses must be a non-empty array')

  const names = new Set()
  for (const [i, m] of (masses ?? []).entries()) {
    const at = `masses[${i}]${m?.name ? ` "${m.name}"` : ''}`
    if (!m || typeof m !== 'object') { errs.push(`${at}: not an object`); continue }
    if (!m.name || typeof m.name !== 'string') errs.push(`${at}: missing "name"`)
    else if (names.has(m.name)) errs.push(`${at}: duplicate name "${m.name}"`)
    else names.add(m.name)
    if (!MASS_KINDS.has(m.kind)) {
      errs.push(`${at}: kind "${m.kind}" is not one of ${[...MASS_KINDS].join(', ')}`)
    }
    const fp = Array.isArray(m.footprint) ? openRing(m.footprint) : null
    if (!fp || fp.length < 3) {
      errs.push(`${at}: footprint needs at least 3 [x, y] points`)
    } else if (!fp.every(p => Array.isArray(p) && p.length >= 2 && p.every(n => Number.isFinite(Number(n))))) {
      errs.push(`${at}: footprint holds a non-numeric point`)
    } else if (polygonArea(fp) < 1) {
      errs.push(`${at}: footprint encloses ${polygonArea(fp).toFixed(2)} m2 — degenerate`)
    }
    const z0 = Number(m.z0)
    const z1 = Number(m.z1)
    if (!Number.isFinite(z0) || !Number.isFinite(z1)) errs.push(`${at}: z0 and z1 must be numbers`)
    else if (z1 - z0 < 0.2) errs.push(`${at}: z1 (${z1}) must be at least 0.2 m above z0 (${z0})`)
  }

  for (const [i, r] of (scheme.roofs ?? []).entries()) {
    const at = `roofs[${i}]${r?.name ? ` "${r.name}"` : ''}`
    if (!ROOF_TYPES.has(r?.type)) errs.push(`${at}: type must be one of ${[...ROOF_TYPES].join(', ')}`)
    if (!r?.over || !names.has(r.over)) {
      errs.push(`${at}: "over" must name one of the masses (${[...names].join(', ')})`)
    }
    const eave = Number(r?.eave_height)
    const ridge = Number(r?.ridge_height)
    if (!Number.isFinite(eave) || !Number.isFinite(ridge)) {
      errs.push(`${at}: eave_height and ridge_height must be numbers`)
    } else if (r.type !== 'flat' && ridge <= eave) {
      errs.push(`${at}: ridge_height (${ridge}) must exceed eave_height (${eave})`)
    }
  }

  for (const [i, o] of (scheme.open_space ?? []).entries()) {
    const at = `open_space[${i}]${o?.name ? ` "${o.name}"` : ''}`
    if (!OPEN_SPACE_KINDS.has(o?.kind)) errs.push(`${at}: kind must be one of ${[...OPEN_SPACE_KINDS].join(', ')}`)
    const poly = Array.isArray(o?.polygon) ? openRing(o.polygon) : null
    if (!poly || poly.length < 3) errs.push(`${at}: polygon needs at least 3 [x, y] points`)
  }

  return errs
}

// -- geometry ------------------------------------------------------------

/**
 * Build the craftbot-model JSON for a scheme, drawn inside its own site.
 *
 * The lot and the buildable envelope travel with the design rather than being
 * left to a second model file: the point of looking at a generated scheme is
 * seeing how close it runs to the lines the controls drew, and a building
 * floating on its own says nothing about that.
 */
export function schemeToModel(scheme, brief) {
  const boxes = []
  const meshes = []
  const coll = (name) => SCHEME_COLLECTIONS.indexOf(name)

  /**
   * A vertical prism over a closed ring. Winding is forced counter-clockwise
   * first so base, top and side faces all come out consistently outward.
   */
  const prism = (name, collection, layer, ring, z0, z1) => {
    let pts = openRing(ring)
    if (pts.length < 3) return
    if (signedArea(pts) < 0) pts = pts.slice().reverse()
    const n = pts.length
    const verts = []
    for (const [x, y] of pts) verts.push(Number(x), Number(y), z0)
    for (const [x, y] of pts) verts.push(Number(x), Number(y), z1)
    const faces = [
      [...Array(n).keys()].reverse(),
      [...Array(n).keys()].map(i => i + n),
    ]
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      faces.push([i, j, j + n, i + n])
    }
    meshes.push({ name, collection: coll(collection), layer, verts, faces })
  }

  /**
   * A convex solid with every face oriented outward from its own centroid.
   *
   * Roofs are assembled face by face and getting each winding right by hand is
   * fiddly and easy to get subtly wrong; every roof form here is convex, so the
   * centroid test settles it exactly.
   */
  const solid = (name, collection, layer, verts3, faces) => {
    const n = verts3.length
    const c = verts3.reduce((a, v) => [a[0] + v[0] / n, a[1] + v[1] / n, a[2] + v[2] / n], [0, 0, 0])
    const oriented = faces.map((f) => {
      // Newell's method: correct for any planar polygon and degenerate-safe.
      let nx = 0, ny = 0, nz = 0
      for (let i = 0; i < f.length; i++) {
        const a = verts3[f[i]]
        const b = verts3[f[(i + 1) % f.length]]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
      }
      const fc = f.reduce((acc, i) => [
        acc[0] + verts3[i][0] / f.length,
        acc[1] + verts3[i][1] / f.length,
        acc[2] + verts3[i][2] / f.length,
      ], [0, 0, 0])
      const out = [fc[0] - c[0], fc[1] - c[1], fc[2] - c[2]]
      return (nx * out[0] + ny * out[1] + nz * out[2]) < 0 ? f.slice().reverse() : f
    })
    meshes.push({ name, collection: coll(collection), layer, verts: verts3.flat(), faces: oriented })
  }

  const slab = (name, collection, layer, [x0, y0, z0], [x1, y1, z1]) => {
    const h = (a, b) => Math.abs(b - a) / 2
    const c = (a, b) => (a + b) / 2
    boxes.push([name, coll(collection),
      h(x0, x1), 0, 0, c(x0, x1),
      0, h(y0, y1), 0, c(y0, y1),
      0, 0, h(z0, z1), c(z0, z1),
      SCHEME_LAYERS.indexOf(layer)])
  }

  // -- site --
  if (brief.lotPolygon?.length >= 3) {
    prism(`Lot_${Math.round(brief.siteArea || 0)}sqm__${(brief.geometrySource || 'site').replace(/[^\w.]+/g, '_')}`,
      'Lot', 'foundations', brief.lotPolygon, -0.12, 0)
  }
  if (brief.buildablePolygon?.length >= 3) {
    // Drawn as a solid so the design is visibly *inside* it; the viewer's
    // per-collection visibility toggle takes it away when the design alone is
    // wanted.
    prism(`Envelope_front${brief.setbacks.front}m_rear${brief.setbacks.rear}m_side${brief.setbacks.side}m_height${brief.height}m`,
      'Envelope', 'other', brief.buildablePolygon, 0, brief.height)
  }

  // -- the design --
  const massByName = new Map()
  for (const m of scheme.masses ?? []) {
    massByName.set(m.name, m)
    const layer = LAYER_FOR_KIND[m.kind] ?? 'other'
    prism(`${m.name}__${m.kind}_${(Number(m.z1) - Number(m.z0)).toFixed(1)}m`,
      'Building', layer, m.footprint, Number(m.z0), Number(m.z1))
  }

  for (const r of scheme.roofs ?? []) {
    const over = massByName.get(r.over)
    if (!over) continue
    const b = bbox(openRing(over.footprint))
    const eave = Number(r.eave_height)
    const ridge = Number(r.ridge_height)
    const name = `${r.name || `${r.over}_roof`}__${r.type}_ridge${ridge.toFixed(1)}m`
    const axis = r.axis === 'y' ? 'y'
      : r.axis === 'x' ? 'x'
        : ((b.x1 - b.x0) >= (b.y1 - b.y0) ? 'x' : 'y')
    roofSolid(solid, prism, name, r.type, axis, b, eave, ridge)
  }

  for (const o of scheme.open_space ?? []) {
    // A 60 mm mat rather than a flat plane, so it reads at a glance from an
    // oblique view and can still be picked in the viewer.
    prism(`${o.name || o.kind}__${o.kind}_${Math.round(polygonArea(openRing(o.polygon)))}sqm`,
      'Open_space', 'other', o.polygon, 0.0, 0.06)
  }

  for (const [i, p] of (scheme.parking ?? []).entries()) {
    const x = Number(p.x)
    const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    // 2.6 x 5.4 m is the AS 2890.1 user class 1A space the DCPs cite.
    slab(p.name || `Car_${i + 1}`, 'Parking', 'other',
      [x - 1.3, y - 2.7, 0.02], [x + 1.3, y + 2.7, 0.1])
  }

  return {
    format: 'craftbot-model',
    version: 1,
    source: `generated design — ${brief.address} — ${scheme.scheme_name || 'scheme'}`,
    collections: SCHEME_COLLECTIONS,
    boxes,
    meshes,
    layers: SCHEME_LAYERS,
  }
}

/**
 * One roof form as a closed solid sitting on the eave plane.
 *
 * Built over the bounding box of the mass below rather than its exact
 * footprint. That is a deliberate simplification, and the rationale says so: a
 * pitched roof over a re-entrant plan is a hip-and-valley problem whose answer
 * is not implied by anything the scheme records, so resolving it here would be
 * geometry with nothing behind it. The ridge height — the number tested against
 * the height limit — is exact either way.
 */
function roofSolid(solid, prism, name, type, axis, b, eave, ridge) {
  const { x0, x1, y0, y1 } = b
  if (type === 'flat' || ridge <= eave) {
    prism(name, 'Roof', 'roof',
      [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], eave, Math.max(ridge, eave + 0.15))
    return
  }

  // Corners of the eave plane, anticlockwise from the front-left.
  const a = [x0, y0, eave]
  const bb = [x1, y0, eave]
  const c = [x1, y1, eave]
  const d = [x0, y1, eave]
  const base = [0, 1, 2, 3]

  if (type === 'skillion') {
    // Rises away from the front boundary on an x ridge and toward +x on a y
    // ridge, so the tall wall is the one the eave/ridge pair describes.
    const hi = axis === 'x'
      ? [[x0, y1, ridge], [x1, y1, ridge]]
      : [[x1, y0, ridge], [x1, y1, ridge]]
    const verts = [a, bb, c, d, hi[0], hi[1]]
    const faces = axis === 'x'
      ? [base, [0, 1, 5, 4], [3, 4, 5, 2], [0, 4, 3], [1, 2, 5]]
      : [base, [0, 4, 5, 3], [1, 2, 5, 4], [0, 1, 4], [3, 5, 2]]
    solid(name, 'Roof', 'roof', verts, faces)
    return
  }

  const xm = (x0 + x1) / 2
  const ym = (y0 + y1) / 2

  // A gable ridge runs the full length; a hip ridge is pulled in from both ends
  // by half the short span, which is the standard equal-pitch hip and keeps all
  // four planes at one pitch.
  const inset = type === 'hip'
    ? (axis === 'x'
        ? Math.max(0, Math.min((y1 - y0) / 2, (x1 - x0) / 2 - 0.01))
        : Math.max(0, Math.min((x1 - x0) / 2, (y1 - y0) / 2 - 0.01)))
    : 0
  const r0 = axis === 'x' ? [x0 + inset, ym, ridge] : [xm, y0 + inset, ridge]
  const r1 = axis === 'x' ? [x1 - inset, ym, ridge] : [xm, y1 - inset, ridge]
  const verts = [a, bb, c, d, r0, r1]
  const faces = axis === 'x'
    ? [base, [0, 1, 5, 4], [2, 3, 4, 5], [0, 4, 3], [1, 2, 5]]
    : [base, [0, 4, 5, 3], [1, 2, 5, 4], [0, 1, 4], [2, 3, 5]]
  solid(name, 'Roof', 'roof', verts, faces)
}

/** Every vertex of a footprint that falls outside a ring, with how far out. */
export function footprintBreaches(footprint, ring, tolerance = 0.05) {
  const closed = closeRing(ring)
  const out = []
  for (const p of openRing(footprint)) {
    if (!pointInRing(p, closed)) {
      const d = distanceToRing(p, closed)
      if (d > tolerance) out.push({ point: p, overhang: d })
    }
  }
  return out
}
