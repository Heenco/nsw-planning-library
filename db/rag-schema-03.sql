-- RAG pilot - migration 03: a frozen copy of the CDC pilot's development standards.
--
--   rag.pilot_standard   the pilot's Randwick standards (modality require, with a value or a map) as 02-relations last
--                        read them. pilot.proposition is rebuilt in place by the CDC session, and between its stages a
--                        document has no propositions at all - a relations run that read it then would silently lose
--                        every displaces_standard, may_vary and more_specific_than edge. 02-relations refreshes this
--                        copy whenever the pilot has rows, falls back to it when the pilot has none, and refuses to
--                        write when both are empty. Keyed on the legislation anchor (local_id): pilot node ids are
--                        re-minted on every rebuild.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-03.sql

CREATE TABLE IF NOT EXISTS rag.pilot_standard (
  id            bigserial PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES rag.instrument(document_id) ON DELETE CASCADE,
  local_id      text NOT NULL,                      -- the provision's legislation anchor, e.g. sec.4.4A-ssec.2#t1r3c4
  topic         text NOT NULL,                      -- the pilot's topic, unmapped
  comparator    text,
  value         numeric,
  unit          text,
  uses          text[] NOT NULL DEFAULT '{}',       -- pilot.scope land_use
  zones         text[] NOT NULL DEFAULT '{}',       -- pilot.scope zone
  pilot_run     uuid,                               -- pilot.proposition.run_id it came from
  frozen_run    uuid REFERENCES rag.run(id),        -- the relations run that copied it
  frozen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rag_pilot_standard_doc ON rag.pilot_standard (document_id, local_id);
