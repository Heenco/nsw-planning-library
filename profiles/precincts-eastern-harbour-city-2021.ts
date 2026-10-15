/**
 * Instrument profile — State Environmental Planning Policy (Precincts—Eastern Harbour City) 2021 (epi-2021-0726).
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

const TITLE = 'State Environmental Planning Policy (Precincts—Eastern Harbour City) 2021'
const UNIT = (local_id: string, heading: string): TermMapping => ({
  dimension: 'defined_area', term: `unit:precincts-eastern-harbour-city-2021:${local_id}`, source_kind: 'derived', source: 'derived.lot_instrument',
  test: 'attribute', column_tested: 'unit_local_id', filter: `document_title = '${TITLE.replace(/'/g, "''")}' AND unit_local_id = '${local_id}' AND governing`,
  kind: 'condition', note: `the lot's governing unit is ${local_id} (${heading}) - derived.lot_instrument, docs/precinct-sepp-pipeline.md §1`,
})

const profile: InstrumentProfile = {
  instrument: 'epi-2021-0726',
  slug: 'state-environmental-planning-policy-precincts-eastern-harbour-city-2021',
  label: 'sepp-precincts-eastern-harbour-city-2021',
  rank: 30,
  chapters: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'ch.7', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'app.7', 'app.8', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9'],
  frames: [
    {
      id: 'instrument',
      title: 'State Environmental Planning Policy (Precincts—Eastern Harbour City) 2021',
      parent: null,
      clause: '1.1',
      section: 'ch.1',
      governs: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'ch.7', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'app.7', 'app.8', 'sch.1', 'sch.2', 'sch.3', 'sch.4', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9'],
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
          span: 'On the repeal of Part 3A of the Act, this Chapter is subject to Schedule 6A to the Act. Note. Schedule 6A of the Act sets out those projects which will continue as Part 3A projects (transitional Part 3A projects) and revokes the declaration of any other Part 3A project. The repeal of clauses 6–6C an', term: 'unit:precincts-eastern-harbour-city-2021:ch.2' },
      ],
      prevails: { over: ['lep'], clause: '2.6', span: 'Subject to section 74(1) of the Act, in the event of an inconsistency between this Chapter and another environmental planning instrument whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'ch.3',
      title: 'Darling Harbour',
      parent: 'instrument',
      clause: '3.1',
      section: 'sec.3.1',
      governs: ['ch.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Darling Harbour', polarity: 'applies', clause: '3.1',
          span: 'Except as provided by subsection (2), this Chapter applies to the whole of the land within the Development Area, as varied from time to time. This Chapter does not apply to land in respect of which an order is in force under clause 3B of the Darling Harbour Authority Regulation 1984.', term: 'unit:precincts-eastern-harbour-city-2021:ch.3' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency)',
    },
    {
      id: 'ch.4',
      title: 'City West',
      parent: 'instrument',
      clause: 'ch.4',
      section: 'ch.4',
      governs: ['ch.4'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by City West', polarity: 'applies', clause: 'ch.4',
          span: 'the unit City West', term: 'unit:precincts-eastern-harbour-city-2021:ch.4' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency)',
    },
    {
      id: 'ch.5',
      title: 'Walsh Bay',
      parent: 'instrument',
      clause: '5.2',
      section: 'sec.5.2',
      governs: ['ch.5'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Walsh Bay', polarity: 'applies', clause: '5.2',
          span: 'This land applies to land within the City of Sydney and land within Sydney Harbour as shown edged heavy black on the map.', term: 'unit:precincts-eastern-harbour-city-2021:ch.5' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency)',
    },
    {
      id: 'ch.6',
      title: 'Cooks Cove',
      parent: 'instrument',
      clause: '6.2',
      section: 'sec.6.2',
      governs: ['ch.6', 'sch.8'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Cooks Cove', polarity: 'applies', clause: '6.2',
          span: 'This Chapter applies to land at Cooks Cove within the suburb of Arncliffe shown edged heavy black on the Zoning Map, which is referred to in this Chapter as the Cooks Cove site.', term: 'unit:precincts-eastern-harbour-city-2021:ch.6' },
      ],
      prevails: { over: ['lep'], clause: '6.3', span: 'In the event of an inconsistency between this Chapter and another environmental planning instrument, whether made before, on or after the date on which this Chapter was made, this Chapter prevails to the extent of the inconsistency, subject to section 36 (4) of the Act. To remove any doubt, this Chapter does not affect the application of State Environmental Planning Policy No 55—Remediation of Lan' },
      note: '',
    },
    {
      id: 'ch.7',
      title: 'Moore Park Showground',
      parent: 'instrument',
      clause: '7.1',
      section: 'sec.7.1',
      governs: ['ch.7'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Moore Park Showground', polarity: 'applies', clause: '7.1',
          span: 'This Chapter applies to the land shown edged heavy black on the map marked “Moore Park Showground Amendment No 1” deposited in the head office of the Department of Urban Affairs and Planning.', term: 'unit:precincts-eastern-harbour-city-2021:ch.7' },
      ],
      prevails: { over: ['lep'], clause: '7.3', span: 'On the commencement of this Chapter, the provisions of any local environmental plan or deemed environmental planning instrument that, immediately before that commencement, applied to the whole or any part of the land to which this Chapter applies cease to apply to that land. In the event of an inconsistency between this Chapter and another environmental planning instrument, whether made before or ' },
      disapplies: [
        { instrument: 'doc_type:lep', part: null, clause: '7.3', span: 'On the commencement of this Chapter, the provisions of any local environmental plan or deemed environmental planning instrument that, immediately before that commencement, applied to the whole or any part of the land to which this Chapter applies cease to apply to that land.' },
      ],
      note: 'disapplies 1 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'app.1',
      title: 'State significant precinct—Sydney Opera House',
      parent: 'ch.2',
      clause: '1A',
      section: 'app.1-inc-pt.2-sec.1A',
      governs: ['app.1'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Sydney Opera House', polarity: 'applies', clause: '1A',
          span: 'This Part applies to land within the Sydney Opera House Site as referred to in State Environmental Planning Policy (Planning Systems) 2021, Schedule 2, section 1.', term: 'unit:precincts-eastern-harbour-city-2021:app.1' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.2, the chapter of its kind (State significant precincts)',
    },
    {
      id: 'app.2',
      title: 'State significant precinct—Luna Park site',
      parent: 'ch.2',
      clause: '1B',
      section: 'app.2-inc-pt.2-sec.1B',
      governs: ['app.2'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Luna Park site', polarity: 'applies', clause: '1B',
          span: 'This Part applies to the cliff top sites.', term: 'unit:precincts-eastern-harbour-city-2021:app.2' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.2, the chapter of its kind (State significant precincts)',
    },
    {
      id: 'app.3',
      title: 'State significant precinct—Redfern–Waterloo Authority sites',
      parent: 'ch.2',
      clause: '1',
      section: 'app.3-inc-pt.1-sec.1',
      governs: ['app.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Redfern–Waterloo Authority sites', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the area shown edged heavy black on the Land Application Map referred to in this Schedule as the Redfern–Waterloo Authority Sites.', term: 'unit:precincts-eastern-harbour-city-2021:app.3' },
      ],
      prevails: { over: ['lep'], clause: '3', span: 'All other environmental planning instruments do not apply to the Redfern–Waterloo Authority Sites, except for other State environmental planning policies.' },
      note: 'the relationship clause disapplies the LEP (or every other instrument) on this land: written as prevailing over the LEP; any SEPP it also disapplies is an excludes edge (step 4)',
    },
    {
      id: 'app.4',
      title: 'State significant precinct—North Head Federal Police Training site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.4-inc-pt.1-sec.1',
      governs: ['app.4'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—North Head Federal Police Training site', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified as the North Head Federal Police Training site on the following map—', term: 'unit:precincts-eastern-harbour-city-2021:app.4' },
      ],
      note: 'relationship clause: Except as provided by Chapter 2, all other environmental planning instruments apply, according to their terms, to the North Head Federal Police Training site. Part 3 applies to the North Head Federal Police Training site despite any provision of Manly Local Environmental Plan 1988 or any other local',
    },
    {
      id: 'app.5',
      title: 'State significant precinct—Barangaroo site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.5-inc-pt.1-sec.1',
      governs: ['app.5'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Barangaroo site', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Schedule as the Barangaroo site.', term: 'unit:precincts-eastern-harbour-city-2021:app.5' },
      ],
      prevails: { over: ['lep'], clause: '3', span: 'The only environmental planning instruments that apply, according to their terms, to or in respect of development on land within the Barangaroo site are Chapter 2 and all other State environmental planning policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.6',
      title: 'State significant precinct—Wahroonga Estate site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.6-inc-pt.1-sec.1',
      governs: ['app.6'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Wahroonga Estate site', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Wahroonga Estate site.', term: 'unit:precincts-eastern-harbour-city-2021:app.6' },
      ],
      prevails: { over: ['lep'], clause: '5', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Wahroonga Estate site are— Chapter 2, and all other State environmental planning policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.7',
      title: 'State significant precinct—Sirius site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.7-inc-pt.1-sec.1',
      governs: ['app.7'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Sirius site', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Sirius site.', term: 'unit:precincts-eastern-harbour-city-2021:app.7' },
      ],
      note: 'no relationship clause found under this unit: EP&A Act s 3.28 default (a SEPP prevails over an LEP to the extent of inconsistency) | no relationship clause of its own: inherits the frame of ch.2, the chapter of its kind (State significant precincts)',
    },
    {
      id: 'app.8',
      title: 'Stage 1 Bays West Precinct',
      parent: 'ch.2',
      clause: '1',
      section: 'app.8-pt.1-sec.1',
      governs: ['app.8'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Stage 1 Bays West Precinct', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Stage 1 Bays West Precinct.', term: 'unit:precincts-eastern-harbour-city-2021:app.8' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.2, the chapter that cites it most (1 citations); no chapter of its kind',
    },
  ],
  terms: [
    UNIT('ch.2', 'State significant precincts'),
    UNIT('ch.3', 'Darling Harbour'),
    UNIT('ch.4', 'City West'),
    UNIT('ch.5', 'Walsh Bay'),
    UNIT('ch.6', 'Cooks Cove'),
    UNIT('ch.7', 'Moore Park Showground'),
    UNIT('app.1', 'State significant precinct—Sydney Opera House'),
    UNIT('app.2', 'State significant precinct—Luna Park site'),
    UNIT('app.3', 'State significant precinct—Redfern–Waterloo Authority sites'),
    UNIT('app.4', 'State significant precinct—North Head Federal Police Training site'),
    UNIT('app.5', 'State significant precinct—Barangaroo site'),
    UNIT('app.6', 'State significant precinct—Wahroonga Estate site'),
    UNIT('app.7', 'State significant precinct—Sirius site'),
    UNIT('app.8', 'Stage 1 Bays West Precinct'),
  ],
  signals: {
    permission: ['is permitted with development consent', 'may be carried out with development consent', 'may be carried out only with development consent'],
    prohibition: ['is prohibited', 'must not be granted', 'must not be carried out'],
    override: ['despite any other provision', 'despite the provisions of another environmental planning instrument'],
  },
  /** which map polygon key names which unit - the authority for nsw.instrument_unit_map once reviewed (scripts/pipeline/units.ts) */
  unitKeys: [
    { layer: 'epi.epi_land_application', map_name: 'SEPP No 47—Moore Park Showground Land Application Map', lay_class: 'Area A', label: null, unit: 'ch.7', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP No 47—Moore Park Showground Land Application Map', lay_class: 'Area B', label: null, unit: 'ch.7', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP No 47—Moore Park Showground Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.7', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Bays West Stage 1 Precinct Land Application Map', lay_class: 'Subject Land', label: 'Site A', unit: 'app.8', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Bays West Stage 1 Precinct Land Application Map', lay_class: 'Subject Land', label: 'Site B', unit: 'app.8', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Bays West Stage 1 Precinct Land Application Map', lay_class: 'Subject Land', label: 'Site C', unit: 'app.8', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Bays West Stage 1 Precinct Land Application Map', lay_class: 'Subject Land', label: 'Site D', unit: 'app.8', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts – Eastern Harbour City) 2021 Cooks Cove Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.6', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 SREP No 26-City West-Map 1', lay_class: 'Subject Area Boundary', label: 'Bays Precinct', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 SREP No 26-City West-Map 1', lay_class: 'Subject Area Boundary', label: 'Eveleigh Railway Workshops', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Sydney Opera House Buffer Zone Map', lay_class: 'Sydney Opera House Buffer Zone', label: 'Sydney Opera House Buffer Zone', unit: 'app.1', basis: 'hand', note: 'the buffer zone the Opera House appendix defines' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Subject Land', label: 'Luna Park', unit: 'app.2', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Subject Land', label: 'North Head Federal Police Training site', unit: 'app.4', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Subject Land', label: 'Sydney Opera House', unit: 'app.1', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Sydney Harbour Foreshore Sites', label: 'Circular Quay', unit: null, basis: 'hand', note: 'REVIEW: a foreshore site under the former SSP SEPP; no unit of this instrument names Circular Quay' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Sydney Harbour Foreshore Sites', label: 'Darling Harbour', unit: 'ch.3', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Sydney Harbour Foreshore Sites', label: 'The Rocks', unit: null, basis: 'hand', note: 'REVIEW: as Circular Quay' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Land Application Map', lay_class: 'Sydney Harbour Port and Related Employment Lands', label: 'Sydney Harbour Port and Related Employment Lands', unit: null, basis: 'hand', note: 'REVIEW: Chapter 2 names the Port and Related Employment Lands Map; which unit governs is a reading' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (State Significant Precincts) 2005 Barangaroo site Land Application Map', lay_class: 'Subject Land', label: 'Barangaroo', unit: 'app.5', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (State Significant Precincts) 2005 Redfern–Waterloo Authority Sites Land Application Map', lay_class: 'Area A', label: 'Area A', unit: 'app.3', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (State Significant Precincts) 2005 Redfern–Waterloo Authority Sites Land Application Map', lay_class: 'Subject Land', label: null, unit: 'app.3', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (State Significant Precincts) 2005 Sirius Site Land Application Map', lay_class: 'Subject Land', label: null, unit: 'app.7', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (State Significant Precincts) 2005 Wahroonga Estate site Land Application Map', lay_class: 'Subject Land', label: 'Wahroonga Estate', unit: 'app.6', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SREP No 16—Walsh Bay Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts - Eastern Harbour City) 2021 Barangaroo Land Zoning Map', lay_class: null, label: null, unit: 'app.5', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Bays West Stage 1 Precinct Land Zoning Map', lay_class: null, label: null, unit: 'app.8', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Cooks Cove Land Zoning Map', lay_class: null, label: null, unit: 'ch.6', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts—Eastern Harbour City) 2021 Sydney Regional Environmental Plan No 26-City West-Map 2', lay_class: null, label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (State Significant Precincts) 2005 Redfern–Waterloo Authority Sites Land Zoning Map', lay_class: null, label: null, unit: 'app.3', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (State Significant Precincts) 2005 Wahroonga Estate site Land Zoning Map', lay_class: null, label: null, unit: 'app.6', basis: 'proposed', note: 'profile precincts-eastern-harbour-city-2021 (proposed)' },
  ],
}
export default profile
