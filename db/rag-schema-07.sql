-- RAG pilot - migration 07: more than one LEP.
--
--   rag.instrument.source_fingerprint   what the snapshot was built from (an LEP: the pilot structure run; a SEPP: its
--                                       as-at date, scope and section count). 01-snapshot.ts re-snapshots an instrument
--                                       only when this changes (or with --force), so adding an LEP does not throw away
--                                       the chunks, model contexts and embeddings of the ones already loaded.
--   rag.instrument.as_at                the date the text is in force as at (nsw.document.as_at_date, Sydney date) -
--                                       the XML that 01b-groups.py / 02a-terms.py read is fetched for this same date.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-07.sql

ALTER TABLE rag.instrument ADD COLUMN IF NOT EXISTS source_fingerprint text;
ALTER TABLE rag.instrument ADD COLUMN IF NOT EXISTS as_at date;
