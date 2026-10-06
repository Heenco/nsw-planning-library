-- Migration 19 — the gap view watches the SEPP dimensions too (docs/sepp-rule-pipeline.md, step 7).
--
-- nsw.scope_layer_gap (migration 14) lists scoping terms with no layer behind them, but only for
-- land_characteristic / tenure / adjacency. SEPP frames and rules also scope by a defined area ("low and mid
-- rise housing area"), a mapped area ("Accelerated TOD Precinct") and a council list (s 164(1)(e)), so those
-- dimensions are added. Same columns, same meaning: a superset of what the view returned before.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-19-scope-gap-dimensions.sql

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
 -- site_ref stays excluded: its values are instances resolved through rule_spatial_ref (migration 14).
 WHERE a.dimension IN ('land_characteristic', 'tenure', 'adjacency', 'defined_area', 'map_area', 'lga')
   AND (sl.id IS NULL OR sl.source_kind = 'none')
 GROUP BY a.dimension, a.value, sl.source_kind, sl.note
 ORDER BY count(DISTINCT a.rule_id) DESC;

COMMENT ON VIEW nsw.scope_layer_gap IS
  'Scoping terms with no layer behind them, ranked by how many rules they leave undecidable.';
