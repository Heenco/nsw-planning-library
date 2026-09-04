/**
 * Create and initialise the `planningai` database.
 *
 * A clean database rather than more tables in `kg`, because the point of the
 * Hornsby pilot is to measure the new pipeline on its own terms. Mixing it
 * with the existing 22k propositions — 13.9% flagged, 27.5% of substantial
 * DCP sections empty — would make "is the new pipeline better?" unanswerable.
 *
 * Keeps the `nsw` schema name so every existing module works unchanged;
 * only the database in the connection string differs.
 *
 *   node scripts/bootstrap-planningai.mjs [--dry-run] [--db planningai]
 *
 * --dry-run reports what it would do and touches nothing.
 *
 * Reads ADMIN_DATABASE_URL, falling back to DATABASE_URL, to connect to an
 * existing database (CREATE DATABASE cannot run from inside the target).
 */

import 'dotenv/config'
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const dbName = (() => {
  const i = argv.indexOf('--db')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'planningai'
})()

if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) {
  process.stderr.write(`refusing unsafe database name: ${dbName}\n`)
  process.exit(1)
}

const adminUrl = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!adminUrl) {
  process.stderr.write('ADMIN_DATABASE_URL or DATABASE_URL must be set (see .env).\n')
  process.exit(1)
}

/** The schema, in the order it must be applied. */
const FILES = [
  'nsw-schema.sql',
  'nsw-schema-migration-01-references.sql',
  'nsw-schema-migration-02-indexes.sql',
  'nsw-schema-migration-03-dcp-hotlinks.sql',
  'nsw-schema-migration-04-source-registry.sql',
  'nsw-schema-migration-05-rule-layer.sql',
]

const L = (s = '') => process.stdout.write(s + '\n')
const dbDir = path.join(process.cwd(), 'db')

for (const f of FILES) {
  if (!existsSync(path.join(dbDir, f))) {
    process.stderr.write(`missing schema file: db/${f}\n`)
    process.exit(1)
  }
}

const targetUrl = (() => {
  const u = new URL(adminUrl)
  u.pathname = `/${dbName}`
  return u.toString()
})()

const admin = new pg.Client({ connectionString: adminUrl, statement_timeout: 120_000 })
await admin.connect()

try {
  let { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
  let exists = rows.length > 0

  L(`target database : ${dbName} ${exists ? '(already exists)' : '(will be created)'}`)
  L(`schema files    : ${FILES.length}`)

  // --recreate is only allowed while the database still holds no documents,
  // so a populated pilot can never be destroyed by a stray flag.
  if (exists && argv.includes('--recreate')) {
    const probe = new pg.Client({ connectionString: targetUrl, statement_timeout: 30_000 })
    await probe.connect()
    // A database without the schema yet counts as empty, not as an error.
    const n = await probe
      .query('SELECT count(*)::int AS n FROM nsw.document')
      .then((r) => r.rows[0].n)
      .catch(() => 0)
    await probe.end().catch(() => {})
    if (n > 0) {
      process.stderr.write(`refusing to recreate ${dbName}: it holds ${n} documents.\n`)
      process.exit(1)
    }
    if (!dryRun) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName])
      await admin.query(`DROP DATABASE ${dbName}`)
      L(`dropped empty database ${dbName}`)
      exists = false
    } else {
      L(`  (dry run) would DROP DATABASE ${dbName} — it is empty`)
    }
  }

  if (dryRun) {
    L('\nDRY RUN — nothing was created. Would run:')
    if (!exists) L(`  CREATE DATABASE ${dbName}`)
    for (const f of FILES) L(`  \\i db/${f}`)
    process.exit(0)
  }

  if (!exists) {
    // CREATE DATABASE cannot run inside a transaction block, hence the
    // separate admin connection and the plain query here.
    await admin.query(`CREATE DATABASE ${dbName}`)
    L(`created database ${dbName}`)
  }
} finally {
  await admin.end().catch(() => {})
}

// ── apply the schema inside the new database ──────────────────────────
const target = new pg.Client({ connectionString: targetUrl, statement_timeout: 300_000 })
await target.connect()

try {
  for (const f of FILES) {
    const sql = readFileSync(path.join(dbDir, f), 'utf8')
    try {
      await target.query(sql)
      L(`  applied  db/${f}`)
    } catch (err) {
      process.stderr.write(`  FAILED   db/${f}: ${err.message}\n`)
      throw err
    }
  }

  const tables = await target.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'nsw' ORDER BY table_name`)
  const ext = await target.query(`SELECT extname FROM pg_extension ORDER BY extname`)

  L(`\n${dbName} ready`)
  L(`  extensions : ${ext.rows.map((r) => r.extname).join(', ')}`)
  L(`  nsw tables : ${tables.rowCount}`)
  L(`  ${tables.rows.map((r) => r.table_name).join(', ')}`)
  L(`\nPoint the app at it with:`)
  L(`  DATABASE_URL=${targetUrl.replace(/:[^:@/]+@/, ':****@')}`)
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await target.end().catch(() => {})
}
