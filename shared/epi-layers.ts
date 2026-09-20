/**
 * What each layer of the `epi` schema is, for the layer list on /epi.
 *
 * The tables carry no COMMENT, and their names are the GEODAAS export names rather than the names the
 * maps are published under, so a reader gets `epi_ada` and has to guess. This file supplies the title a
 * planner would recognise and one sentence on what the layer actually holds.
 *
 * Descriptions are editorial and stable. Everything countable - rows, features, how many plans draw the
 * layer, which map names it covers, the classes inside it - comes from the tile manifest instead, so it
 * refreshes with each build rather than going stale here.
 *
 * A key with no entry falls back to the table name with the underscores removed, so a layer added by a
 * future EPI load still lists; add an entry when you meet one.
 */

export interface EpiLayerInfo {
  /** The name the map is published under, rather than the export table name. */
  title: string
  /** One sentence on what is in it. */
  description: string
}

export const EPI_LAYER_INFO: Record<string, EpiLayerInfo> = {
  // ── principal planning ────────────────────────────────────────────────────
  epi_land_zoning: {
    title: 'Land Zoning',
    description: 'The zone of every parcel, as a code such as R2 or C4 with the zone name beside it. The layer everything else is read against.',
  },
  epi_lot_size: {
    title: 'Minimum Lot Size',
    description: 'The minimum lot size code for subdivision, read against the size table in the plan.',
  },
  epi_height_of_building: {
    title: 'Height of Buildings',
    description: 'The maximum building height code, read against the height table in the plan.',
  },
  epi_floor_space_ratio: {
    title: 'Floor Space Ratio',
    description: 'The maximum floor space ratio code, read against the ratio table in the plan.',
  },
  epi_land_reservation_acquisition: {
    title: 'Land Reservation Acquisition',
    description: 'Land reserved for acquisition by a public authority, for roads, open space, drainage or reserves.',
  },
  epi_land_reclassification: {
    title: 'Land Reclassification (Part Lots)',
    description: 'Public land being reclassified between community and operational, mapped where it affects part of a lot.',
  },
  epi_dwelling_density: {
    title: 'Dwelling Density',
    description: 'A minimum dwelling density, in dwellings per hectare, set mostly across the growth centres.',
  },
  epi_gross_floor_area: {
    title: 'Gross Floor Area',
    description: 'A gross floor area fixed for named sites, in the Barangaroo and Redfern-Waterloo precinct policies.',
  },
  epi_reduced_level: {
    title: 'Reduced Level',
    description: 'A minimum floor level in metres AHD, mapped only for Sydney Olympic Park.',
  },

  // ── land application ──────────────────────────────────────────────────────
  epi_land_application: {
    title: 'Land Application',
    description: 'The land each instrument applies to, one row per instrument per area. This is how you tell which plans and policies cover a lot, and it carries the coastal, transport and housing SEPP maps.',
  },

  // ── biodiversity and protection ───────────────────────────────────────────
  epi_terrestrial_biodiversity: {
    title: 'Terrestrial Biodiversity',
    description: 'Biodiversity, habitat corridors and significant vegetation, published under several names including the biodiversity overlay and natural resources sensitivity maps.',
  },
  epi_riparian_lands_watercourses: {
    title: 'Riparian Land and Watercourses',
    description: 'Watercourses and the riparian land beside them, including the natural resources sensitivity water maps.',
  },
  epi_wetlands: {
    title: 'Wetlands',
    description: 'Wetlands mapped by a plan, plus waterways and the Macquarie Marshes.',
  },
  epi_native_veg_protection: {
    title: 'Native Vegetation Protection',
    description: 'Native vegetation retention areas, mapped across the north west and south west growth centres.',
  },
  epi_environmental_cons_area: {
    title: 'Environmental Conservation Areas',
    description: 'Conservation areas in the Moree activation precinct, Homebush Bay and the Western Sydney Parklands.',
  },
  epi_environmentally_sensitive_land: {
    title: 'Environmentally Sensitive Land',
    description: 'The environmentally sensitive land overlay a handful of plans draw. One input to clause 3.3, not the whole of it.',
  },
  epi_critical_habitat: {
    title: 'Critical Habitat',
    description: 'The critical habitat map layer. It exists in the data model but no plan currently maps anything, so it is empty.',
  },
  epi_wetlands_protection_area: {
    title: 'Wetlands Protection Area',
    description: 'A wetlands protection overlay. Empty in this load.',
  },
  epi_special_areas: {
    title: 'Special Areas',
    description: 'Special areas in the growth centres and the Penrith Lakes scheme.',
  },
  epi_scenic_protection: {
    title: 'Scenic Protection Land',
    description: 'Scenic and landscape value land, where development is controlled for its effect on views.',
  },

  // ── land, soil and water ──────────────────────────────────────────────────
  epi_acid_sulfate_soils: {
    title: 'Acid Sulfate Soils',
    description: 'Acid sulfate soil classes 1 to 5, which set how deep you can disturb the soil before consent is needed.',
  },
  epi_csg_exclusions: {
    title: 'Coal Seam Gas Exclusions',
    description: 'Where coal seam gas extraction is prohibited under the mining policy: residential land and its buffer areas.',
  },
  epi_salinity: {
    title: 'Salinity',
    description: 'Salinity and natural resources land, where salt in the soil or groundwater constrains building.',
  },
  epi_groundwater_vulnerability: {
    title: 'Groundwater Vulnerability',
    description: 'Land where groundwater is vulnerable to contamination from what happens on the surface.',
  },
  epi_strategic_agricultural_land: {
    title: 'Strategic Agricultural Land',
    description: 'Biophysical strategic agricultural land and the equine and viticulture critical industry clusters, under the mining policy.',
  },
  epi_drinking_water_catchments: {
    title: 'Drinking Water Catchment',
    description: 'Catchments that supply drinking water, where development is assessed for its effect on water quality.',
  },
  epi_water_zoning: {
    title: 'Water Zoning',
    description: 'Zones over the water itself in the Sydney Harbour foreshores and waterways area.',
  },
  epi_mineral_and_extractive: {
    title: 'Mineral and Extractive Resource Land',
    description: 'Land holding minerals or extractive resources, protected from development that would sterilise it.',
  },
  epi_referral_area: {
    title: 'Referral Area',
    description: 'Areas triggering referral to an agency. Empty in this load.',
  },

  // ── hazard ────────────────────────────────────────────────────────────────
  epi_flood: {
    title: 'Flood Planning',
    description: 'Flood planning areas, flood prone land, 1% AEP extents and probable maximum flood lines, mostly from the growth centre development control maps.',
  },
  epi_landslide_risk: {
    title: 'Landslide Risk',
    description: 'Land subject to landslide risk, drawn by seven plans.',
  },
  epi_geotechnical: {
    title: 'Geotechnical',
    description: 'Where a geotechnical report is required, mapped for the Kosciuszko alpine resorts.',
  },
  epi_noise_exposure_forecast: {
    title: 'Noise Exposure Forecast',
    description: 'Aircraft noise exposure forecast contours around airports, including the Western Sydney aerotropolis.',
  },
  epi_obstacle_limitation_surface: {
    title: 'Obstacle Limitation Surface',
    description: 'Height limits protecting the approach and departure paths of airports.',
  },
  epi_foreshore_building_line: {
    title: 'Foreshore Building Line',
    description: 'The line past which building toward the water is restricted.',
  },

  // ── development controls and local provisions ─────────────────────────────
  epi_heritage: {
    title: 'Heritage',
    description: 'Heritage items, conservation areas, archaeological sites and Aboriginal places, drawn by more plans than any other protection layer.',
  },
  epi_heritage_points: {
    title: 'Heritage (points)',
    description: 'Heritage items mapped as points rather than areas, in the Sydney Harbour heritage map.',
  },
  epi_local_provisions: {
    title: 'Local Provisions',
    description: 'The catch-all for anything a council maps that has no standard layer, under more than two hundred different names. Where the dual occupancy and landscape maps live.',
  },
  epi_special_provision: {
    title: 'Special Provisions',
    description: 'Site and policy specific provisions, including the sustainable buildings water and climate zone maps.',
  },
  epi_additional_permitted_uses: {
    title: 'Additional Permitted Uses',
    description: 'Sites where the plan allows a use the zone would otherwise prohibit, keyed to an item in its schedule.',
  },
  epi_active_street_frontages: {
    title: 'Active Street Frontages',
    description: 'Where the ground floor must be a shop or similar rather than a blank wall or parking.',
  },
  epi_key_sites: {
    title: 'Key Sites',
    description: 'Sites the plan singles out for their own set of controls.',
  },
  epi_local_complying_exclusion: {
    title: 'Complying Development Exclusion',
    description: 'Areas a council excludes from complying development under Schedule 5 of the Codes SEPP.',
  },
  epi_local_exempt_exclusion: {
    title: 'Exempt Development Exclusion',
    description: 'Areas a council excludes from exempt development.',
  },
  epi_urban_release_area: {
    title: 'Urban Release Area',
    description: 'Land released for urban development, where servicing must be arranged before consent.',
  },
  epi_industrial_release_area: {
    title: 'Industrial Release Area',
    description: 'Land released for industrial development in the Western Sydney employment area.',
  },
  epi_future_residential_growth_area: {
    title: 'Future Residential Growth Area',
    description: 'Land flagged for future housing under the mining policy, which limits resource extraction there.',
  },
  epi_growth_centres: {
    title: 'Growth Centres',
    description: 'The boundaries of the north west, south west, Greater Macarthur and Wilton growth areas.',
  },
  epi_precinct_boundaries: {
    title: 'Precinct Boundaries',
    description: 'Precinct boundaries within the growth centres and the aerotropolis.',
  },
  epi_state_significant_dev_sites: {
    title: 'State Significant Development Sites',
    description: 'Sites where development is assessed by the state rather than the council.',
  },
  epi_strategic_foreshore_sites_points: {
    title: 'Strategic Foreshore Sites',
    description: 'Strategic foreshore sites in the Sydney Harbour catchment, mapped as points.',
  },
  epi_additional_rural_village_land: {
    title: 'Additional Rural Village Land',
    description: 'Land added to a rural village for the purposes of the mining policy.',
  },
  epi_bulk_water_supply: {
    title: 'Bulk Water Supply Infrastructure',
    description: 'Bulk water supply infrastructure land in the Western Sydney Parklands.',
  },
  epi_lease_area: {
    title: 'Lease Area',
    description: 'The three ports lease areas under the transport and infrastructure policy.',
  },
  epi_transport_arterial_rd_infra: {
    title: 'Arterial Road Infrastructure',
    description: 'Arterial road infrastructure. Empty in this load.',
  },
  epi_map_tiles: {
    title: 'Map Sheet Index',
    description: 'Not a control. The grid of printed map sheets, saying which sheet covers a point for each plan.',
  },
}

/** The title to show for a layer, falling back to the table name made readable. */
export function epiTitle(key: string): string {
  const info = EPI_LAYER_INFO[key]
  if (info) return info.title
  return key.replace(/^epi_/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

export const epiDescription = (key: string): string | null => EPI_LAYER_INFO[key]?.description ?? null
