/**
 * Verify the planningai database is correctly initialised.
 * Read-only unless --fix-postgis-schema is passed.
 *
 *   node scripts/planningai-check.mjs [--fix-postgis-schema]
 */

import 'dotenv/config'
import pg from 'pg'

const fix = process.argv.includes('--fix-postgis-schema')
const base = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!base) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
const url = (() => { const u = new URL(base); u.pathname = '/planningai'; return u.toString() })()

const c = new pg.Client({ connectionString: url, statement_timeout: 120_000 })
const L = (s = '') => process.stdout.write(s + '\n')
await c.connect()

try {
  const ext = await c.query(`
    SELECT e.extname, n.nspname AS schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY e.extname`)
  L('extensions and their schema:')
  for (const r of ext.rows) L(`  ${r.extname.padEnd(12)} ${r.schema}`)

  const misplaced = ext.rows.find((r) => r.extname === 'postgis' && r.schema !== 'public')
  if (misplaced) {
    L(`\n  PostGIS is in "${misplaced.schema}", not public.`)
    L('  It works while search_path includes that schema, but it ties the')
    L('  spatial types to the nsw schema\'s lifetime and surprises anyone')
    L('  querying from elsewhere.')
    if (fix) {
      await c.query('ALTER EXTENSION postgis SET SCHEMA public')
      L('  → moved to public.')
    } else {
      L('  Re-run with --fix-postgis-schema to move it.')
    }
  }

  const tables = await c.query(`
    SELECT c.relname AS t, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'nsw' AND c.relkind IN ('r','v')
    ORDER BY c.relkind, c.relname`)
  const rels = tables.rows.filter((r) => r.relkind === 'r').map((r) => r.t)
  const views = tables.rows.filter((r) => r.relkind === 'v').map((r) => r.t)
  L(`\nnsw tables (${rels.length}):`)
  L('  ' + rels.join(', '))
  if (views.length) L(`nsw views (${views.length}): ${views.join(', ')}`)

  const wanted = ['rule', 'rule_effect', 'rule_applicability', 'rule_spatial_ref',
    'rule_edge', 'rule_proposition', 'objective', 'audit_finding']
  const missing = wanted.filter((w) => !rels.includes(w))
  L(`\nrule layer: ${missing.length ? 'MISSING ' + missing.join(', ') : 'all present'}`)

  const geom = await c.query(`
    SELECT f_table_schema AS s, f_table_name AS t, f_geometry_column AS col, type, srid
    FROM geometry_columns ORDER BY 2`).catch(() => ({ rows: [] }))
  L(`\ngeometry columns: ${geom.rows.length}`)
  for (const g of geom.rows) L(`  ${g.s}.${g.t}.${g.col}  ${g.type} srid=${g.srid}`)

  const counts = await c.query(`
    SELECT (SELECT count(*) FROM nsw.document)::int    AS documents,
           (SELECT count(*) FROM nsw.section)::int     AS sections,
           (SELECT count(*) FROM nsw.proposition)::int AS propositions,
           (SELECT count(*) FROM nsw.rule)::int        AS rules`)
  L('\ncontents: ' + JSON.stringify(counts.rows[0]))
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await c.end().catch(() => {})
}
