/**
 * Ingest a clause-structured DCP into `planningai`.
 *
 * Stages 1, 2, 3t and 5 of docs/rule-layer-pipeline.md — the deterministic
 * half. It does not call an LLM, and everything it writes is grounded in a
 * literal span, so it is safe to run and to re-run.
 *
 *   1  structure  HTML → nsw.section, with rubric and page range
 *   2  route      by rubric, no inference:
 *                   objectives → nsw.objective          (never binding)
 *                   controls / numbered clause → a rule
 *                   note / contents → carried, not extracted
 *   3t tables     control tables → rule_effect, read from cells
 *   3n numerics   "obvious" candidates (comparator + unit) → propositions
 *                 + effects, using the SAME detector as the recall verifier
 *                 so extraction and verification cannot drift apart
 *   5  rollup     rules, effects, objectives, audit findings
 *
 * Prose that is not an obvious numeric control is left for the AI stage,
 * and recorded as an audit finding rather than silently dropped.
 *
 *   npx tsx scripts/ingest-dcp.ts --file public/EPI/DCPs/hornsby-dcp-2024.html \
 *       --title "Hornsby Development Control Plan 2024" --lga Hornsby [--dry-run]
 */

import 'dotenv/config'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { parseDcpHtml } from './lib/dcp-html-parse.mjs'
import { matchLandUses } from './lib/si-landuse.mjs'
import {
  datumOf, datumAt, groundDatumOf, parseSizeBand, splitStoreyBands, headingBand,
  mapAreaOf, isAreaKeyed, headerUnit, isBareNumber, parseDeferral, tableNoOf,
} from './lib/dcp-cells.mjs'
import { findNumberCandidates } from '../server/utils/nsw-kg/verifiers/candidates'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const arg = (f: string, d = '') => {
  const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1]! : d
}

/**
 * Identity comes from the instrument manifest where one exists.
 *
 * The defaults below used to be Hornsby's, so an invocation that forgot its
 * flags silently re-ingested Hornsby under whatever name was intended. And
 * `as_at_date` was hardcoded to CURRENT_DATE — the date the ingest ran,
 * not the date the instrument took legal effect, which is the one thing
 * that column is for.
 *
 * `--manifest` supplies title, LGA, source URL, slug and commencement date
 * together, so they cannot drift apart between runs. Explicit flags still
 * win, for the pre-manifest documents that have none.
 */
const manifestPath = arg('--manifest')
const manifest = manifestPath
  ? JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    instrument: string; title: string; council?: string; lga?: string
    source_page?: string; commenced?: string; endorsed?: string
  }
  : null

const file = arg('--file', manifest ? `public/EPI/DCPs/${manifest.instrument}.html` : '')
const title = arg('--title', manifest?.title ?? '')
const lga = arg('--lga', manifest?.council ?? '')
const sourceUrl = arg('--url', manifest?.source_page ?? '')
/** Idempotency key. See db/nsw-schema-migration-08-document-identity.sql. */
const slug = arg('--slug', manifest?.instrument ?? '')
/** Legal currency date: when the instrument commenced, not when we ran. */
const asAtDate = arg('--as-at', manifest?.commenced ?? '')

const missingArgs = Object.entries({ '--file': file, '--title': title, '--lga': lga, '--url': sourceUrl, '--slug': slug })
  .filter(([, v]) => !v).map(([k]) => k)
if (missingArgs.length) {
  process.stderr.write(
    `Missing required argument(s): ${missingArgs.join(', ')}\n`
    + 'Pass --manifest <manifest.json> to take them from the instrument manifest,\n'
    + 'or supply each explicitly. There are deliberately no defaults: they used to\n'
    + "be one council's values, which made a forgotten flag ingest the wrong document.\n",
  )
  process.exit(1)
}
if (!asAtDate) {
  process.stderr.write(
    'No commencement date: pass --as-at YYYY-MM-DD, or a manifest carrying `commenced`.\n'
    + 'nsw.document.as_at_date is the instrument\'s legal currency date; defaulting it to\n'
    + 'today would record every document as current as of its ingest.\n',
  )
  process.exit(1)
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(asAtDate)) {
  process.stderr.write(`--as-at must be YYYY-MM-DD, got "${asAtDate}"\n`)
  process.exit(1)
}

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const L = (s = '') => process.stdout.write(s + '\n')

/** Topic vocabulary, matched against a heading or caption. */
const TOPIC_PATTERNS: Array<[RegExp, string]> = [
  [/\bsetback/i, 'setback'],
  [/\bheight/i, 'height'],
  [/floor space ratio|\bfsr\b/i, 'fsr'],
  [/\blot size|subdivision/i, 'lot_size'],
  [/\bsite cover/i, 'site_coverage'],
  [/\blandscap/i, 'landscaping'],
  [/\bparking|car park/i, 'parking'],
  [/\bopen space/i, 'open_space'],
  [/\bsolar|sunlight|overshadow/i, 'solar_access'],
  [/\bprivacy/i, 'privacy'],
  [/\bdeep soil/i, 'deep_soil'],
  [/\bfloor area|\bgfa\b/i, 'floor_area'],
  [/\bdensity|dwelling/i, 'density'],
  [/\bwidth|frontage/i, 'width'],
]
const topicOf = (...texts: Array<string | null | undefined>): string | null => {
  const hay = texts.filter(Boolean).join(' ')
  for (const [re, t] of TOPIC_PATTERNS) if (re.test(hay)) return t
  return null
}

/**
 * A DCP's Parts name the development they govern, so the Part is a scope,
 * not just a label. "Part 3 Residential" means every control beneath it
 * applies to residential development — that is stated by the document's own
 * structure and needs no extraction.
 */
const PART_DEV_TYPE: Array<[RegExp, string]> = [
  [/\bresidential\b/i, 'residential'],
  [/\bbusiness\b|\bcommercial\b/i, 'business'],
  [/\bindustrial\b/i, 'industrial'],
  [/\brural\b/i, 'rural'],
  [/\bsubdivision\b/i, 'subdivision'],
  [/\bheritage\b/i, 'heritage'],
  [/\bcommunity\b/i, 'community'],
  [/river settlements?/i, 'river_settlement'],
]
const devTypeOf = (part?: string | null): string | null => {
  if (!part) return null
  for (const [re, t] of PART_DEV_TYPE) if (re.test(part)) return t
  return null
}

/**
 * Comparator hint from the candidate detector → the schema's relation.
 *
 * Every phrase COMPARATOR_PREFIXES can emit has to appear here. It did not,
 * and the gap was invisible: an unmapped hint returned null, which passed
 * straight through to a numeric proposition with no comparator and only
 * surfaced as a check-constraint violation mid-ingest. Getting one wrong is
 * worse than crashing — 'minimum' read as 'lte' inverts the rule — so an
 * unknown phrase throws rather than defaulting.
 */
const CMP: Record<string, string> = {
  minimum: 'gte', min: 'gte', 'at least': 'gte', 'no less than': 'gte',
  'not less than': 'gte', 'must be at least': 'gte', 'must be no less than': 'gte',
  'is at least': 'gte',
  'greater than': 'gt', 'more than': 'gt',
  maximum: 'lte', max: 'lte', 'at most': 'lte', 'is at most': 'lte',
  'no more than': 'lte', 'not more than': 'lte', 'not exceed': 'lte',
  'must not exceed': 'lte', 'not to exceed': 'lte', 'is not to exceed': 'lte',
  'less than': 'lt', 'fewer than': 'lt',
  exactly: 'eq', equal: 'eq',
  // A range needs both bounds and the detector only ever hands over one, so
  // this stays unresolved rather than becoming a one-sided comparison.
  between: '',
}
const cmpOf = (hint: string | null): string | null => {
  if (!hint) return null
  const key = hint.trim().toLowerCase()
  const mapped = CMP[key]
  if (mapped === undefined) throw new Error(`unmapped comparator hint: ${JSON.stringify(hint)}`)
  return mapped || null
}

// ── read ────────────────────────────────────────────────────────────────
const { meta, sections } = parseDcpHtml(readFileSync(file, 'utf8'))
L(`document   : ${title}`)
L(`source     : ${meta.source} (${meta.pages} pages)`)
L(`sections   : ${sections.length}`)

/** Text that belongs to a section including its non-clause descendants —
 *  a "Prescriptive Measures" block holds its content in child blocks. */
const byId = new Map(sections.filter((s) => s.id).map((s) => [s.id!, s]))
function subtreeContent(s: any, forRules = false) {
  const parts: string[] = []
  const tables: any[] = []
  const collect = (node: any) => {
    if (node.text) parts.push(node.text)
    for (const li of node.lists) parts.push(li)
    tables.push(...node.tables)
    for (const child of sections) {
      // A descendant, but stop at the next clause: a clause owns its own text.
      if (!(child.id && node.id && child.id.startsWith(node.id + '.')
            && child.kind !== 'clause' && child.depth === node.depth + 1)) continue
      // When collecting FOR a rule, also stop at any child that is routed
      // somewhere of its own. Without this a clause absorbs the controls
      // block beneath it, both become rule sources, and the same table is
      // read twice — 36 of this document's 150 tables were, and every value
      // in them was written to the database twice under two different rules.
      if (forRules && (child.rubric === 'controls' || child.rubric === 'objectives')) continue
      collect(child)
    }
  }
  collect(s)
  return { text: parts.join('\n'), tables }
}

const isControls = (s: any) => s.rubric === 'controls'
const isObjectives = (s: any) => s.rubric === 'objectives'
const isClause = (s: any) => s.kind === 'clause' && s.number

/**
 * The one rule source that owns each table.
 *
 * Stopping subtree collection at rule-source children removed the
 * clause/controls duplication but not all of it: this DCP contains clauses
 * nested under clauses — including a spurious "4 th Storey AND ABOVE (TOWER
 * ELEMENT)" that the converter numbered `4` from a table row header — and
 * both ancestor and descendant then read the same table. 85 table spans
 * were being written twice that way, which inflates every count and makes
 * one control look like two.
 *
 * Resolved by ownership rather than by de-duplicating afterwards: a table
 * belongs to the nearest rule source at or above the section that contains
 * it, and every other rule source skips it.
 */
const tableOwner = new Map<any, any>()
for (const owner of sections) {
  for (const t of owner.tables) {
    let node: any = owner
    while (node && !(isClause(node) || isControls(node))) {
      const cut: number = node.id ? node.id.lastIndexOf('.') : -1
      node = cut > 0 ? byId.get(node.id.slice(0, cut)) : undefined
    }
    tableOwner.set(t, node ?? owner)
  }
}

const ruleCandidates = sections.filter((s) => isClause(s) || isControls(s))
L(`rule sources: ${ruleCandidates.length} (${sections.filter(isClause).length} clauses, `
  + `${sections.filter(isControls).length} controls blocks)`)

if (dryRun) {
  let numeric = 0, tableEffects = 0, empty = 0
  for (const s of ruleCandidates) {
    const { text, tables } = subtreeContent(s, true)
    const cands = findNumberCandidates(text).filter((c) => c.category === 'obvious')
    numeric += cands.length
    tableEffects += tables.reduce((n, t) => n + t.rows.length, 0)
    if (!text && !tables.length) empty++
  }
  L(`\nDRY RUN — nothing written.`)
  L(`  obvious numeric candidates : ${numeric}`)
  L(`  table rows available       : ${tableEffects}`)
  L(`  rule sources with no content: ${empty}  (audit findings)`)
  process.exit(0)
}

// ── write ───────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: url, statement_timeout: 600_000 })
await client.connect()

const stats = {
  sections: 0, tables: 0, cells: 0, rules: 0, rowRules: 0, effects: 0, tableEffects: 0,
  deferrals: 0, withDatum: 0, withCondition: 0,
  propositions: 0, objectives: 0, findings: 0, applicability: 0,
}

try {
  await client.query('BEGIN')
  // Keyed on the manifest slug, not the title, so a re-run replaces the
  // document instead of adding a near-duplicate beside it. Every dependent
  // row cascades from the document, so this is the whole reset.
  const { rowCount: replaced } = await client.query(
    'DELETE FROM nsw.document WHERE instrument_slug = $1', [slug],
  )
  if (replaced) L(`replacing existing ingest of ${slug}`)

  const { rows: [doc] } = await client.query(`
    INSERT INTO nsw.document
      (title, doc_type, scope, hierarchy_level, lga_name, source_url, raw_path,
       as_at_date, instrument_slug, ingest_model, ingest_provider)
    VALUES ($1,'dcp','local',4,$2,$3,$4,$5,$6,'deterministic-v1','dcp-convert')
    RETURNING id`,
  [title, lga, sourceUrl, file, asAtDate, slug])

  const { rows: [run] } = await client.query(`
    INSERT INTO nsw.ingest_run (document_id, doc_label, status, started_at)
    VALUES ($1,$2,'running',now()) RETURNING id`, [doc.id, title])

  // ── stage 1: sections ────────────────────────────────────────────────
  const sectionId = new Map<string, string>()
  for (const s of sections) {
    const localId = s.id ?? `${s.kind}.${s.order}`
    const { text } = subtreeContent(s)
    const { rows: [row] } = await client.query(`
      INSERT INTO nsw.section
        (document_id, local_id, level, number, heading, raw_text, depth,
         sort_order, source_file, page)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [doc.id, localId,
      s.kind === 'part' ? 'part' : s.kind === 'clause' ? 'clause' : 'paragraph',
      s.number, s.heading, s.text || text, s.depth, s.order,
      s.part, s.pageStart])
    sectionId.set(localId, row.id)
    stats.sections++

    // ── the control tables themselves ──────────────────────────────────
    // Kept as a relation, not flattened into raw_text. The row header is
    // the datum for every value in its row ("Side boundary" → 0.9 m from
    // the side boundary), and a cell with no number can still be the rule
    // ("See Clause 6.1 of HLEP"), so both have to survive ingest.
    for (const [seq, t] of (s.tables as any[]).entries()) {
      const { rows: [tbl] } = await client.query(`
        INSERT INTO nsw.section_table
          (document_id, section_id, seq, table_no, caption, headers, n_rows, n_cols, page)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [doc.id, row.id, seq, tableNoOf(t.caption), t.caption, t.headers,
        t.rows.length, t.headers.length || (t.rows[0]?.length ?? 0), s.pageStart])
      t._cells = []
      t._id = tbl.id
      t._seq = seq
      stats.tables++

      for (const [ri, r] of (t.rows as string[][]).entries()) {
        t._cells[ri] = []
        for (const [ci, text] of r.entries()) {
          if (!text) continue
          const { rows: [cell] } = await client.query(`
            INSERT INTO nsw.section_table_cell
              (table_id, row_idx, col_idx, row_header, col_header, text)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [tbl.id, ri, ci, ci > 0 ? (r[0] ?? null) : null,
            t.headers[ci] ?? null, text.slice(0, 4000)])
          t._cells[ri][ci] = cell.id
          stats.cells++
        }
      }
    }
  }

  // Hierarchy as a foreign key, not just as a string prefix. Coverage and
  // inheritance queries were walking `local_id` with LIKE because nothing
  // ever populated this; the tree is already implied by the ids.
  await client.query(`
    UPDATE nsw.section c SET parent_id = p.id
    FROM nsw.section p
    WHERE c.document_id = $1 AND p.document_id = $1
      AND c.local_id LIKE '%.%'
      AND p.local_id = left(c.local_id, length(c.local_id) - position('.' in reverse(c.local_id)))`,
  [doc.id])

  // ── stage 2/3/5 ──────────────────────────────────────────────────────
  for (const s of sections) {
    const sid = s.id ? sectionId.get(s.id) : undefined

    // Objectives are never binding — held apart, not extracted as rules.
    if (isObjectives(s)) {
      const { text } = subtreeContent(s)
      const items = text.split('\n').map((t) => t.trim()).filter(Boolean)
      for (const [i, t] of items.entries()) {
        await client.query(`
          INSERT INTO nsw.objective (document_id, section_id, clause, seq, text, source_span)
          VALUES ($1,$2,$3,$4,$5,$5)`,
        [doc.id, sid ?? null, s.number ?? nearestClause(s), i, t.slice(0, 4000)])
        stats.objectives++
      }
      continue
    }

    if (!isClause(s) && !isControls(s)) continue

    const clause = s.number ?? nearestClause(s)
    const { text, tables } = subtreeContent(s, true)

    if (!text && !tables.length) {
      await addFinding('empty_rule_source', true, clause,
        s.heading ?? s.id ?? '', 'a controls block or clause with no content')
      continue
    }

    const { rows: [rule] } = await client.query(`
      INSERT INTO nsw.rule
        (document_id, section_id, rule_key, clause, role, kind, src,
         instrument_rank, precedence, provision_ref, part)
      VALUES ($1,$2,$3,$4,$5,'standard',$6,10,0,$7,$8)
      ON CONFLICT (document_id, rule_key) DO UPDATE SET clause = EXCLUDED.clause
      RETURNING id`,
    [doc.id, sid ?? null, s.id ?? `${s.kind}.${s.order}`, clause,
      isControls(s) ? 'controls' : 'base_standard',
      tables.length ? 'table' : 'rubric',
      clause ? `s ${clause}` : null, s.part])
    stats.rules++

    // ── scope, read off the document's own structure ───────────────────
    // A DCP applies to its council area; its Part names the development
    // type; its clause heading names the land uses. None of that needs a
    // model — it is stated by the document and already in hand.
    const clauseScope: Array<[string, string]> = []
    if (lga) clauseScope.push(['area_label', lga])
    const dev = devTypeOf(s.part)
    if (dev) clauseScope.push(['dev_type', dev])
    // Land uses from this heading and from every numbered ancestor, so a
    // control under "3.1 Dwelling Houses" keeps that scope in its subtree.
    for (const heading of headingChain(s)) {
      for (const use of matchLandUses(heading)) clauseScope.push(['land_use', use])
    }

    /** Write a scope list against a rule, ignoring repeats. */
    const writeScope = async (ruleId: string, scope: Array<[string, string]>, span: string) => {
      for (const [dimension, value] of scope) {
        await client.query(`
          INSERT INTO nsw.rule_applicability (rule_id, dimension, value, polarity, source_span)
          VALUES ($1,$2,$3,'applies',$4) ON CONFLICT DO NOTHING`,
        [ruleId, dimension, value, span.slice(0, 2000)])
        stats.applicability++
      }
    }
    await writeScope(rule.id, clauseScope, title)

    // ── 3t: tables read as relations ───────────────────────────────────
    // A control table states three things at once and the number is only
    // one of them. Table 3.1.2-a's "Side boundary | Up to 1 storey = 0.9m
    // 2 storey element = 1.5m" is two rules whose datum is the row header
    // and whose condition is the storey band — read left to right it yields
    // "setback = 1 storey", which is what the first pass recorded.
    const ground = groundDatumOf(text, s.heading)
    // A qualifier on an ancestor heading scopes everything beneath it.
    // "3.4 Residential Flat Buildings (5 Storeys)" is what separates that
    // clause's setbacks from clause 3.3's and 3.5's — all three are the
    // same land use, and without the band a query for a flat building's
    // front setback returns 6, 8, 9, 10 and 12 m with no way to choose.
    // headingChain is already nearest-first, which is the precedence we want.
    const clauseBand = headingBand(headingChain(s))
    // Indexed within THIS rule's subtree, not within the section that owns
    // the table. `_seq` is per owning section, so two tables collected from
    // different children both carried seq 0 — their row rules then shared a
    // rule_key, the ON CONFLICT merged them, and one rule ended up holding
    // the scope of one table's row and the values of another's.
    for (const [ti, t] of (tables as any[]).entries()) {
      if (tableOwner.get(t) !== s) continue   // read once, by its owner
      const topic = topicOf(t.caption, s.heading)
      // Decided once per table so every row agrees about it.
      const areaKeyed = isAreaKeyed(t.headers, t.caption, t.rows[0] ?? [])
      // Most of these tables are built from <td>, so the parser finds no
      // header row and row 0 arrives as data. It still carries the column
      // labels — and with them the units the cells omit — so it is read as
      // a header here without being removed from the rows, which it can be
      // safely because a label row contributes no numbers of its own.
      const colLabels: string[] = t.headers.length ? t.headers : (t.rows[0] ?? [])
      // A caption's comparator governs the whole table ("Minimum Boundary
      // Setbacks"), so a bare "3m" cell beneath it is still a minimum.
      const tableCmp = /\bminimum|\bmin\b/i.test(t.caption ?? '') ? 'gte'
        : /\bmaximum|\bmax\b/i.test(t.caption ?? '') ? 'lte' : null

      for (const [ri, row] of (t.rows as string[][]).entries()) {
        const rowHeader = row[0]
        if (!rowHeader) continue
        // A row header states EITHER a band ("700m² to 2,000m²") or a datum
        // ("Side boundary") — never both, so reading it as a band first
        // keeps a lot-size row from being mistaken for a boundary.
        const rowBand = parseSizeBand(rowHeader)
        // The row header alone. Falling back to the caption looks helpful
        // and is not: every row of "Minimum boundary setbacks …" would then
        // inherit `property_boundary`, so the "Attached dual occupancy" row
        // — whose real datum is the front boundary — would come out stated
        // and wrong instead of NULL and honest.
        const datum = rowBand ? null : datumOf(rowHeader)

        // ── the row's own scope ──────────────────────────────────────
        // A row header carries scope the clause heading never states: the
        // HLEP area code that picks 10.5 m over 20.5 m, and land uses the
        // parking and separation tables list by name. Scope hangs off a
        // rule, so the row needs one of its own — which is what rule_key's
        // ':<slot>' form is for. Rows that yield no effect never get here.
        const rowScope: Array<[string, string]> = [...clauseScope]
        const area = mapAreaOf(rowHeader, areaKeyed)
        if (area) rowScope.push(['map_area', area])
        // Only from a header that is a subject, not one that is a datum or
        // a band — "Side boundary" and "700m² to 2,000m²" name neither a
        // land use nor anything else worth matching.
        if (!datum && !rowBand) {
          for (const use of matchLandUses(rowHeader)) rowScope.push(['land_use', use])
        }
        const rowIsScoped = rowScope.length > clauseScope.length

        // Lazily created: a row that produces nothing should not leave an
        // empty rule behind.
        let rowRuleId: string | null = null
        const ruleFor = async () => {
          if (!rowIsScoped) return rule.id
          if (rowRuleId) return rowRuleId
          const { rows: [rr] } = await client.query(`
            INSERT INTO nsw.rule
              (document_id, section_id, rule_key, clause, role, kind, src,
               instrument_rank, precedence, provision_ref, part, table_id, table_row)
            VALUES ($1,$2,$3,$4,$5,'standard','table',10,1,$6,$7,$8,$9)
            ON CONFLICT (document_id, rule_key) DO UPDATE SET clause = EXCLUDED.clause
            RETURNING id`,
          [doc.id, sid ?? null, `${s.id ?? `${s.kind}.${s.order}`}:t${ti}.r${ri}`,
            clause, isControls(s) ? 'controls' : 'base_standard',
            clause ? `s ${clause}` : null, s.part, t._id ?? null, ri])
          rowRuleId = rr.id
          stats.rowRules++
          stats.rules++
          await writeScope(rr.id, rowScope, `${t.caption ?? ''} | ${rowHeader}`)
          return rr.id
        }

        for (let col = 1; col < row.length; col++) {
          const cell = row[col]
          if (!cell) continue
          const colHeader = t.headers[col] || colLabels[col] || ''
          const colBand = parseSizeBand(colHeader)
          const cellId = (t as any)._cells?.[ri]?.[col] ?? null
          const span = `${rowHeader} | ${colHeader} | ${cell}`.slice(0, 2000)
          let wrote = 0

          const colCmp = /\bminimum|\bmin\b/i.test(colHeader) ? 'gte'
            : /\bmaximum|\bmax\b/i.test(colHeader) ? 'lte' : null
          // A bare number takes its unit from the column that names it.
          const hUnit = isBareNumber(cell) ? headerUnit(colHeader, t.caption) : null
          const scanned = hUnit ? `${cell.trim()}${hUnit}` : cell

          for (const seg of splitStoreyBands(scanned)) {
            for (const c of findNumberCandidates(seg.text)) {
              // Inside a banded segment the storey count is the condition,
              // not the value. Dropping it here is what stops "up to 1
              // storey" being recorded as a 1-storey setback.
              if (seg.condition && c.unit === 'storeys') continue
              const cond = seg.condition ?? colBand ?? rowBand ?? clauseBand
              const isLength = c.unit === 'metre' || c.unit === 'km'
              // The number's own words first, the row header second. In the
              // basement-parking tables the header names the subject and
              // only the cell says which boundary, and the two datums in
              // "8m from the front boundary and 4m from all other
              // boundaries" belong to different numbers.
              const cellDatum = datumAt(seg.text, c.index, c.raw) ?? datum
              // The direction can be stated by the cell, the column
              // ("Maximum Building Height (m)") or the caption ("Minimum
              // Boundary Setbacks"), nearest first. Taking only the caption
              // left the height tables with no comparator at all — a number
              // that does not say which way it points is not a control.
              const cmp = cmpOf(c.comparator_hint) ?? colCmp ?? tableCmp
              await client.query(`
                INSERT INTO nsw.rule_effect
                  (rule_id, effect_type, topic, comparator, value, unit, source_span,
                   measured_from, relative_to, cell_id,
                   condition_metric, condition_lo, condition_hi, condition_unit)
                VALUES ($1,'numeric',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [await ruleFor(), topic ?? 'unspecified', cmp,
                c.value, c.unit, span,
                isLength ? cellDatum : null,
                topic === 'height' ? ground : null,
                cellId,
                cond?.metric ?? null, cond?.lo ?? null, cond?.hi ?? null, cond?.unit ?? null])
              if (isLength && cellDatum) stats.withDatum++
              if (cond) stats.withCondition++
              stats.tableEffects++
              stats.effects++
              wrote++
            }
          }

          // One cell, several values, nothing to choose between them. The
          // front-boundary cell holds 6m, 9m, 7.6m, 3m and 9m, separated by
          // conditions this stage cannot read — road class, a named street,
          // an existing streetscape. All five are true and a resolver has
          // no way to pick, so say so rather than let it guess.
          if (wrote > 1 && !splitStoreyBands(cell).some((g) => g.condition)) {
            await addFinding('ambiguous_cell', false, clause,
              `${rowHeader} | ${colHeader}`,
              `${wrote} values in one cell with no condition to separate them: ${cell.slice(0, 200)}`)
          }

          // No number does not mean no rule: a cell can defer to another
          // instrument or to a map layer, and that deferral is the control.
          // Dropping it is how a height limit silently becomes "no limit".
          if (!wrote) {
            const def = parseDeferral(cell)
            if (!def) continue
            await client.query(`
              INSERT INTO nsw.rule_effect
                (rule_id, effect_type, topic, source_span, measured_from,
                 value_source, map_layer, cell_id)
              VALUES ($1,'numeric',$2,$3,$4,$5,$6,$7)`,
            [await ruleFor(), topic ?? 'unspecified', span, datum,
              def.value_source ?? null, def.map_layer ?? null, cellId])
            stats.deferrals++
            stats.effects++
          }
        }
      }
    }

    // ── 3n: obvious numeric controls in prose ──────────────────────────
    // Only 'obvious' (a comparator AND a unit). Everything weaker is left
    // for the AI stage rather than guessed at.
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      for (const c of findNumberCandidates(trimmed)) {
        if (c.category !== 'obvious') continue
        const cmp = cmpOf(c.comparator_hint)
        // A proposition carrying a number must say which way it points; an
        // unresolved range ("between … and …") is left to the AI stage.
        if (!cmp) {
          await addFinding('unresolved_range', false, clause, s.heading ?? '',
            `range control needs both bounds: ${trimmed.slice(0, 160)}`)
          continue
        }
        await client.query(`
          INSERT INTO nsw.proposition
            (document_id, section_id, type, subject, predicate, source_span,
             numeric_value, numeric_comparator, numeric_unit,
             confidence, verification_status, extraction_model)
          VALUES ($1,$2,'threshold',$3,$4,$5,$6,$7,$8,0.9,'verified','deterministic-v1')`,
        [doc.id, sid ?? null,
          (clause ? `s ${clause}` : title).slice(0, 80),
          trimmed.slice(0, 200), trimmed,
          c.value, cmp, c.unit])
        stats.propositions++

        // Prose states its datum too — "the minimum side boundary setback
        // of a tennis court should be 3 metres" — so read it from the line
        // first and fall back to the heading the line sits under.
        const proseTopic = topicOf(s.heading, trimmed) ?? 'unspecified'
        const proseDatum = (c.unit === 'metre' || c.unit === 'km')
          ? datumOf(trimmed) ?? datumOf(s.heading)
          : null
        // Prose inherits the clause's band for the same reason a table cell
        // does: a control written in words under "3.4 Residential Flat
        // Buildings (5 Storeys)" is a 5-storey control. Leaving it unbanded
        // made it look generally applicable, so it surfaced under every
        // storey filter alongside the banded values it contradicts.
        const proseBand = splitStoreyBands(trimmed).find((g) => g.condition)?.condition
          ?? clauseBand
        await client.query(`
          INSERT INTO nsw.rule_effect
            (rule_id, effect_type, topic, comparator, value, unit, source_span,
             measured_from, relative_to,
             condition_metric, condition_lo, condition_hi, condition_unit)
          VALUES ($1,'numeric',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [rule.id, proseTopic, cmp, c.value, c.unit, trimmed.slice(0, 2000),
          proseDatum, groundDatumOf(trimmed) ?? (proseTopic === 'height' ? ground : null),
          proseBand?.metric ?? null, proseBand?.lo ?? null,
          proseBand?.hi ?? null, proseBand?.unit ?? null])
        if (proseDatum) stats.withDatum++
        if (proseBand) stats.withCondition++
        stats.effects++
      }
    }

    // Prose that carries a control we could not ground deterministically.
    if (!tables.length && /\b(minimum|maximum|must not exceed|at least|no less than)\b/i.test(text)
        && !findNumberCandidates(text).some((c) => c.category === 'obvious')) {
      await addFinding('numeric_lead', false, clause, s.heading ?? '',
        'control language present but no groundable number — needs the AI stage')
    }
  }

  await client.query(`
    UPDATE nsw.ingest_run SET status='success', finished_at=now(), totals=$2 WHERE id=$1`,
  [run.id, JSON.stringify(stats)])
  await client.query(
    'UPDATE nsw.document SET prop_count=$2 WHERE id=$1', [doc.id, stats.propositions])

  await client.query('COMMIT')

  L(`\ningested into planningai:`)
  for (const [k, v] of Object.entries(stats)) L(`  ${k.padEnd(14)} ${String(v).padStart(6)}`)

  async function addFinding(kind: string, gating: boolean, clause: string | null,
    value: string, detail: string) {
    await client.query(`
      INSERT INTO nsw.audit_finding (document_id, run_id, kind, gating, clause, value, detail)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [doc.id, run.id, kind, gating, clause, value.slice(0, 300), detail])
    stats.findings++
  }
} catch (err: any) {
  await client.query('ROLLBACK').catch(() => {})
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  if (err.detail) process.stderr.write(`  ${err.detail}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}

/** This section's heading plus each ancestor's, nearest last. Scope stated
 *  on a parent clause governs everything beneath it. */
function headingChain(s: any): string[] {
  const out: string[] = []
  let id: string | undefined = s.id
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = byId.get(id)
    if (node?.heading) out.push(node.heading)
    const cut = id.lastIndexOf('.')
    if (cut < 0) break
    id = id.slice(0, cut)
  }
  if (s.heading && !out.includes(s.heading)) out.push(s.heading)
  return out
}

/** Nearest numbered ancestor, for a rubric block that has no number. */
function nearestClause(s: any): string | null {
  let id: string | undefined = s.id
  while (id) {
    const cut = id.lastIndexOf('.')
    if (cut < 0) break
    id = id.slice(0, cut)
    const parent = byId.get(id)
    if (parent?.number) return parent.number
  }
  return null
}
