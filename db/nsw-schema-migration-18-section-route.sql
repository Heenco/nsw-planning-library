-- Migration 18 — section routing for the rule pipeline (docs/sepp-rule-pipeline.md, step 4).
--
-- Additive only. route: what extraction does with the section. signals: clause-wording patterns from the
-- instrument profile found in its text (permission, override, prohibition, ...). Written by
-- scripts/pipeline/route.ts; NULL on any section no run has routed.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-18-section-route.sql

SET search_path TO nsw, public;

ALTER TABLE nsw.section
  ADD COLUMN IF NOT EXISTS route     TEXT,
  ADD COLUMN IF NOT EXISTS signals   TEXT[],
  ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE nsw.section ADD CONSTRAINT section_route_check CHECK (route IS NULL OR route IN
    ('operative', 'definition', 'objective', 'savings', 'schedule', 'structural', 'empty', 'oversize'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS section_route_idx ON nsw.section (document_id, route);
