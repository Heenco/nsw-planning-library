/**
 * Instrument profile — State Environmental Planning Policy (Housing) 2021 (epi-2021-0714).
 *
 * The only per-instrument input to the rule pipeline (docs/sepp-rule-pipeline.md §4). It holds what is a
 * legal reading rather than text to extract: the FRAMES - where the instrument, a chapter or a part
 * applies, what it excludes, its pathway, and what it prevails over - and the clause-wording SIGNALS the
 * router looks for. Every rule extracted under a frame inherits its reach (rule.frame_rule_id).
 *
 * Hand-written 2026-10-07 from the library copy (public/EPI/SEPP/epi-2021-0714_2026-03-23.xml, amended to
 * 2026 (33)); every span below is quoted verbatim from it. Chapter 6 only so far (decision D4).
 * REVIEW STATUS: frames reviewed - Manni replied "frames OK" 2026-10-07 (docs/sepp-pipeline-progress.md, Q1).
 */

export type Polarity = 'applies' | 'excludes'
export type Dimension =
  | 'zone' | 'land_use' | 'map_area' | 'land_characteristic' | 'defined_area' | 'lga' | 'pathway'
  | 'proponent' | 'proposal_metric' | 'temporal' | 'permissible_under'

export interface FrameCondition {
  dimension: Dimension
  value: string
  polarity: Polarity
  /** The paragraph it comes from, e.g. "164(1)(a)". */
  clause: string
  /** Verbatim from the instrument. */
  span: string
  /** The scope_layer term the evaluator tests it with (step 7); null until the term is registered. */
  term?: string | null
  /** '<group>#<branch>': conditions sharing a group are alternatives, those sharing a branch are ANDed (migration 22). */
  anyOf?: string
}

export interface Frame {
  id: string
  title: string
  /** Frame this one narrows; its conditions are inherited. */
  parent: string | null
  /** The clause that sets the reach, and the section it sits in. */
  clause: string
  section: string
  /** Section local_ids this frame governs (descendants included). The most specific frame wins. */
  governs: string[]
  conditions: FrameCondition[]
  /** Instruments this frame prevails over, with the clause that says so. */
  prevails?: { over: ('lep' | 'dcp')[]; clause: string; span: string }
  validFrom?: string
  note?: string
}

/**
 * How the evaluator tests a term (step 7): one nsw.scope_layer row per (dimension, value) the frames and
 * extracted rules use. source_kind 'registry' borrows an lmr.layers entry's table and filter; 'none' records
 * a gap rather than leaving the term silently untestable. zone / land_use / pathway / dev_type / temporal
 * are read natively by the evaluator and are not registered here.
 */
export interface TermMapping {
  dimension: 'land_characteristic' | 'defined_area' | 'map_area' | 'lga'
  term: string
  source_kind: 'table' | 'registry' | 'derived' | 'none'
  source: string | null
  filter?: string | null
  test: 'intersects' | 'covers' | 'attribute' | 'derived'
  column_tested?: string | null
  kind: 'condition' | 'exclusion' | 'context'
  note: string
  /** The source is a superset of the term: no hit = does not hold, a hit = undecided (migration 20). */
  upper_bound?: boolean
  /** A term of the same dimension carved out of this one: holds = source holds AND NOT that term (migration 21). */
  except_term?: string
  /** Holds within this straight-line distance (m) of the source (migration 22); with upper_bound, "within N m walking". */
  within_m?: number
}

export interface InstrumentProfile {
  instrument: string
  slug: string
  label: string
  /** nsw.rule.instrument_rank: DCP 10, LEP 20, SEPP 30 (EP&A Act s 3.28). */
  rank: number
  frames: Frame[]
  /** Wording the router (step 4) maps to a role. */
  signals: Record<string, string[]>
  terms: TermMapping[]
  /** The chapters (or parts) steps 5-6 extract; the orchestrator (step 12) re-extracts changed clauses inside them. */
  chapters: string[]
  /** Clauses step 5 does not read as rules, with the reason (a frame's own source, a clause that only lists others). */
  skip?: Record<string, string>
  /** Each step's "done when" spot checks for this instrument - expectations, never inputs to the rules. */
  checks?: {
    /** Step 4: clauses (local ids) each signal must reach, among clauses numbered within `sections`. */
    route?: { label: string; sections: [number, number]; expect: Record<string, string[]> }
    /** Step 5: standards a section must yield, as [topic, value]. */
    extract?: { section: string; effects: [string, number][] }[]
    /** Step 6: rule keys (suffix) that must carry a prevails_over doc_type:lep edge, and SEPP-vs-LEP conflicts
     *  that must be resolvable (SEPP permission clause vs an LEP, by instrument_slug prefix). */
    edges?: { prevailsOverLep: string[]; conflicts: { clause: string; lep: string; label: string }[] }
  }
}

const LGA = (term: string, lotLga: string): TermMapping => ({
  dimension: 'lga', term, source_kind: 'derived', source: 'derived.lot_lga', test: 'attribute', column_tested: 'lga_name',
  filter: `upper(lga_name) = '${lotLga}'`, kind: 'exclusion',
  note: `s 164(1)(e). The SEPP names the council "${term}"; derived.lot_lga spells it ${lotLga}.`,
})

// ── s 164(1) exclusions, in order ────────────────────────────────────────────────────────────────────
const S164 = (para: string, dimension: Dimension, value: string, span: string, term: string | null = null): FrameCondition =>
  ({ dimension, value, polarity: 'excludes', clause: `164(1)(${para})`, span, term })

const FLOOD_PLANNING_LGAS = [
  'Armidale Regional', 'Ballina', 'Bellingen', 'Byron', 'City of Cessnock', 'Clarence Valley',
  'City of Coffs Harbour', 'Dungog', 'Goulburn Mulwaree', 'Kempsey', 'Kyogle', 'City of Lismore',
  'City of Maitland', 'Nambucca Valley', 'City of Newcastle', 'Port Stephens', 'Queanbeyan-Palerang Regional',
  'Richmond Valley', 'City of Shoalhaven', 'Singleton', 'Tweed', 'Upper Hunter Shire', 'Walcha',
]

// ── the Six Cities Region (EP&A Act Schedule 9, in force 1 Nov 2025), in derived.lot_lga's spelling ──
// s 15C(1)(c)(i) reads "the Six Cities Region, other than in the City of Shoalhaven or Port Stephens".
const SIX_CITIES: Record<string, string[]> = {
  'Eastern Harbour City': ['BAYSIDE', 'BURWOOD', 'CANADA BAY', 'HORNSBY', 'HUNTERS HILL', 'INNER WEST', 'KU-RING-GAI',
    'LANE COVE', 'MOSMAN', 'NORTH SYDNEY', 'NORTHERN BEACHES', 'RANDWICK', 'RYDE', 'STRATHFIELD', 'SUTHERLAND SHIRE',
    'SYDNEY', 'WAVERLEY', 'WILLOUGHBY', 'WOOLLAHRA'],
  'Central River City': ['BLACKTOWN', 'CANTERBURY-BANKSTOWN', 'CUMBERLAND', 'GEORGES RIVER', 'CITY OF PARRAMATTA', 'THE HILLS SHIRE'],
  'Lower Hunter and Greater Newcastle City': ['CESSNOCK', 'LAKE MACQUARIE', 'MAITLAND', 'NEWCASTLE', 'PORT STEPHENS'],
  'Western Parkland City': ['BLUE MOUNTAINS', 'CAMDEN', 'CAMPBELLTOWN', 'FAIRFIELD', 'HAWKESBURY', 'LIVERPOOL', 'PENRITH', 'WOLLONDILLY'],
  'Central Coast City': ['CENTRAL COAST'],
  'Illawarra-Shoalhaven City': ['KIAMA', 'SHELLHARBOUR', 'SHOALHAVEN', 'WOLLONGONG'],
}
const SIX_CITIES_LGAS = Object.values(SIX_CITIES).flat()
/** s 74(2)(d): the three metropolitan cities. */
const METRO_CITIES_LGAS = [...SIX_CITIES['Eastern Harbour City']!, ...SIX_CITIES['Central River City']!, ...SIX_CITIES['Western Parkland City']!]
const SIX_CITIES_15C = SIX_CITIES_LGAS.filter(l => l !== 'SHOALHAVEN' && l !== 'PORT STEPHENS')
const SIX_CITIES_TERM = 'Six Cities Region, other than the City of Shoalhaven or Port Stephens'
/** s 15C(3) "relevant zone"; s 72(2)(a)(ia)-(v) build-to-rent zones. */
const RELEVANT_ZONES_15C = ['E1', 'E2', 'MU1', 'B1', 'B2', 'B4']
const BTR_ZONES = [['ia', 'E2'], ['ib', 'MU1'], ['ii', 'B3'], ['iii', 'B4'], ['iv', 'B8'], ['v', 'SP5']] as const

export const HOUSING_SEPP_2021: InstrumentProfile = {
  instrument: 'epi-2021-0714',
  slug: 'state-environmental-planning-policy-housing-2021',
  label: 'housing-sepp',
  rank: 30,
  chapters: ['ch.6', 'ch.2-pt.2-div.1', 'ch.3-pt.4'],
  frames: [
    {
      id: 'instrument',
      title: 'State Environmental Planning Policy (Housing) 2021',
      parent: null,
      clause: '8(1)',
      section: 'sec.8',
      governs: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'ch.7'],
      conditions: [],
      prevails: {
        over: ['lep', 'dcp'],
        clause: '8(1)',
        span: 'Unless otherwise specified in this Policy, if there is an inconsistency between this Policy and another '
          + 'environmental planning instrument, whether made before or after the commencement of this Policy, this '
          + 'Policy prevails to the extent of the inconsistency.',
      },
      note: 's 8(2): the Sustainable Buildings SEPP Ch 2 prevails over this Policy\'s Ch 4 - not relevant to Ch 6.',
    },
    {
      id: 'ch6',
      title: 'Chapter 6 Low and mid rise housing',
      parent: 'instrument',
      clause: '164(1)',
      section: 'sec.164',
      governs: ['ch.6'],
      validFrom: '2025-02-28',
      conditions: [
        { dimension: 'pathway', value: 'development_application', polarity: 'applies', clause: '166',
          span: 'is permitted with development consent', term: null },
        S164('a', 'land_characteristic', 'bush fire prone land', 'bush fire prone land', 'bush fire prone land'),
        S164('b', 'land_characteristic', 'coastal vulnerability area',
          'land identified as a coastal vulnerability area or a coastal wetlands and littoral rainforests area within the meaning of State Environmental Planning Policy (Resilience and Hazards) 2021 , Chapter 2'),
        S164('b', 'land_characteristic', 'coastal wetlands and littoral rainforests area',
          'land identified as a coastal vulnerability area or a coastal wetlands and littoral rainforests area within the meaning of State Environmental Planning Policy (Resilience and Hazards) 2021 , Chapter 2'),
        S164('c', 'defined_area', 'land to which Chapter 5 applies', 'land to which Chapter 5 applies', 'transport_oriented_development_area'),
        S164('d', 'land_characteristic', 'heritage item', 'land that is a heritage item or on which a heritage item is located', 'heritage item'),
        ...['Bathurst Regional', 'City of Blue Mountains', 'City of Hawkesbury', 'Wollondilly'].map(l =>
          S164('e', 'lga', l, `the following local government areas— (i) Bathurst Regional, (ii) City of Blue Mountains, (iii) City of Hawkesbury, (iv) Wollondilly`)),
        S164('f', 'land_characteristic', 'flood prone land in the Georges River or Hawkesbury-Nepean Catchment',
          'flood prone land in the Georges River Catchment and Hawkesbury-Nepean Catchment under State Environmental Planning Policy (Biodiversity and Conservation) 2021 , Chapter 6'),
        S164('g', 'land_characteristic', 'flood planning area (s 164(1)(g) councils)',
          'land in a flood planning area in the following local government areas'),
        S164('h', 'land_characteristic', 'ANEF 25 or ANEC 20 contour', 'land in an ANEF contour of 25 or greater or ANEC contour of 20 or greater'),
        S164('i', 'land_characteristic', 'within 200m of a relevant pipeline',
          'land within 200m of a relevant pipeline within the meaning of State Environmental Planning Policy (Transport and Infrastructure) 2021 , section 2.77'),
        S164('k', 'defined_area', 'within 800m of a Schedule 12 station',
          'land within 800m of a public entrance to a railway, metro or light rail station listed in Schedule 12'),
        S164('l', 'map_area', 'Accelerated TOD Precinct',
          'land identified as "Accelerated TOD Precinct" on the Accelerated Transport Oriented Development Precincts Rezoning Areas Map'),
        S164('m', 'map_area', 'exclusion area',
          'land identified as "exclusion area" on the Low and Mid Rise Housing Exclusion Map'),
      ],
      note: 'The chapter applies to the WHOLE STATE less (a)-(m) - not only the LMR walking catchments. s 166 '
        + '(dual occupancies, semi-detached dwellings in R2) is governed by this frame alone; every other '
        + 'operative clause adds the LMR-area condition (frame ch6-lmr-area). (g) reaches only the councils in '
        + FLOOD_PLANNING_LGAS.length + ' listed: ' + FLOOD_PLANNING_LGAS.join(', ') + '. 164(1)(j) and (2) are repealed.',
    },
    {
      id: 'ch6-lmr-area',
      title: 'Chapter 6 — in a low and mid rise housing area',
      parent: 'ch6',
      clause: '163',
      section: 'sec.163',
      governs: ['sec.167', 'sec.168', 'sec.169', 'sec.170', 'sec.171', 'sec.172', 'sec.173', 'sec.174',
                'sec.175', 'sec.176', 'sec.177', 'sec.178', 'sec.179', 'sec.180'],
      conditions: [
        { dimension: 'defined_area', value: 'low and mid rise housing area', polarity: 'applies', clause: '163',
          span: 'land within 800m walking distance of— (i) land identified as "Town Centre" on the Town Centres Map , or (ii) a public entrance to a railway, metro or light rail station listed in Schedule 11',
          term: 'low_and_mid_rise_housing_area' },
      ],
      note: 'Every one of s 167-180 names "a low and mid rise housing area" (s 175 and s 180(2) the inner area, '
        + 's 176 and s 180(3) the outer area - left to clause extraction, not frames). s 169(1A) and s 173(1A) add '
        + '"despite the provisions of another environmental planning instrument" (step 6).',
    },
    {
      id: 'ch2-infill-ah',
      title: 'Chapter 2, Part 2, Division 1 — in-fill affordable housing',
      parent: 'instrument',
      clause: '15C(1)',
      section: 'sec.15C',
      governs: ['ch.2-pt.2-div.1'],
      conditions: [
        { dimension: 'permissible_under', value: 'verdict', polarity: 'applies', clause: '15C(1)(a)',
          span: 'the development is permitted with consent under Chapter 3, Part 4, Chapter 5, Chapter 6 or another environmental planning instrument' },
        { dimension: 'proposal_metric', value: 'affordable housing component at least 10%', polarity: 'applies', clause: '15C(1)(b)',
          span: 'the affordable housing component is at least 10%' },
        // (c) two branches: Six Cities land (less Shoalhaven, Port Stephens) in an accessible area, OR other land
        // within 800 m walking of a relevant zone
        { dimension: 'lga', value: SIX_CITIES_TERM, polarity: 'applies', clause: '15C(1)(c)(i)', anyOf: 'c#i',
          span: 'for development on land in the Six Cities Region, other than in the City of Shoalhaven or Port Stephens local government area' },
        { dimension: 'defined_area', value: 'accessible area', polarity: 'applies', clause: '15C(1)(c)(i)', anyOf: 'c#i',
          span: 'in an accessible area' },
        { dimension: 'lga', value: SIX_CITIES_TERM, polarity: 'excludes', clause: '15C(1)(c)(ii)', anyOf: 'c#ii',
          span: 'for development on other land' },
        { dimension: 'defined_area', value: 'within 800m walking distance of land in a relevant zone', polarity: 'applies',
          clause: '15C(1)(c)(ii)', anyOf: 'c#ii',
          span: 'within 800m walking distance of land in a relevant zone or an equivalent land use zone' },
        // (2A) exclusions
        { dimension: 'map_area', value: 'Accelerated TOD Precinct', polarity: 'excludes', clause: '15C(2A)(a)',
          span: 'on land identified as an "Accelerated TOD Precinct" on the Accelerated Transport Oriented Development Precincts Rezoning Areas Map' },
        { dimension: 'map_area', value: 'Warrawong Site', polarity: 'excludes', clause: '15C(2A)(b)',
          span: 'on land identified as the "Warrawong Site" on the State Significant Development Sites Map' },
        { dimension: 'map_area', value: 'Kanwal Site', polarity: 'excludes', clause: '15C(2A)(c)',
          span: 'on land identified as the "Kanwal Site" on the State Significant Development Sites Map' },
        { dimension: 'pathway', value: 'complying development under the Codes SEPP, Parts 3B and 3BA', polarity: 'excludes', clause: '15C(2A)(d)',
          span: 'carried out under the Codes SEPP, Parts 3B and 3BA, unless it is being carried out by or on behalf of the New South Wales Land and Housing Corporation' },
      ],
      note: 'The division applies to development that includes residential development (s 15B(1)). (a) is read as the '
        + 'verdict for the use asked about: permitted with consent under any instrument. (c)(ii) "walking distance" '
        + 'is not measured: 800 m in a straight line is an upper bound (outside it = no; inside it = undecided). '
        + '"an equivalent land use zone" is not resolved. (2A)(d) is a fact about the proposal.',
    },
    {
      id: 'ch3-btr',
      title: 'Chapter 3, Part 4 — build-to-rent housing',
      parent: 'instrument',
      clause: '72(2)',
      section: 'sec.72',
      governs: ['ch.3-pt.4'],
      conditions: [
        // (a)-(c) are alternatives: any one limb puts the land in the Part
        { dimension: 'permissible_under', value: 'lep:residential flat building', polarity: 'applies', clause: '72(2)(a)(i)', anyOf: 'a#i',
          span: 'a zone in which development for the purposes of residential flat buildings is permissible under another environmental planning instrument' },
        ...BTR_ZONES.map(([para, z]) => ({ dimension: 'zone' as const, value: z, polarity: 'applies' as const, clause: `72(2)(a)(${para})`,
          anyOf: `a#${para}`, span: `Zone ${z}` })),
        { dimension: 'defined_area', value: 'Transport Oriented Development Area', polarity: 'applies', clause: '72(2)(a1)', anyOf: 'a#a1',
          span: 'in a Transport Oriented Development Area under Chapter 5' },
        { dimension: 'permissible_under', value: 'sepp:ch.5:residential flat building', polarity: 'applies', clause: '72(2)(a1)', anyOf: 'a#a1',
          span: 'in which development for the purposes of residential flat buildings is permissible' },
        ...(['multi dwelling housing', 'residential flat building', 'shop top housing'] as const).map(u => ({
          dimension: 'permissible_under' as const, value: `sepp:ch.6:${u}`, polarity: 'applies' as const, clause: '72(2)(a2)',
          anyOf: `a#a2-${u.split(' ')[0]}`,
          span: 'on which development for the purposes of multi dwelling housing, residential flat buildings or shop top housing is permissible under Chapter 6' })),
        { dimension: 'pathway', value: 'site compatibility certificate issued under section 39', polarity: 'applies', clause: '72(2)(b)', anyOf: 'a#b',
          span: 'for which a site compatibility certificate has been issued under section 39' },
        { dimension: 'map_area', value: 'WestConnex Dive Site', polarity: 'applies', clause: '72(2)(c)', anyOf: 'a#c',
          span: 'identified as "WestConnex Dive Site" on the State Significant Development Sites Map' },
      ],
      note: 'Applies to multi dwelling housing, residential flat buildings or shop top housing (the uses are extracted '
        + 'from s 72(2)). (a1) is read as a TOD area where Chapter 5 permits residential flat buildings - a TOD lot '
        + 'whose LEP permits them is already in by (a)(i); Chapter 5 is not extracted yet, so (a1) alone is undecided. '
        + '(b) is a fact about the proposal and cannot put the land in or out.',
    },
  ],
  terms: [
    // ── s 164(1) exclusions ──
    { dimension: 'land_characteristic', term: 'bush fire prone land', source_kind: 'registry', source: 'lmr.layers:bushfire_prone_land',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(a). RFS bush fire prone land (all categories, incl. buffer).' },
    { dimension: 'land_characteristic', term: 'coastal vulnerability area', source_kind: 'registry', source: 'lmr.layers:sepp_coastal_vulnerability_areas',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(b). R&H SEPP Ch 2 Coastal Vulnerability Area map (10 polygons).' },
    { dimension: 'land_characteristic', term: 'coastal wetlands and littoral rainforests area', source_kind: 'registry', source: 'lmr.layers:sepp_coastal_wetlands',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(b). Coastal Wetlands polygons only: littoral rainforests are not in the layer (partial), proximity areas are not part of the term.' },
    { dimension: 'land_characteristic', term: 'heritage item', source_kind: 'registry', source: 'lmr.layers:epi_heritage_items',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(d). LEP heritage items (epi_heritage, not conservation areas).' },
    { dimension: 'land_characteristic', term: 'flood prone land in the Georges River or Hawkesbury-Nepean Catchment', source_kind: 'table',
      source: 'epi.epi_land_application', test: 'intersects', kind: 'exclusion', upper_bound: true,
      filter: "epi_name = 'State Environmental Planning Policy (Biodiversity and Conservation) 2021' AND lay_name IN ('Georges River Catchment', 'Hawkesbury Nepean Catchment')",
      note: 's 164(1)(f). The flood prone land is NOT held; the two catchment outlines are, and are an upper bound: a lot outside both is clear of this exclusion, a lot inside either is undecided.' },
    { dimension: 'land_characteristic', term: 'flood planning area (s 164(1)(g) councils)', source_kind: 'registry', source: 'lmr.layers:flood_planning',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(g). Only reaches the 23 listed councils; flood planning areas are held for Clarence Valley only, so elsewhere in the 23 the answer is undecided (as /lmr).' },
    { dimension: 'land_characteristic', term: 'ANEF 25 or ANEC 20 contour', source_kind: 'registry', source: 'lmr.layers:airport_noise',
      filter: "lmr_verdict = 'excluded'", test: 'intersects', kind: 'exclusion', note: "s 164(1)(h). Contours judged band by band; lmr_verdict 'undetermined' is undecided, not clear." },
    { dimension: 'land_characteristic', term: 'within 200m of a relevant pipeline', source_kind: 'derived',
      source: 'lmr.gas_pipelines_buffer_200m + lmr.oil_pipelines_buffer_200m', test: 'derived', kind: 'exclusion',
      note: 's 164(1)(i). Two buffer layers; T&I SEPP s 2.77 "relevant pipeline" - the national dataset is a superset.' },
    { dimension: 'defined_area', term: 'land to which Chapter 5 applies', source_kind: 'registry', source: 'lmr.layers:sepp_tod_areas',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(c). Transport Oriented Development Sites Map.' },
    { dimension: 'defined_area', term: 'within 800m of a Schedule 12 station', source_kind: 'registry', source: 'lmr.layers:deferred_tod_areas',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(k). 800 m straight line from the 8 Schedule 12 stations (the ePlanning Deferred TOD map is empty).' },
    { dimension: 'map_area', term: 'Accelerated TOD Precinct', source_kind: 'registry', source: 'lmr.layers:sepp_tod_accelerated_precincts',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(l).' },
    { dimension: 'map_area', term: 'exclusion area', source_kind: 'registry', source: 'lmr.layers:sepp_lmr_exclusion_areas',
      test: 'intersects', kind: 'exclusion', note: 's 164(1)(m). Low and Mid Rise Housing Exclusion Map.' },
    LGA('Bathurst Regional', 'BATHURST REGIONAL'),
    LGA('City of Blue Mountains', 'BLUE MOUNTAINS'),
    LGA('City of Hawkesbury', 'HAWKESBURY'),
    LGA('Wollondilly', 'WOLLONDILLY'),
    // ── s 163 defined areas ──
    { dimension: 'defined_area', term: 'low and mid rise housing area', source_kind: 'derived',
      source: 'lmr.station_walking_catchments + lmr.town_centre_walking_catchments', test: 'derived', kind: 'condition',
      note: 's 163. Within 800 m walking of a Town Centre or Schedule 11 station: either catchment layer, any band.' },
    { dimension: 'defined_area', term: 'low and mid rise housing inner area', source_kind: 'derived',
      source: 'lmr.station_walking_catchments + lmr.town_centre_walking_catchments', filter: 'distance_m = 400', test: 'derived', kind: 'condition',
      note: 's 163. The 400 m walking band.' },
    { dimension: 'defined_area', term: 'low and mid rise housing outer area', source_kind: 'derived',
      source: 'lmr.station_walking_catchments + lmr.town_centre_walking_catchments', filter: 'distance_m = 800', test: 'derived', kind: 'condition',
      except_term: 'low and mid rise housing inner area',
      note: 's 163. The 800 m band, unless the site is also in the inner area (the 800 m polygons contain the 400 m ones).' },
    // ── Ch 2 Pt 2 Div 1, s 15C ──
    { dimension: 'lga', term: SIX_CITIES_TERM, source_kind: 'derived', source: 'derived.lot_lga', test: 'attribute',
      column_tested: 'lga_name', filter: `upper(lga_name) IN (${SIX_CITIES_15C.map(l => `'${l}'`).join(', ')})`, kind: 'condition',
      note: 's 15C(1)(c). EP&A Act Schedule 9 (in force 1 Nov 2025), less Shoalhaven and Port Stephens.' },
    { dimension: 'defined_area', term: 'accessible area', source_kind: 'derived', source: 'access.iso_train + access.iso_bus',
      test: 'derived', kind: 'condition',
      note: 's 15C(1)(c)(i), s 74(2)(d)(i); s 4 "accessible area". 800 m walking of a station + 400 m walking of a bus '
        + 'stop; the bus isochrones are taken as decided without the hourly-service test (Manni, 2026-10-01). Ferry wharves not held.' },
    { dimension: 'defined_area', term: 'within 800m walking distance of land in a relevant zone', source_kind: 'table',
      source: 'epi.epi_land_zoning', filter: `sym_code IN (${RELEVANT_ZONES_15C.map(z => `'${z}'`).join(', ')})`, within_m: 800,
      upper_bound: true, test: 'intersects', kind: 'condition',
      note: 's 15C(1)(c)(ii), (3). Walking distance not measured: 800 m in a straight line of an E1/E2/MU1/B1/B2/B4 polygon is an upper bound.' },
    { dimension: 'map_area', term: 'Warrawong Site', source_kind: 'table', source: 'epi.epi_state_significant_dev_sites',
      filter: "label = 'Warrawong Site'", test: 'intersects', kind: 'exclusion', note: 's 15C(2A)(b). State Significant Development Sites Map.' },
    { dimension: 'map_area', term: 'Kanwal Site', source_kind: 'table', source: 'epi.epi_state_significant_dev_sites',
      filter: "label = 'Kanwal Site'", test: 'intersects', kind: 'exclusion', note: 's 15C(2A)(c). State Significant Development Sites Map.' },
    { dimension: 'defined_area', term: 'Eastern Harbour City, Central River City or Western Parkland City', source_kind: 'derived',
      source: 'derived.lot_lga', test: 'attribute', column_tested: 'lga_name', kind: 'condition',
      filter: `upper(lga_name) IN (${METRO_CITIES_LGAS.map(l => `'${l}'`).join(', ')})`,
      note: 's 74(2)(d). The three metropolitan cities of the Six Cities Region (EP&A Act Schedule 9).' },
    // ── Ch 3 Pt 4, s 72 ──
    { dimension: 'defined_area', term: 'Transport Oriented Development Area', source_kind: 'registry', source: 'lmr.layers:sepp_tod_areas',
      test: 'intersects', kind: 'condition', note: 's 72(2)(a1). Transport Oriented Development Sites Map (Chapter 5).' },
    { dimension: 'map_area', term: 'WestConnex Dive Site', source_kind: 'table', source: 'epi.epi_state_significant_dev_sites',
      filter: "label = 'WestConnex Dive Site'", test: 'intersects', kind: 'condition', note: 's 72(2)(c). State Significant Development Sites Map.' },
  ],
  signals: {
    permission: ['is permitted with development consent', 'development consent may be granted for development to which this part applies'],
    override: ['despite the provisions of another environmental planning instrument'],
    nondiscretionary_heading: ['Non-discretionary development standards'],
    consideration: ['the consent authority must consider', 'unless the consent authority has considered'],
    prohibition: ['development consent must not be granted'],
    disapplication: ['does not apply to development that meets'],
  },
  skip: {
    'sec.164': 'the chapter frame (scripts/pipeline/frames.ts) - s 164 is where the chapter applies',
    'sec.165': 'lists which sections are non-discretionary; read as the nondiscretionary signal on each',
    'sec.15C': 'the division frame (ch2-infill-ah) - s 15C is where the division applies',
  },
  checks: {
    route: {
      label: 'Chapter 6', sections: [162, 180],
      expect: {
        permission: ['sec.166', 'sec.170', 'sec.174'],
        override: ['sec.169', 'sec.173'],
        nondiscretionary_heading: ['sec.168', 'sec.169', 'sec.172', 'sec.173', 'sec.179', 'sec.180'],
      },
    },
    extract: [
      { section: 'sec.168', effects: [['lot_size', 450], ['width', 12], ['parking', 1], ['fsr', 0.65], ['height', 9.5]] },
    ],
    edges: {
      prevailsOverLep: [':frame:instrument', ':sec.169'],
      conflicts: [{ clause: '166', lep: 'parramatta', label: 's 166 vs Parramatta 6.11(1) (Bambara)' }],
    },
  },
}

export default HOUSING_SEPP_2021
