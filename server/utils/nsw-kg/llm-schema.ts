// ── LLM output contract for Stage 1 (atomic decomposition) ──────────────
//
// Hand-rolled validator (no zod dependency). Validates raw JSON returned
// by the LLM against the AtomicProposition shape, throws on mismatch with
// a precise error path so the retry prompt can correct it.

import type {
  AtomicProposition,
  PropositionType,
  NumericComparator,
  RawReference,
} from './types'

const PROPOSITION_TYPES: PropositionType[] = [
  'obligation', 'prohibition', 'permission',
  'condition',  'threshold',   'definition',
  'exception',  'requirement',
]

const COMPARATORS: NumericComparator[] = ['eq', 'lt', 'lte', 'gt', 'gte', 'between']

const REFERENCE_TYPES: RawReference['type'][] = [
  'clause', 'subclause', 'paragraph', 'part', 'division',
  'schedule', 'dictionary', 'act', 'sepp', 'unknown',
]

// ── Validation error ─────────────────────────────────────────────────────

export class LLMValidationError extends Error {
  constructor(public path: string, message: string) {
    super(`[${path}] ${message}`)
  }
}

function fail(path: string, msg: string): never {
  throw new LLMValidationError(path, msg)
}

// ── Atomic primitives ────────────────────────────────────────────────────

function asString(v: unknown, path: string, opts: { minLen?: number; maxLen?: number } = {}): string {
  if (typeof v !== 'string') fail(path, `expected string, got ${typeof v}`)
  if (opts.minLen != null && v.length < opts.minLen) fail(path, `too short (min ${opts.minLen})`)
  if (opts.maxLen != null && v.length > opts.maxLen) fail(path, `too long (max ${opts.maxLen}, got ${v.length})`)
  return v
}

function asStringOrNull(v: unknown, path: string, opts: { maxLen?: number } = {}): string | null {
  if (v === null || v === undefined || v === '') return null
  return asString(v, path, opts)
}

function asNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, `expected finite number, got ${typeof v}`)
  return v
}

function asNumberOrNull(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null
  return asNumber(v, path)
}

function asEnum<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    fail(path, `expected one of [${allowed.join(', ')}], got ${JSON.stringify(v)}`)
  }
  return v as T
}

function asInt(v: unknown, path: string): number {
  const n = asNumber(v, path)
  if (!Number.isInteger(n)) fail(path, `expected integer, got ${n}`)
  return n
}

function asIntOrNull(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null
  return asInt(v, path)
}

// ── Validators ───────────────────────────────────────────────────────────

function validateReference(raw: any, path: string): RawReference {
  if (!raw || typeof raw !== 'object') fail(path, 'expected object')
  // Accept any string for `type` but normalise unknown values to 'unknown'
  // so the LLM doesn't get blocked for saying 'section' instead of 'clause'.
  const rawType = typeof raw.type === 'string' ? raw.type : 'unknown'
  const type = (REFERENCE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as RawReference['type'])
    : 'unknown'
  return {
    type,
    ref:  asString(raw.ref, `${path}.ref`, { minLen: 1, maxLen: 80 }),
  }
}

export function validateAtomicProposition(raw: any, path = '$'): AtomicProposition {
  if (!raw || typeof raw !== 'object') fail(path, 'expected object')

  const type = asEnum(raw.type, PROPOSITION_TYPES, `${path}.type`)
  const subject   = asString(raw.subject,   `${path}.subject`,   { minLen: 1, maxLen: 80 })
  const predicate = asString(raw.predicate, `${path}.predicate`, { minLen: 1, maxLen: 200 })
  const object    = asStringOrNull(raw.object, `${path}.object`, { maxLen: 200 })

  // Numeric block — only meaningful when type='threshold'
  const numeric_value      = asNumberOrNull(raw.numeric_value,      `${path}.numeric_value`)
  const numeric_unit       = asStringOrNull(raw.numeric_unit,       `${path}.numeric_unit`,  { maxLen: 40 })
  const numeric_upper      = asNumberOrNull(raw.numeric_upper,      `${path}.numeric_upper`)
  const numeric_comparator = raw.numeric_comparator
    ? asEnum(raw.numeric_comparator, COMPARATORS, `${path}.numeric_comparator`)
    : null
  const value_source = asStringOrNull(raw.value_source, `${path}.value_source`, { maxLen: 200 })

  // Threshold contract: exactly one of (numeric_value, value_source) populated
  if (type === 'threshold') {
    const hasValue  = numeric_value !== null
    const hasSource = value_source !== null
    if (hasValue === hasSource) {
      fail(path, `threshold must have exactly one of numeric_value or value_source (got value=${hasValue}, source=${hasSource})`)
    }
    if (hasValue) {
      if (numeric_unit == null)       fail(`${path}.numeric_unit`,       'required when numeric_value is set')
      if (numeric_comparator == null) fail(`${path}.numeric_comparator`, 'required when numeric_value is set')
      if (numeric_comparator === 'between' && numeric_upper == null) {
        fail(`${path}.numeric_upper`, "required when comparator is 'between'")
      }
    }
  }

  const source_span = asString(raw.source_span, `${path}.source_span`, { minLen: 1, maxLen: 4000 })

  // references[]
  if (raw.references != null && !Array.isArray(raw.references)) {
    fail(`${path}.references`, 'expected array')
  }
  const references: RawReference[] = (raw.references ?? []).map(
    (r: any, i: number) => validateReference(r, `${path}.references[${i}]`),
  )

  const conditional_on_local = asIntOrNull(raw.conditional_on_local, `${path}.conditional_on_local`)
  const exempts_ref = asStringOrNull(raw.exempts_ref, `${path}.exempts_ref`, { maxLen: 80 })

  let confidence = asNumberOrNull(raw.confidence, `${path}.confidence`)
  if (confidence == null) confidence = 0.7
  if (confidence < 0 || confidence > 1) fail(`${path}.confidence`, 'must be in [0, 1]')

  return {
    type, subject, predicate, object,
    numeric_value, numeric_unit, numeric_comparator, numeric_upper, value_source,
    source_span, references,
    conditional_on_local, exempts_ref,
    confidence,
  }
}

export function validateAtomicPropositionArray(raw: any, path = '$'): AtomicProposition[] {
  if (!Array.isArray(raw)) {
    // Some LLMs wrap in { propositions: [...] }
    if (raw && Array.isArray(raw.propositions)) raw = raw.propositions
    else fail(path, 'expected array (or object with `propositions` array)')
  }
  return raw.map((r: any, i: number) => validateAtomicProposition(r, `${path}[${i}]`))
}

// ── JSON schema for the LLM prompt ───────────────────────────────────────
//
// This is the schema string we paste into the system prompt so the LLM
// knows the exact shape to emit. Kept as a TypeScript constant so the
// validator above stays in sync.

export const ATOMIC_PROPOSITION_JSON_SCHEMA = `{
  "type": "<obligation | prohibition | permission | condition | threshold | definition | exception | requirement>",
  "subject":   "<noun phrase, max 80 chars>",
  "predicate": "<verb phrase, max 200 chars>",
  "object":    "<noun phrase or null>",

  "numeric_value":      <number or null>,
  "numeric_unit":       "<unit string or null>",
  "numeric_comparator": "<eq|lt|lte|gt|gte|between or null>",
  "numeric_upper":      <number or null, only for 'between'>,
  "value_source":       "<'map:<MapName>' or null>",

  "source_span": "<literal substring of the clause text supporting this proposition>",

  "references": [
    { "type": "<clause|subclause|paragraph|part|division|schedule|dictionary|act|sepp|unknown>", "ref": "<e.g. 4.1, Schedule 1>" }
  ],

  "conditional_on_local": <integer index of a sibling condition proposition in this same response, or null>,
  "exempts_ref": "<raw clause ref this proposition exempts (e.g. 4.1), or null>",

  "confidence": <number in [0,1]>
}`
