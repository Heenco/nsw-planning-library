-- ─────────────────────────────────────────────────────────────────────
-- 13  The scoping devices LEPs actually use
-- ─────────────────────────────────────────────────────────────────────
--
-- The dimension vocabulary was derived from two DCPs and two pilot LEPs, and
-- it shows: of its 13 values, 5 have never been read by any query, while three
-- of the largest scoping devices in the LEP corpus have no value at all.
--
-- Measured over all 146 LEP XMLs, 23,776 clauses, counting a construction once
-- per clause:
--
--     land_use               146 plans   5,442 clauses   22.9%   have it
--     zone                   146 plans   4,200 clauses   17.7%   have it
--     map reference          146 plans   4,165 clauses   17.5%   have it (badly — see below)
--     land characteristic    146 plans   2,318 clauses    9.7%   NO DIMENSION
--     act                    146 plans   2,079 clauses    8.7%   have it
--     adjacency              146 plans   1,863 clauses    7.8%   NO DIMENSION
--     tenure/classification  146 plans     783 clauses    3.3%   NO DIMENSION
--     lot_type               135 plans     249 clauses    1.0%   have it, nothing reads it
--
-- Each of the three additions appears in all 146 plans, so none is a local
-- quirk. They were found by surveying the corpus before choosing, rather than
-- by reading one plan — an earlier pass over Parramatta alone put map
-- references at 50% of clauses, which is a property of Parramatta (a City
-- Centre plan full of Special Provisions Areas) and not of NSW LEPs.

ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_dimension_check;

ALTER TABLE nsw.rule_applicability ADD CONSTRAINT rule_applicability_dimension_check
  CHECK (dimension IN (
    'zone','land_use','dev_type','act','area_label','site_ref',
    'lot_type','excluded_area','size_band_lo','size_band_hi','temporal',
    'map_area','dev_element',

    -- A physical property of the land: flood (585 clauses), biodiversity
    -- (853), bush fire (478), coastal (435), groundwater (345), airport/ANEF
    -- (149), acid sulfate, salinity, contamination, slope.
    --
    -- Not area_label. These are nearly always mapped, and filing them as a
    -- map label loses that "the land is flood prone" is a FACT ABOUT THE LAND
    -- that a lot either satisfies or does not. A consumer asking "is this lot
    -- constrained" wants to test the property; it cannot do that against a
    -- label whose meaning lives in a drawing's legend.
    'land_characteristic',

    -- Applicability that depends on NEIGHBOURING land rather than the lot:
    -- "adjoining", "abutting", "immediately opposite", and the standard
    -- instrument's zone-boundary clause — "so much of any land that is within
    -- the relevant distance of a boundary between any 2 zones", which appears
    -- in 112 of the 146 plans.
    --
    -- This is the only dimension here that cannot be answered from the lot's
    -- own attributes. It needs the neighbours, so a consumer that ignores it
    -- silently over-applies the clause; recording it at least makes that
    -- visible rather than invisible.
    'adjacency',

    -- How the land is held or classified, which changes which act is being
    -- performed: strata (425 clauses), community title (385), common property
    -- (76), and the public land classification operational/community (594).
    --
    -- Not act. "Subdivision by the registration of a strata plan" appears in
    -- 121 plans and is a different thing from a Torrens subdivision while
    -- being the same operative verb, so folding it into act collapses two
    -- answers into one.
    'tenure'
  ));

COMMENT ON COLUMN nsw.rule_applicability.dimension IS
  'What the clause''s applicability turns on. Land-side: zone, area_label, '
  'map_area, land_characteristic, tenure, lot_type, site_ref, adjacency, '
  'excluded_area. Proposal-side: land_use, dev_type, act, dev_element. '
  'Other: temporal, size_band_lo/hi (prefer rule_effect.condition_* — the '
  'band selects which value applies, not whether the clause applies).';

-- A map reference is a PAIR, and storing half of it makes it unresolvable.
--
-- In Parramatta alone, 9 labels appear on more than one map: "Area 1" exists
-- on the Floor Space Ratio Map, the Height of Buildings Map and the Key Sites
-- Map, and they are three different geometries. rule_applicability.value holds
-- the label only, so cl 4.3's "Area 1" and cl 4.4A's "Area 1" are indis-
-- tinguishable rows. That is why rule_spatial_ref resolves 0 of its 26 'map'
-- references while resolving 18 of 18 'area' ones, and why nothing in the
-- application reads the 2,271 area_label rows in the graph.
--
-- rule_spatial_ref already carries map_layer and is the right home for a
-- reference that has to become geometry. This adds the column here too so an
-- applicability row can be self-describing without a join, and so the pair can
-- be enforced.
ALTER TABLE nsw.rule_applicability
  ADD COLUMN IF NOT EXISTS map_layer text;

COMMENT ON COLUMN nsw.rule_applicability.map_layer IS
  'The map a label is drawn on, e.g. "Height of Buildings". Required with '
  'dimension area_label/map_area: the label alone is ambiguous across maps.';

CREATE INDEX IF NOT EXISTS rule_applicability_map_idx
  ON nsw.rule_applicability (dimension, map_layer, value)
  WHERE map_layer IS NOT NULL;
