# Norms trial — getting correct answers out of the graph

**Status:** trial, 2026-10-07. Local only. Nothing in `/api/rules/at` or the SEPP pipeline was changed.

## Why

Asked about subdivision at 62B Carr Street, Coogee (lot 1//DP219220, R3, 247 m², Randwick LEP 2012),
`/api/rules/at` answered three different ways, two of them wrong:

| asked as | old answer | what was wrong |
|---|---|---|
| subdivision | **not permissible** — Housing SEPP s 51 | s 51 bars subdividing *a lot on which a SEPP secondary dwelling was built*; the condition was dropped |
| strata subdivision | permissible — Housing SEPP s 185 | s 185 is only for land with Chapter 7 (pattern book) development; the condition was dropped |
| subdivision of land | undecided — "no Land Use Table row" | subdivision is not a land use; LEP cl 2.6 and 4.1–4.1D were never read |

These are not three bugs. They come from three causes that every clause shares:

1. **The question is too thin.** It is (lot, land use). The real question is (lot, proposal, site): what is proposed
   (a use, a subdivision and its type, works), and what is on the lot already.
2. **Fail open.** A condition the extractor could not type was dropped, and a dropped condition reads as met. Each
   one is a confident wrong answer, and answer keys only catch the ones someone thought to test.
3. **Hand-coded combination.** Prevails, proponent-limited grants, route conditions and pathways are each special
   code in the evaluator.

## What the literature says about using an LLM

- **An LLM as the judge**, answering from retrieved clauses, fails on exactly this logic. "Exception chain collapse"
  on rules shaped like *A unless B unless C*, and accuracy that drifts between runs with no model change
  ([Confidently Wrong, 2026](https://arxiv.org/pdf/2607.23386)).
- **An LLM writing rules for a deterministic engine** is where the field has settled
  ([IRC s 121 in Prolog](https://arxiv.org/pdf/2511.11954), [Catala translation](https://aclanthology.org/2025.nllp-1.4.pdf)).
- **But LLM-written rules are not faithful on their own.** The failures are "scope laundering" and "implicit
  constraint blindness" ([Know Your Limits](https://arxiv.org/pdf/2606.16118)), so they need gates, a critic and review.
- **"Despite" and "subject to"** are standard constructs of defeasible logic
  ([Automating Defeasible Reasoning in Law](https://arxiv.org/pdf/2205.07335); LegalRuleML; Blawx).

## The trial design

**The question** (`shared/norms/schema.ts`) has three parts:

- **the lot**, which our data answers;
- **the proposal**: kind (`use` / `subdivision` / `works` / `change_of_use`), subdivision type, use, number of lots,
  floor area, who carries it out, and the instrument part it is carried out under;
- **the site**: what is already on the lot. Stated by the asker, or derived where the data holds it. A `//SP` lot id
  means a strata scheme.

**A norm** is a clause with *all* its conditions. It has three parts:

- `when` is a condition tree over a **closed vocabulary**. Each leaf is typed by who can answer it: lot, site,
  proposal, discretion, or **unparsed**.
- `then` is permit (with its pathway), prohibit, or require (a development standard or a non-discretionary standard).
- `despite` and `subjectTo` say which norm wins in a conflict.

**Fail closed.** A condition outside the vocabulary is kept as `unparsed`, with its words quoted. It makes the norm
undecided and can never be dropped.

**One engine** (`shared/norms/engine.ts`) handles every norm the same way:

- every leaf comes out yes / no / unknown;
- a conflict between a permit and a prohibition is decided by `despite` and `subjectTo`, and otherwise SEPP over LEP;
- the outcome is `permissible`, `prohibited`, `conditional` (with what it depends on, and who can answer) or
  `no_permission`;
- standards are tested against the lot where possible ("2 lots from 247 m² average 124 m², below 325 m²"). A standard
  that may not apply is reported as "would not be met if it applies", never as failed.

### LLM roles, none of them the judge

| role | where | status |
|---|---|---|
| **author**: clause → norms | `scripts/norms/author.ts` (DeepSeek-V4-Pro, temperature 0, cached) | ran on 5 Housing SEPP clauses; DeepInfra credit ran out before the Randwick clauses |
| **gate**: deterministic checks | `scripts/norms/gate.ts`: spans in the text or its context, vocabulary closed, every number used, references exist | built; runs on every norm |
| **critic**: a second model family reads clause and norms, flags missing / invented / wrong | `scripts/norms/critic.ts` (Qwen3.8-Max) | built; not run (credit) |
| **question parser, explainer** | — | not built yet; the endpoint takes structured parameters |

## Results

### The model's drafts (`norms/trial/model/housing-sepp-2021.json`)

- **What the old pipeline got wrong, the model got right.** s 51 and s 27 came out as `site.has` (prohibited only if
  the lot already has that building), not as blanket bans.
- **The gate caught:**
  - s 185 had no spans and an invented condition ("secondary dwelling under Ch 7"). All of it became unparsed, so it
    would have come out undecided rather than wrong.
  - "residential zone" was unreadable (vocabulary gap), so it became unparsed.
  - Spans quoting s 50 failed. That was a gate bug: context had to be allowed.
- **The gate did not catch:**
  - s 53(2)(a) gained an invented condition (principal and secondary dwelling separated) and lost "detached";
  - s 53(2)(b) became "parking = 0" instead of "the same as before".

  Both are meaning errors. The critic exists for these.
- **Reviewed into `norms/trial/reviewed/`.** Every change is recorded in the norm's `review` field. The 14 Randwick
  norms were written by Claude in session, marked as such.

### Engine answers (`npx tsx scripts/norms/check.ts`: 22 norms, 0 gate findings, **9/9 cases**)

| question | new | old |
|---|---|---|
| 62B Carr St, Torrens into 2 lots, nothing stated | **conditional**: 2.6(1) permits with consent; depends on s 51 / s 27 / 2.6(2) (what is on the lot today) | not permissible (s 51) |
| … for dwelling houses, site stated clear | **permissible with consent** (2.6(1)); 4.1B(2) 325 m² **not met** (247 m² cannot make two), so a cl 4.6 variation | — |
| … strata subdivision | **permissible with consent** (2.6(1)); 4.1 does not apply (4.1(4)); s 185 undecided, never the reason | permissible by s 185 |
| … with a boarding house on the lot | **prohibited**: s 27 defeats 2.6(1) (SEPP over LEP) | — |
| … a secondary dwelling | **conditional**: s 52(1) defeats the LEP's R3 prohibition; s 52(2)'s three conditions listed; 53(2)(a) 450 m² would not be met if detached | — |
| Randwick R2, 461 m², dual occupancy | **prohibited** by 4.1C(2) (needs 550 m²) | — |
| Randwick R2, 737 m², dual occupancy | **conditional**: the Land Use Table row is *mixed* (attached permitted, detached prohibited), so it asks | — |
| … attached dual occupancy | **permissible with consent** (Land Use Table) | — |

`GET /api/norms/at?cadid=102325171&kind=subdivision&type=torrens&lots=2&site=boarding house=no;…` answers in about
230–460 ms.

### Known limits of the trial

- **Slice only:** Housing SEPP s 27, 51–53, 185, and Randwick LEP 2.6 and 4.1–4.1D, plus a Land Use Table norm. Ch 6
  (LMR dual occupancies, s 166) and the Codes SEPP are not in it.
- **Vocabulary gaps,** kept as unparsed: building form (detached), other dwellings on the land, the maximum floor area
  under another instrument, resulting lot sizes, "a single development application".
- **Lot Size Map:** our copy has no polygon on 62B Carr St (nearest 440 m). Read as "not on the map". It could
  instead be a gap in our copy.
- **The expectations are my reading.** They need a planner's confirmation.

## What it would take to go further

1. **Top up DeepInfra.** Then re-run the author on the whole slice, unreviewed, and run the critic. Measure how many
   meaning errors the critic catches against my review.
2. **Grow the vocabulary from what lands in `unparsed`.** Every unparsed leaf is a measured gap, like the coverage bar.
3. **A question parser** (free text to `Question`) and an **explainer** (trace to plain English). Both are LLM roles,
   both checkable against the structured result.
4. **Migration:** generate norms chapter by chapter alongside the current rules, compare answers on the existing
   answer keys, and switch `/report` over only where they agree or the difference is explained.
