<!--
  /cdc-diagram - the shape of a complying development assessment, drawn.

  WHY A DIAGRAM AND NOT ANOTHER TABLE

  /cdc lists the clauses and /cdc-map answers them for one lot. Neither shows the SHAPE of the thing,
  and the shape is the surprising part: one block of general prerequisites gates every certificate, and
  the code for the development then adds a third to a quarter as many again. Read as a list that looks
  like twelve separate rule sets. Drawn, it is one trunk and twelve branches - and the branch is the
  small half. Every figure on the page is counted from the data, never typed.

  Mid-rise is drawn apart because it IS apart: clause 182 of the Housing SEPP does not inherit the
  Codes SEPP prerequisites, so it starts its own gauntlet. A tab strip would have hidden that; a
  diagram cannot.

  TWO CHANNELS, ONE CELL

  Every requirement is one cell, and each cell says two things at once:

    fill     whether we can answer it from data - solid we can, hollow we cannot
    outline  where it came from - grey is the Department workbook, violet the general prerequisites
             read from the instrument, blue the code read from the instrument

  So the eye reads coverage down the page and provenance across it, and a block of hollow violet cells
  - clause 1.18, as it happens - is a gap in our data sitting on top of a gap in the workbook.

  Everything is client-side and comes from the same three shared files /cdc reads, so the two pages
  cannot disagree.
-->

<template>
  <div class="dg">
    <header class="dg-head">
      <div>
        <NuxtLink to="/cdc" class="dg-back">&larr; The prerequisites, clause by clause</NuxtLink>
        <h1 class="dg-title">What a complying development certificate has to clear</h1>
        <p class="dg-sub">
          {{ trunk.all.length }} prerequisites gate every certificate, whatever is being built. The code
          for the development then adds its own — {{ branchRange }} more. Hover a cell for the clause.
        </p>
      </div>
      <div class="dg-key">
        <span class="dg-key-row"><i class="dg-cell dg-cell--on" /> we can answer it</span>
        <span class="dg-key-row"><i class="dg-cell" /> we cannot</span>
        <span class="dg-key-row"><i class="dg-cell dg-cell--add" /> read from the instrument, not the workbook</span>
        <span class="dg-key-row"><i class="dg-cell dg-cell--diverge" /> our test disagrees with the clause</span>
      </div>
    </header>

    <!-- ── the trunk ─────────────────────────────────────────────────────── -->
    <section class="dg-trunk">
      <div class="dg-trunk-head">
        <h2 class="dg-h2">Every certificate clears this first</h2>
        <p class="dg-n">
          <b>{{ trunk.tested }}</b> of {{ trunk.all.length }} we can answer
          <span class="dg-dim">· Codes SEPP Part 1 and Schedule 5</span>
        </p>
      </div>
      <div class="dg-parts">
        <div v-for="p in trunk.parts" :key="p.name" class="dg-part">
          <span class="dg-part-name">{{ p.name }}</span>
          <div class="dg-cells">
            <i
              v-for="c in p.cells" :key="c.clause + c.text.slice(0, 12)"
              class="dg-cell" :class="cellClass(c)" :title="tip(c)"
              @mouseenter="hover = c" @click="pin = pin === c ? null : c"
            />
          </div>
          <span class="dg-part-n">{{ p.cells.length }}</span>
        </div>
      </div>
    </section>

    <!-- ── the comb: one trunk, eleven branches ──────────────────────────── -->
    <section class="dg-fan">
      <div class="dg-stem" />
      <div class="dg-scroll">
        <div class="dg-branches" :style="{ '--n': inheriting.length }">
          <div class="dg-rail" />
          <div
            v-for="b in inheriting" :key="b.key"
            class="dg-branch"
            :class="{ 'dg-branch--on': open === b.key, 'dg-branch--off': open && open !== b.key }"
            @click="open = open === b.key ? '' : b.key"
          >
            <span class="dg-tick" />
            <span class="dg-branch-name">{{ b.name }}</span>
            <span class="dg-branch-code">{{ b.code }}</span>
            <div class="dg-cells dg-cells--branch">
              <i
                v-for="c in b.cells" :key="c.clause + c.text.slice(0, 12)"
                class="dg-cell" :class="cellClass(c)" :title="tip(c)"
                @mouseenter="hover = c" @click.stop="pin = pin === c ? null : c"
              />
            </div>
            <span class="dg-branch-n">{{ b.tested }}/{{ b.cells.length }}</span>
          </div>
        </div>
      </div>
      <p class="dg-fan-note">
        The trunk is the same for all eleven. What changes is the short column underneath — and how
        much of it we can answer, which is the figure under each branch. Click a branch to dim the
        others and read one code on its own.
      </p>
    </section>

    <!-- ── the one that does not inherit ─────────────────────────────────── -->
    <section v-if="detached" class="dg-detached">
      <div class="dg-detached-head">
        <h2 class="dg-h2">{{ detached.name }} starts its own gauntlet</h2>
        <p class="dg-n"><b>{{ detached.tested }}</b> of {{ detached.cells.length }} we can answer</p>
      </div>
      <p class="dg-lead">
        {{ detached.code }} does not inherit the Codes SEPP prerequisites, so none of the trunk above
        applies to it. It is the gate standing in front of the
        <NuxtLink to="/pattern-book">Pattern Book</NuxtLink> designs, and we test none of it.
      </p>
      <div class="dg-cells">
        <i
          v-for="c in detached.cells" :key="c.clause + c.text.slice(0, 12)"
          class="dg-cell" :class="cellClass(c)" :title="tip(c)"
          @mouseenter="hover = c" @click="pin = pin === c ? null : c"
        />
      </div>
    </section>

    <!-- ── what the cell under the cursor says ───────────────────────────── -->
    <section class="dg-detail" :class="{ 'dg-detail--pinned': !!pin }">
      <template v-if="shown">
        <p class="dg-detail-clause">
          <b>{{ shown.clause }}</b>
          <span class="dg-detail-from">{{ shown.source === 'workbook' ? 'Department workbook' : 'read from the instrument' }}</span>
          <span v-if="pin" class="dg-detail-pin">pinned — click the cell again to release</span>
        </p>
        <p class="dg-detail-text">{{ shown.text }}</p>
        <p v-if="shown.says" class="dg-detail-says"><b>We test:</b> {{ shown.says }}</p>
        <p v-if="shown.diverge" class="dg-detail-diverge">{{ shown.diverge }}</p>
      </template>
      <p v-else class="dg-dim">Hover a cell.</p>
    </section>

    <section class="dg-foot">
      <h2 class="dg-h2">How to read the shape</h2>
      <ul class="dg-watch">
        <li>
          <b>The trunk dwarfs the branches.</b> {{ trunk.all.length }} shared prerequisites against
          {{ branchRange }} per code. Most of what stops a complying development has nothing to do with
          what is being built — it is where the land is.
        </li>
        <li>
          <b>Clause 1.18 is nearly all hollow.</b> Eleven of its twelve paragraphs were never in the
          workbook, and most ask for an approval — effluent, stormwater, a roads authority consent, a
          tree permit — which no map layer can answer. They are on the page so they are not mistaken
          for cleared.
        </li>
        <li>
          <b>A solid cell is not an approval.</b> It means we hold data that bears on the clause. The
          design half — setbacks, height, site coverage — is not drawn here at all, because no lot test
          can reach it.
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CDC_REQUIREMENTS, CDC_TYPES } from '#shared/cdc-criteria'
import { CDC_ADDED } from '#shared/cdc-corrections'
import { CDC_TYPE_ADDED, CDC_TYPE_NOTES, CDC_TYPE_PARENTS } from '#shared/cdc-type-corrections'

useHead({ title: 'What a CDC has to clear · Planning Library' })

/** One requirement, whichever of the three files it came from. */
interface Cell {
  clause: string
  text: string
  /** Can we answer it from data we hold. */
  tested: boolean
  source: 'workbook' | 'instrument'
  /** What our test actually does, where there is one. */
  says: string | null
  /** Set when our test and the clause disagree. */
  diverge: string | null
}

const hover = ref<Cell | null>(null)
const pin = ref<Cell | null>(null)
const open = ref('')
const shown = computed(() => pin.value ?? hover.value)

/**
 * The shared prerequisites, in the instrument's order. 1.19A is tested before 1.19 or the prefix match
 * would swallow it - the same trap /cdc's PARTS list carries.
 */
const PARTS = ['1.17A', '1.18', '1.19A', '1.19', 'Schedule'] as const
const partOf = (clause: string) => PARTS.find(p => clause.startsWith(p)) ?? 'other'
const PART_LABEL: Record<string, string> = {
  '1.17A': 'cl 1.17A', '1.18': 'cl 1.18', '1.19A': 'cl 1.19A', '1.19': 'cl 1.19',
  'Schedule': 'Schedule 5', 'other': 'other',
}

const trunk = computed(() => {
  // a parent row introduces the paragraphs beneath it; counting it would count the same rule twice
  const fromWorkbook: Cell[] = CDC_REQUIREMENTS.filter(r => !r.isParent).map(r => ({
    clause: r.clause,
    text: r.text,
    tested: r.tested,
    source: 'workbook' as const,
    says: r.columns.length ? r.columns.join(', ') : null,
    diverge: r.divergence,
  }))
  const fromInstrument: Cell[] = CDC_ADDED.map(a => ({
    clause: a.clause,
    text: a.text,
    // nothing added from the instrument has a column behind it: the workbook is what the notebook was built from
    tested: false,
    source: 'instrument' as const,
    says: null,
    diverge: null,
  }))
  const all = [...fromWorkbook, ...fromInstrument]
  return {
    all,
    tested: all.filter(c => c.tested).length,
    parts: PARTS
      .map(p => ({ name: PART_LABEL[p]!, cells: all.filter(c => partOf(c.clause) === p) }))
      .filter(p => p.cells.length),
  }
})

/** The divergences the type audit recorded, keyed the way the requirements are. */
const TYPE_DIVERGE = new Map(
  CDC_TYPE_NOTES.filter(n => n.kind === 'diverge').map(n => [`${n.type}|${n.clause}`, n.what]),
)
const TYPE_PARENT = new Set(CDC_TYPE_PARENTS.map(p => `${p.type}|${p.clause}`))

/** Every requirement one code adds on top of the trunk. */
function branchOf(t: typeof CDC_TYPES[number]) {
  const says = new Map<string, string>()
  for (const test of t.tests) for (const c of test.checks) says.set(c.column, c.says)

  const fromWorkbook: Cell[] = t.requirements
    .filter(r => !TYPE_PARENT.has(`${t.key}|${r.clause}`))
    .map(r => ({
      clause: r.clause,
      text: r.text,
      tested: r.tested,
      source: 'workbook' as const,
      says: r.testedBy.map(b => b.says).join('; ') || null,
      diverge: TYPE_DIVERGE.get(`${t.key}|${r.clause}`) ?? null,
    }))
  const fromInstrument: Cell[] = CDC_TYPE_ADDED.filter(a => a.type === t.key).map(a => ({
    clause: a.clause,
    text: a.text,
    tested: false,
    source: 'instrument' as const,
    says: null,
    diverge: null,
  }))
  const cells = [...fromWorkbook, ...fromInstrument]
  return {
    key: t.key,
    name: t.name,
    code: t.code,
    inherits: t.inheritsGeneral,
    cells,
    tested: cells.filter(c => c.tested).length,
  }
}

const branches = computed(() => CDC_TYPES.map(branchOf))
const inheriting = computed(() => branches.value.filter(b => b.inherits))
const detached = computed(() => branches.value.find(b => !b.inherits) ?? null)

const branchRange = computed(() => {
  const n = inheriting.value.map(b => b.cells.length)
  return n.length ? `${Math.min(...n)} to ${Math.max(...n)}` : '—'
})

function cellClass(c: Cell) {
  return {
    'dg-cell--on': c.tested,
    'dg-cell--add': c.source === 'instrument',
    'dg-cell--diverge': !!c.diverge,
  }
}

const tip = (c: Cell) => `${c.clause} — ${c.text.slice(0, 150)}${c.text.length > 150 ? '…' : ''}`
</script>

<style scoped>
.dg {
  min-height: 100vh; background: #f6f7fb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; padding-bottom: 12rem;
}

.dg-head { display: flex; flex-wrap: wrap; gap: 1.5rem; justify-content: space-between; padding: 1.2rem 1.5rem 1rem; background: #fff; border-bottom: 1px solid #e2e8f0; }
.dg-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.dg-back:hover { color: #0f172a; }
.dg-title { margin: 0; font-size: 1.4rem; font-weight: 800; color: #0f172a; }
.dg-sub { margin: 0.35rem 0 0; max-width: 70ch; font-size: 0.88rem; color: #475569; }
.dg-key { display: grid; gap: 0.25rem; align-content: start; font-size: 0.72rem; color: #64748b; }
.dg-key-row { display: flex; align-items: center; gap: 0.4rem; }

/* ── the cell, and its two channels ───────────────────────────────────── */
.dg-cell {
  display: block; width: 11px; height: 11px; border-radius: 2px; flex: none;
  border: 1.5px solid #94a3b8; background: transparent; cursor: pointer;
}
.dg-cell--on { background: #334155; border-color: #334155; }
.dg-cell--add { border-color: #7c3aed; }
.dg-cell--add.dg-cell--on { background: #7c3aed; }
.dg-cell--diverge { border-color: #dc2626; box-shadow: inset 0 0 0 1.5px #fff; }
.dg-cell:hover { outline: 2px solid #0f172a; outline-offset: 1px; }
.dg-cells { display: flex; flex-wrap: wrap; gap: 3px; }

/* ── trunk ────────────────────────────────────────────────────────────── */
.dg-trunk { margin: 1.2rem 1.5rem 0; padding: 0.9rem 1.1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; }
.dg-trunk-head { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; justify-content: space-between; margin-bottom: 0.7rem; }
.dg-h2 { margin: 0; font-size: 1rem; font-weight: 800; color: #0f172a; }
.dg-n { margin: 0; font-size: 0.8rem; color: #475569; }
.dg-n b { color: #0f172a; font-size: 0.95rem; }
.dg-dim { color: #94a3b8; }
.dg-parts { display: grid; gap: 0.45rem; }
.dg-part { display: grid; grid-template-columns: 5.5rem 1fr 2rem; align-items: center; gap: 0.7rem; }
.dg-part-name { font-size: 0.75rem; font-weight: 700; color: #475569; text-align: right; }
.dg-part-n { font-size: 0.72rem; color: #94a3b8; font-variant-numeric: tabular-nums; }

/* ── the comb ─────────────────────────────────────────────────────────── */
.dg-fan { margin: 0 1.5rem; }
.dg-stem { width: 2px; height: 22px; margin: 0 auto; background: #cbd5e1; }
.dg-scroll { overflow-x: auto; }
.dg-branches { position: relative; display: grid; grid-template-columns: repeat(var(--n), minmax(7.5rem, 1fr)); gap: 0.5rem; min-width: 60rem; padding-top: 20px; }
.dg-rail { position: absolute; top: 0; left: calc(100% / var(--n) / 2); right: calc(100% / var(--n) / 2); height: 2px; background: #cbd5e1; }
.dg-branch { position: relative; padding: 0.55rem 0.5rem 0.5rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; }
.dg-branch--on { border-color: #334155; box-shadow: 0 0 0 2px #e2e8f0; }
/* picking one code dims the rest, so a single column can be read against the trunk */
.dg-branch--off { opacity: 0.32; }
.dg-tick { position: absolute; top: -20px; left: 50%; width: 2px; height: 20px; background: #cbd5e1; }
.dg-branch-name { display: block; font-size: 0.76rem; font-weight: 800; color: #0f172a; line-height: 1.25; }
.dg-branch-code { display: block; margin: 0.1rem 0 0.4rem; font-size: 0.66rem; color: #94a3b8; line-height: 1.3; }
.dg-branch-n { display: block; margin-top: 0.45rem; font-size: 0.7rem; font-weight: 700; color: #64748b; font-variant-numeric: tabular-nums; }
.dg-cells--branch { max-width: 8rem; }
.dg-fan-note { margin: 0.8rem 0 0; font-size: 0.78rem; color: #64748b; max-width: 80ch; }

/* ── the detached one ─────────────────────────────────────────────────── */
.dg-detached { margin: 1.6rem 1.5rem 0; padding: 0.9rem 1.1rem; background: #fff; border: 1px dashed #cbd5e1; border-radius: 14px; }
.dg-detached-head { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; justify-content: space-between; }
.dg-lead { margin: 0.4rem 0 0.7rem; font-size: 0.82rem; color: #475569; max-width: 84ch; }
.dg-lead a { color: #7c3aed; }

/* ── the readout ──────────────────────────────────────────────────────── */
.dg-detail {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
  padding: 0.7rem 1.5rem; background: #0f172a; color: #e2e8f0; border-top: 2px solid #334155;
  min-height: 4.4rem;
}
.dg-detail--pinned { border-top-color: #7c3aed; }
.dg-detail-clause { margin: 0; display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; font-size: 0.8rem; }
.dg-detail-clause b { color: #fff; font-size: 0.9rem; }
.dg-detail-from { font-size: 0.7rem; color: #94a3b8; }
.dg-detail-pin { font-size: 0.68rem; color: #c4b5fd; }
.dg-detail-text { margin: 0.2rem 0 0; font-size: 0.82rem; color: #cbd5e1; max-width: 120ch; }
.dg-detail-says { margin: 0.2rem 0 0; font-size: 0.76rem; color: #93c5fd; }
.dg-detail-says b { color: #bfdbfe; }
.dg-detail-diverge { margin: 0.2rem 0 0; font-size: 0.76rem; color: #fca5a5; max-width: 120ch; }
.dg-detail .dg-dim { font-size: 0.8rem; }

.dg-foot { margin: 1.6rem 1.5rem 0; }
.dg-watch { margin: 0.4rem 0 0; padding-left: 1.1rem; display: grid; gap: 0.5rem; max-width: 88ch; font-size: 0.82rem; color: #475569; }
.dg-watch b { color: #0f172a; }
</style>
