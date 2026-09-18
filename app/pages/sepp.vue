<!--
  /sepp - what a SEPP permits in a zone, where that list comes from, and what it does not say.

  An LEP's land use table decides what may be built in a zone; a State policy can permit something
  the LEP does not. The 263 rows here are that second layer, as the pipeline holds it: transcribed
  into "05 - Import SEPP Permissible Landuse" from the Department's land use matrix, loaded into
  UrbanPortalDBP, and copied into planningai as nsw.sepp_permissible_landuse, which /api/sepp reads.

  The page exists because those rows travel a long way - notebook 06 attaches them to every property
  as sepp_landuses and sepps, and the property report shows them - while carrying none of the
  conditions the policies attach. Saying that plainly next to the table is the point of the page.

  Laid out like /datasources and /testing-spatial-services: sticky header, rail, one column.
-->

<template>
  <div class="sp-page">
    <header class="sp-header">
      <div>
        <NuxtLink to="/" class="sp-back">&larr; Home</NuxtLink>
        <h1 class="sp-title">SEPP permissible land uses</h1>
      </div>
      <div v-if="data?.ok" class="sp-header-stat">
        <strong>{{ data.summary.rows }}</strong> rows ·
        <strong>{{ data.summary.uses }}</strong> uses ·
        <strong>{{ data.summary.zones }}</strong> zones ·
        <strong>{{ data.summary.sepps }}</strong> SEPPs
      </div>
    </header>

    <div class="sp-shell">
      <aside class="sp-rail">
        <p class="sp-rail-state">On this page</p>
        <nav aria-label="Sections">
          <a v-for="s in SECTIONS" :key="s.id" :href="`#${s.id}`" class="sp-rail-link">{{ s.label }}</a>
        </nav>
      </aside>

      <main class="sp-main">
        <p v-if="error" class="sp-error">Could not load the table: {{ error }}</p>
        <p v-else-if="data && !data.ok" class="sp-error">{{ data.reason }}</p>

        <!-- ── what it is ─────────────────────────────────────────────────── -->
        <section id="what" class="sp-section">
          <p class="sp-kicker">the second layer</p>
          <h2 class="sp-h2">What this is</h2>
          <p class="sp-lead">
            A local environmental plan's land use table decides what may be built in a zone. A State
            environmental planning policy can permit something the plan does not, and where the two disagree
            the policy wins. This is that second layer as the pipeline holds it: for each zone, the uses two
            SEPPs make permissible, whatever the local plan says.
          </p>
          <div class="sp-cards">
            <article v-for="s in data?.summary.bySepp ?? []" :key="s.sepp" class="sp-card">
              <h3 class="sp-card-title">{{ shortSepp(s.sepp) }}</h3>
              <p class="sp-card-stat"><strong>{{ s.rows }}</strong> rows · {{ s.uses }} uses · {{ s.zones }} zones</p>
              <p class="sp-card-body">{{ SEPP_BLURB[shortSepp(s.sepp)] }}</p>
            </article>
          </div>
        </section>

        <!-- ── where it comes from ────────────────────────────────────────── -->
        <section id="where" class="sp-section">
          <p class="sp-kicker">provenance</p>
          <h2 class="sp-h2">Where the rows come from</h2>
          <p class="sp-lead">
            Nobody reads these out of the legislation at run time. They were transcribed once and have
            travelled by copy ever since, which is worth knowing before trusting them.
          </p>
          <ol class="sp-chain">
            <li v-for="step in CHAIN" :key="step.title" class="sp-chain-step">
              <p class="sp-chain-title">{{ step.title }}</p>
              <p class="sp-chain-body">{{ step.body }}</p>
            </li>
          </ol>
          <p v-if="data?.note" class="sp-note"><b>The table says of itself:</b> {{ data.note }}</p>
        </section>

        <!-- ── the logic ──────────────────────────────────────────────────── -->
        <section id="logic" class="sp-section">
          <p class="sp-kicker">how a use gets here</p>
          <h2 class="sp-h2">The logic behind a row</h2>
          <p class="sp-lead">
            Each row says: this SEPP permits this use on land in this zone. The two policies get there
            differently.
          </p>
          <div class="sp-cards">
            <article v-for="l in LOGIC" :key="l.title" class="sp-card">
              <h3 class="sp-card-title">{{ l.title }}</h3>
              <p class="sp-card-body">{{ l.body }}</p>
            </article>
          </div>
        </section>

        <!-- ── downstream ─────────────────────────────────────────────────── -->
        <section id="use" class="sp-section">
          <p class="sp-kicker">downstream</p>
          <h2 class="sp-h2">What reads it</h2>
          <p class="sp-lead">
            Notebook 06 joins this table to every property on the zone code alone, at step 7.5b, and writes two
            columns beside the LEP's own permitted list.
          </p>
          <ul class="sp-flow">
            <li v-for="f in FLOW" :key="f.label">
              <code>{{ f.label }}</code><span>{{ f.body }}</span>
            </li>
          </ul>
        </section>

        <!-- ── the caveats ────────────────────────────────────────────────── -->
        <section id="limits" class="sp-section">
          <p class="sp-kicker">read this first</p>
          <h2 class="sp-h2">What the table does not say</h2>
          <ul class="sp-limits">
            <li v-for="l in LIMITS" :key="l.title">
              <b>{{ l.title }}</b> {{ l.body }}
            </li>
          </ul>
        </section>

        <!-- ── the table ──────────────────────────────────────────────────── -->
        <section id="table" class="sp-section">
          <p class="sp-kicker">nsw.sepp_permissible_landuse</p>
          <h2 class="sp-h2">The table</h2>
          <p class="sp-lead">Every row, as loaded. Filter by policy or zone, or search the use.</p>

          <div class="sp-filters">
            <label class="sp-field">
              <span>SEPP</span>
              <select v-model="seppFilter" class="sp-select">
                <option value="">All</option>
                <option v-for="s in data?.summary.bySepp ?? []" :key="s.sepp" :value="s.sepp">{{ shortSepp(s.sepp) }}</option>
              </select>
            </label>
            <label class="sp-field">
              <span>Zone</span>
              <select v-model="zoneFilter" class="sp-select">
                <option value="">All</option>
                <option v-for="z in data?.summary.byZone ?? []" :key="z.zone" :value="z.zone">{{ z.zone }} ({{ z.rows }})</option>
              </select>
            </label>
            <label class="sp-field sp-field--grow">
              <span>Land use</span>
              <input v-model="term" type="search" class="sp-input" placeholder="seniors, schools, sewage…">
            </label>
            <button v-if="seppFilter || zoneFilter || term" type="button" class="sp-clear" @click="clearFilters">Clear</button>
          </div>

          <p class="sp-count">
            {{ filtered.length }} of {{ data?.summary.rows ?? 0 }} rows
            <span v-if="filtered.length" class="sp-dim">· {{ new Set(filtered.map(r => r.landUse)).size }} uses across {{ new Set(filtered.map(r => r.zone)).size }} zones</span>
          </p>

          <div class="sp-tablewrap">
            <table class="sp-table">
              <thead>
                <tr><th>Zone</th><th>Land use</th><th>Permitted by</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in filtered" :key="`${r.zone}|${r.sepp}|${r.landUse}`">
                  <td><code>{{ r.zone }}</code></td>
                  <td>{{ r.landUse }}</td>
                  <td class="sp-dim">{{ shortSepp(r.sepp) }}</td>
                </tr>
                <tr v-if="!filtered.length"><td colspan="3" class="sp-dim">Nothing matches that filter.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── by zone ────────────────────────────────────────────────────── -->
        <section id="zones" class="sp-section">
          <p class="sp-kicker">by zone</p>
          <h2 class="sp-h2">Every zone, and what a SEPP adds to it</h2>
          <p class="sp-lead">
            The same rows read the other way round: what a property in each zone picks up from these two
            policies, which is exactly what notebook 06 attaches to it.
          </p>
          <div class="sp-zones">
            <article v-for="z in data?.summary.byZone ?? []" :key="z.zone" class="sp-zone">
              <p class="sp-zone-code"><code>{{ z.zone }}</code> <span class="sp-dim">{{ z.rows }}</span></p>
              <p class="sp-zone-uses">{{ z.uses.join(', ') }}</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SeppPermissibility } from '../../server/api/sepp.get'

useHead({ title: 'SEPP permissible land uses · Planning Library' })

const { data, error } = await useFetch<SeppPermissibility>('/api/sepp')

const SECTIONS = [
  { id: 'what', label: 'What this is' },
  { id: 'where', label: 'Where the rows come from' },
  { id: 'logic', label: 'The logic behind a row' },
  { id: 'use', label: 'What reads it' },
  { id: 'limits', label: 'What it does not say' },
  { id: 'table', label: 'The table' },
  { id: 'zones', label: 'Every zone' },
]

/** "State Environmental Planning Policy (Housing) 2021" reads as "Housing 2021" in a table cell. */
function shortSepp(name: string): string {
  return name.replace(/^State Environmental Planning Policy\s*/i, '').replace(/[()]/g, '')
}

const SEPP_BLURB: Record<string, string> = {
  'Housing 2021': 'Housing the State wants built wherever the zone allows housing at all: seniors housing and the '
    + 'independent living units and residential care facilities that go with it, group homes, secondary dwellings, and '
    + 'dual occupancies and semi-detached dwellings in R2.',
  'Transport and Infrastructure 2021': 'The things a public authority builds: schools and educational establishments, '
    + 'hospitals, health services and medical centres, emergency services facilities, and the sewage, water recycling, '
    + 'waste and electricity works that serve them.',
}

const CHAIN = [
  {
    title: 'The Department’s land use matrix',
    body: 'A spreadsheet the Department publishes, setting out which uses each SEPP permits in each zone. The copy on '
      + 'the planning site is dated March 2023.',
  },
  {
    title: '05 - Import SEPP Permissible Landuse',
    body: 'The notebook carries the 263 records inline as a JSON literal - no file is read at run time - and loads them '
      + 'into UrbanPortalDBP as public."SEPP_Permissible_Landuse", truncating and reloading so a re-run is safe.',
  },
  {
    title: 'nsw.sepp_permissible_landuse on planningai',
    body: 'The same rows, copied across and checked row for row, because the app reads planningai and never '
      + 'UrbanPortalDBP. This page reads that copy.',
  },
  {
    title: 'The property pipeline',
    body: 'Notebook 06 joins the table to every property by zone, and notebook 09 carries the result into the property '
      + 'table the app reads.',
  },
]

const LOGIC = [
  {
    title: 'Housing 2021',
    body: 'The policy names the zones a use is permitted in and overrides the local plan there. Seniors housing and '
      + 'residential care are allowed in zones that permit housing, group homes reach further, and dual occupancy in R2 '
      + 'is the first stage of the low and mid-rise reforms, from July 2024.',
  },
  {
    title: 'Transport and Infrastructure 2021',
    body: 'Infrastructure is permitted by the policy rather than by the plan, so a school or a sewage treatment plant '
      + 'can be built in zones whose land use table never mentions it. Most of it is conditional on who is carrying out '
      + 'the development, and some of it needs no consent at all.',
  },
  {
    title: 'Why this is separate from the LEP list',
    body: 'The LEP permitted list is resolved per plan and zone from the land use tables (nsw.lep_permissibility, '
      + '483,598 rows). These 263 rows are added on top: a use can be prohibited by the plan and still be permissible '
      + 'because a SEPP says so.',
  },
]

const FLOW = [
  { label: 'lzn_sym_code', body: ' — the property’s zone codes, split on commas so split-zoned land counts under each zone.' },
  { label: 'JOIN … ON zone', body: ' — matched to this table on the zone code alone: no plan, no council, no geometry.' },
  { label: 'sepp_landuses', body: ' — the matched uses, comma separated, one column on the property.' },
  { label: 'sepps', body: ' — the policies that granted them, aggregated separately, so which SEPP granted which use is lost.' },
  { label: 'up_property_d_4', body: ' — where notebook 09 writes both columns, and what the property report reads.' },
]

const LIMITS = [
  {
    title: 'The conditions are gone.',
    body: 'Most Transport and Infrastructure entries apply only to development by or for a public authority, and some '
      + 'need no consent. The table records neither, so it reads more permissively than the policy.',
  },
  {
    title: 'The 2025 low and mid-rise round is missing.',
    body: 'Since February 2025 the Housing SEPP also permits multi dwelling housing, terraces, manor houses, '
      + 'residential flat buildings and shop top housing in R1 to R4 inside the mapped low and mid-rise areas. None of '
      + 'that is here, and it is area-based rather than zone-based, so it could not be carried by this table as it stands.',
  },
  {
    title: 'A zone is the whole test.',
    body: 'Every R2 lot in the State gets the same answer. Nothing narrows it by council, plan, overlay or map.',
  },
  {
    title: 'It is a transcription.',
    body: 'The rows carry no clause reference and no date of their own, so a row cannot be traced back to the provision '
      + 'it came from, or checked against an amendment.',
  },
]

const seppFilter = ref('')
const zoneFilter = ref('')
const term = ref('')

const filtered = computed(() => {
  const t = term.value.trim().toLowerCase()
  return (data.value?.rows ?? []).filter(r =>
    (!seppFilter.value || r.sepp === seppFilter.value)
    && (!zoneFilter.value || r.zone === zoneFilter.value)
    && (!t || r.landUse.toLowerCase().includes(t)))
})

function clearFilters() {
  seppFilter.value = ''
  zoneFilter.value = ''
  term.value = ''
}
</script>

<style scoped>
.sp-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.sp-header {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 1.25rem 2rem;
  background: #fff; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 10;
}
.sp-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.3rem; }
.sp-back:hover { color: #0f172a; }
.sp-title { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
.sp-header-stat { font-size: 0.8rem; color: #64748b; }
.sp-header-stat strong { color: #0f172a; font-weight: 700; }

.sp-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 2.25rem; max-width: 1360px; margin: 0 auto; padding: 1.5rem 2rem 5rem; align-items: start; }
@media (max-width: 900px) { .sp-shell { grid-template-columns: 1fr; } .sp-rail { position: static; } }
.sp-rail { position: sticky; top: 6rem; display: flex; flex-direction: column; gap: 0.1rem; }
.sp-rail-state { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.sp-rail-link { display: block; padding: 0.3rem 0.6rem; border-left: 2px solid #e2e8f0; font-size: 0.84rem; color: #475569; text-decoration: none; }
.sp-rail-link:hover { color: #0f172a; border-left-color: #94a3b8; }

.sp-main { min-width: 0; }
.sp-section { scroll-margin-top: 6rem; padding-bottom: 2.5rem; margin-bottom: 2.5rem; border-bottom: 1px solid #e2e8f0; }
.sp-section:last-child { border-bottom: none; margin-bottom: 0; }
.sp-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4a3aa7; }
.sp-h2 { margin: 0 0 0.5rem; font-size: 1.45rem; font-weight: 800; color: #0f172a; }
.sp-lead { margin: 0 0 1.25rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 75ch; }
.sp-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.sp-dim { color: #94a3b8; }
.sp-error { margin: 0 0 1.5rem; padding: 0.7rem 0.9rem; border-left: 3px solid #dc2626; background: #fef2f2; color: #991b1b; font-size: 0.9rem; }

.sp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.9rem; }
.sp-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.9rem 1.1rem; }
.sp-card-title { margin: 0 0 0.2rem; font-size: 1rem; font-weight: 800; color: #0f172a; }
.sp-card-stat { margin: 0 0 0.45rem; font-size: 0.78rem; color: #64748b; }
.sp-card-stat strong { color: #0f172a; }
.sp-card-body { margin: 0; font-size: 0.86rem; line-height: 1.55; color: #334155; }

.sp-chain { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; counter-reset: chain; }
.sp-chain-step { position: relative; padding-left: 2rem; }
.sp-chain-step::before {
  counter-increment: chain; content: counter(chain);
  position: absolute; left: 0; top: 0.1rem;
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.4rem; height: 1.4rem; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.72rem; font-weight: 700;
}
.sp-chain-title { margin: 0; font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.sp-chain-body { margin: 0.1rem 0 0; font-size: 0.86rem; line-height: 1.55; color: #334155; max-width: 80ch; }
.sp-note { margin: 1rem 0 0; padding: 0.6rem 0.8rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.8rem; color: #475569; }

.sp-flow { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
.sp-flow li { font-size: 0.88rem; color: #334155; }
.sp-limits { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.55rem; }
.sp-limits li { font-size: 0.9rem; line-height: 1.55; color: #334155; max-width: 85ch; }

.sp-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.7rem; margin-bottom: 0.7rem; }
.sp-field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.sp-field--grow { flex: 1; min-width: 12rem; }
.sp-select, .sp-input { padding: 0.35rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.85rem; font-weight: 400; text-transform: none; letter-spacing: 0; color: #0f172a; }
.sp-clear { padding: 0.4rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 0.8rem; cursor: pointer; }
.sp-clear:hover { border-color: #94a3b8; }
.sp-count { margin: 0 0 0.5rem; font-size: 0.8rem; color: #475569; }

.sp-tablewrap { overflow-x: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
.sp-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.sp-table th { position: sticky; top: 0; padding: 0.5rem 0.75rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.sp-table td { padding: 0.4rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
.sp-table tr:last-child td { border-bottom: 0; }
.sp-table tbody tr:hover { background: #f8fafc; }

.sp-zones { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0.6rem; }
.sp-zone { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.6rem 0.8rem; }
.sp-zone-code { margin: 0 0 0.2rem; font-size: 0.9rem; font-weight: 700; }
.sp-zone-uses { margin: 0; font-size: 0.8rem; line-height: 1.5; color: #475569; }
@media (max-width: 560px) { .sp-shell { padding: 1rem 1rem 4rem; } }
</style>
