<!--
  One zone's Land Use Table two ways: as the plan writes it, and as it resolves
  against the Standard Instrument's term hierarchy.

  Takes the payload of /api/lep-permissibility?epi=…&zone=… and renders it.
  Used by /permissibility, where a rail picks the zone, and by /report, where
  the lot's own zone and plan pick it. The two hosts are different widths, so
  the layout answers to its container rather than the viewport.

  The table as written is laid out the way the instrument prints it: items 1
  to 4 stacked, the uses in each run together with semicolons.

  The resolved table is one column per status, so the three lists sit beside
  each other the way the raw items sit above. Each column groups its terms by
  how the status was decided, and a term carries its own line only when that
  line says something the group heading does not: which group term it was
  inherited through, or which inherited status an explicit listing overrode.
  The catch-all group, which sweeps up most of a zone's terms and has nothing
  individual to say about any of them, runs together like the raw table.

  The chart is a two-ring sunburst drawn inline. The inner ring splits the
  resolved leaf terms by status; the outer ring splits each status by how it
  was decided. Hovering a segment reads it out; clicking one filters the
  columns. Group terms are not in the chart, because their status is rolled up
  from leaves the chart already counts, so they sit in their own strip.
-->

<template>
  <div class="zp">

    <!-- ── As written ──────────────────────────────────────────────────── -->
    <h3 class="zp-section-head">
      As written in the plan
      <span class="zp-src">Land Use Table · nsw.lep_zones</span>
    </h3>

    <div class="zp-lut">
      <p class="zp-lut-zone">Zone {{ detail.zone.code }}&ensp;{{ detail.zone.name }}</p>

      <section class="zp-lut-item">
        <h4 class="zp-lut-head"><span class="zp-lut-num">1</span>Objectives of zone</h4>
        <ul v-if="detail.objectives.length" class="zp-lut-objectives">
          <li v-for="(o, i) in detail.objectives" :key="i">{{ o }}</li>
        </ul>
        <p v-else class="zp-lut-nil">Nil</p>
      </section>

      <section
        v-for="item in RAW_ITEMS" :key="item.key"
        class="zp-lut-item"
        :style="{ '--accent': COLOR[item.status].base }"
      >
        <h4 class="zp-lut-head">
          <span class="zp-lut-num">{{ item.item }}</span>{{ item.label }}
          <span class="zp-lut-count">{{ detail.raw[item.key].length }}</span>
        </h4>
        <p v-if="detail.raw[item.key].length" class="zp-lut-uses">
          <template v-for="(line, i) in detail.raw[item.key]" :key="i">
            <span class="zp-lut-use" :class="{ 'zp-lut-use--catchall': isCatchAll(line) }">{{ line }}</span><template v-if="i < detail.raw[item.key].length - 1">; </template>
          </template>
        </p>
        <p v-else class="zp-lut-nil">Nil</p>
      </section>
    </div>

    <!-- ── Resolved ────────────────────────────────────────────────────── -->
    <h3 class="zp-section-head">
      Resolved against the Standard Instrument
      <span class="zp-src">
        nsw.lep_permissibility<template v-if="detail.resolved.runId"> · run {{ detail.resolved.runId }}</template>
      </span>
    </h3>

    <p v-if="!leaves.length" class="zp-empty">
      This plan's table has not been resolved, so there is nothing to show here.
    </p>

    <template v-else>
      <!-- Chart band -->
      <div class="zp-chart-card">
        <div class="zp-chart-wrap">
          <svg class="zp-chart" viewBox="0 0 280 280" @mouseleave="hover = null">
            <g v-for="seg in chart.inner" :key="'i' + seg.status">
              <path
                :d="arcPath(seg.a0, seg.a1, RING.innerR0, RING.innerR1)"
                :fill="seg.color"
                class="zp-seg"
                :class="{ 'zp-seg--dim': isDimmed(seg), 'zp-seg--on': isActive(seg) }"
                @mouseenter="hover = seg"
                @click="toggleFilter(seg)"
              />
            </g>
            <g v-for="seg in chart.outer" :key="'o' + seg.status + seg.basis">
              <path
                :d="arcPath(seg.a0, seg.a1, RING.outerR0, RING.outerR1)"
                :fill="seg.color"
                class="zp-seg"
                :class="{ 'zp-seg--dim': isDimmed(seg), 'zp-seg--on': isActive(seg) }"
                @mouseenter="hover = seg"
                @click="toggleFilter(seg)"
              />
            </g>
            <text x="140" y="134" text-anchor="middle" class="zp-chart-n">{{ readout.n }}</text>
            <text x="140" y="154" text-anchor="middle" class="zp-chart-pct">{{ readout.pct }}</text>
          </svg>
          <p class="zp-readout" :style="{ '--accent': readout.color }">
            <span class="zp-readout-dot" />
            {{ readout.label }}
          </p>
        </div>

        <div class="zp-chart-side">
          <div class="zp-legend">
            <div v-for="s in STATUS_ORDER" :key="s" class="zp-legend-row">
              <button
                type="button"
                class="zp-legend-status"
                :class="{ 'zp-legend-status--on': statusFilter === s && basisFilter === 'all' }"
                @click="toggleFilter({ status: s, basis: null })"
              >
                <span class="zp-dot" :style="{ background: COLOR[s].base }" />
                {{ STATUS_LABEL[s] }}
                <span class="zp-legend-n">{{ countBy(s) }}</span>
              </button>
              <div class="zp-legend-bases">
                <button
                  v-for="b in basesFor(s)" :key="b"
                  type="button"
                  class="zp-legend-basis"
                  :class="{ 'zp-legend-basis--on': statusFilter === s && basisFilter === b }"
                  @click="toggleFilter({ status: s, basis: b })"
                >
                  <span class="zp-dot zp-dot--sm" :style="{ background: COLOR[s][b] }" />
                  {{ BASIS_SHORT[b] }}
                  <span class="zp-legend-n">{{ countBy(s, b) }}</span>
                </button>
              </div>
            </div>
          </div>

          <p class="zp-chart-note">
            {{ leaves.length }} leaf terms. Group terms are not counted: their status is
            rolled up from the leaves above, and they are listed under the columns.
            Click a segment or a legend entry to filter the columns.
          </p>
        </div>
      </div>

      <!-- Controls -->
      <div class="zp-controls">
        <input
          v-model="search"
          type="search"
          class="zp-search"
          placeholder="Find a land use — e.g. dwelling, industries, child care"
          @keydown.escape="search = ''"
        >
        <button
          v-if="statusFilter !== 'all' || basisFilter !== 'all' || search"
          type="button" class="zp-clear" @click="clearFilters"
        >Clear</button>
        <p class="zp-result-line">
          <strong>{{ filteredLeaves.length }}</strong> of {{ leaves.length }}
          <template v-if="statusFilter !== 'all'"> · {{ STATUS_LABEL[statusFilter].toLowerCase() }}</template>
          <template v-if="basisFilter !== 'all'"> · {{ BASIS_SHORT[basisFilter].toLowerCase() }}</template>
        </p>
      </div>

      <div v-if="!filteredLeaves.length" class="zp-empty">Nothing matches.</div>

      <!-- One column per status -->
      <div v-else class="zp-columns" :class="{ 'zp-columns--single': groups.length === 1 }">
        <div
          v-for="g in groups" :key="g.status"
          class="zp-col"
          :style="{ '--accent': COLOR[g.status].base, '--tint': COLOR[g.status].tint }"
        >
          <h4 class="zp-col-head">
            <span class="zp-dot" :style="{ background: COLOR[g.status].base }" />
            {{ STATUS_LABEL[g.status] }}
            <span class="zp-col-count">{{ g.items.length }}</span>
          </h4>

          <div v-for="bg in g.bases" :key="bg.basis" class="zp-basis-group">
            <!-- The catch-all sweeps up most of a zone's terms and has nothing
                 individual to say about any of them, so they run together the
                 way the plan lists uses, and stay folded until asked for. -->
            <details v-if="bg.basis === 'catchall'" class="zp-catchall" :open="catchallOpen" @toggle="catchallOpen = ($event.target as HTMLDetailsElement).open">
              <summary class="zp-basis-head zp-basis-head--toggle" :title="basisTitle(bg.items[0]!)">
                <span class="zp-dot zp-dot--sm" :style="{ background: COLOR[g.status][bg.basis] }" />
                {{ BASIS_LABEL[bg.basis] }}
                <span class="zp-col-count">{{ bg.items.length }}</span>
                <span class="zp-toggle-hint">{{ catchallOpen ? 'hide' : 'show' }}</span>
              </summary>
              <p class="zp-uses-inline">
                <template v-for="(l, i) in bg.items" :key="l.use">
                  <span class="zp-use-inline">{{ l.use }}</span><template v-if="i < bg.items.length - 1">; </template>
                </template>
              </p>
            </details>
            <h5 v-else class="zp-basis-head">
              <span class="zp-dot zp-dot--sm" :style="{ background: COLOR[g.status][bg.basis] }" />
              {{ BASIS_LABEL[bg.basis] }}
              <span class="zp-col-count">{{ bg.items.length }}</span>
            </h5>
            <ul v-if="bg.basis !== 'catchall'" class="zp-uses">
              <li v-for="l in bg.items" :key="l.use" class="zp-use">
                <span class="zp-use-name">
                  {{ l.use }}
                  <span v-if="l.resolvedAgainst" class="zp-override">overrides inherited</span>
                </span>
                <span v-if="whyLine(l)" class="zp-use-why">{{ whyLine(l) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Group terms -->
      <div v-if="parents.length" class="zp-parents">
        <h4 class="zp-parents-head">
          Group terms
          <span class="zp-src">status rolled up from their children · {{ parents.length }}</span>
        </h4>
        <div class="zp-parent-chips">
          <button
            v-for="p in parents" :key="p.use"
            type="button"
            class="zp-parent"
            :class="{ 'zp-parent--on': search.trim().toLowerCase() === p.use }"
            :style="{ '--accent': COLOR[p.status].base, '--tint': COLOR[p.status].tint }"
            :title="`${STATUS_LABEL[p.status]} — click to find leaves under it`"
            @click="findUnder(p.use)"
          >
            <span class="zp-dot zp-dot--sm" :style="{ background: COLOR[p.status].base }" />
            {{ p.use }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Basis, ResolvedLeaf, ResolvedParent, Status, ZoneDetail } from '#shared/lep-permissibility'
import { STATUS_LABEL, BASIS_LABEL } from '#shared/lep-permissibility'

const props = defineProps<{ detail: ZoneDetail }>()

// ── Vocabulary ──────────────────────────────────────────────────────────

type LeafStatus = Exclude<Status, 'mixed'>

const STATUS_ORDER: LeafStatus[] = ['permitted_without_consent', 'permitted_with_consent', 'prohibited']
const BASIS_ORDER: Basis[] = ['explicit', 'inherited', 'verbatim', 'catchall']

const BASIS_SHORT: Record<Basis, string> = {
  explicit: 'Listed',
  inherited: 'Inherited',
  catchall: 'Catch-all',
  verbatim: 'Verbatim',
  rolled_up: 'Rolled up',
}

/**
 * One hue per status, shaded by basis: darkest for a term the plan names
 * itself, lighter for one it reaches through a group term, lightest for one the
 * catch-all line sweeps up. `tint` is the wash behind headings and chips.
 */
const COLOR: Record<Status, { base: string, tint: string } & Partial<Record<Basis, string>>> = {
  permitted_without_consent: {
    base: '#0f766e', tint: '#f0fdfa',
    explicit: '#0f766e', inherited: '#2dd4bf', verbatim: '#99f6e4', catchall: '#ccfbf1',
  },
  permitted_with_consent: {
    base: '#15803d', tint: '#f0fdf4',
    explicit: '#15803d', inherited: '#4ade80', verbatim: '#86efac', catchall: '#bbf7d0',
  },
  prohibited: {
    base: '#b91c1c', tint: '#fef2f2',
    explicit: '#b91c1c', inherited: '#ef4444', verbatim: '#f87171', catchall: '#fca5a5',
  },
  mixed: { base: '#b45309', tint: '#fffbeb' },
}

/** Items 2 to 4 of the Land Use Table, in the order the instrument prints them. */
const RAW_ITEMS = [
  { key: 'withoutConsent', item: '2', label: 'Permitted without consent', status: 'permitted_without_consent' },
  { key: 'withConsent', item: '3', label: 'Permitted with consent', status: 'permitted_with_consent' },
  { key: 'prohibited', item: '4', label: 'Prohibited', status: 'prohibited' },
] as const

// ── State ───────────────────────────────────────────────────────────────

const search = ref('')
const statusFilter = ref<LeafStatus | 'all'>('all')
const basisFilter = ref<Basis | 'all'>('all')

interface Seg { status: LeafStatus, basis: Basis | null, n?: number, a0?: number, a1?: number, color?: string }
const hover = ref<Seg | null>(null)

/**
 * Folded by default: it is the bulk of every zone and says nothing a reader
 * would scan for. It unfolds itself when a search or the catch-all filter
 * would otherwise be hiding its matches, and can be folded back by hand.
 */
const catchallOpen = ref(false)
watch([search, basisFilter], ([q, b]) => {
  if (q.trim() || b === 'catchall') catchallOpen.value = true
})

/** A new zone starts unfiltered; a filter from the last one would silently hide terms. */
watch(() => props.detail, () => { clearFilters(); catchallOpen.value = false })

// ── Derived ─────────────────────────────────────────────────────────────

const leaves = computed<ResolvedLeaf[]>(() => props.detail.resolved.leaves)
const parents = computed<ResolvedParent[]>(() => props.detail.resolved.parents)

function countBy(status: Status, basis?: Basis): number {
  return leaves.value.filter(l => l.status === status && (!basis || l.basis === basis)).length
}

function basesFor(status: Status): Basis[] {
  return BASIS_ORDER.filter(b => countBy(status, b) > 0)
}

const filteredLeaves = computed(() => {
  const q = search.value.trim().toLowerCase()
  return leaves.value.filter(l =>
    (statusFilter.value === 'all' || l.status === statusFilter.value)
    && (basisFilter.value === 'all' || l.basis === basisFilter.value)
    && (!q || l.use.includes(q) || provenance(l).toLowerCase().includes(q)),
  )
})

/** One column per status, each grouped by basis, empty groups dropped. */
const groups = computed(() =>
  STATUS_ORDER
    .map((status) => {
      const items = filteredLeaves.value.filter(l => l.status === status)
      const bases = BASIS_ORDER
        .map(basis => ({ basis, items: items.filter(l => l.basis === basis) }))
        .filter(b => b.items.length)
      return { status, items, bases }
    })
    .filter(g => g.items.length),
)

/** The full sentence, used for searching. */
function provenance(l: ResolvedLeaf): string {
  switch (l.basis) {
    case 'explicit': {
      let s = l.sourceText ? `Listed as “${l.sourceText}”` : 'Listed in the table'
      if (l.resolvedAgainst) {
        s += `; overrides “${STATUS_LABEL[l.resolvedAgainst.status].toLowerCase()}” inherited via ${l.resolvedAgainst.chain}`
      }
      return s
    }
    case 'inherited': {
      const from = l.sourceText ?? l.derivedFrom ?? 'a group term'
      const via = l.derivedFrom && l.derivedFrom.includes('>') ? ` via ${l.derivedFrom}` : ''
      return `Inherited from “${from}”${via}`
    }
    case 'catchall':
      return `Caught by “${l.derivedFrom ?? 'any other development not specified'}”`
    case 'verbatim':
      return 'As written; not a Standard Instrument term'
    default:
      return ''
  }
}

/**
 * What to print under a term, if anything. The basis heading already says
 * "listed", "inherited" or "caught", so a term gets a line only for what is
 * particular to it: the group term it came through, or the status it beat.
 */
function whyLine(l: ResolvedLeaf): string {
  if (l.basis === 'inherited') {
    const from = l.sourceText ?? l.derivedFrom ?? 'a group term'
    const via = l.derivedFrom && l.derivedFrom.includes('>') ? ` via ${l.derivedFrom}` : ''
    return `from “${from}”${via}`
  }
  if (l.basis === 'explicit' && l.resolvedAgainst) {
    return `overrides “${STATUS_LABEL[l.resolvedAgainst.status].toLowerCase()}” inherited via ${l.resolvedAgainst.chain}`
  }
  return ''
}

/** The catch-all heading's tooltip carries the line as the plan words it. */
function basisTitle(l: ResolvedLeaf): string {
  return l.basis === 'catchall' && l.derivedFrom ? `“${l.derivedFrom}”` : ''
}

function isCatchAll(line: string): boolean {
  return /^any (other )?development/i.test(line)
}

// ── Chart ───────────────────────────────────────────────────────────────

const TAU = Math.PI * 2
const RING = { cx: 140, cy: 140, innerR0: 60, innerR1: 94, outerR0: 98, outerR1: 132 }

interface ChartSeg extends Seg { n: number, a0: number, a1: number, color: string }

const chart = computed(() => {
  const total = leaves.value.length
  const inner: ChartSeg[] = []
  const outer: ChartSeg[] = []
  if (!total) return { total, inner, outer }
  let a = 0
  for (const status of STATUS_ORDER) {
    const inStatus = leaves.value.filter(l => l.status === status)
    if (!inStatus.length) continue
    const a0 = a
    for (const basis of BASIS_ORDER) {
      const n = inStatus.filter(l => l.basis === basis).length
      if (!n) continue
      const a1 = a + (n / total) * TAU
      outer.push({ status, basis, n, a0: a, a1, color: COLOR[status][basis] ?? COLOR[status].base })
      a = a1
    }
    inner.push({ status, basis: null, n: inStatus.length, a0, a1: a, color: COLOR[status].base })
  }
  return { total, inner, outer }
})

/** An annular sector from angle a0 to a1, clockwise from twelve o'clock. */
function arcPath(a0: number, a1: number, r0: number, r1: number): string {
  // A full circle has coincident endpoints and draws nothing; stop just short.
  const end = Math.min(a1, a0 + TAU - 1e-4)
  const pt = (r: number, a: number) => `${(RING.cx + r * Math.sin(a)).toFixed(2)} ${(RING.cy - r * Math.cos(a)).toFixed(2)}`
  const large = end - a0 > Math.PI ? 1 : 0
  return `M${pt(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${pt(r1, end)} L${pt(r0, end)} A${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z`
}

const activeSeg = computed<Seg | null>(() => {
  if (hover.value) return hover.value
  if (statusFilter.value === 'all') return null
  return { status: statusFilter.value, basis: basisFilter.value === 'all' ? null : basisFilter.value }
})

const readout = computed(() => {
  const total = chart.value.total
  const seg = activeSeg.value
  if (!seg) {
    return { n: total, pct: 'leaf terms', label: 'All resolved land uses', color: '#64748b' }
  }
  const n = countBy(seg.status, seg.basis ?? undefined)
  const label = seg.basis
    ? `${STATUS_LABEL[seg.status]} · ${BASIS_SHORT[seg.basis].toLowerCase()}`
    : STATUS_LABEL[seg.status]
  const color = seg.basis ? (COLOR[seg.status][seg.basis] ?? COLOR[seg.status].base) : COLOR[seg.status].base
  return { n, pct: total ? `${Math.round((n / total) * 100)}%` : '', label, color }
})

function isActive(seg: Seg): boolean {
  const a = activeSeg.value
  if (!a) return false
  return a.status === seg.status && (a.basis === null || a.basis === seg.basis)
}

function isDimmed(seg: Seg): boolean {
  return activeSeg.value !== null && !isActive(seg)
}

function toggleFilter(seg: Seg) {
  const already = statusFilter.value === seg.status && basisFilter.value === (seg.basis ?? 'all')
  if (already) {
    statusFilter.value = 'all'
    basisFilter.value = 'all'
  } else {
    statusFilter.value = seg.status
    basisFilter.value = seg.basis ?? 'all'
  }
}

function clearFilters() {
  statusFilter.value = 'all'
  basisFilter.value = 'all'
  search.value = ''
}

/** Clicking a group term shows the leaves that inherited through it. */
function findUnder(term: string) {
  const q = term.toLowerCase()
  if (search.value.trim().toLowerCase() === q) { search.value = ''; return }
  statusFilter.value = 'all'
  basisFilter.value = 'all'
  search.value = q
}
</script>

<style scoped>
/* The view sizes itself to whatever holds it: a 1000px page column or a 750px
   report body. Every breakpoint below is a container query for that reason. */
.zp {
  container-type: inline-size;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.zp-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
.zp-dot--sm { width: 8px; height: 8px; border-radius: 2px; }

/* ── Section heads ──────────────────────────────────────────────────────── */
.zp-section-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-size: 0.82rem;
  font-weight: 700;
  color: #0f172a;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 1.5rem 0 0.75rem;
}
.zp-section-head:first-child { margin-top: 0.25rem; }
.zp-src {
  font-size: 0.7rem;
  font-weight: 500;
  color: #94a3b8;
  text-transform: none;
  letter-spacing: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* ── As written: the table the way the instrument prints it ─────────────── */
.zp-lut {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.1rem 1.4rem 1.2rem;
}
.zp-lut-zone {
  margin: 0 0 0.9rem;
  font-size: 0.95rem;
  font-weight: 800;
  color: #0f172a;
}
.zp-lut-item { --accent: #475569; }
.zp-lut-item + .zp-lut-item { margin-top: 0.9rem; }
.zp-lut-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 0.3rem;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--accent);
}
.zp-lut-num {
  font-weight: 800;
  color: var(--accent);
  min-width: 0.9rem;
}
.zp-lut-count {
  font-size: 0.7rem;
  font-weight: 600;
  color: #94a3b8;
}
.zp-lut-objectives {
  margin: 0;
  padding-left: 2.3rem;
  font-size: 0.84rem;
  line-height: 1.55;
  color: #1e293b;
}
.zp-lut-uses {
  margin: 0;
  padding-left: 1.4rem;
  font-size: 0.84rem;
  line-height: 1.65;
  color: #1e293b;
}
.zp-lut-use--catchall { font-style: italic; color: #64748b; }
.zp-lut-nil {
  margin: 0;
  padding-left: 1.4rem;
  font-size: 0.82rem;
  color: #94a3b8;
  font-style: italic;
}

/* ── Resolved: chart band ───────────────────────────────────────────────── */
.zp-chart-card {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 1.5rem;
  align-items: center;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
}
@container (max-width: 560px) {
  .zp-chart-card { grid-template-columns: 1fr; }
}
.zp-chart-wrap { display: flex; flex-direction: column; align-items: center; }
.zp-chart {
  display: block;
  width: 100%;
  max-width: 230px;
  height: auto;
}
.zp-seg {
  stroke: #fff;
  stroke-width: 1.5;
  cursor: pointer;
  transition: opacity 0.12s;
}
.zp-seg--dim { opacity: 0.28; }
.zp-seg--on { stroke: #0f172a; stroke-width: 1.5; }
.zp-chart-n {
  font-size: 30px;
  font-weight: 800;
  fill: #0f172a;
  pointer-events: none;
}
.zp-chart-pct {
  font-size: 11px;
  font-weight: 600;
  fill: #64748b;
  pointer-events: none;
}
.zp-readout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin: 0.4rem 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: #0f172a;
  min-height: 1.2rem;
  text-align: center;
}
.zp-readout-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--accent);
  flex-shrink: 0;
}

.zp-chart-side { min-width: 0; }

/* Three statuses side by side, in the same order as the columns beneath, so
   each legend block sits over the column it describes; stacked when narrow. */
.zp-legend {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
@container (max-width: 1000px) {
  .zp-legend { grid-template-columns: 1fr; gap: 0.4rem; }
}
.zp-legend-row { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.zp-legend-status,
.zp-legend-basis {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.45rem;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: #1e293b;
}
.zp-legend-status { font-size: 0.78rem; font-weight: 700; }
.zp-legend-basis { font-size: 0.72rem; color: #475569; }
.zp-legend-status:hover,
.zp-legend-basis:hover { background: #f8fafb; }
.zp-legend-status--on,
.zp-legend-basis--on { border-color: #0f172a; background: #f8fafb; }
.zp-legend-bases { display: flex; flex-wrap: wrap; gap: 0.15rem; padding-left: 0.9rem; }
.zp-legend-n { font-size: 0.68rem; font-weight: 600; color: #94a3b8; }

.zp-chart-note {
  margin: 0.9rem 0 0;
  font-size: 0.7rem;
  color: #94a3b8;
  line-height: 1.4;
}

/* ── Resolved: controls ─────────────────────────────────────────────────── */
.zp-controls {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.zp-search {
  flex: 1;
  min-width: 200px;
  padding: 0.45rem 0.75rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font: inherit;
  font-size: 0.82rem;
  color: #1e293b;
}
.zp-search:focus {
  outline: none;
  border-color: #15803d;
  box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.1);
}
.zp-clear {
  flex-shrink: 0;
  padding: 0.4rem 0.7rem;
  background: #0f172a;
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
}
.zp-result-line {
  font-size: 0.74rem;
  color: #94a3b8;
  margin: 0;
  white-space: nowrap;
}
.zp-result-line strong { color: #475569; }

.zp-empty {
  padding: 1.5rem;
  text-align: center;
  font-size: 0.82rem;
  color: #64748b;
  border: 1px dashed #e2e8f0;
  border-radius: 10px;
}

/* ── Resolved: one column per status ────────────────────────────────────── */
.zp-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: start;
}
.zp-columns--single { grid-template-columns: 1fr; }
@container (max-width: 640px) {
  .zp-columns { grid-template-columns: 1fr; }
}

.zp-col {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-top: 3px solid var(--accent);
  border-radius: 12px;
  padding: 0.75rem 0.9rem 0.9rem;
  min-width: 0;
}
.zp-col-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.6rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.zp-col-count {
  font-size: 0.68rem;
  font-weight: 600;
  color: #94a3b8;
  margin-left: auto;
}

.zp-basis-group + .zp-basis-group { margin-top: 0.8rem; }
.zp-basis-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.25rem;
  padding: 0.3rem 0.5rem;
  background: var(--tint);
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #475569;
}

.zp-basis-head--toggle {
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.zp-basis-head--toggle::-webkit-details-marker { display: none; }
.zp-basis-head--toggle:hover { filter: brightness(0.97); }
.zp-toggle-hint {
  font-size: 0.64rem;
  font-weight: 600;
  color: #94a3b8;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.zp-uses { list-style: none; margin: 0; padding: 0; }
.zp-uses-inline {
  margin: 0;
  padding: 0.25rem 0.4rem 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: #1e293b;
}
/* A single filtered column would run long; let its list flow across the width. */
.zp-columns--single .zp-uses {
  column-count: 3;
  column-gap: 1.25rem;
}
@container (max-width: 640px) {
  .zp-columns--single .zp-uses { column-count: 1; }
}
.zp-use {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  padding: 0.28rem 0.4rem;
  border-bottom: 1px solid #f1f5f9;
  break-inside: avoid;
}
.zp-uses li:last-child { border-bottom: none; }
.zp-use-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: #0f172a;
  line-height: 1.3;
}
.zp-use-why { font-size: 0.7rem; color: #64748b; line-height: 1.35; }

.zp-override {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: #fff7ed;
  color: #c2410c;
}

/* ── Group terms ────────────────────────────────────────────────────────── */
.zp-parents {
  margin-top: 1rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem;
}
.zp-parents-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin: 0 0 0.6rem;
  font-size: 0.74rem;
  font-weight: 700;
  color: #0f172a;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.zp-parent-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.zp-parent {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  background: var(--tint);
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  font-size: 0.74rem;
  color: #1e293b;
  cursor: pointer;
}
.zp-parent:hover { border-color: var(--accent); }
.zp-parent--on { border-color: #0f172a; }
</style>
