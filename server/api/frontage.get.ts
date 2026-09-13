/**
 * Frontage for one lot, computed on request from its lot/DP identifier.
 *
 *   /api/frontage?lot=A//DP408911
 *   /api/frontage?lot=A//DP408911&pad=600&tolerance=0.2
 *
 * Answers the question lot_metrics_gnaf gets wrong: which of a lot's boundaries
 * face a road. 708,058 of 3,233,618 NSW lots (21.9%) are recorded there with
 * num_frontages = 0, because frontage was decided by distance to a road
 * centreline and a wide reserve puts the boundary out of reach. This decides it
 * from the parcel fabric instead — see shared/frontage-topo.mjs.
 *
 * Geometry comes from the Martin `lot` tiles - our own copy of the cadastre -
 * and the lot's location from up_property_d_4. Nothing here calls a public
 * service, and a lot can be checked before any of it is written back to a
 * table.
 *
 * The primary frontage is the addressed street where one is known, not the
 * longest — 260//DP979237 is 100 Avoca Street and its longest frontage is
 * Frances Street, so length picks the wrong one. `primary_frontage_basis` says
 * which rule decided.
 *
 * Depth, width and the access handle come from a cross-section sweep taken from
 * the primary frontage inwards — see shared/lot-shape.mjs. Depth is reported for
 * the *core*, excluding any handle, because a handle is not buildable and LEPs
 * exclude it from lot size; measuring the whole lot is what recorded 55 m for a
 * lot 30 m deep.
 *
 * Road names come from road_segments through the Martin tile server, in a
 * second pass that can only ever *label* a run. Motorways are read but never
 * used as a frontage name: a lot beside the M1 has no legal frontage to it. It cannot drop one — that is the
 * mistake being corrected, and keeping the two passes separate is what stops it
 * coming back. Motorways are read but never used as a frontage name: a lot
 * beside the M1 has no legal frontage to it.
 *
 * A lookup that finds nothing answers with 200 and `ok: false`, not a thrown
 * error. "No such lot" and "that is not a lot identifier" are results of asking,
 * the same way `num_frontages: 0` is a result — and throwing for them made the
 * Nitro log red on every typo and popped h3's own stack frame in the dev
 * overlay instead of the page's message. Only a genuinely broken dependency
 * throws.
 */

import { classifyBoundary } from '#shared/frontage-topo.mjs'
import { ringArea, pathLength } from '#shared/geo-measure.mjs'
import { DEFAULT_PAD_M, paddedEnvelope } from '#shared/cadastre-query.mjs'
import { nameRuns, mergeByRoad, classifyCorners, pickPrimary } from '#shared/frontage-roads.mjs'
import { nswQuery } from '../utils/nsw-kg/pool'
import { sweepLot } from '#shared/lot-shape.mjs'
import { lotAddresses } from '../utils/lot-address'
import { fetchRoadLines } from '../utils/road-tiles'
import { locateLot, lotWithNeighbours } from '../utils/cadastre-tiles'
import { parseFrontages } from '#shared/frontage.mjs'

/**
 * Answers, per process.
 *
 * The report asks this route twice for one lot - once to draw the runs on the
 * map and once for the sketch - and the frontage page re-asks whenever the pad
 * changes. Each answer costs a dozen tile fetches, so the second identical
 * question is answered from here. Bounded, and only successful answers are
 * kept: a tile that failed should be tried again, not remembered.
 */
const answers = new Map<string, any>()
const ANSWERS_MAX = 200


export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lotId = String(q.lot ?? '').trim().toUpperCase()
  const pad = Math.min(Math.max(Number(q.pad) || DEFAULT_PAD_M, 50), 3000)
  const tolerance = Math.min(Math.max(Number(q.tolerance) || 0.15, 0.01), 1)
  const answerKey = [lotId, pad, tolerance, String(q.address ?? '').trim(), q.lat ?? '', q.lon ?? ''].join('|')
  if (answers.has(answerKey)) return answers.get(answerKey)

  if (!lotId) {
    return { ok: false as const, reason: 'no_input', message: 'Enter a lot/section/plan, e.g. A//DP408911' }
  }
  // Two slashes always: lot // section // plan, with the section usually empty.
  if (!/^[^/]*\/[^/]*\/[^/]+$/.test(lotId)) {
    return {
      ok: false as const, reason: 'bad_identifier', lotId,
      message: `"${lotId}" is not a lot//section//plan identifier — try A//DP408911 or 1//DP214129`,
    }
  }

  /**
   * The cadastre: the subject parcel and every parcel within the pad, from the
   * Martin `lot` tiles - our own copy of the fabric, the one the map draws.
   *
   * This asked SIX Maps first and fell back to the tiles only when SIX threw.
   * Two things ended that. SIX rate-limits and times out under modest load - a
   * burst of six requests in testing was followed by minutes of timeouts - so
   * the page failed whenever anyone used it seriously. And the two sources
   * disagree in a way the page could not explain: 68 Beach Street Coogee is
   * 11//DP84481 in the property table, in these tiles, and in every figure the
   * report shows, while SIX has since re-registered the parcel as 1//DP1326993
   * and returns nothing for the old id. The tiles and up_property_d_4 are one
   * snapshot, so what the sketch draws and what the facts say are the same lot.
   *
   * The price is currency: a parcel resubdivided since the snapshot is drawn
   * as it was. wholeRingFor guards the shape against the recorded figures, not
   * the vintage. That is the trade, made knowingly.
   *
   * Where the lot IS comes from the property table, or from `?lat=&lon=` when
   * the caller already knows. Tiles are addressed by coordinate, so without
   * one of those there is nothing to fetch, and that is said rather than
   * guessed around.
   */
  let rec = await locateLot(lotId)
  const qLat = Number(q.lat)
  const qLon = Number(q.lon)
  if (Number.isFinite(qLat) && Number.isFinite(qLon)) {
    rec = { lat: qLat, lon: qLon, area: rec?.area ?? null, perimeter: rec?.perimeter ?? null }
  }
  if (!rec) {
    return {
      ok: false as const, reason: 'not_found', lotId,
      message: `The property table has no row for ${lotId}, so there is nothing to locate it by. `
        + 'Check the plan number, or pass ?lat= and ?lon=.',
    }
  }

  let ring: number[][]
  let neighbours: { id: string, ring: number[][] }[]
  let cadastreZoom = 16
  try {
    const found = await lotWithNeighbours(lotId, rec, pad)
    // Every tile must have answered: a hole in the neighbour set reads as open
    // boundary, which is the one way this method is confidently wrong.
    if (found.tiles === 0 || found.failed !== 0) {
      return {
        ok: false as const, reason: 'cadastre_unavailable', lotId,
        message: `${found.failed} of ${found.tiles} cadastre tiles did not load. Try again.`,
      }
    }
    if (!found.ring) {
      return {
        ok: false as const, reason: 'not_found', lotId,
        message: !found.present
          ? `The cadastre holds no parcel called ${lotId} at its recorded location. Check the plan `
            + 'number, and that the lot has not been resubdivided.'
          : !rec.area || !rec.perimeter
            ? `The cadastre has ${lotId}, but the property record carries no area and perimeter to `
              + 'validate its boundary against.'
            : `The cadastre has a parcel called ${lotId}, but its boundary does not match the recorded `
              + `${Math.round(rec.area)} m² and ${Math.round(rec.perimeter)} m - the lot may have been `
              + 'resubdivided since the snapshot.',
      }
    }
    ring = found.ring
    neighbours = found.neighbours
    cadastreZoom = found.zoom
  } catch (err: any) {
    return {
      ok: false as const, reason: 'cadastre_unavailable', lotId,
      message: `The cadastre tile server did not respond (${String(err?.message ?? err).slice(0, 80)}).`,
    }
  }

  const result = classifyBoundary(ring, neighbours.map((n: any) => n.ring), { tolerance })

  // Naming is best-effort by construction: if the tile server is unreachable the
  // runs come back unnamed rather than not at all.
  /**
   * The street this lot is addressed to, for choosing the primary frontage.
   *
   * `?address=` lets the page pass what it already knows — a hit it geocoded
   * through Mapbox, anywhere in NSW. Otherwise up_property_d_4 is asked, which
   * covers all 132 NSW councils. Neither is required: without an address the
   * primary falls back to length and says so.
   */
  let addresses: string[] = []
  const given = String(q.address ?? '').trim()
  if (given) {
    addresses = [given]
  } else {
    // G-NAF address points first: the only source that can say a lot carries
    // several addresses on different streets.
    addresses = await lotAddresses(lotId, ring as any)
    if (!addresses.length) {
      try {
        // up_property_d_4, not d_3. d_3 holds Hornsby and Randwick only, so
        // outside those two councils this fallback could never fire and the
        // primary frontage fell through to a geometric guess. 100//DP1139278
        // is the case that showed it: SIX has no address point on the parcel,
        // d_3 has no row, and the shortest-frontage rule nominated a 3.65 m
        // sliver at a cul-de-sac head as the primary street frontage. d_4
        // knows it as 20 FENTON AVENUE TORONTO — and Fenton Avenue is the
        // 32.58 m boundary.
        //
        // DISTINCT because d_4 carries duplicate rows: Randwick is loaded
        // twice (152,816 rows for 73,132 distinct keys), so a plain select
        // returns the same address several times and the modal-street test
        // downstream would count one address as many.
        const { rows } = await nswQuery(
          `SELECT DISTINCT address FROM nsw.up_property_d_4
            WHERE upper(lot_section_plan) = $1 AND address IS NOT NULL
            ORDER BY address`,
          [lotId],
        )
        if (rows.length) addresses = rows.map((r: any) => String(r.address))
      } catch {
        // The property table is optional here, never fatal.
      }
    }
  }
  const address = addresses[0] ?? ''

  const martin = String((useRuntimeConfig().public as any).martinUrl || '')
  const env = paddedEnvelope(ring, 150)
  let roads: any[] = []
  try {
    roads = await fetchRoadLines(martin, [env.xmin, env.ymin, env.xmax, env.ymax])
  } catch { roads = [] }

  const named = roads.length
    ? mergeByRoad(nameRuns(result.runs, roads, result.origin))
    : result.runs.map((r: any) => ({ ...r, road: null, road_basis: 'no_road_data' }))
  const motorways = [...new Set(named.map((r: any) => r.abutsMotorway).filter(Boolean))]

  /**
   * Name a run from the property table when the road layer could not.
   *
   * `nameRuns` matches a boundary to a road centreline. Where the centrelines
   * carry no name — 100//DP1139278 sits on a cul-de-sac head whose roads are
   * all unnamed in the tile layer — every run comes back `road: null`, the
   * address can match nothing, and pickPrimary falls through to its shortest
   * rule. On that lot the shortest street frontage is 3.65 m: a sliver at the
   * bulb, narrower than a driveway, nominated as the street the setbacks key
   * off.
   *
   * `up_property_d_4.all_frontages` has already done this join statewide, and
   * writes it as "FENTON:32.58m,BROMLEY:10.58m,Unnamed_881533:47.63m". Matching
   * by LENGTH is what connects it to our runs, because the two are computed
   * independently and share no identifier.
   *
   * Deliberately conservative. Only a run whose length matches a named entry
   * within tolerance is named, and only where the road layer gave nothing —
   * this is a fallback, never a correction. On the lot above that names the
   * 32.59 m run Fenton and leaves the rest alone: d_4's BROMLEY:10.58m is the
   * SUM of two of our runs (6.93 + 3.65) and its 47.63 m unnamed frontage
   * matches none of them, so neither is claimed. Naming one boundary correctly
   * is worth more than naming three by guess.
   */
  if (named.some((r: any) => !r.road)) {
    try {
      const { rows } = await nswQuery(
        `SELECT DISTINCT all_frontages FROM nsw.up_property_d_4
          WHERE upper(lot_section_plan) = $1 AND all_frontages IS NOT NULL LIMIT 1`,
        [lotId],
      )
      const entries = parseFrontages(rows[0]?.all_frontages ?? '')
        .filter((f: any) => !f.unnamed)
      for (const run of named) {
        if (run.road) continue
        const len = Number(run.length_m)
        const tol = Math.max(0.6, len * 0.03)
        let hit: any = null
        let bestDiff = Infinity
        for (const f of entries) {
          const diff = Math.abs(f.length - len)
          if (diff <= tol && diff < bestDiff) { bestDiff = diff; hit = f }
        }
        if (hit) {
          run.road = hit.road
          run.road_basis = 'property_table'
        }
      }
    } catch {
      // The property table is a convenience here, never a precondition.
    }
  }

  // A boundary facing a motorway is open but is not a street frontage, so it
  // takes no part in choosing the primary or in calling the lot a corner lot.
  const streetRuns = named.filter((r: any) => r.road_basis !== 'motorway_only')
  const primary = pickPrimary(streetRuns, addresses)
  const primaryRun = primary.index >= 0 ? streetRuns[primary.index] : null
  const corners = classifyCorners(streetRuns)
  for (const r of named) r.is_primary = primaryRun != null && r === primaryRun

  // The sweep needs a frontage to measure from. Without one there is no depth
  // and no handle to find — an interior lot is reported as such rather than
  // measured from an arbitrary edge.
  const shape = primaryRun
    ? sweepLot(ring, primaryRun.coords, primaryRun.bearing_deg, result.origin)
    : null

  /**
   * The profile is for drawing, so it is thinned to something a chart can use.
   * The measurements above were taken at full resolution.
   */
  const PROFILE_POINTS = 140
  const full = shape?.profile ?? []
  const stride = Math.max(1, Math.ceil(full.length / PROFILE_POINTS))
  const profile = full.filter((_: any, i: number) => i % stride === 0)

  const answer = {
    ok: true as const,
    lotId,
    pad_m: pad,
    roadsFound: roads.length,
    abutsMotorway: motorways.length ? motorways.join(', ') : null,
    address: address || null,
    addresses: addresses.length > 1 ? addresses : undefined,
    address_source: given ? 'supplied' : (addresses.length ? 'gnaf_address_point' : null),
    primary_frontage_road: primaryRun?.road ?? null,
    primary_frontage_length_m: primaryRun?.length_m ?? null,
    primary_frontage_basis: primary.basis,
    street_frontage_count: streetRuns.length,
    total_street_frontage_m: Math.round(streetRuns.reduce((t: number, r: any) => t + r.length_m, 0) * 100) / 100,
    ...corners,
    ...(shape
      ? {
          lot_depth_m: shape.lot_depth_m,
          core_depth_m: shape.core_depth_m,
          lot_width_max_m: shape.lot_width_max_m,
          is_battleaxe: shape.is_battleaxe,
          handle_shape: shape.handle_shape,
          handle_neck_min_m: shape.handle_neck_min_m,
          handle_neck_mean_m: shape.handle_neck_mean_m,
          handle_length_m: shape.handle_length_m,
          handle_area_sqm: shape.handle_area_sqm,
          stem_width_m: shape.stem_width_m,
          stem_length_m: shape.stem_length_m,
          stem_area_sqm: shape.stem_area_sqm,
          core_width_min_m: shape.core_width_min_m,
          core_width_max_m: shape.core_width_max_m,
          width_at_setback_m: shape.width_at_setback_m,
          width_setback_depth_m: shape.width_setback_depth_m,
          // Gross area less the handle: the figure LEP lot-size clauses want.
          effective_area_sqm: shape.handle_area_sqm != null
            ? Math.round((Math.round(ringArea(ring as any)) - shape.handle_area_sqm) * 100) / 100
            : null,
          profile,
        }
      : {
          // Same keys either way, so a consumer never has to test for their
          // absence — an interior lot has no dimensions, not missing fields.
          lot_depth_m: null, core_depth_m: null, lot_width_max_m: null,
          is_battleaxe: false, handle_shape: 'no_frontage',
          handle_neck_min_m: null, handle_neck_mean_m: null,
          handle_length_m: null, handle_area_sqm: null,
          stem_width_m: null, stem_length_m: null, stem_area_sqm: null,
          core_width_min_m: null, core_width_max_m: null,
          width_at_setback_m: null, width_setback_depth_m: null,
          effective_area_sqm: null, profile: [],
        }),
    tolerance_m: tolerance,
    area_sqm: Math.round(ringArea(ring as any)),
    perimeter_m: Math.round(pathLength(ring as any) * 100) / 100,
    cadastre_source: 'martin_lot_tiles' as const,
    cadastre_zoom: cadastreZoom,
    neighbourCount: neighbours.length,
    neighbours: neighbours.map((n: any) => n.id),
    edges: result.edges,
    runs: named,
    total_boundary_m: result.total_boundary_m,
    total_open_m: result.total_open_m,
    ring,
  }
  if (answers.size >= ANSWERS_MAX) answers.clear()
  answers.set(answerKey, answer)
  return answer
})
