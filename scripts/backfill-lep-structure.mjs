/**
 * Give the LEP the headings and Part containers it was imported without.
 *
 * The LEP clauses came from the Part 4–6 pilot's SQLite, which carried the
 * clause number and body but neither the clause TITLE nor the Part it sits
 * in. So `nsw.section.heading` is NULL for all 55 rows — clause 4.3 is in
 * the database with no record that it is "Height of buildings" — and there
 * is no section row for "Part 4" for a clause to hang off, which is why
 * `parent_id` had nothing to point at. The content was never missing; the
 * scaffolding was.
 *
 * Both are recoverable from the converted LEP HTML, whose section ids are
 * already the database's `local_id` ('sec.4.3'), so nothing has to be
 * matched heuristically.
 *
 *   node scripts/backfill-lep-structure.mjs [--dry-run]
 *   node scripts/backfill-lep-structure.mjs --file <path> --title <doc title>
 */

import 'dotenv/config'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'htmlparser2'
import { textContent, getAttributeValue, findAll } from 'domutils'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const file = arg('--file', 'public/EPI/LEPs/hornsby-local-environmental-plan-2013.html')
const title = arg('--title', 'Hornsby Local Environmental Plan 2013')

const url = (process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const L = (s = '') => process.stdout.write(s + '\n')

// ── read the document ──────────────────────────────────────────────────
const doc = parseDocument(readFileSync(file, 'utf8'), { decodeEntities: true })

/** Heading text of a section's own <h1..h6>, minus the leading number. */
const headOf = (el) => {
  const h = findAll((e) => /^h[1-6]$/.test(e.name), el.children ?? []).find(
    (e) => e.parent === el)
  if (!h) return null
  const no = (h.children ?? []).find(
    (c) => c.type === 'tag' && (getAttributeValue(c, 'class') ?? '').includes('lep-no'))
  const full = textContent(h).replace(/\s+/g, ' ').trim()
  const number = no ? textContent(no).replace(/\s+/g, ' ').trim() : null
  // "4.3 Height of buildings" → heading "Height of buildings", number "4.3"
  const heading = number && full.startsWith(number)
    ? full.slice(number.length).trim() : full
  return { number, heading, full }
}

const clauses = new Map()   // local_id → {number, heading}
const containers = []       // {local_id, label, kind}

for (const el of findAll((e) => e.name === 'section', doc.children)) {
  const cls = getAttributeValue(el, 'class') ?? ''
  const id = getAttributeValue(el, 'id')
  if (!id) continue
  const h = headOf(el)
  if (!h) continue
  if (cls.includes('lep-clause')) clauses.set(id, h)
  else if (cls.includes('lep-part') || cls.includes('lep-schedule')) {
    containers.push({ local_id: id, label: h.full, kind: cls.includes('lep-part') ? 'part' : 'schedule' })
  }
}

L(`source     : ${file}`)
L(`clauses    : ${clauses.size} with headings`)
L(`containers : ${containers.length} Parts/Schedules`)

// ── write ──────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: url, statement_timeout: 300_000 })
await client.connect()

try {
  await client.query('BEGIN')

  const { rows: [docRow] } = await client.query(
    'SELECT id FROM nsw.document WHERE title = $1', [title])
  if (!docRow) throw new Error(`no document titled ${JSON.stringify(title)}`)

  const { rows: existing } = await client.query(`
    SELECT id, local_id, number, heading, sort_order
    FROM nsw.section WHERE document_id = $1 ORDER BY sort_order`, [docRow.id])

  // 1 ── headings, matched by local_id ────────────────────────────────
  // The pilot flattened Schedule 1 items to 'sec.Sch 1 item 3' where the
  // document calls them 'sch.1-sec.3'. Worth aliasing rather than skipping:
  // a Schedule 1 heading is the site address ("Use of certain land at 69–73
  // Bay Road, Berrilee"), which is what rule_spatial_ref needs to geocode.
  const alias = (localId) => {
    const m = /^sec\.Sch (\d+) item (\d+)$/.exec(localId)
    return m ? `sch.${m[1]}-sec.${m[2]}` : localId
  }

  let headed = 0, unmatched = []
  for (const s of existing) {
    const h = clauses.get(s.local_id) ?? clauses.get(alias(s.local_id))
    if (!h?.heading) { if (!s.heading) unmatched.push(s.local_id); continue }
    await client.query('UPDATE nsw.section SET heading = $2 WHERE id = $1', [s.id, h.heading])
    headed++
  }

  // 2 ── Part / Schedule containers, but only the ones that have children
  //      in this database. Inserting all 19 Parts when only 4–6 were
  //      ingested would claim a coverage the document layer does not have.
  const wanted = new Map()
  for (const s of existing) {
    const m = /^sec\.(\d+)\./.exec(s.local_id)
    if (m) { wanted.set(`pt.${m[1]}`, true); continue }
    const sch = /^sec\.Sch (\d+) item/.exec(s.local_id)
    if (sch) wanted.set(`sch.${sch[1]}`, true)
  }

  const containerId = new Map()
  let inserted = 0
  // Negative sort_order keeps a container ahead of its clauses without
  // renumbering the rows the pilot import already ordered.
  let order = -containers.length - 1
  for (const c of containers) {
    if (!wanted.has(c.local_id)) continue
    const { rows: [row] } = await client.query(`
      INSERT INTO nsw.section
        (document_id, local_id, level, number, heading, raw_text, depth, sort_order)
      VALUES ($1,$2,$3,$4,$5,'',0,$6)
      ON CONFLICT DO NOTHING
      RETURNING id`,
    [docRow.id, c.local_id, c.kind, c.label.split(/\s+/).slice(0, 2).join(' '), c.label, order++])
    if (row) { containerId.set(c.local_id, row.id); inserted++ }
    else {
      const { rows: [old] } = await client.query(
        'SELECT id FROM nsw.section WHERE document_id=$1 AND local_id=$2', [docRow.id, c.local_id])
      if (old) containerId.set(c.local_id, old.id)
    }
  }

  // 3 ── link each clause to its container ─────────────────────────────
  // By clause number, not by local_id prefix: the LEP names its Parts
  // 'pt.4' while its clauses are 'sec.4.3', so the prefix rule that works
  // for the DCP finds nothing here. That mismatch is exactly why the
  // generic backfill reported 55 orphans.
  let linked = 0
  for (const s of existing) {
    const m = /^sec\.(\d+)\./.exec(s.local_id)
    const sch = /^sec\.Sch (\d+) item/.exec(s.local_id)
    const parent = m ? containerId.get(`pt.${m[1]}`) : sch ? containerId.get(`sch.${sch[1]}`) : null
    if (!parent) continue
    await client.query('UPDATE nsw.section SET parent_id = $2 WHERE id = $1', [s.id, parent])
    linked++
  }

  L(`\nheadings written    : ${headed}/${existing.length}`)
  if (unmatched.length) L(`  still without one : ${unmatched.join(', ')}`)
  L(`containers inserted : ${inserted}  (${[...containerId.keys()].join(', ')})`)
  L(`clauses linked      : ${linked}`)

  L('\nafter:')
  for (const r of (await client.query(`
    SELECT s.level, count(*)::int n, count(s.heading)::int headed, count(s.parent_id)::int linked
    FROM nsw.section s WHERE s.document_id = $1 GROUP BY 1 ORDER BY 1`, [docRow.id])).rows) {
    L(`  ${String(r.level).padEnd(10)} ${String(r.n).padStart(4)} rows, ${r.headed} headed, ${r.linked} linked`)
  }
  L('\nsample:')
  for (const r of (await client.query(`
    SELECT c.number, c.heading, p.heading AS part
    FROM nsw.section c LEFT JOIN nsw.section p ON p.id = c.parent_id
    WHERE c.document_id = $1 AND c.parent_id IS NOT NULL
    ORDER BY c.sort_order LIMIT 6`, [docRow.id])).rows) {
    L(`  ${String(r.number).padEnd(9)} ${String(r.heading ?? '(none)').slice(0, 40).padEnd(41)} ← ${r.part}`)
  }

  if (dryRun) { await client.query('ROLLBACK'); L('\nDRY RUN — rolled back.') }
  else { await client.query('COMMIT'); L('\nCOMMITTED.') }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
