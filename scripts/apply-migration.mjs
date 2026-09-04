/**
 * Apply an nsw schema migration over DATABASE_URL (no SSH tunnel).
 *
 *   node scripts/apply-migration.mjs <file.sql> [--dry-run]
 *
 * --dry-run executes the file inside a transaction and rolls back, so the
 * SQL is proven against the real server without changing it. Migrations
 * that carry their own BEGIN/COMMIT are rewritten to a SAVEPOINT so the
 * outer rollback still wins.
 */

import 'dotenv/config'
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const file = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!file) {
  process.stderr.write('usage: node scripts/apply-migration.mjs <file.sql> [--dry-run]\n')
  process.exit(1)
}

const full = path.isAbsolute(file) ? file : path.join(process.cwd(), 'db', file)
if (!existsSync(full)) {
  process.stderr.write(`no such migration: ${full}\n`)
  process.exit(1)
}

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

let sql = readFileSync(full, 'utf8')
if (dryRun) {
  // Strip the file's own transaction control; the wrapper supplies it.
  sql = sql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, '')
}

const client = new pg.Client({ connectionString: url, statement_timeout: 300_000 })
await client.connect()

const before = await client.query(`
  SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'nsw'`)

try {
  await client.query('BEGIN')
  await client.query(sql)

  const after = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'nsw' ORDER BY table_name`)

  process.stdout.write(`${path.basename(full)} executed cleanly\n`)
  process.stdout.write(`  nsw tables: ${before.rows[0].n} → ${after.rowCount}\n`)
  process.stdout.write(`  ${after.rows.map((r) => r.table_name).join(', ')}\n`)

  if (dryRun) {
    await client.query('ROLLBACK')
    process.stdout.write('\n  DRY RUN — rolled back, nothing changed.\n')
  } else {
    await client.query('COMMIT')
    process.stdout.write('\n  COMMITTED.\n')
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  if (err.position) {
    const pos = Number(err.position)
    process.stderr.write(`  near: ${sql.slice(Math.max(0, pos - 120), pos + 120).replace(/\s+/g, ' ')}\n`)
  }
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
