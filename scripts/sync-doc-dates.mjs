/**
 * Bring `nsw.document`'s dates back in line with the instrument manifests,
 * without re-running an ingest.
 *
 *   node scripts/sync-doc-dates.mjs              # report the diff, change nothing
 *   node scripts/sync-doc-dates.mjs --apply
 *   node scripts/sync-doc-dates.mjs --apply --only hornsby
 *
 * The ingest is the normal way these fields are written. But an ingest tears
 * the document down and rebuilds every rule, effect and finding under it —
 * thousands of rows for a 43-part DCP — which is far too much machinery to
 * move a date, and cannot be run at all while someone else is working on that
 * document's extraction. These five columns are pure manifest facts and
 * nothing else in the graph depends on them, so they can be set on their own.
 *
 * Manifest-driven, so this and `ingest-dcp.ts` cannot disagree: both call
 * `resolveManifestDates`. Running one after the other is a no-op.
 *
 * Requires db/nsw-schema-migration-10-currency-and-commencement.sql.
 */

import 'dotenv/config'
import pg from 'pg'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { resolveManifestDates } from './lib/manifest-dates.mjs'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const onlyAt = argv.indexOf('--only')
const only = (onlyAt >= 0 ? argv[onlyAt + 1] || '' : '').toLowerCase()
const dir = path.join(process.cwd(), 'public', 'EPI', 'DCPs', 'manifests')

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const manifests = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: path.join(dir, f), json: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) }))
  .filter(({ json }) => !only || String(json.instrument || '').toLowerCase().includes(only))

if (!manifests.length) {
  process.stderr.write(`No manifests matched${only ? ` --only ${only}` : ''} in ${dir}\n`)
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()

// Checked up front rather than letting a bare 42703 out of the first SELECT:
// "column commenced_date does not exist" three frames deep in node-postgres
// does not tell you which migration to run.
const { rows: [has] } = await client.query(`
  SELECT count(*)::int AS n FROM information_schema.columns
   WHERE table_schema = 'nsw' AND table_name = 'document'
     AND column_name IN ('commenced_date','currency_basis','savings_provision','pending_parts')`)
if (has.n < 4) {
  await client.end()
  process.stderr.write(
    'nsw.document is missing the currency columns. Apply the migration first:\n'
    + '  node scripts/apply-migration.mjs nsw-schema-migration-10-currency-and-commencement.sql\n')
  process.exit(1)
}

let changed = 0
let missing = 0
try {
  for (const { file, json } of manifests) {
    const slug = json.instrument
    const d = resolveManifestDates(json, path.basename(file))

    // ::text, not the DATE. node-postgres parses a DATE into a JS Date at the
    // process's local midnight, and comparing that against a "YYYY-MM-DD"
    // string from the manifest would report a difference on every row.
    const { rows: [row] } = await client.query(
      `SELECT title, as_at_date::text AS as_at_date, commenced_date::text AS commenced_date,
              currency_basis, savings_provision, pending_parts
         FROM nsw.document WHERE instrument_slug = $1`, [slug])

    if (!row) {
      process.stdout.write(`— ${slug}: not ingested, nothing to sync\n`)
      missing++
      continue
    }

    const diffs = []
    if (row.as_at_date !== d.asAt) diffs.push(['as_at_date', row.as_at_date, d.asAt])
    if (row.commenced_date !== d.commenced) diffs.push(['commenced_date', row.commenced_date, d.commenced])
    if (row.currency_basis !== d.basis) diffs.push(['currency_basis', abbr(row.currency_basis), abbr(d.basis)])
    if (row.savings_provision !== d.savingsProvision) diffs.push(['savings_provision', abbr(row.savings_provision), abbr(d.savingsProvision)])
    if (String(row.pending_parts ?? '') !== String(d.pendingParts ?? '')) {
      diffs.push(['pending_parts', abbr(row.pending_parts?.join(', ')), abbr(d.pendingParts?.join(', '))])
    }

    process.stdout.write(`\n${slug} — ${row.title}\n`)
    if (!diffs.length) { process.stdout.write('  already in sync\n'); continue }
    for (const [col, was, now] of diffs) {
      process.stdout.write(`  ${col.padEnd(18)} ${String(was ?? '—')}\n${' '.repeat(21)}→ ${String(now ?? '—')}\n`)
    }
    changed++

    if (apply) {
      await client.query(
        `UPDATE nsw.document
            SET as_at_date = $2, commenced_date = $3, currency_basis = $4,
                savings_provision = $5, pending_parts = $6
          WHERE instrument_slug = $1`,
        [slug, d.asAt, d.commenced, d.basis, d.savingsProvision, d.pendingParts])
      process.stdout.write('  applied\n')
    }
  }
} finally {
  await client.end()
}

process.stdout.write(
  `\n${changed} document(s) ${apply ? 'updated' : 'would change'}`
  + `${missing ? `, ${missing} not ingested` : ''}.`
  + `${changed && !apply ? ' Re-run with --apply to write.' : ''}\n`)

function abbr(s) {
  if (s == null || s === '') return null
  const t = String(s)
  return t.length > 96 ? `${t.slice(0, 93)}…` : t
}
