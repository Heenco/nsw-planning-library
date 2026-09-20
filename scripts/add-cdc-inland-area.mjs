/**
 * Build `cdc.inland_code_area` - the land clause 3D.1(1) lets the Inland Code apply to.
 *
 *   node scripts/add-cdc-inland-area.mjs [--dry-run]
 *
 * WHY THIS HAS TO BE DERIVED RATHER THAN DOWNLOADED
 *
 * Clause 3D.1(1) of the Codes SEPP reads "Zones RU1, RU2, RU4, RU5, RU6, R1, R2, R3, R4 and R5 in
 * inland local government areas", and the instrument defines "inland local government areas" by NAMING
 * SIXTY-NINE COUNCILS. That is the whole definition. There is no Inland Code Area map - no ePlanning
 * service, nothing on SEED - unlike the Greenfield Housing Code Area, which the Department did publish
 * as a layer. So the gap was never ours to miss: the layer has to be built from the list.
 *
 * Until now /cdc-map could not evaluate the Inland Code gate at all. `cdc.land_zoning` already carries
 * clause 3D.1(1) and answers half of it - the zone - while nothing answered the other half.
 *
 * THE JOIN IS THE DANGEROUS PART, AND IT IS WHY THIS SCRIPT REFUSES RATHER THAN WARNS
 *
 * Matching the SEPP's 69 names against epi.epi_land_zoning.lga_name literally loses five of them, in
 * silence:
 *
 *   lnverell                        the list has a lower-case L where Inverell has a capital I - an OCR
 *                                   artefact in the Department's own workbook
 *   Cootamundra-Gundagai Regional   an en-dash (U+2013) in the list, a hyphen in the data
 *   Upper Hunter Shire              the SEPP adds "Shire", the data does not
 *   Glen Innes Severn Shire         likewise
 *   Warrumbungle Shire              likewise
 *   Lithgow                         and the other way round: the data adds "City", the SEPP does not
 *
 * That is about 7% of inland NSW disappearing with nothing to show for it. So the suffix comes off both
 * sides, the dash is folded and the typo is corrected - and then the script CHECKS that all 69 resolve
 * and stops if they do not. A partial gate layer is worse than none: it would quietly tell people the
 * Inland Code is unavailable on land where it applies.
 *
 * Stripping SHIRE/CITY/COUNCIL could in principle merge two real councils, so that is checked too - the
 * 130 LGA names in the zoning data stay 130 distinct after normalising.
 *
 * WHAT THE LAYER IS NOT
 *
 * It is not a local government boundary. We hold no LGA boundary polygons, so this is derived from the
 * zoning maps: its outer edge is "zoned land in those councils", not the council's legal boundary. For
 * the clause that is the right shape, because the clause only bites on those zones anyway - but do not
 * reuse it as an LGA boundary for anything else.
 */

import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')
const VIEW = 'cdc.inland_code_area'
const SOURCE = 'epi.epi_land_zoning'

/** The zones clause 3D.1(1) names. RU3 is deliberately absent - the clause does not list it. */
const ZONES = ['RU1', 'RU2', 'RU4', 'RU5', 'RU6', 'R1', 'R2', 'R3', 'R4', 'R5']

/**
 * The 69 councils, verbatim from the clause 3D.1(1) note in shared/cdc-criteria.ts, typo and all.
 * Kept as the instrument writes them so the list can be diffed against the SEPP by eye; the
 * normalising happens below rather than by editing the names here.
 */
const INLAND_LGAS = [
  'Albury City', 'Armidale Regional', 'Balranald', 'Bathurst Regional', 'Berrigan', 'Bland', 'Blayney',
  'Bogan', 'Bourke', 'Brewarrina', 'Broken Hill', 'Cabonne', 'Carrathool', 'Central Darling', 'Cobar',
  'Coolamon', 'Coonamble', 'Cootamundra–Gundagai Regional', 'Cowra', 'Dubbo Regional', 'Dungog',
  'Edward River', 'Federation', 'Forbes', 'Gilgandra', 'Glen Innes Severn Shire', 'Goulburn Mulwaree',
  'Greater Hume Shire', 'Griffith', 'Gunnedah', 'Gwydir', 'Hay', 'Hilltops', 'lnverell', 'Junee',
  'Lachlan', 'Leeton', 'Lithgow', 'Liverpool Plains', 'Lockhart', 'Mid-Western Regional', 'Moree Plains',
  'Murray River', 'Murrumbidgee', 'Muswellbrook', 'Narrabri', 'Narrandera', 'Narromine', 'Oberon',
  'Orange', 'Parkes', 'Queanbeyan-Palerang Regional', 'Singleton', 'Snowy Monaro Regional',
  'Snowy Valleys', 'Tamworth Regional', 'Temora', 'Tenterfield', 'Upper Hunter Shire',
  'Upper Lachlan Shire', 'Uralla', 'Wagga Wagga', 'Walcha', 'Walgett', 'Warren', 'Warrumbungle Shire',
  'Weddin', 'Wentworth', 'Yass Valley',
]

/**
 * How a council name is compared. "Regional", "Plains", "River" and the like stay - they distinguish
 * real councils. Only the Shire/City/Council suffix, the dash and the workbook's typo are folded.
 *
 * The SQL below must normalise the DATA side identically; the two are kept next to each other so they
 * cannot drift apart.
 */
const NORMALISE_SQL = `regexp_replace(upper(replace(lga_name, '–', '-')), ' (SHIRE|CITY|COUNCIL)$', '')`
const normalise = s => s.toUpperCase()
  .replace(/–|—/g, '-')
  .replace(/\s+/g, ' ')
  .replace(/ (SHIRE|CITY|COUNCIL)$/, '')
  .trim()
  .replace(/^LNVERELL$/, 'INVERELL')   // the workbook's lower-case L

const NOTE =
  'Land the Inland Code can apply to: clause 3D.1(1) is "Zones RU1, RU2, RU4, RU5, RU6, R1, R2, R3, R4 '
  + 'and R5 in inland local government areas", and the SEPP defines "inland local government areas" by '
  + 'naming 69 councils rather than by mapping them - there is no Inland Code Area layer published '
  + 'anywhere, so this is derived from epi.epi_land_zoning. DERIVED, NOT A BOUNDARY: we hold no LGA '
  + 'boundary polygons, so the edge of this layer is zoned land in those councils, not the councils\' '
  + 'legal boundaries; do not reuse it as an LGA boundary. The council names had to be normalised to '
  + 'join - the SEPP writes "lnverell" with a lower-case L, uses an en-dash in Cootamundra-Gundagai, and '
  + 'disagrees with the data on the Shire/City suffix in both directions - and a literal join silently '
  + 'drops five of the 69, about 7% of inland NSW. The builder now refuses to run unless all 69 resolve. '
  + 'The list itself comes from the Department workbook transcription in shared/cdc-criteria.ts, which '
  + 'the typo shows is not clean: check it against the SEPP before this decides anything, and again '
  + 'after any council amalgamation. Context, not an exclusion: it gates which code pathway is '
  + 'available, like cdc.land_zoning and cdc.greenfield_housing_code.'

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
  const client = new pg.Client({ connectionString: dsn, statement_timeout: 300_000 })
  await client.connect()
  const log = s => process.stdout.write(s + '\n')

  try {
    const wanted = INLAND_LGAS.map(normalise)
    if (new Set(wanted).size !== wanted.length) {
      throw new Error('two councils in the list normalise to the same name - the normalising is too aggressive')
    }

    // ── the data side, normalised the same way, and checked for collisions ───────────────────────
    const have = await client.query(`
      SELECT DISTINCT ${NORMALISE_SQL} AS lga, count(*) OVER () AS n
      FROM epi.epi_land_zoning WHERE lga_name <> ''`)
    const raw = await client.query(
      "SELECT count(DISTINCT lga_name) AS n FROM epi.epi_land_zoning WHERE lga_name <> ''")
    if (have.rows.length !== Number(raw.rows[0].n)) {
      throw new Error(`normalising merges councils in the data: ${raw.rows[0].n} distinct names became `
        + `${have.rows.length}. Fix NORMALISE_SQL before building anything.`)
    }
    log(`${have.rows.length} councils in ${SOURCE}, still ${have.rows.length} distinct after normalising`)

    // ── every one of the 69 must resolve, or nothing is built ────────────────────────────────────
    const haveSet = new Set(have.rows.map(r => r.lga))
    const missing = INLAND_LGAS.filter(n => !haveSet.has(normalise(n)))
    if (missing.length) {
      throw new Error(`${missing.length} of ${INLAND_LGAS.length} inland councils do not match `
        + `${SOURCE}, so the gate would be wrong for them:\n  ` + missing.join('\n  '))
    }
    log(`all ${INLAND_LGAS.length} inland councils resolve against ${SOURCE}`)

    const stats = await client.query(`
      SELECT count(*)::int AS polygons, count(DISTINCT ${NORMALISE_SQL})::int AS lgas,
             sum(ST_NPoints(geom))::bigint AS vertices
      FROM epi.epi_land_zoning
      WHERE ${NORMALISE_SQL} = ANY($1) AND sym_code = ANY($2)`, [wanted, ZONES])
    const s = stats.rows[0]
    log(`clause 3D.1(1) land: ${s.polygons.toLocaleString()} polygons across ${s.lgas} councils, `
      + `${Number(s.vertices).toLocaleString()} vertices`)
    if (s.lgas !== INLAND_LGAS.length) {
      log(`  note: ${INLAND_LGAS.length - s.lgas} of the councils have no land in those zones at all`)
    }

    if (DRY) { log('\n--dry-run: nothing written.'); return }

    await client.query('BEGIN')
    // the cdc contract: every layer is a view of id, name, class, geom. name is the council, class the
    // zone, so the popup says "TEMORA / RU1" - which is exactly the two halves of the clause
    await client.query(`
      CREATE OR REPLACE VIEW ${VIEW} AS
      SELECT objectid::bigint AS id,
             lga_name::text AS name,
             sym_code::text AS class,
             geom
      FROM ${SOURCE}
      WHERE ${NORMALISE_SQL} = ANY(ARRAY[${wanted.map(w => `'${w}'`).join(', ')}])
        AND sym_code = ANY(ARRAY[${ZONES.map(z => `'${z}'`).join(', ')}])`)
    await client.query(`COMMENT ON VIEW ${VIEW} IS $c$${NOTE}$c$`)

    await client.query("DELETE FROM cdc.layers WHERE key = 'inland_code_area'")
    await client.query(`
      INSERT INTO cdc.layers (key, title, grp, grp_title, grp_order, clauses, column_tested, note, kind,
                              source_kind, source, filter, srid, geom_type, features, checked_at)
      -- group title and order are read from the group's existing rows rather than typed again: a
      -- mismatch here splits the panel group in two without erroring
      VALUES ('inland_code_area', 'Inland Code area', 'code',
              (SELECT grp_title FROM cdc.layers WHERE grp = 'code' LIMIT 1),
              (SELECT grp_order FROM cdc.layers WHERE grp = 'code' LIMIT 1),
              ARRAY['3D.1(1)'], NULL, $1, 'context', 'view', $2, $3, 4283, 'MultiPolygon', $4, now())`,
    [NOTE, SOURCE,
      `${INLAND_LGAS.length} named councils AND sym_code IN (${ZONES.join(', ')})`,
      s.polygons])
    await client.query('COMMIT')

    const check = await client.query(`SELECT count(*)::int AS n FROM ${VIEW}`)
    log(`\n${VIEW}: ${check.rows[0].n.toLocaleString()} polygons`)
    log(`cdc.layers: inland_code_area written (context, clause 3D.1(1), group code)`)
    log('\nNext: rebuild the cdc "code" tile group and republish, so the map can draw it.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

await main()
