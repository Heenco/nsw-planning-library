-- ─────────────────────────────────────────────────────────────────────
-- 14  What answers a scoping term, for a lot
-- ─────────────────────────────────────────────────────────────────────
--
-- A clause scopes itself on a fact about the land — "flood planning area", "heritage item", "two
-- street frontages" — and deciding whether it reaches a lot means finding the layer that answers
-- that fact. Until now that mapping lived as a 13-entry object literal inside
-- server/api/testing/lep-rules.get.ts, written in one sitting from memory. That is the same mistake
-- as choosing the dimension set from the schema's CHECK constraint: it encodes what the author
-- happened to think of, and a term nobody thought of silently becomes "cannot be decided" with no
-- record that anyone looked.
--
-- This is the mapping as data, on the cdc.layers pattern that already works for the Codes SEPP:
-- source_kind + source + filter, `features` MEASURED rather than declared, and a row with
-- source_kind 'none' carrying prose about why no layer exists. The gap is then in the table and can
-- be counted, rather than being an absence.
--
-- The mapping is per TERM, not per clause. Thirteen characteristics cover the 21 rows in the graph
-- today, and the same thirteen cover every one of the 146 LEPs — "flood" means the same thing in
-- Hornsby as in Wagga. A per-clause mapping would have to be rebuilt for every plan ingested.

CREATE TABLE IF NOT EXISTS nsw.scope_layer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which applicability dimension this answers, and the resolved term within it. Together unique:
  -- 'land_characteristic' + 'flood' is one mapping.
  dimension     text NOT NULL,
  term          text NOT NULL,
  title         text,

  -- 'table'    a schema-qualified relation tested directly
  -- 'registry' a key in cdc.layers or lmr.layers, which already carries its own source and filter
  -- 'derived'  computed from the lot rather than looked up — "two street frontages" is the frontage
  --            runs this build already measures, not a planning layer anyone publishes
  -- 'none'     nothing answers it; `note` says what was looked for
  source_kind   text NOT NULL CHECK (source_kind IN ('table','registry','derived','none')),
  source        text,
  filter        text,

  -- How the lot is tested against it. 'intersects' is the default and the honest one for a lot:
  -- a house on the dry half of a flood line is still partly in the flood planning area.
  test          text NOT NULL DEFAULT 'intersects'
                CHECK (test IN ('intersects','covers','attribute','derived')),
  column_tested text,

  -- Whether matching the layer makes the clause BITE or merely describes the land. Same vocabulary
  -- as cdc.layers/lmr.layers so the three registries read alike.
  kind          text NOT NULL DEFAULT 'condition'
                CHECK (kind IN ('condition','exclusion','context')),

  note          text,

  -- Measured by scripts/seed-scope-layers.mjs, not asserted here. A mapping that names a table with
  -- zero rows is a broken mapping, and it has to be visible as one.
  features      bigint,
  checked_at    timestamptz,

  UNIQUE (dimension, term)
);

COMMENT ON TABLE nsw.scope_layer IS
  'Maps an LEP scoping term to the layer that answers it for a lot. Per term, not per clause: the '
  'same mapping serves all 146 LEPs. source_kind ''none'' records a term nothing can answer, with '
  'the reason in note — the gap is data, not an absence.';

CREATE INDEX IF NOT EXISTS scope_layer_dimension_idx ON nsw.scope_layer (dimension);

-- Which terms are still unanswered, and how many rules each one is blocking. This is the work list:
-- it says what to build next in the order that unblocks the most clauses.
CREATE OR REPLACE VIEW nsw.scope_layer_gap AS
SELECT a.dimension,
       a.value AS term,
       count(DISTINCT a.rule_id) AS rules,
       count(DISTINCT r.document_id) AS documents,
       sl.source_kind,
       sl.note
  FROM nsw.rule_applicability a
  JOIN nsw.rule r ON r.id = a.rule_id
  LEFT JOIN nsw.scope_layer sl
         ON sl.dimension = a.dimension AND lower(sl.term) = lower(a.value)
 -- site_ref is deliberately excluded. Its values are instances ("Lot 10, DP 1228279",
   -- "163 George Street"), not vocabulary terms, and each resolves through rule_spatial_ref rather
   -- than through a layer mapping. Listing them here would report 45 "unmapped terms" that no
   -- mapping could ever cover and bury the handful that are real.
 WHERE a.dimension IN ('land_characteristic','tenure','adjacency')
   AND (sl.id IS NULL OR sl.source_kind = 'none')
 GROUP BY a.dimension, a.value, sl.source_kind, sl.note
 ORDER BY count(DISTINCT a.rule_id) DESC;

COMMENT ON VIEW nsw.scope_layer_gap IS
  'Scoping terms with no layer behind them, ranked by how many rules they leave undecidable.';
