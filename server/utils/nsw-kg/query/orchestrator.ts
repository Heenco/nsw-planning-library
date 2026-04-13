// ── Query orchestrator ──────────────────────────────────────────────────
//
// Stage A → B → C → D → E with SSE event emission.

import { sseEvent } from '../../sitewise/sse'
import { classifyIntent } from './intent'
import { retrieveCandidates } from './retrieve'
import { expandGraph } from './expand'
import { applyHierarchyFilter } from './hierarchy'
import { synthesize } from './synthesize'
import type { QueryEvent } from './types'

export interface QueryOrchestratorOptions {
  query:        string
  lgaFilter?:   string
  docTypeFilter?: 'lep' | 'sepp' | 'dcp'
  /** DeepInfra key — used for retrieval embeddings + synthesis fallback (always required). */
  apiKey:       string
  /** Gemini key — used for the intent classifier. Optional; falls back to DeepInfra. */
  geminiKey?:   string
  /** Groq key — used for synthesis (preferred, ~10× faster). Falls back to DeepInfra. */
  groqKey?:     string
  res:          any                 // Node response stream for SSE
}

export async function runQuery(opts: QueryOrchestratorOptions): Promise<void> {
  const { res } = opts
  const t0 = Date.now()
  const emit = (evt: QueryEvent) => sseEvent(res, evt.type, evt.payload as any)
  const step = (agent: string, status: 'running' | 'done' | 'warn' | 'skip', message: string, detail?: string) => {
    emit({ type: 'agent_step', payload: { agent, status, message, detail, ms: Date.now() - t0 } })
  }

  try {
    // ── Stage A — intent + entities ──────────────────────────────────
    step('Intent', 'running', 'Classifying question…')
    const planT0 = Date.now()
    const plan = await classifyIntent(opts.query, {
      geminiKey:    opts.geminiKey,
      groqKey:      opts.groqKey,
      deepinfraKey: opts.apiKey,
    })
    step('Intent', 'done', `Intent: ${plan.intent}`,
      [
        plan.entities.lga && `LGA: ${plan.entities.lga}`,
        plan.entities.zone && `Zone: ${plan.entities.zone}`,
        plan.entities.land_use && `Use: ${plan.entities.land_use}`,
        plan.entities.doc_type && `Doc: ${plan.entities.doc_type}`,
        plan.entities.topic && `Topic: ${plan.entities.topic}`,
      ].filter(Boolean).join(' · ') || undefined)
    emit({ type: 'plan', payload: plan })

    // ── Stage B — hybrid retrieval ───────────────────────────────────
    step('Retrieval', 'running', 'Searching graph (vector + BM25 + RRF)…')
    const retrieveT0 = Date.now()
    const retrieved = await retrieveCandidates({
      query: opts.query,
      plan,
      apiKey: opts.apiKey,
      lgaFilter: opts.lgaFilter,
      docTypeFilter: opts.docTypeFilter,
    })
    step('Retrieval', 'done', `${retrieved.length} candidates in ${Date.now() - retrieveT0}ms`)
    emit({
      type: 'retrieved',
      payload: {
        count: retrieved.length,
        top: retrieved.slice(0, 10).map((c) => ({
          id: c.id,
          subject: c.subject,
          type: c.type,
          document_title: c.document_title,
          section_local_id: c.section_local_id,
          rrf_score: Number(c.rrf_score.toFixed(4)),
        })),
      },
    })

    if (retrieved.length === 0) {
      step('Retrieval', 'warn', 'No candidates found')
      // still synthesise a "no result" message
    }

    // ── Stage C — graph expansion ────────────────────────────────────
    step('Expand', 'running', 'Walking related edges (defines, requires, constrains)…')
    const expandT0 = Date.now()
    const ctx = await expandGraph(retrieved)
    step('Expand', 'done', `+${ctx.expanded.length} expanded → ${ctx.total} total in ${Date.now() - expandT0}ms`)
    emit({ type: 'expanded', payload: { added: ctx.expanded.length, total: ctx.total } })

    // ── Stage D — hierarchy filter ───────────────────────────────────
    step('Hierarchy', 'running', 'Applying SEPP > LEP > DCP precedence…')
    const filtered = applyHierarchyFilter(ctx)
    if (filtered.decisions.length > 0) {
      step('Hierarchy', 'done',
        `${filtered.kept.length} kept · ${filtered.dropped.length} overridden`,
        filtered.decisions.slice(0, 3).map((d) => `${d.loser_subject} → ${d.winner_doc}`).join('; '))
    } else {
      step('Hierarchy', 'done', `${filtered.kept.length} kept · no overrides`)
    }
    emit({
      type: 'hierarchy_filter',
      payload: {
        kept: filtered.kept.length,
        dropped: filtered.dropped.length,
        decisions: filtered.decisions,
      },
    })

    emit({
      type: 'context_summary',
      payload: {
        propositions_in_context: filtered.kept.length,
        tokens_estimate: filtered.kept.reduce((acc, c) => acc + Math.ceil((c.source_span?.length ?? 0) / 4) + 30, 0),
      },
    })

    // ── Stage E — synthesise streaming answer ────────────────────────
    step('Answer', 'running', 'Drafting answer…')
    const result = await synthesize({
      query: opts.query,
      plan,
      context: filtered,
      apiKey: opts.apiKey,
      groqKey: opts.groqKey,
      onChunk: (text) => sseEvent(res, 'answer_chunk', { text }),
    })
    step('Answer', 'done', `${result.full_text.length} chars · ${result.citations.length} citations · ${result.ms}ms`)

    emit({ type: 'citations', payload: { citations: result.citations, cite_index: result.cite_index } })
    emit({ type: 'done', payload: { ms: Date.now() - t0 } })
  } catch (err) {
    const msg = (err as Error).message || String(err)
    emit({ type: 'error', payload: { message: msg } })
  } finally {
    if (typeof res.end === 'function') res.end()
  }
}
