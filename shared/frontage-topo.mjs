/**
 * Which of a lot's boundaries face a road, decided by topology rather than distance.
 *
 * The lot_metrics pipelines decide frontage by measuring from the boundary to a
 * road centreline and keeping what falls inside a 15 m buffer. That fails
 * whenever the road reserve is wide — 708,058 of 3,233,618 NSW lots (21.9%) come
 * back with num_frontages = 0 — and it fails silently, because a zero cannot be
 * told apart from "no road nearby". Lot A DP408911 is one of them: a 2.15 ha
 * school site on the Princes Highway with 390 m of open boundary, recorded as
 * having no frontage at all.
 *
 * The centreline is the wrong instrument. In a complete cadastre a boundary is
 * either shared with a neighbouring parcel or it is not, and the ones that are
 * not are the ones facing something else — road reserve, water, rail, a
 * dedication. That is a question about the parcel fabric, and it is answered
 * exactly, with no tolerance to tune. Distance to a centreline is then only
 * needed to put a *name* on a frontage already known to exist. Simon Greener
 * sets the method out at spdba.com.au ("The Frontage Problem"); ET GeoWizards
 * arrives at the same algorithm independently.
 *
 * WHY INTERVALS AND NOT SEGMENT MATCHING
 *
 * The published form of the method segmentises every polygon into two-point
 * lines and keeps the ones appearing once, so shared boundaries cancel. That
 * assumes a node-matched cadastre. Real ones are not: where a third lot meets a
 * boundary, one side carries a vertex the other lacks, so a long segment never
 * cancels against the two short ones facing it and the interior boundary is
 * reported as frontage. Chamfers and slivers do the same.
 *
 * So nothing here matches segments. Each boundary edge is treated as an interval
 * [0,1], every near-collinear neighbour edge lying within `tolerance` of it is
 * projected onto that interval, and the covered spans are subtracted. What
 * survives is frontage. Vertex mismatch, T-junctions and slivers all fall out of
 * this for free, because an interval does not care how its neighbour was
 * digitised.
 *
 * NO DEPENDENCIES, NO PROJECTION LIBRARY
 *
 * Work happens in a local east-north frame centred on the lot, following
 * geo-measure.mjs: over a parcel the departure from the ellipsoid is well under
 * a centimetre, and these numbers are read against controls quoted to 0.1 m.
 * That keeps this module usable from a script, the Nuxt server, and a test with
 * no database and no proj build.
 *
 * Verified against Lot A DP408911 (SIX Maps cadastre): edges 27.78 / 208.67 /
 * 233.74 / 181.66 m reproduce `all_edges_measurements` from lot_metrics_gnaf
 * exactly, and the method finds edge 0 shared with 1//DP830604, edge 2 shared
 * with B//DP408911, and edges 1 and 3 open — 389.67 m of frontage where the
 * pipeline recorded none.
 */

/** Mean Earth radius, metres (IUGG) — same constant as geo-measure.mjs. */
const EARTH_R = 6371008.8
const rad = (d) => (d * Math.PI) / 180

/**
 * How far apart two boundaries may be and still count as the same line.
 *
 * Survey coordinates for a shared boundary agree to millimetres, so this is
 * slack for digitising noise, not a real search radius. Raising it starts
 * swallowing narrow strips — an 0.5 m drainage easement between two lots is a
 * real parcel, and at tolerance 0.5 it would vanish and both lots would lose a
 * boundary they genuinely have.
 */
export const DEFAULT_TOLERANCE_M = 0.15

/** Bearings within this of parallel (or antiparallel) are the same line. */
export const DEFAULT_COLLINEAR_DEG = 8

/**
 * Shortest stretch of open boundary reported as a frontage.
 *
 * This is a minimum for a whole *run*, never for one edge, and the difference is
 * not academic. 17//DP258140 fronts a curved street the cadastre stores as ten
 * chords of about 1.68 m; testing each chord against 3 m discarded every one of
 * them and the lot came back with no frontage at all — the same class of failure
 * as the pipeline this replaces, arrived at from the other direction. Runs are
 * joined first and filtered afterwards.
 *
 * Lowered from 3 m to 2 m: a battle-axe's entrance IS its frontage, and handles
 * narrower than 3 m are common enough that the floor was discarding the one run
 * that mattered. Those lots still reported a frontage, taken off some other
 * boundary, which is worse than reporting none. Nothing in the cadastre makes
 * 3 m a real threshold, and a 2 m handle is a real handle.
 */
export const MIN_RUN_M = 2

/**
 * Slivers below this are digitising noise, not boundary.
 *
 * Applied per edge, where MIN_RUN_M must not be: a curved frontage is made of
 * short chords and every one of them is real.
 */
const EDGE_SPAN_EPSILON_M = 0.05

/** Shared boundary above this is worth naming the neighbour for. */
const MIN_ABUT_M = 0.5

/**
 * Bearing change between *consecutive* edges that ends a run.
 *
 * A corner is one abrupt turn; a curve is many small ones. Measuring against the
 * run's first edge cannot tell them apart, and on 121//DP836880 — a cul-de-sac
 * head stored as 29 chords of 0.86 m sweeping smoothly through 74 degrees — it
 * split one continuous frontage in two at the point cumulative drift passed 45
 * degrees, then reported the halves as a corner lot. Each step there is 2.6
 * degrees, nothing like a corner.
 *
 * 45 degrees separates all three shapes that matter. A cul-de-sac steps 2.6 and
 * stays joined. 1//DP214129's 3.75 m chamfer turns 42.8 in one step and stays
 * with the side it came from, as a surveyor would read it. A true corner turns
 * about 90 and breaks.
 */
export const STEP_BREAK_DEG = 45

/**
 * Total curvature one run may accumulate.
 *
 * A cul-de-sac head wraps 74 degrees on 121//DP836880 and must stay whole, while
 * 260//DP979237's corner turns 108 degrees through steps small enough that no
 * single one breaks the run — at 150 the two streets merged into one 110 m
 * frontage and the lot stopped being a corner. 80 separates them.
 *
 * Splitting too eagerly is the safe direction: naming runs per-run and merging
 * by street name afterwards reassembles anything cut in the wrong place, so a
 * split corner recovers while a merged one cannot.
 */
export const MAX_ARC_DEG = 80

/**
 * A local east-north frame in metres, centred on `origin` as [lng, lat].
 *
 * Returned rather than applied so a caller can carry results back to WGS-84 for
 * drawing — a frontage you cannot put on a map is half an answer, and the whole
 * reason the existing shared/frontage.mjs has to reverse-engineer geometry from
 * lengths is that the pipeline discarded it.
 */
export function localFrame(origin) {
  const [lon0, lat0] = origin
  const mPerDegLat = (Math.PI / 180) * EARTH_R
  const mPerDegLon = mPerDegLat * Math.cos(rad(lat0))
  return {
    toLocal: ([lng, lat]) => [(lng - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat],
    toWgs: ([x, y]) => [lon0 + x / mPerDegLon, lat0 + y / mPerDegLat],
  }
}

/** Mean of a ring's vertices — good enough as a projection origin. */
export function ringOrigin(ring) {
  let sx = 0, sy = 0, n = 0
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    sx += lng; sy += lat; n++
  }
  return n ? [sx / n, sy / n] : [0, 0]
}

/**
 * Every two-point edge of a ring, in local metres.
 *
 * Zero-length steps are dropped — a repeated vertex has no bearing, and leaving
 * it in would give the collinearity test a meaningless angle to compare.
 */
export function ringEdges(ringLocal) {
  const out = []
  for (let i = 0; i < ringLocal.length - 1; i++) {
    const a = ringLocal[i]
    const b = ringLocal[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    if (length <= 1e-9) continue
    out.push({
      index: out.length, a, b, dx, dy, length,
      bearing: (Math.atan2(dx, dy) * 180) / Math.PI,
      // Cached for the reject in sharedSpansFor: computed once per edge here
      // rather than once per edge PAIR there.
      minx: a[0] < b[0] ? a[0] : b[0],
      maxx: a[0] > b[0] ? a[0] : b[0],
      miny: a[1] < b[1] ? a[1] : b[1],
      maxy: a[1] > b[1] ? a[1] : b[1],
    })
  }
  return out
}

/** Undirected angle between two bearings, folded to 0..90. */
function bearingDelta(a, b) {
  const d = Math.abs(a - b) % 180
  return Math.min(d, 180 - d)
}

/** Where `p` falls along edge `e`, as a parameter, plus its perpendicular offset. */
function projectOnto(e, p) {
  const t = ((p[0] - e.a[0]) * e.dx + (p[1] - e.a[1]) * e.dy) / (e.length * e.length)
  const cx = e.a[0] + t * e.dx
  const cy = e.a[1] + t * e.dy
  return { t, offset: Math.hypot(p[0] - cx, p[1] - cy) }
}

/** Merge overlapping [t0,t1] spans into a disjoint ascending set. */
function mergeSpans(spans) {
  if (!spans.length) return []
  const sorted = [...spans].sort((x, y) => x[0] - y[0])
  const out = [sorted[0]]
  for (const [s, e] of sorted.slice(1)) {
    const last = out[out.length - 1]
    if (s <= last[1] + 1e-9) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/** The parts of [0,1] that `spans` do not cover. */
function invertSpans(spans, minLen) {
  const out = []
  let cursor = 0
  for (const [s, e] of spans) {
    if (s - cursor > minLen) out.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (1 - cursor > minLen) out.push([cursor, 1])
  return out
}

/**
 * The spans of `edge` that a neighbouring parcel lies along.
 *
 * A neighbour edge counts when it is near-parallel to this one AND both its
 * endpoints sit within `tolerance` of this edge's line. Requiring both ends
 * keeps a boundary that merely crosses at a point — the far side of a road, a
 * lot meeting this one end-on — from claiming any span.
 */
export function sharedSpansFor(edge, neighbourEdges, opts = {}) {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE_M
  const collinearDeg = opts.collinearDeg ?? DEFAULT_COLLINEAR_DEG
  const spans = []
  // Two edges further apart than `tolerance` cannot share a boundary, and a bbox
  // test says so in four comparisons. Exact - it only skips pairs the projection
  // below would have rejected anyway - but in a dense block the overwhelming
  // majority of candidate pairs are nowhere near each other.
  const eMinX = edge.minx - tolerance
  const eMaxX = edge.maxx + tolerance
  const eMinY = edge.miny - tolerance
  const eMaxY = edge.maxy + tolerance
  for (const n of neighbourEdges) {
    if (n.minx > eMaxX || n.maxx < eMinX || n.miny > eMaxY || n.maxy < eMinY) continue
    if (bearingDelta(edge.bearing, n.bearing) > collinearDeg) continue
    const pa = projectOnto(edge, n.a)
    const pb = projectOnto(edge, n.b)
    if (pa.offset > tolerance || pb.offset > tolerance) continue
    const t0 = Math.max(0, Math.min(pa.t, pb.t))
    const t1 = Math.min(1, Math.max(pa.t, pb.t))
    if (t1 - t0 > 1e-9) spans.push([t0, t1])
  }
  return mergeSpans(spans)
}

/** Point at parameter `t` along an edge. */
function pointAt(e, t) {
  return [e.a[0] + t * e.dx, e.a[1] + t * e.dy]
}

/**
 * Classify every boundary of `lotRing` as shared or open.
 *
 * `lotRing` and each of `neighbours` are closed rings of [lng, lat]. Neighbours
 * must be *complete* around the lot: a parcel left out makes its boundary look
 * open, and the lot gains frontage it does not have. That is the one way this
 * method fails, so `neighbourCount` is reported for the caller to sanity-check
 * rather than left implicit.
 *
 * Returns per-edge records and the open runs joined around the ring, each with
 * WGS-84 coordinates ready to draw.
 */
export function classifyBoundary(lotRing, neighbours, opts = {}) {
  const minRun = opts.minRun ?? MIN_RUN_M
  const origin = ringOrigin(lotRing)
  const { toLocal, toWgs } = localFrame(origin)

  const edges = ringEdges(lotRing.map(toLocal))

  // Only a parcel whose extent comes within `tolerance` of this lot's can share a
  // boundary with it. Callers may hand over every parcel in a wide window - and
  // each one otherwise costs a full ring projection plus an edge-pair sweep.
  // Tested in degrees so a rejected ring is never projected. `index` is kept so
  // `abuts` still refers to the caller's array and skipping changes nothing.
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE_M
  const padLat = tolerance / 110574
  const padLon = padLat / Math.max(0.2, Math.cos((origin[1] * Math.PI) / 180))
  let lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity, lMaxY = -Infinity
  for (const p of lotRing) {
    if (p[0] < lMinX) lMinX = p[0]
    if (p[0] > lMaxX) lMaxX = p[0]
    if (p[1] < lMinY) lMinY = p[1]
    if (p[1] > lMaxY) lMaxY = p[1]
  }
  lMinX -= padLon; lMaxX += padLon; lMinY -= padLat; lMaxY += padLat

  const neighbourEdges = []
  for (let i = 0; i < neighbours.length; i++) {
    const ring = neighbours[i]
    let nMinX = Infinity, nMaxX = -Infinity, nMinY = Infinity, nMaxY = -Infinity
    for (const p of ring) {
      if (p[0] < nMinX) nMinX = p[0]
      if (p[0] > nMaxX) nMaxX = p[0]
      if (p[1] < nMinY) nMinY = p[1]
      if (p[1] > nMaxY) nMaxY = p[1]
    }
    if (nMinX > lMaxX || nMaxX < lMinX || nMinY > lMaxY || nMaxY < lMinY) continue
    neighbourEdges.push({ index: i, ring, edges: ringEdges(ring.map(toLocal)) })
  }

  const records = edges.map((edge) => {
    const abuts = []
    const allSpans = []
    for (const nbr of neighbourEdges) {
      const spans = sharedSpansFor(edge, nbr.edges, opts)
      const covered = spans.reduce((s, [a, b]) => s + (b - a), 0) * edge.length
      if (covered > MIN_ABUT_M) abuts.push({ neighbour: nbr.index, length_m: round2(covered) })
      allSpans.push(...spans)
    }
    const shared = mergeSpans(allSpans)
    const open = invertSpans(shared, EDGE_SPAN_EPSILON_M / edge.length)
    const sharedLen = shared.reduce((s, [a, b]) => s + (b - a), 0) * edge.length
    return {
      index: edge.index,
      length_m: round2(edge.length),
      shared_m: round2(sharedLen),
      open_m: round2(edge.length - sharedLen),
      bearing_deg: round2((edge.bearing + 360) % 360),
      abuts,
      openSpans: open.map(([t0, t1]) => ({
        t0, t1,
        length_m: round2((t1 - t0) * edge.length),
        coords: [toWgs(pointAt(edge, t0)), toWgs(pointAt(edge, t1))],
      })),
    }
  })

  return {
    origin,
    neighbourCount: neighbours.length,
    edges: records,
    runs: joinRuns(records, opts),
    total_boundary_m: round2(records.reduce((s, r) => s + r.length_m, 0)),
    total_open_m: round2(records.reduce((s, r) => s + r.open_m, 0)),
  }
}

/**
 * Group open spans into runs of consecutive boundary.
 *
 * A frontage is a stretch of boundary facing one road, and the cadastre splits
 * it at every corner and every chamfer — the same observation shared/
 * frontage.mjs had to make in reverse, by searching for consecutive edge runs
 * whose lengths summed to a recorded total. Here the run is known directly.
 *
 * The ring is cyclic, so a run that starts mid-ring and wraps past edge 0 is one
 * run, not two; the wrap is stitched after the linear pass.
 */
export function joinRuns(records, opts = {}) {
  const stepBreakDeg = opts.stepBreakDeg ?? STEP_BREAK_DEG
  const maxArcDeg = opts.maxArcDeg ?? MAX_ARC_DEG
  const runs = []
  let current = null

  const start = (rec, span) => ({
    edges: [rec.index],
    length_m: span.length_m,
    coords: [span.coords[0], span.coords[1]],
    refBearing: rec.bearing_deg,
    prevBearing: rec.bearing_deg,
    endsAtEdge: rec.index,
    endsAtRingEnd: span.t1 >= 1 - 1e-6,
  })

  for (const rec of records) {
    for (const span of rec.openSpans) {
      const continues = current
        && current.endsAtEdge === rec.index - 1
        && current.endsAtRingEnd
        && span.t0 <= 1e-6
        // An abrupt turn ends the run; gradual curvature does not, up to a cap.
        && angleDiff(rec.bearing_deg, current.prevBearing) <= stepBreakDeg
        && angleDiff(rec.bearing_deg, current.refBearing) <= maxArcDeg
      if (continues) {
        current.edges.push(rec.index)
        current.length_m = round2(current.length_m + span.length_m)
        current.coords.push(span.coords[1])
        current.endsAtEdge = rec.index
        current.prevBearing = rec.bearing_deg
        current.endsAtRingEnd = span.t1 >= 1 - 1e-6
      } else {
        if (current) runs.push(current)
        current = start(rec, span)
      }
    }
  }
  if (current) runs.push(current)

  // Stitch a run that wraps past edge 0 — the ring is cyclic, so a frontage
  // starting mid-ring and continuing through the closing vertex is one run.
  if (runs.length > 1) {
    const first = runs[0]
    const last = runs[runs.length - 1]
    const lastVertex = last.coords[last.coords.length - 1]
    const meets = Math.abs(first.coords[0][0] - lastVertex[0]) < 1e-9
      && Math.abs(first.coords[0][1] - lastVertex[1]) < 1e-9
    if (last.endsAtEdge === records[records.length - 1].index && last.endsAtRingEnd
        && first.edges[0] === records[0].index && meets
        && angleDiff(first.refBearing, last.prevBearing) <= stepBreakDeg
        // The arc cap has to apply here too. The linear pass tests it at every
        // edge; the stitch used to test only the step, so 203//DP832775 — two
        // gently curving sides meeting through a 6 m corner splay in two ~41
        // degree steps — joined into one 54.63 m "frontage" wrapping a corner,
        // because no single step reached 45 while the total turn was 86.5.
        && angleDiff(first.prevBearing, last.refBearing) <= maxArcDeg) {
      last.edges.push(...first.edges)
      last.length_m = round2(last.length_m + first.length_m)
      last.coords.push(...first.coords.slice(1))
      // Without this the stitched run keeps the pre-stitch bearing and arc_deg
      // describes only the fragment before the wrap.
      last.prevBearing = first.prevBearing
      runs.shift()
    }
  }

  return runs
    .filter((r) => r.length_m >= MIN_RUN_M)
    .map(({ endsAtEdge, endsAtRingEnd, refBearing, prevBearing, ...r }) => ({
      ...r,
      bearing_deg: round2(refBearing),
      // How far the run turns end to end — a straight boundary is ~0, a
      // cul-de-sac head tens of degrees. Lets a consumer see a curve as a curve.
      arc_deg: round2(angleDiff(prevBearing, refBearing)),
    }))
    .sort((a, b) => b.length_m - a.length_m)
}

/** Absolute difference between two bearings, folded to 0..180. */
function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function round2(n) {
  return Math.round(n * 100) / 100
}
