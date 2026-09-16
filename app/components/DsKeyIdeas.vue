<!--
  <DsKeyIdeas>

  The ideas the NSW land and address tables are built on, drawn as one made-up
  street block for /datasources: ordinary lots, flats on one lot, a strata
  building (from above and from the side), and a house across two lots.

  Pick an idea, or click a part of the drawing, and the parts that idea covers
  light up while the rest fades. The drawing is illustrative, not data; the
  examples in the text are real addresses.
-->

<template>
  <div class="ki">
    <div class="ki-figure-wrap">
      <svg
        class="ki-figure"
        viewBox="0 0 780 390"
        role="img"
        aria-labelledby="ki-fig-title"
      >
        <title id="ki-fig-title">A street block showing lots, properties, a strata building, addresses and access points</title>
        <defs>
          <pattern id="ki-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#cbd5e1" stroke-width="2" />
          </pattern>
        </defs>

        <!-- ── From above ─────────────────────────────────────────────── -->
        <text x="12" y="22" class="ki-cap">From above</text>

        <rect x="0" y="310" width="480" height="64" class="ki-road" />
        <line x1="0" y1="342" x2="480" y2="342" class="ki-road-line" />
        <text x="240" y="366" class="ki-road-label">STREET</text>

        <!-- lots -->
        <rect x="12" y="44" width="100" height="266" :class="c(['lot', 'dp'], 's ki-lot')" @click="pick('dp')" />
        <rect x="112" y="44" width="105" height="266" :class="c(['lot', 'dp'], 's ki-lot')" @click="pick('dp')" />
        <rect x="217" y="44" width="140" height="266" :class="c(['lot', 'sp', 'cp'], 's ki-lot ki-lot--strata')" @click="pick('sp')" />
        <rect x="357" y="44" width="60" height="266" :class="c(['lot', 'dp'], 's ki-lot')" @click="pick('dp')" />
        <rect x="417" y="44" width="60" height="266" :class="c(['lot', 'dp'], 's ki-lot')" @click="pick('dp')" />

        <text x="62" y="62" :class="c(['lot', 'dp'], 't ki-small')">DP lot</text>
        <text x="164" y="62" :class="c(['lot', 'dp'], 't ki-small')">DP lot</text>
        <text x="287" y="62" :class="c(['lot', 'sp'], 't ki-small')">//SP site</text>
        <text x="387" y="62" :class="c(['lot', 'dp'], 't ki-small')">DP lot</text>
        <text x="447" y="62" :class="c(['lot', 'dp'], 't ki-small')">DP lot</text>

        <!-- buildings -->
        <rect x="32" y="140" width="60" height="80" :class="c([], 'ki-house')" />
        <rect x="122" y="150" width="40" height="75" :class="c([], 'ki-house')" />
        <rect x="167" y="150" width="40" height="75" :class="c([], 'ki-house')" />
        <rect x="232" y="100" width="110" height="150" :class="c(['sp'], 's ki-block')" @click="pick('sp')" />
        <text x="287" y="180" :class="c(['sp'], 't ki-small ki-on-dark')">building</text>
        <rect x="372" y="140" width="90" height="80" :class="c(['property'], 'ki-house')" @click="pick('property')" />

        <!-- properties -->
        <rect x="17" y="49" width="90" height="256" :class="c(['property'], 's ki-prop')" @click="pick('property')" />
        <rect x="117" y="49" width="95" height="256" :class="c(['property'], 's ki-prop')" @click="pick('property')" />
        <rect x="222" y="49" width="130" height="256" :class="c(['property'], 's ki-prop')" @click="pick('property')" />
        <rect x="362" y="49" width="110" height="256" :class="c(['property'], 's ki-prop')" @click="pick('property')" />
        <text x="417" y="238" :class="c(['property'], 't ki-small')">one property,</text>
        <text x="417" y="250" :class="c(['property'], 't ki-small')">two lots</text>

        <!-- access lines and waypoints -->
        <g :class="c(['access'], 'g')" @click="pick('access')">
          <line x1="62" y1="262" x2="62" y2="318" class="ki-access" />
          <line x1="142" y1="262" x2="164" y2="318" class="ki-access" />
          <line x1="187" y1="262" x2="164" y2="318" class="ki-access" />
          <line x1="287" y1="270" x2="287" y2="318" class="ki-access" />
          <line x1="400" y1="262" x2="400" y2="318" class="ki-access" />
          <rect x="58" y="314" width="8" height="8" class="ki-way" />
          <rect x="160" y="314" width="8" height="8" class="ki-way" />
          <rect x="283" y="314" width="8" height="8" class="ki-way" />
          <rect x="396" y="314" width="8" height="8" class="ki-way" />
        </g>

        <!-- address points -->
        <g :class="c(['point'], 'g')" @click="pick('point')">
          <circle cx="62" cy="262" r="5" class="ki-dot" />
          <circle cx="142" cy="262" r="5" class="ki-dot" />
          <circle cx="187" cy="262" r="5" class="ki-dot" />
          <circle cx="287" cy="270" r="5" class="ki-dot" />
          <circle cx="400" cy="262" r="5" class="ki-dot" />
        </g>

        <!-- addresses -->
        <g @click="pick('address')">
          <text x="62" y="292" :class="c(['address'], 't ki-addr')">12</text>
          <text x="164" y="292" :class="c(['address'], 't ki-addr')">14, 1/14, 2/14</text>
          <text x="287" y="292" :class="c(['address'], 't ki-addr')">16, 1/16 to 6/16</text>
          <text x="417" y="292" :class="c(['address'], 't ki-addr')">18</text>
        </g>

        <!-- the strata site seen from the side -->
        <path d="M287,44 V34 H640 V62" :class="c(['sp'], 's ki-link')" />
        <text x="463" y="28" :class="c(['sp'], 't ki-small')">the same building, from the side</text>

        <!-- ── From the side ──────────────────────────────────────────── -->
        <line x1="510" y1="310" x2="770" y2="310" class="ki-ground" />
        <rect x="510" y="300" width="260" height="10" :class="c(['cp'], 's ki-cp')" @click="pick('cp')" />
        <rect x="552" y="66" width="176" height="14" :class="c(['cp'], 's ki-cp')" @click="pick('cp')" />
        <rect x="560" y="250" width="160" height="50" :class="c(['cp'], 's ki-cp')" @click="pick('cp')" />
        <text x="640" y="279" :class="c(['cp'], 't ki-small')">lobby and parking</text>

        <g v-for="u in UNITS" :key="u.n" @click="pick('unit')">
          <rect :x="u.x" :y="u.y" width="80" height="56" :class="c(['unit'], 's ki-unit')" />
          <text :x="u.x + 40" :y="u.y + 25" :class="c(['unit'], 't ki-unit-label')">Unit {{ u.n }}</text>
          <text :x="u.x + 40" :y="u.y + 40" :class="c(['unit'], 't ki-small')">lot {{ u.n }}</text>
        </g>

        <text x="640" y="332" :class="c(['cp'], 't ki-small')">Land, lobby and roof: common property</text>
        <text x="640" y="348" :class="c(['unit'], 't ki-small')">Each unit is its own strata lot, with no map shape</text>
      </svg>
    </div>

    <div class="ki-body">
      <ul class="ki-list" aria-label="Key ideas">
        <li v-for="concept in CONCEPTS" :key="concept.id">
          <button
            type="button"
            class="ki-chip"
            :class="{ 'ki-chip--on': concept.id === focus }"
            :aria-pressed="concept.id === focus"
            @click="pick(concept.id)"
          >
            {{ concept.term }}
            <span v-if="!concept.drawn" class="ki-chip-note">text only</span>
          </button>
        </li>
      </ul>

      <article v-if="current" class="ki-card" aria-live="polite">
        <h3 class="ki-card-term">{{ current.term }}</h3>
        <p class="ki-card-plain">{{ current.plain }}</p>
        <dl class="ki-card-facts">
          <dt>In the data</dt>
          <dd>{{ current.inData }}</dd>
          <dt>Example</dt>
          <dd>{{ current.example }}</dd>
        </dl>
        <p v-if="!current.drawn" class="ki-card-note">Not drawn in the picture above.</p>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CONCEPTS, type ConceptId } from '#shared/datasources-nsw'

const focus = ref<ConceptId>('lot')
const current = computed(() => CONCEPTS.find(c => c.id === focus.value) ?? null)

const UNITS = [
  { n: 1, x: 560, y: 194 }, { n: 2, x: 640, y: 194 },
  { n: 3, x: 560, y: 138 }, { n: 4, x: 640, y: 138 },
  { n: 5, x: 560, y: 82 }, { n: 6, x: 640, y: 82 },
]

function pick(id: ConceptId) {
  focus.value = id
}

/**
 * The classes for one part of the drawing: `on` when the idea in focus covers
 * it, `off` when it does not. Parts no idea covers, the plain houses, stay as
 * they are: they are scenery, not data.
 */
function c(ids: ConceptId[], base: string): string[] {
  if (!ids.length) return [base]
  return [base, 'ki-part', ids.includes(focus.value) ? 'on' : 'off']
}
</script>

<style scoped>
.ki {
  display: grid;
  gap: 1.25rem;
}

.ki-figure-wrap {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 0.75rem;
  overflow-x: auto;
}
.ki-figure {
  display: block;
  width: 100%;
  min-width: 560px;
  height: auto;
  font-family: inherit;
}

/* ── Drawing ─────────────────────────────────────────────────────────── */
.ki-cap { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; fill: #64748b; }
.ki-road { fill: #e2e8f0; }
.ki-road-line { stroke: #fff; stroke-width: 2; stroke-dasharray: 14 10; }
.ki-road-label { font-size: 10px; letter-spacing: 0.3em; fill: #64748b; text-anchor: middle; }
.ki-ground { stroke: #475569; stroke-width: 1.5; }

.ki-lot { fill: #fff; stroke: #475569; stroke-width: 1.5; cursor: pointer; }
.ki-lot--strata { fill: url(#ki-hatch); }
.ki-house { fill: #cbd5e1; stroke: #94a3b8; cursor: default; }
.ki-block { fill: #64748b; stroke: #334155; cursor: pointer; }
.ki-prop { fill: none; stroke: #0f172a; stroke-width: 1.5; stroke-dasharray: 5 4; cursor: pointer; }
.ki-access { stroke: #0f172a; stroke-width: 1.2; stroke-dasharray: 3 3; }
.ki-way { fill: #fff; stroke: #0f172a; stroke-width: 1.5; }
.ki-dot { fill: #0f172a; }
.ki-link { fill: none; stroke: #94a3b8; stroke-width: 1.2; stroke-dasharray: 4 4; }
.ki-cp { fill: url(#ki-hatch); stroke: #94a3b8; stroke-width: 1; cursor: pointer; }
.ki-unit { fill: #f1f5f9; stroke: #475569; stroke-width: 1.2; cursor: pointer; }
.ki-unit-label { font-size: 11px; font-weight: 600; fill: #0f172a; text-anchor: middle; }
.ki-small { font-size: 10px; fill: #475569; text-anchor: middle; }
.ki-addr { font-size: 11px; font-weight: 600; fill: #0f172a; text-anchor: middle; cursor: pointer; }
.ki-on-dark { fill: #f8fafc; }

g.ki-part { cursor: pointer; }
.ki-part { transition: opacity 0.18s ease, stroke 0.18s ease, fill 0.18s ease; }
.ki-part.off { opacity: 0.22; }
.ki-part.on.s { stroke: #15803d; stroke-width: 3; }
.ki-part.on.t { fill: #15803d; font-weight: 700; }
g.ki-part.on .ki-dot { fill: #15803d; }
g.ki-part.on .ki-access { stroke: #15803d; stroke-width: 2; }
g.ki-part.on .ki-way { stroke: #15803d; stroke-width: 2.5; }
.ki-part.on.ki-block { fill: #475569; }

/* ── Ideas list and card ─────────────────────────────────────────────── */
.ki-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 1.25rem;
  align-items: start;
}
@media (max-width: 760px) {
  .ki-body { grid-template-columns: 1fr; }
}

.ki-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ki-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
}
.ki-chip:hover { border-color: #15803d; color: #15803d; }
.ki-chip--on { background: #15803d; border-color: #15803d; color: #fff; }
.ki-chip--on:hover { color: #fff; }
.ki-chip-note { font-size: 0.65rem; font-weight: 500; opacity: 0.75; }

.ki-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #15803d;
  border-radius: 10px;
  padding: 1rem 1.15rem;
}
.ki-card-term { margin: 0 0 0.35rem; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
.ki-card-plain { margin: 0 0 0.75rem; font-size: 0.92rem; line-height: 1.55; color: #1e293b; }
.ki-card-facts { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 0.9rem; font-size: 0.82rem; }
.ki-card-facts dt { font-weight: 700; color: #64748b; }
.ki-card-facts dd { margin: 0; color: #334155; line-height: 1.5; }
.ki-card-note { margin: 0.7rem 0 0; font-size: 0.75rem; color: #64748b; font-style: italic; }
</style>
