/**
 * How much of each epi layer the Spatial Viewer's own symbols actually colour.
 *
 * The point of shared/epi-symbology.ts is that /epi looks like the map a planner already checks a property
 * against. That only holds if the portal's class labels reach our categories, and the two are written in
 * different vocabularies, so the match is a measurement rather than a claim. This makes it.
 *
 *     npx tsx scripts/check-epi-symbology.ts
 *
 * It imports the real module, so there is one copy of the keying rules and the gate cannot drift from what
 * the page draws. It reads the categories from the published tile index, so it measures the data on the map
 * rather than a fixture.
 *
 * Coverage is by FEATURES, not by distinct labels: one unmatched label on eleven polygons does not matter
 * and one on eight thousand does. A layer the portal draws with a single symbol has nothing to key and is
 * reported as such rather than as 0%.
 *
 * The question it gates on is not how many categories match a class. Falling through to the base symbol is
 * fine when that base is the portal's own - its renderer default, or the class ePlanning itself uses as a
 * catch-all. What is not fine is a polygon drawn in a colour that came from no map. So it fails when a
 * layer has categories that match no class AND no portal base symbol to land on, and when a whole class
 * table is unreachable, which means a keying rule has gone wrong rather than that a colour is missing.
 */
import {
  EPI_SYMBOLOGY_KEYS, epiClassKey, epiSymbology, epiSymFor,
} from '../shared/epi-symbology'

const BASE = process.env.NUXT_SEPP_PMTILES_BASE || 'http://172.105.184.178/pmtiles'

interface IndexLayer {
  key: string
  features: number | null
  categories?: { name: string; features: number }[]
}

const idx = await fetch(`${BASE}/epi-layers.json`).then(r => r.json()) as { layers: IndexLayer[] }

interface Row {
  key: string
  features: number
  classes: number
  covered: number | null
  base: boolean
  from: string
  miss: { name: string; features: number }[]
}

const rows: Row[] = []
for (const l of idx.layers) {
  const s = epiSymbology(l.key)
  const cats = l.categories ?? []
  const total = cats.reduce((t, c) => t + c.features, 0)
  const nClasses = Object.keys(s.classes).length

  // a category is matched when it resolves to one of the layer's own classes rather than to its base
  const baseJson = JSON.stringify(epiSymFor(l.key, null))
  const miss = cats.filter(c => JSON.stringify(epiSymFor(l.key, c.name)) === baseJson)
  const hit = total - miss.reduce((t, c) => t + c.features, 0)

  rows.push({
    key: l.key,
    features: l.features ?? 0,
    classes: nClasses,
    covered: total ? hit / total : null,
    base: Boolean(s.base),
    from: s.from,
    miss: miss.sort((a, b) => b.features - a.features).slice(0, 3),
  })
}

const pct = (n: number | null) => (n == null ? '    -' : `${(100 * n).toFixed(1).padStart(5)}%`)
const classed = rows.filter(r => r.classes > 0)
const single = rows.filter(r => r.classes === 0)

console.log(`${'layer'.padEnd(38)} ${'features'.padStart(8)} ${'cls'.padStart(4)} ${'by class'.padStart(8)}`
  + `  the rest draw on the base symbol:`)
for (const r of [...classed].sort((a, b) => (a.covered ?? 1) - (b.covered ?? 1))) {
  const m = r.miss.map(c => `${c.name} (${c.features})`).join(', ')
  console.log(`${r.key.padEnd(38)} ${String(r.features).padStart(8)} ${String(r.classes).padStart(4)} `
    + `${pct(r.covered)}  ${m.slice(0, 76)}`)
}

console.log(`\n${single.length} layers the portal draws with one symbol (nothing to key):`)
for (const r of single) {
  console.log(`  ${r.key.padEnd(38)} ${r.base ? '' : 'NO BASE SYMBOL  '}${r.from.slice(0, 84)}`)
}

// ── the gate ─────────────────────────────────────────────────────────────────
const problems: string[] = []

// the only real failure: features that match no class, with no portal base symbol underneath them
for (const r of rows) {
  if (r.base) continue
  if (r.classes === 0) {
    problems.push(`${r.key}: no symbol at all. Add it to MATCH in scripts/sweep-epi-renderers.py, or to `
      + `OURS in shared/epi-symbology.ts if the portal has no layer for it.`)
  } else if (r.miss.length) {
    problems.push(`${r.key}: ${r.miss.reduce((t, c) => t + c.features, 0)} features match no class and the `
      + `renderer has no default, so they draw in the fallback grey. Either extend the keying rule or `
      + `promote a class to the base with BASE_FROM. Worst: `
      + r.miss.map(c => `'${c.name}' (${c.features})`).join(', '))
  }
}

const drawn = new Set(idx.layers.map(l => l.key))
const stale = EPI_SYMBOLOGY_KEYS.filter(k => !drawn.has(k))
if (stale.length) {
  console.log(`\nnote: a symbol is recorded for ${stale.length} layer(s) the tile index does not have: `
    + `${stale.join(', ')}`)
}
const unstyled = [...drawn].filter(k => !EPI_SYMBOLOGY_KEYS.includes(k))
for (const k of unstyled) {
  problems.push(`${k}: is tiled but has no entry in epi-symbology, so it draws in the fallback grey.`)
}

/*
 * A class table nobody can reach means a keying rule has gone wrong. Two cases are not that, and flagging
 * them once cost more time than the check saved:
 *   · a one-class renderer whose class was promoted to the base - every feature already draws in it;
 *   · a layer whose base came from a class (baseFrom), for the same reason.
 */
for (const r of classed) {
  const sym = epiSymbology(r.key)
  if (r.classes < 2 || sym.baseFrom) continue
  const cats = idx.layers.find(l => l.key === r.key)?.categories ?? []
  if (!cats.length) continue
  const keys = cats.map(c => epiClassKey(r.key, c.name))
  const reachable = Object.keys(sym.classes).filter(lab => keys.includes(epiClassKey(r.key, lab)))
  if (!reachable.length) {
    problems.push(`${r.key}: none of its ${r.classes} portal classes is reachable from any category in the `
      + `tiles - the keying rule does not fit this layer. Categories look like '${cats[0]?.name}'.`)
  }
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log(`  · ${p}`)
  process.exit(1)
}
console.log(`\nOK — ${classed.length} classed layers, ${single.length} single-symbol layers, `
  + `every tiled layer has a symbol.`)
