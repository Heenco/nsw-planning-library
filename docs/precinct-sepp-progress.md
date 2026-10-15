# Precinct SEPPs — progress

Working memory of the loop building [precinct-sepp-pipeline.md](precinct-sepp-pipeline.md). **Every pass
reads this file first and updates it last.** One step per pass; a step is only ticked when its "done when"
check has been run and its numbers are written below it.

## How the loop works

1. Read this file. Take the first step that is not `done` and not `blocked`.
2. Do it. Run its "done when" check. Write status, numbers and findings under the step.
3. Commit (code + this file) locally. Never push or deploy.
4. If the step needs a decision that is Manni's, write it under **Open questions**, mark the step
   `blocked`, and stop the loop.
5. Stop when every step is `done`.

## Standing decisions (defaults taken 2026-10-15; Manni can override here)

| # | decision | default | status |
|---|---|---|---|
| D1 | Source text | the library copies `public/EPI/SEPP/epi-2021-072[5-8]_2026-03-2x.xml`; refresh through `scripts/rag/corpus_xml.py` (curl_cffi) when a newer in-force XML is wanted | default |
| D2 | Governing unit | one derived table `derived.lot_instrument`, rank-then-cover rule, 50% cover threshold, point on surface; every reader switches to it, none keeps its own zoning query | default |
| D3 | Per-instrument facts | `profiles/precincts-*.ts` (map name → unit, prevails exceptions, disapplied instruments), reviewed by Manni in this file before step 4 writes anything | default |
| D4 | Land Use Table store | `nsw.lep_permissibility` with a nullable `unit_local_id` (additive), not a new table, so 09G / d_4 / every existing join keeps working | default |
| D5 | Vocabulary | grown from each unit's own dictionary, run-scoped, closed; unknown residual forms stay "not held" | default |
| D6 | Publishing | SEPP rules `held`; permissibility rows for the four instruments carry `run_id` and are invisible to routes until step 10's gate passes | default |
| D7 | First target | CRC + WPC growth centre appendices; keys = the six lots tested 2026-10-15 plus 10 lots per appendix type | default |
| D8 | Exposure | the precinct path runs only when a request says `precinct=1` (the /precinct test bench); /report-2 and every other page keep the previous behaviour, with a multi-unit instrument silent on every engine, until /precinct says the answers are right (Manni, 2026-10-15) | Manni |

## Baseline (2026-10-15)

- Instruments in the graph: 10 SEPPs, 35 LEPs, 4 DCPs; **0 Precinct SEPPs**.
- `nsw.lep_permissibility`: 0 rows for any Precinct SEPP. `rag.instrument`: 5 LEPs + Housing + Codes.
- Precinct SEPP lots: 60,631 / 46,264 / 10,881 / 2,560 (CRC / WPC / Regional / EHC); 167 zone groups;
  5,580 Land Use Table entries, 520 outside the vocabulary.
- Test lots (cadid): The Ponds 173688603 (CRC app Alex Avenue and Riverstone, R2); Austral 183806086
  (WPC Liverpool app, R2); Luddenham 101874531 (WPC Aerotropolis, SP2); Gosford 104226091 (Regional
  ch 5, B3); Olympic Park 102043114 (CRC ch 4, C2; Canada Bay sliver 11.6%); Normanhurst 102531074
  (EHC Wahroonga Estate schedule, R2; Hornsby LEP 100% overlap).
- Known wrong answers to correct: "prohibits seniors housing" on empty tables (facts.ts); Normanhurst
  answered from Hornsby; Olympic Park attributed to Canada Bay.

## Steps

### 0. Fail closed on an empty Land Use Table — `done` 2026-10-15
`shared/norms/facts.ts`: when `nsw.lep_permissibility` has no row at all for the (plan, zone), every
use is `not_held`, and `shared/norms/engine.ts` answers `v: null` with "Land Use Table for <plan> not
held" instead of "prohibits". Generic: applies to the 35 pre-standard-instrument LEPs with no table too.
**Done when:** `/api/norms/subdivision?cadid=173688603` no longer contains "prohibits"; a Hornsby R2
lot (dual occupancies genuinely prohibited by the table) still says prohibited; count of lots whose
(plan, zone) has no table rows, measured and written here.

**Result:** `shared/norms/facts.ts` sets `lutHeld` (false = 0 rows for the plan and zone); `shared/norms/engine.ts`
answers `lot.permits` with `v: null` and "the Land Use Table of <plan> for <zone> is not held" (plus the SEPP-only
permission, still untested for reach) before any status is read. Check: The Ponds 173688603 -> 0 "prohibits", 4
"not held"; Hornsby R2 control 104636869 (430-440 Peats Ferry Rd) -> still "Hornsby LEP 2013 prohibits seniors
housing in R2". **Measured (d_4 single-plan lots, 5,136,303):** 139,137 lots on 125 (plan, zone) pairs with no table
rows - the four Precinct SEPPs 113,346 of them (CRC 56,469; WPC 44,147; Regional 10,666; EHC 2,064), T&I SEPP 5,553,
then zones the LEP extraction has no table for: Parramatta LEP 2023 7,585, Blue Mountains 4,796, Warringah 1,542,
Byron 1,463, Shellharbour 1,079, Ballina 911, Tweed 644. Finding: those LEP pairs are a 01E gap worth its own check
(zones in the zoning layer with no `pt-cg1.Zone_` group, or deferred-matter codes) - not this pipeline's.

### 1. Register and ingest the four instruments — `done` 2026-10-15
Add four `sources.ts` entries (doc_type `sepp`, raw_path the library XML), run
`scripts/pipeline/registry.ts` then `scripts/pipeline/sections.ts` (or the orchestrator the other
SEPPs used).
**Done when:** 4 `nsw.document` rows; section counts per instrument written here; every `app.N` and
`sch.N` top-level unit present with its heading; zone-group member clauses keep their XML ids
(`app.5-inc-pt-cg1.Zone_R1` ...): 167 groups findable by id pattern across the four; registry rows
`current`.

**Result:** 4 `nsw.document` rows, as at 2026-10-15, registry `current` and linked, every section hashed.
Sections: CRC 6,738 / EHC 2,194 / Regional 3,339 / WPC 7,062 = 19,333. Checked from the XML, not by id
pattern: top-level units 33/33, 24/24, 29/29, 31/31; zone groups with every member clause in the graph
**167/167**; clauses **2,913/2,913** (100%). Regression: `scripts/pipeline/sections.ts` re-parses the 10
other SEPPs with the patched parser - all 10 MATCH (20,712 sections, 0 changed).
Three findings, each cost a round:
1. **Parser dropped every precinct plan.** They sit in `<level type="indoc">` (an incorporated document)
   whose levels are under `<content>` wrappers; the unknown-level branch of `nsw-xml-parser.ts` only walked
   direct `level` children, so CRC kept 1,146 of 6,738 sections and 0 of 87 zone tables. Fixed generically:
   the transparent branch now walks `content` / `pre` / `post` wrappers like the known-level branch does.
2. **The March library copies were stale.** WPC's 2026-03-23 XML has an empty `sch.3` where the current
   instrument has Appendix 3 Leppington Town Centre Precinct Plan (9 zone tables, 94 clauses); CRC's lacks
   Olympic Park cl 8A and 20A. Refreshed from `export/xml/2026-10-15/` (curl_cffi) into
   `public/EPI/SEPP/epi-2021-072[5-8]_2026-10-15.xml`; sources repointed, `as_at_date: '2026-10-15'`. The
   March files are left in place (nothing references them). Worth a `sections.ts` currency run against fresh
   downloads for the other 10 SEPPs too - not this pipeline's step.
3. **Changing a source's as_at_date does not replace its document.** `upsert-document.ts` deletes the old
   row only when source_url AND as_at_date match; otherwise the insert fails on `document_instrument_slug_key`.
   Deleted the four April-dated rows by hand (sections cascade), re-ingested, re-ran `registry.ts` to relink
   (the registry keeps `document_id`, which the delete had orphaned), then `sections.ts --apply`.
Zone-table member clauses in the graph: 1,226 rows carry `cg1.Zone_` in their id; Gosford and Port Kembla
(Regional ch.5/ch.6) table clauses carry plain `sec.N-oc.M` ids with no zone in them, so the zone must come
from the XML clausegroup (as `scripts/rag/01b-groups.py` already does for LEPs), never from the id.

### 2. `derived.lot_instrument` — `done` 2026-10-15
Builder script (`scripts/build-lot-instrument.ts` or a Notebooks 02-series notebook, Manni's call;
default: the app repo, same connection as every other planningai script). For every lot: all zoning
polygons at the point on surface with cover; rank from `nsw.document` kind (dcp 10 / lep 20 / sepp 30);
unit from the land application polygon over the same point (`lay_class ~ 'Appendix (\d+)'` →
`app.N`; else the profile's map table; else NULL). One governing row per lot, plus `also_mapped` rows.
**Done when:** state-wide counts written here: lots with one instrument / two / none; lots with a SEPP
and no unit (expected: Urban Renewal, some SSP) listed by map name; the six test lots resolve to the
units named in the baseline; Normanhurst → EHC Wahroonga Estate schedule with Hornsby as also-mapped;
Olympic Park → CRC ch 4 with Canada Bay as a sliver. An LEP-only lot is byte-identical to today's
`(zone, epi)`.

**Result so far:** two scripts. `scripts/build-instrument-unit-map.ts` writes `nsw.instrument_unit_map` (new, additive):
one row per (instrument, layer, map_name, lay_class, label) key with the unit it proposes and the rule that proposed
it, status `proposed` until the profile confirms. 262 keys over the 41 instruments the zoning layer names and the graph
holds; **209 resolved** (the 4 Precinct SEPPs: CRC 21/24, EHC 26/30, Regional 39/43, WPC 22/26). The rules are generic
(name equals a unit heading; name tokens inside one heading; name as a phrase inside one unit's "land to which ...
applies" clause; name plus map-name tokens), strongest rule wins, chapter preferred on a tie. Four things the data taught:
the appendix NUMBERS on the growth centre maps are stale ("Appendix 4" = today's app.7), so matching is by name;
digits must stay in names ("Stage 1 and 2" is not "Stage 3", "Area 20" is only its number); the instrument's own
title must be removed from a map name as a PHRASE, not token by token ("City West" under "Eastern Harbour City");
and chapter clauses carry no unit prefix in their ids (`sec.2.6`, 1,037 sections in CRC), so descendants are
found through `parent_id`, never by id prefix. The 13 precinct keys still without a unit are the growth-centre-level
maps (unreleased precinct land: NWGC 759 + 2 zoning polygons, SWGC 589, Wilton 35 - several appendices name the
centre, so "ambiguous" is right), the Opera House buffer, two foreshore sites and the alpine archaeology layer.
`scripts/build-lot-instrument.ts` builds `derived.lot_instrument_build` council by council (rank, then cover >= 50%,
then the lot's own council's plan, then name); cover measured only where two instruments meet at the point.
**Seven test councils** (Blacktown, Liverpool, Penrith, Central Coast, Parramatta, Hornsby, Canada Bay; 7.0 min):
475,739 lots, 170 with two instruments at the point; governing basis: LEP root 426,354 (134,337 of them LEPs not yet
in the graph), SEPP unit from the land application map 42,948, from the zoning map 5,526, unmapped 911 (all CRC,
the unreleased NWGC land). **The six test lots** resolve as the baseline expects: Luddenham -> WPC ch.4 Aerotropolis;
Olympic Park -> CRC app.4 (the Canada Bay sliver is not at the point, so not a row); Normanhurst -> EHC app.6
Wahroonga Estate governing, Hornsby LEP root at 100% not governing; Gosford -> Regional ch.5; The Ponds -> CRC app.7
Alex Avenue and Riverstone; Austral -> WPC app.4 Liverpool Growth Centres. Timing: ~1 min per council (the land
application join and cover), so the state is ~2 h - launched 2026-10-15 in the background (`--all`, no swap yet).
Equivalence with today's rule (`shared/norms/facts.ts`: the first zoning polygon at the point): a 3% sample of the
seven councils, 14,061 governing rows - plan identical on all 14,061; zone identical on 14,014; 47 (0.3%) differ in
zone only, where one plan has two zoning polygons at the point and today's rule takes whichever comes first while the
build takes the larger.
**State-wide (132 councils, 51.9 min, swapped into `derived.lot_instrument` at 14:20):** 3,349,185 rows, 3,348,237 lots
(4,693 lots of cadastre.lot have no zoning polygon at their point and are absent: readers fall back to the first polygon
for them). Governing basis: LEP root 3,253,645 (1,170,997 in the graph, 2,082,648 not); SEPP unit from the land
application map 70,583, from the zoning map 5,578, **unmapped 18,431** (WPC 12,383, CRC 6,048: growth centre land with no
released precinct plan at the point, "unit not held" by decision Q1(e)). 948 lots have two instruments at the point: a SEPP
governs 895, an LEP 9, 44 are two LEPs. Largest precinct units: Alex Avenue and Riverstone 14,391 lots, Blacktown Growth
Centres 11,440, Liverpool Growth Centres 9,936, The Hills 7,730, Camden 7,405, St Marys 5,526. Previous table kept as
`derived.lot_instrument_prev` (none existed: dropped on the next swap).

### 3. Profiles for the four instruments — `done` 2026-10-15 (reviewed in session, Q1 (a)-(f))
`profiles/precincts-{central-river-city,western-parkland-city,regional,eastern-harbour-city}-2021.ts`:
rank, per-chapter prevails with quoted exceptions (Homebush Bay, Gosford, Port Kembla), disapplications
(Western Sydney Parklands), units with their land-finding rule, chapter and appendix frames.
**Done when:** every top-level unit of each instrument appears in exactly one `units` row; every
chapter has a prevails reading or an explicit "none"; Manni has reviewed under Open questions ("profiles OK").

**Drafted:** `profiles/precincts-{central-river-city,eastern-harbour-city,regional,western-parkland-city}-2021.ts`,
GENERATED from the graph by `scripts/precinct/extract-units.py` (every top-level unit, its "land to which ...
applies" clause and its relationship clause, found through the parent chain; the chapter that cites an appendix
by number or name) and `scripts/precinct/generate-profiles.py` (frames, terms, unitKeys). Per instrument: one
`instrument` frame governing every unit; one frame per chapter and per precinct plan / State significant site /
activation precinct (19 / 14 / 15 / 18 unit frames); a schedule named for a chapter ("Environmental heritage—
Chapter 5") is governed by that chapter's frame; each unit frame carries one `defined_area` condition
`unit:<slug>:<local_id>` tested against `derived.lot_instrument` (term mapping `UNIT(...)`), a `prevails` over
`lep` where the relationship clause says "prevails" or "the only instruments that apply ... are ...", and the
rest of the clause's wording in `note`. Appendix frames inherit from their chapter: 18 under ch.2, 23 under
ch.3, 1 under ch.4 (CRC Olympic Park app.4, from 33 citations in the Homebush Bay chapter), 1 under ch.7 (WPC
Gilead sch.11, 2 citations); 23 frames sit under the instrument. `unitKeys`: the 123 proposer rows plus 12 hand
rows (the growth-centre-level maps -> ch.3; the Opera House buffer -> app.1; the alpine archaeology overlay ->
ch.4; three EHC foreshore / port keys left null and marked REVIEW). `scripts/pipeline/units.ts` writes a reviewed
profile's unitKeys into `nsw.instrument_unit_map` as confirmed and refuses a profile still marked "not reviewed".

**Reviewed (Manni, in session, 2026-10-15):** (a) prevails over the LEP only; (b) "the only instruments that apply ...
are Chapter 2 and other SEPPs" = prevails over the LEP; (c) parents by KIND, not citation count (Olympic Park app.4 under
ch.2, Gilead sch.11 under ch.3; counts kept as a note); (d) Opera House buffer -> app.1, the three EHC foreshore / port keys
stay null; (e) growth centre land with no released precinct plan at the point has NO unit (fail closed, not ch.3); (f) a
clause that disapplies the LEP is written as prevails over the LEP now, and every instrument it names gets a `disapplies`
edge (added in this step rather than deferred: the edge type already existed in `nsw.rule_edge`). Profiles regenerated
with those readings (header "REVIEW STATUS: reviewed"); `units.ts` written for all four: **123 unit-map rows confirmed**,
0 inserted, 0 unmentioned. Parents now: 19 frames under ch.2, 24 under ch.3, 23 under the instrument.
Checks run: `frames.ts --dry` **PASS on all four** (0 sections with no frame, 0 ties); `units.ts --dry` on all four:
every table row is mentioned, 0 inserts, 123 rows would be confirmed. The interface gained `UnitKey` /
`unitKeys` (additive, in `profiles/housing-sepp-2021.ts`). Nothing written to the database by this step.

### 4. Frames and edges — `done` 2026-10-15
`scripts/pipeline/frames.ts` over the four profiles: chapter frames (reach = unit polygons),
appendix frames, `prevails_over` and `excludes` edges, all `held`.
**Done when:** every operative section of each instrument sits under exactly one frame, 0 ties;
counts written here.

**Result:** `frames.ts --chapter all` (new: coverage over the whole instrument, since a Precinct SEPP's units are
chapters and appendices) written for all four, held: **70 frames** (CRC 20, EHC 15, Regional 16, WPC 19), **32
prevails_over lep edges**, **20 disapplies edges** (new `Frame.disapplies` + writer: `doc_type:lep` x3 for "a local
environmental plan does not apply" (Activation Precincts, Aerotropolis, St Marys); named instruments or parts - Blacktown
LEP 1988, Wollongong LEP 2009, Snowy River LEP 2013, Tumut LEP 2012, Penrith LEP No 201 and No 255, Housing SEPP Ch 4
and Ch 3 Pts 8 and 9, Codes SEPP, I&E SEPP Ch 3, Planning Systems Ch 2, ARH SEPP 2009, SEPP No 1). Coverage **PASS on
all four over every section**: CRC 6,738 / EHC 2,194 / Regional 3,339 / WPC 7,062 sections, 0 with no frame, 0 ties.
The generator reads instrument names in their statutory form from each relationship clause; two malformed names on the
first pass (a dash suffix swallowing "does not apply", a lost "and 9") were fixed in the pattern, 0 malformed targets now.
Still a note, not an edge: the "Despite subsection (1), SEPP X prevails" exceptions (Homebush Bay, Gosford, Port
Kembla, Parklands) - these are `yields` in the Housing profile's terms and can be generated the same way when wanted.

### 5. Switch the readers to the unit — `done` 2026-10-15
`shared/norms/facts.ts`, `shared/rag/lot-facts.ts`, `server/api/housing/at.get.ts`,
`server/api/report/standards.get.ts` (+ the others listed in the design §1) read
`derived.lot_instrument`; `nsw.lep_permissibility` lookups pass `(epi_name, unit_local_id, zone)`.
Report line "Governed by <instrument>, <unit>" in `/report-2`'s title block; "also mapped" for slivers.
**Done when:** the 16 Randwick / Hornsby / Parramatta / Ku-ring-gai / North Sydney RAG key lots answer
byte-identically before and after (`scripts/rag/16-compare-report2.ts` or the key run); Normanhurst
no longer answers from Hornsby; Olympic Park no longer names Canada Bay.

**Result:** ten files switched (scratchpad `patch_readers.py`, applied once): `shared/norms/facts.ts` and
`server/api/rules/at.get.ts` take the governing row (zone, instrument, unit) with the old first-polygon query as the
fallback for a lot the table has not reached; `shared/dcp/guard-facts.ts` the same for the zone guard; the four
permissibility readers (`housing/at`, `pattern-book/at`, `cdc/types`, `lmr/types`) keep every zone over the lot but only
of the governing instrument; `/api/report/standards` returns `governing` (instrument, unit, heading, basis, also-mapped
instruments with cover) and flags each panel `governing: false` when it belongs to an also-mapped instrument;
`/report-2` prints "Governed by <instrument>, <unit> <heading>" (or "unit not held") under the title and tags such panels
"also mapped". `LotFacts.unit` carries the unit for the engine (unused until step 6).
**Check (70 before/after captures, 7 lots x 10 endpoints, `ms` ignored):** the four LEP-only key lots (Bambara, Park Ave
Chatswood, 62B Carr St, Peats Ferry Rd Hornsby) are byte-identical on every endpoint except `standards`, which only
gains the new `governing` field (`rules/at` returned 400 both times for want of `use=`; with `use=dual occupancies` it
answers as before). Normanhurst: uses / subdivision / build-controls go from Hornsby's RAG answers to `engine: none`
("the RAG does not hold SEPP (Precincts—EHC) 2021") - the honest state until steps 6-7; `cdc/types` and `housing/at`
drop Hornsby's table ("no Land Use Table row"). Olympic Park: `cdc/types`, `housing/at`, `pattern-book/at` drop the Canada
Bay sliver's table. The Ponds: unchanged apart from the governing line.

### 6. Land Use Tables per unit — `blocked` 2026-10-15 (Q3: notebook changes and 45 vocabulary terms are Manni's)
Extend the LUT reader (01E `lut_xml.py` / `scripts/build-zone-lu-index.mjs`, whichever is the live
one — record which) to key by `(document, unit, zone)`; vocabulary growth from each unit's dictionary;
residual forms "any development not specified in item 2 or 3" and the SP-zone verbatim form handled as
sentence forms. Write to `nsw.lep_permissibility` with `unit_local_id` and a `run_id`, held (D6).
**Done when:** 167 zone groups read; 5,580 entries, 0 unread (every entry either a vocabulary term,
a grown term with its dictionary source, or a residual form); counts per instrument written here;
`rag.map_polygon` loaded for the four documents with the appendix map names; check and record whether
height / FSR / lot size polygons are labelled per appendix.

**Finding:** the live Land Use Table reader is not in this repo. It is `01D` (XML -> `public.lep_zones` on UrbanPortalDBP,
keeping only clausegroups whose id STARTS with `pt-cg1.Zone_` / `pt-inc.Zone_`, and only instruments flagged
`is_standard_lep`) -> `01E` (closed vocabulary `01E-vocab/vocab_config.py`, hierarchy, catch-all; refuses any string
outside CANONICAL_USES when STRICT_VOCAB) -> `scripts/copy-lep-permissibility.mjs` -> `nsw.lep_permissibility`. The
table already carries `zone_id` (e.g. `pt-cg1.Zone_R2`), so a Precinct SEPP row keyed `app.7-inc-pt-cg1.Zone_R2` names its
unit by its prefix; a `unit_local_id` column stays the plan (D4) but is derivable. Measured on the four XMLs with the
residual forms excluded: **422 Land Use Table entries, 45 distinct terms, fall outside the 203-term vocabulary and the
115-entry TERM_MAP** (`docs/precinct-lut-out-of-vocab.csv`: drainage 65, earthworks 50, bulky goods premises 35, boat
repair facilities 33, studio dwellings 26, restriction facilities 25, biosolid waste applications 19, "the purpose shown
on the land zoning map" 18 (SP zones), waste management facilities 17, manor homes 16, timber and building supplies 14,
funeral chapels 13, restaurants 9 ...). Most are pre-2021 Standard Instrument terms the appendices still use.
Nothing of this can be done from the app repo without forking the reader, which principle 2 forbids.

### 7. RAG corpus — `done` 2026-10-15 (corpus + Land Use Tables read; bindings of the standards clauses still mostly unbound)
Add the four instruments to `scripts/rag/corpus.json` (route `section`, scope = the appendices and
table-bearing chapters first), run `scripts/rag/run.ts --no-llm`.
**Done when:** `rag.instrument` has the four; provisions / groups / terms counts written here;
`rag.coverage` shows each instrument's gaps on `/rag`; no paid stage run (standing rule).

### 8. Keys — `todo`
`tests/answer-keys/precincts-*.json`: the six test lots plus 10 lots per appendix type, each with
the expected unit, zone, and 3 permissibility answers read from the appendix's own table by hand
(dual occupancy, secondary dwelling, seniors housing) and the mapped height.
**Done when:** keys exist and the current (pre-publish) answers are recorded beside them.

### 9. Non-table chapters through the SEPP rule pipeline — `todo`
Route and extract the SSP site schedules, City West, Olympic Park, Alpine, Activation and
Aerotropolis chapters under their frames (`scripts/pipeline/route.ts`, `extract.ts`), held.
**Done when:** recall gate passes per chapter; counts written here; Olympic Park and Normanhurst keys
answer from these rules.

### 10. Gate and publish — `todo`
Run the keys. Flip `run_id` rows and frames to published only for instruments whose keys all pass.
**Done when:** per-instrument pass counts written here; `/report-2` on the six lots shows the unit
line and section 9 answers; what stays held is listed with why.

## Open questions

- **Q1 (step 3) - answered in session 2026-10-15, see step 3:** review the four `profiles/precincts-*.ts`. Specifically: (a) `prevails` is
  recorded over `lep` only (the clauses say "another environmental planning instrument"; a DCP is not an EPI) -
  the Housing profile used `['lep', 'dcp']`; which convention? (b) an appendix that lists "the only instruments
  that apply" is read as prevailing over the LEP; (c) parent attributions flagged "REVIEW the attribution":
  CRC Olympic Park app.4 under ch.4 Homebush Bay (not ch.2 SSP); WPC Gilead sch.11 under ch.7 Western Sydney
  Parklands (Appin app.10 is under ch.3); (d) the four hand unit keys marked REVIEW (EHC Circular Quay, The
  Rocks, Port and Related Employment Lands -> null; Opera House buffer -> app.1). Reply "profiles OK" (with any
  edits) to unblock; `scripts/pipeline/units.ts --profile <name>` then confirms the unit map.
- **Q2 (step 2):** 50% cover threshold and own-council tie-break - **answered: keep** (Manni, 2026-10-15).
- **Q3 (step 6, blocks steps 6, 8 keys' permissibility answers, 10):** three things only the notebooks' owner can do:
  (1) `01D`: load the four Precinct SEPP XMLs (`public/EPI/SEPP/epi-2021-072[5-8]_2026-10-15.xml`) into `lep_zones` -
  widen the zone-group test from "id starts with `pt-cg1.Zone_`" to "id contains `cg1.Zone_` or `inc.Zone_`" and keep the
  full group id as `zone_id` (the unit is its prefix); the `is_standard_lep` contract becomes "has zone clausegroups".
  (2) `01E`: the 45 terms in `docs/precinct-lut-out-of-vocab.csv` - run `build_vocab.py` over them (its step 5 promotes a
  term used by 2+ instruments; the growth centre appendices count as one epicode each) or map them by hand
  (bulky goods premises -> specialised retail premises, restriction facilities -> correctional centres, boat repair
  facilities -> boat building and repair facilities, waste management facilities -> waste or resource management
  facilities ...); drainage, earthworks, studio dwellings, manor homes are NEW terms. (3) run 01D, 01E,
  `scripts/copy-lep-permissibility.mjs`. Then I switch the readers' permissibility join to the unit
  (`zone_id` prefix = `derived.lot_instrument.unit_local_id`, NULL/`pt-` = the whole plan).


## Log

- 2026-10-15 plan written from the measurements in the design doc.
- 2026-10-15 steps 0 and 1 done (see above); committed locally.
- 2026-10-15 step 2 built and verified on seven councils (state-wide build running); step 3 drafted and blocked on review (Q1).
- 2026-10-15 Q1 and Q2 answered in session; steps 3 and 4 done; unit map confirmed, 70 frames held.
- 2026-10-15 state-wide lot_instrument swapped in (step 2 done); readers switched (step 5 done), before/after verified on 7 lots.
- 2026-10-15 step 6 blocked on Q3 (01D/01E + 45 vocabulary terms); moving to step 7.
- 2026-10-15 step 7: the four added to the RAG corpus (6,738 / 2,194 / 3,339 / 7,062 provisions; 87 CRC zone groups restored; free stages run).
  FOUND the same day: a Precinct SEPP's clauses reached every lot in the State on both engines (/report-2 100 Galston Rd showed
  Edmondson Park South lot sizes) - and PROD showed them too, through the shared database, with no code pushed. Fixed by
  (a) side D gating a unit-bound instrument's claims by the lot's governing unit (claimsFor / instrumentsFor, shared with the
  report's use and option lists), (b) frame terms keyed by their condition value and qualified by instrument (a heading
  like "State significant precincts" repeats across the four), (c) frames' governed units as data (migration 27,
  nsw.rule_frame_scope) so the subdivision reader attaches a frame to a clause with no rule, deepest frame first,
  (d) D8: the whole path behind `precinct=1`, exercised by `app/pages/precinct.vue`. Checked: with the switch off the
  seven capture lots answer as before on what each section says (the only residue is the RAG rebuild's new Codes SEPP
  claim set in the "other uses" list); with it on, the six baseline lots resolve to their unit, the RAG answers from the
  governing instrument, and the norms side lists 2 unchecked precinct clauses (the chapter-level 2.6 / 4.1) where it
  listed 65-97. Deploying the switch to prod (Manni's call) so prod's report-2 matches localhost.
- 2026-10-15 /precinct became the bench Manni asked for: `/api/precinct/samples` lists two or three addressed lots per
  governing unit the state-wide build found (93 lots, 47 units, 6 instruments - the Industry and Employment SEPP's
  employment-area chapters count, being multi-unit too); `/api/precinct/at` returns the governing unit's provisions as a
  tree with every claim the RAG build read from each clause and subclause, tested on the lot by the engine's own scope
  test (`Ask.audit`: every claim in play, no ruling) - holds / does not hold / unknown and why - plus the other
  instruments' claims. The Ponds (app.7): 591 provisions, 47 claims on 47 of them (frame 17, standard 27, condition 3;
  25 hold, 10 do not, 12 unknown), 1,245 claims from the Housing and Codes SEPPs. FOUND: no permit / prohibit claim
  exists for any precinct appendix - the Land Use Table zone groups are in the corpus (01b-groups) but the claims reader
  did not read them as permissions; the page says so. Headless Edge would not launch in this session, so the page was
  checked by SSR (200, expected markup) and its endpoints by hand, not by a rendered screenshot.
- 2026-10-15 late: the Land Use Table gap closed generically. `scripts/rag/02c-claims.ts` read tables only for
  `kind = 'lep'` instruments and only the plan's top table (`^pt-cg1.Zone_X$`). Now every instrument's every table is
  read (a table = a group headed "Zone ..." whose items are headed Permitted without consent / with consent /
  Prohibited), keyed by the table's own group (two appendices both have an R3), from the resolved rows of
  `nsw.lep_permissibility` where 01E has read the plan and from the items' own words always; items split on ";" as
  well as ","; "Nil" lists nothing; a zone the heading does not code ("Zone 1 Urban Development", WPC Aerotropolis)
  takes its code from the instrument's own zoning map (`epi_land_zoning` lay_class -> sym_code: UD). Claims 18.4k ->
  24.4k: the four instruments gained 5,798 words + 83 by-group + 159 catch-all claims; the five LEPs' counts are
  unchanged (14,191 resolved, 396 by group, 83 catch-all; words 559 -> 549, the ";" split dropping leftovers that were
  never a use). `E.label` now names an appendix table ("Precincts—Central River City SEPP App 7 Land Use Table, Zone R3
  (Permitted with consent)"). 38 Norwood Rd Vineyard (app.7 R3): dual occupancy, multi dwelling housing, secondary
  dwelling, dwelling house, RFB permitted by the appendix's own table; 442 claims tested on the unit (permit 171,
  prohibit 224). /precinct shows the standards cards (zone, height, FSR, lot size, and the growth centre plans'
  Residential Density Map, 25 dw/ha at Vineyard), the uses table, subdivision, what applies from above, and the clause
  tree as an evidence drawer. Key check against tests/answer-keys/precincts-*.json: see the next entry.
- 2026-10-15 later: keys vs claims. A table check straight from the database (each key's (unit, zone, use) against the
  claims on that table's items) agrees 99/99 after three fixes. (1) The reader expanded a group term only for
  permissions; "Residential accommodation" prohibited in Gosford B3 item 4 now prohibits its members (secondary
  dwellings, dual occupancies, seniors housing) unless an item lists them itself (shop top housing stays permitted) -
  permitted items are expanded first. (2) The keys read group members from nsw.lep_permissibility_hierarchy, which is
  01E's older list: no seniors housing under residential accommodation, dual occupancies only as its two kinds - so
  the keys called Gosford B3 dual occupancies and seniors housing "catch-all permitted"; answer-keys.py now reads each
  instrument's own Dictionary first (as the claims reader does) and keeps the previously keyed lots so their recorded
  answers stay comparable. (3) The Gosford chapter's frame (s 5.2, "land identified on the Land Application Map")
  failed on every lot: rag.map_polygon names that map "sepp (gosford city centre) 2018 land application" and the
  evaluator matched the clause's name exactly; it now accepts the former-plan name the way 02d-bindings already does.
  Gosford 99A Donnison St (ch.5 B3): secondary dwelling and dual occupancy prohibited, shop top housing permitted, by
  the chapter's own table. /api/rules/at (the norms path) was not re-run: the full key run ties up the dev server for
  minutes (it was stopped when it blocked the page); run it when the server is idle.

