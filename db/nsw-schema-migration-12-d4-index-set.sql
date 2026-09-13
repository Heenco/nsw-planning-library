-- ─────────────────────────────────────────────────────────────────────
-- 12  The complete index set for up_property_d_4. Re-run after every reload.
-- ─────────────────────────────────────────────────────────────────────
--
-- WHY THIS EXISTS WHEN 11 ALREADY DECLARED MOST OF IT
--
-- d_4 is a bulk-loaded snapshot, and a reload replaces the table rather than
-- its rows. On 13 Sep 2026 the live table had exactly one index — the GiST on
-- `geom` that the loader creates — and none of migration 11's three. Every
-- query the report page and the address search run had quietly become a
-- parallel sequential scan of a 10 GB heap, and the server's global
-- `statement_timeout = 60s` was killing the search bar outright rather than
-- letting it crawl.
--
-- So this file is the whole set, idempotent, and the one to apply after the
-- next reload. Migration 11 stays as history; nothing here conflicts with it.
--
--   npm run db:migrate nsw-schema-migration-12-d4-index-set.sql
--
-- The runner honours DATABASE_URL (the `planningai` database, as the app does)
-- and lifts the statement timeout for the session; a plain psql session would
-- need `SET statement_timeout = 0` first or the GIN build dies at 60 s.
--
-- THE FOUR SHAPES, AND THE INDEX FOR EACH
--
--   address ILIKE '%word%'      GIN trigram on address.
--                               /api/property/search (the home page search
--                               bar), /api/address-autocomplete (map and
--                               prop-width), /api/frontage-lot-search. One
--                               clause per word typed; a leading wildcard
--                               defeats any btree. Serves ILIKE, LIKE and
--                               regex. Cannot serve a pattern shorter than
--                               three characters — see MIN_TRIGRAM in
--                               shared/property-columns.ts for why the routes
--                               drop those tokens from the WHERE.
--
--   address = $1                btree on address.
--                               The report's first query for every load by
--                               address (property-report.post.ts), and the
--                               envelope route. pg_trgm 1.6 can answer `=`
--                               from the GIN index too, but as a bitmap scan
--                               with recheck; a btree is a direct lookup and
--                               ~250 MB.
--
--   upper(lot_section_plan) = $1  expression btree.
--                               /api/frontage, /api/frontage-metrics,
--                               /api/frontage-dcp, /api/frontage-property and
--                               the tile-cadastre fallback all upper-case
--                               their input, so an index on the bare column
--                               would not be used.
--
--   propid = $1                 btree. "All lots for this property" on every
--                               report (phase 1b).
--
--   geom <-> point              The existing GiST, which the loader creates.
--                               `geom` is a geography column, so the
--                               `::geography` cast in property-report.post.ts
--                               is what lets the KNN operator reach it.
--                               Nothing to add.
--
-- Not CONCURRENTLY: the table is a read-only snapshot, so the SHARE lock a
-- plain build takes blocks nothing the app does (readers proceed) and it
-- costs one heap pass per index instead of two. `lock_timeout` is set so that
-- if a reload IS in progress this fails fast instead of queueing behind it.
--
-- Cost, measured 13 Sep 2026 on the 10 GB heap with maintenance_work_mem at
-- 512 MB, while the app was idle. The GIN build is the long one (single-
-- threaded; parallel GIN builds arrive in PG 18). The btrees use two workers.
--
--   up_property_d_4_address_trgm   178 s   345 MB
--   up_property_d_4_address         52 s   208 MB
--   up_property_d_4_lot_upper       10 s   117 MB
--   up_property_d_4_propid           3 s    80 MB
--   ANALYZE                         30 s
--
-- What they bought, same day, EXPLAIN ANALYZE against the live table:
--
--   address = $1                 parallel seq scan  ->  0.6 ms
--   propid = $1                  parallel seq scan  ->  0.8 ms
--   upper(lot_section_plan) = $1 parallel seq scan  ->  0.7 ms
--   "fenton toronto"             killed at 60 s     ->  45 ms
--   "george street"              killed at 60 s     ->  820 ms as the route stood
--                                                   ->  346 ms with the byte-order
--                                                        sort the routes now use
--
-- What is left on a common street name is the bitmap HEAP scan: ~20,000
-- matching rows spread over a 10 GB heap at ~2 KB a row, behind 128 MB of
-- shared_buffers. The index side of that query is under 100 ms. The other
-- half of the cost was sorting those rows by `address` under the database's
-- en_US.utf8 collation (~500 ms); the routes now sort under "C" for the
-- dedupe (see server/api/property/search.get.ts). Cutting further is a
-- narrower table or more shared_buffers, not another index.

SET statement_timeout = 0;
SET lock_timeout = '15s';
SET maintenance_work_mem = '512MB';
SET max_parallel_maintenance_workers = 2;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The search bar.
CREATE INDEX IF NOT EXISTS up_property_d_4_address_trgm
  ON nsw.up_property_d_4 USING gin (address gin_trgm_ops);

-- The report, by address.
CREATE INDEX IF NOT EXISTS up_property_d_4_address
  ON nsw.up_property_d_4 (address);

-- The frontage routes, by lot id.
CREATE INDEX IF NOT EXISTS up_property_d_4_lot_upper
  ON nsw.up_property_d_4 (upper(lot_section_plan));

-- The report's sibling lots.
CREATE INDEX IF NOT EXISTS up_property_d_4_propid
  ON nsw.up_property_d_4 (propid);

-- A freshly loaded table may carry no statistics at all, and without them the
-- planner will not choose the trigram index over a scan.
ANALYZE nsw.up_property_d_4;
