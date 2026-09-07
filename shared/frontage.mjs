/**
 * Matching a lot's recorded frontages onto the actual boundary edges.
 *
 * Three Martin layers hold the pieces and none of them holds the answer:
 *
 *   lot_metrics_3        polygon, one per parcel. Carries `all_frontages`
 *                        ("HIGH:39.89m,BELMORE:25.94m") and
 *                        `all_edges_measurements` ("39.42m,25.31m,39.89m,…").
 *   lot_metrics_3_edges  one LineString per boundary edge, with `edge_index`
 *                        and `edge_length_m`, joined on `objectid`.
 *   road_segments        the road centrelines, with `roadnamebase` /
 *                        `roadnametype`.
 *
 * `all_edges_measurements` is ordered to match `edge_index` exactly — verified
 * against tiles, e.g. objectid 1552422 lists "39.42m,25.31m,39.89m,12.23m,
 * 13.70m" and its edges come back as [0:39.42, 1:25.31, 2:39.89, 3:12.23,
 * 4:13.70]. So a frontage is placed on the boundary by matching its length
 * against the edge lengths.
 *
 * A frontage is a *run* of consecutive edges, not one edge. Matching each
 * frontage to a single nearest edge placed only 69% of them; the misses were
 * not near-misses but exact sums of neighbouring edges, e.g. "ST PAULS:73.14m"
 * against edges [23.85, 12.64, 5.50, 36.65, 6.32] is 23.85 + 12.64 + 36.65,
 * and "AVOCA:19.47m" against [… 2.40, 17.07 …] is 2.40 + 17.07. That is what
 * a frontage is: the stretch of boundary facing one road, which the metrics
 * table records as a total while the edge table splits it at every corner.
 *
 * So the search is over consecutive runs, shortest first, and the drawn line
 * is the whole run. The run is cyclic because edge 0 follows the last edge
 * around the ring.
 *
 * A frontage that still finds no run is reported unmatched rather than drawn
 * on a guess — usually because the lot straddles a tile boundary and some of
 * its edges were clipped away. A frontage length painted on the wrong boundary
 * is worse than one that is only listed in the panel.
 *
 * `primary_frontage_road` holds only the name stem — "ANZAC", never "ANZAC
 * PARADE". The street type comes from the nearest road_segments feature with
 * the same `roadnamebase`.
 */

/** Road names the source records as unnamed, e.g. "Unnamed_142401". */
const UNNAMED = /^unnamed_?\d*$/i

/** How far a frontage length may sit from an edge length and still be it. */
export function lengthTolerance(metres) {
  return Math.max(0.6, metres * 0.03)
}

/**
 * "HIGH:39.89m,BELMORE:25.94m" -> [{ road, length }], primary first.
 *
 * Split on the last colon in each entry, because a road name can contain one
 * and a length never does.
 */
export function parseFrontages(value) {
  if (typeof value !== 'string' || !value.trim()) return []
  const out = []
  for (const part of value.split(',')) {
    const entry = part.trim()
    if (!entry) continue
    const at = entry.lastIndexOf(':')
    if (at === -1) continue
    const road = entry.slice(0, at).trim()
    const length = Number.parseFloat(entry.slice(at + 1))
    if (!road || !Number.isFinite(length) || length <= 0) continue
    out.push({ road, length, unnamed: UNNAMED.test(road) })
  }
  return out
}

/** "39.42m,25.31m,39.89m" -> [39.42, 25.31, 39.89], indexed by edge_index. */
export function parseEdgeMeasurements(value) {
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split(',')
    .map(s => Number.parseFloat(s))
    .map(n => (Number.isFinite(n) ? n : null))
}

/**
 * Join a run of consecutive edges into one polyline.
 *
 * The edges of a ring are stored head-to-tail, but nothing guarantees the
 * stored direction, so each segment is appended in whichever orientation
 * continues the line. Tile clipping can leave a genuine gap between two edges
 * of a run; the join keeps both pieces rather than inventing a bridge, which
 * shows up as a visible break instead of a wrong line.
 */
function joinRun(run) {
  const out = []
  for (const e of run) {
    const coords = e.coords || []
    if (coords.length < 2) continue
    if (!out.length) { out.push(...coords); continue }
    const tail = out[out.length - 1]
    const head = coords[0]
    const last = coords[coords.length - 1]
    // Whichever end of this edge is nearer the line so far is its start.
    const dHead = (tail[0] - head[0]) ** 2 + (tail[1] - head[1]) ** 2
    const dLast = (tail[0] - last[0]) ** 2 + (tail[1] - last[1]) ** 2
    const ordered = dLast < dHead ? [...coords].reverse() : coords
    // Drop the shared vertex when the segments actually meet.
    out.push(...(ordered[0][0] === tail[0] && ordered[0][1] === tail[1] ? ordered.slice(1) : ordered))
  }
  return out
}

/**
 * Place each frontage on the run of boundary edges it measures.
 *
 * `edges` are the lot's own edges, each `{ index, length, coords }`; they are
 * sorted here, so caller order does not matter. Frontages are matched in the
 * order given — the primary is first in `all_frontages`, so it gets first pick
 * when two frontages could claim the same stretch.
 *
 * Runs are searched shortest first, so a frontage that is exactly one edge is
 * never explained as a coincidental sum of three. `edges` on the result is the
 * matched run and `coords` its joined polyline; both are empty and `edge` is
 * null when nothing matched within tolerance.
 */
export function matchFrontageEdges(frontages, edges, { roadDistance = null } = {}) {
  const ring = [...edges].sort((a, b) => a.index - b.index)
  const n = ring.length
  const claimed = new Set()

  return frontages.map((f, i) => {
    const tol = lengthTolerance(f.length)

    // Every consecutive run that could be this frontage, not just the best one
    // by length. Which of them it actually *is* gets decided below, and on a
    // rectangular lot the length cannot decide it.
    const candidates = []
    let fallback = null
    let fallbackDelta = Infinity

    for (let start = 0; start < n; start++) {
      let sum = 0
      const run = []
      for (let k = 0; k < n; k++) {
        const e = ring[(start + k) % n]
        if (claimed.has(e.index)) break
        run.push(e)
        sum += e.length
        const delta = Math.abs(sum - f.length)
        if (delta <= tol) candidates.push({ run: [...run], delta })
        else if (delta < fallbackDelta) { fallback = [...run]; fallbackDelta = delta }
        // A run already past the target cannot be rescued by another edge.
        if (sum > f.length + tol) break
      }
    }

    const best = chooseRun(candidates, f, roadDistance)
    if (best) {
      for (const e of best.run) claimed.add(e.index)
      return {
        ...f,
        primary: i === 0,
        edge: best.run[0],
        edges: best.run,
        coords: joinRun(best.run),
        measured: best.run.reduce((s, e) => s + e.length, 0),
        delta: best.delta,
        roadDistance: best.dist ?? null,
      }
    }
    return {
      ...f, primary: i === 0, edge: null, edges: [], coords: [],
      measured: null, delta: null, roadDistance: null,
    }
  })
}

/**
 * A frontage that is 20 m from the road it names is on the front boundary; one
 * that is 60 m away is on the back fence of a deep lot. Past this, a candidate
 * is treated as not facing that road at all.
 */
const MAX_ROAD_DISTANCE_M = 45

/**
 * Decide which candidate run is the frontage.
 *
 * Length alone cannot: a terrace lot's edges run [7.2, 38.5, 6.9, 38.5], and a
 * recorded 6.87 m frontage is nearer the 6.9 m *rear* boundary than the 7.2 m
 * street one. Choosing by length put only 8% of drawn lines within 10 m of the
 * road they were labelled with — most were landing on the back fence.
 *
 * So the road decides. Among the runs whose length fits, the one closest to a
 * centreline carrying that road's name wins. Length is only the tie-break.
 *
 * `roadDistance(road, point)` returns metres to the nearest centreline of that
 * name, or null when it cannot say — the road may be unnamed, or its tiles may
 * not be loaded. Then this falls back to the old shortest-run rule, which is
 * right about as often as a coin toss on a rectangle but is all there is.
 */
function chooseRun(candidates, frontage, roadDistance) {
  if (!candidates.length) return null

  const byLength = (a, b) =>
    a.run.length - b.run.length || a.delta - b.delta

  if (roadDistance && !frontage.unnamed) {
    const scored = []
    for (const c of candidates) {
      const dist = roadDistance(frontage.road, midpoint(joinRun(c.run)))
      if (dist != null && dist <= MAX_ROAD_DISTANCE_M) scored.push({ ...c, dist })
    }
    if (scored.length) {
      scored.sort((a, b) => a.dist - b.dist || byLength(a, b))
      return scored[0]
    }
  }

  return [...candidates].sort(byLength)[0]
}

/** "ST PAULS" + "STREET" -> "St Pauls Street". */
export function titleCaseRoad(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/(^|[\s'\-/])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
}

/** Map labels get the abbreviation; the panel gets the word. */
const TYPE_ABBREV = {
  STREET: 'St', ROAD: 'Rd', AVENUE: 'Ave', PARADE: 'Pde', DRIVE: 'Dr',
  PLACE: 'Pl', COURT: 'Ct', CRESCENT: 'Cr', CLOSE: 'Cl', LANE: 'Ln',
  TERRACE: 'Tce', HIGHWAY: 'Hwy', BOULEVARD: 'Bvd', CIRCUIT: 'Cct',
  ESPLANADE: 'Esp', GROVE: 'Gr', PARKWAY: 'Pwy', WAY: 'Way', WALK: 'Walk',
}

/**
 * The road's display name.
 *
 * `type` is whatever road_segments could supply, and is often nothing: a lot
 * can front a road whose centreline is outside the tiles currently loaded. The
 * stem alone is then the honest answer — better than inventing "Street".
 */
export function roadLabel(stem, type, { abbreviate = false } = {}) {
  if (UNNAMED.test(stem)) return 'Unnamed road'
  const name = titleCaseRoad(stem)
  if (!type) return name
  const suffix = abbreviate
    ? (TYPE_ABBREV[String(type).toUpperCase()] || titleCaseRoad(type))
    : titleCaseRoad(type)
  return `${name} ${suffix}`
}

/** Midpoint of a LineString, for placing a label and measuring to a road. */
export function midpoint(coords) {
  if (!Array.isArray(coords) || !coords.length) return null
  if (coords.length === 1) return coords[0]
  const mid = coords.length / 2
  const i = Math.floor(mid)
  if (coords.length % 2 === 1) return coords[i]
  const a = coords[i - 1]
  const b = coords[i]
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** Squared degrees — only ever compared against itself, so no projection. */
function distSq(a, b) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

/**
 * Metres from a point to a polyline, measured to the segments, not the
 * vertices.
 *
 * Vertex distance is not good enough here: a straight road is often two points
 * a hundred metres apart, and a lot sitting halfway along it would measure as
 * 50 m from the road it fronts. Degrees are scaled to metres about the point's
 * own latitude, which is exact enough over the few hundred metres involved.
 */
export function distanceToPolyline(pt, coords) {
  if (!Array.isArray(coords) || coords.length === 0) return Infinity
  const mPerDegLat = 111132
  const mPerDegLon = 111320 * Math.cos((pt[1] * Math.PI) / 180)
  const px = pt[0] * mPerDegLon
  const py = pt[1] * mPerDegLat

  let best = Infinity
  for (let i = 0; i < coords.length; i++) {
    const ax = coords[i][0] * mPerDegLon
    const ay = coords[i][1] * mPerDegLat
    if (i === coords.length - 1) {
      best = Math.min(best, Math.hypot(px - ax, py - ay))
      break
    }
    const bx = coords[i + 1][0] * mPerDegLon
    const by = coords[i + 1][1] * mPerDegLat
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    // Project onto the segment, clamped to its ends.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
  }
  return best
}

/**
 * A `roadDistance` callback for matchFrontageEdges, over an index of
 * roadnamebase -> [{ type, coords }].
 *
 * Returns null when the name is not in the index at all, which the matcher
 * reads as "cannot say" rather than "far away" — the road's tile may simply
 * not be loaded.
 */
export function roadDistanceVia(roads) {
  return (road, pt) => {
    if (!pt) return null
    const candidates = roads.get(String(road ?? '').toUpperCase())
    if (!candidates || !candidates.length) return null
    let best = Infinity
    for (const c of candidates) best = Math.min(best, distanceToPolyline(pt, c.coords))
    return Number.isFinite(best) ? best : null
  }
}

/**
 * The street type for a frontage, from the nearest road centreline sharing its
 * name stem.
 *
 * `roads` is a Map of upper-cased `roadnamebase` -> [{ type, coords }]. Two
 * roads in one suburb can share a base ("Victoria Street" and "Victoria Road"),
 * which is why the nearest one wins rather than the first.
 */
export function resolveRoadType(stem, roads, near) {
  const candidates = roads.get(String(stem ?? '').toUpperCase())
  if (!candidates || !candidates.length) return null
  if (candidates.length === 1) return candidates[0].type
  if (!near) return candidates[0].type

  let best = null
  let bestDist = Infinity
  for (const c of candidates) {
    for (const pt of c.coords) {
      const d = distSq(pt, near)
      if (d < bestDist) { bestDist = d; best = c }
    }
  }
  return best ? best.type : null
}
