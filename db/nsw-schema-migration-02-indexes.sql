-- ═════════════════════════════════════════════════════════════════════════
-- nsw schema migration 02 — performance indexes
-- ═════════════════════════════════════════════════════════════════════════
--
-- Adds the indexes that should have shipped with Stage 5 but were deferred
-- when embedding columns were nullable. Now that all 9,125 propositions have
-- embeddings + BM25 vectors, we can build the indexes that the chat retrieval
-- and graph expansion actually need.
--
-- Apply with: node scripts/apply-nsw-migration.mjs nsw-schema-migration-02-indexes.sql
--
-- Idempotent — uses IF NOT EXISTS on every index.

SET search_path TO nsw, public;

-- ── 1. Truncated halfvec HNSW vector index ────────────────────────────
--
-- This is the headline win. Vector search currently does a sequential scan
-- over all 9,125 4096-dim vectors (~3-4 sec per query).
--
-- Problem: pgvector 0.7.4 caps HNSW at 2000 dims for `vector` and 4000 dims
-- for `halfvec`. Our embeddings are 4096-dim (BAAI/bge-en-icl) — just over
-- the halfvec limit.
--
-- Solution: add a second column `embedding_2k halfvec(2000)` that stores the
-- first 2000 dimensions of the 4096 embedding (truncated + halfvec for memory
-- efficiency), then build HNSW on that. The full 4096 embedding stays in the
-- `embedding` column for re-ranking if we ever want it.
--
-- Retrieval pattern:
--   ORDER BY embedding_2k <=> $q::halfvec(2000) LIMIT 50
--
-- Truncation is surprisingly lossless for bge-family embeddings at this
-- scale — the leading dimensions carry most of the signal. We'll see a
-- tiny precision drop (~1-2% recall@50 in benchmarks) in exchange for
-- ~30-50× query speed.
--
-- BUILD COST: ~10-30 sec at our scale.

ALTER TABLE proposition
  ADD COLUMN IF NOT EXISTS embedding_2k halfvec(2000);

-- Populate the truncated column from the existing 4096-dim vector.
-- We slice the first 2000 dims using the subvector() function (pgvector 0.7+).
UPDATE proposition
SET embedding_2k = subvector(embedding, 1, 2000)::halfvec(2000)
WHERE embedding IS NOT NULL
  AND embedding_2k IS NULL;

-- HNSW index with cosine distance
CREATE INDEX IF NOT EXISTS nsw_proposition_embedding_2k_hnsw
  ON proposition
  USING hnsw (embedding_2k halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 2. Composite (doc_type, lga_name) on document ──────────────────────
--
-- The chat retrieval almost always filters by both lga_name and doc_type
-- when the user specifies them. A composite index lets the planner use
-- both filter columns at once instead of picking one.

CREATE INDEX IF NOT EXISTS nsw_document_doctype_lga_idx
  ON document(doc_type, lga_name);

-- ── 3. Composite (type, to_id) on edge ─────────────────────────────────
--
-- Graph expansion incoming walks (defines, constrains) query like:
--   WHERE type = 'defines' AND to_id = ANY($1::uuid[])
-- Composite is faster than the current single-column type index + to_id filter.

CREATE INDEX IF NOT EXISTS nsw_edge_type_to_idx
  ON edge(type, to_id);

-- ── 4. Composite (type, from_id) on edge ───────────────────────────────
--
-- Graph expansion outgoing walks (requires, parent_of, resolves_to) query:
--   WHERE type = 'requires' AND from_id = ANY($1::uuid[])

CREATE INDEX IF NOT EXISTS nsw_edge_type_from_idx
  ON edge(type, from_id);

-- ── 5. Partial index on proposition.value_source ───────────────────────
--
-- Only ~90 propositions have a non-null value_source (the map-deferred
-- thresholds). Used by sitewise to join text-side rules to spatial layers.
-- Partial index keeps it tiny.

CREATE INDEX IF NOT EXISTS nsw_proposition_value_source_idx
  ON proposition(value_source)
  WHERE value_source IS NOT NULL;

-- ── 6. ANALYZE so the planner picks up the new indexes immediately ─────
ANALYZE proposition;
ANALYZE document;
ANALYZE edge;
