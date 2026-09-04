/**
 * Sample the sections that produced no propositions despite carrying
 * substantial text — the silent recall gap. Read-only.
 *
 * Usage: node scripts/kg-recall-gaps.mjs [doc_type]
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const docType = (process.argv[2] || 'dcp').toLowerCase()
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 180_000 })
const q = async (sql, p) => (await pool.query(sql, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  // Are the gaps concentrated at particular heading levels? A level that
  // fails wholesale points at the section tree, not the extractor.
  L(`empty-but-substantial sections by level (${docType}):`)
  const byLevel = await q(`
    SELECT s.level,
           count(*)::int AS sections,
           count(*) FILTER (WHERE p.n = 0 AND length(s.raw_text) > 200)::int AS empty_substantial
    FROM nsw.section s
    JOIN nsw.document d ON d.id = s.document_id
    LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM nsw.proposition x WHERE x.section_id = s.id) p ON true
    WHERE d.doc_type = $1
    GROUP BY 1 ORDER BY 3 DESC`, [docType])
  for (const r of byLevel) {
    const pc = r.sections ? (100 * r.empty_substantial / r.sections).toFixed(0) : '0'
    L(`  ${String(r.level).padEnd(12)} ${String(r.sections).padStart(6)} sections, `
      + `${String(r.empty_substantial).padStart(5)} empty w/ text (${pc}%)`)
  }

  L(`\nsample of missed ${docType} sections (heading — first 90 chars of text):`)
  const sample = await q(`
    SELECT d.title AS doc, s.local_id, s.heading, length(s.raw_text) AS len,
           left(regexp_replace(s.raw_text, '\\s+', ' ', 'g'), 90) AS snippet
    FROM nsw.section s
    JOIN nsw.document d ON d.id = s.document_id
    LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM nsw.proposition x WHERE x.section_id = s.id) p ON true
    WHERE d.doc_type = $1 AND p.n = 0 AND length(s.raw_text) > 400
    ORDER BY length(s.raw_text) DESC
    LIMIT 12`, [docType])
  for (const r of sample) {
    L(`  [${String(r.len).padStart(5)} ch] ${String(r.heading ?? r.local_id).slice(0, 40).padEnd(41)} ${r.snippet}`)
  }

  // How many carry an obvious numeric control that was never captured?
  L('\nmissed sections whose text contains a comparator + unit (an obvious control):')
  const numeric = await q(`
    SELECT d.doc_type, count(*)::int AS n
    FROM nsw.section s
    JOIN nsw.document d ON d.id = s.document_id
    LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM nsw.proposition x WHERE x.section_id = s.id) p ON true
    WHERE p.n = 0 AND length(s.raw_text) > 200
      AND s.raw_text ~* '(minimum|maximum|not exceed|at least|no less than|not less than)'
      AND s.raw_text ~* '([0-9]+(\\.[0-9]+)?\\s*(m|mm|metres|metre|m2|sqm|square metres|%|storeys|degrees))'
    GROUP BY 1 ORDER BY 2 DESC`)
  for (const r of numeric) L(`  ${r.doc_type.padEnd(6)} ${String(r.n).padStart(6)} sections`)
  L('\n  ^ these are the clearest misses: a control is stated in the text and')
  L('    nothing at all was extracted from that section.')

  // Does extraction fail because sections are too large? An oversized
  // section means the section tree cut the document badly, not that the
  // extractor is weak.
  L('\nextraction success vs section size (all doc types):')
  const bySize = await q(`
    SELECT CASE
             WHEN length(s.raw_text) < 500   THEN '1. <500'
             WHEN length(s.raw_text) < 2000  THEN '2. 500-2k'
             WHEN length(s.raw_text) < 8000  THEN '3. 2k-8k'
             WHEN length(s.raw_text) < 20000 THEN '4. 8k-20k'
             ELSE '5. >20k'
           END AS bucket,
           count(*)::int AS sections,
           count(*) FILTER (WHERE p.n = 0)::int AS empty,
           round(avg(p.n)::numeric, 2) AS avg_props
    FROM nsw.section s
    LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM nsw.proposition x WHERE x.section_id = s.id) p ON true
    WHERE length(s.raw_text) > 200
    GROUP BY 1 ORDER BY 1`)
  L(`  ${'size'.padEnd(11)} ${'sections'.padStart(9)} ${'empty'.padStart(8)} ${'avg props'.padStart(10)}`)
  for (const r of bySize) {
    const pc = r.sections ? (100 * r.empty / r.sections).toFixed(0) + '%' : '–'
    L(`  ${r.bucket.padEnd(11)} ${String(r.sections).padStart(9)} ${String(r.empty).padStart(6)} (${pc.padStart(4)}) ${String(r.avg_props).padStart(8)}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
