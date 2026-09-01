// ── Stage 1 + Stage 2: decompose one clause with verification ───────────
//
// - Calls the LLM with the decomposer prompt
// - Validates the JSON output against the AtomicProposition schema
// - Runs precision + recall verifiers
// - Retries once with a correction prompt if verifiers fail
// - Returns the final propositions + a verification outcome

import { callLLM } from '../../sitewise/llm'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import { validateAtomicPropositionArray, LLMValidationError } from '../llm-schema'
import { findNumberCandidates } from '../verifiers/candidates'
import { verifyPrecision } from '../verifiers/precision'
import { verifyRecall } from '../verifiers/recall'
import type { AtomicProposition } from '../types'
import type { PrecisionViolation } from '../verifiers/precision'
import type { RecallViolation } from '../verifiers/recall'

export const DECOMPOSE_MODEL = 'meta-llama/Llama-3.3-70B-Instruct'
export const DECOMPOSE_PROVIDER = 'deepinfra'

export interface DecomposeInput {
  clause_heading: string                 // e.g. "Part 4 > Clause 4.3 Height of buildings > Subclause (2)"
  clause_text:    string                 // raw_text of the leaf section
  deepinfraKey:   string
}

export interface DecomposeOutput {
  propositions:      AtomicProposition[]
  verification:      'verified' | 'flagged'
  /** First-pass and (if applicable) retry diagnostics. */
  diagnostics: {
    attempts:         number
    llm_errors:       string[]             // JSON parse / validation errors
    precision_violations: PrecisionViolation[]
    recall_hard_misses:   RecallViolation[]
    recall_soft_misses:   RecallViolation[]
  }
}

// ── Public entry point ──────────────────────────────────────────────────

export async function decomposeClause(input: DecomposeInput): Promise<DecomposeOutput> {
  const candidates = findNumberCandidates(input.clause_text)
  const candidateStrings = candidates.map((c) =>
    c.unit ? `${c.raw} ${c.unit}` : c.raw,
  )

  const diagnostics: DecomposeOutput['diagnostics'] = {
    attempts: 0,
    llm_errors: [],
    precision_violations: [],
    recall_hard_misses: [],
    recall_soft_misses: [],
  }

  // ── Attempt 1 ────────────────────────────────────────────────────────
  const userPrompt = buildUserPrompt({
    clause_heading: input.clause_heading,
    clause_text:    input.clause_text,
    candidate_numbers: candidateStrings,
  })

  let propositions: AtomicProposition[] = []
  try {
    propositions = await callAndValidate(SYSTEM_PROMPT, userPrompt, input.deepinfraKey)
  } catch (e) {
    diagnostics.llm_errors.push(`attempt 1: ${(e as Error).message}`)
  }
  diagnostics.attempts = 1

  if (propositions.length > 0) {
    const precision = verifyPrecision(propositions, input.clause_text)
    const recall    = verifyRecall(propositions, candidates)
    diagnostics.precision_violations = precision.violations
    diagnostics.recall_hard_misses   = recall.hard_misses
    diagnostics.recall_soft_misses   = recall.soft_misses

    if (precision.ok && recall.ok) {
      return { propositions, verification: 'verified', diagnostics }
    }
  }

  // ── Attempt 2: retry with correction prompt ─────────────────────────
  const correctionNotes: string[] = []
  if (diagnostics.llm_errors.length > 0) {
    correctionNotes.push(
      `Your previous response could not be parsed: ${diagnostics.llm_errors[0]}. Return JSON only, matching the schema.`,
    )
  }
  if (diagnostics.precision_violations.length > 0) {
    const sample = diagnostics.precision_violations.slice(0, 3).map((v) => `- proposition #${v.index}: ${v.field}: ${v.reason}`).join('\n')
    correctionNotes.push(
      `Some of your propositions failed the precision verifier:\n${sample}\n\nRule: source_span MUST be a literal substring of the clause text, word for word.`,
    )
  }
  if (diagnostics.recall_hard_misses.length > 0) {
    const missed = diagnostics.recall_hard_misses
      .map((v) => `${v.candidate.raw}${v.candidate.unit ? ' ' + v.candidate.unit : ''}`)
      .join(', ')
    correctionNotes.push(
      `You missed these numerical thresholds in the clause: [${missed}]. Either include each one as a threshold proposition, OR explain (in a comment) why it is not a threshold. Do not omit them silently.`,
    )
  }

  if (correctionNotes.length > 0) {
    const retryPrompt = `${userPrompt}

---
CORRECTIONS FROM YOUR LAST ATTEMPT:
${correctionNotes.join('\n\n')}

Try again, return JSON only.`

    try {
      propositions = await callAndValidate(SYSTEM_PROMPT, retryPrompt, input.deepinfraKey)
      diagnostics.attempts = 2
    } catch (e) {
      diagnostics.llm_errors.push(`attempt 2: ${(e as Error).message}`)
    }

    if (propositions.length > 0) {
      const precision = verifyPrecision(propositions, input.clause_text)
      const recall    = verifyRecall(propositions, candidates)
      diagnostics.precision_violations = precision.violations
      diagnostics.recall_hard_misses   = recall.hard_misses
      diagnostics.recall_soft_misses   = recall.soft_misses

      if (precision.ok && recall.ok) {
        return { propositions, verification: 'verified', diagnostics }
      }
    }
  }

  // ── Still failing: flag ──────────────────────────────────────────────
  return { propositions, verification: 'flagged', diagnostics }
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function callAndValidate(
  system: string,
  user: string,
  apiKey: string,
): Promise<AtomicProposition[]> {
  const response = await callLLM({
    provider:    'deepinfra',
    model:       DECOMPOSE_MODEL,
    apiKey,
    system,
    user,
    maxTokens:   2500,
    temperature: 0.05,
    jsonMode:    true,
  })

  const content = response.content.trim()
  if (!content) throw new Error('LLM returned empty content')

  // Try to parse — the LLM might return {propositions: [...]} or [...].
  // Extract the first balanced JSON value.
  const parsed = extractJson(content)
  return validateAtomicPropositionArray(parsed)
}

function extractJson(text: string): any {
  // Strip code fences
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  // Find the first '{' or '['
  const firstCurly = t.indexOf('{')
  const firstSquare = t.indexOf('[')
  let start = -1
  if (firstCurly === -1) start = firstSquare
  else if (firstSquare === -1) start = firstCurly
  else start = Math.min(firstCurly, firstSquare)
  if (start === -1) throw new Error('no JSON object/array found in response')

  try {
    return JSON.parse(t.slice(start))
  } catch (e) {
    // Fall back: try to parse from the very beginning
    try { return JSON.parse(t) } catch {}
    throw new Error(`JSON parse failed: ${(e as Error).message}`)
  }
}
