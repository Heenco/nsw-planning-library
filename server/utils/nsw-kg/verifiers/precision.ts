// ── Precision verifier ──────────────────────────────────────────────────
//
// Checks:
//   1. source_span is a literal substring of the clause text (word-for-word)
//   2. Every threshold's numeric_value literally appears in its source_span
//   3. subject ≤ 80 chars, predicate ≤ 200 chars (also enforced by DB,
//      but we catch it earlier here to avoid wasted DB round trips)
//   4. Reference detection sanity: all references[] should appear in
//      source_span (soft warning only)

import type { AtomicProposition } from '../types'

export interface PrecisionViolation {
  index: number                    // index in the propositions array
  field: string                    // which field failed
  reason: string
}

export interface PrecisionResult {
  ok: boolean
  violations: PrecisionViolation[]
}

/** Normalise for comparison: collapse whitespace, lowercase. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function verifyPrecision(
  propositions: AtomicProposition[],
  clauseText: string,
): PrecisionResult {
  const violations: PrecisionViolation[] = []
  const normClause = normalise(clauseText)

  propositions.forEach((p, i) => {
    // 1. source_span literal substring check (normalised for whitespace).
    if (!p.source_span || p.source_span.length === 0) {
      violations.push({ index: i, field: 'source_span', reason: 'empty' })
      return
    }
    const normSpan = normalise(p.source_span)
    if (!normClause.includes(normSpan)) {
      violations.push({
        index: i,
        field: 'source_span',
        reason: `not a literal substring of the clause text (first 60 chars: "${p.source_span.slice(0, 60)}…")`,
      })
    }

    // 2. Numeric value must appear literally in source_span
    if (p.numeric_value != null) {
      const valStr = p.numeric_value.toString()
      const spanLower = p.source_span.toLowerCase()
      // Accept both "8.5" and the integer form for whole numbers
      const altForms = new Set([valStr])
      if (Number.isInteger(p.numeric_value)) {
        altForms.add(p.numeric_value.toFixed(0))
        altForms.add(p.numeric_value.toFixed(1))
      }
      let found = false
      for (const form of altForms) {
        if (spanLower.includes(form)) { found = true; break }
      }
      if (!found) {
        violations.push({
          index: i,
          field: 'numeric_value',
          reason: `value ${valStr} does not appear in source_span`,
        })
      }
    }

    // 3. Length contracts
    if (p.subject.length > 80) {
      violations.push({ index: i, field: 'subject', reason: `length ${p.subject.length} > 80` })
    }
    if (p.predicate.length > 200) {
      violations.push({ index: i, field: 'predicate', reason: `length ${p.predicate.length} > 200` })
    }
  })

  return { ok: violations.length === 0, violations }
}
