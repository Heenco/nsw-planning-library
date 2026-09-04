/**
 * Which DCP controls apply to a lot, and on which axis.
 *
 * The Hornsby DCP is keyed on two different dimensions in nsw.rule_applicability
 * and the report was only ever reading one of them:
 *
 *   land_use   228 rows / 42 values   the use-specific tables (setbacks, POS)
 *   dev_type   504 rows /  8 values   the DCP's own part structure
 *   area_label 569 rows /  1 value    "Hornsby" — document scope, not a filter
 *   map_area    62 rows / 26 values   locality precincts, not linked to lots yet
 *
 * 484 numeric effects across 131 rules carry no land_use row at all, so an inner
 * join on dimension='land_use' could never reach them — about 55% of the 887
 * numeric DCP effects. All 131 do carry area_label and 122 carry dev_type: they
 * are classified, just on the other axis.
 *
 * The rule this module encodes:
 *
 *   a rule that NAMES land uses applies only to those uses;
 *   a rule that names NONE is general to its development type.
 *
 * That second half is what unlocks the missing 55% without inventing anything.
 * The dangerous version — treating any dev_type match as applicable — would put
 * a residential-flat-building setback on a dwelling-house lot, because those
 * rules are tagged `residential` too. Hence the NOT EXISTS guard in the query.
 */

/** The eight dev_type values the Hornsby DCP actually uses. */
export type DevType =
  | 'residential' | 'business' | 'rural' | 'subdivision'
  | 'community' | 'river_settlement' | 'industrial' | 'heritage'

/**
 * Zone code -> the DCP parts that govern it.
 *
 * Standard Instrument codes as they appear in `lzn_sym_code_p`. E1-E5 are the
 * post-2022 Employment zones (E1 Local Centre ... E5 Heavy Industrial), NOT the
 * old Environmental zones — 22 Leighton Place is E4 General Industrial, so
 * reading E4 as "environmental living" would send it the wrong controls.
 */
const ZONE_DEV_TYPES: Record<string, DevType[]> = {
  R1: ['residential'], R2: ['residential'], R3: ['residential'],
  R4: ['residential'], R5: ['residential'],
  MU1: ['residential', 'business'],
  E1: ['business'], E2: ['business'],
  E3: ['business', 'industrial'],
  E4: ['industrial'], E5: ['industrial'],
  RU1: ['rural'], RU2: ['rural'], RU3: ['rural'],
  RU4: ['rural'], RU5: ['rural'], RU6: ['rural'],
  // Conservation zones are handled under the DCP's rural part; Hornsby has no
  // separate conservation part.
  C1: ['rural'], C2: ['rural'], C3: ['rural'], C4: ['rural'],
  RE1: ['community'], RE2: ['community'],
  SP1: ['community'], SP2: ['community'], SP3: ['community'],
  // The river settlement part covers the Hawkesbury/Berowra waterway
  // settlements. Ideally this would be matched on map_area rather than zone —
  // see the map_area gap in the header comment.
  W1: ['river_settlement'], W2: ['river_settlement'],
  W3: ['river_settlement'], W4: ['river_settlement'],
}

/**
 * Land uses to ask for by zone, independent of the lot's own list.
 *
 * `up_property_d_3.permissible_uses` cannot replace this. It names dual
 * occupancy on 3,190 of 73,595 lots but dwelling house on 66,900, so an R2 lot
 * that plainly permits attached dual occupancies does not say so. Driving the
 * scope from that column alone would drop controls the report shows today.
 */
const ZONE_LAND_USES: Record<string, string[]> = {
  R1: ['dwelling house', 'dual occupancy', 'medium density housing', 'residential flat building'],
  R2: ['dwelling house', 'dual occupancy'],
  R3: ['dwelling house', 'dual occupancy', 'medium density housing', 'multi dwelling housing'],
  R4: ['dwelling house', 'dual occupancy', 'medium density housing', 'residential flat building'],
  R5: ['dwelling house', 'dual occupancy'],
  MU1: ['dwelling house', 'dual occupancy', 'medium density housing', 'residential flat building'],
  RU1: ['dwelling house', 'rural workers dwelling'],
  RU2: ['dwelling house', 'rural workers dwelling'],
  RU4: ['dwelling house', 'rural workers dwelling'],
  RU6: ['dwelling house'],
  C3: ['dwelling house'], C4: ['dwelling house'],
}

/**
 * The rule layer's land_use vocabulary and the lot's permissible_uses are
 * written differently — of 109 uses on an E4 lot only 3 match the rule
 * vocabulary exactly, and 10 match once plurals are folded. Both sides get the
 * same treatment, so over-stripping ("premises" -> "premise") is harmless: it
 * only has to be consistent.
 */
export function normaliseUse(value: string): string {
  return value.trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ies$/, 'y')
    .replace(/s$/, '')
}

export interface DcpScope {
  /** Zone codes read off the lot, split — `lzn_sym_code_p` can be "RU2, C3". */
  zones: string[]
  /** Land uses to match against rule_applicability.dimension='land_use'. */
  landUses: string[]
  /** Development types to match where a rule names no land use at all. */
  devTypes: DevType[]
}

/**
 * @param zoneCode      lzn_sym_code_p, possibly comma-separated for a split lot
 * @param permissible   the lot's own permissible_uses, already split into a list
 * @param ruleVocab     land_use values the DCP rule layer actually holds
 * @param isHeritage    whether the lot is heritage listed
 */
export function resolveDcpScope(
  zoneCode: string | null | undefined,
  permissible: string[],
  ruleVocab: string[],
  isHeritage = false,
): DcpScope {
  const zones = String(zoneCode ?? '')
    .split(',').map(z => z.trim().toUpperCase()).filter(Boolean)

  const devTypes = new Set<DevType>()
  const landUses = new Set<string>()

  for (const z of zones) {
    for (const dt of ZONE_DEV_TYPES[z] ?? []) devTypes.add(dt)
    for (const lu of ZONE_LAND_USES[z] ?? []) landUses.add(lu)
  }

  // Subdivision controls apply to any lot that could be subdivided, which is
  // every lot — the report groups them under their own heading so they are not
  // mistaken for controls on the existing dwelling.
  devTypes.add('subdivision')
  if (isHeritage) devTypes.add('heritage')

  // Anything the lot itself permits that the rule layer has controls for. This
  // is the "across all uses" half: it adds tourist accommodation, child care,
  // plant nurseries and the rest, rather than assuming every lot is a house.
  const vocab = new Map(ruleVocab.map(v => [normaliseUse(v), v.toLowerCase()]))
  for (const use of permissible) {
    const match = vocab.get(normaliseUse(use))
    if (match) landUses.add(match)
  }

  // A lot with no zone mapping still gets something rather than an empty report.
  if (!devTypes.size) devTypes.add('residential')
  if (!landUses.size) landUses.add('dwelling house')

  return { zones, landUses: [...landUses].sort(), devTypes: [...devTypes].sort() }
}

/** Headings the report groups rows under. */
export const DEV_TYPE_LABEL: Record<DevType, string> = {
  residential: 'Residential — general',
  business: 'Business & centres — general',
  rural: 'Rural & conservation — general',
  subdivision: 'Subdivision',
  community: 'Community & recreation — general',
  river_settlement: 'River settlements',
  industrial: 'Industrial — general',
  heritage: 'Heritage',
}

/**
 * The condition that selects which value of a banded control applies.
 *
 * Shared because both the report table and the LLM prompt need it and had
 * separate copies. The prompt's copy assumed a lower bound was always present
 * and rendered a control with only an upper bound as "applies at -1 storeys",
 * which is not a thing.
 *
 * Captured for the storey-based controls, which is what separates the DCP's
 * parallel clause sets — 3.3.x states 3 storeys, 3.4.x states 5, 3.5.x states
 * 6 and above. Not captured for the landscaping or site coverage bands, so
 * those still have to be presented as a range.
 */
export function conditionLabel(e: {
  condition_metric?: string | null
  condition_lo?: number | string | null
  condition_hi?: number | string | null
}): string {
  if (!e.condition_metric) return ''
  const lo = e.condition_lo == null ? null : Number(e.condition_lo)
  const hi = e.condition_hi == null ? null : Number(e.condition_hi)
  if (lo == null && hi == null) return ''
  const metric = String(e.condition_metric).replace(/_/g, ' ')
  if (lo != null && hi != null) return lo === hi ? `${lo} ${metric}` : `${lo}–${hi} ${metric}`
  if (lo != null) return `${lo}+ ${metric}`
  return `up to ${hi} ${metric}`
}

/**
 * Units each topic can sensibly be measured in.
 *
 * Only the topics whose dimension is unambiguous are listed. A setback, a width
 * and a building height are lengths; a floor space ratio is a ratio. Anything
 * else on those topics is an extraction error, and the DCP rule layer has a
 * handful: 8 setbacks in percent, 1 height in percent, 2 FSRs in parking spaces.
 *
 * Topics with a genuinely mixed dimension are deliberately absent — parking is
 * counted in spaces but its bays are measured in metres, and open space is
 * stated as an area, a percentage and a minimum dimension in the same DCP. Those
 * are not errors and must not be flagged as such.
 */
const TOPIC_UNITS: Record<string, string[]> = {
  setback: ['metre'],
  width: ['metre'],
  height: ['metre'],
  fsr: ['ratio'],
}

/**
 * True when a control's unit contradicts what its topic measures.
 *
 * The row is still shown — dropping it would hide a control that exists in the
 * DCP — but a reader must not take "setback: min 50%" at face value.
 */
export function unitLooksWrong(topic: string, unit: string | null | undefined): boolean {
  const allowed = TOPIC_UNITS[topic]
  return Boolean(allowed && unit && !allowed.includes(unit))
}

/**
 * How each rule_effect topic is named in prose.
 *
 * The prompt used to interpolate the raw column value, so the model repeated it
 * verbatim and the report said "open_space: >= 3m" to a planner. The report
 * table has its own labels; this is the same list for the prompt side.
 */
export const TOPIC_PROSE: Record<string, string> = {
  setback: 'setback',
  parking: 'car parking',
  landscaping: 'landscaping',
  open_space: 'private open space',
  site_coverage: 'site coverage',
  height: 'height',
  floor_area: 'floor area',
  lot_size: 'lot size',
  density: 'density',
  fsr: 'floor space ratio',
  width: 'width',
  privacy: 'privacy',
  solar_access: 'solar access',
  deep_soil: 'deep soil',
}

/**
 * Which storey band of the DCP applies to a lot, read off the DCP's own height table.
 *
 * Hornsby's DCP runs parallel clause sets by building scale, and each set states
 * its own maximum height against its own storey count: cl 3.3.4 is 12 m at 3
 * storeys, cl 3.4.4 is 16.5 m at 5, cl 3.5.4 is 20.5 m and up at 6+. So the
 * lot's mapped Height of Buildings value selects the set — a lot mapped at
 * 16.5 m is a 5-storey site and cl 3.4.x is the operative clause set for it.
 *
 * Derived from the table rather than assumed from a storey height, because the
 * DCP's own implied storey heights are not uniform (4.0 m, 3.3 m, 3.4 m).
 *
 * Returns null when the lot has no mapped height, or when no height control in
 * scope carries a storey condition — guessing a band would put the wrong clause
 * set in front of a planner.
 *
 * @param rules rows from the site-rules query (topic/value/condition_* needed)
 * @param mappedHeightM the lot's hob_max_b_h_m
 */
export function operativeStoreyBand(
  rules: Array<{
    topic: string
    value: number | string | null
    unit?: string | null
    condition_metric?: string | null
    condition_lo?: number | string | null
    condition_hi?: number | string | null
  }>,
  mappedHeightM: number | string | null | undefined,
): { label: string; lo: number | null; hi: number | null } | null {
  const hob = Number(mappedHeightM)
  if (!hob || Number.isNaN(hob)) return null

  const candidates = rules
    .filter(r => r.topic === 'height' && r.unit === 'metre'
      && r.condition_metric === 'storeys' && r.value != null
      && Number(r.value) <= hob
      // The sub-metre entries are floor-level and cut-and-fill controls, not
      // building heights; they would match every lot and select nothing.
      && Number(r.value) >= 5)
    .sort((a, b) => Number(b.value) - Number(a.value))

  const best = candidates[0]
  if (!best) return null

  const lo = best.condition_lo == null ? null : Number(best.condition_lo)
  const hi = best.condition_hi == null ? null : Number(best.condition_hi)
  if (lo == null && hi == null) return null

  const label = lo != null && hi != null
    ? (lo === hi ? `${lo} storeys` : `${lo}–${hi} storeys`)
    : lo != null ? `${lo}+ storeys` : `up to ${hi} storeys`
  return { label, lo, hi }
}

/** True when a control's storey condition covers the lot's operative band. */
export function matchesStoreyBand(
  e: { condition_metric?: string | null; condition_lo?: number | string | null; condition_hi?: number | string | null },
  band: { lo: number | null; hi: number | null } | null,
): boolean {
  if (!band || e.condition_metric !== 'storeys') return true  // unconditioned controls always apply
  const lo = e.condition_lo == null ? -Infinity : Number(e.condition_lo)
  const hi = e.condition_hi == null ? Infinity : Number(e.condition_hi)
  const target = band.lo ?? band.hi ?? 0
  return target >= lo && target <= hi
}
