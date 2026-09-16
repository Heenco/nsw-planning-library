<!--
  <DsAddressTrace>

  "Trace an address" on /datasources: type any NSW address and see it pass
  through every table, step by step, with the real values and the field used to
  get from one table to the next. A small map draws the lot shape it ends at,
  the address point, and the access line to the road.

  Search and trace both come from /api/datasources/nsw-address. The page owns
  which address is shown - it passes one in and is told when this panel traces
  another - so that the URL can be kept in step without the router, which would
  scroll the reader to the top of the page on every click.
-->

<template>
  <div class="tr">
    <div class="tr-search">
      <label class="tr-label" for="tr-input">Address</label>
      <div class="tr-input-wrap">
        <input
          id="tr-input"
          v-model="query"
          type="text"
          class="tr-input"
          placeholder="e.g. 1/90 Denning Street South Coogee"
          autocomplete="off"
          @input="onInput"
          @keydown.down.prevent="moveActive(1)"
          @keydown.up.prevent="moveActive(-1)"
          @keydown.enter.prevent="pickActive"
          @keydown.escape="matches = []"
          @blur="closeSoon"
        >
        <ul v-if="matches.length" class="tr-matches" role="listbox">
          <li
            v-for="(m, i) in matches"
            :key="m.id"
            role="option"
            :aria-selected="i === active"
            class="tr-match"
            :class="{ 'tr-match--on': i === active }"
            @mousedown.prevent="traceId(m.id, m.address)"
          >
            <span>{{ m.address }}</span>
            <span class="tr-kind">{{ KIND_LABEL[m.kind] }}</span>
          </li>
        </ul>
      </div>
      <p v-if="hint" class="tr-hint">{{ hint }}</p>
      <div class="tr-examples">
        <span class="tr-examples-label">Try</span>
        <button v-for="ex in EXAMPLES" :key="ex.q" type="button" class="tr-example" @click="runExample(ex.q)">
          <span class="tr-example-kind">{{ ex.kind }}</span>{{ ex.q }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="tr-status">Tracing…</p>
    <p v-else-if="error" class="tr-status tr-status--error">{{ error }}</p>

    <div v-if="result && !loading" class="tr-result">
      <p class="tr-summary">{{ summary }}</p>

      <div class="tr-grid">
        <!-- ── Small map ──────────────────────────────────────────────── -->
        <figure class="tr-map">
          <svg v-if="map" :viewBox="`0 0 ${MW} ${MH}`" class="tr-map-svg" role="img" :aria-label="`Lot shape and address point for ${result.address.address}`">
            <defs>
              <clipPath id="tr-clip"><rect :width="MW" :height="MH" /></clipPath>
            </defs>
            <g clip-path="url(#tr-clip)">
              <path v-for="(d, i) in map.neighbours" :key="`n${i}`" :d="d" class="tr-map-neighbour" />
              <path v-for="lot in map.lots" :key="lot.cadid" :d="lot.d" class="tr-map-lot" />
              <line v-if="map.way && map.point" :x1="map.point[0]" :y1="map.point[1]" :x2="map.way[0]" :y2="map.way[1]" class="tr-map-access" />
              <rect v-if="map.way" :x="map.way[0] - 4" :y="map.way[1] - 4" width="8" height="8" class="tr-map-way" />
              <circle v-if="map.point" :cx="map.point[0]" :cy="map.point[1]" r="6" class="tr-map-point" />
            </g>
          </svg>
          <p v-else class="tr-map-empty">No shape to draw.</p>
          <figcaption class="tr-map-legend">
            <span><i class="tr-key tr-key--lot" />lot shape</span>
            <span><i class="tr-key tr-key--point" />address point</span>
            <span><i class="tr-key tr-key--way" />road access</span>
            <span><i class="tr-key tr-key--neighbour" />neighbouring lots</span>
          </figcaption>
        </figure>

        <!-- ── Steps ──────────────────────────────────────────────────── -->
        <ol class="tr-steps">
          <li class="tr-step">
            <StepHead n="1" table="guras.addressstring" title="The address string" />
            <dl class="tr-kv">
              <dt>Address</dt><dd>{{ result.address.address }}</dd>
              <dt>msoid</dt><dd><code>{{ result.address.msoid }}</code></dd>
              <dt>Kind</dt><dd>{{ KIND_LABEL[result.kind] }}</dd>
              <dt>propid</dt><dd><code>{{ result.address.propid }}</code></dd>
              <dt>sppropid</dt><dd><code>{{ result.address.sppropid ?? 'empty' }}</code></dd>
              <template v-if="result.address.officialAddress && result.address.officialAddress !== result.address.address">
                <dt>Main address</dt><dd>{{ result.address.officialAddress }}</dd>
              </template>
              <template v-if="result.address.siteName"><dt>Site name</dt><dd>{{ result.address.siteName }}</dd></template>
              <dt>Address type</dt><dd>{{ code('principaladdresstype', result.address.principalType) }}</dd>
              <dt>Supplied by</dt><dd>{{ code('contributororigin', result.address.contributorOrigin) }}</dd>
            </dl>
          </li>

          <li class="tr-step">
            <StepHead n="2" table="cadastre.property" title="Its valuation property" via="property.addressstringoid = msoid" />
            <p v-if="!result.property.found" class="tr-miss">This address has no row in the property table.</p>
            <dl v-else class="tr-kv">
              <dt>Address rows</dt><dd>{{ result.property.addressRows }} on this property</dd>
              <dt>Primary address</dt><dd>{{ result.property.primaryAddress ?? 'none' }}</dd>
              <dt>Valuation type</dt><dd>{{ code('valnetpropertytype', result.property.valnetType) }}</dd>
              <dt>Lots valued</dt><dd>{{ result.property.valnetLotCount ?? 'not recorded' }}</dd>
              <dt>Property area</dt><dd>{{ area(result.property.areaM2) }}</dd>
            </dl>
          </li>

          <li class="tr-step">
            <StepHead n="3" table="guras.propertylot" title="Which lot it is" :via="linkVia" />
            <p class="tr-note">
              This property has
              {{ plural(result.propertyLotCounts.ordinary, 'ordinary lot') }},
              {{ plural(result.propertyLotCounts.unit, 'strata unit lot') }} and
              {{ plural(result.propertyLotCounts.common, 'common property row') }}.
            </p>
            <p v-if="!result.links.length" class="tr-miss">No property lot matches this address.</p>
            <ul v-else class="tr-lots">
              <li v-for="l in result.links" :key="l.titleLotId + l.propidtype">
                <code class="tr-lot-id">{{ l.titleLotId }}</code>
                <span class="tr-lot-type">{{ code('propidtype', l.propidtype) }}</span>
                <span v-if="!l.hasShape" class="tr-flag">no shape in the lot map</span>
              </li>
            </ul>
          </li>

          <li class="tr-step">
            <StepHead n="4" table="cadastre.lot" title="The lot shape" :via="result.lotSource === 'point' ? 'lot under the address point' : 'lot.cadid = propertylot.cadid'" />
            <p v-if="result.lotSource === 'point'" class="tr-note">No property record reaches a shape, so the lot under the address point is shown instead.</p>
            <p v-if="!result.lots.length" class="tr-miss">No lot shape found.</p>
            <table v-else class="tr-table">
              <thead><tr><th>Lot</th><th>Kind</th><th>Area</th><th>Point inside</th></tr></thead>
              <tbody>
                <tr v-for="lot in result.lots" :key="lot.cadid" class="tr-lot-row" title="Trace this lot" @click="$emit('trace-lot', lot.cadid)">
                  <td><code>{{ lot.lotidstring }}</code></td>
                  <td>{{ code('classsubtype', lot.classsubtype) }}</td>
                  <td>{{ area(lot.areaM2) }}</td>
                  <td>{{ lot.containsPoint == null ? 'no point' : lot.containsPoint ? 'yes' : 'no' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="result.lots.length" class="tr-note">Click a lot to trace the land itself.</p>
          </li>

          <li class="tr-step">
            <StepHead n="5" table="guras.addresspoint" title="Where it sits, and how it is reached" via="addresspoint.addressstringoid = msoid" />
            <p v-if="!result.point" class="tr-miss">This address has no map point.</p>
            <dl v-else class="tr-kv">
              <dt>Point</dt><dd><code>{{ result.point.lat.toFixed(6) }}, {{ result.point.lon.toFixed(6) }}</code></dd>
              <dt>Placed on</dt><dd>{{ code('addresspointtype', result.point.pointType) }}</dd>
              <dt>Containment</dt><dd>{{ code('containment', result.point.containment) }}</dd>
              <template v-if="result.point.accessMetres != null">
                <dt>From the road</dt><dd>{{ result.point.accessMetres }} m along the access line</dd>
              </template>
            </dl>
          </li>

          <li class="tr-step">
            <StepHead n="6" table="integrated_address.point_address" title="What the integrated service says" via="ss_addressstringoid = msoid" />
            <p v-if="!result.integrated.length" class="tr-miss">The integrated service has no row for this address.</p>
            <template v-else>
              <dl class="tr-kv">
                <dt>Formatted</dt><dd>{{ result.integrated[0]!.formattedAddress }}</dd>
                <dt>Lot{{ result.integrated.length > 1 ? 's' : '' }}</dt>
                <dd>
                  <code v-for="r in result.integrated" :key="r.lotCadid ?? r.cadastralIdentifier ?? ''" class="tr-inline-code">{{ r.cadastralIdentifier }}</code>
                  <span class="tr-agree" :class="agrees ? 'tr-agree--yes' : 'tr-agree--no'">
                    <span aria-hidden="true">{{ agrees ? '✓' : '!' }}</span>{{ agrees ? 'same as step 3' : 'differs from step 3' }}
                  </span>
                </dd>
                <dt>Council</dt><dd>{{ result.integrated[0]!.lga ?? 'not given' }}</dd>
                <dt>ABS areas</dt><dd>SA1 {{ result.integrated[0]!.sa1 }}, {{ result.integrated[0]!.sa2Name }}</dd>
                <dt>Electorates</dt><dd>{{ result.integrated[0]!.stateElectorate }} (state), {{ result.integrated[0]!.federalDivision }} (federal)</dd>
              </dl>
            </template>
          </li>
        </ol>
      </div>

      <details v-if="result.siblings.total > 1" class="tr-siblings" :open="siblingsOpen" @toggle="siblingsOpen = ($event.target as HTMLDetailsElement).open">
        <summary>All {{ result.siblings.total }} addresses on this property</summary>
        <table class="tr-table">
          <thead><tr><th>Address</th><th>Type</th><th>Strata lot</th></tr></thead>
          <tbody>
            <tr
              v-for="s in result.siblings.rows"
              :key="s.msoid"
              class="tr-sibling"
              :class="{ 'tr-sibling--on': s.msoid === result.address.msoid }"
              @click="traceId(s.msoid, s.address)"
            >
              <td>{{ s.address }}</td>
              <td>{{ code('principaladdresstype', s.principalType) }}</td>
              <td><code v-if="s.lot">{{ s.lot }}</code></td>
            </tr>
          </tbody>
        </table>
        <p v-if="result.siblings.total > result.siblings.rows.length" class="tr-note">Showing the first {{ result.siblings.rows.length }}.</p>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h } from 'vue'
import { CODE_LISTS, SCHEMA_COLOR, type AddressKind, type AddressMatch, type AddressTrace, type GeoJsonGeometry, type SchemaKey } from '#shared/datasources-nsw'

/**
 * One example of each kind of address, because the three that look alike are
 * exactly the ones people get wrong: a unit in a strata building, the building's
 * own address (which is its common property), and flats that carry unit numbers
 * on an ordinary lot with no strata plan at all.
 */
const EXAMPLES = [
  { kind: 'A unit', q: '1/90 Denning Street South Coogee' },
  { kind: 'The building itself', q: '90 Denning Street South Coogee' },
  { kind: 'Flats, not strata', q: '1/145 Malabar Road South Coogee' },
  { kind: 'A unit in a big block', q: '405/88-90 Foveaux Street Surry Hills' },
  { kind: 'One address, two lots', q: '90R Malabar Road South Coogee' },
]

const KIND_LABEL: Record<AddressKind, string> = {
  'strata-unit': 'Strata unit',
  'strata-scheme': 'Strata building address',
  ordinary: 'Ordinary address',
}

// A small heading for each step, naming the table it reads.
const StepHead = defineComponent({
  props: { n: String, table: String, title: String, via: String },
  setup(p) {
    return () => {
      const schema = (p.table ?? '').split('.')[0] as SchemaKey
      return h('div', { class: 'tr-step-head' }, [
        h('span', { class: 'tr-step-n' }, p.n),
        h('div', { class: 'tr-step-titles' }, [
          h('span', { class: 'tr-step-title' }, p.title),
          h('span', { class: 'tr-step-table' }, [
            h('i', { class: 'tr-step-dot', style: { background: SCHEMA_COLOR[schema] ?? '#94a3b8' } }),
            p.table,
            p.via ? h('span', { class: 'tr-step-via' }, ` via ${p.via}`) : null,
          ]),
        ]),
      ])
    }
  },
})

const props = defineProps<{ focus: number | null }>()
const emit = defineEmits<{
  (e: 'trace-lot', cadid: string): void
  (e: 'tracing'): void
  (e: 'traced', msoid: number): void
}>()

const query = ref('')
const matches = ref<AddressMatch[]>([])
const active = ref(0)
const hint = ref('')
const result = ref<AddressTrace | null>(null)
/** Open for a short list; once the reader opens or closes it, their choice stands. */
const siblingsOpen = ref(false)
const loading = ref(false)
const error = ref('')

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchToken = 0
let traceToken = 0

function onInput() {
  clearTimeout(searchTimer)
  hint.value = ''
  if (query.value.trim().length < 3) { matches.value = []; return }
  searchTimer = setTimeout(() => runSearch(false), 300)
}

async function runSearch(autoPick: boolean) {
  const token = ++searchToken
  try {
    const res = await $fetch<{ results: AddressMatch[]; hint?: string }>('/api/datasources/nsw-address', { query: { q: query.value } })
    if (token !== searchToken) return
    matches.value = autoPick ? [] : res.results
    active.value = 0
    hint.value = res.hint ?? ''
    if (autoPick && res.results[0]) traceId(res.results[0].id, res.results[0].address)
  } catch (err) {
    if (token !== searchToken) return
    hint.value = `Search failed: ${(err as Error).message}`
  }
}

function runExample(q: string) {
  query.value = q
  runSearch(true)
}

function moveActive(step: number) {
  if (!matches.value.length) return
  active.value = (active.value + step + matches.value.length) % matches.value.length
}
function pickActive() {
  const m = matches.value[active.value]
  if (m) traceId(m.id, m.address)
  else if (query.value.trim().length >= 3) runSearch(true)
}
function closeSoon() {
  setTimeout(() => { matches.value = [] }, 150)
}

async function traceId(id: number, address?: string) {
  matches.value = []
  if (address) query.value = address
  const token = ++traceToken
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<AddressTrace>('/api/datasources/nsw-address', { query: { id } })
    if (token !== traceToken) return
    emit('tracing')                       // measure the anchor before the panel changes height
    if (res.address.propid !== result.value?.address.propid) siblingsOpen.value = res.siblings.total <= 12
    result.value = res
    query.value = res.address.address
    emit('traced', id)
  } catch (err: any) {
    if (token !== traceToken) return
    error.value = `Could not trace this address: ${err?.data?.statusMessage ?? err?.message ?? err}`
  } finally {
    if (token === traceToken) loading.value = false
  }
}

onMounted(() => {
  if (props.focus) traceId(props.focus)
  else runExample(EXAMPLES[0]!.q)
})

// The page asks for an address when the lot trace hands one over.
watch(() => props.focus, (id) => {
  if (id && id !== result.value?.address.msoid) traceId(id)
})

// ── Wording ─────────────────────────────────────────────────────────────

function code(field: string, value: number | string | null | undefined): string {
  if (value == null) return 'not recorded'
  const list = CODE_LISTS.find(c => c.field === field)
  return list?.values.find(v => v.code === String(value))?.label ?? `code ${value}`
}

function plural(n: number, word: string): string {
  if (n === 1) return `1 ${word}`
  const plural = /[^aeiou]y$/.test(word) ? word.slice(0, -1) + 'ies'
    : /(s|sh|ch|x)$/.test(word) ? `${word}es`
      : `${word}s`
  return `${n.toLocaleString('en-AU')} ${plural}`
}

function area(m2: number | null): string {
  if (m2 == null) return 'unknown'
  return m2 >= 10_000 ? `${(m2 / 10_000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString('en-AU')} m²`
}

const linkVia = computed(() => {
  switch (result.value?.kind) {
    case 'strata-unit': return 'sppropid, propidtype 2'
    case 'strata-scheme': return 'propid, propidtype 3'
    default: return 'propid, propidtype 1'
  }
})

const agrees = computed(() => {
  const r = result.value
  if (!r) return false
  const ours = new Set(r.links.map(l => l.titleLotId))
  return r.integrated.length > 0 && r.integrated.every(i => i.cadastralIdentifier != null && ours.has(i.cadastralIdentifier))
})

const summary = computed(() => {
  const r = result.value
  if (!r) return ''
  const others = Math.max(0, r.siblings.total - 1)
  const site = r.lots[0]?.lotidstring
  const title = r.links[0]?.titleLotId
  let text = ''
  if (r.kind === 'strata-unit') {
    text = title
      ? `This is a strata unit. Its own title is ${title}. A unit has no shape of its own, so on the map it sits on the building's site${site ? `, ${site},` : ''} shared with ${plural(others, 'other address')}.`
      : 'This is a strata unit, but no strata lot record matches it.'
  } else if (r.kind === 'strata-scheme') {
    text = `This is the street address of a strata building. It belongs to the common property${title ? `, ${title}` : ''}. The scheme has ${plural(r.propertyLotCounts.unit, 'strata lot')}, and ${plural(others, 'other address')} share the site.`
  } else {
    const lots = r.lots.map(l => l.lotidstring)
    text = lots.length === 1
      ? `This is an ordinary address on one lot, ${lots[0]}.`
      : lots.length > 1
        ? `This is an ordinary address whose property covers ${lots.length} lots: ${lots.join(', ')}.`
        : 'This is an ordinary address, but no lot shape was found for it.'
    if (others > 0 && r.lotSource === 'property') text += ` It shares the property with ${plural(others, 'other address')}, which are flats or a dual occupancy rather than strata.`
  }
  if (r.lotSource === 'point') text += ' The lot shown is the one under the address point.'
  return text
})

// ── Small map ───────────────────────────────────────────────────────────

const MW = 360
const MH = 300
const PAD = 18

function rings(g: GeoJsonGeometry): number[][][] {
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).flat()
  return []
}

const map = computed(() => {
  const r = result.value
  if (!r || (!r.lots.length && !r.point)) return null
  const focus: number[][] = []
  r.lots.forEach(l => rings(l.geometry).forEach(ring => focus.push(...ring)))
  if (r.point) focus.push([r.point.lon, r.point.lat])
  if (r.point?.waypoint) focus.push([r.point.waypoint.lon, r.point.waypoint.lat])
  if (!focus.length) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of focus) {
    minX = Math.min(minX, x!); maxX = Math.max(maxX, x!)
    minY = Math.min(minY, y!); maxY = Math.max(maxY, y!)
  }
  const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180)
  const spanX = Math.max((maxX - minX) * kx, 0.00008)
  const spanY = Math.max(maxY - minY, 0.00008)
  const scale = Math.min((MW - 2 * PAD) / (spanX * 1.35), (MH - 2 * PAD) / (spanY * 1.35))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const px = (lon: number, lat: number): [number, number] => [MW / 2 + (lon - cx) * kx * scale, MH / 2 - (lat - cy) * scale]
  const path = (g: GeoJsonGeometry) =>
    rings(g).map(ring => ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${px(lon!, lat!).map(v => v.toFixed(1)).join(',')}`).join('') + 'Z').join('')

  return {
    neighbours: r.neighbours.map(path),
    lots: r.lots.map(l => ({ cadid: l.cadid, d: path(l.geometry) })),
    point: r.point ? px(r.point.lon, r.point.lat) : null,
    way: r.point?.waypoint ? px(r.point.waypoint.lon, r.point.waypoint.lat) : null,
  }
})
</script>

<style scoped>
.tr { display: grid; gap: 1rem; }

.tr-search { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem 1.1rem; }
.tr-label { display: block; margin-bottom: 0.35rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.tr-input-wrap { position: relative; }
.tr-input { width: 100%; box-sizing: border-box; padding: 0.6rem 0.8rem; border: 1px solid #e2e8f0; border-radius: 8px; font: inherit; font-size: 0.95rem; }
.tr-input:focus { outline: none; border-color: #15803d; box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.12); }
.tr-matches { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; right: 0; margin: 0; padding: 0.25rem; list-style: none; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1); max-height: 320px; overflow-y: auto; }
.tr-match { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.45rem 0.6rem; border-radius: 6px; font-size: 0.85rem; cursor: pointer; }
.tr-match--on, .tr-match:hover { background: #f1f5f9; }
.tr-kind { font-size: 0.72rem; color: #64748b; white-space: nowrap; }
.tr-hint { margin: 0.5rem 0 0; font-size: 0.8rem; color: #92400e; }
.tr-examples { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-top: 0.75rem; }
.tr-examples-label { font-size: 0.75rem; color: #64748b; margin-right: 0.2rem; }
.tr-example { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.65rem; border: 1px solid #e2e8f0; border-radius: 999px; background: #f8fafc; font: inherit; font-size: 0.78rem; color: #334155; cursor: pointer; }
.tr-example:hover { border-color: #15803d; color: #15803d; }
.tr-example-kind { font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }

.tr-status { margin: 0; font-size: 0.85rem; color: #64748b; }
.tr-status--error { color: #b91c1c; }

.tr-summary { margin: 0 0 1rem; padding: 0.8rem 1rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; font-size: 0.95rem; line-height: 1.55; color: #14532d; }

.tr-grid { display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
@media (max-width: 860px) { .tr-grid { grid-template-columns: 1fr; } }

.tr-map { margin: 0; position: sticky; top: 5.5rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.6rem; }
@media (max-width: 860px) { .tr-map { position: static; } }
.tr-map-svg { display: block; width: 100%; height: auto; background: #f8fafc; border-radius: 8px; }
.tr-map-neighbour { fill: #fff; stroke: #cbd5e1; stroke-width: 1; fill-rule: evenodd; }
.tr-map-lot { fill: rgba(42, 120, 214, 0.18); stroke: #2a78d6; stroke-width: 2; fill-rule: evenodd; }
.tr-map-access { stroke: #0f172a; stroke-width: 1.5; stroke-dasharray: 4 3; }
.tr-map-way { fill: #fff; stroke: #0f172a; stroke-width: 2; }
.tr-map-point { fill: #eb6834; stroke: #fff; stroke-width: 2; }
.tr-map-empty { margin: 0; padding: 2rem; text-align: center; color: #64748b; font-size: 0.85rem; }
.tr-map-legend { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; margin-top: 0.5rem; font-size: 0.72rem; color: #475569; }
.tr-map-legend span { display: inline-flex; align-items: center; gap: 0.3rem; }
.tr-key { display: inline-block; width: 12px; height: 12px; }
.tr-key--lot { background: rgba(42, 120, 214, 0.18); border: 2px solid #2a78d6; }
.tr-key--point { border-radius: 50%; background: #eb6834; }
.tr-key--way { border: 2px solid #0f172a; background: #fff; width: 9px; height: 9px; }
.tr-key--neighbour { border: 1px solid #cbd5e1; background: #fff; }

.tr-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
.tr-step { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.85rem 1rem; }
.tr-step :deep(.tr-step-head) { display: flex; gap: 0.7rem; align-items: flex-start; margin-bottom: 0.55rem; }
.tr-step :deep(.tr-step-n) { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.75rem; font-weight: 700; }
.tr-step :deep(.tr-step-titles) { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.tr-step :deep(.tr-step-title) { font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.tr-step :deep(.tr-step-table) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; font-size: 0.74rem; color: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.tr-step :deep(.tr-step-dot) { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.tr-step :deep(.tr-step-via) { color: #64748b; }

.tr-kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; font-size: 0.84rem; }
.tr-kv dt { color: #64748b; }
.tr-kv dd { margin: 0; color: #0f172a; min-width: 0; overflow-wrap: anywhere; }
.tr-kv code, .tr-lots code, .tr-table code { font-size: 0.8rem; }
.tr-inline-code { margin-right: 0.4rem; }
.tr-note { margin: 0 0 0.45rem; font-size: 0.82rem; color: #475569; }
.tr-miss { margin: 0; font-size: 0.84rem; color: #92400e; }
.tr-lots { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; }
.tr-lots li { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.84rem; }
.tr-lot-id { background: #eff6ff; color: #1e3a8a; padding: 0.1rem 0.4rem; border-radius: 5px; }
.tr-lot-type { color: #475569; }
.tr-flag { font-size: 0.72rem; font-weight: 700; color: #92400e; background: #fef3c7; padding: 0.05rem 0.4rem; border-radius: 999px; }
.tr-agree { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.74rem; font-weight: 700; padding: 0.05rem 0.45rem; border-radius: 999px; }
.tr-agree--yes { color: #166534; background: #dcfce7; }
.tr-agree--no { color: #92400e; background: #fef3c7; }

.tr-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.tr-table th { text-align: left; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #64748b; padding: 0.3rem 0.5rem 0.3rem 0; }
.tr-table td { padding: 0.35rem 0.5rem 0.35rem 0; border-top: 1px solid #f1f5f9; color: #0f172a; }

.tr-siblings { margin-top: 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.75rem 1rem; }
.tr-siblings summary { cursor: pointer; font-size: 0.88rem; font-weight: 700; color: #0f172a; }
.tr-siblings .tr-table { margin-top: 0.6rem; }
.tr-lot-row { cursor: pointer; }
.tr-lot-row:hover td { background: #f8fafc; }
.tr-sibling { cursor: pointer; }
.tr-sibling:hover td { background: #f8fafc; }
.tr-sibling--on td { background: #f0fdf4; font-weight: 600; }
</style>
