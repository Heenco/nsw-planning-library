-- Migration 20 — a scope_layer source can be an upper bound of its term (docs/sepp-rule-pipeline.md, step 9).
--
-- Housing SEPP s 164(1)(f) excludes "flood prone land in the Georges River Catchment and Hawkesbury-Nepean
-- Catchment". The flood prone land is not held, but both catchment outlines are - and flood prone land IN a
-- catchment cannot lie outside it. upper_bound = true says: the source is a superset of the term, so a lot
-- that misses it is outside the term (holds = false), and a lot that hits it is undecided (holds = null).
-- Additive: false for every existing row, which keeps their meaning.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-20-scope-upper-bound.sql

ALTER TABLE nsw.scope_layer
  ADD COLUMN IF NOT EXISTS upper_bound BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN nsw.scope_layer.upper_bound IS
  'The source is a superset of the term: no intersection = the term does not hold; an intersection = undecided.';
