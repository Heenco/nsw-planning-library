/**
 * Step 2 of the rule pipeline (docs/sepp-rule-pipeline.md): section hashes, and is the graph's text the
 * registered file's text?
 *
 *   npx tsx scripts/pipeline/sections.ts                       # compare every registered SEPP, write nothing
 *   npx tsx scripts/pipeline/sections.ts --apply               # and backfill hashes where the graph matches
 *   npx tsx scripts/pipeline/sections.ts --label housing-sepp  # one instrument
 *   npx tsx scripts/pipeline/sections.ts --doc-type lep        # LEPs instead of SEPPs
 *
 * Parses the registered XML with the parser stage 0 used (parsers/nsw-xml-parser.ts), hashes every section
 * as sha256(heading + "\n" + raw_text) after whitespace normalisation, and compares with nsw.section by
 * local_id:
 *   same      in both, same hash
 *   changed   in both, text differs     -> those sections are what a re-extraction would redo
 *   added     in the file only          -> the graph is behind the file
 *   removed   in the graph only
 * --apply writes section.content_sha256 for same + changed rows (the hash of what the GRAPH holds, so a
 * later comparison against a new file finds exactly the sections that moved), and - only when nothing is
 * changed, added or removed - records the file as ingested (source_registry.last_ingested_sha256) and logs
 * an ingest_run. A graph that does not match its file is reported, never silently overwritten: reloading is
 * stage 0 (scripts/ingest-nsw.ts --stage0-only), run on purpose.
 */
import 'dotenv/config'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { flattenTree, parseNswXml } from '../../server/utils/nsw-kg/parsers/nsw-xml-parser'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const LABEL = argv.includes('--label') ? argv[argv.indexOf('--label') + 1] : null
const DOC_TYPE = argv.includes('--doc-type') ? argv[argv.indexOf('--doc-type') + 1] : 'sepp'

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
export const sectionHash = (heading: string | null | undefined, text: string | null | undefined) =>
  createHash('sha256').update(`${norm(heading)}\n${norm(text)}`).digest('hex')

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const regs = (await client.query(
    `SELECT label, raw_path, raw_format, content_sha256, last_ingested_sha256, document_id
       FROM nsw.source_registry
      WHERE enabled AND document_id IS NOT NULL AND doc_type = $1 AND ($2::text IS NULL OR label = $2)
      ORDER BY label`, [DOC_TYPE, LABEL])).rows

  const summary: any[] = []
  for (const reg of regs) {
    const started = new Date()
    if (reg.raw_format !== 'xml') { summary.push({ label: reg.label, skipped: `raw_format ${reg.raw_format}` }); continue }
    const file = readFileSync(path.resolve(process.cwd(), reg.raw_path), 'utf8')
    const flat = flattenTree(parseNswXml(file).tree)
    const fileHash = new Map(flat.map(s => [s.local_id, sectionHash(s.heading, s.raw_text)]))
    const db = (await client.query(
      `SELECT id, local_id, heading, raw_text FROM nsw.section WHERE document_id = $1`, [reg.document_id])).rows
    const dbHash = new Map(db.map(s => [s.local_id as string, { id: s.id as string, h: sectionHash(s.heading, s.raw_text) }]))

    let same = 0
    const changed: string[] = [], added: string[] = [], removed: string[] = []
    for (const [lid, h] of fileHash) {
      const d = dbHash.get(lid)
      if (!d) added.push(lid)
      else if (d.h === h) same++
      else changed.push(lid)
    }
    for (const lid of dbHash.keys()) if (!fileHash.has(lid)) removed.push(lid)
    const matches = !changed.length && !added.length && !removed.length

    if (APPLY) {
      // the graph's own hash for every row, in one statement
      const ids = [...dbHash.values()].map(v => v.id)
      const hs = [...dbHash.values()].map(v => v.h)
      await client.query(
        `UPDATE nsw.section s SET content_sha256 = x.h FROM unnest($1::uuid[], $2::text[]) AS x(id, h) WHERE s.id = x.id`,
        [ids, hs])
      if (matches) {
        await client.query(
          `UPDATE nsw.source_registry SET last_ingested_sha256 = content_sha256, last_ingested_at = now() WHERE label = $1`,
          [reg.label])
      }
      await client.query(
        `INSERT INTO nsw.ingest_run (id, document_id, doc_label, status, started_at, finished_at, stage_metrics, totals)
         VALUES ($1, $2, $3, $4, $5, now(), $6, $7)`,
        // ingest_run.status is running | success | failed: a graph that drifted from its file is a failed check
        [randomUUID(), reg.document_id, reg.label, matches ? 'success' : 'failed', started,
         JSON.stringify({ step: 2, script: 'scripts/pipeline/sections.ts',
                          outcome: matches ? 'section_hashes_current' : 'section_hashes_drift' }),
         JSON.stringify({ file_sections: fileHash.size, graph_sections: dbHash.size, same, changed: changed.length,
                          added: added.length, removed: removed.length })])
    }
    summary.push({ label: reg.label, file: fileHash.size, graph: dbHash.size, same, changed: changed.length,
                   added: added.length, removed: removed.length, matches,
                   sample: { changed: changed.slice(0, 4), added: added.slice(0, 4), removed: removed.slice(0, 4) } })
  }
  await client.end()

  for (const s of summary) {
    if (s.skipped) { console.log(`  skip      ${s.label}: ${s.skipped}`); continue }
    console.log(`  ${s.matches ? 'MATCH ' : 'DRIFT '}   ${s.label.padEnd(48)} file ${String(s.file).padStart(5)}  graph ${String(s.graph).padStart(5)}  `
      + `same ${s.same}  changed ${s.changed}  added ${s.added}  removed ${s.removed}`)
    if (!s.matches) console.log(`            e.g. ${JSON.stringify(s.sample)}`)
  }
  console.log(APPLY ? '\nsection hashes written; matching sources recorded as ingested' : '\n(compare only - pass --apply to write)')
}

main().catch((e) => { console.error(e); process.exit(1) })
