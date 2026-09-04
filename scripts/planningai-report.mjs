/**
 * What is in `planningai`, and does the Hornsby pilot meet its criterion?
 *
 * The success test set in docs/rule-layer-pipeline.md: zero substantial
 * `controls` sections with no rule — the failure mode that leaves 27.5% of
 * Randwick's sections empty in the legacy graph. Read-only.
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 180_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  L('documents:')
  for (const d of await q(`
    SELECT d.doc_type, d.title, d.lga_name,
           (SELECT count(*) FROM nsw.section s WHERE s.document_id=d.id)::int AS sections,
           (SELECT count(*) FROM nsw.rule r WHERE r.document_id=d.id)::int AS rules,
           (SELECT count(*) FROM nsw.objective o WHERE o.document_id=d.id)::int AS objectives
    FROM nsw.document d ORDER BY d.doc_type, d.title`)) {
    L(`  ${d.doc_type.padEnd(4)} ${d.title.slice(0, 46).padEnd(47)} `
      + `sections ${String(d.sections).padStart(5)}  rules ${String(d.rules).padStart(4)}  obj ${String(d.objectives).padStart(4)}`)
  }

  L('\nrule layer:')
  for (const r of await q(`
    SELECT 'rule' t, count(*)::int n FROM nsw.rule
    UNION ALL SELECT 'rule_effect', count(*)::int FROM nsw.rule_effect
    UNION ALL SELECT 'rule_applicability', count(*)::int FROM nsw.rule_applicability
    UNION ALL SELECT 'rule_edge', count(*)::int FROM nsw.rule_edge
    UNION ALL SELECT 'rule_spatial_ref', count(*)::int FROM nsw.rule_spatial_ref
    UNION ALL SELECT 'objective', count(*)::int FROM nsw.objective
    UNION ALL SELECT 'proposition', count(*)::int FROM nsw.proposition
    UNION ALL SELECT 'audit_finding', count(*)::int FROM nsw.audit_finding`)) {
    L(`  ${r.t.padEnd(20)} ${String(r.n).padStart(6)}`)
  }

  L('\neffects by topic (the controls actually captured):')
  for (const r of await q(`
    SELECT coalesce(topic,'-') topic, count(*)::int n,
           count(*) FILTER (WHERE value IS NOT NULL)::int with_value
    FROM nsw.rule_effect GROUP BY 1 ORDER BY 2 DESC LIMIT 12`)) {
    L(`  ${r.topic.padEnd(16)} ${String(r.n).padStart(5)}  (${r.with_value} with a number)`)
  }

  L('\nprecedence edges:')
  for (const r of await q(`
    SELECT edge_type, authority, count(*)::int n FROM nsw.rule_edge
    GROUP BY 1,2 ORDER BY 3 DESC`)) {
    L(`  ${r.edge_type.padEnd(14)} ${String(r.authority).padEnd(12)} ${String(r.n).padStart(5)}`)
  }

  L('\ninstrument rank (who beats whom, EP&A Act s3.28):')
  for (const r of await q(`
    SELECT d.doc_type, r.instrument_rank, count(*)::int n
    FROM nsw.rule r JOIN nsw.document d ON d.id=r.document_id
    GROUP BY 1,2 ORDER BY 2 DESC`)) {
    L(`  ${r.doc_type.padEnd(5)} rank ${String(r.instrument_rank).padStart(3)}  ${String(r.n).padStart(5)} rules`)
  }

  // ── the criterion ────────────────────────────────────────────────────
  L('\n── success criterion: substantial sections with no rule ──')
  const gap = await q(`
    SELECT d.doc_type,
           count(*)::int AS substantial,
           count(*) FILTER (WHERE r.n = 0)::int AS no_rule
    FROM nsw.section s
    JOIN nsw.document d ON d.id = s.document_id
    LEFT JOIN LATERAL (SELECT count(*)::int n FROM nsw.rule x WHERE x.section_id = s.id) r ON true
    WHERE length(s.raw_text) > 200
    GROUP BY 1 ORDER BY 1`)
  for (const r of gap) {
    const pc = r.substantial ? (100 * r.no_rule / r.substantial).toFixed(1) : '0'
    L(`  ${r.doc_type.padEnd(5)} ${String(r.substantial).padStart(5)} substantial sections, `
      + `${String(r.no_rule).padStart(4)} with no rule (${pc}%)`)
  }
  L('  legacy kg for comparison: dcp 27.5% of substantial sections yielded nothing')

  L('\naudit findings:')
  for (const r of await q(`
    SELECT kind, gating, status, count(*)::int n FROM nsw.audit_finding
    GROUP BY 1,2,3 ORDER BY 4 DESC`)) {
    L(`  ${r.kind.padEnd(20)} gating=${String(r.gating).padEnd(5)} ${r.status.padEnd(9)} ${String(r.n).padStart(5)}`)
  }
  const [{ open }] = await q(
    `SELECT count(*)::int open FROM nsw.audit_finding WHERE status='open' AND gating`)
  L(`\n  PASS = zero open gating findings → currently ${open} open`)
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
