/**
 * The NSW ArcGIS layers `01A - Read and write - Geojson.ipynb` downloads.
 *
 * That notebook holds a list of service URLs it pulls to GeoJSON/Parquet for the
 * warehouse. The same list is useful live: these are the planning, hazard and
 * protection layers a person looking at a lot actually wants on the map, and
 * every one of them answers a bounding-box query directly, so nothing has to be
 * downloaded first.
 *
 * Generated from cell 9 of that notebook, so the two cannot drift far. Entries
 * commented out there are still listed here - being switched off for a bulk
 * download says nothing about whether you want to see it on a map.
 *
 * Only LEAF layers are included. A root or group MapServer URL has to be
 * expanded before it can be queried, and that expansion is the notebook's job.
 *
 * The `id` is what the API accepts. URLs are never taken from the client:
 * server/api/map-layer.get.ts looks the id up here, so the endpoint cannot be
 * pointed at an arbitrary host.
 */

export interface MapService {
  id: string
  section: string
  name: string
  url: string
}

export const MAP_SERVICES: MapService[] = [
  // ── Administrative boundaries ───────────────────────────────────
  { id: 'administrative-boundaries-property', section: 'Administrative boundaries', name: "Property", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/2' },
  { id: 'administrative-boundaries-lot', section: 'Administrative boundaries', name: "Lot", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/3' },
  { id: 'administrative-boundaries-addresspointproperties', section: 'Administrative boundaries', name: "AddressPointProperties", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Common/AddressSearch/MapServer/6' },
  { id: 'administrative-boundaries-suburbs', section: 'Administrative boundaries', name: "Suburbs", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/4' },
  { id: 'administrative-boundaries-lga', section: 'Administrative boundaries', name: "LGA", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/5' },
  { id: 'administrative-boundaries-local-aboriginal-land-council', section: 'Administrative boundaries', name: "Local Aboriginal Land Council", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/6' },
  { id: 'administrative-boundaries-regionalgrowthboundary', section: 'Administrative boundaries', name: "RegionalGrowthBoundary", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/310' },
  // ── Electricity infrastructure ──────────────────────────────────
  { id: 'electricity-infrastructure-electricity-transmission-substations', section: 'Electricity infrastructure', name: "Electricity_Transmission_Substations", url: 'https://services.ga.gov.au/gis/rest/services/National_Electricity_Infrastructure/MapServer/0' },
  { id: 'electricity-infrastructure-major-power-stations', section: 'Electricity infrastructure', name: "Major_Power_Stations", url: 'https://services.ga.gov.au/gis/rest/services/National_Electricity_Infrastructure/MapServer/1' },
  { id: 'electricity-infrastructure-electricity-transmission-lines', section: 'Electricity infrastructure', name: "Electricity_Transmission_Lines", url: 'https://services.ga.gov.au/gis/rest/services/National_Electricity_Infrastructure/MapServer/2' },
  // ── Oil and gas pipelines ───────────────────────────────────────
  { id: 'oil-and-gas-pipelines-oil-pipelines', section: 'Oil and gas pipelines', name: "Oil_Pipelines", url: 'https://services.ga.gov.au/gis/rest/services/Oil_Gas_Pipelines/MapServer/0' },
  { id: 'oil-and-gas-pipelines-gas-pipelines', section: 'Oil and gas pipelines', name: "Gas_Pipelines", url: 'https://services.ga.gov.au/gis/rest/services/Oil_Gas_Pipelines/MapServer/1' },
  // ── Liquid fuel facilities ──────────────────────────────────────
  { id: 'liquid-fuel-facilities-liquid-fuel-refineries', section: 'Liquid fuel facilities', name: "Liquid_Fuel_Refineries", url: 'https://services.ga.gov.au/gis/rest/services/Liquid_Fuel_Facilities/MapServer/0' },
  { id: 'liquid-fuel-facilities-liquid-fuel-terminals', section: 'Liquid fuel facilities', name: "Liquid_Fuel_Terminals", url: 'https://services.ga.gov.au/gis/rest/services/Liquid_Fuel_Facilities/MapServer/1' },
  { id: 'liquid-fuel-facilities-liquid-fuel-depots', section: 'Liquid fuel facilities', name: "Liquid_Fuel_Depots", url: 'https://services.ga.gov.au/gis/rest/services/Liquid_Fuel_Facilities/MapServer/2' },
  { id: 'liquid-fuel-facilities-petrol-stations', section: 'Liquid fuel facilities', name: "Petrol_Stations", url: 'https://services.ga.gov.au/gis/rest/services/Liquid_Fuel_Facilities/MapServer/3' },
  // ── Transport facilities ────────────────────────────────────────
  { id: 'transport-facilities-airport', section: 'Transport facilities', name: "Airport", url: 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/MapServer/0' },
  { id: 'transport-facilities-train-stations', section: 'Transport facilities', name: "Train Stations", url: 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/MapServer/1' },
  { id: 'transport-facilities-bus-stations', section: 'Transport facilities', name: "Bus Stations", url: 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/MapServer/2' },
  { id: 'transport-facilities-sepp-housing-2021-landapplication', section: 'Transport facilities', name: "SEPP_Housing_2021_LandApplication", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/76' },
  { id: 'transport-facilities-sepp-housing-tod-sites', section: 'Transport facilities', name: "SEPP_Housing_TOD_Sites", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/752' },
  { id: 'transport-facilities-sepp-housing-lmr-exclusion', section: 'Transport facilities', name: "SEPP_Housing_LMR_Exclusion", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/776' },
  { id: 'transport-facilities-sepp-transport-infra-landapplication', section: 'Transport facilities', name: "SEPP_Transport_Infra_LandApplication", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/723' },
  { id: 'transport-facilities-sepp-rh-coastalwetlands', section: 'Transport facilities', name: "SEPP_RH_CoastalWetlands", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/35' },
  { id: 'transport-facilities-sepp-rh-littoralrainforest', section: 'Transport facilities', name: "SEPP_RH_LittoralRainforest", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/34' },
  { id: 'transport-facilities-sepp-rh-coastalenvironment', section: 'Transport facilities', name: "SEPP_RH_CoastalEnvironment", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/37' },
  { id: 'transport-facilities-sepp-rh-coastaluse', section: 'Transport facilities', name: "SEPP_RH_CoastalUse", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/36' },
  { id: 'transport-facilities-sepp-resourcesenergy-miningland', section: 'Transport facilities', name: "SEPP_ResourcesEnergy_MiningLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/100' },
  // ── TOD ─────────────────────────────────────────────────────────
  { id: 'tod-transport-oriented-development', section: 'TOD', name: "Transport_Oriented_Development", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/752' },
  { id: 'tod-accelerated-transport-oriented-development-precincts-rezoning-areas-map', section: 'TOD', name: "Accelerated Transport Oriented Development Precincts Rezoning Areas Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/759' },
  { id: 'tod-deferred-transport-oriented-development-areas-map', section: 'TOD', name: "Deferred Transport Oriented Development Areas Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/765' },
  { id: 'tod-town-centres-map', section: 'TOD', name: "Town Centres Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/766' },
  // ── Principal planning ──────────────────────────────────────────
  { id: 'principal-planning-lep', section: 'Principal planning', name: "LEP", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/8' },
  { id: 'principal-planning-fsr', section: 'Principal planning', name: "FSR", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/11' },
  { id: 'principal-planning-hob', section: 'Principal planning', name: "HOB", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/14' },
  { id: 'principal-planning-epi-heritage', section: 'Principal planning', name: "EPI_Heritage", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/16' },
  { id: 'principal-planning-land-zoning-map', section: 'Principal planning', name: "Land_Zoning_Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19' },
  { id: 'principal-planning-additionalcontrols-fsr', section: 'Principal planning', name: "AdditionalControls_FSR", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/10' },
  { id: 'principal-planning-additionalcontrols-hob', section: 'Principal planning', name: "AdditionalControls_HOB", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/13' },
  { id: 'principal-planning-additionalcontrols-lzn', section: 'Principal planning', name: "AdditionalControls_LZN", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/18' },
  { id: 'principal-planning-additionalcontrols-lotsize', section: 'Principal planning', name: "AdditionalControls_LotSize", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/21' },
  { id: 'principal-planning-additionalpermitteduses', section: 'Principal planning', name: "AdditionalPermittedUses", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Development_Control/MapServer/225' },
  { id: 'principal-planning-apu-transportinfra-2021', section: 'Principal planning', name: "APU_TransportInfra_2021", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/724' },
  { id: 'principal-planning-apu-wsea-2009', section: 'Principal planning', name: "APU_WSEA_2009", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/81' },
  { id: 'principal-planning-apu-gosford-2018', section: 'Principal planning', name: "APU_Gosford_2018", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/50' },
  { id: 'principal-planning-apu-activationprecincts-2020', section: 'Principal planning', name: "APU_ActivationPrecincts_2020", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/345' },
  { id: 'principal-planning-apu-ssp-2005-139', section: 'Principal planning', name: "APU_SSP_2005_139", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/139' },
  { id: 'principal-planning-apu-ssp-2005-619', section: 'Principal planning', name: "APU_SSP_2005_619", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/619' },
  { id: 'principal-planning-apu-ssp-2005-636', section: 'Principal planning', name: "APU_SSP_2005_636", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/636' },
  { id: 'principal-planning-apu-ssp-2005-653', section: 'Principal planning', name: "APU_SSP_2005_653", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/653' },
  { id: 'principal-planning-additionalcontrols-stmarys-2001', section: 'Principal planning', name: "AdditionalControls_StMarys_2001", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/311' },
  { id: 'principal-planning-lsz', section: 'Principal planning', name: "LSZ", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/22' },
  { id: 'principal-planning-land-reclassification', section: 'Principal planning', name: "Land Reclassification", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/23' },
  { id: 'principal-planning-land-reservation-acquisition', section: 'Principal planning', name: "Land Reservation acquisition", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/24' },
  { id: 'principal-planning-minimum-dwelling-density', section: 'Principal planning', name: "Minimum Dwelling Density", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/27' },
  { id: 'principal-planning-greenfield-housing-code-area', section: 'Principal planning', name: "Greenfield Housing Code Area", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Development_Control/MapServer/222' },
  // ── Hazard ──────────────────────────────────────────────────────
  { id: 'hazard-bushfireproneland', section: 'Hazard', name: "BushfireProneLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer/229' },
  { id: 'hazard-floodplanning', section: 'Hazard', name: "FloodPlanning", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer/230' },
  { id: 'hazard-landsliderisk', section: 'Hazard', name: "LandSlideRisk", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer/232' },
  { id: 'hazard-bushfireproneland-2', section: 'Hazard', name: "BushfireProneLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/BFPL/MapServer/0' },
  // ── Development controls ────────────────────────────────────────
  { id: 'development-controls-activestreetfrontages', section: 'Development controls', name: "ActiveStreetFrontages", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Development_Control/MapServer/224' },
  { id: 'development-controls-developmentcontrolplan', section: 'Development controls', name: "DevelopmentControlPlan", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Development_Control/MapServer/220' },
  // ── Subsidence advisory ─────────────────────────────────────────
  { id: 'subsidence-advisory-mine-subsidence-development', section: 'Subsidence advisory', name: "Mine_Subsidence_Development", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Subsidence_Advisory/MapServer/247' },
  { id: 'subsidence-advisory-mine-subsidence-district', section: 'Subsidence advisory', name: "Mine_Subsidence_District", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Subsidence_Advisory/MapServer/248' },
  { id: 'subsidence-advisory-mine-subsidence-underground-coal-mining', section: 'Subsidence advisory', name: "Mine Subsidence Underground Coal Mining", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Subsidence_Advisory/MapServer/255' },
  // ── Protection (all layers) ─────────────────────────────────────
  { id: 'protection-all-layers-nsw-marine-protected-areas', section: 'Protection (all layers)', name: "NSW Marine Protected Areas", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/599' },
  { id: 'protection-all-layers-acidsulfatesoils', section: 'Protection (all layers)', name: "AcidSulfateSoils", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/234' },
  { id: 'protection-all-layers-airportnoise', section: 'Protection (all layers)', name: "AirportNoise", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/235' },
  { id: 'protection-all-layers-drinking-water-catchment', section: 'Protection (all layers)', name: "Drinking_Water_Catchment", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/236' },
  { id: 'protection-all-layers-groundwatervulnerability', section: 'Protection (all layers)', name: "GroundwaterVulnerability", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/237' },
  { id: 'protection-all-layers-mineralresourceland', section: 'Protection (all layers)', name: "MineralResourceLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/238' },
  { id: 'protection-all-layers-obstaclelimitationsurface', section: 'Protection (all layers)', name: "ObstacleLimitationSurface", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/239' },
  { id: 'protection-all-layers-watercourses-map', section: 'Protection (all layers)', name: "Watercourses Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/751' },
  { id: 'protection-all-layers-riparianlandwatercourse', section: 'Protection (all layers)', name: "RiparianLandWatercourse", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/1024' },
  { id: 'protection-all-layers-riparianlandwatercourse-2', section: 'Protection (all layers)', name: "RiparianLandWatercourse", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/240' },
  { id: 'protection-all-layers-natural-resource-water-map', section: 'Protection (all layers)', name: "Natural Resource - Water Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/740' },
  { id: 'protection-all-layers-natural-resources-water-map', section: 'Protection (all layers)', name: "Natural Resources - Water Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/590' },
  { id: 'protection-all-layers-natural-resources-sensitivity-map', section: 'Protection (all layers)', name: "Natural Resources Sensitivity Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/737' },
  { id: 'protection-all-layers-salinity', section: 'Protection (all layers)', name: "Salinity", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/241' },
  { id: 'protection-all-layers-scenicprotectionland', section: 'Protection (all layers)', name: "ScenicProtectionLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/242' },
  { id: 'protection-all-layers-biodiversity-map', section: 'Protection (all layers)', name: "Biodiversity Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/768' },
  { id: 'protection-all-layers-terrestrialbiodiversity', section: 'Protection (all layers)', name: "TerrestrialBiodiversity", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/243' },
  { id: 'protection-all-layers-wetlands', section: 'Protection (all layers)', name: "Wetlands", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/244' },
  { id: 'protection-all-layers-environmentally-sensitive-land', section: 'Protection (all layers)', name: "Environmentally_Sensitive_Land", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/245' },
  { id: 'protection-all-layers-natural-landform-map', section: 'Protection (all layers)', name: "Natural Landform Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/604' },
  { id: 'protection-all-layers-national-parks-and-wildlife-service-estate', section: 'Protection (all layers)', name: "National Parks and Wildlife Service Estate", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Protection/MapServer/365' },
  { id: 'protection-all-layers-koala-habitat-map-local-provision-ecologically-sensitive-area', section: 'Protection (all layers)', name: "Koala Habitat Map - Local Provision - Ecologically sensitive area", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Local_Provisions/MapServer/489' },
  // ── Protection ──────────────────────────────────────────────────
  { id: 'protection-acidsulfatesoils', section: 'Protection', name: "AcidSulfateSoils", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/1' },
  { id: 'protection-drinking-water-catchment', section: 'Protection', name: "Drinking_Water_Catchment", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/3' },
  { id: 'protection-groundwatervulnerability', section: 'Protection', name: "GroundwaterVulnerability", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/4' },
  { id: 'protection-mineralresourceland', section: 'Protection', name: "MineralResourceLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/5' },
  { id: 'protection-obstaclelimitationsurface', section: 'Protection', name: "ObstacleLimitationSurface", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/6' },
  { id: 'protection-riparianlandwatercourse', section: 'Protection', name: "RiparianLandWatercourse", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/7' },
  { id: 'protection-salinity', section: 'Protection', name: "Salinity", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/8' },
  { id: 'protection-scenicprotectionland', section: 'Protection', name: "ScenicProtectionLand", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/9' },
  { id: 'protection-terrestrialbiodiversity', section: 'Protection', name: "TerrestrialBiodiversity", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/10' },
  { id: 'protection-wetlands', section: 'Protection', name: "Wetlands", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/11' },
  { id: 'protection-environmentally-sensitive-land', section: 'Protection', name: "Environmentally Sensitive Land", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/12' },
  // ── CDC rules ───────────────────────────────────────────────────
  { id: 'cdc-rules-biodiversity', section: 'CDC rules', name: "Biodiversity", url: 'https://www.lmbc.nsw.gov.au/arcgis/rest/services/BV/BiodiversityValues/MapServer/0' },
  { id: 'cdc-rules-wilderness', section: 'CDC rules', name: "Wilderness", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/EDP/Identified_Wilderness/MapServer/0' },
  { id: 'cdc-rules-shr-centroids', section: 'CDC rules', name: "SHR Centroids", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/EDP/SHR_Centroids/MapServer/0' },
  { id: 'cdc-rules-epi-heritage', section: 'CDC rules', name: "EPI_Heritage", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/0' },
  { id: 'cdc-rules-wetlands-nsw', section: 'CDC rules', name: "Wetlands - nsw", url: 'https://mapprod1.environment.nsw.gov.au/arcgis/rest/services/Drainage/NSW_Wetlands_EDP/MapServer/2' },
  { id: 'cdc-rules-wetlands', section: 'CDC rules', name: "Wetlands", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/11' },
  { id: 'cdc-rules-coastal-wetlands', section: 'CDC rules', name: "Coastal Wetlands", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/SEPP_Resilience_and_Hazards_2021/MapServer/3' },
  { id: 'cdc-rules-littoral-rainforests', section: 'CDC rules', name: "Littoral Rainforests", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/SEPP_Resilience_and_Hazards_2021/MapServer/4' },
  { id: 'cdc-rules-marine-protected-areas', section: 'CDC rules', name: "Marine Protected Areas", url: 'https://spatial.industry.nsw.gov.au/arcgis/rest/services/PUBLIC/Marine_Protected_Areas/MapServer/0' },
  { id: 'cdc-rules-ramsar-wetlands', section: 'CDC rules', name: "Ramsar Wetlands", url: 'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/Ramsar_Wetlands/MapServer/0' },
  { id: 'cdc-rules-npws-managed-land', section: 'CDC rules', name: "NPWS Managed Land", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Tenure/NPWS_AllManagedLand/MapServer/0' },
  { id: 'cdc-rules-npws-estate', section: 'CDC rules', name: "NPWS Estate", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/EDP/Estate/MapServer/0' },
  { id: 'cdc-rules-crown-council-reserves', section: 'CDC rules', name: "Crown Council Reserves", url: 'https://spatial.industry.nsw.gov.au/arcgis/rest/services/Crown_Lands_Reserve/Crown_Council_Reserve_Portal_Prod_v3/FeatureServer/0' },
  { id: 'cdc-rules-land-reservation-acquisition', section: 'CDC rules', name: "Land Reservation Acquisition", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/3' },
  { id: 'cdc-rules-acidsulfatesoils', section: 'CDC rules', name: "AcidSulfateSoils", url: 'https://mapprod1.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Protection_Layers/MapServer/0' },
  // ── Clause 3.3 ──────────────────────────────────────────────────
  { id: 'clause-3-3-coastal-hazard-map', section: 'Clause 3.3', name: "Coastal Hazard Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Local_Provisions/MapServer/441' },
  { id: 'clause-3-3-river-front-area-map', section: 'Clause 3.3', name: "River Front Area Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Local_Provisions/MapServer/552' },
  { id: 'clause-3-3-azbesto-map', section: 'Clause 3.3', name: "Azbesto Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanningHistoric/Planning_Historic_Combined/MapServer/41' },
  { id: 'clause-3-3-hawkesbury-nepean-riverine-scenic-area', section: 'Clause 3.3', name: "Hawkesbury-Nepean Riverine Scenic Area", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/183' },
  { id: 'clause-3-3-koala-corridor', section: 'Clause 3.3', name: "Koala Corridor", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_SEPP/MapServer/749' },
  { id: 'clause-3-3-landfill-buffer-map', section: 'Clause 3.3', name: "Landfill Buffer Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Local_Provisions/MapServer/495' },
  { id: 'clause-3-3-airport-development-area-map', section: 'Clause 3.3', name: "Airport Development Area Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Local_Provisions/MapServer/421' },
  { id: 'clause-3-3-development-control-plans-special-influence-contributions', section: 'Clause 3.3', name: "Development Control Plans - Special Influence Contributions", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Development_Control/MapServer/1' },
  { id: 'clause-3-3-environmentally-sensitive-land', section: 'Clause 3.3', name: "Environmentally_Sensitive_Land", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Protection/MapServer/12' },
  { id: 'clause-3-3-coastal-environment-area-map', section: 'Clause 3.3', name: "Coastal Environment Area Map", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/SEPP_Resilience_and_Hazards_2021/MapServer/6' },
  { id: 'clause-3-3-coastal-use-area-map-we-don-t-need-this-one-to-be-removed', section: 'Clause 3.3', name: "Coastal Use Area Map - we don't need this one - To be removed", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/SEPP_Resilience_and_Hazards_2021/MapServer/7' },
  { id: 'clause-3-3-foreshore-building-line', section: 'Clause 3.3', name: "Foreshore Building Line", url: 'https://mapprod1.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Development_Control_Layers/MapServer/1' },
  { id: 'clause-3-3-local-provisions', section: 'Clause 3.3', name: "Local Provisions", url: 'https://mapprod1.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Development_Control_Layers/MapServer/2' },
  { id: 'clause-3-3-sydney-drinking-water-catchment', section: 'Clause 3.3', name: "Sydney Drinking Water Catchment", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/EDP/Sydney_Drinking_Water_Catchment_Boundary/MapServer/1' },
  { id: 'clause-3-3-local-complying-exclusion', section: 'Clause 3.3', name: "Local Complying Exclusion", url: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/SEPP_Exempt_and_Complying_Development_Codes_2008/MapServer/3' },
  { id: 'clause-3-3-special-and-controlled-areas-wnsw', section: 'Clause 3.3', name: "Special and Controlled Areas (WNSW)", url: 'https://nula.waternsw.com.au/arcgis/rest/services/WaterNSW_Boundaries/WaterNSW_Boundaries/FeatureServer/0' },
  { id: 'clause-3-3-sydney-drinking-water-catchment-boundary-2021-wnsw', section: 'Clause 3.3', name: "Sydney Drinking Water Catchment Boundary 2021(WNSW)", url: 'https://nula.waternsw.com.au/arcgis/rest/services/WaterNSW_Boundaries/WaterNSW_Boundaries/FeatureServer/4' },
  // ── Koala habitat ───────────────────────────────────────────────
  { id: 'koala-habitat-koala-likelihood-map-v2-0-likelihood-layer', section: 'Koala habitat', name: "Koala Likelihood Map v2.0 - Likelihood Layer", url: 'https://www.lmbc.nsw.gov.au/arcgis/rest/services/KoalaHabitat/KLM_v2_0_August_2019/MapServer/0' },
  { id: 'koala-habitat-koala-likelihood-map-v2-0-confidence-layerassdmf-swa', section: 'Koala habitat', name: "Koala Likelihood Map v2.0 - Confidence Layerassdmf swa", url: 'https://www.lmbc.nsw.gov.au/arcgis/rest/services/KoalaHabitat/KLM_v2_0_August_2019/MapServer/1' },
  { id: 'koala-habitat-abs-2021-census-g17-sa1', section: 'Koala habitat', name: "ABS_2021_Census_G17_SA1", url: 'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/ArcGIS/rest/services/ABS_2021_Census_G17_SA1/FeatureServer/0' },
  { id: 'koala-habitat-seifa-2021-sa2-2021', section: 'Koala habitat', name: "SEIFA_2021_SA2_2021", url: 'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/ABS_Socio_Economic_Indexes_for_Areas_SEIFA_by_2021_SA2/FeatureServer/0' },
]

/** Sections in catalogue order, for rendering the panel. */
export const MAP_SECTIONS: string[] = [...new Set(MAP_SERVICES.map(s => s.section))]

export function findService(id: string): MapService | undefined {
  return MAP_SERVICES.find(s => s.id === id)
}
