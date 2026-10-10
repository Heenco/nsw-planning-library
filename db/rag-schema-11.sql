-- RAG pilot - migration 11: currency checks (rag.coverage).
--
--   text_changed_since   a clause added, changed or removed between the date the corpus text is as at (rag.instrument.as_at)
--                        and the version in force today - written by scripts/rag/01d-currency.py from the legislation XML
--   map_newer_than_text  a map layer (EPI dump or Additional Controls) amended after the date the text is as at: the
--                        amendment that redrew the map may have changed clauses the corpus does not hold - written by 02d
--
-- rag.coverage now has two writers: 02d rebuilds its own kinds, 01d-currency.py its one.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-11.sql

ALTER TABLE rag.coverage DROP CONSTRAINT IF EXISTS coverage_check_kind_check;
ALTER TABLE rag.coverage ADD CONSTRAINT coverage_check_kind_check CHECK (check_kind IN
  ('area_no_clause', 'clause_no_polygon', 'schedule_item_unread', 'figure_unread', 'condition_no_layer', 'frame_unscoped', 'label_not_in_epi',
   'text_changed_since', 'map_newer_than_text'));
