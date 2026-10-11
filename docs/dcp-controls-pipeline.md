# DCP controls — the pipeline as built

Companion to `dcp-extraction-review.md`, which argued that the thing we were missing was not an
extractor but a *shape*. This document records the shape that got built, what it produced on three
councils, and how the result should reach a screen.

Code: `scripts/dcp-controls/` — `packets.ts`, `guards.ts`, `extract.ts`, `verify.ts`, `run.ts`,
`show-packets.ts`.

---

## 1. Why the old numbers were not usable

Measured on the live database, not from the earlier review:

| | Hornsby | Randwick |
|---|---|---|
| numeric effects | 890 | 954 |
| **indistinguishable from a sibling** — same rule, topic, comparator, unit and condition, different value | **442 (49.7%)** | **448 (47.0%)** |
| `topic = 'unspecified'` | — | — (576 across both) |
| substantive sections producing any rule | 474 / 1,581 (30%) | 1,614 / 3,504 (46%) |
| propositions carrying an embedding | **0** | **0** |
| `extraction_model` | `deterministic-v1` | `deterministic-v1` |

Three separate problems, which had been running together under one complaint:

1. **Grain.** Half the numbers cannot be told apart from a sibling that says something different.
2. **Coverage.** Two thirds of Hornsby's substantive sections produced nothing at all.
3. **Reach.** DCP propositions have no embeddings, so **no DCP has ever been retrievable** by `/ask`.
   The retrieval layer is good and the DCPs are simply not in it.

And `nsw.rule_proposition` is still 0 rows for every document, so nothing in the database can say which
evidence a rule was rolled up from.

### The canonical case, before

Hornsby clause 3.1.2, the whole of it, as the rule layer holds it today — 14 effects over 2 rules:

```
setback gte 0.9 m   storeys ≤1     Side boundary
setback gte 1.5 m   storeys 2      Side boundary
setback gte 3   m                  Secondary boundary (on corner lots)
setback gte 3   m   storeys ≤1     Rear boundary
setback gte 3   m                  Front boundary …
setback gte 6   m                  Front boundary …      ← five values
setback gte 7.6 m                  Front boundary …      ← identical scope
setback gte 9   m                  Front boundary …      ← nothing selects
setback gte 9   m                  Front boundary …
setback gte 8   m   storeys 2      Rear boundary
setback     None                   Waterfront setback
setback gte 7.6 m                  Attached dual occupancy
setback gte 9   m                  Attached dual occupancy
```

The storey-banded rows survived because storeys are a numeric band and there are columns for that.
"local road" and "designated road" are categorical, and there was nowhere to put them.

---

## 2. The three stages

Deterministic, model, deterministic. The model sits in the middle and is the only part that cannot be
replayed exactly, so it is given the least authority of the three.

### Stage 1 — the packet (`packets.ts`)

A **packet** is everything needed to interpret one control without reading the rest of the document:
the cell, the headers that scope it, the clause, the objective, the page.

This is the same instinct as the retrieval layer's propositions — a chunk that carries its own context —
applied to the half of the pipeline that never had it. The context was always in the HTML; the old
ingest read a cell in isolation and threw the rest away.

What it does that the old reader did not:

- **expands `rowspan` / `colspan` into a dense grid before reading.** Hornsby's document has 19 rowspans
  and 57 colspans across 150 tables. A flattened read mis-assigns their values silently.
- **carries the full header path**, not the nearest header.
- **carries the objective.** The converter already marks objectives up as `data-rubric="objectives"`
  siblings of the controls; the join had simply never been made. Under s4.15(3A)(b) the objective is
  what binds when the number is missed, so a control without it is legally incomplete.
- **keeps the page and source PDF**, so every claim can be checked against the original.

Measured output:

| | packets | table | prose | with objective | with page |
|---|---|---|---|---|---|
| Hornsby | 1,385 | 925 | 460 | 85.1% | 100% |
| Randwick | 3,073 | 1,205 | 1,868 | 63.8% | 100% |
| Parramatta | 6,124 | 1,064 | 5,060 | 89.7% | 100% |

Randwick's lower objective coverage is a document property, not a bug — it states fewer of them.

**These counts replace an earlier set that was 2-3x too high.** `dcp-clause` sections nest up to three
deep (1 > 1.1 > 1.1.1) and the builder walked all descendants of each clause, so a table inside 1.1.1
was emitted three times, once under each ancestor. Ownership is now nearest-clause-wins. The bug was
found by a per-row duplicate check, not by reading the code: two rows of Hornsby's driveway table
carried identical text under identical headers, which only a duplicate can produce.

### Stage 2 — the control (`extract.ts`)

**The model never emits a value.** It emits a frame, a topic from a closed list, a guard from the
registry, and for every branch the verbatim span that states it. The number is then read out of that
span by `findNumberCandidates` — the same function the recall verifier uses, so extraction and
verification cannot drift.

A model that cannot write a number cannot write a wrong one. What it can still get wrong is which words
to point at, and that is checkable.

Output grain is **RASE** (Hjelseth & Nisbet, CIB W78 2011): one control, many branches, each branch
carrying its own guard and its own span.

### Stage 3 — the gate (`verify.ts`)

Four gates, separated because a single confidence number is worthless — 22,091 of 22,109 propositions in
this database self-report 0.8–1.0 including the 14% that were flagged.

| gate | catches |
|---|---|
| **span** — every branch quotes the packet verbatim | invention |
| **vocabulary** — every guard and topic is in the registry | drift |
| **frame** — the frame's mandatory slots are filled | silent omission |
| **coherence** — branches differing in value must differ in guard | the grain failure, directly |

Nothing is deleted. A failure attaches a named finding and downgrades the control to `review` or
`rejected`, so a reviewer sees it. Silence is the one outcome the pipeline may not produce.

---

## 3. The guard registry (`guards.ts`)

**A guard term may only be used if something can answer it.** Three states, never silent omission:

- **site** (13 guards) — resolvable from data we hold, for any lot, now. `frontage_road_class`,
  `zone`, `lot_area`, `frontage_length`, `lot_width`, `is_corner`, `is_battleaxe`, `slope`, `locality`,
  `site_ref`, `map_area`, `heritage`, `foreshore`.
- **ask** (8) — a property of the proposal, not the site. `land_use`, `storeys`, `building_height`,
  `dwelling_count`, `bedrooms`, `gfa`, `wall_height`, `basement`.
- **none** (4) — declared unresolvable. `prevailing_building_line`, `existing_building_line`,
  `streetscape_character`, `adjoining_development`.

The third group is the point. Camden, Newcastle and Central Coast all lead their front setback with a
prevailing-building-line average we cannot compute. Saying so beats guessing, and it is exactly what a
scalar-only schema hides.

A guard the model invents is a finding, not a new guard. On the Hornsby parking run it invented six
(`dev_type`, `site_constraints`, `design`, `site_characteristics`, `waste_generation`, `roadway`) across
8 branches, and every one was caught by the vocabulary gate.

---

## 4. What it produced

### The canonical case, after

Hornsby clause 3.1.2 — **6 controls, 14 branches, the same 14 numbers, now all addressable**:

```
Front boundary · dwelling, dual occupancy (detached) · setback ≥ · metre · from front_boundary
  REQ  6 m    when frontage_road_class is local          “6m to local roads”
  REQ  9 m    when frontage_road_class is designated     “9m to designated roads”
  EXC  established line  when existing_building_line ≥ 7.6m     ⚠ unresolvable, declared
  EXC  3 m    when site_ref is Brooklyn Road, Brooklyn   “3m Brooklyn Road, Brooklyn”
  EXC  9 m    when locality is Cherrybrook               “9m to roads in Cherrybrook”

Side boundary   REQ 0.9 m when storeys ≤1 · REQ 1.5 m when storeys 2
Rear boundary   REQ 3 m   when storeys ≤1 · REQ 8 m   when storeys 2
Secondary (corner lots)   REQ 3 m default
Waterfront      deferral → “Clause 6.1 of HLEP Foreshore Building Line Map”
Attached dual occupancy   REQ 7.6 m default · EXC 9 m designated · EXC 9 m Cherrybrook
```

6 controls · 14 branches · 12 carry a number · 83% of those are guarded · 2 findings, both correct:
one genuine model error (a span written with an ellipsis instead of quoted — rejected) and one honest
declaration that the established building line cannot be computed.

### Hornsby 1.3.2 (parking and general controls), 178 packets

```
controls 178   ok 119 · review 37 · rejected 22 · failed 0
branches 211   144 carry a number
frames   rate 91 · dimensional 56 · narrative 20 · deferral 11
```

---

## 5. The rate frame — diagnosed, then built

The review predicted this and it is now demonstrated rather than argued. 91 of 178 controls in Hornsby
1.3.2 are parking **rates**, and forcing them through a (value, guard) branch model loses them:

| cell | what came out | what it says |
|---|---|---|
| `1/150m² GLFA` | value `null` | 1 space per 150 m² |
| `1/150m² GFA + 6 spaces/work bay` | `6` | two terms, one kept |
| `1 space/workroom + 1 space per 2 employees` | `1` | two terms, one kept |

Only **5 of 144** valued branches in that run carry a guard, because a parking rate is not conditional
on the site at all — it is a function of the proposal.

**A rate is a sum of terms, not a branch set.** `rates.ts` now parses them deterministically — the
grammar is small and regular, so the model has no advantage and a parser can be tested against every
distinct rate cell in the corpus, which `--self-test` does (21/21):

```
rate = [ { quantity, unit, perQuantity, perUnit } ] + qualifier
  "1/150m2 GLFA"                              -> 1 space per 150 sqm_glfa
  "1/150m2 GFA + 6 spaces/work bay"           -> 1 space per 150 sqm_gfa + 6 spaces per work_bay
  "1 space/workroom + 1 space per 2 employees"-> 1 space per workroom + 1 space per 2 employee
  "1 space per 5 seats min (subject to …)"    -> 1 space per 5 seat   [qualifier kept separately]
  "3-4% of spaces (See Note 1)"               -> 3-4% of spaces
```

**On the Hornsby parking clause: 83 of 91 rate controls now parse (91%).** The 8 that do not are
lead-in cells that genuinely state no rate ("Tenant parking, to be provided on-site, within the range
of:", "cash-in-lieu contributions.").

Four defects the self-test caught, all in the parser rather than the model:

- **the mangled superscript.** The converter writes "150m2 GLFA" as "150m 2 GLFA", and the normaliser
  required a word boundary before the `m` — there is none between a digit and a letter. Roughly a third
  of Hornsby's rate cells were reading the denominator as 2 instead of 150.
- **"1 loading bay per 400 sqm"** parsed to nothing: the numerator allowed `bay` but not an adjective
  in front of it.
- **a greedy denominator** swallowed the qualifier: "5 seats min (subject to parking study)" became a
  unit called `seats_min`. A denominator is at most three words and stops at the first word that starts
  a new thought.
- **irregular plurals** did not fold, so `children` and `child` would never join, and `class` became
  `clas`. 81% of the LEP entity join failure was morphology alone, so the small table earns its place.

And one that cost four probes to find: a `\b` written through a shell heredoc arrived in the file as a
literal backspace byte (0x08), so `/\bfor (?:every|each)\b/` was a regex matching a control character
and silently never matched. It is invisible in an editor and in `sed`; `od -c` is what shows it. Patches
go in a file, not a heredoc.

---

## 6. Storage

The existing tables are close and should be extended rather than replaced, so old and new rows coexist
and can be compared.

- **`nsw.control`** — one row per packet: frame, topic, comparator, unit, measured_from, per_unit,
  defers_to, objective_id, packet_key, page, source_pdf, status, coverage.
- **`nsw.control_branch`** — kind, guard, op, literal, value, value_upper, unit, terminal, source_span,
  ordinal. *This is the row that did not exist.*
- **`nsw.control_applicability`** — dimension, value, source_span. As today, but sourced from headers.
- **`nsw.control_finding`** — kind, detail. Every gate failure, visible.
- **`section_table_cell`** — add `row_span`, `col_span`, `header_path`. It has none today, which is why
  the spans were lost before extraction ever ran.
- **`nsw.rule_proposition`** — populate it. It is 0 rows for every document, so no rule can explain
  itself.

And **embed the packets**. The rendered packet is already a context-enriched chunk by construction, so
one embedding per control gives DCPs their first presence in retrieval. Today the answer to "what does
the DCP say about setbacks in Hornsby" is that `/ask` cannot see the DCP at all.

---

## 7. How to present it

### 7.1 The number that decides the design

A DCP is not a list of rules that all apply. Measured across the three councils, 510 controls of which
259 state a quantity, filtered to one lot and one proposal (a dual occupancy at 58 Bambara Crescent,
Beecroft — R2, Hornsby):

```
  reaches     15
  unknown     28   a scope we could not test yet
  excluded   216   83% of the document is about something else
```

**Four dimensions do all the excluding:** dev_type (70), locality (62), land_use (54), site_ref (16),
zone (13). A DCP spends a startling share of its text on named places and named sites — Dural Village,
Epping, Melrose Park Urban Renewal Precinct, "65-79 Macquarie Street" — and for any one lot almost all
of it is irrelevant.

So the answer to "does it apply to a specific development" is yes, emphatically, and the filter is
cheap. **43 controls to show, not 259.** That is a page. It is still far too many for a flat table,
which is the thing to design away from.

**508 of 510 controls carry a scope**, so there is almost nothing that has to be shown unconditionally.

### 7.2 Scope narrows; labels describe

A dimension either excludes a control or describes it, and conflating the two made everything
untestable in the first run. `dev_element` ("front boundary", "private open space") says which part of
the building a control is about, not whether it applies — as do `topic`, `objective` and `clause`,
which the model filed under applicability because the prompt offered it a slot.

Only a scope dimension may exclude. A label rides along and is shown beside the answer.

### 7.3 Three zones, never one table

**Zone 1 — the answer, grouped by topic, not by control.** A planner thinks in setbacks, height,
parking, landscaping; the DA is assessed that way. One card per topic, the answer in the headline:

> **Setbacks**
> front **6 m** · side **0.9 m** (1 storey) / **1.5 m** (2 storeys) · rear **3 m** / **8 m** · secondary **3 m**
> *objective: setbacks compatible with adjacent development and complementing the streetscape*
> front setback is 6 m because BROMLEY STREET is not a designated road — **why this number** ▾

Roughly twelve cards for a dual occupancy. Expanding one shows the branches that did not apply and
the verbatim words of each.

**Zone 2 — what we still need to know.** Do not render 28 "unknown" rows. Render the handful of
questions that would settle them, ordered by how many controls each unlocks:

> **How many storeys?** settles 8 controls
> **Is it attached or detached?** settles 5
> **Gross floor area?** settles 3

This is the most useful thing on the page: it converts a wall of uncertainty into a short form, and it
tells the applicant exactly what information is load-bearing. The guard registry already knows which
dimensions are `ask` and which are `site`, so the question list is generated, not written.

**Zone 3 — what does not apply, and why.** Collapsed, but present, with the reason:

> 216 controls do not apply — *dev_type is residential flat building (70) · locality is Epping (62) · …*

Absence must be **asserted**, not inferred from a missing row. Today nothing distinguishes "no rule
found" from "rule found, not triggered", and those are very different answers to give a planner. It is
also how a reviewer checks we did not simply miss something.

### 7.4 The ladder

Nothing is asked before it is needed, and every answer visibly shrinks the page.

1. **Lot alone** — zone, locality, heritage, flood, frontage road class, slope, frontage length all
   resolve with no questions. This already excludes the place-specific and zone-specific controls.
2. **One question: what are you building?** dev_type and land_use scope 450 of 510 controls, so this
   single answer removes about half of what survived step 1.
3. **The Zone 2 questions**, each stating what it unlocks.
4. **Per control**, on demand: the words, the clause, the table, the page, the other branches.

### 7.5 Never a red FAIL

s3.42(1) makes a DCP provision guidance, not a statutory requirement, and s4.15(3A) requires the
consent authority to be flexible and to allow alternatives that achieve the objective. So:

> *does not meet the stated control (6 m) — the objective is …, and an alternative that achieves it
> may be accepted*

The objective sits beside the number for exactly this reason. Mark the three cases where a DCP control
genuinely binds — complying development (s3.42(3)), LMR non-refusal standards, and the Housing Pattern
Book — differently, because there the language *should* be harder.

### 7.6 Five outcomes, and a verification mark

Outcomes extend the four-way verdict already used for LEP rules on `/testing-spatial-services`:
`meets`, `doesNotMeet`, `edgeCase` (a branch whose guard is declared unresolvable), `missingInfo`
(waiting on an `ask` guard), `notApplicable` (asserted).

Separately, and quietly, each control carries how it was verified — **agreed** (two independent routes
produced the same number), **flagged** (they did not), or **declared** (the guard is unresolvable).
Not a percentage, and not a confidence score: 22,091 of 22,109 propositions in this database
self-report 0.8–1.0 confidence including the 14% that were flagged.

### 7.7 The caveat that will bite

The scope values are free text — `residential flat building` and `residential flat buildings` and
`residential` are three different strings today, and `dual occupancy` will not match
`dual occupancies (attached)`. On the LEP side, **81% of the entity join failure was morphology
alone**. Until `land_use` and `dev_type` are normalised against the Standard Instrument's 203-term
vocabulary (`nsw.lep_permissibility_universe`, which carries the parent/child hierarchy), this filter
will both under-match and over-match, and no amount of UI design fixes that.

**Normalising the scope vocabulary is a precondition for the page, not a follow-up.**

## 8. Order of work

1. ~~**The rate frame.**~~ Built — `rates.ts`, 21/21 on the self-test, 91% on the Hornsby parking clause.
2. **Span columns on `section_table_cell`**, and `nsw.control*`. Load the three councils.
3. **Embed the packets.** DCPs enter retrieval for the first time.
4. **The panel**, as §7.
5. **Prose packets.** 1,276 Hornsby / 2,267 Randwick / 8,083 Parramatta, and the 274 `numeric_lead`
   findings are their unbuilt output. Tables first because the structure is strongest there.

## 9. Known limits

- A model error rate around **12% rejected / 21% review** on the one large run so far. The literature's
  96–99% figures are single-chapter and hand-tuned; models that generalise land in the low 80s. Plan
  review capacity for that, and do not quote an accuracy figure without saying which document.
- `scripts/planningai-datum-check.mjs` — 21 values read off the PDF by hand — is still the only thing
  that catches "high coverage, every number wrong". Extend it to the new controls before any bulk load.
- Some controls are **not in the document**: Pittwater 21 DCP states nine setback formulas that exist
  only as images, and 72 phrases in that one file have a blank where a number should be. The pipeline
  must emit `source_illegible` rather than "no control".
