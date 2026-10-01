/**
 * /build-to-rent - Housing SEPP Chapter 3, Part 4 (ss 72-78), clause by clause.
 *
 * Build-to-rent is not one of the Standard Instrument's land uses, so no Land Use Table permits it
 * and no permissibility lookup can find it. Section 72 makes three uses - multi dwelling housing,
 * residential flat buildings and shop top housing - permissible with consent as build-to-rent on the
 * land it lists. A lot qualifies by being on that land; the 50-dwelling and same-lot conditions are
 * about the proposal, not the land.
 *
 * Text: public/EPI/SEPP/housing-sepp-2021.md, amendments to 2026 (33). Audited 2026-10-01.
 */
import type { RequirementPage } from './requirement-pages'

const PS_SEPP = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0724'

export const BUILD_TO_RENT: RequirementPage = {
  title: 'Build-to-rent housing — where the Housing SEPP permits it',
  sub: 'Chapter 3, Part 4 of the Housing SEPP, clause by clause: the land section 72 reaches, what the '
    + 'development must then be, and what we hold to test each part. Nothing here tests a lot yet.',
  provision: 'Housing SEPP 2021 · Chapter 3, Part 4 · ss 72–78',
  auditedOn: '2026-10-01',

  request: {
    heading: 'Build-to-Rent Housing is allowed where:',
    bullets: [
      'Any zone or TOD where residential flat buildings are permitted; and',
      'Where multi dwelling housing, residential flat buildings or shop top housing are allowed in the '
        + 'following zones: within the LMR area · Zone E2 Commercial Centre · Zone MU1 Mixed Use · '
        + 'Zone B3 Commercial Core · Zone B4 Mixed Use · Zone B8 Metropolitan Centre',
    ],
  },

  requestLines: [
    {
      said: 'Any zone … where residential flat buildings are permitted',
      clause: '72(2)(a)(i)', verdict: 'matches',
      why: 'Word for word: "a zone in which development for the purposes of residential flat buildings is '
        + 'permissible under another environmental planning instrument". In practice that is the LEP\'s '
        + 'Land Use Table, plus any other plan that permits them.',
    },
    {
      said: '… or TOD where residential flat buildings are permitted',
      clause: '72(2)(a1)', verdict: 'matches',
      why: 'The TOD limb has the same condition: a Transport Oriented Development Area under Chapter 5 in '
        + 'which residential flat buildings are permissible. Section 154 makes them permissible in the '
        + 'residential zones and E1 of those areas, so most TOD land passes - but not all of it.',
    },
    {
      said: 'MDH, RFB or shop top housing allowed … within the LMR area',
      clause: '72(2)(a2)', verdict: 'different',
      why: 'The clause asks whether one of the three is permissible under Chapter 6, not whether the LEP '
        + 'permits it on land that happens to be in the LMR area. Chapter 6 is what makes them '
        + 'permissible there (ss 170 and 174), and only on lots that clear its own exclusions (s 164). '
        + 'So the test is our LMR layer\'s per-type verdict, not the LEP plus an outline.',
    },
    {
      said: 'MDH, RFB or shop top housing allowed in E2 / MU1 / B3 / B4 / B8',
      clause: '72(2)(a)(ia)–(iv)', verdict: 'narrower',
      why: 'In these zones the clause asks nothing about permissibility: being in the zone is enough, '
        + 'and section 72 itself is what permits the three uses there. Requiring the LEP to permit one '
        + 'of them as well would drop land the SEPP reaches.',
    },
    {
      said: 'Zone SP5 Metropolitan Centre',
      clause: '72(2)(a)(v)', verdict: 'missing',
      why: 'The sixth listed zone. Our 07B notebook does include it; the request does not.',
    },
    {
      said: 'Land with a site compatibility certificate',
      clause: '72(2)(b)', verdict: 'missing',
      why: 'Any land with a certificate issued under s 39. Certificates are issued site by site and no '
        + 'register of them is published as data, so this limb can be cited but not mapped.',
    },
    {
      said: 'The "WestConnex Dive Site"',
      clause: '72(2)(c)', verdict: 'missing',
      why: 'A single named site on the State Significant Development Sites Map (Planning Systems SEPP, '
        + 'Ch 2). We hold that map, and the site is on it.',
    },
    {
      said: 'At least 50 dwellings, all on the same lot',
      clause: '72(3)', verdict: 'missing',
      why: 'Not a land test, but it decides whether the land is any use: 50 dwellings on one lot rules '
        + 'out most residential lots in practice. A filter can flag it; it cannot apply it.',
    },
  ],

  sections: [
    {
      id: 'where',
      title: 'Section 72(2) — the land it reaches',
      lead: 'Any one of these is enough. Each limb is a separate route in, so a lot needs to pass only one.',
      rows: [
        {
          clause: '72(1)', role: 'definition', data: 'proposal',
          text: 'The objective of this section is to enable certain residential accommodation to be used as build-to-rent housing.',
          dataNote: 'The objective.',
        },
        {
          clause: '72(2)', role: 'where', data: 'proposal',
          text: 'This Part applies to development for the purposes of multi dwelling housing, residential flat buildings or shop top housing on land—',
          dataNote: 'Build-to-rent is a way of holding one of these three uses, not a use of its own. No Land Use Table names it.',
        },
        {
          clause: '72(2)(a)(i)', role: 'where', data: 'held',
          text: '(a) in the following zones— (i) a zone in which development for the purposes of residential flat buildings is permissible under another environmental planning instrument,',
          dataNote: 'The zone from the zoning layer, then whether that plan\'s Land Use Table permits residential flat buildings in it.',
          tables: ['epi.epi_land_zoning', 'nsw.lep_permissibility'],
          note: '"Another environmental planning instrument" is wider than the LEP - a Precincts SEPP can permit them too. The LEP table is most of it, not all of it.',
        },
        {
          clause: '72(2)(a)(ia)', role: 'where', data: 'held',
          text: '(ia) Zone E2 Commercial Centre,', dataNote: 'Zone alone.', tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '72(2)(a)(ib)', role: 'where', data: 'held',
          text: '(ib) Zone MU1 Mixed Use,', dataNote: 'Zone alone.', tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '72(2)(a)(ii)', role: 'where', data: 'held',
          text: '(ii) Zone B3 Commercial Core,', dataNote: 'Zone alone - one polygon left in the zoning layer.', tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '72(2)(a)(iii)', role: 'where', data: 'held',
          text: '(iii) Zone B4 Mixed Use,', dataNote: 'Zone alone - 25 polygons left in the zoning layer.', tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '72(2)(a)(iv)', role: 'where', data: 'held',
          text: '(iv) Zone B8 Metropolitan Centre,', dataNote: 'Zone alone - no B8 polygons remain in the zoning layer.', tables: ['epi.epi_land_zoning'],
          note: 'The B zones were translated to E and MU zones in April 2023. The clause keeps them for any plan that still uses them; in our layer only B3 and B4 survive, and only just.',
        },
        {
          clause: '72(2)(a)(v)', role: 'where', data: 'held',
          text: '(v) Zone SP5 Metropolitan Centre, or', dataNote: 'Zone alone.', tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '72(2)(a1)', role: 'where', data: 'held',
          text: '(a1) in a Transport Oriented Development Area under Chapter 5 in which development for the purposes of residential flat buildings is permissible, or',
          dataNote: 'The TOD area outline, then whether residential flat buildings are permissible there - under s 154 (relevant residential zones, E1, and B2 in Canterbury-Bankstown) or the LEP.',
          tables: ['lmr.sepp_tod_areas', 'epi.epi_land_zoning', 'nsw.lep_permissibility'],
        },
        {
          clause: '72(2)(a2)', role: 'where', data: 'held',
          text: '(a2) on which development for the purposes of multi dwelling housing, residential flat buildings or shop top housing is permissible under Chapter 6, or',
          dataNote: 'The LMR layer, which judges every lot against Chapter 6 type by type - the same evaluator /lmr uses for one lot.',
          tables: ['lmr.lot_lmr', '/api/lmr/types'],
          note: 'Permissible under Chapter 6, not in the LMR outline: a lot inside it that s 164 excludes (heritage, flood, bush fire, noise…) does not qualify through this limb. Lots our layer marks "undecided" stay undecided here.',
        },
        {
          clause: '72(2)(b)', role: 'where', data: 'gap',
          text: '(b) for which a site compatibility certificate has been issued under section 39, or',
          dataNote: 'Issued per site by the Planning Secretary, valid 5 years (s 39(9)). No register is published as data.',
        },
        {
          clause: '72(2)(c)', role: 'where', data: 'held',
          text: '(c) identified as "WestConnex Dive Site" on the State Significant Development Sites Map, within the meaning of State Environmental Planning Policy (Planning Systems) 2021, Chapter 2.',
          dataNote: 'One polygon, label "WestConnex Dive Site".',
          tables: ['epi.epi_state_significant_dev_sites'],
        },
      ],
    },
    {
      id: 'conditions',
      title: 'Section 72(3) and 73 — what the development must be',
      lead: 'Consent can only be granted if these hold. They are facts about the proposal, so a filter can '
        + 'only warn about them.',
      rows: [
        {
          clause: '72(3)(a)', role: 'condition', data: 'proposal',
          text: '(3) Development consent may be granted for development to which this Part applies if— (a) the development will result in at least 50 dwellings occupied, or intended to be occupied, by individuals under residential tenancy agreements, and',
          dataNote: 'The proposal\'s dwelling count. A lot\'s area and its FSR could screen for whether 50 dwellings is plausible; that would be our estimate, not the clause.',
        },
        {
          clause: '72(3)(b)', role: 'condition', data: 'proposal',
          text: '(b) all buildings containing the dwellings are located on the same lot of land.',
          dataNote: 'One lot. Amalgamated sites count once they are consolidated.',
        },
        {
          clause: '72(4)', role: 'condition', data: 'proposal',
          text: '(4) Part 7 does not apply to development permitted under this Part.',
          dataNote: 'Part 7 is the retention of existing affordable rental housing.',
        },
        {
          clause: '73(1)', role: 'condition', data: 'proposal',
          text: 'Development consent must not be granted … unless the consent authority is satisfied that, during the relevant period, the tenanted component of the building— (a) will not be subdivided into separate strata lots, and (b) will be owned and controlled by 1 person, and (c) will be operated by 1 managing agent, who provides on-site management.',
          dataNote: 'Single ownership, no strata, on-site management.',
        },
        {
          clause: '73(3)', role: 'condition', data: 'held',
          text: 'relevant period means— (a) for development on land in Zone E2 Commercial Centre, Zone B3 Commercial Core or Zone SP5 Metropolitan Centre—a period commencing on the day an occupation certificate is issued … and continuing in perpetuity, or (b) otherwise—a period of 15 years …',
          dataNote: 'The zone decides it: E2, B3 and SP5 are build-to-rent forever, everywhere else for 15 years.',
          tables: ['epi.epi_land_zoning'],
          note: 'Worth showing beside any result: in the commercial cores the building can never be sold off as strata.',
        },
      ],
    },
    {
      id: 'standards',
      title: 'Sections 74–78 — standards the consent authority applies',
      lead: 'What the development is then held to. Section 74 is non-discretionary: meet it and the council '
        + 'cannot ask for more.',
      rows: [
        {
          clause: '74(2)(a)', role: 'standard', data: 'held',
          text: 'the building height of all proposed buildings is not more than the maximum building height permitted under Chapter 5, Chapter 6 or another environmental planning instrument for a building on the land,',
          dataNote: 'No height bonus: the height the land already has.',
          tables: ['epi.epi_height_of_building'],
        },
        {
          clause: '74(2)(b)–(c)', role: 'standard', data: 'held',
          text: '(b) for development on land in a zone in which no residential accommodation is permitted under another environmental planning instrument—a floor space ratio that is not more than the maximum permissible floor space ratio for other development on the land …, (c) if paragraph (b) does not apply—a floor space ratio that is not more than the maximum permissible floor space ratio for residential accommodation on the land …',
          dataNote: 'No FSR bonus either - the land\'s own FSR. The affordable housing bonus is a separate provision (s 16) and can sit on top.',
          tables: ['epi.epi_floor_space_ratio'],
        },
        {
          clause: '74(2)(d)', role: 'standard', data: 'partial',
          text: '(d) for development carried out wholly or partly on land in the Eastern Harbour City, Central River City or Western Parkland City— (i) for land within an accessible area—at least 0.2 parking spaces for each dwelling, or (ii) otherwise—at least 0.5 parking spaces for each dwelling, …',
          dataNote: 'Needs the three cities (the Act, Schedule 9 lists their councils) and the accessible area - the same two things the affordable housing bonus needs. The region list is not held; the accessible area is, as notebook 24\'s walking isochrones in UrbanPortalDBP, without the bus frequency test.',
          note: 'This is where build-to-rent and the affordable housing bonus share their data.',
        },
        {
          clause: '74(2)(e)', role: 'standard', data: 'proposal',
          text: '(e) if paragraph (d) does not apply—at least the number of parking spaces required under the relevant development control plan or local environmental plan for a residential flat building.',
          dataNote: 'The DCP rate.',
        },
        {
          clause: '75', role: 'standard', data: 'proposal',
          text: 'Where Chapter 4 applies, the consent authority must be flexible in applying the Apartment Design Guide design criteria, in particular items 4E, 4G and 4K, and consider tenant amenity, dwelling mix and the ability to move within the building.',
          dataNote: 'Design assessment.',
        },
        {
          clause: '76', role: 'standard', data: 'held',
          text: 'Development consent must not be granted for development to which this section applies [land in a business zone] unless the consent authority is satisfied that a building resulting from the development will have an active street frontage.',
          dataNote: 'Business zone, which s 4(3) reads as including E1, E2, E3, MU1 and SP5. The zone answers whether it applies.',
          tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '77–78', role: 'standard', data: 'proposal',
          text: 'Nothing in this Part overrides a s 7.32 affordable housing contribution; a later strata subdivision of the building must consider the Apartment Design Guide.',
          dataNote: 'Not land tests.',
        },
      ],
    },
  ],

  ourRule: {
    name: '07B - Build to Rent',
    where: 'Notebooks repo · writes build_to_rent and build_to_rent_type on urbanportaldbp.up_property_comprehensive',
    lines: [
      {
        says: 'residential flat buildings in the property\'s permissible_uses',
        clause: '72(2)(a)(i)', verdict: 'matches',
        why: 'The same test, read from the uses 06 collected for the property.',
      },
      {
        says: 'tod_lay_class IS NOT NULL - any land in a TOD area',
        clause: '72(2)(a1)', verdict: 'wider',
        why: 'The clause needs residential flat buildings to be permissible in that part of the TOD area. '
          + 'A TOD lot in, say, a recreation zone passes our rule and fails the clause.',
      },
      {
        says: 'lmr_landuse IS NOT NULL AND (MDH or RFB or shop top) in permissible_uses',
        clause: '72(2)(a2)', verdict: 'different',
        why: 'lmr_landuse is the 05_lmr outline, which was station-only, so it misses most town-centre LMR land. '
          + 'And it asks the LEP, where the clause asks Chapter 6.',
      },
      {
        says: 'zone E2 / MU1 / B3 / B4 / B8 / SP5 AND (MDH or RFB or shop top) in permissible_uses',
        clause: '72(2)(a)(ia)–(v)', verdict: 'narrower',
        why: 'The zone is enough on its own. The extra permissibility condition drops any E2 or SP5 land '
          + 'whose LEP permits none of the three - which is exactly the land s 72 exists to open up.',
      },
      {
        says: '(nothing)',
        clause: '72(2)(b), (c)', verdict: 'missing',
        why: 'Site compatibility certificates (not mappable) and the WestConnex Dive Site (mappable, one polygon).',
      },
    ],
  },

  filter: [
    { step: 'Zone is E2, MU1, B3, B4, B8 or SP5', clause: '72(2)(a)(ia)–(v)', data: 'held' },
    { step: 'or: residential flat buildings permissible in the zone under any plan', clause: '72(2)(a)(i)', data: 'held' },
    { step: 'or: in a TOD area and residential flat buildings permissible there', clause: '72(2)(a1)', data: 'held' },
    { step: 'or: MDH, RFB or shop top housing permissible under Chapter 6 (the LMR layer, per type)', clause: '72(2)(a2)', data: 'held' },
    { step: 'or: the WestConnex Dive Site', clause: '72(2)(c)', data: 'held' },
    { step: 'or: a site compatibility certificate - cannot be mapped, flag only', clause: '72(2)(b)', data: 'gap' },
    { step: 'then flag: 50 dwellings on one lot; perpetual in E2 / B3 / SP5', clause: '72(3), 73(3)', data: 'proposal' },
  ],

  watch: [
    {
      lead: 'Build-to-rent cannot go in the land use dropdown as a use.',
      body: 'Every other entry there is one of the Standard Instrument\'s land use terms, read from a Land Use '
        + 'Table. Build-to-rent is in no table: it is s 72 permitting three of those uses on certain land. '
        + 'It can sit in the dropdown, but its answer has to come from the s 72 test above, not from '
        + 'lep_permissibility, and it should say so where it appears.',
    },
    {
      lead: 'The zone limbs ask nothing about permissibility.',
      body: 'This is the difference that moves the most land. In E2, MU1 and SP5 the SEPP permits build-to-rent '
        + 'whatever the LEP says; the request, and our 07B rule, both add "where MDH, RFB or shop top housing '
        + 'are allowed".',
    },
    {
      lead: 'Chapter 6 permissibility is per type and per lot.',
      body: 'The LMR layer already answers it - a lot in the outline but excluded by s 164 does not get '
        + 'build-to-rent through limb (a2). Its 25k "undecided" lots (no flood map held for 22 councils) '
        + 'carry over as undecided.',
    },
    {
      lead: 'Build-to-rent was ruled out in Central Sydney.',
      body: 'Reported as done through the Sydney LEP rather than this SEPP. If so it shows up in limb '
        + '(a)(i) as residential flat buildings no longer being permissible for build-to-rent there - not yet '
        + 'checked against the instrument.',
    },
    {
      lead: 'It feeds the affordable housing bonus.',
      body: 'Section 15C(1)(a) counts development permitted under Chapter 3, Part 4 - this Part - as one way '
        + 'to be "permitted with consent". So whatever this filter answers becomes an input to the other page.',
    },
  ],

  sources: [
    { label: 'Housing SEPP 2021 — s 72', url: 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714#sec.72', host: 'legislation.nsw.gov.au' },
    { label: 'Planning Systems SEPP 2021 — Chapter 2, SSD Sites Map', url: PS_SEPP, host: 'legislation.nsw.gov.au' },
    { label: 'Build-to-rent housing', url: 'https://www.planning.nsw.gov.au/policy-and-legislation/housing/housing-sepp/build-to-rent-housing', host: 'planning.nsw.gov.au' },
    { label: 'Build-to-rent housing scrapped in Central Sydney', url: 'https://www.lexology.com/library/detail.aspx?g=f06a60ba-6450-4a0b-be1b-e429d836f336', host: 'lexology.com' },
  ],

  related: [
    { to: '/affordable-housing', label: 'The affordable housing bonus, which counts build-to-rent as one way in' },
    { to: '/lmr', label: 'The LMR layer behind limb (a2)' },
    { to: '/permissibility', label: 'Land Use Tables, behind limb (a)(i)' },
  ],
}
