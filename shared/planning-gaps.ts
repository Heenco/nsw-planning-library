/**
 * What the rule pipeline does not yet cover, with the measurement behind each one.
 *
 * Rendered by /gaps. This is a worklist, not a wishlist: every entry carries a number taken from
 * planningai on the date shown, so its size can be argued with. A gap with no measurement does not
 * belong here - it belongs in a question.
 *
 * `status` is the honest state, including the ones already closed, so the page shows progress and
 * nobody re-finds a fixed bug. `blockedBy` is load-bearing: the branch-condition work cannot finish
 * until rules carry one number each, and no amount of new extraction is safe until the `unless`
 * polarity is audited.
 */
export type GapStatus = 'open' | 'partial' | 'fixed'
export type GapArea = 'extraction' | 'representation' | 'lot data' | 'corpus' | 'architecture' | 'currency'

export interface PlanningGap {
  id: string
  title: string
  area: GapArea
  status: GapStatus
  /** S = days, M = a week or so, L = longer or needs a design first. */
  effort: 'S' | 'M' | 'L'
  /** One line: what is not covered. */
  what: string
  /** Measured, with the numbers. */
  evidence: string[]
  /** What a reader of the app gets wrong because of it. */
  impact: string
  /** Gap ids this one has to wait for. */
  blockedBy?: string[]
  /** Where it lives. */
  where?: string[]
  /** How it was closed, for the fixed ones. */
  resolution?: string
}

export const MEASURED_AT = '2026-10-08'

export const PLANNING_GAPS: PlanningGap[] = [
  // ── representation: what a rule can even say ────────────────────────────────────────────────
  {
    id: 'one-door',
    title: 'Only rules carrying a number reach the engine',
    area: 'representation', status: 'open', effort: 'M',
    what: 'from-graph turns a rule into a norm only when it has a numeric effect, so every prohibition, '
        + 'permission, additional use and disapplication is invisible to the verdict.',
    evidence: [
      '1,499 of 6,147 LEP and SEPP rules (24%) carry a number and become norms.',
      '5,345 of the 6,147 carry scope, so they are evaluable today - they have no door.',
      'Invisible kinds: 46 prohibitions, 203 permissions, 26 additional uses, 21 disapplications.',
      'The engine already has permit / prohibit / require and defeat resolution. Nothing needs inventing.',
    ],
    impact: 'A lot where a local clause takes the use away still reads as permitted. Parramatta cl 6.11 is the case.',
    where: ['shared/norms/from-graph.ts', 'shared/norms/engine.ts'],
  },
  {
    id: 'modifier-rules',
    title: 'Rules that change how another rule is measured',
    area: 'representation', status: 'open', effort: 'L',
    what: 'cl 4.1(3A) "the area of the access handle must not be included in calculating the lot size" is not a '
        + 'standard - it changes the arithmetic of every other standard. There is no effect type for it.',
    evidence: [
      'averaging: 39 clauses, 94% produce no rule.',
      '"as if" / deeming: 34 clauses, 94% produce no rule.',
      'whichever is the greater / lesser: 47 clauses.',
      '"for the purposes of this clause ...": 51 clauses.',
      'The access handle is currently hard-coded into shared/norms/engine.ts because it had nowhere else to go.',
    ],
    impact: 'Every number is only as good as an assumption made in endpoint code rather than read from the plan.',
    where: ['shared/norms/schema.ts', 'shared/norms/engine.ts'],
  },
  {
    id: 'definitions',
    title: 'Defined terms are not resolved',
    area: 'representation', status: 'open', effort: 'L',
    what: 'Each LEP defines site area, gross floor area, storey and building line its own way. We hold the '
        + 'dictionaries and use them only to expand land-use groups.',
    evidence: [
      '35 dictionary sections held, one per LEP.',
      'Used only by useGroups() in shared/norms/facts.ts.',
      'Already bitten once: "width at the building line" is legally undefined, which is why lot width is measured as primary frontage.',
    ],
    impact: 'A number is not comparable between two councils, so any cross-LEP claim rests on an unstated assumption.',
    where: ['shared/norms/facts.ts', 'nsw.section level=dictionary'],
  },

  // ── extraction: what the reader gets off the page ───────────────────────────────────────────
  {
    id: 'lost-scope',
    title: 'A rule states a number while dropping the condition that bounds it',
    area: 'extraction', status: 'partial', effort: 'M',
    what: 'Where a clause confines its standard to a place or a characteristic and the rule does not carry it, the '
        + 'standard is recorded as binding everywhere. Audited rather than assumed; a candidate list now exists.',
    evidence: [
      'AUDITED 2026-10-08 with scripts/audit-lost-scope.py, which screens every rule carrying a number '
        + 'against the nsw.scope_layer terms its own clause names.',
      '1,498 rules carry a number outside the Land Use Table. 25 hold every term their clause names; '
        + '1,136 name no testable term; 331 name one and hold none.',
      'CONFIRMED by hand: Housing SEPP s 159 stores "width >= 21 m, land_use = residential flat building" '
        + 'for a clause that reads "... on a lot in a Transport Oriented Development Area, unless the lot is '
        + 'at least 21m". The TOD Area is gone and two of the three land uses with it, so a 21 m minimum is '
        + 'recorded as binding every residential flat building in the State.',
      'Of the 331, 314 are the Codes SEPP alone - one instrument whose standards clauses sit under general '
        + 'requirements that mention heritage, so most are probably noise and need their own pass. The other '
        + '17 are in the LEPs and the Housing SEPP and are few enough to read one by one.',
      'The screen took three passes to be worth reading: keying on "unless" flagged Randwick cl 5.4, where the '
        + 'land_use scope IS the condition; matching across the whole clause flagged a height rule for a Note '
        + 'two subclauses away; and an exact term match called Inner West cl 6.20(3) lost when it holds '
        + '"Haberfield Heritage Conservation", which is the same condition stated more precisely.',
    ],
    impact: 'A lost condition is the worst kind of defect here: the rule still produces a number, so the page answers '
          + 'confidently and wrongly, rather than saying it does not know.',
    resolution: 'Audited. 17 candidates outside the Codes SEPP to read one by one; the 314 Codes SEPP hits need a '
              + 'separate pass. Nothing fixed yet - the audit reports and changes nothing.',
    where: ['scripts/audit-lost-scope.py', 'nsw.rule_applicability'],
  },
  {
    id: 'branch-conditions',
    title: 'Conditions on a parent subclause are not inherited by the numbers beneath it',
    area: 'extraction', status: 'partial', effort: 'M',
    what: 'A clause written as a matrix puts the condition on the branch and the number on the leaf. Extraction read '
        + 'the leaves and dropped the branch, so cells came out with identical scope and different numbers.',
    evidence: [
      '3,083 of 5,426 prose rules carrying a number (57%) sit in a group with identical clause, topic and scope but a different value.',
      '795 colliding groups across 22 documents.',
      'A collision is only ONE of the shapes a lost branch condition takes. Penrith cl 4.1B puts the SAME number '
        + 'on both branches - "(a) for a battle-axe lot - a width of at least 15m ... (b) otherwise - a width of at '
        + 'least 15m" - so nothing collided and the battle-axe condition was dropped in silence.',
      'Hornsby cl 4.1C and 4.1D applied, plus 5 Codes SEPP conditions.',
    ],
    impact: 'The page shows contradictory numbers for one clause and cannot say which is yours - or, worse, shows one '
          + 'number as if it were unconditional.',
    where: ['scripts/backfill-branch-conditions.ts'],
    resolution: 'The blanket multi-number guard is gone and the trigger now covers every clause with branch labels, '
              + 'not only the collisions. The ceiling is now leaf matching: 1,564 rules cannot be tied to exactly one '
              + 'leaf, which is re-extraction work rather than backfill work - Penrith cl 4.1B is the example, where '
              + 'the number 15 matches three leaves and the 650 m2 and 12 m figures were never captured at all. '
              + 'PRUNING IS OFF BY DEFAULT: wrong twice (Georges River, and Housing SEPP cl 69 where it would have '
              + 'stripped the zone the number depends on) against a yield of 5 additions.',
  },
  {
    id: 'multi-effect',
    title: 'One rule can carry several numbers, so it cannot carry several scopes',
    area: 'extraction', status: 'open', effort: 'M',
    what: 'Applicability hangs off the rule, so a rule whose numbers come from DIFFERENT branches would need two '
        + 'scopes. Most multi-number rules are not that shape, which the first count missed.',
    evidence: [
      'Of 754 rules carrying more than one number: 112 carry a condition band on the effect itself, 382 span more '
        + 'than one topic (a width AND an area - conjunctive and correct), and 297 are several values of one topic.',
      'Only the last shape can conflate branches, and then only when the numbers come from different leaves. '
        + 'Penrith cl 4.1B(1)(a) is "a width of at least 15m AND an area of at least 650m2" from one leaf - fine.',
      'The backfill decides per rule now: every number must resolve to exactly one leaf, and all those leaves must '
        + 'sit under the same branch.',
      'Georges River cl 4.1A(2) remains the real case - 300 m2 from branch (a) and 430 m2 from branch (b), one rule.',
    ],
    impact: 'Narrower than it looked: it blocks the branch pass only for rules that genuinely straddle two branches.',
    where: ['nsw.rule', 'nsw.rule_effect', 'scripts/backfill-branch-conditions.ts'],
  },
  {
    id: 'map-references',
    title: 'Clauses that turn on a map are mostly unread',
    area: 'extraction', status: 'open', effort: 'M',
    what: '"identified as X on the Y Map" is how NSW planning expresses nearly every spatial control, and it is the '
        + 'single biggest structure in the corpus.',
    evidence: [
      '854 operative clauses reference a map; 49% produce no rule at all, 89% carry no number.',
      'nsw.rule_spatial_ref already holds polygons for some - cl 6.11 "D" has one, and it intersects 58 Bambara Crescent.',
      'So part of this is extraction, not missing data.',
    ],
    impact: 'The largest single class of control in the plans is the one we read least.',
    where: ['nsw.rule_spatial_ref'],
  },
  {
    id: 'cross-references',
    title: '"Subject to" and clause-to-clause references are not followed',
    area: 'extraction', status: 'open', effort: 'M',
    what: 'A clause that defers to another is a relationship between rules, which rule_edge exists to hold.',
    evidence: [
      '"subject to": 181 clauses, 83% produce no rule, 98% carry no number.',
      '"despite / notwithstanding": 120 clauses, 18% produce no rule.',
      'nsw.rule_edge holds 173 edges in total across 6,147 rules.',
    ],
    impact: 'An override that should displace a standard is not applied, so both show and neither governs.',
    where: ['nsw.rule_edge'],
  },
  {
    id: 'schedule-1',
    title: 'Schedule 1 additional permitted uses cannot attach to a lot',
    area: 'extraction', status: 'open', effort: 'S',
    what: 'Schedule 1 permits a use on a named Lot/DP. The rules exist; the site reference does not.',
    evidence: [
      '26 rules of kind additional_use.',
      'ZERO of them carry a site_ref applicability.',
      'part4_graph already extracts APUs keyed by Lot/DP and address (apu_extract.py).',
    ],
    impact: 'A grant we hold can never flip a prohibition, because nothing ties it to the land it names.',
    where: ['nsw.rule kind=additional_use', 'part4_graph/build/apu_extract.py'],
  },
  {
    id: 'lep-spans',
    title: 'Some LEP numbers cannot be traced to words in the clause',
    area: 'extraction', status: 'open', effort: 'S',
    what: 'A source span is what lets a number be checked against the text it came from. The SEPP pipeline gates on '
        + 'it; the LEP side does not.',
    evidence: [
      'SEPP effects with a source span: 3,491 of 3,491 (100%).',
      'LEP effects with a source span: 766 of 911 (84%).',
      '145 LEP numbers are unverifiable, and those rules are src=ai.',
    ],
    impact: 'A number nobody can trace is a number nobody can rule out as invented.',
    where: ['nsw.rule_effect.source_span'],
  },

  // ── lot data: the facts the clauses ask for ─────────────────────────────────────────────────
  {
    id: 'adjoins',
    title: 'What a lot adjoins is not computed',
    area: 'lot data', status: 'open', effort: 'M',
    what: 'Clauses turn on what the land adjoins - a park, a classified road, land in another zone.',
    evidence: [
      '174 operative clauses mention adjoining land; 50% produce no rule.',
      'nsw.scope_layer already records this as a known gap: "needs the neighbouring parcels and what they are, which nothing computes".',
      'The cadastre can supply neighbours cheaply with ST_Touches.',
    ],
    impact: 'Any clause turning on a neighbour is permanently undecidable.',
    where: ['nsw.scope_layer term=adjoins'],
  },
  {
    id: 'existing-development',
    title: 'What is already built on the lot is not held',
    area: 'lot data', status: 'open', effort: 'L',
    what: 'Clauses constantly turn on whether there is already a dwelling, a dual occupancy or a secondary dwelling.',
    evidence: [
      '109 operative clauses mention an existing building or dwelling.',
      'The engine asks the user instead (site.has), which is why so many answers stall at MAYBE.',
      'Housing SEPP s 50 needs it; CDC cl 3BA.6(e) needs it and is listed as untestable on every lot in the State.',
    ],
    impact: 'The commonest reason an answer is MAYBE rather than yes or no.',
    where: ['shared/norms/facts.ts'],
  },
  {
    id: 'frontage-count',
    title: 'Street frontage count is computed but not offered as a fact',
    area: 'lot data', status: 'open', effort: 'S',
    what: 'derived.lot_frontage_run already measures every frontage run per lot.',
    evidence: [
      '59 operative clauses mention street frontages.',
      'nsw.scope_layer already has the term "2 street frontages" backed by derived.lot_frontage_run.',
      'Parramatta cl 6.11(2) turns on it directly.',
    ],
    impact: 'A clause we could answer today is answered "not recorded".',
    where: ['derived.lot_frontage_run', 'nsw.scope_layer'],
  },
  {
    id: 'split-zone',
    title: 'A genuinely split-zoned lot is answered on one zone',
    area: 'lot data', status: 'partial', effort: 'M',
    what: 'lotFacts reads the zone under the lot\'s point on surface, so the rest of a split lot is not considered.',
    evidence: [
      'Measured on 3,000 City of Parramatta lots: 19.5% touch more than one zone polygon, but only 0.8% are genuinely split (>1% of the lot in a second zone).',
      'The 10 cm inner buffer is what separates the two - 58 Bambara Crescent reported "R2 and C2" when C2 overlaps it by 0.0 m2.',
      'Every LEP has a "Development near zone boundaries" clause - 35 of them - and all are unread.',
    ],
    impact: 'Rare, but on the lots it hits the answer is read on part of the land, and the clause written for exactly that case is not applied.',
    where: ['shared/norms/facts.ts', 'server/api/norms/use.get.ts'],
    resolution: 'The zone check now uses the 10 cm buffer and reports each zone\'s share, so a touch no longer reads as a split. Reading the second zone, and cl 5.3, is still open.',
  },

  // ── currency ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'currency',
    title: 'Nothing detects that an instrument has been amended',
    area: 'currency', status: 'open', effort: 'M',
    what: 'The graph has no mechanism to notice that the plan it extracted is no longer the plan in force.',
    evidence: [
      'All 45 LEP and SEPP documents were ingested in a three-week window, 4-26 September 2026.',
      '4 rules in the whole graph carry a valid_to.',
      'The NSW legislation XML endpoint can return a point-in-time version and is already documented for exactly this.',
    ],
    impact: 'Silently out of date has no symptom - the page looks equally confident either way. The same failure mode as the cl 6.11 YES, at the scale of the whole corpus.',
    where: ['nsw.document', 'nsw.rule.valid_from / valid_to'],
  },

  // ── corpus ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'thin-corpus',
    title: 'Some plans are barely extracted, and three not at all',
    area: 'corpus', status: 'open', effort: 'S',
    what: 'Not a structural gap - runs that did not happen or did not work.',
    evidence: [
      'Zero rules: Sydney LEP (Green Square Town Centre) 2013, (Green Square Stage 2) 2013, (Harold Park) 2011.',
      'Bayside LEP 2021: 23 rules across 223 clauses.',
      'Cumberland LEP 2021: 29 rules across 184 clauses.',
      'For comparison, Parramatta 2023 has 271 rules across 255 clauses.',
    ],
    impact: 'A lot in those councils gets an answer with almost nothing behind it, and the coverage gate is the only thing that will say so.',
    where: ['nsw.document', 'nsw.rule'],
  },

  // ── architecture ────────────────────────────────────────────────────────────────────────────
  {
    id: 'four-implementations',
    title: 'One legal question, four implementations',
    area: 'architecture', status: 'open', effort: 'M',
    what: 'Clause 1.18(1)(b) - is the use permissible with consent - is answered separately by /cdc, /pattern-book, '
        + '/land-use and /subdivision.',
    evidence: [
      '/api/cdc/types runs its own LEP + SEPP join.',
      '/api/pattern-book/at runs another, with its own USE_TERMS table.',
      '/api/norms/use runs a third through lotFacts.',
      'Each defect has to be found four times. The /land-use one was added in this session.',
    ],
    impact: 'Four places to fix, four places to drift.',
    where: ['server/api/cdc/types.get.ts', 'server/api/pattern-book/at.get.ts', 'server/api/norms/use.get.ts'],
  },
  {
    id: 'precedence-in-code',
    title: 'Instrument precedence is written in endpoints, not derived',
    area: 'architecture', status: 'open', effort: 'M',
    what: 'SEPP-beats-LEP is asserted per endpoint rather than read from instrument_rank and rule_edge.',
    evidence: [
      '20 of 173 rule_edges are cross_document.',
      'instrument_rank is populated consistently - DCP 2,238 rules, LEP 4,618, other 26 - and almost unused.',
      'The engine already supports `despite`, which is where this belongs.',
    ],
    impact: 'Two surfaces can reach opposite conclusions about which instrument governs.',
    where: ['nsw.rule.instrument_rank', 'nsw.rule_edge', 'shared/norms/engine.ts'],
  },

  // ── closed, kept so nobody re-finds them ────────────────────────────────────────────────────
  {
    id: 'coverage-gate',
    title: 'A verdict could hide a clause nobody read',
    area: 'architecture', status: 'fixed', effort: 'S',
    what: 'Nothing on the page distinguished "nothing prohibits this" from "nothing we read prohibits this".',
    evidence: ['58 Bambara Crescent read "Dual occupancy YES" with cl 6.11(1) and 6.11(2) unread and their polygons held.'],
    impact: 'Confident wrong answers, with no signal.',
    resolution: 'Every clause naming the use that produced no norm is carried onto the verdict, flagged "may prohibit" where it bars the use. /land-use only.',
    where: ['server/api/norms/use.get.ts', 'app/pages/land-use.vue'],
  },
  {
    id: 'sepp-fail-open',
    title: 'A zone-keyed SEPP row beat an LEP prohibition outright',
    area: 'representation', status: 'fixed', effort: 'M',
    what: 'nsw.sepp_permissible_landuse has no idea where a chapter applies.',
    evidence: ['Housing SEPP s 166 permits a dual occupancy in R2, but Chapter 6 excludes heritage items, bush fire prone land and 15 other things.',
               'A heritage-listed R2 lot was reported "dual occupancy permitted".'],
    impact: 'Fail-open on exactly the land the chapter is written to exclude.',
    resolution: 'The SEPPs\' own permission clauses are read and gated by their chapter frames; all 17 ch6 exclusions resolve through nsw.scope_layer.',
    where: ['server/api/norms/use.get.ts', 'shared/norms/facts.ts'],
  },
  {
    id: 'access-handle',
    title: 'The access handle was counted toward minimum lot size',
    area: 'representation', status: 'fixed', effort: 'S',
    what: 'cl 4.1(3A) excludes it, and the clause rendered as "not tested here" while the sizes beside it used the gross area.',
    evidence: ['3//DP224995 was tested on 1,347 m2 instead of 1,120 m2.'],
    impact: 'Too generous on exactly the lots the clause is aimed at.',
    resolution: 'Deducted once for every lot-size standard, with the clause and its exception zones read from the instrument.',
    where: ['shared/norms/engine.ts'],
  },
  {
    id: 'norm-id-collision',
    title: 'Two norms of one clause took the same id',
    area: 'architecture', status: 'fixed', effort: 'S',
    what: 'The id was slug:graph:section:index, but several rules of one clause share a section.',
    evidence: ['Hornsby cl 4.1C has four rules, all on sec.4.1C. byId returned one norm for every row, and `despite` read the wrong one.'],
    impact: 'Silent: override resolution used the wrong norm wherever a clause had more than one rule.',
    resolution: 'The rule id is part of the norm id.',
    where: ['shared/norms/from-graph.ts'],
  },
]
