-- RAG pilot - migration 06: a frame whose condition is a list ("This clause applies to development on land- (a) ...,
-- or (b) ...") is bound item by item.
--
--   part 'item'   one list item of a frame, bound like any condition (a layer, a council list, a zone) - or not
--   status 'items' the frame row itself: its condition is its items; note holds how they combine ('any' / 'all' / 'unknown')
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-06.sql

ALTER TABLE rag.claim_binding DROP CONSTRAINT IF EXISTS claim_binding_part_check;
ALTER TABLE rag.claim_binding ADD CONSTRAINT claim_binding_part_check CHECK (part IN ('term', 'exclude', 'mapped', 'frame', 'item'));
ALTER TABLE rag.claim_binding DROP CONSTRAINT IF EXISTS claim_binding_status_check;
ALTER TABLE rag.claim_binding ADD CONSTRAINT claim_binding_status_check
  CHECK (status IN ('bound', 'no_data', 'no_match', 'no_polygon', 'proposal_fact', 'discretion', 'unscoped', 'items'));
