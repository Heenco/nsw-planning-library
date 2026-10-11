<!--
  SitingStudio - pick a building type, get a first placement of it on the lot, move it, and see every control re-checked
  as you drag: a plan you can edit beside the craftbot 3D view of the same scheme.

  Data: /api/report/siting (the brief - RAG figures, DCP setbacks, the envelope - and the first placement). Everything
  after that runs here: shared/siting.mjs measures the blocks (checkSiting), design-scheme.mjs turns them into the
  craftbot model, and the viewer (public/craftbot-viewer, ?embed=1) is handed each new model with postMessage. Nothing
  goes back to the server while you drag.

  Emits `trace` with a RAG topic (height | fsr | floor_area | lot_size | lot_width | permissibility) when a figure's
  clause is clicked; the page shows the trace.
-->
<template>
  <div class="ss">
    <p v-if="error" class="ss-error">{{ error }}</p>
    <p v-else-if="!data" class="ss-muted">Working out what this lot allows…</p>
    <p v-else-if="data.engine === 'none'" class="ss-note">{{ data.reason }} Siting reads its controls from the RAG engine, which does not hold this lot’s plan yet.</p>
    <template v-else>
      <!-- 1. what is being sited: the use chosen in "What can I build", and whether the zone allows it -->
      <div class="ss-bar">
        <span class="ss-bar-h">Siting</span>
        <span class="ss-type ss-type--on" :class="{ 'ss-type--no': verdict?.verdict === 'prohibited', 'ss-type--maybe': verdict?.verdict === 'maybe' }" :title="verdict?.by.join('; ')">
          {{ cap(label || use) }}
          <small>{{ verdictWords }}</small>
        </span>
        <span class="ss-muted ss-small">change it in “What can I build” above</span>
        <button type="button" class="ss-reset" :disabled="!data.blocks.length" @click="reset">Reset placement</button>
        <span v-if="loading" class="ss-muted ss-small">updating…</span>
      </div>
      <p v-if="verdict?.verdict === 'prohibited'" class="ss-note ss-note--no">
        {{ cap(label || use) }} is prohibited on this lot ({{ verdict.by.join(', ') }}). The envelope and a massing are still drawn, so you can see what the controls would leave - but it cannot be built here.
      </p>

      <!-- 2. what the plans give this type, one line, each figure traceable -->
      <p class="ss-figs">
        <button type="button" class="ss-fig" @click="emit('trace', 'height')">Height <b>{{ fmt(brief.height) }} m</b> <span>{{ brief.sources.height }}</span></button>
        <button v-if="brief.gfaCap" type="button" class="ss-fig" @click="emit('trace', data.figures.floor_area?.value != null ? 'floor_area' : 'fsr')">
          Floor area <b>{{ Math.round(brief.gfaCap) }} m²</b> <span>{{ brief.gfaExpr }} · {{ brief.sources.fsr }}</span>
        </button>
        <button v-else type="button" class="ss-fig ss-fig--open" @click="emit('trace', 'fsr')">
          Floor area <b>{{ data.figures.fsr?.verdict === 'maybe' ? 'depends' : 'no FSR' }}</b> <span>{{ data.figures.fsr?.verdict === 'maybe' ? 'the plans’ figures compete - see why' : 'no ratio applies to this type here' }}</span>
        </button>
        <span class="ss-fig ss-fig--static">Setbacks <b>{{ fmt(brief.setbacks.front) }} / {{ fmt(brief.setbacks.side) }} / {{ fmt(brief.setbacks.rear) }} m</b> <span>front / side / rear · {{ setbackSource }}</span></span>
      </p>
      <p v-if="binding" class="ss-binding">
        <template v-if="binding.binds === 'floor area'">
          <b>Floor area limits this lot.</b> The setbacks and height leave room for about {{ binding.envelopeArea }} m² over {{ fitted.storeys }} storeys; the plans allow {{ binding.capArea }} m².
        </template>
        <template v-else-if="binding.capArea">
          <b>The envelope limits this lot.</b> The plans allow {{ binding.capArea }} m², but the setbacks and height leave room for about {{ binding.envelopeArea }} m².
        </template>
        <template v-else-if="data.figures.fsr?.verdict === 'maybe'">
          <b>Floor area is undecided here.</b> The plans’ floor-space figures compete (open “Floor area” to see them); the setbacks and the {{ fmt(brief.height) }} m height alone leave room for about {{ binding.envelopeArea }} m² over {{ fitted.storeys }} storeys.
        </template>
        <template v-else>
          <b>The envelope is the limit.</b> No floor space ratio applies, so the setbacks and the {{ fmt(brief.height) }} m height decide: about {{ binding.envelopeArea }} m² over {{ fitted.storeys }} storeys.
        </template>
      </p>
      <p v-if="data.note" class="ss-note">{{ data.note }}</p>

      <!-- 3. plan + 3D -->
      <div class="ss-stage">
        <div class="ss-plan">
          <svg ref="svgEl" :viewBox="view.box" class="ss-svg" @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp" @pointerdown.self="selected = null">
            <g :transform="view.flip">
              <polygon :points="pts(brief.lotPolygon)" class="ss-lot" />
              <polygon v-if="brief.buildablePolygon" :points="pts(brief.buildablePolygon)" class="ss-buildable" />
              <polygon v-for="o in scheme.open_space" :key="o.name" :points="pts(o.polygon)" class="ss-pos" />
              <rect v-for="p in scheme.parking" :key="p.name" :x="p.x - 1.3" :y="p.y - 2.7" width="2.6" height="5.4" class="ss-car" />
              <g v-for="b in blocks" :key="b.id">
                <rect :x="b.x0" :y="b.y0" :width="b.x1 - b.x0" :height="b.y1 - b.y0" class="ss-block" :class="['ss-block--' + b.dwelling, { 'ss-block--on': selected === b.id }]"
                  @pointerdown.stop="startDrag($event, b.id, 'move')" />
                <template v-if="selected === b.id">
                  <rect v-for="h in handles(b)" :key="h.k" :x="h.x - hs / 2" :y="h.y - hs / 2" :width="hs" :height="hs" class="ss-handle"
                    :style="{ cursor: h.cursor }" @pointerdown.stop="startDrag($event, b.id, h.k)" />
                </template>
              </g>
              <g v-for="s in check.setbacks" :key="s.role" class="ss-dim" :class="s.actual + 0.01 >= s.required ? 'ss-dim--ok' : 'ss-dim--no'">
                <line :x1="s.p[0]" :y1="s.p[1]" :x2="s.q[0]" :y2="s.q[1]" />
                <circle :cx="s.p[0]" :cy="s.p[1]" :r="hs / 4" /><circle :cx="s.q[0]" :cy="s.q[1]" :r="hs / 4" />
              </g>
            </g>
            <!-- text is drawn unflipped, at flipped positions -->
            <text v-for="e in edgeLabels" :key="'e' + e.i" :x="e.x" :y="e.y" class="ss-edge" :text-anchor="e.anchor">{{ e.text }}</text>
            <g v-for="s in check.setbacks" :key="'t' + s.role">
              <text :x="(s.p[0] + s.q[0]) / 2 + hs * 0.6" :y="view.Y((s.p[1] + s.q[1]) / 2)" class="ss-dimtext" :class="s.actual + 0.01 >= s.required ? 'ok' : 'no'">{{ fmt(s.actual, 1) }} m</text>
            </g>
            <text v-for="b in blocks" :key="'l' + b.id" :x="(b.x0 + b.x1) / 2" :y="view.Y((b.y0 + b.y1) / 2)" class="ss-blocktext" text-anchor="middle">
              <!-- a narrow block (a 4.8 m semi) gets its number, not its full name, and its size on two lines -->
              <tspan :x="(b.x0 + b.x1) / 2" dy="-0.6em">{{ b.x1 - b.x0 < 7 ? (b.name.match(/\d+$/)?.[0] ?? b.name.split('_')[0]) : b.name.replace(/_/g, ' ') }}</tspan>
              <tspan :x="(b.x0 + b.x1) / 2" dy="1.2em">{{ fmt(b.x1 - b.x0, 1) }} ×</tspan>
              <tspan :x="(b.x0 + b.x1) / 2" dy="1.2em">{{ fmt(b.y1 - b.y0, 1) }} m</tspan>
            </text>
            <text :x="view.cx" :y="view.streetY" class="ss-street" text-anchor="middle">STREET</text>
            <g :transform="`translate(${view.x0 + 1}, ${view.streetY})`">
              <line x1="0" y1="0" x2="5" y2="0" class="ss-scale" /><line x1="0" y1="-0.4" x2="0" y2="0.4" class="ss-scale" /><line x1="5" y1="-0.4" x2="5" y2="0.4" class="ss-scale" />
              <text x="2.5" y="-0.6" class="ss-scaletext" text-anchor="middle">5 m</text>
            </g>
          </svg>
          <div v-if="sel" class="ss-tools">
            <b>{{ sel.name.replace(/_/g, ' ') }}</b>
            <span class="ss-step">Storeys
              <button type="button" :disabled="sel.storeys <= 1" @click="setStoreys(sel, -1)">−</button>
              <em>{{ sel.storeys }}</em>
              <button type="button" :disabled="sel.storeys >= 4" @click="setStoreys(sel, 1)">+</button>
            </span>
            <label class="ss-step">Roof
              <select :value="sel.roof" @change="setRoof(sel, ($event.target as HTMLSelectElement).value)">
                <option v-for="r in ROOFS" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <span class="ss-muted ss-small">{{ Math.round((sel.x1 - sel.x0) * (sel.y1 - sel.y0) * sel.storeys) }} m² floor area · {{ fmt(blockTop(sel), 1) }} m high</span>
          </div>
          <p v-else class="ss-muted ss-small ss-hint">Click a building to move it, drag its handles to resize it, or change its storeys and roof.</p>
        </div>
        <div class="ss-3d">
          <iframe ref="frameEl" src="/craftbot-viewer/index.html?embed=1&style=solid" title="The scheme in 3D" class="ss-frame" @load="postModel" />
        </div>
      </div>

      <!-- 4. the checks -->
      <ul class="ss-checks">
        <li v-for="c in check.checks" :key="c.id" :class="'ss-c--' + c.status">
          <span class="ss-c-mark">{{ MARK[c.status] }}</span>
          <span class="ss-c-label">{{ c.label }}</span>
          <span class="ss-c-actual">{{ c.actual }}</span>
          <span class="ss-c-req">needs {{ c.required }}</span>
          <button v-if="TRACE[c.id]" type="button" class="ss-c-clause ss-link" @click="emit('trace', TRACE[c.id])">{{ c.clause }}</button>
          <span v-else class="ss-c-clause">{{ c.clause }}</span>
          <span v-if="c.detail?.length" class="ss-c-detail">{{ c.detail.join(' · ') }}</span>
        </li>
      </ul>
      <p class="ss-foot">
        Height, floor area, lot size and width come from the RAG engine over {{ data.plan }} and the SEPPs; setbacks, site coverage and landscaping
        from the council’s DCP as extracted, so those are marked advisory where the extraction is uncertain. The buildings are placeholders a
        designer would replace - the point is where the lines fall. Moving them is measured here, in your browser; nothing is saved.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { blockTop, checkSiting, fitStoreys, templateBlocks } from '#shared/siting.mjs'
import { schemeToModel } from '#shared/design-scheme.mjs'
import type { SitingResponse } from '../../server/api/report/siting.get'

/** `use` is the engine's key for the use chosen in "What can I build"; `label` is how the plans' Dictionary spells it */
const props = defineProps<{ cadid: string; use: string; label?: string }>()
const emit = defineEmits<{ trace: [topic: string] }>()

interface Block { id: string; name: string; dwelling: string; x0: number; y0: number; x1: number; y1: number; storeys: number; roof: string }

const ROOFS = ['hip', 'gable', 'skillion', 'flat']
const MARK: Record<string, string> = { pass: '✓', fail: '✗', warn: '!', na: '–' }
/** A check whose clause is a RAG figure opens that figure's trace. */
const TRACE: Record<string, string> = { height: 'height', fsr: 'fsr', lot_size: 'lot_size', lot_width: 'lot_width' }

const data = ref<SitingResponse | null>(null)
const error = ref('')
const loading = ref(false)
const blocks = ref<Block[]>([])
const selected = ref<string | null>(null)

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fmt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (+v.toFixed(d)).toString())

async function load() {
  if (!props.cadid || !props.use) return
  const [id, u] = [props.cadid, props.use]
  loading.value = true
  error.value = ''
  try {
    const r = await $fetch<SitingResponse>('/api/report/siting', { query: { cadid: id, type: u } })
    if (props.cadid !== id || props.use !== u) return            // a newer choice superseded this one
    data.value = r
    blocks.value = (r.blocks ?? []).map((b: any) => ({ ...b }))
    selected.value = null
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Could not load the siting brief.'
  } finally {
    loading.value = false
  }
}
// a new lot clears the view; a new use keeps the old one on screen until the new brief arrives
watch(() => props.cadid, () => { data.value = null; void load() })
watch(() => props.use, () => { void load() }, { immediate: true })

const verdict = computed(() => data.value?.types?.[0] ?? null)
const verdictWords = computed(() => {
  const v = verdict.value
  if (!v) return ''
  return v.verdict === 'permitted' ? (v.consent === 'without' ? 'permitted, no consent needed' : 'permitted with consent') : v.verdict === 'prohibited' ? 'prohibited' : 'depends'
})
function reset() {
  if (!data.value?.brief) return
  blocks.value = templateBlocks(props.use, data.value.brief, {}).blocks
  selected.value = null
}

const brief = computed(() => (data.value?.brief ?? null) as any)
const binding = computed(() => data.value?.binding ?? null)
const fitted = computed(() => fitStoreys(Number(brief.value?.height) || 8.5, 2))
const setbackSource = computed(() => {
  const c = brief.value?.setbackClauses ?? {}
  const held = [...new Set(Object.values(c).filter((x: any) => x && x !== 'default'))]
  return held.length ? `DCP cl ${held.join(', ')}` : 'defaults - no DCP control held'
})

// -- measuring, every change ----------------------------------------------------------------------------------------
const EMPTY = { checks: [], setbacks: [], scheme: { open_space: [], parking: [], masses: [], roofs: [] } }
const check = computed<any>(() => (brief.value && blocks.value.length ? checkSiting(blocks.value, brief.value) : EMPTY))
const scheme = computed<any>(() => check.value.scheme)
const sel = computed(() => blocks.value.find(b => b.id === selected.value) ?? null)

// -- the 3D, fed on every change -------------------------------------------------------------------------------------
const frameEl = ref<HTMLIFrameElement | null>(null)
let posted = 0
function postModel() {
  const w = frameEl.value?.contentWindow
  if (!w || !brief.value) return
  const b = brief.value
  const model = schemeToModel(scheme.value, { ...b, address: data.value?.address ?? props.cadid })
  w.postMessage({ type: 'craftbot:model', model }, location.origin)
  posted++
}
let raf = 0
watch([scheme, frameEl], () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(postModel) }, { deep: true })
function onMessage(ev: MessageEvent) { if (ev.origin === location.origin && ev.data?.type === 'craftbot:ready') postModel() }
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

// -- the plan --------------------------------------------------------------------------------------------------------
/** The lot's frame has the street on y = 0; the plan puts the street at the bottom, so y is flipped about the lot. */
const view = computed(() => {
  const ring = (brief.value?.lotPolygon ?? []) as number[][]
  const xs = ring.map(p => p[0])
  const ys = ring.map(p => p[1])
  const x0 = Math.min(...xs) - 4
  const x1 = Math.max(...xs) + 4
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pad = 4
  const H = y1 - y0 + pad * 2 + 4.5
  const Y = (y: number) => y1 + pad - (y - y0)   // local y -> svg y
  return {
    box: `${x0} 0 ${x1 - x0} ${H}`, x0, cx: (x0 + x1) / 2,
    flip: `matrix(1 0 0 -1 0 ${y1 + pad + y0})`,
    Y, streetY: Y(y0) + 4.2, scale: (x1 - x0),
  }
})
const hs = computed(() => Math.max(0.5, view.value.scale / 60))
const pts = (p: number[][] | null | undefined) => (p ?? []).map(q => `${q[0]},${q[1]}`).join(' ')

const ROLE_SHORT: Record<string, string> = { front: 'Front', rear: 'Rear', side: 'Side', secondary: 'Side street' }
const edgeLabels = computed(() => {
  const ring = (brief.value?.lotPolygon ?? []) as number[][]
  if (ring.length < 4) return []
  const n = ring.length - 1
  const roles = lotRoles()
  const cx = ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n
  const out: { i: number; x: number; y: number; text: string; anchor: string }[] = []
  // one label per boundary - front, rear, each side, a side street - on its longest edge
  const longest = new Map<string, { i: number; L: number }>()
  for (let i = 0; i < n; i++) {
    const a = ring[i]; const b = ring[(i + 1) % n]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const r = roles[i] ?? 'side'
    const key = r === 'side' ? `side${(a[0] + b[0]) / 2 < cx ? 'L' : 'R'}` : r
    if ((longest.get(key)?.L ?? -1) < L) longest.set(key, { i, L })
  }
  for (const [key, { i }] of longest) {
    const a = ring[i]; const b = ring[(i + 1) % n]
    const r = roles[i] ?? 'side'
    const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2
    const req = brief.value.setbacks?.[r] ?? brief.value.setbacks?.side
    const side = key === 'sideL' ? -1 : key === 'sideR' ? 1 : 0
    out.push({ i, x: mx + side * 1.2, y: view.value.Y(my) + (r === 'front' ? 1.8 : r === 'rear' ? -0.8 : 0),
      text: `${ROLE_SHORT[r] ?? r} ${fmt(req)} m`, anchor: side < 0 ? 'end' : side > 0 ? 'start' : 'middle' })
  }
  return out
})
function lotRoles(): string[] {
  const b = brief.value
  const ring = (b?.lotPolygon ?? []) as number[][]
  const n = ring.length - 1
  if (Array.isArray(b?.edgeRoles) && b.edgeRoles.length === n && !b.insetApprox) return b.edgeRoles
  const ys = ring.map(p => p[1]); const xs = ring.map(p => p[0])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return ring.slice(0, n).map((a, i) => {
    const c = ring[(i + 1) % n]
    const mx = (a[0] + c[0]) / 2; const my = (a[1] + c[1]) / 2
    return [['front', my - y0], ['rear', y1 - my], ['side', Math.min(mx - x0, x1 - mx)]].reduce((p: any, q: any) => (q[1] < p[1] ? q : p))[0] as string
  })
}

function handles(b: Block) {
  const xm = (b.x0 + b.x1) / 2; const ym = (b.y0 + b.y1) / 2
  // y is flipped on screen: y0 (nearest the street) is the bottom edge
  return [
    { k: 'sw', x: b.x0, y: b.y0, cursor: 'nesw-resize' }, { k: 'se', x: b.x1, y: b.y0, cursor: 'nwse-resize' },
    { k: 'nw', x: b.x0, y: b.y1, cursor: 'nwse-resize' }, { k: 'ne', x: b.x1, y: b.y1, cursor: 'nesw-resize' },
    { k: 's', x: xm, y: b.y0, cursor: 'ns-resize' }, { k: 'n', x: xm, y: b.y1, cursor: 'ns-resize' },
    { k: 'w', x: b.x0, y: ym, cursor: 'ew-resize' }, { k: 'e', x: b.x1, y: ym, cursor: 'ew-resize' },
  ]
}

// -- dragging --------------------------------------------------------------------------------------------------------
const svgEl = ref<SVGSVGElement | null>(null)
let drag: { id: string; mode: string; start: [number, number]; orig: Block } | null = null
/** Pointer position in the lot's own metres (the flip undone). */
function local(ev: PointerEvent): [number, number] {
  const svg = svgEl.value!
  const p = svg.createSVGPoint()
  p.x = ev.clientX; p.y = ev.clientY
  const m = svg.getScreenCTM()
  if (!m) return [0, 0]
  const s = p.matrixTransform(m.inverse())
  const ring = (brief.value?.lotPolygon ?? []) as number[][]
  const ys = ring.map(q => q[1])
  const y0 = Math.min(...ys); const y1 = Math.max(...ys)
  return [s.x, y1 + 4 + y0 - s.y]
}
function startDrag(ev: PointerEvent, id: string, mode: string) {
  selected.value = id
  const b = blocks.value.find(x => x.id === id)!
  drag = { id, mode, start: local(ev), orig: { ...b } }
  svgEl.value?.setPointerCapture?.(ev.pointerId)
}
const snap = (v: number) => Math.round(v * 10) / 10
function onMove(ev: PointerEvent) {
  if (!drag) return
  const [x, y] = local(ev)
  const dx = snap(x - drag.start[0]); const dy = snap(y - drag.start[1])
  const o = drag.orig
  const b = blocks.value.find(q => q.id === drag!.id)
  if (!b) return
  const MIN = 3
  if (drag.mode === 'move') { b.x0 = snap(o.x0 + dx); b.x1 = snap(o.x1 + dx); b.y0 = snap(o.y0 + dy); b.y1 = snap(o.y1 + dy); return }
  if (drag.mode.includes('w')) b.x0 = Math.min(snap(o.x0 + dx), o.x1 - MIN)
  if (drag.mode.includes('e')) b.x1 = Math.max(snap(o.x1 + dx), o.x0 + MIN)
  if (drag.mode.includes('s')) b.y0 = Math.min(snap(o.y0 + dy), o.y1 - MIN)
  if (drag.mode.includes('n')) b.y1 = Math.max(snap(o.y1 + dy), o.y0 + MIN)
}
function onUp() { drag = null }
function setStoreys(b: Block, d: number) { b.storeys = Math.max(1, Math.min(4, b.storeys + d)) }
function setRoof(b: Block, r: string) { b.roof = r }
</script>

<style scoped>
.ss { display: flex; flex-direction: column; gap: 10px; }
.ss-error { color: #b91c1c; }
.ss-muted { color: var(--muted, #64748b); }
.ss-small { font-size: 0.78rem; }
.ss-note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 8px; margin: 0; font-size: 0.86rem; }
.ss-note--no { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
span.ss-type { cursor: default; }
.ss-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ss-bar-h { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted, #64748b); font-weight: 600; }
.ss-type { font: inherit; font-size: 0.86rem; display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--line, #e2e8f0); background: #fff; cursor: pointer; line-height: 1.2; }
.ss-type small { font-size: 0.68rem; color: #15803d; }
.ss-type--maybe small { color: #b45309; }
.ss-type--no { opacity: 0.55; }
.ss-type--no small { color: #b91c1c; }
.ss-type--on { border-color: var(--ink, #0f172a); box-shadow: 0 0 0 1px var(--ink, #0f172a); }
.ss-seg { display: inline-flex; border: 1px solid var(--line, #e2e8f0); border-radius: 999px; overflow: hidden; }
.ss-seg button { font: inherit; font-size: 0.78rem; padding: 4px 12px; border: 0; background: #fff; cursor: pointer; }
.ss-seg button.on { background: var(--ink, #0f172a); color: #fff; }
.ss-reset { font: inherit; font-size: 0.78rem; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line, #e2e8f0); background: #fff; cursor: pointer; margin-left: auto; }
.ss-figs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.ss-fig { font: inherit; font-size: 0.82rem; text-align: left; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line, #e2e8f0); background: var(--soft, #f8fafc); cursor: pointer; display: inline-flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.ss-fig b { font-variant-numeric: tabular-nums; }
.ss-fig span { font-size: 0.72rem; color: var(--muted, #64748b); }
.ss-fig:hover { border-color: var(--ink, #0f172a); }
.ss-fig--open b { color: #b45309; }
.ss-fig--static { cursor: default; }
.ss-fig--static:hover { border-color: var(--line, #e2e8f0); }
.ss-binding { margin: 0; font-size: 0.9rem; padding: 8px 12px; border-left: 3px solid var(--accent, #0f766e); background: #f0fdfa; border-radius: 0 8px 8px 0; }
.ss-stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 900px) { .ss-stage { grid-template-columns: 1fr; } }
.ss-plan { border: 1px solid var(--line, #e2e8f0); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ss-svg { width: 100%; height: 440px; touch-action: none; user-select: none; background: #fbfdfb; border-radius: 6px; }
.ss-lot { fill: #fef3c7; stroke: #334155; stroke-width: 0.18; }
.ss-buildable { fill: #ffffff; stroke: #16a34a; stroke-width: 0.12; stroke-dasharray: 0.6 0.4; }
.ss-pos { fill: #bbf7d0; opacity: 0.7; }
.ss-car { fill: #cbd5e1; stroke: #94a3b8; stroke-width: 0.06; }
.ss-block { stroke-width: 0.14; cursor: move; }
.ss-block--A { fill: rgba(59, 130, 246, 0.35); stroke: #1d4ed8; }
.ss-block--B { fill: rgba(139, 92, 246, 0.35); stroke: #6d28d9; }
.ss-block--on { stroke-width: 0.3; }
.ss-handle { fill: #fff; stroke: var(--ink, #0f172a); stroke-width: 0.1; }
.ss-dim line { stroke-width: 0.1; stroke-dasharray: 0.3 0.2; }
.ss-dim--ok line, .ss-dim--ok circle { stroke: #15803d; fill: #15803d; }
.ss-dim--no line, .ss-dim--no circle { stroke: #dc2626; fill: #dc2626; }
.ss-dimtext { font-size: 1.05px; font-weight: 700; paint-order: stroke; stroke: #fff; stroke-width: 0.25px; }
.ss-dimtext.ok { fill: #15803d; }
.ss-dimtext.no { fill: #dc2626; }
.ss-edge { font-size: 0.95px; fill: #475569; font-weight: 600; }
.ss-blocktext { font-size: 0.95px; fill: #0f172a; pointer-events: none; font-weight: 600; }
.ss-street { font-size: 1px; letter-spacing: 0.3px; fill: #64748b; font-weight: 700; }
.ss-scale { stroke: #334155; stroke-width: 0.1; }
.ss-scaletext { font-size: 0.8px; fill: #334155; }
.ss-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 0.84rem; }
.ss-step { display: inline-flex; align-items: center; gap: 4px; }
.ss-step button { font: inherit; width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--line, #e2e8f0); background: #fff; cursor: pointer; }
.ss-step em { font-style: normal; font-weight: 700; min-width: 1.2em; text-align: center; }
.ss-step select { font: inherit; font-size: 0.82rem; padding: 2px 4px; border-radius: 6px; border: 1px solid var(--line, #e2e8f0); }
.ss-hint { margin: 0; }
.ss-3d { border: 1px solid var(--line, #e2e8f0); border-radius: 10px; overflow: hidden; min-height: 440px; background: #f1f5f9; }
.ss-frame { width: 100%; height: 100%; min-height: 480px; border: 0; display: block; }
.ss-checks { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line, #e2e8f0); border-radius: 10px; }
.ss-checks li { display: grid; grid-template-columns: 22px minmax(150px, 1.1fr) minmax(120px, 1fr) minmax(110px, 0.8fr) minmax(120px, 1fr); gap: 4px 10px; align-items: baseline; padding: 7px 10px; border-bottom: 1px solid var(--soft, #f8fafc); font-size: 0.84rem; }
.ss-checks li:last-child { border-bottom: 0; }
@media (max-width: 700px) { .ss-checks li { grid-template-columns: 22px 1fr; } .ss-c-actual, .ss-c-req, .ss-c-clause, .ss-c-detail { grid-column: 2; } }
.ss-c-mark { font-weight: 800; text-align: center; }
.ss-c--pass .ss-c-mark { color: #15803d; }
.ss-c--fail { background: #fef2f2; }
.ss-c--fail .ss-c-mark, .ss-c--fail .ss-c-actual { color: #b91c1c; }
.ss-c--warn .ss-c-mark { color: #b45309; }
.ss-c--na { color: var(--faint, #94a3b8); }
.ss-c-label { font-weight: 600; }
.ss-c-actual { font-variant-numeric: tabular-nums; }
.ss-c-req, .ss-c-clause { color: var(--muted, #64748b); font-size: 0.78rem; }
.ss-link { font: inherit; font-size: 0.78rem; background: none; border: 0; padding: 0; color: var(--accent, #0f766e); text-decoration: underline; cursor: pointer; text-align: left; }
.ss-c-detail { grid-column: 2 / -1; font-size: 0.74rem; color: var(--faint, #94a3b8); }
.ss-foot { font-size: 0.74rem; color: var(--faint, #94a3b8); margin: 0; }
</style>
