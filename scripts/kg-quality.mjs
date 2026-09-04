/**
 * Extraction-quality diagnostics for the NSW knowledge graph.
 *
 * The inventory says how much was extracted; this says how good it is, and
 * where a new pipeline would have to do better. Read-only.
 *
 * Usage: node scripts/kg-quality.mjs
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 180_000 })
const q = async (sql, p) => (await pool.query(sql, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '–'

try {
  // What diagnostic columns exist at all?
  const cols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='nsw' AND table_name='proposition' ORDER BY ordinal_position`)
  L('proposition columns:')
  L('  ' + cols.map((c) => c.column_name).join(', '))

  const has = (c) => cols.some((x) => x.column_name === c)

  // ── flagged rate per document ────────────────────────────────────────
  L('\nflagged rate per document (worst first, >100 props):')
  const perDoc = await q(`
    SELECT d.doc_type, d.title,
           count(p.*)::int AS props,
           count(*) FILTER (WHERE p.verification_status = 'flagged')::int AS flagged
    FROM nsw.proposition p
    JOIN nsw.section s  ON s.id = p.section_id
    JOIN nsw.document d ON d.id = s.document_id
    GROUP BY 1, 2
    HAVING count(p.*) > 100
    ORDER BY (count(*) FILTER (WHERE p.verification_status = 'flagged'))::float / count(p.*) DESC
    LIMIT 12`)
  L(`  ${'type'.padEnd(5)} ${'document'.padEnd(46)} ${'props'.padStart(6)} ${'flagged'.padStart(8)}`)
  for (const r of perDoc) {
    L(`  ${r.doc_type.padEnd(5)} ${String(r.title).slice(0, 45).padEnd(46)} `
      + `${String(r.props).padStart(6)} ${String(r.flagged).padStart(6)} (${pct(r.flagged, r.props)})`)
  }

  // ── where the thresholds live: LEP Part 4 is the hard case ───────────
  L('\nthresholds by document type, and how many are map-deferred:')
  const th = await q(`
    SELECT d.doc_type,
           count(*)::int AS thresholds,
           count(*) FILTER (WHERE p.numeric_value IS NULL)::int AS no_number,
           count(*) FILTER (WHERE p.value_source IS NOT NULL)::int AS map_deferred,
           count(*) FILTER (WHERE p.verification_status = 'flagged')::int AS flagged
    FROM nsw.proposition p
    JOIN nsw.section s  ON s.id = p.section_id
    JOIN nsw.document d ON d.id = s.document_id
    WHERE p.type = 'threshold'
    GROUP BY 1 ORDER BY 2 DESC`)
  L(`  ${'type'.padEnd(6)} ${'thresholds'.padStart(11)} ${'no number'.padStart(10)} ${'map-deferred'.padStart(13)} ${'flagged'.padStart(9)}`)
  for (const r of th) {
    L(`  ${r.doc_type.padEnd(6)} ${String(r.thresholds).padStart(11)} ${String(r.no_number).padStart(10)} `
      + `${String(r.map_deferred).padStart(13)} ${String(r.flagged).padStart(6)} (${pct(r.flagged, r.thresholds)})`)
  }

  // ── recall gap: sections that produced nothing ───────────────────────
  L('\nsections that yielded no propositions (a recall gap, or correctly empty):')
  const empty = await q(`
    SELECT d.doc_type,
           count(*)::int AS sections,
           count(*) FILTER (WHERE p.n IS NULL OR p.n = 0)::int AS empty_sections,
           count(*) FILTER (WHERE (p.n IS NULL OR p.n = 0) AND length(s.raw_text) > 200)::int AS empty_but_substantial
    FROM nsw.section s
    JOIN nsw.document d ON d.id = s.document_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n FROM nsw.proposition x WHERE x.section_id = s.id
    ) p ON true
    GROUP BY 1 ORDER BY 2 DESC`)
  L(`  ${'type'.padEnd(6)} ${'sections'.padStart(9)} ${'empty'.padStart(8)} ${'empty w/ >200 chars'.padStart(20)}`)
  for (const r of empty) {
    L(`  ${r.doc_type.padEnd(6)} ${String(r.sections).padStart(9)} ${String(r.empty_sections).padStart(6)} `
      + `(${pct(r.empty_sections, r.sections)}) ${String(r.empty_but_substantial).padStart(12)} (${pct(r.empty_but_substantial, r.sections)})`)
  }

  // ── ingest_run: does it record verification outcomes? ────────────────
  const runCols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='nsw' AND table_name='ingest_run' ORDER BY ordinal_position`)
  L('\ningest_run columns:')
  L('  ' + runCols.map((c) => c.column_name).join(', '))

  if (has('confidence')) {
    L('\nconfidence distribution:')
    const conf = await q(`
      SELECT width_bucket(confidence, 0, 1, 5) AS b, count(*)::int AS n
      FROM nsw.proposition WHERE confidence IS NOT NULL GROUP BY 1 ORDER BY 1`)
    const labels = ['0.0–0.2', '0.2–0.4', '0.4–0.6', '0.6–0.8', '0.8–1.0', '1.0']
    for (const r of conf) L(`  ${(labels[r.b - 1] ?? '?').padEnd(9)} ${String(r.n).padStart(7)}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
