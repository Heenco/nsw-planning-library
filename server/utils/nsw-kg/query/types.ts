// ── Query agent types ───────────────────────────────────────────────────

import type { PropositionType } from '../types'

// ── Stage A — intent + entities ─────────────────────────────────────────

export type QueryIntent =
  | 'permissibility'   // "can I build X in Y?"
  | 'thresholds'       // "what is the max FSR / height / setback?"
  | 'definition'       // "what does dwelling house mean?"
  | 'cross_doc'        // explicitly compares LEP / SEPP / DCP
  | 'general'          // catch-all

export interface QueryEntities {
  zone?:        string             // 'R2', 'R1', 'E2', etc
  land_use?:    string             // 'dwelling house', 'dual occupancy'
  lga?:         string             // 'Albury'
  doc_type?:    'lep' | 'sepp' | 'dcp'
  topic?:       string             // 'flood', 'heritage', 'parking'
  property_id?: string
}

export interface QueryPlan {
  intent:    QueryIntent
  entities:  QueryEntities
  keywords:  string[]
  /** Whether the synthesizer should explicitly note overrides if it sees them */
  surface_overrides: boolean
}

// ── Stage B — retrieval candidates ──────────────────────────────────────

export interface RetrievalCandidate {
  id:                string
  document_id:       string
  document_title:    string
  document_doc_type: 'lep' | 'sepp' | 'dcp'
  document_lga:      string | null
  document_hierarchy_level: number
  document_source_url: string | null
  section_id:        string
  section_local_id:  string
  section_number:    string | null
  section_heading:   string | null
  /** DCP split-PDF filename (e.g. 'sydney-dcp-2012-file7.pdf'). NULL for
   *  legislation and for legacy DCP sections with no hotlink metadata. */
  section_source_file: string | null
  /** 1-based page within section_source_file. */
  section_page:        number | null
  type:              PropositionType
  subject:           string
  predicate:         string
  object:            string | null
  numeric_value:     number | null
  numeric_unit:      string | null
  numeric_comparator: string | null
  value_source:      string | null
  source_span:       string
  conditional_on:    string | null

  // Ranking metadata
  vector_rank:       number | null  // 1-based rank from vector search, null if not in vector top-K
  bm25_rank:         number | null  // 1-based rank from BM25 search
  vector_distance:   number | null  // cosine distance (0 = identical)
  bm25_score:        number | null  // ts_rank_cd value
  rrf_score:         number          // combined Reciprocal Rank Fusion
  source:            'retrieved' | 'expanded'  // how it got into the candidate set
  expanded_via:      string | null   // edge type that brought it in (if expanded)
}

// ── Stage C — expanded context ──────────────────────────────────────────

export interface ExpandedContext {
  retrieved:    RetrievalCandidate[]    // direct hits from RRF
  expanded:     RetrievalCandidate[]    // pulled in via graph edges
  total:        number
  by_doc_type:  Record<string, number>
}

// ── Stage D — hierarchy decisions ───────────────────────────────────────

export interface OverrideDecision {
  winner_id:      string
  winner_subject: string
  winner_doc:     string
  winner_level:   number
  loser_id:       string
  loser_subject:  string
  loser_doc:      string
  loser_level:    number
  reason:         'hierarchy'
}

export interface FilteredContext {
  kept:       RetrievalCandidate[]
  dropped:    RetrievalCandidate[]
  decisions:  OverrideDecision[]
}

// ── Stage E — citations + answer ─────────────────────────────────────────

export interface Citation {
  proposition_id:   string
  section_local_id: string
  section_number:   string | null
  section_heading:  string | null
  document_label:   string                // 'LEP' | 'SEPP' | 'DCP' (compact category)
  document_title:   string
  source_url:       string | null         // base document URL
  clause_url:       string | null         // base + #fragment for LEP/SEPP, null for DCP

  // ── Display fields (added for numbered footnotes UI) ──
  /** 1-based index in order of first appearance in the answer. */
  number:           number
  /** NSW legal-style citation, e.g. 'cl 4.3(2)' or 'Sch 4A cl 15(1)'. */
  citation_label:   string
  /** Short document label, e.g. 'Albury LEP', 'Housing SEPP'. */
  document_short:   string
  /** Document type for color coding ('lep' | 'sepp' | 'dcp'). */
  doc_type:         'lep' | 'sepp' | 'dcp'
  /** First sentence of the source span, for the Sources card preview. */
  source_quote:     string
}

// ── SSE event union ─────────────────────────────────────────────────────

export type AgentStepStatus = 'running' | 'done' | 'warn' | 'skip'

export type QueryEvent =
  | { type: 'agent_step'; payload: { agent: string; status: AgentStepStatus; message: string; detail?: string; ms?: number } }
  | { type: 'plan'; payload: QueryPlan }
  | { type: 'retrieved'; payload: { count: number; top: Array<Pick<RetrievalCandidate, 'id' | 'subject' | 'type' | 'document_title' | 'section_local_id' | 'rrf_score'>> } }
  | { type: 'expanded'; payload: { added: number; total: number } }
  | { type: 'hierarchy_filter'; payload: { kept: number; dropped: number; decisions: OverrideDecision[] } }
  | { type: 'context_summary'; payload: { propositions_in_context: number; tokens_estimate: number } }
  | { type: 'answer_chunk'; payload: { text: string } }
  | { type: 'citations'; payload: { citations: Citation[]; cite_index: Record<string, number> } }
  | { type: 'done'; payload: { ms: number } }
  | { type: 'error'; payload: { message: string } }
