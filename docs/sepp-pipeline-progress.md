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

### 2. Load text with section hashes — `todo`
Add `section.content_sha256`; backfill for the 10 SEPPs; reload Housing SEPP from the registered XML if
its hash differs.
**Done when:** every SEPP section has a hash; Housing SEPP section count and as-at match the XML.

### 3. Housing SEPP profile, Ch 6 frames — `todo`
`profiles/housing-sepp-2021.yaml`: rank, s 8 prevails, Ch 6 frame (s 164 reach + 13 exclusions), the
nested LMR-area frame (s 163 for s 167–176), signals, terms. Write frames to `nsw.rule` (role `frame`).
**Done when:** every Ch 6 operative section is under exactly one frame; Manni has reviewed the frames
(Open questions).

### 4. Route sections — `todo`
**Done when:** every Housing SEPP section has a route; Ch 6 signals found: permission (s 166, 170, 174),
override (s 169(1A)), non-discretionary (s 168, 169, 172, 173, 179, 180).

### 5. Extract Ch 6 rules — `todo`
**Done when:** recall gate passes on Ch 6 (every number in operative text claimed or explained);
s 168's 450 m², 12 m, 0.65:1, 9.5 m, 1 space extracted with spans.

### 6. Permissions and overrides — `todo`
**Done when:** s 166 / 170 / 174 are permission rules; s 8 and s 169(1A) are `prevails_over` edges to
`lep`; the Bambara conflict (s 166 vs Parramatta 6.11(1)) is representable.

### 7. Defined terms — `todo`
**Done when:** every term the Ch 6 profile uses has a `scope_layer` row or a `scope_layer_gap` row
(164(1)(f) flood prone land is a known gap).

### 8. Spatial refs for SEPP rules — `todo`
**Done when:** every Ch 6 map reference resolved or listed as a gap.

### 9. Lot evaluator across instruments — `todo`
`/api/rules/at?cadid=&use=` — frames that reach the lot, permissions vs prohibitions with `prevails_over`
deciding, standards and bonuses, controlling instrument named.
**Done when:** Bambara returns "dual occupancy: permissible with consent — Housing SEPP s 166, prevails
over Parramatta LEP 2023 cl 6.11(1) by s 8"; LEP standards (4.1C) apply because the lot is outside the
LMR area.

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

_(none yet)_

## Log

- 2026-10-07 — design and progress files written. Baseline recorded.
- 2026-10-07 — step 1 done: migration 17, registry of 55 sources, 10/10 SEPPs current-checked.
