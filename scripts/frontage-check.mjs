/**
 * Frontage for one lot, from its lot/DP identifier.
 *
 *   node scripts/frontage-check.mjs "A//DP408911"
 *   node scripts/frontage-check.mjs "A//DP408911" --geojson out.json
 *   node scripts/frontage-check.mjs "A//DP408911" --pad 400 --tolerance 0.2
 *
 * Built to be run a lot on single lots before any of this is turned loose on
 * 3.2M of them. The whole boundary classification needs no database: the
 * cadastre comes from the same public SIX Maps service server/utils/cadastre.ts
 * already trusts, so this runs anywhere, including from a machine with no route
 * to UrbanPortalDBP.
 *
 * Naming a frontage — deciding that the open boundary on the east is "Princes
 * Highway" — does need the road centrelines in urbanportaldbp.road_segments, so
 * that step is a separate, optional pass. When no road source is configured the
 * tool still answers the question that was actually wrong in the pipeline: which
 * boundaries face a road at all, and how long they are.
 *
 * Responses are cached under .cache/cadastre so repeat runs and the eventual
 * fixture-based tests do not hammer a public service.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { classifyBoundary, DEFAULT_TOLERANCE_M } from '../shared/frontage-topo.mjs'
import { ringArea } from '../shared/geo-measure.mjs'
import {
  DEFAULT_PAD_M, assertOk, lotQueryUrl, neighbourQueryUrl, neighboursFrom, ringsOf,
} from '../shared/cadastre-query.mjs'

const CACHE_DIR = path.resolve('.cache/cadastre')
const TIMEOUT_MS = 30000


function parseArgs(argv) {
  const args = { lotId: null, pad: DEFAULT_PAD_M, tolerance: DEFAULT_TOLERANCE_M, geojson: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pad') args.pad = Number(argv[++i])
    else if (a === '--tolerance') args.tolerance = Number(argv[++i])
    else if (a === '--geojson') args.geojson = argv[++i]
    else if (a === '--json') args.json = true
    else if (!a.startsWith('--')) args.lotId = a
  }
  return args
}

async function cached(key, fetcher) {
  await mkdir(CACHE_DIR, { recursive: true })
  const file = path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_.-]/gi, '_')}.json`)
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'))
  const data = await fetcher()
  await writeFile(file, JSON.stringify(data), 'utf8')
  return data
}

async function query(url, cacheKey) {
  return cached(cacheKey, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`cadastre service returned ${res.status}`)
    return assertOk(await res.json())
  })
}

async function fetchLot(lotId) {
  const json = await query(lotQueryUrl(lotId), `lot_${lotId}`)
  const rings = (json.features ?? []).flatMap(ringsOf)
  if (!rings.length) return null
  // The largest ring is the parcel; the rest are slivers, as cadastre.ts found.
  return rings.sort((a, b) => ringArea(b) - ringArea(a))[0]
}

async function fetchNeighbours(ring, padM, lotId) {
  const json = await query(neighbourQueryUrl(ring, padM), `nbrs_${lotId}_${padM}`)
  return neighboursFrom(json, lotId)
}

function report(lotId, ring, neighbours, result) {
  const area = ringArea(ring)
  console.log(`\n${lotId}`)
  console.log(`  area ${Math.round(area).toLocaleString()} m²   boundary ${result.total_boundary_m} m   `
    + `neighbours loaded ${neighbours.length}`)
  console.log()
  console.log(`  ${'edge'.padStart(4)} ${'length'.padStart(9)} ${'shared'.padStart(9)} ${'open'.padStart(9)}  `
    + `${'bearing'.padStart(7)}  abuts`)
  console.log('  ' + '-'.repeat(76))
  for (const e of result.edges) {
    const abuts = e.abuts.length
      ? e.abuts.map((a) => `${neighbours[a.neighbour].id} (${a.length_m}m)`).join(', ')
      : '—'
    console.log(`  ${String(e.index).padStart(4)} ${String(e.length_m).padStart(9)} `
      + `${String(e.shared_m).padStart(9)} ${String(e.open_m).padStart(9)}  `
      + `${String(e.bearing_deg).padStart(7)}  ${abuts}`)
  }

  console.log(`\n  Open boundary runs — frontage candidates`)
  if (!result.runs.length) {
    console.log('    none: every boundary is shared with a neighbouring parcel.')
    console.log('    This lot has no direct street frontage (access by easement or right of carriageway),')
    console.log('    or a road-reserve parcel sits between it and the street.')
  } else {
    for (const [i, run] of result.runs.entries()) {
      console.log(`    ${i + 1}. edges [${run.edges.join(', ')}]  ${run.length_m} m`)
    }
    console.log(`\n  total open boundary ${result.total_open_m} m across ${result.runs.length} run(s)`)
  }
  console.log(`\n  Road naming not applied — needs urbanportaldbp.road_segments.`)
  console.log(`  Runs above are boundaries facing something that is not another parcel.\n`)
}

function toGeoJSON(lotId, ring, result) {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { lotidstring: lotId, kind: 'lot' },
        geometry: { type: 'Polygon', coordinates: [ring] } },
      ...result.runs.map((run, i) => ({
        type: 'Feature',
        properties: { lotidstring: lotId, kind: 'frontage_run', run: i + 1, length_m: run.length_m, edges: run.edges.join(',') },
        geometry: { type: 'LineString', coordinates: run.coords },
      })),
    ],
  }
}

/**
 * A lot's outer ring plus every parcel around it, both from the cache.
 *
 * Exported so scripts/frontage-selftest.mjs fetches its cases exactly the way
 * this tool does — a fixture that came down a different path is not a fixture.
 */
export async function loadLot(lotId, pad = DEFAULT_PAD_M) {
  const ring = await fetchLot(lotId)
  if (!ring) throw new Error(`No boundary published for ${lotId}`)
  return { ring, neighbours: await fetchNeighbours(ring, pad, lotId) }
}

// Everything below runs only when this file is the entry point, so importing it
// for `loadLot` does not kick off a CLI run.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('frontage-check.mjs')) {
const args = parseArgs(process.argv.slice(2))
if (!args.lotId) {
  console.error('usage: node scripts/frontage-check.mjs "<lot//plan>" [--pad m] [--tolerance m] [--geojson out.json] [--json]')
  process.exit(1)
}

const ring = await fetchLot(args.lotId)
if (!ring) {
  console.error(`No boundary published for ${args.lotId}. Check the lot//section//plan form, e.g. "A//DP408911".`)
  process.exit(2)
}
const neighbours = await fetchNeighbours(ring, args.pad, args.lotId)
const result = classifyBoundary(ring, neighbours.map((n) => n.ring), { tolerance: args.tolerance })

if (args.json) {
  console.log(JSON.stringify({ lotId: args.lotId, neighbours: neighbours.map((n) => n.id), ...result }, null, 2))
} else {
  report(args.lotId, ring, neighbours, result)
}
if (args.geojson) {
  await writeFile(args.geojson, JSON.stringify(toGeoJSON(args.lotId, ring, result), null, 2), 'utf8')
  console.log(`  wrote ${args.geojson}`)
}
}
