/**
 * Phase 4 edge builder CLI.
 *
 * Runs reference resolution + all 5 edge builders for one or all documents.
 *
 * Usage:
 *   tsx scripts/build-nsw-edges.ts --doc albury-lep
 *   tsx scripts/build-nsw-edges.ts --all
 */
import 'dotenv/config'
import { buildAllEdges } from '../server/utils/nsw-kg/edges/build-all'
import { nswQuery } from '../server/utils/nsw-kg/pool'
import { listSources } from '../server/utils/nsw-kg/ingest/sources'
import { destroyKgPool } from '../server/utils/kgPool'
import type { IngestEvent } from '../server/utils/nsw-kg/types'

interface DocRow { id: string; title: string }

async function findDocumentByLabel(label: string): Promise<DocRow | null> {
  // Map label → title substring
  const titleMap: Record<string, string> = {
    'albury-lep':   'Albury Local Environmental Plan',
    'housing-sepp': 'State Environmental Planning Policy (Housing)',
    'albury-dcp':   'Albury Development Control Plan',
  }
  const substr = titleMap[label]
  if (!substr) {
    const { rows } = await nswQuery<DocRow>(`
      SELECT d.id, d.title FROM ingest_run r
      JOIN document d ON d.id = r.document_id
      WHERE r.doc_label = $1
      ORDER BY r.started_at DESC LIMIT 1
    `, [label])
    return rows[0] ?? null
  }
  const { rows } = await nswQuery<DocRow>(`
    SELECT id, title FROM document WHERE title LIKE $1 LIMIT 1
  `, [`${substr}%`])
  return rows[0] ?? null
}

function printEvent(label: string) {
  return (evt: IngestEvent) => {
    const tag = `[${label}]`.padEnd(16)
    switch (evt.type) {
      case 'stage_start':
        console.log(`${tag} ► ${evt.stage.padEnd(8)} ${evt.message ?? ''}`)
        break
      case 'stage_done': {
        const counts = evt.counts
          ? Object.entries(evt.counts).map(([k, v]) => `${k}=${v}`).join(' ')
          : ''
        console.log(`${tag} ✓ ${evt.stage.padEnd(8)} ${evt.ms}ms ${counts}`)
        break
      }
      case 'error':
        console.error(`${tag} ✗ ${evt.stage.padEnd(8)} ${evt.message}`)
        break
    }
  }
}

async function runForDoc(label: string) {
  const doc = await findDocumentByLabel(label)
  if (!doc) {
    console.error(`No document found for label '${label}'. Run ingest first.`)
    return false
  }
  console.log(`\n=== ${doc.title} (${doc.id}) ===`)
  const t0 = Date.now()
  try {
    const result = await buildAllEdges(doc.id, printEvent(label))
    console.log(
      `\n  Summary: parent_of=${result.parent_of} defines=${result.defines} ` +
      `requires=${result.requires} constrains=${result.constrains} ` +
      `resolves_to=${result.resolves_to} · total=${result.total_edges} · ${result.ms}ms`,
    )
    console.log(
      `  References: scanned=${result.resolution.scanned} found=${result.resolution.found} ` +
      `resolved=${result.resolution.resolved} unresolved=${result.resolution.unresolved}`,
    )
    return true
  } catch (err) {
    console.error(`  FAILED: ${(err as Error).message}`)
    return false
  }
}

async function main() {
  const argv = process.argv
  let doc: string | null = null
  let all = false
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--doc') doc = argv[++i] ?? null
    else if (a === '--all') all = true
  }

  if (!doc && !all) {
    console.error('usage: tsx scripts/build-nsw-edges.ts --doc <label> | --all')
    process.exit(1)
  }

  // --all picks up every registered source (10 SEPPs + 6 LEPs + 1 DCP at
  // time of writing). Missing docs (not yet ingested) are reported and
  // skipped without failing the batch.
  const labels = all ? listSources() : [doc!]
  let ok = true
  for (const l of labels) {
    const r = await runForDoc(l)
    if (!r) ok = false
  }

  destroyKgPool()
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err)
  destroyKgPool()
  process.exit(1)
})
