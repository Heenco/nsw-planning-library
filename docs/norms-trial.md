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

## The subdivision section (2026-10-08)

The section is **Subdivision** in `/testing-spatial-services`, served by `GET /api/norms/subdivision` and built with
`npx tsx scripts/norms/build-subdivision.ts` into `norms/subdivision/`. For each lot it gives Torrens, strata and
community title a **Yes / No / Maybe**.

**Housing SEPP.** Every clause that permits or bars subdivision: s 22, 27, 32, 51, 66A, 70, 90, 108E, 117, 141L, 169,
173 and 185. s 169 and s 173 (Chapter 6 subdivision of dual occupancies and terraces) carry the s 164 exclusions,
read from the profile's ch6 frame, so the two cannot disagree.

**All 35 LEPs in the graph.** For each, the Standard Instrument 2.6(1), 2.6(2) and 4.1(3)/(4) are read from that
plan's own words, and the gate checks every quote. A 4.1(4) exclusion the builder does not recognise is kept as
unparsed. Randwick's 4.1A–4.1D come from the trial review.

**Everything else is "not yet checked".** Every other subdivision clause of the plan (local subclauses of 2.6 and 4.1,
4.1A…, 4.2, 5.16, 6.x) is listed with a link. A Yes never hides a clause nobody read.

**Only questions that change an answer are asked.** Each question is flipped yes and no, against two baselines: as
asked, and "clean" (every other barring question answered no). Only those that change an answer class or a standard
are kept, ranked by how many they change. "None of the barred buildings is on the lot" answers the barring ones in
one click.

**Standards come with the lot's own arithmetic:**

- lot sizes: "247 m² cannot make 2 lots of 325 m²";
- widths: "frontage 30.4 m for 2 lots needs 12 m";
- "if it applies" when the standard is conditional;
- **displaced** when a grant applies "despite the provisions of another environmental planning instrument" (s 169(1A)
  displaces LEP 4.1(3)).

A Yes with a development standard not met says "needs a cl 4.6 variation".

**Vocabulary grown from the unparsed leaves:**

- `lot.in` (any nsw.scope_layer term, tested as `/api/rules/at` does);
- `lot.frontage_m`;
- `site.consent_on_or_after` / `site.consent_before` (the date in `text`);
- `site.approved_or_pending` (s 141L(b)-(c));
- `proposal.also_erects`;
- resulting-lot width.

**Checked on:**

- 62B Carr St Coogee. Maybe → "none of the barred buildings" + dwelling houses → Yes ×3, 4.1B not met.
- A Parramatta R2 LMR lot (734 m², 30.4 m). Dual occupancy erected in the same application → Torrens Yes by
  s 169(1A), its standards met, LEP 4.1(3) displaced. 10 Parramatta local clauses listed as unchecked.

**Not in it yet:** exempt and complying subdivision (Codes SEPP), and the local clauses listed as unchecked.

## What it would take to go further

1. **Top up DeepInfra.** Then re-run the author on the whole slice, unreviewed, and run the critic. Measure how many
   meaning errors the critic catches against my review.
2. **Grow the vocabulary from what lands in `unparsed`.** Every unparsed leaf is a measured gap, like the coverage bar.
3. **A question parser** (free text to `Question`) and an **explainer** (trace to plain English). Both are LLM roles,
   both checkable against the structured result.
4. **Migration:** generate norms chapter by chapter alongside the current rules, compare answers on the existing
   answer keys, and switch `/report` over only where they agree or the difference is explained.
