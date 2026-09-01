-- ════════════════════════════════════════════════════════════════════════
-- NSW KG v2 schema migration 03 — DCP hotlinks
-- ════════════════════════════════════════════════════════════════════════
--
-- Adds source_file + page columns to nsw.section so DCP citations can
-- hotlink to `/EPI/DCPs/{source_file}#page={page}`. Populated by the
-- structured-md parser from `<!-- SRC: file.pdf | PAGE: N -->` markers
-- emitted by scripts/dcp-pdf-to-md.ts.
--
-- Idempotent — safe to re-run. Existing rows get NULL values; nsw.document
-- updates will only be observed for DCPs re-ingested after this migration.
--
-- Apply with:  psql $KG_PG_URL -f db/nsw-schema-migration-03-dcp-hotlinks.sql
--   or via:    scripts/apply-nsw-migration.mjs (if it auto-detects new files)
-- ════════════════════════════════════════════════════════════════════════

SET search_path TO nsw, public;

ALTER TABLE nsw.section
  ADD COLUMN IF NOT EXISTS source_file TEXT;

ALTER TABLE nsw.section
  ADD COLUMN IF NOT EXISTS page INTEGER;

-- Index on source_file lets us quickly list all sections that came from a
-- specific split PDF (e.g. for Sydney-file7 coverage verification).
CREATE INDEX IF NOT EXISTS nsw_section_source_file_idx
  ON nsw.section(source_file)
  WHERE source_file IS NOT NULL;
