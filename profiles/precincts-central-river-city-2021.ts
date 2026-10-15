/**
 * Instrument profile — State Environmental Planning Policy (Precincts—Central River City) 2021 (epi-2021-0725).
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

const TITLE = 'State Environmental Planning Policy (Precincts—Central River City) 2021'
/** the instrument's short name, inside every unit term: a heading like "State significant precincts" repeats across the four */
const SHORT = 'Precincts—Central River City SEPP'
const UNIT = (local_id: string, heading: string): TermMapping => ({
  dimension: 'defined_area', term: `governed by ${heading} (${SHORT})`, source_kind: 'derived', source: 'derived.lot_instrument',
  test: 'attribute', column_tested: 'unit_local_id', filter: `document_title = '${TITLE.replace(/'/g, "''")}' AND unit_local_id = '${local_id}' AND governing`,
  kind: 'condition', note: `the lot's governing unit is ${local_id} (${heading}) - derived.lot_instrument, docs/precinct-sepp-pipeline.md §1`,
})

const profile: InstrumentProfile = {
  instrument: 'epi-2021-0725',
  slug: 'state-environmental-planning-policy-precincts-central-river-city-2021',
  label: 'sepp-precincts-central-river-city-2021',
  rank: 30,
  chapters: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'app.7', 'app.8', 'app.9', 'app.10', 'app.11', 'sch.12', 'app.13', 'app.14', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.5', 'sch.7', 'sch.8', 'sch.9', 'sch.10', 'sch.11', 'sch.13', 'sch.14', 'sch.15'],
  frames: [
    {
      id: 'instrument',
      title: 'State Environmental Planning Policy (Precincts—Central River City) 2021',
      parent: null,
      clause: '1.1',
      section: 'ch.1',
      governs: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'app.7', 'app.8', 'app.9', 'app.10', 'app.11', 'sch.12', 'app.13', 'app.14', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.5', 'sch.7', 'sch.8', 'sch.9', 'sch.10', 'sch.11', 'sch.13', 'sch.14', 'sch.15'],
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
        { dimension: 'defined_area', value: 'governed by State significant precincts (Precincts—Central River City SEPP)', polarity: 'applies', clause: '2.2',
          span: 'On the repeal of Part 3A of the Act, this Chapter is subject to Schedule 6A to the Act. Note. Schedule 6A of the Act sets out those projects which will continue as Part 3A projects (transitional Part 3A projects) and revokes the declaration of any other Part 3A project. The repeal of sections 6–6C a', term: 'governed by State significant precincts (Precincts—Central River City SEPP)' },
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
        { dimension: 'defined_area', value: 'governed by Sydney region growth centres (Precincts—Central River City SEPP)', polarity: 'applies', clause: '3.5',
          span: 'This Chapter applies to all land in a growth centre.', term: 'governed by Sydney region growth centres (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '3.6', span: 'Subject to section 74(1) of the Act, in the event of an inconsistency between this Chapter and another environmental planning instrument whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'ch.4',
      title: 'Homebush Bay area',
      parent: 'instrument',
      clause: '4.1',
      section: 'sec.4.1',
      governs: ['ch.4', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.7', 'sch.8'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Homebush Bay area (Precincts—Central River City SEPP)', polarity: 'applies', clause: '4.1',
          span: 'This Chapter applies to land identified as the “Homebush Bay Area” on the Homebush Bay Area Map.', term: 'governed by Homebush Bay area (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '4.3', span: 'This Chapter prevails to the extent of any inconsistency between this Chapter and any other environmental planning instrument which applies to land to which this Chapter applies, except the following— It does not matter whether the other instrument was made before, or is made on or after, the day on which this plan takes effect. State Environmental Planning Policy No 55—Remediation of Land This Ch' },
      note: '',
    },
    {
      id: 'ch.5',
      title: 'Kurnell Peninsula',
      parent: 'instrument',
      clause: '5.2',
      section: 'sec.5.2',
      governs: ['ch.5', 'sch.9', 'sch.10', 'sch.13', 'sch.14'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Kurnell Peninsula (Precincts—Central River City SEPP)', polarity: 'applies', clause: '5.2',
          span: 'This Chapter applies to the land within the Shire of Sutherland, known as Kurnell Peninsula, and adjacent waterways, as shown on the map, with boundaries as indicated on the map. Despite subsection (1), this Chapter does not apply to the following land— Land at Parraweena Road, Taren Point, adjoinin', term: 'governed by Kurnell Peninsula (Precincts—Central River City SEPP)' },
      ],
      note: 'relationship clause: This Chapter repeals the following environmental planning instruments— Sydney Regional Environmental Plan No 3—(Kurnell Peninsula), Sydney Regional Environmental Plan No 12—Dual Occupancy to the extent to which, immediately before the commencement of this Chapter, that plan applied to the land to wh',
    },
    {
      id: 'ch.6',
      title: 'Urban renewal precincts',
      parent: 'instrument',
      clause: '6.3',
      section: 'sec.6.3',
      governs: ['ch.6'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Urban renewal precincts (Precincts—Central River City SEPP)', polarity: 'applies', clause: '6.3',
          span: 'This Chapter applies to land within a potential precinct.', term: 'governed by Urban renewal precincts (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '6.5', span: 'If there is an inconsistency between this Chapter and any other environmental planning instrument, whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'app.1',
      title: 'State significant precinct—Channel 7 site',
      parent: 'ch.2',
      clause: '4',
      section: 'app.1-inc-pt.1-sec.4',
      governs: ['app.1'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Channel 7 site (Precincts—Central River City SEPP)', polarity: 'applies', clause: '4',
          span: 'Nothing in this Appendix applies to or with respect to development for the purposes of a public utility undertaking.', term: 'governed by State significant precinct—Channel 7 site (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '11', span: 'The only environmental planning instruments that apply, according to their terms, to or in respect of development within the Channel 7 site are as follows— in the case of development that is a transitional Part 3A project—Chapter 2 and all other State environmental planning policies except clause 4.6 of Parramatta Local Environmental Plan 2011, in the case of all other development—all environmenta' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.2',
      title: 'State significant precinct—Huntingwood West Precinct',
      parent: 'ch.2',
      clause: '1',
      section: 'app.2-inc-pt.1-sec.1',
      governs: ['app.2'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Huntingwood West Precinct (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the following map, referred to in this Schedule as the Huntingwood West Precinct—', term: 'governed by State significant precinct—Huntingwood West Precinct (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '14', span: 'Chapter 2 and all other State environmental planning policies apply, according to their terms, to land within the Huntingwood West Precinct. Blacktown Local Environmental Plan 1988 does not apply to land within the Huntingwood West Precinct.' },
      disapplies: [
        { instrument: 'Blacktown Local Environmental Plan 1988', part: null, clause: '14', span: 'Blacktown Local Environmental Plan 1988 does not apply to land within the Huntingwood West Precinct.' },
      ],
      note: 'the relationship clause disapplies the LEP (or every other instrument) on this land: written as prevailing over the LEP; any SEPP it also disapplies is an excludes edge (step 4) | disapplies 1 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'app.3',
      title: 'State significant precinct—Greystanes Southern Employment Lands site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.3-inc-pt.1-sec.1',
      governs: ['app.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Greystanes Southern Employment Lands site (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, being the Greystanes Southern Employment Lands site (referred to in this Schedule as the Greystanes SEL site).', term: 'governed by State significant precinct—Greystanes Southern Employment Lands site (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '3', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Greystanes SEL site are Chapter 2 and all other State environmental planning policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.4',
      title: 'State significant precinct—Sydney Olympic Park site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.4-inc-pt.1-sec.1',
      governs: ['app.4'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Sydney Olympic Park site (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Sydney Olympic Park site. Note. The Sydney Olympic Park site includes additional land to the land that is described as being within the Sydney Olympic Park for the purposes of the Sydney Oly', term: 'governed by State significant precinct—Sydney Olympic Park site (Precincts—Central River City SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '4', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Sydney Olympic Park site are Chapter 2 and all other State environmental planning policies. In the event of an inconsistency between this appendix and this policy, Chapter 4, this appendix prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'app.5',
      title: 'North Kellyville Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.5-inc-pt.1-sec.1.3',
      governs: ['app.5'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by North Kellyville Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the North Kellyville Precinct.', term: 'governed by North Kellyville Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.6',
      title: 'Riverstone West Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.6-inc-pt.1-sec.1.3',
      governs: ['app.6'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Riverstone West Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Riverstone West Precinct.', term: 'governed by Riverstone West Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.7',
      title: 'Alex Avenue and Riverstone Precinct Plan 2010',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.7-inc-pt.1-sec.1.3',
      governs: ['app.7'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Alex Avenue and Riverstone Precinct Plan 2010 (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Alex Avenue and Riverstone Precincts as shown on the Land Application Map. Note. The Land Application Map differs from the Precinct Boundary Map and, as such, this Precinct Plan does not apply to all the land within the Alex Avenue and Riverstone Precinc', term: 'governed by Alex Avenue and Riverstone Precinct Plan 2010 (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.8',
      title: 'Area 20 Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.8-inc-pt.1-sec.1.3',
      governs: ['app.8'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Area 20 Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Area 20 Precinct as shown on the Land Application Map. Note. The Land Application Map differs from the Precinct Boundary Map and, as such, this Precinct Plan does not apply to all the land within the Area 20 Precinct (as shown on the Precinct Boundary Ma', term: 'governed by Area 20 Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.9',
      title: 'Schofields Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.9-inc-pt.1-sec.1.3',
      governs: ['app.9'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Schofields Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Schofields Precinct as shown on the Land Application Map.', term: 'governed by Schofields Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.10',
      title: 'The Hills Growth Centre Precincts Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.10-inc-pt.1-sec.1.3',
      governs: ['app.10'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by The Hills Growth Centre Precincts Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Box Hill Precinct or Box Hill Industrial Precinct as shown on the Land Application Map.', term: 'governed by The Hills Growth Centre Precincts Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.11',
      title: 'Blacktown Growth Centres Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.11-inc-pt.1-sec.1.3',
      governs: ['app.11'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Blacktown Growth Centres Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Marsden Park Precinct, to land within the Riverstone East Stage 1 and 2 Precinct, and to land within the West Schofields (Townson Road) Precinct, as shown on the Land Application Map. Note. The Land Application Map differs from the Precinct Boundary Map ', term: 'governed by Blacktown Growth Centres Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'sch.12',
      title: 'Hawkesbury Growth Centres Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'sch.12-inc-pt.1-sec.1.3',
      governs: ['sch.12'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Hawkesbury Growth Centres Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Vineyard Precinct as shown on the Land Application Map. Note. The Land Application Map differs from the Vineyard Precinct Boundary Map and, as such, this Precinct Plan does not apply to all the land within the Vineyard Precinct (as shown on the Vineyard ', term: 'governed by Hawkesbury Growth Centres Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.13',
      title: 'Marsden Park Industrial Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.13-inc-pt.1-sec.1.3',
      governs: ['app.13'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Marsden Park Industrial Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Marsden Park Industrial Precinct as shown on the Land Application Map.', term: 'governed by Marsden Park Industrial Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
    {
      id: 'app.14',
      title: 'Riverstone East Stage 3 Precinct Plan',
      parent: 'ch.3',
      clause: '1.3',
      section: 'app.14-inc-pt.1-sec.1.3',
      governs: ['app.14'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Riverstone East Stage 3 Precinct Plan (Precincts—Central River City SEPP)', polarity: 'applies', clause: '1.3',
          span: 'This Precinct Plan applies to land within the Riverstone East Stage 3 Precinct as shown on the Land Application Map.', term: 'governed by Riverstone East Stage 3 Precinct Plan (Precincts—Central River City SEPP)' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Sydney region growth centres)',
    },
  ],
  terms: [
    UNIT('ch.2', 'State significant precincts'),
    UNIT('ch.3', 'Sydney region growth centres'),
    UNIT('ch.4', 'Homebush Bay area'),
    UNIT('ch.5', 'Kurnell Peninsula'),
    UNIT('ch.6', 'Urban renewal precincts'),
    UNIT('app.1', 'State significant precinct—Channel 7 site'),
    UNIT('app.2', 'State significant precinct—Huntingwood West Precinct'),
    UNIT('app.3', 'State significant precinct—Greystanes Southern Employment Lands site'),
    UNIT('app.4', 'State significant precinct—Sydney Olympic Park site'),
    UNIT('app.5', 'North Kellyville Precinct Plan'),
    UNIT('app.6', 'Riverstone West Precinct Plan'),
    UNIT('app.7', 'Alex Avenue and Riverstone Precinct Plan 2010'),
    UNIT('app.8', 'Area 20 Precinct Plan'),
    UNIT('app.9', 'Schofields Precinct Plan'),
    UNIT('app.10', 'The Hills Growth Centre Precincts Plan'),
    UNIT('app.11', 'Blacktown Growth Centres Precinct Plan'),
    UNIT('sch.12', 'Hawkesbury Growth Centres Precinct Plan'),
    UNIT('app.13', 'Marsden Park Industrial Precinct Plan'),
    UNIT('app.14', 'Riverstone East Stage 3 Precinct Plan'),
  ],
  signals: {
    permission: ['is permitted with development consent', 'may be carried out with development consent', 'may be carried out only with development consent'],
    prohibition: ['is prohibited', 'must not be granted', 'must not be carried out'],
    override: ['despite any other provision', 'despite the provisions of another environmental planning instrument'],
  },
  /** which map polygon key names which unit - the authority for nsw.instrument_unit_map once reviewed (scripts/pipeline/units.ts) */
  unitKeys: [
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Kurnell Peninsula) 1989 Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Central River City) 2021 Sydney Olympic Park Land Application Map', lay_class: 'Subject Land', label: 'Sydney Olympic Park', unit: 'app.4', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Channel 7 site Land Application Map', lay_class: 'Subject Land', label: 'Channel 7', unit: 'app.1', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Greystanes Southern Employment Lands site Land Application Map', lay_class: 'Subject Land', label: 'Greystanes Southern Employment Lands', unit: 'app.3', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Subject Land', label: 'Huntingwood West', unit: 'app.2', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 11, Clause 1.3', label: 'The Hills Growth Centre Precincts Plan', unit: 'app.10', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 12, Clause 1.3', label: 'Blacktown Growth Centres Precinct Plan', unit: 'app.11', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 12, Clause 1.3', label: 'Riverstone East Stage 1 and 2', unit: 'app.11', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 12, Clause 1.3', label: 'West Schofields Precinct', unit: 'app.11', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 13, Clause 1.3', label: 'Vineyard', unit: 'sch.12', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 14', label: 'Riverstone East Stage 3', unit: 'app.14', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 4, Clause 1.3', label: 'Alex Avenue and Riverstone Precinct Plan', unit: 'app.7', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 5, Clause 1.3', label: 'Marsden Park Industrial Precinct Plan', unit: 'app.13', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 6, Clause 1.3', label: 'Area 20 Precinct Plan', unit: 'app.8', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Application Map', lay_class: 'Appendix 7, Clause 1.3', label: 'Schofields Precinct Plan', unit: 'app.9', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Map', lay_class: 'Growth Centres', label: 'North West Growth Centre', unit: null, basis: 'hand', note: 'REVIEWED: the growth centre boundary, not a precinct plan - no unit' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Urban Renewal) 2010 Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.6', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SREP No 24—Homebush Bay Area—Map 1—Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Kurnell Peninsula) 1989 Land Zoning Map', lay_class: null, label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts-Central River City) 2021 North West Growth Centre Land Zoning Map', lay_class: null, label: null, unit: null, basis: 'hand', note: 'REVIEWED: as above' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts—Central River City) 2021 Sydney Olympic Park Land Zoning Map', lay_class: null, label: null, unit: 'app.4', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Channel 7 site Land Zoning Map', lay_class: null, label: null, unit: 'app.1', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Greystanes Southern Employment Lands site Land Zoning Map', lay_class: null, label: null, unit: 'app.3', basis: 'proposed', note: 'profile precincts-central-river-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Sydney Region Growth Centres) 2006 North West Growth Centre Land Zoning Map', lay_class: null, label: null, unit: null, basis: 'hand', note: 'REVIEWED: zoned by the growth centre map with no released precinct plan at the point - no unit (fail closed), not Chapter 3' },
  ],
}
export default profile
