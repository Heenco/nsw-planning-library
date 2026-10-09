-- RAG pilot - migration 05: what each claim's conditions are tested with, decided when the graph is built.
--
--   rag.claim_binding   one row per scope term, exclusion, mapped area or frame of a claim, with how it will be tested on
--                       a lot - or why it cannot be:
--     bound           a layer answers it (nsw.scope_layer -> its table / view / registry entry; or the map polygons the
--                     resolver put in nsw.rule_spatial_ref; or a lot / council fact)
--     no_data         nsw.scope_layer knows the term but holds no dataset for it (assume_absent says whether the
--                     registry takes it as absent)
--     no_match        no registered term matches the words
--     no_polygon      a mapped area with no polygon for that map and label
--     proposal_fact   a fact of the proposal, given with the question (a consent date, the title type, the pathway)
--     discretion      the consent authority's own judgement - never decided by data
--     unscoped        a frame whose words give no testable scope
--   Answers then report, per lot, which of these were checked and which could not be.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-05.sql

CREATE TABLE IF NOT EXISTS rag.claim_binding (
  id           bigserial PRIMARY KEY,
  claim_id     uuid NOT NULL REFERENCES rag.claim(id) ON DELETE CASCADE,
  part         text NOT NULL CHECK (part IN ('term', 'exclude', 'mapped', 'frame')),
  text         text NOT NULL,                       -- the words as the claim holds them
  status       text NOT NULL CHECK (status IN ('bound', 'no_data', 'no_match', 'no_polygon', 'proposal_fact', 'discretion', 'unscoped')),
  scope_terms  text[] NOT NULL DEFAULT '{}',        -- nsw.scope_layer terms (or 'lga:<name>' / 'lot' / 'map:<map>|<label>') that test it
  sources      text[] NOT NULL DEFAULT '{}',        -- the tables behind them
  assume_absent boolean NOT NULL DEFAULT false,
  note         text,
  run_id       uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_claim_binding_claim ON rag.claim_binding (claim_id);
CREATE INDEX IF NOT EXISTS rag_claim_binding_status ON rag.claim_binding (status);
