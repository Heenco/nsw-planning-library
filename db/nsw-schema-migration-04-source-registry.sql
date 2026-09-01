-- ════════════════════════════════════════════════════════════════════════
-- Migration 04 — nsw.source_registry
-- ════════════════════════════════════════════════════════════════════════
--
-- Moves the document source registry out of code (ingest/sources.ts) and
-- into the database, so adding an instrument is a row insert rather than a
-- TypeScript edit plus a redeploy. This is what lets the upload page
-- register a document and ingest it in one flow.
--
-- Mirrors the DocumentSource interface in server/utils/nsw-kg/types.ts,
-- plus provenance columns for uploaded (as opposed to registered) sources.
--
-- Apply with:  npm run db:migrate nsw-schema-migration-04-source-registry.sql
--   or:        psql $KG_PG_URL -f db/nsw-schema-migration-04-source-registry.sql
--
-- NOTE: this table is deliberately absent from the DROP list in
-- nsw-schema.sql. Once uploads land here it holds user data, not derived
-- data, and must survive a schema rebuild.
-- ════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS nsw;
SET search_path TO nsw, public;

CREATE TABLE IF NOT EXISTS nsw.source_registry (
  label            TEXT         PRIMARY KEY,
  title            TEXT         NOT NULL,
  doc_type         TEXT         NOT NULL CHECK (doc_type IN ('lep', 'sepp', 'dcp')),
  scope            TEXT         NOT NULL CHECK (scope IN ('state', 'local')),
  hierarchy_level  SMALLINT     NOT NULL CHECK (hierarchy_level BETWEEN 1 AND 5),
  lga_name         TEXT,                               -- NULL for state-scope documents
  source_url       TEXT         NOT NULL,              -- canonical URL even when read from disk
  raw_path         TEXT         NOT NULL,              -- disk path to the raw source
  raw_format       TEXT         NOT NULL CHECK (raw_format IN ('xml', 'structured-md', 'html')),
  as_at_date       DATE         NOT NULL,              -- legal currency / consolidation date

  -- ── provenance ──────────────────────────────────────────────────────
  -- 'registry' = seeded from the old sources.ts
  -- 'upload'   = dropped on the library upload page
  -- 'url'      = fetched from a URL the user pasted
  origin           TEXT         NOT NULL DEFAULT 'registry'
                                CHECK (origin IN ('registry', 'upload', 'url')),
  content_sha256   TEXT,                               -- dedupe key for uploads (A5)
  original_name    TEXT,                               -- filename as the user supplied it
  enabled          BOOLEAN      NOT NULL DEFAULT true, -- soft-disable without deleting history

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nsw_source_registry_doc_type_idx
  ON nsw.source_registry (doc_type);

CREATE INDEX IF NOT EXISTS nsw_source_registry_lga_idx
  ON nsw.source_registry (lga_name);

-- Partial unique index: the same file may not be uploaded twice, but many
-- rows legitimately have no checksum (everything seeded from sources.ts).
CREATE UNIQUE INDEX IF NOT EXISTS nsw_source_registry_sha_idx
  ON nsw.source_registry (content_sha256)
  WHERE content_sha256 IS NOT NULL;
