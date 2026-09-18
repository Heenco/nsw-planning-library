/**
 * The lot slope build: what "03 - slope calculations - spatial services" has
 * written into the `derived` schema, and how any one lot was measured.
 *
 *   /api/lotslope                   → the build: sheets, lots by method, timings, the sheet log
 *   /api/lotslope?q=26 Foveaux St   → matching lots, by address or lot reference
 *   /api/lotslope?cadid=101143132   → the lot's slope row and its trace: each sheet's pixels and sums
 *   /api/lotslope?samples=1         → one real lot per case worth checking
 *
 * THE THREE TABLES
 *
 * lot_slope_sheet is written a sheet at a time and is the build log. Each sheet
 * also writes its per-lot sums to lot_slope_part in the same transaction, so the
 * two always agree. lot_slope - one row per lot - is only built from the parts
 * at the end and swapped in, so while a run is going it is either the previous
 * build or absent. The trace therefore reads the parts, which exist mid-run, and
 * shows the final row beside them when there is one.
 *
 * Every table is probed with to_regclass first: querying a table that does not
 * exist yet is an error, not an empty result.
 */

import type pg from 'pg'
import { withNswClient } from '../utils/nsw-kg/pool'

const SEARCH_LIMIT = 25
const SAMPLE_TTL_MS = 10 * 60 * 1000
/** Every one of the 342 NSW Spatial Services 5 m slope sheets. */
export const SHEETS_TOTAL = 342
const THRESHOLDS = [5, 10, 15, 20, 25]

async function presentTables(client: pg.PoolClient): Promise<Record<string, boolean>> {
  const names = ['lot_slope', 'lot_slope_part', 'lot_slope_sheet', 'lot_address']
  const r = await client.query<{ name: string; present: boolean }>(
    `SELECT n AS name, to_regclass('derived.' || n) IS NOT NULL AS present FROM unnest($1::text[]) AS n`, [names])
  return Object.fromEntries(r.rows.map(row => [row.name, row.present]))
}

const n = (v: unknown): number | null => (v == null ? null : Number(v))
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString())

export interface SlopeSheetLog {
  sheet: string
  epsg: number | null
  x0: number | null
  y0: number | null
  lots: number | null
  lotsMeasured: number | null
  pointOnly: number | null
  pixels: number | null
  seamPixels: number | null
  /** Where the sheet's seam was found: edge, offset range from it, blocks. */
  seamEdges: string | null
  rows: number | null
  queryS: number | null
  readS: number | null
  rasterizeS: number | null
  writeS: number | null
  seconds: number | null
  status: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

function sheetRow(r: any): SlopeSheetLog {
  return {
    sheet: r.sheet, epsg: n(r.epsg), x0: n(r.x0), y0: n(r.y0), lots: n(r.lots), lotsMeasured: n(r.lots_measured),
    pointOnly: n(r.point_only), pixels: n(r.pixels), seamPixels: n(r.seam_pixels), seamEdges: r.seam_edges ?? null, rows: n(r.rows), queryS: n(r.query_s), readS: n(r.read_s),
    rasterizeS: n(r.rasterize_s), writeS: n(r.write_s), seconds: n(r.seconds), status: r.status, error: r.error,
    startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
  }
}

export interface SlopeBuild {
  tables: Record<string, boolean>
  sheetsTotal: number
  sheets: SlopeSheetLog[]
  /** From lot_slope, once it has been built. */
  lots: { method: string; lots: number }[]
  lotsTotal: number | null
  builtAt: string | null
  partRows: number | null
}

async function buildState(client: pg.PoolClient, tables: Record<string, boolean>): Promise<SlopeBuild> {
  const sheets = tables.lot_slope_sheet
    ? (await client.query(`SELECT * FROM derived.lot_slope_sheet ORDER BY finished_at DESC NULLS LAST, sheet`)).rows.map(sheetRow)
    : []
  let lots: { method: string; lots: number }[] = []
  let builtAt: string | null = null
  if (tables.lot_slope) {
    lots = (await client.query(`SELECT method, count(*) AS lots FROM derived.lot_slope GROUP BY 1 ORDER BY 2 DESC`))
      .rows.map(r => ({ method: r.method, lots: Number(r.lots) }))
    builtAt = iso((await client.query(`SELECT built_at FROM derived.lot_slope LIMIT 1`)).rows[0]?.built_at)
  }
  // The part table's size comes from the sheet log, which records the rows each sheet wrote:
  // a count(*) over ~4 M rows on every page load is not worth it.
  const partRows = tables.lot_slope_part ? sheets.reduce((t, s) => t + (s.status === 'done' ? (s.rows ?? 0) : 0), 0) : null
  return {
    tables, sheetsTotal: SHEETS_TOTAL, sheets, lots,
    lotsTotal: lots.length ? lots.reduce((t, l) => t + l.lots, 0) : null,
    builtAt, partRows,
  }
}

// ── search ─────────────────────────────────────────────────────────────────

const ROAD_TYPES: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', DRV: 'DRIVE', PDE: 'PARADE',
  CRES: 'CRESCENT', CR: 'CRESCENT', PL: 'PLACE', HWY: 'HIGHWAY', CCT: 'CIRCUIT', CL: 'CLOSE', CT: 'COURT',
  TCE: 'TERRACE', LN: 'LANE', BVD: 'BOULEVARD', BLVD: 'BOULEVARD', GR: 'GROVE', ESP: 'ESPLANADE', WY: 'WAY',
  SQ: 'SQUARE', PKWY: 'PARKWAY', MWY: 'MOTORWAY', FWY: 'FREEWAY', CIR: 'CIRCLE', GDNS: 'GARDENS', RES: 'RESERVE', TRL: 'TRAIL',
}
const ROAD_WORDS = new Set(Object.values(ROAD_TYPES))
function selective(word: string): boolean {
  const u = word.toUpperCase()
  return u.length >= 3 && !ROAD_WORDS.has(u) && !ROAD_TYPES[u] && !/^\d+[A-Z]?$/.test(u)
}

export interface SlopeMatch { cadid: string; lotId: string | null; address: string | null; lgaName: string | null }

/**
 * A lot reference is looked up in cadastre.lot, which holds every lot whether or
 * not it has an address. An address goes through derived.lot_address (02C's
 * table, trigram-indexed on address) - the same search /testing-spatial-services
 * runs - because the slope tables carry no address of their own.
 */
async function search(client: pg.PoolClient, raw: string, tables: Record<string, boolean>): Promise<{ results: SlopeMatch[]; hint?: string }> {
  const q = raw.trim()
  if (q.length < 2) return { results: [] }
  if (/\b(?:D|S|C)P\s*\d+/i.test(q) || q.includes('//')) {
    const exact = q.toUpperCase().replace(/\s+/g, '')
    const rows = (await client.query(
      `SELECT l.cadid, l.lotidstring,
              (SELECT a.address FROM derived.lot_address a WHERE a.cadid = l.cadid AND a.address IS NOT NULL
               ORDER BY a.is_primary_address DESC NULLS LAST, a.address LIMIT 1) AS address,
              (SELECT a.lga_name FROM derived.lot_address a WHERE a.cadid = l.cadid LIMIT 1) AS lga_name
       FROM cadastre.lot l WHERE l.lotidstring = $1 LIMIT $2`,
      [exact, SEARCH_LIMIT])).rows
    return { results: rows.map(r => ({ cadid: r.cadid, lotId: r.lotidstring, address: r.address, lgaName: r.lga_name })) }
  }
  if (!tables.lot_address) return { results: [], hint: 'Address search needs derived.lot_address (02C). Search by lot reference instead, e.g. 1//DP207788.' }
  const words = q.split(/\s+/).filter(Boolean).map(w => ROAD_TYPES[w.toUpperCase()] ?? w)
  if (!words.some(selective)) {
    return { results: [], hint: 'Type part of the street or suburb name as well - a number or a road type alone matches too much to search.' }
  }
  const params: string[] = words.map(w => `%${w}%`)
  params.push(String(SEARCH_LIMIT))
  // Slope belongs to the lot, so a strata building's hundred unit addresses collapse to one row:
  // the lot, shown with its primary address, else the first that matched.
  const rows = (await client.query(
    `WITH hits AS (
       SELECT DISTINCT ON (cadid) cadid, lot_id, address, lga_name
       FROM derived.lot_address
       WHERE ${words.map((_, i) => `address ILIKE $${i + 1}`).join(' AND ')}
       ORDER BY cadid, is_primary_address DESC NULLS LAST, unit_number NULLS FIRST, address)
     SELECT * FROM hits ORDER BY address LIMIT $${params.length}`, params)).rows
  return { results: rows.map(r => ({ cadid: r.cadid, lotId: r.lot_id, address: r.address, lgaName: r.lga_name })) }
}

// ── one lot ────────────────────────────────────────────────────────────────

export interface SlopePart {
  sheet: string
  n: number
  sumDeg: number | null
  sumSqDeg: number | null
  minDeg: number | null
  maxDeg: number | null
  sumPct: number | null
  sumSqPct: number | null
  over: Record<string, number | null>
  pointDeg: number | null
  /** Pixel centres inside the lot on the sheet-edge seam, left out. */
  nSeam: number | null
  /** The sheet's own log row: the timings are the sheet's, shared by every lot on it. */
  log: SlopeSheetLog | null
}

export interface SlopeDetail {
  cadid: string
  lot: Record<string, unknown> | null
  slope: Record<string, unknown> | null
  parts: SlopePart[]
  address: string | null
  lotGeom: Record<string, unknown> | null
  neighbours: Record<string, unknown>[]
  /** The half-degree squares of the sheets that measured the lot, as GeoJSON in lon/lat. */
  squares: { sheet: string; x0: number; y0: number }[]
  profile: Record<string, unknown> | null
}

async function detail(client: pg.PoolClient, cadid: string): Promise<SlopeDetail> {
  const tables = await presentTables(client)
  const lot = (await client.query(
    `SELECT cadid, lotidstring, classsubtype, hasstratum, planlotarea, urbanity,
            round(ST_Area(geom::geography)::numeric, 1) AS area_m2,
            ST_NumGeometries(geom) AS parts,
            round(ST_X(ST_PointOnSurface(geom))::numeric, 6) AS lon, round(ST_Y(ST_PointOnSurface(geom))::numeric, 6) AS lat
     FROM cadastre.lot WHERE cadid = $1`, [cadid])).rows[0] ?? null

  const slope = tables.lot_slope
    ? (await client.query(`SELECT * FROM derived.lot_slope WHERE cadid = $1`, [cadid])).rows[0] ?? null
    : null

  const parts: SlopePart[] = tables.lot_slope_part
    ? (await client.query(
        `SELECT p.*, to_jsonb(s.*) AS log
         FROM derived.lot_slope_part p
         LEFT JOIN derived.lot_slope_sheet s ON s.sheet = p.sheet
         WHERE p.cadid = $1 ORDER BY p.n DESC, p.sheet`, [cadid])).rows.map(r => ({
        sheet: r.sheet, n: Number(r.n), sumDeg: n(r.sum_deg), sumSqDeg: n(r.sum_sq_deg), minDeg: n(r.min_deg),
        maxDeg: n(r.max_deg), sumPct: n(r.sum_pct), sumSqPct: n(r.sum_sq_pct),
        over: Object.fromEntries(THRESHOLDS.map(t => [String(t), n(r[`n_over_${t}`])])),
        pointDeg: n(r.point_deg), nSeam: n(r.n_seam), log: r.log ? sheetRow(r.log) : null,
      }))
    : []

  const address = tables.lot_address
    ? (await client.query<{ address: string }>(
        `SELECT address FROM derived.lot_address WHERE cadid = $1 AND address IS NOT NULL
         ORDER BY is_primary_address DESC NULLS LAST, address LIMIT 1`, [cadid])).rows[0]?.address ?? null
    : null

  // The same simplified shapes /testing-spatial-services and the /datasources traces draw.
  const SHAPE = (col: string) => `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${col}, sqrt(ST_Area(${col})) / 400), 7)`
  const lotGeom = JSON.parse((await client.query<{ g: string | null }>(
    `SELECT ${SHAPE('geom')} AS g FROM cadastre.lot WHERE cadid = $1`, [cadid])).rows[0]?.g ?? 'null')
  const neighbours = lotGeom
    ? (await client.query<{ g: string }>(
        `WITH site AS (SELECT geom, ST_Envelope(geom) AS box FROM cadastre.lot WHERE cadid = $1)
         SELECT ${SHAPE('l.geom')} AS g FROM cadastre.lot l, site
         WHERE l.geom && ST_Expand(site.box, greatest(ST_XMax(site.box) - ST_XMin(site.box), ST_YMax(site.box) - ST_YMin(site.box)) * 0.8)
           AND l.cadid <> $1
         LIMIT 80`, [cadid])).rows.map(r => JSON.parse(r.g))
    : []

  // What the frontage build knows about the same lot, to show the cadid join works.
  let profile: Record<string, unknown> | null = null
  if ((await client.query(`SELECT to_regclass('derived.lot_frontage') IS NOT NULL AS t`)).rows[0]?.t) {
    profile = (await client.query(
      `SELECT lot_id, area_sqm, primary_frontage_road, primary_frontage_length_m, lot_depth_m, is_battleaxe, lga_name
       FROM derived.lot_frontage WHERE cadid = $1`, [cadid])).rows[0] ?? null
  }

  return {
    cadid, lot, slope, parts, address, lotGeom, neighbours, profile,
    squares: parts.filter(p => p.log?.x0 != null).map(p => ({ sheet: p.sheet, x0: p.log!.x0!, y0: p.log!.y0! })),
  }
}

// ── samples ────────────────────────────────────────────────────────────────

const SAMPLE_CASES: { key: string; group: string; title: string; blurb: string; where: string }[] = [
  { key: 'flat', group: 'Terrain', title: 'Flat house lot', blurb: 'Mean under 1°, fully covered. The easy case.',
    where: "s.method = 'pixels' AND s.mean_slope_deg < 1 AND s.lot_area_m2 BETWEEN 400 AND 1000 AND s.coverage BETWEEN 0.9 AND 1.1" },
  { key: 'moderate', group: 'Terrain', title: 'Moderately sloping house lot', blurb: 'Mean 10-15 %: the range where slope starts to change what can be built.',
    where: "s.method = 'pixels' AND s.mean_slope_pct BETWEEN 10 AND 15 AND s.lot_area_m2 BETWEEN 400 AND 1000" },
  { key: 'steep', group: 'Terrain', title: 'Steep house lot', blurb: 'More than half the lot is over 25 %.',
    where: "s.method = 'pixels' AND s.share_over_25pct > 0.5 AND s.lot_area_m2 BETWEEN 400 AND 1200" },
  { key: 'mixed', group: 'Terrain', title: 'Flat lot with a steep part', blurb: 'The mean says gentle, the max and the steep share say otherwise.',
    where: "s.method = 'pixels' AND s.mean_slope_pct < 8 AND s.share_over_25pct BETWEEN 0.1 AND 0.3 AND s.pixel_count > 40" },
  { key: 'several_sheets', group: 'How it was measured', title: 'Lot on two or more sheets', blurb: 'Summed over every sheet it touches, each counting only its own square.',
    where: "s.sheets LIKE '%,%' AND s.lot_area_m2 < 5000" },
  { key: 'big_rural', group: 'How it was measured', title: 'Large rural lot across sheets', blurb: 'Thousands of hectares, pixels from several sheets.',
    where: "s.sheets LIKE '%,%' AND s.lot_area_m2 > 10000000" },
  { key: 'point', group: 'How it was measured', title: 'Too small for a pixel', blurb: 'method = point: no 5 m pixel centre inside, so the pixel under the lot is used.',
    where: "s.method = 'point'" },
  { key: 'no_data', group: 'How it was measured', title: 'No slope at all', blurb: 'method = no_data: outside every sheet, or on nodata.',
    where: "s.method = 'no_data'" },
  { key: 'seam', group: 'Worth a look', title: 'On a sheet-edge seam', blurb: 'Pixels on the join between two sheets were left out: the grids read near-vertical there whatever the ground does.',
    where: "s.method = 'pixels' AND s.seam_pixels > 5 AND s.lot_area_m2 BETWEEN 400 AND 3000" },
  { key: 'low_coverage', group: 'Worth a look', title: 'Low coverage', blurb: 'Pixels cover under 60 % of a lot big enough to hold many: nodata inside, or a thin shape.',
    where: "s.method = 'pixels' AND s.coverage < 0.6 AND s.lot_area_m2 > 2000" },
  { key: 'stratum', group: 'Worth a look', title: 'Stratum lot', blurb: 'classsubtype 4, measured in the second pass over the ground lot below it.',
    where: "l.classsubtype = 4 AND s.method = 'pixels'" },
  { key: 'strata_site', group: 'Worth a look', title: 'Strata site', blurb: 'classsubtype 3: the whole scheme\'s land, shared by every unit.',
    where: "l.classsubtype = 3 AND s.method = 'pixels' AND s.lot_area_m2 > 1500" },
]

export interface SlopeSample { key: string; group: string; title: string; blurb: string; cadid: string | null; lotId: string | null; meanPct: number | null }

let sampleCache: { at: number; key: string; rows: SlopeSample[] } | null = null

async function samples(client: pg.PoolClient, tables: Record<string, boolean>): Promise<SlopeSample[]> {
  if (!tables.lot_slope) return []
  const key = String((await client.query(`SELECT max(built_at) AS b FROM (SELECT built_at FROM derived.lot_slope LIMIT 1) x`)).rows[0]?.b)
  if (sampleCache && sampleCache.key === key && Date.now() - sampleCache.at < SAMPLE_TTL_MS) return sampleCache.rows
  const out: SlopeSample[] = []
  for (const c of SAMPLE_CASES) {
    // One query per case, each stopping at its first hit: a UNION of full scans would
    // read 3.4 M rows eleven times before returning anything.
    const r = (await client.query(
      `SELECT s.cadid, s.lot_id, s.mean_slope_pct FROM derived.lot_slope s JOIN cadastre.lot l USING (cadid)
       WHERE ${c.where} LIMIT 1`)).rows[0]
    out.push({ key: c.key, group: c.group, title: c.title, blurb: c.blurb, cadid: r?.cadid ?? null, lotId: r?.lot_id ?? null, meanPct: n(r?.mean_slope_pct) })
  }
  sampleCache = { at: Date.now(), key, rows: out }
  return out
}

export default defineEventHandler(async (event) => {
  const { q, cadid, samples: wantSamples } = getQuery(event) as { q?: string; cadid?: string; samples?: string }
  return withNswClient(async (client) => {
    await client.query(`SET statement_timeout = '60s'`)
    const tables = await presentTables(client)
    if (wantSamples) return { samples: await samples(client, tables) }
    if (cadid) return detail(client, String(cadid))
    if (q) return search(client, String(q), tables)
    return { build: await buildState(client, tables) }
  })
})
