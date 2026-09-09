-- ─────────────────────────────────────────────────────────────────────
-- 10  Currency and commencement are two different dates
-- ─────────────────────────────────────────────────────────────────────
--
-- `as_at_date` is documented as "legal currency / consolidation date" — the
-- latest date the document we hold is current to. The DCP ingest was filling
-- it from the manifest's `commenced` and ignoring `as_at` entirely, so a plan
-- that has since been amended reported as current to the day it first began.
--
-- Hornsby DCP 2024 is the case that showed it. It commenced 18 July 2024 and
-- has been amended three times since — 26 August 2024, 19 May 2025 and
-- 23 June 2025 — and its own part footers read "THIS PART WAS LAST AMENDED ON
-- 23 JUNE 2025". The report said 2024-07-18: eleven months and three
-- amendments out of date, on a page a planner would quote from.
--
-- The two dates cannot share a column because they answer different
-- questions. "When did this plan begin?" fixes which applications it caught;
-- "what is it current to?" fixes whether our copy is the operative one. A
-- consolidated instrument needs both, so commencement gets its own column and
-- `as_at_date` goes back to meaning what its comment always said.
--
-- ── Why not a date from the department ───────────────────────────────
--
-- Because for a DCP there is not one. LEPs and SEPPs are on the NSW
-- legislation register, which publishes a machine-readable in-force date per
-- consolidation — that is where `as_at_date` on hornsby-local-environmental-
-- plan-2013 comes from, and why its source_url ends `/inforce/2026-04-07`.
--
-- DCPs are not. The department's only complete DCP index is
-- https://www.planningportal.nsw.gov.au/DCP, and it is a flat list of
-- `<a href>` titles with no date field of any kind — checked again on
-- 2026-09-09. It also lags council adoption badly: it still lists "Hornsby DCP
-- 2013 - 2019" and "Randwick DCP 2013 - as amended Apr 2016", both superseded
-- by the plans we actually hold. `up_property_d_3.dcp_plan_name` repeats that
-- same stale naming lot by lot, and has no currency column at all.
--
-- So the authority for a DCP's currency date is the instrument itself, read
-- and evidenced in its manifest (`as_at` plus `date_evidence`). `currency_basis`
-- records that reading in the row, so the report can say where the date came
-- from instead of presenting an inference as a fact.

BEGIN;

ALTER TABLE nsw.document
  ADD COLUMN IF NOT EXISTS commenced_date     DATE,
  ADD COLUMN IF NOT EXISTS currency_basis     TEXT,
  ADD COLUMN IF NOT EXISTS savings_provision  TEXT,
  ADD COLUMN IF NOT EXISTS pending_parts      TEXT[];

COMMENT ON COLUMN nsw.document.as_at_date IS
  'The latest date the version held is current to, as the source authority '
  'states it: the legislation register''s in-force date for an LEP or SEPP, '
  'the instrument''s own last-amended date for a DCP. Not the ingest date, and '
  'not commencement — see commenced_date.';

COMMENT ON COLUMN nsw.document.commenced_date IS
  'The day the instrument commenced. Fixes which applications it caught; '
  'as_at_date fixes whether our copy is current. Null where the source does '
  'not state one separately (LEP/SEPP consolidations).';

COMMENT ON COLUMN nsw.document.currency_basis IS
  'Where as_at_date came from, in words, so the report can attribute it. '
  'A DCP has no departmental currency date to cite (see migration 10 header), '
  'so this names the passage of the instrument that was read.';

COMMENT ON COLUMN nsw.document.savings_provision IS
  'Transitional rule the plan states for applications already lodged. Randwick '
  'DCP 2025 saves DAs lodged before 27 July 2026, which as at today is a live '
  'window — a report that names the plan without naming that tells a reader '
  'their application is assessed under controls that do not apply to it.';

COMMENT ON COLUMN nsw.document.pending_parts IS
  'Parts announced but not yet in the plan. Randwick DCP 2025 has five awaiting '
  'Stage 3, so silence on those topics is "not published yet", not "unregulated".';

-- Backfill: for DCPs, what is in as_at_date today IS the commencement date,
-- because that is the only thing the ingest ever wrote there. Moving it across
-- keeps the fact rather than discarding it, and `sync-doc-dates.mjs` then sets
-- as_at_date from the manifest's evidenced `as_at`.
--
-- Deliberately NOT applied to LEPs and SEPPs: their as_at_date is the
-- legislation register's consolidation date, which is a genuine currency date
-- and not a commencement. Copying it into commenced_date would assert that
-- Hornsby LEP 2013 commenced on 7 April 2026.
UPDATE nsw.document
   SET commenced_date = as_at_date
 WHERE doc_type = 'dcp'
   AND commenced_date IS NULL;

UPDATE nsw.document
   SET currency_basis = 'Commencement date, pending a currency date from the instrument manifest (scripts/sync-doc-dates.mjs).'
 WHERE doc_type = 'dcp'
   AND currency_basis IS NULL;

COMMIT;
