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

// Units we recognise. Order matters — longer first so "metres" beats "m".
const UNIT_TOKENS = [
  'square\\s+metres', 'square\\s+metre', 'sqm', 'm²', 'm2',
  'metres', 'metre', 'km',
  'hectares', 'hectare', 'ha',
  'per\\s*cent', 'percent', '%',
  'dwellings?', 'persons?', 'storeys?', 'spaces?',
  'litres?', 'L',
  ':\\s*1',       // FSR ratio e.g. "0.5:1"
]

const UNIT_RE = new RegExp(`^\\s*(${UNIT_TOKENS.join('|')})\\b`, 'i')

// Unit tokens → canonical unit string (matching llm-schema.ts expectations).
const UNIT_CANONICAL: Array<[RegExp, string]> = [
  [/^(square\s+metres?|sqm|m²|m2)$/i,         'sqm'],
  [/^(metres?|m)$/i,                           'metre'],
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

const NUMBER_RE = /\b(\d+(?:\.\d+)?)\b/g

export function findNumberCandidates(text: string): NumberCandidate[] {
  if (!text) return []
  const out: NumberCandidate[] = []
  let m: RegExpExecArray | null

  // Reset regex state
  NUMBER_RE.lastIndex = 0

  while ((m = NUMBER_RE.exec(text)) !== null) {
    const raw = m[1]!
    const idx = m.index
    const value = Number(raw)
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
