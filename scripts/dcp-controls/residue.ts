/**
 * Every control that did not come out usable, classified by root cause.
 *
 *     npx tsx scripts/dcp-controls/residue.ts build/dcp-controls/*-spread.json
 *
 * Written because "87.8%" is not actionable and "get to 100%" is not answerable without knowing what
 * the missing 12.2% is made of. The three categories below need completely different responses, and
 * conflating them is how a pipeline gets chased toward an accuracy figure it cannot reach:
 *
 *   FIXABLE      a defect in our code or prompt. Costs engineering time, and the ceiling is 100%.
 *   JUDGEMENT    the document states something a machine cannot settle - a merit test, a neighbour's
 *                building line, "to Council's satisfaction". No amount of engineering reaches it;
 *                the honest outcome is a flagged control, not a number.
 *   SOURCE       the number is not in the document. A formula stored as an image, a blank where a
 *                value should be, a table that failed OCR. Unreachable by definition.
 *
 * The only target that is both honest and achievable is: **every control is either correct or
 * flagged — zero silent errors.** That is 100% of something worth having. 100% automatic extraction
 * of a corpus that includes merit judgements and missing numbers is not a target, it is a promise to
 * fabricate the difference.
 */
import { readFileSync } from 'node:fs'

interface Branch { value: number | null; terminal: string | null; guard: string | null; span: string }
interface Row {
  key: string; clause: string | null; text: string; status: string; findings: string[]
  rowHeader: string | null; table: string | null
  control: {
    frame: string; topic: string | null; unit: string | null; defersTo: string | null
    branches: Branch[]; rate: { terms: unknown[]; percentOfSpaces: unknown } | null
  } | null
}

type Cls = 'FIXABLE' | 'JUDGEMENT' | 'SOURCE'

interface Cause { cls: Cls; cause: string; fix: string }

/** Words that mean a human decides. Not a defect — the document is telling us it is discretionary. */
const MERIT = /merit assessment|council'?s? satisfaction|as determined by|where appropriate|suitable|desirable|having regard to|generally|should be designed|character|amenity|visual impact|appropriate to/i
/** Words that point at a value we hold nowhere. */
const UNRESOLVABLE = /prevailing|established building line|adjoining (building|development)|neighbouring|streetscape/i
/** The signatures of a document that lost its own content in conversion. */
const DEGRADED = /^[\s.·_-]*$|\[\s*\]|\.\.\.\.|^\(?\s*\)?$|refer to (figure|diagram|image)|as shown (in|on) (figure|diagram)/i

function classify(r: Row): Cause {
  const c = r.control
  const f = r.findings.map(x => x.split(':')[0])

  if (!c) return { cls: 'FIXABLE', cause: 'call_failed', fix: 'retry; the model call did not return' }

  // ── source degradation: the words are not there to read ────────────────
  if (DEGRADED.test(r.text) || r.text.trim().length < 3) {
    return { cls: 'SOURCE', cause: 'cell_empty_or_illegible',
             fix: 'the cell carries no readable value — emit source_illegible and show the gap' }
  }
  if (/formula|calculated in accordance|where S =|where H =/i.test(r.text)) {
    return { cls: 'SOURCE', cause: 'formula_as_image',
             fix: 'the formula is an image in the source PDF; no extractor recovers it' }
  }

  // ── judgement: the control is discretionary by construction ─────────────
  if (c.frame === 'merit' || MERIT.test(r.text)) {
    return { cls: 'JUDGEMENT', cause: 'merit_test',
             fix: 'record as a merit control with its objective; never evaluate it' }
  }
  if (UNRESOLVABLE.test(r.text) || f.includes('guard_unresolvable')) {
    return { cls: 'JUDGEMENT', cause: 'guard_unresolvable',
             fix: 'needs data we hold nowhere (neighbouring footprints); declare it, do not guess' }
  }

  // ── fixable: our code or our prompt ─────────────────────────────────────
  if (f.includes('span_not_literal')) {
    return { cls: 'FIXABLE', cause: 'span_not_literal',
             fix: 'the model paraphrased its quote — add a repair pass that re-asks for the exact words' }
  }
  if (f.includes('guard_unknown') || f.includes('topic_unknown')) {
    return { cls: 'FIXABLE', cause: 'vocabulary_gap',
             fix: 'the term is real and missing from the registry — widen the vocabulary' }
  }
  if (c.frame === 'rate' && !(c.rate?.terms.length || c.rate?.percentOfSpaces)) {
    return { cls: 'FIXABLE', cause: 'rate_grammar_gap',
             fix: 'a rate shape the parser does not read yet — add the case to rates.ts self-test' }
  }
  if (c.frame === 'deferral' && !c.defersTo) {
    return { cls: 'FIXABLE', cause: 'deferral_target_missing',
             fix: 'the pointer was not captured — require defers_to on the deferral frame' }
  }
  if (c.frame === 'dimensional' && !c.branches.length) {
    return { cls: 'FIXABLE', cause: 'no_branches',
             fix: 'the model returned no branches for a cell that states a control' }
  }
  if (c.frame === 'dimensional' && !c.branches.some(b => b.value != null || b.terminal)) {
    return { cls: 'FIXABLE', cause: 'branch_without_value',
             fix: 'a branch quoted words that carry no number the reader could find' }
  }
  if (c.frame === 'narrative' && /\d/.test(r.text)) {
    return { cls: 'FIXABLE', cause: 'misframed_as_narrative',
             fix: 'the cell states a quantity and was framed as prose — a frame-classification error' }
  }
  return { cls: 'FIXABLE', cause: `other (${f.join(',') || r.status})`, fix: 'needs a look' }
}

function usable(r: Row): boolean {
  const c = r.control
  if (!c || r.status === 'rejected') return false
  if (c.frame === 'rate') return Boolean(c.rate && (c.rate.terms?.length || c.rate.percentOfSpaces))
  if (c.frame === 'deferral') return Boolean(c.defersTo)
  if (c.frame === 'merit') return true
  return c.branches.some(b => b.value != null || b.terminal)
}

const files = process.argv.slice(2).filter(a => !a.startsWith('--'))
const verbose = process.argv.includes('--examples')
const rows: Row[] = []
for (const f of files) rows.push(...(JSON.parse(readFileSync(f, 'utf8')).rows as Row[]))

const quant = rows.filter(r => r.control && r.control.frame !== 'narrative')
const bad = quant.filter(r => !usable(r))
// a narrative control that states a number is a misframe, and belongs in the residue
const misframed = rows.filter(r => r.control?.frame === 'narrative' && /\d{1,4}\s*(m\b|sqm|%|spaces)/i.test(r.text))

console.log(`${rows.length} controls · ${quant.length} quantitative · ${quant.length - bad.length} usable `
  + `(${((100 * (quant.length - bad.length)) / quant.length).toFixed(1)}%)`)
console.log(`residue: ${bad.length} quantitative failures + ${misframed.length} narrative controls that `
  + `state a measurement\n`)

const byCause = new Map<string, { cls: Cls; n: number; fix: string; eg: Row[] }>()
for (const r of [...bad, ...misframed]) {
  const { cls, cause, fix } = classify(r)
  if (!byCause.has(cause)) byCause.set(cause, { cls, n: 0, fix, eg: [] })
  const e = byCause.get(cause)!
  e.n++
  if (e.eg.length < 3) e.eg.push(r)
}

const tot = [...byCause.values()].reduce((t, x) => t + x.n, 0)
for (const cls of ['FIXABLE', 'JUDGEMENT', 'SOURCE'] as Cls[]) {
  const group = [...byCause].filter(([, v]) => v.cls === cls).sort((a, b) => b[1].n - a[1].n)
  const n = group.reduce((t, [, v]) => t + v.n, 0)
  if (!n) continue
  console.log(`${cls}  —  ${n} of ${tot} (${((100 * n) / tot).toFixed(0)}% of the residue)`)
  for (const [cause, v] of group) {
    console.log(`   ${String(v.n).padStart(4)}  ${cause}`)
    console.log(`         ${v.fix}`)
    if (verbose) for (const r of v.eg) console.log(`         e.g. ${JSON.stringify(r.text.slice(0, 84))}`)
  }
  console.log()
}

const fixable = [...byCause.values()].filter(v => v.cls === 'FIXABLE').reduce((t, v) => t + v.n, 0)
const ceiling = (100 * (quant.length - (tot - fixable))) / quant.length
console.log(`If every FIXABLE cause were fixed, the quantitative figure would be ${ceiling.toFixed(1)}%.`)
console.log('The remainder is judgement and source degradation: controls that cannot be resolved by any')
console.log('extractor, and whose correct outcome is a flagged control rather than a number.')
