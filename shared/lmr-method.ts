/**
 * How the LMR layer gets built, as shown in the guide beside the map on /lmr.
 *
 * The recipe in one line: the walking catchments, cut to the residential zones, minus every
 * exclusion - each step drawn by layers already in the panel, so the guide and the map name the
 * same things. Figures are the row counts of those layers; keep them in step with the schema.
 *
 * The law is Chapter 6 of State Environmental Planning Policy (Housing) 2021. Stage 1 (dual
 * occupancies in R2 across NSW) commenced 1 July 2024, Stage 2 (the low and mid-rise housing
 * areas) 28 February 2025. The exclusions are the Department's published list, updated 24 April
 * 2026; the ones we could not confirm against the instrument itself are under "Still to settle".
 */

export interface MethodStep {
  n: number
  title: string
  /** What the step does, in plain words. */
  body: string
  /** The panel layers this step uses, by their titles. */
  layers?: string[]
  /** A caveat worth knowing before trusting the result. */
  note?: string
}

export const LMR_METHOD_LEAD =
  'The low and mid-rise housing area is residential land within 800 m walking distance of a nominated '
  + 'station or town centre, less the land the policy excludes. We build it in four steps, from the layers '
  + 'in this panel.'

export const LMR_METHOD: MethodStep[] = [
  {
    n: 1,
    title: 'Walk out from the stations and centres',
    body: 'Mapbox walking isochrones give the 400 m and 800 m catchments: one from each of the 59 nominated '
      + 'stations, and for a town centre one from points every 100 m around its boundary, unioned with the '
      + 'centre itself, because the policy measures from the edge rather than the middle.',
    layers: ['Station walking catchments (400 m, 800 m)', 'Town centre walking catchments (400 m, 800 m)'],
    note: 'The policy measures from a public entrance; we start from the single station point, so at a large '
      + 'station the catchment starts a little off.',
  },
  {
    n: 2,
    title: 'Keep the residential land',
    body: 'Intersect the catchments with the land zoning map and keep zones R1, R2, R3 and R4 - 8,141 polygons '
      + 'across NSW. Everything else in the catchment drops out.',
    layers: ['Land zoning (LEP and SEPP maps)'],
  },
  {
    n: 3,
    title: 'Take out the excluded land',
    body: 'Subtract each exclusion the Department lists. Transport oriented development areas and the accelerated '
      + 'precincts; the exclusion map (Gordon, Lindfield-Killara, Roseville, Croydon North); heritage items in an '
      + 'LEP or on the State Heritage Register, though not heritage conservation areas; bush fire prone land, every '
      + 'category and the buffer; flood; coastal wetlands, littoral rainforest and coastal vulnerability areas, '
      + 'though not their proximity areas; aircraft noise at ANEF 25 or ANEC 20 and above; land within 200 m of a '
      + 'pipeline; and the whole of the Bathurst, Blue Mountains, Hawkesbury and Wollondilly council areas.',
    layers: ['Transport Oriented Development Area', 'Accelerated TOD Precinct', 'Low and Mid Rise Housing Exclusion Area',
      'Heritage items (LEP maps)', 'State Heritage Register curtilage', 'Bush fire prone land', 'Flood planning (LEP maps)',
      '1% AEP flood extent, first load', '1% AEP flood extent, second load', 'Coastal wetlands', 'Littoral rainforest',
      'Coastal vulnerability areas', 'Aircraft noise contours (ANEF / ANEI)', 'Gas pipelines, 200 m buffer',
      'Oil pipelines, 200 m buffer (none in NSW)'],
    note: 'Test whole lots, not clipped shapes: the policy excludes land that is or contains the constraint, so any '
      + 'overlap takes the whole lot. Keep one flag per exclusion, so a report can say which one removed a lot.',
  },
  {
    n: 4,
    title: 'Write the band and the standards',
    body: 'Land within 400 m takes the inner standards, 400-800 m the outer ones, and a lot reaching into both keeps '
      + 'both. Each lot ends up with whether the policy applies, its band, the station or centre it was measured '
      + 'from, and the lot size, width, floor space ratio and height for each housing type the policy allows there.',
    note: 'Walking distance is not mapped by the law, and the SEPP does not say what happens when only part of a site '
      + 'is inside. Treat the result as indicative and keep the measured distance on every lot.',
  },
]

export interface MethodGap { title: string; body: string }

/**
 * What we cannot settle from the published material. legislation.nsw.gov.au refuses automated
 * requests, so Chapter 6 itself has to be read by hand to close these.
 */
export const LMR_METHOD_GAPS: MethodGap[] = [
  {
    title: 'Data we do not have yet',
    body: 'The deferred TOD stations have no published map; probable maximum flood extents for the Georges River and '
      + 'Hawkesbury-Nepean are not loaded; the aircraft noise layer has no ANEF contours for Sydney Airport, '
      + 'Bankstown, Camden or Albion Park; and station entrances come from a 2020 dataset that predates the newest '
      + 'metro stations.',
  },
  {
    title: 'Numbers to confirm in the SEPP',
    body: 'The Department gives ANEF 25 and ANEC 20, a 200 m pipeline buffer and 22 flood-affected councils. '
      + 'Commentaries from March 2025 say 20 for both contours, 800 m for pipelines and 23 councils. The pipeline '
      + 'data is Geoscience Australia’s, not the register of pipelines licensed under the Pipelines Act 1967.',
  },
]
