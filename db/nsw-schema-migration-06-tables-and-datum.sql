-- ═══════════════════════════════════════════════════════════════════════
-- Migration 06 — control tables, and the measurement datum
-- ═══════════════════════════════════════════════════════════════════════
--
-- Why this exists. A DCP does not put its numbers in prose; it puts them in
-- a table and points at it ("the minimum setback … should comply with Table
-- 3.1.2-a"). The number alone is meaningless — Hornsby's Table 3.1.2-a says
-- 0.9 m and 1.5 m in the same cell, and which one applies depends on the
-- storey count, while WHICH BOUNDARY it is measured from is the row header.
--
-- Before this migration the ingest read those tables, took a number out and
-- threw the table away: `section.raw_text` is prose only, so 6m, 9m, 0.9m,
-- 1.5m, 7.6m and 8m existed nowhere in the database. The row header survived
-- only as a substring of `rule_effect.source_span`, which nothing can join on.
--
-- Three changes:
--   1. nsw.section_table / nsw.section_table_cell — the table kept as a
--      relation, so the row header is a column and not a substring.
--   2. nsw.rule_effect.measured_from — the datum. "6 m" is not a rule;
--      "6 m from the front boundary" is.
--   3. nsw.rule_effect.condition_* — the band that selects between values in
--      one cell ("up to 1 storey = 0.9m, 2 storey element = 1.5m") and in one
--      column header ("Lots < 4,000m²"). Per effect, not per rule, because a
--      single clause carries several bands at once.
--
--   node scripts/apply-migration.mjs nsw-schema-migration-06-tables-and-datum.sql --dry-run
--   node scripts/apply-migration.mjs nsw-schema-migration-06-tables-and-datum.sql

BEGIN;

SET LOCAL search_path TO nsw, public;

-- ── section_table ──────────────────────────────────────────────────────
-- One row per <table> in the converted HTML, attached to the section that
-- contains it. `table_no` is the label the prose cites, so a control saying
-- "comply with Table 3.1.2-a" can be resolved to its values.

CREATE TABLE IF NOT EXISTS nsw.section_table (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  section_id  UUID          REFERENCES nsw.section(id)  ON DELETE CASCADE,
  seq         INTEGER NOT NULL,             -- order within the section
  table_no    TEXT,                         -- 'Table 3.1.2-a', off the caption
  caption     TEXT,
  headers     TEXT[] NOT NULL DEFAULT '{}',
  n_rows      INTEGER NOT NULL DEFAULT 0,
  n_cols      INTEGER NOT NULL DEFAULT 0,
  page        INTEGER,
  UNIQUE (document_id, section_id, seq)
);

CREATE INDEX IF NOT EXISTS section_table_document_idx ON nsw.section_table(document_id);
CREATE INDEX IF NOT EXISTS section_table_no_idx       ON nsw.section_table(document_id, table_no);

-- ── section_table_cell ─────────────────────────────────────────────────
-- Every cell, with the headers that give it meaning. row_header is column 0
-- of the cell's own row: in a setback table that is the boundary, which is
-- the whole datum. Kept even when a cell has no number, because a cell can
-- carry a deferral ("see Clause 6.1 of HLEP") that is itself the rule.

CREATE TABLE IF NOT EXISTS nsw.section_table_cell (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   UUID NOT NULL REFERENCES nsw.section_table(id) ON DELETE CASCADE,
  row_idx    INTEGER NOT NULL,
  col_idx    INTEGER NOT NULL,
  row_header TEXT,
  col_header TEXT,
  text       TEXT NOT NULL,
  UNIQUE (table_id, row_idx, col_idx)
);

CREATE INDEX IF NOT EXISTS section_table_cell_table_idx ON nsw.section_table_cell(table_id);
CREATE INDEX IF NOT EXISTS section_table_cell_row_idx
  ON nsw.section_table_cell(row_header) WHERE row_header IS NOT NULL;

-- ── rule_effect: the datum ─────────────────────────────────────────────
-- `relative_to` already carried the vertical datum ('existing ground
-- level'). `measured_from` is the horizontal one, and without it a setback
-- effect is not a rule anyone can apply.
--
-- The vocabulary is closed on purpose. The ingest maps row headers through a
-- fixed table and writes NULL when it does not recognise one, so a new
-- phrasing shows up as a NULL to be triaged rather than as a plausible-
-- looking wrong answer.

ALTER TABLE nsw.rule_effect
  ADD COLUMN IF NOT EXISTS measured_from TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_effect_measured_from_ck') THEN
    ALTER TABLE nsw.rule_effect ADD CONSTRAINT rule_effect_measured_from_ck
      CHECK (measured_from IS NULL OR measured_from IN (
        'front_boundary','secondary_boundary','side_boundary','rear_boundary',
        'waterfront_boundary','road_boundary','property_boundary',
        'adjoining_building','other_building','watercourse','site_feature'
      ));
  END IF;
END $$;

-- ── rule_effect: the band that selects the value ───────────────────────
-- "Up to 1 storey = 0.9m / 2 storey element = 1.5m" is two effects on one
-- rule, separated by a condition. Likewise the column header "Lots <
-- 4,000m²". Lower bound inclusive, upper bound exclusive.

ALTER TABLE nsw.rule_effect
  ADD COLUMN IF NOT EXISTS condition_metric TEXT,
  ADD COLUMN IF NOT EXISTS condition_lo     NUMERIC,
  ADD COLUMN IF NOT EXISTS condition_hi     NUMERIC,
  ADD COLUMN IF NOT EXISTS condition_unit   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_effect_condition_ck') THEN
    ALTER TABLE nsw.rule_effect ADD CONSTRAINT rule_effect_condition_ck
      CHECK (
        condition_metric IS NULL
        OR (condition_lo IS NOT NULL OR condition_hi IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rule_effect_measured_from_idx
  ON nsw.rule_effect(topic, measured_from) WHERE measured_from IS NOT NULL;

-- ── provenance back to the cell ────────────────────────────────────────
-- Which cell an effect was read out of. `source_span` stays as the literal
-- text the verifier gates on; this is the structural pointer beside it.

ALTER TABLE nsw.rule_effect
  ADD COLUMN IF NOT EXISTS cell_id UUID REFERENCES nsw.section_table_cell(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rule_effect_cell_idx ON nsw.rule_effect(cell_id) WHERE cell_id IS NOT NULL;

COMMIT;
