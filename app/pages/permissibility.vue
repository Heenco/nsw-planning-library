<!--
  /permissibility

  Browse any plan's Land Use Table zone by zone. The plan picker and the zone
  rail come from /api/lep-permissibility; the zone in view is the same route
  with ?zone=, rendered by <ZonePermissibility>, which /report shares. Both
  selections live in the URL so a zone can be linked to.
-->

<template>
  <div class="pm-page">

    <!-- ── Header ───────────────────────────────────────────────────────── -->
    <header class="pm-header">
      <div>
        <NuxtLink to="/" class="pm-back">&larr; Home</NuxtLink>
        <h1 class="pm-title">Permissibility</h1>
      </div>
      <div v-if="plans.length" class="pm-header-stat">
        <strong>{{ plans.length }}</strong> plans with a Land Use Table
      </div>
    </header>

    <p v-if="plansError" class="pm-status pm-status--error">{{ plansError }}</p>

    <div v-else class="pm-layout">

      <!-- ── Rail: plan picker + zones ─────────────────────────────────── -->
      <aside class="pm-rail">
        <label class="pm-label" for="pm-plan">Local Environmental Plan</label>
        <select id="pm-plan" v-model="epi" class="pm-select" :disabled="!plans.length">
          <option v-if="!plans.length" value="">Loading plans…</option>
          <option v-for="p in plans" :key="p.epicode" :value="p.epicode">
            {{ p.name }}{{ p.resolved ? '' : ' (not resolved)' }}
          </option>
        </select>

        <div class="pm-rail-head">
          <span class="pm-label">Zones</span>
          <span v-if="zonesLoading" class="pm-rail-note">loading…</span>
          <span v-else-if="zones.length" class="pm-rail-note">{{ zones.length }}</span>
        </div>

        <ul class="pm-zones">
          <li v-for="z in zones" :key="z.zoneId">
            <button
              type="button"
              class="pm-zone"
              :class="{ 'pm-zone--on': z.zoneId === zoneId }"
              @click="zoneId = z.zoneId"
            >
              <span class="pm-zone-code">{{ z.code }}</span>
              <span class="pm-zone-body">
                <span class="pm-zone-name">{{ z.name }}</span>
                <span v-if="z.resolved.total" class="pm-zone-bar" :title="barTitle(z)">
                  <span
                    v-for="s in STATUS_ORDER" :key="s"
                    class="pm-zone-seg"
                    :style="{ flex: resolvedCount(z, s), background: BAR_COLOR[s] }"
                  />
                </span>
                <span v-else class="pm-zone-bar pm-zone-bar--none">not resolved</span>
              </span>
            </button>
          </li>
        </ul>

        <div v-if="zones.length" class="pm-legend-rail">
          <span v-for="s in STATUS_ORDER" :key="s" class="pm-legend-item">
            <span class="pm-legend-dot" :style="{ background: BAR_COLOR[s] }" />{{ STATUS_SHORT[s] }}
          </span>
        </div>
      </aside>

      <!-- ── Main ──────────────────────────────────────────────────────── -->
      <section class="pm-main">
        <p v-if="detailError" class="pm-status pm-status--error">{{ detailError }}</p>
        <p v-else-if="!detail && (detailLoading || zonesLoading || !plans.length)" class="pm-status">Loading…</p>
        <p v-else-if="!detail" class="pm-status">Pick a zone.</p>

        <template v-else>
          <div class="pm-zone-head" :class="{ 'pm-zone-head--busy': detailLoading }">
            <h2 class="pm-zone-title">
              <span class="pm-zone-title-code">{{ detail.zone.code }}</span>
              {{ detail.zone.name }}
            </h2>
            <p class="pm-zone-sub">{{ detail.name }}</p>
          </div>

          <ZonePermissibility :detail="detail" />
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlanSummary, Status, ZoneDetail, ZoneSummary } from '#shared/lep-permissibility'

useHead({ title: 'Permissibility · Planning Library' })

// ── Vocabulary ──────────────────────────────────────────────────────────

type LeafStatus = Exclude<Status, 'mixed'>

const STATUS_ORDER: LeafStatus[] = ['permitted_without_consent', 'permitted_with_consent', 'prohibited']

const STATUS_SHORT: Record<LeafStatus, string> = {
  permitted_without_consent: 'Without consent',
  permitted_with_consent: 'With consent',
  prohibited: 'Prohibited',
}

/** The rail's mini bars use the same status hues as the zone view's chart. */
const BAR_COLOR: Record<LeafStatus, string> = {
  permitted_without_consent: '#0f766e',
  permitted_with_consent: '#15803d',
  prohibited: '#b91c1c',
}

// ── State ───────────────────────────────────────────────────────────────

const route = useRoute()
const router = useRouter()

const plans = ref<PlanSummary[]>([])
const plansError = ref<string | null>(null)

const epi = ref(String(route.query.epi ?? ''))
const zones = ref<ZoneSummary[]>([])
const zonesLoading = ref(false)

const zoneId = ref(String(route.query.zone ?? ''))
const detail = ref<ZoneDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)

/** The pilot councils are the ones people open first. */
const DEFAULT_PLAN = 'epi-2013-0569'

// ── Loading ─────────────────────────────────────────────────────────────

let zonesToken = 0
let detailToken = 0

onMounted(async () => {
  try {
    const res: any = await $fetch('/api/lep-permissibility')
    plans.value = res.plans
    if (!plans.value.some(p => p.epicode === epi.value)) {
      epi.value = plans.value.some(p => p.epicode === DEFAULT_PLAN)
        ? DEFAULT_PLAN
        : (plans.value[0]?.epicode ?? '')
    }
  } catch (err) {
    plansError.value = `Could not load the plan list: ${(err as Error).message}`
  }
})

/**
 * A plan change reloads the rail, then the zone. If the plan has no zone by
 * the current id the first zone is selected, and the zone watcher below does
 * the fetch; if it does (R2 exists in nearly every plan) the id is unchanged,
 * no watcher would fire, and the detail is fetched here instead. Either way
 * one request, including the first load from a URL that names both.
 */
watch(epi, async (code) => {
  if (!code) return
  const token = ++zonesToken
  zonesLoading.value = true
  try {
    const res: any = await $fetch('/api/lep-permissibility', { query: { epi: code } })
    if (token !== zonesToken) return
    if (!res.ok) throw new Error(res.message)
    zones.value = res.zones
    if (zones.value.some(z => z.zoneId === zoneId.value)) loadDetail()
    else zoneId.value = zones.value[0]?.zoneId ?? ''
  } catch (err) {
    if (token !== zonesToken) return
    zones.value = []
    detail.value = null
    detailError.value = `Could not load zones: ${(err as Error).message}`
  } finally {
    if (token === zonesToken) zonesLoading.value = false
  }
}, { immediate: true })

watch(zoneId, () => loadDetail())

async function loadDetail() {
  syncUrl()
  const id = zoneId.value
  if (!id) { detail.value = null; return }
  const token = ++detailToken
  detailLoading.value = true
  detailError.value = null
  try {
    const res: any = await $fetch('/api/lep-permissibility', { query: { epi: epi.value, zone: id } })
    if (token !== detailToken) return
    if (!res.ok) throw new Error(res.message)
    detail.value = res
  } catch (err) {
    if (token !== detailToken) return
    detail.value = null
    detailError.value = `Could not load the zone: ${(err as Error).message}`
  } finally {
    if (token === detailToken) detailLoading.value = false
  }
}

function syncUrl() {
  const query: Record<string, string> = {}
  if (epi.value) query.epi = epi.value
  if (zoneId.value) query.zone = zoneId.value
  if (route.query.epi === query.epi && route.query.zone === query.zone) return
  router.replace({ query })
}

// ── Rail helpers ────────────────────────────────────────────────────────

function resolvedCount(z: ZoneSummary, s: LeafStatus): number {
  return s === 'permitted_without_consent' ? z.resolved.withoutConsent
    : s === 'permitted_with_consent' ? z.resolved.withConsent
    : z.resolved.prohibited
}

function barTitle(z: ZoneSummary): string {
  return STATUS_ORDER.map(s => `${STATUS_SHORT[s]} ${resolvedCount(z, s)}`).join(' · ')
}
</script>

<style>
/* The page is full-bleed, so the body reset cannot be scoped. */
body {
  margin: 0;
  background: #f8fafb;
}
</style>

<style scoped>
.pm-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.pm-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1.25rem 2rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
}
.pm-back {
  display: inline-block;
  font-size: 0.78rem;
  color: #64748b;
  text-decoration: none;
  margin-bottom: 0.3rem;
}
.pm-back:hover { color: #0f172a; }
.pm-title {
  font-size: 1.35rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0;
}
.pm-header-stat { font-size: 0.8rem; color: #64748b; }
.pm-header-stat strong { color: #0f172a; font-weight: 700; }

.pm-status {
  padding: 3rem 2rem;
  text-align: center;
  color: #64748b;
  font-size: 0.9rem;
}
.pm-status--error { color: #b91c1c; }

/* ── Layout ─────────────────────────────────────────────────────────────── */
.pm-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 2rem;
  max-width: 1360px;
  margin: 0 auto;
  padding: 1.75rem 2rem 4rem;
  align-items: start;
}
@media (max-width: 960px) {
  .pm-layout {
    grid-template-columns: 1fr;
    padding: 1.25rem 1rem 3rem;
  }
}

/* ── Rail ───────────────────────────────────────────────────────────────── */
.pm-rail {
  position: sticky;
  top: 5.5rem;
  max-height: calc(100vh - 6.5rem);
  display: flex;
  flex-direction: column;
}
@media (max-width: 960px) {
  .pm-rail { position: static; max-height: none; }
}

.pm-label {
  display: block;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #64748b;
  margin: 0 0 0.4rem;
}

.pm-select {
  width: 100%;
  padding: 0.5rem 0.65rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font: inherit;
  font-size: 0.84rem;
  color: #0f172a;
}
.pm-select:focus {
  outline: none;
  border-color: #15803d;
  box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.1);
}

.pm-rail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 1.25rem 0 0.4rem;
}
.pm-rail-head .pm-label { margin: 0; }
.pm-rail-note { font-size: 0.7rem; color: #94a3b8; }

.pm-zones {
  list-style: none;
  margin: 0;
  padding: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow-y: auto;
  min-height: 0;
}

.pm-zone {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pm-zones li:last-child .pm-zone { border-bottom: none; }
.pm-zone:hover { background: #f8fafb; }
.pm-zone--on { background: #f0fdf4; }
.pm-zone--on:hover { background: #dcfce7; }

.pm-zone-code {
  flex-shrink: 0;
  width: 2.6rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: #0f172a;
}
.pm-zone-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.pm-zone-name {
  font-size: 0.8rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pm-zone-bar {
  display: flex;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
  background: #f1f5f9;
}
.pm-zone-bar--none {
  height: auto;
  background: none;
  font-size: 0.66rem;
  color: #cbd5e1;
  font-style: italic;
}
.pm-zone-seg { display: block; min-width: 0; }

.pm-legend-rail {
  display: flex;
  gap: 0.9rem;
  justify-content: center;
  flex-wrap: wrap;
  font-size: 0.68rem;
  color: #64748b;
  margin-top: 0.7rem;
}
.pm-legend-item { display: inline-flex; align-items: center; gap: 0.3rem; }
.pm-legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* ── Main: zone heading ─────────────────────────────────────────────────── */
.pm-zone-head { margin-bottom: 1.25rem; transition: opacity 0.15s; }
.pm-zone-head--busy { opacity: 0.55; }

.pm-zone-title {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 0.2rem;
}
.pm-zone-title-code {
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  background: #0f172a;
  color: #fff;
}
.pm-zone-sub { font-size: 0.82rem; color: #64748b; margin: 0; }
</style>
