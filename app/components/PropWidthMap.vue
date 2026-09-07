<template>
  <div class="pw-page">
    <!-- ── Detail panel ──────────────────────────────────────────────────── -->
    <aside class="panel" :class="{ 'panel--collapsed': collapsed }">
      <div class="panel-head">
        <div>
          <h1 class="panel-title">{{ title }}</h1>
          <p class="panel-sub">{{ subtitle }}</p>
        </div>
        <button class="icon-btn" title="Collapse panel" @click="collapsed = true">‹</button>
      </div>

      <div class="panel-controls">
        <div class="toggle-list">
          <label v-for="t in TOGGLES" :key="t.key" class="toggle">
            <input v-model="show[t.key]" type="checkbox">
            <span class="swatch" :style="swatchStyle(t)" />
            <span class="toggle-text">
              <span class="toggle-name">{{ t.label }}</span>
              <span class="toggle-meta">{{ t.meta }}</span>
            </span>
          </label>
        </div>

        <div class="opacity-row">
          <label class="opacity-label">Lot fill</label>
          <input v-model.number="fillOpacity" type="range" min="0" max="0.6" step="0.02" class="opacity-slider">
          <span class="opacity-value">{{ Math.round(fillOpacity * 100) }}%</span>
        </div>

        <p v-if="!hasToken" class="warn">
          No Mapbox token — set NUXT_PUBLIC_MAPBOX_TOKEN in .env, then restart the dev server.
        </p>
        <p v-else-if="zoom < LOT_MIN_ZOOM" class="warn">
          Zoom in to z{{ LOT_MIN_ZOOM }} to load lots — you are at z{{ zoom.toFixed(1) }}.
        </p>
        <p v-else-if="capped" class="warn">
          {{ lotsInView.toLocaleString() }} lots in view — too many to label. Zoom in for frontage lines.
        </p>
        <p v-if="roadTilesBroken" class="note">
          Some road names show without their street type — the tile server cannot
          render <code>road_segments</code> here (mixed 2D/3D geometry).
        </p>
      </div>

      <!-- Selected lot -->
      <div class="detail">
        <p v-if="!selected" class="empty">
          Click a lot to see its frontages.
          <span v-if="zoom < PROP_MIN_ZOOM" class="empty-note">
            Addresses load from z{{ PROP_MIN_ZOOM }}.
          </span>
        </p>

        <template v-else>
          <div class="detail-head">
            <h2 class="detail-title">
              {{ selected.lotLabel }}
            </h2>
            <button class="icon-btn icon-btn--sm" title="Clear selection" @click="clearSelection">×</button>
          </div>
          <p v-if="selected.addresses.length" class="detail-addr">
            {{ selected.addresses[0] }}
            <span v-if="selected.addresses.length > 1" class="detail-more">
              +{{ selected.addresses.length - 1 }} more on this lot
            </span>
          </p>
          <p v-else class="detail-addr detail-addr--none">
            No address on this lot<span v-if="zoom < PROP_MIN_ZOOM"> at this zoom</span>
          </p>

          <!-- Frontages: the point of the page -->
          <h3 class="detail-section">
            Frontages
            <span class="detail-section-count">{{ selected.frontages.length }}</span>
          </h3>
          <p class="detail-hint">
            As recorded in <code>all_frontages</code>. The source does not say which
            boundary edge each one is, so the map labels every edge with its own
            recorded length instead.
          </p>
          <p v-if="!selected.frontages.length" class="detail-none">
            No frontage recorded for this lot.
          </p>
          <ul v-else class="frontage-list">
            <li
              v-for="(f, i) in selected.frontages"
              :key="i"
              class="frontage"
              :class="{ 'frontage--primary': f.primary }"
            >
              <span class="frontage-bar" />
              <span class="frontage-body">
                <span class="frontage-road">{{ f.display }}</span>
                <span class="frontage-len">{{ f.length.toFixed(2) }} m</span>
                <span class="frontage-tag">
                  <template v-if="f.primary">primary</template>
                  <template v-else>frontage {{ i + 1 }}</template>
                </span>
              </span>
            </li>
          </ul>

          <h3 class="detail-section">Lot</h3>
          <table class="detail-table">
            <tbody>
              <tr v-for="row in selected.rows" :key="row[0]">
                <th>{{ row[0] }}</th>
                <td>{{ row[1] }}</td>
              </tr>
            </tbody>
          </table>

          <h3 v-if="selected.edges.length" class="detail-section">
            Boundary edges
            <span class="detail-section-count">{{ selected.edges.length }}</span>
          </h3>
          <ul v-if="selected.edges.length" class="edge-list">
            <li v-for="e in selected.edges" :key="e.index" class="edge">
              <span class="edge-idx">{{ e.index }}</span>
              <span class="edge-len">{{ e.length.toFixed(2) }} m</span>
              <span class="edge-bearing">{{ Math.round(e.bearing) }}°</span>
            </li>
          </ul>
        </template>
      </div>
    </aside>

    <button v-if="collapsed" class="panel-open" @click="collapsed = false">Details</button>

    <!-- ── Map ───────────────────────────────────────────────────────────── -->
    <div class="map-wrap">
      <div ref="mapEl" class="map" />

      <div class="map-search" :class="{ 'map-search--shifted': collapsed }">
        <div class="map-search-box">
          <svg class="map-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input
            v-model="addr"
            type="text"
            class="map-search-input"
            placeholder="Find an address — e.g. 15 Smith Street, Hornsby"
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
import { martinTileBase } from '#shared/martin'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  parseFrontages, roadLabel,
} from '#shared/frontage.mjs'
import { useMeasure } from '~/composables/useMeasure'
import type { LotRow } from '#shared/prop-width-variants'
import { pathLength } from '#shared/geo-measure.mjs'

/**
 * One lot, its frontage lengths, and the road each one faces.
 *
 * Deliberately not the tile catalog that /map is — this page draws four fixed
 * layers and joins them, which is a different job from browsing 441 of them.
 *
 * The join is `objectid`, which every one of these layers carries and which
 * lines up exactly: in a z17 tile over Randwick all 359 up_property_d_3 points
 * matched a lot_metrics_3 polygon and a lot polygon. Note the property layer
 * is many-to-one against the lot — a strata plan puts every unit's point on
 * the same parcel — which is why addresses are collected into a list rather
 * than treated as the lot's single address.
 *
 * up_property_d_3 itself has no polygon: every feature in it is a Point, in
 * every tile sampled across both councils at z14-z18. The parcel outline comes
 * from lot_metrics_3, which is the same cadastral geometry with the frontage
 * metrics already attached — one source instead of a polygon layer plus an
 * attribute layer.
 */

const BASEMAP_IDS = ['streets', 'light', 'satellite'] as const
type BasemapId = typeof BASEMAP_IDS[number]

const BASEMAP_STYLES: Record<BasemapId, string> = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  light: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
}

/**
 * Zoom floors, set by how heavy each layer's tiles actually are.
 *
 * Martin publishes every column of up_property_d_3 in the tile — ~170 fields
 * per feature — so one z16 tile is 843 KB and one z14 tile is 20 MB. It cannot
 * be asked for at the same zoom as the others. lot_metrics_3 carries ~55
 * fields and costs 111 KB at z16, 636 KB at z15.
 */
const LOT_MIN_ZOOM = 15
const PROP_MIN_ZOOM = 16

/**
 * Above this many lots in view, the frontage lines are not built.
 *
 * Each lot means parsing its frontages, gathering its edges and matching them.
 * At z15 a single tile holds ~1,400 lots, so a full viewport is well past the
 * point where doing that on every pan is worth it — and the labels would be
 * unreadable anyway. Polygons still draw; only the labelling stops.
 */
const MAX_LABELLED_LOTS = 3000

const SRC = {
  lots: 'pw-lots',
  edges: 'pw-edges',
  roads: 'pw-roads',
  props: 'pw-props',
  cadastre: 'pw-cadastre',
}

const props = defineProps<{
  /** Martin layer holding the lot polygons and their metrics. */
  lotLayer: string
  /** Martin layer holding one LineString per boundary edge of those lots. */
  edgeLayer: string
  title: string
  subtitle: string
  /** Which of the lot layer's fields the detail table shows, in order. */
  rows: LotRow[]
}>()

const LAYER_ID = computed(() => props.lotLayer)
const EDGE_LAYER_ID = computed(() => props.edgeLayer)
const ROAD_LAYER_ID = 'road_segments'
const PROP_LAYER_ID = 'up_property_d_3'
const CADASTRE_LAYER_ID = 'lot'

const COLOR = {
  lot: '#2563eb',
  frontage: '#dc2626',
  frontageSecondary: '#ea580c',
  edges: '#94a3b8',
  props: '#15803d',
  cadastre: '#a855f7',
  roads: '#0ea5e9',
}

type ToggleKey = 'lots' | 'frontage' | 'edges' | 'props' | 'cadastre' | 'roads'

const TOGGLES: { key: ToggleKey, label: string, meta: string, color: string, kind: 'fill' | 'line' | 'dot' }[] = [
  { key: 'lots', label: 'Lot boundaries', meta: `${props.lotLayer} · z${LOT_MIN_ZOOM}+`, color: COLOR.lot, kind: 'fill' },
  { key: 'frontage', label: 'Frontage road + length', meta: 'primary_frontage_* on the lot', color: COLOR.frontage, kind: 'dot' },
  { key: 'props', label: 'Property points', meta: `up_property_d_3 · z${PROP_MIN_ZOOM}+`, color: COLOR.props, kind: 'dot' },
  { key: 'edges', label: 'Boundary edges + lengths', meta: `${props.edgeLayer} · edge_length_m`, color: COLOR.edges, kind: 'line' },
  { key: 'cadastre', label: 'Raw cadastre lot', meta: 'lot', color: COLOR.cadastre, kind: 'line' },
  { key: 'roads', label: 'Road centrelines', meta: 'road_segments', color: COLOR.roads, kind: 'line' },
]

const config = useRuntimeConfig()
const martinUrl = martinTileBase(String((config.public as any).martinUrl || ''))
const mapboxToken = String((config.public as any).mapboxToken || '')
const hasToken = computed(() => !!mapboxToken)

const mapEl = ref<HTMLElement | null>(null)
const collapsed = ref(false)
const basemap = ref<BasemapId>('light')
const fillOpacity = ref(0.12)
const zoom = ref(0)
const status = ref('')
const capped = ref(false)
const lotsInView = ref(0)

/**
 * The tile server cannot render road_segments over much of this area.
 *
 * `GET /road_segments/16/60299/39339` answers 500 with
 * "lwcollection_construct: mixed dimension geometries: 2/0" — the table mixes
 * 2D and 3D geometries, and PostGIS refuses to collect them into one tile. It
 * reproduces at z14, z15 and z16 on several tiles over both Randwick and
 * Hornsby while lot_metrics_3 serves the same tiles fine, so it is that
 * table's data rather than anything this page asks for. Fixing it means
 * ST_Force2D on the column in the tile database.
 *
 * The only thing it costs here is the street type, so the page says so and
 * falls back to the bare name stem rather than failing.
 */
const roadTilesBroken = ref(false)

function isRoadTileError(e: any): boolean {
  if (e?.sourceId === SRC.roads) return true
  return /road_segments/.test(String(e?.error?.message || ''))
}

const show = reactive<Record<ToggleKey, boolean>>({
  lots: true, frontage: true, props: true, edges: true, cadastre: false, roads: false,
})

let map: any = null
let mapboxgl: any = null

// The same tool /map offers, from the same composable, so the two agree.
const {
  measureMode, measuring, measurePoints, minPoints, measureTotal, measureSecondary,
  ensureMeasureLayers, renderMeasure, restackMeasure,
  toggleMeasure, clearMeasure,
  handleMeasureClick, onMeasureMove, onMeasureDblClick, onMeasureKey,
} = useMeasure(() => map)

function swatchStyle(t: typeof TOGGLES[number]) {
  if (t.kind === 'dot') return { background: t.color, borderRadius: '50%' }
  if (t.kind === 'line') return { background: t.color, height: '3px', borderRadius: '2px' }
  return { background: t.color, opacity: 0.35, border: `1.5px solid ${t.color}` }
}

// ── Frontage geometry ───────────────────────────────────────────────────────

interface LotEdge {
  index: number
  length: number
  coords: [number, number][]
  bearing: number
}

/** One entry of `all_frontages`, as recorded. */
interface MatchedFrontage {
  road: string
  display: string
  length: number
  primary: boolean
}

interface SelectedLot {
  objectid: number
  lotLabel: string
  addresses: string[]
  frontages: MatchedFrontage[]
  edges: { index: number, length: number, bearing: number }[]
  rows: [string, string][]
}

const selected = ref<SelectedLot | null>(null)

/** objectid -> the lot's tile properties, rebuilt on every viewport change. */
let lotProps = new Map<number, any>()
/** objectid -> its boundary edges, deduplicated across tiles. */
let lotEdges = new Map<number, { index: number, length: number, coords: [number, number][], bearing: number }[]>()
/** objectid -> the addresses of the property points sitting on it. */
let lotAddresses = new Map<number, string[]>()

/**
 * A vector tile clips features at its edge, so the same edge arrives once per
 * tile it touches and each copy may be a fragment. The copy to keep is the one
 * whose drawn length is closest to the recorded `edge_length_m` — an unclipped
 * copy measures the full edge, a clipped one always measures short.
 *
 * Vertex count was the obvious proxy and is the wrong one: a two-point edge is
 * complete, and a clipped copy of a curved edge can carry more points than the
 * whole of a straight one. Measured against single tiles, clipping left 4.8%
 * of frontage lines drawn noticeably short; picking by length is what lets the
 * neighbouring tile's intact copy win.
 */
function collectEdges(feats: any[]) {
  const byKey = new Map<string, any>()
  for (const f of feats) {
    const p = f.properties || {}
    const oid = Number(p.objectid)
    const idx = Number(p.edge_index)
    if (!Number.isFinite(oid) || !Number.isFinite(idx)) continue
    const coords = lineCoords(f.geometry)
    if (coords.length < 2) continue
    const length = Number(p.edge_length_m) || 0
    const error = Math.abs(pathLength(coords) - length)
    const key = `${oid}|${idx}`
    const prev = byKey.get(key)
    if (!prev || error < prev.error) {
      byKey.set(key, {
        objectid: oid,
        index: idx,
        length,
        bearing: Number(p.edge_orientation_degrees) || 0,
        coords,
        error,
      })
    }
  }

  const out = new Map<number, any[]>()
  for (const e of byKey.values()) {
    const list = out.get(e.objectid)
    if (list) list.push(e)
    else out.set(e.objectid, [e])
  }
  for (const list of out.values()) list.sort((a, b) => a.index - b.index)
  return out
}

/** MultiLineString shows up when a tile boundary splits an edge in two. */
function lineCoords(geom: any): [number, number][] {
  if (!geom) return []
  if (geom.type === 'LineString') return geom.coordinates as [number, number][]
  if (geom.type === 'MultiLineString') {
    let best: any[] = []
    for (const part of geom.coordinates) if (part.length > best.length) best = part
    return best as [number, number][]
  }
  return []
}

/** roadnamebase -> the centrelines carrying it, for recovering the street type. */
function collectRoads(feats: any[]) {
  const seen = new Set<number>()
  const out = new Map<string, { type: string, coords: [number, number][] }[]>()
  for (const f of feats) {
    const p = f.properties || {}
    const oid = Number(p.objectid)
    if (seen.has(oid)) continue
    seen.add(oid)
    const base = String(p.roadnamebase || '').toUpperCase()
    if (!base) continue
    const coords = lineCoords(f.geometry)
    if (!coords.length) continue
    const list = out.get(base)
    const entry = { type: String(p.roadnametype || ''), coords }
    if (list) list.push(entry)
    else out.set(base, [entry])
  }
  return out
}

function collectAddresses(feats: any[]) {
  const out = new Map<number, string[]>()
  const seen = new Set<string>()
  for (const f of feats) {
    const p = f.properties || {}
    const oid = Number(p.objectid)
    const address = String(p.address || '').trim()
    if (!Number.isFinite(oid) || !address) continue
    const key = `${oid}|${address}`
    if (seen.has(key)) continue
    seen.add(key)
    const list = out.get(oid)
    if (list) list.push(address)
    else out.set(oid, [address])
  }
  for (const list of out.values()) list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return out
}

/**
 * Rebuild the frontage lines for whatever is on screen.
 *
 * Driven off `querySourceFeatures` rather than `queryRenderedFeatures`: the
 * road centrelines and the edges have to be readable even when their layers
 * are toggled off, and rendered-feature queries only see what is drawn.
 */
function rebuildFrontages() {
  if (!map || !map.isStyleLoaded()) return

  const z = map.getZoom()
  zoom.value = z

  if (z < LOT_MIN_ZOOM) {
    lotProps = new Map(); lotEdges = new Map(); lotAddresses = new Map()
    capped.value = false
    lotsInView.value = 0
    return
  }

  const lotFeats = safeQuery(SRC.lots, LAYER_ID.value)
  lotProps = new Map()
  for (const f of lotFeats) {
    const oid = Number(f.properties?.objectid)
    if (Number.isFinite(oid) && !lotProps.has(oid)) lotProps.set(oid, f.properties)
  }
  lotsInView.value = lotProps.size

  if (lotProps.size > MAX_LABELLED_LOTS) {
    capped.value = true
    lotEdges = new Map()
    lotAddresses = new Map()
    return
  }
  capped.value = false

  lotEdges = collectEdges(safeQuery(SRC.edges, EDGE_LAYER_ID.value))
  lotAddresses = collectAddresses(safeQuery(SRC.props, PROP_LAYER_ID))
}

/**
 * The lot's frontages exactly as `all_frontages` records them.
 *
 * Split into road and length and nothing else. Which boundary edge each one
 * refers to is not in the data and is not guessed at here — the map draws
 * every edge with its own recorded length instead.
 */
function lotFrontages(props: any): MatchedFrontage[] {
  return parseFrontages(props?.all_frontages).map((f: any, i: number) => ({
    road: f.road,
    display: roadLabel(f.road, null),
    length: f.length,
    primary: i === 0,
  }))
}

function safeQuery(source: string, sourceLayer: string): any[] {
  try {
    if (!map.getSource(source)) return []
    return map.querySourceFeatures(source, { sourceLayer })
  } catch {
    return []
  }
}

// ── Selection ───────────────────────────────────────────────────────────────

function onMapClick(e: any) {
  // A click while measuring is a vertex, not a lot selection.
  if (handleMeasureClick(e)) return
  if (!map.getLayer('pw-lot-fill')) return
  const feats = map.queryRenderedFeatures(e.point, { layers: ['pw-lot-fill'] })
  if (!feats.length) { clearSelection(); return }
  selectLot(Number(feats[0].properties?.objectid))
}

function selectLot(oid: number) {
  if (!Number.isFinite(oid)) { clearSelection(); return }
  const props = lotProps.get(oid)
  if (!props) { clearSelection(); return }

  selected.value = {
    objectid: oid,
    lotLabel: lotLabelOf(props),
    addresses: lotAddresses.get(oid) || [],
    frontages: lotFrontages(props),
    edges: (lotEdges.get(oid) || []).map(e => ({
      index: e.index,
      length: e.length,
      bearing: e.bearing,
    })),
    rows: detailRows(props),
  }

  map.setFilter('pw-lot-selected', ['==', ['get', 'objectid'], oid])
  map.setFilter('pw-edges-selected', ['==', ['get', 'objectid'], oid])
  collapsed.value = false
}

function clearSelection() {
  selected.value = null
  if (!map) return
  if (map.getLayer('pw-lot-selected')) map.setFilter('pw-lot-selected', ['==', ['get', 'objectid'], -1])
  if (map.getLayer('pw-edges-selected')) map.setFilter('pw-edges-selected', ['==', ['get', 'objectid'], -1])
}

function lotLabelOf(p: any) {
  const lot = String(p?.lotnumber ?? '').trim()
  const sec = String(p?.sectionnumber ?? '').trim()
  const plan = String(p?.planlabel ?? '').trim()
  if (!lot && !plan) return `Lot ${p?.objectid ?? '—'}`
  return `Lot ${lot || '—'}${sec ? ` Sec ${sec}` : ''} ${plan}`.trim()
}

function num(v: unknown, unit = '', digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits).replace(/\.?0+$/, '')}${unit}`
}

function detailRows(p: any): [string, string][] {
  return props.rows.map((r): [string, string] => {
    const v = p?.[r.field]
    switch (r.type) {
      case 'road': return [r.label, v ? roadLabel(String(v), null) : '—']
      case 'bool': return [r.label, v ? 'Yes' : 'No']
      case 'text': return [r.label, v == null || v === '' ? '—' : String(v)]
      default: return [r.label, num(v, r.unit ?? '', r.digits ?? 2)]
    }
  })
}

// ── Map layers ──────────────────────────────────────────────────────────────

function vectorSource(layerId: string) {
  return {
    type: 'vector' as const,
    tiles: [`${martinUrl}/${encodeURIComponent(layerId)}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 22,
  }
}

function addLayers() {
  map.addSource(SRC.lots, vectorSource(LAYER_ID.value))
  map.addSource(SRC.edges, vectorSource(EDGE_LAYER_ID.value))
  map.addSource(SRC.roads, vectorSource(ROAD_LAYER_ID))
  map.addSource(SRC.props, vectorSource(PROP_LAYER_ID))
  map.addSource(SRC.cadastre, vectorSource(CADASTRE_LAYER_ID))

  // Road centrelines sit at the bottom and are barely visible by default: the
  // layer has to exist for its tiles to load, because the street type is read
  // out of them.
  map.addLayer({
    id: 'pw-roads-line',
    type: 'line',
    source: SRC.roads,
    'source-layer': ROAD_LAYER_ID,
    minzoom: LOT_MIN_ZOOM,
    paint: { 'line-color': COLOR.roads, 'line-width': 1.2, 'line-opacity': 0.55 },
  })

  map.addLayer({
    id: 'pw-lot-fill',
    type: 'fill',
    source: SRC.lots,
    'source-layer': LAYER_ID.value,
    minzoom: LOT_MIN_ZOOM,
    paint: { 'fill-color': COLOR.lot, 'fill-opacity': fillOpacity.value },
  })
  map.addLayer({
    id: 'pw-lot-selected',
    type: 'fill',
    source: SRC.lots,
    'source-layer': LAYER_ID.value,
    minzoom: LOT_MIN_ZOOM,
    filter: ['==', ['get', 'objectid'], -1],
    paint: { 'fill-color': COLOR.frontage, 'fill-opacity': 0.18 },
  })
  map.addLayer({
    id: 'pw-lot-line',
    type: 'line',
    source: SRC.lots,
    'source-layer': LAYER_ID.value,
    minzoom: LOT_MIN_ZOOM,
    paint: { 'line-color': COLOR.lot, 'line-width': 1, 'line-opacity': 0.75 },
  })

  map.addLayer({
    id: 'pw-cadastre-line',
    type: 'line',
    source: SRC.cadastre,
    'source-layer': CADASTRE_LAYER_ID,
    minzoom: LOT_MIN_ZOOM,
    paint: { 'line-color': COLOR.cadastre, 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
  })

  // ── Every boundary edge, straight from the tile ─────────────────────────
  //
  // Each feature in lot_metrics_3_edges is one edge of one lot and carries its
  // own `edge_length_m`. Drawing them all, each labelled with its own recorded
  // length, covers the whole parcel boundary and states only what the data
  // says.
  //
  // The page used to draw a single red "frontage" line instead, by matching
  // `all_frontages` ("QUEEN:6.87m") against the edge lengths to work out which
  // edge that frontage referred to. Nothing in the source records that link —
  // a frontage is a road name and a number, an edge is a length and a
  // geometry — so it had to be inferred, and on a rectangular lot with edges
  // [7.2, 38.5, 6.9, 38.5] a 6.87 m frontage matches the 6.9 m *rear* boundary
  // more closely than the 7.2 m street one. That is why the red line covered
  // part of a lot, or the wrong part of it.
  map.addLayer({
    id: 'pw-edges-line',
    type: 'line',
    source: SRC.edges,
    'source-layer': EDGE_LAYER_ID.value,
    minzoom: LOT_MIN_ZOOM,
    paint: {
      'line-color': COLOR.edges,
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.6, 18, 3.2],
      'line-opacity': 0.95,
    },
    layout: { 'line-cap': 'round' },
  })

  // The selected lot's own edges, picked out by objectid — a filter on the
  // tile's own field, not a computed geometry.
  map.addLayer({
    id: 'pw-edges-selected',
    type: 'line',
    source: SRC.edges,
    'source-layer': EDGE_LAYER_ID.value,
    minzoom: LOT_MIN_ZOOM,
    filter: ['==', ['get', 'objectid'], -1],
    paint: {
      'line-color': COLOR.frontage,
      'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3.5, 18, 7],
      'line-opacity': 1,
    },
    layout: { 'line-cap': 'round' },
  })

  map.addLayer({
    id: 'pw-props-circle',
    type: 'circle',
    source: SRC.props,
    'source-layer': PROP_LAYER_ID,
    minzoom: PROP_MIN_ZOOM,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 2.5, 19, 5],
      'circle-color': COLOR.props,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
    },
  })

  // Each edge's own recorded length, along the edge it belongs to. `edge_length_m`
  // verbatim from the tile — number-format only sets the decimal places.
  map.addLayer({
    id: 'pw-edges-label',
    type: 'symbol',
    source: SRC.edges,
    'source-layer': EDGE_LAYER_ID.value,
    minzoom: 17,
    layout: {
      'text-field': [
        'concat',
        ['number-format', ['get', 'edge_length_m'], { 'max-fraction-digits': 2 }],
        ' m',
      ],
      'symbol-placement': 'line-center',
      'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10.5, 19, 13],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-max-angle': 25,
      'text-padding': 3,
      'text-offset': [0, -0.8],
    },
    paint: {
      'text-color': '#334155',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
    },
  })

  // The lot's recorded frontage road and length, on the lot. Both fields come
  // straight off lot_metrics_3; nothing here decides where the frontage is.
  map.addLayer({
    id: 'pw-lot-label',
    type: 'symbol',
    source: SRC.lots,
    'source-layer': LAYER_ID.value,
    minzoom: 17,
    filter: ['has', 'primary_frontage_road'],
    layout: {
      'text-field': [
        'concat',
        ['get', 'primary_frontage_road'],
        ' · ',
        ['number-format', ['get', 'primary_frontage_length_m'], { 'max-fraction-digits': 2 }],
        ' m',
      ],
      'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10.5, 19, 13],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-padding': 4,
    },
    paint: {
      'text-color': '#7f1d1d',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2.2,
    },
  })

  applyVisibility()
}

const LAYERS_BY_TOGGLE: Record<ToggleKey, string[]> = {
  lots: ['pw-lot-fill', 'pw-lot-line', 'pw-lot-selected', 'pw-edges-selected'],
  frontage: ['pw-lot-label'],
  edges: ['pw-edges-line', 'pw-edges-label'],
  props: ['pw-props-circle'],
  cadastre: ['pw-cadastre-line'],
  roads: ['pw-roads-line'],
}

/**
 * Layers that are read as data, not just drawn.
 *
 * `visibility: none` stops mapbox-gl fetching that source's tiles at all, and
 * `querySourceFeatures` only sees loaded tiles. The edges are read on every
 * rebuild to fill the panel's boundary list, and the roads carry the street
 * names, so switching either off has to dim it rather than hide it.
 */
const DATA_BACKED: Partial<Record<ToggleKey, number>> = { roads: 0.55, edges: 0.95 }

/** Which paint property dims each of those — a symbol layer has no line-opacity. */
const OPACITY_PROP: Record<string, string> = {
  'pw-roads-line': 'line-opacity',
  'pw-edges-line': 'line-opacity',
  'pw-edges-label': 'text-opacity',
}

function applyVisibility() {
  if (!map) return
  for (const [key, ids] of Object.entries(LAYERS_BY_TOGGLE) as [ToggleKey, string[]][]) {
    const lit = DATA_BACKED[key]
    for (const id of ids) {
      if (!map.getLayer(id)) continue
      if (lit !== undefined) map.setPaintProperty(id, OPACITY_PROP[id]!, show[key] ? lit : 0)
      else map.setLayoutProperty(id, 'visibility', show[key] ? 'visible' : 'none')
    }
  }
}

watch(show, applyVisibility, { deep: true })

watch(fillOpacity, (v) => {
  if (map?.getLayer('pw-lot-fill')) map.setPaintProperty('pw-lot-fill', 'fill-opacity', v)
})

// ── Basemap ─────────────────────────────────────────────────────────────────

/** setStyle drops every source and layer, so everything is re-added after it. */
function setBasemap(b: BasemapId) {
  if (b === basemap.value || !map) return
  basemap.value = b
  map.setStyle(BASEMAP_STYLES[b])
  map.once('style.load', () => {
    addLayers()
    // The measurement's source goes with the style too.
    ensureMeasureLayers()
    renderMeasure()
    restackMeasure()
    if (selected.value) {
      map.setFilter('pw-lot-selected', ['==', ['get', 'objectid'], selected.value.objectid])
      map.setFilter('pw-edges-selected', ['==', ['get', 'objectid'], selected.value.objectid])
    }
    scheduleRebuild()
  })
}

// ── Address search ──────────────────────────────────────────────────────────
// Same two sources as /map: the property DB first, because it knows the zone
// and the LGA, then Mapbox for everything it does not cover.

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

const MAPBOX_ZOOM: Record<string, number> = {
  address: 18, street: 17, neighborhood: 15, postcode: 14, locality: 14, place: 12, region: 8,
}

const addr = ref('')
const addrResults = ref<AddrResult[]>([])
const addrIndex = ref(0)
const addrNote = ref('')
let addrDebounce: ReturnType<typeof setTimeout> | null = null
let addrMarker: any = null

function onAddrInput() {
  addrIndex.value = 0
  addrNote.value = ''
  if (addrDebounce) clearTimeout(addrDebounce)
  const q = addr.value.trim()
  if (q.length < 3) { addrResults.value = []; return }
  addrDebounce = setTimeout(() => fetchAddr(q), 250)
}

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
        zoom: 18,
        source: 'local',
      }))
  } catch {
    return []
  }
}

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
        zoom: MAPBOX_ZOOM[p.feature_type] ?? 16,
        source: 'mapbox',
      }
    })
    .filter(Boolean) as AddrResult[]
}

async function fetchAddr(q: string) {
  try {
    const local = await fetchLocalAddr(q)
    const results = local.length ? local : await fetchMapboxAddr(q)
    if (q !== addr.value.trim()) return
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

/** Invalidates the retry loop below when a newer address is chosen. */
let selectSeq = 0

/**
 * Select the lot under a point, retrying until its tiles have arrived.
 *
 * One attempt on the first `idle` after the camera lands is not enough. `idle`
 * only promises that nothing is in flight *at that instant*, and for a
 * destination whose tiles are still being requested it fires before the lot
 * layer has anything to hit — the query finds nothing, and with a single-shot
 * `once` there is no second attempt, so the page sits on the right place with
 * nothing selected. It reproduced on roughly one address in thirty.
 *
 * Retries on a timer rather than on further `idle` events: once the map really
 * is idle, no further idle event is coming, so an idle-driven retry would wait
 * for one that never arrives.
 */
function selectAtPoint(lngLat: [number, number], seq: number, attemptsLeft = 12) {
  if (!map || seq !== selectSeq) return

  rebuildFrontages()
  const pt = map.project(lngLat)
  const hits = map.getLayer('pw-lot-fill')
    ? map.queryRenderedFeatures(pt, { layers: ['pw-lot-fill'] })
    : []
  const oid = Number(hits[0]?.properties?.objectid)

  // lotProps has to hold it too — selectLot reads the lot's attributes from
  // there, and a hit whose tile arrived after the last rebuild is not yet in it.
  if (Number.isFinite(oid) && lotProps.has(oid)) { selectLot(oid); return }
  if (attemptsLeft <= 0) return
  setTimeout(() => selectAtPoint(lngLat, seq, attemptsLeft - 1), 400)
}

/** Fly to the address, then select the lot underneath it. */
function selectAddr(r: AddrResult) {
  addr.value = r.address
  addrResults.value = []
  addrNote.value = ''
  if (!map) return

  addrMarker?.remove()
  addrMarker = new mapboxgl.Marker({ color: COLOR.props, scale: 0.7 })
    .setLngLat([r.lng, r.lat])
    .addTo(map)

  const seq = ++selectSeq
  map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(r.zoom, PROP_MIN_ZOOM), duration: 1200 })
  map.once('moveend', () => selectAtPoint([r.lng, r.lat], seq))
}

/**
 * `?address=…` opens the page already on that lot.
 *
 * Makes a view shareable, and is what lets the screenshot script in
 * scripts/shoot-prop-width.mjs drive the page without synthesising typing and
 * clicks into the search box.
 *
 * The address is resolved through the same property-DB lookup the search box
 * uses, so an address that page can find is one this can too. An exact match
 * is preferred over the endpoint's own ranking: that endpoint deliberately
 * returns near misses so a typed street number can still find its neighbours,
 * which is right for a person typing and wrong for a link naming one lot.
 */
async function openFromQuery() {
  const wanted = String(useRoute().query.address ?? '').trim()
  if (!wanted) return
  addr.value = wanted
  const results = await fetchLocalAddr(wanted)
  if (!results.length) {
    addrNote.value = `No property found for “${wanted}”`
    return
  }
  const exact = results.find(r => r.address.toLowerCase() === wanted.toLowerCase())
  selectAddr(exact ?? results[0]!)
}

// ── Init ────────────────────────────────────────────────────────────────────

let rebuildTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    rebuildFrontages()
  }, 120)
}

onMounted(async () => {
  if (!mapboxToken) return

  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken

  map = new mapboxgl.Map({
    container: mapEl.value!,
    style: BASEMAP_STYLES[basemap.value],
    center: [151.2412, -33.9173],   // Randwick — covered by both councils' data
    zoom: 16.5,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  if (import.meta.dev) (window as any).__propWidthMap = map

  map.on('click', onMapClick)
  map.on('mousemove', 'pw-lot-fill', () => {
    if (!measuring.value) map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'pw-lot-fill', () => {
    if (!measuring.value) map.getCanvas().style.cursor = ''
  })
  map.on('mousemove', onMeasureMove)
  map.on('dblclick', onMeasureDblClick)
  window.addEventListener('keydown', onMeasureKey)
  map.on('zoom', () => { zoom.value = map.getZoom() })
  map.on('idle', scheduleRebuild)
  map.on('dataloading', () => { if (map.getZoom() >= LOT_MIN_ZOOM) status.value = 'Loading tiles…' })
  map.on('idle', () => { if (status.value === 'Loading tiles…') status.value = '' })
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (!msg || /aborted/i.test(msg)) return
    // road_segments is broken on the tile server for a good number of tiles —
    // see roadTilesBroken. Those failures are expected, already degrade to the
    // bare road-name stem, and would otherwise flash on every pan.
    if (isRoadTileError(e)) { roadTilesBroken.value = true; return }
    flash(msg.slice(0, 120))
  })

  await new Promise<void>((resolve) => {
    if (map.isStyleLoaded()) resolve()
    else map.once('load', () => resolve())
  })

  addLayers()
  ensureMeasureLayers()
  zoom.value = map.getZoom()
  await openFromQuery()
})

let flashTimer: any = null
function flash(msg: string) {
  status.value = msg
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { status.value = '' }, 3000)
}

onBeforeUnmount(() => {
  clearTimeout(flashTimer)
  if (rebuildTimer) clearTimeout(rebuildTimer)
  if (addrDebounce) clearTimeout(addrDebounce)
  window.removeEventListener('keydown', onMeasureKey)
  map?.remove()
  map = null
})
</script>

<style scoped>
.pw-page {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Figtree", "Segoe UI", system-ui, sans-serif;
  color: #0f172a;
}

/* ── Panel ──────────────────────────────────────────────────────────────── */
.panel {
  width: 340px;
  flex: 0 0 340px;
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

.toggle-list { display: flex; flex-direction: column; gap: 0.1rem; }
.toggle {
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.22rem 0.15rem; cursor: pointer; border-radius: 5px;
}
.toggle:hover { background: #f8fafc; }
.toggle input { accent-color: #15803d; flex: 0 0 auto; margin: 0; }
.swatch { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
.toggle-text { min-width: 0; display: flex; flex-direction: column; }
.toggle-name { font-size: 0.75rem; color: #1e293b; }
.toggle-meta { font-size: 0.61rem; color: #94a3b8; }

.opacity-row { display: flex; align-items: center; gap: 0.45rem; }
.opacity-label { font-size: 0.68rem; color: #94a3b8; white-space: nowrap; }
.opacity-slider { flex: 1; accent-color: #2563eb; }
.opacity-value { font-size: 0.68rem; color: #64748b; width: 2.2rem; text-align: right; }

.warn {
  margin: 0; font-size: 0.68rem; color: #b45309;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 0.35rem 0.45rem;
}
.note {
  margin: 0; font-size: 0.66rem; color: #64748b; line-height: 1.45;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.35rem 0.45rem;
}
.note code { font-size: 0.95em; color: #475569; }

/* ── Detail ─────────────────────────────────────────────────────────────── */
.detail { flex: 1; overflow-y: auto; padding: 0.7rem 0.9rem 1.5rem; }
.empty { font-size: 0.75rem; color: #94a3b8; margin: 0.3rem 0 0; line-height: 1.5; }
.empty-note { display: block; color: #cbd5e1; font-size: 0.68rem; }

.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.4rem; }
.detail-title { font-size: 0.88rem; font-weight: 700; margin: 0; }
.detail-addr { font-size: 0.72rem; color: #475569; margin: 0.15rem 0 0; line-height: 1.4; }
.detail-addr--none { color: #94a3b8; font-style: italic; }
.detail-more { color: #94a3b8; }

.detail-section {
  font-size: 0.63rem; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.05em;
  margin: 1rem 0 0.35rem;
  display: flex; align-items: center; gap: 0.35rem;
}
.detail-section-count {
  background: #f1f5f9; color: #64748b; border-radius: 999px;
  padding: 0.02rem 0.32rem; font-size: 0.6rem; letter-spacing: 0;
}
.detail-none { font-size: 0.72rem; color: #94a3b8; margin: 0; }
.detail-hint {
  font-size: 0.64rem; color: #94a3b8; margin: 0 0 0.35rem; line-height: 1.45;
}
.detail-hint code { color: #64748b; }

.frontage-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.frontage {
  display: flex; gap: 0.5rem; align-items: stretch;
  background: #fff7ed; border: 1px solid #fed7aa; border-radius: 7px;
  padding: 0.4rem 0.5rem;
}
.frontage--primary { background: #fef2f2; border-color: #fecaca; }
.frontage-bar { width: 3px; border-radius: 2px; background: #ea580c; flex: 0 0 auto; }
.frontage--primary .frontage-bar { background: #dc2626; }
.frontage-body { display: flex; flex-direction: column; min-width: 0; }
.frontage-road { font-size: 0.78rem; font-weight: 600; color: #1e293b; }
.frontage-len { font-size: 0.95rem; font-weight: 800; color: #b91c1c; line-height: 1.2; }
.frontage--primary .frontage-len { color: #991b1b; }
.frontage-tag { font-size: 0.62rem; color: #94a3b8; margin-top: 0.05rem; }

.detail-table { border-collapse: collapse; width: 100%; font-size: 0.72rem; }
.detail-table th {
  text-align: left; font-weight: 500; color: #94a3b8;
  padding: 0.14rem 0.5rem 0.14rem 0; vertical-align: top; white-space: nowrap;
}
.detail-table td { color: #1e293b; padding: 0.14rem 0; text-align: right; font-variant-numeric: tabular-nums; }

.edge-list { list-style: none; margin: 0; padding: 0; }
.edge {
  display: grid; grid-template-columns: 1.6rem 5.5rem 1fr;
  gap: 0.3rem; align-items: baseline;
  font-size: 0.7rem; padding: 0.12rem 0;
  border-bottom: 1px solid #f1f5f9;
}
.edge-idx { color: #cbd5e1; font-variant-numeric: tabular-nums; }
.edge-len { color: #1e293b; font-variant-numeric: tabular-nums; }
.edge-bearing { color: #94a3b8; font-variant-numeric: tabular-nums; }
.edge-front {
  color: #b91c1c; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.icon-btn {
  border: none; background: none; cursor: pointer;
  color: #94a3b8; font-size: 1rem; line-height: 1; padding: 0.2rem 0.3rem;
}
.icon-btn:hover { color: #15803d; }
.icon-btn--sm { font-size: 0.9rem; }

.panel-open {
  position: absolute; top: 0.75rem; left: 0.75rem; z-index: 3;
  padding: 0.45rem 0.7rem; border-radius: 8px;
  border: 1px solid #e2e8f0; background: #fff; cursor: pointer;
  font-family: inherit; font-size: 0.78rem; font-weight: 600;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
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
.basemap-btn--on { background: #eff6ff; color: #2563eb; font-weight: 600; }

/* ── Address search ─────────────────────────────────────────────────────── */
.map-search {
  position: absolute; top: 0.75rem; left: 0.75rem; z-index: 3;
  width: 340px; max-width: calc(100% - 1.5rem);
}
.map-search--shifted { left: 7rem; }

.map-search-box {
  display: flex; align-items: center; gap: 0.45rem;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 0.45rem 0.6rem;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.map-search-box:focus-within { border-color: #2563eb; }
.map-search-icon { color: #94a3b8; flex: 0 0 auto; }
.map-search-input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 0.8rem; color: #0f172a;
}
.map-search-clear {
  border: none; background: none; cursor: pointer;
  color: #94a3b8; font-size: 1.1rem; line-height: 1; padding: 0 0.15rem;
}
.map-search-clear:hover { color: #2563eb; }

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
.map-search-item--active { background: #eff6ff; }
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
  .panel { position: absolute; inset: 0 auto 0 0; width: 88vw; flex-basis: 88vw; }
}
</style>
