-- Migration 22 — alternatives, distance terms and conditions on another rule's answer
-- (docs/sepp-rule-pipeline.md, step 14a).
--
-- Housing SEPP s 72(2) applies "on land (a) in [a list of zones] ... (a1) in a TOD area ... (a2) on which ... is
-- permissible under Chapter 6 ... (b) ... (c) identified as WestConnex Dive Site" - alternatives, where every
-- frame so far ANDed its conditions. s 15C(1)(c) is two branches of ANDs: Six Cities land in an accessible area,
-- OR other land within 800 m walking of a centre zone.
--
-- 1. rule_applicability.alt_group  '<group>#<branch>': rows sharing a group are alternatives - the group holds
--    when any branch holds; rows sharing a branch are ANDed. NULL (every existing row) keeps today's AND.
--    The same (dimension, value, polarity) may sit in two branches, so the unique key now includes the group.
-- 2. dimension 'permissible_under': a condition on another rule's answer - 'lep:<use>' (the lot's Land Use
--    Table), 'sepp:<section local_id>:<use>' (a SEPP permission under that chapter/part of the same instrument),
--    'verdict' (the use asked about is permitted with consent, e.g. s 15C(1)(a)).
-- 3. scope_layer.within_m: the term holds for a lot within this straight-line distance of the source. With
--    upper_bound it reads "within N m walking": outside N m in a straight line is decidedly outside.
-- Additive: existing rows keep their meaning.
--
-- Apply:  node scripts/apply-nsw-migration.mjs nsw-schema-migration-22-alternatives-distance.sql

ALTER TABLE nsw.rule_applicability ADD COLUMN IF NOT EXISTS alt_group TEXT;
COMMENT ON COLUMN nsw.rule_applicability.alt_group IS
  '<group>#<branch>: rows sharing a group are alternatives (any branch); rows sharing a branch are ANDed. NULL = ANDed with the rest.';

ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_rule_id_dimension_value_polarity_key;
CREATE UNIQUE INDEX IF NOT EXISTS rule_applicability_rule_dim_value_pol_group_key
  ON nsw.rule_applicability (rule_id, dimension, value, polarity, coalesce(alt_group, ''));

ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_dimension_check;
ALTER TABLE nsw.rule_applicability ADD CONSTRAINT rule_applicability_dimension_check CHECK (dimension = ANY (ARRAY[
  'zone', 'land_use', 'dev_type', 'act', 'area_label', 'site_ref', 'lot_type', 'excluded_area', 'size_band_lo',
  'size_band_hi', 'temporal', 'map_area', 'dev_element', 'land_characteristic', 'adjacency', 'tenure', 'defined_area',
  'lga', 'proponent', 'proposal_metric', 'pathway', 'permissible_under']));

ALTER TABLE nsw.scope_layer ADD COLUMN IF NOT EXISTS within_m NUMERIC;
COMMENT ON COLUMN nsw.scope_layer.within_m IS
  'The term holds within this straight-line distance (m) of the source; with upper_bound, outside it is decidedly outside.';
