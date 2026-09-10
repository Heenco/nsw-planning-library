-- ─────────────────────────────────────────────────────────────────────
-- 11  Make up_property_d_4 answerable by address and by lot id
-- ─────────────────────────────────────────────────────────────────────
--
-- d_4 arrived with one index: GiST on `geom`. Everything else is a sequential
-- scan over 5,485,081 rows — 37x the table the frontage routes used to read.
--
-- That did not matter while nothing queried it. It started mattering the moment
-- the frontage tools were pointed at it: the address search
-- (`address ILIKE '%…%'`, one clause per word) stopped answering inside 40
-- seconds, and every `upper(lot_section_plan) = $1` lookup — the address
-- fallback and the lot attributes panel — became a full scan too, silently,
-- because those return a row either way and only get slower.
--
-- Two indexes, matching the two shapes actually queried.
--
--   address        GIN trigram. The search is a contains-match on words the
--                  user typed in any order ("fenton toronto"), which no btree
--                  can serve — a leading wildcard defeats prefix search. This
--                  is what pg_trgm exists for, and the extension is already
--                  installed.
--
--   lot id         btree on upper(lot_section_plan). Expression index, because
--                  the callers upper-case their input: an index on the bare
--                  column cannot be used by `upper(col) = $1` and the planner
--                  falls back to a scan without saying so.
--
-- Not CONCURRENTLY: this runs inside the migration transaction, and the table
-- is a read-only snapshot reloaded in bulk, so a brief write lock costs
-- nothing. On 5.5M rows expect a couple of minutes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS up_property_d_4_address_trgm
  ON nsw.up_property_d_4 USING gin (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS up_property_d_4_lot_upper
  ON nsw.up_property_d_4 (upper(lot_section_plan));

-- The planner needs statistics on a table this size to choose the trigram
-- index over a scan; a freshly loaded table may have none.
ANALYZE nsw.up_property_d_4;

-- ─────────────────────────────────────────────────────────────────────
-- The property report's own two lookups
-- ─────────────────────────────────────────────────────────────────────
--
-- The report finds a lot by point and then fetches its sibling lots by propid.
--
--   propid   btree. "All lots for this property" runs on every report and was
--            a sequential scan: 381ms on 5.5M rows, against 0ms of useful work.
--
-- The point lookup needs no new index -- it uses the GiST on `geom` that came
-- with the table, via the KNN operator. What it needed was a query written to
-- reach it: ordering by an expression over centroid_lat/centroid_lon cannot,
-- and cost four seconds a report.

CREATE INDEX IF NOT EXISTS up_property_d_4_propid
  ON nsw.up_property_d_4 (propid);
