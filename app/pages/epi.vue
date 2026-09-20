<!--
  /epi - every layer of the EPI schema on one map.

  The schema is the whole planning-instrument map library: 56 tables, ~934,000 polygons, rewritten each
  time 01A runs. Three columns: search and the layer switches on the left, the map in the middle, and on
  the right everything the schema says about the last point clicked.

  The click answer does NOT come from the tiles. It is a PostGIS point query across all 56 tables
  (/api/epi/at), which takes about 200 ms and returns the real polygon rather than a simplified,
  zoom-dependent copy of it. So a layer that is switched off still answers, and an answer near a boundary
  is right rather than nearly right.

  Tiles: epi-<group>.pmtiles on the planningai host, built in six groups by scripts/build-epi-pmtiles.py
  and driven by the notebook "01A-pmtiles-epi". One MVT layer "epi" in every archive, so one style serves
  them all; the page shows and hides tables with a filter on layer_key.

  Search is the same lot and address combobox as /lmr and /testing-spatial-services, over
  derived.lot_address through /api/lotprofile, with Mapbox kept as the Enter fallback for a place name.
-->

<template>
  <div class="ep-page">
    <header class="ep-header">
      <div>
        <NuxtLink to="/" class="ep-back">&larr; Home</NuxtLink>
        <h1 class="ep-title">EPI layers — the planning instrument maps</h1>
      </div>
      <div v-if="data?.ok" class="ep-header-stat">
        <strong>{{ fmt(data.summary.tables) }}</strong> layers ·
        <strong>{{ fmt(data.summary.rows) }}</strong> polygons ·
        <strong>{{ data.summary.drawn }}</strong> on the map
      </div>
    </header>

    <div class="ep-body">
      <!-- ── search and the layer switches ───────────────────────────────── -->
      <aside class="ep-panel">
        <div class="ep-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
          <label class="ep-sr" for="ep-q">Address, lot reference or place</label>
          <input
            id="ep-q" v-model="q" type="search" class="ep-input" role="combobox"
            placeholder="An address, a lot &mdash; A//DP71490 &mdash; or a place"
            autocomplete="off" spellcheck="false"
            :aria-expanded="listOpen && results.length > 0" aria-controls="ep-listbox"
            @input="onType" @focus="listOpen = results.length > 0"
            @keydown.enter.prevent="pickHighlighted"
          >
          <span v-if="searching" class="ep-combo-busy">searching&hellip;</span>
          <ul v-if="listOpen && results.length" id="ep-listbox" class="ep-listbox" role="listbox">
            <li class="ep-listbox-head">
              {{ results.length }}{{ results.length === 25 ? '+' : '' }}
              {{ results.length === 1 ? 'match' : 'matches' }}
              <span class="ep-dim">&middot; &uarr;&darr; then Enter, or click</span>
            </li>
            <li
              v-for="(r, i) in results" :id="`ep-opt-${i}`" :key="`${r.cadid}-${r.msoid}`"
              role="option" :aria-selected="i === highlight"
              class="ep-option" :class="{ 'ep-option--on': i === highlight }"
              @mousedown.prevent="pickLot(r)" @mousemove="highlight = i"
            >
              <span class="ep-option-addr">{{ r.address || '(no address)' }}</span>
              <span class="ep-option-meta"><code>{{ r.titleLot || r.lotId || '&mdash;' }}</code><span class="ep-dim">{{ r.lgaName || '' }}</span></span>
            </li>
          </ul>
        </div>
        <p v-if="searchMsg" class="ep-note">{{ searchMsg }}</p>
        <p v-else-if="searchHint" class="ep-dim ep-hint">{{ searchHint }}</p>
        <p v-else class="ep-dim ep-hint">Or click anywhere on the map to read every layer under that point.</p>

        <p v-if="error" class="ep-error">Could not load the catalogue: {{ error }}</p>
        <p v-else-if="data && !data.ok" class="ep-error">{{ data.reason }}</p>
        <p v-else-if="data?.reason" class="ep-warnbox">{{ data.reason }}</p>

        <div class="ep-tabs">
          <button
            type="button" class="ep-tab" :class="{ 'ep-tab--on': tab === 'layers' }"
            @click="tab = 'layers'"
          >Our layers <span class="ep-tab-n">{{ data?.summary.tables ?? '' }}</span></button>
          <button
            type="button" class="ep-tab" :class="{ 'ep-tab--on': tab === 'live' }"
            @click="tab = 'live'"
          >Live check <span v-if="isectHits.length" class="ep-tab-n">{{ isectHits.length }}</span></button>
        </div>

        <!-- ══ the live services, one lot at a time ════════════════════════ -->
        <template v-if="tab === 'live'">
          <p class="ep-lead">
            This lot against all {{ MAP_SERVICES.length }} live NSW services, a true polygon intersect
            against the same shrunk lot the layer list is read with. {{ LIVE_FROM_EPI }} of them are the
            live version of layers already in the list, so a difference there means our copy has aged.
          </p>

          <p v-if="!at?.lot?.cadid" class="ep-warnbox">
            Pick a lot first: search an address above, or click one on the map.
          </p>
          <template v-else>
            <p class="ep-at-lot"><code>{{ at.lot.lotId }}</code><span class="ep-dim">{{ at.lot.lga || '' }}</span></p>

            <div class="ep-allrow">
              <button v-if="!isectRunning" type="button" class="ep-all ep-all--go" @click="runIntersect">
                {{ isectDone ? 'Run again' : 'Run live check' }}
              </button>
              <button v-else type="button" class="ep-all" @click="stopIntersect">Stop</button>
              <span v-if="isectRunning || isectDone" class="ep-dim">
                {{ isectChecked }}/{{ MAP_SERVICES.length }} ·
                {{ isectHits.length }} hit{{ isectHits.length === 1 ? '' : 's' }}
                <template v-if="isectFailed.length"> · {{ isectFailed.length }} failed</template>
              </span>
            </div>
            <div v-if="isectRunning" class="ep-bar">
              <i :style="{ width: (100 * isectChecked / MAP_SERVICES.length).toFixed(1) + '%' }" />
            </div>

            <p v-if="isectDone && !isectHits.length" class="ep-lead">
              Nothing intersects this lot across {{ isectChecked }} services.
            </p>

            <section v-for="grp in isectGrouped" :key="grp.section" class="ep-group">
              <h2 class="ep-h2">{{ grp.section }}<span class="ep-g-n">{{ grp.layers.length }}</span></h2>
              <details v-for="hit in grp.layers" :key="hit.id" class="ep-isect" :open="isectOpen[hit.id]">
                <summary class="ep-isect-head" @click.prevent="isectOpen[hit.id] = !isectOpen[hit.id]">
                  <span class="ep-dot" :style="{ background: liveColour(hit.id) }" />
                  <span class="ep-isect-name">{{ hit.name }}</span>
                  <span class="ep-dim">{{ hit.count }}<template v-if="hit.truncated">+</template></span>
                  <button
                    type="button" class="ep-eye"
                    :class="{ 'ep-eye--on': !!liveState[hit.id] && !liveState[hit.id].error,
                              'ep-eye--busy': liveState[hit.id]?.loading }"
                    :title="liveState[hit.id] ? 'Hide on the map'
                      : (zoom < LIVE_MIN_ZOOM ? `Zoom to z${LIVE_MIN_ZOOM} or closer to draw this` : 'Draw this layer')"
                    @click.stop.prevent="toggleLiveLayer(hit)"
                  >
                    <svg v-if="liveState[hit.id] && !liveState[hit.id].error" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/></svg>
                  </button>
                </summary>
                <p v-if="liveState[hit.id]?.error" class="ep-eye-note ep-eye-note--bad">
                  Could not draw: {{ liveState[hit.id].error }}
                </p>
                <p v-else-if="liveState[hit.id] && !liveState[hit.id].loading && liveState[hit.id].count === 0" class="ep-eye-note">
                  Nothing drawn in this view. The intersect ran against the lot, while this draws what is
                  on screen, so move back over the lot.
                </p>
                <div v-for="(f, i) in hit.features" :key="i" class="ep-isect-rec">
                  <p v-for="(v, k) in f" :key="k" class="ep-isect-kv">
                    <span class="ep-isect-k">{{ k }}</span>
                    <span class="ep-isect-v">{{ fmtIsect(k, v) }}</span>
                  </p>
                </div>
              </details>
            </section>

            <section v-if="isectFailed.length" class="ep-group">
              <h2 class="ep-h2">
                Could not be searched<span class="ep-g-n">{{ isectFailed.length }}</span>
              </h2>
              <p class="ep-lead">
                These services did not answer, so this lot is neither in nor out of them.
              </p>
              <ul class="ep-fail">
                <li v-for="f in isectFailed" :key="f.id">
                  <b>{{ f.name || f.id }}</b>
                  <span class="ep-dim">{{ f.message || f.reason }}</span>
                </li>
              </ul>
              <button
                v-if="isectUnsearched.length && !isectRunning" type="button" class="ep-all"
                @click="retryFailed"
              >Retry the {{ isectUnsearched.length }} that might answer</button>
            </section>
          </template>
        </template>

        <template v-else-if="data?.ok">
          <div class="ep-allrow">
            <button type="button" class="ep-all" @click="setAll(false)">Turn all off</button>
            <button
              type="button" class="ep-all" :class="{ 'ep-all--on': !fillsOn }"
              title="Several layers blanket a whole council; outlines stay readable when fills do not"
              @click="setFills(!fillsOn)"
            >{{ fillsOn ? 'Outlines only' : 'Fills on' }}</button>
            <span class="ep-dim">{{ onCount }} on</span>
          </div>
          <div class="ep-allrow">
            <input v-model="filter" type="search" class="ep-filter" placeholder="Filter layers&hellip;">
          </div>

          <section v-for="g in groups" :key="g.key" class="ep-group">
            <h2 class="ep-h2">
              <i class="ep-key" :style="{ background: fillOf(g.key), borderColor: lineOf(g.key) }" />
              {{ g.label }}
              <span class="ep-g-n">{{ g.layers.length }}</span>
            </h2>
            <ul class="ep-list">
              <li v-for="l in g.layers" :key="l.key" class="ep-item">
                <label class="ep-row" :class="{ 'ep-row--dead': !l.drawn }">
                  <input
                    type="checkbox" :checked="shown.has(l.key) && l.drawn" :disabled="!l.drawn"
                    @change="toggle(l.key)"
                  >
                  <span class="ep-swatch" :style="{ background: fillOf(g.key), borderColor: lineOf(g.key) }" />
                  <span class="ep-name">{{ l.title }}</span>
                  <span class="ep-count">{{ fmt(l.rows) }}</span>
                </label>
                <p v-if="l.description" class="ep-blurb">{{ l.description }}</p>
                <p class="ep-meta">
                  <code>{{ l.table }}</code>
                  <template v-if="l.plans"> · {{ l.plans }} {{ l.plans === 1 ? 'plan' : 'plans' }}</template>
                  <template v-if="l.minZoom"> · from zoom {{ l.minZoom }}</template>
                  <template v-if="!l.drawn"> · {{ l.rows ? 'not tiled yet' : 'no rows in this load' }}</template>
                  <button
                    v-if="l.categories.length || l.maps.length" type="button" class="ep-link"
                    @click="expand(l.key)"
                  >{{ open.has(l.key) ? 'less' : 'more' }}</button>
                </p>
                <div v-if="open.has(l.key)" class="ep-more">
                  <template v-if="l.maps.length">
                    <p class="ep-more-head">Published as</p>
                    <ul class="ep-cats">
                      <li v-for="m in l.maps" :key="m.name">{{ m.name }} <span class="ep-dim">{{ fmt(m.features) }}</span></li>
                    </ul>
                  </template>
                  <template v-if="l.categories.length">
                    <p class="ep-more-head">Classes in this layer</p>
                    <ul class="ep-cats">
                      <li v-for="c in l.categories.slice(0, 18)" :key="c.name">{{ c.name }} <span class="ep-dim">{{ fmt(c.features) }}</span></li>
                    </ul>
                    <p v-if="l.categories.length > 18" class="ep-dim ep-more-tail">and {{ l.categories.length - 18 }} more</p>
                  </template>
                </div>
              </li>
            </ul>
          </section>
        </template>
      </aside>

      <!-- ── the map ─────────────────────────────────────────────────────── -->
      <div class="ep-mapwrap">
        <div ref="mapEl" class="ep-map" />
        <p v-if="!mapboxToken" class="ep-over ep-error">No Mapbox token: set NUXT_PUBLIC_MAPBOX_TOKEN in .env and restart the dev server.</p>
        <p v-if="status" class="ep-status">{{ status }}</p>
        <p v-if="tooFarOut.length" class="ep-zoomhint">
          Zoom in to draw {{ tooFarOut.map(pretty).join(', ') }}
        </p>
        <div v-if="legend.length" class="ep-legend">
          <span v-for="g in legend" :key="g.key">
            <i class="ep-key" :style="{ background: fillOf(g.key), borderColor: lineOf(g.key) }" />{{ g.label }}
          </span>
        </div>
      </div>

      <!-- ── what is at the clicked point ────────────────────────────────── -->
      <aside class="ep-result">
        <div class="ep-result-inner">
          <h2 class="ep-h2">What is here</h2>
          <p v-if="!at && !atBusy" class="ep-lead">
            Click the map, or search an address. Every layer of the schema is read at that point, whether
            or not it is switched on, straight from the database rather than from the tiles.
          </p>
          <p v-if="atBusy" class="ep-lead">Reading {{ data?.summary.tables ?? '' }} layers&hellip;</p>
          <p v-if="atError" class="ep-error">{{ atError }}</p>

          <template v-if="at">
            <div class="ep-at-head">
              <p class="ep-at-lot">
                <template v-if="at.lot?.lotId"><code>{{ at.lot.lotId }}</code></template>
                <template v-else>No lot here</template>
                <span v-if="at.lot?.lga" class="ep-dim">{{ at.lot.lga }}</span>
              </p>
              <p class="ep-dim ep-at-meta">
                <template v-if="at.basis === 'lot'">
                  whole lot<template v-if="at.lot?.areaM2">, {{ fmt(at.lot.areaM2) }} m²</template>
                </template>
                <template v-else>no lot here, so this point only</template>
                ·
                {{ at.hits.length }} {{ at.hits.length === 1 ? 'row' : 'rows' }} in
                {{ at.layers }} {{ at.layers === 1 ? 'layer' : 'layers' }} · {{ at.ms }} ms
              </p>
            </div>

            <p v-if="!at.hits.length" class="ep-lead">
              No EPI layer covers this. That usually means it is outside every plan in this load,
              such as out at sea.
            </p>

            <section v-for="h in hitsByLayer" :key="h.layer" class="ep-hit">
              <h3 class="ep-hit-title">
                <button type="button" class="ep-hit-toggle" :class="{ 'ep-hit-toggle--on': shown.has(h.layer) }"
                        :disabled="!drawable.has(h.layer)" :title="drawable.has(h.layer) ? 'Show this layer' : 'Not tiled'"
                        @click="toggle(h.layer)">{{ pretty(h.layer) }}</button>
                <span class="ep-hit-n">{{ h.rows.length }}</span>
              </h3>
              <ul class="ep-hit-rows">
                <li v-for="(r, i) in h.rows" :key="i" class="ep-hit-row">
                  <p class="ep-hit-value">
                    <b>{{ r.label || r.layClass || r.layName || '(no label)' }}</b>
                    <span v-if="r.symCode && r.symCode !== r.label" class="ep-chip">{{ r.symCode }}</span>
                    <span
                      v-if="r.coverPct != null" class="ep-cover"
                      :class="{ 'ep-cover--part': r.coverPct < 99 }"
                      :title="`${coverWord(r.coverPct)} of the lot`"
                    >{{ coverWord(r.coverPct) }}</span>
                  </p>
                  <p class="ep-hit-meta">
                    <span v-if="r.epiName">{{ shortPlan(r.epiName) }}</span>
                    <span v-if="r.clause" class="ep-dim">{{ r.clause }}</span>
                  </p>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { epiTitle } from '#shared/epi-layers'
import { MAP_SECTIONS, MAP_SERVICES } from '#shared/nsw-map-services'
import type { EpiLayersResponse } from '../../server/api/epi/layers.get'
import type { EpiAtResponse } from '../../server/api/epi/at.get'

useHead({ title: 'EPI layers · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')
const { data, error } = await useFetch<EpiLayersResponse>('/api/epi/layers')

interface LotMatch {
  cadid: string
  msoid: number | null
  address: string | null
  lotId: string | null
  titleLot: string | null
  lgaName: string | null
}

/** One colour per group. Six colours read; fifty-six do not. */
const GROUP_COLOUR: Record<string, string> = {
  principal: '#2563eb',
  application: '#64748b',
  biodiversity: '#15803d',
  resources: '#a16207',
  hazard: '#dc2626',
  development: '#7c3aed',
  unbuilt: '#94a3b8',
}
const lineOf = (g: string) => GROUP_COLOUR[g] ?? GROUP_COLOUR.unbuilt!
const fillOf = (g: string) => `${lineOf(g)}4d`

/** The layer that is worth seeing before anything is chosen. */
const DEFAULT_ON = ['epi_land_zoning']

const FILL_OPACITY = 0.12

/** Which half of the left panel is showing: our own layers, or the live services. */
const tab = ref<'layers' | 'live'>('layers')

/** How many of the live services are the same ePlanning layers the epi schema is loaded from. */
const LIVE_FROM_EPI = MAP_SERVICES.filter(s =>
  s.url.includes('ePlanning/Planning_Portal') || s.url.includes('Planning/Protection')
  || s.url.includes('Planning/EPI')).length

const shown = ref(new Set<string>(DEFAULT_ON))
const fillsOn = ref(true)
const filter = ref('')
/** Which layers have their detail open. */
const open = ref(new Set<string>())
const expand = (key: string) => {
  const next = new Set(open.value)
  next.has(key) ? next.delete(key) : next.add(key)
  open.value = next
}
const status = ref('')
const zoom = ref(5.2)
const mapEl = ref<HTMLElement | null>(null)
let map: any = null
let mapboxgl: any = null

const layers = computed(() => data.value?.layers ?? [])
const drawable = computed(() => new Set(layers.value.filter(l => l.drawn).map(l => l.key)))

const groups = computed(() => {
  const term = filter.value.trim().toLowerCase()
  const order = data.value?.groupOrder ?? []
  const labels = new Map((data.value?.groups ?? []).map(g => [g.key, g.label]))
  const by = new Map<string, typeof layers.value>()
  for (const l of layers.value) {
    const haystack = `${l.title} ${l.key} ${l.description ?? ''}`.toLowerCase()
    if (term && !haystack.includes(term)) continue
    const key = l.group
    if (!by.has(key)) by.set(key, [])
    by.get(key)!.push(l)
  }
  const rank = (k: string) => { const i = order.indexOf(k as any); return i === -1 ? 99 : i }
  return [...by]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([key, list]) => ({
      key,
      label: labels.get(key) ?? (key === 'unbuilt' ? 'Not tiled yet' : key),
      layers: list.sort((a, b) => b.rows - a.rows),
    }))
})

/** Only a layer that has tiles counts as on; the default can name one before a build exists. */
const onCount = computed(() => [...shown.value].filter(k => drawable.value.has(k)).length)

const legend = computed(() =>
  groups.value.filter(g => g.layers.some(l => shown.value.has(l.key) && l.drawn))
    .map(g => ({ key: g.key, label: g.label })))

/** Layers that are on but whose tiles do not start until further in. */
const tooFarOut = computed(() =>
  layers.value.filter(l => shown.value.has(l.key) && (l.minZoom ?? 0) > zoom.value).map(l => l.key))

const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'))
const shortPlan = (name: string | null) => (name ?? '').replace(' Local Environmental Plan', ' LEP')

/** How much of the lot a row covers. "all" is the common case and does not need a number. */
function coverWord(pct: number): string {
  if (pct >= 99.5) return 'all'
  if (pct < 0.5) return '<1%'
  return `${Math.round(pct)}%`
}
/** The published map name for a table, for the click panel and the zoom hint. */
const pretty = (key: string) => epiTitle(key)

function toggle(key: string) {
  if (!drawable.value.has(key)) return
  const next = new Set(shown.value)
  next.has(key) ? next.delete(key) : next.add(key)
  shown.value = next
  refresh()
}

function setAll(on: boolean) {
  shown.value = on ? new Set(drawable.value) : new Set()
  refresh()
}

/** Every group's pair of map layers reads the same shown set; a group draws only its own members. */
function refresh() {
  if (!map) return
  for (const g of data.value?.groups ?? []) {
    const keys = layers.value.filter(l => l.group === g.key && shown.value.has(l.key)).map(l => l.key)
    const f = ['in', ['get', 'layer_key'], ['literal', keys]]
    for (const id of [`epi-${g.key}-fill`, `epi-${g.key}-line`]) {
      if (map.getLayer(id)) map.setFilter(id, f)
    }
  }
}

// ── the click answer ─────────────────────────────────────────────────────────
const at = ref<EpiAtResponse | null>(null)
const atBusy = ref(false)
const atError = ref('')
let atInflight: AbortController | null = null

const hitsByLayer = computed(() => {
  const by = new Map<string, EpiAtResponse['hits']>()
  for (const h of at.value?.hits ?? []) {
    if (!by.has(h.layer)) by.set(h.layer, [])
    by.get(h.layer)!.push(h)
  }
  return [...by].map(([layer, rows]) => ({ layer, rows }))
})

const MARK = 'epi-click'

/**
 * Read every layer for a lot. The server tests the lot polygon, so the answer covers the whole parcel
 * rather than whatever sits under one point; it falls back to the point only where no lot exists.
 */
async function pick(opts: { lon?: number; lat?: number; cadid?: string }) {
  atError.value = ''
  atBusy.value = true
  if (opts.lon != null && opts.lat != null) showMark(opts.lon, opts.lat)
  atInflight?.abort()
  const ctrl = new AbortController()
  atInflight = ctrl
  try {
    const r = await $fetch<EpiAtResponse>('/api/epi/at', { query: opts, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    at.value = r
    // outline exactly what was tested, so a click makes the parcel it answered for obvious
    if (r.lotGeom) showLot(r.lotGeom)
    else clearLot()
  } catch (e: any) {
    if (ctrl.signal.aborted) return
    atError.value = e?.data?.message || e?.message || 'Could not read that point.'
  } finally {
    if (atInflight === ctrl) { atBusy.value = false; atInflight = null }
  }
}

function showMark(lon: number, lat: number) {
  if (!map) return
  const data_ = { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [lon, lat] } }
  const src = map.getSource(MARK)
  if (src) { src.setData(data_); return }
  map.addSource(MARK, { type: 'geojson', data: data_ })
  map.addLayer({
    id: 'epi-click-dot', type: 'circle', source: MARK,
    paint: { 'circle-radius': 6, 'circle-color': '#0f172a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
  })
}

/* ── the live services, one lot against all of them ─────────────────────────
 *
 * Deliberately a button, not something that happens on a click. The local answer is a single database
 * query and lands in about a quarter of a second; this is 134 requests to eight different agencies, so
 * it runs a few at a time with a progress bar and fills results in as they land. One dead service costs
 * one row rather than the whole answer, which is why the failures are listed rather than hidden: a
 * service that did not answer leaves the lot neither in nor out of it, and that is not the same as a miss.
 */
const ISECT_CONCURRENCY = 6
const isectHits = ref<any[]>([])
const isectFailed = ref<any[]>([])
const isectRunning = ref(false)
const isectDone = ref(false)
const isectChecked = ref(0)
const isectOpen = ref<Record<string, boolean>>({})
let isectAbort = false

/** Grouped the way the service catalogue is, so the result reads like the layer list it mirrors. */
const isectGrouped = computed(() => {
  const out: { section: string; layers: any[] }[] = []
  for (const sec of MAP_SECTIONS) {
    const layers = isectHits.value.filter(h => h.section === sec)
    if (layers.length) out.push({ section: sec, layers })
  }
  return out
})

/** A 403 or a refused query cannot be fixed by asking again; a timeout can. */
const isectUnsearched = computed(() => isectFailed.value.filter(f => f.retryable !== false))

/** Several of these layers carry epoch-millisecond dates, which raw are unreadable. */
function fmtIsect(key: string | number, v: any) {
  if (typeof v === 'number' && /date$/i.test(String(key)) && v > 1e11) {
    return new Date(v).toISOString().slice(0, 10)
  }
  return String(v)
}

function stopIntersect() {
  isectAbort = true
  isectRunning.value = false
}

async function runPool(services: any[], cadid: string) {
  const queue = [...services]
  async function worker() {
    while (queue.length && !isectAbort) {
      const svc = queue.shift()!
      try {
        const r: any = await $fetch('/api/lot-intersect', { query: { cadid, id: svc.id } })
        if (r?.ok && r.count > 0) isectHits.value = [...isectHits.value, r]
        else if (r && !r.ok) isectFailed.value = [...isectFailed.value, r]
      } catch (e: any) {
        isectFailed.value = [...isectFailed.value, {
          id: svc.id, name: svc.name, reason: 'error', message: String(e?.message ?? e).slice(0, 80) }]
      }
      isectChecked.value++
    }
  }
  await Promise.all(Array.from({ length: ISECT_CONCURRENCY }, worker))
}

async function runIntersect() {
  const cadid = at.value?.lot?.cadid
  if (!cadid || isectRunning.value) return
  isectAbort = false
  isectRunning.value = true
  isectDone.value = false
  isectChecked.value = 0
  isectHits.value = []
  isectFailed.value = []
  isectOpen.value = {}
  await runPool(MAP_SERVICES as any[], cadid)
  isectRunning.value = false
  isectDone.value = !isectAbort
}

/** Ask again only the services that could plausibly answer this time. */
async function retryFailed() {
  const cadid = at.value?.lot?.cadid
  const again = isectUnsearched.value
    .map(f => MAP_SERVICES.find(s => s.id === f.id))
    .filter(Boolean) as any[]
  if (!cadid || !again.length || isectRunning.value) return
  isectAbort = false
  isectRunning.value = true
  isectChecked.value = MAP_SERVICES.length - again.length
  isectFailed.value = isectFailed.value.filter(f => f.retryable === false)
  await runPool(again, cadid)
  isectRunning.value = false
}

/** A new lot makes the last live result meaningless, so it is cleared rather than left to mislead. */
watch(() => at.value?.lot?.cadid, () => {
  stopIntersect()
  isectHits.value = []
  isectFailed.value = []
  isectDone.value = false
  isectChecked.value = 0
  for (const id of Object.keys(liveState.value)) removeLiveLayer(id)
  liveState.value = {}
  liveSeen.clear()
})

/* ── drawing a live service on the map ──────────────────────────────────────
 *
 * The same two-step /frontage uses, and the same caveat. The intersect ran against the lot polygon;
 * this asks the service for whatever is in the current view, because these are statewide layers and
 * nobody wants all of one. So a hit can legitimately draw nothing once the map has moved off the lot,
 * and the panel says that rather than looking broken. Below LIVE_MIN_ZOOM nothing is fetched at all.
 */
const LIVE_MIN_ZOOM = 12
const LIVE_COLOURS = ['#0891b2', '#c026d3', '#ea580c', '#16a34a', '#4f46e5',
                      '#db2777', '#65a30d', '#0284c7', '#9333ea', '#dc2626']
const liveState = ref<Record<string, any>>({})
const liveSeen = new Map<string, { id: string; name: string }>()

function liveColour(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return LIVE_COLOURS[h % LIVE_COLOURS.length]!
}

const liveSrc = (id: string) => `live-${id}`

function removeLiveLayer(id: string) {
  if (!map) return
  for (const suffix of ['-fill', '-line', '-point']) {
    const lid = liveSrc(id) + suffix
    if (map.getLayer(lid)) map.removeLayer(lid)
  }
  if (map.getSource(liveSrc(id))) map.removeSource(liveSrc(id))
}

/** One source, three layers: a collection can mix polygons, lines and points. */
function drawLiveLayer(id: string, geojson: any) {
  if (!map?.isStyleLoaded()) return
  removeLiveLayer(id)
  const colour = liveColour(id)
  const src = liveSrc(id)
  map.addSource(src, { type: 'geojson', data: geojson })
  map.addLayer({
    id: `${src}-fill`, type: 'fill', source: src,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': colour, 'fill-opacity': 0.18 },
  })
  map.addLayer({
    id: `${src}-line`, type: 'line', source: src,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]],
    paint: { 'line-color': colour, 'line-width': 1.6, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: `${src}-point`, type: 'circle', source: src,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 4, 'circle-color': colour, 'circle-opacity': 0.9 },
  })
}

async function fetchLiveLayer(svc: { id: string; name: string }) {
  if (!map) return
  if (map.getZoom() < LIVE_MIN_ZOOM) {
    liveState.value = { ...liveState.value, [svc.id]: { loading: false, count: 0, error: null } }
    return
  }
  const b = map.getBounds()
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(n => n.toFixed(5)).join(',')
  liveSeen.set(svc.id, svc)
  liveState.value = { ...liveState.value, [svc.id]: { ...(liveState.value[svc.id] ?? {}), loading: true, error: null } }
  try {
    const res: any = await $fetch('/api/map-layer', { query: { id: svc.id, bbox } })
    if (res?.ok) {
      liveState.value = { ...liveState.value, [svc.id]: { loading: false, error: null, count: res.count, truncated: res.truncated } }
      drawLiveLayer(svc.id, res.geojson)
    } else {
      liveState.value = { ...liveState.value, [svc.id]: { loading: false, error: res?.message ?? 'failed', count: 0 } }
      removeLiveLayer(svc.id)
    }
  } catch (e: any) {
    liveState.value = { ...liveState.value, [svc.id]: { loading: false, error: String(e?.message ?? e).slice(0, 90), count: 0 } }
    removeLiveLayer(svc.id)
  }
}

function toggleLiveLayer(hit: { id: string; name: string }) {
  if (liveState.value[hit.id]) {
    const next = { ...liveState.value }
    delete next[hit.id]
    liveState.value = next
    liveSeen.delete(hit.id)
    removeLiveLayer(hit.id)
  } else {
    fetchLiveLayer({ id: hit.id, name: hit.name })
  }
}

/** Whatever is switched on follows the map, because the request is bounded by the view. */
let liveMoveTimer: any = null
function onLiveSettled() {
  clearTimeout(liveMoveTimer)
  liveMoveTimer = setTimeout(() => {
    for (const id of Object.keys(liveState.value)) {
      const svc = liveSeen.get(id)
      if (svc) fetchLiveLayer(svc)
    }
  }, 400)
}

// ── the lot and address search, as on /lmr ───────────────────────────────────
const q = ref('')
const results = ref<LotMatch[]>([])
const searching = ref(false)
const searchMsg = ref('')
const searchHint = ref('')
const listOpen = ref(false)
const highlight = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

const ROAD_TYPES: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', DRV: 'DRIVE', PDE: 'PARADE',
  CRES: 'CRESCENT', CR: 'CRESCENT', PL: 'PLACE', HWY: 'HIGHWAY', CCT: 'CIRCUIT', CL: 'CLOSE',
  CT: 'COURT', TCE: 'TERRACE', LN: 'LANE', BVD: 'BOULEVARD', BLVD: 'BOULEVARD', GR: 'GROVE',
  ESP: 'ESPLANADE', WY: 'WAY', SQ: 'SQUARE', PKWY: 'PARKWAY', MWY: 'MOTORWAY', FWY: 'FREEWAY',
  CIR: 'CIRCLE', GDNS: 'GARDENS', RES: 'RESERVE', TRL: 'TRAIL',
}
const ROAD_WORDS = new Set(Object.values(ROAD_TYPES))

/** Mirrors the server's rule, so a query it would refuse never leaves the browser. */
function searchable(term: string): boolean {
  if (/\b(?:D|S|C)P\s*\d+/i.test(term) || term.includes('//')) return true
  return term.split(/\s+/).map(w => ROAD_TYPES[w.toUpperCase()] ?? w)
    .some(w => w.length >= 3 && !ROAD_WORDS.has(w.toUpperCase()) && !/^\d+[a-z]?$/i.test(w))
}

async function runSearch() {
  const term = q.value.trim()
  searchMsg.value = ''
  if (term.length < 2) { results.value = []; listOpen.value = false; searchHint.value = ''; return }
  if (!searchable(term)) {
    results.value = []; listOpen.value = false
    searchHint.value = 'Keep typing — part of the street or suburb name is what narrows it.'
    return
  }
  searchHint.value = ''
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  searching.value = true
  try {
    const r = await $fetch<{ results: LotMatch[]; hint?: string }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    searchHint.value = r.hint ?? ''
    highlight.value = 0
    listOpen.value = r.results.length > 0
    if (r.results.length === 1 && term.split(/\s+/).length >= 2) pickLot(r.results[0]!)
  } catch (e: any) {
    if (ctrl.signal.aborted) return
    searchMsg.value = e?.data?.message || e?.message || 'The search failed.'
    results.value = []
  } finally {
    if (inflight === ctrl) { searching.value = false; inflight = null }
  }
}

function onType() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 150)
}

function move(step: number) {
  if (!results.value.length) return
  listOpen.value = true
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}

function pickHighlighted() {
  if (results.value.length) { pickLot(results.value[highlight.value] ?? results.value[0]!); return }
  searchPlace()
}

const LOT_SOURCE = 'epi-lot'

/** Draw the lot, fit to it, and read every layer under it. */
async function pickLot(r: LotMatch) {
  listOpen.value = false
  q.value = r.address || r.titleLot || r.lotId || q.value
  if (!map) return
  searching.value = true
  searchMsg.value = ''
  try {
    const d = await $fetch<{ lotGeom: any; points: { msoid: number | null; lon: number; lat: number }[] }>(
      '/api/lotprofile', { query: { cadid: r.cadid } })
    if (!d.lotGeom) { searchMsg.value = `No shape is held for ${r.titleLot || r.lotId || r.cadid}.`; return }
    showLot(d.lotGeom)
    const box = bboxOf(d.lotGeom)
    map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 17.5, duration: 800 })
    const p = d.points.find(x => x.msoid === r.msoid) ?? d.points[0]
    if (p) showMark(p.lon, p.lat)
    // by cadid, so the lot the search chose is the lot that is read - not whichever one its point lands in
    await pick({ cadid: r.cadid })
  } catch (e: any) {
    searchMsg.value = e?.data?.message || e?.message || 'Could not open that lot.'
  } finally {
    searching.value = false
  }
}

function showLot(geometry: any) {
  if (!map) return
  const d = { type: 'Feature' as const, properties: {}, geometry }
  const src = map.getSource(LOT_SOURCE)
  if (src) { src.setData(d); return }
  map.addSource(LOT_SOURCE, { type: 'geojson', data: d })
  map.addLayer({ id: 'epi-lot-fill', type: 'fill', source: LOT_SOURCE, paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.08 } })
  map.addLayer({ id: 'epi-lot-line', type: 'line', source: LOT_SOURCE, paint: { 'line-color': '#0f172a', 'line-width': 2.5 } })
}

/** Nothing to outline: the click found no lot, so the answer is about the point alone. */
function clearLot() {
  if (!map?.getSource(LOT_SOURCE)) return
  for (const id of ['epi-lot-fill', 'epi-lot-line']) if (map.getLayer(id)) map.removeLayer(id)
  map.removeSource(LOT_SOURCE)
}

function bboxOf(geometry: any): [number, number, number, number] {
  const box: [number, number, number, number] = [180, 90, -180, -90]
  const walk = (a: any) => {
    if (typeof a[0] === 'number') {
      box[0] = Math.min(box[0], a[0]); box[1] = Math.min(box[1], a[1])
      box[2] = Math.max(box[2], a[0]); box[3] = Math.max(box[3], a[1])
      return
    }
    for (const b of a) walk(b)
  }
  walk(geometry.coordinates)
  return box
}

/** Kept for what is not an address: a suburb or a town. */
async function searchPlace() {
  const term = q.value.trim()
  if (!term || !map) return
  searching.value = true
  searchMsg.value = ''
  try {
    const params = new URLSearchParams({
      q: term, access_token: mapboxToken, country: 'au', limit: '1', language: 'en',
      bbox: '140.9,-37.6,153.7,-28.1', proximity: '151.2093,-33.8688',
    })
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`)
    const f = (await res.json())?.features?.[0]
    if (!f) { searchMsg.value = `Nothing found for "${term}".`; return }
    const [lon, lat] = f.geometry.coordinates as [number, number]
    map.flyTo({ center: [lon, lat], zoom: 14, duration: 1000 })
    await pick({ lon, lat })
  } catch {
    searchMsg.value = 'The place search failed.'
  } finally {
    searching.value = false
  }
}

// ── the map ──────────────────────────────────────────────────────────────────
function addLayers() {
  const groupsIn = data.value?.groups ?? []
  // reversed build order: the big blankets go down first, the small precise layers on top
  for (const g of [...groupsIn].reverse()) {
    const src = `epi-${g.key}`
    map.addSource(src, {
      type: 'vector',
      tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=epi-${g.key}&v=${encodeURIComponent(g.archive)}`],
      minzoom: g.minZoom,
      maxzoom: g.maxZoom,
    })
    const none = ['in', ['get', 'layer_key'], ['literal', []]]
    map.addLayer({
      id: `${src}-fill`, type: 'fill', source: src, 'source-layer': 'epi', filter: none,
      paint: { 'fill-color': lineOf(g.key), 'fill-opacity': fillsOn.value ? FILL_OPACITY : 0 },
    })
    map.addLayer({
      id: `${src}-line`, type: 'line', source: src, 'source-layer': 'epi', filter: none,
      paint: { 'line-color': lineOf(g.key), 'line-width': 1, 'line-opacity': 0.85 },
    })
  }
  refresh()
}

/**
 * Several of these layers are blankets over a whole council or the whole state, so even a light fill
 * stacks into an opaque wash once a few are on. Outlines alone stay readable however many are showing.
 */
function setFills(on: boolean) {
  fillsOn.value = on
  if (!map) return
  for (const g of data.value?.groups ?? []) {
    const id = `epi-${g.key}-fill`
    if (map.getLayer(id)) map.setPaintProperty(id, 'fill-opacity', on ? FILL_OPACITY : 0)
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
  map.on('zoomend', () => { zoom.value = map.getZoom(); onLiveSettled() })
  map.on('moveend', onLiveSettled)
  map.on('click', (e: any) => pick({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
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
.ep-page {
  height: 100vh; display: flex; flex-direction: column;
  background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
}
.ep-header {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0; flex: none;
}
.ep-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.ep-back:hover { color: #0f172a; }
.ep-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; }
.ep-header-stat { font-size: 0.8rem; color: #64748b; }
.ep-header-stat strong { color: #0f172a; font-weight: 700; }

/* Layers left, map centre, the point answer right. The side panels give width back as the window
   narrows so the three columns survive a laptop screen; they only stack on something phone-sized,
   because stacking puts the layer list above the map and the map stops being the middle of the page. */
.ep-body { flex: 1; min-height: 0; display: flex; }
.ep-panel { width: clamp(260px, 26vw, 360px); flex: none; overflow-y: auto; padding: 0.9rem 1rem 2rem; background: #fff; border-right: 1px solid #e2e8f0; }
.ep-mapwrap { position: relative; flex: 1; min-width: 0; }
.ep-map { position: absolute; inset: 0; }
.ep-result { width: clamp(250px, 23vw, 360px); flex: none; overflow-y: auto; padding: 0.9rem 1rem 2rem; background: #fff; border-left: 1px solid #e2e8f0; }
@media (max-width: 900px) {
  .ep-page { height: auto; min-height: 100vh; }
  .ep-body { flex-direction: column; }
  .ep-panel, .ep-result { width: auto; border: 0; border-bottom: 1px solid #e2e8f0; }
  .ep-mapwrap { height: 70vh; flex: none; order: -1; }
}

.ep-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.ep-combo { position: relative; }
.ep-input { width: 100%; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.85rem; }
.ep-combo-busy { position: absolute; right: 0.6rem; top: 0.55rem; font-size: 0.7rem; color: #94a3b8; }
.ep-listbox { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 2px); max-height: 320px; overflow-y: auto; margin: 0; padding: 0; list-style: none; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12); }
.ep-listbox-head { padding: 0.3rem 0.55rem; font-size: 0.7rem; color: #64748b; border-bottom: 1px solid #f1f5f9; }
.ep-option { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.35rem 0.55rem; cursor: pointer; }
.ep-option--on, .ep-option:hover { background: #f1f5f9; }
.ep-option-addr { font-size: 0.82rem; color: #0f172a; }
.ep-option-meta { display: flex; gap: 0.4rem; font-size: 0.7rem; color: #64748b; }
.ep-hint { margin: 0.4rem 0 0; font-size: 0.74rem; }

.ep-allrow { display: flex; align-items: center; gap: 0.4rem; margin: 1.1rem 0 0.6rem; font-size: 0.74rem; }
.ep-all { padding: 0.25rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font: inherit; font-size: 0.74rem; color: #334155; cursor: pointer; }
.ep-all:hover { background: #f1f5f9; }
.ep-all--on { background: #0f172a; border-color: #0f172a; color: #fff; }
.ep-all--on:hover { background: #1e293b; }
.ep-filter { flex: 1; min-width: 0; padding: 0.25rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; font-size: 0.74rem; }

/* ── the two halves of the panel, and the live-services check ─────────────── */
.ep-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; margin: 1rem 0 0.2rem; padding: 0.2rem; background: #f1f5f9; border-radius: 10px; }
.ep-tab { display: flex; align-items: center; justify-content: center; gap: 0.35rem; padding: 0.35rem 0.4rem; border: 0; border-radius: 8px; background: none; font: inherit; font-size: 0.78rem; font-weight: 700; color: #475569; cursor: pointer; }
.ep-tab--on { background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); color: #0f172a; }
.ep-tab-n { font-size: 0.68rem; font-weight: 600; opacity: 0.7; }
.ep-all--go { background: #0f172a; border-color: #0f172a; color: #fff; font-weight: 700; }
.ep-all--go:hover { background: #1e293b; }
.ep-bar { height: 4px; margin: 0.35rem 0 0.6rem; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
.ep-bar i { display: block; height: 100%; background: #0f172a; transition: width 0.2s; }
.ep-isect { border-top: 1px solid #f1f5f9; }
.ep-isect-head { display: flex; align-items: baseline; gap: 0.5rem; padding: 0.3rem 0; font-size: 0.82rem; font-weight: 600; color: #0f172a; cursor: pointer; list-style: none; }
.ep-isect-head::-webkit-details-marker { display: none; }
.ep-isect-head::before { content: '▸'; color: #94a3b8; font-size: 0.7rem; }
.ep-isect[open] > .ep-isect-head::before { content: '▾'; }
.ep-isect-name { flex: 1; min-width: 0; }
.ep-dot { width: 9px; height: 9px; flex: none; border-radius: 2px; }
.ep-eye { flex: none; display: inline-flex; align-items: center; padding: 0.1rem 0.2rem; border: 0; border-radius: 5px; background: none; color: #94a3b8; cursor: pointer; }
.ep-eye:hover { background: #f1f5f9; color: #0f172a; }
.ep-eye--on { background: #0f172a; color: #fff; }
.ep-eye--on:hover { background: #1e293b; color: #fff; }
.ep-eye--busy { opacity: 0.5; }
.ep-eye-note { margin: 0 0 0.3rem 0.9rem; font-size: 0.7rem; line-height: 1.4; color: #64748b; }
.ep-eye-note--bad { color: #b45309; }
.ep-isect-rec { margin: 0 0 0.4rem 0.9rem; padding: 0.3rem 0.5rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.ep-isect-kv { display: flex; justify-content: space-between; gap: 0.6rem; margin: 0; font-size: 0.7rem; }
.ep-isect-k { color: #94a3b8; flex: none; }
.ep-isect-v { color: #0f172a; text-align: right; word-break: break-word; }
.ep-fail { list-style: none; margin: 0 0 0.5rem; padding: 0; display: grid; gap: 0.25rem; }
.ep-fail li { font-size: 0.74rem; color: #475569; display: flex; flex-direction: column; }
.ep-fail b { font-weight: 600; color: #0f172a; }

.ep-group { margin-top: 1rem; }
.ep-h2 { display: flex; align-items: center; gap: 0.4rem; margin: 0 0 0.25rem; font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
.ep-g-n { margin-left: auto; font-size: 0.7rem; font-weight: 600; color: #94a3b8; }
.ep-list { list-style: none; margin: 0; padding: 0; }
.ep-item { padding: 0.35rem 0; border-top: 1px solid #f1f5f9; }
.ep-row { display: flex; align-items: center; gap: 0.45rem; cursor: pointer; }
.ep-row input { margin: 0; accent-color: #0f172a; flex: none; }
.ep-row--dead { cursor: default; }
.ep-row--dead .ep-name { color: #94a3b8; font-weight: 500; }
.ep-swatch { flex: none; width: 13px; height: 13px; border-radius: 3px; border: 2px solid; box-sizing: border-box; }
.ep-name { flex: 1; min-width: 0; font-size: 0.83rem; font-weight: 600; color: #0f172a; }
.ep-count { flex: none; font-size: 0.73rem; color: #64748b; font-variant-numeric: tabular-nums; }
.ep-blurb { margin: 0.15rem 0 0 1.55rem; font-size: 0.75rem; line-height: 1.45; color: #475569; }
.ep-meta { margin: 0.12rem 0 0 1.55rem; font-size: 0.7rem; color: #94a3b8; }
.ep-link { margin-left: 0.35rem; padding: 0; border: 0; background: none; color: #2a78d6; font: inherit; font-size: 0.7rem; font-weight: 700; cursor: pointer; }
.ep-link:hover { text-decoration: underline; }
.ep-more { margin: 0.3rem 0 0.2rem 1.55rem; padding: 0.35rem 0.5rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.ep-more-head { margin: 0.2rem 0 0.1rem; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
.ep-more-head:first-child { margin-top: 0; }
.ep-cats { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.05rem; }
.ep-cats li { font-size: 0.71rem; color: #334155; display: flex; justify-content: space-between; gap: 0.5rem; }
.ep-more-tail { margin: 0.15rem 0 0; font-size: 0.68rem; }

.ep-lead { margin: 0 0 0.7rem; font-size: 0.8rem; line-height: 1.5; color: #475569; }
.ep-at-head { padding-bottom: 0.5rem; margin-bottom: 0.6rem; border-bottom: 1px solid #e2e8f0; }
.ep-at-lot { display: flex; align-items: baseline; gap: 0.5rem; margin: 0; font-size: 0.9rem; font-weight: 700; color: #0f172a; }
.ep-at-meta { margin: 0.15rem 0 0; font-size: 0.72rem; }

.ep-hit { margin-bottom: 0.9rem; }
.ep-hit-title { display: flex; align-items: baseline; gap: 0.4rem; margin: 0 0 0.2rem; font-size: 0.82rem; }
.ep-hit-toggle { padding: 0.1rem 0.35rem; border: 0; border-radius: 5px; background: #f1f5f9; font: inherit; font-size: 0.78rem; font-weight: 700; color: #0f172a; cursor: pointer; }
.ep-hit-toggle--on { background: #0f172a; color: #fff; }
.ep-hit-toggle:disabled { background: none; color: #64748b; cursor: default; }
.ep-hit-n { margin-left: auto; font-size: 0.7rem; color: #94a3b8; }
.ep-hit-rows { list-style: none; margin: 0; padding: 0 0 0 0.3rem; border-left: 2px solid #e2e8f0; }
.ep-hit-row { padding: 0.2rem 0 0.2rem 0.4rem; }
.ep-hit-value { margin: 0; font-size: 0.8rem; color: #0f172a; }
.ep-hit-meta { display: flex; flex-wrap: wrap; gap: 0.2rem 0.5rem; margin: 0; font-size: 0.71rem; color: #64748b; }
.ep-chip { margin-left: 0.35rem; padding: 0.02em 0.35em; border-radius: 4px; background: #e0e7ff; color: #4338ca; font-size: 0.68rem; font-weight: 700; }
.ep-cover { margin-left: 0.35rem; padding: 0.02em 0.35em; border-radius: 4px; background: #f1f5f9; color: #64748b; font-size: 0.68rem; font-weight: 700; }
.ep-cover--part { background: #fef3c7; color: #92400e; }

.ep-key { width: 12px; height: 12px; flex: none; border: 1px solid transparent; border-radius: 2px; }
.ep-dim { color: #94a3b8; }
.ep-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.ep-note { margin: 0.4rem 0 0; font-size: 0.76rem; color: #b45309; }
.ep-error { margin: 0.6rem 0; padding: 0.55rem 0.75rem; border-left: 3px solid #dc2626; background: #fef2f2; color: #991b1b; font-size: 0.8rem; }
.ep-warnbox { margin: 0.6rem 0; padding: 0.55rem 0.75rem; border-left: 3px solid #d97706; background: #fffbeb; color: #92400e; font-size: 0.78rem; }
.ep-over { position: absolute; top: 0.75rem; left: 0.75rem; right: 0.75rem; z-index: 2; }
.ep-status { position: absolute; bottom: 0.75rem; left: 50%; transform: translateX(-50%); margin: 0; padding: 0.25rem 0.7rem; background: rgba(15, 23, 42, 0.8); color: #fff; border-radius: 999px; font-size: 0.75rem; }
.ep-zoomhint { position: absolute; top: 0.75rem; left: 50%; transform: translateX(-50%); margin: 0; padding: 0.25rem 0.7rem; background: rgba(255, 255, 255, 0.94); border: 1px solid #e2e8f0; border-radius: 999px; font-size: 0.73rem; color: #475569; }
.ep-legend { position: absolute; top: 0.75rem; left: 0.75rem; display: flex; flex-direction: column; gap: 0.2rem; padding: 0.45rem 0.6rem; background: rgba(255, 255, 255, 0.92); border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.72rem; color: #475569; }
.ep-legend span { display: flex; align-items: center; gap: 0.35rem; }
</style>
