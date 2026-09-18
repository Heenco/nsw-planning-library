<!--
  /esa - the additional environmentally sensitive areas of clause 3.3, as "07 - ESA - exceptions" builds them.

  The table is the point: one row per exception item, what it says, which tier it landed in and which layers it
  was drawn from. The guide on the right says how those rows were made and what they cannot be used for - an
  advisory row covers a whole council area, and reading it as a boundary is the mistake the page exists to prevent.

  Reads /api/esa (esa.additional_exceptions and esa.source_layers on planningai). No map: the 52 features carry
  2.3M vertices, which belongs in tiles rather than in a page.
-->

<template>
  <div class="ea-page">
    <header class="ea-header">
      <div>
        <NuxtLink to="/" class="ea-back">&larr; Home</NuxtLink>
        <h1 class="ea-title">Environmentally sensitive areas — the LEP additions</h1>
      </div>
      <div v-if="data?.ok" class="ea-header-stat">
        <strong>{{ data.summary.items }}</strong> items ·
        <strong>{{ data.summary.leps }}</strong> plans ·
        <strong>{{ data.summary.layers }}</strong> source layers
      </div>
    </header>

    <div class="ea-body">
      <main class="ea-main">
        <p v-if="error" class="ea-error">Could not load the layer: {{ error }}</p>
        <p v-else-if="data && !data.ok" class="ea-error">{{ data.reason }}</p>

        <!-- ── what it is ─────────────────────────────────────────────────── -->
        <section id="what" class="ea-section">
          <p class="ea-kicker">clause 3.3, the local additions</p>
          <h2 class="ea-h2">What this layer is</h2>
          <p class="ea-lead">{{ ESA_LEAD }}</p>
          <div class="ea-tiers">
            <article class="ea-tier ea-tier--precise">
              <h3 class="ea-tier-title">Precise <span>{{ data?.summary.precise ?? 0 }} items</span></h3>
              <p class="ea-tier-body">
                Drawn from the layers the item names, filtered to its plan or clipped to it.
                <b>{{ fmt(data?.summary.preciseKm2) }} km²</b> in total — land you can point at.
              </p>
            </article>
            <article class="ea-tier ea-tier--advisory">
              <h3 class="ea-tier-title">Advisory <span>{{ data?.summary.advisory ?? 0 }} items</span></h3>
              <p class="ea-tier-body">
                No layer to draw, so the item takes its whole council area and is marked for verification:
                <b>{{ fmt(data?.summary.advisoryKm2) }} km²</b> across {{ data?.summary.advisory ?? 0 }} items. A flag, not a boundary.
              </p>
            </article>
          </div>
          <p v-if="data?.note" class="ea-note"><b>The table says of itself:</b> {{ data.note }}</p>
        </section>

        <!-- ── the items ──────────────────────────────────────────────────── -->
        <section id="items" class="ea-section">
          <p class="ea-kicker">esa.additional_exceptions</p>
          <h2 class="ea-h2">Every exception item</h2>
          <p class="ea-lead">
            One row per lettered exception in a plan's clause 3.3. Filter by tier or plan, or search the wording.
          </p>

          <div class="ea-filters">
            <label class="ea-field">
              <span>Tier</span>
              <select v-model="tier" class="ea-select">
                <option value="">All</option>
                <option value="precise">Precise</option>
                <option value="advisory">Advisory</option>
              </select>
            </label>
            <label class="ea-field">
              <span>Plan</span>
              <select v-model="lep" class="ea-select">
                <option value="">All {{ plans.length }} plans</option>
                <option v-for="p in plans" :key="p" :value="p">{{ p.replace(' Local Environmental Plan', ' LEP') }}</option>
              </select>
            </label>
            <label class="ea-field ea-field--grow">
              <span>Wording</span>
              <input v-model="term" type="search" class="ea-input" placeholder="wetland, escarpment, biobanking…">
            </label>
            <button v-if="tier || lep || term" type="button" class="ea-clear" @click="clearFilters">Clear</button>
          </div>

          <p class="ea-count">{{ filtered.length }} of {{ data?.summary.items ?? 0 }} items</p>

          <div class="ea-tablewrap">
            <table class="ea-table">
              <thead>
                <tr><th>Plan</th><th>Ref</th><th>The exception</th><th>Tier</th><th>Drawn from</th><th class="ea-num">km²</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in filtered" :key="r.id" :class="{ 'ea-row--advisory': r.coverageType === 'advisory' }">
                  <td>
                    {{ (r.lepName || '').replace(' Local Environmental Plan', ' LEP') }}
                    <span v-if="r.lgaName" class="ea-dim ea-block">{{ r.lgaName }}</span>
                  </td>
                  <td><code>{{ r.ref }}</code></td>
                  <td>
                    {{ r.exceptionText }}
                    <span v-if="r.attributeFilter" class="ea-dim ea-block">filtered: <code>{{ r.attributeFilter }}</code></span>
                  </td>
                  <td>
                    <span class="ea-pill" :class="`ea-pill--${r.coverageType}`">{{ r.coverageType }}</span>
                    <span v-if="r.verifyRequired" class="ea-dim ea-block">verify</span>
                  </td>
                  <td>
                    <template v-if="r.sourceLayers">
                      <span class="ea-dim">{{ r.sourceLayers }}</span>
                      <span class="ea-block" :class="r.sourceFeatures ? 'ea-dim' : 'ea-warn'">
                        {{ r.sourceFeatures ? `${r.sourceFeatures} features` : 'returned nothing — fell back to the plan area' }}
                      </span>
                    </template>
                    <span v-else class="ea-dim">{{ STATUS_WORD[r.status ?? ''] ?? r.status }}</span>
                  </td>
                  <td class="ea-num">{{ fmt(r.areaKm2) }}</td>
                </tr>
                <tr v-if="!filtered.length"><td colspan="6" class="ea-dim">Nothing matches that filter.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── the layers ─────────────────────────────────────────────────── -->
        <section id="layers" class="ea-section">
          <p class="ea-kicker">esa.source_layers</p>
          <h2 class="ea-h2">What it is made from</h2>
          <p class="ea-lead">
            Every service the build reads. The plan application layer is the base — each item is filtered to its plan
            or clipped to that plan's area — and the rest are the layers the manifest routes items to.
          </p>
          <div class="ea-tablewrap">
            <table class="ea-table">
              <thead>
                <tr><th>Layer</th><th>Service</th><th class="ea-num">Items</th><th class="ea-num">Plans</th></tr>
              </thead>
              <tbody>
                <tr v-for="l in data?.layers ?? []" :key="l.layerName">
                  <td>
                    {{ l.layerName.replace(/_/g, ' ') }}
                    <span v-if="l.role === 'base'" class="ea-pill ea-pill--base">base</span>
                  </td>
                  <td><a :href="l.endpoint" target="_blank" rel="noopener" class="ea-link"><code>{{ l.service }}</code></a></td>
                  <td class="ea-num">{{ l.items || '—' }}</td>
                  <td class="ea-num">{{ l.leps }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── what needs checking ────────────────────────────────────────── -->
        <section id="checks" class="ea-section">
          <p class="ea-kicker">before anyone relies on it</p>
          <h2 class="ea-h2">What still needs a look</h2>
          <ul class="ea-checks">
            <li>
              <b>{{ fallbacks.length }} items name a layer that returned nothing</b> and fell back to the whole plan
              area: {{ fallbacks.map(f => `${(f.lepName || '').replace(' Local Environmental Plan', ' LEP')} ${f.ref}`).join(', ') }}.
              Usually the plan's name does not match the layer's, or the filter matched no rows.
            </li>
            <li>
              <b>{{ data?.summary.verifyRequired ?? 0 }} items are marked for verification</b> — every advisory one.
              They cover {{ fmt(data?.summary.advisoryKm2) }} km² between them, which is most of this layer's area
              and almost none of its precision.
            </li>
            <li>
              <b>The state-wide part of clause 3.3 is not here.</b> This layer is only what individual plans add.
            </li>
          </ul>
        </section>
      </main>

      <!-- ── the guide ────────────────────────────────────────────────────── -->
      <aside class="ea-guide">
        <div class="ea-guide-inner">
          <h2 class="ea-h2">How the layer is built</h2>
          <p class="ea-guide-lead">
            "07 - ESA - exceptions" builds it in five steps, from a manifest it carries itself.
          </p>
          <ol class="ea-steps">
            <li v-for="s in ESA_STEPS" :key="s.n" class="ea-step">
              <p class="ea-step-title"><span class="ea-step-n">{{ s.n }}</span>{{ s.title }}</p>
              <p class="ea-step-body">{{ s.body }}</p>
              <p v-if="s.note" class="ea-step-note">{{ s.note }}</p>
            </li>
          </ol>
          <h3 class="ea-h3">What it does not tell you</h3>
          <div v-for="c in ESA_CAVEATS" :key="c.title" class="ea-caveat">
            <p class="ea-step-title">{{ c.title }}</p>
            <p class="ea-step-body">{{ c.body }}</p>
          </div>
          <p class="ea-foot">
            Source: <code>esa.additional_exceptions</code> and <code>esa.source_layers</code> on planningai, copied
            from the notebook's output. Rebuild after the notebook runs.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ESA_CAVEATS, ESA_LEAD, ESA_STEPS } from '#shared/esa-method'
import type { EsaBuild } from '../../server/api/esa.get'

useHead({ title: 'Environmentally sensitive areas · Planning Library' })

const { data, error } = await useFetch<EsaBuild>('/api/esa')

/** What an item with no layer behind it is waiting on. */
const STATUS_WORD: Record<string, string> = {
  external: 'an external register',
  derived: 'a derivation, not a published layer',
  not_mappable: 'not mappable',
  layer_found: 'a layer that returned nothing',
}

const tier = ref('')
const lep = ref('')
const term = ref('')

const plans = computed(() => [...new Set((data.value?.items ?? []).map(i => i.lepName).filter(Boolean))] as string[])

const filtered = computed(() => {
  const t = term.value.trim().toLowerCase()
  return (data.value?.items ?? []).filter(i =>
    (!tier.value || i.coverageType === tier.value)
    && (!lep.value || i.lepName === lep.value)
    && (!t || (i.exceptionText ?? '').toLowerCase().includes(t) || (i.sourceLayers ?? '').toLowerCase().includes(t)))
})

/** Precise items whose source came back empty: the layer says so rather than hiding it. */
const fallbacks = computed(() =>
  (data.value?.items ?? []).filter(i => i.coverageType === 'advisory' && i.sourceLayers && !i.sourceFeatures))

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-AU'))

function clearFilters() {
  tier.value = ''
  lep.value = ''
  term.value = ''
}
</script>

<style scoped>
.ea-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.ea-header {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 1.25rem 2rem;
  background: #fff; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 10;
}
.ea-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.3rem; }
.ea-back:hover { color: #0f172a; }
.ea-title { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
.ea-header-stat { font-size: 0.8rem; color: #64748b; }
.ea-header-stat strong { color: #0f172a; font-weight: 700; }

.ea-body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 2rem; max-width: 1500px; margin: 0 auto; padding: 1.5rem 2rem 5rem; align-items: start; }
@media (max-width: 1100px) { .ea-body { grid-template-columns: 1fr; } .ea-guide { position: static; } }
.ea-main { min-width: 0; }
.ea-section { padding-bottom: 2.25rem; margin-bottom: 2.25rem; border-bottom: 1px solid #e2e8f0; }
.ea-section:last-child { border-bottom: none; margin-bottom: 0; }
.ea-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4a3aa7; }
.ea-h2 { margin: 0 0 0.5rem; font-size: 1.4rem; font-weight: 800; color: #0f172a; }
.ea-h3 { margin: 1.4rem 0 0.4rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.ea-lead { margin: 0 0 1.1rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 75ch; }
.ea-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.ea-dim { color: #94a3b8; }
.ea-warn { color: #b45309; }
.ea-block { display: block; font-size: 0.74rem; }
.ea-num { text-align: right; white-space: nowrap; }
.ea-error { margin: 0 0 1.5rem; padding: 0.7rem 0.9rem; border-left: 3px solid #dc2626; background: #fef2f2; color: #991b1b; font-size: 0.9rem; }
.ea-link { color: #2a78d6; text-decoration: none; }
.ea-link:hover { text-decoration: underline; }

.ea-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.9rem; }
.ea-tier { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.9rem 1.1rem; border-left-width: 4px; }
.ea-tier--precise { border-left-color: #15803d; }
.ea-tier--advisory { border-left-color: #d97706; }
.ea-tier-title { margin: 0 0 0.3rem; font-size: 1rem; font-weight: 800; color: #0f172a; }
.ea-tier-title span { margin-left: 0.4rem; font-size: 0.78rem; font-weight: 600; color: #64748b; }
.ea-tier-body { margin: 0; font-size: 0.86rem; line-height: 1.55; color: #334155; }
.ea-note { margin: 1rem 0 0; padding: 0.6rem 0.8rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.8rem; color: #475569; }

.ea-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.7rem; margin-bottom: 0.6rem; }
.ea-field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.ea-field--grow { flex: 1; min-width: 12rem; }
.ea-select, .ea-input { padding: 0.35rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.85rem; font-weight: 400; text-transform: none; letter-spacing: 0; color: #0f172a; }
.ea-clear { padding: 0.4rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.8rem; cursor: pointer; }
.ea-count { margin: 0 0 0.5rem; font-size: 0.8rem; color: #475569; }

.ea-tablewrap { overflow-x: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
.ea-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.ea-table th { padding: 0.5rem 0.7rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.ea-table td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
.ea-table tr:last-child td { border-bottom: 0; }
.ea-table tbody tr:hover { background: #f8fafc; }
.ea-row--advisory { background: #fffbeb; }
.ea-row--advisory:hover { background: #fef3c7; }
.ea-pill { display: inline-block; padding: 0.05em 0.45em; border-radius: 999px; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.ea-pill--precise { background: #dcfce7; color: #15803d; }
.ea-pill--advisory { background: #fef3c7; color: #b45309; }
.ea-pill--base { margin-left: 0.4rem; background: #e0e7ff; color: #4338ca; }
.ea-checks { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.55rem; }
.ea-checks li { font-size: 0.9rem; line-height: 1.55; color: #334155; max-width: 85ch; }

.ea-guide { position: sticky; top: 6rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; max-height: calc(100vh - 8rem); overflow-y: auto; }
.ea-guide-inner { padding: 1rem 1.1rem 1.4rem; }
.ea-guide-lead { margin: 0 0 0.6rem; font-size: 0.86rem; line-height: 1.55; color: #334155; }
.ea-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.8rem; }
.ea-step { padding-bottom: 0.8rem; border-bottom: 1px solid #f1f5f9; }
.ea-step:last-child { border-bottom: 0; padding-bottom: 0; }
.ea-step-title { display: flex; align-items: baseline; gap: 0.45rem; margin: 0 0 0.2rem; font-size: 0.9rem; font-weight: 700; color: #0f172a; }
.ea-step-n { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; flex: none; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.72rem; }
.ea-step-body { margin: 0; font-size: 0.82rem; line-height: 1.55; color: #334155; }
.ea-step-note { margin: 0.4rem 0 0; padding-left: 0.5rem; border-left: 2px solid #cbd5e1; font-size: 0.78rem; line-height: 1.5; color: #57534e; }
.ea-caveat { margin-bottom: 0.7rem; }
.ea-foot { margin: 1rem 0 0; font-size: 0.75rem; line-height: 1.5; color: #64748b; }
@media (max-width: 560px) { .ea-body { padding: 1rem 1rem 4rem; } }
</style>
