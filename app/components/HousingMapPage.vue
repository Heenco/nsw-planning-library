<!--
  /build-to-rent and /affordable-housing: a map, the layers each clause is read from, and a verdict for any
  lot you pick - the /lmr pattern, for Housing SEPP s 72 and s 15C.

  - Left panel: search an address or lot, then the layers (shared/housing-layers.ts). The panel is the legend,
    and every layer names the clause it answers.
  - Right panel, three tabs:
      This lot     /api/housing/at - the verdict, each limb with its clause and why, the exclusions, what the
                   lot is then allowed, and what only the proposal can answer
      The rules    the provision clause by clause (shared/build-to-rent.ts, shared/affordable-housing.ts)
      The request  the requirement as it was asked, read line by line against the clauses
  - Overlays come from /api/housing/features as GeoJSON clipped to the view, refetched on move. A layer below
    its zoom floor says so in the panel rather than vanishing.

  A null verdict is "the data cannot decide", never "clear": the walking distance to a centre zone outside the
  Six Cities is not built yet, and the panel says when that is what is open. The station and bus stop walking
  isochrones are taken as decided - a lot inside one is in an accessible area.
-->

<template>
  <div class="hm-page">
    <header class="hm-header">
      <div>
        <NuxtLink to="/pages" class="hm-back">&larr; Pages</NuxtLink>
        <h1 class="hm-title">{{ heading }}</h1>
      </div>
      <div class="hm-header-stat">
        {{ spec.provision }} ·
        <NuxtLink :to="other.to" class="hm-link">{{ other.label }}</NuxtLink>
      </div>
    </header>

    <div class="hm-body">
      <!-- ── left: search and layers ─────────────────────────────────────── -->
      <aside class="hm-panel" :class="{ 'hm-panel--closed': !panelOpen }">
        <button type="button" class="hm-toggle" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
          {{ panelOpen ? 'Hide layers' : 'Layers' }}
        </button>
        <div v-show="panelOpen" class="hm-panel-inner">
          <div class="hm-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
            <label class="hm-sr" for="hm-q">Address or lot reference</label>
            <input
              id="hm-q" v-model="q" type="search" class="hm-input" role="combobox"
              placeholder="An address, or a lot — A//DP71490"
              autocomplete="off" spellcheck="false"
              :aria-expanded="listOpen && results.length > 0" aria-controls="hm-listbox"
              @input="onType" @focus="listOpen = results.length > 0"
              @keydown.enter.prevent="pickHighlighted"
            >
            <span v-if="searching" class="hm-busy">searching…</span>
            <ul v-if="listOpen && results.length" id="hm-listbox" class="hm-listbox" role="listbox">
              <li
                v-for="(r, i) in results" :key="`${r.cadid}-${r.msoid}`" role="option" :aria-selected="i === highlight"
                class="hm-option" :class="{ 'hm-option--on': i === highlight }"
                @mousedown.prevent="pickLot(r)" @mousemove="highlight = i"
              >
                <span class="hm-option-addr">{{ r.address || '(no address)' }}</span>
                <span class="hm-option-meta"><code>{{ r.titleLot || r.lotId || '—' }}</code> {{ r.lgaName || '' }}</span>
              </li>
            </ul>
          </div>
          <p v-if="searchMsg" class="hm-error">{{ searchMsg }}</p>
          <p v-else class="hm-dim hm-hint">Or click any lot on the map.</p>

          <section v-for="g in layerGroups" :key="g.title" class="hm-group">
            <h2 class="hm-h2">{{ g.title }}</h2>
            <ul class="hm-list">
              <li v-for="l in g.layers" :key="l.key" class="hm-item">
                <label class="hm-row">
                  <input type="checkbox" :checked="on.has(l.key)" @change="toggle(l.key)">
                  <span class="hm-swatch" :style="swatch(l)" />
                  <span class="hm-name">{{ l.title }}</span>
                  <span class="hm-clause">{{ l.clause }}</span>
                </label>
                <p class="hm-blurb">{{ l.blurb }}</p>
                <p class="hm-meta">
                  <code>{{ l.table }}</code>
                  <span v-if="on.has(l.key) && zoom < l.minZoom" class="hm-zoomnote"> · zoom in to {{ l.minZoom }} to draw</span>
                  <span v-else-if="state[l.key] === 'loading'" class="hm-dim"> · loading…</span>
                  <span v-else-if="state[l.key] === 'capped'" class="hm-zoomnote"> · too many here — zoom in for all of it</span>
                  <span v-else-if="state[l.key] === 'error'" class="hm-zoomnote"> · could not load</span>
                </p>
              </li>
            </ul>
          </section>
          <p v-if="page === 'ahb'" class="hm-note">
            The Six Cities Region is a list of councils (EP&amp;A Act, Schedule 9), not a map layer: the lot's council
            decides which location test applies.
          </p>
        </div>
      </aside>

      <!-- ── the map ──────────────────────────────────────────────────────── -->
      <div class="hm-mapwrap">
        <div ref="mapEl" class="hm-map" />
        <p v-if="!mapboxToken" class="hm-error hm-maperr">No Mapbox token is configured, so the map cannot draw.</p>
        <p v-if="status" class="hm-status">{{ status }}</p>
      </div>

      <!-- ── right: this lot / the rules / the request ─────────────────────── -->
      <aside class="hm-guide">
        <nav class="hm-tabs">
          <button v-for="t in TABS" :key="t.key" type="button" class="hm-tab" :class="{ 'hm-tab--on': tab === t.key }" @click="tab = t.key">
            {{ t.label }}
          </button>
        </nav>

        <!-- this lot -->
        <div v-if="tab === 'lot'" class="hm-guide-inner">
          <p v-if="!answer && !judging && !judgeError" class="hm-dim">
            Search an address or click a lot, and it is judged against {{ page === 'btr' ? 's 72' : 's 15C' }} clause by clause.
          </p>
          <p v-if="judging" class="hm-dim">Judging the lot…</p>
          <p v-if="judgeError" class="hm-error">{{ judgeError }}</p>

          <template v-if="answer && verdict">
            <div class="hm-lothead">
              <div>
                <p class="hm-lotid">{{ answer.facts.lotId || answer.facts.cadid }}</p>
                <p class="hm-dim hm-small">
                  {{ answer.facts.lga || 'council unknown' }} · zoned {{ answer.facts.zones.join(', ') || '—' }}
                  <template v-if="answer.facts.areaM2"> · {{ Math.round(answer.facts.areaM2).toLocaleString() }} m²</template>
                </p>
              </div>
              <button type="button" class="hm-link" @click="clearLot">clear</button>
            </div>

            <div class="hm-verdict" :class="`hm-verdict--${tri(verdict.eligible)}`">
              <span class="hm-verdict-word">{{ VERDICT_WORD[tri(verdict.eligible)] }}</span>
              <span>{{ verdict.headline }}</span>
            </div>

            <h3 class="hm-h3">{{ page === 'btr' ? 'Section 72(2): any one route is enough' : 'Section 15C(1): all of these' }}</h3>
            <ul class="hm-limbs">
              <li v-for="l in verdict.limbs" :key="l.clause + l.label" class="hm-limb" :class="{ 'hm-limb--info': l.informational }">
                <span class="hm-mark" :class="`hm-mark--${tri(l.pass)}`">{{ l.informational ? 'i' : MARK[tri(l.pass)] }}</span>
                <div>
                  <p class="hm-limb-head"><a :href="clauseUrl(l.clause)" target="_blank" rel="noopener">s {{ l.clause }}</a> {{ l.label }}</p>
                  <p class="hm-limb-why">{{ l.why }}</p>
                </div>
              </li>
            </ul>

            <template v-if="verdict.exclusions.length">
              <h3 class="hm-h3">Section 15C(2A): land taken out</h3>
              <ul class="hm-limbs">
                <li v-for="l in verdict.exclusions" :key="l.clause + l.label" class="hm-limb">
                  <span class="hm-mark" :class="l.pass ? 'hm-mark--no' : 'hm-mark--yes'">{{ l.pass ? '✗' : '✓' }}</span>
                  <div>
                    <p class="hm-limb-head"><a :href="clauseUrl(l.clause)" target="_blank" rel="noopener">s {{ l.clause }}</a> {{ l.label }}</p>
                    <p class="hm-limb-why">{{ l.why }}</p>
                  </div>
                </li>
              </ul>
            </template>

            <template v-if="verdict.allowances.length">
              <h3 class="hm-h3">{{ page === 'btr' ? 'What the land already allows' : 'What the bonus gives' }}</h3>
              <ul class="hm-allow">
                <li v-for="a in verdict.allowances" :key="a.label"><b>{{ a.label }}</b> {{ a.value }} <span class="hm-dim">s {{ a.clause }}</span></li>
              </ul>
            </template>

            <h3 class="hm-h3">Only the proposal can answer</h3>
            <ul class="hm-flags"><li v-for="f in verdict.flags" :key="f">{{ f }}</li></ul>

            <p v-if="page === 'ahb'" class="hm-cross">
              Build-to-rent here: <b :class="`hm-ink--${tri(answer.btr.eligible)}`">{{ VERDICT_WORD[tri(answer.btr.eligible)].toLowerCase() }}</b>
              — <NuxtLink :to="`/build-to-rent#${answer.facts.cadid}`" class="hm-link">open on /build-to-rent</NuxtLink>
            </p>
            <p v-else class="hm-cross">
              Affordable housing bonus here: <b :class="`hm-ink--${tri(answer.ahb.eligible)}`">{{ VERDICT_WORD[tri(answer.ahb.eligible)].toLowerCase() }}</b>
              — <NuxtLink :to="`/affordable-housing#${answer.facts.cadid}`" class="hm-link">open on /affordable-housing</NuxtLink>
            </p>
            <p class="hm-dim hm-small">Judged in {{ answer.ms }} ms · cadid {{ answer.facts.cadid }}</p>
          </template>
        </div>

        <!-- the rules -->
        <div v-else-if="tab === 'rules'" class="hm-guide-inner">
          <p class="hm-dim hm-small">
            Quoted from the library's copy of the Housing SEPP (amendments to {{ HOUSING_SEPP_AMENDED_TO }}).
            <b>held</b> means we hold the data a lot is tested against; <b>the proposal</b> means no layer ever could.
          </p>
          <section v-for="s in spec.sections" :key="s.id" class="hm-rsec">
            <h3 class="hm-h3">{{ s.title }}</h3>
            <p class="hm-dim hm-small">{{ s.lead }}</p>
            <details v-for="r in s.rows" :key="r.clause" class="hm-rule" :class="{ 'hm-rule--unv': r.unverified }">
              <summary>
                <span class="hm-st" :class="`hm-st--${r.data}`">{{ STATUS[r.data] }}</span>
                <a :href="legislationLink(r)" target="_blank" rel="noopener" @click.stop>{{ r.clause }}</a>
                <span class="hm-rule-gist">{{ gist(r.text) }}</span>
              </summary>
              <q class="hm-quote">{{ r.text }}</q>
              <p v-if="r.note" class="hm-rule-note">{{ r.note }}</p>
              <p class="hm-rule-data">{{ r.dataNote }} <code v-for="t in r.tables || []" :key="t">{{ t }}</code></p>
            </details>
          </section>
          <h3 class="hm-h3">What to watch</h3>
          <ul class="hm-flags"><li v-for="w in spec.watch" :key="w.lead"><b>{{ w.lead }}</b> {{ w.body }}</li></ul>
          <h3 class="hm-h3">Sources</h3>
          <a v-for="s in spec.sources" :key="s.url" class="hm-src" :href="s.url" target="_blank" rel="noopener">{{ s.label }} <i>{{ s.host }}</i></a>
        </div>

        <!-- the request -->
        <div v-else class="hm-guide-inner">
          <div class="hm-asked">
            <p class="hm-asked-h">{{ spec.request.heading }}</p>
            <ul><li v-for="b in spec.request.bullets" :key="b">{{ b }}</li></ul>
            <template v-if="spec.request.after">
              <p class="hm-asked-h">{{ spec.request.after.heading }}</p>
              <ul><li v-for="b in spec.request.after.bullets" :key="b">{{ b }}</li></ul>
            </template>
          </div>
          <ul class="hm-limbs">
            <li v-for="l in spec.requestLines" :key="l.said + l.clause" class="hm-limb">
              <span class="hm-v" :class="`hm-v--${l.verdict}`">{{ RVERDICT[l.verdict] }}</span>
              <div>
                <p class="hm-limb-head"><a :href="clauseUrl(l.clause)" target="_blank" rel="noopener">s {{ l.clause }}</a> {{ l.said }}</p>
                <p class="hm-limb-why">{{ l.why }}</p>
              </div>
            </li>
          </ul>
          <template v-if="spec.ourRule">
            <h3 class="hm-h3">The rule we already run: {{ spec.ourRule.name }}</h3>
            <ul class="hm-limbs">
              <li v-for="l in spec.ourRule.lines" :key="l.says" class="hm-limb">
                <span class="hm-v" :class="`hm-v--${l.verdict}`">{{ RVERDICT[l.verdict] }}</span>
                <div>
                  <p class="hm-limb-head"><a :href="clauseUrl(l.clause)" target="_blank" rel="noopener">s {{ l.clause }}</a> <code>{{ l.says }}</code></p>
                  <p class="hm-limb-why">{{ l.why }}</p>
                </div>
              </li>
            </ul>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { HOUSING_SEPP_AMENDED_TO, legislationLink, sectionOf, HOUSING_SEPP_URL,
  type DataStatus, type RequestVerdict, type RequirementPage } from '#shared/requirement-pages'
import { layersFor, type HousingLayer, type HousingPage } from '#shared/housing-layers'
import type { Tri } from '#shared/housing-evaluate'
import type { HousingAtResponse } from '../../server/api/housing/at.get'

const props = defineProps<{ page: HousingPage; spec: RequirementPage; heading: string }>()

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')

const other = computed(() => props.page === 'btr'
  ? { to: '/affordable-housing', label: 'the affordable housing bonus' }
  : { to: '/build-to-rent', label: 'build-to-rent' })

// ── vocabulary ───────────────────────────────────────────────────────────────
type T3 = 'yes' | 'no' | 'open'
const tri = (t: Tri | undefined): T3 => (t === true ? 'yes' : t === false ? 'no' : 'open')
const VERDICT_WORD: Record<T3, string> = { yes: 'Eligible', no: 'Not eligible', open: 'Undecided' }
const MARK: Record<T3, string> = { yes: '✓', no: '✗', open: '?' }
const STATUS: Record<DataStatus, string> = { held: 'held', partial: 'partly', gap: 'no data', proposal: 'the proposal' }
const RVERDICT: Record<RequestVerdict, string> = {
  matches: 'matches', narrower: 'narrower', wider: 'wider', different: 'different', missing: 'left out', unverified: 'not yet read',
}
const TABS = [
  { key: 'lot', label: 'This lot' },
  { key: 'rules', label: 'The rules' },
  { key: 'request', label: 'The request' },
] as const
const tab = ref<'lot' | 'rules' | 'request'>('lot')

function clauseUrl(clause: string) {
  const sec = sectionOf(clause)
  return sec ? `${HOUSING_SEPP_URL}#${sec}` : HOUSING_SEPP_URL
}
function gist(text: string) {
  const t = text.replace(/^\(?[\w.]+\)\s*/, '')
  return t.length > 90 ? `${t.slice(0, 88)}…` : t
}

// ── layers ───────────────────────────────────────────────────────────────────
const layers = layersFor(props.page)
const on = ref(new Set(layers.filter(l => l.defaultOn.includes(props.page)).map(l => l.key)))
const state = reactive<Record<string, 'loading' | 'ok' | 'capped' | 'error' | ''>>({})
const zoom = ref(10)
const panelOpen = ref(true)
const status = ref('')

const GROUPS: Record<HousingPage, { title: string; keys: string[] }[]> = {
  btr: [
    { title: 'Where s 72 reaches', keys: ['btr_zones', 'tod_areas', 'lmr_area', 'westconnex'] },
  ],
  ahb: [
    { title: 'Location: inside the Six Cities', keys: ['iso_train', 'iso_bus'] },
    { title: 'Location: everywhere else', keys: ['relevant_zones'] },
    { title: 'Permitted through a SEPP', keys: ['tod_areas', 'lmr_area'] },
    { title: 'Taken out', keys: ['atod', 'ssd_excluded', 'sop'] },
  ],
}
const layerGroups = computed(() => GROUPS[props.page].map(g => ({
  title: g.title, layers: g.keys.map(k => layers.find(l => l.key === k)!).filter(Boolean),
})))

function swatch(l: HousingLayer) {
  return {
    background: l.fill + Math.round(Math.min(1, l.fillOpacity * 1.6) * 255).toString(16).padStart(2, '0'),
    border: `${Math.max(1, l.lineWidth)}px ${l.dashed ? 'dashed' : 'solid'} ${l.line}`,
  }
}

let map: any = null
let mapboxgl: any = null
const mapEl = ref<HTMLElement | null>(null)
const inflight: Record<string, AbortController> = {}
let moveTimer: ReturnType<typeof setTimeout> | null = null
let resizer: ResizeObserver | null = null

function addLayer(l: HousingLayer) {
  const src = `h-${l.key}`
  map.addSource(src, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: `${src}-fill`, type: 'fill', source: src, minzoom: l.minZoom,
    paint: { 'fill-color': l.fill, 'fill-opacity': l.fillOpacity } }, 'hlot-fill')
  map.addLayer({ id: `${src}-line`, type: 'line', source: src, minzoom: l.minZoom,
    paint: { 'line-color': l.line, 'line-width': l.lineWidth, ...(l.dashed ? { 'line-dasharray': [3, 2] } : {}) } }, 'hlot-fill')
  setVisible(l.key, on.value.has(l.key))
}

function setVisible(key: string, v: boolean) {
  for (const part of ['fill', 'line']) map?.setLayoutProperty(`h-${key}-${part}`, 'visibility', v ? 'visible' : 'none')
}

function toggle(key: string) {
  const next = new Set(on.value)
  next.has(key) ? next.delete(key) : next.add(key)
  on.value = next
  if (!map) return
  setVisible(key, next.has(key))
  if (next.has(key)) refresh(key)
}

async function refresh(key: string) {
  const l = layers.find(x => x.key === key)!
  if (!map || !on.value.has(key)) return
  const z = map.getZoom()
  if (z < l.minZoom) { state[key] = ''; return }
  inflight[key]?.abort()
  const ctrl = new AbortController()
  inflight[key] = ctrl
  // a quarter of the view again on every side, so a short pan does not show the clip edge
  const b = map.getBounds()
  const dx = (b.getEast() - b.getWest()) / 4
  const dy = (b.getNorth() - b.getSouth()) / 4
  const box = [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy]
  state[key] = 'loading'
  try {
    const fc = await $fetch<any>('/api/housing/features', {
      query: { layer: key, z: Math.floor(z), bbox: box.map(n => n.toFixed(5)).join(',') },
      signal: ctrl.signal,
    })
    if (ctrl.signal.aborted) return
    map.getSource(`h-${key}`)?.setData(fc)
    state[key] = fc.capped ? 'capped' : 'ok'
  } catch (e: any) {
    if (!ctrl.signal.aborted) state[key] = 'error'
  }
}

function refreshAll() {
  zoom.value = map.getZoom()
  for (const key of on.value) refresh(key)
}

// ── the picked lot ───────────────────────────────────────────────────────────
const answer = ref<HousingAtResponse | null>(null)
const judging = ref(false)
const judgeError = ref('')
const verdict = computed(() => answer.value ? (props.page === 'btr' ? answer.value.btr : answer.value.ahb) : null)
let judgeSeq = 0

const LOT_COLOUR: Record<T3, string> = { yes: '#16a34a', no: '#dc2626', open: '#d97706' }

async function judge(query: { cadid?: string; lon?: number; lat?: number }, fit = false) {
  const seq = ++judgeSeq
  tab.value = 'lot'
  judging.value = true
  judgeError.value = ''
  try {
    const r = await $fetch<HousingAtResponse>('/api/housing/at', { query })
    if (seq !== judgeSeq) return
    answer.value = r
    drawLot(r)
    if (fit && r.geometry) {
      const box = bboxOf(r.geometry)
      map?.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 17.5, duration: 800 })
    }
    history.replaceState(null, '', `#${r.facts.cadid}`)
  } catch (e: any) {
    if (seq !== judgeSeq) return
    judgeError.value = e?.data?.statusMessage || e?.data?.message || e?.message || 'Could not judge that lot.'
  } finally {
    if (seq === judgeSeq) judging.value = false
  }
}

function drawLot(r: HousingAtResponse) {
  if (!map) return
  const v = props.page === 'btr' ? r.btr : r.ahb
  const colour = LOT_COLOUR[tri(v.eligible)]
  map.getSource('hlot')?.setData({ type: 'Feature', properties: {}, geometry: r.geometry })
  map.setPaintProperty('hlot-fill', 'fill-color', colour)
  map.setPaintProperty('hlot-line', 'line-color', colour)
}

function clearLot() {
  answer.value = null
  map?.getSource('hlot')?.setData({ type: 'FeatureCollection', features: [] })
  history.replaceState(null, '', location.pathname)
}

function bboxOf(geometry: any): [number, number, number, number] {
  const b: [number, number, number, number] = [180, 90, -180, -90]
  const walk = (c: any) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
    } else c.forEach(walk)
  }
  walk(geometry.coordinates)
  return b
}

// ── search ───────────────────────────────────────────────────────────────────
interface LotMatch { cadid: string; lotId: string | null; titleLot: string | null; msoid: number | null; address: string | null; lgaName: string | null }
const q = ref('')
const results = ref<LotMatch[]>([])
const searching = ref(false)
const searchMsg = ref('')
const listOpen = ref(false)
const highlight = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null
let searchCtrl: AbortController | null = null

async function runSearch() {
  const term = q.value.trim()
  searchMsg.value = ''
  if (term.length < 3) { results.value = []; listOpen.value = false; return }
  searchCtrl?.abort()
  const ctrl = new AbortController()
  searchCtrl = ctrl
  searching.value = true
  try {
    const r = await $fetch<{ results: LotMatch[]; hint?: string }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    highlight.value = 0
    listOpen.value = r.results.length > 0
    if (!r.results.length) searchMsg.value = r.hint || `Nothing matched ${term}.`
  } catch (e: any) {
    if (!ctrl.signal.aborted) searchMsg.value = e?.data?.message || e?.message || 'The search failed.'
  } finally {
    if (searchCtrl === ctrl) { searching.value = false; searchCtrl = null }
  }
}
function onType() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 200)
}
function move(step: number) {
  if (!results.value.length) return
  listOpen.value = true
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}
function pickHighlighted() {
  const r = results.value[highlight.value] ?? results.value[0]
  if (r) pickLot(r)
}
function pickLot(r: LotMatch) {
  listOpen.value = false
  q.value = r.address || r.titleLot || r.lotId || q.value
  judge({ cadid: r.cadid }, true)
}

// ── init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  if (!mapboxToken) return
  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken
  map = new mapboxgl.Map({
    container: mapEl.value!,
    style: 'mapbox://styles/mapbox/light-v11',
    center: [151.0, -33.82],
    zoom: 11,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  // the grid settles after the map is created; without this the canvas keeps its first, smaller size
  resizer = new ResizeObserver(() => map?.resize())
  resizer.observe(mapEl.value!)
  map.on('load', () => {
    map.resize()
    map.addSource('hlot', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'hlot-fill', type: 'fill', source: 'hlot', paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.4 } })
    // a white halo under the outline, so the verdict colour reads over any overlay
    map.addLayer({ id: 'hlot-halo', type: 'line', source: 'hlot', paint: { 'line-color': '#ffffff', 'line-width': 7 } })
    map.addLayer({ id: 'hlot-line', type: 'line', source: 'hlot', paint: { 'line-color': '#0f172a', 'line-width': 3.5 } })
    for (const l of layers) addLayer(l)
    refreshAll()
    const cadid = location.hash.replace('#', '').trim()
    if (/^\d+$/.test(cadid)) judge({ cadid }, true)
  })
  map.on('moveend', () => {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(refreshAll, 150)
  })
  map.on('click', (e: any) => judge({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (msg && !/aborted/i.test(msg)) status.value = msg.slice(0, 140)
  })
})

onBeforeUnmount(() => {
  resizer?.disconnect()
  for (const c of Object.values(inflight)) c.abort()
  map?.remove()
  map = null
})
</script>

<style scoped>
.hm-page { display: flex; flex-direction: column; height: 100vh; background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif; font-size: 13px; line-height: 1.5; }
.hm-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.5rem 1rem;
  padding: 0.6rem 1rem; background: #fff; border-bottom: 1px solid #e2e8f0; }
.hm-back { font-size: 0.75rem; color: #64748b; text-decoration: none; }
.hm-title { margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a; }
.hm-header-stat { font-size: 0.76rem; color: #64748b; }
.hm-link { background: none; border: 0; padding: 0; font: inherit; color: #2a78d6; cursor: pointer; text-decoration: none; }
.hm-link:hover { text-decoration: underline; }

.hm-body { flex: 1; display: grid; grid-template-columns: auto 1fr 400px; min-height: 0; }
.hm-panel { width: 290px; overflow-y: auto; background: #fff; border-right: 1px solid #e2e8f0; position: relative; }
.hm-panel--closed { width: 44px; }
.hm-toggle { display: block; width: 100%; padding: 0.4rem; background: #f8fafc; border: 0; border-bottom: 1px solid #e2e8f0; font: inherit; font-size: 0.72rem; color: #475569; cursor: pointer; }
.hm-panel--closed .hm-toggle { writing-mode: vertical-rl; height: 100%; }
.hm-panel-inner { padding: 0.7rem 0.8rem 2rem; }
.hm-mapwrap { position: relative; min-height: 0; }
.hm-map { position: absolute; inset: 0; }
.hm-maperr { position: absolute; top: 1rem; left: 1rem; }
.hm-status { position: absolute; bottom: 2.2rem; left: 0.6rem; margin: 0; padding: 0.2rem 0.5rem; background: #fff; border-radius: 6px; font-size: 0.7rem; color: #92400e; }
.hm-guide { overflow-y: auto; background: #fff; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; min-height: 0; }
.hm-guide-inner { padding: 0.8rem 1rem 2rem; }

.hm-combo { position: relative; }
.hm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.hm-input { width: 100%; box-sizing: border-box; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.hm-busy { position: absolute; right: 0.6rem; top: 0.5rem; font-size: 0.7rem; color: #94a3b8; }
.hm-listbox { position: absolute; z-index: 5; left: 0; right: 0; margin: 0.2rem 0 0; padding: 0; list-style: none; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; max-height: 320px; overflow-y: auto; box-shadow: 0 8px 24px rgba(15,23,42,0.12); }
.hm-option { padding: 0.35rem 0.6rem; cursor: pointer; }
.hm-option--on { background: #eff6ff; }
.hm-option-addr { display: block; font-weight: 600; color: #0f172a; }
.hm-option-meta { display: block; font-size: 0.7rem; color: #64748b; }
.hm-hint { margin: 0.3rem 0 0; font-size: 0.72rem; }

.hm-group { margin-top: 1rem; }
.hm-h2 { margin: 0 0 0.3rem; font-size: 0.74rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
.hm-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.55rem; }
.hm-row { display: flex; align-items: center; gap: 0.4rem; cursor: pointer; }
.hm-swatch { flex: none; width: 16px; height: 12px; border-radius: 3px; box-sizing: border-box; }
.hm-name { font-weight: 600; color: #0f172a; }
.hm-clause { margin-left: auto; font-size: 0.66rem; color: #2a78d6; white-space: nowrap; }
.hm-blurb { margin: 0.1rem 0 0 1.55rem; font-size: 0.72rem; color: #475569; }
.hm-meta { margin: 0.1rem 0 0 1.55rem; font-size: 0.66rem; color: #94a3b8; }
.hm-meta code { font-size: 0.64rem; }
.hm-zoomnote { color: #b45309; }
.hm-note { margin: 1rem 0 0; padding: 0.45rem 0.6rem; background: #fffbeb; border-left: 3px solid #d97706; border-radius: 0 6px 6px 0; font-size: 0.72rem; color: #92400e; }

.hm-tabs { display: flex; gap: 0.2rem; padding: 0.5rem 0.8rem 0; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; background: #fff; z-index: 2; }
.hm-tab { padding: 0.35rem 0.7rem; background: none; border: 0; border-bottom: 2px solid transparent; font: inherit; font-weight: 600; color: #64748b; cursor: pointer; }
.hm-tab--on { color: #0f172a; border-bottom-color: #0f172a; }

.hm-lothead { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
.hm-lotid { margin: 0; font-weight: 800; font-size: 0.95rem; color: #0f172a; }
.hm-small { margin: 0.1rem 0 0; font-size: 0.72rem; }
.hm-verdict { display: flex; flex-direction: column; gap: 0.15rem; margin: 0.7rem 0; padding: 0.6rem 0.75rem; border-radius: 10px; border: 1px solid; font-size: 0.8rem; }
.hm-verdict-word { font-weight: 800; font-size: 1rem; }
.hm-verdict--yes { background: #f0fdf4; border-color: #86efac; color: #14532d; }
.hm-verdict--no { background: #fef2f2; border-color: #fca5a5; color: #7f1d1d; }
.hm-verdict--open { background: #fffbeb; border-color: #fcd34d; color: #78350f; }
.hm-ink--yes { color: #15803d; } .hm-ink--no { color: #b91c1c; } .hm-ink--open { color: #b45309; }

.hm-h3 { margin: 1rem 0 0.4rem; font-size: 0.8rem; font-weight: 800; color: #0f172a; }
.hm-limbs { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.45rem; }
.hm-limb { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; align-items: start; }
.hm-limb--info { opacity: 0.75; }
.hm-mark { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 0.72rem; font-weight: 800; }
.hm-mark--yes { background: #dcfce7; color: #15803d; }
.hm-mark--no { background: #fee2e2; color: #b91c1c; }
.hm-mark--open { background: #fef3c7; color: #b45309; }
.hm-limb-head { margin: 0; font-weight: 600; color: #0f172a; font-size: 0.78rem; }
.hm-limb-head a { color: #2a78d6; text-decoration: none; margin-right: 0.2rem; }
.hm-limb-why { margin: 0.1rem 0 0; font-size: 0.74rem; color: #475569; }
.hm-allow, .hm-flags { margin: 0; padding-left: 1rem; display: grid; gap: 0.3rem; font-size: 0.75rem; color: #334155; }
.hm-cross { margin: 1rem 0 0.3rem; padding-top: 0.6rem; border-top: 1px solid #f1f5f9; font-size: 0.76rem; }

.hm-rsec { margin-bottom: 0.4rem; }
.hm-rule { border-bottom: 1px solid #f1f5f9; padding: 0.3rem 0; }
.hm-rule summary { cursor: pointer; font-size: 0.75rem; display: flex; gap: 0.35rem; align-items: baseline; list-style: none; }
.hm-rule summary::-webkit-details-marker { display: none; }
.hm-rule summary a { font-weight: 700; color: #2a78d6; text-decoration: none; white-space: nowrap; }
.hm-rule-gist { color: #334155; }
.hm-rule--unv summary a { color: #7c3aed; }
.hm-quote { display: block; margin: 0.35rem 0 0; font-size: 0.74rem; color: #0f172a; quotes: none; }
.hm-rule-note { margin: 0.3rem 0 0; font-size: 0.72rem; color: #92400e; }
.hm-rule-data { margin: 0.3rem 0 0; font-size: 0.72rem; color: #475569; }
.hm-rule-data code { display: inline-block; margin-left: 0.3rem; font-size: 0.66rem; color: #64748b; }
.hm-st { flex: none; display: inline-block; padding: 0 0.4rem; border-radius: 999px; border: 1px solid; font-size: 0.62rem; font-weight: 700; }
.hm-st--held { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
.hm-st--partial { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.hm-st--gap { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
.hm-st--proposal { background: #f1f5f9; border-color: #e2e8f0; color: #475569; }
.hm-src { display: block; font-size: 0.74rem; color: #2a78d6; text-decoration: none; margin-bottom: 0.2rem; }
.hm-src i { font-style: normal; color: #94a3b8; font-size: 0.66rem; }

.hm-asked { margin-bottom: 0.8rem; padding: 0.5rem 0.7rem; border: 1px dashed #cbd5e1; border-radius: 8px; font-size: 0.74rem; color: #334155; }
.hm-asked-h { margin: 0.2rem 0; font-weight: 700; }
.hm-asked ul { margin: 0.2rem 0 0.3rem; padding-left: 1.1rem; }
.hm-v { flex: none; display: inline-block; min-width: 4.6rem; text-align: center; padding: 0.05rem 0.3rem; border-radius: 999px; border: 1px solid; font-size: 0.62rem; font-weight: 700; }
.hm-v--matches { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
.hm-v--narrower, .hm-v--wider, .hm-v--different { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.hm-v--missing { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
.hm-v--unverified { background: #f5f3ff; border-color: #ddd6fe; color: #6d28d9; }

.hm-dim { color: #94a3b8; }
.hm-error { color: #b91c1c; font-size: 0.76rem; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; }

@media (max-width: 900px) {
  .hm-page { height: auto; min-height: 100vh; }
  .hm-body { display: flex; flex-direction: column; }
  .hm-panel, .hm-panel--closed { width: auto; border-right: 0; border-bottom: 1px solid #e2e8f0; max-height: none; }
  .hm-panel--closed .hm-toggle { writing-mode: horizontal-tb; height: auto; }
  .hm-mapwrap { height: 60vh; }
  .hm-guide { border-left: 0; border-top: 1px solid #e2e8f0; }
}
</style>
