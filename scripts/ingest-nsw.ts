/**
 * NSW KG v2 ingest CLI.
 *
 * Usage:
 *   tsx scripts/ingest-nsw.ts --doc albury-lep
 *   tsx scripts/ingest-nsw.ts --doc housing-sepp
 *   tsx scripts/ingest-nsw.ts --doc albury-dcp
 *   tsx scripts/ingest-nsw.ts --all              (sequential)
 *   tsx scripts/ingest-nsw.ts --all --parallel   (cross-document parallel)
 *
 * Drives the orchestrator at server/utils/nsw-kg/ingest/orchestrator.ts.
 * In Phase 2 the orchestrator runs Stage 0 (fetch + parse + sections) only;
 * later phases bolt on the LLM stages.
 */
import 'dotenv/config'
import { runIngest } from '../server/utils/nsw-kg/ingest/orchestrator'
import { getSource, listSources, SOURCES } from '../server/utils/nsw-kg/ingest/sources'
import { destroyKgPool } from '../server/utils/kgPool'
import type { IngestEvent } from '../server/utils/nsw-kg/types'

// ── Argv parsing ────────────────────────────────────────────────────────

interface Args {
  doc?:       string
  all:        boolean
  parallel:   boolean
  stage0Only: boolean
  maxClauses: number | null
  help:       boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, parallel: false, stage0Only: false, maxClauses: null, help: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--doc') args.doc = argv[++i]
    else if (a === '--all') args.all = true
    else if (a === '--parallel') args.parallel = true
    else if (a === '--stage0-only') args.stage0Only = true
    else if (a === '--max') args.maxClauses = Number(argv[++i])
    else if (a === '-h' || a === '--help') args.help = true
  }
  return args
}

function printHelp() {
  console.log(`
NSW KG v2 ingest CLI

Usage:
  tsx scripts/ingest-nsw.ts --doc <label>            Run a single document
  tsx scripts/ingest-nsw.ts --all [--parallel]       Run all documents
  tsx scripts/ingest-nsw.ts --doc <label> --max 20   Smoke test — decompose only first 20 clauses
  tsx scripts/ingest-nsw.ts --doc <label> --stage0-only  Stage 0 only (fetch + parse + sections)

Documents:
${listSources().map((l) => `  - ${l.padEnd(14)} ${SOURCES[l]!.title}`).join('\n')}
`)
}

// ── Pretty event printer ────────────────────────────────────────────────

function makeEventPrinter(label: string) {
  return (evt: IngestEvent) => {
    const tag = `[${label}]`.padEnd(16)
    switch (evt.type) {
      case 'stage_start':
        console.log(`${tag} ► ${evt.stage.padEnd(9)} ${evt.message ?? ''}`)
        break
      case 'stage_progress': {
        const pct = evt.total ? ` (${Math.round((evt.current / evt.total) * 100)}%)` : ''
        console.log(`${tag}   ${evt.stage.padEnd(9)} ${evt.current}/${evt.total ?? '?'}${pct} ${evt.message ?? ''}`)
        break
      }
      case 'stage_done': {
        const counts = evt.counts
          ? Object.entries(evt.counts).map(([k, v]) => `${k}=${v}`).join(' ')
          : ''
        console.log(`${tag} ✓ ${evt.stage.padEnd(9)} ${evt.ms}ms ${counts}`)
        break
      }
      case 'flag':
        console.log(`${tag} ⚠ ${evt.stage.padEnd(9)} ${evt.question_type}: ${evt.detail}`)
        break
      case 'error':
        console.error(`${tag} ✗ ${evt.stage.padEnd(9)} ${evt.message}`)
        break
      case 'run_done': {
        const totals = Object.entries(evt.totals).map(([k, v]) => `${k}=${v}`).join(' ')
        console.log(`${tag} ═ DONE in ${evt.ms}ms — ${totals}`)
        break
      }
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function ingestOne(label: string, args: Args) {
  const src = getSource(label)
  const onEvent = makeEventPrinter(label)
  return runIngest({
    src,
    onEvent,
    stage0Only:  args.stage0Only,
    maxClauses:  args.maxClauses ?? undefined,
    deepinfraKey: process.env.DEEPINFRA_API_KEY,
  })
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) { printHelp(); return }

  if (!args.stage0Only && !process.env.DEEPINFRA_API_KEY) {
    console.error('ERROR: DEEPINFRA_API_KEY env var required for Stage 1 decomposition. Use --stage0-only to skip.')
    process.exit(1)
  }

  let labels: string[]
  if (args.all) {
    labels = listSources()
  } else if (args.doc) {
    labels = [args.doc]
  } else {
    printHelp()
    process.exit(1)
  }

  console.log(`\nNSW KG v2 ingest — ${labels.length} document(s)${args.parallel ? ' (parallel)' : ''}\n`)

  const t0 = Date.now()
  const results: Array<{ label: string; ok: boolean; sections?: number; error?: string }> = []

  if (args.parallel && labels.length > 1) {
    const settled = await Promise.allSettled(labels.map((l) => ingestOne(l, args)))
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]!
      const label = labels[i]!
      if (s.status === 'fulfilled') {
        results.push({ label, ok: true, sections: s.value.sections })
      } else {
        results.push({ label, ok: false, error: (s.reason as Error)?.message ?? String(s.reason) })
      }
    }
  } else {
    for (const label of labels) {
      try {
        const r = await ingestOne(label, args)
        results.push({ label, ok: true, sections: r.sections })
      } catch (err) {
        results.push({ label, ok: false, error: (err as Error).message })
      }
    }
  }

  console.log(`\n──── Summary (${Date.now() - t0}ms) ────`)
  for (const r of results) {
    if (r.ok) console.log(`  ✓ ${r.label.padEnd(14)} ${r.sections} sections`)
    else      console.log(`  ✗ ${r.label.padEnd(14)} ${r.error}`)
  }

  destroyKgPool()
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err)
  destroyKgPool()
  process.exit(1)
})
