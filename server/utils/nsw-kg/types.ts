// ── NSW KG v2 — shared types ─────────────────────────────────────────────
//
// Mirrors the db/nsw-schema.sql tables. Used by the ingest pipeline,
// the API endpoints, and the page components.

// ── Document ────────────────────────────────────────────────────────────

export type DocType = 'lep' | 'sepp' | 'dcp'
export type Scope   = 'state' | 'local'

export interface NswDocument {
  id:                string
  title:             string
  doc_type:          DocType
  scope:             Scope
  hierarchy_level:   number
  lga_name:          string | null
  source_url:        string
  raw_path:          string | null
  md_path:           string | null
  as_at_date:        string                          // ISO date
  consolidation_id:  string | null
  ingest_model:      string
  ingest_provider:   string
  prop_count:        number
  edge_count:        number
  ingested_at:       string
}

// ── Section ─────────────────────────────────────────────────────────────

export type SectionLevel =
  | 'document' | 'chapter' | 'part' | 'division' | 'subdivision'
  | 'clause' | 'subclause' | 'paragraph' | 'schedule' | 'dictionary'
  | 'appendix' | 'page'

export interface NswSection {
  id:           string
  document_id:  string
  parent_id:    string | null
  local_id:     string
  level:        SectionLevel
  number:       string | null
  heading:      string | null
  raw_text:     string
  depth:        number
  sort_order:   number
  /** DCP hotlink metadata — the specific split-PDF that contains this
   *  section (e.g. 'sydney-dcp-2012-file7.pdf'). NULL for legislation
   *  and for legacy sections that predate the SRC marker convention. */
  source_file:  string | null
  /** 1-based page number within source_file (from PDF extraction).
   *  Used with source_file to build `/EPI/DCPs/{file}#page={page}`. */
  page:         number | null
}

// ── DCP block structure ─────────────────────────────────────────────────
//
// NSW DCPs follow a standard internal rubric: a numbered clause is divided
// into Objectives / Explanation / Controls / Note blocks, and only Controls
// is enforceable. Those blocks are unnumbered headings in the converted
// markdown (68% of headings in Randwick), so without classification they
// are indistinguishable from clauses.
//
// A `scope` block is an unnumbered heading inside a rubric that narrows it
// to a development type — e.g. clause 3.4.2 Controls carries separate
// blocks for "Residential flat buildings" and "Attached Dwellings".

export type BlockKind = 'part' | 'clause' | 'rubric' | 'scope'

export type Rubric =
  | 'objectives' | 'explanation' | 'controls'
  | 'note' | 'background' | 'requirements'

/** In-memory section tree node used by parsers in Stage 0 (no DB ids yet). */
export interface SectionTreeNode {
  local_id:    string
  level:       SectionLevel
  number:      string | null
  heading:     string | null
  raw_text:    string
  depth:       number
  sort_order:  number
  children:    SectionTreeNode[]
  /** DCP hotlink metadata — first `<!-- SRC: file | PAGE: N -->` marker
   *  observed inside this section's body by the structured-md parser. */
  source_file: string | null
  page:        number | null

  // ── DCP-only, set by the structured-md parser. Undefined for legislation
  // parsed from PCO XML, which has no rubric convention.
  /** What this heading is structurally. */
  block_kind?:  BlockKind
  /** Effective rubric, inherited down the subtree. `controls` marks the
   *  only blocks that carry binding obligations — the decomposer uses this
   *  to avoid extracting Objectives and Explanation as if they bound. */
  rubric?:      Rubric | null
  /** For scope blocks: the development type or sub-topic being narrowed to. */
  scope_label?: string | null
  /** Part code this section sits under, e.g. 'C1'. */
  part?:        string | null
}

// ── Proposition ─────────────────────────────────────────────────────────

export type PropositionType =
  | 'obligation' | 'prohibition' | 'permission'
  | 'condition'  | 'threshold'   | 'definition'
  | 'exception'  | 'requirement'

export type NumericComparator = 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between'
export type VerificationStatus = 'pending' | 'verified' | 'flagged'

/** Stage 1 LLM output for a single proposition (pre-DB). */
export interface AtomicProposition {
  type:               PropositionType
  subject:            string
  predicate:          string
  object:             string | null

  numeric_value:      number | null
  numeric_unit:       string | null
  numeric_comparator: NumericComparator | null
  numeric_upper:      number | null
  value_source:       string | null

  source_span:        string

  /** Raw clause refs detected in source_span (e.g. "clause 4.1", "Schedule 1"). */
  references:         RawReference[]

  /** Set on the rule proposition when it depends on a sibling condition proposition.
   *  At decomposition time this is the local index of the condition in the same
   *  Stage 1 batch (number), not yet a UUID. Resolved to UUID at insert time. */
  conditional_on_local: number | null

  /** Raw clause ref for an exception ("despite clause X") — resolved later. */
  exempts_ref:        string | null

  /** Confidence in [0,1] from extraction. */
  confidence:         number
}

export interface RawReference {
  type: 'clause' | 'subclause' | 'paragraph' | 'part' | 'division' | 'schedule' | 'dictionary' | 'act' | 'sepp' | 'unknown'
  ref:  string
}

/** A proposition row in the DB (post-insert). */
export interface NswProposition extends Omit<AtomicProposition, 'references' | 'conditional_on_local'> {
  id:                  string
  document_id:         string
  section_id:          string
  conditional_on:      string | null
  verification_status: VerificationStatus
  extraction_model:    string
  created_at:          string
}

// ── Edge ────────────────────────────────────────────────────────────────

export type EdgeType =
  | 'parent_of' | 'defines' | 'requires' | 'constrains' | 'resolves_to'

export type EdgeTargetKind = 'proposition' | 'section' | 'spatial_layer'
export type EdgeSource = 'structural' | 'regex' | 'llm' | 'aho_corasick'

export interface NswEdge {
  id:              string
  from_id:         string
  to_id:           string | null
  type:            EdgeType
  target_kind:     EdgeTargetKind
  target_ref:      string | null
  source:          EdgeSource
  confidence:      number
  cross_document:  boolean
}

// ── Question / review queue ─────────────────────────────────────────────

export type QuestionType =
  | 'missed_number' | 'unresolved_ref' | 'verifier_failed' | 'low_confidence'

export type QuestionStatus = 'open' | 'resolved' | 'wontfix'

export interface NswQuestion {
  id:              string
  document_id:     string
  section_id:      string | null
  proposition_id:  string | null
  type:            QuestionType
  detail:          string
  candidate:       any | null
  status:          QuestionStatus
  priority:        number
  created_at:      string
  resolved_at:     string | null
  resolution:      string | null
}

// ── Ingest run / progress events ────────────────────────────────────────

export type IngestStage =
  | 'fetch'   | 'parse'    | 'decompose' | 'verify'
  | 'resolve' | 'edges'    | 'embed'     | 'done'

export type RunStatus = 'running' | 'success' | 'failed'

export interface NswIngestRun {
  id:             string
  document_id:    string | null
  doc_label:      string
  status:         RunStatus
  started_at:     string
  finished_at:    string | null
  stage_metrics:  Record<string, any>
  totals:         Record<string, any>
  error:          string | null
}

/** SSE event emitted during pipeline execution. */
export type IngestEvent =
  | { type: 'stage_start';     stage: IngestStage; message?: string }
  | { type: 'stage_progress';  stage: IngestStage; current: number; total?: number; message?: string }
  | { type: 'stage_done';      stage: IngestStage; ms: number; counts?: Record<string, number> }
  | { type: 'flag';            stage: IngestStage; question_type: QuestionType; detail: string }
  | { type: 'error';           stage: IngestStage; message: string }
  | { type: 'run_done';        ms: number; totals: Record<string, number> }

// ── Document source descriptors (Stage 0 inputs) ────────────────────────

export interface DocumentSource {
  label:           string                              // 'albury-lep' | 'housing-sepp' | 'albury-dcp'
  title:           string
  doc_type:        DocType
  scope:           Scope
  hierarchy_level: number
  lga_name:        string | null
  source_url:      string                              // canonical URL even if reading from disk
  raw_path:        string                              // disk path to raw source
  // 'html' is accepted by the source registry and will be handled by the
  // HTML parser (A3). Until that lands the orchestrator throws on it.
  raw_format:      'xml' | 'structured-md' | 'html'
  as_at_date:      string                              // ISO
}
