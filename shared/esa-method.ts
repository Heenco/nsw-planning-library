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
      + 'and the rest - is not in this layer. A lot outside every feature here can still be environmentally sensitive.',
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
