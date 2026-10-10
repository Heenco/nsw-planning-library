-- RAG pilot - migration 10: three more coverage checks (rag.coverage, built by scripts/rag/02d-bindings.ts).
--
--   condition_no_layer   a claim's condition (a term, an exclusion, a list item) no registered layer matches, or one
--                        registered with no dataset held - on a lot it is "could not check", and the answer is maybe
--   frame_unscoped       a frame ("This Part applies to ...") whose place the readers did not read - every rule under it
--                        is unknown on every lot
--   label_not_in_epi     a map label held only by a source other than the plan's EPI map layers (the Additional Controls
--                        copied from UrbanPortalDBP, or a resolver map ref): a gap in the EPI dump, kept on record
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-10.sql

ALTER TABLE rag.coverage DROP CONSTRAINT IF EXISTS coverage_check_kind_check;
ALTER TABLE rag.coverage ADD CONSTRAINT coverage_check_kind_check CHECK (check_kind IN
  ('area_no_clause', 'clause_no_polygon', 'schedule_item_unread', 'figure_unread', 'condition_no_layer', 'frame_unscoped', 'label_not_in_epi'));
