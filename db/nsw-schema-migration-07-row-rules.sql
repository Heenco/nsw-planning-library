-- ═══════════════════════════════════════════════════════════════════════
-- Migration 07 — a control table row is a rule
-- ═══════════════════════════════════════════════════════════════════════
--
-- Migration 06 gave an effect its datum and its numeric band. What it could
-- not carry is the row's own SCOPE, because scope lives in
-- `rule_applicability`, which hangs off a rule — and the ingest made one
-- rule per clause. So every row of a table shared one scope, and two facts
-- the document states plainly had nowhere to go:
--
--   Table 2.1.1-a  Translations of Height to Storeys
--     HLEP Area | Maximum Building Height (m) | Maximum Storeys
--     K         | 10.5m                       | 2 storeys + attic
--
--   Table 1.3.2-c  On Site Car Parking Rates
--     Dwelling house            | 2 spaces
--     Residential flat building | 1 space per dwelling
--
-- The 'K' is a Height of Buildings Map area — the sole thing that makes
-- 10.5 m the answer rather than 20.5 m — and the parking rows name land
-- uses that no clause heading mentions. Both are row-level scope.
--
-- The fix is to make each control-table row its own rule, which is what
-- `rule.rule_key`'s documented '<doc_label>:<local_id>[:<slot>]' form was
-- always for. This migration only widens the vocabulary that allows it.
--
--   node scripts/apply-migration.mjs nsw-schema-migration-07-row-rules.sql --dry-run
--   node scripts/apply-migration.mjs nsw-schema-migration-07-row-rules.sql

BEGIN;

SET LOCAL search_path TO nsw, public;

-- ── rule_applicability: a map area is a scope ──────────────────────────
-- `area_label` already means "the council area this instrument covers"
-- (every Hornsby DCP rule carries area_label = Hornsby), so reusing it for
-- an HLEP area code would make 'Hornsby' and 'K' the same kind of thing.
-- They are not: one is the instrument's extent, the other selects between
-- values inside it and only resolves once a parcel is known.

ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_dimension_check;

ALTER TABLE nsw.rule_applicability ADD CONSTRAINT rule_applicability_dimension_check
  CHECK (dimension IN (
    'zone','land_use','dev_type','act','area_label','site_ref',
    'lot_type','excluded_area','size_band_lo','size_band_hi','temporal',
    -- New: a mapped area code the value is keyed on ('K', 'T2', 'AA').
    -- Unresolvable without a parcel, which is the honest state of it.
    'map_area'
  ));

-- ── rule: which table row it came from ─────────────────────────────────
-- `rule_key` carries the slot so a rebuild is still idempotent, but the
-- pointer is worth having as data rather than only inside a string.

ALTER TABLE nsw.rule
  ADD COLUMN IF NOT EXISTS table_id  UUID REFERENCES nsw.section_table(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS table_row INTEGER;

CREATE INDEX IF NOT EXISTS rule_table_idx ON nsw.rule(table_id) WHERE table_id IS NOT NULL;

-- `src` already distinguishes a table-derived rule from a prose one; no
-- new value is needed, but a row rule must actually say so.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_table_row_is_tabular') THEN
    ALTER TABLE nsw.rule ADD CONSTRAINT rule_table_row_is_tabular
      CHECK (table_id IS NULL OR src = 'table');
  END IF;
END $$;

COMMIT;
