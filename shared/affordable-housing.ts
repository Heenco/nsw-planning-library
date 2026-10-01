/**
 * /affordable-housing - the in-fill affordable housing bonus: Housing SEPP Chapter 2, Part 2,
 * Division 1 (ss 15A-21), clause by clause.
 *
 * The provision is three tests joined by AND - permitted, at least 10% affordable, and in the right
 * location - with the location test itself split by region: an accessible area inside the Six Cities,
 * 800 m walking of a centre zone outside them. The request it answers listed four ways in; two of
 * them are the "permitted" test and two are the two halves of the location test, so read as four ORs
 * they would let in land the clause does not.
 *
 * Text: public/EPI/SEPP/housing-sepp-2021.md, amendments to 2026 (33). The Sydney Olympic Park
 * exclusion is later than that copy and is marked unverified. Audited 2026-10-01.
 */
import type { RequirementPage } from './requirement-pages'

const PS_SEPP = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0724'
const CRC_SEPP = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0725'
const DICTIONARY = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714#sch.10'

export const AFFORDABLE_HOUSING: RequirementPage = {
  title: 'The affordable housing bonus — where in-fill affordable housing applies',
  sub: 'Chapter 2, Part 2, Division 1 of the Housing SEPP, clause by clause: up to 30% more floor space, '
    + 'and the same again in height for apartments, for development that keeps at least 10% of it '
    + 'affordable for 15 years - and only on the land section 15C reaches. Nothing here tests a lot yet.',
  provision: 'Housing SEPP 2021 · Chapter 2, Part 2, Division 1 · ss 15A–21',
  auditedOn: '2026-10-01',

  request: {
    heading: 'Sites where the Housing Bonus for affordable housing is allowed:',
    bullets: [
      'Where-ever Build-to-Rent Housing is permissible',
      'Sites where residential accommodation is permissible within the accessible areas overlay',
      'Sites where residential accommodation is permissible within 800 metres of the following zones: '
        + 'E1 Local Centre, E2 Commercial Centre, MU1 Mixed Use, B1 Neighbourhood Centre, B2 Local Centre '
        + 'and B4 Mixed Use',
      'Sites where residential accommodation is permissible in the TOD and LMR areas',
    ],
    after: {
      heading: 'The bonus does not apply to:',
      bullets: [
        'land identified as an "Accelerated TOD Precinct"',
        'land identified as the "Warrawong Site" on the State Significant Development Sites Map (Planning Systems SEPP, Chapter 2)',
        'land identified as the "Kanwal Site" on the State Significant Development Sites Map (Planning Systems SEPP, Chapter 2)',
        'land identified on the State Environmental Planning Policy (Precincts—Central River City) 2021 Sydney Olympic Park Land Application Map',
      ],
    },
  },

  requestLines: [
    {
      said: 'Where-ever Build-to-Rent Housing is permissible',
      clause: '15C(1)(a)', verdict: 'wider',
      why: 'Being permitted under Chapter 3, Part 4 (build-to-rent) is one way to meet paragraph (a). It '
        + 'is not a way in by itself: the land must still pass the location test in (c). A build-to-rent '
        + 'site in the Six Cities but outside an accessible area gets no bonus.',
    },
    {
      said: 'Residential accommodation permissible within the accessible areas',
      clause: '15C(1)(a) + (c)(i)', verdict: 'different',
      why: 'Two corrections. "Residential development" (s 15B) is nine named forms - not residential '
        + 'accommodation, which also covers boarding houses, co-living, group homes, hostels and the rest. '
        + 'And the accessible area is the location test only inside the Six Cities Region, other than '
        + 'Shoalhaven and Port Stephens. Outside it, an accessible area counts for nothing.',
    },
    {
      said: 'Residential accommodation permissible within 800 metres of E1, E2, MU1, B1, B2, B4',
      clause: '15C(1)(c)(ii), 15C(3)', verdict: 'different',
      why: 'The zone list matches s 15C(3) exactly. But this test applies only outside the Six Cities '
        + 'Region (and in Shoalhaven and Port Stephens), and the 800 m is walking distance - the Dictionary '
        + 'defines it as along a safe pedestrian route - not a straight-line buffer.',
    },
    {
      said: 'Residential accommodation permissible in the TOD and LMR areas',
      clause: '15C(1)(a)', verdict: 'wider',
      why: 'Chapter 5 (TOD) and Chapter 6 (LMR) are, like build-to-rent, ways to be "permitted with '
        + 'consent" under (a). They do not satisfy (c). Most TOD and LMR land is near a station and so '
        + 'will be in an accessible area anyway, but LMR land measured from a town centre need not be.',
    },
    {
      said: 'At least 10% affordable housing component',
      clause: '15C(1)(b)', verdict: 'missing',
      why: 'A fact about the proposal, not the land, so a filter cannot test it - but every result should '
        + 'carry it, because without it there is no bonus.',
    },
    {
      said: 'Accelerated TOD Precinct',
      clause: '15C(2A)(a)', verdict: 'matches',
      why: 'Word for word, and we hold the map.',
    },
    {
      said: 'Warrawong Site',
      clause: '15C(2A)(b)', verdict: 'matches',
      why: 'Word for word, and the polygon is in our copy of the SSD Sites Map.',
    },
    {
      said: 'Kanwal Site',
      clause: '15C(2A)(c)', verdict: 'matches',
      why: 'Word for word, and the polygon is in our copy of the SSD Sites Map.',
    },
    {
      said: 'Sydney Olympic Park Land Application Map',
      clause: '15C(2A)', verdict: 'unverified',
      why: 'Not in our copy, which runs to 2026 (33). It came with the Central River City SEPP amendment for '
        + 'the Sydney Olympic Park Master Plan 2050 (2026), which is reported to have amended s 15C(2A). '
        + 'legislation.nsw.gov.au refuses scripted reads, so the wording has not been read - including '
        + 'whether that amendment also changed paragraph (d).',
    },
    {
      said: 'Codes SEPP Parts 3B and 3BA',
      clause: '15C(2A)(d)', verdict: 'missing',
      why: 'In our copy: no bonus for development carried out as complying development under the Low Rise '
        + 'Housing Diversity Code or the Pattern Book code, unless it is by or for the Land and Housing '
        + 'Corporation. It excludes a pathway, not land, so it limits what a site can get rather than '
        + 'removing the site.',
    },
    {
      said: 'Land with no maximum FSR',
      clause: '16(4)', verdict: 'missing',
      why: 'The bonus is a percentage of the land\'s maximum FSR. Where the LEP sets none, s 16 does not '
        + 'apply. That is a land test, and we hold the FSR layer.',
    },
  ],

  sections: [
    {
      id: 'what',
      title: 'Sections 15A–15B — what the division is for and what it covers',
      lead: 'The bonus is for "residential development", which this division defines narrowly.',
      rows: [
        {
          clause: '15A', role: 'definition', data: 'proposal',
          text: 'The objective of this division is to facilitate the delivery of new in-fill affordable housing to meet the needs of very low, low and moderate income households.',
          dataNote: 'The objective. Income bands are in s 13.',
        },
        {
          clause: '15B(1)', role: 'definition', data: 'held',
          text: 'affordable housing component, of development, means the percentage of the gross floor area used for affordable housing. residential development means development for the following purposes— (a) attached dwellings, (b) dual occupancies, (c) dwelling houses, (d) manor houses, (e) multi dwelling housing, (f) multi dwelling housing (terraces), (g) residential flat buildings, (h) semi-detached dwellings, (i) shop top housing.',
          dataNote: 'Nine land use terms, each readable from the Land Use Table. "Manor houses" is not a Standard Instrument term - /cdc tests it through the forms the instruments reach it by.',
          tables: ['nsw.lep_permissibility'],
          note: 'Not "residential accommodation". Boarding houses, co-living housing, group homes, hostels, rural workers\' dwellings and seniors housing are residential accommodation and are not on this list.',
        },
        {
          clause: '15B(2)', role: 'definition', data: 'proposal',
          text: 'In this division, residential development carried out by or on behalf of the Aboriginal Housing Office or the Land and Housing Corporation is taken to be used for the purposes of affordable housing.',
          dataNote: 'Who the developer is.',
        },
      ],
    },
    {
      id: 'where',
      title: 'Section 15C(1) — where it applies: all three of (a), (b) and (c)',
      lead: 'These are joined by "and". Paragraph (a) is how the development is permitted; (c) is where it is. '
        + 'A site needs both, and (c) is a different test inside and outside the Six Cities Region.',
      rows: [
        {
          clause: '15C(1)(a)', role: 'where', data: 'held',
          text: 'This division applies to development that includes residential development if— (a) the development is permitted with consent under Chapter 3, Part 4, Chapter 5, Chapter 6 or another environmental planning instrument, and',
          dataNote: 'Any one of: build-to-rent (the /build-to-rent test), TOD (s 154 in the TOD area), LMR (the LMR layer, per type), or the LEP permitting one of the nine forms.',
          tables: ['/build-to-rent', 'lmr.sepp_tod_areas', 'lmr.lot_lmr', 'nsw.lep_permissibility'],
          note: 'Three of the request\'s four bullets are this paragraph - build-to-rent, TOD and LMR are ways to be permitted, not places that qualify.',
        },
        {
          clause: '15C(1)(b)', role: 'condition', data: 'proposal',
          text: '(b) the affordable housing component is at least 10%, and',
          dataNote: 'Of gross floor area. Affordable housing required by another chapter, plan or planning agreement does not count (s 15C(2)).',
        },
        {
          clause: '15C(1)(c)(i)', role: 'where', data: 'partial',
          text: '(c) all or part of the development is carried out— (i) for development on land in the Six Cities Region, other than in the City of Shoalhaven or Port Stephens local government area—in an accessible area, or',
          dataNote: 'Two things not built: the Six Cities Region (the Act, Schedule 9 lists its councils - we have every lot\'s council, not the list), and the accessible area (next row).',
          tables: ['derived.lot_lga'],
          note: '"All or part": a site that touches an accessible area qualifies whole.',
        },
        {
          clause: 'Dictionary — accessible area', role: 'definition', data: 'partial', href: DICTIONARY,
          text: 'accessible area means land within— (a) 800m walking distance of— (i) a public entrance to a railway, metro or light rail station, or (ii) for a light rail station with no entrance—a platform of the light rail station, or (iii) a public entrance to a wharf from which a Sydney Ferries ferry service operates, or … (c) 400m walking distance of a bus stop used by a regular bus service … that has at least 1 bus per hour servicing the bus stop between— (i) 6am and 9pm each day from Monday to Friday, both days inclusive, and (ii) 8am and 6pm on each Saturday and Sunday.',
          dataNote: 'Notebook 24 holds Mapbox walking isochrones in UrbanPortalDBP, one per stop: 800 m for 456 operational stations (64 of them light rail stops) and 400 m for 65,883 bus stops (103 fell back to a 400 m circle). Copied into planningai as access.iso_train and access.iso_bus. A lot inside either counts as in an accessible area. Sydney Ferries wharves are not in the stop set.',
          tables: ['access.iso_train', 'access.iso_bus', 'urbanportaldbp._iso_train', 'urbanportaldbp._iso_bus'],
          note: 'The bus test is a timetable test: at least one bus every hour across the whole span, weekdays and weekends. Our reading takes every bus stop isochrone as meeting it (decided 2026-10-01) rather than testing the GTFS timetable.',
        },
        {
          clause: '15C(1)(c)(ii)', role: 'where', data: 'gap',
          text: '(ii) for development on other land—within 800m walking distance of land in a relevant zone or an equivalent land use zone.',
          dataNote: 'The zones are held; 800 m walking catchments around them are not. /lmr\'s town centre catchments are drawn around the Town Centres Map, which is a different set of land.',
          tables: ['epi.epi_land_zoning'],
        },
        {
          clause: 'Dictionary — walking distance', role: 'definition', data: 'partial', href: DICTIONARY,
          text: 'walking distance means the shortest distance between 2 points measured along a route that may be safely walked by a pedestrian using, as far as reasonably practicable, public footpaths and pedestrian crossings.',
          dataNote: 'Both sets we hold are walking: the /lmr catchments and the notebook 24 accessible area are Mapbox walking isochrones. The centre-zone catchments for (c)(ii) would need building the same way.',
        },
        {
          clause: '15C(3)', role: 'definition', data: 'held',
          text: 'relevant zone means the following— (a) Zone E1 Local Centre, (a1) Zone E2 Commercial Centre, (b) Zone MU1 Mixed Use, (c) Zone B1 Neighbourhood Centre, (d) Zone B2 Local Centre, (e) Zone B4 Mixed Use.',
          dataNote: 'In the zoning layer: E1 2,580 polygons, MU1 839, E2 231, B4 25, B2 24, B1 18.',
          tables: ['epi.epi_land_zoning'],
        },
        {
          clause: '15C(2)', role: 'condition', data: 'proposal',
          text: 'Affordable housing provided as part of development because of a requirement under another chapter of this policy, another environmental planning instrument or a planning agreement is not counted towards the affordable housing component under this division.',
          dataNote: 'No double counting.',
        },
      ],
    },
    {
      id: 'excluded',
      title: 'Section 15C(2A) — where it does not apply',
      lead: 'Land and pathways taken back out, whatever (1) says.',
      rows: [
        {
          clause: '15C(2A)(a)', role: 'exclusion', data: 'held',
          text: 'This division does not apply to development— (a) on land identified as an "Accelerated TOD Precinct" on the Accelerated Transport Oriented Development Precincts Rezoning Areas Map, or',
          dataNote: '8 precincts.', tables: ['lmr.sepp_tod_accelerated_precincts'],
          note: 'Schedule 7A, s 10(3): the 2024 Exemptions amendment to s 15C does not apply to a DA lodged before it and not yet determined.',
        },
        {
          clause: '15C(2A)(b)', role: 'exclusion', data: 'held',
          text: '(b) on land identified as the "Warrawong Site" on the State Significant Development Sites Map, within the meaning of State Environmental Planning Policy (Planning Systems) 2021, Chapter 2, or',
          dataNote: 'One polygon, label "Warrawong Site".', tables: ['epi.epi_state_significant_dev_sites'],
        },
        {
          clause: '15C(2A)(c)', role: 'exclusion', data: 'held',
          text: '(c) on land identified as the "Kanwal Site" on the State Significant Development Sites Map, within the meaning of State Environmental Planning Policy (Planning Systems) 2021, Chapter 2, or',
          dataNote: 'One polygon, label "Kanwal Site".', tables: ['epi.epi_state_significant_dev_sites'],
        },
        {
          clause: '15C(2A)(d)', role: 'exclusion', data: 'proposal',
          text: '(d) carried out under the Codes SEPP, Parts 3B and 3BA, unless it is being carried out by or on behalf of the New South Wales Land and Housing Corporation constituted by the Housing Act 2001.',
          dataNote: 'A pathway, not land: complying development under the Low Rise Housing Diversity Code or the Pattern Book gets no bonus. A DA on the same lot can.',
          note: 'As in our copy. The 2026 Sydney Olympic Park amendment is reported to have changed this paragraph; until it is read, treat this wording as possibly superseded.',
        },
        {
          clause: '15C(2A) — Sydney Olympic Park', role: 'exclusion', data: 'held', unverified: true, href: CRC_SEPP,
          text: 'on land identified on the State Environmental Planning Policy (Precincts—Central River City) 2021 Sydney Olympic Park Land Application Map. [wording as given in the request - not in the library\'s copy]',
          dataNote: 'The land application area is held: two polygons labelled "Sydney Olympic Park" under the Central River City SEPP.',
          tables: ['epi.epi_land_application'],
          note: 'Made by SEPP (Precincts—Central River City) Amendment (Sydney Olympic Park Master Plan 2050) 2026 (epi-2026-133), after our copy. Save the in-force s 15C from a browser and this row can be checked.',
        },
      ],
    },
    {
      id: 'bonus',
      title: 'Sections 16–18 and 12A — what the bonus is',
      lead: 'The reward, and the land facts it depends on.',
      rows: [
        {
          clause: '16(1)', role: 'outcome', data: 'held',
          text: 'The maximum floor space ratio for development that includes residential development to which this division applies is the maximum permissible floor space ratio for the development on the land plus an additional floor space ratio of up to 30%, based on the minimum affordable housing component calculated in accordance with subsection (2).',
          dataNote: 'The land\'s FSR, plus up to 30%.', tables: ['epi.epi_floor_space_ratio'],
        },
        {
          clause: '16(2)', role: 'outcome', data: 'proposal',
          text: 'The minimum affordable housing component, which must be at least 10%, is calculated as follows— [formula, not in the library\'s text copy]',
          dataNote: 'The formula ties the bonus to the share kept affordable. Section 16(3)\'s own note: a 10% affordable component earns 20% more FSR.',
          note: 'The formula is an image in the instrument and did not survive into our markdown copy.',
        },
        {
          clause: '16(3)', role: 'outcome', data: 'held',
          text: 'If the development includes residential flat buildings or shop top housing, the maximum building height for a building used for residential flat buildings or shop top housing is the maximum permissible building height for the development on the land plus an additional building height that is the same percentage as the additional floor space ratio permitted under subsection (1).',
          dataNote: 'The land\'s height, plus the same percentage - apartments and shop top only.', tables: ['epi.epi_height_of_building'],
        },
        {
          clause: '16(4)', role: 'exclusion', data: 'held',
          text: 'This section does not apply to development on land for which there is no maximum permissible floor space ratio.',
          dataNote: 'Land with no FSR polygon gets no FSR bonus. Section 18\'s height-only bonus can still apply to apartments.',
          tables: ['epi.epi_floor_space_ratio'],
        },
        {
          clause: '17', role: 'outcome', data: 'proposal',
          text: 'For a relevant authority or registered community housing provider on land with a maximum FSR of 2:1 or less, an alternative bonus of up to 0.5:1, scaled by the affordable housing component between 20% and 50%.',
          dataNote: 'Who the developer is, and the land\'s FSR.',
        },
        {
          clause: '18', role: 'outcome', data: 'held',
          text: 'Where residential flat buildings or shop top housing do not use the s 16 FSR bonus, the maximum building height is the maximum permissible building height plus up to 30%, based on a minimum affordable housing component of at least 10%.',
          dataNote: 'A height-only alternative.', tables: ['epi.epi_height_of_building'],
        },
        {
          clause: '12A', role: 'outcome', data: 'proposal',
          text: 'If the development proposes to use the additional floor space ratio permitted under more than one relevant provision, the maximum floor space ratio must not exceed 130% of the maximum permissible floor space ratio for the development on the land.',
          dataNote: 'Stacking cap: in-fill, boarding houses, co-living and seniors housing bonuses together top out at 130%.',
        },
      ],
    },
    {
      id: 'standards',
      title: 'Sections 19–21 — standards and the 15 years',
      lead: 'Non-discretionary standards: meet them and the council cannot ask for more; miss them and consent is still possible.',
      rows: [
        {
          clause: '19(2)(a)', role: 'standard', data: 'held',
          text: 'a minimum site area of 450m2,',
          dataNote: 'Lot area is held. Not a hard minimum - a smaller site can still get consent - so a filter should flag it, not drop the site.',
          tables: ['cadastre.lot'],
        },
        {
          clause: '19(2)(b)–(i)', role: 'standard', data: 'proposal',
          text: 'Landscaped area (lesser of 35m2 per dwelling or 30% of site), deep soil on 15% of the site, 3 hours of mid-winter sun to 70% of dwellings, parking (0.4 / 0.5 / 1 space for affordable dwellings by bedrooms; 0.5 / 1 / 1.5 otherwise), and minimum internal areas.',
          dataNote: 'Design standards.',
        },
        {
          clause: '20', role: 'standard', data: 'proposal',
          text: 'The consent authority must consider the Low Rise Housing Diversity Design Guide for dual occupancies, manor houses and terraces, and whether the design is compatible with the desirable elements of the local character or the desired future character of a precinct in transition.',
          dataNote: 'Design assessment.',
        },
        {
          clause: '21(1)', role: 'condition', data: 'proposal',
          text: 'Development consent must not be granted … unless the consent authority is satisfied that for a period of at least 15 years commencing on the day an occupation certificate is issued for the development— (a) the development will include the affordable housing component required … under section 16, 17 or 18, and (b) the affordable housing component will be managed by a registered community housing provider.',
          dataNote: 'The 15 years, and a community housing provider to manage it. Not for the Aboriginal Housing Office or LAHC (s 21(2)).',
        },
      ],
    },
  ],

  filter: [
    { step: 'Permitted: one of the nine forms under the LEP, or build-to-rent, or TOD (s 154), or LMR (Chapter 6)', clause: '15C(1)(a)', data: 'held' },
    { step: 'and, in the Six Cities (not Shoalhaven or Port Stephens): touches an accessible area', clause: '15C(1)(c)(i)', data: 'partial' },
    { step: 'or, elsewhere: within 800 m walking of E1, E2, MU1, B1, B2 or B4', clause: '15C(1)(c)(ii)', data: 'gap' },
    { step: 'not: Accelerated TOD Precinct, Warrawong Site, Kanwal Site', clause: '15C(2A)(a)–(c)', data: 'held' },
    { step: 'not: Sydney Olympic Park land application area (wording to confirm)', clause: '15C(2A)', data: 'held' },
    { step: 'FSR bonus only where the land has a maximum FSR', clause: '16(4)', data: 'held' },
    { step: 'then flag: 10% affordable for 15 years; not via Codes SEPP 3B / 3BA; 450 m² site', clause: '15C(1)(b), 21, 15C(2A)(d), 19', data: 'proposal' },
  ],

  watch: [
    {
      lead: 'It is AND, not OR.',
      body: 'The request lists four routes in. In the clause, build-to-rent, TOD and LMR are only paragraph (a) - '
        + 'how the development is permitted - and every site must also pass the location test in (c). '
        + 'Built as four ORs, the filter would show the bonus on Six Cities land nowhere near transport.',
    },
    {
      lead: 'The location test changes at the Six Cities boundary.',
      body: 'Inside the Six Cities Region (bar Shoalhaven and Port Stephens) it is the accessible area and only '
        + 'the accessible area - being next to an E1 zone does not count. Outside it, it is 800 m walking of '
        + 'a centre zone and only that. The region is a list of councils in the Act\'s Schedule 9, which '
        + 'we do not yet hold as data.',
    },
    {
      lead: 'The bus stops are taken as meeting the hourly test.',
      body: 'A bus stop only counts if at least one bus an hour serves it across 6am-9pm on weekdays and '
        + '8am-6pm on weekends. Every bus stop isochrone from notebook 24 is counted as meeting that - a '
        + 'decision rather than a timetable test, and the one place the map reads wider than the clause. Sydney Ferries wharves are in '
        + 'the definition and not in the stop set.',
    },
    {
      lead: 'Walking distance is defined.',
      body: 'Along a route a pedestrian can safely walk, using footpaths and crossings. A straight-line 800 m '
        + 'buffer overstates it, sometimes badly across rail lines and rivers. The station and bus stop '
        + 'catchments are already walking isochrones; the centre-zone ones for (c)(ii) are not built.',
    },
    {
      lead: '"Residential development" is nine forms.',
      body: 'Boarding houses, co-living and seniors housing have bonuses of their own elsewhere in the SEPP '
        + '(and s 12A caps the total at 130%), but not this one.',
    },
    {
      lead: 'The Sydney Olympic Park exclusion is later than our copy.',
      body: 'Our Housing SEPP runs to 2026 (33); the exclusion came with the 2026 Central River City amendment. '
        + 'The land is held. The wording - and whether paragraph (d) changed with it - needs reading from the '
        + 'in-force SEPP in a browser.',
    },
  ],

  sources: [
    { label: 'Housing SEPP 2021 — ss 15A–21', url: 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714#sec.15C', host: 'legislation.nsw.gov.au' },
    { label: 'Housing SEPP 2021 — Dictionary (Schedule 10)', url: DICTIONARY, host: 'legislation.nsw.gov.au' },
    { label: 'Planning Systems SEPP 2021 — Chapter 2, SSD Sites Map', url: PS_SEPP, host: 'legislation.nsw.gov.au' },
    { label: 'Precincts—Central River City SEPP 2021', url: CRC_SEPP, host: 'legislation.nsw.gov.au' },
    { label: 'In-fill affordable housing', url: 'https://www.planning.nsw.gov.au/policy-and-legislation/housing/housing-sepp/in-fill-affordable-housing', host: 'planning.nsw.gov.au' },
    { label: 'In-fill affordable housing practice note (Dec 2023)', url: 'https://www.planning.nsw.gov.au/sites/default/files/2023-12/in-fill-affordable-housing-practice-note.pdf', host: 'planning.nsw.gov.au' },
    { label: 'Sydney Olympic Park Master Plan 2050 (made)', url: 'https://www.planningportal.nsw.gov.au/draftplans/made-and-finalised/sydney-olympic-park-master-plan-2050', host: 'planningportal.nsw.gov.au' },
  ],

  related: [
    { to: '/build-to-rent', label: 'Build-to-rent, one of the ways to meet 15C(1)(a)' },
    { to: '/lmr', label: 'The LMR layer and its walking catchments' },
    { to: '/sepp-map', label: 'The Sydney Olympic Park land application layer' },
  ],
}
