/**
 * Take the heritage conservation areas out of `cdc.heritage_items`.
 *
 *   node scripts/fix-cdc-heritage-items.mjs [--dry-run]
 *
 * THE BUG
 *
 * cdc.heritage_items was an unfiltered `SELECT ... FROM epi.epi_heritage`, and that table holds both
 * things: 39,217 heritage items and 1,123 heritage conservation areas, told apart only by lay_class.
 * So every lot inside a conservation area was reported as CONTAINING A HERITAGE ITEM.
 *
 * That is not a cosmetic mislabel. Clause 1.17A(1)(d) bars complying development on a heritage item,
 * and 1.17A is a general prerequisite - it rules out every certificate type at once. 6 Killaloe Avenue,
 * Pennant Hills sits in the Beecroft/Cheltenham Heritage Conservation Area and has no heritage item on
 * it at all, and every one of the eleven development types was being ruled out on a heritage item that
 * does not exist.
 *
 * A heritage item and a conservation area are different tests with different consequences, and the
 * schema already keeps them apart everywhere else: cdc.heritage_conservation_areas reads
 * lmr.epi_heritage_conservation_areas, which is the same source correctly filtered.
 *
 * THE FIX also gives the layer a usable name. `lay_name` is the literal string "Heritage" on every row,
 * which is why a hit read "Heritage items (EPI) - Heritage" and said nothing. h_name carries the item's
 * own name.
 *
 * This is a correction to the cdc schema, whose builder was lost, so it lives here as a script rather
 * than as an edit to a registry that no longer exists.
 */

import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')
const HCA = "lay_class ILIKE '%Conservation Area%'"

const NOTE =
  'Heritage items from the LEP and SEPP heritage maps. EXCLUDES conservation areas: epi.epi_heritage '
  + 'holds both, told apart only by lay_class, and an unfiltered view reported every lot in a '
  + 'conservation area as containing a heritage item - an exclusion under clause 1.17A(1)(d), which is a '
  + 'general prerequisite and ruled out every certificate type. The conservation areas are their own '
  + 'layer, cdc.heritage_conservation_areas. Note the source also includes Aboriginal place and object '
  + 'rows and "Local Heritage - General", which are not heritage items by the Standard Instrument '
  + 'definition, so this layer is still slightly wider than the clause.'

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
  const client = new pg.Client({ connectionString: dsn, statement_timeout: 300_000 })
  await client.connect()
  const log = s => process.stdout.write(s + '\n')

  try {
    const before = await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${HCA})::int AS conservation_areas
      FROM epi.epi_heritage`)
    const b = before.rows[0]
    log(`epi.epi_heritage: ${b.total.toLocaleString()} rows, of which `
      + `${b.conservation_areas.toLocaleString()} are conservation areas`)

    const wrong = await client.query(
      `SELECT count(*)::int AS n FROM cdc.heritage_items WHERE class ILIKE '%Conservation Area%'`)
    log(`cdc.heritage_items currently carries ${wrong.rows[0].n.toLocaleString()} of them`)
    if (!wrong.rows[0].n) { log('\nNothing to fix - the view is already filtered.'); return }

    if (DRY) { log('\n--dry-run: nothing written.'); return }

    await client.query('BEGIN')
    await client.query(`
      CREATE OR REPLACE VIEW cdc.heritage_items AS
      SELECT objectid::bigint AS id,
             -- lay_name is the literal "Heritage" on every row; h_name is the item's own name
             coalesce(nullif(h_name, ''), lay_class)::text AS name,
             lay_class::text AS class,
             geom
      FROM epi.epi_heritage
      WHERE lay_class NOT ILIKE '%Conservation Area%'`)
    await client.query(`COMMENT ON VIEW cdc.heritage_items IS $c$${NOTE}$c$`)

    const after = await client.query('SELECT count(*)::int AS n FROM cdc.heritage_items')
    await client.query(`
      UPDATE cdc.layers
      SET features = $1, filter = $2, note = $3, checked_at = now()
      WHERE key = 'heritage_items'`, [after.rows[0].n, "lay_class NOT ILIKE '%Conservation Area%'", NOTE])
    await client.query('COMMIT')

    log(`\ncdc.heritage_items: ${b.total.toLocaleString()} -> ${after.rows[0].n.toLocaleString()} rows`)
    log('cdc.layers updated with the filter, the count and why it is there.')
    log('\nRebuild the cdc "heritage" tile group so the map matches the verdict.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

await main()
