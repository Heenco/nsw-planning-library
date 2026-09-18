<!--
  /esa - the additional environmentally sensitive areas of clause 3.3, on a map.

  Three columns: what the layer holds on the left, the map in the middle, how it was built on the right. The
  detail all lives in the left panel - the plans and their items, the services each item was drawn from, what
  still needs checking - so the map stays a map and the reading happens beside it.

  The two tiers are the whole point of the page and are drawn differently: a precise item is real geometry, an
  advisory one is its entire council area and means only "this exception exists somewhere here". Clicking a
  shape, or an item in the panel, selects it: the panel shows the item and the map goes to it.

  Tiles: esa-exceptions.pmtiles on the planningai host (scripts/build-esa-pmtiles.py), read through
  /api/lmr/tiles?set=esa. Everything else comes from /api/esa.
-->

<template>
  <div class="ea-page">
    <header class="ea-header">
      <div>
        <NuxtLink to="/" class="ea-back">&larr; Home</NuxtLink>
        <h1 class="ea-title">Environmentally sensitive areas — the LEP additions</h1>
      </div>
      <div v-if="data?.ok" class="ea-header-stat">
        <strong>{{ data.summary.items }}</strong> items ·
        <strong>{{ data.summary.leps }}</strong> plans ·
        <strong>{{ data.summary.layers }}</strong> source layers
      </div>
    </header>

    <div class="ea-body">
      <!-- ── everything the layer holds ─────────────────────────────────── -->
      <aside class="ea-panel">
        <p v-if="error" class="ea-error">Could not load the layer: {{ error }}</p>
        <p v-else-if="data && !data.ok" class="ea-error">{{ data.reason }}</p>

        <template v-if="data?.ok">
          <!-- the two tiers, which are also the map's switches -->
          <div class="ea-tiers">
            <button
              v-for="t in TIERS" :key="t.key" type="button"
              class="ea-tier" :class="[`ea-tier--${t.key}`, { 'ea-tier--off': !shown.has(t.key) }]"
              :aria-pressed="shown.has(t.key)" @click="toggleTier(t.key)"
            >
              <span class="ea-tier-name">{{ t.label }}</span>
              <span class="ea-tier-n">{{ count(t.key) }}</span>
              <span class="ea-tier-note">{{ t.note }} · {{ fmt(area(t.key)) }} km²</span>
            </button>
          </div>

          <div class="ea-filters">
            <input v-model="term" type="search" class="ea-input" placeholder="Search the wording or a layer…">
            <select v-model="lep" class="ea-select">
              <option value="">All {{ plans.length }} plans</option>
              <option v-for="p in plans" :key="p" :value="p">{{ shortPlan(p) }}</option>
            </select>
            <button v-if="term || lep || layerFilter" type="button" class="ea-clear" @click="clearFilters">Clear</button>
          </div>
          <p class="ea-count">
            {{ visible.length }} of {{ data.summary.items }} items on the map<template v-if="layerFilter">,
              drawn from <b>{{ layerFilter.replace(/_/g, ' ') }}</b></template>
          </p>

          <!-- the selected item -->
          <section v-if="selected" class="ea-card">
            <div class="ea-card-head">
              <h2 class="ea-card-title">{{ shortPlan(selected.lepName) }} <code>{{ selected.ref }}</code></h2>
              <button type="button" class="ea-x" aria-label="Clear selection" @click="select(null)">×</button>
            </div>
            <p class="ea-card-text">{{ selected.exceptionText }}</p>
            <p class="ea-meta">
              <span class="ea-pill" :class="`ea-pill--${selected.coverageType}`">{{ selected.coverageType }}</span>
              <span v-if="selected.verifyRequired" class="ea-warn">verify on the ground</span>
              <span class="ea-dim">{{ fmt(selected.areaKm2) }} km²</span>
              <span v-if="selected.lgaName" class="ea-dim">{{ selected.lgaName }}</span>
            </p>
            <p class="ea-meta">
              <template v-if="selected.sourceLayers">
                drawn from <b>{{ selected.sourceLayers.replace(/_/g, ' ') }}</b>
                <span :class="selected.sourceFeatures ? 'ea-dim' : 'ea-warn'">
                  · {{ selected.sourceFeatures ? `${selected.sourceFeatures} features` : 'returned nothing, so this is the whole council area' }}
                </span>
              </template>
              <span v-else class="ea-dim">{{ STATUS_WORD[selected.status ?? ''] ?? selected.status }}</span>
            </p>
            <p v-if="selected.attributeFilter" class="ea-meta ea-dim">filtered: <code>{{ selected.attributeFilter }}</code></p>
          </section>

          <!-- the plans and their items -->
          <section class="ea-group">
            <h2 class="ea-h2">Plans and their exceptions</h2>
            <p class="ea-lead">
              Each plan adds its own items to clause 3.3. Pick one to see it on the map.
            </p>
            <details v-for="g in grouped" :key="g.lep" class="ea-plan" :open="grouped.length <= 3 || g.lep === selected?.lepName">
              <summary class="ea-plan-sum">
                <span class="ea-plan-name">{{ shortPlan(g.lep) }}</span>
                <span class="ea-plan-n">{{ g.items.length }}</span>
              </summary>
              <ul class="ea-items">
                <li v-for="i in g.items" :key="i.id">
                  <button
                    type="button" class="ea-item" :class="{ 'ea-item--on': selected?.id === i.id }"
                    @click="select(i)"
                  >
                    <span class="ea-item-ref"><code>{{ i.ref }}</code></span>
                    <span class="ea-item-text">{{ i.exceptionText }}</span>
                    <span class="ea-pill" :class="`ea-pill--${i.coverageType}`">{{ i.coverageType === 'precise' ? 'P' : 'A' }}</span>
                  </button>
                </li>
              </ul>
            </details>
          </section>

          <!-- what it was drawn from -->
          <section class="ea-group">
            <h2 class="ea-h2">What it is made from</h2>
            <p class="ea-lead">
              The services the build reads. Pick one to keep only the items drawn from it.
            </p>
            <ul class="ea-layers">
              <li v-for="l in data.layers" :key="l.layerName">
                <button
                  type="button" class="ea-layer" :class="{ 'ea-layer--on': layerFilter === l.layerName, 'ea-layer--base': l.role === 'base' }"
                  :disabled="l.role === 'base'"
                  @click="layerFilter = layerFilter === l.layerName ? '' : l.layerName"
                >
                  <span class="ea-layer-name">
                    {{ l.layerName.replace(/_/g, ' ') }}
                    <span v-if="l.role === 'base'" class="ea-pill ea-pill--base">base</span>
                  </span>
                  <span class="ea-layer-n">{{ l.role === 'base' ? `${l.leps} plans` : `${l.items} items` }}</span>
                </button>
                <a :href="l.endpoint" target="_blank" rel="noopener" class="ea-layer-src"><code>{{ l.service }}</code></a>
              </li>
            </ul>
          </section>

          <!-- the caveats that belong to the data rather than the method -->
          <section class="ea-group">
            <h2 class="ea-h2">What still needs a look</h2>
            <ul class="ea-checks">
              <li v-if="fallbacks.length">
                <b>{{ fallbacks.length }} items name a layer that returned nothing</b> and fell back to the whole plan
                area:
                <button v-for="f in fallbacks" :key="f.id" type="button" class="ea-link" @click="select(f)">{{ shortPlan(f.lepName) }} {{ f.ref }}</button>
              </li>
              <li><b>{{ data.summary.verifyRequired }} items are marked for verification</b> — every advisory one, {{ fmt(data.summary.advisoryKm2) }} km² between them.</li>
              <li><b>The state-wide part of clause 3.3 is not here.</b> This layer is only what individual plans add.</li>
            </ul>
            <p v-if="data.note" class="ea-note">{{ data.note }}</p>
          </section>
        </template>
      </aside>

      <!-- ── the map ──────────────────────────────────────────────────────── -->
      <div class="ea-mapwrap">
        <div ref="mapEl" class="ea-map" />
        <p v-if="!mapboxToken" class="ea-over ea-error">No Mapbox token: set NUXT_PUBLIC_MAPBOX_TOKEN in .env and restart the dev server.</p>
        <p v-else-if="data?.ok && !data.tiles" class="ea-over ea-error">
          No tile archive yet — run <code>scripts/build-esa-pmtiles.py</code> and publish it. The panels still work.
        </p>
        <p v-if="status" class="ea-status">{{ status }}</p>
        <div class="ea-legend">
          <span><i class="ea-key ea-key--precise" />precise — drawn from a layer</span>
          <span><i class="ea-key ea-key--advisory" />advisory — the whole council area</span>
        </div>
      </div>

      <!-- ── how it was built ─────────────────────────────────────────────── -->
      <aside class="ea-guide">
        <div class="ea-guide-inner">
          <h2 class="ea-h2">How the layer is built</h2>
          <p class="ea-lead">{{ ESA_LEAD }}</p>
          <ol class="ea-steps">
            <li v-for="s in ESA_STEPS" :key="s.n" class="ea-step">
              <p class="ea-step-title"><span class="ea-step-n">{{ s.n }}</span>{{ s.title }}</p>
              <p class="ea-step-body">{{ s.body }}</p>
              <p v-if="s.note" class="ea-step-note">{{ s.note }}</p>
            </li>
          </ol>
          <h3 class="ea-h3">What it does not tell you</h3>
          <div v-for="c in ESA_CAVEATS" :key="c.title" class="ea-caveat">
            <p class="ea-step-title">{{ c.title }}</p>
            <p class="ea-step-body">{{ c.body }}</p>
          </div>
          <p class="ea-foot">
            <code>esa.additional_exceptions</code> on planningai, built by <code>07 - ESA - exceptions</code>.
            Tiles <code>{{ data?.tiles?.archive ?? '—' }}</code>, built by <code>scripts/build-esa-pmtiles.py</code>;
            rebuild both after the notebook runs.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ESA_CAVEATS, ESA_LEAD, ESA_STEPS } from '#shared/esa-method'
import type { EsaBuild, EsaItem } from '../../server/api/esa/index.get'

useHead({ title: 'Environmentally sensitive areas · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')
const { data, error } = await useFetch<EsaBuild>('/api/esa')

const TIERS = [
  { key: 'precise', label: 'Precise', note: 'drawn from a layer' },
  { key: 'advisory', label: 'Advisory', note: 'whole council area' },
] as const

/** What an item with no layer behind it is waiting on. */
const STATUS_WORD: Record<string, string> = {
  external: 'an external register, with nothing published to draw',
  derived: 'a derivation rather than a published layer',
  not_mappable: 'not mappable',
  layer_found: 'a layer that returned nothing',
}

const shown = ref(new Set(['precise', 'advisory']))
const term = ref('')
const lep = ref('')
const layerFilter = ref('')
const selected = ref<EsaItem | null>(null)
const status = ref('')
const mapEl = ref<HTMLElement | null>(null)
let map: any = null
let mapboxgl: any = null

const items = computed(() => data.value?.items ?? [])
const plans = computed(() => [...new Set(items.value.map(i => i.lepName).filter(Boolean))] as string[])
const count = (tier: string) => items.value.filter(i => i.coverageType === tier).length
const area = (tier: string) => Math.round(items.value.filter(i => i.coverageType === tier).reduce((t, i) => t + (i.areaKm2 ?? 0), 0))

/** Everything the filters leave standing - the panel list and the map filter are the same set. */
const visible = computed(() => {
  const t = term.value.trim().toLowerCase()
  return items.value.filter(i =>
    shown.value.has(i.coverageType ?? '')
    && (!lep.value || i.lepName === lep.value)
    && (!layerFilter.value || (i.sourceLayers ?? '').includes(layerFilter.value))
    && (!t || (i.exceptionText ?? '').toLowerCase().includes(t) || (i.sourceLayers ?? '').toLowerCase().includes(t)))
})

const grouped = computed(() => {
  const by = new Map<string, EsaItem[]>()
  for (const i of visible.value) {
    const key = i.lepName ?? '—'
    if (!by.has(key)) by.set(key, [])
    by.get(key)!.push(i)
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([lepName, list]) => ({ lep: lepName, items: list }))
})

const fallbacks = computed(() => items.value.filter(i => i.coverageType === 'advisory' && i.sourceLayers && !i.sourceFeatures))

const shortPlan = (name: string | null) => (name ?? '').replace(' Local Environmental Plan', ' LEP')
const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'))

function toggleTier(tier: string) {
  const next = new Set(shown.value)
  next.has(tier) ? next.delete(tier) : next.add(tier)
  shown.value = next
}

function clearFilters() {
  term.value = ''
  lep.value = ''
  layerFilter.value = ''
}

/** Select an item: the panel shows it and the map goes to it. */
function select(item: EsaItem | null) {
  selected.value = item
  if (!map || !item) {
    map?.getLayer('esa-selected') && map.setFilter('esa-selected', ['==', ['get', 'id'], -1])
    return
  }
  map.setFilter('esa-selected', ['==', ['get', 'id'], item.id])
  if (item.bbox) {
    const [w, s, e, n] = item.bbox
    map.fitBounds([[w, s], [e, n]], { padding: 60, duration: 800, maxZoom: 15 })
  }
}

/** One filter drives both fills: the map never shows what the panel has filtered out. */
function refreshMap() {
  if (!map?.getLayer('esa-fill')) return
  const ids = visible.value.map(i => i.id)
  const filter = ['in', ['get', 'id'], ['literal', ids]]
  for (const id of ['esa-fill', 'esa-line']) map.setFilter(id, filter)
}
watch(visible, refreshMap)

function addLayers() {
  const tiles = data.value?.tiles
  if (!map || !tiles) return
  map.addSource('esa', {
    type: 'vector',
    tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=esa&v=${encodeURIComponent(tiles.archive)}`],
    minzoom: tiles.minZoom,
    maxzoom: tiles.maxZoom,
  })
  const common = { source: 'esa', 'source-layer': 'esa' }
  const byTier = (precise: any, advisory: any) => ['case', ['==', ['get', 'tier'], 'precise'], precise, advisory]
  map.addLayer({
    ...common, id: 'esa-fill', type: 'fill',
    // the precise items draw over the advisory blanket they sit inside
    layout: { 'fill-sort-key': ['case', ['==', ['get', 'tier'], 'precise'], 2, 1] },
    paint: { 'fill-color': byTier('#15803d', '#d97706'), 'fill-opacity': byTier(0.35, 0.12) },
  })
  map.addLayer({
    ...common, id: 'esa-line', type: 'line',
    paint: { 'line-color': byTier('#15803d', '#b45309'), 'line-width': byTier(1.2, 1), 'line-dasharray': [3, 2] },
  })
  map.addLayer({
    ...common, id: 'esa-selected', type: 'line',
    filter: ['==', ['get', 'id'], -1],
    paint: { 'line-color': '#0f172a', 'line-width': 3 },
  })
  refreshMap()

  map.on('click', 'esa-fill', (e: any) => {
    const hit = e.features?.[0]?.properties
    if (!hit) return
    // the smallest thing under the cursor is the one meant: a precise item inside an advisory blanket
    const here = e.features.map((f: any) => items.value.find(i => i.id === f.properties.id)).filter(Boolean) as EsaItem[]
    here.sort((a, b) => (a.areaKm2 ?? 0) - (b.areaKm2 ?? 0))
    select(here[0] ?? null)
  })
  for (const ev of ['mouseenter', 'mouseleave']) {
    map.on(ev, 'esa-fill', () => { map.getCanvas().style.cursor = ev === 'mouseenter' ? 'pointer' : '' })
  }
}

onMounted(async () => {
  if (!mapboxToken || !mapEl.value) return
  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken
  map = new mapboxgl.Map({
    container: mapEl.value,
    style: 'mapbox://styles/mapbox/light-v11',
    center: [149.5, -32.8],
    zoom: 5.2,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  map.on('load', addLayers)
  map.on('dataloading', () => { status.value = 'Loading tiles…' })
  map.on('idle', () => { status.value = '' })
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (msg && !/aborted/i.test(msg)) status.value = msg.slice(0, 140)
  })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<style scoped>
.ea-page {
  height: 100vh; display: flex; flex-direction: column;
  background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
}
.ea-header {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0; flex: none;
}
.ea-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.ea-back:hover { color: #0f172a; }
.ea-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; }
.ea-header-stat { font-size: 0.8rem; color: #64748b; }
.ea-header-stat strong { color: #0f172a; font-weight: 700; }

.ea-body { flex: 1; min-height: 0; display: flex; }
.ea-panel { width: 380px; flex: none; overflow-y: auto; padding: 0.9rem 1rem 2rem; background: #fff; border-right: 1px solid #e2e8f0; }
.ea-mapwrap { position: relative; flex: 1; min-width: 0; }
.ea-map { position: absolute; inset: 0; }
.ea-guide { width: 340px; flex: none; overflow-y: auto; padding: 0.9rem 1rem 2rem; background: #fff; border-left: 1px solid #e2e8f0; }
@media (max-width: 1250px) {
  .ea-page { height: auto; min-height: 100vh; }
  .ea-body { flex-direction: column; }
  .ea-panel, .ea-guide { width: auto; border: 0; border-bottom: 1px solid #e2e8f0; }
  .ea-mapwrap { height: 70vh; flex: none; }
}

.ea-tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.7rem; }
.ea-tier { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.5rem 0.6rem; border: 1px solid #e2e8f0; border-left-width: 4px; border-radius: 10px; background: #fff; font: inherit; text-align: left; cursor: pointer; }
.ea-tier--precise { border-left-color: #15803d; }
.ea-tier--advisory { border-left-color: #d97706; }
.ea-tier--off { opacity: 0.45; }
.ea-tier-name { font-size: 0.86rem; font-weight: 800; color: #0f172a; }
.ea-tier-n { font-size: 1.1rem; font-weight: 800; color: #0f172a; }
.ea-tier-note { font-size: 0.7rem; color: #64748b; }

.ea-filters { display: flex; gap: 0.4rem; margin-bottom: 0.4rem; }
.ea-input, .ea-select { flex: 1; min-width: 0; padding: 0.35rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.82rem; }
.ea-clear { padding: 0.35rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.78rem; cursor: pointer; }
.ea-count { margin: 0 0 0.8rem; font-size: 0.78rem; color: #475569; }

.ea-card { margin-bottom: 0.9rem; padding: 0.7rem 0.8rem; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; }
.ea-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.ea-card-title { margin: 0 0 0.2rem; font-size: 0.92rem; font-weight: 800; color: #0f172a; }
.ea-x { border: 0; background: none; font: inherit; font-size: 1.1rem; line-height: 1; color: #64748b; cursor: pointer; }
.ea-card-text { margin: 0 0 0.35rem; font-size: 0.86rem; color: #334155; }
.ea-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem 0.5rem; margin: 0.2rem 0 0; font-size: 0.76rem; color: #475569; }

.ea-group { margin-top: 1.4rem; }
.ea-h2 { margin: 0 0 0.2rem; font-size: 1rem; font-weight: 800; color: #0f172a; }
.ea-h3 { margin: 1.2rem 0 0.4rem; font-size: 0.92rem; font-weight: 800; color: #0f172a; }
.ea-lead { margin: 0 0 0.6rem; font-size: 0.8rem; line-height: 1.5; color: #475569; }
.ea-plan { border-bottom: 1px solid #f1f5f9; }
.ea-plan-sum { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0; font-size: 0.84rem; font-weight: 700; color: #0f172a; cursor: pointer; list-style: none; }
.ea-plan-sum::-webkit-details-marker { display: none; }
.ea-plan-n { font-size: 0.72rem; font-weight: 600; color: #94a3b8; }
.ea-items { list-style: none; margin: 0 0 0.4rem; padding: 0; }
.ea-item { display: flex; align-items: baseline; gap: 0.4rem; width: 100%; padding: 0.25rem 0.4rem; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 0.78rem; text-align: left; color: #334155; cursor: pointer; }
.ea-item:hover { background: #f1f5f9; }
.ea-item--on { background: #e2e8f0; }
.ea-item-text { flex: 1; min-width: 0; }
.ea-item-ref { flex: none; }

.ea-layers { list-style: none; margin: 0; padding: 0; }
.ea-layers li { padding: 0.25rem 0; border-bottom: 1px solid #f8fafc; }
.ea-layer { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; width: 100%; padding: 0.15rem 0.3rem; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 0.8rem; text-align: left; color: #0f172a; cursor: pointer; }
.ea-layer:hover:not(:disabled) { background: #f1f5f9; }
.ea-layer--on { background: #0f172a; color: #fff; }
.ea-layer:disabled { color: #64748b; cursor: default; }
.ea-layer-n { flex: none; font-size: 0.72rem; color: inherit; opacity: 0.7; }
.ea-layer-src { display: block; padding-left: 0.3rem; font-size: 0.68rem; color: #94a3b8; text-decoration: none; }
.ea-layer-src:hover { color: #2a78d6; }

.ea-checks { margin: 0; padding-left: 1rem; display: grid; gap: 0.45rem; }
.ea-checks li { font-size: 0.8rem; line-height: 1.5; color: #334155; }
.ea-note { margin: 0.8rem 0 0; padding: 0.55rem 0.7rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.74rem; color: #475569; }
.ea-link { padding: 0 0.15rem; border: 0; background: none; font: inherit; font-size: 0.78rem; color: #2a78d6; cursor: pointer; }
.ea-link:hover { text-decoration: underline; }

.ea-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.8rem; }
.ea-step { padding-bottom: 0.8rem; border-bottom: 1px solid #f1f5f9; }
.ea-step:last-child { border-bottom: 0; padding-bottom: 0; }
.ea-step-title { display: flex; align-items: baseline; gap: 0.45rem; margin: 0 0 0.2rem; font-size: 0.88rem; font-weight: 700; color: #0f172a; }
.ea-step-n { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; flex: none; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.72rem; }
.ea-step-body { margin: 0; font-size: 0.8rem; line-height: 1.55; color: #334155; }
.ea-step-note { margin: 0.4rem 0 0; padding-left: 0.5rem; border-left: 2px solid #cbd5e1; font-size: 0.76rem; line-height: 1.5; color: #57534e; }
.ea-caveat { margin-bottom: 0.7rem; }
.ea-foot { margin: 1rem 0 0; font-size: 0.72rem; line-height: 1.5; color: #64748b; }

.ea-pill { display: inline-block; padding: 0.05em 0.45em; border-radius: 999px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.ea-pill--precise { background: #dcfce7; color: #15803d; }
.ea-pill--advisory { background: #fef3c7; color: #b45309; }
.ea-pill--base { margin-left: 0.3rem; background: #e0e7ff; color: #4338ca; }
.ea-dim { color: #94a3b8; }
.ea-warn { color: #b45309; }
.ea-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.ea-error { margin: 0 0 1rem; padding: 0.6rem 0.8rem; border-left: 3px solid #dc2626; background: #fef2f2; color: #991b1b; font-size: 0.84rem; }
.ea-over { position: absolute; top: 0.75rem; left: 0.75rem; right: 0.75rem; z-index: 2; }
.ea-status { position: absolute; bottom: 0.75rem; left: 50%; transform: translateX(-50%); margin: 0; padding: 0.25rem 0.7rem; background: rgba(15, 23, 42, 0.8); color: #fff; border-radius: 999px; font-size: 0.75rem; }
.ea-legend { position: absolute; top: 0.75rem; left: 0.75rem; display: flex; flex-direction: column; gap: 0.2rem; padding: 0.45rem 0.6rem; background: rgba(255, 255, 255, 0.92); border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.72rem; color: #475569; }
.ea-legend span { display: flex; align-items: center; gap: 0.35rem; }
.ea-key { width: 12px; height: 12px; border-radius: 2px; }
.ea-key--precise { background: rgba(21, 128, 61, 0.35); border: 1px solid #15803d; }
.ea-key--advisory { background: rgba(217, 119, 6, 0.12); border: 1px dashed #b45309; }
</style>
