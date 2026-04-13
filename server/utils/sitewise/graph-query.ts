// ── graph-query.ts ──────────────────────────────────────────────────────
//
// A thin adapter that lets sitewise v2 agents call the nsw-kg v2 query
// orchestrator programmatically — without needing an HTTP round-trip.
//
// Works by passing a `CapturingResponse` stream to `runQuery()` that
// collects the SSE events in-memory. After the run completes, we parse the
// captured events into a structured result with the retrieved propositions,
// citations, hierarchy decisions, and the synthesised answer text.
//
// Used by legal-v2.ts, standards-v2.ts, and environmental-v2.ts.

import { runQuery } from '../nsw-kg/query/orchestrator'
import type {
  QueryPlan,
  RetrievalCandidate,
  Citation,
  OverrideDecision,
} from '../nsw-kg/query/types'

// ── Mock response stream that captures SSE events ─────────────────────
//
// Mirrors the pattern in server/utils/nsw-kg/benchmark/query-runner.ts.
// Node response stream shape: write(chunk), end(), optional flush(),
// and downstream code in orchestrator.ts checks for socket.setNoDelay.

class CapturingResponse {
  public events: Array<{ event: string; data: any }> = []
  private buffer = ''

  write(chunk: string) {
    this.buffer += chunk
    while (true) {
      const sep = this.buffer.indexOf('\n\n')
      if (sep === -1) break
      const block = this.buffer.slice(0, sep)
      this.buffer = this.buffer.slice(sep + 2)
      const lines = block.split('\n')
      let event = 'message'
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data = line.slice(6).trim()
      }
      try {
        this.events.push({ event, data: JSON.parse(data) })
      } catch {
        this.events.push({ event, data })
      }
    }
  }

  end() { /* no-op */ }
  flush() { /* no-op */ }
  socket = { setNoDelay() { /* no-op */ } }
}

// ── Public result shape ─────────────────────────────────────────────────

export interface GraphQueryResult {
  plan:         QueryPlan | null
  retrieved:    RetrievalCandidate[]
  retrievedCount: number
  expandedAdded:  number
  expandedTotal:  number
  decisions:    OverrideDecision[]
  answer:       string
  citations:    Citation[]
  cite_index:   Record<string, number>
  ms:           number
  error:        string | null
}

export interface GraphQueryOptions {
  query:          string
  lgaFilter?:     string
  docTypeFilter?: 'lep' | 'sepp' | 'dcp'
  /** DeepInfra key (required). */
  apiKey:         string
  /** Gemini key (optional — used for the intent classifier). */
  geminiKey?:     string
}

/**
 * Run a graph query against nsw-kg v2 and collect the result in memory.
 *
 * Fires the full 5-stage pipeline (intent → retrieve → expand → hierarchy →
 * synthesize) and returns the final structured result. All SSE events are
 * captured locally — this function does NOT write to any real HTTP response
 * stream, so it's safe to call from inside a sitewise orchestrator that
 * owns its own outer stream.
 */
export async function runGraphQuery(opts: GraphQueryOptions): Promise<GraphQueryResult> {
  const t0 = Date.now()
  const captured = new CapturingResponse()

  try {
    await runQuery({
      query:         opts.query,
      lgaFilter:     opts.lgaFilter,
      docTypeFilter: opts.docTypeFilter,
      apiKey:        opts.apiKey,
      geminiKey:     opts.geminiKey,
      res:           captured,
    })
  } catch (err) {
    // runQuery has its own try/catch that emits an 'error' event then
    // swallows the throw in most cases. Be defensive anyway.
    return emptyResult(t0, (err as Error).message)
  }

  return parseEvents(captured.events, Date.now() - t0)
}

function emptyResult(t0: number, error: string | null = null): GraphQueryResult {
  return {
    plan: null,
    retrieved: [],
    retrievedCount: 0,
    expandedAdded: 0,
    expandedTotal: 0,
    decisions: [],
    answer: '',
    citations: [],
    cite_index: {},
    ms: Date.now() - t0,
    error,
  }
}

function parseEvents(events: Array<{ event: string; data: any }>, ms: number): GraphQueryResult {
  const result: GraphQueryResult = {
    plan: null,
    retrieved: [],
    retrievedCount: 0,
    expandedAdded: 0,
    expandedTotal: 0,
    decisions: [],
    answer: '',
    citations: [],
    cite_index: {},
    ms,
    error: null,
  }

  for (const evt of events) {
    switch (evt.event) {
      case 'plan':
        result.plan = evt.data as QueryPlan
        break
      case 'retrieved':
        result.retrievedCount = evt.data?.count ?? 0
        // Note: only the top-N slim view is in the event (not full candidates)
        if (Array.isArray(evt.data?.top)) result.retrieved = evt.data.top
        break
      case 'expanded':
        result.expandedAdded = evt.data?.added ?? 0
        result.expandedTotal = evt.data?.total ?? 0
        break
      case 'hierarchy_filter':
        if (Array.isArray(evt.data?.decisions)) result.decisions = evt.data.decisions
        break
      case 'answer_chunk':
        result.answer += evt.data?.text ?? ''
        break
      case 'citations':
        if (Array.isArray(evt.data?.citations)) result.citations = evt.data.citations
        if (evt.data?.cite_index) result.cite_index = evt.data.cite_index
        break
      case 'error':
        result.error = evt.data?.message ?? 'unknown error'
        break
    }
  }

  return result
}
