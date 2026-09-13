/**
 * The addresses sitting on a lot, from the G-NAF address points Martin serves.
 *
 * This asked the SIX Maps address-point layer until the app stopped relying on
 * SIX at all (see cadastre-tiles.ts). Same question, our data: the
 * `address_point` tile layer is the Geocoded National Address File, one point
 * per address with the street and locality already split out.
 *
 * Why this matters more than it sounds: choosing the primary frontage by
 * address is a fact; choosing it by shortest-or-longest is a heuristic that
 * measurement put at roughly a coin flip. Wide address coverage shrinks how
 * often the heuristic is reached at all, which is worth more than tuning it.
 *
 * All points are returned, not one. A corner lot can carry addresses on both
 * streets, and the useful answer is which street MOST of them name - the modal
 * street - rather than whichever happened to come back first. Addresses
 * without a unit number come first, so `addresses[0]` reads "68 BEACH STREET
 * COOGEE" and not "1/68 BEACH STREET COOGEE" on a lot with flats.
 *
 * G-NAF spells an address "68 BEACH STREET, COOGEE NSW 2034". It is returned
 * here as "68 BEACH STREET COOGEE", which is how up_property_d_4 spells it and
 * what matchAddressRoad already tokenises.
 */

import { VectorTile } from '@mapbox/vector-tile'
import Protobuf from 'pbf'
import { pointInRing } from '#shared/lot-edges.mjs'
import { martinBase } from './cadastre-tiles'

const LAYER = 'address_point'
/** The zoom the parcel tiles use; an address tile at z16 is ~1,000 points. */
const ZOOM = 16
const TIMEOUT_MS = 8000
const MAX_POINTS = 25
/** A lot straddling a tile corner needs four; nothing sane needs more. */
const MAX_TILES = 6

const cache = new Map<string, string[]>()
const CACHE_MAX = 300

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const tileY = (lat: number, z: number) => {
  const la = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * 2 ** z)
}

/** "68 BEACH STREET, COOGEE NSW 2034" -> "68 BEACH STREET COOGEE". */
function plainAddress(p: Record<string, unknown>): string {
  const full = String(p.full_address ?? '').trim()
  const street = full.split(',')[0]?.trim() ?? ''
  const locality = String(p.locality_name ?? '').trim()
  return [street, locality].filter(Boolean).join(' ').toUpperCase()
}

/**
 * Every address point falling inside `ring`, as plain strings.
 *
 * Returns [] rather than throwing: an address is an input to choosing the
 * primary frontage, never a precondition for having one.
 */
export async function lotAddresses(lotId: string, ring: number[][]): Promise<string[]> {
  if (cache.has(lotId)) return cache.get(lotId)!
  const base = martinBase()
  if (!base || !Array.isArray(ring) || ring.length < 3) return []

  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity
  for (const [x, y] of ring as [number, number][]) {
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  const tiles: [number, number][] = []
  for (let x = tileX(xmin, ZOOM); x <= tileX(xmax, ZOOM); x++) {
    for (let y = tileY(ymax, ZOOM); y <= tileY(ymin, ZOOM); y++) tiles.push([x, y])
  }
  if (tiles.length > MAX_TILES) tiles.length = MAX_TILES

  const hits: Array<{ text: string, unit: boolean }> = []
  let answered = true
  await Promise.all(tiles.map(async ([x, y]) => {
    try {
      const res = await fetch(`${base}/${LAYER}/${ZOOM}/${x}/${y}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      // 204 is "no addresses in this tile", which is an answer.
      if (res.status === 204) return
      if (!res.ok) { answered = false; return }
      const layer = new VectorTile(new Protobuf(new Uint8Array(await res.arrayBuffer()))).layers[LAYER]
      if (!layer) return
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const [px, py] = (f.toGeoJSON(x, y, ZOOM) as any).geometry.coordinates as [number, number]
        if (!pointInRing([px, py], ring)) continue
        const text = plainAddress(f.properties as Record<string, unknown>)
        if (text) hits.push({ text, unit: String((f.properties as any).flat_number ?? '').trim() !== '' })
      }
    } catch {
      answered = false
    }
  }))

  const seen = new Set<string>()
  const out = hits
    .sort((a, b) => Number(a.unit) - Number(b.unit) || a.text.localeCompare(b.text))
    .filter(h => !seen.has(h.text) && seen.add(h.text))
    .map(h => h.text)
    .slice(0, MAX_POINTS)

  // Only cache a complete answer. Caching a failed tile would make one slow
  // moment permanent for that lot.
  if (answered) {
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(lotId, out)
  }
  return out
}
