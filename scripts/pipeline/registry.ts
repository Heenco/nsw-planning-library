/**
 * Step 1 of the rule pipeline (docs/sepp-rule-pipeline.md): register every source and say which are due.
 *
 *   npx tsx scripts/pipeline/registry.ts            # upsert the registry, print the currency table
 *   npx tsx scripts/pipeline/registry.ts --dry      # print only
 *   npx tsx scripts/pipeline/registry.ts --json     # machine-readable, for the orchestrator (step 12)
 *
 * For each instrument in the static SOURCES map (server/utils/nsw-kg/ingest/sources.ts) it:
 *   - upserts its nsw.source_registry row (raw_path stored repo-relative, so the row is not tied to one
 *     machine),
 *   - links it to its nsw.document by title,
 *   - hashes the file on disk into content_sha256,
 *   - and reports a status:
 *       due        the file differs from what the graph was last built from (or the pipeline has never
 *                  recorded a build: last_ingested_sha256 is null)
 *       current    content_sha256 = last_ingested_sha256
 *       missing    raw_path does not exist on this machine
 *       unloaded   no nsw.document carries this title yet
 *
 * scripts/seed-source-registry.ts does the upsert through kgPool, which needs an SSH tunnel key; this
 * connects with DATABASE_URL like every other planningai script, and adds the hash and the link.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { SOURCES } from '../../server/utils/nsw-kg/ingest/sources'

const DRY = process.argv.includes('--dry')
const JSON_OUT = process.argv.includes('--json')
const ROOT = process.cwd()

export interface CurrencyRow {
  label: string
  doc_type: string
  title: string
  raw_path: string
  document_id: string | null
  sha: string | null
  last_ingested_sha256: string | null
  status: 'due' | 'current' | 'missing' | 'unloaded'
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const docs = (await client.query(`SELECT id, lower(title) AS t, doc_type FROM nsw.document`)).rows
  const byTitle = new Map(docs.map(d => [`${d.doc_type}|${d.t}`, d.id as string]))

  const out: CurrencyRow[] = []
  for (const src of Object.values(SOURCES).sort((a, b) => a.label.localeCompare(b.label))) {
    const rel = path.relative(ROOT, src.raw_path).split(path.sep).join('/')
    const abs = path.resolve(ROOT, rel)
    const sha = existsSync(abs) ? createHash('sha256').update(readFileSync(abs)).digest('hex') : null
    const documentId = byTitle.get(`${src.doc_type}|${src.title.toLowerCase()}`) ?? null

    if (!DRY) {
      await client.query(
        `INSERT INTO nsw.source_registry (label, title, doc_type, scope, hierarchy_level, lga_name, source_url,
                                          raw_path, raw_format, as_at_date, origin, content_sha256, enabled, document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'registry', $11, true, $12)
         ON CONFLICT (label) DO UPDATE SET
           title = EXCLUDED.title, doc_type = EXCLUDED.doc_type, scope = EXCLUDED.scope,
           hierarchy_level = EXCLUDED.hierarchy_level, lga_name = EXCLUDED.lga_name,
           source_url = EXCLUDED.source_url, raw_path = EXCLUDED.raw_path, raw_format = EXCLUDED.raw_format,
           as_at_date = EXCLUDED.as_at_date, content_sha256 = EXCLUDED.content_sha256,
           document_id = EXCLUDED.document_id, updated_at = now()`,
        [src.label, src.title, src.doc_type, src.scope, src.hierarchy_level, src.lga_name, src.source_url,
         rel, src.raw_format, src.as_at_date, sha, documentId])
    }
    const last = (await client.query(`SELECT last_ingested_sha256 FROM nsw.source_registry WHERE label = $1`, [src.label])).rows[0]
    const lastSha = last?.last_ingested_sha256 ?? null
    const status: CurrencyRow['status'] = !sha ? 'missing' : !documentId ? 'unloaded' : lastSha === sha ? 'current' : 'due'
    out.push({ label: src.label, doc_type: src.doc_type, title: src.title, raw_path: rel, document_id: documentId,
               sha, last_ingested_sha256: lastSha, status })
  }

  // documents in the graph with no registry row: loaded some other way, so no run can keep them current
  const registered = out.map(r => r.document_id).filter((x): x is string => !!x)
  const unregistered = (await client.query(
    `SELECT d.instrument_slug, d.doc_type FROM nsw.document d
      WHERE NOT (d.id = ANY($1::uuid[])) ORDER BY d.doc_type, d.instrument_slug`, [registered])).rows

  await client.end()

  if (JSON_OUT) { console.log(JSON.stringify({ sources: out, unregistered }, null, 1)); return }
  const tally = (s: string) => out.filter(r => r.status === s).length
  console.log(`${DRY ? '[dry] ' : ''}${out.length} sources: ${tally('due')} due, ${tally('current')} current, `
    + `${tally('missing')} file missing, ${tally('unloaded')} not in nsw.document\n`)
  for (const r of out) {
    console.log(`  ${r.status.padEnd(9)} ${r.doc_type.padEnd(4)} ${r.label.padEnd(52)} ${r.sha ? r.sha.slice(0, 10) : '-'.padEnd(10)}  ${r.raw_path}`)
  }
  console.log(`\n${unregistered.length} documents in nsw.document have no registry row:`)
  for (const u of unregistered) console.log(`  ${u.doc_type.padEnd(4)} ${u.instrument_slug}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
