-- Migration 17 — the SEPP rule pipeline (docs/sepp-rule-pipeline.md §3).
--
-- Additive only. Nothing existing changes meaning:
--   * every existing rule gets publish_state 'published', so every route that reads nsw.rule sees exactly
--     what it saw before; SEPP rules are written 'held' until their answer-key gate passes (decision D6);
--   * the new columns are nullable or defaulted.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-17-sepp-pipeline.sql

SET search_path TO nsw, public;

-- ── source currency: which instruments are newer on disk than in the graph ─────────────────────────
ALTER TABLE nsw.source_registry
  ADD COLUMN IF NOT EXISTS document_id           UUID REFERENCES nsw.document(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_ingested_sha256  TEXT,
  ADD COLUMN IF NOT EXISTS last_ingested_at      TIMESTAMPTZ;

COMMENT ON COLUMN nsw.source_registry.content_sha256 IS
  'sha256 of the file at raw_path when last registered (also the upload dedupe key).';
COMMENT ON COLUMN nsw.source_registry.last_ingested_sha256 IS
  'content_sha256 of the file the graph was last built from; differs from content_sha256 => re-run due.';

-- ── section change detection: re-extract only what changed ──────────────────────────────────────────
ALTER TABLE nsw.section
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

-- ── rules: publish gate, validity, SEPP roles ───────────────────────────────────────────────────────
ALTER TABLE nsw.rule
  ADD COLUMN IF NOT EXISTS publish_state TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS valid_from    DATE,
  ADD COLUMN IF NOT EXISTS valid_to      DATE,
  ADD COLUMN IF NOT EXISTS frame_rule_id UUID REFERENCES nsw.rule(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE nsw.rule ADD CONSTRAINT rule_publish_state_check
    CHECK (publish_state IN ('published', 'held', 'retired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN nsw.rule.publish_state IS
  'published: routes read it. held: written by a pipeline run whose gate has not passed. retired: superseded.';
COMMENT ON COLUMN nsw.rule.frame_rule_id IS
  'The frame (role frame) this rule inherits its reach from: where the chapter/part applies, its exclusions, pathway.';

-- ── widened vocabularies (supersets: every existing row still passes) ──────────────────────────────
-- kind 'frame': a chapter/part/division's reach (where it applies, exclusions, pathway, prevails).
ALTER TABLE nsw.rule DROP CONSTRAINT IF EXISTS rule_kind_check;
ALTER TABLE nsw.rule ADD CONSTRAINT rule_kind_check CHECK (kind = ANY (ARRAY[
  'standard', 'prohibition', 'permission', 'additional_use', 'exempt_development', 'consent_trigger',
  'disapplication', 'definition', 'matters', 'test', 'mandatory_consent', 'objective',
  'frame', 'condition']));

-- dimensions a SEPP scopes by that an LEP does not: a defined area ("low and mid rise housing area"),
-- a council list, who proposes it, a fact about the proposal, and the pathway (DA / CDC / exempt / Part 5).
ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_dimension_check;
ALTER TABLE nsw.rule_applicability ADD CONSTRAINT rule_applicability_dimension_check CHECK (dimension = ANY (ARRAY[
  'zone', 'land_use', 'dev_type', 'act', 'area_label', 'site_ref', 'lot_type', 'excluded_area',
  'size_band_lo', 'size_band_hi', 'temporal', 'map_area', 'dev_element', 'land_characteristic',
  'adjacency', 'tenure',
  'defined_area', 'lga', 'proponent', 'proposal_metric', 'pathway']));

-- 'relative_numeric': a control expressed against the local one ("maximum permissible FSR plus up to 30%").
ALTER TABLE nsw.rule_effect DROP CONSTRAINT IF EXISTS rule_effect_effect_type_check;
ALTER TABLE nsw.rule_effect ADD CONSTRAINT rule_effect_effect_type_check CHECK (effect_type = ANY (ARRAY[
  'numeric', 'permits_use', 'prohibits_use', 'requires_consent', 'exempt_from_consent', 'disapplies',
  'mandatory_consent', 'matter_for_consideration',
  'relative_numeric', 'nondiscretionary_numeric', 'condition_of_consent']));

CREATE INDEX IF NOT EXISTS rule_publish_state_idx ON nsw.rule (document_id, publish_state);
CREATE INDEX IF NOT EXISTS rule_frame_idx ON nsw.rule (frame_rule_id) WHERE frame_rule_id IS NOT NULL;
