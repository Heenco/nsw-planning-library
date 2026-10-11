/**
 * Run the three stages over a document and write the controls out as JSON for review.
 *
 *     npx tsx scripts/dcp-controls/run.ts hornsby-dcp-2024 --clause 3.1.2
 *     npx tsx scripts/dcp-controls/run.ts randwick-dcp-2025 --tables --limit 200
 *
 * Nothing is written to the database here. The output is a file a human can read beside the PDF, which
 * is the order the last three rounds of this got wrong: 93 LEP rules were written and rolled back, and
 * two DCPs carry 1,850 effects nobody has ever reviewed. Review first, load second.
 *
 * The run aborts if too large a share of packets fail outright. A partial graph that looks complete is
 * worse than no graph — DeepInfra returning 402 mid-run once committed two councils with zero clauses
 * and one with 84 of 109, and nothing downstream could tell.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'
import { extractControl, type Control } from './extract'
import { packetsFromFile, type Packet } from './packets'
import { verify, type Verdict } from './verify'

loadEnv()

const CONCURRENCY = 6
const FAIL_LIMIT = 0.1

interface Row { packet: Packet; control: Control | null; verdict: Verdict | null; error: string | null }

async function main() {
  const argv = process.argv.slice(2)
  const slug = argv[0]
  if (!slug || slug.startsWith('--')) {
    console.error('usage: run.ts <doc-slug> [--clause 3.1.2 ...] [--tables] [--limit N] [--sample N] [--out path]')
    process.exit(1)
  }
  const apiKey = process.env.DEEPINFRA_API_KEY
  if (!apiKey) { console.error('DEEPINFRA_API_KEY is not set'); process.exit(1) }

  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  const clauses = argv.flatMap((a, i) => (a === '--clause' ? [argv[i + 1]!] : []))
  const limit = Number(flag('--limit') ?? 0) || 0
  const out = flag('--out') ?? `build/dcp-controls/${slug}${clauses.length ? `-${clauses.join('_')}` : ''}.json`

  let packets = packetsFromFile(`public/EPI/DCPs/${slug}.html`, slug, {
    only: clauses, tablesOnly: argv.includes('--tables'),
  })
  if (limit) packets = packets.slice(0, limit)
  // An even spread across the document, not the first N. --limit 140 on Randwick returned contents and
  // definition tables and nothing else, which made the run look like the pipeline could not read a
  // setback when it had simply never been shown one.
  const sample = Number(flag('--sample') ?? 0) || 0
  if (sample && sample < packets.length) {
    const stride = packets.length / sample
    packets = Array.from({ length: sample }, (_, i) => packets[Math.floor(i * stride)]!)
  }
  console.log(`${packets.length} packets from ${slug}${clauses.length ? ` (clauses ${clauses.join(', ')})` : ''}`)
  if (!packets.length) process.exit(0)

  const rows: Row[] = []
  let done = 0, failed = 0
  const queue = [...packets]

  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!
      const r = await extractControl(p, { apiKey })
      if (r.control) {
        rows.push({ packet: p, control: r.control, verdict: verify(r.control, p), error: null })
      } else {
        failed++
        rows.push({ packet: p, control: null, verdict: null, error: r.error })
      }
      done++
      if (done % 25 === 0 || done === packets.length) {
        process.stdout.write(`\r  ${done}/${packets.length}  ${failed} failed   `)
      }
      if (done >= 20 && failed / done > FAIL_LIMIT) {
        queue.length = 0
        console.error(`\nABORTED: ${failed} of ${done} packets failed (>${FAIL_LIMIT * 100}%). `
          + `Last error: ${r.error}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log()

  // ── what the run produced ───────────────────────────────────────────
  const ok = rows.filter(r => r.verdict?.status === 'ok').length
  const review = rows.filter(r => r.verdict?.status === 'review').length
  const rejected = rows.filter(r => r.verdict?.status === 'rejected').length
  const branches = rows.reduce((t, r) => t + (r.control?.branches.length ?? 0), 0)
  const valued = rows.reduce((t, r) => t + (r.control?.branches.filter(b => b.value != null).length ?? 0), 0)
  const guarded = rows.reduce((t, r) =>
    t + (r.control?.branches.filter(b => b.value != null && b.guard).length ?? 0), 0)

  console.log(`\ncontrols   ${rows.length - failed}   ok ${ok} · review ${review} · rejected ${rejected} · failed ${failed}`)
  console.log(`branches   ${branches}   ${valued} carry a number, ${guarded} of those are guarded `
    + `(${valued ? ((100 * guarded) / valued).toFixed(0) : 0}%)`)

  const byFrame = new Map<string, number>()
  for (const r of rows) if (r.control) byFrame.set(r.control.frame, (byFrame.get(r.control.frame) ?? 0) + 1)
  console.log(`frames     ${[...byFrame].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

  const findings = new Map<string, number>()
  for (const r of rows) {
    for (const f of r.verdict?.findings ?? []) {
      const kind = f.split(':')[0]!
      findings.set(kind, (findings.get(kind) ?? 0) + 1)
    }
  }
  if (findings.size) {
    console.log('\nfindings')
    for (const [k, v] of [...findings].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(5)}  ${k}`)
    }
  }

  mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
  writeFileSync(out, JSON.stringify({
    document: slug,
    generatedAt: new Date().toISOString(),
    packets: packets.length,
    summary: { ok, review, rejected, failed, branches, valued, guarded },
    rows: rows.map(r => ({
      key: r.packet.key,
      clause: r.packet.clause.number,
      heading: r.packet.clause.heading,
      page: r.packet.page.page,
      table: r.packet.table?.caption ?? null,
      rowHeader: r.packet.table?.rowPath.join(' > ') ?? null,
      text: r.packet.text,
      objective: r.packet.objective,
      control: r.control,
      status: r.verdict?.status ?? 'failed',
      findings: r.verdict?.findings ?? (r.error ? [`call_failed: ${r.error}`] : []),
      coverage: r.verdict?.coverage ?? null,
    })),
  }, null, 1) + '\n', 'utf8')
  console.log(`\nwrote ${out}`)
}

main().catch(e => { console.error(e); process.exit(1) })
