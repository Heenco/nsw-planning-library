-- Migration 08 — a real identity for nsw.document.
--
-- Until now an ingest established identity with:
--
--     DELETE FROM nsw.document WHERE title = $1
--
-- against a table whose only constraint is `id UUID PRIMARY KEY`. Nothing
-- enforced that a title was unique, so a re-run with any variation in the
-- --title argument — "Randwick DCP 2025" vs "Randwick Development Control
-- Plan 2025" — did not replace the earlier document. The DELETE matched
-- nothing and the INSERT silently produced a second, duplicate instrument,
-- with both versions' rules live in `nsw.rule` and no way to tell them
-- apart. For a 43-part DCP that is thousands of duplicated controls.
--
-- `instrument_slug` is the stable key: it comes from the source manifest
-- (`instrument` field), not from prose, so it survives retitling and can be
-- typed identically every run.
--
-- Deliberately NOT in this migration: commenced / repealed / superseded_by.
-- Representing supersession properly is a larger change and is tracked
-- separately; this migration only fixes identity.

BEGIN;

ALTER TABLE nsw.document
  ADD COLUMN IF NOT EXISTS instrument_slug TEXT;

COMMENT ON COLUMN nsw.document.instrument_slug IS
  'Stable instrument key from the source manifest, e.g. randwick-dcp-2025. '
  'The idempotency key for re-ingest: replaces matching on title.';

-- Backfill anything already ingested. Derived from the title, with a
-- numeric suffix where that derivation collides, so the unique index below
-- can be created without failing on pre-existing duplicates. A collision
-- here is itself a signal worth looking at: it means two documents were
-- ingested under effectively the same name.
WITH derived AS (
  SELECT
    id,
    trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')) AS slug
  FROM nsw.document
  WHERE instrument_slug IS NULL
),
numbered AS (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY id) AS n
  FROM derived
)
UPDATE nsw.document d
SET instrument_slug = CASE WHEN n.n = 1 THEN n.slug ELSE n.slug || '-' || n.n END
FROM numbered n
WHERE d.id = n.id;

ALTER TABLE nsw.document
  ALTER COLUMN instrument_slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_instrument_slug_key
  ON nsw.document (instrument_slug);

COMMIT;
