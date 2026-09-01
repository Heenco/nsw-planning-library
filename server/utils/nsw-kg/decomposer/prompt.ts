// ── Stage 1 decomposer prompt ───────────────────────────────────────────
//
// System prompt + few-shot examples for per-clause atomic decomposition.
// The LLM is asked to emit an array of AtomicProposition objects matching
// the JSON schema in llm-schema.ts.
//
// Rules enforced by few-shot:
//   1. IF-THEN splitting
//   2. Map-deferred thresholds (value_source = "map:...")
//   3. Compound conditions become multiple condition propositions
//   4. source_span must be a literal substring of the input clause
//   5. references[] lists every explicit clause ref in the source_span
//   6. conditional_on_local is an integer index pointing to a sibling
//      proposition in the same response array

import { ATOMIC_PROPOSITION_JSON_SCHEMA } from '../llm-schema'

export const SYSTEM_PROMPT = `You are a NSW planning law decomposer. Your job is to read one clause at a time from an NSW Local Environmental Plan, State Environmental Planning Policy, or Development Control Plan, and break it into atomic propositions.

An atomic proposition is ONE rule, ONE classification, or ONE definition. Never bundle an IF-THEN sentence into a single proposition — split the condition from the rule.

## Proposition types

- **obligation**   : a positive duty ("the applicant must provide …")
- **prohibition**  : a negative duty ("no building may exceed …" → also use 'threshold' for the number)
- **permission**   : something allowed ("is permitted with consent")
- **condition**    : a classification of land, people, or situations ("land is situated within the flood planning area")
- **threshold**    : a numerical limit (FSR, height, lot size, setback, storey count, etc.) — may have literal number OR a reference to a map
- **definition**   : a dictionary entry ("X means …")
- **exception**    : an exemption ("despite clause X, Y does not apply")
- **requirement**  : a procedural must ("the consent authority must consider …")

## Critical rules

**Rule 1 — Split IF-THEN sentences.** If a clause says "if [condition] then [rule]" or "X applies to land that is Y" or "for land in Z, no building may …", you MUST emit at least TWO propositions: one of type 'condition' for the left side, and one rule proposition for the right side. Link them with the 'conditional_on_local' field on the rule proposition, which is the integer INDEX (0-based) of the condition within YOUR OUTPUT ARRAY for this clause.

**Rule 2 — Map-deferred thresholds.** NSW LEPs defer numerical development standards to maps. If the clause says "not to exceed the maximum height shown on the Height of Buildings Map" (or similar for FSR, lot size, etc.), emit a 'threshold' proposition with **numeric_value = null** and **value_source = "map:<MapName>"**. The map name is the proper noun that appears in the clause, with spaces → underscores. Do NOT invent a number. Do not write the threshold's value from memory.

**Rule 3 — Literal source_span.** Every proposition's 'source_span' field MUST be a literal substring of the input clause text, word for word. The verifier will reject it otherwise. Quote exactly — including punctuation and capitalisation. Keep it short (1-2 sentences). Never paraphrase.

**Rule 4 — Every number accounted for.** Before you submit your output, check that every number in the clause text (except clause/section/schedule reference numbers and years) appears in the numeric_value of some threshold proposition, or is part of a non-threshold proposition's source_span and you can justify why it isn't a threshold.

**Rule 5 — Subject and predicate are short.** subject ≤ 80 chars, predicate ≤ 200 chars. Put the detail in the source_span, not in the subject.

**Rule 6 — Cross-references.** Populate the 'references' array with every explicit clause reference in the source_span: "clause 4.1" → { type: 'clause', ref: '4.1' }. "Schedule 1" → { type: 'schedule', ref: '1' }. Don't guess implicit refs like "this clause".

**Rule 7 — Exceptions.** If the clause starts with "Despite clause X" or "Subclause (N) does not apply to", emit it as type='exception' and set 'exempts_ref' to the clause number being exempted.

## Output format

Return JSON only. Either an array of propositions, or an object like { "propositions": [...] }. Use this schema per proposition:

${ATOMIC_PROPOSITION_JSON_SCHEMA}
`

// ── Few-shot examples ────────────────────────────────────────────────────
//
// Each example pairs an input clause with the expected propositions array.
// The examples are concatenated into the user message.

interface FewShot {
  clause_heading: string
  clause_text: string
  expected: any[]
}

export const FEW_SHOT_EXAMPLES: FewShot[] = [
  // 1. Map-deferred threshold (the Clause 4.3 canonical case)
  {
    clause_heading: 'Part 4 > Clause 4.3 Height of buildings > Subclause (2)',
    clause_text: 'The maximum height of a building on any land is not to exceed the maximum height shown for the land on the Height of Buildings Map.',
    expected: [
      {
        type: 'threshold',
        subject: 'building height',
        predicate: 'must not exceed value shown on the Height of Buildings Map',
        object: null,
        numeric_value: null,
        numeric_unit: 'metre',
        numeric_comparator: 'lte',
        numeric_upper: null,
        value_source: 'map:Height_of_Buildings_Map',
        source_span: 'The maximum height of a building on any land is not to exceed the maximum height shown for the land on the Height of Buildings Map.',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.95,
      },
    ],
  },

  // 2. Literal numeric threshold
  {
    clause_heading: 'Part 4 > Clause 4.1 Minimum subdivision lot size > Subclause (3)',
    clause_text: 'The minimum size of any lot resulting from a subdivision of land to which this clause applies is 450 square metres.',
    expected: [
      {
        type: 'threshold',
        subject: 'minimum subdivision lot size',
        predicate: 'must be at least',
        object: null,
        numeric_value: 450,
        numeric_unit: 'sqm',
        numeric_comparator: 'gte',
        numeric_upper: null,
        value_source: null,
        source_span: 'The minimum size of any lot resulting from a subdivision of land to which this clause applies is 450 square metres.',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.95,
      },
    ],
  },

  // 3. IF-THEN split: classification + prohibition
  {
    clause_heading: 'Part 6 > Clause 6.3 Flood planning',
    clause_text: 'Development consent must not be granted to development on land within the flood planning area for the purpose of a dual occupancy unless the consent authority is satisfied that the development will not adversely affect flood behaviour.',
    expected: [
      {
        type: 'condition',
        subject: 'land',
        predicate: 'is situated within',
        object: 'flood planning area',
        numeric_value: null,
        numeric_unit: null,
        numeric_comparator: null,
        numeric_upper: null,
        value_source: 'map:Flood_Planning_Map',
        source_span: 'land within the flood planning area',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.9,
      },
      {
        type: 'prohibition',
        subject: 'dual occupancy',
        predicate: 'requires consent authority satisfaction on flood impact',
        object: null,
        numeric_value: null,
        numeric_unit: null,
        numeric_comparator: null,
        numeric_upper: null,
        value_source: null,
        source_span: 'Development consent must not be granted to development on land within the flood planning area for the purpose of a dual occupancy unless the consent authority is satisfied that the development will not adversely affect flood behaviour.',
        references: [],
        conditional_on_local: 0,
        exempts_ref: null,
        confidence: 0.9,
      },
    ],
  },

  // 4. Definition
  {
    clause_heading: 'Dictionary > dwelling house',
    clause_text: 'dwelling house means a building containing only one dwelling.',
    expected: [
      {
        type: 'definition',
        subject: 'dwelling house',
        predicate: 'means',
        object: 'a building containing only one dwelling',
        numeric_value: null,
        numeric_unit: null,
        numeric_comparator: null,
        numeric_upper: null,
        value_source: null,
        source_span: 'dwelling house means a building containing only one dwelling.',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.99,
      },
    ],
  },

  // 5. Exception
  {
    clause_heading: 'Part 4 > Clause 4.6 Exceptions to development standards > Subclause (1)',
    clause_text: 'Despite clause 4.1, the consent authority may consent to development that contravenes a development standard if the applicant demonstrates that compliance with the standard is unreasonable or unnecessary in the circumstances of the case.',
    expected: [
      {
        type: 'exception',
        subject: 'development standards',
        predicate: 'may be contravened with consent',
        object: null,
        numeric_value: null,
        numeric_unit: null,
        numeric_comparator: null,
        numeric_upper: null,
        value_source: null,
        source_span: 'Despite clause 4.1, the consent authority may consent to development that contravenes a development standard if the applicant demonstrates that compliance with the standard is unreasonable or unnecessary in the circumstances of the case.',
        references: [{ type: 'clause', ref: '4.1' }],
        conditional_on_local: null,
        exempts_ref: '4.1',
        confidence: 0.9,
      },
    ],
  },

  // 6. Multiple thresholds in one clause (the recall-verifier test case)
  {
    clause_heading: 'DCP Part 10 > Dwelling House Setbacks',
    clause_text: 'The minimum front setback is 4 metres, the minimum side setback is 0.9 metres, and the minimum rear setback is 2 metres.',
    expected: [
      {
        type: 'threshold',
        subject: 'minimum front setback',
        predicate: 'must be at least',
        object: null,
        numeric_value: 4,
        numeric_unit: 'metre',
        numeric_comparator: 'gte',
        numeric_upper: null,
        value_source: null,
        source_span: 'The minimum front setback is 4 metres',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.95,
      },
      {
        type: 'threshold',
        subject: 'minimum side setback',
        predicate: 'must be at least',
        object: null,
        numeric_value: 0.9,
        numeric_unit: 'metre',
        numeric_comparator: 'gte',
        numeric_upper: null,
        value_source: null,
        source_span: 'the minimum side setback is 0.9 metres',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.95,
      },
      {
        type: 'threshold',
        subject: 'minimum rear setback',
        predicate: 'must be at least',
        object: null,
        numeric_value: 2,
        numeric_unit: 'metre',
        numeric_comparator: 'gte',
        numeric_upper: null,
        value_source: null,
        source_span: 'the minimum rear setback is 2 metres',
        references: [],
        conditional_on_local: null,
        exempts_ref: null,
        confidence: 0.95,
      },
    ],
  },
]

export function buildUserPrompt(args: {
  clause_heading: string
  clause_text: string
  candidate_numbers?: string[]
}): string {
  const { clause_heading, clause_text, candidate_numbers = [] } = args

  const fewShot = FEW_SHOT_EXAMPLES.map((ex, i) => {
    return `### Example ${i + 1}
Clause: ${ex.clause_heading}
Text: "${ex.clause_text}"

Output:
${JSON.stringify(ex.expected, null, 2)}`
  }).join('\n\n')

  const candidateBlock = candidate_numbers.length > 0
    ? `\n\nI detected these candidate numbers in the clause text: [${candidate_numbers.join(', ')}]. Each one must either appear in a threshold proposition's numeric_value, or be explained away (e.g., "0.9" could be a section reference, not a number).`
    : ''

  return `${fewShot}

---
Now decompose this clause. Return JSON only.

Clause: ${clause_heading}
Text: """${clause_text}"""${candidateBlock}

Output:`
}
