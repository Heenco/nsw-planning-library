<!--
  /esa - the environmentally sensitive areas of clause 3.3, on a map.

  Clause 3.3 has two halves and the page is built around the difference, because confusing them is the easy
  mistake. The left panel has a tab for each:

    Clause 3.3 itself   the state-wide definition, which applies to every lot in NSW. One checkbox per item,
                        grouped by paragraph, with where the layer came from and whether it reconciled.
                        esa.clause33_layers + the esa33 tile archive (Notebooks 07C).
    What plans add      the items 30 local plans add on top, in two tiers: a precise item is real geometry,
                        an advisory one is its whole council area and means only "this exists somewhere here".
                        A checkbox per tier and per item. esa.additional_exceptions + the esa tile archive
                        (Notebooks 07).

  Like /lmr, every layer is a checkbox and the panel is the legend. A downloaded layer carries a link to the
  service it came from, because "downloaded" is only checkable if you can see where from.

  Both halves stay on the map when the tab changes, so they can be read against each other. Clicking a shape,
  or an item in the panel, selects it: the panel shows the item and the map goes to it.

  Three columns: what the layers hold on the left, the map in the middle, how they were built on the right.

  Tiles: esa-exceptions.pmtiles and esa-clause33.pmtiles on the planningai host (scripts/build-esa-pmtiles.py,
  scripts/build-esa33-pmtiles.py), read through /api/lmr/tiles?set=esa and ?set=esa33. Everything else comes
  from /api/esa and /api/esa/clause33.
-->

<template>
  <div class="ea-page">
    <header class="ea-header">
      <div>
        <NuxtLink to="/" class="ea-back">&larr; Home</NuxtLink>
        <h1 class="ea-title">Environmentally sensitive areas — clause 3.3</h1>
      </div>
      <div class="ea-header-stat">
        <template v-if="wide?.ok">
          <strong>{{ wide.summary.withLayer }}</strong> state-wide layers ·
          <strong>{{ wide.summary.gaps }}</strong> gaps ·
        </template>
        <template v-if="data?.ok">
          <strong>{{ data.summary.items }}</strong> plan additions ·
          <strong>{{ data.summary.leps }}</strong> plans
        </template>
      </div>
    </header>

    <div class="ea-body">
      <!-- ── everything the layer holds ─────────────────────────────────── -->
      <aside class="ea-panel">
      <!-- ── What applies at one lot ──────────────────────────────────────
           The page is a catalogue of clause 3.3; this makes it answerable for a
           particular piece of land. Same test as /epi and /cdc-map: the lot
           polygon, not the address point, because clause 3.3 excludes land that
           IS sensitive and half a lot is enough. -->
      <div class="ea-lot">
        <div class="ea-combo">
          <label class="ea-sr" for="ea-q">Address or lot reference</label>
          <input
            id="ea-q" v-model="q" type="search" class="ea-input" role="combobox"
            placeholder="An address, or a lot &mdash; A//DP71490"
            autocomplete="off" spellcheck="false"
            :aria-expanded="listOpen && results.length > 0" aria-controls="ea-listbox"
            @input="onType" @keydown.enter.prevent="pickHighlighted"
            @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false"
          >
          <ul v-if="listOpen && results.length" id="ea-listbox" class="ea-listbox" role="listbox">
            <li
              v-for="(r, i) in results" :key="r.cadid" role="option" :aria-selected="i === highlight"
              class="ea-option" :class="{ 'ea-option--on': i === highlight }"
              @mousedown.prevent="pickLot(r)" @mousemove="highlight = i"
            >
              <span class="ea-option-addr">{{ r.address || '(no address)' }}</span>
              <code class="ea-option-lot">{{ r.lotId || r.cadid }}</code>
            </li>
          </ul>
        </div>
        <p v-if="searchMsg" class="ea-lot-msg">{{ searchMsg }}</p>

        <template v-if="atBusy"><p class="ea-lot-msg">Testing the lot&hellip;</p></template>
        <template v-else-if="atError"><p class="ea-lot-msg ea-lot-msg--err">{{ atError }}</p></template>
        <template v-else-if="at">
          <p class="ea-lot-head">
            <strong>{{ at.lot?.lotId || at.lot?.cadid }}</strong>
            <span class="ea-lot-dim">{{ at.summary.tested }} layers tested &middot; {{ at.ms }} ms</span>
          </p>
          <p class="ea-lot-verdict" :class="at.summary.statewide ? 'ea-lot-verdict--caught' : 'ea-lot-verdict--clear'">
            <template v-if="at.summary.statewide">
              Environmentally sensitive: <strong>{{ at.summary.statewide }}</strong>
              state-wide {{ at.summary.statewide === 1 ? 'item' : 'items' }} catch this lot.
            </template>
            <template v-else>No state-wide clause 3.3 item catches this lot.</template>
            <template v-if="at.summary.gaps">
              <br>{{ at.summary.gaps }} {{ at.summary.gaps === 1 ? 'item has' : 'items have' }}
              no dataset, so it cannot be fully cleared.
            </template>
          </p>
          <ul class="ea-lot-hits">
            <li v-for="h in at.hits" :key="h.key" class="ea-lot-hit" :class="`ea-lot-hit--${h.kind}`">
              <span class="ea-lot-hit-item">{{ h.item }}</span>
              <span class="ea-lot-hit-meta">
                <template v-if="h.paragraph">cl 3.3({{ h.paragraph }})</template>
                <template v-else-if="h.half === 'addition'">plan addition</template>
                <template v-else>not a clause 3.3 exclusion</template>
                &middot; {{ h.coverPct.toFixed(1) }}%
                <template v-if="h.coverageType"> &middot; {{ h.coverageType }}</template>
                <template v-if="h.verifyRequired"> &middot; verify by hand</template>
              </span>
              <span v-if="h.names.length" class="ea-lot-hit-names">{{ h.names.slice(0, 3).join('; ') }}</span>
            </li>
          </ul>
        </template>
      </div>

        <div class="ea-tabs">
          <button
            v-for="t in TABS" :key="t.key" type="button"
            class="ea-tab" :class="{ 'ea-tab--on': tab === t.key }"
            :aria-pressed="tab === t.key" @click="tab = t.key"
          >
            <span class="ea-tab-name">{{ t.label }}</span>
            <span class="ea-tab-note">{{ t.note }}</span>
          </button>
        </div>

        <!-- ══ the state-wide definition ═══════════════════════════════════ -->
        <template v-if="tab === 'wide'">
          <p v-if="wideError" class="ea-error">Could not load the state-wide layers: {{ wideError }}</p>
          <p v-else-if="wide && !wide.ok" class="ea-error">{{ wide.reason }}</p>

          <template v-if="wide?.ok">
            <p class="ea-lead">
              This half of clause 3.3 applies to every lot in NSW. {{ wide.summary.withLayer }} of
              {{ wide.summary.items }} items have a layer, {{ wide.summary.verified }} of those reconciled
              against their source, and {{ wide.summary.gaps }} have no dataset published anywhere.
            </p>

            <div class="ea-allrow">
              <button type="button" class="ea-all" @click="setAllWide(true)">Turn all on</button>
              <button type="button" class="ea-all" @click="setAllWide(false)">Turn all off</button>
              <span class="ea-dim">{{ wideShown.size }} of {{ tiledLayers.length }} drawn</span>
            </div>

            <section v-for="g in byParagraph" :key="g.para" class="ea-group ea-group--tight">
              <h2 class="ea-h2 ea-h2--para">
                <i class="ea-key" :style="{ background: fillOf(g.para), borderColor: lineOf(g.para) }" />
                {{ g.para === '?' ? 'Letter not confirmed' : `Paragraph (${g.para})` }}
              </h2>
              <ul class="ea-wlist">
                <li v-for="l in g.layers" :key="l.key">
                  <label class="ea-row" :class="{ 'ea-row--dead': !l.tiled }">
                    <input type="checkbox" :checked="wideShown.has(l.key)" :disabled="!l.tiled" @change="toggleWide(l.key)">
                    <span class="ea-swatch" :style="{ background: fillOf(l.paragraph), borderColor: lineOf(l.paragraph) }" />
                    <span class="ea-name">{{ l.item }}</span>
                    <span class="ea-n">{{ l.rowCount == null ? '—' : fmt(l.rowCount) }}</span>
                  </label>
                  <p class="ea-wmeta">
                    <span class="ea-pill" :class="`ea-pill--${l.provenance}`">{{ PROVENANCE_WORD[l.provenance] }}</span>
                    <span v-if="l.verified" class="ea-ok">reconciled</span>
                    <span v-else-if="l.provenance !== 'gap'" class="ea-warn">not reconciled</span>
                    <span v-if="l.invalidGeoms" class="ea-dim">{{ l.invalidGeoms }} repaired</span>
                    <span v-if="l.table && !l.tiled" class="ea-dim">in the database, not drawn</span>
                    <button v-if="l.tiled && l.bbox" type="button" class="ea-link" @click="zoomToWide(l)">zoom to</button>
                  </p>
                  <!-- a downloaded layer names the service it came from, so it can be checked or re-fetched -->
                  <p v-if="isUrl(l.source)" class="ea-wmeta">
                    <a :href="l.source!" target="_blank" rel="noopener" class="ea-src" :title="l.source!">{{ sourceLabel(l.source!) }}</a>
                  </p>
                  <p v-else-if="l.provenance === 'derived' && l.source" class="ea-wmeta ea-dim">
                    from <code>{{ l.source }}</code>
                  </p>
                  <p v-if="l.note && (!l.verified || !l.tiled)" class="ea-wnote">{{ l.note }}</p>
                </li>
              </ul>
            </section>

            <p v-if="wide.note" class="ea-note">{{ wide.note }}</p>
          </template>
        </template>

        <!-- ══ what the plans add ══════════════════════════════════════════ -->
        <template v-else>
          <p v-if="error" class="ea-error">Could not load the layer: {{ error }}</p>
          <p v-else-if="data && !data.ok" class="ea-error">{{ data.reason }}</p>

          <template v-if="data?.ok">
          <!-- the two tiers, which switch every item of that tier at once -->
          <div class="ea-tiers">
            <label v-for="t in TIERS" :key="t.key" class="ea-row">
              <input type="checkbox" :checked="shown.has(t.key)" @change="toggleTier(t.key)">
              <span class="ea-swatch" :class="`ea-key--${t.key}`" />
              <span class="ea-name">{{ t.label }} <span class="ea-dim">— {{ t.note }}</span></span>
              <span class="ea-n">{{ count(t.key) }} · {{ fmt(area(t.key)) }} km²</span>
            </label>
          </div>

          <div class="ea-filters">
            <input v-model="term" type="search" class="ea-input" placeholder="Search the wording or a layer…">
            <select v-model="lep" class="ea-select">
              <option value="">All {{ plans.length }} plans</option>
              <option v-for="p in plans" :key="p" :value="p">{{ shortPlan(p) }}</option>
            </select>
            <button v-if="term || lep || layerFilter" type="button" class="ea-clear" @click="clearFilters">Clear</button>
          </div>
          <p class="ea-count">
            {{ visible.length }} of {{ data.summary.items }} items on the map<template v-if="listed.length !== visible.length">,
              {{ listed.length - visible.length }} switched off</template><template v-if="layerFilter">,
              drawn from <b>{{ layerFilter.replace(/_/g, ' ') }}</b></template>
          </p>

          <!-- the selected item -->
          <section v-if="selected" class="ea-card">
            <div class="ea-card-head">
              <h2 class="ea-card-title">{{ shortPlan(selected.lepName) }} <code>{{ selected.ref }}</code></h2>
              <button type="button" class="ea-x" aria-label="Clear selection" @click="select(null)">×</button>
            </div>
            <p class="ea-card-text">{{ selected.exceptionText }}</p>
            <p class="ea-meta">
              <span class="ea-pill" :class="`ea-pill--${selected.coverageType}`">{{ selected.coverageType }}</span>
              <span v-if="selected.verifyRequired" class="ea-warn">verify on the ground</span>
              <span class="ea-dim">{{ fmt(selected.areaKm2) }} km²</span>
              <span v-if="selected.lgaName" class="ea-dim">{{ selected.lgaName }}</span>
            </p>
            <p class="ea-meta">
              <template v-if="selected.sourceLayers">
                drawn from <b>{{ selected.sourceLayers.replace(/_/g, ' ') }}</b>
                <span :class="selected.sourceFeatures ? 'ea-dim' : 'ea-warn'">
                  · {{ selected.sourceFeatures ? `${selected.sourceFeatures} features` : 'returned nothing, so this is the whole council area' }}
                </span>
              </template>
              <span v-else class="ea-dim">{{ STATUS_WORD[selected.status ?? ''] ?? selected.status }}</span>
            </p>
            <p v-if="selected.attributeFilter" class="ea-meta ea-dim">filtered: <code>{{ selected.attributeFilter }}</code></p>

            <!-- where this item's shape actually came from, said on the item rather than left to a join -->
            <p v-if="selected.sourceNote" class="ea-source-note">{{ selected.sourceNote }}</p>
            <ul v-if="selected.sourceEndpoints?.length" class="ea-endpoints">
              <li v-for="(ep, n) in selected.sourceEndpoints" :key="ep">
                <a :href="ep" target="_blank" rel="noopener">{{ selected.sourceServices?.[n] ?? ep }}</a>
              </li>
            </ul>
          </section>

          <!-- the plans and their items -->
          <section class="ea-group">
            <h2 class="ea-h2">Plans and their exceptions</h2>
            <p class="ea-lead">
              Each plan adds its own items to clause 3.3. Pick one to see it on the map.
            </p>
            <details v-for="g in grouped" :key="g.lep" class="ea-plan" :open="grouped.length <= 3 || g.lep === selected?.lepName">
              <summary class="ea-plan-sum">
                <span class="ea-plan-name">{{ shortPlan(g.lep) }}</span>
                <span class="ea-plan-n">{{ g.items.length }}</span>
              </summary>
              <ul class="ea-items">
                <!-- the box draws it, the wording selects it: both are useful and neither should steal the other -->
                <li v-for="i in g.items" :key="i.id" class="ea-item-row">
                  <input
                    type="checkbox" :checked="!itemOff.has(i.id)"
                    :aria-label="`Draw ${i.ref}`" @change="toggleItem(i.id)"
                  >
                  <button
                    type="button" class="ea-item" :class="{ 'ea-item--on': selected?.id === i.id }"
                    @click="select(i)"
                  >
                    <span class="ea-item-ref"><code>{{ i.ref }}</code></span>
                    <span class="ea-item-text">{{ i.exceptionText }}</span>
                    <span class="ea-pill" :class="`ea-pill--${i.coverageType}`">{{ i.coverageType === 'precise' ? 'P' : 'A' }}</span>
                  </button>
                </li>
              </ul>
            </details>
          </section>

          <!-- what it was drawn from -->
          <section class="ea-group">
            <h2 class="ea-h2">What it is made from</h2>
            <p class="ea-lead">
              The services the build reads. Pick one to keep only the items drawn from it.
            </p>
            <ul class="ea-layers">
              <li v-for="l in data.layers" :key="l.layerName">
                <button
                  type="button" class="ea-layer" :class="{ 'ea-layer--on': layerFilter === l.layerName, 'ea-layer--base': l.role === 'base' }"
                  :disabled="l.role === 'base'"
                  @click="layerFilter = layerFilter === l.layerName ? '' : l.layerName"
                >
                  <span class="ea-layer-name">
                    {{ l.layerName.replace(/_/g, ' ') }}
                    <span v-if="l.role === 'base'" class="ea-pill ea-pill--base">base</span>
                  </span>
                  <span class="ea-layer-n">{{ l.role === 'base' ? `${l.leps} plans` : `${l.items} items` }}</span>
                </button>
                <a :href="l.endpoint" target="_blank" rel="noopener" class="ea-layer-src"><code>{{ l.service }}</code></a>
              </li>
            </ul>
          </section>

          <!-- the caveats that belong to the data rather than the method -->
          <section class="ea-group">
            <h2 class="ea-h2">What still needs a look</h2>
            <ul class="ea-checks">
              <li v-if="fallbacks.length">
                <b>{{ fallbacks.length }} items name a layer that returned nothing</b> and fell back to the whole plan
                area:
                <button v-for="f in fallbacks" :key="f.id" type="button" class="ea-link" @click="select(f)">{{ shortPlan(f.lepName) }} {{ f.ref }}</button>
              </li>
              <li><b>{{ data.summary.verifyRequired }} items are marked for verification</b> — every advisory one, {{ fmt(data.summary.advisoryKm2) }} km² between them.</li>
              <li>
                <b>This is only what plans add.</b> The state-wide definition is the other tab —
                <button type="button" class="ea-link" @click="tab = 'wide'">Clause 3.3 itself</button>.
              </li>
            </ul>
            <p v-if="data.note" class="ea-note">{{ data.note }}</p>
          </section>
          </template>
        </template>
      </aside>

      <!-- ── the map ──────────────────────────────────────────────────────── -->
      <div class="ea-mapwrap">
        <div ref="mapEl" class="ea-map" />
        <p v-if="!mapboxToken" class="ea-over ea-error">No Mapbox token: set NUXT_PUBLIC_MAPBOX_TOKEN in .env and restart the dev server.</p>
        <p v-else-if="data?.ok && !data.tiles" class="ea-over ea-error">
          No tile archive yet — run <code>scripts/build-esa-pmtiles.py</code> and publish it. The panels still work.
        </p>
        <p v-else-if="wide?.ok && !wide.tiles && tab === 'wide'" class="ea-over ea-error">
          No state-wide tile archive yet — run <code>scripts/build-esa33-pmtiles.py</code> and publish it.
          The panel still works.
        </p>
        <p v-if="status" class="ea-status">{{ status }}</p>
        <div class="ea-legend">
          <template v-if="tab === 'wide'">
            <span v-for="p in shownParagraphs" :key="p">
              <i class="ea-key" :style="{ background: fillOf(p), borderColor: lineOf(p) }" />
              {{ p === '?' ? 'letter not confirmed' : `paragraph (${p})` }}
            </span>
            <span v-if="!shownParagraphs.length" class="ea-dim">no state-wide layer is switched on</span>
          </template>
          <template v-else>
            <span><i class="ea-key ea-key--precise" />precise — drawn from a layer</span>
            <span><i class="ea-key ea-key--advisory" />advisory — the whole council area</span>
          </template>
        </div>
      </div>

      <!-- ── how it was built ─────────────────────────────────────────────── -->
      <aside class="ea-guide">
        <div class="ea-guide-inner">
          <h2 class="ea-h2">{{ tab === 'wide' ? 'How the state-wide set is built' : 'How the additions are built' }}</h2>
          <p class="ea-lead">{{ tab === 'wide' ? ESA33_LEAD : ESA_LEAD }}</p>
          <ol class="ea-steps">
            <li v-for="s in (tab === 'wide' ? ESA33_STEPS : ESA_STEPS)" :key="s.n" class="ea-step">
              <p class="ea-step-title"><span class="ea-step-n">{{ s.n }}</span>{{ s.title }}</p>
              <p class="ea-step-body">{{ s.body }}</p>
              <p v-if="s.note" class="ea-step-note">{{ s.note }}</p>
            </li>
          </ol>
          <h3 class="ea-h3">What it does not tell you</h3>
          <div v-for="c in (tab === 'wide' ? ESA33_CAVEATS : ESA_CAVEATS)" :key="c.title" class="ea-caveat">
            <p class="ea-step-title">{{ c.title }}</p>
            <p class="ea-step-body">{{ c.body }}</p>
          </div>
          <p v-if="tab === 'wide'" class="ea-foot">
            <code>esa.clause33_layers</code> and its tables on planningai, built by
            <code>07C - ESA - clause 3.3 state-wide</code>. Tiles <code>{{ wide?.tiles?.archive ?? '—' }}</code>,
            built by <code>scripts/build-esa33-pmtiles.py</code>; rebuild both after the notebook runs, and after
            every EPI reload.
          </p>
          <p v-else class="ea-foot">
            <code>esa.additional_exceptions</code> on planningai, built by <code>07 - ESA - exceptions</code>.
            Tiles <code>{{ data?.tiles?.archive ?? '—' }}</code>, built by <code>scripts/build-esa-pmtiles.py</code>;
            rebuild both after the notebook runs.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ESA33_CAVEATS, ESA33_LEAD, ESA33_STEPS, ESA_CAVEATS, ESA_LEAD, ESA_STEPS } from '#shared/esa-method'
import type { EsaBuild, EsaItem } from '../../server/api/esa/index.get'
import type { Clause33Build } from '../../server/api/esa/clause33.get'

useHead({ title: 'Environmentally sensitive areas · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')
const { data, error } = await useFetch<EsaBuild>('/api/esa')
const { data: wide, error: wideError } = await useFetch<Clause33Build>('/api/esa/clause33')

// ── What applies at one lot ─────────────────────────────────────────────
//
// /api/esa/at answers this, and it takes a cadid - the LOT, not the address point. Clause 3.3 excludes
// land that IS environmentally sensitive, so a house on the dry half of a lot whose other half is a
// coastal wetland still sits on caught land; a point test would say otherwise, wrong in the direction
// that costs someone a certificate.

interface LotMatch { cadid: string; lotId: string | null; address: string | null }
interface EsaAtHit {
  key: string; half: 'statewide' | 'addition'; paragraph: string | null; item: string
  names: string[]; coverPct: number; kind: 'exclusion' | 'context'
  coverageType: string | null; verifyRequired: boolean
}
interface EsaAt {
  lot: { cadid: string | null; lotId: string | null } | null
  hits: EsaAtHit[]
  summary: { statewide: number; additions: number; advisory: number; tested: number; gaps: number }
  ms: number
}

const q = ref('')
const results = ref<LotMatch[]>([])
const listOpen = ref(false)
const highlight = ref(0)
const searchMsg = ref('')
const at = ref<EsaAt | null>(null)
const atBusy = ref(false)
const atError = ref('')
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

function onType() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 150)
}

async function runSearch() {
  const term = q.value.trim()
  searchMsg.value = ''
  if (term.length < 3) { results.value = []; listOpen.value = false; return }
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  try {
    const r = await $fetch<{ results: LotMatch[] }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    highlight.value = 0
    listOpen.value = r.results.length > 0
    if (!r.results.length) searchMsg.value = `Nothing matched "${term}".`
  } catch (e: any) {
    if (!ctrl.signal.aborted) searchMsg.value = e?.data?.message || 'The search failed.'
  } finally {
    if (inflight === ctrl) inflight = null
  }
}

function move(step: number) {
  if (!results.value.length) return
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}
function pickHighlighted() {
  const r = results.value[highlight.value]
  if (r) pickLot(r)
}

async function pickLot(r: LotMatch) {
  listOpen.value = false
  q.value = r.address || r.lotId || r.cadid
  atBusy.value = true
  atError.value = ''
  at.value = null
  try {
    at.value = await $fetch<EsaAt>('/api/esa/at', { query: { cadid: r.cadid } })
  } catch (e: any) {
    atError.value = e?.data?.statusMessage || e?.message || 'Could not test that lot.'
  } finally {
    atBusy.value = false
  }
}

const TABS = [
  { key: 'wide', label: 'Clause 3.3 itself', note: 'state-wide, every lot' },
  { key: 'additions', label: 'What plans add', note: '30 plans, on top' },
] as const
type TabKey = (typeof TABS)[number]['key']
const tab = ref<TabKey>('wide')

const TIERS = [
  { key: 'precise', label: 'Precise', note: 'drawn from a layer' },
  { key: 'advisory', label: 'Advisory', note: 'whole council area' },
] as const

/** One colour per clause paragraph: the paragraph is the structure worth seeing on the map. */
const PARAGRAPH_COLOUR: Record<string, string> = {
  c: '#0d9488', // coastal wetlands, littoral rainforest
  d: '#0284c7', // aquatic reserves, marine parks
  e: '#4f46e5', // Ramsar, World Heritage
  f: '#7c3aed', // the 100 m proximity
  g: '#65a30d', // Aboriginal and biodiversity significance
  h: '#166534', // National Parks estate
  i: '#a16207', // Crown reserves
  j: '#be123c', // critical habitat, outstanding biodiversity value
  '?': '#475569',
}
const lineOf = (p: string | null) => PARAGRAPH_COLOUR[p ?? '?'] ?? PARAGRAPH_COLOUR['?']!
const fillOf = (p: string | null) => `${lineOf(p)}59` // the same hue at 35% alpha

const PROVENANCE_WORD: Record<string, string> = {
  epi: 'from EPI',
  download: 'downloaded',
  derived: 'derived',
  gap: 'no data',
}

/** Layers switched on. Anything with fewer features than this starts on; the big ones stay off. */
const BUSY_FEATURES = 50_000
const wideShown = ref(new Set<string>())

/** What an item with no layer behind it is waiting on. */
const STATUS_WORD: Record<string, string> = {
  external: 'an external register, with nothing published to draw',
  derived: 'a derivation rather than a published layer',
  not_mappable: 'not mappable',
  layer_found: 'a layer that returned nothing',
}

const shown = ref(new Set(['precise', 'advisory']))
/** Items whose box has been unticked. Absence means drawn, so a new build's items arrive switched on. */
const itemOff = ref(new Set<number>())
const term = ref('')
const lep = ref('')
const layerFilter = ref('')
const selected = ref<EsaItem | null>(null)
const status = ref('')
const mapEl = ref<HTMLElement | null>(null)
let map: any = null
let mapboxgl: any = null

const items = computed(() => data.value?.items ?? [])
const plans = computed(() => [...new Set(items.value.map(i => i.lepName).filter(Boolean))] as string[])
const count = (tier: string) => items.value.filter(i => i.coverageType === tier).length
const area = (tier: string) => Math.round(items.value.filter(i => i.coverageType === tier).reduce((t, i) => t + (i.areaKm2 ?? 0), 0))

/** Everything the filters leave standing: what the panel lists, box ticked or not. */
const listed = computed(() => {
  const t = term.value.trim().toLowerCase()
  return items.value.filter(i =>
    shown.value.has(i.coverageType ?? '')
    && (!lep.value || i.lepName === lep.value)
    && (!layerFilter.value || (i.sourceLayers ?? '').includes(layerFilter.value))
    && (!t || (i.exceptionText ?? '').toLowerCase().includes(t) || (i.sourceLayers ?? '').toLowerCase().includes(t)))
})

/** What the map draws: the listed items, less the ones whose box was unticked. */
const visible = computed(() => listed.value.filter(i => !itemOff.value.has(i.id)))

const grouped = computed(() => {
  const by = new Map<string, EsaItem[]>()
  for (const i of listed.value) {
    const key = i.lepName ?? '—'
    if (!by.has(key)) by.set(key, [])
    by.get(key)!.push(i)
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([lepName, list]) => ({ lep: lepName, items: list }))
})

const fallbacks = computed(() => items.value.filter(i => i.coverageType === 'advisory' && i.sourceLayers && !i.sourceFeatures))

const shortPlan = (name: string | null) => (name ?? '').replace(' Local Environmental Plan', ' LEP')
const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'))

/* ── the state-wide half ───────────────────────────────────────────────────── */

const wideLayers = computed(() => wide.value?.layers ?? [])
const tiledLayers = computed(() => wideLayers.value.filter(l => l.tiled))

/** Every item, gaps included, under its clause paragraph - the gaps are the point of showing them. */
const byParagraph = computed(() => {
  const by = new Map<string, typeof wideLayers.value>()
  for (const l of wideLayers.value) {
    const key = l.paragraph ?? '?'
    if (!by.has(key)) by.set(key, [])
    by.get(key)!.push(l)
  }
  return [...by].sort((a, b) => (a[0] === '?' ? 1 : b[0] === '?' ? -1 : a[0].localeCompare(b[0])))
    .map(([para, layers]) => ({ para, layers }))
})

const shownParagraphs = computed(() => [...new Set(
  tiledLayers.value.filter(l => wideShown.value.has(l.key)).map(l => l.paragraph ?? '?'))].sort())

function toggleWide(key: string) {
  const next = new Set(wideShown.value)
  next.has(key) ? next.delete(key) : next.add(key)
  wideShown.value = next
}

function setAllWide(on: boolean) {
  wideShown.value = on ? new Set(tiledLayers.value.map(l => l.key)) : new Set()
}

function zoomToWide(l: { bbox: [number, number, number, number] | null }) {
  if (!map || !l.bbox) return
  const [w, s, e, n] = l.bbox
  map.fitBounds([[w, s], [e, n]], { padding: 60, duration: 800, maxZoom: 15 })
}

/** A downloaded layer's source is the service URL it was fetched from; everything else is prose. */
const isUrl = (s: string | null) => /^https?:\/\//i.test(s ?? '')

/** The host plus the service and layer id - enough to recognise, short enough for the panel. */
function sourceLabel(url: string) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const at = parts.findIndex(p => /^(Map|Feature|Image)Server$/i.test(p))
    return `${u.host}/${(at > 0 ? parts.slice(at - 1) : parts.slice(-2)).join('/')}`
  } catch {
    return url
  }
}

/** Start with the layers small enough to draw statewide; the biodiversity ones would bury the rest. */
watch(tiledLayers, (list) => {
  if (!wideShown.value.size && list.length) {
    wideShown.value = new Set(list.filter(l => (l.features ?? 0) < BUSY_FEATURES).map(l => l.key))
  }
}, { immediate: true })

function refreshWide() {
  if (!map?.getLayer('esa33-fill')) return
  const keys = [...wideShown.value]
  const filter = ['in', ['get', 'layer_key'], ['literal', keys]]
  for (const id of ['esa33-fill', 'esa33-line']) map.setFilter(id, filter)
}
watch(wideShown, refreshWide)

function toggleTier(tier: string) {
  const next = new Set(shown.value)
  next.has(tier) ? next.delete(tier) : next.add(tier)
  shown.value = next
}

function toggleItem(id: number) {
  const next = new Set(itemOff.value)
  next.has(id) ? next.delete(id) : next.add(id)
  itemOff.value = next
}

function clearFilters() {
  term.value = ''
  lep.value = ''
  layerFilter.value = ''
}

/** Select an item: the panel shows it and the map goes to it. */
function select(item: EsaItem | null) {
  selected.value = item
  if (!map || !item) {
    map?.getLayer('esa-selected') && map.setFilter('esa-selected', ['==', ['get', 'id'], -1])
    return
  }
  map.setFilter('esa-selected', ['==', ['get', 'id'], item.id])
  if (item.bbox) {
    const [w, s, e, n] = item.bbox
    map.fitBounds([[w, s], [e, n]], { padding: 60, duration: 800, maxZoom: 15 })
  }
}

/** One filter drives both fills: the map never shows what the panel has filtered out. */
function refreshMap() {
  if (!map?.getLayer('esa-fill')) return
  const ids = visible.value.map(i => i.id)
  const filter = ['in', ['get', 'id'], ['literal', ids]]
  for (const id of ['esa-fill', 'esa-line']) map.setFilter(id, filter)
}
watch(visible, refreshMap)

/** Both archives on one map: the additions underneath, the state-wide set above, selection on top. */
function addLayers() {
  addAdditionLayers()
  addWideLayers()
  addSelectionLayer()
}

function addAdditionLayers() {
  const tiles = data.value?.tiles
  if (!map || !tiles) return
  map.addSource('esa', {
    type: 'vector',
    tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=esa&v=${encodeURIComponent(tiles.archive)}`],
    minzoom: tiles.minZoom,
    maxzoom: tiles.maxZoom,
  })
  const common = { source: 'esa', 'source-layer': 'esa' }
  const byTier = (precise: any, advisory: any) => ['case', ['==', ['get', 'tier'], 'precise'], precise, advisory]
  map.addLayer({
    ...common, id: 'esa-fill', type: 'fill',
    // the precise items draw over the advisory blanket they sit inside
    layout: { 'fill-sort-key': ['case', ['==', ['get', 'tier'], 'precise'], 2, 1] },
    paint: { 'fill-color': byTier('#15803d', '#d97706'), 'fill-opacity': byTier(0.35, 0.12) },
  })
  map.addLayer({
    ...common, id: 'esa-line', type: 'line',
    paint: { 'line-color': byTier('#15803d', '#b45309'), 'line-width': byTier(1.2, 1), 'line-dasharray': [3, 2] },
  })
  refreshMap()

  map.on('click', 'esa-fill', (e: any) => {
    const hit = e.features?.[0]?.properties
    if (!hit) return
    // the smallest thing under the cursor is the one meant: a precise item inside an advisory blanket
    const here = e.features.map((f: any) => items.value.find(i => i.id === f.properties.id)).filter(Boolean) as EsaItem[]
    here.sort((a, b) => (a.areaKm2 ?? 0) - (b.areaKm2 ?? 0))
    select(here[0] ?? null)
  })
  for (const ev of ['mouseenter', 'mouseleave']) {
    map.on(ev, 'esa-fill', () => { map.getCanvas().style.cursor = ev === 'mouseenter' ? 'pointer' : '' })
  }
}

function addWideLayers() {
  const tiles = wide.value?.tiles
  if (!map || !tiles) return
  map.addSource('esa33', {
    type: 'vector',
    tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=esa33&v=${encodeURIComponent(tiles.archive)}`],
    minzoom: tiles.minZoom,
    maxzoom: tiles.maxZoom,
  })
  // one match expression over the paragraph, so a layer added by the notebook is coloured without a code change
  const colour = ['match', ['get', 'paragraph'],
    ...Object.entries(PARAGRAPH_COLOUR).filter(([p]) => p !== '?').flatMap(([p, c]) => [p, c]),
    PARAGRAPH_COLOUR['?']!]
  const common = { source: 'esa33', 'source-layer': 'esa33' }
  const none = ['in', ['get', 'layer_key'], ['literal', []]]
  map.addLayer({
    ...common, id: 'esa33-fill', type: 'fill', filter: none,
    paint: { 'fill-color': colour, 'fill-opacity': 0.3 },
  })
  map.addLayer({
    ...common, id: 'esa33-line', type: 'line', filter: none,
    paint: { 'line-color': colour, 'line-width': 1 },
  })
  refreshWide()

  map.on('click', 'esa33-fill', (e: any) => {
    const p = e.features?.[0]?.properties
    if (!p || !mapboxgl) return
    const layer = wideLayers.value.find(l => l.key === p.layer_key)
    const lines = [
      `<strong>${escapeHtml(p.name || layer?.item || p.layer_key)}</strong>`,
      layer ? `<span class="ea-pop-item">${escapeHtml(layer.item)}</span>` : '',
      // a layer with no detail column falls back to its item name, which the line above already shows
      p.detail && p.detail !== p.name && p.detail !== layer?.item
        ? `<span class="ea-pop-detail">${escapeHtml(p.detail)}</span>` : '',
      p.paragraph && p.paragraph !== '?' ? `<span class="ea-pop-para">clause 3.3 (${escapeHtml(p.paragraph)})</span>` : '',
    ].filter(Boolean)
    new mapboxgl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat).setHTML(`<div class="ea-pop">${lines.join('')}</div>`).addTo(map)
  })
  for (const ev of ['mouseenter', 'mouseleave']) {
    map.on(ev, 'esa33-fill', () => { map.getCanvas().style.cursor = ev === 'mouseenter' ? 'pointer' : '' })
  }
}

/** Added last so the selected outline sits above both archives. */
function addSelectionLayer() {
  if (!map?.getSource('esa')) return
  map.addLayer({
    source: 'esa', 'source-layer': 'esa', id: 'esa-selected', type: 'line',
    filter: ['==', ['get', 'id'], -1],
    paint: { 'line-color': '#0f172a', 'line-width': 3 },
  })
}

const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))

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
.ea-page {
  height: 100vh; display: flex; flex-direction: column;
  background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
}
.ea-header {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0; flex: none;
}
.ea-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.ea-back:hover { color: #0f172a; }
.ea-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; }
.ea-header-stat { font-size: 0.8rem; color: #64748b; }
.ea-header-stat strong { color: #0f172a; font-weight: 700; }

.ea-body { flex: 1; min-height: 0; display: flex; }
.ea-panel { width: 380px; flex: none; overflow-y: auto; padding: 0.9rem 1rem 2rem; background: #fff; border-right: 1px solid #e2e8f0; }
.ea-mapwrap { position: relative; flex: 1; min-width: 0; }
.ea-map { position: absolute; inset: 0; }
.ea-guide { width: 340px; flex: none; overflow-y: auto; padding: 0.9rem 1rem 2rem; background: #fff; border-left: 1px solid #e2e8f0; }
@media (max-width: 1250px) {
  .ea-page { height: auto; min-height: 100vh; }
  .ea-body { flex-direction: column; }
  .ea-panel, .ea-guide { width: auto; border: 0; border-bottom: 1px solid #e2e8f0; }
  .ea-mapwrap { height: 70vh; flex: none; }
}

/* every layer on this page is a checkbox row: box, colour, name, count - the panel is the legend */
.ea-row { display: flex; align-items: center; gap: 0.45rem; padding: 0.2rem 0.3rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; color: #0f172a; cursor: pointer; }
.ea-row:hover { background: #f1f5f9; }
.ea-row input { flex: none; margin: 0; accent-color: #0f172a; cursor: pointer; }
.ea-row--dead, .ea-row--dead:hover { color: #94a3b8; font-weight: 500; background: none; cursor: default; }
.ea-swatch { width: 12px; height: 12px; flex: none; border: 1px solid transparent; border-radius: 2px; }
.ea-name { flex: 1; min-width: 0; }
.ea-n { flex: none; font-size: 0.74rem; font-weight: 600; color: #64748b; font-variant-numeric: tabular-nums; }
.ea-src { font-size: 0.7rem; color: #2a78d6; text-decoration: none; overflow-wrap: anywhere; }
.ea-src:hover { text-decoration: underline; }

.ea-tiers { display: grid; gap: 0.15rem; margin-bottom: 0.7rem; }

.ea-filters { display: flex; gap: 0.4rem; margin-bottom: 0.4rem; }
.ea-input, .ea-select { flex: 1; min-width: 0; padding: 0.35rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.82rem; }
.ea-clear { padding: 0.35rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.78rem; cursor: pointer; }
.ea-count { margin: 0 0 0.8rem; font-size: 0.78rem; color: #475569; }

.ea-card { margin-bottom: 0.9rem; padding: 0.7rem 0.8rem; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; }
.ea-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.ea-card-title { margin: 0 0 0.2rem; font-size: 0.92rem; font-weight: 800; color: #0f172a; }
.ea-x { border: 0; background: none; font: inherit; font-size: 1.1rem; line-height: 1; color: #64748b; cursor: pointer; }
.ea-card-text { margin: 0 0 0.35rem; font-size: 0.86rem; color: #334155; }
.ea-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem 0.5rem; margin: 0.2rem 0 0; font-size: 0.76rem; color: #475569; }

.ea-group { margin-top: 1.4rem; }
.ea-h2 { margin: 0 0 0.2rem; font-size: 1rem; font-weight: 800; color: #0f172a; }
.ea-h3 { margin: 1.2rem 0 0.4rem; font-size: 0.92rem; font-weight: 800; color: #0f172a; }
.ea-lead { margin: 0 0 0.6rem; font-size: 0.8rem; line-height: 1.5; color: #475569; }
.ea-plan { border-bottom: 1px solid #f1f5f9; }
.ea-plan-sum { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; padding: 0.35rem 0; font-size: 0.84rem; font-weight: 700; color: #0f172a; cursor: pointer; list-style: none; }
.ea-plan-sum::-webkit-details-marker { display: none; }
.ea-plan-n { font-size: 0.72rem; font-weight: 600; color: #94a3b8; }
.ea-items { list-style: none; margin: 0 0 0.4rem; padding: 0; }
.ea-item-row { display: flex; align-items: baseline; gap: 0.35rem; }
.ea-item-row input { flex: none; margin: 0; accent-color: #0f172a; cursor: pointer; }
.ea-item { display: flex; align-items: baseline; gap: 0.4rem; width: 100%; min-width: 0; padding: 0.25rem 0.4rem; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 0.78rem; text-align: left; color: #334155; cursor: pointer; }
.ea-item:hover { background: #f1f5f9; }
.ea-item--on { background: #e2e8f0; }
.ea-item-text { flex: 1; min-width: 0; }
.ea-item-ref { flex: none; }

.ea-layers { list-style: none; margin: 0; padding: 0; }
.ea-layers li { padding: 0.25rem 0; border-bottom: 1px solid #f8fafc; }
.ea-layer { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; width: 100%; padding: 0.15rem 0.3rem; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 0.8rem; text-align: left; color: #0f172a; cursor: pointer; }
.ea-layer:hover:not(:disabled) { background: #f1f5f9; }
.ea-layer--on { background: #0f172a; color: #fff; }
.ea-layer:disabled { color: #64748b; cursor: default; }
.ea-layer-n { flex: none; font-size: 0.72rem; color: inherit; opacity: 0.7; }
.ea-layer-src { display: block; padding-left: 0.3rem; font-size: 0.68rem; color: #94a3b8; text-decoration: none; }
.ea-layer-src:hover { color: #2a78d6; }

.ea-checks { margin: 0; padding-left: 1rem; display: grid; gap: 0.45rem; }
.ea-checks li { font-size: 0.8rem; line-height: 1.5; color: #334155; }
.ea-note { margin: 0.8rem 0 0; padding: 0.55rem 0.7rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.74rem; color: #475569; }
.ea-link { padding: 0 0.15rem; border: 0; background: none; font: inherit; font-size: 0.78rem; color: #2a78d6; cursor: pointer; }
.ea-link:hover { text-decoration: underline; }

.ea-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.8rem; }
.ea-step { padding-bottom: 0.8rem; border-bottom: 1px solid #f1f5f9; }
.ea-step:last-child { border-bottom: 0; padding-bottom: 0; }
.ea-step-title { display: flex; align-items: baseline; gap: 0.45rem; margin: 0 0 0.2rem; font-size: 0.88rem; font-weight: 700; color: #0f172a; }
.ea-step-n { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; flex: none; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.72rem; }
.ea-step-body { margin: 0; font-size: 0.8rem; line-height: 1.55; color: #334155; }
.ea-step-note { margin: 0.4rem 0 0; padding-left: 0.5rem; border-left: 2px solid #cbd5e1; font-size: 0.76rem; line-height: 1.5; color: #57534e; }
.ea-caveat { margin-bottom: 0.7rem; }
.ea-foot { margin: 1rem 0 0; font-size: 0.72rem; line-height: 1.5; color: #64748b; }

.ea-pill { display: inline-block; padding: 0.05em 0.45em; border-radius: 999px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.ea-source-note { margin: 0.45rem 0 0; font-size: 0.74rem; color: #475569; }
.ea-endpoints { margin: 0.3rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.12rem; }
.ea-endpoints a { font-size: 0.68rem; color: #2a78d6; text-decoration: none; word-break: break-all; }
.ea-endpoints a:hover { text-decoration: underline; }
.ea-pill--precise { background: #dcfce7; color: #15803d; }
.ea-pill--advisory { background: #fef3c7; color: #b45309; }
.ea-pill--base { margin-left: 0.3rem; background: #e0e7ff; color: #4338ca; }
.ea-dim { color: #94a3b8; }
.ea-warn { color: #b45309; }
.ea-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.ea-error { margin: 0 0 1rem; padding: 0.6rem 0.8rem; border-left: 3px solid #dc2626; background: #fef2f2; color: #991b1b; font-size: 0.84rem; }
.ea-over { position: absolute; top: 0.75rem; left: 0.75rem; right: 0.75rem; z-index: 2; }
.ea-status { position: absolute; bottom: 0.75rem; left: 50%; transform: translateX(-50%); margin: 0; padding: 0.25rem 0.7rem; background: rgba(15, 23, 42, 0.8); color: #fff; border-radius: 999px; font-size: 0.75rem; }
.ea-legend { position: absolute; top: 0.75rem; left: 0.75rem; display: flex; flex-direction: column; gap: 0.2rem; padding: 0.45rem 0.6rem; background: rgba(255, 255, 255, 0.92); border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.72rem; color: #475569; }
.ea-legend span { display: flex; align-items: center; gap: 0.35rem; }
.ea-key { width: 12px; height: 12px; flex: none; border: 1px solid transparent; border-radius: 2px; }
.ea-key--precise { background: rgba(21, 128, 61, 0.35); border-color: #15803d; }
.ea-key--advisory { background: rgba(217, 119, 6, 0.12); border: 1px dashed #b45309; }

/* ── the two halves of clause 3.3 ──────────────────────────────────────────── */
.ea-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; margin-bottom: 0.9rem; padding: 0.2rem; background: #f1f5f9; border-radius: 10px; }
.ea-tab { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.4rem 0.5rem; border: 0; border-radius: 8px; background: none; font: inherit; text-align: left; color: #475569; cursor: pointer; }
.ea-tab--on { background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); color: #0f172a; }
.ea-tab-name { font-size: 0.82rem; font-weight: 800; }
.ea-tab-note { font-size: 0.68rem; opacity: 0.75; }

.ea-allrow { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.9rem; font-size: 0.74rem; }
.ea-all { padding: 0.25rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font: inherit; font-size: 0.74rem; color: #334155; cursor: pointer; }
.ea-all:hover { background: #f1f5f9; }

.ea-group--tight { margin-top: 1rem; }
.ea-h2--para { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
.ea-wlist { list-style: none; margin: 0.3rem 0 0; padding: 0; display: grid; gap: 0.5rem; }
.ea-wlist li { padding-bottom: 0.45rem; border-bottom: 1px solid #f1f5f9; }
.ea-wmeta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.45rem; margin: 0.15rem 0 0; padding-left: 0.35rem; font-size: 0.7rem; color: #64748b; }
.ea-wnote { margin: 0.25rem 0 0; padding-left: 0.5rem; border-left: 2px solid #e2e8f0; font-size: 0.7rem; line-height: 1.45; color: #64748b; }
.ea-pill--epi { background: #e0f2fe; color: #075985; }
.ea-pill--download { background: #ede9fe; color: #5b21b6; }
.ea-pill--derived { background: #fae8ff; color: #86198f; }
.ea-pill--gap { background: #fee2e2; color: #991b1b; }
.ea-ok { color: #15803d; }
</style>

<style>
/* the state-wide popup, outside scoped styles because Mapbox mounts it on body */
.ea-pop { display: grid; gap: 0.15rem; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1e293b; }
.ea-pop-item { font-size: 0.78rem; color: #475569; }
.ea-pop-detail { font-size: 0.75rem; color: #64748b; }
.ea-pop-para { font-size: 0.72rem; color: #94a3b8; }

/* Lot search and result, at the top of the panel. */
.ea-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.ea-lot { padding: 0 0 0.75rem; border-bottom: 1px solid #e2e8f0; margin-bottom: 0.75rem; }
.ea-combo { position: relative; }
.ea-input { width: 100%; padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.82rem; }
.ea-listbox { position: absolute; z-index: 20; left: 0; right: 0; margin: 0.15rem 0 0; padding: 0; list-style: none;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; max-height: 15rem; overflow: auto;
  box-shadow: 0 8px 20px rgb(15 23 42 / 0.12); }
.ea-option { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.3rem 0.55rem; cursor: pointer; font-size: 0.78rem; }
.ea-option--on { background: #eff6ff; }
.ea-option-addr { color: #0f172a; }
.ea-option-lot { color: #64748b; font-size: 0.72rem; }
.ea-lot-msg { margin: 0.4rem 0 0; font-size: 0.78rem; color: #64748b; }
.ea-lot-msg--err { color: #b91c1c; }
.ea-lot-head { margin: 0.55rem 0 0.3rem; font-size: 0.84rem; display: flex; justify-content: space-between; gap: 0.5rem; }
.ea-lot-dim { color: #94a3b8; font-size: 0.72rem; }
.ea-lot-verdict { margin: 0 0 0.45rem; padding: 0.35rem 0.55rem; border-radius: 8px; font-size: 0.78rem; border-left: 3px solid; }
.ea-lot-verdict--caught { background: #fef2f2; border-color: #dc2626; color: #991b1b; }
.ea-lot-verdict--clear { background: #f0fdf4; border-color: #16a34a; color: #166534; }
.ea-lot-hits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.ea-lot-hit { padding: 0.3rem 0.5rem; border-radius: 6px; background: #f8fafc; border-left: 3px solid #cbd5e1; font-size: 0.76rem; }
/* context hits are drawn back: they are facts about the lot, not exclusions, and reading one as an
   exclusion is the mistake this page exists to prevent */
.ea-lot-hit--exclusion { border-left-color: #dc2626; }
.ea-lot-hit--context { border-left-color: #94a3b8; opacity: 0.75; }
.ea-lot-hit-item { display: block; color: #0f172a; }
.ea-lot-hit-meta { display: block; color: #64748b; font-size: 0.71rem; }
.ea-lot-hit-names { display: block; color: #475569; font-size: 0.71rem; font-style: italic; }
</style>
