<!--
  Testing slope: the build that "03 - slope calculations - spatial services"
  writes into `derived`, and how any one lot's slope was worked out.

  Built like /testing-spatial-services: a plain view of the rows, for checking a
  build while it runs, not a report. Three parts:

  - The build: how many of the 342 slope sheets are done, lots by method, and
    where the time went (query, read, rasterise, write).
  - A lot: its derived.lot_slope row, and the trace behind it - every sheet that
    measured it, the pixels and sums each one wrote to lot_slope_part, that
    sheet's timings, and the arithmetic that turns the sums into the final row,
    checked against it.
  - The log: derived.lot_slope_sheet, one row per sheet, sortable.

  Reads /api/lotslope.
-->

<template>
  <div class="lp-page">
    <header class="lp-header">
      <div>
        <NuxtLink to="/" class="lp-back">&larr; Home</NuxtLink>
        <h1 class="lp-title">Testing slope</h1>
      </div>
      <div v-if="build" class="lp-header-stat">
        <strong>{{ sheetsDone }}</strong> of {{ build.sheetsTotal }} sheets<template
          v-if="build.lotsTotal"> · <strong>{{ fmt(build.lotsTotal) }}</strong> lots in lot_slope</template>
        <span v-if="inFlight" class="lp-live">building</span>
      </div>
    </header>

    <div class="lp-shell">
      <aside class="lp-rail">
        <p class="lp-rail-state">On this page</p>
        <nav aria-label="Sections">
          <a v-for="sec in sections" :key="sec.id" :href="`#${sec.id}`" class="lp-rail-link"
             :class="{ 'lp-rail-link--sub': sec.sub, 'lp-rail-link--on': activeSection === sec.id }">{{ sec.label }}</a>
        </nav>
      </aside>

      <main class="lp-main">
        <!-- ── The build ─────────────────────────────────────────────────── -->
        <section id="build" class="lp-section">
          <p class="lp-kicker">derived</p>
          <h2 class="lp-h2">The build</h2>
          <p class="lp-lead">
            What <code>03 - slope calculations - spatial services</code> has written. Each of the 342 NSW Spatial Services
            5 m slope sheets writes its per-lot sums and a log row together; <code>lot_slope</code> is built from the sums
            at the end and swapped in, so mid-run it is the previous build, or missing.
          </p>

          <p v-if="buildError" class="lp-error">{{ buildError }}</p>
          <div v-else-if="build" class="lp-build">
            <div class="lp-build-row">
              <span class="lp-build-label">Tables</span>
              <span class="lp-chips">
                <span v-for="t in TABLES" :key="t" class="lp-chip" :class="build.tables[t] ? 'lp-chip--on' : 'lp-chip--off'"
                      :title="build.tables[t] ? 'present' : 'not created yet'">derived.{{ t }}</span>
              </span>
            </div>
            <div class="lp-build-row">
              <span class="lp-build-label">Sheets</span>
              <span class="lp-progress" role="img" :aria-label="`${sheetsDone} of ${build.sheetsTotal} sheets done`">
                <span class="lp-progress-bar" :style="{ width: `${(100 * sheetsDone) / build.sheetsTotal}%` }" />
              </span>
              <span><b>{{ sheetsDone }}</b> done<template v-if="sheetsFailed.length"> · <b class="lp-bad">{{ sheetsFailed.length }}</b> failed</template>
                · {{ build.sheetsTotal - sheetsDone - sheetsFailed.length }} to go</span>
            </div>
            <div v-if="build.sheets.length" class="lp-build-row">
              <span class="lp-build-label">Measured</span>
              <span>{{ fmt(sum('lots')) }} lot–sheet pairs · {{ fmt(sum('pixels')) }} pixels
                <span class="lp-dim">({{ fmt(sum('pixels') * 25 / 1e6) }} km²)</span> · {{ fmt(sum('pointOnly')) }} point fallbacks · {{ fmt(sum('seamPixels')) }} seam pixels left out</span>
            </div>
            <div class="lp-build-row">
              <span class="lp-build-label">lot_slope</span>
              <span v-if="build.lots.length" class="lp-chips">
                <span v-for="m in build.lots" :key="m.method" class="lp-chip" :title="METHOD[m.method]">
                  {{ m.method }} · {{ fmt(m.lots) }} <span class="lp-dim">{{ pct(m.lots, build.lotsTotal) }}</span>
                </span>
                <span class="lp-dim">built {{ when(build.builtAt) }}</span>
              </span>
              <span v-else class="lp-dim">not built yet - it is created once every sheet has run</span>
            </div>
          </div>

          <!-- Where the time went -->
          <div v-if="timing" id="time" class="lp-group lp-time">
            <h3 class="lp-h3">Time <span class="lp-dim">summed over {{ timing.sheets }} finished sheets</span></h3>
            <div class="lp-scroll">
              <table class="lp-table lp-table--num">
                <thead>
                  <tr><th scope="col">stage</th><th scope="col">seconds</th><th scope="col">share</th><th scope="col">per sheet</th><th scope="col">slowest sheet</th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in timing.stages" :key="s.key">
                    <td><b>{{ s.label }}</b> <span class="lp-dim">{{ s.what }}</span></td>
                    <td>{{ fmt(s.total, 1) }}</td>
                    <td>
                      <span class="lp-share"><span class="lp-share-bar" :style="{ width: `${(100 * s.total) / (timing.total || 1)}%` }" /></span>
                      {{ pct(s.total, timing.total) }}
                    </td>
                    <td>{{ fmt(s.total / timing.sheets, 1) }}</td>
                    <td><code>{{ s.slowest?.sheet ?? '—' }}</code> <span class="lp-dim">{{ s.slowest ? `${fmt(s.slowestValue, 1)} s` : '' }}</span></td>
                  </tr>
                  <tr class="lp-tr--total">
                    <td><b>whole sheet</b> <span class="lp-dim">includes setup between the stages</span></td>
                    <td>{{ fmt(timing.total, 1) }}</td><td /><td>{{ fmt(timing.total / timing.sheets, 1) }}</td>
                    <td><span class="lp-dim">{{ fmt(timing.lotsPerSecond) }} lots a second of sheet time</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="lp-note">
              Sheet time is per worker, so the run's wall clock is shorter by the number of workers.
              This build ran {{ when(timing.first, true) }} → {{ when(timing.last, true) }}<template v-if="timing.wallMinutes != null">,
              {{ fmt(timing.wallMinutes, 1) }} min of wall clock</template>.
            </p>
          </div>

          <div v-if="sheetsFailed.length" class="lp-group">
            <h3 class="lp-h3 lp-bad">Failed sheets</h3>
            <details v-for="s in sheetsFailed" :key="s.sheet" class="lp-more">
              <summary><code>{{ s.sheet }}</code> <span class="lp-dim">{{ when(s.finishedAt) }}</span></summary>
              <pre class="lp-pre">{{ s.error }}</pre>
            </details>
          </div>
        </section>

        <!-- ── Find a lot ────────────────────────────────────────────────── -->
        <section id="find" class="lp-section">
          <p class="lp-kicker">cadastre.lot · lot_address</p>
          <h2 class="lp-h2">Find a lot</h2>
          <p class="lp-lead">
            An address (through <code>derived.lot_address</code>) or a lot reference such as <code>1//DP207788</code>
            (straight from <code>cadastre.lot</code>, so lots without an address are found too).
          </p>
          <div class="lp-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
            <label class="lp-sr-only" for="ls-q">Address or lot reference</label>
            <input id="ls-q" v-model="q" type="search" class="lp-input" autocomplete="off" spellcheck="false" role="combobox"
                   placeholder="An address - 26 Foveaux St Surry Hills - or a lot, 1//DP207788"
                   :aria-expanded="listOpen && results.length > 0" aria-controls="ls-listbox"
                   @input="onType" @focus="listOpen = results.length > 0" @keydown.enter.prevent="pickHighlighted">
            <span v-if="searching" class="lp-combo-busy">searching…</span>
            <ul v-if="listOpen && results.length" id="ls-listbox" class="lp-listbox" role="listbox">
              <li v-for="(r, i) in results" :key="`${r.cadid}-${i}`" role="option" :aria-selected="i === highlight"
                  class="lp-option" :class="{ 'lp-option--on': i === highlight }" @mousedown.prevent="pick(r)" @mousemove="highlight = i">
                <span class="lp-option-addr">{{ r.address || '(no address)' }}</span>
                <span class="lp-option-meta"><code>{{ r.lotId || r.cadid }}</code><span class="lp-dim">{{ r.lgaName || '' }}</span></span>
              </li>
            </ul>
          </div>
          <p v-if="searchError" class="lp-error">{{ searchError }}</p>
          <p v-else-if="searchHint" class="lp-dim lp-hint">{{ searchHint }}</p>
          <p v-else-if="searched && !results.length && !searching" class="lp-empty">Nothing matched <b>{{ lastSearched }}</b>.</p>

          <details v-if="sampleGroups.length" class="lp-samples" :open="!detail">
            <summary class="lp-samples-summary">Or open one of each case <span class="lp-dim">({{ samples.length }})</span></summary>
            <p class="lp-samples-intro">Each is a real lot found in <code>derived.lot_slope</code>, so the list follows the build.</p>
            <div v-for="g in sampleGroups" :key="g.title" class="lp-sample-group">
              <h3 class="lp-h3">{{ g.title }}</h3>
              <div class="lp-sample-grid">
                <button v-for="s in g.items" :key="s.key" type="button" class="lp-sample"
                        :class="{ 'lp-sample--on': openedCadid === s.cadid, 'lp-sample--none': !s.cadid }"
                        :disabled="!s.cadid" :title="s.blurb" @click="s.cadid && open(s.cadid)">
                  <span class="lp-sample-title">{{ s.title }}</span>
                  <span class="lp-sample-addr">{{ s.blurb }}</span>
                  <span v-if="s.cadid" class="lp-sample-meta"><code>{{ s.lotId }}</code><span class="lp-dim">{{ s.meanPct != null ? `${s.meanPct} % mean` : '' }}</span></span>
                  <span v-else class="lp-sample-meta lp-dim">none in this build</span>
                </button>
              </div>
            </div>
          </details>
          <p v-else-if="samplesLoaded && build && !build.tables.lot_slope" class="lp-note">
            Samples are picked from <code>derived.lot_slope</code>, which is built at the end of a run. Search works as soon as
            a sheet has written its parts.
          </p>
        </section>

        <!-- ── One lot ───────────────────────────────────────────────────── -->
        <section v-if="loading" class="lp-section lp-panel lp-dim">Loading the lot…</section>
        <section v-else-if="detailError" class="lp-section lp-panel lp-error">{{ detailError }}</section>
        <section v-else-if="detail" id="lot" class="lp-section lp-panel">
          <h2 class="lp-h2">
            {{ detail.address || detail.lot?.lotidstring || detail.cadid }}
            <span class="lp-h2-sub"><code>{{ detail.lot?.lotidstring }}</code> · cadid <code>{{ detail.cadid }}</code></span>
          </h2>

          <div class="lp-figures">
            <figure class="lp-figure">
              <figcaption class="lp-figcap">The lot <span class="lp-dim">cadastre.lot, with its neighbours</span></figcaption>
              <DsLotMap
                :lots="detail.lotGeom ? [{ cadid: detail.cadid, geometry: detail.lotGeom as any }] : []"
                :neighbours="detail.neighbours as any"
                :label="`Lot ${detail.lot?.lotidstring ?? detail.cadid} and neighbouring lots`"
              />
              <dl class="lp-fields lp-fields--tight">
                <dt>area</dt><dd>{{ fmt(num(detail.lot?.area_m2), 1) }} m²</dd>
                <dt>classsubtype</dt><dd>{{ show(detail.lot?.classsubtype) }} <span class="lp-dim">{{ CLASS[num(detail.lot?.classsubtype) ?? 0] ?? '' }}</span></dd>
                <dt>parts</dt><dd>{{ show(detail.lot?.parts) }}</dd>
                <dt>point</dt><dd>{{ show(detail.lot?.lon) }}, {{ show(detail.lot?.lat) }}</dd>
              </dl>
            </figure>

            <figure class="lp-figure">
              <figcaption class="lp-figcap">Slope <span class="lp-dim">derived.lot_slope</span></figcaption>
              <template v-if="detail.slope">
                <div class="lp-kpis">
                  <div class="lp-kpi"><span class="lp-kpi-v">{{ show(detail.slope.mean_slope_pct) }}<small> %</small></span><span class="lp-kpi-l">mean slope</span></div>
                  <div class="lp-kpi"><span class="lp-kpi-v">{{ show(detail.slope.mean_slope_deg) }}<small> °</small></span><span class="lp-kpi-l">mean angle</span></div>
                  <div class="lp-kpi"><span class="lp-kpi-v">{{ show(detail.slope.max_slope_pct) }}<small> %</small></span><span class="lp-kpi-l">steepest pixel (capped at 80°)</span></div>
                </div>
                <p class="lp-subh">Share of the lot steeper than</p>
                <ul class="lp-steep">
                  <li v-for="t in THRESHOLDS" :key="t">
                    <span class="lp-steep-t">{{ t }} %</span>
                    <span class="lp-share lp-share--wide"><span class="lp-share-bar" :style="{ width: `${100 * (num(detail.slope[`share_over_${t}pct`]) ?? 0)}%` }" /></span>
                    <span class="lp-steep-v">{{ detail.slope[`share_over_${t}pct`] == null ? 'null' : pct(num(detail.slope[`share_over_${t}pct`])!, 1) }}</span>
                  </li>
                </ul>
                <dl class="lp-fields lp-fields--tight">
                  <template v-for="k in SLOPE_FIELDS" :key="k">
                    <dt><code>{{ k }}</code></dt>
                    <dd :class="{ 'lp-null': detail.slope[k] == null }">{{ show(detail.slope[k]) }}</dd>
                  </template>
                </dl>
              </template>
              <p v-else class="lp-note">
                No <code>derived.lot_slope</code> row{{ build?.tables.lot_slope ? ' for this lot' : ' - the table is built at the end of a run' }}.
                The trace below reads the sums the sheets have already written.
              </p>
            </figure>
          </div>

          <!-- The trace -->
          <div id="trace" class="lp-group">
            <h3 class="lp-h3">How it was measured</h3>
            <ol class="lp-steps">
              <li>
                <b>Sheets.</b>
                <template v-if="detail.parts.length">
                  {{ detail.parts.length }} {{ detail.parts.length === 1 ? 'sheet' : 'sheets' }} wrote a row for this lot.
                  Each counts only the pixels whose centres are inside its own half-degree square
                  <template v-if="detail.squares.length">
                    (<span v-for="(s, i) in detail.squares" :key="s.sheet">{{ i ? '; ' : '' }}{{ square(s) }}</span>)</template>,
                  so a lot on two sheets is never counted twice. The grids also carry a false near-vertical seam near
                  each edge, where the source sheets were joined; it is found in the data and its pixels are left out.
                  <template v-if="combined.seam"><b>{{ fmt(combined.seam) }}</b> of this lot's pixels were on it.</template>
                </template>
                <template v-else>No sheet has written a row for this lot{{ inFlight ? ' yet' : '' }}.</template>
              </li>
            </ol>

            <div v-if="detail.parts.length" class="lp-scroll">
              <table class="lp-table lp-table--num">
                <thead>
                  <tr>
                    <th scope="col">sheet</th><th scope="col">pixels</th><th scope="col">area m²</th>
                    <th scope="col">mean °</th><th scope="col">mean %</th><th scope="col">min °</th><th scope="col">max °</th>
                    <th v-for="t in THRESHOLDS" :key="t" scope="col">&gt;{{ t }} %</th>
                    <th scope="col">point °</th><th scope="col">seam, left out</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in detail.parts" :key="p.sheet">
                    <td><code>{{ p.sheet }}</code></td>
                    <td>{{ fmt(p.n) }}</td><td>{{ fmt(p.n * 25) }}</td>
                    <td>{{ p.n ? fmt(p.sumDeg! / p.n, 2) : '—' }}</td><td>{{ p.n ? fmt(p.sumPct! / p.n, 2) : '—' }}</td>
                    <td>{{ fmt(p.minDeg, 2) }}</td><td>{{ fmt(p.maxDeg, 2) }}</td>
                    <td v-for="t in THRESHOLDS" :key="t">{{ fmt(p.over[String(t)]) }}</td>
                    <td :class="{ 'lp-null': p.pointDeg == null }">{{ p.pointDeg == null ? 'null' : fmt(p.pointDeg, 2) }}</td>
                    <td :class="{ 'lp-null': !p.nSeam }">{{ fmt(p.nSeam) }}</td>
                  </tr>
                  <tr v-if="detail.parts.length > 1" class="lp-tr--total">
                    <td><b>all sheets</b></td><td>{{ fmt(combined.n) }}</td><td>{{ fmt(combined.n * 25) }}</td>
                    <td>{{ fmt(combined.meanDeg, 2) }}</td><td>{{ fmt(combined.meanPct, 2) }}</td>
                    <td>{{ fmt(combined.minDeg, 2) }}</td><td>{{ fmt(combined.maxDeg, 2) }}</td>
                    <td v-for="t in THRESHOLDS" :key="t">{{ fmt(combined.over[t]) }}</td><td /><td>{{ fmt(combined.seam) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ol v-if="detail.parts.length" class="lp-steps" start="2">
              <li>
                <b>Combine.</b> The sums are added across sheets, then divided once:
                <div class="lp-calc">
                  <div>mean ° = Σ sum_deg / Σ n = {{ fmt(combined.sumDeg, 1) }} / {{ fmt(combined.n) }} = <b>{{ fmt(combined.meanDeg, 2) }}</b> <Check :a="combined.meanDeg" :b="num(detail.slope?.mean_slope_deg)" :tol="0.006" /></div>
                  <div>mean % = Σ sum_pct / Σ n = {{ fmt(combined.sumPct, 1) }} / {{ fmt(combined.n) }} = <b>{{ fmt(combined.meanPct, 2) }}</b> <Check :a="combined.meanPct" :b="num(detail.slope?.mean_slope_pct)" :tol="0.006" /></div>
                  <div class="lp-dim">not tan(mean °) × 100 = {{ fmt(combined.meanDeg == null ? null : Math.tan(combined.meanDeg * Math.PI / 180) * 100, 2) }}: percent is averaged per pixel, each pixel capped at 80° (567 %)</div>
                  <div>std ° = √(Σ sum_sq_deg / Σ n − mean²) = <b>{{ fmt(combined.stdDeg, 2) }}</b> <Check :a="combined.stdDeg" :b="num(detail.slope?.std_slope_deg)" :tol="0.006" /></div>
                  <div v-for="t in THRESHOLDS" :key="t">share &gt; {{ t }} % = {{ fmt(combined.over[t]) }} / {{ fmt(combined.n) }} = <b>{{ combined.n ? (combined.over[t]! / combined.n).toFixed(4) : '—' }}</b> <Check :a="combined.n ? combined.over[t]! / combined.n : null" :b="num(detail.slope?.[`share_over_${t}pct`])" :tol="0.00006" /></div>
                  <div>coverage = {{ fmt(combined.n * 25) }} m² / {{ fmt(num(detail.lot?.area_m2), 1) }} m² = <b>{{ fmt(num(detail.lot?.area_m2) ? combined.n * 25 / num(detail.lot?.area_m2)! : null, 3) }}</b></div>
                  <div v-if="!combined.n && combined.pointDeg != null">no pixel centre inside: method <b>point</b>, the pixel under the lot reads {{ fmt(combined.pointDeg, 2) }}°</div>
                </div>
                <p v-if="detail.slope" class="lp-dim lp-hint">✓ marks a figure the page recomputed from the sums and found equal to <code>lot_slope</code>.</p>
              </li>
              <li>
                <b>Time.</b> What each sheet took. The timings belong to the whole sheet and are shared by every lot on it.
                <div class="lp-scroll">
                  <table class="lp-table lp-table--num">
                    <thead><tr><th scope="col">sheet</th><th scope="col">lots on sheet</th><th scope="col">query s</th><th scope="col">read s</th><th scope="col">rasterise s</th><th scope="col">write s</th><th scope="col">total s</th><th scope="col">seam found on this sheet</th><th scope="col">this lot's share</th><th scope="col">ran</th></tr></thead>
                    <tbody>
                      <tr v-for="p in detail.parts" :key="p.sheet">
                        <td><code>{{ p.sheet }}</code></td>
                        <td>{{ fmt(p.log?.lots) }}</td><td>{{ fmt(p.log?.queryS, 1) }}</td><td>{{ fmt(p.log?.readS, 1) }}</td>
                        <td>{{ fmt(p.log?.rasterizeS, 1) }}</td><td>{{ fmt(p.log?.writeS, 1) }}</td><td><b>{{ fmt(p.log?.seconds, 1) }}</b></td>
                        <td class="lp-dim lp-wrap">{{ p.log?.seamEdges || 'no seam found' }}</td>
                        <td>{{ p.log?.seconds && p.log?.lots ? `${fmt(1000 * p.log.seconds / p.log.lots, 2)} ms` : '—' }}</td>
                        <td class="lp-dim">{{ when(p.log?.startedAt ?? null, true) }} → {{ when(p.log?.finishedAt ?? null, true) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </li>
              <li>
                <b>Join.</b> <code>lot_slope</code> is keyed by <code>cadid</code>, like everything else in <code>derived</code>.
                <template v-if="detail.profile">
                  <code>derived.lot_frontage</code> has this lot: {{ show(detail.profile.lot_id) }},
                  {{ fmt(num(detail.profile.area_sqm), 0) }} m², frontage {{ show(detail.profile.primary_frontage_road) }}
                  {{ detail.profile.primary_frontage_length_m != null ? `${fmt(num(detail.profile.primary_frontage_length_m), 1)} m` : '' }}.
                </template>
                <span v-else class="lp-dim">derived.lot_frontage has no row for this cadid.</span>
              </li>
            </ol>
          </div>
        </section>

        <!-- ── The log ───────────────────────────────────────────────────── -->
        <section id="log" class="lp-section">
          <p class="lp-kicker">lot_slope_sheet</p>
          <h2 class="lp-h2">The log</h2>
          <p class="lp-lead">One row per sheet, written in the same transaction as its sums. Click a heading to sort.</p>
          <div v-if="build?.sheets.length" class="lp-log-tools">
            <input v-model="logFilter" type="search" class="lp-input lp-input--small" placeholder="Filter sheets" aria-label="Filter sheets">
            <span class="lp-dim">{{ logRows.length }} of {{ build.sheets.length }}</span>
          </div>
          <div v-if="build?.sheets.length" class="lp-scroll lp-log">
            <table class="lp-table lp-table--num">
              <thead>
                <tr>
                  <th v-for="c in LOG_COLUMNS" :key="c.key" scope="col" :aria-sort="sortKey === c.key ? (sortDesc ? 'descending' : 'ascending') : undefined">
                    <button type="button" class="lp-sort" @click="sortBy(c.key)">{{ c.label }}{{ sortKey === c.key ? (sortDesc ? ' ↓' : ' ↑') : '' }}</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in logRows" :key="s.sheet" :class="{ 'lp-tr--bad': s.status !== 'done' }">
                  <td><code>{{ s.sheet }}</code></td>
                  <td>{{ s.status }}</td>
                  <td>{{ fmt(s.lots) }}</td><td>{{ fmt(s.lotsMeasured) }}</td><td>{{ fmt(s.pointOnly) }}</td><td>{{ fmt(s.pixels) }}</td><td>{{ fmt(s.seamPixels) }}</td><td class="lp-dim lp-wrap">{{ s.seamEdges || '—' }}</td>
                  <td>{{ fmt(s.queryS, 1) }}</td><td>{{ fmt(s.readS, 1) }}</td><td>{{ fmt(s.rasterizeS, 1) }}</td><td>{{ fmt(s.writeS, 1) }}</td>
                  <td><b>{{ fmt(s.seconds, 1) }}</b></td>
                  <td>{{ s.epsg }}</td>
                  <td class="lp-dim">{{ when(s.startedAt, true) }}</td>
                  <td class="lp-dim">{{ when(s.finishedAt, true) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="lp-dim">No sheet has been logged yet.</p>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

useHead({ title: 'Testing slope · Planning Library' })

interface SheetLog {
  sheet: string; epsg: number | null; x0: number | null; y0: number | null; lots: number | null; lotsMeasured: number | null
  pointOnly: number | null; pixels: number | null; seamPixels: number | null; seamEdges: string | null; rows: number | null; queryS: number | null; readS: number | null
  rasterizeS: number | null; writeS: number | null; seconds: number | null; status: string | null; error: string | null
  startedAt: string | null; finishedAt: string | null
}
interface Build {
  tables: Record<string, boolean>; sheetsTotal: number; sheets: SheetLog[]
  lots: { method: string; lots: number }[]; lotsTotal: number | null; builtAt: string | null; partRows: number | null
}
interface Match { cadid: string; lotId: string | null; address: string | null; lgaName: string | null }
interface Part {
  sheet: string; n: number; sumDeg: number | null; sumSqDeg: number | null; minDeg: number | null; maxDeg: number | null
  sumPct: number | null; sumSqPct: number | null; over: Record<string, number | null>; pointDeg: number | null
  nSeam: number | null; log: SheetLog | null
}
interface Detail {
  cadid: string; lot: Record<string, any> | null; slope: Record<string, any> | null; parts: Part[]; address: string | null
  lotGeom: Record<string, unknown> | null; neighbours: Record<string, unknown>[]; squares: { sheet: string; x0: number; y0: number }[]
  profile: Record<string, any> | null
}
interface Sample { key: string; group: string; title: string; blurb: string; cadid: string | null; lotId: string | null; meanPct: number | null }

const TABLES = ['lot_slope_sheet', 'lot_slope_part', 'lot_slope'] as const
const THRESHOLDS = [5, 10, 15, 20, 25]
const SLOPE_FIELDS = ['method', 'pixel_count', 'seam_pixels', 'measured_area_m2', 'lot_area_m2', 'coverage', 'min_slope_deg', 'max_slope_deg',
  'std_slope_deg', 'min_slope_pct', 'std_slope_pct', 'sheets', 'built_at']
const METHOD: Record<string, string> = {
  pixels: 'measured from the 5 m pixels whose centres are inside the lot',
  point: 'too small for a pixel centre: the pixel under the lot',
  no_data: 'outside every sheet, or only on nodata',
}
const CLASS: Record<number, string> = { 1: 'standard lot', 2: 'part lot', 3: 'strata site', 4: 'stratum lot' }
const LOG_COLUMNS: { key: keyof SheetLog; label: string }[] = [
  { key: 'sheet', label: 'sheet' }, { key: 'status', label: 'status' }, { key: 'lots', label: 'lots' },
  { key: 'lotsMeasured', label: 'measured' }, { key: 'pointOnly', label: 'point' }, { key: 'pixels', label: 'pixels' }, { key: 'seamPixels', label: 'seam' }, { key: 'seamEdges', label: 'seam edges' },
  { key: 'queryS', label: 'query s' }, { key: 'readS', label: 'read s' }, { key: 'rasterizeS', label: 'rasterise s' },
  { key: 'writeS', label: 'write s' }, { key: 'seconds', label: 'total s' }, { key: 'epsg', label: 'EPSG' },
  { key: 'startedAt', label: 'started' }, { key: 'finishedAt', label: 'finished' },
]

/** A tick when a recomputed figure equals the stored one, a cross with the stored value when it does not. */
const Check = defineComponent({
  props: { a: { type: Number, default: null }, b: { type: Number, default: null }, tol: { type: Number, default: 0.006 } },
  setup(p) {
    return () => {
      if (p.a == null || p.b == null) return null
      const ok = Math.abs(p.a - p.b) <= p.tol
      return h('span', { class: ok ? 'lp-ok' : 'lp-bad', title: ok ? `equals lot_slope (${p.b})` : `lot_slope says ${p.b}` }, ok ? '✓' : `✕ lot_slope ${p.b}`)
    }
  },
})

// ── the build ──────────────────────────────────────────────────────────────
const build = ref<Build | null>(null)
const buildError = ref('')
const { data: initial, error: initialError } = await useFetch<{ build: Build }>('/api/lotslope')
if (initial.value?.build) build.value = initial.value.build
if (initialError.value) buildError.value = initialError.value.message

const sheetsDone = computed(() => build.value?.sheets.filter(s => s.status === 'done').length ?? 0)
const sheetsFailed = computed(() => build.value?.sheets.filter(s => s.status !== 'done') ?? [])
const inFlight = computed(() => !!build.value && (sheetsDone.value < build.value.sheetsTotal || !build.value.tables.lot_slope))

function sum(k: keyof SheetLog): number {
  return (build.value?.sheets ?? []).filter(s => s.status === 'done').reduce((t, s) => t + (Number(s[k]) || 0), 0)
}

const timing = computed(() => {
  const done = (build.value?.sheets ?? []).filter(s => s.status === 'done' && s.seconds != null)
  if (!done.length) return null
  const stage = (key: 'queryS' | 'readS' | 'rasterizeS' | 'writeS', label: string, what: string) => {
    const slowest = done.reduce<SheetLog | null>((m, s) => (m == null || (s[key] ?? 0) > (m[key] ?? 0) ? s : m), null)
    return { key, label, what, total: done.reduce((t, s) => t + (s[key] ?? 0), 0), slowest, slowestValue: slowest?.[key] ?? null }
  }
  const total = done.reduce((t, s) => t + (s.seconds ?? 0), 0)
  const times = done.flatMap(s => [s.startedAt, s.finishedAt]).filter((d): d is string => !!d).sort()
  return {
    sheets: done.length, total,
    lotsPerSecond: total ? done.reduce((t, s) => t + (s.lots ?? 0), 0) / total : null,
    first: times[0] ?? null, last: times[times.length - 1] ?? null,
    wallMinutes: times.length > 1 ? (new Date(times[times.length - 1]!).getTime() - new Date(times[0]!).getTime()) / 60000 : null,
    stages: [
      stage('queryS', 'query', 'lots from cadastre.lot, reprojected'),
      stage('readS', 'read', 'the ASCII grid'),
      stage('rasterizeS', 'rasterise', 'label raster + per-lot sums'),
      stage('writeS', 'write', 'COPY into lot_slope_part'),
    ],
  }
})

// ── samples ────────────────────────────────────────────────────────────────
const samples = ref<Sample[]>([])
const samplesLoaded = ref(false)
onMounted(async () => {
  try {
    samples.value = (await $fetch<{ samples: Sample[] }>('/api/lotslope', { query: { samples: 1 } })).samples ?? []
  } catch { samples.value = [] } finally { samplesLoaded.value = true }
})
const sampleGroups = computed(() => {
  const order: string[] = []
  const by = new Map<string, Sample[]>()
  for (const s of samples.value) {
    if (!by.has(s.group)) { by.set(s.group, []); order.push(s.group) }
    by.get(s.group)!.push(s)
  }
  return order.map(title => ({ title, items: by.get(title)! }))
})

// ── search ─────────────────────────────────────────────────────────────────
const q = ref('')
const results = ref<Match[]>([])
const searching = ref(false)
const searched = ref(false)
const lastSearched = ref('')
const searchError = ref('')
const searchHint = ref('')
const listOpen = ref(false)
const highlight = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

async function runSearch() {
  const term = q.value.trim()
  if (term.length < 2) { results.value = []; listOpen.value = false; return }
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  searching.value = true
  searchError.value = ''
  try {
    const r = await $fetch<{ results: Match[]; hint?: string }>('/api/lotslope', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    searchHint.value = r.hint ?? ''
    lastSearched.value = term
    searched.value = true
    highlight.value = 0
    listOpen.value = r.results.length > 0
    if (r.results.length === 1 && term.split(/\s+/).length >= 2 && openedCadid.value !== r.results[0]!.cadid) pick(r.results[0]!)
  } catch (e: any) {
    if (!ctrl.signal.aborted) { searchError.value = e?.data?.message || e?.message || 'The search failed.'; results.value = [] }
  } finally {
    if (inflight === ctrl) { searching.value = false; inflight = null }
  }
}
function onType() { if (debounce) clearTimeout(debounce); debounce = setTimeout(runSearch, 200) }
function move(step: number) {
  if (!results.value.length) return
  listOpen.value = true
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}
function pick(r: Match) { listOpen.value = false; q.value = r.address || r.lotId || q.value; open(r.cadid) }
function pickHighlighted() {
  if (debounce) { clearTimeout(debounce); debounce = null }
  if (listOpen.value && results.value[highlight.value]) pick(results.value[highlight.value]!)
  else runSearch()
}

// ── one lot ────────────────────────────────────────────────────────────────
const detail = ref<Detail | null>(null)
const openedCadid = ref<string | null>(null)
const loading = ref(false)
const detailError = ref('')

async function open(cadid: string) {
  loading.value = true
  detailError.value = ''
  openedCadid.value = cadid
  try {
    detail.value = await $fetch<Detail>('/api/lotslope', { query: { cadid } })
    loading.value = false
    await nextTick()
    observeSections()
    document.getElementById('lot')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e: any) {
    detailError.value = e?.data?.message || e?.message || 'Could not load that lot.'
    detail.value = null
  } finally {
    loading.value = false
  }
}

/** The parts added up the way the notebook's build query adds them. */
const combined = computed(() => {
  const parts = detail.value?.parts ?? []
  const n = parts.reduce((t, p) => t + p.n, 0)
  const s = (k: 'sumDeg' | 'sumSqDeg' | 'sumPct' | 'sumSqPct') => parts.reduce((t, p) => t + (p[k] ?? 0), 0)
  const sumDeg = s('sumDeg'); const sumSq = s('sumSqDeg'); const sumPct = s('sumPct')
  const meanDeg = n ? sumDeg / n : null
  const mins = parts.map(p => p.minDeg).filter((v): v is number => v != null)
  const maxs = parts.map(p => p.maxDeg).filter((v): v is number => v != null)
  return {
    n, sumDeg, sumPct,
    meanDeg, meanPct: n ? sumPct / n : null,
    stdDeg: n && meanDeg != null ? Math.sqrt(Math.max(sumSq / n - meanDeg * meanDeg, 0)) : null,
    minDeg: mins.length ? Math.min(...mins) : null,
    maxDeg: maxs.length ? Math.max(...maxs) : null,
    over: Object.fromEntries(THRESHOLDS.map(t => [t, parts.reduce((a, p) => a + (p.over[String(t)] ?? 0), 0)])) as Record<number, number>,
    pointDeg: parts.map(p => p.pointDeg).find(v => v != null) ?? null,
    seam: parts.reduce((t, p) => t + (p.nSeam ?? 0), 0),
  }
})

function square(s: { sheet: string; x0: number; y0: number }): string {
  const lon = (v: number) => `${v.toFixed(1)}°E`
  const lat = (v: number) => `${Math.abs(v).toFixed(1)}°S`
  return `${s.sheet.replace(/-SLP.*/, '')} ${lon(s.x0)}–${lon(s.x0 + 0.5)}, ${lat(s.y0 + 0.5)}–${lat(s.y0)}`
}

// ── the log ────────────────────────────────────────────────────────────────
const logFilter = ref('')
const sortKey = ref<keyof SheetLog>('finishedAt')
const sortDesc = ref(true)
function sortBy(k: keyof SheetLog) {
  if (sortKey.value === k) sortDesc.value = !sortDesc.value
  else { sortKey.value = k; sortDesc.value = k !== 'sheet' && k !== 'status' }
}
const logRows = computed(() => {
  const f = logFilter.value.trim().toLowerCase()
  const rows = (build.value?.sheets ?? []).filter(s => !f || s.sheet.toLowerCase().includes(f) || String(s.status).includes(f))
  const k = sortKey.value
  const dir = sortDesc.value ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a[k]; const y = b[k]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
  })
})

// ── rail ───────────────────────────────────────────────────────────────────
const sections = computed(() => {
  const out: { id: string; label: string; sub?: boolean }[] = [{ id: 'build', label: 'The build' }]
  if (timing.value) out.push({ id: 'time', label: 'Time', sub: true })
  out.push({ id: 'find', label: 'Find a lot' })
  if (detail.value) out.push({ id: 'lot', label: 'The lot' }, { id: 'trace', label: 'How it was measured', sub: true })
  out.push({ id: 'log', label: 'The log' })
  return out
})
const activeSection = ref('build')
let observer: IntersectionObserver | null = null
function observeSections() {
  if (typeof IntersectionObserver === 'undefined') return
  observer?.disconnect()
  const inBand = new Map<string, Element>()
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? inBand.set(e.target.id, e.target) : inBand.delete(e.target.id)
    const top = [...inBand.values()].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
    if (top) activeSection.value = top.id
  }, { rootMargin: '-15% 0px -70% 0px' })
  for (const sec of sections.value) {
    const el = document.getElementById(sec.id)
    if (el) observer.observe(el)
  }
}
onMounted(observeSections)
onBeforeUnmount(() => observer?.disconnect())

// ── formatting ─────────────────────────────────────────────────────────────
function num(v: unknown): number | null { return v == null || v === '' ? null : Number(v) }
function fmt(v: number | null | undefined, digits = 0): string {
  return v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function pct(part: number, whole: number | null): string {
  return whole ? `${((100 * part) / whole).toFixed(1)} %` : '—'
}
function show(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}
function when(isoStr: string | null, seconds = false): string {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return Number.isNaN(d.getTime()) ? isoStr
    : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
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
.lp-live { margin-left: 0.5rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; font-size: 0.72rem; font-weight: 700; }

.lp-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 2.25rem; max-width: 1360px; margin: 0 auto; padding: 1.5rem 2rem 5rem; align-items: start; }
.lp-rail { position: sticky; top: 6rem; display: flex; flex-direction: column; gap: 0.1rem; }
.lp-rail-state { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lp-rail-link { display: block; padding: 0.3rem 0.6rem; border-left: 2px solid #e2e8f0; font-size: 0.84rem; color: #475569; text-decoration: none; }
.lp-rail-link:hover { color: #0f172a; border-left-color: #94a3b8; }
.lp-rail-link--sub { padding-left: 1rem; }
.lp-rail-link--on { color: #4a3aa7; font-weight: 700; border-left-color: #4a3aa7; }
.lp-main { min-width: 0; }
.lp-section, .lp-group { scroll-margin-top: 6rem; }
.lp-section { padding-bottom: 2.5rem; margin-bottom: 2.5rem; border-bottom: 1px solid #e2e8f0; }
.lp-section:last-child { border-bottom: none; margin-bottom: 0; }
.lp-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4a3aa7; }
.lp-h2 { margin: 0 0 0.5rem; font-size: 1.45rem; font-weight: 800; color: #0f172a; }
.lp-lead { margin: 0 0 1.25rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 75ch; }
.lp-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.lp-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.lp-dim { color: #94a3b8; }
.lp-ok { color: #15803d; font-weight: 700; }
.lp-bad { color: #b91c1c; }
.lp-note { margin: 0.5rem 0 0; padding-left: 0.55rem; border-left: 2px solid #fbbf24; color: #57534e; font-size: 0.8rem; }
.lp-error { color: #b91c1c; margin: 0.5rem 0 0; }
.lp-hint { margin: 0.5rem 0 0; font-size: 0.8rem; }
.lp-empty { margin: 0.6rem 0 0; font-size: 0.82rem; color: #475569; }

.lp-build { border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; padding: 0.85rem 1rem; font-size: 0.82rem; }
.lp-build-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.22rem 0; }
.lp-build-label { min-width: 5rem; font-weight: 700; color: #334155; }
.lp-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: baseline; }
.lp-chip { border: 1px solid #ddd6fe; background: #f5f3ff; color: #4a3aa7; border-radius: 999px; padding: 0.05rem 0.5rem; font-size: 0.74rem; }
.lp-chip--on { border-color: #bbf7d0; background: #f0fdf4; color: #15803d; }
.lp-chip--off { border-color: #e2e8f0; background: #f8fafc; color: #94a3b8; text-decoration: line-through; }
.lp-progress { position: relative; flex: 0 1 16rem; height: 8px; border-radius: 999px; background: #eef2f7; overflow: hidden; }
.lp-progress-bar { position: absolute; inset: 0 auto 0 0; background: #4a3aa7; border-radius: 999px; }
.lp-share { display: inline-block; position: relative; width: 5rem; height: 6px; margin-right: 0.35rem; border-radius: 999px; background: #eef2f7; overflow: hidden; vertical-align: middle; }
.lp-share--wide { width: auto; flex: 1 1 auto; margin: 0; }
.lp-share-bar { position: absolute; inset: 0 auto 0 0; background: #4a3aa7; border-radius: 999px; }
.lp-time { margin-top: 1.1rem; }

.lp-combo { position: relative; max-width: 44rem; }
.lp-input { width: 100%; box-sizing: border-box; padding: 0.7rem 0.85rem; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; font: inherit; font-size: 0.95rem; }
.lp-input--small { width: 16rem; max-width: 100%; padding: 0.4rem 0.6rem; font-size: 0.85rem; }
.lp-input:focus { outline: 2px solid #4a3aa7; outline-offset: 1px; border-color: #4a3aa7; }
.lp-combo-busy { position: absolute; right: 0.9rem; top: 50%; transform: translateY(-50%); font-size: 0.74rem; color: #94a3b8; pointer-events: none; }
.lp-listbox { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 4px); list-style: none; margin: 0; padding: 0; max-height: 22rem; overflow-y: auto; border: 1px solid #c7d2fe; border-radius: 10px; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); }
.lp-option { display: flex; justify-content: space-between; gap: 1rem; padding: 0.45rem 0.75rem; cursor: pointer; border-top: 1px solid #f1f5f9; }
.lp-option--on { background: #f5f3ff; box-shadow: inset 3px 0 0 #4a3aa7; }
.lp-option-addr { font-weight: 600; }
.lp-option-meta { display: flex; gap: 0.6rem; align-items: baseline; white-space: nowrap; font-size: 0.8rem; }

.lp-samples { margin-top: 1.1rem; }
.lp-samples-summary { cursor: pointer; font-size: 0.82rem; font-weight: 700; color: #4a3aa7; padding: 0.2rem 0; }
.lp-samples-intro { margin: 0.4rem 0 0.6rem; font-size: 0.8rem; color: #475569; }
.lp-sample-group { margin-bottom: 0.8rem; }
.lp-sample-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 0.4rem; }
.lp-sample { display: flex; flex-direction: column; gap: 0.1rem; text-align: left; padding: 0.45rem 0.6rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font: inherit; cursor: pointer; }
.lp-sample:hover { border-color: #a5b4fc; background: #fafaff; }
.lp-sample--on { border-color: #4a3aa7; background: #f5f3ff; box-shadow: inset 2px 0 0 #4a3aa7; }
.lp-sample--none { opacity: 0.5; cursor: default; }
.lp-sample-title { font-size: 0.8rem; font-weight: 700; color: #0f172a; }
.lp-sample-addr { font-size: 0.74rem; color: #475569; }
.lp-sample-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; font-size: 0.7rem; }

.lp-panel { border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; padding: 1.1rem 1.25rem 1.3rem; }
.lp-panel .lp-h2 { font-size: 1.1rem; display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; }
.lp-h2-sub { font-size: 0.78rem; font-weight: 500; color: #64748b; }
.lp-h3 { margin: 0 0 0.45rem; font-size: 0.9rem; font-weight: 800; color: #334155; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
.lp-group { margin-bottom: 1.1rem; }
.lp-figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 1rem; margin-bottom: 1.3rem; align-items: start; }
.lp-figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.6rem 0.7rem 0.7rem; background: #fff; min-width: 0; }
.lp-figcap { font-size: 0.82rem; font-weight: 800; color: #334155; margin-bottom: 0.45rem; }
.lp-figcap .lp-dim { font-weight: 400; font-size: 0.74rem; }
.lp-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.5rem; margin-bottom: 0.7rem; }
.lp-kpi { display: flex; flex-direction: column; padding: 0.45rem 0.55rem; border: 1px solid #eef2f7; border-radius: 8px; }
.lp-kpi-v { font-size: 1.35rem; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.lp-kpi-v small { font-size: 0.7rem; font-weight: 600; color: #64748b; }
.lp-kpi-l { font-size: 0.72rem; color: #64748b; }
.lp-subh { margin: 0 0 0.25rem; font-size: 0.76rem; font-weight: 700; color: #475569; }
.lp-steep { list-style: none; margin: 0 0 0.7rem; padding: 0; display: grid; gap: 0.2rem; font-size: 0.78rem; }
.lp-steep li { display: flex; align-items: center; gap: 0.5rem; }
.lp-steep-t { width: 2.6rem; color: #475569; font-variant-numeric: tabular-nums; }
.lp-steep-v { width: 3.6rem; text-align: right; font-variant-numeric: tabular-nums; }

.lp-fields { display: grid; grid-template-columns: minmax(9rem, max-content) 1fr; gap: 0.1rem 0.9rem; margin: 0; font-size: 0.8rem; }
.lp-fields--tight { margin-top: 0.5rem; }
.lp-fields dt { color: #475569; }
.lp-fields dd { margin: 0; color: #0f172a; overflow-wrap: anywhere; }
.lp-null { color: #cbd5e1; font-style: italic; }

.lp-steps { margin: 0.2rem 0 0.8rem; padding-left: 1.2rem; display: grid; gap: 0.7rem; font-size: 0.84rem; color: #334155; }
.lp-steps li { min-width: 0; }
.lp-calc { margin: 0.4rem 0 0; padding: 0.55rem 0.75rem; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 8px; font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace; display: grid; gap: 0.15rem; overflow-x: auto; }
.lp-calc > div { white-space: nowrap; }

.lp-scroll { overflow-x: auto; }
.lp-table { border-collapse: collapse; font-size: 0.76rem; width: 100%; }
.lp-table th, .lp-table td { border: 1px solid #eef2f7; padding: 0.25rem 0.45rem; text-align: left; white-space: nowrap; }
.lp-table th { background: #f8fafc; font-weight: 700; }
.lp-table--num td { font-variant-numeric: tabular-nums; }
.lp-tr--total td { background: #f5f3ff; font-weight: 600; }
.lp-tr--bad td { background: #fef2f2; }
.lp-table td.lp-wrap { white-space: normal; min-width: 16rem; font-size: 0.72rem; }
.lp-sort { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: #334155; cursor: pointer; }
.lp-sort:hover { color: #4a3aa7; }
.lp-log { max-height: 36rem; overflow-y: auto; }
.lp-log thead th { position: sticky; top: 0; z-index: 1; }
.lp-log-tools { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.5rem; }
.lp-more { margin-top: 0.4rem; font-size: 0.8rem; }
.lp-more summary { cursor: pointer; color: #b91c1c; font-weight: 600; }
.lp-pre { white-space: pre-wrap; font-size: 0.74rem; background: #fef2f2; border-radius: 6px; padding: 0.5rem; }

@media (max-width: 900px) {
  .lp-shell { grid-template-columns: minmax(0, 1fr); padding: 1rem 1rem 4rem; gap: 1rem; }
  .lp-rail { position: static; }
  .lp-header { padding: 1rem; position: static; }
}
@media (max-width: 560px) {
  .lp-fields { grid-template-columns: 1fr; gap: 0; }
  .lp-fields dt { margin-top: 0.4rem; font-weight: 700; }
  .lp-kpis { grid-template-columns: 1fr; }
}
</style>
