-- RAG pilot - migration 04: the rag engine's own claims, read from the instrument text (no pilot).
--
--   rag.claim   what a provision says, in a shape the evaluator can test against a lot and a proposal:
--     kind      permit | prohibit         a use is permitted (with or without consent) / prohibited
--               standard                  a figure: max/min of a topic (fsr, height, lot_size, floor_area, ...), from
--                                         the text, a table row, or a map ("shown for the land on the X Map")
--               condition                 a limitation on a permission: "consent must not be granted ... unless-"
--               frame                     where a unit (clause, Part, Chapter) applies: uses, zones, terms, the
--                                         sub-questions it depends on ("if a dwelling house is permissible ..."),
--                                         and exclusions ("the whole of the State, other than the following-")
--     scope     uses / zones / terms (a term the lot facts must answer) / requires (sub-questions) / band (a lot
--               size band) / excludes; unit_provision = the frame's unit, so claims inherit it
--     source    'text' (a reader over rag.provision) or 'lep_permissibility' (nsw.lep_permissibility, the resolved
--               Land Use Tables also behind /testing-spatial-services)
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-04.sql

CREATE TABLE IF NOT EXISTS rag.claim (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provision_id    uuid NOT NULL REFERENCES rag.provision(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('permit', 'prohibit', 'standard', 'condition', 'frame')),
  consent         text,                               -- permit: 'with' | 'without'
  uses            text[] NOT NULL DEFAULT '{}',       -- land use keys (shared/land-use-key.ts); empty = any
  zones           text[] NOT NULL DEFAULT '{}',       -- zone codes; empty = any
  terms           text[] NOT NULL DEFAULT '{}',       -- scope terms a lot fact must answer ('low and mid rise housing area')
  excludes        text[] NOT NULL DEFAULT '{}',       -- frame: land the unit does not apply to
  requires        jsonb  NOT NULL DEFAULT '[]',       -- sub-questions: [{"permissible": "dwelling house"}, {"standard": "fsr", "use": "dwelling house"}]
  topic           text,                               -- standard: fsr | height | lot_size | lot_width | floor_area | parking ...
  comparator      text,                               -- 'max' | 'min'
  value           numeric,
  unit            text,
  value_source    text,                               -- 'text' | 'table' | 'map:<Map name>'
  band            jsonb,                              -- {"metric": "lot_size", "lo": 550, "lo_incl": true, "hi": 600, "hi_incl": false}
  non_discretionary boolean NOT NULL DEFAULT false,
  unit_provision  uuid REFERENCES rag.provision(id) ON DELETE CASCADE,   -- the clause / Part / Chapter whose frame governs it
  source          text NOT NULL,
  span            text,
  reader          text NOT NULL,
  run_id          uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_claim_kind ON rag.claim (kind);
CREATE INDEX IF NOT EXISTS rag_claim_provision ON rag.claim (provision_id);
