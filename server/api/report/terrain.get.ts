/**
 * GET /api/report/terrain?cadid=  - ground levels, contours and slope over a lot and its surroundings, for /report-2's
 * Slope section ("Levels and contours"), plus the survey marks nearby.
 *
 * Sources, all read live:
 *   - levels: NSW Spatial Services' state-wide 5 m elevation model (NSW_5M_Elevation ImageServer, AHD, bare earth from
 *     stereo imagery), sampled bilinearly on a 1.25 m+ grid over the lot and a margin round it;
 *   - survey marks: the NSW survey mark register (NSW_Survey_Mark MapServer), with their AHD heights and classes;
 *   - the lot, the lots round it and the road centrelines: planningai's cadastre (GDA94).
 *
 * The levels are smoothed once (1-2-1) before contouring and slope, so the 5 m model's cell steps do not show as kinks;
 * levels quoted at the corners and the high and low points are the unsmoothed samples. The arithmetic is shared/terrain.mjs.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { arcgisQuery } from '../../utils/arcgis-retry'
import { simplifyRing } from '#shared/siting.mjs'
import { smoothGrid, slopeGrid, fitPlane, contourInterval, contours, inRing, distToLine, median } from '#shared/terrain.mjs'

const DEM = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer'
const MARKS = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Survey_Mark/MapServer/0'
/** Slope bands, the same cuts as the section's "how much of the lot is how steep" bar. */
const BAND_CUTS = [5, 10, 15, 20, 25]
const MAX_POINTS = 2600
/** getSamples answers at most 1,000 points a request - more are dropped without an error. */
const CHUNK = 1000
const MARK_RADIUS_M = 300

const q = (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])
const cache = new Map<string, { at: number; body: any }>()

/** Local metres about a centre: equirectangular, as shared/lot-frame.mjs - centimetre-true over a few hundred metres. */
function frame(c: [number, number]) {
  const mLat = 111132.92 - 559.82 * Math.cos((2 * c[1] * Math.PI) / 180)
  const mLng = 111412.84 * Math.cos((c[1] * Math.PI) / 180)
  return {
    toLocal: (p: number[]): [number, number] => [(p[0]! - c[0]) * mLng, (p[1]! - c[1]) * mLat],
    toLonLat: (x: number, y: number): [number, number] => [c[0] + x / mLng, c[1] + y / mLat],
  }
}
const R = 6378137
const merc = (lon: number, lat: number) => [R * (lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))]

/** Levels at points from the elevation service, bilinear; null where the model has no value. */
async function sample(points: [number, number][]): Promise<(number | null)[]> {
  const chunks: [number, number][][] = []
  for (let i = 0; i < points.length; i += CHUNK) chunks.push(points.slice(i, i + CHUNK))
  const one = async (pts: [number, number][]): Promise<(number | null)[]> => {
    const body = new URLSearchParams({
      geometry: JSON.stringify({ points: pts.map(p => merc(p[0], p[1])), spatialReference: { wkid: 102100 } }),
      geometryType: 'esriGeometryMultipoint',
      interpolation: 'RSP_BilinearInterpolation',
      returnFirstValueOnly: 'true',
      f: 'json',
    })
    let last = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${DEM}/getSamples`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) })
        if (!res.ok) { last = `HTTP ${res.status}`; if (res.status < 500) break; continue }
        const json: any = await res.json()
        if (json?.error) { last = String(json.error.message ?? 'rejected'); break }
        const out: (number | null)[] = new Array(pts.length).fill(null)
        for (const s of json.samples ?? []) {
          const v = Number(s.value)
          if (Number.isFinite(v) && v > -100 && v < 3000) out[s.locationId] = v
        }
        return out
      } catch (e: any) { last = e?.name === 'TimeoutError' ? 'timed out' : String(e?.message ?? e) }
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
    throw createError({ statusCode: 502, statusMessage: `The NSW elevation service did not answer (${last}).` })
  }
  // One request at a time: the service answers 1,000 points in ~0.2 s, but parallel requests queue (8 x 300 took 17 s).
  const out: (number | null)[] = []
  for (const c of chunks) out.push(...await one(c))
  return out
}

export default defineEventHandler(async (event) => {
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const hit = cache.get(cadid)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.body
  const t0 = Date.now()

  // ── the lot: its largest part, anticlockwise, and the road it fronts ──
  const lot = (await q(
    `SELECT l.lotidstring,
            ST_AsGeoJSON(ST_ForcePolygonCCW((SELECT d.geom FROM ST_Dump(l.geom) d ORDER BY ST_Area(d.geom) DESC LIMIT 1)), 9) AS ring,
            ST_AsGeoJSON(ST_Envelope(l.geom), 9) AS box,
            f.primary_frontage_road AS road, f.area_sqm
     FROM cadastre.lot l LEFT JOIN derived.lot_frontage f ON f.cadid = l.cadid
     WHERE l.cadid = $1 LIMIT 1`, [cadid])).rows[0]
  if (!lot?.ring) throw createError({ statusCode: 404, statusMessage: 'No boundary is held for this lot.' })
  const ringLL: number[][] = JSON.parse(lot.ring).coordinates[0]
  const centre: [number, number] = [ringLL.reduce((s, p) => s + p[0]!, 0) / ringLL.length, ringLL.reduce((s, p) => s + p[1]!, 0) / ringLL.length]
  const F = frame(centre)
  const ring = ringLL.map(p => F.toLocal(p))
  const corners = (simplifyRing(ringLL, 10) as number[][]).slice(0, -1)

  // ── the frame: the lot plus a margin, gridded to stay inside the sample budget ──
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1])
  const lotW = Math.max(...xs) - Math.min(...xs), lotH = Math.max(...ys) - Math.min(...ys)
  const pad = Math.max(12, 0.3 * Math.max(lotW, lotH))
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
  const W = lotW + 2 * pad, H = lotH + 2 * pad
  const step = Math.max(1.25, Math.ceil(Math.sqrt((W * H) / MAX_POINTS) * 4) / 4)
  const nx = Math.floor(W / step) + 1, ny = Math.floor(H / step) + 1
  const nodes: [number, number][] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodes.push(F.toLonLat(x0 + i * step, y0 + j * step))

  // neighbours and roads inside the frame box (built in the cadastre's own SRID so the GiST index is used)
  const [bw, bs] = F.toLonLat(x0, y0), [be, bn] = F.toLonLat(x0 + W, y0 + H)
  const markBody = new URLSearchParams({
    geometry: `${centre[0]},${centre[1]}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    distance: String(MARK_RADIUS_M), units: 'esriSRUnit_Meter',
    outFields: 'marktype,marknumber,markstatus,gdaclass,ahdheight,ahdclass,ahdorder', returnGeometry: 'true', outSR: '4326', f: 'json',
  })
  const [levels, neighbourRows, roadRows, markRes] = await Promise.all([
    sample([...corners.map(p => [p[0], p[1]] as [number, number]), ...nodes]),
    q(`WITH box AS (SELECT ST_MakeEnvelope($1, $2, $3, $4, 4283) AS b), site AS (SELECT geom FROM cadastre.lot WHERE cadid = $5 LIMIT 1)
       SELECT l.lotidstring, ST_AsGeoJSON(ST_SimplifyPreserveTopology(l.geom, 0.000002), 8) AS g,
              ST_DWithin(l.geom, site.geom, 0.000005) AS adjoins
       FROM cadastre.lot l, box, site
       WHERE l.geom && box.b AND l.cadid <> $5 AND coalesce(l.classsubtype, 0) <> 4
       LIMIT 160`, [bw, bs, be, bn, cadid]).then(r => r.rows),
    q(`WITH box AS (SELECT ST_MakeEnvelope($1, $2, $3, $4, 4283) AS b)
       SELECT r.roadnamelabel AS name, ST_AsGeoJSON(ST_ClipByBox2D(r.geom, box.b), 8) AS g
       FROM cadastre.roadcentreline r, box WHERE r.geom && box.b LIMIT 60`, [bw, bs, be, bn]).then(r => r.rows),
    arcgisQuery(MARKS, markBody, { timeoutMs: 12000, maxAttempts: 2 }),
  ])
  const cornerZ = levels.slice(0, corners.length)
  const zRaw = levels.slice(corners.length)
  if (zRaw.every(v => v == null)) throw createError({ statusCode: 404, statusMessage: 'The NSW elevation model has no levels here.' })

  const zs = smoothGrid(zRaw, nx, ny)
  const slope = slopeGrid(zs, nx, ny, step)

  // ── the lot's own figures: nodes inside it, plus its corners ──
  const inside: number[] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inRing(x0 + i * step, y0 + j * step, ring)) inside.push(j * nx + i)
  const pts: { x: number; y: number; z: number }[] = []
  for (const k of inside) if (zRaw[k] != null) pts.push({ x: x0 + (k % nx) * step, y: y0 + Math.floor(k / nx) * step, z: zRaw[k]! })
  const cornerPts = corners.map((p, i) => { const [x, y] = F.toLocal(p); return { x, y, z: cornerZ[i] ?? null } })
  for (const c of cornerPts) if (c.z != null) pts.push({ x: c.x, y: c.y, z: c.z })
  if (pts.length < 3) throw createError({ statusCode: 404, statusMessage: 'The NSW elevation model has too few levels inside this lot.' })
  const high = pts.reduce((a, b) => (b.z > a.z ? b : a), pts[0]!)
  const low = pts.reduce((a, b) => (b.z < a.z ? b : a), pts[0]!)
  const plane = fitPlane(pts.map(p => [p.x, p.y, p.z]))
  const lotSlopes = inside.map(k => slope[k]).filter((v): v is number => v != null)
  const bandOf = (v: number) => BAND_CUTS.findIndex(c => v < c) === -1 ? BAND_CUTS.length : BAND_CUTS.findIndex(c => v < c)
  const shares = new Array(BAND_CUTS.length + 1).fill(0)
  for (const v of lotSlopes) shares[bandOf(v)] += 1 / lotSlopes.length

  // ── roads, and whether the lot falls toward or away from the street it fronts ──
  const roads = roadRows.flatMap((r: any) => {
    const g = JSON.parse(r.g ?? 'null')
    const parts: number[][][] = !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
    return parts.filter(p => p.length > 1).map(p => ({ name: r.name as string | null, line: p.map(q => F.toLocal(q)) }))
  })
  const edges = cornerPts.map((a, i) => {
    const b = cornerPts[(i + 1) % cornerPts.length]!
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const near = roads.reduce((best, r) => { const d = distToLine(mx, my, r.line); return d < best.d ? { d, name: r.name } : best }, { d: Infinity, name: null as string | null })
    return { from: i, to: (i + 1) % cornerPts.length, length: Math.hypot(b.x - a.x, b.y - a.y), roadDist: near.d, road: near.name, rl: a.z != null && b.z != null ? Math.min(a.z, b.z) : null } // the edge's lower end: where water could leave
  })
  const nearest = Math.min(...edges.map(e => e.roadDist))
  const streetEdges = edges.filter(e => e.roadDist <= Math.min(nearest + 4, 35))
  const streetRL = streetEdges.length ? Math.min(...streetEdges.map(e => e.rl ?? Infinity)) : null
  const street = streetRL != null && Number.isFinite(streetRL)
    ? { rl: streetRL, road: streetEdges.find(e => e.rl === streetRL)?.road ?? lot.road ?? null, edges: streetEdges.map(e => e.from), fallsAway: low.z < streetRL - 0.3 }
    : null

  // ── survey marks, nearest first ──
  const marks = (markRes.ok ? markRes.json?.features ?? [] : []).map((f: any) => {
    const a = f.attributes ?? {}
    const [x, y] = F.toLocal([f.geometry?.x, f.geometry?.y])
    return {
      id: `${a.marktype ?? ''}${a.marknumber ?? ''}`, type: a.marktype ?? null, ahd: a.ahdheight == null ? null : Number(a.ahdheight),
      ahdClass: a.ahdclass ?? null, ahdOrder: a.ahdorder ?? null, gdaClass: a.gdaclass ?? null, status: a.markstatus ?? null,
      x, y, dist: Math.hypot(x, y), inFrame: x >= x0 && x <= x0 + W && y >= y0 && y <= y0 + H,
    }
  }).sort((a: any, b: any) => (a.ahd == null ? 1 : 0) - (b.ahd == null ? 1 : 0) || a.dist - b.dist).slice(0, 8)

  // ── contours over the whole frame, interval by the relief ──
  let lo = Infinity, hi = -Infinity
  for (const v of zs) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  const interval = contourInterval(hi - lo)
  const lines = contours(zs, nx, ny, x0, y0, step, interval)

  const body = {
    cadid, lotId: lot.lotidstring ?? null,
    frame: { x0, y0, W, H, step, nx, ny, centre },
    lot: { ring: ring.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), corners: cornerPts.map(c => ({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), rl: c.z == null ? null : +c.z.toFixed(2) })), edges: edges.map(e => ({ from: e.from, to: e.to, length: +e.length.toFixed(2) })) },
    levels: {
      high: { x: high.x, y: high.y, rl: +high.z.toFixed(2) },
      low: { x: low.x, y: low.y, rl: +low.z.toFixed(2) },
      fall: +(high.z - low.z).toFixed(2),
      grade: plane ? +plane.grade.toFixed(1) : null,
      fallsToward: plane ? Math.round(plane.fallsToward) : null,
      slopeMedian: lotSlopes.length ? +median(lotSlopes)!.toFixed(1) : null,
      slopeMax: lotSlopes.length ? +Math.max(...lotSlopes).toFixed(1) : null,
      shares: shares.map(s => +s.toFixed(3)),
      samples: pts.length,
    },
    street,
    /** one character per grid node, row by row from the south: the slope band (0 = under 5% ... 5 = over 25%) or '.' */
    bands: Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => { const v = slope[j * nx + i]; return v == null ? '.' : String(bandOf(v)) }).join('')),
    bandCuts: BAND_CUTS,
    contours: { ...interval, levels: lines },
    neighbours: neighbourRows.flatMap((r: any) => {
      const g = JSON.parse(r.g ?? 'null')
      const polys: number[][][][] = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      return polys.map(p => ({ lotId: r.lotidstring as string | null, adjoins: !!r.adjoins, ring: p[0]!.map(q => F.toLocal(q).map(v => +v.toFixed(2))) }))
    }),
    roads: roads.map(r => ({ name: r.name, line: r.line.map(p => p.map(v => +v.toFixed(2))) })),
    marks,
    marksNote: markRes.ok ? null : `The survey mark register could not be searched (${markRes.message ?? markRes.reason}).`,
    sources: {
      levels: 'NSW Spatial Services 5 m elevation model (NSW_5M_Elevation, AHD), sampled bilinearly and smoothed once',
      marks: 'NSW survey mark register (NSW_Survey_Mark)',
      cadastre: 'NSW cadastre (planningai, GDA94)',
    },
    ms: Date.now() - t0,
  }
  cache.set(cadid, { at: Date.now(), body })
  if (cache.size > 40) cache.delete(cache.keys().next().value!)
  return body
})
