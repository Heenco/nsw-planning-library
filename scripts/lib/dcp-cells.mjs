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
 * Everything here is deterministic and reads only what the document states.
 * Anything unrecognised returns null, so a new phrasing surfaces as a gap to
 * triage rather than as a plausible-looking wrong answer.
 */

/**
 * Row-header phrasing → the closed `rule_effect.measured_from` vocabulary.
 *
 * The direction word and "boundary" are not always adjacent — the document
 * writes "front property boundary" as readily as "front boundary" — and the
 * generic property_boundary pattern at the bottom will happily swallow the
 * first form, turning a specific datum into a vague one. Hence BOUND.
 */
const BOUND = String.raw`(?:property |site |allotment )?(?:boundary|boundaries|setback)`
const DATUM_PATTERNS = [
  [new RegExp(String.raw`\bfront ${BOUND}|primary frontage|primary (?:road )?boundary|front building line`, 'i'), 'front_boundary'],
  [new RegExp(String.raw`\bsecondary ${BOUND}|\bsecondary (?:frontage|road|street)`, 'i'), 'secondary_boundary'],
  [new RegExp(String.raw`\bside ${BOUND}`, 'i'), 'side_boundary'],
  [new RegExp(String.raw`\brear ${BOUND}`, 'i'), 'rear_boundary'],
  [/\bwaterfront|foreshore|\bmean high water/i, 'waterfront_boundary'],
  [/\b(?:public )?road (?:boundary|reserve|edge)|street frontage|all public road/i, 'road_boundary'],
  [/\bwatercourse|\bcreek|\briver bank|\bdam\b|\briparian/i, 'watercourse'],
  [/\badjoining (?:building|dwelling|development)|neighbouring (?:house|building|dwelling)/i, 'adjoining_building'],
  [/\bbetween buildings?|building separation|separation between/i, 'other_building'],
  // Deliberately last: a bare "boundary" only means the generic property
  // boundary once every specific boundary above has failed to match.
  [/\b(?:property|site|allotment) boundar|\bboundar/i, 'property_boundary'],
  [/\bheritage item|significant tree|landscape feature|sensitive/i, 'site_feature'],
]

/**
 * Which boundary (or feature) a distance is measured from.
 * Reads a row header, a heading, or a line of prose. null when unrecognised.
 */
export function datumOf(...texts) {
  const hay = texts.filter(Boolean).join(' ')
  if (!hay) return null
  for (const [re, datum] of DATUM_PATTERNS) if (re.test(hay)) return datum
  return null
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
  const from = index + String(raw).length
  const rest = text.slice(from, from + 90)
  const next = /(?<![\w.,])\d/.exec(rest.slice(1))
  return datumOf(next ? rest.slice(0, next.index + 1) : rest)
}

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
const STOREY_BAND_RE = new RegExp(
  String.raw`(up to|maximum of|max\.?|more than|greater than|above|at least)?\s*` +
  String.raw`(\d+)\s*(?:st|nd|rd|th)?\s*(${OPEN})?\s*store(?:y|ys|ies)` +
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
      lead: m[1], n: Number(m[2]), tail: m[3] || m[4],
    })
  }
  if (!hits.length) return [{ text: cell, condition: null, bandSpans: [] }]

  const out = []
  for (const [i, h] of hits.entries()) {
    const to = i + 1 < hits.length ? hits[i + 1].index : cell.length
    const lead = (h.lead || '').toLowerCase()
    const tail = (h.tail || '').toLowerCase()
    let lo = h.n, hi = h.n
    if (/up to|maximum|max/.test(lead)) { lo = null; hi = h.n }
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
