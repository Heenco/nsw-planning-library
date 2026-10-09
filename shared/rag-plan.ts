/**
 * The RAG pilot - project plan, rendered by /rag beside the live numbers from schema `rag`.
 *
 * A second pilot next to `pilot` (the CDC session's deterministic atomic propositions): a structure-aware, navigating
 * RAG over Randwick LEP 2012 plus the Housing SEPP parts that reach Randwick lots, compared with the deterministic
 * engine question by question. The engine decides; the model finds and explains - the comparison measures how far a
 * model gets on its own, and where each side is wrong.
 *
 * Edit this file as steps move. `status` is the honest state; `result` records what a finished step measured, so the
 * page shows progress and the reasons behind it.
 */
export type StepStatus = 'done' | 'doing' | 'todo' | 'blocked'

export interface PlanStep {
  id: string
  title: string
  status: StepStatus
  /** The check that closes the step - measurable. */
  doneWhen: string
  /** What it measured when it finished, or where it stands. */
  result?: string
  where?: string[]
}

export interface PlanPhase {
  id: string
  title: string
  goal: string
  steps: PlanStep[]
}

export const RAG_UPDATED = '2026-10-09'

export const RAG_SCOPE = {
  instruments: [
    { title: 'Randwick Local Environmental Plan 2012', parts: 'whole plan', source: 'pilot.node (frozen copy, stamped with the pilot run)' },
    { title: 'State Environmental Planning Policy (Housing) 2021', parts: 'Ch 1 (incl. s 8 "prevails"), Ch 3 Pt 1 (secondary dwellings), Ch 6 (low and mid rise housing), Sch 1 (secondary dwelling CDC), Sch 7A (savings and transitional), Sch 10 (dictionary)', source: 'nsw.section' },
  ],
  outOfScope: 'DCPs, the Codes SEPP, other SEPPs and other LEPs - each a later phase once Randwick works end to end.',
}

export const RAG_DECISIONS: { id: string; decision: string; why: string }[] = [
  { id: 'R1', decision: 'Randwick LEP 2012 + the Housing SEPP parts that reach its lots', why: 'Most Randwick answers turn on the SEPP (s 52 secondary dwellings, s 166-169, s 8 prevails); without it the override cases cannot be tested.' },
  { id: 'R2', decision: 'Its own schema `rag`, read-only on pilot.* and nsw.*', why: 'A second pilot beside the CDC one; neither can disturb the other.' },
  { id: 'R3', decision: 'A frozen copy of the pilot structure, stamped with the pilot run', why: 'The pilot is rebuilt several times a day; a comparison must name the generation it used.' },
  { id: 'R4', decision: 'TypeScript in the app repo (scripts/rag, server/api/rag, /rag)', why: 'The resolver has to end up shared with the deterministic engine, which is TypeScript.' },
  { id: 'R5', decision: 'DeepInfra: Llama 3.3 70B to answer and write contexts, BAAI/bge-en-icl to embed; Qwen3-235B as a second opinion on a subset', why: 'Topped up and tested 2026-10-09: tool calls work (Llama ~1.7 s, Qwen ~35 s); bge-en-icl is what the app already embeds with.' },
  { id: 'R6', decision: 'The model never decides precedence: a deterministic resolver does, and the answer must cite its trace', why: 'Where PropCode\'s AI report went wrong (225 vs 275 m2) and where our own engine inverted 4.4A vs the FSR map.' },
  { id: 'R7', decision: 'Disagreements: Claude drafts a ruling with the clause quote, Manni confirms; confirmed rulings become keys', why: 'Ground truth is the bottleneck - 41 pilot keys, 20 of them deferred.' },
  { id: 'R8', decision: 'Committed locally only', why: 'Standing rule: no push or deploy without asking.' },
]

export const RAG_METRICS: { key: string; what: string; why: string }[] = [
  { key: 'confidently wrong', what: 'yes/no where the key says maybe or the opposite', why: 'The failure that costs money - the headline number.' },
  { key: 'accuracy', what: 'verdict, controlling clause and figures against the keys', why: 'Plain correctness.' },
  { key: 'citation validity', what: 'cited provision exists, quoted span is verbatim, every figure appears in the clause it is cited to', why: 'The check that would have caught PropCode\'s 225-cited-to-a-275 clause.' },
  { key: 'precedence', what: 'on the override keys, the trace names the same winner and the same rule as the key', why: 'The case RAG is worst at in the literature (cross-reference recall 55-59%).' },
  { key: 'retrieval recall@k', what: 'the key clause is among the first k retrieved', why: 'Measured before any answering - cheap, and it stops paying for answers built on bad retrieval.' },
  { key: 'stability, cost, latency', what: 'the same question three times; dollars and seconds per answer', why: 'Production viability.' },
]

export const RAG_VARIANTS: { id: string; what: string }[] = [
  { id: 'R0', what: 'plain RAG - chunk text only, hybrid search' },
  { id: 'R1', what: '+ deterministic structure header (instrument > part > clause > stem path with roles), whole-clause reading' },
  { id: 'R2', what: '+ model-written context per chunk (Anthropic contextual retrieval)' },
  { id: 'R3', what: '+ relation expansion: refers_to, defines, reverse despite / subject to, frames' },
  { id: 'R4', what: '+ agentic navigation with tools and the resolver - the full system' },
  { id: 'L0', what: 'whole operative text in the prompt (no retrieval) - Anthropic\'s own advice under 200k tokens' },
  { id: 'P',  what: 'the deterministic pilot and engine (the CDC session) - the comparison' },
]

export const RAG_PHASES: PlanPhase[] = [
  {
    id: 'P0', title: 'Set up', goal: 'A schema, a plan and a page, so every later step has a home and a measurement.',
    steps: [
      { id: 'P0.1', title: 'Schema `rag` (text, relations, index, eval layers)', status: 'done', doneWhen: 'migration applied on planningai',
        result: 'db/rag-schema-01.sql applied 2026-10-09: 13 tables, 16 relation kinds seeded.', where: ['db/rag-schema-01.sql'] },
      { id: 'P0.2', title: 'This plan and the /rag page with live counts', status: 'done', doneWhen: '/rag renders the plan and the counts from schema rag',
        where: ['shared/rag-plan.ts', 'app/pages/rag.vue', 'server/api/rag/status.get.ts'] },
      { id: 'P0.3', title: 'Scope and model decisions', status: 'done', doneWhen: 'R1-R8 recorded', result: 'Randwick + Housing SEPP parts; DeepInfra topped up and tested.' },
    ],
  },
  {
    id: 'P1', title: 'Corpus snapshot', goal: 'The text, frozen, in the shape the CDC session learnt: stems with roles, leaves with connectives, tables as rows and cells.',
    steps: [
      { id: 'P1.1', title: 'Randwick provisions from pilot.node', status: 'done',
        doneWhen: 'every pilot node copied with its parent, path and container; a flattened table cut from its section text (Sch 5 carries no Lot/DP list)',
        result: '5,378 provisions (1,173 text nodes, 12 tables / 628 rows / 3,565 cells), 156 stems, 172 connectives; every non-root has a path; Sch 5 own text 13 chars (the heritage list is cut). Stamped with pilot structure run 2026-10-09 05:21 UTC.',
        where: ['scripts/rag/01-snapshot.ts'] },
      { id: 'P1.2', title: 'Housing SEPP provisions for the scoped parts', status: 'done',
        doneWhen: 'every section under Ch 1, Ch 3 Pt 1, Ch 6, Sch 1, Sch 7A, Sch 10 copied with path and container; stems marked; connectives read',
        result: '615 provisions, 100 stems with a role read from their closing words, 105 connectives. s 169(2) "This section applies only if—" is held as an applicability stem - the condition the earlier clause reader dropped. Both dictionaries (Randwick, Housing Sch 10) are single sections: splitting them into terms is P2.2.',
        where: ['scripts/rag/01-snapshot.ts'] },
      { id: 'P1.3', title: 'Housing SEPP tables (Sch 1 floor area, setbacks)', status: 'done',
        doneWhen: 'each table in scope is rows and cells with its column captions, as the pilot does for Randwick',
        result: 'Nothing to build: the Housing XML has 5 tables and none is in scope. Sch 1\'s floor-area and setback bands are paragraph lists ("(a) if the lot is at least 450m2 but not more than 900m2—..."), already held as provisions with connectives.' },
    ],
  },
  {
    id: 'P2', title: 'Relations - including every override and prevail form', goal: 'The law\'s own logic as data: what refers to, defines, overrides, yields to or disapplies what - with a scope and a basis.',
    steps: [
      { id: 'P2.1', title: 'Structure and cross-references', status: 'done', doneWhen: 'part_of / next for every provision; refers_to for every resolvable "clause N" / "section N" / "subclause (N)"; unresolved targets kept as to_ref',
        result: '6,580 part_of, 1,921 next, 395 refers_to (205 resolved; 190 kept as to_ref - the Act, the Regulation, other instruments and out-of-scope Housing chapters). "section 3.28 of the Act" is external, never a local s 3.',
        where: ['scripts/rag/02-relations.ts'] },
      { id: 'P2.2', title: 'Definitions', status: 'done', doneWhen: 'every Dictionary / "In this clause" term linked to the provisions that use it',
        result: '607 terms cut from the XML <defterm> markup (Randwick 501, Housing 106), parented to the provision that scopes them; 2,682 defines edges. Randwick plan-wide terms reach the SEPP through s 4(2) (basis statute) where Sch 10 does not define the word. "building" (248 uses) and "road" (208) are left unlinked as ubiquitous; 109 terms are never used in scope.',
        where: ['scripts/rag/02a-terms.py', 'scripts/rag/02-relations.ts'] },
      { id: 'P2.3', title: 'Override readers: despite, subject to, does not apply, prevails, in addition to, applies only if', status: 'done',
        doneWhen: 'every occurrence in scope is an edge or listed as unread - none silently skipped (the s 169(2) "applies only if—" lesson)',
        result: '26 despite, 5 subject_to, 32 disapplies, 59 applies_only_if (s 169(2) included, with its date condition), 19 saves, 14 modifies_measurement, 1 prevails_over. 3 phrases listed as unread, each for a stated reason: Randwick 1.9(2) introduces a list that is empty in the source; Sch 1 s 11(2) "setbacks do not apply to the following"; s 5(2)(a) is not an override. Read sentence by sentence, so "However, this clause does not apply" in 4.6(2) is caught.',
        where: ['scripts/rag/02-relations.ts', 'rag.unread'] },
      { id: 'P2.4', title: 'Statutory and instrument defaults', status: 'done', doneWhen: 'EP&A Act s 3.28 (via Randwick 1.9), Housing SEPP s 8, s 4.15(3) non-discretionary standards, cl 4.6 variability - as edges with basis = statute',
        result: '1.9(1) subject_to any prevailing SEPP (s 3.28); s 8(1) inconsistency_rule; 64 displaces_standard from the s 53 / 168 / 169 / 172 / 173 / 179 / 180 non-discretionary leaves to the LEP standards of the same topic, the same kind (subdivision vs building) and a compatible use - e.g. s 168(2)(d) 0.65:1 > 4.4(2) and the 4.4A dual-occupancy rows; s 169(3)(d) 225 m2 > 4.1(3), 4.1A(3), 4.1A(4)(a), 4.1AA(3), 4.1AA(3A)(a). 61 may_vary from cl 4.6 (4.6(8) and Sch 1 excluded). LEP standards are the CDC pilot\'s propositions (35 after excluding exempt/complying codes and topic disagreements), frozen in rag.pilot_standard so a pilot rebuild mid-run cannot empty them.',
        where: ['scripts/rag/02-relations.ts', 'db/rag-schema-03.sql'] },
      { id: 'P2.5', title: 'Specific over general (interpretive)', status: 'done', doneWhen: 'proposed edges for the known pairs (4.4A > FSR map, 4.1A/4.1AA > 4.1) marked interpretive; shown on /rag for confirmation',
        result: '13 proposed more_specific_than: each 4.4A row (by use and lot size) over 4.4(2), and 4.1B (R3) over the three Lot Size Map standards. The general side must be a standard the pilot reads as "the figure on the map" - a clause that merely mentions the map (2.6(2), 4.2(3)) is not one. 4.1A/4.1AA over 4.1 are explicit "despite" edges, so they need no interpretive one. A provision that is itself an exception ("Despite clause 4.4", e.g. 6.19) is never the general side.' },
    ],
  },
  {
    id: 'P3', title: 'Index', goal: 'Retrieval units that never lose their stem, searchable by meaning and by exact legal tokens.',
    steps: [
      { id: 'P3.1', title: 'Chunks with deterministic headers', status: 'done', doneWhen: 'one chunk per provision (data tables excluded, served as facts); header = instrument > part > clause > stem path with roles',
        result: '795 chunks, ~108k tokens: 271 whole clauses (a clause is split into subclauses only past 4,000 chars - 3 were), 2 stems, 30 control-table rows ("Land use: ...; Zone: ...; Lot size: ...; Maximum floor space ratio: 0.6:1", row-spanned cells filled down), 492 definitions. 583 register rows (Sch 4, Sch 5) left as data. Two structural gaps found and fixed on the way: the Land Use Table had lost its zones (the XML clausegroup level - now provisions of kind group, 01b-groups.py), and 115 dictionary notes ("X are a type of Y") had been read as definitions of Y.',
        where: ['scripts/rag/01b-groups.py', 'scripts/rag/03-chunks.ts'] },
      { id: 'P3.2', title: 'Keyword index with a legal tokenizer', status: 'done', doneWhen: '"4.1A", "R2", "Area 1", "Sch 5" survive as single tokens',
        result: 'shared/rag/bm25.ts: clause numbers with and without their subclause (cl_4.1a, cl_4.1a(4)(a)), zones (zone_r2), area_1, sch_5, part_4, ratios (0.65:1) and measures in one unit (450m2, 9.5m, 25pct). In-memory BM25 over the chunks; the same tokenizer reads the question.', where: ['shared/rag/bm25.ts'] },
      { id: 'P3.3', title: 'Embeddings: plain / structural / contextual', status: 'done', doneWhen: 'every chunk embedded in all three variants with bge-en-icl',
        result: '2,385 embeddings (795 x plain, structural, contextual), ~330k tokens, under $0.01.', where: ['scripts/rag/05-embed.ts'] },
      { id: 'P3.4', title: 'Model-written context per chunk (R2)', status: 'done', doneWhen: 'every chunk has a 50-100 token context written with its whole clause and part in view',
        result: '795 contexts by Llama 3.3 70B with Anthropic’s prompt, the chunk’s Part (up to 40k chars around it) as the document; a definition’s document is the entry plus the headers of the provisions that use it. $0.39. Kept free of relations on purpose, so R2 and R3 are measured apart.', where: ['scripts/rag/04-context.ts'] },
    ],
  },
  {
    id: 'P4', title: 'Question bank and the deterministic side', goal: 'The same questions, the same lot facts, both sides answering.',
    steps: [
      { id: 'P4.1', title: 'Pilot keys and engine keys for Randwick', status: 'done', doneWhen: 'pilot.key rows for Randwick loaded as questions with their expected answers',
        result: '17 pilot.key rows for Randwick as questions (10 on a lot, 7 extraction), each tagged lep_only and carrying the key’s own expected answer.', where: ['scripts/rag/06-questions.ts'] },
      { id: 'P4.2', title: 'Hard cases learnt this week', status: 'done', doneWhen: '32 Holden St: s 169 vs 4.1 (with/without the 28 Feb 2025 date), 4.1A(4) strata 275, 4.4A 0.6:1 vs map, s 168 0.65:1 non-discretionary, secondary dwelling via s 52 though the LEP prohibits it, manor house via Ch 6; 62 Carr St 247 m2',
        result: '15 hard cases on 32 Holden St, 62 Carr St and 28 Eastern Av (510 m2, R2, inside an LMR area - where s 169’s date decides): s 169 with the date unknown / after / before 28 Feb 2025, 4.1A(4) strata 275, FSR map vs 4.4A vs s 168(2)(d), secondary dwelling through s 50 / s 52, multi dwelling housing through s 170, 4.1C(2) vs s 166, s 8 vs 1.9, a manor house whose meaning lives in the Codes SEPP (honest answer: cannot tell). Rulings Manni stated are status key; the rest are drafts for confirmation.', where: ['scripts/rag/06-questions.ts'] },
      { id: 'P4.3', title: 'Lot grid', status: 'done', doneWhen: '~15 Randwick lots (zones, lot sizes, maps) x the housing types + subdivision + height / FSR / minimum lot size, with frozen lot facts',
        result: '18 lots: one per zone x area band inside an LMR area, four outside one, one excluded by a heritage item, plus the key and hard-case lots; 6 questions each (dual occupancy, secondary dwelling, multi dwelling housing, FSR, height, subdivision) = 90. Lot facts frozen per question (zone, area, frontage, map panels, LMR band and class, heritage). Expected answers come from adjudication.', where: ['scripts/rag/06-questions.ts'] },
      { id: 'P4.4', title: 'PropCode claims for 32 Holden St', status: 'done', doneWhen: 'the ~60 checkable claims in the two PropCode reports, as questions with their claimed answers',
        result: '6 PropCode claims, the ones this session wrote down when it compared the two reports (the PDFs are not on disk, so not all ~60): 225 cited to 4.1A(4)(a), 275 for all title types, 550 + 450 lot minimums, permissibility via s 166, the 0.5:1 secondary-dwelling cap, 0.65:1 over 0.6:1. Each carries the claim and whether it is right.', where: ['scripts/rag/06-questions.ts'] },
      { id: 'P4.5', title: 'Engine answers frozen', status: 'done', doneWhen: 'every question answered by the deterministic side and stored with the pilot run it read',
        result: '128 engine answers stamped with pilot run 9d401555: 39 conditional, 34 prohibited, 1 no_permission, 54 not answered (figures, precedence and lot-free questions). The LEP-only reading shows: secondary dwellings prohibited on every lot, multi dwelling housing prohibited in R2 LMR areas, dual occupancy prohibited by 4.1C(2) on R2 LMR lots under 550 m2 - each permitted by the Housing SEPP.', where: ['scripts/rag/07-engine.ts'] },
    ],
  },
  {
    id: 'P5', title: 'The resolver', goal: 'The referee: several rules answer one question; fixed precedence decides, and writes down why.',
    steps: [
      { id: 'P5.1', title: 'Conflict sets', status: 'todo', doneWhen: 'claims that hold (or may) grouped by subject + topic with incompatible effects' },
      { id: 'P5.2', title: 'Ordered resolution with a trace', status: 'todo', doneWhen: 'explicit relations > instrument and statutory rules > non-discretionary limits > specific over general (interpretive) > version; unresolved = "maybe: conflict"' },
      { id: 'P5.3', title: 'Precedence keys pass', status: 'todo', doneWhen: 'FSR 0.65:1 at 32 Holden St with the 3-step trace; Torrens 225 or 275 by the s 169(2) date; strata 275' },
    ],
  },
  {
    id: 'P6', title: 'RAG variants', goal: 'Each layer added one at a time, so we learn what each is worth.',
    steps: [
      { id: 'P6.1', title: 'Retrieval only - recall@k per variant', status: 'todo', doneWhen: 'the key clause is retrieved for each question; per-variant recall reported before any answering' },
      { id: 'P6.2', title: 'Answering R0-R3 and L0 with the checks', status: 'todo', doneWhen: 'structured answers; citation / span / figure-in-clause / not-displaced checks stored per answer' },
      { id: 'P6.3', title: 'R4: navigating agent with the resolver tool', status: 'todo', doneWhen: 'tools: search, open (whole clause), follow, overridden_by, land_use_table, frame, definition, lot_facts, resolve' },
    ],
  },
  {
    id: 'P7', title: 'Compare and adjudicate', goal: 'Every disagreement settled against the clause text; the confirmed ones become keys for both pilots.',
    steps: [
      { id: 'P7.1', title: 'Scores per variant and per side', status: 'todo', doneWhen: 'the metrics above on /rag, per question set' },
      { id: 'P7.2', title: 'Adjudication queue', status: 'todo', doneWhen: 'each disagreement drafted with its quote; confirmed rulings written back as keys' },
      { id: 'P7.3', title: 'Findings', status: 'todo', doneWhen: 'what RAG gets right that the engine misses, and the reverse - with the decision on what goes to production' },
    ],
  },
]

export const RAG_OPEN: { q: string; note: string }[] = [
  { q: 'The pilot builder is saved but not committed', note: 'Now at Notebooks/08D - LEP pilot chain/ (moved out of the scratchpad 2026-10-09), deliberately uncommitted per Manni ("save, not commit") - committing it is Manni\'s call. pilot.node for Randwick is stable; pilot.proposition changes per run (round 28 on 2026-10-09), so every comparison stamps the run it read.' },
  { q: 'One resolver for both pilots', note: 'Agreed in principle with the CDC session (2026-10-09): it adopts the rag.relation_kind set; fallback ranks on its scale dcp 10 / lep 20 / sepp 30. Nothing built on either side yet.' },
  { q: 'Lot area: 645.7 m2 (cadastre) vs 651.3 m2 (PropCode) at 32 Holden St', note: 'No registered plan area on DP752015; a threshold near 650 m2 depends on which is right.' },
  { q: 'Known engine defects kept in on purpose', note: 's 169(2) date dropped, 4.1C(2) read as a resulting-lot minimum, LEP-only permissibility in /cdc/types and /pattern-book, 4.4A vs the map inverted - recorded, so the comparison shows whether RAG catches them.' },
]
