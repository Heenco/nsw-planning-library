/**
 * What every Australian jurisdiction publishes for cadastre and planning, and how to get it.
 *
 * Researched 2026-09-25. This is the answer to "we have NSW - what would the rest of the country
 * cost us", and the short version is that the download is rarely the hard part.
 *
 * WHAT WAS VERIFIED AND WHAT WAS NOT
 *
 * `verified` on an endpoint means it was called from this machine on the research date and answered.
 * Everything else is read from the publisher's own documentation and is marked `documented`. Access
 * terms and prices change without notice, and three of these jurisdictions require a conversation with
 * a person rather than a download, so treat the licence column as a starting point for a procurement
 * question, not as a settled fact.
 *
 * THE FINDING THAT MATTERS MOST IS NOT IN THE TABLE
 *
 * Five of eight publish cadastre openly, five publish state-wide planning zones openly, and the
 * formats are all ordinary GIS. But the ZONE VOCABULARIES do not correspond: NSW's Standard Instrument
 * (R2, B4, SP2), Victoria's (GRZ, NRZ, RGZ), South Australia's single Planning and Design Code, and
 * Queensland's per-council schemes are four different languages for the same idea. A national product
 * is a translation problem wearing a data-download costume.
 */

export type Access = 'open' | 'account' | 'paid' | 'restricted' | 'partial'

export interface Source {
  /** What the publisher calls the dataset. */
  name: string
  /** Where it comes from, in one line. */
  how: string
  url: string
  formats: string
  licence: string
  /** How often the publisher says it changes. */
  cadence: string | null
  access: Access
  /** An endpoint reachable without credentials, where one exists. */
  endpoint?: string
  /** 'verified' = called on the research date; 'documented' = from the publisher's own pages. */
  evidence: 'verified' | 'documented'
  note?: string
}

export interface Jurisdiction {
  code: string
  name: string
  /** Who publishes, once the machinery is stripped away. */
  agency: string
  cadastre: Source
  planning: Source
  /** What we already load, if anything. */
  held: string | null
  /** The one thing worth knowing before starting here. */
  headline: string
}

export const AU_RESEARCHED_ON = '2026-09-25'

export const AU_JURISDICTIONS: Jurisdiction[] = [
  {
    code: 'NSW',
    name: 'New South Wales',
    agency: 'DCS Spatial Services (cadastre) · DPHI ePlanning (planning)',
    held: 'cadastre, epi, guras, integrated_address - the whole basis of this app',
    headline: 'The one we built on: bulk FileGDB dumps plus a live ArcGIS REST service for every EPI layer.',
    cadastre: {
      name: 'Digital Cadastral Database (WaterMark)',
      how: 'GEODAAS bulk FileGDB export, by request; also SIX Maps and the ePlanning REST services',
      url: 'https://portal.spatial.nsw.gov.au/',
      formats: 'FileGDB, ArcGIS REST, WMS',
      licence: 'CC BY 4.0',
      cadence: 'continuous; dumps cut on request',
      access: 'open',
      evidence: 'documented',
      note: '12 layers, 10.2M features in the September 2026 dump: Lot 3.36M, Property 4.22M, Road 1.05M.',
    },
    planning: {
      name: 'All-EPI geodatabase + ePlanning spatial services',
      how: 'Bulk All_EPI FileGDB, and a public ArcGIS REST service per layer',
      url: 'https://www.planningportal.nsw.gov.au/spatialviewer/',
      formats: 'FileGDB, ArcGIS REST',
      licence: 'CC BY 4.0',
      cadence: 'layers carry their own commenced/currency dates',
      access: 'open',
      endpoint: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning',
      evidence: 'verified',
      note: '56 layers. Land zoning, lot size, height, FSR and heritage are the load-bearing five.',
    },
  },
  {
    code: 'VIC',
    name: 'Victoria',
    agency: 'DTP Land Use Victoria · DEECA (DataShare)',
    held: null,
    headline: 'The closest analogue to NSW, and the cheapest to add: one state-wide zones-and-overlays dataset, openly licensed.',
    cadastre: {
      name: 'Vicmap Property',
      how: 'DataShare order - pick format, CRS and extent; no login needed, an email address gets the download link',
      url: 'https://datashare.maps.vic.gov.au/',
      formats: 'Shapefile, GeoPackage, GDB, TAB, choice of CRS',
      licence: 'CC BY 4.0',
      cadence: 'continuous',
      access: 'account',
      evidence: 'verified',
      note: 'Parcel, Property View, Easement, Cadastral Area Boundary and centroid layers. Also mirrored on data.vic.gov.au.',
    },
    planning: {
      name: 'Vicmap Planning',
      how: 'Same DataShare order path as the cadastre',
      url: 'https://discover.data.vic.gov.au/dataset/vicmap-planning',
      formats: 'Shapefile, GeoPackage, GDB',
      licence: 'CC BY 4.0',
      cadence: 'tracks planning scheme amendments',
      access: 'account',
      evidence: 'documented',
      note: 'Zones, overlays, Urban Growth Boundary, Urban Growth Area and the codelists that decode them - every Victorian planning scheme in one dataset.',
    },
  },
  {
    code: 'QLD',
    name: 'Queensland',
    agency: 'Dept of Natural Resources and Mines (QSpatial)',
    held: 'qld schema - the QSCF cadastre, loaded September 2026',
    headline: 'The cadastre changed underneath everyone in April 2026: DCDB is frozen, QSCF replaced it.',
    cadastre: {
      name: 'Queensland Spatial Cadastral Fabric (QSCF)',
      how: 'QSpatial catalogue - whole-of-state, or clipped by LGA, city or suburb',
      url: 'https://qldspatial.information.qld.gov.au/catalogue/',
      formats: 'FileGDB, Shapefile, KML, TAB, ArcGIS REST, WMS',
      licence: 'CC BY 4.0',
      cadence: 'continuous',
      access: 'open',
      endpoint: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/QSCF_LandParcelPropertyFramework/MapServer',
      evidence: 'verified',
      note: 'DCDB updates ceased 18 April 2026. The old REST endpoints still serve time-aware historical data, but new work belongs on QSCF.',
    },
    planning: {
      name: 'State Planning + Land Use (state layers only)',
      how: 'ArcGIS REST and QSpatial; local zoning is published by each council separately',
      url: 'https://qldspatial.information.qld.gov.au/catalogue/',
      formats: 'ArcGIS REST, FileGDB, Shapefile',
      licence: 'CC BY 4.0',
      cadence: 'varies by layer',
      access: 'partial',
      endpoint: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer',
      evidence: 'verified',
      note: 'THE GAP: there is no state-wide zoning layer. Queensland zoning lives in a planning scheme per council, 77 of them, so the NSW equivalent would have to be assembled council by council.',
    },
  },
  {
    code: 'SA',
    name: 'South Australia',
    agency: 'PlanSA (planning) · Land Services SA (cadastre)',
    held: null,
    headline: 'The best planning data in the country and the most awkward cadastre - one state-wide Code, but parcels are not open data.',
    cadastre: {
      name: 'Digital Cadastral Database (DCDB)',
      how: 'By request from Land Services SA - dataaccess@landservices.com.au',
      url: 'https://www.landservices.com.au/products-and-services/south-australian-cadastral-data/',
      formats: 'negotiated',
      licence: 'commercial agreement',
      cadence: 'continuous',
      access: 'restricted',
      evidence: 'documented',
      note: 'Not classified as open data. SAPPA shows it for free but there is no bulk download route without an agreement.',
    },
    planning: {
      name: 'Planning and Design Code - Zones, Subzones, Overlays, Variations',
      how: 'data.sa.gov.au (CKAN) - direct file download or the CKAN API',
      url: 'https://data.sa.gov.au/data/dataset/planning-and-design-code-zones',
      formats: 'GeoJSON, Shapefile, KML',
      licence: 'CC BY 4.0',
      cadence: 'fortnightly',
      access: 'open',
      endpoint: 'https://data.sa.gov.au/data/api/3/action/package_search?q=planning+and+design+code',
      evidence: 'verified',
      note: 'South Australia replaced every council development plan with ONE state-wide Code. No per-council reconciliation, and it updates on a fortnightly cycle you can schedule against.',
    },
  },
  {
    code: 'WA',
    name: 'Western Australia',
    agency: 'Landgate (SLIP) · DPLH (planning)',
    held: null,
    headline: 'The only jurisdiction that charges per parcel for its cadastre.',
    cadastre: {
      name: 'Spatial Cadastral Database (SCDB)',
      how: 'SLIP - free account to browse, but a bulk extract is priced',
      url: 'https://www.wa.gov.au/service/natural-resources/land-use-management/access-the-cadastre-polygons-dataset',
      formats: 'Shapefile, FileGDB, WFS, WMS',
      licence: 'Landgate Personal Use Licence; commercial terms for redistribution',
      cadence: 'continuous',
      access: 'paid',
      evidence: 'documented',
      note: 'Quoted at $4.80 per 100 parcels for a one-off extract, or an annual seat-based licence. WA has roughly 1.4M parcels, so cost the extract before planning around it.',
    },
    planning: {
      name: 'Zones and reserves (local planning schemes) + Metropolitan Region Scheme',
      how: 'data.wa.gov.au catalogue',
      url: 'https://catalogue.data.wa.gov.au/dataset?tags=planning',
      formats: 'Shapefile, WFS, ArcGIS REST',
      licence: 'CC BY 4.0 on most planning layers',
      cadence: 'varies',
      access: 'open',
      evidence: 'documented',
      note: 'State-wide zoning exists wherever a Local Planning Scheme is in force, which is most of the settled state. The planning half is far easier than the cadastre half.',
    },
  },
  {
    code: 'TAS',
    name: 'Tasmania',
    agency: 'NRE Tas, Land Tasmania (theLIST) · Tasmanian Planning Commission',
    held: null,
    headline: 'Smallest effort of any state: open licence, direct downloads and a working REST service.',
    cadastre: {
      name: 'LIST Cadastral Parcels',
      how: 'LISTdata open data downloads, also mirrored on data.gov.au',
      url: 'https://listdata.thelist.tas.gov.au/opendata/',
      formats: 'Shapefile, FileGDB, ArcGIS REST, WFS',
      licence: 'CC BY 4.0',
      cadence: 'continuous',
      access: 'open',
      endpoint: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreAndAdministrative/MapServer',
      evidence: 'verified',
      note: 'A single non-overlapping polygon layer for the whole state.',
    },
    planning: {
      name: 'Tasmanian Planning Scheme - zones, overlays, zone boundaries',
      how: 'LISTdata, data.gov.au, or straight off the REST service',
      url: 'https://data.gov.au/data/dataset/tasmanian-planning-scheme-zoning',
      formats: 'Shapefile, ArcGIS REST, WFS',
      licence: 'CC BY 4.0',
      cadence: 'tracks scheme amendments',
      access: 'open',
      endpoint: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PlanningOnline/MapServer',
      evidence: 'verified',
      note: '18 layers, maxRecordCount 2000. Watch for interim scheme layers sitting beside the state scheme - Kingborough still has its own, plus historical variants.',
    },
  },
  {
    code: 'NT',
    name: 'Northern Territory',
    agency: 'Dept of Lands, Planning and Environment (NTLIS)',
    held: null,
    headline: 'The hardest in the country: neither cadastre nor planning zoning is on the open data portal.',
    cadastre: {
      name: 'Digital Cadastral Database of the Northern Territory',
      how: 'Spatial data request to the department; a data agreement may be required',
      url: 'https://www.ntlis.nt.gov.au/',
      formats: 'negotiated',
      licence: 'agreement; charges may apply',
      cadence: 'continuous',
      access: 'restricted',
      evidence: 'documented',
      note: 'NTLIS metadata states online digital access is available within NT Government only. A "cadastral lite" extract appears in the Digital Atlas of Australia and is the realistic open route.',
    },
    planning: {
      name: 'NT Planning Scheme 2020 zoning',
      how: 'NTLIS metadata and a spatial data request; NR Maps for viewing',
      url: 'https://nrmaps.nt.gov.au/',
      formats: 'negotiated',
      licence: 'agreement',
      cadence: 'tracks scheme amendments',
      access: 'restricted',
      evidence: 'verified',
      note: 'Checked data.nt.gov.au directly: a search for cadastre returns parks, weeds and mineral titles, and one for planning zones returns water and weed zones. Neither dataset is published there.',
    },
  },
  {
    code: 'ACT',
    name: 'Australian Capital Territory',
    agency: 'ACT Government - City and Environment (ACTmapi)',
    held: null,
    headline: 'Everything on one ArcGIS Hub, CC BY 4.0, in every format you would want.',
    cadastre: {
      name: 'ACT Blocks, Sections, Easements',
      how: 'ACTmapi Geospatial Data Catalogue - an ArcGIS Hub with direct downloads',
      url: 'https://actmapi-actgov.opendata.arcgis.com/',
      formats: 'FileGDB, GeoPackage, GeoJSON, CSV, KML, ArcGIS REST',
      licence: 'CC BY 4.0',
      cadence: 'continuous',
      access: 'open',
      endpoint: 'https://actmapi-actgov.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
      evidence: 'verified',
      note: '348 datasets in the catalogue. A block is the ACT equivalent of a lot, and lifecycle stage is carried on the record.',
    },
    planning: {
      name: 'Territory Plan land use zones',
      how: 'Same Hub - dataset ACTGOV TP LAND USE ZONE',
      url: 'https://actmapi-actgov.opendata.arcgis.com/',
      formats: 'FileGDB, GeoPackage, GeoJSON, CSV, KML, ArcGIS REST',
      licence: 'CC BY 4.0',
      cadence: 'tracks the Territory Plan',
      access: 'open',
      evidence: 'verified',
      note: 'One plan for the whole territory, so there is no council reconciliation at all.',
    },
  },
]

export interface NationalSource {
  name: string
  what: string
  url: string
  licence: string
  access: Access
  note: string
}

export const AU_NATIONAL: NationalSource[] = [
  {
    name: 'Geoscape G-NAF',
    what: 'Every geocoded address in Australia, ~15.9M of them',
    url: 'https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf',
    licence: 'CC BY 4.0, under an end user licence agreement',
    access: 'open',
    note: 'Free, quarterly, PSV. Already loaded here by "01C Gnaf loader" and the basis of lot_metrics_gnaf.',
  },
  {
    name: 'Geoscape Cadastre / Buildings',
    what: 'A commercially assembled national cadastre and building footprints',
    url: 'https://geoscape.com.au/',
    licence: 'commercial',
    access: 'paid',
    note: 'The only way to buy one national parcel layer instead of assembling eight. Worth pricing against the SA, WA and NT effort rather than dismissing.',
  },
  {
    name: 'Digital Atlas of Australia',
    what: 'Geoscience Australia aggregating jurisdictional layers into one catalogue',
    url: 'https://digital.atlas.gov.au/',
    licence: 'varies by contributed layer',
    access: 'partial',
    note: 'Useful where a state does not publish directly - the NT cadastral lite extract is the case in point. Not a substitute for the authoritative state source.',
  },
  {
    name: 'There is no national planning dataset',
    what: 'Planning is a state power and the schemes are not comparable',
    url: 'https://www.abs.gov.au/',
    licence: '-',
    access: 'restricted',
    note: 'Nothing aggregates zoning nationally, because the zone vocabularies genuinely differ. Any national view has to be built, and the mapping between vocabularies is the product.',
  },
]
