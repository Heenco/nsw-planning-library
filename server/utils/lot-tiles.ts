/**
 * Parcel polygons from the Martin `lot` tile layer.
 *
 * The frontage calculation needs two things from a cadastre: the subject lot's
 * ring, and every neighbouring parcel's ring within the pad. Both came from SIX
 * Maps, and both are blocking — so when SIX is slow the page cannot answer at
 * all, which is the "The SIX Maps cadastre did not respond" the tool has been
 * returning. The neighbour query is the expensive one: 300 m around an urban
 * lot is a few hundred parcels, fetched over an ArcGIS envelope query with a
 * 15 second ceiling.
 *
 * Martin already publishes the same cadastre as vector tiles for the map, from
 * infrastructure this repo runs. Reading it here turns two external round-trips
 * into a handful of small tile fetches against a server we control.
 *
 * WHY THIS IS ACCURATE ENOUGH, WHICH IS NOT OBVIOUS
 *
 * Tile geometry is quantised — coordinates are integers on a 4096-unit grid per
 * tile — and `classifyBoundary` decides shared-or-open at a 0.15 m tolerance, so
 * the question is whether quantisation moves a vertex further than that.
 * Measured against SIX for 100//DP1139278:
 *
 *   z16   15 of 15 vertices   mean 0.048 m   worst 0.074 m
 *   z18   15 of 15 vertices   mean 0.012 m   worst 0.021 m
 *   z20   10 of 15 vertices   worst 29.4 m   — the lot is CLIPPED across tiles
 *
 * z16 is the choice: inside tolerance with room to spare, and a 300 m pad costs
 * nine tiles where z18 would cost twenty-five. z20 is the warning — past a
 * point the parcel no longer fits in one tile and comes back in pieces.
 *
 * CLIPPING, AND WHY THE SUBJECT LOT IS TREATED DIFFERENTLY
 *
 * A feature crossing a tile edge appears in both tiles, clipped to each. For a
 * NEIGHBOUR that is harmless: classifyBoundary asks only whether some neighbour
 * edge is coincident with an edge of the subject lot, so a neighbour arriving
 * as two pieces still covers the shared boundary between them.
 *
 * For the SUBJECT lot it is fatal — a clipped ring is the wrong shape, and every
 * boundary the clip removed reads as open frontage. So the subject's ring is
 * checked by AREA against the figure the property table records, which is the
 * same test server/utils/cadastre.ts already applies to a SIX response before
 * trusting it. See wholeRingFor for why the obvious test — does the ring touch
 * the tile edge — is wrong in both directions.
 */

import { VectorTile } from '@mapbox/vector-tile'
import Protobuf from 'pbf'
import { ringArea } from '#shared/geo-measure.mjs'
import { ringPerimeter } from '#shared/lot-edges.mjs'

/** Accurate to 0.074 m against SIX, and cheap enough to pad 300 m. */
export const LOT_TILE_ZOOM = 16

const LAYER = 'lot'
const TIMEOUT_MS = 8000

export interface TileParcel {
  /** `lotnumber//sectionnumber//planlabel`, matching SIX's `lotidstring`. */
  id: string
  ring: [number, number][]
}

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const tileY = (lat: number, z: number) => {
  const la = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * 2 ** z)
}

/**
 * A parcel identifier in the form SIX publishes.
 *
 * `lotidstring` is always two slashes — "100//DP1139278" — with the section
 * usually empty. The tile layer carries the three parts separately, so they are
 * rejoined rather than matched field by field, which keeps every caller working
 * in one vocabulary.
 */
const parcelId = (p: Record<string, unknown>) =>
  `${p.lotnumber ?? ''}/${p.sectionnumber ?? ''}/${p.planlabel ?? ''}`.toUpperCase()

async function fetchTile(base: string, z: number, x: number, y: number) {
  const res = await fetch(`${base}/${LAYER}/${z}/${x}/${y}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // 204 is Martin's "no features here", which is an answer, not a fault.
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`lot tile ${z}/${x}/${y} returned ${res.status}`)
  return new VectorTile(new Protobuf(Buffer.from(await res.arrayBuffer())))
}

/**
 * Every parcel whose geometry falls in the given bounds.
 *
 * Tiles are fetched in parallel and a failure of any one is tolerated: a
 * missing tile costs neighbours in that extent, which the caller can detect
 * from the count, where failing the whole request costs the answer. This
 * mirrors road-tiles.ts, where one bad tile over Kingsford returns 500 while
 * every neighbour of it is fine.
 */
export async function fetchLotParcels(
  martinBase: string,
  bbox: [number, number, number, number],
  z = LOT_TILE_ZOOM,
): Promise<{ parcels: Map<string, TileParcel[]>, tiles: number, failed: number }> {
  const base = String(martinBase || '').replace(/\/+$/, '')
  const out = new Map<string, TileParcel[]>()
  if (!base) return { parcels: out, tiles: 0, failed: 0 }

  const [xmin, ymin, xmax, ymax] = bbox
  const x0 = tileX(xmin, z)
  const x1 = tileX(xmax, z)
  // Tile Y runs the other way: the northern edge is the smaller index.
  const y0 = tileY(ymax, z)
  const y1 = tileY(ymin, z)

  const jobs: Array<Promise<void>> = []
  let failed = 0
  let tiles = 0

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      tiles++
      const tx = x
      const ty = y
      jobs.push((async () => {
        let tile
        try {
          tile = await fetchTile(base, z, tx, ty)
        } catch {
          failed++
          return
        }
        const layer = tile?.layers?.[LAYER]
        if (!layer) return
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i)
          const id = parcelId(f.properties as Record<string, unknown>)
          if (id === '//') continue
          const gj: any = f.toGeoJSON(tx, ty, z)
          const polys = gj.geometry.type === 'MultiPolygon'
            ? gj.geometry.coordinates
            : [gj.geometry.coordinates]
          for (const poly of polys) {
            const ring = poly[0] as [number, number][]
            if (!ring || ring.length < 4) continue
            const list = out.get(id) ?? []
            list.push({ id, ring })
            out.set(id, list)
          }
        }
      })())
    }
  }

  await Promise.all(jobs)
  return { parcels: out, tiles, failed }
}

/**
 * The subject lot's ring, only when it arrived whole.
 *
 * Whole is decided by AREA AND PERIMETER together, against the figures the
 * property table records. Both, because either alone is fooled:
 *
 *   - the obvious test, "does the ring touch the tile edge", is wrong in both
 *     directions. Martin clips to the tile plus a buffer, so a small parcel near
 *     a boundary has vertices past the extent and is complete anyway, while a
 *     large parcel can be cut along an edge it barely touches. Applied to real
 *     lots it rejected everything: 1//DP214129 arrives as four copies, one per
 *     tile it straddles, and the edge test called all four clipped.
 *
 *   - area alone is fooled by shape. A//DP408911 is 2.1 ha and spans tiles; the
 *     fragment whose area came closest was still a fragment, and it shipped a
 *     ring 24.9 m from the surveyed boundary with 6 vertices against 5 and a
 *     perimeter of 620.8 m against 651.7 m. Area matched to within 5% while the
 *     shape was wrong.
 *
 * Perimeter is what catches that: a clipped piece is closed across the cut, so
 * its outline is a different length even when the area survives. This is the
 * pair server/utils/cadastre.ts already validates a SIX response on, for the
 * same reason.
 *
 * Without both figures there is nothing to check against, so the ring is
 * refused and the route says why. A wrong boundary is worse than none.
 */
export function wholeRingFor(
  parcels: Map<string, TileParcel[]>,
  lotId: string,
  recorded?: { area?: number | null, perimeter?: number | null } | null,
  tolerance = 0.05,
): [number, number][] | null {
  const pieces = parcels.get(lotId.toUpperCase())
  if (!pieces?.length) return null

  const area = Number(recorded?.area)
  const perimeter = Number(recorded?.perimeter)
  if (!Number.isFinite(area) || area <= 0) return null
  if (!Number.isFinite(perimeter) || perimeter <= 0) return null

  let best: { ring: [number, number][], err: number } | null = null
  for (const p of pieces) {
    const aErr = Math.abs(ringArea(p.ring) - area) / area
    const pErr = Math.abs(ringPerimeter(p.ring) - perimeter) / perimeter
    if (aErr > tolerance || pErr > tolerance) continue
    const err = Math.max(aErr, pErr)
    if (!best || err < best.err) best = { ring: p.ring, err }
  }
  return best ? best.ring : null
}

/** Every parcel except the subject, as rings for the boundary classifier. */
export function neighbourRingsFrom(
  parcels: Map<string, TileParcel[]>,
  lotId: string,
): { id: string, ring: [number, number][] }[] {
  const self = lotId.toUpperCase()
  const out: { id: string, ring: [number, number][] }[] = []
  for (const [id, pieces] of parcels) {
    if (id === self) continue
    for (const p of pieces) out.push({ id, ring: p.ring })
  }
  return out
}
