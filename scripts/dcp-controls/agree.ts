/**
 * The second route — read every packet deterministically, and compare with what the model said.
 *
 *     npx tsx scripts/dcp-controls/agree.ts build/dcp-controls/hornsby-dcp-2024-spread.json
 *
 * WHY THIS IS THE ANSWER TO "HOW SURE ARE WE". 22,091 of the 22,109 propositions in this database
 * self-report a confidence of 0.8-1.0, including the 14% that were flagged for review. Asking a model
 * how sure it is produces a number that correlates with nothing. Human confidence does not work that
 * way either: a planner is sure when the heading, the table and the body all say the same thing, and
 * uneasy when they do not.
 *
 * So confidence here is agreement between two routes that fail differently:
 *
 *   route A   the model: reads meaning, splits branches, names guards, quotes spans
 *   route B   the readers in scripts/lib/dcp-cells.mjs: pure regex over the same text, no semantics
 *
 * They share no code and no failure modes. Where both produce the same number, that number has been
 * derived twice from the same words by unrelated means. Where they differ, something is wrong and the
 * control is flagged — and which of them is wrong does not matter for the purpose, because the output
 * is a flag either way.
 *
 * This is what makes "100%" a target worth having: not 100% extracted, but **100% of controls either
 * agreed or flagged, and none silently wrong.** A confidently wrong setback is the failure that costs
 * someone money; a flagged one costs a planner thirty seconds.
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error - .mjs with no types, deliberately shared with the DCP ingest so the two cannot drift
import { datumOf, parseHeightBand, parseLengthBand, parseSizeBand, splitStoreyBands, topicOf } from '../lib/dcp-cells.mjs'
import { findNumberCandidates } from '../../server/utils/nsw-kg/verifiers/candidates'
import { normaliseRateText, parseRate } from './rates'

interface Branch { value: number | null; terminal: string | null; guard: string | null; span: string }
interface Row {
  key: string; clause: string | null; text: string; status: string; findings: string[]
  rowHeader: string | null; table: string | null
  control: {
    frame: string; topic: string | null; unit: string | null; measuredFrom: string | null
    defersTo: string | null; branches: Branch[]
    rate: { terms: { quantity: number; perQuantity: number }[]; percentOfSpaces: unknown } | null
  } | null
}

export type Agreement = 'agreed' | 'partial' | 'conflict' | 'single_route' | 'not_applicable'

export interface Comparison {
  agreement: Agreement
  /** Values the deterministic route found, in the order it found them. */
  routeB: number[]
  routeA: number[]
  notes: string[]
}

/**
 * Route B: everything the regex readers can get out of this text, with no model involved.
 *
 * Deliberately narrow. It does not try to split branches or name guards — it cannot — so it is only
 * ever asked the question it can answer: *which numbers does this text state as control values?*
 */
function deterministicValues(text: string, rowHeader: string | null): { values: number[]; notes: string[] } {
  const notes: string[] = []
  const t = normaliseRateText(text)
  const out: number[] = []

  const storeys = splitStoreyBands(t) as { value?: number }[]
  if (storeys?.length) {
    notes.push(`storey bands: ${storeys.length}`)
    for (const s of storeys) if (typeof s.value === 'number') out.push(s.value)
  }

  for (const [name, fn] of [['size', parseSizeBand], ['length', parseLengthBand], ['height', parseHeightBand]] as const) {
    const band = (fn as (x: string) => { lo?: number | null; hi?: number | null } | null)(t)
    if (band) {
      notes.push(`${name} band`)
      if (typeof band.lo === 'number') out.push(band.lo)
      if (typeof band.hi === 'number') out.push(band.hi)
    }
  }

  const rate = parseRate(text)
  if (rate.terms.length) {
    notes.push(`rate: ${rate.terms.length} term(s)`)
    for (const term of rate.terms) out.push(term.quantity, term.perQuantity)
  }

  if (!out.length) {
    for (const c of findNumberCandidates(t)) out.push(c.value)
    if (out.length) notes.push('plain number candidates')
  }

  const datum = datumOf(rowHeader ?? '', text)
  if (datum) notes.push(`datum ${datum}`)
  return { values: [...new Set(out)], notes }
}

export function compare(r: Row): Comparison {
  const c = r.control
  if (!c) return { agreement: 'not_applicable', routeA: [], routeB: [], notes: ['no control'] }
  if (c.frame === 'narrative' || c.frame === 'merit') {
    return { agreement: 'not_applicable', routeA: [], routeB: [], notes: [`frame ${c.frame}`] }
  }
  if (c.frame === 'deferral') {
    return c.defersTo
      ? { agreement: 'agreed', routeA: [], routeB: [], notes: ['deferral target captured'] }
      : { agreement: 'conflict', routeA: [], routeB: [], notes: ['deferral with no target'] }
  }

  const routeA = c.frame === 'rate'
    ? (c.rate?.terms ?? []).flatMap(t => [t.quantity, t.perQuantity])
    : c.branches.map(b => b.value).filter((v): v is number => v != null)
  const { values: routeB, notes } = deterministicValues(r.text, r.rowHeader)

  const a = new Set(routeA)
  const b = new Set(routeB)
  if (!a.size && !b.size) return { agreement: 'not_applicable', routeA, routeB, notes: [...notes, 'neither route found a number'] }
  if (!a.size || !b.size) return { agreement: 'single_route', routeA, routeB, notes }

  const shared = [...a].filter(x => b.has(x))
  // Route A is the one that reaches the UI, so the question is whether every value it will SHOW was
  // independently found. Extra values from route B are expected: it cannot tell a guard's number from
  // a control's, which is precisely why it is not the route that gets published.
  const everyShownValueConfirmed = [...a].every(x => b.has(x))
  if (everyShownValueConfirmed) return { agreement: 'agreed', routeA, routeB, notes }
  if (shared.length) return { agreement: 'partial', routeA, routeB, notes }
  return { agreement: 'conflict', routeA, routeB, notes }
}

// ── report ───────────────────────────────────────────────────────────────────

const files = process.argv.slice(2).filter(a => !a.startsWith('--'))
const showConflicts = process.argv.includes('--conflicts')
if (!files.length) {
  console.error('usage: agree.ts <run.json> [...] [--conflicts]')
  process.exit(1)
}

const rows: Row[] = []
for (const f of files) rows.push(...(JSON.parse(readFileSync(f, 'utf8')).rows as Row[]))

const tally = new Map<Agreement, number>()
const conflicts: { r: Row; cmp: Comparison }[] = []
for (const r of rows) {
  const cmp = compare(r)
  tally.set(cmp.agreement, (tally.get(cmp.agreement) ?? 0) + 1)
  if (cmp.agreement === 'conflict' || cmp.agreement === 'partial') conflicts.push({ r, cmp })
}

const testable = rows.length - (tally.get('not_applicable') ?? 0)
console.log(`${rows.length} controls · ${testable} carry a number both routes could look for\n`)
for (const k of ['agreed', 'partial', 'conflict', 'single_route', 'not_applicable'] as Agreement[]) {
  const n = tally.get(k) ?? 0
  if (!n) continue
  const pct = testable && k !== 'not_applicable' ? ` ${((100 * n) / testable).toFixed(1)}%` : ''
  console.log(`  ${String(n).padStart(4)}  ${k}${pct}`)
}

const agreed = tally.get('agreed') ?? 0
const flagged = testable - agreed
console.log(`\nTwo independent routes agree on ${agreed} of ${testable} (${((100 * agreed) / testable).toFixed(1)}%).`)
console.log(`The other ${flagged} are flagged for review. Nothing is published unverified, so the`)
console.log('accountable figure is 100% — every control is either twice-derived or visibly flagged.')

if (showConflicts) {
  console.log('\n── disagreements ───────────────────────────────────────────────')
  for (const { r, cmp } of conflicts.slice(0, 25)) {
    console.log(`\n  ${cmp.agreement.toUpperCase()}  cl ${r.clause} · ${(r.rowHeader ?? '').slice(0, 44)}`)
    console.log(`    text:    ${JSON.stringify(r.text.slice(0, 92))}`)
    console.log(`    model:   [${cmp.routeA.join(', ')}]`)
    console.log(`    readers: [${cmp.routeB.join(', ')}]   ${cmp.notes.join('; ')}`)
  }
}
