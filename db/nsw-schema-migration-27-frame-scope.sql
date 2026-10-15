-- Migration 27 — a frame's reach as data (docs/precinct-sepp-pipeline.md, step 4 follow-up).
--
-- frames.ts assigns every section to its most specific frame from the profile's `governs` lists, but that list lived
-- only in the profile, so a reader could reach a SEPP clause's frame only through a rule extracted for that clause
-- (rule.frame_rule_id). A clause with no rule yet - every Precinct SEPP clause until step 9 - had no frame, and its
-- unread statements reached every lot. This table holds each frame's governed section local_ids; a reader walks a
-- section's ancestors and takes the deepest frame that governs one of them, as frames.ts's own coverage check does.
-- Additive. Apply: node scripts/apply-nsw-migration.mjs nsw-schema-migration-27-frame-scope.sql
CREATE TABLE IF NOT EXISTS nsw.rule_frame_scope (
  rule_id  uuid NOT NULL REFERENCES nsw.rule(id) ON DELETE CASCADE,
  local_id text NOT NULL,                      -- a top-level unit or a section local_id the frame governs (descendants included)
  PRIMARY KEY (rule_id, local_id)
);
CREATE INDEX IF NOT EXISTS rule_frame_scope_local_idx ON nsw.rule_frame_scope (local_id);
COMMENT ON TABLE nsw.rule_frame_scope IS 'Each frame rule''s governed section local_ids (the profile''s governs list), so a reader can find a clause''s frame without a rule for the clause.';
