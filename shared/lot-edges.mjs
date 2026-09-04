/**
 * Boundary sides of a lot, for labelling on a map.
 *
 * Ported from the property-report (safebuy.app) treatment, which draws a
 * length pill on each side of the parcel rather than listing side lengths
 * beside the map. Two ideas do the work, and both matter:
 *
 *   mergeCollinearEdges  A cadastral polygon is not drawn the way a person
 *                        reads a block. One straight street boundary is
 *                        routinely stored as several vertices, so the raw
 *                        ring yields "sides" nobody would name — Hornsby's
 *                        sample lot lists nine, including a 1.19 m sliver.
 *                        Merging consecutive edges whose bearings agree
 *                        within a few degrees recovers the four or five
 *                        sides the block actually has.
 *
 *   sliver filtering     Even after merging, chamfered corners leave short
 *                        stubs. Labelling them adds noise, not information.
 *
 * Placement declutter lives with the renderer, since it needs the map's
 * projection.
 */

import { haversine, bearing, midpoint } from './geo-measure.mjs'

/**
 * Per-edge records for one closed ring of [lng, lat] points.
 * Sub-half-metre steps are dropped before any merging: they are digitising
 * noise and their bearings are meaningless, so leaving them in breaks the
 * collinearity test that follows.
 */
export function computeLotEdges(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return []
  const edges = []
  for (let i = 0; i < ring.length - 1; i++) {
    const from = ring[i]
    const to = ring[i + 1]
    if (!from || !to) continue
    const length = haversine(from, to)
    if (length < 0.5) continue
    edges.push({ from, to, mid: midpoint(from, to), length, bearing: bearing(from, to) })
  }
  return edges
}

/** Merge consecutive edges whose bearings agree within `angleTolerance` degrees. */
export function mergeCollinearEdges(edges, angleTolerance = 5) {
  if (edges.length < 2) return edges
  const merged = [{ ...edges[0] }]
  for (let i = 1; i < edges.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = edges[i]
    let diff = Math.abs(prev.bearing - curr.bearing)
    if (diff > 180) diff = 360 - diff
    if (diff < angleTolerance) {
      prev.to = curr.to
      prev.mid = midpoint(prev.from, prev.to)
      prev.length = haversine(prev.from, prev.to)
      prev.bearing = bearing(prev.from, prev.to)
    } else {
      merged.push({ ...curr })
    }
  }
  // The ring closes, so the last and first edge can also be collinear.
  if (merged.length > 2) {
    const first = merged[0]
    const last = merged[merged.length - 1]
    let diff = Math.abs(first.bearing - last.bearing)
    if (diff > 180) diff = 360 - diff
    if (diff < angleTolerance) {
      first.from = last.from
      first.mid = midpoint(first.from, first.to)
      first.length = haversine(first.from, first.to)
      first.bearing = bearing(first.from, first.to)
      merged.pop()
    }
  }
  return merged
}

/**
 * Labelled sides of a lot, longest first.
 *
 * `minLength` drops stubs left by chamfered corners; longest-first ordering
 * lets the renderer place the sides that matter before it starts skipping
 * for want of room.
 */
export function lotSides(ring, { angleTolerance = 5, minLength = 3 } = {}) {
  const merged = mergeCollinearEdges(computeLotEdges(ring), angleTolerance)
  return merged
    .filter((e) => e.length >= minLength)
    .sort((a, b) => b.length - a.length)
}

/** Total length around the merged ring — used to sanity-check the geometry. */
export function ringPerimeter(ring) {
  return computeLotEdges(ring).reduce((a, e) => a + e.length, 0)
}

/** Ray-casting point-in-ring test for [lng, lat] coordinates. */
export function pointInRing(pt, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false
  const [x, y] = pt
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * The outer ring of whichever polygon in `features` contains `pt`.
 *
 * Vector tiles clip at tile edges, so a parcel straddling a boundary arrives
 * as several partial polygons. Preferring the largest match is a cheap way
 * to favour the unclipped copy where one exists; the caller still has to
 * check the result against a known perimeter before trusting it.
 */
export function findRingContaining(pt, features) {
  let best = null
  let bestLen = 0
  for (const f of features ?? []) {
    const g = f?.geometry
    if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates
        : []
    for (const poly of polys) {
      const ring = poly?.[0]
      if (!ring || !pointInRing(pt, ring)) continue
      const len = ringPerimeter(ring)
      if (len > bestLen) { best = ring; bestLen = len }
    }
  }
  return best
}
