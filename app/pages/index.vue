<template>
  <div class="app">

    <!-- ── Landing: Property search first, then state map ────────────────── -->
    <div v-if="view === 'landing'" class="landing">
      <h1 class="landing-title">Australian Planning Library</h1>
      <p class="landing-desc">Get a planning report for any NSW property, or browse instruments by state</p>
      <div v-if="viewCount !== null" class="view-counter">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        {{ viewCount.toLocaleString() }} views
      </div>

      <!-- Disclaimer -->
      <div class="landing-disclaimer">
        <strong>Testing Only</strong> — This tool is experimental and covers a limited set of NSW planning instruments
        (selected LEPs, SEPPs, and some DCPs). AI-generated answers may be incomplete or inaccurate.
        Always verify with official sources.
      </div>

      <!-- Property report (now at the top) -->
      <div class="property-section">
        <form class="property-form" @submit.prevent="goToReport">
          <!-- Address with autocomplete -->
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
                <!-- Owner / Buyer: due diligence — magnifying glass inspecting a house -->
                <svg v-if="p.id === 'owner'" class="persona-illus" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="roof-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#15803d"/>
                      <stop offset="100%" stop-color="#16a34a"/>
                    </linearGradient>
                    <radialGradient id="lens-grad" cx="0.35" cy="0.35" r="0.6">
                      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
                      <stop offset="50%" stop-color="#bae6fd" stop-opacity="0.25"/>
                      <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0.12"/>
                    </radialGradient>
                    <clipPath id="lens-clip">
                      <circle cx="0" cy="0" r="14"/>
                    </clipPath>
                  </defs>

                  <!-- Ground shadow -->
                  <ellipse class="illus-shadow" cx="50" cy="90" rx="28" ry="3" fill="#0f172a" opacity="0.08"/>

                  <!-- Small isometric house (being inspected) -->
                  <g class="illus-house">
                    <!-- side wall -->
                    <path d="M52 55 L72 66 L72 82 L52 71 Z" fill="#cbd5e1"/>
                    <!-- front wall -->
                    <path d="M32 66 L52 55 L52 71 L32 82 Z" fill="#e2e8f0"/>
                    <!-- roof -->
                    <path d="M32 66 L52 49 L72 66 L52 55 Z" fill="url(#roof-grad)"/>
                    <!-- door -->
                    <rect x="40" y="67" width="6" height="10" fill="#15803d" rx="1"/>
                    <!-- window -->
                    <rect x="58" y="68" width="6" height="4" fill="#bae6fd" opacity="0.8"/>
                  </g>

                  <!-- Magnifying glass (scans across on hover) -->
                  <g class="illus-magnifier">
                    <!-- Handle (angled) -->
                    <line x1="42" y1="42" x2="22" y2="22" stroke="#334155" stroke-width="5" stroke-linecap="round"/>
                    <line x1="42" y1="42" x2="22" y2="22" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
                    <!-- Lens ring -->
                    <circle cx="52" cy="52" r="15" fill="url(#lens-grad)" stroke="#334155" stroke-width="3"/>
                    <!-- Lens shine -->
                    <ellipse class="illus-shine" cx="46" cy="46" rx="4" ry="2.5" fill="#ffffff" opacity="0.7" transform="rotate(-30 46 46)"/>
                  </g>
                </svg>

                <!-- Developer / Builder: crane with swinging hook -->
                <svg v-else-if="p.id === 'developer'" class="persona-illus" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <!-- ground shadow -->
                  <ellipse class="illus-shadow" cx="50" cy="88" rx="32" ry="4" fill="#0f172a" opacity="0.08"/>
                  <!-- building under construction -->
                  <rect x="20" y="55" width="30" height="30" fill="#e2e8f0"/>
                  <rect class="illus-floor-1" x="22" y="75" width="10" height="8" fill="#15803d"/>
                  <rect class="illus-floor-2" x="34" y="70" width="10" height="13" fill="#15803d" opacity="0.7"/>
                  <rect class="illus-floor-3" x="22" y="63" width="10" height="10" fill="#15803d" opacity="0.4"/>
                  <!-- Crane vertical mast -->
                  <rect x="70" y="20" width="3" height="65" fill="#334155"/>
                  <!-- Crane base -->
                  <path d="M64 85 L79 85 L76 82 L67 82 Z" fill="#334155"/>
                  <!-- Crane arm (horizontal) -->
                  <g class="illus-crane-arm">
                    <rect x="50" y="22" width="30" height="3" fill="#334155"/>
                    <rect x="70" y="17" width="3" height="8" fill="#334155"/>
                    <!-- cable -->
                    <line class="illus-cable" x1="55" y1="25" x2="55" y2="45" stroke="#64748b" stroke-width="0.8"/>
                    <!-- hook -->
                    <rect class="illus-hook" x="53" y="45" width="4" height="4" fill="#15803d" rx="0.5"/>
                  </g>
                </svg>

                <!-- Urban Planner: planner figure writing on a clipboard with a city skyline behind -->
                <svg v-else-if="p.id === 'planner'" class="persona-illus" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <!-- ground shadow -->
                  <ellipse class="illus-shadow" cx="50" cy="90" rx="32" ry="3" fill="#0f172a" opacity="0.08"/>

                  <!-- City skyline (in the background, right side) -->
                  <g class="illus-skyline">
                    <!-- tallest building (back) -->
                    <rect class="illus-tower-1" x="56" y="20" width="12" height="58" fill="#334155"/>
                    <rect x="58" y="24" width="2" height="3" fill="#475569"/>
                    <rect x="62" y="24" width="2" height="3" fill="#475569"/>
                    <rect x="58" y="30" width="2" height="3" fill="#475569"/>
                    <rect x="62" y="30" width="2" height="3" fill="#475569"/>
                    <rect x="58" y="36" width="2" height="3" fill="#475569"/>
                    <rect x="62" y="36" width="2" height="3" fill="#475569"/>
                    <!-- roof shape -->
                    <path d="M56 20 L62 14 L68 20 Z" fill="#334155"/>

                    <!-- medium building -->
                    <rect class="illus-tower-2" x="72" y="32" width="14" height="46" fill="#475569"/>
                    <rect x="74" y="36" width="2" height="3" fill="#64748b"/>
                    <rect x="78" y="36" width="2" height="3" fill="#64748b"/>
                    <rect x="82" y="36" width="2" height="3" fill="#64748b"/>
                    <rect x="74" y="44" width="2" height="3" fill="#64748b"/>
                    <rect x="78" y="44" width="2" height="3" fill="#64748b"/>
                    <rect x="82" y="44" width="2" height="3" fill="#64748b"/>
                    <!-- flat roof with notch -->
                    <rect x="76" y="28" width="6" height="4" fill="#475569"/>
                  </g>

                  <!-- Planner figure (front-left) -->
                  <g class="illus-planner">
                    <!-- Head (with hard-hat curve) -->
                    <circle cx="25" cy="32" r="8" fill="#334155"/>
                    <!-- Hard hat band -->
                    <path d="M17 31 Q25 27 33 31 L33 33 L17 33 Z" fill="#15803d"/>

                    <!-- Body / torso -->
                    <path d="M14 42 Q14 40 16 40 L34 40 Q36 40 36 42 L38 70 Q38 72 36 72 L14 72 Q12 72 12 70 Z" fill="#334155"/>

                    <!-- Arm holding clipboard -->
                    <path class="illus-arm" d="M14 48 Q10 55 18 62 L30 62 L30 58 Q22 56 20 50 Z" fill="#334155"/>
                  </g>

                  <!-- Clipboard (in front of the planner) -->
                  <g class="illus-clipboard">
                    <!-- Board outline -->
                    <rect x="26" y="48" width="30" height="24" rx="1.5" fill="#15803d"/>
                    <!-- Paper -->
                    <rect x="28" y="50" width="26" height="20" fill="#fff"/>
                    <!-- Clip at top -->
                    <rect x="36" y="45" width="10" height="5" rx="1" fill="#166534"/>
                    <!-- Lines on paper (being written) -->
                    <line class="illus-line-1" x1="31" y1="55" x2="48" y2="55" stroke="#15803d" stroke-width="1.2" stroke-linecap="round"/>
                    <line class="illus-line-2" x1="31" y1="60" x2="44" y2="60" stroke="#15803d" stroke-width="1.2" stroke-linecap="round"/>
                    <line class="illus-line-3" x1="31" y1="65" x2="40" y2="65" stroke="#15803d" stroke-width="1.2" stroke-linecap="round"/>

                    <!-- Pen (being held) -->
                    <g class="illus-pen">
                      <line x1="46" y1="64" x2="54" y2="56" stroke="#15803d" stroke-width="2.5" stroke-linecap="round"/>
                      <circle cx="46" cy="64" r="1" fill="#166534"/>
                    </g>
                  </g>
                </svg>

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

      <!-- Divider -->
      <div class="section-divider">
        <span>or browse instruments by state</span>
      </div>

      <!-- Australia map -->
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
const propertyAddress = ref('')
const selectedPersona = ref('')
const showDisclaimer = ref(false)

const personas = [
  { id: 'owner',     label: 'Owner / Buyer',       desc: 'Due diligence report' },
  { id: 'developer', label: 'Developer / Builder', desc: 'What can I build here?' },
  { id: 'planner',   label: 'Urban Planner',       desc: 'What controls apply?' },
]

const sampleAddresses = [
  { council: 'Albury',        address: '500 DEAN STREET ALBURY',         lat: -36.0808585, lng: 146.9186013 },
  { council: 'Georges River', address: '11 MACMAHON STREET HURSTVILLE',  lat: -33.9645623, lng: 151.1030536 },
  { council: 'Parramatta',    address: '10 BOUNDARY STREET PARRAMATTA',  lat: -33.8252794, lng: 150.9978345 },
  { council: 'Randwick',      address: '43 GREVILLE STREET CLOVELLY',    lat: -33.9100136, lng: 151.2583506 },
  { council: 'Sydney',        address: '1 MARTIN PLACE SYDNEY',          lat: -33.8677948, lng: 151.2077467 },
]

function pickSampleAddress(s: { address: string; lat: number; lng: number }) {
  propertyAddress.value = s.address
  selectedLat.value = s.lat
  selectedLng.value = s.lng
  acResults.value = []
}
// ── Address autocomplete ─────────────────────────────────────────────────────

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
  margin: 1rem auto 1.5rem;
  font-size: 0.72rem;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  line-height: 1.5;
  text-align: center;
}

/* Section divider between address search and map */
.section-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 560px;
  margin: 2.5rem auto 1.5rem;
  color: #94a3b8;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
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
  gap: 0.75rem;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 1.25rem 1.5rem;
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
  display: flex;
  flex-direction: column;
  max-height: 380px;
  overflow-y: auto;
}

.ac-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 100%;
  text-align: left;
  padding: 0.6rem 1rem;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  background: none;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.08s;
}
.ac-item:last-child { border-bottom: none; }
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
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #f1f5f9;
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
  gap: 0.15rem;
  padding: 1rem 0.75rem 0.9rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  background: #fafbfc;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  text-align: center;
  overflow: hidden;
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

/* ── Persona illustrations (animated SVG icons) ─────────────────────────── */
.persona-illus {
  width: 72px;
  height: 72px;
  margin-bottom: 0.5rem;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Card hover/active — lift the whole illustration */
.persona-card:hover .persona-illus { transform: translateY(-2px); }
.persona-card--active .persona-illus { transform: translateY(-1px); }

/* House shadow settles on hover */
.illus-shadow { transition: rx 0.3s, opacity 0.3s; transform-origin: center; }
.persona-card:hover .illus-shadow { opacity: 0.12; }

/* ── Owner/Buyer: magnifying glass scans across the house ─────────────── */
.illus-magnifier {
  transform-origin: 52px 52px;
  transform-box: fill-box;
  transition: transform 0.3s;
}
.persona-card:hover .illus-magnifier {
  animation: magnifier-scan 3s ease-in-out infinite;
}
.persona-card--active .illus-magnifier {
  animation: magnifier-scan 3s ease-in-out infinite;
}
@keyframes magnifier-scan {
  0%, 100% { transform: translate(0, 0) rotate(-5deg); }
  25% { transform: translate(-6px, -3px) rotate(-10deg); }
  50% { transform: translate(4px, 2px) rotate(3deg); }
  75% { transform: translate(6px, -2px) rotate(8deg); }
}
.illus-shine {
  transform-origin: center;
}
.persona-card:hover .illus-shine,
.persona-card--active .illus-shine {
  animation: shine-pulse 1.5s ease-in-out infinite;
}
@keyframes shine-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.9; }
}
.illus-house { transition: filter 0.3s; }
.persona-card:hover .illus-house,
.persona-card--active .illus-house {
  filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.15));
}

/* ── Developer/Crane: arm swings, hook bobs, floors build up ─────────── */
.illus-crane-arm {
  transform-origin: 72px 22px;
  transform-box: fill-box;
}
.persona-card:hover .illus-crane-arm {
  animation: crane-swing 3s ease-in-out infinite;
}
@keyframes crane-swing {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(8deg); }
}
.illus-hook {
  transform-origin: 55px 47px;
}
.persona-card:hover .illus-hook {
  animation: hook-bob 1.5s ease-in-out infinite;
}
@keyframes hook-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(3px); }
}
.illus-floor-1, .illus-floor-2, .illus-floor-3 { transition: opacity 0.3s, transform 0.3s; transform-origin: bottom; }
.persona-card:hover .illus-floor-3 { animation: floor-rise 2s ease-in-out infinite; }
@keyframes floor-rise {
  0% { opacity: 0; transform: scaleY(0); }
  50%, 100% { opacity: 0.4; transform: scaleY(1); }
}

/* ── Planner: pen writing lines, clipboard tilts, skyline stands tall ── */
.illus-clipboard {
  transform-origin: 40px 60px;
  transform-box: fill-box;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.persona-card:hover .illus-clipboard,
.persona-card--active .illus-clipboard {
  animation: clipboard-tilt 3s ease-in-out infinite;
}
@keyframes clipboard-tilt {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(1deg); }
}

.illus-pen {
  transform-origin: 46px 64px;
  transform-box: fill-box;
}
.persona-card:hover .illus-pen,
.persona-card--active .illus-pen {
  animation: pen-write 2s ease-in-out infinite;
}
@keyframes pen-write {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  25%  { transform: translate(-1px, 1px) rotate(-3deg); }
  50%  { transform: translate(1px, -1px) rotate(2deg); }
  75%  { transform: translate(-2px, 0) rotate(-2deg); }
}

/* Pen lines draw one after another */
.illus-line-1, .illus-line-2, .illus-line-3 {
  stroke-dasharray: 20;
  stroke-dashoffset: 20;
  transition: stroke-dashoffset 0.6s ease-out;
}
.persona-card:hover .illus-line-1,
.persona-card--active .illus-line-1 {
  animation: line-draw 3s ease-in-out infinite;
  animation-delay: 0s;
}
.persona-card:hover .illus-line-2,
.persona-card--active .illus-line-2 {
  animation: line-draw 3s ease-in-out infinite;
  animation-delay: 0.3s;
}
.persona-card:hover .illus-line-3,
.persona-card--active .illus-line-3 {
  animation: line-draw 3s ease-in-out infinite;
  animation-delay: 0.6s;
}
@keyframes line-draw {
  0%   { stroke-dashoffset: 20; }
  40%  { stroke-dashoffset: 0; }
  90%  { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: 20; }
}

/* Subtle sway on the planner figure */
.illus-planner { transition: transform 0.3s; transform-origin: 25px 70px; transform-box: fill-box; }
.persona-card:hover .illus-planner,
.persona-card--active .illus-planner {
  animation: planner-lean 3s ease-in-out infinite;
}
@keyframes planner-lean {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-1deg); }
}

/* Skyline shadow on hover */
.illus-skyline { transition: filter 0.3s; }
.persona-card:hover .illus-skyline,
.persona-card--active .illus-skyline {
  filter: drop-shadow(0 2px 3px rgba(15, 23, 42, 0.2));
}

/* Active state persists the other animations */
.persona-card--active .illus-crane-arm { animation: crane-swing 3s ease-in-out infinite; }
.persona-card--active .illus-hook { animation: hook-bob 1.5s ease-in-out infinite; }

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
