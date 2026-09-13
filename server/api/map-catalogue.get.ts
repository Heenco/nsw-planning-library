/**
 * The council map catalogue: who we hold layers for, and which layers.
 *
 *   /api/map-catalogue                 → the councils, grouped by region/state
 *   /api/map-catalogue?council=hornsby → that council's layers, grouped by section
 *
 * WHY THIS IS AN ENDPOINT AND NOT AN IMPORT
 *
 * shared/council-map-catalogue.ts is ~230 KB — 667 layers and 1,933 council
 * references. Imported into the page it would ship to every browser that opens
 * /frontage, to serve a panel most sessions never open, for one council out of
 * 67. Fetched per council it is a few KB.
 *
 * The council index is deliberately separate from the layers: the picker needs
 * only names to render, and asking for the layers is the second step.
 */

import { COUNCILS, COUNCIL_LAYERS, findCouncil } from '#shared/council-map-catalogue'

const byId = new Map(COUNCIL_LAYERS.map(l => [l.id, l]))

export default defineEventHandler((event) => {
  const slug = String(getQuery(event).council ?? '').trim().toLowerCase()
  setHeader(event, 'cache-control', 'public, max-age=3600')

  // ── The index ────────────────────────────────────────────────────────────
  if (!slug) {
    const regions = new Map<string, Map<string, Array<{ slug: string, council: string, layerCount: number }>>>()
    for (const c of COUNCILS) {
      if (!regions.has(c.region)) regions.set(c.region, new Map())
      const states = regions.get(c.region)!
      if (!states.has(c.state)) states.set(c.state, [])
      states.get(c.state)!.push({ slug: c.slug, council: c.council, layerCount: c.layers.length })
    }
    return {
      ok: true as const,
      councilCount: COUNCILS.length,
      layerCount: COUNCIL_LAYERS.length,
      regions: [...regions].map(([region, states]) => ({
        region,
        states: [...states].map(([state, councils]) => ({ state, councils })),
      })),
    }
  }

  // ── One council's layers ─────────────────────────────────────────────────
  const council = findCouncil(slug)
  if (!council) {
    return {
      ok: false as const,
      reason: 'unknown_council',
      message: `No council with slug "${slug}".`,
    }
  }

  // Grouped by the report section that cites each service, which is the only
  // grouping the source configs carry and reads better than an alphabetical
  // list of 97 layer names.
  const sections = new Map<string, Array<{ id: string, name: string }>>()
  for (const id of council.layers) {
    const layer = byId.get(id)
    if (!layer) continue
    if (!sections.has(layer.section)) sections.set(layer.section, [])
    sections.get(layer.section)!.push({ id: layer.id, name: layer.name })
  }

  return {
    ok: true as const,
    slug: council.slug,
    council: council.council,
    state: council.state,
    region: council.region,
    layerCount: council.layers.length,
    sections: [...sections]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([section, layers]) => ({ section, layers })),
  }
})
