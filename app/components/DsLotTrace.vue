<!--
  <DsLotTrace>

  "Trace a lot" on /datasources: type a lot reference and see the land itself,
  the properties built on it, every address on them, and what every planning
  layer says about it - the ones that cover it, with how much of the lot each
  covers, and the ones that were checked and do not. The address trace reads the
  chain downwards; this reads it up.

  Search and trace come from /api/datasources/nsw-lot. The page owns which lot is
  shown - it passes one in and is told when this panel traces another - so that
  the URL can be kept in step without the router, which would scroll the reader
  to the top of the page on every click.
-->

<template>
  <div class="lt">
    <div class="lt-search">
      <label class="lt-label" for="lt-input">Lot or plan</label>
      <div class="lt-input-wrap">
        <input
          id="lt-input"
          v-model="query"
          type="text"
          class="lt-input"
          placeholder="e.g. 17//DP10140, 20/36/DP758002, //SP998 or DP10140"
          autocomplete="off"
          @input="onInput"
          @keydown.down.prevent="moveActive(1)"
          @keydown.up.prevent="moveActive(-1)"
          @keydown.enter.prevent="pickActive"
          @keydown.escape="matches = []"
          @blur="closeSoon"
        >
        <ul v-if="matches.length" class="lt-matches" role="listbox">
          <li
            v-for="(m, i) in matches"
            :key="m.cadid"
            role="option"
            :aria-selected="i === active"
            class="lt-match"
            :class="{ 'lt-match--on': i === active }"
            @mousedown.prevent="traceCadid(m.cadid, m.lotidstring, m.note)"
          >
            <span><code>{{ m.lotidstring }}</code></span>
            <span v-if="m.note" class="lt-match-note">{{ m.note }}</span>
          </li>
        </ul>
      </div>
      <p v-if="hint" class="lt-hint">{{ hint }}</p>
      <div class="lt-examples">
        <span class="lt-examples-label">Try</span>
        <button v-for="ex in EXAMPLES" :key="ex.q" type="button" class="lt-example" @click="runExample(ex.q)">
          <span class="lt-example-kind">{{ ex.kind }}</span>{{ ex.q }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="lt-status">Tracing…</p>
    <p v-else-if="error" class="lt-status lt-status--error">{{ error }}</p>

    <div v-if="result && !loading" class="lt-result">
      <p class="lt-summary">{{ summary }}</p>
      <p v-if="resolvedNote" class="lt-resolved">{{ resolvedNote }}</p>

      <div class="lt-grid">
        <figure class="lt-map">
          <svg v-if="map" :viewBox="`0 0 ${MW} ${MH}`" class="lt-map-svg" role="img" :aria-label="`Shape of lot ${result.lot.lotidstring}`">
            <defs><clipPath id="lt-clip"><rect :width="MW" :height="MH" /></clipPath></defs>
            <g clip-path="url(#lt-clip)">
              <path v-for="(d, i) in map.neighbours" :key="`n${i}`" :d="d" class="lt-map-neighbour" />
              <path :d="map.lot" class="lt-map-lot" />
            </g>
          </svg>
          <figcaption class="lt-map-legend">
            <span><i class="lt-key lt-key--lot" />this lot</span>
            <span><i class="lt-key lt-key--neighbour" />neighbouring lots</span>
          </figcaption>
        </figure>

        <ol class="lt-steps">
          <li class="lt-step">
            <LotStepHead n="1" table="cadastre.lot" title="The lot" />
            <dl class="lt-kv">
              <dt>Lot reference</dt><dd><code>{{ result.lot.lotidstring }}</code></dd>
              <dt>cadid</dt><dd><code>{{ result.lot.cadid }}</code></dd>
              <dt>Kind</dt><dd>{{ code('classsubtype', result.lot.classsubtype) }}</dd>
              <dt>Title status</dt><dd>{{ code('itstitlestatus', result.lot.itstitlestatus) }}</dd>
              <dt>Area</dt>
              <dd>
                {{ area(result.lot.areaM2) }} measured
                <template v-if="result.lot.planLotArea">· {{ planArea(result.lot.planLotArea, result.lot.planLotAreaUnits) }} on the plan</template>
              </dd>
              <dt>Perimeter</dt><dd>{{ result.lot.perimeterM?.toLocaleString('en-AU') }} m</dd>
              <dt>Setting</dt><dd>{{ code('urbanity', result.lot.urbanity) }}</dd>
              <template v-if="result.lot.startDate"><dt>In the map since</dt><dd>{{ fmtDate(result.lot.startDate) }}</dd></template>
            </dl>
          </li>

          <li class="lt-step">
            <LotStepHead n="2" table="guras.propertylot" title="What is built on it" via="propertylot.cadid = lot.cadid" />
            <p class="lt-note">
              {{ plural(result.propertyLotCounts.ordinary, 'ordinary lot record') }},
              {{ plural(result.propertyLotCounts.unit, 'strata unit lot') }},
              {{ plural(result.propertyLotCounts.common, 'common property row') }}.
            </p>
            <p v-if="!result.properties.length" class="lt-miss">No property is recorded on this lot.</p>
            <table v-else class="lt-table">
              <thead><tr><th>Property</th><th>Main address</th><th>Kind</th><th>Lots</th></tr></thead>
              <tbody>
                <tr v-for="p in result.properties" :key="p.propid">
                  <td><code>{{ p.propid }}</code></td>
                  <td>{{ p.address || 'no address' }}</td>
                  <td>{{ code('valnetpropertytype', p.valnetType) }}</td>
                  <td>{{ p.valnetLotCount ?? '' }}</td>
                </tr>
              </tbody>
            </table>
          </li>

          <li class="lt-step">
            <LotStepHead n="3" table="guras.addressstring" title="Addresses on it" via="addressstring.propid = propertylot.propid" />
            <p class="lt-note">
              {{ plural(result.addresses.total, 'address') }} on this land, and
              {{ plural(result.pointsInside, 'address point') }} inside the lot boundary.
            </p>
            <div v-if="result.addresses.rows.length" class="lt-scroll">
            <table class="lt-table">
              <thead><tr><th>Address</th><th>Type</th><th>Strata lot</th></tr></thead>
              <tbody>
                <tr v-for="a in result.addresses.rows" :key="a.msoid" class="lt-addr" @click="$emit('trace-address', a.msoid)">
                  <td>{{ a.address }}</td>
                  <td>{{ code('principaladdresstype', a.principalType) }}</td>
                  <td><code v-if="a.titleLot">{{ a.titleLot }}</code></td>
                </tr>
              </tbody>
            </table>
            </div>
            <p v-if="result.addresses.total > result.addresses.rows.length" class="lt-note">Showing the first {{ result.addresses.rows.length }}. Click an address to trace it.</p>
            <p v-else-if="result.addresses.rows.length" class="lt-note">Click an address to trace it.</p>
          </li>

          <li class="lt-step">
            <LotStepHead n="4" table="epi planning layers" title="Controls over it" via="the layer and the lot overlap" />
            <p class="lt-note">
              All {{ result.controls.length + result.otherLayers.length }} planning layers were checked against this lot.
              {{ plural(result.controls.length, 'layer') }} cover it.
            </p>
            <p v-if="!result.controls.length" class="lt-miss">No planning layer in this data covers this lot.</p>

            <template v-for="group in controlGroups" :key="group.title">
              <h4 class="lt-group">{{ group.title }}</h4>
              <table class="lt-table">
                <thead><tr><th>Control</th><th>Value</th><th>Covers</th><th>Instrument</th></tr></thead>
                <tbody>
                  <template v-for="c in group.controls" :key="c.key">
                    <tr v-for="(v, i) in c.values" :key="c.key + i">
                      <td>{{ i === 0 ? c.label : '' }}</td>
                      <td>
                        <strong v-if="v.value">{{ v.value }}{{ v.unit ? ` ${v.unit}` : '' }}</strong>
                        <em v-else class="lt-ctrl-plain">applies</em>
                        <span v-if="v.note && v.note !== v.value" class="lt-ctrl-note">{{ v.note }}</span>
                      </td>
                      <td class="lt-nowrap">{{ shareText(v.share) }}</td>
                      <td class="lt-instrument">{{ v.instrument }}</td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </template>

            <details v-if="result.otherLayers.length" class="lt-others">
              <summary>{{ plural(result.otherLayers.length, 'layer') }} checked, none of them covering this lot</summary>
              <div v-for="group in otherGroups" :key="group.title" class="lt-other-group">
                <span class="lt-other-title">{{ group.title }}</span>
                <span class="lt-other-names">
                  <span v-for="layer in group.layers" :key="layer.key" class="lt-other-name" :class="{ 'lt-other-name--empty': layer.empty }">
                    {{ layer.label }}<template v-if="layer.empty"> (no data in this download)</template>
                  </span>
                </span>
              </div>
            </details>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h } from 'vue'
import { CODE_LISTS, EPI_GROUPS, SCHEMA_COLOR, type GeoJsonGeometry, type LotMatch, type LotTrace, type SchemaKey } from '#shared/datasources-nsw'

const props = defineProps<{ focus: string | null }>()
const emit = defineEmits<{
  (e: 'trace-address', msoid: number): void
  (e: 'tracing'): void
  (e: 'traced', cadid: string): void
}>()

const EXAMPLES = [
  { kind: 'House lot', q: '17//DP10140' },
  { kind: 'Strata site', q: '//SP67869' },
  { kind: 'Strata unit lot', q: '38//SP67869' },
  { kind: 'With a section', q: '20/36/DP758002' },
  { kind: 'A whole plan', q: 'DP10140' },
]

const LotStepHead = defineComponent({
  props: { n: String, table: String, title: String, via: String },
  setup(p) {
    return () => {
      const schema = (p.table ?? '').split('.')[0] as SchemaKey
      return h('div', { class: 'lt-step-head' }, [
        h('span', { class: 'lt-step-n' }, p.n),
        h('div', { class: 'lt-step-titles' }, [
          h('span', { class: 'lt-step-title' }, p.title),
          h('span', { class: 'lt-step-table' }, [
            h('i', { class: 'lt-step-dot', style: { background: SCHEMA_COLOR[schema] ?? SCHEMA_COLOR.epi } }),
            p.table,
            p.via ? h('span', { class: 'lt-step-via' }, ` via ${p.via}`) : null,
          ]),
        ]),
      ])
    }
  },
})

const query = ref('')
const matches = ref<LotMatch[]>([])
const active = ref(0)
const hint = ref('')
const result = ref<LotTrace | null>(null)
const resolvedNote = ref('')
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
    const res = await $fetch<{ results: LotMatch[]; hint?: string }>('/api/datasources/nsw-lot', { query: { q: query.value } })
    if (token !== searchToken) return
    hint.value = res.hint ?? ''
    active.value = 0
    if (autoPick && res.results.length === 1) {
      matches.value = []
      traceCadid(res.results[0]!.cadid, res.results[0]!.lotidstring, res.results[0]!.note)
    } else {
      matches.value = res.results
    }
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
  if (m) traceCadid(m.cadid, m.lotidstring, m.note)
  else if (query.value.trim().length >= 3) runSearch(true)
}
function closeSoon() {
  setTimeout(() => { matches.value = [] }, 150)
}

async function traceCadid(cadid: string, label?: string, note?: string | null) {
  matches.value = []
  const token = ++traceToken
  loading.value = true
  error.value = ''
  resolvedNote.value = note ?? ''
  try {
    const res = await $fetch<LotTrace>('/api/datasources/nsw-lot', { query: { cadid } })
    if (token !== traceToken) return
    emit('tracing')                       // measure the anchor before the panel changes height
    result.value = res
    query.value = label ?? res.lot.lotidstring
    emit('traced', cadid)
  } catch (err: any) {
    if (token !== traceToken) return
    error.value = `Could not trace this lot: ${err?.data?.statusMessage ?? err?.message ?? err}`
  } finally {
    if (token === traceToken) loading.value = false
  }
}

onMounted(() => {
  if (props.focus) traceCadid(props.focus)
  else runExample(EXAMPLES[0]!.q)
})

// The page asks for a lot when the address trace hands one over.
watch(() => props.focus, (cadid) => {
  if (cadid && cadid !== result.value?.lot.cadid) traceCadid(cadid)
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
/** A boundary that grazes the lot rounds to zero, which reads as "not covered". Say what it is. */
function shareText(share: number | null): string {
  if (share == null) return ''
  if (share >= 1) return `${Math.round(share)}%`
  return share > 0 ? 'under 1%' : 'edge only'
}

/** The plan's own area, whose unit is written "Meters" for square metres and "Hectares" for hectares. */
function planArea(value: number, units: string | null): string {
  const unit = (units ?? '').toLowerCase()
  if (unit.startsWith('hect')) return `${value.toLocaleString('en-AU')} ha`
  return area(value)
}

function area(m2: number | null): string {
  if (m2 == null) return 'unknown'
  return m2 >= 10_000 ? `${(m2 / 10_000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString('en-AU')} m²`
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const summary = computed(() => {
  const r = result.value
  if (!r) return ''
  const units = r.propertyLotCounts.unit
  const addresses = r.addresses.total
  if (units > 0) {
    return `${r.lot.lotidstring} is the land under a strata building of ${plural(units, 'strata lot')}. `
      + `The units have no shape of their own, so all ${plural(addresses, 'address')} here sit on this one ${area(r.lot.areaM2)} shape.`
  }
  const props = r.properties.length
  if (!props) return `${r.lot.lotidstring} is ${area(r.lot.areaM2)} of land with no property recorded on it.`
  if (props === 1) {
    return `${r.lot.lotidstring} is ${area(r.lot.areaM2)} of land, held as one property`
      + `${r.properties[0]!.address ? ` addressed ${r.properties[0]!.address}` : ''}`
      + `${addresses > 1 ? `, carrying ${plural(addresses, 'address')}` : ''}.`
  }
  return `${r.lot.lotidstring} is ${area(r.lot.areaM2)} of land shared by ${plural(props, 'property')}, with ${plural(addresses, 'address')} between them.`
})

/** Both lists read in the order the Planning layers section uses. */
const GROUP_ORDER = EPI_GROUPS.map(g => g.title)
const byGroupOrder = (a: string, b: string) => {
  const ia = GROUP_ORDER.indexOf(a)
  const ib = GROUP_ORDER.indexOf(b)
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
}

const controlGroups = computed(() => {
  const groups = new Map<string, LotTrace['controls']>()
  for (const c of result.value?.controls ?? []) {
    const list = groups.get(c.group) ?? []
    list.push(c)
    groups.set(c.group, list)
  }
  return [...groups.entries()]
    .sort((a, b) => byGroupOrder(a[0], b[0]))
    .map(([title, controls]) => ({ title, controls }))
})

const otherGroups = computed(() => {
  const groups = new Map<string, LotTrace['otherLayers']>()
  for (const l of result.value?.otherLayers ?? []) {
    const list = groups.get(l.group) ?? []
    list.push(l)
    groups.set(l.group, list)
  }
  return [...groups.entries()]
    .sort((a, b) => byGroupOrder(a[0], b[0]))
    .map(([title, layers]) => ({ title, layers }))
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
  if (!r) return null
  const focus: number[][] = []
  rings(r.lot.geometry).forEach(ring => focus.push(...ring))
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
  return { lot: path(r.lot.geometry), neighbours: r.neighbours.map(path) }
})
</script>

<style scoped>
.lt { display: grid; gap: 1rem; }

.lt-search { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem 1.1rem; }
.lt-label { display: block; margin-bottom: 0.35rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.lt-input-wrap { position: relative; }
.lt-input { width: 100%; box-sizing: border-box; padding: 0.6rem 0.8rem; border: 1px solid #e2e8f0; border-radius: 8px; font: inherit; font-size: 0.95rem; }
.lt-input:focus { outline: none; border-color: #15803d; box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.12); }
.lt-matches { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; right: 0; margin: 0; padding: 0.25rem; list-style: none; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1); max-height: 320px; overflow-y: auto; }
.lt-match { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; padding: 0.45rem 0.6rem; border-radius: 6px; font-size: 0.85rem; cursor: pointer; }
.lt-match--on, .lt-match:hover { background: #f1f5f9; }
.lt-match-note { font-size: 0.72rem; color: #64748b; }
.lt-hint { margin: 0.5rem 0 0; font-size: 0.8rem; color: #92400e; }
.lt-examples { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-top: 0.75rem; }
.lt-examples-label { font-size: 0.75rem; color: #64748b; margin-right: 0.2rem; }
.lt-example { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.65rem; border: 1px solid #e2e8f0; border-radius: 999px; background: #f8fafc; font: inherit; font-size: 0.78rem; color: #334155; cursor: pointer; }
.lt-example:hover { border-color: #15803d; color: #15803d; }
.lt-example-kind { font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }

.lt-status { margin: 0; font-size: 0.85rem; color: #64748b; }
.lt-status--error { color: #b91c1c; }

.lt-summary { margin: 0 0 0.5rem; padding: 0.8rem 1rem; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; font-size: 0.95rem; line-height: 1.55; color: #1e3a8a; }
.lt-resolved { margin: 0 0 1rem; font-size: 0.82rem; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.5rem 0.75rem; }

.lt-grid { display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
@media (max-width: 860px) { .lt-grid { grid-template-columns: 1fr; } }

.lt-map { margin: 0; position: sticky; top: 5.5rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.6rem; }
@media (max-width: 860px) { .lt-map { position: static; } }
.lt-map-svg { display: block; width: 100%; height: auto; background: #f8fafc; border-radius: 8px; }
.lt-map-neighbour { fill: #fff; stroke: #cbd5e1; stroke-width: 1; fill-rule: evenodd; }
.lt-map-lot { fill: rgba(42, 120, 214, 0.18); stroke: #2a78d6; stroke-width: 2.5; fill-rule: evenodd; }
.lt-map-legend { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; margin-top: 0.5rem; font-size: 0.72rem; color: #475569; }
.lt-map-legend span { display: inline-flex; align-items: center; gap: 0.3rem; }
.lt-key { display: inline-block; width: 12px; height: 12px; }
.lt-key--lot { background: rgba(42, 120, 214, 0.18); border: 2px solid #2a78d6; }
.lt-key--neighbour { border: 1px solid #cbd5e1; background: #fff; }

.lt-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
.lt-step { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.85rem 1rem; }
.lt-step :deep(.lt-step-head) { display: flex; gap: 0.7rem; align-items: flex-start; margin-bottom: 0.55rem; }
.lt-step :deep(.lt-step-n) { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.75rem; font-weight: 700; }
.lt-step :deep(.lt-step-titles) { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.lt-step :deep(.lt-step-title) { font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.lt-step :deep(.lt-step-table) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; font-size: 0.74rem; color: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.lt-step :deep(.lt-step-dot) { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.lt-step :deep(.lt-step-via) { color: #64748b; }

.lt-kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; font-size: 0.84rem; }
.lt-kv dt { color: #64748b; }
.lt-kv dd { margin: 0; color: #0f172a; min-width: 0; overflow-wrap: anywhere; }
.lt-kv code, .lt-table code { font-size: 0.8rem; }
.lt-note { margin: 0 0 0.45rem; font-size: 0.82rem; color: #475569; }
.lt-miss { margin: 0; font-size: 0.84rem; color: #92400e; }
.lt-nowrap { white-space: nowrap; }

.lt-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.lt-table th { text-align: left; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #64748b; padding: 0.3rem 0.5rem 0.3rem 0; }
.lt-table td { padding: 0.35rem 0.5rem 0.35rem 0; border-top: 1px solid #f1f5f9; color: #0f172a; vertical-align: top; }
/* A strata building can carry dozens of addresses; keep the step readable. */
.lt-scroll { max-height: 320px; overflow-y: auto; border: 1px solid #f1f5f9; border-radius: 8px; padding: 0 0.5rem; }
.lt-scroll thead th { position: sticky; top: 0; background: #fff; }
.lt-addr { cursor: pointer; }
.lt-addr:hover td { background: #f8fafc; }
.lt-group { margin: 0.9rem 0 0.2rem; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.lt-group:first-of-type { margin-top: 0.5rem; }
.lt-ctrl-note { display: block; font-size: 0.74rem; color: #64748b; }
.lt-ctrl-plain { color: #475569; font-style: normal; }

.lt-others { margin-top: 1rem; border-top: 1px solid #f1f5f9; padding-top: 0.6rem; }
.lt-others summary { cursor: pointer; font-size: 0.8rem; font-weight: 600; color: #475569; }
.lt-others summary:hover { color: #0f172a; }
.lt-other-group { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 0.5rem; padding: 0.4rem 0; border-top: 1px solid #f8fafc; font-size: 0.78rem; }
@media (max-width: 620px) { .lt-other-group { grid-template-columns: 1fr; gap: 0.15rem; } }
.lt-other-title { color: #64748b; font-weight: 600; }
.lt-other-names { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; color: #475569; }
.lt-other-name--empty { color: #94a3b8; font-style: italic; }
.lt-instrument { color: #64748b; font-size: 0.76rem; }
</style>
