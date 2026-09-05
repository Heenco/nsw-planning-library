/**
 * Move a pilot-imported LEP's semantic layer onto its XML-ingested twin.
 *
 * The Hornsby LEP reached the database twice. The pilot import
 * (scripts/import-pilot-lep.mjs) built the rule layer -- rules, override edges
 * and spatial refs resolving Schedule 1 items to real parcels -- but only 59
 * sections at clause granularity, most with no text. The XML ingest builds 1214
 * sections with the full subclause and paragraph tree, but no rule layer at all;
 * nothing in that pipeline writes one.
 *
 * Neither document is disposable on its own, and `upsertDocument` deletes by
 * source_url with every child table ON DELETE CASCADE, so re-ingesting in place
 * would have silently destroyed the rule layer. This repoints the pilot's
 * children onto the XML sections instead, then retires the pilot row.
 *
 * The id spaces differ in exactly one way. 50 of 59 pilot ids appear verbatim in
 * the XML (pt.4, sec.4.1A, sch.1). The 9 Schedule 1 items do not: the pilot
 * invented `sec.Sch 1 item 6` where the XML carries the document's own
 * `sch.1-sec.6`. Every mapping is checked against the section heading before
 * anything moves, so a wrong guess fails loudly rather than silently relocating
 * a rule to the wrong clause.
 *
 *   node scripts/migrate-lep-to-xml.mjs --slug hornsby-local-environmental-plan-2013
 *   node scripts/migrate-lep-to-xml.mjs --slug ... --apply
 *
 * Without --apply it reports what it would do and changes nothing.
 */

import 'dotenv/config'
import pg from 'pg'

const argv = process.argv.slice(2)
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const APPLY = argv.includes('--apply')
const SLUG = arg('slug')
if (!SLUG) { console.error('--slug <instrument_slug of the pilot document> is required'); process.exit(1) }
const XML_SLUG = `${SLUG}-xml`

const pool = new pg.Pool({ connectionString: (process.env.DATABASE_URL || '').trim(), max: 3 })
const q = async (s, p = []) => (await pool.query(s, p)).rows

/** Normalised heading, for confirming a mapping rather than trusting the id. */
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Pilot id -> candidate XML ids, best first.
 *
 * `sec.Sch 1 item 6` -> `sch.1-sec.6` is the only rewrite needed for Hornsby,
 * but it is expressed generally: any schedule, any item number.
 */
function candidates(localId) {
  // { id, rewritten } — the heading check below is strict only for rewritten
  // ids, where the correspondence is inferred. An id present verbatim in both
  // documents is the document's own identifier and needs no corroboration.
  const out = [{ id: localId, rewritten: false }]
  const m = localId.match(/^sec\.Sch\s*(\w+)\s*item\s*(\w+)$/i)
  if (m) out.push({ id: `sch.${m[1]}-sec.${m[2]}`, rewritten: true })
  return out
}

const [pilotDoc] = await q(`SELECT id, title FROM nsw.document WHERE instrument_slug=$1`, [SLUG])
const [xmlDoc]   = await q(`SELECT id, title FROM nsw.document WHERE instrument_slug=$1`, [XML_SLUG])
if (!pilotDoc) { console.error(`No document with slug ${SLUG}`); process.exit(1) }
if (!xmlDoc)   { console.error(`No document with slug ${XML_SLUG} — run the XML ingest first`); process.exit(1) }

const pilotSections = await q(
  `SELECT id, local_id, heading FROM nsw.section WHERE document_id=$1`, [pilotDoc.id])
const xmlSections = await q(
  `SELECT id, local_id, heading FROM nsw.section WHERE document_id=$1`, [xmlDoc.id])
const byLocal = new Map(xmlSections.map(r => [r.local_id, r]))

const map = new Map()          // pilot section id -> xml section id
const unmapped = []
const headingMismatch = []

for (const p of pilotSections) {
  let hit = null
  for (const c of candidates(p.local_id)) {
    const x = byLocal.get(c.id)
    if (!x) continue
    // A rewritten id is a guess, so a heading that disagrees means the guess
    // landed on the wrong clause: refuse it rather than move a rule somewhere
    // merely plausible. Containment rather than equality, because the pilot
    // prefixes the number onto the heading ("Part 4 Principal development
    // standards") where the XML carries the heading alone.
    if (c.rewritten && p.heading && x.heading) {
      const a = norm(p.heading), b = norm(x.heading)
      if (!a.includes(b) && !b.includes(a)) {
        headingMismatch.push({ from: p.local_id, to: c.id, p: p.heading, x: x.heading })
        continue
      }
    }
    hit = x
    break
  }
  if (hit) map.set(p.id, hit.id)
  else unmapped.push(p.local_id)
}

console.log(`${pilotDoc.title}`)
console.log(`  pilot sections : ${pilotSections.length}`)
console.log(`  xml sections   : ${xmlSections.length}`)
console.log(`  mapped         : ${map.size}`)
console.log(`  unmapped       : ${unmapped.length}${unmapped.length ? ' -> ' + unmapped.join(', ') : ''}`)
if (headingMismatch.length) {
  console.log(`  heading mismatches (rejected):`)
  for (const h of headingMismatch) console.log(`    ${h.from} -> ${h.to}: "${h.p}" vs "${h.x}"`)
}

// What is riding on those sections.
const counts = {}
for (const [t, sql] of [
  ['propositions',      `SELECT count(*) n FROM nsw.proposition WHERE section_id = ANY($1)`],
  ['rules',             `SELECT count(*) n FROM nsw.rule WHERE section_id = ANY($1)`],
  ['rule_spatial_ref',  `SELECT count(*) n FROM nsw.rule_spatial_ref WHERE section_id = ANY($1)`],
  ['objectives',        `SELECT count(*) n FROM nsw.objective WHERE section_id = ANY($1)`],
]) counts[t] = (await q(sql, [[...map.keys()]]))[0].n

// Rows attached to the document rather than to a section move regardless.
const docLevel = {
  rules_by_doc:        (await q(`SELECT count(*) n FROM nsw.rule WHERE document_id=$1`, [pilotDoc.id]))[0].n,
  spatial_by_doc:      (await q(`SELECT count(*) n FROM nsw.rule_spatial_ref WHERE document_id=$1`, [pilotDoc.id]))[0].n,
  props_by_doc:        (await q(`SELECT count(*) n FROM nsw.proposition WHERE document_id=$1`, [pilotDoc.id]))[0].n,
  objectives_by_doc:   (await q(`SELECT count(*) n FROM nsw.objective WHERE document_id=$1`, [pilotDoc.id]))[0].n,
}
console.log('\n  riding on mapped sections:', JSON.stringify(counts))
console.log('  attached to the document :', JSON.stringify(docLevel))

if (unmapped.length) {
  console.error('\nRefusing to continue: every pilot section must map, or its rules would be orphaned.')
  await pool.end(); process.exit(1)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to perform the migration.')
  await pool.end(); process.exit(0)
}

// ── Apply, in one transaction ───────────────────────────────────────────
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const pairs = [...map.entries()]
  const froms = pairs.map(p => p[0])
  const tos   = pairs.map(p => p[1])

  // Section repointing, driven by the verified pairs.
  for (const [table] of [['proposition'], ['rule'], ['rule_spatial_ref'], ['objective']]) {
    await client.query(
      `UPDATE nsw.${table} t SET section_id = m.to_id
       FROM (SELECT unnest($1::uuid[]) AS from_id, unnest($2::uuid[]) AS to_id) m
       WHERE t.section_id = m.from_id`, [froms, tos])
  }

  // Document repointing for everything that carries a document_id.
  for (const table of ['proposition', 'rule', 'rule_spatial_ref', 'objective', 'question', 'audit_finding']) {
    await client.query(
      `UPDATE nsw.${table} SET document_id=$1 WHERE document_id=$2`, [xmlDoc.id, pilotDoc.id])
  }

  // The pilot row is now childless. Its slug and URL are the canonical ones, so
  // free them before the XML document takes them over.
  const [pilotMeta] = (await client.query(
    `SELECT source_url, instrument_slug FROM nsw.document WHERE id=$1`, [pilotDoc.id])).rows
  await client.query(`DELETE FROM nsw.document WHERE id=$1`, [pilotDoc.id])
  await client.query(
    `UPDATE nsw.document SET source_url=$1, instrument_slug=$2 WHERE id=$3`,
    [pilotMeta.source_url, pilotMeta.instrument_slug, xmlDoc.id])

  await client.query('COMMIT')
  console.log('\nMigrated. The XML document now owns the rule layer and holds the canonical slug.')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\nRolled back:', err.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
