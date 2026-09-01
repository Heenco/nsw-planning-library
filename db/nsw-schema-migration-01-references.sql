-- ═════════════════════════════════════════════════════════════════════════
-- nsw schema migration 01 — add proposition.refs and proposition.exempts_ref
-- resolved counterparts
-- ═════════════════════════════════════════════════════════════════════════
--
-- Safe to run while ingests are in progress:
--   ALTER TABLE ... ADD COLUMN with no default is metadata-only.
--
-- Columns added:
--   refs          JSONB   - raw references[] array from the LLM
--                           [{ "type": "clause", "ref": "4.1" }, ...]
--   refs_resolved JSONB   - array of resolved section UUIDs, parallel to refs
--                           [{"type":"clause","ref":"4.1","section_id":"..."}]
--                           populated by Stage 3 (reference resolver)

SET search_path TO nsw, public;

ALTER TABLE proposition
  ADD COLUMN IF NOT EXISTS refs          JSONB,
  ADD COLUMN IF NOT EXISTS refs_resolved JSONB;

-- Optional: GIN index on refs for searches like "find propositions that cite clause 4.1"
CREATE INDEX IF NOT EXISTS nsw_proposition_refs_idx
  ON proposition USING gin(refs);
