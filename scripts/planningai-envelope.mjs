/**
 * "What are the setback and height limits for <land use> in <LGA>?"
 *
 * The question the rule layer exists to answer, asked directly so its
 * limits are visible rather than assumed. Every row cites the clause it
 * came from, and where the document defers to a map the row says so instead
 * of showing a number — a missing value is reported, never filled in.
 *
 *   node scripts/planningai-envelope.mjs                    # coverage summary
 *   node scripts/planningai-envelope.mjs "dwelling house"   # one land use
 *   node scripts/planningai-envelope.mjs "residential flat building" --storeys 5
 */

import 'dotenv/config'
import pg from 'pg'

const argv = process.argv.slice(2)
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const storeys = arg('--storeys', null)
const lga = arg('--lga', 'Hornsby')
const use = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--storeys'
  && argv[argv.indexOf(a) - 1] !== '--lga')

const pool = new pg.Pool({ connectionString: (process.env.DATABASE_URL || '').trim(), max: 2 })
const q = async (s, p) => (await pool.query(s, p)).rows
const L = (s = '') => process.stdout.write(s + '\n')

const band = (r) => r.condition_metric
  ? `${r.condition_lo ?? ''}–${r.condition_hi ?? ''} ${r.condition_metric}`.replace('– ', '+ ')
  : ''

try {
  if (!use) {
    // Which land uses can be answered at all, and how completely.
    L(`land uses with setback or height controls in ${lga}:\n`)
    L(`  ${'land use'.padEnd(32)} ${'setback'.padStart(8)} ${'w/ datum'.padStart(9)} `
      + `${'height'.padStart(7)} ${'banded'.padStart(7)} ${'map-keyed'.padStart(10)}`)
    for (const r of await q(`
      SELECT a.value AS land_use,
        count(*) FILTER (WHERE e.topic='setback')::int setbacks,
        count(*) FILTER (WHERE e.topic='setback' AND e.measured_from IS NOT NULL)::int datumed,
        count(*) FILTER (WHERE e.topic='height')::int heights,
        count(*) FILTER (WHERE e.condition_metric IS NOT NULL)::int banded,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM nsw.rule_applicability m
          WHERE m.rule_id = r.id AND m.dimension='map_area'))::int mapped
      FROM nsw.rule_applicability a
      JOIN nsw.rule r ON r.id = a.rule_id
      JOIN nsw.rule_effect e ON e.rule_id = r.id
      JOIN nsw.document d ON d.id = r.document_id
      WHERE a.dimension='land_use' AND a.polarity='applies'
        AND d.lga_name = $1 AND e.topic IN ('setback','height')
      GROUP BY 1 ORDER BY 2 DESC, 1`, [lga])) {
      L(`  ${String(r.land_use).slice(0, 31).padEnd(32)} ${String(r.setbacks).padStart(8)} `
        + `${String(r.datumed).padStart(9)} ${String(r.heights).padStart(7)} `
        + `${String(r.banded).padStart(7)} ${String(r.mapped).padStart(10)}`)
    }
    const [{ total }] = await q(
      `SELECT count(DISTINCT value)::int total FROM nsw.rule_applicability WHERE dimension='land_use'`)
    L(`\n(${total} land uses appear anywhere in the applicability table; the NSW`)
    L(`Standard Instrument defines 157. A use absent here is not unregulated —`)
    L(`it means no clause heading named it, which is a coverage gap, not a finding.)`)
    process.exit(0)
  }

  L(`══ ${use.toUpperCase()} — ${lga}${storeys ? `, ${storeys} storeys` : ''} ══\n`)

  const rows = await q(`
    SELECT d.doc_type, d.title, r.clause, r.instrument_rank,
           e.topic, e.comparator, e.value, e.unit,
           e.measured_from, e.relative_to, e.map_layer, e.value_source,
           e.condition_metric, e.condition_lo, e.condition_hi,
           s.heading, p.heading AS parent_heading,
           -- What the table row was about. Several rows of one table share a
           -- boundary and differ only by subject ("Tower element", "Podium"),
           -- so without it the answer looks like five conflicting numbers.
           coalesce(tc.row_header, split_part(e.source_span, ' | ', 1)) AS subject,
           -- Which mapped area the value is keyed on. Height in Hornsby is a
           -- Height of Buildings Map attribute, not a land-use one, so this
           -- is the difference between 8.5 m and 72 m.
           (SELECT ma.value FROM nsw.rule_applicability ma
             WHERE ma.rule_id = r.id AND ma.dimension = 'map_area' LIMIT 1) AS map_area
    FROM nsw.rule_applicability a
    JOIN nsw.rule r ON r.id = a.rule_id
    JOIN nsw.rule_effect e ON e.rule_id = r.id
    JOIN nsw.document d ON d.id = r.document_id
    LEFT JOIN nsw.section s ON s.id = r.section_id
    LEFT JOIN nsw.section p ON p.id = s.parent_id
    LEFT JOIN nsw.section_table_cell tc ON tc.id = e.cell_id
    WHERE a.dimension='land_use' AND a.polarity='applies' AND a.value = $1
      AND d.lga_name = $2 AND e.topic IN ('setback','height')
      AND ($3::numeric IS NULL OR e.condition_metric IS DISTINCT FROM 'storeys'
           OR (coalesce(e.condition_lo, -1e9) <= $3 AND coalesce(e.condition_hi, 1e9) >= $3))
    ORDER BY e.topic, e.measured_from NULLS LAST, e.condition_lo NULLS FIRST, e.value`,
  [use, lga, storeys])

  if (!rows.length) { L('  no setback or height control is scoped to this land use.'); process.exit(0) }

  for (const topic of ['setback', 'height']) {
    const set = rows.filter((r) => r.topic === topic)
    if (!set.length) continue
    L(`── ${topic} ──`)
    for (const r of set) {
      const v = r.value != null
        ? `${({ gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=' })[r.comparator] ?? '?'} `
          + `${r.value}${r.unit === 'metre' ? 'm' : ' ' + (r.unit ?? '')}`
        : `→ ${r.map_layer ?? r.value_source ?? 'deferred'}`
      const subj = r.map_area ? `HLEP area ${r.map_area}`
        : (r.subject ?? '').slice(0, 30)
      L(`  ${v.padEnd(13)} ${String(r.measured_from ?? r.relative_to ?? '').padEnd(21)}`
        + ` ${band(r).padEnd(13)} ${subj.padEnd(31)} ${r.doc_type} cl ${r.clause ?? '-'}`)
    }
    L('')
  }

  // The statutory point: an LEP beats a DCP, so say which instrument each
  // number came from rather than merging them into one list.
  const ranks = [...new Set(rows.map((r) => `${r.doc_type} (rank ${r.instrument_rank})`))]
  L(`instruments: ${ranks.join(', ')} — EP&A Act s3.28: an EPI prevails over a DCP.`)
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await pool.end().catch(() => {})
}
