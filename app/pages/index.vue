<template>
  <div class="app">

    <!-- ── Landing: Map of Australia ─────────────────────────────────────── -->
    <div v-if="view === 'landing'" class="landing">
      <h1 class="landing-title">Australian Planning Library</h1>
      <p class="landing-desc">Select a state to browse planning instruments</p>
      <div v-if="viewCount !== null" class="view-counter">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        {{ viewCount.toLocaleString() }} views
      </div>

      <div class="map-container">
        <svg
          :viewBox="auMap.viewBox"
          class="au-map"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            v-for="loc in auMap.locations"
            :key="loc.id"
            :d="loc.path"
            :class="['au-state', stateClass(loc.id)]"
            @click="handleMapClick(loc.id)"
            @mouseenter="handleMapHover(loc.id)"
            @mouseleave="hoveredState = null"
          >
            <title>{{ loc.name }}</title>
          </path>
        </svg>

        <!-- State label overlay -->
        <div class="map-label" v-if="hoveredState">
          <span class="map-label-name">{{ hoveredState.name }}</span>
          <span v-if="hoveredState.active" class="map-label-count">
            {{ totalCount(hoveredState.key) }} instruments
          </span>
          <span v-else class="map-label-soon">Coming soon</span>
        </div>
      </div>

      <!-- Legend -->
      <div class="map-legend">
        <span class="map-legend-item">
          <span class="map-legend-dot map-legend-dot--active"></span>
          Available
        </span>
        <span class="map-legend-item">
          <span class="map-legend-dot map-legend-dot--disabled"></span>
          Coming soon
        </span>
      </div>

      <!-- Disclaimer -->
      <div class="landing-disclaimer">
        <strong>Testing Only</strong> — This tool is experimental and covers a limited set of NSW planning instruments
        (selected LEPs, SEPPs, and some DCPs). AI-generated answers may be incomplete or inaccurate.
        Always verify with official sources.
      </div>

      <!-- Property report -->
      <div class="property-section">
        <form class="property-form" @submit.prevent="goToReport">
          <!-- Address with Mapbox autocomplete -->
          <div class="address-autocomplete">
            <label class="property-field-label">Property address</label>
            <input
              v-model="propertyAddress"
              type="text"
              class="property-input"
              placeholder="Start typing an address — e.g. 15 Smith Street, Albury"
              @input="onAddressInput"
              @keydown.down.prevent="acIndex = Math.min(acIndex + 1, acResults.length - 1)"
              @keydown.up.prevent="acIndex = Math.max(acIndex - 1, 0)"
              @keydown.enter.prevent="acResults.length ? selectAddress(acResults[acIndex]) : null"
              @blur="dismissAc"
              autocomplete="off"
            >
            <div v-if="acResults.length" class="ac-dropdown">
              <button
                v-for="(r, i) in acResults"
                :key="r.id"
                :class="['ac-item', { 'ac-item--active': i === acIndex }]"
                @mousedown.prevent="selectAddress(r)"
                type="button"
              >
                <span class="ac-item-main">{{ r.text }}</span>
                <span class="ac-item-context">{{ r.context }}</span>
              </button>
            </div>
          </div>

          <!-- Sample addresses -->
          <div class="sample-addresses">
            <span class="sample-addresses-label">Try one of these:</span>
            <button
              v-for="s in sampleAddresses"
              :key="s.address"
              type="button"
              class="sample-address-chip"
              @click="pickSampleAddress(s)"
            >
              <span class="sample-address-council">{{ s.council }}</span>
              <span class="sample-address-text">{{ s.address }}</span>
            </button>
          </div>

          <!-- Persona selector -->
          <div class="persona-selector">
            <label class="property-field-label">I am a…</label>
            <div class="persona-cards">
              <button
                v-for="p in personas"
                :key="p.id"
                type="button"
                :class="['persona-card', { 'persona-card--active': selectedPersona === p.id }]"
                @click="selectedPersona = p.id"
              >
                <span class="persona-name">{{ p.label }}</span>
                <span class="persona-desc">{{ p.desc }}</span>
              </button>
            </div>
          </div>

          <button class="property-btn" :disabled="!selectedLat || !selectedPersona" type="submit">
            Generate Report
          </button>
        </form>
      </div>
    </div>

    <!-- Disclaimer modal (first visit only) -->
    <div v-if="showDisclaimer" class="disclaimer-overlay" @click.self="dismissDisclaimer">
      <div class="disclaimer-modal">
        <h2 class="disclaimer-title">Welcome to the Australian Planning Library</h2>
        <p class="disclaimer-text">
          This application is for <strong>testing and research purposes only</strong>.
          It currently covers a limited set of NSW planning instruments including selected
          Local Environmental Plans (LEPs), State Environmental Planning Policies (SEPPs),
          and some Development Control Plans (DCPs).
        </p>
        <p class="disclaimer-text">
          AI-generated answers may be incomplete or inaccurate.
          Always verify information with official sources before making planning decisions.
        </p>
        <button class="disclaimer-btn" @click="dismissDisclaimer">I understand</button>
      </div>
    </div>

    <!-- ── Category + Document list ─────────────────────────────────────── -->
    <div v-if="view === 'list'" class="list-view">
      <div class="list-header">
        <button class="back-btn" @click="view = 'landing'">&larr; States</button>
        <h2 class="list-title">{{ index?.[selectedState]?.label }}</h2>
      </div>

      <div class="category-tabs">
        <button
          v-for="cat in categoryList"
          :key="cat.key"
          :class="['cat-tab', { active: selectedCategory === cat.key }]"
          @click="selectedCategory = cat.key"
        >
          {{ cat.label }}
          <span class="cat-count">{{ cat.count }}</span>
        </button>
      </div>

      <div class="list-search-wrap">
        <input
          v-model="docSearch"
          type="text"
          class="list-search"
          placeholder="Search documents..."
          @keydown.escape="docSearch = ''"
        >
      </div>

      <div class="doc-list">
        <button
          v-for="doc in filteredDocs"
          :key="doc.slug"
          class="doc-item"
          @click="openDocument(doc)"
        >
          <span class="doc-type-badge" :class="'doc-type-badge--' + selectedCategory">
            {{ selectedCategory.toUpperCase() }}
          </span>
          <span class="doc-title">{{ doc.title }}</span>
        </button>
        <p v-if="filteredDocs.length === 0" class="doc-empty">No documents match your search</p>
      </div>
    </div>

    <!-- ── Document viewer ──────────────────────────────────────────────── -->
    <div v-if="view === 'document'" class="doc-view">
      <div class="doc-topbar">
        <button class="back-btn" @click="closeDocument">&larr; Back to list</button>
        <span class="doc-topbar-title">{{ currentDoc?.title }}</span>
      </div>

      <div class="doc-layout">
        <!-- TOC sidebar -->
        <aside class="doc-toc">
          <h3 class="doc-toc-title">Contents</h3>
          <div class="doc-toc-list">
            <button
              v-for="(item, i) in toc"
              :key="i"
              :class="['doc-toc-item', 'doc-toc-level-' + item.level]"
              @click="scrollToHeading(item.id)"
            >
              {{ item.text }}
            </button>
          </div>
        </aside>

        <!-- Document content -->
        <div class="doc-content-wrap" ref="docContentEl">
          <div v-if="docLoading" class="doc-loading">Loading document...</div>
          <div v-else class="doc-content" v-html="renderedHtml"></div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { marked } from 'marked'
import { usePageViews } from '~/composables/usePageViews'

const { viewCount } = usePageViews()
import Australia from '@svg-maps/australia'

// ── Types ────────────────────────────────────────────────────────────────────

interface DocItem {
  slug: string
  title: string
  file: string
}

interface Category {
  label: string
  items: DocItem[]
}

interface StateData {
  label: string
  categories: Record<string, Category>
}

type InstrumentsIndex = Record<string, StateData>

// ── State ────────────────────────────────────────────────────────────────────

const view = ref<'landing' | 'list' | 'document'>('landing')
const index = ref<InstrumentsIndex | null>(null)
const selectedState = ref('nsw')
const selectedCategory = ref('lep')
const docSearch = ref('')
const currentDoc = ref<DocItem | null>(null)
const docLoading = ref(false)
const rawMarkdown = ref('')
const docContentEl = ref<HTMLDivElement | null>(null)
const hoveredState = ref<{ name: string; key: string; active: boolean } | null>(null)
const askQuery = ref('')
const propertyAddress = ref('')
const selectedPersona = ref('')
const showDisclaimer = ref(false)

const personas = [
  { id: 'owner',     label: 'Owner / Buyer',       desc: 'What can I do with this property?' },
  { id: 'developer', label: 'Developer / Builder', desc: 'What can I build here?' },
  { id: 'planner',   label: 'Urban Planner',       desc: 'What controls apply?' },
]

const sampleAddresses = [
  { council: 'Albury',        address: '500 DEAN STREET ALBURY',             lat: -36.0737, lng: 146.9135 },
  { council: 'Georges River', address: '2 MACMAHON STREET HURSTVILLE',       lat: -33.9670, lng: 151.1020 },
  { council: 'Parramatta',    address: '10 BOUNDARY STREET PARRAMATTA',      lat: -33.8148, lng: 151.0035 },
  { council: 'Randwick',      address: '43 GREVILLE STREET CLOVELLY',        lat: -33.9100, lng: 151.2584 },
  { council: 'Sydney',        address: '1 MARTIN PLACE SYDNEY',              lat: -33.8679, lng: 151.2073 },
]

function pickSampleAddress(s: { address: string; lat: number; lng: number }) {
  propertyAddress.value = s.address
  selectedLat.value = s.lat
  selectedLng.value = s.lng
  acResults.value = []
}
const askInputEl = ref<HTMLTextAreaElement | null>(null)

// ── Mapbox address autocomplete ──────────────────────────────────────────────

interface AcResult { id: string; text: string; context: string; place_name: string; lat: number; lng: number }

const acResults = ref<AcResult[]>([])
const acIndex = ref(0)
const selectedLat = ref<number | null>(null)
const selectedLng = ref<number | null>(null)
let acDebounce: ReturnType<typeof setTimeout> | null = null

function onAddressInput() {
  acIndex.value = 0
  selectedLat.value = null
  selectedLng.value = null
  if (acDebounce) clearTimeout(acDebounce)
  const q = propertyAddress.value.trim()
  if (q.length < 3) { acResults.value = []; return }
  acDebounce = setTimeout(() => fetchAddressSuggestions(q), 250)
}

async function fetchAddressSuggestions(q: string) {
  try {
    const resp = await fetch(`/api/address-autocomplete?q=${encodeURIComponent(q)}`)
    if (!resp.ok) return
    const data = await resp.json()
    acResults.value = (data.results || []).map((r: any, i: number) => ({
      id: `${r.address}-${i}`,
      text: r.address,
      context: [r.suburbname, r.lga_name, r.postcode].filter(Boolean).join(', '),
      place_name: r.address,
      lat: Number(r.centroid_lat),
      lng: Number(r.centroid_lon),
    }))
  } catch {}
}

function dismissAc() {
  setTimeout(() => { acResults.value = [] }, 200)
}

function selectAddress(r: AcResult) {
  propertyAddress.value = r.place_name
  selectedLat.value = r.lat
  selectedLng.value = r.lng
  acResults.value = []
}

function autoResizeAsk(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

// ── Map data ─────────────────────────────────────────────────────────────────

const auMap = Australia

// Map SVG location IDs to state keys used in instruments.json
const STATE_MAP: Record<string, { key: string; name: string }> = {
  'nsw':                { key: 'nsw', name: 'New South Wales' },
  'act':                { key: 'act', name: 'Australian Capital Territory' },
  'vic':                { key: 'vic', name: 'Victoria' },
  'qld-mainland':       { key: 'qld', name: 'Queensland' },
  'qld-fraser-island':  { key: 'qld', name: 'Queensland' },
  'qld-mornington-island': { key: 'qld', name: 'Queensland' },
  'sa-mainland':        { key: 'sa',  name: 'South Australia' },
  'sa-kangaroo-island': { key: 'sa',  name: 'South Australia' },
  'wa':                 { key: 'wa',  name: 'Western Australia' },
  'tas-mainland':       { key: 'tas', name: 'Tasmania' },
  'tas-flinders-island':{ key: 'tas', name: 'Tasmania' },
  'tas-cape-barren':    { key: 'tas', name: 'Tasmania' },
  'tas-king-currie-island': { key: 'tas', name: 'Tasmania' },
  'nt-mainland':        { key: 'nt',  name: 'Northern Territory' },
  'nt-melville-island': { key: 'nt',  name: 'Northern Territory' },
  'nt-groote-eylandt':  { key: 'nt',  name: 'Northern Territory' },
}

const ACTIVE_STATES = new Set(['nsw'])

function stateClass(locId: string): string {
  const state = STATE_MAP[locId]
  if (!state) return 'au-state--disabled'
  return ACTIVE_STATES.has(state.key) ? 'au-state--active' : 'au-state--disabled'
}

function handleMapClick(locId: string) {
  const state = STATE_MAP[locId]
  if (state && ACTIVE_STATES.has(state.key)) {
    selectState(state.key)
  }
}

function handleMapHover(locId: string) {
  const state = STATE_MAP[locId]
  if (state) {
    hoveredState.value = {
      name: state.name,
      key: state.key,
      active: ACTIVE_STATES.has(state.key),
    }
  }
}

// ── Load index on mount ──────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const resp = await fetch('/instruments.json')
    index.value = await resp.json()
  } catch (e) {
    console.error('Failed to load instruments index:', e)
  }

  // Show disclaimer on first visit
  if (import.meta.client) {
    const dismissed = localStorage.getItem('planning-lib-disclaimer')
    if (!dismissed) {
      showDisclaimer.value = true
    }
  }
})

function dismissDisclaimer() {
  showDisclaimer.value = false
  if (import.meta.client) {
    localStorage.setItem('planning-lib-disclaimer', '1')
  }
}

const router = useRouter()
function goToAsk() {
  const q = askQuery.value.trim()
  if (q) {
    router.push({ path: '/ask', query: { q } })
  }
}

function goToReport() {
  if (!selectedLat.value || !selectedLng.value || !selectedPersona.value) return
  router.push({
    path: '/report',
    query: {
      lat: String(selectedLat.value),
      lng: String(selectedLng.value),
      address: propertyAddress.value,
      persona: selectedPersona.value,
    },
  })
}

// ── Computed ─────────────────────────────────────────────────────────────────

function totalCount(stateKey: string): number {
  const state = index.value?.[stateKey]
  if (!state) return 0
  return Object.values(state.categories).reduce((sum, cat) => sum + cat.items.length, 0)
}

const categoryList = computed(() => {
  const state = index.value?.[selectedState.value]
  if (!state) return []
  return Object.entries(state.categories).map(([key, cat]) => ({
    key,
    label: cat.label,
    count: cat.items.length,
  }))
})

const currentItems = computed((): DocItem[] => {
  const state = index.value?.[selectedState.value]
  if (!state) return []
  return state.categories[selectedCategory.value]?.items ?? []
})

const filteredDocs = computed(() => {
  const q = docSearch.value.toLowerCase().trim()
  if (!q) return currentItems.value
  return currentItems.value.filter(d => d.title.toLowerCase().includes(q))
})

// ── TOC extraction ───────────────────────────────────────────────────────────

interface TocItem {
  level: number
  text: string
  id: string
}

const toc = computed((): TocItem[] => {
  if (!rawMarkdown.value) return []
  let headingIndex = 0
  return rawMarkdown.value.split('\n')
    .filter(l => /^#{1,3}\s/.test(l))
    .map(l => {
      const level = l.match(/^#+/)![0].length
      const text = l.replace(/^#+\s*/, '').replace(/\s*\[.*\]\s*$/, '').trim()
      const id = 'heading-' + (headingIndex++)
      return { level, text, id }
    })
})

// ── Rendered HTML ────────────────────────────────────────────────────────────

const IMG_BASE = 'https://static.heenco.com/EPI/DCPs'

const renderedHtml = computed(() => {
  if (!rawMarkdown.value) return ''
  let headingIndex = 0
  const renderer = new marked.Renderer()
  renderer.heading = function ({ text, depth }: { text: string; depth: number }) {
    const id = 'heading-' + (headingIndex++)
    return `<h${depth} id="${id}">${text}</h${depth}>\n`
  }
  // Resolve relative image paths to static.heenco.com for DCP documents
  renderer.image = function ({ href, text }: { href: string; text: string }) {
    const src = href.startsWith('http') || href.startsWith('/')
      ? href
      : `${IMG_BASE}/${href}`
    return `<img src="${src}" alt="${text || ''}" loading="lazy" style="max-width:100%;height:auto;border-radius:6px;margin:1em 0;border:1px solid #e5e7eb;" />`
  }
  return marked.parse(rawMarkdown.value, { renderer }) as string
})

// ── Actions ──────────────────────────────────────────────────────────────────

function selectState(stateKey: string) {
  selectedState.value = stateKey
  const state = index.value?.[stateKey]
  if (state) {
    const cats = Object.keys(state.categories)
    selectedCategory.value = cats[0] || 'lep'
  }
  view.value = 'list'
}

async function openDocument(doc: DocItem) {
  currentDoc.value = doc
  docLoading.value = true
  rawMarkdown.value = ''
  view.value = 'document'

  try {
    const resp = await fetch('/' + doc.file)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    rawMarkdown.value = await resp.text()
  } catch (e) {
    rawMarkdown.value = `# Error\n\nFailed to load document: ${e}`
  } finally {
    docLoading.value = false
  }
}

function closeDocument() {
  view.value = 'list'
  currentDoc.value = null
  rawMarkdown.value = ''
}

function scrollToHeading(id: string) {
  nextTick(() => {
    const el = docContentEl.value?.querySelector(`#${CSS.escape(id)}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
</script>

<style>
/* ── Reset / base ─────────────────────────────────────────────────────────── */
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Figtree", "Segoe UI", system-ui, sans-serif;
  background: #f8fafb;
  color: #1e293b;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app {
  min-height: 100vh;
}

/* ── Landing ──────────────────────────────────────────────────────────────── */
.landing {
  max-width: 700px;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  text-align: center;
}

.landing-title {
  font-size: 2rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 0.4rem;
}

.landing-desc {
  color: #64748b;
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.view-counter {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 1.5rem;
}

/* ── Map ──────────────────────────────────────────────────────────────────── */
.map-container {
  position: relative;
  max-width: 500px;
  margin: 0 auto 1.5rem;
}

.au-map {
  width: 100%;
  height: auto;
}

.au-state {
  stroke: #fff;
  stroke-width: 0.5;
  transition: fill 0.2s, opacity 0.2s;
}

.au-state--active {
  fill: #15803d;
  cursor: pointer;
}

.au-state--active:hover {
  fill: #166534;
  filter: drop-shadow(0 2px 6px rgba(21, 128, 61, 0.35));
}

.au-state--disabled {
  fill: #cbd5e1;
  cursor: default;
}

.au-state--disabled:hover {
  fill: #b0bcc9;
}

.map-label {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.5rem 0.8rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  pointer-events: none;
}

.map-label-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: #0f172a;
}

.map-label-count {
  font-size: 0.72rem;
  color: #15803d;
  font-weight: 500;
}

.map-label-soon {
  font-size: 0.72rem;
  color: #94a3b8;
  font-style: italic;
}

.map-legend {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  font-size: 0.78rem;
  color: #64748b;
}

.map-legend-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.map-legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.map-legend-dot--active {
  background: #15803d;
}

.map-legend-dot--disabled {
  background: #cbd5e1;
}

.landing-disclaimer {
  max-width: 500px;
  margin: 1rem auto 0;
  font-size: 0.72rem;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  line-height: 1.5;
  text-align: center;
}

/* ── Disclaimer modal ─────────────────────────────────────────────────────── */
.disclaimer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.disclaimer-modal {
  background: #fff;
  border-radius: 16px;
  padding: 2rem 2.5rem;
  max-width: 480px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.disclaimer-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 1rem;
}

.disclaimer-text {
  font-size: 0.88rem;
  color: #475569;
  line-height: 1.6;
  margin: 0 0 0.75rem;
}

.disclaimer-btn {
  display: block;
  width: 100%;
  padding: 0.7rem;
  margin-top: 1.25rem;
  background: #15803d;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.disclaimer-btn:hover { background: #166534; }

/* ── Sample addresses ─────────────────────────────────────────────────────── */
.sample-addresses {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
}

.sample-addresses-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin-right: 0.25rem;
}

.sample-address-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.3rem 0.6rem;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  text-align: left;
}

.sample-address-chip:hover {
  background: #f0fdf4;
  border-color: #15803d;
}

.sample-address-council {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #15803d;
}

.sample-address-text {
  font-size: 0.75rem;
  color: #334155;
}

/* ── Property section ─────────────────────────────────────────────────────── */
.property-section {
  margin-top: 2rem;
  max-width: 760px;
  margin-left: auto;
  margin-right: auto;
}

.property-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 0 1.25rem;
  color: #94a3b8;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.property-divider::before,
.property-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.property-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 1rem 1.25rem;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  transition: border-color 0.15s;
}
.property-form:focus-within {
  border-color: #15803d;
}

.address-autocomplete {
  position: relative;
}

.property-input {
  width: 100%;
  border: none;
  outline: none;
  font-size: 0.95rem;
  font-family: inherit;
  color: #0f172a;
  padding: 0.3rem 0;
  border-bottom: 1px solid #f1f5f9;
}
.property-input::placeholder { color: #94a3b8; }

.ac-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: -1.25rem;
  right: -1.25rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 50;
  overflow: hidden;
}

.ac-item {
  display: flex;
  flex-direction: column;
  width: 100%;
  text-align: left;
  padding: 0.55rem 1rem;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.08s;
}
.ac-item:hover,
.ac-item--active {
  background: #f0fdf4;
}

.ac-item-main {
  font-size: 0.85rem;
  color: #0f172a;
  font-weight: 500;
}

.ac-item-context {
  font-size: 0.72rem;
  color: #94a3b8;
}

.property-question {
  border: none;
  outline: none;
  resize: none;
  font-size: 0.88rem;
  font-family: inherit;
  color: #0f172a;
  padding: 0.3rem 0;
  min-height: 36px;
  max-height: 120px;
}
.property-question::placeholder { color: #b0bcc9; }

.property-btn {
  align-self: flex-end;
  padding: 0.5rem 1.2rem;
  background: #0f172a;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.property-btn:hover:not(:disabled) { background: #1e293b; }
.property-btn:disabled { background: #cbd5e1; cursor: not-allowed; }

.property-field-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 0.3rem;
  display: block;
}

/* ── Persona cards ────────────────────────────────────────────────────────── */
.persona-selector {
  display: flex;
  flex-direction: column;
}

.persona-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.persona-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.5rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  background: #fafbfc;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
  text-align: center;
}
.persona-card:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}
.persona-card--active {
  border-color: #15803d;
  background: #f0fdf4;
  box-shadow: 0 0 0 1px #15803d;
}

.persona-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #0f172a;
}

.persona-desc {
  font-size: 0.68rem;
  color: #94a3b8;
  line-height: 1.3;
}

/* ── List view ────────────────────────────────────────────────────────────── */
.list-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.list-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.back-btn {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  color: #475569;
  cursor: pointer;
  transition: all 0.1s;
  font-family: inherit;
  white-space: nowrap;
}

.back-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.list-title {
  font-size: 1.4rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.category-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 2px solid #e2e8f0;
  padding-bottom: 0;
}

.cat-tab {
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  padding: 0.6rem 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  margin-bottom: -2px;
}

.cat-tab:hover {
  color: #334155;
}

.cat-tab.active {
  color: #15803d;
  border-bottom-color: #15803d;
}

.cat-count {
  background: #f1f5f9;
  color: #64748b;
  padding: 0.1rem 0.4rem;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 500;
  margin-left: 0.3rem;
}

.cat-tab.active .cat-count {
  background: #dcfce7;
  color: #15803d;
}

.list-search-wrap {
  margin-bottom: 1rem;
}

.list-search {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}

.list-search:focus {
  border-color: #15803d;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.doc-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  text-align: left;
  padding: 0.7rem 0.9rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.1s;
  font-family: inherit;
}

.doc-item:hover {
  border-color: #15803d;
  background: #f0fdf4;
}

.doc-type-badge {
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.2rem 0.45rem;
  border-radius: 4px;
  letter-spacing: 0.03em;
}

.doc-type-badge--lep {
  background: #dbeafe;
  color: #1d4ed8;
}

.doc-type-badge--sepp {
  background: #fef3c7;
  color: #b45309;
}

.doc-type-badge--dcp {
  background: #dcfce7;
  color: #15803d;
}

.doc-title {
  font-size: 0.88rem;
  color: #1e293b;
}

.doc-empty {
  text-align: center;
  color: #94a3b8;
  padding: 2rem;
  font-size: 0.85rem;
}

/* ── Document viewer ──────────────────────────────────────────────────────── */
.doc-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.doc-topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1.25rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.doc-topbar-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* TOC sidebar */
.doc-toc {
  width: 280px;
  min-width: 220px;
  border-right: 1px solid #e2e8f0;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

.doc-toc-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1rem 1rem 0.5rem;
  margin: 0;
}

.doc-toc-list {
  overflow-y: auto;
  flex: 1;
  padding: 0 0.5rem 1rem;
}

.doc-toc-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.75rem;
  color: #475569;
  cursor: pointer;
  transition: background 0.1s;
  font-family: inherit;
  line-height: 1.4;
}

.doc-toc-item:hover {
  background: #e2e8f0;
}

.doc-toc-level-1 {
  font-weight: 700;
  font-size: 0.78rem;
  color: #0f172a;
  margin-top: 0.5rem;
}

.doc-toc-level-2 {
  padding-left: 1.2rem;
}

.doc-toc-level-3 {
  padding-left: 2rem;
  font-size: 0.72rem;
  color: #64748b;
}

/* Document content area */
.doc-content-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 2rem 3rem 4rem;
}

.doc-loading {
  text-align: center;
  color: #94a3b8;
  padding: 3rem;
}

/* ── Markdown rendered content styling ────────────────────────────────────── */
.doc-content {
  max-width: 800px;
  font-size: 0.95rem;
  line-height: 1.75;
  color: #1e293b;
}

.doc-content h1 {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin: 2.5rem 0 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #15803d;
}

.doc-content h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: #1e293b;
  margin: 2rem 0 0.5rem;
}

.doc-content h3 {
  font-size: 1rem;
  font-weight: 600;
  color: #334155;
  margin: 1.5rem 0 0.4rem;
}

.doc-content h4 {
  font-size: 0.95rem;
  font-weight: 600;
  color: #475569;
  margin: 1rem 0 0.3rem;
}

.doc-content p {
  margin: 0.5rem 0;
}

.doc-content ul,
.doc-content ol {
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}

.doc-content li {
  margin: 0.25rem 0;
}

.doc-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.85rem;
}

.doc-content th,
.doc-content td {
  border: 1px solid #d1d5db;
  padding: 0.4rem 0.6rem;
  text-align: left;
  vertical-align: top;
}

.doc-content th {
  background: #f1f5f9;
  font-weight: 600;
  color: #334155;
}

.doc-content tr:nth-child(even) {
  background: #fafbfc;
}

.doc-content blockquote {
  border-left: 3px solid #15803d;
  margin: 0.5rem 0;
  padding: 0.3rem 0.8rem;
  color: #475569;
  background: #f0fdf4;
  border-radius: 0 4px 4px 0;
}

.doc-content code {
  background: #f1f5f9;
  padding: 0.15rem 0.3rem;
  border-radius: 3px;
  font-size: 0.85em;
}

.doc-content pre {
  background: #f1f5f9;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
}

.doc-content hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 1.5rem 0;
}

.doc-content a {
  color: #15803d;
  text-decoration: none;
}

.doc-content a:hover {
  text-decoration: underline;
}

/* Hide HTML comments rendered by marked */
.doc-content > p:first-child:empty {
  display: none;
}
</style>
