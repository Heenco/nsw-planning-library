/**
 * Putting a road name on a frontage the topology already found.
 *
 * This runs after shared/frontage-topo.mjs and is deliberately weaker than it:
 * naming can label a run, reorder runs, or leave a run unnamed, but it can never
 * *remove* one. That restriction is the whole point. lot_metrics_gnaf decided
 * frontage by distance to a centreline, so a lot set back behind a wide reserve
 * lost its frontage entirely — 21.9% of NSW. Here the frontage is already
 * established from the parcel fabric, and a road that cannot be matched costs
 * only a name.
 *
 * WHY MOTORWAYS ARE EXCLUDED
 *
 * A motorway is access-controlled: a lot beside the M1 has no frontage to it,
 * whatever the geometry says. `functionhierarchy = 1` is that class, and
 * A//DP408911 is the case in point — the tiles carry PRINCES MOTORWAY (hier 1)
 * and PRINCES HIGHWAY (hier 2) within a couple of hundred metres of each other,
 * and only the second is a frontage. The motorway is still reported, as
 * `abutsMotorway`, because "backs onto the M1" is worth knowing; it just does
 * not name a frontage.
 *
 * WHY THE NEAREST SEGMENT AND NOT THE ROAD'S CHORD
 *
 * Bearing is taken from the road's nearest two-point segment, never from
 * start-to-end of the whole polyline. The old pipeline used the chord, which on
 * a bent road is tens of degrees off the local direction — an L-shaped road
 * reported 38.7 degrees for both of its legs, so lots on either leg failed a 25
 * degree parallelism gate while sitting 10 m from the kerb.
 *
 * WHY DISTANCE IS MEASURED FROM THE WHOLE RUN, NOT ITS MIDPOINT
 *
 * Distance is the minimum between the two polylines. Sampling the run at one
 * point — its midpoint — is what the old pipeline did, and it is wrong for
 * exactly the lots this rebuild exists for: A//DP408911's eastern boundary is
 * 182 m long and angled away from the Princes Highway, so it comes within 49.6 m
 * at one end while its midpoint sits far outside any sane radius. Measured from
 * the midpoint the frontage is anonymous; measured from the boundary it is the
 * Princes Highway. A long boundary must not be judged by one point on it.
 */

import { localFrame } from './frontage-topo.mjs'

/** functionhierarchy values that cannot carry a legal frontage. */
export const ACCESS_CONTROLLED_HIERARCHY = new Set([1])

/**
 * How far a frontage may sit from a centreline and still be named by it.
 *
 * Generous on purpose, and safe to be: this only chooses between candidate
 * names, so a large radius costs nothing but a wrong label on a lot with no
 * near road, while a small one leaves genuine frontages anonymous. One chain
 * (20.115 m) is the standard reserve in old Australian subdivisions and the
 * figure Simon Greener uses; a divided highway needs several times that.
 */
export const NAME_SEARCH_M = 80

/** Bearing agreement between the boundary and the road beside it. */
export const NAME_PARALLEL_DEG = 35

/**
 * How close a road's *end* must be to a frontage to have named it.
 *
 * A cul-de-sac centreline stops in the middle of the bulb, pointing at the lots
 * around it rather than running alongside them, so every frontage on the head
 * fails a parallelism test however it is tuned. 121//DP836880 is the case: 1040
 * centrelines read and not one accepted, because the only road there ends
 * roughly perpendicular to the boundary.
 *
 * Being the road that terminates at a boundary is strong evidence on its own —
 * it is what a cul-de-sac is — so this is a specific relaxation for a specific
 * geometry, not a general "nearest road" fallback. That was tried and it
 * labelled a motorway boundary with a highway 73 m away.
 */
export const CUL_DE_SAC_END_M = 35

/** "PRINCES" + "HIGHWAY" -> "PRINCES HIGHWAY". The base alone is ambiguous. */
export function roadLabel(road) {
  const base = String(road?.name ?? '').trim()
  if (!base || /^unnamed_?\d*$/i.test(base)) return null
  const type = String(road?.type ?? '').trim()
  return type ? `${base} ${type}` : base
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Undirected version — a road digitised the other way is the same road. */
function undirected(a, b) {
  const d = Math.abs(a - b) % 180
  return Math.min(d, 180 - d)
}

/** Distance from point `p` to segment `a`-`b`. */
function pointToSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const segBearing = (a, b) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI

/**
 * Closest approach between two polylines, and the road segment that achieves it.
 *
 * For two non-crossing segments the minimum distance is always reached at an
 * endpoint of one of them, so checking every vertex of each against the other's
 * segments is exact — no sampling, no midpoint.
 */
function closestApproach(runLocal, roadLocal) {
  let best = null
  const consider = (dist, a, b) => {
    if (!best || dist < best.dist) best = { dist, bearing: segBearing(a, b) }
  }
  for (let j = 1; j < roadLocal.length; j++) {
    const a = roadLocal[j - 1]
    const b = roadLocal[j]
    for (const p of runLocal) consider(pointToSegment(p, a, b), a, b)
  }
  for (let i = 1; i < runLocal.length; i++) {
    for (let j = 1; j < roadLocal.length; j++) {
      const a = roadLocal[j - 1]
      const b = roadLocal[j]
      // Road vertex against the run's segment — the other half of the pair.
      consider(pointToSegment(a, runLocal[i - 1], runLocal[i]), a, b)
      consider(pointToSegment(b, runLocal[i - 1], runLocal[i]), a, b)
    }
  }
  return best
}

/**
 * Name each frontage run.
 *
 * `runs` come from classifyBoundary; `roads` are `{ name, type, hierarchy,
 * coords }` with coords as [lng, lat]. `origin` should be the same one the
 * classification used so both sit in one local frame.
 *
 * Every run comes back, always, with `road` null when nothing matched. The
 * `basis` says why, because in a planning context a wrong street name is worse
 * than no street name:
 *
 *   parallel        a named road runs alongside this boundary. Trustworthy.
 *   motorway_only   the road alongside is access-controlled, so this boundary
 *                   is open but is not a street frontage.
 *   none            nothing named within range.
 *
 * There is deliberately no "nearest road, whatever its angle" fallback. It was
 * tried and it labelled A//DP408911's motorway boundary "PRINCES HIGHWAY" from
 * 73 m away at 50 degrees off, purely because the real neighbour was excluded —
 * a confident-looking answer that was simply untrue.
 */
export function nameRuns(runs, roads, origin, opts = {}) {
  const searchM = opts.searchM ?? NAME_SEARCH_M
  const parallelDeg = opts.parallelDeg ?? NAME_PARALLEL_DEG
  const { toLocal } = localFrame(origin)

  // A road further than `searchM` from every run cannot name any of them, so
  // reject it on bbox in degrees before paying to project it.
  const padLat = searchM / 110574
  const padLon = padLat / Math.max(0.2, Math.cos((origin[1] * Math.PI) / 180))
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity
  for (const run of runs) {
    for (const p of run.coords) {
      if (p[0] < bMinX) bMinX = p[0]
      if (p[0] > bMaxX) bMaxX = p[0]
      if (p[1] < bMinY) bMinY = p[1]
      if (p[1] > bMaxY) bMaxY = p[1]
    }
  }
  if (bMinX === Infinity) return []
  bMinX -= padLon; bMaxX += padLon; bMinY -= padLat; bMaxY += padLat

  // The Python port additionally caches this bbox on the road record, because the
  // pipeline hands the same fragments to thousands of lots in a grid cell. Here
  // each request analyses one lot, so there is nothing to reuse.
  const roadsLocal = []
  for (const r of roads) {
    const coords = r.coords ?? []
    if (coords.length < 2) continue
    let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity
    for (const p of coords) {
      if (p[0] < cMinX) cMinX = p[0]
      if (p[0] > cMaxX) cMaxX = p[0]
      if (p[1] < cMinY) cMinY = p[1]
      if (p[1] > cMaxY) cMaxY = p[1]
    }
    if (cMinX > bMaxX || cMaxX < bMinX || cMinY > bMaxY || cMaxY < bMinY) continue
    const local = coords.map(toLocal)
    let lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity, lMaxY = -Infinity
    for (const p of local) {
      if (p[0] < lMinX) lMinX = p[0]
      if (p[0] > lMaxX) lMaxX = p[0]
      if (p[1] < lMinY) lMinY = p[1]
      if (p[1] > lMaxY) lMaxY = p[1]
    }
    roadsLocal.push({ ...r, label: roadLabel(r), local, lMinX, lMaxX, lMinY, lMaxY })
  }

  return runs.map((run) => {
    const line = run.coords.map(toLocal)
    // Same reasoning, now per run: a road outside this run's search box is beyond
    // searchM of it, so closestApproach would only discard it.
    let wMinX = Infinity, wMaxX = -Infinity, wMinY = Infinity, wMaxY = -Infinity
    for (const p of line) {
      if (p[0] < wMinX) wMinX = p[0]
      if (p[0] > wMaxX) wMaxX = p[0]
      if (p[1] < wMinY) wMinY = p[1]
      if (p[1] > wMaxY) wMaxY = p[1]
    }
    wMinX -= searchM; wMaxX += searchM; wMinY -= searchM; wMaxY += searchM

    let best = null
    let motorway = null
    let terminating = null

    for (const road of roadsLocal) {
      if (road.lMinX > wMaxX || road.lMaxX < wMinX
        || road.lMinY > wMaxY || road.lMaxY < wMinY) continue
      const probe = closestApproach(line, road.local)
      if (!probe || probe.dist > searchM) continue

      if (undirected(run.bearing_deg, probe.bearing) > parallelDeg) {
        // Not alongside — but a road that *ends* here is the road this frontage
        // faces, whatever its angle. Held aside and used only if nothing runs
        // parallel.
        if (!ACCESS_CONTROLLED_HIERARCHY.has(Number(road.hierarchy)) && road.label) {
          const ends = [road.local[0], road.local[road.local.length - 1]]
          for (const end of ends) {
            let d = Infinity
            for (let i = 1; i < line.length; i++) {
              d = Math.min(d, pointToSegment(end, line[i - 1], line[i]))
            }
            if (d <= CUL_DE_SAC_END_M && (!terminating || d < terminating.dist)) {
              terminating = { road, dist: d, bearing: probe.bearing }
            }
          }
        }
        continue
      }

      if (ACCESS_CONTROLLED_HIERARCHY.has(Number(road.hierarchy))) {
        if (!motorway || probe.dist < motorway.dist) motorway = { label: road.label, dist: probe.dist }
        continue
      }
      if (!road.label) continue
      if (!best || probe.dist < best.dist) best = { road, ...probe }
    }

    // A motorway closer than any named street means this boundary faces the
    // corridor, not the street — report that rather than reaching for a name.
    const motorwayOnly = !!motorway && (!best || motorway.dist < best.dist)
    const pick = motorwayOnly ? null : (best ?? terminating)
    const basis = motorwayOnly ? 'motorway_only'
      : best ? 'parallel'
        : terminating ? 'cul_de_sac'
          : 'none'

    return {
      ...run,
      road: pick ? pick.road.label : null,
      road_hierarchy: pick ? (pick.road.hierarchy ?? null) : null,
      road_distance_m: pick ? Math.round(pick.dist * 100) / 100 : null,
      road_basis: basis,
      abutsMotorway: motorway ? motorway.label : null,
    }
  })
}

/**
 * Merge runs that ended up naming the same road.
 *
 * The ring is split at every corner, so one street can be two runs — a chamfered
 * frontage, or a boundary the cadastre broke at a services easement. Counting
 * those as two frontages inflates `num_frontages` and turns an ordinary lot into
 * a corner lot, which is the same double-counting the 47%-unnamed road segments
 * caused in lot_metrics_gnaf.
 *
 * Runs facing the same road at broadly the same bearing are one frontage; two
 * runs on the same road at a right angle (a lot wrapping a bend) are not.
 */
export function mergeByRoad(named, opts = {}) {
  const parallelDeg = opts.parallelDeg ?? 45
  const out = []
  for (const run of named) {
    const hit = run.road
      ? out.find((o) => o.road === run.road && undirected(o.bearing_deg, run.bearing_deg) <= parallelDeg)
      : null
    if (hit) {
      hit.length_m = Math.round((hit.length_m + run.length_m) * 100) / 100
      hit.edges = [...new Set([...hit.edges, ...run.edges])].sort((a, b) => a - b)
      hit.parts = (hit.parts ?? 1) + 1
      if (run.road_distance_m != null && (hit.road_distance_m == null || run.road_distance_m < hit.road_distance_m)) {
        hit.road_distance_m = run.road_distance_m
      }
    } else {
      out.push({ ...run })
    }
  }
  return out.sort((a, b) => b.length_m - a.length_m)
}

/**
 * Corner, through, or neither.
 *
 * The angle between two frontages, folded to 0-90, says which:
 *
 *   ~90 deg   they meet at a corner            -> corner lot
 *   ~0 deg    they face opposite ways          -> through lot (street + rear lane)
 *
 * Both matter and they are not opposites — `//SP56281` fronts AVOCA STREET, RAE
 * STREET and RAE LANE, so it is a corner lot *and* a through lot. Returning one
 * boolean would have hidden the lane, and a rear lane changes what can be built.
 *
 * Distinct road names decide it wherever they are known, because a corner lot is
 * legally about being at the intersection of two streets, not about geometry: a
 * single street bending around the lot is not a corner. Where the roads are
 * unnamed the bearings still answer, and `basis` says which test was used rather
 * than presenting a guess as a fact.
 */
export function classifyCorners(runs, opts = {}) {
  const cornerMin = opts.cornerMinDeg ?? 45
  const named = runs.filter((r) => r.road)
  const useRoads = new Set(named.map((r) => r.road)).size >= 2
  const pool = useRoads ? named : runs

  let corner = false
  let through = false
  let pair = null

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (useRoads && pool[i].road === pool[j].road) continue
      const d = undirected(pool[i].bearing_deg, pool[j].bearing_deg)
      if (d >= cornerMin) {
        if (!corner) pair = [pool[i].road ?? null, pool[j].road ?? null]
        corner = true
      } else {
        through = true
      }
    }
  }

  return {
    is_corner_lot: corner,
    is_through_lot: through,
    corner_streets: pair,
    corner_basis: pool.length < 2 ? 'single_frontage' : (useRoads ? 'roads' : 'geometry'),
  }
}

/** Uppercase, single-spaced — enough to compare an address with a road name. */
const norm = (v) => String(v ?? '').toUpperCase().replace(/\s+/g, ' ').trim()

/**
 * The frontage a property is addressed to.
 *
 * Takes one address or many. A corner lot carries address points on both
 * streets, so the useful answer is the street MOST of them name rather than
 * whichever came back first — the modal street, as the G-NAF rebuild put it.
 *
 * Within a single address, the longest matching label wins, so "HIGH STREET
 * SOUTH" is not beaten by "HIGH STREET" appearing inside it.
 */
export function matchAddressRoad(runs, address) {
  const list = (Array.isArray(address) ? address : [address]).map(norm).filter(Boolean)
  if (!list.length) return -1

  const votes = new Array(runs.length).fill(0)
  for (const a of list) {
    let best = -1
    let bestLen = 0
    runs.forEach((r, i) => {
      const label = norm(r.road)
      if (label && label.length > bestLen && a.includes(label)) { best = i; bestLen = label.length }
    })
    if (best >= 0) votes[best]++
  }

  let winner = -1
  for (let i = 0; i < votes.length; i++) {
    if (votes[i] > 0 && (winner < 0 || votes[i] > votes[winner])) winner = i
  }
  return winner
}

/**
 * Which frontage is the primary one.
 *
 * NOT simply the longest, which is the intuitive answer and demonstrably wrong.
 * 260//DP979237 is 100 Avoca Street, Randwick, and its frontages are FRANCES
 * STREET 54.14 m and AVOCA STREET 47.44 m — longest picks Frances, while the
 * address, and therefore the street the setback controls key off, is Avoca.
 * Corner lots are where this matters most and where length is least reliable.
 *
 * Without an address the fallback is the SHORTEST street frontage, not the
 * longest. A rectangular corner lot puts its short side to the primary street
 * and runs its long side down the secondary — 15 m to the street it is addressed
 * to, 40 m down the side. Both lots in testing where an address resolves agree:
 * 260//DP979237 is addressed to AVOCA (53.54 m) over FRANCES (56.60 m), and
 * 1//DP199788 to GEORGE (9.15 m) over VICTORIA (15.21 m). Taking the longest
 * picks the side street in the common case.
 *
 * Road class still breaks a tie: a lower `functionhierarchy` is a more major
 * road, so a distributor beats a rear lane at equal length. `basis` travels with
 * the answer either way.
 */
export function pickPrimary(runs, address) {
  if (!runs.length) return { index: -1, basis: 'none' }
  // An empty array is truthy, so the count is what decides whether an address
  // was actually available — `address ? ...` reported "shortest" on every lot
  // that had none.
  const hasAddress = (Array.isArray(address) ? address : [address]).some(a => String(a ?? '').trim())

  const byAddress = matchAddressRoad(runs, address)
  if (byAddress >= 0) return { index: byAddress, basis: 'address' }

  // With one street frontage there is nothing to be longest of, and saying
  // "longest" invites the obvious question when a longer EXCLUDED run is on
  // screen above it. A//DP408911 is the case: its 208.6 m boundary faces the
  // Princes Motorway and carries no legal frontage, so the 182.05 m Princes
  // Highway frontage is the only candidate — not the longer of two.
  if (runs.length === 1) return { index: 0, basis: 'only_street_frontage' }

  let best = 0
  for (let i = 1; i < runs.length; i++) {
    const d = runs[i].length_m - runs[best].length_m
    if (d < -0.5) { best = i; continue }          // shorter wins
    if (Math.abs(d) <= 0.5) {
      const hi = Number(runs[i].road_hierarchy ?? 99)
      const hb = Number(runs[best].road_hierarchy ?? 99)
      if (hi < hb) best = i
    }
  }
  return { index: best, basis: hasAddress ? 'shortest' : 'shortest_no_address' }
}
