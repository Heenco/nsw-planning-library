/**
 * The Low and Mid-Rise Housing rules, clause by clause: State Environmental Planning Policy (Housing) 2021,
 * Chapter 6 (sections 162-180), as in force in the library's copy (public/EPI/SEPP/housing-sepp-2021.md,
 * amendments to 2026 (33)). The seed for `lmr.type`, `lmr.type_requirement`, `lmr.type_check` and
 * `lmr.general`, loaded by scripts/build-lmr-type-catalogue.ts - the same three-level shape as the CDC
 * catalogue (db/nsw-schema-migration-15), with one more table for the prerequisites every type shares.
 *
 * After the load the TABLES are authoritative: /api/lmr/criteria serves them to /lmr, and /api/lmr/types
 * evaluates them against a lot. This file is the seed, not a second source of truth.
 *
 * HOW THE CHAPTER IS SHAPED, AND HOW THAT MAPS ONTO THE CDC PATTERN
 *
 *   s 163  where the chapter reaches: 800 m walking distance of a Town Centre or a Schedule 11 station,
 *          split at 400 m into an inner and an outer area. Every type checks it (`lmr_area`).
 *   s 164  the land the chapter does NOT apply to. These are the CDC's "general prerequisites": one hit
 *          rules out every type at once. Each is tied to the lmr layers that answer it, and the ones
 *          nothing answers are recorded as gaps, never as clear.
 *   s 166-180  one Part per housing form, each with where it is permitted and its non-discretionary
 *          development standards. These are the CDC's types and requirements.
 *
 * WHAT IS TESTED
 *
 * What reduces to a lot: in the area and which band (s 163), the zone, lot area and lot width at the front
 * building line, whether the use is permissible, and the s 164 exclusions. FSR, height, storeys and car
 * parking are STANDARDS a design has to meet, not facts about the land - they are returned as what the
 * lot is allowed ("allowances"), not tested. The landscaping sections ask the consent authority to
 * CONSIDER a guide, which is not a test of anything.
 *
 * WHAT IT CORRECTS
 *
 * shared/lmr-standards.ts, the mirror of notebook 05_lmr, had shop top housing in the outer area with no
 * standard at all - s 180(3) gives it FSR 1.5:1 and 17.5 m, the same as residential flat buildings - and
 * a "Manor Homes & Dual Occupancies" rule, where the chapter never mentions manor houses: s 168 is dual
 * occupancies alone.
 */

const SEPP = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714'
export const lmrHref = (clause: string) => `${SEPP}#sec.${clause.replace(/\(.*/, '')}`

/** Why a requirement is not tested - said per row, not as one blanket reason. */
export type UntestedReason =
  | 'a standard the design has to meet'
  | 'a consideration for the consent authority, not a test'
  | 'depends on what is approved or built'
  | 'depends on the subdivision layout'

export interface LmrRequirementSeed {
  clause: string
  /** The instrument's words, shortened only where marked with an ellipsis. */
  text: string
  tested: boolean
  /** The type_check column that answers it. */
  testedBy?: string
  untested?: UntestedReason
  /** Answered by inference rather than read directly (a resulting lot from its parent). */
  derived?: string
}

export interface LmrAllowance {
  /** 'any' applies in both areas; 'inner' within 400 m, 'outer' 400-800 m. */
  band: 'any' | 'inner' | 'outer'
  fsr: number | null
  heightM: number | null
  /** Where a standard differs by use. */
  forUse?: string
  storeys?: number | null
  parkingPerDwelling?: number | null
  clause: string
}

export type LmrCheckColumn = 'lmr_area' | 'zone' | 'area' | 'width' | 'permissibility' | 'derived:not_battleaxe'

export interface LmrTypeSeed {
  key: string
  name: string
  /** The Part of Chapter 6. */
  part: string
  sections: string
  /** Zones the standards apply in. */
  zones: string[]
  /** Standard Instrument land-use terms the type turns on, for the permissibility check. */
  landUses: string[]
  /** Zones where the SEPP itself permits the use with consent, whatever the LEP says. */
  seppPermitsIn: string[]
  seppPermitsClause: string | null
  note?: string
  requirements: LmrRequirementSeed[]
  /** column_tested + the phrase the threshold is parsed from, as the CDC catalogue does. */
  checks: { column: LmrCheckColumn; says: string }[]
  allowances: LmrAllowance[]
}

const AREA_CHECK = { column: 'lmr_area' as const, says: 'in a low and mid rise housing area (s 163)' }
const R1_R4 = ['R1', 'R2', 'R3', 'R4']
const DESIGN: UntestedReason = 'a standard the design has to meet'
const CONSIDER: UntestedReason = 'a consideration for the consent authority, not a test'
const LAYOUT: UntestedReason = 'depends on the subdivision layout'
const APPROVED: UntestedReason = 'depends on what is approved or built'
const TREE_GUIDE = 'Before granting development consent … the consent authority must consider the Tree Canopy Guide for Low and Mid Rise Housing, published by the Department in February 2025.'

export const LMR_TYPES: LmrTypeSeed[] = [
  {
    key: 'dual-occupancy', name: 'Dual occupancies', part: 'Part 2', sections: 's 166-168',
    // the LEP permissibility tables split the term: 'dual occupancies (attached)' and '(detached)' each count
    zones: R1_R4, landUses: ['dual occupancies', 'dual occupancies (attached)', 'dual occupancies (detached)'],
    seppPermitsIn: ['R2'], seppPermitsClause: '166',
    requirements: [
      { clause: '166', text: 'Development for the purposes of dual occupancies or semi-detached dwellings is permitted with development consent on land to which this chapter applies in Zone R2 Low Density Residential.', tested: true, testedBy: 'permissibility' },
      { clause: '167(2)', text: TREE_GUIDE, tested: false, untested: CONSIDER },
      { clause: '168(1)', text: 'This section applies to development for the purposes of dual occupancies in a low and mid rise housing area in Zone R1, R2, R3 or R4.', tested: true, testedBy: 'zone' },
      { clause: '168(2)(a)', text: 'a minimum lot size of 450m²', tested: true, testedBy: 'area' },
      { clause: '168(2)(b)', text: 'a minimum lot width at the front building line of 12m', tested: true, testedBy: 'width' },
      { clause: '168(2)(c)', text: 'if no environmental planning instrument or development control plan … specifies a maximum number of car parking spaces per dwelling—a minimum of 1 car parking space per dwelling', tested: false, untested: DESIGN },
      { clause: '168(2)(d)', text: 'a maximum floor space ratio of 0.65:1', tested: false, untested: DESIGN },
      { clause: '168(2)(e)', text: 'a maximum building height of 9.5m', tested: false, untested: DESIGN },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R1, R2, R3, R4' }, { column: 'permissibility', says: 'dual occupancies permissible with consent' },
      { column: 'area', says: 'lot area >= 450 m2' }, { column: 'width', says: 'lot width >= 12 m' }],
    allowances: [{ band: 'any', fsr: 0.65, heightM: 9.5, parkingPerDwelling: 1, clause: '168(2)' }],
  },
  {
    key: 'dual-occupancy-subdivision', name: 'Subdivision for dual occupancies', part: 'Part 2', sections: 's 169',
    zones: ['R1', 'R2', 'R3'], landUses: [], seppPermitsIn: ['R1', 'R2', 'R3'], seppPermitsClause: '169(1A)',
    note: 'Two resulting lots, one dwelling each. They are judged from the lot being subdivided: at least 2 × 225 m² and 2 × 6 m, '
      + 'and not a battle-axe lot. The layout decides the rest.',
    requirements: [
      { clause: '169(1)', text: 'This section applies to development involving subdivision for the purposes of dual occupancies on land in a low and mid rise housing area in Zone R1, R2 or R3.', tested: true, testedBy: 'zone' },
      { clause: '169(1A)', text: 'Despite the provisions of another environmental planning instrument, development consent may be granted to development to which this section applies.', tested: true, testedBy: 'permissibility' },
      { clause: '169(2)', text: 'This section applies only if development consent was granted for the dual occupancy on or after 28 February 2025, or the development results from an application made on or after that date for the subdivision and the erection of a dual occupancy.', tested: false, untested: APPROVED },
      { clause: '169(3)(a)', text: 'each resulting lot must contain no more than 1 dwelling', tested: false, untested: LAYOUT },
      { clause: '169(3)(b)', text: 'each resulting lot must be at least 6m wide at the front building line', tested: true, testedBy: 'width', derived: 'two lots of 6 m need a lot at least 12 m wide' },
      { clause: '169(3)(c)', text: 'each resulting lot must have lawful access and frontage to a public road', tested: false, untested: LAYOUT },
      { clause: '169(3)(d)', text: 'each resulting lot must have an area of at least 225m²', tested: true, testedBy: 'area', derived: 'two lots of 225 m² need a lot of at least 450 m²' },
      { clause: '169(3)(e)', text: 'each resulting lot must not be a battle-axe lot', tested: true, testedBy: 'derived:not_battleaxe', derived: 'a battle-axe lot cannot be split into two lots that are not' },
      { clause: '169(4)', text: 'This section does not apply to strata subdivision.', tested: false, untested: LAYOUT },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R1, R2, R3' }, { column: 'permissibility', says: 'subdivision permitted with consent (s 169(1A))' },
      { column: 'area', says: 'lot area >= 450 m2' },
      { column: 'width', says: 'lot width >= 12 m' }, { column: 'derived:not_battleaxe', says: 'is not a battle-axe lot' }],
    allowances: [],
  },
  {
    key: 'multi-dwelling-housing', name: 'Multi dwelling housing', part: 'Part 3', sections: 's 170-172(2)',
    zones: R1_R4, landUses: ['multi dwelling housing', 'attached dwellings'], seppPermitsIn: ['R2'], seppPermitsClause: '170',
    requirements: [
      { clause: '170', text: 'Development for the purposes of multi dwelling housing or attached dwellings is permitted with development consent on land to which this chapter applies in a low and mid rise housing area in Zone R2 Low Density Residential.', tested: true, testedBy: 'permissibility' },
      { clause: '171(2)', text: TREE_GUIDE, tested: false, untested: CONSIDER },
      { clause: '172(1)', text: 'This section applies to development for the purposes of multi dwelling housing on land in a low and mid rise housing area in Zone R1, R2, R3 or R4.', tested: true, testedBy: 'zone' },
      { clause: '172(2)(a)', text: 'a minimum lot size of 600m²', tested: true, testedBy: 'area' },
      { clause: '172(2)(b)', text: 'a minimum lot width at the front building line of 12m', tested: true, testedBy: 'width' },
      { clause: '172(2)(c)', text: 'if no environmental planning instrument or development control plan … specifies a maximum number of car parking spaces per dwelling—a minimum of 1 car parking space per dwelling', tested: false, untested: DESIGN },
      { clause: '172(2)(d)', text: 'a maximum floor space ratio of 0.7:1', tested: false, untested: DESIGN },
      { clause: '172(2)(e)', text: 'a maximum building height of 9.5m', tested: false, untested: DESIGN },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R1, R2, R3, R4' }, { column: 'permissibility', says: 'multi dwelling housing permissible with consent' },
      { column: 'area', says: 'lot area >= 600 m2' }, { column: 'width', says: 'lot width >= 12 m' }],
    allowances: [{ band: 'any', fsr: 0.7, heightM: 9.5, parkingPerDwelling: 1, clause: '172(2)' }],
  },
  {
    key: 'multi-dwelling-terraces', name: 'Multi dwelling housing (terraces)', part: 'Part 3', sections: 's 170-172(3)',
    zones: R1_R4, landUses: ['multi dwelling housing', 'attached dwellings'], seppPermitsIn: ['R2'], seppPermitsClause: '170',
    note: 's 170 permits "multi dwelling housing or attached dwellings" in R2; terraces are multi dwelling housing, so the same grant is read for them.',
    requirements: [
      { clause: '170', text: 'Development for the purposes of multi dwelling housing or attached dwellings is permitted with development consent … in a low and mid rise housing area in Zone R2 Low Density Residential.', tested: true, testedBy: 'permissibility' },
      { clause: '171(2)', text: TREE_GUIDE, tested: false, untested: CONSIDER },
      { clause: '172(1)', text: 'This section applies to development for the purposes of multi dwelling housing on land in a low and mid rise housing area in Zone R1, R2, R3 or R4.', tested: true, testedBy: 'zone' },
      { clause: '172(3)(a)', text: 'a minimum lot size of 500m²', tested: true, testedBy: 'area' },
      { clause: '172(3)(b)', text: 'a minimum lot width at the front building line of 18m', tested: true, testedBy: 'width' },
      { clause: '172(3)(c)', text: 'if no environmental planning instrument or development control plan … specifies a maximum number of car parking spaces per dwelling—a minimum of 0.5 car parking spaces per dwelling', tested: false, untested: DESIGN },
      { clause: '172(3)(d)', text: 'a maximum floor space ratio of 0.7:1', tested: false, untested: DESIGN },
      { clause: '172(3)(e)', text: 'a maximum building height of 9.5m', tested: false, untested: DESIGN },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R1, R2, R3, R4' }, { column: 'permissibility', says: 'multi dwelling housing permissible with consent' },
      { column: 'area', says: 'lot area >= 500 m2' }, { column: 'width', says: 'lot width >= 18 m' }],
    allowances: [{ band: 'any', fsr: 0.7, heightM: 9.5, parkingPerDwelling: 0.5, clause: '172(3)' }],
  },
  {
    key: 'terrace-subdivision', name: 'Subdivision for multi dwelling housing (terraces)', part: 'Part 3', sections: 's 173',
    zones: ['R1', 'R2', 'R3'], landUses: [], seppPermitsIn: ['R1', 'R2', 'R3'], seppPermitsClause: '173(1A)',
    note: 'How many terraces, and so how many resulting lots, is a design choice: the lot can only be judged on its zone.',
    requirements: [
      { clause: '173(1)', text: 'This section applies to development involving subdivision for the purposes of multi dwelling housing (terraces) on land in a low and mid rise housing area in Zone R1, R2 or R3.', tested: true, testedBy: 'zone' },
      { clause: '173(1A)', text: 'Despite the provisions of another environmental planning instrument, development consent may be granted to development to which this section applies.', tested: true, testedBy: 'permissibility' },
      { clause: '173(2)', text: 'This section applies only if development consent was granted for the terraces on or after 28 February 2025, or the development results from an application made on or after that date for the subdivision and the erection of the terraces.', tested: false, untested: APPROVED },
      { clause: '173(3)(a)', text: 'each resulting lot must contain no more than 1 dwelling', tested: false, untested: LAYOUT },
      { clause: '173(3)(b)', text: 'each resulting lot must be 6m wide at the front building line', tested: false, untested: LAYOUT },
      { clause: '173(3)(c)', text: 'each resulting lot must have lawful access and frontage to a public road', tested: false, untested: LAYOUT },
      { clause: '173(3)(d)', text: 'each resulting lot must have an area of at least 165m²', tested: false, untested: LAYOUT },
      { clause: '173(4)', text: 'This section does not apply to strata subdivision.', tested: false, untested: LAYOUT },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R1, R2, R3' }, { column: 'permissibility', says: 'subdivision permitted with consent (s 173(1A))' }],
    allowances: [],
  },
  {
    key: 'rfb-shop-top-r1-r2', name: 'Residential flat buildings and shop top housing, Zone R1 or R2', part: 'Part 4', sections: 's 174, 179',
    zones: ['R1', 'R2'], landUses: ['residential flat buildings', 'shop top housing'], seppPermitsIn: ['R2'], seppPermitsClause: '174',
    note: 's 174 permits residential flat buildings in R2 and R3. Shop top housing, and residential flat buildings in R1, need the LEP to permit them.',
    requirements: [
      { clause: '174', text: 'Development for the purposes of residential flat buildings is permitted with development consent … in a low and mid rise housing area in Zone R2 Low Density Residential or R3 Medium Density Residential.', tested: true, testedBy: 'permissibility' },
      { clause: '179(1)', text: 'This section applies to development for the purposes of residential flat buildings or shop top housing on land in a low and mid rise housing area in Zone R1 General Residential or R2 Low Density Residential.', tested: true, testedBy: 'zone' },
      { clause: '179(2)(a)', text: 'a minimum lot size of 500m²', tested: true, testedBy: 'area' },
      { clause: '179(2)(b)', text: 'a minimum lot width at the front building line of 12m', tested: true, testedBy: 'width' },
      { clause: '179(2)(c)', text: 'if no environmental planning instrument or development control plan … specifies a maximum number of car parking spaces per dwelling—a minimum of 0.5 car parking spaces per dwelling', tested: false, untested: DESIGN },
      { clause: '179(2)(d)', text: 'a maximum floor space ratio of 0.8:1', tested: false, untested: DESIGN },
      { clause: '179(2)(e)', text: 'a maximum building height of 9.5m', tested: false, untested: DESIGN },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R1, R2' }, { column: 'permissibility', says: 'residential flat buildings or shop top housing permissible with consent' },
      { column: 'area', says: 'lot area >= 500 m2' }, { column: 'width', says: 'lot width >= 12 m' }],
    allowances: [{ band: 'any', fsr: 0.8, heightM: 9.5, parkingPerDwelling: 0.5, clause: '179(2)' }],
  },
  {
    key: 'rfb-shop-top-r3-r4', name: 'Residential flat buildings and shop top housing, Zone R3 or R4', part: 'Part 4', sections: 's 174-178, 180',
    zones: ['R3', 'R4'], landUses: ['residential flat buildings', 'shop top housing'], seppPermitsIn: ['R3'], seppPermitsClause: '174',
    note: 'No minimum lot size or width: s 178 switches off any other instrument\'s lot size and width for development that meets s 180. What the lot is allowed depends on the area it is in.',
    requirements: [
      { clause: '174', text: 'Development for the purposes of residential flat buildings is permitted with development consent … in a low and mid rise housing area in Zone R2 Low Density Residential or R3 Medium Density Residential.', tested: true, testedBy: 'permissibility' },
      { clause: '175(2)', text: 'Inner area: development consent must not be granted for residential flat buildings with a building height of up to 22m unless the consent authority is satisfied the building will have 6 storeys or fewer.', tested: false, untested: DESIGN },
      { clause: '175(3)', text: 'Inner area: development consent must not be granted for a building containing shop top housing with a building height of up to 24m unless the consent authority is satisfied the building will have 6 storeys or fewer.', tested: false, untested: DESIGN },
      { clause: '176(2)', text: 'Outer area: development consent must not be granted for residential flat buildings or buildings containing shop top housing with a building height of up to 17.5m unless the consent authority is satisfied the building will have 4 storeys or fewer.', tested: false, untested: DESIGN },
      { clause: '177(2)', text: 'Development consent must not be granted for residential flat buildings or shop top housing unless the consent authority has considered the Tree Canopy Guide for Low and Mid Rise Housing.', tested: false, untested: CONSIDER },
      { clause: '178(2)', text: 'A requirement specified in another environmental planning instrument or development control plan in relation to minimum lot size or minimum lot width does not apply to development that meets the standards in section 180(2) or (3).', tested: false, untested: DESIGN },
      { clause: '180(1)', text: 'This section applies to development for the purposes of residential flat buildings or shop top housing on land in a low and mid rise housing area in Zone R3 Medium Density Residential or R4 High Density Residential.', tested: true, testedBy: 'zone' },
      { clause: '180(2)', text: 'Inner area: a maximum floor space ratio of 2.2:1; for residential flat buildings a maximum building height of 22m; for a building containing shop top housing a maximum building height of 24m.', tested: false, untested: DESIGN },
      { clause: '180(3)', text: 'Outer area: a maximum floor space ratio of 1.5:1, and a maximum building height of 17.5m.', tested: false, untested: DESIGN },
    ],
    checks: [AREA_CHECK, { column: 'zone', says: 'zone is R3, R4' }, { column: 'permissibility', says: 'residential flat buildings or shop top housing permissible with consent' }],
    allowances: [
      { band: 'inner', fsr: 2.2, heightM: 22, storeys: 6, forUse: 'residential flat buildings', clause: '175(2), 180(2)' },
      { band: 'inner', fsr: 2.2, heightM: 24, storeys: 6, forUse: 'shop top housing', clause: '175(3), 180(2)' },
      { band: 'outer', fsr: 1.5, heightM: 17.5, storeys: 4, clause: '176(2), 180(3)' },
    ],
  },
]

/**
 * s 164(1): the land the chapter does not apply to. One hit rules out every type, as a CDC general
 * prerequisite does.
 *
 * `layers` are lmr-schema tables read against the lot; `failWhere` narrows a layer to the rows that
 * exclude, and `unknownWhere` to the rows the data cannot decide. `coverage` says what the layers are:
 * 'full' when they are the thing the clause names, 'partial' when they cover only some of it, 'none' when
 * nothing answers it - and a lot is never reported clear of a 'none'.
 */
export interface LmrGeneralSeed {
  clause: string
  text: string
  layers: string[]
  failWhere?: string
  unknownWhere?: string
  /** The clause only reaches these councils (derived.lot_lga spelling); elsewhere it does not apply. */
  lgaScope?: string[]
  /**
   * The councils within lgaScope whose layer we actually hold. A lot in a scoped council we hold nothing for
   * is undecided, not clear - the absence of a map there is ours, not the council's.
   */
  heldLgas?: string[]
  coverage: 'full' | 'partial' | 'none'
  caveat?: string
}

/** s 164(1)(g): the 23 local government areas whose flood planning area is excluded, as the data spells them. */
export const FLOOD_LGAS_164G = [
  'ARMIDALE REGIONAL', 'BALLINA', 'BELLINGEN', 'BYRON', 'CESSNOCK', 'CLARENCE VALLEY', 'COFFS HARBOUR', 'DUNGOG',
  'GOULBURN MULWAREE', 'KEMPSEY', 'KYOGLE', 'LISMORE', 'MAITLAND', 'NAMBUCCA VALLEY', 'NEWCASTLE', 'PORT STEPHENS',
  'QUEANBEYAN-PALERANG REGIONAL', 'RICHMOND VALLEY', 'SHOALHAVEN', 'SINGLETON', 'TWEED', 'UPPER HUNTER', 'WALCHA',
]

export const LMR_GENERAL: LmrGeneralSeed[] = [
  { clause: '164(1)(a)', text: 'bush fire prone land', layers: ['bushfire_prone_land'], coverage: 'full',
    caveat: 'Every category and the buffer, from the RFS map as copied on 2026-09-17.' },
  { clause: '164(1)(b)', text: 'land identified as a coastal vulnerability area or a coastal wetlands and littoral rainforests area within the meaning of State Environmental Planning Policy (Resilience and Hazards) 2021, Chapter 2',
    layers: ['sepp_coastal_vulnerability_areas', 'sepp_coastal_wetlands', 'sepp_littoral_rainforest'], coverage: 'full',
    caveat: 'Not the 100 m proximity areas, which are a separate map of that chapter.' },
  { clause: '164(1)(c)', text: 'land to which Chapter 5 applies', layers: ['sepp_tod_areas'], coverage: 'full',
    caveat: 'Chapter 5 is transport oriented development; its land is the Transport Oriented Development Area map.' },
  { clause: '164(1)(d)', text: 'land that is a heritage item or on which a heritage item is located', layers: ['epi_heritage_items', 'shr_curtilage'], coverage: 'full',
    caveat: 'Heritage items on the LEP maps, and State Heritage Register curtilages. Heritage conservation areas are not excluded.' },
  { clause: '164(1)(e)', text: 'the following local government areas—Bathurst Regional, City of Blue Mountains, City of Hawkesbury, Wollondilly', layers: ['whole_lga_exclusion'], coverage: 'full' },
  { clause: '164(1)(f)', text: 'flood prone land in the Georges River Catchment and Hawkesbury-Nepean Catchment under State Environmental Planning Policy (Biodiversity and Conservation) 2021, Chapter 6',
    layers: [], coverage: 'none',
    caveat: 'Not loaded: the probable maximum flood extents of the two catchments. The FRMSP catchments on this page are study coverage, not flood extents.' },
  { clause: '164(1)(g)', text: 'land in a flood planning area in the following local government areas—Armidale Regional, Ballina, Bellingen, Byron, City of Cessnock, Clarence Valley, City of Coffs Harbour, Dungog, Goulburn Mulwaree, Kempsey, Kyogle, City of Lismore, City of Maitland, Nambucca Valley, City of Newcastle, Port Stephens, Queanbeyan-Palerang Regional, Richmond Valley, City of Shoalhaven, Singleton, Tweed, Upper Hunter Shire, Walcha',
    layers: ['flood_planning'], failWhere: "lay_class ILIKE '%flood planning%'", coverage: 'partial',
    lgaScope: FLOOD_LGAS_164G, heldLgas: ['CLARENCE VALLEY'],
    caveat: 'Of the 23 councils only Clarence Valley has its flood planning area on an LEP map we hold - since the 2021 flood reforms most councils publish it in flood studies instead. A lot in any of the other 22 is undecided, never clear.' },
  { clause: '164(1)(h)', text: 'land in an ANEF contour of 25 or greater or ANEC contour of 20 or greater', layers: ['airport_noise'],
    failWhere: "lmr_verdict = 'excluded'", unknownWhere: "lmr_verdict = 'undetermined'", coverage: 'partial',
    caveat: 'Judged contour by contour (scripts/add-lmr-noise-bands.mjs). There is no ANEF for Sydney Airport, Bankstown, Camden or Albion Park; Defence 20-25 contours and the Sydney Airport ANEI cannot be decided.' },
  { clause: '164(1)(i)', text: 'land within 200m of a relevant pipeline within the meaning of State Environmental Planning Policy (Transport and Infrastructure) 2021, section 2.77',
    layers: ['gas_pipelines_buffer_200m', 'oil_pipelines_buffer_200m'], coverage: 'partial',
    caveat: 'Geoscience Australia\'s pipeline map, buffered 200 m - not the register of pipelines licensed under the Pipelines Act 1967 that s 2.77 refers to.' },
  { clause: '164(1)(k)', text: 'land within 800m of a public entrance to a railway, metro or light rail station listed in Schedule 12',
    layers: [], coverage: 'none',
    caveat: 'Not loaded: the Schedule 12 stations are not in our copy of the SEPP, and they have no published map.' },
  { clause: '164(1)(l)', text: 'land identified as "Accelerated TOD Precinct" on the Accelerated Transport Oriented Development Precincts Rezoning Areas Map',
    layers: ['sepp_tod_accelerated_precincts'], coverage: 'full' },
  { clause: '164(1)(m)', text: 'land identified as "exclusion area" on the Low and Mid Rise Housing Exclusion Map', layers: ['sepp_lmr_exclusion_areas'], coverage: 'full' },
]
