/**
 * Load norms into the nsw graph (migration 25): nsw.norm + nsw.norm_unchecked.
 *
 *   npx tsx scripts/norms/load.ts                       # family 'subdivision' from norms/subdivision/
 *   npx tsx scripts/norms/load.ts --dry                 # say what would change, write nothing
 *
 * The files under norms/<family>/ are the reviewed source (built and gated by scripts/norms/build-subdivision.ts); the
 * graph is where the app reads them. Per norm id:
 *   unchanged (same when / then / despite / subject_to)  -> author, review and gate notes refreshed in place
 *   changed                                              -> the current row retired (valid_to = now), a new version added
 *   no longer produced                                   -> retired, never deleted
 * A file whose norms have open gate findings is refused - the gate is what makes a norm safe to read.
 * The unchecked clauses of each document are replaced as a set. One transaction per document.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const FAMILY = 'subdivision'
const DIR = `norms/${FAMILY}`

const sha = (n: any) => createHash('sha256').update(JSON.stringify({ when: n.when, then: n.then, despite: n.despite ?? [], subjectTo: n.subjectTo ?? [] })).digest('hex')

async function main() {
  const files = [join(DIR, 'housing-sepp-2021.json'), ...readdirSync(join(DIR, 'lep')).filter(f => f.endsWith('.json')).map(f => join(DIR, 'lep', f))].filter(existsSync)
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const totals = { added: 0, changed: 0, same: 0, retired: 0, unchecked: 0, refused: 0 }
  for (const f of files) {
    const file = JSON.parse(readFileSync(f, 'utf8'))
    const doc = (await client.query(`SELECT id FROM nsw.document WHERE title = $1`, [file.instrument])).rows[0]
    if (!doc) { console.log(`  SKIP ${f}: no nsw.document titled "${file.instrument}"`); continue }
    const dirty = file.norms.filter((n: any) => n.gate?.length)
    if (dirty.length) { console.log(`  REFUSED ${f}: ${dirty.length} norm(s) with gate findings`); totals.refused++; continue }
    const secIds = new Map((await client.query(`SELECT local_id, id FROM nsw.section WHERE document_id = $1`, [doc.id])).rows.map(r => [r.local_id, r.id]))
    const current = new Map((await client.query(`SELECT id, content_sha256 FROM nsw.norm WHERE family = $1 AND document_id = $2 AND valid_to IS NULL`, [FAMILY, doc.id])).rows.map(r => [r.id, r.content_sha256]))
    const seen = new Set<string>()
    if (!DRY) await client.query('BEGIN')
    try {
      for (const n of file.norms) {
        seen.add(n.id)
        const h = sha(n)
        const args = [n.id, FAMILY, doc.id, secIds.get(n.section) ?? null, n.section, n.clause, JSON.stringify(n.when), JSON.stringify(n.then),
          n.despite ?? [], n.subjectTo ?? [], JSON.stringify(n.author ?? {}), n.review ?? null, JSON.stringify(n.gate ?? []), h]
        if (current.get(n.id) === h) {
          totals.same++
          if (!DRY) await client.query(`UPDATE nsw.norm SET author = $2, review = $3, gate = $4, updated_at = now() WHERE id = $1 AND valid_to IS NULL`,
            [n.id, JSON.stringify(n.author ?? {}), n.review ?? null, JSON.stringify(n.gate ?? [])])
          continue
        }
        if (current.has(n.id)) { totals.changed++; if (!DRY) await client.query(`UPDATE nsw.norm SET valid_to = now() WHERE id = $1 AND valid_to IS NULL`, [n.id]) }
        else totals.added++
        if (!DRY) await client.query(
          `INSERT INTO nsw.norm (id, family, document_id, section_id, section, clause, "when", "then", despite, subject_to, author, review, gate, content_sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, args)
      }
      const gone = [...current.keys()].filter(id => !seen.has(id))
      totals.retired += gone.length
      if (!DRY && gone.length) await client.query(`UPDATE nsw.norm SET valid_to = now() WHERE id = ANY($1) AND valid_to IS NULL`, [gone])
      totals.unchecked += (file.unchecked ?? []).length
      if (!DRY) {
        await client.query(`DELETE FROM nsw.norm_unchecked WHERE family = $1 AND document_id = $2`, [FAMILY, doc.id])
        for (const u of file.unchecked ?? []) await client.query(
          `INSERT INTO nsw.norm_unchecked (family, document_id, section, clause, why, zones) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [FAMILY, doc.id, u.section, u.clause, u.why ?? null, u.zones ?? null])
        await client.query('COMMIT')
      }
    } catch (e) { if (!DRY) await client.query('ROLLBACK'); throw e }
  }
  console.log(`${DRY ? '[dry] ' : ''}${FAMILY}: ${totals.added} added, ${totals.changed} changed (new version), ${totals.same} unchanged, ${totals.retired} retired; ${totals.unchecked} unchecked clauses; ${totals.refused} file(s) refused`)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
