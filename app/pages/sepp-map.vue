<!--
  /sepp-map - every SEPP land application layer that is not a low and mid-rise one, on one map.

  Split out of /lmr (2026-09-28), which now carries only the Housing SEPP's low and mid-rise layers and the
  constraints the policy is checked against. These 33 layers - the Biodiversity and Conservation catchments,
  the Precincts SEPPs, the Codes SEPP, Resilience and Hazards and the rest - come from the same PMTiles
  archive (scripts/build-sepp-pmtiles.py, layer_group 'sepp'), so both pages read the one build.

  - The panel lists the layers by family and SEPP, drawn in the NSW Spatial Viewer's symbology where it has
    them (shared/lmr-layers.ts SEPP_STYLE); the panel is the legend.
  - The toggles are a map filter on layer_key, so switching a layer draws from tiles already loaded.
  - Clicking the map, or picking an address, asks /api/lmr/at what applies at that point, and shows the SEPP
    layers among the answer.
  - The switched-on layers and the view are kept in the URL hash, so a view can be shared.
-->

<template>
  <div class="lm-page">
    <header class="lm-header">
      <div>
        <NuxtLink to="/" class="lm-back">&larr; Home</NuxtLink>
        <h1 class="lm-title">SEPP land application layers</h1>
      </div>
      <div v-if="catalogue" class="lm-header-stat">
        {{ seppLayers.length }} layers from <strong>epi_land_application</strong><template v-if="catalogue.sourceDate">
          · EPI data of <strong>{{ fmtDate(catalogue.sourceDate) }}</strong></template>
        · <NuxtLink to="/lmr" class="lm-link">low and mid-rise layers</NuxtLink>
      </div>
    </header>

    <div class="lm-body">
      <aside class="lm-panel" :class="{ 'lm-panel--closed': !panelOpen }">
        <button type="button" class="lm-panel-toggle" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
          {{ panelOpen ? 'Hide layers' : 'Layers' }}
        </button>
        <div v-show="panelOpen" class="lm-panel-inner">
          <div class="lm-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
            <label class="lm-sr" for="lm-q">Address, lot reference or place</label>
            <input
              id="lm-q" v-model="q" type="search" class="lm-input" role="combobox"
              placeholder="An address, a lot &mdash; A//DP71490 &mdash; or a place"
              autocomplete="off" spellcheck="false"
              :aria-expanded="listOpen && results.length > 0" aria-controls="lm-listbox"
              :aria-activedescendant="listOpen && results[highlight] ? `lm-opt-${highlight}` : undefined"
              @input="onType" @focus="listOpen = results.length > 0"
              @keydown.enter.prevent="pickHighlighted"
            >
            <span v-if="searching" class="lm-combo-busy">searching&hellip;</span>

            <!-- Picking a suggestion goes to that lot: no separate confirm, and a
                 query that narrows to one address goes there on its own. -->
            <ul v-if="listOpen && results.length" id="lm-listbox" class="lm-listbox" role="listbox">
              <li class="lm-listbox-head">
                {{ results.length }}{{ results.length === 25 ? '+' : '' }}
                {{ results.length === 1 ? 'match' : 'matches' }}
                <span class="lm-dim">&middot; &uarr;&darr; then Enter, or click</span>
              </li>
              <li
                v-for="(r, i) in results" :id="`lm-opt-${i}`" :key="`${r.cadid}-${r.msoid}`"
                role="option" :aria-selected="i === highlight"
                class="lm-option" :class="{ 'lm-option--on': i === highlight }"
                @mousedown.prevent="pickLot(r)" @mousemove="highlight = i"
              >
                <span class="lm-option-addr">{{ r.address || '(no address)' }}</span>
                <span class="lm-option-meta"><code>{{ r.titleLot || r.lotId || '&mdash;' }}</code><span class="lm-dim">{{ r.lgaName || '' }}</span></span>
              </li>
            </ul>
          </div>
          <p v-if="searchMsg" class="lm-note">{{ searchMsg }}</p>
          <p v-else-if="searchHint" class="lm-dim lm-hint">{{ searchHint }}</p>
          <p v-else-if="searched && !results.length && !searching" class="lm-dim lm-hint">
            No address or lot matched <b>{{ lastSearched }}</b>. Press Enter to look for a place of that name instead.
          </p>


          <p v-if="loadError" class="lm-error">{{ loadError }}</p>
          <p v-else-if="!catalogue" class="lm-dim">Loading layers…</p>

          <template v-else>
            <p class="lm-allrow">
              <span class="lm-dim">{{ on.size }} of {{ seppLayers.length }} layers on</span>
              <button type="button" class="lm-link" :disabled="!on.size" @click="allOff">Turn all off</button>
            </p>

            <!-- Every SEPP layer that is not a low and mid-rise one, by family and SEPP -->
            <section class="lm-group">
              <h2 class="lm-h2">SEPP land application layers</h2>
              <p class="lm-lead">Drawn in the NSW Spatial Viewer's symbology where it has the layer, and with a dashed outline in the family's colour where it does not. Click the map to see every layer that applies at a point.</p>
              <details v-for="fam in families" :key="fam.key" class="lm-family" :open="true">
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
                        <span class="lm-swatch" :style="swatchStyle(l)" :title="seppStyle(l).from" />
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
              The four low and mid-rise layers of the Housing SEPP are on <NuxtLink to="/lmr" class="lm-link">/lmr</NuxtLink>.
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
            <p v-if="!picked.hits.length" class="lm-dim">No SEPP land application layer covers this point.</p>
            <ul class="lm-hits">
              <li v-for="(h, i) in picked.hits" :key="i" class="lm-hit">
                <span class="lm-swatch" :style="swatchStyle(h as any)" />
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

    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { FAMILY, seppStyle, swatchCss, type LmrCatalogue, type LmrFamily, type LmrHit, type LmrLayer } from '#shared/lmr-layers'
import { ensureHatch, HATCH_NONE } from '#shared/hatch'

useHead({ title: 'SEPP layers · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')

type Catalogue = LmrCatalogue & { archive: string }
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

/** The SEPP families this page draws; the low and mid-rise layers ('lmr') belong to /lmr. */
const FAMILIES = ['housing', 'precincts', 'environment', 'systems'] as const
const isSeppHit = (h: LmrHit) => (FAMILIES as readonly string[]).includes(h.family)

const seppLayers = computed(() => (catalogue.value?.layers ?? []).filter(l => l.family !== 'lmr'))

const families = computed(() => FAMILIES.map((key) => {
  const layers = seppLayers.value.filter(l => l.family === key)
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

/** A match expression over layer_key, one value per layer on this page. */
function byLayer(value: (l: LmrLayer) => string | number, fallback: string | number): any {
  const pairs = seppLayers.value.flatMap(l => [l.key, value(l)])
  return pairs.length ? ['match', ['get', 'layer_key'], ...pairs, fallback] : fallback
}

/** A SEPP layer, and switched on. Heavy layers' minimum zoom is baked into the archive by tippecanoe. */
function onFilter(): any[] {
  return ['all', ['==', ['get', 'layer_group'], 'sepp'], ['in', ['get', 'layer_key'], ['literal', [...on.value]]]]
}

/**
 * Four map layers, as on /lmr: the flat fill, the portal's hatches as a data-driven pattern (a solid layer gets
 * the empty tile), the solid outline, and the dashed outline only the family fallback uses.
 */
const DRAWN = ['sepp-fill', 'sepp-hatch', 'sepp-line', 'sepp-dash'] as const

function addLayers() {
  if (!map || map.getSource(SOURCE)) return
  // the archive stops at zoom 14; the map overzooms its tiles past that
  map.addSource(SOURCE, { type: 'vector', tiles: [tileUrl()], minzoom: 4, maxzoom: 14 })
  const common = { source: SOURCE, 'source-layer': 'sepp', filter: onFilter() }
  const sym = (l: LmrLayer) => seppStyle(l)
  for (const l of seppLayers.value) {
    const s = sym(l)
    if (s.hatch) ensureHatch(map, s.hatch, s.fill)
  }
  map.addLayer({ ...common, id: 'sepp-fill', type: 'fill',
    paint: { 'fill-color': byLayer(l => sym(l).fill, '#cbd5e1'), 'fill-opacity': byLayer(l => (sym(l).hatch ? 0 : sym(l).fillOpacity), 0.3) } })
  map.addLayer({ ...common, id: 'sepp-hatch', type: 'fill',
    paint: { 'fill-pattern': byLayer(l => { const s = sym(l); return s.hatch ? `hatch-${s.hatch}-${s.fill.slice(1)}` : HATCH_NONE }, HATCH_NONE) } })
  map.addLayer({ ...common, id: 'sepp-line', type: 'line', layout: { 'line-join': 'round' },
    paint: { 'line-color': byLayer(l => sym(l).line, '#475569'), 'line-width': byLayer(l => (sym(l).dashed ? 0 : sym(l).lineWidth), 1) } })
  map.addLayer({ ...common, id: 'sepp-dash', type: 'line',
    paint: { 'line-color': byLayer(l => sym(l).line, '#475569'), 'line-width': byLayer(l => (sym(l).dashed ? sym(l).lineWidth : 0), 0), 'line-dasharray': [3, 2] } })
}

function refreshTiles() {
  if (map?.getSource(SOURCE)) {
    for (const id of DRAWN) if (map.getLayer(id)) map.setFilter(id, onFilter())
  }
  syncHash()
}

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

/** The same point query as /lmr, narrowed to the SEPP layers this page draws. */
async function pick(lon: number, lat: number) {
  picked.value = { lon, lat, hits: [] }
  picking.value = true
  pickError.value = ''
  marker?.remove()
  marker = new mapboxgl.Marker({ color: '#0f172a', scale: 0.7 }).setLngLat([lon, lat]).addTo(map)
  try {
    const r = await $fetch<{ lon: number; lat: number; hits: LmrHit[] }>('/api/lmr/at', { query: { lon, lat } })
    if (picked.value?.lon === lon && picked.value?.lat === lat) picked.value = { ...r, hits: r.hits.filter(isSeppHit) }
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
  clearLot()
}

function swatchStyle(h: { key?: string; family: LmrFamily; layName: string }) {
  return swatchCss(h)
}

// ── search: an address or lot from the build, or failing that a place ───────
//
// The same search as /testing-spatial-services, over derived.lot_address: every
// word typed has to appear, an abbreviated street type matches the spelled-out
// one, and a plan label is matched on the lot reference instead. Picking a
// result draws that lot and reads the layers under it. A term that matches no
// address falls back to Mapbox on Enter, which is how a suburb or a town still
// moves the map.

interface LotMatch {
  cadid: string
  lotId: string | null
  titleLot: string | null
  msoid: number | null
  address: string | null
  suburb: string | null
  lgaName: string | null
}

const q = ref('')
const results = ref<LotMatch[]>([])
const searching = ref(false)
const searchMsg = ref('')
const searchHint = ref('')
const searched = ref(false)
const lastSearched = ref('')
const listOpen = ref(false)
const highlight = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

// Mirrors the server's rule, so a query it would refuse never leaves the browser.
const ROAD_TYPES: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', DRV: 'DRIVE', PDE: 'PARADE',
  CRES: 'CRESCENT', CR: 'CRESCENT', PL: 'PLACE', HWY: 'HIGHWAY', CCT: 'CIRCUIT', CL: 'CLOSE',
  CT: 'COURT', TCE: 'TERRACE', LN: 'LANE', BVD: 'BOULEVARD', BLVD: 'BOULEVARD', GR: 'GROVE',
  ESP: 'ESPLANADE', WY: 'WAY', SQ: 'SQUARE', PKWY: 'PARKWAY', MWY: 'MOTORWAY', FWY: 'FREEWAY',
  CIR: 'CIRCLE', GDNS: 'GARDENS', RES: 'RESERVE', TRL: 'TRAIL',
}
const ROAD_WORDS = new Set(Object.values(ROAD_TYPES))
function searchable(term: string): boolean {
  if (/\b(?:D|S|C)P\s*\d+/i.test(term) || term.includes('//')) return true
  return term.split(/\s+/).map(w => ROAD_TYPES[w.toUpperCase()] ?? w)
    .some(w => w.length >= 3 && !ROAD_WORDS.has(w.toUpperCase()) && !/^\d+[a-z]?$/i.test(w))
}

async function runSearch() {
  const term = q.value.trim()
  searchMsg.value = ''
  if (term.length < 2) { results.value = []; listOpen.value = false; searchHint.value = ''; searched.value = false; return }
  if (!searchable(term)) {
    results.value = []; listOpen.value = false; searched.value = false
    searchHint.value = 'Keep typing — part of the street or suburb name is what narrows it.'
    return
  }
  searchHint.value = ''
  // A newer keystroke makes the previous request worthless: abort it, so it
  // stops costing the server anything and can never land after this one.
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  searching.value = true
  try {
    const r = await $fetch<{ results: LotMatch[]; hint?: string }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    searchHint.value = r.hint ?? ''
    lastSearched.value = term
    searched.value = true
    highlight.value = 0
    listOpen.value = r.results.length > 0
    // Narrowed to one address, with at least a number and a street typed: go there.
    if (r.results.length === 1 && term.split(/\s+/).length >= 2) pickLot(r.results[0]!)
  } catch (e: any) {
    if (ctrl.signal.aborted) return
    searchMsg.value = e?.data?.message || e?.message || 'The search failed.'
    results.value = []
  } finally {
    if (inflight === ctrl) { searching.value = false; inflight = null }
  }
}

/** Search a moment after the last keystroke rather than on every one. */
function onType() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 150)
}

function move(step: number) {
  if (!results.value.length) return
  listOpen.value = true
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}

/** Enter takes the highlighted address, or looks for a place when nothing matched. */
function pickHighlighted() {
  if (results.value.length) {
    pickLot(results.value[highlight.value] ?? results.value[0]!)
    return
  }
  searchPlace()
}

/** Draw a lot, fit the map to it, and read every layer under it. */
async function pickLot(r: LotMatch) {
  listOpen.value = false
  q.value = r.address || r.titleLot || r.lotId || q.value
  if (!map) return
  searching.value = true
  searchMsg.value = ''
  try {
    const d = await $fetch<{
      lotGeom: any
      points: { msoid: number | null; lon: number; lat: number }[]
    }>('/api/lotprofile', { query: { cadid: r.cadid } })
    if (!d.lotGeom) { searchMsg.value = `No shape is held for ${r.titleLot || r.lotId || r.cadid}.`; return }
    showLot(d.lotGeom)
    const box = bboxOf(d.lotGeom)
    map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 17.5, duration: 800 })
    const p = d.points.find(x => x.msoid === r.msoid) ?? d.points[0]
    await pick(p ? p.lon : (box[0] + box[2]) / 2, p ? p.lat : (box[1] + box[3]) / 2)
  } catch (e: any) {
    searchMsg.value = e?.data?.message || e?.message || 'Could not open that lot.'
  } finally {
    searching.value = false
  }
}

const LOT_SOURCE = 'lotpick'

/** The picked lot, over everything else: the outline is what says "this one". */
function showLot(geometry: any) {
  if (!map) return
  const data = { type: 'Feature' as const, properties: {}, geometry }
  const src = map.getSource(LOT_SOURCE)
  if (src) {
    src.setData(data)
    return
  }
  map.addSource(LOT_SOURCE, { type: 'geojson', data })
  map.addLayer({ id: 'lotpick-fill', type: 'fill', source: LOT_SOURCE, paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.1 } })
  map.addLayer({ id: 'lotpick-line', type: 'line', source: LOT_SOURCE, paint: { 'line-color': '#0f172a', 'line-width': 2.5 } })
}

function clearLot() {
  if (!map?.getSource(LOT_SOURCE)) return
  for (const id of ['lotpick-fill', 'lotpick-line']) if (map.getLayer(id)) map.removeLayer(id)
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

/** The old behaviour, kept for what is not an address: a suburb or a town. */
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
    await pick(lon, lat)
  } catch {
    searchMsg.value = 'The place search failed.'
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
  const known = new Set(seppLayers.value.map(l => l.key))
  // nothing on by default: these are reference layers, and a view someone shared brings its own
  on.value = new Set(hash?.layers.filter(k => known.has(k)) ?? [])

  if (!mapboxToken) return
  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken
  map = new mapboxgl.Map({
    container: mapEl.value!,
    style: 'mapbox://styles/mapbox/light-v11',
    center: hash ? [hash.lon, hash.lat] : [151.0, -33.8],
    zoom: hash ? hash.zoom : 9,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  map.on('load', addLayers)
  map.on('moveend', syncHash)
  map.on('click', (e: any) => pick(e.lngLat.lng, e.lngLat.lat))
  map.on('dataloading', () => { if (on.value.size) status.value = 'Loading tiles…' })
  map.on('idle', () => { status.value = '' })
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (msg && !/aborted/i.test(msg)) status.value = msg.slice(0, 140)
  })
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
.lm-combo { position: relative; }
.lm-combo .lm-input { width: 100%; }
.lm-combo-busy { position: absolute; right: 0.6rem; top: 50%; transform: translateY(-50%); font-size: 0.72rem; color: #94a3b8; }
.lm-listbox { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 0.25rem); max-height: 17rem; overflow-y: auto; list-style: none; margin: 0; padding: 0; background: #fff; border: 1px solid #c7d2fe; border-radius: 10px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12); }
.lm-listbox-head { padding: 0.3rem 0.6rem; background: #f5f3ff; color: #4a3aa7; font-size: 0.72rem; font-weight: 700; }
.lm-option { display: flex; justify-content: space-between; gap: 0.6rem; padding: 0.35rem 0.6rem; font-size: 0.8rem; cursor: pointer; }
.lm-option + .lm-option { border-top: 1px solid #f1f5f9; }
.lm-option--on, .lm-option:hover { background: #f5f3ff; }
.lm-option-addr { font-weight: 600; color: #0f172a; }
.lm-option-meta { display: flex; gap: 0.4rem; align-items: baseline; white-space: nowrap; font-size: 0.72rem; }
.lm-hint { margin: 0.35rem 0 0; font-size: 0.78rem; }
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
