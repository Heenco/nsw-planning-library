/**
 * Our own cadastre: parcels, their neighbours, and the parcel under a point,
 * from the Martin `lot` tiles.
 *
 * Every parcel lookup in the app used to go to SIX Maps: the subject lot by
 * `lotidstring`, its neighbours by envelope, and the lot under a geocoded
 * point. Two things ended that. SIX rate-limits and times out under modest
 * load - a burst of six requests in testing was followed by minutes in which
 * every call timed out - so the frontage page failed whenever anyone used it
 * seriously. And it disagrees with our own data in a way no page could
 * explain: 68 Beach Street Coogee is 11//DP84481 in up_property_d_4, in these
 * tiles, and in every figure the report prints, while SIX has since
 * re-registered the parcel as 1//DP1326993 and answers nothing for the old id.
 * The tiles and the property table are one snapshot, so what gets drawn and
 * what the facts say are now the same lot.
 *
 * The price is currency. A parcel resubdivided since the snapshot is drawn as
 * it was; `wholeRingFor` guards the shape against the recorded figures, not
 * the vintage. That is the trade the app has chosen - see the note on the
 * frontage route.
 *
 * WHERE A LOT IS
 *
 * Tiles are addressed by coordinate, so finding a parcel by identifier needs
 * to know roughly where it is first. up_property_d_4 answers that, indexed on
 * upper(lot_section_plan) since db migration 12, and carries the recorded
 * area and perimeter the ring is validated against. A lot the table does not
 * hold cannot be located, which is stated rather than guessed at.
 *
 * Accuracy and clipping are measured and explained in lot-tiles.ts: zoom 16
 * puts every vertex within 0.074 m of the surveyed boundary, and a parcel cut
 * across a tile edge is rejected by area and perimeter rather than trusted.
 */

import { ringArea } from '#shared/geo-measure.mjs'
import { pointInRing } from '#shared/lot-edges.mjs'
import { nswQuery } from './nsw-kg/pool'
import { fetchLotParcels, neighbourRingsFrom, wholeRingFor, type TileParcel } from './lot-tiles'

export interface LotRecord {
  lat: number
  lon: number
  area: number | null
  perimeter: number | null
}

export interface LotWithNeighbours {
  /** The subject ring, only when it arrived whole and matches the record. */
  ring: [number, number][] | null
  neighbours: { id: string, ring: [number, number][] }[]
  /** Whether any piece of a parcel with this identifier was in the tiles. */
  present: boolean
  tiles: number
  failed: number
  /** The zoom the answer came from; lower means a bigger lot or a coarser one. */
  zoom: number
}

/**
 * Zooms to try, finest first.
 *
 * Martin clips a feature to its tile plus a buffer of about 1.5% of the tile,
 * which at zoom 16 is ~10 m. A parcel that crosses a tile edge by more than
 * that is clipped in every tile it touches, so no copy is whole and
 * wholeRingFor rightly refuses all of them. Stepping out a zoom doubles the
 * tile and the buffer, so a lot that straddled an edge usually sits inside
 * one tile a level down. The neighbours are re-read at the same zoom, so
 * shared vertices snap to the same grid on both sides and the boundary
 * classifier still sees them coincide; what coarsens is the measured length,
 * by up to ~0.15 m per vertex at 15 and ~0.3 m at 14.
 */
const ZOOMS = [16, 15, 14]

/** The tile server the map already reads, without a trailing slash. */
export function martinBase(): string {
  return String((useRuntimeConfig().public as any).martinUrl || '').replace(/\/+$/, '')
}

/**
 * Where the property table puts this lot, and how big it says it is.
 *
 * A lot can carry several rows (strata units share one lot_section_plan); they
 * agree on the parcel, so the first is as good as any.
 */
export async function locateLot(lotId: string): Promise<LotRecord | null> {
  const { rows } = await nswQuery(
    `SELECT centroid_lat::float8 AS lat, centroid_lon::float8 AS lon,
            area_sqm::float8 AS area, perimeter_m::float8 AS perimeter
       FROM nsw.up_property_d_4
      WHERE upper(lot_section_plan) = $1
        AND centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
      ORDER BY area_sqm DESC NULLS LAST
      LIMIT 1`,
    [lotId.toUpperCase()],
  )
  const r = rows[0]
  if (!r) return null
  return {
    lat: Number(r.lat),
    lon: Number(r.lon),
    area: r.area == null ? null : Number(r.area),
    perimeter: r.perimeter == null ? null : Number(r.perimeter),
  }
}

function bboxAround(lat: number, lon: number, halfM: number): [number, number, number, number] {
  const dLat = halfM / 111132
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

/**
 * How far from its centroid a lot can reach.
 *
 * A compact lot's far corner is about sqrt(area) from the centroid; a long,
 * thin one goes further. Twice the square root with a floor covers both, and
 * the tile grid rounds it up to whole tiles anyway.
 */
function reachFor(area: number | null): number {
  const a = Number(area) || 0
  return Math.max(120, 2 * Math.sqrt(a))
}

/**
 * The subject ring and every parcel within `padM` of it.
 *
 * Throws only when there is no tile server to ask. A tile that fails is
 * reported in `failed` rather than thrown, because the caller decides whether
 * a hole in the neighbour set is fatal - for boundary classification it is.
 */
export async function lotWithNeighbours(
  lotId: string,
  rec: LotRecord,
  padM: number,
): Promise<LotWithNeighbours> {
  const base = martinBase()
  if (!base) throw new Error('no tile server configured (NUXT_PUBLIC_MARTIN_URL)')
  const id = lotId.toUpperCase()
  const half = Math.max(padM + 100, reachFor(rec.area))
  const bbox = bboxAround(rec.lat, rec.lon, half)

  let last: LotWithNeighbours | null = null
  for (const zoom of ZOOMS) {
    const { parcels, tiles, failed } = await fetchLotParcels(base, bbox, zoom)
    const ring = wholeRingFor(parcels, id, rec)
    last = {
      ring,
      neighbours: ring ? neighbourRingsFrom(parcels, id) : [],
      present: parcels.has(id),
      tiles,
      failed,
      zoom,
    }
    // A whole ring, or a parcel that is simply not there: both are answers.
    // Only "present but every copy clipped" is worth a coarser look.
    if (ring || !last.present || failed) break
  }
  return last!
}

/**
 * Just the subject ring, validated against the recorded figures.
 *
 * `reason` says why there is none, in words a page can show: the identifier is
 * absent from the tiles near where the record puts it, or it is there but its
 * boundary no longer matches the record - which is what a resubdivision looks
 * like from here.
 */
export async function lotRingById(
  lotId: string,
  rec: LotRecord,
): Promise<{ ring: [number, number][] | null, reason?: string }> {
  const found = await lotWithNeighbours(lotId, rec, 0)
  if (found.ring) return { ring: found.ring }
  if (found.tiles === 0 || found.failed === found.tiles) {
    return { ring: null, reason: 'the cadastre tiles for this area did not load' }
  }
  if (!found.present) {
    return { ring: null, reason: 'no parcel with this identifier in the cadastre at its recorded location' }
  }
  if (!rec.area || !rec.perimeter) {
    return { ring: null, reason: 'the property record carries no area and perimeter to validate the boundary against' }
  }
  return {
    ring: null,
    reason: `the parcel is in the cadastre but its boundary disagrees with the recorded ${Math.round(rec.area)} m² `
      + `and ${Math.round(rec.perimeter)} m, as a resubdivided lot would`,
  }
}

/**
 * The parcel containing one point, or null when the point is on a road, in
 * water, or otherwise outside every lot.
 *
 * One tile: Martin clips features to the tile plus a buffer, so the piece of
 * a parcel that contains a point inside the tile is always in that tile. Where
 * parcels overlap - a strata plan over its base lot, a stratum below another -
 * the smallest containing one is returned, which is the most specific answer
 * and the one the property table keys its rows on.
 *
 * Throws when the tile cannot be fetched, so the caller can tell "no parcel
 * here" from "could not look".
 */
export async function lotAtPoint(lon: number, lat: number): Promise<{ lotId: string, area: number } | null> {
  const base = martinBase()
  if (!base) throw new Error('no tile server configured (NUXT_PUBLIC_MARTIN_URL)')
  const { parcels, tiles, failed } = await fetchLotParcels(base, [lon, lat, lon, lat])
  if (tiles === 0 || failed) throw new Error('the cadastre tile for this point did not load')
  let best: { lotId: string, area: number } | null = null
  for (const [id, pieces] of parcels) {
    for (const p of pieces as TileParcel[]) {
      if (!pointInRing([lon, lat], p.ring)) continue
      const area = ringArea(p.ring)
      if (!best || area < best.area) best = { lotId: id, area }
    }
  }
  return best
}
