<!--
  /pilot - the structure-first rule pilot, document by document.

  A progress board, not a report: what the chain in `Notebooks/08D - LEP pilot chain` has written
  into schema `pilot` for every LEP and SEPP it has run. Per document: the propositions and how they
  classify, the numbers accounted for, the findings that gate a run, the keys, the rounds. The
  bottom section lists what is unresolved, which is the data work the chain cannot do itself.

  Reads /api/pilot/progress. Same shape as /testing-slope: sticky header, a rail, one column.
-->

<template>
  <div class="lp-page">
    <header class="lp-header">
      <div>
        <NuxtLink to="/" class="lp-back">&larr; Home</NuxtLink>
        <h1 class="lp-title">Pilot</h1>
      </div>
      <div v-if="data" class="lp-header-stat">
        <strong>{{ data.totals.leps }}</strong> LEPs · <strong>{{ data.totals.sepps }}</strong> SEPPs ·
        <strong>{{ fmt(data.totals.propositions) }}</strong> propositions ·
        <span :class="data.totals.gating ? 'lp-bad' : 'lp-ok'"><strong>{{ data.totals.gating }}</strong> gating</span> ·
        <span :class="data.totals.keysFailing ? 'lp-bad' : 'lp-ok'">{{ data.totals.keys }} keys, {{ data.totals.keysFailing }} failing</span>
        <span v-if="data.totals.lastRun" class="lp-dim"> · last run {{ ago(data.totals.lastRun) }}</span>
      </div>
    </header>

    <div class="lp-shell">
      <aside class="lp-rail">
        <p class="lp-rail-state">On this page</p>
        <nav aria-label="Sections">
          <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="lp-rail-link">{{ s.label }}</a>
        </nav>
      </aside>

      <main class="lp-main">
        <p v-if="error" class="lp-error">{{ error }}</p>

        <section id="what" class="lp-section">
          <p class="lp-kicker">pilot</p>
          <h2 class="lp-h2">What this measures</h2>
          <p class="lp-lead">
            Every instrument goes through the same loop: structure (stems and their roles), tables, one proposition
            per atomic unit, scope resolution, projection into a shadow document the norms engine evaluates, then the
            keys. A run is <em>held</em> while any Tier-1 or Tier-2 finding gates it or a key fails.
          </p>

          <h3 class="lp-h3">Three bars, not one</h3>
          <p class="lp-lead">
            A plan reading 100% in the <em>Numbers accounted</em> column has cleared the first bar only. The three
            are different claims, and a row is only <em>correct</em> when all three hold.
          </p>
          <div class="lp-tablewrap">
            <table class="lp-table lp-table--defs">
              <thead><tr><th>Bar</th><th>Column</th><th>What it proves</th><th>What it does not prove</th></tr></thead>
              <tbody>
                <tr>
                  <td><strong>1 Extracted</strong></td>
                  <td>Numbers accounted, T1 gating</td>
                  <td>Every figure the pilot's harvester finds in the plan's operative text is carried by some proposition: as a value, a band edge, a condition, or an acknowledged non-rule (a note, an objective, a definition). Nothing was dropped.</td>
                  <td>That the figure landed on the right clause scope, with the right polarity, subject or use. A 450 m² read as "minimum lot for all development" instead of "for dual occupancies in R2" still scores 100% here.</td>
                </tr>
                <tr>
                  <td><strong>2 Classified</strong></td>
                  <td>T2, Refused, Mechanical / Discretionary / Proposal / Data missing</td>
                  <td>Each proposition has a unit its topic can take, a base for any percent, a subject for any permission or prohibition, and a class the engine knows how to evaluate.</td>
                  <td>That the engine picks the right clause for a given lot. A refused (faulty) proposition is held out of the shadow document, never guessed.</td>
                </tr>
                <tr>
                  <td><strong>3 Keyed</strong></td>
                  <td>Keys, Engine keys</td>
                  <td>A hand-verified expected answer holds: a proposition exists with the stated slots (extraction key), or the engine returns the stated verdict and controlling clause for a named lot (engine key). The three pilot plans reached their state with 51 keys, 30 of them on real lots.</td>
                  <td>Anything about clauses no key asks about. A plan with 0 keys has had nothing checked beyond bars 1 and 2: read its row as "nothing refused", not "correct".</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 class="lp-h3">The columns</h3>
          <dl class="lp-defs">
            <dt>Numbers accounted</dt>
            <dd>Share of control numbers in the plan's text (figures with a lot-measuring unit: m², m, storeys, :1, %, dwellings, spaces) that a proposition carries, on the pilot's own harvest. The comparison the chain prints also scores the same plans against 08C's harvest, which finds more figures (spelled-out "square metres", tables flattened into clause text) and is the stricter denominator; the two can differ by 10 to 25 points on a first pass.</dd>
            <dt>T1 gating / noted</dt>
            <dd>Tier-1 findings from the structure and proposition stages. <em>Gating</em> holds the run: an unaccounted number, a number with no topic or comparator, a list whose stem no rule can classify. <em>Noted</em> is recorded and does not hold: a statement that is not a rule, a stem that took its role from its parent list.</dd>
            <dt>T2</dt>
            <dd>Tier-2 findings on the propositions themselves: a unit impossible for the topic, a percent without a base, a standard under a condition stem, an unresolved subject. Each one refuses that proposition (it counts under <em>Refused</em>) rather than publishing a guess.</dd>
            <dt>Mechanical</dt>
            <dd>Answerable from the lot and the proposal alone: zone permissibility, map-valued standards, numeric standards and bands, area labels with a polygon, lot references, corner and frontage tests, overrides between clauses.</dd>
            <dt>Discretionary</dt>
            <dd>A consent-authority satisfaction or consideration test. Extracted with its matters and scope; the engine reports it as a condition the lot must clear, not as yes or no. That is the correct reading, not a gap.</dd>
            <dt>Proposal</dt>
            <dd>Depends on the proposal's own numbers before it resolves: rates (spaces per dwelling), points, formulas, standards of a building element rather than of the lot.</dd>
            <dt>Data missing</dt>
            <dd>Read correctly but nothing in the database answers it: a map label with no polygon in the epi dump, a Lot/DP the cadastre no longer carries, "such development" with no clause number, a Schedule 3 variation whose council polygon is not linked. These are data jobs, listed in the last section.</dd>
            <dt>Refused</dt>
            <dd>Propositions the Tier-2 gate held out of the shadow document. The number the engine would otherwise have been wrong with.</dd>
            <dt>Keys / Engine keys</dt>
            <dd>Extraction keys pass / total, and engine keys pass / total. Keys only grow: a bug found is a key added, never a key removed. Engine keys need a resolver for every scope the clause uses; SEPP defined areas ("low and mid rise housing area") have none yet, so SEPPs show extraction keys only.</dd>
            <dt>Rounds</dt>
            <dd>How many times the proposition stage has run on this instrument. The three pilot plans carry the rounds that built the readers; a Sydney plan at 100% on round 1 is reading with those readers, which is the point of the pilot, not proof the plan is finished.</dd>
          </dl>
        </section>

        <section v-for="grp in groups" :id="grp.id" :key="grp.id" class="lp-section">
          <p class="lp-kicker">{{ grp.kicker }}</p>
          <h2 class="lp-h2">{{ grp.label }} <span class="lp-dim">({{ grp.docs.length }})</span></h2>
          <div class="lp-tablewrap">
            <table class="lp-table">
              <thead>
                <tr>
                  <th>Instrument</th><th class="num">Sections</th><th class="num">Props</th>
                  <th class="num">Mechanical</th><th class="num">Discretionary</th><th class="num">Proposal</th><th class="num">Data missing</th><th class="num">Refused</th>
                  <th class="num">Numbers accounted</th><th class="num">T1 gating</th><th class="num">T2</th>
                  <th class="num">Keys</th><th class="num">Engine keys</th><th class="num">Rounds</th><th>Last run</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in grp.docs" :key="d.id" :class="{ 'lp-row--held': held(d) }">
                  <td>
                    <button class="lp-link" @click="open = open === d.id ? null : d.id">{{ short(d.title) }}</button>
                    <span v-if="held(d)" class="lp-tag lp-tag--bad">held</span>
                    <span v-else class="lp-tag lp-tag--ok">clear</span>
                  </td>
                  <td class="num">{{ fmt(d.sections) }}</td>
                  <td class="num"><button class="lp-cell" @click="openRows(d, 'propositions', {}, 'all propositions')">{{ fmt(d.propositions) }}</button></td>
                  <td class="num"><button class="lp-cell" @click="openRows(d, 'propositions', { classification: 'mechanical' }, 'mechanical propositions')">{{ pct(d.classification.mechanical, d.propositions) }}</button></td>
                  <td class="num"><button class="lp-cell" @click="openRows(d, 'propositions', { classification: 'discretionary' }, 'discretionary propositions')">{{ d.classification.discretionary ?? 0 }}</button></td>
                  <td class="num"><button class="lp-cell" @click="openRows(d, 'propositions', { classification: 'proposal' }, 'proposal-dependent propositions')">{{ d.classification.proposal ?? 0 }}</button></td>
                  <td class="num"><button class="lp-cell" @click="openRows(d, 'propositions', { classification: 'data_missing' }, 'data-missing propositions')">{{ d.classification.data_missing ?? 0 }}</button></td>
                  <td class="num" :class="{ 'lp-bad': d.classification.faulty }"><button class="lp-cell" @click="openRows(d, 'propositions', { classification: 'faulty' }, 'refused propositions')">{{ d.classification.faulty ?? 0 }}</button></td>
                  <td class="num" :class="d.numbersUnaccounted ? 'lp-bad' : 'lp-ok'">
                    <template v-if="d.controlNumbers != null"><button class="lp-cell" @click="openRows(d, 'findings', { kind: 'number_unaccounted' }, 'unaccounted numbers')">{{ pct(d.controlNumbers - (d.numbersUnaccounted ?? 0), d.controlNumbers) }}</button> <span class="lp-dim">of {{ d.controlNumbers }}</span></template>
                    <span v-else class="lp-dim">–</span>
                  </td>
                  <td class="num" :class="d.tier1Gating ? 'lp-bad' : 'lp-ok'"><button class="lp-cell" @click="openRows(d, 'findings', { tier: 1, gating: true }, 'Tier-1 gating findings')">{{ d.tier1Gating ?? '–' }}</button> <button v-if="d.tier1Noted" class="lp-cell lp-dim" @click="openRows(d, 'findings', { tier: 1, gating: false }, 'Tier-1 noted findings')">+{{ d.tier1Noted }}</button></td>
                  <td class="num" :class="d.tier2 ? 'lp-bad' : 'lp-ok'"><button class="lp-cell" @click="openRows(d, 'findings', { tier: 2, gating: true }, 'Tier-2 findings')">{{ d.tier2 ?? '–' }}</button></td>
                  <td class="num" :class="d.keys.fail ? 'lp-bad' : ''"><button class="lp-cell" @click="openRows(d, 'keys', {}, 'keys')">{{ d.keys.pass ?? 0 }}/{{ (d.keys.pass ?? 0) + (d.keys.fail ?? 0) }}<span v-if="d.keys.total" class="lp-dim"> of {{ d.keys.total }}</span></button></td>
                  <td class="num" :class="d.engineKeys.fail ? 'lp-bad' : ''">
                    <template v-if="d.engineKeys.pass != null">{{ d.engineKeys.pass }}/{{ d.engineKeys.pass + (d.engineKeys.fail ?? 0) }}</template>
                    <span v-else class="lp-dim">–</span>
                  </td>
                  <td class="num">{{ d.rounds }}</td>
                  <td class="lp-dim">{{ ago(d.lastRun) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-for="d in grp.docs.filter(x => x.id === open)" :key="d.id + '-detail'" class="lp-detail">
            <h3 class="lp-h3">{{ d.title }}</h3>
            <div class="lp-detail-grid">
              <div>
                <p class="lp-detail-head">Findings</p>
                <table class="lp-mini"><tbody>
                  <tr v-for="f in d.findings.byKind" :key="f.tier + f.kind" class="lp-row--click" @click="openRows(d, 'findings', { kind: f.kind, tier: f.tier, gating: f.gating }, `T${f.tier} ${f.kind}`)">
                    <td>T{{ f.tier }}</td><td>{{ f.kind }}</td><td class="num">{{ f.n }}</td>
                    <td><span class="lp-tag" :class="f.gating ? 'lp-tag--bad' : 'lp-tag--dim'">{{ f.gating ? 'gating' : 'noted' }}</span></td>
                  </tr>
                  <tr v-if="!d.findings.byKind.length"><td colspan="4" class="lp-dim">none</td></tr>
                </tbody></table>
              </div>
              <div>
                <p class="lp-detail-head">Scope resolution</p>
                <table class="lp-mini"><tbody>
                  <tr v-for="(s, dim) in d.scope" :key="dim">
                    <td>{{ dim }}</td>
                    <td class="num lp-ok"><button class="lp-cell" @click="openRows(d, 'scope', { dimension: dim }, `${dim} scope rows`)">{{ s.resolved }}</button></td>
                    <td class="num" :class="s.unresolved ? 'lp-bad' : 'lp-dim'"><button class="lp-cell" @click="openRows(d, 'scope', { dimension: dim, resolution: 'unresolved' }, `unresolved ${dim} rows`)">{{ s.unresolved }}</button></td>
                  </tr>
                </tbody></table>
              </div>
              <div>
                <p class="lp-detail-head">Unresolved values</p>
                <table class="lp-mini"><tbody>
                  <tr v-for="g in d.gaps" :key="g.dimension + g.value" class="lp-row--click" @click="openRows(d, 'scope', { dimension: g.dimension, value: g.value }, `${g.dimension} = ${g.value}`)">
                    <td>{{ g.dimension }}</td><td>{{ g.value }}</td><td class="num">{{ g.n }}</td>
                  </tr>
                  <tr v-if="!d.gaps.length"><td colspan="3" class="lp-dim">none</td></tr>
                </tbody></table>
              </div>
              <div v-if="d.project">
                <p class="lp-detail-head">Projection</p>
                <table class="lp-mini"><tbody>
                  <tr v-for="k in projectKeys(d.project)" :key="k"><td>{{ k }}</td><td class="num">{{ d.project[k] }}</td></tr>
                </tbody></table>
              </div>
            </div>
            <p class="lp-hint lp-dim">
              stages: <span v-for="(t, s) in d.stages" :key="s">{{ s }} {{ ago(t) }} · </span>
            </p>
          </div>
        </section>

        <section id="gaps" class="lp-section">
          <p class="lp-kicker">data</p>
          <h2 class="lp-h2">What the chain cannot resolve</h2>
          <p class="lp-lead">
            Scope rows the readers produced and nothing in the database answers: map labels with no polygon in the epi
            dump, lot and DP references the cadastre no longer carries, "such development" with no clause number. These
            are the data jobs, listed by how often they recur.
          </p>
          <div class="lp-tablewrap">
            <table class="lp-table">
              <thead><tr><th>Dimension</th><th>Value</th><th>Instruments</th><th class="num">Rows</th></tr></thead>
              <tbody>
                <tr v-for="g in gapRows" :key="g.dimension + g.value">
                  <td>{{ g.dimension }}</td><td>{{ g.value }}</td>
                  <td class="lp-dim"><button v-for="dd in g.docRefs" :key="dd.id" class="lp-cell lp-cell--list" @click="openRows(dd, 'scope', { dimension: g.dimension, value: g.value }, `${g.dimension} = ${g.value}`)">{{ short(dd.title) }}</button></td>
                  <td class="num">{{ g.n }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="drill" id="rows" ref="drillEl" class="lp-section lp-drill">
          <p class="lp-kicker">rows from the database</p>
          <h2 class="lp-h2">{{ drill.label }} <span class="lp-dim">· {{ short(drill.doc.title) }}</span></h2>
          <p class="lp-lead">
            <code>pilot.{{ drill.what === 'propositions' ? 'proposition' : drill.what === 'findings' ? 'finding' : drill.what === 'keys' ? 'key' : drill.what === 'nodes' ? 'node' : 'scope' }}</code>
            <span v-for="(v, k) in drill.filters" :key="k"> · {{ k }} = <code>{{ v }}</code></span>
            <span v-if="drill.result"> · <strong>{{ fmt(drill.result.total) }}</strong> rows, showing {{ drill.result.rows.length }}</span>
            <button class="lp-link lp-close" @click="drill = null">close</button>
          </p>
          <p v-if="drill.error" class="lp-error">{{ drill.error }}</p>
          <p v-else-if="!drill.result" class="lp-dim">loading…</p>
          <template v-else>
            <div class="lp-tablewrap lp-tablewrap--rows">
              <table class="lp-table lp-table--rows">
                <thead><tr><th v-for="c in drill.result.columns" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, i) in drill.result.rows" :key="i">
                    <td v-for="c in drill.result.columns" :key="c" :class="{ num: typeof r[c] === 'number', 'lp-dim': r[c] == null }">{{ cell(r[c]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="lp-hint">
              <button v-if="drill.result.rows.length < drill.result.total" class="lp-link" @click="moreRows()">load {{ Math.min(drill.result.limit, drill.result.total - drill.result.rows.length) }} more</button>
            </p>
          </template>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

interface Doc {
  id: string; title: string; docType: 'lep' | 'sepp'; lga: string | null
  sections: number; nodes: number; rounds: number; firstRun: string | null; lastRun: string | null
  propositions: number; classification: Record<string, number>
  controlNumbers: number | null; numbersUnaccounted: number | null
  tier1Gating: number | null; tier1Noted: number | null; tier2: number | null
  keys: { total: number; engine: number; pass: number | null; fail: number | null; deferred: number | null }
  engineKeys: { pass: number | null; fail: number | null }
  project: Record<string, number> | null; structure: any
  scope: Record<string, { resolved: number; unresolved: number }>
  gaps: { dimension: string; value: string; n: number }[]
  findings: { gating: number; noted: number; byKind: { tier: number; kind: string; gating: boolean; n: number }[] }
  stages: Record<string, string>
}
interface Progress { totals: any; documents: Doc[]; generatedAt: string }

const { data, error: fetchError } = await useFetch<Progress>('/api/pilot/progress')
const error = computed(() => (fetchError.value ? String(fetchError.value.message ?? fetchError.value) : null))
const open = ref<string | null>(null)

const sections = [
  { id: 'what', label: 'What this measures' },
  { id: 'leps', label: 'LEPs' },
  { id: 'sepps', label: 'SEPPs' },
  { id: 'gaps', label: 'Unresolved' },
]
const groups = computed(() => [
  { id: 'leps', kicker: 'local environmental plans', label: 'LEPs', docs: (data.value?.documents ?? []).filter(d => d.docType === 'lep') },
  { id: 'sepps', kicker: 'state environmental planning policies', label: 'SEPPs', docs: (data.value?.documents ?? []).filter(d => d.docType === 'sepp') },
])
const gapRows = computed(() => {
  const m = new Map<string, { dimension: string; value: string; docRefs: { id: string; title: string }[]; n: number }>()
  for (const d of data.value?.documents ?? []) {
    for (const g of d.gaps) {
      const k = g.dimension + '|' + g.value
      const r = m.get(k) ?? { dimension: g.dimension, value: g.value, docRefs: [], n: 0 }
      r.docRefs.push({ id: d.id, title: d.title }); r.n += g.n; m.set(k, r)
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 60)
})

// ---- the drill-down: the rows behind a cell, straight from the pilot tables, columns as returned
type What = 'findings' | 'scope' | 'propositions' | 'keys' | 'nodes'
interface RowsResult { what: What; total: number; limit: number; offset: number; columns: string[]; rows: Record<string, any>[] }
interface Drill { doc: { id: string; title: string }; what: What; filters: Record<string, string | number | boolean>; label: string; result: RowsResult | null; error: string | null }
const drill = ref<Drill | null>(null)
const drillEl = ref<HTMLElement | null>(null)

async function fetchRows(d: Drill, offset = 0): Promise<RowsResult> {
  const query: Record<string, string> = { doc: d.doc.id, what: d.what, limit: '200', offset: String(offset) }
  for (const [k, v] of Object.entries(d.filters)) query[k] = String(v)
  return await $fetch<RowsResult>('/api/pilot/rows', { query })
}
async function openRows(doc: { id: string; title: string }, what: What, filters: Record<string, string | number | boolean>, label: string) {
  drill.value = { doc: { id: doc.id, title: doc.title }, what, filters, label, result: null, error: null }
  const d = drill.value            // the reactive proxy: writes to the plain object never reach the template
  await nextTick()
  drillEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  try { d.result = await fetchRows(d) } catch (e: any) { d.error = String(e?.data?.statusMessage ?? e?.message ?? e) }
}
async function moreRows() {
  const d = drill.value
  if (!d?.result) return
  try {
    const next = await fetchRows(d, d.result.rows.length)
    d.result = { ...next, rows: [...d.result.rows, ...next.rows] }
  } catch (e: any) { d.error = String(e?.data?.statusMessage ?? e?.message ?? e) }
}
function cell(v: any) {
  if (v == null) return '–'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return v.replace('T', ' ').slice(0, 16)
  return String(v)
}

function held(d: Doc) {
  return (d.tier1Gating ?? 0) > 0 || (d.tier2 ?? 0) > 0 || (d.keys.fail ?? 0) > 0 || (d.engineKeys.fail ?? 0) > 0 || (d.classification.faulty ?? 0) > 0
}
function short(t: string) {
  return t.replace('State Environmental Planning Policy', 'SEPP').replace(' Local Environmental Plan', ' LEP')
}
function fmt(n: number | null | undefined) { return n == null ? '–' : n.toLocaleString() }
function pct(a: number | null | undefined, b: number | null | undefined) {
  if (!b) return '–'
  return `${Math.round((100 * (a ?? 0)) / b)}%`
}
function ago(t: string | null) {
  if (!t) return '–'
  // relative to the moment the API answered, not to Date.now(): the server and the client then
  // render the same text and hydration does not complain about "26 min ago" vs "27 min ago"
  const now = data.value?.generatedAt ? new Date(data.value.generatedAt).getTime() : Date.now()
  const s = (now - new Date(t).getTime()) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const PROJECT_ORDER = ['rules', 'effects', 'applicability', 'spatial', 'band_rows', 'overrides_edges', 'reference_resolved', 'reference_unresolved',
  'applies_folded_down', 'unattached_condition', 'unattached_exception', 'without_subject_demoted', 'exclusion_held_open']
function projectKeys(p: Record<string, number>) {
  return [...PROJECT_ORDER.filter(k => k in p), ...Object.keys(p).filter(k => !PROJECT_ORDER.includes(k))]
}
</script>

<style>
body { margin: 0; background: #f8fafb; }
</style>

<style scoped>
.lp-page { min-height: 100vh; background: #f8fafb; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
.lp-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 1.25rem 2rem; background: #fff; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10; }
.lp-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.3rem; }
.lp-back:hover { color: #0f172a; }
.lp-title { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
.lp-header-stat { font-size: 0.8rem; color: #64748b; }
.lp-header-stat strong { color: #0f172a; font-weight: 700; }
.lp-shell { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 2rem; max-width: 1500px; margin: 0 auto; padding: 1.5rem 2rem 5rem; align-items: start; }
.lp-rail { position: sticky; top: 6rem; display: flex; flex-direction: column; gap: 0.1rem; }
.lp-rail-state { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lp-rail-link { display: block; padding: 0.3rem 0.6rem; border-left: 2px solid #e2e8f0; font-size: 0.84rem; color: #475569; text-decoration: none; }
.lp-rail-link:hover { color: #0f172a; border-left-color: #94a3b8; }
.lp-main { min-width: 0; }
.lp-section { scroll-margin-top: 6rem; padding-bottom: 2.5rem; margin-bottom: 2.5rem; border-bottom: 1px solid #e2e8f0; }
.lp-section:last-child { border-bottom: none; margin-bottom: 0; }
.lp-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4a3aa7; }
.lp-h2 { margin: 0 0 0.5rem; font-size: 1.45rem; font-weight: 800; color: #0f172a; }
.lp-h3 { margin: 0 0 0.6rem; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
.lp-lead { margin: 0 0 1.25rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 80ch; }
.lp-dim { color: #94a3b8; }
.lp-ok { color: #15803d; font-weight: 700; }
.lp-bad { color: #b91c1c; font-weight: 700; }
.lp-error { color: #b91c1c; margin: 0.5rem 0 0; }
.lp-hint { margin: 0.5rem 0 0; font-size: 0.78rem; }
.lp-tablewrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.lp-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.lp-table th, .lp-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #f1f5f9; text-align: left; white-space: nowrap; }
.lp-table th { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; background: #f8fafc; position: sticky; top: 0; }
.lp-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.lp-row--held td:first-child { box-shadow: inset 3px 0 0 #b91c1c; }
.lp-link { background: none; border: 0; padding: 0; font: inherit; color: #0f172a; font-weight: 700; cursor: pointer; }
.lp-link:hover { color: #4a3aa7; text-decoration: underline; }
.lp-cell { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-decoration: underline dotted #cbd5e1; text-underline-offset: 3px; }
.lp-cell:hover { color: #4a3aa7; text-decoration-color: #4a3aa7; }
.lp-cell--list { margin-right: 0.5rem; }
.lp-row--click { cursor: pointer; }
.lp-row--click:hover td { background: #f5f3ff; }
.lp-close { margin-left: 1rem; font-size: 0.8rem; color: #64748b; }
.lp-drill { border-top: 3px solid #4a3aa7; padding-top: 1rem; }
.lp-tablewrap--rows { max-height: 70vh; overflow: auto; }
.lp-table--rows th, .lp-table--rows td { white-space: normal; vertical-align: top; min-width: 6rem; max-width: 32rem; font-size: 0.76rem; line-height: 1.4; }
.lp-table--rows td.num { white-space: nowrap; }
.lp-tag { margin-left: 0.4rem; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.68rem; font-weight: 700; border: 1px solid; }
.lp-tag--ok { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.lp-tag--bad { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
.lp-tag--dim { color: #64748b; border-color: #e2e8f0; background: #f8fafc; }
.lp-detail { margin-top: 1rem; border: 1px solid #ddd6fe; border-radius: 10px; background: #fff; padding: 1rem 1.1rem; }
.lp-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem; }
.lp-detail-head { margin: 0 0 0.4rem; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #4a3aa7; }
.lp-mini { border-collapse: collapse; font-size: 0.78rem; width: 100%; }
.lp-mini td { padding: 0.18rem 0.4rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
.lp-mini .num { text-align: right; font-variant-numeric: tabular-nums; }
.lp-table--defs th, .lp-table--defs td { white-space: normal; vertical-align: top; font-size: 0.82rem; line-height: 1.5; }
.lp-table--defs td:first-child { white-space: nowrap; }
.lp-defs { margin: 0.75rem 0 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.45rem 1.25rem; font-size: 0.84rem; max-width: 95ch; }
.lp-defs dt { font-weight: 700; color: #0f172a; }
.lp-defs dd { margin: 0; color: #334155; line-height: 1.55; }
@media (max-width: 700px) { .lp-defs { grid-template-columns: 1fr; } .lp-defs dt { margin-top: 0.5rem; } }
@media (max-width: 900px) { .lp-shell { grid-template-columns: 1fr; padding: 1rem 16px 4rem; } .lp-rail { display: none; } }
</style>
