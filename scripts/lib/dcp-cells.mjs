/**
 * Reading a DCP control table cell as a rule rather than as a number.
 *
 * Hornsby's Table 3.1.2-a is the worked example, and every part of it is a
 * trap for a plain number scan:
 *
 *   Boundary setback              | Minimum building setback
 *   Front boundary (Primary …)    | 6m to local roads and 9m to designated roads, except …
 *   Side boundary                 | Up to 1 storey = 0.9m  2 storey element = 1.5m
 *   Rear boundary                 | Up to 1 storey = 3m    2 storey element = 8m
 *   Waterfront setback            | See Clause 6.1 of HLEP Foreshore Building Line Map
 *
 *   - the row header is the DATUM. "0.9 m" is not a rule; "0.9 m from the
 *     side boundary" is. Nothing else in the cell says which boundary.
 *   - one cell holds TWO rules, separated by a storey band. A scan that
 *     takes the first number gets 1 (a storey count) and calls it a setback.
 *   - a column header can carry a band of its own ("Lots < 4,000m²").
 *   - a cell may hold no number at all and still be the rule — a deferral to
 *     another instrument or to a map layer.
 *
 * Randwick DCP 2025 adds three shapes Hornsby never uses, and readTableShape
 * below is what reads them (C2 Table 2, Table 3 and Table 4 are the workers):
 *
 *   - the row key is a BAND, so column 0 holds values like every other column.
 *     C2's Table 2 is headed "Zero to 4 storeys | 5 to 7 storeys | Top level",
 *     and its only real control — "a minimum setback of 6m setback from front
 *     property boundary" — sits in column 0, which a reader that always treats
 *     column 0 as a label never opens.
 *   - two sub-tables stacked in one grid, separated by a spanned title row
 *     ("Minimum side setback in the LMR area" … "outside the LMR area") and a
 *     repeat of the column-label row. The second block's labels are not the
 *     first's: "Zero to 4 storeys" becomes "Zero to 3 storeys".
 *   - a title row that states the datum for the rows beneath it. D12's Table C
 *     keys its setbacks on street NAMES — "Barker Street | 5.0m" — and the only
 *     thing that says these are measured from the street is the "Street
 *     frontages:" row above them.
 *
 * Everything here is deterministic and reads only what the document states.
 * Anything unrecognised returns null, so a new phrasing surfaces as a gap to
 * triage rather than as a plausible-looking wrong answer.
 */

// ── topic ──────────────────────────────────────────────────────────────

/**
 * What a control is ABOUT, matched against the words the document puts above
 * it. Order is precedence within a single text: "Minimum side setback
 * (buildings above 9.5m)" is a setback clause that mentions a height.
 */
const TOPIC_PATTERNS = [
  [/\bsetback/i, 'setback'],
  [/\bheight/i, 'height'],
  [/floor space ratio|\bfsr\b/i, 'fsr'],
  [/\blot size|subdivision/i, 'lot_size'],
  [/\bsite cover/i, 'site_coverage'],
  [/\blandscap/i, 'landscaping'],
  [/\bparking|car park/i, 'parking'],
  [/\bopen space/i, 'open_space'],
  [/\bsolar|sunlight|overshadow/i, 'solar_access'],
  [/\bprivacy/i, 'privacy'],
  [/\bdeep soil/i, 'deep_soil'],
  [/\bfloor area|\bgfa\b/i, 'floor_area'],
  // "dwelling" alone used to land here, which was tolerable while only the
  // clause's own heading was consulted and became a menace once the whole
  // heading chain was: a DCP puts the word "dwelling" above half its
  // controls, so "Controls < 4.3.4 Ceiling heights < 4. Dwelling design"
  // came out as a density control. A density control counts dwellings.
  [/\bdensit(?:y|ies)\b|\bdwellings? per\b|\bdwelling (?:yield|mix)\b|\bnumber of dwellings\b/i, 'density'],
  [/\bwidth|frontage/i, 'width'],
]

/**
 * Units each topic can actually be expressed in.
 *
 * The graph held an `fsr` effect measured in `spaces` and a `floor_area` in
 * `metre`, both from tables whose caption named two subjects at once —
 * "Table 1: Floor Space Ratio and Building Heights" gives every cell the same
 * topic however the cell is measured. A floor space ratio is a ratio; a number
 * of parking spaces is not one, and no amount of context makes it one.
 *
 * So the unit vetoes the topic rather than decorating it: a candidate topic
 * the unit cannot express is passed over for the next candidate, and if none
 * survives the effect is left `unspecified` — which is a gap someone can find,
 * where a confidently wrong topic is not. Deliberately generous, because the
 * cost of an entry that is too tight is a control that disappears: parking
 * keeps `metre` (a space is 2.4 m wide) and landscaping keeps `litre` (soil
 * volume).
 */
const TOPIC_UNITS = {
  setback: ['metre', 'millimetre', 'km'],
  height: ['metre', 'millimetre', 'storeys'],
  fsr: ['ratio'],
  // Deliberately area only: a minimum lot WIDTH is a width, not a lot size,
  // and letting metres through here made Hornsby's accessway table — under
  // "Part 6 Subdivision" — a set of lot sizes measured in metres.
  lot_size: ['sqm', 'hectare'],
  site_coverage: ['percent', 'sqm'],
  landscaping: ['percent', 'sqm', 'metre', 'millimetre', 'litre'],
  parking: ['spaces', 'dwellings', 'persons', 'sqm', 'metre', 'millimetre', 'percent'],
  open_space: ['percent', 'sqm', 'metre'],
  solar_access: ['percent', 'sqm', 'metre'],
  privacy: ['metre', 'millimetre', 'percent'],
  deep_soil: ['percent', 'sqm', 'metre'],
  floor_area: ['sqm', 'percent'],
  density: ['dwellings', 'persons', 'hectare', 'sqm', 'percent'],
  width: ['metre', 'millimetre'],
}

/** True when `topic` can be stated in `unit`. An unknown unit vetoes nothing. */
export const topicAllowsUnit = (topic, unit) =>
  !topic || !unit || !TOPIC_UNITS[topic] || TOPIC_UNITS[topic].includes(unit)

/**
 * Every topic these texts name, nearest text first.
 *
 * `texts` is ordered by how close it sits to the control: the words that
 * describe it directly, then each heading above those, outwards. The caller
 * joins the direct words into ONE first entry, so within them the order of the
 * pattern list still decides — the ancestors are a fallback for a control
 * whose own words and heading say nothing, not a second opinion about one
 * they have already described.
 *
 * Which matters because a DCP's controls hang off blocks headed "Controls",
 * and the subject is one level up: "4. Setbacks", "2.4. Site coverage", "4.5.
 * Minimum soil depth for landscaping". Randwick lost 492 of 945 effects to
 * topic 'unspecified' that way. Consulting the ancestors only where the
 * nearer text is silent is what keeps that from re-deciding controls the
 * document has already labelled.
 */
export function topicCandidates(texts) {
  const out = []
  for (const t of texts) {
    if (!t) continue
    for (const [re, topic] of TOPIC_PATTERNS) {
      if (re.test(t) && !out.includes(topic)) out.push(topic)
    }
  }
  return out
}

/**
 * The topic of one control: the nearest topic its context names that the
 * control's own unit can express. null when nothing matches, or when nothing
 * that matches fits the unit.
 */
export function topicOf(texts, unit = null) {
  const cands = topicCandidates(Array.isArray(texts) ? texts : [texts])
  return cands.find((t) => topicAllowsUnit(t, unit)) ?? null
}

/**
 * Row-header phrasing → the closed `rule_effect.measured_from` vocabulary.
 *
 * The direction word and "boundary" are not always adjacent — the document
 * writes "front property boundary" as readily as "front boundary" — and the
 * generic property_boundary pattern at the bottom will happily swallow the
 * first form, turning a specific datum into a vague one. Hence BOUND.
 */
// "street" and "road" belong in the middle slot for the same reason
// "property" does: Hornsby says "set back 6m behind the front street
// boundary", which names the front boundary and not some other one. Without
// them it fell through to the generic property_boundary, and once the road
// patterns below learned "street boundary" it would have fallen to road —
// still true, still less than the document says.
const BOUND = String.raw`(?:property |site |allotment |street |road )?(?:boundary|boundaries|setback)`
const DATUM_PATTERNS = [
  [new RegExp(String.raw`\bfront ${BOUND}|primary frontage|primary (?:road )?boundary|front building line`, 'i'), 'front_boundary'],
  [new RegExp(String.raw`\bsecondary ${BOUND}|\bsecondary (?:frontage|road|street)`, 'i'), 'secondary_boundary'],
  [new RegExp(String.raw`\bside ${BOUND}`, 'i'), 'side_boundary'],
  [new RegExp(String.raw`\brear ${BOUND}`, 'i'), 'rear_boundary'],
  [/\bwaterfront|foreshore|\bmean high water/i, 'waterfront_boundary'],
  // The same boundary said three ways. A DCP that keys a table on the road a
  // lot faces writes "Frontage to a classified road" as its row header, and
  // Randwick's town-centre parts measure from "the street edge" 44 times —
  // both name the road boundary, and both were reaching the graph with no
  // datum at all. "lane edge" is deliberately absent: a laneway is as often at
  // the rear as at the front, and road_boundary would assert which.
  [/\b(?:public )?(?:road|street) (?:boundary|reserve|edge)|street frontage|all public road/i, 'road_boundary'],
  [/\bfrontage to (?:a|the)\s+(?:\w+\s+)?(?:road|street)\b/i, 'road_boundary'],
  [/\bwatercourse|\bcreek|\briver bank|\bdam\b|\briparian/i, 'watercourse'],
  [/\badjoining (?:building|dwelling|development)|neighbouring (?:house|building|dwelling)/i, 'adjoining_building'],
  [/\bbetween buildings?|building separation|separation between/i, 'other_building'],
  // Deliberately last: a bare "boundary" only means the generic property
  // boundary once every specific boundary above has failed to match.
  [/\b(?:property|site|allotment) boundar|\bboundar/i, 'property_boundary'],
  [/\bheritage item|significant tree|landscape feature|sensitive/i, 'site_feature'],
]

/**
 * Phrases that name a MEASUREMENT AXIS, not a boundary.
 *
 * "Existing primary frontage width" is the label on a column of size bands —
 * it says what the rows are keyed on, not where a distance is measured from.
 * The `primary frontage` datum pattern matched it anyway, so Randwick's C1
 * side-setback table came out with its height-band column headers (4.5 m and
 * 7 m "from ground level") recorded as FRONT boundary setbacks, while the real
 * side setbacks in the cells below carried no datum at all.
 *
 * Stripped before datum matching rather than added as an exception to each
 * pattern, so a new axis phrase disables every datum at once instead of one.
 */
const AXIS_RE = /\b(?:existing\s+)?(?:(?:primary|secondary)\s+)?(?:street\s+)?(?:frontage|site|lot|allotment|building|wall|boundary)\s+(?:widths?|depths?|areas?|lengths?|heights?)\b/gi

/**
 * The axis a header names, and the band metric it implies.
 *
 * The phrase has to BE the header, not merely appear in it. A control cell can
 * mention an axis in passing — C2's Table 4 says "Setback to be a minimum of
 * 15% of the site depth, or 5m, whichever is the greater" — and reading that
 * as an axis header turned the row holding Randwick's medium-density rear
 * setback into a label row, so the table yielded nothing at all. Same trap in
 * Part 10's glossary, where "lot size (or site area)" heads a definition.
 *
 * The allowance is for a unit or a short qualifier after the phrase — "Site
 * width (m)", "Existing primary frontage width" — and nothing longer.
 */
export function axisOf(text) {
  if (!text) return null
  AXIS_RE.lastIndex = 0
  const m = AXIS_RE.exec(text)
  if (!m) return null
  // The phrase has to head the cell and finish it: at most a qualifier before
  // ("Minimum site width") and a unit after ("Site width (m)"). Part 10's
  // glossary entry "lot size (or site area)" names an axis in its parenthesis
  // and is a definition, not a header.
  if (m.index > 10 || text.trim().length > m.index + m[0].length + 12) return null
  const phrase = m[0].toLowerCase()
  if (/areas?$/.test(phrase)) return { metric: 'lot_size', unit: 'sqm' }
  if (/depths?$/.test(phrase)) return { metric: 'lot_depth', unit: 'metre' }
  if (/heights?$/.test(phrase)) return { metric: 'building_height', unit: 'metre' }
  // Width, of whatever it is measured across. A frontage width is the one that
  // actually keys a control table; a bare "site width" is the same axis.
  return { metric: 'frontage_width', unit: 'metre' }
}

/**
 * Which boundary (or feature) a distance is measured from.
 * Reads a row header, a heading, or a line of prose. null when unrecognised.
 */
export function datumOf(...texts) {
  const hay = texts.filter(Boolean).join(' ').replace(AXIS_RE, ' ')
  if (!hay.trim()) return null
  for (const [re, datum] of DATUM_PATTERNS) if (re.test(hay)) return datum
  return null
}

/** Datums specific enough to inherit from a heading — see headingDatum. */
const SPECIFIC_DATUMS = new Set([
  'front_boundary', 'side_boundary', 'rear_boundary', 'secondary_boundary',
  'waterfront_boundary', 'road_boundary',
])

/**
 * The datum a clause heading states, for cells whose own row header gives none.
 *
 * Deliberately narrower than datumOf. Falling back to a table CAPTION is
 * unsafe — every row of "Minimum boundary setbacks …" would inherit
 * `property_boundary`, which is how a specific datum becomes a vague one — so
 * only a specific boundary is inherited, never the generic. A heading that
 * says "3.3.2 Side setbacks" is naming the datum for everything beneath it,
 * and without this Randwick's 0.9 m and 1.2 m side setbacks were stored with
 * no boundary and could never be applied to one.
 */
export function headingDatum(...texts) {
  const d = datumOf(...texts)
  return d && SPECIFIC_DATUMS.has(d) ? d : null
}

/**
 * The datum belonging to ONE number, read from the words that follow it.
 *
 * A row header is not always where the datum lives: Hornsby's basement
 * parking rows are headed "Basement Parking Setback" — the subject, not the
 * datum — and put it in the cell, "8m from the front boundary and 4m from
 * all other boundaries". That is two rules with two different datums in one
 * cell, so the window is cut at the next number; a fixed-width lookahead
 * would let the first pattern in the list claim both.
 */
export function datumAt(text, index, raw) {
  return datumOf(datumWindow(text, index, raw))
}

/** The words a number's datum would be read from — see datumAt. */
function datumWindow(text, index, raw) {
  const from = index + String(raw).length
  const rest = text.slice(from, from + 90)
  const next = /(?<![\w.,])\d/.exec(rest.slice(1))
  return next ? rest.slice(0, next.index + 1) : rest
}

/**
 * A datum the document states and the vocabulary cannot hold.
 *
 * `measured_from` is a closed list of boundaries and site features. Randwick's
 * upper-level setbacks are measured from neither: C2's Table 2 says "Provide
 * 3m setback from predominant building alignment to the primary street
 * frontage" and its Table 3 says "1m setback from level below" — a step-back
 * from the storey underneath, not a distance from a boundary.
 *
 * Both were being stamped with the clause's boundary, because a number whose
 * own words yielded nothing fell back to the row header or the heading. So C2
 * gained a 3 m front setback and a 1 m side setback that no lot has. The
 * second one is worse than the first: "from the primary street frontage" is
 * even in the sentence, so datumAt read `road_boundary` off it.
 *
 * Recognised by the phrase the document uses, and only ahead of any boundary
 * it names, so "6m setback from front property boundary" is untouched. The
 * caller writes NULL and records the gap.
 */
const RELATIVE_DATUM_RE = /\bfrom (?:the )?(?:predominant\b[\w ]*?(?:alignment|building line)|(?:level|storey|floor|podium) below)/i

/** The relative-datum phrase governing this number, or null. */
export function relativeDatumAt(text, index, raw) {
  const win = datumWindow(text, index, raw)
  const rel = RELATIVE_DATUM_RE.exec(win)
  if (!rel) return null
  // A boundary named BEFORE the relative phrase is this number's datum; the
  // relative phrase then belongs to something later in the sentence.
  const head = win.slice(0, rel.index)
  return datumOf(head) ? null : rel[0].trim()
}

/**
 * A control that is the smaller — or the larger — of two expressions.
 *
 * Randwick C1's rear setback is "25% of the allotment depth or 8m, whichever
 * is the lesser"; C2's Table 4 says "a minimum of 15% of the site depth, or
 * 5m, whichever is the greater". `rule_effect` holds a value, not an
 * expression, so neither is fully storable and both are worth a gap.
 * ("lessor" is not a typo: Table 4 spells it that way.)
 */
export const statesTieBreak = (text) =>
  /\bwhichever is the (?:lesser|lessor|greater|lower|higher)\b/i.test(text ?? '')

/**
 * …and of those, the half where the stated number is not even true.
 *
 * A MINIMUM that is "8m or 25% of the depth, whichever is the lesser" is 7.5 m
 * on a 30 m lot, so storing 8 asserts a setback the DCP does not require. A
 * minimum that is "10m or the neighbours' average, whichever is the greater"
 * is at least 10 m on every lot, so storing 10 is true — understated, but
 * true, and it is Hornsby's rural front setback. Skipping both threw that one
 * away, which is why only the inverting half is skipped; the other is stored
 * and carries a `computed_control` finding saying it is a floor, not the
 * whole rule.
 */
export const tieBreakInvertsValue = (text) =>
  /\bwhichever is the (?:lesser|lessor|lower)\b/i.test(text ?? '')

/**
 * A control stated as a proportion of a lot dimension, for the prose gap log.
 *
 * Not a reason to skip a cell: a bare percentage IS a control this schema can
 * hold — Hornsby's "Maximum floor area of dwelling house | 90% of the lot
 * area" is 90 percent, exactly and completely.
 */
export const statesPercentageOf = (text) =>
  /\d+\s*(?:%|per\s*cent|percent)\s+of\s+the\s+\w+\s*(?:depth|width|area|frontage|length)/i.test(text ?? '')

/** Vertical datum a height is measured above, as the document words it. */
const GROUND_RE = /\b((?:existing|natural|finished|original)\s+ground\s+level)\b/i
export function groundDatumOf(...texts) {
  for (const t of texts) {
    const m = t && GROUND_RE.exec(t)
    if (m) return m[1].toLowerCase()
  }
  return null
}

// ── size bands ─────────────────────────────────────────────────────────
// A band lives in a header: "Lots < 4,000m 2", "700m 2 to 2,000m 2",
// ">2,000m 2". Written with its own comma-aware number pattern because the
// shared candidate finder splits "4,000" into 4 and 000.

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`
const num = (s) => Number(String(s).replace(/,/g, ''))

/** 'm 2' and 'm2' are how m² survives text extraction. */
const AREA_UNIT = String.raw`(?:m\s*2|m²|sqm|square\s*metres?)`
const LEN_UNIT = String.raw`(?:m\b|metres?)`

const BAND_PATTERNS = [
  // "700m2 to 2,000m2"   |  "between 700m2 and 2,000m2"
  [new RegExp(String.raw`${NUM}\s*${AREA_UNIT}\s*(?:to|–|—|-|and)\s*${NUM}\s*${AREA_UNIT}`, 'i'),
    (m) => ({ lo: num(m[1]), hi: num(m[2]) })],
  // "< 4,000m2"  |  "less than 4,000m2"  |  "under 4,000m2"
  [new RegExp(String.raw`(?:<|less than|under|below|up to)\s*${NUM}\s*${AREA_UNIT}`, 'i'),
    (m) => ({ lo: null, hi: num(m[1]) })],
  // "> 4,000m2"  |  "greater than 4,000m2"  |  "4,000m2 or greater"
  [new RegExp(String.raw`(?:>|greater than|more than|over|above|at least)\s*${NUM}\s*${AREA_UNIT}`, 'i'),
    (m) => ({ lo: num(m[1]), hi: null })],
  [new RegExp(String.raw`${NUM}\s*${AREA_UNIT}\s*(?:or (?:greater|more|above)|and (?:above|over))`, 'i'),
    (m) => ({ lo: num(m[1]), hi: null })],
]

/**
 * A lot-size band stated in a header, or null.
 * Returns { metric:'lot_size', lo, hi, unit:'sqm' } with lo inclusive.
 */
export function parseSizeBand(text) {
  if (!text) return null
  for (const [re, read] of BAND_PATTERNS) {
    const m = re.exec(text)
    if (m) return { metric: 'lot_size', unit: 'sqm', ...read(m) }
  }
  return null
}

/**
 * The same bands, measured in metres rather than square metres.
 *
 * Randwick keys its side setbacks on frontage width — "Less than 6m", "6m to
 * less than 9m", "9m to less than 12m", "12m and above" — and every one of
 * those row headers parsed as nothing, so the 0.9 m and 1.2 m setbacks beneath
 * them were stored unconditioned. Four different controls that look identical
 * and apply to different lots.
 *
 * The metric is supplied by the caller rather than guessed: a bare "6m to less
 * than 9m" does not say whether it bands frontage width, lot depth or building
 * height. The axis is named in the header above it, which is where axisOf
 * reads it from.
 */
const LEN = String.raw`(\d+(?:\.\d+)?)\s*(?:m\b|metres?)`
const LENGTH_BAND_PATTERNS = [
  // "6m to less than 9m"  |  "6m to 9m"  |  "between 6m and 9m"
  [new RegExp(String.raw`${LEN}\s*(?:to|–|—|-|and)\s*(?:less than\s*|under\s*)?${LEN}`, 'i'),
    (m) => ({ lo: Number(m[1]), hi: Number(m[2]) })],
  [new RegExp(String.raw`(?:<|less than|under|below|up to)\s*${LEN}`, 'i'),
    (m) => ({ lo: null, hi: Number(m[1]) })],
  [new RegExp(String.raw`(?:>|greater than|more than|over|above|at least)\s*${LEN}`, 'i'),
    (m) => ({ lo: Number(m[1]), hi: null })],
  [new RegExp(String.raw`${LEN}\s*(?:or (?:greater|more|above|wider)|and (?:above|over|greater))`, 'i'),
    (m) => ({ lo: Number(m[1]), hi: null })],
]

export function parseLengthBand(text, metric = 'frontage_width') {
  if (!text) return null
  // An area band wins: "700m2 to 2,000m2" also matches the length pattern once
  // the superscript is lost, and it is a lot size, not a width.
  if (parseSizeBand(text)) return null
  for (const [re, read] of LENGTH_BAND_PATTERNS) {
    const m = re.exec(text)
    if (m) return { metric, unit: 'metre', ...read(m) }
  }
  return null
}

/**
 * A band measured up the building rather than across the lot.
 *
 * Randwick's side-setback columns are "Setback up to 4.5m from ground level",
 * "between 4.5m to 7m from ground level", "above 7m from ground level" — the
 * setback grows with height up the wall. Those numbers are the band, not the
 * setback, and reading them as distances is what put a 7 m front setback on
 * every low-density Randwick lot.
 */
export function parseHeightBand(text) {
  if (!text || !/\b(?:from|above|over)\s+(?:existing\s+|natural\s+|finished\s+)?ground\s*level/i.test(text)) {
    return null
  }
  const band = parseLengthBand(text, 'height_above_ground')
  return band ?? { metric: 'height_above_ground', unit: 'metre', lo: null, hi: null }
}

// ── storey bands inside a single cell ──────────────────────────────────
// "Up to 1 storey = 0.9m   2 storey element = 1.5m" is two rules. The
// storey number is the CONDITION and the metre value is the effect, which
// is exactly the pair a left-to-right number scan inverts.

// The open-ended qualifier can sit on either side of the noun — a cell says
// "2 storey element" and "4th storey and above", but a heading says "6 or
// more storeys". Matching only the trailing form silently dropped the
// heading that separates Hornsby's 6+ storey flat buildings from its 3- and
// 5-storey ones, which is the whole distinction between those clauses.
const OPEN = String.raw`or more|or greater|and above|or above|and over|and higher|\+`
// A closed range written across the noun, which Randwick's column headers use
// and Hornsby's cells never do: "Zero to 4 storeys", "5 to 7 storeys", "1-2
// storey dwellings". Without it only the SECOND number matched, so C2's front
// setback for zero-to-four storeys was recorded as applying at exactly four —
// invisible to a query about a two-storey house, which is most of them.
const RANGE = String.raw`(?:(zero|\d+)\s*(?:to|–|—|-)\s*)?`
const STOREY_BAND_RE = new RegExp(
  RANGE +
  String.raw`(up to|maximum of|max\.?|more than|greater than|above|at least)?\s*` +
  // 'ys' before 'y': alternation is ordered, so `store(?:y|ys|ies)` matched
  // "storey" out of "storeys" and left the trailing "s" between the noun and
  // the qualifier. "4 storeys and above" then had no tail to read and was
  // recorded as exactly four storeys — the open-ended band silently closed.
  String.raw`(\d+)\s*(?:st|nd|rd|th)?\s*(${OPEN})?\s*store(?:ys|ies|y)` +
  String.raw`\s*(element|${OPEN})?`, 'gi')

/**
 * Split a cell into segments, one per storey band.
 *
 * Returns [{ text, condition }] where condition is null when the cell has no
 * band (the common case) — so a caller can treat every cell the same way.
 */
export function splitStoreyBands(cell) {
  if (!cell) return []
  STOREY_BAND_RE.lastIndex = 0
  const hits = []
  let m
  while ((m = STOREY_BAND_RE.exec(cell)) !== null) {
    hits.push({
      index: m.index, end: m.index + m[0].length,
      from: m[1], lead: m[2], n: Number(m[3]), tail: m[4] || m[5],
    })
  }
  if (!hits.length) return [{ text: cell, condition: null, bandSpans: [] }]

  const out = []
  for (const [i, h] of hits.entries()) {
    const to = i + 1 < hits.length ? hits[i + 1].index : cell.length
    const lead = (h.lead || '').toLowerCase()
    const tail = (h.tail || '').toLowerCase()
    let lo = h.n, hi = h.n
    if (h.from) { lo = /zero/i.test(h.from) ? 0 : Number(h.from); hi = h.n }
    else if (/up to|maximum|max/.test(lead)) { lo = null; hi = h.n }
    else if (/more than|greater than|above/.test(lead)) { lo = h.n + 1; hi = null }
    else if (new RegExp(OPEN).test(tail)) { lo = h.n; hi = null }
    out.push({
      text: cell.slice(h.index, to),
      condition: { metric: 'storeys', unit: 'storeys', lo, hi },
      // Offsets of the band phrase itself, relative to the segment, so the
      // caller can drop the storey number from the values it reads.
      bandSpans: [[0, h.end - h.index]],
    })
  }
  // Anything before the first band belongs to no band.
  if (hits[0].index > 0) {
    const head = cell.slice(0, hits[0].index).trim()
    if (head) out.unshift({ text: head, condition: null, bandSpans: [] })
  }
  return out
}

/**
 * The band a CLAUSE HEADING puts on everything beneath it.
 *
 * Hornsby splits residential flat buildings across three sibling clauses —
 * "3.3 Residential Flat Buildings (3 Storeys)", "3.4 … (5 Storeys)",
 * "3.5 … (6 or more storeys)" — so all three carry setbacks for the same
 * land use and only the heading says which is which. Without it a query for
 * "setbacks for a residential flat building" returns front-boundary values
 * of 6, 8, 9, 10 and 12 m with nothing to choose between them.
 *
 * Headings are given nearest-first; the closest qualifier wins.
 */
export function headingBand(headings) {
  for (const h of headings) {
    if (!h) continue
    const segs = splitStoreyBands(h)
    const hit = segs.find((s) => s.condition)
    if (hit) return hit.condition
  }
  return null
}

/** The storey band a HEADER states, for a column keyed on storeys. */
export function storeyBandOf(text) {
  if (!text) return null
  return splitStoreyBands(text).find((s) => s.condition)?.condition ?? null
}

/**
 * A band with at least one bound, whatever it is measured in.
 *
 * parseHeightBand answers "this column is keyed on height above ground" even
 * when it cannot read the numbers, and that answer selects nothing: as a
 * condition it fails rule_effect's own check constraint, and as a column key
 * it would say a header like "Above ground level open car parking, car ports
 * and garages" bands its column. Half-open is fine — "12m and above" has no
 * upper bound and is still a band.
 */
const isUsableBand = (b) => !!b && (b.lo != null || b.hi != null)
const bandOf = (text) => {
  const b = parseSizeBand(text) ?? parseHeightBand(text) ?? storeyBandOf(text)
  return isUsableBand(b) ? b : null
}

// ── which condition survives ───────────────────────────────────────────
//
// `rule_effect` holds ONE condition, and Randwick's tables state two: C1's
// side setbacks are banded on frontage width down the side AND on height above
// ground across the top; C2's are banded on site width AND on storeys. Only
// one can be stored, so the choice has to be made on a stated principle rather
// than on whichever the loop happened to read last, and the other has to be
// recorded rather than dropped in silence.
//
//   1  a band stated INSIDE the cell is inseparable from its value. "Up to 1
//      storey = 0.9m  2 storey element = 1.5m" is one cell holding two
//      controls; take that band away and they are two setbacks with nothing to
//      choose between them.
//   2  then a band on a fact of the LOT — frontage width, lot size, lot depth.
//      A resolver holding a parcel can evaluate it before any design exists,
//      which is what makes the control selectable.
//   3  then a band on a fact of the PROPOSAL — storeys, height above ground.
//      True, but only checkable once there is a building to check.
//
// Keeping (2) above (3) is also what stops C1's side setbacks from flipping
// off frontage width — the axis the envelope generator filters on — and onto
// the height-above-ground columns, once those columns are read at all.
const LOT_METRICS = new Set(['lot_size', 'frontage_width', 'lot_depth'])
const condRank = (c) => (!c ? 9 : c.fromCell ? 0 : LOT_METRICS.has(c.metric) ? 1 : 2)

/**
 * The condition to store, and the ones that had to be dropped.
 * Candidates are given nearest-first within each rank; ranking is stable.
 */
export function chooseCondition(candidates) {
  const live = candidates.filter(isUsableBand)
  if (!live.length) return { condition: null, dropped: [] }
  const sorted = [...live].sort((a, b) => condRank(a) - condRank(b))
  const [best, ...rest] = sorted
  return {
    condition: best,
    // Only a DIFFERENT axis is a lost dimension; a second band on the same
    // metric is the same question asked twice.
    dropped: rest.filter((c) => c.metric !== best.metric),
  }
}

// ── the shape of a control table ───────────────────────────────────────

/**
 * Which rows label, which rows state controls, and where the values start.
 *
 * `hasValue` is injected rather than imported because the number detector is
 * the rule layer's, shared with the recall verifier, and lives in TypeScript;
 * importing it here would break every plain-node script that uses this file.
 * The caller passes the same predicate the extraction loop uses, so a row can
 * never be called a label while the loop would have read a control out of it.
 *
 * Returns one entry per row: { role, labels, firstDataCol, title }.
 */
export function readTableShape(headers = [], rows = [], hasValue = () => false) {
  // A row is a column-label row when it bands at least two of its columns and
  // states no control of its own. One band is not enough: Hornsby's site
  // coverage tables are rows of "1500m² to 3999m² | 30%", where the row key is
  // a band and the cell beside it is the control — calling that a label row
  // would delete the table.
  const isLabelRow = (row = []) => {
    const cells = row.filter((c) => (c ?? '').trim())
    if (cells.length < 2) return false
    if (cells.some((c) => hasValue(c))) return false
    return cells.filter((c) => bandOf(c)).length >= 2
  }
  // A spanned title ("Minimum side setback in the LMR area" in all four
  // columns) or a lone sub-heading ("Street frontages:", "Attached
  // dwellings"). Guarded by hasValue for the same reason as above.
  const isTitleRow = (row = []) => {
    const cells = (row ?? []).map((c) => (c ?? '').trim())
    if (!cells[0]) return false
    const filled = cells.filter(Boolean)
    if (filled.some((c) => hasValue(c))) return false
    if (filled.length === 1) return true
    return filled.length === cells.length && new Set(filled).size === 1
  }

  // Column 0 holds values when its own label is a band. Hornsby's Table
  // 2.1.2-a is headed "Property Boundary | Lots < 4,000m² | Lots > 4,000m²":
  // two of its three labels are bands, and column 0 is still the datum.
  const dataColOf = (labels) => (bandOf(labels?.[0] ?? '') ? 0 : 1)

  let labels = headers.length ? headers : (rows[0] ?? [])
  let firstDataCol = dataColOf(labels)
  let rowAxis = axisOf(headers[0] ?? '')
  let title = null
  const out = []

  for (const [ri, row] of rows.entries()) {
    const a = axisOf(row?.[0] ?? '')
    // An axis in column 0 names what the row keys below it are measured on.
    // Read from the top of the table as before; further down only where the
    // table has already declared that axis, which is what a stacked sub-table
    // does — C2's Table 3 repeats "Site width | Zero to 3 storeys | …" at row
    // 5 to start its non-LMR block. Accepting a first axis from anywhere would
    // turn Part 10's glossary ("lot size (or site area) | In relation to …")
    // into a header row 3 rows into a table of definitions.
    const axisHere = a && (ri < 3 || (rowAxis && a.metric === rowAxis.metric))
    if (axisHere || isLabelRow(row)) {
      labels = row
      firstDataCol = axisHere ? 1 : dataColOf(row)
      rowAxis ??= a
      out[ri] = { role: 'header', labels, firstDataCol, title }
      continue
    }
    if (isTitleRow(row)) {
      title = row[0]
      out[ri] = { role: 'title', labels, firstDataCol, title }
      continue
    }
    out[ri] = { role: 'data', labels, firstDataCol, title }
  }
  return { rowAxis, rows: out }
}

/**
 * A mapped area code used as a table's row key.
 *
 * "Translations of Height to Storeys" is keyed on HLEP Area — `K`, `M`,
 * `T2`, `O2`, `AA` — the letter the Height of Buildings Map assigns a
 * parcel. It is the only thing that makes 10.5 m the answer rather than
 * 20.5 m, and it cannot be resolved without a parcel, which is exactly why
 * it must be recorded rather than quietly dropped.
 *
 * Deliberately strict: one or two capitals with an optional digit, and only
 * when the table announces itself as area-keyed. A looser rule would swallow
 * every short row header in the document.
 */
const AREA_CODE_RE = /^([A-Z]{1,2}\d?)$/
const AREA_HEADER_RE = /\b(?:HLEP|LEP)?\s*Area\b/i

/**
 * Does this table key its rows on a mapped area?
 *
 * Checked against the caption and the first row as well as the parsed
 * headers, because most of these tables are built from <td> rather than
 * <th>: the parser then finds no header row, "HLEP Area" arrives as
 * ordinary body text, and a headers-only test sees nothing. Only the one
 * area-keyed table in Part 4 was being recognised for that reason.
 */
export const isAreaKeyed = (headers = [], caption = '', firstRow = []) =>
  [...headers, ...firstRow].some((h) => AREA_HEADER_RE.test(h ?? ''))
  || /translations? of height/i.test(caption ?? '')

/**
 * The area code a row is keyed on, given that its table is area-keyed.
 * `keyed` is passed in rather than recomputed so the decision is made once
 * per table and cannot differ between rows.
 */
export function mapAreaOf(rowHeader, keyed) {
  if (!rowHeader || !keyed) return null
  const m = AREA_CODE_RE.exec(rowHeader.trim())
  // 'HLEP Area' is the header row leaking into the body, not an area code.
  return m && !/^(AREA|MAP|LEP)$/i.test(m[1]) ? m[1] : null
}

/**
 * The unit a column header declares, for cells that carry only a number.
 *
 * "Translations of Height to Storeys" writes the height as a bare `8.5` and
 * puts the unit in the column: `Maximum Building Height (m)`. A scan of the
 * cell alone sees an unqualified number, discards it as noise, and the
 * document's own height table yields nothing — which is what happened to
 * every one of these tables except the single Part 4 one that happened to
 * write "8.5m" in the cell.
 */
const HEADER_UNIT = [
  [/\(\s*m\s*2\s*\)|\(\s*m²\s*\)|\bsqm\b|square\s*metres?/i, 'm2'],
  [/\(\s*m\s*\)|\bmetres?\b/i, 'm'],
  [/\(\s*%\s*\)|\bper\s*cent\b|\bpercent\b/i, '%'],
  [/\bstoreys?\b/i, ' storeys'],
  [/\bha\b|\bhectares?\b/i, 'ha'],
  [/\bspaces?\b/i, ' spaces'],
]

export function headerUnit(...headers) {
  const hay = headers.filter(Boolean).join(' ')
  if (!hay) return null
  for (const [re, u] of HEADER_UNIT) if (re.test(hay)) return u
  return null
}

/** A cell holding nothing but a number, which is what needs the header's unit. */
export const isBareNumber = (cell) => /^\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*$/.test(cell ?? '')

/**
 * A cell whose value is an expression, not a number.
 *
 * Randwick's side setbacks grow with wall height, and the upper cells of the
 * table say so in algebra: "0.9𝑚 +(𝑏𝑢𝑖𝑙𝑑𝑖𝑛𝑔 ℎ𝑒𝑖𝑔ℎ𝑡 -7𝑚)". Every number in
 * there is an operand — the 7 is the height the extra setback is measured
 * from, the 0.9 only the base — so reading them as setbacks yields values that
 * are true of no lot.
 *
 * Detected by the character block rather than by the arithmetic: the PDF sets
 * these in maths italic, so the variables arrive as Mathematical Alphanumeric
 * Symbols (U+1D400–U+1D7FF) and Letterlike Symbols (ℎ, U+210E), which ordinary
 * cell prose never uses. That is a far more reliable signal than looking for a
 * '+', which appears in "3+ storeys".
 */
const MATH_CHARS_RE = /[\u{1D400}-\u{1D7FF}\u{2100}-\u{214F}]/u
export const isFormulaCell = (cell) => MATH_CHARS_RE.test(cell ?? '')

// ── deferrals ──────────────────────────────────────────────────────────
// "See Clause 6.1 of HLEP Foreshore Building Line Map" carries no number and
// is still the rule: the value lives in another instrument or on a map.

const MAP_RE = /\b([A-Z][A-Za-z' ]{2,40}?\s+Map)\b/
const CLAUSE_REF_RE = /\b(?:see\s+)?(?:cl(?:ause)?\.?\s*([0-9]+(?:\.[0-9]+)*))\s*(?:of\s+(?:the\s+)?([A-Z][A-Za-z ]{2,40}))?/i

/**
 * Where a cell sends you instead of giving a number.
 * { map_layer } and/or { value_source }, or null.
 */
export function parseDeferral(cell) {
  if (!cell) return null
  const out = {}
  const map = MAP_RE.exec(cell)
  if (map) out.map_layer = map[1].trim()
  const ref = CLAUSE_REF_RE.exec(cell)
  if (ref && /\bsee\b|\bin accordance\b|\bcompl(?:y|ies)\b|\brefer\b/i.test(cell)) {
    out.value_source = ref[2] ? `${ref[2].trim()} cl ${ref[1]}` : `cl ${ref[1]}`
  }
  return Object.keys(out).length ? out : null
}

/** 'Table 3.1.2-a: Minimum boundary setbacks …' → 'Table 3.1.2-a' */
export function tableNoOf(caption) {
  const m = caption && /\b(Table\s+[0-9]+(?:\.[0-9]+)*(?:-[a-z])?)/i.exec(caption)
  return m ? m[1].replace(/\s+/g, ' ') : null
}
