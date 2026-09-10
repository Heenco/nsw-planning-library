/**
 * Road centrelines for one small area, read from the Martin tile server.
 *
 * `road_segments` lives in UrbanPortalDBP, which this app has no connection to —
 * but Martin already publishes it as vector tiles for the map, so the data is
 * reachable without opening a second database. Decoding a tile is cheap, the
 * result is exactly what the map draws, and the whole thing stays inside
 * infrastructure the repo already runs.
 *
 * `@mapbox/vector-tile` and `pbf` are declared in package.json rather than
 * relied on as mapbox-gl's transitive dependencies, which is what they were
 * before this file existed.
 *
 * Zoom 15 is a deliberate floor. Martin generalises geometry at low zoom, and a
 * simplified centreline moves — which would matter if distance decided whether a
 * frontage exists. It does not: the topology already settled that, and this
 * distance only chooses between candidate names. 15 keeps tile counts small for
 * a rural lot while staying accurate enough to tell one street from another.
 *
 * KNOWN LIMITATION
 *
 * Tiles can fail individually and silently. `road_segments/15/30149/19669` over
 * Kingsford returns HTTP 500 while every neighbouring tile is fine, so lots in
 * that extent get no road names at all — 100 Barker Street and 41 Norton Street
 * both hit it. The frontage itself is unaffected, because names are a second
 * pass that can never remove a run; but a lot there reports "no named road
 * within range" beside a street that is plainly on the map. Fixing that means
 * fixing the tile at the source, most likely a bad geometry in road_segments
 * breaking tile generation for that extent.
 */

import { VectorTile } from '@mapbox/vector-tile'
import Protobuf from 'pbf'

export interface RoadLine {
  name: string | null
  type: string | null
  hierarchy: number | null
  coords: [number, number][]
}

const ZOOM = 15
const LAYER = 'road_segments'
const TIMEOUT_MS = 8000

/** Cap the tile fan-out — a very large rural lot must not fetch hundreds. */
const MAX_TILES = 36

/**
 * Extra ring of tiles around the lot's own.
 *
 * Two reasons, both seen in testing. A lot sitting near a tile edge has its
 * street centreline in the next tile, so without a margin it cannot be named
 * from its own frontage. And Martin can fail one tile while its neighbours are
 * fine, which with a single-tile fetch blanks every road for that lot. One ring
 * costs a few small requests and removes both.
 */
const TILE_MARGIN = 1

function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  ]
}

function toLngLat(z: number, x: number, y: number, px: number, py: number, extent: number): [number, number] {
  const n = 2 ** z
  const lon = ((x + px / extent) / n) * 360 - 180
  const m = Math.PI - 2 * Math.PI * ((y + py / extent) / n)
  return [lon, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m)))]
}

/**
 * Every road centreline fragment whose tile touches `bbox`.
 *
 * Fragments, deliberately, and not one line per road. A road crossing a tile
 * edge appears in both tiles clipped differently, and de-duplicating on
 * `objectid` kept whichever fragment arrived first — on 121//DP836880 that was a
 * two-point stub of PAVILION PLACE clipped at the tile boundary, while the real
 * geometry sat in the tile next door. The frontage 19 m away could not be named
 * by it, and the lot reported no road at all.
 *
 * Keeping every fragment costs nothing here: nameRuns picks one road per run by
 * closest approach, and mergeByRoad then merges runs sharing a street name, so
 * the same street arriving in four pieces still yields one frontage.
 *
 * Returns [] rather than throwing when the tile server is unreachable — an
 * unnamed frontage is a worse answer than a named one, but it is still an
 * answer, and losing the road name must never lose the frontage.
 */
export async function fetchRoadLines(
  martinBase: string,
  bbox: [number, number, number, number],
): Promise<RoadLine[]> {
  const base = String(martinBase || '').replace(/\/+$/, '')
  if (!base) return []

  const [minX, minY, maxX, maxY] = bbox
  const [ax0, ay0] = tileXY(minX, maxY, ZOOM)
  const [ax1, ay1] = tileXY(maxX, minY, ZOOM)
  const x0 = ax0 - TILE_MARGIN, y0 = ay0 - TILE_MARGIN
  const x1 = ax1 + TILE_MARGIN, y1 = ay1 + TILE_MARGIN

  const tiles: [number, number][] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) tiles.push([x, y])
  }
  if (tiles.length > MAX_TILES) tiles.length = MAX_TILES

  const out: RoadLine[] = []
  const results = await Promise.allSettled(tiles.map(async ([x, y]) => {
    const res = await fetch(`${base}/${LAYER}/${ZOOM}/${x}/${y}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return { x, y, buf: new Uint8Array(await res.arrayBuffer()) }
  }))

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value || !r.value.buf.length) continue
    const { x, y, buf } = r.value
    let layer: any
    try {
      layer = new VectorTile(new Protobuf(buf)).layers[LAYER]
    } catch {
      continue // a truncated or non-MVT body is not worth failing the request over
    }
    if (!layer) continue

    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      const props: any = f.properties ?? {}
      // Every part, not just the longest: a road recorded in pieces is still
      // that road, and the piece beside this lot is not always the longest one.
      for (const part of f.loadGeometry()) {
        if (!part || part.length < 2) continue
        out.push({
          name: props.roadnamebase != null ? String(props.roadnamebase) : null,
          type: props.roadnametype != null ? String(props.roadnametype) : null,
          hierarchy: props.functionhierarchy != null ? Number(props.functionhierarchy) : null,
          coords: part.map((p: any) => toLngLat(ZOOM, x, y, p.x, p.y, layer.extent)),
        })
      }
    }
  }
  return out
}
