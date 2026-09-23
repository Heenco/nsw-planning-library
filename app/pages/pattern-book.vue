<!--
  /pattern-book - the NSW Pattern Book designs and what each one needs from a lot.

  Built the same way round as before: you put a lot in and the designs answer. Three things changed
  after the review in docs/pattern-book-review.md.

  1. THE PAGE IS TWO PAGES. The low-rise patterns can be complying development under Part 3BA of the
     Codes SEPP. The mid-rise patterns cannot - they are Housing SEPP Chapter 7 and need a development
     application. They do not share a gate, so they no longer share a section or a colour.

  2. SLOPE IS A FALL IN METRES. The patterns state what the design absorbs as stairs - "up to 2.5 m
     front to back, and 2.1 m side to side" - not a gradient. The percentages the page used to show
     were a workbook conversion for an assumed site length, and were wrong either side of it by up to
     three times. So the lot now carries a depth, the fall is computed from it, and the metres are
     what is tested.

  3. THE LOT TEST IS NOT THE ANSWER. The zone gate, the LEP minimum lot size outside an LMR area and
     the cl 3BA.6 exclusions all sit in front of these numbers. They are named on the page rather than
     left out, because left out reads as though they had been tested.

  Everything is client-side. PATTERN_DESIGNS is generated from "07 - Pattern book" by
  scripts/gen-pattern-book.py, so the page cannot drift from the notebook.
-->

<template>
  <div class="pb">
    <header class="pb-head">
      <div>
        <NuxtLink to="/" class="pb-back">&larr; Home</NuxtLink>
        <h1 class="pb-title">Pattern Book — what each design needs</h1>
        <p class="pb-sub">
          {{ PATTERN_DESIGN_COUNT }} patterns in {{ PATTERN_CATEGORIES.length }} categories, shown as
          {{ PATTERN_DESIGNS.length }} rows because several offer more than one storey height. Put a
          lot in and see which ones can sit on it.
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
            <span>Width at the building line</span>
            <span class="pb-input"><input v-model.number="width" type="number" min="0" step="0.5"><i>m</i></span>
          </label>
          <label class="pb-field">
            <span>Depth, front to back</span>
            <span class="pb-input"><input v-model.number="depth" type="number" min="0" step="1"><i>m</i></span>
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
            <span class="pb-zones">
              <button
                v-for="z in ZONE_CHOICES" :key="z" type="button"
                class="pb-flag pb-flag--zone" :class="{ 'pb-flag--on': zone === z }" @click="zone = z"
              >{{ z }}</button>
            </span>
          </div>
        </div>

        <div class="pb-score">
          <p class="pb-score-n" :class="{ 'pb-score-n--zero': passingDesigns.length === 0 }">{{ passingDesigns.length }}</p>
          <p class="pb-score-l">of {{ PATTERN_DESIGN_COUNT }} patterns fit</p>
          <p v-if="passingDesigns.length" class="pb-score-cats">{{ passingCategories.join(' · ') }}</p>
        </div>
      </div>

      <p class="pb-derived">
        That is <b>{{ fall(depth) }} m</b> of fall front to back and <b>{{ fall(width) }} m</b> side to
        side, which is what the patterns are written against.
      </p>
    </section>

    <!-- ── low-rise: complying development ──────────────────────────────── -->
    <section class="pb-sec pb-sec--low">
      <h2 class="pb-h2">
        <span class="pb-rail" />Low-rise
        <span class="pb-path">complying development · Pattern Book Development Code, Part 3BA</span>
      </h2>
      <p class="pb-lead">
        Where two figures are given the first applies inside a low and mid-rise area and the second
        outside one, which is the main thing that area does: it lowers the bar. Outside one, the LEP
        minimum lot size for the use applies as well, so the second figure is a floor, not the
        requirement.
      </p>

      <p v-if="!zoneAllowsCdc" class="pb-warn">
        <b>Not in zone {{ PATTERN_CDC_ZONES.join(', ') }}.</b> The pattern book complying development
        pathway does not reach this lot; these designs would need a development application. The lot
        test below still runs.
      </p>

      <div class="pb-scroll">
        <table class="pb-table">
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Designer</th>
              <th>Needs the use</th>
              <th class="pb-num">Min lot</th>
              <th class="pb-num">Min width</th>
              <th class="pb-num">Max fall</th>
              <th>Against this lot</th>
            </tr>
          </thead>
          <tbody v-for="cat in lowRiseCategories" :key="cat">
            <tr class="pb-tr-cat">
              <th colspan="6">
                <i class="pb-swatch" :style="{ background: catColour(cat) }" />{{ cat }}
              </th>
              <td class="pb-num">{{ fitCount(cat) }}</td>
            </tr>
            <tr
              v-for="d in sortedIn(cat)" :key="d.key"
              :class="{ 'pb-tr-yes': verdict(d).ok, 'pb-tr-no': !verdict(d).ok }"
            >
              <td class="pb-td-name">
                {{ d.design }}
                <span v-for="n in d.notes" :key="n" class="pb-sub">{{ n }}</span>
              </td>
              <td class="pb-dim">{{ d.designer }}</td>
              <td class="pb-dim">{{ d.useTerm }}</td>
              <td class="pb-num">
                {{ pair(d, b => b.minLotSizeM2, 'm²') }}
                <span v-if="showsLepRule(d)" class="pb-sub">+ the LEP minimum</span>
              </td>
              <td class="pb-num">{{ pair(d, b => b.minLotWidthM, 'm') }}</td>
              <td class="pb-num pb-fall">{{ fallWords(blockFor(d).falls) }}</td>
              <td>
                <span v-if="verdict(d).ok" class="pb-tick">fits</span>
                <span v-else class="pb-why">{{ verdict(d).why }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="pb-h3">What Part 3BA asks, before any of this</h3>
      <p class="pb-lead">
        The general complying development requirements in clauses 1.17A, 1.18 and 1.19 apply — the
        {{ PATTERN_PREREQ_COUNT }} prerequisites the build tests, which the
        <NuxtLink to="/cdc">complying development page</NuxtLink> sets out for the other codes. Part 3BA
        then adds its own, below. The Department's workbook has a sheet for each of the other twelve
        codes and none for this one, so these rows were
        <a :href="PATTERN_3BA_URL" target="_blank" rel="noopener">read from the instrument</a> and the
        wording is verbatim. {{ tested3ba }} of {{ PATTERN_3BA_REQUIREMENTS.length }} are answered by
        anything we hold.
      </p>
      <div class="pb-scroll">
        <table class="pb-table pb-table--3ba">
          <thead>
            <tr>
              <th>Clause</th>
              <th>What the code says</th>
              <th>Do we answer it?</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in PATTERN_3BA_REQUIREMENTS" :key="r.clause">
              <td class="pb-3ba-clause">
                <a :href="PATTERN_3BA_URL" target="_blank" rel="noopener">{{ r.clause }}</a>
              </td>
              <td>
                {{ r.text }}
                <span v-if="r.note" class="pb-3ba-note">{{ r.note }}</span>
              </td>
              <td>
                <span class="pb-3ba-mark" :class="{ 'pb-3ba-mark--no': !r.tested }">
                  {{ r.tested ? '✓' : '—' }}
                </span>
                <span class="pb-3ba-data">{{ r.data }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── mid-rise: development application ────────────────────────────── -->
    <section class="pb-sec pb-sec--mid">
      <h2 class="pb-h2">
        <span class="pb-rail" />Mid-rise
        <span class="pb-path">development application · Housing SEPP Chapter 7, from 28 November 2025</span>
      </h2>
      <p class="pb-lead">
        These are <b>not</b> complying development. A development application goes to the council, so
        the prerequisites above do not gate them and nothing here is a fast-track answer. The small lot
        and corner patterns run in transport oriented development precincts and low and mid-rise areas;
        the large lot patterns are available more generally.
      </p>
      <div class="pb-scroll">
        <table class="pb-table">
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Designer</th>
              <th>Where</th>
              <th class="pb-num">Min lot</th>
              <th class="pb-num">Min width</th>
              <th class="pb-num">Max fall</th>
              <th>Against this lot</th>
            </tr>
          </thead>
          <tbody v-for="cat in midRiseCategories" :key="cat">
            <tr class="pb-tr-cat">
              <th colspan="6">
                <i class="pb-swatch" :style="{ background: catColour(cat) }" />{{ cat }}
              </th>
              <td class="pb-num">{{ fitCount(cat) }}</td>
            </tr>
            <tr
              v-for="d in sortedIn(cat)" :key="d.key"
              :class="{ 'pb-tr-yes': verdict(d).ok, 'pb-tr-no': !verdict(d).ok }"
            >
              <td class="pb-td-name">
                {{ d.design }}
                <span v-if="d.variant" class="pb-sub">{{ d.variant }}</span>
                <span v-for="n in d.notes" :key="n" class="pb-sub">{{ n }}</span>
              </td>
              <td class="pb-dim">{{ d.designer }}</td>
              <td class="pb-dim">
                {{ whereWords(d) }}<template v-if="d.requiresCornerLot">, corner lot</template>
              </td>
              <td class="pb-num">{{ pair(d, b => b.minLotSizeM2, 'm²') }}</td>
              <td class="pb-num">{{ pair(d, b => b.minLotWidthM, 'm') }}</td>
              <td class="pb-num pb-fall">{{ fallWords(blockFor(d).falls) }}</td>
              <td>
                <span v-if="verdict(d).ok" class="pb-tick">fits</span>
                <span v-else class="pb-why">{{ verdict(d).why }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="pb-sec">
      <h2 class="pb-h2"><span class="pb-rail pb-rail--plain" />What the numbers do not cover</h2>
      <ul class="pb-caveats">
        <li>
          <b>Three numbers are the site test, not the design test.</b> Each pattern's own table also
          fixes maximum building height, floor space ratio, front, side, rear and secondary setbacks,
          the articulation zone, minimum landscaped area and parking — and for terraces, 45 m of
          unbroken street frontage. A lot that clears the three numbers above has not cleared the
          pattern.
        </li>
        <li>
          <b>Fall is computed, not measured.</b> The page multiplies the one slope figure you type by
          the lot's depth and by its width. A real lot falls unevenly and the pattern cares about the
          ground the building stands on, so read a near miss as a reason to look rather than an answer.
        </li>
        <li>
          <b>The width is the one at the front building line.</b> That is the pattern's own definition,
          not the frontage the cadastre gives; on an irregular lot they differ.
        </li>
        <li>
          <b>Permissibility is a separate question.</b> Manor house, multi dwelling housing and multi
          dwelling housing (terraces) are three distinct terms in a land use table, and a zone that
          permits one need not permit the others. Check the use named in the third column against the
          zone's own table.
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PATTERN_3BA_REQUIREMENTS, PATTERN_3BA_URL, PATTERN_CATEGORIES, PATTERN_CDC_ZONES,
  PATTERN_DESIGN_COUNT,
  PATTERN_DESIGNS, PATTERN_PREREQ_COUNT, type PatternDesign,
} from '#shared/pattern-book'

useHead({ title: 'Pattern Book criteria · Planning Library' })

/** A typical suburban lot, so the page says something before anything is typed. */
const lotSize = ref<number | null>(600)
const width = ref<number | null>(15)
const depth = ref<number | null>(40)
const slope = ref<number | null>(5)
const inLmr = ref(true)
const inTod = ref(false)
const corner = ref(false)
const ZONE_CHOICES = ['R1', 'R2', 'R3', 'Other'] as const
const zone = ref<string>('R2')

const zoneAllowsCdc = computed(() => PATTERN_CDC_ZONES.includes(zone.value))

/** Counted rather than written down, so the sentence cannot drift from the table under it. */
const tested3ba = PATTERN_3BA_REQUIREMENTS.filter(r => r.tested).length

/**
 * Low-rise in the clay of the complying development pathway, mid-rise in the indigo of the DA one,
 * so the split the instrument makes is the first thing the page shows.
 */
const CAT_COLOURS: Record<string, string> = {
  'Semis': '#9a3412',
  'Manor Homes': '#b45309',
  'Row Homes': '#c2410c',
  'Terraces': '#a16207',
  'Small Lot Apartments': '#4338ca',
  'Corner Lot Apartments': '#6d28d9',
  'Large Lot Apartments': '#1d4ed8',
}
const catColour = (c: string) => CAT_COLOURS[c] ?? '#78716c'

const byCategory = (cat: string) => PATTERN_DESIGNS.filter(d => d.category === cat)
const catPathway = (cat: string) => byCategory(cat)[0]?.pathway
const lowRiseCategories = computed(() => PATTERN_CATEGORIES.filter(c => catPathway(c) === 'cdc'))
const midRiseCategories = computed(() => PATTERN_CATEGORIES.filter(c => catPathway(c) === 'da'))

const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-AU'))

/** Metres of fall over a run, from the single gradient typed above. */
const fallOver = (run: number | null) => ((slope.value ?? 0) / 100) * (run ?? 0)
const fall = (run: number | null) => fallOver(run).toFixed(2)

/** The block of numbers that applies where the lot is. */
function blockFor(d: PatternDesign) {
  if (d.areaLogic === 'lmr_vs_non_lmr') {
    return d.blocks.find(b => b.block === (inLmr.value ? 'In an LMR area' : 'Outside an LMR area')) ?? d.blocks[0]!
  }
  return d.blocks[0]!
}

const showsLepRule = (d: PatternDesign) => blockFor(d).lepMinLotSizeAlsoApplies

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
    return { ok: false, why: `Needs ${b.minLotWidthM} m at the building line, ${(b.minLotWidthM - (width.value ?? 0)).toFixed(1)} m more than this lot.` }
  }

  /*
   * The fall, in the two directions the patterns name. Where a pattern splits up-slope from
   * down-slope the direction is not something the page knows, so the stricter of the two decides -
   * it can call a lot short that a directional measure would pass, never the other way round.
   */
  const f = b.falls
  const directional = [f.upM, f.downM].filter((v): v is number => v != null)
  const frontBack = f.frontToBackM ?? (directional.length ? Math.min(...directional) : null)
  if (frontBack != null && fallOver(depth.value) > frontBack) {
    return { ok: false, why: `Absorbs ${frontBack} m front to back; this lot falls ${fall(depth.value)} m over ${fmt(depth.value)} m.` }
  }
  if (f.sideToSideM != null && fallOver(width.value) > f.sideToSideM) {
    return { ok: false, why: `Absorbs ${f.sideToSideM} m side to side; this lot falls ${fall(width.value)} m over ${fmt(width.value)} m.` }
  }
  return { ok: true, why: '' }
}

const passingRows = computed(() => PATTERN_DESIGNS.filter(d => verdict(d).ok))
/** Patterns, not rows: three storey heights of one design are one design that fits. */
const passingDesigns = computed(() => [...new Set(passingRows.value.map(d => d.design))])
const passingCategories = computed(() => [...new Set(passingRows.value.map(d => d.category))])

/** "2 of 4" for a category, counted the same way. */
function fitCount(cat: string) {
  const all = new Set(byCategory(cat).map(d => d.design))
  const ok = new Set(byCategory(cat).filter(d => verdict(d).ok).map(d => d.design))
  return `${ok.size} of ${all.size}`
}

/** Within a category, the least demanding row first. */
const sortedIn = (cat: string) =>
  [...byCategory(cat)].sort((a, b) => (blockFor(a).minLotSizeM2 ?? 0) - (blockFor(b).minLotSizeM2 ?? 0))

/**
 * Where a design has one figure inside an LMR area and another outside, show both as "450 → 565".
 * Not rounded: a width of 15.5 m rounded to 16 would overstate the requirement by half a metre.
 */
function pair(d: PatternDesign, get: (b: PatternDesign['blocks'][number]) => number | null, unit: string) {
  const values = d.blocks.map(get).filter(v => v != null) as number[]
  if (!values.length) return '—'
  const unique = [...new Set(values)]
  return `${unique.map(exact).join(' → ')} ${unit}`
}

/** As written in the pattern: whole numbers plain, fractions kept. */
const exact = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('en-AU') : n.toLocaleString('en-AU', { maximumFractionDigits: 2 })

/** The published fall, in the pattern's own words. */
function fallWords(falls: PatternDesign['blocks'][number]['falls']) {
  const parts: string[] = []
  if (falls.frontToBackM != null) parts.push(`${falls.frontToBackM} m front to back`)
  if (falls.upM != null) parts.push(`${falls.upM} m up`)
  if (falls.downM != null) parts.push(`${falls.downM} m down`)
  if (falls.sideToSideM != null) parts.push(`${falls.sideToSideM} m side to side`)
  return parts.length ? parts.join(' · ') : '—'
}

/** The area rule in a few words, since the column is narrow. */
function whereWords(d: PatternDesign) {
  return {
    lmr_vs_non_lmr: 'anywhere, easier in LMR',
    lmr_or_tod: 'LMR or transport precinct',
    lmr_and_tod: 'LMR and transport precinct',
    non_lmr_and_non_tod: 'outside both',
    any: 'anywhere the use is permitted',
  }[d.areaLogic] ?? d.areaLogic
}
</script>

<style scoped>
.pb {
  min-height: 100vh; background: #faf7f4; color: #292524;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  padding-bottom: 4rem;
}

.pb-head { padding: 1.2rem 1.5rem 1rem; background: #fff; border-bottom: 1px solid #e7e0d8; }
.pb-back { display: inline-block; font-size: 0.78rem; color: #8b7d70; text-decoration: none; margin-bottom: 0.25rem; }
.pb-back:hover { color: #7c2d12; }
.pb-title { margin: 0; font-size: 1.4rem; font-weight: 800; color: #1c1917; }
.pb-sub { margin: 0.35rem 0 0; max-width: 66ch; font-size: 0.88rem; color: #57534e; }

/* ── the lot ──────────────────────────────────────────────────────────── */
.pb-try { margin: 1.2rem 1.5rem 0; padding: 1rem 1.1rem; background: #7c2d12; border-radius: 14px; color: #fdece1; }
.pb-try-inner { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1.4rem; justify-content: space-between; }
.pb-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.9rem; }
.pb-field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; color: #f1c8ac; }
.pb-input { display: flex; align-items: baseline; gap: 0.3rem; background: #9a3412; border: 1px solid #b4501f; border-radius: 9px; padding: 0.25rem 0.5rem; }
.pb-input input { width: 5.2rem; border: 0; background: none; color: #fff; font: inherit; font-size: 1rem; font-weight: 700; }
.pb-input input:focus { outline: none; }
.pb-input i { font-style: normal; font-size: 0.72rem; color: #f1c8ac; }
.pb-flags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; padding-bottom: 0.15rem; }
.pb-zones { display: inline-flex; gap: 0.2rem; margin-left: 0.4rem; padding-left: 0.6rem; border-left: 1px solid #b4501f; }
.pb-flag { padding: 0.3rem 0.6rem; border: 1px solid #b4501f; border-radius: 999px; background: #9a3412; font: inherit; font-size: 0.74rem; color: #f1c8ac; cursor: pointer; }
.pb-flag--zone { padding: 0.3rem 0.5rem; }
.pb-flag--on { background: #fff7ed; border-color: #fff7ed; color: #7c2d12; font-weight: 700; }

.pb-score { text-align: right; }
.pb-score-n { margin: 0; font-size: 2.6rem; font-weight: 800; line-height: 1; color: #fdba74; }
.pb-score-n--zero { color: #fca5a5; }
.pb-score-l { margin: 0.1rem 0 0; font-size: 0.78rem; color: #f1c8ac; }
.pb-score-cats { margin: 0.15rem 0 0; font-size: 0.7rem; color: #fde3ce; max-width: 34ch; }
.pb-derived { margin: 0.8rem 0 0; font-size: 0.78rem; color: #f1c8ac; }
.pb-derived b { color: #fff; }

/* ── sections ─────────────────────────────────────────────────────────── */
.pb-sec { margin: 1.6rem 1.5rem 0; }
.pb-h2 { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin: 0 0 0.3rem; font-size: 1.05rem; font-weight: 800; color: #1c1917; }
.pb-h3 { margin: 1.6rem 0 0.3rem; font-size: 0.92rem; font-weight: 800; color: #1c1917; }
.pb-rail { width: 4px; height: 1.1rem; border-radius: 2px; background: #9a3412; }
.pb-sec--mid .pb-rail { background: #4338ca; }
.pb-rail--plain { background: #a8a29e; }
.pb-path { font-size: 0.72rem; font-weight: 600; color: #9a3412; background: #fdf1e7; border: 1px solid #f3d8c3; border-radius: 999px; padding: 0.1rem 0.55rem; }
.pb-sec--mid .pb-path { color: #4338ca; background: #eef0fe; border-color: #d3d7fb; }
.pb-lead { margin: 0 0 0.8rem; max-width: 84ch; font-size: 0.82rem; color: #57534e; }
.pb-lead a, .pb-caveats a { color: #9a3412; }

.pb-warn { margin: 0 0 0.8rem; padding: 0.5rem 0.75rem; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 9px; font-size: 0.8rem; color: #78350f; max-width: 84ch; }

/* ── table ────────────────────────────────────────────────────────────── */
.pb-scroll { overflow-x: auto; }
.pb-table { width: 100%; min-width: 900px; border-collapse: collapse; background: #fff; border: 1px solid #e7e0d8; border-radius: 12px; overflow: hidden; font-size: 0.78rem; }
.pb-table thead th { padding: 0.45rem 0.7rem; background: #f7f2ec; border-bottom: 1px solid #e7e0d8; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #78716c; text-align: left; white-space: nowrap; }
.pb-table td, .pb-table tbody th { padding: 0.35rem 0.7rem; border-bottom: 1px solid #f5f0ea; vertical-align: top; }
.pb-tr-cat th, .pb-tr-cat td { background: #f2ece5; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #57534e; text-align: left; }
.pb-tr-cat td { font-weight: 700; text-transform: none; letter-spacing: 0; color: #78716c; }
.pb-swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 0.45rem; }
.pb-tr-yes { background: #f7fbf7; }
.pb-tr-no { color: #a8a29e; }
.pb-tr-no .pb-td-name { color: #78716c; }
.pb-td-name { font-weight: 700; color: #1c1917; }
.pb-sub { display: block; font-size: 0.68rem; font-weight: 400; color: #a8a29e; max-width: 30ch; }
.pb-dim { color: #78716c; }
.pb-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pb-num .pb-sub { text-align: right; max-width: none; }
.pb-fall { white-space: normal; min-width: 11rem; color: #57534e; }
.pb-tick { font-weight: 800; color: #15803d; }
.pb-why { color: #78716c; }

/* ── 3BA.6 list ───────────────────────────────────────────────────────── */
.pb-table--3ba { min-width: 720px; }
.pb-table--3ba td:first-child { white-space: nowrap; }
.pb-table--3ba td:last-child { width: 26%; }
.pb-3ba-clause a { color: #9a3412; font-weight: 700; text-decoration: none; }
.pb-3ba-clause a:hover { text-decoration: underline; }
.pb-3ba-note { display: block; margin-top: 0.2rem; font-size: 0.72rem; color: #9a3412; }
.pb-3ba-mark { font-weight: 800; color: #15803d; }
.pb-3ba-mark--no { color: #c2410c; }
.pb-3ba-data { display: block; margin-top: 0.1rem; font-size: 0.72rem; color: #78716c; }

.pb-caveats { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.5rem; max-width: 88ch; }
.pb-caveats li { font-size: 0.82rem; color: #44403c; }
.pb-caveats b { color: #1c1917; }
</style>
