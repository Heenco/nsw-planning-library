<!--
  BuildControls - "what do you want to build?" first: a dropdown of every use the plans name, grouped by what the zone
  says about it on this lot, and for the one chosen, whether it is permissible and every development control on it.

  Data: /api/report/build-controls (RAG engine, shared/rag/evaluate.ts). Emits `trace` { use, topic } when a clause is
  clicked ('permissibility' for the verdict); the page shows the engine's trace.
-->
<template>
  <div class="bc">
    <p v-if="error" class="bc-error">{{ error }}</p>
    <p v-else-if="!data" class="bc-muted">Asking the plans what can be built here…</p>
    <p v-else-if="data.engine === 'none'" class="bc-note">{{ data.reason }}</p>
    <template v-else>
      <div class="bc-pick">
        <label for="bc-use" class="bc-pick-l">What do you want to build?</label>
        <select id="bc-use" v-model="use" class="bc-select">
          <optgroup v-for="g in groups" :key="g.key" :label="`${g.label} (${g.options.length})`">
            <option v-for="o in g.options" :key="o.use" :value="o.use">{{ cap(o.label) }}</option>
          </optgroup>
        </select>
        <span class="bc-count">{{ counts }}</span>
      </div>

      <p v-if="loading && !pick" class="bc-muted">Resolving every control…</p>
      <template v-if="pick">
        <!-- is it permissible -->
        <div class="bc-verdict" :class="'bc-verdict--' + verdictTone">
          <p class="bc-verdict-h">
            <b>{{ cap(pickLabel) }}</b> is <b>{{ verdictWords }}</b> in Zone {{ data.lot?.zone }} on this lot.
            <button type="button" class="bc-link" @click="emit('trace', { use: pick.use!, topic: 'permissibility' })">{{ pick.permission!.by.join(' and ') || 'see why' }}</button>
          </p>
          <p v-for="(s, i) in pick.permission!.steps" :key="i" class="bc-verdict-s">
            {{ s.winner }} prevails over {{ s.loser }}<span v-if="s.interpretive" class="bc-warn"> - a reading the text does not state, not yet verified</span>
          </p>
          <p v-if="pick.permission!.branches.length" class="bc-verdict-s">
            Turns on: {{ pick.permission!.branches.map(b => `${b.answer ?? 'no rule'} if ${b.if}`).join('; ') }}
          </p>
          <!-- the deciding clause is about a narrower kind: say so, so a detached-only prohibition does not read as a ban on every kind -->
          <p v-if="pick.permission!.narrower?.length" class="bc-verdict-s bc-warn">
            {{ pick.permission!.by.join(', ') }} is about {{ pick.permission!.narrower.join(', ') }} only - see each kind below.
          </p>
          <ul v-if="pick.permission!.kinds?.length" class="bc-kinds">
            <li v-for="k in pick.permission!.kinds" :key="k.use" :class="'bc-kind--' + (k.verdict === 'permitted' ? 'yes' : k.verdict === 'prohibited' ? 'no' : 'open')">
              <button type="button" class="bc-kind-btn" @click="use = k.use">{{ cap(k.label) }}</button>
              <b>{{ k.verdict === 'permitted' ? (k.consent === 'without' ? 'permitted without consent' : 'permitted with consent') : k.verdict === 'prohibited' ? 'prohibited' : 'depends' }}</b>
              <span class="bc-muted">{{ k.by.join(', ') }}</span>
            </li>
          </ul>
          <!-- the prohibition's own "unless" list, read from the clause and tested on the lot -->
          <div v-if="pick.permission!.exceptions" class="bc-exc">
            <p class="bc-exc-h">
              {{ pick.permission!.exceptions.clause }} applies <i>unless</i> the land meets one of these -
              <b>{{ pick.permission!.exceptions.outcome === 'stands' ? 'this lot meets none, so it stands' : pick.permission!.exceptions.outcome === 'lifted' ? 'this lot meets one, so it does not apply here' : 'not every one can be tested' }}</b>
            </p>
            <ul>
              <li v-for="(it, i) in pick.permission!.exceptions.items" :key="i">
                <span :class="it.met === true ? 'bc-ok' : it.met === false ? 'bc-no' : 'bc-warn'">{{ it.met === true ? '✓' : it.met === false ? '✗' : '?' }}</span>
                {{ it.text }} <span class="bc-muted">- {{ it.how }}</span>
              </li>
            </ul>
            <p class="bc-muted bc-exc-note">
              Read from the clause’s own words and tested on the lot{{ pick.permission!.exceptions.engineHas ? ' - the engine holds these exceptions too.' : '; the engine was given this prohibition without its exceptions.' }}
            </p>
          </div>
        </div>

        <!-- every control -->
        <table v-if="pick.controls.length" class="bc-table" :class="{ 'bc-table--no': pick.permission!.verdict === 'prohibited' && !byKind }">
          <thead><tr><th>Control</th><th>For {{ pickLabel }}</th><th>Set by</th><th>This lot</th></tr></thead>
          <tbody>
            <template v-for="c in pick.controls" :key="c.key">
            <tr :class="{ 'bc-has-why': c.why.length }">
              <th scope="row">{{ c.label }}</th>
              <td class="bc-val" :class="{ open: c.verdict !== 'decided', sepp: c.sepp }">
                <template v-if="c.verdict === 'decided'">
                  {{ fmt(c.key, c.value, c.unit) }}
                  <small v-if="c.expr">{{ c.expr.replace(/m2/g, 'm²').replace(/ x /g, ' × ') }}</small>
                </template>
                <template v-else-if="c.candidates.length">
                  depends
                  <!-- a floor area in contention is often still a ratio (the clauses compete before the site area is applied) -->
                  <small>{{ [...new Set(c.candidates.map(x => fmt(c.key === 'floor_area' && x.unit !== 'm2' ? 'fsr' : c.key, x.value, x.unit)))].join(', ') }} in contention</small>
                </template>
                <template v-else-if="c.branches.length">
                  depends
                  <small>{{ [...new Set(c.branches.map(b => b.answer ? fmtAns(c.key, b.answer) : 'no limit'))].join(' or ') }}</small>
                </template>
                <template v-else>not set</template>
              </td>
              <td class="bc-by">
                <button v-if="c.by.length" type="button" class="bc-link" @click="emit('trace', { use: pick.use!, topic: c.key })">{{ c.by.join(', ') }}</button>
                <button v-else type="button" class="bc-link" @click="emit('trace', { use: pick.use!, topic: c.key })">see why</button>
                <span v-if="c.sepp" class="bc-tag bc-tag--sepp">SEPP</span>
                <span v-if="c.nonDiscretionary" class="bc-tag" title="Non-discretionary: if it is met, consent cannot be refused on this ground">ND</span>
                <small v-for="(s, i) in c.steps" :key="i">prevails over {{ s.loser }}<span v-if="s.interpretive" class="bc-warn"> (reading not verified)</span></small>
                <small v-if="c.branches.length" class="bc-warn">turns on: {{ turnsOn(c) }}</small>
                <small v-if="c.otherBands.length" class="bc-bands">
                  other bands, not this lot: <span v-for="(b, i) in c.otherBands" :key="i">{{ fmt(c.key, b.value, b.unit) }} for {{ b.band }}</span>
                </small>
              </td>
              <td class="bc-lot">
                <template v-if="lotCheck(c)">
                  <span :class="lotCheck(c)!.ok ? 'bc-ok' : 'bc-no'">{{ lotCheck(c)!.ok ? '✓' : '✗' }}</span> {{ lotCheck(c)!.text }}
                </template>
              </td>
            </tr>
            <!-- why a figure is not settled: each clause in contention, what its own words limit it to, and whether this lot meets it -->
            <tr v-if="c.why.length" class="bc-why-row">
              <td colspan="4">
                <p class="bc-why-h">Why this is not settled</p>
                <ul class="bc-why">
                  <li v-for="(w, i) in c.why" :key="i" :class="w.reaches === false ? 'out' : w.reaches ? 'in' : 'open'">
                    <span class="bc-why-mark">{{ w.reaches === false ? '✗' : w.reaches ? '✓' : '?' }}</span>
                    <b>{{ w.label }}</b> {{ fmt(c.key === 'floor_area' && w.unit !== 'm2' ? 'fsr' : c.key, w.value, w.unit) }} -
                    <template v-if="w.limits.length">its text limits it to {{ w.limits.map(l => l.text).join('; and to ') }}</template>
                    <template v-else>no limit in its text - it applies to this lot</template>
                    <em v-if="!w.engineTested && w.limits.length"> · the engine was given this clause without these conditions</em>
                  </li>
                </ul>
                <p v-if="c.likely" class="bc-why-likely">
                  Setting aside the clauses whose own words exclude this lot:
                  <b>{{ likelyText(c) }}</b> ({{ c.likely.by.join(', ') }}).
                  This is read from the clauses’ text, not decided by the engine - the clauses reached the engine without these conditions, a gap in the RAG extraction.
                </p>
                <p v-else class="bc-why-likely">
                  The clauses’ own words do not narrow it to one figure here{{ c.why.some(w => w.limits.some(l => l.kind === 'discretion')) ? ' - part of it rests on the consent authority’s judgement' : '' }}.
                </p>
              </td>
            </tr>
            </template>
          </tbody>
        </table>
        <p v-else class="bc-muted">No development standard in the plans reaches {{ pickLabel }} on this lot.</p>

        <!-- what else the permission carries -->
        <template v-if="otherConditions.length">
          <h4 class="bc-h4">Other conditions on the permission</h4>
          <ul class="bc-conds">
            <li v-for="(c, i) in otherConditions" :key="i" :class="'bc-c--' + c.status.replace(' ', '-')">
              <b>{{ c.label }}</b><span v-if="c.detail">: {{ c.detail }}</span> <em>{{ c.status }}</em>
            </li>
          </ul>
        </template>

        <!-- where the lot sits in a mapped area that reaches this use -->
        <template v-if="pick.areas.length">
          <h4 class="bc-h4">Mapped areas on this lot that reach {{ pickLabel }}</h4>
          <div class="bc-areas">
            <div v-for="a in pick.areas" :key="a.map + a.label" class="bc-area">
              <svg :viewBox="areaBox(a)" class="bc-area-map">
                <g transform="scale(1 -1)">
                  <polygon v-for="(r, i) in a.areaRings" :key="i" :points="pts(r)" class="bc-area-poly" />
                  <polygon :points="pts(a.lotRing)" class="bc-area-lot" />
                </g>
              </svg>
              <div>
                <p class="bc-area-h"><b>{{ cap(a.label) }}</b> on the {{ mapName(a.map) }} Map <span class="bc-muted">· {{ a.coverPct }}% of the lot</span></p>
                <ul class="bc-area-claims">
                  <li v-for="(c, i) in a.claims" :key="i"><b>{{ c.label }}</b><span v-if="c.heading" class="bc-muted"> {{ c.heading }}</span> - {{ claimWords(c) }}</li>
                </ul>
              </div>
            </div>
          </div>
        </template>
      </template>
      <p class="bc-foot">
        The RAG engine over {{ data.plan }} and the SEPPs. The list holds every use the plans’ Dictionary defines and a clause names;
        each control is the figure that wins for that use on this lot once the plans’ precedence is applied. Click a clause for the full trace.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { BuildArea, BuildControl, BuildResponse } from '../../server/api/report/build-controls.get'

const props = defineProps<{ cadid: string }>()
/** `use` - the chosen use (the engine's key and the Dictionary's spelling), so the page can site the same thing */
const emit = defineEmits<{ trace: [{ use: string; topic: string }]; use: [{ use: string; label: string }] }>()

const data = ref<BuildResponse | null>(null)
const pick = ref<BuildResponse | null>(null)
const error = ref('')
const loading = ref(false)
const use = ref<string>('')

watch(() => props.cadid, async (id) => {
  data.value = null; pick.value = null; error.value = ''; use.value = ''
  if (!id) return
  try {
    const r = await $fetch<BuildResponse>('/api/report/build-controls', { query: { cadid: id } })
    if (props.cadid !== id) return
    data.value = r
    // start on the first kind of housing this lot permits (an MU1 lot that bars dwelling houses opened on "advertising
    // structure", the first permitted use alphabetically), else the first use permitted at all
    const HOUSING = ['dwelling house', 'dual occupancy', 'semi-detached dwelling', 'multi dwelling housing', 'residential flat building', 'shop top housing']
    use.value = HOUSING.map(h => r.options.find(o => o.label.toLowerCase() === h && o.verdict === 'permitted')?.use).find(Boolean)
      ?? r.options.find(o => o.verdict === 'permitted')?.use ?? r.options[0]?.use ?? ''
  } catch (e: any) { error.value = e?.data?.message || e?.message || 'Could not ask the plans.' }
}, { immediate: true })

watch(use, async (u) => {
  if (!u) return
  emit('use', { use: u, label: data.value?.options.find(o => o.use === u)?.label ?? u })
  const id = props.cadid
  loading.value = true
  try {
    const r = await $fetch<BuildResponse>('/api/report/build-controls', { query: { cadid: id, use: u } })
    if (props.cadid === id && use.value === u) pick.value = r
  } catch (e: any) { error.value = e?.data?.message || e?.message || 'Could not resolve the controls.' }
  finally { loading.value = false }
})

const GROUPS = [
  { key: 'without', label: 'Permitted without consent' },
  { key: 'with', label: 'Permitted with consent' },
  { key: 'maybe', label: 'Depends' },
  { key: 'prohibited', label: 'Prohibited' },
] as const
const groupOf = (o: BuildResponse['options'][number]) => (o.verdict === 'permitted' ? (o.consent === 'without' ? 'without' : 'with') : o.verdict)
const groups = computed(() => GROUPS.map(g => ({ ...g, options: (data.value?.options ?? []).filter(o => groupOf(o) === g.key) })).filter(g => g.options.length))
const counts = computed(() => groups.value.map(g => `${g.options.length} ${g.label.toLowerCase()}`).join(' · '))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pickOption = computed(() => data.value?.options.find(o => o.use === pick.value?.use))
const pickLabel = computed(() => pickOption.value?.label ?? pick.value?.use ?? '')
/** the answer rests on a clause about one kind, and the kinds do not agree: the honest headline is "depends on the kind" */
const byKind = computed(() => {
  const p = pick.value?.permission
  return !!p?.narrower?.length && new Set((p.kinds ?? []).map(k => `${k.verdict}|${k.consent}`)).size > 1
})
const verdictTone = computed(() => (byKind.value ? 'open' : pick.value?.permission?.verdict === 'permitted' ? 'yes' : pick.value?.permission?.verdict === 'prohibited' ? 'no' : 'open'))
const verdictWords = computed(() => {
  const p = pick.value?.permission
  if (!p) return ''
  if (byKind.value) return 'different for each kind'
  return p.verdict === 'permitted' ? (p.consent === 'without' ? 'permitted without consent' : 'permitted with consent') : p.verdict === 'prohibited' ? 'prohibited' : 'undecided - it depends'
})

const TOPIC_UNIT: Record<string, string> = { height: 'm', lot_width: 'm', lot_size: 'm2', floor_area: 'm2' }
const num = (v: number) => (+v.toFixed(2)).toLocaleString('en-AU')
function fmt(topic: string, v: number | null | undefined, unit0: string | null | undefined): string {
  if (v == null) return '—'
  const unit = unit0 || TOPIC_UNIT[topic] || null
  if (topic === 'fsr' || unit === 'ratio') return `${num(v)}:1`
  if (unit === 'm2') return `${num(v)} m²`
  if (unit === 'm') return `${num(v)} m`
  if (unit === '%') return `${num(v)}%`
  return `${num(v)}${unit ? ` ${unit}` : ''}`
}
const fmtAns = (topic: string, a: string) => (/^[\d.]+$/.test(a.trim()) ? fmt(topic, Number(a), null) : a.replace(/\bm2\b/, 'm²'))
function turnsOn(c: BuildControl) {
  const facts = [...new Set(c.branches.map(b => b.if.replace(/^not /, '')))]
  const first = facts[0] ?? ''
  return `${first.length > 90 ? `${first.slice(0, 90)}…` : first}${facts.length > 1 ? ` (and ${facts.length - 1} more)` : ''}`
}
/** the figure the clauses' own words leave standing; a floor area left as a ratio is applied to the site area */
function likelyText(c: BuildControl) {
  const l = c.likely!
  if (c.key === 'floor_area' && l.unit !== 'm2' && l.value != null) {
    const a = data.value?.lot?.areaM2
    return `${fmt('fsr', l.value, null)}${a ? ` × ${Math.round(a).toLocaleString('en-AU')} m² = ${num(l.value * a)} m²` : ''}`
  }
  return fmt(c.key, l.value, l.unit)
}
/** a minimum the lot itself has to clear, measured against the lot */
function lotCheck(c: BuildControl) {
  const l = data.value?.lot
  if (c.verdict !== 'decided' || c.value == null || !l) return null
  if (c.key === 'lot_size' && l.areaM2 != null) return { ok: l.areaM2 >= c.value, text: `${Math.round(l.areaM2).toLocaleString('en-AU')} m²` }
  if (c.key === 'lot_width' && l.frontageM != null) return { ok: l.frontageM >= c.value, text: `${num(l.frontageM)} m frontage` }
  return null
}
/** the permission's conditions that are not already a row of the table */
const otherConditions = computed(() => (pick.value?.permission?.conditions ?? [])
  .filter(c => !/floor space ratio|building height|^maximum height|lot size|lot width|floor area|parking/i.test(c.label)))

const pts = (r: number[][]) => r.map(p => `${p[0]},${p[1]}`).join(' ')
const mapName = (s: string) => s.split(' ').map((w, i) => (i && ['of', 'on', 'the', 'and', 'for'].includes(w) ? w : cap(w))).join(' ')
function areaBox(a: BuildArea) {
  const xs = a.lotRing.map(p => p[0]!); const ys = a.lotRing.map(p => p[1]!)
  const pad = Math.max(12, (Math.max(...xs) - Math.min(...xs)) * 0.6)
  const x0 = Math.min(...xs) - pad; const x1 = Math.max(...xs) + pad
  const y0 = Math.min(...ys) - pad; const y1 = Math.max(...ys) + pad
  const s = Math.max(x1 - x0, y1 - y0)
  return `${(x0 + x1) / 2 - s / 2} ${-((y0 + y1) / 2) - s / 2} ${s} ${s}`
}
function claimWords(c: BuildArea['claims'][number]) {
  if (c.kind === 'standard') return `${(c.topic ?? 'standard').replace('_', ' ')} ${fmt(c.topic ?? '', c.value, c.unit)}`
  if (c.kind === 'permit') return 'permits it here'
  if (c.kind === 'prohibit') return 'prohibits it here'
  if (c.kind === 'frame') return 'the clause applies here'
  return c.kind
}
</script>

<style scoped>
.bc { display: flex; flex-direction: column; gap: 12px; }
.bc-error { color: #b91c1c; }
.bc-muted { color: var(--muted, #64748b); }
.bc-note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 8px; margin: 0; }
.bc-h4 { margin: 6px 0 0; font-size: 0.95rem; }
.bc-link { font: inherit; background: none; border: 0; padding: 0; color: var(--accent, #0f766e); text-decoration: underline; cursor: pointer; text-align: left; }
.bc-warn { color: #b45309; }
.bc-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--line, #e2e8f0); border-radius: 10px; background: var(--soft, #f8fafc); }
.bc-pick-l { font-weight: 700; }
.bc-select { font: inherit; font-size: 1rem; padding: 6px 10px; border-radius: 8px; border: 1px solid #94a3b8; min-width: 300px; background: #fff; }
.bc-count { font-size: 0.76rem; color: var(--muted, #64748b); }
.bc-verdict { border-radius: 10px; padding: 10px 14px; border: 1px solid; }
.bc-verdict p { margin: 0; }
.bc-verdict--yes { background: #f0fdf4; border-color: #86efac; }
.bc-verdict--no { background: #fef2f2; border-color: #fca5a5; }
.bc-verdict--open { background: #fffbeb; border-color: #fcd34d; }
.bc-verdict-h { font-size: 0.98rem; }
.bc-verdict-h .bc-link { margin-left: 6px; font-size: 0.82rem; }
.bc-verdict-s { font-size: 0.8rem; color: var(--muted, #64748b); margin-top: 4px !important; }
.bc-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; border: 1px solid var(--line, #e2e8f0); border-radius: 10px; overflow: hidden; }
.bc-table th, .bc-table td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--line, #e2e8f0); }
.bc-table thead th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted, #64748b); background: var(--soft, #f8fafc); }
.bc-table tbody th { font-weight: 600; white-space: nowrap; }
.bc-table--no tbody { opacity: 0.55; }
.bc-val { font-size: 1.15rem; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bc-val small { display: block; font-size: 0.74rem; font-weight: 400; color: var(--muted, #64748b); white-space: normal; }
.bc-val.open { color: #b45309; }
.bc-val.sepp { color: #6d28d9; }
.bc-by { font-size: 0.82rem; }
.bc-by small { display: block; color: var(--muted, #64748b); font-size: 0.74rem; margin-top: 2px; }
.bc-bands span + span::before { content: ' · '; }
.bc-tag { font-size: 0.66rem; font-weight: 700; padding: 0 6px; border-radius: 999px; border: 1px solid #cbd5e1; margin-left: 6px; color: #475569; }
.bc-tag--sepp { color: #6d28d9; border-color: #c4b5fd; background: #f5f3ff; }
.bc-lot { white-space: nowrap; font-size: 0.84rem; }
.bc-kinds { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.84rem; }
.bc-kinds li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; padding: 4px 8px; border-radius: 6px; background: #fff; border-left: 3px solid #cbd5e1; }
.bc-kind--yes { border-left-color: #16a34a !important; }
.bc-kind--no { border-left-color: #dc2626 !important; }
.bc-kind--open { border-left-color: #d97706 !important; }
.bc-kind-btn { font: inherit; background: none; border: 0; padding: 0; color: var(--accent, #0f766e); text-decoration: underline; cursor: pointer; }
.bc-exc { margin-top: 8px; padding: 8px 10px; background: #fff; border-radius: 8px; border: 1px solid #fde68a; font-size: 0.82rem; }
.bc-exc-h { margin: 0 0 4px !important; }
.bc-exc ul { margin: 0; padding-left: 4px; list-style: none; }
.bc-exc-note { margin: 4px 0 0 !important; font-size: 0.74rem; }
.bc-table tr.bc-has-why > * { border-bottom: 0; }
.bc-why-row td { background: #fffbeb; padding-top: 6px !important; }
.bc-why-h { margin: 0 0 4px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #92400e; font-weight: 700; }
.bc-why { list-style: none; margin: 0; padding: 0; font-size: 0.8rem; display: flex; flex-direction: column; gap: 3px; }
.bc-why li.out { color: #64748b; }
.bc-why li.out b { text-decoration: line-through; text-decoration-color: #94a3b8; }
.bc-why em { font-style: normal; color: #b45309; }
.bc-why-mark { display: inline-block; width: 16px; font-weight: 800; }
.bc-why li.in .bc-why-mark { color: #15803d; }
.bc-why li.out .bc-why-mark { color: #b91c1c; }
.bc-why li.open .bc-why-mark { color: #b45309; }
.bc-why-likely { margin: 6px 0 0; font-size: 0.82rem; color: #0f172a; }
.bc-ok { color: #15803d; font-weight: 800; }
.bc-no { color: #b91c1c; font-weight: 800; }
.bc-conds { margin: 0; padding-left: 18px; font-size: 0.84rem; }
.bc-conds em { font-style: normal; font-size: 0.72rem; color: var(--muted, #64748b); }
.bc-c--not-met em { color: #b91c1c; font-weight: 700; }
.bc-c--met em { color: #15803d; }
.bc-areas { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.bc-area { display: flex; gap: 10px; border: 1px solid var(--line, #e2e8f0); border-radius: 10px; padding: 8px; }
.bc-area-map { width: 100px; height: 100px; flex: none; background: #f8fafc; border-radius: 6px; }
.bc-area-poly { fill: rgba(124, 58, 237, 0.22); stroke: #7c3aed; stroke-width: 0.6; }
.bc-area-lot { fill: none; stroke: #0f172a; stroke-width: 1.4; }
.bc-area-h { margin: 0 0 4px; font-size: 0.86rem; }
.bc-area-claims { margin: 0; padding-left: 16px; font-size: 0.8rem; }
.bc-foot { font-size: 0.74rem; color: var(--faint, #94a3b8); margin: 0; }
@media (max-width: 700px) { .bc-select { min-width: 0; width: 100%; } .bc-table thead { display: none; } .bc-table tr { display: grid; } }
</style>
