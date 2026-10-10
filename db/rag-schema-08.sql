-- RAG pilot - migration 08: the planning maps' "additional controls", copied from UrbanPortalDBP.
--
-- The feature services publish each LEP map's additional controls (an "Area 1" on the Height of Buildings Map, an
-- "Area 10" on the Floor Space Ratio Map, incentive heights and floor space) as separate layers. The GEODAAS EPI dump
-- that schema epi holds carries only some of them (Hornsby's Height of Buildings Map: Areas 3, 5, 6, 8 - not the
-- Cherrybrook Areas 1, 2 and 10 its Part 7 depends on). UrbanPortalDBP holds the layers whole
-- (urbanportaldbp."AdditionalControls_FSR | _HOB | _LZN | _LotSize"); scripts/rag/01c-additional-controls.py copies
-- them here, and scripts/rag/02d-bindings.ts adds them to rag.map_polygon beside the plans' own epi layers.
--
-- Apply:  node scripts/apply-nsw-migration.mjs rag-schema-08.sql

CREATE TABLE IF NOT EXISTS rag.additional_controls (
  id             bigserial PRIMARY KEY,
  source         text NOT NULL,          -- the UrbanPortalDBP table: AdditionalControls_FSR / _HOB / _LZN / _LotSize
  source_id      bigint,                 -- its OBJECTID
  epi_name       text NOT NULL,          -- the plan, as rag.instrument.title spells it
  map_name       text NOT NULL,          -- the map the control is on: Floor Space Ratio Map, Height of Buildings Map, ...
  label          text,                   -- "Area 1", "IHB 103"
  legis_area     text,                   -- LEGIS_REF_AREA where the layer has it
  legis_clause   text,                   -- LEGIS_REF_CLAUSE: "Clause 4.3", "Clause 7.5"
  legis_value    text,                   -- LEGIS_REF_VALUE / MAX_B_H_M: the figure the control carries, if any
  amendment      text,
  currency_date  date,
  geom           geometry(Geometry, 4283) NOT NULL,
  run_id         uuid REFERENCES rag.run(id)
);
CREATE INDEX IF NOT EXISTS rag_additional_controls_geom ON rag.additional_controls USING gist (geom);
CREATE INDEX IF NOT EXISTS rag_additional_controls_plan ON rag.additional_controls (epi_name, map_name);
