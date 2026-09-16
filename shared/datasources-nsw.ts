/**
 * What the NSW land and address data is, how its tables connect, and how far it
 * can be trusted: the content behind /datasources, kept apart from the page so
 * the accuracy script (scripts/measure-nsw-data-quality.ts) measures exactly the
 * checks the page explains.
 *
 * The data is four downloads loaded into planningai by the "01A dump-gdal"
 * notebook, one schema each: cadastre, guras, integrated_address and epi. Every
 * reload drops and recreates those schemas, so nothing here may assume a table
 * outlives the next load; the notebook logs each load to public.geodaas_load_*
 * and the page reads freshness from there.
 *
 * Numbers in prose are avoided on purpose. Row counts come live from the load
 * log and match rates from public.geodaas_quality_check; `baseline` on a check
 * is only what the page shows before the script has ever run, and says when it
 * was measured.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SchemaKey = 'cadastre' | 'guras' | 'integrated_address' | 'epi'

export type TableId =
  | 'cadastre.lot'
  | 'cadastre.property'
  | 'cadastre.other'
  | 'guras.addressstring'
  | 'guras.propertylot'
  | 'guras.addresspoint'
  | 'guras.waypoint'
  | 'guras.proway'
  | 'integrated_address.point_address'
  | 'integrated_address.point_address_unique'
  | 'epi.layers'

export interface DataSource {
  schema: SchemaKey
  name: string
  publisher: string
  what: string
  delivery: string
  file: string
  coordinates: string
}

export type ConceptId =
  | 'lot' | 'dp' | 'section' | 'sp' | 'unit' | 'cp' | 'stratum' | 'partlot'
  | 'property' | 'address' | 'primary' | 'point' | 'access'

export interface Concept {
  id: ConceptId
  term: string
  /** One sentence anyone can follow. */
  plain: string
  /** Where it lives in the tables. */
  inData: string
  example: string
  /** Whether the street-block figure draws it. */
  drawn: boolean
}

export interface ColumnDoc {
  name: string
  meaning: string
  example?: string
}

export interface TableDoc {
  id: TableId
  schema: SchemaKey
  /** Physical table name(s) in the schema, for live row counts. */
  tables: string[]
  label: string
  title: string
  oneRowIs: string
  plain: string
  geometry: 'polygon' | 'point' | 'line' | 'none' | 'mixed'
  keys: ColumnDoc[]
  useful: ColumnDoc[]
  watchOuts: string[]
}

export interface EpiLayerDoc {
  /** What the rows of this layer actually say. */
  contains: string
  /**
   * Layers filed inside this table under their own lay_name that the table
   * name gives no hint of. Searching by table name will not find them.
   */
  buried?: string[]
  /** What will mislead someone reading this table for the first time. */
  watchOut?: string
}

export interface JoinDoc {
  id: string
  from: { table: TableId; column: string }
  to: { table: TableId; column: string }
  /** Extra condition that has to hold for this join to be the right one. */
  when?: string
  cardinality: '1 : 1' | 'many : 1' | '1 : many' | 'many : many' | 'spatial'
  label: string
  plain: string
  checks?: string[]
}

export interface CodeList {
  field: string
  where: string
  values: { code: string; label: string }[]
  note?: string
}

export interface QualityCheck {
  id: string
  group: 'links' | 'shapes' | 'places' | 'agreement'
  title: string
  /** The question in words, the way someone would ask it. */
  question: string
  /** Returns one row with `numerator` and `denominator`. */
  sql: string
  sample?: string
  /** At or above this share the check shows as good. */
  good: number
  /** Below this share the check shows as a problem; between the two, a caution. */
  poor: number
  /** Why the shortfall exists, and what to do about it. */
  explain: string
  baseline: { numerator: number; denominator: number; measuredAt: string }
}

export interface Limitation {
  id: string
  title: string
  plain: string
  impact: string
  workaround: string
}

// ── Sources ──────────────────────────────────────────────────────────────────

export const SCHEMA_LABEL: Record<SchemaKey, string> = {
  cadastre: 'Land parcels',
  guras: 'Addresses',
  integrated_address: 'Integrated addresses',
  epi: 'Planning layers',
}

/**
 * Identity colours for the four groups. Validated as a categorical set, all
 * pairs, against the page surface (dataviz validator: CVD and normal-vision
 * separation pass). The aqua sits under 3:1 contrast, so a group is never shown
 * by colour alone: every node and badge also prints its name.
 */
export const SCHEMA_COLOR: Record<SchemaKey, string> = {
  cadastre: '#2a78d6',
  guras: '#eb6834',
  integrated_address: '#1baf7a',
  epi: '#4a3aa7',
}

export const SOURCES: DataSource[] = [
  {
    schema: 'cadastre',
    name: 'NSW Land Parcel and Property Theme',
    publisher: 'NSW Spatial Services',
    what: 'Every lot of land in NSW, the valuation properties built from them, and roads, rail and water parcels.',
    delivery: 'GEODAAS download',
    file: 'WaterMark_EPSG4283.gdb',
    coordinates: 'GDA94 (EPSG:4283)',
  },
  {
    schema: 'guras',
    name: 'NSW Geocoded Addressing Theme (GURAS)',
    publisher: 'NSW Spatial Services',
    what: 'Every address, where it sits, how it is reached from the road, and which lots each property is made of.',
    delivery: 'GEODAAS download',
    file: 'WayPoint_EPSG4283.gdb',
    coordinates: 'GDA94 (EPSG:4283)',
  },
  {
    schema: 'integrated_address',
    name: 'NSW Integrated Address Service',
    publisher: 'NSW Spatial Services',
    what: 'The address and parcel data already joined, with formatted addresses, lot references and ABS and electoral areas. Published as a prototype.',
    delivery: 'Spatial Collaboration Portal export',
    file: 'Point_Address_SPHERICAL_MERCATOR.gdb',
    coordinates: 'Delivered as WGS84, converted to GDA94 on load',
  },
  {
    schema: 'epi',
    name: 'NSW Environmental Planning Instruments',
    publisher: 'NSW Department of Planning, Housing and Infrastructure',
    what: 'The maps behind local and state planning instruments: zoning, height, floor space ratio, lot size, heritage, hazards and more.',
    delivery: 'All-EPI geodatabase download',
    file: 'EnvironmentalPlanningInstruments.gdb',
    coordinates: 'GDA94 (EPSG:4283)',
  },
]

// ── Key ideas ────────────────────────────────────────────────────────────────

export const CONCEPTS: Concept[] = [
  {
    id: 'lot',
    term: 'Lot',
    plain: 'The smallest piece of land that can be bought and sold on its own title.',
    inData: 'One polygon per lot in cadastre.lot. No two lots are drawn on top of each other.',
    example: '17//DP10140 under 145 Malabar Road, South Coogee',
    drawn: true,
  },
  {
    id: 'dp',
    term: 'Deposited plan (DP)',
    plain: 'A registered survey plan that creates lots on the ground. Most ordinary blocks are a lot in a DP.',
    inData: 'Lots written lot/section/plan, for example 17//DP10140. Each has its own polygon.',
    example: 'Lot 17 in DP10140',
    drawn: true,
  },
  {
    id: 'section',
    term: 'Section',
    plain: 'Older plans group lots into sections, like blocks in a town grid.',
    inData: 'The middle part of a lot reference. Leave it out and the lot will not be found.',
    example: '20/36/DP758002 is lot 20 in section 36',
    drawn: false,
  },
  {
    id: 'sp',
    term: 'Strata plan (SP)',
    plain: 'A plan that divides a building into separately owned parts. The whole scheme sits on one piece of land.',
    inData: 'One polygon for the whole site in cadastre.lot, written //SP998 with no lot number.',
    example: 'SP998 at 90 Denning Street, South Coogee',
    drawn: true,
  },
  {
    id: 'unit',
    term: 'Strata unit (strata lot)',
    plain: 'One owned part of a strata building: an apartment, a shop, a car space or a storage cage.',
    inData: 'A row in guras.propertylot with propidtype 2. It has no polygon, because its edges are walls, floors and ceilings.',
    example: 'Unit 405 at 88-90 Foveaux Street is lot 38//SP67869',
    drawn: true,
  },
  {
    id: 'cp',
    term: 'Common property (CP)',
    plain: 'Everything in a strata scheme that is not inside a unit: the land, roof, lobby, driveway and gardens, owned by all owners together.',
    inData: 'A row in guras.propertylot with propidtype 3 and lot number CP. It carries the building\'s street address.',
    example: 'CP//SP998, the scheme address 90 Denning Street',
    drawn: true,
  },
  {
    id: 'stratum',
    term: 'Stratum lot',
    plain: 'A lot defined in three dimensions, such as a space above a railway, created by an ordinary deposited plan.',
    inData: 'Lot class 4 in cadastre.lot. Unlike a strata unit, it has a polygon.',
    example: 'Air space over a rail corridor',
    drawn: false,
  },
  {
    id: 'partlot',
    term: 'Part lot',
    plain: 'A single lot split into separate pieces, usually by a road or a creek.',
    inData: 'Lot class 2 in cadastre.lot. Still one lot, drawn as more than one shape.',
    example: 'A farm lot cut by a public road',
    drawn: false,
  },
  {
    id: 'property',
    term: 'Property',
    plain: 'What the Valuer General values and councils rate: one or more lots held together. A strata scheme counts as one property.',
    inData: 'propid. In cadastre.property the polygon is repeated once per address, so count DISTINCT propid.',
    example: 'One house built across two lots is one property',
    drawn: true,
  },
  {
    id: 'address',
    term: 'Address string',
    plain: 'One written address. Every unit, shop or car space with its own address gets its own row, which makes it the finest level in the data.',
    inData: 'One row per address in guras.addressstring, keyed by msoid.',
    example: '1/90 DENNING STREET SOUTH COOGEE',
    drawn: true,
  },
  {
    id: 'primary',
    term: 'Primary and secondary address',
    plain: 'A property\'s main street address is primary. Unit addresses on the same property are secondary. Alternates are other names for the same place.',
    inData: 'principaladdresstype: 1 primary, 2 secondary, 3 alternate.',
    example: '90 Denning Street is primary, 1/90 to 6/90 are secondary',
    drawn: false,
  },
  {
    id: 'point',
    term: 'Address point',
    plain: 'Where an address sits on the map, normally inside its lot.',
    inData: 'One point per address in guras.addresspoint.',
    example: 'The dot inside the building at 88-90 Foveaux Street',
    drawn: true,
  },
  {
    id: 'access',
    term: 'Waypoint and access line',
    plain: 'The spot on the road where you reach the address, joined to the address point by a line.',
    inData: 'guras.waypoint holds the road-side point, guras.proway the line between it and the address point.',
    example: 'Useful for which street a lot actually faces',
    drawn: true,
  },
]

// ── Tables ───────────────────────────────────────────────────────────────────

export const TABLES: TableDoc[] = [
  {
    id: 'cadastre.lot',
    schema: 'cadastre',
    tables: ['lot'],
    label: 'lot',
    title: 'Lots',
    oneRowIs: 'one lot of land',
    plain: 'The shape of every lot in NSW. A strata scheme appears once, as the land the whole building sits on.',
    geometry: 'polygon',
    keys: [
      { name: 'cadid', meaning: 'The lot\'s identifier. The reliable key for joining other tables to a lot.', example: '104406282' },
      { name: 'lotidstring', meaning: 'The lot reference as text, lot/section/plan. Strata sites have no lot number.', example: '17//DP10140, //SP67869' },
    ],
    useful: [
      { name: 'planlabel, lotnumber, sectionnumber', meaning: 'The lot reference in parts.' },
      { name: 'classsubtype', meaning: 'Standard lot, part lot, strata site or stratum lot.' },
      { name: 'planlotarea', meaning: 'The area written on the plan, when the plan states one.' },
      { name: 'itstitlestatus', meaning: 'Whether the lot has a current title, is old system, cancelled, and so on.' },
      { name: 'hasstratum, stratumlevel', meaning: 'Whether the lot has height limits, and at which level.' },
      { name: 'urbanity', meaning: 'U urban, S semi-rural, R rural.' },
      { name: 'startdate, lastupdate', meaning: 'When this version of the lot began and was last changed.' },
    ],
    watchOuts: [
      'Strata units are not here. A 53-unit building is one row.',
      'lganame, councilname and the other code columns at the end of the table are empty. Find the council with a spatial join.',
      'Join on cadid rather than building a lotidstring. Strata units registered on a later plan still carry the original site\'s cadid.',
    ],
  },
  {
    id: 'cadastre.property',
    schema: 'cadastre',
    tables: ['property'],
    label: 'property',
    title: 'Properties',
    oneRowIs: 'one address on a valuation property',
    plain: 'The land the Valuer General values as one holding, drawn as the lots dissolved together. The same polygon is repeated once for every address on the property.',
    geometry: 'polygon',
    keys: [
      { name: 'propid', meaning: 'The property identifier. Many rows share one propid when a property has several addresses.', example: '2853170' },
      { name: 'addressstringoid', meaning: 'Which address this row is. Joins to guras.addressstring.msoid.', example: '5830687' },
    ],
    useful: [
      { name: 'address, housenumber', meaning: 'The address written out, including a unit prefix like 405/88-90.' },
      { name: 'principaladdresstype', meaning: '1 primary, 2 secondary, 3 alternate.' },
      { name: 'valnetpropertytype', meaning: 'Normal property, strata, or a strata scheme.' },
      { name: 'valnetlotcount', meaning: 'How many lots the property is made of. For a strata scheme, how many strata lots.' },
    ],
    watchOuts: [
      'Count properties with DISTINCT propid. Counting rows counts addresses.',
      'There is no lot number on this table. Use guras.propertylot to reach lots.',
    ],
  },
  {
    id: 'guras.addressstring',
    schema: 'guras',
    tables: ['addressstring'],
    label: 'addressstring',
    title: 'Address strings',
    oneRowIs: 'one address',
    plain: 'Every address in NSW, split into its parts. This is the finest level: each unit, shop and car space with an address of its own is a row.',
    geometry: 'none',
    keys: [
      { name: 'msoid', meaning: 'The address identifier. Every other table points at this.', example: '5830687' },
      { name: 'propid', meaning: 'The property the address belongs to. For a strata unit, the whole scheme.', example: '2853170' },
      { name: 'sppropid', meaning: 'Empty for an ordinary address. For a strata unit, the unit\'s own property id. Equal to propid for the scheme\'s street address.', example: '2907295' },
    ],
    useful: [
      { name: 'address', meaning: 'The address written out.' },
      { name: 'unittype, unitnumber, leveltype, levelnumber', meaning: 'The unit and level parts. unittype is free text: U, UNIT and APARTMENT all occur.' },
      { name: 'housenumberfirst, housenumbersecond', meaning: 'The street number, and the end of a range like 88-90.' },
      { name: 'roadname, roadtype, suburbname, postcode', meaning: 'The street and place.' },
      { name: 'addresssitename, buildingname', meaning: 'A building or site name, when there is one.' },
      { name: 'officialaddressstringoid', meaning: 'The property\'s main address. Rolls every unit up to its building.' },
      { name: 'principaladdresssiteoid', meaning: 'Groups all the addresses on one site.' },
      { name: 'gnafprimarysiteid', meaning: 'A link to the national G-NAF address file, for about one address in five.' },
      { name: 'contributororigin', meaning: 'Who supplied the address: council, valuation, G-NAF, Australia Post and so on.' },
    ],
    watchOuts: [
      'Several addresses can have exactly the same text, for example five car-space lots all written 501/88-90 FOVEAUX STREET. Use msoid, never the text, as the key.',
      'Use msoid, not objectid. objectid is a different number sequence.',
      'The code columns at the end of the table, lganame to wbcode, are empty.',
    ],
  },
  {
    id: 'guras.propertylot',
    schema: 'guras',
    tables: ['propertylot'],
    label: 'propertylot',
    title: 'Property lots',
    oneRowIs: 'one lot that belongs to one property',
    plain: 'The bridge between addresses and land. It says which lots make up each property, and for strata, which strata lot each unit is.',
    geometry: 'none',
    keys: [
      { name: 'propid', meaning: 'The property, matching guras.addressstring.propid.' },
      { name: 'sppropid', meaning: 'The strata unit\'s property id, matching guras.addressstring.sppropid. Empty for ordinary lots.' },
      { name: 'propidtype', meaning: '1 a lot of an ordinary property, 2 a strata unit lot, 3 strata common property.' },
      { name: 'cadid', meaning: 'The lot polygon in cadastre.lot. For strata rows, the whole site.' },
    ],
    useful: [
      { name: 'planlabel, lotnumber, sectionnumber', meaning: 'The title lot reference. lotnumber is CP for common property.' },
      { name: 'ptlotsecpn', meaning: 'The same reference as one string, for example SP/38//67869.' },
      { name: 'propertyoid', meaning: 'Groups the rows of one property.' },
    ],
    watchOuts: [
      'A few strata lots were created by a later strata plan inside an existing scheme, so their plan label differs from the site\'s. Their cadid still leads to the right polygon.',
    ],
  },
  {
    id: 'guras.addresspoint',
    schema: 'guras',
    tables: ['addresspoint'],
    label: 'addresspoint',
    title: 'Address points',
    oneRowIs: 'where one address sits',
    plain: 'A map point for every address, normally inside the lot.',
    geometry: 'point',
    keys: [
      { name: 'addressstringoid', meaning: 'The address, matching guras.addressstring.msoid.' },
      { name: 'msoid', meaning: 'The point\'s own id, which the access line refers to.' },
    ],
    useful: [
      { name: 'addresspointtype', meaning: 'Placed on the property, a unit, a building, or other.' },
      { name: 'containment', meaning: 'Whether the point is known to be inside its property.' },
    ],
    watchOuts: [
      'Its own msoid is not the address id. Join addresses on addressstringoid.',
    ],
  },
  {
    id: 'guras.waypoint',
    schema: 'guras',
    tables: ['waypoint'],
    label: 'waypoint',
    title: 'Waypoints',
    oneRowIs: 'the road-side access spot for one address',
    plain: 'The point on the road where you reach an address.',
    geometry: 'point',
    keys: [
      { name: 'msoid', meaning: 'The waypoint\'s id, which the access line refers to.' },
      { name: 'addresspointoid', meaning: 'The address point it serves.' },
    ],
    useful: [
      { name: 'derivedby', meaning: 'Calculated for urban or rural addresses, or placed in the field.' },
    ],
    watchOuts: [],
  },
  {
    id: 'guras.proway',
    schema: 'guras',
    tables: ['proway'],
    label: 'proway',
    title: 'Access lines',
    oneRowIs: 'the line from one address point to its waypoint',
    plain: 'A short line joining an address to the road it is reached from. Its length is the distance from the road.',
    geometry: 'line',
    keys: [
      { name: 'addresspointoid', meaning: 'The address point at one end, matching guras.addresspoint.msoid.' },
      { name: 'waypointoid', meaning: 'The waypoint at the other end, matching guras.waypoint.msoid.' },
    ],
    useful: [
      { name: 'roadside', meaning: 'Which side of the road the address is on.' },
    ],
    watchOuts: [],
  },
  {
    id: 'integrated_address.point_address',
    schema: 'integrated_address',
    tables: ['point_address'],
    label: 'point_address',
    title: 'Integrated addresses',
    oneRowIs: 'one address on one lot',
    plain: 'The address and parcel tables already joined by NSW Spatial Services, with a formatted address, the lot reference, and statistical and electoral areas.',
    geometry: 'point',
    keys: [
      { name: 'ss_addressstringoid', meaning: 'The address, matching guras.addressstring.msoid.' },
      { name: 'lot_cadid', meaning: 'The lot, matching cadastre.lot.cadid. Stored as a number, so cast it to text to join.' },
    ],
    useful: [
      { name: 'formattedaddress', meaning: 'The address as it would be printed on a letter.' },
      { name: 'cadastralidentifier', meaning: 'The title lot reference, per unit for strata: 38//SP67869, CP//SP998.' },
      { name: 'lganame', meaning: 'The council. The only filled council column across these downloads.' },
      { name: 'mb_code_2021, sa1_code_2021 to sa4_name_2021', meaning: 'ABS mesh block and statistical areas, also for 2026.' },
      { name: 'stateelectoraldistrict, federalelectoraldivision', meaning: 'State and federal electorates.' },
    ],
    watchOuts: [
      'An address covering two lots appears twice. Match on both the address and the lot.',
      'Spatial Services describes the service as a prototype.',
    ],
  },
  {
    id: 'integrated_address.point_address_unique',
    schema: 'integrated_address',
    tables: ['point_address_unique'],
    label: 'point_address_unique',
    title: 'Integrated addresses, one per address',
    oneRowIs: 'one address',
    plain: 'The same as point_address, collapsed to one row per address, with the lot references gathered into lists.',
    geometry: 'point',
    keys: [
      { name: 'ss_addressstringoid', meaning: 'The address, matching guras.addressstring.msoid.' },
    ],
    useful: [
      { name: 'cadastralidentifier_list, lot_cadid_list', meaning: 'Every lot the address covers, as lists.' },
    ],
    watchOuts: [
      'Lists are text, so joining to lots is easier from point_address.',
    ],
  },
  {
    id: 'cadastre.other',
    schema: 'cadastre',
    tables: ['road', 'roadcorridor', 'roadcentreline', 'railwaycorridor', 'easement', 'watermark', 'waterfeature', 'waterfeaturecorridor', 'authorityreference', 'unidentified'],
    label: 'roads, rail, water',
    title: 'Other parcel layers',
    oneRowIs: 'one road, rail, water or easement shape',
    plain: 'The parcels that are not ordinary lots: road parcels and corridors, road centre lines, rail corridors, easements, water features and tidal lines.',
    geometry: 'mixed',
    keys: [
      { name: 'cadid', meaning: 'The parcel identifier, the same kind as on lots.' },
    ],
    useful: [
      { name: 'roadnamelabel', meaning: 'The road name on corridors and centre lines.' },
      { name: 'roadwidth', meaning: 'The surveyed width on road parcels, where recorded.' },
      { name: 'easementtype, easementwidth', meaning: 'What an easement is for, and how wide.' },
    ],
    watchOuts: [
      'Roads and easements relate to lots by position only. There is no key between them.',
    ],
  },
  {
    id: 'epi.layers',
    schema: 'epi',
    tables: [],
    label: '56 layer tables',
    title: 'Planning layers',
    oneRowIs: 'one area a planning control applies to',
    plain: 'The maps behind planning instruments. Each layer is a set of areas with a control attached, such as a zone, a height limit or a heritage item. One table can hold several layers, so the table count is not the layer count.',
    geometry: 'mixed',
    keys: [
      { name: 'epi_name', meaning: 'The instrument the map belongs to, for example Randwick Local Environmental Plan 2012.' },
      { name: 'lay_name', meaning: 'Which layer the row belongs to. A table can hold many, so this is the layer key, not the table name.' },
      { name: 'label, lay_class', meaning: 'The control the row carries: a zone name, a height band, a heritage item. Most layers also have a column of their own, such as fsr or max_b_h.' },
    ],
    useful: [
      { name: 'sym_code', meaning: 'The short code behind the control, on the layers that have one. It is empty on more layers than it is set, so it cannot be relied on as the control.' },
      { name: 'lga_name', meaning: 'The council the map covers. Layers that apply state-wide have no council column at all.' },
      { name: 'legis_ref_clause', meaning: 'The clause of the instrument the map serves.' },
      { name: 'published_date, commenced_date, amendment', meaning: 'When the map took effect, and by which amendment.' },
    ],
    watchOuts: [
      'Planning layers relate to lots by position only. Intersect a lot with a layer to find its controls.',
      'A lot on a zone boundary can fall in two zones. Compare overlap areas rather than taking the first match.',
      'The table name is not the layer name. Several tables hold layers their name does not suggest, and reading by table alone hides them.',
      'lay_name is free text, so one layer is often spelled several ways, and on some layers it is blank. Empty is written three ways: NULL, an empty string, and the text <Null>.',
      'A published_date of 1899-12-30 is a sentinel for no date, not a real date.',
      'Almost every layer is polygon. Heritage points and strategic foreshore sites are points.',
    ],
  },
]

export const EPI_GROUPS: { title: string; plain: string; tables: string[] }[] = [
  {
    title: 'Zoning and land use',
    plain: 'What may be built or done on the land.',
    tables: ['epi_land_zoning', 'epi_additional_permitted_uses', 'epi_key_sites', 'epi_land_reclassification', 'epi_land_reservation_acquisition'],
  },
  {
    title: 'Built form',
    plain: 'How big, how tall and how dense development may be.',
    tables: ['epi_height_of_building', 'epi_floor_space_ratio', 'epi_lot_size', 'epi_dwelling_density', 'epi_gross_floor_area', 'epi_reduced_level', 'epi_active_street_frontages', 'epi_foreshore_building_line'],
  },
  {
    title: 'Heritage',
    plain: 'Items and areas protected for their heritage value.',
    tables: ['epi_heritage', 'epi_heritage_points'],
  },
  {
    title: 'Environment and hazards',
    plain: 'Natural values to protect and risks to plan around.',
    tables: [
      'epi_flood', 'epi_acid_sulfate_soils', 'epi_riparian_lands_watercourses', 'epi_terrestrial_biodiversity', 'epi_wetlands',
      'epi_wetlands_protection_area', 'epi_landslide_risk', 'epi_salinity', 'epi_groundwater_vulnerability', 'epi_scenic_protection',
      'epi_native_veg_protection', 'epi_environmental_cons_area', 'epi_environmentally_sensitive_land', 'epi_drinking_water_catchments',
      'epi_critical_habitat', 'epi_geotechnical', 'epi_bulk_water_supply', 'epi_water_zoning', 'epi_csg_exclusions',
      'epi_mineral_and_extractive', 'epi_strategic_agricultural_land', 'epi_noise_exposure_forecast', 'epi_obstacle_limitation_surface',
    ],
  },
  {
    title: 'Growth areas and special provisions',
    plain: 'Release areas, precincts and places with their own rules.',
    tables: [
      'epi_urban_release_area', 'epi_growth_centres', 'epi_industrial_release_area', 'epi_future_residential_growth_area',
      'epi_additional_rural_village_land', 'epi_precinct_boundaries', 'epi_lease_area', 'epi_special_areas', 'epi_special_provision',
      'epi_local_provisions', 'epi_state_significant_dev_sites', 'epi_strategic_foreshore_sites_points', 'epi_local_exempt_exclusion',
      'epi_local_complying_exclusion', 'epi_referral_area', 'epi_transport_arterial_rd_infra',
    ],
  },
  {
    title: 'Reference',
    plain: 'Where each instrument applies, and its map sheets.',
    tables: ['epi_land_application', 'epi_map_tiles'],
  },
]

/**
 * The table name is not the layer name.
 *
 * Every epi table is a container, and the layer a row belongs to is lay_name.
 * Most tables hold one layer and are named after it, but some hold dozens, and
 * a few hold layers their name gives no hint of: the Transport Oriented
 * Development, Town Centre, Low and Mid Rise exclusion and Greenfield Housing
 * Code maps all live inside epi_land_application. Counting tables therefore
 * understates what is mapped - the 56 tables carry a little over 500 distinct
 * layers between them.
 *
 * Read from the loaded data on 16 September 2026. Row counts are deliberately
 * absent: the page takes those live from the load log.
 */
export const EPI_LAYER_NOTE = 'Each table holds one or more layers, keyed by lay_name. Some hold dozens, and some hold layers their name gives no hint of, so the table list below is not the layer list. Open a layer to see what is inside it.'

export const EPI_LAYERS: Record<string, EpiLayerDoc> = {
  epi_land_zoning: {
    contains: 'Zone names in lay_class and the zone code in sym_code: Public Recreation, Environmental Conservation, Infrastructure, the residential and rural zones. purpose names what a reserved zone is for, such as Classified Road or Educational Establishment.',
    watchOut: 'Almost every row belongs to one layer, Zone. A handful are Original SEPP Zones.',
  },
  epi_additional_permitted_uses: {
    contains: 'apu_code points at the Schedule 1 item that permits the use. lay_class is usually Dwelling or a pointer to Schedule 1.',
    watchOut: 'Two rows in five carry no layer name at all.',
  },
  epi_key_sites: {
    contains: 'Named sites and the clause that governs them, with keysite_id where the instrument numbers them.',
    buried: ['Homebush TOD Precinct', 'Additional Permitted Uses', 'Medium Density Site'],
    watchOut: 'lay_class is the site or clause name, so it is close to unique per row and cannot be grouped.',
  },
  epi_land_reclassification: {
    contains: 'Operational Land or Community Land, the two classes under the Local Government Act.',
  },
  epi_land_reservation_acquisition: {
    contains: 'What land is reserved for and who will acquire it: lra_type holds the purpose, authority the acquiring body, usually Council, Transport for NSW or the former RMS.',
    watchOut: 'Its layer names are zone names rather than reservation names, including Public Recreation, Low Density Residential, Village, School and Car Park.',
  },
  epi_height_of_building: {
    contains: 'max_b_h is the limit, units says whether that is metres or a reduced level, and lay_class puts it in a band.',
    watchOut: 'Sixteen spellings of one layer, thirteen of them different ways of writing RL. One of them measures storeys rather than metres, so read units and not the name.',
  },
  epi_floor_space_ratio: {
    contains: 'fsr is the ratio and lay_class bands it. A lay_class of CA marks a ratio set by a clause instead of a number, and those rows have no fsr.',
    watchOut: 'It covers about half the councils: rural plans generally set no floor space ratio at all, so the gap is real and not a loading fault. One row is misfiled from the height layer, and one spelling reads Ration.',
  },
  epi_lot_size: {
    contains: 'lot_size is the minimum and units says whether it is square metres or hectares.',
    watchOut: 'Eight spellings of one layer. One of them is in hectares, so read units rather than the layer name.',
  },
  epi_dwelling_density: {
    contains: 'min_dwelling_density in dwellings per hectare, and restricted_lot_yield where a cap applies instead.',
    watchOut: 'Nearly half the rows carry no layer name.',
  },
  epi_gross_floor_area: {
    contains: 'A floor area cap in square metres, carried in lay_class and label rather than a column of its own.',
  },
  epi_reduced_level: {
    contains: 'A height expressed as a reduced level above the datum.',
  },
  epi_active_street_frontages: {
    contains: 'Frontages that have to stay active at ground level. Some rows only point at the clause instead of naming the control.',
  },
  epi_foreshore_building_line: {
    contains: 'The line beyond which building is restricted, and the foreshore area it protects.',
  },
  epi_heritage: {
    contains: 'h_id is the item number the instrument uses, h_name the item itself, sig its significance (Local, State, National) and lay_class the kind: general item, archaeological, landscape, or conservation area.',
    watchOut: 'Its earliest published_date is the 1899-12-30 sentinel, not a real date.',
  },
  epi_heritage_points: {
    contains: 'Sydney Harbour heritage points. One of only two point layers in the schema.',
  },
  epi_flood: {
    contains: 'Flood prone land, flood planning areas and modelled extents, in the councils that map them.',
    watchOut: 'Most rows belong to a layer named Development Control Map rather than anything flood-named.',
  },
  epi_acid_sulfate_soils: {
    contains: 'Class 1 to Class 5, plus the 2a and 2b subclasses and a buffer area.',
  },
  epi_riparian_lands_watercourses: {
    contains: 'Watercourses and the riparian land beside them, some graded Category 1 to 3.',
    watchOut: 'Twenty-two layer names, most of them permutations of riparian land, watercourse and waterway.',
  },
  epi_terrestrial_biodiversity: {
    contains: 'Biodiversity land, sensitive areas, habitat corridors and steep-slope constraints, with comments naming the vegetation.',
    buried: ['Natural Resource', 'Environmentally Sensitive Areas', 'Sensitive Land'],
    watchOut: 'The largest table in the schema, and most of its rows carry no layer name. It fuses a dozen differently-named council layers into one table.',
  },
  epi_wetlands: {
    contains: 'Mapped wetlands, with a few councils adding waterways and the Macquarie Marshes.',
  },
  epi_wetlands_protection_area: {
    contains: 'Wetlands protection areas.',
    watchOut: 'This table loaded with no rows. Check the source before concluding the state maps nothing.',
  },
  epi_landslide_risk: {
    contains: 'Landslide risk land, graded by slope in the councils that map it.',
    watchOut: 'Six councils only, and nothing published into it since 2019.',
  },
  epi_salinity: {
    contains: 'Saline and erodible land.',
    buried: ['Soils and Slopes', 'Natural Resources Land'],
    watchOut: 'Its largest layer is named Soils and Slopes, not salinity.',
  },
  epi_groundwater_vulnerability: {
    contains: 'Land over vulnerable groundwater.',
    watchOut: 'Three rows in five carry no layer name.',
  },
  epi_scenic_protection: {
    contains: 'Scenic and landscape values, escarpments and protected vistas.',
  },
  epi_native_veg_protection: {
    contains: 'Native vegetation that has to be retained.',
  },
  epi_environmental_cons_area: {
    contains: 'Conservation areas, wetlands, grasslands and woodlands.',
  },
  epi_environmentally_sensitive_land: {
    contains: 'Land flagged as environmentally sensitive, under five different names for much the same thing.',
  },
  epi_drinking_water_catchments: {
    contains: 'Drinking water catchments and the special areas inside them.',
  },
  epi_critical_habitat: {
    contains: 'Critical habitat declared under the threatened species legislation.',
    watchOut: 'This table loaded with no rows. Check the source before concluding the state maps nothing.',
  },
  epi_geotechnical: {
    contains: 'Alpine resort geotechnical areas, named by resort.',
  },
  epi_bulk_water_supply: {
    contains: 'Bulk water supply infrastructure in the Western Sydney Parklands.',
  },
  epi_water_zoning: {
    contains: 'Sydney Harbour water zones: environment protection, scenic waters, water recreation and naval waters.',
  },
  epi_csg_exclusions: {
    contains: 'Coal seam gas exclusion land: residential zones, buffer areas, future residential growth areas and critical industry clusters.',
    watchOut: 'lga_name exists on this table but is empty on every row.',
  },
  epi_mineral_and_extractive: {
    contains: 'Identified and potential mineral and extractive resource land.',
    buried: ['SEPP Land Application'],
  },
  epi_strategic_agricultural_land: {
    contains: 'Biophysical strategic agricultural land, and the viticulture and equine critical industry clusters.',
  },
  epi_noise_exposure_forecast: {
    contains: 'ANEF contours around airports, banded upward from 20 to 25.',
  },
  epi_obstacle_limitation_surface: {
    contains: 'Airport obstacle limitation surfaces. minimum_height and maximum_height carry the surface and height_range describes it.',
    watchOut: 'lay_class is often just the height as a number, so it reads as hundreds of distinct classes.',
  },
  epi_urban_release_area: {
    contains: 'Urban release areas and their sectors and buffers.',
  },
  epi_growth_centres: {
    contains: 'The growth centre boundaries, with precinct and area_ha.',
  },
  epi_industrial_release_area: {
    contains: 'Industrial release areas in the Western Sydney Employment Area.',
  },
  epi_future_residential_growth_area: {
    contains: 'Future residential growth areas under the mining and petroleum policy.',
  },
  epi_additional_rural_village_land: {
    contains: 'Additional rural village land under the mining and petroleum policy.',
  },
  epi_precinct_boundaries: {
    contains: 'Growth centre precinct boundaries.',
  },
  epi_lease_area: {
    contains: 'The three port lease areas: Newcastle, Kembla and Botany.',
  },
  epi_special_areas: {
    contains: 'Named special areas in the growth centres, each with its own rule.',
  },
  epi_special_provision: {
    contains: 'Strategic conservation areas, avoided land, seagrass proximity and certified urban capable land, with area_ha where the provision is sized.',
    watchOut: 'Seventy-five layer names over a small table: these are one-off provisions, not a vocabulary.',
  },
  epi_local_provisions: {
    contains: 'Every local clause that has a map but no table of its own: slope limits, constrained and vulnerable land, dwelling opportunity, landscape area, lot averaging. class_description carries the control and suggested_category sorts it.',
    watchOut: 'The catch-all of the schema, with more layer names and classes than any other table, and a suggested_category of Miscellaneous on four rows in five.',
  },
  epi_state_significant_dev_sites: {
    contains: 'State significant development sites, named by precinct.',
    buried: ['SEPP Land Application'],
  },
  epi_strategic_foreshore_sites_points: {
    contains: 'Strategic foreshore sites in the Sydney Harbour catchment. The other point layer in the schema.',
  },
  epi_local_exempt_exclusion: {
    contains: 'Land where the council excludes exempt development.',
  },
  epi_local_complying_exclusion: {
    contains: 'Land where the council excludes complying development.',
    watchOut: 'Nothing has been published into it since 2021.',
  },
  epi_referral_area: {
    contains: 'Referral areas, where an application has to be referred to another authority.',
    watchOut: 'This table loaded with no rows. Check the source before concluding the state maps nothing.',
  },
  epi_transport_arterial_rd_infra: {
    contains: 'Arterial road infrastructure.',
    watchOut: 'This table loaded with no rows. Check the source before concluding the state maps nothing.',
  },
  epi_land_application: {
    contains: 'Where each instrument applies. Most rows are a plain land-application boundary, but the table has become the home for whole policies that never got a table of their own.',
    buried: ['Transport Oriented Development Area', 'Accelerated TOD Precinct', 'Low and Mid Rise Housing Exclusion Area', 'Town Centre', 'Greenfield Housing Code Area', 'Short-term Rental Accommodation Area', 'Darkinjung LALC Land', 'Allowable Clearing', 'Renewables Zone', 'Strategic Foreshore Sites Map', 'Sydney Opera House Buffer Zone', 'Cockle Creek Smelter Land'],
    watchOut: 'Searching for a control by table name will not find any of the layers above. Filter on lay_name. One layer is named singleton, which reads like a slip for the Singleton council area.',
  },
  epi_map_tiles: {
    contains: 'The map sheet index: map_sheet, map_scale and lep_type for each printed sheet of each instrument.',
    watchOut: 'It carries no layer name or class at all, and its earliest published_date is the 1899-12-30 sentinel. This is an index of paper sheets, not a planning control.',
  },
}

// ── Joins ────────────────────────────────────────────────────────────────────

/** Layer table name → the group it is shown under, from EPI_GROUPS. */
export const EPI_LAYER_GROUP: Record<string, string> = Object.fromEntries(
  EPI_GROUPS.flatMap(g => g.tables.map(t => [t, g.title])),
)

/** Titles that reading the table name would get wrong. */
const EPI_TITLE_OVERRIDES: Record<string, string> = {
  epi_csg_exclusions: 'Coal seam gas exclusions',
  epi_transport_arterial_rd_infra: 'Arterial road infrastructure',
  epi_land_application: 'Where the plan applies',
  epi_map_tiles: 'Map sheets',
  epi_state_significant_dev_sites: 'State significant development sites',
  epi_local_exempt_exclusion: 'Exempt development exclusions',
  epi_local_complying_exclusion: 'Complying development exclusions',
  epi_environmental_cons_area: 'Environmental conservation area',
  epi_native_veg_protection: 'Native vegetation protection',
  epi_riparian_lands_watercourses: 'Riparian land and watercourses',
  epi_obstacle_limitation_surface: 'Obstacle limitation surface',
  epi_noise_exposure_forecast: 'Aircraft noise exposure',
  epi_additional_rural_village_land: 'Additional rural village land',
  epi_strategic_foreshore_sites_points: 'Strategic foreshore sites',
  epi_heritage_points: 'Heritage points',
  epi_reduced_level: 'Reduced level',
}

/** "epi_height_of_building" → "Height of building". */
export function epiLayerTitle(table: string): string {
  const override = EPI_TITLE_OVERRIDES[table]
  if (override) return override
  const words = table.replace(/^epi_/, '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const JOINS: JoinDoc[] = [
  {
    id: 'property-address',
    from: { table: 'cadastre.property', column: 'addressstringoid' },
    to: { table: 'guras.addressstring', column: 'msoid' },
    cardinality: '1 : 1',
    label: 'addressstringoid',
    plain: 'Each property row is one address, so it points at exactly one address string.',
    checks: ['property-address-string'],
  },
  {
    id: 'address-unit-lot',
    from: { table: 'guras.addressstring', column: 'sppropid' },
    to: { table: 'guras.propertylot', column: 'sppropid' },
    when: 'the address is a strata unit (sppropid differs from propid) and propidtype = 2',
    cardinality: '1 : 1',
    label: 'sppropid',
    plain: 'A unit address leads to its own strata lot. This is how unit 405 becomes lot 38 in SP67869.',
    checks: ['unit-address-unit-lot'],
  },
  {
    id: 'address-common-property',
    from: { table: 'guras.addressstring', column: 'propid' },
    to: { table: 'guras.propertylot', column: 'propid' },
    when: 'the address is the scheme\'s own address (sppropid equals propid) and propidtype = 3',
    cardinality: '1 : 1',
    label: 'propid',
    plain: 'A strata building\'s street address leads to its common property.',
  },
  {
    id: 'address-lots',
    from: { table: 'guras.addressstring', column: 'propid' },
    to: { table: 'guras.propertylot', column: 'propid' },
    when: 'the address is ordinary (sppropid is empty) and propidtype = 1',
    cardinality: '1 : many',
    label: 'propid',
    plain: 'An ordinary address leads to every lot of its property. A house built across two lots returns both.',
    checks: ['address-property-link'],
  },
  {
    id: 'propertylot-lot',
    from: { table: 'guras.propertylot', column: 'cadid' },
    to: { table: 'cadastre.lot', column: 'cadid' },
    cardinality: 'many : 1',
    label: 'cadid',
    plain: 'Every property lot finds its polygon. All the units of a strata scheme land on the same site polygon.',
    checks: ['lot-polygon-ordinary', 'lot-polygon-unit', 'lot-polygon-cp'],
  },
  {
    id: 'property-propertylot',
    from: { table: 'cadastre.property', column: 'propid' },
    to: { table: 'guras.propertylot', column: 'propid' },
    cardinality: 'many : many',
    label: 'propid',
    plain: 'Property rows repeat per address and property lots repeat per lot, so joining them directly multiplies rows. Take DISTINCT propid on one side first.',
  },
  {
    id: 'addresspoint-address',
    from: { table: 'guras.addresspoint', column: 'addressstringoid' },
    to: { table: 'guras.addressstring', column: 'msoid' },
    cardinality: '1 : 1',
    label: 'addressstringoid',
    plain: 'Each address has one map point.',
    checks: ['address-point'],
  },
  {
    id: 'proway-addresspoint',
    from: { table: 'guras.proway', column: 'addresspointoid' },
    to: { table: 'guras.addresspoint', column: 'msoid' },
    cardinality: '1 : 1',
    label: 'addresspointoid',
    plain: 'The access line starts at the address point.',
  },
  {
    id: 'proway-waypoint',
    from: { table: 'guras.proway', column: 'waypointoid' },
    to: { table: 'guras.waypoint', column: 'msoid' },
    cardinality: '1 : 1',
    label: 'waypointoid',
    plain: 'The access line ends at the waypoint on the road.',
  },
  {
    id: 'integrated-address',
    from: { table: 'integrated_address.point_address', column: 'ss_addressstringoid' },
    to: { table: 'guras.addressstring', column: 'msoid' },
    cardinality: 'many : 1',
    label: 'ss_addressstringoid',
    plain: 'The integrated service has one row per address and lot, so an address on two lots appears twice.',
  },
  {
    id: 'integrated-lot',
    from: { table: 'integrated_address.point_address', column: 'lot_cadid' },
    to: { table: 'cadastre.lot', column: 'cadid' },
    when: 'cast lot_cadid to text',
    cardinality: 'many : 1',
    label: 'lot_cadid',
    plain: 'The integrated service names the same lot polygon directly.',
    checks: ['integrated-agrees'],
  },
  {
    id: 'unique-address',
    from: { table: 'integrated_address.point_address_unique', column: 'ss_addressstringoid' },
    to: { table: 'guras.addressstring', column: 'msoid' },
    cardinality: '1 : 1',
    label: 'ss_addressstringoid',
    plain: 'The collapsed version has exactly one row per address.',
  },
  {
    id: 'epi-lot',
    from: { table: 'epi.layers', column: 'geom' },
    to: { table: 'cadastre.lot', column: 'geom' },
    when: 'the shapes overlap (ST_Intersects)',
    cardinality: 'spatial',
    label: 'overlap',
    plain: 'Planning controls attach to land by position. Intersect a lot with a layer to read its zone, height or heritage.',
  },
  {
    id: 'other-lot',
    from: { table: 'cadastre.other', column: 'geom' },
    to: { table: 'cadastre.lot', column: 'geom' },
    when: 'the shapes touch or overlap',
    cardinality: 'spatial',
    label: 'touch',
    plain: 'A lot fronts a road where their shapes share an edge.',
  },
]

/** The query that takes any address to its lot polygon, as the page shows it. */
export const ADDRESS_TO_LOT_SQL = `SELECT a.msoid, a.address,
       pl.planlabel, pl.lotnumber, pl.sectionnumber,
       l.lotidstring AS polygon_lot, l.geom
FROM guras.addressstring a
JOIN guras.propertylot pl
  ON pl.propid = a.propid
 AND (   (a.sppropid IS NOT NULL AND a.sppropid <> a.propid
          AND pl.propidtype = 2 AND pl.sppropid = a.sppropid)  -- strata unit
      OR (a.sppropid = a.propid AND pl.propidtype = 3)         -- scheme address
      OR (a.sppropid IS NULL AND pl.propidtype = 1))           -- ordinary address
JOIN cadastre.lot l ON l.cadid = pl.cadid
WHERE a.address = '1/90 DENNING STREET SOUTH COOGEE';`

// ── Codes ────────────────────────────────────────────────────────────────────

export const CODE_LISTS: CodeList[] = [
  {
    field: 'propidtype',
    where: 'guras.propertylot',
    values: [
      { code: '1', label: 'Lot of an ordinary property' },
      { code: '2', label: 'Strata unit lot' },
      { code: '3', label: 'Strata common property' },
    ],
  },
  {
    field: 'classsubtype',
    where: 'cadastre.lot',
    values: [
      { code: '1', label: 'Standard lot' },
      { code: '2', label: 'Standard part lot' },
      { code: '3', label: 'Strata site' },
      { code: '4', label: 'Stratum lot' },
    ],
  },
  {
    field: 'principaladdresstype',
    where: 'guras.addressstring, cadastre.property',
    values: [
      { code: '1', label: 'Primary' },
      { code: '2', label: 'Secondary' },
      { code: '3', label: 'Alternate' },
      { code: '4', label: 'Unknown' },
    ],
  },
  {
    field: 'valnetpropertytype',
    where: 'cadastre.property',
    values: [
      { code: '1', label: 'Not valued' },
      { code: '2', label: 'Normal' },
      { code: '3', label: 'Strata' },
      { code: '4', label: 'Strata scheme' },
    ],
    note: 'Empty on about a quarter of rows, where the property has no valuation record.',
  },
  {
    field: 'itstitlestatus',
    where: 'cadastre.lot',
    values: [
      { code: '0', label: 'Undefined' },
      { code: '1', label: 'Current title' },
      { code: '2', label: 'Manual volume and folio' },
      { code: '3', label: 'Old system' },
      { code: '4', label: 'Untitled' },
      { code: '5', label: 'Acquired land' },
      { code: '6', label: 'Title pending' },
      { code: '7', label: 'Cancelled' },
      { code: '8', label: 'Cancelled, residue remains' },
      { code: '9', label: 'Dummy' },
      { code: '10', label: 'Consolidated title of several lots' },
    ],
  },
  {
    field: 'addresspointtype',
    where: 'guras.addresspoint',
    values: [
      { code: '1', label: 'Property' },
      { code: '2', label: 'Unit or strata' },
      { code: '3', label: 'Building' },
      { code: '10', label: 'Other' },
    ],
  },
  {
    field: 'containment',
    where: 'guras.addresspoint, guras.addressstring',
    values: [
      { code: '1', label: 'Inside its property' },
      { code: '2', label: 'Outside its property' },
      { code: '3', label: 'Unknown' },
    ],
  },
  {
    field: 'addressstringtype',
    where: 'guras.addressstring',
    values: [
      { code: '1', label: 'Official' },
      { code: '3', label: 'Assigned' },
      { code: '4', label: 'Verified' },
    ],
    note: 'Almost every address is assigned. Code 2 occurs on a few rows and has no published label.',
  },
  {
    field: 'contributororigin',
    where: 'guras tables',
    values: [
      { code: '1', label: 'Council' },
      { code: '2', label: 'Valuation (ValNet)' },
      { code: '3', label: 'Crown' },
      { code: '4', label: 'G-NAF' },
      { code: '6', label: 'GURAS' },
      { code: '8', label: 'Department of Housing' },
      { code: '9', label: 'RAAF' },
      { code: '10', label: 'Australia Post' },
      { code: '11', label: 'GURAS app' },
      { code: '12', label: 'Cadastre' },
      { code: '13', label: 'Complex address' },
    ],
  },
  {
    field: 'derivedby',
    where: 'guras.waypoint',
    values: [
      { code: '1', label: 'Calculated, urban' },
      { code: '2', label: 'Calculated, rural' },
      { code: '3', label: 'Placed in the field, rural' },
    ],
  },
  {
    field: 'urbanity',
    where: 'cadastre tables',
    values: [
      { code: 'U', label: 'Urban' },
      { code: 'S', label: 'Semi-rural' },
      { code: 'R', label: 'Rural' },
    ],
  },
]

// ── Accuracy ─────────────────────────────────────────────────────────────────

/** The address-to-lot rule, for a table aliased `a` joined to propertylot aliased `pl`. */
const ROUTE = `((a.sppropid IS NOT NULL AND a.sppropid <> a.propid AND pl.propidtype = 2 AND pl.sppropid = a.sppropid)
   OR (a.sppropid = a.propid AND pl.propidtype = 3)
   OR (a.sppropid IS NULL AND pl.propidtype = 1))`

export const QUALITY_GROUPS: Record<QualityCheck['group'], string> = {
  links: 'Do the tables connect?',
  shapes: 'Does every lot have a shape?',
  places: 'Is every address on the map, in the right place?',
  agreement: 'Do independent sources agree?',
}

export const QUALITY_CHECKS: QualityCheck[] = [
  {
    id: 'property-address-string',
    group: 'links',
    title: 'Property rows find their address',
    question: 'Does every address on a valuation property exist in the address table?',
    sql: `SELECT count(a.msoid) AS numerator, count(*) AS denominator
FROM cadastre.property p
LEFT JOIN guras.addressstring a ON a.msoid = p.addressstringoid`,
    good: 0.995,
    poor: 0.97,
    explain: 'The parcel and address tables come from separate downloads, so a small number of property addresses have no matching address string.',
    baseline: { numerator: 4220236, denominator: 4224206, measuredAt: '2026-09-16' },
  },
  {
    id: 'address-property-link',
    group: 'links',
    title: 'Addresses belong to a property with lots',
    question: 'Can every address be tied to the lots of its property?',
    sql: `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM guras.propertylot pl WHERE pl.propid = a.propid)) AS numerator,
       count(*) AS denominator
FROM guras.addressstring a`,
    good: 0.99,
    poor: 0.95,
    explain: 'Addresses without property lots skew new: about four in ten were created in the last three years, against fewer than one in ten of all addresses. They occur in towns and in the country alike. Where one has an address point, the lot under the point finds the land.',
    baseline: { numerator: 4259343, denominator: 4307198, measuredAt: '2026-09-16' },
  },
  {
    id: 'unit-address-unit-lot',
    group: 'links',
    title: 'Unit addresses find their strata lot',
    question: 'Does every strata unit address know which strata lot it is?',
    sql: `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM guras.propertylot pl
                                     WHERE pl.sppropid = a.sppropid AND pl.propidtype = 2)) AS numerator,
       count(*) AS denominator
FROM guras.addressstring a
WHERE a.sppropid IS NOT NULL AND a.sppropid <> a.propid`,
    good: 0.995,
    poor: 0.97,
    explain: 'Almost half of the misses were created in the last three years, and about four in ten belong to a scheme with no lot records at all in this download. The address was registered before the strata title reached the property records.',
    baseline: { numerator: 1024160, denominator: 1025815, measuredAt: '2026-09-16' },
  },
  {
    id: 'lot-polygon-ordinary',
    group: 'shapes',
    title: 'Ordinary lots have a shape',
    question: 'Does every lot of an ordinary property appear in the lot map?',
    sql: `SELECT count(l.cadid) AS numerator, count(*) AS denominator
FROM guras.propertylot pl
LEFT JOIN cadastre.lot l ON l.cadid = pl.cadid
WHERE pl.propidtype = 1`,
    good: 0.99,
    poor: 0.95,
    explain: 'The missing shapes skew to new subdivisions: one in five was created in the last year, against about one in thirty of the lots that have a shape. The lot map catches up in a later download.',
    baseline: { numerator: 3327443, denominator: 3413427, measuredAt: '2026-09-16' },
  },
  {
    id: 'lot-polygon-unit',
    group: 'shapes',
    title: 'Strata units land on a site shape',
    question: 'Does every strata unit lead to the shape of the land its building sits on?',
    sql: `SELECT count(l.cadid) AS numerator, count(*) AS denominator
FROM guras.propertylot pl
LEFT JOIN cadastre.lot l ON l.cadid = pl.cadid
WHERE pl.propidtype = 2`,
    good: 0.99,
    poor: 0.95,
    explain: 'The misses are strata sites that are not in the lot map of this download. The unit itself never has a shape of its own.',
    baseline: { numerator: 1020822, denominator: 1028003, measuredAt: '2026-09-16' },
  },
  {
    id: 'lot-polygon-cp',
    group: 'shapes',
    title: 'Strata schemes have a site shape',
    question: 'Does every strata scheme\'s common property lead to a site shape?',
    sql: `SELECT count(l.cadid) AS numerator, count(*) AS denominator
FROM guras.propertylot pl
LEFT JOIN cadastre.lot l ON l.cadid = pl.cadid
WHERE pl.propidtype = 3`,
    good: 0.99,
    poor: 0.95,
    explain: 'The misses are strata sites that are not in the lot map of this download.',
    baseline: { numerator: 89035, denominator: 89300, measuredAt: '2026-09-16' },
  },
  {
    id: 'address-lot-polygon',
    group: 'shapes',
    title: 'Addresses reach a lot shape',
    question: 'Starting from an address, how often does the chain of tables end at a lot shape?',
    sql: `SELECT count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM guras.propertylot pl JOIN cadastre.lot l ON l.cadid = pl.cadid
         WHERE pl.propid = a.propid AND ${ROUTE})) AS numerator,
       count(*) AS denominator
FROM guras.addressstring a`,
    good: 0.98,
    poor: 0.93,
    explain: 'This combines the gaps above: addresses without a property, and lots not yet drawn. Falling back to the lot under the address point closes nearly all of it.',
    baseline: { numerator: 4211632, denominator: 4307198, measuredAt: '2026-09-16' },
  },
  {
    id: 'address-point',
    group: 'places',
    title: 'Addresses have a map point',
    question: 'Is every address placed on the map?',
    sql: `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM guras.addresspoint ap WHERE ap.addressstringoid = a.msoid)) AS numerator,
       count(*) AS denominator
FROM guras.addressstring a`,
    good: 0.99,
    poor: 0.95,
    explain: 'Nearly all the addresses without a point are primary addresses. About half of them also have no property lots, and they skew new, so the two gaps tend to close together.',
    baseline: { numerator: 4251006, denominator: 4307198, measuredAt: '2026-09-16' },
  },
  {
    id: 'point-in-lot',
    group: 'places',
    title: 'Address points sit inside their lot',
    question: 'When an address has both a point and a lot, is the point inside the lot?',
    sql: `WITH s AS (SELECT msoid, propid, sppropid FROM guras.addressstring WHERE msoid % 20 = 0),
j AS (
  SELECT a.msoid, bool_or(ST_Intersects(l.geom, ap.geom)) AS inside
  FROM s a
  JOIN guras.propertylot pl ON pl.propid = a.propid AND ${ROUTE}
  JOIN cadastre.lot l ON l.cadid = pl.cadid
  JOIN guras.addresspoint ap ON ap.addressstringoid = a.msoid
  GROUP BY 1)
SELECT count(*) FILTER (WHERE inside) AS numerator, count(*) AS denominator FROM j`,
    sample: 'one address in 20',
    good: 0.99,
    poor: 0.95,
    explain: 'About four in five of the points outside are on strata buildings, placed on the building a few metres beyond the site boundary. The containment field already marks nearly all of them as outside.',
    baseline: { numerator: 209615, denominator: 210301, measuredAt: '2026-09-16' },
  },
  {
    id: 'integrated-agrees',
    group: 'agreement',
    title: 'The integrated service names the same lot',
    question: 'When both the address tables and the integrated service know an address, do they give it the same lot?',
    sql: `WITH al AS (
  SELECT a.msoid, pl.cadid
  FROM guras.addressstring a
  JOIN guras.propertylot pl ON pl.propid = a.propid AND ${ROUTE}
  WHERE a.msoid % 10 = 0)
SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM integrated_address.point_address ia
                                     WHERE ia.ss_addressstringoid = al.msoid AND ia.lot_cadid::text = al.cadid)) AS numerator,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM integrated_address.point_address ia
                                     WHERE ia.ss_addressstringoid = al.msoid)) AS denominator
FROM al`,
    sample: 'one address in 10',
    good: 0.98,
    poor: 0.93,
    explain: 'Nearly every disagreement is on a lot that the address tables name but the lot map has not drawn yet, where the integrated service names a different lot. Where both lots are drawn, the two sources agree.',
    baseline: { numerator: 519636, denominator: 522656, measuredAt: '2026-09-16' },
  },
]

// ── Address counts ───────────────────────────────────────────────────────────

export interface CountPart {
  label: string
  count: number
  plain: string
  /** Rows or addresses that are not part of the address count itself. */
  extra?: boolean
}

export interface AddressCountTable {
  table: string
  oneRowIs: string
  rows: number
  addresses: number
}

/**
 * Why derived.lot_address (built by the "02C - Lot profile with frontage"
 * notebook) holds more rows than the integrated service has addresses, but
 * fewer addresses. A dated snapshot, not a live figure: the queries take
 * minutes state-wide, so they are shown for re-running by hand after a rebuild.
 */
export const ADDRESS_COUNTS: {
  measuredAt: string
  tables: AddressCountTable[]
  rows: CountPart[]
  coverage: CountPart[]
  howToCount: string[]
  sql: string
} = {
  measuredAt: '2026-09-17',
  tables: [
    { table: 'integrated_address.point_address_unique', oneRowIs: 'one address', rows: 4251007, addresses: 4251006 },
    { table: 'integrated_address.point_address', oneRowIs: 'one address on one lot', rows: 5239045, addresses: 4251006 },
    { table: 'derived.lot_address', oneRowIs: 'one address on one lot, and every lot', rows: 5220506, addresses: 4211641 },
  ],
  rows: [
    { label: 'One row for each address', count: 4211641, plain: 'Each address counted once, whichever lot it is on.' },
    { label: 'More rows for addresses on several lots', count: 988640, extra: true, plain: 'An ordinary address gets a row for every lot of its property, such as a house built across three lots. About 243,000 addresses cover more than one lot. The integrated service does the same, which is why point_address is 988,039 rows longer than the unique table.' },
    { label: 'Lots with no property', count: 14653, extra: true, plain: 'link_method lot_only, msoid empty. Kept so that every lot appears at least once.' },
    { label: 'Property lots with no matching address', count: 5562, extra: true, plain: 'The lot belongs to a property, but no address of that property matches the lot\'s kind. msoid is empty.' },
    { label: 'Duplicate rows', count: 10, extra: true, plain: 'The same address and lot twice, reached through two kinds of property lot.' },
  ],
  coverage: [
    { label: 'In both', count: 4209027, plain: 'The integrated service and lot_address both have the address.' },
    { label: 'Only in the integrated service', count: 41979, plain: 'The address has a map point but no property lot that is drawn in the lot map. lot_address starts from lots and reaches an address only through its property lots, so it leaves these out.' },
    { label: 'Only in lot_address', count: 2614, plain: 'The address reaches a lot but has no map point. The integrated service only lists addresses that have a point.' },
    { label: 'In neither', count: 53578, plain: 'No map point, and no property lot that is drawn.' },
  ],
  howToCount: [
    'Count addresses with count(DISTINCT msoid), never count(*).',
    'To show each address once, keep one lot per msoid, for example the lot its address point falls in.',
    'is_primary_address marks a property\'s primary address (principal type 1). It does not pick one row per address.',
    'Compare lot_address with point_address, which has the same grain, not with point_address_unique.',
    'Taking the lot under the address point when no property lot is drawn should bring in most of the 41,979 missing addresses. That has not been measured on lot_address yet.',
  ],
  sql: `-- rows of derived.lot_address, by kind
SELECT link_method, msoid IS NULL AS no_address, count(*), count(DISTINCT cadid)
FROM derived.lot_address GROUP BY 1, 2;

-- addresses, address-lot pairs and duplicates
SELECT count(*) AS pairs, sum(n) AS address_rows, count(DISTINCT msoid) AS addresses, sum(n - 1) AS duplicate_rows
FROM (SELECT msoid, cadid, count(*) AS n FROM derived.lot_address
      WHERE msoid IS NOT NULL GROUP BY 1, 2) p;

-- which addresses each side has
WITH l AS (SELECT DISTINCT msoid FROM derived.lot_address WHERE msoid IS NOT NULL),
     u AS (SELECT DISTINCT ss_addressstringoid AS msoid FROM integrated_address.point_address)
SELECT count(*) FILTER (WHERE l.msoid IS NOT NULL AND u.msoid IS NOT NULL) AS in_both,
       count(*) FILTER (WHERE l.msoid IS NULL) AS integrated_only,
       count(*) FILTER (WHERE u.msoid IS NULL) AS lot_address_only
FROM l FULL JOIN u ON u.msoid = l.msoid;`,
}

export const LIMITATIONS: Limitation[] = [
  {
    id: 'epi-layer-key',
    title: 'A planning layer table can hold many layers',
    plain: 'The layer a row belongs to is lay_name, not the table it sits in. epi_land_application alone carries the Transport Oriented Development, Town Centre, Low and Mid Rise exclusion and Greenfield Housing Code maps.',
    impact: 'Reading a control by table name misses layers, and counting tables understates what is mapped.',
    workaround: 'Filter on lay_name. The layer list above names the layers each table hides.',
  },
  {
    id: 'epi-layer-names',
    title: 'Layer names are free text',
    plain: 'One layer is often spelled several ways. The building height layer has sixteen spellings, thirteen of them ways of writing RL, and minimum lot size has eight.',
    impact: 'Grouping by lay_name splits one layer into many. One lot size spelling is in hectares rather than square metres, so the name cannot be trusted for units either.',
    workaround: 'Group on the value column and its units column, never on the layer name.',
  },
  {
    id: 'epi-unnamed-rows',
    title: 'Some layer rows carry no layer name',
    plain: 'On the biodiversity, groundwater, dwelling density and additional permitted use layers a large share of rows have no lay_name. Empty is written three ways: NULL, an empty string, and the text <Null>.',
    impact: 'Those rows drop out of any grouping or filter on the layer name.',
    workaround: 'Normalise all three forms to NULL first, then fall back to lay_class or label.',
  },
  {
    id: 'epi-partial-controls',
    title: 'Not every council maps every control',
    plain: 'Floor space ratio covers about half the councils and building height about three in five. The ones missing are rural: their plans set no such control.',
    impact: 'A lot in those councils returns no height or floor space ratio.',
    workaround: 'Treat an absent control as absent rather than as a gap to be filled.',
  },
  {
    id: 'unit-shapes',
    title: 'Strata units have no shape',
    plain: 'A unit\'s boundaries are its walls, floor and ceiling. They exist only on the registered strata plan drawings, not as map data.',
    impact: 'Every unit in a building maps to the same site polygon.',
    workaround: 'Use the site shape for anything about the land. Use the unit lot reference for anything about ownership.',
  },
  {
    id: 'new-lots',
    title: 'New lots can reach the property records before the map',
    plain: 'When land is subdivided, the property and address records often update before the lot map is redrawn.',
    impact: 'A small share of lot references have no shape yet. See "Ordinary lots have a shape" above.',
    workaround: 'Fall back to the lot under the address point, and expect the gap to close at the next download.',
  },
  {
    id: 'later-strata-plans',
    title: 'Some strata lots come from a later plan',
    plain: 'An existing scheme can be subdivided again by a new strata plan. Those lots carry the new plan number but sit in the original building.',
    impact: 'Building a lot reference from the plan label finds no shape. At 88-90 Foveaux Street, lots 54 and 55 of SP74478 sit inside SP67869.',
    workaround: 'Join lots on cadid, which still points at the original site.',
  },
  {
    id: 'no-property',
    title: 'Some addresses have no valuation property',
    plain: 'Most were supplied through the valuation system but have no property record in this download. They skew new, and they occur in towns and in the country alike.',
    impact: 'The address cannot be tied to lots through the property records.',
    workaround: 'Use the lot under the address point when there is one. Fewer than half of these addresses have a point.',
  },
  {
    id: 'point-outside',
    title: 'An address point can fall outside its lot',
    plain: 'Points outside their lot are mostly on strata buildings, placed on the building a few metres beyond the site boundary. Measured on 16 September 2026, the typical distance outside was about 6 metres.',
    impact: 'A lookup by position can miss the site and land on the footpath or a neighbouring lot.',
    workaround: 'Prefer the property link. A containment value of 2 marks nearly all of these points.',
  },
  {
    id: 'overlaps',
    title: 'A few lots overlap',
    plain: 'The lot map is a clean jigsaw almost everywhere. Checked across the whole state on 15 September 2026, 92 pairs of lots overlapped by more than a square metre, and 9 by more than 100.',
    impact: 'The large overlaps are three-dimensional stratum lots over ground lots, which is correct, and a few newer rural plans drawn over older lots that were not yet retired.',
    workaround: 'Expect one lot per point. When two come back, prefer the one that is not a stratum lot.',
  },
  {
    id: 'duplicate-text',
    title: 'Different addresses can read the same',
    plain: 'Car spaces and storage lots are often given the unit number of the apartment they belong to.',
    impact: 'At 88-90 Foveaux Street, five separate lots are all written 501/88-90.',
    workaround: 'Key on msoid and the lot reference, never on the address text.',
  },
  {
    id: 'empty-columns',
    title: 'Council and code columns are empty',
    plain: 'lganame, councilname, abscode, ltocode, vgcode and wbcode are present on the parcel and address tables but hold nothing.',
    impact: 'Filtering by council on those tables returns nothing.',
    workaround: 'Take the council and ABS areas from the integrated service, or intersect with a council boundary.',
  },
  {
    id: 'free-text',
    title: 'Unit types are free text',
    plain: 'The same kind of unit is written several ways: U, UNIT, APARTMENT, APT.',
    impact: 'Grouping by unit type splits one category into many.',
    workaround: 'Group by whether a unit number exists, or normalise the common spellings first.',
  },
  {
    id: 'snapshots',
    title: 'The four downloads are separate snapshots',
    plain: 'Each file is downloaded on its own day. The live SIX Maps services can also run a few rows ahead of or behind the files.',
    impact: 'A lot or address that changed between downloads can disagree across tables.',
    workaround: 'Check the source dates in the freshness table. Reload all four together when consistency matters.',
  },
  {
    id: 'strata-value',
    title: 'Strata land is valued once for the whole scheme',
    plain: 'The Valuer General gives one land value for a strata scheme, which is then shared across units by unit entitlement.',
    impact: 'There is no separate land value per unit in these tables.',
    workaround: 'Read land value at the scheme\'s propid and apportion it if needed.',
  },
]

/** Freshness bands, in days since the source file was produced. */
export const FRESHNESS = { good: 45, poor: 120 }

// ── Address trace (what /api/datasources/nsw-address returns) ────────────────

export type AddressKind = 'strata-unit' | 'strata-scheme' | 'ordinary'

export interface AddressMatch {
  id: number
  address: string
  kind: AddressKind
}

export interface TraceLot {
  cadid: string
  lotidstring: string
  classsubtype: number | null
  planLotArea: number | null
  areaM2: number | null
  containsPoint: boolean | null
  geometry: GeoJsonGeometry
}

export interface GeoJsonGeometry {
  type: string
  coordinates: any
}

export interface AddressTrace {
  address: {
    msoid: number
    address: string
    housenumber: string | null
    unitType: string | null
    unitNumber: number | null
    road: string | null
    suburb: string | null
    postcode: number | null
    council: string | null
    siteName: string | null
    principalType: number | null
    contributorOrigin: number | null
    propid: number
    sppropid: number | null
    officialAddress: string | null
    siteId: number | null
    gnafSiteId: number | null
  }
  kind: AddressKind
  property: {
    found: boolean
    addressRows: number
    primaryAddress: string | null
    valnetType: number | null
    valnetLotCount: number | null
    areaM2: number | null
  }
  propertyLotCounts: { ordinary: number; unit: number; common: number }
  links: {
    propidtype: number
    planlabel: string | null
    lotnumber: string | null
    sectionnumber: string | null
    titleLotId: string
    cadid: string | null
    hasShape: boolean
  }[]
  /** 'property' when the lots came through the property records, 'point' when from the lot under the address point. */
  lotSource: 'property' | 'point' | 'none'
  lots: TraceLot[]
  neighbours: GeoJsonGeometry[]
  point: {
    lon: number
    lat: number
    pointType: number | null
    containment: number | null
    accessMetres: number | null
    waypoint: { lon: number; lat: number; derivedBy: number | null } | null
  } | null
  integrated: {
    formattedAddress: string | null
    cadastralIdentifier: string | null
    lotCadid: string | null
    lga: string | null
    sa1: string | null
    sa2Name: string | null
    meshBlock: string | null
    stateElectorate: string | null
    federalDivision: string | null
  }[]
  siblings: {
    total: number
    rows: { msoid: number; address: string; unitNumber: number | null; principalType: number | null; lot: string | null }[]
  }
}

// ── Lot trace (what /api/datasources/nsw-lot returns) ────────────────────────

export interface LotMatch {
  cadid: string
  lotidstring: string
  /** Set when the reference typed is a title lot with no shape, and this is the land it sits on. */
  note: string | null
}

export interface LotTrace {
  lot: {
    cadid: string
    lotidstring: string
    planlabel: string | null
    lotnumber: string | null
    sectionnumber: string | null
    classsubtype: number | null
    hasstratum: number | null
    stratumlevel: number | null
    itstitlestatus: number | null
    planLotArea: number | null
    planLotAreaUnits: string | null
    urbanity: string | null
    startDate: string | null
    areaM2: number | null
    perimeterM: number | null
    geometry: GeoJsonGeometry
  }
  propertyLotCounts: { ordinary: number; unit: number; common: number }
  properties: { propid: number; address: string | null; valnetType: number | null; valnetLotCount: number | null; areaM2: number | null }[]
  addresses: {
    total: number
    rows: { msoid: number; address: string; unitNumber: number | null; principalType: number | null; titleLot: string | null }[]
  }
  pointsInside: number
  /** The planning layers that cover the lot, most of the lot first. */
  controls: {
    key: string
    label: string
    group: string
    values: { value: string | null; unit: string | null; note: string | null; instrument: string | null; share: number | null }[]
  }[]
  /** Every other layer: checked against this lot and not covering it. */
  otherLayers: { key: string; label: string; group: string; empty: boolean }[]
  neighbours: GeoJsonGeometry[]
}
