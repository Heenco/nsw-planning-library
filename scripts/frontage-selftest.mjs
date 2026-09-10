/**
 * Regression cases for the topological frontage matcher.
 *
 *   node scripts/frontage-selftest.mjs
 *
 * Real lots, not synthetic ones. Each case pins the answer a person checked on
 * a map, so a change that quietly re-breaks corner lots or battle-axes fails
 * here rather than 3.2M rows later. Expectations are deliberately loose on
 * lengths (0.5 m) and exact on counts — the counts are what the old pipeline got
 * wrong, and a metre of survey noise is not a regression.
 *
 * Geometry comes from SIX Maps through the same cache scripts/frontage-check.mjs
 * uses, so the first run needs a network and every run after it does not.
 */

import { classifyBoundary } from '../shared/frontage-topo.mjs'
import { roadLabel } from '../shared/frontage-roads.mjs'
import { ringArea } from '../shared/geo-measure.mjs'
import { loadLot } from './frontage-check.mjs'

const CASES = [
  {
    lotId: 'A//DP408911',
    note: 'the school site that started this — lot_metrics_gnaf says num_frontages = 0',
    area_sqm: 21497,
    runs: 2,
    runLengths: [208.6, 182.05],
    sharedWith: ['1//DP830604', 'B//DP408911'],
  },
  {
    lotId: 'B//DP408911',
    note: 'its sibling: shares the long NW boundary with A, two open runs of its own',
    runs: 2,
    runLengths: [96.5, 71.78],
    sharedWith: ['A//DP408911', '1//DP240566'],
  },
  {
    lotId: '1//DP214129',
    note: 'suburban corner lot — two frontages meeting across a 3.75 m chamfer. '
      + 'Joining consecutive open boundary without a corner break reports one 98.57 m run.',
    area_sqm: 2487,
    runs: 2,
    runLengths: [55.56, 43.01],
  },
  {
    lotId: '17//DP258140',
    note: 'curved frontage stored as ten ~1.68 m chords. Testing MIN_RUN_M against each '
      + 'edge instead of the joined run discarded every one and reported no frontage at all.',
    area_sqm: 893,
    runs: 1,
    runLengths: [15.59],
    sharedWith: ['18//DP258140', '1//DP196082'],
  },
  {
    lotId: '1//DP199788',
    note: 'battle-axe confirmed by hand — 9.15 m stem, so it also pins the handle threshold',
    area_sqm: 714,
    runs: 2,
    runLengths: [15.21, 9.15],
  },
  {
    lotId: '121//DP836880',
    note: 'cul-de-sac head: one arc of 29 chords sweeping 74 degrees. Breaking a run on '
      + 'cumulative drift split it in two and called the halves a corner lot.',
    area_sqm: 7102,
    runs: 1,
    runLengths: [24.48],
  },
  {
    lotId: '1//DP240566',
    note: '14 ha rural parcel — long boundaries, two open runs',
    runs: 2,
    runLengths: [357.76, 317.42],
  },
]

const near = (a, b, tol) => Math.abs(a - b) <= tol

// Road naming is exercised through the API rather than here: it reads the Martin
// tile server, so it needs NUXT_PUBLIC_MARTIN_URL and a running app, while these
// cases are meant to pass offline from the cadastre cache alone. What is pinned
// here is the label format, the one piece of naming that is pure.
const LABEL_CASES = [
  [{ name: 'PRINCES', type: 'HIGHWAY' }, 'PRINCES HIGHWAY'],
  [{ name: 'CARLETON', type: 'STREET' }, 'CARLETON STREET'],
  [{ name: 'FIRETRAIL NO 10Q', type: null }, 'FIRETRAIL NO 10Q'],
  [{ name: 'Unnamed_142401', type: null }, null],
  [{ name: '', type: 'STREET' }, null],
]

let failures = 0
for (const c of CASES) {
  const { ring, neighbours } = await loadLot(c.lotId)
  const result = classifyBoundary(ring, neighbours.map((n) => n.ring))
  const problems = []

  if (c.area_sqm != null && !near(ringArea(ring), c.area_sqm, Math.max(5, c.area_sqm * 0.002))) {
    problems.push(`area ${Math.round(ringArea(ring))} m², expected ~${c.area_sqm}`)
  }
  if (result.runs.length !== c.runs) {
    problems.push(`${result.runs.length} frontage run(s), expected ${c.runs}`)
  }
  if (c.runLengths) {
    for (const [i, want] of c.runLengths.entries()) {
      const got = result.runs[i]?.length_m
      if (got == null || !near(got, want, 0.5)) problems.push(`run ${i + 1} = ${got} m, expected ~${want} m`)
    }
  }
  if (c.sharedWith) {
    const got = new Set(result.edges.flatMap((e) => e.abuts.map((a) => neighbours[a.neighbour].id)))
    for (const want of c.sharedWith) if (!got.has(want)) problems.push(`no shared boundary found with ${want}`)
  }

  if (problems.length) {
    failures++
    console.log(`FAIL  ${c.lotId}`)
    console.log(`      ${c.note}`)
    for (const p of problems) console.log(`      - ${p}`)
  } else {
    console.log(`ok    ${c.lotId}  ${result.runs.length} run(s), `
      + `${result.total_open_m} m open of ${result.total_boundary_m} m`)
  }
}

let labelFailures = 0
for (const [input, want] of LABEL_CASES) {
  const got = roadLabel(input)
  if (got !== want) {
    labelFailures++
    console.log(`FAIL  roadLabel(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
  }
}
if (!labelFailures) console.log(`ok    roadLabel  ${LABEL_CASES.length} cases`)

console.log(`\n${CASES.length - failures}/${CASES.length} lot cases, `
  + `${LABEL_CASES.length - labelFailures}/${LABEL_CASES.length} label cases passed`)
process.exit(failures + labelFailures ? 1 : 0)
