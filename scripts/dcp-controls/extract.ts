/**
 * Stage 2 — a packet becomes a control with branches. The only stage that uses a model.
 *
 * THE INVARIANT THAT MAKES THIS SAFE: **the model never emits a value.** It emits a frame, a topic from a
 * closed list, a guard from the registry, and — for every branch — the verbatim span that states it. The
 * number is then read out of that span by `findNumberCandidates`, the same function the recall verifier
 * uses, so extraction and verification cannot drift apart.
 *
 * This is the lesson from the LEP round, where the contamination that forced a rollback of 93 rules came
 * from a value the chain produced rather than from a span. A model that cannot write a number cannot
 * write a wrong one. What it can still get wrong is which words to point at, and that is checkable:
 * stage 3 requires the span to be a literal substring of the packet.
 *
 * The second decision is scope, not model. Schema-constrained extraction scores ~80% valid against 3-10%
 * unconstrained — the largest effect size in this literature — so the guard registry and the topic list
 * are passed in as closed enumerations and anything outside them is a finding.
 *
 * Output grain is RASE (Hjelseth & Nisbet, CIB W78 2011): Requirement, Applicability, Selection,
 * Exception, each carrying the same attribute tuple. One control, many branches — which is what the cell
 * actually says, and what the current one-rule-many-numbers shape cannot represent.
 */
import { findNumberCandidates } from '../../server/utils/nsw-kg/verifiers/candidates'
import { FRAMES, FRAME_NAMES, GUARDS, TOPICS, type FrameName } from './guards'
import { normaliseRateText, parseRate, renderRate, type Rate } from './rates'
import { renderPacket, type Packet } from './packets'

export const EXTRACT_MODEL = 'meta-llama/Llama-3.3-70B-Instruct'

// ── what a control looks like after this stage ───────────────────────────────

export interface Branch {
  /** requirement = the control applies and this value binds; exception = it is displaced. */
  kind: 'requirement' | 'exception'
  /** Registry key, or null for the unguarded default branch. */
  guard: string | null
  /** How the guard is compared: 'is' / 'in' for enums and booleans, a comparator for numbers. */
  op: 'is' | 'is_not' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'between' | null
  /** What it is compared against, verbatim from the text ('designated', 'Cherrybrook', '1'). */
  literal: string | null
  /** The words of the packet that state this branch. Must be a literal substring. */
  span: string
  /** Read from `span` after the model returns — never supplied by the model. */
  value?: number | null
  valueUpper?: number | null
  unit?: string | null
  /** Set when the branch states no number: a deferral, a merit call, an established line. */
  terminal?: string | null
}

export interface Control {
  packetKey: string
  frame: FrameName
  topic: string | null
  /** gte for a minimum, lte for a maximum. */
  comparator: 'gte' | 'lte' | 'eq' | null
  unit: string | null
  /** What the control is measured from: front_boundary, side_boundary, natural_ground_level… */
  measuredFrom: string | null
  /** rate frames only: what the quantity is per — 'dwelling', '100 sqm gfa'. */
  perUnit: string | null
  /** deferral frames only: the instrument or map pointed at. */
  defersTo: string | null
  /** Scope read off the headers and the clause, as applicability dimensions. */
  applicability: { dimension: string; value: string; span: string }[]
  branches: Branch[]
  /**
   * rate frames only. A rate is a sum of terms computed from the proposal, not a value selected by a
   * condition on the site, so it has its own structure and its own deterministic reader.
   */
  rate: Rate | null
  /** Populated by stage 3. */
  findings: string[]
}

// ── the prompt ───────────────────────────────────────────────────────────────

const guardLines = GUARDS.map(g => {
  const vals = g.values?.length ? ` — one of: ${g.values.join(', ')}` : ''
  const unit = g.unit ? ` (${g.unit})` : ''
  return `  ${g.key} [${g.type}${unit}] ${g.label}${vals}`
}).join('\n')

const frameLines = FRAME_NAMES.map(f => `  ${f} — ${FRAMES[f].label}. ${FRAMES[f].blurb}`).join('\n')

export const SYSTEM_PROMPT = `You read ONE control from a NSW Development Control Plan and describe its structure.

You never write a number. Numbers are read from the text you point at, by a separate program. If you
write a number anywhere except inside a quoted span, the output is rejected.

## What you return

A single JSON object:

{
  "frame": one of the frames below,
  "topic": one of the topics below, or null if none fits,
  "comparator": "gte" for a minimum, "lte" for a maximum, "eq" for a fixed value, or null,
  "unit": the unit the control is stated in ("metre","sqm","percent","spaces","storeys","degrees") or null,
  "measured_from": what it is measured from ("front_boundary","side_boundary","rear_boundary",
                   "natural_ground_level","ceiling","street") or null,
  "per_unit": for a rate frame only, what the quantity is per ("dwelling","bedroom","100 sqm gfa"),
  "defers_to": for a deferral frame only, the instrument, clause or map named,
  "applicability": [ { "dimension": one of
        zone | land_use | dev_type | lot_type | locality | site_ref | map_area | act | dev_element,
        "value": the term as the text writes it,
        "span": verbatim words that establish it } ],
  "branches": [ { "kind": "requirement" | "exception",
                  "guard": a guard key below, or null for the branch that applies when no guard matches,
                  "op": "is" | "is_not" | "in" | "gte" | "lte" | "gt" | "lt" | "between" | null,
                  "literal": what the guard is compared against, as the text writes it, or null,
                  "span": the verbatim words of this branch } ]
}

## Frames
${frameLines}

## Topics
${TOPICS.join(', ')}

## Guards — the ONLY conditions you may branch on
${guardLines}

## Rules

1. **Every branch's span must be a literal substring of the CONTROL TEXT**, character for character.
   Copy it; do not retype it, normalise it or join across an ellipsis. Keep it to the words that state
   that one branch.
2. **One branch per distinct value.** "6m to local roads and 9m to designated roads" is TWO requirement
   branches, guarded by frontage_road_class is local and frontage_road_class is designated. It is not one
   branch and it is not two controls.
3. **"except", "unless", "other than" start exception branches.** A bulleted carve-out list is one
   exception branch per bullet.
4. **A branch with no guard is the default** — the value that binds when no other branch matches. Most
   controls have exactly one. Do not invent a guard to cover a branch that has none.
5. **Only guards from the list.** If the text branches on something not in the list, use the closest
   guard whose meaning genuinely matches; if none does, emit the branch with "guard": "UNSUPPORTED" and
   put the condition's words in "literal". Never invent a guard key.
6. **A branch that states no number still gets a branch** — a deferral, "merit assessment", "the
   established building line". Its span is the words that say so.
7. **Applicability comes from the headers and the clause, not from the control text.** The row header
   "Front boundary (Primary frontage) Dwellings and detached dual occupancies" gives dev_element =
   front boundary AND land_use = dwelling, land_use = dual occupancy (detached).
8. Return the JSON object and nothing else.`

const FEW_SHOT = `CONTROL TEXT: 6m to local roads and 9m to designated roads, except for the following ▪ On local roads, where an existing setback of 7.6m or greater exists, it may be necessary to conform to this setback to maintain the streetscape character, ▪ 3m Brooklyn Road, Brooklyn and ▪ 9m to roads in Cherrybrook

{"frame":"dimensional","topic":"setback","comparator":"gte","unit":"metre","measured_from":"front_boundary","per_unit":null,"defers_to":null,"applicability":[{"dimension":"dev_element","value":"front boundary","span":"Front boundary (Primary frontage)"},{"dimension":"land_use","value":"dwelling","span":"Dwellings and detached dual occupancies"},{"dimension":"land_use","value":"dual occupancy (detached)","span":"Dwellings and detached dual occupancies"}],"branches":[{"kind":"requirement","guard":"frontage_road_class","op":"is","literal":"local","span":"6m to local roads"},{"kind":"requirement","guard":"frontage_road_class","op":"is","literal":"designated","span":"9m to designated roads"},{"kind":"exception","guard":"existing_building_line","op":"gte","literal":"7.6m","span":"On local roads, where an existing setback of 7.6m or greater exists, it may be necessary to conform to this setback"},{"kind":"exception","guard":"site_ref","op":"is","literal":"Brooklyn Road, Brooklyn","span":"3m Brooklyn Road, Brooklyn"},{"kind":"exception","guard":"locality","op":"is","literal":"Cherrybrook","span":"9m to roads in Cherrybrook"}]}`

// ── the call ─────────────────────────────────────────────────────────────────

interface CallOpts { apiKey: string; model?: string; timeoutMs?: number }

async function callModel(prompt: string, opts: CallOpts): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000)
  try {
    const res = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model ?? EXTRACT_MODEL,
        temperature: 0,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: FEW_SHOT.split('\n\n')[0]! },
          { role: 'assistant', content: FEW_SHOT.split('\n\n')[1]! },
          { role: 'user', content: prompt },
        ],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 180)}`)
    const j = await res.json() as any
    return j?.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(t)
  }
}

function parseJson(raw: string): any {
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s < 0 || e <= s) throw new Error('no JSON object in the response')
  return JSON.parse(raw.slice(s, e + 1))
}

// ── reading the numbers out of the spans, deterministically ──────────────────

/**
 * Fill each branch's value from its own span.
 *
 * A branch that quotes "6m to local roads" yields 6; one that quotes "merit assessment" yields no number
 * and is marked terminal. Where a span carries more than one candidate the FIRST is taken and the rest
 * become a finding, because a branch is one value by construction — two means the split was wrong, and
 * that is exactly the failure this pipeline exists to catch rather than average over.
 */
export function readValues(c: Control, packet: Packet): void {
  for (const b of c.branches) {
    // A span that is ONLY a number is a matrix cell, and its value is itself. findNumberCandidates
    // ignores a bare number on purpose - in prose it is as likely to be a clause reference - but in a
    // table the cell is the value and the unit comes from the column header.
    // "Three storeys" is a value. normaliseRateText already turns spelled-out numbers into digits
    // for the rate grammar; the dimensional reader needs the same courtesy.
    const spanText = normaliseRateText(b.span)
    const bare = /^\s*([\d]+(?:\.\d+)?)\s*(%?)\s*$/.exec(b.span)
    if (bare) {
      b.value = Number(bare[1])
      b.unit = bare[2] ? 'percent' : c.unit ?? null
      continue
    }
    const all = findNumberCandidates(spanText)

    // The guard's own number selects the branch; it is not what the branch requires. "Up to 1 storey =
    // 3m" must yield 3 m, not 1. Drop any candidate equal to a number inside the guard literal.
    const guardNums = new Set(
      b.guard ? findNumberCandidates(b.literal ?? '').map(x => x.value) : [])
    let cands = guardNums.size ? all.filter(x => !guardNums.has(x.value)) : all

    // Then prefer the control's own unit. A setback is in metres; a storey count in the same span is the
    // condition. A candidate with no unit is kept, because most cells write "3m" once and "= 8" after.
    if (c.unit) {
      const matching = cands.filter(x => !x.unit || x.unit === c.unit)
      if (matching.length) cands = matching
    }

    if (!cands.length) {
      b.value = null
      b.terminal = terminalOf(b.span)
      // a terminal IS the answer - "conform to the established line" has no number by design
      if (all.length && !b.terminal) {
        c.findings.push(`value_all_filtered: "${b.span.slice(0, 60)}" has numbers `
          + `(${all.map(x => x.value).join(', ')}) but every one is the guard's or the wrong unit`)
      }
      continue
    }

    const first = cands[0]!
    b.value = first.value
    b.unit = first.unit ?? c.unit ?? null

    if (cands.length > 1) {
      const second = cands[1]!
      const sameUnit = (first.unit ?? c.unit) === (second.unit ?? c.unit)
      const readsAsRange = /\bbetween\b|\bfrom\b.+\bto\b|\d\s*(?:-|to|\u2013)\s*\d/.test(b.span)
      if (sameUnit && readsAsRange && cands.length === 2 && second.value > first.value) {
        b.valueUpper = second.value
      } else {
        c.findings.push(
          `branch_multivalued: "${b.span.slice(0, 60)}" yields ${cands.length} numbers `
          + `(${cands.map(x => x.value).join(', ')}) after filtering - the split is probably wrong`)
      }
    }
  }
}

const TERMINALS: [RegExp, string][] = [
  [/merit assessment|to council'?s? satisfaction|as determined by council/i, 'merit'],
  [/see (clause|section|part)|refer to|in accordance with .*(lep|dcp|sepp|code)/i, 'deferral'],
  [/established|existing|prevailing/i, 'established_line'],
  [/nil|none|not permitted|no .*permitted/i, 'nil'],
]

function terminalOf(span: string): string | null {
  for (const [re, name] of TERMINALS) if (re.test(span)) return name
  return null
}

// ── the stage ────────────────────────────────────────────────────────────────

export interface ExtractResult {
  control: Control | null
  error: string | null
  raw?: string
}

export async function extractControl(packet: Packet, opts: CallOpts): Promise<ExtractResult> {
  let raw = ''
  try {
    raw = await callModel(renderPacket(packet), opts)
    const j = parseJson(raw)
    const frame = FRAME_NAMES.includes(j.frame) ? (j.frame as FrameName) : 'narrative'
    const control: Control = {
      packetKey: packet.key,
      frame,
      topic: typeof j.topic === 'string' && j.topic ? j.topic : null,
      comparator: ['gte', 'lte', 'eq'].includes(j.comparator) ? j.comparator : null,
      unit: typeof j.unit === 'string' && j.unit ? j.unit : null,
      measuredFrom: typeof j.measured_from === 'string' && j.measured_from ? j.measured_from : null,
      perUnit: typeof j.per_unit === 'string' && j.per_unit ? j.per_unit : null,
      defersTo: typeof j.defers_to === 'string' && j.defers_to ? j.defers_to : null,
      applicability: Array.isArray(j.applicability)
        ? j.applicability.filter((a: any) => a?.dimension && a?.value).map((a: any) => ({
            dimension: String(a.dimension), value: String(a.value), span: String(a.span ?? ''),
          }))
        : [],
      branches: Array.isArray(j.branches)
        ? j.branches.filter((b: any) => typeof b?.span === 'string' && b.span.trim()).map((b: any) => ({
            kind: b.kind === 'exception' ? 'exception' : 'requirement',
            guard: b.guard == null || b.guard === '' ? null : String(b.guard),
            op: b.op == null || b.op === '' ? null : String(b.op) as Branch['op'],
            literal: b.literal == null || b.literal === '' ? null : String(b.literal),
            span: String(b.span),
          }))
        : [],
      rate: null,
      findings: [],
    }
    // "At least 10% of dwellings should be adaptable" is a proportion of the proposal, not a rate
    // per unit of it. Sent to the rate parser it yields nothing; read as a dimensional percentage it
    // is exact.
    if (control.frame === 'rate' && /^[^/]*\b\d+(?:\.\d+)?\s*%/.test(packet.text)
        && !/\bper\b|\//.test(packet.text)) {
      control.frame = 'dimensional'
      control.unit ??= 'percent'
    }
    if (control.frame === 'rate') {
      // the whole cell, not the branch spans: a rate's terms are joined by '+' and 'and', and the
      // model's branch split cuts through exactly those joins
      control.rate = parseRate(packet.text)
      if (control.rate.problem) control.findings.push(`rate_unparsed: ${control.rate.problem}`)
      for (const b of control.branches) b.terminal ??= 'rate'
    } else {
      // A matrix cell holding only a number ("2", "4.5") has nothing to split, so the model
      // returns no branches and the control ends with no value at all. The cell IS the value.
      // This is most of the storeys column in a height matrix.
      if (!control.branches.length && /^[\d.,]+\s*%?$/.test(packet.text.trim())) {
        control.branches.push({
          kind: 'requirement', guard: null, op: null, literal: null, span: packet.text.trim(),
        })
      }
      readValues(control, packet)
    }
    return { control, error: null, raw }
  } catch (e: any) {
    return { control: null, error: String(e?.message ?? e).slice(0, 200), raw }
  }
}
