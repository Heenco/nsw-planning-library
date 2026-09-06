<!--
  /graph — what actually made it into the knowledge graph.

  Every ingest failure in this project has been silent: the parser dropped half
  the Hornsby LEP without erroring, the pilot import stored 59 sections where
  the document has 1214, and the report ran on it regardless. What is in the
  database is always self-consistent; it is the absence that matters. So each
  figure here is measured against the source file, which declares its own
  clause and character counts.

  Counting what arrived turned out not to be enough. Randwick's DCP holds 1,658
  rules -- three times Hornsby's -- and only 326 of them carry a land use or a
  development type, which are the two things the report's scope query matches
  on. Four rules in five are in the database and cannot reach a property report,
  and every count on this page read healthy while that was true. So the table
  also measures reach: whether the rule layer can answer the questions the
  report asks of it, not merely whether it exists.
-->

<template>
  <div class="gm-page">
    <header class="gm-header">
      <NuxtLink to="/" class="gm-back">&larr; Home</NuxtLink>
      <h1 class="gm-title">Graph coverage</h1>
      <p class="gm-meta">
        Every document in the graph, measured against its source file.
        <button class="gm-refresh" :disabled="loading" @click="load(true)">
          {{ loading ? 'Checking…' : 'Re-check' }}
        </button>
      </p>
    </header>

    <div v-if="error" class="gm-error">{{ error }}</div>
    <div v-else-if="loading && !documents.length" class="gm-loading">Reading source files…</div>

    <template v-else>
      <!-- The headline number is the pipeline stage, not the section count.
           23,000 sections reads as healthy while almost none of it is
           reachable by retrieval. -->
      <div class="gm-summary">
        <div class="gm-stat">
          <span class="gm-stat-num">{{ documents.length }}</span>
          <span class="gm-stat-label">documents</span>
        </div>
        <div class="gm-stat">
          <span class="gm-stat-num">{{ total('sections').toLocaleString() }}</span>
          <span class="gm-stat-label">sections</span>
        </div>
        <div class="gm-stat" :class="atStage('propositions') < documents.length ? 'gm-stat--warn' : ''">
          <span class="gm-stat-num">{{ atStage('propositions') }} / {{ documents.length }}</span>
          <span class="gm-stat-label">searchable (have propositions)</span>
        </div>
        <div class="gm-stat" :class="atStage('rules') < documents.length ? 'gm-stat--warn' : ''">
          <span class="gm-stat-num">{{ atStage('rules') }} / {{ documents.length }}</span>
          <span class="gm-stat-label">have a rule layer</span>
        </div>
        <div class="gm-stat" :class="reachTotal.pct !== null && reachTotal.pct < 80 ? 'gm-stat--warn' : ''">
          <span class="gm-stat-num">{{ reachTotal.pct === null ? '—' : reachTotal.pct + '%' }}</span>
          <span class="gm-stat-label">
            of rules the report can scope
            <template v-if="reachTotal.pct !== null">
              ({{ (reachTotal.rules - reachTotal.scopable).toLocaleString() }} unreachable)
            </template>
          </span>
        </div>
      </div>

      <div class="gm-scroll">
      <table class="gm-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Stage</th>
            <th class="gm-num">Clauses kept</th>
            <th class="gm-num">Text kept</th>
            <th class="gm-num">Sections</th>
            <th class="gm-num">Props</th>
            <th class="gm-num">Rules</th>
            <th class="gm-num">Scopable</th>
            <th>Applicability</th>
            <th>Needs attention</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in grouped" :key="group.type">
            <tr class="gm-group"><td colspan="10">{{ group.type.toUpperCase() }}</td></tr>
            <tr v-for="d in group.rows" :key="d.slug">
              <td>
                <span class="gm-name">{{ shortTitle(d) }}</span>
                <span v-if="d.lga" class="gm-lga">{{ d.lga }}</span>
              </td>
              <td><span class="gm-stage" :class="`gm-stage--${d.stage}`">{{ d.stage }}</span></td>
              <td class="gm-num">
                <span v-if="d.structuralPct === null" class="gm-na">&mdash;</span>
                <span v-else class="gm-bar-wrap">
                  <span class="gm-bar" :class="tone(d.structuralPct)" :style="{ width: d.structuralPct + '%' }" />
                  <span class="gm-bar-text">{{ d.structuralPct }}%{{ d.source?.approximate ? ' approx' : '' }}</span>
                </span>
              </td>
              <td class="gm-num">
                <span v-if="d.textPct === null" class="gm-na">&mdash;</span>
                <span v-else class="gm-bar-wrap">
                  <span class="gm-bar" :class="tone(d.textPct)" :style="{ width: d.textPct + '%' }" />
                  <span class="gm-bar-text">{{ d.textPct }}%{{ d.source?.approximate ? ' approx' : '' }}</span>
                </span>
              </td>
              <td class="gm-num">{{ d.db.sections.toLocaleString() }}</td>
              <td class="gm-num" :class="!d.db.propositions ? 'gm-zero' : ''">{{ d.db.propositions.toLocaleString() }}</td>
              <td class="gm-num" :class="!d.db.rules ? 'gm-zero' : ''">{{ d.db.rules.toLocaleString() }}</td>
              <td class="gm-num">
                <span v-if="!d.db.rules" class="gm-na">&mdash;</span>
                <span v-else class="gm-bar-wrap">
                  <span class="gm-bar" :class="tone(scopablePct(d))" :style="{ width: scopablePct(d) + '%' }" />
                  <span class="gm-bar-text">{{ scopablePct(d) }}%</span>
                </span>
              </td>
              <td>
                <div class="gm-dims">
                <!-- Presence, not counts. Each dimension switches on a specific
                     behaviour, and its absence disables that behaviour silently:
                     with no `act` the report cannot tell a standard for building
                     from one for subdividing, and with no zone it cannot keep a
                     rural clause off a suburban lot. -->
                <span
                  v-for="dim in dimChips(d)"
                  :key="dim.key"
                  class="gm-dim"
                  :class="dim.n ? 'gm-dim--on' : 'gm-dim--off'"
                  :title="dim.title"
                >{{ dim.key }}</span>
                <span v-if="d.reach.spatialResolved" class="gm-dim gm-dim--geo"
                      :title="`${d.reach.spatialResolved} spatial references resolved to real geometry`">
                  geom {{ d.reach.spatialResolved }}
                </span>
                </div>
              </td>
              <td>
                <div class="gm-flags">
                  <span v-for="f in flags(d)" :key="f" class="gm-flag">{{ f }}</span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      </div>

      <p class="gm-note">
        <strong>Clauses kept</strong> and <strong>text kept</strong> compare the database
        against the source file: the XML declares how many clauses and characters it
        holds, so a shortfall is arithmetic rather than opinion. Figures marked
        <em>approx</em> come from an HTML source, which carries no structural
        vocabulary to count — treat those as indicative only.
        A document at stage <em>sections</em> has its text but nothing retrieval can
        search; at <em>propositions</em> it is searchable; at <em>rules</em> it can
        answer numeric questions.
        <strong>Scopable</strong> is the share of rules carrying a land use or a
        development type &mdash; the two things the report's own scope query
        matches on, so a rule without either cannot reach a property report
        whatever else is right about it.
        <strong>Applicability</strong> shows which dimensions the extractor filled:
        a missing one does not fail, it quietly removes an ability.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
const documents = ref<any[]>([])
const loading = ref(true)
const error = ref('')

async function load(refresh = false) {
  loading.value = true
  error.value = ''
  try {
    const r: any = await $fetch('/api/graph-coverage', { query: refresh ? { refresh: 1 } : {} })
    documents.value = r.documents || []
  } catch (e: any) {
    error.value = e?.message || 'Could not read coverage'
  } finally {
    loading.value = false
  }
}
onMounted(() => load())

const grouped = computed(() => {
  const by = new Map<string, any[]>()
  for (const d of documents.value) {
    if (!by.has(d.docType)) by.set(d.docType, [])
    by.get(d.docType)!.push(d)
  }
  // Worst first inside each group, so what needs attention is at the top.
  for (const rows of by.values()) {
    rows.sort((a, b) => (a.structuralPct ?? -1) - (b.structuralPct ?? -1))
  }
  return [...by.entries()].map(([type, rows]) => ({ type, rows }))
})

const total = (k: string) => documents.value.reduce((n, d) => n + (d.db[k] || 0), 0)

/** Rules the report could scope, across every document that has any. */
const reachTotal = computed(() => {
  let rules = 0, scopable = 0
  for (const d of documents.value) {
    rules += d.db.rules || 0
    scopable += d.reach?.scopable || 0
  }
  return { rules, scopable, pct: rules ? Math.round((scopable / rules) * 100) : null }
})

const scopablePct = (d: any) =>
  d.db.rules ? Math.round(((d.reach?.scopable || 0) / d.db.rules) * 100) : 0

/**
 * What each applicability dimension buys, so a missing chip reads as a
 * consequence rather than as a gap in a table.
 */
const DIM_MEANING: Record<string, string> = {
  zone: 'scopes a clause to this lot\u2019s zone; without it a rural clause can land on a suburban lot',
  act: 'separates a standard for building from one for subdividing; without it the two merge',
  use: 'scopes a control to the proposed use',
  dev: 'scopes a control to a development type where no land use is named',
}

function dimChips(d: any) {
  const dm = d.reach?.dimensions ?? {}
  const rows = [
    { key: 'zone', n: dm.zone || 0 },
    { key: 'act', n: dm.act || 0 },
    { key: 'use', n: dm.landUse || 0 },
    { key: 'dev', n: dm.devType || 0 },
  ]
  return rows.map(r => ({
    ...r,
    title: r.n
      ? `${r.n} rules carry this dimension \u2014 ${DIM_MEANING[r.key]}`
      : `No rule carries this dimension \u2014 ${DIM_MEANING[r.key]}`,
  }))
}
const atStage = (s: string) =>
  documents.value.filter(d => (s === 'rules' ? d.db.rules > 0 : d.db.propositions > 0)).length

/** Title without the boilerplate every instrument of its kind repeats. */
function shortTitle(d: any) {
  return String(d.title)
    .replace(/^State Environmental Planning Policy\s*/i, '')
    .replace(/\s*Local Environmental Plan\s*/i, ' LEP ')
    .replace(/\s*Development Control Plan\s*/i, ' DCP ')
    .replace(/\s+/g, ' ').trim()
}

/** Green above 90, amber above 70, red below. */
function tone(pct: number) {
  return pct >= 90 ? 'gm-bar--ok' : pct >= 70 ? 'gm-bar--warn' : 'gm-bar--bad'
}

/** Only things a person would act on — no flag for a healthy document. */
function flags(d: any): string[] {
  const out: string[] = []
  if (d.sourceMissing) out.push('source unavailable')
  if (d.stage === 'sections') out.push('not searchable')
  if (d.structuralPct !== null && d.structuralPct < 80 && !d.source?.approximate) {
    out.push(`${100 - d.structuralPct}% of clauses missing`)
  }
  if (d.db.sections > 0 && d.quality.emptySections / d.db.sections > 0.15) {
    out.push(`${d.quality.emptySections} empty sections`)
  }
  if (d.quality.effectsWithoutBound > 0) out.push(`${d.quality.effectsWithoutBound} values with no bound`)
  if (d.quality.effectsUnspecifiedTopic > 0) out.push(`${d.quality.effectsUnspecifiedTopic} unclassified controls`)
  // The reach failures. These read healthy in every count above, which is
  // exactly why they are worth a flag.
  if (d.db.rules > 0 && scopablePct(d) < 80) {
    out.push(`${(d.db.rules - (d.reach?.scopable || 0)).toLocaleString()} rules the report cannot scope`)
  }
  if (d.db.rules > 0 && !(d.reach?.dimensions?.act)) out.push('no act \u2014 subdivision merges with development')
  if (d.db.rules > 0 && !(d.reach?.dimensions?.zone)) out.push('no zone \u2014 clauses cannot be scoped to a zone')
  if (d.quality.unitMismatches > 0) out.push(`${d.quality.unitMismatches} unit mismatches`)
  return out
}
</script>

<style scoped>
.gm-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #0f172a;
}
.gm-back { font-size: 13px; color: #64748b; text-decoration: none; }
.gm-back:hover { color: #0f172a; }
.gm-title { font-size: 22px; font-weight: 700; margin: 6px 0 4px; }
.gm-meta { font-size: 13px; color: #64748b; margin: 0 0 20px; }
.gm-refresh {
  margin-left: 10px; font: inherit; font-size: 12px; padding: 3px 10px;
  border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; cursor: pointer;
}
.gm-refresh:hover:not(:disabled) { background: #f1f5f9; }
.gm-refresh:disabled { opacity: 0.6; cursor: default; }
.gm-error { color: #b91c1c; font-size: 13px; }
.gm-loading { color: #64748b; font-size: 13px; }

.gm-summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
.gm-stat {
  flex: 1 1 190px; padding: 12px 14px; border: 1px solid #e5e7eb;
  border-radius: 8px; background: #fff;
}
.gm-stat--warn { border-color: #fcd34d; background: #fffbeb; }
.gm-stat-num { display: block; font-size: 20px; font-weight: 700; }
.gm-stat-label { display: block; font-size: 12px; color: #64748b; margin-top: 2px; }

.gm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.gm-table th {
  text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: #94a3b8; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;
}
.gm-table td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
.gm-num { text-align: right; font-variant-numeric: tabular-nums; }
.gm-group td {
  font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: #64748b;
  background: #f8fafc; padding: 5px 8px;
}
.gm-name { font-weight: 500; }
.gm-lga { margin-left: 6px; font-size: 11px; color: #94a3b8; }
.gm-zero { color: #b91c1c; font-weight: 600; }
.gm-na { color: #cbd5e1; }

.gm-stage {
  font-size: 11px; padding: 2px 7px; border-radius: 10px; text-transform: capitalize;
}
.gm-stage--rules { background: #dcfce7; color: #166534; }
.gm-stage--propositions { background: #dbeafe; color: #1d4ed8; }
.gm-stage--sections { background: #fef3c7; color: #b45309; }
.gm-stage--none { background: #fee2e2; color: #b91c1c; }

.gm-bar-wrap {
  position: relative; display: inline-block; width: 92px; height: 16px;
  background: #f1f5f9; border-radius: 3px; overflow: hidden; vertical-align: middle;
}
.gm-bar { position: absolute; inset: 0 auto 0 0; }
.gm-bar--ok { background: #86efac; }
.gm-bar--warn { background: #fde68a; }
.gm-bar--bad { background: #fca5a5; }
.gm-bar-text {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; color: #0f172a;
}

.gm-scroll { overflow-x: auto; }
.gm-dims { display: flex; flex-wrap: wrap; gap: 3px; min-width: 130px; }
.gm-dim {
  font-size: 10px; padding: 2px 5px; border-radius: 4px; white-space: nowrap;
  font-weight: 600; cursor: help;
}
.gm-dim--on { background: #dcfce7; color: #166534; }
.gm-dim--off { background: #f1f5f9; color: #cbd5e1; text-decoration: line-through; }
.gm-dim--geo { background: #dbeafe; color: #1d4ed8; }

.gm-flags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 190px; }
.gm-flag {
  font-size: 10px; padding: 2px 6px; border-radius: 4px;
  background: #fef3c7; color: #92400e; white-space: nowrap;
}
.gm-note {
  margin-top: 18px; font-size: 12px; line-height: 1.6; color: #64748b;
  border-top: 1px solid #e5e7eb; padding-top: 12px;
}
</style>
