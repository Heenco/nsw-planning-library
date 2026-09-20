/**
 * Build `lmr.layers` - the catalogue of every layer /lmr can draw, and where each one came from.
 *
 *   node scripts/build-lmr-layers.mjs [--dry-run]
 *
 * WHY THIS EXISTS
 *
 * /lmr draws two sets of layers from two different builds, and until now neither was described in the
 * database. The lmr schema's tables carry a COMMENT each - good prose, but the page can only show its
 * first sentence, and nothing says which provision a layer serves or whether it is an exclusion at all.
 * The 37 SEPP land application layers were described nowhere: the tile manifest gives a count and an
 * extent, and the source, the currency of the data and the caveats lived only in a memory note. This
 * table is the answer to "where did this layer come from, when, and what does it do to a result".
 *
 * WHAT IS IN IT, AND WHAT IS MEASURED RATHER THAN WRITTEN DOWN
 *
 *   half = 'constraint'  the 26 tables of the lmr schema (21 drawn, 4 held for the rule checks but drawn
 *                        from the SEPP archive instead, 1 isochrone cache).
 *   half = 'sepp'        the 37 SEPP land application layers of epi.epi_land_application, as the
 *                        sepp-land-application archive tiles them.
 *
 * Counts, SRIDs, geometry types and `source_date` are read from the data at build time, never copied
 * from a comment: `source_date` comes from each table's own currency column (currency_date, verdate,
 * date_downloaded, fetched_at), so it is the currency of the DATA, not of our copy. `loaded_at` is when
 * that copy was taken. Only the things no query can answer - what a layer is for, which provision it
 * serves, and the caveat - are hand-written in LMR_CONSTRAINTS below.
 *
 * Re-run after a tile build, an epi reload, or any refresh of the lmr schema.
 */

import 'dotenv/config'
import pg from 'pg'
import { firstSentence, manifest, tableFacts, writeCatalogue } from './lib/layer-catalogue.mjs'

const DRY = process.argv.includes('--dry-run')
const TILE_BASE = process.env.NUXT_SEPP_PMTILES_BASE || 'http://172.105.184.178/pmtiles'

const GROUPS = {
  'lmr': { title: 'Low and Mid Rise housing', order: 1 },
  'housing': { title: 'Stations and catchments', order: 2 },
  'zoning': { title: 'Land zoning', order: 3 },
  'heritage': { title: 'Heritage', order: 4 },
  'hazards': { title: 'Bushfire and flood', order: 5 },
  'coastal': { title: 'Coastal', order: 6 },
  'noise': { title: 'Noise and pipelines', order: 7 },
  'sepp-housing': { title: 'Housing SEPP, other layers', order: 8 },
  'sepp-precincts': { title: 'Precincts SEPPs', order: 9 },
  'sepp-environment': { title: 'Environment and hazards', order: 10 },
  'sepp-systems': { title: 'Systems, infrastructure and codes', order: 11 },
}

const EPI_GDB = 'All_EPI_Data_Geodatabase_GDA94_10092026.zip (GEODAAS All-EPI geodatabase; the epi load was swapped in 2026-09-15)'
const EPI_CAVEAT = 'A copy, not a view: 01A replaces epi with DROP SCHEMA epi CASCADE, so re-run the copy after an epi reload.'
const EPLANNING = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services'

/**
 * The curated half, one entry per table of the lmr schema. `key` is the table name, which is also the
 * tile layer_key. `sourceDateSql` and `loadedAtSql` are aggregates over that table, so a refresh moves
 * the date without anyone editing this file.
 */
const LMR_CONSTRAINTS = [
  {
    key: 'epi_land_zoning', title: 'Land zoning (LEP and SEPP maps)', grp: 'zoning', kind: 'inclusion',
    clause: 'Housing SEPP ch 6 - the zones chapter 6 applies in',
    role: 'The inclusion side of the policy: chapter 6 applies in R1, R2, R3 and R4 - 8,141 of these polygons across 157 plans.',
    sourceKind: 'epi', source: `epi.epi_land_zoning - ${EPI_GDB}`,
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-18',
    caveat: `283 of the source polygons are invalid. ${EPI_CAVEAT}`,
  },
  {
    key: 'lmr_train_stations', title: 'LMR Station', grp: 'housing', kind: 'context',
    clause: 'Housing SEPP Sch 11 - the nominated stations',
    role: 'The 59 station entries of the Department\'s 171 nominated locations; the points the 400 m and 800 m catchments are walked from.',
    sourceKind: 'download',
    source: 'NSW Spatial Services NSW_FOI_Transport_Facilities/MapServer/1 (Train Station), matched to the Department\'s LMRTrainStations.xlsx',
    sourceUrl: 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/MapServer/1',
    filter: 'the station-only entries of the 171 nominated locations; the other 112 are town centres',
    sourceDateSql: 'max(foi_lastupdate)::date', loadedAt: '2026-09-17',
    caveat: 'One FOI point per station, not its entrances. The SEPP measures walking distance from a public entrance '
      + '(for a light rail stop with none, from a platform), so at a large station the catchment starts a little off. '
      + 'Westmead has both a railway station and a light rail stop, so the match is on mode as well as name.',
  },
  {
    key: 'station_walking_catchments', title: 'Station walking catchments (400 m, 800 m)', grp: 'housing', kind: 'inclusion',
    clause: 'Housing SEPP ch 6 - within 800 m walking distance of a nominated station',
    role: 'The 400 m and 800 m walk from each of the 59 stations: the shape the residential zones are then cut to.',
    sourceKind: 'mapbox', source: 'Mapbox Isochrone API (walking, generalize=0) from lmr.lmr_train_stations',
    sourceUrl: 'https://api.mapbox.com/isochrone/v1/mapbox/walking',
    sourceDateSql: 'max(fetched_at)::date', loadedAtSql: 'max(fetched_at)::date',
    caveat: 'Walking distance is not mapped by the law. This is Mapbox\'s road network on the day of the build, so a '
      + 'rebuild can move a boundary. Built by scripts/build-lmr-walking.py, cached in lmr.walking_isochrone_origin.',
  },
  {
    key: 'town_centre_walking_catchments', title: 'Town centre walking catchments (400 m, 800 m)', grp: 'housing', kind: 'inclusion',
    clause: 'Housing SEPP ch 6 - within 800 m walking distance of a town centre',
    role: 'The 400 m and 800 m walk from the EDGE of each town centre: isochrones from points every 100 m along every '
      + 'boundary ring, unioned with each other and with the centre itself.',
    sourceKind: 'mapbox', source: 'Mapbox Isochrone API (walking, generalize=0) from lmr.sepp_town_centres',
    sourceUrl: 'https://api.mapbox.com/isochrone/v1/mapbox/walking',
    sourceDateSql: 'max(fetched_at)::date', loadedAtSql: 'max(fetched_at)::date',
    caveat: 'As for the station catchments. The geom column is declared plain `geometry` with no SRID typmod, so '
      + 'geometry_columns reports SRID 0 for it although every row is GDA94 - the srid here is measured from the data.',
  },
  {
    key: 'shr_curtilage', title: 'State Heritage Register curtilage', grp: 'heritage', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - land that is or contains a State Heritage Register item',
    role: 'The land each State Heritage Register listing covers.',
    sourceKind: 'download', source: 'ePlanning Planning_Portal_Principal_Planning/MapServer/221 (Heritage NSW)',
    sourceUrl: `${EPLANNING}/ePlanning/Planning_Portal_Principal_Planning/MapServer/221`,
    sourceDateSql: 'max(verdate)::date', loadedAt: '2026-09-17',
    caveat: '1,825 polygons for 1,814 listings. The service returns VERDATE under the alias VerDate, so field keys have '
      + 'to be matched case-insensitively or every feature comes back looking cut down. rundate is an Excel zero (1899-12-30), '
      + 'so verdate is the date to trust.',
  },
  {
    key: 'epi_heritage_items', title: 'Heritage items (LEP maps)', grp: 'heritage', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - land that is or contains a heritage item',
    role: 'Every heritage class of the LEP and SEPP heritage maps except conservation areas.',
    sourceKind: 'epi', source: `epi.epi_heritage - ${EPI_GDB}`,
    filter: "lay_class NOT ILIKE '%Conservation Area%'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: 'Includes 57 Aboriginal place / Aboriginal object rows and "Local Heritage - General", which are not '
      + `heritage items by the Standard Instrument definition. ${EPI_CAVEAT}`,
  },
  {
    key: 'epi_heritage_conservation_areas', title: 'Heritage conservation areas', grp: 'heritage', kind: 'context',
    clause: 'Housing SEPP ch 6 - NOT an exclusion',
    role: 'Held and drawn for contrast: chapter 6 still applies inside a heritage conservation area. Only items are excluded.',
    sourceKind: 'epi', source: `epi.epi_heritage - ${EPI_GDB}`,
    filter: "lay_class ILIKE '%Conservation Area%'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: EPI_CAVEAT,
  },
  {
    key: 'bushfire_prone_land', title: 'Bush fire prone land', grp: 'hazards', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - bush fire prone land, every category and the buffer',
    role: 'RFS bush fire prone land: Vegetation Category 1, 2 and 3 and the Vegetation Buffer, all four excluded.',
    sourceKind: 'urbanportaldbp', source: 'NSW RFS bush fire prone land, via UrbanPortalDBP urbanportaldbp.nsw_bush_fire_prone_lands',
    sourceDateSql: 'to_timestamp(max(verdate) / 1000)::date', loadedAt: '2026-09-17',
    caveat: 'SRID 4326 where the rest of the schema is GDA94 - transform the lot into this layer, never this layer into '
      + 'the lot, or the GiST index is lost. Two other cuts of the same dataset sit in UrbanPortalDBP (518,436 rows with '
      + 'updates to 2024-07-19, and an ePlanning-column copy); against the 2024 one this load has about half the Buffer '
      + 'area and 59% of the Category 2 area, which is remapping rather than truncation.',
  },
  {
    key: 'flood_planning', title: 'Flood planning (LEP maps)', grp: 'hazards', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - flood',
    role: 'The flood layers of the LEP and precinct SEPP maps: flood planning area, flood prone and major creeks land, 1 in 100 AEP extent.',
    sourceKind: 'urbanportaldbp', source: 'EPI flood planning maps, via UrbanPortalDBP public."FloodPlanning"',
    sourceDateSql: 'to_timestamp(max(currency_d) / 1000)::date', loadedAt: '2026-09-17',
    caveat: 'Only 14 LEPs and the Central River City and Western Parkland City SEPPs map a flood layer, and none of the '
      + 'four councils holding a nominated location (Cessnock, Newcastle, Port Stephens, Shoalhaven) is among them. '
      + '12 source polygons are invalid. The Georges River and Hawkesbury-Nepean probable maximum flood extents the '
      + 'Department lists are not loaded at all.',
  },
  {
    key: 'flood_sfd_1aep', title: '1% AEP flood extent, first load', grp: 'hazards', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - flood',
    role: 'A state-wide 1% AEP flood extent, first of two loads.',
    sourceKind: 'urbanportaldbp', source: 'UrbanPortalDBP public."flood_sfd_1aep"', loadedAt: '2026-09-17',
    caveat: 'Two loads of the same extent that agree only in part: 86% of seeded sample points inside this one fall '
      + 'inside flood_sfd_1aep_1. This load has more polygons and more of Sydney. Which is authoritative is unsettled, '
      + 'and the provenance upstream of UrbanPortalDBP is not recorded anywhere - union both until it is.',
  },
  {
    key: 'flood_sfd_1aep_1', title: '1% AEP flood extent, second load', grp: 'hazards', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - flood',
    role: 'The same 1% AEP flood extent, second load.',
    sourceKind: 'urbanportaldbp', source: 'UrbanPortalDBP public."flood_sfd_1aep_1"', loadedAt: '2026-09-17',
    caveat: '75% of seeded sample points inside this load fall inside flood_sfd_1aep; it adds 27 polygons west of 144E '
      + 'that the first load lacks. Stored in Web Mercator (3857) where the rest of the schema is GDA94.',
  },
  {
    key: 'sepp_coastal_vulnerability_areas', title: 'Coastal vulnerability areas', grp: 'coastal', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - coastal vulnerability area',
    role: 'The Coastal Vulnerability Area Map of the Resilience and Hazards SEPP.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Resilience and Hazards) 2021' AND map_type = 'CVA'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: 'Only Coffs Harbour (LEP Amendment No 29) and Port Stephens (No 45) are mapped. The live ePlanning services '
      + `return no features and "no map at this time" for this layer; epi has it. ${EPI_CAVEAT}`,
  },
  {
    key: 'sepp_coastal_wetlands', title: 'Coastal wetlands', grp: 'coastal', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - coastal wetland',
    role: 'The wetlands of the Coastal Wetlands and Littoral Rainforests Area Map.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Resilience and Hazards) 2021' AND map_type = 'CW' AND label = 'Coastal Wetlands'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: `One row is classed Land Application rather than Subject Land in the source; it is labelled Coastal Wetlands and kept. ${EPI_CAVEAT}`,
  },
  {
    key: 'sepp_coastal_wetlands_proximity', title: 'Coastal wetlands proximity area', grp: 'coastal', kind: 'context',
    clause: 'Housing SEPP ch 6 - NOT an exclusion',
    role: 'The published proximity area, kept apart from the wetland: the Department lists wetlands, rainforest and '
      + 'vulnerability areas as exclusions, not their proximity areas.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Resilience and Hazards) 2021' AND map_type = 'CW' AND label = 'Coastal Wetlands Proximity Area'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: `70.8M vertices, so the tiles start at zoom 9. ${EPI_CAVEAT}`,
  },
  {
    key: 'sepp_littoral_rainforest', title: 'Littoral rainforest', grp: 'coastal', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - littoral rainforest',
    role: 'The rainforest of the Coastal Wetlands and Littoral Rainforests Area Map.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Resilience and Hazards) 2021' AND map_type = 'LR' AND label = 'Littoral Rainforest'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17', caveat: EPI_CAVEAT,
  },
  {
    key: 'sepp_littoral_rainforest_proximity', title: 'Littoral rainforest proximity area', grp: 'coastal', kind: 'context',
    clause: 'Housing SEPP ch 6 - NOT an exclusion',
    role: 'The published proximity area, not the rainforest itself.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Resilience and Hazards) 2021' AND map_type = 'LR' AND label = 'Littoral Rainforest Proximity Area'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17', caveat: EPI_CAVEAT,
  },
  {
    key: 'airport_noise', title: 'Aircraft noise contours (ANEF / ANEI)', grp: 'noise', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - ANEF 25 / ANEC 20 and above',
    role: 'The aircraft noise contours the exclusion is read off.',
    sourceKind: 'urbanportaldbp', source: 'UrbanPortalDBP public."AirportNoise" - EPI noise maps + Defence ANEF/ANEC + Sydney Airport ANEI',
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: 'Three sources in one table, and the gap is the point: the EPI noise maps cover only Cessnock, Gloucester, '
      + 'Liverpool, Upper Hunter and the Western Parkland City SEPP; the Defence contours are national (Williamtown is '
      + 'spelled "Williamown"); and the Sydney Airport rows are ANEI 20-35, which is MEASURED exposure, not the ANEF '
      + 'forecast the SEPP names. There is no ANEF for Sydney Airport, Bankstown, Camden or Albion Park. The Department '
      + 'gives ANEF 25 / ANEC 20; March-2025 commentaries say 20 for both - unconfirmed against the instrument.',
  },
  {
    key: 'gas_pipelines', title: 'Gas pipelines', grp: 'noise', kind: 'context',
    clause: 'Housing SEPP ch 6 - within 200 m of a licensed pipeline',
    role: 'The pipelines the 200 m buffer is measured from; the buffer, not this layer, is the exclusion.',
    sourceKind: 'urbanportaldbp', source: 'Geoscience Australia / GPinfo Petrosys national pipeline dataset, via UrbanPortalDBP public."Gas_Pipelines"',
    sourceDateSql: "to_date(max(date_downloaded), 'DD-MM-YYYY')", loadedAt: '2026-09-17',
    caveat: 'NOT the register of pipelines licensed under the Pipelines Act 1967 that the SEPP names - `license` here is '
      + 'the data licence (CC BY). National coverage; NSW has 63 operating and 8 proposed, and proposed pipelines are '
      + 'included, so filter on operational_status if the rule should not count them. SRID 4326.',
  },
  {
    key: 'gas_pipelines_buffer_200m', title: 'Gas pipelines, 200 m buffer', grp: 'noise', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - within 200 m of a licensed pipeline',
    role: 'The 200 m the policy excludes, one MultiPolygon per pipeline.',
    sourceKind: 'derived', source: 'lmr.gas_pipelines, buffered 200 m',
    sourceDateSql: "to_date(max(date_downloaded), 'DD-MM-YYYY')", loadedAt: '2026-09-18',
    caveat: 'Buffered in metres in each pipeline\'s own GDA94 MGA zone (chosen by centroid, round ends and joins, 8 '
      + 'segments a quarter circle). Measured edge-to-line geodesic distance is 198.2-200.3 m, median 200.0; the '
      + 'shortfall is MGA scale at the far ends of long pipelines. The Department says 200 m, March-2025 commentaries '
      + 'say 800 m. Rebuild whenever lmr.gas_pipelines is rebuilt.',
  },
  {
    key: 'oil_pipelines', title: 'Oil pipelines (none in NSW)', grp: 'noise', kind: 'context',
    clause: 'Housing SEPP ch 6 - within 200 m of a licensed pipeline',
    role: 'The oil half of the same national dataset.',
    sourceKind: 'urbanportaldbp', source: 'Geoscience Australia / GPinfo Petrosys national pipeline dataset, via UrbanPortalDBP public."Oil_Pipelines"',
    sourceDateSql: "to_date(max(date_downloaded), 'DD-MM-YYYY')", loadedAt: '2026-09-17',
    caveat: 'No oil pipeline in the dataset is in NSW, so this layer and its buffer never catch a NSW lot. Kept whole '
      + '(all of Australia) so the four pipeline layers show the same extent. SRID 4326.',
  },
  {
    key: 'oil_pipelines_buffer_200m', title: 'Oil pipelines, 200 m buffer (none in NSW)', grp: 'noise', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - within 200 m of a licensed pipeline',
    role: 'The 200 m around each oil pipeline, built the same way as the gas buffer.',
    sourceKind: 'derived', source: 'lmr.oil_pipelines, buffered 200 m',
    sourceDateSql: "to_date(max(date_downloaded), 'DD-MM-YYYY')", loadedAt: '2026-09-18',
    caveat: 'Empty for NSW, for the same reason as lmr.oil_pipelines.',
  },

  // ── held in the schema, drawn from the SEPP archive instead ───────────────────────────────────────
  {
    key: 'sepp_lmr_exclusion_areas', title: 'Low and Mid Rise Housing Exclusion Area', grp: 'lmr', kind: 'exclusion',
    clause: 'Housing SEPP ch 6 - the exclusion map',
    role: 'The four precincts chapter 6 is switched off in: Gordon, Lindfield-Killara, Roseville and Croydon North.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Housing) 2021' AND map_type = 'LMX'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: `Not drawn from here: /lmr draws the same rows from the SEPP archive as layer housing_low_and_mid_rise_housing_exclusion_area. Kept in the schema because the rule checks run against it. ${EPI_CAVEAT}`,
  },
  {
    key: 'sepp_tod_areas', title: 'Transport Oriented Development Area', grp: 'lmr', kind: 'exclusion',
    clause: 'Housing SEPP ch 5 - chapter 6 does not apply here',
    role: 'The land in the 28 TOD precincts, one polygon per lot.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Housing) 2021' AND map_type = 'TOD'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: `1 source polygon is invalid. Drawn on /lmr from the SEPP archive as housing_transport_oriented_development_area. ${EPI_CAVEAT}`,
  },
  {
    key: 'sepp_tod_accelerated_precincts', title: 'Accelerated TOD Precinct', grp: 'lmr', kind: 'exclusion',
    clause: 'Housing SEPP ch 5 - chapter 6 does not apply here',
    role: 'The accelerated rezoning precincts; Crows Nest is two polygons.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Housing) 2021' AND map_type = 'ATOD'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: `Drawn on /lmr from the SEPP archive as housing_accelerated_tod_precinct. The deferred TOD stations have no published map anywhere. ${EPI_CAVEAT}`,
  },
  {
    key: 'sepp_town_centres', title: 'Town Centre', grp: 'lmr', kind: 'inclusion',
    clause: 'Housing SEPP ch 6 - the nominated town centres',
    role: 'The town centres a low and mid-rise housing area is measured from - from the EDGE, not the middle. '
      + '116 polygons for 112 names.',
    sourceKind: 'epi', source: `epi.epi_land_application - ${EPI_GDB}`,
    filter: "epi_name = 'State Environmental Planning Policy (Housing) 2021' AND map_type = 'TCR'",
    sourceDateSql: 'max(currency_date)::date', loadedAt: '2026-09-17',
    caveat: `Drawn on /lmr from the SEPP archive as housing_town_centre. ${EPI_CAVEAT}`,
  },
  {
    key: 'walking_isochrone_origin', title: 'Walking isochrone cache', grp: 'housing', kind: 'cache',
    clause: null,
    role: 'One row per origin point per distance: the cache the two catchment layers are unioned out of. Not a layer in its own right.',
    sourceKind: 'mapbox', source: 'Mapbox Isochrone API (walking, generalize=0)',
    sourceUrl: 'https://api.mapbox.com/isochrone/v1/mapbox/walking',
    sourceDateSql: 'max(fetched_at)::date', loadedAtSql: 'max(fetched_at)::date',
    caveat: 'Kept so a catchment can be rebuilt without paying for the isochrones again. Never drawn.',
  },
]

/** The four Housing SEPP layers of the SEPP archive that ARE the low and mid-rise policy. */
const SEPP_LMR = {
  'Transport Oriented Development Area': {
    kind: 'exclusion', clause: 'Housing SEPP ch 5 - chapter 6 does not apply here',
    role: 'Land around the TOD stations. The low and mid-rise provisions do not apply here.',
  },
  'Town Centre': {
    kind: 'inclusion', clause: 'Housing SEPP ch 6 - the nominated town centres',
    role: 'The town centres the 400 m and 800 m walk is measured from, at their edge.',
  },
  'Low and Mid Rise Housing Exclusion Area': {
    kind: 'exclusion', clause: 'Housing SEPP ch 6 - the exclusion map',
    role: 'Land the Housing SEPP maps as excluded from the low and mid rise housing provisions.',
  },
  'Accelerated TOD Precinct': {
    kind: 'exclusion', clause: 'Housing SEPP ch 5 - chapter 6 does not apply here',
    role: 'The accelerated TOD precincts. The low and mid-rise provisions do not apply here.',
  },
}

/** Which panel family a SEPP layer sits in - the same split as familyOf() in shared/lmr-layers.ts. */
function seppGroup(sepp, group) {
  if (group === 'lmr') return 'lmr'
  if (/^Housing\b/.test(sepp)) return 'sepp-housing'
  if (/^Precincts\b/.test(sepp)) return 'sepp-precincts'
  if (/^(Biodiversity|Resilience|Primary Production)\b/.test(sepp)) return 'sepp-environment'
  return 'sepp-systems'
}

const TABLE_COMMENT =
  'One row per layer /lmr can draw, and where it came from. half = \'constraint\' is the lmr schema itself '
  + '(the datasets the Low and Mid-Rise Housing Policy is checked against); half = \'sepp\' is the SEPP land '
  + 'application layers of epi.epi_land_application as the sepp-land-application archive tiles them. kind says '
  + 'what a layer does to a result - an exclusion removes land, an inclusion is part of what the policy applies '
  + 'to, context is drawn to be read against them and changes nothing. source_date is the currency of the DATA, '
  + 'read from each table\'s own currency column; loaded_at is when we copied it. Counts, SRIDs and geometry '
  + 'types are measured at build time. Built by nsw-planning-library/scripts/build-lmr-layers.mjs; re-run after '
  + 'a tile build, an epi reload or any refresh of the lmr schema.'

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
  const client = new pg.Client({ connectionString: dsn, statement_timeout: 600_000 })
  await client.connect()
  const log = s => process.stdout.write(s + '\n')

  try {
    log('reading the tile manifests…')
    const [seppTiles, lmrTiles] = await Promise.all([
      manifest(TILE_BASE, 'sepp-land-application.json'),
      manifest(TILE_BASE, 'lmr-constraints.json'),
    ])
    const drawn = new Map((lmrTiles?.layers ?? []).map(l => [l.key, l]))

    log('measuring the lmr schema…')
    const facts = await tableFacts(client, 'lmr')
    const checkedAt = new Date()
    const rows = []

    // ── the lmr schema ────────────────────────────────────────────────────────────────────────────
    for (const e of LMR_CONSTRAINTS) {
      const f = facts.get(e.key)
      if (!f) { process.stderr.write(`  lmr.${e.key} is in the registry but not in the database\n`); continue }
      const t = drawn.get(e.key)
      const dates = await measureDates(client, 'lmr', e)
      rows.push({
        key: e.key,
        title: e.title,
        grp: e.grp,
        grp_title: GROUPS[e.grp].title,
        grp_order: GROUPS[e.grp].order,
        half: 'constraint',
        kind: e.kind,
        role: e.role,
        clause: e.clause ?? null,
        table_name: `lmr.${e.key}`,
        source_kind: e.sourceKind,
        source: e.source,
        source_url: e.sourceUrl ?? null,
        filter: e.filter ?? null,
        srid: f.srid,
        geom_type: f.geomType,
        features: f.features,
        vertices: t?.vertices ?? null,
        source_date: dates.sourceDate,
        loaded_at: dates.loadedAt,
        tiled: Boolean(t),
        archive: t ? lmrTiles.archive : null,
        min_zoom: t?.minZoom ?? null,
        bbox: t?.bbox ?? null,
        categories: t?.categories ? JSON.stringify(t.categories) : null,
        note: firstSentence(f.comment),
        caveat: e.caveat ?? null,
        checked_at: checkedAt,
      })
    }

    const unregistered = [...facts.keys()].filter(t => t !== 'layers' && !LMR_CONSTRAINTS.some(e => e.key === t))
    if (unregistered.length) process.stderr.write(`  not in the registry, so not catalogued: ${unregistered.join(', ')}\n`)

    // ── the SEPP land application half ────────────────────────────────────────────────────────────
    if (!seppTiles) {
      process.stderr.write('  the SEPP manifest is unreadable, so only the lmr schema half is catalogued\n')
    } else {
      log(`measuring ${seppTiles.layers.length} SEPP land application layers…`)
      const measured = await seppFacts(client)
      for (const l of seppTiles.layers) {
        const lmrLayer = SEPP_LMR[l.layName]
        const grp = seppGroup(l.sepp, l.group)
        const m = measured.get(`${l.epiName} ${l.layName}`)
        rows.push({
          key: l.key,
          title: l.layName,
          grp,
          grp_title: GROUPS[grp].title,
          grp_order: GROUPS[grp].order,
          half: 'sepp',
          kind: lmrLayer?.kind ?? 'context',
          role: lmrLayer?.role
            ?? `The ${l.layName} layer of ${l.sepp}. Drawn on /lmr for context - it is not an input to the low and mid-rise test.`,
          clause: lmrLayer?.clause ?? null,
          table_name: 'epi.epi_land_application',
          source_kind: 'epi',
          source: `epi.epi_land_application - ${EPI_GDB}`,
          source_url: null,
          filter: `epi_name = '${l.epiName.replace(/'/g, "''")}' AND lay_name = '${l.layName.replace(/'/g, "''")}'`,
          srid: m?.srid ?? 4283,
          geom_type: 'polygon',
          features: m?.features ?? l.features,
          vertices: l.vertices ?? null,
          // commenced is the date the mapped provision started; currency_date is the map's own version
          source_date: m?.currencyDate ?? (l.commenced || null),
          loaded_at: seppTiles.source?.loadedAt ? seppTiles.source.loadedAt.slice(0, 10) : null,
          tiled: true,
          archive: seppTiles.archive,
          min_zoom: l.minZoom ?? 0,
          bbox: l.bbox ?? null,
          categories: l.classes ? JSON.stringify(l.classes) : null,
          note: `${l.layName} on the ${l.sepp} maps, covering ${l.lgas || 'no named'} LGA${l.lgas === 1 ? '' : 's'}`
            + `${l.commenced ? `, commenced ${l.commenced}` : ''}.`,
          caveat: lmrLayer
            ? `Also held as a table of the lmr schema for the rule checks. ${EPI_CAVEAT}`
            : EPI_CAVEAT,
          checked_at: checkedAt,
        })
      }
    }

    if (DRY) {
      log(`\n--dry-run: ${rows.length} rows, nothing written.`)
      for (const r of rows) {
        log(`  ${r.half.padEnd(10)} ${r.key.padEnd(56)} ${String(r.kind).padEnd(9)} ${String(r.features ?? '').padStart(7)}  ${r.source_date ? String(r.source_date).slice(0, 10) : '—'.padEnd(10)}  ${r.tiled ? 'tiled' : ''}`)
      }
      return
    }

    const n = await writeCatalogue(client, { schema: 'lmr', comment: TABLE_COMMENT, rows })
    log(`\nlmr.layers: ${n} rows`)
    log(`  ${rows.filter(r => r.half === 'constraint').length} lmr schema, ${rows.filter(r => r.half === 'sepp').length} SEPP land application`)
    log(`  ${rows.filter(r => r.kind === 'exclusion').length} exclusions, ${rows.filter(r => r.kind === 'inclusion').length} inclusions, ${rows.filter(r => !r.tiled).length} not drawn`)
    log(`  ${rows.filter(r => r.caveat).length} carry a caveat`)
  } finally {
    await client.end()
  }
}

/** source_date and loaded_at, measured from the table's own date columns where the registry names one. */
async function measureDates(client, schema, entry) {
  const parts = []
  if (entry.sourceDateSql) parts.push(`(${entry.sourceDateSql}) AS source_date`)
  if (entry.loadedAtSql) parts.push(`(${entry.loadedAtSql}) AS loaded_at`)
  let measured = {}
  if (parts.length) {
    const q = await client.query(`SELECT ${parts.join(', ')} FROM ${schema}."${entry.key}"`)
    measured = q.rows[0] ?? {}
  }
  return {
    sourceDate: measured.source_date ?? null,
    loadedAt: measured.loaded_at ?? entry.loadedAt ?? null,
  }
}

/**
 * Count and date every SEPP land application layer in one scan, rather than 37 filtered queries over a
 * 1.3 GB table. Keyed on (epi_name, lay_name), which is what the archive calls a layer.
 */
async function seppFacts(client) {
  const q = await client.query(`
    SELECT epi_name, lay_name, count(*)::bigint AS features,
           mode() WITHIN GROUP (ORDER BY ST_SRID(geom)) AS srid,
           max(currency_date)::date AS currency_date
    FROM epi.epi_land_application
    WHERE epi_name LIKE 'State Environmental Planning Policy%'
    GROUP BY epi_name, lay_name`)
  return new Map(q.rows.map(r => [`${r.epi_name} ${r.lay_name}`, {
    features: Number(r.features), srid: r.srid, currencyDate: r.currency_date,
  }]))
}

await main()
