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
      { id: 'P1.3', title: 'Housing SEPP tables (Sch 1 floor area, setbacks)', status: 'todo',
        doneWhen: 'each table in scope is rows and cells with its column captions, as the pilot does for Randwick' },
    ],
  },
  {
    id: 'P2', title: 'Relations - including every override and prevail form', goal: 'The law\'s own logic as data: what refers to, defines, overrides, yields to or disapplies what - with a scope and a basis.',
    steps: [
      { id: 'P2.1', title: 'Structure and cross-references', status: 'todo', doneWhen: 'part_of / next for every provision; refers_to for every resolvable "clause N" / "section N" / "subclause (N)"; unresolved targets kept as to_ref' },
      { id: 'P2.2', title: 'Definitions', status: 'todo', doneWhen: 'every Dictionary / "In this clause" term linked to the provisions that use it' },
      { id: 'P2.3', title: 'Override readers: despite, subject to, does not apply, prevails, in addition to, applies only if', status: 'todo',
        doneWhen: 'every occurrence in scope is an edge or listed as unread - none silently skipped (the s 169(2) "applies only if—" lesson)' },
      { id: 'P2.4', title: 'Statutory and instrument defaults', status: 'todo', doneWhen: 'EP&A Act s 3.28 (via Randwick 1.9), Housing SEPP s 8, s 4.15(3) non-discretionary standards, cl 4.6 variability - as edges with basis = statute' },
      { id: 'P2.5', title: 'Specific over general (interpretive)', status: 'todo', doneWhen: 'proposed edges for the known pairs (4.4A > FSR map, 4.1A/4.1AA > 4.1) marked interpretive; shown on /rag for confirmation' },
    ],
  },
  {
    id: 'P3', title: 'Index', goal: 'Retrieval units that never lose their stem, searchable by meaning and by exact legal tokens.',
    steps: [
      { id: 'P3.1', title: 'Chunks with deterministic headers', status: 'todo', doneWhen: 'one chunk per provision (data tables excluded, served as facts); header = instrument > part > clause > stem path with roles' },
      { id: 'P3.2', title: 'Keyword index with a legal tokenizer', status: 'todo', doneWhen: '"4.1A", "R2", "Area 1", "Sch 5" survive as single tokens' },
      { id: 'P3.3', title: 'Embeddings: plain / structural / contextual', status: 'todo', doneWhen: 'every chunk embedded in all three variants with bge-en-icl' },
      { id: 'P3.4', title: 'Model-written context per chunk (R2)', status: 'todo', doneWhen: 'every chunk has a 50-100 token context written with its whole clause and part in view' },
    ],
  },
  {
    id: 'P4', title: 'Question bank and the deterministic side', goal: 'The same questions, the same lot facts, both sides answering.',
    steps: [
      { id: 'P4.1', title: 'Pilot keys and engine keys for Randwick', status: 'todo', doneWhen: 'pilot.key rows for Randwick loaded as questions with their expected answers' },
      { id: 'P4.2', title: 'Hard cases learnt this week', status: 'todo',
        doneWhen: '32 Holden St: s 169 vs 4.1 (with/without the 28 Feb 2025 date), 4.1A(4) strata 275, 4.4A 0.6:1 vs map, s 168 0.65:1 non-discretionary, secondary dwelling via s 52 though the LEP prohibits it, manor house via Ch 6; 62 Carr St 247 m2' },
      { id: 'P4.3', title: 'Lot grid', status: 'todo', doneWhen: '~15 Randwick lots (zones, lot sizes, maps) x the housing types + subdivision + height / FSR / minimum lot size, with frozen lot facts' },
      { id: 'P4.4', title: 'PropCode claims for 32 Holden St', status: 'todo', doneWhen: 'the ~60 checkable claims in the two PropCode reports, as questions with their claimed answers' },
      { id: 'P4.5', title: 'Engine answers frozen', status: 'todo', doneWhen: 'every question answered by the deterministic side and stored with the pilot run it read' },
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
