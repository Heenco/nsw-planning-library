/**
 * Instrument profile — State Environmental Planning Policy (Precincts—Western Parkland City) 2021 (epi-2021-0728).
 *
 * The per-instrument input to the rule pipeline (docs/sepp-rule-pipeline.md §4) and to the governing-unit
 * table (docs/precinct-sepp-pipeline.md §3). This SEPP carries former instruments as CHAPTERS and growth
 * centre precinct plans and State significant sites as APPENDICES; each is a unit with its own reach, so
 * each is a frame here, and a lot is under exactly one of them (derived.lot_instrument, basis the land
 * application map, else the zoning map, through nsw.instrument_unit_map).
 *
 * GENERATED 2026-10-15 (scratchpad gen_profiles.py) from the graph - nsw.section: unit headings, each unit's
 * "land to which ... applies" clause and its relationship clause - and from the proposed nsw.instrument_unit_map
 * rows; the `basis: 'hand'` rows in `unitKeys` and every `note` are readings to review. Spans are quoted from the
 * XML as at 2026-10-15. Schedules named for a chapter ("Environmental heritage—Chapter 5") are governed by that
 * chapter's frame; list-only schedules with no chapter in their name sit under the instrument frame.
 * REVIEW STATUS: reviewed - Manni answered Q1 (a)-(f) in session on 2026-10-15 (docs/precinct-sepp-progress.md):
 * prevails over the LEP only; "the only instruments that apply" and a clause disapplying the LEP both read as
 * prevailing over the LEP; parents by kind, not by citation count; growth centre land with no released precinct
 * plan has no unit; the Opera House buffer is app.1 and the three EHC foreshore / port keys stay null.
 */
import type { InstrumentProfile, TermMapping } from './housing-sepp-2021'

const TITLE = 'State Environmental Planning Policy (Precincts—Western Parkland City) 2021'
const UNIT = (local_id: string, heading: string): TermMapping => ({
  dimension: 'defined_area', term: `unit:precincts-western-parkland-city-2021:${local_id}`, source_kind: 'derived', source: 'derived.lot_instrument',
  test: 'attribute', column_tested: 'unit_local_id', filter: `document_title = '${TITLE.replace(/'/g, "''")}' AND unit_local_id = '${local_id}' AND governing`,
  kind: 'condition', note: `the lot's governing unit is ${local_id} (${heading}) - derived.lot_instrument, docs/precinct-sepp-pipeline.md §1`,
})

const profile: InstrumentProfile = {
  instrument: 'epi-2021-0728',
  slug: 'state-environmental-planning-policy-precincts-western-parkland-city-2021',
  label: 'sepp-precincts-western-parkland-city-2021',
  rank: 30,
  chapters: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'ch.7', 'ch.8', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'app.7', 'app.8', 'app.9', 'app.10', 'sch.11', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9', 'sch.10', 'sch.11-oc.2', 'sch.12', 'sch.13'],
  frames: [
    {
      id: 'instrument',
      title: 'State Environmental Planning Policy (Precincts—Western Parkland City) 2021',
      parent: null,
      clause: '1.1',
      section: 'ch.1',
      governs: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'ch.7', 'ch.8', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'app.7', 'app.8', 'app.9', 'app.10', 'sch.11', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9', 'sch.10', 'sch.11-oc.2', 'sch.12', 'sch.13'],
      conditions: [],
      note: 'No instrument-wide prevails clause: each chapter and appendix states its own relationship to other instruments (its frame).',
    },
    {
      id: 'ch.2',
      title: 'State significant precincts',
      parent: 'instrument',
      clause: '2.2',
      section: 'sec.2.2',
      governs: ['ch.2'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precincts', polarity: 'applies', clause: '2.2',
          span: 'On the repeal of Part 3A of the Act, this Chapter is subject to Schedule 6A to the Act. Note. Schedule 6A of the Act sets out those projects which will continue as Part 3A projects (transitional Part 3A projects) and revokes the declaration of any other Part 3A project. The repeal of clauses 6–6C an', term: 'unit:precincts-western-parkland-city-2021:ch.2' },
      ],
      prevails: { over: ['lep'], clause: '2.6', span: 'Subject to section 74(1) of the Act, in the event of an inconsistency between this Chapter and another environmental planning instrument whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'ch.3',
      title: 'Sydney region growth centres',
      parent: 'instrument',
      clause: '3.5',
      section: 'sec.3.5',
      governs: ['ch.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Sydney region growth centres', polarity: 'applies', clause: '3.5',
          span: 'This Chapter applies to all land in a growth centre.', term: 'unit:precincts-western-parkland-city-2021:ch.3' },
      ],
      prevails: { over: ['lep'], clause: '3.6', span: 'Subject to section 74(1) of the Act, in the event of an inconsistency between this Chapter and another environmental planning instrument whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'ch.4',
      title: 'Western Sydney Aerotropolis',
      parent: 'instrument',
      clause: '4.3',
      section: 'sec.4.3',
      governs: ['ch.4', 'sch.1', 'sch.2', 'sch.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Western Sydney Aerotropolis', polarity: 'applies', clause: '4.3',
          span: 'Note 1. The Western Sydney Aerotropolis comprises 9 precincts—Aerotropolis Core, Northern Gateway, Wianamatta–South Creek, Badgerys Creek, Agribusiness, Dwyer Road, Kemps Creek, North Luddenham and Rossmore. On the commencement of this Chapter, the Land Application Map will include Aerotropolis Core', term: 'unit:precincts-western-parkland-city-2021:ch.4' },
      ],
      prevails: { over: ['lep'], clause: '4.4', span: 'In the event of an inconsistency between this Chapter and another environmental planning instrument, whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      disapplies: [
        { instrument: 'doc_type:lep', part: null, clause: '4.4', span: 'A local environmental plan does not apply to land shown on the Land Application Map.' },
      ],
      note: 'further wording of the relationship clause (exceptions, step 4): A local environmental plan does not apply to land shown on the Land Application Map. | disapplies 1 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.5',
      title: 'Penrith Lakes Scheme',
      parent: 'instrument',
      clause: '5.2',
      section: 'sec.5.2',
      governs: ['ch.5', 'sch.4'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Penrith Lakes Scheme', polarity: 'applies', clause: '5.2',
          span: 'This Chapter applies to the land shown edged heavy black on the structure plan.', term: 'unit:precincts-western-parkland-city-2021:ch.5' },
      ],
      prevails: { over: ['lep'], clause: '5.5', span: 'If there is an inconsistency between this Chapter and any other environmental planning instrument, whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      disapplies: [
        { instrument: 'State Environmental Planning Policy (Affordable Rental Housing) 2009', part: null, clause: '5.5', span: 'State Environmental Planning Policy (Affordable Rental Housing) 2009 does not apply to land zoned Employment, Residential or Tourism under this Chapter.' },
        { instrument: 'State Environmental Planning Policy (Exempt and Complying Development Codes) 2008', part: null, clause: '5.5', span: 'State Environmental Planning Policy (Exempt and Complying Development Codes) 2008 does not apply to unzoned land or land zoned Environment, Parkland or Waterway under this Chapter.' },
        { instrument: 'State Environmental Planning Policy No 1—Development Standards', part: null, clause: '5.5', span: 'State Environmental Planning Policy No 1—Development Standards does not apply to land to which this Chapter applies.' },
      ],
      note: 'further wording of the relationship clause (exceptions, step 4): State Environmental Planning Policy (Affordable Rental Housing) 2009 does not apply to land zoned Employment, Residential or Tourism under this Chapter. State Environmental Planning Policy (Exempt and Complying Development Codes) 2008 does not apply to unzoned land or land zoned Environment, Parkland or Waterway under this Chapter. State Environmen | disapplies 3 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.6',
      title: 'St Marys',
      parent: 'instrument',
      clause: '6.4',
      section: 'sec.6.4',
      governs: ['ch.6', 'sch.7'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by St Marys', polarity: 'applies', clause: '6.4',
          span: 'Words used in this Chapter that are defined in Schedule 7 have the meanings given to them in that Schedule. Notes in this Chapter and the list of contents of this Chapter are not part of this Chapter. Nothing in this Chapter prohibits, restricts, requires development consent for or allows a conditio', term: 'unit:precincts-western-parkland-city-2021:ch.6' },
      ],
      prevails: { over: ['lep'], clause: '6.3', span: 'In the event of an inconsistency between this Chapter and another environmental planning instrument (whether made before, on or after the date on which this Chapter takes effect), this Chapter prevails to the extent of the inconsistency, subject to section 36 of the Act. Penrith Local Environmental Plan No 201 (Rural Lands) and Blacktown Local Environmental Plan 1988 do not apply to the land to wh' },
      disapplies: [
        { instrument: 'Penrith Local Environmental Plan No 201 (Rural Lands)', part: null, clause: '6.3', span: 'Penrith Local Environmental Plan No 201 (Rural Lands) and Blacktown Local Environmental Plan 1988 do not apply to the land to which this Chapter applies.' },
        { instrument: 'Blacktown Local Environmental Plan 1988', part: null, clause: '6.3', span: 'Penrith Local Environmental Plan No 201 (Rural Lands) and Blacktown Local Environmental Plan 1988 do not apply to the land to which this Chapter applies.' },
        { instrument: 'Penrith Local Environmental Plan No 255—Exempt and Complying Development', part: null, clause: '6.3', span: 'Penrith Local Environmental Plan No 255—Exempt and Complying Development does not apply to the land to which this Chapter applies, except as provided by section 6.43 (Exempt and complying development) of this Chapter.' },
      ],
      note: 'disapplies 3 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.7',
      title: 'Western Sydney Parklands',
      parent: 'instrument',
      clause: '7.2',
      section: 'sec.7.2',
      governs: ['ch.7'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Western Sydney Parklands', polarity: 'applies', clause: '7.2',
          span: 'This Chapter applies to the Western Parklands.', term: 'unit:precincts-western-parkland-city-2021:ch.7' },
      ],
      prevails: { over: ['lep'], clause: '7.5', span: 'The following environmental planning instruments do not apply to the Western Parklands— State Environmental Planning Policy (Housing) 2021, Chapter 3, Parts 8 and 9 State Environmental Planning Policy (Exempt and Complying Development Codes) 2008, State Environmental Planning Policy (Industry and Employment) 2021, Chapter 3. If there is an inconsistency between this Chapter and any of the followin' },
      disapplies: [
        { instrument: 'State Environmental Planning Policy (Housing) 2021', part: 'Chapter 3, Parts 8 and 9', clause: '7.5', span: 'The following environmental planning instruments do not apply to the Western Parklands— State Environmental Planning Policy (Housing) 2021, Chapter 3, Parts 8 and 9 State Environmental Planning Policy (Exempt and Complying Development Codes) 2008, State Environmental Planning Policy (Industry and Em' },
        { instrument: 'State Environmental Planning Policy (Exempt and Complying Development Codes) 2008', part: null, clause: '7.5', span: 'The following environmental planning instruments do not apply to the Western Parklands— State Environmental Planning Policy (Housing) 2021, Chapter 3, Parts 8 and 9 State Environmental Planning Policy (Exempt and Complying Development Codes) 2008, State Environmental Planning Policy (Industry and Em' },
        { instrument: 'State Environmental Planning Policy (Industry and Employment) 2021', part: 'Chapter 3', clause: '7.5', span: 'The following environmental planning instruments do not apply to the Western Parklands— State Environmental Planning Policy (Housing) 2021, Chapter 3, Parts 8 and 9 State Environmental Planning Policy (Exempt and Complying Development Codes) 2008, State Environmental Planning Policy (Industry and Em' },
      ],
      note: 'disapplies 3 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.8',
      title: 'Greater Macarthur Growth Area',
      parent: 'instrument',
      clause: '8.1',
      section: 'sec.8.1',
      governs: ['ch.8'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Greater Macarthur Growth Area', polarity: 'applies', clause: '8.1',
          span: 'This chapter applies to the following land on the Land Application Map— land identified as “Appin (Part) Precinct”, land identified as “North Appin Precinct”.', term: 'unit:precincts-western-parkland-city-2021:ch.8' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency)',
    },
    {
      id: 'app.1',
      title: 'State significant precinct—Edmondson Park South site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.1-inc-pt.1-sec.1',
      governs: ['app.1'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Edmondson Park South site', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Edmondson Park South site.', term: 'unit:precincts-western-parkland-city-2021:app.1' },
      ],
      prevails: { over: ['lep'], clause: '5', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Edmondson Park South site are— Chapter 2, and all other State environmental planning policies. In the event of any inconsistency between this Appendix and State Environmental Planning Policy (Sydney Region Growth Centres) 2006, this Appendix prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'app.2',
      title: 'Oran Park and Turner Road Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.2-inc-pt.1-sec.1.3',
      governs: ['app.2'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Oran Park and Turner Road Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Oran Park and Turner Road Precincts.', term: 'unit:precincts-western-parkland-city-2021:app.2' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.3',
      title: 'Leppington Town Centre Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.3-inc-pt.1-sec.1.3',
      governs: ['app.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Leppington Town Centre Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This precinct plan applies to the Leppington Town Centre.', term: 'unit:precincts-western-parkland-city-2021:app.3' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.4',
      title: 'Liverpool Growth Centres Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.4-inc-pt.1-sec.1.3',
      governs: ['app.4'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Liverpool Growth Centres Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Austral Precinct, East Leppington Precinct and Leppington North Precinct as shown on the Land Application Map. Note. The Land Application Map differs from the Precinct Boundary Map and, as such, this Precinct Plan does not apply to all the land within th', term: 'unit:precincts-western-parkland-city-2021:app.4' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.5',
      title: 'Camden Growth Centres Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.5-inc-pt.1-sec.1.3',
      governs: ['app.5'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Camden Growth Centres Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Catherine Fields Precinct, East Leppington Precinct, Leppington North Precinct, Leppington Precinct, Pondicherry Precinct and Lowes Creek Maryland Precinct as shown on the Land Application Map. Note. The Land Application Map differs from the Precinct Bou', term: 'unit:precincts-western-parkland-city-2021:app.5' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.6',
      title: 'Campbelltown Growth Centres Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.6-inc-pt.1-sec.1.3',
      governs: ['app.6'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Campbelltown Growth Centres Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the East Leppington Precinct as shown on the Land Application Map. Note. The Land Application Map differs from the Precinct Boundary Map and, as such, this Precinct Plan does not apply to all the land within the East Leppington Precinct (as shown on the Prec', term: 'unit:precincts-western-parkland-city-2021:app.6' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.7',
      title: 'South East Wilton Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.7-inc-pt.1-sec.1.3',
      governs: ['app.7'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by South East Wilton Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the South East Wilton Precinct as shown on the Land Application Map.', term: 'unit:precincts-western-parkland-city-2021:app.7' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.8',
      title: 'North Wilton Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.8-inc-pt.1-sec.1.3',
      governs: ['app.8'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by North Wilton Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the North Wilton Precinct as shown on the Land Application Map.', term: 'unit:precincts-western-parkland-city-2021:app.8' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.9',
      title: 'Wilton Town Centre Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.9-inc-pt.1-sec.1.3',
      governs: ['app.9'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Wilton Town Centre Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land in the Wilton Town Centre Precinct as shown on the Land Application Map.', term: 'unit:precincts-western-parkland-city-2021:app.9' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.10',
      title: 'Appin (Part) Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.10-inc-pt.1-sec.1.3',
      governs: ['app.10'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Appin (Part) Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This precinct plan applies to land in the Appin (Part) Precinct.', term: 'unit:precincts-western-parkland-city-2021:app.10' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'sch.11',
      title: 'Gilead (Part) Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'sch.11-inc-pt.1-sec.1.3',
      governs: ['sch.11'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Gilead (Part) Precinct Plan', polarity: 'applies', clause: '1.3',
          span: 'This precinct plan applies to the Gilead (Part) Precinct.', term: 'unit:precincts-western-parkland-city-2021:sch.11' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres); the chapter citing it most is ch.7 (2 citations), a note only',
    },
  ],
  terms: [
    UNIT('ch.2', 'State significant precincts'),
    UNIT('ch.3', 'Sydney region growth centres'),
    UNIT('ch.4', 'Western Sydney Aerotropolis'),
    UNIT('ch.5', 'Penrith Lakes Scheme'),
    UNIT('ch.6', 'St Marys'),
    UNIT('ch.7', 'Western Sydney Parklands'),
    UNIT('ch.8', 'Greater Macarthur Growth Area'),
    UNIT('app.1', 'State significant precinct—Edmondson Park South site'),
    UNIT('app.2', 'Oran Park and Turner Road Precinct Plan'),
    UNIT('app.3', 'Leppington Town Centre Precinct Plan'),
    UNIT('app.4', 'Liverpool Growth Centres Precinct Plan'),
    UNIT('app.5', 'Camden Growth Centres Precinct Plan'),
    UNIT('app.6', 'Campbelltown Growth Centres Precinct Plan'),
    UNIT('app.7', 'South East Wilton Precinct Plan'),
    UNIT('app.8', 'North Wilton Precinct Plan'),
    UNIT('app.9', 'Wilton Town Centre Precinct Plan'),
    UNIT('app.10', 'Appin (Part) Precinct Plan'),
    UNIT('sch.11', 'Gilead (Part) Precinct Plan'),
  ],
  signals: {
    permission: ['is permitted with development consent', 'may be carried out with development consent', 'may be carried out only with development consent'],
    prohibition: ['is prohibited', 'must not be granted', 'must not be carried out'],
    override: ['despite any other provision', 'despite the provisions of another environmental planning instrument'],
  },
  /** which map polygon key names which unit - the authority for nsw.instrument_unit_map once reviewed (scripts/pipeline/units.ts) */
  unitKeys: [
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Penrith Lakes Scheme) 1989 Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts – WPC) 2021 GMAC Growth Area Appin (Part) Precinct Plan Land Application Map', lay_class: 'Land to which the Appin (Part) Precinct Plan applies', label: '<Null>', unit: 'app.10', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts – WPC) 2021 GMAC Growth Area Appin (Part) Precinct Plan Land Application Map', lay_class: 'Land to which the North Appin Precinct Plan applies', label: null, unit: 'app.10', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts – WPC) 2021 GMAC Growth Area Gilead (Part) Precinct Plan Land Application Map', lay_class: 'Land to which the Gilead (Part) Precinct Plan applies', label: null, unit: 'sch.11', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Edmondson Park South site Land Application Map', lay_class: 'Subject Land', label: 'Edmondson Park South', unit: 'app.1', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 Greater Macarthur Growth Area Map', lay_class: 'Growth Centres', label: 'Greater Macarthur Growth Area', unit: 'ch.8', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Land Application Map', lay_class: 'Camden Appendix 5, Clause 1.3', label: 'B', unit: 'app.5', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Land Application Map', lay_class: 'Campbelltown Appendix 6, Clause 1.3', label: 'C', unit: 'app.6', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Land Application Map', lay_class: 'Liverpool Appendix 4, Clause 1.3', label: 'A', unit: 'app.4', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre LAnd Application Map', lay_class: 'Leppington Appendix 3, Clause 1.3', label: 'D', unit: 'app.3', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Map', lay_class: 'Growth Centres', label: 'South West Growth Centre', unit: null, basis: 'hand', note: 'REVIEWED: the growth centre boundary - no unit' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Land Application Map', lay_class: 'Appendix 13, Clause 7', label: 'Wilton South East Precinct', unit: 'app.7', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Land Application Map', lay_class: 'Appendix 15, Clause 1.3', label: 'Wilton North', unit: 'app.8', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Land Application Map', lay_class: 'Appendix 16, Clause 1.3', label: 'Town centre', unit: 'app.9', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Map', lay_class: 'Growth Centres', label: 'Wilton Growth Area', unit: null, basis: 'hand', note: 'REVIEWED: the growth area boundary - no unit' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Western Sydney Aerotropolis) 2020 Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Western Sydney Parklands) 2009 Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.7', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'State Environmental Planning Policy (Precincts—Western Parkland City) 2021 Aerotropolis Boundary Map', lay_class: 'Aerotropolis Boundary', label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts–Western Parkland City) 2021 Penrith Lakes Scheme Land Zoning Map', lay_class: null, label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts – WPC) 2021 GMAC Appin (Part) Precinct Plan Land Zoning Map', lay_class: null, label: null, unit: 'app.10', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts – WPC) 2021 GMAC Growth Area Gilead (Part) Precinct Plan Land Zoning Map', lay_class: null, label: null, unit: 'sch.11', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Edmondson Park South site Land Zoning Map', lay_class: null, label: null, unit: 'app.1', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Sydney Region Growth Centres) 2006 South West Growth Centre Land Zoning Map', lay_class: null, label: null, unit: null, basis: 'hand', note: 'REVIEWED: zoned by the growth centre map with no released precinct plan at the point - no unit (fail closed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Sydney Region Growth Centres) 2006 Wilton Growth Area Land Zoning Map', lay_class: null, label: null, unit: null, basis: 'hand', note: 'REVIEWED: as above' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Western Sydney Aerotropolis) 2020 Land Zoning Map', lay_class: null, label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'Sydney Regional Environmental Plan No 30—St Marys—Zoning (Amendment No 3)', lay_class: null, label: null, unit: 'ch.6', basis: 'proposed', note: 'profile precincts-western-parkland-city-2021 (proposed)' },
  ],
}
export default profile
