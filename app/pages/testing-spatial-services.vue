<!--
  Testing spatial services: a plain dump of the `derived` schema that "02C - Lot
  profile with frontage" builds. Search an address or a lot reference, pick one,
  and see every column the build has written for that lot.

  Deliberately not a report. /report explains a property and /datasources
  explains how the tables fit together; this shows the rows as they are, field
  by field, so a build can be checked while it is still running. Nothing is
  rounded, nothing is hidden, and a column that is null says so.

  It reads derived.lot_address, derived.lot_frontage and
  derived.lot_frontage_run rather than derived.lot_profile, because the wide
  table is dropped and rebuilt at the end of every run while the other three are
  written tile by tile. The three carry the same columns between them.

  Laid out to match /datasources: sticky header, one content column, sections
  with a kicker and a lead.
-->

<template>
  <div class="lp-page">
    <header class="lp-header">
      <div>
        <NuxtLink to="/" class="lp-back">&larr; Home</NuxtLink>
        <h1 class="lp-title">Testing spatial services</h1>
      </div>
      <div v-if="build" class="lp-header-stat">
        <strong>{{ fmt(build.lotAddressRows) }}</strong> addresses<template
          v-if="build.lotFrontageRows"> · <strong>{{ fmt(build.lotFrontageRows) }}</strong> lots measured</template>
        <span v-if="buildInFlight" class="lp-live">building</span>
      </div>
    </header>

    <div class="lp-shell">
      <aside class="lp-rail">
        <p class="lp-rail-state">On this page</p>
        <nav aria-label="Sections">
          <a v-for="sec in PAGE_SECTIONS" :key="sec.id" :href="`#${sec.id}`" class="lp-rail-link" :class="{ 'lp-rail-link--on': activeSection === sec.id }">{{ sec.label }}</a>
          <template v-if="detail">
            <a href="#lot" class="lp-rail-group lp-rail-group--link" :title="railTitle">{{ railTitle }}</a>
            <a v-for="sec in lotSections" :key="sec.id" :href="`#${sec.id}`" class="lp-rail-link lp-rail-link--sub" :class="{ 'lp-rail-link--on': activeSection === sec.id }">{{ sec.label }}</a>
          </template>
        </nav>
      </aside>
      <main class="lp-main">
        <!-- ── What the build has done so far ───────────────────────────── -->
        <section id="build" class="lp-section">
          <p class="lp-kicker">derived</p>
          <h2 class="lp-h2">The build</h2>
          <p class="lp-lead">
            What <code>02C - Lot profile with frontage</code> has written so far. The tables are
            filled a tile at a time, so this page reads whichever of them exist and says which do not.
          </p>

          <div class="lp-build">
            <div class="lp-build-row">
              <span class="lp-build-label">Scope</span>
              <span v-if="build?.scope.length" class="lp-chips">
                <span v-for="s in build.scope" :key="s" class="lp-chip">{{ s }}</span>
              </span>
              <span v-else class="lp-dim">every council in NSW</span>
            </div>
            <div class="lp-build-row">
              <span class="lp-build-label">Tables</span>
              <span class="lp-chips">
                <span
                  v-for="t in TABLE_ORDER" :key="t"
                  class="lp-chip" :class="build?.tables[t] ? 'lp-chip--on' : 'lp-chip--off'"
                  :title="build?.tables[t] ? 'present' : 'not created yet'"
                >derived.{{ t }}</span>
              </span>
            </div>
            <div v-if="build?.phases.length" class="lp-build-row">
              <span class="lp-build-label">Phases</span>
              <span class="lp-phases">
                <span v-for="p in build.phases" :key="p.phase" class="lp-phase">
                  <b>{{ p.phase }}</b> · {{ p.tiles }} {{ p.tiles === 1 ? 'unit' : 'units' }}
                  · {{ fmt(p.rows) }} rows
                  <span v-if="p.lastFinished" class="lp-dim">· last {{ shortWhen(p.lastFinished) }}</span>
                </span>
              </span>
            </div>
            <p v-if="build && !build.tables.lot_frontage" class="lp-note">
              The frontage pass has not written a row yet, so only the address half of the profile is
              here. This page picks the frontage up on its own once <code>derived.lot_frontage</code>
              appears.
            </p>
          </div>
        </section>

        <!-- ── Find a lot ──────────────────────────────────────────────── -->
        <section id="find" class="lp-section">
          <p class="lp-kicker">lot_address</p>
          <h2 class="lp-h2">Find a lot</h2>
          <p class="lp-lead">
            Any address or lot reference the build has loaded. Street types match either way, so
            <code>Rd</code> finds <code>ROAD</code>. A plan label such as <code>A//DP71490</code> is
            recognised and matched on <code>lot_id</code> instead.
          </p>

          <div class="lp-combo" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
            <label class="lp-sr-only" for="lp-q">Address or lot reference</label>
            <input
              id="lp-q" v-model="q" type="search" class="lp-input"
              placeholder="Start typing an address — 26 Foveaux St Surry Hills — or a lot, A//DP71490"
              autocomplete="off" spellcheck="false" role="combobox"
              :aria-expanded="listOpen && results.length > 0" aria-controls="lp-listbox"
              :aria-activedescendant="listOpen && results[highlight] ? `lp-opt-${highlight}` : undefined"
              @input="onType" @focus="listOpen = results.length > 0"
              @keydown.enter.prevent="pickHighlighted"
            >
            <span v-if="searching" class="lp-combo-busy">searching…</span>

            <!-- The suggestions. Picking one opens the lot: there is no separate
                 confirm, and a query that narrows to a single address opens it
                 on its own. -->
            <ul v-if="listOpen && results.length" id="lp-listbox" class="lp-listbox" role="listbox">
              <li class="lp-listbox-head">
                {{ results.length }}{{ results.length === SEARCH_LIMIT ? '+' : '' }}
                {{ results.length === 1 ? 'match' : 'matches' }}
                <span class="lp-dim">· ↑↓ then Enter, or click</span>
              </li>
              <li
                v-for="(r, i) in results" :id="`lp-opt-${i}`" :key="`${r.cadid}-${r.msoid}`"
                role="option" :aria-selected="i === highlight"
                class="lp-option" :class="{ 'lp-option--on': i === highlight }"
                @mousedown.prevent="pick(r)" @mousemove="highlight = i"
              >
                <span class="lp-option-addr">{{ r.address || '(no address)' }}</span>
                <span class="lp-option-meta"><code>{{ r.titleLot || r.lotId || '—' }}</code><span class="lp-dim">{{ r.lgaName || '' }}</span></span>
              </li>
            </ul>
          </div>
          <p v-if="searchError" class="lp-error">{{ searchError }}</p>
          <p v-else-if="searchHint" class="lp-dim lp-hint">{{ searchHint }}</p>
          <p v-else-if="searched && !results.length && !searching" class="lp-empty">
            Nothing matched <b>{{ lastSearched }}</b>.
            The build holds {{ fmt(build?.lotAddressRows ?? null) }} addresses<span
              v-if="build?.scope.length">, across {{ build.scope.join(', ') }}</span>.
            <span v-if="buildInFlight">
              It is still running, so an address in scope may simply not have been reached yet.
            </span>
            <span class="lp-dim">Any address in the data can be searched — try fewer words, or the lot reference.</span>
          </p>

        <p v-if="!sampleGroups.length && samplesLoaded" class="lp-note lp-samples-none">
          The per-case samples are found by querying <code>derived.lot_frontage</code>, which does not
          exist yet on this build. Search still works against every address already loaded.
        </p>

        <!-- One real lot per case, found in the data rather than written down.
             Folded away once a search has been run, so it never buries the results. -->
        <details v-if="sampleGroups.length" class="lp-samples" :open="!searched">
          <summary class="lp-samples-summary">
            Or open one of each case <span class="lp-dim">({{ samples.length }} cases)</span>
          </summary>
          <p class="lp-samples-intro">
            Every one is a real lot found in the current build, so the list follows the data rather
            than a fixed list of addresses. Searching is not limited to these — any address or lot
            reference in <code>derived.lot_address</code> works.
          </p>
          <div v-for="g in sampleGroups" :key="g.title" class="lp-sample-group">
            <h3 class="lp-h3">{{ g.title }}</h3>
            <div class="lp-sample-grid">
              <button
                v-for="s in g.items" :key="s.key" type="button" class="lp-sample"
                :class="{ 'lp-sample--on': openedCadid === s.cadid, 'lp-sample--none': !s.cadid }"
                :disabled="!s.cadid"
                :title="s.cadid ? s.blurb : 'No lot in the build matches this case yet'"
                @click="s.cadid && open(s.cadid, s.msoid)"
              >
                <span class="lp-sample-title">{{ s.title }}</span>
                <span class="lp-sample-addr">{{ s.address || (s.cadid ? '(no address)' : 'none in this build') }}</span>
                <span v-if="s.cadid" class="lp-sample-meta">
                  <code>{{ s.lotId || '—' }}</code>
                  <span v-if="s.basis" class="lp-dim">{{ s.basis }}</span>
                </span>
              </button>
            </div>
          </div>
          </details>
        </section>

        <!-- ── One lot ─────────────────────────────────────────────────── -->
        <section v-if="loading" class="lp-section lp-panel lp-dim">Loading the lot…</section>
        <section v-else-if="detailError" class="lp-section lp-panel lp-error">{{ detailError }}</section>

        <section v-else-if="detail" id="lot" class="lp-section lp-panel">
      <h2 class="lp-h2">
        {{ primaryAddress || detail.lot?.lot_id || openedCadid }}
        <span class="lp-h2-sub">cadid <code>{{ openedCadid }}</code></span>
      </h2>

      <!-- Strata: which lot this address actually is, as against the site it sits on -->
      <div v-if="strata" id="strata" class="lp-strata">
        <h3 class="lp-h3">Strata</h3>
        <dl class="lp-fields">
          <dt>Site lot</dt>
          <dd><code>{{ strata.siteLot || '—' }}</code> <span class="lp-dim">the polygon, shared by every address here</span></dd>
          <template v-if="focusRow">
            <dt>This address</dt>
            <dd>
              <code>{{ focusRow.title_lot || '—' }}</code>
              <span class="lp-dim"> title lot · propidtype {{ show(focusRow.propidtype) }}</span>
              <span v-if="PROPID_TYPE[focusRow.propidtype as number]" class="lp-strata-note">
                {{ PROPID_TYPE[focusRow.propidtype as number] }}
              </span>
            </dd>
            <dt>Its keys</dt>
            <dd>
              propid <code>{{ show(focusRow.propid) }}</code> ·
              sppropid <code>{{ show(focusRow.sppropid) }}</code> ·
              msoid <code>{{ show(focusRow.msoid) }}</code>
            </dd>
            <dt v-if="focusRow.ptlotsecpn">Titling reference</dt>
            <dd v-if="focusRow.ptlotsecpn"><code>{{ focusRow.ptlotsecpn }}</code></dd>
          </template>
          <dt>Scheme</dt>
          <dd>
            {{ strata.units }} unit {{ strata.units === 1 ? 'address' : 'addresses' }},
            {{ strata.titleLots }} distinct title {{ strata.titleLots === 1 ? 'lot' : 'lots' }}<!--
            -->{{ strata.common ? ', plus the common property address' : '' }}.
          </dd>
        </dl>
        <p class="lp-note">
          Everything below — the shape, the dimensions and the frontage — is measured on the site lot
          <code>{{ strata.siteLot || '—' }}</code>, and that is the right answer for a unit: a strata
          unit is defined by its walls and has no boundary of its own to measure, so its frontage is
          the scheme's. What separates this address from the other
          {{ detail.addresses.length - 1 }} on this lot is <code>title_lot</code>, nothing else.
        </p>
      </div>

      <!-- Two views of the same lot: what was measured, and what it was measured from -->
      <div v-if="detail.shape" id="figures" class="lp-figures">
        <figure class="lp-figure">
          <figcaption class="lp-figcap">
            Dimensions
            <span class="lp-dim">drawn from <code>derived.lot_frontage</code>, not recomputed</span>
          </figcaption>
          <LotSketch
            v-if="frontageData"
            :data="frontageData"
            :depth-m="num(detail.lot?.lot_depth_m)"
            :width-at-setback-m="num(detail.lot?.width_at_setback_m)"
            :core-width-min-m="num(detail.lot?.core_width_min_m)"
            :area-sqm="num(detail.lot?.area_sqm)"
          />
          <p v-else class="lp-dim">No frontage row yet, so there is nothing to draw.</p>
        </figure>

        <figure class="lp-figure">
          <figcaption class="lp-figcap">
            Access
            <span class="lp-dim">the same picture the datasources traces draw, with the frontage runs on it</span>
          </figcaption>
          <p v-if="build && !build.accessPassRun" class="lp-note lp-note--tight">
            Drawn as evidence, not used by this build. It was made before 02C chose frontages with
            the access line, so <code>primary_frontage_*</code> above is the engine's own choice.
            Rebuilding with the current 02C fixes it.
          </p>
          <DsLotMap
            :lots="detail.lotGeom ? [{ cadid: String(openedCadid), geometry: detail.lotGeom as any }] : []"
            :neighbours="detail.neighbours as any"
            :point="mapPoint"
            :waypoint="detail.access[0] ? { lon: detail.access[0].wayLon, lat: detail.access[0].wayLat } : null"
            :runs="detail.shape.runs.map(r => ({ coords: r.line, primary: r.isPrimary }))"
            :label="`Lot, neighbouring lots, address point and road access for ${primaryAddress || openedCadid}`"
          />
          <ul class="lp-legend lp-legend--under">
            <li v-for="r in detail.shape.runs" :key="r.seq">
              <span class="lp-swatch" :class="{ 'lp-swatch--primary': r.isPrimary }" />
              seq {{ r.seq }} · {{ r.road || 'unnamed' }}
              <span class="lp-dim">{{ r.lengthM != null ? `${r.lengthM} m` : '' }}{{ r.isPrimary ? ' · primary' : '' }}</span>
            </li>
            <li v-if="detail.access.length">
              <span class="lp-swatch lp-swatch--way" /> way point on
              <b>{{ detail.access[0]!.wayRoad || 'no road matched' }}</b>
              <span class="lp-dim">{{ detail.access[0]!.wayRoadM != null ? ` · ${detail.access[0]!.wayRoadM} m from it` : '' }}<!--
                -->{{ detail.access[0]!.accessM != null ? ` · access line ${detail.access[0]!.accessM} m` : '' }}<!--
                -->{{ detail.access[0]!.sharedBy > 1 ? ` · shared by ${detail.access[0]!.sharedBy} addresses` : '' }}</span>
            </li>
          </ul>
        </figure>
      </div>

      <!-- The lot row, grouped -->
      <template v-if="detail.lot">
        <div v-for="g in LOT_GROUPS" :id="sid(g.title)" :key="g.title" class="lp-group">
          <h3 class="lp-h3">{{ g.title }}</h3>
          <dl class="lp-fields">
            <template v-for="f in fieldsIn(detail.lot, g.fields)" :key="f.k">
              <dt><code>{{ f.k }}</code></dt>
              <dd :class="{ 'lp-null': f.isNull }">{{ f.v }}</dd>
            </template>
          </dl>
        </div>
        <details v-if="lotLeftovers.length" class="lp-more">
          <summary>{{ lotLeftovers.length }} more columns on <code>lot_frontage</code></summary>
          <dl class="lp-fields">
            <template v-for="f in lotLeftovers" :key="f.k">
              <dt><code>{{ f.k }}</code></dt>
              <dd :class="{ 'lp-null': f.isNull }">{{ f.v }}</dd>
            </template>
          </dl>
        </details>
      </template>
      <p v-else class="lp-note">
        No <code>derived.lot_frontage</code> row for this lot yet — either the frontage pass has not
        reached its tile, or it is still running.
      </p>

      <!-- Frontage runs -->
      <div v-if="detail.runs.length" id="runs" class="lp-group">
        <h3 class="lp-h3">Frontage runs <span class="lp-dim">derived.lot_frontage_run</span></h3>
        <div class="lp-scroll">
          <table class="lp-table">
            <thead>
              <tr><th v-for="c in RUN_COLUMNS" :key="c" scope="col"><code>{{ c }}</code></th></tr>
            </thead>
            <tbody>
              <tr v-for="r in detail.runs" :key="String(r.seq)" :class="{ 'lp-tr--primary': r.is_primary }">
                <td v-for="c in RUN_COLUMNS" :key="c" :class="{ 'lp-null': r[c] == null }">{{ show(r[c]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Addresses on the lot -->
      <div id="addresses" class="lp-group">
        <h3 class="lp-h3">
          Addresses on this lot <span class="lp-dim">derived.lot_address · {{ detail.addresses.length }}</span>
        </h3>
        <div class="lp-scroll">
          <table class="lp-table">
            <thead>
              <tr><th v-for="c in ADDRESS_COLUMNS" :key="c" scope="col"><code>{{ c }}</code></th></tr>
            </thead>
            <tbody>
              <tr v-for="a in detail.addresses" :key="String(a.id)" :class="{ 'lp-tr--focus': a.msoid === focusMsoid }">
                <td v-for="c in ADDRESS_COLUMNS" :key="c" :class="{ 'lp-null': a[c] == null }">{{ show(a[c]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <details v-if="detail.addresses.length" class="lp-more">
          <summary>Every column of the first address row</summary>
          <dl class="lp-fields">
            <template v-for="f in firstAddressFields" :key="f.k">
              <dt><code>{{ f.k }}</code></dt>
              <dd :class="{ 'lp-null': f.isNull }">{{ f.v }}</dd>
            </template>
          </dl>
        </details>
      </div>

      <!-- ── What each planning page returns for this lot ──────────────────
           Each block is exactly what that page's own endpoint answers, called
           the way the page calls it. Nothing is re-derived here, so a
           disagreement between two blocks is a real disagreement between the
           pages rather than one this page introduced - which is the only
           reason to put them side by side. -->
      <div v-for="p in PLANNING" :id="p.id" :key="p.id" class="lp-group">
        <h3 class="lp-h3">
          {{ p.title }}
          <span class="lp-dim"><code>{{ p.endpoint }}</code></span>
        </h3>
        <p class="lp-basis" :class="`lp-basis--${p.basisKind}`">{{ p.basis }}</p>

        <p v-if="planning[p.key]?.error" class="lp-error">{{ planning[p.key]!.error }}</p>
        <p v-else-if="!planning[p.key]" class="lp-dim">Loading&hellip;</p>
        <template v-else>
          <p class="lp-chips">
            <span v-for="s in p.summary(planning[p.key]!.data)" :key="s.label" class="lp-chip">
              <strong>{{ s.value }}</strong> {{ s.label }}
            </span>
            <span class="lp-dim">{{ planning[p.key]!.ms }} ms</span>
          </p>
          <div v-if="p.rows(planning[p.key]!.data).length" class="lp-scroll">
            <table class="lp-table">
              <thead><tr><th v-for="c in p.columns" :key="c" scope="col">{{ c }}</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in p.rows(planning[p.key]!.data)" :key="i">
                  <td v-for="(cell, j) in r" :key="j" :class="{ 'lp-null': cell === '—' }">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="lp-dim">Nothing on this lot.</p>
        </template>
      </div>

      <!-- ── Land Use Table for the lot's zone ─────────────────────────────
           /report answers this from the property record in d_4. Here the zone
           and the plan are DETECTED from the lot itself - the epi_land_zoning
           hit that /api/epi/at already returned - and resolved against
           nsw.lep_zones and nsw.lep_permissibility. Nothing is read from d_4,
           so a zone the property table has wrong shows up as a disagreement
           rather than being inherited.
           ZonePermissibility renders the three parts: as written, how the
           table is read, and resolved. -->
      <div id="permissibility" class="lp-group">
        <h3 class="lp-h3">
          Permissibility
          <span class="lp-dim"><code>epi.epi_land_zoning &rarr; nsw.lep_permissibility</code></span>
        </h3>
        <p class="lp-basis lp-basis--lot">
          Zone and plan detected from the lot polygon, not read from the property record.
        </p>

        <p v-if="zoneError" class="lp-error">{{ zoneError }}</p>
        <p v-else-if="!zones.length && planning.epi" class="lp-dim">
          No land zoning layer covers this lot, so there is no Land Use Table to resolve.
        </p>
        <p v-else-if="!zones.length" class="lp-dim">Waiting for the zoning sweep&hellip;</p>

        <div v-for="z in zones" :key="z.code + z.plan" class="lp-zone">
          <p class="lp-chips">
            <span class="lp-chip"><strong>{{ z.code }}</strong> {{ z.className }}</span>
            <span class="lp-chip">{{ z.plan }}</span>
            <span class="lp-chip">{{ z.coverPct.toFixed(1) }}% of the lot</span>
          </p>
          <ZonePermissibility v-if="z.detail" :detail="z.detail" />
          <p v-else-if="z.error" class="lp-dim">{{ z.error }}</p>
          <p v-else class="lp-dim">Resolving the Land Use Table&hellip;</p>
        </div>
      </div>

      <!-- ── CDC eligibility, type by type ─────────────────────────────────
           /api/cdc/at answers the GENERAL prerequisites, which rule out every
           certificate at once. That is half the question: the Codes SEPP has a
           code per development type with its own zone list, lot size, width and
           land tests. /api/cdc/types answers all twelve from the workbook, with
           the five columns those tests use recomputed from planningai rather
           than read from d_4.

           `untested` is on every row on purpose - a type reported eligible on
           three checks out of eleven requirements is not the same claim as one
           fully tested, and a reader has to be able to tell. -->
      <div id="cdc-eligibility" class="lp-group">
        <h3 class="lp-h3">
          CDC eligibility &mdash; every type
          <span class="lp-dim"><code>/api/cdc/types</code></span>
        </h3>
        <p class="lp-basis lp-basis--lot">Computed from the lot polygon, not read from the property record.</p>

        <p v-if="cdcTypesError" class="lp-error">{{ cdcTypesError }}</p>
        <p v-else-if="!cdcTypes" class="lp-dim">Loading&hellip;</p>
        <template v-else>
          <p class="lp-chips">
            <span class="lp-chip"><strong>{{ cdcTypes.summary.eligible }}</strong> eligible</span>
            <span class="lp-chip"><strong>{{ cdcTypes.summary.notEligible }}</strong> ruled out</span>
            <span class="lp-chip"><strong>{{ cdcTypes.summary.unknown }}</strong> undecidable</span>
            <span class="lp-chip">{{ cdcTypes.summary.untestedTotal }} requirements not tested here</span>
            <span class="lp-dim">{{ cdcTypes.ms }} ms</span>
          </p>
          <p class="lp-note">
            Zone {{ cdcTypes.lot.zones.join(', ') || 'unknown' }}
            &middot; {{ cdcTypes.lot.areaM2 ? Math.round(cdcTypes.lot.areaM2).toLocaleString() + ' m²' : 'area unknown' }}
            &middot; {{ cdcTypes.lot.widthM != null ? cdcTypes.lot.widthM.toFixed(1) + ' m wide' : 'width unknown' }}
            &middot; {{ cdcTypes.lot.inGreenfield ? 'in the Greenfield Housing Code area' : 'outside the Greenfield area' }}
            &middot; {{ cdcTypes.lot.landslideRisk ? 'landslide risk mapped' : 'no landslide risk mapped' }}
          </p>

          <p v-if="cdcTypes.generalBlockers.length" class="lp-verdict lp-verdict--no">
            <strong>{{ cdcTypes.generalBlockers.length }} general
            {{ cdcTypes.generalBlockers.length === 1 ? 'prerequisite rules' : 'prerequisites rule' }} out every
            type that inherits them</strong> &mdash;
            {{ cdcTypes.generalBlockers.map((b: any) => b.title).join(', ') }}.
          </p>
          <p v-else class="lp-verdict lp-verdict--yes">
            <strong>No general prerequisite catches this lot</strong> &mdash; each type below stands on its own tests.
          </p>
          <p v-if="cdcTypes.generalGaps.length" class="lp-note lp-note--warn">
            {{ cdcTypes.generalGaps.length }} general
            {{ cdcTypes.generalGaps.length === 1 ? 'check has' : 'checks have' }} no dataset
            ({{ cdcTypes.generalGaps.map((g: any) => g.title).join(', ') }}), so nothing below is fully cleared.
          </p>

          <div class="lp-scroll">
            <table class="lp-table lp-cdc-table">
              <thead><tr><th>Type</th><th>Code</th><th></th><th>Checks</th><th>Where it stands</th></tr></thead>
              <tbody>
                <tr v-for="t in cdcTypes.types" :key="t.key">
                  <td>{{ t.name }}<span class="lp-dset-sub">{{ t.key }}</span></td>
                  <td>{{ t.code }}<span v-if="!t.inheritsGeneral" class="lp-dset-sub">does not inherit the general prerequisites</span></td>
                  <td>
                    <span class="lp-gate" :class="t.eligible === true ? 'lp-gate--yes' : t.eligible === false ? 'lp-gate--no' : 'lp-gate--open'">
                      {{ t.eligible === true ? 'eligible' : t.eligible === false ? 'ruled out' : 'undecidable' }}
                    </span>
                  </td>
                  <td>
                    <span v-for="c in t.checks" :key="c.column + c.says" class="lp-pb-check"
                          :class="c.pass === false ? 'lp-pb-check--no' : c.pass === null ? 'lp-pb-check--unk' : ''"
                          :title="c.actual ? `lot has ${c.actual}` : 'not measured'">{{ c.says }}</span>
                    <span v-if="!t.checks.length" class="lp-dim">none testable</span>
                  </td>
                  <td>{{ t.verdict }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>

      <!-- ── Pattern Book ─────────────────────────────────────────────────
           /report reads the stored pattern-book flags. This measures the lot
           against the Pattern Book's own thresholds. It does not pick an LMR
           branch, because planningai holds no low and mid-rise area - both are
           evaluated and the design says which it turns on. -->
      <div id="pattern-book" class="lp-group">
        <h3 class="lp-h3">
          Pattern Book
          <span class="lp-dim"><code>/api/pattern-book/at</code></span>
        </h3>
        <p class="lp-basis lp-basis--lot">Measured from the lot, not read from the property record.</p>
        <p v-if="patternError" class="lp-error">{{ patternError }}</p>
        <p v-else-if="!pattern" class="lp-dim">Loading&hellip;</p>
        <template v-else>
          <p class="lp-chips">
            <span class="lp-chip"><strong>{{ pattern.summary.qualifiesEitherWay }}</strong> qualify either way</span>
            <span class="lp-chip"><strong>{{ pattern.summary.onlyInLmr }}</strong> only on one branch</span>
            <span class="lp-chip"><strong>{{ pattern.summary.ruledOut }}</strong> ruled out</span>
            <span class="lp-chip"><strong>{{ pattern.summary.unknown }}</strong> undecidable</span>
            <span class="lp-dim">{{ pattern.ms }} ms</span>
          </p>
          <p class="lp-note">
            Lot: {{ pattern.lot.areaM2 ? Math.round(pattern.lot.areaM2).toLocaleString() + ' m²' : 'area unknown' }}
            &middot; {{ pattern.lot.widthM != null ? pattern.lot.widthM.toFixed(1) + ' m wide' : 'width unknown' }}
            &middot; {{ pattern.lot.maxSlopePct != null ? 'slope ' + pattern.lot.maxSlopePct.toFixed(1) + '% max' : 'slope unknown' }}
            &middot; {{ pattern.lot.isCorner ? 'corner lot' : 'not a corner lot' }}
            &middot; {{ pattern.lot.inTod ? 'in a TOD precinct' : 'not in a TOD precinct' }}
          </p>
          <ul class="lp-caveats">
            <li v-for="(c, i) in pattern.caveats" :key="i">{{ c }}</li>
          </ul>
          <div class="lp-scroll">
            <table class="lp-table lp-pb-table">
              <thead><tr><th>Design</th><th>Category</th><th>Needs</th><th>Area gate</th><th>Thresholds</th></tr></thead>
              <tbody>
                <tr v-for="d in pattern.designs" :key="d.key">
                  <td>{{ d.designer }}<span class="lp-dset-sub">{{ d.key }}</span></td>
                  <td>{{ d.category }}</td>
                  <td>{{ d.requiredUse }}<span v-if="d.requiresCornerLot" class="lp-dset-sub">corner lot</span></td>
                  <td>
                    <span class="lp-gate" :class="d.areaGate === true ? 'lp-gate--yes' : d.areaGate === false ? 'lp-gate--no' : 'lp-gate--open'">
                      {{ d.areaGate === true ? 'met' : d.areaGate === false ? 'not met' : 'turns on LMR' }}
                    </span>
                    <span class="lp-dset-sub">{{ d.areaGateWhy }}</span>
                  </td>
                  <td>
                    <div v-for="b in d.blocks" :key="b.block" class="lp-pb-block">
                      <span class="lp-gate" :class="b.qualifies === true ? 'lp-gate--yes' : b.qualifies === false ? 'lp-gate--no' : 'lp-gate--open'">
                        {{ b.block }}
                      </span>
                      <span v-for="c in b.checks" :key="c.label" class="lp-pb-check" :class="c.pass === false ? 'lp-pb-check--no' : c.pass === null ? 'lp-pb-check--unk' : ''"
                            :title="c.note || ''">
                        {{ c.label }} {{ c.actual == null ? '?' : c.actual.toFixed(c.unit === 'm²' ? 0 : 1) }}{{ c.unit }}
                        / {{ c.required }}{{ c.unit }}
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ZoneDetail } from '#shared/lep-permissibility'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

useHead({ title: 'Testing spatial services · Planning Library' })

interface Match {
  cadid: string
  lotId: string | null
  titleLot: string | null
  msoid: number | null
  address: string | null
  suburb: string | null
  lgaName: string | null
  isPrimary: boolean | null
}
interface Build {
  scope: string[]
  phases: { phase: string; tiles: number; lots: number; rows: number; lastFinished: string | null }[]
  tables: Record<string, boolean>
  lotAddressRows: number | null
  lotFrontageRows: number | null
  accessPassRun: boolean
}
interface Shape {
  ring: [number, number][]
  runs: { seq: number; road: string | null; isPrimary: boolean; lengthM: number | null; edges: number[]; line: [number, number][] }[]
}
interface Access {
  wayLon: number
  wayLat: number
  proway: [number, number][]
  accessM: number | null
  sharedBy: number
  wayRoad: string | null
  wayRoadM: number | null
}
interface Sample {
  key: string
  group: string
  title: string
  blurb: string
  cadid: string | null
  lotId: string | null
  msoid: number | null
  address: string | null
  lgaName: string | null
  basis: string | null
  agreement: string | null
  totalFrontageM: number | null
}
interface Detail {
  build?: Build
  lot: Record<string, any> | null
  runs: Record<string, any>[]
  addresses: Record<string, any>[]
  shape: Shape | null
  points: { msoid: number | null; address: string | null; lon: number; lat: number }[]
  access: Access[]
  lotGeom: Record<string, unknown> | null
  neighbours: Record<string, unknown>[]
}

const TABLE_ORDER = ['lot_address', 'lot_frontage', 'lot_frontage_run', 'lot_profile'] as const
/** Matches the cap in the API, so the count can say "25+" rather than imply exactly 25. */
const SEARCH_LIMIT = 25

/** The lot_frontage columns worth reading first, in the order they answer questions. */
const LOT_GROUPS: { title: string; fields: string[] }[] = [
  {
    title: 'The lot',
    fields: ['lot_id', 'lotnumber', 'sectionnumber', 'planlabel', 'plan_number', 'classsubtype', 'hasstratum',
      'stratumlevel', 'itstitlestatus', 'urbanity', 'lga_name', 'lot_start_date', 'lot_last_update',
      'status', 'status_reason'],
  },
  {
    title: 'Size and shape',
    fields: ['area_sqm', 'effective_area_sqm', 'plan_lot_area', 'supplied_shape_area', 'total_boundary_m',
      'total_open_m', 'neighbour_count', 'part_count', 'ring_count', 'whole_lot_analysed'],
  },
  {
    title: 'Frontage',
    fields: ['frontage_count', 'total_frontage_m', 'primary_frontage_road', 'primary_frontage_length_m',
      'primary_frontage_basis', 'road_parcel_frontage_m', 'road_parcel_count', 'frontage_agreement',
      'abuts_motorway', 'is_corner_lot', 'is_through_lot', 'corner_streets', 'corner_basis'],
  },
  {
    title: 'Depth and width',
    fields: ['lot_depth_m', 'core_depth_m', 'lot_width_max_m', 'core_width_min_m', 'core_width_max_m',
      'width_at_setback_m', 'width_setback_depth_m'],
  },
  {
    title: 'Battle-axe',
    fields: ['is_battleaxe', 'handle_shape', 'stem_width_m', 'stem_length_m', 'stem_area_sqm',
      'handle_neck_min_m', 'handle_neck_mean_m', 'handle_length_m', 'handle_area_sqm'],
  },
  {
    title: 'Addresses and property',
    fields: ['address', 'address_count', 'unit_address_count', 'valnet_property_type', 'valnet_property_status',
      'property_type', 'parcel_count', 'valnet_lot_count', 'is_superlot'],
  },
  {
    title: 'How it was computed',
    fields: ['method_version', 'roadlike_open', 'computed_at', 'tile_gx', 'tile_gy', 'cell_gx', 'cell_gy'],
  },
]

const RUN_COLUMNS = ['seq', 'road_name', 'road_basis', 'length_m', 'road_distance_m', 'bearing_deg', 'arc_deg', 'is_primary']

/**
 * title_lot and sppropid come before the street fields on purpose: on a strata
 * scheme they are the only columns that tell one unit from another. The lot
 * polygon is the whole site, so lot_id is the same //SP number on every row.
 */
const ADDRESS_COLUMNS = ['msoid', 'address', 'unit_number', 'unit_type', 'title_lot', 'sppropid',
  'propidtype', 'propid', 'house_number', 'road_name', 'suburb', 'postcode',
  'is_primary_address', 'link_method', 'point_type', 'point_containment', 'address_confidence']

/** propidtype, spelled out. The address rule in 02C turns on it. */
const PROPID_TYPE: Record<number, string> = {
  1: 'ordinary — the address covers every lot of its property',
  2: 'strata unit — the address has its own title lot inside the scheme',
  3: 'common property — the scheme’s own address',
}

const q = ref('')
const results = ref<Match[]>([])
const build = ref<Build | null>(null)
const detail = ref<Detail | null>(null)
const openedCadid = ref<string | null>(null)
/** The address that was clicked, so a strata unit stays identifiable among its 52 siblings. */
const focusMsoid = ref<number | null>(null)
const searching = ref(false)
const loading = ref(false)
const searched = ref(false)
const lastSearched = ref('')
const searchError = ref('')
const detailError = ref('')

/** The frontage half is missing while 02C is still on phase 1. */
const buildInFlight = computed(() =>
  !!build.value && (!build.value.tables.lot_frontage || !build.value.tables.lot_profile))

// The build banner should be right from the first paint, before anything is searched.
const { data: initial } = await useFetch<{ build: Build; results: Match[] }>('/api/lotprofile')
if (initial.value?.build) build.value = initial.value.build

/**
 * The samples cost about twenty scans of lot_frontage to find, so they are
 * fetched after the page is up rather than held in front of the first paint.
 */
const samples = ref<Sample[]>([])
const samplesLoaded = ref(false)
onMounted(async () => {
  try {
    const r = await $fetch<{ samples: Sample[] }>('/api/lotprofile', { query: { samples: 1 } })
    samples.value = r.samples ?? []
  } catch {
    samples.value = []
  } finally {
    samplesLoaded.value = true
  }
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

const listOpen = ref(false)
const highlight = ref(0)
const searchHint = ref('')
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
  if (term.length < 2) { results.value = []; listOpen.value = false; searchHint.value = ''; return }
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
  searchError.value = ''
  try {
    const r = await $fetch<{ results: Match[]; hint?: string }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    searchHint.value = r.hint ?? ''
    lastSearched.value = term
    searched.value = true
    highlight.value = 0
    listOpen.value = r.results.length > 0
    // Narrowed to one address, with at least a number and a street typed:
    // open it. That is the point of typing the whole thing.
    if (r.results.length === 1 && term.split(/\s+/).length >= 2) {
      const only = r.results[0]!
      if (!(openedCadid.value === only.cadid && focusMsoid.value === only.msoid)) pick(only)
    }
  } catch (e: any) {
    if (ctrl.signal.aborted) return
    searchError.value = e?.data?.message || e?.message || 'The search failed.'
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

function pick(r: Match) {
  listOpen.value = false
  q.value = r.address || r.titleLot || r.lotId || q.value
  open(r.cadid, r.msoid)
}

function pickHighlighted() {
  if (debounce) { clearTimeout(debounce); debounce = null }
  if (listOpen.value && results.value[highlight.value]) pick(results.value[highlight.value]!)
  else runSearch()
}

async function open(cadid: string, msoid: number | null = null) {
  loading.value = true
  detailError.value = ''
  openedCadid.value = cadid
  focusMsoid.value = msoid
  try {
    detail.value = await $fetch<Detail>('/api/lotprofile', { query: { cadid } })
    // The lot section is rendered only once `loading` is off, so that has to
    // happen BEFORE the tick: with it still on, the DOM holds the placeholder,
    // #lot does not exist, and neither the scroll nor the rail's observer can
    // find anything to attach to.
    loading.value = false
    await nextTick()
    observeSections()
    // deliberately not awaited: the lot dump is the point of the page and should not wait on four
    // planning sweeps, the slowest of which is a few hundred ms
    void Promise.all([loadPlanning(cadid), loadPattern(cadid), loadCdcTypes(cadid)]).then(() => nextTick()).then(observeSections)
    // The dump is long and sits below the samples; without this a click from
    // near the top of the page looks like nothing happened.
    document.getElementById('lot')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e: any) {
    detailError.value = e?.data?.message || e?.message || 'Could not load that lot.'
    detail.value = null
  } finally {
    loading.value = false
  }
}

/** The row the search landed on, falling back to the lot's primary address. */
const focusRow = computed(() => {
  const rows = detail.value?.addresses ?? []
  if (focusMsoid.value != null) {
    const hit = rows.find(a => a.msoid === focusMsoid.value)
    if (hit) return hit
  }
  return rows.find(a => a.is_primary_address) ?? rows[0] ?? null
})

const primaryAddress = computed(() => (focusRow.value?.address as string) || '')

/** The address point to draw: the address that was opened, else the lot's first. */
const mapPoint = computed(() => {
  const f = focusRow.value
  if (f && f.point_lon != null && f.point_lat != null) return { lon: Number(f.point_lon), lat: Number(f.point_lat) }
  const p = detail.value?.points[0]
  return p ? { lon: p.lon, lat: p.lat } : null
})

// ── the side rail ────────────────────────────────────────────────────────────
/*
 * The four planning pages, each called exactly as its own page calls it.
 *
 * All four now test the same thing: the LOT POLYGON, shrunk 10 cm, against PostGIS. The `basis` line on
 * each block still states it, because /api/lmr/at can answer either way - the /lmr map click passes a
 * point and reads the PMTiles archives instead, which is the right test for "what is under my cursor"
 * and the wrong one here. A lot half inside a flood layer is a hit on the polygon and a miss on a point
 * sitting on the dry half, so a page comparing four answers has to say which test produced them.
 */
type PlanningKey = 'epi' | 'lmr' | 'cdc' | 'esa'
interface PlanningBlock {
  key: PlanningKey
  id: string
  title: string
  endpoint: string
  basis: string
  basisKind: 'lot' | 'point'
  columns: string[]
  rows: (d: any) => string[][]
  summary: (d: any) => { label: string; value: number | string }[]
}

const dash = (v: any) => (v == null || v === '' ? '—' : String(v))
const pct = (v: any) => (v == null ? '—' : Number(v).toFixed(1) + '%')

const PLANNING: PlanningBlock[] = [
  {
    key: 'epi', id: 'planning-epi', title: 'Planning layers (/epi)',
    endpoint: '/api/epi/at?cadid=',
    basis: 'Lot polygon, shrunk 10 cm, against the epi schema in PostGIS.', basisKind: 'lot',
    columns: ['Layer', 'Instrument', 'Class', 'Label', 'Zone', 'Clause', 'Covers'],
    // epi/at's `layers` is the number of DISTINCT epi tables that caught the lot, not the number
    // tested - labelling it "tested" produced "21 caught of 6 tested", which cannot be true
    summary: d => [{ label: 'features caught', value: d.hits.length }, { label: 'layers', value: d.layers }],
    rows: d => d.hits.map((h: any) => [dash(h.layName || h.layer), dash(h.epiName), dash(h.layClass),
      dash(h.label), dash(h.symCode), dash(h.clause), pct(h.coverPct)]),
  },
  {
    key: 'lmr', id: 'planning-lmr', title: 'Low and Mid Rise (/lmr)',
    endpoint: '/api/lmr/at?cadid=',
    basis: 'Lot polygon, shrunk 10 cm, against the lmr schema and the SEPP land application layers in PostGIS.',
    basisKind: 'lot',
    columns: ['Layer', 'Instrument or group', 'Class', 'Label', 'Covers'],
    summary: d => [
      { label: 'layers caught', value: d.hits.length },
      { label: 'LMR layers', value: d.hits.filter((h: any) => h.family === 'lmr').length },
      { label: 'constraints', value: d.hits.filter((h: any) => h.family === 'constraint').length },
    ],
    rows: d => d.hits.map((h: any) => [dash(h.layName), dash(h.sepp), dash(h.layClass), dash(h.label), pct(h.coverPct)]),
  },
  {
    key: 'cdc', id: 'planning-cdc', title: 'Complying development (/cdc-map)',
    endpoint: '/api/cdc/at?cadid=',
    basis: 'Lot polygon, shrunk 10 cm, against all 66 cdc layers in PostGIS.', basisKind: 'lot',
    columns: ['Layer', 'Bears on', 'Effect', 'Clauses', 'Caught', 'Covers'],
    summary: d => [
      { label: 'excluded by', value: d.verdict.general + d.verdict.code + d.verdict.midrise + d.verdict.unmapped },
      { label: 'general prerequisites', value: d.verdict.general },
      { label: 'clear of', value: d.verdict.clear },
      { label: 'unknowable (gaps)', value: d.verdict.unknown },
    ],
    rows: d => d.hits.map((h: any) => [dash(h.title), dash(h.scope), dash(h.kind),
      (h.clauses || []).join(', ') || '—', (h.names || []).slice(0, 2).join('; ') || '—', pct(h.coverPct)]),
  },
  {
    key: 'esa', id: 'planning-esa', title: 'Environmentally sensitive (/esa)',
    endpoint: '/api/esa/at?cadid=',
    basis: 'Lot polygon, shrunk 10 cm, against the esa schema in PostGIS.', basisKind: 'lot',
    columns: ['Item', 'Half', 'Para', 'Effect', 'Tier', 'Caught', 'Covers'],
    summary: d => [
      { label: 'state-wide exclusions', value: d.summary.statewide },
      { label: 'plan additions', value: d.summary.additions },
      { label: 'advisory only', value: d.summary.advisory },
      { label: 'unknowable (gaps)', value: d.summary.gaps },
    ],
    rows: d => d.hits.map((h: any) => [dash(h.item), dash(h.half), dash(h.paragraph), dash(h.kind),
      h.verifyRequired ? (h.coverageType || 'advisory') + ' · verify' : dash(h.coverageType),
      (h.names || []).slice(0, 2).join('; ') || '—', pct(h.coverPct)]),
  },
]

const planning = ref<Partial<Record<PlanningKey, { data: any; ms: number; error?: string }>>>({})

// ── CDC eligibility and the Pattern Book ────────────────────────────────
//
// Both are recomputed rather than read. /report answers them from d_4's stored flags; here the CDC
// answer is the cdc sweep already on this page, regrouped the way /report groups it, and the Pattern
// Book is measured from the lot by /api/pattern-book/at.

const cdcTypes = ref<any>(null)
const cdcTypesError = ref('')

async function loadCdcTypes(cadid: string) {
  cdcTypes.value = null
  cdcTypesError.value = ''
  try {
    cdcTypes.value = await $fetch<any>('/api/cdc/types', { query: { cadid } })
  } catch (e: any) {
    cdcTypesError.value = e?.data?.statusMessage || e?.message || 'Could not evaluate the CDC types.'
  }
}

const pattern = ref<any>(null)
const patternError = ref('')

async function loadPattern(cadid: string) {
  pattern.value = null
  patternError.value = ''
  try {
    pattern.value = await $fetch<any>('/api/pattern-book/at', { query: { cadid } })
  } catch (e: any) {
    patternError.value = e?.data?.statusMessage || e?.message || 'Could not measure the Pattern Book thresholds.'
  }
}


// ── Permissibility ──────────────────────────────────────────────────────
//
// The zone comes from the lot, not from the property record: /api/epi/at already returns the
// epi_land_zoning hit with its epi_name and sym_code, so the plan and the zone code are detected from
// the same polygon sweep as everything else on this page. /api/lep-permissibility then resolves that
// pair against nsw.lep_zones (the table as written) and nsw.lep_permissibility (every Standard
// Instrument term resolved against it). d_4 is not consulted at all, which is the point - a zone the
// property table has wrong shows up here as a disagreement instead of being inherited.
//
// A split lot gets one block per zone.

interface ZoneBlock {
  code: string
  className: string
  plan: string
  coverPct: number
  detail: ZoneDetail | null
  error: string
}
const zones = ref<ZoneBlock[]>([])
const zoneError = ref('')

async function loadZones() {
  zones.value = []
  zoneError.value = ''
  const epi = planning.value.epi?.data
  if (!epi) return
  const found = (epi.hits ?? [])
    .filter((h: any) => h.layer === 'epi_land_zoning' && h.symCode && h.epiName)
    .sort((a: any, b: any) => (b.coverPct ?? 0) - (a.coverPct ?? 0))
  zones.value = found.map((h: any) => ({
    code: String(h.symCode), className: String(h.layClass ?? ''), plan: String(h.epiName),
    coverPct: Number(h.coverPct ?? 0), detail: null, error: '',
  }))
  await Promise.all(zones.value.map(async (z) => {
    try {
      // the route returns the ZoneDetail itself for a name+code lookup - {ok, zone, objectives, raw,
      // resolved, permissibleList} - and a plan or zone listing for its other query shapes
      const res: any = await $fetch('/api/lep-permissibility', { query: { name: z.plan, code: z.code } })
      z.detail = res?.ok && res?.zone ? (res as ZoneDetail) : null
      if (!z.detail) z.error = `No Land Use Table for zone ${z.code} in ${z.plan}.`
    } catch (e: any) {
      z.error = e?.data?.statusMessage || e?.message || 'Could not resolve that zone.'
    }
  }))
}


/**
 * Ask all four at once, and let each fail on its own. One page being down is a fact worth seeing next to
 * the three that answered, not a reason to blank the section.
 */
async function loadPlanning(cadid: string) {
  planning.value = {}
  await Promise.all(PLANNING.map(async (p) => {
    const t0 = Date.now()
    try {
      const data = await $fetch<any>(p.endpoint.split('?')[0]!, { query: { cadid } })
      planning.value = { ...planning.value, [p.key]: { data, ms: data?.ms ?? Date.now() - t0 } }
    } catch (e: any) {
      planning.value = { ...planning.value, [p.key]: { data: null, ms: Date.now() - t0, error: e?.data?.statusMessage || e?.message || 'Failed' } }
    }
  }))
  // the zone comes out of the epi sweep, so this can only run once that has answered
  await loadZones()
}

const PAGE_SECTIONS = [{ id: 'build', label: 'The build' }, { id: 'find', label: 'Find a lot' }]
function sid(title: string) { return 'g-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') }
const railTitle = computed(() => (primaryAddress.value || detail.value?.lot?.lot_id || openedCadid.value || 'Lot') as string)
const lotSections = computed(() => {
  const d = detail.value
  if (!d) return []
  const out: { id: string; label: string }[] = []
  if (strata.value) out.push({ id: 'strata', label: 'Strata' })
  if (d.shape) out.push({ id: 'figures', label: 'Dimensions & access' })
  if (d.lot) for (const g of LOT_GROUPS) out.push({ id: sid(g.title), label: g.title })
  if (d.runs.length) out.push({ id: 'runs', label: 'Frontage runs' })
  out.push({ id: 'addresses', label: 'Addresses' })
  for (const p of PLANNING) out.push({ id: p.id, label: p.title })
  out.push({ id: 'permissibility', label: 'Permissibility' })
  out.push({ id: 'cdc-eligibility', label: 'CDC eligibility' })
  out.push({ id: 'pattern-book', label: 'Pattern Book' })
  return out
})

const activeSection = ref('build')
let observer: IntersectionObserver | null = null
function observeSections() {
  if (typeof IntersectionObserver === 'undefined') return
  observer?.disconnect()
  const sections = [...PAGE_SECTIONS, ...lotSections.value]
  // The observer only reports sections whose state CHANGED. Scrolling from the
  // second-last section to the last fires just "second-last: out" - the last
  // was already in the band, so it is not in the batch, and a callback that
  // looks only at the batch finds nothing and leaves the old one lit. So the
  // set of what is in the band is kept across callbacks, and the topmost of
  // that set is the active section.
  const inBand = new Map<string, Element>()
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? inBand.set(e.target.id, e.target) : inBand.delete(e.target.id)
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
    if (atEnd) { activeSection.value = sections[sections.length - 1]!.id; return }
    const top = [...inBand.values()].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
    if (top) activeSection.value = top.id
  }, { rootMargin: '-15% 0px -70% 0px' })
  for (const sec of sections) {
    const el = document.getElementById(sec.id)
    if (el) observer.observe(el)
  }
}
onMounted(observeSections)
onBeforeUnmount(() => observer?.disconnect())

/** A strata scheme: the polygon is the site, and each unit carries its own title lot. */
const strata = computed(() => {
  const rows = detail.value?.addresses ?? []
  if (!rows.length) return null
  const units = rows.filter(a => a.propidtype === 2)
  const common = rows.find(a => a.propidtype === 3)
  if (!units.length && !common) return null
  const titleLots = new Set(units.map(a => a.title_lot).filter(Boolean))
  return {
    units: units.length,
    common: !!common,
    titleLots: titleLots.size,
    siteLot: (rows[0]?.lot_id as string) || null,
  }
})

function show(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
  if (Array.isArray(v)) return v.length ? `[${v.join(', ')}]` : '[]'
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  return s === '' ? '(empty string)' : s
}

function fieldsIn(row: Record<string, any>, keys: string[]) {
  return keys.filter(k => k in row).map(k => ({ k, v: show(row[k]), isNull: row[k] == null }))
}

/** lot_frontage columns not claimed by a group, so nothing is silently dropped. */
const lotLeftovers = computed(() => {
  const row = detail.value?.lot
  if (!row) return []
  const claimed = new Set(LOT_GROUPS.flatMap(g => g.fields))
  return Object.keys(row)
    .filter(k => !claimed.has(k) && k !== 'cadid' && row[k] !== undefined)
    .sort()
    .map(k => ({ k, v: show(row[k]), isNull: row[k] == null }))
})

const firstAddressFields = computed(() => {
  const a = detail.value?.addresses[0]
  if (!a) return []
  return Object.keys(a).filter(k => a[k] !== undefined).sort()
    .map(k => ({ k, v: show(a[k]), isNull: a[k] == null }))
})

function num(v: unknown): number | null {
  return v == null || v === '' ? null : Number(v)
}

/**
 * What LotSketch needs, rebuilt from what the build wrote.
 *
 * The sketch is NOT recomputed from the cadastre: /api/frontage would give a
 * fuller payload by running the engine live, but it would then draw a different
 * answer from the one in the table, which defeats the point of a dump. So the
 * ring comes from lot_frontage.geom, the runs from lot_frontage_run (including
 * the engine's own edge_indexes), and the figures on the dimension lines are
 * passed straight through from the row.
 *
 * `edges` is the one piece not stored. It is rebuilt exactly the way the engine
 * builds it - one per ring segment, near-zero-length segments skipped - so the
 * indexes in edge_indexes still line up. `open_m` is in LotSketch's type but
 * unused, and `profile` is optional: without the sweep the narrowest-core line
 * is not drawn, while the setback width, depth and area all are.
 */
const frontageData = computed(() => {
  const s = detail.value?.shape
  const lot = detail.value?.lot
  if (!s || s.ring.length < 4) return null

  const lat0 = s.ring.reduce((t, p) => t + p[1], 0) / s.ring.length
  const mPerLat = 110540
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const edges: { index: number; length_m: number; open_m: number }[] = []
  for (let i = 0; i < s.ring.length - 1; i++) {
    const a = s.ring[i]!
    const b = s.ring[i + 1]!
    const dx = (b[0] - a[0]) * mPerLng
    const dy = (b[1] - a[1]) * mPerLat
    const len = Math.hypot(dx, dy)
    if (len <= 1e-9) continue
    edges.push({ index: edges.length, length_m: Math.round(len * 100) / 100, open_m: 0 })
  }

  return {
    ring: s.ring,
    edges,
    runs: s.runs.map(r => ({
      edges: r.edges,
      length_m: r.lengthM ?? 0,
      coords: r.line,
      road: r.road,
      is_primary: r.isPrimary,
    })),
    area_sqm: num(lot?.area_sqm),
    perimeter_m: num(lot?.total_boundary_m),
    lot_depth_m: num(lot?.lot_depth_m),
    width_at_setback_m: num(lot?.width_at_setback_m),
    width_setback_depth_m: num(lot?.width_setback_depth_m),
    core_width_min_m: num(lot?.core_width_min_m),
    is_battleaxe: !!lot?.is_battleaxe,
    handle_length_m: num(lot?.handle_length_m),
    stem_width_m: num(lot?.stem_width_m),
    handle_neck_min_m: num(lot?.handle_neck_min_m),
  }
})

// ── The access preview: lng/lat flattened to the SVG box ─────────────────────

const SVG = 320
const PAD = 14

const projection = computed(() => {
  const s = detail.value?.shape
  if (!s) return null
  // The access line and way point sit outside the lot, so the frame has to
  // cover them or the whole point of this view is cropped away.
  const acc = detail.value?.access ?? []
  const pts = [
    ...s.ring,
    ...s.runs.flatMap(r => r.line),
    ...(detail.value?.points ?? []).map(p => [p.lon, p.lat] as [number, number]),
    ...acc.flatMap(a => [[a.wayLon, a.wayLat] as [number, number], ...a.proway]),
  ]
  const lats = pts.map(p => p[1])
  const lngs = pts.map(p => p[0])
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  // Longitude degrees shrink with latitude; without this the lot leans.
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const xs = lngs.map(l => l * kx)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...lats); const maxY = Math.max(...lats)
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6
  const scale = (SVG - PAD * 2) / span
  return (lng: number, lat: number) => ({
    x: PAD + (lng * kx - minX) * scale + ((span - (maxX - minX)) * scale) / 2,
    // SVG y grows downward, so north has to be flipped to stay at the top.
    y: SVG - PAD - (lat - minY) * scale - ((span - (maxY - minY)) * scale) / 2,
  })
})

function toPath(coords: [number, number][], close: boolean): string {
  const p = projection.value
  if (!p || !coords.length) return ''
  const d = coords.map((c, i) => {
    const { x, y } = p(c[0], c[1])
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return close ? `${d} Z` : d
}

const ringPath = computed(() => toPath(detail.value?.shape?.ring ?? [], true))
const runPaths = computed(() => (detail.value?.shape?.runs ?? []).map(r => ({
  seq: r.seq, isPrimary: r.isPrimary, d: toPath(r.line, false),
})))
const pointXY = computed(() => {
  const p = projection.value
  if (!p) return []
  return (detail.value?.points ?? []).map(pt => p(pt.lon, pt.lat))
})
const accessPaths = computed(() => (detail.value?.access ?? [])
  .filter(a => a.proway.length > 1)
  .map(a => ({ d: toPath(a.proway, false) })))
const wayXY = computed(() => {
  const p = projection.value
  if (!p) return []
  return (detail.value?.access ?? []).map(a => p(a.wayLon, a.wayLat))
})

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-AU')
}
function shortWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<style>
/* Full-bleed, like /datasources, so the body reset cannot be scoped. */
body { margin: 0; background: #f8fafb; }
</style>

<style scoped>
.lp-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.lp-header {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 1.25rem 2rem;
  background: #fff; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 10;
}
.lp-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.3rem; }
.lp-back:hover { color: #0f172a; }
.lp-title { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
.lp-header-stat { font-size: 0.8rem; color: #64748b; }
.lp-header-stat strong { color: #0f172a; font-weight: 700; }
.lp-live { margin-left: 0.5rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; font-size: 0.72rem; font-weight: 700; }

/* ── Shell and sections ─────────────────────────────────────────────── */
.lp-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 2.25rem; max-width: 1360px; margin: 0 auto; padding: 1.5rem 2rem 5rem; align-items: start; }
@media (max-width: 900px) { .lp-shell { grid-template-columns: 1fr; } .lp-rail { position: static; } }
.lp-rail { position: sticky; top: 6rem; display: flex; flex-direction: column; gap: 0.1rem; }
.lp-rail-state { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.lp-rail-group--link { display: block; text-decoration: none; }
.lp-rail-group--link:hover { color: #0f172a; }
.lp-rail-group { margin: 0.8rem 0 0.3rem; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lp-rail-link { display: block; padding: 0.3rem 0.6rem; border-left: 2px solid #e2e8f0; font-size: 0.84rem; color: #475569; text-decoration: none; }
.lp-rail-link:hover { color: #0f172a; border-left-color: #94a3b8; }
.lp-rail-link--sub { padding-left: 1rem; }
.lp-rail-link--on { color: #4a3aa7; font-weight: 700; border-left-color: #4a3aa7; }
.lp-section { scroll-margin-top: 6rem; }
.lp-group, .lp-strata, .lp-figures { scroll-margin-top: 6rem; }
.lp-main { min-width: 0; }
.lp-section { padding-bottom: 2.5rem; margin-bottom: 2.5rem; border-bottom: 1px solid #e2e8f0; }
.lp-section:last-child { border-bottom: none; margin-bottom: 0; }
.lp-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4a3aa7; }
.lp-h2 { margin: 0 0 0.5rem; font-size: 1.45rem; font-weight: 800; color: #0f172a; }
.lp-lead { margin: 0 0 1.25rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 75ch; }
.lp-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }
.lp-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.lp-build { border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; padding: 0.85rem 1rem; font-size: 0.82rem; }
.lp-build-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.18rem 0; }
.lp-build-label { min-width: 4.5rem; font-weight: 700; color: #334155; }
/* The basis line on each planning block. Coloured because it is the one thing a reader has to take in
   before comparing two blocks: three test the lot polygon, /lmr tests a single point. */
.lp-basis { margin: 0.1rem 0 0.5rem; font-size: 0.76rem; padding: 0.2rem 0.5rem; border-radius: 6px;
  border-left: 3px solid; display: inline-block; }
.lp-basis--lot { background: #f0f9ff; border-color: #0284c7; color: #075985; }
.lp-basis--point { background: #fff7ed; border-color: #ea580c; color: #9a3412; }
.lp-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.lp-chip { border: 1px solid #ddd6fe; background: #f5f3ff; color: #4a3aa7; border-radius: 999px; padding: 0.05rem 0.5rem; font-size: 0.74rem; }
.lp-chip--on { border-color: #bbf7d0; background: #f0fdf4; color: #15803d; }
.lp-chip--off { border-color: #e2e8f0; background: #f8fafc; color: #94a3b8; text-decoration: line-through; }
.lp-phases { display: flex; flex-wrap: wrap; gap: 0.75rem; color: #475569; }
.lp-dim { color: #94a3b8; }
.lp-note--tight { margin: 0 0 0.55rem; font-size: 0.76rem; }
.lp-note { margin: 0.5rem 0 0; padding-left: 0.55rem; border-left: 2px solid #fbbf24; color: #57534e; font-size: 0.8rem; }

.lp-label { display: block; font-size: 0.78rem; font-weight: 700; color: #334155; margin-bottom: 0.25rem; }
.lp-combo { position: relative; max-width: 44rem; }
.lp-combo .lp-input { width: 100%; }
.lp-combo-busy { position: absolute; right: 0.9rem; top: 50%; transform: translateY(-50%); font-size: 0.74rem; color: #94a3b8; pointer-events: none; }
.lp-listbox { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 4px); list-style: none; margin: 0; padding: 0; max-height: 22rem; overflow-y: auto; border: 1px solid #c7d2fe; border-radius: 10px; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); }
.lp-listbox-head { padding: 0.3rem 0.75rem; background: #f5f3ff; color: #4a3aa7; font-size: 0.76rem; font-weight: 600; }
.lp-option { display: flex; justify-content: space-between; gap: 1rem; padding: 0.45rem 0.75rem; cursor: pointer; border-top: 1px solid #f1f5f9; }
.lp-option--on { background: #f5f3ff; box-shadow: inset 3px 0 0 #4a3aa7; }
.lp-option-addr { font-weight: 600; }
.lp-option-meta { display: flex; gap: 0.6rem; align-items: baseline; white-space: nowrap; font-size: 0.8rem; }
.lp-legend--under { margin-top: 0.5rem; }
.lp-input { flex: 1 1 22rem; min-width: 0; padding: 0.7rem 0.85rem; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; font: inherit; font-size: 0.95rem; }
.lp-input:focus { outline: 2px solid #4a3aa7; outline-offset: 1px; border-color: #4a3aa7; }
.lp-error { color: #b91c1c; margin: 0.5rem 0 0; }
.lp-hint { margin: 0.5rem 0 0; font-size: 0.8rem; }
.lp-empty { margin: 0.6rem 0 0; font-size: 0.82rem; color: #475569; max-width: 70ch; }
.lp-empty .lp-dim { display: block; margin-top: 0.15rem; }
.lp-samples-none { margin-top: 1rem; }

.lp-samples { margin-top: 1.1rem; }
.lp-samples-summary { cursor: pointer; font-size: 0.82rem; font-weight: 700; color: #4a3aa7; padding: 0.2rem 0; }
.lp-samples-summary:hover { text-decoration: underline; text-underline-offset: 2px; }
.lp-samples-intro { margin: 0.4rem 0 0.6rem; font-size: 0.8rem; color: #475569; max-width: 66ch; }
.lp-sample-group { margin-bottom: 0.8rem; }
.lp-sample-group .lp-h3 { margin-bottom: 0.3rem; }
.lp-sample-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.4rem; }
.lp-sample { display: flex; flex-direction: column; gap: 0.1rem; text-align: left; padding: 0.4rem 0.55rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font: inherit; cursor: pointer; }
.lp-sample:hover { border-color: #a5b4fc; background: #fafaff; }
.lp-sample--on { border-color: #4a3aa7; background: #f5f3ff; box-shadow: inset 2px 0 0 #4a3aa7; }
.lp-sample--none { opacity: 0.5; cursor: default; }
.lp-sample--none:hover { border-color: #e2e8f0; background: #fff; }
.lp-sample-title { font-size: 0.8rem; font-weight: 700; color: #0f172a; }
.lp-sample-addr { font-size: 0.76rem; color: #475569; overflow-wrap: anywhere; }
.lp-sample-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: baseline; font-size: 0.7rem; }
.lp-sample-meta code { font-size: 0.95em; }

.lp-results { list-style: none; margin: 0.7rem 0 0; padding: 0; border: 1px solid #c7d2fe; border-radius: 10px; overflow: hidden; background: #fff; }
.lp-results li + li { border-top: 1px solid #f1f5f9; }
.lp-results-head { padding: 0.3rem 0.75rem; background: #f5f3ff; color: #4a3aa7; font-size: 0.78rem; font-weight: 600; }
.lp-result { display: flex; justify-content: space-between; gap: 1rem; width: 100%; padding: 0.45rem 0.75rem; background: none; border: 0; font: inherit; text-align: left; cursor: pointer; }
.lp-result:hover { background: #f8fafc; }
.lp-result--on { background: #f5f3ff; }
.lp-result-addr { font-weight: 600; }
.lp-result-meta { display: flex; gap: 0.6rem; align-items: baseline; white-space: nowrap; font-size: 0.8rem; }

.lp-panel { border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; padding: 1.1rem 1.25rem 1.3rem; }
.lp-h2 { margin: 0 0 0.9rem; font-size: 1.1rem; font-weight: 800; display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; }
.lp-h2-sub { font-size: 0.78rem; font-weight: 500; color: #64748b; }
.lp-h3 { margin: 0 0 0.35rem; font-size: 0.85rem; font-weight: 800; color: #334155; display: flex; gap: 0.5rem; align-items: baseline; }
.lp-group { margin-bottom: 1.1rem; }

.lp-figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 1rem; margin-bottom: 1.3rem; align-items: start; }
.lp-figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0.6rem 0.7rem 0.7rem; background: #fff; min-width: 0; }
.lp-figcap { font-size: 0.82rem; font-weight: 800; color: #334155; margin-bottom: 0.45rem; }
.lp-figcap .lp-dim { display: block; font-weight: 400; font-size: 0.74rem; }
.lp-figure :deep(svg) { max-width: 100%; height: auto; }
.lp-svg { width: 100%; max-width: 320px; height: auto; border: 1px solid #eef2f7; border-radius: 8px; background: #fbfdff; }
.lp-proway { fill: none; stroke: #0f766e; stroke-width: 1.6; stroke-dasharray: 4 3; }
.lp-way { fill: #fff; stroke: #0f172a; stroke-width: 1.6; }
.lp-swatch--way { width: 9px; height: 9px; border-radius: 2px; background: #fff; border: 1.5px solid #0f172a; }
.lp-swatch--pw { width: 14px; height: 0; border-top: 2px dashed #0f766e; background: none; }
.lp-ring { fill: #eef2ff; stroke: #64748b; stroke-width: 1.2; }
.lp-run { fill: none; stroke: #2563eb; stroke-width: 3; stroke-linecap: round; }
.lp-run--primary { stroke: #e11d48; stroke-width: 4; }
.lp-pt { fill: #0f766e; }
.lp-legend { list-style: none; margin: 0; padding: 0; font-size: 0.8rem; color: #475569; }
.lp-legend li { display: flex; align-items: center; gap: 0.4rem; padding: 0.1rem 0; }
.lp-swatch { width: 14px; height: 3px; border-radius: 2px; background: #2563eb; }
.lp-swatch--primary { background: #e11d48; height: 4px; }
.lp-swatch--pt { width: 8px; height: 8px; border-radius: 50%; background: #0f766e; }

.lp-fields { display: grid; grid-template-columns: minmax(11rem, max-content) 1fr; gap: 0.1rem 0.9rem; margin: 0; font-size: 0.8rem; }
.lp-fields dt { color: #475569; }
.lp-fields dd { margin: 0; color: #0f172a; overflow-wrap: anywhere; }
.lp-null { color: #cbd5e1; font-style: italic; }

.lp-scroll { overflow-x: auto; }
.lp-table { border-collapse: collapse; font-size: 0.76rem; width: 100%; }
.lp-table th, .lp-table td { border: 1px solid #eef2f7; padding: 0.25rem 0.45rem; text-align: left; white-space: nowrap; }
.lp-table th { background: #f8fafc; font-weight: 700; }
.lp-table th code { background: none; padding: 0; }
.lp-tr--primary { background: #fff7ed; }
.lp-tr--focus { background: #f5f3ff; box-shadow: inset 3px 0 0 #4a3aa7; }
.lp-tr--focus td { font-weight: 600; }

.lp-strata { border: 1px solid #ddd6fe; background: #faf9ff; border-radius: 10px; padding: 0.7rem 0.9rem; margin-bottom: 1.2rem; }
.lp-strata .lp-fields { grid-template-columns: minmax(8rem, max-content) 1fr; }
.lp-strata dt { font-weight: 600; color: #4a3aa7; }
.lp-strata-note { display: block; color: #64748b; }

.lp-more { margin-top: 0.5rem; font-size: 0.8rem; }
.lp-more summary { cursor: pointer; color: #4a3aa7; font-weight: 600; }
.lp-more .lp-fields { margin-top: 0.4rem; }

@media (max-width: 560px) {
  .lp-fields { grid-template-columns: 1fr; gap: 0 0; }
  .lp-fields dt { margin-top: 0.4rem; font-weight: 700; }
}

/* CDC eligibility and Pattern Book */
.lp-cdc-table { table-layout: fixed; }
.lp-cdc-table td { overflow-wrap: anywhere; white-space: normal; }
.lp-cdc-table th:nth-child(1), .lp-cdc-table td:nth-child(1) { width: 17%; }
.lp-cdc-table th:nth-child(2), .lp-cdc-table td:nth-child(2) { width: 17%; }
.lp-cdc-table th:nth-child(3), .lp-cdc-table td:nth-child(3) { width: 9%; }
.lp-cdc-table th:nth-child(4), .lp-cdc-table td:nth-child(4) { width: 27%; }
.lp-cdc-table th:nth-child(5), .lp-cdc-table td:nth-child(5) { width: 30%; }
.lp-note--warn { color: #92400e; }
/* fixed layout so the Thresholds column keeps its room - left to itself the browser gives the long
   "area gate" prose most of the table and clips the numbers, which are the point of the row */
.lp-pb-table { table-layout: fixed; }
.lp-pb-table th:nth-child(1), .lp-pb-table td:nth-child(1) { width: 17%; }
.lp-pb-table th:nth-child(2), .lp-pb-table td:nth-child(2) { width: 12%; }
.lp-pb-table th:nth-child(3), .lp-pb-table td:nth-child(3) { width: 10%; }
.lp-pb-table th:nth-child(4), .lp-pb-table td:nth-child(4) { width: 25%; }
.lp-pb-table th:nth-child(5), .lp-pb-table td:nth-child(5) { width: 36%; }
.lp-pb-table td { overflow-wrap: anywhere; white-space: normal; }
/* .lp-table td is nowrap, which is right for the raw column dumps this page is mostly made of - one
   row per record, scrolled sideways - and wrong for the two prose columns here */
.lp-verdict { margin: 0.2rem 0 0.6rem; padding: 0.4rem 0.6rem; border-radius: 8px; font-size: 0.82rem; border-left: 3px solid; }
.lp-verdict--yes { background: #f0fdf4; border-color: #16a34a; color: #166534; }
.lp-verdict--no { background: #fef2f2; border-color: #dc2626; color: #991b1b; }
.lp-cdc-scope { margin-bottom: 0.5rem; }
.lp-cdc-scope-head { margin: 0 0 0.2rem; font-size: 0.78rem; font-weight: 700; color: #334155; }
.lp-cdc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.lp-cdc-list li { font-size: 0.76rem; padding: 0.2rem 0.5rem; background: #f8fafc; border-radius: 6px; }
.lp-cdc-name { display: block; color: #0f172a; }
.lp-cdc-gaps .lp-cdc-list li { background: #fffbeb; }
.lp-caveats { margin: 0.3rem 0 0.6rem; padding-left: 1rem; font-size: 0.76rem; color: #92400e; }
.lp-caveats li { margin-bottom: 0.15rem; }
.lp-gate { display: inline-block; padding: 0.05rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; }
.lp-gate--yes { background: #dcfce7; color: #166534; }
.lp-gate--no { background: #fee2e2; color: #991b1b; }
.lp-gate--open { background: #fef3c7; color: #92400e; }
.lp-pb-block { margin-bottom: 0.25rem; display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
.lp-pb-check { font-size: 0.7rem; padding: 0.05rem 0.35rem; border-radius: 4px; background: #f1f5f9; color: #475569; white-space: nowrap; }
.lp-pb-check--no { background: #fee2e2; color: #991b1b; }
.lp-pb-check--unk { background: #f5f3ff; color: #6d28d9; }
.lp-dset-sub { display: block; font-size: 0.7rem; color: #94a3b8; }
</style>
