/**
 * Are the 117 "Prescriptive Measures" findings real misses?
 *
 * Hypothesis: in the converted HTML a rubric heading and the blocks that
 * follow it sit at the SAME level, so "Height" and "Floor Space Ratio" are
 * siblings of "Prescriptive Measures", not its children. The rubric then
 * looks empty while its content is captured under the parent clause.
 *
 * If the parent clause has a rule with effects, the finding is a false
 * positive and the gate is mis-calibrated. Read-only.
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.DATABASE_URL || '').trim()
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  // Every "Prescriptive Measures" section, and whether its parent clause
  // ended up with a rule that carries effects.
  const rows = await q(`
    WITH pm AS (
      SELECT s.id, s.local_id, s.heading,
             regexp_replace(s.local_id, '\\.[^.]+$', '') AS parent_local
      FROM nsw.section s
      JOIN nsw.document d ON d.id = s.document_id
      WHERE d.doc_type = 'dcp' AND s.heading = 'Prescriptive Measures'
    )
    SELECT pm.local_id, pm.parent_local,
           p.number AS parent_clause,
           (SELECT count(*)::int FROM nsw.rule r WHERE r.section_id = p.id) AS parent_rules,
           (SELECT count(*)::int FROM nsw.rule r
              JOIN nsw.rule_effect e ON e.rule_id = r.id
             WHERE r.section_id = p.id) AS parent_effects,
           (SELECT count(*)::int FROM nsw.section sib
             WHERE sib.local_id LIKE pm.parent_local || '.%'
               AND sib.local_id <> pm.local_id
               AND length(sib.raw_text) > 100) AS sibling_blocks_with_text
    FROM pm LEFT JOIN nsw.section p ON p.local_id = pm.parent_local`)

  L(`"Prescriptive Measures" sections: ${rows.length}`)
  const covered = rows.filter((r) => r.parent_rules > 0)
  const withEffects = rows.filter((r) => r.parent_effects > 0)
  const siblings = rows.filter((r) => r.sibling_blocks_with_text > 0)

  L(`  parent clause has a rule        : ${covered.length}`)
  L(`  parent clause has rule effects  : ${withEffects.length}`)
  L(`  has sibling blocks carrying text: ${siblings.length}`)
  L(`  genuinely orphaned (no parent rule, no siblings): `
    + `${rows.filter((r) => !r.parent_rules && !r.sibling_blocks_with_text).length}`)

  L('\nexamples:')
  for (const r of rows.slice(0, 8)) {
    L(`  ${String(r.local_id).slice(0, 30).padEnd(31)} parent cl ${String(r.parent_clause ?? '-').padEnd(8)} `
      + `rules=${r.parent_rules} effects=${String(r.parent_effects).padStart(3)} siblings=${r.sibling_blocks_with_text}`)
  }
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
