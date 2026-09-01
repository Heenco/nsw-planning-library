// ── Proposition + question streaming upsert ────────────────────────────
//
// Each clause result is written to the DB in its own small transaction as
// soon as it's ready, so the ingest is resumable, observable, and crash-safe.
//
// Two entry points:
//   upsertClauseResult(documentId, result)         — single clause (streaming)
//   upsertPropositions(documentId, results)        — batch (legacy / tests)

import { withNswTx } from '../pool'
import type { ClauseResult } from '../decomposer/decompose-document'
import { DECOMPOSE_MODEL } from '../decomposer/decompose-clause'

export interface UpsertClauseResultOutput {
  inserted:  number
  flagged:   boolean
  questions: number
}

/** Insert all propositions + questions for ONE clause in a single transaction. */
export async function upsertClauseResult(
  documentId: string,
  r: ClauseResult,
): Promise<UpsertClauseResultOutput> {
  return withNswTx(async (client) => {
    let inserted = 0
    let questions = 0

    if (r.propositions.length === 0) {
      if (r.verification === 'flagged') {
        await insertQuestion(
          client, documentId, r,
          'verifier_failed',
          'No propositions extracted',
          r.diagnostics,
        )
        questions++
      }
      return { inserted: 0, flagged: r.verification === 'flagged', questions }
    }

    // Insert propositions in order so conditional_on_local indices resolve.
    const insertedIds: string[] = []
    for (let i = 0; i < r.propositions.length; i++) {
      const p = r.propositions[i]!
      const conditionalOnUuid =
        p.conditional_on_local != null && insertedIds[p.conditional_on_local]
          ? insertedIds[p.conditional_on_local]!
          : null

      const row = await client.query<{ id: string }>(`
        INSERT INTO proposition (
          document_id, section_id, type, subject, predicate, object,
          numeric_value, numeric_unit, numeric_comparator, numeric_upper, value_source,
          source_span, conditional_on, exempts_ref, refs,
          confidence, verification_status, extraction_model
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13::uuid, $14, $15::jsonb,
          $16::numeric, $17, $18
        )
        RETURNING id
      `, [
        documentId, r.section_id, p.type, p.subject, p.predicate, p.object,
        p.numeric_value, p.numeric_unit, p.numeric_comparator, p.numeric_upper, p.value_source,
        p.source_span, conditionalOnUuid, p.exempts_ref,
        p.references && p.references.length > 0 ? JSON.stringify(p.references) : null,
        p.confidence, r.verification, DECOMPOSE_MODEL,
      ])
      insertedIds.push(row.rows[0]!.id)
      inserted++
    }

    if (r.verification === 'flagged') {
      const d = r.diagnostics
      if (d.recall_hard_misses?.length > 0) {
        for (const miss of d.recall_hard_misses) {
          await insertQuestion(
            client, documentId, r,
            'missed_number',
            `Missed threshold ${miss.candidate.raw}${miss.candidate.unit ? ' ' + miss.candidate.unit : ''}`,
            { candidate: miss.candidate, severity: miss.severity },
          )
          questions++
        }
      }
      if (d.precision_violations?.length > 0) {
        for (const v of d.precision_violations) {
          await insertQuestion(
            client, documentId, r,
            'verifier_failed',
            `Precision: ${v.field}: ${v.reason}`,
            { violation: v },
          )
          questions++
        }
      }
      if (d.llm_errors?.length > 0) {
        for (const err of d.llm_errors) {
          await insertQuestion(
            client, documentId, r,
            'verifier_failed',
            `LLM output: ${err}`,
            null,
          )
          questions++
        }
      }
    }

    return { inserted, flagged: r.verification === 'flagged', questions }
  })
}

async function insertQuestion(
  client: any,
  documentId: string,
  r: ClauseResult,
  type: 'missed_number' | 'unresolved_ref' | 'verifier_failed' | 'low_confidence',
  detail: string,
  candidate: any,
): Promise<void> {
  await client.query(`
    INSERT INTO question (document_id, section_id, type, detail, candidate, status, priority)
    VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, 'open', 5)
  `, [documentId, r.section_id, type, detail, candidate ? JSON.stringify(candidate) : null])
}
