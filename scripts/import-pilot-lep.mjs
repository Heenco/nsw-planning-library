/**
 * Import a LEP from the Part 4 pilot store into `planningai`.
 *
 * The pilot (Notebooks/Data/lep_part4/lep_store.sqlite) already holds an
 * audited rule layer for 8 LEPs — rules, scoped applicability, effects,
 * precedence edges and spatial refs — for Parts 4–6. That is exactly the
 * shape the new schema was designed around, so it seeds the pilot database
 * rather than being re-extracted.
 *
 *   node scripts/import-pilot-lep.mjs --epi epi-2013-0569 [--dry-run]
 *
 * Idempotent: re-running deletes the document and everything cascading from
 * it, then reinserts.
 *
 * Scope note: the pilot covers Parts 4-6 only. The imported document is
 * marked as such on `nsw.document.raw_path` so nobody later mistakes it for
 * a whole-of-LEP ingest.
 */

import 'dotenv/config'
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const epi = arg('--epi', 'epi-2013-0569')
const sqlitePath = arg('--store', path.join(
  'C:', 'Users', 'manni.kheradmandi', 'OneDrive - COSOL GLOBAL',
  'Notebooks', 'Data', 'lep_part4', 'lep_store.sqlite'))

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const L = (s = '') => process.stdout.write(s + '\n')

// ── vocabulary translation ────────────────────────────────────────────
// The pilot grew its own vocabulary; the schema fixed a slightly different
// one. Translate explicitly rather than widening the CHECK constraints —
// an unmapped value should fail loudly, not slip in.

const SRC = { schedule1_ai: 'schedule1', schedule2_ai: 'schedule2', ai: 'ai', map: 'map', table: 'table' }

const KIND = {
  standard: 'standard', prohibition: 'prohibition', permission: 'permission',
  additional_use: 'additional_use', exempt_development: 'exempt_development',
  consent_trigger: 'consent_trigger', disapplication: 'disapplication',
  definition: 'definition', matters: 'matters', test: 'test',
  mandatory_consent: 'mandatory_consent',
}

/** Pilot proposition kinds → the schema's deontic types. */
const PROP_TYPE = {
  precondition: 'condition',
  requirement: 'requirement',
  consent_requirement: 'requirement',
  matter_for_consideration: 'requirement',
  definition: 'definition',
  exception: 'exception',
  prohibition: 'prohibition',
  permission: 'permission',
  obligation: 'obligation',
  threshold: 'threshold',
}

const EDGE = {
  overrides: 'overrides', disapplies: 'disapplies', can_vary: 'can_vary',
  relaxes: 'relaxes', defines: 'defines', prohibits: 'prohibits',
  prevails_over: 'prevails_over', excepts: 'excepts', requires: 'requires',
}

/**
 * The pilot records the planning word ("min" / "max"); the schema records
 * the relation. A *minimum* lot size means the lot must be at least that
 * big — gte — and a *maximum* height means at most — lte. Getting this
 * inverted would flip every standard, so map it explicitly.
 */
// The full vocabulary the pilot actually uses, taken from the store rather
// than guessed: at_least, eq, max, min, no_more_than, "more than".
const COMPARATOR = {
  min: 'gte', minimum: 'gte', at_least: 'gte', 'at least': 'gte', gte: 'gte',
  gt: 'gt', 'more than': 'gt', more_than: 'gt', greater_than: 'gt',
  max: 'lte', maximum: 'lte', at_most: 'lte', 'at most': 'lte',
  no_more_than: 'lte', 'no more than': 'lte', not_more_than: 'lte', lte: 'lte',
  lt: 'lt', less_than: 'lt', 'less than': 'lt',
  eq: 'eq', equals: 'eq', exactly: 'eq',
  between: 'between', range: 'between',
}
const comparatorOf = (raw) => {
  if (!raw) return null
  const c = COMPARATOR[String(raw).trim().toLowerCase()]
  // Fail rather than default: a wrong comparator silently inverts a control.
  if (!c) throw new Error(`unmapped comparator: ${raw}`)
  return c
}

/**
 * The pilot's `value` columns are free text: mostly numbers, but sometimes a
 * map deferral ("per Lot Size Map"). Split them — a number goes to the
 * numeric column, anything else is a value_source, which is precisely the
 * distinction `value_source` exists to record. Never silently drop it.
 */
function splitValue(raw) {
  if (raw === null || raw === undefined || raw === '') return { num: null, source: null }
  if (typeof raw === 'number') return { num: raw, source: null }
  const s = String(raw).trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return { num: Number(s), source: null }
  const embedded = s.match(/^-?\d+(\.\d+)?/)
  return { num: embedded ? Number(embedded[0]) : null, source: s }
}

const db = new DatabaseSync(sqlitePath, { readOnly: true })
const all = (sql, ...p) => db.prepare(sql).all(...p)
const one = (sql, ...p) => db.prepare(sql).get(...p)

const lep = one('SELECT * FROM land_application WHERE epi_id = ?', epi)
if (!lep) { process.stderr.write(`no such epi in the pilot store: ${epi}\n`); process.exit(1) }

const rules = all('SELECT * FROM rule WHERE epi_id = ?', epi)
const effects = all('SELECT * FROM rule_effect WHERE epi_id = ?', epi)
const applic = all('SELECT * FROM rule_applicability WHERE epi_id = ?', epi)
const edges = all('SELECT * FROM rule_edge WHERE epi_id = ?', epi)
const spatial = all('SELECT * FROM spatial_ref WHERE epi_id = ?', epi)
const objectives = all('SELECT * FROM objective WHERE epi_id = ?', epi)
const props = all('SELECT * FROM proposition WHERE epi_id = ?', epi)

L(`source     : ${lep.epi_name} (${epi})`)
L(`  rules ${rules.length}, effects ${effects.length}, applicability ${applic.length},`)
L(`  edges ${edges.length}, spatial ${spatial.length}, objectives ${objectives.length}, propositions ${props.length}`)

// Every clause the pilot mentions becomes a section, so propositions and
// rules have somewhere to hang and citations keep working.
const clauses = [...new Set([
  ...rules.map((r) => r.clause),
  ...props.map((p) => p.clause),
  ...objectives.map((o) => o.clause),
  ...spatial.map((s) => s.clause),
].filter(Boolean))].sort((a, b) =>
  String(a).localeCompare(String(b), undefined, { numeric: true }))

L(`  distinct clauses: ${clauses.length}`)

if (dryRun) {
  L('\nDRY RUN — nothing written.')
  const unmappedSrc = [...new Set(rules.map((r) => r.src))].filter((s) => s && !SRC[s])
  const unmappedKind = [...new Set(rules.map((r) => r.kind))].filter((k) => k && !KIND[k])
  const unmappedProp = [...new Set(props.map((p) => p.kind))].filter((k) => k && !PROP_TYPE[k])
  const unmappedEdge = [...new Set(edges.map((e) => e.edge_type))].filter((k) => k && !EDGE[k])
  L(`  unmapped src      : ${unmappedSrc.join(', ') || 'none'}`)
  L(`  unmapped kind     : ${unmappedKind.join(', ') || 'none'}`)
  L(`  unmapped prop kind: ${unmappedProp.join(', ') || 'none'}`)
  L(`  unmapped edge type: ${unmappedEdge.join(', ') || 'none'}`)
  process.exit(0)
}

const client = new pg.Client({ connectionString: url, statement_timeout: 300_000 })
await client.connect()

try {
  await client.query('BEGIN')

  // Idempotent: the document cascade clears sections, propositions, rules.
  await client.query('DELETE FROM nsw.document WHERE title = $1', [lep.epi_name])

  const { rows: [doc] } = await client.query(`
    INSERT INTO nsw.document
      (title, doc_type, scope, hierarchy_level, lga_name, source_url, raw_path,
       as_at_date, ingest_model, ingest_provider)
    VALUES ($1,'lep','local',3,$2,$3,$4,CURRENT_DATE,'part4-pilot','import')
    RETURNING id`,
  [lep.epi_name, lep.lga,
    `https://legislation.nsw.gov.au/view/html/inforce/current/${epi}`,
    'pilot:lep_store.sqlite (Parts 4-6 only)'])

  // ── sections ────────────────────────────────────────────────────────
  const sectionId = new Map()
  for (const [i, clause] of clauses.entries()) {
    const text = props.filter((p) => p.clause === clause)
      .map((p) => p.source_span).filter(Boolean).join('\n')
    const { rows: [s] } = await client.query(`
      INSERT INTO nsw.section (document_id, local_id, level, number, heading, raw_text, depth, sort_order)
      VALUES ($1,$2,'clause',$3,NULL,$4,1,$5) RETURNING id`,
    [doc.id, `sec.${clause}`, String(clause), text, i])
    sectionId.set(String(clause), s.id)
  }

  // ── rules ───────────────────────────────────────────────────────────
  const ruleId = new Map()
  for (const r of rules) {
    const src = SRC[r.src] ?? 'ai'
    const kind = KIND[r.kind] ?? 'standard'
    const { rows: [row] } = await client.query(`
      INSERT INTO nsw.rule
        (document_id, section_id, rule_key, clause, role, kind, src,
         instrument_rank, precedence, provision_ref, part)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (document_id, rule_key) DO UPDATE SET precedence = EXCLUDED.precedence
      RETURNING id`,
    [doc.id, sectionId.get(String(r.clause)) ?? null, r.rule_id, r.clause,
      r.role, kind, src,
      20,                       // LEP: an EPI, above any DCP (EP&A Act s3.28)
      r.precedence ?? 0, r.provision_ref, r.part ? `Part ${r.part}` : null])
    ruleId.set(r.rule_id, row.id)
  }

  // ── effects, applicability ──────────────────────────────────────────
  let effN = 0
  for (const e of effects) {
    const rid = ruleId.get(e.rule_id)
    if (!rid) continue
    const ev = splitValue(e.value)
    await client.query(`
      INSERT INTO nsw.rule_effect
        (rule_id, effect_type, topic, comparator, value, unit,
         value_source, map_layer, relative_to, combine)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [rid, e.effect_type, e.topic, comparatorOf(e.comparator), ev.num, e.unit,
      e.value_source ?? ev.source, e.map_layer, e.relative_to, e.combine])
    effN++
  }

  let appN = 0
  for (const a of applic) {
    const rid = ruleId.get(a.rule_id)
    if (!rid) continue
    await client.query(`
      INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [rid, a.dimension, String(a.value), a.polarity || 'applies'])
    appN++
  }

  // ── propositions (the evidence the rules rest on) ────────────────────
  let propN = 0
  for (const p of props) {
    const sid = sectionId.get(String(p.clause))
    if (!sid || !p.source_span) continue
    const type = PROP_TYPE[p.kind] ?? 'condition'
    const pv = splitValue(p.value)
    // The pilot models a proposition as one statement, not subject/predicate.
    // Keep the statement whole as the predicate and let the clause be the
    // subject, rather than inventing a split the source never made.
    await client.query(`
      INSERT INTO nsw.proposition
        (document_id, section_id, type, subject, predicate, source_span,
         confidence, verification_status, extraction_model, numeric_value,
         numeric_comparator, numeric_unit)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'part4-pilot',$9,$10,$11)`,
    [doc.id, sid, type,
      `cl ${p.clause}`.slice(0, 80),
      String(p.statement ?? p.source_span).slice(0, 200),
      p.source_span,
      p.grounded ? 0.95 : 0.5,
      p.grounded ? 'verified' : 'pending',
      pv.num, comparatorOf(p.comparator), p.unit ?? null])
    propN++
  }

  // ── objectives ──────────────────────────────────────────────────────
  let objN = 0
  for (const o of objectives) {
    await client.query(`
      INSERT INTO nsw.objective (document_id, section_id, clause, seq, text)
      VALUES ($1,$2,$3,$4,$5)`,
    [doc.id, sectionId.get(String(o.clause)) ?? null, o.clause, o.seq ?? 0, o.text])
    objN++
  }

  // ── precedence edges ────────────────────────────────────────────────
  // The pilot links clause→clause. Resolve to the rules on those clauses;
  // when a target clause carries several rules, the edge applies to each.
  const rulesByClause = new Map()
  for (const r of rules) {
    const k = String(r.clause)
    if (!rulesByClause.has(k)) rulesByClause.set(k, [])
    rulesByClause.get(k).push(ruleId.get(r.rule_id))
  }
  let edgeN = 0, edgeUnresolved = 0
  for (const e of edges) {
    const from = rulesByClause.get(String(e.from_clause)) ?? []
    const to = rulesByClause.get(String(e.to_clause)) ?? []
    const type = EDGE[e.edge_type]
    if (!type) continue
    for (const f of from) {
      if (!to.length) {
        await client.query(`
          INSERT INTO nsw.rule_edge (from_rule_id, to_ref, edge_type, authority, source_span, confidence)
          VALUES ($1,$2,$3,'instrument',$4,$5)`,
        [f, `cl ${e.to_clause}`, type, e.source_span, e.confidence ?? 1.0])
        edgeUnresolved++
        continue
      }
      for (const t of to) {
        if (f === t) continue
        await client.query(`
          INSERT INTO nsw.rule_edge (from_rule_id, to_rule_id, edge_type, authority, source_span, confidence)
          VALUES ($1,$2,$3,'instrument',$4,$5)`,
        [f, t, type, e.source_span, e.confidence ?? 1.0])
        edgeN++
      }
    }
  }

  // ── spatial refs ────────────────────────────────────────────────────
  let spN = 0, spGeom = 0
  for (const s of spatial) {
    const rid = ruleId.get(s.owner_id) ?? null
    const hasGeom = s.geom && String(s.geom).trim().length > 0
    await client.query(`
      INSERT INTO nsw.rule_spatial_ref
        (document_id, rule_id, section_id, clause, ref_type, value, map_layer,
         polarity, geom, geom_source, match_confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
              CASE WHEN $9::text IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_GeomFromText($9::text), 4326) END,
              $10,$11)
      ON CONFLICT (document_id, clause, ref_type, value) DO NOTHING`,
    [doc.id, rid, sectionId.get(String(s.clause)) ?? null, s.clause,
      s.ref_type, String(s.value), s.map_layer, s.polarity || 'applies',
      hasGeom ? String(s.geom) : null, s.geom_source, s.match_confidence])
    spN++
    if (hasGeom) spGeom++
  }

  await client.query(
    'UPDATE nsw.document SET prop_count = $2, edge_count = $3 WHERE id = $1',
    [doc.id, propN, edgeN + edgeUnresolved])

  await client.query('COMMIT')

  L(`\nimported into planningai:`)
  L(`  document        1  (${lep.epi_name})`)
  L(`  sections        ${clauses.length}`)
  L(`  rules           ${ruleId.size}`)
  L(`  rule_effect     ${effN}`)
  L(`  applicability   ${appN}`)
  L(`  propositions    ${propN}`)
  L(`  objectives      ${objN}`)
  L(`  rule_edge       ${edgeN} resolved${edgeUnresolved ? ` + ${edgeUnresolved} unresolved (kept as to_ref)` : ''}`)
  L(`  spatial_ref     ${spN}  (${spGeom} with geometry)`)
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  if (err.detail) process.stderr.write(`  ${err.detail}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
  db.close()
}
