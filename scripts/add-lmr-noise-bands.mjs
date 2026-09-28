/**
 * Classify every contour of `lmr.airport_noise` against the Low and Mid-Rise Housing Policy's noise exclusion.
 *
 *   node scripts/add-lmr-noise-bands.mjs [--dry-run]
 *
 * THE RULE
 *
 * The Department excludes "land within an Australian Noise Exposure Forecast contour of 25 or greater, or an
 * Australian Noise Exposure Concept contour of 20 or greater" (exclusions page, updated 24 April 2026; the
 * ANEC case is Western Sydney International). So the SAME band - 20-25 - is excluded on an ANEC map and not
 * on an ANEF map, and the layer cannot be treated as one exclusion. Until now it was: every contour, from
 * Defence 15-20 up, was drawn and catalogued alike.
 *
 * WHAT THE TABLE HOLDS, AND HOW EACH SOURCE IS READ
 *
 *   LEP maps (Cessnock, Liverpool, Upper Hunter)   ANEF, band in anef_code ('20 - 25', '40 +')
 *   Western Parkland City SEPP                     ANEC (lay_name 'Australian Noise Exposure Concept'), anef_code
 *   Defence airfields (folderpath 'Australian      ANEF or ANEC - the source does not say which - band only in the
 *     Defence Airfields ANEF ANEC/...')            name text: 'RAAF Base Richmond - Contour Range 20-25', '35+'
 *   Sydney Airport (anef_code 'ANEI 25')           ANEI: MEASURED exposure, not the forecast the rule names
 *   Gloucester LEP ('Low Noise', 'High Noise')     no number at all
 *
 * THE VERDICT, in lmr_verdict:
 *   excluded      ANEF band from 25, ANEC band from 20, or a Defence band from 25 (excluded under either metric)
 *   not excluded  ANEF band below 25, or any band below 20
 *   undetermined  a Defence 20-25 band (excluded only if it is ANEC, and the source does not say), every ANEI
 *                 contour, and anything with no number
 * noise_verdict is the same in one sentence, for the click popup and the lot report.
 *
 * Plain columns, not generated ones, so the rule sits here in one readable place. Re-run whenever the table is
 * copied again from UrbanPortalDBP, then rebuild the tiles (scripts/build-lmr-pmtiles.py).
 */

import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')

// one SELECT computes everything, so the dry run and the update read the same rule
const CLASSIFY = `
WITH src AS (
  SELECT ctid AS rid,
         CASE
           WHEN btrim(anef_code) ILIKE 'ANEI%'                THEN 'ANEI'
           WHEN folderpath ILIKE 'Australian Defence%'        THEN 'ANEF/ANEC'
           WHEN lay_name ILIKE '%Exposure Concept%'           THEN 'ANEC'
           WHEN lay_name ILIKE '%Noise Exposure Forecast%'    THEN 'ANEF'
           ELSE 'unknown' END AS metric,
         -- the band as "lower - upper" or "lower +", from anef_code or, for Defence, from the name text
         coalesce(
           nullif(regexp_replace(substring(btrim(anef_code) from '^(\\d+\\s*-\\s*\\d+|\\d+\\s*\\+)$'), '\\s*([-+])\\s*', ' \\1 ', 'g'), ''),
           nullif(regexp_replace(substring(name from 'Contour Range (\\d+\\s*-\\s*\\d+|\\d+\\s*\\+)'), '\\s*([-+])\\s*', ' \\1 ', 'g'), ''),
           substring(btrim(anef_code) from '^ANEI (\\d+)$')
         ) AS band_raw
  FROM lmr.airport_noise
),
banded AS (
  SELECT rid, metric,
         nullif(btrim(band_raw), '') AS band,
         substring(band_raw from '^(\\d+)')::int AS lower
  FROM src
)
SELECT rid, metric, band, lower,
       CASE
         WHEN lower IS NULL OR metric IN ('ANEI', 'unknown')    THEN 'undetermined'
         WHEN metric = 'ANEF'      AND lower >= 25              THEN 'excluded'
         WHEN metric = 'ANEC'      AND lower >= 20              THEN 'excluded'
         WHEN metric = 'ANEF/ANEC' AND lower >= 25              THEN 'excluded'
         WHEN metric = 'ANEF/ANEC' AND lower >= 20              THEN 'undetermined'
         ELSE 'not excluded' END AS verdict
FROM banded`

const SENTENCE = `
  CASE lmr_verdict
    WHEN 'excluded' THEN concat_ws(' ', noise_metric, noise_band, '- excluded: the policy excludes ANEF 25 or more and ANEC 20 or more')
    WHEN 'not excluded' THEN concat_ws(' ', noise_metric, noise_band, '- not excluded: below ANEF 25 / ANEC 20')
    ELSE CASE
      WHEN noise_metric = 'ANEI' THEN concat_ws(' ', 'ANEI', substring(noise_band from '^\\d+'), '- undetermined: measured exposure, not the ANEF forecast the policy names')
      WHEN noise_metric = 'ANEF/ANEC' THEN concat_ws(' ', 'Defence', noise_band, '- undetermined: excluded if this contour is an ANEC, and the source does not say which')
      ELSE coalesce(btrim(anef_code), 'No band') || ' - undetermined: the contour carries no ANEF number'
    END
  END`

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(`SELECT metric, band, verdict, count(*)::int n FROM (${CLASSIFY}) c
                                         GROUP BY 1, 2, 3 ORDER BY 1, 2`)
    console.table(rows)
    if (DRY) { console.log('dry run - nothing written'); return }

    await client.query('BEGIN')
    for (const col of ['noise_metric text', 'noise_band text', 'noise_lower int', 'lmr_verdict text', 'noise_verdict text']) {
      await client.query(`ALTER TABLE lmr.airport_noise ADD COLUMN IF NOT EXISTS ${col}`)
    }
    const upd = await client.query(`UPDATE lmr.airport_noise t
       SET noise_metric = c.metric, noise_band = c.band, noise_lower = c.lower, lmr_verdict = c.verdict
       FROM (${CLASSIFY}) c WHERE t.ctid = c.rid`)
    await client.query(`UPDATE lmr.airport_noise SET noise_verdict = ${SENTENCE}`)
    const { rows: [left] } = await client.query('SELECT count(*)::int n FROM lmr.airport_noise WHERE lmr_verdict IS NULL')
    if (left.n) throw new Error(`${left.n} rows left unclassified`)
    await client.query(`COMMENT ON COLUMN lmr.airport_noise.lmr_verdict IS ${pg.escapeLiteral(
      'excluded / not excluded / undetermined against the LMR noise exclusion (ANEF 25+ or ANEC 20+). '
      + 'Written by scripts/add-lmr-noise-bands.mjs, which documents how each source is read.')}`)
    await client.query('COMMIT')
    console.log(`classified ${upd.rowCount} contours`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
