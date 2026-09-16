/**
 * The lot profile data dump: what "02C - Lot profile with frontage" has written
 * into the `derived` schema so far, for one address or one lot.
 *
 *   /api/lotprofile                          → what is built, and how far
 *   /api/lotprofile?q=26 Foveaux St          → matching addresses
 *   /api/lotprofile?q=A//DP71490             → matching lots
 *   /api/lotprofile?cadid=101143132          → every derived row for that lot
 *
 * WHY THIS READS THE BASE TABLES AND NOT derived.lot_profile
 *
 * 02C writes three tables. `lot_address` and `lot_frontage` are built a tile at
 * a time with CREATE TABLE IF NOT EXISTS, so they are always there and always
 * growing. `lot_profile` is the wide join of the two and is DROPped and
 * recreated at the end of every run, so a page that reads it goes blank for as
 * long as phase 3 takes. Reading `lot_address` + `lot_frontage` + the runs
 * gives exactly the same columns as `lot_profile` and never disappears
 * mid-build, so that is what this does.
 *
 * WHY EVERY TABLE IS PROBED BEFORE IT IS READ
 *
 * A build in progress has some of these tables and not others - phase 1 creates
 * lot_address, phase 2 creates lot_frontage and lot_frontage_run - and querying
 * a table Postgres has never heard of is an error, not an empty result. So each
 * one is resolved with to_regclass first and the payload says which were there.
 * The page shows the address half on its own while the frontage half is still
 * being computed.
 *
 * SEARCH
 *
 * derived.lot_address carries a denormalised `address`, and its indexes are on
 * the keys (cadid, lot_id, msoid, propid) rather than the text, so the text
 * search is a scan: about 100 ms over the ~190k rows built so far. That is fine
 * at the current scope of three councils. If this build is ever taken
 * state-wide, add a trigram index on `address` (pg_trgm is already installed)
 * before this endpoint is pointed at it.
 */

import type pg from 'pg'
import { withNswClient } from '../utils/nsw-kg/pool'

const SEARCH_LIMIT = 25
const ADDRESSES_PER_LOT = 400
/** Finding one lot per case is ~20 scans of lot_frontage, so it is held for a while. */
const SAMPLE_TTL_MS = 5 * 60 * 1000

/**
 * One real lot for each case worth eyeballing, found in the data rather than
 * written down, so the list stays true as the build grows past three councils.
 *
 * `where` filters derived.lot_frontage (aliased f). `addressWhere` filters the
 * address picked to open the lot with, unaliased, and makes an address
 * mandatory - the strata cases use it to land on a unit rather than on the
 * scheme. Cases without it still resolve when the lot has no address at all,
 * which is the point of `shortest_no_address`.
 */
const SAMPLE_CASES: { key: string; group: string; title: string; blurb: string; where: string; addressWhere?: string; needs?: string }[] = [
  // ── What kind of lot it is ────────────────────────────────────────────────
  { key: 'ordinary', group: 'Lot kinds', title: 'Ordinary house lot', blurb: 'One street frontage, both methods agree. The plain case everything else is measured against.',
    where: "f.classsubtype = 1 AND f.primary_frontage_basis = 'address' AND f.frontage_agreement = 'agree' AND f.is_corner_lot IS NOT TRUE AND f.is_through_lot IS NOT TRUE AND f.is_battleaxe IS NOT TRUE AND f.frontage_count = 1" },
  { key: 'strata_unit', group: 'Lot kinds', title: 'Strata unit', blurb: 'Opens on a unit. Its title_lot is its own; the polygon and every frontage figure belong to the whole site.',
    where: "f.classsubtype = 3 AND f.unit_address_count > 10", addressWhere: 'propidtype = 2' },
  { key: 'strata_common', group: 'Lot kinds', title: 'Common property', blurb: 'The scheme’s own address, propidtype 3, sitting on the same polygon as all its units.',
    where: "f.classsubtype = 3 AND f.unit_address_count > 10", addressWhere: 'propidtype = 3' },
  { key: 'stratum', group: 'Lot kinds', title: 'Stratum lot', blurb: 'A lot defined by height, classsubtype 4, stacked over another lot.',
    where: 'f.classsubtype = 4' },
  { key: 'partlot', group: 'Lot kinds', title: 'Part lot', blurb: 'classsubtype 2. Often has no address of its own.',
    where: 'f.classsubtype = 2' },
  { key: 'superlot', group: 'Lot kinds', title: 'Superlot', blurb: 'The Valuer General treats several parcels as one property.',
    where: 'f.is_superlot' },
  { key: 'multipart', group: 'Lot kinds', title: 'Multipart lot', blurb: 'whole_lot_analysed is false: the engine measured one ring of several, so the figures cover part of the lot.',
    where: 'f.whole_lot_analysed = false' },

  // ── What shape it is ──────────────────────────────────────────────────────
  { key: 'battleaxe', group: 'Shape', title: 'Battle-axe', blurb: 'A straight handle. Check stem_width_m and handle_length_m against the sketch.',
    where: "f.is_battleaxe AND f.handle_shape = 'straight' AND f.stem_width_m IS NOT NULL" },
  { key: 'battleaxe_irr', group: 'Shape', title: 'Battle-axe, irregular handle', blurb: 'The handle is not a clean rectangle, so the neck measurements matter more than the stem.',
    where: "f.is_battleaxe AND f.handle_shape = 'irregular'" },
  { key: 'corner', group: 'Shape', title: 'Corner lot', blurb: 'Two streets meeting. corner_streets names them.',
    where: 'f.is_corner_lot AND f.is_through_lot IS NOT TRUE' },
  { key: 'through', group: 'Shape', title: 'Through lot', blurb: 'Street at the front and the back, so depth is measured between two frontages.',
    where: 'f.is_through_lot AND f.is_corner_lot IS NOT TRUE' },
  { key: 'corner_through', group: 'Shape', title: 'Corner and through', blurb: 'Both at once. The primary frontage choice is doing real work here.',
    where: 'f.is_corner_lot AND f.is_through_lot' },

  // ── How the primary frontage was chosen ───────────────────────────────────
  { key: 'basis_only_street', group: 'How the frontage was picked', title: 'Only one street frontage', blurb: 'basis = only_street_frontage: no choice to make.',
    where: "f.primary_frontage_basis = 'only_street_frontage'" },
  { key: 'basis_shortest', group: 'How the frontage was picked', title: 'Fell back to shortest', blurb: 'basis = shortest: the address road did not match any run, so the shortest won. Worth checking the road names.',
    where: "f.primary_frontage_basis = 'shortest'" },
  { key: 'basis_no_address', group: 'How the frontage was picked', title: 'No address to match', blurb: 'basis = shortest_no_address: the lot has no address, so nothing could be matched.',
    where: "f.primary_frontage_basis = 'shortest_no_address'" },
  // Phase 2b of 02C rewrites the basis on lots it has repaired. These stay
  // empty until that phase has run over the build.
  { key: 'basis_access_point', group: 'How the frontage was picked', title: 'Repaired from the access point', blurb: 'basis = access_point: no run was named after the address road, so the GURAS way point found the real frontage and renamed it.',
    where: "f.primary_frontage_basis = 'access_point'" },
  { key: 'basis_access_road', group: 'How the frontage was picked', title: 'Access road differs from address', blurb: 'basis = access_road: the way point sits on a different street from the address, and a run matches it.',
    where: "f.primary_frontage_basis = 'access_road'" },
  { key: 'basis_changed', group: 'How the frontage was picked', title: 'Changed by the access pass', blurb: 'The repaired answer differs from what the engine produced. engine_primary_frontage_* holds the original.',
    where: "f.engine_primary_frontage_road IS NOT NULL AND (f.primary_frontage_road IS DISTINCT FROM f.engine_primary_frontage_road OR f.primary_frontage_length_m IS DISTINCT FROM f.engine_primary_frontage_length_m)",
    needs: 'engine_primary_frontage_road' },   // two-pass builds only; hidden otherwise

  // ── Where the two measurements part company ───────────────────────────────
  { key: 'differ', group: 'Where the two methods disagree', title: 'Methods disagree', blurb: 'The topological frontage and the road-parcel frontage give different lengths.',
    where: "f.frontage_agreement = 'differ'" },
  { key: 'topo_only', group: 'Where the two methods disagree', title: 'Topological only', blurb: 'Open boundary found, but no road parcel abuts it.',
    where: "f.frontage_agreement = 'topological_only'" },
  { key: 'parcel_only', group: 'Where the two methods disagree', title: 'Road parcel only', blurb: 'A road parcel abuts, but the topological pass found no open boundary.',
    where: "f.frontage_agreement = 'road_parcel_only'" },
  { key: 'no_frontage', group: 'Where the two methods disagree', title: 'No frontage at all', blurb: 'status = no_unshared_boundary: every boundary is shared, so the lot is landlocked as drawn.',
    where: "f.status = 'no_unshared_boundary'" },
  { key: 'motorway', group: 'Where the two methods disagree', title: 'Abuts a motorway', blurb: 'abuts_motorway is set. A motorway edge is not a frontage anyone can use.',
    where: 'f.abuts_motorway IS NOT NULL' },
]

export interface LotProfileSample {
  key: string
  group: string
  title: string
  blurb: string
  cadid: string | null
  lotId: string | null
  msoid: number | null
  address: string | null
  lgaName: string | null
  basis: string | null
  agreement: string | null
  totalFrontageM: number | null
}

/**
 * Cached with a fingerprint of the build, not just a clock. 02C drops and
 * rebuilds these tables, and a cached sample points at a cadid that may no
 * longer exist; keying on the row count means a rebuild busts the cache
 * immediately rather than serving dead lots for up to five minutes.
 */
let sampleCache: { at: number; key: string; rows: LotProfileSample[] } | null = null

/**
 * One lot per case, in one round trip.
 *
 * Ordered by md5(cadid || key) rather than by cadid so the cases do not all
 * land on the same low-numbered lot - several predicates overlap, and ordering
 * by the key alone returned the same lot for four of them. The hash is stable,
 * so a case keeps its example between reloads.
 */
async function samples(client: pg.PoolClient, tables: Record<string, boolean>): Promise<LotProfileSample[]> {
  if (!tables.lot_frontage || !tables.lot_address) return []
  const key = String((await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM derived.lot_frontage')).rows[0]!.n)
  if (sampleCache && sampleCache.key === key && Date.now() - sampleCache.at < SAMPLE_TTL_MS) {
    return sampleCache.rows
  }

  // A case can name a column that only exists after 02C's access pass has run.
  // Querying a column Postgres has never heard of is an error, not an empty
  // result, so those cases are dropped until the column appears.
  const cols = new Set((await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'derived' AND table_name = 'lot_frontage'`,
  )).rows.map(r => r.column_name))
  const usable = SAMPLE_CASES.filter(c => !c.needs || cols.has(c.needs))

  const branches = usable.map(c => `(
    SELECT '${c.key}'::text AS case_key, f.cadid, f.lot_id, f.lga_name,
           f.primary_frontage_basis, f.frontage_agreement, f.total_frontage_m,
           a.msoid, a.address
    FROM derived.lot_frontage f
    LEFT JOIN LATERAL (
      SELECT msoid, address FROM derived.lot_address
      WHERE cadid = f.cadid AND address IS NOT NULL${c.addressWhere ? ` AND ${c.addressWhere}` : ''}
      ORDER BY is_primary_address DESC NULLS LAST, address LIMIT 1) a ON true
    WHERE ${c.where}${c.addressWhere ? ' AND a.msoid IS NOT NULL' : ''}
    ORDER BY md5(f.cadid || '${c.key}') LIMIT 1)`)

  const r = await client.query(branches.join(' UNION ALL '))
  const found = new Map(r.rows.map(row => [row.case_key as string, row]))
  const rows = usable.map((c) => {
    const hit = found.get(c.key)
    return {
      key: c.key, group: c.group, title: c.title, blurb: c.blurb,
      cadid: hit?.cadid ?? null,
      lotId: hit?.lot_id ?? null,
      msoid: hit?.msoid ?? null,
      address: hit?.address ?? null,
      lgaName: hit?.lga_name ?? null,
      basis: hit?.primary_frontage_basis ?? null,
      agreement: hit?.frontage_agreement ?? null,
      totalFrontageM: hit?.total_frontage_m ?? null,
    }
  })
  sampleCache = { at: Date.now(), key, rows }
  return rows
}

export interface LotProfileMatch {
  cadid: string
  lotId: string | null
  msoid: number | null
  address: string | null
  suburb: string | null
  lgaName: string | null
  isPrimary: boolean | null
}

export interface LotProfileBuild {
  scope: string[]
  phases: { phase: string; tiles: number; lots: number; rows: number; lastFinished: string | null }[]
  tables: Record<string, boolean>
  lotAddressRows: number | null
  lotFrontageRows: number | null
  /** Whether 02C's phase 2b has run: its columns exist only once it has. */
  accessPassRun: boolean
}

export interface LotProfileResult {
  build: LotProfileBuild
  lot: Record<string, unknown> | null
  runs: Record<string, unknown>[]
  addresses: Record<string, unknown>[]
  shape: { ring: [number, number][]; runs: { seq: number; road: string | null; isPrimary: boolean; lengthM: number | null; edges: number[]; line: [number, number][] }[] } | null
  points: { msoid: number | null; address: string | null; lon: number; lat: number }[]
  access: {
    wayLon: number; wayLat: number; proway: [number, number][]
    accessM: number | null; sharedBy: number; wayRoad: string | null; wayRoadM: number | null
  }[]
  /** The whole lot from cadastre.lot and the parcels around it, for the map. */
  lotGeom: Record<string, unknown> | null
  neighbours: Record<string, unknown>[]
}

/** Which of the derived tables exist right now. Re-probed per request: a build creates them as it goes. */
async function presentTables(client: pg.PoolClient): Promise<Record<string, boolean>> {
  const names = ['lot_address', 'lot_frontage', 'lot_frontage_run', 'lot_profile', 'build_log', 'build_scope']
  const r = await client.query<{ name: string; present: boolean }>(
    `SELECT n AS name, to_regclass('derived.' || n) IS NOT NULL AS present FROM unnest($1::text[]) AS n`,
    [names],
  )
  return Object.fromEntries(r.rows.map(row => [row.name, row.present]))
}

async function buildState(client: pg.PoolClient, tables: Record<string, boolean>): Promise<LotProfileBuild> {
  const scope = tables.build_scope
    ? (await client.query<{ name: string }>(`SELECT name FROM derived.build_scope ORDER BY name`)).rows.map(r => r.name)
    : []

  const phases = tables.build_log
    ? (await client.query<{ phase: string; tiles: string; lots: string; rows: string; last_finished: Date | null }>(
        `SELECT phase, count(*) AS tiles, coalesce(sum(lots), 0) AS lots,
                coalesce(sum(rows), 0) AS rows, max(finished_at) AS last_finished
         FROM derived.build_log GROUP BY phase ORDER BY phase`,
      )).rows.map(r => ({
        phase: r.phase,
        tiles: Number(r.tiles),
        lots: Number(r.lots),
        rows: Number(r.rows),
        lastFinished: r.last_finished ? r.last_finished.toISOString() : null,
      }))
    : []

  const countOf = async (t: string) => tables[t]
    ? Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM derived."${t}"`)).rows[0]!.n)
    : null

  // Whether this build chose frontages with the access evidence. 02C now does it
  // in the same pass that measures the lot and records the way point's road in
  // lot_frontage.waypoint_road; an older two-pass build marked it with
  // engine_primary_frontage_road instead. Either column means the figures above
  // were chosen with the way point in hand.
  const accessPassRun = tables.lot_frontage && Number((await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.columns
     WHERE table_schema = 'derived' AND table_name = 'lot_frontage'
       AND column_name IN ('waypoint_road', 'engine_primary_frontage_road')`,
  )).rows[0]!.n) > 0

  return {
    scope,
    phases,
    tables,
    lotAddressRows: await countOf('lot_address'),
    lotFrontageRows: await countOf('lot_frontage'),
    accessPassRun: !!accessPassRun,
  }
}

/**
 * Street types, abbreviation to the way GURAS spells it.
 *
 * Without this "22 Eglinton Rd" finds nothing, because the stored address is
 * "22 EGLINTON ROAD GLEBE" and "RD" is not a substring of "ROAD". Every word
 * typed has to appear, so one abbreviated type is enough to empty the result.
 * The same map is in nsw-address.get.ts for the same reason.
 */
const ROAD_TYPES: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', DRV: 'DRIVE',
  PDE: 'PARADE', CRES: 'CRESCENT', CR: 'CRESCENT', PL: 'PLACE', HWY: 'HIGHWAY',
  CCT: 'CIRCUIT', CL: 'CLOSE', CT: 'COURT', TCE: 'TERRACE', LN: 'LANE',
  BVD: 'BOULEVARD', BLVD: 'BOULEVARD', GR: 'GROVE', ESP: 'ESPLANADE', WY: 'WAY',
  SQ: 'SQUARE', PKWY: 'PARKWAY', MWY: 'MOTORWAY', FWY: 'FREEWAY', CIR: 'CIRCLE',
  GDNS: 'GARDENS', RES: 'RESERVE', TRL: 'TRAIL',
}

/**
 * Every word typed has to appear in the address, so "26 foveaux surry" narrows
 * the way someone expects. A word that is an abbreviated street type matches
 * either spelling. A lot reference is recognised by its plan label and matched
 * on lot_id instead.
 */
async function search(client: pg.PoolClient, raw: string, tables: Record<string, boolean>): Promise<LotProfileMatch[]> {
  if (!tables.lot_address) return []
  const q = raw.trim()
  if (q.length < 2) return []

  const looksLikeLot = /\b(?:D|S|C)P\s*\d+/i.test(q) || q.includes('//')
  const rows = looksLikeLot
    ? (await client.query(
        `SELECT DISTINCT ON (cadid) cadid, lot_id, msoid, address, suburb, lga_name, is_primary_address
         FROM derived.lot_address
         WHERE replace(upper(lot_id), ' ', '') LIKE '%' || replace(upper($1), ' ', '') || '%'
         ORDER BY cadid, is_primary_address DESC NULLS LAST, address
         LIMIT $2`,
        [q, SEARCH_LIMIT],
      )).rows
    : await (async () => {
        // One clause per word; a street type matches abbreviated or spelled out.
        const words = q.split(/\s+/).filter(Boolean)
        const params: string[] = []
        const clauses = words.map((w) => {
          const full = ROAD_TYPES[w.toUpperCase()]
          params.push(`%${w}%`)
          if (!full) return `address ILIKE $${params.length}`
          params.push(`%${full}%`)
          return `(address ILIKE $${params.length - 1} OR address ILIKE $${params.length})`
        })
        params.push(String(SEARCH_LIMIT))
        return (await client.query(
          `SELECT cadid, lot_id, msoid, address, suburb, lga_name, is_primary_address
           FROM derived.lot_address
           WHERE ${clauses.join(' AND ')}
           ORDER BY is_primary_address DESC NULLS LAST, address
           LIMIT $${params.length}`,
          params,
        )).rows
      })()

  return rows.map(r => ({
    cadid: r.cadid,
    lotId: r.lot_id,
    msoid: r.msoid,
    address: r.address,
    suburb: r.suburb,
    lgaName: r.lga_name,
    isPrimary: r.is_primary_address,
  }))
}

/**
 * Strip the columns the page draws from rather than reads: the geometries
 * themselves, and the lon/lat this endpoint projects out of them, which would
 * otherwise sit in the field dump beside the point_lon/point_lat the build
 * already stores.
 */
function withoutGeometry(row: Record<string, unknown>): Record<string, unknown> {
  const { geom, point_geom, lot_geom, address_geom, point_geom_lon, point_geom_lat, ...rest } = row
  return rest
}

async function detail(client: pg.PoolClient, cadid: string): Promise<LotProfileResult> {
  const tables = await presentTables(client)
  const build = await buildState(client, tables)

  const addresses = tables.lot_address
    ? (await client.query(
        `SELECT *, ST_X(point_geom) AS point_geom_lon, ST_Y(point_geom) AS point_geom_lat
         FROM derived.lot_address WHERE cadid = $1
         ORDER BY is_primary_address DESC NULLS LAST, unit_number NULLS FIRST, address
         LIMIT $2`,
        [cadid, ADDRESSES_PER_LOT],
      )).rows
    : []

  const lot = tables.lot_frontage
    ? (await client.query(
        `SELECT *, ST_AsGeoJSON(geom, 7) AS geom_json FROM derived.lot_frontage WHERE cadid = $1`,
        [cadid],
      )).rows[0] ?? null
    : null

  const runs = tables.lot_frontage_run
    ? (await client.query(
        `SELECT *, ST_AsGeoJSON(geom, 7) AS geom_json FROM derived.lot_frontage_run
         WHERE cadid = $1 ORDER BY seq`,
        [cadid],
      )).rows
    : []

  // The ring the engine analysed, plus each frontage run, for the shape preview.
  let shape: LotProfileResult['shape'] = null
  const ringJson = lot?.geom_json ? JSON.parse(lot.geom_json as string) : null
  if (ringJson?.type === 'Polygon' && ringJson.coordinates?.[0]?.length > 2) {
    shape = {
      ring: ringJson.coordinates[0] as [number, number][],
      runs: runs.flatMap((r) => {
        const g = r.geom_json ? JSON.parse(r.geom_json as string) : null
        if (!g || g.type !== 'LineString') return []
        return [{
          seq: r.seq as number,
          road: r.road_name as string | null,
          isPrimary: !!r.is_primary,
          lengthM: r.length_m == null ? null : Number(r.length_m),
          edges: (r.edge_indexes as number[] | null) ?? [],
          line: g.coordinates as [number, number][],
        }]
      }),
    }
  }

  /*
   * The same picture the /datasources traces draw: the whole lot from
   * cadastre.lot (lot_frontage.geom is only the ring the engine analysed) and
   * the parcels around it, simplified the same way so the two pages agree.
   */
  const SHAPE = (col: string) => `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${col}, sqrt(ST_Area(${col})) / 400), 7)`
  const lotGeom = JSON.parse((await client.query<{ g: string | null }>(
    `SELECT ${SHAPE('geom')} AS g FROM cadastre.lot WHERE cadid = $1`, [cadid],
  )).rows[0]?.g ?? 'null')
  const neighbours = (await client.query<{ g: string }>(
    `WITH site AS (SELECT geom, ST_Envelope(geom) AS box FROM cadastre.lot WHERE cadid = $1)
     SELECT ${SHAPE('l.geom')} AS g
     FROM cadastre.lot l, site
     WHERE l.geom && ST_Expand(site.box, greatest(ST_XMax(site.box) - ST_XMin(site.box), ST_YMax(site.box) - ST_YMin(site.box)) * 0.8)
       AND l.cadid <> $1
     LIMIT 80`,
    [cadid],
  )).rows.map(r => JSON.parse(r.g))

  const points = addresses
    .filter(a => a.point_geom_lon != null && a.point_geom_lat != null)
    .map(a => ({ msoid: a.msoid, address: a.address, lon: Number(a.point_geom_lon), lat: Number(a.point_geom_lat) }))

  /*
   * The GURAS access chain, the evidence phase 2b reasons from: address point
   * -> access line (proway) -> way point on the road that serves the address.
   * Keyed through the address point, never the address string - lot_address.msoid
   * is an addressstring id, and guras.waypoint.msoid is a different id space
   * entirely, so joining them directly lands on a lot in another suburb.
   *
   * Distinct on the geometry: a block of units shares one entrance, so 53
   * addresses collapse to a single access line rather than 53 identical ones.
   */
  const access = tables.lot_address
    ? (await client.query(
        `SELECT DISTINCT ON (w.geom, p.geom)
                ST_X(ST_GeometryN(w.geom, 1)) AS way_lon,
                ST_Y(ST_GeometryN(w.geom, 1)) AS way_lat,
                ST_AsGeoJSON(ST_GeometryN(p.geom, 1), 7) AS proway_json,
                round(ST_Length(p.geom::geography)::numeric, 1) AS access_m,
                count(*) OVER (PARTITION BY w.geom, p.geom) AS shared_by,
                rn.roadnamelabel AS way_road,
                round(ST_Distance(ST_GeometryN(w.geom, 1)::geography, rn.geom::geography)::numeric, 2) AS way_road_m
         FROM derived.lot_address a
         JOIN guras.addresspoint ap ON ap.addressstringoid = a.msoid
         JOIN guras.proway p        ON p.addresspointoid = ap.msoid
         JOIN guras.waypoint w      ON w.msoid = p.waypointoid
         LEFT JOIN LATERAL (
           SELECT roadnamelabel, geom FROM cadastre.roadcentreline
           WHERE roadnamelabel IS NOT NULL
             AND geom && ST_Expand(ST_GeometryN(w.geom, 1), 0.0006)
           ORDER BY geom <-> ST_GeometryN(w.geom, 1) LIMIT 1) rn ON true
         WHERE a.cadid = $1`,
        [cadid],
      )).rows.map(r => ({
        wayLon: Number(r.way_lon),
        wayLat: Number(r.way_lat),
        proway: r.proway_json ? (JSON.parse(r.proway_json).coordinates as [number, number][]) : [],
        accessM: r.access_m == null ? null : Number(r.access_m),
        sharedBy: Number(r.shared_by),
        wayRoad: r.way_road as string | null,
        wayRoadM: r.way_road_m == null ? null : Number(r.way_road_m),
      }))
    : []

  return {
    build,
    lot: lot ? withoutGeometry({ ...lot, geom_json: undefined }) : null,
    runs: runs.map(r => withoutGeometry({ ...r, geom_json: undefined })),
    addresses: addresses.map(a => withoutGeometry(a)),
    shape,
    points,
    access,
    lotGeom,
    neighbours,
  }
}

export default defineEventHandler(async (event) => {
  const { q, cadid, msoid, samples: wantSamples } = getQuery(event) as
    { q?: string; cadid?: string; msoid?: string; samples?: string }

  if (wantSamples) {
    return withNswClient(async (client) => {
      const tables = await presentTables(client)
      return { samples: await samples(client, tables) }
    })
  }

  if (cadid) return withNswClient(client => detail(client, String(cadid)))

  if (msoid) {
    return withNswClient(async (client) => {
      const tables = await presentTables(client)
      if (!tables.lot_address) return { build: await buildState(client, tables), lot: null, runs: [], addresses: [], shape: null, points: [], access: [], lotGeom: null, neighbours: [] }
      const r = await client.query<{ cadid: string }>(
        `SELECT cadid FROM derived.lot_address WHERE msoid = $1 LIMIT 1`, [Number(msoid)],
      )
      const hit = r.rows[0]
      if (!hit) return { build: await buildState(client, tables), lot: null, runs: [], addresses: [], shape: null, points: [], access: [], lotGeom: null, neighbours: [] }
      return detail(client, hit.cadid)
    })
  }

  return withNswClient(async (client) => {
    const tables = await presentTables(client)
    const build = await buildState(client, tables)
    if (!q) return { build, results: [] as LotProfileMatch[] }
    return { build, results: await search(client, String(q), tables) }
  })
})
