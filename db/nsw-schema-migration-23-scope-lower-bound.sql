-- Migration 23 — a scope_layer source can be a LOWER bound of its term (docs/sepp-rule-pipeline.md, step 17a).
--
-- Housing SEPP s 36(1)(a) applies within 800 m of a public entrance to a railway or light rail station. Entrances are
-- not held, but 800 m WALKING catchments of every station are (access.iso_train), and anywhere within 800 m walking is
-- within 800 m in a straight line. lower_bound = true says: the source is a subset of the term, so a lot that hits it
-- is in the term (holds = true), and a lot that misses it is undecided (holds = null). The mirror of upper_bound
-- (migration 20). Additive: false for every existing row.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-23-scope-lower-bound.sql

ALTER TABLE nsw.scope_layer
  ADD COLUMN IF NOT EXISTS lower_bound BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN nsw.scope_layer.lower_bound IS
  'The source is a subset of the term: an intersection = the term holds; no intersection = undecided.';
