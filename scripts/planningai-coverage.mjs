/**
 * Is the DCP's content actually captured?
 *
 * "Sections with no rule of their own" is the wrong question here: a rule
 * attaches to a clause, and the clause's child blocks ("Height", "Floor
 * Space Ratio") feed that rule rather than owning one. A section is covered
 * if it, or any ancestor, carries a rule.
 *
 * Read-only.
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 180_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '-'

try {
  // local_id is a dotted path (dcp.4.2.1.height), so ancestry is a prefix
  // test — no recursive CTE needed.
  const rows = await q(`
    WITH sec AS (
      SELECT s.id, s.local_id, s.heading, s.level, length(s.raw_text) AS len,
             (SELECT count(*)::int FROM nsw.rule r WHERE r.section_id = s.id) AS own_rules
      FROM nsw.section s
      JOIN nsw.document d ON d.id = s.document_id
      WHERE d.doc_type = 'dcp'
    ),
    ruled AS (SELECT local_id FROM sec WHERE own_rules > 0)
    SELECT s.local_id, s.heading, s.level, s.len, s.own_rules,
           EXISTS (SELECT 1 FROM ruled r
                   WHERE s.local_id = r.local_id
                      OR s.local_id LIKE r.local_id || '.%') AS covered
    FROM sec s WHERE s.len > 200`)

  const covered = rows.filter((r) => r.covered).length
  L(`substantial DCP sections (>200 chars): ${rows.length}`)
  L(`  covered by a rule (own or ancestor): ${covered}  (${pct(covered, rows.length)})`)
  L(`  NOT covered                        : ${rows.length - covered}  (${pct(rows.length - covered, rows.length)})`)
  L(`\n  legacy kg: 27.5% of substantial DCP sections produced nothing at all`)

  const byLevel = {}
  for (const r of rows.filter((x) => !x.covered)) {
    byLevel[r.level] = (byLevel[r.level] ?? 0) + 1
  }
  L(`\nuncovered by section level: ${JSON.stringify(byLevel)}`)

  L('\nlargest uncovered sections — is real content being missed?')
  for (const r of rows.filter((x) => !x.covered).sort((a, b) => b.len - a.len).slice(0, 12)) {
    L(`  [${String(r.len).padStart(5)} ch] ${String(r.local_id).slice(0, 34).padEnd(35)} ${String(r.heading ?? '').slice(0, 40)}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
