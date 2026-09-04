/**
 * Inventory of the NSW knowledge graph.
 *
 * Reads DATABASE_URL from .env and reports what is actually in the `nsw`
 * schema: which documents are ingested, how far each got through the
 * pipeline (sections → propositions → edges → embeddings), and what the
 * connecting role is allowed to do.
 *
 * Read-only: every statement here is a SELECT.
 *
 * Usage: node scripts/kg-inventory.mjs
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!url) {
  process.stderr.write('DATABASE_URL is not set (see .env).\n')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 60_000 })

const q = async (sql, params) => (await pool.query(sql, params)).rows
const line = (s = '') => process.stdout.write(s + '\n')

try {
  const [{ db, usr, ver }] = await q(
    `SELECT current_database() AS db, current_user AS usr, version() AS ver`,
  )
  line(`connected: ${usr}@${db}`)
  line(`server:    ${String(ver).split(',')[0]}`)

  // ── privileges: the role is named nsw_reader, so confirm before assuming
  //    the ingest can write ──────────────────────────────────────────────
  const priv = await q(`
    SELECT
      has_schema_privilege(current_user, 'nsw', 'USAGE')  AS use_nsw,
      has_schema_privilege(current_user, 'nsw', 'CREATE') AS create_nsw,
      has_table_privilege(current_user, 'nsw.document', 'SELECT') AS sel,
      has_table_privilege(current_user, 'nsw.document', 'INSERT') AS ins,
      has_table_privilege(current_user, 'nsw.document', 'UPDATE') AS upd,
      has_table_privilege(current_user, 'nsw.document', 'DELETE') AS del
  `).catch(() => [])
  if (priv.length) {
    const p = priv[0]
    line(`grants:    select=${p.sel} insert=${p.ins} update=${p.upd} delete=${p.del} `
      + `| schema usage=${p.use_nsw} create=${p.create_nsw}`)
  }

  // ── schemas and table sizes ──────────────────────────────────────────
  const schemas = await q(`
    SELECT table_schema AS s, count(*)::int AS tables
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
    GROUP BY 1 ORDER BY 2 DESC
  `)
  line('\nschemas:')
  for (const r of schemas) line(`  ${String(r.s).padEnd(22)} ${String(r.tables).padStart(4)} tables`)

  const tables = await q(`
    SELECT c.relname AS t, s.n_live_tup::bigint AS rows,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'nsw' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
  `)
  line('\nnsw schema tables (row estimates):')
  for (const r of tables) {
    line(`  ${String(r.t).padEnd(24)} ${String(r.rows ?? '?').padStart(10)}  ${r.size}`)
  }

  // ── documents and pipeline progress per document ─────────────────────
  const docs = await q(`
    SELECT d.id, d.title, d.doc_type, d.lga_name, d.as_at_date,
           d.prop_count, d.edge_count, d.ingested_at,
           (SELECT count(*) FROM nsw.section  s WHERE s.document_id = d.id)::int AS sections
    FROM nsw.document d
    ORDER BY d.doc_type, d.title
  `).catch((e) => { line('\n(could not read nsw.document: ' + e.message + ')'); return [] })

  if (docs.length) {
    line(`\ndocuments ingested: ${docs.length}`)
    line(`  ${'type'.padEnd(5)} ${'title'.padEnd(52)} ${'sections'.padStart(8)} ${'props'.padStart(8)} ${'edges'.padStart(7)}  as-at`)
    for (const d of docs) {
      line(`  ${String(d.doc_type).padEnd(5)} ${String(d.title).slice(0, 51).padEnd(52)} `
        + `${String(d.sections).padStart(8)} ${String(d.prop_count).padStart(8)} `
        + `${String(d.edge_count).padStart(7)}  ${String(d.as_at_date).slice(0, 10)}`)
    }
  }

  // ── proposition mix: what kinds of knowledge are actually captured ───
  const byType = await q(`
    SELECT type, count(*)::int AS n,
           count(*) FILTER (WHERE numeric_value IS NOT NULL)::int AS with_number,
           count(*) FILTER (WHERE verification_status = 'verified')::int AS verified,
           count(*) FILTER (WHERE verification_status = 'flagged')::int  AS flagged
    FROM nsw.proposition GROUP BY 1 ORDER BY 2 DESC
  `).catch(() => [])
  if (byType.length) {
    line('\npropositions by type:')
    line(`  ${'type'.padEnd(14)} ${'count'.padStart(8)} ${'numeric'.padStart(8)} ${'verified'.padStart(9)} ${'flagged'.padStart(8)}`)
    for (const r of byType) {
      line(`  ${String(r.type).padEnd(14)} ${String(r.n).padStart(8)} ${String(r.with_number).padStart(8)} `
        + `${String(r.verified).padStart(9)} ${String(r.flagged).padStart(8)}`)
    }
  }

  // ── edges ────────────────────────────────────────────────────────────
  const edges = await q(`SELECT type, count(*)::int AS n FROM nsw.edge GROUP BY 1 ORDER BY 2 DESC`)
    .catch(() => [])
  if (edges.length) {
    line('\nedges by type:')
    for (const r of edges) line(`  ${String(r.type).padEnd(16)} ${String(r.n).padStart(8)}`)
  }

  // ── embeddings: how much of the graph is searchable ──────────────────
  const emb = await q(`
    SELECT count(*)::int AS total,
           count(embedding)::int AS embedded,
           count(embedding_2k)::int AS embedded_2k
    FROM nsw.proposition
  `).catch(() => [])
  if (emb.length) {
    const e = emb[0]
    const pct = (n) => e.total ? ` (${(100 * n / e.total).toFixed(1)}%)` : ''
    line('\nembeddings:')
    line(`  propositions      ${String(e.total).padStart(8)}`)
    line(`  embedding         ${String(e.embedded).padStart(8)}${pct(e.embedded)}`)
    line(`  embedding_2k      ${String(e.embedded_2k).padStart(8)}${pct(e.embedded_2k)}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
