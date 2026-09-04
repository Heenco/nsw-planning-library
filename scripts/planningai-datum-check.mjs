/**
 * Does the rule layer say what the document says?
 *
 * The earlier coverage reports all measured the database against itself, so
 * they scored 99.9% while clause 3.1.2 held four effects that were each the
 * wrong number. This checks the other direction: take control tables whose
 * values are known by reading the PDF, and assert the database reproduces
 * them — value, unit, datum and band.
 *
 * Read-only.  node scripts/planningai-datum-check.mjs
 */

import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: (process.env.DATABASE_URL || '').trim(), max: 2 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

/**
 * Expectations read off the Hornsby DCP by hand. Each row is one control as
 * the document states it, so a regression shows up as a diff against the
 * document and not against a previous run of the same code.
 */
const EXPECTED = [
  // Table 3.1.2-a — Minimum boundary setbacks, dwellings and dual occupancies
  { clause: '3.1.2', datum: 'side_boundary', value: 0.9, unit: 'metre', storeys: [null, 1] },
  { clause: '3.1.2', datum: 'side_boundary', value: 1.5, unit: 'metre', storeys: [2, 2] },
  { clause: '3.1.2', datum: 'rear_boundary', value: 3, unit: 'metre', storeys: [null, 1] },
  { clause: '3.1.2', datum: 'rear_boundary', value: 8, unit: 'metre', storeys: [2, 2] },
  { clause: '3.1.2', datum: 'front_boundary', value: 6, unit: 'metre' },
  { clause: '3.1.2', datum: 'front_boundary', value: 9, unit: 'metre' },
  { clause: '3.1.2', datum: 'front_boundary', value: 7.6, unit: 'metre' },
  { clause: '3.1.2', datum: 'secondary_boundary', value: 3, unit: 'metre' },
  // Table 2.1.2-a — Minimum Boundary Setbacks, rural buildings
  { clause: '2.1.2', datum: 'front_boundary', value: 10, unit: 'metre' },
  { clause: '2.1.2', datum: 'front_boundary', value: 15, unit: 'metre' },
  { clause: '2.1.2', datum: 'front_boundary', value: 30, unit: 'metre' },
  { clause: '2.1.2', datum: 'side_boundary', value: 5, unit: 'metre' },
  { clause: '2.1.2', datum: 'side_boundary', value: 10, unit: 'metre' },
  { clause: '2.1.2', datum: 'rear_boundary', value: 10, unit: 'metre' },
  { clause: '2.1.2', datum: 'rear_boundary', value: 15, unit: 'metre' },
  // Table 2.4.2-a — Minimum Boundary Setbacks, Dural Village
  { clause: '2.4.2', datum: 'side_boundary', value: 0.9, unit: 'metre', storeys: [null, 1] },
  { clause: '2.4.2', datum: 'side_boundary', value: 1.5, unit: 'metre', storeys: [2, 2] },
  { clause: '2.4.2', datum: 'rear_boundary', value: 3, unit: 'metre', storeys: [null, 1] },
  { clause: '2.4.2', datum: 'rear_boundary', value: 8, unit: 'metre', storeys: [2, 2] },
  { clause: '2.4.2', datum: 'road_boundary', value: 6, unit: 'metre' },
  { clause: '2.4.2', datum: 'road_boundary', value: 9, unit: 'metre' },
]

const eq = (a, b) => Number(a) === Number(b)

try {
  const rows = await q(`
    SELECT r.clause, e.value, e.unit, e.measured_from,
           e.condition_metric, e.condition_lo, e.condition_hi
    FROM nsw.rule_effect e
    JOIN nsw.rule r ON r.id = e.rule_id
    JOIN nsw.document d ON d.id = r.document_id
    WHERE d.doc_type = 'dcp' AND e.value IS NOT NULL`)

  let pass = 0
  const misses = []
  for (const want of EXPECTED) {
    const hit = rows.find((r) =>
      r.clause === want.clause
      && eq(r.value, want.value)
      && r.unit === want.unit
      && r.measured_from === want.datum
      && (!want.storeys || (r.condition_metric === 'storeys'
        && (want.storeys[0] === null ? r.condition_lo === null : eq(r.condition_lo, want.storeys[0]))
        && (want.storeys[1] === null ? r.condition_hi === null : eq(r.condition_hi, want.storeys[1])))))
    if (hit) pass++
    else misses.push(want)
  }

  L(`control values checked against the document: ${pass}/${EXPECTED.length}`)
  if (misses.length) {
    L('\nMISSING — the document states these and the rule layer does not:')
    for (const m of misses) {
      const band = m.storeys ? ` storeys ${m.storeys[0] ?? '*'}..${m.storeys[1] ?? '*'}` : ''
      L(`  cl ${m.clause.padEnd(7)} ${String(m.value).padStart(5)} ${m.unit.padEnd(6)} from ${m.datum}${band}`)
      // Show what IS there for that clause and datum, to make the diff readable.
      const near = rows.filter((r) => r.clause === m.clause && r.measured_from === m.datum)
      L(`      have: ${near.map((r) => `${r.value}${r.unit}`).join(', ') || '(nothing with that datum)'}`)
    }
  }

  L('\n── datum coverage ──')
  for (const r of await q(`
    SELECT coalesce(e.measured_from,'(none)') datum, count(*)::int n
    FROM nsw.rule_effect e JOIN nsw.rule r ON r.id=e.rule_id
    JOIN nsw.document d ON d.id=r.document_id
    WHERE d.doc_type='dcp' AND e.unit IN ('metre','km')
    GROUP BY 1 ORDER BY n DESC`)) {
    L(`  ${r.datum.padEnd(22)} ${String(r.n).padStart(4)}`)
  }

  L('\n── the storey band is a condition, not a value ──')
  for (const r of await q(`
    SELECT count(*) FILTER (WHERE unit='storeys' AND topic='setback')::int AS setback_in_storeys,
           count(*) FILTER (WHERE condition_metric='storeys')::int AS banded,
           count(*) FILTER (WHERE condition_metric='lot_size')::int AS lot_banded
    FROM nsw.rule_effect e JOIN nsw.rule r ON r.id=e.rule_id
    JOIN nsw.document d ON d.id=r.document_id WHERE d.doc_type='dcp'`)) {
    L(`  setbacks still measured in storeys : ${r.setback_in_storeys}   (must be 0)`)
    L(`  effects conditioned on a storey band: ${r.banded}`)
    L(`  effects conditioned on a lot size   : ${r.lot_banded}`)
  }

  process.exitCode = misses.length ? 1 : 0
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
