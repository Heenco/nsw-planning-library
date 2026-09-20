/**
 * How "07 - ESA - exceptions" builds the layer, as the guide beside the table on /esa.
 *
 * Clause 3.3 of the Codes SEPP defines the environmentally sensitive areas where exempt and
 * complying development cannot be carried out. Most of that definition is state-wide; 30 local
 * plans add items of their own, and those additions are what the notebook maps. Two tiers come out
 * of it - land the item can be drawn on, and land where it can only be flagged - and the guide
 * exists to keep that distinction in front of whoever reads the table.
 */

export interface EsaStep {
  n: number
  title: string
  body: string
  note?: string
}

export const ESA_LEAD =
  'Exempt and complying development cannot be carried out on land that is environmentally sensitive. '
  + 'Clause 3.3 of the Codes SEPP says what that means, and 30 local plans add items to it. This is that '
  + 'addition, mapped item by item.'

export const ESA_STEPS: EsaStep[] = [
  {
    n: 1,
    title: 'Start from the manifest',
    body: 'The notebook carries its own manifest: one entry per plan, one item per lettered exception, each routed '
      + 'as precise, advisory or excluded. Editing that manifest is how the layer is refined - nothing is read from '
      + 'a file at run time.',
  },
  {
    n: 2,
    title: 'Fetch the plan it belongs to',
    body: 'Each item is tied to its plan through the LEP application area layer, filtered to that plan and to the '
      + 'land it includes. That polygon is both the clip for state-wide sources and the fallback shape for an item '
      + 'that cannot be drawn.',
  },
  {
    n: 3,
    title: 'Draw what can be drawn',
    body: 'A precise item pulls its geometry from the layers its manifest entry names. A layer that carries a plan '
      + 'name is filtered to that plan, sometimes narrowed further by a zone or class filter; a layer that does not '
      + '(a SEPP map, WaterNSW) is fetched over the plan area and clipped to it. The pieces are repaired, unioned '
      + 'and dissolved into one shape per item.',
    note: 'A precise item whose source returns nothing falls back to the whole plan area and is marked for '
      + 'verification, so the item is never silently lost.',
  },
  {
    n: 4,
    title: 'Flag what cannot',
    body: 'An advisory item - a conservation agreement, a biobanking site, land-use history, a derived buffer - has '
      + 'no layer to draw. It takes the whole plan area, carries its wording, and is marked as needing verification.',
  },
  {
    n: 5,
    title: 'Write it out',
    body: 'The items are simplified slightly and written as one feature each, with the plan, the clause reference, '
      + 'the wording, the tier and the layers behind it, to a GeoJSON file and to the database.',
  },
]

export interface EsaCaveat { title: string; body: string }

export const ESA_CAVEATS: EsaCaveat[] = [
  {
    title: 'Advisory is not a boundary',
    body: 'An advisory item covers its whole council area. It says the exception exists somewhere in that plan, not '
      + 'that any given lot is caught by it. Treat it as a prompt to check, never as an answer.',
  },
  {
    title: 'This is the addition, not the definition',
    body: 'The state-wide part of clause 3.3 - coastal wetlands, littoral rainforest, critical habitat, wilderness, '
      + 'and the rest - is a separate layer set, built by 07C and shown under Clause 3.3 itself.',
  },
  {
    title: 'Some items are drawn from live services',
    body: 'The geometry is whatever the source services returned on the day of the build, so a rebuild can change a '
      + 'shape, and an item whose source is empty today may become precise tomorrow.',
  },
  {
    title: 'One item is left out on purpose',
    body: 'A repealed exception is marked excluded in the manifest and never reaches the layer.',
  },
]

/* ────────────────────────────────────────────────────────────────────────────
 * The state-wide half, built by "07C - ESA - clause 3.3 state-wide".
 * ──────────────────────────────────────────────────────────────────────────── */

export const ESA33_LEAD =
  'Most of clause 3.3 is state-wide and applies to every lot in NSW, whichever plan covers it. No single '
  + 'agency publishes it, so this is assembled: what the planning instrument library already holds is copied, '
  + 'the rest is downloaded from the agency that owns it, and the one piece nobody publishes is derived.'

export const ESA33_STEPS: EsaStep[] = [
  {
    n: 1,
    title: 'Take what the EPI library already has',
    body: 'Coastal wetlands, littoral rainforest and their proximity areas, the environmentally sensitive land '
      + 'maps, and the EPI layers that mark Aboriginal and biodiversity significance are all in the planning '
      + 'instrument load already. Copying them is exact and takes seconds.',
    note: 'They are copies rather than views, because the EPI load replaces its whole schema each time. '
      + 'Re-run 07C after every reload.',
  },
  {
    n: 2,
    title: 'Prove the copy against the live service',
    body: 'The department publishes each coastal map as one layer, area and proximity together. The two copied '
      + 'tables have to add up to exactly what that service reports, which tests the copy against a source that '
      + 'took no part in making it.',
  },
  {
    n: 3,
    title: 'Download the rest by object id, not by page',
    body: 'National parks, Crown reserves, marine protected areas, Ramsar, World Heritage and wilderness belong '
      + 'to other agencies. The loader asks each service for its complete list of object ids, fetches those ids '
      + 'in named batches, and refuses to write the table unless every id came back.',
    note: 'Earlier downloads of these same layers stopped at round numbers - 5,000, 3,000, 300,000 - which is '
      + 'what paging looks like when it quits early and nobody checks.',
  },
  {
    n: 4,
    title: 'Derive the 100 m rule where it is not published',
    body: 'Clause 3.3 reaches 100 m past the wetlands, the aquatic reserves and the Ramsar sites. The department '
      + 'maps that buffer for the coastal layers, so it is copied; for the other two it is measured here on the '
      + 'geography type, which is a true 100 m everywhere rather than in one projected zone.',
  },
  {
    n: 5,
    title: 'Record what has no dataset at all',
    body: 'Critical habitat, areas of outstanding biodiversity value, and coastal waters and lakes have no layer '
      + 'to load. They are written into the registry as gaps so they stay on screen as open questions instead of '
      + 'looking like land with no constraint on it.',
  },
]

export const ESA33_CAVEATS: EsaCaveat[] = [
  {
    title: 'Present is not the same as caught',
    body: 'Some layers are wider than the clause. Crown reserves are here in full, but clause 3.3 catches only '
      + 'those dedicated for environmental protection, so the purpose has to be read before a lot is excluded.',
  },
  {
    title: 'The paragraph letters are not verified',
    body: 'The legislation site and AustLII both refuse automated requests, so the letters beside each item come '
      + 'from secondary sources. The items are right; the lettering should be checked against the instrument.',
  },
  {
    title: 'Three items have no data anywhere',
    body: 'They are listed as gaps. A lot can sit outside every layer here and still be caught by one of them.',
  },
]
