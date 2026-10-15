<!--
  /precinct - the Precinct SEPP bench (docs/precinct-sepp-pipeline.md).

  Pick a lot inside a Precinct SEPP (a sample, or any address) and see how the engine reads the chapter or appendix
  that governs it: every clause and subclause of that unit with its text, the claims the RAG build extracted from each,
  and what the engine made of each claim on THIS lot (holds / does not hold / unknown, and why), via /api/precinct/at
  with the precinct switch on. /report-2 does not use the switch yet; this page is where the idea is tested.
-->
<template>
  <div class="pc">
    <aside class="pc-side">
      <h1>Precinct SEPPs <span class="pc-tag">bench</span></h1>
      <form class="pc-search" @submit.prevent="pick(results[0])">
        <input v-model="q" type="search" placeholder="Any address or lot…" class="pc-input" />
        <ul v-if="results.length" class="pc-results">
          <li v-for="r in results" :key="r.cadid" @click="pick(r)">{{ r.address || '(no address)' }} <span class="pc-muted">{{ r.cadid }}</span></li>
        </ul>
      </form>
      <p class="pc-small pc-muted">Sample lots, from the state-wide build: two per governing unit, residential zones first.</p>
      <div v-for="(group, inst) in samplesByInstrument" :key="inst" class="pc-group">
        <p class="pc-group-t">{{ shortTitle(inst) }}</p>
        <button v-for="s in group" :key="s.cadid" type="button" class="pc-sample" :class="{ on: cadid === s.cadid }" @click="load(s.cadid)" :title="`${s.unit || '-'} ${s.heading || ''} · zone ${s.zone || '?'} · ${s.lots} lots in this unit`">
          <span class="pc-sample-a">{{ titleCase(s.address || s.cadid) }}</span>
          <span class="pc-sample-u">{{ s.unit || 'unit not held' }} · {{ (s.heading || '').replace(/^State significant precinct[—–-]\s*/, '') }} · {{ s.zone || '?' }}</span>
        </button>
      </div>
      <p v-if="!samples.length" class="pc-muted pc-small">loading samples…</p>
    </aside>

    <main class="pc-main">
      <p v-if="!cadid" class="pc-muted">Pick a lot on the left.</p>
      <p v-if="error" class="pc-error">{{ error }}</p>
      <template v-if="at">
        <section class="pc-card">
          <h2>{{ titleCase(at.lot.address || at.lot.cadid) }} <span class="pc-small pc-muted">{{ at.lot.cadid }} · zone {{ at.lot.zone || '?' }} · {{ at.lot.area_m2 ? Math.round(at.lot.area_m2) + ' m²' : '' }}</span></h2>
          <p><b>{{ at.governing.instrument || '(no instrument)' }}</b><template v-if="at.governing.heading"> · <b>{{ at.governing.unit }}</b> {{ at.governing.heading }}</template>
            <span class="pc-tag" :class="at.governing.inCorpus ? 'ok' : 'warn'">{{ at.governing.inCorpus ? 'in the RAG corpus' : 'not in the corpus' }}</span>
            <span v-if="at.lot.unit" class="pc-tag">{{ at.lot.unit.basis }}</span></p>
          <p class="pc-small pc-muted">{{ at.governing.why }}<template v-for="(u, t) in at.lot.units" :key="t"><template v-if="!u.governing"> · also mapped: {{ shortTitle(String(t)) }}<template v-if="u.cover != null"> ({{ u.cover }}%)</template></template></template></p>
          <form class="pc-ask" @submit.prevent="load(cadid)">
            <label>Read the use-dependent clauses for <input v-model="use" class="pc-input pc-input--s" list="pc-uses" /></label>
            <datalist id="pc-uses"><option v-for="u in USES" :key="u" :value="u" /></datalist>
            <label><select v-model="proposal" class="pc-input pc-input--s"><option value="development">development</option><option value="subdivision">subdivision</option></select></label>
            <button type="submit" class="pc-btn">Read</button>
          </form>
          <p class="pc-summary">
            <span><b>{{ at.summary.provisions }}</b> provisions in the unit</span>
            <span><b>{{ at.summary.withClaims }}</b> carry a claim</span>
            <span><b>{{ at.summary.claims }}</b> claims: <span class="pc-v pc-v--yes">{{ at.summary.yes }} hold</span> <span class="pc-v pc-v--no">{{ at.summary.no }} do not</span> <span class="pc-v pc-v--unknown">{{ at.summary.unknown }} unknown</span></span>
            <span class="pc-small pc-muted">by kind: {{ Object.entries(at.summary.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none' }}</span>
          </p>
          <p v-if="at.governing.inCorpus && !at.summary.byKind.permit && !at.summary.byKind.prohibit" class="pc-note">No permit or prohibit claim was extracted from this unit's Land Use Table: the table's zone groups are in the corpus, but the claims reader has not read them as permissions yet. That is a coverage gap of step 7, visible here on purpose.</p>
          <label class="pc-small"><input type="checkbox" v-model="onlyClaims" /> show only provisions that carry a claim</label>
        </section>

        <section class="pc-card">
          <h2>The unit, clause by clause</h2>
          <p v-if="!at.tree.length" class="pc-muted">No provisions: the governing instrument is not in the RAG corpus, or the lot's unit is not held.</p>
          <PrecinctNode v-for="n in at.tree" :key="n.id" :node="n" :only-claims="onlyClaims" :depth="0" />
        </section>

        <section class="pc-card">
          <h2>Other instruments that reach the lot <span class="pc-small pc-muted">{{ at.others.length }} claims</span></h2>
          <details v-if="at.others.length"><summary class="pc-small">show</summary>
            <ul class="pc-small">
              <li v-for="(o, i) in at.others" :key="i"><span class="pc-v" :class="'pc-v--' + h(o.claim.holds)">{{ h(o.claim.holds) }}</span> <b>{{ o.label }}</b> <span class="pc-muted">{{ o.claim.kind }}<template v-if="o.claim.uses.length"> · {{ o.claim.uses.join(', ') }}</template></span><br /><span class="pc-why">{{ o.claim.why.join(' · ') }}</span></li>
            </ul>
          </details>
        </section>
        <details class="pc-card"><summary>Raw response</summary><pre class="pc-pre">{{ JSON.stringify(at, null, 1).slice(0, 80000) }}</pre></details>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, h as vh, onMounted, ref, watch, defineComponent } from 'vue'
import type { PrecinctAtResponse, AuditNode } from '../../server/api/precinct/at.get'
import type { PrecinctSample } from '../../server/api/precinct/samples.get'

const USES = ['dwelling houses', 'dual occupancies', 'secondary dwellings', 'multi dwelling housing', 'residential flat buildings', 'seniors housing', 'shop top housing', 'neighbourhood shops', 'centre-based child care facilities', 'warehouse or distribution centres']
const q = ref(''), results = ref<any[]>([]), cadid = ref(''), error = ref(''), use = ref('dwelling houses'), proposal = ref<'development' | 'subdivision'>('development'), onlyClaims = ref(true)
const at = ref<PrecinctAtResponse | null>(null)
const samples = ref<PrecinctSample[]>([])
const samplesByInstrument = computed(() => { const g: Record<string, PrecinctSample[]> = {}; for (const s of samples.value) (g[s.instrument] ??= []).push(s); return g })
const shortTitle = (t: string) => t.replace('State Environmental Planning Policy', 'SEPP').replace(/\(Precincts[—–-]/, '(').replace(') 2021', ')')
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
const h = (v: boolean | null) => v === true ? 'yes' : v === false ? 'no' : 'unknown'
let timer: any
watch(q, (v) => { clearTimeout(timer); if (!v.trim()) { results.value = []; return }
  timer = setTimeout(async () => { try { results.value = ((await $fetch<any>('/api/lotprofile', { query: { q: v } })).results || []).slice(0, 8) } catch { results.value = [] } }, 250) })
function pick(r: any) { if (r?.cadid) { q.value = r.address || ''; results.value = []; load(String(r.cadid)) } }
async function load(id: string) {
  cadid.value = id; error.value = ''; at.value = null
  try { const r = await $fetch<PrecinctAtResponse>('/api/precinct/at', { query: { cadid: id, use: use.value, proposal: proposal.value } }); if (cadid.value === id) at.value = r }
  catch (e: any) { error.value = e?.data?.message || e?.message || 'failed' }
}
onMounted(async () => { try { samples.value = (await $fetch<{ samples: PrecinctSample[] }>('/api/precinct/samples')).samples } catch { samples.value = [] }
  const id = new URLSearchParams(location.search).get('cadid'); if (id) load(id) })

/** one provision and its children: heading, text, claims with the engine's verdict on this lot */
const PrecinctNode = defineComponent({
  name: 'PrecinctNode',
  props: { node: { type: Object as () => AuditNode, required: true }, onlyClaims: Boolean, depth: { type: Number, default: 0 } },
  setup(props) {
    const open = ref(props.depth < 2 || props.node.n.claims > 0)
    return () => {
      const n = props.node
      if (props.onlyClaims && n.n.claims === 0) return null
      const kids = n.children.map(c => vh(PrecinctNode, { node: c, onlyClaims: props.onlyClaims, depth: props.depth + 1, key: c.id }))
      const head = vh('div', { class: ['pc-node-h', `pc-k-${n.kind}`], onClick: () => { open.value = !open.value } }, [
        vh('span', { class: 'pc-node-id' }, n.local_id.split('-').pop()!.replace(/^(sec|ssec|para\d?)\./, (_, k) => ({ sec: 'cl ', ssec: '(', para: '(', para1: '(', para2: '(' } as any)[k] ?? '')),
        n.heading ? vh('b', { class: 'pc-node-t' }, n.heading) : null,
        n.text && !n.heading ? vh('span', { class: 'pc-node-x' }, n.text.length > 220 && !open.value ? n.text.slice(0, 220) + '…' : n.text) : null,
        n.n.claims ? vh('span', { class: 'pc-node-n' }, [vh('span', { class: 'pc-v pc-v--yes' }, String(n.n.yes)), ' ', vh('span', { class: 'pc-v pc-v--no' }, String(n.n.no)), ' ', vh('span', { class: 'pc-v pc-v--unknown' }, String(n.n.unknown))]) : null,
      ])
      const text = n.heading && n.text ? vh('p', { class: 'pc-node-x' }, n.text) : null
      const claims = n.claims.map(c => vh('div', { class: 'pc-claim', key: c.id }, [
        vh('span', { class: `pc-v pc-v--${c.holds === true ? 'yes' : c.holds === false ? 'no' : 'unknown'}` }, c.holds === true ? 'holds' : c.holds === false ? 'does not hold' : 'unknown'),
        ' ', vh('b', null, c.kind), c.consent ? ` (${c.consent} consent)` : '',
        c.uses.length ? vh('span', { class: 'pc-muted' }, ` · uses: ${c.uses.join(', ')}`) : null,
        c.zones.length ? vh('span', { class: 'pc-muted' }, ` · zones: ${c.zones.join(', ')}`) : null,
        c.topic ? vh('span', { class: 'pc-muted' }, ` · ${c.topic} ${c.comparator ?? ''} ${c.value ?? ''} ${c.unit ?? ''}`) : null,
        c.terms.length ? vh('span', { class: 'pc-muted' }, ` · terms: ${c.terms.join(', ')}`) : null,
        vh('div', { class: 'pc-why' }, c.why.join(' · ') || '(no condition tested)'),
        c.span ? vh('div', { class: 'pc-span' }, `“${c.span}”`) : null,
      ]))
      return vh('div', { class: 'pc-node', style: { marginLeft: `${Math.min(props.depth, 6) * 14}px` } }, [head, open.value ? [text, ...claims, ...kids] : null])
    }
  },
})
</script>

<style scoped>
.pc { display: grid; grid-template-columns: 340px 1fr; gap: 18px; max-width: 1400px; margin: 0 auto; padding: 14px 16px; font: 14px/1.45 system-ui, sans-serif; color: #1f2937 }
@media (max-width: 900px) { .pc { grid-template-columns: 1fr } }
.pc-side h1 { font-size: 20px; margin: 0 0 8px }
.pc-tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef2ff; color: #3730a3; margin-left: 6px; vertical-align: middle }
.pc-tag.ok { background: #dcfce7; color: #166534 } .pc-tag.warn { background: #fee2e2; color: #991b1b }
.pc-search { position: relative } .pc-input { width: 100%; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; box-sizing: border-box }
.pc-input--s { width: auto; min-width: 220px; padding: 4px 8px }
.pc-results { position: absolute; z-index: 5; left: 0; right: 0; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; list-style: none; margin: 4px 0 0; padding: 4px 0; box-shadow: 0 6px 20px rgba(0,0,0,.08) }
.pc-results li { padding: 6px 10px; cursor: pointer } .pc-results li:hover { background: #f3f4f6 }
.pc-group { margin-top: 10px } .pc-group-t { font-weight: 600; font-size: 12px; margin: 0 0 4px; color: #374151 }
.pc-sample { display: block; width: 100%; text-align: left; font: inherit; padding: 4px 8px; margin: 2px 0; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer }
.pc-sample.on { border-color: #1f2937; background: #f3f4f6 } .pc-sample-a { display: block; font-size: 13px } .pc-sample-u { display: block; font-size: 11px; color: #6b7280 }
.pc-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin: 0 0 14px }
.pc-card h2 { font-size: 16px; margin: 0 0 6px }
.pc-ask { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0 } .pc-btn { font: inherit; padding: 5px 12px; border: 1px solid #1f2937; border-radius: 6px; background: #1f2937; color: #fff; cursor: pointer }
.pc-summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 6px 0 }
.pc-note { background: #fef3c7; color: #92400e; padding: 6px 10px; border-radius: 6px; font-size: 13px }
.pc-v { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #f3f4f6 } .pc-v--yes { background: #dcfce7; color: #166534 } .pc-v--no { background: #fee2e2; color: #991b1b } .pc-v--unknown { background: #fef3c7; color: #92400e }
.pc-node { border-left: 2px solid #f3f4f6; padding-left: 8px; margin-top: 4px }
.pc-node-h { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap } .pc-node-id { font-family: ui-monospace, monospace; font-size: 12px; color: #6b7280; min-width: 44px }
.pc-k-part .pc-node-t, .pc-k-schedule .pc-node-t, .pc-k-chapter .pc-node-t { font-size: 15px } .pc-k-group .pc-node-t { color: #3730a3 }
.pc-node-x { color: #374151; margin: 2px 0 } .pc-node-n { margin-left: auto }
.pc-claim { background: #f9fafb; border-radius: 6px; padding: 6px 8px; margin: 4px 0; font-size: 13px } .pc-why { color: #4b5563; font-size: 12px; margin-top: 2px } .pc-span { color: #6b7280; font-size: 12px; font-style: italic }
.pc-small { font-size: 12px } .pc-muted { color: #6b7280 } .pc-error { color: #991b1b }
.pc-pre { font-size: 11px; white-space: pre-wrap; max-height: 520px; overflow: auto; background: #f9fafb; padding: 8px }
@media (prefers-color-scheme: dark) { .pc { color: #e5e7eb } .pc-card, .pc-sample { border-color: #374151; background: #111827 } .pc-claim, .pc-pre { background: #111827 } .pc-results, .pc-input { background: #111827; color: #e5e7eb; border-color: #374151 } .pc-node-x { color: #d1d5db } .pc-sample.on { background: #1f2937 } }
</style>
