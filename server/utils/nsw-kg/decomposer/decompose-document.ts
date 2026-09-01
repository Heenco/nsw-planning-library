// ── Stage 1 orchestration across a document ────────────────────────────
//
// Takes the flat section list from Stage 0, filters to leaf clauses with
// non-empty raw_text, and fans out decomposeClause() calls through a
// semaphore.
//
// STREAMING: each clause's result is handed to `onClauseComplete` as soon
// as it finishes decomposing, so the orchestrator can write it to the DB
// immediately. This means the ingest is resumable, crash-safe, and live-
// visible from the page.
//
// Emits IngestEvents as clauses complete so the CLI and page can show
// live progress.

import { mapWithConcurrency } from '../semaphore'
import { decomposeClause, DECOMPOSE_MODEL } from './decompose-clause'
import type { AtomicProposition, IngestEvent } from '../types'

export const DECOMPOSE_CONCURRENCY = 12

export interface ClauseInput {
  section_id:      string               // DB UUID
  section_local_id: string
  clause_heading:  string
  clause_text:     string
}

export interface ClauseResult {
  section_id:       string
  section_local_id: string
  propositions:     AtomicProposition[]
  verification:     'verified' | 'flagged'
  diagnostics:      any
}

export interface DecomposeDocumentInput {
  clauses:       ClauseInput[]
  deepinfraKey:  string
  onEvent?:      (evt: IngestEvent) => void
  concurrency?:  number
  /** Called as each clause completes — orchestrator writes to DB here. */
  onClauseComplete?: (r: ClauseResult, runningTotals: {
    done: number
    total: number
    verified: number
    flagged: number
    total_propositions: number
    thresholds: number
    inserted_so_far: number
  }) => Promise<void>
}

export interface DecomposeDocumentResult {
  totals: {
    clauses:            number
    verified:           number
    flagged:            number
    total_propositions: number
    thresholds:         number
  }
}

export async function decomposeDocument(input: DecomposeDocumentInput): Promise<DecomposeDocumentResult> {
  const { clauses, deepinfraKey } = input
  const emit = input.onEvent ?? (() => {})
  const concurrency = input.concurrency ?? DECOMPOSE_CONCURRENCY

  emit({
    type: 'stage_start',
    stage: 'decompose',
    message: `decomposing ${clauses.length} clauses (concurrency=${concurrency}, model=${DECOMPOSE_MODEL})`,
  })
  const t0 = Date.now()

  let done = 0
  let verified = 0
  let flagged = 0
  let thresholds = 0
  let totalProps = 0
  let insertedSoFar = 0

  await mapWithConcurrency(clauses, concurrency, async (clause) => {
    const out = await decomposeClause({
      clause_heading: clause.clause_heading,
      clause_text:    clause.clause_text,
      deepinfraKey,
    })

    const result: ClauseResult = {
      section_id:       clause.section_id,
      section_local_id: clause.section_local_id,
      propositions:     out.propositions,
      verification:     out.verification,
      diagnostics:      out.diagnostics,
    }

    // Update running counters (before write so the callback sees current state)
    done++
    if (out.verification === 'verified') verified++
    else flagged++
    totalProps += out.propositions.length
    thresholds += out.propositions.filter((p) => p.type === 'threshold').length

    // Stream the result to the orchestrator (typically writes to DB)
    if (input.onClauseComplete) {
      try {
        await input.onClauseComplete(result, {
          done,
          total: clauses.length,
          verified,
          flagged,
          total_propositions: totalProps,
          thresholds,
          inserted_so_far: insertedSoFar,
        })
        insertedSoFar += out.propositions.length
      } catch (err) {
        // Writer failed — log as event and keep going
        emit({
          type: 'error',
          stage: 'decompose',
          message: `write failed for section ${clause.section_local_id}: ${(err as Error).message}`,
        })
      }
    }

    // Emit progress every 5 clauses (more granular for live viewing)
    if (done % 5 === 0 || done === clauses.length) {
      emit({
        type: 'stage_progress',
        stage: 'decompose',
        current: done,
        total: clauses.length,
        message: `verified=${verified} flagged=${flagged} props=${totalProps} thresholds=${thresholds}`,
      })
    }
  })

  emit({
    type: 'stage_done',
    stage: 'decompose',
    ms: Date.now() - t0,
    counts: { clauses: clauses.length, verified, flagged, total_propositions: totalProps, thresholds },
  })

  return {
    totals: {
      clauses: clauses.length,
      verified,
      flagged,
      total_propositions: totalProps,
      thresholds,
    },
  }
}
