/**
 * Layers we hold on the tile server but cannot resolve from a live NSW service.
 *
 * The `/frontage` Layers panel queries NSW ArcGIS directly, which covers 31 of
 * the 35 CDC general prerequisites. The rest of what the CDC and Pattern Book
 * notebooks depend on is not published live at all — it is derived, licensed, or
 * simply absent from the ePlanning services — but all of it is already in
 * UrbanPortalDBP and served as vector tiles by Martin.
 *
 * So this is the other half of the same catalogue: same map, same panel shape,
 * different provenance. The distinction is worth keeping visible rather than
 * merging the two lists, because "NSW says so, right now" and "our warehouse
 * said so when it was last built" are different claims about the world.
 *
 * `note` says why each one is here — what it unblocks, or what to watch for.
 */

export interface LocalLayer {
  id: string
  label: string
  note: string
  /**
   * Tile zoom floor. Martin publishes every column of a table in the tile, so
   * up_property_d_3 is ~170 fields per feature — one z16 tile is 843 KB and one
   * z14 tile is 20 MB. The heavy ones are held back until the view is small
   * enough to be worth drawing.
   */
  minzoom?: number
}

export interface LocalGroup {
  key: string
  label: string
  blurb: string
  layers: LocalLayer[]
}

export const LOCAL_GROUPS: LocalGroup[] = [
  {
    key: 'eligibility',
    label: 'Eligibility inputs',
    blurb: 'What the Pattern Book and CDC rules need and NSW does not publish live.',
    layers: [
      { id: 'lmr', label: 'LMR area', note: 'Low and Mid-Rise housing area. Only the LMR *exclusion* is live from NSW; the area itself is ours.' },
      { id: 'lmr_base', label: 'LMR base', note: 'The unresolved base layer behind lmr.' },
      { id: 'lmr_landuse_resolved', label: 'LMR land use (resolved)', note: 'LMR joined to land use — the `lmr_landuse` column the notebook branches on.' },
      { id: 'tod', label: 'TOD', note: 'Transport Oriented Development areas. NSW publishes TOD sites and precincts live; this is the resolved set.' },
      { id: 'UP_SEPP_PermissibleLandUse', label: 'Permissible land use', note: 'Zone comes live, but "is dual occupancy permitted here" needs this table.' },
      { id: 'up_property_d_3', label: 'Property d_3', note: '307 columns per property, Randwick + Hornsby. Heavy tiles — z16+.', minzoom: 16 },
      { id: 'up_property_d_4', label: 'Property d_4', note: 'Randwick only, the newer build.', minzoom: 16 },
    ],
  },
  {
    key: 'cdc-gaps',
    label: 'CDC constraints with no live layer',
    blurb: 'Four of the 35 CDC prerequisites have no NSW service in the 01A catalogue. All four are here.',
    layers: [
      { id: 'PNF_Approval_Lots', label: 'Private Native Forest', note: 'CDC prerequisite `pnf_controllin`.' },
      { id: 'BCT_Agreements', label: 'BCT agreement land', note: 'CDC prerequisite `bct_controllin`.' },
      { id: 'ContaminationSites', label: 'Contamination sites', note: 'CDC prerequisite `contamination_sitename`.' },
      { id: 'asbestos_encapsulation_area_map', label: 'Asbestos encapsulation', note: 'CDC prerequisite `asb_lay_class`.' },
      { id: 'airport_noise', label: 'Airport noise (ANEF)', note: 'CDC prerequisite `airport_anef_code`. NSW publishes AirportNoise live too; this is ours.' },
    ],
  },
  {
    key: 'derived',
    label: 'Our derived outputs',
    blurb: 'Built by the notebooks, not published by anyone.',
    layers: [
      { id: 'lot_metrics_gnaf', label: 'Lot metrics (G-NAF)', note: 'The frontage/width table this page exists to replace. Useful for A/B against a live result.' },
      { id: 'lot_metrics_3', label: 'Lot metrics 3', note: 'The earlier full-NSW run — 21.9% of it has num_frontages = 0.' },
      { id: 'road_segments', label: 'Road centrelines', note: 'Also on the map controls; listed here because frontage naming reads it.' },
      { id: 'lot', label: 'Cadastre lot', note: 'Also on the map controls. The parcel fabric the topological method uses.' },
    ],
  },
]

export const LOCAL_LAYERS: LocalLayer[] = LOCAL_GROUPS.flatMap(g => g.layers)

export function findLocalLayer(id: string): LocalLayer | undefined {
  return LOCAL_LAYERS.find(l => l.id === id)
}
