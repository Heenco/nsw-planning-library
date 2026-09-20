<!--
  /cdc-map - every layer a complying development check needs, and whether one lot clears them.

  The companion to /cdc. That page is the rules; this one is a property against the rules. Search an
  address or click the map, and each of the 59 layers that hold features is read against the lot polygon
  at once. What comes back is a verdict rather than a list, because "terrestrial biodiversity covers this
  lot" only means something once you know it is clause 1.17A(1)(e)(g) and rules out every certificate
  type, while "the lot is in an R2 zone" means nothing at all on its own.

  Two things are drawn, and they come from different places on purpose. The layers you switch on in the
  panel are vector tiles, one archive per group, shown and hidden with a map filter on layer_key exactly
  as on /lmr - so a toggle never changes a tile URL. What caught the lot is drawn over the top from the
  intersect query itself, already clipped to the lot, which is both smaller and always current with the
  views rather than with the last tile build.

  A layer the tile build has not covered is still testable: the verdict is a PostGIS query, not a tile
  read. Its switch is disabled rather than hidden, and its detail says why.
-->

<template>
  <div class="cm-page">
    <header class="cm-header">
      <div>
        <NuxtLink to="/" class="cm-back">&larr; Home</NuxtLink>
        <h1 class="cm-title">Complying development — one lot against every layer</h1>
      </div>
      <div class="cm-header-stat">
        <strong>{{ live.length }}</strong> layers read ·
        <strong>{{ gapLayers.length }}</strong> with no dataset ·
        <NuxtLink to="/cdc" class="cm-link">the rules themselves</NuxtLink>
      </div>
    </header>

    <div class="cm-body">
      <!-- ── search and the catalogue ──────────────────────────────────────── -->
      <aside class="cm-panel">
        <div class="cm-search">
          <input
            v-model="q" type="search" class="cm-input" placeholder="Search an address or lot…"
            @input="onType" @keydown.enter.prevent="pickHighlighted"
            @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
          >
          <ul v-if="listOpen && results.length" class="cm-results">
            <li
              v-for="(r, i) in results" :key="r.cadid"
              :class="{ 'cm-res--on': i === highlight }" @mousedown.prevent="pickLot(r)"
            >
              <b>{{ r.address || r.titleLot || r.lotId }}</b>
              <span>{{ r.lgaName }}</span>
            </li>
          </ul>
          <p v-if="msg" class="cm-msg">{{ msg }}</p>
        </div>

        <div class="cm-bar">
          <span class="cm-bar-n">{{ on.size }} of {{ drawable.length }} drawn</span>
          <button v-if="on.size" type="button" class="cm-link" @click="showNone">clear</button>
          <button v-if="answer && caughtKeys.length" type="button" class="cm-link" @click="showCaught">
            show what caught this lot
          </button>
        </div>

        <div class="cm-groups">
          <details
            v-for="g in grouped" :key="g.key" class="cm-group"
            :open="g.items.some(l => on.has(l.key)) || !!answer"
          >
            <summary class="cm-g-title">
              <span class="cm-swatch" :style="{ background: partColour(g.key) }" />
              {{ g.title }}
              <span v-if="answer" class="cm-g-n" :class="{ 'cm-g-n--hit': g.caught > 0 }">
                {{ g.caught }}/{{ g.items.length }}
              </span>
              <span v-else class="cm-g-n">{{ g.items.length }}</span>
            </summary>
            <p v-if="g.lead" class="cm-g-lead">{{ g.lead }}</p>
            <ul class="cm-list">
              <li v-for="l in g.items" :key="l.key" class="cm-item">
                <label class="cm-row" :class="[`cm-row--${statusOf(l)}`]">
                  <input
                    type="checkbox" :checked="on.has(l.key)" :disabled="!canDraw(l)"
                    @change="toggle(l.key)"
                  >
                  <span class="cm-dot" :style="{ background: dotOf(l) }" />
                  <span class="cm-name">{{ l.title }}</span>
                  <span v-if="tooFarOut(l)" class="cm-meta cm-meta--zoom" title="this layer is only drawn closer in">
                    zoom to {{ l.minZoom }}
                  </span>
                  <span v-else class="cm-meta">
                    <template v-if="answer && hitOf(l)">{{ pct(hitOf(l)!.coverPct) }}</template>
                    <template v-else-if="l.sourceKind === 'none'">no data</template>
                    <template v-else-if="answer">clear</template>
                    <template v-else>{{ (l.features ?? 0).toLocaleString() }}</template>
                  </span>
                </label>

                <details class="cm-about">
                  <summary>about this layer</summary>
                  <p v-if="l.clauses.length" class="cm-about-row">
                    <span class="cm-about-k">Clause</span>
                    <a
                      v-for="c in l.clauses" :key="c" class="cm-chip"
                      :href="clauseLink(c)" target="_blank" rel="noopener"
                    >{{ c }}</a>
                  </p>
                  <p v-else class="cm-about-row">
                    <span class="cm-about-k">Clause</span>
                    <span class="cm-dim">none in the workbook</span>
                  </p>
                  <p class="cm-about-row">
                    <span class="cm-about-k">Reads</span>
                    <code>{{ l.source }}</code>
                  </p>
                  <p v-if="l.filter" class="cm-about-row">
                    <span class="cm-about-k">Filter</span>
                    <code>{{ l.filter }}</code>
                  </p>
                  <p class="cm-about-row">
                    <span class="cm-about-k">Kind</span>
                    <span>{{ l.kind === 'context' ? 'context, not an exclusion' : 'exclusion' }}</span>
                  </p>
                  <p class="cm-about-row">
                    <span class="cm-about-k">Tested</span>
                    <span v-if="l.columnTested"><code>{{ l.columnTested }}</code> in the CDC rules</span>
                    <span v-else class="cm-dim">not tested by the notebook</span>
                  </p>
                  <p v-if="l.minZoom" class="cm-about-row">
                    <span class="cm-about-k">Drawn</span>
                    <span>from zoom {{ l.minZoom }}</span>
                  </p>
                  <p v-if="l.pulledAt" class="cm-about-row">
                    <span class="cm-about-k">Copied</span>
                    <span>{{ l.pulledAt.slice(0, 10) }} from UrbanPortalDBP</span>
                  </p>
                  <ul v-if="l.categories.length > 1" class="cm-cats">
                    <li v-for="c in l.categories.slice(0, 8)" :key="c.name">
                      {{ c.name }} <span class="cm-dim">{{ c.features.toLocaleString() }}</span>
                    </li>
                  </ul>
                  <p v-if="l.note" class="cm-about-note">{{ l.note }}</p>
                  <p v-if="!canDraw(l) && l.sourceKind !== 'none'" class="cm-about-note">
                    Held, but no tile build has covered it yet, so it can be tested and not drawn.
                  </p>
                  <button v-if="l.bbox" type="button" class="cm-link" @click="zoomTo(l)">zoom to</button>
                </details>
              </li>
            </ul>
          </details>
        </div>
      </aside>

      <!-- ── the map ───────────────────────────────────────────────────────── -->
      <div class="cm-map-wrap">
        <div ref="mapEl" class="cm-map" />

        <div class="cm-maptools">
          <button
            type="button" class="cm-switch" :class="{ 'cm-switch--on': on.size && visible }"
            :title="switchTitle" @click="flip"
          >
            <span class="cm-switch-dot" />
            {{ switchLabel }}
          </button>
          <span v-if="on.size" class="cm-switch-n">{{ on.size }} of {{ drawable.length }}</span>
          <p v-if="status" class="cm-status">{{ status }}</p>
        </div>

        <p v-if="!mapboxToken" class="cm-status cm-status--alone">
          No map token is configured, so the map is not drawn.
        </p>
      </div>

      <!-- ── the verdict ───────────────────────────────────────────────────── -->
      <aside class="cm-panel cm-panel--right">
        <template v-if="answer">
          <div class="cm-lot">
            <h2 class="cm-lot-id">{{ answer.lot?.lotId || 'No lot here' }}</h2>
            <p class="cm-lot-sub">
              <template v-if="answer.lot?.areaM2">{{ Math.round(answer.lot.areaM2).toLocaleString() }} m²</template>
              <template v-if="answer.basis === 'point'"> · tested as a point, nothing covers this spot</template>
              <span class="cm-dim"> · {{ answer.ms }} ms</span>
            </p>
          </div>

          <p class="cm-headline" :class="answer.verdict.general ? 'cm-headline--no' : 'cm-headline--yes'">
            <template v-if="answer.verdict.general">
              Fails {{ answer.verdict.general }}
              {{ answer.verdict.general === 1 ? 'prerequisite that applies' : 'prerequisites that apply' }}
              to every certificate type.
            </template>
            <template v-else>
              Clears every prerequisite we hold a layer for.
            </template>
          </p>

          <section v-for="s in scopeSections" :key="s.key" class="cm-sec">
            <h3 class="cm-sec-title">
              <span class="cm-swatch" :style="{ background: SCOPE_COLOUR[s.key] }" />
              {{ s.title }}<span class="cm-sec-n">{{ s.hits.length }}</span>
            </h3>
            <p class="cm-sec-lead">{{ s.lead }}</p>
            <ul class="cm-hits">
              <li v-for="h in s.hits" :key="h.key" class="cm-hit">
                <div class="cm-hit-head">
                  <span class="cm-hit-title">{{ h.title }}</span>
                  <span class="cm-hit-pct">{{ pct(h.coverPct) }}</span>
                </div>
                <p v-if="h.names.length" class="cm-hit-names">{{ h.names.join(', ') }}</p>
                <p v-if="h.clauses.length" class="cm-hit-clauses">
                  <a
                    v-for="c in h.clauses" :key="c" :href="clauseLink(c)"
                    target="_blank" rel="noopener"
                  >{{ c }}</a>
                </p>
                <p v-if="h.note" class="cm-hit-note">{{ h.note }}</p>
              </li>
            </ul>
          </section>

          <section v-if="answer.gaps.length" class="cm-sec">
            <h3 class="cm-sec-title">
              <span class="cm-swatch cm-swatch--open" />
              Cannot be answered<span class="cm-sec-n">{{ answer.gaps.length }}</span>
            </h3>
            <p class="cm-sec-lead">
              No dataset stands behind these, so this lot is not cleared of them — it is untested.
            </p>
            <ul class="cm-hits">
              <li v-for="g in answer.gaps" :key="g.key" class="cm-hit cm-hit--open">
                <div class="cm-hit-head">
                  <span class="cm-hit-title">{{ g.title }}</span>
                </div>
                <p class="cm-hit-note">{{ g.reason }}</p>
              </li>
            </ul>
          </section>
        </template>

        <div v-else class="cm-empty">
          <h2 class="cm-empty-title">Pick a lot</h2>
          <p>
            Search an address, or click the map. Every layer in the <code>cdc</code> schema is read
            against the lot polygon at once — shrunk by 10 cm first, so a neighbour that merely touches
            the boundary is not counted.
          </p>
          <p>
            The answer says which clause each hit belongs to, because that is what decides whether it
            matters: a prerequisite of clause 1.17A rules out every certificate type, while clause 182
            only gates the Pattern Book.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CdcLayer, CdcLayersResponse } from '../../server/api/cdc/layers.get'
import type { CdcAtResponse, CdcHit, CdcScope } from '../../server/api/cdc/at.get'

useHead({ title: 'CDC layers on a lot · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')
const { data } = await useFetch<CdcLayersResponse>('/api/cdc/layers')

const layers = computed<CdcLayer[]>(() => data.value?.layers ?? [])
const live = computed(() => layers.value.filter(l => (l.features ?? 0) > 0))
const gapLayers = computed(() => layers.value.filter(l => l.sourceKind === 'none'))

/** One colour per scope, because the scope is what decides whether a hit matters. */
const SCOPE_COLOUR: Record<CdcScope, string> = {
  general: '#dc2626',
  code: '#d97706',
  midrise: '#7c3aed',
  unmapped: '#64748b',
  context: '#2563eb',
}

const SCOPE_TEXT: { key: CdcScope; title: string; lead: string }[] = [
  {
    key: 'general',
    title: 'Rules out every certificate type',
    lead: 'Prerequisites of clauses 1.17A to 1.19A and Schedule 5. One of these is enough to stop any '
      + 'complying development certificate.',
  },
  {
    key: 'code',
    title: 'Rules out one code',
    lead: 'A requirement of a single code, so it closes that pathway and leaves the others open.',
  },
  {
    key: 'midrise',
    title: 'Mid-rise housing only',
    lead: 'Clause 182 of the Housing SEPP, which gates the Pattern Book designs and no Codes SEPP '
      + 'pathway. We do not test any of it yet; this is what the layer says.',
  },
  {
    key: 'unmapped',
    title: 'We exclude on it, the workbook gives no clause',
    lead: 'Our notebook treats these as exclusions but nothing in the Department workbook says to. '
      + 'Until each is traced to a clause it is excluding land on our authority.',
  },
  {
    key: 'context',
    title: 'Context, not an exclusion',
    lead: 'Facts about the lot. Every lot is inside a zone, and most are inside a minimum lot size, so '
      + 'these decide which code applies rather than whether one can.',
  },
]

/**
 * There is one colour system on this page and it is scope: what a layer bears on. The verdict list, the
 * panel swatches and the polygons on the map all use it, so a red shape on the map and a red heading in
 * the panel mean the same thing - a prerequisite that rules out every certificate type.
 *
 * Colouring by theme instead would have been prettier and would have meant nothing: "this polygon is a
 * water layer" is not a fact anyone needs, while "this polygon closes every pathway" is.
 */
const PART_SCOPE: Record<string, CdcScope> = {
  '1.17A': 'general', '1.18': 'general', '1.19A': 'general', '1.19': 'general', sch5: 'general',
  codes: 'code', midrise: 'midrise', none: 'unmapped', rest: 'unmapped',
}
const partColour = (key: string) => SCOPE_COLOUR[PART_SCOPE[key] ?? 'unmapped']

const answer = ref<CdcAtResponse | null>(null)
const status = ref('')
const msg = ref('')

/** Which layers are drawn. A map filter on layer_key, so switching one never refetches a tile. */
const on = ref<Set<string>>(new Set())

/** A layer can be drawn only where a tile build has covered it; until then it is testable but not drawable. */
const canDraw = (l: CdcLayer) => l.minZoom != null && (l.features ?? 0) > 0
const drawable = computed(() => layers.value.filter(canDraw))
const drawableKeys = computed(() => new Set(drawable.value.map(l => l.key)))

/**
 * What "caught" the lot means the exclusions, not the context. Zoning and minimum lot size cover the
 * whole parcel by definition, so including them paints the map over and hides the one layer worth seeing.
 */
const caughtKeys = computed(() => hits.value
  .filter(h => h.kind === 'exclusion' && drawableKeys.value.has(h.key))
  .map(h => h.key))

function toggle(key: string) {
  const next = new Set(on.value)
  const adding = !next.has(key)
  adding ? next.add(key) : next.delete(key)
  on.value = next
  // ticking a layer while the map switch is off would otherwise do nothing visible
  if (adding && !visible.value) { visible.value = true; applyVisibility() }
  refresh()
}

function showNone() {
  on.value = new Set()
  refresh()
}

/**
 * The switch at the top of the map. Hiding is not the same as unticking: on a map with sixty layers the
 * thing you usually want is to get them off the picture for a moment and put the same ones back, so this
 * hides them without touching the selection. With nothing selected there would be nothing to hide, so it
 * turns the layers on instead - what it will do is always what it says.
 */
const visible = ref(true)

const switchLabel = computed(() => {
  if (!on.value.size) return 'Show all layers'
  return visible.value ? 'Hide layers' : 'Show layers'
})

const switchTitle = computed(() => {
  if (!on.value.size) return `Draw all ${drawable.value.length} layers the tile build covers`
  return visible.value
    ? 'Take them off the map without losing which ones are ticked'
    : 'Put the same layers back'
})

function flip() {
  if (!on.value.size) {
    on.value = new Set(drawable.value.map(l => l.key))
    visible.value = true
    refresh()
    return
  }
  visible.value = !visible.value
  applyVisibility()
}

/** Visibility is a layout property, so the ticks and the filters are untouched by it. */
function applyVisibility() {
  if (!map?.getStyle?.()) return
  const v = visible.value ? 'visible' : 'none'
  for (const g of data.value?.groups ?? []) {
    for (const suffix of ['fill', 'line']) {
      const id = `cdc-${g.key}-${suffix}`
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
    }
  }
}

/** The layers that caught this lot, so the verdict and the map can be read against each other. */
function showCaught() {
  on.value = new Set(caughtKeys.value)
  if (!visible.value) { visible.value = true; applyVisibility() }
  refresh()
}

function zoomTo(l: CdcLayer) {
  if (!map || !l.bbox) return
  map.fitBounds([[l.bbox[0], l.bbox[1]], [l.bbox[2], l.bbox[3]]], { padding: 60, duration: 800 })
}

const zoom = ref(9)

/**
 * A layer switched on but not yet drawn because the map is too far out. The blankets - bush fire,
 * terrestrial biodiversity, riparian, the coastal buffers - are tiled from zoom 9 only, so without this
 * a tick at state level looks like a broken switch rather than a layer waiting to be zoomed into.
 */
function tooFarOut(l: CdcLayer): boolean {
  return on.value.has(l.key) && (l.minZoom ?? 0) > zoom.value
}

const hits = computed(() => answer.value?.hits ?? [])
const hitOf = (l: CdcLayer) => hits.value.find(h => h.key === l.key)

const scopeSections = computed(() =>
  SCOPE_TEXT.map(s => ({ ...s, hits: hits.value.filter(h => h.scope === s.key) }))
    .filter(s => s.hits.length))

/**
 * The panel is ordered the way /cdc is: by the instrument, not by theme. Read down it and you are
 * reading 1.17A, then 1.18, then 1.19A, then 1.19, then Schedule 5, then the codes - the same sequence
 * as the rules page, so a layer is where a reader of the clauses would look for it.
 *
 * 1.19A is listed before 1.19 for the same reason it is there: the prefix test would otherwise swallow
 * it. The thematic groups still exist underneath, because they are how the layers are tiled, but they
 * are an implementation detail and no longer what the reader sees.
 */
const PARTS: { key: string; title: string; lead: string; test: (l: CdcLayer) => boolean }[] = [
  {
    key: '1.17A',
    title: 'Clause 1.17A',
    lead: 'complying development under any environmental planning instrument',
    test: l => l.clauses.some(c => c.startsWith('1.17A')),
  },
  {
    key: '1.18',
    title: 'Clause 1.18',
    lead: 'complying development under this Policy',
    test: l => l.clauses.some(c => c.startsWith('1.18')),
  },
  {
    key: '1.19A',
    title: 'Clause 1.19A',
    lead: 'bush fire prone land',
    test: l => l.clauses.some(c => c.startsWith('1.19A')),
  },
  {
    key: '1.19',
    title: 'Clause 1.19',
    lead: 'the Housing, Inland, Low Rise and Pattern Book codes',
    test: l => l.clauses.some(c => c.startsWith('1.19') && !c.startsWith('1.19A')),
  },
  {
    key: 'sch5',
    title: 'Schedule 5',
    lead: 'land each council has excluded by map',
    test: l => l.clauses.some(c => /^Schedule/i.test(c)),
  },
  {
    key: 'codes',
    title: 'The development codes',
    lead: 'what each code adds on top, and where it applies',
    test: l => l.clauses.some(c => /^(\d+[A-Z]?\.|54|58|Sch)/.test(c)) && !/^18\d/.test(l.clauses[0] ?? ''),
  },
  {
    key: 'midrise',
    title: 'Mid-rise housing',
    lead: 'Housing SEPP clause 182, which gates the Pattern Book',
    test: l => l.clauses.some(c => /^18\d/.test(c)),
  },
  {
    key: 'none',
    title: 'No clause in the workbook',
    lead: 'we exclude on these, but nothing in the workbook says to',
    test: l => l.clauses.length === 0,
  },
]

/** Natural order inside a part, so 1.19(1)(c) comes before 1.19(1)(c1) and 3B.2 before 3B.33. */
function clauseKey(clause: string): string {
  return clause.replace(/\d+/g, n => n.padStart(4, '0'))
}

const grouped = computed(() => {
  const seen = new Set<string>()
  const out: { key: string; title: string; lead: string; items: CdcLayer[]; caught: number }[] = []
  for (const part of PARTS) {
    // a layer belongs to the first part that claims it, so nothing is listed twice
    const items = layers.value.filter(l => !seen.has(l.key) && part.test(l))
    for (const l of items) seen.add(l.key)
    if (!items.length) continue
    items.sort((a, b) =>
      clauseKey(a.clauses[0] ?? '~').localeCompare(clauseKey(b.clauses[0] ?? '~'))
      || a.title.localeCompare(b.title))
    out.push({ ...part, items, caught: items.filter(l => hitOf(l)).length })
  }
  // anything no part claimed, rather than dropping it off the page
  const rest = layers.value.filter(l => !seen.has(l.key))
  if (rest.length) {
    out.push({ key: 'rest', title: 'Everything else', lead: '', items: rest,
      caught: rest.filter(l => hitOf(l)).length })
  }
  return out
})

function statusOf(l: CdcLayer): string {
  if (!answer.value) return 'idle'
  const h = hitOf(l)
  // a hit on a context layer is a fact about the lot, so it must not be tinted like a failure
  if (h) return h.kind === 'context' ? 'context' : 'hit'
  return l.sourceKind === 'none' ? 'open' : 'clear'
}

/**
 * The dot answers "what am I looking at". A caught layer takes its scope colour, matching the verdict
 * beside it; a layer merely switched on takes its group colour, matching how it is drawn on the map.
 * Those are the only two things the dot can usefully mean, and it never means both at once.
 */
function dotOf(l: CdcLayer): string {
  const h = hitOf(l)
  if (h) return SCOPE_COLOUR[h.scope]
  if (on.value.has(l.key)) return SCOPE_COLOUR[l.scope] ?? '#64748b'
  if (l.sourceKind === 'none') return '#cbd5e1'
  return answer.value ? '#bbf7d0' : '#e2e8f0'
}

/** Below a tenth of a percent a share reads as zero, which is not what a sliver of overlap means. */
function pct(v: number): string {
  if (v >= 99.95) return '100%'
  if (v > 0 && v < 0.1) return '<0.1%'
  return `${v.toFixed(1)}%`
}

const CODES_SEPP = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2008-0572'
const HOUSING_SEPP = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714'

function clauseLink(clause: string): string {
  const sec = clause.match(/^[\w.]+/)?.[0]?.replace(/\.$/, '') ?? ''
  if (/^18\d/.test(sec)) return `${HOUSING_SEPP}#sec.${sec}`
  if (/^Schedule/i.test(clause)) return `${CODES_SEPP}#sch.5`
  return `${CODES_SEPP}#sec.${sec}`
}

// ── the lot and address search, as on /epi ───────────────────────────────────
interface LotMatch {
  cadid: string
  msoid: number | null
  address: string | null
  lotId: string | null
  titleLot: string | null
  lgaName: string | null
}

const q = ref('')
const results = ref<LotMatch[]>([])
const listOpen = ref(false)
const highlight = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

function onType() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 150)
}

async function runSearch() {
  const term = q.value.trim()
  msg.value = ''
  if (term.length < 3) { results.value = []; listOpen.value = false; return }
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  try {
    const r = await $fetch<{ results: LotMatch[] }>('/api/lotprofile',
      { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    highlight.value = 0
    listOpen.value = r.results.length > 0
  } catch (e: any) {
    if (!ctrl.signal.aborted) msg.value = e?.data?.message || 'The search failed.'
  } finally {
    if (inflight === ctrl) inflight = null
  }
}

function move(step: number) {
  if (!results.value.length) return
  listOpen.value = true
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}

function pickHighlighted() {
  if (results.value.length) pickLot(results.value[highlight.value] ?? results.value[0]!)
}

async function pickLot(r: LotMatch) {
  listOpen.value = false
  q.value = r.address || r.titleLot || r.lotId || q.value
  await read({ cadid: r.cadid })
}

// ── the map ──────────────────────────────────────────────────────────────────
const mapEl = ref<HTMLElement | null>(null)
let mapboxgl: any = null
let map: any = null

const LOT_SRC = 'cm-lot'
const HIT_SRC = 'cm-hits'

/**
 * One vector source per tiled group, as on /lmr: the switches are a map filter on layer_key, so turning a
 * layer on never changes a tile URL and never refetches anything. A group with no archive yet is simply
 * not added, and its layers stay listed but cannot be ticked.
 */
function addTileLayers() {
  const groups = data.value?.groups ?? []
  // reversed: the big blankets go down first, the small precise layers on top of them
  for (const g of [...groups].reverse()) {
    if (!g.archive) continue
    const src = `cdc-${g.key}`
    map.addSource(src, {
      type: 'vector',
      tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=cdc-${g.key}&v=${encodeURIComponent(g.archive)}`],
      minzoom: g.minZoom,
      maxzoom: g.maxZoom,
    })
    const none = ['in', ['get', 'layer_key'], ['literal', []]]
    // colour per feature rather than per source: an archive is a bundle of layers that happen to be
    // tiled together, and the scope is a property of the layer, not of the bundle
    const colour: any[] = ['match', ['get', 'layer_key']]
    for (const l of (data.value?.layers ?? []).filter(x => x.group === g.key)) {
      colour.push(l.key, SCOPE_COLOUR[l.scope] ?? '#64748b')
    }
    colour.push('#64748b')
    map.addLayer({
      id: `${src}-fill`, type: 'fill', source: src, 'source-layer': 'cdc', filter: none,
      paint: { 'fill-color': colour, 'fill-opacity': 0.14 },
    })
    map.addLayer({
      id: `${src}-line`, type: 'line', source: src, 'source-layer': 'cdc', filter: none,
      paint: { 'line-color': colour, 'line-width': 1, 'line-opacity': 0.85 },
    })
  }
  refresh()
}

/** Push the switches into the map filters. */
function refresh() {
  if (!map?.getStyle?.()) return
  for (const g of data.value?.groups ?? []) {
    const keys = (data.value?.layers ?? [])
      .filter(l => l.group === g.key && on.value.has(l.key))
      .map(l => l.key)
    const filter = ['in', ['get', 'layer_key'], ['literal', keys]]
    for (const suffix of ['fill', 'line']) {
      const id = `cdc-${g.key}-${suffix}`
      if (map.getLayer(id)) map.setFilter(id, filter)
    }
  }
}

function draw(res: CdcAtResponse) {
  if (!map?.isStyleLoaded?.()) return
  const lot = res.lotGeom
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: res.lotGeom }] }
    : { type: 'FeatureCollection', features: [] }
  // only the exclusions are drawn: outlining the zone and the minimum lot size would paint the whole
  // parcel over in blue and hide the thing worth seeing
  const caught = {
    type: 'FeatureCollection',
    features: res.hits.filter(h => h.geom && h.kind === 'exclusion').map(h => ({
      type: 'Feature',
      properties: { colour: SCOPE_COLOUR[h.scope], title: h.title },
      geometry: h.geom as any,
    })),
  }
  ;(map.getSource(LOT_SRC) as any)?.setData(lot)
  ;(map.getSource(HIT_SRC) as any)?.setData(caught)

  if (res.lotGeom) {
    const b = bboxOf(res.lotGeom)
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 90, maxZoom: 17.5, duration: 700 })
  }
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

let reading: AbortController | null = null

async function read(opts: { cadid?: string; lon?: number; lat?: number }) {
  reading?.abort()
  const ctrl = new AbortController()
  reading = ctrl
  status.value = 'Reading every layer…'
  msg.value = ''
  try {
    const res = await $fetch<CdcAtResponse>('/api/cdc/at', { query: opts, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    answer.value = res
    draw(res)
  } catch (e: any) {
    if (!ctrl.signal.aborted) msg.value = e?.data?.message || 'Could not read that lot.'
  } finally {
    if (reading === ctrl) { reading = null; status.value = '' }
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
    center: [151.1, -33.75],
    zoom: 9,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  map.on('zoomend', () => { zoom.value = map.getZoom() })
  map.on('load', () => {
    zoom.value = map.getZoom()
    addTileLayers()
    const empty = { type: 'FeatureCollection', features: [] }
    map.addSource(HIT_SRC, { type: 'geojson', data: empty })
    map.addLayer({
      id: 'cm-hit-fill', type: 'fill', source: HIT_SRC,
      paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.35 },
    })
    map.addLayer({
      id: 'cm-hit-line', type: 'line', source: HIT_SRC,
      paint: { 'line-color': ['get', 'colour'], 'line-width': 1.2 },
    })
    map.addSource(LOT_SRC, { type: 'geojson', data: empty })
    map.addLayer({
      id: 'cm-lot-line', type: 'line', source: LOT_SRC,
      paint: { 'line-color': '#0f172a', 'line-width': 2.5 },
    })
    if (answer.value) draw(answer.value)
  })
  map.on('click', (e: any) => read({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<style scoped>
.cm-page {
  height: 100vh; display: flex; flex-direction: column;
  background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
}
.cm-header {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0; flex: none;
}
.cm-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.cm-back:hover { color: #0f172a; }
.cm-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; }
.cm-header-stat { font-size: 0.8rem; color: #64748b; }
.cm-header-stat strong { color: #0f172a; font-weight: 700; }
.cm-link { color: #2a78d6; text-decoration: none; }
.cm-link:hover { text-decoration: underline; }

.cm-body { flex: 1; display: flex; min-height: 0; }
.cm-panel {
  width: clamp(260px, 26vw, 360px); flex: none; display: flex; flex-direction: column;
  background: #fff; border-right: 1px solid #e2e8f0; overflow-y: auto;
}
.cm-panel--right { border-right: none; border-left: 1px solid #e2e8f0; padding-bottom: 2rem; }

.cm-search { padding: 0.7rem 0.8rem; border-bottom: 1px solid #e2e8f0; position: relative; }
.cm-input {
  width: 100%; padding: 0.4rem 0.6rem; font: inherit; font-size: 0.85rem;
  border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; color: #0f172a;
}
.cm-input:focus { outline: 2px solid #93c5fd; outline-offset: -1px; background: #fff; }
.cm-results {
  position: absolute; left: 0.8rem; right: 0.8rem; top: 3rem; z-index: 5; margin: 0; padding: 0;
  list-style: none; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px;
  box-shadow: 0 8px 22px rgb(15 23 42 / 0.12); max-height: 15rem; overflow-y: auto;
}
.cm-results li { padding: 0.3rem 0.6rem; cursor: pointer; font-size: 0.78rem; }
.cm-results li b { display: block; font-weight: 600; color: #0f172a; }
.cm-results li span { color: #64748b; font-size: 0.72rem; }
.cm-res--on, .cm-results li:hover { background: #eff6ff; }
.cm-msg { margin: 0.4rem 0 0; font-size: 0.75rem; color: #b91c1c; }

.cm-bar {
  display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
  padding: 0.4rem 0.8rem; border-bottom: 1px solid #f1f5f9; font-size: 0.72rem; color: #64748b;
}
.cm-bar-n { font-weight: 600; }
.cm-link {
  padding: 0; background: none; border: none; font: inherit; font-size: 0.72rem;
  color: #2a78d6; cursor: pointer; text-decoration: none;
}
.cm-link:hover { text-decoration: underline; }

.cm-groups { padding: 0.5rem 0.4rem 2rem; }
.cm-group { margin-bottom: 0.4rem; }
.cm-g-title {
  display: flex; align-items: center; gap: 0.4rem; margin: 0 0 0.2rem; padding: 0.15rem 0.4rem;
  font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;
  color: #64748b; cursor: pointer; list-style: none; border-radius: 6px;
}
.cm-g-title::-webkit-details-marker { display: none; }
.cm-g-title:hover { background: #f8fafc; color: #0f172a; }
.cm-g-lead { margin: 0 0 0.3rem 1.05rem; font-size: 0.68rem; color: #94a3b8; }
.cm-item { margin-bottom: 0.05rem; }
.cm-row input { margin: 0; flex: none; accent-color: #0f172a; }
.cm-row { cursor: pointer; }
.cm-row input:disabled { opacity: 0.35; cursor: not-allowed; }

.cm-about { margin: 0 0 0.2rem 1.6rem; }
.cm-about > summary {
  font-size: 0.66rem; color: #94a3b8; cursor: pointer; list-style: none; padding: 0.05rem 0;
}
.cm-about > summary::-webkit-details-marker { display: none; }
.cm-about > summary:hover { color: #475569; text-decoration: underline; }
.cm-about-row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; margin: 0.15rem 0;
  font-size: 0.7rem; color: #475569;
}
.cm-about-k {
  flex: none; width: 3.6rem; font-size: 0.62rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; color: #94a3b8;
}
.cm-about-row code { font-size: 0.66rem; color: #0f172a; background: #f1f5f9; border-radius: 4px; padding: 0 0.22rem; word-break: break-all; }
.cm-chip {
  font-size: 0.64rem; font-weight: 700; color: #2a78d6; text-decoration: none;
  background: #eff6ff; border-radius: 4px; padding: 0 0.25rem;
}
.cm-chip:hover { text-decoration: underline; }
.cm-cats { margin: 0.2rem 0 0 3.9rem; padding: 0; list-style: none; font-size: 0.68rem; color: #475569; }
.cm-about-note { margin: 0.25rem 0 0; font-size: 0.68rem; color: #92400e; }
.cm-g-n { margin-left: auto; font-size: 0.68rem; font-weight: 700; color: #94a3b8; }
.cm-g-n--hit { color: #b91c1c; }
.cm-list { margin: 0; padding: 0; list-style: none; }
.cm-row {
  display: flex; align-items: center; gap: 0.45rem; padding: 0.18rem 0.4rem; border-radius: 6px;
  font-size: 0.78rem;
}
.cm-row--hit { background: #fef2f2; }
.cm-row--context { background: #eff6ff; }
.cm-row--context .cm-name { color: #0f172a; }
.cm-row--context .cm-meta { color: #2563eb; font-weight: 600; }
.cm-row--clear .cm-name, .cm-row--open .cm-name { color: #94a3b8; }
.cm-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.cm-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-row--hit .cm-name { color: #0f172a; font-weight: 600; }
.cm-meta { font-size: 0.68rem; color: #94a3b8; font-variant-numeric: tabular-nums; flex: none; }
.cm-row--hit .cm-meta { color: #b91c1c; font-weight: 700; }
.cm-meta--zoom { color: #b45309 !important; font-weight: 600; }

.cm-map-wrap { flex: 1; position: relative; min-width: 0; }
.cm-map { position: absolute; inset: 0; }
.cm-maptools {
  position: absolute; left: 0.8rem; top: 0.8rem; z-index: 2;
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
}
.cm-switch {
  display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.7rem;
  background: rgb(255 255 255 / 0.95); border: 1px solid #cbd5e1; border-radius: 999px;
  font: inherit; font-size: 0.76rem; font-weight: 600; color: #334155; cursor: pointer;
  box-shadow: 0 1px 4px rgb(15 23 42 / 0.12);
}
/* :hover is one class plus a pseudo-class, so it outranks .cm-switch--on and would paint the active
   button's label dark on dark - which is exactly the state the pointer is in when you click it. */
.cm-switch:hover:not(.cm-switch--on) { border-color: #94a3b8; color: #0f172a; }
.cm-switch--on { background: #0f172a; border-color: #0f172a; color: #fff; }
.cm-switch--on:hover { background: #1e293b; }
.cm-switch-dot {
  width: 9px; height: 9px; border-radius: 50%; background: #cbd5e1; flex: none;
}
.cm-switch--on .cm-switch-dot { background: #4ade80; }
.cm-switch-n {
  padding: 0.2rem 0.5rem; background: rgb(255 255 255 / 0.92); border: 1px solid #e2e8f0;
  border-radius: 999px; font-size: 0.7rem; color: #64748b; font-variant-numeric: tabular-nums;
}
.cm-status {
  margin: 0; padding: 0.25rem 0.6rem;
  background: rgb(255 255 255 / 0.92); border: 1px solid #e2e8f0; border-radius: 999px;
  font-size: 0.72rem; color: #475569;
}
.cm-status--alone { position: absolute; left: 0.8rem; top: 0.8rem; z-index: 2; }

.cm-lot { padding: 0.8rem 0.9rem 0.5rem; border-bottom: 1px solid #f1f5f9; }
.cm-lot-id { margin: 0; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.cm-lot-sub { margin: 0.1rem 0 0; font-size: 0.75rem; color: #64748b; }
.cm-dim { color: #94a3b8; }

.cm-headline {
  margin: 0; padding: 0.6rem 0.9rem; font-size: 0.82rem; font-weight: 600;
  border-bottom: 1px solid #f1f5f9;
}
.cm-headline--no { background: #fef2f2; color: #991b1b; }
.cm-headline--yes { background: #f0fdf4; color: #166534; }

.cm-sec { padding: 0.7rem 0.9rem 0.2rem; }
.cm-sec-title {
  display: flex; align-items: center; gap: 0.4rem; margin: 0 0 0.25rem;
  font-size: 0.78rem; font-weight: 800; color: #0f172a;
}
.cm-swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.cm-swatch--open { background: #cbd5e1; }
.cm-sec-n { margin-left: auto; font-size: 0.7rem; color: #94a3b8; font-weight: 700; }
.cm-sec-lead { margin: 0 0 0.45rem; font-size: 0.72rem; color: #64748b; }
.cm-hits { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.4rem; }
.cm-hit { padding: 0.4rem 0.55rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.cm-hit--open { background: #fff; border-style: dashed; }
.cm-hit-head { display: flex; align-items: baseline; gap: 0.5rem; }
.cm-hit-title { font-size: 0.78rem; font-weight: 700; color: #0f172a; }
.cm-hit-pct { margin-left: auto; font-size: 0.72rem; color: #475569; font-variant-numeric: tabular-nums; }
.cm-hit-names { margin: 0.1rem 0 0; font-size: 0.72rem; color: #475569; }
.cm-hit-clauses { margin: 0.2rem 0 0; display: flex; flex-wrap: wrap; gap: 0.3rem; }
.cm-hit-clauses a {
  font-size: 0.68rem; font-weight: 700; color: #2a78d6; text-decoration: none;
  background: #eff6ff; border-radius: 4px; padding: 0 0.25rem;
}
.cm-hit-clauses a:hover { text-decoration: underline; }
.cm-hit-note { margin: 0.25rem 0 0; font-size: 0.7rem; color: #92400e; }
.cm-hit--open .cm-hit-note { color: #64748b; }

.cm-empty { padding: 1.1rem 0.9rem; }
.cm-empty-title { margin: 0 0 0.4rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.cm-empty p { margin: 0 0 0.6rem; font-size: 0.78rem; color: #475569; }
.cm-empty code { font-size: 0.74rem; background: #f1f5f9; border-radius: 4px; padding: 0 0.2rem; }

@media (max-width: 1100px) {
  .cm-page { height: auto; }
  .cm-body { flex-direction: column; }
  .cm-panel { width: auto; border-right: none; border-bottom: 1px solid #e2e8f0; max-height: 26rem; }
  .cm-panel--right { border-left: none; }
  .cm-map-wrap { height: 60vh; flex: none; }
}
</style>
