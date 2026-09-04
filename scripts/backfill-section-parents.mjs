/**
 * Link `nsw.section.parent_id` from the `local_id` prefix, for every document.
 *
 * The hierarchy has always been in the ids — `dcp.3.1.2` sits under
 * `dcp.3.1`, `dcp.3.1.2.desired_outcome` under `dcp.3.1.2` — but nothing
 * ever wrote the foreign key, so every coverage and inheritance query walked
 * strings with LIKE instead. `ingest-dcp.ts` now does this inline; this
 * script covers documents loaded by other paths (the LEP came in from the
 * pilot's SQLite) and is safe to re-run.
 *
 *   node scripts/backfill-section-parents.mjs [--dry-run]
 */

import 'dotenv/config'
import pg from 'pg'

const dryRun = process.argv.includes('--dry-run')
const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const client = new pg.Client({ connectionString: url, statement_timeout: 300_000 })
await client.connect()
const L = (s = '') => process.stdout.write(s + '\n')

try {
  await client.query('BEGIN')

  const { rows: before } = await client.query(`
    SELECT d.doc_type, d.title, count(*)::int n, count(s.parent_id)::int linked
    FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id
    GROUP BY 1,2 ORDER BY 1`)

  // A parent is the id with its last dot-segment removed, within the same
  // document. Matching across documents would be wrong even when the local
  // ids collide, which for 'dcp.…' and 'lep.…' they do not — but two
  // ingests of the same DCP would.
  const { rowCount } = await client.query(`
    UPDATE nsw.section c SET parent_id = p.id
    FROM nsw.section p
    WHERE c.document_id = p.document_id
      AND c.local_id LIKE '%.%'
      AND c.parent_id IS DISTINCT FROM p.id
      AND p.local_id = left(c.local_id, length(c.local_id) - position('.' in reverse(c.local_id)))`)

  const { rows: after } = await client.query(`
    SELECT d.doc_type, count(*)::int n, count(s.parent_id)::int linked
    FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id
    GROUP BY 1 ORDER BY 1`)

  // A cycle would make every recursive query hang; the prefix rule cannot
  // produce one, so this is a cheap assertion rather than a real risk.
  const { rows: [{ self }] } = await client.query(
    `SELECT count(*)::int self FROM nsw.section WHERE parent_id = id`)
  if (self > 0) throw new Error(`${self} sections are their own parent`)

  L('before:')
  for (const r of before) {
    L(`  ${r.doc_type.padEnd(4)} ${String(r.linked).padStart(5)}/${String(r.n).padEnd(5)} ${r.title.slice(0, 46)}`)
  }
  L(`\nrows linked this run: ${rowCount}`)
  L('\nafter:')
  for (const r of after) {
    const orphans = r.n - r.linked
    L(`  ${r.doc_type.padEnd(4)} ${String(r.linked).padStart(5)}/${String(r.n).padEnd(5)}`
      + `  ${orphans} top-level (no dot-parent) — expected`)
  }

  if (dryRun) { await client.query('ROLLBACK'); L('\nDRY RUN — rolled back.') }
  else { await client.query('COMMIT'); L('\nCOMMITTED.') }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
