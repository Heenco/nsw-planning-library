/**
 * Step 2 of docs/precinct-sepp-pipeline.md: derived.lot_instrument - which instrument, and which unit of
 * it, governs each lot.
 *
 *     npx tsx scripts/build-lot-instrument.ts --lga BLACKTOWN --lga HORNSBY     # named councils only
 *     npx tsx scripts/build-lot-instrument.ts --all                             # the state, council by council
 *     npx tsx scripts/build-lot-instrument.ts --all --swap                      # then replace derived.lot_instrument
 *
 * One row per (lot, instrument) found at the lot's point on surface in epi.epi_land_zoning, plus the
 * governing flag:
 *   - the instrument with the highest rank governs (EP&A Act s 3.28: a SEPP prevails over an LEP where
 *     they are inconsistent; dcp 10 / lep 20 / sepp 30, the scale rag.instrument and the CDC pilot use);
 *     among equals, the one covering more of the lot;
 *   - cover_pct is measured only when more than one instrument is at the point (the expensive step);
 *     a sliver is anything under COVER_MIN and is never governing;
 *   - the unit comes from nsw.instrument_unit_map: the land application polygon of the same instrument
 *     at the point (label, else layer class, else map name), else the zoning polygon's map name; an LEP
 *     is its own single unit (unit_local_id NULL, basis 'root'); a SEPP key with no mapped unit resolves
 *     to NULL with basis 'unmapped' - every reader treats that as "unit not held".
 * The work is done council by council (derived.lot_lga) into derived.lot_instrument_build, and swapped
 * into derived.lot_instrument in one statement at the end, so a half-finished build never serves.
 */
import 'dotenv/config'
import pg from 'pg'

const argv = process.argv.slice(2)
const LGAS = argv.flatMap((a, i) => (a === '--lga' ? [argv[i + 1]!.toUpperCase()] : []))
const ALL = argv.includes('--all')
const SWAP = argv.includes('--swap')
const COVER_MIN = 50
if (!ALL && !LGAS.length) { console.error('usage: --lga NAME [--lga NAME ...] | --all [--swap]'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params)

const DDL = `
  CREATE TABLE IF NOT EXISTS derived.lot_instrument_build (
    cadid          text NOT NULL,
    document_title text NOT NULL,                -- epi_name on the zoning layer; nsw.document.title where held
    document_id    uuid,                         -- NULL = the instrument is not in the graph
    doc_type       text,                         -- lep | sepp | NULL
    rank           integer NOT NULL,             -- 20 lep, 30 sepp, 0 unknown
    zone           text,
    unit_local_id  text,                         -- NULL with basis 'root' = the whole instrument; with 'unmapped'/'none' = not held
    unit_heading   text,
    unit_basis     text NOT NULL,                -- root (an LEP, in the graph or not) | land_application | land_zoning | unmapped (a SEPP key with no unit) | none (a SEPP not in the graph)
    cover_pct      numeric(5, 1),                -- NULL = single instrument at the point (not measured)
    governing      boolean NOT NULL,
    lga_name       text,
    computed_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cadid, document_title)
  );
  CREATE INDEX IF NOT EXISTS lot_instrument_build_cadid_idx ON derived.lot_instrument_build (cadid);
  CREATE INDEX IF NOT EXISTS lot_instrument_build_doc_idx ON derived.lot_instrument_build (document_title, unit_local_id);`

/** one council: every (lot, instrument) at the point, the unit, cover where needed, the governing flag */
const BUILD = `
  WITH l AS (
    SELECT l.cadid, l.geom, ST_PointOnSurface(l.geom) AS pt, g.lga_name
      FROM cadastre.lot l JOIN derived.lot_lga g ON g.cadid = l.cadid::text
     WHERE upper(g.lga_name) = $1
  ),
  hit AS (                      -- every zoning polygon at the point, one row per instrument (the largest polygon if several of one plan)
    SELECT DISTINCT ON (l.cadid, z.epi_name) l.cadid, l.geom, l.pt, l.lga_name, z.epi_name, z.sym_code AS zone, z.map_name AS zmap,
           upper(z.lga_name) = upper(l.lga_name) AS same_lga
      FROM l JOIN epi.epi_land_zoning z ON z.geom && l.pt AND ST_Intersects(z.geom, l.pt)
     ORDER BY l.cadid, z.epi_name, ST_Area(z.geom) DESC
  ),
  nhit AS (SELECT cadid, count(*) AS n FROM hit GROUP BY 1),
  doc AS (SELECT id, title, doc_type FROM nsw.document WHERE doc_type IN ('lep', 'sepp')),
  app AS (                      -- the same instrument's land application polygon at the point (the smallest, if nested)
    SELECT DISTINCT ON (h.cadid, h.epi_name) h.cadid, h.epi_name, a.map_name, a.lay_class, a.label
      FROM hit h JOIN epi.epi_land_application a ON a.epi_name = h.epi_name AND a.geom && h.pt AND ST_Intersects(a.geom, h.pt)
     ORDER BY h.cadid, h.epi_name, ST_Area(a.geom)
  ),
  unit AS (
    SELECT h.cadid, h.epi_name,
           COALESCE(ma.unit_local_id, mz.unit_local_id) AS unit_local_id,
           COALESCE(ma.unit_heading, mz.unit_heading) AS unit_heading,
           CASE WHEN d.doc_type = 'lep' OR (d.id IS NULL AND h.epi_name ~* 'Local Environmental Plan') THEN 'root'   -- an LEP is one unit, in the graph or not
                WHEN ma.unit_local_id IS NOT NULL THEN 'land_application'
                WHEN mz.unit_local_id IS NOT NULL THEN 'land_zoning'
                WHEN ma.document_id IS NOT NULL OR mz.document_id IS NOT NULL THEN 'unmapped'
                ELSE 'none' END AS unit_basis
      FROM hit h
      LEFT JOIN doc d ON d.title = h.epi_name
      LEFT JOIN app a ON a.cadid = h.cadid AND a.epi_name = h.epi_name
      LEFT JOIN nsw.instrument_unit_map ma ON ma.document_id = d.id AND ma.layer = 'epi.epi_land_application' AND ma.status <> 'rejected'
             AND ma.map_name IS NOT DISTINCT FROM a.map_name AND ma.lay_class IS NOT DISTINCT FROM a.lay_class AND ma.label IS NOT DISTINCT FROM a.label
      LEFT JOIN nsw.instrument_unit_map mz ON mz.document_id = d.id AND mz.layer = 'epi.epi_land_zoning' AND mz.status <> 'rejected'
             AND mz.map_name IS NOT DISTINCT FROM h.zmap
  ),
  cover AS (                    -- measured only where more than one instrument is at the point
    SELECT h.cadid, h.epi_name,
           round((100 * ST_Area(ST_Intersection(ST_Union(z.geom), h.geom)::geography) / NULLIF(ST_Area(h.geom::geography), 0))::numeric, 1) AS pct
      FROM hit h JOIN nhit n ON n.cadid = h.cadid AND n.n > 1
      JOIN epi.epi_land_zoning z ON z.epi_name = h.epi_name AND z.geom && h.geom AND ST_Intersects(z.geom, h.geom)
     GROUP BY h.cadid, h.epi_name, h.geom
  ),
  rows_ AS (
    SELECT h.cadid, h.epi_name, d.id AS document_id, d.doc_type,
           CASE d.doc_type WHEN 'sepp' THEN 30 WHEN 'lep' THEN 20
                WHEN NULL THEN 0 ELSE 0 END
             + CASE WHEN d.doc_type IS NULL AND h.epi_name ~* 'State Environmental Planning Policy' THEN 30
                    WHEN d.doc_type IS NULL AND h.epi_name ~* 'Local Environmental Plan' THEN 20 ELSE 0 END AS rank,
           h.zone, u.unit_local_id, u.unit_heading, u.unit_basis, c.pct AS cover_pct, h.lga_name, h.same_lga
      FROM hit h LEFT JOIN doc d ON d.title = h.epi_name
      LEFT JOIN unit u ON u.cadid = h.cadid AND u.epi_name = h.epi_name
      LEFT JOIN cover c ON c.cadid = h.cadid AND c.epi_name = h.epi_name
  ),
  ranked AS (
    -- equal rank and cover (two LEPs' zoning layers both covering a council-boundary lot): the lot's own council's plan
    SELECT r.*, row_number() OVER (PARTITION BY cadid ORDER BY (cover_pct IS NULL OR cover_pct >= $2) DESC, rank DESC, cover_pct DESC NULLS LAST, same_lga DESC NULLS LAST, epi_name) AS rn
      FROM rows_ r
  )
  INSERT INTO derived.lot_instrument_build (cadid, document_title, document_id, doc_type, rank, zone, unit_local_id, unit_heading, unit_basis, cover_pct, governing, lga_name)
  SELECT cadid, epi_name, document_id, doc_type, rank, zone, unit_local_id, unit_heading, unit_basis, cover_pct,
         rn = 1 AND (cover_pct IS NULL OR cover_pct >= $2), lga_name
    FROM ranked
  ON CONFLICT (cadid, document_title) DO UPDATE SET document_id = EXCLUDED.document_id, doc_type = EXCLUDED.doc_type, rank = EXCLUDED.rank,
    zone = EXCLUDED.zone, unit_local_id = EXCLUDED.unit_local_id, unit_heading = EXCLUDED.unit_heading, unit_basis = EXCLUDED.unit_basis,
    cover_pct = EXCLUDED.cover_pct, governing = EXCLUDED.governing, lga_name = EXCLUDED.lga_name, computed_at = now()`

async function main() {
  await q(DDL)
  const lgas: string[] = ALL
    ? (await q(`SELECT DISTINCT upper(lga_name) AS l FROM derived.lot_lga WHERE lga_name IS NOT NULL ORDER BY 1`)).rows.map(r => r.l)
    : LGAS
  console.log(`${lgas.length} council(s)`)
  const t0 = Date.now()
  for (const [i, lga] of lgas.entries()) {
    const t = Date.now()
    const r = await q(BUILD, [lga, COVER_MIN])
    console.log(`  ${String(i + 1).padStart(3)}/${lgas.length} ${lga.padEnd(28)} ${String(r.rowCount).padStart(7)} rows  ${((Date.now() - t) / 1000).toFixed(1)}s`)
  }
  console.log(`built in ${((Date.now() - t0) / 60000).toFixed(1)} min`)
  const s = (await q(`
    SELECT count(DISTINCT cadid) AS lots, count(*) FILTER (WHERE governing) AS governing,
           count(DISTINCT cadid) FILTER (WHERE cover_pct IS NOT NULL) AS multi,
           count(*) FILTER (WHERE governing AND unit_basis = 'root') AS root,
           count(*) FILTER (WHERE governing AND unit_basis IN ('land_application', 'land_zoning')) AS unit_found,
           count(*) FILTER (WHERE governing AND unit_basis = 'unmapped') AS unit_unmapped,
           count(*) FILTER (WHERE governing AND unit_basis = 'none') AS not_in_graph
      FROM derived.lot_instrument_build`)).rows[0]
  console.log('build table:', s)
  if (SWAP) {
    await q(`BEGIN; DROP TABLE IF EXISTS derived.lot_instrument_prev; ALTER TABLE IF EXISTS derived.lot_instrument RENAME TO lot_instrument_prev;
             ALTER TABLE derived.lot_instrument_build RENAME TO lot_instrument;
             ALTER INDEX IF EXISTS derived.lot_instrument_build_cadid_idx RENAME TO lot_instrument_cadid_idx;
             ALTER INDEX IF EXISTS derived.lot_instrument_build_doc_idx RENAME TO lot_instrument_doc_idx; COMMIT`)
    console.log('swapped into derived.lot_instrument (previous kept as lot_instrument_prev)')
  }
  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
