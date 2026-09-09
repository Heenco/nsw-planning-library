/**
 * Assertions for the cell readers in lib/dcp-cells.mjs, against the literal
 * table and prose forms both ingested DCPs actually contain.
 *
 *   npx tsx scripts/dcp-cells-check.mjs
 *
 * Every case below is copied out of a document, not invented, and each one is
 * a defect that reached the graph: the Hornsby cases are the ones that must
 * keep parsing identically, because Hornsby is the regression control and is
 * never re-ingested to find out. The Randwick cases are the ones that were
 * wrong. Where a case exists to protect an older fix, the comment says which.
 *
 * Run under tsx rather than node so the number detector — which is the rule
 * layer's, in TypeScript, and shared with the recall verifier — is the real
 * one and not a second opinion.
 */
import {
  topicOf, topicCandidates, topicAllowsUnit, datumOf, datumAt, headingDatum,
  relativeDatumAt, statesTieBreak, tieBreakInvertsValue, statesPercentageOf,
  axisOf, parseSizeBand, parseLengthBand, parseHeightBand, splitStoreyBands,
  storeyBandOf, isFormulaCell, readTableShape, chooseCondition, headerUnit,
} from './lib/dcp-cells.mjs'
import { findNumberCandidates } from '../server/utils/nsw-kg/verifiers/candidates'

let pass = 0
const fails = []
const eq = (label, got, want) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fails.push(`${label}\n     got  ${g}\n     want ${w}`)
}

/** The same predicate the ingest hands readTableShape. Kept in step by name. */
const statesValue = (text) => {
  if (!text || isFormulaCell(text)) return false
  for (const seg of splitStoreyBands(text)) {
    for (const c of findNumberCandidates(seg.text)) {
      if (seg.condition && c.unit === 'storeys') continue
      return true
    }
  }
  return false
}
const shapeOf = (headers, rows) => readTableShape(headers, rows, statesValue)
const roles = (shape) => shape.rows.map((r) => r.role)
/** What the cell loop would read out of one cell of one row. */
const valuesIn = (cell) => splitStoreyBands(cell).flatMap((seg) =>
  findNumberCandidates(seg.text)
    .filter((c) => !(seg.condition && c.unit === 'storeys'))
    .map((c) => `${c.value}${c.unit ?? ''}`))

// ── HORNSBY — must not change ──────────────────────────────────────────
// Table 3.1.2-a: Minimum boundary setbacks for dwellings and dual occupancies.
// The worked example in the header comment of dcp-cells.mjs.
{
  const headers = ['Boundary setback', 'Minimum building setback']
  const rows = [
    ['Front boundary (Primary frontage)', '6m to local roads and 9m to designated roads, except where a different setback is prescribed'],
    ['Side boundary', 'Up to 1 storey = 0.9m 2 storey element = 1.5m'],
    ['Rear boundary', 'Up to 1 storey = 3m 2 storey element = 8m'],
    ['Waterfront setback', 'See Clause 6.1 of HLEP Foreshore Building Line Map'],
  ]
  const shape = shapeOf(headers, rows)
  eq('H 3.1.2-a: every row is data', roles(shape), ['data', 'data', 'data', 'data'])
  eq('H 3.1.2-a: column 0 is the datum, not a value', shape.rows.map((r) => r.firstDataCol), [1, 1, 1, 1])
  eq('H 3.1.2-a: no axis', shape.rowAxis, null)
  eq('H 3.1.2-a: front row datum', datumOf(rows[0][0]), 'front_boundary')
  eq('H 3.1.2-a: side row datum', datumOf(rows[1][0]), 'side_boundary')
  eq('H 3.1.2-a: rear row datum', datumOf(rows[2][0]), 'rear_boundary')
  eq('H 3.1.2-a: waterfront row datum', datumOf(rows[3][0]), 'waterfront_boundary')
  // The storey band is the CONDITION and the metre value is the effect. A
  // left-to-right scan inverts exactly this pair.
  eq('H 3.1.2-a: side cell splits into two banded rules',
    splitStoreyBands(rows[1][1]).map((s) => [s.condition?.lo ?? null, s.condition?.hi ?? null]),
    [[null, 1], [2, 2]])
  eq('H 3.1.2-a: side cell values', valuesIn(rows[1][1]), ['0.9metre', '1.5metre'])
  eq('H 3.1.2-a: rear cell values', valuesIn(rows[2][1]), ['3metre', '8metre'])
  // "8m from the front boundary and 4m from all other boundaries" — the two
  // datums in one cell belong to different numbers.
  const two = '8m from the front boundary and 4m from all other boundaries'
  eq('H basement parking: first number\'s datum', datumAt(two, 0, '8'), 'front_boundary')
  eq('H basement parking: second number\'s datum', datumAt(two, two.indexOf('4m'), '4'), 'property_boundary')
}

// Table 2.1.2-a: Minimum Boundary Setbacks — the header row that bands two of
// its three columns while column 0 is still the datum. If "at least two cells
// state a band" alone decided where the values start, this table would be read
// sideways and every rural boundary setback would be lost.
{
  const headers = ['Property Boundary', 'Lots < 4,000m 2', 'Lots > 4,000m 2']
  const rows = [['Front boundary', '10m', '30m'], ['Side boundary', '2m', '10m']]
  const shape = shapeOf(headers, rows)
  eq('H 2.1.2-a: rows are data', roles(shape), ['data', 'data'])
  eq('H 2.1.2-a: column 0 stays the datum', shape.rows[0].firstDataCol, 1)
  eq('H 2.1.2-a: column band', parseSizeBand(headers[1]), { metric: 'lot_size', unit: 'sqm', lo: null, hi: 4000 })
}

// Table 3.1.1-b: Maximum Site Coverage. The row KEY is a band and the cell
// beside it is the control; calling that a label row deletes the table.
{
  const rows = [['Lot Size', 'Maximum site coverage (% of total lot size)'],
    ['200m 2 to 249m 2', '65%'], ['1500m 2 or larger', '30%']]
  const shape = shapeOf([], rows)
  eq('H 3.1.1-b: band-keyed rows are still data', roles(shape).slice(1), ['data', 'data'])
  eq('H 3.1.1-b: column 0 is the band, not a value', shape.rows[1].firstDataCol, 1)
  eq('H 3.1.1-b: row band', parseSizeBand(rows[1][0]), { metric: 'lot_size', unit: 'sqm', lo: 200, hi: 249 })
}

// Table 1.3.1-b: Erosion and Sediment Control. One band, one prose cell, no
// numbers — near enough to a label row to be worth pinning down.
{
  const rows = [['Disturbed area', 'Requirement'],
    ['More than 2,500 m 2 of disturbed area', 'A Soil and Water Management Plan (SWMP) prepared in accordance with the Blue Book']]
  eq('H 1.3.1-b: one band is not a label row', roles(shapeOf([], rows))[1], 'data')
}

// Table 3.1.1-c: "90% of the lot area" is a control this schema holds exactly.
// Skipping every percentage-of-a-lot-fact cell threw four of these away.
{
  eq('H 3.1.1-c: a bare percentage is not a tie-break', statesTieBreak('90% of the lot area'), false)
  eq('H 3.1.1-c: …but is worth a gap note in prose', statesPercentageOf('90% of the lot area'), true)
  eq('H 3.1.1-c: value survives', valuesIn('90% of the lot area'), ['90percent'])
}

// Table 6.3.1-b: "whichever is the GREATER" — 10 m is a true floor on every
// lot, so it is stored; only the inverting form is dropped.
{
  const cell = '10m or the average of the front setbacks of the nearest two neighbouring houses, whichever is the greater'
  eq('H 6.3.1-b: tie-break noticed', statesTieBreak(cell), true)
  eq('H 6.3.1-b: greater does not invert the value', tieBreakInvertsValue(cell), false)
}

// Table 3.1.1-a: Translations of Height to Storeys — bare number, unit in the
// column header.
{
  eq('H 3.1.1-a: unit from the column', headerUnit('Maximum Building Height (m)'), 'm')
  eq('H 3.1.1-a: storeys column', headerUnit('Maximum Storeys (excluding basement carparking)'), ' storeys')
}

// Part 10 Annexures: a glossary row whose definition mentions a measurement.
// It is a definition, not a table axis.
{
  eq('H glossary: "lot size (or site area)" is not an axis', axisOf('lot size (or site area)'), null)
  eq('H glossary: "Building height (or height of building)" is not an axis',
    axisOf('Building height (or height of building)'), null)
}

// ── RANDWICK — the defects ─────────────────────────────────────────────
// C1 cl 3.3.2: minimum side setback by frontage width (down) by height above
// ground (across). Two conditions; rule_effect holds one.
{
  const headers = ['Minimum side setbacks', 'Minimum side setbacks', 'Minimum side setbacks', 'Minimum side setbacks']
  const rows = [
    ['Existing primary frontage width', 'Setback up to 4.5m from ground level (existing)',
      'Setback between 4.5m to 7m from ground level (existing)', 'Setback above 7m from ground level (existing)'],
    ['Less than 6m', 'Merit assessment', 'Merit assessment', 'Merit assessment'],
    ['6m to less than 9m', '0.9m', '0.9m', '0.9\u{1D45A} +(\u{1D44F}\u{1D462}\u{1D456}\u{1D459}\u{1D451}\u{1D456}\u{1D45B}\u{1D454} ℎ\u{1D452}\u{1D456}\u{1D454}ℎ\u{1D461} -7\u{1D45A})'],
    ['12m and above', '1.2m', '1.2m', '1.8m'],
  ]
  const shape = shapeOf(headers, rows)
  eq('R C1 3.3.2: the real header row is row 0', roles(shape), ['header', 'data', 'data', 'data'])
  eq('R C1 3.3.2: axis is frontage width', shape.rowAxis, { metric: 'frontage_width', unit: 'metre' })
  // The axis row supplies the column labels. Without that the height bands the
  // columns are keyed on are invisible and cannot even be recorded as dropped.
  eq('R C1 3.3.2: columns labelled by the header row', shape.rows[2].labels[1],
    'Setback up to 4.5m from ground level (existing)')
  eq('R C1 3.3.2: column 0 is the width band', shape.rows[2].firstDataCol, 1)
  eq('R C1 3.3.2: width band parses', parseLengthBand(rows[2][0], 'frontage_width'),
    { metric: 'frontage_width', unit: 'metre', lo: 6, hi: 9 })
  eq('R C1 3.3.2: 12m and above', parseLengthBand(rows[3][0], 'frontage_width'),
    { metric: 'frontage_width', unit: 'metre', lo: 12, hi: null })
  eq('R C1 3.3.2: column height band', parseHeightBand(rows[0][1]),
    { metric: 'height_above_ground', unit: 'metre', lo: null, hi: 4.5 })
  // The datum is nowhere in the table: the clause heading states it.
  eq('R C1 3.3.2: row header is a band, not a datum', datumOf(rows[2][0]), null)
  eq('R C1 3.3.2: heading supplies the datum', headingDatum('3.3.2. Side setbacks'), 'side_boundary')
  eq('R C1 3.3.2: a generic caption does not', headingDatum('Minimum boundary setbacks'), null)
  // The frontage width is a fact of the LOT and survives; the height above
  // ground is a fact of the proposal and is recorded as dropped.
  const chosen = chooseCondition([
    null, parseHeightBand(rows[0][1]), parseLengthBand(rows[2][0], 'frontage_width'), null,
  ])
  eq('R C1 3.3.2: the lot fact is the stored condition', chosen.condition.metric, 'frontage_width')
  eq('R C1 3.3.2: the design variable is recorded as dropped',
    chosen.dropped.map((d) => d.metric), ['height_above_ground'])
  eq('R C1 3.3.2: formula cell yields no operands', isFormulaCell(rows[2][3]), true)
}

// C2 Table 2: Minimum front setback. Column 0 is a control column, and the
// only statement of Randwick's medium-density front setback lives in it.
{
  const headers = ['Zero to 4 storeys', '5 to 7 storeys', 'Top level of building setback (at level 7 or 8)']
  const rows = [
    ['Minimum front setback in the LMR area', 'Minimum front setback in the LMR area', 'Minimum front setback in the LMR area'],
    ['Align with predominant building line of the primary street frontage. and provide a minimum setback of 6m setback from front property boundary.',
      'Provide 3m setback from predominant building alignment to the primary street frontage',
      'Provide 3m setback from level below'],
    ['Minimum front setback outside the LMR area', 'Minimum front setback outside the LMR area', 'Minimum front setback outside the LMR area'],
    ['Zero to 3 storeys', '4 storeys and above', ''],
    ['Align with predominant building line of the primary street frontage. and provide a minimum setback of 6m setback from front property boundary',
      '3m setback from predominant building alignment to the primary street frontage', ''],
  ]
  const shape = shapeOf(headers, rows)
  eq('R C2 T2: spanned titles and the second header row', roles(shape),
    ['title', 'data', 'title', 'header', 'data'])
  eq('R C2 T2: column 0 holds values', shape.rows[1].firstDataCol, 0)
  eq('R C2 T2: the LMR block keeps its own storey labels', shape.rows[1].labels[0], 'Zero to 4 storeys')
  eq('R C2 T2: the non-LMR block gets the second header row', shape.rows[4].labels[0], 'Zero to 3 storeys')
  eq('R C2 T2: title governs the rows beneath it', shape.rows[4].title, 'Minimum front setback outside the LMR area')
  // "Zero to 4 storeys" is a range. Read as "exactly 4" the control is
  // invisible to a query about a two-storey house, which is most of them.
  eq('R C2 T2: storey range', storeyBandOf('Zero to 4 storeys'),
    { metric: 'storeys', unit: 'storeys', lo: 0, hi: 4 })
  eq('R C2 T2: open-ended storey band', storeyBandOf('4 storeys and above'),
    { metric: 'storeys', unit: 'storeys', lo: 4, hi: null })
  eq('R C2 T2: mid range', storeyBandOf('5 to 7 storeys'),
    { metric: 'storeys', unit: 'storeys', lo: 5, hi: 7 })
  // The control in column 0, and its datum, both read out of the cell.
  const c0 = rows[1][0]
  eq('R C2 T2: column 0 value', valuesIn(c0), ['6metre'])
  eq('R C2 T2: column 0 datum', datumAt(c0, c0.indexOf('6m'), '6'), 'front_boundary')
  eq('R C2 T2: column 0 is not a relative datum', relativeDatumAt(c0, c0.indexOf('6m'), '6'), null)
  // The upper-level columns are measured from neither a boundary nor the site.
  const c1 = rows[1][1]
  eq('R C2 T2: "from predominant building alignment" is not a boundary',
    relativeDatumAt(c1, c1.indexOf('3m'), '3'), 'from predominant building alignment')
  eq('R C2 T2: …and datumAt alone would have said road_boundary',
    datumAt(c1, c1.indexOf('3m'), '3'), 'road_boundary')
  const c2 = rows[1][2]
  eq('R C2 T2: "from level below" is not a boundary',
    relativeDatumAt(c2, c2.indexOf('3m'), '3'), 'from level below')
}

// C2 Table 3: two sub-tables in one grid, the second announced by a repeat of
// the "Site width" axis row five rows down.
{
  const headers = ['Minimum side setback outside the LMR area', 'Minimum side setback outside the LMR area',
    'Minimum side setback outside the LMR area', 'Minimum side setback outside the LMR area']
  const rows = [
    ['Minimum side setback in the LMR area', 'Minimum side setback in the LMR area',
      'Minimum side setback in the LMR area', 'Minimum side setback in the LMR area'],
    ['Site width', 'Zero to 4 storeys', '5 to 7 storeys', 'Top level of building setback (at level 7 or 8)'],
    ['Less than 15m', 'Merit assessment, no less than 3m', 'Merit assessment, no less than 4m', '1m setback from level below'],
    ['25m and greater', '6m', '7m', '1m setback from level below'],
    ['Site width', 'Zero to 3 storeys', '4 storeys and above', ''],
    ['25m and greater', '6m', '7m', ''],
  ]
  const shape = shapeOf(headers, rows)
  eq('R C2 T3: stacked blocks', roles(shape), ['title', 'header', 'data', 'data', 'header', 'data'])
  eq('R C2 T3: axis from the first header row', shape.rowAxis, { metric: 'frontage_width', unit: 'metre' })
  eq('R C2 T3: second block relabelled', shape.rows[5].labels[1], 'Zero to 3 storeys')
  eq('R C2 T3: "Site width" is an axis', axisOf('Site width'), { metric: 'frontage_width', unit: 'metre' })
  eq('R C2 T3: caption supplies the datum',
    headingDatum('Table 3 - Minimum side setback (buildings above 9.5m)'), 'side_boundary')
  eq('R C2 T3: merit cell still states its floor', valuesIn(rows[2][1]), ['3metre'])
  eq('R C2 T3: width band', parseLengthBand('25m and greater', 'frontage_width'),
    { metric: 'frontage_width', unit: 'metre', lo: 25, hi: null })
}

// C2 Table 4: the rear setback, stated as a calculation in column 0.
{
  const rows = [
    ['Minimum rear setback in the LMR area', 'Minimum rear setback in the LMR area', 'Minimum rear setback in the LMR area'],
    ['Zero to 4 storeys', '5 to 7 storeys', 'Top level of building setback (at level 7 or 8)'],
    ['RFBs and Multi-dwelling Housing - Setback to be a minimum of 15% of the site depth, or 5m, whichever is the greater.',
      '3m setback from predominant rear building alignment', '3m setback from level below'],
    ['Attached dwellings', '', ''],
    ['Setback to be a minimum of 25% of the site depth, or 8m, whichever is the lessor.',
      '3m setback from predominant rear building alignment', '6m setback from predominant rear building alignment'],
  ]
  const shape = shapeOf([], rows)
  eq('R C2 T4: roles', roles(shape), ['title', 'header', 'data', 'title', 'data'])
  // A control cell that MENTIONS "site depth" is not an axis header. Reading it
  // as one turned the row holding the rear setback into a label and the table
  // yielded nothing at all.
  eq('R C2 T4: a sentence mentioning an axis is not an axis header', axisOf(rows[2][0]), null)
  eq('R C2 T4: greater keeps the floor', tieBreakInvertsValue(rows[2][0]), false)
  eq('R C2 T4: lessor drops the value', tieBreakInvertsValue(rows[4][0]), true)
  eq('R C2 T4: "lessor" spelling still caught', statesTieBreak(rows[4][0]), true)
  eq('R C2 T4: title supplies the datum', headingDatum(shape.rows[2].title), 'rear_boundary')
}

// D12 Table C: setbacks keyed on street NAMES. Only the sub-header three rows
// up says what they are measured from.
{
  const rows = [
    ['Setback from', 'Setback requirement (minimum)'],
    ['Street frontages:', ''],
    ['Barker Street', '5.0m'],
    ['Middle Street', '3.0m (for 2 storey elements) 7.0m (for elements above 2 storeys)'],
    ['Interfaces:', ''],
    ['Rear boundary (building interface with Struggletown)', '4.0m'],
  ]
  const shape = shapeOf([], rows)
  eq('R D12 C: sub-headers are titles', roles(shape), ['data', 'title', 'data', 'data', 'title', 'data'])
  eq('R D12 C: street rows inherit the frontage', headingDatum(shape.rows[2].title), 'road_boundary')
  eq('R D12 C: "Interfaces:" names no boundary', headingDatum(shape.rows[5].title), null)
  eq('R D12 C: …so the row header still does', datumOf(rows[5][0]), 'rear_boundary')
  eq('R D12 C: storey-banded cell', splitStoreyBands(rows[3][1]).map((s) => [s.condition?.lo, s.condition?.hi]),
    [[undefined, undefined], [2, 2], [3, null]])
}

// C10 cl 4 and D5 cl 3.2.4: the road boundary, named as the road the lot faces.
{
  eq('R C10 4: "Frontage to a classified road"', datumOf('Frontage to a classified road'), 'road_boundary')
  eq('R C10 4: "Frontage to a local road"', datumOf('Frontage to a local road'), 'road_boundary')
  const cell = 'No setback from the street edge up to and including 4 storeys. 4 metres from the street edge for any storeys higher than 4.'
  eq('R D5 3.2.4: "from the street edge"', datumAt(cell, cell.indexOf('4 metres'), '4'), 'road_boundary')
  // Hornsby's "frontage to a park" is not a road, and a laneway is as often at
  // the rear as at the front.
  eq('H: "frontage to a park" names no road', datumOf('frontage to a park'), null)
  eq('R: "lane edge" is left unread', datumOf('1 metre from the lane edge.'), null)
  // A direction word still beats the generic road: the document says which.
  eq('H 9: "front street boundary"', datumOf('set back 6m behind the front street boundary'), 'front_boundary')
  eq('H: "Secondary Road boundary"', datumOf('Secondary Road boundary'), 'secondary_boundary')
}

// D4 cl 2.3: the table hangs off an unnumbered block headed "Front setback",
// one level below the clause that owns it as a rule.
{
  eq('R D4 2.3: the block heading names the datum', headingDatum('Front setback'), 'front_boundary')
  eq('R D4 2.3: the clause heading does not', headingDatum('2.3. Setbacks'), null)
}

// ── topic ──────────────────────────────────────────────────────────────
{
  // The words nearest the control decide; the ancestors are only consulted
  // when those say nothing. Randwick hangs its controls off "Controls".
  eq('topic: nearest text wins', topicOf(['Table 3 - Minimum side setback (buildings above 9.5m) Controls'], 'metre'), 'setback')
  eq('topic: ancestor fallback', topicOf(['Controls', '4. Setbacks'], 'metre'), 'setback')
  eq('topic: ancestor fallback, site coverage', topicOf(['Controls', '2.4. Site coverage', '2. Site planning'], 'percent'), 'site_coverage')
  eq('topic: ancestor fallback, open space', topicOf(['Controls', '2.7 Private Open Space'], 'sqm'), 'open_space')
  eq('topic: an ancestor never overrides a nearer match',
    topicOf(['Controls 3.1.4. Building height', '3. Development controls', '4. Setbacks'], 'metre'), 'height')
  eq('topic: nothing named', topicOf(['Controls', '3.2.7. Block 7'], 'metre'), null)
  // The unit vetoes a topic it cannot express, and the next candidate is tried.
  // "Table 1: Floor Space Ratio and Building Heights" is two topics at once.
  eq('topic: ratio in a height-and-FSR caption',
    topicOf(['Table 1: Floor Space Ratio and Building Heights'], 'ratio'), 'fsr')
  eq('topic: metres in the same caption',
    topicOf(['Table 1: Floor Space Ratio and Building Heights'], 'metre'), 'height')
  eq('topic: an FSR measured in parking spaces is not an FSR',
    topicOf(['Table 4.2.1: Floor space ratio'], 'spaces'), null)
  eq('topic: a floor area measured in metres is not a floor area',
    topicOf(['7.1.2 Floor Area'], 'metre'), null)
  eq('topic: a height in percent is not a height', topicOf(['8.1.8 Height'], 'percent'), null)
  eq('topic: "50% of the front setback" is not a setback',
    topicOf(['3.3.7 Landscaping Deep soil landscaping for a minimum 50% of the front setback'], 'percent'),
    'landscaping')
  eq('topic: unit vocabulary', [topicAllowsUnit('setback', 'metre'), topicAllowsUnit('setback', 'percent')], [true, false])
  // "dwelling" is above half a DCP's controls and means nothing on its own.
  eq('topic: a dwelling is not a density', topicCandidates(['3.1 Dwelling Houses and Dual Occupancies']), [])
  eq('topic: a density is', topicOf(['2.3. Land use and density'], 'percent'), 'density')
  eq('topic: dwellings per hectare is', topicOf(['Dwellings per hectare'], 'dwellings'), 'density')
}

// ── report ─────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fails.length} failed\n`)
for (const f of fails) process.stdout.write(`\n  FAIL ${f}\n`)
process.exit(fails.length ? 1 : 0)
