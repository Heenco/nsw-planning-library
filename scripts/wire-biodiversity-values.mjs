/**
 * Wire the `bio_values` schema into /esa and /cdc-map.
 *
 *   node scripts/wire-biodiversity-values.mjs [--dry-run]
 *
 * Run after scripts/load-bio-values.py. It refuses to run against anything but a whole data pack,
 * because a half-loaded class would quietly become a half-true exclusion.
 *
 * WHAT IT CHANGES, AND THE ONE JUDGEMENT BEHIND ALL OF IT
 *
 * The Biodiversity Values Map is the Biodiversity Offsets Scheme ENTRY map. Nine of its ten classes say
 * "the offsets scheme is triggered here", which is a different question from "exempt and complying
 * development cannot be carried out here". Only "Declared Area of Outstanding Biodiversity Value" is a
 * clause 3.3 item. So this script exposes exactly two slices as layers and leaves the other 595,000-odd
 * polygons in bio_values as context:
 *
 *   esa.aobv                the 2 AOBV polygons - clause 3.3(j), and CDC clause 1.17A(1)(b)/(e)(j)
 *   cdc.critical_habitat    the same two polygons under the name the CDC clauses use - declared TSC
 *                           Act critical habitat became the first AOBVs, so this fills a gap rather than
 *                           adding a layer beside it
 *   cdc.koala_core_habitat  core koala habitat in an approved KPoM - 5,174 polygons against the 74 the
 *                           cdc schema has today from epi, for the same clause 1.19(1)(e)(iii)
 *
 * HOW FAR THE AOBV SLICE ACTUALLY CLOSES THE GAP
 *
 * Not all the way, and the registry has to say so. The published AOBV register holds four declarations,
 * all of them former critical habitat under the Threatened Species Conservation Act 1995: Gould's Petrel,
 * the little penguin population in Sydney's North Harbour, Mitchell's Rainforest Snail at Stotts Island,
 * and the Wollemi Pine. The map carries two polygons and both are in North Harbour at Manly, so it maps
 * one declaration of the four. Gould's Petrel (Cabbage Tree Island) and Mitchell's Rainforest Snail
 * (Stotts Island) are simply absent; the Wollemi Pine location is withheld on purpose. The row therefore
 * stops being a gap and becomes a layer with a stated shortfall, which is a different and more useful
 * thing than either "no dataset" or "done".
 */

import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')
const TABLE = 'bio_values.biodiversityvalues'
const PACK_ROWS = 600_625   // data pack version 19.5, 11 September 2026
const PACK_CLASSES = 10
const AOBV = 'Declared Area of Outstanding Biodiversity Value'
const KOALA = 'Core Habitat within an approved Koala Plan of Management (Koala SEPP)'
const SOURCE = 'LMBC Biodiversity Values Map data pack v19.5 (11 September 2026), from SEED'

const log = s => process.stdout.write(s + '\n')

const AOBV_NOTE =
  'Two polygons, both in Sydney\'s North Harbour at Manly, from the Biodiversity Values Map data pack. The '
  + 'published AOBV register holds FOUR declarations, all former critical habitat under the Threatened '
  + 'Species Conservation Act 1995 - Gould\'s Petrel, the little penguin population in North Harbour, '
  + 'Mitchell\'s Rainforest Snail at Stotts Island, and the Wollemi Pine. Only the North Harbour one is '
  + 'mapped here. Gould\'s Petrel and Mitchell\'s Rainforest Snail are absent from the map and the Wollemi '
  + 'Pine location is withheld deliberately, so three of the four still have to be checked by hand. No '
  + 'ArcGIS service anywhere publishes the register as a layer: the EDP, Tenure and ePlanning folders '
  + 'were searched again on 2026-09-20 and carry no critical habitat or AOBV service.'

/**
 * The CDC side of the same two polygons, under the name the clauses use.
 *
 * Clause 1.17A(1)(b) is "must not be on land that is critical habitat" and 1.17A(1)(e)(j) is "land
 * identified as being critical habitat under the Threatened Species Conservation Act 1995". The
 * Department's workbook note against (b) says declared TSC Act critical habitat became the first Areas
 * of Outstanding Biodiversity Value - so the AOBV slice is not a NEW layer for CDC, it is the dataset
 * that answers the critical habitat test, and cdc.critical_habitat stops being a gap.
 *
 * It is a PARTIAL answer and the note has to say so, because a partial exclusion layer that reads as
 * complete is how a lot gets wrongly cleared.
 */
const CRITICAL_HABITAT_NOTE =
  'Declared critical habitat under the Threatened Species Conservation Act 1995 became the first Areas '
  + 'of Outstanding Biodiversity Value under the Biodiversity Conservation Act 2016, so the AOBV slice of '
  + 'the Biodiversity Values Map is what answers this test. PARTIAL: the published AOBV register holds '
  + "four declarations - Gould's Petrel, the little penguin population in Sydney's North Harbour, "
  + "Mitchell's Rainforest Snail at Stotts Island and the Wollemi Pine - and the map carries two "
  + 'polygons, both in North Harbour at Manly, so one of the four is mapped. A lot away from Manly is '
  + 'NOT cleared of this test by missing these polygons; the other three still have to be checked by '
  + 'hand against the register. No ArcGIS service anywhere publishes the register as a layer (EDP, '
  + 'Tenure and ePlanning folders searched 2026-09-20). Clause 1.17A(1)(e)(j) also names Part 7A of the '
  + 'Fisheries Management Act 1994, which the workbook excludes and which is not in this layer either.'

/**
 * Why the koala layer goes in as CONTEXT and not as an exclusion.
 *
 * Core habitat in an approved KPoM is an exclusion under clause 1.19(1)(e)(iii) in principle. But the cdc
 * schema already answers that clause from the EPI maps with 74 polygons, and this is 5,174 of them. Until
 * someone establishes which reading is right, switching it on as an exclusion would change the verdict for
 * a lot of lots on the strength of an unreconciled guess - and a CDC verdict that flips is worse than one
 * that says "here is a layer you should look at". It draws on the map and it lists in the panel; it does
 * not remove anybody's certificate until the question is settled.
 */
const KOALA_CDC_NOTE =
  'Core koala habitat within an approved Koala Plan of Management, from the Biodiversity Values Map data '
  + 'pack (5,174 polygons, 215 km2). NOT APPLIED AS AN EXCLUSION YET: cdc.koala_habitat (57) and '
  + 'cdc.koala_corridor (17) answer the same clause 1.19(1)(e)(iii) from the EPI local and special '
  + 'provisions maps, and this is a seventy-times larger reading of the same test. Which is authoritative '
  + 'has not been settled, so this is carried as context - drawn and listed, but not counted against a lot '
  + '- rather than silently changing verdicts. Reconcile the three, then flip kind to exclusion.'

const CRITICAL_HABITAT_ESA_NOTE =
  'The same register as the "declared areas of outstanding biodiversity value" item, under its older '
  + 'name. There is no critical habitat register under the Biodiversity Conservation Act 2016: the '
  + 'Threatened Species Conservation Act 1995 declarations became the first AOBVs and none has been '
  + 'declared since, so the AOBV polygons are what answers this item. PARTIAL, for the same reason as '
  + 'that item - the register holds four declarations and the Biodiversity Values Map carries two '
  + 'polygons, both the North Harbour little penguin site at Manly. Gould’s Petrel, Mitchell’s '
  + 'Rainforest Snail and the Wollemi Pine are not mapped, so land away from Manly is not cleared of '
  + 'this item by missing these polygons. Kept as its own item because /esa lists the clause’s items, '
  + 'not the layers; on /cdc-map the two are one layer, cdc.critical_habitat.'

const BV_NOTE =
  'Loaded 2026-09-20 into the bio_values schema from the SEED data pack, by ogr2ogr on the database host '
  + '(scripts/load-bio-values.py), after the 07C attempt to page it out of the REST service gave up part '
  + 'way. The pack and the service disagree for the same version date - 600,625 features against 625,779 - '
  + 'while per-class vertex totals agree to within half a percent, so it is the same mapping with about '
  + '25,000 more small rows on the service side; the service also sums biodiverse riparian land to 1.9M '
  + 'km2 against a state of 800,642 km2, which the pack does not. The pack is the citable version and the '
  + 'one loaded. This is the Biodiversity Offsets Scheme entry map, so it stays context - only its '
  + 'Declared Area of Outstanding Biodiversity Value class is a clause 3.3 item, and that is carried '
  + 'separately by the critical_habitat row on /cdc-map and the aobv row on /esa.'

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
  const client = new pg.Client({ connectionString: dsn, statement_timeout: 300_000 })
  await client.connect()

  try {
    const present = await client.query(`SELECT to_regclass('${TABLE}')::text AS t`)
    if (!present.rows[0].t) {
      throw new Error(`${TABLE} does not exist - run scripts/load-bio-values.py first`)
    }

    // The loader reconciled the table against the data pack before it swapped the schema into place, so
    // completeness is already established there. What is worth checking here is that this IS the pack:
    // the REST service is a different source with ~25,000 more rows, so validating against it would be
    // measuring with the wrong yardstick, and the half-finished REST load this replaced must not pass.
    const mix = await client.query(
      `SELECT boset_class, count(*)::int AS n FROM ${TABLE} GROUP BY 1 ORDER BY 2 DESC`)
    const total = mix.rows.reduce((t, r) => t + r.n, 0)
    if (total !== PACK_ROWS || mix.rows.length !== PACK_CLASSES) {
      throw new Error(`${TABLE} holds ${total.toLocaleString()} rows in ${mix.rows.length} classes, not the `
        + `${PACK_ROWS.toLocaleString()} in ${PACK_CLASSES} of data pack v19.5 - re-run scripts/load-bio-values.py`)
    }
    log(`${TABLE}: ${total.toLocaleString()} rows across ${mix.rows.length} classes, matching data pack v19.5`)

    const aobvN = mix.rows.find(r => r.boset_class === AOBV)?.n ?? 0
    const koalaN = mix.rows.find(r => r.boset_class === KOALA)?.n ?? 0
    if (!aobvN) throw new Error(`no ${AOBV} rows - nothing to wire`)
    log(`  AOBV ${aobvN} · koala core habitat ${koalaN.toLocaleString()}`)

    if (DRY) { log('\n--dry-run: nothing written.'); return }

    await client.query('BEGIN')

    // ── the two slices, as views ─────────────────────────────────────────────────────────────────
    // views, not copies: the cdc schema's own rule, and it means the next data pack moves these with it
    // rather than leaving two stale tables behind
    await client.query(`
      CREATE OR REPLACE VIEW esa.aobv AS
      SELECT objectid, boset_class, bv_category, verdate, area_geo, geom
      FROM ${TABLE} WHERE boset_class = $$${AOBV}$$`)
    await client.query(`COMMENT ON VIEW esa.aobv IS $c$${AOBV_NOTE}$c$`)

    // On the CDC side this is the CRITICAL HABITAT layer, not a second layer beside it. Clause
    // 1.17A(1)(b) is "land that is critical habitat" and 1.17A(1)(e)(j) is "critical habitat under the
    // Threatened Species Conservation Act 1995", and the Department's own workbook note says declared
    // TSC Act critical habitat became the first Areas of Outstanding Biodiversity Value. So the AOBV
    // slice IS the dataset those two clauses want, and carrying a separate `aobv` layer next to a
    // `critical_habitat` gap would show a reader two rows for one test - one of them falsely empty.
    // (/esa keeps the name AOBV, because Codes SEPP cl 3.3(j) names AOBV literally.)
    await client.query('DROP VIEW IF EXISTS cdc.aobv')
    await client.query(`
      CREATE OR REPLACE VIEW cdc.critical_habitat AS
      SELECT objectid::bigint AS id,
             'Declared Area of Outstanding Biodiversity Value'::text AS name,
             bv_category::text AS class,
             geom
      FROM ${TABLE} WHERE boset_class = $$${AOBV}$$`)
    await client.query(`COMMENT ON VIEW cdc.critical_habitat IS $c$${CRITICAL_HABITAT_NOTE}$c$`)

    await client.query(`
      CREATE OR REPLACE VIEW cdc.koala_core_habitat AS
      SELECT objectid::bigint AS id,
             'Core habitat in an approved Koala Plan of Management'::text AS name,
             bv_category::text AS class,
             geom
      FROM ${TABLE} WHERE boset_class = $$${KOALA}$$`)
    await client.query(`COMMENT ON VIEW cdc.koala_core_habitat IS $c$Core koala habitat within an approved `
      + `Koala Plan of Management, from the ${SOURCE} (${koalaN.toLocaleString()} polygons, 215 km2). `
      + `The cdc schema already carries koala_habitat (57) and koala_corridor (17) from the EPI local provisions `
      + `and special provisions maps for the same clause 1.19(1)(e)(iii); this is a far larger reading of the same `
      + `test and the two have not yet been reconciled. Do not apply both as if they were independent.$c$`)

    // ── /esa: the clause 3.3 registry ────────────────────────────────────────────────────────────
    const aobvUpd = await client.query(`
      UPDATE esa.clause33_layers
      SET table_name = 'esa.aobv', provenance = 'download', source = $1,
          source_count = $2, row_count = $2,
          invalid_geoms = (SELECT count(*) FROM esa.aobv WHERE NOT ST_IsValid(geom)),
          verified = true, note = $3, built_at = now()
      WHERE key = 'areas_of_outstanding_biodiversity_value'`, [SOURCE, aobvN, AOBV_NOTE])


/**
 * The /esa side of the same point, which the first pass missed.
 *
 * Clause 3.3(j) lists "critical habitat declared under the Biodiversity Conservation Act" and "declared
 * areas of outstanding biodiversity value" as separate items, and esa.clause33_layers carries a row for
 * each. But under the BC Act 2016 there is no critical habitat register: the Threatened Species
 * Conservation Act 1995 declarations were carried over and became the first AOBVs, and no new critical
 * habitat has been declared since. So the two items are the same register under two names, and the AOBV
 * polygons answer both.
 *
 * Leaving the critical habitat row as a gap said "no dataset, check the register by hand" right beside a
 * row holding the very polygons that register contains - the same two-rows-for-one-test problem that was
 * fixed on /cdc-map. /esa is organised by the clause's own items rather than by layer, so the row stays
 * as an item; it just stops claiming to be empty.
 */
    const chEsaUpd = await client.query(`
      UPDATE esa.clause33_layers
      SET table_name = 'esa.aobv', provenance = 'download', source = $1,
          source_count = $2, row_count = $2,
          invalid_geoms = (SELECT count(*) FROM esa.aobv WHERE NOT ST_IsValid(geom)),
          verified = true, note = $3, built_at = now()
      WHERE key = 'critical_habitat_register'`, [SOURCE, aobvN, CRITICAL_HABITAT_ESA_NOTE])

    const bvUpd = await client.query(`
      UPDATE esa.clause33_layers
      SET table_name = $1, provenance = 'download', source = $2,
          source_count = $3, row_count = $3,
          invalid_geoms = (SELECT count(*) FROM ${TABLE} WHERE NOT ST_IsValid(geom)),
          verified = true, note = $4, built_at = now()
      WHERE key = 'biodiversity_values'`, [TABLE, SOURCE, total, BV_NOTE])

    // ── /cdc-map: the layer catalogue the verdict sweep and the tile build both read ─────────────
    // cdc.layers is hand-maintained since its builder was lost, so these rows live here rather than in
    // a registry elsewhere: /api/cdc/at builds `FROM cdc."<key>"` for every row with features > 0, and
    // build-cdc-pmtiles.py tiles the same list, so one insert reaches the verdict and the map together.
    await client.query("DELETE FROM cdc.layers WHERE key IN ('aobv', 'koala_core_habitat')")
    await client.query(`
      INSERT INTO cdc.layers (key, title, grp, grp_title, grp_order, clauses, column_tested, note, kind,
                              source_kind, source, filter, srid, geom_type, features, checked_at)
      VALUES
        ('koala_core_habitat', 'Koala core habitat (approved KPoM)', 'nature', 'Nature and biodiversity', 1,
         ARRAY['1.19(1)(e)(iii)'], NULL, $1, 'context',
         'view', '${TABLE}', $2, 4283, 'MultiPolygon', $3, now())`,
    [KOALA_CDC_NOTE, `boset_class = '${KOALA}'`, koalaN])

    // critical_habitat was a gap row with no table; it now has one, so it is UPDATED rather than
    // duplicated - the key, the title and the clause list the workbook gave it all stay put
    const chUpd = await client.query(`
      UPDATE cdc.layers
      SET title = 'Critical habitat (Area of Outstanding Biodiversity Value)',
          source_kind = 'view', source = '${TABLE}', filter = $1,
          srid = 4283, geom_type = 'MultiPolygon', features = $2,
          note = $3, checked_at = now()
      WHERE key = 'critical_habitat'`, [`boset_class = '${AOBV}'`, aobvN, CRITICAL_HABITAT_NOTE])

    await client.query('COMMIT')

    log('')
    log(`esa.aobv                 ${aobvN} polygons  (clause 3.3(j) - 1 of the 4 register entries mapped)`)
    log(`cdc.critical_habitat     ${aobvN} polygons  (CDC 1.17A(1)(b), 1.17A(1)(e)(j)) - was a gap, now partial`)
    log(`cdc.koala_core_habitat   ${koalaN.toLocaleString()} polygons  (CDC 1.19(1)(e)(iii), as CONTEXT - see the note)`)
    log(`esa.clause33_layers      ${aobvUpd.rowCount} AOBV, ${chEsaUpd.rowCount} critical habitat, ${bvUpd.rowCount} biodiversity_values rows updated`)
    log(`cdc.layers               1 row inserted, ${chUpd.rowCount} critical_habitat row filled in`)
    log('')
    log('Still to do:')
    log('  · re-run scripts/build-esa-layers.mjs so esa.layers picks the two rows up')
    log('  · rebuild the esa33 and cdc-nature PMTiles archives on the host')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

await main()
