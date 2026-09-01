// ── Recall verifier ─────────────────────────────────────────────────────
//
// For every 'obvious' candidate (preceded by a comparator word AND followed
// by a unit token), there must be a matching threshold proposition whose
// numeric_value equals the candidate value.
//
// 'with_unit' candidates (unit but no comparator) are soft — they become
// warnings, not retries. 'with_comparator' candidates likewise.
//
// Candidates with value_source (map-deferred) propositions are a free pass
// because we don't expect numbers in the text for those.

import type { AtomicProposition } from '../types'
import type { NumberCandidate } from './candidates'

export interface RecallViolation {
  candidate: NumberCandidate
  severity: 'hard' | 'soft'
  reason: string
}

export interface RecallResult {
  ok: boolean                          // false if any 'hard' violations
  hard_misses: RecallViolation[]
  soft_misses: RecallViolation[]
}

function numbersMatch(candidate: number, extracted: number): boolean {
  // 8.5 === 8.5, and 8 === 8.0
  return Math.abs(candidate - extracted) < 0.001
}

export function verifyRecall(
  propositions: AtomicProposition[],
  candidates: NumberCandidate[],
): RecallResult {
  const hard: RecallViolation[] = []
  const soft: RecallViolation[] = []

  // Collect all numeric_values from threshold propositions
  const extractedValues = propositions
    .filter((p) => p.type === 'threshold' && p.numeric_value != null)
    .map((p) => p.numeric_value as number)

  // If any threshold proposition has a value_source (map-deferred), we consider
  // that clause to be "map-deferring" and don't require literal numbers to be
  // present — a map-deferred clause legitimately has zero numeric_value.
  const hasMapDeferredThreshold = propositions.some(
    (p) => p.type === 'threshold' && p.value_source != null,
  )

  for (const c of candidates) {
    const matched = extractedValues.some((v) => numbersMatch(c.value, v))
    if (matched) continue

    // Special case: if the candidate appears in a non-threshold proposition's
    // source_span, it's still accounted for (e.g., "see clause 4.1" where 4.1
    // is a reference, not a threshold — the skip-prefix filter should have
    // caught this, but defence in depth).
    const appearsInAnyProp = propositions.some((p) =>
      p.source_span.includes(c.raw),
    )
    if (appearsInAnyProp && c.category !== 'obvious') continue

    const violation: RecallViolation = {
      candidate: c,
      severity: c.category === 'obvious' ? 'hard' : 'soft',
      reason:
        `number ${c.raw}${c.unit ? ' ' + c.unit : ''} at offset ${c.index} ` +
        `(${c.category}) has no matching threshold proposition`,
    }

    // If the clause map-defers thresholds, demote hard → soft (the clause
    // might still have some numbers that aren't thresholds).
    if (hasMapDeferredThreshold && violation.severity === 'hard') {
      violation.severity = 'soft'
    }

    if (violation.severity === 'hard') hard.push(violation)
    else                               soft.push(violation)
  }

  return { ok: hard.length === 0, hard_misses: hard, soft_misses: soft }
}
