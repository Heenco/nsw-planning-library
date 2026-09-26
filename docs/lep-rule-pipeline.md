# LEP rule extraction — the pipeline

How a NSW Local Environmental Plan becomes rules the resolver can answer with: **what the rule is,
when and where it applies, and what its effect is.**

Companion to [rule-layer-pipeline.md](rule-layer-pipeline.md), which sets out the rule-layer design
in general and the DCP-shaped implementation of it. This one is specific to LEPs, and it is written
against measurements rather than intent — every number below was taken from `planningai` or from the
pilot store on 2026-09-25.

---

## 0. Where we actually are

Three LEPs are in the graph. They were built two different ways, and neither way is a pipeline.

| | sections | rules | how the rules got there |
|---|---|---|---|
| Hornsby LEP 2013 | 1,214 | 88 | part4 pilot → `import-pilot-lep.mjs` |
| Randwick LEP 2012 | 1,173 | 112 | part4 pilot → `import-pilot-lep.mjs` |
| Parramatta LEP 2023 | 1,819 | **1** | hand-written script, one clause |

The repo's own LEP ingest contributed **only the section tree**. The run rows say so plainly —
`propositions: 0`, 1,350 ms for Hornsby and 1,342 ms for Randwick. `ingest-nsw.ts` stage 1, the LLM
decomposer, has never been run on an LEP.

Every LEP *rule* in the database came from the pilot, and about 80% of those are `src='ai'` — a
Claude-subagent pass that lives in the Notebooks repo, covers 8 of 147 LEPs, and cannot be run from
here. That is the whole of the problem.

**There is no LEP equivalent of `ingest-dcp.ts`.** That is the thing to build.

---

## 1. What already works, and must be reused

The extraction machinery exists and is **not DCP-specific**. Proven against Parramatta LEP prose read
straight out of `nsw.section.raw_text`:

```
"the area of the lot is at least 600m2"
  findNumberCandidates → {value:600, unit:"sqm", comparator_hint:"at least", category:"obvious"}
  parseSizeBand        → {metric:"lot_size", unit:"sqm", lo:600}

"at least a 15m wide frontage to a public road"
  findNumberCandidates → {value:15, unit:"metre", comparator_hint:"at least"}
  datumOf              → road_boundary
```

| what | where | note |
|---|---|---|
| number detection | `verifiers/candidates.ts` `findNumberCandidates` | **shared by extraction and the recall verifier, so they cannot drift** — keep it that way |
| value readers | `scripts/lib/dcp-cells.mjs` | 25+ pure-text readers. Misnamed; nothing in it is DCP-bound |
| land uses | `scripts/lib/si-landuse.mjs` `matchLandUses` | Standard Instrument vocabulary, already correct on LEP text |
| span gate | `verifiers/precision.ts` | literal-substring check |
| sections | `parsers/nsw-xml-parser.ts` | already produces the tree for all three LEPs |

**First move: rename `lib/dcp-cells.mjs` → `lib/controls-read.mjs`.** One reader set, several
front-ends. The name is the only thing tying it to DCPs, and leaving it there is how a second copy
gets written.

---

## 2. What the pilot gets right that the database does not

The graphs on `:8000` render the pilot's SQLite store, so the store is the model those viewers show.
Comparing it to `nsw.*` for Hornsby gives the specification for free — anything the store carries
that the database does not is something today's route loses.

The core survives the import intact: rule 88→88, `rule_applicability` 221→221 with an identical
dimension vocabulary (`zone` 102, `land_use` 88, `act` 25, `area_label` 5, `site_ref` 1), objectives
71→71, propositions 248→248.

Four things do not:

**`rule_effect.value`: 42 populated in the pilot, 29 in the database.** Thirteen numbers are lost on
import, silently. Nothing reports it. This is a bug to find before it is a design input.

**No spans on effects.** `nsw.rule_effect.source_span` exists and is `NULL` for all 68 Hornsby and all
77 Randwick rows. The pilot grounds at extraction time in `merge_packets.py`, but the span lives on
`proposition.source_span` and `numeric.span`, one level away, so the importer had nothing to carry.
The consequence is concrete: **the existing LEP rule layer cannot be re-verified against the text in
the database.** You have to go back to artefacts in another repo.

**The recall net is gone.** The pilot's `numeric` table holds *every* number in a clause — 72 for
Hornsby against 68 effects — explicitly including "thresholds and variation limits the rule layer
doesn't carry". `nsw` has no equivalent, so there is nothing to audit completeness against.

**Conditions and their referents are gone.** `condition` (45 rows) and `proposition_ref` (157) have no
`nsw` home. `nsw.proposition` does have `conditional_on`, `refs` and `refs_resolved`, so the model is
there; the import just does not populate them.

Also worth knowing: `rule_edge` goes the other way, 15 → 64, because the importer expands
clause-level edges into rule-level ones. And `spatial_ref` 26 → 14, so twelve are dropped.

---

## 3. Three kinds of claim, three treatments

The temptation is to split this work by *stage*. The split that matters is by **what kind of claim is
being made**, because each kind has a different failure mode and a different way of being checked.

| kind of claim | example | who extracts it | how it is checked |
|---|---|---|---|
| **literal** | `600`, `m2`, `at least` | deterministic | the value appears verbatim in the span |
| **entity** | `dual occupancy`, `R2`, `subdivision`, `Area 1` | **semantic, against a closed vocabulary** | the term is a member of the vocabulary |
| **relation** | cl 4.6 *can_vary* cl 4.3; cl 6.11 *disapplies* … | **semantic, open-ended** | a span supports it, and both ends resolve |

Getting this wrong in either direction is expensive. Let a model retype a number and you get a
plausible wrong figure that no gate catches. Try to regex your way to *"land in a zone in which dual
occupancies are permitted"* or *"despite clause 4.3"* and you get nothing at all — which is precisely
what the pilot's deterministic backbone produced for Parramatta cl 4.1C: no numbers, and `["R4"]`
where the clause says R2, R3 **and** R4.

### The invariant that makes semantic extraction safe

> **The model never emits a value. It emits a vocabulary term, or a span, or both.**

Every semantic claim is therefore checkable without judgement:

- a term must be a member of a closed set, or it is rejected;
- a span must be a literal substring of the clause, or it is rejected;
- a number is read from the span **deterministically**, by the same
  `findNumberCandidates` the verifier uses — never copied out of model output.

This is what makes the approach expandable rather than merely powerful. Onboarding a council adds no
code and no prompt. Widening coverage is a row in a vocabulary table. And every claim in the database
can be re-checked against the text in the database, which is not true of the LEP rule layer today.

### The vocabularies are already here

This is not a closed set we have to invent — most of it is loaded:

| dimension | closed set | where |
|---|---|---|
| `land_use` | **203 terms with `is_parent`**, so the hierarchy comes too | `nsw.lep_permissibility_universe` |
| `zone` | the Standard Instrument zones | `nsw.lep_zones`, `epi.epi_land_zoning` |
| `act` | erection · subdivision · strata subdivision · community title subdivision · use | small, fixed, needs writing down |
| `area_label` | per-LEP, from the map layers | `epi.epi_local_provisions`, `epi_key_sites` |
| `topic` | lot_size · height · fsr · setback · … | already in use across 1,995 effects |

`matchLandUses` in `lib/si-landuse.mjs` already does the linking, and 248 propositions already carry
embeddings, so retrieval over the vocabulary is available rather than hypothetical.

### What the knowledge-twin platforms get right, and what it costs us not to

Platforms like [Nextspace](https://www.nextspace.com/platform) solve a different problem — unifying
BIM, GIS, IoT and ERP for an asset owner — but the part they are disciplined about is exactly the part
we are not. Their argument against "file federation" is that stacking sources together *"doesn't
create shared meaning"*: a pipe in BIM stays disconnected from the same pipe in GIS because they exist
in separate conceptual spaces. Their answer is a GUID per component, an explicit typed ontology of
relationships, and **every attribution time-stamped**.

Applied here, three measurements say we have the federation problem, in our own data.

**1. Our entities are strings, and they do not resolve.** `rule_applicability` stores
`dimension='land_use', value='dual occupancy'` — text, repeated. `nsw.lep_permissibility_universe`
holds the canonical 203 terms. **Only 25 of the 100 distinct `land_use` strings in the rule layer are
members of that universe.** The misses are not exotic:

```
residential flat building  87    universe has "residential flat buildings"
dwelling house             29    universe has "dwelling houses"
dual occupancy             23    universe has "dual occupancies"
dwelling                   40    not a Standard Instrument term at all
medium density housing     23    not a Standard Instrument term at all
```

That is the pipe in BIM and the pipe in GIS. A rule scoped to `dual occupancy` **cannot be joined** to
a permissibility row for `dual occupancies`, and the repo's own notes already warn that fuzzy-matching
this vocabulary leaks (co-living and ILU into open zones). Singular-vs-plural is not a tidy-up job; it
is two conceptual spaces.

`act` is worse — 22 distinct strings with no canonical set, including `development` (too broad to
mean anything) and `dual occupancies` (a *use*, misfiled as an act). `zone` is the healthy one, 29
strings, because zone codes are already canonical in the source.

**2. Our ontology exists, but as text in a derived column.** The universe flags 32 terms
`is_parent` — and carries **no parent pointer**. The hierarchy survives only inside
`lep_permissibility.derived_from`, as strings like
`commercial premises > retail premises > food and drink premises`. So the taxonomy is real, known,
and unusable as a graph. The cost is visible: `nsw.lep_permissibility` is **483,598 rows**, of which
**142,014 are `rolled_up` or `inherited`** — pre-computed traversals of a hierarchy that is not stored
as one, plus 261,799 `catchall` rows asserting "everything not otherwise mentioned". Make the taxonomy
edges and most of that becomes a traversal instead of a table — and, more importantly, a clause about
*residential accommodation* would reach *dual occupancy (attached)* on its own, which is what the
clause means.

**3. Nothing is time-stamped.** `rule` and `rule_effect` have **no temporal columns whatsoever**
(`measured_from` is a datum, not a date). Planning instruments are amended constantly, and we already
have a case with nowhere to live: Parramatta cl 4.6(8A) — *"Subclause (8)(cb) does not apply from the
beginning of 31 July 2024"*. A live provision, switched off on a date. Today that is a prose note in
`rule.notes` because there is no `valid_from` / `valid_to` to put it in.

#### What that changes in this design

| | before | after |
|---|---|---|
| applicability | `(dimension, string, polarity)` | edge to an **entity with an id**; the string becomes a label + span |
| vocabulary | closed set, membership test | **entity resolution** — resolve to a canonical entity, or admit as unresolved and queue it |
| taxonomy | `is_parent` boolean, hierarchy in a string | `broader_than` / `narrower_than` edges between entities |
| validity | none | `valid_from` / `valid_to` on rules and effects, defaulting to the instrument's commencement |

The second row is a correction to what I wrote earlier in this document. I proposed a **vocabulary
gate** that rejects any term not in the closed set. Against this measurement that gate would reject
**75% of the land uses already in the graph**. Nextspace's framing is the better one — *start with
incomplete sources and add more as you go, the ontology evolving without a costly data-cleansing
project*. So: resolve what resolves, admit the rest as unresolved entities with their spans, and let
the unresolved count be a reported number. A term appearing across many LEPs is then a signal that the
vocabulary is missing something, not a parse failure.

**What does not transfer:** digital twins ingest structured systems. They have no equivalent of our
hard problem, which is getting assertions out of prose. This is a lesson about the target model, not
about extraction.

### What a planner does that the extractor does not

Worth asking how a human resolves the same text, because three of the mechanisms are cheap to build
and each one maps onto a defect measured above.

**Concepts, not tokens.** A planner reading *"dual occupancy"* in cl 4.1C and *"Dual occupancies"* in
the land use table never experiences two things. Surface form is discarded on the way in; what is
stored is a concept. Splitting our 100 land-use strings that way:

```
exact member of the universe        25 terms    84 rows
same concept, different surface     59 terms   369 rows   ← singular/plural, nothing more
genuinely absent from the vocabulary 16 terms   105 rows

resolvable by concept, not token    84 of 100 terms (84%), 453 of 558 rows (81%)
```

So **81% of the join failure is morphology** — `residential flat building` → `residential flat
buildings`, `dual occupancy (attached)` → `dual occupancies (attached)`. That is a lemmatiser, not a
model. The remaining 16 terms are the interesting ones, and they are not one problem: `dwelling` (40
rows) is a *genus* a planner resolves from context; `child care centre` and `tertiary institution` are
*synonyms* for `centre-based child care facilities` and `educational establishments`, which needs
knowledge rather than morphology; `restaurant or cafe` is a *disjunction of two uses* in one string.

That is the honest scope of the semantic layer for entity resolution: **16 terms, not 100.** Morphology
first, embeddings and a model only for what survives it — and gated, as ever, by "must resolve to a
member of the universe".

**Frames, not pattern-hunting.** An experienced reader approaches a control clause with slots already
open: a development type, a place it applies, a standard with a direction and a number, and the
exceptions. Slots that stay empty are *noticed* — "this clause never says which zone". Our extractor
hunts for patterns and silently omits whatever it does not find, which is why cl 4.1C reached the
pilot with no numbers and one zone. Give each clause role a frame with mandatory slots, and an
unfilled mandatory slot becomes a finding rather than an absence. This is also why role
classification belongs *before* detailed extraction, not after: the role chooses the frame.

**Prediction, and surprise as the signal.** Reading cl 4.1C, the heading *"Minimum **subdivision** lot
size"* sets an expectation; the body says *"**Development** … may be carried out on a lot … if"*. A
planner feels that mismatch and looks harder. That is precisely the `act` trap, and it generalises:
**predict from one route, extract from another, and treat disagreement as a finding.** Heading versus
operative verb. Deterministic reader versus semantic agent. Two agents with different schemas.

This is also the answer to confidence. 22,091 of 22,109 existing propositions self-report 0.8–1.0,
including the flagged 14% — asking a model to introspect on its own certainty produces a number that
means nothing. Human confidence does not come from introspection either; it comes from independent
routes agreeing. **Disagreement between routes is the only honest uncertainty signal available, and
it is deterministic to compute.**

### Role-split agents, narrow schemas

`rule-layer-pipeline.md` §3 already names the right shape and this pipeline should use it rather than
one general prompt: **segmenter · numeric · conditionality · applicability · reference**. Each agent
gets a narrow output schema, so a failure is localised and re-runnable, and validation is tight
enough to be automatic. The pilot's `section_packets.py` is the working precedent — and its output,
`clause_semantics.json`, is a committed artefact, which is why those 146 edges are re-checkable.

**Relations are the agents' most valuable output, not an afterthought.** `overrides`, `can_vary`,
`relaxes`, `disapplies` are what turn a pile of standards into something a resolver can reason with,
they are irreducibly semantic, and the existing graph shows they can be extracted with spans at a
121-of-146 rate. Anything that treats them as a post-processing step has the priorities backwards.

## 3a. The pipeline

Driven off `nsw.section` — which already exists for any LEP after
`ingest-nsw.ts --doc <label> --stage0-only`, deterministically and in about a second.

```
        nsw.section  (stage 0, exists)
              │
   1  route   │  objectives │ operative │ table │ note        deterministic
              ▼
   2  harvest ── nsw.clause_numeric ──────────────────────┐   EVERY number, with span
              │                                            │   ← the recall contract
   3  scope   ── rule_applicability                        │
              │     zone · land_use · act · area_label     │
              │     lot_type · size_band · polarity        │
   4  effect  ── rule_effect                               │
              │     topic · comparator · value · unit      │
              │     datum · condition band · map deferral  │
              ▼                                            │
   5  rollup  ── rule                                      │
              │                                            │
   6  relate  ── rule_edge                                 │
   7  geocode ── rule_spatial_ref                          │
              ▼                                            ▼
   8  audit   ── nsw.audit_finding ◄───────────── every harvested number is
                                                   claimed by an effect, or
                                                   explained, or it is a finding
```

### Three gates, not one

Each kind of claim gets the gate that can actually catch its failure mode. All three are
deterministic, run on every row, and need no human in the loop.

| gate | asks | catches |
|---|---|---|
| **span** | is the quoted text a literal substring of the clause? | fabricated evidence |
| **vocabulary** | is this term a member of the closed set? | invented uses, hallucinated zones, `act` drift |
| **recall** | is every harvested number claimed by an effect, or explained? | silent misses |

The recall gate is the weakest of the three and I over-sold it in the first draft of this document.
It measures **numbers**, and numbers are the easy part — the questions that decide an application are
*which use, which zone, which act, what overrides what*, and the recall gate is blind to all of them.
Keep it: it is cheap, it works on all 147 LEPs from day one, and unclaimed-number counts are a real
signal. But it is a floor, not a backbone.

The vocabulary gate is the one that scales semantic extraction safely, because it converts an
open-ended generation problem into a membership test.

### Why deterministic-first was the wrong frame

The first draft proposed: extract deterministically, measure the gap, escalate to a model where the
gap shows. **That experiment has already been run.** `lep_part4_pipeline.py` *is* a deterministic pass
over all 147 LEP XMLs, and what it produces for Parramatta cl 4.1C is no numbers and the wrong zone
list. Of Hornsby's 88 rules, 70 are `src='ai'`; of Randwick's 112, 76. The deterministic subset is
the `table`, `map` and `schedule` rules — real, but the minority, and precisely the rules whose
structure was already explicit in the source.

So the sequencing is not "deterministic, then AI where it fails". It is **both from the start, split
by kind of claim**: deterministic owns literals and structure because it is exact there and a model
is not; semantic owns entities and relations because they are irreducibly semantic and deterministic
extraction produces nothing at all.

What survives from the first draft is the discipline, not the order: extraction and verification must
keep sharing `findNumberCandidates`, or the recall gate measures nothing.

**Council-specific knowledge lives in data, never in code.** Anything that varies by council belongs
in a lexicon table, not a branch in a script. The `add-lep-clause-46.ts` I wrote — a hand-keyed map of
one council's effects — is the anti-pattern, and it should be deleted once stage 4 reproduces it.

**One reader set, several front-ends.** LEP XML, DCP HTML and later SEPP markdown differ only in how
they become sections. Everything after stage 1 is the same code.

### Traceability is a requirement, not a feature

**Every claim must answer: which words, in which clause, of which version of which instrument,
produced by which run of which extractor.** If a number on a property report cannot be walked back to
the sentence it came from, it is an assertion, and a planner cannot use an assertion.

This is also the cheapest possible insurance. An instrument gets amended; a model gets swapped; an
extractor gets a bug. Each of those is survivable if you can ask *which rows came from the thing that
changed* — and unanswerable if you cannot.

#### Where it stands today, measured

| link | DCP (deterministic) | LEP (AI, imported) |
|---|---|---|
| `rule_effect.source_span` | **1,850 / 1,850 — 100%** | **2 / 147 — 1.4%** |
| `rule_applicability.source_span` | **3,486 / 3,486 — 100%** | **1 / 488 — 0.2%** |
| `rule_edge.source_span` | — | 101 / 146 — 69% |
| `proposition.source_span` | 626 / 626 — 100% | 737 / 737 — 100% |
| `rule.section_id` (rule → clause) | 100% | 100% |
| `rule_proposition` (rule → evidence) | **0 rows** | **0 rows** |

Read that table carefully, because it says the opposite of what people assume about AI extraction.
**The deterministic path is perfectly traceable and the AI path is not — but not because the model
failed.** The pilot grounds every semantic claim in `merge_packets.py` and refuses anything
ungrounded; `proposition.source_span` is 737/737 for LEPs. The spans exist. **`import-pilot-lep.mjs`
simply does not carry them onto `rule_effect` and `rule_applicability`.** The loss is in the plumbing,
one join away from the evidence.

The `rule_proposition` row count is the other half of the same hole: the join that says *which
evidence this rule was rolled up from* is empty for every document in the database, deterministic and
AI alike. Nothing can currently explain why a rule says what it says.

#### What the pipeline must carry

| on every claim row | why |
|---|---|
| `source_span` **and** `source_offset` | the span proves it; the offset re-anchors it when the text shifts |
| `section_id` | which clause. Already 100% — keep it that way |
| `ingest_run_id` → `nsw.ingest_run` | which run. Lets you retire or re-run a batch by provenance |
| `extractor` + version | which code produced it; `src` is too coarse to act on |
| `model` + `prompt_version` (semantic claims only) | a model swap is a reason to re-verify a subset |
| `rule_proposition` populated | rule → the evidence it was rolled up from |

And on the document: `consolidation_id` pins the instrument version. LEPs and SEPPs have it (3/3 and
10/10); **DCPs have none (0/2)** and rely on `currency_basis`, which the LEPs in turn lack (0/3).
Each document type traces its version a different way and neither is complete.

#### Two behaviours that follow from it

**A span that stops matching is a finding, not an overwrite.** On re-ingest, every stored span is
re-checked against the new text. A span that no longer resolves means the clause was amended — which
is exactly the event you want raised, and exactly the event a blind rebuild hides.

**The acceptance test is a single query.** From any figure the report shows, one query returns: the
value, the exact words, the clause, the instrument and its consolidation, and the run and extractor
that produced it. If that query cannot be written, traceability is not done — and today it cannot be
written for any LEP rule in the database.

### Schema changes

Small, because the model is mostly there.

| change | why |
|---|---|
| **new** `nsw.clause_numeric(section_id, value, unit, comparator_hint, category, span, offset, claimed_by)` | the recall net. `claimed_by` points at the effect that consumed it, `NULL` = unclaimed |
| **new** `nsw.entity(id, kind, canonical_label, status)` + `nsw.entity_edge(from, to, type)` | ids for land uses, zones, acts, areas and topics, and the taxonomy as edges rather than a string in `derived_from` |
| **new** `rule_applicability.entity_id` beside `value` | keeps the verbatim label and its span, adds the resolved entity |
| **add** `valid_from` / `valid_to` on `rule` and `rule_effect` | Parramatta cl 4.6(8A) switches a live provision off from 31 July 2024 and there is nowhere to record it |
| **add provenance to every claim table** — `source_offset`, `ingest_run_id`, `extractor`, `model`, `prompt_version` on `rule_effect`, `rule_applicability`, `rule_edge`, `objective` | today `rule_effect`, `rule_applicability` and `objective` have **no provenance columns at all**; `rule` has only `src` and `created_at` |
| populate `rule_effect.source_span` / `rule_applicability.source_span` | the columns exist; LEP rows are 1.4% and 0.2% filled |
| populate `nsw.rule_proposition` | **0 rows in the entire database** — nothing can explain why a rule says what it says |
| `consolidation_id` on DCP documents | 0 of 2; LEPs and SEPPs have it and DCPs do not |
| populate `proposition.conditional_on` / `refs` | the pilot's `condition` and `proposition_ref`, in the home they already have |
| fix the effect-value loss | 13 of 42 Hornsby values dropped on import; find it before designing around it |

### The two extraction problems that are actually hard

Everything else is plumbing. These two decide whether the output is trustworthy.

**1. The `act` dimension cannot be read from the heading.** Parramatta cl 4.1C is headed *"Minimum
**subdivision** lot size for dual occupancies and manor houses"* and its operative words are
*"**Development** for a purpose specified in the table … may be carried out on a lot … if"*. It is a
standard to **build**, not to subdivide. Hornsby states the same distinction across two clauses —
4.1C at 700/800/900 m² to build, 4.1D at 350/400/450 m² to subdivide — and the graph keeps them apart
only because the pilot got `act` right. Read `act` from the operative verb, and when the verb and the
heading disagree, record both and raise a finding.

**2. Banded controls written as prose.** Parramatta cl 4.3(2A) states lot-size → height bands —
950 m²→15 m, 2,100 m²→21 m, 3,200 m²→39 m/52 m — and `findNumberCandidates` returns all ten numbers
**unpaired**, while `parseSizeBand` takes only the first. Tables solve this with
`readTableShape`/`chooseCondition`; prose needs the same pairing logic, reading left to right and
treating the size as `condition_lo`/`condition_hi` rather than as a value. Getting this wrong is the
Hornsby Table 3.1.2-a failure again: *"the storey number is a condition, not a value."*

### Two reader defects to fix in passing

- `topicOf` over a whole clause guesses wrong — `setback` for cl 4.1C (a lot-size clause), `width`
  for cl 6.11 (a prohibition with no numeric). Topic must come from the effect's own signal;
  `parseSizeBand` read `lot_size` correctly off the same text.
- The pilot's deterministic backbone is lossy and must not be treated as a baseline: for Parramatta
  cl 4.1C `nodes.jsonl` carries **no numbers at all** and `zones:["R4"]` where the clause says R2,
  R3 **and** R4.

---

## 4. Validating it

Not by matching Hornsby and Randwick. About 80% of their rules are `src='ai'` — scoring against them
measures agreement with an earlier model, not correctness.

The ground truth is narrower and real:

1. **The deterministic subset of the pilot** — the `table`, `map`, `schedule1` and `schedule2` rules:
   18 of Hornsby's 88, 36 of Randwick's 112. A new extractor should reproduce these exactly.
2. **The recall gate** — unclaimed numbers per clause, which needs no prior extraction to score
   against and works on all 147 LEPs from day one.
3. **Hand-read control values**, the way `planningai-datum-check.mjs` does for DCP setbacks: take a
   clause, read its numbers off the instrument by hand, assert the database reproduces them. This is
   the only check that measures against the document rather than against the last run.

Then the `ai` 80% becomes the interesting measurement rather than the target: *how much of what the
agent pass found can a deterministic pass reach on its own, and what is genuinely left for a model?*

---

## 5. Order of work

The order is chosen so the **gates exist before the extractors they police**. Building an extractor
first and a check for it later is how 22,091 of 22,109 propositions ended up self-reporting 0.8–1.0
confidence, 14% of them flagged.

0. **Make the existing rows traceable before adding more.** Carry the pilot's spans onto
   `rule_effect` and `rule_applicability` — they exist, 737/737, one join away — populate
   `rule_proposition`, and find the 13 lost values. This is a day of work on
   `import-pilot-lep.mjs`, it makes 235 existing LEP rules verifiable, and it is the honest
   precondition for trusting anything the new pipeline writes.
1. **Build the entity layer.** Promote `land_use`, `zone`, `act`, `area_label` and `topic` to
   entities with ids; turn the taxonomy in `derived_from` into `broader_than` edges; resolve the
   existing applicability strings against them and report the unresolved (today that is 75 of 100
   land uses). Resolution, not rejection - an unresolved term is a queued entity with a span, and its
   frequency across LEPs is the signal that the vocabulary is short.
2. **Rename `lib/dcp-cells.mjs` → `lib/controls-read.mjs`.** No behaviour change; stops a second copy
   being written.
3. **`nsw.clause_numeric` + the harvest + the recall gate.** Cheap, runs on all 147 LEPs immediately,
   and gives a baseline number before anything else is built.
4. **The applicability agent** — entities only, emitting `(dimension, vocabulary term, span,
   polarity)` and nothing else. This is the highest-value single component: `zone`, `land_use` and
   `act` are what decide whether a rule reaches a lot, and `act` is the one the heading lies about.
5. **The effects reader** — deterministic, reading numbers out of the spans the agent points at,
   including prose band pairing. Spans on every row.
6. **The relation agent** — `overrides` / `can_vary` / `relaxes` / `disapplies`, each with a span and
   both ends resolved. Score it against the existing 146 edges, which are 121 span-grounded.
7. **Run all 147 and publish the three gate tables.** Span failures, vocabulary rejections, unclaimed
   numbers — per clause, per LEP. That table is the product; everything above it is machinery.
