-- ═══════════════════════════════════════════════════════════════════════
-- Migration 05 — the rule layer
--
-- The graph today stops at `proposition`: grounded atomic statements with
-- literal source spans. That is the right evidence layer, but it cannot
-- answer the question the product asks — "what controls apply to THIS
-- property, and which of them wins?" — because it has no way to express
--
--   • the SCOPE of a rule   (zone, land use, area, size band, and crucially
--                            negative scope: "does not apply to RU1–RU5")
--   • the EFFECT of a rule  (a number, a permission, an exemption) and where
--                            its value comes from when the text defers to a map
--   • PRECEDENCE            (which rule defeats which, and on what authority)
--   • WHERE it applies      (parcels and areas, as geometry)
--
-- This migration adds that layer, modelled on the LEP Part 4 pilot store
-- (Notebooks/Data/lep_part4/lep_store.sqlite), which already validated the
-- vocabulary across 8 LEPs with full clause-by-clause audits.
--
--   section → proposition   (evidence: grounded atoms, literal spans)
--                  ↓ rollup
--               rule         (normative unit: role, kind, precedence)
--                  ├── rule_applicability   scope, with polarity
--                  ├── rule_effect          what it does, incl. map-deferred values
--                  ├── rule_spatial_ref     parcels/areas, with real geometry
--                  └── rule_edge            overrides / disapplies / can_vary
--                  ↓
--             resolver(property, proposal, date) → effective controls
--
-- Propositions are NOT replaced. A rule cites the propositions that evidence
-- it, so every effective control remains traceable to literal text.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- SCHEMA public is explicit and load-bearing: nsw-schema.sql leaves
-- `search_path` set to `nsw, public`, so a bare CREATE EXTENSION lands
-- PostGIS inside `nsw`. PostGIS does not support ALTER EXTENSION … SET
-- SCHEMA, so getting this wrong can only be fixed by rebuilding.
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;

-- ── rule ───────────────────────────────────────────────────────────────
-- One normative unit. Usually a clause, but a clause that carries several
-- independently-scoped standards (per-zone sub-standards) yields several.

CREATE TABLE IF NOT EXISTS nsw.rule (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  section_id     UUID          REFERENCES nsw.section(id)  ON DELETE CASCADE,

  -- Stable, human-readable key: '<doc_label>:<local_id>[:<slot>]'. Lets a
  -- rebuild delete+reinsert one document without disturbing the rest, and
  -- lets an override reference a rule that has not been inserted yet.
  rule_key       TEXT NOT NULL,

  clause         TEXT,                       -- e.g. '4.3' or '3.1.2'
  role           TEXT,                       -- base_standard, variation_mechanism,
                                             -- permissibility_gate, mandatory_consent, …
  kind           TEXT NOT NULL CHECK (kind IN (
                   'standard','prohibition','permission','additional_use',
                   'exempt_development','consent_trigger','disapplication',
                   'definition','matters','test','mandatory_consent','objective'
                 )),

  -- Where the rule came from. 'rubric' is the DCP path: a block the
  -- converter tagged data-rubric="controls".
  src            TEXT NOT NULL CHECK (src IN (
                   'ai','table','map','schedule1','schedule2','rubric','structural'
                 )),

  -- Precedence has three independent inputs; keep them separate so the
  -- resolver can explain itself.
  --   instrument_rank  statutory hierarchy (EP&A Act s3.28: an EPI beats a
  --                    DCP outright). Derived from document.doc_type.
  --   precedence       ordering WITHIN an instrument (a specific clause
  --                    beating a general one).
  instrument_rank SMALLINT NOT NULL DEFAULT 0,
  precedence      SMALLINT NOT NULL DEFAULT 0,

  provision_ref  TEXT,                       -- citation text as written
  part           TEXT,                       -- 'Part 4', 'Part 3 – Residential'
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (document_id, rule_key)
);

CREATE INDEX IF NOT EXISTS rule_document_idx ON nsw.rule(document_id);
CREATE INDEX IF NOT EXISTS rule_section_idx  ON nsw.rule(section_id);
CREATE INDEX IF NOT EXISTS rule_clause_idx   ON nsw.rule(document_id, clause);

-- ── rule_proposition ───────────────────────────────────────────────────
-- The audit trail. A rule is only as good as the literal text behind it,
-- and precision.ts already guarantees a proposition's span is verbatim.

CREATE TABLE IF NOT EXISTS nsw.rule_proposition (
  rule_id        UUID NOT NULL REFERENCES nsw.rule(id)        ON DELETE CASCADE,
  proposition_id UUID NOT NULL REFERENCES nsw.proposition(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, proposition_id)
);

-- ── rule_applicability ─────────────────────────────────────────────────
-- Scope as data, not prose. `polarity='excludes'` is what makes "this
-- clause does not apply to land in Zone RU1" representable at all; without
-- it a negative scope silently reads as a positive one.

CREATE TABLE IF NOT EXISTS nsw.rule_applicability (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id   UUID NOT NULL REFERENCES nsw.rule(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN (
              'zone','land_use','dev_type','act','area_label','site_ref',
              'lot_type','excluded_area','size_band_lo','size_band_hi','temporal'
            )),
  value     TEXT NOT NULL,
  polarity  TEXT NOT NULL DEFAULT 'applies' CHECK (polarity IN ('applies','excludes')),
  source_span TEXT,
  UNIQUE (rule_id, dimension, value, polarity)
);

CREATE INDEX IF NOT EXISTS rule_applicability_lookup_idx
  ON nsw.rule_applicability(dimension, value) WHERE polarity = 'applies';

-- ── rule_effect ────────────────────────────────────────────────────────
-- What the rule actually does. A numeric effect either carries its value or
-- defers it to a map layer — never neither, which is the invariant that
-- stops a height control silently becoming "no limit".

CREATE TABLE IF NOT EXISTS nsw.rule_effect (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       UUID NOT NULL REFERENCES nsw.rule(id) ON DELETE CASCADE,
  effect_type   TEXT NOT NULL CHECK (effect_type IN (
                  'numeric','permits_use','prohibits_use','requires_consent',
                  'exempt_from_consent','disapplies','mandatory_consent','matter_for_consideration'
                )),
  topic         TEXT,                        -- height, fsr, lot_size, gfa, setback, parking …
  comparator    TEXT CHECK (comparator IN ('eq','lt','lte','gt','gte','between')),
  value         NUMERIC,
  value_upper   NUMERIC,                     -- for 'between'
  unit          TEXT,

  -- When the text says "as shown on the Height of Buildings Map", the value
  -- is not in the document. map_layer names the layer; the resolver binds it
  -- to the property's materialised column.
  value_source  TEXT,
  map_layer     TEXT,
  relative_to   TEXT,                        -- 'existing ground level', 'natural ground level'
  combine       TEXT,                        -- how multiple effects compose ('min','max','all')
  source_span   TEXT,

  CONSTRAINT numeric_effect_has_a_source CHECK (
    effect_type <> 'numeric'
    OR value IS NOT NULL
    OR value_source IS NOT NULL
    OR map_layer IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS rule_effect_rule_idx  ON nsw.rule_effect(rule_id);
CREATE INDEX IF NOT EXISTS rule_effect_topic_idx ON nsw.rule_effect(topic);

-- ── rule_spatial_ref ───────────────────────────────────────────────────
-- The parcels and areas a rule points at. The text key is filled at
-- extraction; `geom` is filled post-build by geocoding and stays NULL when
-- unresolved — a NULL is a known gap, not a silent wrong answer.

CREATE TABLE IF NOT EXISTS nsw.rule_spatial_ref (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  rule_id          UUID          REFERENCES nsw.rule(id)     ON DELETE CASCADE,
  section_id       UUID          REFERENCES nsw.section(id)  ON DELETE CASCADE,
  clause           TEXT,
  ref_type         TEXT NOT NULL CHECK (ref_type IN ('lot_dp','address','area','map')),
  value            TEXT NOT NULL,
  map_layer        TEXT,
  polarity         TEXT NOT NULL DEFAULT 'applies' CHECK (polarity IN ('applies','excludes')),
  geom             geometry(Geometry, 4326),
  geom_source      TEXT,                     -- 'cadastre','addresspoint','eplanning', …
  match_confidence NUMERIC CHECK (match_confidence BETWEEN 0 AND 1),
  UNIQUE (document_id, clause, ref_type, value)
);

CREATE INDEX IF NOT EXISTS rule_spatial_ref_geom_idx ON nsw.rule_spatial_ref USING GIST (geom);
CREATE INDEX IF NOT EXISTS rule_spatial_ref_rule_idx ON nsw.rule_spatial_ref(rule_id);

-- ── rule_edge ──────────────────────────────────────────────────────────
-- Defeasibility. Planning rules apply UNLESS displaced, so the graph has to
-- carry the displacement explicitly, with the authority for it — a resolver
-- that cannot cite why a rule lost is not usable for a planning decision.

CREATE TABLE IF NOT EXISTS nsw.rule_edge (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_rule_id UUID NOT NULL REFERENCES nsw.rule(id) ON DELETE CASCADE,
  to_rule_id   UUID          REFERENCES nsw.rule(id) ON DELETE CASCADE,

  -- Unresolved target: an override may name a clause in a document that is
  -- not ingested yet. Keeping the text lets the edge exist and be resolved
  -- later rather than being dropped.
  to_ref       TEXT,

  edge_type    TEXT NOT NULL CHECK (edge_type IN (
                 'overrides','disapplies','can_vary','relaxes','prevails_over',
                 'excepts','requires','defines','prohibits'
               )),
  -- Why it wins. 'statute' = EP&A Act s3.28 and friends; 'instrument' = the
  -- document's own "relationship with other EPIs" clause; 'specificity' = a
  -- specific provision beating a general one.
  authority    TEXT CHECK (authority IN ('statute','instrument','specificity','temporal','manual')),
  scope        JSONB,                        -- conditions under which it applies
  source_span  TEXT,
  confidence   NUMERIC NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  cross_document BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT rule_edge_has_target CHECK (to_rule_id IS NOT NULL OR to_ref IS NOT NULL),
  CONSTRAINT rule_edge_no_self_loop CHECK (from_rule_id <> to_rule_id OR to_rule_id IS NULL)
);

CREATE INDEX IF NOT EXISTS rule_edge_from_idx ON nsw.rule_edge(from_rule_id);
CREATE INDEX IF NOT EXISTS rule_edge_to_idx   ON nsw.rule_edge(to_rule_id);

-- ── objective ──────────────────────────────────────────────────────────
-- Objectives are aids to interpretation, not development standards. Held
-- apart so they can be shown and reasoned about without ever being resolved
-- as binding controls — 48% of LEP Part 4 clauses open with one, and the
-- DCP converter tags the equivalent block data-rubric="objectives".

CREATE TABLE IF NOT EXISTS nsw.objective (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  section_id  UUID          REFERENCES nsw.section(id)  ON DELETE CASCADE,
  rule_id     UUID          REFERENCES nsw.rule(id)     ON DELETE CASCADE,
  clause      TEXT,
  seq         SMALLINT NOT NULL DEFAULT 0,
  text        TEXT NOT NULL,
  source_span TEXT
);

CREATE INDEX IF NOT EXISTS objective_document_idx ON nsw.objective(document_id);

-- ── audit_finding ──────────────────────────────────────────────────────
-- The accuracy gate, as data. The pilot's lesson: you cannot converge on
-- correctness without a number, and you cannot converge at all unless
-- genuinely-unfixable findings can be accepted and stop recurring.

CREATE TABLE IF NOT EXISTS nsw.audit_finding (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES nsw.document(id) ON DELETE CASCADE,
  run_id      UUID          REFERENCES nsw.ingest_run(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,               -- clause_no_rows, cadastral_miss, numeric_lead, …
  gating      BOOLEAN NOT NULL DEFAULT true,
  clause      TEXT,
  value       TEXT,
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','accepted','fixed')),
  accepted_reason TEXT,                    -- required to move to 'accepted'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accepted_needs_a_reason CHECK (
    status <> 'accepted' OR accepted_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS audit_finding_open_idx
  ON nsw.audit_finding(document_id) WHERE status = 'open' AND gating;

COMMIT;
