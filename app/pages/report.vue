<template>
  <div class="report-page">

    <!-- Header -->
    <div class="report-header">
      <NuxtLink to="/" class="back-link">&larr; Home</NuxtLink>
      <h1 class="report-title">Property Report</h1>
      <p class="report-subtitle">{{ personaLabel }} · {{ address || 'Loading…' }}</p>

      <!-- What the report is about. Without this every figure below is a ratio
           the reader has to apply themselves, and the DCP tables lead with
           whichever use happens to carry the most rules rather than the one
           being asked about. -->
      <div v-if="property" class="scope-bar">
        <label class="scope-label" for="proposed-use">Report is written about a proposed</label>
        <select id="proposed-use" class="scope-select" :value="proposedUse" @change="onUseChange">
          <option v-for="u in useOptions" :key="u" :value="u">{{ u }}</option>
        </select>
        <span class="scope-note">on this lot. Complying development is not assessed here.</span>
      </div>
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
        <!-- The title reference as the cadastre spells it, which is what the
             SIX Maps lookup behind the 3D envelope queries on. -->
        <div class="fact" v-if="p.lot_section_plan"><span class="fact-label">Title reference</span><span class="fact-value">{{ p.lot_section_plan }}</span></div>
        <!-- On a strata plan lot_section_plan is only "//SP79598"; this is the
             one column that says which lots that plan actually contains. -->
        <div class="fact fact--wide" v-if="p.property_description"><span class="fact-label">Property description</span><span class="fact-value">{{ p.property_description }}</span></div>
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
      <!-- The arithmetic, done. A floor space ratio is not what anyone builds
           to; the gross floor area it permits on this lot is. -->
      <div v-if="derived.maxGrossFloorArea || derived.heightM || derived.dcpFloorAreaCaps?.length" class="derived-row">
        <div v-if="derived.maxGrossFloorArea" class="derived">
          <span class="derived-num">{{ derived.maxGrossFloorArea.toLocaleString() }} m²</span>
          <span class="derived-label">
            maximum gross floor area &mdash; {{ derived.fsr }}:1 on {{ derived.areaSqm?.toLocaleString() }} m²
          </span>
        </div>

        <!-- No FSR mapped does not mean floor area is uncontrolled: the DCP caps
             it by lot size band. A single figure is a cap; more than one is a
             clause to read, because the ingest splits "25% of the lot area +
             300m²" into two rows and the smaller of them is not the answer. -->
        <div v-else-if="derived.dcpFloorAreaCap" class="derived">
          <span class="derived-num">{{ derived.dcpFloorAreaCap.toLocaleString() }} m²</span>
          <span class="derived-label">
            maximum floor area for a {{ derived.proposedUse }} &mdash;
            {{ derived.dcpFloorAreaCaps[0].stated }},
            <a :href="dcpClauseHref(derived.dcpFloorAreaCaps[0].clause)" class="rules-cite">cl {{ derived.dcpFloorAreaCaps[0].clause }}</a>.
            No FSR is mapped.
          </span>
        </div>
        <!-- Several figures and no recorded relation between them. Joining
             them into one headline number would invent a maximum: Hornsby's
             table reads "25% of the lot area + 300m²" for a dual occupancy and
             "430m²" for a dwelling house, and the ingest flattened both into
             the same list. So the clause leads, and the figures are named
             underneath as what the clause says rather than as an answer. -->
        <div v-else-if="derived.dcpFloorAreaCaps?.length" class="derived">
          <span class="derived-num derived-num--sm">
            <a :href="dcpClauseHref(derived.dcpFloorAreaCaps[0].clause)" class="rules-cite">cl {{ derived.dcpFloorAreaCaps[0].clause }}</a>
          </span>
          <span class="derived-label">
            caps floor area for a {{ derived.proposedUse }} &mdash; no FSR is mapped.
            It states
            <template v-for="(c, i) in derived.dcpFloorAreaCaps" :key="c.clause + i"
              ><template v-if="i">{{ i === derived.dcpFloorAreaCaps.length - 1 ? ' and ' : ', ' }}</template
              ><strong>{{ c.stated }}</strong><template v-if="c.stated.indexOf('%') !== -1"> ({{ c.sqm.toLocaleString() }} m² here)</template></template>.
            How those combine is not recorded here, so read the clause rather than
            taking any one of them as the maximum.
          </span>
        </div>

        <div v-if="derived.heightM" class="derived">
          <span class="derived-num">{{ derived.heightM }} m</span>
          <span class="derived-label">
            maximum height<template v-if="derived.storeyBand">
              &mdash; the DCP's {{ derived.storeyBand }} band</template
            ><template v-else-if="derived.approxStoreys">
              &mdash; roughly {{ derived.approxStoreys }} storeys at the 3 m floor-to-floor the
              DCP's height controls assume; the plan's own height-to-storey table is not
              held here, so treat this as an estimate</template>
          </span>
        </div>

        <!-- Not "meets minimum lot size" any more. That figure is the
             subdivision standard, and testing the development against it was
             the confusion the Lot Requirements section exists to remove. -->
        <div v-if="derived.maxChildLots" class="derived">
          <span class="derived-num derived-pass">{{ derived.maxChildLots }} lots</span>
          <span class="derived-label">
            the most this lot could be subdivided into, before road, access or
            shape requirements &mdash; see Lot Requirements below
          </span>
        </div>
      </div>

      <div class="facts-grid">
        <div class="fact" v-if="p.fsr_value"><span class="fact-label">Floor Space Ratio</span><span class="fact-value fact-value--num">{{ p.fsr_value }}<span class="fact-sub" v-if="p.fsr_lay_class">{{ p.fsr_lay_class }}</span></span><span class="fact-def">{{ define('fsr') }}</span></div>
        <div class="fact" v-if="p.max_height_m"><span class="fact-label">Max Building Height</span><span class="fact-value fact-value--num">{{ p.max_height_m }}m</span><span class="fact-def">{{ define('height') }}</span></div>
        <div class="fact" v-if="p.min_lot_size"><span class="fact-label">Min Lot Size</span><span class="fact-value fact-value--num">{{ p.min_lot_size }} {{ p.lot_size_units || 'sqm' }}</span><span class="fact-def">{{ define('minLotSize') }}</span></div>
      </div>

      <!-- Each figure above is a map value, and the clause that gives the map
           its force is what makes it citable. The LEP states the control and
           defers the number: cl 4.3 sets height "as shown on the Height of
           Buildings Map", so the record's 16.5m and the clause are two halves
           of one fact. An unmapped standard is stated rather than hidden --
           92% of Hornsby lots carry no FSR, and "none applies" is the finding. -->
      <table v-if="mappedStandards.length" class="rules-table standards-source">
        <thead><tr><th>Standard</th><th>This lot</th><th>Set by</th></tr></thead>
        <tbody>
          <tr v-for="m in mappedStandards" :key="m.clause">
            <td>{{ m.heading || m.map_name }}</td>
            <td :class="m.unmapped ? 'rules-cond' : ''">
              {{ m.unmapped ? 'none mapped' : m.value }}
            </td>
            <td>
              <a v-if="lepClauseHref(m.clause)" :href="lepClauseHref(m.clause)" class="rules-cite">
                cl {{ m.clause }}
              </a>
              <span v-else>cl {{ m.clause }}</span>
              <span class="rules-cond"> · {{ m.map_name }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </details>

    <!-- ── Additional permitted uses (LEP Schedule 1) ──────────────────
         The one provision the property record cannot carry: up_property_d_3 has
         no column for it, so this comes from the knowledge graph, matched to
         the lot by the clause's own land reference. -->
    <details v-if="additionalUses.length" class="rpt-section rpt-section--flag" open>
      <summary class="rpt-section-title">
        Additional Permitted Uses ({{ additionalUses.length }})
      </summary>
      <p class="envelope-blurb">
        Schedule 1 permits these uses on this land in addition to the zone. They
        are not in the zone's permitted-use list, so a check against the zone
        alone would miss them.
      </p>
      <div v-for="a in additionalUses" :key="a.clause" class="apu-item">
        <div class="apu-head">
          <a v-if="lepClauseHref(a.clause)" :href="lepClauseHref(a.clause)" class="rules-cite">
            {{ a.clause }}
          </a>
          <span v-else>{{ a.clause }}</span>
          <span class="apu-ref">applies to {{ a.ref_value }}</span>
        </div>
        <div class="uses-list">
          <span v-for="u in a.uses" :key="u" class="use-chip">{{ u }}</span>
        </div>
      </div>
    </details>

    <!-- ── Site-specific provisions elsewhere in the LEP ───────────────
         Area-based clauses whose polygon contains this lot: the cl 4.4 floor
         space ratio areas and the Part 6 additional local provisions. These are
         what a planner means by "additional controls" -- distinct from the
         split-lot values further down, which are two mapped figures on one
         parcel rather than an extra provision. -->
    <details v-if="areaProvisions.length" class="rpt-section rpt-section--flag" open>
      <summary class="rpt-section-title">
        Site-specific provisions ({{ areaProvisions.length }})
      </summary>
      <p class="envelope-blurb">
        This lot falls inside land the LEP singles out by name, so these clauses
        apply in addition to the standards above.
      </p>
      <table class="rules-table">
        <thead><tr><th>Clause</th><th>Provision</th><th>Applies to</th></tr></thead>
        <tbody>
          <template v-for="a in areaProvisions" :key="a.clause + a.area">
          <tr>
            <td>
              <a v-if="lepClauseHref(a.clause)" :href="lepClauseHref(a.clause)" class="rules-cite">
                cl {{ a.clause }}
              </a>
              <span v-else>cl {{ a.clause }}</span>
            </td>
            <td>{{ a.heading || '—' }}</td>
            <td class="rules-cond">
              {{ a.area }}<template v-if="a.map_layer"> on the {{ a.map_layer }}</template>
            </td>
          </tr>
          <!-- Naming the area is only half a finding. cl 4.4(2A) caps
               residential accommodation in Area 3 at 1:1 where the map shows 5,
               and cl 6.12 caps seniors housing at 20.5m where the map shows
               35.5m -- so on this land the mapped figure is not the operative
               limit for those uses. -->
          <tr v-if="(a.effect && a.effect.length) || (a.values && a.values.length)">
            <td colspan="3" class="prov-effect">
              <!-- The figure first. Where the clause tabulates a value per area
                   only this lot's row matters, and it is the one thing the
                   reader has to act on. -->
              <p v-for="v in a.values" :key="v.area" class="prov-value">
                {{ v.area }}: <strong>{{ v.value }}</strong>
              </p>
              <p v-for="e in a.effect" :key="e.local_id" class="prov-para">
                <span v-if="e.number" class="prov-num">{{ e.number }}</span>{{ ' ' + e.text }}
              </p>
            </td>
          </tr>
          </template>
        </tbody>
      </table>
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
            <!-- Both are measured in the same notebook as the frontage above
                 and both feed the 3D envelope; neither had ever appeared on
                 the page the envelope is linked from. -->
            <div class="dim" v-if="p.lot_depth_m"><span class="dim-label">Depth</span><span class="dim-value">{{ Number(p.lot_depth_m).toFixed(1) }}m</span></div>
            <div class="dim" v-if="p.orientation_degrees"><span class="dim-label">Orientation</span><span class="dim-value">{{ Number(p.orientation_degrees).toFixed(0) }}°</span></div>
          </div>

          <!-- Boundary side lengths.
               Drawn on the boundary itself wherever the map geometry can be
               trusted; the list is the fallback for when it cannot, so the
               numbers are never simply lost. -->
          <div class="edge-list">
            <div class="edge-heading">
              Side lengths
              <span v-if="edgeMeasurements.length" class="edge-count">{{ edgeMeasurements.length }} sides</span>
            </div>

            <template v-if="edgeMeasurements.length">
              <p class="edge-onmap">Each boundary is labelled with its own recorded length on the map.</p>
              <div class="edge-items">
                <span v-for="(e, i) in edgeMeasurements" :key="i" class="edge-chip">
                  <span class="edge-n">{{ i + 1 }}</span>
                  <span class="edge-num">{{ e.value }}</span><span class="edge-unit">{{ e.unit }}</span>
                </span>
              </div>
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

    <!-- ── Lot shape ───────────────────────────────────────────────────
         Its own section, not a fourth block in the column beside the map.
         That column shares a grid row with the map, so anything added to it
         drives the row past the map's fixed 520px and the map ends up sitting
         in a box taller than itself. Twelve indices is more than that column
         can carry.

         Closed by default: these are supporting measurements, and the numbers
         a reader came for — frontage, depth, area, side lengths — are still
         beside the map where they were. -->
    <details v-if="lotShape.length" class="rpt-section">
      <summary class="rpt-section-title">
        Lot shape
        <span class="rpt-count">{{ lotShape.length }} measures</span>
      </summary>
      <p class="envelope-blurb">
        Measured off the surveyed boundary. Each carries its own reading, because
        a bare 0.82 says nothing on its own about whether the shape helps or
        hinders.
      </p>
      <div class="shape-items">
        <div v-for="s in lotShape" :key="s.key" class="shape-row">
          <span class="shape-label">{{ s.label }}</span>
          <span class="shape-value">{{ s.value }}<span class="shape-unit" v-if="s.unit">{{ s.unit }}</span></span>
          <span class="shape-note">{{ s.note }}</span>
        </div>
      </div>
    </details>

    <!-- ── Lot requirements and subdivision ────────────────────────────
         The mapped minimum lot size answers neither question on its own. It is
         the subdivision standard, and the LEP sets a separate, larger figure
         for the development itself — Hornsby's cl 4.1C wants 700 m² for an
         attached dual occupancy where the map shows 500. A reader comparing
         their area against the mapped figure concludes the site qualifies for
         something it does not, so both tests are shown, each against the
         clause that actually imposes it. -->
    <details v-if="lotReq.areaSqm" class="rpt-section" open>
      <summary class="rpt-section-title">
        Lot Requirements &amp; Subdivision
        <span v-if="lotReq.meetsAny === false" class="rpt-count">below minimum</span>
        <span v-else-if="lotReq.meetsAll === false" class="rpt-count">some variants only</span>
      </summary>

      <p v-if="!lotReq.hasRuleLayer" class="lotreq-warn">
        This council's LEP has not been decomposed into testable rules yet, so
        the minimum lot size the LEP sets for a {{ lotReq.proposedUse }} cannot be
        checked here. That is a gap in this tool, not a finding that no minimum
        applies &mdash; read cl 4.1 and Part 4 of the LEP directly. The
        subdivision figure below still holds: it comes from the Lot Size Map.
      </p>

      <div v-if="lotReq.requirements?.length" class="lotreq-group">
        <h4 class="lotreq-head">Minimum lot size for a {{ lotReq.proposedUse }}</h4>
        <div class="lotreq-scroll">
        <table class="rules-table">
          <thead>
            <tr><th>Clause</th><th>Applies to</th><th class="rules-num">Required</th><th class="rules-num">This lot</th><th>Result</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in lotReq.requirements" :key="r.clause">
              <td>
                <a v-if="lepClauseHref(r.clause)" :href="lepClauseHref(r.clause)" class="rules-cite">cl {{ r.clause }}</a>
                <span v-else>cl {{ r.clause }}</span>
                <span v-if="r.heading" class="lotreq-heading">{{ r.heading }}</span>
              </td>
              <td class="rules-cond">{{ r.uses.join(', ') || lotReq.proposedUse }}</td>
              <td class="rules-num">
                {{ r.binding.toLocaleString() }} m²
                <!-- Where the clause bands its figure by variant, showing only
                     the ceiling hides the option the reader may actually want. -->
                <span v-if="r.values.length > 1" class="rules-cond">
                  ({{ r.values.map((v: number) => v.toLocaleString()).join(' / ') }})
                </span>
              </td>
              <td class="rules-num">{{ lotReq.areaSqm?.toLocaleString() ?? '—' }} m²</td>
              <td>
                <span v-if="r.meets === null" class="lotreq-unknown">no recorded area</span>
                <span v-else-if="r.meets" class="lotreq-pass">Satisfied</span>
                <span v-else class="lotreq-fail">
                  Short by {{ r.shortfall?.toLocaleString() }} m²
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <p v-if="lotReq.requirements.some((r: any) => r.values.length > 1)" class="lotreq-note">
          Where a clause states more than one figure for the same use, the larger
          is tested: the instrument bands them by a condition this report cannot
          resolve from the record, so the smaller applies only if the proposal
          can show it meets that condition.
        </p>
      </div>

      <div v-if="lotReq.subdivision?.length" class="lotreq-group">
        <h4 class="lotreq-head">Subdivision</h4>
        <div class="lotreq-scroll">
        <table class="rules-table">
          <thead>
            <tr><th>Clause</th><th>Type</th><th class="rules-num">Min per lot</th><th class="rules-num">Lots possible</th><th>Source of figure</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in lotReq.subdivision" :key="r.clause">
              <td>
                <template v-if="r.clause">
                  <a v-if="lepClauseHref(r.clause)" :href="lepClauseHref(r.clause)" class="rules-cite">cl {{ r.clause }}</a>
                  <span v-else>cl {{ r.clause }}</span>
                </template>
                <span v-else class="lotreq-unknown">clause not extracted</span>
                <span v-if="r.heading" class="lotreq-heading">{{ r.heading }}</span>
              </td>
              <td class="rules-cond">
                {{ r.kind }}<template v-if="r.uses.length"> · {{ r.uses.join(', ') }}</template>
              </td>
              <td class="rules-num">{{ r.minLotSize ? r.minLotSize.toLocaleString() + ' m²' : '—' }}</td>
              <td class="rules-num">
                <span v-if="r.maxChildLots === null" class="lotreq-unknown">&mdash;</span>
                <span v-else-if="r.maxChildLots < 2" class="lotreq-fail">too small</span>
                <span v-else class="lotreq-pass">{{ r.maxChildLots }}</span>
              </td>
              <td class="rules-cond">{{ r.fromMap ? 'Lot Size Map' : 'stated in the clause' }}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p class="lotreq-note">
          Lots possible is area divided by the minimum, and is a ceiling rather
          than a yield: it takes no account of road or access requirements, lot
          shape, battle-axe handle area, or any easement over the land.
          &ldquo;Too small&rdquo; means the lot does not reach twice the minimum,
          so the clause permits no subdivision at all.
        </p>
        <p v-if="lotReq.hasRuleLayer" class="lotreq-note">
          Clauses are filtered to this lot's zone and to the use above. A clause
          whose remaining condition the property record cannot settle is listed
          anyway, with its heading, rather than dropped &mdash; so read the
          heading before relying on a figure.
        </p>
      </div>

      <div v-if="subdivisionGroups.length" class="lotreq-group">
        <h4 class="lotreq-head">What else the DCP requires of a subdivision</h4>
        <p class="lotreq-note" style="margin-top:0">
          Clearing the minimum lot size is not the whole test. These are the
          {{ ruleSourceLabel }}'s own subdivision controls, which set lot width,
          setbacks and accessway dimensions for the lots a subdivision creates.
          They sat at the foot of the numeric table before, under a heading that
          did not say they were about subdividing. They carry no zone of their own,
          so they are grouped by the part of the plan they come from &mdash; read
          the part that matches this lot.
        </p>
        <div v-for="sg in subdivisionGroups" :key="sg.heading" class="lotreq-scroll">
          <h5 class="lotreq-subhead">{{ sg.heading }}</h5>
          <table class="rules-table">
            <thead><tr><th>Control</th><th>Requirement</th><th>Applies when</th><th>Clause</th></tr></thead>
            <tbody>
              <tr v-for="r in sg.rules" :key="r.key" :class="{ 'rules-row--off': !r.inBand || r.superseded }">
                <td>{{ r.label }}</td>
                <td>
                  {{ r.requirement }}
                  <span
                    v-if="r.suspect"
                    class="rules-suspect"
                    title="The unit recorded for this control does not match what the topic measures — read the clause before relying on it."
                  >check clause</span>
                </td>
                <td class="rules-cond">
                  <span v-if="r.banded && r.inBand" class="rules-applies">{{ r.condition }}</span>
                  <template v-else>{{ r.condition || '—' }}</template>
                </td>
                <td>
                  <a v-if="r.clauseHref" :href="r.clauseHref" class="rules-cite">cl {{ r.clause }}</a>
                  <span v-else>cl {{ r.clause }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="lotreq-note">
          A control marked &ldquo;check clause&rdquo; has a unit that does not match
          what its topic measures &mdash; a lot <em>width</em> in metres recorded
          against lot size, for one &mdash; so read the clause rather than the row.
        </p>
      </div>

      <p class="lotreq-note">
        Only the LEP is tested here. State policies can set their own minimums —
        the Housing SEPP's non-discretionary standards among them — and those
        are not held in this graph yet, so their absence here is not a finding
        that none applies.
      </p>
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
      <!-- Why, for the lot as a whole. Recorded as layer=value pairs, so the
           layer that decided it is named rather than left to be inferred from
           whichever pathway happens to list a matching exclusion. -->
      <div v-if="cdcReasons.length" class="cdc-reasons">
        <span class="cdc-reasons-label">Recorded against this lot</span>
        <span v-for="(r, i) in cdcReasons" :key="i" class="cdc-reason">
          <strong>{{ r.label }}</strong>{{ r.field ? ' — ' : '' }}{{ r.value }}
        </span>
      </div>
      <div class="cdc-grid">
        <div v-for="c in cdcPathways" :key="c.key" class="cdc-item">
          <span :class="['cdc-dot', c.eligible ? 'cdc-dot--yes' : 'cdc-dot--no']"></span>
          <span class="cdc-name">{{ c.label }}</span>
          <span v-if="!c.eligible && c.exclusions" class="cdc-excl">{{ c.exclusions }}</span>
        </div>
      </div>
    </details>

    <!-- ── Zoning history ──────────────────────────────────────────────
         What this land was zoned before, and the amendment that changed it.
         Held on effectively every row and never shown: a consent, a valuation
         or a neighbour's approval that predates the change was granted under
         the earlier zone, and nothing on the page said what that was. -->
    <details v-if="zoningHistory.length" class="rpt-section" open>
      <summary class="rpt-section-title">
        Zoning history
        <span class="rpt-count">{{ zoningHistory.length }} recorded</span>
      </summary>
      <p class="envelope-blurb">
        Each row is an amendment that set this land's zone, newest first — so the
        current zone usually appears here too, with the instrument and date that
        put it in place. A consent or valuation predating the top row was made
        under a different zone.
      </p>
      <div class="constraint-list">
        <div v-for="(h, i) in zoningHistory" :key="i" class="constraint-row">
          <span :class="['cdc-dot', h.current ? 'cdc-dot--yes' : 'cdc-dot--no']"></span>
          <span class="constraint-name">
            {{ h.zone }}<template v-if="h.zoneClass"> — {{ h.zoneClass }}</template>
            <template v-if="h.current"> (current)</template>
          </span>
          <span class="constraint-detail">
            <template v-if="h.amendment">{{ h.amendment }}</template>
            <template v-if="h.commenced"> · commenced {{ h.commenced }}</template>
            <template v-if="h.published"> · published {{ h.published }}</template>
          </span>
        </div>
      </div>
    </details>

    <!-- ── Which map each standard came from ───────────────────────────
         The standards above are values read off mapped layers. This says which
         layer, under which instrument, and the map's own symbol code — the
         letter printed on the FSR map, which is what a reader checking the map
         itself is looking for. -->
    <details v-if="mapProvenance.length" class="rpt-section">
      <summary class="rpt-section-title">Source maps &amp; instruments</summary>
      <div class="facts-grid">
        <div v-for="m in mapProvenance" :key="m.label" class="fact">
          <span class="fact-label">{{ m.label }}</span>
          <span class="fact-value">{{ m.value }}<span class="fact-sub" v-if="m.code">code {{ m.code }}</span></span>
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
      <summary class="rpt-section-title">
        Low-Mid Rise Housing &amp; Pattern Book
        <span v-if="patternBookItems.length" class="rpt-count">
          {{ patternBookEligible }} of {{ patternBookItems.length }} patterns
        </span>
      </summary>
      <div v-if="isYes(p.in_lmr_housing_area)" class="lmr-badge">In LMR Housing Area</div>
      <div v-if="isYes(p.in_tod_area)" class="lmr-badge">In TOD Accelerated Precinct</div>
      <div class="facts-grid" v-if="p.lmr_permissible || p.lmr_height_rfb || p.lmr_height_sth || lmrDetail.length">
        <div class="fact" v-if="p.lmr_permissible"><span class="fact-label">LMR Permissible</span><span class="fact-value">{{ p.lmr_permissible }}</span></div>
        <div class="fact" v-if="p.lmr_height_rfb"><span class="fact-label">RFB Height</span><span class="fact-value">{{ p.lmr_height_rfb }}</span></div>
        <div class="fact" v-if="p.lmr_height_sth"><span class="fact-label">STH Height</span><span class="fact-value">{{ p.lmr_height_sth }}</span></div>
        <!-- The LMR standards behind the flag: the policy sets its own FSR,
             minimum lot size and minimum width, and names the station the
             distance band is measured from. -->
        <div class="fact" v-for="d in lmrDetail" :key="d.label">
          <span class="fact-label">{{ d.label }}</span><span class="fact-value">{{ d.value }}</span>
        </div>
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
        Subdivision controls are answered under Lot Requirements &amp; Subdivision
        rather than repeated here.
      </p>
      <p v-if="p?.area_sqm" class="envelope-blurb">
        This DCP bands site coverage, floor area and landscaping by lot size.
        The band this lot's <strong>{{ Number(p.area_sqm).toLocaleString() }} m²</strong>
        falls in is <span class="rules-applies">highlighted</span>; the other bands
        are shown dimmed so the ladder stays visible, but they do not apply here.
        A control with no band is not highlighted &mdash; it applies, but nothing
        about this lot's size was tested to reach that.
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
            <!-- A control stated for a lot-size band this lot is not in is
                 dimmed rather than removed: the reader can still see the whole
                 ladder and where their lot sits on it, but the row that governs
                 is the one that reads as a finding. -->
            <tr v-for="r in g.rules" :key="r.key" :class="{ 'rules-row--off': !r.inBand || r.superseded }">
              <td>{{ r.label }}</td>
              <td>
                {{ r.requirement }}
                <span
                  v-if="r.suspect"
                  class="rules-suspect"
                  title="The unit recorded for this control does not match what the topic measures — read the clause before relying on it."
                >check clause</span>
              </td>
              <td class="rules-cond">
                <span v-if="r.banded && r.inBand" class="rules-applies">{{ r.condition }}</span>
                <span
                  v-else-if="r.superseded"
                  class="rules-superseded"
                  title="This clause also states a figure for this lot's size band, which is the more specific one."
                >other lot sizes</span>
                <template v-else>{{ r.condition || '—' }}</template>
              </td>
              <td>
                <a v-if="r.clauseHref" :href="r.clauseHref" class="rules-cite">cl {{ r.clause }}</a>
                <span v-else>cl {{ r.clause }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </details>

    <!-- ── Governing planning documents ────────────────────────────────
         Which instruments this report draws on, and as at when. A planning
         report that cites clauses without naming the consolidation they came
         from cannot be checked, and the version actually held is not always
         the one the property record names. -->
    <details v-if="governingDocs.length" class="rpt-section" open>
      <summary class="rpt-section-title">Governing Planning Documents ({{ governingDocs.length }})</summary>
      <p v-if="dcpNameMismatch" class="rules-mismatch">
        The property record names <strong>{{ p?.dcp_plan_name }}</strong> as the DCP for
        this lot, but the version held here is {{ ruleSourceLabel }}. Clause numbers
        below follow the version held.
      </p>
      <table class="rules-table">
        <thead><tr><th>Instrument</th><th>Type</th><th>As at</th></tr></thead>
        <tbody>
          <tr v-for="d in governingDocs" :key="d.slug">
            <td>
              <a v-if="d.viewerHref" :href="d.viewerHref" class="rules-cite">{{ d.title }}</a>
              <span v-else>{{ d.title }}</span>
            </td>
            <td class="rules-cond">{{ d.docType.toUpperCase() }}</td>
            <td class="rules-cond">{{ d.asAt || 'not recorded' }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <!-- ── Site constraints ────────────────────────────────────────────
         One section, one row per overlay. Stating "no overlay applies" is a
         finding, not an omission: an unchecked constraint and an absent one
         look identical otherwise. This replaced three sections that covered
         the same ground — a chip list of whatever happened to be set, a
         Heritage panel, and a five-row list — so a reader had to visit all
         three to learn that nothing applied. -->
    <details v-if="property" class="rpt-section" open>
      <summary class="rpt-section-title">
        Site Constraints
        <span v-if="constraintsApplying" class="rpt-count">{{ constraintsApplying }} apply</span>
      </summary>
      <div class="constraint-list">
        <div v-for="c in siteConstraints" :key="c.label" class="constraint-row">
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

    <!-- ── Everything held for this lot ────────────────────────────────
         The sections above choose what to say about the record; this one says
         what is in it. Closed by default and grouped, so it is a reference
         rather than a wall — and it means a column the curated sections do not
         cover is still visible, including one added upstream tomorrow. -->
    <details v-if="allFieldCount" class="rpt-section">
      <summary class="rpt-section-title">
        All data held for this lot
        <span class="rpt-count">{{ allFieldCount }} fields</span>
      </summary>
      <p class="envelope-blurb">
        Every non-empty column of <code>up_property_d_3</code> for this property,
        as the table stores it. Empty columns are omitted — most of the 307 are
        empty for any given lot, and an absent overlay is not a finding here the
        way it is under Site Constraints.
      </p>
      <div v-for="cat in allFields" :key="cat.key" class="raw-group">
        <h3 class="raw-group-title">{{ cat.label }}</h3>
        <p v-if="cat.blurb" class="raw-group-blurb">{{ cat.blurb }}</p>
        <div class="raw-grid">
          <div v-for="f in cat.fields" :key="f.key" class="raw-row">
            <span class="raw-label" :title="f.key">{{ f.label }}</span>
            <span class="raw-value">{{ f.value }}<span class="raw-unit" v-if="f.unit">{{ f.unit }}</span></span>
          </div>
        </div>
      </div>
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
import { renderMarkdownWithCitations, type Citation } from '~/utils/citation-render'
import {
  conditionLabel, DEV_TYPE_LABEL, unitLooksWrong, matchesLotSizeBand,
  bandSupersededIdentities, isBandSuperseded,
} from '#shared/dcp-scope'
import { martinTileBase } from '#shared/martin'
import { DCP_SLUG_BY_LGA } from '#shared/property-columns'
// Categorising and labelling the whole row, so the sections below can name the
// fields they curate and a catch-all can still show everything else.
import { categorise, patternEligibility, humanise } from '#shared/property-fields'
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
  // Follow the use the reader is actually looking at. The link used to carry
  // no `use` at all, so every lot got the endpoint's default pair and the
  // envelope never answered the question on screen — open "dual occupancy"
  // and the model was still the dwelling-house-and-dual-occupancy worst case.
  const use = selectedUse.value || ''
  const api = `/api/property/envelope?address=${encodeURIComponent(addr)}`
    + (use ? `&use=${encodeURIComponent(use.toLowerCase())}` : '')
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

// ── Boundary side lengths ───────────────────────────────────────────────────
//
// Nothing is computed here any more. Each boundary edge is drawn by the
// `lot-edge-label` layer above, labelled with the `edge_length_m` the tile
// carries for it, and the panel beside the map lists the same figures from the
// record's own `all_edges_measurements`.
//
// The page previously derived them twice over: `renderSideLabels` measured the
// tile ring, merged its collinear segments and placed pills on the result, and
// `labelEdgesAt` measured every segment again to decide where a label went.
// Both read lengths off simplified, tile-clipped geometry and both had to be
// checked against `perimeter_m` before they could be trusted. The source
// publishes the number per edge, so it is read rather than re-derived.

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
/**
 * The lot layers, drawn the way /prop-width draws them.
 *
 * `lot_metrics_3` rather than the raw `lot` cadastre: it is the same parcel
 * geometry with the frontage and boundary metrics already attached, and its
 * companion `lot_metrics_3_edges` publishes one LineString per boundary edge
 * carrying that edge's own `edge_length_m`.
 *
 * That recorded length is what the map now labels. The page used to derive the
 * side lengths instead — measuring the tile ring segment by segment and
 * placing pills on it — which meant the numbers on the map were computed from
 * simplified, tile-clipped geometry rather than read from the source.
 */
const LOT_SRC = 'martin:lot'
const LOT_LAYER = 'lot_metrics_3'
const EDGE_SRC = 'martin:lot-edges'
const EDGE_LAYER = 'lot_metrics_3_edges'

/**
 * Tile server base, resolved during setup.
 *
 * Not read inside addLotLayer: that runs from a mapbox-gl 'load' callback where
 * the Nuxt instance is gone and useRuntimeConfig() throws. mapbox-gl swallows
 * exceptions raised in its event handlers, so the only symptom was a map with
 * no lot layer and nothing in the console.
 */
const martinBase = martinTileBase(String((useRuntimeConfig().public as any).martinUrl || ''))

/**
 * A mapbox filter selecting this report's own parcel.
 *
 * A strata plan records no lot number — the record holds an empty `lotnumber`
 * and the tile omits the field — so those are matched on the plan alone rather
 * than on a lot number neither side has. With no plan to match on, the filter
 * selects nothing instead of everything.
 */
function subjectLotFilter(): any[] {
  const plan = String(p.value?.plan_label ?? '').trim().toUpperCase()
  const lot = String(p.value?.lotnumber ?? '').trim().toUpperCase()
  if (!plan) return ['==', ['literal', 1], 0]

  const byPlan = ['==', ['upcase', ['to-string', ['get', 'planlabel']]], plan]
  if (!lot) return byPlan
  return ['all', byPlan, ['==', ['upcase', ['to-string', ['get', 'lotnumber']]], lot]]
}

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

    // The lot this report is about, picked out of its neighbours the way
    // /prop-width marks the selected one. Matched on the record's own lot and
    // plan rather than on what sits under the marker — a strata parcel and its
    // parent can both cover the pin, and the record is unambiguous.
    map.addLayer({
      id: 'lot-subject',
      type: 'line',
      source: LOT_SRC,
      'source-layer': LOT_LAYER,
      filter: subjectLotFilter(),
      paint: {
        'line-color': '#dc2626',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 19, 5],
        'line-opacity': 1,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
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

    // ── Boundary edges, straight from the tile ─────────────────────────────
    map.addSource(EDGE_SRC, {
      type: 'vector',
      tiles: [`${martinBase}/${EDGE_LAYER}/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 22,
    })
    map.addLayer({
      id: 'lot-edge-line',
      type: 'line',
      source: EDGE_SRC,
      'source-layer': EDGE_LAYER,
      minzoom: 16,
      paint: {
        'line-color': '#fbbf24',
        'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1.4, 19, 3],
        'line-opacity': 0.85,
      },
      layout: { 'line-cap': 'round' },
    })
    // The edge's own recorded length, along the edge it belongs to.
    // `number-format` only sets the decimal places; the value is verbatim.
    map.addLayer({
      id: 'lot-edge-label',
      type: 'symbol',
      source: EDGE_SRC,
      'source-layer': EDGE_LAYER,
      minzoom: 17,
      layout: {
        'text-field': [
          'concat',
          ['number-format', ['get', 'edge_length_m'], { 'max-fraction-digits': 2 }],
          ' m',
        ],
        'symbol-placement': 'line-center',
        'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10.5, 19, 13],
        'text-max-angle': 25,
        'text-padding': 3,
        'text-offset': [0, -0.8],
      },
      paint: {
        'text-color': '#7c2d12',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    })
    // The lot's recorded frontage road and length, both off lot_metrics_3.
    map.addLayer({
      id: 'lot-frontage-label',
      type: 'symbol',
      source: LOT_SRC,
      'source-layer': LOT_LAYER,
      minzoom: 17,
      filter: ['has', 'primary_frontage_road'],
      layout: {
        'text-field': [
          'concat',
          ['get', 'primary_frontage_road'],
          ' · ',
          ['number-format', ['get', 'primary_frontage_length_m'], { 'max-fraction-digits': 2 }],
          ' m',
        ],
        'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10.5, 19, 13],
        'text-padding': 4,
      },
      paint: {
        'text-color': '#7f1d1d',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2.2,
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
    // The Inland Code pathways. Held for every lot and never fetched, so the
    // pathway count in the badge could exceed the number of rows listed under
    // it and nothing explained the difference.
    { key: 'inland', label: 'Inland Dwelling Houses', eligible: isYes(v.cdc_inland_dwelling_houses), exclusions: null },
    { key: 'inland_ru', label: 'Inland Dwelling Houses (RU1/2/4/6)', eligible: isYes(v.cdc_inland_dwelling_houses_ru1246), exclusions: v.cdc_inland_dwelling_houses_ru1246_exclusions },
    { key: 'inland_r', label: 'Inland Dwelling Houses (RU5, R1-R4)', eligible: isYes(v.cdc_inland_dwelling_houses_ru5_r1_r2_r3_r4), exclusions: v.cdc_inland_dwelling_houses_ru5_r1_r2_r3_r4_exclusions },
    { key: 'inland_r5', label: 'Inland Dwelling Houses (R5)', eligible: isYes(v.cdc_inland_dwelling_houses_r5), exclusions: v.cdc_inland_dwelling_houses_r5_exclusions },
    { key: 'inland_farm', label: 'Inland Farm Buildings', eligible: isYes(v.cdc_inland_farm_buildings), exclusions: v.cdc_inland_farm_buildings_exclusions },
  ]
})

/**
 * Why CDC was refused for the lot as a whole.
 *
 * `cdc_reasons` records it as `column=value` pairs — "bushfireproneland=Vegetation
 * Buffer", "h_name=Beecroft, Cheltenham Heritage Conservation Area". The
 * per-pathway exclusions were already shown; this is the overall finding, and
 * it names the layer that produced it, which the exclusions text does not.
 */
const cdcReasons = computed(() => {
  const raw = property.value?.cdc_reasons
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw.split(/[;,](?=\s*\w+=)/).map(s => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.indexOf('=')
    return i < 0
      ? { field: null, label: pair, value: pair }
      : { field: pair.slice(0, i), label: humanise(pair.slice(0, i)), value: pair.slice(i + 1) }
  })
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
  // Computed over the whole rule set, not this group: the general figure and
  // the banded one that displaces it are siblings in the same clause and can
  // land in different groups here.
  const superseded = bandSupersededIdentities(
    siteRules.value, Number(property.value?.area_sqm) || null)
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
      // Whether this lot's own area falls in the band the control is stated
      // for. A lot sits in exactly one band, so the rest are noise: on a
      // 949.72 m² lot, 43 of the 49 banded controls in scope are for sizes it
      // is not, and reading "site coverage max 65% at 200–249" beside "max 40%
      // at 900–1499" leaves the reader to work out which is theirs.
      inBand: matchesLotSizeBand(r0, Number(property.value?.area_sqm) || null),
      // Only a control the DCP states per lot size was actually tested against
      // this lot. An unbanded control applies too, but badging it "this is your
      // band" would claim a check that never happened -- and some unbanded rows
      // are banded rows that lost their band at ingest, so the claim would
      // sometimes be false.
      banded: r0.condition_metric === 'lot_size',
      // The clause's general figure for this control, where it also states one
      // for this lot's band. Shown, because it is in the plan, but demoted:
      // the specific figure is the one that governs.
      superseded: isBandSuperseded(r0, superseded),
      clause: r0.clause,
      clauseHref: slug && anchor
        ? `/doc-viewer?doc=${slug}&anchor=${encodeURIComponent(anchor)}` : null,
    }
  }).sort((a, b) =>
    // The control that governs this lot leads its topic; the other bands follow
    // so nothing is hidden, only demoted.
    a.label.localeCompare(b.label)
    || Number(b.inBand) - Number(a.inBand)
    || Number(a.superseded) - Number(b.superseded)
    || String(a.clause).localeCompare(String(b.clause)))
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
/**
 * True for a control that governs subdividing the land rather than building on
 * it. The DCP marks it as a development type of its own, which is how these 49
 * controls came to sit in a collapsed group at the foot of the numeric table,
 * below Farm stay accommodation, on a lot whose only real question was whether
 * it could be split.
 */
const isSubdivisionRule = (r: any) => String(r.applies_to ?? '') === 'subdivision'

/**
 * The DCP's subdivision controls, split by the part of the plan they sit in.
 *
 * DCP rules carry no zone applicability, so nothing in the rule layer stops
 * cl 6.3.1 "Rural Lands Subdivision" -- minimums of 2 to 40 hectares -- being
 * listed against a 949 m2 suburban lot. The section heading is the only thing
 * separating it from cl 6.2.1 "Residential Lands Subdivision", and it says so
 * plainly. Grouping on it puts the reader in front of the right part without
 * this code guessing which part that is.
 */
const subdivisionGroups = computed(() => {
  const by = new Map<string, any[]>()
  for (const r of siteRules.value.filter(isSubdivisionRule)) {
    const key = String(r.section_heading || 'Subdivision')
    if (!by.has(key)) by.set(key, [])
    by.get(key)!.push(r)
  }
  return [...by.entries()]
    .map(([heading, rows]) => ({
      // The heading repeats its own clause number; the table already has one.
      heading: heading.replace(/^[0-9.]+\s*/, ''),
      rules: buildRules(rows),
    }))
    .sort((a, b) => a.heading.localeCompare(b.heading))
})

const numericRuleGroups = computed(() => {
  const byScope = new Map<string, any[]>()
  // Subdivision controls are answered in their own section, beside the LEP
  // minimums they qualify, rather than repeated here.
  for (const r of siteRules.value.filter(r => !isSubdivisionRule(r))) {
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
/**
 * Provisions that apply to this lot because of where it is, from the graph.
 *
 * Additional permitted uses have no column in up_property_d_3 at all, and the
 * Part 4 standards are a clause in the graph plus a number in the record, so
 * neither source can produce these sections on its own.
 */
const additionalUses = ref<any[]>([])
const areaProvisions = ref<any[]>([])
const mappedStandards = ref<any[]>([])

/** Deep link to a LEP clause in the in-app viewer. */
function lepClauseHref(clause: string) {
  const slug = lepDocSlug.value
  if (!slug || !clause) return null
  // Schedule 1 items are cited as "Sch 1 item 9" but anchored as "sch.1-sec.9",
  // which is the identifier the instrument itself uses.
  const m = String(clause).match(/^Sch\s*(\w+)\s*item\s*(\w+)$/i)
  const anchor = m ? `sch.${m[1]}-sec.${m[2]}` : `sec.${clause}`
  return `/doc-viewer?doc=${slug}&anchor=${encodeURIComponent(anchor)}`
}

/** Slug for the LEP we hold, so a clause number can open at the clause. */
const lepDocSlug = computed(() => {
  const t = String(property.value?.lep_name || '').toLowerCase()
  return t ? t.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null
})

/**
 * The development this report is written about.
 *
 * Held in the URL so a scoped report is a shareable link, and so changing it
 * re-runs the whole pipeline rather than filtering what is already on screen --
 * the DCP scope, the prompt and the derived figures are all computed for it
 * server-side.
 */
const proposedUse = ref(String(route.query.use ?? ''))
const derived = ref<any>({})

/**
 * Uses offered in the selector.
 *
 * The ones the DCP actually holds controls for, first, because those are the
 * only ones the numeric sections can say anything about. The lot's own
 * permitted uses follow, so a reader can still scope the report to something
 * the DCP is silent on and see that silence.
 */
const useOptions = computed(() => {
  const withControls = ruleLandUses.value || []
  const rest = (permittedUses.value || [])
    .map(u => String(u).toLowerCase())
    .filter(u => !withControls.includes(u))
  return [...new Set([...withControls, ...rest])]
})

function onUseChange(e: Event) {
  const next = (e.target as HTMLSelectElement).value
  if (!next || next === proposedUse.value) return
  // A full navigation, not a client-side filter: the server recomputes the
  // scope, the prompt and every derived figure for the chosen use.
  window.location.href = `/report?lat=${lat}&lng=${lng}`
    + `&address=${encodeURIComponent(address)}&use=${encodeURIComponent(next)}`
}

/**
 * Every overlay a planning report is expected to answer, in one place.
 *
 * The five a purchaser asks about first, then the rest the property record
 * carries. Each is stated either way: "no acid sulfate soil overlay applies" is
 * a finding, and an unchecked constraint looks identical to an absent one
 * unless it is said out loud.
 */
const CONSTRAINT_FIELDS: Array<[string, string]> = [
  ['Acid sulfate soils', 'acid_sulfate'],
  ['Biodiversity', 'biodiversity'],
  ['Bushfire prone land', 'bushfireproneland'],
  ['Flood', 'floodmapping'],
  ['Heritage', 'heritage_name'],
  ['Contamination', 'contamination_sitename'],
  ['Mine subsidence', 'mine_subsidence_district'],
  ['Landslide risk', 'landsliderisk'],
  ['Riparian land / watercourse', 'riparianlandwatercourse'],
  ['Drinking water catchment', 'drinking_water_catchment'],
  ['Scenic protection', 'scenicprotectionland'],
  ['Groundwater vulnerability', 'groundwatervulnerability'],
  ['Coastal wetlands', 'coastal_wetlands'],
  ['Coastal environment area', 'coastal_environment_area'],
  ['Coastal use area', 'coastal_use_area'],
  // Overlays the table carries and this list never asked about. Each is
  // populated for at least one lot across the two councils — the ones that are
  // null everywhere (Ramsar, airport noise, koala habitat, mineral resources)
  // are left out rather than stated as absent, because "no overlay applies"
  // would be a claim the data cannot support for a layer that was never
  // mapped here.
  ['Local provisions', 'localprov_lay_class'],
  ['Land reservation / acquisition', 'landres_lay_class'],
  ['Foreshore building line', 'fbl_lay_class'],
  ['Biodiversity values', 'biovalue_category'],
  ['Hawkesbury-Nepean scenic area', 'hawkesbury_lay_class'],
  ['Crown / council reserve', 'crown_reserve_name'],
  ['Biodiversity Conservation Trust agreement', 'bct_controllin'],
  ['National Parks estate', 'npws_ogc_fid'],
  ['Flood — 1% AEP (SDF)', 'floodsdf_ogc_fid'],
  ['Active street frontage', 'activestreetfrontage'],
  ['Coastal management (environment)', 'coastalmanagement_env'],
  ['Coastal management (use)', 'coastalmanagement_use'],
  ['Wetland', 'wetland'],
  ['Local complying development exclusion', 'localcomplying_lay_class'],
]

/** Extra text shown beside a constraint when a second column qualifies it. */
const CONSTRAINT_DETAIL: Record<string, string[]> = {
  localprov_lay_class: ['localprov_lay_name'],
  landres_lay_class: ['landres_lra_type'],
  fbl_lay_class: ['fbl_epi_name'],
  biovalue_category: ['biovalue_boset_class'],
  hawkesbury_lay_class: ['hawkesbury_lay_name'],
  activestreetfrontage: ['asf_epi_name'],
  scenicprotectionland: ['scenic_epi_name'],
}

const siteConstraints = computed(() => {
  const v = property.value
  if (!v) return []
  return CONSTRAINT_FIELDS.map(([label, field]) => {
    const raw = v[field]
    // "No" is a recorded answer, not a value: the mapping was checked and came
    // back negative, which is the same finding as an empty column here.
    const set = raw != null && String(raw).trim() !== '' && String(raw).trim().toLowerCase() !== 'no'
    let detail = set ? String(raw) : `No ${label.toLowerCase()} overlay applies to this property.`
    if (set && field === 'heritage_name') {
      detail = [v.heritage_name, v.heritage_class, v.heritage_id && `item ${v.heritage_id}`]
        .filter(Boolean).join(' · ')
    } else if (set && CONSTRAINT_DETAIL[field]) {
      // The qualifying columns say which provision or which plan, which is the
      // difference between "a local provision applies" and knowing which one.
      detail = [String(raw), ...CONSTRAINT_DETAIL[field].map(k => v[k]).filter(Boolean)]
        .filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')
    }
    return { label, applies: set, detail }
  })
})

const constraintsApplying = computed(() => siteConstraints.value.filter(c => c.applies).length)

/**
 * Dates in this table arrive in three shapes.
 *
 * `historic_commenced_date` is "2023-04-26 00:00:00", `lep_currency_date` is
 * epoch milliseconds as a string ("1749772800000"), and a split lot carries
 * several of either joined by " | ". Printing the raw value put a 13-digit
 * number on the page where a date belongs.
 */
function fmtDate(v: unknown): string {
  if (v == null || v === '') return '—'
  return String(v).split('|').map((part) => {
    const s = part.trim()
    if (!s) return ''
    const n = Number(s)
    const d = /^\d{12,14}$/.test(s) ? new Date(n) : new Date(s.replace(' ', 'T'))
    return Number.isNaN(d.getTime())
      ? s
      : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  }).filter(Boolean).join(' · ')
}

/** Split a "a | b" multi-value column into its parts. */
function splitMulti(v: unknown): string[] {
  if (typeof v !== 'string' || !v.trim()) return []
  return v.split('|').map(s => s.trim()).filter(Boolean)
}

/**
 * How this land was zoned before, and what changed it.
 *
 * `historic_zone` and its siblings are populated on effectively every row and
 * were never fetched. A lot that reads R2 today may have been RU4 until the
 * 2023 Land Use Zones amendment, and that is the first thing anyone asks when a
 * consent or a valuation predates the change. Where the columns hold several
 * values joined by " | " the lot has been rezoned more than once, so they are
 * zipped back into one entry per amendment rather than printed as three lists.
 */
const zoningHistory = computed(() => {
  const v = property.value
  if (!v) return []
  const zones = splitMulti(v.historic_zone)
  if (!zones.length) return []
  const classes = splitMulti(v.historic_lay_class)
  const amendments = splitMulti(v.historic_amendment)
  const commenced = splitMulti(v.historic_commenced_date)
  const published = splitMulti(v.historic_published_date)
  const rows = zones.map((zone, i) => ({
    zone,
    zoneClass: classes[i] ?? classes[0] ?? null,
    amendment: amendments[i] ?? amendments[0] ?? null,
    commenced: commenced[i] ? fmtDate(commenced[i]) : null,
    published: published[i] ? fmtDate(published[i]) : null,
    sortKey: commenced[i] ? Date.parse(String(commenced[i]).replace(' ', 'T')) || 0 : 0,
    current: false,
  }))
  // Newest first. The columns are not ordered by date — 42 Shackel Avenue
  // lists the 2023 zones amendment before Amendment No 9 — so the reading
  // order has to come from the commencement dates rather than the column.
  rows.sort((a, b) => b.sortKey - a.sortKey)
  // The zone appearing in the history is often the current one: these rows
  // record the amendment that *set* a zone, not only changes away from it. Mark
  // the most recent match, not every match, or a lot amended twice to the same
  // zone reads as current twice.
  const cur = rows.find(r => r.zone === v.zone)
  if (cur) cur.current = true
  return rows
})

/**
 * Lot shape, as measured off the cadastre.
 *
 * Twelve indices computed in notebook 04D and present on 98.4% of lots, none of
 * which reached the page. They are the difference between a parcel that takes a
 * standard footprint and one that does not: `rectangularity` is the share of
 * the lot's own bounding rectangle it fills, `neck_ratio` falls away on a
 * battle-axe, `corners_count` climbs on a splayed or curved boundary.
 *
 * Each carries its own reading of the number, because "0.82" means nothing on
 * its own and a reader should not have to guess which direction is good.
 */
const SHAPE_FIELDS: Array<[string, string, (n: number) => string]> = [
  ['corners_count', 'Corners', n => (n <= 4 ? 'a simple quadrilateral' : `${n} boundary corners`)],
  ['rectangularity', 'Rectangularity', n => (n > 0.9 ? 'fills its bounding rectangle' : n > 0.7 ? 'moderately rectangular' : 'well off rectangular')],
  ['convexity', 'Convexity', n => (n > 0.95 ? 'no re-entrant corners' : 'has a re-entrant corner')],
  ['elongation', 'Elongation', n => (n > 0.7 ? 'long and narrow' : 'squarish')],
  ['neck_ratio', 'Neck ratio', n => (n < 0.3 ? 'pinched — typical of a battle-axe handle' : 'no pinch point')],
  ['shape_index', 'Shape index', () => 'perimeter against area; 1.0 is a circle'],
  ['circular_compactness', 'Circular compactness', () => 'area against its enclosing circle'],
  ['square_compactness', 'Square compactness', () => 'area against its enclosing square'],
  ['equivalent_rectangular_index', 'Equivalent rectangle', () => 'area against the rectangle of equal perimeter'],
  ['fractal_dimension', 'Fractal dimension', n => (n > 1.15 ? 'an irregular boundary' : 'a regular boundary')],
  ['effective_diameter_m', 'Effective diameter', () => 'the circle of equal area'],
  ['frontage_area_ratio', 'Frontage : area', () => 'street frontage per square metre of site'],
]

const lotShape = computed(() => {
  const v = property.value
  if (!v) return []
  return SHAPE_FIELDS
    .filter(([k]) => v[k] != null && v[k] !== '')
    .map(([k, label, read]) => {
      const n = Number(v[k])
      return {
        key: k,
        label,
        value: k === 'corners_count' ? String(n) : n.toFixed(k === 'effective_diameter_m' ? 1 : 2),
        unit: k === 'effective_diameter_m' ? 'm' : '',
        note: Number.isFinite(n) ? read(n) : '',
      }
    })
})

/**
 * Which map, under which instrument, as at when.
 *
 * Every development standard on this page is a value read off a mapped layer,
 * and until now the page showed the value without saying which layer it came
 * from or which plan was in force when it was read. On a lot split between two
 * instruments — Randwick's FSR map naming a different LEP from the zoning
 * map — that difference is the finding.
 */
const MAP_PROVENANCE: Array<[string, string, string | null]> = [
  ['Zoning map', 'lzn_epi_name_p', null],
  ['Height of Buildings map', 'hob_epi_name', 'hob_sym_code'],
  ['Floor Space Ratio map', 'fsr_epi_name', 'fsr_label'],
  ['Minimum Lot Size map', 'mls_epi_name', 'lsz_sym_code'],
  ['LEP layer', 'lep_lga_name', 'lep_lay_class'],
  ['DCP layer', 'dcp_council_name', 'dcp_plan_type'],
]

const mapProvenance = computed(() => {
  const v = property.value
  if (!v) return []
  const out = MAP_PROVENANCE
    .filter(([, field]) => v[field] != null && String(v[field]).trim() !== '')
    .map(([label, field, codeField]) => ({
      label,
      value: String(v[field]),
      code: codeField && v[codeField] != null && String(v[codeField]).trim() !== ''
        ? String(v[codeField])
        : null,
    }))
  if (v.lep_currency_date) {
    out.push({ label: 'LEP currency date', value: fmtDate(v.lep_currency_date), code: null })
  }
  return out
})

/** LMR and TOD detail that sat behind the flag the page already showed. */
const lmrDetail = computed(() => {
  const v = property.value
  if (!v) return []
  return ([
    ['LMR code', 'lmr_sym_code'],
    ['LMR floor space ratio', 'lmr_fsr'],
    ['LMR minimum lot size', 'lmr_lotsize'],
    ['LMR minimum lot width', 'lmr_lot_width'],
    ['Station / centre', 'lmr_train_stations'],
    ['Distance band', 'buffer'],
  ] as Array<[string, string]>)
    .filter(([, k]) => v[k] != null && String(v[k]).trim() !== '')
    .map(([label, k]) => ({ label, value: String(v[k]) }))
})

/**
 * Everything held for this lot, grouped, with nothing curated away.
 *
 * The sections above choose what to say about the row. This one says what is in
 * it — all 234 columns the projection now fetches, minus the empty ones,
 * grouped by shared/property-fields.ts. It exists so a reader is never in the
 * position of wondering whether the report simply did not look at a field, and
 * so that a column added upstream is visible the day it lands rather than
 * whenever someone edits this page.
 */
const allFields = computed(() => (property.value ? categorise(property.value) : []))
const allFieldCount = computed(() => allFields.value.reduce((n, c) => n + c.fields.length, 0))

/**
 * The instruments this report draws on, with the consolidation date held.
 *
 * A clause citation is only checkable against a stated version, and the version
 * held is not always the one the property record names — Hornsby's record says
 * DCP 2013 where the clauses come from the 2024 plan.
 */
const governingDocs = ref<any[]>([])

/** One-line definitions, so a grid of numbers reads to a non-planner. */
const FACT_DEFINITIONS: Record<string, string> = {
  fsr: 'Gross floor area permitted, as a multiple of the site area.',
  height: 'Maximum height of a building, from the Height of Buildings Map.',
  minLotSize: 'Smallest lot that may be created here by subdivision.',
}
const define = (k: string) => FACT_DEFINITIONS[k] ?? ''

/**
 * The lot's size tested against the LEP's own minimums, and its subdivision
 * ceiling. Computed server-side against the rule layer, because the comparison
 * needs the clause's figure for the proposed use and not the mapped one.
 */
const lotReq = ref<any>({})

/**
 * Deep link to a DCP clause in the viewer.
 *
 * The rules table builds this inline from each row's own `document_slug`, which
 * a derived figure does not carry -- the server hands it a clause number and
 * nothing else -- so this falls back to the lot's DCP.
 */
function dcpClauseHref(clause: string | null | undefined): string | undefined {
  const slug = dcpDocSlug.value
  if (!slug || !clause) return undefined
  return `/doc-viewer?doc=${slug}&anchor=${encodeURIComponent(`dcp.${clause}`)}`
}

const dcpDocSlug = computed(() => {
  const lga = String(property.value?.lga_name || '').trim().toUpperCase()
  return DCP_SLUG_BY_LGA[lga] ?? null
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

/**
 * Names for the Pattern Book designs, where the column name is not one.
 *
 * The list is no longer the source of truth for *which* patterns exist — that
 * comes from the row itself, so a pattern added upstream appears here without
 * an edit. This only supplies a readable label; anything unlisted falls back to
 * humanise(), which turns small_lot_apt_04_4_5storeys into something legible
 * rather than dropping it.
 */
const PATTERN_LABELS: Record<string, string> = {
  semis_01_anthony_gill: 'Semis — Anthony Gill',
  semis_02_sibling: 'Semis — Sibling',
  manor_homes_01_studio: 'Manor Homes — Studio',
  row_homes_01_saha: 'Row Homes — SAHA',
  terraces_01_carter: 'Terraces — Carter',
  terraces_02_sam_crawford: 'Terraces — Sam Crawford',
  terraces_03_officer_woods: 'Terraces — Officer Woods',
  terraces_04_other: 'Terraces — Other',
  // The apartment patterns. Held for every lot since the Pattern Book landed
  // and never fetched, so a lot eligible for a 3-4 storey apartment building
  // was shown nothing at all.
  small_lot_apt_01_3storeys: 'Small Lot Apartments 01 — 3 storeys',
  small_lot_apt_01_3storeys_min: 'Small Lot Apartments 01 — 3 storeys (minimum lot)',
  small_lot_apt_01_4storeys: 'Small Lot Apartments 01 — 4 storeys',
  small_lot_apt_02_3storeys: 'Small Lot Apartments 02 — 3 storeys',
  small_lot_apt_02_4storeys: 'Small Lot Apartments 02 — 4 storeys',
  small_lot_apt_03_4_6storeys: 'Small Lot Apartments 03 — 4-6 storeys',
  small_lot_apt_04_4_5storeys: 'Small Lot Apartments 04 — 4-5 storeys',
  large_lot_apt_01_4storeys: 'Large Lot Apartments 01 — 4 storeys',
  large_lot_apt_01_6storeys: 'Large Lot Apartments 01 — 6 storeys',
  large_lot_apt_02_3_4storeys: 'Large Lot Apartments 02 — 3-4 storeys',
  large_lot_apt_02_5_6storeys: 'Large Lot Apartments 02 — 5-6 storeys',
  large_lot_apt_03_4_6storeys: 'Large Lot Apartments 03 — 4-6 storeys',
  corner_lot_apt_01_4_6storeys: 'Corner Lot Apartments 01 — 4-6 storeys',
  corner_lot_apt_02_4_6storeys: 'Corner Lot Apartments 02 — 4-6 storeys',
}

/** Houses before apartments, and inside each, eligible first. */
const PATTERN_FAMILY_ORDER = ['semis', 'manor', 'row', 'terraces', 'small', 'large', 'corner']

/**
 * Every pattern the lot was assessed against, eligible or not, each with the
 * reason recorded against it. Previously the list was filtered to eligible
 * patterns unless the lot was in an LMR area, which meant a lot assessed and
 * rejected showed nothing at all — the reason is the interesting part.
 *
 * Derived from the row rather than from a fixed list: the hardcoded list named
 * eight of the twenty-two patterns the table holds, and the other fourteen were
 * invisible for as long as it was the source of truth.
 */
const patternBookItems = computed(() => {
  if (!property.value) return []
  return patternEligibility(property.value)
    .map(x => ({
      key: x.key,
      label: PATTERN_LABELS[x.key] ?? x.label,
      eligible: x.eligible,
      reasons: x.reasons,
      family: x.family,
    }))
    .sort((a, b) => {
      const fa = PATTERN_FAMILY_ORDER.indexOf(a.family)
      const fb = PATTERN_FAMILY_ORDER.indexOf(b.family)
      if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb)
      if (a.eligible !== b.eligible) return Number(b.eligible) - Number(a.eligible)
      return a.key.localeCompare(b.key)
    })
})

const patternBookEligible = computed(() => patternBookItems.value.filter(x => x.eligible).length)


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
  // The endpoint needs the property row, and rejects a request without one.
  // A use can be clicked while the lookup is still in flight, which posted
  // `property: null` and surfaced as a raw 400 in the dev overlay.
  if (!property.value) return
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
      body: JSON.stringify({ lat, lng, address, persona, use: proposedUse.value || undefined }),
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
    case 'governing_docs':
      governingDocs.value = data.documents || []
      break
    case 'lot_requirements':
      lotReq.value = data || {}
      break
    case 'derived':
      derived.value = data || {}
      // The server resolves the default when none was given, so the selector
      // shows what the report was actually written about.
      if (data?.proposedUse) proposedUse.value = data.proposedUse
      break
    case 'provisions':
      additionalUses.value = data.additionalUses || []
      areaProvisions.value = data.areaProvisions || []
      mappedStandards.value = data.mappedStandards || []
      break
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
  /* Both cells sit at the top rather than stretching to the taller of them.
     Without this the dimensions column sets the row height, and the map — which
     is a fixed 520px — is left inside a bordered box taller than the canvas. */
  align-items: start;
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

.rules-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ── Lot requirements ─────────────────────────────────────────────────────── */
.lotreq-group + .lotreq-group { margin-top: 18px; }
.lotreq-head {
  margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #475569;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.lotreq-pass { color: #15803d; font-weight: 600; }
.lotreq-fail { color: #b91c1c; font-weight: 600; }
.lotreq-unknown { color: #94a3b8; }
.lotreq-note {
  margin: 8px 0 0; font-size: 12px; line-height: 1.55; color: #64748b;
}
.lotreq-scroll { overflow-x: auto; }
.rules-row--off { color: #94a3b8; }
.rules-row--off .rules-cite { color: #94a3b8; }
.lotreq-subhead {
  margin: 14px 0 4px; font-size: 12.5px; font-weight: 600; color: #334155;
}
.rules-superseded { color: #94a3b8; font-style: italic; }
.rules-applies {
  display: inline-block; padding: 1px 7px; border-radius: 10px;
  background: #dcfce7; color: #166534; font-weight: 600;
}
.lotreq-warn {
  margin: 0 0 14px; padding: 9px 12px; font-size: 12.5px; line-height: 1.55;
  color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px;
}
/* The heading sits under the clause number rather than beside it: inline, it
   pushed the figures off the right of the page, and the figures are the point. */
.lotreq-heading {
  display: block; margin-top: 2px; font-size: 11.5px; line-height: 1.4;
  color: #94a3b8; max-width: 34ch;
}

.rpt-count { margin-left: 8px; font-size: 12px; font-weight: 500; color: #b45309; }
.fact-def {
  display: block; margin-top: 3px; font-size: 11.5px; line-height: 1.45; color: #94a3b8;
}

/* ── What the report is about ─────────────────────────────────────────────── */
.scope-bar {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px;
  margin-top: 10px; font-size: 13px; color: #475569;
}
.scope-label { color: #64748b; }
.scope-select {
  font: inherit; font-weight: 600; color: #0f172a;
  padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff;
}
.scope-note { color: #94a3b8; }

/* ── Derived figures ──────────────────────────────────────────────────────── */
.derived-row {
  display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px;
}
.derived {
  flex: 1 1 210px; padding: 10px 12px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
}
.derived-num {
  display: block; font-size: 19px; font-weight: 700; color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.derived-num--sm { font-size: 15px; }
.derived-pass { color: #15803d; }
.derived-fail { color: #b91c1c; }
.derived-label { display: block; font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.45; }

/* ── Provisions that single out this land ─────────────────────────────────── */
.rpt-section--flag { border-left: 3px solid #15803d; }
.apu-item { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
.apu-item:last-child { border-bottom: none; }
.apu-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.apu-ref { font-size: 12px; color: #64748b; }
.standards-source { margin-top: 12px; }
.prov-effect {
  padding: 8px 10px 10px;
  background: #f8fafc;
  border-left: 2px solid #cbd5e1;
  font-size: 12px;
  line-height: 1.55;
  color: #334155;
}
.prov-effect p { margin: 0 0 6px; }
.prov-effect p:last-child { margin-bottom: 0; }
.prov-value {
  font-size: 13px;
  color: #0f172a;
  padding: 4px 8px;
  background: #dcfce7;
  border-radius: 4px;
  display: inline-block;
}
/* Hanging indent, so (a) and (b) line up as a list rather than running on. */
.prov-para { padding-left: 30px; text-indent: -30px; }
.prov-num {
  display: inline-block;
  width: 30px;
  text-indent: 0;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
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

/* Why CDC was refused, above the per-pathway grid. */
.cdc-reasons {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  margin: 0 0 0.6rem;
  padding: 8px 10px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 7px;
  font-size: 0.78rem;
  color: #92400e;
}
.cdc-reasons-label {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #b45309;
  width: 100%;
}
.cdc-reason strong { font-weight: 600; }
.cdc-reason + .cdc-reason::before { content: '·'; margin-right: 10px; color: #d6b271; }

/* Lot shape indices — their own section, so the rows get the full width. */
.shape-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(24rem, 1fr));
  gap: 0 1.5rem;
  margin-top: 0.5rem;
}
.shape-row {
  display: grid;
  grid-template-columns: 10rem 5rem 1fr;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px dotted #eef1f5;
  font-size: 0.78rem;
}
.shape-label { color: #475569; }
.shape-value { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.shape-unit { font-weight: 400; color: #94a3b8; margin-left: 1px; }
.shape-note { color: #94a3b8; }

/* The catch-all: every column held, grouped. */
.raw-group { margin-top: 1rem; }
.raw-group:first-of-type { margin-top: 0.4rem; }
.raw-group-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #64748b;
  margin: 0 0 2px;
}
.raw-group-blurb { font-size: 0.72rem; color: #94a3b8; margin: 0 0 0.4rem; }
.raw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
  gap: 0 1.2rem;
}
.raw-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  padding: 3px 0;
  border-bottom: 1px dotted #eef1f5;
  font-size: 0.75rem;
}
.raw-label { color: #64748b; flex: none; max-width: 55%; }
.raw-value {
  font-weight: 500;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.raw-unit { color: #94a3b8; margin-left: 2px; }

/* A description that runs to fifty lot numbers needs the full row. */
.fact--wide { grid-column: 1 / -1; }
.fact--wide .fact-value { overflow-wrap: anywhere; font-size: 0.78rem; }

</style>
