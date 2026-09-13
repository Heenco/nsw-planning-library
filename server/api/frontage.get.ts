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
 * Nothing here touches UrbanPortalDBP. Geometry comes from the public SIX Maps
 * cadastre, so this route works wherever the app is deployed, and a lot can be
 * checked before any of it is written back to a table.
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
import {
  DEFAULT_PAD_M, assertOk, lotQueryUrl, neighbourQueryUrl, neighboursFrom, ringsOf,
} from '#shared/cadastre-query.mjs'
import { nameRuns, mergeByRoad, classifyCorners, pickPrimary } from '#shared/frontage-roads.mjs'
import { nswQuery } from '../utils/nsw-kg/pool'
import { sweepLot } from '#shared/lot-shape.mjs'
import { lotAddresses } from '../utils/lot-address'
import { fetchRoadLines } from '../utils/road-tiles'
import { paddedEnvelope } from '#shared/cadastre-query.mjs'
import { fetchLotParcels, wholeRingFor, neighbourRingsFrom } from '../utils/lot-tiles'
import { parseFrontages } from '#shared/frontage.mjs'

const TIMEOUT_MS = 15000

/**
 * Process-local cache, following server/utils/cadastre.ts.
 *
 * A parcel boundary does not change between requests, and the page re-queries
 * the same lot whenever someone adjusts the pad. Bounded so a long-lived server
 * cannot grow without limit.
 */
const cache = new Map<string, any>()
const CACHE_MAX = 300

async function fetchJson(url: URL, key: string) {
  if (cache.has(key)) return cache.get(key)
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`cadastre service returned ${res.status}`)
  const json = assertOk(await res.json())
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, json)
  return json
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lotId = String(q.lot ?? '').trim().toUpperCase()
  const pad = Math.min(Math.max(Number(q.pad) || DEFAULT_PAD_M, 50), 3000)
  const tolerance = Math.min(Math.max(Number(q.tolerance) || 0.15, 0.01), 1)

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
   * The cadastre, from our own tile server where it can answer.
   *
   * Both SIX calls below are blocking, and the neighbour one is expensive: 300 m
   * around an urban lot is a few hundred parcels over an ArcGIS envelope query.
   * When SIX is slow the page returns "The SIX Maps cadastre did not respond"
   * and nothing else. Martin publishes the same cadastre as tiles, from
   * infrastructure this repo runs, accurate to 0.074 m at z16 against the 0.15 m
   * classification tolerance — see server/utils/lot-tiles.ts for the
   * measurements, and for why the subject lot is treated more strictly than its
   * neighbours.
   *
   * A fast path, never a replacement. The tile layer is a snapshot, so a parcel
   * created or resubdivided since it was cut is absent and SIX still answers.
   *
   * up_property_d_4 is what breaks the circularity: tiles are addressed by
   * coordinate, so finding a lot in them needs to know roughly where it is
   * first. d_4's `geom` is a POINT, not the polygon its name suggests — useless
   * for the boundary work, exactly right for this — and it is indexed on
   * upper(lot_section_plan) as of migration 11.
   */
  /**
   * The cadastre from our own tile server, when SIX cannot answer.
   *
   * A FALLBACK, deliberately, after trying it as the fast path and backing it
   * out. Martin's `lot` layer is quantised to 0.074 m at z16 — comfortably
   * inside the 0.15 m classification tolerance — but it and up_property_d_4
   * share a cadastre snapshot, and SIX is live. On A//DP408911 the tile ring
   * sits 24.9 m from SIX's, with an area AND perimeter both inside 5% of the
   * recorded figures: not a clipped fragment, a different vintage of the
   * parcel. There is no way from here to tell which is current, and quietly
   * serving the older one as though it were the surveyed boundary is worse
   * than being slow.
   *
   * So SIX decides while SIX is up, and this answers only when it is not —
   * which is the case the page has actually been failing on. `cadastre_source`
   * on the response says which one spoke.
   */
  const tileCadastre = async (): Promise<
    { ring: number[][], neighbours: { id: string, ring: number[][] }[] } | null
  > => {
    const martinBase = String((useRuntimeConfig().public as any).martinUrl || '')
    if (!martinBase) return null
    try {
      const qLat = Number(q.lat)
      const qLon = Number(q.lon)
      const { rows } = await nswQuery(
        `SELECT centroid_lon::float8 lon, centroid_lat::float8 lat,
                area_sqm::float8 area, perimeter_m::float8 perimeter
           FROM nsw.up_property_d_4
          WHERE upper(lot_section_plan) = $1 LIMIT 1`,
        [lotId],
      )
      const rec = rows[0]
      const lat = Number.isFinite(qLat) ? qLat : rec?.lat
      const lon = Number.isFinite(qLon) ? qLon : rec?.lon
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !rec) return null

      const dLat = (pad + 100) / 111132
      const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
      const { parcels, tiles, failed } = await fetchLotParcels(
        martinBase, [lon - dLon, lat - dLat, lon + dLon, lat + dLat])
      const whole = wholeRingFor(parcels, lotId, rec)
      // Every tile must have answered: a hole in the neighbour set reads as
      // open boundary, which is the one way this method is confidently wrong.
      if (!whole || failed !== 0 || tiles === 0) return null
      return { ring: whole as any, neighbours: neighbourRingsFrom(parcels, lotId) as any }
    } catch {
      return null
    }
  }

  let tileRing: number[][] | null = null
  let tileNeighbours: { id: string, ring: number[][] }[] = []
  let cadastreSource: 'six' | 'martin_lot_tiles' = 'six'

  let lotJson: any
  try {
    lotJson = await fetchJson(lotQueryUrl(lotId), `lot:${lotId}`)
  } catch (err: any) {
    const fromTiles = await tileCadastre()
    if (fromTiles) {
      tileRing = fromTiles.ring
      tileNeighbours = fromTiles.neighbours
      cadastreSource = 'martin_lot_tiles'
    } else {
      // The one genuine fault: the service is down or slow, and our own tile
      // copy could not stand in. Distinguished from a miss so the page can say
      // "try again" rather than "no such lot".
      return {
        ok: false as const, reason: 'cadastre_unavailable', lotId,
        message: `The SIX Maps cadastre did not respond (${String(err?.message ?? err)}).`,
      }
    }
  }

  const rings: number[][][] = tileRing
    ? [tileRing as unknown as number[][]]
    : (lotJson.features ?? []).flatMap(ringsOf)
  if (!rings.length) {
    return {
      ok: false as const, reason: 'not_found', lotId,
      message: `The cadastre publishes no boundary for ${lotId}. Check the plan number, `
        + `and that the lot has not been resubdivided.`,
    }
  }
  // The largest ring is the parcel; the rest are slivers, as cadastre.ts found.
  const ring = rings.sort((a, b) => ringArea(b as any) - ringArea(a as any))[0]

  // Guarded like the lot fetch above. Without this a slow SIX took the whole
  // request down with an unhandled TimeoutError and a bare 500 — and the
  // neighbour set is not optional: computing frontage without it would report
  // every boundary as open.
  let neighbours: { id: string, ring: number[][] }[]
  if (tileRing) {
    neighbours = tileNeighbours as any
  } else {
    let nbrJson: any
    try {
      nbrJson = await fetchJson(neighbourQueryUrl(ring, pad), `nbrs:${lotId}:${pad}`)
    } catch (err: any) {
      return {
        ok: false as const, reason: 'cadastre_unavailable', lotId,
        message: err?.name === 'TimeoutError'
          ? `The SIX Maps cadastre timed out fetching neighbouring parcels for ${lotId}.`
          : `The SIX Maps cadastre did not respond (${String(err?.message ?? err).slice(0, 80)}).`,
      }
    }
    neighbours = neighboursFrom(nbrJson, lotId)
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
    // SIX address points first: authoritative, and the only source that can
    // say a lot carries several addresses on different streets.
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

  return {
    ok: true as const,
    lotId,
    pad_m: pad,
    roadsFound: roads.length,
    abutsMotorway: motorways.length ? motorways.join(', ') : null,
    address: address || null,
    addresses: addresses.length > 1 ? addresses : undefined,
    address_source: given ? 'supplied' : (addresses.length ? 'six_address_point' : null),
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
    cadastre_source: cadastreSource,
    neighbourCount: neighbours.length,
    neighbours: neighbours.map((n: any) => n.id),
    edges: result.edges,
    runs: named,
    total_boundary_m: result.total_boundary_m,
    total_open_m: result.total_open_m,
    ring,
  }
})
