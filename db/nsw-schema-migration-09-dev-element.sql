-- ─────────────────────────────────────────────────────────────────────
-- 09  What a clause governs, where that is not the principal building
-- ─────────────────────────────────────────────────────────────────────
--
-- A DCP states setbacks for a great many things, and as bare numbers they are
-- indistinguishable from the ones that shape the house. Randwick DCP 2025
-- C1 cl 8.3 — "Communications dishes and aerial antennae", under
-- "8. Ancillary development" — requires 900 mm from the side and rear
-- boundaries. With nothing recording that it governs an aerial, the envelope
-- generator took it as the most restrictive rear setback available for a
-- dwelling and put the back wall 900 mm off the fence.
--
-- The document says which is which in its own heading chain, so the ingest
-- reads it rather than inferring it — the same principle as taking the
-- development type from the Part. This adds the dimension it needs.
--
-- Not `dev_type`: that names the KIND of development a Part governs
-- (residential, industrial), and every ancillary clause in Part C1 is still
-- residential. This says the clause governs a component of the site rather
-- than the building, which is a different question and has to be asked
-- separately or the two answers collapse.
--
-- Not `lot_type` either — that describes the land, not the thing being built.

ALTER TABLE nsw.rule_applicability DROP CONSTRAINT IF EXISTS rule_applicability_dimension_check;

ALTER TABLE nsw.rule_applicability ADD CONSTRAINT rule_applicability_dimension_check
  CHECK (dimension IN (
    'zone','land_use','dev_type','act','area_label','site_ref',
    'lot_type','excluded_area','size_band_lo','size_band_hi','temporal',
    'map_area',
    -- New: the component a clause governs where it is not the principal
    -- building — 'ancillary' for outbuildings, pools, fences, aerials,
    -- earthworks and retaining walls. A consumer building an envelope
    -- excludes these; one answering "what setback applies to my pool" wants
    -- exactly them, which is why they are recorded rather than dropped.
    'dev_element'
  ));

COMMENT ON COLUMN nsw.rule_applicability.dimension IS
  'Axis the applicability is stated on. dev_element marks a clause that '
  'governs something other than the principal building (ancillary structures, '
  'earthworks); see migration 09.';
