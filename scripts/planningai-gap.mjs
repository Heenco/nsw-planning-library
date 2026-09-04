/**
 * What is still missing after the deterministic pass, concretely.
 * Read-only.
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.DATABASE_URL || '').trim()
const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 120_000 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

try {
  L('rule_applicability — scope, per document:')
  for (const r of await q(`
    SELECT d.doc_type, d.title, count(a.*)::int AS scope_rows
    FROM nsw.document d
    LEFT JOIN nsw.rule r ON r.document_id = d.id
    LEFT JOIN nsw.rule_applicability a ON a.rule_id = r.id
    GROUP BY 1,2 ORDER BY 1`)) {
    L(`  ${r.doc_type.padEnd(4)} ${r.title.slice(0, 44).padEnd(45)} ${String(r.scope_rows).padStart(5)}`)
  }
  L('  ^ a DCP effect with no scope says "6m setback" without saying to what.')

  L('\neffect types present (vs what the schema can hold):')
  for (const r of await q(`
    SELECT effect_type, count(*)::int n FROM nsw.rule_effect GROUP BY 1 ORDER BY 2 DESC`)) {
    L(`  ${r.effect_type.padEnd(24)} ${String(r.n).padStart(5)}`)
  }
  L('  absent: permits_use, prohibits_use, requires_consent, exempt_from_consent,')
  L('          mandatory_consent, disapplies — none are groundable by regex.')

  L('\nsample numeric_lead findings (control language, no groundable number):')
  for (const r of await q(`
    SELECT clause, value, detail FROM nsw.audit_finding
    WHERE kind='numeric_lead' ORDER BY random() LIMIT 6`)) {
    L(`  cl ${String(r.clause ?? '-').padEnd(9)} ${String(r.value).slice(0, 58)}`)
  }

  L('\nsample empty_rule_source findings (gating — need triage):')
  for (const r of await q(`
    SELECT clause, value FROM nsw.audit_finding
    WHERE kind='empty_rule_source' ORDER BY random() LIMIT 8`)) {
    L(`  cl ${String(r.clause ?? '-').padEnd(9)} ${String(r.value).slice(0, 58)}`)
  }

  L('\nDCP propositions by type (what the deterministic pass could type):')
  for (const r of await q(`
    SELECT p.type, count(*)::int n FROM nsw.proposition p
    JOIN nsw.document d ON d.id=p.document_id WHERE d.doc_type='dcp'
    GROUP BY 1 ORDER BY 2 DESC`)) {
    L(`  ${r.type.padEnd(14)} ${String(r.n).padStart(5)}`)
  }
  L('  ^ only thresholds. Obligations, prohibitions, permissions and')
  L('    conditions all need language understanding, not pattern matching.')
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
