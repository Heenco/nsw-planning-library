-- Migration 25 — norms: clauses with all their conditions, the rule shape the norms engine evaluates
-- (docs/norms-trial.md, shared/norms/schema.ts).
--
-- nsw.rule rows drop a condition the extractor cannot type, and a dropped condition reads as met: Housing SEPP s 51
-- ("the subdivision of a lot on which development has been carried out under this Part") became "no subdivision".
-- A norm keeps every condition - typed by who can answer it (lot data / the asker / the council), or kept quoted as
-- `unparsed`, which makes the answer undecided and can never be dropped.
--
--   nsw.norm            one row per norm: the condition tree (`when`, jsonb - all / any / not over typed leaves, each
--                       with its literal `span`), the effect (`then`: permit / prohibit / require), what it beats
--                       (`despite`, `subject_to`), who wrote and reviewed it, and the build gate's findings. Versioned:
--                       a norm no longer produced is retired (valid_to set), never deleted.
--   nsw.norm_unchecked  the clauses of a family (subdivision, ...) not yet encoded, with the zones their own
--                       "This clause applies to ..." sentence names - so an answer can say what it has not read.
--
-- Loaded by scripts/norms/load.ts after the gate; read by /api/norms/subdivision. Additive: nothing else changes.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-25-norms.sql

CREATE TABLE IF NOT EXISTS nsw.norm (
  row_id        bigserial PRIMARY KEY,                  -- one row per version
  id            text NOT NULL,                          -- '<instrument slug>:<clause>', e.g. 'housing-sepp-2021:51'
  family        text NOT NULL,                          -- 'subdivision' (more families later: 'use', 'works' ...)
  document_id   uuid NOT NULL REFERENCES nsw.document(id),
  section_id    uuid REFERENCES nsw.section(id),        -- the section the norm's words are in
  section       text NOT NULL,                          -- its local_id ('sec.4.1-ssec.3') - also the legislation anchor
  clause        text NOT NULL,                          -- '4.1(3)'
  "when"        jsonb NOT NULL,                         -- the condition tree
  "then"        jsonb NOT NULL,                         -- {"permit": ...} | {"prohibit": true} | {"require": {...}}
  despite       text[] NOT NULL DEFAULT '{}',           -- norm ids, 'instrument:*', 'doc_type:lep'
  subject_to    text[] NOT NULL DEFAULT '{}',
  author        jsonb NOT NULL,                         -- {"by": ..., "at": ..., "reviewed": ...}
  review        text,                                   -- a reviewer's reading kept with the norm
  gate          jsonb,                                  -- the build gate's findings (empty when clean)
  content_sha256 text NOT NULL,                         -- of when/then/despite/subject_to: a change is a new version
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,                            -- set when the norm is no longer produced
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- one current version per norm; older versions keep valid_to
CREATE UNIQUE INDEX IF NOT EXISTS norm_current_idx ON nsw.norm (id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS norm_family_doc_idx ON nsw.norm (family, document_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS nsw.norm_unchecked (
  family        text NOT NULL,
  document_id   uuid NOT NULL REFERENCES nsw.document(id),
  section       text NOT NULL,                          -- 'sec.6.19'
  clause        text NOT NULL,                          -- '6.19'
  why           text,                                   -- the clause heading, or why it is not encoded
  zones         text[],                                 -- the zones its own scope sentence names; NULL = scope not read
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family, document_id, section)
);

COMMENT ON TABLE nsw.norm IS 'Clauses with all their conditions (fail closed) - evaluated by shared/norms/engine.ts. Migration 25.';
COMMENT ON TABLE nsw.norm_unchecked IS 'Clauses of a norm family not yet encoded, with their own zone scope. Migration 25.';
