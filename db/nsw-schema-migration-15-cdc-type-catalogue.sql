-- ════════════════════════════════════════════════════════════════════════════════════════
-- The CDC type catalogue: one authority for what each complying development code requires.
--
-- WHY THIS EXISTS
--
-- The same twelve codes were described in three places that could disagree with each other:
--
--   shared/cdc-criteria.ts          12 types, 97 requirements, 31 checks - GENERATED, and the
--                                   generator (scratchpad/gen_cdc.py) no longer exists, so the
--                                   file cannot be rebuilt from the workbook it came from
--   shared/cdc-type-corrections.ts  17 corrections, 9 of them rows where our own test contradicts
--                                   the clause it is cited against
--   shared/cdc-permissibility.ts    clause 1.18(1)(b): which land use each code turns on
--
-- /cdc rendered them; /api/cdc/types evaluated a parallel reading of the same thing. A page that
-- cites one rule while the route tests another is the worst failure available on a page whose
-- whole purpose is citations - and it nearly happened when 1.18(1)(b) was added.
--
-- This is the same pattern cdc.layers already proves for the general prerequisites: the rule set
-- is DATA, queryable and updatable without a redeploy, and both the page and the engine read it.
--
-- WHAT IS AUTHORITATIVE AFTER THIS
--
-- These tables. The shared/*.ts files become the seed for the first load and then stop being read
-- at runtime. `scripts/build-cdc-type-catalogue.ts` performs that load and is re-runnable.
--
-- Three tables rather than one, because the data is genuinely three-level: a code, the
-- requirements the instrument states for it, and the subset of those we can test against a lot.
-- "One source" means one authority, not one relation.
-- ════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS cdc;

-- ── the code itself ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdc.type (
  key               text PRIMARY KEY,
  name              text NOT NULL,
  code              text NOT NULL,          -- "Low Rise Housing Diversity Code"
  sheet             text,                   -- the Department workbook sheet it was read from
  inherits_general  boolean NOT NULL DEFAULT true,
  note              text,
  ord               integer NOT NULL,       -- declaration order, the tie-break when sorting
  -- clause 1.18(1)(b): every land-use term that satisfies the clause for this code. Empty means
  -- deliberately untested - no Standard Instrument term matches, and guessing one would put the
  -- least-evidenced type on the page behind the most confident answer.
  land_uses         text[] NOT NULL DEFAULT '{}',
  -- true where land_uses is an inference rather than the instrument's own term (manor houses)
  land_uses_inferred boolean NOT NULL DEFAULT false,
  checked_at        timestamptz NOT NULL DEFAULT now()
);

-- ── what the instrument requires, whether or not we can test it ─────────────────────────
CREATE TABLE IF NOT EXISTS cdc.type_requirement (
  id            bigserial PRIMARY KEY,
  type_key      text NOT NULL REFERENCES cdc.type (key) ON DELETE CASCADE,
  ord           integer NOT NULL,
  clause        text,
  text          text NOT NULL,
  sub_items     text[] NOT NULL DEFAULT '{}',
  href          text,                       -- into legislation.nsw.gov.au, at the clause
  data_source   text,                       -- the workbook's Data Source cell, verbatim
  sources       jsonb NOT NULL DEFAULT '[]',
  source_note   text,
  note          text,
  tested        boolean NOT NULL DEFAULT false,
  tested_by     text,                       -- the column in cdc.type_check that answers it
  -- a row where OUR rule contradicts the clause. The clause is cited correctly; the test is what
  -- disagrees. Nine of these, and they are reported on the page rather than quietly carried.
  diverges      boolean NOT NULL DEFAULT false,
  diverge_why   text,
  text_fix      text,                       -- a correction to the workbook's wording
  UNIQUE (type_key, ord)
);

-- ── the subset we can decide from a lot ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cdc.type_check (
  id             bigserial PRIMARY KEY,
  type_key       text NOT NULL REFERENCES cdc.type (key) ON DELETE CASCADE,
  test_key       text NOT NULL,             -- one code can have several variants (the inland sheet)
  test_name      text,
  ord            integer NOT NULL,
  column_tested  text NOT NULL,             -- lzn_sym_code / area_h / do_width / ...
  -- The requirement in the workbook's own words, parsed rather than re-encoded: "lot area >= 400
  -- m2". A change to the wording reaches the test without a second edit.
  says           text NOT NULL,
  UNIQUE (type_key, test_key, ord)
);

CREATE INDEX IF NOT EXISTS type_requirement_type_idx ON cdc.type_requirement (type_key, ord);
CREATE INDEX IF NOT EXISTS type_check_type_idx       ON cdc.type_check (type_key, ord);

COMMENT ON TABLE cdc.type IS
  'Complying development codes. Authoritative: /cdc renders this and /api/cdc/types evaluates it.';
COMMENT ON TABLE cdc.type_requirement IS
  'What each code requires, from the Department workbook, with the nine rows where our own test contradicts the clause.';
COMMENT ON TABLE cdc.type_check IS
  'The requirements that reduce to a lot, with the phrase the threshold is parsed from.';
