/**
 * Stage 5 backfill CLI — embeddings + BM25 for nsw.proposition.
 *
 * Usage:
 *   tsx scripts/embed-nsw-props.ts --doc albury-lep
 *   tsx scripts/embed-nsw-props.ts --all
 *
 * Idempotent: only processes rows where embedding/search_vector IS NULL.
 */
import 'dotenv/config'
import { embedNswPropositions } from '../server/utils/nsw-kg/embed/embed-batch'
import { backfillBm25, countMissingBm25 } from '../server/utils/nsw-kg/embed/bm25'
import { nswQuery } from '../server/utils/nsw-kg/pool'
import { listSources } from '../server/utils/nsw-kg/ingest/sources'
import { destroyKgPool } from '../server/utils/kgPool'

interface Args { doc: string | null; all: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { doc: null, all: false }
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--doc') a.doc = argv[++i] ?? null
    else if (v === '--all') a.all = true
  }
  return a
}

async function findDocId(label: string): Promise<{ id: string; title: string } | null> {
  // Look up via the most recent ingest_run for this label — this works for
  // every doc the ingest CLI knows about, no hardcoded title map needed.
  const { rows } = await nswQuery<{ id: string; title: string }>(`
    SELECT d.id, d.title
    FROM ingest_run r
    JOIN document d ON d.id = r.document_id
    WHERE r.doc_label = $1
    ORDER BY r.started_at DESC
    LIMIT 1
  `, [label])
  return rows[0] ?? null
}

async function processDoc(label: string | null, apiKey: string) {
  let docId: string | undefined
  let title = '(all docs)'
  if (label) {
    const doc = await findDocId(label)
    if (!doc) { console.error(`No document found for label '${label}'`); return false }
    docId = doc.id
    title = doc.title
  }

  console.log(`\n=== ${title} ===`)

  // BM25 first (cheap, single SQL)
  console.log(`  ► BM25 backfill…`)
  const bm25 = await backfillBm25(docId)
  console.log(`  ✓ BM25  ${bm25.updated} rows updated in ${bm25.ms}ms`)

  // Embeddings (costlier, batched)
  console.log(`  ► Embeddings backfill…`)
  let lastPct = -1
  const emb = await embedNswPropositions({
    documentId: docId,
    apiKey,
    onProgress: (done, total) => {
      const pct = Math.floor((done / total) * 100)
      if (pct !== lastPct && pct % 10 === 0) {
        console.log(`    ${done}/${total} (${pct}%)`)
        lastPct = pct
      }
    },
  })
  console.log(`  ✓ Embeddings  ${emb.embedded}/${emb.total} in ${emb.ms}ms`)

  const stillMissing = await countMissingBm25(docId)
  if (stillMissing > 0) {
    console.warn(`  ⚠ ${stillMissing} propositions still missing search_vector`)
  }

  return true
}

async function main() {
  const args = parseArgs(process.argv)
  const apiKey = process.env.DEEPINFRA_API_KEY
  if (!apiKey) { console.error('DEEPINFRA_API_KEY required'); process.exit(1) }

  const labels = args.all
    ? listSources()
    : args.doc
      ? [args.doc]
      : []
  if (labels.length === 0) {
    console.error('usage: tsx scripts/embed-nsw-props.ts --doc <label> | --all')
    process.exit(1)
  }

  const t0 = Date.now()
  for (const l of labels) {
    await processDoc(l, apiKey)
  }
  console.log(`\nTotal: ${Date.now() - t0}ms`)

  destroyKgPool()
  process.exit(0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  destroyKgPool()
  process.exit(1)
})
