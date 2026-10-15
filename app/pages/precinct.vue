<!--
  /precinct - the Precinct SEPP test bench (docs/precinct-sepp-pipeline.md).

  The same endpoints /report-2 reads, called with `precinct=1`: that switch makes every reader take the lot's governing
  instrument AND UNIT from derived.lot_instrument (a Precinct SEPP's chapter or appendix), lets the RAG engine answer from
  that instrument, and gates its claims unit by unit. Without the switch the endpoints behave as they did before the
  Precinct SEPPs entered the graph, which is what /report-2 shows until this page says the answers are right.
-->
<template>
  <div class="pc">
    <header class="pc-head">
      <h1>Precinct SEPPs <span class="pc-tag">test bench</span></h1>
      <p class="pc-sub">Every answer here comes from the report's own endpoints with <code>precinct=1</code>. /report-2 does not use the switch yet.</p>
      <form class="pc-search" @submit.prevent="pick(results[0])">
        <input v-model="q" type="search" placeholder="Address or lot, e.g. 26 Brookfield St The Ponds" class="pc-input" />
        <ul v-if="results.length" class="pc-results">
          <li v-for="r in results" :key="r.cadid" @click="pick(r)">{{ r.address || '(no address)' }} <span class="pc-muted">{{ r.cadid }}</span></li>
        </ul>
      </form>
      <p class="pc-cases">Baseline lots:
        <button v-for="b in baseline" :key="b.cadid" type="button" class="pc-chip" :class="{ on: cadid === b.cadid }" @click="load(b.cadid)">{{ b.name }}</button>
      </p>
    </header>

    <p v-if="error" class="pc-error">{{ error }}</p>
    <template v-if="cadid">
      <section class="pc-card">
        <h2>Governing instrument and unit <small>/api/report/standards</small></h2>
        <p v-if="!std" class="pc-muted">…</p>
        <template v-else-if="std.governing">
          <p><b>{{ std.governing.instrument }}</b><template v-if="std.governing.unitHeading"> · {{ std.governing.unit }} {{ std.governing.unitHeading }}</template>
            <span class="pc-tag">{{ std.governing.basis }}</span> · zone {{ std.governing.zone || '?' }}</p>
          <p v-for="a in std.governing.alsoMapped" :key="a.instrument" class="pc-muted">also mapped: {{ a.instrument }}<template v-if="a.coverPct != null"> ({{ a.coverPct }}%)</template></p>
        </template>
        <p v-else class="pc-muted">derived.lot_instrument has no row for this lot.</p>
        <div v-if="std" class="pc-grid">
          <div v-for="k in ['zone', 'height', 'fsr', 'lotSize']" :key="k" class="pc-std">
            <p class="pc-std-t">{{ { zone: 'Zone', height: 'Height', fsr: 'FSR', lotSize: 'Lot size' }[k] }}</p>
            <p v-for="(p, i) in (std as any)[k]" :key="i" :class="{ 'pc-muted': p.governing === false }">{{ p.value || ('set by ' + (p.clause || 'its clause')) }} <small>{{ p.plan }} · {{ Math.round(p.coverPct) }}%<template v-if="p.governing === false"> · also mapped</template></small></p>
            <p v-if="!(std as any)[k].length" class="pc-muted">none</p>
          </div>
        </div>
      </section>

      <section class="pc-card">
        <h2>Land uses <small>/api/report/uses · engine {{ uses?.engine ?? '…' }}</small></h2>
        <p v-if="uses?.reason" class="pc-muted">{{ uses.reason }}</p>
        <table v-if="uses?.uses?.length" class="pc-table">
          <thead><tr><th>Use</th><th>Verdict</th><th>By</th></tr></thead>
          <tbody><tr v-for="u in uses.uses" :key="u.use"><td>{{ u.use }}</td><td><span class="pc-v" :class="'pc-v--' + u.verdict">{{ u.verdict }}</span></td>
            <td class="pc-small">{{ (u.by || []).map((b: any) => b.label).join('; ') }}<template v-if="u.caveat"> · {{ u.caveat }}</template></td></tr></tbody>
        </table>
      </section>

      <section class="pc-card">
        <h2>Subdivision <small>/api/report/subdivision · engine {{ sub?.engine ?? '…' }}</small></h2>
        <p v-if="sub?.reason" class="pc-muted">{{ sub.reason }}</p>
        <div v-for="p in sub?.purposes || []" :key="p.purpose || p.label" class="pc-purpose">
          <p class="pc-purpose-t">{{ p.purpose || p.label }}</p>
          <ul>
            <li v-for="a in p.answers || []" :key="a.label"><b>{{ a.label }}</b>: <span class="pc-v" :class="'pc-v--' + a.verdict">{{ a.verdict }}</span>
              <span class="pc-small" v-if="a.answer?.expr || a.answer?.value != null"> · {{ a.answer?.expr || a.answer?.value }}</span></li>
          </ul>
        </div>
        <p v-if="sub?.provisions" class="pc-small">{{ Object.keys(sub.provisions).length }} provisions read.</p>
      </section>

      <section class="pc-card">
        <h2>Build controls <small>/api/report/build-controls · engine {{ bc?.engine ?? '…' }}</small></h2>
        <p v-if="bc?.reason" class="pc-muted">{{ bc.reason }}</p>
        <p v-else-if="bc" class="pc-small">{{ (bc.options || []).length }} uses offered · {{ Object.keys(bc.clauses || {}).length }} clauses held for the use {{ bc.use || '(none picked)' }}</p>
      </section>

      <section class="pc-card">
        <h2>Subdivision norms <small>/api/norms/subdivision</small></h2>
        <p v-if="norms" class="pc-small">unchecked {{ (norms.unchecked || []).length }} · not here {{ (norms.notHere || []).length }} · answered {{ (norms.answered || []).length }}</p>
        <ul v-if="norms?.unchecked?.length" class="pc-small">
          <li v-for="(u, i) in norms.unchecked.slice(0, 12)" :key="i">{{ u.instrument }} {{ u.clause }}: {{ u.why }}</li>
        </ul>
      </section>

      <details class="pc-card"><summary>Raw responses</summary><pre class="pc-pre">{{ JSON.stringify({ std, uses, sub, bc, norms }, null, 1).slice(0, 60000) }}</pre></details>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
const baseline = [
  { cadid: '173688603', name: 'The Ponds (CRC app.7)' }, { cadid: '183806086', name: 'Austral (WPC app.4)' },
  { cadid: '101874531', name: 'Luddenham (WPC ch.4)' }, { cadid: '104226091', name: 'Gosford (Regional ch.5)' },
  { cadid: '102043114', name: 'Olympic Park (CRC app.4)' }, { cadid: '102531074', name: 'Normanhurst (EHC app.6)' },
  { cadid: '102518358', name: 'Galston Rd Hornsby (LEP control)' }, { cadid: '100096265', name: 'Bambara (LEP control)' },
]
const q = ref(''), results = ref<any[]>([]), cadid = ref(''), error = ref('')
const std = ref<any>(null), uses = ref<any>(null), sub = ref<any>(null), bc = ref<any>(null), norms = ref<any>(null)
let timer: any
watch(q, (v) => { clearTimeout(timer); if (!v.trim()) { results.value = []; return }
  timer = setTimeout(async () => { try { results.value = ((await $fetch<any>('/api/lotprofile', { query: { q: v } })).results || []).slice(0, 8) } catch { results.value = [] } }, 250) })
function pick(r: any) { if (r?.cadid) { q.value = r.address || ''; results.value = []; load(String(r.cadid)) } }
async function load(id: string) {
  cadid.value = id; error.value = ''; std.value = uses.value = sub.value = bc.value = norms.value = null
  const get = (path: string) => $fetch<any>(path, { query: { cadid: id, precinct: 1 } }).catch((e: any) => ({ error: e?.data?.message || e?.message }))
  const [a, b, c, d, e] = await Promise.all([get('/api/report/standards'), get('/api/report/uses'), get('/api/report/subdivision'), get('/api/report/build-controls'), get('/api/norms/subdivision')])
  if (cadid.value !== id) return
  std.value = a; uses.value = b; sub.value = c; bc.value = d; norms.value = e
  error.value = [a, b, c, d, e].map((x: any) => x?.error).filter(Boolean).join(' · ')
}
</script>

<style scoped>
.pc { max-width: 1100px; margin: 0 auto; padding: 16px; font: 14px/1.45 system-ui, sans-serif; color: #1f2937 }
.pc-head h1 { font-size: 22px; margin: 0 0 4px }
.pc-sub { color: #6b7280; margin: 0 0 12px }
.pc-tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef2ff; color: #3730a3; margin-left: 6px; vertical-align: middle }
.pc-search { position: relative; max-width: 560px }
.pc-input { width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit }
.pc-results { position: absolute; z-index: 5; left: 0; right: 0; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; list-style: none; margin: 4px 0 0; padding: 4px 0; box-shadow: 0 6px 20px rgba(0,0,0,.08) }
.pc-results li { padding: 6px 10px; cursor: pointer } .pc-results li:hover { background: #f3f4f6 }
.pc-cases { margin: 10px 0 0 } .pc-chip { font: inherit; font-size: 12px; margin: 2px 4px 2px 0; padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 12px; background: #fff; cursor: pointer }
.pc-chip.on { background: #1f2937; color: #fff; border-color: #1f2937 }
.pc-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin: 14px 0 }
.pc-card h2 { font-size: 15px; margin: 0 0 8px } .pc-card h2 small { font-weight: 400; color: #6b7280; margin-left: 8px; font-size: 12px }
.pc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px }
.pc-std { background: #f9fafb; border-radius: 6px; padding: 8px 10px } .pc-std-t { font-weight: 600; margin: 0 0 4px } .pc-std p { margin: 2px 0 } .pc-std small { color: #6b7280; display: block }
.pc-table { width: 100%; border-collapse: collapse } .pc-table th, .pc-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top }
.pc-v { font-size: 12px; padding: 1px 6px; border-radius: 10px; background: #f3f4f6 } .pc-v--permitted, .pc-v--permitted_with_consent { background: #dcfce7; color: #166534 } .pc-v--prohibited { background: #fee2e2; color: #991b1b } .pc-v--maybe { background: #fef3c7; color: #92400e }
.pc-purpose-t { font-weight: 600; margin: 8px 0 2px } .pc-purpose ul { margin: 0; padding-left: 18px }
.pc-small { font-size: 12px; color: #4b5563 } .pc-muted { color: #6b7280 } .pc-error { color: #991b1b }
.pc-pre { font-size: 11px; white-space: pre-wrap; max-height: 520px; overflow: auto; background: #f9fafb; padding: 8px }
code { background: #f3f4f6; padding: 0 4px; border-radius: 3px }
@media (prefers-color-scheme: dark) { .pc { color: #e5e7eb } .pc-card { border-color: #374151 } .pc-std, .pc-pre { background: #111827 } .pc-results { background: #111827; border-color: #374151 } .pc-input { background: #111827; color: #e5e7eb; border-color: #374151 } .pc-chip { background: #111827; color: #e5e7eb; border-color: #374151 } }
</style>
