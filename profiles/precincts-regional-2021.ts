/**
 * Instrument profile — State Environmental Planning Policy (Precincts—Regional) 2021 (epi-2021-0727).
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

const TITLE = 'State Environmental Planning Policy (Precincts—Regional) 2021'
/** the instrument's short name, inside every unit term: a heading like "State significant precincts" repeats across the four */
const SHORT = 'Precincts—Regional SEPP'
const UNIT = (local_id: string, heading: string): TermMapping => ({
  dimension: 'defined_area', term: `governed by ${heading} (${SHORT})`, source_kind: 'derived', source: 'derived.lot_instrument',
  test: 'attribute', column_tested: 'unit_local_id', filter: `document_title = '${TITLE.replace(/'/g, "''")}' AND unit_local_id = '${local_id}' AND governing`,
  kind: 'condition', note: `the lot's governing unit is ${local_id} (${heading}) - derived.lot_instrument, docs/precinct-sepp-pipeline.md §1`,
})

const profile: InstrumentProfile = {
  instrument: 'epi-2021-0727',
  slug: 'state-environmental-planning-policy-precincts-regional-2021',
  label: 'sepp-precincts-regional-2021',
  rank: 30,
  chapters: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'sch.1', 'sch.1A', 'sch.1B', 'sch.1C', 'sch.1D', 'sch.1E', 'sch.2', 'sch.3', 'sch.4', 'sch.4A', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9', 'sch.10', 'sch.11'],
  frames: [
    {
      id: 'instrument',
      title: 'State Environmental Planning Policy (Precincts—Regional) 2021',
      parent: null,
      clause: '1.1',
      section: 'ch.1',
      governs: ['ch.1', 'ch.2', 'ch.3', 'ch.4', 'ch.5', 'ch.6', 'app.1', 'app.2', 'app.3', 'app.4', 'app.5', 'app.6', 'sch.1', 'sch.1A', 'sch.1B', 'sch.1C', 'sch.1D', 'sch.1E', 'sch.2', 'sch.3', 'sch.4', 'sch.4A', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9', 'sch.10', 'sch.11'],
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
        { dimension: 'defined_area', value: 'governed by State significant precincts (Precincts—Regional SEPP)', polarity: 'applies', clause: '2.2',
          span: 'On the repeal of Part 3A of the Act, this Chapter is subject to Schedule 6A to the Act. Note. Schedule 6A of the Act sets out those projects which will continue as Part 3A projects (transitional Part 3A projects) and revokes the declaration of any other Part 3A project. The repeal of clauses 6–6C an', term: 'governed by State significant precincts (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '2.6', span: 'Subject to section 74(1) of the Act, in the event of an inconsistency between this Chapter and another environmental planning instrument whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      note: '',
    },
    {
      id: 'ch.3',
      title: 'Activation Precincts',
      parent: 'instrument',
      clause: '3.3',
      section: 'sec.3.3',
      governs: ['ch.3', 'sch.1C', 'sch.1E'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Activation Precincts (Precincts—Regional SEPP)', polarity: 'applies', clause: '3.3',
          span: 'This Chapter applies to land within an Activation Precinct.', term: 'governed by Activation Precincts (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '3.4', span: 'In the event of an inconsistency between this Chapter and another environmental planning instrument, whether made before or after the commencement of this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      disapplies: [
        { instrument: 'doc_type:lep', part: null, clause: '3.4', span: 'A local environmental plan does not apply to land within an Activation Precinct.' },
        { instrument: 'State Environmental Planning Policy (Planning Systems) 2021', part: 'Chapter 2', clause: '3.4', span: 'State Environmental Planning Policy (Planning Systems) 2021, Chapter 2 does not apply to land within an Activation Precinct.' },
      ],
      note: 'further wording of the relationship clause (exceptions, step 4): A local environmental plan does not apply to land within an Activation Precinct. State Environmental Planning Policy (Planning Systems) 2021, Chapter 2 does not apply to land within an Activation Precinct. Subsection (3) does not apply to the following development carried out on land that is partly within and partly outside an Activation Precinct—  | disapplies 2 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.4',
      title: 'Kosciuszko Alpine Region',
      parent: 'instrument',
      clause: '4.2',
      section: 'sec.4.2',
      governs: ['ch.4', 'sch.2', 'sch.3', 'sch.4', 'sch.4A'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Kosciuszko Alpine Region (Precincts—Regional SEPP)', polarity: 'applies', clause: '4.2',
          span: 'This Chapter applies to the Alpine Region. The Alpine Region comprises the following Alpine Subregions— Blue Cow Terminal, Bullocks Flat Terminal, Charlotte Pass Alpine Resort, Creel Bay Alpine Accommodation, Kosciuszko Tourist Park Alpine Accommodation, Mount Selwyn Alpine Resort, Perisher Range Al', term: 'governed by Kosciuszko Alpine Region (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '4.6', span: 'The following do not apply to land to which this chapter applies— Snowy River Local Environmental Plan 2013, State Environmental Planning Policy (Housing) 2021, Chapter 4, State Environmental Planning Policy (Industry and Employment) 2021, Chapter 3, Tumut Local Environmental Plan 2012.' },
      disapplies: [
        { instrument: 'Snowy River Local Environmental Plan 2013', part: null, clause: '4.6', span: 'The following do not apply to land to which this chapter applies— Snowy River Local Environmental Plan 2013, State Environmental Planning Policy (Housing) 2021, Chapter 4, State Environmental Planning Policy (Industry and Employment) 2021, Chapter 3, Tumut Local Environmental Plan 2012.' },
        { instrument: 'State Environmental Planning Policy (Housing) 2021', part: 'Chapter 4', clause: '4.6', span: 'The following do not apply to land to which this chapter applies— Snowy River Local Environmental Plan 2013, State Environmental Planning Policy (Housing) 2021, Chapter 4, State Environmental Planning Policy (Industry and Employment) 2021, Chapter 3, Tumut Local Environmental Plan 2012.' },
        { instrument: 'State Environmental Planning Policy (Industry and Employment) 2021', part: 'Chapter 3', clause: '4.6', span: 'The following do not apply to land to which this chapter applies— Snowy River Local Environmental Plan 2013, State Environmental Planning Policy (Housing) 2021, Chapter 4, State Environmental Planning Policy (Industry and Employment) 2021, Chapter 3, Tumut Local Environmental Plan 2012.' },
        { instrument: 'Tumut Local Environmental Plan 2012', part: null, clause: '4.6', span: 'The following do not apply to land to which this chapter applies— Snowy River Local Environmental Plan 2013, State Environmental Planning Policy (Housing) 2021, Chapter 4, State Environmental Planning Policy (Industry and Employment) 2021, Chapter 3, Tumut Local Environmental Plan 2012.' },
      ],
      note: 'the relationship clause disapplies the LEP (or every other instrument) on this land: written as prevailing over the LEP; any SEPP it also disapplies is an excludes edge (step 4) | disapplies 4 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.5',
      title: 'Gosford city centre',
      parent: 'instrument',
      clause: '5.2',
      section: 'sec.5.2',
      governs: ['ch.5', 'sch.5', 'sch.6', 'sch.7', 'sch.8', 'sch.9', 'sch.10'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Gosford city centre (Precincts—Regional SEPP)', polarity: 'applies', clause: '5.2',
          span: 'This Chapter applies to the land identified on the Land Application Map.', term: 'governed by Gosford city centre (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '5.9', span: 'In the event of an inconsistency between this Chapter and another environmental planning instrument, whether made before or after this Chapter, this Chapter prevails to the extent of the inconsistency.' },
      disapplies: [
        { instrument: 'State Environmental Planning Policy No 1—Development Standards', part: null, clause: '5.9', span: 'The following State environmental planning policies (or provisions) do not apply to the land to which this Chapter applies— State Environmental Planning Policy No 1—Development Standards' },
      ],
      note: 'further wording of the relationship clause (exceptions, step 4): Despite subsection (1), State Environmental Planning Policy (State and Regional Development) 2011 prevails to the extent of any inconsistency between this Chapter and State Environmental Planning Policy (State and Regional Development) 2011. The following State environmental planning policies (or provisions) do not apply to the land to which this C | disapplies 1 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'ch.6',
      title: 'Port Kembla Land Transformation Precinct',
      parent: 'instrument',
      clause: '6.2',
      section: 'sec.6.2',
      governs: ['ch.6', 'sch.11'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Port Kembla Land Transformation Precinct (Precincts—Regional SEPP)', polarity: 'applies', clause: '6.2',
          span: 'This chapter applies to the Port Kembla Land Transformation Precinct.', term: 'governed by Port Kembla Land Transformation Precinct (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '6.7', span: 'This chapter prevails to the extent of any inconsistency between this chapter and another environmental planning instrument, whether made before or after this chapter. Despite subsection (1), State Environmental Planning Policy (Transport and Infrastructure) 2021, Chapter 2 prevails to the extent of any inconsistency between this chapter and State Environmental Planning Policy (Transport and Infra' },
      disapplies: [
        { instrument: 'Wollongong Local Environmental Plan 2009', part: null, clause: '6.7', span: 'Wollongong Local Environmental Plan 2009 does not apply to the land to which this chapter applies.' },
      ],
      note: 'disapplies 1 instrument(s) or part(s) on this land - written as disapplies edges (step 4)',
    },
    {
      id: 'app.1',
      title: 'State significant precinct—Kings Forest site',
      parent: 'ch.2',
      clause: '3',
      section: 'app.1-inc-sec.3',
      governs: ['app.1'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Kings Forest site (Precincts—Regional SEPP)', polarity: 'applies', clause: '3',
          span: 'Subject to subsections (2) and (3), this Appendix applies with respect to development within the Kings Forest site and so applies whether or not the development is a transitional Part 3A project. This Appendix does not apply to the land comprising Lot 19, DP 112061 unless and until that land has bee', term: 'governed by State significant precinct—Kings Forest site (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '10', span: 'The only environmental planning instruments that apply, according to their terms, to or in respect of development within the Kings Forest site are as follows— in the case of development that is a transitional Part 3A project—Chapter 2 and all other State environmental planning policies otherwise applicable to the land, except clause 4.6 of Tweed Local Environmental Plan 2014, in the case of all ot' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.2',
      title: 'State significant precinct—Tomago Industrial site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.2-inc-pt.1-sec.1',
      governs: ['app.2'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Tomago Industrial site (Precincts—Regional SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map referred to in this Schedule as the Tomago Industrial site.', term: 'governed by State significant precinct—Tomago Industrial site (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '13', span: 'The only environmental planning instruments that apply, according to their terms, to the Tomago Industrial site are all other State environmental planning policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.3',
      title: 'State significant precinct—Sandon Point site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.3-inc-pt.1-sec.1',
      governs: ['app.3'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Sandon Point site (Precincts—Regional SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Sandon Point site.', term: 'governed by State significant precinct—Sandon Point site (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '5', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Sandon Point site are Chapter 2 and all other State environmental planning policies except State Environmental Planning Policy (Coastal Management) 2018.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.4',
      title: 'State significant precinct—Rise Bilambil Heights site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.4-inc-pt.1-sec.1',
      governs: ['app.4'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Rise Bilambil Heights site (Precincts—Regional SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Appendix as the Rise Bilambil Heights site.', term: 'governed by State significant precinct—Rise Bilambil Heights site (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '5', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Rise Bilambil Heights site are Chapter 2 and all other State environmental planning policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.5',
      title: 'State significant precinct—Calderwood site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.5-inc-pt.1-sec.1',
      governs: ['app.5'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Calderwood site (Precincts—Regional SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified in the Land Application Map, referred to in this Appendix as the Calderwood site.', term: 'governed by State significant precinct—Calderwood site (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '5', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Calderwood site are— Chapter 2, and all other State Environmental Planning Policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'app.6',
      title: 'State significant precinct—Southern Highlands Regional Shooting Complex site',
      parent: 'ch.2',
      clause: '1',
      section: 'app.6-inc-pt.1-sec.1',
      governs: ['app.6'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by State significant precinct—Southern Highlands Regional Shooting Complex site (Precincts—Regional SEPP)', polarity: 'applies', clause: '1',
          span: 'This Appendix applies to the land identified on the Land Application Map, referred to in this Schedule as the Southern Highlands Regional Shooting Complex site.', term: 'governed by State significant precinct—Southern Highlands Regional Shooting Complex site (Precincts—Regional SEPP)' },
      ],
      prevails: { over: ['lep'], clause: '5', span: 'The only environmental planning instruments that apply, according to their terms, to land within the Southern Highlands Regional Shooting Complex site are Chapter 2 and all other State environmental planning policies.' },
      note: 'the appendix lists the only instruments that apply to the site, and an LEP is not among them: read as prevailing over the LEP',
    },
    {
      id: 'sch.1',
      title: 'Parkes Activation Precinct',
      parent: 'ch.3',
      clause: 'sch.1',
      section: 'sch.1',
      governs: ['sch.1'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Parkes Activation Precinct (Precincts—Regional SEPP)', polarity: 'applies', clause: 'sch.1',
          span: 'the unit Parkes Activation Precinct', term: 'governed by Parkes Activation Precinct (Precincts—Regional SEPP)' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Activation Precincts)',
    },
    {
      id: 'sch.1A',
      title: 'Wagga Wagga Activation Precinct',
      parent: 'ch.3',
      clause: 'sch.1A',
      section: 'sch.1A',
      governs: ['sch.1A'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Wagga Wagga Activation Precinct (Precincts—Regional SEPP)', polarity: 'applies', clause: 'sch.1A',
          span: 'the unit Wagga Wagga Activation Precinct', term: 'governed by Wagga Wagga Activation Precinct (Precincts—Regional SEPP)' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Activation Precincts)',
    },
    {
      id: 'sch.1B',
      title: 'Moree Activation Precinct',
      parent: 'ch.3',
      clause: 'sch.1B',
      section: 'sch.1B',
      governs: ['sch.1B'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Moree Activation Precinct (Precincts—Regional SEPP)', polarity: 'applies', clause: 'sch.1B',
          span: 'the unit Moree Activation Precinct', term: 'governed by Moree Activation Precinct (Precincts—Regional SEPP)' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Activation Precincts)',
    },
    {
      id: 'sch.1D',
      title: 'Snowy Mountains Activation Precinct',
      parent: 'ch.3',
      clause: 'sch.1D',
      section: 'sch.1D',
      governs: ['sch.1D'],
      conditions: [
        { dimension: 'defined_area', value: 'governed by Snowy Mountains Activation Precinct (Precincts—Regional SEPP)', polarity: 'applies', clause: 'sch.1D',
          span: 'the unit Snowy Mountains Activation Precinct', term: 'governed by Snowy Mountains Activation Precinct (Precincts—Regional SEPP)' },
      ],
      note: 'no relationship clause of its own: inherits the frame of ch.3, the chapter of its kind (Activation Precincts)',
    },
  ],
  terms: [
    UNIT('ch.2', 'State significant precincts'),
    UNIT('ch.3', 'Activation Precincts'),
    UNIT('ch.4', 'Kosciuszko Alpine Region'),
    UNIT('ch.5', 'Gosford city centre'),
    UNIT('ch.6', 'Port Kembla Land Transformation Precinct'),
    UNIT('app.1', 'State significant precinct—Kings Forest site'),
    UNIT('app.2', 'State significant precinct—Tomago Industrial site'),
    UNIT('app.3', 'State significant precinct—Sandon Point site'),
    UNIT('app.4', 'State significant precinct—Rise Bilambil Heights site'),
    UNIT('app.5', 'State significant precinct—Calderwood site'),
    UNIT('app.6', 'State significant precinct—Southern Highlands Regional Shooting Complex site'),
    UNIT('sch.1', 'Parkes Activation Precinct'),
    UNIT('sch.1A', 'Wagga Wagga Activation Precinct'),
    UNIT('sch.1B', 'Moree Activation Precinct'),
    UNIT('sch.1D', 'Snowy Mountains Activation Precinct'),
  ],
  signals: {
    permission: ['is permitted with development consent', 'may be carried out with development consent', 'may be carried out only with development consent'],
    prohibition: ['is prohibited', 'must not be granted', 'must not be carried out'],
    override: ['despite any other provision', 'despite the provisions of another environmental planning instrument'],
  },
  /** which map polygon key names which unit - the authority for nsw.instrument_unit_map once reviewed (scripts/pipeline/units.ts) */
  unitKeys: [
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Activation Precincts) 2020 Moree Activation Precinct Land Application Map', lay_class: 'Moree Activation Precinct', label: null, unit: 'sch.1B', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Activation Precincts) 2020 Parkes Activation Precinct Land Application Map', lay_class: 'Subject Land', label: null, unit: 'sch.1', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Activation Precincts) 2020 Wagga Wagga Activation Precinct Land Application Map', lay_class: 'Wagga Wagga Activation Precinct', label: null, unit: 'sch.1A', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Gosford City Centre) 2018 Land Application Map', lay_class: 'Land Application', label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Kosciuszko National Park-Alpine Resorts) 2007 Land Application Map', lay_class: 'Kosciuszko Mountain Retreat Alpine Resort', label: 'Kosciuszko Tourist Park Alpine Accomodation', unit: null, basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Kosciuszko National Park-Alpine Resorts) 2007 Land Application Map', lay_class: 'Ski Rider Alpine Resort', label: 'Ski Rider Alpine Accomodation', unit: null, basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Kosciuszko National Park-Alpine Resorts) 2007 Land Application Map', lay_class: 'Sponars Chalet Resort', label: null, unit: null, basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Bullocks Flat Terminal Map', lay_class: 'Subject Sites', label: 'Bullocks Flat Terminal', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Charlotte Pass Alpine Resort Map', lay_class: 'Subject Sites', label: 'Charlotte Pass Alpine Resort', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Kosciuszko Alpine Region Aboriginal Archaeological Heritage Map', lay_class: 'Archaeologically Sensitive Land', label: null, unit: 'ch.4', basis: 'hand', note: 'a Chapter 4 overlay, not a unit of its own' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Kosciuszko Alpine Region Aboriginal Archaeological Heritage Map', lay_class: 'Perisher Range Alpine Resort', label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Minor Alpine Accommodation Map', lay_class: 'Subject Sites', label: 'Creel Bay Alpine Accomodation', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Minor Alpine Accommodation Map', lay_class: 'Subject Sites', label: 'Kosciuszko Tourist Park Alpine Accomodation', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Minor Alpine Accommodation Map', lay_class: 'Subject Sites', label: 'Ski Rider Alpine Accomodation', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Minor Alpine Accommodation Map', lay_class: 'Subject Sites', label: 'Sponars Chalet Alpine Accomodation', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Mount Selwyn Alpine Resort Map', lay_class: 'Subject Sites', label: 'Mount Selwyn Alpine Resort', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Perisher Range Alpine Resort Map', lay_class: 'Subject Sites', label: 'Blue Cow Terminal', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Perisher Range Alpine Resort Map', lay_class: 'Subject Sites', label: null, unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts-Regional) 2021 Port Kembla Land Transformation Precinct Land Application Map', lay_class: 'Port Kembla Land Transformation Precinct', label: null, unit: 'ch.6', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Snowy Mountains Activation Precinct Land Application Map', lay_class: 'Snowy Mountains Activation Precinct', label: 'Jindabyne Town Centre and Foreshore Sub-precinct', unit: 'sch.1D', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Snowy Mountains Activation Precinct Land Application Map', lay_class: 'Snowy Mountains Activation Precinct', label: 'Mountain Bike and Adventure Park Sub-precinct', unit: 'sch.1D', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Snowy Mountains Activation Precinct Land Application Map', lay_class: 'Snowy Mountains Activation Precinct', label: 'Sports and Education Sub-precinct', unit: 'sch.1D', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Snowy Mountains Activation Precinct Land Application Map', lay_class: 'Snowy Mountains Activation Precinct', label: 'Western Lake Jindabyne Sub-precinct', unit: 'sch.1D', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Thredbo Alpine Resort Map', lay_class: 'Subject Sites', label: 'Thredbo Alpine Resort', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (Precincts—Regional) 2021 Thredbo Ranger Station Alpine Accommodation Map', lay_class: 'Subject Sites', label: 'Thredbo Ranger Station Alpine Accommodation', unit: 'ch.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Calderwood site Land Application Map', lay_class: 'Subject Land', label: 'Calderwood Site', unit: 'app.5', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Kings Forest site Land Application Map', lay_class: 'Subject Land', label: 'Kings Forest', unit: 'app.1', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Rise Bilambil Heights site Land Application Map', lay_class: 'Subject Land', label: 'Rise Bilambil Heights', unit: 'app.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Sandon Point site Land Application Map', lay_class: 'Subject Land', label: 'Sandon Point', unit: 'app.3', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Southern Highlands Regional Shooting Complex site Land Application Map', lay_class: 'Subject Land', label: 'Southern Highlands Regional Shooting Complex', unit: 'app.6', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_application', map_name: 'SEPP (SSP) 2005 Tomago Industrial site Land Application Map', lay_class: 'Subject Land', label: 'Tomago Industrial', unit: 'app.2', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Activation Precincts) 2020 Moree Activation Precinct Land Zoning Map', lay_class: null, label: null, unit: 'sch.1B', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Activation Precincts) 2020 Parkes Activation Precinct Land Zoning Map', lay_class: null, label: null, unit: 'sch.1', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Activation Precincts) 2020 Wagga Wagga Activation Precinct Land Zoning Map', lay_class: null, label: null, unit: 'sch.1A', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Gosford City Centre) 2018 Land Zoning Map', lay_class: null, label: null, unit: 'ch.5', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts-Regional) 2021 Port Kembla Land Transformation Precinct Land Zoning Map', lay_class: null, label: null, unit: 'ch.6', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (Precincts—Regional) 2021 Snowy Mountains Activation Precinct Land Zoning Map', lay_class: null, label: null, unit: 'sch.1D', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Calderwood site Land Zoning Map', lay_class: null, label: null, unit: 'app.5', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Kings Forest site Land Zoning Map', lay_class: null, label: null, unit: 'app.1', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Rise Bilambil Heights site Land Zoning Map', lay_class: null, label: null, unit: 'app.4', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Sandon Point site Land Zoning Map', lay_class: null, label: null, unit: 'app.3', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Southern Highlands Regional Shooting Complex site Land Zoning Map', lay_class: null, label: null, unit: 'app.6', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
    { layer: 'epi.epi_land_zoning', map_name: 'SEPP (SSP) 2005 Tomago Industrial site Land Zoning Map', lay_class: null, label: null, unit: 'app.2', basis: 'proposed', note: 'profile precincts-regional-2021 (proposed)' },
  ],
}
export default profile
