-- RAG pilot - migration 02: topics, the unread list, terms, and cl 4.6.
--
--   rag.provision.topics   what a provision governs (fsr, height, lot_size, lot_width, permissibility, subdivision, ...),
--                          read from its heading and words - how the resolver finds two rules on the same matter
--   rag.unread             every override / applicability phrase a reader saw and did NOT turn into a relation. The rule
--                          learnt from s 169(2): a phrase is an edge or it is listed here - never silently skipped
--   kind 'term'            dictionary and "In this clause" definitions become provisions of their own (from the XML
--                          <defterm> markup), parented to the provision that scopes them
--   relation_kind may_vary cl 4.6: a development standard may be varied, except where 4.6 itself excludes it
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-02.sql

ALTER TABLE rag.provision ADD COLUMN IF NOT EXISTS topics text[];

CREATE TABLE IF NOT EXISTS rag.unread (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_id  uuid NOT NULL REFERENCES rag.provision(id) ON DELETE CASCADE,
  reader        text NOT NULL,
  trigger       text NOT NULL,                       -- the phrase that fired ('despite', 'applies only if', ...)
  span          text,
  note          text,
  run_id        uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_unread_provision ON rag.unread (provision_id);

INSERT INTO rag.relation_kind (kind, meaning, effect) VALUES
  ('may_vary', 'cl 4.6: the target development standard may be varied by a written request', 'the standard is not absolute - a breach is "needs a cl 4.6 variation", not "prohibited"')
ON CONFLICT (kind) DO NOTHING;
