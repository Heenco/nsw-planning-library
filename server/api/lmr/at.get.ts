/**
 * What applies at a point - every SEPP land application layer and every LMR constraint polygon, switched on or
 * not - read from the PMTiles archives, not the database.
 *
 *   /api/lmr/at?lon=151.2093&lat=-33.8688
 *
 * TWO BASES, AND THE CALLER PICKS
 *
 *   ?cadid=     the LOT POLYGON, shrunk 10 cm, against PostGIS - the same test /epi, /cdc-map and /esa
 *               make, so the four can be compared. Returns how much of the lot each layer covers.
 *   ?lon=&lat=  a single POINT, against the PMTiles archives. This is what the /lmr map click uses,
 *               because it answers "what is under my cursor" and needs no lot.
 *
 * They can disagree, and the disagreement is real rather than a bug: a lot half inside a flood layer is
 * a hit on the polygon and a miss on a point sitting on the dry half. Whichever was used comes back as
 * `basis` so a caller can never mistake one for the other.
 *
 * THE POINT PATH takes each archive's maximum-zoom tile under the point (z14, a few metres a tile unit over
 * NSW), decodes it and tests the point against every polygon with an even-odd ray cast over all of a
 * feature's rings, which handles holes and multipolygons alike. At the maximum zoom tippecanoe keeps full
 * detail, so the answer matches what is drawn. Points and lines (stations, pipelines) cannot contain a
 * point and are skipped.
 *
 * THE LOT PATH is driven by `lmr.layers`, the catalogue: its `constraint` half names a table of the lmr
 * schema, its `sepp` half names a slice of epi.epi_land_application by (epi_name, lay_name). So a layer
 * added to the catalogue reaches this answer without editing anything here.
 */
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { CONSTRAINT_GROUPS, constraintStyle, familyOf, type LmrHit } from '#shared/lmr-layers'
import { nswQuery } from '../../utils/nsw-kg/pool'
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

// ── The lot path ────────────────────────────────────────────────────────────────────────────────

/** The label column, first match wins. The lmr tables come from as many publishers as the esa ones. */
const NAME_COLUMNS = ['label', 'station', 'itemname', 'h_name', 'name', 'lay_class', 'd_category',
  'anef_code', 'sym_code', 'precinct', 'amendment']

const CACHE_MS = 5 * 60 * 1000
let lotSql: { at: number; sql: string; meta: Map<string, any> } | null = null

/**
 * One UNION ALL over every layer in `lmr.layers` that holds features.
 *
 * The two halves read from different places: a `constraint` row is a table of the lmr schema, a `sepp`
 * row is epi.epi_land_application narrowed by the catalogue's own `filter` string. Both are already
 * recorded there, so this builds from the catalogue rather than from a second list.
 */
async function buildLotSql() {
  if (lotSql && Date.now() - lotSql.at < CACHE_MS) return lotSql

  const cat = await nswQuery<any>(`
    SELECT key, title, half, grp, grp_title, table_name, filter, features, source
    FROM lmr.layers WHERE features > 0 ORDER BY grp_order, title`)
  const cols = await nswQuery<any>(`
    SELECT n.nspname AS schema, c.relname AS rel,
           (SELECT g.f_geometry_column FROM geometry_columns g
             WHERE g.f_table_schema = n.nspname AND g.f_table_name = c.relname LIMIT 1) AS gcol,
           (SELECT g.srid FROM geometry_columns g
             WHERE g.f_table_schema = n.nspname AND g.f_table_name = c.relname LIMIT 1) AS srid,
           array_agg(a.attname::text ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname IN ('lmr', 'epi') AND c.relkind IN ('r', 'v', 'm')
    GROUP BY 1, 2`)
  const byRel = new Map(cols.rows.map(r => [`${r.schema}.${r.rel}`, r]))

  const parts: string[] = []
  const meta = new Map<string, any>()
  for (const r of cat.rows) {
    const t = byRel.get(r.table_name)
    if (!t?.gcol) continue
    // measured SRID from the catalogue where the column has none declared: two lmr tables are declared
    // plain `geometry`, and transforming the lot into SRID 0 would throw
    const srid = Number(t.srid) || 4283
    const name = NAME_COLUMNS.find(c => (t.columns ?? []).includes(c))
    const cls = ['lay_class', 'd_category', 'sym_code', 'distance_m'].find(c => (t.columns ?? []).includes(c))
    const inst = (t.columns ?? []).includes('epi_name') ? 'epi_name' : null
    const g = `ST_Transform(t.g, ${srid})`
    const caught = `ST_Union(ST_Intersection(ST_ClipByBox2D(c."${t.gcol}", ST_Envelope(${g})), ${g}))`
    const [schema, rel] = String(r.table_name).split('.')
    // the catalogue's filter is the same predicate the tile build uses to cut this layer out
    const where = r.filter && r.half === 'sepp' ? ` AND (${r.filter})` : ''
    parts.push(`SELECT '${r.key}'::text AS key,
        ${name ? `(array_agg(DISTINCT c."${name}"::text) FILTER (WHERE c."${name}" IS NOT NULL))[1]` : 'NULL::text'} AS label,
        ${cls ? `(array_agg(DISTINCT c."${cls}"::text) FILTER (WHERE c."${cls}" IS NOT NULL))[1]` : 'NULL::text'} AS lay_class,
        ${inst ? `(array_agg(DISTINCT c."${inst}"::text) FILTER (WHERE c."${inst}" IS NOT NULL))[1]` : 'NULL::text'} AS instrument,
        100 * ST_Area(ST_Transform(${caught}, 3308)) / NULLIF(max(t.area_m2), 0) AS cover_pct
      FROM "${schema}"."${rel}" c, t
      WHERE c."${t.gcol}" && ${g} AND ST_Intersects(c."${t.gcol}", ${g})${where}`)
    meta.set(r.key, r)
  }

  const sql = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(ST_GeomFromEWKT($1)) AS g0),
     shrunk AS MATERIALIZED (
       SELECT CASE WHEN ST_Dimension(g0) <> 2 THEN g0
                   WHEN b IS NULL OR ST_IsEmpty(b) THEN g0
                   ELSE b END AS g
       FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x),
     t AS MATERIALIZED (SELECT g, ST_Area(ST_Transform(g, 3308)) AS area_m2 FROM shrunk)
` + parts.join('\nUNION ALL\n')

  lotSql = { at: Date.now(), sql, meta }
  return lotSql
}

async function hitsForLot(cadid: string) {
  const lot = await nswQuery<any>(
    `SELECT cadid, lotidstring AS "lotId", lganame AS lga, ST_Area(geom::geography) AS "areaM2",
            ST_AsEWKT(geom) AS ewkt
     FROM cadastre.lot WHERE cadid = $1 LIMIT 1`, [cadid])
  const row = lot.rows[0]
  if (!row?.ewkt) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  const { sql, meta } = await buildLotSql()
  const res = await nswQuery<any>(sql, [row.ewkt])
  const hits: (LmrHit & { coverPct: number })[] = res.rows
    .filter(r => r.cover_pct != null)
    .map((r) => {
      const m = meta.get(r.key) ?? {}
      const isSepp = m.half === 'sepp'
      return {
        key: r.key,
        // the catalogue already groups these (grp is 'lmr' or 'sepp-<family>'); familyOf() takes a SEPP
        // NAME, and feeding it the source string made every SEPP layer read as 'systems'
        family: isSepp
          ? (m.grp === 'lmr' ? 'lmr' : String(m.grp ?? '').replace(/^sepp-/, '')) as LmrHit['family']
          : 'constraint' as const,
        sepp: r.instrument ?? String(m.grp_title ?? ''),
        layName: String(m.title ?? r.key),
        layClass: r.lay_class ?? null,
        label: r.label ?? null,
        clause: null,
        lga: null,
        commenced: null,
        coverPct: Math.min(100, Number(r.cover_pct)),
      }
    })
    .sort((a, b) => b.coverPct - a.coverPct)
  return { lot: { cadid: row.cadid, lotId: row.lotId, lga: row.lga, areaM2: row.areaM2 }, hits }
}

export interface LmrAtResponse {
  /** Which test produced these hits. They are not interchangeable - see the file header. */
  basis: 'lot' | 'point'
  lon: number | null
  lat: number | null
  lot: { cadid: string | null; lotId: string | null; lga: string | null; areaM2: number | null } | null
  /** `coverPct` is present on the lot path only; a point is either in a polygon or not. */
  hits: (LmrHit & { coverPct?: number })[]
  ms: number
}

export default defineEventHandler(async (event): Promise<LmrAtResponse> => {
  const started = Date.now()
  const q = getQuery(event)
  const cadid = q.cadid == null ? null : String(q.cadid).trim()

  // the lot path first: given a cadid there is no reason to fall back to a point, and silently doing so
  // would answer a different question than the caller asked
  if (cadid) {
    setHeader(event, 'cache-control', 'public, max-age=60')
    const { lot, hits } = await hitsForLot(cadid)
    return { basis: 'lot', lon: null, lat: null, lot, hits, ms: Date.now() - started }
  }

  const lon = Number(q.lon)
  const lat = Number(q.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 140 || lon > 160 || lat < -45 || lat > -25) {
    throw createError({ statusCode: 400, statusMessage: 'Give either cadid, or lon and lat in or near NSW' })
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
  return { basis: 'point', lon, lat, lot: null, hits, ms: Date.now() - started }
})
