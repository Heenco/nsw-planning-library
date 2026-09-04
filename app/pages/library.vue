<!--
  /library

  Full catalogue of every planning instrument in the library.
  Pick a state on the Australia map (or in the rail beneath it), then browse
  or search its LEPs, SEPPs and DCPs. Documents open in /doc-viewer.

  Data source: /instruments.json — the same index the landing page uses.
-->

<template>
  <div class="lib-page">

    <!-- ── Header ───────────────────────────────────────────────────────── -->
    <header class="lib-header">
      <div class="lib-header-left">
        <NuxtLink to="/" class="lib-back">&larr; Home</NuxtLink>
        <h1 class="lib-title">Planning Library</h1>
      </div>
      <div v-if="!loading && !loadError" class="lib-header-stat">
        <strong>{{ grandTotal }}</strong> documents ·
        <strong>{{ activeStateCount }}</strong> {{ activeStateCount === 1 ? 'state' : 'states' }}
      </div>
    </header>

    <p v-if="loading" class="lib-status">Loading library…</p>
    <p v-else-if="loadError" class="lib-status lib-status--error">{{ loadError }}</p>

    <div v-else class="lib-layout">

      <!-- ── Left rail: map + state list ───────────────────────────────── -->
      <aside class="lib-rail">
        <div class="lib-map-wrap">
          <svg :viewBox="auMap.viewBox" class="lib-map" xmlns="http://www.w3.org/2000/svg">
            <path
              v-for="loc in auMap.locations"
              :key="loc.id"
              :d="loc.path"
              :class="[
                'lib-state',
                hasDocs(stateKeyOf(loc.id)) ? 'lib-state--active' : 'lib-state--empty',
                stateKeyOf(loc.id) === selectedState ? 'lib-state--selected' : '',
              ]"
              @click="selectState(stateKeyOf(loc.id))"
              @mouseenter="hovered = stateKeyOf(loc.id)"
              @mouseleave="hovered = null"
            >
              <title>{{ stateNameOf(loc.id) }}</title>
            </path>
          </svg>

          <div v-if="hovered" class="lib-map-tip">
            <span class="lib-map-tip-name">{{ STATE_NAMES[hovered] }}</span>
            <span v-if="hasDocs(hovered)" class="lib-map-tip-count">
              {{ totalFor(hovered) }} documents
            </span>
            <span v-else class="lib-map-tip-soon">Coming soon</span>
          </div>
        </div>

        <div class="lib-legend">
          <span class="lib-legend-item">
            <span class="lib-legend-dot lib-legend-dot--active"></span>Available
          </span>
          <span class="lib-legend-item">
            <span class="lib-legend-dot lib-legend-dot--empty"></span>Coming soon
          </span>
        </div>

        <ul class="lib-state-list">
          <li v-for="key in STATE_ORDER" :key="key">
            <button
              type="button"
              class="lib-state-btn"
              :class="{
                'lib-state-btn--on': key === selectedState,
                'lib-state-btn--empty': !hasDocs(key),
              }"
              @click="selectState(key)"
            >
              <span class="lib-state-abbr">{{ key.toUpperCase() }}</span>
              <span class="lib-state-name">{{ STATE_NAMES[key] }}</span>
              <span v-if="hasDocs(key)" class="lib-state-count">{{ totalFor(key) }}</span>
              <span v-else class="lib-state-soon">—</span>
            </button>
          </li>
        </ul>
      </aside>

      <!-- ── Main: categories + documents ──────────────────────────────── -->
      <section class="lib-main">
        <div class="lib-main-head">
          <h2 class="lib-state-title">{{ STATE_NAMES[selectedState] }}</h2>
          <p v-if="hasDocs(selectedState)" class="lib-state-sub">
            {{ totalFor(selectedState) }} documents across
            {{ categories.length }} {{ categories.length === 1 ? 'category' : 'categories' }}
          </p>
          <p v-else class="lib-state-sub">No instruments loaded for this state yet.</p>
        </div>

        <template v-if="hasDocs(selectedState)">
          <!-- Category summary cards -->
          <div class="lib-cards">
            <button
              v-for="cat in categories"
              :key="cat.key"
              type="button"
              class="lib-card"
              :class="[`lib-card--${cat.key}`, { 'lib-card--on': filter === cat.key }]"
              @click="filter = filter === cat.key ? 'all' : cat.key"
            >
              <span class="lib-card-abbr">{{ cat.key.toUpperCase() }}</span>
              <span class="lib-card-count">{{ cat.count }}</span>
              <span class="lib-card-label">{{ cat.label }}</span>
            </button>
          </div>

          <!-- Filter + search -->
          <div class="lib-controls">
            <div class="lib-chips">
              <button
                type="button"
                class="lib-chip"
                :class="{ 'lib-chip--on': filter === 'all' }"
                @click="filter = 'all'"
              >
                All<span class="lib-chip-count">{{ totalFor(selectedState) }}</span>
              </button>
              <button
                v-for="cat in categories"
                :key="cat.key"
                type="button"
                class="lib-chip"
                :class="{ 'lib-chip--on': filter === cat.key }"
                @click="filter = cat.key"
              >
                {{ cat.key.toUpperCase() }}<span class="lib-chip-count">{{ cat.count }}</span>
              </button>
            </div>

            <input
              v-model="search"
              type="search"
              class="lib-search"
              placeholder="Search documents — e.g. Randwick, housing, 2021"
              @keydown.escape="search = ''"
            >
          </div>

          <p class="lib-result-line">
            Showing <strong>{{ shownCount }}</strong>
            of {{ totalFor(selectedState) }} documents<template v-if="search"> for “{{ search }}”</template>
          </p>

          <!-- Grouped document list -->
          <div v-if="shownCount" class="lib-groups">
            <section v-for="group in groups" :key="group.key" class="lib-group">
              <h3 class="lib-group-head">
                <span class="lib-badge" :class="`lib-badge--${group.key}`">{{ group.key.toUpperCase() }}</span>
                {{ group.label }}
                <span class="lib-group-count">{{ group.items.length }}</span>
              </h3>

              <ul class="lib-docs">
                <li v-for="doc in group.items" :key="doc.slug">
                  <NuxtLink
                    class="lib-doc"
                    :to="{ path: '/doc-viewer', query: { doc: doc.slug, from: 'library' } }"
                  >
                    <span class="lib-badge" :class="`lib-badge--${group.key}`">{{ group.key.toUpperCase() }}</span>
                    <span class="lib-doc-title">{{ doc.title }}</span>
                    <span v-if="yearOf(doc.title)" class="lib-doc-year">{{ yearOf(doc.title) }}</span>
                  </NuxtLink>
                </li>
              </ul>
            </section>
          </div>

          <p v-else class="lib-empty">
            No documents match “{{ search }}”.
            <button type="button" class="lib-clear" @click="search = ''">Clear search</button>
          </p>
        </template>

        <div v-else class="lib-soon">
          <p class="lib-soon-text">
            {{ STATE_NAMES[selectedState] }} instruments have not been added to the library yet.
          </p>
          <button type="button" class="lib-clear" @click="selectState('nsw')">
            Browse New South Wales instead
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Australia from '@svg-maps/australia'
import { withVisibleDcpsOnly } from '~/utils/instrument-visibility'

// ── Types ───────────────────────────────────────────────────────────────

interface DocItem  { slug: string; title: string; file: string }
interface Category { label: string; items: DocItem[] }
interface StateData { label: string; categories: Record<string, Category> }
type InstrumentsIndex = Record<string, StateData>

// ── Static state metadata ───────────────────────────────────────────────
//
// The SVG splits some states into several islands, so several location ids
// collapse onto one state key.

const LOC_TO_STATE: Record<string, string> = {
  'nsw': 'nsw',
  'act': 'act',
  'vic': 'vic',
  'qld-mainland': 'qld',
  'qld-fraser-island': 'qld',
  'qld-mornington-island': 'qld',
  'sa-mainland': 'sa',
  'sa-kangaroo-island': 'sa',
  'wa': 'wa',
  'tas-mainland': 'tas',
  'tas-flinders-island': 'tas',
  'tas-cape-barren': 'tas',
  'tas-king-currie-island': 'tas',
  'nt-mainland': 'nt',
  'nt-melville-island': 'nt',
  'nt-groote-eylandt': 'nt',
}

const STATE_NAMES: Record<string, string> = {
  nsw: 'New South Wales',
  vic: 'Victoria',
  qld: 'Queensland',
  wa:  'Western Australia',
  sa:  'South Australia',
  tas: 'Tasmania',
  act: 'Australian Capital Territory',
  nt:  'Northern Territory',
}

const STATE_ORDER = ['nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt']

/** Preferred display order for categories; anything else is appended. */
const CATEGORY_ORDER = ['lep', 'sepp', 'dcp']

// ── State ───────────────────────────────────────────────────────────────

const auMap = Australia

const index = ref<InstrumentsIndex | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const selectedState = ref('nsw')
const filter = ref('all')
const search = ref('')
const hovered = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await fetch('/instruments.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    index.value = withVisibleDcpsOnly(await res.json())
  } catch (err) {
    loadError.value = `Failed to load the library index: ${(err as Error).message}`
  } finally {
    loading.value = false
  }
})

// ── Map helpers ─────────────────────────────────────────────────────────

function stateKeyOf(locId: string): string {
  return LOC_TO_STATE[locId] ?? ''
}

function stateNameOf(locId: string): string {
  return STATE_NAMES[stateKeyOf(locId)] ?? locId
}

function totalFor(stateKey: string): number {
  const state = index.value?.[stateKey]
  if (!state) return 0
  return Object.values(state.categories).reduce((n, cat) => n + cat.items.length, 0)
}

function hasDocs(stateKey: string): boolean {
  return totalFor(stateKey) > 0
}

function selectState(stateKey: string) {
  if (!stateKey) return
  selectedState.value = stateKey
  filter.value = 'all'
  search.value = ''
}

/** Trailing year in an instrument title, e.g. "Albury LEP 2010" -> "2010". */
function yearOf(title: string): string {
  return title.match(/\b(?:19|20)\d{2}\b/g)?.slice(-1)[0] ?? ''
}

// ── Derived ─────────────────────────────────────────────────────────────

const grandTotal = computed(() =>
  Object.keys(index.value ?? {}).reduce((n, key) => n + totalFor(key), 0),
)

const activeStateCount = computed(() =>
  STATE_ORDER.filter(hasDocs).length,
)

/** Category keys for the selected state, in preferred order. */
const categories = computed(() => {
  const state = index.value?.[selectedState.value]
  if (!state) return []
  const keys = Object.keys(state.categories)
  keys.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a)
    const ib = CATEGORY_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  return keys.map(key => ({
    key,
    label: state.categories[key]!.label,
    count: state.categories[key]!.items.length,
  }))
})

/** Categories after the type filter, each with its items narrowed by search. */
const groups = computed(() => {
  const state = index.value?.[selectedState.value]
  if (!state) return []
  const q = search.value.toLowerCase().trim()

  return categories.value
    .filter(cat => filter.value === 'all' || filter.value === cat.key)
    .map(cat => ({
      ...cat,
      items: q
        ? state.categories[cat.key]!.items.filter(d => d.title.toLowerCase().includes(q))
        : state.categories[cat.key]!.items,
    }))
    .filter(group => group.items.length > 0)
})

const shownCount = computed(() =>
  groups.value.reduce((n, g) => n + g.items.length, 0),
)
</script>

<style>
/* The library is a full-bleed page, so the body reset cannot be scoped. */
body {
  margin: 0;
  background: #f8fafb;
}
</style>

<style scoped>
.lib-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.lib-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1.25rem 2rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.lib-back {
  display: inline-block;
  font-size: 0.78rem;
  color: #64748b;
  text-decoration: none;
  margin-bottom: 0.3rem;
}
.lib-back:hover { color: #0f172a; }

.lib-title {
  font-size: 1.35rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}

.lib-header-stat {
  font-size: 0.8rem;
  color: #64748b;
}
.lib-header-stat strong { color: #0f172a; font-weight: 700; }

.lib-status {
  padding: 3rem 2rem;
  text-align: center;
  color: #64748b;
  font-size: 0.9rem;
}
.lib-status--error { color: #b91c1c; }

/* ── Layout ─────────────────────────────────────────────────────────────── */
.lib-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 2rem;
  max-width: 1280px;
  margin: 0 auto;
  padding: 1.75rem 2rem 4rem;
  align-items: start;
}

@media (max-width: 900px) {
  .lib-layout {
    grid-template-columns: 1fr;
    padding: 1.25rem 1rem 3rem;
  }
}

/* ── Left rail ──────────────────────────────────────────────────────────── */
.lib-rail {
  position: sticky;
  top: 6rem;
}
@media (max-width: 900px) {
  .lib-rail { position: static; }
}

.lib-map-wrap {
  position: relative;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem;
}

.lib-map {
  width: 100%;
  height: auto;
  display: block;
}

.lib-state {
  stroke: #fff;
  stroke-width: 0.5;
  transition: fill 0.15s;
}
.lib-state--active { fill: #15803d; cursor: pointer; }
.lib-state--active:hover { fill: #166534; }
.lib-state--empty { fill: #cbd5e1; cursor: pointer; }
.lib-state--empty:hover { fill: #b0bcc9; }
.lib-state--selected { stroke: #0f172a; stroke-width: 1.1; }

.lib-map-tip {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.4rem 0.7rem;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  pointer-events: none;
}
.lib-map-tip-name  { font-size: 0.8rem; font-weight: 700; color: #0f172a; }
.lib-map-tip-count { font-size: 0.7rem; color: #15803d; font-weight: 500; }
.lib-map-tip-soon  { font-size: 0.7rem; color: #94a3b8; font-style: italic; }

.lib-legend {
  display: flex;
  justify-content: center;
  gap: 1.25rem;
  font-size: 0.72rem;
  color: #64748b;
  margin: 0.7rem 0 1rem;
}
.lib-legend-item { display: flex; align-items: center; gap: 0.35rem; }
.lib-legend-dot { width: 11px; height: 11px; border-radius: 3px; }
.lib-legend-dot--active { background: #15803d; }
.lib-legend-dot--empty  { background: #cbd5e1; }

.lib-state-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}

.lib-state-btn {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.55rem 0.8rem;
  background: none;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.lib-state-list li:last-child .lib-state-btn { border-bottom: none; }
.lib-state-btn:hover { background: #f8fafb; }
.lib-state-btn--on { background: #f0fdf4; }
.lib-state-btn--on:hover { background: #dcfce7; }

.lib-state-abbr {
  flex-shrink: 0;
  width: 2.6rem;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #15803d;
}
.lib-state-btn--empty .lib-state-abbr { color: #94a3b8; }

.lib-state-name {
  flex: 1;
  font-size: 0.8rem;
  color: #1e293b;
}
.lib-state-btn--empty .lib-state-name { color: #94a3b8; }

.lib-state-count {
  font-size: 0.72rem;
  font-weight: 700;
  color: #0f172a;
}
.lib-state-soon { font-size: 0.72rem; color: #cbd5e1; }

/* ── Main column ────────────────────────────────────────────────────────── */
.lib-state-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 0.2rem;
}
.lib-state-sub {
  font-size: 0.82rem;
  color: #64748b;
  margin: 0 0 1.25rem;
}

.lib-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.lib-card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.85rem 1rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.lib-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07);
}
.lib-card--on { border-color: #0f172a; }

.lib-card-abbr {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.lib-card--lep  .lib-card-abbr { color: #1d4ed8; }
.lib-card--sepp .lib-card-abbr { color: #b45309; }
.lib-card--dcp  .lib-card-abbr { color: #15803d; }

.lib-card-count {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.1;
}
.lib-card-label {
  font-size: 0.72rem;
  color: #64748b;
}

/* ── Controls ───────────────────────────────────────────────────────────── */
.lib-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.lib-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; }

.lib-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.32rem 0.7rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}
.lib-chip:hover { border-color: #cbd5e1; }
.lib-chip--on {
  background: #0f172a;
  border-color: #0f172a;
  color: #fff;
}
.lib-chip-count { font-size: 0.66rem; opacity: 0.7; font-weight: 500; }

.lib-search {
  flex: 1;
  min-width: 220px;
  padding: 0.45rem 0.75rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font: inherit;
  font-size: 0.82rem;
  color: #1e293b;
}
.lib-search:focus {
  outline: none;
  border-color: #15803d;
  box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.1);
}

.lib-result-line {
  font-size: 0.74rem;
  color: #94a3b8;
  margin: 0 0 1rem;
}
.lib-result-line strong { color: #475569; }

/* ── Document groups ────────────────────────────────────────────────────── */
.lib-groups { display: flex; flex-direction: column; gap: 1.75rem; }

.lib-group-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: #475569;
  margin: 0 0 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.lib-group-count {
  font-size: 0.7rem;
  font-weight: 600;
  color: #94a3b8;
}

.lib-docs {
  list-style: none;
  margin: 0;
  padding: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}

.lib-doc {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid #f1f5f9;
  text-decoration: none;
  color: inherit;
}
.lib-docs li:last-child .lib-doc { border-bottom: none; }
.lib-doc:hover { background: #f8fafb; }

.lib-badge {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.18rem 0.42rem;
  border-radius: 4px;
  letter-spacing: 0.03em;
}
.lib-badge--lep  { background: #dbeafe; color: #1d4ed8; }
.lib-badge--sepp { background: #fef3c7; color: #b45309; }
.lib-badge--dcp  { background: #dcfce7; color: #15803d; }

.lib-doc-title {
  flex: 1;
  font-size: 0.86rem;
  color: #1e293b;
}
.lib-doc:hover .lib-doc-title { color: #0f172a; }

.lib-doc-year {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

/* ── Empty states ───────────────────────────────────────────────────────── */
.lib-empty,
.lib-soon {
  background: #fff;
  border: 1px dashed #e2e8f0;
  border-radius: 12px;
  padding: 2rem 1.5rem;
  text-align: center;
  font-size: 0.85rem;
  color: #64748b;
}
.lib-soon-text { margin: 0 0 0.75rem; }

.lib-clear {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.3rem 0.7rem;
  background: #0f172a;
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
}
.lib-soon .lib-clear { margin-left: 0; }
</style>
