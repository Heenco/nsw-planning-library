# Precinct SEPPs — design

How the four Precinct SEPPs reach the database and the report by the pipelines that already exist,
with one generic change underneath them: a lot is governed by an **instrument unit** resolved from
polygons, not by a plan name. Companion to [sepp-rule-pipeline.md](sepp-rule-pipeline.md) (frames,
profiles, publish gate) and [rag-plan](../shared/rag-plan.ts). Progress is tracked in
[precinct-sepp-progress.md](precinct-sepp-progress.md), the working memory of the loop that builds this.

Written 2026-10-15 against measurements taken 2026-10-13 to 2026-10-15.

---

## 0. Where we are

| Instrument | epicode | lots zoned (d_4 `lzn_epi_name_p`) | zoning km² | zone groups with a Land Use Table | LUT entries | entries outside the 203-term vocabulary |
|---|---|---|---|---|---|---|
| Precincts—Central River City 2021 | epi-2021-0725 | 60,631 | 83 | 87 | 2,914 | 296 |
| Precincts—Western Parkland City 2021 | epi-2021-0728 | 46,264 | 210 | 68 | 2,240 | 215 |
| Precincts—Regional 2021 | epi-2021-0727 | 10,881 | 192 | 8 | 337 | 6 |
| Precincts—Eastern Harbour City 2021 | epi-2021-0726 | 2,560 | 3 | 4 | 89 | 3 |

Plus ~2,400 boundary lots whose zoning name is a comma list with an LEP.

The XML and markdown copies are in `public/EPI/SEPP/` (dated 2026-03-22/23). `sources.ts` excludes
them on purpose, so: not in `nsw.document`, 0 rows in `nsw.lep_permissibility`, not in `rag.instrument`,
0 rules. Six lots tested on 2026-10-15 (`scratchpad r2/`): the EPI map section is right (zone, height,
density, land application naming the appendix); uses / subdivision / build controls answer
`engine: none`. Three things are **wrong, not missing**:

1. `shared/norms/facts.ts` defaults an empty Land Use Table to `prohibited`
   (`lut[k] = lep[0]?.status ?? 'prohibited'`), so the report prints "SEPP (Precincts—Central River
   City) 2021 prohibits seniors housing in R2" on ~120,000 lots for a table nobody has read.
2. 7 Nicholas Cres Normanhurst (Wahroonga Estate, SSP schedule) is answered from Hornsby LEP 2013:
   both zoning layers cover it 100% and `LIMIT 1` picks whichever comes first.
3. 3 Oulton Ave Sydney Olympic Park: an 11.6% Canada Bay LEP sliver is listed beside the SEPP and
   `/api/housing/at` attributes its verdict to Canada Bay.

### How the instruments are built (from the XML)

- One **chapter per former instrument**. Every chapter has a relationship clause: "this Chapter prevails
  to the extent of the inconsistency" (SSP, Growth Centres, Urban Renewal, Activation Precincts,
  Aerotropolis, Penrith Lakes, Gosford, Port Kembla, Cooks Cove); Homebush Bay, Gosford and Port Kembla
  carry exceptions; Moore Park Showground says the LEP "cease[s] to apply"; Western Sydney Parklands
  **disapplies** Housing SEPP Ch 3 Pts 8–9 and the Codes SEPP.
- The growth centre **precinct plans are appendices**, each a mini-LEP: own Land Use Table
  (clausegroup ids `app.N-inc-pt-cg1.Zone_X`, one `sch.12-...`), own dictionary, own maps
  (Land Zoning, Lot Size, Residential Density, Height, Key Sites, Development Control). Each appendix
  cl 1.3 applies the plan "to land within the X Precinct as shown on the Land Application Map", and
  several say the Land Application Map **differs** from the Precinct Boundary Map.
- The SSP site schedules and the City West, Olympic Park, Alpine and Activation chapters have **no
  zone tables**; permissions are sentences per site, zones are bespoke (A–I, WFU, PRC, PAE ...).
- `epi.epi_land_application` polygons for these SEPPs carry the unit: `lay_class = 'Appendix 12,
  Clause 1.3'`, `label` = precinct name (or `A`..`D` for the SW Growth Centre with `lay_class =
  'Liverpool Appendix 4, Clause 1.3'`). Urban Renewal and some SSP rows have `label` NULL.
- The XML parser (`server/utils/nsw-kg/parsers/nsw-xml-parser.ts`) knows `appendix` as a level,
  keeps the XML id as `local_id`, and treats `clausegroup` as transparent; `scripts/rag/01b-groups.py`
  restores the groups. So ingest should work unchanged — step 1 proves it.

---

## 1. The one generic change: the governing unit

Today every reader asks "which plan" and gets a name from the first zoning polygon under the lot's
point. For an LEP that is harmless. For a Precinct SEPP the name is not enough: the Land Use Table,
the dictionary and the maps belong to an appendix or chapter, and two instruments' zoning layers can
both cover a lot.

**Definition.** A lot's governing unit is `(document, unit_local_id)`, where:

- the **document** is the instrument whose zoning polygon covers the lot, taken at the lot's point on
  surface and confirmed by cover ≥ 50% (a sliver below that is "also mapped", never governing);
  where two instruments both cover it, the higher `instrument_rank` governs (EP&A Act s 3.28: a SEPP
  prevails over an LEP) — and the chapter's own relationship clause, once in the graph as a
  `prevails_over` edge, confirms or overrides that default;
- the **unit** is the top-level section the land application polygon names: `Appendix N` from
  `lay_class`, else the chapter the map belongs to, from the instrument profile's map table
  (§3); an LEP has one unit, its root; a SEPP polygon that names no unit resolves to `null` and
  every reader fails closed ("unit not held").

**Where it lives.** One derived table, `derived.lot_instrument` (cadid, document_title, unit_local_id,
unit_heading, zone, cover_pct, rank, basis, computed_at), built by one script for the whole state and
re-run after an epi load. Every reader that today joins `epi.epi_land_zoning ... LIMIT 1`
(`shared/norms/facts.ts`, `shared/rag/lot-facts.ts`, `server/api/housing/at.get.ts`,
`server/api/report/standards.get.ts`, `server/api/norms/use.get.ts`, `server/api/pattern-book/at.get.ts`,
`server/api/cdc/types.get.ts`, `server/api/lmr/types.get.ts`, `server/api/rules/at.get.ts`,
`shared/dcp/guard-facts.ts`) reads this table instead. No reader keeps its own rule.

**Why one table.** Twenty-three files query the zoning layer by name today. A fix in one of them is
the kind of per-case patch the standing rule forbids; a table makes the rule one place, measurable
(how many lots have no unit, how many have two instruments) and the same for all 151 instruments.

---

## 2. Principles (unchanged from the SEPP pipeline, restated for this work)

1. No instrument named in code. Per-instrument facts (map name → chapter, prevails exceptions,
   disapplied instruments) live in `profiles/<instrument>.ts`, reviewed, like `housing-sepp-2021.ts`.
2. The Land Use Table reader is the same reader for an LEP and for an appendix; only its key gains a
   unit. The vocabulary grows from each unit's own dictionary; nothing is hand-mapped.
3. Fail closed: an unknown unit, an empty table, an unread residual form all surface as "not held",
   never as prohibited and never as permitted.
4. Held until gated: nothing reaches a route until the answer-key lots agree; `publish_state`
   and `valid_from/valid_to` as in migration 17.
5. Commit locally, never push or deploy without asking.

---

## 3. The instrument profile (per Precinct SEPP)

`profiles/precincts-<city>-2021.ts`, the same module shape as `housing-sepp-2021.ts`, carrying:

- `rank: 30` and the per-chapter `prevails` reading (clause id, exceptions as quoted);
- `disapplies`: instruments a chapter switches off (Western Sydney Parklands: Housing Ch 3 Pts 8–9,
  Codes SEPP) — written as `excludes` edges from the chapter frame;
- `units`: one row per chapter and appendix: `local_id`, heading, how its land is found
  (`land_application` label/lay_class pattern, or `map_name` pattern) — the only place a map name
  is tied to a unit;
- `frames`: chapter reach from its "land to which this Chapter applies" clause, appendix reach from
  cl 1.3; pathway (DA / SSD per Planning Systems where a schedule says so);
- `answer_key`: `tests/answer-keys/precincts-<city>-2021.json`.

---

## 4. Data model — additive only

| need | change |
|---|---|
| governing unit per lot | new `derived.lot_instrument` (§1) |
| LUT keyed by unit | `nsw.lep_permissibility.unit_local_id TEXT NULL` (NULL = the instrument's root; every existing row unchanged); unique key widened to (epi_name, unit_local_id, zone_code, land_use) |
| vocabulary growth | `nsw.lep_permissibility_universe` gains rows from unit dictionaries with `source_document` / `source_unit`; the universe stays closed per run |
| map areas for the RAG | `rag.map_polygon` rows for the four documents, `map` = the appendix's own map name |
| frames / prevails / excludes | `nsw.rule` (kind `frame`), `nsw.rule_edge` (`prevails_over`, `excludes`) as migration 17 already allows |

Migrations in `db/` as numbered files.

---

## 5. What each report section gets

| section | today on a precinct lot | after |
|---|---|---|
| EPI maps | right | unchanged, plus the unit line: "Governed by SEPP (Precincts—Central River City) 2021, Appendix 11, Blacktown Growth Centres Precinct Plan" |
| standards (height / FSR / lot size) | right by plan name; slivers listed | read from the unit; a sliver shown as "also mapped" |
| uses (s 9) | `engine: none` | the unit's Land Use Table through the RAG engine, same as an LEP |
| subdivision | `engine: none`; false "prohibits seniors housing" | the unit's cl 4.1 / 2.6 analogues; empty table = "not held" |
| build controls | `engine: none` | the unit's standards clauses, map-valued |
| Housing SEPP / LMR / pattern book | LEP permission unknown, SEPP route answered | LEP-side permission from the unit's table |
| non-table chapters (SSP sites, City West, Olympic Park, Alpine) | nothing | frames + sentence rules, held until gated (§6 step 9) |

---

## 6. Order of work

Growth centre appendices first (CRC + WPC = 107,000 of 120,000 lots; standard-instrument shaped;
maps exist), then Gosford / Port Kembla / Bays West (chapter-level tables), then the sentence-only
chapters. Steps and their "done when" checks are in the progress file.

Not verified yet, each a short check inside the step that needs it: that appendix ids survive ingest
(step 1); that the height / FSR / lot size polygons are labelled per appendix rather than per growth
centre (step 6); the exact exception lists in the Homebush Bay, Gosford and Port Kembla relationship
clauses (step 3).
