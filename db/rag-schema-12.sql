-- RAG pilot - migration 12: answer keys for every plan, from sources independent of side D (rag.key).
--
--   kind 'lut'  the plan's Land Use Table read straight from the legislation XML (not nsw.lep_permissibility, which D's claims
--               are built from): a use literally listed in item 2 / 3 / 4 of the lot's zone, or prohibited by a closed zone's
--               catch-all when neither it nor any group term that includes it (the XML's own Dictionary) is listed
--   kind 'map'  the lot's zone, building height, floor space ratio and minimum lot size from the live NSW Planning Portal map
--               service (Planning_Portal_Principal_Planning), not our epi dump: tests D's spatial reading of the lot
-- Written by scripts/rag/06a-keys.py (stage 'keys'); scripts/rag/06-questions.ts turns them into keyed questions.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-12.sql

CREATE TABLE IF NOT EXISTS rag.key (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES rag.instrument(document_id),
  kind         text NOT NULL CHECK (kind IN ('lut', 'map')),
  cadid        text NOT NULL,
  subject      text NOT NULL,            -- lut: the use; map: zone / height / fsr / lot_size
  expected     jsonb NOT NULL,           -- { verdict } or { value, unit } or { verdict: 'maybe', parts }
  source       text NOT NULL,            -- where the answer comes from, as a reader could check it
  note         text,
  run_id       uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_key_doc ON rag.key (document_id, kind);
