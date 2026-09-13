# DCP extraction — review and design

Written after a review of what the rule layer actually holds for Hornsby and
Randwick, and a survey of what everyone else in this market has managed. It
supersedes nothing in `rule-layer-pipeline.md` — that document's stage list and
its account of Hornsby's Table 3.1.2-a are still right. This one says what the
grain should have been, and why the thing we are missing is not an extractor
but a *shape*.

The short version: **a control cell is not a value, it is a small decision
table**, and we have been flattening it. Every number survives; the condition
that selects between them does not.

---

## 1. The problem, measured

Ask the DCP panel for a dual occupancy on a Hornsby lot and it returns fourteen
setbacks, four of them front setbacks — 3 m, 6 m, 7.6 m, 9 m — all citing
clause 3.1.2, all indistinguishable. They come from one cell:

> Front boundary (Primary frontage) Dwellings and detached dual occupancies |
> Minimum building setback | **6m to local roads and 9m to designated roads**,
> except for the following ▪ On local roads, where an existing setback of …

The cell states a conditional. The extractor pulled out every number and
emitted five effects — 9 m twice — hanging off **a single `rule` row** with one
applicability set. Nothing distinguishes them because nothing can: the storey
conditions on the rear and side setbacks survived (`condition_metric`,
`condition_lo/hi`) only because storeys are a *numeric band*. "Local road" and
"designated road" are categorical, and there is no column for that.

Across both documents:

| | Hornsby | Randwick |
|---|---|---|
| numeric effects | 890 | 954 |
| **indistinguishable from a sibling** — same clause, topic, datum, comparator, condition and applicability, different value | **509 (57%)** | **567 (59%)** |
| exact duplicate rows | 167 | 149 |
| `topic = 'unspecified'` | 195 | 380 |

Nearly a third of extracted numbers do not know what control they are, and
well over half cannot be told apart from a sibling that says something
different. The pipeline's own audit already carries the diagnosis: **392 gating
`empty_rule_source`** findings, 178 `ambiguous_cell`, 274 `numeric_lead` (a
number sitting in prose that nobody extracted), 62 `computed_control`, 16
`dropped_condition`.

Both documents still read `ingest_model: deterministic-v1`. **No LLM stage has
ever run.** The prose stage in `rule-layer-pipeline.md` was designed and never
built; those 274 `numeric_lead` findings are its unbuilt output.

### The shapes hiding inside "ambiguous"

Classifying the 178 `ambiguous_cell` findings by the guard each one needs:

| guard needed | cells |
|---|---|
| **per-unit rate** — "1 space per 2 studio, 1.2 per 2 bedroom" | **46** |
| lot width / frontage | 14 |
| zone or lot type (corner, battle-axe) | 12 |
| road classification | 10 |
| height band | 9 |
| storeys | 5 |
| lot area | 5 |

The largest class is not a site conditional at all. A parking rate is a
*function of the proposal's unit mix*; forcing it into the same model as "which
branch applies to this lot" will produce a schema that serves neither. Keep
them separate from the start.

---

## 2. Why nobody has solved this

Worth knowing before we decide how much to attempt, because the answer is
mostly legal rather than technical.

**NSW publishes no DCP control as data.** The ePlanning layer literally named
*Development Control Plan (LGA-Based)* (layer 220) has these fields and no
others: `LGA_NAME, COUNCIL_NAME, PLAN_NAME, PLAN_TYPE, PUBLISHED_DATE,
COMMENCED_DATE, REPEALED_DATE, AMENDMENT, FILE_NAME ("DCP URL")`. 412 polygons;
the dates come back null. The state register is 636 links, 572 of them `.pdf`,
and 75% of dated entries were last amended 2019 or earlier. Councils are
*required to publish* their DCP on the Portal — not to structure it.

Meanwhile Height of Buildings (40,964 records, `MAX_B_H`, `UNITS`,
`LEGIS_REF_CLAUSE`) and FSR (34,840 records) are fully machine-readable. The
split is exact: **what the law treats as binding is already data; what it
treats as guidance is a PDF.**

**The vendors split the same way, and their own schemas admit it.** PropCode's
live API returns `mediaType: "clauses"` for every NSW LEP sampled and
`mediaType: "pdf"` for every NSW DCP sampled, 14 of 14. A DCP record is a name,
a date, and a list of PDF blobs. Their own write-up: DCPs "exist only as PDFs
at scattered sources… We've made our own repository and list of these documents
to **show them as PDFs**." Their rules engine — "1,000+ rules… converted to
software rules… **We used AI assistance to make this process faster, but always
had a final review by CEO Will**" — encodes the **Codes SEPP**, the one part of
NSW planning where merit assessment was already abolished.

Archistar is the only vendor in the market to claim conditional controls, once,
in a NSW DPHI procurement PDF: the rules engine "allows rules to be **displayed
conditionally**… using formulas and conditional statements." Displayed, not
evaluated; asserted once, never demonstrated. Their own cost figure for
codifying **one** council's zoning bylaw, from a 2025 conference deck: **one
year of implementation**, with "zoning rules need to be codifiable" listed as a
client-side precondition. Liability capped at **AUD $100**.

The honest ones publish their grade. Feasibly labels its NSW tier
"machine-extracted DCP controls… **flagged screening-grade, not
schedule-verified**" while its Victorian tier is "**manually codified**".
Zoneomics — the only product shipping conditional zoning at national scale —
used a sentinel `"STF"` ("See Text Field") for any control that wasn't a plain
number, and in **December 2025** shipped `conditional_control_values=true` to
replace it with real logic. That is an independent, commercial admission that
**a scalar-only control schema degenerates into an escape hatch.** Feasibly's
free-text `qualifier` is the same escape hatch. Ours is "emit all five numbers".

**And the scale is brutal.** NSW DCPs total **over 75,000 pages, roughly 20
million words**. Tweed DCP 2008 alone is 3,762 pages. Against Archistar's one
year per council, chasing coverage is not a plan. Two councils done properly,
with the gaps declared, is.

---

## 3. What the law requires, and forbids

This is not background. It determines what the panel is allowed to say.

- **s3.42(1)** — "The principal purpose of a development control plan is to
  provide **guidance**… The provisions of a development control plan made for
  that purpose **are not statutory requirements**."
- **s3.43(5)** — a DCP provision "**has no effect**" to the extent it is the
  same as, or inconsistent with, a provision of an EPI. Automatic and
  provision-by-provision: the text stays on the page while being legally inert.
- **s4.15(3A)** — if a proposal complies, the consent authority "is not to
  require more onerous standards"; if it does not, it "**is to be flexible in
  applying those provisions and allow reasonable alternative solutions that
  achieve the objects of those standards**." And: "**standards include
  performance criteria**."

So a DCP control is legally a **rebuttable default with a stated objective**,
not a constraint. A number rendered as a hard limit, or a red FAIL, misstates
the law. The objective is what is actually tested when the number is missed.

Three places where DCP controls *do* bind, and must be modelled:

1. **Complying development** — s3.42(3) carves it out, and the 2025 reforms
   define a "complying development standard" to include a DCP provision
   identified as such.
2. **Non-refusal standards** — under the Low and Mid-Rise Housing policy, a
   complying proposal cannot be refused for failing the equivalent LEP or DCP
   standard.
3. **Housing Pattern Book** — GANSW guidance states its standards "override any
   equivalent local planning requirements, such as under a… development control
   plan".

The lever to fix all of this at source exists and has never been pulled:
**s3.45(2A)** empowers regulations requiring "the standardisation" of DCPs,
with the Minister publishing binding requirements as to form, structure and
subject-matter. The only attempt — draft Standard DCP *Definitions* — was
exhibited February 2019 and died there. The December 2025 reform blueprint
*Reforming the NSW planning system* contains **zero occurrences** of
"development control plan", "DCP" or "machine readable". Councils are moving
without the state: North Sydney's DCP 2025 was restructured for the express
purpose of "**integration into future Artificial Intelligence platforms**",
with no policy change — and is still published as a PDF. Armidale and
Canterbury-Bankstown are doing the same, separately. Near-term fragmentation
gets worse, not better.

---

## 4. What we already have

Better than the above suggests. The substrate is in place; only the grain is
wrong.

- **`nsw.section_table` / `section_table_cell` — 371 tables, 5,080 cells**, with
  `row_header` and `col_header` preserved. This is the raw material for
  case-level extraction, and it is already loaded.
- **`rule_applicability` has 13 dimensions** (`zone, land_use, dev_type, act,
  area_label, site_ref, lot_type, excluded_area, size_band_lo/hi, temporal,
  map_area, dev_element`) — enough to scope a rule properly. `site_ref` is
  unused and is exactly what the Hornsby "except 539 Galston Rd" exception
  needs.
- **`rule.table_id` / `table_row` and `rule_effect.cell_id`** already exist.
  1,224 of 1,850 effects carry a `cell_id`.
- **The DCP answers its own condition.** Hornsby's Annexure C is captured — a
  16-row table of designated roads with TfNSW road number, name and From/To
  extents, plus State and Regional road tables.
- **`nsw.lot_frontage_run.road_hierarchy`** carries a road class per frontage
  run alongside `road_name` (6 = local, 2.9M runs; 2–5 progressively more
  arterial).

Which means the Hornsby front setback is **answerable today**. Joining the
Annexure C road names to `up_property_d_4.primary_frontage_road`:

- 68,101 Hornsby lots have a computed frontage road
- **12,942 (19%) front a designated road** → 9 m
- the rest → 6 m

The rule layer has nowhere to record that this branch exists, so the panel
shows all four numbers to all 68,101.

---

## 5. The design

### 5.1 Three layers, kept apart

Document → semantic → rule. Conflating them is why CORENET and SMARTcodes never
generalised: their rules lived in code, so every version change needed a
programmer.

| layer | holds | ours |
|---|---|---|
| **document** | clause identity, hierarchy, page provenance, cross-references | `document`, `section`, `section_table*` — already good |
| **semantic** | what each phrase *does* — requirement, scope, exception | **missing** |
| **rule** | evaluable expressions with property/comparator/value/unit | `rule_effect`, at the wrong grain |

The middle layer is the gap.

### 5.2 Adopt RASE rather than invent a grain

What we would otherwise call a "case" is **RASE** — Hjelseth & Nisbet, CIB W78,
2011. Four operators marked onto the source text, each carrying the *same*
attribute tuple `(object, property, comparator, target value, unit)`:

| | | logic |
|---|---|---|
| **R** Requirement | "shall", "must" | the testable condition |
| **A** Applicability | narrows scope | AND-ed |
| **S** Selection | broadens scope | OR-ed |
| **E** Exception | "unless", "except" | negated |

Compliance for a clause is `NOT(applicable) OR (requirements met)`.

And this sentence, from the same paper, is our table algorithm:

> "The table is read systematically and every interior cell with a requirement
> is made into a distinct test, **taking any applicability from the upmost and
> leftmost cells**."

Row header + column header = conjoined applicability; interior cell =
requirement. Fifteen years old, and exactly what Table 3.1.2-a needs.

Reasons to take the established vocabulary rather than our own: it has survived
three independent transformation targets (SWRL, Drools, SPARQL); the ACCORD
project (Horizon Europe, concluded 2025) ships an ontology with the four
classes already defined; and RASE round-trips — it regenerates prose from the
logic tree so a human can check the interpretation, which is a review mechanism
we would otherwise have to invent.

Concretely, the Hornsby front setback becomes one control with two requirements
and two exceptions:

```
control: front_setback   datum: front_boundary   unit: m   comparator: gte
  A  land_use ∈ {dwelling house, dual occupancy (detached)}
  R  value 6   when frontage_road_class = local        span "6m to local roads"
  R  value 9   when frontage_road_class = designated   span "9m to designated roads"
  E  site_ref ∈ {539 Galston Rd, 925-945 Old Northern Rd} → 6
  E  existing_building_line present → established line
```

Each requirement carries **the exact substring that produced it**, not the whole
cell. That alone fixes verification: a reader checks one claim against one
phrase.

### 5.3 A guard vocabulary gated by resolvers

The discipline that keeps this honest: **a guard term may only be used if
something can answer it.** Three states, never silent omission.

| guard | resolver | status |
|---|---|---|
| `frontage_road_class` | Annexure C × `lot_frontage_run.road_hierarchy` | ✅ proven, 12,942 lots |
| `lot_area`, `frontage_length` | `area_sqm`, `primary_frontage_length_m` | ✅ |
| `lot_width` | `width_at_setback_m` | ✅ |
| `is_corner`, `is_battleaxe`, `zone`, `site_ref` | `up_property_d_4` | ✅ |
| `storeys`, `height`, `land_use`, `unit_mix` | proposal input | 🔵 ask |
| `prevailing_building_line` | needs neighbouring building footprints | ❌ **declare unresolvable** |

The last row matters more than it looks. Camden, Newcastle and Central Coast
all lead their front setback with a prevailing-building-line average, and we
cannot compute it. Saying so beats guessing, and it is precisely what every
competitor hides behind a scalar.

### 5.4 Non-numeric terminals are not failures

A control's value is frequently not a number, and the schema must say so rather
than drop it:

- **"Merit assessment"** — the literal table value 14 times in Pittwater 21 DCP
  Section D alone.
- **"10 or established building line, whichever is the greater"** — a
  comparison against a computed neighbour value.
- **"See Clause 6.1 of HLEP Foreshore Building Line Map"** — a deferral, which
  `value_source` / `map_layer` already handle correctly.
- **"Where the outcomes of this control are achieved…"** — a variation pathway,
  30 occurrences in that same file. Sometimes the pathway *is* the control.

So the unit to store is **(value, objective, variation pathway, citation)**,
not a number. Under s4.15(3A)(b) the objective is what binds when the number is
missed, so a control without its objective is not just less useful — it is
legally incomplete.

ACCORD's `HumanEvaluatedCheckStatement` is the right home for the clauses that
cannot be automated at all. Use Solihin & Eastman's Class 1–4 taxonomy to
decide: most DCP numeric controls are Class 1–2 (single attribute check);
anything about character, amenity or visual impact is **Class 4 and not
automatable**. Park those explicitly. A graph that silently drops them is
misleading; one that names them is honest, and they are the majority of DCP
prose.

### 5.5 Outcomes, and the open-world problem

Steal PlanX's flag set verbatim:

```
missingInfo  →  failsToMeetPolicy  →  edgeCase  →  meetsPolicy
```

`missingInfo` and `edgeCase` as **first-class outcomes, not errors** — which is
exactly the s4.15(3A) posture, arrived at independently from policy.

The same conclusion falls out of the logic. Two teams hit it separately:
Nisbet's RASE→SPARQL work found SPARQL returned *no result* in 5 of 9
truth-table cases involving unknown values, because it lacks short-circuit
evaluation; Wu's B-Prolog work solved the same problem with explicit activation
guards. **Missing data must evaluate to "unknown", never to "non-compliant".**
Design the guards for that from the start rather than retrofitting it.

Borrow one more thing, from the Open Digital Planning schemas: a control that
does *not* apply stays in the payload with `intersects: false`. Absence is
**asserted**, not inferred from a missing row. Today we cannot distinguish "no
rule found" from "rule found, not triggered", and those are very different
answers to give a planner.

### 5.6 The extraction pipeline

Three stages, LLM only in the middle, deterministic on both sides.

1. **Deterministic** — cell + row/col headers + caption + heading chain →
   context packet. Mostly exists in `scripts/lib/dcp-cells.mjs`.
2. **LLM** — packet → RASE statements with verbatim spans, **constrained to the
   guard registry**. This is the unbuilt stage.
3. **Deterministic verify** — value literal in span, span literal in cell,
   guard in registry, requirement set exhaustive and mutually exclusive.
   Failures become `edgeCase`, never silence.

The single most important design decision is stage 2's constraint, not its
model: schema-constrained LLM extraction scores **80%+ schema validity against
3–10% unconstrained** — the largest effect size in this literature.

**Expect ~85% F1 with human review, not 98%.** The 96–99% figures in the
academic record are all single-chapter, hand-tuned and non-transferable; models
that generalise across jurisdictions land in the low 80s. Plan the review
capacity accordingly.

The accuracy gate already exists — `scripts/planningai-datum-check.mjs`, 21
values read off the PDF by hand, failing loudly on a diff. It is the only thing
that catches "99.9% coverage, every number wrong". Extend it before extending
anything else.

### 5.7 Table handling, hardened

- **Never emit markdown for a control table.** It has no rowspan/colspan, so a
  flattened zone × control matrix is wrong in a way nothing downstream can
  detect. `section_table_cell` currently has **no span columns** — add them.
- **Materialise the header path** on every leaf column (`Zone R2 > Minimum lot
  size (m²)`), with the unit parsed into a field at extraction time.
- **De-rotate before parsing.** Rotated tables collapse from TEDS 83.7 to
  **25.2** — the worst failure mode measured. Our tables are mostly 3–4 columns
  so exposure is low, but Hornsby has a 12-column table worth checking.
- **Extract superscripts separately.** Footnote markers corrupt numerics —
  `9.5¹` parses as `9.51`. *Checked: no evidence of this in our current data.*
- **Validate structurally**, not by similarity score: zone codes must match the
  LEP zone list, row cell count must equal header leaf count, every numeric
  control must parse with a unit. We have at least one unit error today — a
  soil volume of 150 m³ recorded as `unit: metre`.

### 5.8 Some controls are not in the document

This is the finding that bounds the whole exercise. In Pittwater 21 DCP Section
D, nine controls read:

> "shall not be less than the distance **calculated in accordance with the
> following:** where S = the distance in metres, H = the height of the wall…"

**The formula is absent from the text layer all nine times** — it is an image.
72 phrases in that one file have a missing numeric value ("modulated at street
level every [blank] metres"). Verified against the council's own source PDF, so
this is **source degradation, not an extraction bug**.

No extractor recovers those. What the pipeline must do is *notice* — a
`source_illegible` finding, so the gap is visible rather than becoming "no
control".

---

## 6. Two smaller fixes

**The proposed-use list is hardcoded.** `DCP_USES` in
`server/api/frontage-dcp.get.ts` is six residential uses chosen by hand. The
documents actually name **42 land uses (Hornsby) and 55 (Randwick)**. Derive
the list: distinct `land_use` per LGA ∩ the zone's permitted uses from the LEP.
Normalise through the Standard Instrument hierarchy too — Randwick tags
`dual occupancy (attached)` where Hornsby tags `dual occupancy`, so a request
for the parent term silently misses five Randwick rules.

**The panel should answer, not enumerate.** One row per control: the value, the
guard that selected it ("front setback 6 m — BROMLEY STREET is not a designated
road"), and the objective beside it. Other branches collapse behind a "why this
number". Verification then means checking one claim against one clause link
instead of reconciling fourteen rows.

---

## 7. Order of work

1. **Guard registry and resolvers.** No extraction change. Proves the
   connection end to end; `frontage_road_class` already works.
2. **RASE grain.** Span columns on `section_table_cell`, header paths, re-extract
   tables only. Targets the 178 `ambiguous_cell` findings.
3. **Presentation.** One answer, the guard, the objective.
4. **LLM prose stage**, schema-constrained. Targets the 274 `numeric_lead`
   findings and the 392 gating `empty_rule_source` ones.

---

## 8. Open questions

- **Parking rates need their own model.** 46 of 178 ambiguous cells are a
  function of unit mix, not of site attributes. Decide the shape before
  forcing them through the setback model.
- **Designated roads have From/To extents.** A road designated for part of its
  length needs the geometry, not just the name.
- **The resolver inherits the frontage pipeline's bugs.** `30 CASUARINA DRIVE
  CHERRYBROOK` resolves to BOUNDARY ROAD — either a genuine corner lot or
  `frontage-known-cases.md` Case B in the wild.
- **Verify before hard-coding:** s4.15(3A) should be re-checked against the
  post-15-December-2025 consolidation, and the case law (*Warkworth*,
  *Bellenger*) came via a law-firm summary rather than the judgments.
- **Worth a look:** Zoneomics' `conditional_control_values` response shape — the
  only production-scale answer to exactly our problem. And City of Sydney
  publishes SDCP 2012 as an ArcGIS FeatureServer (21 layers), the one genuinely
  structured DCP in NSW — though even it yields a geometry, a free-text label
  ("4m Landscape setback") and a clause pointer rather than a rule.

---

## 8a. The template does exist — it is just not ours

I wrote above that there is no standard to align to. That is true of NSW. It is
not true of New Zealand, and the NZ instrument is close enough to copy.

**The National Planning Standards** (MfE, November 2019, updated February 2022;
enabled by ss 58B–58J, Resource Management Act 1991) mandate 17 standards
covering structure, format, definitions and — the one that matters —
**Electronic Accessibility and Functionality**. Standard 16.B requires that an
ePlan include:

> the ability to query the ePlan to display the plan provisions that apply to
> (i) a specific property, by address or by selecting it in the GIS viewer, and
> (ii) one or more specific activities managed by rules in the plan

That is a **legislated requirement for a machine-resolvable plan** — precisely
the capability we are hand-building for NSW, made a statutory obligation with
5-, 7- and 10-year compliance deadlines by council size. It also mandates that
plan datasets be published on data.govt.nz "in machine readable,
non-proprietary format" under CC BY 4.0.

Two parts of it we should adopt directly.

**The identifier scheme (Standard 10).** Provisions are numbered
`<chapter-or-zone-code>-<type><n>`, where type ∈ **I** issue, **O** objective,
**P** policy, **R** rule, **M** method, **PR** principal reason, **AER**
anticipated environmental result. So `RLZ-R1` is rule 1 of the Rural Lifestyle
Zone. Chapter and zone codes are a **fixed controlled vocabulary** (Table 16 —
`AIR, ECO, HAZ, NOISE, SUB, TREE…`; zones `LRZ, GRZ, MRZ, HRZ, RURZ, COMZ…`).
Sub-provisions tier as `O1(1)(a)(i)`, all uniquely addressable.

And the rule that makes it durable: **numbering does not restart at section
headings, and deleting a provision does not renumber its neighbours.**
Identifiers are stable across amendments. That is the property our `rule_key`
needs and does not currently guarantee.

**Objectives are a numbered provision type, not prose.** `O1`, `O2` are
addressable entities that a rule can cite. Which is exactly what s4.15(3A)(b)
requires of us — the objective is the thing tested when the number is missed,
so it has to be a node with an identifier, not a paragraph we quote.

### The NCC shows the same discipline, in XML we can read today

ABCB publishes the NCC as XML on data.gov.au, **CC BY 4.0 since May 2025**
(NCC 2022 was CC BY-**ND** until Amendment 1 changed it). NCC 2025 v1.2 is the
target — a single consolidated `contents.xml` per volume. NCC 2022 is a raw
DITA export whose cross-references point at a vendor CMS temp path
(`/tmp/QppServer/…`) that is not in the download; usable only by discarding the
path and matching UUID fragments.

Three patterns worth taking:

- **Two identifiers, never conflated.** `@id` is a meaningless UUID used for
  linking; the legal clause number lives in a child `<sptc>` element (`D3D3`).
  Resolve one to the other with an index. We currently overload one field for
  both jobs.
- **Amendments as first-class structure.** `<clause-variation type="REPLACE"
  state="NSW" sptc="A2G2">`, with `type ∈ {INSERT, REPLACE, DELETE}`. Volume One
  alone carries 391 clause variations — **NSW is the heaviest user at 145**.
  This is the shape a DCP amendment should take, rather than a re-ingest that
  silently replaces the previous reading.
- **Every defined term in body text is already hyperlinked to its glossary
  entry** — 8,288 such anchors in Volume One. The definition graph comes free.

The important caveat, and the reason this is a document-layer precedent only:
the NCC schema has **no element or attribute anywhere** for a requirement's
subject, predicate, quantity, unit, comparator or condition. Its own annotation
admits it was "derived from the NCC 2025 XML corpus" — reverse-engineered from
the export, not designed. ABCB has digitised the *text and its navigation
graph*, not the *rules*. Which is exactly the §5.1 three-layer split: they built
layer one well and stopped.

### A join we are not using

NSW's LEP spatial layers carry `LEGIS_REF_CLAUSE`, `LEGIS_REF_VALUE` and
`PCO_REF_KEY` — explicit pointers from each polygon back to the LEP clause that
created it and to the Parliamentary Counsel's Office reference. It is the
authoritative link between a mapped control and its legal text.

**We reference it nowhere in this repo.** Worth picking up: it is the join that
lets a mapped standard cite its own clause without us inferring the link.

### The closest precedent to what we are attempting

**RuBRIC** — a Wellington City Council pilot encoding part of its District Plan
as executable rules, to guide people through resource consent. Named on the NZ
Service Innovation Lab's project page; no published report or repository found.
If anyone has attempted a statutory land-use plan as code in this hemisphere, it
is them, and a direct approach to the council is likely worth more than further
searching.

---

## 9. The counterweight, recorded deliberately

The Australian sector's settled position is that this cannot be done — Code for
Australia with UNSW: "merit based planning controls are simply too subjective
and context sensitive to be suitable for coding." Two findings sit against it,
and both should be kept in view:

- **NZ's ACC Better Rules collaboration, Finding 8:** the team deliberately
  chose an area of legislation requiring "significant human judgement" and
  found encoding it "was no different or more complex than other rules".
- **South Australia solved it** — by abolishing the local layer rather than
  digitising it. The Planning and Design Code (19 March 2021) merged 72
  separate codes into one digital code and 300+ residential zones into 9. A
  statutory reform, not a data project.

The honest reading is that the discretion is real but is not the obstacle it is
used as. What defeats encoding is structure: 75,000 pages, no standard, formulas
stored as images, and a legal status that makes precision look like
overreach. The response is to be exact about the numbers we *can* ground, and
explicit about everything else — which is the one thing no competitor surveyed
currently does.
