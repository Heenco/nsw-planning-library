<template>
  <div class="report-page">

    <!-- Header -->
    <div class="report-header">
      <NuxtLink to="/" class="back-link">&larr; Home</NuxtLink>
      <h1 class="report-title">Property Report</h1>
      <p class="report-subtitle">{{ personaLabel }} · {{ address || 'Loading…' }}</p>
    </div>

    <!-- Pipeline steps (at the top, open by default) -->
    <details v-if="steps.length > 0 || loading" class="steps-panel" open>
      <summary class="steps-summary">
        <span>Pipeline</span>
        <span v-if="loading" class="steps-running">Running…</span>
        <span v-else class="steps-done">Complete</span>
      </summary>
      <div class="steps-list">
        <div v-for="(s, i) in steps" :key="i" :class="['step-item', 'step-item--' + s.status]">
          <span class="step-agent">{{ s.agent }}</span>
          <span class="step-msg">{{ s.message }}</span>
        </div>
      </div>
    </details>

    <!-- ── Section 1: Property Identity (always visible) ──────────────── -->
    <div v-if="property" class="facts-card">
      <h2 class="facts-heading">Property Identity</h2>
      <div class="facts-grid">
        <div class="fact" v-if="p.address"><span class="fact-label">Address</span><span class="fact-value">{{ p.address }}</span></div>
        <div class="fact" v-if="p.suburbname"><span class="fact-label">Suburb</span><span class="fact-value">{{ p.suburbname }} {{ p.postcode }}</span></div>
        <div class="fact" v-if="p.zone"><span class="fact-label">Zone</span><span class="fact-value fact-value--zone">{{ p.zone }} <span class="fact-sub" v-if="p.zone_class">{{ p.zone_class }}</span></span></div>
        <div class="fact" v-if="p.lep_name"><span class="fact-label">LEP</span><span class="fact-value">{{ p.lep_name }}</span></div>
        <div class="fact" v-if="p.lga_name"><span class="fact-label">LGA</span><span class="fact-value">{{ p.lga_name }}</span></div>
        <div class="fact" v-if="p.council_name"><span class="fact-label">Council</span><span class="fact-value">{{ p.council_name }}</span></div>
        <div class="fact" v-if="lots.length <= 1 && p.plan_label"><span class="fact-label">Lot / Plan</span><span class="fact-value">{{ p.plan_label }}</span></div>
        <div class="fact" v-if="p.dcp_plan_name"><span class="fact-label">DCP</span><span class="fact-value">{{ p.dcp_plan_name }}</span></div>
        <div class="fact" v-if="p.land_value_1"><span class="fact-label">Land Value</span><span class="fact-value fact-value--num">${{ Number(p.land_value_1).toLocaleString() }}</span></div>
        <div class="fact" v-if="p.region_name"><span class="fact-label">Region</span><span class="fact-value">{{ p.region_name }}</span></div>
      </div>

      <!-- Multiple lots -->
      <div v-if="lots.length > 0" class="lots-section">
        <h3 class="lots-heading">Lots ({{ lots.length }})</h3>
        <div class="lots-list">
          <div v-for="(lot, i) in lots" :key="i" class="lot-item">
            <span class="lot-id">{{ lot.lot_section_plan || [lot.lotnumber, lot.plan_label].filter(Boolean).join('/') || '–' }}</span>
            <span v-if="lot.area_h" class="lot-area">{{ Number(lot.area_h).toFixed(3) }} ha</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Section 2: Development Standards ────────────────────────────── -->
    <details v-if="property && (p.fsr_value || p.max_height_m || p.min_lot_size)" class="rpt-section" open>
      <summary class="rpt-section-title">Development Standards</summary>
      <div class="facts-grid">
        <div class="fact" v-if="p.fsr_value"><span class="fact-label">Floor Space Ratio</span><span class="fact-value fact-value--num">{{ p.fsr_value }}<span class="fact-sub" v-if="p.fsr_lay_class">{{ p.fsr_lay_class }}</span></span></div>
        <div class="fact" v-if="p.max_height_m"><span class="fact-label">Max Building Height</span><span class="fact-value fact-value--num">{{ p.max_height_m }}m</span></div>
        <div class="fact" v-if="p.min_lot_size"><span class="fact-label">Min Lot Size</span><span class="fact-value fact-value--num">{{ p.min_lot_size }} {{ p.lot_size_units || 'sqm' }}</span></div>
      </div>
    </details>

    <!-- ── Section 3: Lot Map & Dimensions ────────────────────────────── -->
    <details v-if="property && p.centroid_lat && p.centroid_lon" class="rpt-section" open @toggle="onMapToggle">
      <summary class="rpt-section-title">Lot Map & Dimensions</summary>
      <div class="lot-map-layout">
        <!-- Map -->
        <div class="lot-map-container">
          <div ref="mapEl" class="lot-map"></div>

          <!-- Measure tool. Same geodesic maths as the tile-catalog map
               (shared/geo-measure.mjs), so the two never disagree. -->
          <div class="lot-measure-control">
            <button
              type="button"
              class="lot-measure-btn"
              :class="{ 'lot-measure-btn--on': measureMode === 'distance' }"
              title="Measure distance — click points on the map"
              @click="toggleMeasure('distance')"
            >distance</button>
            <button
              type="button"
              class="lot-measure-btn"
              :class="{ 'lot-measure-btn--on': measureMode === 'area' }"
              title="Measure area — click points to enclose it"
              @click="toggleMeasure('area')"
            >area</button>
            <button
              v-if="measurePoints.length"
              type="button"
              class="lot-measure-btn lot-measure-btn--clear"
              title="Clear measurement"
              @click="clearMeasure"
            >clear</button>
          </div>

          <div v-if="measureMode || measurePoints.length" class="lot-measure-readout">
            <div v-if="measureTotal" class="lot-measure-value">{{ measureTotal }}</div>
            <div v-if="measureSecondary" class="lot-measure-secondary">{{ measureSecondary }}</div>
            <div class="lot-measure-hint">
              <template v-if="measureMode">
                {{ measurePoints.length < measureMinPoints
                  ? `Click ${measureMinPoints - measurePoints.length} more point${measureMinPoints - measurePoints.length > 1 ? 's' : ''}`
                  : 'Double-click to finish' }} · Esc to cancel
              </template>
              <template v-else>Finished · {{ measurePoints.length }} points</template>
            </div>
          </div>
        </div>
        <!-- Dimensions -->
        <div class="lot-dims">
          <div class="lot-dims-grid">
            <div class="dim" v-if="p.area_h"><span class="dim-label">Area</span><span class="dim-value">{{ Number(p.area_h).toFixed(3) }} ha</span></div>
            <div class="dim" v-if="p.longest_axis_m"><span class="dim-label">Longest axis</span><span class="dim-value">{{ Number(p.longest_axis_m).toFixed(1) }}m</span></div>
            <div class="dim" v-if="p.min_width_m"><span class="dim-label">Min width</span><span class="dim-value">{{ Number(p.min_width_m).toFixed(1) }}m</span></div>
            <div class="dim" v-if="p.average_slope"><span class="dim-label">Avg slope</span><span class="dim-value">{{ Number(p.average_slope).toFixed(1) }}°</span></div>
          </div>

          <!-- Boundary side lengths.
               Drawn on the boundary itself wherever the map geometry can be
               trusted; the list is the fallback for when it cannot, so the
               numbers are never simply lost. -->
          <div class="edge-list">
            <div class="edge-heading">
              Side lengths
              <span v-if="sideLabelsDrawn" class="edge-count">{{ sideLabelsDrawn }} on map</span>
              <span v-else-if="edgeMeasurements.length" class="edge-count">{{ edgeMeasurements.length }} sides</span>
            </div>

            <p v-if="sideLabelsDrawn" class="edge-onmap">Shown on each boundary.</p>

            <template v-else-if="edgeMeasurements.length">
              <div class="edge-items">
                <span v-for="(e, i) in edgeMeasurements" :key="i" class="edge-chip">
                  <span class="edge-n">{{ i + 1 }}</span>
                  <span class="edge-num">{{ e.value }}</span><span class="edge-unit">{{ e.unit }}</span>
                </span>
              </div>
              <p v-if="sideLabelsSkipped" class="edge-note">Not drawn on the map — {{ sideLabelsSkipped }}.</p>
            </template>

            <!-- Absence is stated rather than rendered as a blank gap: the
                 panel used to disappear silently whenever the column was
                 missing, which read as a bug rather than as missing data. -->
            <p v-else class="edge-empty">Not recorded for this lot.</p>
          </div>

          <!-- Frontages -->
          <div v-if="frontageItems.length" class="edge-list">
            <div class="edge-heading">Frontages</div>
            <div class="edge-items">
              <span v-for="(f, i) in frontageItems" :key="i" class="edge-chip edge-chip--frontage">
                <span class="edge-road">{{ f.road }}</span>
                <span class="edge-num">{{ f.value }}</span><span class="edge-unit">{{ f.unit }}</span>
              </span>
            </div>
          </div>

          <!-- Flags -->
          <div class="lot-flags">
            <span v-if="isYes(p.is_corner_lot)" class="lot-flag lot-flag--green">Corner lot</span>
            <span v-if="isYes(p.is_battleaxe)" class="lot-flag lot-flag--amber">Battle-axe</span>
            <span v-if="p.num_frontages" class="lot-flag">{{ p.num_frontages }} frontage(s)</span>
          </div>
        </div>
      </div>
    </details>

    <!-- ── Section 4: Environmental Constraints ────────────────────────── -->
    <details v-if="property && constraints.length > 0" class="rpt-section" open>
      <summary class="rpt-section-title">Environmental Constraints ({{ constraints.length }})</summary>
      <div class="constraint-chips">
        <span v-for="c in constraints" :key="c.label" :class="['constraint-chip', 'constraint-chip--' + c.severity]">
          {{ c.label }}
        </span>
      </div>
    </details>

    <!-- ── Section 5: Heritage ─────────────────────────────────────────── -->
    <details v-if="property && p.heritage_name" class="rpt-section" open>
      <summary class="rpt-section-title">Heritage</summary>
      <div class="facts-grid">
        <div class="fact"><span class="fact-label">Heritage Item</span><span class="fact-value">{{ p.heritage_name }}</span></div>
        <div class="fact" v-if="p.heritage_id"><span class="fact-label">Heritage ID</span><span class="fact-value">{{ p.heritage_id }}</span></div>
        <div class="fact" v-if="p.heritage_class"><span class="fact-label">Classification</span><span class="fact-value">{{ p.heritage_class }}</span></div>
      </div>
    </details>

    <!-- ── Section 6: CDC Eligibility ──────────────────────────────────── -->
    <details v-if="property" class="rpt-section" open>
      <summary class="rpt-section-title">Complying Development (CDC) Eligibility</summary>
      <div class="cdc-summary">
        <span :class="['cdc-badge', isYes(p.cdc_eligible) ? 'cdc-badge--yes' : 'cdc-badge--no']">
          {{ isYes(p.cdc_eligible) ? '✓ CDC Eligible' : '✗ Not CDC Eligible' }}
        </span>
        <span v-if="p.total_cdc_eligible" class="cdc-count">{{ p.total_cdc_eligible }} pathway(s)</span>
      </div>
      <div class="cdc-grid">
        <div v-for="c in cdcPathways" :key="c.key" class="cdc-item">
          <span :class="['cdc-dot', c.eligible ? 'cdc-dot--yes' : 'cdc-dot--no']"></span>
          <span class="cdc-name">{{ c.label }}</span>
          <span v-if="!c.eligible && c.exclusions" class="cdc-excl">{{ c.exclusions }}</span>
        </div>
      </div>
    </details>

    <!-- ── Additional controls on part of the lot ──────────────────────
         A comma in the _p columns means the lot is split: two zones, two FSRs,
         two minimum lot sizes. Worth stating plainly, because the headline
         zone above then applies to only part of the site. -->
    <details v-if="additionalControls.length" class="rpt-section" open>
      <summary class="rpt-section-title">Additional controls on part of the lot</summary>
      <p class="envelope-blurb">
        This lot is split — the controls below apply to part of the site, so the
        headline values above do not cover all of it.
      </p>
      <div class="facts-grid">
        <div v-for="a in additionalControls" :key="a.label" class="fact">
          <span class="fact-label">{{ a.label }}</span>
          <span class="fact-value">{{ a.value }}</span>
        </div>
      </div>
    </details>

    <!-- ── Section 7: LMR Housing & Pattern Book ───────────────────────── -->
    <details v-if="property && (isYes(p.in_lmr_housing_area) || patternBookItems.length > 0)" class="rpt-section" open>
      <summary class="rpt-section-title">Low-Mid Rise Housing & Pattern Book</summary>
      <div v-if="isYes(p.in_lmr_housing_area)" class="lmr-badge">In LMR Housing Area</div>
      <div class="facts-grid" v-if="p.lmr_permissible || p.lmr_height_rfb || p.lmr_height_sth">
        <div class="fact" v-if="p.lmr_permissible"><span class="fact-label">LMR Permissible</span><span class="fact-value">{{ p.lmr_permissible }}</span></div>
        <div class="fact" v-if="p.lmr_height_rfb"><span class="fact-label">RFB Height</span><span class="fact-value">{{ p.lmr_height_rfb }}</span></div>
        <div class="fact" v-if="p.lmr_height_sth"><span class="fact-label">STH Height</span><span class="fact-value">{{ p.lmr_height_sth }}</span></div>
      </div>
      <div v-if="patternBookItems.length" class="cdc-grid" style="margin-top:0.5rem">
        <div v-for="pb in patternBookItems" :key="pb.key" class="cdc-item">
          <span :class="['cdc-dot', pb.eligible ? 'cdc-dot--yes' : 'cdc-dot--no']"></span>
          <span class="cdc-name">{{ pb.label }}</span>
          <span v-if="!pb.eligible && pb.reasons" class="cdc-excl">{{ pb.reasons }}</span>
        </div>
      </div>
    </details>

    <!-- ── Uses permitted via SEPP ──────────────────────────────────────
         sepp_landuses is the lot's SEPP-permissible list, distinct from the
         zone's LEP permitted uses — a use can be available under a SEPP that
         the LEP does not list. -->
    <details v-if="seppUses.length" class="rpt-section" open>
      <summary class="rpt-section-title">Uses Permitted via SEPP ({{ seppUses.length }})</summary>
      <p v-if="seppInstruments.length" class="envelope-blurb">
        Under {{ seppInstruments.join(' and ') }}.
      </p>
      <div class="uses-list">
        <span v-for="u in seppUses" :key="u" class="use-chip">{{ u }}</span>
      </div>
    </details>

    <!-- ── Key numerical rules ─────────────────────────────────────────
         One row per control with its clause, after PropCode's Rapid Planning
         Report. Where a control is banded and the selector was not captured,
         the range is shown rather than a single figure. -->
    <details v-if="numericRuleGroups.length" class="rpt-section" open>
      <summary class="rpt-section-title">Key Numerical Rules ({{ numericRuleCount }})</summary>
      <p class="envelope-blurb">
        From the {{ ruleSourceLabel }} control tables for zone {{ p?.zone }},
        grouped by what each control applies to. Controls listed under a land use
        are stated by the DCP for that use; controls under a development type name
        no land use, so they apply to that part of the DCP generally.
      </p>
      <p v-if="dcpNameMismatch" class="rules-mismatch">
        The property record names <strong>{{ p?.dcp_plan_name }}</strong> as the DCP for
        this lot. The clause numbers below are from {{ ruleSourceLabel }}, which is the
        version held here — check the clause before relying on the numbering.
      </p>

      <details
        v-for="(g, i) in numericRuleGroups"
        :key="g.key"
        class="rules-group"
        :open="groupOpen(i)"
      >
        <summary class="rules-group-title">
          {{ g.label }}
          <span class="rules-axis" :class="`rules-axis-${g.axis}`">
            {{ g.axis === 'land_use' ? 'use-specific' : 'general' }}
          </span>
          <span class="rules-count">{{ g.rules.length }}</span>
        </summary>
        <p class="rules-group-note">{{ g.note }}</p>
        <table class="rules-table">
          <thead><tr><th>Control</th><th>Requirement</th><th>Applies when</th><th>Clause</th></tr></thead>
          <tbody>
            <tr v-for="r in g.rules" :key="r.key">
              <td>{{ r.label }}</td>
              <td>
                {{ r.requirement }}
                <span
                  v-if="r.suspect"
                  class="rules-suspect"
                  title="The unit recorded for this control does not match what the topic measures — read the clause before relying on it."
                >check clause</span>
              </td>
              <td class="rules-cond">{{ r.condition || '—' }}</td>
              <td>
                <a v-if="r.clauseHref" :href="r.clauseHref" class="rules-cite">cl {{ r.clause }}</a>
                <span v-else>cl {{ r.clause }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </details>

    <!-- ── Special constraints ─────────────────────────────────────────
         Stating "no overlay applies" is a finding, not an omission — an empty
         column and an unchecked constraint look identical otherwise. -->
    <details v-if="property" class="rpt-section" open>
      <summary class="rpt-section-title">Special Constraints</summary>
      <div class="constraint-list">
        <div v-for="c in specialConstraints" :key="c.label" class="constraint-row">
          <span :class="['cdc-dot', c.applies ? 'cdc-dot--no' : 'cdc-dot--yes']"></span>
          <span class="constraint-name">{{ c.label }}</span>
          <span class="constraint-detail">{{ c.detail }}</span>
        </div>
      </div>
    </details>

    <!-- ── Section 8: the envelope in 3D ────────────────────────────────
         /api/property/envelope builds the model when the viewer asks for it, so
         the link is available for every lot rather than only the handful the
         batch script had been run over. -->
    <details v-if="envelopeModel" class="rpt-section" open>
      <summary class="rpt-section-title">Building envelope (3D)</summary>
      <p class="envelope-blurb">
        The setbacks and height limit above, drawn as the volume this lot can build
        inside. Each plane is named after the clause that sets it.
      </p>
      <a class="envelope-link" :href="envelopeModel" target="_blank" rel="noopener">
        Open in 3D Viewer &rarr;
      </a>
    </details>

    <!-- ── Section 8: Proximity & Amenity ──────────────────────────────── -->
    <details v-if="property && (p.closest_school || p.closest_hospital || p.closest_railway_station)" class="rpt-section" open>
      <summary class="rpt-section-title">Proximity & Amenity</summary>
      <div class="facts-grid">
        <div class="fact" v-if="p.walkable_score"><span class="fact-label">Walk Score</span><span class="fact-value fact-value--num">{{ p.walkable_score }}</span></div>
        <div class="fact" v-if="p.closest_school"><span class="fact-label">Nearest School</span><span class="fact-value">{{ p.closest_school }} <span class="fact-sub">{{ p.closest_school_distance_m ? Number(p.closest_school_distance_m).toFixed(0) + 'm' : '' }}</span></span></div>
        <div class="fact" v-if="p.closest_hospital"><span class="fact-label">Nearest Hospital</span><span class="fact-value">{{ p.closest_hospital }} <span class="fact-sub">{{ p.closest_hospital_distance_m ? Number(p.closest_hospital_distance_m).toFixed(0) + 'm' : '' }}</span></span></div>
        <div class="fact" v-if="p.closest_railway_station"><span class="fact-label">Nearest Station</span><span class="fact-value">{{ p.closest_railway_station }} <span class="fact-sub">{{ p.closest_railway_station_distance_m ? Number(p.closest_railway_station_distance_m).toFixed(0) + 'm' : '' }}</span></span></div>
        <div class="fact" v-if="p.estimated_price"><span class="fact-label">Est. Price</span><span class="fact-value fact-value--num">${{ Number(p.estimated_price).toLocaleString() }}</span></div>
        <div class="fact" v-if="p.no_of_beds"><span class="fact-label">Beds / Baths / Cars</span><span class="fact-value">{{ p.no_of_beds || '–' }} / {{ p.no_of_baths || '–' }} / {{ p.no_of_cars || '–' }}</span></div>
      </div>
    </details>

    <!-- ── Permitted uses ──────────────────────────────────────────────── -->
    <details v-if="permittedUses.length > 0" class="rpt-section" open>
      <summary class="rpt-section-title">Permitted Uses in Zone {{ p?.zone }} ({{ permittedUses.length }})</summary>
      <div class="uses-hint">Click a use to pull its LEP / SEPP / DCP controls for this lot.</div>
      <div class="uses-list">
        <button
          v-for="u in permittedUses"
          :key="u"
          type="button"
          :class="['use-chip', 'use-chip--clickable', selectedUse === u && 'use-chip--active']"
          :disabled="useAnalysisLoading"
          @click="selectUse(u)"
        >{{ u }}</button>
      </div>

      <!-- Use-specific controls panel (planner persona only) -->
      <div v-if="selectedUse" class="use-analysis">
        <div class="use-analysis-header">
          <span class="use-analysis-label">Controls for</span>
          <span class="use-analysis-use">{{ selectedUse }}</span>
          <span v-if="useAnalysisLoading" class="use-analysis-loading">analysing…</span>
          <button v-if="!useAnalysisLoading" class="use-analysis-close" type="button" @click="clearSelectedUse">Close</button>
        </div>

        <div v-for="inst in ['lep', 'sepp', 'dcp'] as const" :key="inst"
             v-show="useStreams[inst].text || useAnalysisLoading"
             :class="['instrument-section', 'instrument-section--' + inst]">
          <div class="instrument-header">
            <span :class="['instrument-badge', 'instrument-badge--' + inst]">{{ inst.toUpperCase() }}</span>
            {{ inst.toUpperCase() }} Findings
          </div>
          <div v-if="useStreamsProxy[inst].text" class="answer-body" v-html="useStreamsProxy[inst].html"></div>
          <div v-else class="answer-loading">Searching {{ inst.toUpperCase() }}…</div>
        </div>

        <div v-if="useStreamsCitations.length > 0" class="sources-section">
          <h3 class="sources-heading">Sources ({{ useStreamsCitations.length }})</h3>
          <div class="sources-list">
            <div v-for="c in useStreamsCitations" :key="c.number" class="source-item">
              <span class="source-num">{{ c.number }}</span>
              <span :class="['source-badge', 'source-badge--' + c.doc_type]">{{ c.doc_type.toUpperCase() }}</span>
              <span class="source-label"><strong>{{ c.document_short }}</strong> {{ c.citation_label }}</span>
              <a v-if="c.clause_url" :href="c.clause_url" target="_blank" rel="noopener" class="source-link">View source</a>
              <p v-if="c.source_quote" class="source-quote">{{ c.source_quote }}</p>
            </div>
          </div>
        </div>
      </div>
    </details>

    <!-- Planning Summary — split into LEP / SEPP / DCP sections.
         Shown for every report. -->
    <div v-if="answerHtml || loading" class="answer-section">
      <h2 class="answer-heading">Planning Summary</h2>
      <div v-if="loading && !answerText" class="answer-loading">Analysing planning instruments…</div>

      <div v-if="splitSections.lep" class="instrument-section instrument-section--lep">
        <div class="instrument-header"><span class="instrument-badge instrument-badge--lep">LEP</span> LEP Findings</div>
        <div class="answer-body" v-html="splitSections.lep"></div>
      </div>

      <div v-if="splitSections.sepp" class="instrument-section instrument-section--sepp">
        <div class="instrument-header"><span class="instrument-badge instrument-badge--sepp">SEPP</span> SEPP Findings</div>
        <div class="answer-body" v-html="splitSections.sepp"></div>
      </div>

      <div v-if="splitSections.dcp" class="instrument-section instrument-section--dcp">
        <div class="instrument-header"><span class="instrument-badge instrument-badge--dcp">DCP</span> DCP Findings</div>
        <div class="answer-body" v-html="splitSections.dcp"></div>
      </div>

      <!-- Fallback if LLM didn't follow the 3-section format -->
      <div v-if="!splitSections.lep && !splitSections.sepp && !splitSections.dcp && answerHtml" class="answer-body" v-html="answerHtml"></div>
    </div>

    <!-- Citations -->
    <div v-if="citations.length > 0" class="sources-section">
      <h2 class="sources-heading">Sources ({{ citations.length }})</h2>
      <div class="sources-list">
        <div v-for="c in citations" :key="c.number" class="source-item">
          <span class="source-num">{{ c.number }}</span>
          <span :class="['source-badge', 'source-badge--' + c.doc_type]">{{ c.doc_type.toUpperCase() }}</span>
          <span class="source-label">
            <strong>{{ c.document_short }}</strong> {{ c.citation_label }}
          </span>
          <a v-if="c.clause_url" :href="c.clause_url" target="_blank" rel="noopener" class="source-link">View source</a>
          <p v-if="c.source_quote" class="source-quote">{{ c.source_quote }}</p>
        </div>
      </div>
    </div>

    <!-- Deep legal cards — replaced by use-specific controls panel above.
         Kept commented for potential reuse; see also server/utils/sitewise/deep-legal-cards.ts.
    <div v-if="legalCards.length > 0" class="legal-cards-section">
      <h2 class="answer-heading">Detailed Planning Analysis</h2>
      <div class="legal-cards-grid">
        <div v-for="card in legalCards" :key="card.id" class="legal-card">
          <div class="legal-card-header">
            <div>
              <div class="legal-card-title">{{ card.title }}</div>
              <div class="legal-card-desc">{{ card.description }}</div>
            </div>
            <span v-if="card.docFilter" :class="['source-badge', 'source-badge--' + card.docFilter]">{{ card.docFilter.toUpperCase() }}</span>
          </div>
          <div v-if="card.answer" class="legal-card-body" v-html="renderCardAnswer(card.answer, card.citations)"></div>
          <div v-else-if="card.error" class="legal-card-error">{{ card.error }}</div>
          <div v-else class="legal-card-loading">Analysing…</div>
        </div>
      </div>
    </div>
    -->


    <!-- Follow-up question -->
    <div v-if="property && !loading" class="followup-section">
      <h2 class="followup-heading">Ask a follow-up question about this property</h2>
      <form class="followup-form" @submit.prevent="submitFollowup">
        <div class="followup-search-card">
          <textarea
            v-model="followupQuery"
            class="followup-input"
            :placeholder="`e.g. Can I build a granny flat at ${p.address || 'this property'}?`"
            rows="1"
            :disabled="followupLoading"
            @keydown.enter.exact.prevent="submitFollowup"
            @input="autoResizeFollowup"
          ></textarea>
          <button class="followup-send" :disabled="followupLoading || !followupQuery.trim()" type="submit">
            <svg v-if="!followupLoading" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            <span v-else class="spinner"></span>
          </button>
        </div>
      </form>

      <!-- Follow-up answer -->
      <div v-if="followupAnswerHtml || followupLoading" class="followup-answer">
        <div v-if="followupLoading && !followupAnswerText" class="answer-loading">Thinking…</div>

        <div v-if="followupSplit.lep" class="instrument-section instrument-section--lep">
          <div class="instrument-header"><span class="instrument-badge instrument-badge--lep">LEP</span> LEP Findings</div>
          <div class="answer-body" v-html="followupSplit.lep"></div>
        </div>
        <div v-if="followupSplit.sepp" class="instrument-section instrument-section--sepp">
          <div class="instrument-header"><span class="instrument-badge instrument-badge--sepp">SEPP</span> SEPP Findings</div>
          <div class="answer-body" v-html="followupSplit.sepp"></div>
        </div>
        <div v-if="followupSplit.dcp" class="instrument-section instrument-section--dcp">
          <div class="instrument-header"><span class="instrument-badge instrument-badge--dcp">DCP</span> DCP Findings</div>
          <div class="answer-body" v-html="followupSplit.dcp"></div>
        </div>
        <div v-if="!followupSplit.lep && !followupSplit.sepp && !followupSplit.dcp && followupAnswerHtml" class="answer-body" v-html="followupAnswerHtml"></div>
      </div>

      <!-- Follow-up citations -->
      <div v-if="followupCitations.length > 0" class="sources-section">
        <h2 class="sources-heading">Sources ({{ followupCitations.length }})</h2>
        <div class="sources-list">
          <div v-for="c in followupCitations" :key="c.number" class="source-item">
            <span class="source-num">{{ c.number }}</span>
            <span :class="['source-badge', 'source-badge--' + c.doc_type]">{{ c.doc_type.toUpperCase() }}</span>
            <span class="source-label"><strong>{{ c.document_short }}</strong> {{ c.citation_label }}</span>
            <a v-if="c.clause_url" :href="c.clause_url" target="_blank" rel="noopener" class="source-link">View source</a>
          </div>
        </div>
      </div>
    </div>

    <!-- Feedback + Comment (at the very end) -->
    <div v-if="property && reportQId" class="feedback-section">
      <div class="feedback-row">
        <span class="feedback-label">Was this report helpful?</span>
        <button :class="['feedback-btn', { 'feedback-btn--active': reportFeedback === 'like' }]" @click="sendReportFeedback('like')" :disabled="!!reportFeedback">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>
        </button>
        <button :class="['feedback-btn', { 'feedback-btn--active feedback-btn--dislike': reportFeedback === 'dislike' }]" @click="sendReportFeedback('dislike')" :disabled="!!reportFeedback">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>
        </button>
        <span v-if="reportFeedback" class="feedback-thanks">Thanks for your feedback!</span>
      </div>

      <form class="comment-form" @submit.prevent="submitComment">
        <div class="comment-label">Leave a comment</div>
        <input
          v-model="commentName"
          type="text"
          class="comment-input-sm"
          placeholder="Your name (optional)"
          :disabled="commentSubmitted"
        >
        <textarea
          v-model="commentText"
          class="comment-input"
          placeholder="Share feedback, corrections, or suggestions…"
          rows="2"
          :disabled="commentSubmitted"
        ></textarea>
        <div class="comment-actions">
          <button class="comment-btn" type="submit" :disabled="!commentText.trim() || commentSubmitted">
            {{ commentSubmitted ? 'Submitted' : 'Submit comment' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Disclaimer -->
    <div class="report-disclaimer">
      This report is for testing purposes only. It covers a limited set of NSW planning instruments.
      Always verify with official sources and consult a qualified planner before making decisions.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { haversine, pathLength, ringArea, fmtDistance, fmtArea } from '#shared/geo-measure.mjs'
import { lotSides, ringPerimeter, findRingContaining } from '#shared/lot-edges.mjs'
import { renderMarkdownWithCitations, type Citation } from '~/utils/citation-render'
import { conditionLabel, DEV_TYPE_LABEL, unitLooksWrong } from '#shared/dcp-scope'
import { martinTileBase } from '#shared/martin'
import { DCP_SLUG_BY_LGA } from '#shared/property-columns'
let mapboxgl: any = null

const route = useRoute()
const lat = Number(route.query.lat)
const lng = Number(route.query.lng)
const address = String(route.query.address ?? '')
const persona = String(route.query.persona ?? 'owner')

const PERSONA_LABELS: Record<string, string> = {
  owner: 'Property Owner / Buyer',
  developer: 'Developer / Builder',
  planner: 'Urban Planner',
}
// One audience: the report is always the full planner-level view.
/** Postgres returns these columns as real booleans; earlier code compared them
 *  to the string 'true', so every flag silently read false — pattern book
 *  never rendered and CDC always showed "No". Accept both shapes. */
function isYes(v: unknown): boolean {
  return v === true || v === 'true' || v === 't' || v === 1 || v === '1'
}

/**
 * Deep link to this lot's envelope in the 3D viewer.
 *
 * scripts/build-envelope-model.mjs writes one model per address under
 * models/nsw/<slug>.json and registers it in the viewer index. The link is only
 * offered when that file exists, so a lot nobody has generated yet shows no
 * broken button.
 */
/**
 * Deep link to this lot's envelope in the 3D viewer.
 *
 * /api/property/envelope builds the model on request, so every lot has one.
 * The previous version looked for a pre-generated file and so only ever showed
 * the link for the four addresses someone had run the script over.
 */
const envelopeModel = computed(() => {
  const addr = property.value?.address
  if (!addr) return null
  const api = `/api/property/envelope?address=${encodeURIComponent(addr)}`
  // `label` names the model in the viewer's picker; without it an external model
  // shows up under whichever showcase entry happened to be selected.
  return `/craftbot?model=${encodeURIComponent(api)}&label=${encodeURIComponent(addr)}`
})

const personaLabel = 'Urban Planner'

const loading = ref(true)
const property = ref<any>(null)
const permittedUses = ref<string[]>([])
const answerText = ref('')
const citations = ref<Citation[]>([])

const lots = ref<any[]>([])
const legalCards = ref<any[]>([])

// ── Use-specific controls (planner persona) ────────────────────────────────
type Instrument = 'lep' | 'sepp' | 'dcp'
interface UseStream { text: string; citations: Citation[]; citeIndex: Record<string, number> }
const selectedUse = ref<string>('')
const useAnalysisLoading = ref(false)
const useAnalysisAbort = ref<AbortController | null>(null)
const useStreams = ref<Record<Instrument, UseStream>>({
  lep:  { text: '', citations: [], citeIndex: {} },
  sepp: { text: '', citations: [], citeIndex: {} },
  dcp:  { text: '', citations: [], citeIndex: {} },
})

const reportQId = ref<number | null>(null)
const reportFeedback = ref<string | null>(null)
const commentName = ref('')
const commentText = ref('')
const commentSubmitted = ref(false)
const mapEl = ref<HTMLElement | null>(null)

function submitComment() {
  const c = commentText.value.trim()
  if (!c || commentSubmitted.value) return
  commentSubmitted.value = true
  fetch('/api/track-comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      questionId: reportQId.value,
      name: commentName.value.trim() || null,
      comment: c,
    }),
  }).catch(() => {})
}

function sendReportFeedback(type: 'like' | 'dislike') {
  if (!reportQId.value || reportFeedback.value) return
  reportFeedback.value = type
  fetch('/api/track-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId: reportQId.value, feedback: type }),
  }).catch(() => {})
}

function renderCardAnswer(answer: string, cardCitations: Citation[] = []): string {
  if (!answer) return ''
  const citeIdx: Record<string, number> = {}
  cardCitations.forEach((c: Citation, i: number) => {
    citeIdx[c.section_local_id.toLowerCase()] = c.number || (i + 1)
  })
  return renderMarkdownWithCitations(answer, cardCitations, citeIdx)
}
let mapInstance: mapboxgl.Map | null = null
let mapInitStarted = false
let edgeLabelsDrawn = false

// ── Lot edge / frontage parsing ──────────────────────────────────────────────

/**
 * "14.10m,1.19m,12.14m" -> [{ value: '14.10', unit: 'm' }, …]
 *
 * Split rather than rendered as one string so the digits can be set in
 * tabular figures and the unit demoted — a row of nine chips reading
 * "14.10m 1.19m 12.14m" is a wall of same-weight text where nothing lines up.
 */
const edgeMeasurements = computed(() => {
  const raw = p.value?.all_edges_measurements
  if (!raw) return []
  return String(raw).split(',').map((s: string) => s.trim()).filter(Boolean)
    .map((s: string) => {
      const m = s.match(/^([\d.]+)\s*(.*)$/)
      return m ? { value: m[1]!, unit: m[2] || 'm' } : { value: s, unit: '' }
    })
})

/** "THORNLEIGH:39.67m,WOOD:36.52m" -> [{ road, value, unit }, …] */
const frontageItems = computed(() => {
  const raw = p.value?.all_frontages
  if (!raw) return []
  return String(raw).split(',').map((s: string) => s.trim()).filter(Boolean)
    .map((s: string) => {
      const m = s.match(/^(.*?):\s*([\d.]+)\s*(.*)$/)
      if (!m) return { road: '', value: s, unit: '' }
      return { road: titleCaseRoad(m[1]!), value: m[2]!, unit: m[3] || 'm' }
    })
})

/** Road names arrive shouting ("THORNLEIGH"); sentence case reads better. */
function titleCaseRoad(s: string) {
  return s.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

// ── Boundary side labels ────────────────────────────────────────────────────
//
// The property-report (safebuy.app) treatment: a length pill sits on each
// side of the parcel, so a reader sees which boundary is 36 m without
// mapping a list back onto the drawing. Listing the sides beside the map
// cannot do that — and the raw list is not even the set of sides a person
// would name, because a cadastral ring splits one straight street boundary
// across several vertices.
//
// Geometry comes from the rendered lot tiles, since no exact parcel polygon
// is stored: `geom_1` and `centroid_geom` are empty on every row, and
// `buffered_geom` is an inward buffer (~1 m) whose area runs ~15% under the
// recorded `area_sqm`. Tiles are simplified and clipped at tile edges, so
// the result is checked against the authoritative `perimeter_m` before any
// label is drawn — a wrong number on a boundary is worse than none.

const sideLabelsDrawn = ref(0)
const sideLabelsSkipped = ref<string | null>(null)
let sideMarkers: any[] = []

/** Tolerance on the tile-derived perimeter before we distrust the geometry. */
const PERIMETER_TOLERANCE = 0.05

function clearSideLabels() {
  for (const m of sideMarkers) { try { m.remove() } catch {} }
  sideMarkers = []
  sideLabelsDrawn.value = 0
}

async function renderSideLabels() {
  const map = mapInstance
  if (!map || !p.value?.centroid_lat || !p.value?.centroid_lon) return
  if (!map.getSource(LOT_SRC)) return
  clearSideLabels()

  const centre: [number, number] = [Number(p.value.centroid_lon), Number(p.value.centroid_lat)]
  let feats: any[] = []
  try { feats = map.querySourceFeatures(LOT_SRC, { sourceLayer: LOT_LAYER }) } catch { return }
  const ring = findRingContaining(centre, feats)
  if (!ring) { sideLabelsSkipped.value = 'lot boundary not found in the map tiles'; return }

  // Trust check. A clipped or heavily simplified ring shows up as a
  // perimeter that disagrees with the recorded figure.
  const recorded = Number(p.value.perimeter_m)
  const measured = ringPerimeter(ring)
  if (recorded > 0 && Math.abs(measured - recorded) / recorded > PERIMETER_TOLERANCE) {
    sideLabelsSkipped.value =
      `map outline measures ${measured.toFixed(0)} m against a recorded ${recorded.toFixed(0)} m`
    return
  }
  sideLabelsSkipped.value = null

  const { default: mapboxgl } = await import('mapbox-gl')

  // Inline styles, not classes: markers are injected straight into the map
  // container, outside the tree Vue's scoped CSS is rewritten to match, so
  // a scoped selector would never apply.
  const PILL = [
    'background:#ea580c',
    'color:#fff',
    'font:700 11px system-ui,-apple-system,"Segoe UI",sans-serif',
    'font-variant-numeric:tabular-nums',
    'padding:3px 9px',
    'border-radius:999px',
    'white-space:nowrap',
    'box-shadow:0 2px 6px rgba(15,23,42,0.25)',
    'pointer-events:none',
    'letter-spacing:-0.005em',
  ].join(';')
  const AREA_PILL = [
    'background:#fff',
    'color:#ea580c',
    'border:1.5px solid #ea580c',
    'font:700 13px system-ui,-apple-system,"Segoe UI",sans-serif',
    'font-variant-numeric:tabular-nums',
    'padding:4px 12px',
    'border-radius:999px',
    'white-space:nowrap',
    'box-shadow:0 2px 8px rgba(15,23,42,0.2)',
    'pointer-events:none',
  ].join(';')

  // Longest side first, skipping any whose midpoint lands within 42px of a
  // pill already placed — otherwise short rear boundaries stack into an
  // unreadable clump.
  const MIN_SEP_PX = 42
  const placed: Array<[number, number]> = []
  for (const side of lotSides(ring)) {
    let x = 0, y = 0
    try { const q = map.project(side.mid as any); x = q.x; y = q.y } catch { continue }
    if (placed.some(([px, py]) => Math.hypot(x - px, y - py) < MIN_SEP_PX)) continue
    placed.push([x, y])
    const el = document.createElement('div')
    el.textContent = `${Math.round(side.length)} m`
    el.setAttribute('style', PILL)
    sideMarkers.push(new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(side.mid as any).addTo(map))
  }
  sideLabelsDrawn.value = placed.length

  if (p.value.area_sqm) {
    const el = document.createElement('div')
    el.textContent = `${Math.round(Number(p.value.area_sqm)).toLocaleString()} m²`
    el.setAttribute('style', AREA_PILL)
    sideMarkers.push(new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(centre).addTo(map))
  }
}

// ── Measurement ─────────────────────────────────────────────────────────────
//
// A planning report is read with a ruler in hand — "how far is that boundary
// from the proposed wall?" — so the map carries the same tool as the tile
// catalog, sharing its geodesic maths so the two never disagree.

type MeasureMode = 'distance' | 'area' | null

const measureMode = ref<MeasureMode>(null)
const measurePoints = ref<[number, number][]>([])
const measureHover = ref<[number, number] | null>(null)
const MEASURE_SRC = 'measure'
const MEASURE_LAYERS = ['measure::fill', 'measure::line', 'measure::points']
/** Orange, matching the boundary chips: measurements read as one family. */
const MEASURE_COLOR = '#ea580c'

const measureMinPoints = computed(() => (measureMode.value === 'area' ? 3 : 2))

/** Points plus the cursor, so the run updates as the mouse moves. */
const measureLive = computed<[number, number][]>(() =>
  measureMode.value && measureHover.value
    ? [...measurePoints.value, measureHover.value]
    : measurePoints.value,
)

const measureTotal = computed(() => {
  const pts = measureLive.value
  if (measureMode.value === 'area' || (!measureMode.value && measurePoints.value.length > 2)) {
    return pts.length >= 3 ? fmtArea(ringArea(pts)) : ''
  }
  return pts.length >= 2 ? fmtDistance(pathLength(pts)) : ''
})

const measureSecondary = computed(() => {
  const pts = measureLive.value
  if (pts.length < 2) return ''
  // Area mode also wants the perimeter; distance mode wants the last leg.
  if (measureMode.value === 'area' || (!measureMode.value && pts.length > 2)) {
    return pts.length >= 3 ? `Perimeter ${fmtDistance(pathLength([...pts, pts[0]!]))}` : ''
  }
  return `Last leg ${fmtDistance(haversine(pts[pts.length - 2]!, pts[pts.length - 1]!))}`
})

function ensureMeasureLayers() {
  const map = mapInstance
  if (!map || map.getSource(MEASURE_SRC)) return
  map.addSource(MEASURE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'measure::fill',
    type: 'fill',
    source: MEASURE_SRC,
    filter: ['==', '$type', 'Polygon'],
    paint: { 'fill-color': MEASURE_COLOR, 'fill-opacity': 0.15 },
  })
  map.addLayer({
    id: 'measure::line',
    type: 'line',
    source: MEASURE_SRC,
    filter: ['==', '$type', 'LineString'],
    paint: { 'line-color': MEASURE_COLOR, 'line-width': 2.2, 'line-dasharray': [2, 1] },
  })
  map.addLayer({
    id: 'measure::points',
    type: 'circle',
    source: MEASURE_SRC,
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 4,
      'circle-color': '#ffffff',
      'circle-stroke-color': MEASURE_COLOR,
      'circle-stroke-width': 2,
    },
  })
}

function renderMeasure() {
  const map = mapInstance
  if (!map || !map.getSource(MEASURE_SRC)) return
  const pts = measureLive.value
  const features: any[] = pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }))
  const areaMode = measureMode.value === 'area' || (!measureMode.value && measurePoints.value.length > 2)
  if (pts.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: areaMode ? [...pts, pts[0]!] : pts },
      properties: {},
    })
  }
  if (areaMode && pts.length >= 3) {
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]!]] }, properties: {} })
  }
  ;(map.getSource(MEASURE_SRC) as any).setData({ type: 'FeatureCollection', features })
}

function toggleMeasure(mode: Exclude<MeasureMode, null>) {
  if (measureMode.value === mode) { measureMode.value = null; measureHover.value = null }
  else { measureMode.value = mode; measurePoints.value = []; measureHover.value = null }
  if (mapInstance) mapInstance.getCanvas().style.cursor = measureMode.value ? 'crosshair' : ''
  ensureMeasureLayers()
  renderMeasure()
}

function clearMeasure() {
  measureMode.value = null
  measurePoints.value = []
  measureHover.value = null
  if (mapInstance) mapInstance.getCanvas().style.cursor = ''
  renderMeasure()
}

function onMeasureClick(e: any) {
  if (!measureMode.value) return
  measurePoints.value = [...measurePoints.value, [e.lngLat.lng, e.lngLat.lat]]
  renderMeasure()
}

function onMeasureMove(e: any) {
  if (!measureMode.value || !measurePoints.value.length) return
  measureHover.value = [e.lngLat.lng, e.lngLat.lat]
  renderMeasure()
}

/** Finish, keeping the result on screen. */
function finishMeasure() {
  if (!measureMode.value) return
  measureHover.value = null
  if (measurePoints.value.length >= measureMinPoints.value) measureMode.value = null
  if (mapInstance) mapInstance.getCanvas().style.cursor = ''
  renderMeasure()
}

function onMeasureKey(e: KeyboardEvent) {
  if (e.key === 'Escape') clearMeasure()
  else if (e.key === 'Enter') finishMeasure()
}

onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('keydown', onMeasureKey)
  // Markers live in the map container, not in Vue's tree, so unmounting the
  // page does not take them with it.
  clearSideLabels()
})

// ── Map initialization ──────────────────────────────────────────────────────

async function initMap() {
  if (mapInstance || mapInitStarted || !mapEl.value || !p.value?.centroid_lat || !p.value?.centroid_lon) return
  if (!import.meta.client) return
  // Set before the first await. `mapInstance` alone is not enough of a guard:
  // the dynamic import below yields, so two callers (the property watcher and
  // the section's open handler) both passed the null check, both built a map,
  // and the second one's addSource threw "already a source" — leaving the live
  // map with no cadastre and no tile requests at all.
  mapInitStarted = true

  const config = useRuntimeConfig()
  const token = config.public.mapboxToken as string
  if (!token) return

  if (!mapboxgl) {
    const mod = await import('mapbox-gl')
    mapboxgl = mod.default || mod
    // Load CSS
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css'
    document.head.appendChild(link)
  }

  mapboxgl.accessToken = token

  const lng = Number(p.value.centroid_lon)
  const lat = Number(p.value.centroid_lat)

  mapInstance = new mapboxgl.Map({
    container: mapEl.value,
    style: 'mapbox://styles/mapbox/light-v11',
    center: [lng, lat],
    zoom: 18,
    pitch: 0,
    attributionControl: false,
  })

  mapInstance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

  mapInstance.on('load', () => {
    addLotLayer(lat, lng)
    ensureMeasureLayers()
  })

  // Tiles arrive after 'load', and the pills are positioned by projecting
  // map coordinates to pixels — so they are placed once the view has settled
  // and re-placed after a zoom, when what fits without overlapping changes.
  mapInstance.on('idle', () => { if (!sideMarkers.length) renderSideLabels() })
  mapInstance.on('zoomend', () => renderSideLabels())

  // `dblclick` fires after two `click`s, so the second point is already
  // recorded by the time the run is finished — no point is lost.
  mapInstance.on('click', onMeasureClick)
  mapInstance.on('mousemove', onMeasureMove)
  mapInstance.on('dblclick', (e: any) => {
    if (!measureMode.value) return
    e.preventDefault()
    finishMeasure()
  })
  window.addEventListener('keydown', onMeasureKey)
}

/**
 * The lot layer from the Martin tile server, drawn over the aerial.
 *
 * `lot` is `urbanportaldbp.lot.geometry` - real parcel polygons, the same tile
 * server and the same layer set the map page reads. The whole layer is added
 * rather than one filtered parcel: the surrounding cadastre is what makes a
 * boundary legible, and the map is already centred on the searched address.
 *
 * Not `up_property_d_3`, despite that being the table the report reads its
 * facts from. The tile server publishes that table on its centroid column, so
 * every feature in it is a Point, and fill and line layers over point geometry
 * draw nothing at all and raise no error - the map came back as a bare aerial
 * with no way to tell why.
 */
const LOT_SRC = 'martin:lot'
const LOT_LAYER = 'lot'

/**
 * Tile server base, resolved during setup.
 *
 * Not read inside addLotLayer: that runs from a mapbox-gl 'load' callback where
 * the Nuxt instance is gone and useRuntimeConfig() throws. mapbox-gl swallows
 * exceptions raised in its event handlers, so the only symptom was a map with
 * no lot layer and nothing in the console.
 */
const martinBase = martinTileBase(String((useRuntimeConfig().public as any).martinUrl || ''))

function addLotLayer(lat: number, lng: number) {
  const map = mapInstance!
  if (!map.getSource(LOT_SRC) && martinBase) {
    // Martin's TileJSON advertises its tiles on a host without the port it is
    // served on, and carries no minzoom/maxzoom - without those mapbox-gl
    // requests no tiles at all. Both are supplied here, as on the map page.
    map.addSource(LOT_SRC, {
      type: 'vector',
      tiles: [`${martinBase}/${LOT_LAYER}/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 22,
    })

    map.addLayer({
      id: 'lot-fill',
      type: 'fill',
      source: LOT_SRC,
      'source-layer': LOT_LAYER,
      paint: { 'fill-color': '#15803d', 'fill-opacity': 0.1 },
    })
    map.addLayer({
      id: 'lot-outline',
      type: 'line',
      source: LOT_SRC,
      'source-layer': LOT_LAYER,
      paint: { 'line-color': '#fbbf24', 'line-width': 1.4, 'line-opacity': 0.9 },
    })
    map.addLayer({
      id: 'lot-label',
      type: 'symbol',
      source: LOT_SRC,
      'source-layer': LOT_LAYER,
      minzoom: 17,
      layout: {
        // Strata parcels carry no lotnumber, and concatenating regardless
        // labelled them "/SP99840". Drop the separator when there is no lot.
        'text-field': [
          'case',
          ['all', ['has', 'lotnumber'], ['!=', ['to-string', ['get', 'lotnumber']], '']],
          ['concat', ['to-string', ['get', 'lotnumber']], '/', ['to-string', ['get', 'planlabel']]],
          ['to-string', ['get', 'planlabel']],
        ],
        'text-size': 10,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#fff',
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': 1.2,
      },
    })
  }

  new mapboxgl.Marker({ color: '#15803d', scale: 0.7 })
    .setLngLat([lng, lat])
    .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(
      `<div style="font-family:inherit;font-size:12px;line-height:1.4">
        <strong>${p.value.address || 'Property'}</strong><br/>
        ${p.value.area_h ? Number(p.value.area_h).toFixed(3) + ' ha' : ''}
        ${p.value.zone ? ' \u00b7 Zone ' + p.value.zone : ''}
      </div>`
    ))
    .addTo(map)

  // Side lengths are drawn once the tile holding this lot has arrived.
  // queryRenderedFeatures only sees what is already painted, so this cannot run
  // from the 'load' handler.
  const onData = (ev: any) => {
    if (ev.sourceId !== LOT_SRC || !ev.isSourceLoaded) return
    if (labelEdgesAt(lng, lat)) map.off('sourcedata', onData)
  }
  map.on('sourcedata', onData)
  labelEdgesAt(lng, lat)
}

/**
 * Measure and label the sides of the lot under the address marker.
 *
 * The lot is identified by what is drawn beneath the searched address rather
 * than by matching an id, so the whole `lot` layer stays unfiltered and the
 * surrounding parcels keep their outlines.
 *
 * Lengths are computed from the geometry, not read from the property record.
 * `all_edges_measurements` lists every vertex-to-vertex segment, and a cadastral
 * ring carries runs of sub-metre slivers — this lot has seven consecutive 0.26m
 * entries — which would paper the parcel in labels a planner cannot use. Only
 * segments of 3m or more are labelled.
 *
 * @returns true once the lot has been found and labelled.
 */
/**
 * Shortest boundary worth a label, in metres.
 *
 * A cadastral ring is full of short segments that are not boundaries a planner
 * reads: 9 Bell Street has seven consecutive 0.26m slivers, and 22 Leighton
 * Place a stepped edge of six 3.6m segments that put six identical labels on one
 * side. The panel's chip list still shows every segment.
 */
const MIN_LABEL_M = 5

function labelEdgesAt(lng: number, lat: number): boolean {
  const map = mapInstance
  if (!map || edgeLabelsDrawn) return edgeLabelsDrawn

  let feats: any[] = []
  try {
    feats = map.queryRenderedFeatures(map.project([lng, lat]), { layers: ['lot-fill'] })
  } catch {
    return false
  }
  if (!feats.length) return false

  // Several parcels can sit under one point - a strata lot inside its parent,
  // or a neighbour whose tile-clipped edge crosses the marker. Taking the first
  // hit labelled an 87.6m boundary on a lot whose longest side is 35.1m.
  // The property record's plan decides it; failing that, the smallest parcel
  // under the marker, which is the most specific one.
  const plan = String(p.value?.plan_label ?? '').trim().toUpperCase()
  const byPlan = plan
    ? feats.find(f => String(f.properties?.planlabel ?? '').trim().toUpperCase() === plan)
    : undefined
  const target = byPlan ?? [...feats].sort((a, b) => ringArea(a.geometry) - ringArea(b.geometry))[0]
  if (!target) return false

  // The record's own edge lengths, which sum exactly to perimeter_m.
  const recorded = String(p.value?.all_edges_measurements ?? '')
    .split(',').map(x => parseFloat(x)).filter(n => !Number.isNaN(n) && n >= MIN_LABEL_M)
  const unused = [...recorded]

  const R = 6378137
  const seen = new Set<string>()
  let drawn = 0

  for (const ring of ringsOf(target.geometry)) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i] as [number, number]
      const [x2, y2] = ring[i + 1] as [number, number]
      const dLat = ((y2 - y1) * Math.PI) / 180
      const dLon = ((x2 - x1) * Math.PI) / 180
      const midLat = (((y1 + y2) / 2) * Math.PI) / 180
      const metres = Math.hypot(dLat * R, dLon * R * Math.cos(midLat))
      if (metres < MIN_LABEL_M) continue

      // The geometry fixes where a label goes; the record fixes what it says.
      //
      // Vector tiles quantise to a 4096-unit grid and clip at tile boundaries,
      // so a boundary crossing a tile edge arrives as a fragment: this lot's
      // 95.3m side measured 87.6m off the tile, and two others were out by more
      // than a metre. An edge with no match in the record is left unlabelled
      // rather than labelled with a figure the record contradicts.
      let best = -1
      let bestDiff = Infinity
      for (let k = 0; k < unused.length; k++) {
        const d = Math.abs(unused[k]! - metres)
        if (d < bestDiff) { bestDiff = d; best = k }
      }
      if (best < 0 || bestDiff > 0.75) continue
      const exact = unused.splice(best, 1)[0]!

      const mid: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2]
      const key = `${mid[0].toFixed(6)},${mid[1].toFixed(6)}`
      if (seen.has(key)) continue
      seen.add(key)

      const el = document.createElement('div')
      el.className = 'map-edge-label'
      el.textContent = `${exact.toFixed(1)}m`
      new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(mid)
        .addTo(map)
      drawn++
    }
  }

  if (!drawn) return false
  edgeLabelsDrawn = true
  return true
}

/**
 * Relative size of a feature, for picking the most specific parcel under a
 * point. The shoelace formula on degrees is not an area in any unit, but it
 * orders candidates correctly, which is all this is for.
 */
function ringArea(geom: any): number {
  let total = 0
  for (const ring of ringsOf(geom)) {
    let a = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i] as [number, number]
      const [x2, y2] = ring[i + 1] as [number, number]
      a += x1 * y2 - x2 * y1
    }
    total += Math.abs(a) / 2
  }
  return total
}

/** Every linear ring of a Polygon or MultiPolygon. */
function ringsOf(geom: any): number[][][] {
  if (!geom) return []
  if (geom.type === 'Polygon') return geom.coordinates
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat()
  return []
}


function onMapToggle(e: Event) {
  const details = e.target as HTMLDetailsElement
  if (details.open) {
    nextTick(() => {
      if (!mapInstance) initMap()
      else mapInstance.resize()
    })
  }
}

// Follow-up question state
const followupQuery = ref('')
const followupLoading = ref(false)
const followupAnswerText = ref('')
const followupCitations = ref<Citation[]>([])
const followupCiteIndex = ref<Record<string, number>>({})
const citeIndex = ref<Record<string, number>>({})
const steps = ref<{ agent: string; status: string; message: string }[]>([])

const answerHtml = computed(() => {
  if (!answerText.value) return ''
  return renderMarkdownWithCitations(answerText.value, citations.value, citeIndex.value)
})

// Split the rendered HTML into LEP / SEPP / DCP sections by looking for the h2 headings
const splitSections = computed(() => {
  const html = answerHtml.value
  if (!html) return { lep: '', sepp: '', dcp: '' }

  // The LLM should output ## LEP Findings, ## SEPP Findings, ## DCP Findings
  // which renderMarkdownWithCitations converts to <div class="kg2-h-md">LEP Findings</div>
  // or the heading might come through as raw <h2> if not caught by the citation renderer
  const splitRe = /<(?:h2|div class="kg2-h-md")[^>]*>\s*(?:<[^>]+>)*\s*(LEP|SEPP|DCP)\s+Findings?\s*(?:<[^>]+>)*\s*<\/(?:h2|div)>/gi

  const parts: { type: string; start: number }[] = []
  let m
  while ((m = splitRe.exec(html)) !== null) {
    parts.push({ type: m[1].toLowerCase(), start: m.index + m[0].length })
  }

  if (parts.length === 0) return { lep: '', sepp: '', dcp: '' }

  const result: Record<string, string> = { lep: '', sepp: '', dcp: '' }
  for (let i = 0; i < parts.length; i++) {
    const end = i + 1 < parts.length
      ? html.lastIndexOf('<', parts[i + 1].start - parts[i + 1].type.length - 20)
      : html.length
    result[parts[i].type] = html.slice(parts[i].start, end).trim()
  }

  return result
})

// Shorthand for template
const p = computed(() => property.value || {} as any)

// Init map when property data arrives
watch(() => property.value?.centroid_lat, () => {
  nextTick(() => {
    if (mapEl.value && !mapInstance) initMap()
  })
})

const constraints = computed(() => {
  if (!property.value) return []
  const c: { label: string; severity: string }[] = []
  const v = property.value
  if (v.floodmapping && v.floodmapping !== 'No') c.push({ label: `Flood: ${v.floodmapping}`, severity: 'high' })
  if (v.bushfireproneland && v.bushfireproneland !== 'No') c.push({ label: `Bushfire: ${v.bushfireproneland}`, severity: 'high' })
  if (v.contamination_sitename) c.push({ label: `Contamination: ${v.contamination_sitename}`, severity: 'high' })
  if (v.mine_subsidence_district) c.push({ label: `Mine subsidence: ${v.mine_subsidence_district}`, severity: 'high' })
  if (v.biodiversity) c.push({ label: `Biodiversity: ${v.biodiversity}`, severity: 'medium' })
  if (v.landsliderisk) c.push({ label: `Landslide risk: ${v.landsliderisk}`, severity: 'medium' })
  if (v.coastal_wetlands) c.push({ label: `Coastal wetlands: ${v.coastal_wetlands}`, severity: 'medium' })
  if (v.coastal_environment_area) c.push({ label: `Coastal environment: ${v.coastal_environment_area}`, severity: 'medium' })
  if (v.coastal_use_area) c.push({ label: `Coastal use area: ${v.coastal_use_area}`, severity: 'medium' })
  if (v.riparianlandwatercourse) c.push({ label: `Riparian/watercourse: ${v.riparianlandwatercourse}`, severity: 'medium' })
  if (v.drinking_water_catchment) c.push({ label: `Drinking water catchment: ${v.drinking_water_catchment}`, severity: 'medium' })
  if (v.scenicprotectionland) c.push({ label: `Scenic protection: ${v.scenicprotectionland}`, severity: 'medium' })
  if (v.groundwatervulnerability) c.push({ label: `Groundwater vulnerability: ${v.groundwatervulnerability}`, severity: 'low' })
  if (v.acid_sulfate) c.push({ label: `Acid sulfate soils: ${v.acid_sulfate}`, severity: 'low' })
  return c
})

const cdcPathways = computed(() => {
  if (!property.value) return []
  const v = property.value
  return [
    { key: 'general', label: 'General', eligible: isYes(v.cdc_general), exclusions: v.cdc_general_exclusions },
    { key: 'dwelling', label: 'Dwelling Houses', eligible: isYes(v.cdc_dwelling_houses), exclusions: v.cdc_dwelling_houses_exclusions },
    { key: 'dual', label: 'Dual Occupancy', eligible: isYes(v.cdc_dual_occupancy), exclusions: v.cdc_dual_occupancy_exclusions },
    { key: 'secondary', label: 'Secondary Dwellings', eligible: isYes(v.cdc_secondary_dwellings), exclusions: v.cdc_secondary_dwellings_exclusions },
    { key: 'terraces', label: 'Multi-Dwelling Terraces', eligible: isYes(v.cdc_multi_dwelling_terraces), exclusions: v.cdc_multi_dwelling_terraces_exclusions },
    { key: 'manor', label: 'Manor Homes', eligible: isYes(v.cdc_manor_homes), exclusions: v.cdc_manor_homes_exclusions },
    { key: 'greenfield', label: 'Greenfield Housing', eligible: isYes(v.cdc_greenfield_housing), exclusions: v.cdc_greenfield_housing_exclusions },
    { key: 'rural', label: 'Rural Housing', eligible: isYes(v.cdc_rural_housing), exclusions: v.cdc_rural_housing_exclusions },
    { key: 'agri', label: 'Agritourism', eligible: isYes(v.cdc_agritourism), exclusions: v.cdc_agritourism_exclusions },
    { key: 'farmstay', label: 'Farmstay', eligible: isYes(v.cdc_farmstay), exclusions: v.cdc_farmstay_exclusions },
  ]
})

/**
 * Controls that apply to only part of the lot.
 *
 * The `_p` columns list every value intersecting the parcel, so "RU4, R2" means
 * the lot straddles two zones. The report's headline zone is the primary one,
 * which on a split lot is true of only part of the site.
 */
const additionalControls = computed(() => {
  const v = property.value
  if (!v) return []
  const split = (raw: unknown, primary: unknown, label: string) => {
    if (typeof raw !== 'string' || !raw.includes(',')) return null
    const others = raw.split(',').map(x => x.trim())
      .filter(x => x && String(x) !== String(primary ?? '').trim())
    return others.length ? { label, value: others.join(', ') } : null
  }
  return [
    split(v.lzn_sym_code_p, v.zone, 'Also zoned'),
    split(v.fsr_fsr_p, v.fsr_value, 'Other FSR on lot'),
    split(v.lsz_sym_code_p, null, 'Other min lot size codes'),
  ].filter(Boolean) as { label: string; value: string }[]
})

const siteRules = ref<any[]>([])
const ruleLandUses = ref<string[]>([])

const ruleDevTypes = ref<string[]>([])
const ruleSourceDocs = ref<string[]>([])

const TOPIC_LABEL: Record<string, string> = {
  setback: 'Setback', parking: 'Car parking', landscaping: 'Landscaping',
  open_space: 'Private open space', site_coverage: 'Site coverage', height: 'Height',
  floor_area: 'Floor area', lot_size: 'Lot size', density: 'Density', fsr: 'Floor space ratio',
  width: 'Width', privacy: 'Privacy', solar_access: 'Solar access', deep_soil: 'Deep soil',
}

/** Title case for a land use as the DCP writes it ("dual occupancy"). */
function useLabel(v: string) {
  return String(v || '').replace(/^./, c => c.toUpperCase())
}

/**
 * One row per control, with every value for that control shown together.
 *
 * The DCP bands several controls — landscaping runs 10/15/20/30/40/45/50% —
 * without recording which band applies. Collapsing that to one number would be
 * wrong for most lots, so the range is stated and the clause carries the detail.
 */
/**
 * How each comparator reads.
 *
 * `lt` and `lte` are kept apart deliberately: cl 3.3.4 states both "under 1 m"
 * and "max 12 m", and folding them into one direction merged two unrelated
 * controls into an invented band. A missing comparator maps to nothing — 158
 * DCP effects record no bound, and calling those "min" states one the document
 * never set.
 */
const BOUND_WORD: Record<string, string> = {
  gte: 'min', lte: 'max', gt: 'over', lt: 'under',
}

/**
 * One row per control, where a control is one clause stating one bound.
 *
 * The clause and the direction are part of the key on purpose. Grouping only on
 * topic + unit merged cl 3.3.4 (12 m at 3 storeys), cl 3.4.4 (16.5 m at 5) and
 * cl 3.5.4 (20.5–72 m at 6+) into a single invented band reading
 * "1 / 12 / 16.5 / … / 72 m", attributed to whichever clause happened to sort
 * first. A 72 m height limit in R4 Hornsby is not a rounding error, it is a
 * different building. Direction is in the key for the same reason: cl 3.3.4
 * carries both "< 1 m" and "≤ 12 m" and they are not one control.
 */
function buildRules(source: any[]) {
  const groups = new Map<string, any[]>()
  for (const r of source) {
    const key = [
      r.topic, r.measured_from ?? r.relative_to ?? '', r.unit ?? '',
      r.clause, r.comparator ?? '', conditionLabel(r),
    ].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  return [...groups.entries()].map(([key, rows]) => {
    const r0 = rows[0]
    const unit = r0.unit === 'metre' ? 'm' : r0.unit === 'percent' ? '%'
      : r0.unit === 'sqm' ? 'm²' : r0.unit ? ` ${r0.unit}` : ''
    const where = r0.measured_from || r0.relative_to
      ? ` — ${String(r0.measured_from || r0.relative_to).replace(/_/g, ' ')}` : ''
    // 158 DCP effects carry no comparator. Defaulting those to "min" states a
    // bound the document never set, so an unknown direction says nothing.
    const dir = BOUND_WORD[r0.comparator as string] ?? ''
    const vals = [...new Set(rows.map(x => Number(x.value)))].sort((a, b) => a - b)

    // Several values under one clause and one bound are alternatives inside that
    // clause's table. Stating the span is honest; picking one would not be.
    const body = vals.length === 1
      ? `${vals[0]}${unit}`
      : vals.length <= 3
        ? `${vals.join(' / ')}${unit} — see clause`
        : `${vals[0]}–${vals[vals.length - 1]}${unit} — table, see clause`
    const requirement = dir ? `${dir} ${body}` : body

    const cond = conditionLabel(r0)
    // Both come from the row itself. The document is whichever DCP the rule
    // was ingested from, and the anchor is the id the converter authored —
    // neither can be derived from the property's `dcp_plan_name`, which for
    // Randwick lists several plans at once, nor from the clause number, which
    // restarts in every part of a multi-part DCP.
    const slug = r0.document_slug || dcpDocSlug.value
    const anchor = r0.anchor || (r0.clause ? `dcp.${r0.clause}` : null)
    return {
      key,
      label: (TOPIC_LABEL[r0.topic] || r0.topic) + where,
      requirement,
      condition: cond,
      // Shown, not dropped: the control is in the DCP, but its recorded unit
      // does not match what the topic measures, so it must not be read as-is.
      suspect: unitLooksWrong(r0.topic, r0.unit),
      clause: r0.clause,
      clauseHref: slug && anchor
        ? `/doc-viewer?doc=${slug}&anchor=${encodeURIComponent(anchor)}` : null,
    }
  }).sort((a, b) =>
    a.label.localeCompare(b.label) || String(a.clause).localeCompare(String(b.clause)))
}

/**
 * Controls grouped by what they apply to, not flattened into one table.
 *
 * Widening the query from two land uses to both applicability axes takes an R2
 * lot from 82 numeric effects to several hundred. One table of that length is a
 * dump rather than a report, and worse, it silently mixes controls that bind a
 * dwelling house with controls that bind a subdivision. Each group names its own
 * scope and says which axis put it there.
 *
 * `land_use` groups are the specific ones and come first. A `dev_type` group is
 * a rule that names no land use at all, so it is general to that part of the
 * DCP — true for the lot, but not evidence about any particular use.
 */
const numericRuleGroups = computed(() => {
  const byScope = new Map<string, any[]>()
  for (const r of siteRules.value) {
    const key = `${r.axis}|${r.applies_to}`
    if (!byScope.has(key)) byScope.set(key, [])
    byScope.get(key)!.push(r)
  }

  const groups = [...byScope.entries()].map(([key, rows]) => {
    const axis = rows[0].axis as string
    const appliesTo = String(rows[0].applies_to ?? '')
    return {
      key,
      axis,
      appliesTo,
      label: axis === 'land_use' ? useLabel(appliesTo) : ((DEV_TYPE_LABEL as Record<string, string>)[appliesTo] || appliesTo),
      note: axis === 'land_use'
        ? 'Controls the DCP states for this use.'
        : 'Controls in this part of the DCP that name no specific land use, so they apply to development of this type generally.',
      rules: buildRules(rows),
    }
  })

  // Specific before general, then the better-evidenced group first.
  return groups.sort((a, b) =>
    (a.axis === b.axis ? b.rules.length - a.rules.length : a.axis === 'land_use' ? -1 : 1))
})

const numericRuleCount = computed(() =>
  numericRuleGroups.value.reduce((n, g) => n + g.rules.length, 0))

/**
 * The document these clauses are actually in.
 *
 * Not `dcp_plan_name`: the property record says "Hornsby DCP 2013 - as amended
 * 31 May 2019" while the ingested rule layer is HDCP 2024. Printing the record's
 * name over 2024 clause numbers attributes them to a plan they are not in, which
 * is the kind of error a planner would carry into a submission.
 */
const ruleSourceLabel = computed(() =>
  ruleSourceDocs.value.length ? ruleSourceDocs.value.join(' and ') : 'DCP')

/** True when the record's DCP and the one we hold are different documents. */
const dcpNameMismatch = computed(() => {
  const recorded = String(property.value?.dcp_plan_name || '').trim()
  if (!recorded || !ruleSourceDocs.value.length) return false
  const year = (s: string) => (s.match(/\b(19|20)\d{2}\b/) || [])[0] ?? ''
  return ruleSourceDocs.value.some(d => year(d) && year(recorded) && year(d) !== year(recorded))
})

/** Open the two best-evidenced groups; the rest stay one click away. */
function groupOpen(i: number) { return i < 2 }

/**
 * Fallback slug for the DCP we hold, used only where a row carries no
 * `document_slug` of its own.
 *
 * Keyed on the property's LGA, not on `dcp_plan_name`: that column is a
 * spatial roll-up, so a Randwick lot reads "Randwick DCP 2013 - as amended
 * Apr 2016, Bayside DCP 2022, Waverley DCP 2012…" — several councils' plans,
 * none of them necessarily the one we ingested.
 */
const dcpDocSlug = computed(() => {
  const lga = String(property.value?.lga_name || '').trim().toUpperCase()
  return DCP_SLUG_BY_LGA[lga] ?? null
})

/**
 * The five overlays a planning report is expected to clear explicitly.
 * "No overlay applies" is the finding; silence would be ambiguous.
 */
const specialConstraints = computed(() => {
  const v = property.value
  if (!v) return []
  const rows: [string, unknown][] = [
    ['Acid sulfate soils', v.acid_sulfate],
    ['Biodiversity', v.biodiversity],
    ['Bushfire prone land', v.bushfireproneland],
    ['Flood', v.floodmapping],
    ['Heritage', v.heritage_name || v.heritage_id],
  ]
  return rows.map(([label, val]) => ({
    label,
    applies: !!val && String(val).trim() !== '',
    detail: val && String(val).trim() ? String(val) : `No ${label.toLowerCase()} overlay applies to this property.`,
  }))
})

/**
 * Uses this lot can pursue under a State policy.
 *
 * `sepp_landuses` is the SEPP-permissible list and `sepps` the instruments that
 * grant them. Both were only being handed to the model as prompt context, so
 * they never appeared on the page even though they are recorded per lot.
 */
const seppUses = computed(() => {
  const raw = property.value?.sepp_landuses
  if (typeof raw !== 'string' || !raw.trim()) return []
  return [...new Set(raw.split(/[;,]/).map(x => x.trim()).filter(x => x && x.toLowerCase() !== 'null'))]
    .sort((a, b) => a.localeCompare(b))
})

const seppInstruments = computed(() => {
  const raw = property.value?.sepps
  if (typeof raw !== 'string' || !raw.trim()) return []
  return [...new Set(raw.split(/,(?=\s*State)/).map(x => x.trim()).filter(Boolean))]
})

const PATTERN_BOOK = [
  ['semis_01_anthony_gill', 'Semis — Anthony Gill'],
  ['semis_02_sibling', 'Semis — Sibling'],
  ['manor_homes_01_studio', 'Manor Homes — Studio'],
  ['row_homes_01_saha', 'Row Homes — SAHA'],
  ['terraces_01_carter', 'Terraces — Carter'],
  ['terraces_02_sam_crawford', 'Terraces — Sam Crawford'],
  ['terraces_03_officer_woods', 'Terraces — Officer Woods'],
  ['terraces_04_other', 'Terraces — Other'],
] as const

/**
 * Every pattern the lot was assessed against, eligible or not, each with the
 * reason recorded against it. Previously the list was filtered to eligible
 * patterns unless the lot was in an LMR area, which meant a lot assessed and
 * rejected showed nothing at all — the reason is the interesting part.
 */
const patternBookItems = computed(() => {
  if (!property.value) return []
  const v = property.value
  return PATTERN_BOOK
    .filter(([col]) => v[`${col}_eligible`] !== undefined && v[`${col}_eligible`] !== null)
    .map(([col, label]) => ({
      key: col,
      label,
      eligible: isYes(v[`${col}_eligible`]),
      reasons: v[`${col}_reasons`] || null,
    }))
})


// ── Use-specific controls (planner persona) ─────────────────────────────────

// Render each instrument's streamed markdown as HTML with inline citations.
const useStreamsHtml = computed(() => {
  const out: Record<Instrument, string> = { lep: '', sepp: '', dcp: '' }
  for (const inst of ['lep', 'sepp', 'dcp'] as Instrument[]) {
    const s = useStreams.value[inst]
    out[inst] = s.text ? renderMarkdownWithCitations(s.text, s.citations, s.citeIndex) : ''
  }
  return out
})

// Template reads useStreams[inst].html — expose via a proxy computed.
const useStreamsProxy = computed<Record<Instrument, UseStream & { html: string }>>(() => {
  const out: any = {}
  for (const inst of ['lep', 'sepp', 'dcp'] as Instrument[]) {
    out[inst] = { ...useStreams.value[inst], html: useStreamsHtml.value[inst] }
  }
  return out
})

// Merge citations across all three instruments, renumbering 1..N globally.
const useStreamsCitations = computed<Citation[]>(() => {
  const seen = new Set<number>()
  const merged: Citation[] = []
  for (const inst of ['lep', 'sepp', 'dcp'] as Instrument[]) {
    for (const c of useStreams.value[inst].citations) {
      if (seen.has(c.proposition_id)) continue
      seen.add(c.proposition_id)
      merged.push({ ...c, number: merged.length + 1 })
    }
  }
  return merged
})

function clearSelectedUse() {
  useAnalysisAbort.value?.abort()
  useAnalysisAbort.value = null
  selectedUse.value = ''
  useAnalysisLoading.value = false
  useStreams.value = {
    lep:  { text: '', citations: [], citeIndex: {} },
    sepp: { text: '', citations: [], citeIndex: {} },
    dcp:  { text: '', citations: [], citeIndex: {} },
  }
}

async function selectUse(use: string) {
  if (useAnalysisLoading.value) return
  if (selectedUse.value === use) { clearSelectedUse(); return }
  clearSelectedUse()
  selectedUse.value = use
  useAnalysisLoading.value = true

  const ac = new AbortController()
  useAnalysisAbort.value = ac

  try {
    const resp = await fetch('/api/use-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property: property.value, use }),
      signal: ac.signal,
    })
    if (!resp.ok || !resp.body) {
      useAnalysisLoading.value = false
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    // Held across reads, not per chunk: a large event puts its `event:` line and
    // its `data:` line in different chunks, and resetting per chunk dropped the
    // event with no error at all.
    let eventType = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim()
        else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6))
            handleUseSSE(eventType, data)
          } catch {}
          eventType = ''
        }
      }
    }
  } catch {
    // aborted or network error — fall through
  } finally {
    useAnalysisLoading.value = false
    useAnalysisAbort.value = null
  }
}

function handleUseSSE(type: string, data: any) {
  // Event names are tagged: lep_answer_chunk, sepp_citations, dcp_done, etc.
  // Plus shared: agent_step, use_selected, done, error.
  const m = /^(lep|sepp|dcp)_(.+)$/.exec(type)
  if (m) {
    const inst = m[1] as Instrument
    const sub = m[2]
    if (sub === 'answer_chunk') {
      useStreams.value[inst].text += data.text
    } else if (sub === 'citations') {
      useStreams.value[inst].citations = data.citations || []
      useStreams.value[inst].citeIndex = data.cite_index || {}
    }
    return
  }
  if (type === 'agent_step') {
    const existing = steps.value.findIndex(s => s.agent === data.agent)
    const step = { agent: data.agent, status: data.status, message: data.message }
    if (existing >= 0) steps.value[existing] = step
    else steps.value.push(step)
  }
}

// ── Follow-up question ───────────────────────────────────────────────────────

const followupAnswerHtml = computed(() => {
  if (!followupAnswerText.value) return ''
  return renderMarkdownWithCitations(followupAnswerText.value, followupCitations.value, followupCiteIndex.value)
})

const followupSplit = computed(() => {
  const html = followupAnswerHtml.value
  if (!html) return { lep: '', sepp: '', dcp: '' }
  const splitRe = /<(?:h2|div class="kg2-h-md")[^>]*>\s*(?:<[^>]+>)*\s*(LEP|SEPP|DCP)\s+Findings?\s*(?:<[^>]+>)*\s*<\/(?:h2|div)>/gi
  const parts: { type: string; start: number }[] = []
  let m
  while ((m = splitRe.exec(html)) !== null) {
    parts.push({ type: m[1].toLowerCase(), start: m.index + m[0].length })
  }
  if (parts.length === 0) return { lep: '', sepp: '', dcp: '' }
  const result: Record<string, string> = { lep: '', sepp: '', dcp: '' }
  for (let i = 0; i < parts.length; i++) {
    const end = i + 1 < parts.length
      ? html.lastIndexOf('<', parts[i + 1].start - parts[i + 1].type.length - 20)
      : html.length
    result[parts[i].type] = html.slice(parts[i].start, end).trim()
  }
  return result
})

function autoResizeFollowup(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

async function submitFollowup() {
  const q = followupQuery.value.trim()
  if (!q || followupLoading.value || !property.value) return

  followupLoading.value = true
  followupAnswerText.value = ''
  followupCitations.value = []
  followupCiteIndex.value = {}

  // Track follow-up — get ID for answer save
  let followupQId: number | null = null
  const followupT0 = Date.now()
  fetch('/api/track-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, persona, address, lat, lng, page: '/report/followup' }),
  }).then(r => r.json()).then(d => { followupQId = d.id }).catch(() => {})

  try {
    const resp = await fetch('/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q,
        property: property.value,
        permittedUses: permittedUses.value,
        previousAnswer: answerText.value,
      }),
    })

    if (!resp.ok || !resp.body) {
      followupAnswerText.value = `Error: HTTP ${resp.status}`
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Held across reads, not per chunk: a large event puts its `event:` line and
    // its `data:` line in different chunks, and resetting per chunk dropped the
    // event with no error at all.
    let eventType = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim()
        else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6))
            if (eventType === 'answer_chunk') followupAnswerText.value += data.text
            else if (eventType === 'citations') {
              followupCitations.value = data.citations || []
              followupCiteIndex.value = data.cite_index || {}
            }
          } catch {}
          eventType = ''
        }
      }
    }
  } catch (err) {
    followupAnswerText.value = `Error: ${(err as Error).message}`
  } finally {
    followupLoading.value = false
    if (followupQId && followupAnswerText.value) {
      fetch('/api/track-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: followupQId,
          answer: followupAnswerText.value,
          citations: followupCitations.value,
          durationMs: Date.now() - followupT0,
        }),
      }).catch(() => {})
    }
  }
}

// ── Stream the report ────────────────────────────────────────────────────────

onMounted(async () => {
  if (!lat || !lng) return

  // Track — get ID for answer/feedback save
  reportQId.value = null
  reportFeedback.value = null
  const reportT0 = Date.now()
  fetch('/api/track-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `Property report: ${address}`, persona, address, lat, lng, page: '/report' }),
  }).then(r => r.json()).then(d => { reportQId.value = d.id }).catch(() => {})

  try {
    const resp = await fetch('/api/property-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, address, persona }),
    })

    if (!resp.ok || !resp.body) {
      answerText.value = `Error: HTTP ${resp.status}`
      loading.value = false
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Held across reads, not per chunk: a large event puts its `event:` line and
    // its `data:` line in different chunks, and resetting per chunk dropped the
    // event with no error at all.
    let eventType = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6))
            handleSSE(eventType, data)
          } catch {}
          eventType = ''
        }
      }
    }
  } catch (err) {
    answerText.value = `Error: ${(err as Error).message}`
  } finally {
    loading.value = false
    if (reportQId.value && answerText.value) {
      fetch('/api/track-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: reportQId.value,
          answer: answerText.value,
          citations: citations.value,
          durationMs: Date.now() - reportT0,
        }),
      }).catch(() => {})
    }
  }
})

function handleSSE(type: string, data: any) {
  switch (type) {
    case 'agent_step': {
      const existing = steps.value.findIndex(s => s.agent === data.agent)
      const step = { agent: data.agent, status: data.status, message: data.message }
      if (existing >= 0) steps.value[existing] = step
      else steps.value.push(step)
      break
    }
    case 'site_rules':
      siteRules.value = data.rules || []
      ruleLandUses.value = data.land_uses || []
      ruleDevTypes.value = data.dev_types || []
      ruleSourceDocs.value = data.source_documents || []
      break
    case 'property':
      property.value = data.property
      break
    case 'lots':
      lots.value = data.lots || []
      break
    case 'permissibility':
      permittedUses.value = data.uses || []
      break
    case 'answer_chunk':
      answerText.value += data.text
      break
    case 'citations':
      citations.value = data.citations || []
      citeIndex.value = data.cite_index || {}
      break
    case 'legal_cards_init':
      // Create placeholder slots for all cards
      legalCards.value = (data.slots || []).map((s: any) => ({
        ...s, answer: '', citations: [], error: null,
      }))
      break
    case 'legal_card': {
      // Update the matching card with its answer
      const idx = legalCards.value.findIndex((c: any) => c.id === data.id)
      if (idx >= 0) {
        legalCards.value[idx] = { ...legalCards.value[idx], answer: data.answer, citations: data.citations || [], error: data.error }
      } else {
        legalCards.value.push({ id: data.id, title: data.id, icon: '📋', description: '', answer: data.answer, citations: data.citations || [], error: data.error })
      }
      break
    }
    case 'error':
      answerText.value += `\n\n**Error:** ${data.message}`
      break
  }
}
</script>

<style>
.report-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Figtree", "Segoe UI", system-ui, sans-serif;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.report-header { margin-bottom: 1.5rem; }
.back-link { font-size: 0.8rem; color: #64748b; text-decoration: none; }
.back-link:hover { color: #15803d; }
.report-title { font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0.5rem 0 0.25rem; }
.report-subtitle { font-size: 0.88rem; color: #64748b; margin: 0; }

/* ── Facts card ─────────────────────────────────────────────────────────── */
.facts-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}
.facts-heading {
  font-size: 0.8rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.75rem;
}

.facts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.6rem;
}
.fact {
  display: flex; flex-direction: column; gap: 0.1rem;
}
.fact-label {
  font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: #94a3b8;
}
.fact-value {
  font-size: 0.88rem; color: #1e293b; font-weight: 500;
}
.fact-value--zone {
  font-weight: 700; color: #15803d;
}
.fact-value--num {
  font-weight: 700; color: #0f172a;
}
.fact-sub {
  font-weight: 400; color: #64748b; font-size: 0.78rem;
  margin-left: 0.3rem;
}

/* ── Constraints ────────────────────────────────────────────────────────── */
.constraints { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #f1f5f9; }
.constraints-heading {
  font-size: 0.72rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 0.4rem;
}
.constraint-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.constraint-chip {
  font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 500;
}
.constraint-chip--high { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.constraint-chip--medium { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
.constraint-chip--low { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

/* ── Permitted uses ─────────────────────────────────────────────────────── */
.uses-hint {
  padding: 0 1rem; font-size: 0.72rem; color: #64748b; margin: 0 0 0.4rem;
}
.uses-list {
  padding: 0 1rem 0.75rem; display: flex; flex-wrap: wrap; gap: 0.3rem;
}
.use-chip {
  font-size: 0.72rem; padding: 0.25rem 0.55rem; border-radius: 10px;
  background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;
  font-family: inherit; cursor: default;
}
.use-chip--clickable { cursor: pointer; transition: background 0.12s, border-color 0.12s, transform 0.12s; }
.use-chip--clickable:hover:not(:disabled) { background: #dcfce7; border-color: #86efac; }
.use-chip--clickable:disabled { opacity: 0.6; cursor: default; }
.use-chip--active { background: #15803d; color: #fff; border-color: #15803d; }

/* ── Use-specific controls panel ───────────────────────────────────────── */
.use-analysis {
  margin: 0.5rem 1rem 1rem; padding: 0.9rem;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
}
.use-analysis-header {
  display: flex; align-items: center; gap: 0.5rem;
  padding-bottom: 0.6rem; margin-bottom: 0.6rem; border-bottom: 1px solid #f1f5f9;
}
.use-analysis-label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.use-analysis-use { font-size: 0.95rem; font-weight: 700; color: #0f172a; }
.use-analysis-loading { margin-left: auto; font-size: 0.72rem; color: #3b82f6; font-style: italic; }
.use-analysis-close {
  margin-left: auto; font-size: 0.72rem; color: #64748b;
  background: transparent; border: 1px solid #e2e8f0; border-radius: 6px;
  padding: 0.2rem 0.55rem; cursor: pointer;
}
.use-analysis-close:hover { background: #f8fafc; color: #0f172a; }

/* ── Steps ──────────────────────────────────────────────────────────────── */
.steps-panel {
  margin-bottom: 1rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;
}
.steps-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.8rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}
.steps-running {
  font-size: 0.7rem;
  font-weight: 500;
  color: #3b82f6;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.steps-running::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
  animation: steps-pulse 1.2s ease-in-out infinite;
}
@keyframes steps-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.steps-done {
  font-size: 0.7rem;
  font-weight: 500;
  color: #15803d;
}
.steps-list { padding: 0 0.8rem 0.5rem; display: flex; flex-direction: column; gap: 0.25rem; }
.step-item { display: flex; align-items: baseline; gap: 0.4rem; font-size: 0.75rem; }
.step-item--running .step-agent { color: #3b82f6; }
.step-item--done .step-agent { color: #15803d; }
.step-item--warn .step-agent { color: #b45309; }
.step-agent { font-weight: 600; color: #334155; }
.step-msg { color: #64748b; }

/* ── Answer ─────────────────────────────────────────────────────────────── */
.answer-section { margin-bottom: 1.5rem; }
.answer-heading {
  font-size: 0.8rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.75rem;
}
.answer-body { font-size: 0.92rem; line-height: 1.75; color: #1e293b; }
.answer-body p { margin: 0.5rem 0; }
.answer-body ul { padding-left: 1.2rem; margin: 0.5rem 0; }
.answer-body li { margin: 0.2rem 0; }
.answer-body strong { color: #0f172a; }
.answer-loading { color: #94a3b8; font-size: 0.85rem; font-style: italic; }

/* ── Instrument sections (LEP / SEPP / DCP) ───────────────────────────── */
.instrument-section {
  border-radius: 10px;
  padding: 1rem 1.25rem;
  margin-bottom: 0.75rem;
}
.instrument-section--lep { background: #eff6ff; border: 1px solid #bfdbfe; }
.instrument-section--sepp { background: #fffbeb; border: 1px solid #fde68a; }
.instrument-section--dcp { background: #f0fdf4; border: 1px solid #bbf7d0; }

.instrument-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  font-weight: 700;
  margin-bottom: 0.6rem;
}
.instrument-section--lep .instrument-header { color: #1d4ed8; }
.instrument-section--sepp .instrument-header { color: #b45309; }
.instrument-section--dcp .instrument-header { color: #15803d; }

.instrument-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  letter-spacing: 0.03em;
}
.instrument-badge--lep { background: #dbeafe; color: #1d4ed8; }
.instrument-badge--sepp { background: #fef3c7; color: #b45309; }
.instrument-badge--dcp { background: #dcfce7; color: #15803d; }

/* ── Citation chips ─────────────────────────────────────────────────────── */
.kg2-cite-num {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 1.1em; height: 1.1em; padding: 0 0.25em; border-radius: 3px;
  font-size: 0.7em; font-weight: 700; vertical-align: super;
  text-decoration: none; cursor: default; margin: 0 1px;
}
.kg2-cite-num--lep { background: #dbeafe; color: #1d4ed8; }
.kg2-cite-num--sepp { background: #fef3c7; color: #b45309; }
.kg2-cite-num--dcp { background: #dcfce7; color: #15803d; }
.kg2-cite-num--unknown { background: #f1f5f9; color: #94a3b8; }
a.kg2-cite-num { cursor: pointer; }
a.kg2-cite-num:hover { filter: brightness(0.9); }
.kg2-h-sm {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; color: #64748b; margin: 1rem 0 0.25rem;
}
.kg2-h-md { font-size: 0.88rem; font-weight: 700; color: #1e293b; margin: 1rem 0 0.25rem; }

/* ── Sources ────────────────────────────────────────────────────────────── */
.sources-section { border-top: 1px solid #e2e8f0; padding-top: 1rem; margin-bottom: 1.5rem; }
.sources-heading {
  font-size: 0.8rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.75rem;
}
.sources-list { display: flex; flex-direction: column; gap: 0.75rem; }
.source-item {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem;
  font-size: 0.82rem; padding: 0.5rem 0.7rem;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
}
.source-num {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 1.4em; height: 1.4em; background: #e2e8f0; border-radius: 3px;
  font-size: 0.7rem; font-weight: 700; color: #475569;
}
.source-badge {
  font-size: 0.6rem; font-weight: 700; padding: 0.1rem 0.35rem;
  border-radius: 3px; letter-spacing: 0.03em;
}
.source-badge--lep { background: #dbeafe; color: #1d4ed8; }
.source-badge--sepp { background: #fef3c7; color: #b45309; }
.source-badge--dcp { background: #dcfce7; color: #15803d; }
.source-label { color: #334155; }
.source-link { font-size: 0.72rem; color: #15803d; text-decoration: none; margin-left: auto; }
.source-link:hover { text-decoration: underline; }
.source-quote {
  width: 100%; margin: 0.3rem 0 0; font-size: 0.78rem; color: #64748b;
  font-style: italic; line-height: 1.5; border-left: 2px solid #e2e8f0; padding-left: 0.5rem;
}

/* ── Lot map & dimensions ─────────────────────────────────────────────── */
.lot-map-layout {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: 1rem;
  padding: 0 1rem 0.5rem;
}
@media (max-width: 640px) {
  .lot-map-layout { grid-template-columns: 1fr; }
}

.lot-map-container {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  min-height: 520px;
}

/* Measure tool, floated over the map. */
.lot-measure-control {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 2;
  display: flex;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgb(15 23 42 / 0.12);
}
.lot-measure-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0.35rem 0.6rem;
  font-family: inherit;
  font-size: 0.7rem;
  color: #64748b;
}
.lot-measure-btn + .lot-measure-btn { border-left: 1px solid #e2e8f0; }
.lot-measure-btn:hover { background: #f8fafc; }
.lot-measure-btn--on { background: #fff7ed; color: #ea580c; font-weight: 600; }
.lot-measure-btn--clear { color: #94a3b8; }
.lot-measure-btn--clear:hover { color: #ea580c; }

.lot-measure-readout {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 2;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  box-shadow: 0 1px 3px rgb(15 23 42 / 0.12);
  max-width: 15rem;
}
.lot-measure-value {
  font-size: 1rem;
  font-weight: 800;
  color: #ea580c;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.lot-measure-secondary {
  font-size: 0.68rem;
  color: #64748b;
  margin-top: 0.1rem;
  font-variant-numeric: tabular-nums;
}
.lot-measure-hint { font-size: 0.64rem; color: #94a3b8; margin-top: 0.2rem; }
.lot-map {
  width: 100%;
  height: 520px;
}

.lot-dims {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.lot-dims-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.3rem;
}
.dim {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}
.dim-label {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}
.dim-value {
  font-size: 0.85rem;
  font-weight: 700;
  color: #0f172a;
}

.edge-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.edge-heading {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}
.edge-items {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
/* Measurements are numbers first. Tabular figures so the digits line up
   down a wrapped row, the unit demoted so nine chips do not read as nine
   equally-weighted words, and a muted ordinal so a side can be referred to
   ("side 4") without counting along the row. */
.edge-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.28rem;
  padding: 0.22rem 0.5rem;
  border-radius: 5px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  line-height: 1.35;
}
.edge-n {
  font-size: 0.58rem;
  font-weight: 700;
  color: #fb923c;
  font-variant-numeric: tabular-nums;
  min-width: 0.75rem;
  text-align: right;
}
.edge-num {
  font-size: 0.8rem;
  font-weight: 650;
  color: #c2410c;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.edge-unit {
  font-size: 0.62rem;
  font-weight: 500;
  color: #fb923c;
  margin-left: -0.16rem;
}
.edge-chip--frontage {
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.edge-chip--frontage .edge-num { color: #15803d; }
.edge-chip--frontage .edge-unit { color: #4ade80; }
.edge-road {
  font-size: 0.6rem;
  font-weight: 700;
  color: #16a34a;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.edge-count {
  font-size: 0.58rem;
  font-weight: 500;
  color: #cbd5e1;
  text-transform: none;
  letter-spacing: 0;
  margin-left: 0.35rem;
}
.edge-empty {
  margin: 0;
  font-size: 0.68rem;
  color: #94a3b8;
  font-style: italic;
}
.edge-onmap {
  margin: 0;
  font-size: 0.68rem;
  color: #ea580c;
}
.edge-note {
  margin: 0.25rem 0 0;
  font-size: 0.62rem;
  color: #94a3b8;
}

.lot-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.lot-flag {
  font-size: 0.68rem;
  font-weight: 500;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
}
.lot-flag--green { background: #dcfce7; color: #15803d; }
.lot-flag--amber { background: #fef3c7; color: #b45309; }

/* Map edge labels */
:global(.map-edge-label) {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(21, 128, 61, 0.4);
  color: #15803d;
  font-size: 11px;
  font-weight: 700;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

/* ── Lots table ───────────────────────────────────────────────────────── */
.lots-section {
  margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #f1f5f9;
}
.lots-heading {
  font-size: 0.72rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 0.4rem;
}
.lots-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.lot-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.78rem;
}
.lot-id {
  font-weight: 600;
  color: #1e293b;
}
.lot-area {
  color: #64748b;
  font-size: 0.72rem;
}

/* ── Report sections (collapsible) ─────────────────────────────────────── */
.rpt-section {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 0.75rem;
  overflow: hidden;
}
.rpt-section[open] {
  padding-bottom: 0.75rem;
}
.rpt-section-title {
  padding: 0.7rem 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  user-select: none;
}
.rpt-section-title:hover { background: #f8fafc; }
.rpt-section > .facts-grid,
.rpt-section > .constraint-chips,
.rpt-section > .uses-list,
.rpt-section > .cdc-summary,
.rpt-section > .cdc-grid,
.rpt-section > .lmr-badge {
  padding: 0 1rem;
}

/* ── CDC eligibility ──────────────────────────────────────────────────── */
.cdc-summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}
.cdc-badge {
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.3rem 0.7rem;
  border-radius: 6px;
}
.cdc-badge--yes { background: #dcfce7; color: #15803d; }
.cdc-badge--no { background: #fef2f2; color: #b91c1c; }
.cdc-count { font-size: 0.75rem; color: #64748b; }

.cdc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.35rem;
}
.cdc-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: #475569;
}
.cdc-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.cdc-dot--yes { background: #15803d; }
.cdc-dot--no { background: #d1d5db; }
.cdc-name { font-weight: 500; }
.cdc-excl { font-size: 0.68rem; color: #94a3b8; margin-left: auto; }

/* ── LMR badge ────────────────────────────────────────────────────────── */
.lmr-badge {
  display: inline-block;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.6rem;
  border-radius: 5px;
  margin-bottom: 0.5rem;
}

/* ── Feedback ─────────────────────────────────────────────────────────── */
.feedback-row {
  display: flex; align-items: center; gap: 0.5rem; margin: 1rem 0; padding: 0.6rem 0;
}
.feedback-label { font-size: 0.78rem; color: #94a3b8; }
.feedback-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: 1px solid #e2e8f0; border-radius: 6px;
  background: #fff; color: #94a3b8; cursor: pointer; transition: all 0.12s;
}
.feedback-btn:hover:not(:disabled) { border-color: #15803d; color: #15803d; background: #f0fdf4; }
.feedback-btn--active { border-color: #15803d; color: #15803d; background: #dcfce7; }
.feedback-btn--dislike.feedback-btn--active { border-color: #b91c1c; color: #b91c1c; background: #fef2f2; }
.feedback-btn:disabled { cursor: default; opacity: 0.6; }
.feedback-thanks { font-size: 0.72rem; color: #15803d; font-weight: 500; }

.feedback-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.75rem 1rem;
  margin: 1rem 0;
}
.feedback-section .feedback-row { margin: 0 0 0.5rem; padding: 0; }

.comment-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e2e8f0;
}
.comment-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}
.comment-input-sm, .comment-input {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.82rem;
  font-family: inherit;
  outline: none;
  background: #fff;
  color: #0f172a;
  transition: border-color 0.15s;
}
.comment-input { resize: vertical; min-height: 56px; }
.comment-input-sm:focus, .comment-input:focus { border-color: #15803d; }
.comment-input-sm:disabled, .comment-input:disabled { background: #f1f5f9; color: #64748b; }

.comment-actions { display: flex; justify-content: flex-end; }
.comment-btn {
  padding: 0.35rem 0.9rem;
  background: #0f172a;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.comment-btn:hover:not(:disabled) { background: #1e293b; }
.comment-btn:disabled { background: #cbd5e1; cursor: not-allowed; }

/* ── Legal cards ──────────────────────────────────────────────────────── */
.legal-cards-section {
  margin-bottom: 1.5rem;
}

.legal-cards-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.legal-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.legal-card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}


.legal-card-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: #0f172a;
}

.legal-card-desc {
  font-size: 0.7rem;
  color: #94a3b8;
}

.legal-card-body {
  font-size: 0.82rem;
  line-height: 1.6;
  color: #334155;
  max-height: 200px;
  overflow-y: auto;
}
.legal-card-body p { margin: 0.3rem 0; }
.legal-card-body ul { padding-left: 1rem; margin: 0.3rem 0; }
.legal-card-body li { margin: 0.15rem 0; }
.legal-card-body strong { color: #0f172a; }

.legal-card-loading {
  font-size: 0.78rem;
  color: #94a3b8;
  font-style: italic;
}

.legal-card-error {
  font-size: 0.78rem;
  color: #b91c1c;
}

/* ── Follow-up question ───────────────────────────────────────────────── */
.followup-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 2px solid #e2e8f0;
}
.followup-heading {
  font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0 0 0.75rem;
}
.followup-form { margin-bottom: 1rem; }
.followup-search-card {
  display: flex; align-items: flex-end; gap: 12px;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px;
  padding: 16px 16px 12px 20px;
  box-shadow: 0 1px 3px rgba(15,23,42,0.04);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.followup-search-card:focus-within {
  border-color: #15803d;
  box-shadow: 0 1px 3px rgba(21,128,61,0.08), 0 6px 20px rgba(21,128,61,0.1);
}
.followup-input {
  flex: 1; min-height: 40px; max-height: 200px;
  background: transparent; border: none; outline: none; resize: none;
  font-size: 0.92rem; line-height: 1.5; color: #0f172a; font-family: inherit;
}
.followup-input::placeholder { color: #94a3b8; }
.followup-send {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 10px;
  border: none; background: #15803d; color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.followup-send:hover:not(:disabled) { background: #166534; }
.followup-send:disabled { background: #cbd5e1; cursor: not-allowed; }
.followup-answer { margin-top: 0.75rem; }

.spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Disclaimer ─────────────────────────────────────────────────────────── */
.report-disclaimer {
  background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px;
  padding: 0.75rem 1rem; font-size: 0.78rem; color: #92400e; line-height: 1.5;
  margin-top: 2rem;
}
/* ── Building envelope link ─────────────────────────────────────────────── */
.envelope-blurb { font-size: 0.82rem; color: #64748b; margin: 0 0 0.6rem; }
.envelope-link {
  display: inline-block; padding: 0.45rem 0.8rem; border-radius: 8px;
  background: #15803d; color: #fff; font-size: 0.85rem; font-weight: 600;
  text-decoration: none;
}
.envelope-link:hover { background: #166534; }

/* ── Key numerical rules + constraints ──────────────────────────────────── */
.rules-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 0.4rem; }
.rules-table th {
  text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: #94a3b8; padding: 0.3rem 0.5rem 0.3rem 0; border-bottom: 1px solid #e2e8f0;
}
.rules-table td { padding: 0.35rem 0.5rem 0.35rem 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }

/* ── Numeric rules, grouped by what they apply to ─────────────────────────── */
.rules-group {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin: 10px 0;
  background: #fff;
}
.rules-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
  list-style: none;
}
.rules-group-title::-webkit-details-marker { display: none; }
.rules-group-title::before {
  content: 'b8';
  color: #94a3b8;
  transition: transform 0.15s;
}
.rules-group[open] > .rules-group-title::before { transform: rotate(90deg); }
.rules-axis {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
}
.rules-axis-land_use { background: #dcfce7; color: #166534; }
.rules-axis-dev_type { background: #f1f5f9; color: #64748b; }
.rules-count {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
}
.rules-group-note {
  margin: 0 12px 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}
.rules-group .rules-table { margin: 0 0 4px; }
.rules-cond { color: #64748b; font-size: 12px; white-space: nowrap; }
.rules-mismatch {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-left: 3px solid #f59e0b;
  background: #fffbeb;
  color: #92400e;
  font-size: 12px;
  line-height: 1.5;
}
.rules-suspect {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #fef3c7;
  color: #b45309;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: help;
}

.rules-cite { color: #15803d; text-decoration: none; white-space: nowrap; }
.rules-cite:hover { text-decoration: underline; }

.constraint-list { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.4rem; }
.constraint-row { display: grid; grid-template-columns: 12px 10rem 1fr; gap: 0.5rem; align-items: baseline; }
.constraint-name { font-size: 0.82rem; font-weight: 600; color: #1e293b; }
.constraint-detail { font-size: 0.8rem; color: #64748b; }

</style>
