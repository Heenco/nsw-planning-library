-- NSW knowledge graph - migration 26: where an unread clause reaches
--
--   nsw.norm_unchecked."when"  the clause's own scope ("This clause applies to ...", whole-clause exclusions) and, for a
--                              SEPP, the frame of the part it sits in (nsw.rule kind 'frame') - as a norm condition
--                              (shared/norms/schema.ts Cond). A clause the reader could not read can still be ruled out
--                              for a lot it cannot reach; NULL = nothing known about its reach (it reaches every lot).
--
-- Written by scripts/norms/read-subdivision.ts; read by /api/norms/subdivision. Additive.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-26-norm-unchecked-reach.sql

ALTER TABLE nsw.norm_unchecked ADD COLUMN IF NOT EXISTS "when" jsonb;

COMMENT ON COLUMN nsw.norm_unchecked."when" IS 'Where the unread clause reaches: its own scope + its SEPP part''s frame, as a norm condition; NULL = unknown. Migration 26.';
