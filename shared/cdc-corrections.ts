/**
 * What the Codes SEPP says that the Department workbook left out, read from the instrument itself.
 *
 * WHY THIS FILE EXISTS, SEPARATELY FROM cdc-criteria.ts
 *
 * shared/cdc-criteria.ts is generated from the workbook "CDC Rules - Part 3, 9 & HSEPP" and must not be
 * hand-edited. Auditing it against the instrument (public/EPI/SEPP/exempt-and-complying-2008.md, the
 * consolidated epi-2008-0572) showed the omissions are the WORKBOOK'S, not our extraction's: sheet 1
 * heads "1.17A(1)" and then starts at (b); it heads "1.18(1)" and then gives only (c3); it stops 1.19 at
 * (j)(i) and 1.19A at (1)(b). Our generator copied that faithfully. So the fix does not belong in the
 * generator - it belongs here, where the source is the instrument and can be cited as such.
 *
 * The page renders everything in this file in violet, so a reader can always tell which rows came from
 * the Department's compilation and which were added from the instrument.
 *
 * Text is VERBATIM from the consolidated instrument, em dashes and all.
 */

/** A citation the workbook uses that the instrument does not. */
export interface ClauseFix {
  /** The citation as cdc-criteria.ts carries it. */
  wrong: string
  /** What the instrument actually calls it. */
  right: string
  why: string
}

/** A requirement the workbook never transcribed. */
export interface AddedRequirement {
  clause: string
  text: string
  /** What it changes for us - why it is worth having on the page. */
  why: string
  /**
   * The clause this one follows, so the table keeps the instrument's order. null = first of its part.
   * Chained: an added row may follow another added row.
   */
  after: string | null
}

/** A complying development code named in clause 1.5(1) that CDC_TYPES has no entry for. */
export interface MissingCode {
  name: string
  part: string
  note?: string
  /** Where its requirements now live, for a code that has since been read from the instrument. */
  page?: string
}

/**
 * The ten paragraphs of the environmentally sensitive area test are the DEFINITION in clause 1.5(1),
 * the dictionary. Clause 1.17A(1)(e) is a single paragraph that refers to it; the instrument has no
 * 1.17A(1)(e)(a). The workbook listed them indented under 1.17A(1)(e) and the generator turned that
 * indentation into a sub-paragraph number. The WORDING we carry is right; only the citation is invented.
 */
export const CDC_CLAUSE_FIXES: ClauseFix[] = [
  ...'abcdefghij'.split('').map(letter => ({
    wrong: `1.17A(1)(e)(${letter})`,
    right: `1.5(1), "environmentally sensitive area", para (${letter})`,
    why: 'These ten paragraphs are the dictionary definition in clause 1.5(1), not sub-paragraphs of '
      + '1.17A(1)(e). The instrument gives 1.17A(1)(e) no paragraphs at all.',
  })),
  {
    wrong: '1.19(1)(j)(i)',
    right: '1.19(1)(j)(i) and (ii)',
    why: 'This row carries both paragraphs. Paragraph (ii) - any other drinking water catchment '
      + 'identified in any other environmental planning instrument - is in the text but not in the '
      + 'citation, so it reads as though only the Sydney catchment is covered.',
  },
]

export const CDC_ADDED: AddedRequirement[] = [
  // -- 1.17A ---------------------------------------------------------------------------------------
  {
    clause: '1.17A(1)(a)',
    after: null,
    text: 'be development for which development consent cannot be granted except with the concurrence of '
      + 'a person other than— (i) the consent authority, or (ii) the Director-General of the '
      + 'Department of Environment, Climate Change and Water as referred to in section 4.13(3) of the '
      + 'Act, or',
    why: 'The first paragraph of the first prerequisite clause. The workbook skips from the (1) chapeau '
      + 'straight to (b), so this has never been on the page.',
  },
  {
    clause: '1.17A(2)',
    after: '1.17A(1)(e)(j)',
    text: 'Despite subclause (1)(d), if development meets the requirements and standards specified by '
      + 'this Policy and that development— (a) has been granted an exemption under section 57(2) of '
      + 'the Heritage Act 1977, or (b) is subject to an exemption under section 57(1A) or (3) of that '
      + 'Act, the development is complying development under this Policy.',
    why: 'A carve-out from the heritage exclusion: a Heritage Act exemption puts the development back in. '
      + 'Our heritage test has no way to express this, so it over-excludes.',
  },
  {
    clause: '1.17A(2A)',
    after: '1.17A(2)',
    text: 'Despite subclause (1)(d), development is complying development if the development— (a) '
      + 'meets the requirements and standards specified by State Environmental Planning Policy (Transport '
      + 'and Infrastructure) 2021 for complying development, and (b) is exempt or has been granted an '
      + 'exemption under the Heritage Act 1977, section 57(1A), (2) or (3).',
    why: 'The second heritage carve-out, for development under the Transport and Infrastructure SEPP.',
  },
  {
    clause: '1.17A(3)',
    after: '1.17A(2A)',
    text: 'If an item listed on the State Heritage Register is not located on, or does not comprise, the '
      + 'whole of the relevant land, subclause (1)(d) applies only to the part of the land that is '
      + 'described and mapped on that register.',
    why: 'PART-LOT RULE. Where a State Heritage Register item covers only part of the lot, the exclusion '
      + 'reaches only that part. We rule out the whole lot on any intersection.',
  },
  {
    clause: '1.17A(4)',
    after: '1.17A(3)',
    text: 'If an item not listed on the State Heritage Register but identified as an item of environmental '
      + 'heritage in an environmental planning instrument does not comprise, or is not located on, the '
      + 'whole of the relevant land, subclause (1)(d) applies only to the part of the land that is '
      + 'described and mapped on that instrument.',
    why: 'The same part-lot rule for an EPI-identified heritage item, which is the common case in '
      + 'epi.epi_heritage.',
  },

  // -- 1.18: the workbook transcribed one paragraph of twelve ---------------------------------------
  {
    clause: '1.18(1)(a)',
    after: '1.17A(4)',
    text: 'not be exempt development under this Policy, and',
    why: 'Exempt development cannot also be complying development. Nothing on the page said so.',
  },
  {
    clause: '1.18(1)(b)',
    after: '1.18(1)(a)',
    text: 'be permissible, with consent, under an environmental planning instrument applying to the land '
      + 'on which the development is carried out, and',
    why: 'TESTABLE TODAY. We already resolve permissibility from the zone on /testing-spatial-services, '
      + 'and this is the clause that makes it a prerequisite. See also 1.18(4), which excludes land that '
      + 'is permissible only because of the Standard Instrument, Schedule 1, clause 5.',
  },
  {
    clause: '1.18(1)(c)',
    after: '1.18(1)(b)',
    text: 'meet the relevant provisions of the Building Code of Australia, and',
    why: 'A building test rather than a land test, listed so the clause is complete.',
  },
  {
    clause: '1.18(1)(c1)',
    after: '1.18(1)(c)',
    text: 'not require an environment protection licence within the meaning of the Protection of the '
      + 'Environment Operations Act 1997, and',
    why: 'Licensed premises are out. The EPA publishes the licence register, so this is obtainable.',
  },
  {
    clause: '1.18(1)(c2)',
    after: '1.18(1)(c1)',
    text: 'not be designated development, and',
    why: 'Designated development is defined in section 4.10 of the Act.',
  },
  {
    clause: '1.18(1)(d)',
    after: '1.18(1)(c3)',
    text: 'before the complying development certificate is issued, have an approval, if required by the '
      + 'Local Government Act 1993, for— (i) an on-site effluent disposal system if the development '
      + 'is undertaken on unsewered land, and (ii) an on-site stormwater drainage system, and',
    why: 'Turns on whether the land is unsewered, which is the same input 1.19(1)(j) needs.',
  },
  {
    clause: '1.18(1)(e)',
    after: '1.18(1)(d)',
    text: 'before the complying development certificate is issued, have written consent from the relevant '
      + 'roads authority (if required under section 138 of the Roads Act 1993) for the building of any '
      + 'kerb, crossover or driveway, and',
    why: 'A consent to obtain, not a land exclusion.',
  },
  {
    clause: '1.18(1)(f)',
    after: '1.18(1)(e)',
    text: 'if it is the alteration or erection of improvements on land in a mine subsidence district '
      + 'within the meaning of the Mine Subsidence Compensation Act 1961, have the prior approval of the '
      + 'Mine Subsidence Board, and',
    why: 'TESTED, and until 2026-09-23 tested WRONGLY. We do hold the layer - cdc.mine_subsidence, the '
      + '30 declared districts, downloaded from the ePlanning Mine_Subsidence_District service. The '
      + 'clause asks for the Board\'s prior approval, not for the land to be clear, so cdc.layers now '
      + 'records it as a condition rather than an exclusion and /cdc-map stops counting it against the '
      + 'lot. The notebook\'s 35 prerequisites still exclude on it and need the next run to stop.',
  },
  {
    clause: '1.18(1)(g)',
    after: '1.18(1)(f)',
    text: 'not be the construction or installation of a skylight or roof window on land in the local '
      + 'government area of Coonamble, Gilgandra, Warrumbungle Shire or Dubbo Regional, and',
    why: 'TESTABLE. A plain LGA test, protecting the dark sky around Siding Spring Observatory. Clause '
      + '1.16A is the exempt-development equivalent.',
  },
  {
    clause: '1.18(1)(h)',
    after: '1.18(1)(g)',
    text: 'for development involving the removal or pruning of a tree or other vegetation that requires a '
      + 'permit, approval or development consent—before the complying development certificate is '
      + 'issued, have the permit, approval or development consent.',
    why: 'A permit to obtain. Relevant to the protected-tree setbacks the codes impose.',
  },
  {
    clause: '1.18(2)',
    after: '1.18(1)(h)',
    text: 'The erection of a new dwelling house or an addition to a dwelling house on land in the 20-25 '
      + 'ANEF contours is complying development for this Policy, if the development is constructed in '
      + 'accordance with AS 2021:2015, Acoustics—Aircraft noise intrusion—Building siting and '
      + 'construction.',
    why: 'A PERMISSION rather than an exclusion, and it sits directly beside 1.19(1)(h), which excludes '
      + 'the 25 ANEF contour and above. 20-25 ANEF is buildable on a condition.',
  },

  // -- 1.19: everything after subclause (1) ---------------------------------------------------------
  {
    clause: '1.19(3A)',
    after: '1.19(1)(j)(i)',
    text: 'Development specified in the Low Rise Housing Diversity Code or the Pattern Book Development '
      + 'Code is not complying development under that code if it is carried out on land on which there is '
      + 'a heritage item or a draft heritage item.',
    why: 'A separate exclusion from 1.17A(1)(d), and it bites dual occupancy, manor houses and terraces. '
      + 'Note that it names the Pattern Book Development Code, which is not among our codes.',
  },
  {
    clause: '1.19(4)',
    after: '1.19(3A)',
    text: 'To be complying development specified for the Housing Alterations Code or the General '
      + 'Development Code, the development must not be carried out on unsewered land— (a) in the '
      + 'Sydney Drinking Water Catchment, if that development will result in an increase to the number of '
      + 'bedrooms on the site or in a site disturbance area of more than 250m2, or (b) in any other '
      + 'drinking water catchment identified in any other environmental planning instrument.',
    why: 'The only prerequisite reaching the Housing Alterations and General Development Codes, which are '
      + 'the two codes that carry sheds, decks and pools, and the ones the 1.19(1)(a) carve-out points at.',
  },
  {
    clause: '1.19(5)',
    after: '1.19(4)',
    text: 'To be complying development specified for the Industrial and Business Buildings Code, the '
      + 'development must not be carried out on— (a) land within a heritage conservation area or a '
      + 'draft heritage conservation area, or (b) land that is reserved for a public purpose in an '
      + 'environmental planning instrument, or (c) land identified on an Acid Sulfate Soils Map as being '
      + 'Class 1 or Class 2, or (d) significantly contaminated land, or (d1) land that is subject to a '
      + 'private land conservation agreement under the Biodiversity Conservation Act 2016 or that is a '
      + 'set aside area under section 60ZC of the Local Land Services Act 2013, or (e) land that is '
      + 'subject to a biobanking agreement under Part 7A of the Threatened Species Conservation Act 1995 '
      + 'or a property vegetation plan approved under the Native Vegetation Act 2003, or (f) land '
      + 'identified by an environmental planning instrument as being— (i) within a buffer area, or '
      + '(ii) within a river front area, or (iii) within an ecologically sensitive area, or (iv) '
      + 'environmentally sensitive land, or (v) within a protected area, or (g) land that is identified '
      + 'by an environmental planning instrument, a development control plan or a policy adopted by the '
      + 'council as being or affected by— (i) a coastline hazard, or (ii) a coastal hazard, or (iii) '
      + 'a coastal erosion hazard, or (h) land in a foreshore area, or (i) unsewered land— (i) in '
      + 'the Sydney Drinking Water Catchment, or (ii) in any other drinking water catchment identified in '
      + 'any other environmental planning instrument.',
    why: 'Nearly the same list as 1.19(1) but for the Industrial and Business Buildings Code, and NOT the '
      + 'same: no ANEF paragraph, no special area, and the unsewered test carries no 250m2 threshold.',
  },
  {
    clause: '1.19(6)',
    after: '1.19(5)',
    text: 'Nothing in this clause prevents complying development being carried out on part of a lot that '
      + 'is not land referred to in this clause even if other parts of the lot are such land.',
    why: 'PART-LOT RULE, and the most consequential omission on this page. Every exclusion in 1.19(1) is '
      + 'subject to it. Our lot sweep rules out the whole lot whenever it intersects a layer, so we are '
      + 'systematically stricter than the instrument on all of (a) to (j).',
  },

  // -- 1.19A ----------------------------------------------------------------------------------------
  {
    clause: '1.19A(2)',
    after: '1.19A(1)(b)',
    text: 'This clause does not apply to the following development— (a) non-habitable detached '
      + 'development that is more than 6m from any dwelling house, (b) landscaped areas, (c) '
      + 'non-combustible fences, (d) swimming pools.',
    why: 'Four carve-outs from the bush fire clause, the same shape as the 1.19(1)(a) carve-out. A shed '
      + 'well clear of the house, a fence or a pool is not caught by the bush fire test at all.',
  },
  {
    clause: '1.19A(3)',
    after: '1.19A(2)',
    text: 'For the purposes of this clause, land is not in bush fire attack level-40 (BAL-40) or the '
      + 'flame zone (BAL-FZ) if— (a) the council or a person who is recognised by the NSW Rural Fire '
      + 'Service as a suitably qualified consultant in bush fire risk assessment determines, in '
      + 'accordance with the methodology specified in Planning for Bush Fire Protection, that the land is '
      + 'not in bush fire attack level-40 (BAL-40) or the flame zone (BAL-FZ), or (b) in the case of '
      + 'development carried out on grasslands—the development conforms to the specifications and '
      + 'requirements of Table 7.9a of Planning for Bush Fire Protection that are relevant to the '
      + 'development.',
    why: 'A site assessment can take land OUT of BAL-40. No map settles this clause on its own, which is '
      + 'the real reason our bush fire test cannot be made exact from layers alone.',
  },
  {
    clause: '1.19A(4)',
    after: '1.19A(3)',
    text: 'Nothing in this clause prevents complying development being carried out on part of a lot that '
      + 'is not land referred to in this clause even if other parts of the lot are such land.',
    why: 'The part-lot rule again, for bush fire.',
  },
]

/** Complying development codes named in clause 1.5(1) that CDC_TYPES has no entry for. */
export const CDC_MISSING_CODES: MissingCode[] = [
  {
    name: 'Pattern Book Development Code',
    part: 'Part 3BA',
    page: '/pattern-book',
    note: 'Inserted by 2025 (355), in force 30 July 2025. It names the patterns themselves - "Semis 01 by '
      + 'Anthony Gill Architects", "Manor Homes 01 by Studio Johnston", "Row Homes 01 by SAHA", "Terraces '
      + '01" to "04" - which are the designs on our Pattern Book page. Clause 1.19 names this code three '
      + 'times: at (1), (2) and (3A).',
  },
  { name: 'Housing Alterations Code', part: 'Part 4', note: 'Named in 1.19(4). Carries alterations and additions.' },
  {
    name: 'General Development Code',
    part: 'Part 4A',
    note: 'Named in 1.19(4). Carries sheds, decks and pools - what the 1.19(1)(a) carve-out points at.',
  },
  { name: 'Industrial and Business Alterations Code', part: 'Part 5' },
  { name: 'Industrial and Business Buildings Code', part: 'Part 5A', note: 'Has its own exclusion list at 1.19(5).' },
  { name: 'Container Recycling Facilities Code', part: 'Part 5B' },
  { name: 'Subdivisions Code', part: 'Part 6' },
  { name: 'Demolition Code', part: 'Part 7' },
  { name: 'Fire Safety Code', part: 'Part 8' },
]

/**
 * A check that CDC_UNMAPPED still lists as having no clause, but which has since been traced to one.
 *
 * CDC_UNMAPPED is generated from the workbook and the notebook, and the workbook genuinely gives these
 * no clause - so the generated file is right and must not be edited. What changed is our knowledge, and
 * that belongs here with the rest of it. The page subtracts these from the "tests with no clause" count
 * and says what each was traced to.
 */
export interface TracedCheck {
  /** The column in CDC_UNMAPPED. */
  column: string
  clause: string
  why: string
}

export const CDC_TRACED: TracedCheck[] = [
  {
    column: 'mine_subsidence_district',
    clause: '1.18(1)(f)',
    why: 'Traced 2026-09-23. The clause is in the instrument and now on this page in violet. It requires '
      + 'the Mine Subsidence Board\'s prior approval rather than excluding the land, so the test is real '
      + 'but its verdict was wrong: cdc.layers now carries the layer as a condition.',
  },
]

/** Where all of the above was read from. */
export const CDC_INSTRUMENT_DOC = '/doc-viewer?doc=exempt-and-complying-2008'
export const CDC_AUDITED_ON = '2026-09-23'
