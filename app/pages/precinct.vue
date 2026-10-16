<!--
  /precinct - the Precinct SEPP bench (docs/precinct-sepp-pipeline.md).

  A lot inside a Precinct SEPP is governed by one chapter or appendix of it, which is that land's local plan. This page
  shows, for such a lot: what governs it, the principal development standards from the unit's own maps (zone, height,
  FSR, lot size, and residential density, which the growth centre plans add), and the unit's Land Use Table as written
  and as resolved (precinct.lut_zones / precinct.lut_permissibility, the /report-2 reference section). Both answers
  come from pregenerated tables: /api/report/standards?precinct=1 and /api/lep-permissibility?unit=. The engine's
  clause-by-clause reading stays available at /api/precinct/at but is not on this page.
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
      <p class="pc-small pc-muted">Sample lots from the state-wide build: one addressed lot per zone of every precinct. Open an instrument, then a precinct.</p>
      <details v-for="(units, inst) in samplesTree" :key="inst" class="pc-group">
        <summary class="pc-group-t">{{ shortTitle(String(inst)) }} <span class="pc-muted">{{ Object.keys(units).length }} units</span></summary>
        <details v-for="(group, unit) in units" :key="unit" class="pc-unit" :open="group.some(s => s.cadid === cadid)">
          <summary class="pc-unit-t">{{ unit }} {{ unitName(group[0]!.heading) }} <span class="pc-muted">{{ group.length }} zones</span></summary>
          <button v-for="s in group" :key="s.cadid" type="button" class="pc-sample" :class="{ on: cadid === s.cadid }" @click="load(s.cadid, s.address)" :title="`${s.lots} lots in zone ${s.zone || '?'} of this unit`">
            <span class="pc-sample-z">{{ s.zone || '?' }}</span>
            <span class="pc-sample-a">{{ titleCase(s.address || s.cadid) }}</span>
          </button>
        </details>
      </details>
      <p v-if="!samples.length" class="pc-muted pc-small">loading samples…</p>
    </aside>

    <main class="pc-main">
      <p v-if="!cadid" class="pc-muted">Pick a lot on the left.</p>
      <template v-if="cadid">
        <!-- ── what governs the lot ─────────────────────────────────────── -->
        <section class="pc-card">
          <p class="pc-kicker">Precinct report</p>
          <h2>{{ titleCase(address || cadid) }}</h2>
          <p class="pc-ids"><span v-if="gov?.zone">Zone <b>{{ gov.zone }}</b></span><span class="pc-muted">{{ cadid }}</span></p>
          <p v-if="stdError" class="pc-error">{{ stdError }}</p>
          <p v-else-if="!std" class="pc-muted">reading the governing unit…</p>
          <p v-else-if="!gov" class="pc-note">derived.lot_instrument has not reached this lot: no governing instrument is held.</p>
          <p v-else class="pc-gov">
            This land is governed by <b>{{ gov.unit ? `${gov.unit} ${gov.unitHeading ?? ''}` : '(unit not held)' }}</b> of <b>{{ gov.instrument }}</b>
            <span class="pc-small pc-muted"> · bound by its {{ gov.basis === 'land_application' ? 'Land Application Map' : gov.basis }}</span>
            <template v-if="gov.alsoMapped.length"><br /><span class="pc-small pc-muted">also mapped, not governing: {{ gov.alsoMapped.map(a => `${shortTitle(a.instrument)}${a.coverPct != null ? ` (${Math.round(a.coverPct)}%)` : ''}`).join('; ') }}</span></template>
          </p>
        </section>

        <!-- ── principal development standards, from the unit's own maps ── -->
        <section class="pc-card">
          <h3>Principal development standards <small>from the unit's own maps · /api/report/standards</small></h3>
          <div class="pc-std">
            <div v-for="s in principal" :key="s.key" class="pc-std-card" :class="{ 'pc-std-card--none': std && !s.panels.length }">
              <p class="pc-std-title">{{ s.title }}</p>
              <p v-if="!std" class="pc-muted">loading…</p>
              <template v-else-if="s.panels.length">
                <div v-for="(pn, i) in s.panels" :key="i" class="pc-std-hit">
                  <p class="pc-std-val">{{ pn.value || ('set by ' + (pn.clause || 'its clause')) }}</p>
                  <p class="pc-std-meta"><span v-if="pn.label">map label {{ pn.label }}</span><span v-if="pn.band && pn.band !== pn.label">{{ pn.band }}</span><span v-if="pn.clause">{{ pn.clause }}</span><span>{{ Math.round(pn.coverPct) }}% of the lot</span><span v-if="pn.governing === false" class="pc-tag">also mapped</span></p>
                </div>
              </template>
              <p v-else class="pc-std-val pc-muted">not on this map</p>
            </div>
          </div>
          <p class="pc-small pc-muted">Zone, height, FSR and lot size are the maps every standard-instrument plan carries; residential density is the growth centre precinct plans' own map (its clause binds a minimum dwelling yield to the lot's density band).</p>
        </section>

        <!-- ── the unit's Land Use Table, as written and as resolved ────────── -->
        <section class="pc-card">
          <h3>The Land Use Table <small>as written in the unit, how it becomes the resolved list, and resolved against the Standard Instrument · /api/lep-permissibility</small></h3>
          <p v-if="!std" class="pc-muted">reading the governing unit…</p>
          <p v-else-if="!gov?.unit || !gov?.zone" class="pc-muted">The lot's unit or zone is not held, so there is no table to resolve.</p>
          <p v-else-if="lutError" class="pc-note">{{ lutError }}</p>
          <template v-else-if="lut">
            <p class="pc-small pc-muted"><b>Zone {{ lut.zone.code }}</b> {{ lut.zone.name }} · {{ gov.unit }} {{ gov.unitHeading }} · {{ shortTitle(lut.name) }} · resolved run {{ lut.resolved.runId }}</p>
            <ZonePermissibility :detail="lut" />
          </template>
          <p v-else class="pc-muted">Resolving the Land Use Table…</p>
          <p class="pc-small pc-muted">The table is the unit's own (precinct.lut_zones, pregenerated for every table of every instrument); the resolution is 01E's rule run on it by scripts/precinct/resolve-lut.py into precinct.lut_permissibility: explicit, then inherited from a listed group term, then the catch-all line, against the universe and hierarchy of the latest 01E run. A listed term outside that vocabulary (drainage, studio dwellings, manor homes) is kept as written, not guessed.</p>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { PrecinctSample } from '../../server/api/precinct/samples.get'
import type { StandardsResponse } from '../../server/api/report/standards.get'
import type { ZoneDetail } from '../../shared/lep-permissibility'

const q = ref(''), results = ref<any[]>([]), cadid = ref(''), address = ref(''), stdError = ref(''), lutError = ref('')
const std = ref<StandardsResponse | null>(null), lut = ref<ZoneDetail | null>(null)
const samples = ref<PrecinctSample[]>([])
/** instrument -> unit -> its zone samples, zones in code order */
const samplesTree = computed(() => {
  const t: Record<string, Record<string, PrecinctSample[]>> = {}
  for (const s of samples.value) ((t[s.instrument] ??= {})[s.unit || 'unit not held'] ??= []).push(s)
  for (const units of Object.values(t)) for (const g of Object.values(units)) g.sort((a, b) => String(a.zone).localeCompare(String(b.zone), undefined, { numeric: true }))
  return t
})
const gov = computed(() => std.value?.governing ?? null)
const shortTitle = (t: string) => t.replace('State Environmental Planning Policy', 'SEPP').replace(/\(Precincts[—–-]/, '(').replace(') 2021', ')')
const unitName = (hd: string | null) => (hd || '').replace(/^State significant precinct[—–-]\s*/, '')
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
const principal = computed(() => [
  { key: 'zone', title: 'Zone', panels: std.value?.zone ?? [] },
  { key: 'height', title: 'Maximum building height', panels: std.value?.height ?? [] },
  { key: 'fsr', title: 'Floor space ratio', panels: std.value?.fsr ?? [] },
  { key: 'lotSize', title: 'Minimum lot size', panels: std.value?.lotSize ?? [] },
  { key: 'density', title: 'Residential density', panels: std.value?.density ?? [] },
])
let timer: any
watch(q, (v) => { clearTimeout(timer); if (!v.trim()) { results.value = []; return }
  timer = setTimeout(async () => { try { results.value = ((await $fetch<any>('/api/lotprofile', { query: { q: v } })).results || []).slice(0, 8) } catch { results.value = [] } }, 250) })
function pick(r: any) { if (r?.cadid) { q.value = r.address || ''; results.value = []; load(String(r.cadid), r.address || '') } }
async function load(id: string, addr = '') {
  cadid.value = id; address.value = addr || samples.value.find(s => s.cadid === id)?.address || ''; stdError.value = ''; lutError.value = ''; std.value = null; lut.value = null
  const still = () => cadid.value === id
  const s: any = await $fetch('/api/report/standards', { query: { cadid: id, precinct: 1 } }).catch((e: any) => ({ error: e?.data?.message || e?.message || 'failed' }))
  if (!still()) return
  if (s?.error) { stdError.value = s.error; return }
  std.value = s
  const g = s.governing
  if (g?.instrument && g?.unit && g?.zone) {
    const r: any = await $fetch('/api/lep-permissibility', { query: { name: g.instrument, code: g.zone, unit: g.unit } }).catch((e: any) => ({ ok: false, message: e?.data?.message || e?.message || 'failed' }))
    if (!still()) return
    if (r?.ok && r?.zone) lut.value = r as ZoneDetail
    else lutError.value = r?.message || `No Land Use Table for zone ${g.zone} in ${g.unit} of ${g.instrument}.`
  }
}
onMounted(async () => { try { samples.value = (await $fetch<{ samples: PrecinctSample[] }>('/api/precinct/samples')).samples } catch { samples.value = [] }
  const id = new URLSearchParams(location.search).get('cadid'); if (id) load(id) })
</script>

<style scoped>
.pc { --line: #e5e7eb; --muted: #6b7280; --soft: #f9fafb; display: grid; grid-template-columns: 320px 1fr; gap: 18px; max-width: 1400px; margin: 0 auto; padding: 14px 16px; font: 14px/1.45 system-ui, sans-serif; color: #1f2937 }
@media (max-width: 900px) { .pc { grid-template-columns: 1fr } }
.pc-side h1 { font-size: 20px; margin: 0 0 8px }
.pc-tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #eef2ff; color: #3730a3; margin-left: 6px; vertical-align: middle }
.pc-search { position: relative } .pc-input { width: 100%; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; box-sizing: border-box }
.pc-results { position: absolute; z-index: 5; left: 0; right: 0; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; list-style: none; margin: 4px 0 0; padding: 4px 0; box-shadow: 0 6px 20px rgba(0,0,0,.08) }
.pc-results li { padding: 6px 10px; cursor: pointer } .pc-results li:hover { background: #f3f4f6 }
.pc-group { margin-top: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px } .pc-group-t { font-weight: 600; font-size: 13px; margin: 2px 0; color: #374151; cursor: pointer }
.pc-unit { margin: 4px 0 4px 6px } .pc-unit-t { font-size: 12px; font-weight: 600; cursor: pointer; margin: 2px 0 }
.pc-sample { display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; font: inherit; padding: 3px 8px; margin: 2px 0 2px 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff; cursor: pointer; box-sizing: border-box; max-width: calc(100% - 10px) }
.pc-sample.on { border-color: #1f2937; background: #f3f4f6 } .pc-sample-z { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); min-width: 34px } .pc-sample-a { font-size: 12px }
.pc-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 0 0 14px }
.pc-card h2 { font-size: 20px; margin: 0 0 4px; letter-spacing: .01em } .pc-card h3 { font-size: 15px; margin: 0 0 8px } .pc-card h3 small { font-weight: 400; color: var(--muted); margin-left: 8px; font-size: 12px }
.pc-kicker { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 }
.pc-ids { display: flex; gap: 14px; margin: 0 0 6px; color: #374151 } .pc-gov { margin: 6px 0 2px; font-size: 15px }
.pc-std { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px } @media (max-width: 1100px) { .pc-std { grid-template-columns: repeat(2, minmax(0, 1fr)) } }
.pc-std-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px } .pc-std-card--none { background: var(--soft) } .pc-std-card p { margin: 0 }
.pc-std-title { font-size: 12px; color: var(--muted) } .pc-std-val { font-size: 18px; font-weight: 600; margin-top: 2px } .pc-std-hit + .pc-std-hit { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line) }
.pc-std-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); margin-top: 3px }
.pc-note { background: #fef3c7; color: #92400e; padding: 6px 10px; border-radius: 6px; font-size: 13px }
.pc-small { font-size: 12px } .pc-muted { color: var(--muted) } .pc-error { color: #991b1b }
@media (prefers-color-scheme: dark) { .pc { --line: #374151; --muted: #9ca3af; --soft: #111827; color: #e5e7eb } .pc-card, .pc-sample, .pc-std-card { background: #0f172a } .pc-results, .pc-input { background: #111827; color: #e5e7eb; border-color: #374151 } .pc-ids { color: #d1d5db } .pc-sample.on { background: #1f2937 } .pc-note { background: #3f2d0a; color: #fde68a } }
</style>
