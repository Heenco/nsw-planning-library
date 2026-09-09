// ── Candidate number finder ─────────────────────────────────────────────
//
// Deterministic regex-based extraction of "numbers that look like they
// could be a threshold" from a clause body. Used by:
//   1. the decomposer prompt (inject the list so the LLM has to account for
//      every candidate)
//   2. the recall verifier (compare against the extracted thresholds)

export interface NumberCandidate {
  /** Raw matched text, e.g. "8.5", "0.9", "450" */
  raw: string
  /** Parsed number */
  value: number
  /** Character offset in the clause text where the match starts */
  index: number
  /** Unit token immediately following the number, if any ("metre", "sqm", etc.) */
  unit: string | null
  /** Comparator word preceding the number, if any ("maximum", "minimum", "at least", etc.) */
  comparator_hint: string | null
  /** 'obvious' = preceded by comparator AND followed by a unit,
   *  'with_unit' = only a unit,
   *  'with_comparator' = only a comparator,
   *  'bare' = neither (weakest) */
  category: 'obvious' | 'with_unit' | 'with_comparator' | 'bare'
}

// Units we recognise. Order matters — longer first so "metres" beats "m",
// "m2" beats "m", and "km" is not read as a bare "m".
//
// Bare 'm' is load-bearing and was missing until it was noticed that no
// Hornsby DCP setback value had been extracted. Control tables write "6m",
// "0.9m", "7.6m" — never "6 metres" — so without this token every one of
// those numbers scored as 'bare' and was discarded, while the storey
// qualifier beside it ("up to 1 storey") kept its unit and was taken as the
// setback instead. It is last in the list so the longer distance units win.
const UNIT_TOKENS = [
  'square\\s+metres', 'square\\s+metre', 'sqm', 'm²',
  // PDF extraction loses the superscript, so m² reaches us as "m2" or "m 2"
  // ("Lots < 4,000m 2"). The lookahead keeps the spaced form from eating the
  // storey count in "0.9m 2 storey element", where the 2 starts a new clause.
  'm\\s*2(?!\\s*store)',
  'metres', 'metre', 'km',
  // Millimetres are a real control unit, not noise: Randwick states its
  // secondary-frontage setback as "900mm for allotments with a primary
  // frontage width of less than 7m". Without this token the 900 scored as a
  // bare number and was discarded, so the only number the line yielded was
  // the 7 m CONDITION — the control was dropped and its qualifier kept.
  // Must precede bare 'm', which would otherwise match the first character
  // and fail the "not another alphanumeric" test.
  'millimetres', 'millimetre', 'mm',
  'hectares', 'hectare', 'ha',
  'per\\s*cent', 'percent', '%',
  'dwellings?', 'persons?', 'storeys?', 'spaces?',
  'litres?', 'L',
  ':\\s*1',       // FSR ratio e.g. "0.5:1"
  'm',            // "6m" — must stay last, after m², m2, km and metre(s)
]

// Terminated by "not another alphanumeric" rather than \b. A \b after the
// unit cannot match when the unit ends in a symbol — there is no boundary
// between "%" and the space that follows it — so "25%" scored as a bare
// number and was dropped, while "25 percent" was kept. This still refuses
// "6mm", where the following character is alphanumeric.
const UNIT_RE = new RegExp(`^\\s*(${UNIT_TOKENS.join('|')})(?![A-Za-z0-9])`, 'i')

// Unit tokens → canonical unit string (matching llm-schema.ts expectations).
const UNIT_CANONICAL: Array<[RegExp, string]> = [
  [/^(square\s+metres?|sqm|m²|m\s*2)$/i,       'sqm'],
  [/^(metres?|m)$/i,                           'metre'],
  [/^(millimetres?|mm)$/i,                     'millimetre'],
  [/^km$/i,                                    'km'],
  [/^(hectares?|ha)$/i,                        'hectare'],
  [/^(per\s*cent|percent|%)$/i,                'percent'],
  [/^dwellings?$/i,                            'dwellings'],
  [/^persons?$/i,                              'persons'],
  [/^storeys?$/i,                              'storeys'],
  [/^spaces?$/i,                               'spaces'],
  [/^litres?|L$/i,                             'litre'],
  [/^:\s*1$/i,                                 'ratio'],
]

const COMPARATOR_PREFIXES = [
  'maximum', 'minimum', 'at least', 'at most',
  'not more than', 'not less than',
  'not to exceed', 'must not exceed',
  'must be at least', 'must be no less than',
  'is not to exceed', 'is at least', 'is at most',
  'greater than', 'less than', 'fewer than',
  'between',
]

// Words which, when immediately before a digit, mean "this is a clause/schedule
// reference, not a threshold" — we skip these.
const SKIP_PREFIXES = [
  /\bclause\s*$/i,
  /\bclauses\s*$/i,
  /\bsubclause\s*$/i,
  /\bsection\s*$/i,
  /\bpart\s*$/i,
  /\bdivision\s*$/i,
  /\bschedule\s*$/i,
  /\bitem\s*$/i,
  /\bchapter\s*$/i,
  /\blevel\s*$/i,
  /\bpara(graph)?\s*$/i,
  /\bstandard\s+instrument\s*$/i,
  /\bfigure\s*$/i,
  /\btable\s*$/i,
  /\bNo\.?\s*$/i,
  /\bno\s*$/i,
]

// Skip obvious date years (19xx/20xx).
function isLikelyYear(value: number, raw: string): boolean {
  if (!/^\d{4}$/.test(raw)) return false
  return value >= 1900 && value <= 2100
}

// Skip list ordinals like "(1)", "(2)", "(a)" — handled because we only match
// bare digits and the paren patterns don't look like numbers anyway.

// The trailing \b this pattern used to carry made every number written flush
// against its unit invisible: in "6m" the digit and the letter are both word
// characters, so there is no boundary between them and the scan simply never
// fired. DCP control tables write "6m", "0.9m", "4,000m2" — almost never
// "6 metres" — so that one anchor silently dropped most of a document's
// numbers, and the loosely-spaced storey counts beside them ("1 storey")
// were all that survived to be mistaken for the value.
//
// Leading (?<![\w.,]) still refuses to start mid-number, so "3.1.2" yields
// 3.1 once rather than three fragments. The comma-grouped alternative comes
// first so "4,000" is one number and not 4 followed by 000.
const NUMBER_RE = /(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g

export function findNumberCandidates(text: string): NumberCandidate[] {
  if (!text) return []
  const out: NumberCandidate[] = []
  let m: RegExpExecArray | null

  // Reset regex state
  NUMBER_RE.lastIndex = 0

  while ((m = NUMBER_RE.exec(text)) !== null) {
    const raw = m[1]!
    const idx = m.index
    const value = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    if (isLikelyYear(value, raw)) continue

    // Look at the preceding 40 chars — if it ends with a skip prefix, skip.
    const beforeStart = Math.max(0, idx - 40)
    const before = text.slice(beforeStart, idx)
    let skip = false
    for (const re of SKIP_PREFIXES) {
      if (re.test(before)) { skip = true; break }
    }
    if (skip) continue

    // Look at the following 30 chars for a unit token
    const after = text.slice(idx + raw.length, idx + raw.length + 30)

    // Either half of a fraction is not a threshold. "reduced to 3m for a
    // maximum of 1/3 of the building width" was yielding a candidate of 1
    // with the comparator 'maximum' attached, which reached the rule layer
    // as a setback of "≤ 1" — a plausible-looking number that means nothing.
    if (/^\s*\/\s*\d/.test(after) || /\d\s*\/\s*$/.test(before)) continue
    let unit: string | null = null
    const unitMatch = after.match(UNIT_RE)
    if (unitMatch) {
      const rawUnit = unitMatch[1]!
      for (const [re, canonical] of UNIT_CANONICAL) {
        if (re.test(rawUnit.trim())) { unit = canonical; break }
      }
      if (!unit) unit = rawUnit.trim().toLowerCase()
    }

    // Look at the preceding 30 chars for a comparator word
    let comparator_hint: string | null = null
    for (const cmp of COMPARATOR_PREFIXES) {
      const lookback = before.slice(-cmp.length - 5).toLowerCase()
      if (lookback.includes(cmp)) { comparator_hint = cmp; break }
    }

    let category: NumberCandidate['category']
    if (unit && comparator_hint)      category = 'obvious'
    else if (unit)                     category = 'with_unit'
    else if (comparator_hint)          category = 'with_comparator'
    else                                category = 'bare'

    // Skip 'bare' candidates entirely — too noisy, produces false positives.
    if (category === 'bare') continue

    out.push({ raw, value, index: idx, unit, comparator_hint, category })
  }

  return out
}

/** For debugging / logging. */
export function summariseCandidates(cands: NumberCandidate[]): string {
  if (cands.length === 0) return '(none)'
  return cands
    .map((c) => `${c.raw}${c.unit ? ' ' + c.unit : ''} [${c.category}]`)
    .join(', ')
}
