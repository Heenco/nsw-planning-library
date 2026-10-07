/**
 * Step 7 of the rule pipeline (docs/sepp-rule-pipeline.md): register how every scoping term an instrument's
 * frames and rules use is tested, in nsw.scope_layer.
 *
 *   npx tsx scripts/pipeline/terms.ts --profile housing-sepp-2021          # upsert + measure + coverage check
 *   npx tsx scripts/pipeline/terms.ts --profile housing-sepp-2021 --dry
 *
 * The mappings are data in the profile (profile.terms). Each is upserted by (dimension, term) and MEASURED,
 * as scripts/seed-scope-layers.mjs does for the LEP terms, rather than trusted: features is counted from the
 * source (an lmr.layers registry entry's own count, a table with its filter, or the sum of a derived
 * source's tables), so a mapping pointing at an empty or misspelt table shows 0, not a silent pass.
 *
 * "Done when": every land_characteristic / defined_area / map_area / lga value used by this instrument's
 * rules (frames included) has a scope_layer row - source_kind 'none' is a recorded gap, which counts; no row
 * at all is a failure. nsw.scope_layer_gap (migration 19) lists the gaps.
 */
import 'dotenv/config'
import pg from 'pg'
import type { InstrumentProfile, TermMapping } from '../../profiles/housing-sepp-2021'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'housing-sepp-2021'
const DIMS = ['land_characteristic', 'defined_area', 'map_area', 'lga']

async function measure(client: pg.Client, t: TermMapping): Promise<number | null> {
  if (t.source_kind === 'none' || !t.source) return null
  if (t.source_kind === 'registry') {
    const key = t.source.replace(/^lmr\.layers:/, '')
    const r = (await client.query(`SELECT table_name, features FROM lmr.layers WHERE key = $1`, [key])).rows[0]
    if (!r) return 0
    if (t.filter && r.table_name) {
      // lmr.layers.table_name is sometimes schema-qualified ("lmr.airport_noise"), sometimes not
      const tbl = String(r.table_name).includes('.') ? r.table_name : `lmr."${r.table_name}"`
      const n = await client.query(`SELECT count(*)::int n FROM ${tbl} WHERE ${t.filter}`).catch(() => null)
      return n ? n.rows[0].n : 0
    }
    return Number(r.features ?? 0)
  }
  let total = 0
  for (const tbl of t.source.split('+').map(s => s.trim())) {
    if (!/^[a-z_]+\.[a-z_0-9]+$/i.test(tbl)) return null
    const where = t.filter && t.test !== 'attribute' ? `WHERE ${t.filter}` : t.test === 'attribute' && t.filter ? `WHERE ${t.filter}` : ''
    const n = await client.query(`SELECT count(*)::int n FROM ${tbl} ${where}`).catch(() => null)
    if (!n) return 0
    total += n.rows[0].n
  }
  return total
}

async function main() {
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]

  const measured: (TermMapping & { features: number | null })[] = []
  for (const t of profile.terms) measured.push({ ...t, features: await measure(client, t) })

  // nsw.scope_layer is shared by every profile and keyed by (dimension, term): a row another profile registered (its
  // note carries that profile's label) is never overwritten - the run fails and names it, so the two are named apart
  // (2026-10-07: this step replaced the Codes SEPP's NPWS estate mapping with a gap, and every complying answer went
  // undecided)
  const collisions: string[] = []
  if (!DRY) {
    for (const t of measured) {
      const res = await client.query(
        `INSERT INTO nsw.scope_layer (dimension, term, title, source_kind, source, filter, test, column_tested, kind, note, features, upper_bound, except_term, within_m, lower_bound, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
         ON CONFLICT (dimension, term) DO UPDATE SET
           title = EXCLUDED.title, source_kind = EXCLUDED.source_kind, source = EXCLUDED.source, filter = EXCLUDED.filter,
           test = EXCLUDED.test, column_tested = EXCLUDED.column_tested, kind = EXCLUDED.kind, note = EXCLUDED.note,
           features = EXCLUDED.features, upper_bound = EXCLUDED.upper_bound, except_term = EXCLUDED.except_term, within_m = EXCLUDED.within_m, lower_bound = EXCLUDED.lower_bound, checked_at = now()
         WHERE nsw.scope_layer.note IS NULL OR nsw.scope_layer.note LIKE $16`,
        [t.dimension, t.term, t.term, t.source_kind, t.source, t.filter ?? null, t.test, t.column_tested ?? null,
         t.kind, `${profile.label}: ${t.note}`, t.features, t.upper_bound ?? false, t.except_term ?? null, t.within_m ?? null, t.lower_bound ?? false,
         `${profile.label}:%`])
      if (res.rowCount === 0) {
        const owner = (await client.query(`SELECT split_part(note, ':', 1) AS who FROM nsw.scope_layer WHERE dimension = $1 AND term = $2`, [t.dimension, t.term])).rows[0]?.who
        collisions.push(`${t.dimension} "${t.term}" belongs to ${owner ?? 'another profile'} - not overwritten`)
      }
    }
  }
  for (const c of collisions) console.log(`  COLLISION ${c}`)

  // ── coverage: every value this instrument's rules scope by ──────────────────────────────────────
  const used = (await client.query(
    `SELECT a.dimension, a.value, count(DISTINCT a.rule_id)::int rules
       FROM nsw.rule_applicability a JOIN nsw.rule r ON r.id = a.rule_id
      WHERE r.document_id = $1 AND a.dimension = ANY($2) AND r.publish_state <> 'retired'
      GROUP BY 1, 2 ORDER BY 1, 2`, [doc.id, DIMS])).rows
  const rows = (await client.query(`SELECT dimension, lower(term) t, source_kind, features FROM nsw.scope_layer WHERE dimension = ANY($1)`, [DIMS])).rows
  const have = new Map(rows.map(r => [`${r.dimension}|${r.t}`, r]))
  const gaps = (await client.query(
    `SELECT g.dimension, g.term, g.rules FROM nsw.scope_layer_gap g
      WHERE EXISTS (SELECT 1 FROM nsw.rule_applicability a JOIN nsw.rule r ON r.id = a.rule_id
                     WHERE r.document_id = $1 AND a.dimension = g.dimension AND a.value = g.term)`, [doc.id])).rows
  await client.end()

  console.log(`${DRY ? '[dry] ' : ''}${measured.length} term mappings ${DRY ? 'measured' : 'upserted'}:`)
  for (const t of measured) console.log(`  ${t.dimension.padEnd(19)} ${t.term.slice(0, 58).padEnd(60)} ${t.source_kind.padEnd(8)} ${t.features ?? '-'}`)
  let missing = 0
  console.log(`\n  values the ${profile.label} rules use (${used.length}):`)
  for (const u of used) {
    const m = have.get(`${u.dimension}|${u.value.toLowerCase()}`)
    if (!m) missing++
    console.log(`    ${m ? (m.source_kind === 'none' ? 'GAP ' : 'ok  ') : 'NONE'} ${u.dimension.padEnd(19)} ${u.value.slice(0, 60).padEnd(62)} ${u.rules} rules`
      + `${m && m.source_kind !== 'none' && !Number(m.features) ? '  (0 features!)' : ''}`)
  }
  const empty = measured.filter(t => t.source_kind !== 'none' && !t.features)
  console.log(`\n  recorded gaps (scope_layer_gap): ${gaps.map(g => `${g.term} (${g.rules})`).join('; ') || 'none'}`)
  console.log(`  ${missing === 0 && empty.length === 0 && !collisions.length ? 'PASS' : 'FAIL'}: ${missing} used values with no scope_layer row; ${empty.length} mappings measuring 0 features; ${collisions.length} term collisions`)
}

main().catch((e) => { console.error(e); process.exit(1) })
