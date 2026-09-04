/**
 * What spatial and precedence capability does the KG actually have?
 * Read-only reconnaissance for the query-layer design.
 *
 * Usage: node scripts/kg-spatial-check.mjs
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  const ext = await q(`SELECT extname, extversion FROM pg_extension ORDER BY extname`)
  L('extensions: ' + ext.map((e) => `${e.extname}@${e.extversion}`).join(', '))

  const geo = await q(`
    SELECT f_table_schema AS s, f_table_name AS t, f_geometry_column AS col, type, srid
    FROM geometry_columns ORDER BY 1, 2`).catch(() => [])
  L(`\ngeometry columns: ${geo.length}`)
  for (const g of geo.slice(0, 15)) L(`  ${g.s}.${g.t}.${g.col}  ${g.type} srid=${g.srid}`)

  // The property table is the spatial anchor — what can it bind rules to?
  const cols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='nsw' AND table_name='up_property_comprehensive'
    ORDER BY ordinal_position`)
  L(`\nup_property_comprehensive: ${cols.length} columns`)
  L('  ' + cols.map((c) => c.column_name).join(', ').slice(0, 900))

  // Can the graph express precedence at all?
  L('\nedge types present:')
  const et = await q(`SELECT type, count(*)::int AS n FROM nsw.edge GROUP BY 1 ORDER BY 2 DESC`)
  for (const r of et) L(`  ${String(r.type).padEnd(14)} ${String(r.n).padStart(7)}`)
  const kinds = new Set(et.map((r) => r.type))
  const missing = ['overrides', 'prevails_over', 'disapplies', 'excepts', 'varies']
    .filter((k) => !kinds.has(k))
  L(`\n  precedence edge types absent: ${missing.join(', ') || '(none — all present)'}`)

  // How many propositions defer their value to a map?
  const vs = await q(`
    SELECT value_source, count(*)::int AS n FROM nsw.proposition
    WHERE value_source IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)
  L(`\nmap-deferred values (value_source), top 10 of ${vs.length}:`)
  for (const r of vs) L(`  ${String(r.n).padStart(4)}  ${String(r.value_source).slice(0, 70)}`)
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
