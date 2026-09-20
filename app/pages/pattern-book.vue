<!--
  /pattern-book - the 22 NSW Pattern Book designs and what each one needs from a lot.

  The criteria are three numbers per design: lot size, frontage width and slope. Listed as a table that
  is 22 rows of numbers and means nothing. So the page is built the other way round: you put in a lot,
  and the designs answer. The thresholds are still all there, but underneath an answer rather than
  instead of one.

  Everything is client-side. PATTERN_DESIGNS is generated from "07 - Pattern book" by
  scratchpad/gen_criteria.py, so the page cannot drift from the notebook, and no request is needed to
  work out whether 480 square metres clears 450.
-->

<template>
  <div class="pb">
    <header class="pb-head">
      <div>
        <NuxtLink to="/" class="pb-back">&larr; Home</NuxtLink>
        <h1 class="pb-title">Pattern Book — what each design needs</h1>
        <p class="pb-sub">
          {{ PATTERN_DESIGNS.length }} designs across {{ PATTERN_CATEGORIES.length }} categories.
          Each one comes down to three numbers: how big the lot is, how wide its frontage is, and how
          steep it is. Put a lot in and see which ones it can take.
        </p>
      </div>
    </header>

    <!-- ── try a lot ─────────────────────────────────────────────────────── -->
    <section class="pb-try">
      <div class="pb-try-inner">
        <div class="pb-fields">
          <label class="pb-field">
            <span>Lot size</span>
            <span class="pb-input"><input v-model.number="lotSize" type="number" min="0" step="10"><i>m²</i></span>
          </label>
          <label class="pb-field">
            <span>Frontage width</span>
            <span class="pb-input"><input v-model.number="width" type="number" min="0" step="0.5"><i>m</i></span>
          </label>
          <label class="pb-field">
            <span>Slope</span>
            <span class="pb-input"><input v-model.number="slope" type="number" min="0" step="0.5"><i>%</i></span>
          </label>
          <div class="pb-flags">
            <button type="button" class="pb-flag" :class="{ 'pb-flag--on': inLmr }" @click="inLmr = !inLmr">
              Low and mid-rise area
            </button>
            <button type="button" class="pb-flag" :class="{ 'pb-flag--on': inTod }" @click="inTod = !inTod">
              Transport precinct
            </button>
            <button type="button" class="pb-flag" :class="{ 'pb-flag--on': corner }" @click="corner = !corner">
              Corner lot
            </button>
          </div>
        </div>

        <div class="pb-score">
          <p class="pb-score-n" :class="{ 'pb-score-n--zero': passing.length === 0 }">{{ passing.length }}</p>
          <p class="pb-score-l">of {{ PATTERN_DESIGNS.length }} designs fit</p>
          <p v-if="passing.length" class="pb-score-cats">{{ passingCategories.join(' · ') }}</p>
        </div>
      </div>

      <p class="pb-caveat">
        This is the lot test only. Every design also needs the property to clear
        {{ PATTERN_PREREQ_COUNT }} complying-development prerequisites and to permit the use the design
        is built on, which the <NuxtLink to="/cdc">complying development page</NuxtLink> sets out.
      </p>
    </section>

    <!-- ── every design and what it asks for ────────────────────────────── -->
    <section class="pb-sec">
      <h2 class="pb-h2">What each design requires</h2>
      <p class="pb-lead">
        Smallest lot first. Where two figures are given, the first applies inside a low and mid-rise area
        and the second outside one, which is the main thing that area does: it lowers the bar. The last
        column answers for the lot above, and says what stops it when it does not fit.
      </p>
      <div class="pb-scroll">
        <table class="pb-table">
          <thead>
            <tr>
              <th>Design</th>
              <th>Designer</th>
              <th>Needs the use</th>
              <th>Where</th>
              <th class="pb-num">Min lot</th>
              <th class="pb-num">Min frontage</th>
              <th class="pb-num">Max slope</th>
              <th>Against this lot</th>
            </tr>
          </thead>
          <tbody v-for="cat in PATTERN_CATEGORIES" :key="cat">
            <tr class="pb-tr-cat">
              <th colspan="7">
                <i class="pb-swatch" :style="{ background: catColour(cat) }" />{{ cat }}
              </th>
              <td class="pb-num">{{ byCategory(cat).filter(d => verdict(d).ok).length }} of {{ byCategory(cat).length }}</td>
            </tr>
            <tr
              v-for="d in sortedIn(cat)" :key="d.key"
              :class="{ 'pb-tr-yes': verdict(d).ok, 'pb-tr-no': !verdict(d).ok }"
            >
              <td class="pb-td-name">{{ prettyKey(d.key) }}</td>
              <td class="pb-dim">{{ d.designer }}</td>
              <td class="pb-dim">{{ useWords(d.requiredUse) }}</td>
              <td class="pb-dim">
                {{ whereWords(d) }}<template v-if="d.requiresCornerLot">, corner lot</template>
              </td>
              <td class="pb-num">{{ pair(d, b => b.minLotSizeM2, 'm²') }}</td>
              <td class="pb-num">{{ pair(d, b => b.minLotWidthM, 'm') }}</td>
              <td class="pb-num pb-slope">{{ slopeWords(blockFor(d).slopes) }}</td>
              <td>
                <span v-if="verdict(d).ok" class="pb-tick pb-tick--yes">fits</span>
                <span v-else class="pb-why">{{ verdict(d).why }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="pb-sec">
      <h2 class="pb-h2">What the numbers do not cover</h2>
      <ul class="pb-caveats">
        <li>
          <b>Slope is measured three ways.</b> The older designs carry one maximum; the newer ones split
          it into upslope, downslope and crossfall, and the strictest of the three decides. The single
          figure you enter above is tested against all of them.
        </li>
        <li>
          <b>Fitting is not approval.</b> Clearing the size, width and slope says the design can sit on
          the lot. Whether it can be built also depends on the prerequisites and on the use being
          permitted where you are.
        </li>
        <li>
          <b>Frontage is the measured one.</b> The build reads the frontage the cadastre gives, not the
          width at the building line, which has no legal definition.
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { PATTERN_CATEGORIES, PATTERN_DESIGNS, PATTERN_PREREQ_COUNT, type PatternDesign } from '#shared/pattern-book'

useHead({ title: 'Pattern Book criteria · Planning Library' })

/** A typical suburban lot, so the page says something before anything is typed. */
const lotSize = ref<number | null>(600)
const width = ref<number | null>(15)
const slope = ref<number | null>(5)
const inLmr = ref(true)
const inTod = ref(false)
const corner = ref(false)

const CAT_COLOURS: Record<string, string> = {
  'Semis': '#0891b2',
  'Manor Homes': '#7c3aed',
  'Row Homes': '#ea580c',
  'Terraces': '#db2777',
  'Small Lot Apartments': '#16a34a',
  'Corner Lot Apartments': '#ca8a04',
  'Large Lot Apartments': '#2563eb',
}
const catColour = (c: string) => CAT_COLOURS[c] ?? '#64748b'

const byCategory = (cat: string) => PATTERN_DESIGNS.filter(d => d.category === cat)

const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'))

function prettyKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\bApt\b/, 'Apartment')
    .replace(/(\d)storeys?/gi, '$1 storeys')
    .replace(/(\d)_(\d)/g, '$1-$2')
}

function useWords(use: string) {
  if (use === 'dual') return 'dual occupancy'
  if (use === 'multi') return 'multi dwelling housing'
  return 'a residential flat building'
}

/** The strictest of whatever slope limits a design carries, since they all have to hold. */
function slopeLimit(slopes: Record<string, number>): number | null {
  const vals = Object.values(slopes)
  return vals.length ? Math.min(...vals) : null
}

function slopeWords(slopes: Record<string, number>) {
  const entries = Object.entries(slopes)
  if (!entries.length) return '—'
  if (entries.length === 1 && entries[0]![0] === 'max_slope') return `${entries[0]![1]}%`
  return entries
    .map(([k, v]) => `${k.replace('max_', '').replace('upslope', 'up').replace('downslope', 'down')} ${v}%`)
    .join(' · ')
}

/** The block of numbers that applies where the lot is. */
function blockFor(d: PatternDesign) {
  if (d.areaLogic === 'lmr_vs_non_lmr') {
    return d.blocks.find(b => b.block === (inLmr.value ? 'In an LMR area' : 'Outside an LMR area')) ?? d.blocks[0]!
  }
  return d.blocks[0]!
}

/** Does the lot meet this design, and if not, the first thing that stops it. */
function verdict(d: PatternDesign): { ok: boolean; why: string } {
  if (d.requiresCornerLot && !corner.value) return { ok: false, why: 'Needs a corner lot.' }

  const logic = d.areaLogic
  if (logic === 'lmr_or_tod' && !inLmr.value && !inTod.value) {
    return { ok: false, why: 'Only in a low and mid-rise area or a transport precinct.' }
  }
  if (logic === 'lmr_and_tod' && !(inLmr.value && inTod.value)) {
    return { ok: false, why: 'Only where a low and mid-rise area and a transport precinct overlap.' }
  }
  if (logic === 'non_lmr_and_non_tod' && (inLmr.value || inTod.value)) {
    return { ok: false, why: 'Only outside both the low and mid-rise areas and the transport precincts.' }
  }

  const b = blockFor(d)
  if (b.minLotSizeM2 && (lotSize.value ?? 0) < b.minLotSizeM2) {
    return { ok: false, why: `Needs ${fmt(b.minLotSizeM2)} m², ${fmt(b.minLotSizeM2 - (lotSize.value ?? 0))} m² more than this lot.` }
  }
  if (b.minLotWidthM && (width.value ?? 0) < b.minLotWidthM) {
    return { ok: false, why: `Needs ${b.minLotWidthM} m of frontage, ${(b.minLotWidthM - (width.value ?? 0)).toFixed(1)} m more than this lot.` }
  }
  const limit = slopeLimit(b.slopes)
  if (limit != null && (slope.value ?? 0) > limit) {
    return { ok: false, why: `Needs ${limit}% slope or flatter; this lot is ${slope.value}%.` }
  }
  return { ok: true, why: '' }
}

const passing = computed(() => PATTERN_DESIGNS.filter(d => verdict(d).ok))
const passingCategories = computed(() => [...new Set(passing.value.map(d => d.category))])

/** Within a category, the least demanding design first. */
const sortedIn = (cat: string) =>
  [...byCategory(cat)].sort((a, b) => (blockFor(a).minLotSizeM2 ?? 0) - (blockFor(b).minLotSizeM2 ?? 0))

/**
 * Where a design has one figure inside an LMR area and another outside, show both as "450 → 565".
 * Not rounded: a frontage of 15.5 m rounded to 16 would overstate the requirement by half a metre.
 */
function pair(d: PatternDesign, get: (b: PatternDesign['blocks'][number]) => number | null, unit: string) {
  const values = d.blocks.map(get).filter(v => v != null) as number[]
  if (!values.length) return '—'
  const unique = [...new Set(values)]
  return `${unique.map(exact).join(' → ')} ${unit}`
}

/** As written in the rule: whole numbers plain, fractions kept. */
const exact = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('en-AU') : n.toLocaleString('en-AU', { maximumFractionDigits: 2 })

/** The area rule in a few words, since the column is narrow. */
function whereWords(d: PatternDesign) {
  return {
    lmr_vs_non_lmr: 'anywhere, easier in LMR',
    lmr_or_tod: 'LMR or transport precinct',
    lmr_and_tod: 'LMR and transport precinct',
    non_lmr_and_non_tod: 'outside both',
    any: 'anywhere',
  }[d.areaLogic] ?? d.areaLogic
}
</script>

<style scoped>
.pb {
  min-height: 100vh; background: #f8fafb; color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  padding-bottom: 4rem;
}
.pb-head { padding: 1.2rem 1.5rem 1rem; background: #fff; border-bottom: 1px solid #e2e8f0; }
.pb-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.25rem; }
.pb-back:hover { color: #0f172a; }
.pb-title { margin: 0; font-size: 1.4rem; font-weight: 800; color: #0f172a; }
.pb-sub { margin: 0.35rem 0 0; max-width: 62ch; font-size: 0.88rem; color: #475569; }

.pb-try { margin: 1.2rem 1.5rem 0; padding: 1rem 1.1rem; background: #0f172a; border-radius: 14px; color: #e2e8f0; }
.pb-try-inner { display: flex; flex-wrap: wrap; align-items: center; gap: 1.4rem; justify-content: space-between; }
.pb-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.8rem; }
.pb-field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; color: #94a3b8; }
.pb-input { display: flex; align-items: baseline; gap: 0.3rem; background: #1e293b; border: 1px solid #334155; border-radius: 9px; padding: 0.25rem 0.5rem; }
.pb-input input { width: 5.2rem; border: 0; background: none; color: #fff; font: inherit; font-size: 1rem; font-weight: 700; }
.pb-input input:focus { outline: none; }
.pb-input i { font-style: normal; font-size: 0.72rem; color: #94a3b8; }
.pb-flags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.pb-flag { padding: 0.3rem 0.6rem; border: 1px solid #334155; border-radius: 999px; background: #1e293b; font: inherit; font-size: 0.74rem; color: #94a3b8; cursor: pointer; }
.pb-flag--on { background: #f1f5f9; border-color: #f1f5f9; color: #0f172a; font-weight: 700; }
.pb-score { text-align: right; }
.pb-score-n { margin: 0; font-size: 2.6rem; font-weight: 800; line-height: 1; color: #4ade80; }
.pb-score-n--zero { color: #f87171; }
.pb-score-l { margin: 0.1rem 0 0; font-size: 0.78rem; color: #94a3b8; }
.pb-score-cats { margin: 0.15rem 0 0; font-size: 0.7rem; color: #cbd5e1; max-width: 34ch; }
.pb-caveat { margin: 0.8rem 0 0; font-size: 0.75rem; color: #94a3b8; }
.pb-caveat a { color: #93c5fd; }

.pb-sec { margin: 1.8rem 1.5rem 0; }
.pb-h2 { display: flex; align-items: center; gap: 0.45rem; margin: 0 0 0.25rem; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
.pb-h2-n { font-size: 0.75rem; font-weight: 600; color: #94a3b8; }
.pb-swatch { width: 12px; height: 12px; border-radius: 3px; flex: none; }
.pb-lead { margin: 0 0 0.8rem; max-width: 74ch; font-size: 0.82rem; color: #475569; }

.pb-scroll { overflow-x: auto; }
.pb-table { width: 100%; min-width: 900px; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; font-size: 0.78rem; }
.pb-table thead th { padding: 0.45rem 0.7rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; text-align: left; white-space: nowrap; }
.pb-table td, .pb-table tbody th { padding: 0.3rem 0.7rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
.pb-tr-cat th { background: #f1f5f9; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; text-align: left; }
.pb-tr-cat td { background: #f1f5f9; font-size: 0.7rem; color: #64748b; }
.pb-tr-cat .pb-swatch { display: inline-block; margin-right: 0.4rem; vertical-align: -1px; }
.pb-tr-no { color: #94a3b8; }
.pb-tr-no .pb-td-name { color: #64748b; }
.pb-td-name { font-weight: 700; color: #0f172a; white-space: nowrap; }
.pb-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pb-slope { font-size: 0.72rem; }
.pb-dim { color: #64748b; }
.pb-tick { display: inline-block; padding: 0.05em 0.45em; border-radius: 999px; background: #f1f5f9; color: #94a3b8; font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
.pb-tick--yes { background: #dcfce7; color: #15803d; }
.pb-why { font-size: 0.74rem; color: #64748b; }

.pb-caveats { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.5rem; max-width: 74ch; }
.pb-caveats li { font-size: 0.82rem; color: #334155; }
</style>
