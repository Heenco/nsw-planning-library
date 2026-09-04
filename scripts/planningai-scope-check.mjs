/**
 * How much rule scope is already knowable from structure alone?
 *
 * A DCP applies to its council area by default, and its Parts and clause
 * headings name the development they govern. None of that needs a model —
 * it is in `document.lga_name`, `section.source_file` (the Part) and the
 * clause heading. Read-only.
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.DATABASE_URL || '').trim()
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  L('the document already states its own area of application:')
  for (const r of await q(`
    SELECT doc_type, title, lga_name, scope, hierarchy_level FROM nsw.document ORDER BY doc_type`)) {
    L(`  ${r.doc_type.padEnd(4)} lga=${String(r.lga_name).padEnd(10)} scope=${r.scope}  ${r.title.slice(0, 40)}`)
  }

  L('\nParts — each names the development it governs:')
  for (const r of await q(`
    SELECT DISTINCT s.source_file AS part, count(*)::int AS sections
    FROM nsw.section s JOIN nsw.document d ON d.id=s.document_id
    WHERE d.doc_type='dcp' AND s.source_file IS NOT NULL
    GROUP BY 1 ORDER BY 1`)) {
    L(`  ${String(r.part).slice(0, 52).padEnd(53)} ${String(r.sections).padStart(5)} sections`)
  }

  L('\ntop-level clause headings — these name land uses and development types:')
  for (const r of await q(`
    SELECT s.number, s.heading
    FROM nsw.section s JOIN nsw.document d ON d.id=s.document_id
    WHERE d.doc_type='dcp' AND s.level='clause' AND s.number ~ '^[0-9]+\\.[0-9]+$'
    ORDER BY string_to_array(s.number,'.')::int[] LIMIT 22`)) {
    L(`  ${String(r.number).padEnd(8)} ${String(r.heading ?? '').slice(0, 60)}`)
  }

  L('\ntable headers already carry size bands and sub-scopes:')
  for (const r of await q(`
    SELECT DISTINCT split_part(source_span, ' | ', 2) AS col
    FROM nsw.rule_effect
    WHERE source_span LIKE '% | % | %' AND split_part(source_span,' | ',2) <> ''
    ORDER BY 1 LIMIT 14`)) {
    L(`  ${String(r.col).slice(0, 64)}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
