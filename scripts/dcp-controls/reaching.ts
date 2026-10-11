/**
 * How many controls actually reach one lot with one proposal — the number that decides the UI.
 *
 *     npx tsx scripts/dcp-controls/reaching.ts --use "dual occupancy" --locality Beecroft \
 *       build/dcp-controls/hornsby-dcp-2024-spread.json
 *
 * Asked because "how should we present this" has no answer until you know whether the result is eight
 * controls or four hundred. Eight is a page. Four hundred is a different product.
 *
 * The filter runs in the order the scopes actually discriminate, which is not the order you would
 * guess. Measured over 510 controls: dev_type scopes 244 of them, land_use 206, and **locality 184** —
 * a DCP spends a startling share of its text on named places (Dural Village, Epping, Melrose Park
 * Urban Renewal Precinct) and specific addresses (site_ref, 67). For any one lot almost all of those
 * are irrelevant, which makes place the sharpest filter in the document and the first one to apply.
 *
 * Scope matching is three-valued and never silently excludes:
 *   reaches      a scope value matched, or the control has no scope on that dimension
 *   excluded     a scope value is present and demonstrably does not match this lot or proposal
 *   unknown      the dimension cannot be tested yet (the proposal has not said)
 *
 * A control in `unknown` is shown, not hidden. "Cannot tell" is an answer; hiding it is not.
 */
import { readFileSync } from 'node:fs'

interface Row {
  key: string; clause: string | null; text: string; status: string
  rowHeader: string | null; table: string | null; objective: string | null
  control: {
    frame: string; topic: string | null; unit: string | null
    applicability: { dimension: string; value: string }[]
    branches: { value: number | null; terminal: string | null; guard: string | null }[]
    rate: unknown
  } | null
}

type Verdict = 'reaches' | 'excluded' | 'unknown'

/** Fold a scope value for comparison: plurals, punctuation, case. The morphology problem, bounded. */
function fold(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[()–—,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\w+?)(?:ies)\b/g, '$1y')
    .replace(/\b(\w+?)(?<!s)s\b/g, '$1')
    .trim()
}

/** Does a scope value match what we know? Substring either way, because the plan writes both. */
function hit(scopeValue: string, known: string): boolean {
  const a = fold(scopeValue)
  const b = fold(known)
  return a === b || a.includes(b) || b.includes(a)
}

interface Ask {
  /** What is proposed, in Standard Instrument terms. */
  use?: string
  /** Where the lot is: suburb or named precinct. */
  locality?: string
  zone?: string
  storeys?: number
  /** The lot's address, for site_ref controls. */
  address?: string
}

/**
 * Dimensions that NARROW a control, versus dimensions that merely DESCRIBE it.
 *
 * `dev_element` is the clearest case: "front boundary", "private open space" says which part of the
 * building the control is about, not whether the control applies. Treating it as a gate made every
 * control untestable, because nothing supplies it. `topic`, `objective` and `clause` are the same —
 * metadata the model filed under applicability because the prompt offered it a slot.
 *
 * Only a SCOPE dimension can exclude a control. A LABEL rides along and is shown beside the answer.
 */
const LABEL_DIMS = new Set(['dev_element', 'topic', 'objective', 'clause', 'environmental_value'])

/** Dimensions that describe the SITE — we can settle these without asking the applicant. */
const SITE_DIMS = new Set(['locality', 'site_ref', 'zone', 'map_area', 'precinct', 'street', 'block'])
/** Dimensions that describe the PROPOSAL. */
const PROPOSAL_DIMS = new Set(['dev_type', 'land_use', 'storeys', 'dwelling_count', 'bedrooms', 'gfa',
  'dwelling_mix', 'dwelling', 'density', 'height', 'floor_area'])

function reaches(r: Row, ask: Ask): { verdict: Verdict; why: string } {
  const scopes = r.control?.applicability ?? []
  if (!scopes.length) return { verdict: 'reaches', why: 'no scope stated — applies plan-wide' }

  // group by dimension: WITHIN a dimension the rows are alternatives, ACROSS dimensions they all hold.
  // Getting this backwards made cl 4.1C not_applicable on the very lots it governs, on the LEP side.
  const byDim = new Map<string, string[]>()
  for (const s of scopes) {
    if (!byDim.has(s.dimension)) byDim.set(s.dimension, [])
    byDim.get(s.dimension)!.push(s.value)
  }

  let unknown: string | null = null
  for (const [dim, values] of byDim) {
    if (LABEL_DIMS.has(dim)) continue        // describes the control; never excludes it
    const known =
      dim === 'locality' || dim === 'precinct' ? ask.locality
      : dim === 'site_ref' || dim === 'street' ? ask.address
      : dim === 'zone' ? ask.zone
      : dim === 'dev_type' || dim === 'land_use' ? ask.use
      : dim === 'storeys' ? (ask.storeys != null ? String(ask.storeys) : undefined)
      : undefined

    if (known == null) {
      // a dimension we cannot test. Site dimensions we SHOULD be able to test, so note it loudly.
      unknown ??= `${dim} not supplied (${values.slice(0, 2).join(', ')})`
      continue
    }
    if (!values.some(v => hit(v, known))) {
      return { verdict: 'excluded', why: `${dim} is ${values.slice(0, 3).join(' / ')}, this is ${known}` }
    }
  }
  return unknown ? { verdict: 'unknown', why: unknown } : { verdict: 'reaches', why: 'every scope matched' }
}

// ── run ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const ask: Ask = {
  use: flag('--use'), locality: flag('--locality'), zone: flag('--zone'),
  address: flag('--address'), storeys: flag('--storeys') ? Number(flag('--storeys')) : undefined,
}
const files = argv.filter(a => a.endsWith('.json'))
const rows: Row[] = []
for (const f of files) rows.push(...(JSON.parse(readFileSync(f, 'utf8')).rows as Row[]))

const quant = rows.filter(r => r.control && r.control.frame !== 'narrative')
const out = quant.map(r => ({ r, ...reaches(r, ask) }))
const by = (v: Verdict) => out.filter(x => x.verdict === v)

console.log(`asking: ${JSON.stringify(ask)}`)
console.log(`${rows.length} controls · ${quant.length} state a quantity\n`)
console.log(`  reaches   ${String(by('reaches').length).padStart(4)}`)
console.log(`  unknown   ${String(by('unknown').length).padStart(4)}   (a scope we could not test)`)
console.log(`  excluded  ${String(by('excluded').length).padStart(4)}`)

console.log('\nwhat the exclusions were on:')
const why = new Map<string, number>()
for (const x of by('excluded')) {
  const d = x.why.split(' ')[0]!
  why.set(d, (why.get(d) ?? 0) + 1)
}
for (const [d, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${d}`)

console.log('\nwhat reaches it, by topic:')
const byTopic = new Map<string, number>()
for (const x of by('reaches')) {
  const t = x.r.control!.topic ?? `(${x.r.control!.frame})`
  byTopic.set(t, (byTopic.get(t) ?? 0) + 1)
}
for (const [t, n] of [...byTopic].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`)
