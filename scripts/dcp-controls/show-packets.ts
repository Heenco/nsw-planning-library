/**
 * Print the stage-1 packets for a clause, exactly as the model will see them.
 *
 *     npx tsx scripts/dcp-controls/show-packets.ts hornsby-dcp-2024 3.1.2
 *     npx tsx scripts/dcp-controls/show-packets.ts randwick-dcp-2025 --stats
 *
 * Kept rather than thrown away because the packet IS the interpretation: if the row header or the
 * objective is missing here, no amount of prompting in stage 2 recovers it, and the failure is invisible
 * once it has become a number in a table. Reading a handful of packets by eye before each run is the
 * cheapest check in this pipeline.
 */
import { existsSync } from 'node:fs'
import { packetsFromFile, renderPacket } from './packets'

const [slug, ...rest] = process.argv.slice(2)
if (!slug) {
  console.error('usage: show-packets.ts <doc-slug> [clause-prefix ...] [--stats] [--prose]')
  process.exit(1)
}
const stats = rest.includes('--stats')
const withProse = rest.includes('--prose')
const only = rest.filter(a => !a.startsWith('--'))

const path = `public/EPI/DCPs/${slug}.html`
if (!existsSync(path)) {
  console.error(`no such document: ${path}`)
  process.exit(1)
}

const packets = packetsFromFile(path, slug, { only, tablesOnly: !withProse })

if (stats) {
  const tables = packets.filter(p => p.kind === 'table')
  const prose = packets.filter(p => p.kind === 'prose')
  const withObj = packets.filter(p => p.objective).length
  const withRow = tables.filter(p => p.table?.rowPath.length).length
  const withCol = tables.filter(p => p.table?.colPath.length).length
  const withPage = packets.filter(p => p.page.page != null).length
  const clauses = new Set(packets.map(p => p.clause.id)).size
  const pct = (n: number) => `${((100 * n) / Math.max(1, packets.length)).toFixed(1)}%`
  console.log(`${slug}`)
  console.log(`  packets        ${packets.length}  (${tables.length} table, ${prose.length} prose) across ${clauses} clauses`)
  console.log(`  with objective ${withObj}  ${pct(withObj)}`)
  console.log(`  with page      ${withPage}  ${pct(withPage)}`)
  if (tables.length) {
    console.log(`  row header     ${withRow}  ${((100 * withRow) / tables.length).toFixed(1)}% of table packets`)
    console.log(`  col header     ${withCol}  ${((100 * withCol) / tables.length).toFixed(1)}% of table packets`)
  }
  process.exit(0)
}

console.log(`${packets.length} packets${only.length ? ` under ${only.join(', ')}` : ''}\n`)
for (const p of packets) {
  console.log('─'.repeat(92))
  console.log(renderPacket(p))
  console.log(`   [page ${p.page.page ?? '?'} · ${p.key}]`)
}
