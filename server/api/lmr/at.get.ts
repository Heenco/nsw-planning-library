/**
 * What applies at a point - every SEPP land application layer and every LMR constraint polygon, switched on or
 * not - read from the PMTiles archives, not the database.
 *
 *   /api/lmr/at?lon=151.2093&lat=-33.8688
 *
 * For each archive, takes its maximum-zoom tile under the point (z14, a few metres a tile unit over NSW),
 * decodes it and tests the point against every polygon with an even-odd ray cast over all of a feature's rings,
 * which handles holes and multipolygons alike. At the maximum zoom tippecanoe keeps full detail, so the answer
 * matches what is drawn. Points and lines (stations, pipelines) cannot contain a point and are skipped.
 */
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { CONSTRAINT_GROUPS, constraintStyle, familyOf, type LmrHit } from '#shared/lmr-layers'
import { archiveFor, MVT_LAYER, type ArchiveSet } from '../../utils/sepp-pmtiles'

function tileFor(lon: number, lat: number, z: number) {
  const n = 2 ** z
  const xf = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const x = Math.floor(xf)
  const y = Math.floor(yf)
  return { x, y, fx: xf - x, fy: yf - y }
}

/** Even-odd point in polygon over every ring of a feature, in tile units. */
function inside(px: number, py: number, rings: { x: number; y: number }[][]): boolean {
  let c = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!
      const b = ring[j]!
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c
    }
  }
  return c
}

/** The polygon features of one archive's maximum-zoom tile that contain the point, with their properties. */
async function featuresAt(set: ArchiveSet, lon: number, lat: number): Promise<Record<string, any>[]> {
  const { pmtiles } = await archiveFor(set)
  const header = await pmtiles.getHeader()
  for (let z = header.maxZoom; z >= header.minZoom; z--) {
    const t = tileFor(lon, lat, z)
    const tile = await pmtiles.getZxy(z, t.x, t.y)
    if (!tile?.data) continue
    // getZxy returns the tile already inflated
    const layer = new VectorTile(new Pbf(new Uint8Array(tile.data))).layers[MVT_LAYER[set]]
    if (!layer) return []
    const px = t.fx * layer.extent
    const py = t.fy * layer.extent
    const out: Record<string, any>[] = []
    const seen = new Set<string>()
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      if (f.type !== 3) continue
      const bb = f.bbox()
      if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) continue
      if (!inside(px, py, f.loadGeometry())) continue
      const p = f.properties as Record<string, any>
      // a feature cut across a tile can repeat; one hit per feature is enough
      const id = `${f.id ?? i}|${JSON.stringify(p)}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(p)
    }
    return out
  }
  return []
}

export default defineEventHandler(async (event): Promise<{ lon: number; lat: number; hits: LmrHit[] }> => {
  const q = getQuery(event)
  const lon = Number(q.lon)
  const lat = Number(q.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 140 || lon > 160 || lat < -45 || lat > -25) {
    throw createError({ statusCode: 400, statusMessage: 'lon and lat must be a point in or near NSW' })
  }
  const [sepp, lmr] = await Promise.all([
    featuresAt('sepp', lon, lat),
    featuresAt('lmr', lon, lat).catch(() => []),   // the constraints archive is optional
  ])

  const hits: LmrHit[] = sepp.map(p => ({
    key: String(p.layer_key),
    family: familyOf(String(p.sepp), String(p.layer_group)),
    sepp: String(p.sepp),
    layName: String(p.lay_name),
    layClass: p.lay_class ?? null,
    label: p.label ?? null,
    clause: p.clause ?? null,
    lga: p.lga ?? null,
    commenced: p.commenced ?? null,
  }))
  for (const p of lmr) {
    const s = constraintStyle(String(p.layer_key))
    hits.push({
      key: String(p.layer_key),
      family: 'constraint',
      sepp: s.group === 'housing' ? 'Low and Mid Rise housing' : CONSTRAINT_GROUPS[s.group].title,
      layName: s.title || String(p.layer_key),
      layClass: p.category ?? null,
      label: p.name ?? null,
      clause: p.detail ?? null,
      lga: null,
      commenced: null,
    })
  }
  // LMR layers first, then the constraints, then every other SEPP layer
  const rank = (h: LmrHit) => (h.family === 'lmr' ? 0 : h.family === 'constraint' ? 1 : 2)
  hits.sort((a, b) => rank(a) - rank(b) || a.sepp.localeCompare(b.sepp) || a.layName.localeCompare(b.layName))
  return { lon, lat, hits }
})
