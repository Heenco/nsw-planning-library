/**
 * Seed nsw.source_registry from the static SOURCES map.
 *
 * One-shot, idempotent. Copies the documents that were hardcoded in
 * server/utils/nsw-kg/ingest/sources.ts into the database so that the
 * registry becomes the source of truth and adding an instrument stops
 * being a code change.
 *
 * Run migration 04 first:
 *   node scripts/apply-nsw-migration.mjs 04-source-registry
 *
 * Then:
 *   npx tsx scripts/seed-source-registry.ts          # seed
 *   npx tsx scripts/seed-source-registry.ts --dry    # show what would change
 */

import { SOURCES } from '../server/utils/nsw-kg/ingest/sources'
import { upsertSource, listRegistered } from '../server/utils/nsw-kg/ingest/registry'
import { destroyKgPool } from '../server/utils/kgPool'

async function main() {
  const dry = process.argv.includes('--dry')

  const existing = await listRegistered()
  const existingLabels = new Set(existing.map((s) => s.label))
  const labels = Object.keys(SOURCES).sort()

  console.log(`Static sources: ${labels.length}`)
  console.log(`Already in nsw.source_registry: ${existing.length}\n`)

  let inserted = 0
  let updated = 0

  for (const label of labels) {
    const src = SOURCES[label]!
    const isNew = !existingLabels.has(label)

    if (dry) {
      console.log(`  ${isNew ? 'INSERT' : 'UPDATE'}  ${label.padEnd(38)} ${src.doc_type}  ${src.title}`)
      isNew ? inserted++ : updated++
      continue
    }

    await upsertSource({ ...src, origin: 'registry', enabled: true })
    console.log(`  ${isNew ? 'inserted' : 'updated '}  ${label.padEnd(38)} ${src.doc_type}`)
    isNew ? inserted++ : updated++
  }

  console.log(`\n${dry ? '[dry run] ' : ''}${inserted} inserted, ${updated} updated.`)

  if (!dry) {
    const after = await listRegistered()
    console.log(`nsw.source_registry now holds ${after.length} rows.`)
  }
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => destroyKgPool())
