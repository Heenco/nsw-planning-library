/**
 * Read the stage-3 output and say, per subject, how much of it came out usable.
 *
 *     npx tsx scripts/dcp-controls/summarise.ts build/dcp-controls/*-spread.json
 *
 * One number for a whole document hides the thing that matters. "68% ok" is true and useless: it does
 * not say whether setbacks work and parking does not, which was exactly the situation two runs ago. A
 * subject that is 95% usable and one that is 20% usable need different work, and the only way to see
 * that is to group by subject.
 *
 * "Usable" here means: the control carries something a planner could act on — a number with a unit, a
 * parsed rate, a named deferral target, or an explicit merit call — AND the gate did not reject it.
 * A control that is merely `ok` but states nothing is not usable, and counting it would flatter the run.
 */
import { readFileSync } from 'node:fs'

interface Row {
  key: string
  clause: string | null
  heading: string | null
  table: string | null
  rowHeader: string | null
  text: string
  objective: string | null
  status: string
  findings: string[]
  control: {
    frame: string
    topic: string | null
    unit: string | null
    defersTo: string | null
    branches: { value: number | null; terminal: string | null; guard: string | null }[]
    rate: { terms: unknown[]; percentOfSpaces: unknown } | null
  } | null
}

/** The subject a control belongs to: the topic the extractor assigned, else its frame. */
function subjectOf(r: Row): string {
  if (!r.control) return '(no control)'
  return r.control.topic ?? `(${r.control.frame}, no topic)`
}

function usable(r: Row): boolean {
  const c = r.control
  if (!c || r.status === 'rejected') return false
  if (c.frame === 'rate') return Boolean(c.rate && ((c.rate.terms?.length ?? 0) > 0 || c.rate.percentOfSpaces))
  if (c.frame === 'deferral') return Boolean(c.defersTo)
  if (c.frame === 'merit') return true
  return c.branches.some(b => b.value != null || b.terminal)
}

const files = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!files.length) {
  console.error('usage: summarise.ts <run.json> [<run.json> ...]')
  process.exit(1)
}

interface Agg { n: number; usable: number; guarded: number; valued: number; docs: Set<string> }
const bySubject = new Map<string, Agg>()
const byDoc = new Map<string, { n: number; usable: number }>()
const findings = new Map<string, number>()
let total = 0
let narrative = 0

for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8')) as { document: string; rows: Row[] }
  for (const r of d.rows) {
    total++
    // a narrative control states no quantity by design; counting it against its subject
    // understates every subject that carries a lot of prose, which is most of them
    if (r.control?.frame === 'narrative') { narrative++; continue }
    const s = subjectOf(r)
    if (!bySubject.has(s)) bySubject.set(s, { n: 0, usable: 0, guarded: 0, valued: 0, docs: new Set() })
    const a = bySubject.get(s)!
    a.n++
    a.docs.add(d.document)
    if (usable(r)) a.usable++
    for (const b of r.control?.branches ?? []) {
      if (b.value != null) { a.valued++; if (b.guard) a.guarded++ }
    }
    const dd = byDoc.get(d.document) ?? { n: 0, usable: 0 }
    dd.n++
    if (usable(r)) dd.usable++
    byDoc.set(d.document, dd)
    for (const x of r.findings) {
      const k = x.split(':')[0]!
      findings.set(k, (findings.get(k) ?? 0) + 1)
    }
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '—')

console.log(`${total} controls from ${files.length} run(s) \u2014 ${total - narrative} state a quantity, `
  + `${narrative} are narrative and are left out of the table\n`)
console.log(`${'subject'.padEnd(26)}${'n'.padStart(6)}${'usable'.padStart(9)}${'guarded'.padStart(10)}   docs`)
console.log('-'.repeat(68))
for (const [s, a] of [...bySubject].sort((x, y) => y[1].n - x[1].n)) {
  console.log(
    s.padEnd(26)
    + String(a.n).padStart(6)
    + pct(a.usable, a.n).padStart(9)
    + (a.valued ? pct(a.guarded, a.valued) : '—').padStart(10)
    + `   ${a.docs.size}`)
}
console.log('-'.repeat(68))
for (const [d, a] of byDoc) console.log(`${d.slice(0, 26).padEnd(26)}${String(a.n).padStart(6)}${pct(a.usable, a.n).padStart(9)}`)

console.log('\nfindings')
for (const [k, v] of [...findings].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`)
}
console.log('\n"guarded" is the share of numeric branches whose value is selected by a named condition.')
console.log('A low figure is correct where the scope lives in the table headers rather than in the cell.')
