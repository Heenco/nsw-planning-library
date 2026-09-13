/**
 * Build `shared/council-map-catalogue.ts` from the safebuy.app report configs.
 *
 * The property-report repo carries one JSON per council — 67 of them across
 * seven Australian states and four Canadian provinces — and inside each, the
 * report sections each name the ArcGIS feature services that answer them. That
 * is 2,128 layer entries, and it is by far the biggest catalogue of council
 * planning endpoints either repo has. This page already queries NSW services
 * live; there is no reason it should not query the rest.
 *
 * WHY THIS IS GENERATED AND COMMITTED, NOT READ AT RUNTIME
 *
 * property-report is a sibling working copy, not a dependency. Reading it at
 * build time would make this repo fail to build on any machine that does not
 * happen to have it checked out next door. So the catalogue is generated, the
 * output is committed, and this script is how it gets refreshed — the same
 * arrangement shared/nsw-map-services.ts has with the notebook it came from.
 *
 *   node scripts/gen-council-catalogue.mjs [--src ../property-report]
 *
 * WHY IT NORMALISES BY URL
 *
 * The 2,128 entries point at only 703 distinct services. Every Victorian
 * council repeats the same Vicmap Planning layer; one URL is referenced by 132
 * configs. Stored per council it would be 2,128 near-duplicate records, and a
 * layer's identity would depend on which council you reached it through.
 * Keyed by URL it is 703 layers and a list of ids per council, which is both
 * smaller and truer: the service is the thing, the council is a view of it.
 *
 * Where two configs disagree about a service's label or section, the first
 * reading wins. That affects 24 of 703 URLs and the difference is always
 * cosmetic.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const srcRoot = resolve(argOf('--src', '../property-report'))
const configDir = join(srcRoot, 'app', 'config', 'report-configs')
const outFile = resolve('shared/council-map-catalogue.ts')

if (!existsSync(configDir)) {
  console.error(
    `No report configs at ${configDir}\n`
    + 'Pass --src with the path to the property-report checkout.',
  )
  process.exit(1)
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/** Short, stable, and derived from the URL, so an id survives a relabel. */
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 8)

/** ArcGIS layer endpoints only. A group or root URL has to be expanded first. */
const isQueryable = url => /\/(MapServer|FeatureServer)\/\d+$/.test(String(url || '').trim())

const layers = new Map()   // url -> { id, name, section, url, where }
const councils = []

for (const dir of readdirSync(configDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  for (const file of readdirSync(join(configDir, dir.name))) {
    if (!file.endsWith('.json')) continue
    const path = join(configDir, dir.name, file)
    let cfg
    try {
      cfg = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      console.warn(`  skipped ${dir.name}/${file}: ${e.message}`)
      continue
    }

    const ids = []
    let skipped = 0
    for (const section of cfg.sections ?? []) {
      const sectionName = section.title || section.id || 'Other'
      for (const layer of section.layers ?? []) {
        const url = String(layer.url ?? '').trim()
        if (!url) continue
        if (!isQueryable(url)) { skipped++; continue }

        if (!layers.has(url)) {
          const name = String(layer.label ?? '').trim() || 'Unnamed layer'
          layers.set(url, {
            id: `cc-${slug(name).slice(0, 48)}-${hash(url)}`,
            name,
            section: sectionName,
            url,
            // Carried because several layers are only correct with it — the NSW
            // school layers return closed campuses without `operationalstatus = 1`.
            where: typeof layer.where === 'string' && layer.where.trim() ? layer.where.trim() : undefined,
          })
        }
        const id = layers.get(url).id
        if (!ids.includes(id)) ids.push(id)
      }
    }

    councils.push({
      slug: cfg.slug || slug(file.replace(/\.json$/, '')),
      council: cfg.council || file.replace(/\.json$/, ''),
      state: cfg.state || dir.name.toUpperCase(),
      region: dir.name === 'canada' ? 'Canada' : 'Australia',
      layers: ids,
      skipped,
    })
  }
}

councils.sort((a, b) => a.region.localeCompare(b.region)
  || a.state.localeCompare(b.state)
  || a.council.localeCompare(b.council))

const all = [...layers.values()].sort((a, b) => a.section.localeCompare(b.section)
  || a.name.localeCompare(b.name))

const j = v => JSON.stringify(v)
const out = `/**
 * Council map layers, generated from the safebuy.app report configs.
 *
 * DO NOT EDIT BY HAND — run \`node scripts/gen-council-catalogue.mjs\`, which
 * documents where this comes from and why it is normalised by URL.
 *
 * ${all.length} distinct ArcGIS layers across ${councils.length} councils and state/province
 * catalogues, from ${new Set(councils.map(c => c.state)).size} jurisdictions. A council references layers by id;
 * the same service shared by 132 Victorian councils is stored once.
 *
 * The id is what the API accepts. As with nsw-map-services.ts, a URL is never
 * taken from the client — server/api/map-layer.get.ts resolves the id here, so
 * the proxy cannot be aimed at an arbitrary host.
 */

export interface CouncilLayer {
  id: string
  /** Label as the report config states it. */
  name: string
  /** The report section that cites this service, used to group the panel. */
  section: string
  url: string
  /** An ArcGIS \`where\` filter the layer is only correct with. */
  where?: string
}

export interface CouncilEntry {
  slug: string
  council: string
  /** State or province code — NSW, QLD, VIC, BC, ON … */
  state: string
  region: 'Australia' | 'Canada'
  /** Ids into COUNCIL_LAYERS. */
  layers: string[]
}

export const COUNCIL_LAYERS: CouncilLayer[] = [
${all.map(l => `  { id: ${j(l.id)}, name: ${j(l.name)}, section: ${j(l.section)}, url: ${j(l.url)}${l.where ? `, where: ${j(l.where)}` : ''} },`).join('\n')}
]

export const COUNCILS: CouncilEntry[] = [
${councils.map(c => `  { slug: ${j(c.slug)}, council: ${j(c.council)}, state: ${j(c.state)}, region: ${j(c.region)}, layers: [${c.layers.map(j).join(', ')}] },`).join('\n')}
]

const BY_ID = new Map(COUNCIL_LAYERS.map(l => [l.id, l]))

export function findCouncilLayer(id: string): CouncilLayer | undefined {
  return BY_ID.get(id)
}

export function findCouncil(slug: string): CouncilEntry | undefined {
  return COUNCILS.find(c => c.slug === slug)
}
`

writeFileSync(outFile, out, 'utf8')

const totalRefs = councils.reduce((n, c) => n + c.layers.length, 0)
const totalSkipped = councils.reduce((n, c) => n + c.skipped, 0)
console.log(`Read  ${councils.length} configs from ${configDir}`)
console.log(`Wrote ${all.length} distinct layers (${totalRefs} council references) to ${outFile}`)
if (totalSkipped) console.log(`Skipped ${totalSkipped} entries whose URL is not a queryable /MapServer/<n> endpoint`)
for (const region of ['Australia', 'Canada']) {
  const inRegion = councils.filter(c => c.region === region)
  const byState = [...new Set(inRegion.map(c => c.state))].sort()
  console.log(`  ${region}: ${inRegion.length} configs across ${byState.join(', ')}`)
}
