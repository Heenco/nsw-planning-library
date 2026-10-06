# SEPP rule pipeline — design

How a State Environmental Planning Policy becomes rules a lot can be answered with, by the **same**
pipeline that does LEPs, re-runnable whenever an instrument changes. Companion to
[lep-rule-pipeline.md](lep-rule-pipeline.md) (the LEP extraction design) and
[rule-layer-pipeline.md](rule-layer-pipeline.md) (the rule layer in general). Progress is tracked in
[sepp-pipeline-progress.md](sepp-pipeline-progress.md), which is also the working memory of the `/loop`
that builds this.

Written 2026-10-07, against measurements taken that day.

---

## 0. Where we are

| | sections in `nsw.section` | rules | applicability | effects |
|---|---|---|---|---|
| 10 SEPPs (Housing, Codes, T&I, R&H, B&C, I&E, PS, PP, R&E, SB) | 255–7,154 each | **0** | **0** | **0** |
| 32 LEPs | — | 4,618 | — | — |
| 2 DCPs | — | 2,238 | — | — |

Housing SEPP: 2,650 sections (7 chapters, 28 parts, 29 divisions, 324 clauses), as at 2026-04-06.
The library copy (`public/EPI/SEPP/housing-sepp-2021.md`, XML `epi-2021-0714_2026-03-23.xml`) runs to
amendment 2026 (33). Neither has the 2026 Sydney Olympic Park amendment (epi-2026-133).

Everything the app answers from a SEPP today is **hand-built**, outside the graph:

| what | where |
|---|---|
| Housing SEPP Ch 6 (LMR) | `lmr.type / type_requirement / type_check / general`, `shared/lmr-evaluate.ts` |
| Codes SEPP prerequisites + codes | `cdc` schema, `server/api/cdc/types.get.ts` |
| Build-to-rent (s 72), in-fill bonus (s 15C) | `shared/housing-evaluate.ts`, `/api/housing/at` |
| Pattern Book (Codes 3BA, Housing Ch 7) | `server/api/pattern-book/at.get.ts` |
| SEPP permissibility by zone | `nsw.sepp_permissible_landuse` — 263 rows transcribed by hand, pre-2025 |

These become the **answer keys** (§6): the generated rules must reproduce them before any is retired.

### The case that shows what is missing

58 Bambara Crescent, Beecroft (Parramatta LEP 2023, R2, 100% "D" on the Dual Occupancy Prohibition
Map). The LEP rule layer correctly finds cl 6.11(1) — *consent must not be granted* for dual
occupancies. But Housing SEPP **s 166** permits dual occupancies with consent "on land to which this
chapter applies in Zone R2", s 164 makes that **the whole State** less its exclusions (none catch the
lot), and **s 8** makes the SEPP prevail over the LEP to the extent of inconsistency. So dual occupancy
is permissible. Nothing in the graph can say so: there is no SEPP rule, no notion of a chapter's
reach, and no "prevails" relation. (The hand-built LMR check also got it wrong, by tying s 166 to the
LMR walking catchments; s 170 and s 174 are tied to them, s 166 is not.)

---

## 1. What a SEPP needs that the LEP model does not have

The LEP model is *rule → applicability (zone, land use, map label) → effect (topic, comparator, value)*.
It fits most clauses. A SEPP adds seven things:

1. **Permissions that override.** "X is permitted with development consent on land Y" (Housing s 52,
   67, 72, 81, 154, 166, 170, 174) plus "this Policy prevails" (s 8) / "this chapter prevails" (s 153) /
   "despite the provisions of another environmental planning instrument" (s 169(1A)).
2. **Reach set once, inherited.** "Land to which this chapter applies" (s 164) and its exclusion list
   govern every rule under it. Same for s 79–80 (seniors), s 15C(1)/(2A) (bonus), s 152 (TOD councils),
   s 36 (RFBs by public authorities).
3. **Defined areas that are not mapped polygons.** "Low and mid rise housing area", "accessible area",
   the Six Cities Region, Schedule 11/12 stations, "relevant zone", "business zone".
4. **The kind of rule matters.** Non-discretionary standard (s 4.15(2): meet it and the council cannot
   ask for more) vs development standard vs matter for consideration vs condition of consent (15 years
   affordable, perpetual build-to-rent).
5. **Effects relative to the local control.** "Maximum permissible FSR plus up to 30%" (s 16); the 130%
   cap when bonuses stack (s 12A).
6. **Who and what is proposed.** ≥50 dwellings, ≥10% affordable; LAHC / AHO / CHP / public authority;
   pathway — DA, CDC, exempt, without consent (Part 5).
7. **Time and other instruments.** Savings and transitional (Sch 7A), commencement, and references to
   the Codes SEPP 3B/3BA, the Planning Systems SEPP SSD Sites Map, the Precincts SEPPs, R&H coastal maps.

---

## 2. Principles

1. **One pipeline, per-instrument data, no per-instrument code.** Adding the Codes SEPP is a profile
   file and an answer key, not a script.
2. **Hand-write what is judgement, extract what is text.** A frame (where a chapter applies, what it
   overrides) is a legal reading — written by hand, in the repo, reviewed. Clauses under it are
   extracted and span-gated.
3. **Reuse the LEP machinery** — section loader, readers bridge, recall gate, spatial resolver — and
   extend it; never fork it.
4. **Precedence is data.** The evaluator never hard-codes "SEPP beats LEP". It reads `instrument_rank`
   and `prevails` edges.
5. **Change-driven, idempotent, versioned.** A run that finds no changed source does nothing; a re-run
   upserts by stable key; a superseded rule is end-dated, not deleted.
6. **Nothing is published that fails its gate.** A run's output reaches the app only if recall passes
   and the answer-key lots agree.

---

## 3. Data model — extending what exists

Most of this is already in `nsw`:

| need | existing | change |
|---|---|---|
| source + currency | `source_registry` (label, raw_path, as_at_date, **content_sha256**) — **empty** | seed it; add `last_ingested_sha256`, `last_ingested_at` |
| run log, findings | `ingest_run`, `audit_finding` | none |
| rule role/kind | `rule.role`, `rule.kind` (permission, prohibition, disapplication, consent_trigger…) | add roles **`frame`**, `bonus`, `nondiscretionary_standard`, `condition` |
| precedence | `rule.instrument_rank`, `rule.precedence` | populate for SEPPs |
| relations | `rule_edge (edge_type, to_ref, cross_document)` | edge types **`prevails_over`**, `inherits_frame`, `excludes`, `relative_to` |
| who / what is proposed | `rule_applicability.dimension` | dimensions **`proponent`**, **`proposal_metric`**, **`pathway`**, **`defined_area`**, **`lga`** |
| defined terms | `scope_layer` (30 rows), `scope_layer_gap` | one row per SEPP defined term (§5) |
| section change detection | — | `section.content_sha256` |
| versioning | `document.as_at_date` | `rule.valid_from`, `rule.valid_to`; `rule_key` stays stable across runs |

Migrations go in `db/` as numbered files, additive only.

---

## 4. The instrument profile

`profiles/<instrument>.ts`, one per instrument, in the repo - a typed module (the YAML below shows the shape; the real file is `profiles/housing-sepp-2021.ts`). It is the only per-instrument input.

```yaml
instrument: epi-2021-0714            # Housing SEPP 2021
rank: sepp                            # precedence class
prevails: { over: [lep, dcp], clause: "8(1)", except: ["8(2)"] }
frames:
  - id: ch6
    scope: { section: ch.6 }          # every rule under ch.6 inherits this frame
    reach: { clause: "164(1)", land: state, except: [bush_fire_prone, coastal_vulnerability,
             chapter5_land, heritage_item, lga:[BATHURST REGIONAL, ...], flood_prone_gr_hn,
             flood_planning_area@lga:[...], anef25_anec20, pipeline_200m, sch12_station_800m,
             accelerated_tod, lmr_exclusion_map] }
    pathway: da
    prevails: { clause: "8(1)" }
  - id: ch6-lmr-area                  # nested: s 167-169, 170, 174 add the LMR-area condition
    parent: ch6
    applies_to: ["167", "168", "169", "170", "174", "175", "176"]
    reach: { defined_area: low_and_mid_rise_housing_area }
signals:                               # clause-wording patterns routed to roles (§5 step 4)
  permission: ['is permitted with development consent']
  override:   ['despite the provisions of another environmental planning instrument']
  nondiscretionary_heading: ['Non-discretionary development standards']
terms: [low_and_mid_rise_housing_area, accessible_area, six_cities_region, relevant_zone, ...]
answer_key: tests/answer-keys/housing-sepp-2021.json
```

---

## 5. The steps

| # | step | output | generic / per-SEPP | reuses |
|---|---|---|---|---|
| 1 | Register sources (hash, as-at) | `source_registry` | generic | `seed-source-registry.ts` |
| 2 | Load text, hash each section | `section` | generic | `ingest-nsw.ts --stage0-only`, `nsw-xml-parser.ts` |
| 3 | Instrument profile: frames, signals, terms | `rule` (role `frame`), `scope_layer` | **per SEPP, as data** | `lmr-criteria.ts` pattern |
| 4 | Route sections (operative / definition / objective / schedule / savings) + flag signals | routing + findings | generic + profile patterns | 08C routing |
| 5 | Extract applicability + effects, span-gated | `rule`, `rule_applicability`, `rule_effect` | generic | 08C readers bridge, `findNumberCandidates`, `dcp-cells`, `si-landuse` |
| 6 | Permissions and overrides → edges | `rule` (permission), `rule_edge` (prevails_over…) | generic | `rule_edge.cross_document` |
| 7 | Defined-term registry | `scope_layer`, `scope_layer_gap` | generic table, shared entries | 30 existing rows; `lmr`, `access`, `cdc`, `esa`, `epi` schemas |
| 8 | Spatial refs | `rule_spatial_ref` | generic | `resolve-map-refs.mjs` |
| 9 | Lot evaluator across instruments | `/api/rules/at` | generic | `testing/lep-rules.get.ts`, generalised |
| 10 | Answer keys + test lots | fixtures, `audit_finding` | generic harness, per-SEPP expected answers | existing hand-built routes |
| 11 | Coverage + visibility | `/graph`, testing page section | generic | `/graph` coverage |
| 12 | Orchestration: hash check → steps 2–8 for what changed → answer keys → publish or hold | `ingest_run`, findings | generic | 08C notebook structure |

Done-when checks for each step are in the progress file.

---

## 6. Answer keys and test lots

A fixed set of lots (target ~50), each with the expected verdict per pathway and land use from the
hand-built routes — or, where those are known wrong, from a reading recorded in the file with its
clause. Seeded with:

| lot | why it is there | expected |
|---|---|---|
| 58 Bambara Cres, Beecroft (100096265) | SEPP s 166 vs LEP 6.11(1) "D" | dual occupancy permissible (s 166, prevails by s 8); LEP 4.1C standards apply outside the LMR area |
| 13 Park Ave, Chatswood (102111896) | Willoughby LEP, map-ref heavy | LEP rule counts as measured 2026-10-07 |
| Penshurst R2 inside an LMR inner area | Ch 6 standards replace the LEP's | 450 m² / 12 m / 0.65:1 / 9.5 m |
| 46 Macquarie St, Parramatta (101984828) | MU1, accessible area | build-to-rent yes (zone), bonus yes |
| 200–208 Cowper St, Warrawong (101306849) | E2, bus-only accessibility | bonus yes; ssd Warrawong Site edge |
| a Sydney Olympic Park lot | s 15C(2A) exclusion | bonus excluded |

A generated verdict that disagrees with the key is a finding, not a pass. A key that is itself wrong
is corrected with a clause citation in the same commit.

---

## 7. Running it

```
python run_sepp_pipeline.py [--instrument epi-2021-0714] [--force] [--dry]
```

1. For each enabled `source_registry` row, hash the file; skip if unchanged since `last_ingested_sha256`.
2. Steps 2–8 for changed instruments only; within an instrument, re-extract only sections whose
   `content_sha256` changed. Upsert by `rule_key`; end-date keys that vanished.
3. Run the answer keys for every instrument touched (and every instrument with an edge to one).
4. All gates green → mark the run published; otherwise hold it and write the findings.

The only manual step is the source itself: legislation.nsw.gov.au refuses scripted reads, so a new
in-force XML is saved from a browser into `public/EPI/`. The registry then shows the saved copy as
newer than the graph, and the next run picks it up.

---

## 8. Order of work

1. Skeleton: steps 1, 2, 12 for all 10 SEPPs.
2. Housing SEPP Ch 6 through steps 3–11, answer key = `lmr` catalogue + Bambara.
3. Rest of the Housing SEPP: Ch 2 Div 1 and Ch 3 Pt 4 (keys exist), then Ch 3 Pt 5 seniors, Pt 3
   co-living, Ch 2 Div 2 boarding houses, Ch 3 Pt 1 secondary dwellings, Ch 5 TOD.
4. Codes SEPP against the `cdc` catalogue; then T&I and R&H, mostly frames and terms.
