/**
 * Parking and other rates — their own structure, because they are not conditional controls.
 *
 * A setback is a value selected by a condition on the SITE. A parking rate is a quantity computed from
 * the PROPOSAL, and forcing it through the same (value, guard) branch model loses it: "1/150m2 GLFA"
 * produced no value at all, and "1 space/workroom + 1 space per 2 employees" kept the first term and
 * dropped the second. 91 of 178 controls in one Hornsby clause are rates, so this is not an edge.
 *
 * A rate is a SUM OF TERMS:
 *
 *     1 space per 150 m2 GLFA              -> [ {1 space, per 150 sqm_glfa} ]
 *     1 space/workroom + 1 per 2 employees -> [ {1 space, per 1 workroom}, {1 space, per 2 employee} ]
 *     3 per surgery                        -> [ {3 space, per 1 surgery} ]
 *
 * Deterministic on purpose. The grammar is small and regular, the model has no advantage here, and a
 * parser can be tested against every distinct rate cell in the corpus — which `--self-test` does.
 *
 * THE CONVERTER MANGLES SUPERSCRIPTS. "150m2 GLFA" arrives as "150m 2 GLFA", so a naive reader sees two
 * numbers and pairs the wrong one. Normalising that before parsing is the single most important step
 * here; without it roughly a third of the rate cells in Hornsby parse to the wrong denominator.
 */

export interface RateTerm {
  /** How many of the thing being required: 1 space, 0.4 space, 5 racks. */
  quantity: number
  /** What is being required. */
  unit: string
  /** Per how many of the denominator. "per dwelling" is 1; "per 150 m2" is 150. */
  perQuantity: number
  /** What it is per: dwelling, employee, sqm_gfa, surgery, work bay. */
  perUnit: string
  /** The words this term was read from. */
  span: string
}

export interface Rate {
  terms: RateTerm[]
  /** A band rather than a rate: "1-2% of spaces". */
  percentOfSpaces?: { lo: number; hi: number } | null
  /** Anything after the arithmetic that qualifies it. Kept, never silently dropped. */
  qualifier: string | null
  /** Why the parse failed, where it did. */
  problem: string | null
}

// ── normalisation ────────────────────────────────────────────────────────────

/**
 * Put a mangled cell back into a shape the grammar can read.
 *
 * "m 2" / "m2" / "m²" all become "sqm". The space before the 2 is a lost superscript, and it is the
 * difference between "per 150 sqm" and "per 2 of something".
 */
const WORD_NUM: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', ten: '10', twelve: '12', fifteen: '15', twenty: '20',
}

export function normaliseRateText(s: string): string {
  return s
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00b2/g, '2')
    // no \b before the m: "150m 2" has no boundary between the digit and the letter, which is exactly
    // the case that matters, and leaving it out read the denominator as 2 instead of 150
    .replace(/(\d)\s*m\s*2(?![0-9])/gi, '$1 sqm')
    .replace(/\bm\s*2(?![0-9])/gi, 'sqm')
    .replace(/\bsq\.?\s*m(?:etres?)?\b/gi, 'sqm')
    // 'for every 10 dwellings' and 'for each dwelling' are 'per' - Hornsby writes both
    .replace(/\bfor (?:every|each)\b/gi, 'per')
    // filler between the thing required and the 'per': "1 space is to be provided per unit"
    .replace(/\b(?:is|are|shall|should|must)?\s*(?:to\s+be|be)?\s*provided\b/gi, ' ')
    // councils spell small numbers out: 'One accessible car parking space ... per unit'
    .replace(/\b([a-z]+)\b/gi, (w) => WORD_NUM[w.toLowerCase()] ?? w)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Denominator phrases folded to a stable key, so two councils' wording joins. */
function perUnitKey(raw: string): string {
  const t = raw.toLowerCase().trim().replace(/[.,;:]+$/, '')
  if (/sqm/.test(t)) {
    if (/glfa|gross leasable/.test(t)) return 'sqm_glfa'
    if (/\bgfa\b|gross floor/.test(t)) return 'sqm_gfa'
    if (/site/.test(t)) return 'sqm_site'
    return 'sqm'
  }
  // (?<!s) so "class" does not become "clas" - a double-s ending is not a plural marker
  const m = /^(?:\d+\s+)?([a-z][a-z \-']{1,40}?)(?<!s)s?$/.exec(t)
  let word = (m?.[1] ?? t).trim()
  // the plurals a trailing -s does not fold. Measured on the LEP side, 81% of the entity join failure
  // was morphology alone, so the small table is worth more than it looks.
  const IRREGULAR: Record<string, string> = {
    children: 'child', people: 'person', premise: 'premises', premises: 'premises',
    storey: 'storey', storeys: 'storey', classe: 'class', busse: 'bus', boxe: 'box',
  }
  word = IRREGULAR[word] ?? word
  return word.replace(/\s+/g, '_')
}

/** The numerator's unit: "space", "spaces", "rack", or implied "space" when the text omits it. */
function numUnit(raw: string | undefined): string {
  const t = (raw ?? '').toLowerCase().trim()
  if (!t) return 'space'
  if (/rack/.test(t)) return 'rack'
  if (/bay/.test(t)) return 'bay'
  if (/space/.test(t)) return 'space'
  return t.replace(/s$/, '')
}

// ── the grammar ──────────────────────────────────────────────────────────────

/** Splits a rate into its additive terms. "+", "plus", ", and", " and " all join terms. */
const JOINER = /\s*(?:\+|,?\s+(?:plus|and)\s+)\s*/i

/**
 * `QTY [UNIT] (per|/|:) [PER_QTY] PER_UNIT`
 *
 * The per-quantity is optional — "per dwelling" means per one dwelling. The numerator unit is optional —
 * "3 per surgery" means three spaces. Everything after the denominator noun is a qualifier.
 */
const TERM = new RegExp(
  '(?<qty>\\d+(?:\\.\\d+)?)'
  // an optional adjective in front of the noun: "1 loading bay per …" parsed to nothing without it
  + '\\s*(?<nunit>(?:[a-z][a-z\\-]*\\s+){0,3}(?:spaces?|racks?|bays?))?'
  + '\\s*(?:per|/|:)\\s*'
  + '(?<pqty>\\d+(?:\\.\\d+)?)?'
  // captured generously and trimmed by denomOf: the stop is a judgement the regex cannot make
  + '\\s*(?<punit>[a-z][a-z0-9 \\-\']{0,60})',
  'i',
)

/**
 * Where the denominator ends and the qualifier begins.
 *
 * "5 seats min (subject to parking study)" is a rate per SEAT with a qualifier; read greedily it becomes
 * a unit called "seats_min". A denominator is at most three words and stops at the first word that
 * starts a new thought.
 */
const STOP = new Set([
  // 'of' matters: "5 students of driving age" is a rate per STUDENT. Square metres reach denomOf's
  // sqm branch before this loop, so "sqm of GFA" is unaffected.
  'of', 'or', 'and', 'min', 'max', 'minimum', 'maximum', 'subject', 'to', 'within', 'for', 'in', 'where',
  'plus', 'whichever', 'provided', 'located', 'available', 'refer', 'see', 'but', 'if', 'that',
  'which', 'per', 'from', 'with', 'on', 'at', 'as', 'by', 'up', 'over', 'under', 'greater', 'less',
])

function denomOf(raw: string): { unit: string; tail: string } {
  const t = raw.trim()
  // square metres carry their own qualifier - "sqm of GFA" is one unit, not a unit plus a tail
  if (/^sqm/i.test(t)) {
    const m = /^sqm(?:\s+(?:of\s+)?(?:a\s+)?(glfa|gfa|gross\s+(?:leasable|floor)\s+area|site(?:\s+area)?))?/i
      .exec(t)
    return { unit: m?.[0] ?? 'sqm', tail: t.slice((m?.[0] ?? 'sqm').length).trim() }
  }
  const words = t.split(/\s+/)
  const take: string[] = []
  for (const w of words) {
    const bare = w.toLowerCase().replace(/[^a-z\-]/g, '')
    if (!bare) break
    if (take.length && STOP.has(bare)) break
    take.push(w)
    if (take.length === 3) break
  }
  const unit = take.join(' ')
  return { unit, tail: t.slice(unit.length).trim() }
}

const PERCENT_BAND = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*%\s*of\s*(?:the\s*)?spaces/i
const PERCENT_ONE = /(\d+(?:\.\d+)?)\s*%\s*of\s*(?:the\s*)?spaces/i

export function parseRate(raw: string): Rate {
  const text = normaliseRateText(raw)
  const out: Rate = { terms: [], percentOfSpaces: null, qualifier: null, problem: null }

  const band = PERCENT_BAND.exec(text)
  if (band) {
    out.percentOfSpaces = { lo: Number(band[1]), hi: Number(band[2]) }
    return out
  }
  const one = PERCENT_ONE.exec(text)
  if (one) {
    out.percentOfSpaces = { lo: Number(one[1]), hi: Number(one[1]) }
    return out
  }

  for (const chunk of text.split(JOINER)) {
    const m = TERM.exec(chunk)
    if (!m?.groups) continue
    const g = m.groups
    // a denominator that reads like prose rather than a noun is a qualifier, not a unit
    const { unit: punitRaw, tail: denomTail } = denomOf(g.punit!)
    if (!punitRaw) continue
    // the matched span stops where the denominator does, so the quoted words are the rate and nothing else
    const matched = m[0].slice(0, m[0].length - (g.punit!.trim().length - punitRaw.length))
    out.terms.push({
      quantity: Number(g.qty),
      unit: numUnit(g.nunit),
      perQuantity: g.pqty ? Number(g.pqty) : 1,
      perUnit: perUnitKey(punitRaw),
      span: matched.trim(),
    })
    const tail = [denomTail, chunk.slice(m.index + m[0].length)].join(' ').trim()
    if (tail.length > 3) out.qualifier = [out.qualifier, tail].filter(Boolean).join(' ')
  }

  if (!out.terms.length) {
    out.problem = /\d/.test(text)
      ? 'states a number but no "per" relationship could be read'
      : 'states no quantity'
  }
  return out
}

/** One line a planner can check against the cell. */
export function renderRate(r: Rate): string {
  if (r.percentOfSpaces) {
    const { lo, hi } = r.percentOfSpaces
    return lo === hi ? `${lo}% of spaces` : `${lo}-${hi}% of spaces`
  }
  if (!r.terms.length) return r.problem ?? '(no rate)'
  return r.terms
    .map(t => `${t.quantity} ${t.unit}${t.quantity === 1 ? '' : 's'} per `
      + `${t.perQuantity === 1 ? '' : `${t.perQuantity} `}${t.perUnit}`)
    .join(' + ')
}

// ── self-test, against real cells from the corpus ────────────────────────────

const CASES: [string, string][] = [
  ['1/150m 2 GLFA', '1 space per 150 sqm_glfa'],
  ['1/100m 2 GLFA', '1 space per 100 sqm_glfa'],
  ['1 space/employee', '1 space per employee'],
  ['1/150m 2 GFA + 6 spaces/work bay', '1 space per 150 sqm_gfa + 6 spaces per work_bay'],
  ['1 space/workroom + 1 space per 2 employees', '1 space per workroom + 1 space per 2 employee'],
  ['3 per surgery', '3 spaces per surgery'],
  ['4 per surgery', '4 spaces per surgery'],
  ['1 space per 4 children', '1 space per 4 child'],
  ['0.4 space per dwelling', '0.4 spaces per dwelling'],
  ['0.75 space per dwelling', '0.75 spaces per dwelling'],
  ['1.1 spaces per dwelling', '1.1 spaces per dwelling'],
  ['1 per 70 m 2 GFA', '1 space per 70 sqm_gfa'],
  ['1 per 67 m 2 GFA', '1 space per 67 sqm_gfa'],
  ['1 loading bay per 400 m 2 GFA to be provided on-site.', '1 bay per 400 sqm_gfa'],
  ['1-2% of spaces', '1-2% of spaces'],
  ['3-4% of spaces (See Note 1 )', '3-4% of spaces'],
  ['1 space per full time teacher + 1 space per 2 students of driving age',
   '1 space per full_time_teacher + 1 space per 2 student'],
  ['1 space per 5 seats min (subject to parking study)', '1 space per 5 seat'],
  ['1 rack per 20 full-time staff or part thereof, and 5 racks per class',
   '1 rack per 20 full-time_staff + 5 racks per class'],
  // 'for every' is 'per', and councils spell small numbers out
  ['Plus 1 parking space for every 10 dwellings for visitors', '1 space per 10 dwelling'],
  ['One accessible car parking space is to be provided for every adaptable residential unit',
   '1 space per adaptable_residential_unit'],
]

if (process.argv.includes('--self-test')) {
  let pass = 0
  for (const [input, want] of CASES) {
    const got = renderRate(parseRate(input))
    const ok = got === want
    if (ok) pass++
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${input}`)
    if (!ok) console.log(`        want: ${want}\n        got:  ${got}`)
  }
  console.log(`\n${pass}/${CASES.length} rate cells parse as intended`)
  process.exit(pass === CASES.length ? 0 : 1)
}
