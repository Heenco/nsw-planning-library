/**
 * Import a LEP from the Part 4 pilot store into `planningai`.
 *
 * The pilot (Notebooks/Data/lep_part4/lep_store.sqlite) already holds an
 * audited rule layer for 8 LEPs — rules, scoped applicability, effects,
 * precedence edges and spatial refs — for Parts 4–6. That is exactly the
 * shape the new schema was designed around, so it seeds the pilot database
 * rather than being re-extracted.
 *
 *   node scripts/import-pilot-lep.mjs --epi epi-2013-0036 --merge [--apply]
 *
 * Two modes, and --merge is the one to use for a council whose LEP is already
 * in the database.
 *
 * Standalone (the original, no flag) creates its own document from the pilot's
 * clause list. That is only right when nothing else has ingested the LEP,
 * because it begins by deleting any document with the same title -- and every
 * section, proposition and rule cascading from it. Hornsby reached the database
 * this way first and had to be repaired afterwards by scripts/migrate-lep-to-xml.mjs.
 *
 * --merge attaches the rule layer to the LEP already there. It resolves every
 * pilot clause onto that document's own section ids, refuses to run if any
 * clause cannot be resolved, and never touches sections or the document row.
 * It replaces only the rule layer, and says exactly what it is replacing.
 * Nothing is written without --apply.
 *
 * Scope note: the pilot covers Parts 4-6 and the schedules, not the whole
 * instrument. In standalone mode that limit is recorded on
 * `nsw.document.raw_path`; in merge mode the document is a full ingest already
 * and only its rule layer comes from here.
 */

import 'dotenv/config'
import pg from 'pg'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

import { candidateIds, headingsAgree, textContainsSpan } from './lib/lep-clause-map.mjs'

const argv = process.argv.slice(2)
const MERGE = argv.includes('--merge')
// --merge writes only with --apply, so the default is always a rehearsal. The
// original mode keeps --dry-run, which is how it has always been invoked.
const dryRun = MERGE ? !argv.includes('--apply') : argv.includes('--dry-run')
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

if (dryRun && !MERGE) {
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

  let doc
  const sectionId = new Map()

  if (MERGE) {
    // -- Attach to the LEP already in the database ---------------------
    const { rows: [existing] } = await client.query(
      `SELECT id, title, instrument_slug FROM nsw.document
        WHERE title = $1 AND doc_type = 'lep'`, [lep.epi_name])
    if (!existing) {
      throw new Error(`--merge needs "${lep.epi_name}" to be ingested already; `
        + 'no such LEP document. Ingest the XML first, or drop --merge to create one.')
    }
    doc = existing

    // Every section of that document, with the text of its whole subtree. The
    // subtree is what corroborates an inferred clause mapping: a schedule item
    // keeps its conditions in child sections, so the pilot's grounded span sits
    // below the item rather than in it.
    const { rows: sections } = await client.query(
      `SELECT s.id, s.local_id, s.heading,
              coalesce(s.raw_text, '') || ' ' || coalesce((
                SELECT string_agg(c.raw_text, ' ')
                  FROM nsw.section c
                 WHERE c.document_id = s.document_id
                   AND c.local_id LIKE s.local_id || '-%'), '') AS subtree_text
         FROM nsw.section s WHERE s.document_id = $1`, [doc.id])
    const byLocal = new Map(sections.map((r) => [r.local_id, r]))

    const spansByClause = new Map()
    for (const p of props) {
      if (!p.grounded || !p.source_span) continue
      const k = String(p.clause)
      if (!spansByClause.has(k)) spansByClause.set(k, [])
      spansByClause.get(k).push(p.source_span)
    }
    const headingByClause = new Map()
    for (const o of objectives) {
      if (o.clause && o.text) headingByClause.set(String(o.clause), o.text)
    }

    const unresolved = []
    const inferredOk = []
    for (const clause of clauses) {
      let hit = null
      for (const cand of candidateIds(clause)) {
        const sec = byLocal.get(cand.id)
        if (!sec) continue
        if (cand.inferred) {
          // An inferred id is a claim about correspondence, so it has to be
          // corroborated. Either the headings agree, or one of the clause's
          // grounded spans -- verbatim quotes from the instrument -- is found
          // in that section's own subtree.
          const byHeading = headingsAgree(headingByClause.get(String(clause)), sec.heading)
          const bySpan = (spansByClause.get(String(clause)) ?? [])
            .some((sp) => textContainsSpan(sec.subtree_text, sp))
          if (!byHeading && !bySpan) continue
          inferredOk.push(`${clause} -> ${cand.id} (${byHeading ? 'heading' : 'text'})`)
        }
        hit = sec
        break
      }
      if (hit) sectionId.set(String(clause), hit.id)
      else unresolved.push(clause)
    }

    L(`\nmerge target   : ${doc.title} (${doc.instrument_slug})`)
    L(`  sections in document : ${sections.length}`)
    L(`  clauses resolved     : ${sectionId.size} of ${clauses.length}`)
    if (inferredOk.length) {
      L('  inferred and verified:')
      for (const line of inferredOk) L(`    ${line}`)
    }
    if (unresolved.length) {
      throw new Error(`${unresolved.length} pilot clause(s) have no section in `
        + `${doc.title}, and their rules would be orphaned: ${unresolved.join(', ')}`)
    }

    // What is about to be replaced, reported before it happens -- the whole
    // reason this mode exists is that the other one silently destroyed a layer
    // nobody had noticed was there.
    const { rows: [before] } = await client.query(
      `SELECT (SELECT count(*) FROM nsw.rule WHERE document_id=$1) rules,
              (SELECT count(*) FROM nsw.rule_spatial_ref WHERE document_id=$1) spatial,
              (SELECT count(*) FROM nsw.objective WHERE document_id=$1) objectives,
              (SELECT count(*) FROM nsw.proposition WHERE document_id=$1) props_all,
              (SELECT count(*) FROM nsw.proposition
                WHERE document_id=$1 AND extraction_model='part4-pilot') props_pilot`,
      [doc.id])
    L(`  existing rule layer  : ${before.rules} rules, ${before.spatial} spatial refs,`
      + ` ${before.objectives} objectives, ${before.props_pilot} pilot propositions`)
    if (Number(before.props_all) > Number(before.props_pilot)) {
      L(`  keeping              : ${Number(before.props_all) - Number(before.props_pilot)}`
        + ' propositions from other extractors')
    }
    L('  sections and the document row are not touched.')

    if (dryRun) {
      L('\nDry run. Re-run with --apply to write.')
      await client.query('ROLLBACK')
      await client.end().catch(() => {})
      db.close()
      process.exit(0)
    }

    // Rules cascade to effects, applicability, edges and their spatial refs.
    // Spatial refs with no rule, and objectives, hang off the document and need
    // their own delete. Propositions are narrowed to this extractor so a later
    // AI or XML proposition layer survives a re-import.
    await client.query('DELETE FROM nsw.rule WHERE document_id = $1', [doc.id])
    await client.query('DELETE FROM nsw.rule_spatial_ref WHERE document_id = $1', [doc.id])
    await client.query('DELETE FROM nsw.objective WHERE document_id = $1', [doc.id])
    await client.query(
      "DELETE FROM nsw.proposition WHERE document_id = $1 AND extraction_model = 'part4-pilot'",
      [doc.id])
  } else {
    // -- Standalone: the pilot's own document --------------------------
    // Destructive by design, and only safe when nothing else holds this LEP.
    await client.query('DELETE FROM nsw.document WHERE title = $1', [lep.epi_name])

    const { rows: [created] } = await client.query(`
      INSERT INTO nsw.document
        (title, doc_type, scope, hierarchy_level, lga_name, source_url, raw_path,
         as_at_date, ingest_model, ingest_provider)
      VALUES ($1,'lep','local',3,$2,$3,$4,CURRENT_DATE,'part4-pilot','import')
      RETURNING id`,
    [lep.epi_name, lep.lga,
      `https://legislation.nsw.gov.au/view/html/inforce/current/${epi}`,
      'pilot:lep_store.sqlite (Parts 4-6 only)'])
    doc = created

    for (const [i, clause] of clauses.entries()) {
      const text = props.filter((p) => p.clause === clause)
        .map((p) => p.source_span).filter(Boolean).join('\n')
      const { rows: [sec] } = await client.query(`
        INSERT INTO nsw.section (document_id, local_id, level, number, heading, raw_text, depth, sort_order)
        VALUES ($1,$2,'clause',$3,NULL,$4,1,$5) RETURNING id`,
      [doc.id, `sec.${clause}`, String(clause), text, i])
      sectionId.set(String(clause), sec.id)
    }
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
  // In merge mode no section is created; the count is of clauses attached to
  // sections the document already had, and saying "sections" would read as
  // though this had added 75 of them.
  L(MERGE
    ? `  clauses attached ${sectionId.size} (to existing sections)`
    : `  sections        ${clauses.length}`)
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
