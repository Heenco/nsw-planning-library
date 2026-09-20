/**
 * Everything the EPI schema says about one lot, for the click and the search on /epi.
 *
 * THE TEST IS THE LOT POLYGON, NOT A POINT. Measured over 3,000 lots, testing the address point instead
 * of the whole lot misses a real overlap often enough to matter: 207 lots in 3,000 for minimum lot size,
 * 98 for terrestrial biodiversity, and heritage finds 76 lots by polygon against 22 by point. A lot whose
 * house sits on the dry half of a flood line is still partly in the flood planning area, and an answer
 * that says otherwise is wrong in the direction that costs someone money.
 *
 * So a request resolves a lot first - by `cadid` when the caller already knows it, otherwise the lot under
 * `lon`/`lat` - and intersects every layer against that polygon. A click on a road or on water has no lot,
 * and only then is the point itself the test; `basis` says which happened.
 *
 * Because the test is an area, each hit carries how much of the lot it covers. That is what a polygon test
 * earns you: split zoning reads as 60/40 rather than as whichever zone the front door happens to be in.
 *
 * The lot is shrunk by 10 cm first. Cadastre and planning layers share their boundaries, so testing the
 * raw parcel returns every neighbouring polygon that merely touches its edge, each covering 0% of it.
 *
 * The answer comes from PostGIS, not from the tiles. Every one of the 56 epi tables has a GiST index and a
 * lot is a small polygon, so the whole sweep is a few hundred milliseconds against the real geometry
 * rather than a simplified, zoom-dependent copy of it.
 *
 * The column list is read from the catalogue and cached, because the epi tables share a schema but not
 * exactly: a table missing `lga_name` or `sym_code` contributes NULL rather than failing the union. 01A
 * replaces the whole schema, so the cache is short. The map sheet index is never queried.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface EpiHit {
  layer: string
  epiName: string | null
  layName: string | null
  layClass: string | null
  label: string | null
  symCode: string | null
  lgaName: string | null
  clause: string | null
  value: string | null
  mapName: string | null
  /** How much of the lot this row covers, 0-100. Null when the test was a point rather than a lot. */
  coverPct: number | null
}

export interface EpiAtResponse {
  lon: number | null
  lat: number | null
  /** 'lot' when a lot polygon was tested, 'point' when nothing covers the position. */
  basis: 'lot' | 'point'
  lot: { cadid: string | null; lotId: string | null; lga: string | null; areaM2: number | null } | null
  /** The geometry that was tested, so the page can outline exactly what the answer is about. */
  lotGeom: unknown | null
  layers: number
  hits: EpiHit[]
  ms: number
}

const WANTED = ['epi_name', 'lay_name', 'lay_class', 'label', 'sym_code', 'lga_name',
  'legis_ref_clause', 'legis_ref_value', 'map_name'] as const

/** The printed map sheet index. Not a control, and it matches a dozen times on any address. */
const NOT_A_CONTROL = new Set(['epi_map_tiles'])

const CACHE_MS = 5 * 60 * 1000
let cached: { at: number; sql: string } | null = null

/**
 * One UNION ALL over every epi layer against the target geometry, which is parsed once in a MATERIALIZED
 * CTE and cross-joined into each branch rather than re-parsed fifty-five times.
 */
async function unionSql(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.sql

  const cols = await nswQuery<{ table: string; geom: string; columns: string[] }>(`
    SELECT g.f_table_name AS "table",
           g.f_geometry_column AS geom,
           array_agg(c.column_name::text) AS columns
    FROM geometry_columns g
    JOIN information_schema.columns c
      ON c.table_schema = g.f_table_schema AND c.table_name = g.f_table_name
    WHERE g.f_table_schema = 'epi'
    GROUP BY 1, 2
    ORDER BY 1`)

  const parts = cols.rows.filter(t => !NOT_A_CONTROL.has(t.table)).map((t) => {
    const have = new Set(t.columns.map(c => c.toLowerCase()))
    const pick = (c: string) => (have.has(c) ? `e."${c}"::text` : 'NULL::text')
    const g = `e."${t.geom}"`
    // Planar area is fine for a ratio over one small polygon. ST_ClipByBox2D first cuts the layer polygon
    // down to the lot's envelope, which spares the overlay from the statewide land application shapes:
    // measured identical to a plain intersection over 25 lots, at 162 ms against 357 ms. A point has no
    // area, so the share is null there.
    const cover = `CASE WHEN ST_Dimension(t.g) = 2
                        THEN 100 * ST_Area(ST_Intersection(ST_ClipByBox2D(${g}, ST_Envelope(t.g)), t.g))
                             / NULLIF(ST_Area(t.g), 0) END`
    // sorted on, never returned: within a layer the smallest polygon is the most specific control
    const size = have.has('shape_area') ? 'e."shape_area"::double precision' : 'NULL::double precision'
    return `SELECT '${t.table}'::text AS layer, ${WANTED.map(pick).join(', ')},
                   (${cover})::double precision AS cover_pct,
                   ${size} AS sort_size
            FROM epi."${t.table}" e, t
            WHERE ${g} && t.g AND ST_Intersects(${g}, t.g)`
  })

  /*
   * The lot is shrunk by 10 cm before anything is tested. Cadastre and planning layers are drawn to the
   * same boundaries, so without it every neighbouring polygon that merely touches the lot edge comes back
   * as a hit covering 0% of it - a road reserve zoned SP2 alongside an R2 lot, and so on. Ten centimetres
   * is far below the accuracy of either dataset and removes all of them.
   *
   * Buffering happens in NSW Lambert so the distance is a real 10 cm rather than a tenth of a degree, and
   * a sliver of a lot narrower than 20 cm would vanish entirely, so the unshrunk shape is kept in that
   * case. A point is never buffered.
   */
  const sql = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(ST_GeomFromEWKT($1)) AS g0),
     t AS MATERIALIZED (
       SELECT CASE WHEN ST_Dimension(g0) <> 2 THEN g0
                   WHEN b IS NULL OR ST_IsEmpty(b) THEN g0
                   ELSE b END AS g
       FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x)
`
    + parts.join('\nUNION ALL\n')
    + '\nORDER BY layer, cover_pct DESC NULLS LAST, sort_size NULLS LAST\nLIMIT 400'
  cached = { at: Date.now(), sql }
  return sql
}

interface LotRow {
  cadid: string | null
  lotId: string | null
  lga: string | null
  areaM2: number | null
  ewkt: string | null
  geojson: string | null
}

const LOT_COLUMNS = `cadid, lotidstring AS "lotId", lganame AS lga,
                     ST_Area(geom::geography) AS "areaM2",
                     ST_AsEWKT(geom) AS ewkt, ST_AsGeoJSON(geom, 7) AS geojson`

export default defineEventHandler(async (event): Promise<EpiAtResponse> => {
  const q = getQuery(event)
  const cadid = q.cadid == null ? null : String(q.cadid).trim()
  const lon = Number(q.lon)
  const lat = Number(q.lat)
  const havePoint = Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= 140 && lon <= 155 && lat >= -38 && lat <= -27

  if (!cadid && !havePoint) {
    throw createError({ statusCode: 400, statusMessage: 'Give either cadid, or lon and lat inside NSW' })
  }
  setHeader(event, 'cache-control', 'public, max-age=60')

  const started = Date.now()
  const point = havePoint ? `SRID=4283;POINT(${lon} ${lat})` : null

  const lotRes = await (cadid
    ? nswQuery<LotRow>(`SELECT ${LOT_COLUMNS} FROM cadastre.lot WHERE cadid = $1 LIMIT 1`, [cadid])
    : nswQuery<LotRow>(
        `SELECT ${LOT_COLUMNS} FROM cadastre.lot
         WHERE geom && $1::geometry AND ST_Intersects(geom, $1::geometry)
         ORDER BY shape_area NULLS LAST LIMIT 1`, [point])
  ).catch(() => ({ rows: [] as LotRow[] }))

  const lot = lotRes.rows[0] ?? null
  if (!lot?.ewkt && !point) {
    throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })
  }

  const target = lot?.ewkt ?? point!
  const sql = await unionSql()
  const hits = await nswQuery<any>(sql, [target])

  const rows: EpiHit[] = hits.rows.map(r => ({
    layer: r.layer,
    epiName: r.epi_name,
    layName: r.lay_name,
    layClass: r.lay_class,
    label: r.label,
    symCode: r.sym_code,
    lgaName: r.lga_name,
    clause: r.legis_ref_clause,
    value: r.legis_ref_value,
    mapName: r.map_name,
    coverPct: r.cover_pct == null ? null : Math.min(100, Number(r.cover_pct)),
  }))

  return {
    lon: havePoint ? lon : null,
    lat: havePoint ? lat : null,
    basis: lot?.ewkt ? 'lot' : 'point',
    lot: lot ? { cadid: lot.cadid, lotId: lot.lotId, lga: lot.lga, areaM2: lot.areaM2 } : null,
    lotGeom: lot?.geojson ? JSON.parse(lot.geojson) : null,
    layers: new Set(rows.map(r => r.layer)).size,
    hits: rows,
    ms: Date.now() - started,
  }
})
