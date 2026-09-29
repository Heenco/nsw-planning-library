-- ════════════════════════════════════════════════════════════════════════════════════════
-- The low and mid-rise housing catalogue: Housing SEPP 2021 Chapter 6, as data.
--
-- The CDC catalogue's shape (migration 15) for the other housing pathway: /lmr renders these tables
-- and /api/lmr/types evaluates them against a lot, so the page can never cite one rule while the
-- route tests another.
--
--   lmr.type              one housing form per Part of the chapter (dual occupancies, their
--                         subdivision, multi dwelling housing, terraces, residential flat buildings
--                         and shop top housing in R1/R2 and in R3/R4)
--   lmr.type_requirement  every clause the chapter states for it, tested or not, with why not
--   lmr.type_check        the subset that reduces to a lot, in words the threshold is parsed from
--   lmr.general           s 164(1): the land the chapter does not apply to - the CDC's "general
--                         prerequisites". One hit rules out every type.
--
-- Seeded from shared/lmr-criteria.ts by scripts/build-lmr-type-catalogue.ts, which replaces all four
-- tables in one transaction. After the load these are authoritative.
-- ════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS lmr;

CREATE TABLE IF NOT EXISTS lmr.type (
  key                  text PRIMARY KEY,
  name                 text NOT NULL,
  part                 text NOT NULL,            -- 'Part 2' of Chapter 6
  sections             text NOT NULL,            -- 's 166-168'
  zones                text[] NOT NULL,          -- where the standards apply
  land_uses            text[] NOT NULL DEFAULT '{}',   -- Standard Instrument terms, for permissibility
  sepp_permits_in      text[] NOT NULL DEFAULT '{}',   -- zones where the SEPP itself grants consent
  sepp_permits_clause  text,
  -- what the lot is ALLOWED once eligible: FSR, height, storeys, parking, by area (inner/outer/any).
  -- Standards a design has to meet, returned beside the verdict, never tested as if they were land facts.
  allowances           jsonb NOT NULL DEFAULT '[]',
  note                 text,
  ord                  integer NOT NULL,
  checked_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lmr.type_requirement (
  id            bigserial PRIMARY KEY,
  type_key      text NOT NULL REFERENCES lmr.type (key) ON DELETE CASCADE,
  ord           integer NOT NULL,
  clause        text NOT NULL,                   -- '168(2)(a)'
  text          text NOT NULL,                   -- the instrument's words
  href          text NOT NULL,                   -- legislation.nsw.gov.au, at the section
  tested        boolean NOT NULL DEFAULT false,
  tested_by     text,                            -- the lmr.type_check column that answers it
  untested_why  text,                            -- said per row, not one blanket reason
  derived       text,                            -- answered by inference, and what the inference is
  UNIQUE (type_key, ord)
);

CREATE TABLE IF NOT EXISTS lmr.type_check (
  id             bigserial PRIMARY KEY,
  type_key       text NOT NULL REFERENCES lmr.type (key) ON DELETE CASCADE,
  ord            integer NOT NULL,
  column_tested  text NOT NULL,                  -- lmr_area / zone / area / width / permissibility / derived:*
  says           text NOT NULL,                  -- 'lot area >= 450 m2' - the threshold is parsed from this
  UNIQUE (type_key, ord)
);

CREATE TABLE IF NOT EXISTS lmr.general (
  clause         text PRIMARY KEY,               -- '164(1)(a)'
  ord            integer NOT NULL,
  text           text NOT NULL,
  href           text NOT NULL,
  layer_keys     text[] NOT NULL DEFAULT '{}',   -- lmr tables read against the lot
  fail_where     text,                           -- narrows a layer to the rows that exclude
  unknown_where  text,                           -- ... and to the rows the data cannot decide
  lga_scope      text[],                         -- the clause only reaches these councils
  held_lgas      text[],                         -- ... and these are the ones we hold a layer for
  coverage       text NOT NULL CHECK (coverage IN ('full', 'partial', 'none')),
  caveat         text
);

CREATE INDEX IF NOT EXISTS lmr_type_requirement_type_idx ON lmr.type_requirement (type_key, ord);
CREATE INDEX IF NOT EXISTS lmr_type_check_type_idx       ON lmr.type_check (type_key, ord);

COMMENT ON TABLE lmr.type IS
  'Housing SEPP 2021 Chapter 6 housing forms. Authoritative: /lmr renders this and /api/lmr/types evaluates it.';
COMMENT ON TABLE lmr.type_requirement IS
  'Every clause Chapter 6 states for each housing form, tested or not, with the reason where not.';
COMMENT ON TABLE lmr.type_check IS
  'The requirements that reduce to a lot, with the phrase the threshold is parsed from.';
COMMENT ON TABLE lmr.general IS
  'Housing SEPP 2021 s 164(1): the land Chapter 6 does not apply to, each tied to the lmr layers that answer it; coverage none/partial is reported, never treated as clear.';
