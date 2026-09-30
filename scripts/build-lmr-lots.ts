/**
 * Build the LMR layer: every lot Chapter 6 of the Housing SEPP reaches, and what it does there.
 *
 *   npx tsx scripts/build-lmr-lots.ts
 *
 * The four steps of the guide on /lmr (shared/lmr-method.ts), for every lot at once:
 *
 *   1. walk out from the stations and centres   lots touching an 800 m walking catchment
 *                                                (lmr.station_walking_catchments, lmr.town_centre_walking_catchments)
 *   2. keep the residential land                 lots with any part in R1, R2, R3 or R4 (epi.epi_land_zoning)
 *   3. take out the excluded land                every s 164(1) item in lmr.general, read from its layers
 *   4. write the band and the standards          inner / outer, and the housing forms each lot is eligible for
 *
 * The verdict is shared/lmr-evaluate.ts - the same functions /api/lmr/types runs for one lot - over the same
 * catalogue rows, so a lot's colour on the map and its "This lot" tab cannot disagree. Everything here is
 * gathering facts in bulk; nothing re-implements a rule.
 *
 * OUTPUTS (built beside the live tables and swapped in one transaction at the end)
 *
 *   lmr.lot_lmr         one row per residential lot the catchments reach: band, what it is measured from,
 *                       class ('in' | 'excluded' | 'undecided'), the s 164 clauses behind it, the housing
 *                       forms it is eligible or undecided for, and whether 05_lmr had it
 *   lmr.lmr_area        the 'in' lots dissolved by band - the outline for low zoom
 *   lmr.lot_lmr_05_only lots 05_lmr (nsw.up_property_d_4.in_lmr_housing_area) has that this build does not,
 *                       with why
 *
 * Lots are tested whole and shrunk 10 cm, as the routes do: "land that is or contains" a constraint means any
 * overlap takes the lot, and a neighbour that only touches the boundary is not a hit.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bandFrom, criteriaFromRows, CRITERIA_SQL, evaluateGeneral, evaluateType, NAME_COLUMNS,
  type GeneralHits, type LmrLotFacts, type Perm,
} from '../shared/lmr-evaluate'

const require = createRequire(import.meta.url)
const { Client } = require('pg')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function databaseUrl(): string {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='))
  if (!line) throw new Error('DATABASE_URL not in .env')
  return line.slice('DATABASE_URL='.length).trim()
}

/** Skip steps 1-4 and publish from the work tables a failed run left behind (lmr._lmr_cand*, lmr._lmr_result). */
const PUBLISH_ONLY = process.argv.includes('--publish-only')
/** Layers too heavy to intersect whole: cut into small pieces first (see step 3). */
const SUBDIVIDE = new Set(['bushfire_prone_land'])
const t0 = Date.now()
const log = (...a: any[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a)

async function main() {
  const c = new Client({ connectionString: databaseUrl(), statement_timeout: 0 })
  await c.connect()
  const q = (sql: string, v?: any[]) => c.query(sql, v)

  try {
    // planningai runs in a container with a small /dev/shm: a parallel hash join over the 05_lmr comparison
    // died with "could not resize shared memory segment". Serial plans are fast enough here.
    await q('SET max_parallel_workers_per_gather = 0')
    const [tr, rr, cr, gr] = await Promise.all([
      q(CRITERIA_SQL.types), q(CRITERIA_SQL.requirements), q(CRITERIA_SQL.checks), q(CRITERIA_SQL.general)])
    const criteria = criteriaFromRows(tr.rows, rr.rows, cr.rows, gr.rows)
    log(`catalogue: ${criteria.types.length} types, ${criteria.general.length} s 164 items`)

    if (!PUBLISH_ONLY) {
    // ── 1. lots the 800 m catchments reach, shrunk 10 cm ─────────────────────────────────────────
    await q('DROP TABLE IF EXISTS lmr._lmr_cand_all, lmr._lmr_cand, lmr._lmr_zone, lmr._lmr_band, lmr._lmr_hits, lmr._lmr_result')
    await q(`CREATE UNLOGGED TABLE lmr._lmr_cand_all AS
      WITH cat AS (
        SELECT geom FROM lmr.station_walking_catchments WHERE distance_m = 800
        UNION ALL SELECT ST_SetSRID(geom, 4283) FROM lmr.town_centre_walking_catchments WHERE distance_m = 800),
      hit AS (SELECT DISTINCT l.cadid FROM cat JOIN cadastre.lot l ON l.geom && cat.geom AND ST_Intersects(l.geom, cat.geom))
      SELECT l.cadid, l.lotidstring AS lot_id, l.geom,
             CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN ST_MakeValid(l.geom) ELSE b END AS g
        FROM hit JOIN cadastre.lot l USING (cadid),
             LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(ST_MakeValid(l.geom), 3308), -0.1), 4283) AS b) x`)
    await q('CREATE INDEX ON lmr._lmr_cand_all USING gist (g)')
    await q('ANALYZE lmr._lmr_cand_all')
    log(`1. lots touching an 800 m catchment: ${(await q('SELECT count(*) FROM lmr._lmr_cand_all')).rows[0].count}`)

    // ── 2. keep the residential land ────────────────────────────────────────────────────────────
    await q(`CREATE UNLOGGED TABLE lmr._lmr_zone AS
      SELECT c.cadid, z.epi_name, z.sym_code::text AS zone
        FROM lmr._lmr_cand_all c JOIN epi.epi_land_zoning z ON z.geom && c.g AND ST_Intersects(z.geom, c.g)
       WHERE z.sym_code IS NOT NULL GROUP BY 1, 2, 3`)
    await q(`CREATE UNLOGGED TABLE lmr._lmr_cand AS
      SELECT * FROM lmr._lmr_cand_all c
       WHERE EXISTS (SELECT 1 FROM lmr._lmr_zone z WHERE z.cadid = c.cadid AND z.zone IN ('R1','R2','R3','R4'))`)
    // the lot in 4326 as well, once: bush fire prone land is stored in 4326, and transforming 232k lots inside
    // the join cost 1,000 s on the first run
    await q('ALTER TABLE lmr._lmr_cand ADD COLUMN g4326 geometry')
    await q('UPDATE lmr._lmr_cand SET g4326 = ST_Transform(g, 4326)')
    await q('CREATE INDEX ON lmr._lmr_cand USING gist (g)')
    await q('CREATE INDEX ON lmr._lmr_cand USING gist (g4326)')
    await q('CREATE UNIQUE INDEX ON lmr._lmr_cand (cadid)')
    await q('ANALYZE lmr._lmr_cand')
    log(`2. of those, with any part in R1-R4: ${(await q('SELECT count(*) FROM lmr._lmr_cand')).rows[0].count}`)

    // ── the band: the nearest catchment each lot is inside ──────────────────────────────────────
    await q(`CREATE UNLOGGED TABLE lmr._lmr_band AS
      SELECT c.cadid,
        (SELECT min(w.distance_m) FROM lmr.station_walking_catchments w WHERE w.geom && c.g AND ST_Intersects(w.geom, c.g)) AS station_min,
        (SELECT array_agg(DISTINCT w.station || ' (' || w.distance_m || ' m)') FROM lmr.station_walking_catchments w
          WHERE w.geom && c.g AND ST_Intersects(w.geom, c.g)) AS stations,
        -- the column is declared plain geometry (geometry_columns says SRID 0) but every row is 4283
        (SELECT min(w.distance_m) FROM lmr.town_centre_walking_catchments w
          WHERE w.geom && c.g AND ST_Intersects(w.geom, c.g)) AS centre_min,
        (SELECT array_agg(DISTINCT w.label || ' (' || w.distance_m || ' m)') FROM lmr.town_centre_walking_catchments w
          WHERE w.geom && c.g AND ST_Intersects(w.geom, c.g)) AS centres
      FROM lmr._lmr_cand c`)
    log('   bands measured')

    // ── 3. every s 164 layer against every lot ──────────────────────────────────────────────────
    const meta = await q(`
      SELECT g.f_table_name AS t, g.f_geometry_column AS gcol, g.srid,
             (SELECT array_agg(column_name::text) FROM information_schema.columns x
               WHERE x.table_schema = 'lmr' AND x.table_name = g.f_table_name) AS columns
        FROM geometry_columns g WHERE g.f_table_schema = 'lmr'`)
    const byTable = new Map<string, any>(meta.rows.map((r: any) => [r.t, r]))
    await q(`CREATE UNLOGGED TABLE lmr._lmr_hits (cadid text, clause text, fail_n int, unknown_n int, names text[])`)
    for (const item of criteria.general) {
      for (const layer of item.layerKeys) {
        const m = byTable.get(layer)
        if (!m) throw new Error(`${item.clause}: layer lmr.${layer} is missing`)
        const srid = Number(m.srid)
        const lotX = srid === 4326 ? 'c.g4326' : srid === 0 ? 'ST_SetSRID(c.g, 0)' : 'c.g'
        const name = NAME_COLUMNS.find(n => (m.columns ?? []).includes(n))
        const fail = item.failWhere ? `(${item.failWhere})` : 'true'
        const unknown = item.unknownWhere ? `(${item.unknownWhere})` : 'false'
        /*
         * Bush fire prone land is 269k polygons and 65M vertices: intersecting 232k lots against it whole took
         * 1,000 s. Cut into pieces of at most 256 vertices first - a lot touches the layer exactly when it
         * touches a piece - and the join is ordinary. Only the name column travels with the pieces, so this is
         * for layers read without a fail/unknown filter; counts become piece counts, which only ever mean "> 0".
         */
        let rel = `lmr."${layer}"`
        let gcol = m.gcol
        if (SUBDIVIDE.has(layer)) {
          if (item.failWhere || item.unknownWhere) throw new Error(`${layer}: subdividing drops the columns its filter reads`)
          await q(`DROP TABLE IF EXISTS lmr."_lmr_sub_${layer}"`)
          await q(`CREATE UNLOGGED TABLE lmr."_lmr_sub_${layer}" AS
                   SELECT ${name ? `x."${name}", ` : ''}ST_Subdivide(x."${m.gcol}", 256) AS sub_geom
                     FROM lmr."${layer}" x WHERE x."${m.gcol}" && (SELECT ST_Extent(g4326) FROM lmr._lmr_cand)::geometry`)
          await q(`CREATE INDEX ON lmr."_lmr_sub_${layer}" USING gist (sub_geom)`)
          await q(`ANALYZE lmr."_lmr_sub_${layer}"`)
          rel = `lmr."_lmr_sub_${layer}"`
          gcol = 'sub_geom'
          log(`   ${layer} cut into ${(await q(`SELECT count(*) FROM ${rel}`)).rows[0].count} pieces`)
        }
        const res = await q(`INSERT INTO lmr._lmr_hits
          SELECT c.cadid, '${item.clause}',
                 count(*) FILTER (WHERE ${fail}), count(*) FILTER (WHERE ${unknown}),
                 (array_agg(DISTINCT ${name ? `x."${name}"::text` : 'NULL::text'})
                    FILTER (WHERE ${name ? `x."${name}" IS NOT NULL AND (${fail} OR ${unknown})` : 'false'}))[1:3]
            FROM lmr._lmr_cand c JOIN ${rel} x ON x."${gcol}" && ${lotX} AND ST_Intersects(x."${gcol}", ${lotX})
           GROUP BY c.cadid`)
        if (SUBDIVIDE.has(layer)) await q(`DROP TABLE IF EXISTS lmr."_lmr_sub_${layer}"`)
        log(`3. s ${item.clause} ${layer}: ${res.rowCount} lots touched`)
      }
    }

    // ── 4. the verdict, lot by lot, with the shared evaluator ───────────────────────────────────
    const facts = await q(`
      SELECT c.cadid, c.lot_id, ST_Area(c.geom::geography) AS area_m2,
             p.primary_frontage_length_m, p.is_battleaxe, upper(ll.lga_name) AS lga,
             b.station_min, b.stations, b.centre_min, b.centres
        FROM lmr._lmr_cand c
        JOIN lmr._lmr_band b USING (cadid)
        -- lot_profile is one row per ADDRESS (5.2M rows, 3.4M lots); frontage and battle-axe are lot-level, so one row
        LEFT JOIN (SELECT DISTINCT ON (cadid) cadid, primary_frontage_length_m, is_battleaxe
                     FROM derived.lot_profile WHERE cadid IN (SELECT cadid FROM lmr._lmr_cand)
                    ORDER BY cadid, is_primary_address DESC NULLS LAST) p USING (cadid)
        LEFT JOIN derived.lot_lga ll USING (cadid)`)
    const zonesBy = new Map<string, { epi: string; zone: string }[]>()
    for (const z of (await q('SELECT cadid, epi_name, zone FROM lmr._lmr_zone WHERE cadid IN (SELECT cadid FROM lmr._lmr_cand)')).rows) {
      const list = zonesBy.get(z.cadid) ?? []
      list.push({ epi: z.epi_name, zone: z.zone })
      zonesBy.set(z.cadid, list)
    }
    const hitsBy = new Map<string, Map<string, GeneralHits>>()
    for (const h of (await q('SELECT cadid, clause, fail_n, unknown_n, names FROM lmr._lmr_hits')).rows) {
      const forLot = hitsBy.get(h.cadid) ?? new Map<string, GeneralHits>()
      const cur = forLot.get(h.clause) ?? { failN: 0, unknownN: 0, names: [] }
      cur.failN += Number(h.fail_n); cur.unknownN += Number(h.unknown_n)
      cur.names = [...new Set([...cur.names, ...(h.names ?? [])])]
      forLot.set(h.clause, cur)
      hitsBy.set(h.cadid, forLot)
    }
    const uses = [...new Set(criteria.types.flatMap(t => t.landUses))].map(u => u.toLowerCase())
    const permBy = new Map<string, Perm[]>()
    for (const p of (await q(`SELECT epi_name, zone_code, land_use, status FROM nsw.lep_permissibility WHERE lower(land_use) = ANY($1)`, [uses])).rows) {
      const key = `${p.epi_name}|${p.zone_code}`
      const list = permBy.get(key) ?? []
      list.push({ epi: p.epi_name, zone: p.zone_code, landUse: p.land_use, status: p.status })
      permBy.set(key, list)
    }
    log(`4. judging ${facts.rows.length} lots`)

    const NONE: GeneralHits = { failN: 0, unknownN: 0, names: [] }
    const out: any[][] = []
    const tally = { in: 0, excluded: 0, undecided: 0, outside: 0 }
    for (const r of facts.rows) {
      const zoneRows = zonesBy.get(r.cadid) ?? []
      const lot: LmrLotFacts = {
        cadid: r.cadid, lotId: r.lot_id, lga: r.lga ?? null,
        areaM2: r.area_m2 == null ? null : Number(r.area_m2),
        // the property's primary frontage, as /api/lmr/types reads it
        widthM: r.primary_frontage_length_m != null ? Number(r.primary_frontage_length_m) : null,
        isBattleaxe: r.is_battleaxe == null ? null : Boolean(r.is_battleaxe),
        zones: [...new Set(zoneRows.map(z => z.zone))].sort(),
        band: bandFrom(r.station_min == null ? null : Number(r.station_min), r.centre_min == null ? null : Number(r.centre_min)),
        measuredFrom: [...(r.stations ?? []), ...(r.centres ?? [])].sort(),
      }
      // touched the catchment only at the boundary: shrunk 10 cm, it is outside
      if (!lot.band) { tally.outside++; continue }
      const perm = zoneRows.flatMap(z => permBy.get(`${z.epi}|${z.zone}`) ?? [])
      const hits = hitsBy.get(r.cadid)
      const general = criteria.general.map(g => evaluateGeneral(g, hits?.get(g.clause) ?? NONE, lot.lga))
      const excluded = general.filter(g => g.status === 'excluded')
      const undecided = general.filter(g => g.status === 'unknown')
      const types = criteria.types.map(t => evaluateType(t, lot, perm, excluded, undecided))
      const cls = excluded.length ? 'excluded' : undecided.length ? 'undecided' : 'in'
      tally[cls]++
      out.push([
        lot.cadid, lot.lotId, lot.lga, lot.zones.join('|'), lot.band, lot.measuredFrom.join('|'), cls,
        excluded.map(e => e.clause).join('|'), undecided.map(e => e.clause).join('|'),
        undecided.map(e => `${e.clause}: ${e.why}`).join(' | '),
        types.filter(t => t.eligible === true).map(t => t.key).join('|'),
        types.filter(t => t.eligible === null).map(t => t.key).join('|'),
        lot.areaM2, lot.widthM,
      ])
    }
    log(`   in ${tally.in} · excluded ${tally.excluded} · undecided ${tally.undecided} · boundary-only, dropped ${tally.outside}`)

    await q(`CREATE UNLOGGED TABLE lmr._lmr_result (cadid text, lot_id text, lga text, zones text, band text, measured_from text,
              class text, excluded_by text, undecided_by text, undecided_why text, eligible_types text, undecided_types text,
              area_m2 double precision, width_m double precision)`)
    const COLS = 14
    for (let i = 0; i < out.length; i += 2000) {
      const chunk = out.slice(i, i + 2000)
      const params: any[] = []
      const rows = chunk.map((row, j) => `(${row.map((_, k) => `$${j * COLS + k + 1}`).join(',')})`)
      for (const row of chunk) params.push(...row)
      await q(`INSERT INTO lmr._lmr_result VALUES ${rows.join(',')}`, params)
    }
    log(`   ${out.length} verdicts written`)
    } else {
      log(`--publish-only: ${(await q('SELECT count(*) FROM lmr._lmr_result')).rows[0].count} verdicts from the last run`)
    }

    // ── the published tables, swapped in one transaction ────────────────────────────────────────
    const arr = (col: string) => `CASE WHEN r.${col} = '' THEN '{}'::text[] ELSE string_to_array(r.${col}, '|') END`
    await q('DROP TABLE IF EXISTS lmr.lot_lmr__new, lmr.lmr_area__new, lmr.lot_lmr_05_only__new')
    await q(`CREATE TABLE lmr.lot_lmr__new AS
      WITH ours05 AS (SELECT DISTINCT upper(lot_section_plan) AS lsp FROM nsw.up_property_d_4 WHERE in_lmr_housing_area IS TRUE)
      SELECT r.cadid, r.lot_id, r.lga, ${arr('zones')} AS zones, r.band, ${arr('measured_from')} AS measured_from,
             r.class, ${arr('excluded_by')} AS excluded_by, ${arr('undecided_by')} AS undecided_by,
             nullif(r.undecided_why, '') AS undecided_why,
             ${arr('eligible_types')} AS eligible_types, ${arr('undecided_types')} AS undecided_types,
             r.area_m2, r.width_m,
             EXISTS (SELECT 1 FROM ours05 o WHERE o.lsp = upper(r.lot_id)) AS in_05_lmr,
             ST_Multi(ST_CollectionExtract(ST_MakeValid(c.geom), 3))::geometry(MultiPolygon, 4283) AS geom,
             now() AS built_at
        FROM lmr._lmr_result r JOIN lmr._lmr_cand c USING (cadid)`)
    await q('ALTER TABLE lmr.lot_lmr__new ADD PRIMARY KEY (cadid)')
    await q('CREATE INDEX ON lmr.lot_lmr__new USING gist (geom)')
    log('   lmr.lot_lmr built')

    // lots 05_lmr has and this build does not, with why
    await q(`CREATE TABLE lmr.lot_lmr_05_only__new AS
      WITH theirs AS (
        SELECT upper(lot_section_plan) AS lsp, max(buffer) AS buffer, max(lmr_sym_code) AS zone_05,
               max(lmr_train_stations) AS stations_05
          FROM nsw.up_property_d_4 WHERE in_lmr_housing_area IS TRUE GROUP BY 1)
      SELECT l.cadid, l.lotidstring AS lot_id, upper(ll.lga_name) AS lga, t.buffer AS band_05, t.zone_05, t.stations_05,
             CASE WHEN a.cadid IS NULL THEN 'outside our walking catchments'
                  WHEN c.cadid IS NULL THEN 'no part in R1-R4 on our zoning'
                  ELSE 'only touches our catchment at the boundary' END AS why,
             ST_Multi(ST_CollectionExtract(ST_MakeValid(l.geom), 3))::geometry(MultiPolygon, 4283) AS geom
        FROM theirs t
        JOIN cadastre.lot l ON upper(l.lotidstring) = t.lsp
        LEFT JOIN derived.lot_lga ll ON ll.cadid = l.cadid
        LEFT JOIN lmr._lmr_cand_all a ON a.cadid = l.cadid
        LEFT JOIN lmr._lmr_cand c ON c.cadid = l.cadid
       WHERE NOT EXISTS (SELECT 1 FROM lmr.lot_lmr__new n WHERE n.cadid = l.cadid)`)
    await q('CREATE INDEX ON lmr.lot_lmr_05_only__new USING gist (geom)')
    log(`   lmr.lot_lmr_05_only: ${(await q('SELECT count(*) FROM lmr.lot_lmr_05_only__new')).rows[0].count}`)

    // the 'in' lots dissolved by band, for low zoom; snapped so shared boundaries merge
    await q(`CREATE TABLE lmr.lmr_area__new AS
      SELECT band, count(*) AS lots,
             -- a union WITH a grid size snaps and nodes in one step and stays valid; snapping first and
             -- unioning after made self-intersections GEOS refused (TopologyException, side location conflict)
             ST_Multi(ST_CollectionExtract(ST_Union(geom, 0.0000001), 3))::geometry(MultiPolygon, 4283) AS geom
        FROM lmr.lot_lmr__new WHERE class = 'in' GROUP BY band`)
    log('   lmr.lmr_area dissolved')

    await q('BEGIN')
    await q('DROP TABLE IF EXISTS lmr.lot_lmr, lmr.lmr_area, lmr.lot_lmr_05_only')
    await q('ALTER TABLE lmr.lot_lmr__new RENAME TO lot_lmr')
    await q('ALTER TABLE lmr.lmr_area__new RENAME TO lmr_area')
    await q('ALTER TABLE lmr.lot_lmr_05_only__new RENAME TO lot_lmr_05_only')
    const today = new Date().toISOString().slice(0, 10)
    await q(`COMMENT ON TABLE lmr.lot_lmr IS 'Every lot with any part in R1-R4 inside an 800 m walking catchment, judged against Housing SEPP Chapter 6 - in the LMR area, excluded by s 164, or undecided where the data cannot decide an s 164 item. The verdict is shared/lmr-evaluate.ts, the same as the This lot tab. Built ${today} by scripts/build-lmr-lots.ts.'`)
    await q(`COMMENT ON TABLE lmr.lmr_area IS 'The in-class lots of lmr.lot_lmr dissolved by band, for low zoom. Built ${today} by scripts/build-lmr-lots.ts.'`)
    await q(`COMMENT ON TABLE lmr.lot_lmr_05_only IS 'Lots notebook 05_lmr marks in_lmr_housing_area that lmr.lot_lmr does not hold, with why. Built ${today} by scripts/build-lmr-lots.ts.'`)
    await q('COMMIT')
    await q('DROP TABLE IF EXISTS lmr._lmr_cand_all, lmr._lmr_cand, lmr._lmr_zone, lmr._lmr_band, lmr._lmr_hits, lmr._lmr_result')

    const s = (await q(`SELECT class, count(*) n, count(*) FILTER (WHERE in_05_lmr) with_05 FROM lmr.lot_lmr GROUP BY 1 ORDER BY 1`)).rows
    log('done:', s.map((x: any) => `${x.class} ${x.n} (05_lmr has ${x.with_05})`).join(' · '))
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
