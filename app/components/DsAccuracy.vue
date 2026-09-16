<!--
  <DsAccuracy>

  The Data accuracy part of /datasources for NSW: how fresh each download is,
  how well the tables fit together as last measured, what the data cannot do,
  why address counts differ between tables, and how to refresh all of it.

  Freshness comes from the notebook's load log and the checks from
  scripts/measure-nsw-data-quality.ts, both passed in from the page's one live
  fetch. Before the script has ever run, each check shows the baseline shipped
  in shared/datasources-nsw.ts and says so. A measurement older than the latest
  load is flagged, because it describes data that has since been replaced.
-->

<template>
  <div class="ac">
    <!-- ── Freshness ───────────────────────────────────────────────────── -->
    <section id="accuracy-freshness" class="ac-part">
      <h3 class="ac-h3">How fresh is it?</h3>
      <p class="ac-lead">
        Each source is downloaded separately. The source date is when the file was produced; loaded is when it reached the database.
      </p>
      <p v-if="!loadsAvailable" class="ac-empty">No load has been logged on this database yet.</p>
      <div v-else class="ac-fresh">
        <article v-for="s in freshness" :key="s.schema" class="ac-fresh-card" :class="`ac-fresh-card--${s.state}`">
          <header class="ac-fresh-head">
            <span class="ac-dot" :style="{ background: SCHEMA_COLOR[s.schema] }" />
            <span class="ac-fresh-name">{{ SCHEMA_LABEL[s.schema] }}</span>
            <code class="ac-fresh-code">{{ s.schema }}</code>
          </header>
          <p class="ac-fresh-age">
            <span class="ac-state" :class="`ac-state--${s.state}`"><span aria-hidden="true">{{ FRESH_ICON[s.state] }}</span>{{ FRESH_LABEL[s.state] }}</span>
            <span v-if="s.ageDays != null">source {{ s.ageDays === 0 ? 'from today' : `${s.ageDays} day${s.ageDays === 1 ? '' : 's'} old` }}</span>
          </p>
          <dl class="ac-fresh-facts">
            <dt>Source date</dt><dd>{{ s.sourceDate ? fmtDate(s.sourceDate) : 'unknown' }}</dd>
            <dt>Loaded</dt><dd>{{ s.loadedAt ? fmtDateTime(s.loadedAt) : 'unknown' }}</dd>
            <dt>Tables</dt><dd>{{ s.tables }}</dd>
            <dt>Rows</dt><dd>{{ s.rows.toLocaleString('en-AU') }}</dd>
          </dl>
        </article>
      </div>
      <p v-if="loadsAvailable" class="ac-note">
        Fresh is under {{ FRESHNESS.good }} days, ageing is under {{ FRESHNESS.poor }}, stale is older.
        <template v-if="spreadDays != null && spreadDays > 1">The four source files are {{ spreadDays }} days apart, so a lot or address that changed in between can disagree across tables.</template>
      </p>
    </section>

    <!-- ── Measured checks ─────────────────────────────────────────────── -->
    <section id="accuracy-checks" class="ac-part">
      <h3 class="ac-h3">How well do the tables fit together?</h3>
      <p class="ac-lead">
        Each check follows one link between tables across the whole state, or a stated sample, and counts how often it holds.
        <template v-if="measuredAt">Last measured {{ fmtDateTime(measuredAt) }}.</template>
        <template v-else>These are the baseline figures from {{ fmtDate(baselineDate) }}; run the accuracy script to measure the data as loaded now.</template>
      </p>
      <p v-if="stale" class="ac-warn">
        <span aria-hidden="true">!</span>
        Data was loaded again after these checks were measured. Run <code>npm run data:quality</code> to measure the current load.
      </p>

      <div v-for="(title, group) in QUALITY_GROUPS" :key="group" class="ac-group">
        <h4 class="ac-h4">{{ title }}</h4>
        <article v-for="check in checksIn(group)" :key="check.id" class="ac-check">
          <DsMeter
            :label="check.title"
            :numerator="valueOf(check).numerator"
            :denominator="valueOf(check).denominator"
            :good="check.good"
            :poor="check.poor"
            :note="valueOf(check).note"
          />
          <p class="ac-question">{{ check.question }}</p>
          <p class="ac-explain">{{ check.explain }}</p>
          <details class="ac-sql">
            <summary>How it is measured</summary>
            <pre><code>{{ check.sql }}</code></pre>
          </details>
        </article>
      </div>
    </section>

    <!-- ── Address counts ──────────────────────────────────────────────── -->
    <section id="accuracy-counts" class="ac-part">
      <h3 class="ac-h3">Why the address counts differ</h3>
      <p class="ac-lead">
        The integrated service lists about 4.25 million addresses, while <code>derived.lot_address</code>, built by the
        <code>02C</code> notebook, has 5.22 million rows. The two tables count different things: a row there is an address on a lot,
        so one address can take several rows. Counted by address, <code>lot_address</code> actually has fewer.
        Measured {{ fmtDate(ADDRESS_COUNTS.measuredAt) }}.
      </p>

      <div class="ac-table-wrap">
        <table class="ac-counts">
          <thead><tr><th>Table</th><th>One row is</th><th class="ac-num">Rows</th><th class="ac-num">Addresses</th></tr></thead>
          <tbody>
            <tr v-for="t in ADDRESS_COUNTS.tables" :key="t.table">
              <td><code>{{ t.table }}</code></td>
              <td>{{ t.oneRowIs }}</td>
              <td class="ac-num">{{ num(t.rows) }}</td>
              <td class="ac-num">{{ num(t.addresses) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="ac-recon">
        <article class="ac-recon-card">
          <h4 class="ac-recon-title">Where the rows of <code>lot_address</code> come from</h4>
          <table class="ac-recon-table">
            <tbody>
              <tr v-for="p in ADDRESS_COUNTS.rows" :key="p.label">
                <th scope="row">
                  <span class="ac-recon-label">{{ p.extra ? '+ ' : '' }}{{ p.label }}</span>
                  <span class="ac-recon-plain">{{ p.plain }}</span>
                </th>
                <td class="ac-num">{{ num(p.count) }}</td>
              </tr>
            </tbody>
            <tfoot><tr><th scope="row">Rows</th><td class="ac-num">{{ num(sum(ADDRESS_COUNTS.rows)) }}</td></tr></tfoot>
          </table>
        </article>

        <article class="ac-recon-card">
          <h4 class="ac-recon-title">Which addresses each table has</h4>
          <table class="ac-recon-table">
            <tbody>
              <tr v-for="p in ADDRESS_COUNTS.coverage" :key="p.label">
                <th scope="row">
                  <span class="ac-recon-label">{{ p.label }}</span>
                  <span class="ac-recon-plain">{{ p.plain }}</span>
                </th>
                <td class="ac-num">{{ num(p.count) }}</td>
              </tr>
            </tbody>
            <tfoot><tr><th scope="row">Every address in <code>guras.addressstring</code></th><td class="ac-num">{{ num(sum(ADDRESS_COUNTS.coverage)) }}</td></tr></tfoot>
          </table>
        </article>
      </div>

      <h4 class="ac-h4">Counting addresses correctly</h4>
      <ul class="ac-howto">
        <li v-for="h in ADDRESS_COUNTS.howToCount" :key="h">{{ h }}</li>
      </ul>
      <details class="ac-sql">
        <summary>How it is measured</summary>
        <pre><code>{{ ADDRESS_COUNTS.sql }}</code></pre>
      </details>
    </section>

    <!-- ── Limitations ─────────────────────────────────────────────────── -->
    <section id="accuracy-limits" class="ac-part">
      <h3 class="ac-h3">What the data cannot tell you</h3>
      <p class="ac-lead">Known gaps that no single number captures, what they affect, and how to work around them.</p>
      <div class="ac-limits">
        <article v-for="l in LIMITATIONS" :key="l.id" class="ac-limit">
          <h4 class="ac-limit-title">{{ l.title }}</h4>
          <p class="ac-limit-plain">{{ l.plain }}</p>
          <dl class="ac-limit-facts">
            <dt>Affects</dt><dd>{{ l.impact }}</dd>
            <dt>Work around it</dt><dd>{{ l.workaround }}</dd>
          </dl>
        </article>
      </div>
    </section>

    <!-- ── Refreshing ──────────────────────────────────────────────────── -->
    <section id="accuracy-refresh" class="ac-part">
      <h3 class="ac-h3">How it is refreshed</h3>
      <ol class="ac-steps">
        <li><strong>Download</strong> the four files: the parcel and address themes from GEODAAS, the integrated addresses from the Spatial Collaboration Portal, and the All-EPI geodatabase.</li>
        <li><strong>Load</strong> them with the <code>01A dump-gdal</code> notebook. It reloads each schema in full and logs the run, which is where the freshness figures above come from.</li>
        <li><strong>Measure</strong> accuracy with <code>npm run data:quality</code> in this app. It runs every check on this page, in about two minutes, and records the results.</li>
      </ol>
      <table v-if="runs.length" class="ac-runs">
        <caption>Recent loads</caption>
        <thead><tr><th>Started</th><th>Finished</th><th>Load time</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="r in runs" :key="r.runId">
            <td>{{ r.startedAt ? fmtDateTime(r.startedAt) : 'unknown' }}</td>
            <td>{{ r.finishedAt ? fmtDateTime(r.finishedAt) : 'unknown' }}</td>
            <td>{{ r.totalMinutes != null ? `${Math.round(r.totalMinutes)} min` : 'unknown' }}</td>
            <td>{{ r.status ?? 'unknown' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  ADDRESS_COUNTS, FRESHNESS, LIMITATIONS, QUALITY_CHECKS, QUALITY_GROUPS, SCHEMA_COLOR, SCHEMA_LABEL,
  type CountPart, type QualityCheck, type SchemaKey,
} from '#shared/datasources-nsw'

interface LoadedTable { schema: string; table: string; rowCount: number; loadedAt: string | null; sourceDate: string | null }
interface LoadRun { runId: string; startedAt: string | null; finishedAt: string | null; status: string | null; totalMinutes: number | null }
interface Measured { numerator: number; denominator: number; measuredAt: string; dataLoadedAt: string | null }

const props = defineProps<{
  loadsAvailable: boolean
  tables: LoadedTable[]
  runs: LoadRun[]
  checks: Record<string, Measured>
}>()

type Fresh = 'good' | 'caution' | 'poor' | 'unknown'
const FRESH_ICON: Record<Fresh, string> = { good: '✓', caution: '!', poor: '✕', unknown: '?' }
const FRESH_LABEL: Record<Fresh, string> = { good: 'Fresh', caution: 'Ageing', poor: 'Stale', unknown: 'Unknown' }
const SCHEMAS: SchemaKey[] = ['cadastre', 'guras', 'integrated_address', 'epi']

const DAY = 24 * 60 * 60 * 1000

const freshness = computed(() => SCHEMAS.map((schema) => {
  const rows = props.tables.filter(t => t.schema === schema)
  const sourceDate = rows.map(t => t.sourceDate).filter((d): d is string => !!d).sort().pop() ?? null
  const loadedAt = rows.map(t => t.loadedAt).filter((d): d is string => !!d).sort().pop() ?? null
  const ageDays = sourceDate ? Math.max(0, Math.floor((Date.now() - new Date(sourceDate).getTime()) / DAY)) : null
  const state: Fresh = ageDays == null ? 'unknown' : ageDays < FRESHNESS.good ? 'good' : ageDays < FRESHNESS.poor ? 'caution' : 'poor'
  return { schema, sourceDate, loadedAt, ageDays, state, tables: rows.length, rows: rows.reduce((s, t) => s + t.rowCount, 0) }
}))

const spreadDays = computed(() => {
  const dates = freshness.value.map(f => f.sourceDate).filter((d): d is string => !!d).map(d => new Date(d).getTime())
  if (dates.length < 2) return null
  return Math.round((Math.max(...dates) - Math.min(...dates)) / DAY)
})

const checksIn = (group: string) => QUALITY_CHECKS.filter(c => c.group === group)

function valueOf(check: QualityCheck): { numerator: number; denominator: number; note: string } {
  const live = props.checks[check.id]
  const sample = check.sample ? `Sample of ${check.sample}. ` : ''
  if (live) return { numerator: live.numerator, denominator: live.denominator, note: `${sample}Measured ${fmtDate(live.measuredAt)}` }
  return { numerator: check.baseline.numerator, denominator: check.baseline.denominator, note: `${sample}Baseline from ${fmtDate(check.baseline.measuredAt)}` }
}

const measuredAt = computed(() => {
  const times = Object.values(props.checks).map(c => c.measuredAt).sort()
  return times.pop() ?? null
})

const baselineDate = computed(() => QUALITY_CHECKS[0]?.baseline.measuredAt ?? '')

/** Measured before the latest load finished: the numbers describe replaced data. */
const stale = computed(() => {
  const measured = Object.values(props.checks)
  if (!measured.length) return false
  const latestLoad = props.tables
    .filter(t => t.schema !== 'epi')
    .map(t => t.loadedAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop()
  if (!latestLoad) return false
  return measured.some(m => new Date(m.measuredAt).getTime() < new Date(latestLoad).getTime())
})

const num = (n: number) => n.toLocaleString('en-AU')
const sum = (parts: CountPart[]) => parts.reduce((s, p) => s + p.count, 0)

function fmtDate(iso: string): string {
  return iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
</script>

<style scoped>
.ac { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2rem; }
.ac-part { scroll-margin-top: 6rem; }
.ac-h3 { margin: 0 0 0.35rem; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
.ac-h4 { margin: 1.25rem 0 0.6rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.ac-lead { margin: 0 0 0.9rem; font-size: 0.9rem; line-height: 1.55; color: #334155; max-width: 70ch; }
.ac-note { margin: 0.75rem 0 0; font-size: 0.78rem; color: #64748b; line-height: 1.5; }
.ac-empty { margin: 0; font-size: 0.85rem; color: #92400e; }
.ac-warn { display: flex; gap: 0.5rem; align-items: baseline; margin: 0 0 1rem; padding: 0.6rem 0.8rem; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; font-size: 0.84rem; color: #78350f; }
.ac-warn > span { display: inline-grid; place-items: center; flex: none; width: 16px; height: 16px; border-radius: 50%; background: #b45309; color: #fff; font-size: 10px; font-weight: 700; }

.ac-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }

.ac-fresh { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; }
.ac-fresh-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.8rem 0.9rem; }
.ac-fresh-head { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.ac-fresh-name { font-size: 0.9rem; font-weight: 700; color: #0f172a; }
.ac-fresh-code { font-size: 0.72rem; color: #64748b; }
.ac-fresh-age { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.5rem 0; font-size: 0.78rem; color: #475569; }
.ac-state { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 700; padding: 0.05rem 0.5rem; border-radius: 999px; }
.ac-state span { font-size: 0.7rem; }
.ac-state--good { color: #166534; background: #dcfce7; }
.ac-state--caution { color: #92400e; background: #fef3c7; }
.ac-state--poor { color: #991b1b; background: #fee2e2; }
.ac-state--unknown { color: #475569; background: #f1f5f9; }
.ac-fresh-facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 0.75rem; margin: 0; font-size: 0.8rem; }
.ac-fresh-facts dt { color: #64748b; }
.ac-fresh-facts dd { margin: 0; color: #0f172a; font-variant-numeric: tabular-nums; }

.ac-group { margin-bottom: 0.5rem; }
.ac-check { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.85rem 1rem; }
.ac-check + .ac-check { margin-top: 0.6rem; }
.ac-question { margin: 0.6rem 0 0.25rem; font-size: 0.84rem; font-weight: 600; color: #1e293b; }
.ac-explain { margin: 0; font-size: 0.82rem; line-height: 1.55; color: #475569; max-width: 80ch; }
.ac-sql { margin-top: 0.45rem; }
.ac-sql summary { cursor: pointer; font-size: 0.76rem; font-weight: 600; color: #15803d; }
.ac-sql pre { margin: 0.5rem 0 0; padding: 0.75rem; background: #0f172a; color: #e2e8f0; border-radius: 8px; overflow-x: auto; font-size: 0.76rem; line-height: 1.5; }

.ac-table-wrap { overflow-x: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
.ac-counts { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.ac-counts th { text-align: left; padding: 0.55rem 0.8rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.ac-counts td { padding: 0.5rem 0.8rem; border-bottom: 1px solid #f1f5f9; color: #334155; }
.ac-counts tr:last-child td { border-bottom: none; }
.ac-counts code { font-size: 0.76rem; color: #0f172a; overflow-wrap: anywhere; }
.ac-num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ac-recon { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 0.75rem; margin-top: 0.9rem; }
.ac-recon-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.85rem 1rem; }
.ac-recon-title { margin: 0 0 0.5rem; font-size: 0.9rem; font-weight: 700; color: #0f172a; }
.ac-recon-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.ac-recon-table th { text-align: left; font-weight: 400; padding: 0.45rem 0.75rem 0.45rem 0; vertical-align: top; }
.ac-recon-table td { padding: 0.45rem 0; vertical-align: top; color: #0f172a; font-weight: 600; }
.ac-recon-table tbody tr + tr { border-top: 1px solid #f1f5f9; }
.ac-recon-label { display: block; font-weight: 600; color: #1e293b; }
.ac-recon-plain { display: block; margin-top: 0.15rem; font-size: 0.76rem; line-height: 1.45; color: #64748b; }
.ac-recon-table tfoot th, .ac-recon-table tfoot td { border-top: 2px solid #e2e8f0; padding-top: 0.5rem; font-weight: 800; color: #0f172a; }
.ac-howto { margin: 0; padding-left: 1.2rem; display: grid; gap: 0.3rem; font-size: 0.84rem; line-height: 1.5; color: #334155; max-width: 80ch; }

.ac-limits { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem; }
.ac-limit { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.85rem 1rem; }
.ac-limit-title { margin: 0 0 0.35rem; font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.ac-limit-plain { margin: 0 0 0.6rem; font-size: 0.84rem; line-height: 1.5; color: #334155; }
.ac-limit-facts { margin: 0; display: grid; gap: 0.25rem; font-size: 0.8rem; }
.ac-limit-facts dt { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #64748b; margin-top: 0.3rem; }
.ac-limit-facts dd { margin: 0; color: #334155; line-height: 1.5; }

.ac-steps { margin: 0 0 1rem; padding-left: 1.2rem; display: grid; gap: 0.5rem; font-size: 0.88rem; line-height: 1.55; color: #334155; max-width: 80ch; }
.ac-runs { border-collapse: collapse; font-size: 0.8rem; min-width: min(100%, 560px); }
.ac-runs caption { text-align: left; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; padding-bottom: 0.4rem; }
.ac-runs th { text-align: left; font-weight: 600; color: #64748b; padding: 0.3rem 1.2rem 0.3rem 0; border-bottom: 1px solid #e2e8f0; }
.ac-runs td { padding: 0.35rem 1.2rem 0.35rem 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-variant-numeric: tabular-nums; }
</style>
