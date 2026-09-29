/**
 * How each /epi layer is drawn: the NSW Planning Portal Spatial Viewer's own symbol, so a layer reads here
 * the way it reads on the map people already check a property against.
 *
 * The colours are not in this file. They are measured from the ArcGIS services into
 * shared/epi-renderers.json by scripts/sweep-epi-renderers.py, because minimum lot size, height and floor
 * space ratio carry over four hundred bands between them and hand-typing those is how a palette ends up
 * almost right. Re-run that script when ePlanning restyles a map; nothing here needs to change.
 *
 * What this file holds is the part a sweep cannot work out: how a class in the portal's vocabulary is
 * matched to a `category` in ours.
 *
 * THE MATCHING PROBLEM. The tiles carry `category` - lay_class for most tables, sym_code for zoning - and
 * the renderer labels its classes in the portal's own spelling. They rarely agree on the nose:
 *
 *   portal 'R2 - Low Density Residential'   tile 'R2'            a code with its name appended
 *   portal 'R4  High Density Residential'   tile 'R4'            ... and one label has lost its dash
 *   portal '8 - 8.9 m'                      tile '8-8.9'         a band with its unit
 *   portal '0.4 - 0.44'                     tile '0.4-0.44'      spaces around the dash
 *   portal 'Zone 5 - Water Recreation'      tile 'Water Recreation'
 *   portal 'ANEF between 20 and 25'         tile '20'            the contour, not the band
 *
 * So each layer gets a rule (RULE) that reduces both sides to the same key, plus a short list of aliases
 * for the cases no rule covers. Coverage is measured by scripts/check-epi-symbology.py, by features rather
 * than by distinct labels, and anything still unmatched falls back to the layer's base symbol - which is
 * what the portal itself does with a value it does not recognise.
 *
 * Six tables have no portal layer at all and are coloured here instead, marked 'ours': the three
 * catch-alls a council publishes under hundreds of names (local provisions, special provisions, the map
 * sheet index) and the three that are empty in this load.
 */
import RENDERERS from './epi-renderers.json'
import { HATCH_NONE, hatchCss, hatchId, type Hatch } from './hatch'

export { HATCH_NONE, hatchImage, type Hatch } from './hatch'

export interface Sym {
  /** Fill colour; null for an outline-only symbol. With `hatch` it is the colour of the hatch lines. */
  fill?: string | null
  /** Outline colour; null for no outline. */
  line?: string | null
  /** Outline width in px, as the renderer gives it. */
  width?: number
  hatch?: Hatch
  /** A marker rather than a fill: the layer is points. */
  point?: boolean
}

export interface EpiSymbology {
  /** The ArcGIS layer the symbol was read from, or 'ours' where the portal has none. */
  from: string
  /** The symbol for anything the classes do not match. Null where the renderer has no default. */
  base: Sym | null
  /** Per-class symbols, keyed in the portal's own spelling. Matched through `epiClassKey`. */
  classes: Record<string, Sym>
  /** The portal's own transparency for the layer, 0-100. Zoning is published at 50. */
  transparency?: number
  /** Which class was promoted to `base` because the renderer uses it as its own catch-all. */
  baseFrom?: string
  /** The renderer field, for the record: which attribute the portal keys on. */
  field?: string | null
  geometry?: string | null
}

interface RendererFile {
  [table: string]: {
    from: string
    name?: string
    geometry?: string | null
    type?: string | null
    field?: string | null
    transparency?: number
    base?: Sym | null
    base_from?: string
    classes?: Record<string, Sym>
  }
}

const MEASURED = RENDERERS as unknown as RendererFile

// ── keying ───────────────────────────────────────────────────────────────────

/** How a layer's class labels and our categories are reduced to a common key. */
export type KeyRule = 'class' | 'code' | 'band' | 'water' | 'anef'

const RULE: Record<string, KeyRule> = {
  epi_land_zoning: 'code',
  epi_lot_size: 'band',
  epi_height_of_building: 'band',
  epi_floor_space_ratio: 'band',
  epi_gross_floor_area: 'band',
  epi_water_zoning: 'water',
  epi_noise_exposure_forecast: 'anef',
}

/** Every dash ePlanning uses - hyphen, figure dash, en, em, minus - so one spelling reaches the key. */
const DASH = /[‐-―−]/g
/** The unit a band label carries and a category does not: '8 - 8.9 m', '450 - 474 sq m', '2:1'. */
const UNIT = /\s*(?:sq\.?\s*m(?:etres?)?|m2|sqm|m|ha|:1|dwellings?\/ha)$/i

/**
 * A category the portal spells differently, where its own class is unmistakable. Applied after the rule,
 * so the key on both sides is already folded.
 *
 * 'CA' is Complex Area: land the plan sends you to a separate table for. The portal draws it through the
 * map's Additional Controls layer - a blue outline and no fill - which the sweep merges in, so this is the
 * portal's symbol rather than a colour chosen here. It accounts for 5,521 of the FSR polygons alone.
 */
const ALIAS: Record<string, string> = {
  'ca': 'additional controls',
  'complex area': 'additional controls',
}
/*
 * The alias is applied BEFORE the rule, because the rule then folds both sides the same way. Applying it
 * after put 'ca' against a zoning class the code rule had already shortened to 'additional', and the 566
 * Complex Area polygons matched nothing.
 */

/**
 * Where a whole family of council spellings takes one portal class. The colour is still the portal's; what
 * is decided here is that these categories belong to that class.
 *
 * Riparian land is the case that matters: the epi table holds 95,500 polygons and the councils name the
 * water itself a waterway, a watercourse, or a category 1, 2 or 3 watercourse. The portal has one
 * Watercourse class and draws all of them in it.
 */
const FAMILY: Record<string, [RegExp, string][]> = {
  epi_riparian_lands_watercourses: [
    [/waterway|watercourse|water course|key fish/i, 'Watercourse'],
    [/riparian/i, 'Riparian Land'],
    [/wetland/i, 'Wetland'],
  ],
  epi_terrestrial_biodiversity: [
    [/sensitiv/i, 'Natural Resources Sensitivity Map'],
    [/high biodiversity/i, 'Areas of high biodiversity significance'],
    [/biodiversity|vegetation|habitat|corridor/i, 'Biodiversity'],
  ],
  epi_wetlands: [[/wetland|waterway|marsh/i, 'Wetlands']],
}

function fold(s: string): string {
  return s.replace(DASH, '-').trim().toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
}

/**
 * The key a category or a class label is matched on, for one layer.
 *
 * Exported because the match is made in TypeScript over the categories the layer catalogue reports, not in
 * a Mapbox expression: expressions have no regex, and normalising there would mean emitting every spelling
 * variant as its own literal.
 */
export function epiClassKey(layer: string, value: string): string {
  let s = fold(value)
  s = ALIAS[s] ?? s
  switch (RULE[layer] ?? 'class') {
    case 'code':
      // the leading code, however the label separates it from the name: 'R2 - Low Density', 'R4  High
      // Density' (the portal's own label, dash and all missing), '2(a) - Residential'
      s = (/^[^\s-]+/.exec(s)?.[0] ?? s)
      break
    case 'band':
      s = s.replace(UNIT, '').trim()
      break
    case 'water':
      s = s.replace(/^zone\s*\d+\s*-?\s*/, '').trim()
      break
    case 'anef':
      s = s.replace(/anec/g, 'anef')
      // a bare contour number is the band that starts there: '20' is the 20-25 contour
      if (/^\d+$/.test(s)) s = `anef between ${s} and ${Number(s) + 5}`
      s = s.replace(/^anef (\d+)-(\d+)$/, 'anef between $1 and $2')
      break
  }
  return s
}

// ── the layers ───────────────────────────────────────────────────────────────

/**
 * The tables the Spatial Viewer has no layer for. Three are catch-alls - a council files anything without a
 * standard layer under local or special provisions, under more than two hundred different map names, and
 * the map sheet index is not a control at all - and three are empty in this load. A neutral colour is the
 * honest answer: there is no portal symbol to follow.
 */
const OURS: Record<string, EpiSymbology> = {
  epi_local_provisions: {
    from: 'ours - the portal publishes these under 200+ council map names, with no one symbol',
    base: { fill: '#7c3aed', line: '#5b21b6', width: 0.8 }, classes: {},
  },
  epi_special_provision: {
    from: 'ours - site and policy specific provisions, published under many names',
    base: { fill: '#a855f7', line: '#7e22ce', width: 0.8 }, classes: {},
  },
  epi_map_tiles: {
    from: 'ours - the printed map sheet grid, not a control',
    base: { fill: null, line: '#94a3b8', width: 0.6 }, classes: {},
  },
  epi_critical_habitat: {
    from: 'ours - no plan maps anything, so the layer is empty in this load',
    base: { fill: '#c29ed7', line: '#6a1b9a', width: 1 }, classes: {},
  },
  epi_wetlands_protection_area: {
    from: 'ours - empty in this load',
    base: { fill: '#c9fff9', line: '#000000', width: 0.8 }, classes: {},
  },
  epi_transport_arterial_rd_infra: {
    from: 'ours - empty in this load',
    base: { fill: '#94a3b8', line: '#475569', width: 0.8 }, classes: {},
  },
}

/** Nothing recorded at all: a table a future EPI load adds still draws, in grey, and says so. */
const FALLBACK: EpiSymbology = {
  from: 'ours - no symbol recorded for this layer',
  base: { fill: '#94a3b8', line: '#475569', width: 0.8 },
  classes: {},
}

export function epiSymbology(layer: string): EpiSymbology {
  const ours = OURS[layer]
  if (ours) return ours
  const m = MEASURED[layer]
  if (!m) return FALLBACK
  return {
    from: m.from,
    base: m.base ?? null,
    classes: m.classes ?? {},
    transparency: m.transparency ?? 0,
    baseFrom: m.base_from,
    field: m.field ?? null,
    geometry: m.geometry ?? null,
  }
}

/** Every layer a symbol is recorded for, measured or ours. */
export const EPI_SYMBOLOGY_KEYS = [...new Set([...Object.keys(MEASURED), ...Object.keys(OURS)])].sort()

/**
 * Lay one class over the layer's base symbol.
 *
 * The outline is inherited: ePlanning's classes routinely set only a fill and take the layer's outline. The
 * HATCH is not, because it is part of the fill style - a class that declares a fill declares how that fill
 * is drawn, solid unless it says otherwise. Inheriting it drew all 71,008 zoning polygons in the grey hatch
 * their base borrows for a non-standard value. A class with no fill of its own - an outline-only symbol such
 * as a flood planning level - still takes the base's fill and hatch.
 */
function over(base: Sym, sym: Sym): Sym {
  const out: Sym = { ...base, ...sym }
  if ('fill' in sym && !sym.hatch) delete out.hatch
  return out
}

/** The symbol one category draws with: the class the portal gives it, else the layer's base, else grey. */
export function epiSymFor(layer: string, category: string | null | undefined): Sym {
  const s = epiSymbology(layer)
  const base = s.base ?? FALLBACK.base!
  if (!category) return { ...base }
  const want = epiClassKey(layer, category)
  for (const [label, sym] of Object.entries(s.classes)) {
    if (epiClassKey(layer, label) === want) return over(base, sym)
  }
  for (const [re, label] of FAMILY[layer] ?? []) {
    if (!re.test(category)) continue
    const sym = s.classes[label]
    if (sym) return over(base, sym)
  }
  return { ...base }
}

/**
 * The symbol that stands for a whole layer, in the layer list and the legend.
 *
 * Its base, normally - that is what the portal draws for anything unclassed. But four maps (zoning, minimum
 * lot size, floor space ratio, height) have no default of their own and BORROW ePlanning's grey
 * 'Non Standard Values' hatch for values outside their bands. Letting that stand for the layer said "every
 * value on this map is non-standard" when 93% and 99% of them are not, so a borrowed base steps aside for
 * the layer's biggest class, which the caller supplies.
 */
export function epiSwatch(layer: string, biggestCategory?: string | null): Sym {
  const s = epiSymbology(layer)
  const borrowed = s.baseFrom?.includes('borrowed')
  if (s.base && !borrowed) return { ...s.base }
  return epiSymFor(layer, biggestCategory ?? null)
}

/** The fill opacity a layer wants: the portal's own transparency, as an opacity. */
export function epiOpacity(layer: string, fallback: number): number {
  const t = epiSymbology(layer).transparency ?? 0
  return t > 0 ? (100 - t) / 100 : fallback
}

// ── legend ───────────────────────────────────────────────────────────────────

/** CSS for a swatch that looks like the map: a flat fill, or hatch lines, inside the outline colour. */
export function epiSwatchCss(sym: Sym, opacity = 0.65): Record<string, string> {
  const fill = sym.fill ?? null
  const border = sym.line ?? fill ?? '#94a3b8'
  const style: Record<string, string> = { border: `1.5px solid ${border}` }
  if (sym.point) style.borderRadius = '50%'
  if (!fill) style.background = 'transparent'
  else if (sym.hatch) style.background = hatchCss(sym.hatch, fill)
  else style.background = withAlpha(fill, Math.max(opacity, 0.55))
  return style
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// ── mapbox expressions ───────────────────────────────────────────────────────

const CLEAR = 'rgba(0,0,0,0)'

/** What the page knows about a layer when it builds the paint: its key and the categories in its tiles. */
export interface EpiLayerCats {
  key: string
  categories: { name: string }[]
}

/**
 * One `match` on layer_key; inside it, for a layer whose categories draw differently, a `match` on
 * `category`. `pick` turns a resolved symbol into the paint value, so fill, line, width and pattern are all
 * built the same way.
 *
 * The inner match is emitted over the categories the layer actually has, resolved here, rather than over
 * the portal's class labels: that is what lets '8-8.9' find the portal's '8 - 8.9 m' without a regex in the
 * expression, and it keeps the expression to the values that can really turn up in a tile.
 */
export function epiByLayerExpr(
  layers: EpiLayerCats[],
  pick: (s: Sym) => any,
  fallback: any,
): any {
  if (!layers.length) return fallback
  const out: any[] = ['match', ['get', 'layer_key']]
  for (const { key, categories } of layers) {
    // the real base, not epiSwatch: this is what an unmatched category draws with, and for the four
    // borrowed layers that is the non-standard hatch rather than their biggest class
    const base = pick(epiSymFor(key, null))
    // only the categories that differ from the base are worth an entry
    const entries: [string, any][] = []
    for (const c of categories) {
      const paint = pick(epiSymFor(key, c.name))
      if (JSON.stringify(paint) !== JSON.stringify(base)) entries.push([c.name, paint])
    }
    if (!entries.length) { out.push(key, base); continue }
    const inner: any[] = ['match', ['coalesce', ['get', 'category'], '']]
    for (const [value, paint] of entries) inner.push(value, paint)
    inner.push(base)
    out.push(key, inner)
  }
  out.push(fallback)
  return out
}

export const fillColour = (s: Sym) => (s.fill && !s.hatch ? s.fill : CLEAR)
export const lineColour = (s: Sym) => s.line ?? s.fill ?? CLEAR
export const lineWidth = (s: Sym) => Math.max(s.width ?? 0.8, 0.4)
export const patternId = (s: Sym) => (s.fill && s.hatch ? hatchId(s.hatch, s.fill) : HATCH_NONE)

/** Every hatch image the visible layers need, so the page can register them before drawing. */
export function epiHatchesNeeded(layers: EpiLayerCats[]): { id: string; hatch: Hatch; colour: string }[] {
  const seen = new Map<string, { id: string; hatch: Hatch; colour: string }>()
  for (const { key, categories } of layers) {
    const syms = [epiSymFor(key, null), epiSwatch(key, categories[0]?.name),
                  ...categories.map(c => epiSymFor(key, c.name))]
    for (const sym of syms) {
      if (sym.fill && sym.hatch) {
        const id = hatchId(sym.hatch, sym.fill)
        seen.set(id, { id, hatch: sym.hatch, colour: sym.fill })
      }
    }
  }
  return [...seen.values()]
}
