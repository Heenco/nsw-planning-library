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

    <!-- ── How the table is read ───────────────────────────────────────────
         The written table is not the answer: a group term stands for every
         use under it, and one line disposes of everything the table never
         names. This folds the method away under the table, with the zone's
         own lines as the worked example, so a reader who wants to know why a
         use landed where it did can find out without leaving the page. -->
    <details class="zp-how" @toggle="howOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="zp-how-summary">
        How this table becomes the resolved list below
        <span class="zp-how-hint">{{ howOpen ? 'hide' : 'show' }}</span>
      </summary>

      <div class="zp-how-body">
        <p class="zp-how-lead">
          The four items are read together, and two things make the written lists incomplete:
          a group term stands for every use under it, and one line in item {{ clause?.item ?? '3 or 4' }}
          disposes of every use the table never names. The resolver reads the table in three steps.
        </p>

        <!-- The diagram: what happens between the written table and the resolved list. -->
        <ol class="zp-flow" aria-label="From the written table to the resolved list">
          <li class="zp-flow-node zp-flow-node--end">
            <span class="zp-flow-kicker">Written</span>
            <span class="zp-flow-title">Items 2, 3 and 4</span>
            <span class="zp-flow-text">{{ rawCount }} lines, as the plan prints them.</span>
          </li>
          <li class="zp-flow-node">
            <span class="zp-flow-kicker">Step 1</span>
            <span class="zp-flow-title">Expand group terms</span>
            <span class="zp-flow-text">Each listed term is replaced by the leaf uses it stands for in the Standard Instrument dictionary. A leaf reached this way is <em>inherited</em>.</span>
          </li>
          <li class="zp-flow-node">
            <span class="zp-flow-kicker">Step 2</span>
            <span class="zp-flow-title">Apply the catch-all</span>
            <span class="zp-flow-text">Every leaf still unnamed takes the status of the item the line sits in. Only now: applied first, it would subtract unexpanded group terms and leak their members.</span>
          </li>
          <li class="zp-flow-node">
            <span class="zp-flow-kicker">Step 3</span>
            <span class="zp-flow-title">Settle conflicts</span>
            <span class="zp-flow-text"><em>Listed</em> beats <em>inherited</em> beats <em>catch-all</em>. Between two group terms the nearer one wins; on a tie, prohibited wins.</span>
          </li>
          <li class="zp-flow-node zp-flow-node--end">
            <span class="zp-flow-kicker">Resolved</span>
            <span class="zp-flow-title">{{ leaves.length }} leaf terms</span>
            <span class="zp-flow-text">Each with a status and the basis that decided it, and {{ parents.length }} group terms rolled up on top.</span>
          </li>
        </ol>

        <!-- Which way the catch-all cuts: the one line that makes a zone open or closed. -->
        <div class="zp-cut">
          <div
            class="zp-cut-card"
            :class="{ 'zp-cut-card--this': clause?.open, 'zp-cut-card--dim': clause && !clause.open }"
            :style="{ '--accent': COLOR.permitted_with_consent.base, '--tint': COLOR.permitted_with_consent.tint }"
          >
            <span class="zp-cut-head">
              <span class="zp-dot zp-dot--sm" :style="{ background: COLOR.permitted_with_consent.base }" />
              Open zone
              <span v-if="clause?.open" class="zp-cut-this">this zone</span>
            </span>
            <span class="zp-cut-clause">“Any other development not specified in item 2 or 4” sits in item 3</span>
            <span class="zp-cut-text">Everything the table does not prohibit is <strong>permitted with consent</strong>. Item 4 is the whole answer.</span>
          </div>
          <div
            class="zp-cut-card"
            :class="{ 'zp-cut-card--this': clause && !clause.open, 'zp-cut-card--dim': clause?.open }"
            :style="{ '--accent': COLOR.prohibited.base, '--tint': COLOR.prohibited.tint }"
          >
            <span class="zp-cut-head">
              <span class="zp-dot zp-dot--sm" :style="{ background: COLOR.prohibited.base }" />
              Closed zone
              <span v-if="clause && !clause.open" class="zp-cut-this">this zone</span>
            </span>
            <span class="zp-cut-clause">“Any development not specified in item 2 or 3” sits in item 4</span>
            <span class="zp-cut-text">Everything the table does not permit is <strong>prohibited</strong>. Items 2 and 3 are the whole answer.</span>
          </div>
        </div>
        <p v-if="clause" class="zp-how-zone">
          Here the line reads <em>“{{ clause.text }}”</em> and sits in item {{ clause.item }}, so the
          {{ clause.n }} uses this table never names are {{ STATUS_LABEL[clause.status].toLowerCase() }}.
        </p>
        <p v-else class="zp-how-zone">
          This table has no such line, so a use it never names is left unresolved rather than guessed at.
        </p>

        <!-- Worked from this zone's own lines. -->
        <ul v-if="examples.length" class="zp-how-examples">
          <li
            v-for="ex in examples" :key="ex.use"
            class="zp-how-example"
            :style="{ '--accent': COLOR[ex.status].base }"
          >
            <span class="zp-how-example-use">
              <span class="zp-dot zp-dot--sm" :style="{ background: COLOR[ex.status].base }" />
              {{ ex.use }}
            </span>
            <span class="zp-how-example-text">{{ ex.text }}</span>
          </li>
        </ul>

        <p class="zp-how-foot">
          A group term carries two answers. What the plan says about the term itself is read first; only when
          the plan never names it do its members decide, and a group term whose members disagree is
          <em>mixed</em> and is never listed as a whole: its permitted members are listed on their own.
          Clause 2.3(3) of the plan is the rule behind all of this: a listed term means development for that
          purpose, and it does not include a type the same table lists separately.
        </p>
      </div>
    </details>

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

      <!-- Group terms. Each carries two answers: what the plan says about the
           term itself, when it names it, and what its members add up to. The
           chip shows the plan's own answer first; the roll-up only when the
           plan never names the term, or as a hint when the two disagree. -->
      <div v-if="parents.length" class="zp-parents">
        <h4 class="zp-parents-head">
          Group terms
          <span class="zp-src">as the plan names them, or rolled up from their members · {{ parents.length }}</span>
        </h4>
        <div class="zp-parent-chips">
          <button
            v-for="p in parents" :key="p.use"
            type="button"
            class="zp-parent"
            :class="{ 'zp-parent--on': search.trim().toLowerCase() === p.use }"
            :style="{ '--accent': COLOR[parentStatus(p)].base, '--tint': COLOR[parentStatus(p)].tint }"
            :title="parentTitle(p)"
            @click="findUnder(p.use)"
          >
            <span class="zp-dot zp-dot--sm" :style="{ background: COLOR[parentStatus(p)].base }" />
            {{ p.use }}
            <span v-if="p.members.length" class="zp-parent-hint">{{ memberSummary(p) }}</span>
            <span v-else-if="p.namedStatus && p.namedStatus !== p.status" class="zp-parent-hint">members {{ MEMBERS_SHORT[p.status] }}</span>
            <span v-if="listingChange(p) === 'added'" class="zp-parent-change zp-parent-change--added">now listed</span>
            <span v-else-if="listingChange(p) === 'removed'" class="zp-parent-change zp-parent-change--removed">no longer listed</span>
          </button>
        </div>
        <p v-if="listingChanges.length" class="zp-parents-note">
          A lot's permitted list used to include a group term only when every member was permitted.
          It now follows what the plan says about the term itself, so
          <template v-for="(c, i) in listingChanges" :key="c.use">{{ i ? (i === listingChanges.length - 1 ? ' and ' : ', ') : '' }}<strong>{{ c.use }}</strong> is {{ c.change === 'added' ? 'added to' : 'removed from' }} it</template>.
        </p>
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

/** How a group term's members add up, for the hint on its chip. */
const MEMBERS_SHORT: Record<Status, string> = {
  permitted_without_consent: 'all permitted',
  permitted_with_consent: 'all permitted',
  prohibited: 'all prohibited',
  mixed: 'mixed',
}

/** The plan's own word on a group term when it has one, else its members' roll-up. */
function parentStatus(p: ResolvedParent): Status {
  return p.namedStatus ?? p.status
}

/** "1 of 2 members permitted", from the hierarchy the resolver used. */
function memberSummary(p: ResolvedParent): string {
  const permitted = p.members.filter(m => m.status === 'permitted_with_consent' || m.status === 'permitted_without_consent').length
  const n = p.members.length
  if (permitted === n) return `all ${n} members permitted`
  if (permitted === 0) return `all ${n} members prohibited`
  return `${permitted} of ${n} members permitted`
}

function parentTitle(p: ResolvedParent): string {
  const tail = ' — click to find the terms under it'
  const list = p.members.length
    ? `\nStands for: ${p.members.map(m => `${m.use} (${m.status ? STATUS_LABEL[m.status].toLowerCase() : 'not resolved'})`).join('; ')}`
    : ''
  if (p.namedStatus) {
    const line = p.namedSourceText ? ` as “${p.namedSourceText}”` : ''
    const members = p.namedStatus === p.status ? '' : `; its members are ${MEMBERS_SHORT[p.status]}`
    return `${STATUS_LABEL[p.namedStatus]}: the plan names it${line}${members}${tail}${list}`
  }
  return `${STATUS_LABEL[p.status]}: the plan never names it; rolled up from its members${tail}${list}`
}

/**
 * Called by the report when a chip in its Permitted Uses is clicked: show
 * this term in the columns. A group term filters to its members; a leaf
 * searches for itself. Either way the filters are reset first.
 */
function focus(term: string) {
  const t = term.toLowerCase()
  statusFilter.value = 'all'
  basisFilter.value = 'all'
  search.value = t
  catchallOpen.value = true
}
defineExpose({ focus, hasTerm: (term: string) => leaves.value.some(l => l.use === term.toLowerCase()) || parents.value.some(p => p.use === term.toLowerCase()) })

/**
 * Whether the corrected list rule changes this term's place in a lot's
 * permitted list: added when the plan names it permitted but its members
 * are not all permitted, removed when the plan names it prohibited but its
 * members happen to be. The API's permissibleList carries the same answer.
 */
function listingChange(p: ResolvedParent): 'added' | 'removed' | null {
  const permitted = (s: Status | null) => s === 'permitted_with_consent' || s === 'permitted_without_consent'
  if (!p.namedStatus) return null
  if (permitted(p.namedStatus) && !permitted(p.status)) return 'added'
  if (p.namedStatus === 'prohibited' && permitted(p.status)) return 'removed'
  return null
}

const listingChanges = computed(() =>
  parents.value
    .map(p => ({ use: p.use, change: listingChange(p) }))
    .filter((c): c is { use: string, change: 'added' | 'removed' } => c.change !== null),
)

/** Clicking a group term shows the leaves that inherited through it. */
function findUnder(term: string) {
  const q = term.toLowerCase()
  if (search.value.trim().toLowerCase() === q) { search.value = ''; return }
  statusFilter.value = 'all'
  basisFilter.value = 'all'
  search.value = q
}

// ── How the table is read ───────────────────────────────────────────────

/** Folded by default; the hint on the summary follows the element's own state. */
const howOpen = ref(false)

/** Lines in items 2 to 4 as written, for the diagram's first node. */
const rawCount = computed(() =>
  props.detail.raw.withoutConsent.length + props.detail.raw.withConsent.length + props.detail.raw.prohibited.length,
)

/**
 * This zone's residual clause, read off the leaves it caught: what it says,
 * which item it sits in, and so which way it cuts. Null when the table has
 * no such line, in which case unnamed uses are simply not resolved.
 */
const clause = computed(() => {
  const caught = leaves.value.filter(l => l.basis === 'catchall')
  const first = caught[0]
  if (!first) return null
  const status = first.status as LeafStatus
  const item = status === 'prohibited' ? '4' : status === 'permitted_with_consent' ? '3' : '2'
  return {
    text: first.derivedFrom ?? 'any other development not specified',
    status,
    item,
    n: caught.length,
    open: status !== 'prohibited',
  }
})

interface HowExample { use: string, status: Status, text: string }

/**
 * One line of this zone's own table for each step of the method, so the
 * explanation is about the zone on screen and not a zone in general. Each is
 * skipped when the zone has nothing of that kind. The waste terms are
 * preferred where they exist because that group is the clearest case of
 * "some members prohibited, one not" in most plans.
 */
const examples = computed<HowExample[]>(() => {
  const out: HowExample[] = []
  const lower = (s: Status) => STATUS_LABEL[s].toLowerCase()
  const ls = leaves.value
  const ps = parents.value

  // A listing that beat what it inherited: the specific term over the general one.
  const over = ls.find(l => l.basis === 'explicit' && l.resolvedAgainst)
  if (over && over.resolvedAgainst) {
    out.push({
      use: over.use, status: over.status,
      text: `listed as “${over.sourceText ?? over.use}”, so it is ${lower(over.status)} even though it inherits `
        + `${lower(over.resolvedAgainst.status)} through ${over.resolvedAgainst.chain}. The specific listing wins.`,
    })
  }

  // A leaf the plan never names, reached through a group term it does.
  const inh = ls.find(l => l.basis === 'inherited' && l.use === 'dwelling houses') ?? ls.find(l => l.basis === 'inherited')
  if (inh) {
    const via = inh.derivedFrom && inh.derivedFrom.includes('>') ? ` via ${inh.derivedFrom}` : ''
    out.push({
      use: inh.use, status: inh.status,
      text: `never named, but “${inh.sourceText ?? inh.derivedFrom ?? 'a group term'}” is listed and stands for it${via}, `
        + `so it is ${lower(inh.status)}.`,
    })
  }

  // A leaf nobody names at all, above or below: the catch-all decides.
  const caught = ls.find(l => l.basis === 'catchall' && l.use === 'waste or resource transfer stations')
    ?? ls.find(l => l.basis === 'catchall')
  if (caught) {
    out.push({
      use: caught.use, status: caught.status,
      text: `named nowhere, and no group term above it is either, so the catch-all line decides: ${lower(caught.status)}.`,
    })
  }

  // A group term the plan never names whose members disagree.
  const mixed = ps.find(p => p.use === 'waste or resource management facilities' && p.status === 'mixed' && !p.namedStatus)
    ?? ps.find(p => p.status === 'mixed' && !p.namedStatus)
  if (mixed) {
    const members = mixed.members.length ? memberSummary(mixed) : 'its members disagree'
    out.push({
      use: mixed.use, status: 'mixed',
      text: `a group term the plan never names: ${members}, so it is mixed and is not listed as a whole. `
        + `The members that are permitted are listed on their own.`,
    })
  }

  // A group term where the plan's own word and its members disagree. The
  // sharpest case first: prohibited by name while every member is permitted.
  const permitted = (s: Status | null) => s === 'permitted_with_consent' || s === 'permitted_without_consent'
  const named = ps.find(p => p.namedStatus === 'prohibited' && permitted(p.status))
    ?? ps.find(p => permitted(p.namedStatus) && !permitted(p.status))
    ?? ps.find(p => p.namedStatus && p.namedStatus !== p.status)
  if (named && named.namedStatus) {
    out.push({
      use: named.use, status: named.namedStatus,
      text: `listed as “${named.namedSourceText ?? named.use}”, so it is ${lower(named.namedStatus)} even though its `
        + `members are ${MEMBERS_SHORT[named.status]}. The plan's own word on a group term is read first.`,
    })
  }

  return out
})
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

/* ── How the table is read ──────────────────────────────────────────────── */
.zp-how {
  margin-top: 0.6rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}
.zp-how-summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 1rem;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font-size: 0.78rem;
  font-weight: 700;
  color: #0f172a;
}
.zp-how-summary::-webkit-details-marker { display: none; }
.zp-how-summary::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 5px solid #94a3b8;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.12s;
}
.zp-how[open] > .zp-how-summary::before { transform: rotate(90deg); }
.zp-how-summary:hover { background: #f8fafb; border-radius: 12px; }
.zp-how-hint {
  margin-left: auto;
  font-size: 0.64rem;
  font-weight: 600;
  color: #94a3b8;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.zp-how-body { padding: 0 1rem 1rem; border-top: 1px solid #f1f5f9; }
.zp-how-lead,
.zp-how-zone,
.zp-how-foot {
  margin: 0.85rem 0 0;
  font-size: 0.8rem;
  line-height: 1.55;
  color: #334155;
}
.zp-how-zone em { font-style: italic; color: #0f172a; }
.zp-how-foot { font-size: 0.74rem; color: #64748b; }
.zp-how-foot em { font-style: normal; font-weight: 600; color: #b45309; }

/* The diagram: five nodes left to right with an arrow between each, one
   under another when the container is too narrow for five across. */
.zp-flow {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1.4rem;
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
}
.zp-flow-node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.65rem 0.75rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  min-width: 0;
}
.zp-flow-node--end { background: #fff; border-style: dashed; }
.zp-flow-node:not(:last-child)::after {
  content: '→';
  position: absolute;
  top: 50%;
  right: -1.25rem;
  transform: translateY(-50%);
  font-size: 1rem;
  font-weight: 700;
  color: #94a3b8;
  pointer-events: none;
}
@container (max-width: 760px) {
  .zp-flow { grid-template-columns: 1fr; gap: 1.3rem; }
  .zp-flow-node:not(:last-child)::after {
    content: '↓';
    top: auto;
    right: auto;
    bottom: -1.3rem;
    left: 50%;
    transform: translateX(-50%);
  }
}
.zp-flow-kicker {
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
}
.zp-flow-title { font-size: 0.78rem; font-weight: 700; color: #0f172a; }
.zp-flow-text { font-size: 0.7rem; line-height: 1.4; color: #475569; }
.zp-flow-text em { font-style: normal; font-weight: 700; color: #0f172a; }

/* Open or closed: the two readings of the residual clause, this zone's lit. */
.zp-cut {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.9rem;
}
@container (max-width: 560px) {
  .zp-cut { grid-template-columns: 1fr; }
}
.zp-cut-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.65rem 0.8rem;
  background: var(--tint);
  border: 1px solid #e2e8f0;
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  min-width: 0;
}
.zp-cut-card--this { border-color: var(--accent); }
.zp-cut-card--dim { opacity: 0.55; }
.zp-cut-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--accent);
}
.zp-cut-this {
  margin-left: auto;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: #0f172a;
  color: #fff;
}
.zp-cut-clause { font-size: 0.72rem; font-style: italic; color: #475569; }
.zp-cut-text { font-size: 0.72rem; line-height: 1.4; color: #334155; }

/* Worked examples, one line of this zone's table per step. */
.zp-how-examples {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
}
.zp-how-example {
  display: grid;
  grid-template-columns: minmax(150px, 230px) minmax(0, 1fr);
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid #f1f5f9;
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  font-size: 0.76rem;
  line-height: 1.45;
}
@container (max-width: 560px) {
  .zp-how-example { grid-template-columns: 1fr; gap: 0.15rem; }
}
.zp-how-example-use {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  color: #0f172a;
}
.zp-how-example-text { color: #334155; }

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
.zp-parent-hint {
  font-size: 0.62rem;
  font-weight: 600;
  color: #94a3b8;
  margin-left: 0.15rem;
}
.zp-parent-change {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  margin-left: 0.2rem;
}
.zp-parent-change--added { background: #dcfce7; color: #15803d; }
.zp-parent-change--removed { background: #fee2e2; color: #b91c1c; }
.zp-parents-note {
  margin: 0.7rem 0 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: #475569;
}
.zp-parents-note strong { color: #0f172a; }
</style>
