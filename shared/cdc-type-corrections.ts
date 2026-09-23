/**
 * What the Codes SEPP and the Housing SEPP say that the Department workbook's PER-CODE sheets left out,
 * read from the instruments themselves.
 *
 * WHY THIS FILE EXISTS, SEPARATELY FROM cdc-corrections.ts
 *
 * cdc-corrections.ts holds the audit of the GENERAL prerequisites - clauses 1.17A to 1.19A, the rows
 * that gate every certificate type. This file holds the audit of sheets 2 to 13, the code for the
 * development itself. They are kept apart because they are rendered apart, and because the general
 * audit only ever found page faults while this one also names rules that are wrong in the notebook.
 *
 * Sources: public/EPI/SEPP/exempt-and-complying-2008.md (consolidated epi-2008-0572) and
 * public/EPI/SEPP/housing-sepp-2021.md (epi-2021-0714). The load-bearing clauses were re-checked
 * against epi-2008-0572_2026-03-26.xml and epi-2021-0714_2026-03-23.xml, because the markdown is a
 * conversion and a conversion can lose a paragraph.
 *
 * The page renders everything in this file in BLUE, beside the general audit's violet, so a reader can
 * tell which layer a row came from: violet = the general prerequisites read from the instrument,
 * blue = the code for the development read from the instrument.
 *
 * Text marked as added is VERBATIM from the instrument, em dashes and all.
 */

const CODES = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2008-0572'
const HOUSING = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714'

/** Which instrument an added row belongs to, so the page can build the anchor. */
export type Instrument = 'codes' | 'housing'

/** The instrument's anchor format. Matches 3D.18, 3BA.6, 1.19A and the bare Housing SEPP numbers. */
export function typeClauseLink(clause: string, instrument: Instrument = 'codes') {
  const base = instrument === 'housing' ? HOUSING : CODES
  const sec = clause.match(/^(\d+[A-Z]*\.\d+[A-Z]*)/) ?? clause.match(/^(\d+)\(/)
  return sec ? `${base}#sec.${sec[1]}` : base
}

/** A citation one of the sheets uses that the instrument does not. */
export interface TypeClauseFix {
  /** The CdcType.key of the tab the row sits on. */
  type: string
  /** The citation as cdc-criteria.ts carries it. */
  wrong: string
  /** What the instrument actually calls it, or a plain statement that it has no clause. */
  right: string
  why: string
}

/** A requirement one of the sheets never transcribed. */
export interface TypeAdded {
  type: string
  clause: string
  text: string
  /** What it changes for us - why it is worth having on the page. */
  why: string
  instrument?: Instrument
  /** The clause this one follows within that type's list, so the table keeps the instrument's order. */
  after: string | null
}

/**
 * A note hung under a row that is otherwise present.
 *
 * `diverge` is the expensive kind: the clause is cited right and OUR RULE does something else. Those
 * are notebook bugs rather than page bugs, and the page says so rather than quietly agreeing with
 * itself. `text` is the workbook's wording being stale, inverted, or copied from another sheet.
 */
export interface TypeNote {
  type: string
  clause: string
  kind: 'diverge' | 'text'
  what: string
}

/** A row on a sheet that is a clause heading rather than a requirement, so the counts can exclude it. */
export interface TypeParent {
  type: string
  clause: string
}

// -- citations ---------------------------------------------------------------------------------------

export const CDC_TYPE_FIXES: TypeClauseFix[] = [
  {
    type: 'dwelling-houses',
    wrong: '3C.3(b)',
    right: 'no clause - the proposition is not in the instrument',
    why: '3C.3(b) is "development that is complying development under the Housing Alterations Code". And '
      + 'nothing anywhere in the consolidation makes the Housing Code inapplicable in the Greenfield '
      + 'Housing Code Area: the only clause of that shape is 3D.1(3), which disapplies the Housing and '
      + 'Rural Housing Codes on INLAND Code land. The two codes overlap and an applicant may use either.',
  },
  {
    type: 'inland-dwelling-houses',
    wrong: '3D.9',
    right: '3D.10(1)(a)',
    why: '3D.9 is "Application of Division" and sets no lot size at all - it says the Division does not '
      + 'apply in Zones RU5, R1, R2, R3, R4 and R5. The lot requirement is 3D.10(1)(a), and it does not '
      + 'say what this row says. See the note below it.',
  },
  {
    type: 'rural-housing',
    wrong: '3A.9',
    right: '3A.9(1)(c)',
    why: 'The subclause is missing from the citation. 3A.9(1)(c) is the battle-axe paragraph quoted here.',
  },
  {
    type: 'rural-housing',
    wrong: '3A.9(b)',
    right: '3A.9(1)(b)',
    why: 'The subclause is missing from the citation.',
  },
  {
    type: 'rural-housing',
    wrong: '3.1(3)(c)',
    right: 'no clause in the Rural Housing Code',
    why: 'This is the HOUSING Code’s 6m width rule, sitting on the Rural Housing sheet. Part 3A has '
      + 'no building-line width rule except 3A.9(1)(b), which is 18m and applies only in Zone R5.',
  },
  {
    type: 'secondary-dwelling',
    wrong: '54(2)(a)',
    right: '54(2)(c)',
    why: 'The 450m2 is paragraph (c). Paragraph (a) is the pointer to the Codes SEPP general '
      + 'requirements, which is a different thing and a narrower set than we apply - see the note on it.',
  },
  {
    type: 'secondary-dwelling',
    wrong: 'Sch.1 Part 2(1)(b)',
    right: 'Housing SEPP, Schedule 1, clause 2(1)(b)',
    why: 'This row links to Schedule 1 of the CODES SEPP, which was repealed in 2010 (2010 (656), Sch 1 '
      + '[139]). The lot width table is Schedule 1 of the HOUSING SEPP, which is what clause 54(2)(d) '
      + 'points at, and it is a clause rather than a Part.',
  },
  {
    type: 'manor-houses',
    wrong: '3b.21(a)',
    right: '3B.21(a)',
    why: 'Typed by hand on the sheet with a lower-case b, and carried through the generator as typed.',
  },
  {
    type: 'manor-houses',
    wrong: '3b.21(c)',
    right: '3B.21(c)',
    why: 'Typed by hand on the sheet with a lower-case b, and carried through the generator as typed.',
  },
  {
    type: 'farm-stay-accommodation',
    wrong: '9.13(k)(iii)',
    right: '9.13(1)(k)(iii)',
    why: 'The subclause is missing. Every standard in this clause sits under 9.13(1).',
  },
  {
    type: 'farm-stay-accommodation',
    wrong: '9.13(k)(iv)',
    right: '9.13(1)(k)(iv)',
    why: 'The subclause is missing. Every standard in this clause sits under 9.13(1).',
  },
  // 182(d)-(l) all lost their subclause on the way out of sheet 13, while (a)-(c) kept it.
  ...'defghijkl'.split('').map(letter => ({
    type: 'mid-rise-housing-pattern',
    wrong: `182(${letter})`,
    right: `182(1)(${letter})`,
    why: 'The subclause is missing. Clause 182(1) is the list of land the chapter does not apply to; '
      + 'paragraphs (a) to (c) on this sheet carry the (1) and the rest do not.',
  })),
]

// -- notes on rows that are already there --------------------------------------------------------------

export const CDC_TYPE_NOTES: TypeNote[] = [
  // our rule disagrees with the clause
  {
    type: 'secondary-dwelling',
    clause: '54(1)(a)',
    kind: 'diverge',
    what: 'OUR RULE IS WRONG HERE. The clause reads "is on land in a residential zone other than Zone R5 '
      + 'Large Lot Residential". The sheet quotes the Housing SEPP dictionary, where residential zone '
      + 'does include R5, and misses the carve-out in the same sentence. We test R1, R2, R3, R4 and R5, '
      + 'so every R5 lot we pass here is one the clause excludes.',
  },
  {
    type: 'secondary-dwelling',
    clause: '54(2)(a)',
    kind: 'diverge',
    what: 'This row is also the whole of what a secondary dwelling inherits. Clause 54(2) pulls in the '
      + 'Codes SEPP "clauses 1.17A and 1.18(1) and (2)" and "land referred to in clause 1.19(1)", and '
      + 'nothing else - not 1.19A, not Schedule 5. We apply all of the general prerequisites above, '
      + 'including the bush fire test, which clause 54 never invokes.',
  },
  {
    type: 'secondary-dwelling',
    clause: '54(3)(b)',
    kind: 'text',
    what: '54(2) and 54(3) are ALTERNATIVE branches, not one cumulative list: (2) is a secondary dwelling '
      + 'attached to or separate from the principal dwelling, (3) is one inside it. This sheet takes the '
      + '450m2 from (2) and this row and the next from (3), and presents them as a single set.',
  },
  {
    type: 'rural-housing',
    clause: '3A.2',
    kind: 'diverge',
    what: 'OUR RULE MATCHES NO CLAUSE. 3A.2(1) specifies a new dwelling house on a lot "(a) in Zone RU1, '
      + 'RU2, RU4 or RU6 that has an area of at least 4,000m2, or (b) in Zone R5" - Zone R5 carries no '
      + 'area minimum at all, and RU3 is not in 3A.2 (the code reaches RU3 only for alterations and '
      + 'ancillary development, through 3A.1). We test the zone list RU1, RU2, RU3, RU4, RU6, R5 AND '
      + '4,000m2 together, so we reject qualifying R5 lots under 4,000m2 and accept RU3 lots that cannot '
      + 'have a new dwelling house at all. The inland sheet already splits by zone; this one needs it.',
  },
  {
    type: 'inland-dwelling-houses',
    clause: '3D.9',
    kind: 'diverge',
    what: 'OUR RULE IS WRONG HERE, and so is this row’s wording. 3D.10(1)(a) requires an area of not '
      + 'less than "(i) the minimum lot area specified in the environmental planning instrument that '
      + 'applies to the land concerned, or (ii) if no size is specified in the environmental planning '
      + 'instrument-4,000m2". The 4,000m2 is the FALLBACK where the LEP is silent, not a floor. We test '
      + 'area >= 4,000m2, so a 5,000m2 lot under a 40ha minimum passes our test and fails the clause.',
  },
  {
    type: 'inland-dwelling-houses',
    clause: '3D.29(1)(a)',
    kind: 'diverge',
    what: 'The same shape as 3D.10(1)(a): 800m2 applies only "if no size is specified in the '
      + 'environmental planning instrument". Otherwise the LEP minimum is the requirement, and we test '
      + 'the 800 as though it were a floor.',
  },
  {
    type: 'multi-dwelling-housing-terraces',
    clause: '3B.33(1)',
    kind: 'diverge',
    what: 'The clause is not a flat 600m2. 3B.33(1) requires the minimum lot area specified for multi '
      + 'dwelling housing (terraces) in the LEP - or for multi dwelling housing, if the LEP names no '
      + 'figure for terraces - and reaches 600m2 only "if" that figure is less than 600m2 or absent. The '
      + 'LEP limb excludes State Environmental Planning Policy (Housing) 2021, Chapter 6, Part 3, '
      + 'Division 2, so an LMR minimum does not count. We test the 600 floor alone.',
  },
  {
    type: 'manor-houses',
    clause: '3b.21(a)',
    kind: 'diverge',
    what: 'The clause is "not less than whichever is greater of (i) 600m2, (ii) the minimum lot area '
      + 'specified for manor houses in the environmental planning instrument, other than State '
      + 'Environmental Planning Policy (Housing) 2021, Chapter 6, Part 4, Division 2". This row drops '
      + 'the second limb entirely, and we test only the 600m2 floor - so a lot can pass here and fail '
      + 'the clause. The dual occupancy sheet states both limbs; this one does not.',
  },
  {
    type: 'manor-houses',
    clause: '3B.2(g)',
    kind: 'diverge',
    what: 'THIS CLAUSE DOES NOT REACH MANOR HOUSES. 3B.2(g) is "the erection of multi dwelling housing '
      + '(terraces) on bush fire prone land" - terraces only. It is correctly on the terraces sheet and '
      + 'correctly absent from dual occupancy. Carrying it here rules out every manor house on bush fire '
      + 'prone land that the code in fact allows.',
  },
  {
    type: 'dual-occupancy',
    clause: '3B.8(2)',
    kind: 'diverge',
    what: 'This is only half of the dual occupancy width rule. Clause 3B.7 sends a dual occupancy where '
      + 'no dwelling sits above another to this Division; clause 3B.20 sends a STACKED dual occupancy - '
      + '"where part of a dwelling is located above part of another dwelling" - to Division 3, where '
      + '3B.21(c) requires a flat 15m and there is no 12m concession for rear or lane access.',
  },
  // the workbook's wording
  {
    type: 'dual-occupancy',
    clause: '3B.8(1)',
    kind: 'text',
    what: 'The wording is out of date. Paragraph (b) now reads "the minimum lot area specified for dual '
      + 'occupancies in the environmental planning instrument, OTHER THAN State Environmental Planning '
      + 'Policy (Housing) 2021, Chapter 6, Part 2, Division 2, that applies to the land concerned" - an '
      + 'LMR minimum does not count towards this test. Clause 3B.8(1A), added below, is also missing.',
  },
  {
    type: 'greenfield-housing',
    clause: '3C.2(3)(b)',
    kind: 'text',
    what: 'Confirmed against the instrument: 3C.2(3)(b) reads "the area of the lot must not be less than '
      + '200m2". The sheet’s "must not be 200m2 or greater" is a transcription error, and the note '
      + 'beside this row is right to read it as a minimum. That is no longer an inference from the other '
      + 'codes - it is what this clause says.',
  },
  {
    type: 'inland-dwelling-houses',
    clause: '3D.1(1)',
    kind: 'text',
    what: 'Two things. The zone list drops RU3, which 3D.1(1) includes - the code does reach RU3, it is '
      + 'only a NEW DWELLING HOUSE that cannot go there. And the note cites "3B.4" for that ban; the '
      + 'clause is 3D.4(e), added below. 3B.4 is the Low Rise Housing Diversity Code’s bush fire '
      + 'clause and has nothing to do with the Inland Code.',
  },
  {
    type: 'inland-dwelling-houses',
    clause: '3D.29(1)(d)',
    kind: 'text',
    what: 'The wording belongs to the other Division. This row sits in 3D.29, which is Zone R5, but the '
      + 'text reads "For Zones RU5, R1, R2, R3 and R4" - it is 3D.18(1)(d) copied one row too far.',
  },
  {
    type: 'agritourism',
    clause: '9.2(1)',
    kind: 'text',
    what: 'This is not 9.2’s wording - it is the Part 3B flood paragraph pasted in, and it inverts '
      + 'the sense. Clause 9.2(1) is permissive and part-lot: "Development specified for this code MAY '
      + 'be carried out on a flood control lot, other than the part of a flood control lot comprising" '
      + 'the five areas. The farm stay sheet carries the right text for the same clause.',
  },
  {
    type: 'manor-houses',
    clause: '3B.4(2)(c)',
    kind: 'text',
    what: 'The clause is not manor-house-only: 3B.4(2)(c) reads "the dual occupancy or manor house must '
      + 'be able to be connected to mains electricity". The dual occupancy sheet does not carry it.',
  },
  {
    type: 'mid-rise-housing-pattern',
    clause: '182(j)',
    kind: 'text',
    what: 'REPEALED. Paragraph (j) - the Deferred Transport Oriented Development Areas Map - is empty in '
      + 'the current consolidation, and "Deferred Transport Oriented Development Areas Map" appears '
      + 'nowhere in epi-2021-0714 as at 23 March 2026. Eleven of the twelve rows on this sheet are live. '
      + 'Schedule 12, which paragraph (k) still uses, survives.',
  },
]

// -- requirements the sheets never transcribed ---------------------------------------------------------

export const CDC_TYPE_ADDED: TypeAdded[] = [
  // Housing Code: 3.1(3) has seven paragraphs, the sheet took three
  {
    type: 'dwelling-houses', after: '3.1(3)(c)', clause: '3.1(3)(d)',
    text: 'there must only be 1 dwelling house on the lot at the completion of the development,',
    why: 'The lot has to end up with one dwelling house. Clause 3.1(4) adds that a secondary dwelling '
      + 'with consent does not count as one for this test.',
  },
  {
    type: 'dwelling-houses', after: '3.1(3)(d)', clause: '3.1(3)(e)',
    text: 'the lot must have lawful access to a public road at the completion of the development,',
    why: 'TESTABLE. Landlocked lots are out, and the frontage work already tells them apart - this is '
      + 'what the zero-frontage residual is about.',
  },
  {
    type: 'dwelling-houses', after: '3.1(3)(e)', clause: '3.1(3)(f)',
    text: 'if the development is on a battle-axe lot—the lot must be at least 12m by 12m (not '
      + 'including the access laneway) and must have an access laneway that is at least 3m wide,',
    why: 'TESTABLE. Battle-axe detection and handle width are both in the lot metrics. The workbook '
      + 'lists this rule for greenfield and inland but not for the Housing Code.',
  },
  {
    type: 'dwelling-houses', after: '3.1(3)(f)', clause: '3.1(3)(g)',
    text: 'if the development is on a corner lot—the width of the primary road boundary of the lot '
      + 'must be at least 6m.',
    why: 'TESTABLE, and not the same test as the 6m of (c): this one measures the primary road boundary '
      + 'of a corner lot, not the width at the building line.',
  },
  {
    type: 'dwelling-houses', after: '3.1(3)(g)', clause: '3.2(1)(d)',
    text: 'the erection of a building over a registered easement,',
    why: 'A title test rather than a land test, and the only paragraph of 3.2(1) besides landslide that '
      + 'a desktop check could reach. The sheet took one of nine paragraphs.',
  },

  // Greenfield Housing Code: 3C.2(3)
  {
    type: 'greenfield-housing', after: '3C.2(3)(c)', clause: '3C.2(3)(e)',
    text: 'there must only be 1 dwelling house on the lot at the completion of the development,',
    why: 'The same one-dwelling test the Housing Code has at 3.1(3)(d).',
  },
  {
    type: 'greenfield-housing', after: '3C.2(3)(e)', clause: '3C.2(3)(f)',
    text: 'the lot must have lawful access to a public road at the completion of the development,',
    why: 'TESTABLE, and missing from every sheet whose code contains it.',
  },
  {
    type: 'greenfield-housing', after: '3C.2(3)(g)', clause: '3C.2(3)(h)',
    text: 'if the development is on a corner lot—the width of the primary road boundary of the lot '
      + 'must be at least 6m.',
    why: 'TESTABLE. The sheet kept the battle-axe paragraph beside it but not this one.',
  },
  {
    type: 'greenfield-housing', after: '3C.2(3)(h)', clause: '3C.3(1)(d)',
    text: 'the erection of a building over a registered easement,',
    why: 'The greenfield twin of 3.2(1)(d). Note that the dwelling houses tab cites this same clause, as '
      + '"3C.3(b)", for something else entirely.',
  },

  // Low Rise Housing Diversity Code
  {
    type: 'dual-occupancy', after: '3B.1(3)(a)', clause: '3B.1(3)(b)',
    text: 'the lot must have lawful access to a public road at the completion of the development.',
    why: 'The second half of the lot requirement. It appears on the manor houses sheet, folded into a '
      + 'combined 3B.1(3) row, and on neither of the other two.',
  },
  {
    type: 'dual-occupancy', after: '3B.2(d)', clause: '3B.2(e)',
    text: 'the erection of a building over a registered easement,',
    why: 'One of the four paragraphs of 3B.2 that none of the three sheets transcribed - the others are '
      + '(a) roof terraces, (b) the Housing Alterations Code overlap and (f) garages forward of the '
      + 'building line.',
  },
  {
    type: 'dual-occupancy', after: '3B.2(j)', clause: '3B.4(1)',
    text: 'This clause does not apply to the following complying development under this code— (a) a '
      + 'non-habitable detached development that is more than 6m from any residential accommodation, '
      + '(b) a landscaped area, (c) a non-combustible fence, (d) a swimming pool.',
    why: 'The bush fire carve-outs, the same shape as 1.19A(2) in the general list. A shed well clear of '
      + 'the house, a fence or a pool is not caught by the bush fire standards at all.',
  },
  {
    type: 'dual-occupancy', after: '3B.4(1)', clause: '3B.4(2)(c)',
    text: 'the dual occupancy or manor house must be able to be connected to mains electricity,',
    why: 'The manor houses sheet carries this one and reads it as manor-house-only. It is not.',
  },
  {
    type: 'dual-occupancy', after: '3B.8(1)', clause: '3B.8(1A)',
    text: 'Despite subclause (1), the area of the parent lot in development carried out by or on behalf '
      + 'of the Aboriginal Housing Office, the Land and Housing Corporation or a registered community '
      + 'housing provider, within the meaning of State Environmental Planning Policy (Housing) 2021, '
      + 'must not be less than 400m2.',
    why: 'A flat 400m2 for social and affordable housing providers, with no LEP minimum on top. Not a '
      + 'land test - it turns on who is building - but it is why a 400m2 answer can be right on land '
      + 'where the LEP says more.',
  },
  {
    type: 'dual-occupancy', after: '3B.8(2)', clause: '3B.21(c)',
    text: 'the width of the lot must not be less than 15m measured at the building line.',
    why: 'The width rule for a STACKED dual occupancy, which clause 3B.20 sends to Division 3 rather '
      + 'than this one. A flat 15m, with no 12m concession for rear or lane access. Same lot, different '
      + 'number, depending on whether one dwelling sits above the other.',
  },
  {
    type: 'multi-dwelling-housing-terraces', after: '3B.1(3)(a)', clause: '3B.1(3)(b)',
    text: 'the lot must have lawful access to a public road at the completion of the development.',
    why: 'The second half of the lot requirement, missing from this sheet.',
  },
  {
    type: 'multi-dwelling-housing-terraces', after: '3B.2(d)', clause: '3B.2(e)',
    text: 'the erection of a building over a registered easement,',
    why: 'Missing from all three Low Rise Housing Diversity Code sheets.',
  },
  {
    type: 'manor-houses', after: '3B.2(d)', clause: '3B.2(e)',
    text: 'the erection of a building over a registered easement,',
    why: 'Missing from all three Low Rise Housing Diversity Code sheets.',
  },
  {
    type: 'manor-houses', after: '3B.2(j)', clause: '3B.4(1)',
    text: 'This clause does not apply to the following complying development under this code— (a) a '
      + 'non-habitable detached development that is more than 6m from any residential accommodation, '
      + '(b) a landscaped area, (c) a non-combustible fence, (d) a swimming pool.',
    why: 'The bush fire carve-outs. This sheet has 3B.4(2) and 3B.4(2)(c) but not the subclause that '
      + 'says when the whole clause is switched off.',
  },

  // Rural Housing Code
  {
    type: 'rural-housing', after: '3A.2', clause: '3A.2(2)',
    text: 'This clause does not apply if the size of the lot is less than the minimum lot size for the '
      + 'erection of a dwelling house under the environmental planning instrument applying to the lot.',
    why: 'The LEP minimum, which in rural zones is routinely tens of hectares. Our 4,000m2 test is a '
      + 'floor that this subclause usually sits far above, so passing it decides very little.',
  },
  {
    type: 'rural-housing', after: '3A.2(2)', clause: '3A.9(1)(a)',
    text: 'at the completion of the development will have only one dwelling house, and',
    why: 'The first paragraph of the lot requirements. The sheet took (b) and (c) and left (a).',
  },
  {
    type: 'rural-housing', after: '3A.9(b)', clause: '3A.9(2)',
    text: 'A lot on which a new single storey or two storey dwelling house is erected must have lawful '
      + 'direct frontage access or a right of carriageway to a public road or a road vested in or '
      + 'maintained by the council (other than a Crown road reserve).',
    why: 'TESTABLE in part, and worth having for the Crown road exclusion in particular - a Crown road '
      + 'reserve does not count as access, which is exactly the case the zero-frontage work turned up.',
  },
  {
    type: 'rural-housing', after: '3A.9(2)', clause: '3A.9(3)',
    text: 'If under section 88B of the Conveyancing Act 1919 a restriction is created that specifies a '
      + 'building envelope for a lot, development specified for this code may only be carried out within '
      + 'the building envelope specified.',
    why: 'A title restriction rather than a map. Nothing on the page said that a s88B building envelope '
      + 'can confine complying development on a rural lot.',
  },

  // Inland Code
  {
    type: 'inland-dwelling-houses', after: '3D.1(2)', clause: '3D.3(3)',
    text: 'Development specified for this code may only be carried out on a lot that has lawful direct '
      + 'frontage access or a right of carriageway to a public road or a road vested in or maintained by '
      + 'the council (other than an unformed Crown road or a Crown road vested in the Council, but not '
      + 'maintained).',
    why: 'The access test for the whole Inland Code, and stricter than the others: an unformed Crown '
      + 'road does not count.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.3(3)', clause: '3D.4(c)',
    text: 'the erection of a building within 1m of a public water or sewer mains,',
    why: 'TESTABLE wherever the utility mains are held. Unique to the Inland Code among our sheets.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.4(c)', clause: '3D.4(e)',
    text: 'the erection of a new dwelling house on land in Zone RU3,',
    why: 'This is the clause the 3D.1(1) note means when it cites "3B.4". Our three inland rules already '
      + 'leave RU3 out, so the rule was right and only the citation was missing.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.4(e)', clause: '3D.4(j)',
    text: 'development that penetrates any obstacle limitation surface shown on any relevant Obstacle '
      + 'Limitation Surface Plan that has been prepared by the operator of an aerodrome or airport '
      + 'operating within 2 kilometres of the proposed development and reported to the Civil Aviation '
      + 'Safety Authority,',
    why: 'An aerodrome test that is not the ANEF contour of 1.19(1)(h), and is on no sheet. It binds the '
      + 'building height rather than the land, but it rules out land near an aerodrome outright.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.4(j)', clause: '3D.4(k)',
    text: 'development that is on land shown on any relevant Procedures for Air Navigation Services—'
      + 'Aircraft Operations Map prepared by the operator of an aerodrome or airport operating within 2 '
      + 'kilometres of the proposed development and for which a PANS-OPS surface is identified that may '
      + 'compromise the effective and on-going operation of the relevant aerodrome or airport,',
    why: 'The PANS-OPS half of the same pair. Both are published per aerodrome rather than state-wide, '
      + 'which is why neither is among the ePlanning layers.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.9', clause: '3D.10(1)(b)',
    text: 'there must only be 1 dwelling house on the lot at the completion of the development.',
    why: 'The other half of the RU-zone lot requirement, from the clause this sheet should have cited.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.18(1)(b)', clause: '3D.18(1)(c)',
    text: 'there must only be 1 dwelling house on the lot at the completion of the development,',
    why: 'Missing from the RU5/R1-R4 lot requirements.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.18(1)(d)', clause: '3D.18(1)(e)',
    text: 'if the development is on a corner lot—the width of the primary road boundary of the lot '
      + 'must be at least 6m.',
    why: 'TESTABLE, and absent from every sheet whose code contains a corner lot rule.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.29(1)(b)', clause: '3D.29(1)(c)',
    text: 'there must only be 1 dwelling house on the lot at the completion of the development,',
    why: 'Missing from the Zone R5 lot requirements.',
  },
  {
    type: 'inland-dwelling-houses', after: '3D.29(1)(d)', clause: '3D.29(1)(e)',
    text: 'if the development is on a corner lot—the width of the primary road boundary of the lot '
      + 'must be at least 18m.',
    why: 'TESTABLE, and note the number: 18m on a Zone R5 corner lot, not the 6m of the other divisions.',
  },
  {
    type: 'inland-farm-buildings', after: '3D.1(2)', clause: '3D.4(j)',
    text: 'development that penetrates any obstacle limitation surface shown on any relevant Obstacle '
      + 'Limitation Surface Plan that has been prepared by the operator of an aerodrome or airport '
      + 'operating within 2 kilometres of the proposed development and reported to the Civil Aviation '
      + 'Safety Authority,',
    why: 'Farm buildings are tall and often near a strip, so this paragraph of 3D.4 bites here at least '
      + 'as hard as it does for dwelling houses.',
  },
  {
    type: 'inland-farm-buildings', after: '3D.4(j)', clause: '3D.4(k)',
    text: 'development that is on land shown on any relevant Procedures for Air Navigation Services—'
      + 'Aircraft Operations Map prepared by the operator of an aerodrome or airport operating within 2 '
      + 'kilometres of the proposed development and for which a PANS-OPS surface is identified that may '
      + 'compromise the effective and on-going operation of the relevant aerodrome or airport,',
    why: 'The PANS-OPS half of the pair.',
  },

  // Secondary dwelling: the Housing SEPP's own Schedule 1
  {
    type: 'secondary-dwelling', after: 'Sch.1 Part 2(1)(b)', clause: 'Schedule 1, cl 2(1)(a)',
    instrument: 'housing',
    text: 'at the completion of the development will have only 1 principal dwelling and 1 secondary '
      + 'dwelling, and',
    why: 'The first paragraph of the same clause the width table comes from.',
  },
  {
    type: 'secondary-dwelling', after: 'Schedule 1, cl 2(1)(a)', clause: 'Schedule 1, cl 2(1)(c)',
    instrument: 'housing',
    text: 'for a battle-axe lot—has an access laneway of at least 3m in width and measuring at least '
      + '12m by 12m, excluding the access laneway.',
    why: 'TESTABLE. The width table above applies only to a lot OTHER than a battle-axe lot; this is what '
      + 'a battle-axe lot has to meet instead. Without it the sheet reads as though battle-axe lots have '
      + 'no rule at all.',
  },
  {
    type: 'secondary-dwelling', after: 'Schedule 1, cl 2(1)(c)', clause: 'Schedule 1, cl 2(2)',
    instrument: 'housing',
    text: 'A lot on which a new secondary dwelling is erected must have lawful access to a public road.',
    why: 'TESTABLE, and the last of the lot requirements.',
  },

  // Agritourism and Farm Stay Accommodation Code
  {
    type: 'agritourism', after: '9.2(1)', clause: '9.3A',
    text: 'Development is not development specified for this code if it is carried out on land identified '
      + 'as susceptible to landslide risk in an environmental planning instrument applying to the land.',
    why: 'TESTABLE TODAY, AND NOT TESTED. Clause 9.3A sits in Part 9’s general division, so it '
      + 'catches agritourism and farm stay alike. We already run the landsliderisk column for five other '
      + 'types and the layer is in the cdc schema; it is simply not wired to these two.',
  },
  {
    type: 'agritourism', after: '9.4', clause: '9.5(d)',
    text: 'for the change of use of a building, or alterations or additions to a building that involve '
      + 'internal alterations only—the building must not be located within— (i) 250m of '
      + 'residential accommodation on neighbouring land, or (ii) 250m of a property boundary for land '
      + 'used for the purposes of one of the following— (A) forestry, (B) intensive livestock '
      + 'agriculture, (C) intensive plant agriculture, (D) mines, (E) extractive industries, (F) rail '
      + 'lines, (G) rural industries,',
    why: 'The same 250m pair the sheet already carries for new buildings, here for the change-of-use '
      + 'case. Without it the page reads as though a conversion has no separation distance.',
  },
  {
    type: 'agritourism', after: '9.5(d)', clause: '9.5(e)(i)',
    text: 'for the erection of a building, or alterations or additions to a building that involve '
      + 'external alterations—the building must not be located within 6m of another building on the '
      + 'landholding,',
    why: 'The first paragraph of the (e) list, whose (iii) and (iv) the sheet does carry.',
  },
  {
    type: 'agritourism', after: '9.5(e)(i)', clause: '9.5(e)(ii)',
    text: '…or 50m of a property boundary or waterway, or',
    why: 'TESTABLE. A 50m setback from a waterway is a hydrology buffer, and the riparian and watercourse '
      + 'layers in the cdc schema would answer it for the great majority of rural landholdings.',
  },
  {
    type: 'agritourism', after: '9.5(e)(iv)', clause: '9.5(f)',
    text: 'for a building on a lot for which the natural ground is, at a point within 100m of the '
      + 'ridgeline of a hill, at least 20m lower than the ridgeline—the highest point of the '
      + 'building, if located within 100m of the ridgeline, must be at least 5m below the ridgeline,',
    why: 'TESTABLE from the DEM that already produces the slope layer - it is a ridgeline-proximity and '
      + 'relative-height test, not a gradient one.',
  },
  {
    type: 'farm-stay-accommodation', after: '9.2', clause: '9.3A',
    text: 'Development is not development specified for this code if it is carried out on land identified '
      + 'as susceptible to landslide risk in an environmental planning instrument applying to the land.',
    why: 'TESTABLE TODAY, AND NOT TESTED. The same general-division clause that catches agritourism.',
  },
  {
    type: 'farm-stay-accommodation', after: '9.13(1)(a)', clause: '9.13(1)(b)(ii)',
    text: 'the building or manufactured home must be located on a lot that is at least the minimum size '
      + 'permitted under the environmental planning instrument applying to the land,',
    why: 'The LEP minimum lot size, alongside the 15ha landholding above it. The alternative limb, '
      + '9.13(1)(b)(i), is satisfied instead if there is already a lawfully erected dwelling house.',
  },
  {
    type: 'farm-stay-accommodation', after: '9.13(1)(b)(ii)', clause: '9.13(1)(c)',
    text: 'for development on land within 2km of an aerodrome or airport— (i) the development must '
      + 'not be carried out on land for which a PANS-OPS surface is identified that may compromise the '
      + 'effective and ongoing operation of the aerodrome or airport, as shown on a Procedures for Air '
      + 'Navigation Services—Aircraft Operations Map prepared by the operator of the aerodrome or '
      + 'airport, and (ii) the building or manufactured home must not penetrate an obstacle limitation '
      + 'surface shown on an Obstacle Limitation Surface Plan prepared by the operator of the aerodrome '
      + 'or airport and reported to the Civil Aviation Safety Authority,',
    why: 'The aerodrome pair again, here as a single paragraph. Farm stay accommodation near a regional '
      + 'strip is a common case.',
  },
]

// -- rows that are headings, not requirements ----------------------------------------------------------

/**
 * Sheet 6 states each clause twice, prose then question, and the generator merged the two by clause.
 * What it could not do is tell a heading from a requirement, so four of the manor house rows are the
 * words that introduce a clause rather than anything to satisfy. They are marked here so the counts on
 * this page do not read them as untested requirements.
 */
export const CDC_TYPE_PARENTS: TypeParent[] = [
  { type: 'manor-houses', clause: '3B.1' },
  { type: 'manor-houses', clause: '3B.1(3)' },
  { type: 'manor-houses', clause: '3B.2' },
  { type: 'manor-houses', clause: '3B.4(2)' },
]

export const CDC_TYPES_AUDITED_ON = '2026-09-23'
