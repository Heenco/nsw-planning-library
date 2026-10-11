/**
 * Siting: drop a building type on a lot, let the reader move it, and measure it against the controls - live.
 *
 * The Archistar-style loop, built from parts the app already has:
 *   - the brief (lot ring, buildable area, setbacks, height) from the envelope generator, so the lines drawn here are
 *     the ones /api/property/envelope draws;
 *   - the scheme format and its geometry (design-scheme.mjs), so the 3D is the craftbot viewer's own model;
 *   - the checks (design-check.mjs), which measure the scheme's coordinates and never trust a stated number.
 *
 * What this file adds is a design a person can edit. A scheme is stored as BLOCKS - axis-aligned rectangles in the lot's
 * local frame (X along the street frontage, Y from the front boundary into the lot), each with a storey count and a
 * roof - because a rectangle with four handles is what a plan editor can drag. `blocksToScheme` turns blocks into the
 * masses/roofs/open-space scheme the rest of the pipeline reads. The templates only choose the first blocks; after
 * that the reader owns them.
 *
 * Pure functions, no I/O: the server calls the templates once, the page calls everything else on every drag.
 */

import { inscribedRect } from './lot-frame.mjs'
import { pointInRing } from './lot-edges.mjs'
import { openRing, closeRing, polygonArea, bbox } from './design-scheme.mjs'
import { checkScheme } from './design-check.mjs'

/**
 * The floor area a first placement aims for when no plan caps it (Hornsby maps no FSR for R2): a generous family house,
 * and two of a modest one. A starting size for the reader to change, never a control - the checks ignore it.
 */
export const TYPICAL_GFA = { 'dwelling house': 300, 'dual occupancy': 400 }

/** Floor to floor, metres. 3.0 is the figure the Pattern Book and the ADG both work to for low-rise housing. */
export const STOREY_M = 3.0
/** Eave to ridge of a pitched roof; a flat roof is a 0.3 m parapet. */
export const ROOF_RISE_M = { hip: 2.4, gable: 2.4, skillion: 1.8, flat: 0.3 }

const r2 = n => Math.round(n * 100) / 100

/** The four corners of a block, anticlockwise from front-left. */
export function blockRing(b) {
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]
}

/** Ridge height of a block: its storeys plus its roof. */
export function blockTop(b) {
  return b.storeys * STOREY_M + (ROOF_RISE_M[b.roof] ?? ROOF_RISE_M.flat)
}

/** The storeys and roof a height limit leaves room for, tallest first, capped at `maxStoreys`. */
export function fitStoreys(height, maxStoreys = 2) {
  for (let s = maxStoreys; s >= 1; s--) {
    for (const roof of ['hip', 'skillion', 'flat']) {
      if (s * STOREY_M + ROOF_RISE_M[roof] <= height + 1e-6) return { storeys: s, roof }
    }
  }
  return { storeys: 1, roof: 'flat' }
}

/** How deep a strip [x0, x1] can run from y0 before it leaves the ring - in 0.25 m steps, up to maxD. */
function depthInside(ring, x0, x1, y0, maxD) {
  const closed = closeRing(ring)
  const xm = (x0 + x1) / 2
  let d = 0
  for (let t = 0.25; t <= maxD + 1e-9; t += 0.25) {
    const y = y0 + t
    if (![[x0 + 0.05, y], [xm, y], [x1 - 0.05, y]].every(p => pointInRing(p, closed))) break
    d = t
  }
  return d
}

/** The part of a ring at or behind y = yMin (Sutherland-Hodgman against one half-plane). Closed, or null. */
export function clipBehind(ring, yMin) {
  const pts = openRing(ring)
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const ain = a[1] >= yMin
    const bin = b[1] >= yMin
    if (ain) out.push(a)
    if (ain !== bin) {
      const t = (yMin - a[1]) / (b[1] - a[1])
      out.push([a[0] + t * (b[0] - a[0]), yMin])
    }
  }
  return out.length >= 3 ? closeRing(out) : null
}

/**
 * The best rectangle for one building: inscribedRect is front-anchored and trades width for depth, and on a skewed lot
 * the deepest rectangle is the narrowest. Try a few depths and keep the one with the most floor area - capped at
 * `target` m2 per floor, so a cap that only needs a shallow building gets the widest one.
 */
function bestRect(poly, { depths = [8, 10, 12, 14, 16, 18], minWidth = 4, target = Infinity } = {}) {
  let best = null
  for (const d of depths) {
    const r = inscribedRect(poly, { maxDepth: d })
    if (!r || r.x1 - r.x0 < minWidth) continue
    // no corridor houses: past 10 m deep, a plan more than 1.8 times as deep as it is wide is not a first placement
    if (r.y1 - r.y0 > 10 && r.y1 - r.y0 > 1.8 * (r.x1 - r.x0)) continue
    const area = Math.min((r.x1 - r.x0) * (r.y1 - r.y0), target)
    const score = area + 0.01 * (r.x1 - r.x0)   // equal area: the wider one
    if (!best || score > best.score) best = { ...r, score }
  }
  return best && slideForward(poly, best)
}

/**
 * Move a rectangle toward the street until it meets the front setback line. inscribedRect searches centres over the
 * whole area and can return a building 20 m behind the line it is allowed to sit on; a house is placed at its front
 * setback, so that is where a first placement goes. On a skewed lot the side boundaries lean, so each step forward may
 * also need a step sideways - up to 1 m either way per 0.25 m forward.
 */
function slideForward(poly, r) {
  const closed = closeRing(poly)
  // probed 30 mm inside its own edges: a rectangle fitted to both sides touches them, and a boundary that leans 30 mm
  // over 26 m (28 Eastern Av, Kingsford) otherwise stops it at the first step
  const fits = (dx, dy) => {
    const x0 = r.x0 + dx + 0.03
    const x1 = r.x1 + dx - 0.03
    const y0 = r.y0 - dy + 0.03
    const y1 = r.y1 - dy - 0.03
    const xm = (x0 + x1) / 2
    const ym = (y0 + y1) / 2
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [xm, y0], [xm, y1], [x0, ym], [x1, ym]].every(p => pointInRing(p, closed))
  }
  const SIDE = [0, 0.05, -0.05, 0.1, -0.1, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1]
  let dx = 0
  let dy = 0
  for (let guard = 0; guard < 400; guard++) {
    const step = SIDE.find(s => fits(dx + s, dy + 0.25))
    if (step == null) break
    dx += step
    dy += 0.25
  }
  // placed 30 mm inside the probe as well, so the tolerance never becomes a setback breach of the same size
  return { ...r, x0: r.x0 + dx + 0.03, x1: r.x1 + dx - 0.03, y0: r.y0 - dy + 0.03, y1: r.y1 - dy - 0.03 }
}

// -- templates ---------------------------------------------------------------------------------------------------

/**
 * The floor area a template may use: the cap the plans set (FSR x site, or a floor-area standard), else the envelope.
 * Split across `dwellings` so each gets its share.
 */
function areaPerFloor(brief, w, d, storeys, dwellings = 1) {
  const cap = Math.min(Number(brief.gfaCap) || Infinity, dwellings > 1 ? TYPICAL_GFA['dual occupancy'] : TYPICAL_GFA['dwelling house'])
  return Math.min(w * d, cap / storeys / dwellings)
}

/**
 * Starting blocks for a building type, fitted inside the buildable area and sized to the floor-area cap.
 *
 * Returns { blocks, note } - blocks empty and a note saying why when the type does not fit. A template is a first
 * placement, not a design: the reader is expected to move it.
 */
export function templateBlocks(type, brief, { detached = null } = {}) {
  const poly = brief.buildablePolygon
  if (!Array.isArray(poly) || poly.length < 4) return { blocks: [], note: 'This lot leaves no buildable area once the setbacks are taken out.' }
  const { storeys, roof } = fitStoreys(Number(brief.height) || 8.5, 2)

  if (type === 'dwelling house') {
    const rect = bestRect(poly, { target: Math.min(Number(brief.gfaCap) || Infinity, TYPICAL_GFA['dwelling house']) / storeys })
    if (!rect) return { blocks: [], note: 'No rectangle fits inside the buildable area.' }
    const w = rect.x1 - rect.x0
    const d = Math.max(6, Math.min(rect.y1 - rect.y0, areaPerFloor(brief, w, rect.y1 - rect.y0, storeys) / w))
    return { blocks: [{ id: 'A', name: 'Dwelling', dwelling: 'A', x0: r2(rect.x0), y0: r2(rect.y0), x1: r2(rect.x1), y1: r2(rect.y0 + d), storeys, roof }], note: null }
  }

  if (type === 'dual occupancy' || type.startsWith('dual occupancy (')) {
    // the kind, when the use names it, decides the form; the general use tries attached first
    if (/\(attached\)/.test(type)) detached = false
    else if (/\(detached\)/.test(type)) detached = true
    // Attached: one building split by a party wall, side by side. This is the form a narrow lot can take.
    const attached = () => {
      const rect = bestRect(poly, { minWidth: 9, target: Math.min(Number(brief.gfaCap) || Infinity, TYPICAL_GFA['dual occupancy']) / storeys })
      if (!rect) return null
      const w = rect.x1 - rect.x0
      const d = Math.max(6, Math.min(rect.y1 - rect.y0, areaPerFloor(brief, w / 2, rect.y1 - rect.y0, storeys, 2) / (w / 2)))
      const xm = r2((rect.x0 + rect.x1) / 2)
      return [
        { id: 'A', name: 'Dwelling_1', dwelling: 'A', x0: r2(rect.x0), y0: r2(rect.y0), x1: xm, y1: r2(rect.y0 + d), storeys, roof },
        { id: 'B', name: 'Dwelling_2', dwelling: 'B', x0: xm, y0: r2(rect.y0), x1: r2(rect.x1), y1: r2(rect.y0 + d), storeys, roof },
      ]
    }
    // Detached: two buildings, one behind the other with a 3 m gap - the usual form on a deep lot.
    const detachedPair = () => {
      const gap = 3
      const per = Math.min(Number(brief.gfaCap) || Infinity, TYPICAL_GFA['dual occupancy']) / storeys / 2
      const a = bestRect(poly, { depths: [7, 8, 9, 10, 12, 14], minWidth: 5, target: per })
      if (!a) return null
      const ad = Math.max(7, Math.min(a.y1 - a.y0, per / (a.x1 - a.x0)))
      const rear = clipBehind(poly, a.y0 + ad + gap)
      const b = rear && bestRect(rear, { depths: [7, 8, 9, 10, 12, 14], minWidth: 5, target: per })
      if (!b) return null
      const bd = Math.max(7, Math.min(b.y1 - b.y0, per / (b.x1 - b.x0)))
      return [
        { id: 'A', name: 'Dwelling_1', dwelling: 'A', x0: r2(a.x0), y0: r2(a.y0), x1: r2(a.x1), y1: r2(a.y0 + ad), storeys, roof },
        { id: 'B', name: 'Dwelling_2', dwelling: 'B', x0: r2(b.x0), y0: r2(b.y0), x1: r2(b.x1), y1: r2(b.y0 + bd), storeys, roof },
      ]
    }
    const blocks = detached === true ? detachedPair() : detached === false ? attached() : (attached() ?? detachedPair())
    if (!blocks) {
      return { blocks: [], note: detached === true
        ? 'Two detached dwellings need room for two 7 m deep buildings with a 3 m gap between them inside the buildable area; this lot does not have it.'
        : 'The buildable area is too narrow for two dwellings side by side (9 m) and too shallow for one behind the other.' }
    }
    return { blocks, note: null }
  }

  // Any other use: one building, fitted to the buildable area and sized to the floor area the plans give that use (a kiosk's
  // 20 m2, a residential flat building's FSR x site area). Buildings that are apartments or premises take every storey the
  // height allows; anything a house would be stays at two. A massing to move, not a design of that use.
  const MULTI = /residential flat|shop top|multi dwelling|boarding|co-living|seniors|hostel|hotel|motel|serviced apartment|commercial|business premises|office|retail|mixed use|build-to-rent|student/i
  const many = MULTI.test(type)
  const fit = many ? fitStoreys(Number(brief.height) || 8.5, Math.max(1, Math.min(12, Math.floor(((Number(brief.height) || 8.5) - 0.3) / STOREY_M)))) : { storeys, roof }
  const cap = Number(brief.gfaCap) || Infinity
  // a small cap is a small building: a 20 m2 kiosk on one floor, square, not a 4 m deep strip the width of the lot
  if (cap < 100) fit.storeys = 1
  const rect = bestRect(poly, { depths: many ? [10, 12, 14, 16, 18, 20, 24] : [8, 10, 12, 14, 16, 18], target: cap / fit.storeys })
  if (!rect) return { blocks: [], note: 'No rectangle fits inside the buildable area.' }
  const perFloor = cap / fit.storeys
  if (perFloor < (rect.x1 - rect.x0) * 4) {
    const side = Math.sqrt(perFloor)
    rect.x1 = Math.min(rect.x1, rect.x0 + side)
  }
  const w = rect.x1 - rect.x0
  const d = Math.max(Math.min(2, rect.y1 - rect.y0), Math.min(rect.y1 - rect.y0, perFloor / w))
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  return { blocks: [{ id: 'A', name: label.replace(/\s+/g, '_').slice(0, 40), dwelling: 'A', x0: r2(rect.x0), y0: r2(rect.y0), x1: r2(rect.x1), y1: r2(rect.y0 + d), storeys: fit.storeys, roof: many ? 'flat' : fit.roof }],
    note: null }
}

// -- blocks -> scheme -----------------------------------------------------------------------------------------------

/**
 * The scheme design-scheme.mjs draws and design-check.mjs measures.
 *
 * Each block becomes one habitable mass per storey and a roof over the top one; behind each dwelling its private open
 * space runs to the rear boundary (up to 8 m), and in front of it a car space sits on the driveway when the front
 * setback is deep enough to hold one. Both are indicative, and named so in the model.
 */
export function blocksToScheme(blocks, brief, { name = 'scheme' } = {}) {
  const masses = []
  const roofs = []
  const open_space = []
  const parking = []
  const dwellings = [...new Set(blocks.map(b => b.dwelling))].map(id => ({ id }))
  const lot = brief.lotPolygon
  for (const b of blocks) {
    const fp = blockRing(b)
    for (let k = 0; k < b.storeys; k++) {
      masses.push({ name: `${b.name}_L${k + 1}`, kind: 'habitable', footprint: fp, z0: k * STOREY_M, z1: (k + 1) * STOREY_M, storey: k + 1 })
    }
    const eave = b.storeys * STOREY_M
    roofs.push({ name: `${b.name}_roof`, type: b.roof, over: `${b.name}_L${b.storeys}`, eave_height: eave, ridge_height: eave + (ROOF_RISE_M[b.roof] ?? 0.3) })
    if (lot?.length >= 3) {
      // the yard behind this block, stopping at any other block in the way
      const behind = blocks.filter(o => o !== b && o.y0 >= b.y1 - 0.01 && o.x0 < b.x1 && o.x1 > b.x0).map(o => o.y0)
      const room = Math.min(8, ...behind.map(y => y - b.y1 - 0.5))
      const d = depthInside(lot, b.x0, b.x1, b.y1 + 0.3, Math.max(0, room))
      if (d >= 3) open_space.push({ name: `${b.name}_yard`, kind: 'private_open_space', polygon: [[b.x0, b.y1 + 0.3], [b.x1, b.y1 + 0.3], [b.x1, b.y1 + 0.3 + d], [b.x0, b.y1 + 0.3 + d]] })
      // a 5.4 m space fits a 5.6 m front setback, which every DCP here sets or exceeds
      if (b.y0 >= 5.6) parking.push({ name: `${b.name}_car_space`, x: (b.x0 + b.x1) / 2, y: b.y0 - 2.8 })
    }
  }
  return { scheme_name: name, dwellings, masses, roofs, open_space, parking }
}

// -- measuring -------------------------------------------------------------------------------------------------------

function closestOnSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return [a[0] + t * dx, a[1] + t * dy]
}

/** The closest pair of points between a polygon and a segment, and how far apart they are. */
function polygonToSegment(poly, a, b) {
  let best = { d: Infinity, p: null, q: null }
  const pts = openRing(poly)
  for (const p of pts) {
    const q = closestOnSegment(p, a, b)
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < best.d) best = { d, p, q }
  }
  for (const e of [a, b]) {
    for (let i = 0; i < pts.length; i++) {
      const p = closestOnSegment(e, pts[i], pts[(i + 1) % pts.length])
      const d = Math.hypot(p[0] - e[0], p[1] - e[1])
      if (d < best.d) best = { d, p, q: e }
    }
  }
  return best
}

/**
 * The setback a polygon keeps from one boundary edge, SIGNED: positive inside the lot, negative once it crosses the
 * boundary line. An unsigned distance read a building dragged 3.6 m past the side boundary as a 3.6 m side setback.
 * Measured perpendicular to the edge from every vertex that sits alongside it; a polygon wholly past the edge's ends is
 * measured to the nearest point, unsigned, as before. `inward` is +1 when the lot ring winds anticlockwise.
 */
function setbackToSegment(poly, a, b, inward) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return polygonToSegment(poly, a, b)
  let best = null
  for (const p of openRing(poly)) {
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len)
    if (t < 0 || t > 1) continue
    const d = inward * (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len
    if (!best || d < best.d) best = { d, p, q: [a[0] + t * dx, a[1] + t * dy] }
  }
  return best ?? polygonToSegment(poly, a, b)
}

/**
 * Which boundary each edge of the lot ring is. The brief's own roles when they describe this ring; otherwise the
 * envelope generator's nearest-bound rule (front nearest y = 0, rear nearest the back, the rest sides).
 */
export function lotEdgeRoles(brief) {
  const ring = openRing(brief.lotPolygon ?? [])
  if (Array.isArray(brief.edgeRoles) && brief.edgeRoles.length === ring.length && !brief.insetApprox) return brief.edgeRoles
  const b = bbox(ring)
  return ring.map((a, i) => {
    const c = ring[(i + 1) % ring.length]
    const mx = (a[0] + c[0]) / 2
    const my = (a[1] + c[1]) / 2
    return [{ role: 'front', gap: my - b.y0 }, { role: 'rear', gap: b.y1 - my }, { role: 'side', gap: Math.min(mx - b.x0, b.x1 - mx) }]
      .reduce((p, q) => (q.gap < p.gap ? q : p)).role
  })
}

/**
 * The setback each kind of boundary actually gets: for every role, the nearest any block comes to an edge of that
 * role, with the two points so the page can draw the dimension line.
 */
export function measureSetbacks(blocks, brief) {
  const ring = openRing(brief.lotPolygon ?? [])
  if (ring.length < 3 || !blocks.length) return []
  const roles = lotEdgeRoles(brief)
  let wind = 0
  for (let i = 0; i < ring.length; i++) wind += ring[i][0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * ring[i][1]
  const inward = wind >= 0 ? 1 : -1
  const out = new Map()
  for (const b of blocks) {
    const fp = blockRing(b)
    for (let i = 0; i < ring.length; i++) {
      const role = roles[i] ?? 'side'
      const m = setbackToSegment(fp, ring[i], ring[(i + 1) % ring.length], inward)
      const cur = out.get(role)
      if (!cur || m.d < cur.actual) out.set(role, { role, actual: m.d, from: b.name, p: m.p, q: m.q, edge: i })
    }
  }
  return [...out.values()].map(m => ({
    ...m,
    actual: r2(m.actual),
    required: Number(brief.setbacks?.[m.role] ?? brief.setbacks?.side ?? 0),
    clause: brief.setbackClauses?.[m.role] ?? null,
  }))
}

const ROLE_LABEL = { front: 'Front setback', rear: 'Rear setback', side: 'Side setback', secondary: 'Secondary frontage setback' }
const fmt = (n, d = 1) => (Number.isFinite(n) ? Number(n).toFixed(d).replace(/\.0+$/, '') : '—')

/**
 * Every check for a set of blocks: the design checks (envelope, title, height, clash, floor area, coverage, landscaping,
 * open space, parking), the setback to each kind of boundary, and the two lot standards - each with the clause it
 * answers to. `brief.sources` names where the plan-level figures came from (the RAG's clause labels).
 */
export function checkSiting(blocks, brief) {
  const scheme = blocksToScheme(blocks, brief)
  // design-check reads the floor-area cap as an FSR; hand it the cap as a ratio so the arithmetic is the plans' own
  const fsr = brief.gfaCap && brief.siteArea ? brief.gfaCap / brief.siteArea : null
  const base = checkScheme(scheme, { ...brief, fsr })
  const src = brief.sources ?? {}
  const checks = base.checks.filter(c => c.id !== 'clash' || c.status !== 'pass').map((c) => {
    if (c.id === 'fsr' && fsr) {
      return { ...c, required: `${Math.round(brief.gfaCap)} m² (${brief.gfaExpr ?? `FSR ${fmt(fsr, 2)}:1`})`, clause: src.fsr ?? c.clause }
    }
    // no cap because the plans have not settled one (Randwick cl 4.4 against cl 4.4A), not because none applies
    if (c.id === 'fsr' && !fsr && brief.fsrVerdict === 'maybe') {
      return { ...c, tier: 'advisory', status: 'warn', required: 'undecided - the plans’ floor-space figures compete', clause: 'see Floor area above',
        detail: [`${Math.round(base.metrics.gfa)} m² drawn; open the floor area figure for the competing clauses`] }
    }
    if (c.id === 'height') return { ...c, clause: src.height ?? c.clause }
    if (c.id === 'envelope') return { ...c, label: 'Inside the buildable area', clause: null }
    return c
  })

  // Landscaped area as the DCPs define it - the site less buildings and hard paving - rather than only the yards the
  // scheme draws. Paving is the car spaces plus a 3 m driveway from the street to each one: an estimate, said so.
  const paved = scheme.parking.reduce((sum, p) => sum + 2.6 * 5.4 + 3 * Math.max(0, p.y - 2.7), 0)
  const soft = Math.max(0, (Number(brief.siteArea) || 0) - base.metrics.coverage - paved)
  for (const c of checks) {
    if (c.id !== 'landscaping' && c.id !== 'deep_soil') continue
    const ctl = String(c.required).match(/([\d.]+)%/)
    const pct = brief.siteArea ? soft / brief.siteArea * 100 : 0
    c.actual = `${pct.toFixed(1)}% (${Math.round(soft)} m²)`
    if (ctl) c.status = pct >= Number(ctl[1]) ? 'pass' : 'warn'
    c.detail = [c.id === 'deep_soil'
      ? 'Taken as the unbuilt, unpaved area: no basement or paving beyond the driveway is modelled.'
      : `Site less building footprints (${Math.round(base.metrics.coverage)} m²) and an estimated ${Math.round(paved)} m² of driveway and car spaces.`]
  }

  const setbacks = measureSetbacks(blocks, brief)
  for (const s of setbacks) {
    const held = s.clause && s.clause !== 'default'
    checks.splice(1, 0, {
      id: `setback_${s.role}`,
      tier: held ? 'hard' : 'advisory',
      label: ROLE_LABEL[s.role] ?? `${s.role} setback`,
      required: `${fmt(s.required)} m min`,
      actual: s.actual < 0 ? `${fmt(-s.actual, 2)} m over the boundary (${s.from.replace(/_/g, ' ')})` : `${fmt(s.actual, 2)} m (${s.from.replace(/_/g, ' ')})`,
      status: s.actual + 0.01 >= s.required ? 'pass' : (held ? 'fail' : 'warn'),
      clause: held ? `DCP cl ${s.clause}` : 'no DCP control held - a default was used',
      detail: [],
    })
  }

  if (brief.minLotSize) {
    checks.push({ id: 'lot_size', tier: 'hard', label: 'Minimum lot size', required: `${Math.round(brief.minLotSize)} m²`,
      actual: `${Math.round(brief.siteArea)} m²`, status: brief.siteArea >= brief.minLotSize ? 'pass' : 'fail', clause: src.lot_size ?? null, detail: [] })
  }
  if (brief.minLotWidth && brief.frontage) {
    checks.push({ id: 'lot_width', tier: 'hard', label: 'Minimum lot width', required: `${fmt(brief.minLotWidth)} m`,
      actual: `${fmt(brief.frontage, 1)} m frontage`, status: brief.frontage >= brief.minLotWidth ? 'pass' : 'fail', clause: src.lot_width ?? null, detail: [] })
  }

  const hard = checks.filter(c => c.tier === 'hard' && c.status === 'fail')
  return { pass: hard.length === 0, checks, setbacks, metrics: base.metrics, scheme }
}

/**
 * Which control limits this lot for this type: the floor area the envelope could hold at the storeys the height allows,
 * against the floor area the plans allow. One sentence's worth of numbers.
 */
export function bindingControl(brief) {
  const env = polygonArea(brief.buildablePolygon ?? []) * fitStoreys(Number(brief.height) || 8.5, 2).storeys
  const cap = Number(brief.gfaCap) || null
  if (!env) return null
  if (!cap) return { binds: 'envelope', envelopeArea: Math.round(env), capArea: null }
  return { binds: cap < env ? 'floor area' : 'envelope', envelopeArea: Math.round(env), capArea: Math.round(cap) }
}

/**
 * A lot ring with its near-collinear vertices removed, for insetting.
 *
 * Cadastral rings carry survey kinks: a 1.3 m stub that turns 2 degrees off the side boundary, a vertex in the middle
 * of a straight frontage. The envelope insets each edge by the setback its role carries, and a 9 m front setback
 * applied to a 1.3 m stub folds the inset inside out - so the envelope fell back to an axis-aligned rectangle, which
 * on a skewed lot (7 Excelsior Rd, Mount Colah: a parallelogram) left 69 m2 of a 900 m2 lot buildable. Dropping
 * vertices whose heading changes by less than `degrees` leaves the boundary the eye sees, and the area moves by the
 * sliver of each kink. Works on [lon, lat] or metric rings alike; the ring is returned closed.
 */
export function simplifyRing(ring, degrees = 10) {
  let pts = openRing(ring)
  if (pts.length <= 4) return closeRing(pts)
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const k = Math.abs(lat) <= 90 && pts.every(p => Math.abs(p[0]) <= 180) ? Math.cos(lat * Math.PI / 180) : 1
  const heading = (a, b) => Math.atan2(b[1] - a[1], (b[0] - a[0]) * k)
  let changed = true
  while (changed && pts.length > 4) {
    changed = false
    let worst = -1
    let worstTurn = Infinity
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      let t = Math.abs(heading(b, c) - heading(a, b))
      if (t > Math.PI) t = 2 * Math.PI - t
      if (t < worstTurn) { worstTurn = t; worst = i }
    }
    if (worstTurn * 180 / Math.PI < degrees) { pts = pts.filter((_, i) => i !== worst); changed = true }
  }
  return closeRing(pts)
}
