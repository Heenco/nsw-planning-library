-- RAG pilot - migration 09: which clauses govern each map area, and what the build could not tie together.
--
--   rag.area_clause   one row per (map area, clause that governs it): from every bound map condition (rag.claim_binding),
--                     and - for a frame ("This clause applies to land identified as "Area 10" on the Additional Permitted
--                     Uses Map") - every rule under it (Sch 1 item 10(2): permits residential flat buildings). The
--                     structured answer to "what applies in this area", for the engine and for any reader of a lot.
--   rag.coverage      what the build could not tie together, per plan: a control area no clause reads, a clause whose
--                     area has no polygon, a Schedule 1 item with no permission read, a measure no reader took.
--   Both are rebuilt by scripts/rag/02d-bindings.ts.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-09.sql

CREATE TABLE IF NOT EXISTS rag.area_clause (
  id            bigserial PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES rag.instrument(document_id),
  map           text NOT NULL,           -- normalised map name, as rag.map_polygon has it ("additional permitted uses")
  label         text NOT NULL,           -- normalised label ("area 10")
  provision_id  uuid NOT NULL REFERENCES rag.provision(id) ON DELETE CASCADE,
  claim_id      uuid REFERENCES rag.claim(id) ON DELETE CASCADE,
  claim_kind    text NOT NULL,           -- frame / permit / prohibit / standard / condition
  role          text NOT NULL,           -- in words: "applies to", "permits residential flat building", "height max 20.5 m"
  via_frame     boolean NOT NULL DEFAULT false,   -- the rule is tied to the area through the frame above it
  distance_m    numeric,                 -- for "within N m of" conditions
  run_id        uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_area_clause_area ON rag.area_clause (document_id, map, label);

CREATE TABLE IF NOT EXISTS rag.coverage (
  id            bigserial PRIMARY KEY,
  document_id   uuid REFERENCES rag.instrument(document_id),
  check_kind    text NOT NULL CHECK (check_kind IN ('area_no_clause', 'clause_no_polygon', 'schedule_item_unread', 'figure_unread')),
  map           text,
  label         text,
  provision_id  uuid REFERENCES rag.provision(id) ON DELETE CASCADE,
  source        text,                    -- the layer the area came from, for area_no_clause
  note          text,
  run_id        uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_coverage_doc ON rag.coverage (document_id, check_kind);
