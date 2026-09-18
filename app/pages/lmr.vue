<!--
  /lmr - Low and Mid Rise housing, and every SEPP land application layer, on one map.

  The layers come from the All-EPI geodatabase (epi.epi_land_application, SEPP rows), baked into one PMTiles
  archive by scripts/build-sepp-pmtiles.py and served as a static file on the planningai host. /api/lmr/tiles
  reads tiles out of that archive - there is no tile server and no database behind this page.

  - The panel lists the layers: the four LMR layers of the Housing SEPP first (on by default), then every other
    SEPP layer, grouped by SEPP and coloured by family (shared/lmr-layers.ts). The panel is the legend.
  - One vector source holding every layer; the toggles are a map filter on layer_key, so switching a layer on
    or off draws from tiles already loaded.
  - Clicking the map asks /api/lmr/at what applies at that point - every SEPP layer, on or off.
  - The switched-on layers and the view are kept in the URL hash, so a view can be shared.
-->

<template>
  <div class="lm-page">
    <header class="lm-header">
      <div>
        <NuxtLink to="/" class="lm-back">&larr; Home</NuxtLink>
        <h1 class="lm-title">Low and Mid Rise housing and SEPP layers</h1>
      </div>
      <div v-if="catalogue" class="lm-header-stat">
        {{ catalogue.layers.length }} layers from <strong>epi_land_application</strong><template v-if="catalogue.sourceDate">
          · EPI data of <strong>{{ fmtDate(catalogue.sourceDate) }}</strong></template>
      </div>
    </header>

    <div class="lm-body">
      <aside class="lm-panel" :class="{ 'lm-panel--closed': !panelOpen }">
        <button type="button" class="lm-panel-toggle" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
          {{ panelOpen ? 'Hide layers' : 'Layers' }}
        </button>
        <div v-show="panelOpen" class="lm-panel-inner">
          <form class="lm-search" role="search" @submit.prevent="searchAddress">
            <label class="lm-sr" for="lm-q">Go to an address</label>
            <input id="lm-q" v-model="addr" type="search" class="lm-input" placeholder="Go to an address or suburb" autocomplete="off">
            <button type="submit" class="lm-btn" :disabled="!addr.trim() || searching">Go</button>
          </form>
          <p v-if="searchMsg" class="lm-note">{{ searchMsg }}</p>

          <p v-if="loadError" class="lm-error">{{ loadError }}</p>
          <p v-else-if="!catalogue" class="lm-dim">Loading layers…</p>

          <template v-else>
            <p class="lm-allrow">
              <span class="lm-dim">{{ on.size }} of {{ layerCount }} layers on</span>
              <button type="button" class="lm-link" :disabled="!on.size" @click="allOff">Turn all off</button>
            </p>

            <!-- The Housing SEPP layers: Low and Mid Rise housing, then Transport Oriented Development -->
            <section v-for="g in housingGroups" :key="g.title" class="lm-group">
              <h2 class="lm-h2">{{ g.title }}</h2>
              <p class="lm-lead">{{ g.lead }}</p>
              <ul class="lm-list">
                <li v-for="l in g.layers" :key="l.key" class="lm-item">
                  <label class="lm-row">
                    <input type="checkbox" :checked="on.has(l.key)" @change="toggle(l.key)">
                    <span class="lm-swatch lm-swatch--lmr" :style="swatchStyle(l)" />
                    <span class="lm-name">{{ l.layName }}</span>
                    <span class="lm-count">{{ fmt(l.features) }}</span>
                  </label>
                  <p class="lm-blurb">{{ LMR_BLURB[l.layName] }}</p>
                  <p class="lm-meta">
                    <template v-if="lmrStyle(l.layName).portalName && lmrStyle(l.layName).portalName !== l.layName">"{{ lmrStyle(l.layName).portalName }}" on the Planning Portal · </template>
                    <template v-if="l.commenced">commenced {{ fmtDate(l.commenced) }}</template>
                    <button v-if="l.bbox" type="button" class="lm-link" @click="zoomTo(l.key, l.bbox)">zoom to</button>
                  </p>
                </li>
                <!-- constraint layers that belong with this group: the LMR stations -->
                <li v-for="c in constraintsIn(g.key)" :key="c.key" class="lm-item">
                  <label class="lm-row">
                    <input type="checkbox" :checked="on.has(c.key)" @change="toggle(c.key)">
                    <span class="lm-swatch lm-swatch--lmr" :style="constraintSwatchCss(c.key)" />
                    <span class="lm-name">{{ c.title }}</span>
                    <span class="lm-count">{{ fmt(c.features) }}</span>
                  </label>
                  <p class="lm-blurb">{{ firstSentence(c.comment) }}</p>
                  <p class="lm-meta"><code>{{ c.table }}</code><button v-if="c.bbox" type="button" class="lm-link" @click="zoomTo(c.key, c.bbox)">zoom to</button></p>
                </li>
              </ul>
            </section>

            <!-- The lmr schema: what the Low and Mid-Rise Housing Policy is checked against -->
            <section v-if="constraintLayers.length" class="lm-group">
              <h2 class="lm-h2">LMR constraints</h2>
              <p class="lm-lead">The datasets in the <code>lmr</code> schema that the Low and Mid-Rise Housing Policy is checked against. Each layer's note is its table's own description.</p>
              <details v-for="cg in constraintGroups" :key="cg.key" class="lm-family" :open="cg.layers.some(c => on.has(c.key))">
                <summary class="lm-family-sum">
                  <span class="lm-swatch" :style="constraintSwatchCss(cg.layers[0]!.key)" />
                  <span class="lm-name">{{ cg.title }}</span>
                  <span class="lm-count">{{ cg.layers.length }}</span>
                </summary>
                <p class="lm-blurb">{{ cg.lead }}</p>
                <ul class="lm-list lm-list--indent">
                  <li v-for="c in cg.layers" :key="c.key" class="lm-item">
                    <label class="lm-row">
                      <input type="checkbox" :checked="on.has(c.key)" @change="toggle(c.key)">
                      <span class="lm-swatch" :style="constraintSwatchCss(c.key)" />
                      <span class="lm-name">{{ c.title }}</span>
                      <span class="lm-count">{{ fmt(c.features) }}</span>
                    </label>
                    <ul v-if="constraintStyle(c.key).classes" class="lm-cats">
                      <li v-for="cat in c.categories" :key="cat.name">
                        <span class="lm-swatch lm-swatch--small" :style="constraintSwatchCss(c.key, cat.name)" />{{ cat.name }} <span class="lm-dim">{{ fmt(cat.features) }}</span>
                      </li>
                    </ul>
                    <p class="lm-meta">
                      <code>{{ c.table }}</code><template v-if="c.minZoom"> · shown from zoom {{ c.minZoom }}</template>
                      <button v-if="c.bbox" type="button" class="lm-link" @click="zoomTo(c.key, c.bbox)">zoom to</button>
                    </p>
                    <details v-if="c.comment" class="lm-classes">
                      <summary>about this table</summary>
                      <p class="lm-about">{{ c.comment }}</p>
                    </details>
                  </li>
                </ul>
              </details>
            </section>

            <!-- Everything else, by family and SEPP -->
            <section class="lm-group">
              <h2 class="lm-h2">Other SEPP land application layers</h2>
              <p class="lm-lead">Drawn with dashed outlines, one colour per family. Click the map to see every layer that applies at a point.</p>
              <details v-for="fam in families" :key="fam.key" class="lm-family" :open="fam.layers.some(l => on.has(l.key))">
                <summary class="lm-family-sum">
                  <span class="lm-swatch lm-swatch--dash" :style="{ borderColor: fam.color }" />
                  <span class="lm-name">{{ fam.title }}</span>
                  <span class="lm-count">{{ fam.layers.length }}</span>
                </summary>
                <p class="lm-blurb">{{ fam.blurb }}</p>
                <div v-for="s in fam.sepps" :key="s.sepp" class="lm-sepp">
                  <p class="lm-sepp-name">{{ s.sepp }}</p>
                  <ul class="lm-list">
                    <li v-for="l in s.layers" :key="l.key" class="lm-item">
                      <label class="lm-row">
                        <input type="checkbox" :checked="on.has(l.key)" @change="toggle(l.key)">
                        <span class="lm-swatch lm-swatch--dash" :style="{ borderColor: colorOf(l) }" />
                        <span class="lm-name">{{ l.layName }}</span>
                        <span class="lm-count">{{ fmt(l.features) }}</span>
                      </label>
                      <p class="lm-meta">
                        <!-- lga_name on SEPP rows holds the text "SEPP", not a council, so no council count here -->
                        <template v-if="l.classes.length > 1">{{ l.classes.length }} classes</template>
                        <template v-if="l.minZoom">{{ l.classes.length > 1 ? ' · ' : '' }}shown from zoom {{ l.minZoom }}</template>
                        <button v-if="l.bbox" type="button" class="lm-link" @click="zoomTo(l.key, l.bbox)">zoom to</button>
                      </p>
                      <details v-if="l.classes.length > 1" class="lm-classes">
                        <summary>classes</summary>
                        <ul><li v-for="c in l.classes" :key="c.name">{{ c.name }} <span class="lm-dim">{{ fmt(c.features) }}</span></li></ul>
                      </details>
                    </li>
                  </ul>
                </div>
              </details>
            </section>

            <p class="lm-foot">
              Source: <code>epi.epi_land_application</code>, SEPP rows, as loaded by <code>01A dump-gdal</code><template v-if="catalogue.sourceLoadedAt">
              on {{ fmtDate(catalogue.sourceLoadedAt) }}</template>. Tiles: <code>{{ catalogue.archive }}</code>, built
              {{ catalogue.builtAt ? fmtDate(catalogue.builtAt) : '—' }} by <code>scripts/build-sepp-pmtiles.py</code>; rebuild after each EPI load.
              <template v-if="catalogue.constraints">
                LMR constraints: the <code>lmr</code> schema, tiles <code>{{ catalogue.constraints.archive }}</code> built
                {{ catalogue.constraints.builtAt ? fmtDate(catalogue.constraints.builtAt) : '—' }} by <code>scripts/build-lmr-pmtiles.py</code>.
              </template>
            </p>
          </template>
        </div>
      </aside>

      <div class="lm-mapwrap">
        <div ref="mapEl" class="lm-map" />
        <p v-if="!mapboxToken" class="lm-error lm-over">No Mapbox token: set NUXT_PUBLIC_MAPBOX_TOKEN in .env and restart the dev server.</p>
        <p v-if="status" class="lm-status">{{ status }}</p>

        <!-- What applies at the clicked point -->
        <section v-if="picked" class="lm-pick" aria-live="polite">
          <header class="lm-pick-head">
            <h2 class="lm-h2">At this point</h2>
            <button type="button" class="lm-x" aria-label="Close" @click="clearPick">×</button>
          </header>
          <p class="lm-dim">{{ picked.lat.toFixed(5) }}, {{ picked.lon.toFixed(5) }}</p>
          <p v-if="picking" class="lm-dim">Checking every SEPP layer…</p>
          <p v-else-if="pickError" class="lm-error">{{ pickError }}</p>
          <template v-else>
            <p v-if="!picked.hits.length" class="lm-dim">No SEPP land application layer or LMR constraint covers this point.</p>
            <p v-else-if="!picked.hits.some(h => h.family === 'lmr')" class="lm-note lm-note--plain">None of the four LMR layers covers this point.</p>
            <ul class="lm-hits">
              <li v-for="(h, i) in picked.hits" :key="i" class="lm-hit">
                <span v-if="h.family === 'constraint'" class="lm-swatch" :style="constraintSwatchCss(h.key, h.layClass)" />
                <span v-else class="lm-swatch" :class="h.family === 'lmr' ? 'lm-swatch--lmr' : 'lm-swatch--dash'" :style="swatchStyle(h as any)" />
                <div>
                  <p class="lm-hit-name">{{ h.layName }}<span v-if="h.layClass && h.layClass !== h.layName" class="lm-dim"> · {{ h.layClass }}</span></p>
                  <p class="lm-meta">{{ h.sepp }}<template v-if="h.clause"> · {{ h.clause }}</template><template v-if="h.lga && h.lga !== 'SEPP'"> · {{ h.lga }}</template></p>
                  <p v-if="h.label" class="lm-meta">{{ h.label }}</p>
                  <button v-if="!on.has(h.key)" type="button" class="lm-link" @click="toggle(h.key)">show on map</button>
                </div>
              </li>
            </ul>
          </template>
        </section>
      </div>

      <!-- How the layer gets built, beside the map it is built from -->
      <aside class="lm-guide" :class="{ 'lm-guide--closed': !guideOpen }">
        <button type="button" class="lm-guide-toggle" :aria-expanded="guideOpen" @click="toggleGuide">
          {{ guideOpen ? 'Hide guide' : 'How the LMR layer is built' }}
        </button>
        <div v-show="guideOpen" class="lm-guide-inner">
          <h2 class="lm-h2">How the LMR layer is built</h2>
          <p class="lm-lead">{{ LMR_METHOD_LEAD }}</p>
          <ol class="lm-steps">
            <li v-for="step in LMR_METHOD" :key="step.n" class="lm-step">
              <p class="lm-step-title"><span class="lm-step-n">{{ step.n }}</span>{{ step.title }}</p>
              <p class="lm-step-body">{{ step.body }}</p>
              <p v-if="step.layers" class="lm-step-layers">
                <button
                  v-for="name in step.layers" :key="name" type="button"
                  class="lm-chip" :class="{ 'lm-chip--on': !!keyOf(name) && on.has(keyOf(name)!) }"
                  :disabled="!keyOf(name)"
                  :title="keyOf(name) ? 'Show or hide this layer' : 'Not on the map yet'"
                  @click="toggleNamed(name)"
                >{{ name }}</button>
              </p>
              <p v-if="step.note" class="lm-step-note">{{ step.note }}</p>
            </li>
          </ol>
          <h3 class="lm-h3">Still to settle</h3>
          <div v-for="gap in LMR_METHOD_GAPS" :key="gap.title" class="lm-gap">
            <p class="lm-step-title">{{ gap.title }}</p>
            <p class="lm-step-body">{{ gap.body }}</p>
          </div>
          <p class="lm-foot">
            Chapter 6 of State Environmental Planning Policy (Housing) 2021. Stage 1 (dual occupancies in R2 across
            NSW) commenced 1 July 2024, Stage 2 (the low and mid-rise housing areas) 28 February 2025; exclusions as
            the Department listed them on 24 April 2026.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { LMR_METHOD, LMR_METHOD_GAPS, LMR_METHOD_LEAD } from '#shared/lmr-method'
import {
  CONSTRAINT_GROUPS, CONSTRAINT_STYLE, FAMILY, LMR_BLURB, LMR_LAYER_NAMES, colorOf as colorOfLayer,
  constraintStyle, constraintSwatchCss, lmrStyle, swatchCss,
  type ConstraintCatalogue, type ConstraintGroup, type ConstraintLayer,
  type LmrCatalogue, type LmrFamily, type LmrHit, type LmrLayer,
} from '#shared/lmr-layers'

useHead({ title: 'LMR · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')

type Catalogue = LmrCatalogue & { archive: string; constraints: ConstraintCatalogue | null }
const catalogue = ref<Catalogue | null>(null)
const loadError = ref('')
const on = ref(new Set<string>())
const panelOpen = ref(true)
const status = ref('')
const mapEl = ref<HTMLElement | null>(null)

let map: any = null
let mapboxgl: any = null
let marker: any = null

const SOURCE = 'sepp'
const colorOf = (l: { family: LmrFamily; layName: string }) => colorOfLayer(l)

const lmrLayers = computed(() => {
  const ls = (catalogue.value?.layers ?? []).filter(l => l.family === 'lmr')
  return [...ls].sort((a, b) => LMR_LAYER_NAMES.indexOf(a.layName as any) - LMR_LAYER_NAMES.indexOf(b.layName as any))
})

/** The four Housing SEPP layers, split into the two provisions they serve, each listed in panel order. */
const HOUSING_GROUPS: { key: ConstraintGroup | 'tod'; title: string; lead: string; names: string[] }[] = [
  {
    key: 'housing',
    title: 'Low and Mid Rise housing',
    lead: 'The Housing SEPP layers that decide where the low and mid rise housing provisions reach.',
    names: ['Town Centre', 'Low and Mid Rise Housing Exclusion Area'],
  },
  {
    key: 'tod',
    title: 'Transport Oriented Development',
    lead: 'The Housing SEPP\'s TOD areas, and the precincts rezoned under the accelerated TOD program.',
    names: ['Transport Oriented Development Area', 'Accelerated TOD Precinct'],
  },
]

const housingGroups = computed(() => HOUSING_GROUPS.map(g => ({
  ...g,
  layers: g.names.map(n => lmrLayers.value.find(l => l.layName === n)).filter((l): l is LmrLayer => !!l),
})).filter(g => g.layers.length))

// ── the lmr schema layers ────────────────────────────────────────────────────

const constraintLayers = computed<ConstraintLayer[]>(() => catalogue.value?.constraints?.layers ?? [])

function constraintsIn(group: string): ConstraintLayer[] {
  // panel order is the order of CONSTRAINT_STYLE, not the order the archive was built in
  const order = Object.keys(CONSTRAINT_STYLE)
  return constraintLayers.value.filter(c => c.group === group).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}

const constraintGroups = computed(() => (Object.keys(CONSTRAINT_GROUPS) as (keyof typeof CONSTRAINT_GROUPS)[])
  .map(key => ({ key, ...CONSTRAINT_GROUPS[key], layers: constraintsIn(key) }))
  .filter(g => g.layers.length))

/** A table comment's opening sentence, for the panel. */
function firstSentence(text: string | null): string {
  if (!text) return ''
  const m = text.match(/^(.+?[.:])(\s|$)/)
  // a description that opens "X: how it was made" reads as a sentence once the colon is a full stop
  return m ? m[1]!.replace(/:$/, '.') : text
}

const families = computed(() => (['housing', 'precincts', 'environment', 'systems'] as const).map((key) => {
  const layers = (catalogue.value?.layers ?? []).filter(l => l.family === key)
  const bySepp = new Map<string, LmrLayer[]>()
  for (const l of layers) {
    if (!bySepp.has(l.sepp)) bySepp.set(l.sepp, [])
    bySepp.get(l.sepp)!.push(l)
  }
  return { key, ...FAMILY[key], layers, sepps: [...bySepp.entries()].map(([sepp, ls]) => ({ sepp, layers: ls })) }
}).filter(f => f.layers.length))

// ── the map ────────────────────────────────────────────────────────────────

/** The tile URL names the archive, so a rebuilt archive is never served from an old cached tile. */
function tileUrl(): string {
  const v = encodeURIComponent(catalogue.value?.archive ?? '0')
  return `${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?v=${v}`
}

/** A match expression over layer_key, one value per layer in the catalogue. */
function byLayer(value: (l: LmrLayer) => string | number, fallback: string | number): any[] {
  const pairs = (catalogue.value?.layers ?? []).flatMap(l => [l.key, value(l)])
  return pairs.length ? ['match', ['get', 'layer_key'], ...pairs, fallback] : fallback as any
}

/** Draw order within the LMR group, bottom to top, as on the Planning Portal: TOD areas under the precincts
 *  and centres, the exclusion hatch over everything. */
const LMR_ORDER: Record<string, number> = {
  'Transport Oriented Development Area': 1,
  'Accelerated TOD Precinct': 2,
  'Town Centre': 3,
  'Low and Mid Rise Housing Exclusion Area': 4,
}

/** The exclusion hatch: grey diagonal lines on transparent, so the ground shows through as on the portal. */
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const data = new Uint8Array(size * size * 4)
  const [r, g, b] = [0x6b, 0x6b, 0x6b]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // one 2-px line per tile along x + y = const, so repeated tiles join into continuous 45-degree lines
      if ((x + y) % size < 2) {
        const i = (y * size + x) * 4
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 230
      }
    }
  }
  return { width: size, height: size, data }
}

/** LMR or other SEPP, and switched on. Heavy layers' minimum zoom is baked into the archive by tippecanoe. */
function zoomFilter(group: 'lmr' | 'sepp'): any[] {
  return ['all', ['==', ['get', 'layer_group'], group], ['in', ['get', 'layer_key'], ['literal', [...on.value]]]]
}

const DRAWN = [['sepp-fill', 'sepp'], ['sepp-line', 'sepp'], ['lmr-fill', 'lmr'], ['lmr-hatch', 'lmr'], ['lmr-line', 'lmr']] as const

function addLayers() {
  if (!map || map.getSource(SOURCE)) return
  // the archive stops at zoom 14; the map overzooms its tiles past that
  map.addSource(SOURCE, { type: 'vector', tiles: [tileUrl()], minzoom: 4, maxzoom: 14 })
  if (!map.hasImage('lmr-hatch')) map.addImage('lmr-hatch', hatchImage(), { pixelRatio: 2 })
  const common = { source: SOURCE, 'source-layer': 'sepp' }
  const lmr = (l: LmrLayer) => lmrStyle(l.layName)
  const order = byLayer(l => LMR_ORDER[l.layName] ?? 0, 0)

  // other SEPP layers under the LMR layers: a faint family fill and a dashed family outline
  const family = byLayer(l => colorOf(l), '#64748b')
  map.addLayer({ ...common, id: 'sepp-fill', type: 'fill', filter: zoomFilter('sepp'), paint: { 'fill-color': family, 'fill-opacity': 0.12 } })
  map.addLayer({ ...common, id: 'sepp-line', type: 'line', filter: zoomFilter('sepp'), paint: { 'line-color': family, 'line-width': 1.4, 'line-dasharray': [3, 2] } })

  // the LMR layers in the Planning Portal's symbology: flat fills, the exclusion as a hatch, then outlines
  map.addLayer({
    ...common, id: 'lmr-fill', type: 'fill', filter: zoomFilter('lmr'),
    layout: { 'fill-sort-key': order },
    paint: { 'fill-color': byLayer(l => lmr(l).fill, '#cbd5e1'), 'fill-opacity': byLayer(l => (lmr(l).hatch ? 0 : lmr(l).fillOpacity), 0.6) },
  })
  map.addLayer({
    ...common, id: 'lmr-hatch', type: 'fill',
    filter: ['all', zoomFilter('lmr'), ['==', ['get', 'lay_name'], 'Low and Mid Rise Housing Exclusion Area']],
    paint: { 'fill-pattern': 'lmr-hatch' },
  })
  map.addLayer({
    ...common, id: 'lmr-line', type: 'line', filter: zoomFilter('lmr'),
    layout: { 'line-sort-key': order, 'line-join': 'round' },
    paint: { 'line-color': byLayer(l => lmr(l).line, '#475569'), 'line-width': byLayer(l => lmr(l).lineWidth, 1) },
  })
}

// ── the constraints source: the lmr schema archive ───────────────────────────

const guideOpen = ref(true)

/** The map has to be told its box changed when the guide opens or closes. */
async function toggleGuide() {
  guideOpen.value = !guideOpen.value
  await nextTick()
  map?.resize()
}

/**
 * A layer title in the guide back to its key, so a step's chips switch the very layers it
 * describes. A title we hold no layer for resolves to nothing and its chip stays inert.
 */
function keyOf(title: string): string | undefined {
  const c = constraintLayers.value.find(l => l.title === title)
  if (c) return c.key
  return (catalogue.value?.layers ?? []).find(l => l.layName === title)?.key
}

function toggleNamed(title: string) {
  const key = keyOf(title)
  if (key) toggle(key)
}

const CSOURCE = 'lmrc'

/** Constraint layer keys matching a test on their style. */
function constraintKeys(test: (s: ReturnType<typeof constraintStyle>) => boolean): string[] {
  return constraintLayers.value.filter(c => test(constraintStyle(c.key))).map(c => c.key)
}

/** A match expression over layer_key for the constraint layers. */
function byConstraint(value: (s: ReturnType<typeof constraintStyle>) => string | number, fallback: string | number): any {
  const pairs = constraintLayers.value.flatMap(c => [c.key, value(constraintStyle(c.key))])
  return pairs.length ? ['match', ['get', 'layer_key'], ...pairs, fallback] : fallback
}

/** Which constraint layers a drawn layer covers, intersected with what is switched on. */
const C_DRAWN: [string, (s: ReturnType<typeof constraintStyle>) => boolean][] = [
  ['c-fill', s => s.kind === 'fill'],
  ['c-line', s => (s.kind === 'fill' && !!s.lineWidth && !s.dashed) || s.kind === 'line'],
  ['c-line-dash', s => s.kind === 'fill' && !!s.lineWidth && !!s.dashed],
  ['c-circle', s => s.kind === 'point'],
]

function constraintFilter(test: (s: ReturnType<typeof constraintStyle>) => boolean): any[] {
  const keys = constraintKeys(test).filter(k => on.value.has(k))
  return ['in', ['get', 'layer_key'], ['literal', keys]]
}

function addConstraintLayers() {
  const cat = catalogue.value?.constraints
  if (!map || !cat || map.getSource(CSOURCE)) return
  const v = encodeURIComponent(cat.archive)
  map.addSource(CSOURCE, { type: 'vector', tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=lmr&v=${v}`], minzoom: 4, maxzoom: 14 })
  const common = { source: CSOURCE, 'source-layer': 'lmr' }
  // a layer with classes (bushfire RFS categories, walking catchment distances) is coloured by its category,
  // everything else by its layer's colour
  const classed = constraintLayers.value.filter(c => constraintStyle(c.key).classes)
  const fillColor = classed.length
    ? ['case',
        ...classed.flatMap(c => {
          const s = constraintStyle(c.key)
          return [['==', ['get', 'layer_key'], c.key], ['match', ['coalesce', ['get', 'category'], ''], ...Object.entries(s.classes!).flat(), s.color]]
        }),
        byConstraint(s => s.color, '#94a3b8')]
    : byConstraint(s => s.color, '#94a3b8')
  // constraints draw between the other SEPP layers and the LMR layers, so the Housing SEPP layers stay on top
  const before = map.getLayer('lmr-fill') ? 'lmr-fill' : undefined
  const filters = Object.fromEntries(C_DRAWN.map(([id, test]) => [id, constraintFilter(test)]))
  map.addLayer({ ...common, id: 'c-fill', type: 'fill', filter: filters['c-fill'],
    // land zoning is the base of the constraints, and a 400 m catchment draws over the 800 m one it sits inside
    layout: { 'fill-sort-key': ['case', ['==', ['get', 'layer_key'], 'epi_land_zoning'], 0, ['==', ['get', 'category'], '400 m'], 2, 1] },
    paint: { 'fill-color': fillColor, 'fill-opacity': byConstraint(s => s.fillOpacity ?? 0.3, 0.3) } }, before)
  map.addLayer({ ...common, id: 'c-line', type: 'line', filter: filters['c-line'], layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': byConstraint(s => s.line ?? s.color, '#475569'), 'line-width': byConstraint(s => s.lineWidth ?? 1, 1) } }, before)
  map.addLayer({ ...common, id: 'c-line-dash', type: 'line', filter: filters['c-line-dash'],
    paint: { 'line-color': byConstraint(s => s.line ?? s.color, '#475569'), 'line-width': byConstraint(s => s.lineWidth ?? 1, 1), 'line-dasharray': [3, 2] } }, before)
  // the stations sit on top of everything, like the portal's LMR Station dots
  map.addLayer({ ...common, id: 'c-circle', type: 'circle', filter: filters['c-circle'],
    paint: {
      'circle-color': byConstraint(s => s.color, '#7a7a7a'),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 5, 16, 7],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    } })
}

function refreshTiles() {
  if (map?.getSource(SOURCE)) {
    for (const [id, group] of DRAWN) {
      if (!map.getLayer(id)) continue
      map.setFilter(id, id === 'lmr-hatch'
        ? ['all', zoomFilter(group), ['==', ['get', 'lay_name'], 'Low and Mid Rise Housing Exclusion Area']]
        : zoomFilter(group))
    }
  }
  if (map?.getSource(CSOURCE)) {
    for (const [id, test] of C_DRAWN) if (map.getLayer(id)) map.setFilter(id, constraintFilter(test))
  }
  syncHash()
}

/** Every layer the panel offers, so the count beside "Turn all off" matches what can be switched on. */
const layerCount = computed(() => (catalogue.value?.layers.length ?? 0) + constraintLayers.value.length)

/** Clear the map: the same path as a toggle, so the filters and the URL follow. */
function allOff() {
  on.value = new Set()
  refreshTiles()
}

function toggle(key: string) {
  const next = new Set(on.value)
  next.has(key) ? next.delete(key) : next.add(key)
  on.value = next
  refreshTiles()
}

function zoomTo(key: string, bbox: [number, number, number, number] | null) {
  if (!map || !bbox) return
  if (!on.value.has(key)) toggle(key)
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 800, maxZoom: 15 })
}

// ── what applies at a point ──────────────────────────────────────────────────

const picked = ref<{ lon: number; lat: number; hits: LmrHit[] } | null>(null)
const picking = ref(false)
const pickError = ref('')

async function pick(lon: number, lat: number) {
  picked.value = { lon, lat, hits: [] }
  picking.value = true
  pickError.value = ''
  marker?.remove()
  marker = new mapboxgl.Marker({ color: '#0f172a', scale: 0.7 }).setLngLat([lon, lat]).addTo(map)
  try {
    const r = await $fetch<{ lon: number; lat: number; hits: LmrHit[] }>('/api/lmr/at', { query: { lon, lat } })
    if (picked.value?.lon === lon && picked.value?.lat === lat) picked.value = r
  } catch (e: any) {
    pickError.value = e?.data?.statusMessage || e?.message || 'Could not read the layers at this point.'
  } finally {
    picking.value = false
  }
}

function clearPick() {
  picked.value = null
  marker?.remove()
  marker = null
}

function swatchStyle(h: { family: LmrFamily; layName: string }) {
  return swatchCss(h)
}

// ── address search (Mapbox geocoding, NSW only) ─────────────────────────────

const addr = ref('')
const searching = ref(false)
const searchMsg = ref('')

async function searchAddress() {
  const q = addr.value.trim()
  if (!q || !map) return
  searching.value = true
  searchMsg.value = ''
  try {
    const params = new URLSearchParams({
      q, access_token: mapboxToken, country: 'au', limit: '1', language: 'en',
      bbox: '140.9,-37.6,153.7,-28.1', proximity: '151.2093,-33.8688',
    })
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`)
    const f = (await res.json())?.features?.[0]
    if (!f) { searchMsg.value = `Nothing found for "${q}".`; return }
    const [lon, lat] = f.geometry.coordinates as [number, number]
    map.flyTo({ center: [lon, lat], zoom: 16, duration: 1000 })
    await pick(lon, lat)
  } catch {
    searchMsg.value = 'The address search failed.'
  } finally {
    searching.value = false
  }
}

// ── URL hash: layers and view ────────────────────────────────────────────────

function syncHash() {
  if (!map) return
  const c = map.getCenter()
  const h = `#${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}/${[...on.value].join(',')}`
  history.replaceState(null, '', h)
}

function readHash(): { zoom: number; lat: number; lon: number; layers: string[] } | null {
  const m = window.location.hash.slice(1).split('/')
  if (m.length < 3) return null
  const [zoom, lat, lon] = m.slice(0, 3).map(Number)
  if (![zoom, lat, lon].every(Number.isFinite)) return null
  return { zoom: zoom!, lat: lat!, lon: lon!, layers: (m[3] ?? '').split(',').filter(Boolean) }
}

// ── init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    catalogue.value = await $fetch<Catalogue>('/api/lmr/layers')
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage || e?.message || 'Could not load the layer list.'
    return
  }
  const hash = readHash()
  const known = new Set([...catalogue.value.layers.map(l => l.key), ...constraintLayers.value.map(c => c.key)])
  const defaults = [
    ...lmrLayers.value.map(l => l.key),
    ...constraintLayers.value.filter(c => constraintStyle(c.key).defaultOn).map(c => c.key),
  ]
  on.value = new Set(hash?.layers.length ? hash.layers.filter(k => known.has(k)) : defaults)

  if (!mapboxToken) return
  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken
  map = new mapboxgl.Map({
    container: mapEl.value!,
    style: 'mapbox://styles/mapbox/light-v11',
    center: hash ? [hash.lon, hash.lat] : [151.0, -33.8],
    zoom: hash ? hash.zoom : 10,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  map.on('load', () => { addLayers(); addConstraintLayers() })
  map.on('moveend', syncHash)
  map.on('click', (e: any) => pick(e.lngLat.lng, e.lngLat.lat))
  map.on('dataloading', () => { if (on.value.size) status.value = 'Loading tiles…' })
  map.on('idle', () => { status.value = '' })
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (msg && !/aborted/i.test(msg)) status.value = msg.slice(0, 140)
  })
  if (import.meta.dev) (window as any).__lmrMap = map
})

onBeforeUnmount(() => {
  marker?.remove()
  map?.remove()
  map = null
})

// ── formatting ───────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-AU')
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<style>
body { margin: 0; background: #f8fafb; }
</style>

<style scoped>
.lm-page { height: 100vh; display: flex; flex-direction: column; background: #f8fafb; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.lm-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0; }
.lm-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.2rem; }
.lm-back:hover { color: #0f172a; }
.lm-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; }
.lm-header-stat { font-size: 0.8rem; color: #64748b; }
.lm-header-stat strong { color: #0f172a; }

.lm-body { flex: 1; min-height: 0; display: flex; }
.lm-panel { position: relative; width: 360px; flex: none; overflow-y: auto; background: #fff; border-right: 1px solid #e2e8f0; }
.lm-panel--closed { width: auto; }
.lm-panel-toggle { display: none; }
.lm-panel-inner { padding: 0.9rem 1rem 2rem; }
.lm-mapwrap { position: relative; flex: 1; min-width: 0; }
.lm-guide { position: relative; width: 380px; flex: none; overflow-y: auto; background: #fff; border-left: 1px solid #e2e8f0; }
.lm-guide--closed { width: auto; }
.lm-guide-toggle { width: 100%; padding: 0.6rem 0.9rem; border: 0; border-bottom: 1px solid #e2e8f0; background: #f8fafc; font: inherit; font-weight: 700; color: #0f172a; text-align: left; cursor: pointer; white-space: nowrap; }
.lm-guide-toggle:hover { background: #f1f5f9; }
.lm-guide-inner { padding: 0.9rem 1rem 2rem; }
.lm-steps { list-style: none; margin: 0.8rem 0 0; padding: 0; display: grid; gap: 0.9rem; }
.lm-step { padding-bottom: 0.9rem; border-bottom: 1px solid #f1f5f9; }
.lm-step:last-child { border-bottom: 0; }
.lm-step-title { display: flex; align-items: baseline; gap: 0.45rem; margin: 0 0 0.25rem; font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.lm-step-n { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; flex: none; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.72rem; }
.lm-step-body { margin: 0; font-size: 0.84rem; line-height: 1.55; color: #334155; }
.lm-step-layers { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0.45rem 0 0; }
.lm-chip { padding: 0.12rem 0.45rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font: inherit; font-size: 0.72rem; color: #475569; cursor: pointer; }
.lm-chip:hover:not(:disabled) { border-color: #94a3b8; color: #0f172a; }
.lm-chip--on { border-color: #0f172a; background: #0f172a; color: #fff; }
.lm-chip:disabled { border-style: dashed; color: #94a3b8; cursor: default; }
.lm-step-note { margin: 0.45rem 0 0; padding-left: 0.5rem; border-left: 2px solid #cbd5e1; font-size: 0.78rem; line-height: 1.5; color: #57534e; }
.lm-h3 { margin: 1.4rem 0 0.4rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lm-gap { margin-bottom: 0.7rem; }
.lm-map { position: absolute; inset: 0; }

.lm-search { display: flex; gap: 0.4rem; margin-bottom: 0.4rem; }
.lm-input { flex: 1; min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.lm-input:focus { outline: 2px solid #2a78d6; outline-offset: 1px; }
.lm-btn { padding: 0.45rem 0.8rem; border: 0; border-radius: 8px; background: #0f172a; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.lm-btn:disabled { opacity: 0.5; cursor: default; }
.lm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.lm-allrow { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin: 0.6rem 0 0; padding-bottom: 0.5rem; border-bottom: 1px solid #e2e8f0; font-size: 0.8rem; }
.lm-link:disabled { color: #94a3b8; cursor: default; }
.lm-link:disabled:hover { text-decoration: none; }
.lm-group { margin-top: 1rem; }
.lm-h2 { margin: 0 0 0.2rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lm-lead { margin: 0 0 0.5rem; font-size: 0.8rem; color: #475569; }
.lm-list { list-style: none; margin: 0; padding: 0; }
.lm-item { padding: 0.35rem 0; border-top: 1px solid #f1f5f9; }
.lm-row { display: flex; align-items: center; gap: 0.45rem; cursor: pointer; }
.lm-row input { margin: 0; accent-color: #0f172a; }
.lm-name { flex: 1; min-width: 0; font-size: 0.84rem; font-weight: 600; color: #0f172a; }
.lm-count { font-size: 0.74rem; color: #64748b; font-variant-numeric: tabular-nums; }
.lm-swatch { flex: none; width: 14px; height: 14px; border-radius: 3px; border: 2px solid; box-sizing: border-box; }
.lm-swatch--dash { background: transparent !important; border-style: dashed; }
/* the Planning Portal draws its legend symbols a little larger, with the outline weight of the map */
.lm-swatch--lmr { width: 18px; height: 16px; border-radius: 2px; border-width: 1.5px; }
.lm-blurb { margin: 0.15rem 0 0 1.7rem; font-size: 0.76rem; color: #475569; }
.lm-meta { margin: 0.1rem 0 0 1.7rem; font-size: 0.72rem; color: #64748b; }
.lm-link { margin-left: 0.4rem; padding: 0; border: 0; background: none; color: #2a78d6; font: inherit; font-weight: 600; cursor: pointer; }
.lm-link:hover { text-decoration: underline; }
.lm-family { border-top: 1px solid #e2e8f0; padding: 0.35rem 0; }
.lm-family-sum { display: flex; align-items: center; gap: 0.45rem; cursor: pointer; list-style: none; padding: 0.2rem 0; }
.lm-family-sum::-webkit-details-marker { display: none; }
.lm-family-sum::before { content: '▸'; color: #94a3b8; font-size: 0.7rem; width: 0.6rem; }
.lm-family[open] > .lm-family-sum::before { content: '▾'; }
.lm-family > .lm-blurb { margin-left: 1rem; }
.lm-sepp { margin: 0.4rem 0 0 1rem; }
.lm-sepp-name { margin: 0.2rem 0; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b; }
.lm-classes { margin: 0.15rem 0 0 1.7rem; font-size: 0.72rem; color: #475569; }
.lm-classes summary { cursor: pointer; color: #2a78d6; }
.lm-classes ul { margin: 0.2rem 0 0; padding-left: 1rem; }
.lm-list--indent { margin-left: 1rem; }
.lm-cats { list-style: none; margin: 0.2rem 0 0 1.7rem; padding: 0; font-size: 0.72rem; color: #475569; display: grid; gap: 0.1rem; }
.lm-cats li { display: flex; align-items: center; gap: 0.35rem; }
.lm-swatch--small { width: 10px; height: 10px; border-width: 1px; }
.lm-about { margin: 0.2rem 0 0; font-size: 0.72rem; line-height: 1.45; color: #475569; }
.lm-foot { margin-top: 1.2rem; font-size: 0.72rem; color: #64748b; }
.lm-page code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0 0.25em; }
.lm-dim { color: #94a3b8; }
.lm-note { margin: 0.3rem 0; padding-left: 0.5rem; border-left: 2px solid #fbbf24; font-size: 0.78rem; color: #57534e; }
.lm-note--plain { border-left-color: #cbd5e1; }
.lm-error { color: #b91c1c; font-size: 0.82rem; }
.lm-over { position: absolute; top: 1rem; left: 1rem; background: #fff; padding: 0.5rem 0.75rem; border-radius: 8px; }
.lm-status { position: absolute; left: 50%; bottom: 1.2rem; transform: translateX(-50%); margin: 0; padding: 0.25rem 0.7rem; border-radius: 999px; background: rgba(15, 23, 42, 0.8); color: #fff; font-size: 0.76rem; }

.lm-pick { position: absolute; top: 0.75rem; left: 0.75rem; width: min(340px, calc(100% - 1.5rem)); max-height: calc(100% - 3rem); overflow-y: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15); padding: 0.7rem 0.85rem; }
.lm-pick-head { display: flex; justify-content: space-between; align-items: center; }
.lm-x { border: 0; background: none; font-size: 1.3rem; line-height: 1; color: #64748b; cursor: pointer; }
.lm-hits { list-style: none; margin: 0.4rem 0 0; padding: 0; }
.lm-hit { display: flex; gap: 0.5rem; padding: 0.4rem 0; border-top: 1px solid #f1f5f9; }
.lm-hit .lm-swatch { margin-top: 0.2rem; }
.lm-hit-name { margin: 0; font-size: 0.84rem; font-weight: 700; color: #0f172a; }
.lm-hit .lm-meta { margin-left: 0; }
.lm-hit .lm-link { margin-left: 0; }

@media (max-width: 760px) {
  .lm-page { height: auto; min-height: 100vh; }
  .lm-header { padding: 0.8rem 1rem; }
  .lm-body { flex-direction: column; }
  .lm-panel { width: auto; max-height: none; border-right: 0; border-bottom: 1px solid #e2e8f0; }
  .lm-panel-toggle { display: block; width: 100%; padding: 0.6rem 1rem; border: 0; background: #f1f5f9; font: inherit; font-weight: 700; text-align: left; cursor: pointer; }
  .lm-mapwrap { height: 70vh; flex: none; }
  .lm-guide { width: auto; border-left: 0; border-top: 1px solid #e2e8f0; }
}
</style>
