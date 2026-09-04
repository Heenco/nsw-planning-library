/**
 * Triage the `empty_rule_source` findings.
 *
 * The finding fires when a clause or controls block has no text, lists or
 * tables of its own. Two very different causes hide behind that:
 *
 *   container  — a clause whose content genuinely lives in child clauses.
 *                Correct; no rule is owed.
 *   miss       — content exists nearby but the collector did not reach it.
 *                A real bug.
 *
 * Distinguishing them is the whole point of triage, so this reports which.
 * Read-only.
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.DATABASE_URL || '').trim()
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  const [{ n }] = await q(
    `SELECT count(*)::int n FROM nsw.audit_finding WHERE kind='empty_rule_source'`)
  L(`empty_rule_source findings: ${n}\n`)

  L('by heading (what kind of section is failing):')
  for (const r of await q(`
    SELECT value AS heading, count(*)::int n FROM nsw.audit_finding
    WHERE kind='empty_rule_source' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)) {
    L(`  ${String(r.heading).slice(0, 44).padEnd(45)} ${String(r.n).padStart(4)}`)
  }

  // For each finding, does the section have descendants that DO carry text?
  // If so, the content exists and the collector missed it.
  L('\ndoes the flagged section have content beneath it after all?')
  const rows = await q(`
    WITH f AS (
      SELECT a.clause, a.value AS heading, s.local_id, s.id AS section_id
      FROM nsw.audit_finding a
      JOIN nsw.document d ON d.id = a.document_id
      JOIN nsw.section s ON s.document_id = d.id AND s.heading = a.value AND s.number IS NOT DISTINCT FROM a.clause
      WHERE a.kind = 'empty_rule_source'
    )
    SELECT f.clause, f.heading, f.local_id,
           (SELECT count(*)::int FROM nsw.section c
             WHERE c.local_id LIKE f.local_id || '.%') AS descendants,
           (SELECT coalesce(sum(length(c.raw_text)),0)::int FROM nsw.section c
             WHERE c.local_id LIKE f.local_id || '.%') AS descendant_chars,
           (SELECT count(*)::int FROM nsw.section sib
             WHERE sib.local_id LIKE left(f.local_id, length(f.local_id) - position('.' in reverse(f.local_id))) || '.%'
               AND sib.local_id <> f.local_id
               AND length(sib.raw_text) > 100) AS siblings_with_text
    FROM f`)

  const container = rows.filter((r) => r.descendants > 0 && r.descendant_chars > 100)
  const barren = rows.filter((r) => !(r.descendants > 0 && r.descendant_chars > 100))
  const withSiblings = barren.filter((r) => r.siblings_with_text > 0)

  L(`  matched to a section        : ${rows.length}`)
  L(`  have content in descendants : ${container.length}  <- container, correctly no rule`)
  L(`  nothing beneath             : ${barren.length}`)
  L(`    ...but siblings carry text: ${withSiblings.length}  <- suspect: content is a SIBLING`)

  L('\nexamples where siblings carry the text:')
  for (const r of withSiblings.slice(0, 8)) {
    L(`  cl ${String(r.clause ?? '-').padEnd(9)} ${String(r.heading).slice(0, 26).padEnd(27)} `
      + `${String(r.local_id).slice(0, 26).padEnd(27)} siblings-with-text=${r.siblings_with_text}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
