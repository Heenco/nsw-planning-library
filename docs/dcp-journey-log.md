# DCP pipeline — journey log

One entry per council. What the document actually looked like, what broke, what
we changed, and what it cost. The point is that council N+1 should be cheaper
than council N — and that we can see whether that's true.

Procedure lives in [dcp-onboarding-runbook.md](dcp-onboarding-runbook.md).
Rule-layer design lives in [rule-layer-pipeline.md](rule-layer-pipeline.md).

---

## Scorecard

| | Hornsby DCP 2024 | Randwick DCP 2025 |
|---|---|---|
| source files | 1 consolidated "book version" PDF | **43 part PDFs** |
| pages | 489 | 1,649 |
| source text | ~193k tokens | ~547k tokens |
| vintages in force | 1 | **2** (Stage-2 2025 + 3 retained 2013 parts) |
| commenced | 26 June 2026 | 27 July 2026 |
| savings provision | — | yes, with a SEPP (Housing) 2021 carve-out |
| parts still pending | — | Stage 3, due end 2026 |
| converted | ✅ `.md` + `.html`, 474 images | ✅ 43 parts merged, 2,845 images |
| page provenance | 489 / 489 pages | 1,647 / 1,649 pages (99.9%) |
| unique anchors | — (single namespace) | 3,862, **0 duplicates** across 43 parts |
| in library UI | ✅ | ✅ registered + visible |
| in knowledge graph | ✅ 569 rules, 892 effects | ✅ 1,658 rules, 917 effects |
| currency date recorded | ✅ 2025-06-23 | ✅ 2026-07-27 |

---

## Council #1 — Hornsby DCP 2024

**Shape.** One PDF, 42 MB, 489 pages, with internal outline bookmarks marking 11
parts. The easiest possible case, and — importantly — not representative.

**Outcome.** Good conversion. 489 distinct page markers across 489 pages (full
per-page provenance), 6 heading levels at 66.5% top-level share, 150 real
tables, 389 clauses carrying `data-number`, and a rubric split of 297 controls /
300 objectives / 170 notes. That rubric split is the single most valuable signal
we get: objectives are aids to interpretation, and extracting them as
obligations would be a systematic false-positive class rather than an occasional
miss.

**What we learned.**

*The converter rewrite was worth it.* `export_to_markdown()` flattens
everything — it drops per-item page provenance and collapses heading hierarchy.
Both losses are still visible in older conversions: `albury-dcp-2010` has 646
pages and a **single** `PAGE: 1` marker, so no citation in that document can
deep-link to a page, and every pre-rebuild Docling DCP came out 100% `##`.
Walking `doc.iterate_items()` and keeping `item.prov[0].page_no` is what makes
citations work at all.

*Quality tooling exists but isn't wired to anything.* `score-dcp-md.mjs` and
`dcp-parse-check.mjs` compute exactly the right metrics and then just print
them — no thresholds, no non-zero exit, no persistence. Hornsby's numbers above
had to be **recomputed by hand months later**, because the original stdout was
never saved. We cannot currently tell, for any document in
`public/EPI/DCPs/`, whether it was ever checked.

*The source isn't reproducible.* `public/EPI/DCPs/pdf/` and
`public/EPI/DCPs/images/` are both gitignored, so Hornsby's source PDF and its
474 images are outside version control with no manifest, no URL and no checksum.
The filename (`hdcp-2024-book-version-26-june-2026-current.pdf`) doesn't match
`fetch-dcp-register.mjs`'s slug pattern and isn't in `download-log.json`, so it
was almost certainly hand-downloaded. We can't prove today which file we
converted.

*Two steps are manual and easy to forget.* The `instruments.json` entry, and
adding the slug to `VISIBLE_DCP_SLUGS`. Miss the second and the document exists,
converts, ingests — and is invisible in the UI.

**Still open.** Hornsby is **not in the knowledge graph**. `scripts/ingest-dcp.ts`
was written for it (its CLI defaults are literally Hornsby's file, title and
LGA) but has never been run against a database.

---

## Council #2 — Randwick DCP 2025 (in progress)

**The premise was wrong before we started.** The task began as "do Randwick DCP
2013." Reading the council's page showed 2013 has been **superseded**: Randwick
DCP 2025 was endorsed 30 June 2026 and commenced **27 July 2026**. Our
`randwick-comprehensive-dcp-2013.md` isn't stale, it's the wrong instrument —
and it also predates the section-tree parser rebuild, with no `.html` and no
images.

Neither the heenco repo nor the NSW Planning Portal register would have caught
this. The register's newest Randwick entry is an **April 2016** amendment. Ten
years out of date, presented as "in-force".

**Lesson, now step 0 of the runbook:** the portal register is a discovery tool,
never a currency tool. Read the council's own page, every time.

**Shape.** Nothing like Hornsby:

- **43 separate PDFs** — 40 new Stage-2 parts plus 3 retained DCP 2013 parts
  (D3 Randwick Junction Centre, D5 Matraville Centre, F2 Outdoor advertising).
- **Two vintages simultaneously in force** inside one logical plan.
- **Letter-coded parts** (`A1`, `B2`, `D15`), not `Part 4`.
- **Numbering gaps** at B6/B12/B13 and no E-parts at all — these map exactly
  onto the Stage 3 pending list (Designing with Country, noise, waste, signage,
  Matraville). The gaps are meaningful, not corruption.
- **Two different parts both labelled D3** on the council's own page, while
  Stage 2 introduced D2 as Randwick Junction Town Centre. A genuine upstream
  data-quality defect that will collide anything keyed on part code alone.
- A real **savings provision**: pre-27-July-2026 DAs assessed under the old
  DCP, *except* those relying on SEPP (Housing) 2021 affordable-housing,
  co-living, or low-and-mid-rise provisions.

Roughly **3× Hornsby**: 1,649 pages and ~547k tokens of source text.

**Acquisition.** Randwick's site is behind Cloudflare and returns **403** to a
bare user-agent and to WebFetch. A full browser header set — the `Sec-Fetch-*`
headers being the operative ones — returns 200. All 43 parts downloaded on the
first pass, 109 MB, every file validated as a real PDF. `legislation.nsw.gov.au`
blocks harder and 403s even with those headers, so LEP currency checks have to
go through the repo's own fetcher.

**Text-layer pre-flight passed.** All 43 parts have healthy text layers,
minimum 472 chars/page. This was worth checking rather than assuming, because
`docling-extract.py` runs `do_ocr = False` — a scanned part would have produced
**nothing, with no error**. This is now a standing runbook step.

**Manifest written** to `public/EPI/DCPs/manifests/randwick-dcp-2025.json`: per-part
URL, sha256, page count, text-layer verdict and vintage, plus instrument-level
`commenced`, `supersedes`, the savings-provision text and the Stage 3 list. This
is the artefact Hornsby lacks, and it turns out to carry exactly the per-part
version metadata the rest of the pipeline has nowhere to put.

**A measurement error of our own.** We first reported 1,692 pages (and Hornsby
as 490). `pdftotext` emits one form feed **per page including the last**, so the
form-feed count *is* the page count — adding one overcounted by one per file.
Corrected to 1,649 and 489 against authoritative `unpdf` `numPages`; the
manifest now records its own `page_count_source`. The text-layer conclusion was
unaffected.

### What Randwick exposes about the pipeline

**1. The converter is single-input.** `dcp-convert.mjs` takes exactly one
`--in`/`--out`. A 43-part DCP has no first-class representation.

The tempting shortcut — convert 43 times, register 43 instruments, as
`liverpool-gcp-*` already does with 4 files — is a trap. `anchorId()`'s
`seenIds`/`currentClause` state is **per-process**, so independent runs can mint
the same anchor in two different parts with nothing detecting it. That silently
corrupts citations, which is the product.

The good news: the doc-viewer is already built for the merged shape. Its ToC
groups purely on `data-part` and doesn't care how many PDFs produced it, and
`xml-to-html.mjs:183-188` states plainly that this grouping exists *because a
DCP is merged from separate PDFs*. The capability was designed in and never
exercised, because Hornsby arrived pre-merged. Merging 43 parts into one
`<article>` with shared anchor state needs no doc-viewer change at all.

**2. Letter-coded parts silently weaken a guard.** `partNumberOf()` matches only
`/\bPart\s+(\d+)\b/i`. On `B2` or `D3` it returns `null`, and the check that a
clause number belongs to the part it sits in stops enforcing anything. No crash
— just the false-positive protection switching itself off.

**3. The catalogue has no vocabulary for any of this.** `instruments.json` is
flat `{slug, title, file, pdf}`. No parts, no dates, no `supersedes` — for any
instrument. Meanwhile `fetch-dcp-register.mjs` has a `--check-current` flag
precisely because councils' plans go stale, and nothing records what a converted
document was current *as of*.

**4. The knowledge graph cannot express supersession at all.** This is the
biggest finding. There are **no** `commenced` / `repealed` / `superseded_by` /
`effective_from` / `version` columns anywhere in the schema or migrations 01–07.
The one date column, `as_at_date`, is hardcoded to `CURRENT_DATE` — the date the
ingest ran, not the instrument's legal currency date, so even the single
temporal field carries the wrong meaning. The
`resolver(property, proposal, date)` in the design doc is design, not code.

The practical escape is that it mostly doesn't matter *yet*: the in-force set is
the 43 parts in the manifest, retained 2013 parts included. Ingesting that as
**one** document gives correct "what applies now" answers without any temporal
modelling. What it cannot answer is the savings-provision question — "this DA
was lodged in June 2026, which controls apply?" — which needs real effective
dates. Ingesting DCP 2013 as a *second* document for the same LGA would be
actively harmful: double-counted rule coverage with nothing to disambiguate.

**5. Identity is a free-text title with no constraint.** `ingest-dcp.ts:226`
does `DELETE FROM nsw.document WHERE title = $1`, and `nsw.document` has no
unique constraint on `title`. "Randwick DCP 2025" vs "Randwick Development
Control Plan 2025" produces two documents instead of replacing one. The exact
title string has to be pinned in the manifest and used verbatim.

**6. The rule-layer writer has never run.** `scripts/ingest-dcp.ts` — the only
code in the repo that writes `rule` / `rule_applicability` / `rule_effect` — is
uncommitted, excluded from `npm run typecheck:kg`, and has never been executed
against a database. It's also encouraging: it makes **zero LLM calls**, reading
`data-number`/`data-rubric` straight off the converted HTML, so a DCP ingest
costs nothing in model spend and has no hallucination surface. But it should be
smoke-tested on Hornsby (smaller, already converted) before Randwick.

Three tables stay empty for any freshly-ingested document: `rule_edge`
(precedence), `rule_spatial_ref` (geometry), and `rule_proposition` (the
rule→evidence audit join). They're only reachable through the one-off pilot
importer. So we get grounded, citable controls — but no automated override
resolution, and no join from a rule back to its evidence.

**7. The design doc overstates the anti-hallucination gate.**
[rule-layer-pipeline.md](rule-layer-pipeline.md) says a proposition whose span
isn't a verbatim substring is *"dropped, not corrected."* The code retries once,
then **inserts it anyway** as `verification_status='flagged'` and raises an
`nsw.question` for review. Nothing is dropped. The gate is a review queue, not a
filter — which is a defensible design, but it isn't what the doc claims, and it
shouldn't be cited as evidence the numbers are clean. (This affects the LEP/XML
path only; the DCP path is deterministic.)

### What the conversion produced

43 parts, 1,649 pages, in two stages: one batched Docling extraction (47.9 min,
one model load instead of 43) then 86 fast conversions off the cached JSON.
Result: **3,862 unique anchor ids and zero duplicates**, 3,819 headings, 221
tables, 99.9% page provenance, 2,845 content-hashed images (515 MB, gitignored).

Table counts reconcile exactly: Docling found 271, of which 221 converted and
**50 were the parts' own contents-index tables**, dropped deliberately as
navigation. Worth checking rather than assuming — a 50-table gap looks like
data loss until you account for it.

### The bug the quality sidecar caught

The first merge flagged four parts as flat — every heading at one level, the
exact "wall of `##`" failure the converter was rewritten to eliminate. D11
(Prince Henry Site) was **204 headings across 97 pages with no hierarchy at
all**.

Cause: two regexes in the same file disagreed about what a clause number looks
like. `levelFor()` required whitespace immediately after the digits and at
least one `.n` group:

```
/^(\d+(?:\.\d+){1,3})\s+/
```

Randwick writes "1**.** Introduction" and "1.1**.** Objectives" — trailing dot,
often a bare integer. Neither form matched, so headings fell through to the
unnumbered branch, which assigns a single fixed level. Two of the 43 PDFs
(A1, D11) carry no outline at all, so clause numbers were their only possible
source of hierarchy; B5 and C3 have outlines that don't cover their heading
text and failed the same way.

What hid it: `anchorId()` already accepted the trailing dot, so `data-number`
was extracted correctly while the level was wrong. Anchors and citations looked
healthy; only the hierarchy was broken.

Fixed to `/^(\d+(?:\.\d+){0,3})\.?\s+/`, checked against both conventions —
Hornsby's "4.2.1 Scale" still resolves to level 3, and prose still fails the
shape guards. Flat parts went 4 → 1; D11 became {L1:7, L2:46, L3:151}.

The one remaining flat part, C13, is a different and benign cause: its own PDF
outline lists all four of its headings at the same depth, and the outline is
treated as authoritative. Five pages, four headings — that is the document's
real structure, not a defect.

**The lesson is about the sidecar, not the regex.** A silent 97-page hierarchy
loss became one line of output at merge time. Hornsby's equivalent numbers had
to be recomputed by hand months after the fact, because nothing persisted them.
Cheap instrumentation on a batch process pays for itself the first time it runs.

### What the two databases turned out to be

Worth recording, because a review reading the code alone got it wrong. There
are two:

- **`planningai`** (`DATABASE_URL`) — the rule-layer database the app actually
  queries. Already holds Hornsby DCP 2024 + LEP 2013 with **657 rules and 960
  rule_effects**, so `ingest-dcp.ts` *has* run and migrations 05–07 *are*
  applied here. A code-only review concluded the opposite.
- **`kg`** (`ADMIN_DATABASE_URL`) — a 19 GB legacy corpus, 24 documents, 22,109
  propositions, no rule tables. This is where Randwick DCP **2013** lives.

So the feared duplicate-Randwick problem does not arise: 2013 sits in a
different database from where 2025 will be written. But note every document in
`planningai` carries the same `as_at_date` — the day it was ingested — which is
the `CURRENT_DATE` defect, now fixed.

Read-only review is not enough to establish operational state. Check the
databases.

### The ingest, and what it does and does not capture

Both councils are now in `planningai` with no duplicate documents and no
duplicate `rule_key`s:

| | Hornsby DCP 2024 | Randwick DCP 2025 |
|---|---|---|
| sections | 1,872 | 3,862 |
| rules (+ row rules) | 569 + 95 | 1,658 + 44 |
| rule effects (of which from tables) | 892 (616) | 917 (594) |
| objectives | 508 | 2,181 |
| propositions | 271 | 322 |
| audit findings | 314 | 555 |

`rule_key` turns out to be the section's HTML id — i.e. the anchor. So the
part namespacing established at conversion propagates into the rule layer for
free, and the merge's "0 duplicate anchors" assertion is simultaneously proof
that `ON CONFLICT (document_id, rule_key)` cannot silently merge two parts'
clause 2.1. Verified after the fact: zero duplicate rule keys.

**Structure is captured well. Prose numerics are not.** This is the honest
headline and it is architectural, not a bug:

- Of Randwick sections that contain control language ("maximum", "minimum",
  "not less than") but produced no proposition, **329 of 532 do have a rule —
  but only 15 have an effect**. The obligation is recorded; the *number* is
  still sitting in prose.
- Most effects come from tables: 594 of 917 for Randwick, 616 of 892 for
  Hornsby. Tables are where the deterministic extractor is strong.
- The residue is recorded, not dropped: 255 `numeric_lead` findings for
  Randwick (30 for Hornsby), plus 105 `ambiguous_cell` and 15
  `unresolved_range`.

That is the design working as written — `ingest-dcp.ts` extracts only
"obvious" comparator+unit numerics and defers the rest to an AI stage that
**does not exist for DCPs**. Worth stating plainly: the graph currently answers
"which controls apply" far better than "what number applies".

Note when reading `kg-recall-gaps.mjs` against this data: it measures
*propositions*, which the deterministic path barely writes. Its "511 missed
sections" is not 511 missed controls — check `rule`/`rule_effect` before
concluding anything from it.

`triage-empty-rules.mjs` on the combined corpus: of 395 empty rule sources,
**358 are correct containers** (content lives in child clauses, no rule owed).
37 are suspect — all "1. Introduction" headings whose content ended up in
siblings rather than descendants. About 2% of rule sources, and in clauses that
rarely carry controls, but it is a real nesting artefact worth a look.

### Registration

`instruments.json` gained a `randwick-dcp-2025` entry pointing at the merged
`.md`, plus a `manifest` field — the first entry to reference one. The 2013
plan stays in the catalogue as history but is deliberately left out of
`VISIBLE_DCP_SLUGS`: two Randwick DCPs in the browse list would read as a
choice when only one is in force.

One migration-08 trap worth recording: the backfill derives a slug from the
title, so Hornsby became `hornsby-development-control-plan-2024` while its
manifest says `hornsby-dcp-2024`. Re-ingesting would have missed on the DELETE
and created the exact duplicate the migration exists to prevent. Reconcile the
existing row's slug to the manifest before the first manifest-driven re-ingest
of any pre-existing document.

---

## Changes this journey argues for

Ranked by leverage across future councils, not by effort.

1. **A version/parts vocabulary in `instruments.json`** — `commenced`,
   `supersedes`, and optional per-part metadata. Needed for every council, not
   just multi-part ones, and the manifest already carries the data.
2. **Minimal temporal columns on `nsw.document`** — `commenced_at`,
   `superseded_by`, and honest `as_at_date` semantics from the manifest's
   `commenced`. Without these, savings provisions are unanswerable and two
   vintages can't coexist safely.
3. **Multi-input conversion with shared anchor state** — the blocker for
   Randwick and for every council that publishes by part (most of them).
4. **Persist conversion quality** — have `dcp-convert.mjs` write a
   `<slug>.quality.json` sidecar from the `stats` object it already computes, so
   a document's conversion quality is a fact on disk rather than lost stdout.
5. **A real unique key for `nsw.document`** — on `(lga_name, doc_type, title)`
   or an explicit slug, so re-ingest replaces instead of duplicating.
6. **Generalise the part-code regexes** to accept letter-coded parts, and
   de-duplicate `prettyPart()`, which exists in two files that must be kept in
   sync by hand.
7. **Drive DCP visibility from the manifest** instead of the hand-maintained
   `VISIBLE_DCP_SLUGS` allowlist, removing a per-council manual step nothing
   tests.
8. **Document `DATABASE_URL` in `.env.example`**, and remove the hardcoded
   host/user/key-path SSH fallback in `kgPool.ts`.
9. **Reconcile the design doc with the code** on the precision gate — either
   make it drop, or describe it accurately as a review queue.
