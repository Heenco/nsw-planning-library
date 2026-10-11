/**
 * Stage 3 — the gate. Deterministic, no model, and it is allowed to reject.
 *
 * Four gates, each catching a different way stage 2 can be wrong. They are separated because a single
 * "confidence" number is worthless: 22,091 of 22,109 propositions in this database self-report 0.8-1.0
 * including the 14% that were flagged. Asking a model how sure it is produces a number that means
 * nothing. Independent checks that can each fail for a nameable reason produce something you can act on.
 *
 *   span        every branch quotes the packet verbatim        — catches invention
 *   vocabulary  every guard and topic is in the registry       — catches drift
 *   frame       the frame's mandatory slots are filled         — catches silent omission
 *   coherence   the branches form one control, not a bundle    — catches the grain failure
 *
 * Nothing here deletes a control. A failure attaches a finding and downgrades the control's status, so a
 * reviewer sees the gap. Silence is the one outcome this pipeline is not allowed to produce — it is how
 * 392 `empty_rule_source` findings came to be gating with nobody looking at them.
 */
import { topicAllowsUnit } from '../lib/dcp-cells.mjs'
import type { Control } from './extract'
import { FRAMES, GUARD_BY_KEY, TOPICS } from './guards'
import type { Packet } from './packets'

export type Status = 'ok' | 'review' | 'rejected'

export interface Verdict {
  status: Status
  findings: string[]
  /** How much of the control text the branch spans account for, 0-1. */
  coverage: number
}

/** Whitespace and the several dashes and bullets a PDF converter emits, folded for comparison. */
function fold(s: string): string {
  return s
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[▪●•·]/g, ' ')
    // the converter writes m2 as "m 2"; a model quoting the cell often tidies it to "m^2" or
    // "m2". All three mean square metres, and rejecting a quote over the difference threw away
    // correct controls - every bicycle-parking rate in the sample was lost this way.
    .replace(/\s*(?:\^2|²|\s2)(?=\W|$)/g, '2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function verify(control: Control, packet: Packet): Verdict {
  const findings = [...control.findings]
  const hay = fold(packet.text)

  // ── gate 1: span ──────────────────────────────────────────────────────
  // The whole contract rests on this. A span that is not in the text means the branch describes
  // something the document does not say, and no downstream check can tell the difference.
  let covered = 0
  for (const b of control.branches) {
    const needle = fold(b.span)
    if (!needle) {
      findings.push('span_empty: a branch quoted nothing')
      continue
    }
    if (hay.includes(needle)) {
      covered += needle.length
    } else {
      findings.push(`span_not_literal: "${b.span.slice(0, 70)}" is not in the control text`)
    }
  }
  for (const a of control.applicability) {
    // applicability is quoted from the headers, which are not in `text`; only check it is non-empty
    if (!a.span.trim()) findings.push(`applicability_unsourced: ${a.dimension}=${a.value} quotes nothing`)
  }

  // ── gate 2: vocabulary ────────────────────────────────────────────────
  for (const b of control.branches) {
    if (b.guard == null) continue
    if (b.guard === 'UNSUPPORTED') {
      findings.push(`guard_unsupported: the control branches on "${b.literal ?? b.span.slice(0, 50)}" `
        + 'and no registered guard matches — the branch is recorded and cannot be evaluated')
      continue
    }
    const g = GUARD_BY_KEY.get(b.guard)
    if (!g) {
      findings.push(`guard_unknown: "${b.guard}" is not in the registry`)
      continue
    }
    if (g.resolution === 'none') {
      findings.push(`guard_unresolvable: ${b.guard} — ${g.source}`)
    }
    if (g.type === 'enum' && g.values?.length && b.literal
        && !g.values.some(v => fold(v) === fold(b.literal!))) {
      findings.push(`guard_value_off_list: ${b.guard} = "${b.literal}" is not one of ${g.values.join(', ')}`)
    }
  }
  if (control.topic && !(TOPICS as readonly string[]).includes(control.topic)) {
    findings.push(`topic_unknown: "${control.topic}"`)
  }
  if (control.topic && control.unit && !topicAllowsUnit(control.topic, control.unit)) {
    findings.push(`topic_unit_mismatch: ${control.topic} stated in ${control.unit}`)
  }

  // ── gate 3: frame ─────────────────────────────────────────────────────
  // The frame names the slots that must be filled, so an empty one is noticed. A reader opens slots and
  // feels the gap; an extractor that only pattern-hunts never knows anything is missing.
  const slots: Record<string, unknown> = {
    topic: control.topic,
    comparator: control.comparator,
    unit: control.unit,
    per_unit: control.perUnit,
    defers_to: control.defersTo,
    branches: control.branches.length ? control.branches : null,
  }
  for (const req of FRAMES[control.frame].required) {
    if (slots[req] == null) findings.push(`slot_empty: frame "${control.frame}" requires ${req}`)
  }

  // ── gate 4: coherence ─────────────────────────────────────────────────
  // The grain failure, caught directly: branches that differ in value but agree in guard are the old
  // one-rule-many-numbers shape wearing new clothes.
  const byGuard = new Map<string, Set<number>>()
  for (const b of control.branches) {
    if (b.value == null) continue
    const k = `${b.kind}|${b.guard ?? ''}|${b.op ?? ''}|${fold(b.literal ?? '')}`
    if (!byGuard.has(k)) byGuard.set(k, new Set())
    byGuard.get(k)!.add(b.value)
  }
  for (const [k, vals] of byGuard) {
    if (vals.size > 1) {
      findings.push(`branches_indistinguishable: ${vals.size} different values (${[...vals].join(', ')}) `
        + `under the same condition [${k}] — nothing selects between them`)
    }
  }
  const defaults = control.branches.filter(b => b.kind === 'requirement' && b.guard == null)
  if (defaults.length > 1) {
    findings.push(`multiple_defaults: ${defaults.length} unguarded requirement branches`)
  }
  if (control.frame === 'dimensional' && !control.branches.some(b => b.value != null || b.terminal)) {
    findings.push('no_value: a dimensional control produced neither a number nor a terminal')
  }
  if (control.frame === 'rate' && !control.rate?.terms.length && !control.rate?.percentOfSpaces) {
    findings.push('rate_empty: a rate control produced no terms')
  }

  // ── coverage: how much of the cell the branches actually account for ──
  const coverage = hay.length ? Math.min(1, covered / hay.length) : 0
  if (coverage < 0.3 && control.frame !== 'narrative' && control.frame !== 'merit') {
    findings.push(`low_coverage: branches quote ${(100 * coverage).toFixed(0)}% of the control text — `
      + 'most of what the cell says was not read')
  }

  const hard = findings.some(f =>
    f.startsWith('span_not_literal') || f.startsWith('span_empty') || f.startsWith('guard_unknown'))
  const status: Status = hard ? 'rejected' : findings.length ? 'review' : 'ok'
  return { status, findings, coverage }
}
