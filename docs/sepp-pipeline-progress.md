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

### 10. Answer keys — `todo`
`tests/answer-keys/housing-sepp-2021.json` with the §6 lots; harness compares `/api/rules/at` with the
keys and with `/api/lmr/types`.
**Done when:** 100% agreement or every disagreement explained (including the `lmr` dual-occupancy error).

### 11. Coverage and visibility — `todo`
**Done when:** `/graph` shows SEPP rule coverage; `/testing-spatial-services` has a "SEPPs for this lot"
section reading `/api/rules/at`.

### 12. Orchestration — `todo`
`run_sepp_pipeline` (script or notebook): hash check → steps 2–8 for what changed → answer keys →
publish or hold; writes `ingest_run` and findings.
**Done when:** a second run with nothing changed does nothing and says so; changing one section
re-extracts only that section.

### Later (after Ch 6 passes)
- 13. Housing SEPP Ch 2 Div 1 + Ch 3 Pt 4 (keys: `/api/housing/at`)
- 14. Ch 3 Pt 5 seniors, Pt 3 co-living, Ch 2 Div 2 boarding houses (new hand keys)
- 15. Ch 3 Pt 1 secondary dwellings, Ch 5 TOD, Ch 7 Pattern Book
- 16. Codes SEPP (key: `cdc` catalogue)
- 17. T&I, R&H (frames and terms)

## Open questions

**Q2 (step 9, non-blocking) — push `/api/rules/at` to production?** It is a new, additive route behind the
site password; it reads the `held` SEPP rules (labelled as such in every line) and changes no existing page.
Per D6 it is committed locally and NOT pushed; later commits stay local too until you answer, since a push
would carry it. Reply "push rules/at" to publish, or leave it local until step 10's answer keys pass.

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
