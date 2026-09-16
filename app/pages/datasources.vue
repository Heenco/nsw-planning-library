<!--
  /datasources

  What the data behind the library is, state by state. NSW is the one state
  connected so far; its section explains the land, address and planning data
  loaded from NSW Spatial Services and the Department of Planning: where it
  comes from, the ideas it is built on, every table and how they join, a live
  trace of any address or lot through them, the planning layers, the coded values, and
  a Data accuracy subsection with freshness, measured match rates and known
  limitations.

  Content: shared/datasources-nsw.ts. Live figures: /api/datasources/nsw (row
  counts, load dates, measured checks), /api/datasources/nsw-address and
  /api/datasources/nsw-lot (the two traces, which link into each other). The page
  renders fully without the live figures and says when they could not be loaded.

  The state, the traced address and the traced lot are all kept in the URL
  (?state=, ?trace=, ?lot=), but with history.replaceState rather than the
  router: a router call counts as a route change even when the page does not
  change, and sends the reader to the top of the page mid-click. The query is
  therefore read once, on load, and the page passes the values to the panels.
-->

<template>
  <div class="ds-page">
    <!-- ── Header ─────────────────────────────────────────────────────── -->
    <header class="ds-header">
      <div>
        <NuxtLink to="/" class="ds-back">&larr; Home</NuxtLink>
        <h1 class="ds-title">Data sources</h1>
      </div>
      <div v-if="state === 'nsw' && lastLoaded" class="ds-header-stat">
        NSW data loaded <strong>{{ fmtDate(lastLoaded) }}</strong>
      </div>
    </header>

    <nav class="ds-states" aria-label="States and territories">
      <button
        v-for="s in STATES"
        :key="s.key"
        type="button"
        class="ds-state"
        :class="{ 'ds-state--on': s.key === state, 'ds-state--soon': !s.connected }"
        :aria-current="s.key === state ? 'page' : undefined"
        @click="state = s.key"
      >
        {{ s.short }}
        <span v-if="!s.connected" class="ds-state-soon">soon</span>
      </button>
    </nav>

    <!-- ── Not connected yet ──────────────────────────────────────────── -->
    <div v-if="state !== 'nsw'" class="ds-soon">
      <h2 class="ds-soon-title">{{ currentState.name }}</h2>
      <p>No {{ currentState.name }} data is connected to the library yet. When it is, this page will describe its tables, how they connect, and how accurate they are, the same way it does for New South Wales.</p>
      <button type="button" class="ds-soon-btn" @click="state = 'nsw'">See New South Wales</button>
    </div>

    <!-- ── NSW ────────────────────────────────────────────────────────── -->
    <div v-else class="ds-layout">
      <aside class="ds-rail">
        <p class="ds-rail-state">New South Wales</p>
        <nav aria-label="Sections">
          <p class="ds-rail-group">Data structure</p>
          <a v-for="s in STRUCTURE_SECTIONS" :key="s.id" :href="`#${s.id}`" class="ds-rail-link" :class="{ 'ds-rail-link--on': activeSection === s.id }">{{ s.label }}</a>
          <p class="ds-rail-group">Data accuracy</p>
          <a v-for="s in ACCURACY_SECTIONS" :key="s.id" :href="`#${s.id}`" class="ds-rail-link ds-rail-link--sub" :class="{ 'ds-rail-link--on': activeSection === s.id }">{{ s.label }}</a>
        </nav>
        <p v-if="liveError" class="ds-rail-note ds-rail-note--error">Live figures unavailable: {{ liveError }}</p>
        <p v-else-if="!live" class="ds-rail-note">Loading live figures…</p>
      </aside>

      <main class="ds-main">
        <!-- Overview -->
        <section id="overview" class="ds-section">
          <h2 class="ds-h2">Overview</h2>
          <p class="ds-lead">
            The library knows NSW land through four public datasets. The <strong>lot map</strong> says where every piece of land is.
            The <strong>address data</strong> says what every address is, where it sits and which lots it belongs to.
            The <strong>integrated addresses</strong> join the two and add statistical and electoral areas.
            The <strong>planning layers</strong> say which controls apply where.
            Read top to bottom for the whole picture, or jump to a table or an address.
          </p>

          <div class="ds-tiles">
            <div v-for="tile in tiles" :key="tile.label" class="ds-tile">
              <span class="ds-tile-label">{{ tile.label }}</span>
              <span class="ds-tile-value">{{ tile.value }}</span>
              <span class="ds-tile-sub">{{ tile.sub }}</span>
            </div>
          </div>

          <div class="ds-sources">
            <article v-for="src in SOURCES" :key="src.schema" class="ds-source" :style="{ borderTopColor: SCHEMA_COLOR[src.schema] }">
              <header class="ds-source-head">
                <span class="ds-dot" :style="{ background: SCHEMA_COLOR[src.schema] }" />
                <span class="ds-source-group">{{ SCHEMA_LABEL[src.schema] }}</span>
                <code class="ds-source-schema">{{ src.schema }}</code>
              </header>
              <h3 class="ds-source-name">{{ src.name }}</h3>
              <p class="ds-source-what">{{ src.what }}</p>
              <dl class="ds-source-facts">
                <dt>Publisher</dt><dd>{{ src.publisher }}</dd>
                <dt>How we get it</dt><dd>{{ src.delivery }}</dd>
                <dt>File</dt><dd><code>{{ src.file }}</code></dd>
                <dt>Coordinates</dt><dd>{{ src.coordinates }}</dd>
                <template v-if="schemaStats[src.schema]">
                  <dt>In the database</dt><dd>{{ schemaStats[src.schema]!.tables }} tables, {{ schemaStats[src.schema]!.rows.toLocaleString('en-AU') }} rows</dd>
                  <dt>Source date</dt><dd>{{ schemaStats[src.schema]!.sourceDate ? fmtDate(schemaStats[src.schema]!.sourceDate!) : 'unknown' }}</dd>
                </template>
              </dl>
            </article>
          </div>
        </section>

        <!-- Key ideas -->
        <section id="ideas" class="ds-section">
          <h2 class="ds-h2">Key ideas</h2>
          <p class="ds-lead">
            A few words carry most of the meaning: lot, plan, strata, property and address. Pick one to see what it is and where it lives in the data.
          </p>
          <DsKeyIdeas />
        </section>

        <!-- Tables -->
        <section id="tables" class="ds-section">
          <h2 class="ds-h2">Tables and how they connect</h2>
          <p class="ds-lead">
            Every route between land and addresses passes through the address table in the middle. Click a table to see what it holds, or a line to see how two tables join and how often the join works.
          </p>
          <DsSchemaMap :rows="rowsByTable" :checks="live?.quality.checks ?? {}" />
        </section>

        <!-- Joins -->
        <section id="joins" class="ds-section">
          <h2 class="ds-h2">Join reference</h2>
          <p class="ds-lead">Every join in one place: which field matches which, when it applies, and how many rows each side can have.</p>
          <div class="ds-table-wrap">
            <table class="ds-table">
              <thead>
                <tr><th>From</th><th>To</th><th>Only when</th><th>Rows</th><th>What it gives you</th></tr>
              </thead>
              <tbody>
                <tr v-for="j in JOINS" :key="j.id">
                  <td><code>{{ fieldLabel(j.from) }}</code></td>
                  <td><code>{{ fieldLabel(j.to) }}</code></td>
                  <td>{{ j.when ?? '' }}</td>
                  <td class="ds-nowrap">{{ j.cardinality }}</td>
                  <td>{{ j.plain }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 class="ds-h3">From any address to its lot, in one query</h3>
          <p class="ds-text">The three kinds of address each take a different route through the property lots; the lot shape is then one join on <code>cadid</code>.</p>
          <div class="ds-code">
            <button type="button" class="ds-copy" @click="copy(ADDRESS_TO_LOT_SQL)">{{ copied ? 'Copied' : 'Copy' }}</button>
            <pre><code>{{ ADDRESS_TO_LOT_SQL }}</code></pre>
          </div>
        </section>

        <!-- Trace -->
        <section id="trace" ref="traceSection" class="ds-section">
          <h2 class="ds-h2">Trace an address or a lot</h2>
          <p class="ds-lead">
            Follow a real record through every table, with the values from the database. Start from an address and end at the land, or start from a lot and see what is built on it.
          </p>
          <div class="ds-tabs" role="tablist" aria-label="What to trace">
            <button
              v-for="tab in TRACE_TABS" :key="tab.key" type="button" role="tab"
              class="ds-tab" :class="{ 'ds-tab--on': traceTab === tab.key }"
              :aria-selected="traceTab === tab.key"
              @click="traceTab = tab.key"
            >{{ tab.label }}</button>
          </div>
          <DsAddressTrace
            v-show="traceTab === 'address'"
            :focus="addressFocus"
            @trace-lot="openLot"
            @tracing="holdTrace"
            @traced="onAddressTraced"
          />
          <DsLotTrace
            v-if="lotTraceUsed"
            v-show="traceTab === 'lot'"
            :focus="lotFocus"
            @trace-address="openAddress"
            @tracing="holdTrace"
            @traced="onLotTraced"
          />
        </section>

        <!-- Planning layers -->
        <section id="planning" class="ds-section">
          <h2 class="ds-h2">Planning layers</h2>
          <p class="ds-lead">
            The planning instruments' maps. They share a common set of columns and connect to land by position only: intersect a lot with a layer to read its control. The lot trace above does exactly that, and reports how much of the lot each control covers.
          </p>
          <p class="ds-text ds-epi-note">{{ EPI_LAYER_NOTE }}</p>
          <div class="ds-epi">
            <article v-for="g in EPI_GROUPS" :key="g.title" class="ds-epi-group">
              <h3 class="ds-epi-title">{{ g.title }}</h3>
              <p class="ds-epi-plain">{{ g.plain }}</p>
              <ul class="ds-epi-list">
                <li v-for="t in g.tables" :key="t" :class="{ 'ds-epi-empty': rowsByTable[`epi.${t}`] === 0 }">
                  <details class="ds-epi-item">
                    <summary class="ds-epi-summary">
                      <span class="ds-epi-name">{{ epiName(t) }}<sup v-if="EPI_LAYERS[t]?.buried?.length" class="ds-epi-flag" title="Holds layers its name does not suggest">+</sup></span>
                      <span class="ds-epi-count">{{ epiCount(t) }}</span>
                    </summary>
                    <div class="ds-epi-detail">
                      <p v-if="EPI_LAYERS[t]" class="ds-epi-contains">{{ EPI_LAYERS[t]!.contains }}</p>
                      <template v-if="EPI_LAYERS[t]?.buried?.length">
                        <p class="ds-epi-buried-label">Also holds, under its own <code>lay_name</code>:</p>
                        <ul class="ds-epi-buried">
                          <li v-for="b in EPI_LAYERS[t]!.buried" :key="b">{{ b }}</li>
                        </ul>
                      </template>
                      <p v-if="EPI_LAYERS[t]?.watchOut" class="ds-epi-watch">{{ EPI_LAYERS[t]!.watchOut }}</p>
                    </div>
                  </details>
                </li>
              </ul>
            </article>
          </div>
          <p class="ds-text ds-muted">Common columns on every layer: <code>epi_name</code>, <code>epi_type</code>, <code>lga_name</code>, <code>sym_code</code>, <code>label</code>, <code>legis_ref_clause</code>, <code>published_date</code>, <code>commenced_date</code>, <code>amendment</code>.</p>
        </section>

        <!-- Codes -->
        <section id="codes" class="ds-section">
          <h2 class="ds-h2">Codes and values</h2>
          <p class="ds-lead">Several columns store a number where a word is meant. These are the words.</p>
          <div class="ds-codes">
            <article v-for="list in CODE_LISTS" :key="list.field" class="ds-code-list">
              <h3 class="ds-code-field"><code>{{ list.field }}</code></h3>
              <p class="ds-code-where">{{ list.where }}</p>
              <table class="ds-mini">
                <tbody>
                  <tr v-for="v in list.values" :key="v.code"><th scope="row">{{ v.code }}</th><td>{{ v.label }}</td></tr>
                </tbody>
              </table>
              <p v-if="list.note" class="ds-code-note">{{ list.note }}</p>
            </article>
          </div>
        </section>

        <!-- Accuracy -->
        <section id="accuracy" class="ds-section ds-section--accuracy">
          <p class="ds-kicker">New South Wales</p>
          <h2 class="ds-h2">Data accuracy</h2>
          <p class="ds-lead">
            How recent the data is, how well the tables fit together, and where it falls short. The figures are measured on the data as loaded, not taken from the publishers.
          </p>
          <DsAccuracy
            :loads-available="live?.loads.available ?? false"
            :tables="live?.loads.tables ?? []"
            :runs="live?.loads.runs ?? []"
            :checks="live?.quality.checks ?? {}"
          />
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ADDRESS_TO_LOT_SQL, CODE_LISTS, EPI_GROUPS, EPI_LAYER_NOTE, EPI_LAYERS, JOINS, SCHEMA_COLOR,
  SCHEMA_LABEL, SOURCES, TABLES,
  type JoinDoc, type SchemaKey,
} from '#shared/datasources-nsw'

useHead({ title: 'Data sources · Planning Library' })

interface LiveOverview {
  generatedAt: string
  loads: {
    available: boolean
    tables: { schema: string; table: string; rowCount: number; geometryType: string | null; loadedAt: string | null; sourceDate: string | null; sourceZip: string | null }[]
    runs: { runId: string; startedAt: string | null; finishedAt: string | null; status: string | null; loadMinutes: number | null; totalMinutes: number | null }[]
  }
  quality: {
    available: boolean
    checks: Record<string, { numerator: number; denominator: number; measuredAt: string; seconds: number | null; sample: string | null; dataLoadedAt: string | null }>
  }
}

const STATES = [
  { key: 'nsw', short: 'NSW', name: 'New South Wales', connected: true },
  { key: 'vic', short: 'VIC', name: 'Victoria', connected: false },
  { key: 'qld', short: 'QLD', name: 'Queensland', connected: false },
  { key: 'wa', short: 'WA', name: 'Western Australia', connected: false },
  { key: 'sa', short: 'SA', name: 'South Australia', connected: false },
  { key: 'tas', short: 'TAS', name: 'Tasmania', connected: false },
  { key: 'act', short: 'ACT', name: 'the Australian Capital Territory', connected: false },
  { key: 'nt', short: 'NT', name: 'the Northern Territory', connected: false },
]

const TRACE_TABS = [
  { key: 'address', label: 'By address' },
  { key: 'lot', label: 'By lot' },
]

const STRUCTURE_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ideas', label: 'Key ideas' },
  { id: 'tables', label: 'Tables and connections' },
  { id: 'joins', label: 'Join reference' },
  { id: 'trace', label: 'Trace an address or lot' },
  { id: 'planning', label: 'Planning layers' },
  { id: 'codes', label: 'Codes and values' },
]
const ACCURACY_SECTIONS = [
  { id: 'accuracy-freshness', label: 'Freshness' },
  { id: 'accuracy-checks', label: 'Measured checks' },
  { id: 'accuracy-counts', label: 'Address counts' },
  { id: 'accuracy-limits', label: 'Limitations' },
  { id: 'accuracy-refresh', label: 'Refreshing' },
]

// Read once: from here on the URL is written with history.replaceState, so
// route.query stops reflecting it.
const route = useRoute()
const initialQuery = { ...route.query }

const state = ref(STATES.some(s => s.key === initialQuery.state) ? String(initialQuery.state) : 'nsw')
const currentState = computed(() => STATES.find(s => s.key === state.value)!)
watch(state, (key) => {
  setQueryParam('state', key === 'nsw' ? null : key)
})

// ── Tracing ─────────────────────────────────────────────────────────────

/** A URL naming a lot opens on that tab; the lot panel is only mounted once it is wanted. */
const traceTab = ref(initialQuery.lot ? 'lot' : 'address')
const lotTraceUsed = ref(Boolean(initialQuery.lot))

/** Which address and which lot are shown. The panels report back when they trace another. */
const addressFocus = ref<number | null>(Number(initialQuery.trace) || null)
const lotFocus = ref<string | null>(/^\d+$/.test(String(initialQuery.lot ?? '')) ? String(initialQuery.lot) : null)
watch(traceTab, (tab) => {
  if (tab === 'lot') lotTraceUsed.value = true
  holdTrace()
})

/**
 * Don't move the page when a trace changes.
 *
 * A trace replaces a panel that can be thousands of pixels tall - a strata
 * building lists every unit - and switching tabs hides one panel for another of
 * a different height. Either way the content above the viewport changes size,
 * the page gets shorter or taller, and the browser re-anchors the scroll: click
 * a row half way down a long list and you are thrown somewhere else, often the
 * top of the page.
 *
 * So the trace section is used as the anchor: its distance from the top of the
 * viewport is measured before the change and restored after the browser has laid
 * the new content out, instantly rather than smoothly, so nothing appears to
 * move. Restoring is skipped only when it would leave the section off screen,
 * which happens when the new panel is far shorter than where the reader was; the
 * section's top is then brought just under the header instead.
 */
const traceSection = ref<HTMLElement | null>(null)

function holdTrace() {
  const el = traceSection.value
  if (!el || typeof window === 'undefined') return
  const before = el.getBoundingClientRect().top
  const settle = () => {
    const current = traceSection.value
    if (!current) return
    const delta = current.getBoundingClientRect().top - before
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' })
    const after = current.getBoundingClientRect()
    const offset = window.innerWidth > 960 ? 88 : 56        // clear the sticky header, or the rail on a phone
    if (after.bottom < offset + 160) window.scrollTo({ top: window.scrollY + after.top - offset, behavior: 'auto' })
  }
  // after Vue has patched the DOM, and after the browser has laid it out again
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(settle)))
}

/** Follow a lot out of the address trace, and an address out of the lot trace. */
function openLot(cadid: string) {
  lotTraceUsed.value = true
  traceTab.value = 'lot'
  lotFocus.value = cadid
  setQueryParam('lot', cadid)
}
function openAddress(msoid: number) {
  traceTab.value = 'address'
  addressFocus.value = msoid
  setQueryParam('trace', String(msoid))
}

/** A panel traced something on its own: keep the page and the URL in step. */
function onAddressTraced(msoid: number) {
  addressFocus.value = msoid
  setQueryParam('trace', String(msoid))
}
function onLotTraced(cadid: string) {
  lotFocus.value = cadid
  setQueryParam('lot', cadid)
}

// ── Live figures ────────────────────────────────────────────────────────

const live = ref<LiveOverview | null>(null)
const liveError = ref('')

onMounted(async () => {
  try {
    live.value = await $fetch<LiveOverview>('/api/datasources/nsw')
  } catch (err: any) {
    liveError.value = err?.data?.statusMessage ?? err?.message ?? String(err)
  }
  observeSections()
})

const rowsByTable = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const t of live.value?.loads.tables ?? []) out[`${t.schema}.${t.table}`] = t.rowCount
  return out
})

const schemaStats = computed(() => {
  const out: Partial<Record<SchemaKey, { tables: number; rows: number; sourceDate: string | null }>> = {}
  for (const t of live.value?.loads.tables ?? []) {
    const key = t.schema as SchemaKey
    const s = (out[key] ??= { tables: 0, rows: 0, sourceDate: null })
    s.tables++
    s.rows += t.rowCount
    if (t.sourceDate && (!s.sourceDate || t.sourceDate > s.sourceDate)) s.sourceDate = t.sourceDate
  }
  return out
})

const lastLoaded = computed(() => (live.value?.loads.tables ?? []).map(t => t.loadedAt).filter((d): d is string => !!d).sort().pop() ?? null)

function rows(key: string): number | null {
  return typeof rowsByTable.value[key] === 'number' ? rowsByTable.value[key]! : null
}

function compact(n: number | null): string {
  if (n == null) return '…'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  return n.toLocaleString('en-AU')
}

const tiles = computed(() => {
  const epiRows = Object.entries(rowsByTable.value).filter(([k]) => k.startsWith('epi.')).reduce((s, [, v]) => s + v, 0)
  return [
    { label: 'Lots', value: compact(rows('cadastre.lot')), sub: 'pieces of land, strata sites counted once' },
    { label: 'Addresses', value: compact(rows('guras.addressstring')), sub: 'every unit, shop and car space with its own' },
    { label: 'Property–lot links', value: compact(rows('guras.propertylot')), sub: 'which lots make up each property' },
    { label: 'Planning areas', value: live.value ? compact(epiRows) : '…', sub: 'areas across the planning layers' },
  ]
})

// ── Helpers ─────────────────────────────────────────────────────────────

function fieldLabel(f: JoinDoc['from']): string {
  const t = TABLES.find(x => x.id === f.table)!
  const name = t.id === 'epi.layers' ? 'epi.*' : t.id === 'cadastre.other' ? 'cadastre roads, rail, water' : `${t.schema}.${t.tables[0]}`
  return `${name}.${f.column}`
}

function epiName(table: string): string {
  const s = table.replace(/^epi_/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function epiCount(table: string): string {
  const n = rows(`epi.${table}`)
  if (n == null) return ''
  return n === 0 ? 'empty' : n.toLocaleString('en-AU')
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const copied = ref(false)
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    copied.value = false
  }
}

// ── Rail highlight ──────────────────────────────────────────────────────

const activeSection = ref('overview')
let observer: IntersectionObserver | null = null

function observeSections() {
  if (typeof IntersectionObserver === 'undefined') return
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (visible[0]) activeSection.value = visible[0].target.id
  }, { rootMargin: '-15% 0px -70% 0px' })
  for (const s of [...STRUCTURE_SECTIONS, ...ACCURACY_SECTIONS]) {
    const el = document.getElementById(s.id)
    if (el) observer.observe(el)
  }
}

watch(state, (key) => {
  if (key === 'nsw') nextTick(observeSections)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<style>
/* The page is full-bleed, so the body reset cannot be scoped. */
body {
  margin: 0;
  background: #f8fafb;
}
</style>

<style scoped>
.ds-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.ds-header {
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
.ds-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.3rem; }
.ds-back:hover { color: #0f172a; }
.ds-title { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
.ds-header-stat { font-size: 0.8rem; color: #64748b; }
.ds-header-stat strong { color: #0f172a; font-weight: 700; }

/* ── States ─────────────────────────────────────────────────────────── */
.ds-states {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-width: 1360px;
  margin: 0 auto;
  padding: 1rem 2rem 0;
}
.ds-state {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
  cursor: pointer;
}
.ds-state:hover { border-color: #15803d; color: #15803d; }
.ds-state--on { background: #15803d; border-color: #15803d; color: #fff; }
.ds-state--on:hover { color: #fff; }
.ds-state--soon { color: #94a3b8; }
.ds-state-soon { font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }

.ds-soon { max-width: 640px; margin: 3rem auto; padding: 1.5rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; text-align: center; }
.ds-soon-title { margin: 0 0 0.5rem; font-size: 1.2rem; font-weight: 800; color: #0f172a; text-transform: capitalize; }
.ds-soon p { margin: 0 0 1rem; color: #475569; line-height: 1.55; }
.ds-soon-btn { padding: 0.5rem 1rem; border: none; border-radius: 8px; background: #0f172a; color: #fff; font: inherit; font-size: 0.85rem; font-weight: 700; cursor: pointer; }

/* ── Layout ─────────────────────────────────────────────────────────── */
.ds-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 2.25rem;
  max-width: 1360px;
  margin: 0 auto;
  padding: 1.5rem 2rem 5rem;
  align-items: start;
}


.ds-rail { position: sticky; top: 6rem; display: flex; flex-direction: column; gap: 0.1rem; }
.ds-rail-state { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.ds-rail-group { margin: 0.8rem 0 0.3rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #64748b; }
.ds-rail-link { display: block; padding: 0.3rem 0.6rem; border-left: 2px solid #e2e8f0; font-size: 0.84rem; color: #475569; text-decoration: none; }
.ds-rail-link:hover { color: #0f172a; border-left-color: #94a3b8; }
.ds-rail-link--sub { padding-left: 1rem; }
.ds-rail-link--on { color: #15803d; font-weight: 700; border-left-color: #15803d; }
.ds-rail-note { margin: 1rem 0 0; font-size: 0.74rem; color: #64748b; }
.ds-rail-note--error { color: #b91c1c; }

/* ── Sections ───────────────────────────────────────────────────────── */
.ds-main { min-width: 0; }
.ds-section { scroll-margin-top: 6rem; padding-bottom: 3rem; margin-bottom: 3rem; border-bottom: 1px solid #e2e8f0; }
.ds-section:last-child { border-bottom: none; }
.ds-section--accuracy { padding-top: 1.5rem; border-top: 3px solid #15803d; }
.ds-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #15803d; }
.ds-h2 { margin: 0 0 0.5rem; font-size: 1.45rem; font-weight: 800; color: #0f172a; }
.ds-h3 { margin: 1.75rem 0 0.4rem; font-size: 1rem; font-weight: 800; color: #0f172a; }
.ds-lead { margin: 0 0 1.25rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 75ch; }
.ds-text { margin: 0 0 0.75rem; font-size: 0.88rem; line-height: 1.55; color: #334155; max-width: 80ch; }
.ds-muted { color: #64748b; }
.ds-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
.ds-nowrap { white-space: nowrap; }

/* tiles */
.ds-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
.ds-tile { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.85rem 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
.ds-tile-label { font-size: 0.78rem; color: #64748b; }
.ds-tile-value { font-size: 1.6rem; font-weight: 700; color: #0f172a; }
.ds-tile-sub { font-size: 0.74rem; color: #64748b; line-height: 1.4; }

/* sources */
.ds-sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.9rem; }
.ds-source { background: #fff; border: 1px solid #e2e8f0; border-top: 4px solid; border-radius: 10px; padding: 0.9rem 1rem 1rem; }
.ds-source-head { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.ds-source-group { font-size: 0.74rem; font-weight: 700; color: #334155; }
.ds-source-schema { font-size: 0.7rem; color: #64748b; }
.ds-source-name { margin: 0.45rem 0 0.35rem; font-size: 0.98rem; font-weight: 800; color: #0f172a; line-height: 1.3; }
.ds-source-what { margin: 0 0 0.7rem; font-size: 0.84rem; line-height: 1.5; color: #334155; }
.ds-source-facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.78rem; }
.ds-source-facts dt { color: #64748b; }
.ds-source-facts dd { margin: 0; color: #0f172a; min-width: 0; overflow-wrap: anywhere; }

/* joins */
.ds-table-wrap { overflow-x: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
.ds-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.ds-table th { text-align: left; padding: 0.6rem 0.8rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.ds-table td { padding: 0.55rem 0.8rem; vertical-align: top; border-bottom: 1px solid #f1f5f9; color: #334155; line-height: 1.45; }
.ds-table tr:last-child td { border-bottom: none; }
.ds-table code { font-size: 0.76rem; color: #0f172a; white-space: nowrap; }

.ds-tabs { display: inline-flex; gap: 0.25rem; padding: 0.25rem; margin-bottom: 1rem; background: #f1f5f9; border-radius: 999px; }
.ds-tab { padding: 0.35rem 0.9rem; border: none; border-radius: 999px; background: none; font: inherit; font-size: 0.82rem; font-weight: 700; color: #475569; cursor: pointer; }
.ds-tab:hover { color: #0f172a; }
.ds-tab--on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }

.ds-code { position: relative; }
.ds-code pre { margin: 0; padding: 1rem; background: #0f172a; color: #e2e8f0; border-radius: 10px; overflow-x: auto; font-size: 0.8rem; line-height: 1.55; }
.ds-copy { position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.25rem 0.6rem; border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; font: inherit; font-size: 0.72rem; cursor: pointer; }
.ds-copy:hover { background: #334155; }

/* planning layers */
.ds-epi { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.9rem; margin-bottom: 1rem; }
.ds-epi-group { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.85rem 1rem; }
.ds-epi-title { margin: 0 0 0.2rem; font-size: 0.92rem; font-weight: 800; color: #0f172a; }
.ds-epi-plain { margin: 0 0 0.6rem; font-size: 0.8rem; color: #64748b; }
.ds-epi-list { list-style: none; margin: 0; padding: 0; font-size: 0.8rem; }
.ds-epi-list > li { border-top: 1px solid #f1f5f9; color: #334155; }
.ds-epi-count { color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ds-epi-empty, .ds-epi-empty .ds-epi-count { color: #94a3b8; }
.ds-epi-note { margin: -0.4rem 0 0.9rem; color: #475569; }
.ds-epi-summary { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.2rem 0; cursor: pointer; list-style: none; }
.ds-epi-summary::-webkit-details-marker { display: none; }
.ds-epi-summary:hover .ds-epi-name { color: #0f172a; text-decoration: underline; text-underline-offset: 2px; }
.ds-epi-item[open] .ds-epi-name { font-weight: 700; color: #0f172a; }
.ds-epi-item:focus-within .ds-epi-summary { outline: 2px solid #4a3aa7; outline-offset: 2px; border-radius: 4px; }
.ds-epi-flag { color: #4a3aa7; font-weight: 800; padding-left: 0.15rem; }
.ds-epi-detail { padding: 0.15rem 0 0.55rem; font-size: 0.78rem; line-height: 1.5; color: #475569; }
.ds-epi-contains { margin: 0; }
.ds-epi-buried-label { margin: 0.45rem 0 0.2rem; color: #334155; font-weight: 600; }
.ds-epi-buried { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem; }
.ds-epi-buried li { border: 1px solid #ddd6fe; border-radius: 999px; background: #f5f3ff; color: #4a3aa7; padding: 0.05rem 0.45rem; font-size: 0.74rem; }
.ds-epi-watch { margin: 0.45rem 0 0; padding-left: 0.5rem; border-left: 2px solid #fbbf24; color: #57534e; }

/* codes */
.ds-codes { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.75rem; }
.ds-code-list { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.75rem 0.9rem; }
.ds-code-field { margin: 0; font-size: 0.86rem; }
.ds-code-field code { color: #0f172a; }
.ds-code-where { margin: 0.1rem 0 0.5rem; font-size: 0.72rem; color: #64748b; }
.ds-mini { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.ds-mini th { width: 2.5rem; text-align: left; font-weight: 700; color: #0f172a; padding: 0.18rem 0; font-variant-numeric: tabular-nums; }
.ds-mini td { color: #334155; padding: 0.18rem 0; }
.ds-mini tr + tr { border-top: 1px solid #f1f5f9; }
.ds-code-note { margin: 0.45rem 0 0; font-size: 0.72rem; color: #64748b; line-height: 1.45; }

/* ── Narrow screens: last, so these win over the rules above ─────────── */
@media (max-width: 960px) {
  .ds-layout { grid-template-columns: minmax(0, 1fr); gap: 1rem; padding: 1rem 1rem 4rem; }
  .ds-states { padding: 1rem 1rem 0; }
  /* The header scrolls away; the rail becomes one row of links pinned to the top. */
  .ds-header { padding: 1rem; position: static; }
  .ds-section { scroll-margin-top: 3.5rem; }
  .ds-rail { position: sticky; top: 0; z-index: 5; min-width: 0; margin: 0 -1rem; padding: 0.4rem 1rem; background: #f8fafb; border-bottom: 1px solid #e2e8f0; }
  .ds-rail > nav { display: flex; gap: 0.25rem; overflow-x: auto; scrollbar-width: none; }
  .ds-rail-state, .ds-rail-group, .ds-rail-note { display: none; }
  .ds-rail-link, .ds-rail-link--sub { flex: none; padding: 0.3rem 0.6rem; border-left: none; border-radius: 999px; white-space: nowrap; }
  .ds-rail-link--on { background: #dcfce7; }
}
</style>
