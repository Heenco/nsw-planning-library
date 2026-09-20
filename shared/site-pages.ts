/**
 * Every page in the app - built, being built, planned - for /pages.
 *
 * One entry per route. `status` says where it stands: `live` is deployed,
 * `building` exists in the working tree but is not finished, `planned` has a
 * notebook behind it and no page yet. The planned list is drawn from the
 * pipeline plan in the Notebooks repo (00 - Orchastrization.md): each is a
 * build that exists as a notebook but has nothing in the app reading it.
 * Edit here to add, rename or reorder; the page renders whatever is listed.
 */

export type PageStatus = 'live' | 'building' | 'planned'
export type PageKind = 'answer' | 'browse' | 'map' | 'testing'

export interface SitePage {
  route: string
  name: string
  status: PageStatus
  kind: PageKind
  /** First commit that added the page (ISO date); live pages only. */
  added?: string
  /** What it is for, in one sentence. */
  summary: string
  /** How it is built or what it shows, in one more. */
  detail?: string
  /** APIs, tables or files it reads. */
  reads?: string[]
  /** The notebook that builds what the page reads. */
  notebook?: string
}

export interface PageGroup { kind: PageKind; id: string; label: string; lead: string }

export const PAGE_GROUPS: PageGroup[] = [
  {
    kind: 'answer', id: 'answers', label: 'Answers about a property',
    lead: 'Start from an address and get something back: a report, an answer, what a zone allows, what could be built.',
  },
  {
    kind: 'browse', id: 'library', label: 'The library and its data',
    lead: 'The instruments themselves, the reader they open in, what made it into the graph, and where the data comes from.',
  },
  {
    kind: 'map', id: 'maps', label: 'Maps and layers',
    lead: 'The spatial side: every layer on one map, frontage decided from the parcel fabric, lots found by what they are.',
  },
  {
    kind: 'testing', id: 'testing', label: 'Testing the builds',
    lead: 'Plain views of the derived tables the notebooks write, for checking a build while it runs. Not reports: nothing rounded, nothing hidden.',
  },
]

export const SITE_PAGES: SitePage[] = [
  // ── answers ───────────────────────────────────────────────────────────────
  {
    route: '/', name: 'Home', status: 'live', kind: 'answer', added: '2026-04-13',
    summary: 'Address search that leads to a property report, and the map of states - NSW connected, the others marked coming.',
    reads: ['/api/address-autocomplete', '/instruments.json'],
  },
  {
    route: '/report', name: 'Property Report', status: 'live', kind: 'answer', added: '2026-04-13',
    summary: 'Everything the library knows about one property: identity, zoning and permitted uses, the numeric controls, site-specific provisions, lot-size and subdivision tests, DCP figures, the lot sketch - with its sources and a follow-up question box.',
    detail: 'Property records cover NSW; the clause-level analysis covers the councils whose LEP and DCP are in the rule layer, and a report outside those says so.',
    reads: ['/api/property-report', '/api/property/detail', 'up_property_d_4', 'the LEP/DCP rule layer'],
  },
  {
    route: '/ask', name: 'Ask a Planning Question', status: 'live', kind: 'answer', added: '2026-04-13',
    summary: 'A free-text question over the ingested LEPs, SEPPs and DCPs, answered with citations into the documents.',
    detail: 'Experimental: it covers the instruments in the library, not all of NSW, and says so at the top.',
    reads: ['/api/ask', '/api/followup'],
  },
  {
    route: '/permissibility', name: 'Permissibility', status: 'live', kind: 'answer', added: '2026-09-14',
    summary: "Any plan's Land Use Table, zone by zone: permitted with and without consent, prohibited, and what a group term covers.",
    detail: 'The same component the report uses; plan and zone live in the URL so a zone can be linked to.',
    reads: ['/api/lep-permissibility'], notebook: '01E - LEP Permissibility',
  },
  {
    route: '/design-lab', name: 'Design Lab', status: 'live', kind: 'answer', added: '2026-09-07',
    summary: "Given a lot's envelope, asks a model for a scheme, turns it into geometry, and measures it against the same controls the envelope was drawn from.",
    detail: 'The measurements are the point: a massing that breaches its own setback is shown as breaching it. Nothing here is advice.',
    reads: ['/api/property/envelope', '/api/design/brief', '/api/design/generate', '/api/design/model'],
  },
  {
    route: '/craftbot', name: '3D Viewer', status: 'live', kind: 'answer', added: '2026-09-04',
    summary: 'The vendored three.js viewer that shows an envelope, or a Design Lab model, in three dimensions.',
    detail: 'It displays models; it does not generate them.',
    reads: ['/api/property/envelope', '/api/design/model'],
  },

  // ── the library ───────────────────────────────────────────────────────────
  {
    route: '/library', name: 'Planning Library', status: 'live', kind: 'browse', added: '2026-09-04',
    summary: 'The catalogue of every instrument in the library: pick a state, then browse or search its LEPs, SEPPs and DCPs.',
    reads: ['/instruments.json'],
  },
  {
    route: '/doc-viewer', name: 'Document viewer', status: 'live', kind: 'browse', added: '2026-04-13',
    summary: 'Reads a DCP as marked-up text with an anchor on every heading and a table of contents - where a citation lands when you follow it.',
    reads: ['the DCP markdown files'], notebook: '01G - Download DCPs',
  },
  {
    route: '/graph', name: 'Graph coverage', status: 'live', kind: 'browse', added: '2026-09-05',
    summary: 'What actually made it into the knowledge graph, measured against each source file - and whether the rules can reach a property report, not only whether they exist.',
    reads: ['/api/graph-coverage'],
  },
  {
    route: '/datasources', name: 'Data sources', status: 'live', kind: 'browse', added: '2026-09-17',
    summary: 'The data behind the library, state by state: every table and how they join, a live trace of any address or lot through them, the planning layers, the coded values, and the measured accuracy.',
    reads: ['/api/datasources/nsw', '/api/datasources/nsw-address', '/api/datasources/nsw-lot'],
    notebook: '01A - Read and write - Geojson',
  },
  {
    route: '/epi', name: 'EPI layers', status: 'live', kind: 'map', added: '2026-09-19',
    summary: 'Every layer of the planning instrument map library on one map: all 56 tables of the epi schema, and a click that reads all of them at once.',
    detail: 'The answer is the lot polygon, shrunk 10 cm so a shared boundary is not a hit, tested against all 56 tables in PostGIS rather than read from the tiles. Each row says how much of the lot it covers, so split zoning reads as a share rather than as whichever zone the front door is in. A second tab runs the same lot against the 134 live NSW services, which is how you see whether our copy has aged. Tiles are built in six groups so a 4 GB schema can be rebuilt after each load without one enormous pass.',
    reads: ['/api/epi/layers', '/api/epi/at', '/api/lot-intersect', '/api/lotprofile', 'the epi schema', 'cadastre.lot'],
    notebook: '01A-pmtiles-epi',
  },
  {
    route: '/esa', name: 'Environmentally sensitive areas', status: 'live', kind: 'map', added: '2026-09-18',
    summary: 'Both halves of clause 3.3 on one map: the state-wide definition that applies to every lot in NSW, and the extra items 30 local plans add on top.',
    detail: 'A tab each, because confusing the two is the easy mistake. The state-wide set is one switch per item, grouped by paragraph of the clause, with where each layer came from and whether it reconciled against its source; the three items nobody publishes are listed as gaps rather than left silent. The additions keep their two tiers: items with real geometry, and items that cover a whole council area because the exception is a register with nothing to draw.',
    reads: ['/api/esa', '/api/esa/clause33', 'esa.clause33_layers', 'esa.additional_exceptions', 'esa.source_layers'],
    notebook: '07 - ESA - exceptions, 07C - ESA - clause 3.3 state-wide',
  },
  {
    route: '/sepp', name: 'SEPP permissible land uses', status: 'live', kind: 'browse', added: '2026-09-18',
    summary: 'What the Housing and Transport and Infrastructure SEPPs permit in each zone, whatever the local plan says: all 263 rows, where they came from, and what they leave out.',
    detail: 'The rows are a hand transcription of the land use matrix the Department publishes, so the page says so plainly - the conditions each policy attaches are not carried, and the 2025 low and mid-rise round is missing.',
    reads: ['/api/sepp', 'nsw.sepp_permissible_landuse'],
    notebook: '05 - Import SEPP Permissible Landuse',
  },
  {
    route: '/pages', name: 'Pages', status: 'live', kind: 'browse', added: '2026-09-17',
    summary: 'This page: every page in the app, built and planned.',
    reads: ['shared/site-pages.ts'],
  },

  // ── maps ──────────────────────────────────────────────────────────────────
  {
    route: '/map', name: 'Tile catalog', status: 'live', kind: 'map', added: '2026-09-04',
    summary: 'Every vector-tile layer the warehouse serves, searchable and switchable on one map.',
    reads: ['/api/map-catalogue', '/api/tiles', 'Martin vector tiles'],
  },
  {
    route: '/frontage', name: 'Frontage and lot tools', status: 'live', kind: 'map', added: '2026-09-10',
    summary: 'Five tools on one map: frontage decided from the parcel fabric, lots found by what they are (zone, use, size, overlay) across every NSW council, the live NSW map layers, a true polygon intersect of a lot against all of them, and the local layers held in the warehouse.',
    reads: ['/api/frontage', '/api/frontage-lot-search', '/api/lot-intersect', '/api/map-layer', 'up_property_d_4'],
  },
  {
    route: '/lmr', name: 'Low and Mid Rise housing and SEPP layers', status: 'live', kind: 'map', added: '2026-09-18',
    summary: 'Every SEPP land application layer on one map - the four Housing SEPP low and mid-rise layers first - over the constraint layers the policy is checked against: stations and their walking catchments, heritage, bush fire, flood, coastal, aircraft noise and the pipelines with their 200 m buffers.',
    detail: 'Served from two PMTiles archives on the planningai host rather than a tile server or the database; search an address or lot reference to go to that lot, clicking the map says what applies at that point, and a guide beside it sets out how the LMR layer itself gets built. Rebuild after each EPI load.',
    reads: ['/api/lmr/layers', '/api/lmr/tiles', '/api/lmr/at', 'epi.epi_land_application', 'the lmr schema'],
    notebook: '01A dump-gdal',
  },
  {
    route: '/prop-width', name: 'Property width', status: 'live', kind: 'map', added: '2026-09-07',
    summary: 'Lot width and frontage from lot_metrics_3, drawn on the map lot by lot.',
    reads: ['/api/frontage-metrics', 'lot_metrics_3'], notebook: '04D - Property Frontages - Lots',
  },
  {
    route: '/prop-width-gnaf', name: 'Property width (G-NAF)', status: 'live', kind: 'map', added: '2026-09-07',
    summary: 'The same page over lot_metrics_gnaf; the dataset is the only difference between the two.',
    reads: ['/api/frontage-metrics', 'lot_metrics_gnaf'], notebook: '04D - lots frontage - gnaf',
  },

  // ── testing ───────────────────────────────────────────────────────────────
  {
    route: '/testing-spatial-services', name: 'Testing spatial services', status: 'live', kind: 'testing', added: '2026-09-17',
    summary: 'The lot profile build: search an address or a lot reference and see every column written for that lot - the frontage runs, the road access, the map with its neighbours.',
    reads: ['/api/lotprofile', 'derived.lot_address', 'derived.lot_frontage', 'derived.lot_frontage_run'],
    notebook: '02C - Lot profile with frontage (planningai)',
  },
  {
    route: '/testing-slope', name: 'Testing slope', status: 'live', kind: 'testing', added: '2026-09-18',
    summary: "The slope build: how many of the 342 slope sheets are done, lots by method, and the trace behind any one lot's slope - every sheet that measured it and the arithmetic that produced the row.",
    reads: ['/api/lotslope', 'derived.lot_slope', 'derived.lot_slope_part', 'derived.lot_slope_sheet'],
    notebook: '03 - slope calculations - spatial services',
  },

  // ── planned: notebooks with nothing in the app reading them yet ───────────
  {
    route: '/testing-flood', name: 'Testing flood', status: 'planned', kind: 'testing',
    summary: 'The flood planning data per lot, the way the slope and frontage pages show theirs; airport noise is in the same acquisition step.',
    notebook: '19.FloodMapping',
  },
  {
    route: '/testing-accessibility', name: 'Testing accessibility', status: 'planned', kind: 'testing',
    summary: 'The bus and train buffers: which lots are within walking distance of a stop or station, and of which service.',
    notebook: '24 - Accessible Area - Bus & Train Buffers',
  },
  {
    route: '/testing-employment', name: 'Testing employment zones', status: 'planned', kind: 'testing',
    summary: 'The employment zone mapping per lot, so the reform-era zone names can be checked against the source.',
    notebook: '03-Employment zone mapping',
  },
  {
    route: '/lmr', name: 'Low and mid-rise areas', status: 'planned', kind: 'answer',
    summary: 'Whether a lot is in a low and mid-rise housing area and which standards then apply; shared/lmr-standards.ts already holds the standards for the report.',
    notebook: '05_lmr',
  },
  {
    route: '/das', name: 'Development applications', status: 'planned', kind: 'answer',
    summary: 'The development applications lodged around a lot: what was applied for, what was decided, and when.',
    notebook: '10 - Download DAs',
  },
  {
    route: '/cdc', name: 'Complying development criteria', status: 'live', kind: 'browse', added: '2026-09-19',
    summary: 'The complying development prerequisites of the Codes SEPP clause by clause, then the 12 codes that sit on top of them, with our test beside each one.',
    detail: 'Ordered the way the instrument is rather than the way our data is, because a list built around our columns hides every gap: a gap is a row nobody wrote. Clause numbers and wording come from the Department workbook, the tests from the CDC rules notebook, joined by a hand-written map so no citation is a guess. Above the fold are the prerequisites every certificate has to clear; below them each code adds its own, which is where the zone, the lot size and the frontage are decided. It shows 14 prerequisites we do not test, 68 code requirements we do not test, and the places where our test is wider than the clause. Testing an individual lot is still to come.',
    reads: ['shared/cdc-criteria.ts', 'the Department CDC Rules workbook', '07 - CDC rules'],
    notebook: '07 - CDC rules',
  },
  {
    route: '/cdc-map', name: 'Complying development on a lot', status: 'live', kind: 'answer', added: '2026-09-19',
    summary: 'Every layer a complying development check needs, switchable on the map, and a verdict for any lot you pick with the clause each hit belongs to.',
    detail: 'The companion to /cdc: that page is the rules, this one is a property against the rules. Every layer switches on and off from the panel and carries its own detail - the clause it answers, the table it reads, the filter applied to it, and whether the notebook tests it. The schema behind it is almost all views rather than copies, so it cannot drift from epi, esa and lmr, and each view is the layer as the clause needs it rather than the whole source table. Pick a lot and the answer is a verdict, not a list, because a hit only means something once you know its scope - a prerequisite of clause 1.17A rules out every certificate type, clause 182 gates only the Pattern Book, and being inside a zone means nothing at all. Five layers have no dataset anywhere, and the page says so rather than reporting a lot as clear of them.',
    reads: ['cdc schema (64 layers)', 'cdc PMTiles (6 groups)', 'cadastre.lot', 'epi · esa · lmr'],
    notebook: '07 - CDC rules',
  },
  {
    route: '/pattern-book', name: 'Pattern Book criteria', status: 'live', kind: 'browse', added: '2026-09-19',
    summary: 'What each of the 22 Pattern Book designs needs from a lot: put in a size, a frontage and a slope, and the designs that fit answer back.',
    detail: 'Each design comes down to three numbers, which as a table of 22 rows means nothing. So the page is built the other way round: you describe a lot and the designs respond, with the one that stops each of the others named. A ladder shows the whole range, from a 450 square metre semi to a 3,551 square metre apartment block. Per-council statistics are still to come.',
    reads: ['shared/pattern-book.ts'],
    notebook: '07 - Pattern book · 20B - Pattern Book Stats',
  },
  {
    route: '/build-to-rent', name: 'Build to rent', status: 'planned', kind: 'answer',
    summary: 'Where build-to-rent housing is permitted and on what terms.',
    notebook: '07B - Build to Rent',
  },
  {
    route: '/seifa', name: 'SEIFA', status: 'planned', kind: 'browse',
    summary: 'The 2021 socio-economic indexes by area, joined to lots and suburbs.',
    notebook: '22 - SEIFA 2021 Analysis',
  },
  {
    route: '/datasources?state=qld', name: 'Queensland data sources', status: 'planned', kind: 'browse',
    summary: 'The second state on the data sources page: the Queensland cadastre and planning layers, loaded the way NSW was.',
    notebook: '01A dump-gdal-QLD',
  },
]
