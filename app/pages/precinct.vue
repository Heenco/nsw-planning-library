<!--
  /precinct - the Precinct SEPP bench (docs/precinct-sepp-pipeline.md).

  A lot inside a Precinct SEPP is governed by one chapter or appendix of it, which is that land's local plan. This page
  presents that unit the way /report-2 presents an LEP: what governs the lot, the principal development standards from
  the unit's own maps (zone, height, FSR, lot size, and residential density, which growth centre plans add), the land
  uses the unit permits, subdivision, and what applies from above (the Housing and Codes SEPPs). The clause tree the
  engine read, with its verdict on every claim for this lot, sits behind an evidence drawer. Every answer comes from
  the report's own endpoints with the precinct switch on; /report-2 does not use the switch yet.
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
      <p class="pc-small pc-muted">Sample lots from the state-wide build, a few per governing unit, residential zones first.</p>
      <div v-for="(group, inst) in samplesByInstrument" :key="inst" class="pc-group">
        <p class="pc-group-t">{{ shortTitle(String(inst)) }}</p>
        <button v-for="s in group" :key="s.cadid" type="button" class="pc-sample" :class="{ on: cadid === s.cadid }" @click="load(s.cadid)" :title="`${s.unit || '-'} ${s.heading || ''} · zone ${s.zone || '?'} · ${s.lots} lots in this unit`">
          <span class="pc-sample-a">{{ titleCase(s.address || s.cadid) }}</span>
          <span class="pc-sample-u">{{ s.unit || 'unit not held' }} · {{ unitName(s.heading) }} · {{ s.zone || '?' }}</span>
        </button>
      </div>
      <p v-if="!samples.length" class="pc-muted pc-small">loading samples…</p>
    </aside>

    <main class="pc-main">
      <p v-if="!cadid" class="pc-muted">Pick a lot on the left.</p>
      <p v-if="error" class="pc-error">{{ error }}</p>
      <template v-if="cadid">
        <!-- ── what governs the lot ─────────────────────────────────────── -->
        <section class="pc-card">
          <p class="pc-kicker">Precinct report</p>
          <h2>{{ titleCase(at?.lot.address || cadid) }}</h2>
          <p class="pc-ids"><span v-if="at?.lot.zone">Zone <b>{{ at.lot.zone }}</b></span><span v-if="at?.lot.area_m2">{{ Math.round(at.lot.area_m2).toLocaleString('en-AU') }} m²</span><span class="pc-muted">{{ cadid }}</span></p>
          <p v-if="at" class="pc-gov">
            This land is governed by <b>{{ at.governing.heading ? `${at.governing.unit} ${at.governing.heading}` : '(unit not held)' }}</b> of <b>{{ at.governing.instrument }}</b><template v-if="lepAlso">, not by {{ lepAlso }}</template>.
            <span class="pc-tag" :class="at.governing.inCorpus ? 'ok' : 'warn'">{{ at.governing.inCorpus ? 'read by the RAG engine' : 'not in the RAG corpus' }}</span>
          </p>
          <p v-if="at" class="pc-small pc-muted">{{ at.governing.why }}<template v-for="(u, t) in at.lot.units" :key="t"><template v-if="!u.governing"> · also mapped: {{ shortTitle(String(t)) }}<template v-if="u.cover != null"> ({{ u.cover }}%)</template></template></template></p>
          <p v-else class="pc-muted">reading the governing unit…</p>
        </section>

        <!-- ── principal development standards, from the unit's own maps ── -->
        <section class="pc-card">
          <h3>Principal development standards <small>from the unit's own maps · /api/report/standards</small></h3>
          <p v-if="stdError" class="pc-error">{{ stdError }}</p>
          <div class="pc-std">
            <div v-for="s in principal" :key="s.key" class="pc-std-card" :class="{ 'pc-std-card--none': std && !s.panels.length }">
              <p class="pc-std-title">{{ s.title }}</p>
              <p v-if="!std" class="pc-muted">loading…</p>
              <template v-else-if="s.panels.length">
                <div v-for="(pn, i) in s.panels" :key="i" class="pc-std-hit">
                  <p class="pc-std-val">{{ pn.value || ('set by ' + (pn.clause || 'its clause')) }}</p>
                  <p class="pc-std-meta"><span v-if="pn.label">map label {{ pn.label }}</span><span v-if="pn.band">{{ pn.band }}</span><span v-if="pn.clause">{{ pn.clause }}</span><span>{{ Math.round(pn.coverPct) }}% of the lot</span><span v-if="pn.governing === false" class="pc-tag">also mapped</span></p>
                </div>
              </template>
              <p v-else class="pc-std-val pc-muted">not on this map</p>
            </div>
          </div>
          <p class="pc-small pc-muted">Zone, height, FSR and lot size are the maps every standard-instrument plan carries; residential density is the growth centre precinct plans' own map (its clause binds a minimum dwelling yield to the lot's density band).</p>
        </section>

        <!-- ── land uses the unit permits ────────────────────────────────── -->
        <section class="pc-card">
          <h3>Land uses <small>/api/report/uses · engine {{ uses?.engine ?? 'answering…' }}</small></h3>
          <p v-if="noLut" class="pc-note">The RAG holds this unit, but no permit or prohibit claim was read from its Land Use Table for zone {{ at?.lot.zone }}: the zone group is in the corpus and the claims reader has not read it as permissions yet. Until it does, every use below is answered from the SEPPs that reach the lot (the Housing SEPP), never from the unit's own table.</p>
          <p v-if="uses?.reason" class="pc-muted">{{ uses.reason }}</p>
          <table v-if="uses?.uses?.length" class="pc-table">
            <thead><tr><th>Use</th><th>Verdict</th><th>By</th><th>Needed by</th></tr></thead>
            <tbody><tr v-for="u in uses.uses" :key="u.use"><td>{{ u.use }}</td><td><span class="pc-v" :class="'pc-v--' + u.verdict">{{ u.verdict }}</span><span v-if="u.consent" class="pc-small pc-muted"> {{ u.consent }} consent</span></td>
              <td class="pc-small">{{ (u.by || []).map((b: any) => b.label).join('; ') || '—' }}<template v-if="u.caveat"> · {{ u.caveat }}</template></td><td class="pc-small pc-muted">{{ (u.neededBy || []).slice(0, 2).join('; ') }}</td></tr></tbody>
          </table>
          <details v-if="uses?.others?.length"><summary class="pc-small">{{ uses.others.length }} other uses the instruments name for this zone</summary>
            <p class="pc-small">{{ uses.others.map((u: any) => `${u.use} (${u.verdict})`).join(' · ') }}</p></details>
        </section>

        <!-- ── subdivision ──────────────────────────────────────────────── -->
        <section class="pc-card">
          <h3>Subdivision <small>/api/report/subdivision · engine {{ sub?.engine ?? 'answering…' }}</small></h3>
          <p v-if="sub?.reason" class="pc-muted">{{ sub.reason }}</p>
          <div v-if="sub?.purposes?.length" class="pc-grid3">
            <div v-for="p in sub.purposes" :key="p.purpose || p.label" class="pc-purpose">
              <p class="pc-purpose-t">{{ p.purpose || p.label }}</p>
              <p v-for="a in p.answers || []" :key="a.label" class="pc-small"><b>{{ a.label }}</b>: <span class="pc-v" :class="'pc-v--' + a.verdict">{{ a.verdict }}</span><template v-if="a.answer?.expr || a.answer?.value != null"> · {{ a.answer?.expr || a.answer?.value }}</template></p>
            </div>
          </div>
          <template v-if="lotSizeClauses.length">
            <p class="pc-small" style="margin-top:8px"><b>The unit's lot size clauses on this lot</b></p>
            <ul class="pc-small pc-list">
              <li v-for="c in lotSizeClauses" :key="c.id"><span class="pc-v" :class="'pc-v--' + h(c.holds)">{{ h(c.holds) === 'yes' ? 'applies' : h(c.holds) === 'no' ? 'does not apply' : 'unknown' }}</span> <b>{{ c.label }}</b> <span v-if="c.topic">· {{ c.topic }} {{ c.comparator }} {{ c.value }}{{ c.unit }}</span><span class="pc-why"> · {{ c.why.join(' · ') }}</span></li>
            </ul>
          </template>
        </section>

        <!-- ── what applies from above ─────────────────────────────────── -->
        <section class="pc-card">
          <h3>What applies from above <small>SEPP claims that reach this lot, by instrument</small></h3>
          <p v-if="!at" class="pc-muted">reading the engine…</p>
          <div v-for="(g, inst) in othersByInstrument" :key="inst">
            <p class="pc-group-t">{{ shortTitle(String(inst)) }} <span class="pc-muted">{{ g.hold.length }} hold · {{ g.unknown.length }} unknown · {{ g.no }} ruled out</span></p>
            <details><summary class="pc-small">show the {{ g.hold.length + g.unknown.length }} that hold or are unknown</summary>
              <ul class="pc-small pc-list">
                <li v-for="(o, i) in [...g.hold, ...g.unknown]" :key="i"><span class="pc-v" :class="'pc-v--' + h(o.claim.holds)">{{ h(o.claim.holds) }}</span> <b>{{ o.label }}</b> <span class="pc-muted">{{ o.claim.kind }}<template v-if="o.claim.uses.length"> · {{ o.claim.uses.slice(0, 4).join(', ') }}</template></span><span class="pc-why"> · {{ o.claim.why.slice(0, 3).join(' · ') }}</span></li>
              </ul>
            </details>
          </div>
        </section>

        <!-- ── evidence: the unit, clause by clause ─────────────────────── -->
        <details class="pc-card" v-if="at">
          <summary><b>Evidence: the unit, clause by clause</b> <span class="pc-small pc-muted">{{ at.summary.provisions }} provisions · {{ at.summary.claims }} claims read ({{ Object.entries(at.summary.byKind).map(([k, n]) => `${k} ${n}`).join(', ') }}) · <span class="pc-v pc-v--yes">{{ at.summary.yes }} hold</span> <span class="pc-v pc-v--no">{{ at.summary.no }} do not</span> <span class="pc-v pc-v--unknown">{{ at.summary.unknown }} unknown</span></span></summary>
          <form class="pc-ask" @submit.prevent="load(cadid)">
            <label>Read the use-dependent clauses for <input v-model="use" class="pc-input pc-input--s" list="pc-uses" /></label>
            <datalist id="pc-uses"><option v-for="u in USES" :key="u" :value="u" /></datalist>
            <label><select v-model="proposal" class="pc-input pc-input--s"><option value="development">development</option><option value="subdivision">subdivision</option></select></label>
            <button type="submit" class="pc-btn">Read</button>
            <label class="pc-small"><input type="checkbox" v-model="onlyClaims" /> only provisions that carry a claim</label>
          </form>
          <p v-if="!at.tree.length" class="pc-muted">No provisions: the governing instrument is not in the RAG corpus, or the lot's unit is not held.</p>
          <PrecinctNode v-for="n in at.tree" :key="n.id" :node="n" :only-claims="onlyClaims" :depth="0" />
        </details>
        <details class="pc-card"><summary class="pc-small">Raw responses</summary><pre class="pc-pre">{{ JSON.stringify({ at, std, uses, sub }, null, 1).slice(0, 80000) }}</pre></details>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, h as vh, onMounted, ref, watch, defineComponent } from 'vue'
import type { PrecinctAtResponse, AuditNode, AuditClaim } from '../../server/api/precinct/at.get'
import type { PrecinctSample } from '../../server/api/precinct/samples.get'
import type { StandardsResponse } from '../../server/api/report/standards.get'

const USES = ['dwelling houses', 'dual occupancies', 'secondary dwellings', 'multi dwelling housing', 'residential flat buildings', 'seniors housing', 'shop top housing', 'neighbourhood shops', 'centre-based child care facilities', 'warehouse or distribution centres']
const q = ref(''), results = ref<any[]>([]), cadid = ref(''), error = ref(''), stdError = ref(''), use = ref('dwelling houses'), proposal = ref<'development' | 'subdivision'>('development'), onlyClaims = ref(true)
const at = ref<PrecinctAtResponse | null>(null), std = ref<StandardsResponse | null>(null), uses = ref<any>(null), sub = ref<any>(null)
const samples = ref<PrecinctSample[]>([])
const samplesByInstrument = computed(() => { const g: Record<string, PrecinctSample[]> = {}; for (const s of samples.value) (g[s.instrument] ??= []).push(s); return g })
const shortTitle = (t: string) => t.replace('State Environmental Planning Policy', 'SEPP').replace(/\(Precincts[—–-]/, '(').replace(') 2021', ')')
const unitName = (hd: string | null) => (hd || '').replace(/^State significant precinct[—–-]\s*/, '')
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
const h = (v: boolean | null) => v === true ? 'yes' : v === false ? 'no' : 'unknown'
/** the LEP also mapped on the lot, if any: the plan the land is NOT under */
const lepAlso = computed(() => { const u = at.value?.lot.units ?? {}; return Object.keys(u).find(t => !u[t]!.governing && /Local Environmental Plan/.test(t)) ?? null })
const principal = computed(() => [
  { key: 'zone', title: 'Zone', panels: std.value?.zone ?? [] },
  { key: 'height', title: 'Maximum building height', panels: std.value?.height ?? [] },
  { key: 'fsr', title: 'Floor space ratio', panels: std.value?.fsr ?? [] },
  { key: 'lotSize', title: 'Minimum lot size', panels: std.value?.lotSize ?? [] },
  { key: 'density', title: 'Residential density', panels: (at.value?.density ?? []).map(d => ({ ...d, band: null, clause: null, governing: true })) },
])
const noLut = computed(() => !!at.value && at.value.governing.inCorpus && !at.value.summary.byKind.permit && !at.value.summary.byKind.prohibit)
/** every claim of the unit about lot size, with the engine's verdict */
const lotSizeClauses = computed(() => {
  const out: (AuditClaim & { label: string })[] = []
  const walk = (n: AuditNode) => { for (const c of n.claims) if (c.topic === 'lot_size' || /lot size|subdivision/i.test(n.heading ?? '')) out.push({ ...c, label: n.label }); n.children.forEach(walk) }
  at.value?.tree.forEach(walk); return out
})
const othersByInstrument = computed(() => {
  const g: Record<string, { hold: any[]; unknown: any[]; no: number }> = {}
  for (const o of at.value?.others ?? []) { const e = (g[o.instrument] ??= { hold: [], unknown: [], no: 0 }); if (o.claim.holds === true) e.hold.push(o); else if (o.claim.holds == null) e.unknown.push(o); else e.no++ }
  for (const [inst, n] of Object.entries(at.value?.othersRuledOut ?? {})) (g[inst] ??= { hold: [], unknown: [], no: 0 }).no += n
  return g
})
let timer: any
watch(q, (v) => { clearTimeout(timer); if (!v.trim()) { results.value = []; return }
  timer = setTimeout(async () => { try { results.value = ((await $fetch<any>('/api/lotprofile', { query: { q: v } })).results || []).slice(0, 8) } catch { results.value = [] } }, 250) })
function pick(r: any) { if (r?.cadid) { q.value = r.address || ''; results.value = []; load(String(r.cadid)) } }
async function load(id: string) {
  cadid.value = id; error.value = ''; stdError.value = ''; at.value = null; std.value = null; uses.value = null; sub.value = null
  const get = (path: string, extra: Record<string, any> = {}) => $fetch<any>(path, { query: { cadid: id, precinct: 1, ...extra } }).catch((e: any) => ({ error: e?.data?.message || e?.message || 'failed' }))
  // each section fills in as its own answer arrives (the engine's calls take seconds each)
  const still = () => cadid.value === id
  await Promise.all([
    get('/api/report/standards').then(s => { if (!still()) return; if (s?.error) stdError.value = s.error; else std.value = s }),
    get('/api/precinct/at', { use: use.value, proposal: proposal.value }).then(a => { if (!still()) return; if (a?.error) error.value = a.error; else at.value = a }),
    get('/api/report/uses').then(u => { if (still()) uses.value = u?.error ? { engine: 'error', reason: u.error } : u }),
    get('/api/report/subdivision').then(d => { if (still()) sub.value = d?.error ? { engine: 'error', reason: d.error } : d }),
  ])
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
      const idLabel = n.local_id.split('-').pop()!.replace(/^sec\./, 'cl ').replace(/^(ssec|para\d?)\./, '(').replace(/^\((.*)$/, '($1)')
      const head = vh('div', { class: ['pc-node-h', `pc-k-${n.kind}`], onClick: () => { open.value = !open.value } }, [
        vh('span', { class: 'pc-node-id' }, idLabel),
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
.pc { --line: #e5e7eb; --muted: #6b7280; --soft: #f9fafb; display: grid; grid-template-columns: 320px 1fr; gap: 18px; max-width: 1400px; margin: 0 auto; padding: 14px 16px; font: 14px/1.45 system-ui, sans-serif; color: #1f2937 }
@media (max-width: 900px) { .pc { grid-template-columns: 1fr } }
.pc-side h1 { font-size: 20px; margin: 0 0 8px }
.pc-tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef2ff; color: #3730a3; margin-left: 6px; vertical-align: middle }
.pc-tag.ok { background: #dcfce7; color: #166534 } .pc-tag.warn { background: #fee2e2; color: #991b1b }
.pc-search { position: relative } .pc-input { width: 100%; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; box-sizing: border-box }
.pc-input--s { width: auto; min-width: 220px; padding: 4px 8px }
.pc-results { position: absolute; z-index: 5; left: 0; right: 0; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; list-style: none; margin: 4px 0 0; padding: 4px 0; box-shadow: 0 6px 20px rgba(0,0,0,.08) }
.pc-results li { padding: 6px 10px; cursor: pointer } .pc-results li:hover { background: #f3f4f6 }
.pc-group { margin-top: 10px } .pc-group-t { font-weight: 600; font-size: 12px; margin: 6px 0 4px; color: #374151 }
.pc-sample { display: block; width: 100%; text-align: left; font: inherit; padding: 4px 8px; margin: 2px 0; border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer }
.pc-sample.on { border-color: #1f2937; background: #f3f4f6 } .pc-sample-a { display: block; font-size: 13px } .pc-sample-u { display: block; font-size: 11px; color: var(--muted) }
.pc-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 0 0 14px }
.pc-card h2 { font-size: 20px; margin: 0 0 4px; letter-spacing: .01em } .pc-card h3 { font-size: 15px; margin: 0 0 8px } .pc-card h3 small { font-weight: 400; color: var(--muted); margin-left: 8px; font-size: 12px }
.pc-kicker { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 }
.pc-ids { display: flex; gap: 14px; margin: 0 0 6px; color: #374151 } .pc-gov { margin: 6px 0 2px; font-size: 15px }
.pc-std { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px } @media (max-width: 1100px) { .pc-std { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
.pc-std-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px } .pc-std-card--none { background: var(--soft) } .pc-std-card p { margin: 0 }
.pc-std-title { font-size: 12px; color: var(--muted) } .pc-std-val { font-size: 18px; font-weight: 600; margin-top: 2px } .pc-std-hit + .pc-std-hit { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line) }
.pc-std-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); margin-top: 3px }
.pc-ask { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0 } .pc-btn { font: inherit; padding: 5px 12px; border: 1px solid #1f2937; border-radius: 6px; background: #1f2937; color: #fff; cursor: pointer }
.pc-note { background: #fef3c7; color: #92400e; padding: 6px 10px; border-radius: 6px; font-size: 13px }
.pc-table { width: 100%; border-collapse: collapse } .pc-table th, .pc-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top } .pc-table th { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em }
.pc-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px } .pc-purpose { background: var(--soft); border-radius: 8px; padding: 8px 10px } .pc-purpose-t { font-weight: 600; margin: 0 0 4px } .pc-purpose p { margin: 2px 0 }
.pc-list { margin: 4px 0; padding-left: 18px } .pc-list li { margin: 3px 0 }
.pc-v { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #f3f4f6; white-space: nowrap } .pc-v--yes, .pc-v--permitted, .pc-v--permitted_with_consent, .pc-v--permitted_without_consent { background: #dcfce7; color: #166534 } .pc-v--no, .pc-v--prohibited { background: #fee2e2; color: #991b1b } .pc-v--unknown, .pc-v--maybe { background: #fef3c7; color: #92400e }
.pc-node { border-left: 2px solid #f3f4f6; padding-left: 8px; margin-top: 4px }
.pc-node-h { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap } .pc-node-id { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); min-width: 44px }
.pc-k-part .pc-node-t, .pc-k-schedule .pc-node-t, .pc-k-chapter .pc-node-t { font-size: 15px } .pc-k-group .pc-node-t { color: #3730a3 }
.pc-node-x { color: #374151; margin: 2px 0 } .pc-node-n { margin-left: auto }
.pc-claim { background: var(--soft); border-radius: 6px; padding: 6px 8px; margin: 4px 0; font-size: 13px } .pc-why { color: #4b5563; font-size: 12px; margin-top: 2px } .pc-span { color: var(--muted); font-size: 12px; font-style: italic }
.pc-small { font-size: 12px } .pc-muted { color: var(--muted) } .pc-error { color: #991b1b }
.pc-pre { font-size: 11px; white-space: pre-wrap; max-height: 520px; overflow: auto; background: var(--soft); padding: 8px }
@media (prefers-color-scheme: dark) { .pc { --line: #374151; --muted: #9ca3af; --soft: #111827; color: #e5e7eb } .pc-card, .pc-sample, .pc-std-card { background: #0f172a } .pc-results, .pc-input { background: #111827; color: #e5e7eb; border-color: #374151 } .pc-node-x, .pc-ids { color: #d1d5db } .pc-sample.on { background: #1f2937 } .pc-table td, .pc-table th { border-color: #1f2937 } .pc-note { background: #3f2d0a; color: #fde68a } }
</style>
