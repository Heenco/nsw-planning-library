-- Migration 21 — a scope_layer term can carve another term out of its source (docs/sepp-rule-pipeline.md, step 10).
--
-- Housing SEPP s 163 defines the "low and mid rise housing outer area" as the 800 m walking band, but the
-- catchment layers are nested: the 800 m polygon contains the 400 m one. A lot in the inner area therefore also
-- hits the 800 m source, and s 180(3)'s outer-area standards (FSR 1.5:1, 17.5 m) were reported as applying next
-- to s 180(2)'s inner ones (2.2:1, 22 m) - found by the step 10 answer keys (Burwood, cadid 100100210).
-- except_term names another term of the same dimension: the term holds only where its source holds AND the
-- excepted term does not. Additive: null for every existing row, which keeps their meaning.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-21-scope-except-term.sql

ALTER TABLE nsw.scope_layer
  ADD COLUMN IF NOT EXISTS except_term TEXT;

COMMENT ON COLUMN nsw.scope_layer.except_term IS
  'Another term of the same dimension carved out of this one: holds = source holds AND NOT except_term holds.';
