# SEPP rule pipeline — progress

Working memory of the `/loop` building [sepp-rule-pipeline.md](sepp-rule-pipeline.md). **Every pass
reads this file first and updates it last.** One step per pass; a step is only ticked when its
"done when" check has been run and its numbers are written below it.

## How the loop works

1. Read this file. Take the first step that is not `done` and not `blocked`.
2. Do it. Run its "done when" check. Write status, numbers and findings under the step.
3. Commit (code + this file). Push only what does not change what production serves, unless a
   standing permission below allows it.
4. If the step needs a decision that is Manni's, write it under **Open questions**, mark the step
   `blocked`, and stop the loop.
5. Stop when every step is `done`.

## Standing decisions (defaults taken 2026-10-07; Manni can override here)

| # | decision | default | status |
|---|---|---|---|
| D1 | Source text | start from the library copy (XML `epi-2021-0714_2026-03-23.xml`, amended to 2026 (33)); refresh when Manni saves a newer in-force XML | default |
| D2 | Schema | extend `nsw.rule` / `rule_applicability` / `rule_edge` (additive migrations), no separate SEPP schema | default |
| D3 | Frames | hand-written by Claude in `profiles/*.yaml`, reviewed by Manni in this file | default |
| D4 | First target | Housing SEPP Ch 6, answer key = `lmr` catalogue + Bambara | default |
| D5 | Database writes | allowed: new rows and additive columns in `nsw.*`; anything that changes existing rows other than this pipeline's own is a stop | default |
| D6 | Publishing | SEPP rules are written with a `held` publish state and are invisible to existing app routes until the step 10 gate passes; no prod push of app changes without asking | default |

## Baseline (2026-10-07)

- SEPPs in the graph: 10, sections only, **0 rules**. Housing SEPP 2,650 sections, as at 2026-04-06.
- LEP map references resolved: **1,646 / 2,235 (74%)**, up from 706 / 1,870 (38%) after the
  resolver fixes (commits cbd2de4, 5fd6adf, 87bab62). 353 refs added, logged in `nsw.rule_spatial_ref_added`.
- Test lots: Bambara (100096265) LEP untestable 57 / 271; Park Ave Chatswood (102111896) 33 / 150.
- Known hand-built error to correct via the pipeline: `lmr` dual-occupancy type requires the LMR area
  for permissibility; s 166 does not (only s 167–169 standards do).

## Steps

### 1. Register sources — `done` 2026-10-07
Seed `nsw.source_registry` for the 10 SEPPs (and the LEPs already loaded) with raw_path, as_at_date,
content_sha256. Add `last_ingested_sha256`, `last_ingested_at`.
**Done when:** every SEPP document in `nsw.document` has an enabled registry row whose hash matches the
file on disk, and a query lists which instruments are newer on disk than in the graph.

**Result:** migration 17 applied (`db/nsw-schema-migration-17-sepp-pipeline.sql`: registry
`document_id` / `last_ingested_sha256` / `last_ingested_at`; `section.content_sha256`; `rule.publish_state`
(existing rows `published`) / `valid_from` / `valid_to` / `frame_rule_id`; widened `kind` (+frame, condition),
`dimension` (+defined_area, lga, proponent, proposal_metric, pathway), `effect_type` (+relative_numeric,
nondiscretionary_numeric, condition_of_consent)). `scripts/pipeline/registry.ts` upserted 55 sources:
**10/10 SEPPs PASS** (enabled, linked, hash = file). 45 `due` (pipeline has never recorded a build), 1
`missing` (sydney-lep XML not on this machine), 9 `unloaded` (DCP registry titles don't match the graph's).
Findings: `hornsby-dcp-2024`, `randwick-dcp-2025` are in the graph with no registry row;
`scripts/seed-source-registry.ts` fails on this machine (kgPool wants an SSH key at an old path) — the
new script replaces it for the pipeline.

### 2. Load text with section hashes — `done` 2026-10-07
Add `section.content_sha256`; backfill for the 10 SEPPs; reload Housing SEPP from the registered XML if
its hash differs.
**Done when:** every SEPP section has a hash; Housing SEPP section count and as-at match the XML.

**Result:** `scripts/pipeline/sections.ts` re-parses each registered XML with the stage 0 parser and
compares section by section (sha256 of normalised heading + text). **All 10 SEPPs MATCH: 20,712 / 20,712
sections identical** (Housing 2,650, Codes 7,154, T&I 5,567, B&C 1,510, PS 1,363, I&E 780, R&E 621, PP 477,
R&H 335, SB 255) - no reload needed. Hashes written for all 20,712; registry `last_ingested_sha256` set, so
all 10 SEPPs now read `current`; one `ingest_run` per SEPP (`stage_metrics.step = 2`). Graph `as_at_date`
2026-04-06 for all; source XMLs dated 2026-03-22..26 (D1 - still the library copy).
Finding: `ingest_run.status` only allows running/success/failed, so drift is recorded as `failed` with
`stage_metrics.outcome`.

### 3. Housing SEPP profile, Ch 6 frames — `done` 2026-10-07 (frames reviewed: "frames OK")
`profiles/housing-sepp-2021.ts`: rank, s 8 prevails, Ch 6 frame (s 164 reach + 13 exclusions), the
nested LMR-area frame (s 163 for s 167–176), signals, terms. Write frames to `nsw.rule` (role `frame`).
**Done when:** every Ch 6 operative section is under exactly one frame; Manni has reviewed the frames
(Open questions).

**Result (2026-10-07):** profile written as a typed TS module (not YAML: no new dependency; same
pattern as `lmr-criteria.ts`). `scripts/pipeline/frames.ts` wrote 3 frames, all `held`, rank 30:
`instrument` (s 8(1), `prevails_over` doc_type:lep and doc_type:dcp) → `ch6` (s 164(1): pathway DA +
17 exclusion conditions (a)–(m), valid from 2025-02-28) → `ch6-lmr-area` (s 163 defined area).
Coverage **PASS**: 172 sections under ch.6, 0 with no frame, 0 ties; s 162–166 → `ch6` (59 sections),
s 167–180 → `ch6-lmr-area` (113). Existing 6,856 rules still `published`.
Findings: `/graph` coverage counts all rules per document, so the Housing SEPP's count shows 3 (held
frames) - a statistics-only change; `rule_edge.scope` is jsonb.

### 4. Route sections — `done` 2026-10-07
**Done when:** every Housing SEPP section has a route; Ch 6 signals found: permission (s 166, 170, 174),
override (s 169(1A)), non-discretionary (s 168, 169, 172, 173, 179, 180).

**Result:** migration 18 (`section.route`, `signals`, `routed_at`); `scripts/pipeline/route.ts`
(deterministic, no model). Housing SEPP **2,650 / 2,650 routed**: operative 1,506, schedule 734, empty
209, structural 64, objective 56, savings 47, definition 34; 0 oversize; 101 sections carry a signal.
Ch 6 rolled up to clause - **PASS**: permission s 166/170/174; override s 169, 173 (the (1A) subclauses);
non-discretionary s 165, 168, 169, 172, 173, 179, 180; consideration s 167, 171, 177; prohibition
("must not be granted") s 175, 176, 177; disapplication s 178. Whole instrument: permission 9 clauses,
override 3, non-discretionary 16, consideration 11, prohibition 41, disapplication 1.
Finding: clause rows are often empty (s 168) - their words are in subclauses/paragraphs, so step 5 must
extract at subclause/paragraph level and roll up to the clause's rule.

### 5. Extract Ch 6 rules — `done` 2026-10-07
**Done when:** recall gate passes on Ch 6 (every number in operative text claimed or explained);
s 168's 450 m², 12 m, 0.65:1, 9.5 m, 1 space extracted with spans.

**Result:** `scripts/pipeline/extract.ts` - deterministic, importing the shared readers
(`findNumberCandidates`, `topicOf`/`datumOf`, `matchLandUses`) so extraction and the recall gate use one
detector. Ch 6 → **23 held rules, 114 applicability rows, 44 effects**, every rule with a frame
(`frame_rule_id`). **Recall gate PASS: 37/37 numbers claimed, 0 gating findings; span gate PASS; s 168
5/5** (lot_size gte 450 sqm, width gte 12 m @front_boundary, parking gte 1/dwelling, fsr lte 0.65,
height lte 9.5 m). Kinds: 3 permission (s 166, 170, 174 → 5 `permits_use`), 3 matters (s 167, 171, 177 →
Tree Canopy Guide), 1 disapplication (s 178 → lot_size, width, "meets s 180(2) or (3)"), 16 standard.
Sub-rules where a subclause narrows its own standards: s 172(2) multi dwelling housing vs (3) terraces;
s 175(2) RFB vs (3) shop top (storeys lte 6 if height ≤ 22 / 24 m); s 180(2) inner (2.2:1; 22 m RFB,
24 m shop top) vs (3) outer (1.5:1, 17.5 m). s 169/173: dev_type subdivision, temporal "on or after
28 February 2025", excludes strata subdivision.
Findings (non-gating, open in `audit_finding`): 3 `qualitative_requirement` (s 169(3)(c),(e), s 173(3)(c):
"lawful access and frontage to a public road", "not a battle-axe lot" - need a non-numeric requirement
effect kind); 1 `comparator_inferred` (s 173(3)(b) "must be 6m wide" read as gte).
Reader quirks fixed in the extractor, not the readers: zones written "Zone R3 … or R4 …" (second code has
no "Zone"); `matchLandUses` keeps only the longest match ("multi dwelling housing (terraces)" swallowed
"multi dwelling housing" in s 171) - read per or/and segment. Parking effects keep their condition ("if
no EPI or DCP specifies a maximum…") in the span only - the evaluator must read it (step 9).

### 6. Permissions and overrides — `done` 2026-10-07
**Done when:** s 166 / 170 / 174 are permission rules; s 8 and s 169(1A) are `prevails_over` edges to
`lep`; the Bambara conflict (s 166 vs Parramatta 6.11(1)) is representable.

**Result:** `scripts/pipeline/edges.ts` turns routed signals into edges owned by their rule. Housing SEPP
now has **8 edges**: s 8(1) instrument frame `prevails_over` doc_type:lep + doc_type:dcp (step 3);
s 169(1A) and s 173(1A) `prevails_over` doc_type:lep + doc_type:sepp ("despite the provisions of another
environmental planning instrument" - a DCP is not an EPI); s 178 `disapplies` doc_type:lep + doc_type:dcp,
scope {topics: lot_size, width; when: meets s 180(2) or (3)}. s 166 / 170 / 174 are permission rules
(step 5). **PASS**, and the motivating conflict is representable:
`Housing SEPP s 166 permits "dual occupancy" (frames 164(1) <- 8(1)) vs Parramatta LEP 2023 cl 6.11(1)
withholds consent for "dual occupancies" on area_label D (Dual Occupancy Prohibition) -> resolved by s 8(1)
prevails_over doc_type:lep`.
Findings for step 9: (1) LEP rules store a "consent must not be granted" clause as kind `standard` with
`land_use … excludes` + `act=development consent excludes` and no effect - the evaluator must read that
shape as a prohibition; (2) land-use vocabularies differ (LEP "dual occupancies", readers "dual occupancy")
- `landUseKey()` in edges.ts normalises plural/singular; the evaluator should use the same function.

### 7. Defined terms — `done` 2026-10-07
**Done when:** every term the Ch 6 profile uses has a `scope_layer` row or a `scope_layer_gap` row
(164(1)(f) flood prone land is a known gap).

**Result:** term mappings are data in the profile (`profile.terms`, type `TermMapping`);
`scripts/pipeline/terms.ts` upserts them into `nsw.scope_layer` and MEASURES each from its source (as
`seed-scope-layers.mjs` does) rather than trusting it. Migration 19 widens `nsw.scope_layer_gap` to the
SEPP dimensions (defined_area, map_area, lga). **19 mappings, PASS: 0 used values without a row, 0 mappings
measuring 0 features.** Registry-backed (lmr.layers): bush fire prone land 269,248; coastal vulnerability
area 10; coastal wetlands 5,752 (littoral rainforests not in the layer - partial); heritage item 39,217;
flood planning area 634 (164(1)(g); Clarence Valley only of the 23 councils); ANEF 25 / ANEC 20 = 100
contours with `lmr_verdict = 'excluded'`; Chapter 5 land 9,562; Schedule 12 800 m 8; Accelerated TOD 8;
LMR exclusion area 4. Derived: 200 m pipelines 1,849 (gas + oil buffers); the 4 s 164(1)(e) councils via
`derived.lot_lga` (SEPP "City of Blue Mountains" = lot_lga "BLUE MOUNTAINS"); LMR area / inner / outer
from the station + town-centre walking catchments (342 / 171 / 171). **One recorded gap:** 164(1)(f)
flood prone land in the Georges River / Hawkesbury-Nepean catchments (outlines held, flood prone land not).
Not registered (read natively by the evaluator): zone, land_use, pathway, dev_type, temporal.
Finding: `lmr.layers.table_name` is sometimes schema-qualified ("lmr.airport_noise") - the first
measurement read 0 because of it; caught by the 0-features check.

### 8. Spatial refs for SEPP rules — `done` 2026-10-07
**Done when:** every Ch 6 map reference resolved or listed as a gap.

**Result:** Ch 6 names exactly **3 maps**, all resolved through the step 7 registry, none needing
`rule_spatial_ref`: Town Centres Map (s 163, inside the "low and mid rise housing area" definition →
`defined_area` via the town-centre walking catchments); Accelerated TOD Precincts Rezoning Areas Map
(s 164(1)(l) → `map_area` → `lmr.layers:sepp_tod_accelerated_precincts`, 8 features); Low and Mid Rise
Housing Exclusion Map (s 164(1)(m) → `lmr.layers:sepp_lmr_exclusion_areas`, 4). Ch 6 rules carry no
`area_label` / `site_ref` values, so `rule_spatial_ref` correctly has 0 Housing SEPP rows. The LEP-side
resolver (`resolve-map-refs.mjs`, fixed this week: 1,646 / 2,235 LEP refs) stays the tool for labelled map
areas when later chapters (e.g. Ch 3 Pt 5 seniors, Ch 2 Div 1 bonus maps) introduce them.

### 9. Lot evaluator across instruments — `done` 2026-10-07 (local commit; push awaits Q2)
`/api/rules/at?cadid=&use=` — frames that reach the lot, permissions vs prohibitions with `prevails_over`
deciding, standards and bonuses, controlling instrument named.
**Done when:** Bambara returns "dual occupancy: permissible with consent — Housing SEPP s 166, prevails
over Parramatta LEP 2023 cl 6.11(1) by s 8"; LEP standards (4.1C) apply because the lot is outside the
LMR area.

**Result:** `server/api/rules/at.get.ts` (`/api/rules/at?cadid=&use=`), generic - it reads frames, edges and
`scope_layer` as data and names no instrument. Steps: lot (zone by largest share, council, area, frontage) →
SEPP frames tested condition by condition through `scope_layer` (lot shrunk 10 cm, each table's own
geometry column + SRID, registry filter AND term filter) → SEPP permissions/standards whose frame chain
reaches the lot in its zone and defined area → LEP Land Use Table + LEP rules withholding consent (tested
through the plan's resolved map refs; rows within a dimension OR'd, proposal dimensions reported as
assumptions) → conflict decided by a `prevails_over` edge on the permission's frame chain.
**Bambara (100096265), use "dual occupancies" - PASS:** `dual occupancies: permissible with consent — State
Environmental Planning Policy (Housing) 2021 s 166, prevails over Parramatta Local Environmental Plan 2023 cl
6.11(1) by s 8(1)`, with the "confirm with the council" caveat. Frames: 8(1) reaches, 164(1) reaches,
163 (LMR area) does not → no Ch 6 standard applies; **LEP cl 4.1C(2) applies: lot_size gte 600 sqm,
frontage_width gte 15 m** (assumes a residential proposal). ~2 s.
Fixes found by running it: `lmr.bushfire_prone_land` stores its geometry in `geometry`, not `geom` (the
evaluator now reads `geometry_columns`); the registry's own filter was not being applied; LEP rule rows
within one dimension are alternatives (zones R2/R3/R4) and were being AND'd. **Migration 20**
(`scope_layer.upper_bound`): a source that is a superset of its term - s 164(1)(f)'s flood prone land is not
held, but both catchment outlines are, so a lot outside both is clear and a lot inside either is undecided
(the 164(1)(f) term now tests against the 2 outlines; `scope_layer_gap` lists no Ch 6 gaps).
`shared/land-use-key.ts` now holds `landUseKey` for both the edges step and the evaluator.

### 10. Answer keys — `done` 2026-10-07 (local commit)
`tests/answer-keys/housing-sepp-2021.json` with the §6 lots; harness compares `/api/rules/at` with the
keys and with `/api/lmr/types`.
**Done when:** 100% agreement or every disagreement explained (including the `lmr` dual-occupancy error).

**Result: 10/10 cases pass; 2 disagreements with the lmr catalogue, both explained with a clause.**
`tests/answer-keys/housing-sepp-2021.json` (10 cases, 9 lots) + `scripts/pipeline/answer-keys.ts`
(`--base` for prod, `--record` writes unexplained failures as gating `audit_finding` rows, detail `step10`).
Cases: Bambara (s 166 over Parramatta 6.11(1), LEP 4.1C 600 m²/15 m); R2 inner dual occ / multi dwelling /
RFB (s 168, 172(2), 179 values); R2 outer dual occ; R3 inner RFB (s 180(2) 2.2:1 / 22 m, s 175 6 storeys,
NOT s 180(3)); R3 outer RFB in Willoughby (s 180(3) 1.5:1 / 17.5 m, NOT s 180(2)); R3 outer in Campbelltown
(164(1)(f) undecided); heritage 164(1)(d) and bush fire 164(1)(a) exclusions.
Explained lmr disagreements: (1) Bambara - lmr requires the LMR area for dual occupancy, s 166 does not
(the known lmr error); (2) Campbelltown 153020495 - lot is in the Georges River catchment, 164(1)(f) flood
prone land is not held, so Ch 6 is undecided; lmr.lot_lmr records nothing undecided and says eligible.
**Bugs the keys found, fixed:**
- Outer-area standards applied to inner lots: the 800 m catchment polygons contain the 400 m ones.
  **Migration 21** `scope_layer.except_term`; the outer-area term excepts the inner-area term, and the
  evaluator tests it (`termHolds`).
- An undecided SEPP permission that would prevail over the LEP was reported as the LEP's "prohibited". It is
  now `permissible: null`, and the wording names the undecided frame condition.
**De-hardcoding (Manni asked "are we hardcoding the rules?"):** the extractor had the Ch 6 defined-area names
as regexes and a skip list of s 164/165; steps 4-6 had Housing SEPP expectations in their done-when checks.
All moved into the profile (`terms` defined_area, `skip`, `checks.route/extract/edges`). Extraction output
is byte-identical before/after; steps 4-6 still PASS. `scripts/pipeline/*` and `/api/rules/at` now name no
instrument and no clause outside comments.

### 11. Coverage and visibility — `done` 2026-10-07 (local commit)
**Done when:** `/graph` shows SEPP rule coverage; `/testing-spatial-services` has a "SEPPs for this lot"
section reading `/api/rules/at`.

**Result:** both shown in the dev server (Playwright screenshots of each).
- `/api/rules/sepp-coverage` (~0.5-1 s) - per SEPP: source current/due, sections hashed/routed, chapters (parts
  where a SEPP has none - the Codes SEPP has 44) holding at least one pipeline rule, frames, rules by
  publish_state, numeric effects, edges, place terms mapped/unmapped, open findings, latest run per step and the
  latest answer-key run. `answer-keys.ts --record` now writes an `ingest_run` (step 10) for it.
- `/graph`: new "SEPP rule pipeline" table under the document table. Today: Housing 1/7 chapters (ch.6),
  2,650/2,650 sections routed, 3 frames, 23 held rules, 34 values, 8 edges, 19/19 terms mapped, answer keys
  10/10, 4 findings to review (0 gating); the other 9 SEPPs current, hashed, 0 rules.
- `/testing-spatial-services`: "SEPPs for this lot" (`app/components/SeppRulesForLot.vue`, nav entry
  `sepp-rules`): a land-use picker fed by `/api/rules/uses` (the uses the rule layer names - no list in the
  page), verdict, frames with each condition tested, SEPP permissions/standards, LEP Land Use Table,
  consent-withholding clauses and standards.
- Only my two hunks of `testing-spatial-services.vue` were committed; the other session's uncommitted edits to
  that file were left in the working tree.

### 12. Orchestration — `done` 2026-10-07 (local commit)
`run_sepp_pipeline` (script or notebook): hash check → steps 2–8 for what changed → answer keys →
publish or hold; writes `ingest_run` and findings.
**Done when:** a second run with nothing changed does nothing and says so; changing one section
re-extracts only that section.

**Result:** `npx tsx scripts/pipeline/run.ts [--profile x] [--dry] [--force] [--simulate <local_ids>] [--base <url>]
[--keep-sections] [--publish]`. Per profile: source hash vs last ingested → section diff (when due or
simulated) → plan → steps as child processes → rule snapshot diff → answer keys → gate → one `ingest_run`
(step 12) saying what it decided. The plan reruns everything when the profile, answer keys or a step script
changed (a fingerprint of those files against the last completed run); otherwise only the clauses holding a
changed section (`extract.ts --clauses`, new: upserts, retires and re-audits those clauses only).
**Done-when checks - PASS:**
- first run (no previous run): full rerun 68 s - frames, route, extract, edges, terms all PASS; 23 rules, 0
  changed; answer keys 10/10; outcome `eligible` (held, D6).
- second run, nothing changed: 5 s, `plan nothing changed - no step run`, outcome `noop`.
- `--simulate sec.168-ssec.2`: plan `ch.6: sec.168`; the step-5 run logged `clauses ["sec.168"]`, 1 rule
  (vs 23 for a full run); 23 rules unchanged; the 4 open findings on s 169/173 untouched; keys 10/10.
**Guards:** sections added/removed in the source → stop with a gating finding (stage 0 reloads, on purpose);
a changed section that a frame is read from → gating finding (frames are hand-written, D3); changed section
text is applied in place by default (Q3 approved; `--keep-sections` to stop); publishing only with `--publish` (Q4: not yet).
`extract.ts` gained `--clauses`; the profile gained `chapters` (what steps 5-6 extract).

### 13. AI-assisted extraction (hybrid) — `deferred` (Manni 2026-10-07: "leave it for now"; Q5 parked)
Patterns stay first; a model is asked only for what they cannot claim, and its output passes the same gates.
Agreed with Manni 2026-10-07 ("yes" to the hybrid proposal).
- **13a Fallback extractor** `scripts/pipeline/extract-ai.ts`: input = the clauses step 5 leaves with a finding
  (unclaimed number, qualitative requirement, comparator inferred) or no effect; output = JSON in the step-5
  shape (applicability rows + effects, each with a verbatim span). Prompt built from the profile (frames, terms,
  closed land-use vocabulary) - no per-instrument code.
- **13b Gates (unchanged):** every span a literal substring of the section; every number one
  `findNumberCandidates` found; land uses from the closed vocabulary; failures become findings, not rules.
- **13c Determinism:** temperature 0; responses cached by (section content_sha256, prompt hash, model) in a new
  table, so an unchanged section is never re-asked and a no-change run stays a no-op.
- **13d Provenance:** `rule.src = 'ai'` + model id in notes / ingest_run; `/graph` shows the AI share per SEPP.
- **13e Benchmark on Ch 6** (has a pattern baseline + answer keys): run the model on ALL Ch 6 clauses blind,
  compare with the pattern rules field by field, then on the 4 open findings (s 169(3)(c),(e), 173(3)(b),(c)).
**Done when:** the benchmark table is in this file (agreement %, every disagreement classed: model wrong /
pattern wrong / both acceptable); the 4 open findings are resolved or explained; answer keys still 10/10;
a second run with nothing changed makes 0 model calls.

### 14. Housing SEPP Ch 2 Pt 2 Div 1 (s 15C bonus) + Ch 3 Pt 4 (s 72 build-to-rent) — `done` 2026-10-07 (local commits; frames await review, Q6)
Same structure as Ch 6 (patterns, profile, held rules). What these two need that Ch 6 did not - all generic:
- **14a Frame model** (`done` 2026-10-07 - migration 22, evaluator rewritten around it; Ch 6 keys still 10/10): alternatives (s 72(2) is a list of OR'd limbs; s 15C(1)(c) is two branches of ANDs) -
  `rule_applicability.alt_group` (migration 22) + evaluator; distance terms (`scope_layer.within_m`, an
  upper bound for "within 800 m walking"); conditions on another rule's answer (`permissible_under`: the LEP
  Land Use Table, a SEPP chapter's permissions, or the verdict itself for 15C(1)(a)).
- **14b Profile:** frames for s 15C (division) and s 72(2) (part), their terms (accessible area = access.iso_*,
  Six Cities LGAs, relevant zones, Accelerated TOD Precincts, Warrawong / Kanwal / WestConnex Dive sites),
  signals ("Development consent may be granted for development to which this Part applies").
- **14c Extraction:** relative bonuses ("plus an additional floor space ratio of up to 30%"), "the lesser of",
  per-bedroom parking, the 15-year conditions; recall gate PASS.
- **14d Edges, terms, keys:** answer keys from `/api/housing/at` (46 Macquarie St Parramatta, Warrawong, a
  non-Six-Cities lot, an Accelerated TOD lot, an R2 lot); run.ts full run green.
**Done when:** recall PASS on both; answer keys agree with `/api/housing/at` or each disagreement is explained
with a clause; Ch 6 keys still 10/10; frames listed for Manni's review (Q6, non-blocking - rules stay held).

**Result (14b-14d):** frames `ch2-infill-ah` (s 15C) and `ch3-btr` (s 72(2)) with 9 new terms; 16 new rules
(Div 1: s 16-22; Pt 4: s 72-78), 39 pipeline rules in all. Recall: Div 1 31/31 numbers, Pt 4 4/4, Ch 6 37/37 (its
extraction byte-identical before/after every change). `run.ts` full run green; unchanged rerun = noop.
**Answer keys 19/19** (10 Ch 6 + 9 new, each checked against `/api/housing/at` as well): Parramatta MU1, Warrawong
E2, Bambara (RFB and dual occupancy), R2 LMR inner (BTR via Ch 6), Accelerated TOD (bonus excluded), Orange E2
(outside the Six Cities, on a centre zone), Orange R1 (undecided: straight line within 800 m), Wollongong R2 TOD
(BTR via the LEP). One disagreement with `/api/housing/at`, explained: Bambara RFB bonus (Q6 reading 1).
**Generic machinery added (no Housing-specific code):**
- extractor: defined groups of uses ("residential development means development for the following purposes—")
  expanded within their division; rules with no use inherit their frame's; "development to which this Part
  applies" takes the frame's uses; a frame's own clause leaves WHERE to the frame; stacked qualifiers + "otherwise—"
  as the complement; readers for relative bonuses ("plus an additional FSR of up to 30%"), bonus tiers ("if the
  affordable housing component is at least 50%—0.5:1"), required shares, solar access, periods, per-bedroom
  conditions, "the lesser of", per-extra-bedroom increments; Example/Note text not counted; spans keep the
  text's casing; chapter-scoped retirement (a bug that retired other chapters' rules - found and fixed).
- evaluator: OR'd alternatives, native zones, conditions on another rule's answer (LEP Land Use Table, a SEPP
  chapter's permissions - "not extracted" = undecided, "extracted, no such grant" = no - and the verdict itself),
  distance terms (on the source itself = yes), excluded areas; a conditional grant (s 72: at least 50
  dwellings) yields to the LEP or an unconditional SEPP grant and is listed as an alternative.
- answer keys: `scope` per case (which part of the SEPP its "no standards" check is about); `external` checks
  against other hand-built routes with `externalDisagrees` explanations.
**Findings (non-gating):** s 76 "business zone" is undefined in the SEPP - not narrowed; Ch 6's 4 qualitative /
inferred findings stand.

### 15. Ch 2 Pt 2 Div 2 boarding houses, Ch 3 Pt 3 co-living, Ch 3 Pt 5 seniors — `done` 2026-10-07 (local commits; Q7, Q8 await review)
- **15a boarding houses (s 23-27) + 15b co-living (s 67-70) — `done` 2026-10-07 (local commit).** Frames `ch2-boarding`
  (s 23(1): where the LEP permits boarding houses) and `ch3-coliving` (s 67: where co-living, or RFBs / shop top
  housing under the LEP, Ch 5 or Ch 6, are permitted - OR'd), plus `ch5-tod` (Chapter 5's land application only,
  s 152(1), so a condition naming Chapter 5 is "no" off TOD land rather than undecided). 37 new rules (76 in all).
  Recall: Div 2 28/28, Pt 3 25/25. **Answer keys 25/25** - 6 new hand keys (Randwick R2 accessible / not, Newcastle
  R2 far / near a centre, Lane Cove R4 co-living by s 67, Lane Cove R2 no route).
  New generic machinery: SEPP **prohibitions** in the evaluator (s 23(2) "must not be carried out on land in Zone R2
  ... unless (a) ..., or (b) otherwise ..." - a rule with a negated group of exception branches, prevailing over
  the LEP by s 8(1)); zone qualifiers and "for development on other land" as their complement; room-count and
  single/other occupancy conditions; "an additional 30% of the maximum permissible FSR"; "a further 2m2 for each
  room in excess of 6"; comparator nearest the number; a naming parent topic beats a weak own one; zone names are
  not topics; "In this section, ... does not include / — ... means" is definitional; qualitative conditions of
  consent ("adequate bathroom ... facilities", "will be in an accessible area") recorded, not dropped - except
  where the list is the subject ("for the following purposes", s 176(2)); "if ... has at least 3 storeys—" as a
  condition on the requirement; a frame's permission sentence gives its uses.
  **Recall-gate blind spot found and closed:** the shared reader counts a number only with a comparator or unit,
  so "—0.2 parking spaces for each boarding room" was never counted. Step 5 now also counts every bare numeral
  (not references, years, ratio second terms, "1 or more of"). Re-run on all five chapters: Ch 6 unchanged (37);
  Div 1 had 8 more numbers (all claimed); 3 real misses fixed (s 68(2)(e) parking, s 25(1)(d) and s 69(1)(c)(i)
  "not more than 12 rooms").
- **15c seniors housing (Ch 3 Pt 5, s 79-108E) — `done` 2026-10-07 (local commit).** Frames `ch3-seniors` (s 79 zones
  OR s 81(b) "LEP permits seniors housing", less s 80 / Schedule 3) and `ch3-seniors-ra` (Div 8, relevant authorities).
  50 new rules (126 in all); recall 76/76. **Answer keys 29/29** - 4 new hand keys: Parramatta R2 (Part excluded by the
  Biodiversity Values Map, LEP permits it: yes), Kiama R2 (LEP prohibits, s 81 undecided: undecided), The Hills R2 on
  the BV map (no), Shellharbour RU2 (no).
  New generic machinery: a frame's uses from the one permission sentence it governs (s 81); instrument-defined uses
  outside the closed vocabulary (`extraUses`: residential care facility); zone groups (`zoneGroups`: "residential
  zone" = R1-R5) and "where residential flat buildings are not permitted" as a rule condition on the LEP's table
  (s 84(2)(c)); height thresholds as conditions ("having a height of more than 9.5m—"); rates ("1 parking space for
  every 10 beds", "15m2 for every bed"); "3.8m above the maximum permissible building height"; proponent qualifiers
  ("made by a social housing provider or Landcom" / "if paragraph (j) does not apply"); topic per phrase; counts
  ("at least 1 private open space"); distance ("within 50km of a 24-hour ..."), times of day and gradients in
  conditions; section ranges as references; council-level upper bounds for terms.
  **The Schedule 3 gap (Q8):** two of its items are not held, so the Part is undecided wherever nothing held excludes
  it - seniors standards never read "applies" today, and where the LEP prohibits seniors housing the verdict is
  undecided rather than "permitted by s 81".
**Done when:** recall PASS on all three; hand keys for each part pass; earlier keys still pass; frames listed for
review (Q7).

### 16. Ch 3 Pt 1 secondary dwellings, Ch 5 TOD, Ch 7 Pattern Book — `done` 2026-10-07 (local commit; Q9 for review)
**Result:** 149 pipeline rules (23 new). Coverage on /graph (now clause by clause): **80 / 187 operative clauses, 5 / 7
chapters** (Ch 1 is the s 8 frame; Ch 4 not yet). Recall PASS on all nine extracted parts. **Answer keys 36/36** - 7 new:
Bayside R2 TOD (RFBs by s 154 over the LEP; 22 m, 2.5:1, 21 m width; BTR now decided by s 72(2)(a1) and agreeing with
/api/housing/at), Bambara secondary dwelling (60 m2, 450 m2), Hornsby RU1 (Part 1 does not apply), and Chapter 7: a
clear Parramatta LMR lot (both RFB routes reach), an LMR lot in a conservation area and a bush fire prone one (excluded).
- **Ch 5 (s 152-161):** the `ch5-tod` frame now carries s 153 (prevails over LEPs / DCPs); s 154's two grants are two rules
  (RFBs in relevant residential zones + E1; shop top housing in relevant employment zones); s 155 height / FSR, s 156
  affordable share, s 157 parking per bedroom, s 158 "despite a minimum lot size", s 159 width, s 160, s 161.
  Conditions elsewhere that name Chapter 5 (s 67(b), s 72(2)(a1)) are now decided from its rules.
- **Ch 3 Pt 1 (s 49-53):** frame `ch3-secondary` (R1-R5 AND the LEP permits dwelling houses); s 52 grant + 60 m2 cap,
  s 53 450 m2 for a detached secondary dwelling. **Division 3 (s 54-59, complying development) is parked for step 17**
  (it is read with the Codes SEPP; skipped with that reason in the profile).
- **Ch 7 (s 181-185):** frame `ch7-pattern` (s 182: the State less (a)-(l), incl. heritage conservation areas - a new
  term) with three route frames for s 183(1)-(3) (small/corner-lot RFBs on Ch 5 or LMR land; large-lot RFBs anywhere;
  corner-lot shop top housing on Ch 5 or LMR land); s 184's seven disapplications of this policy's own sections are
  `disapplies self:s ...` edges (step 6, not cross-document); s 185 strata subdivision.
New generic machinery: zone groups read from the instrument's definitions (s 49, s 151), council-conditional zone
entries left out and reported; several grants in one clause split into one rule each; a paragraph's own use ("for a
residential flat building ... is 22m") and a numeric heading's listed uses; uses from a consent bar ("must not be granted
for development for the purposes of ...") or "development to which section N applies"; "N or more bedrooms"; a
"the development is permitted ..." condition is not a grant; a chapter frame takes its route frames' uses.
Side effect (accepted): Ch 6 s 175 / s 176 / s 177 and Part 5 s 85 / 86 / 93 / 94 / 97 now carry their uses (they had none,
so no question reached them - s 176's 4-storey cap and s 177's Tree Canopy Guide were never shown before).

### 17. The rest of the Housing SEPP — `done` 2026-10-07 (local commits; Q10, Q11 for review)
Coverage before: 80 / 187 operative clauses. Same structure (profile frames, generic extraction, hand keys).
- **17a Ch 2:** Pt 2 Div 3 boarding houses by relevant authorities (s 28-32), Div 4 supportive accommodation (s 33-35),
  Div 5 RFBs by social housing providers / public authorities (s 36-41), Div 6 residential development by relevant
  authorities (s 42-44A), Pt 3 retention of existing affordable rental housing (s 45-48) — `done` 2026-10-07 (local commit).
  Frames `ch2-bh-ra` (s 28 + its R2 exception), `ch2-supportive` (s 33: LEP / Ch 5 / Ch 6 routes), `ch2-rfb-shp` (s 36:
  four cities near a station OR the listed towns, not where the LEP permits RFBs), `ch2-res-ra` (s 42(1)(a): permitted,
  or LAHC / AHO in an accessible Six Cities relevant residential zone), `ch2-retention` (s 46: four cities, Newcastle,
  Wollongong; the building test is the proposal's). 21 new rules (170 in all); coverage 99 / 187 operative clauses.
  Recall PASS on all six units. **Answer keys 43/43** (7 new). New machinery: **migration 23** `scope_layer.lower_bound`
  (the station walking catchments are wholly inside "within 800m of a station entrance": inside = yes, outside =
  undecided); `useGroupScopes` (a defined use group read wider than its division); a permission phrase inside a
  condition ("is permitted with development consent on the land under ...") is not a grant; numbered conditions under
  an "...if—" scope are read like standards (s 42(1)(b)-(f): "the greater of 11m or ...", 75 dwellings, parking);
  dates are not numbers; "not exceeding"; height / floor space ratio as last-resort topics. **Evaluator:** a grant only
  some proponents may use (public authorities, social housing providers, relevant authorities) is listed as a route
  for them and never decides - or unsettles - the general answer; the harness scopes "SEPP permission applies" to the
  case's part; the orchestrator's fingerprint now includes the evaluator and the harness.
  Gaps (recorded): the 32 towns of s 36(1)(b); s 13 (income bands) is a definition; s 39 (certificate procedure), s 47-48
  (building / market tests, contribution formula) are not lot rules.
- **17b Ch 3:** Pt 2 group homes (s 60-66B), Pt 6 short-term rental exempt development (s 111-114), Pt 7 serviced
  apartments (s 115-117), Pt 8 manufactured home estates (s 118-125), Pt 9 caravan parks (s 126-133), Pt 10 temporary
  emergency accommodation, Pt 11 flood recovery (s 136-141), Pt 13 construction workers (s 141D-141L), Pt 14 temporary
  housing (s 141M-141T) — `done` 2026-10-07 (local commit).
  Nine part frames (`ch3-group-homes`, `ch3-stra`, `ch3-serviced-apts`, `ch3-mhe`, `ch3-caravan`, `ch3-temp-emergency`,
  `ch3-flood-recovery`, `ch3-construction-workers`, `ch3-temporary-housing`). 32 new rules (202 in all); coverage
  **129 / 187 operative clauses** (was 99). Recall PASS on all nine parts; earlier chapters' extraction unchanged except
  s 67 (co-living no longer "applies to" RFBs / shop top housing - they are its condition, not its use).
  **Answer keys 54/54** (11 new); gate green, held. The s 141E council table was read from the XML (the stored section
  text has no tables - a parser gap) into a term over `derived.lot_lga`.
  New machinery: **migration 24** `route_condition` - a proposal fact the general question does not assume (an existing
  serviced-apartment building, s 116; a site compatibility certificate, s 138; s 141F(3)'s public authority / approved
  project); a grant under it is a route, like a proponent-limited one - without it s 116 answered "RFBs permissible" on
  every lot. **Evaluator:** a grant's pathway is read from its own words - "permissible as exempt development (no consent
  needed)" (s 111, 112, 141Q), "without consent" (s 135), else "with consent". **Extractor:** exempt works whose purpose
  names no use (landscaping, repairs, T&I Sch 1 works - s 31, 44A, 63, 108D) are not grants of the frame's use; a use in a
  grant's condition is not granted (s 141Q "is not in a hospital"); a change of use grants only what it changes TO
  (s 116); a place the work is in is not its purpose (s 91(2) sprinklers in a residential care facility); extra uses
  match longest first; a numbered condition headed by an area is its own rule in that area (s 112(1)(b) 180 days in the
  prescribed area, (c) 60 days in Byron); readers for day caps, consecutive days, year limits and bedroom caps; BCA
  classes and ISBNs are not quantities; "has the same meaning as" is a definition.
  Skipped (recorded in the profile): complying development s 64-66, 141R-141T (to step 18 - now with the Codes SEPP
  session), s 131 (a consent requirement, not a grant), SCC procedure s 139-141, s 141O-P.
  Gaps (recorded): STRA Area Map (Clarence Valley / Muswellbrook parts of the prescribed area, Byron Excluded Land);
  "the Sydney region" (s 119); forestry areas, NPWS estate, natural wetlands (s 137(2)); Crown reserves / Sch 5-6 (s 122).
- **17c Ch 4:** design of residential apartment development (s 142-149) — `done` 2026-10-07 (local commit).
  Frame `ch4-rad` (s 144(2): RFBs, shop top housing, mixed use development - read from the listed scope, each item's
  head use; s 143: the whole State but the Kosciuszko Alpine Region, Precincts—Regional Ch 4 - an upper bound over
  Snowy Monaro / Snowy Valleys, whose Alpine Subregion maps are not loaded; s 144(3), (5) size and building-class
  thresholds are the proposal's). 3 rules (205 in all); coverage **132 / 187 operative clauses**. s 147 matters for
  consideration (Sch 9 design principles, the ADG, design review panel advice within 14 days); s 148 non-discretionary
  standards set by the ADG's recommended minimums (car parking Pt 3J, internal area Pt 4D, ceiling heights Pt 4C) as
  `relative_numeric` with no number of their own; s 149 the ADG displaces DCP controls on eight matters. s 145-146 (design
  review panel referral) skipped as procedure. **Answer keys 57/57** (3 new); gate green, held.
  Extractor: a listed frame scope ("This chapter applies to the following—") gives the frame its uses; matters for
  consideration are each item in its own words, list headings are not matters, a "within N days" bound stays with its
  matter - which also replaced "see clause" placeholders in s 15, 20, 93, 141J, 141K; "The N-day period referred to in"
  is a reference. **Evaluator bug fixed:** a `derived.lot_lga` term filter was spliced without parentheses, so a filter
  with OR matched any lot (`AND (${filter})` now, as the other tests already did).
  Remaining operative clauses without rules (55) are the skipped ones, each with its reason in the profile: frames'
  own clauses, procedures (certificates, referrals), definitions-in-effect, complying development (step 18).
**Done when:** recall PASS on each part; hand keys for each part; earlier keys still pass; readings listed for review.

- **17d Ch 1 + honest coverage** — `done` 2026-10-07 (local commit). /graph showed 132 / 187 after 17c: the other 55
  operative clauses had no rule, and nothing told a deliberate omission from a miss. Chapter 1 had never been planned
  and held two real provisions: **s 12A** (stacked FSR bonuses capped at 130% of the maximum permissible FSR - a rule,
  `relative_numeric`) and **s 8(2)** (Sustainable Buildings SEPP Ch 2 prevails over Ch 4 - an `excepts` edge from the
  ch4-rad frame, from the new frame field `yields`; shown, not evaluated). The other Ch 1 clauses are left out with
  reasons. Step 5 now records every skipped clause as a non-gating `clause_skipped` finding with its reason (not counted
  as "to review"); /api/rules/sepp-coverage returns `leftOut` and the `unaccounted` clause list; /graph shows
  "187 / 187 accounted for · 133 with rules · 54 left out · 0 unaccounted", 7 / 7 chapters. 206 rules, keys **58/58**,
  gate green, held. *Unaccounted* is the number that must be 0 when a SEPP is done.

### Later
- 18. Codes SEPP (key: `cdc` catalogue) — in progress in the "airspace" session (worktree C:\w\codes-sepp, branch
  feat/codes-sepp-pipeline, migrations 30+); not this loop's
- 19. T&I, R&H (frames and terms)

## Open questions

**Q11 (step 17b, non-blocking)** — Ch 3 readings: (1) the STRA prescribed area is the three metropolitan cities +
Ballina; the mapped Clarence Valley / Muswellbrook parts are not loaded, so lots there read as outside (no 180-day cap)
- worth loading the Housing SEPP STRA Area Map; (2) Siding Spring's 18 km is taken as an upper bound over Warrumbungle,
Coonamble and Gilgandra; (3) s 141F(1)(b) "another zone ... if the consent authority is satisfied" is read as reaching
every zone but RU3 / RE / C / W - a discretion shown as yes; (4) a grant under a `route_condition` (s 116, 138, 141F)
is never the general answer.

**Q10 (step 17a, non-blocking)** — Ch 2 readings: (1) "residential development" in Div 6 (s 42) is read with Div 1's list
(s 15B(1)), which defines it only "In this division"; (2) "supportive accommodation" is treated as a use; (3) a grant
limited to a proponent (Div 3, 5, 6, seniors Div 8) is shown as "a route for <proponent>", never as the general answer.

**Q9 (step 16, non-blocking)** — readings in Ch 5 / Ch 3 Pt 1 / Ch 7:
1. Council- or centre-only zones (s 154(1)(c), s 160(2)(b) Canterbury-Bankstown B2; s 151 Gosford B3) are left out, not modelled.
2. Ch 7 s 184 switches off other sections of this policy for Pattern Book development; recorded as edges, but the evaluator
   does not yet drop those standards (it cannot know a pattern is used - a proposal fact). Show them flagged instead?
3. Ch 3 Pt 1 Division 3 (secondary dwellings as complying development) is read with the Codes SEPP (step 17).

**Q8 (step 15c, non-blocking - but it decides how useful the seniors rules are)** — Schedule 3 and the seniors frames:
1. **Bush Fire Evacuation Risk Map** (Schedule 3, first item) is not in the ePlanning map services (checked
   SEPP_Housing_2021, Hazard, Protection, Principal_Planning_Layers). Options: (a) request it from DPHI and load it;
   (b) leave the Part undecided wherever nothing else decides it (today's behaviour).
2. **"Land identified in another EPI as open space / natural wetland"** (Schedule 3 (b), (c)): which instruments? Options:
   (a) read it as non-Standard-Instrument plans only (SREPs / old schemes) and treat SI-zoned lots as clear; (b) leave
   undecided.
3. **s 80(2)(a) vs Schedule 3**: s 80(2)(a) says Schedule 3 does not exclude land "only because" it is identified under
   R&H SEPP Ch 2, yet Schedule 3 itself lists coastal wetlands and coastal vulnerability areas (identified under that
   Chapter). Kept as exclusions (the specific listing). Agree?
4. **"residential zone" = R1-R5** (s 84(2)(c)); **"business zone"** (s 76, s 89) left unresolved since the 2023 zone
   reform replaced B zones with E/MU zones. Agree, or give a reading?
5. Where the LEP permits seniors housing, the answer is "permissible" by the LEP even when Schedule 3 excludes the
   Part (the Part's standards then do not apply). Agree?
Reply with numbers and choices, or "frames OK".

**Q7 (step 15, non-blocking - rules stay held) — review the boarding house / co-living readings** (`ch2-boarding`,
`ch3-coliving`, `ch5-tod`, and the s 23(2) rule):
1. **s 23(2) is a SEPP prohibition that beats the LEP** (by s 8(1)): a boarding house in R2 is prohibited unless (a)
   in the Eastern Harbour, Central River, Western Parkland or Central Coast City AND in an accessible area, or (b)
   elsewhere, within 800 m walking of E1/MU1/B1/B2/B4 (straight line upper bound; undecided inside it). "or an
   equivalent land use zone" is not resolved.
2. **s 67(b) "permitted"** is read as permitted with or without consent, under the LEP, Chapter 5 or Chapter 6.
3. **Chapter 5 off TOD land is "no"**, from its s 152(1) land application, before its rules are extracted.
4. **Parking rates with no comparator** (s 68(2)(e)) are read as minimums (non-gating finding each).
Reply "frames OK" or say what to change.

**Q6 (step 14, non-blocking - rules stay held) — review the Ch 2 Pt 2 Div 1 and Ch 3 Pt 4 frames** in
`profiles/housing-sepp-2021.ts` (`ch2-infill-ah`, `ch3-btr`). The readings that decide answers:
1. **s 15C(1)(a) is read for the use asked**: "the development is permitted with consent". An RFB at Bambara
   (prohibited) gets no bonus; a dual occupancy there (permitted by s 166) does. `/api/housing/at` asks whether
   ANY residential development is permitted and says yes for both.
2. **15C(1)(c)(ii) "within 800m walking distance"**: walking is not measured; outside 800 m in a straight line =
   no, on a relevant zone itself = yes, otherwise undecided. "an equivalent land use zone" is not resolved.
3. **Accessible area** = 800 m walking of a station + 400 m walking of a bus stop (your 2026-10-01 decision);
   ferry wharves not held.
4. **s 72(2)(a1)** (TOD area where RFBs are permissible) needs Chapter 5, not extracted yet: undecided where it
   is the only limb that could apply. (a)(i) already covers TOD land whose LEP permits RFBs.
5. **s 72 is a conditional grant** (at least 50 dwellings under residential tenancy agreements, same lot): where
   the LEP permits the use, the LEP controls and s 72 is listed as an alternative; where the LEP prohibits it,
   s 72 controls with its conditions.
6. **"residential development" includes dwelling houses** (s 15B(1)(c)), so the s 19 standards attach to them
   when the bonus is used.
7. **Sydney Olympic Park**: the in-force s 15C(2A) has no Sydney Olympic Park exclusion; `/api/housing/at` carries
   a "wording not yet read" limb for it, which looks unsupported - worth removing from that route.
Reply "frames OK" or say what to change.

**Q5 (step 13, BLOCKING) — which model for the fallback extractor?** Only `DEEPINFRA_API_KEY` is configured.
1. **DeepSeek-V3 on DeepInfra** (recommended to start) - key in place, already used by part4_graph for LEP clause
   roles, cheap; JSON mode.
2. **Claude (Anthropic API)** - strongest at quoting verbatim spans and following a schema; needs an
   `ANTHROPIC_API_KEY` in `.env`.
3. **Both on the Ch 6 benchmark**, then pick on the numbers (needs the Anthropic key too).
Reply with 1, 2 or 3.

**Q4 (step 12) — ANSWERED 2026-10-07: "not yet, keep all locally".** Housing SEPP Ch 6 rules stay `held`; no
`--publish`, and no push of steps 10-12 to prod until Manni says so.

**Q3 (step 12) — RESOLVED 2026-10-07: "update ok".** `run.ts` now writes changed section text (same local_id) to
`nsw.section` in place by default and re-extracts the clauses holding it; `--keep-sections` stops instead.
Added/removed sections still stop the run (stage 0 reloads, on purpose).

**Q2 (step 9) — RESOLVED 2026-10-07: Manni replied "go ahead"; `/api/rules/at` pushed to prod (ac2d0c2).**
The step 10 fixes to the same route (except_term, undecided verdict) are committed locally; pushing them is
covered by the same answer only if Manni says so (D6).

**Q1 (step 3) — RESOLVED 2026-10-07: Manni replied "frames OK"; all four readings stand.** Review the Chapter 6 frames in `profiles/housing-sepp-2021.ts`. Reply "frames OK", or
say what to change. The readings that decide answers:
1. **s 164 = the whole State less (a)–(m)**, so s 166 (dual occupancies, semi-detached dwellings in R2)
   reaches R2 land everywhere outside the exclusions — not only the LMR walking catchments. Only s 167–180
   carry the LMR-area condition (each says "in a low and mid rise housing area").
2. **s 8(1) is modelled as Housing SEPP `prevails_over` every LEP and DCP** "to the extent of the
   inconsistency". The evaluator (step 9) will therefore let s 166 displace a local "consent must not be
   granted" clause such as Parramatta LEP cl 6.11(1) on "D" land. Is that the reading you want the app to
   give, with a "confirm with council" caveat?
3. **164(1)(g)** is one condition (flood planning area) that only bites in the 23 listed councils - kept
   as a note on the frame for now; it becomes an LGA-scoped term in step 7.
4. **Pathway** for Ch 6 is DA only (s 166/170/174 say "permitted with development consent"); the CDC
   route to the same dwelling types stays in the Codes SEPP profile later.

## Log

- 2026-10-07 — design and progress files written. Baseline recorded.
- 2026-10-07 — step 1 done: migration 17, registry of 55 sources, 10/10 SEPPs current-checked.
- 2026-10-07 — step 2 done: 20,712 SEPP sections hashed, all 10 SEPPs match their XML and read current.
- 2026-10-07 — step 3: Housing SEPP profile + 3 Ch 6 frames written (held), coverage PASS; Q1 resolved ("frames OK").
- 2026-10-07 — step 4 done: migration 18, 2,650 sections routed, Ch 6 signals all found.
- 2026-10-07 — step 5 done: 23 Ch 6 rules, 44 effects, recall 37/37, s 168 5/5.
- 2026-10-07 — step 6 done: 8 edges; s 166 vs Parramatta 6.11(1) resolved by s 8(1) prevails_over.
- 2026-10-07 — step 7 done: migration 19, 19 Ch 6 terms registered and measured, 1 recorded gap (164(1)(f)).
- 2026-10-07 — step 8 done: Ch 6's 3 maps all resolve through the term registry; no spatial refs needed.
- 2026-10-07 — step 9 done (local): /api/rules/at; Bambara = permissible by Housing SEPP s 166 over Parramatta 6.11(1) via s 8(1). Migration 20. Q2 asks to push.
- 2026-10-07 — Q2 resolved: rules/at pushed (ac2d0c2).
- 2026-10-07 — step 10 done (local): 10/10 answer keys, 2 lmr disagreements explained; migration 21; undecided-verdict fix; pipeline de-hardcoded into the profile.
- 2026-10-07 — step 11 done (local): /api/rules/sepp-coverage + /api/rules/uses, SEPP table on /graph, "SEPPs for this lot" on /testing-spatial-services.
- 2026-10-07 — step 12 done (local): scripts/pipeline/run.ts; full 68 s, noop 5 s, one changed section -> one clause re-extracted. Q3, Q4 asked. Steps 1-12 done.
- 2026-10-07 — Q3 resolved (section text updated in place by default); Q4 answered: keep held, keep local.
- 2026-10-07 — step 13 (AI-assisted extraction, hybrid) added at Manni's request; blocked on Q5 (model). Later items renumbered 14-18.
- 2026-10-07 — step 13 deferred (Manni). Step 14 opened: Ch 2 Pt 2 Div 1 + Ch 3 Pt 4, broken into 14a-14d.
- 2026-10-07 — 14a done: migration 22 (alt_group, permissible_under, within_m); /api/rules/at evaluates alternatives, native zones, conditions on other rules and on the verdict; Ch 6 10/10.
- 2026-10-07 — step 14 done (local): Div 1 + Pt 4 extracted; answer keys 19/19; Q6 asks for the frame review.
- 2026-10-07 — 15a/15b done (local): boarding houses + co-living, 25/25 keys; recall gate now counts bare numerals. Q7 asks for review. 15c seniors next.
- 2026-10-07 — 15c done (local): seniors housing, 126 rules, 29/29 keys. Step 15 done. Q8 asks about Schedule 3 gaps and readings.
- 2026-10-07 — step 16 done (local): Ch 5, Ch 3 Pt 1 (Div 1-2), Ch 7; 149 rules, 80/187 operative clauses, 36/36 keys. Q9.
- 2026-10-07 — step 17 added: the rest of the Housing SEPP (17a Ch 2, 17b Ch 3, 17c Ch 4) ahead of the Codes SEPP; later items renumbered 18-19.
- 2026-10-07 — 17a done (local): Ch 2 remaining divisions + Pt 3; 170 rules, 99/187 operative clauses, 43/43 keys; migration 23. Q10.
- 2026-10-07 — 17b done (local): Ch 3 remaining parts; 202 rules, 129/187 operative clauses, 54/54 keys; migration 24. Q11. Step 18 (Codes SEPP) taken by the "airspace" session in worktree C:\w\codes-sepp.
- 2026-10-07 — 17c done (local): Ch 4; 205 rules, 132/187 operative clauses, 57/57 keys. Step 17 done - the Housing SEPP is complete. Loop stops: 18 is with the "airspace" session, 19 is a "Later" item with no plan yet.
- 2026-10-07 — 17d done (local): Ch 1 (s 12A rule, s 8(2) edge); coverage now with rules / left out / unaccounted = 133 / 54 / 0 of 187; 58/58 keys.
