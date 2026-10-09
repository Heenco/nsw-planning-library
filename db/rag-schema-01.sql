-- RAG pilot - schema `rag` (planningai). Migration 01.
--
-- A second pilot beside `pilot` (the CDC session's deterministic propositions): a structure-aware, navigating RAG
-- over Randwick LEP 2012 plus the Housing SEPP parts that reach Randwick lots, built to be compared against the
-- deterministic engine question by question. Plan and live status: /rag (shared/rag-plan.ts).
--
-- Layers
--   TEXT       rag.instrument, rag.provision           frozen snapshot of the text (Randwick from pilot.node, the SEPP
--                                                      from nsw.section), one row per clause/subclause/paragraph/table/
--                                                      row/cell, with its stem role and connective
--   RELATIONS  rag.relation (+ rag.relation_kind)      typed edges between provisions - structure, cross-references,
--                                                      definitions and every override / prevail form - each with a scope,
--                                                      a basis (text | statute | structure | interpretive) and a status
--   INDEX      rag.chunk, rag.embedding                retrieval units with their deterministic header and (variant R2)
--                                                      a model-written context; embeddings per variant and model
--   EVAL       rag.question, rag.engine_answer,        the question bank, the deterministic side frozen per run, every
--              rag.answer, rag.adjudication            RAG answer with its checks and trace, and the human rulings
--   rag.run                                            one row per stage run, so every number on /rag has a provenance
--
-- Read-only on pilot.* and nsw.*. Nothing outside this schema is written.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-01.sql

CREATE SCHEMA IF NOT EXISTS rag;

CREATE TABLE IF NOT EXISTS rag.run (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage        text NOT NULL,                       -- 'snapshot' | 'relations' | 'index' | 'questions' | 'engine' | 'answer' | ...
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  config       jsonb,                               -- models, k, prompt hash, pilot run id, ...
  counts       jsonb,                               -- what the stage produced
  notes        text
);

CREATE TABLE IF NOT EXISTS rag.instrument (
  document_id  uuid PRIMARY KEY REFERENCES nsw.document(id),
  title        text NOT NULL,
  slug         text NOT NULL,
  kind         text NOT NULL,                       -- 'lep' | 'sepp'
  rank         int  NOT NULL,                       -- statutory fallback, higher prevails (EP&A Act s 3.28): dcp 10 / lep 20 / sepp 30, the CDC pilot's scale
  scope        text[],                              -- container local_ids in scope (chapters / parts / schedules); NULL = whole
  source_url   text,
  snapshot_run uuid REFERENCES rag.run(id)
);

CREATE TABLE IF NOT EXISTS rag.provision (
  id            uuid PRIMARY KEY,                   -- = pilot.node.id (Randwick) or nsw.section.id (SEPP)
  document_id   uuid NOT NULL REFERENCES rag.instrument(document_id),
  section_id    uuid,                               -- nsw.section the text came from (NULL for table/row/cell)
  pilot_node_id uuid,                               -- the pilot node it was copied from, if any
  parent_id     uuid REFERENCES rag.provision(id),
  local_id      text NOT NULL,                      -- the legislation anchor ('sec.4.1A-ssec.4-para1.a', '...#t1r2c4')
  kind          text NOT NULL,                      -- clause | subclause | paragraph | table | row | cell | definition | objective | note | part | ...
  heading       text,
  own_text      text,                               -- the provision's own words; a flattened table is cut off (it is its own node)
  list_role     text,                               -- a stem's role: condition | exception | value | applicability | use | matters | ...
  connective    text,                               -- a leaf's trailing 'and' / 'or'
  ordinal       int,
  path          text[],                             -- ancestor local_ids, outermost first
  container     text,                               -- nearest part / chapter / schedule local_id
  sort          int,
  content_sha   text,
  snapshot_run  uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_provision_doc_local ON rag.provision (document_id, local_id);
CREATE INDEX IF NOT EXISTS rag_provision_parent ON rag.provision (parent_id);

-- The relation vocabulary: a new kind is a row, not a migration.
CREATE TABLE IF NOT EXISTS rag.relation_kind (
  kind     text PRIMARY KEY,
  meaning  text NOT NULL,
  effect   text NOT NULL                             -- what the resolver does with it
);
INSERT INTO rag.relation_kind (kind, meaning, effect) VALUES
  ('part_of',              'structural parent',                                         'inherit scope and frames from the parent'),
  ('next',                 'next sibling in a list',                                    'none - reading order'),
  ('refers_to',            'names another provision',                                   'expand: the target is read with the source'),
  ('defines',              'defines a term the target uses',                            'expand: the definition is read with the target'),
  ('despite',              'applies notwithstanding the target',                        'source wins over target within scope'),
  ('subject_to',           'yields to the target',                                      'target wins over source within scope'),
  ('prevails_over',        'prevails to the extent of inconsistency',                   'source wins over target within scope'),
  ('disapplies',           'the target does not apply (in stated circumstances)',        'target removed within scope'),
  ('in_addition_to',       'does not displace the target',                              'both apply - no conflict'),
  ('applies_only_if',      'the source applies only if a condition holds',              'condition on the source; unknown = maybe'),
  ('displaces_standard',   'a non-discretionary standard caps a stricter one',          'EP&A Act s 4.15(3): the stricter one cannot be enforced against a compliant proposal'),
  ('modifies_measurement', 'changes how the target is measured',                        'apply before evaluating the target'),
  ('substitutes_value',    'swaps in a different figure for the target',                'source value replaces target value within scope'),
  ('more_specific_than',   'deals with the same matter more specifically',              'source wins over target (interpretive - shown, needs confirming)'),
  ('saves',                'transitional / savings provision for the target',           'the earlier law applies to the saved cases'),
  ('inconsistency_rule',   'instrument-level default for inconsistencies',              'tie-breaker after explicit relations')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS rag.relation (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL REFERENCES rag.relation_kind(kind),
  from_provision       uuid NOT NULL REFERENCES rag.provision(id),
  to_provision         uuid REFERENCES rag.provision(id),
  to_document          uuid,                         -- a whole instrument ("another environmental planning instrument" -> NULL + scope)
  to_ref               text,                         -- the target as written, when it does not resolve ("clause 4.1", "this Policy")
  scope                jsonb,                        -- where it bites: topic, land, use, pathway, subclause, condition ...
  basis                text NOT NULL CHECK (basis IN ('text', 'statute', 'structure', 'interpretive')),
  authority_provision  uuid REFERENCES rag.provision(id), -- the provision that says so (s 8, cl 1.9, the clause itself)
  span                 text,                         -- the words that state it
  reader               text NOT NULL,                -- which reader produced it
  status               text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'verified', 'rejected')),
  confidence           real,
  run_id               uuid REFERENCES rag.run(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rag_relation_from ON rag.relation (from_provision);
CREATE INDEX IF NOT EXISTS rag_relation_to ON rag.relation (to_provision);

CREATE TABLE IF NOT EXISTS rag.chunk (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_id  uuid NOT NULL REFERENCES rag.provision(id),
  role          text NOT NULL,                       -- leaf | stem | clause | table_row | table_whole | lut_zone | definition
  header        text NOT NULL,                       -- deterministic: instrument > part > clause > stem path with roles
  body          text NOT NULL,
  llm_context   text,                                -- variant R2: model-written placement (Anthropic contextual retrieval)
  tsv           tsvector,
  tokens        int,
  content_sha   text,
  run_id        uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_chunk_tsv ON rag.chunk USING gin (tsv);

CREATE TABLE IF NOT EXISTS rag.embedding (
  chunk_id  uuid NOT NULL REFERENCES rag.chunk(id) ON DELETE CASCADE,
  variant   text NOT NULL,                           -- 'plain' | 'structural' | 'contextual'
  model     text NOT NULL,
  vec       vector(4096) NOT NULL,                   -- a few thousand rows: exact search, no ANN index needed
  PRIMARY KEY (chunk_id, variant, model)
);

CREATE TABLE IF NOT EXISTS rag.question (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_name    text NOT NULL,                         -- 'pilot_key' | 'engine_key' | 'grid' | 'hard_case' | 'propcode'
  document_id uuid,
  cadid       text,
  clause      text,
  kind        text NOT NULL,                         -- extraction | permissibility | standard | subdivision | precedence
  use_term    text,
  text        text NOT NULL,
  expected    jsonb,                                 -- the key: verdict / value / controlling clause / trace
  key_ref     uuid,                                  -- pilot.key.id when it came from there
  lot_facts   jsonb,                                 -- frozen facts given to both sides
  tags        text[],
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag.engine_answer (
  question_id uuid NOT NULL REFERENCES rag.question(id),
  run_id      uuid NOT NULL REFERENCES rag.run(id),
  pilot_run   uuid,                                  -- the pilot generation the engine read
  verdict     text,
  controlling text[],
  payload     jsonb,
  PRIMARY KEY (question_id, run_id)
);

CREATE TABLE IF NOT EXISTS rag.answer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES rag.run(id),
  question_id uuid NOT NULL REFERENCES rag.question(id),
  variant     text NOT NULL,                         -- R0 .. R4, L0
  model       text NOT NULL,
  retrieved   jsonb,                                 -- chunks and expansions, with why each was added
  answer      jsonb,                                 -- verdict, controlling clause, numbers, unknowns, citations + spans
  checks      jsonb,                                 -- citation exists / span verbatim / number in cited clause / not displaced
  trace       jsonb,                                 -- resolver trace when the variant used it
  latency_ms  int,
  tokens_in   int,
  tokens_out  int,
  cost_usd    numeric
);

CREATE TABLE IF NOT EXISTS rag.adjudication (
  question_id       uuid PRIMARY KEY REFERENCES rag.question(id),
  proposed          jsonb,                           -- drafted ruling
  quote             text,
  source_provision  uuid REFERENCES rag.provision(id),
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'corrected')),
  decided_at        timestamptz,
  note              text
);

COMMENT ON SCHEMA rag IS 'RAG pilot: structure-aware navigating RAG over Randwick LEP 2012 + Housing SEPP parts, compared with the deterministic pilot. Plan: shared/rag-plan.ts, page /rag.';
