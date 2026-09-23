/**
 * Give cdc.mine_subsidence its clause, and make it a condition rather than an exclusion.
 *
 *   node scripts/cdc-mine-subsidence-clause.mjs [--dry]
 *
 * WHY THIS IS A SCRIPT AND NOT AN UPDATE SOMEONE TYPED ONCE
 *
 * `cdc.layers` is the curated half of the catalogue and nothing in this repo rebuilds it, so a change
 * made by hand at a psql prompt is invisible and unrepeatable. This states the change, is idempotent,
 * and can be read later to find out why the row says what it says.
 *
 * WHAT CHANGED AND ON WHAT AUTHORITY
 *
 * The layer was `kind = 'exclusion'` with no clause, which put it on /cdc's unmapped list - "we exclude
 * on it, the workbook gives no clause that says to". The Department's Guide to Complying Development
 * (August 2023, section 2.2) supplies the clause and shows the treatment was wrong:
 *
 *   cl 1.18(1)(f)  "If located in a 'mine subsidence district', must have prior approval"
 *
 * That is an approval to obtain before the certificate issues, not land that cannot take complying
 * development. So the row becomes `kind = 'condition'` - the third value, added alongside 'exclusion'
 * and 'context' in server/api/cdc/at.get.ts - and picks up the clause.
 *
 * The 30 districts themselves are untouched: cdc.mine_subsidence is a download from the ePlanning
 * Mine_Subsidence_District service, all geometry valid, and it matches Subsidence Advisory NSW's
 * declared set.
 *
 * STILL OUTSTANDING: "07 - CDC rules" carries `mine_subsidence_district is_null` among its 35 general
 * prerequisites, which is the same mistake in the pipeline. It needs the next run to drop it.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pg = require('pg')

const DRY = process.argv.includes('--dry')
const KEY = 'mine_subsidence'
const CLAUSE = '1.18(1)(f)'
const NOTE = 'Clause 1.18(1)(f) requires prior approval from Subsidence Advisory NSW for development in '
  + 'a declared mine subsidence district. It does not exclude the land, so a hit here is a step to take, '
  + 'not a refusal. Source: Guide to Complying Development, August 2023, s2.2.'

const url = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim()
if (!url) throw new Error('No DATABASE_URL in .env')

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  const before = await client.query('SELECT key, kind, clauses, note FROM cdc.layers WHERE key = $1', [KEY])
  if (!before.rows.length) throw new Error(`cdc.layers has no row for ${KEY}`)
  console.log('before:', JSON.stringify(before.rows[0]))

  if (DRY) {
    console.log('--dry: nothing written')
  } else {
    const res = await client.query(
      `UPDATE cdc.layers
          SET kind = 'condition',
              clauses = $2::text[],
              note = $3
        WHERE key = $1
          AND (kind IS DISTINCT FROM 'condition'
               OR clauses IS DISTINCT FROM $2::text[]
               OR note IS DISTINCT FROM $3)
        RETURNING key, kind, clauses`, [KEY, [CLAUSE], NOTE])
    console.log(res.rowCount ? `updated: ${JSON.stringify(res.rows[0])}` : 'already current, nothing to do')
  }

  const tally = await client.query(`
    SELECT kind, count(*) AS layers,
           count(*) FILTER (WHERE clauses IS NULL OR cardinality(clauses) = 0) AS no_clause
    FROM cdc.layers GROUP BY 1 ORDER BY 2 DESC`)
  console.log('catalogue now:')
  for (const r of tally.rows) console.log(`  ${r.kind.padEnd(10)} ${r.layers} layers, ${r.no_clause} with no clause`)
} finally {
  await client.end()
}
