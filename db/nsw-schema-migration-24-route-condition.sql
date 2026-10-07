-- Migration 24 — a frame condition that makes its grants a route, not an answer (docs/sepp-rule-pipeline.md, step 17b).
--
-- Some SEPP grants hold only for a proposal of one kind: s 116 converts an EXISTING serviced apartment building to a
-- residential flat building; s 138 needs a site compatibility certificate; s 141F(1) does not apply unless the
-- development is by a public authority or tied to approved electricity infrastructure / SSD / SSI (s 141F(3)). As a
-- proposal_metric the evaluator assumes such a fact, so "is a residential flat building permissible on this lot?"
-- came back yes everywhere by s 116. route_condition is a proposal fact the general question does NOT assume: a grant
-- under a frame carrying one is listed as a route for proposals that meet it (like a proponent-limited grant), never
-- the general answer. Additive: the existing dimensions are unchanged.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-24-route-condition.sql

ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_dimension_check;
ALTER TABLE nsw.rule_applicability ADD CONSTRAINT rule_applicability_dimension_check CHECK (dimension = ANY (ARRAY[
  'zone', 'land_use', 'dev_type', 'act', 'area_label', 'site_ref', 'lot_type', 'excluded_area', 'size_band_lo',
  'size_band_hi', 'temporal', 'map_area', 'dev_element', 'land_characteristic', 'adjacency', 'tenure', 'defined_area',
  'lga', 'proponent', 'proposal_metric', 'pathway', 'permissible_under', 'route_condition']));
