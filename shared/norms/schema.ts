/**
 * Norms - the trial rule shape (docs/norms-trial.md).
 *
 * The SEPP pipeline's rules answer "is land use U permissible on lot L" and drop any condition they cannot type,
 * which then reads as met: "consent must not be granted for the subdivision of a boarding house" became "no
 * subdivision on this lot" (Housing SEPP s 27, 51, 70), and a grant for pattern-book development became a general
 * one (s 185). A norm is the clause with ALL its conditions, each typed by WHO can answer it:
 *
 *   lot        - our data answers it (zone, area, the Lot Size Map, the council)
 *   site       - what is on the lot today (a boarding house, a secondary dwelling built under the SEPP); data where we
 *                hold it, otherwise the person asking
 *   proposal   - what is proposed (a subdivision, its type, the use, how many lots); the person asking
 *   discretion - the consent authority's satisfaction; never decided here
 *   unparsed   - a condition the author could not put in the vocabulary. It is KEPT, quoted, and makes the norm
 *                undecided - it can never be dropped. This is the "fail closed" rule the trial exists to test.
 *
 * Conditions are a closed vocabulary (FACTS below): an author (a model, or a person) may only use these fact names
 * and, where a fact takes values, only the listed values. Anything else is rejected by the build gate and kept as
 * `unparsed`.
 */

export type Who = 'lot' | 'site' | 'proposal' | 'discretion' | 'unparsed'

/** Every fact a condition may test. `values` closes a fact's vocabulary; `cmp` facts take a comparator and a number. */
export const FACTS = {
  // ── the proposal ──
  'proposal.kind': { who: 'proposal', values: ['use', 'subdivision', 'works', 'change_of_use'] },
  'proposal.subdivision_type': { who: 'proposal', values: ['torrens', 'strata', 'community', 'lease'] },
  /** the use the development is for, or the use a resulting lot will have; a Standard Instrument term (or profile extra) */
  'proposal.use': { who: 'proposal', values: 'land_use' },
  /** carried out under a named part of an instrument ("development carried out under this chapter", Housing SEPP s 185) */
  'proposal.under': { who: 'proposal', values: 'instrument_part' },
  /** the approval pathway the provision belongs to; a question is asked for one pathway (default: a development application) */
  'proposal.pathway': { who: 'proposal', values: ['development_application', 'complying_development', 'exempt_development'] },
  'proposal.proponent': { who: 'proposal', values: ['public authority', 'social housing provider', 'relevant authority', 'Land and Housing Corporation', 'Aboriginal Housing Office'] },
  /** "if the subdivision would result in the principal dwelling and the secondary dwelling being situated on separate lots" */
  'proposal.separates': { who: 'proposal', values: 'land_use_pair' },
  'proposal.resulting_lots': { who: 'proposal', cmp: true },
  /** a condition on the size of each resulting lot ("unless the size of each of the 2 resulting lots is not less than the
   *  minimum size shown on the Lot Size Map"): n, or text 'lot_size_map' - tested with the lot's area */
  'proposal.resulting_lot_size': { who: 'proposal', cmp: true },
  /** the same application also proposes erecting this ("a development application ... for the subdivision of the land
   *  and the erection of a dual occupancy on the land", Housing SEPP s 169(2)(b)) */
  'proposal.also_erects': { who: 'proposal', values: 'land_use' },
  /** a floor area of the proposal ("the total floor area of the secondary dwelling is no more than 60m2") */
  'proposal.floor_area_m2': { who: 'proposal', cmp: true },
  // ── what is on the lot today ──
  /** an existing use / building on the lot, optionally one carried out under a named instrument part */
  'site.has': { who: 'site', values: 'land_use' },
  /** consent for the existing `value` use was granted before the date in `text` (Randwick LEP 4.1D: "before 6 July 2018") */
  'site.consent_before': { who: 'site', values: 'land_use' },
  /** a consent in force, or an application not yet determined, for this use on the land (s 141L(b)-(c)) */
  'site.approved_or_pending': { who: 'site', values: 'land_use' },
  /** consent for the existing `value` use was granted on or after the date in `text` (s 169(2)(a): "on or after 28 February 2025") */
  'site.consent_on_or_after': { who: 'site', values: 'land_use' },
  // ── the lot (our data) ──
  'lot.zone': { who: 'lot', values: 'zone_code' },
  'lot.area_m2': { who: 'lot', cmp: true },
  'lot.on_map': { who: 'lot', values: ['lot_size_map'] },
  /** the lot is in a place the graph's term layer maps (nsw.scope_layer): value = the term, e.g. "low and mid rise housing area" */
  'lot.in': { who: 'lot', values: 'scope_term' },
  'lot.frontage_m': { who: 'lot', cmp: true },
  /** the lot against one of the graph's own place polygons (nsw.rule_spatial_ref id) - a map area a rule names */
  'lot.on_ref': { who: 'lot', values: 'graph_ref' },
  /** the use is permissible on the land under the LEP's Land Use Table (or another named instrument) */
  'lot.permits': { who: 'lot', values: 'land_use' },
  // ── never decided here ──
  'discretion': { who: 'discretion' },
  'unparsed': { who: 'unparsed' },
} as const
export type FactName = keyof typeof FACTS

/** A condition. Every leaf carries `span`: the literal words of the clause it was read from. */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { fact: FactName; value?: string; under?: string; cmp?: 'lt' | 'lte' | 'eq' | 'gte' | 'gt'; n?: number; text?: string; span: string }

/** What a norm does when its conditions hold. */
export type Effect =
  | { permit: 'with_consent' | 'without_consent' | 'exempt' | 'complying' }
  | { prohibit: true }
  /** a development standard (a breach is varied under LEP cl 4.6, not a prohibition) or a non-discretionary standard */
  | { require: { topic: 'resulting_lot_size' | 'resulting_lot_width' | 'site_area' | 'floor_area' | 'dwellings_on_land' | 'dwellings_per_resulting_lot' | 'parking' | 'road_frontage' | 'not_battle_axe'
                 /** a matter the consent authority must consider - never a yes or a no (Housing SEPP s 78) */
                 | 'matter_for_consideration'
                 /** a standard read from the graph that the engine has no test for - shown with the graph's own words */
                 | 'graph_standard';
                 cmp: 'lt' | 'lte' | 'eq' | 'gte' | 'gt'; n?: number; from?: 'lot_size_map' | 'existing'; unit?: string;
                 kind: 'development_standard' | 'non_discretionary' | 'condition' } }

export interface Norm {
  id: string                 // '<instrument slug>:<clause>' e.g. 'randwick-lep-2012:4.1B(2)'
  instrument: string         // document title
  clause: string             // '4.1B(2)'
  section: string            // the section local_id the span is in: 'sec.4.1B-ssec.2'
  text: string               // the clause words this norm was read from (gate: every span is inside it)
  when: Cond
  then: Effect
  /** "Despite subclause (3)", "Despite any other provision in this Plan": this norm wins over those */
  despite?: string[]         // norm ids, or 'instrument:*' for "any other provision of this instrument"
  /** "subject to ..." - those win over this one */
  subjectTo?: string[]
  author: { by: string; at: string; reviewed?: string }
  /** a reviewer's reading kept with the norm (what was changed from the model's draft, and why) */
  review?: string
  /** gate findings kept with the norm: conditions turned into `unparsed` because they left the vocabulary */
  gate?: string[]
}

/** The question: a lot, a proposal, and whatever the asker knows about the site. */
export interface Question {
  cadid: string
  proposal: { kind: 'use' | 'subdivision' | 'works' | 'change_of_use'; subdivision_type?: 'torrens' | 'strata' | 'community' | 'lease';
              use?: string; under?: string; proponent?: string; resulting_lots?: number; separates?: string; floor_area_m2?: number;
              also_erects?: string; pathway?: 'development_application' | 'complying_development' | 'exempt_development' }
  /** site facts the asker states: { 'boarding house': false, 'secondary dwelling@housing-sepp-2021:ch.3-pt.1': false } */
  site?: Record<string, boolean>
}
