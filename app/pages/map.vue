<template>
  <div class="map-page">
    <!-- ── Layer panel ───────────────────────────────────────────────────── -->
    <aside class="panel" :class="{ 'panel--collapsed': collapsed }">
      <div class="panel-head">
        <div>
          <h1 class="panel-title">Tile catalog</h1>
          <p class="panel-sub">
            <template v-if="loading">Loading catalog…</template>
            <template v-else-if="loadError">{{ loadError }}</template>
            <template v-else>{{ allLayers.length }} layers · {{ SCHEMAS.join(' + ') }}</template>
          </p>
        </div>
        <button class="icon-btn" title="Collapse panel" @click="collapsed = true">‹</button>
      </div>

      <div class="panel-controls">
        <input
          v-model="search"
          type="search"
          class="search-input"
          placeholder="Search layers — e.g. flood, zoning, heritage"
        >

        <div class="chip-row">
          <button
            v-for="s in SCHEMAS"
            :key="s"
            type="button"
            class="chip"
            :class="{ 'chip--on': schemaOn[s] }"
            @click="schemaOn[s] = !schemaOn[s]"
          >
            {{ s }}<span class="chip-count">{{ countBySchema[s] || 0 }}</span>
          </button>
        </div>

        <div class="active-row">
          <span class="active-count">
            {{ active.length }} active<template v-if="filtered.length !== allLayers.length"> · {{ filtered.length }} shown</template>
          </span>
          <div class="active-actions">
            <button type="button" class="text-btn" :disabled="!filtered.length" @click="enableAllShown">Add shown</button>
            <button type="button" class="text-btn" :disabled="!active.length" @click="clearAll">Clear</button>
          </div>
        </div>

        <div v-if="active.length" class="opacity-row">
          <label class="opacity-label">Fill opacity</label>
          <input v-model.number="fillOpacity" type="range" min="0" max="1" step="0.05" class="opacity-slider">
          <span class="opacity-value">{{ Math.round(fillOpacity * 100) }}%</span>
        </div>

        <p v-if="active.length > 30" class="warn">
          {{ active.length }} layers active — each one fetches its own tiles, so panning will get slow.
        </p>
        <p v-if="!hasToken" class="warn">
          No Mapbox token — set NUXT_PUBLIC_MAPBOX_TOKEN in .env, then restart the dev server.
        </p>
      </div>

      <!-- Layer list -->
      <div class="layer-list">
        <p v-if="!loading && !filtered.length" class="empty">No layers match “{{ search }}”.</p>
        <div
          v-for="l in filtered"
          :key="l.id"
          class="layer-row"
          :class="{ 'layer-row--on': isActive(l.id) }"
        >
          <label class="layer-main">
            <input type="checkbox" :checked="isActive(l.id)" @change="toggle(l)">
            <span class="swatch" :style="{ background: l.color }" />
            <span class="layer-text">
              <span class="layer-name">{{ l.table }}</span>
              <span class="layer-meta">{{ l.schema }} · {{ l.geom }}</span>
            </span>
          </label>
          <button
            v-if="isActive(l.id)"
            type="button"
            class="icon-btn icon-btn--sm"
            title="Zoom to layer extent"
            @click="zoomTo(l.id)"
          >⤢</button>
        </div>
      </div>
    </aside>

    <button v-if="collapsed" class="panel-open" @click="collapsed = false">
      Layers<span v-if="active.length" class="panel-open-count">{{ active.length }}</span>
    </button>

    <!-- ── Map ───────────────────────────────────────────────────────────── -->
    <div class="map-wrap">
      <div ref="mapEl" class="map" />

      <!-- Address search — same source as the property search on the landing page -->
      <div class="map-search" :class="{ 'map-search--shifted': collapsed }">
        <div class="map-search-box">
          <svg class="map-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input
            v-model="addr"
            type="text"
            class="map-search-input"
            placeholder="Find an address — e.g. 15 Smith Street, Albury"
            autocomplete="off"
            @input="onAddrInput"
            @keydown.down.prevent="addrIndex = Math.min(addrIndex + 1, addrResults.length - 1)"
            @keydown.up.prevent="addrIndex = Math.max(addrIndex - 1, 0)"
            @keydown.enter.prevent="addrResults.length ? selectAddr(addrResults[addrIndex]!) : null"
            @keydown.esc="addrResults = []"
            @blur="dismissAddr"
          >
          <button v-if="addr" type="button" class="map-search-clear" title="Clear" @click="clearAddr">×</button>
        </div>

        <div v-if="addrResults.length || addrNote" class="map-search-drop">
          <p v-if="addrNote" class="map-search-note">{{ addrNote }}</p>
          <button
            v-for="(r, i) in addrResults"
            :key="r.id"
            type="button"
            class="map-search-item"
            :class="{ 'map-search-item--active': i === addrIndex }"
            @mousedown.prevent="selectAddr(r)"
          >
            <span class="map-search-main">
              {{ r.address }}
              <span v-if="r.source === 'mapbox'" class="map-search-tag">Mapbox</span>
            </span>
            <span class="map-search-context">{{ r.context }}<template v-if="r.zone"> · {{ r.zone }}</template></span>
          </button>
        </div>
      </div>

      <div class="map-controls">
        <!-- Measurement readout -->
        <div v-if="measureMode || measurePoints.length" class="measure-readout">
          <div v-if="measureTotal" class="measure-value">{{ measureTotal }}</div>
          <div v-if="measureSecondary" class="measure-secondary">{{ measureSecondary }}</div>
          <div class="measure-hint">
            <template v-if="measuring">
              {{ measurePoints.length < minPoints ? `Click ${minPoints - measurePoints.length} more point${minPoints - measurePoints.length > 1 ? 's' : ''}` : 'Double-click or Enter to finish' }} · Esc to cancel
            </template>
            <template v-else>Finished · {{ measurePoints.length }} points</template>
          </div>
        </div>

        <div class="measure-control">
          <button
            type="button"
            class="measure-btn"
            :class="{ 'measure-btn--on': measureMode === 'distance' }"
            title="Measure distance"
            @click="toggleMeasure('distance')"
          >distance</button>
          <button
            type="button"
            class="measure-btn"
            :class="{ 'measure-btn--on': measureMode === 'area' }"
            title="Measure area"
            @click="toggleMeasure('area')"
          >area</button>
          <button
            v-if="measurePoints.length"
            type="button"
            class="measure-btn measure-btn--clear"
            title="Clear measurement"
            @click="clearMeasure"
          >clear</button>
        </div>

        <div class="basemap-switch">
          <button
            v-for="b in BASEMAP_IDS"
            :key="b"
            type="button"
            class="basemap-btn"
            :class="{ 'basemap-btn--on': basemap === b }"
            @click="setBasemap(b)"
          >{{ b }}</button>
        </div>
      </div>

      <div v-if="status" class="status-chip">{{ status }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { haversine, pathLength, ringArea, fmtDistance, fmtArea } from '#shared/geo-measure.mjs'

/** Schemas we surface from the Martin catalog. */
const SCHEMAS = ['public', 'urbanportaldbp'] as const
const BASEMAP_IDS = ['streets', 'light', 'satellite'] as const

type Schema = typeof SCHEMAS[number]
type BasemapId = typeof BASEMAP_IDS[number]

const BASEMAP_STYLES: Record<BasemapId, string> = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  light: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
}

interface CatalogLayer {
  id: string        // Martin source id — also the MVT source-layer name
  schema: string
  table: string
  geom: string      // geometry column
  color: string
}

const config = useRuntimeConfig()
const martinUrl = String((config.public as any).martinUrl || '').replace(/\/+$/, '')
const mapboxToken = String((config.public as any).mapboxToken || '')
const hasToken = computed(() => !!mapboxToken)

const mapEl = ref<HTMLElement | null>(null)
const allLayers = ref<CatalogLayer[]>([])
const active = ref<string[]>([])          // ordered: last added draws on top
const loading = ref(true)
const loadError = ref('')
const status = ref('')
const search = ref('')
const collapsed = ref(false)
const basemap = ref<BasemapId>('streets')
const fillOpacity = ref(0.35)
const schemaOn = reactive<Record<string, boolean>>(
  Object.fromEntries(SCHEMAS.map(s => [s, true])) as Record<Schema, boolean>
)

let map: any = null
let mapboxgl: any = null
let popup: any = null
let addrMarker: any = null

// ── Catalog ─────────────────────────────────────────────────────────────────

/** Stable per-layer colour so a layer looks the same across sessions. */
function colorFor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `hsl(${h % 360}, ${65 + (h >> 9) % 20}%, ${42 + (h >> 17) % 12}%)`
}

/** Martin descriptions look like `schema.table.geom_column`. */
function parseEntry(id: string, description: string): CatalogLayer | null {
  const parts = (description || '').split('.')
  if (parts.length < 3) return null
  return {
    id,
    schema: parts[0]!,
    table: parts.slice(1, -1).join('.'),
    geom: parts[parts.length - 1]!,
    color: colorFor(id),
  }
}

async function loadCatalog() {
  try {
    const res = await fetch(`${martinUrl}/catalog`)
    if (!res.ok) throw new Error(`catalog returned ${res.status}`)
    const json = await res.json()
    const tiles = (json?.tiles || {}) as Record<string, { description?: string }>
    allLayers.value = Object.entries(tiles)
      .map(([id, meta]) => parseEntry(id, meta?.description || ''))
      .filter((l): l is CatalogLayer => !!l && (SCHEMAS as readonly string[]).includes(l.schema))
      .sort((a, b) => a.table.localeCompare(b.table))
  } catch (e: any) {
    loadError.value = `Could not reach ${martinUrl} — ${e?.message || e}`
  } finally {
    loading.value = false
  }
}

const layerById = computed(() => new Map(allLayers.value.map(l => [l.id, l])))

const countBySchema = computed(() => {
  const out: Record<string, number> = {}
  for (const l of allLayers.value) out[l.schema] = (out[l.schema] || 0) + 1
  return out
})

const filtered = computed(() => {
  const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean)
  return allLayers.value.filter((l) => {
    if (!schemaOn[l.schema]) return false
    if (!terms.length) return true
    const hay = `${l.table} ${l.schema} ${l.id}`.toLowerCase()
    return terms.every(t => hay.includes(t))
  })
})

// ── Map layer plumbing ──────────────────────────────────────────────────────

const srcId = (id: string) => `martin:${id}`
const fillId = (id: string) => `${id}::fill`
const lineId = (id: string) => `${id}::line`
const circleId = (id: string) => `${id}::circle`

function isActive(id: string) {
  return active.value.includes(id)
}

function addToMap(l: CatalogLayer) {
  if (!map || map.getSource(srcId(l.id))) return

  map.addSource(srcId(l.id), {
    type: 'vector',
    tiles: [`${martinUrl}/${encodeURIComponent(l.id)}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 22,
  })

  const common = { source: srcId(l.id), 'source-layer': l.id }

  // Martin does not publish geometry type, so add all three renderers and let
  // the $type filters decide which one actually draws.
  map.addLayer({
    ...common,
    id: fillId(l.id),
    type: 'fill',
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': l.color, 'fill-opacity': fillOpacity.value },
  })
  map.addLayer({
    ...common,
    id: lineId(l.id),
    type: 'line',
    filter: ['in', '$type', 'LineString', 'Polygon'],
    paint: { 'line-color': l.color, 'line-width': 1.4, 'line-opacity': 0.9 },
  })
  map.addLayer({
    ...common,
    id: circleId(l.id),
    type: 'circle',
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 6],
      'circle-color': l.color,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
    },
  })
}

function removeFromMap(id: string) {
  if (!map) return
  for (const lid of [fillId(id), lineId(id), circleId(id)]) {
    if (map.getLayer(lid)) map.removeLayer(lid)
  }
  if (map.getSource(srcId(id))) map.removeSource(srcId(id))
}

/** Keep fills under lines under points, otherwise one big polygon hides everything.
 *  Measurement graphics always stay on top. */
function restack() {
  if (!map) return
  for (const kind of [fillId, lineId, circleId]) {
    for (const id of active.value) {
      const lid = kind(id)
      if (map.getLayer(lid)) map.moveLayer(lid)
    }
  }
  for (const lid of MEASURE_LAYERS) {
    if (map.getLayer(lid)) map.moveLayer(lid)
  }
}

function toggle(l: CatalogLayer) {
  if (isActive(l.id)) {
    active.value = active.value.filter(x => x !== l.id)
    removeFromMap(l.id)
  } else {
    active.value = [...active.value, l.id]
    addToMap(l)
    restack()
  }
  syncHash()
}

function enableAllShown() {
  const toAdd = filtered.value.filter(l => !isActive(l.id))
  if (!toAdd.length) return
  if (toAdd.length > 25 && !confirm(`Add ${toAdd.length} layers? Each one fetches its own tiles — the map will get slow.`)) return
  for (const l of toAdd) addToMap(l)
  active.value = [...active.value, ...toAdd.map(l => l.id)]
  restack()
  syncHash()
}

function clearAll() {
  for (const id of active.value) removeFromMap(id)
  active.value = []
  popup?.remove()
  syncHash()
}

/** Martin publishes bounds in the TileJSON for some tables only. */
async function zoomTo(id: string) {
  try {
    const tj = await (await fetch(`${martinUrl}/${encodeURIComponent(id)}`)).json()
    const b = tj?.bounds
    if (!Array.isArray(b) || b.length !== 4) {
      flash('No extent published for this layer')
      return
    }
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 800 })
  } catch {
    flash('Could not read layer extent')
  }
}

let flashTimer: any = null
function flash(msg: string) {
  status.value = msg
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { status.value = '' }, 3000)
}

watch(fillOpacity, (v) => {
  if (!map) return
  for (const id of active.value) {
    if (map.getLayer(fillId(id))) map.setPaintProperty(fillId(id), 'fill-opacity', v)
  }
})

// ── Shareable state in the URL ──────────────────────────────────────────────

function syncHash() {
  if (!import.meta.client) return
  const qs = active.value.length ? `?layers=${active.value.map(encodeURIComponent).join(',')}` : ''
  // Keep vue-router's own history.state — clearing it makes the router warn.
  history.replaceState(history.state, '', location.pathname + qs)
}

function layersFromUrl(): string[] {
  const raw = new URLSearchParams(location.search).get('layers')
  return raw ? raw.split(',').map(decodeURIComponent).filter(Boolean) : []
}

// ── Basemap ─────────────────────────────────────────────────────────────────

/** setStyle drops every added source, so re-add the active layers afterwards. */
function setBasemap(b: BasemapId) {
  if (b === basemap.value) return
  basemap.value = b
  if (!map) return
  map.setStyle(BASEMAP_STYLES[b])
  map.once('style.load', () => {
    for (const id of active.value) {
      const l = layerById.value.get(id)
      if (l) addToMap(l)
    }
    ensureMeasureLayers()
    renderMeasure()
    restack()
  })
}

// ── Address search ──────────────────────────────────────────────────────────

interface AddrResult {
  id: string
  address: string
  context: string
  zone: string
  lat: number
  lng: number
  zoom: number
  source: 'local' | 'mapbox'
}

/** How close to zoom for each Mapbox feature type. */
const MAPBOX_ZOOM: Record<string, number> = {
  address: 17, street: 16, neighborhood: 14, postcode: 13, locality: 13, place: 11, region: 8,
}

const addr = ref('')
const addrResults = ref<AddrResult[]>([])
const addrIndex = ref(0)
const addrNote = ref('')
let addrDebounce: ReturnType<typeof setTimeout> | null = null

function onAddrInput() {
  addrIndex.value = 0
  addrNote.value = ''
  if (addrDebounce) clearTimeout(addrDebounce)
  const q = addr.value.trim()
  if (q.length < 3) { addrResults.value = []; return }
  addrDebounce = setTimeout(() => fetchAddr(q), 250)
}

/** The property DB — richer (zone, LGA) but only covers NSW properties. */
async function fetchLocalAddr(q: string): Promise<AddrResult[]> {
  try {
    const res = await fetch(`/api/address-autocomplete?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || [])
      .filter((r: any) => r.centroid_lat != null && r.centroid_lon != null)
      .map((r: any, i: number): AddrResult => ({
        id: `local-${r.address}-${i}`,
        address: r.address,
        context: [r.suburbname, r.lga_name, r.postcode].filter(Boolean).join(', '),
        zone: r.zone || '',
        lat: Number(r.centroid_lat),
        lng: Number(r.centroid_lon),
        zoom: 17,
        source: 'local',
      }))
  } catch {
    return []
  }
}

/** Mapbox Geocoding v6 — the fallback, and what covers streets, suburbs and postcodes. */
async function fetchMapboxAddr(q: string): Promise<AddrResult[]> {
  if (!mapboxToken) return []
  const params = new URLSearchParams({
    q,
    access_token: mapboxToken,
    country: 'au',
    limit: '6',
    autocomplete: 'true',
    types: 'address,street,neighborhood,locality,postcode,place',
  })
  // Bias toward what the user is looking at
  if (map) {
    const c = map.getCenter()
    params.set('proximity', `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`)
  }

  const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`)
  if (!res.ok) throw new Error(`geocoder returned ${res.status}`)
  const data = await res.json()

  return (data.features || [])
    .map((f: any, i: number): AddrResult | null => {
      const p = f.properties || {}
      const [lng, lat] = f.geometry?.coordinates || []
      if (lng == null || lat == null) return null
      return {
        id: `mb-${p.mapbox_id || i}`,
        address: p.name || p.full_address || '',
        context: (p.place_formatted || '').replace(/, Australia$/, ''),
        zone: '',
        lat: Number(lat),
        lng: Number(lng),
        zoom: MAPBOX_ZOOM[p.feature_type] ?? 15,
        source: 'mapbox',
      }
    })
    .filter(Boolean) as AddrResult[]
}

async function fetchAddr(q: string) {
  try {
    // Property DB first — it knows the zone. Mapbox covers everything else.
    const local = await fetchLocalAddr(q)
    const results = local.length ? local : await fetchMapboxAddr(q)
    if (q !== addr.value.trim()) return   // a newer keystroke already won
    addrResults.value = results
    addrNote.value = results.length ? '' : 'No matching address'
  } catch {
    addrResults.value = []
    addrNote.value = 'Address lookup unavailable'
  }
}

function dismissAddr() {
  setTimeout(() => { addrResults.value = []; addrNote.value = '' }, 200)
}

function clearAddr() {
  addr.value = ''
  addrResults.value = []
  addrNote.value = ''
  addrMarker?.remove()
  addrMarker = null
}

function selectAddr(r: AddrResult) {
  addr.value = r.address
  addrResults.value = []
  addrNote.value = ''
  if (!map) return

  addrMarker?.remove()
  addrMarker = new mapboxgl.Marker({ color: '#15803d', scale: 0.8 })
    .setLngLat([r.lng, r.lat])
    .setPopup(new mapboxgl.Popup({ offset: 22, maxWidth: '260px' }).setHTML(
      `<div class="pp">
        <div class="pp-title">${esc(r.address)}</div>
        <div class="pp-more">${esc(r.context)}${r.zone ? ' · zone ' + esc(r.zone) : ''}</div>
      </div>`
    ))
    .addTo(map)
  addrMarker.togglePopup()

  map.flyTo({ center: [r.lng, r.lat], zoom: r.zoom, duration: 1200 })
}

// ── Measurement ─────────────────────────────────────────────────────────────

type MeasureMode = 'distance' | 'area'

const MEASURE_SRC = 'measure'
const MEASURE_COLOR = '#b45309'
const MEASURE_LAYERS = ['measure::fill', 'measure::line', 'measure::points', 'measure::labels']

const measureMode = ref<MeasureMode | null>(null)
const measuring = ref(false)
const measurePoints = ref<[number, number][]>([])
const measureHover = ref<[number, number] | null>(null)

const minPoints = computed(() => (measureMode.value === 'area' ? 3 : 2))

/** Points drawn right now — committed vertices plus the cursor while drawing. */
const livePoints = computed<[number, number][]>(() =>
  measuring.value && measureHover.value && measurePoints.value.length
    ? [...measurePoints.value, measureHover.value]
    : measurePoints.value
)

// Geodesic maths lives in shared/geo-measure.mjs: the property report offers
// the same measuring tool, and the two must agree to the metre.
// `ringArea` there is the spherical excess method (Chamberlain & Duquette)
// that turf.js uses.

const measureTotal = computed(() => {
  const pts = livePoints.value
  if (measureMode.value === 'area') return pts.length < 3 ? '' : fmtArea(ringArea(pts))
  return pts.length < 2 ? '' : fmtDistance(pathLength(pts))
})

const measureSecondary = computed(() => {
  const pts = livePoints.value
  if (measureMode.value === 'area') {
    if (pts.length < 3) return ''
    return `${Math.round(ringArea(pts)).toLocaleString()} m² · perimeter ${fmtDistance(pathLength([...pts, pts[0]!]))}`
  }
  if (pts.length < 2) return ''
  return `${pts.length - 1} segment${pts.length > 2 ? 's' : ''}`
})

function ensureMeasureLayers() {
  if (!map || map.getSource(MEASURE_SRC)) return
  map.addSource(MEASURE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

  map.addLayer({
    id: 'measure::fill',
    type: 'fill',
    source: MEASURE_SRC,
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': MEASURE_COLOR, 'fill-opacity': 0.15 },
  })
  map.addLayer({
    id: 'measure::line',
    type: 'line',
    source: MEASURE_SRC,
    filter: ['==', '$type', 'LineString'],
    paint: { 'line-color': MEASURE_COLOR, 'line-width': 2.2, 'line-dasharray': [2, 1] },
  })
  map.addLayer({
    id: 'measure::points',
    type: 'circle',
    source: MEASURE_SRC,
    filter: ['all', ['==', '$type', 'Point'], ['!has', 'label']],
    paint: {
      'circle-radius': 4,
      'circle-color': '#ffffff',
      'circle-stroke-color': MEASURE_COLOR,
      'circle-stroke-width': 2,
    },
  })
  map.addLayer({
    id: 'measure::labels',
    type: 'symbol',
    source: MEASURE_SRC,
    filter: ['all', ['==', '$type', 'Point'], ['has', 'label']],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0, -0.9],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#7c2d12', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
  })
}

function renderMeasure() {
  const src = map?.getSource(MEASURE_SRC)
  if (!src) return

  const pts = livePoints.value
  const closed = measureMode.value === 'area' && pts.length >= 3
  const seq: [number, number][] = closed ? [...pts, pts[0]!] : pts
  const features: any[] = []

  if (seq.length >= 2) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: seq } })
  }
  if (closed) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [seq] } })
  }
  for (const p of measurePoints.value) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })
  }
  // Per-segment length labels at segment midpoints
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!
    const b = seq[i]!
    features.push({
      type: 'Feature',
      properties: { label: fmtDistance(haversine(a, b)) },
      geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
    })
  }

  src.setData({ type: 'FeatureCollection', features })
}

function setMeasureCursor(on: boolean) {
  if (!map) return
  map.getCanvas().style.cursor = on ? 'crosshair' : ''
  if (on) map.doubleClickZoom.disable()
  else map.doubleClickZoom.enable()
}

function toggleMeasure(mode: MeasureMode) {
  if (measuring.value && measureMode.value === mode) { finishMeasure(); return }
  clearMeasure()
  measureMode.value = mode
  measuring.value = true
  popup?.remove()
  setMeasureCursor(true)
}

function finishMeasure() {
  if (!measuring.value) return
  measuring.value = false
  measureHover.value = null
  setMeasureCursor(false)

  // A double-click leaves a duplicate vertex behind — drop it.
  const pts = measurePoints.value
  if (pts.length >= 2 && haversine(pts[pts.length - 1]!, pts[pts.length - 2]!) < 0.5) {
    measurePoints.value = pts.slice(0, -1)
  }
  if (measurePoints.value.length < minPoints.value) clearMeasure()
  else renderMeasure()
}

function clearMeasure() {
  measuring.value = false
  measureMode.value = null
  measurePoints.value = []
  measureHover.value = null
  setMeasureCursor(false)
  renderMeasure()
}

function onMeasureMove(e: any) {
  if (!measuring.value || !measurePoints.value.length) return
  measureHover.value = [e.lngLat.lng, e.lngLat.lat]
  renderMeasure()
}

function onMeasureDblClick(e: any) {
  if (!measuring.value) return
  e.preventDefault?.()
  finishMeasure()
}

function onMeasureKey(e: KeyboardEvent) {
  if (!measuring.value) return
  if (e.key === 'Enter') { e.preventDefault(); finishMeasure() }
  else if (e.key === 'Escape') { e.preventDefault(); clearMeasure() }
}

// ── Feature inspection ──────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"]/g, c => HTML_ESCAPES[c]!)
}

/** Identifying fields worth seeing before the long tail of metrics. */
const PRIORITY_KEYS = [
  'address', 'lotnumber', 'sectionnumber', 'planlabel', 'plannumber', 'lotidstring',
  'cadid', 'objectid', 'ogc_fid',
  'label', 'zone', 'sym_code', 'purpose', 'lay_class',
  'epi_name', 'epi_type', 'lga_name', 'suburbname', 'postcode',
]

/** Every attribute the tile carries — identity first, then the rest alphabetically.
 *  Layers like lot_metrics_3 publish 50+ columns, so ordering beats source order. */
function orderProps(props: Record<string, unknown>): [string, unknown][] {
  const rank = (k: string) => {
    const i = PRIORITY_KEYS.indexOf(k.toLowerCase())
    return i === -1 ? PRIORITY_KEYS.length : i
  }
  return Object.entries(props).sort(
    (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])
  )
}

function fmtValue(v: unknown) {
  if (v === null || v === undefined || v === '') return '—'
  // float8 metrics arrive with a full mantissa; 4 decimals is plenty on screen.
  if (typeof v === 'number' && !Number.isInteger(v)) return String(Number(v.toFixed(4)))
  return String(v)
}

/** Fields each layer publishes, from its TileJSON. A vector tile omits null
 *  properties per feature, so without this an empty column looks like a missing
 *  one. Fetched once per layer, on first inspection. */
const tileFields = new Map<string, string[]>()

async function loadTileFields(id: string): Promise<string[]> {
  const cached = tileFields.get(id)
  if (cached) return cached
  let fields: string[] = []
  try {
    const tj = await (await fetch(`${martinUrl}/${encodeURIComponent(id)}`)).json()
    fields = Object.keys(tj?.vector_layers?.[0]?.fields || {})
  } catch { /* fall back to whatever the feature carries */ }
  tileFields.set(id, fields)
  return fields
}

function activeRenderLayerIds(): string[] {
  const ids: string[] = []
  for (const id of active.value) {
    for (const lid of [fillId(id), lineId(id), circleId(id)]) {
      if (map.getLayer(lid)) ids.push(lid)
    }
  }
  return ids
}

function onMapClick(e: any) {
  if (measuring.value) {
    measurePoints.value = [...measurePoints.value, [e.lngLat.lng, e.lngLat.lat]]
    renderMeasure()
    return
  }

  const ids = activeRenderLayerIds()
  if (!ids.length) return
  const feats = map.queryRenderedFeatures(e.point, { layers: ids })
  if (!feats.length) { popup?.remove(); return }

  const f = feats[0]
  const others = [...new Set(feats.slice(1).map((x: any) => x.sourceLayer))].filter(Boolean)

  const seq = ++popupSeq
  renderFeaturePopup(f, others, e.lngLat)

  // Field list may not be cached yet — redraw once it lands, if this popup still stands.
  if (!tileFields.has(f.sourceLayer)) {
    loadTileFields(f.sourceLayer).then(() => {
      if (seq === popupSeq) renderFeaturePopup(f, others, e.lngLat)
    })
  }
}

let popupSeq = 0

function renderFeaturePopup(f: any, others: string[], lngLat: any) {
  // Every published field, not just the ones this feature happens to carry.
  const props: Record<string, unknown> = { ...(f.properties || {}) }
  for (const k of tileFields.get(f.sourceLayer) || []) {
    if (!(k in props)) props[k] = null
  }

  const entries = orderProps(props)
  const empty = entries.filter(([, v]) => v === null || v === undefined || v === '').length

  const rows = entries.length
    ? entries.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(fmtValue(v))}</td></tr>`).join('')
    : '<tr><td colspan="2" class="pp-none">No attributes</td></tr>'

  popup!
    .setLngLat(lngLat)
    .setHTML(
      `<div class="pp">
        <div class="pp-title">${esc(f.sourceLayer)}</div>
        <div class="pp-count">${entries.length} attribute${entries.length === 1 ? '' : 's'}${empty ? ` · ${empty} empty` : ''}</div>
        <div class="pp-scroll"><table class="pp-table">${rows}</table></div>
        ${others.length ? `<div class="pp-more">also here: ${others.map(esc).join(', ')}</div>` : ''}
      </div>`
    )
    .addTo(map)
}

// ── Init ────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadCatalog()
  if (!mapboxToken) return

  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken

  map = new mapboxgl.Map({
    container: mapEl.value!,
    style: BASEMAP_STYLES[basemap.value],
    center: [151.2093, -33.8688],   // Sydney
    zoom: 12,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

  popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '400px' })
  if (import.meta.dev) (window as any).__map = map

  map.on('click', onMapClick)
  map.on('mousemove', onMeasureMove)
  map.on('dblclick', onMeasureDblClick)
  window.addEventListener('keydown', onMeasureKey)
  map.on('dataloading', () => { if (active.value.length) status.value = 'Loading tiles…' })
  map.on('idle', () => { if (status.value === 'Loading tiles…') status.value = '' })
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (msg && !/aborted/i.test(msg)) flash(msg.slice(0, 120))
  })

  await new Promise<void>((resolve) => {
    if (map.isStyleLoaded()) resolve()
    else map.once('load', () => resolve())
  })

  ensureMeasureLayers()

  // Restore whatever the URL asked for
  const wanted = layersFromUrl()
  if (wanted.length) {
    for (const id of wanted) {
      const l = layerById.value.get(id)
      if (l) { addToMap(l); active.value = [...active.value, id] }
    }
    restack()
  }
})

onBeforeUnmount(() => {
  clearTimeout(flashTimer)
  if (addrDebounce) clearTimeout(addrDebounce)
  window.removeEventListener('keydown', onMeasureKey)
  map?.remove()
  map = null
})
</script>

<style>
/* Popup internals are rendered by Mapbox GL, so these can't be scoped. */
.mapboxgl-popup-content {
  padding: 0.6rem 0.7rem;
  border-radius: 10px;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.18);
}
.mapboxgl-popup-close-button {
  width: 22px; height: 22px; padding: 0;
  font-size: 15px; line-height: 1; color: #94a3b8;
  border-radius: 0 10px 0 6px;
}
.mapboxgl-popup-close-button:hover { background: #f1f5f9; color: #0f172a; }
.pp-title {
  font-size: 0.72rem; font-weight: 700; color: #15803d;
  padding-right: 1rem;
  text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.4rem;
}
.pp-count {
  font-size: 0.62rem; color: #94a3b8; margin: -0.25rem 0 0.35rem;
}
.pp-scroll { max-height: 340px; overflow-y: auto; overscroll-behavior: contain; }
.pp-table { border-collapse: collapse; width: 100%; font-size: 0.72rem; }
.pp-table th {
  text-align: left; font-weight: 600; color: #94a3b8; padding: 0.12rem 0.5rem 0.12rem 0;
  vertical-align: top; overflow-wrap: anywhere; min-width: 9.5rem;
}
.pp-table td { color: #1e293b; padding: 0.12rem 0; word-break: break-word; }
.pp-none { color: #94a3b8; }
.pp-more { margin-top: 0.4rem; font-size: 0.66rem; color: #94a3b8; }
</style>

<style scoped>
.map-page {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Figtree", "Segoe UI", system-ui, sans-serif;
  color: #0f172a;
}

/* ── Panel ──────────────────────────────────────────────────────────────── */
.panel {
  width: 320px;
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e2e8f0;
  z-index: 2;
}
.panel--collapsed { display: none; }

.panel-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 0.5rem; padding: 0.9rem 0.9rem 0.6rem;
}
.panel-title { font-size: 1rem; font-weight: 800; margin: 0; }
.panel-sub { font-size: 0.72rem; color: #64748b; margin: 0.15rem 0 0; }

.panel-controls {
  padding: 0 0.9rem 0.7rem;
  border-bottom: 1px solid #e2e8f0;
  display: flex; flex-direction: column; gap: 0.55rem;
}
.search-input {
  width: 100%; padding: 0.45rem 0.6rem;
  border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 0.8rem; font-family: inherit; outline: none;
}
.search-input:focus { border-color: #15803d; }

.chip-row { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.22rem 0.5rem; border-radius: 999px;
  border: 1px solid #e2e8f0; background: #fff;
  font-size: 0.7rem; font-family: inherit; color: #64748b; cursor: pointer;
}
.chip--on { border-color: #15803d; color: #15803d; background: #f0fdf4; }
.chip-count { font-weight: 700; opacity: 0.7; }

.active-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.active-count { font-size: 0.7rem; color: #64748b; }
.active-actions { display: flex; gap: 0.5rem; }
.text-btn {
  border: none; background: none; padding: 0; cursor: pointer;
  font-size: 0.7rem; font-family: inherit; font-weight: 600; color: #15803d;
}
.text-btn:disabled { color: #cbd5e1; cursor: default; }

.opacity-row { display: flex; align-items: center; gap: 0.45rem; }
.opacity-label { font-size: 0.68rem; color: #94a3b8; white-space: nowrap; }
.opacity-slider { flex: 1; accent-color: #15803d; }
.opacity-value { font-size: 0.68rem; color: #64748b; width: 2.2rem; text-align: right; }

.warn {
  margin: 0; font-size: 0.68rem; color: #b45309;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 0.35rem 0.45rem;
}

/* ── Layer list ─────────────────────────────────────────────────────────── */
.layer-list { flex: 1; overflow-y: auto; padding: 0.35rem 0.5rem 1rem; }
.empty { font-size: 0.75rem; color: #94a3b8; padding: 0.6rem 0.4rem; }

.layer-row {
  display: flex; align-items: center; gap: 0.25rem;
  border-radius: 6px; padding: 0.05rem 0.2rem;
}
.layer-row:hover { background: #f8fafc; }
.layer-row--on { background: #f0fdf4; }

.layer-main {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.28rem 0.15rem; cursor: pointer;
}
.layer-main input { accent-color: #15803d; flex: 0 0 auto; margin: 0; }
.swatch { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
.layer-text { min-width: 0; display: flex; flex-direction: column; }
.layer-name {
  font-size: 0.76rem; color: #1e293b;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.layer-row--on .layer-name { font-weight: 600; }
.layer-meta { font-size: 0.62rem; color: #94a3b8; }

.icon-btn {
  border: none; background: none; cursor: pointer;
  color: #94a3b8; font-size: 1rem; line-height: 1; padding: 0.2rem 0.3rem;
}
.icon-btn:hover { color: #15803d; }
.icon-btn--sm { font-size: 0.8rem; }

.panel-open {
  position: absolute; top: 0.75rem; left: 0.75rem; z-index: 3;
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.45rem 0.7rem; border-radius: 8px;
  border: 1px solid #e2e8f0; background: #fff; cursor: pointer;
  font-family: inherit; font-size: 0.78rem; font-weight: 600;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.panel-open-count {
  background: #15803d; color: #fff; border-radius: 999px;
  padding: 0.02rem 0.35rem; font-size: 0.66rem;
}

/* ── Map ────────────────────────────────────────────────────────────────── */
.map-wrap { position: relative; flex: 1; min-width: 0; }
.map { position: absolute; inset: 0; }

.map-controls {
  position: absolute; bottom: 1.6rem; right: 0.75rem; z-index: 2;
  display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem;
}

.basemap-switch {
  display: flex; border-radius: 8px; overflow: hidden;
  border: 1px solid #e2e8f0; background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}

/* ── Measurement ────────────────────────────────────────────────────────── */
.measure-control {
  display: flex; border-radius: 8px; overflow: hidden;
  border: 1px solid #e2e8f0; background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.measure-btn {
  border: none; background: none; cursor: pointer;
  padding: 0.35rem 0.6rem; font-family: inherit; font-size: 0.7rem; color: #64748b;
}
.measure-btn + .measure-btn { border-left: 1px solid #e2e8f0; }
.measure-btn--on { background: #fffbeb; color: #b45309; font-weight: 600; }
.measure-btn--clear { color: #94a3b8; }
.measure-btn--clear:hover { color: #b45309; }

.measure-readout {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 0.45rem 0.65rem; text-align: right; max-width: 260px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.measure-value { font-size: 1rem; font-weight: 800; color: #b45309; line-height: 1.2; }
.measure-secondary { font-size: 0.68rem; color: #64748b; margin-top: 0.1rem; }
.measure-hint { font-size: 0.64rem; color: #94a3b8; margin-top: 0.2rem; }
.basemap-btn {
  border: none; background: none; cursor: pointer;
  padding: 0.35rem 0.6rem; font-family: inherit; font-size: 0.7rem; color: #64748b;
}
.basemap-btn + .basemap-btn { border-left: 1px solid #e2e8f0; }
.basemap-btn--on { background: #f0fdf4; color: #15803d; font-weight: 600; }

/* ── Address search ─────────────────────────────────────────────────────── */
.map-search {
  position: absolute; top: 0.75rem; left: 0.75rem; z-index: 3;
  width: 340px; max-width: calc(100% - 1.5rem);
}
.map-search--shifted { left: 7.5rem; }

.map-search-box {
  display: flex; align-items: center; gap: 0.45rem;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 0.45rem 0.6rem;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.map-search-box:focus-within { border-color: #15803d; }
.map-search-icon { color: #94a3b8; flex: 0 0 auto; }
.map-search-input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 0.8rem; color: #0f172a;
}
.map-search-clear {
  border: none; background: none; cursor: pointer;
  color: #94a3b8; font-size: 1.1rem; line-height: 1; padding: 0 0.15rem;
}
.map-search-clear:hover { color: #15803d; }

.map-search-drop {
  margin-top: 0.3rem; background: #fff;
  border: 1px solid #e2e8f0; border-radius: 8px;
  max-height: 320px; overflow-y: auto;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
}
.map-search-note { margin: 0; padding: 0.5rem 0.65rem; font-size: 0.72rem; color: #94a3b8; }
.map-search-item {
  display: flex; flex-direction: column; gap: 0.05rem;
  width: 100%; text-align: left; border: none; background: none;
  cursor: pointer; padding: 0.4rem 0.65rem; font-family: inherit;
}
.map-search-item:hover,
.map-search-item--active { background: #f0fdf4; }
.map-search-main { font-size: 0.76rem; color: #1e293b; }
.map-search-tag {
  margin-left: 0.35rem; padding: 0.02rem 0.28rem; border-radius: 4px;
  background: #f1f5f9; color: #94a3b8;
  font-size: 0.58rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;
  vertical-align: middle;
}
.map-search-context { font-size: 0.66rem; color: #94a3b8; }

.status-chip {
  position: absolute; bottom: 1.6rem; left: 50%; transform: translateX(-50%);
  z-index: 3; background: rgba(15, 23, 42, 0.85); color: #fff;
  padding: 0.3rem 0.7rem; border-radius: 999px; font-size: 0.7rem;
  max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

@media (max-width: 720px) {
  .panel { position: absolute; inset: 0 auto 0 0; width: 85vw; flex-basis: 85vw; }
}
</style>
