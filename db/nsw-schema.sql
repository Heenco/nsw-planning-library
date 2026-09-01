-- ════════════════════════════════════════════════════════════════════════
-- NSW KG v2 schema
-- ════════════════════════════════════════════════════════════════════════
--
-- Lives in the `nsw` schema (sibling of the existing `public` schema).
-- v2 of the NSW planning knowledge graph; will eventually replace v1.
--
-- Apply with:  node scripts/apply-nsw-schema.mjs
--   or:        psql $KG_PG_URL -f db/nsw-schema.sql
--
-- Idempotent: re-running drops and recreates everything in `nsw`.
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS nsw;
SET search_path TO nsw, public;

-- Drop in dependency order (safe to re-run)
DROP TABLE IF EXISTS nsw.ingest_run     CASCADE;
DROP TABLE IF EXISTS nsw.question       CASCADE;
DROP TABLE IF EXISTS nsw.priority       CASCADE;
DROP TABLE IF EXISTS nsw.edge           CASCADE;
DROP TABLE IF EXISTS nsw.proposition    CASCADE;
DROP TABLE IF EXISTS nsw.section        CASCADE;
DROP TABLE IF EXISTS nsw.document       CASCADE;

-- ── nsw.document ────────────────────────────────────────────────────────
CREATE TABLE nsw.document (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT         NOT NULL,
  doc_type          TEXT         NOT NULL CHECK (doc_type IN ('lep', 'sepp', 'dcp')),
  scope             TEXT         NOT NULL CHECK (scope IN ('state', 'local')),
  hierarchy_level   SMALLINT     NOT NULL CHECK (hierarchy_level BETWEEN 1 AND 5),
  lga_name          TEXT,                              -- nullable for state docs
  source_url        TEXT         NOT NULL,
  raw_path          TEXT,                              -- on-disk path to raw source (xml/md)
  md_path           TEXT,                              -- on-disk path to cleaned markdown sidecar
  as_at_date        DATE         NOT NULL,             -- legal currency / consolidation date
  consolidation_id  TEXT,                              -- optional legislation.nsw.gov.au consolidation hash
  ingest_model      TEXT         NOT NULL,
  ingest_provider   TEXT         NOT NULL,
  prop_count        INTEGER      NOT NULL DEFAULT 0,
  edge_count        INTEGER      NOT NULL DEFAULT 0,
  ingested_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX nsw_document_doc_type_idx ON nsw.document(doc_type);
CREATE INDEX nsw_document_lga_idx      ON nsw.document(lga_name);

-- ── nsw.section ─────────────────────────────────────────────────────────
CREATE TABLE nsw.section (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID         NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  parent_id     UUID         REFERENCES nsw.section(id) ON DELETE CASCADE,
  local_id      TEXT         NOT NULL,                  -- e.g. 'pt.4', 'sec.4.3', 'sec.4.3-subs.2'
  level         TEXT         NOT NULL CHECK (level IN (
                  'document', 'chapter', 'part', 'division', 'subdivision',
                  'clause', 'subclause', 'paragraph', 'schedule', 'dictionary',
                  'appendix', 'page'
                )),
  number        TEXT,                                   -- '4.3', '(2)', '1', etc.
  heading       TEXT,
  raw_text      TEXT         NOT NULL DEFAULT '',
  depth         INTEGER      NOT NULL,
  sort_order    INTEGER      NOT NULL,
  -- DCP hotlink metadata. Populated by the structured-md parser from
  -- `<!-- SRC: file.pdf | PAGE: N -->` markers emitted by dcp-pdf-to-md.
  -- For multi-file DCPs (e.g. Sydney split into 80 PDFs), source_file is
  -- the specific file name so citations can resolve to
  -- `/EPI/DCPs/{source_file}#page={page}`. NULL for legislation (LEP/SEPP),
  -- which uses document.source_url + section.local_id as the clause URL.
  source_file   TEXT,
  page          INTEGER,
  UNIQUE (document_id, local_id)
);

CREATE INDEX nsw_section_doc_idx     ON nsw.section(document_id);
CREATE INDEX nsw_section_parent_idx  ON nsw.section(parent_id);
CREATE INDEX nsw_section_doc_sort    ON nsw.section(document_id, sort_order);

-- ── nsw.proposition ─────────────────────────────────────────────────────
CREATE TABLE nsw.proposition (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID         NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  section_id            UUID         NOT NULL REFERENCES nsw.section(id) ON DELETE CASCADE,

  type                  TEXT         NOT NULL CHECK (type IN (
                          'obligation', 'prohibition', 'permission',
                          'condition', 'threshold', 'definition',
                          'exception', 'requirement'
                        )),

  subject               TEXT         NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
  predicate             TEXT         NOT NULL CHECK (length(predicate) BETWEEN 1 AND 200),
  object                TEXT,

  -- Numeric fields (broken-out columns, not JSONB).
  -- Either both numeric_value AND unit/comparator are populated (literal threshold),
  -- OR value_source is populated (deferred to a map / external data source).
  -- Never both, never neither, when type='threshold'.
  numeric_value         NUMERIC,
  numeric_unit          TEXT,
  numeric_comparator    TEXT         CHECK (numeric_comparator IN ('eq','lt','lte','gt','gte','between')),
  numeric_upper         NUMERIC,                       -- for 'between'
  value_source          TEXT,                          -- e.g. 'map:Height_of_Buildings_Map'

  -- Mandatory source anchor — verifier checks this is a literal substring of section.raw_text
  source_span           TEXT         NOT NULL CHECK (length(source_span) >= 1),
  source_offset         INTEGER,

  -- Edge-relevant fields populated by Stage 1, consumed by Stage 4
  conditional_on        UUID         REFERENCES nsw.proposition(id) ON DELETE SET NULL,
  exempts_ref           TEXT,                          -- raw clause ref pre-resolution

  confidence            NUMERIC      NOT NULL DEFAULT 0.5
                                     CHECK (confidence >= 0 AND confidence <= 1),
  verification_status   TEXT         NOT NULL DEFAULT 'pending'
                                     CHECK (verification_status IN ('pending','verified','flagged')),
  extraction_model      TEXT         NOT NULL,

  embedding             vector(4096),
  search_vector         tsvector,

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Threshold contract: if type='threshold', exactly one of (numeric_value, value_source) must be set.
  CONSTRAINT threshold_value_or_source CHECK (
    type <> 'threshold' OR (
      (numeric_value IS NOT NULL AND value_source IS NULL) OR
      (numeric_value IS NULL     AND value_source IS NOT NULL)
    )
  ),
  -- If numeric_value is set, unit and comparator must also be set
  CONSTRAINT numeric_complete CHECK (
    numeric_value IS NULL OR (numeric_unit IS NOT NULL AND numeric_comparator IS NOT NULL)
  ),
  -- 'between' requires upper
  CONSTRAINT between_has_upper CHECK (
    numeric_comparator <> 'between' OR numeric_upper IS NOT NULL
  )
);

CREATE INDEX nsw_proposition_doc_idx        ON nsw.proposition(document_id);
CREATE INDEX nsw_proposition_section_idx    ON nsw.proposition(section_id);
CREATE INDEX nsw_proposition_type_idx       ON nsw.proposition(type);
CREATE INDEX nsw_proposition_status_idx     ON nsw.proposition(verification_status);
CREATE INDEX nsw_proposition_subject_trgm   ON nsw.proposition USING gin(subject gin_trgm_ops);
CREATE INDEX nsw_proposition_search_idx     ON nsw.proposition USING gin(search_vector);
-- HNSW index on embedding deferred until Stage 5 has populated rows.

-- ── nsw.edge ────────────────────────────────────────────────────────────
-- Five edge types only: parent_of, defines, requires, constrains, resolves_to.
-- 'overrides' / 'contradicts' do NOT live here.
CREATE TABLE nsw.edge (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id         UUID         NOT NULL REFERENCES nsw.proposition(id) ON DELETE CASCADE,
  to_id           UUID         REFERENCES nsw.proposition(id) ON DELETE CASCADE,
                                                      -- nullable: target may be a section or
                                                      -- spatial layer (target_kind != 'proposition')
  type            TEXT         NOT NULL CHECK (type IN (
                    'parent_of', 'defines', 'requires', 'constrains', 'resolves_to'
                  )),
  target_kind     TEXT         NOT NULL DEFAULT 'proposition'
                               CHECK (target_kind IN ('proposition','section','spatial_layer')),
  target_ref      TEXT,                                -- external ref string when target_kind <> 'proposition'
  source          TEXT         NOT NULL CHECK (source IN (
                    'structural', 'regex', 'llm', 'aho_corasick'
                  )),
  confidence      NUMERIC      NOT NULL DEFAULT 1.0
                               CHECK (confidence >= 0 AND confidence <= 1),
  cross_document  BOOLEAN      NOT NULL DEFAULT false,
  CONSTRAINT no_self_loop CHECK (from_id <> to_id OR to_id IS NULL),
  CONSTRAINT proposition_target_has_to_id CHECK (
    target_kind <> 'proposition' OR to_id IS NOT NULL
  )
);

CREATE INDEX nsw_edge_from_idx ON nsw.edge(from_id);
CREATE INDEX nsw_edge_to_idx   ON nsw.edge(to_id);
CREATE INDEX nsw_edge_type_idx ON nsw.edge(type);

-- ── nsw.priority ────────────────────────────────────────────────────────
-- Reserved for the override-resolution refactor. Empty in v1.
CREATE TABLE nsw.priority (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  winning_id      UUID         NOT NULL REFERENCES nsw.proposition(id) ON DELETE CASCADE,
  losing_id       UUID         NOT NULL REFERENCES nsw.proposition(id) ON DELETE CASCADE,
  reason          TEXT         NOT NULL CHECK (reason IN ('hierarchy','temporal','specialis','manual')),
  source          TEXT         NOT NULL,
  confidence      NUMERIC      NOT NULL DEFAULT 1.0,
  CONSTRAINT priority_no_self CHECK (winning_id <> losing_id)
);

-- ── nsw.question ────────────────────────────────────────────────────────
-- Human-review queue. Populated by the verifier when retries fail.
CREATE TABLE nsw.question (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID         NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  section_id      UUID         REFERENCES nsw.section(id) ON DELETE SET NULL,
  proposition_id  UUID         REFERENCES nsw.proposition(id) ON DELETE SET NULL,
  type            TEXT         NOT NULL CHECK (type IN (
                    'missed_number', 'unresolved_ref', 'verifier_failed', 'low_confidence'
                  )),
  detail          TEXT         NOT NULL,
  candidate       JSONB,                              -- the missed number, the unresolved ref, etc.
  status          TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','wontfix')),
  priority        SMALLINT     NOT NULL DEFAULT 5,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT
);

CREATE INDEX nsw_question_doc_idx    ON nsw.question(document_id);
CREATE INDEX nsw_question_status_idx ON nsw.question(status);
CREATE INDEX nsw_question_type_idx   ON nsw.question(type);

-- ── nsw.ingest_run ──────────────────────────────────────────────────────
-- Audit + live progress for ingest pipelines.
CREATE TABLE nsw.ingest_run (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID         REFERENCES nsw.document(id) ON DELETE SET NULL,
  doc_label       TEXT         NOT NULL,               -- e.g. 'albury-lep' (so we can identify pre-document runs)
  status          TEXT         NOT NULL CHECK (status IN ('running','success','failed')),
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  stage_metrics   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  totals          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  error           TEXT
);

CREATE INDEX nsw_ingest_run_status_idx ON nsw.ingest_run(status);
CREATE INDEX nsw_ingest_run_doc_idx    ON nsw.ingest_run(document_id);
