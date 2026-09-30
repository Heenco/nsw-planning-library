<!--
  /lmr - Low and Mid Rise housing: the Housing SEPP's four LMR layers and the constraints the policy is checked
  against, on one map. The other SEPP land application layers moved to /sepp-map on 2026-09-28.

  The layers come from the All-EPI geodatabase (epi.epi_land_application, SEPP rows), baked into one PMTiles
  archive by scripts/build-sepp-pmtiles.py and served as a static file on the planningai host. /api/lmr/tiles
  reads tiles out of that archive - there is no tile server and no database behind this page.

  - The panel lists the layers: the four LMR layers of the Housing SEPP first (on by default), then the lmr
    schema's constraints (shared/lmr-layers.ts). The panel is the legend.
  - One vector source holding every layer; the toggles are a map filter on layer_key, so switching a layer on
    or off draws from tiles already loaded.
  - Clicking the map asks /api/lmr/at what applies at that point, and shows the LMR layers and constraints.
  - The switched-on layers and the view are kept in the URL hash, so a view can be shared.
-->

<template>
  <div class="lm-page">
    <header class="lm-header">
      <div>
        <NuxtLink to="/" class="lm-back">&larr; Home</NuxtLink>
        <h1 class="lm-title">Low and Mid Rise housing</h1>
      </div>
      <div v-if="catalogue" class="lm-header-stat">
        {{ layerCount }} layers<template v-if="catalogue.sourceDate">
          · EPI data of <strong>{{ fmtDate(catalogue.sourceDate) }}</strong></template>
        · <NuxtLink to="/sepp-map" class="lm-link">the other SEPP layers</NuxtLink>
      </div>
    </header>

    <div class="lm-body">
      <aside class="lm-panel" :class="{ 'lm-panel--closed': !panelOpen }">
        <button type="button" class="lm-panel-toggle" :aria-expanded="panelOpen" @click="panelOpen = !panelOpen">
          {{ panelOpen ? 'Hide layers' : 'Layers' }}
        </button>
        <div v-show="panelOpen" class="lm-panel-inner">
          <div class="lm-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
            <label class="lm-sr" for="lm-q">Address, lot reference or place</label>
            <input
              id="lm-q" v-model="q" type="search" class="lm-input" role="combobox"
              placeholder="An address, a lot &mdash; A//DP71490 &mdash; or a place"
              autocomplete="off" spellcheck="false"
              :aria-expanded="listOpen && results.length > 0" aria-controls="lm-listbox"
              :aria-activedescendant="listOpen && results[highlight] ? `lm-opt-${highlight}` : undefined"
              @input="onType" @focus="listOpen = results.length > 0"
              @keydown.enter.prevent="pickHighlighted"
            >
            <span v-if="searching" class="lm-combo-busy">searching&hellip;</span>

            <!-- Picking a suggestion goes to that lot: no separate confirm, and a
                 query that narrows to one address goes there on its own. -->
            <ul v-if="listOpen && results.length" id="lm-listbox" class="lm-listbox" role="listbox">
              <li class="lm-listbox-head">
                {{ results.length }}{{ results.length === 25 ? '+' : '' }}
                {{ results.length === 1 ? 'match' : 'matches' }}
                <span class="lm-dim">&middot; &uarr;&darr; then Enter, or click</span>
              </li>
              <li
                v-for="(r, i) in results" :id="`lm-opt-${i}`" :key="`${r.cadid}-${r.msoid}`"
                role="option" :aria-selected="i === highlight"
                class="lm-option" :class="{ 'lm-option--on': i === highlight }"
                @mousedown.prevent="pickLot(r)" @mousemove="highlight = i"
              >
                <span class="lm-option-addr">{{ r.address || '(no address)' }}</span>
                <span class="lm-option-meta"><code>{{ r.titleLot || r.lotId || '&mdash;' }}</code><span class="lm-dim">{{ r.lgaName || '' }}</span></span>
              </li>
            </ul>
          </div>
          <p v-if="searchMsg" class="lm-note">{{ searchMsg }}</p>
          <p v-else-if="searchHint" class="lm-dim lm-hint">{{ searchHint }}</p>
          <p v-else-if="searched && !results.length && !searching" class="lm-dim lm-hint">
            No address or lot matched <b>{{ lastSearched }}</b>. Press Enter to look for a place of that name instead.
          </p>

          <p v-if="loadError" class="lm-error">{{ loadError }}</p>
          <p v-else-if="!catalogue" class="lm-dim">Loading layers…</p>

          <template v-else>
            <p class="lm-allrow">
              <span class="lm-dim">{{ on.size }} of {{ layerCount }} layers on</span>
              <button type="button" class="lm-link" :disabled="!on.size" @click="allOff">Turn all off</button>
            </p>

            <!-- The Housing SEPP layers: Low and Mid Rise housing, then Transport Oriented Development -->
            <section v-for="g in housingGroups" :key="g.title" class="lm-group">
              <h2 class="lm-h2">{{ g.title }}</h2>
              <p class="lm-lead">{{ g.lead }}</p>
              <ul class="lm-list">
                <li v-for="l in g.layers" :key="l.key" class="lm-item">
                  <label class="lm-row">
                    <input type="checkbox" :checked="on.has(l.key)" @change="toggle(l.key)">
                    <span class="lm-swatch lm-swatch--lmr" :style="swatchStyle(l)" :title="lmrStyle(l.layName).from" />
                    <span class="lm-name">{{ l.layName }}</span>
                    <span class="lm-count">{{ fmt(l.features) }}</span>
                  </label>
                  <p class="lm-blurb">{{ LMR_BLURB[l.layName] }}</p>
                  <p class="lm-meta">
                    <template v-if="lmrStyle(l.layName).portalName && lmrStyle(l.layName).portalName !== l.layName">"{{ lmrStyle(l.layName).portalName }}" on the Planning Portal · </template>
                    <template v-if="l.commenced">commenced {{ fmtDate(l.commenced) }}</template>
                    <button v-if="l.bbox" type="button" class="lm-link" @click="zoomTo(l.key, l.bbox)">zoom to</button>
                  </p>
                </li>
                <!-- constraint layers that belong with this group: the LMR stations -->
                <li v-for="c in constraintsIn(g.key)" :key="c.key" class="lm-item">
                  <label class="lm-row">
                    <input type="checkbox" :checked="on.has(c.key)" @change="toggle(c.key)">
                    <span class="lm-swatch lm-swatch--lmr" :style="constraintSwatchCss(c.key)" :title="constraintStyle(c.key).from" />
                    <span class="lm-name">{{ c.title }}</span>
                    <span class="lm-count">{{ fmt(c.features) }}</span>
                  </label>
                  <p class="lm-blurb">{{ firstSentence(c.comment) }}</p>
                  <p class="lm-meta"><code>{{ c.table }}</code><button v-if="c.bbox" type="button" class="lm-link" @click="zoomTo(c.key, c.bbox)">zoom to</button></p>
                </li>
              </ul>
            </section>

            <!-- The lmr schema: what the Low and Mid-Rise Housing Policy is checked against -->
            <section v-if="constraintLayers.length" class="lm-group">
              <h2 class="lm-h2">LMR constraints</h2>
              <p class="lm-lead">The datasets in the <code>lmr</code> schema that the Low and Mid-Rise Housing Policy is checked against. Each layer's note is its table's own description.</p>
              <details v-for="cg in constraintGroups" :key="cg.key" class="lm-family" :open="cg.layers.some(c => on.has(c.key))">
                <summary class="lm-family-sum">
                  <span class="lm-swatch" :style="constraintSwatchCss(cg.layers[0]!.key)" />
                  <span class="lm-name">{{ cg.title }}</span>
                  <span class="lm-count">{{ cg.layers.length }}</span>
                </summary>
                <p class="lm-blurb">{{ cg.lead }}</p>
                <ul class="lm-list lm-list--indent">
                  <li v-for="c in cg.layers" :key="c.key" class="lm-item">
                    <label class="lm-row">
                      <input type="checkbox" :checked="on.has(c.key)" @change="toggle(c.key)">
                      <span class="lm-swatch" :style="constraintSwatchCss(c.key)" :title="constraintStyle(c.key).from" />
                      <span class="lm-name">{{ c.title }}</span>
                      <span class="lm-count">{{ fmt(c.features) }}</span>
                    </label>
                    <ul v-if="constraintStyle(c.key).classes" class="lm-cats">
                      <li v-for="cat in c.categories" :key="cat.name">
                        <span class="lm-swatch lm-swatch--small" :style="constraintSwatchCss(c.key, cat.name)" />{{ cat.name }} <span class="lm-dim">{{ fmt(cat.features) }}</span>
                      </li>
                    </ul>
                    <p class="lm-meta">
                      <code>{{ c.table }}</code><template v-if="c.minZoom"> · shown from zoom {{ c.minZoom }}</template>
                      <button v-if="c.bbox" type="button" class="lm-link" @click="zoomTo(c.key, c.bbox)">zoom to</button>
                    </p>
                    <details v-if="c.comment" class="lm-classes">
                      <summary>about this table</summary>
                      <p class="lm-about">{{ c.comment }}</p>
                    </details>
                  </li>
                </ul>
              </details>
            </section>

            <p class="lm-lead">
              The other SEPP land application layers - the catchments, the precincts, the Codes SEPP and the rest -
              are on <NuxtLink to="/sepp-map" class="lm-link">/sepp-map</NuxtLink>.
            </p>

            <p class="lm-foot">
              Source: <code>epi.epi_land_application</code>, SEPP rows, as loaded by <code>01A dump-gdal</code><template v-if="catalogue.sourceLoadedAt">
              on {{ fmtDate(catalogue.sourceLoadedAt) }}</template>. Tiles: <code>{{ catalogue.archive }}</code>, built
              {{ catalogue.builtAt ? fmtDate(catalogue.builtAt) : '—' }} by <code>scripts/build-sepp-pmtiles.py</code>; rebuild after each EPI load.
              <template v-if="catalogue.constraints">
                LMR constraints: the <code>lmr</code> schema, tiles <code>{{ catalogue.constraints.archive }}</code> built
                {{ catalogue.constraints.builtAt ? fmtDate(catalogue.constraints.builtAt) : '—' }} by <code>scripts/build-lmr-pmtiles.py</code>.
              </template>
            </p>
          </template>
        </div>
      </aside>

      <div class="lm-mapwrap">
        <div ref="mapEl" class="lm-map" />
        <p v-if="!mapboxToken" class="lm-error lm-over">No Mapbox token: set NUXT_PUBLIC_MAPBOX_TOKEN in .env and restart the dev server.</p>
        <p v-if="status" class="lm-status">{{ status }}</p>

        <!-- What applies at the clicked point -->
        <section v-if="picked" class="lm-pick" aria-live="polite">
          <header class="lm-pick-head">
            <h2 class="lm-h2">At this point</h2>
            <button type="button" class="lm-x" aria-label="Close" @click="clearPick">×</button>
          </header>
          <p class="lm-dim">{{ picked.lat.toFixed(5) }}, {{ picked.lon.toFixed(5) }}</p>
          <p v-if="picking" class="lm-dim">Checking every SEPP layer…</p>
          <p v-else-if="pickError" class="lm-error">{{ pickError }}</p>
          <template v-else>
            <p v-if="!picked.hits.length" class="lm-dim">No LMR layer or constraint covers this point.</p>
            <p v-else-if="!picked.hits.some(h => h.family === 'lmr')" class="lm-note lm-note--plain">None of the four LMR layers covers this point.</p>
            <ul class="lm-hits">
              <li v-for="(h, i) in picked.hits" :key="i" class="lm-hit">
                <span v-if="h.family === 'constraint'" class="lm-swatch" :style="constraintSwatchCss(h.key, h.layClass)" />
                <span v-else class="lm-swatch lm-swatch--lmr" :style="swatchStyle(h as any)" />
                <div>
                  <p class="lm-hit-name">{{ h.layName }}<span v-if="h.layClass && h.layClass !== h.layName" class="lm-dim"> · {{ h.layClass }}</span></p>
                  <p class="lm-meta">{{ h.sepp }}<template v-if="h.clause"> · {{ h.clause }}</template><template v-if="h.lga && h.lga !== 'SEPP'"> · {{ h.lga }}</template></p>
                  <p v-if="h.label" class="lm-meta">{{ h.label }}</p>
                  <button v-if="!on.has(h.key)" type="button" class="lm-link" @click="toggle(h.key)">show on map</button>
                </div>
              </li>
            </ul>
          </template>
        </section>
      </div>

      <!-- How the layer gets built, beside the map it is built from -->
      <aside class="lm-guide" :class="{ 'lm-guide--closed': !guideOpen }">
        <button type="button" class="lm-guide-toggle" :aria-expanded="guideOpen" @click="toggleGuide">
          {{ guideOpen ? 'Hide guide' : 'Guide, rules and this lot' }}
        </button>
        <nav v-show="guideOpen" class="lm-tabs" role="tablist">
          <button type="button" role="tab" class="lm-tab" :class="{ 'lm-tab--on': guideTab === 'method' }" :aria-selected="guideTab === 'method'" @click="guideTab = 'method'">How it's built</button>
          <button type="button" role="tab" class="lm-tab" :class="{ 'lm-tab--on': guideTab === 'rules' }" :aria-selected="guideTab === 'rules'" @click="openRules">The rules</button>
          <button type="button" role="tab" class="lm-tab" :class="{ 'lm-tab--on': guideTab === 'layer' }" :aria-selected="guideTab === 'layer'" @click="openLayer">The layer</button>
          <button type="button" role="tab" class="lm-tab" :class="{ 'lm-tab--on': guideTab === 'lot' }" :aria-selected="guideTab === 'lot'" @click="guideTab = 'lot'">This lot</button>
        </nav>

        <!-- ── The layer: lmr.lot_lmr in numbers, and against 05_lmr ───────── -->
        <div v-if="guideOpen && guideTab === 'layer'" class="lm-guide-inner">
          <p v-if="layerError" class="lm-error">{{ layerError }}</p>
          <p v-else-if="!layerSummary" class="lm-dim">Loading the layer…</p>
          <template v-else>
            <h2 class="lm-h2">The LMR layer</h2>
            <p class="lm-lead">
              Every lot with any part in R1-R4 inside an 800 m walking catchment - {{ fmt(layerSummary.totals.all) }} of
              them - judged against Chapter 6 the same way "This lot" judges one. Built
              {{ layerSummary.builtAt ? fmtDate(layerSummary.builtAt) : '—' }} by <code>scripts/build-lmr-lots.ts</code>.
            </p>
            <div class="lm-kpis">
              <div class="lm-kpi lm-kpi--in"><b>{{ fmt(layerSummary.totals.in) }}</b><span>in the LMR area</span></div>
              <div class="lm-kpi lm-kpi--maybe"><b>{{ fmt(layerSummary.totals.undecided) }}</b><span>undecided</span></div>
              <div class="lm-kpi lm-kpi--out"><b>{{ fmt(layerSummary.totals.excluded) }}</b><span>excluded (s 164)</span></div>
            </div>
            <p class="lm-step-layers">
              <button v-for="k in ['lot_lmr', 'lmr_area', 'lot_lmr_05_only']" :key="k" type="button" class="lm-chip"
                      :class="{ 'lm-chip--on': on.has(k) }" :disabled="!constraintLayers.some(c => c.key === k)" @click="toggle(k)">
                {{ CONSTRAINT_STYLE[k]?.title }}
              </button>
            </p>

            <h3 class="lm-h3">By area</h3>
            <table class="lm-tbl">
              <thead><tr><th /><th>in</th><th>undecided</th><th>excluded</th></tr></thead>
              <tbody>
                <tr v-for="b in layerSummary.byBand" :key="b.band">
                  <td>{{ b.band === 'inner' ? 'Inner (400 m)' : 'Outer (400-800 m)' }}</td>
                  <td>{{ fmt(b.in) }}</td><td>{{ fmt(b.undecided) }}</td><td>{{ fmt(b.excluded) }}</td>
                </tr>
              </tbody>
            </table>

            <h3 class="lm-h3">What takes lots out</h3>
            <p class="lm-dim">A lot can be caught by more than one clause, so these add to more than the excluded total.</p>
            <table class="lm-tbl">
              <tbody>
                <tr v-for="e in layerSummary.excludedBy" :key="e.clause">
                  <td><a :href="clauseHref(e.clause)" target="_blank" rel="noopener" class="lm-clause">s {{ e.clause }}</a></td>
                  <td class="lm-tbl-wide">{{ clauseText(e.clause) }}</td><td>{{ fmt(e.lots) }}</td>
                </tr>
              </tbody>
            </table>
            <template v-if="layerSummary.undecidedBy.length">
              <h3 class="lm-h3">What leaves lots undecided</h3>
              <table class="lm-tbl">
                <tbody>
                  <tr v-for="e in layerSummary.undecidedBy" :key="e.clause">
                    <td><a :href="clauseHref(e.clause)" target="_blank" rel="noopener" class="lm-clause">s {{ e.clause }}</a></td>
                    <td class="lm-tbl-wide">{{ clauseText(e.clause) }}</td><td>{{ fmt(e.lots) }}</td>
                  </tr>
                </tbody>
              </table>
            </template>

            <h3 class="lm-h3">What the lots are eligible for</h3>
            <table class="lm-tbl">
              <thead><tr><th /><th>eligible</th><th>undecided</th></tr></thead>
              <tbody>
                <tr v-for="e in layerSummary.eligible" :key="e.type">
                  <td class="lm-tbl-wide">{{ e.type }}</td><td>{{ fmt(e.lots) }}</td><td>{{ fmt(e.undecided) }}</td>
                </tr>
              </tbody>
            </table>

            <h3 class="lm-h3">Against 05_lmr</h3>
            <p class="lm-dim">
              05_lmr is the earlier notebook build (the property table's <code>in_lmr_housing_area</code>): the zone ×
              400/800 m bands, with no exclusions applied.
            </p>
            <table class="lm-tbl">
              <tbody>
                <tr><td class="lm-tbl-wide">In both</td><td>{{ fmt(layerSummary.compare.both) }}</td></tr>
                <tr><td class="lm-tbl-wide">In this build only</td><td>{{ fmt(layerSummary.compare.oursOnly) }}</td></tr>
                <tr><td class="lm-tbl-wide">In 05_lmr, but excluded here by s 164</td><td>{{ fmt(layerSummary.compare.excludedButIn05) }}</td></tr>
                <tr><td class="lm-tbl-wide">In 05_lmr, undecided here</td><td>{{ fmt(layerSummary.compare.undecidedButIn05) }}</td></tr>
                <tr v-for="w in layerSummary.compare.theirsOnly" :key="w.why">
                  <td class="lm-tbl-wide">In 05_lmr only - {{ w.why }}</td><td>{{ fmt(w.lots) }}</td>
                </tr>
              </tbody>
            </table>

            <h3 class="lm-h3">By council</h3>
            <table class="lm-tbl lm-tbl--small">
              <thead><tr><th /><th>in</th><th>undec.</th><th>excl.</th><th>05_lmr</th><th>05 only</th></tr></thead>
              <tbody>
                <tr v-for="l in layerSummary.byLga" :key="l.lga">
                  <td class="lm-tbl-wide">{{ l.lga }}</td><td>{{ fmt(l.in) }}</td><td>{{ fmt(l.undecided) }}</td>
                  <td>{{ fmt(l.excluded) }}</td><td>{{ fmt(l.in05) }}</td><td>{{ fmt(l.only05) }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>

        <!-- ── This lot: Chapter 6 against the picked lot ───────────────────── -->
        <div v-if="guideOpen && guideTab === 'lot'" class="lm-guide-inner">
          <p v-if="!lotAnswer && !judging && !judgeError" class="lm-lead">
            Search an address or click the map: the lot under it is judged against Chapter 6 - where the chapter
            reaches (s 163), the land it excludes (s 164), and each housing form's own standards (s 166-180).
          </p>
          <p v-if="judging" class="lm-dim">Judging the lot…</p>
          <p v-if="judgeError" class="lm-error">{{ judgeError }}</p>
          <template v-if="lotAnswer && !judging">
            <h2 class="lm-h2">{{ lotAnswer.lot.lotId || lotAnswer.lot.cadid }}</h2>
            <p class="lm-lot-facts">
              {{ lotAnswer.lot.lga || 'council not recorded' }} ·
              {{ lotAnswer.lot.zones.join(', ') || 'no zone' }} ·
              {{ lotAnswer.lot.areaM2 != null ? Math.round(lotAnswer.lot.areaM2).toLocaleString('en-AU') + ' m²' : 'area not measured' }} ·
              {{ lotAnswer.lot.widthM != null ? lotAnswer.lot.widthM.toFixed(1) + ' m wide' : 'width not measured' }}
            </p>
            <p class="lm-band" :class="lotAnswer.lot.band ? 'lm-band--in' : 'lm-band--out'">
              <template v-if="lotAnswer.lot.band === 'inner'">Inner area - within 400 m of {{ lotAnswer.lot.measuredFrom.filter(m => m.includes('400')).join(', ') }}</template>
              <template v-else-if="lotAnswer.lot.band === 'outer'">Outer area - 400-800 m of {{ lotAnswer.lot.measuredFrom.join(', ') }}</template>
              <template v-else>Outside every low and mid rise housing area (s 163)</template>
            </p>

            <h3 class="lm-h3">Where the chapter does not apply (s 164)</h3>
            <ul class="lm-gen">
              <li v-for="g in lotAnswer.general" :key="g.clause" class="lm-gen-row" :class="`lm-gen--${g.status.replace('/', '')}`">
                <a :href="g.href" target="_blank" rel="noopener" class="lm-clause">{{ g.clause }}</a>
                <span class="lm-gen-text">{{ g.text.length > 90 ? g.text.slice(0, 88) + '…' : g.text }}</span>
                <span class="lm-gen-status" :title="g.why">{{ STATUS_WORD[g.status] }}</span>
                <p v-if="g.status === 'excluded' || g.status === 'unknown'" class="lm-gen-why">{{ g.why }}</p>
              </li>
            </ul>

            <h3 class="lm-h3">Each housing form</h3>
            <p class="lm-dim">
              {{ lotAnswer.summary.eligible }} eligible · {{ lotAnswer.summary.unknown }} undecided ·
              {{ lotAnswer.summary.notEligible }} not eligible
            </p>
            <div v-for="t in lotAnswer.types" :key="t.key" class="lm-type" :class="t.eligible === true ? 'lm-type--yes' : t.eligible === false ? 'lm-type--no' : 'lm-type--maybe'">
              <p class="lm-type-head">
                <span class="lm-type-verdict">{{ VERDICT_WORD(t.eligible) }}</span>
                <span class="lm-type-name">{{ t.name }}</span>
                <span class="lm-dim">{{ t.sections }}</span>
              </p>
              <p class="lm-type-why">{{ t.verdict }}</p>
              <ul class="lm-checks">
                <li v-for="c in t.checks" :key="c.column + c.says" :class="`lm-check--${c.pass === true ? 'yes' : c.pass === false ? 'no' : 'maybe'}`">
                  <span class="lm-check-mark">{{ passMark(c.pass) }}</span> {{ c.says }}<span v-if="c.actual" class="lm-dim"> - {{ c.actual }}</span>
                </li>
              </ul>
              <p v-if="t.eligible !== false && t.allowances.length" class="lm-allow">
                Allowed: <span v-for="(a, i) in t.allowances" :key="i">{{ i ? '; ' : '' }}{{ fmtAllowance(a) }} <span class="lm-dim">(s {{ a.clause }})</span></span>
              </p>
            </div>
            <p class="lm-foot">
              Width is the property's primary frontage, standing in for "the width at the front building line",
              which the chapter does not define - the same measure /cdc and the Pattern Book use. {{ lotAnswer.summary.gaps.length }} exclusions have no data and are never counted
              as clear: s {{ lotAnswer.summary.gaps.join(', s ') }}. {{ lotAnswer.ms }} ms.
            </p>
          </template>
        </div>

        <!-- ── The rules: Chapter 6 as the catalogue holds it ────────────────── -->
        <div v-if="guideOpen && guideTab === 'rules'" class="lm-guide-inner">
          <p v-if="!criteria" class="lm-dim">Loading the rules…</p>
          <template v-else>
            <h2 class="lm-h2">Housing SEPP 2021, Chapter 6</h2>
            <p class="lm-lead">
              {{ criteria.counts.types }} housing forms, {{ criteria.counts.requirements }} requirements -
              {{ criteria.counts.tested }} of them tested against a lot - and {{ criteria.counts.general }} kinds of land the
              chapter does not apply to. Each clause links to the legislation.
            </p>
            <h3 class="lm-h3">Where the chapter does not apply (s 164)</h3>
            <ul class="lm-gen">
              <li v-for="g in criteria.general" :key="g.clause" class="lm-gen-row" :class="`lm-cov--${g.coverage}`">
                <a :href="g.href" target="_blank" rel="noopener" class="lm-clause">{{ g.clause }}</a>
                <span class="lm-gen-text">{{ g.text }}</span>
                <span class="lm-gen-status">{{ g.coverage === 'full' ? 'held' : g.coverage === 'partial' ? 'partly held' : 'no data' }}</span>
                <p v-if="g.caveat" class="lm-gen-why">{{ g.caveat }}</p>
              </li>
            </ul>
            <details v-for="t in criteria.types" :key="t.key" class="lm-rule">
              <summary class="lm-rule-sum">
                <span class="lm-type-name">{{ t.name }}</span>
                <span class="lm-dim">{{ t.part }} · {{ t.sections }} · {{ t.testedCount }}/{{ t.requirements.length }} tested</span>
              </summary>
              <p v-if="t.note" class="lm-step-note">{{ t.note }}</p>
              <ul class="lm-reqs">
                <li v-for="r in t.requirements" :key="r.clause" :class="{ 'lm-req--tested': r.tested }">
                  <a :href="r.href" target="_blank" rel="noopener" class="lm-clause">{{ r.clause }}</a>
                  <span>{{ r.text }}</span>
                  <span class="lm-req-how">{{ r.tested ? (r.derived ? `tested - ${r.derived}` : 'tested') : r.untestedWhy }}</span>
                </li>
              </ul>
            </details>
          </template>
        </div>

        <div v-if="guideOpen && guideTab === 'method'" class="lm-guide-inner">
          <h2 class="lm-h2">How the LMR layer is built</h2>
          <p class="lm-lead">{{ LMR_METHOD_LEAD }}</p>
          <ol class="lm-steps">
            <li v-for="step in LMR_METHOD" :key="step.n" class="lm-step">
              <p class="lm-step-title"><span class="lm-step-n">{{ step.n }}</span>{{ step.title }}</p>
              <p class="lm-step-body">{{ step.body }}</p>
              <p v-if="step.layers" class="lm-step-layers">
                <button
                  v-for="name in step.layers" :key="name" type="button"
                  class="lm-chip" :class="{ 'lm-chip--on': !!keyOf(name) && on.has(keyOf(name)!) }"
                  :disabled="!keyOf(name)"
                  :title="keyOf(name) ? 'Show or hide this layer' : 'Not on the map yet'"
                  @click="toggleNamed(name)"
                >{{ name }}</button>
              </p>
              <p v-if="step.note" class="lm-step-note">{{ step.note }}</p>
            </li>
          </ol>
          <h3 class="lm-h3">Still to settle</h3>
          <div v-for="gap in LMR_METHOD_GAPS" :key="gap.title" class="lm-gap">
            <p class="lm-step-title">{{ gap.title }}</p>
            <p class="lm-step-body">{{ gap.body }}</p>
          </div>
          <p class="lm-foot">
            Chapter 6 of State Environmental Planning Policy (Housing) 2021. Stage 1 (dual occupancies in R2 across
            NSW) commenced 1 July 2024, Stage 2 (the low and mid-rise housing areas) 28 February 2025; exclusions as
            the Department listed them on 24 April 2026.
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import 'mapbox-gl/dist/mapbox-gl.css'
import { LMR_METHOD, LMR_METHOD_GAPS, LMR_METHOD_LEAD } from '#shared/lmr-method'
import {
  CONSTRAINT_GROUPS, CONSTRAINT_STYLE, LMR_BLURB, LMR_LAYER_NAMES,
  constraintStyle, constraintSwatchCss, lmrStyle, seppStyle, swatchCss,
  type ConstraintCatalogue, type ConstraintGroup, type ConstraintLayer,
  type LmrCatalogue, type LmrFamily, type LmrHit, type LmrLayer,
} from '#shared/lmr-layers'
import type { LmrCriteria } from '../../server/api/lmr/criteria.get'
import type { LmrTypesResponse } from '../../server/api/lmr/types.get'
import type { LmrLayerSummary } from '../../server/api/lmr/layer-summary.get'
import { ensureHatch, HATCH_NONE } from '#shared/hatch'

useHead({ title: 'LMR · Planning Library' })

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')

type Catalogue = LmrCatalogue & { archive: string; constraints: ConstraintCatalogue | null }
const catalogue = ref<Catalogue | null>(null)
const loadError = ref('')
const on = ref(new Set<string>())
const panelOpen = ref(true)
const status = ref('')
const mapEl = ref<HTMLElement | null>(null)

let map: any = null
let mapboxgl: any = null
let marker: any = null

const SOURCE = 'sepp'

const lmrLayers = computed(() => {
  const ls = (catalogue.value?.layers ?? []).filter(l => l.family === 'lmr')
  return [...ls].sort((a, b) => LMR_LAYER_NAMES.indexOf(a.layName as any) - LMR_LAYER_NAMES.indexOf(b.layName as any))
})

/** The four Housing SEPP layers, split into the two provisions they serve, each listed in panel order. */
const HOUSING_GROUPS: { key: ConstraintGroup | 'tod'; title: string; lead: string; names: string[] }[] = [
  {
    key: 'housing',
    title: 'Low and Mid Rise housing',
    lead: 'The Housing SEPP layers that decide where the low and mid rise housing provisions reach.',
    names: ['Town Centre', 'Low and Mid Rise Housing Exclusion Area'],
  },
  {
    key: 'tod',
    title: 'Transport Oriented Development',
    lead: 'The Housing SEPP\'s TOD areas, and the precincts rezoned under the accelerated TOD program.',
    names: ['Transport Oriented Development Area', 'Accelerated TOD Precinct'],
  },
]

const housingGroups = computed(() => HOUSING_GROUPS.map(g => ({
  ...g,
  layers: g.names.map(n => lmrLayers.value.find(l => l.layName === n)).filter((l): l is LmrLayer => !!l),
})).filter(g => g.layers.length))

// ── the lmr schema layers ────────────────────────────────────────────────────

const constraintLayers = computed<ConstraintLayer[]>(() => catalogue.value?.constraints?.layers ?? [])

function constraintsIn(group: string): ConstraintLayer[] {
  // panel order is the order of CONSTRAINT_STYLE, not the order the archive was built in
  const order = Object.keys(CONSTRAINT_STYLE)
  return constraintLayers.value.filter(c => c.group === group).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}

const constraintGroups = computed(() => (Object.keys(CONSTRAINT_GROUPS) as (keyof typeof CONSTRAINT_GROUPS)[])
  .map(key => ({ key, ...CONSTRAINT_GROUPS[key], layers: constraintsIn(key) }))
  .filter(g => g.layers.length))

/** A table comment's opening sentence, for the panel. */
function firstSentence(text: string | null): string {
  if (!text) return ''
  const m = text.match(/^(.+?[.:])(\s|$)/)
  // a description that opens "X: how it was made" reads as a sentence once the colon is a full stop
  return m ? m[1]!.replace(/:$/, '.') : text
}

// ── the map ────────────────────────────────────────────────────────────────

/** The tile URL names the archive, so a rebuilt archive is never served from an old cached tile. */
function tileUrl(): string {
  const v = encodeURIComponent(catalogue.value?.archive ?? '0')
  return `${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?v=${v}`
}

/** A match expression over layer_key, one value per LMR layer. */
function byLayer(value: (l: LmrLayer) => string | number, fallback: string | number): any[] {
  const pairs = lmrLayers.value.flatMap(l => [l.key, value(l)])
  return pairs.length ? ['match', ['get', 'layer_key'], ...pairs, fallback] : fallback as any
}

/** Draw order within the LMR group, bottom to top, as on the Planning Portal: TOD areas under the precincts
 *  and centres, the exclusion hatch over everything. */
const LMR_ORDER: Record<string, number> = {
  'Transport Oriented Development Area': 1,
  'Accelerated TOD Precinct': 2,
  'Town Centre': 3,
  'Low and Mid Rise Housing Exclusion Area': 4,
}

/** An LMR layer, and switched on. The archive's other SEPP layers are drawn on /sepp-map. */
function zoomFilter(group: 'lmr'): any[] {
  return ['all', ['==', ['get', 'layer_group'], group], ['in', ['get', 'layer_key'], ['literal', [...on.value]]]]
}

/**
 * Four map layers: the flat fill, the portal's hatches as a data-driven pattern (a solid layer gets the empty
 * tile), the solid outline, and a dashed outline no LMR layer uses today. The constraints go underneath.
 */
const PARTS = ['fill', 'hatch', 'line', 'dash'] as const
const DRAWN = PARTS.map(part => [`lmr-${part}`, 'lmr'] as const)

function addLayers() {
  if (!map || map.getSource(SOURCE)) return
  // the archive stops at zoom 14; the map overzooms its tiles past that
  map.addSource(SOURCE, { type: 'vector', tiles: [tileUrl()], minzoom: 4, maxzoom: 14 })
  const common = { source: SOURCE, 'source-layer': 'sepp' }
  const sym = (l: LmrLayer) => seppStyle(l)
  for (const l of lmrLayers.value) {
    const s = sym(l)
    if (s.hatch) ensureHatch(map, s.hatch, s.fill)
  }
  const order = byLayer(l => LMR_ORDER[l.layName] ?? 0, 0)

  for (const group of ['lmr'] as const) {
    map.addLayer({
      ...common, id: `${group}-fill`, type: 'fill', filter: zoomFilter(group),
      layout: { 'fill-sort-key': order },
      paint: { 'fill-color': byLayer(l => sym(l).fill, '#cbd5e1'), 'fill-opacity': byLayer(l => (sym(l).hatch ? 0 : sym(l).fillOpacity), 0.3) },
    })
    map.addLayer({
      ...common, id: `${group}-hatch`, type: 'fill', filter: zoomFilter(group),
      paint: { 'fill-pattern': byLayer(l => { const s = sym(l); return s.hatch ? `hatch-${s.hatch}-${s.fill.slice(1)}` : HATCH_NONE }, HATCH_NONE) },
    })
    map.addLayer({
      ...common, id: `${group}-line`, type: 'line', filter: zoomFilter(group),
      layout: { 'line-sort-key': order, 'line-join': 'round' },
      paint: { 'line-color': byLayer(l => sym(l).line, '#475569'), 'line-width': byLayer(l => (sym(l).dashed ? 0 : sym(l).lineWidth), 1) },
    })
    map.addLayer({
      ...common, id: `${group}-dash`, type: 'line', filter: zoomFilter(group),
      paint: {
        'line-color': byLayer(l => sym(l).line, '#475569'),
        'line-width': byLayer(l => (sym(l).dashed ? sym(l).lineWidth : 0), 0),
        'line-dasharray': [3, 2],
      },
    })
  }
}

// ── the constraints source: the lmr schema archive ───────────────────────────

const guideOpen = ref(true)

/** The map has to be told its box changed when the guide opens or closes. */
async function toggleGuide() {
  guideOpen.value = !guideOpen.value
  await nextTick()
  map?.resize()
}

/**
 * A layer title in the guide back to its key, so a step's chips switch the very layers it
 * describes. A title we hold no layer for resolves to nothing and its chip stays inert.
 */
function keyOf(title: string): string | undefined {
  const c = constraintLayers.value.find(l => l.title === title)
  if (c) return c.key
  return (catalogue.value?.layers ?? []).find(l => l.layName === title)?.key
}

function toggleNamed(title: string) {
  const key = keyOf(title)
  if (key) toggle(key)
}

const CSOURCE = 'lmrc'

/** Constraint layer keys matching a test on their style. */
function constraintKeys(test: (s: ReturnType<typeof constraintStyle>) => boolean): string[] {
  return constraintLayers.value.filter(c => test(constraintStyle(c.key))).map(c => c.key)
}

/** A match expression over layer_key for the constraint layers. */
function byConstraint(value: (s: ReturnType<typeof constraintStyle>) => string | number, fallback: string | number): any {
  const pairs = constraintLayers.value.flatMap(c => [c.key, value(constraintStyle(c.key))])
  return pairs.length ? ['match', ['get', 'layer_key'], ...pairs, fallback] : fallback
}

/** Which constraint layers a drawn layer covers, intersected with what is switched on. */
const C_DRAWN: [string, (s: ReturnType<typeof constraintStyle>) => boolean][] = [
  ['c-fill', s => s.kind === 'fill' && !s.hatch],
  ['c-hatch', s => s.kind === 'fill' && !!s.hatch],
  ['c-line', s => (s.kind === 'fill' && !!s.lineWidth && !s.dashed) || s.kind === 'line'],
  ['c-line-dash', s => s.kind === 'fill' && !!s.lineWidth && !!s.dashed],
  ['c-circle', s => s.kind === 'point'],
]

function constraintFilter(test: (s: ReturnType<typeof constraintStyle>) => boolean): any[] {
  const keys = constraintKeys(test).filter(k => on.value.has(k))
  return ['in', ['get', 'layer_key'], ['literal', keys]]
}

/**
 * Fill strength of a contour by its verdict against the policy's noise exclusion (ANEF 25+ or ANEC 20+): the
 * excluded bands solid, the ones the data cannot decide at half, and the rest nearly clear so they read as
 * "a contour is here" and never as excluded land.
 */
const VERDICT_OPACITY: Record<string, number> = { 'excluded': 0.6, 'undetermined': 0.3, 'not excluded': 0.06 }

function addConstraintLayers() {
  const cat = catalogue.value?.constraints
  if (!map || !cat || map.getSource(CSOURCE)) return
  const v = encodeURIComponent(cat.archive)
  map.addSource(CSOURCE, { type: 'vector', tiles: [`${window.location.origin}/api/lmr/tiles/{z}/{x}/{y}?set=lmr&v=${v}`], minzoom: 4, maxzoom: 14 })
  const common = { source: CSOURCE, 'source-layer': 'lmr' }
  // a layer with classes (bushfire RFS categories, walking catchment distances) is coloured by its category,
  // everything else by its layer's colour
  const classed = constraintLayers.value.filter(c => constraintStyle(c.key).classes)
  const fillColor = classed.length
    ? ['case',
        ...classed.flatMap(c => {
          const s = constraintStyle(c.key)
          return [['==', ['get', 'layer_key'], c.key], ['match', ['coalesce', ['get', 'category'], ''], ...Object.entries(s.classes!).flat(), s.color]]
        }),
        byConstraint(s => s.color, '#94a3b8')]
    : byConstraint(s => s.color, '#94a3b8')
  // a `classLine` layer is drawn line-only, so its categories have to colour the OUTLINE instead. Opt-in,
  // because the walking catchments are classed AND filled and their outline stays the one amber.
  const classedLine = classed.filter(c => constraintStyle(c.key).classLine)
  const lineColor = classedLine.length
    ? ['case',
        ...classedLine.flatMap(c => {
          const s = constraintStyle(c.key)
          return [['==', ['get', 'layer_key'], c.key], ['match', ['coalesce', ['get', 'category'], ''], ...Object.entries(s.classes!).flat(), s.line ?? s.color]]
        }),
        byConstraint(s => s.line ?? s.color, '#475569')]
    : byConstraint(s => s.line ?? s.color, '#475569')
  // constraints draw between the other SEPP layers and the LMR layers, so the Housing SEPP layers stay on top
  const before = map.getLayer('lmr-fill') ? 'lmr-fill' : undefined
  const filters = Object.fromEntries(C_DRAWN.map(([id, test]) => [id, constraintFilter(test)]))
  // a feature with a verdict (the noise contours) is drawn as strongly as the policy treats it
  const fillOpacity = ['match', ['coalesce', ['get', 'verdict'], ''], ...Object.entries(VERDICT_OPACITY).flat(),
    byConstraint(s => s.fillOpacity ?? 0.3, 0.3)]
  map.addLayer({ ...common, id: 'c-fill', type: 'fill', filter: filters['c-fill'],
    // land zoning is the base of the constraints, a 400 m catchment draws over the 800 m one it sits inside,
    // and the LMR layer's lots over the catchments they were built from
    layout: { 'fill-sort-key': ['case', ['==', ['get', 'layer_key'], 'epi_land_zoning'], 0, ['==', ['get', 'layer_key'], 'lot_lmr'], 3,
      ['==', ['get', 'category'], '400 m'], 2, 1] },
    paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity } }, before)
  // the portal's hatched symbols - proximity areas, SHR curtilage, the whole-LGA exclusion
  for (const c of constraintLayers.value) {
    const s = constraintStyle(c.key)
    if (s.hatch) ensureHatch(map, s.hatch, s.color)
  }
  map.addLayer({ ...common, id: 'c-hatch', type: 'fill', filter: filters['c-hatch'],
    paint: { 'fill-pattern': byConstraint(s => (s.hatch ? `hatch-${s.hatch}-${s.color.slice(1)}` : HATCH_NONE), HATCH_NONE) } }, before)
  map.addLayer({ ...common, id: 'c-line', type: 'line', filter: filters['c-line'], layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': lineColor, 'line-width': byConstraint(s => s.lineWidth ?? 1, 1) } }, before)
  map.addLayer({ ...common, id: 'c-line-dash', type: 'line', filter: filters['c-line-dash'],
    paint: { 'line-color': lineColor, 'line-width': byConstraint(s => s.lineWidth ?? 1, 1), 'line-dasharray': [3, 2] } }, before)
  // the stations sit on top of everything, like the portal's LMR Station dots
  map.addLayer({ ...common, id: 'c-circle', type: 'circle', filter: filters['c-circle'],
    paint: {
      'circle-color': byConstraint(s => s.color, '#7a7a7a'),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 5, 16, 7],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    } })
}

function refreshTiles() {
  if (map?.getSource(SOURCE)) {
    for (const [id, group] of DRAWN) {
      if (!map.getLayer(id)) continue
      map.setFilter(id, zoomFilter(group))
    }
  }
  if (map?.getSource(CSOURCE)) {
    for (const [id, test] of C_DRAWN) if (map.getLayer(id)) map.setFilter(id, constraintFilter(test))
  }
  syncHash()
}

/** Every layer the panel offers, so the count beside "Turn all off" matches what can be switched on. */
const layerCount = computed(() => lmrLayers.value.length + constraintLayers.value.length)

/** Clear the map: the same path as a toggle, so the filters and the URL follow. */
function allOff() {
  on.value = new Set()
  refreshTiles()
}

function toggle(key: string) {
  const next = new Set(on.value)
  next.has(key) ? next.delete(key) : next.add(key)
  on.value = next
  refreshTiles()
}

function zoomTo(key: string, bbox: [number, number, number, number] | null) {
  if (!map || !bbox) return
  if (!on.value.has(key)) toggle(key)
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 800, maxZoom: 15 })
}

// ── what applies at a point ──────────────────────────────────────────────────

const picked = ref<{ lon: number; lat: number; hits: LmrHit[] } | null>(null)
const picking = ref(false)
const pickError = ref('')

async function pick(lon: number, lat: number, cadid?: string) {
  picked.value = { lon, lat, hits: [] }
  picking.value = true
  pickError.value = ''
  marker?.remove()
  marker = new mapboxgl.Marker({ color: '#0f172a', scale: 0.7 }).setLngLat([lon, lat]).addTo(map)
  // the chapter 6 verdict for the lot under the point, beside the layers at the point
  judgeLot(cadid ? { cadid } : { lon, lat })
  try {
    const r = await $fetch<{ lon: number; lat: number; hits: LmrHit[] }>('/api/lmr/at', { query: { lon, lat } })
    // the point query answers for every SEPP layer too; those are /sepp-map's
    if (picked.value?.lon === lon && picked.value?.lat === lat) picked.value = { ...r, hits: r.hits.filter(h => h.family === 'lmr' || h.family === 'constraint') }
  } catch (e: any) {
    pickError.value = e?.data?.statusMessage || e?.message || 'Could not read the layers at this point.'
  } finally {
    picking.value = false
  }
}

function clearPick() {
  picked.value = null
  marker?.remove()
  marker = null
  clearLot()
}

// ── Chapter 6: the rules, and a lot against them ─────────────────────────────
//
// The same shape as /cdc and /cdc-map: the rules are data (lmr.type, lmr.type_requirement,
// lmr.type_check, lmr.general - /api/lmr/criteria), and /api/lmr/types evaluates those same rows
// against one lot, so the rules tab and the lot tab can never disagree.

type GuideTab = 'method' | 'rules' | 'layer' | 'lot'
const layerSummary = ref<LmrLayerSummary | null>(null)
const layerError = ref('')

async function openLayer() {
  guideTab.value = 'layer'
  if (!guideOpen.value) await toggleGuide()
  // the clause text beside each count comes from the catalogue
  if (!criteria.value) criteria.value = await $fetch<LmrCriteria>('/api/lmr/criteria').catch(() => null)
  if (!layerSummary.value) {
    try { layerSummary.value = await $fetch<LmrLayerSummary>('/api/lmr/layer-summary') }
    catch (e: any) { layerError.value = e?.data?.statusMessage || e?.message || 'Could not load the layer summary.' }
  }
}

function clauseText(clause: string): string {
  const t = criteria.value?.general.find(g => g.clause === clause)?.text ?? ''
  return t.length > 70 ? t.slice(0, 68) + '…' : t
}
function clauseHref(clause: string): string {
  return criteria.value?.general.find(g => g.clause === clause)?.href
    ?? 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714#sec.164'
}
const guideTab = ref<GuideTab>('method')
const criteria = ref<LmrCriteria | null>(null)
const lotAnswer = ref<LmrTypesResponse | null>(null)
const judging = ref(false)
const judgeError = ref('')
let judgeSeq = 0

async function openRules() {
  guideTab.value = 'rules'
  if (!guideOpen.value) await toggleGuide()
  if (!criteria.value) criteria.value = await $fetch<LmrCriteria>('/api/lmr/criteria').catch(() => null)
}

async function judgeLot(q: { cadid?: string; lon?: number; lat?: number }) {
  const seq = ++judgeSeq
  judging.value = true
  judgeError.value = ''
  guideTab.value = 'lot'
  if (!guideOpen.value) await toggleGuide()
  try {
    const r = await $fetch<LmrTypesResponse>('/api/lmr/types', { query: q })
    if (seq === judgeSeq) lotAnswer.value = r
  } catch (e: any) {
    if (seq === judgeSeq) { lotAnswer.value = null; judgeError.value = e?.data?.statusMessage || e?.message || 'Could not judge this lot.' }
  } finally {
    if (seq === judgeSeq) judging.value = false
  }
}

const VERDICT_WORD = (e: boolean | null) => (e === true ? 'Eligible' : e === false ? 'Not eligible' : 'Undecided')
const STATUS_WORD: Record<string, string> = { clear: 'clear', excluded: 'excluded', unknown: 'undecided', gap: 'no data', 'n/a': 'does not apply' }
const passMark = (p: boolean | null) => (p === true ? '✓' : p === false ? '✗' : '?')

function fmtAllowance(a: LmrTypesResponse['types'][number]['allowances'][number]): string {
  return [a.forUse, a.fsr != null ? `FSR ${a.fsr}:1` : null, a.heightM != null ? `${a.heightM} m` : null,
    a.storeys ? `${a.storeys} storeys` : null, a.parkingPerDwelling != null ? `${a.parkingPerDwelling} car space/dwelling` : null]
    .filter(Boolean).join(' · ')
}

function swatchStyle(h: { key?: string; family: LmrFamily; layName: string }) {
  return swatchCss(h)
}

// ── search: an address or lot from the build, or failing that a place ───────
//
// The same search as /testing-spatial-services, over derived.lot_address: every
// word typed has to appear, an abbreviated street type matches the spelled-out
// one, and a plan label is matched on the lot reference instead. Picking a
// result draws that lot and reads the layers under it. A term that matches no
// address falls back to Mapbox on Enter, which is how a suburb or a town still
// moves the map.

interface LotMatch {
  cadid: string
  lotId: string | null
  titleLot: string | null
  msoid: number | null
  address: string | null
  suburb: string | null
  lgaName: string | null
}

const q = ref('')
const results = ref<LotMatch[]>([])
const searching = ref(false)
const searchMsg = ref('')
const searchHint = ref('')
const searched = ref(false)
const lastSearched = ref('')
const listOpen = ref(false)
const highlight = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

// Mirrors the server's rule, so a query it would refuse never leaves the browser.
const ROAD_TYPES: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', DRV: 'DRIVE', PDE: 'PARADE',
  CRES: 'CRESCENT', CR: 'CRESCENT', PL: 'PLACE', HWY: 'HIGHWAY', CCT: 'CIRCUIT', CL: 'CLOSE',
  CT: 'COURT', TCE: 'TERRACE', LN: 'LANE', BVD: 'BOULEVARD', BLVD: 'BOULEVARD', GR: 'GROVE',
  ESP: 'ESPLANADE', WY: 'WAY', SQ: 'SQUARE', PKWY: 'PARKWAY', MWY: 'MOTORWAY', FWY: 'FREEWAY',
  CIR: 'CIRCLE', GDNS: 'GARDENS', RES: 'RESERVE', TRL: 'TRAIL',
}
const ROAD_WORDS = new Set(Object.values(ROAD_TYPES))
function searchable(term: string): boolean {
  if (/\b(?:D|S|C)P\s*\d+/i.test(term) || term.includes('//')) return true
  return term.split(/\s+/).map(w => ROAD_TYPES[w.toUpperCase()] ?? w)
    .some(w => w.length >= 3 && !ROAD_WORDS.has(w.toUpperCase()) && !/^\d+[a-z]?$/i.test(w))
}

async function runSearch() {
  const term = q.value.trim()
  searchMsg.value = ''
  if (term.length < 2) { results.value = []; listOpen.value = false; searchHint.value = ''; searched.value = false; return }
  if (!searchable(term)) {
    results.value = []; listOpen.value = false; searched.value = false
    searchHint.value = 'Keep typing — part of the street or suburb name is what narrows it.'
    return
  }
  searchHint.value = ''
  // A newer keystroke makes the previous request worthless: abort it, so it
  // stops costing the server anything and can never land after this one.
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  searching.value = true
  try {
    const r = await $fetch<{ results: LotMatch[]; hint?: string }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    searchHint.value = r.hint ?? ''
    lastSearched.value = term
    searched.value = true
    highlight.value = 0
    listOpen.value = r.results.length > 0
    // Narrowed to one address, with at least a number and a street typed: go there.
    if (r.results.length === 1 && term.split(/\s+/).length >= 2) pickLot(r.results[0]!)
  } catch (e: any) {
    if (ctrl.signal.aborted) return
    searchMsg.value = e?.data?.message || e?.message || 'The search failed.'
    results.value = []
  } finally {
    if (inflight === ctrl) { searching.value = false; inflight = null }
  }
}

/** Search a moment after the last keystroke rather than on every one. */
function onType() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(runSearch, 150)
}

function move(step: number) {
  if (!results.value.length) return
  listOpen.value = true
  highlight.value = (highlight.value + step + results.value.length) % results.value.length
}

/** Enter takes the highlighted address, or looks for a place when nothing matched. */
function pickHighlighted() {
  if (results.value.length) {
    pickLot(results.value[highlight.value] ?? results.value[0]!)
    return
  }
  searchPlace()
}

/** Draw a lot, fit the map to it, and read every layer under it. */
async function pickLot(r: LotMatch) {
  listOpen.value = false
  q.value = r.address || r.titleLot || r.lotId || q.value
  if (!map) return
  searching.value = true
  searchMsg.value = ''
  try {
    const d = await $fetch<{
      lotGeom: any
      points: { msoid: number | null; lon: number; lat: number }[]
    }>('/api/lotprofile', { query: { cadid: r.cadid } })
    if (!d.lotGeom) { searchMsg.value = `No shape is held for ${r.titleLot || r.lotId || r.cadid}.`; return }
    showLot(d.lotGeom)
    const box = bboxOf(d.lotGeom)
    map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 80, maxZoom: 17.5, duration: 800 })
    const p = d.points.find(x => x.msoid === r.msoid) ?? d.points[0]
    await pick(p ? p.lon : (box[0] + box[2]) / 2, p ? p.lat : (box[1] + box[3]) / 2, r.cadid)
  } catch (e: any) {
    searchMsg.value = e?.data?.message || e?.message || 'Could not open that lot.'
  } finally {
    searching.value = false
  }
}

const LOT_SOURCE = 'lotpick'

/** The picked lot, over everything else: the outline is what says "this one". */
function showLot(geometry: any) {
  if (!map) return
  const data = { type: 'Feature' as const, properties: {}, geometry }
  const src = map.getSource(LOT_SOURCE)
  if (src) {
    src.setData(data)
    return
  }
  map.addSource(LOT_SOURCE, { type: 'geojson', data })
  map.addLayer({ id: 'lotpick-fill', type: 'fill', source: LOT_SOURCE, paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.1 } })
  map.addLayer({ id: 'lotpick-line', type: 'line', source: LOT_SOURCE, paint: { 'line-color': '#0f172a', 'line-width': 2.5 } })
}

function clearLot() {
  if (!map?.getSource(LOT_SOURCE)) return
  for (const id of ['lotpick-fill', 'lotpick-line']) if (map.getLayer(id)) map.removeLayer(id)
  map.removeSource(LOT_SOURCE)
}

function bboxOf(geometry: any): [number, number, number, number] {
  const box: [number, number, number, number] = [180, 90, -180, -90]
  const walk = (a: any) => {
    if (typeof a[0] === 'number') {
      box[0] = Math.min(box[0], a[0]); box[1] = Math.min(box[1], a[1])
      box[2] = Math.max(box[2], a[0]); box[3] = Math.max(box[3], a[1])
      return
    }
    for (const b of a) walk(b)
  }
  walk(geometry.coordinates)
  return box
}

/** The old behaviour, kept for what is not an address: a suburb or a town. */
async function searchPlace() {
  const term = q.value.trim()
  if (!term || !map) return
  searching.value = true
  searchMsg.value = ''
  try {
    const params = new URLSearchParams({
      q: term, access_token: mapboxToken, country: 'au', limit: '1', language: 'en',
      bbox: '140.9,-37.6,153.7,-28.1', proximity: '151.2093,-33.8688',
    })
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`)
    const f = (await res.json())?.features?.[0]
    if (!f) { searchMsg.value = `Nothing found for "${term}".`; return }
    const [lon, lat] = f.geometry.coordinates as [number, number]
    map.flyTo({ center: [lon, lat], zoom: 14, duration: 1000 })
    await pick(lon, lat)
  } catch {
    searchMsg.value = 'The place search failed.'
  } finally {
    searching.value = false
  }
}

// ── URL hash: layers and view ────────────────────────────────────────────────

function syncHash() {
  if (!map) return
  const c = map.getCenter()
  const h = `#${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}/${[...on.value].join(',')}`
  history.replaceState(null, '', h)
}

function readHash(): { zoom: number; lat: number; lon: number; layers: string[] } | null {
  const m = window.location.hash.slice(1).split('/')
  if (m.length < 3) return null
  const [zoom, lat, lon] = m.slice(0, 3).map(Number)
  if (![zoom, lat, lon].every(Number.isFinite)) return null
  return { zoom: zoom!, lat: lat!, lon: lon!, layers: (m[3] ?? '').split(',').filter(Boolean) }
}

// ── init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    catalogue.value = await $fetch<Catalogue>('/api/lmr/layers')
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage || e?.message || 'Could not load the layer list.'
    return
  }
  const hash = readHash()
  const known = new Set([...lmrLayers.value.map(l => l.key), ...constraintLayers.value.map(c => c.key)])
  const defaults = [
    ...lmrLayers.value.map(l => l.key),
    ...constraintLayers.value.filter(c => constraintStyle(c.key).defaultOn).map(c => c.key),
  ]
  on.value = new Set(hash?.layers.length ? hash.layers.filter(k => known.has(k)) : defaults)

  if (!mapboxToken) return
  const mod = await import('mapbox-gl')
  mapboxgl = mod.default || mod
  mapboxgl.accessToken = mapboxToken
  map = new mapboxgl.Map({
    container: mapEl.value!,
    style: 'mapbox://styles/mapbox/light-v11',
    center: hash ? [hash.lon, hash.lat] : [151.0, -33.8],
    zoom: hash ? hash.zoom : 10,
  })
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  map.on('load', () => { addLayers(); addConstraintLayers() })
  map.on('moveend', syncHash)
  map.on('click', (e: any) => pick(e.lngLat.lng, e.lngLat.lat))
  map.on('dataloading', () => { if (on.value.size) status.value = 'Loading tiles…' })
  map.on('idle', () => { status.value = '' })
  map.on('error', (e: any) => {
    const msg = e?.error?.message || ''
    if (msg && !/aborted/i.test(msg)) status.value = msg.slice(0, 140)
  })
  if (import.meta.dev) (window as any).__lmrMap = map
})

onBeforeUnmount(() => {
  marker?.remove()
  map?.remove()
  map = null
})

// ── formatting ───────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('en-AU')
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<style>
body { margin: 0; background: #f8fafb; }
</style>

<style scoped>
.lm-page { height: 100vh; display: flex; flex-direction: column; background: #f8fafb; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
.lm-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.9rem 1.5rem; background: #fff; border-bottom: 1px solid #e2e8f0; }
.lm-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.2rem; }
.lm-back:hover { color: #0f172a; }
.lm-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0; }
.lm-header-stat { font-size: 0.8rem; color: #64748b; }
.lm-header-stat strong { color: #0f172a; }

.lm-body { flex: 1; min-height: 0; display: flex; }
.lm-panel { position: relative; width: 360px; flex: none; overflow-y: auto; background: #fff; border-right: 1px solid #e2e8f0; }
.lm-panel--closed { width: auto; }
.lm-panel-toggle { display: none; }
.lm-panel-inner { padding: 0.9rem 1rem 2rem; }
.lm-mapwrap { position: relative; flex: 1; min-width: 0; }
.lm-guide { position: relative; width: 380px; flex: none; overflow-y: auto; background: #fff; border-left: 1px solid #e2e8f0; }
.lm-guide--closed { width: auto; }
.lm-guide-toggle { width: 100%; padding: 0.6rem 0.9rem; border: 0; border-bottom: 1px solid #e2e8f0; background: #f8fafc; font: inherit; font-weight: 700; color: #0f172a; text-align: left; cursor: pointer; white-space: nowrap; }
.lm-guide-toggle:hover { background: #f1f5f9; }
.lm-guide-inner { padding: 0.9rem 1rem 2rem; }
.lm-steps { list-style: none; margin: 0.8rem 0 0; padding: 0; display: grid; gap: 0.9rem; }
.lm-step { padding-bottom: 0.9rem; border-bottom: 1px solid #f1f5f9; }
.lm-step:last-child { border-bottom: 0; }
.lm-step-title { display: flex; align-items: baseline; gap: 0.45rem; margin: 0 0 0.25rem; font-size: 0.92rem; font-weight: 700; color: #0f172a; }
.lm-step-n { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; flex: none; border-radius: 50%; background: #0f172a; color: #fff; font-size: 0.72rem; }
.lm-step-body { margin: 0; font-size: 0.84rem; line-height: 1.55; color: #334155; }
.lm-step-layers { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0.45rem 0 0; }
.lm-chip { padding: 0.12rem 0.45rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font: inherit; font-size: 0.72rem; color: #475569; cursor: pointer; }
.lm-chip:hover:not(:disabled) { border-color: #94a3b8; color: #0f172a; }
.lm-chip--on { border-color: #0f172a; background: #0f172a; color: #fff; }
.lm-chip:disabled { border-style: dashed; color: #94a3b8; cursor: default; }
.lm-step-note { margin: 0.45rem 0 0; padding-left: 0.5rem; border-left: 2px solid #cbd5e1; font-size: 0.78rem; line-height: 1.5; color: #57534e; }
.lm-h3 { margin: 1.4rem 0 0.4rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lm-gap { margin-bottom: 0.7rem; }
.lm-tabs { display: flex; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.lm-tab { flex: 1; padding: 0.5rem 0.4rem; border: 0; border-bottom: 2px solid transparent; background: none; font: inherit; font-size: 0.8rem; font-weight: 600; color: #64748b; cursor: pointer; }
.lm-tab:hover:not(.lm-tab--on) { color: #0f172a; }
.lm-tab--on { color: #0f172a; border-bottom-color: #0f172a; background: #fff; }
.lm-lot-facts { margin: 0.1rem 0 0.5rem; font-size: 0.8rem; color: #475569; }
.lm-band { margin: 0 0 0.4rem; padding: 0.45rem 0.6rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; }
.lm-band--in { background: #fef3c7; color: #78350f; }
.lm-band--out { background: #f1f5f9; color: #475569; }
.lm-gen { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.2rem; }
.lm-gen-row { display: grid; grid-template-columns: 4.6rem 1fr auto; gap: 0.1rem 0.4rem; align-items: baseline; padding: 0.25rem 0; border-bottom: 1px solid #f1f5f9; font-size: 0.76rem; color: #334155; }
.lm-gen-why { grid-column: 2 / -1; margin: 0; font-size: 0.72rem; color: #64748b; }
.lm-gen-status { font-size: 0.7rem; font-weight: 700; white-space: nowrap; color: #64748b; }
.lm-gen--excluded .lm-gen-status { color: #b91c1c; }
.lm-gen--unknown .lm-gen-status, .lm-gen--gap .lm-gen-status { color: #b45309; }
.lm-gen--clear .lm-gen-status { color: #15803d; }
.lm-gen--na { opacity: 0.6; }
.lm-cov--none .lm-gen-status { color: #b91c1c; }
.lm-cov--partial .lm-gen-status { color: #b45309; }
.lm-clause { font-size: 0.72rem; font-weight: 700; color: #2a78d6; text-decoration: none; white-space: nowrap; }
.lm-clause:hover { text-decoration: underline; }
.lm-type { margin: 0.5rem 0; padding: 0.55rem 0.65rem; border: 1px solid #e2e8f0; border-left-width: 4px; border-radius: 6px; }
.lm-type--yes { border-left-color: #16a34a; }
.lm-type--no { border-left-color: #dc2626; }
.lm-type--maybe { border-left-color: #d97706; }
.lm-type-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem; margin: 0; }
.lm-type-verdict { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; }
.lm-type--yes .lm-type-verdict { color: #15803d; }
.lm-type--no .lm-type-verdict { color: #b91c1c; }
.lm-type--maybe .lm-type-verdict { color: #b45309; }
.lm-type-name { font-size: 0.84rem; font-weight: 700; color: #0f172a; }
.lm-type-why { margin: 0.25rem 0; font-size: 0.76rem; line-height: 1.45; color: #334155; }
.lm-checks { list-style: none; margin: 0.2rem 0 0; padding: 0; font-size: 0.74rem; color: #334155; }
.lm-check-mark { display: inline-block; width: 0.9rem; font-weight: 800; }
.lm-check--yes .lm-check-mark { color: #16a34a; }
.lm-check--no .lm-check-mark { color: #dc2626; }
.lm-check--maybe .lm-check-mark { color: #d97706; }
.lm-allow { margin: 0.35rem 0 0; font-size: 0.74rem; color: #0f172a; }
.lm-rule { border-top: 1px solid #e2e8f0; padding: 0.35rem 0; }
.lm-rule-sum { display: flex; flex-direction: column; cursor: pointer; list-style: none; }
.lm-rule-sum::-webkit-details-marker { display: none; }
.lm-reqs { list-style: none; margin: 0.3rem 0 0; padding: 0; display: grid; gap: 0.3rem; font-size: 0.75rem; color: #334155; }
.lm-reqs li { display: grid; grid-template-columns: 4.6rem 1fr; gap: 0.1rem 0.4rem; }
.lm-req-how { grid-column: 2; font-size: 0.7rem; color: #94a3b8; }
.lm-req--tested .lm-req-how { color: #15803d; font-weight: 600; }
.lm-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; margin: 0.6rem 0; }
.lm-kpi { padding: 0.5rem; border-radius: 6px; border-left: 4px solid; background: #f8fafc; }
.lm-kpi b { display: block; font-size: 1.05rem; font-variant-numeric: tabular-nums; color: #0f172a; }
.lm-kpi span { font-size: 0.7rem; color: #475569; }
.lm-kpi--in { border-color: #1971c2; }
.lm-kpi--maybe { border-color: #f08c00; }
.lm-kpi--out { border-color: #adb5bd; }
.lm-tbl { width: 100%; border-collapse: collapse; font-size: 0.76rem; color: #334155; }
.lm-tbl th { text-align: right; font-size: 0.68rem; font-weight: 700; color: #64748b; padding: 0.15rem 0.3rem; }
.lm-tbl td { padding: 0.2rem 0.3rem; border-top: 1px solid #f1f5f9; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lm-tbl td:first-child { text-align: left; }
.lm-tbl-wide { text-align: left !important; white-space: normal !important; width: 100%; }
.lm-tbl--small { font-size: 0.7rem; }
.lm-map { position: absolute; inset: 0; }

.lm-search { display: flex; gap: 0.4rem; margin-bottom: 0.4rem; }
.lm-combo { position: relative; }
.lm-combo .lm-input { width: 100%; }
.lm-combo-busy { position: absolute; right: 0.6rem; top: 50%; transform: translateY(-50%); font-size: 0.72rem; color: #94a3b8; }
.lm-listbox { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 0.25rem); max-height: 17rem; overflow-y: auto; list-style: none; margin: 0; padding: 0; background: #fff; border: 1px solid #c7d2fe; border-radius: 10px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12); }
.lm-listbox-head { padding: 0.3rem 0.6rem; background: #f5f3ff; color: #4a3aa7; font-size: 0.72rem; font-weight: 700; }
.lm-option { display: flex; justify-content: space-between; gap: 0.6rem; padding: 0.35rem 0.6rem; font-size: 0.8rem; cursor: pointer; }
.lm-option + .lm-option { border-top: 1px solid #f1f5f9; }
.lm-option--on, .lm-option:hover { background: #f5f3ff; }
.lm-option-addr { font-weight: 600; color: #0f172a; }
.lm-option-meta { display: flex; gap: 0.4rem; align-items: baseline; white-space: nowrap; font-size: 0.72rem; }
.lm-hint { margin: 0.35rem 0 0; font-size: 0.78rem; }
.lm-input { flex: 1; min-width: 0; padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.lm-input:focus { outline: 2px solid #2a78d6; outline-offset: 1px; }
.lm-btn { padding: 0.45rem 0.8rem; border: 0; border-radius: 8px; background: #0f172a; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.lm-btn:disabled { opacity: 0.5; cursor: default; }
.lm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.lm-allrow { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin: 0.6rem 0 0; padding-bottom: 0.5rem; border-bottom: 1px solid #e2e8f0; font-size: 0.8rem; }
.lm-link:disabled { color: #94a3b8; cursor: default; }
.lm-link:disabled:hover { text-decoration: none; }
.lm-group { margin-top: 1rem; }
.lm-h2 { margin: 0 0 0.2rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lm-lead { margin: 0 0 0.5rem; font-size: 0.8rem; color: #475569; }
.lm-list { list-style: none; margin: 0; padding: 0; }
.lm-item { padding: 0.35rem 0; border-top: 1px solid #f1f5f9; }
.lm-row { display: flex; align-items: center; gap: 0.45rem; cursor: pointer; }
.lm-row input { margin: 0; accent-color: #0f172a; }
.lm-name { flex: 1; min-width: 0; font-size: 0.84rem; font-weight: 600; color: #0f172a; }
.lm-count { font-size: 0.74rem; color: #64748b; font-variant-numeric: tabular-nums; }
.lm-swatch { flex: none; width: 14px; height: 14px; border-radius: 3px; border: 2px solid; box-sizing: border-box; }
.lm-swatch--dash { background: transparent !important; border-style: dashed; }
/* the Planning Portal draws its legend symbols a little larger, with the outline weight of the map */
.lm-swatch--lmr { width: 18px; height: 16px; border-radius: 2px; border-width: 1.5px; }
.lm-blurb { margin: 0.15rem 0 0 1.7rem; font-size: 0.76rem; color: #475569; }
.lm-meta { margin: 0.1rem 0 0 1.7rem; font-size: 0.72rem; color: #64748b; }
.lm-link { margin-left: 0.4rem; padding: 0; border: 0; background: none; color: #2a78d6; font: inherit; font-weight: 600; cursor: pointer; }
.lm-link:hover { text-decoration: underline; }
.lm-family { border-top: 1px solid #e2e8f0; padding: 0.35rem 0; }
.lm-family-sum { display: flex; align-items: center; gap: 0.45rem; cursor: pointer; list-style: none; padding: 0.2rem 0; }
.lm-family-sum::-webkit-details-marker { display: none; }
.lm-family-sum::before { content: '▸'; color: #94a3b8; font-size: 0.7rem; width: 0.6rem; }
.lm-family[open] > .lm-family-sum::before { content: '▾'; }
.lm-family > .lm-blurb { margin-left: 1rem; }
.lm-sepp { margin: 0.4rem 0 0 1rem; }
.lm-sepp-name { margin: 0.2rem 0; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b; }
.lm-classes { margin: 0.15rem 0 0 1.7rem; font-size: 0.72rem; color: #475569; }
.lm-classes summary { cursor: pointer; color: #2a78d6; }
.lm-classes ul { margin: 0.2rem 0 0; padding-left: 1rem; }
.lm-list--indent { margin-left: 1rem; }
.lm-cats { list-style: none; margin: 0.2rem 0 0 1.7rem; padding: 0; font-size: 0.72rem; color: #475569; display: grid; gap: 0.1rem; }
.lm-cats li { display: flex; align-items: center; gap: 0.35rem; }
.lm-swatch--small { width: 10px; height: 10px; border-width: 1px; }
.lm-about { margin: 0.2rem 0 0; font-size: 0.72rem; line-height: 1.45; color: #475569; }
.lm-foot { margin-top: 1.2rem; font-size: 0.72rem; color: #64748b; }
.lm-page code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0 0.25em; }
.lm-dim { color: #94a3b8; }
.lm-note { margin: 0.3rem 0; padding-left: 0.5rem; border-left: 2px solid #fbbf24; font-size: 0.78rem; color: #57534e; }
.lm-note--plain { border-left-color: #cbd5e1; }
.lm-error { color: #b91c1c; font-size: 0.82rem; }
.lm-over { position: absolute; top: 1rem; left: 1rem; background: #fff; padding: 0.5rem 0.75rem; border-radius: 8px; }
.lm-status { position: absolute; left: 50%; bottom: 1.2rem; transform: translateX(-50%); margin: 0; padding: 0.25rem 0.7rem; border-radius: 999px; background: rgba(15, 23, 42, 0.8); color: #fff; font-size: 0.76rem; }

.lm-pick { position: absolute; top: 0.75rem; left: 0.75rem; width: min(340px, calc(100% - 1.5rem)); max-height: calc(100% - 3rem); overflow-y: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15); padding: 0.7rem 0.85rem; }
.lm-pick-head { display: flex; justify-content: space-between; align-items: center; }
.lm-x { border: 0; background: none; font-size: 1.3rem; line-height: 1; color: #64748b; cursor: pointer; }
.lm-hits { list-style: none; margin: 0.4rem 0 0; padding: 0; }
.lm-hit { display: flex; gap: 0.5rem; padding: 0.4rem 0; border-top: 1px solid #f1f5f9; }
.lm-hit .lm-swatch { margin-top: 0.2rem; }
.lm-hit-name { margin: 0; font-size: 0.84rem; font-weight: 700; color: #0f172a; }
.lm-hit .lm-meta { margin-left: 0; }
.lm-hit .lm-link { margin-left: 0; }

@media (max-width: 760px) {
  .lm-page { height: auto; min-height: 100vh; }
  .lm-header { padding: 0.8rem 1rem; }
  .lm-body { flex-direction: column; }
  .lm-panel { width: auto; max-height: none; border-right: 0; border-bottom: 1px solid #e2e8f0; }
  .lm-panel-toggle { display: block; width: 100%; padding: 0.6rem 1rem; border: 0; background: #f1f5f9; font: inherit; font-weight: 700; text-align: left; cursor: pointer; }
  .lm-mapwrap { height: 70vh; flex: none; }
  .lm-guide { width: auto; border-left: 0; border-top: 1px solid #e2e8f0; }
}
</style>
