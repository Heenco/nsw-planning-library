<!--
  /report-2 - the lot as a report, built up a section at a time.

  Same data as /testing-spatial-services (/api/lotprofile, the 02C build's derived.lot_frontage row and its
  runs) and the same LotSketch, so a figure here always matches the one there. What changes is the reading:
  only the facts a reader acts on, said in words, with the columns and the method left to the testing page.

  Section 1: the lot and its frontage.
-->

<template>
  <div class="r2">
    <header class="r2-top">
      <NuxtLink to="/" class="r2-back">&larr; Home</NuxtLink>
      <div class="r2-search" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc="listOpen = false">
        <label class="r2-sr" for="r2-q">Address or lot reference</label>
        <input
          id="r2-q" v-model="q" type="search" class="r2-input" placeholder="Search an address or lot, e.g. 26 Foveaux St Surry Hills"
          autocomplete="off" spellcheck="false" role="combobox" :aria-expanded="listOpen && results.length > 0" aria-controls="r2-list"
          @input="onType" @focus="listOpen = results.length > 0" @keydown.enter.prevent="pickHighlighted"
        >
        <span v-if="searching" class="r2-busy">searching…</span>
        <ul v-if="listOpen && results.length" id="r2-list" class="r2-list" role="listbox">
          <li
            v-for="(r, i) in results" :key="`${r.cadid}-${r.msoid}`" role="option" :aria-selected="i === highlight"
            class="r2-opt" :class="{ 'r2-opt--on': i === highlight }" @mousedown.prevent="pick(r)" @mousemove="highlight = i"
          >
            <span>{{ r.address || '(no address)' }}</span>
            <span class="r2-muted">{{ r.titleLot || r.lotId || '' }} {{ r.lgaName ? '· ' + r.lgaName : '' }}</span>
          </li>
        </ul>
        <p v-if="searchError" class="r2-error">{{ searchError }}</p>
      </div>
    </header>

    <div class="r2-layout" :class="{ 'r2-layout--nav': !!detail && !loading }">
    <nav v-if="detail && !loading" class="r2-nav" aria-label="Report sections">
      <p class="r2-nav-title">{{ address || lot?.lot_id || cadid }}</p>
      <a
        v-for="s in navItems" :key="s.id" :href="`#${s.id}`" class="r2-nav-link" :class="{ 'r2-nav-link--on': activeSection === s.id, 'r2-nav-link--support': (s as any).support }"
        :aria-current="activeSection === s.id ? 'true' : undefined" @click.prevent="goTo(s.id)"
      >
        <span class="r2-nav-num">{{ s.n }}</span>
        <span class="r2-nav-label">{{ s.label }}</span>
        <span class="r2-nav-dot" :class="`r2-nav-dot--${s.tone}`" :title="s.hint" />
      </a>
    </nav>
    <main class="r2-page">
      <p v-if="loading" class="r2-muted">Loading the lot…</p>
      <p v-else-if="detailError" class="r2-error">{{ detailError }}</p>
      <p v-else-if="!detail" class="r2-empty">Search for an address to open its report.</p>

      <template v-else>
        <!-- ── Title block: the full address, then the lot, the council and how many addresses share it ── -->
        <section class="r2-title">
          <p class="r2-kicker">Site report</p>
          <h1>{{ (fullAddress || lot?.lot_id || cadid).toUpperCase() }}</h1>
          <p class="r2-ids">
            <span v-if="lot?.lot_id">Lot <b>{{ lot.lot_id }}</b></span>
            <span v-if="lot?.lga_name">{{ titleCase(lot.lga_name) }}</span>
            <span v-if="detail.addresses.length > 1">{{ detail.addresses.length }} addresses on this lot</span>
          </p>
          <!-- the governing instrument and its unit (derived.lot_instrument): an LEP is one unit; a Precinct SEPP's unit is
               the chapter or appendix the land application map puts the lot in; "unit not held" = no map names one -->
          <p v-if="std?.governing" class="r2-ids r2-governing">
            <span>Governed by <b>{{ std.governing.instrument }}</b><template v-if="std.governing.unitHeading">, {{ std.governing.unit }} {{ std.governing.unitHeading }}</template><template v-else-if="std.governing.basis !== 'root'"> (unit not held)</template></span>
            <span v-for="a in std.governing.alsoMapped" :key="a.instrument" class="r2-muted">also mapped: {{ a.instrument }}<template v-if="a.coverPct != null"> ({{ a.coverPct }}%)</template></span>
          </p>
        </section>

        <!-- ── 1. Lot and frontage ─────────────────────────────────────── -->
        <section id="lot" class="r2-section">
          <h2><span class="r2-num">1</span> Lot and frontage</h2>

          <p v-if="!lot" class="r2-note">This lot has not been measured yet, so there is no frontage to report.</p>
          <template v-else>
            <p class="r2-lead">{{ summary }}</p>

            <div class="r2-split">
              <figure class="r2-figure">
                <LotSketch
                  v-if="sketch" :data="sketch" :depth-m="n(lot.lot_depth_m)" :width-at-setback-m="n(lot.width_at_setback_m)"
                  :core-width-min-m="n(lot.core_width_min_m)" :area-sqm="n(lot.area_sqm)"
                />
                <p v-else class="r2-muted">No outline to draw.</p>
                <figcaption>Street at the bottom. Dimensions in metres.</figcaption>
              </figure>

              <dl class="r2-facts">
                <div v-for="f in facts" :key="f.label" class="r2-fact">
                  <dt>{{ f.label }}</dt>
                  <dd :class="{ 'r2-yes': f.flag === true, 'r2-none': f.value === '—' }">{{ f.value }}</dd>
                  <dd v-if="f.sub" class="r2-sub">{{ f.sub }}</dd>
                </div>
              </dl>
            </div>

            <!-- Street frontages -->
            <h3>Street frontages</h3>
            <table v-if="runs.length" class="r2-table">
              <thead><tr><th scope="col">Street</th><th scope="col" class="r2-r">Length</th><th scope="col" /></tr></thead>
              <tbody>
                <tr v-for="(r, i) in runs" :key="r.seq">
                  <td><span class="r2-swatch" :style="{ background: RUN_COLOURS[i % RUN_COLOURS.length] }" />{{ r.road ? titleCase(r.road) : 'Unnamed road' }}</td>
                  <td class="r2-r">{{ m(r.lengthM) }}</td>
                  <td><span v-if="r.isPrimary" class="r2-tag">Primary</span></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="r2-note">No boundary of this lot faces a street.</p>
            <p v-if="primaryBasis" class="r2-small">Primary frontage chosen because: {{ primaryBasis }}.</p>
            <p v-if="lot.abuts_motorway" class="r2-warn">Faces a motorway: {{ lot.abuts_motorway }}.</p>

            <!-- Corner / through -->
            <h3>Corner lot</h3>
            <p>{{ cornerText }}</p>

            <h3>Through lot</h3>
            <p>{{ throughText }}</p>

            <!-- Battle-axe -->
            <h3>Battle-axe</h3>
            <p>{{ battleaxeText }}</p>
            <dl v-if="lot.is_battleaxe" class="r2-mini">
              <div><dt>Handle width (narrowest)</dt><dd>{{ m(lot.stem_width_m ?? lot.handle_neck_min_m) }}</dd></div>
              <div><dt>Handle width (average)</dt><dd>{{ m(lot.handle_neck_mean_m) }}</dd></div>
              <div><dt>Handle length</dt><dd>{{ m(lot.handle_length_m ?? lot.stem_length_m) }}</dd></div>
              <div><dt>Handle area</dt><dd>{{ sqm(lot.handle_area_sqm ?? lot.stem_area_sqm) }}</dd></div>
              <div><dt>Area without the handle</dt><dd>{{ sqm(lot.effective_area_sqm) }}</dd></div>
              <div><dt>Depth of the main body</dt><dd>{{ m(lot.core_depth_m) }}</dd></div>
            </dl>

            <!-- Shape -->
            <h3>Shape</h3>
            <dl class="r2-mini">
              <div><dt>Narrowest width of the main body</dt><dd>{{ m(lot.core_width_min_m) }}</dd></div>
              <div><dt>Widest width</dt><dd>{{ m(lot.lot_width_max_m ?? lot.core_width_max_m) }}</dd></div>
              <div><dt>Perimeter</dt><dd>{{ m(lot.total_boundary_m) }}</dd></div>
              <div v-if="n(lot.plan_lot_area)"><dt>Area on the plan</dt><dd>{{ sqm(lot.plan_lot_area) }}</dd></div>
            </dl>
            <p v-if="lot.whole_lot_analysed === false" class="r2-warn">
              This lot is in more than one piece or has a hole; the figures describe its largest piece.
            </p>

            <p class="r2-foot">
              Lot width in every eligibility test is the primary frontage. Width at the setback is taken
              {{ m(lot.width_setback_depth_m ?? 4.5) }} in from the frontage. {{ checkText }}
              <NuxtLink :to="`/testing-spatial-services?cadid=${cadid}`">Every measured column</NuxtLink>
            </p>
          </template>
        </section>

        <!-- ── 2. Access ───────────────────────────────────────────────── -->
        <section id="access" class="r2-section">
          <h2><span class="r2-num">2</span> Access</h2>
          <p v-if="!detail.lotGeom" class="r2-note">No outline for this lot, so there is nothing to draw.</p>
          <template v-else>
            <p class="r2-lead">{{ accessSummary }}</p>
            <div class="r2-split r2-split--access">
              <figure class="r2-figure">
                <DsLotMap
                  :lots="[{ cadid: String(cadid), geometry: detail.lotGeom as any }]"
                  :neighbours="detail.neighbours as any"
                  :point="accessPoint"
                  :waypoint="access0 ? { lon: access0.wayLon, lat: access0.wayLat } : null"
                  :runs="runs.map(r => ({ coords: r.line, primary: r.isPrimary }))"
                  :label="`Lot, neighbouring lots, address point and road access for ${address || cadid}`"
                />
                <figcaption>The lot, its neighbours, the address point and where the lot meets the road.</figcaption>
              </figure>
              <div>
                <ul class="r2-legend">
                  <li v-for="(r, i) in runs" :key="r.seq">
                    <span class="r2-swatch r2-swatch--line" :style="{ background: r.isPrimary ? '#e11d48' : '#2563eb' }" />
                    <span><b>{{ r.road ? titleCase(r.road) : 'Unnamed road' }}</b> frontage{{ r.isPrimary ? ' (primary)' : '' }}
                      <span class="r2-td-sub">{{ m(r.lengthM) }} along the boundary</span></span>
                  </li>
                  <li v-if="accessPoint">
                    <span class="r2-swatch r2-swatch--dot" />
                    <span><b>Address point</b><span class="r2-td-sub">{{ address || 'the lot\'s address' }}</span></span>
                  </li>
                  <li v-if="access0 && accessPoint">
                    <span class="r2-swatch r2-swatch--dash" />
                    <span><b>Access line</b><span class="r2-td-sub">from the address point to the road access point</span></span>
                  </li>
                  <li v-if="access0">
                    <span class="r2-swatch r2-swatch--way" />
                    <span><b>Road access point</b> on {{ access0.wayRoad ? titleCase(fullRoad(access0.wayRoad)) : 'no road matched' }}
                      <span class="r2-td-sub">the NSW addressing record's access point for this address</span></span>
                  </li>
                </ul>
                <dl class="r2-mini r2-mini--stack">
                  <div v-if="access0"><dt>Access point to the road</dt><dd>{{ m(access0.wayRoadM) }}</dd></div>
                  <div v-if="access0"><dt>Address to access point</dt><dd>{{ m(access0.accessM) }}</dd></div>
                  <div v-if="access0 && access0.sharedBy > 1"><dt>Access point shared by</dt><dd>{{ access0.sharedBy }} addresses</dd></div>
                  <div v-if="primaryBasis"><dt>Primary frontage chosen because</dt><dd class="r2-dd-text">{{ primaryBasis }}</dd></div>
                </dl>
              </div>
            </div>
            <p v-if="accessNote" class="r2-warn">{{ accessNote }}</p>
          </template>
        </section>

        <!-- ── 3. Slope ────────────────────────────────────────────────── -->
        <section id="slope" class="r2-section">
          <h2><span class="r2-num">3</span> Slope</h2>
          <p v-if="slopeError" class="r2-error">{{ slopeError }}</p>
          <p v-else-if="!slopeDetail" class="r2-muted">Reading the slope grid…</p>
          <p v-else-if="!slope" class="r2-note">This lot has not been measured against the slope grid yet.</p>
          <template v-else>
            <p class="r2-lead">{{ slope.sentence }}</p>

            <div class="r2-slope-head">
              <div class="r2-slope-grade" :style="{ borderColor: slope.color }">
                <p class="r2-slope-grade-h" :style="{ color: slope.color }">{{ slope.grade }}</p>
                <p class="r2-slope-big">{{ slope.meanPct.toFixed(1) }}% <span>· {{ slope.meanDeg.toFixed(1) }}° · 1 in {{ slope.oneIn }}</span></p>
                <p class="r2-small">{{ slope.means }}</p>
              </div>
              <dl class="r2-mini r2-mini--stack">
                <div><dt>Gentlest part</dt><dd>{{ slope.minPct.toFixed(1) }}%</dd></div>
                <div><dt>Steepest part</dt><dd>{{ slope.maxPct.toFixed(1) }}%</dd></div>
              </dl>
            </div>

            <h3>In both directions</h3>
            <div class="r2-sections">
              <figure v-for="v in slope.views" :key="v.key" class="r2-figure r2-xsec">
                <figcaption class="r2-xsec-h">{{ v.title }} <span>{{ v.sub }}</span></figcaption>
                <svg :viewBox="`0 0 ${v.W} ${v.H}`" role="img" :aria-label="`${v.title}: falls up to ${v.fall.toFixed(1)} m over ${v.run.toFixed(1)} m`">
                  <defs>
                    <linearGradient :id="`r2g-${v.key}`" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" :stop-color="slope.color" stop-opacity="0.5" />
                      <stop offset="1" :stop-color="slope.color" stop-opacity="0.08" />
                    </linearGradient>
                  </defs>
                  <polygon :points="v.ground" :fill="`url(#r2g-${v.key})`" />
                  <line :x1="v.xa" :y1="v.ya" :x2="v.xb" :y2="v.yb" class="r2-slope-line" :stroke="slope.color" />
                  <!-- the lot's two boundaries -->
                  <line v-for="(bx, i) in [v.xa, v.xb]" :key="i" :x1="bx" :y1="v.top" :x2="bx" :y2="v.base" class="r2-xsec-bound" />
                  <text :x="v.xa - 2" :y="v.top - 4" text-anchor="start" class="r2-xsec-lab">{{ v.leftLabel }}</text>
                  <text :x="v.xb + 2" :y="v.top - 4" text-anchor="end" class="r2-xsec-lab">{{ v.rightLabel }}</text>
                  <!-- a level pad and house: cut on the high side, fill on the low side -->
                  <!-- side view: the long wall, a hipped roof, windows along it -->
                  <template v-if="v.key === 'depth'">
                    <rect :x="v.hx0" :y="v.pad - v.wallH" :width="v.hx1 - v.hx0" :height="v.wallH" class="r2-slope-house" />
                    <polygon :points="v.roof" class="r2-slope-roof" />
                    <rect v-for="(wx, i) in v.windows" :key="i" :x="wx" :y="v.pad - v.wallH + 7" width="9" height="9" class="r2-slope-win" />
                    <!-- the street end: footpath, kerb and an arrow -->
                    <line :x1="v.xa - 16" :y1="v.ya" :x2="v.xa" :y2="v.ya" class="r2-xsec-path" />
                    <line :x1="v.xa - 16" :y1="v.ya" :x2="v.xa - 16" :y2="v.ya + 5" class="r2-xsec-path" />
                    <text :x="v.xa - 2" :y="v.ya + 16" text-anchor="start" class="r2-xsec-lab">← street</text>
                  </template>
                  <!-- front view: the facade, a gable, a door between two windows -->
                  <template v-else>
                    <polygon :points="v.house" class="r2-slope-house" />
                    <rect :x="v.door.x" :y="v.pad - v.door.h" :width="v.door.w" :height="v.door.h" class="r2-slope-door" />
                    <rect v-for="(wx, i) in v.windows" :key="i" :x="wx" :y="v.pad - v.wallH + 7" width="10" height="10" class="r2-slope-win" />
                  </template>
                  <polygon :points="v.fill" class="r2-slope-fill" />
                  <polygon :points="v.cut" class="r2-slope-cut" />
                  <line :x1="v.padX0" :y1="v.pad" :x2="v.padX1" :y2="v.pad" class="r2-slope-pad" />
                  <!-- the fall, end to end -->
                  <line :x1="v.xb + 10" :y1="v.yb" :x2="v.xb + 10" :y2="v.ya" class="r2-slope-bracket" />
                  <line :x1="v.xb + 6" :y1="v.yb" :x2="v.xb + 14" :y2="v.yb" class="r2-slope-bracket" />
                  <line :x1="v.xb + 6" :y1="v.ya" :x2="v.xb + 14" :y2="v.ya" class="r2-slope-bracket" />
                  <text :x="v.xb + 18" :y="(v.ya + v.yb) / 2 + 4" class="r2-slope-bt">{{ v.fall.toFixed(1) }} m</text>
                  <!-- the run -->
                  <line :x1="v.xa" :y1="v.base + 10" :x2="v.xb" :y2="v.base + 10" class="r2-slope-bracket" />
                  <text :x="(v.xa + v.xb) / 2" :y="v.base + 22" text-anchor="middle" class="r2-slope-bt">{{ v.run.toFixed(1) }} m</text>
                </svg>
                <p class="r2-small">{{ v.words }}</p>
              </figure>
            </div>
            <p class="r2-small">
              The grid gives how steep the ground is, not which way it faces, so each view shows the most it can fall that way - the
              whole slope running in that direction. On a real lot the fall splits between the two; the levels and contours below,
              from the 5 m elevation model, show which way it actually runs.
            </p>

            <h3>How much of the lot is how steep</h3>
            <div class="r2-slopebar" role="img" :aria-label="slope.bands.map((b: any) => `${b.label}: ${Math.round(b.share * 100)}%`).join(', ')">
              <span v-for="b in slope.bands" :key="b.label" class="r2-slopebar-seg" :style="{ flexGrow: b.share, background: b.color }" :title="`${b.label}: ${Math.round(b.share * 100)}% of the lot`">
                <span v-if="b.share >= 0.08">{{ Math.round(b.share * 100) }}%</span>
              </span>
            </div>
            <ul class="r2-slopebar-key">
              <li v-for="b in slope.bands" :key="b.label"><span class="r2-swatch" :style="{ background: b.color }" />{{ b.label }}<span class="r2-muted r2-slopebar-pct">{{ Math.round(b.share * 100) }}%</span></li>
            </ul>

            <p v-if="slope.steepNote" class="r2-warn">{{ slope.steepNote }}</p>
            <p class="r2-foot">
              NSW Spatial Services 5 m slope grid ({{ slope.sheets }}): {{ slope.cells }} cells inside the lot cover {{ slope.coverage }} of it.
              <NuxtLink :to="`/testing-slope?cadid=${cadid}`">How it was measured</NuxtLink>
            </p>
          </template>

          <!-- ground levels from the 5 m elevation model: contours, the fall and its direction, survey marks -->
          <h3>Levels and contours</h3>
          <SlopeTerrain v-if="cadid" :cadid="cadid" />
        </section>

        <!-- ── 3. Locality and council ─────────────────────────────────── -->
        <section id="locality" class="r2-section">
          <h2><span class="r2-num">4</span> Locality and council</h2>
          <p v-if="epiError" class="r2-error">{{ epiError }}</p>
          <p v-else-if="!epi" class="r2-muted">Reading the planning maps…</p>
          <template v-else>
            <dl class="r2-mini r2-mini--wide">
              <div><dt>Council</dt><dd>{{ locality.council || '—' }}</dd></div>
              <div>
                <dt>Local environmental plan</dt>
                <dd>
                  <NuxtLink v-if="locality.lep && docHref(locality.lep)" :to="docHref(locality.lep)!">{{ locality.lep }}</NuxtLink>
                  <template v-else>{{ locality.lep || 'No LEP mapped over this lot' }}</template>
                </dd>
              </div>
              <div><dt>Region</dt><dd>{{ locality.region }}</dd></div>
              <div v-for="g in locality.growth" :key="g.k"><dt>{{ g.k }}</dt><dd>{{ g.v }}</dd></div>
            </dl>
            <h3>State policies mapped over this lot</h3>
            <p v-if="!locality.sepps.length" class="r2-note">None.</p>
            <ul v-else class="r2-chips">
              <li v-for="s in locality.sepps" :key="s">
                <NuxtLink v-if="docHref(s)" :to="docHref(s)!">{{ short(s) }}</NuxtLink>
                <span v-else>{{ short(s) }}</span>
              </li>
            </ul>
            <p class="r2-small">From the land application maps of the EPI layers the lot falls in. Region is the Greater Sydney map of the Transport and Infrastructure SEPP.</p>
          </template>
        </section>

        <!-- ── 3. Risks ────────────────────────────────────────────────── -->
        <section id="risks" class="r2-section">
          <h2><span class="r2-num">5</span> Risks</h2>
          <p v-if="risksError" class="r2-error">{{ risksError }}</p>
          <p v-else-if="!risks" class="r2-muted">Checking bush fire, flood and aircraft noise…</p>
          <div v-else class="r2-risks">
            <article v-for="h in hazards" :key="h.key" class="r2-risk" :class="`r2-risk--${h.status}`">
              <header class="r2-risk-head">
                <p class="r2-risk-title">{{ h.title }}</p>
                <span class="r2-pill">{{ STATUS[h.status] }}</span>
              </header>
              <p class="r2-risk-line">{{ h.headline }}</p>
              <ul v-if="h.rows.length" class="r2-risk-rows">
                <li v-for="(r, i) in h.rows" :key="i">
                  <span class="r2-bar"><span :style="{ width: `${Math.max(2, r.coverPct)}%` }" /></span>
                  <span class="r2-risk-cls">{{ r.label }}</span>
                  <span class="r2-risk-pct">{{ r.coverPct >= 99.5 ? 'whole lot' : `${r.coverPct < 1 ? '<1' : Math.round(r.coverPct)}%` }}</span>
                  <span v-if="r.sub" class="r2-risk-sub">{{ r.sub }}</span>
                </li>
              </ul>
              <p class="r2-risk-mean">{{ h.meaning }}</p>
              <p class="r2-risk-src">{{ h.source }}</p>
            </article>
          </div>
        </section>

        <!-- ── 4. Planning constraints ─────────────────────────────────── -->
        <section id="constraints" class="r2-section">
          <h2><span class="r2-num">6</span> Planning constraints</h2>
          <p v-if="epiError" class="r2-error">{{ epiError }}</p>
          <p v-else-if="!epi" class="r2-muted">Reading the planning maps…</p>
          <template v-else>
            <p class="r2-lead">
              The lot falls in {{ constraintGroups.length }} mapped {{ constraintGroups.length === 1 ? 'layer' : 'layers' }}
              besides the four principal standards<template v-if="partial.length">; {{ partial.length }} {{ partial.length === 1 ? 'covers' : 'cover' }} only part of it</template>.
            </p>

            <h3>Principal development standards</h3>
            <p v-if="stdError" class="r2-error">{{ stdError }}</p>
            <div class="r2-std">
              <div v-for="s in principalStd" :key="s.key" class="r2-std-card" :class="{ 'r2-std-card--none': std && !s.panels.length }">
                <p class="r2-std-title">{{ s.title }}</p>
                <p v-if="!std" class="r2-muted">…</p>
                <template v-else-if="s.panels.length">
                  <div v-for="(pn, i) in s.panels" :key="i" class="r2-std-hit">
                    <p v-if="pn.value" class="r2-std-val">{{ pn.value }}<span v-if="pn.governing === false" class="r2-tag" title="An instrument mapped on the lot that does not govern it">also mapped</span></p>
                    <p v-else class="r2-std-val r2-std-val--clause">Set by {{ pn.clause || 'its clause' }}<span class="r2-td-sub">see the additional controls below</span></p>
                    <p class="r2-std-meta">
                      <span v-if="pn.area" class="r2-tag r2-tag--warn">additional control · {{ pn.area }}</span>
                      <span>{{ pn.coverPct >= 99.5 ? 'whole lot' : `${Math.round(pn.coverPct)}% of the lot` }}</span>
                    </p>
                    <p class="r2-std-meta">
                      <NuxtLink v-if="pn.clause && stdClauseHref(pn)" :to="stdClauseHref(pn)!">{{ pn.clause }}</NuxtLink><span v-else-if="pn.clause">{{ pn.clause }}</span>
                      <span>{{ short(pn.plan) }}</span>
                    </p>
                    <p v-if="s.key !== 'zone' && !pn.area && (pn.label || pn.band)" class="r2-std-meta r2-std-evidence">map {{ [pn.label && `letter ${pn.label}`, pn.band && `band ${pn.band.replace('-', '–')}`].filter(Boolean).join(' · ') }}</p>
                  </div>
                </template>
                <p v-else class="r2-std-val r2-none">{{ s.areas.length ? 'Set by an additional control' : 'Not mapped' }}</p>
                <p v-if="s.areas.length" class="r2-std-more">+ {{ s.areas.join(', ') }}: an additional control applies - see below</p>
              </div>
            </div>

            <h3>Additional controls, permitted uses and local provisions</h3>
            <p v-if="acError" class="r2-error">{{ acError }}</p>
            <p v-else-if="!ac" class="r2-muted">Checking the Additional Controls…</p>
            <p v-else-if="!ac.controls.length" class="r2-note">None - the lot is not in any Additional Controls area on the zoning, FSR, height or lot size maps, nor on the Additional Permitted Uses Map, so the map values above apply as shown.</p>
            <template v-else>
              <p class="r2-small r2-small--tight">
                Areas the LEP maps mark for a clause of their own. The clause, not the map's colour, sets the control here - read it
                with the standard above.
              </p>
              <div v-for="(c, i) in ac.controls" :key="i" class="r2-ac">
                <div class="r2-ac-head">
                  <p class="r2-ac-title">{{ c.control }} <span class="r2-ac-label">{{ c.label }}</span>
                    <span v-if="c.engine" class="r2-tag" :title="c.engine === 'rag' ? 'Quoted from the RAG graph, with what the RAG engine reads in it' : 'Quoted from the library’s plan text; the RAG does not hold this plan yet'">{{ c.engine === 'rag' ? 'RAG' : 'library' }}</span></p>
                  <span class="r2-cover" :class="{ 'r2-cover--part': c.coverPct < 99.5 }">{{ coverText(c.coverPct) }}</span>
                </div>
                <p class="r2-con-meta">
                  <a v-if="c.clauseUrl" :href="c.clauseUrl" target="_blank" rel="noopener" class="r2-cl">{{ c.clause || provLabel(c.clauseUrl.split('#')[1] ?? '') }}</a><span v-else-if="c.clause">{{ c.clause }}</span>
                  <span>{{ c.map }}</span>
                  <span>{{ short(c.plan) }}</span>
                  <span v-if="c.value">{{ c.value }}</span>
                  <span v-if="c.amendment">{{ c.amendment }}</span>
                </p>
                <ul v-if="c.provisions.length" class="r2-ac-provs">
                  <li v-for="pv in c.provisions" :key="pv.localId">
                    <p v-if="pv.stem" class="r2-ac-stem">{{ pv.stem }}</p>
                    <p class="r2-ac-text">{{ pv.text }}</p>
                    <a v-if="pv.url" :href="pv.url" target="_blank" rel="noopener" class="r2-cl r2-ac-link">{{ provLabel(pv.localId) }}</a>
                  </li>
                </ul>
                <p v-else class="r2-small">{{ c.planHeld ? 'No provision in the plan names this area - open the clause to read it.' : 'This plan’s text is not in the library yet, so the clause is cited but not quoted.' }}</p>
                <div v-if="c.engine === 'rag'" class="r2-ac-rag">
                  <p class="r2-ac-rag-h">What the RAG engine reads here
                    <span class="r2-ac-sees" :class="c.ragSeesLot ? 'r2-ac-sees--yes' : 'r2-ac-sees--no'">{{ c.ragSeesLot ? 'its map puts the lot in ' + (c.area || 'this area') : c.ragSeesLot === false ? 'its map does not put the lot in ' + (c.area || 'this area') : '' }}</span></p>
                  <ul class="r2-ac-claims">
                    <li v-for="(k, j) in c.claims" :key="j"><span class="r2-ac-kind" :class="`r2-ac-kind--${k.kind}`">{{ k.kind }}</span> {{ claimWords(k) }} <a :href="(c.clauseUrl || '').split('#')[0] + '#' + k.localId" target="_blank" rel="noopener" class="r2-cl r2-ac-link">{{ provLabel(k.localId) }}</a></li>
                  </ul>
                  <p v-if="!(c.claims || []).some(k => k.kind !== 'frame')" class="r2-small">The RAG knows which land this clause applies to, but holds no rule from it yet - so its answers do not take this control into account.</p>
                </div>
              </div>
            </template>

            <h3>Other mapped constraints</h3>
            <p v-if="!constraintGroups.length" class="r2-note">No other planning layer covers this lot.</p>
            <div v-for="g in constraintGroups" :key="g.key" class="r2-con">
              <div class="r2-con-head">
                <p class="r2-con-title">{{ g.title }}</p>
                <p v-if="g.description" class="r2-con-desc">{{ g.description }}</p>
              </div>
              <ul class="r2-con-rows">
                <li v-for="(h, i) in g.hits" :key="i">
                  <p class="r2-con-val">
                    {{ rowText(g.title, h) }}
                    <span v-if="h.additional" class="r2-tag r2-tag--warn">additional control{{ h.area ? ` · ${h.area}` : '' }}</span>
                    <span v-if="cover(h)" class="r2-cover" :class="{ 'r2-cover--part': (h.coverPct ?? 100) < 99.5 }">{{ cover(h) }}</span>
                  </p>
                  <p class="r2-con-meta">
                    <NuxtLink v-if="clauseHref(h)" :to="clauseHref(h)!">{{ h.clause }}</NuxtLink><span v-else-if="h.clause">{{ h.clause }}</span>
                    <span v-if="h.value">value {{ h.value }}</span>
                    <span>{{ short(h.epiName) }}</span>
                    <span v-if="h.mapName">{{ h.mapName }}</span>
                  </p>
                </li>
              </ul>
            </div>
            <p class="r2-foot">
              Tested against the whole lot polygon (shrunk 10 cm so neighbours that only touch its edge drop out), across
              every EPI layer; {{ epi.hits.length }} map areas matched. Clause links open the instrument where the library holds its text.
              <NuxtLink to="/epi">The EPI map</NuxtLink>
            </p>
          </template>
        </section>
        <!-- ── 5. Low and mid rise housing ─────────────────────────────── -->
        <section id="lmr" class="r2-section">
          <h2><span class="r2-num">7</span> Low and mid rise housing (LMR)</h2>
          <p v-if="lmrError" class="r2-error">{{ lmrError }}</p>
          <p v-else-if="!lmr" class="r2-muted">Checking Housing SEPP Chapter 6…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${lmrVerdict.tone}`">
              <p class="r2-verdict-head">{{ lmrVerdict.head }}</p>
              <p class="r2-verdict-sub">{{ lmrVerdict.sub }}</p>
            </div>

            <h3>Where the chapter does not apply (s 164)</h3>
            <ul class="r2-checks">
              <li v-for="g in lmr.general" :key="g.clause" :class="`r2-check--${checkTone(g.status)}`">
                <span class="r2-dot" />
                <a :href="g.href" target="_blank" rel="noopener" class="r2-cl">s {{ g.clause }}</a>
                <span class="r2-check-text" :title="g.text">{{ g.text.length > 120 ? g.text.slice(0, 118) + '…' : g.text }}</span>
                <span class="r2-check-why">{{ LMR_STATUS[g.status] ?? g.status }}{{ g.status === 'clear' ? '' : ` - ${g.why}` }}</span>
              </li>
            </ul>

            <h3>Housing forms (s 166-180)</h3>
            <table class="r2-table r2-forms">
              <thead><tr><th scope="col">Housing form</th><th scope="col" /><th scope="col">If eligible</th></tr></thead>
              <tbody>
                <tr v-for="f in lmr.types" :key="f.key">
                  <td>{{ f.name }}<span class="r2-td-sub">{{ f.sections }}<template v-if="failed(f).length"> · fails: {{ failed(f).join('; ') }}</template></span></td>
                  <td><span class="r2-gate" :class="f.eligible === true ? 'r2-gate--yes' : f.eligible === false ? 'r2-gate--no' : 'r2-gate--open'">
                    {{ f.eligible === true ? 'Eligible' : f.eligible === false ? 'Not eligible' : 'Undecided' }}</span></td>
                  <td class="r2-td-sub2">{{ f.allowances.map(allowance).join(' | ') || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="r2-small">
              Lot width in these tests is the primary frontage ({{ lmr.lot.widthM != null ? `${lmr.lot.widthM.toFixed(1)} m` : 'none recorded' }}).
              Design standards (setbacks, landscaping, the consent authority's considerations) are not tested here.
              <NuxtLink to="/lmr">The LMR map</NuxtLink>
            </p>
          </template>
        </section>

        <!-- ── 7. Subdivision ──────────────────────────────────────────── -->
        <section id="subdivision" class="r2-section">
          <h2><span class="r2-num">8</span> Subdivision</h2>
          <p v-if="subError" class="r2-error">{{ subError }}</p>
          <p v-else-if="!sub" class="r2-muted">Working out whether the lot can be subdivided…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${subVerdict.tone}`">
              <p class="r2-verdict-head">{{ subVerdict.head }}</p>
              <p class="r2-verdict-sub">{{ subVerdict.sub }}</p>
            </div>

            <p v-if="sizeCheck" class="r2-small">{{ sizeCheck }}</p>

            <div class="r2-gridwrap">
              <table class="r2-grid">
                <thead>
                  <tr>
                    <th scope="col" class="r2-grid-corner">
                      <span class="r2-grid-axis">What the new lots are for &darr;</span>
                      <span class="r2-grid-axis">How the land is divided &rarr;</span>
                    </th>
                    <th v-for="tt in TITLE_TYPES" :key="tt.key" scope="col">
                      {{ tt.label }}<span class="r2-grid-means">{{ tt.means }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in subGrid" :key="row.use">
                    <th scope="row">{{ row.label }}<span class="r2-grid-means">{{ row.means }}</span></th>
                    <td v-for="cell in row.cells" :key="cell.key">
                      <button
                        type="button" class="r2-grid-cell" :class="[`r2-grid-cell--${cell.tone}`, { 'r2-grid-cell--on': isOpenCell(row.use, cell.key) }]"
                        :aria-pressed="isOpenCell(row.use, cell.key)" @click="subCell = { use: row.use, tenure: cell.key }"
                      >{{ cell.answer }}</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="r2-small">Click an answer to see why.</p>

            <article v-if="openCell" class="r2-tenure r2-cellwhy" :class="`r2-tenure--${openCell.cell.tone}`">
              <header class="r2-risk-head">
                <p class="r2-risk-title">{{ openCell.row.label }} &middot; {{ openCell.cell.label }}</p>
                <span class="r2-gate" :class="`r2-gate--${openCell.cell.tone}`">{{ openCell.cell.answer }}</span>
              </header>
              <p v-for="(c, i) in openCell.cell.controlling" :key="i" class="r2-ten-line">
                <a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="r2-cl">{{ c.text }}</a><span v-else>{{ c.text }}</span>
              </p>
              <p v-for="(l, i) in openCell.cell.limits" :key="`l${i}`" class="r2-ten-limit"><LinkText :text="l" :provs="subProvs" /></p>
              <template v-if="openCell.cell.branches.length">
                <p class="r2-ten-h">It turns on</p>
                <ul class="r2-ten-list r2-ten-branches">
                  <li v-for="(b, i) in openCell.cell.branches" :key="i" :class="`r2-br--${b.tone}`"><b><LinkText :text="b.if" :provs="subProvs" /></b> - <LinkText :text="b.then" :provs="subProvs" /></li>
                </ul>
              </template>
              <template v-if="openCell.cell.depends.length">
                <p class="r2-ten-h">Depends on</p>
                <ul class="r2-ten-list"><li v-for="(d, i) in openCell.cell.depends" :key="i"><LinkText :text="d" :provs="subProvs" /></li></ul>
              </template>
              <template v-if="openCell.cell.steps.length">
                <p class="r2-ten-h">How the clauses were weighed</p>
                <ul class="r2-ten-list"><li v-for="(st, i) in openCell.cell.steps" :key="i"><LinkText :text="st" :provs="subProvs" /></li></ul>
              </template>
              <template v-if="openCell.cell.tested.length">
                <p class="r2-ten-h">Clauses tested</p>
                <ul class="r2-ten-list r2-tested">
                  <li v-for="(c, i) in openCell.cell.tested" :key="i" :class="`r2-tested--${c.tone}`">
                    <a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="r2-cl">{{ c.label }}</a><span v-else>{{ c.label }}</span>
                    <span class="r2-tested-st">{{ c.status }}</span>
                    <span v-if="c.why" class="r2-tested-why"><LinkText :text="c.why" :provs="subProvs" /></span>
                  </li>
                </ul>
              </template>
            </article>

            <template v-if="sub.engine === 'rag' && subChecks.length">
              <h3>What the engine tested on the lot</h3>
              <ul class="r2-checks">
                <li v-for="(c, i) in subChecks" :key="i" :class="`r2-check--${c.result === true ? (c.bad ? 'no' : 'yes') : c.result === false ? (c.bad ? 'yes' : 'no') : 'open'}`">
                  <span class="r2-dot" /><span class="r2-cl">{{ c.result === true ? 'yes' : c.result === false ? 'no' : 'unknown' }}</span>
                  <span class="r2-check-text"><LinkText :text="c.text" :provs="subProvs" /></span><span class="r2-check-why">{{ c.how }}</span>
                </li>
              </ul>
            </template>
            <details v-if="sub.engine === 'rag' && Object.keys(sub.provisions).length" class="r2-provs">
              <summary>The words of the {{ Object.keys(sub.provisions).length }} provisions these answers rest on</summary>
              <div v-for="(pv, id) in sub.provisions" :key="id" class="r2-prov">
                <p><a v-if="pv.url" :href="pv.url" target="_blank" rel="noopener" class="r2-cl">{{ pv.label }}</a><template v-else>{{ pv.label }}</template><template v-if="pv.heading"> - {{ pv.heading }}</template></p>
                <p v-if="pv.stem" class="r2-prov-stem">{{ pv.stem }}</p>
                <p class="r2-prov-text">{{ pv.text }}</p>
              </div>
            </details>
            <p class="r2-foot">
              <template v-if="sub.engine === 'rag'">
                Answered by the RAG engine - deterministic, no model: it tests every claim the graph holds on subdivision
                against this lot - {{ sub.plan }} and the Housing SEPP 2021 - and resolves them by the plans' own precedence. Two lots.
                The Housing SEPP's own minimums (s 169 dual occupancy, s 173 terraces) reach only a lot in a low and mid rise housing area.
                {{ subAsAt }} <NuxtLink to="/rag">The RAG question bank</NuxtLink>
              </template>
              <template v-else>
                {{ sub.reason }} Answered instead by the norms engine (the clause reader's subdivision norms for this LEP and the
                SEPPs), for two lots. "Maybe" means it depends on facts about the site or the proposal that no dataset records.
              </template>
            </p>
          </template>
        </section>
        <!-- ── 8. Housing land uses: what CDC and the Pattern Book need, answered by the RAG engine ── -->
        <section id="land-uses" class="r2-section">
          <h2><span class="r2-num">9</span> Housing land uses</h2>
          <p class="r2-lead">
            Every complying development certificate and every Pattern Book design - and build-to-rent and the affordable housing bonus - needs its land use to be
            <b>permissible with consent</b> on the lot (Codes SEPP cl 1.18(1)(b); Housing SEPP s 183(1)(a) for the mid rise
            designs). Permitted <i>without</i> consent does not count. This checks each of those uses against the LEP and the
            SEPPs together.
          </p>
          <p v-if="usesError" class="r2-error">{{ usesError }}</p>
          <p v-else-if="!uses" class="r2-muted">Asking the RAG engine about each housing land use…</p>
          <template v-else-if="uses.engine === 'none'">
            <p class="r2-note">{{ uses.reason }} The housing land use answers come from the RAG engine, which does not hold this lot's plan yet.</p>
          </template>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${usesVerdict.tone}`">
              <p class="r2-verdict-head">{{ usesVerdict.head }}</p>
              <p class="r2-verdict-sub">{{ usesVerdict.sub }}</p>
            </div>

            <h3>The land uses, one by one</h3>
            <table class="r2-table r2-uses">
              <thead><tr><th scope="col">Land use</th><th scope="col">On this lot</th><th scope="col">Rests on</th><th scope="col" /></tr></thead>
              <tbody>
                <template v-for="u in uses.uses" :key="u.use">
                  <tr :class="{ 'r2-uses-open': openUse === u.use }">
                    <td>{{ cap(u.use) }}<span class="r2-td-sub">needed by {{ u.neededBy.map(nb => nb.replace(/^(CDC|Pattern Book): /, '')).join(', ') }}</span></td>
                    <td><span class="r2-gate" :class="`r2-gate--${meetTone(u.meets)}`">{{ useLabel(u) }}</span></td>
                    <td class="r2-td-sub2">{{ u.by.map(b => b.label).join('; ') || 'no clause in the graph names it' }}<span v-for="x in notReaching(u)" :key="x.provision_id" class="r2-td-sub" :title="x.because.map(b => b.how || b.text).join('\n')">{{ reachNote(x) }}</span></td>
                    <td><button type="button" class="r2-trace-btn" @click="toggleUse(u.use)">{{ openUse === u.use ? 'Hide trace' : 'Trace' }}</button></td>
                  </tr>
                  <tr v-if="openUse === u.use"><td colspan="4" class="r2-trace-cell"><UseTrace /></td></tr>
                </template>
              </tbody>
            </table>

            <p class="r2-small">
              This is only the land use test. What it means for each complying development type and Pattern Book design -
              with every other clause they turn on - is in sections 10 to 13.
            </p>

            <details class="r2-more2">
              <summary>Every other use the plan names for Zone {{ uses.zone }} ({{ uses.others.length }})</summary>
              <div v-for="g in otherGroups" :key="g.key" class="r2-usegroup">
                <p class="r2-usegroup-h"><span class="r2-gate" :class="`r2-gate--${g.tone}`">{{ g.title }}</span> <span class="r2-muted">{{ g.items.length }}</span></p>
                <ul class="r2-usechips">
                  <li v-for="u in g.items" :key="u.use">
                    <button type="button" class="r2-usechip" :class="{ 'r2-usechip--on': openUse === u.use }" :title="u.by.map(b => b.label).join('; ')" @click="toggleUse(u.use)">{{ cap(u.use) }}</button>
                  </li>
                </ul>
                <div v-if="openUse && g.items.some(u => u.use === openUse)" class="r2-trace-cell"><UseTrace /></div>
              </div>
            </details>

            <p class="r2-foot">
              Answered by the RAG engine - deterministic, no model - over {{ uses.plan }} and the Housing SEPP 2021.
              Each answer tests every permit and prohibit claim the graph holds for the use against this lot, then resolves them
              by the plans' own precedence; "Trace" shows every claim, every step and the words of every provision. The uses are
              read from the CDC catalogue and the Pattern Book designs, so they match /cdc and /pattern-book. {{ usesAsAt }}
              <NuxtLink to="/rag">The RAG question bank</NuxtLink>
            </p>
          </template>
        </section>
        <!-- ── 9. Complying development types ──────────────────────────── -->
        <section id="cdc" class="r2-section">
          <h2><span class="r2-num">10</span> Complying development (CDC)</h2>
          <p v-if="cdcTypesError" class="r2-error">{{ cdcTypesError }}</p>
          <p v-else-if="!cdcTypes" class="r2-muted">Checking every complying development type…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${cdcTypeVerdict.tone}`">
              <p class="r2-verdict-head">{{ cdcTypeVerdict.head }}</p>
              <p class="r2-verdict-sub">{{ cdcTypeVerdict.sub }}</p>
            </div>
            <p class="r2-small">
              General prerequisites (cl 1.17A-1.19A, Schedule 5):
              <template v-if="cdcTypes.generalBlockers.length"><b>{{ cdcTypes.generalBlockers.map((b: any) => b.title ?? b).join(', ') }}</b> - see the supporting checks at the end.</template>
              <template v-else>nothing on the lot rules out every code (supporting checks at the end).</template>
            </p>

            <details v-for="ty in cdcTypeRows" :key="ty.key" class="r2-elig">
              <summary>
                <span class="r2-elig-name">{{ ty.name }}<span class="r2-td-sub">{{ ty.code }}</span></span>
                <span class="r2-gate" :class="`r2-gate--${ty.tone}`">{{ ty.label }}</span>
                <span class="r2-elig-why">{{ ty.why }}</span>
              </summary>
              <ul class="r2-elig-checks">
                <li v-for="(c, i) in ty.checks" :key="i" :class="`r2-check--${c.pass === true ? 'yes' : c.pass === false ? 'no' : 'open'}`">
                  <span class="r2-dot" />
                  <span class="r2-elig-cl"><a v-if="c.url" :href="c.url" target="_blank" rel="noopener" class="r2-cl">{{ c.clause }}</a><template v-else>{{ c.clause || '—' }}</template></span>
                  <span>{{ c.says }}<span v-if="c.rag" class="r2-tag">RAG</span></span>
                  <span class="r2-elig-actual">
                    {{ c.actual }}
                    <button v-if="c.ragUse" type="button" class="r2-linkbtn" @click="toggleUse(c.ragUse)">trace</button>
                    <span v-if="c.differs" class="r2-td-sub">{{ c.differs }}</span>
                  </span>
                </li>
              </ul>
              <div v-if="openUse && ty.checks.some((c: any) => c.ragUse === openUse)" class="r2-trace-cell"><UseTrace /></div>
              <p v-if="ty.untested.length" class="r2-small">Not tested here: {{ ty.untested.join('; ') }}.</p>
            </details>
            <p class="r2-foot">
              The checks are the CDC catalogue's (/api/cdc/types, the same as /cdc); the land use check (cl 1.18(1)(b)) is the RAG
              engine's answer from section 9, which reads the SEPPs as well as the Land Use Table. <NuxtLink to="/cdc">The CDC page</NuxtLink>
            </p>
          </template>
        </section>


        <!-- ── 9. Build-to-rent ── -->
        <section id="build-to-rent" class="r2-section">
          <h2><span class="r2-num">11</span> Build-to-rent</h2>
          <p v-if="housingError" class="r2-error">{{ housingError }}</p>
          <p v-else-if="!housing" class="r2-muted">Checking the Housing SEPP…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${btrView.tone}`">
              <p class="r2-verdict-head">{{ btrView.headline }}</p>
              <p class="r2-verdict-sub">{{ btrView.sub }}</p>
            </div>

            <h3>{{ btrView.limbsTitle }}</h3>
            <ul class="r2-elig-checks">
              <li v-for="(l, i) in btrView.limbs" :key="i" :class="`r2-check--${l.informational ? 'info' : l.pass === true ? 'yes' : l.pass === false ? 'no' : 'open'}`">
                <span class="r2-dot" />
                <span class="r2-elig-cl"><a :href="housingClauseUrl(l.clause)" target="_blank" rel="noopener" class="r2-cl">s {{ l.clause }}</a></span>
                <span>{{ l.label }}<span v-if="l.rag" class="r2-tag">RAG</span><span v-if="l.informational" class="r2-tag">not decidable from data</span></span>
                <span class="r2-elig-actual">
                  {{ l.why }}
                  <button v-if="l.ragUse" type="button" class="r2-linkbtn" @click="toggleUse(l.ragUse)">trace</button>
                  <span v-if="l.differs" class="r2-td-sub">{{ l.differs }}</span>
                </span>
              </li>
            </ul>
            <div v-if="openUse && btrView.limbs.some((l: any) => l.ragUse === openUse)" class="r2-trace-cell"><UseTrace /></div>

            <template v-if="btrView.exclusions.length">
              <h3>Land it does not apply to</h3>
              <ul class="r2-elig-checks">
                <li v-for="(l, i) in btrView.exclusions" :key="i" :class="`r2-check--${l.pass === true ? 'no' : l.pass === false ? 'yes' : 'open'}`">
                  <span class="r2-dot" />
                  <span class="r2-elig-cl"><a :href="housingClauseUrl(l.clause)" target="_blank" rel="noopener" class="r2-cl">s {{ l.clause }}</a></span>
                  <span>{{ l.label }}</span>
                  <span class="r2-elig-actual">{{ l.why }}</span>
                </li>
              </ul>
            </template>

            <template v-if="btrView.allowances.length">
              <h3>What it allows</h3>
              <dl class="r2-mini">
                <div v-for="(a, i) in btrView.allowances" :key="i"><dt>{{ a.label }} <a :href="housingClauseUrl(a.clause)" target="_blank" rel="noopener" class="r2-cl">s {{ a.clause }}</a></dt><dd>{{ a.value }}</dd></div>
              </dl>
            </template>

            <template v-if="btrView.flags.length">
              <h3>Conditions on the proposal</h3>
              <ul class="r2-ten-list r2-flags"><li v-for="(f, i) in btrView.flags" :key="i">{{ f }}</li></ul>
            </template>
            <p class="r2-foot">
              The limbs are the Housing SEPP check /build-to-rent and /affordable-housing read (/api/housing/at); the land use limb is
              the RAG engine's answer from section 9, which reads the SEPPs as well as the Land Use Table.
              <NuxtLink :to="'/build-to-rent'">The build-to-rent page</NuxtLink>
            </p>
          </template>
        </section>
        <!-- ── 10. Affordable housing bonus ── -->
        <section id="affordable-housing" class="r2-section">
          <h2><span class="r2-num">12</span> Affordable housing bonus</h2>
          <p v-if="housingError" class="r2-error">{{ housingError }}</p>
          <p v-else-if="!housing" class="r2-muted">Checking the Housing SEPP…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${ahbView.tone}`">
              <p class="r2-verdict-head">{{ ahbView.headline }}</p>
              <p class="r2-verdict-sub">{{ ahbView.sub }}</p>
            </div>

            <h3>{{ ahbView.limbsTitle }}</h3>
            <ul class="r2-elig-checks">
              <li v-for="(l, i) in ahbView.limbs" :key="i" :class="`r2-check--${l.informational ? 'info' : l.pass === true ? 'yes' : l.pass === false ? 'no' : 'open'}`">
                <span class="r2-dot" />
                <span class="r2-elig-cl"><a :href="housingClauseUrl(l.clause)" target="_blank" rel="noopener" class="r2-cl">s {{ l.clause }}</a></span>
                <span>{{ l.label }}<span v-if="l.rag" class="r2-tag">RAG</span><span v-if="l.informational" class="r2-tag">not decidable from data</span></span>
                <span class="r2-elig-actual">
                  {{ l.why }}
                  <button v-if="l.ragUse" type="button" class="r2-linkbtn" @click="toggleUse(l.ragUse)">trace</button>
                  <span v-if="l.differs" class="r2-td-sub">{{ l.differs }}</span>
                </span>
              </li>
            </ul>
            <div v-if="openUse && ahbView.limbs.some((l: any) => l.ragUse === openUse)" class="r2-trace-cell"><UseTrace /></div>

            <template v-if="ahbView.exclusions.length">
              <h3>Land it does not apply to</h3>
              <ul class="r2-elig-checks">
                <li v-for="(l, i) in ahbView.exclusions" :key="i" :class="`r2-check--${l.pass === true ? 'no' : l.pass === false ? 'yes' : 'open'}`">
                  <span class="r2-dot" />
                  <span class="r2-elig-cl"><a :href="housingClauseUrl(l.clause)" target="_blank" rel="noopener" class="r2-cl">s {{ l.clause }}</a></span>
                  <span>{{ l.label }}</span>
                  <span class="r2-elig-actual">{{ l.why }}</span>
                </li>
              </ul>
            </template>

            <template v-if="ahbView.allowances.length">
              <h3>What it allows</h3>
              <dl class="r2-mini">
                <div v-for="(a, i) in ahbView.allowances" :key="i"><dt>{{ a.label }} <a :href="housingClauseUrl(a.clause)" target="_blank" rel="noopener" class="r2-cl">s {{ a.clause }}</a></dt><dd>{{ a.value }}</dd></div>
              </dl>
            </template>

            <template v-if="ahbView.flags.length">
              <h3>Conditions on the proposal</h3>
              <ul class="r2-ten-list r2-flags"><li v-for="(f, i) in ahbView.flags" :key="i">{{ f }}</li></ul>
            </template>
            <p class="r2-foot">
              The limbs are the Housing SEPP check /build-to-rent and /affordable-housing read (/api/housing/at); the land use limb is
              the RAG engine's answer from section 9, which reads the SEPPs as well as the Land Use Table.
              <NuxtLink :to="'/affordable-housing'">The affordable housing page</NuxtLink>
            </p>
          </template>
        </section>

        <!-- ── 11. Pattern Book ─────────────────────────────────────────── -->
        <section id="pattern-book" class="r2-section">
          <h2><span class="r2-num">13</span> Pattern Book</h2>
          <p v-if="pbError" class="r2-error">{{ pbError }}</p>
          <p v-else-if="!pb" class="r2-muted">Checking every Pattern Book design…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${pbVerdict.tone}`">
              <p class="r2-verdict-head">{{ pbVerdict.head }}</p>
              <p class="r2-verdict-sub">{{ pbVerdict.sub }}</p>
            </div>

            <details v-for="cat in pbRows" :key="cat.category" class="r2-elig">
              <summary>
                <span class="r2-elig-name">{{ cat.category }}<span class="r2-td-sub">{{ cat.designs.length }} design{{ cat.designs.length === 1 ? '' : 's' }} · {{ cat.pathway === 'da' ? 'development application (Housing SEPP Ch 7)' : 'complying development (Codes SEPP Part 3BA)' }}</span></span>
                <span class="r2-gate" :class="`r2-gate--${cat.tone}`">{{ cat.label }}</span>
                <span class="r2-elig-why">{{ cat.why }}</span>
              </summary>
              <p class="r2-ten-h">The clauses every design in this category turns on</p>
              <ul class="r2-elig-checks">
                <li v-for="(g, i) in cat.gates" :key="i" :class="`r2-check--${g.pass === true ? 'yes' : g.pass === false ? 'no' : 'open'}`">
                  <span class="r2-dot" />
                  <span class="r2-elig-cl"><a v-if="g.url" :href="g.url" target="_blank" rel="noopener" class="r2-cl">{{ g.clause }}</a><template v-else>{{ g.clause }}</template></span>
                  <span>{{ g.what }}<span v-if="g.rag" class="r2-tag">RAG</span></span>
                  <span class="r2-elig-actual">
                    {{ g.why }}
                    <button v-if="g.ragUse" type="button" class="r2-linkbtn" @click="toggleUse(g.ragUse)">trace</button>
                    <span v-if="g.differs" class="r2-td-sub">{{ g.differs }}</span>
                  </span>
                </li>
              </ul>
              <div v-if="openUse && cat.gates.some((g: any) => g.ragUse === openUse)" class="r2-trace-cell"><UseTrace /></div>
              <p class="r2-ten-h">Each design</p>
              <div v-for="d in cat.designs" :key="d.key" class="r2-pbdesign">
                <p class="r2-pbdesign-head">
                  <span class="r2-gate" :class="`r2-gate--${d.tone}`">{{ d.label }}</span>
                  <b>{{ d.name }}</b> <span class="r2-muted">{{ d.designer }}</span>
                </p>
                <p class="r2-small">{{ d.headline }}</p>
                <ul class="r2-pbblocks">
                  <li v-for="(b, i) in d.blocks" :key="i" :class="{ 'r2-pbblock--gov': b.governs }">
                    <span class="r2-pbblock-name">{{ b.block }}{{ b.governs ? ' (applies to this lot)' : '' }}</span>
                    <span v-for="(c, j) in b.checks" :key="j" class="r2-pbcheck" :class="c.pass === false ? 'r2-pbcheck--no' : c.pass === true ? 'r2-pbcheck--yes' : ''">
                      {{ c.label }}: {{ fmtNum(c.actual) }}{{ c.unit ? ` ${c.unit}` : '' }} vs {{ fmtNum(c.required) }}{{ c.unit ? ` ${c.unit}` : '' }}{{ c.estimate ? ' (est.)' : '' }}
                    </span>
                  </li>
                </ul>
                <p v-if="d.outstanding.length" class="r2-small">Still to confirm: {{ d.outstanding.join('; ') }}.</p>
              </div>
            </details>
            <p class="r2-foot">
              The gates and design requirements are the Pattern Book check's (/api/pattern-book/at, the same as /pattern-book); the
              land use gate (cl 1.18(1)(b), or s 183(1)(a) for the apartments) is the RAG engine's answer from section 9.
              <NuxtLink to="/pattern-book">The Pattern Book page</NuxtLink>
            </p>
          </template>
        </section>

        <!-- ── 14. What can I build: pick a use, get every control on it (/api/report/build-controls, components/BuildControls.vue) ── -->
        <section id="standards-stack" class="r2-section">
          <h2><span class="r2-num">14</span> What can I build</h2>
          <p class="r2-lead">
            Choose what you want to build. The list says what the zone allows; for the one you pick, every development control
            on this lot - resolved by the RAG engine across the LEP and the SEPPs, with the clause that sets it.
          </p>
          <BuildControls :cadid="cadid" :select="buildPick" @trace="openStackTrace" @use="(u: { use: string; label: string }) => { sitingType = u.use; sitingLabel = u.label; sitingTrace = null }" />
        </section>

        <!-- ── 15. Siting: put a building on the lot and move it (/api/report/siting, components/SitingStudio.vue) ── -->
        <section id="build" class="r2-section">
          <h2><span class="r2-num">15</span> Siting</h2>
          <p class="r2-lead">
            Whatever is chosen in “What can I build” is placed here: fitted inside the setbacks and sized to the floor area the
            plans allow that use. Drag it, resize it or change its storeys and every control is measured again as you go, in plan and in 3D.
            Click a clause to see how the RAG engine reached the figure.
          </p>
          <SitingStudio :cadid="cadid" :use="sitingType" :label="sitingLabel" @trace="openSitingTrace" />
        </section>

        <!-- ── 16. The council's DCP, as controls (components/DcpControls.vue, /api/report/dcp-controls) ── -->
        <section id="dcp" class="r2-section">
          <h2><span class="r2-num">16</span> Council controls (DCP)</h2>
          <p class="r2-lead">
            Every measurable control the council's Development Control Plan states for this lot, read from the plan itself
            and grouped by what it measures. These are guidance, not standards: where one conflicts with the LEP above it,
            the LEP governs. Each figure shows the words it was read from.
          </p>
          <DcpControls :cadid="cadid" :use="sitingType" />
        </section>

        <!-- ── Reference: the Land Use Table as written and resolved, unnumbered and closed ──────────── -->
        <details id="land-use-table" class="r2-section r2-support">
          <summary class="r2-support-summary">
            <span class="r2-support-kicker">Reference</span>
            The Land Use Table{{ lutZones.length ? ` - ${lutZones.map(z => `${z.code}, ${short(z.plan)}`).join('; ')}` : '' }}
            <span class="r2-support-hint">As written in the plan, how it becomes the resolved list, and resolved against the Standard Instrument</span>
          </summary>
          <p v-if="!epi" class="r2-muted">Waiting for the zoning sweep…</p>
          <p v-else-if="!lutZones.length" class="r2-note">No land zoning layer covers this lot, so there is no Land Use Table to resolve.</p>
          <div v-for="z in lutZones" :key="z.code + z.plan" class="r2-lut">
            <p class="r2-lut-head">
              <b>Zone {{ z.code }}</b> {{ z.className }} <span class="r2-muted">· {{ z.plan }} · {{ z.coverPct >= 99.5 ? 'the whole lot' : `${Math.round(z.coverPct)}% of the lot` }}</span>
            </p>
            <ZonePermissibility v-if="z.detail" :detail="z.detail" />
            <p v-else-if="z.error" class="r2-note">{{ z.error }}</p>
            <p v-else class="r2-muted">Resolving the Land Use Table…</p>
          </div>
          <p class="r2-foot">
            The zone and plan are the zoning polygon the lot sits in (section 6); the table is the plan's own (/api/lep-permissibility,
            the same as /permissibility). This is the Land Use Table alone - the SEPPs can change the answer, as section 9 shows.
          </p>
        </details>

        <!-- ── Supporting checks: CDC land exclusions and ESA, unnumbered and closed ─────────────── -->
        <details id="cdc-exclusions" class="r2-section r2-support">
          <summary class="r2-support-summary">
            <span class="r2-support-kicker">Supporting checks</span>
            Complying development land exclusions and environmentally sensitive areas
            <span class="r2-support-hint">The land tests sections 10 and 13 rely on - open to see them</span>
          </summary>
          <p v-if="cdcError" class="r2-error">{{ cdcError }}</p>
          <p v-else-if="!cdc" class="r2-muted">Checking the complying development land tests…</p>
          <template v-else>
            <div class="r2-verdict" :class="`r2-verdict--${cdcVerdict.tone}`">
              <p class="r2-verdict-head">{{ cdcVerdict.head }}</p>
              <p class="r2-verdict-sub">{{ cdcVerdict.sub }}</p>
            </div>

            <template v-for="g in cdcGroups" :key="g.key">
              <h3>{{ g.title }}</h3>
              <p class="r2-small r2-small--tight">{{ g.note }}</p>
              <ul class="r2-hits">
                <li v-for="h in g.hits" :key="h.key">
                  <p class="r2-hit-title">{{ h.title }} <span class="r2-cover" :class="{ 'r2-cover--part': h.coverPct < 99.5 }">{{ coverText(h.coverPct) }}</span></p>
                  <p class="r2-hit-meta">
                    <span v-if="h.clauses.length">cl {{ h.clauses.join(', ') }}</span>
                    <span v-if="h.names.length">{{ h.names.slice(0, 3).join('; ') }}</span>
                  </p>
                </li>
              </ul>
            </template>

            <h3>Environmentally sensitive area (cl 1.17A(1)(e))</h3>
            <p class="r2-small r2-small--tight">
              Complying development cannot be carried out on an environmentally sensitive area of State significance. The items are
              the ones LEP clause 3.3(2) lists; a local plan may add its own.
            </p>
            <p v-if="esaError" class="r2-error">{{ esaError }}</p>
            <p v-else-if="!esa" class="r2-muted">Checking…</p>
            <template v-else>
              <ul v-if="esaHits.length" class="r2-hits">
                <li v-for="h in esaHits" :key="h.key">
                  <p class="r2-hit-title">
                    {{ h.item }}
                    <span v-if="h.half === 'addition'" class="r2-tag r2-tag--warn">{{ h.coverageType === 'advisory' ? 'plan addition - advisory, check by hand' : 'plan addition' }}</span>
                    <span class="r2-cover" :class="{ 'r2-cover--part': h.coverPct < 99.5 }">{{ coverText(h.coverPct) }}</span>
                  </p>
                  <p class="r2-hit-meta">
                    <span v-if="h.clause">{{ h.clause }}</span>
                    <span v-if="h.names.length">{{ h.names.slice(0, 3).join('; ') }}</span>
                    <span v-if="h.planRef">{{ h.planRef }}</span>
                  </p>
                  <p v-if="h.exceptionText" class="r2-hit-meta">{{ h.exceptionText }}</p>
                </li>
              </ul>
              <p v-else class="r2-note">None of the {{ esa.summary.tested }} state-wide items tested covers this lot.</p>
            </template>

            <template v-if="untestable.length">
              <h3>Not testable here</h3>
              <p class="r2-small r2-small--tight">No dataset is held for these, so the lot cannot be cleared against them - check them by hand.</p>
              <ul class="r2-chips r2-chips--grey"><li v-for="u in untestable" :key="u">{{ u }}</li></ul>
            </template>
            <p class="r2-foot">
              Tested against the whole lot polygon: {{ cdc.verdict.tested }} complying development layers and
              {{ esa?.summary.tested ?? '—' }} environmentally sensitive area layers.
              <NuxtLink to="/cdc-map">The CDC map</NuxtLink> · <NuxtLink to="/esa">The ESA map</NuxtLink>
            </p>
          </template>
        </details>

      </template>
    </main>
    </div>

    <!-- How the engine reached a figure: one sheet for "What can I build" and Siting alike. Its content sits in a bare .r2 so
         the trace keeps the page's own trace styles, which are written against .r2. -->
    <Sheet :open="!!sheetTrace" @update:open="(o: boolean) => { if (!o) { stackTrace = null; sitingTrace = null } }">
      <SheetContent side="right" class="w-full gap-0 overflow-y-auto sm:max-w-[600px]">
        <SheetHeader class="border-b">
          <SheetTitle>{{ sheetTitle }}</SheetTitle>
          <SheetDescription>How the RAG engine reached it on this lot, clause by clause.</SheetDescription>
        </SheetHeader>
        <div class="r2 r2--sheet px-4 py-4">
          <p v-if="sheetTrace?.error" class="r2-error">{{ sheetTrace.error }}</p>
          <div v-else-if="!sheetTrace?.d" class="flex flex-col gap-2"><Skeleton class="h-6 w-2/3" /><Skeleton class="h-24 w-full" /><Skeleton class="h-24 w-full" /></div>
          <TraceView v-else :d="sheetTrace.d" />
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>

<script setup lang="ts">
import { epiDescription, epiTitle } from '#shared/epi-layers'
import { LOT_FIELD_DOCS } from '#shared/lot-field-docs'
import type { EpiAtResponse, EpiHit } from '../../server/api/epi/at.get'
import type { RiskRow, RisksResponse } from '../../server/api/report/risks.get'
import type { LmrTypesResponse } from '../../server/api/lmr/types.get'
import type { CdcAtResponse, CdcHit } from '../../server/api/cdc/at.get'
import type { EsaAtResponse } from '../../server/api/esa/at.get'
import type { ReportSubdivisionResponse } from '../../server/api/report/subdivision.get'
import type { Requirement, ReportUsesResponse, UseDetail, UseSummary } from '../../server/api/report/uses.get'
import type { CdcRequirement } from '../../server/api/report/cdc-requirements.get'
import type { HousingAtResponse } from '../../server/api/housing/at.get'
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ZoneDetail } from '#shared/lep-permissibility'
import type { AcClaim, AdditionalControl } from '../../server/api/report/additional-controls.get'
import type { StandardPanel, StandardsResponse } from '../../server/api/report/standards.get'
import type { SitingTrace } from '../../server/api/report/siting.get'

useHead({ title: 'Site report · Planning Library' })

interface Match { cadid: string; lotId: string | null; titleLot: string | null; msoid: number | null; address: string | null; lgaName: string | null }
interface Run { seq: number; road: string | null; isPrimary: boolean; lengthM: number | null; edges: number[]; line: [number, number][] }
interface Access { wayLon: number; wayLat: number; proway: [number, number][]; accessM: number | null; sharedBy: number; wayRoad: string | null; wayRoadM: number | null }
interface Detail {
  lot: Record<string, any> | null
  addresses: Record<string, any>[]
  shape: { ring: [number, number][]; runs: Run[] } | null
  points?: { msoid: number | null; address: string | null; lon: number; lat: number }[]
  access?: Access[]
  lotGeom?: Record<string, unknown> | null
  neighbours?: Record<string, unknown>[]
}

/** LotSketch's run colours, in run order, so a street is the same colour in the table and the drawing. */
const RUN_COLOURS = ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#a855f7']

const route = useRoute()
const router = useRouter()

// ── Search (the /api/lotprofile search /testing-spatial-services uses) ────
const q = ref('')
const results = ref<Match[]>([])
const listOpen = ref(false)
const highlight = ref(0)
const searching = ref(false)
const searchError = ref('')
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: AbortController | null = null

async function runSearch() {
  const term = q.value.trim()
  if (term.length < 3) { results.value = []; listOpen.value = false; return }
  inflight?.abort()
  const ctrl = new AbortController()
  inflight = ctrl
  searching.value = true
  searchError.value = ''
  try {
    const r = await $fetch<{ results: Match[] }>('/api/lotprofile', { query: { q: term }, signal: ctrl.signal })
    if (ctrl.signal.aborted) return
    results.value = r.results
    highlight.value = 0
    listOpen.value = r.results.length > 0
  } catch (e: any) {
    if (ctrl.signal.aborted) return
    searchError.value = e?.data?.message || e?.message || 'The search failed.'
  } finally {
    if (inflight === ctrl) { searching.value = false; inflight = null }
  }
}
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
  void open(r.cadid, r.msoid)
}
function pickHighlighted() {
  if (debounce) { clearTimeout(debounce); debounce = null }
  if (listOpen.value && results.value[highlight.value]) pick(results.value[highlight.value]!)
  else void runSearch()
}

// ── The lot ───────────────────────────────────────────────────────────────
const cadid = ref('')
const msoid = ref<number | null>(null)
const detail = ref<Detail | null>(null)
const loading = ref(false)
const detailError = ref('')

async function open(id: string, mso: number | null = null) {
  cadid.value = id
  msoid.value = mso
  void router.replace({ query: { cadid: id, ...(mso == null ? {} : { msoid: String(mso) }) } })
  loading.value = true
  detailError.value = ''
  try {
    void loadEpi(id)
    void loadAc(id)
    void loadStd(id)
    void loadSlope(id)
    void loadRisks(id)
    void loadLmr(id)
    void loadCdc(id)
    void loadSub(id)
    void loadUses(id)
    void loadCdcPb(id)
    void loadHousing(id)
    detail.value = await $fetch<Detail>('/api/lotprofile', { query: { cadid: id } })
  } catch (e: any) {
    detailError.value = e?.data?.message || e?.message || 'Could not load that lot.'
    detail.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  const id = String(route.query.cadid ?? '').trim()
  const mso = Number(route.query.msoid)
  if (id) void open(id, Number.isFinite(mso) ? mso : null)
})

const lot = computed(() => detail.value?.lot ?? null)
const address = computed(() => {
  const a = detail.value?.addresses ?? []
  const row = a.find(x => x.msoid === msoid.value) ?? a.find(x => x.is_primary_address) ?? a[0]
  return (row?.address as string) || (lot.value?.address as string) || ''
})
/**
 * The address as a letter would carry it: "10 BOUNDARY STREET PARRAMATTA" + suburb + postcode from the same
 * derived.lot_address row -> "10 BOUNDARY STREET, PARRAMATTA NSW 2150". The street keeps its full road type (the
 * row's formatted_address abbreviates it to ST); the state comes from formatted_address, NSW when it names none.
 */
const fullAddress = computed(() => {
  const a = detail.value?.addresses ?? []
  const row: any = a.find(x => x.msoid === msoid.value) ?? a.find(x => x.is_primary_address) ?? a[0]
  const base = address.value
  if (!row || !base) return base
  const suburb = String(row.suburb ?? row.locality ?? '').trim()
  const postcode = String(row.postcode ?? '').trim()
  const state = String(row.formatted_address ?? '').match(/\b(NSW|ACT|VIC|QLD|SA|WA|TAS|NT)\b/i)?.[1]?.toUpperCase() ?? 'NSW'
  const street = suburb && base.toUpperCase().endsWith(` ${suburb.toUpperCase()}`) ? base.slice(0, -suburb.length - 1) : base
  return suburb ? `${street}, ${suburb} ${state}${postcode ? ` ${postcode}` : ''}` : `${base} ${state}${postcode ? ` ${postcode}` : ''}`
})
const runs = computed(() => detail.value?.shape?.runs ?? [])

// ── Formatting ────────────────────────────────────────────────────────────
function n(v: unknown): number | null {
  return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
}
function m(v: unknown): string {
  const x = n(v)
  return x == null ? '—' : `${x.toFixed(x < 100 ? 2 : 1)} m`
}
function sqm(v: unknown): string {
  const x = n(v)
  return x == null ? '—' : `${Math.round(x).toLocaleString('en-AU')} m²`
}
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
/** A road-name list (array or Postgres array text), title-cased, each name once. */
function names(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : v ? String(v).replace(/[{}"]/g, '').split(',') : []
  return [...new Set(raw.map(s => String(s ?? '').trim()).filter(Boolean).map(titleCase))]
}
function codeOf(field: string, v: unknown): string {
  return v == null ? '' : (LOT_FIELD_DOCS[field]?.codes?.[String(v)] ?? String(v))
}

// ── The report's sentences and figures ────────────────────────────────────
const facts = computed(() => {
  const l = lot.value
  if (!l) return []
  return [
    { label: 'Primary frontage', value: m(l.primary_frontage_length_m), sub: l.primary_frontage_road ? titleCase(l.primary_frontage_road) : 'no street named' },
    { label: 'Width at setback', value: m(l.width_at_setback_m), sub: `${m(l.width_setback_depth_m ?? 4.5)} in from the street` },
    { label: 'Depth', value: m(l.lot_depth_m), sub: 'at right angles to the frontage' },
    { label: 'Area', value: sqm(l.area_sqm), sub: n(l.effective_area_sqm) ? `${sqm(l.effective_area_sqm)} without the handle` : '' },
    { label: 'Corner lot', value: l.is_corner_lot ? 'Yes' : 'No', flag: !!l.is_corner_lot, sub: l.is_corner_lot ? names(l.corner_streets).join(' and ') : '' },
    { label: 'Through lot', value: l.is_through_lot ? 'Yes' : 'No', flag: !!l.is_through_lot, sub: l.is_through_lot ? throughStreets.value : '' },
    { label: 'Battle-axe', value: l.is_battleaxe ? 'Yes' : 'No', flag: !!l.is_battleaxe, sub: l.is_battleaxe ? `handle ${m(l.stem_width_m ?? l.handle_neck_min_m)} wide` : '' },
    { label: 'Street frontages', value: String(n(l.frontage_count) ?? runs.value.length), sub: l.total_frontage_m ? `${m(l.total_frontage_m)} in total` : '' },
  ]
})

const summary = computed(() => {
  const l = lot.value
  if (!l) return ''
  const count = n(l.frontage_count) ?? runs.value.length
  const shape = l.is_battleaxe ? 'A battle-axe lot' : l.is_corner_lot ? 'A corner lot' : l.is_through_lot ? 'A through lot' : 'A lot'
  const front = count === 0
    ? 'with no street frontage'
    : `with ${count === 1 ? 'one street frontage' : `${count} street frontages`}, the primary ${m(l.primary_frontage_length_m)} to ${l.primary_frontage_road ? titleCase(l.primary_frontage_road) : 'an unnamed road'}`
  return `${shape} of ${sqm(l.area_sqm)} ${front}. It is ${m(l.width_at_setback_m)} wide at the setback and ${m(l.lot_depth_m)} deep.`
})

const primaryBasis = computed(() => {
  const b = lot.value?.primary_frontage_basis
  return runs.value.length > 1 && b ? codeOf('primary_frontage_basis', b).replace(/^./, c => c.toLowerCase()) : ''
})

const cornerText = computed(() => {
  const l = lot.value
  if (!l) return ''
  if (l.is_corner_lot) {
    const streets = names(l.corner_streets)
    if (streets.length === 1) return `Yes - both frontages are on ${streets[0]}, which turns at least 45° around the lot.`
    return `Yes - the lot fronts ${streets.length ? streets.join(' and ') : 'two streets'}, at least 45° apart`
      + (l.corner_basis === 'geometry' ? ' (judged from the direction of the frontages, as the roads are not both named).' : '.')
  }
  if (l.is_through_lot) return 'No - its two frontages face roughly opposite ways (see through lot).'
  return runs.value.length > 1 ? 'No. Its frontages face the same way.' : 'No. It has a single street frontage.'
})

/** The streets of a through lot: the run roads, each once. */
const throughStreets = computed(() => names(runs.value.map(r => r.road)).join(' and '))

const throughText = computed(() => {
  const l = lot.value
  if (!l) return ''
  if (l.is_through_lot) {
    const s = names(runs.value.map(r => r.road))
    const where = s.length > 1 ? s.join(' and ') : s.length === 1 ? `${s[0]} on both sides` : 'two streets'
    return `Yes - the lot runs between ${where}: two frontages less than 45° apart, typically a street at the front and a street or lane at the back.`
  }
  return runs.value.length > 1 && l.is_corner_lot ? 'No - its frontages meet at a corner rather than facing opposite ways.' : 'No.'
})

const battleaxeText = computed(() => {
  const l = lot.value
  if (!l) return ''
  if (l.is_battleaxe) {
    return `Yes - the lot reaches the street through a handle ${m(l.stem_width_m ?? l.handle_neck_min_m)} wide and ${m(l.handle_length_m ?? l.stem_length_m)} long`
      + ` (${codeOf('handle_shape', l.handle_shape).toLowerCase() || 'battle-axe'}).`
  }
  const shape = l.handle_shape && !['regular', 'no_frontage'].includes(l.handle_shape)
    ? ` Seen from the street: ${codeOf('handle_shape', l.handle_shape).replace(/^./, c => c.toLowerCase())}.` : ''
  return `No - there is no access handle.${shape}`
})

const checkText = computed(() => {
  const a = lot.value?.frontage_agreement
  if (a === 'agree') return 'The frontage agrees with the road parcels the lot touches (within 10%).'
  if (a === 'differ') return `The road parcels give ${m(lot.value?.road_parcel_frontage_m)} of frontage against ${m(lot.value?.total_frontage_m)} measured; worth a look on the map.`
  return a ? `${codeOf('frontage_agreement', a)}.` : ''
})

/** What LotSketch needs, rebuilt from the stored row exactly as /testing-spatial-services does. */
const sketch = computed(() => {
  const s = detail.value?.shape
  const l = lot.value
  if (!s || s.ring.length < 4) return null
  const lat0 = s.ring.reduce((t, p) => t + p[1], 0) / s.ring.length
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const edges: { index: number; length_m: number; open_m: number }[] = []
  for (let i = 0; i < s.ring.length - 1; i++) {
    const a = s.ring[i]!
    const b = s.ring[i + 1]!
    const len = Math.hypot((b[0] - a[0]) * mPerLng, (b[1] - a[1]) * 110540)
    if (len <= 1e-9) continue
    edges.push({ index: edges.length, length_m: Math.round(len * 100) / 100, open_m: 0 })
  }
  return {
    ring: s.ring,
    edges,
    runs: s.runs.map(r => ({ edges: r.edges, length_m: r.lengthM ?? 0, coords: r.line, road: r.road, is_primary: r.isPrimary })),
    area_sqm: n(l?.area_sqm),
    perimeter_m: n(l?.total_boundary_m),
    lot_depth_m: n(l?.lot_depth_m),
    width_at_setback_m: n(l?.width_at_setback_m),
    width_setback_depth_m: n(l?.width_setback_depth_m),
    core_width_min_m: n(l?.core_width_min_m),
    is_battleaxe: !!l?.is_battleaxe,
    handle_length_m: n(l?.handle_length_m),
    stem_width_m: n(l?.stem_width_m),
    handle_neck_min_m: n(l?.handle_neck_min_m),
  }
})

// ── Sections 2 and 3: the EPI layers the lot falls in (/api/epi/at, the same sweep /epi runs) ──────────
const epi = ref<EpiAtResponse | null>(null)
const epiError = ref('')

async function loadEpi(id: string) {
  epi.value = null
  epiError.value = ''
  try {
    const r = await $fetch<EpiAtResponse>('/api/epi/at', { query: { cadid: id } })
    if (cadid.value === id) epi.value = r
  } catch (e: any) {
    if (cadid.value === id) epiError.value = e?.data?.message || e?.message || 'Could not read the planning maps.'
  }
}

/** Library documents by normalised title, for links to the instrument and its clauses (/instruments.json). */
const docs = ref<Map<string, string>>(new Map())
const normTitle = (s: string) => s.toLowerCase().replace(/state environmental planning policy/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()
onMounted(async () => {
  try {
    const idx = await $fetch<Record<string, { categories: Record<string, { items: { slug: string; title: string }[] }> }>>('/instruments.json')
    const map = new Map<string, string>()
    for (const st of Object.values(idx)) for (const c of Object.values(st.categories)) for (const i of c.items) map.set(normTitle(i.title), i.slug)
    docs.value = map
  } catch { /* links are a convenience; the report reads without them */ }
})
function docHref(title: string | null | undefined): string | null {
  const slug = title ? docs.value.get(normTitle(title)) : null
  return slug ? `/doc-viewer?doc=${encodeURIComponent(slug)}` : null
}
/**
 * "Clause 4.4 2C" -> sec.4.4, the anchor /doc-viewer scrolls to. LEPs only: SEPP maps cite the clause of the
 * policy they came from before the 2021 consolidation (the coal seam gas map's "Clause 9A" is the old mining
 * SEPP's), so a SEPP link opens the instrument rather than a clause that is not there.
 */
function clauseHref(h: EpiHit): string | null {
  const base = docHref(h.epiName)
  if (!base || !h.clause) return null
  if (!/local environmental plan/i.test(h.epiName ?? '')) return base
  const c = h.clause.match(/(?:clause|cl\.?|section)\s*([0-9]+[A-Z]*(?:\.[0-9]+[A-Z]*)*)/i)?.[1]
  return c ? `${base}&anchor=${encodeURIComponent(`sec.${c}`)}` : base
}
/** "State Environmental Planning Policy (Housing) 2021" -> "Housing SEPP 2021". */
function short(name: string | null | undefined): string {
  if (!name) return ''
  const x = name.match(/^State Environmental Planning Policy \((.+)\) (\d{4})$/)
  return x ? `${x[1]} SEPP ${x[2]}` : name
}
function cover(h: EpiHit): string {
  if (h.coverPct == null) return ''
  return h.coverPct >= 99.5 ? 'whole lot' : `${h.coverPct < 1 ? '<1' : Math.round(h.coverPct)}% of the lot`
}

const isLandApplication = (h: EpiHit) => h.layer === 'epi_land_application' && /land application/i.test(h.layName ?? '')
const isRegion = (h: EpiHit) => h.layer === 'epi_special_provision' && /^greater sydney$/i.test(h.layName ?? '')
const isGrowth = (h: EpiHit) => h.layer === 'epi_growth_centres' || h.layer === 'epi_precinct_boundaries'
const isLocality = (h: EpiHit) => isLandApplication(h) || isRegion(h) || isGrowth(h)

const locality = computed(() => {
  const hits = epi.value?.hits ?? []
  const lepHit = hits.find(h => isLandApplication(h) && /local environmental plan/i.test(h.epiName ?? ''))
  // the LEP's own land application names the council; failing that, the name most layers carry
  const counts = new Map<string, number>()
  for (const h of hits) if (h.lgaName) counts.set(h.lgaName, (counts.get(h.lgaName) ?? 0) + 1)
  const council = lepHit?.lgaName ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const growth = hits.filter(isGrowth).map(h => ({ k: h.layName || epiTitle(h.layer), v: h.label || h.layClass || '—' }))
  const sepps = [...new Set(hits.filter(h => isLandApplication(h) && /state environmental planning policy/i.test(h.epiName ?? ''))
    .map(h => h.epiName!))].sort()
  return {
    council: council ? titleCase(council) : null,
    lep: lepHit?.epiName ?? null,
    region: hits.some(isRegion) ? 'Greater Sydney' : 'Regional NSW (outside Greater Sydney)',
    growth: [...new Map(growth.map(g => [`${g.k}|${g.v}`, g])).values()],
    sepps,
  }
})

/**
 * The four standards every LEP maps, and how each states its figure. The dump carries no exact figure: lay_class
 * is the band the map colour covers ("10-10.9", "0.6-0.64") and label the map letter (K, F) that the LEP map's
 * legend resolves; sym_code is only the colour index (K -> 11, F -> 6) and must never be read as the value.
 */
const band = (h: EpiHit, unit: string) => {
  const c = h.layClass ?? ''
  return /^[0-9.]+(-[0-9.]+)?$/.test(c) ? `${c.replace('-', '–')}${unit}` : (h.label || c || '—')
}
const PRINCIPAL: { key: string; title: string; value: (h: EpiHit) => string }[] = [
  { key: 'epi_land_zoning', title: 'Zone', value: h => [h.label, h.layClass].filter(Boolean).join(' ') || '—' },
  { key: 'epi_height_of_building', title: 'Maximum building height', value: h => band(h, ' m') },
  { key: 'epi_floor_space_ratio', title: 'Floor space ratio', value: h => band(h, ':1') },
  { key: 'epi_lot_size', title: 'Minimum lot size', value: h => band(h, ' m²') },
]
const principal = computed(() => PRINCIPAL.map(p => ({ ...p, hits: (epi.value?.hits ?? []).filter(h => h.layer === p.key) })))

const resolvedMaps = computed(() => new Set((ac.value?.controls ?? []).filter(c => c.layer).map(c => `${c.layer}|${c.plan}|${c.map}`)))
const constraintGroups = computed(() => {
  const by = new Map<string, EpiHit[]>()
  for (const h of epi.value?.hits ?? []) {
    // flood and noise maps are read in section 3, with the other hazard sources
    // additional controls have their own block above, with the plan's words for each area
    if (isLocality(h) || RISK_LAYERS.has(h.layer) || h.layer === 'additional_controls' || h.layer === 'epi_additional_permitted_uses' || PRINCIPAL.some(p => p.key === h.layer)) continue
    // a local or special provision the block above resolved to its clause is shown there, not here
    if (resolvedMaps.value.has(`${h.layer}|${h.epiName}|${h.mapName}`)) continue
    if (!by.has(h.layer)) by.set(h.layer, [])
    by.get(h.layer)!.push(h)
  }
  return [...by.entries()]
    .map(([key, hits]) => ({ key, title: epiTitle(key), description: epiDescription(key), hits }))
    .sort((a, b) => a.title.localeCompare(b.title))
})
const partial = computed(() => constraintGroups.value.flatMap(g => g.hits).filter(h => h.coverPct != null && h.coverPct < 99.5))

/** One line for a hit: its class, with the map's own layer name when that says more than the group title. */
function rowText(title: string, h: EpiHit): string {
  const cls = h.layClass || h.label || ''
  const name = h.layName && h.layName.toLowerCase() !== title.toLowerCase() && h.layName !== cls ? h.layName : ''
  return [name, cls].filter(Boolean).join(': ') || title
}

// ── Section 3: risks (/api/report/risks - one row per category, unlike /api/lmr/at) ─────────────────
const risks = ref<RisksResponse | null>(null)
const risksError = ref('')
const RISK_LAYERS = new Set(['epi_flood', 'epi_noise_exposure_forecast'])

async function loadRisks(id: string) {
  risks.value = null
  risksError.value = ''
  try {
    const r = await $fetch<RisksResponse>('/api/report/risks', { query: { cadid: id } })
    if (cadid.value === id) risks.value = r
  } catch (e: any) {
    if (cadid.value === id) risksError.value = e?.data?.message || e?.message || 'Could not check the hazard maps.'
  }
}

type Status = 'clear' | 'part' | 'whole'
const STATUS: Record<Status, string> = { clear: 'None found', part: 'Part of the lot', whole: 'Whole lot' }
const statusOf = (rows: RiskRow[]): Status => (!rows.length ? 'clear' : rows.some(r => r.coverPct >= 99.5) ? 'whole' : 'part')
const pct = (x: number) => (x >= 99.5 ? 'the whole lot' : `${x < 1 ? 'under 1' : Math.round(x)}% of the lot`)
const asOf = (d: string | null | undefined) => (d ? ` as at ${new Date(d).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}` : '')

/** Bush fire categories from most to least severe; the buffer is bush fire prone land too. */
const BUSH_ORDER = ['Vegetation Category 1', 'Vegetation Category 2', 'Vegetation Category 3', 'Vegetation Buffer']
/** "ANEF 25 - 30"; a label that already names its metric ("ANEC between 35 and 40") is left alone. */
const noiseLabel = (r: RiskRow) => (/AN[EI][FCI]/i.test(r.cls) ? r.cls : `${r.detail || 'ANEF'} ${r.cls}`)
/** Lower bound of a noise band, "25 - 30" -> 25. */
const lowerBand = (r: RiskRow) => Number(r.cls.match(/\d+/)?.[0] ?? NaN)

const hazards = computed(() => {
  const R = risks.value
  if (!R) return []

  const bush = [...R.bushfire].sort((a, b) => BUSH_ORDER.indexOf(a.cls) - BUSH_ORDER.indexOf(b.cls))
  const worstBush = bush[0]

  const lepFlood = R.flood.filter(r => r.source.startsWith('LEP'))
  const aep = R.flood.find(r => r.source.startsWith('1% AEP'))
  const study = R.flood.filter(r => r.source.startsWith('Georges River'))

  const noise = [...R.noise].sort((a, b) => (lowerBand(b) || 0) - (lowerBand(a) || 0))
  const worstNoise = noise[0]
  const wn = worstNoise ? lowerBand(worstNoise) : NaN

  return [
    {
      key: 'bushfire',
      title: 'Bush fire',
      status: statusOf(bush),
      headline: worstBush
        ? `Bush fire prone land - ${worstBush.cls} on ${pct(worstBush.coverPct)}${bush.length > 1 ? ', the most severe category here' : ''}.`
        : 'Not mapped as bush fire prone land.',
      rows: bush.map(r => ({ label: r.cls, coverPct: r.coverPct, sub: '' })),
      meaning: worstBush
        ? 'A development application has to meet Planning for Bush Fire Protection 2019 (EP&A Act s 4.14), which starts with a bush fire attack level (BAL) assessment. Complying development is not available where the site is BAL-40 or flame zone.'
        : 'No bush fire controls are triggered by the map.',
      source: `NSW RFS bush fire prone land map${asOf(R.asOf.bushfire_prone_land)}.`,
    },
    {
      key: 'flood',
      title: 'Flood',
      status: statusOf(R.flood.filter(r => !r.source.startsWith('Georges River'))),
      headline: lepFlood.length
        ? `${lepFlood[0]!.cls} on ${pct(lepFlood[0]!.coverPct)}, on the ${short(lepFlood[0]!.instrument) || 'LEP'} flood map.`
        : aep ? `Inside the 1% AEP flood extent on ${pct(aep.coverPct)}.`
          : 'No flood mapping found for this lot.',
      rows: [
        ...lepFlood.map(r => ({ label: r.cls, coverPct: r.coverPct, sub: [r.clause, short(r.instrument)].filter(Boolean).join(' · ') })),
        ...(aep ? [{ label: '1% AEP flood extent', coverPct: aep.coverPct, sub: 'state flood data, a 1-in-100 chance flood each year' }] : []),
        ...study.map(r => ({ label: `Floodplain study: ${r.cls}`, coverPct: r.coverPct, sub: r.detail ?? '' })),
      ],
      meaning: lepFlood.length || aep
        ? "Council's flood planning controls apply (the LEP's flood planning clause, usually 5.21, and its DCP): expect a flood planning level for floors and flood-compatible design. Ask council for a flood certificate before design."
        : 'Flood mapping held here is partial - LEP flood maps for some councils and the state 1% AEP extent - so no hit is not the same as flood-free. A council flood certificate is the authoritative answer.',
      source: 'The plans’ flood planning maps (EPI), plus two datasets no plan maps: the state 1% AEP flood extent and the Georges River floodplain study.',
    },
    {
      key: 'noise',
      title: 'Aircraft noise (ANEF)',
      status: statusOf(noise),
      headline: worstNoise
        ? `${noiseLabel(worstNoise)} on ${pct(worstNoise.coverPct)}${noise.length > 1 ? ' - the highest band here' : ''}, on the ${short(worstNoise.instrument) || 'airport'} noise map.`
        : 'Outside every mapped aircraft noise contour.',
      rows: noise.map(r => ({ label: noiseLabel(r), coverPct: r.coverPct, sub: !r.verdict ? '' : / - not excluded/.test(r.verdict) ? 'below the SEPP exclusion' : 'excluded by the SEPPs' })),
      meaning: !worstNoise
        ? 'No aircraft noise controls are triggered.'
        // ANEC is the concept contour for an airport not yet operating (Western Sydney); the SEPPs exclude from 20
        : noise.some(r => r.detail === 'ANEC' && lowerBand(r) >= 20) || wn >= 25
          ? 'The Housing and Codes SEPPs exclude this land from their housing pathways (ANEF 25 or more, ANEC 20 or more), and under AS 2021 new dwellings are "unacceptable" from ANEF 25. Noise-sensitive uses need an acoustic report.'
          : wn >= 20
            ? 'Under AS 2021 dwellings at ANEF 20-25 are "conditionally acceptable": they need noise attenuation built to AS 2021. The SEPP housing pathways are not excluded below ANEF 25.'
            : 'Below ANEF 20 dwellings are "acceptable" under AS 2021.',
      source: `The plans’ noise exposure forecast maps (EPI), plus the Defence ANEF/ANEC and Sydney Airport ANEI contours no plan maps${asOf(R.asOf.airport_noise)}.`,
    },
  ]
})

// ── Section 5: LMR - the same /api/lmr/types the "This lot" tab on /lmr reads ─────────────────────────
const lmr = ref<LmrTypesResponse | null>(null)
const lmrError = ref('')
async function loadLmr(id: string) {
  lmr.value = null
  lmrError.value = ''
  try {
    const r = await $fetch<LmrTypesResponse>('/api/lmr/types', { query: { cadid: id } })
    if (cadid.value === id) lmr.value = r
  } catch (e: any) {
    if (cadid.value === id) lmrError.value = e?.data?.message || e?.message || 'Could not check Chapter 6.'
  }
}
const LMR_STATUS: Record<string, string> = { excluded: 'Excludes this lot', clear: 'Clear', gap: 'Not testable', 'n/a': 'Does not reach this council' }
const checkTone = (s: string) => (s === 'excluded' ? 'no' : s === 'clear' || s === 'n/a' ? 'yes' : 'open')
function allowance(a: any): string {
  return [a.forUse, a.fsr != null ? `FSR ${a.fsr}:1` : null, a.heightM != null ? `height ${a.heightM} m` : null,
    a.storeys ? `${a.storeys} storeys` : null].filter(Boolean).join(', ') + (a.band && a.band !== 'any' ? ` (${a.band} area)` : '')
}
/** The lot facts a form fails on, excluding the area test the headline already gives. */
const failed = (f: any): string[] => (f.checks ?? []).filter((c: any) => c.pass === false && c.column !== 'lmr_area').map((c: any) => c.says)

const lmrVerdict = computed(() => {
  const l = lmr.value
  if (!l) return { tone: 'open', head: '', sub: '' }
  const excl = l.general.filter((g: any) => g.status === 'excluded')
  const area = l.lot.band === 'inner'
    ? `in an inner low and mid rise housing area - within 400 m walking of ${l.lot.measuredFrom.filter((m: string) => m.includes('400')).join(', ') || l.lot.measuredFrom.join(', ')}`
    : l.lot.band === 'outer' ? `in an outer low and mid rise housing area - 400-800 m walking of ${l.lot.measuredFrom.join(', ')}` : ''
  const eligible = l.types.filter((f: any) => f.eligible === true).map((f: any) => f.name)
  if (excl.length) {
    return { tone: 'no', head: 'Not LMR: Chapter 6 does not apply to this lot.',
      sub: `Excluded by ${excl.map((g: any) => `s ${g.clause} (${g.text})`).join(' and ')}${area ? `, although the lot is ${area}` : ''}.` }
  }
  if (!l.lot.band) {
    return { tone: 'no', head: 'Not LMR: outside every low and mid rise housing area.',
      sub: 'The lot is not within 800 m walking of a Town Centre or Schedule 11 station (s 163), so the chapter gives it nothing.' }
  }
  return eligible.length
    ? { tone: 'yes', head: `LMR: the lot is ${area}.`, sub: `Eligible under Chapter 6 for: ${eligible.join('; ')}.` }
    : { tone: 'open', head: `LMR area, but no housing form fits: the lot is ${area}.`, sub: 'Every form fails a lot test - see below.' }
})

// ── Section 6: CDC (/api/cdc/at) and the environmentally sensitive area (/api/esa/at) ─────────────────
const cdc = ref<CdcAtResponse | null>(null)
const esa = ref<EsaAtResponse | null>(null)
const cdcError = ref('')
const esaError = ref('')
async function loadCdc(id: string) {
  cdc.value = null
  esa.value = null
  cdcError.value = ''
  esaError.value = ''
  await Promise.all([
    $fetch<CdcAtResponse>('/api/cdc/at', { query: { cadid: id } })
      .then((r) => { if (cadid.value === id) cdc.value = r })
      .catch((e: any) => { if (cadid.value === id) cdcError.value = e?.data?.message || e?.message || 'Could not check the CDC layers.' }),
    $fetch<EsaAtResponse>('/api/esa/at', { query: { cadid: id } })
      .then((r) => { if (cadid.value === id) esa.value = r })
      .catch((e: any) => { if (cadid.value === id) esaError.value = e?.data?.message || e?.message || 'Could not check the ESA layers.' }),
  ])
}
const coverText = (x: number) => (x >= 99.5 ? 'whole lot' : `${x < 1 ? '<1' : Math.round(x)}% of the lot`)

/** What each scope means for the reader; context hits are facts about the lot and are left out. */
const CDC_SCOPES: { key: string; title: string; note: string }[] = [
  { key: 'general', title: 'General land exclusions (cl 1.17A-1.19A, Schedule 5)', note: 'Cl 1.17A and 1.18 apply to every code. Cl 1.19 and 1.19A each list the codes they apply to - mostly the new-house codes - so smaller works such as internal alterations can still be complying development on that land.' },
  { key: 'code', title: 'Rules out a particular code', note: 'A requirement of one code only; the other codes are not affected.' },
  { key: 'midrise', title: 'Rules out the Pattern Book', note: 'Housing SEPP s 182, which gates the Pattern Book pathway only.' },
  { key: 'condition', title: 'Needs an approval before a certificate', note: 'Not a disqualification - the clause asks for an approval first.' },
  { key: 'unmapped', title: 'Excluded, clause not identified', note: 'We exclude on these, but the source workbook does not give the clause; read them as likely exclusions to confirm.' },
]
const cdcGroups = computed(() => CDC_SCOPES
  .map(s => ({ ...s, hits: (cdc.value?.hits ?? []).filter((h: CdcHit) => h.scope === s.key) }))
  .filter(g => g.hits.length))

const esaHits = computed(() => (esa.value?.hits ?? []).filter(h => h.kind === 'exclusion'))

const untestable = computed(() => [
  ...(cdc.value?.gaps ?? []).map(g => `${g.title}${g.clauses?.length ? ` (cl ${g.clauses.join(', ')})` : ''}`),
  ...(esa.value?.gaps ?? []).map(g => `${g.item} (ESA)`),
])

const cdcVerdict = computed(() => {
  const c = cdc.value
  if (!c) return { tone: 'open', head: '', sub: '' }
  const general = c.hits.filter(h => h.scope === 'general')
  const code = c.hits.filter(h => h.scope === 'code')
  const esaN = esaHits.value.filter(h => h.half === 'statewide').length
  if (general.length || esaN) {
    const what = [...new Set([...general.map(h => h.title.toLowerCase()), ...(esaN ? ['an environmentally sensitive area'] : [])])]
    const caught = [...general, ...esaHits.value.filter(h => h.half === 'statewide')]
    const where = caught.some(h => h.coverPct >= 99.5) ? 'this lot' : 'part of this lot'
    // cl 1.17A (and an ESA, which is 1.17A(1)(e)) bars every code; 1.18 the general requirements; 1.19 / 1.19A
    // only the codes they name
    const everyCode = esaN > 0 || general.some(h => h.clauses.some(c => /^1\.1(7A|8)/.test(c)))
    return { tone: 'no',
      head: everyCode ? `Complying development is ruled out on ${where}.` : `Complying development for new housing is ruled out on ${where}.`,
      sub: `Because of ${what.join(', ')}.${everyCode ? '' : ' Codes that cl 1.19 / 1.19A do not name, and the works they carve back, may still apply.'} Cl 1.19(6) lets complying development use the part of a lot that is not excluded land, where that part is enough.` }
  }
  if (code.length) return { tone: 'open', head: 'Complying development is possible, but not under every code.', sub: `${code.map(h => h.title).join(', ')} rule out particular codes.` }
  return { tone: 'yes', head: 'No complying development exclusion found on this lot.',
    sub: `Clear of all ${c.verdict.tested} mapped land tests${untestable.value.length ? `; ${untestable.value.length} cannot be tested and need checking by hand` : ''}. Whether a particular code fits depends on the zone and the lot's size - the CDC page tests each code.` }
})

// ── Section 7: subdivision - the RAG engine where it holds the lot's plan (/api/report/subdivision), else the norms engine ─────────
const sub = ref<(ReportSubdivisionResponse & { norms?: any }) | null>(null)
const subError = ref('')
async function loadSub(id: string) {
  sub.value = null
  subCell.value = null
  subError.value = ''
  try {
    const r = await $fetch<ReportSubdivisionResponse>('/api/report/subdivision', { query: { cadid: id } })
    // outside the RAG's plan, the norms engine answers the same question for any LEP the graph holds
    const norms = r.engine === 'none' ? await $fetch<any>('/api/norms/subdivision', { query: { cadid: id } }).catch(() => null) : undefined
    if (cadid.value === id) sub.value = { ...r, norms }
  } catch (e: any) {
    if (cadid.value === id) subError.value = e?.data?.message || e?.message || 'Could not work out the subdivision answer.'
  }
}

const TONE: Record<string, 'yes' | 'no' | 'open'> = { yes: 'yes', no: 'no', maybe: 'open', depends: 'open' }
const WHO: Record<string, string> = { site: 'what is already on the site', proposal: 'the proposal', lot: 'a lot fact not held', unparsed: 'clause text not yet read into rules' }

/**
 * The two questions the section answers, each said plainly for a reader who does not know the terms. The title types
 * are the three ways NSW divides land; the purposes are what the new lots are for, which moves the minimum lot size.
 */
const TITLE_TYPES = [
  { key: 'torrens', label: 'Torrens title', means: 'Each new lot is its own block of land with its own title. You own the land and the home on it outright, with nothing shared.' },
  { key: 'strata', label: 'Strata', means: 'You own your unit or townhouse; the land, driveway, gardens and building structure are common property, run by an owners corporation you pay levies to.' },
  { key: 'community', label: 'Community title', means: 'You own your lot and the land under it, and share common areas (roads, parks, facilities) run by a community association. Common in estates.' },
] as const
const PURPOSE_MEANS: Record<string, string> = {
  'dwelling house': 'One house on each new lot.',
  'dual occupancy': 'Two homes on the original lot - side by side or one behind the other - each on its own new lot.',
  'multi dwelling housing (terraces)': 'A row of attached homes, each facing the street, each on its own new lot.',
}

type Cell = { key: string; label: string; answer: string; tone: string; controlling: { text: string; url: string | null }[]
  limits: string[]; branches: { if: string; then: string; tone: string }[]; depends: string[]; steps: string[]
  tested: { label: string; url: string | null; status: string; tone: string; why: string }[] }

/** One answer of the RAG engine as a cell. */
function ragCell(s: ReportSubdivisionResponse, a: ReportSubdivisionResponse['purposes'][number]['answers'][number]): Cell {
  const perLot = s.lot?.areaM2 ? s.lot.areaM2 / (s.lot.lots || 2) : null
  const link = (id: string | null | undefined) => (id ? s.provisions[id]?.url ?? null : null)
  const won = a.explained.claims.filter(c => c.won)
  return {
    key: a.tenure, label: a.label, answer: a.verdict === 'yes' ? 'Yes' : a.verdict === 'no' ? 'No' : a.verdict === 'maybe' ? 'Depends' : a.verdict, tone: TONE[a.verdict] ?? 'open',
    controlling: won.map(c => ({ text: `${c.label}${c.value != null ? ` - minimum ${c.value} ${!c.unit || c.unit === 'm2' ? 'm²' : c.unit}` : ''}`, url: link(c.provision_id) })),
    limits: a.explained.limits.map(l => `${l.label}: ${l.status}${l.detail ? ` - ${l.detail}` : ''}`),
    // the case where the condition holds first, then the rest as "otherwise"
    branches: [...a.explained.branches].sort((x, y) => Number(/^not /.test(x.if)) - Number(/^not /.test(y.if))).map((b) => {
      const min = Number(String(b.answer ?? '').match(/[\d.]+/)?.[0])
      const ok = Number.isFinite(min) && perLot != null ? perLot >= min : null
      const by = b.steps.map(st => `${st.winner} prevails over ${st.loser} (${st.why})`).join('; ')
      return { if: /^not /.test(b.if) ? 'Otherwise' : `If ${branchIf(b.if)}`, then: `minimum ${Number.isFinite(min) ? `${min} m²` : b.answer ?? 'unknown'}${ok == null ? '' : ok ? ' - each lot clears it' : ' - each lot is short'}${by ? `. ${by}` : ''}`,
        tone: ok == null ? 'open' : ok ? 'yes' : 'no' }
    }),
    depends: [...a.explained.notChecked],
    steps: a.explained.steps.map(x => `${x.winner} prevails over ${x.loser}: ${x.why}`),
    // every claim the engine weighed for this question, deciding first - each with its words one click away
    tested: [...a.explained.claims].sort((x, y) => Number(y.won) - Number(x.won) || Number(y.holds === true) - Number(x.holds === true)).map(c => ({
      label: `${c.label}${c.value != null ? ` (${c.value} ${!c.unit || c.unit === 'm2' ? 'm²' : c.unit})` : ''}`, url: link(c.provision_id),
      status: c.won ? 'decides' : c.holds === true ? 'applies' : c.holds == null ? 'may apply - depends on a fact not held' : 'does not apply here',
      tone: c.won || c.holds === true ? 'yes' : c.holds == null ? 'open' : 'no', why: c.why.join('; '),
    })),
  }
}

/** One title type of the norms engine (outside the RAG's plan) as a cell. */
function normsCell(k: any): Cell {
  const by: Record<string, number> = {}
  for (const d of k.dependsOn ?? []) by[d.who] = (by[d.who] ?? 0) + 1
  return {
    key: k.key, label: k.label, answer: k.answer === 'yes' ? 'Yes' : k.answer === 'no' ? 'No' : 'Depends', tone: TONE[k.answer] ?? 'open',
    controlling: (k.controlling ?? []).map((c: any) => ({ text: `${short(c.instrument)} cl ${c.clause}`, url: c.url ?? null })),
    limits: (k.standards ?? []).filter((x: any) => x.holds != null).map((x: any) => `cl ${x.clause}: ${x.standard} - ${x.holds ? 'met' : 'not met'}`),
    depends: Object.entries(by).map(([w, nn]) => `${nn} ${nn === 1 ? 'condition' : 'conditions'} on ${WHO[w] ?? w}`),
    branches: [], steps: [], tested: [],
  }
}

/** The provisions the section's answers name, by label, for LinkText. */
const subProvs = computed(() => sub.value?.engine === 'rag' ? sub.value.provisions : {})

/**
 * A line of engine text with every clause name it contains linked to that clause on the NSW legislation website - only
 * names the answer's own provisions carry, longest first, so "s 169(3)(d)" never links as "s 169(3)".
 */
const LinkText = defineComponent({
  props: { text: { type: String, required: true }, provs: { type: Object as () => Record<string, { label: string; url: string | null }>, required: true } },
  setup(props) {
    return () => {
      const urls = new Map(Object.values(props.provs).filter(p => p.url).map(p => [p.label, p.url!]))
      if (!urls.size) return h('span', props.text)
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(${[...urls.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})(?![0-9A-Za-z(])`, 'g')
      const out: any[] = []
      let last = 0
      for (const m of props.text.matchAll(re)) {
        if (m.index! > last) out.push(props.text.slice(last, m.index))
        out.push(h('a', { href: urls.get(m[1]!), target: '_blank', rel: 'noopener', class: 'r2-xl' }, m[1]))
        last = m.index! + m[0].length
      }
      out.push(props.text.slice(last))
      return h('span', out)
    }
  },
})

/** Rows: what the new lots are for. Columns: the title types, in TITLE_TYPES order. */
const subGrid = computed(() => {
  const s = sub.value
  if (!s) return []
  const order = (cells: Cell[]) => TITLE_TYPES.map(tt => cells.find(c => c.key === tt.key)).filter(Boolean) as Cell[]
  if (s.engine === 'rag') {
    return s.purposes.map(pp => ({ use: pp.use, label: pp.label, means: PURPOSE_MEANS[pp.use] ?? '', cells: order(pp.answers.map(a => ragCell(s, a))) }))
  }
  return [{ use: 'any', label: 'Any purpose', means: 'The norms engine answers for the subdivision itself, whatever the lots are for.',
    cells: order((s.norms?.kinds ?? []).map(normsCell)) }]
})

const subCell = ref<{ use: string; tenure: string } | null>(null)
const isOpenCell = (use: string, tenure: string) => openCell.value?.row.use === use && openCell.value?.cell.key === tenure
/** The cell whose reasoning is shown: the one clicked, else the first that is not a plain no. */
const openCell = computed(() => {
  const rows = subGrid.value
  const pick = subCell.value
  for (const row of rows) for (const cell of row.cells) if (pick && row.use === pick.use && cell.key === pick.tenure) return { row, cell }
  for (const row of rows) for (const cell of row.cells) if (cell.tone !== 'no') return { row, cell }
  const row = rows[0]
  return row?.cells[0] ? { row, cell: row.cells[0] } : null
})

const subVerdict = computed(() => {
  const s = sub.value
  const lots = s?.lot?.lots ?? s?.norms?.lots ?? 2
  if (s?.engine === 'rag') {
    const parts = s.purposes.map((pp) => {
      const yes = pp.answers.filter(a => a.verdict === 'yes').map(a => a.label.replace(' title', ''))
      return `${pp.label}: ${yes.length === pp.answers.length ? 'yes' : yes.length ? `yes by ${yes.join(' or ')}` : purposeShort(pp).toLowerCase()}`
    })
    const any = s.purposes.some(pp => purposeTone(pp) === 'yes')
    const all = s.purposes.every(pp => purposeTone(pp) === 'no')
    return { tone: all ? 'no' : any ? 'yes' : 'open',
      head: all ? `No - the lot cannot be subdivided into ${lots} lots.` : any ? `Yes - the lot can be subdivided into ${lots} lots, for some purposes.` : 'It depends.',
      sub: `${parts.join(' · ')}. The minimum lot size depends on what the new lots are for and how the land is divided - every combination is in the table below.` }
  }
  const ks = subGrid.value[0]?.cells ?? []
  if (!ks.length) return { tone: 'open', head: 'No subdivision answer for this lot.', sub: s?.reason ?? '' }
  const yes = ks.filter((k: any) => k.tone === 'yes').map((k: any) => k.label)
  const no = ks.filter((k: any) => k.tone === 'no').map((k: any) => k.label)
  if (yes.length === ks.length) return { tone: 'yes', head: `Yes - the lot can be subdivided into ${lots} lots.`, sub: `By ${yes.join(', ').replace(/, ([^,]*)$/, ' or $1')}, with consent.` }
  if (no.length === ks.length) return { tone: 'no', head: `No - the lot cannot be subdivided into ${lots} lots.`, sub: 'Not by Torrens, strata or community title - see why below.' }
  if (yes.length) return { tone: 'yes', head: `Yes, by ${yes.join(' or ')}.`, sub: no.length ? `Not by ${no.join(' or ')}.` : 'The other title types depend on facts not held - see below.' }
  return { tone: 'open', head: 'It depends.', sub: 'Every title type turns on facts about the site or the proposal that are not recorded - see below.' }
})

/** A purpose in one word: yes when any title type is a yes, no when all are no. */
const purposeTone = (pp: { answers: { verdict: string }[] }) =>
  pp.answers.some(a => a.verdict === 'yes') ? 'yes' : pp.answers.every(a => a.verdict === 'no') ? 'no' : 'open'
const purposeShort = (pp: { answers: { verdict: string }[] }) => ({ yes: 'Yes', no: 'No', open: 'Depends' } as Record<string, string>)[purposeTone(pp)]!

/** The engine's branch condition, said plainly: "frame Housing SEPP s 169(2) [consent>=2025-02-28 or ...: unknown]: unknown". */
function branchIf(raw: string): string {
  const date = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  const plain = (x: string) => x
    .replace(/consent>=(\d{4}-\d{2}-\d{2})/g, (_, d) => `the consent for the development was granted on or after ${date(d)}`)
    .replace(/combined_da>=(\d{4}-\d{2}-\d{2})/g, (_, d) => `it is one application with the development, made on or after ${date(d)}`)
  // each "frame <clause> [test: yes; test: unknown]: unknown" - keep the clause and only the tests nothing could answer
  const parts: string[] = []
  for (const m of raw.matchAll(/frame (.+?) \[(.+?)\]: (?:unknown|yes|no)/g)) {
    const tests = m[2]!.split(/; (?=[^;]*: (?:yes|no|unknown)(?:;|$))/)
    const open = tests.filter(x => /: unknown$/.test(x)).map(x => x.replace(/: unknown$/, ''))
    parts.push(`${m[1]} applies${open.length ? ` - which turns on: ${open.map(plain).join('; ')}` : ''}`)
  }
  return parts.length ? parts.join(', and ') : plain(raw.replace(/^not /, ''))
}

/** The lot tests the engine ran for the chosen purpose, once - "excluded if" tests read the other way round. */
const subChecks = computed(() => {
  const s = sub.value
  if (s?.engine !== 'rag') return []
  const pp = s.purposes.find(x => x.use === openCell.value?.row.use) ?? s.purposes[0]
  const seen = new Map<string, any>()
  for (const a of pp?.answers ?? []) for (const c of a.explained.checks) if (!seen.has(c.text)) seen.set(c.text, { ...c, bad: /^excluded if/i.test(c.text) })
  return [...seen.values()]
})

/** The plain arithmetic, from the Lot Size Map: what each lot would be against the mapped minimum. */
const sizeCheck = computed(() => {
  const s = sub.value
  const area = s?.lot?.areaM2 ?? s?.norms?.lot?.areaM2 ?? n(lot.value?.area_sqm)
  const min = s?.lot?.lotSizeMinM2 ?? s?.norms?.lot?.lotSizeMinM2 ?? null
  const lots = s?.lot?.lots ?? s?.norms?.lots ?? 2
  if (!area) return ''
  if (!min) return `The lot is ${sqm(area)}; it has no minimum lot size on the Lot Size Map.`
  const each = area / lots
  return `Lot size check: ${sqm(area)} in ${lots} lots is about ${sqm(each)} each, against the ${sqm(min)} minimum on the Lot Size Map (cl 4.1) - ${each >= min ? 'each lot clears it' : 'short of it'}. Other clauses can set a different minimum, which is what the answers below weigh.`
})

const subAsAt = computed(() => {
  const d = sub.value?.purposes?.[0]?.answers?.[0]?.explained.asAt ?? []
  return d.length ? `Law as at ${d.map(x => `${short(x.instrument)} ${x.date ?? ''}`.trim()).join(', ')}.` : ''
})

// ── Section 8: every land use, answered by the RAG engine (/api/report/uses), each with its full trace ──────
const uses = ref<ReportUsesResponse | null>(null)
const usesError = ref('')
const openUse = ref<string | null>(null)
const traces = ref<Record<string, UseDetail | { error: string } | null>>({})
async function loadUses(id: string) {
  uses.value = null
  usesError.value = ''
  openUse.value = null
  traces.value = {}
  try {
    const r = await $fetch<ReportUsesResponse>('/api/report/uses', { query: { cadid: id } })
    if (cadid.value === id) uses.value = r
  } catch (e: any) {
    if (cadid.value === id) usesError.value = e?.data?.message || e?.message || 'Could not ask the RAG engine.'
  }
}
async function toggleUse(use: string) {
  if (openUse.value === use) { openUse.value = null; return }
  openUse.value = use
  if (traces.value[use]) return
  traces.value = { ...traces.value, [use]: null }
  const id = cadid.value
  try {
    const d = await $fetch<UseDetail>('/api/report/uses', { query: { cadid: id, use } })
    if (cadid.value === id) traces.value = { ...traces.value, [use]: d }
  } catch (e: any) {
    if (cadid.value === id) traces.value = { ...traces.value, [use]: { error: e?.data?.message || e?.message || 'Could not load the trace.' } }
  }
}

/** The engine keys a use in the singular (landUseKey), which breaks "premises" and "business": shown as the plans write them. */
const cap = (s: string) => {
  const x = s.replace(/ premise$/, ' premises').replace(/businesse$/, 'business')
  return x.charAt(0).toUpperCase() + x.slice(1)
}
const useTone = (u: UseSummary) => (u.verdict === 'permitted' ? 'yes' : u.verdict === 'prohibited' ? 'no' : 'open')
/** The tone of the cl 1.18(1)(b) / s 183(1)(a) test: permitted WITHOUT consent reads as a fail, not a pass. */
const meetTone = (m: boolean | null) => (m === true ? 'yes' : m === false ? 'no' : 'open')
const useLabel = (u: UseSummary) => (u.verdict === 'permitted' ? (u.consent === 'without' ? 'Permitted without consent' : 'Permitted with consent')
  : u.verdict === 'prohibited' ? 'Prohibited' : u.verdict === 'maybe' ? 'Depends' : 'Not answered')

const otherGroups = computed(() => {
  const o = uses.value?.others ?? []
  return [
    { key: 'with', title: 'Permitted with consent', tone: 'yes', items: o.filter(u => u.verdict === 'permitted' && u.consent !== 'without') },
    { key: 'without', title: 'Permitted without consent', tone: 'yes', items: o.filter(u => u.verdict === 'permitted' && u.consent === 'without') },
/** The provisions the engine checked for the use that do not reach this lot (UseSummary.reach, any instrument): a bar
 *  the lot escapes, or a permission it cannot use - "Housing SEPP s 166 checked: not eligible, bush fire prone land". */
const notReaching = (u: UseSummary) => (u.reach ?? []).filter(x => x.status !== 'reaches' && x.because.length)
const reachNote = (x: UseSummary['reach'][number]) => {
  const why = x.because.map(b => b.text.replace(/ (?:within the meaning of|under) State Environmental Planning Policy.*$/, '')).join('; ')
  const frame = x.frame && x.frame !== x.label ? ` (${x.frame.replace(/^.*? (?=(?:s|cl|Sch) )/, '')})` : ''
  return x.status === 'blocked'
    ? `${x.label} checked: ${x.kind === 'prohibit' ? 'does not bar this lot' : 'not eligible'} - ${why}${frame}`
    : `${x.label} checked: turns on ${why}${frame} - no data held`
}
    { key: 'maybe', title: 'Depends', tone: 'open', items: o.filter(u => u.verdict === 'maybe') },
    { key: 'none', title: 'Not answered', tone: 'open', items: o.filter(u => u.verdict !== 'permitted' && u.verdict !== 'prohibited' && u.verdict !== 'maybe') },
    { key: 'no', title: 'Prohibited', tone: 'no', items: o.filter(u => u.verdict === 'prohibited') },
  ].filter(g => g.items.length)
})


const usesVerdict = computed(() => {
  const u = uses.value
  if (!u || u.engine !== 'rag') return { tone: 'open', head: '', sub: '' }
  const yes = u.uses.filter(x => x.meets === true).map(x => x.use)
  const count = (s: string) => {
    const g = u.requirements.filter(x => x.surface === s)
    return `${g.filter(x => x.meets === true).length} of ${g.length}`
  }
  return { tone: yes.length ? 'yes' : 'no',
    head: yes.length ? `Permissible with consent here: ${yes.join(', ')}.` : 'None of the housing land uses is permissible with consent here.',
    sub: `CDC: ${count('CDC')} types have their land use. Pattern Book: ${count('Pattern Book')} categories.` }
})

const usesAsAt = computed(() => {
  const any = Object.values(traces.value).find((x: any) => x?.explained) as UseDetail | undefined
  return any?.explained.asAt?.length ? `Law as at ${any.explained.asAt.map(x => `${short(x.instrument)} ${x.date ?? ''}`.trim()).join(', ')}.` : ''
})

/**
 * The trace of the open use, in the order the engine reasoned: the answer as written, the claims that bear on this lot
 * (the ones that hold, then those that might), how they were weighed, the limits, what was not checked, and the words
 * of every provision involved. Claims that fail on zone or use are counted, not listed - they are every other zone's row.
 */
/**
 * A RAG answer's full trace - the answer as written, the claims that bear on the lot, how they were weighed, the limits,
 * what was not checked, and the words of every provision. Shared by the land use traces and the envelope's cells.
 */
const TraceView = defineComponent({
  props: { d: { type: Object as () => any, default: null } },
  setup(props) {
    return () => {
      const d = props.d
      if (!d) return h('p', { class: 'r2-muted' }, 'Loading the trace…')
      if ('error' in d) return h('p', { class: 'r2-error' }, d.error)
      const x = d.explained
      const bears = x.claims.filter(c => c.holds !== false)
      const elsewhere = x.claims.length - bears.length
      const prov = (id: string | null | undefined, fallback: string) => {
        const p = id ? d.provisions[id] : null
        return p?.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'r2-cl' }, p.label) : h('span', fallback)
      }
      return h('div', { class: 'r2-trace' }, [
        h('pre', { class: 'r2-trace-text' }, d.text),
        h('p', { class: 'r2-ten-h' }, `Claims that bear on this lot (${bears.length})`),
        h('ul', { class: 'r2-trace-list' }, bears.map(c => h('li', { class: c.won ? 'r2-trace-won' : '' }, [
          c.won ? h('b', '✓ decides  ') : c.holds == null ? h('b', '? unknown  ') : h('b', '· holds  '),
          prov(c.provision_id, c.label), ` - ${c.kind}${c.value != null ? ` ${c.value}${c.unit ? ` ${c.unit}` : ''}` : ''}`,
          h('span', { class: 'r2-trace-why' }, [h(LinkText, { text: c.why.join('; '), provs: d.provisions })]),
        ]))),
        elsewhere ? h('p', { class: 'r2-small' }, `${elsewhere} other claims name this use but do not reach this lot (another zone, or a condition that fails) - not listed.`) : null,
        x.steps.length ? h('p', { class: 'r2-ten-h' }, 'How the clauses were weighed') : null,
        x.steps.length ? h('ul', { class: 'r2-trace-list' }, x.steps.map(s => h('li', [
          prov(s.winner_id, s.winner), ' prevails over ', prov(s.loser_id, s.loser), `: ${s.why}`,
          h('span', { class: 'r2-trace-why' }, `${s.relation ? `by ${s.relation} · ` : ''}${s.basis}${s.status !== 'verified' ? ` · ${s.status}` : ''}`),
        ]))) : null,
        // a "maybe" is a set of branches: what the answer is under each reading of the fact it turns on
        x.branches.length ? h('p', { class: 'r2-ten-h' }, 'It turns on') : null,
        x.branches.length ? h('ul', { class: 'r2-trace-list' }, [...x.branches].sort((p1, p2) => Number(/^not /.test(p1.if)) - Number(/^not /.test(p2.if))).map(b => h('li', [
          h('b', /^not /.test(b.if) ? 'Otherwise' : 'If '), /^not /.test(b.if) ? '' : h(LinkText, { text: branchIf(b.if), provs: d.provisions }),
          ` - ${b.answer === 'permit' ? 'permitted' : b.answer === 'prohibit' ? 'prohibited' : b.answer ?? 'unknown'}`,
          ...b.steps.map(st => h('span', { class: 'r2-trace-why' }, [h(LinkText, { text: `${st.winner} prevails over ${st.loser}: ${st.why}`, provs: d.provisions })])),
        ]))) : null,
        x.limits.length ? h('p', { class: 'r2-ten-h' }, 'Limits') : null,
        x.limits.length ? h('ul', { class: 'r2-trace-list' }, x.limits.map(l => h('li', [prov(l.provision_id, l.label), `: ${l.status}${l.detail ? ` - ${l.detail}` : ''}`]))) : null,
        x.notChecked.length ? h('p', { class: 'r2-ten-h' }, 'Not checked') : null,
        x.notChecked.length ? h('ul', { class: 'r2-trace-list' }, x.notChecked.map(n => h('li', n))) : null,
        h('details', { class: 'r2-trace-provs' }, [
          h('summary', `The words of the ${Object.keys(d.provisions).length} provisions involved`),
          ...Object.values(d.provisions).map(p => h('div', { class: 'r2-trace-prov' }, [
            h('p', [p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'r2-cl' }, p.label) : p.label, p.heading ? ` - ${p.heading}` : '']),
            p.stem ? h('p', { class: 'r2-trace-why' }, p.stem) : null,
            h('p', { class: 'r2-trace-quote' }, p.text),
          ])),
        ]),
      ])
    }
  },
})
const UseTrace = defineComponent({
  setup() {
    return () => h(TraceView, { d: openUse.value ? traces.value[openUse.value] ?? null : null })
  },
})

// ── Sections 9 and 10: each CDC type and Pattern Book category, clause by clause ──────────────────────────
// The checks are /api/cdc/types' and /api/pattern-book/at's; their land use test reads the Land Use Table alone, so it is
// replaced by the RAG engine's answer (section 9), which also reads the SEPPs - and where that changes the answer, it says so.
const cdcTypes = ref<any>(null)
const cdcReqs = ref<CdcRequirement[]>([])
const cdcTypesError = ref('')
const pb = ref<any>(null)
const pbError = ref('')
async function loadCdcPb(id: string) {
  cdcTypes.value = null
  pb.value = null
  cdcTypesError.value = ''
  pbError.value = ''
  await Promise.all([
    cdcReqs.value.length ? Promise.resolve() : $fetch<CdcRequirement[]>('/api/report/cdc-requirements').then((r) => { cdcReqs.value = r }).catch(() => {}),
    $fetch<any>('/api/cdc/types', { query: { cadid: id } })
      .then((r) => { if (cadid.value === id) cdcTypes.value = r })
      .catch((e: any) => { if (cadid.value === id) cdcTypesError.value = e?.data?.message || e?.message || 'Could not check the CDC types.' }),
    $fetch<any>('/api/pattern-book/at', { query: { cadid: id } })
      .then((r) => { if (cadid.value === id) pb.value = r })
      .catch((e: any) => { if (cadid.value === id) pbError.value = e?.data?.message || e?.message || 'Could not check the Pattern Book.' }),
  ])
}

/**
 * The clause at the head of a check ("cl 1.18(1)(b): ...", "3B.2(c): ...", "54(3)(b): ...") and its link: a dotted number is
 * a Codes SEPP clause, a plain one a Housing SEPP section (the secondary dwelling type is Housing SEPP Chapter 3).
 */
const CODES_URL = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2008-0572'
const HOUSING_URL = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714'
function clauseOf(says: string): { clause: string; text: string; url: string | null } {
  const m = says.match(/^(?:cl\s*|s\s*)?(\d+[A-Z]*(?:\.\d+[A-Z]*)?)((?:\([0-9A-Za-z]+\))*)\s*:\s*/)
  if (!m) return { clause: '', text: says, url: null }
  const dotted = m[1]!.includes('.')
  return { clause: `${dotted ? 'cl' : 's'} ${m[1]}${m[2]}`, text: says.slice(m[0].length), url: `${dotted ? CODES_URL : HOUSING_URL}#sec.${m[1]}` }
}

/** The RAG requirement for a CDC type key or a Pattern Book category. */
const reqFor = (key: string) => uses.value?.requirements?.find((r: Requirement) => r.key === key) ?? null
function ragCheck(rq: Requirement | null) {
  if (!rq) return null
  const u = uses.value?.uses.find(x => x.use === (rq.via ?? rq.uses[0]))
  const actual = rq.meets === true ? `${cap(rq.via!)} permitted with consent - ${u?.by.map(b => b.label).join('; ') ?? ''}`
    : rq.meets === false ? `${rq.uses.map(cap).join(' and ')} not permissible with consent here${u?.by.length ? ` - ${u.by.map(b => b.label).join('; ')}` : ''}`
      : 'the RAG engine cannot say for this lot'
  return { pass: rq.meets, actual, ragUse: rq.via ?? rq.uses[0] ?? null }
}

const cdcTypeRows = computed(() => (cdcTypes.value?.types ?? []).map((ty: any) => {
  const rq = reqFor(ty.key)
  const rag = uses.value?.engine === 'rag' ? ragCheck(rq) : null
  const all = (ty.checks ?? []).map((c: any) => {
    const cl = clauseOf(String(c.says ?? ''))
    if (c.column === 'permissibility' && rag) {
      const differs = rag.pass !== c.pass && c.pass != null
        ? `The Land Use Table alone says ${c.pass ? 'permissible' : 'not'} (${c.actual}); the SEPPs change it.` : ''
      return { raw: c, ...cl, clause: cl.clause || 'cl 1.18(1)(b)', says: cl.text, pass: rag.pass, actual: rag.actual, rag: true, ragUse: rag.ragUse, differs }
    }
    return { raw: c, ...cl, says: cl.text, pass: c.pass, actual: c.actual ?? '', rag: false, ragUse: null, differs: '' }
  })
  // lay the checks over the catalogue's requirements: a check belongs to a requirement that names its column or its words,
  // or whose clause it cites
  const used = new Set<any>()
  const reqRows = cdcReqs.value.filter(r => r.typeKey === ty.key).map((r) => {
    const c = all.find((x: any) => !used.has(x) && (
      (r.testedBy && (r.testedBy.includes(`"${x.raw.column}"`) || r.testedBy.includes(`\\"${x.raw.column}\\"`) || r.testedBy === x.raw.column || r.testedBy.includes(x.raw.says)))
      || (x.clause && x.clause.replace(/^(cl|s) /, '') === r.clause)))
    if (c) used.add(c)
    return c
      ? { ...c, clause: `cl ${r.clause}`, url: r.href ?? c.url, says: r.text || c.says }
      : { clause: `cl ${r.clause}`, url: r.href, says: r.text, pass: null, actual: 'not tested here', rag: false, ragUse: null, differs: '', untested: true }
  })
  const checks = [...all.filter((x: any) => !used.has(x)), ...reqRows]
  const blocked = (ty.generalBlockers ?? []).length > 0
  const fails = checks.filter((c: any) => c.pass === false)
  const open = checks.filter((c: any) => c.pass == null && !c.untested)
  const eligible = blocked || fails.length ? false : open.length ? null : true
  return {
    key: ty.key, name: ty.name, code: ty.code, checks,
    label: eligible === true ? 'Eligible' : eligible === false ? 'Not eligible' : 'Undecided', tone: eligible === true ? 'yes' : eligible === false ? 'no' : 'open',
    why: blocked ? 'a general prerequisite rules it out' : fails.length ? `fails ${fails.map((c: any) => c.clause || c.says).join(', ')}`
      : open.length ? `turns on ${open.map((c: any) => c.clause || c.says).join(', ')}` : `clears all ${checks.length} checks`,
    untested: (ty.untestedReasons ?? []).map((r: any) => `${r.count} ${r.reason}`),
    changed: eligible !== ty.eligible,
  }
}))

const cdcTypeVerdict = computed(() => {
  const rows = cdcTypeRows.value
  const yes = rows.filter((r: any) => r.tone === 'yes').map((r: any) => r.name)
  const changed = rows.filter((r: any) => r.changed).map((r: any) => r.name)
  return { tone: yes.length ? 'yes' : 'no',
    head: yes.length ? `Eligible for ${yes.length} of ${rows.length} complying development types: ${yes.join(', ')}.` : `Not eligible for any of the ${rows.length} complying development types.`,
    sub: `Every type also has design standards and requirements not tested here (listed under each).${changed.length ? ` Read with the SEPPs, ${changed.join(', ')} ${changed.length === 1 ? 'differs' : 'differ'} from the Land Use Table alone.` : ''}` }
})

const fmtNum = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v ?? '—'))
const PB_LABEL: Record<string, string> = { yes: 'Eligible', maybe: 'Likely - confirm', unlikely: 'Unlikely', no: 'Not eligible' }
const PB_TONE: Record<string, string> = { yes: 'yes', maybe: 'open', unlikely: 'open', no: 'no' }

const pbRows = computed(() => {
  const byCat = new Map<string, any[]>()
  for (const d of pb.value?.designs ?? []) { if (!byCat.has(d.category)) byCat.set(d.category, []); byCat.get(d.category)!.push(d) }
  return [...byCat.entries()].map(([category, designs]) => {
    const rq = reqFor(`pb:${category}`)
    const rag = uses.value?.engine === 'rag' ? ragCheck(rq) : null
    const isUseGate = (g: any) => /permissible with consent/.test(String(g.what ?? ''))
    const gates = (designs[0].gates ?? []).map((g: any) => {
      if (isUseGate(g) && rag) {
        const differs = rag.pass !== g.pass && g.pass != null ? `The Land Use Table alone says ${g.pass ? 'permissible' : 'not'} (${g.why}); the SEPPs change it.` : ''
        return { clause: g.clause, url: g.href ?? null, what: g.what, pass: rag.pass, why: rag.actual, rag: true, ragUse: rag.ragUse, differs }
      }
      return { clause: g.clause, url: g.href ?? null, what: g.what, pass: g.pass, why: g.why, rag: false, ragUse: null, differs: '' }
    })
    const useOk = gates.find((g: any) => g.rag)?.pass ?? null
    const otherFail = gates.some((g: any) => !g.rag && g.pass === false)
    const rows = designs.map((d: any) => {
      // the design's own verdict, unless the only thing that failed it was the land use the SEPPs now allow
      const onlyUse = d.bottomLine?.verdict === 'no' && (d.gates ?? []).every((g: any) => isUseGate(g) || g.pass !== false)
      const gov = (d.blocks ?? []).find((b: any) => b.governs) ?? (d.blocks ?? [])[0]
      let v: string = d.bottomLine?.verdict ?? 'maybe'
      if (useOk === false || otherFail) v = 'no'
      else if (onlyUse && useOk === true) v = gov?.qualifies === false ? 'no' : 'maybe'
      return { key: d.key, name: d.key.replace(/_/g, ' '), designer: d.designer, label: PB_LABEL[v] ?? v, tone: PB_TONE[v] ?? 'open', v,
        headline: onlyUse && useOk === true ? `Read with the SEPPs the land use is permissible; ${gov?.qualifies === false ? 'the lot still misses the design\'s dimensions' : 'the dimensions fit, the rest is to confirm'}.` : (d.bottomLine?.headline ?? ''),
        blocks: d.blocks ?? [], outstanding: d.bottomLine?.outstanding ?? [] }
    })
    const best = ['yes', 'maybe', 'unlikely', 'no'].find(v => rows.some((r: any) => r.v === v)) ?? 'no'
    const fit = rows.filter((r: any) => r.v === 'yes' || r.v === 'maybe').length
    return { category, pathway: designs[0].pathway, designs: rows, gates, label: PB_LABEL[best], tone: PB_TONE[best],
      why: fit ? `${fit} of ${rows.length} design${rows.length === 1 ? '' : 's'} could fit` : gates.some((g: any) => g.pass === false) ? `fails ${gates.filter((g: any) => g.pass === false).map((g: any) => g.clause).join(', ')}` : 'no design fits the lot' }
  })
})

const pbVerdict = computed(() => {
  const rows = pbRows.value
  const fit = rows.filter((r: any) => r.tone !== 'no').map((r: any) => r.category)
  return { tone: fit.length ? 'yes' : 'no',
    head: fit.length ? `Pattern Book designs that could fit: ${fit.join(', ')}.` : 'No Pattern Book design fits this lot.',
    sub: `${rows.length} categories, ${rows.reduce((n: number, r: any) => n + r.designs.length, 0)} designs. "Likely - confirm" means every check we can make passes but some (flood control lot, easements, what is built) need confirming.` }
})

// ── The side panel: every section, its verdict as a dot, and the one being read ─────────────────────
const navItems = computed(() => {
  const t = (tone: string | null | undefined) => tone ?? 'none'
  const hz = hazards.value
  const worstHazard = hz.some(h => h.status === 'whole') ? 'no' : hz.some(h => h.status === 'part') ? 'open' : hz.length ? 'yes' : null
  return [
    { id: 'lot', n: 1, label: 'Lot and frontage', tone: null, hint: '' },
    { id: 'access', n: 2, label: 'Access', tone: null, hint: '' },
    { id: 'slope', n: 3, label: 'Slope', tone: slope.value ? (slope.value.meanPct < 10 ? 'yes' : slope.value.meanPct < 15 ? 'open' : 'no') : null, hint: slope.value?.sentence ?? '' },
    { id: 'locality', n: 4, label: 'Locality and council', tone: null, hint: '' },
    { id: 'risks', n: 5, label: 'Risks', tone: worstHazard, hint: hz.map(h => `${h.title}: ${STATUS[h.status as Status]}`).join(' · ') },
    { id: 'constraints', n: 6, label: 'Planning constraints', tone: null, hint: '' },
    { id: 'lmr', n: 7, label: 'Low and mid rise housing', tone: lmr.value ? lmrVerdict.value.tone : null, hint: lmr.value ? lmrVerdict.value.head : '' },
    { id: 'subdivision', n: 8, label: 'Subdivision', tone: sub.value ? subVerdict.value.tone : null, hint: sub.value ? subVerdict.value.head : '' },
    { id: 'land-uses', n: 9, label: 'Housing land uses', tone: uses.value?.engine === 'rag' ? usesVerdict.value.tone : null, hint: uses.value?.engine === 'rag' ? usesVerdict.value.head : '' },
    { id: 'cdc', n: 10, label: 'Complying development', tone: cdcTypes.value ? cdcTypeVerdict.value.tone : null, hint: cdcTypes.value ? cdcTypeVerdict.value.head : '' },
    { id: 'build-to-rent', n: 11, label: 'Build-to-rent', tone: btrView.value?.tone ?? null, hint: btrView.value?.headline ?? '' },
    { id: 'affordable-housing', n: 12, label: 'Affordable housing bonus', tone: ahbView.value?.tone ?? null, hint: ahbView.value?.headline ?? '' },
    { id: 'pattern-book', n: 13, label: 'Pattern Book', tone: pb.value ? pbVerdict.value.tone : null, hint: pb.value ? pbVerdict.value.head : '' },
    { id: 'standards-stack', n: 14, label: 'What can I build', tone: null, hint: 'Pick a use, see every control' },
    { id: 'build', n: 15, label: 'Siting', tone: null, hint: 'Put a building on the lot and move it' },
    { id: 'dcp', n: 16, label: 'Council controls', tone: null, hint: "Every control the council's DCP states for this lot" },
    { id: 'land-use-table', n: '', label: 'Land Use Table', tone: null, hint: 'As written, how it resolves, and resolved against the Standard Instrument', support: true },
    { id: 'cdc-exclusions', n: '', label: 'Supporting checks', tone: null, hint: 'CDC land exclusions and environmentally sensitive areas', support: true },
  ].map(s => ({ ...s, tone: t(s.tone) }))
})

/** The section nearest the top of the screen, below the sticky search bar. */
const activeSection = ref('lot')
function onScroll() {
  let best = 'lot'
  for (const s of navItems.value) {
    const el = document.getElementById(s.id)
    if (el && el.getBoundingClientRect().top <= 120) best = s.id
  }
  activeSection.value = best
}
function goTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (el instanceof HTMLDetailsElement) el.open = true
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 76, behavior: 'smooth' })
  activeSection.value = id
  history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`)
}
onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

// ── Sections 10 and 11: build-to-rent (s 72) and the affordable housing bonus (s 15C) ────────────────────
// The limbs are /api/housing/at's (shared/housing-evaluate.ts); the two that are a land use test - s 72(2)(a)(i) and
// s 15C(1)(a) - read the Land Use Table alone there, so they are answered here by the RAG engine (section 9) instead.
const housing = ref<HousingAtResponse | null>(null)
const housingError = ref('')
async function loadHousing(id: string) {
  housing.value = null
  housingError.value = ''
  try {
    const r = await $fetch<HousingAtResponse>('/api/housing/at', { query: { cadid: id } })
    if (cadid.value === id) housing.value = r
  } catch (e: any) {
    if (cadid.value === id) housingError.value = e?.data?.message || e?.message || 'Could not check the Housing SEPP.'
  }
}
/** "72(2)(a)(i)" -> the Housing SEPP section 72 on the NSW legislation website. */
const housingClauseUrl = (clause: string) => `${HOUSING_URL}#sec.${clause.match(/^\d+[A-Z]*/)?.[0] ?? ''}`

type HLimb = { clause: string; label: string; pass: boolean | null; why: string; informational?: boolean; rag?: boolean; ragUse?: string | null; differs?: string }
const triOf = (limbs: HLimb[]): boolean | null => {
  const c = limbs.filter(l => !l.informational)
  return c.some(l => l.pass === true) ? true : c.some(l => l.pass === null) ? null : false
}

const btrView = computed(() => {
  const v = housing.value?.btr
  if (!v) return null as any
  const rq = reqFor('btr')
  const ru = rq ? uses.value?.uses.find(x => x.use === rq.uses[0]) : null
  const limbs: HLimb[] = v.limbs.map((l) => {
    if (l.clause !== '72(2)(a)(i)' || !ru) return { ...l }
    // "under another environmental planning instrument": a grant in the Housing SEPP itself (Chapter 6, s 174) is limb (a2)
    const lepGrant = ru.verdict === 'permitted' && ru.consent === 'with' && ru.by.some(b => !/Housing SEPP/.test(b.label))
    const pass = ru.verdict === 'prohibited' || (ru.verdict === 'permitted' && !lepGrant) ? false : lepGrant ? true : null
    const why = lepGrant ? `Residential flat buildings permitted with consent - ${ru.by.map(b => b.label).join('; ')}.`
      : ru.verdict === 'permitted' ? `Only the Housing SEPP permits residential flat buildings here (${ru.by.map(b => b.label).join('; ')}) - that is the Chapter 6 route, s 72(2)(a2), not another plan.`
        : ru.verdict === 'prohibited' ? `Residential flat buildings are prohibited here - ${ru.by.map(b => b.label).join('; ')}.` : 'The RAG engine cannot say for this lot.'
    return { ...l, pass, why, rag: true, ragUse: ru.use, differs: pass !== l.pass && l.pass != null ? `The Land Use Table alone says ${l.pass ? 'yes' : 'no'}.` : '' }
  })
  const eligible = triOf(limbs)
  const via = limbs.filter(l => l.pass === true && !l.informational).map(l => `s ${l.clause}`)
  return {
    tone: eligible === true ? 'yes' : eligible === false ? 'no' : 'open', limbs, exclusions: v.exclusions, allowances: v.allowances, flags: v.flags,
    limbsTitle: 'The routes in (s 72(2)) - any one is enough',
    headline: eligible === true ? `Build-to-rent is permitted with consent here, through ${via.join(' and ')}.`
      : eligible === false ? 'None of the s 72(2) routes reaches this lot.' : `It depends on ${limbs.filter(l => l.pass === null && !l.informational).map(l => `s ${l.clause}`).join(', ')}.`,
    sub: 'Build-to-rent: at least 50 homes for rent under residential tenancy agreements, on one lot, held by one owner. A site compatibility certificate (s 72(2)(b)) can open it on any lot.',
  }
})

const ahbView = computed(() => {
  const v = housing.value?.ahb
  if (!v) return null as any
  const rq = reqFor('ahb')
  const btrOk = btrView.value?.tone === 'yes'
  const limbs: HLimb[] = v.limbs.map((l) => {
    if (l.clause !== '15C(1)(a)' || !rq) return { ...l }
    const rs = rq.uses.map(u => uses.value?.uses.find(x => x.use === u)).filter(Boolean) as UseSummary[]
    const yes = rs.filter(r => r.meets === true)
    // build-to-rent and a TOD area are routes the land use answers do not carry; keep the check's own word for them
    const other = /build-to-rent|Chapter 5/.test(l.why) || btrOk
    const pass = yes.length || other ? true : rs.length && rs.every(r => r.meets === false) ? false : null
    const why = yes.length ? `${yes.map(r => cap(r.use)).join(', ')} permitted with consent - ${[...new Set(yes.flatMap(r => r.by.map(b => b.label)))].join('; ')}.`
      : other ? l.why : pass === false ? 'None of the residential forms (s 15B(1)) is permitted with consent here.' : 'The RAG engine cannot say for this lot.'
    return { ...l, pass, why, rag: true, ragUse: yes[0]?.use ?? rq.uses[0] ?? null, differs: pass !== l.pass && l.pass != null ? `The Land Use Table alone says ${l.pass ? 'yes' : 'no'}.` : '' }
  })
  const counted = limbs.filter(l => !l.informational)
  const excluded = v.exclusions.filter(e => e.pass === true)
  const eligible = excluded.length ? false : counted.some(l => l.pass === false) ? false : counted.every(l => l.pass === true) ? true : null
  return {
    tone: eligible === true ? 'yes' : eligible === false ? 'no' : 'open', limbs, exclusions: v.exclusions, flags: v.flags,
    allowances: eligible === false ? [] : v.allowances,
    limbsTitle: 'The tests (s 15C(1)) - all must hold',
    headline: excluded.length ? `Not available: the lot is excluded by ${excluded.map(e => `s ${e.clause}`).join(', ')}.`
      : eligible === true ? 'The bonus is available here, for development with at least 10% affordable housing.'
        : eligible === false ? `Not available: fails ${counted.filter(l => l.pass === false).map(l => `s ${l.clause}`).join(' and ')}.`
          : `It depends on ${counted.filter(l => l.pass === null).map(l => `s ${l.clause}`).join(', ')}.`,
    sub: 'The in-fill affordable housing bonus: up to 30% more floor space and height when at least 10% of the floor area is affordable housing for 15 years.',
  }
})

// ── Section 2: access - the lot in its street, from the same /api/lotprofile row as section 1 ─────────────
/**
 * The addressing record abbreviates the road type ("Salmon Ct") where the frontages spell it out ("SALMON COURT"):
 * expanded before any comparison or display (the same pairs as shared/frontage.mjs TYPE_ABBREV, plus common variants).
 */
const ROAD_TYPES: Record<string, string> = { st: 'street', rd: 'road', av: 'avenue', ave: 'avenue', pde: 'parade', dr: 'drive', pl: 'place',
  ct: 'court', cr: 'crescent', cres: 'crescent', cl: 'close', ln: 'lane', tce: 'terrace', hwy: 'highway', bvd: 'boulevard', blvd: 'boulevard',
  cct: 'circuit', esp: 'esplanade', gr: 'grove', pwy: 'parkway', wy: 'way', sq: 'square', gdns: 'gardens', mwy: 'motorway', fwy: 'freeway' }
const fullRoad = (s: string) => s.trim().replace(/\s+(\w+)\.?$/, (w, ty) => ` ${ROAD_TYPES[ty.toLowerCase()] ?? ty}`)
const roadKey = (s: string | null | undefined) => fullRoad(s ?? '').toLowerCase().replace(/\s+/g, ' ')
const access0 = computed(() => detail.value?.access?.[0] ?? null)
/** The address that was opened, else the lot's primary address, else any point on the lot. */
const accessPoint = computed(() => {
  const a = detail.value?.addresses ?? []
  const row = a.find(x => x.msoid === msoid.value) ?? a.find(x => x.is_primary_address) ?? a[0]
  if (row && row.point_lon != null && row.point_lat != null) return { lon: Number(row.point_lon), lat: Number(row.point_lat) }
  const pt = detail.value?.points?.[0]
  return pt ? { lon: pt.lon, lat: pt.lat } : null
})
const accessSummary = computed(() => {
  const rs = runs.value
  const a = access0.value
  const primary = rs.find(r => r.isPrimary)
  const streets = names(rs.map(r => r.road))
  if (!rs.length) return 'The lot has no boundary on a street.'
  const front = rs.length === 1 ? `The lot fronts ${streets[0] ?? 'an unnamed road'}` : `The lot fronts ${streets.join(' and ')}`
  const prim = primary && rs.length > 1 ? `; its primary frontage is ${m(primary.lengthM)} on ${primary.road ? titleCase(primary.road) : 'an unnamed road'}` : primary ? ` for ${m(primary.lengthM)}` : ''
  const way = a ? ` The addressing record puts its road access on ${a.wayRoad ? titleCase(fullRoad(a.wayRoad)) : 'no matched road'}${a.wayRoadM != null ? `, ${m(a.wayRoadM)} from the road` : ''}.` : ' No road access point is recorded for its address.'
  return `${front}${prim}.${way}`
})
/** Where the record's access road is not a road the lot actually fronts - a handle, a right of way, or a stale record. */
const accessNote = computed(() => {
  const a = access0.value
  if (!a?.wayRoad || !runs.value.length) return ''
  const fronted = new Set(runs.value.map(r => roadKey(r.road)))
  return fronted.has(roadKey(a.wayRoad)) ? ''
    : `The addressing record's access is on ${titleCase(fullRoad(a.wayRoad))}, which the lot does not front - access may be by a right of way or a shared driveway; check the title.`
})

// ── Section 3: slope - derived.lot_slope through /api/lotslope, the row /testing-slope traces ─────────────
const slopeDetail = ref<any>(null)
const slopeError = ref('')
async function loadSlope(id: string) {
  slopeDetail.value = null
  slopeError.value = ''
  try {
    const r = await $fetch<any>('/api/lotslope', { query: { cadid: id } })
    if (cadid.value === id) slopeDetail.value = r
  } catch (e: any) {
    if (cadid.value === id) slopeError.value = e?.data?.message || e?.message || 'Could not read the slope.'
  }
}

/** Grades by mean slope, in percent - the bands planners and builders talk in. */
const SLOPE_GRADES = [
  { upTo: 5, grade: 'Flat', color: '#16a34a', means: 'Easy to build on: little or no cut and fill, simple drainage and driveway.' },
  { upTo: 10, grade: 'Gentle', color: '#65a30d', means: 'A little cut and fill or a stepped slab; most standard designs fit.' },
  { upTo: 15, grade: 'Moderate', color: '#ca8a04', means: 'Expect a split-level or stepped design, retaining walls and a longer driveway ramp.' },
  { upTo: 25, grade: 'Steep', color: '#ea580c', means: 'Costly to build: suspended or split-level floors, engineered retaining, and a geotechnical report is likely.' },
  { upTo: Infinity, grade: 'Very steep', color: '#dc2626', means: 'Specialist design: pole or suspended construction, geotechnical engineering, and driveway grades past the usual 1 in 4 limit for homes.' },
]
const BAND_COLORS = ['#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#991b1b']

const slope = computed(() => {
  const s = slopeDetail.value?.slope
  if (!s || s.mean_slope_deg == null) return null
  const meanDeg = Number(s.mean_slope_deg), meanPct = Number(s.mean_slope_pct)
  const minPct = Number(s.min_slope_pct ?? meanPct), maxPct = Number(s.max_slope_pct ?? meanPct)
  const minDeg = Number(s.min_slope_deg ?? meanDeg), maxDeg = Number(s.max_slope_deg ?? meanDeg)
  const g = SLOPE_GRADES.find(x => meanPct < x.upTo)!
  /**
   * One cross-section, drawn at true scale (1 m across = 1 m up) so the ground looks as steep as it is: the lot's run
   * across the frame, the ground rising from one boundary to the other at the mean slope, and a level pad with its cut and
   * fill. Rising left to right; the label says which end is which.
   */
  const view = (key: string, title: string, sub: string, run: number, leftLabel: string, rightLabel: string) => {
    const W = 360, H = 200, xa = 20, xb = 300
    const fall = run * meanPct / 100
    const scale = Math.min((xb - xa) / run, 120 / Math.max(fall, 0.01))   // px per metre, the same both ways
    const runPx = run * scale, risePx = fall * scale
    const xbb = xa + runPx
    const base = 170, ya = base - 6, yb = ya - risePx, top = Math.min(yb, ya) - 52
    const yOn = (x: number) => ya - (x - xa) * (risePx / runPx)
    const mid = (xa + xbb) / 2, hw = Math.min(runPx * 0.3, 70), hx0 = mid - hw, hx1 = mid + hw
    const pad = (yOn(hx0) + yOn(hx1)) / 2, wallH = 26, roofH = 40
    // front view: a gable facade, its peak high enough to read as a gable end
    const house = [[hx0, pad], [hx0, pad - wallH], [mid, pad - wallH - Math.max(26, (hx1 - hx0) * 0.32)], [hx1, pad - wallH], [hx1, pad]].map(q => q.join(',')).join(' ')
    // side view: a hipped roof over the long wall - sloping ends, flat ridge
    const inset = Math.min(18, (hx1 - hx0) * 0.25)
    const roof = [[hx0 - 4, pad - wallH], [hx0 + inset, pad - roofH + 6], [hx1 - inset, pad - roofH + 6], [hx1 + 4, pad - wallH]].map(q => q.join(',')).join(' ')
    const span = hx1 - hx0
    const nWin = Math.max(2, Math.floor(span / 26))
    const windows = key === 'depth'
      ? Array.from({ length: nWin }, (_, i) => hx0 + (span / nWin) * (i + 0.5) - 4.5)
      : [hx0 + span * 0.18, hx1 - span * 0.18 - 10]
    const door = { x: mid - 6, w: 12, h: 18 }
    const padX0 = hx0 - 10, padX1 = hx1 + 10
    const fill = [[padX0, pad], [mid, pad], [padX0, yOn(padX0)]].map(q => q.join(',')).join(' ')
    const cut = [[mid, pad], [padX1, pad], [padX1, yOn(padX1)]].map(q => q.join(',')).join(' ')
    return {
      key, title, sub, run, fall, W, H, xa, xb: xbb, ya, yb, base, top, leftLabel, rightLabel, house, roof, windows, door, hx0, hx1, wallH, fill, cut, pad, padX0, padX1,
      ground: `${xa},${base} ${xa},${ya} ${xbb},${yb} ${xbb},${base}`,
      words: `If the ground runs this way it falls up to ${fall.toFixed(1)} m across the ${run.toFixed(1)} m (${(fall / 3).toFixed(1)} storeys); a level slab ${(hw * 2 / scale).toFixed(0)} m long needs about ${((hw * 2 / scale) * meanPct / 100 / 2).toFixed(1)} m of cut and fill each side.`,
    }
  }
  const l = lot.value
  // a battle-axe's depth runs down its handle; the body is where the house goes
  const depth = l?.is_battleaxe ? (n(l?.core_depth_m) ?? n(l?.lot_depth_m)) : n(l?.lot_depth_m)
  const width = n(l?.core_width_max_m) ?? n(l?.lot_width_max_m) ?? n(l?.width_at_setback_m) ?? n(l?.primary_frontage_length_m)
  const street = l?.primary_frontage_road ? titleCase(l.primary_frontage_road) : 'the street'
  const views = [
    depth ? view('depth', 'Side view', `front to back, across the ${l?.is_battleaxe ? 'body' : 'depth'}`, depth, street, 'rear') : null,
    width ? view('width', 'Front view', 'side to side, across the widest part', width, 'one side', 'other side') : null,
  ].filter(Boolean) as any[]
  const per10 = 10 * meanPct / 100
  const fall = views[0]?.fall ?? null
  // shares steeper than each threshold -> the share in each band
  const over = [5, 10, 15, 20, 25].map(k => Number(s[`share_over_${k}pct`] ?? 0))
  const cuts = [1, ...over, 0]
  const labels = ['under 5%', '5-10%', '10-15%', '15-20%', '20-25%', 'over 25%']
  const bands = labels.map((label, i) => ({ label, share: Math.max(0, cuts[i]! - cuts[i + 1]!), color: BAND_COLORS[i]! })).filter(b => b.share > 0.001)
  const steepShare = over[3] ?? 0
  const pixels = s.method === 'pixels'
  return {
    meanDeg, meanPct, minPct, maxPct, grade: g.grade, color: g.color, means: g.means, oneIn: meanPct > 0 ? (100 / meanPct).toFixed(1) : '∞',
    views, per10, bands,
    sentence: `${g.grade} - the ground falls about ${per10.toFixed(1)} m for every 10 m (${meanPct.toFixed(1)}%, ${meanDeg.toFixed(1)}°)${views.length === 2 ? `: up to ${views[0].fall.toFixed(1)} m front to back, or ${views[1].fall.toFixed(1)} m side to side, depending on which way it faces` : ''}.`,
    steepNote: steepShare >= 0.25 ? `${Math.round(steepShare * 100)}% of the lot is steeper than 20% - check the council's DCP for cut and fill limits, and expect a geotechnical report.` : '',
    cells: pixels ? Number(s.pixel_count) : 1, // cells along the boundary straddle it, so their area can pass the lot's
    coverage: pixels && s.coverage != null ? (Number(s.coverage) >= 0.995 ? 'the whole' : `${Math.round(Number(s.coverage) * 100)}%`) : 'one point (the lot is smaller than the grid)',
    sheets: String(s.sheets ?? '').replace(/-SLP-AHD_\d+_5m/g, '').replace(/,/g, ', '),
  }
})

// ── Reference: the Land Use Table, per zone the lot is in (the testing page's zone blocks) ─────────────
// The zone comes from the zoning polygon /api/epi/at already returned; /api/lep-permissibility resolves the plan and zone
// against nsw.lep_zones (as written) and nsw.lep_permissibility (every Standard Instrument term). A split lot gets one block
// per zone.
interface LutZone { code: string; className: string; plan: string; coverPct: number; detail: ZoneDetail | null; error: string }
const lutZones = ref<LutZone[]>([])
watch(epi, async (e) => {
  const id = cadid.value
  const found = (e?.hits ?? []).filter(h => h.layer === 'epi_land_zoning' && h.symCode && h.epiName)
    .sort((a, b) => (b.coverPct ?? 0) - (a.coverPct ?? 0))
  // one block per zone and plan, the largest share first
  const seen = new Set<string>()
  lutZones.value = found.filter(h => !seen.has(`${h.symCode}|${h.epiName}`) && seen.add(`${h.symCode}|${h.epiName}`))
    .map(h => ({ code: String(h.symCode), className: String(h.layClass ?? ''), plan: String(h.epiName), coverPct: Number(h.coverPct ?? 0), detail: null, error: '' }))
  await Promise.all(lutZones.value.map(async (z, i) => {
    try {
      const res: any = await $fetch('/api/lep-permissibility', { query: { name: z.plan, code: z.code } })
      if (cadid.value !== id) return
      const next = [...lutZones.value]
      next[i] = { ...z, detail: res?.ok && res?.zone ? (res as ZoneDetail) : null, error: res?.ok && res?.zone ? '' : `No Land Use Table for zone ${z.code} in ${z.plan}.` }
      lutZones.value = next
    } catch (err: any) {
      if (cadid.value !== id) return
      const next = [...lutZones.value]
      next[i] = { ...z, error: err?.data?.statusMessage || err?.message || 'Could not resolve that zone.' }
      lutZones.value = next
    }
  }))
})

// ── Section 6: the LEP maps' Additional Controls (epi.additional_controls), with the plan's words for each area ──────────
const ac = ref<{ controls: AdditionalControl[] } | null>(null)
const acError = ref('')
async function loadAc(id: string) {
  ac.value = null
  acError.value = ''
  try {
    const r = await $fetch<{ controls: AdditionalControl[] }>('/api/report/additional-controls', { query: { cadid: id } })
    if (cadid.value === id) ac.value = r
  } catch (e: any) {
    if (cadid.value === id) acError.value = e?.data?.message || e?.message || 'Could not read the Additional Controls.'
  }
}

// ── Section 6: the four principal standards as figures (/api/report/standards - the maps' value columns) ──────────
const std = ref<StandardsResponse | null>(null)
const stdError = ref('')
async function loadStd(id: string) {
  std.value = null
  stdError.value = ''
  try {
    const r = await $fetch<StandardsResponse>('/api/report/standards', { query: { cadid: id } })
    if (cadid.value === id) std.value = r
  } catch (e: any) {
    if (cadid.value === id) stdError.value = e?.data?.message || e?.message || 'Could not read the standards.'
  }
}
/**
 * Each card shows the map's base standard. An Additional Controls area stacked on it (an "Area 5" or CA polygon in the
 * same table) is not a second value for the card: it is listed once, in the additional controls block below, and the
 * card only notes it is there.
 */
const principalStd = computed(() => [
  { key: 'zone', title: 'Zone', all: std.value?.zone ?? [] },
  { key: 'height', title: 'Maximum building height', all: std.value?.height ?? [] },
  { key: 'fsr', title: 'Floor space ratio', all: std.value?.fsr ?? [] },
  { key: 'lot', title: 'Minimum lot size', all: std.value?.lotSize ?? [] },
].map((s) => {
  const isArea = (pn: StandardPanel) => !!pn.area || /^CA(\s|$)/.test(pn.value ?? '')
  const panels = s.all.filter(pn => !isArea(pn))
  return { ...s, panels, areas: [...new Set(s.all.filter(isArea).map(pn => pn.area ?? 'an area'))] }
}))
const stdClauseHref = (pn: StandardPanel) => clauseHref({ epiName: pn.plan, clause: pn.clause } as unknown as EpiHit)

/** A section's local id as a reader writes it: sec.4.4-ssec.2B-para1.c -> cl 4.4(2B)(c); sch.1-sec.10 -> Sch 1 item 10. */
function provLabel(localId: string): string {
  const sch = localId.match(/^sch\.(\d+)-sec\.([^-]+)(.*)$/)
  const head = sch ? `Sch ${sch[1]} item ${sch[2]}` : localId.replace(/^sec\.([^-]+).*$/, 'cl $1')
  const rest = (sch ? sch[3] : localId.replace(/^sec\.[^-]+/, '')) ?? ''
  const parts = [...rest.matchAll(/-(?:ssec|para\d+)\.([0-9A-Za-z]+)/g)].map(m => `(${m[1]})`)
  return head + parts.join('')
}

/** One RAG claim in words: what land a frame applies to, what a grant permits, what a standard sets. */
function claimWords(k: AcClaim): string {
  if (k.kind === 'frame') return `applies to ${k.terms.map(x => x.replace(/^mapped:/, '')).join('; ') || 'the land the clause names'}`
  if (k.kind === 'permit') return `permits ${k.uses.join(', ') || 'development'}${k.consent === 'with' ? ' with consent' : k.consent === 'without' ? ' without consent' : ''}`
  if (k.kind === 'prohibit') return `prohibits ${k.uses.join(', ') || 'development'}`
  if (k.kind === 'standard') {
    const v = k.value == null ? '' : k.topic === 'fsr' ? `${k.value}:1` : `${k.value}${k.unit ? ` ${k.unit === 'm2' ? 'm²' : k.unit}` : ''}`
    return `sets ${({ fsr: 'floor space ratio', height: 'building height', lot_size: 'minimum lot size', lot_width: 'lot width' } as Record<string, string>)[k.topic ?? ''] ?? k.topic ?? 'a standard'}${v ? ` ${v}` : ''}${k.uses.length ? ` for ${k.uses.join(', ')}` : ''}`
  }
  return k.span ?? k.kind
}

// ── Section 14: siting (components/SitingStudio.vue does the work; the page shows a figure's RAG trace) ─────────────
// the use being sited is the one chosen in section 14 (What can I build) - set from its 'use' event
const sitingType = ref('')
const sitingLabel = ref('')
const sitingTrace = ref<{ topic: string; d: SitingTrace | null; error?: string } | null>(null)
const SITING_TOPIC_LABEL: Record<string, string> = { parking: 'Parking', height: 'Height', fsr: 'Floor space ratio', floor_area: 'Floor area', lot_size: 'Minimum lot size', lot_width: 'Minimum lot width', permissibility: 'Permissible' }
async function openSitingTrace(topic: string) {
  const id = cadid.value
  sitingTrace.value = { topic, d: null }
  try {
    const d = await $fetch<SitingTrace>('/api/report/siting', { query: { cadid: id, type: sitingType.value, topic } })
    if (sitingTrace.value?.topic === topic && cadid.value === id) sitingTrace.value = { topic, d }
  } catch (e: any) {
    sitingTrace.value = { topic, d: null, error: e?.data?.message || e?.message || 'Could not load the trace.' }
  }
}
watch(cadid, () => { sitingTrace.value = null; stackTrace.value = null })

// ── The summary band's housing chips pick a use in "What can I build"; one sheet shows either section's trace ──
const buildPick = ref<string | null>(null)
const sheetTrace = computed(() => stackTrace.value ?? sitingTrace.value)
const sheetTitle = computed(() => {
  const t = stackTrace.value
  if (t) return `${cap(t.use)} · ${SITING_TOPIC_LABEL[t.topic] ?? t.topic}`
  const st = sitingTrace.value
  return st ? `${cap(sitingLabel.value || sitingType.value)} · ${SITING_TOPIC_LABEL[st.topic] ?? st.topic}` : ''
})

// ── Section 14: development standards (components/ControlStack.vue); a clause opens the RAG trace for that use and topic ──
const stackTrace = ref<{ use: string; topic: string; d: SitingTrace | null; error?: string } | null>(null)
async function openStackTrace({ use, topic }: { use: string; topic: string }) {
  const id = cadid.value
  stackTrace.value = { use, topic, d: null }
  try {
    const d = await $fetch<SitingTrace>('/api/report/siting', { query: { cadid: id, type: use, topic } })
    if (stackTrace.value?.use === use && stackTrace.value.topic === topic && cadid.value === id) stackTrace.value = { use, topic, d }
  } catch (e: any) {
    stackTrace.value = { use, topic, d: null, error: e?.data?.message || e?.message || 'Could not load the trace.' }
  }
}
</script>

<style scoped>
/* The report's palette (app/assets/css/tailwind.css carries the same values for the shadcn-vue components): a cool
   neutral, one planning-blue accent, and the verdict colours. These names are the page's own; the components use --ui-*. */
.r2 {
  --ink: #101418; --muted: #5b6570; --faint: #8b949e; --line: #e3e7eb; --soft: #f1f3f5; --accent: #1d4ed8;
  min-height: 100vh; background: #f7f8f9; color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Segoe UI", system-ui, sans-serif; font-size: 14.5px; line-height: 1.55;
}
/* the trace sheet's content: the page's styles without the page's ground */
.r2--sheet { min-height: 0; background: transparent; }
.r2-top {
  position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 20px;
  padding: 10px 24px; background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line);
}
.r2-back { color: var(--muted); text-decoration: none; font-size: 0.85rem; white-space: nowrap; }
.r2-search { position: relative; flex: 1; max-width: 560px; }
.r2-input {
  width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px;
  font: inherit; font-size: 0.9rem; background: var(--soft);
}
.r2-input:focus { outline: 2px solid #93b4f8; background: #fff; }
.r2-busy { position: absolute; right: 12px; top: 9px; font-size: 0.75rem; color: var(--faint); }
.r2-list {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 4px; list-style: none;
  background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  max-height: 340px; overflow: auto;
}
.r2-opt { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 0.88rem; }
.r2-opt--on { background: #e8efff; }
.r2-page { max-width: 920px; margin: 0 auto; padding: 24px 24px 80px; }
.r2-empty { margin-top: 80px; text-align: center; color: var(--muted); }
.r2-title { border-bottom: 2px solid var(--ink); padding-bottom: 16px; margin-bottom: 28px; }
.r2-kicker { margin: 0; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
.r2-title h1 { margin: 4px 0 6px; font-size: 1.7rem; font-weight: 650; letter-spacing: -0.01em; }
.r2-ids { margin: 0; display: flex; flex-wrap: wrap; gap: 16px; color: var(--muted); font-size: 0.88rem; }
/* each section is a card on the page ground */
.r2-section {
  background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 20px 24px 22px;
  box-shadow: 0 1px 2px rgba(16, 20, 24, 0.05), 0 1px 1px rgba(16, 20, 24, 0.03);
  scroll-margin-top: 72px;
}
.r2-section h2 { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; font-size: 1.12rem; font-weight: 600; letter-spacing: -0.01em; }
.r2-num { font-family: "SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", Consolas, monospace; font-size: 0.78rem; font-weight: 500; color: var(--faint); }
.r2-section h3 { margin: 28px 0 6px; font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.r2-section p { margin: 0 0 6px; }
.r2-lead { font-size: 1.02rem; }
.r2-split { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 28px; align-items: start; margin-top: 18px; }
.r2-figure { margin: 0; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
.r2-figure figcaption { font-size: 0.75rem; color: var(--faint); text-align: center; }
.r2-facts { margin: 0; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
.r2-fact { padding: 12px 0; border-bottom: 1px solid var(--line); }
.r2-fact:nth-child(odd) { padding-right: 12px; }
.r2-fact dt { font-size: 0.75rem; color: var(--muted); }
.r2-fact dd { margin: 2px 0 0; font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.r2-fact dd.r2-sub { margin: 0; font-size: 0.75rem; font-weight: 400; color: var(--faint); }
.r2-yes { color: var(--accent); }
.r2-none { color: var(--faint); }
.r2-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.r2-table th { text-align: left; font-size: 0.72rem; font-weight: 600; color: var(--muted); padding: 6px 0; border-bottom: 1px solid var(--line); }
.r2-table td { padding: 8px 0; border-bottom: 1px solid var(--line); }
.r2-r { text-align: right; font-variant-numeric: tabular-nums; padding-right: 16px !important; }
.r2-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 8px; vertical-align: middle; }
.r2-tag { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; background: #e8efff; color: var(--accent); border: 1px solid #c7d7fe; }
.r2-mini { margin: 8px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 24px; }
.r2-mini dt { font-size: 0.75rem; color: var(--muted); }
.r2-mini dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.r2-small { font-size: 0.82rem; color: var(--muted); margin-top: 6px !important; }
.r2-note, .r2-muted { color: var(--muted); }
.r2-warn { font-size: 0.85rem; color: #b45309; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 6px 10px; margin-top: 8px !important; }
.r2-error { color: #b91c1c; }
.r2-foot { margin-top: 32px !important; padding-top: 12px; border-top: 1px solid var(--line); font-size: 0.78rem; color: var(--faint); }
.r2-foot a { color: var(--muted); }
.r2-section + .r2-section, .r2-section + * + .r2-section { margin-top: 18px; }
.r2-mini--wide { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.r2-mini a, .r2-chips a, .r2-std-meta a, .r2-con-meta a { color: var(--accent); text-decoration: none; }
.r2-mini a:hover, .r2-chips a:hover, .r2-std-meta a:hover, .r2-con-meta a:hover { text-decoration: underline; }
.r2-chips { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.r2-chips li { font-size: 0.82rem; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--soft); }
.r2-std { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.r2-std-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.r2-std-card--none { background: var(--soft); }
.r2-std-card p { margin: 0 !important; }
.r2-std-title { font-size: 0.75rem; color: var(--muted); }
.r2-std-hit + .r2-std-hit { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }
.r2-std-val { font-size: 1.15rem; font-weight: 600; margin-top: 2px !important; }
.r2-std-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.74rem; color: var(--faint); margin-top: 3px !important; }
.r2-con { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); gap: 20px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.r2-con p { margin: 0 !important; }
.r2-con-title { font-weight: 600; }
.r2-con-desc { font-size: 0.78rem; color: var(--faint); margin-top: 2px !important; }
.r2-con-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.r2-con-val { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.r2-con-meta { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 0.76rem; color: var(--faint); margin-top: 2px !important; }
.r2-cover { font-size: 0.72rem; color: var(--muted); }
.r2-cover--part { color: #b45309; font-weight: 600; }
.r2-tag--warn { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
.r2-risks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.r2-risk { border: 1px solid var(--line); border-top: 4px solid #16a34a; border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.r2-risk--part { border-top-color: #f59e0b; }
.r2-risk--whole { border-top-color: #dc2626; }
.r2-risk p { margin: 0 !important; }
.r2-risk-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.r2-risk-title { font-weight: 650; }
.r2-pill { font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; background: #f0fdf4; color: #15803d; white-space: nowrap; }
.r2-risk--part .r2-pill { background: #fffbeb; color: #b45309; }
.r2-risk--whole .r2-pill { background: #fef2f2; color: #b91c1c; }
.r2-risk-line { font-size: 0.95rem; font-weight: 500; }
.r2-risk-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.r2-risk-rows li { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 2px 8px; font-size: 0.82rem; }
.r2-bar { height: 6px; background: var(--soft); border-radius: 3px; overflow: hidden; border: 1px solid var(--line); }
.r2-bar span { display: block; height: 100%; background: #94a3b8; }
.r2-risk--part .r2-bar span { background: #f59e0b; }
.r2-risk--whole .r2-bar span { background: #dc2626; }
.r2-risk-pct { font-variant-numeric: tabular-nums; color: var(--muted); }
.r2-risk-sub { grid-column: 2 / 4; font-size: 0.72rem; color: var(--faint); }
.r2-risk-mean { font-size: 0.82rem; color: var(--muted); }
.r2-risk-src { font-size: 0.7rem; color: var(--faint); margin-top: auto !important; }
.r2-verdict { border-left: 4px solid #16a34a; background: #f0fdf4; border-radius: 6px; padding: 12px 16px; margin: 6px 0 4px; }
.r2-verdict--no { border-left-color: #dc2626; background: #fef2f2; }
.r2-verdict--open { border-left-color: #f59e0b; background: #fffbeb; }
.r2-verdict p { margin: 0 !important; }
.r2-verdict-head { font-weight: 650; font-size: 1.02rem; }
.r2-verdict-sub { font-size: 0.86rem; color: var(--muted); margin-top: 3px !important; }
.r2-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.r2-checks li { display: grid; grid-template-columns: 10px 84px minmax(0, 1fr) minmax(0, 1.2fr); gap: 10px; align-items: baseline; font-size: 0.84rem; padding: 4px 0; border-bottom: 1px solid var(--soft); }
.r2-dot { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; align-self: center; }
.r2-check--no .r2-dot { background: #dc2626; }
.r2-check--open .r2-dot { background: #f59e0b; }
.r2-check--no .r2-check-why { color: #b91c1c; font-weight: 600; }
.r2-check-why { color: var(--muted); font-size: 0.8rem; }
.r2-cl { color: var(--accent); text-decoration: none; font-variant-numeric: tabular-nums; }
.r2-td-sub { display: block; font-size: 0.74rem; color: var(--faint); }
.r2-td-sub2 { font-size: 0.8rem; color: var(--muted); }
.r2-forms td { vertical-align: top; padding-right: 12px; }
.r2-gate { font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; white-space: nowrap; border: 1px solid; }
.r2-gate--yes { color: #15803d; background: #f0fdf4; border-color: #86efac; }
.r2-gate--no { color: #b91c1c; background: #fef2f2; border-color: #fca5a5; }
.r2-gate--open { color: #b45309; background: #fffbeb; border-color: #fcd34d; }
.r2-hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.r2-hits li { padding: 6px 0; border-bottom: 1px solid var(--soft); }
.r2-hits p { margin: 0 !important; }
.r2-hit-title { font-weight: 500; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.r2-hit-meta { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 0.76rem; color: var(--faint); margin-top: 2px !important; }
.r2-small--tight { margin: 0 0 6px !important; }
.r2-chips--grey li { background: #fff; color: var(--muted); }
.r2-tenures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 12px; }
.r2-tenure { border: 1px solid var(--line); border-top: 4px solid #f59e0b; border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.r2-tenure--yes { border-top-color: #16a34a; }
.r2-tenure--no { border-top-color: #dc2626; }
.r2-tenure p { margin: 0 !important; }
.r2-ten-line { font-size: 0.86rem; font-weight: 500; }
.r2-ten-limit { font-size: 0.8rem; color: var(--muted); }
.r2-ten-h { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--faint); margin-top: 4px !important; }
.r2-ten-list { margin: 0; padding-left: 16px; font-size: 0.78rem; color: var(--muted); display: grid; gap: 2px; }
.r2-uses { table-layout: fixed; }
.r2-uses th:nth-child(1) { width: 30%; }
.r2-uses th:nth-child(2) { width: 22%; }
.r2-uses th:nth-child(4) { width: 96px; }
.r2-uses td { vertical-align: top; padding-right: 10px; overflow-wrap: anywhere; }
.r2-uses-open td { background: var(--soft); }
.r2-trace-btn { font: inherit; font-size: 0.74rem; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--accent); cursor: pointer; white-space: nowrap; }
.r2-trace-btn:hover { border-color: var(--accent); }
.r2-trace-cell { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px !important; margin: 6px 0 10px; }
.r2-usegroup { margin-bottom: 12px; }
.r2-usegroup-h { margin: 6px 0 !important; display: flex; align-items: center; gap: 8px; }
.r2-usechips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 5px; }
.r2-usechip { font: inherit; font-size: 0.78rem; padding: 2px 9px; border: 1px solid var(--line); border-radius: 999px; background: #fff; cursor: pointer; color: var(--ink); }
.r2-usechip:hover, .r2-usechip--on { border-color: var(--accent); color: var(--accent); }
.r2-purposes { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
.r2-purpose { font: inherit; font-size: 0.84rem; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.r2-purpose--on { border-color: var(--ink); box-shadow: inset 0 -2px 0 var(--ink); }
.r2-ten-branches li { list-style: none; margin-left: -16px; padding-left: 10px; border-left: 3px solid #f59e0b; }
.r2-ten-branches li.r2-br--yes { border-left-color: #16a34a; }
.r2-ten-branches li.r2-br--no { border-left-color: #dc2626; }
.r2-provs { margin-top: 14px; font-size: 0.82rem; }
.r2-provs summary { cursor: pointer; color: var(--accent); }
.r2-prov { padding: 8px 0; border-bottom: 1px solid var(--line); }
.r2-prov p { margin: 0 !important; }
.r2-prov-stem { font-size: 0.74rem; color: var(--faint); }
.r2-prov-text { font-size: 0.78rem; color: var(--muted); white-space: pre-wrap; }
.r2-gridwrap { overflow-x: auto; margin-top: 14px; }
.r2-grid { width: 100%; border-collapse: separate; border-spacing: 6px; table-layout: fixed; }
.r2-grid th { text-align: left; vertical-align: top; font-size: 0.86rem; font-weight: 650; padding: 4px 6px; }
.r2-grid thead th { border-bottom: 1px solid var(--line); }
.r2-grid tbody th { width: 26%; }
.r2-grid-corner { width: 26%; }
.r2-grid-axis { display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.r2-grid-means { display: block; font-size: 0.72rem; font-weight: 400; color: var(--faint); line-height: 1.35; margin-top: 2px; }
.r2-grid td { padding: 0; vertical-align: middle; }
.r2-grid-cell { width: 100%; font: inherit; font-weight: 650; font-size: 0.9rem; padding: 12px 8px; border-radius: 8px; border: 1px solid; cursor: pointer; }
.r2-grid-cell--yes { background: #f0fdf4; color: #15803d; border-color: #86efac; }
.r2-grid-cell--no { background: #fef2f2; color: #b91c1c; border-color: #fca5a5; }
.r2-grid-cell--open { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
.r2-grid-cell--on { box-shadow: 0 0 0 2px var(--ink); }
.r2-cellwhy { margin-top: 6px; }
.r2-tested li { list-style: none; margin-left: -16px; padding: 3px 0 3px 10px; border-left: 3px solid #cbd5e1; }
.r2-tested li.r2-tested--yes { border-left-color: #16a34a; }
.r2-tested li.r2-tested--open { border-left-color: #f59e0b; }
.r2-tested-st { margin-left: 8px; font-size: 0.72rem; color: var(--muted); }
.r2-tested-why { display: block; font-size: 0.72rem; color: var(--faint); }
.r2-reqs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.r2-reqlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.r2-reqlist li { display: grid; grid-template-columns: 20px minmax(0, 0.9fr) minmax(0, 1.4fr); gap: 8px; font-size: 0.82rem; padding: 6px 0; border-bottom: 1px solid var(--soft); }
.r2-req-mark { font-weight: 700; text-align: center; }
.r2-req--yes .r2-req-mark { color: #15803d; }
.r2-req--no .r2-req-mark { color: #b91c1c; }
.r2-req--open .r2-req-mark { color: #b45309; }
.r2-req-name { font-weight: 600; }
.r2-req-why { color: var(--muted); font-size: 0.78rem; }
.r2-linkbtn { font: inherit; color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer; border-bottom: 1px dotted var(--accent); }
.r2-more2 { margin-top: 16px; }
.r2-more2 summary { cursor: pointer; color: var(--accent); font-size: 0.86rem; }
.r2-elig { border-bottom: 1px solid var(--line); padding: 6px 0; }
.r2-elig > summary { display: grid; grid-template-columns: minmax(0, 1.1fr) auto minmax(0, 1.4fr); gap: 12px; align-items: center; cursor: pointer; list-style: none; padding: 6px 0; }
.r2-elig > summary::-webkit-details-marker { display: none; }
.r2-elig > summary::before { content: '▸'; position: absolute; margin-left: -14px; color: var(--faint); }
.r2-elig[open] > summary::before { content: '▾'; }
.r2-elig-name { font-weight: 600; }
.r2-elig-why { font-size: 0.8rem; color: var(--muted); }
.r2-elig-checks { list-style: none; margin: 6px 0 8px; padding: 0; display: grid; gap: 4px; }
.r2-elig-checks li { display: grid; grid-template-columns: 10px 110px minmax(0, 1fr) minmax(0, 1.2fr); gap: 10px; align-items: baseline; font-size: 0.82rem; padding: 4px 0; border-bottom: 1px solid var(--soft); }
.r2-elig-cl { font-variant-numeric: tabular-nums; }
.r2-elig-actual { color: var(--muted); font-size: 0.8rem; }
.r2-pbdesign { padding: 8px 0; border-top: 1px dashed var(--line); }
.r2-pbdesign p { margin: 0 !important; }
.r2-pbdesign-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.r2-pbblocks { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 3px; }
.r2-pbblocks li { font-size: 0.78rem; color: var(--faint); display: flex; flex-wrap: wrap; gap: 4px 10px; }
.r2-pbblock--gov { color: var(--ink) !important; }
.r2-pbblock-name { font-weight: 600; min-width: 190px; }
.r2-pbcheck--no { color: #b91c1c; }
.r2-pbcheck--yes { color: #15803d; }
.r2-layout { display: block; }
.r2-layout--nav { display: grid; grid-template-columns: 272px minmax(0, 920px); gap: 28px; justify-content: center; padding: 0 24px; }
.r2-layout--nav .r2-page { margin: 0; padding-left: 0; padding-right: 0; }
.r2-nav { position: sticky; top: 72px; align-self: start; max-height: calc(100vh - 90px); overflow-y: auto; padding: 32px 0 24px; }
.r2-nav-title { margin: 0 0 10px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); line-height: 1.35; }
.r2-nav-link { display: grid; grid-template-columns: 22px minmax(0, 1fr) 10px; align-items: center; gap: 8px; padding: 6px 8px; white-space: nowrap; border-radius: 8px; color: var(--muted); text-decoration: none; font-size: 0.84rem; border: 1px solid transparent; }
.r2-nav-link:hover { background: var(--soft); color: var(--ink); }
.r2-nav-link--on { color: var(--ink); background: #fff; border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(16, 20, 24, 0.05); font-weight: 600; }
.r2-nav-label { overflow: hidden; text-overflow: ellipsis; }
.r2-nav-num { font-family: "SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", Consolas, monospace; font-size: 0.7rem; color: var(--faint); font-variant-numeric: tabular-nums; text-align: right; }
.r2-nav-dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; }
.r2-nav-dot--yes { background: #16a34a; }
.r2-nav-dot--no { background: #dc2626; }
.r2-nav-dot--open { background: #f59e0b; }
.r2-support { margin-top: 56px !important; padding-top: 0 !important; border-top: 0 !important; }
.r2-support-summary { cursor: pointer; list-style: none; padding: 14px 16px; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); font-size: 0.9rem; font-weight: 600; }
.r2-support-summary::-webkit-details-marker { display: none; }
.r2-support-summary::before { content: '▸ '; color: var(--faint); }
.r2-support[open] > .r2-support-summary::before { content: '▾ '; }
.r2-support[open] > .r2-support-summary { margin-bottom: 14px; }
.r2-support-kicker { display: block; font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); font-weight: 600; }
.r2-support-hint { display: block; font-size: 0.76rem; font-weight: 400; color: var(--faint); }
.r2-nav-link--support { margin-top: 10px; border-top: 1px dashed var(--line); border-radius: 0; font-size: 0.78rem; color: var(--faint); }
.r2-nav-link--support + .r2-nav-link--support { margin-top: 0; border-top: 0; }
.r2-check--info .r2-dot { background: #cbd5e1; }
.r2-flags li { list-style: disc; }
.r2-split--access { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
.r2-legend { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 8px; font-size: 0.86rem; }
.r2-legend li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; align-items: start; }
.r2-swatch--line { width: 18px; height: 4px; border-radius: 2px; margin: 8px 0 0; }
.r2-swatch--dot { width: 10px; height: 10px; border-radius: 50%; background: #eb6834; margin: 5px 4px 0; border: 2px solid #fff; box-shadow: 0 0 0 1px #eb6834; }
.r2-swatch--dash { width: 18px; height: 0; border-top: 2px dashed #0f172a; margin: 9px 0 0; border-radius: 0; }
.r2-swatch--way { width: 10px; height: 10px; background: #fff; border: 2px solid #0f172a; border-radius: 1px; margin: 4px 4px 0; }
.r2-mini--stack { grid-template-columns: 1fr 1fr; }
.r2-dd-text { font-weight: 400 !important; font-size: 0.84rem; }
.r2-slopefig svg { width: 100%; height: auto; display: block; }
.r2-slope-line { stroke-width: 3; }
.r2-slope-ghost { stroke: #94a3b8; stroke-width: 1.2; stroke-dasharray: 4 4; }
.r2-slope-ghost-t { font-size: 10px; fill: #94a3b8; }
.r2-slope-arc { fill: none; stroke: #0f172a; stroke-width: 1.2; }
.r2-slope-angle { font-size: 13px; font-weight: 700; fill: #0f172a; }
.r2-slope-house { fill: #fff; stroke: #0f172a; stroke-width: 1.6; stroke-linejoin: round; }
.r2-slope-fill { fill: #60a5fa; opacity: 0.75; }
.r2-slope-cut { fill: #f59e0b; opacity: 0.6; }
.r2-slope-pad { stroke: #0f172a; stroke-width: 2; }
.r2-slopebar-pct { margin-left: 4px; }
.r2-slope-bracket { stroke: #0f172a; stroke-width: 1.2; }
.r2-slope-bt { font-size: 11px; fill: #0f172a; font-weight: 600; }
.r2-slope-cap { font-size: 9.5px; fill: #94a3b8; }
.r2-slope-grade { border-left: 4px solid; padding: 4px 0 4px 14px; margin-bottom: 12px; }
.r2-slope-grade p { margin: 0 !important; }
.r2-slope-grade-h { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.r2-slope-big { font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.r2-slope-big span { font-size: 0.95rem; font-weight: 500; color: var(--muted); }
.r2-slopebar { display: flex; height: 28px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); }
.r2-slopebar-seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.72rem; font-weight: 700; min-width: 2px; }
.r2-slopebar-key { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 0.78rem; }
.r2-slopebar-key li { display: flex; align-items: center; }
.r2-slope-head { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; align-items: center; margin-top: 8px; }
.r2-sections { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.r2-xsec { margin: 0; }
.r2-xsec svg { width: 100%; height: auto; display: block; }
.r2-xsec-h { font-size: 0.86rem !important; font-weight: 650; color: var(--ink) !important; text-align: left !important; padding: 2px 4px 0; }
.r2-xsec-h span { font-weight: 400; color: var(--muted); font-size: 0.78rem; }
.r2-slope-roof { fill: #e2e8f0; stroke: #0f172a; stroke-width: 1.6; stroke-linejoin: round; }
.r2-slope-win { fill: #bfdbfe; stroke: #0f172a; stroke-width: 1; }
.r2-slope-door { fill: #94a3b8; stroke: #0f172a; stroke-width: 1; }
.r2-xsec-path { stroke: #475569; stroke-width: 2.5; }
.r2-xsec-bound { stroke: #0f172a; stroke-width: 1; stroke-dasharray: 3 3; }
.r2-xsec-lab { font-size: 10px; fill: #475569; }
.r2-xsec .r2-small { padding: 0 6px 4px; }
.r2-support + .r2-support { margin-top: 14px !important; }
.r2-lut { margin: 10px 0 18px; }
.r2-lut-head { margin: 0 0 8px !important; font-size: 0.92rem; }
.r2-ac { border: 1px solid var(--line); border-left: 4px solid #6366f1; border-radius: 8px; padding: 10px 14px; margin: 8px 0; }
.r2-ac p { margin: 0 !important; }
.r2-ac-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.r2-ac-title { font-weight: 650; }
.r2-ac-label { font-weight: 500; margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: 0.8rem; }
.r2-ac-provs { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
.r2-ac-provs li { border-left: 2px solid #c7d2fe; padding-left: 10px; }
.r2-ac-stem { font-size: 0.76rem; color: var(--faint); }
.r2-ac-text { font-size: 0.84rem; }
.r2-ac-link { font-size: 0.74rem; }
.r2-std-val--clause { font-size: 0.95rem !important; }
.r2-std-more { margin-top: 10px !important; padding: 4px 8px; border-radius: 6px; background: #eef2ff; color: #4338ca; font-size: 0.76rem; }
.r2-std-evidence { color: #cbd5e1 !important; font-size: 0.7rem !important; }
.r2-ac-rag { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--line); }
.r2-ac-rag-h { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--faint); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.r2-ac-sees { text-transform: none; letter-spacing: 0; font-size: 0.74rem; padding: 1px 8px; border-radius: 999px; }
.r2-ac-sees--yes { background: #f0fdf4; color: #15803d; }
.r2-ac-sees--no { background: #fef2f2; color: #b91c1c; }
.r2-ac-claims { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 3px; font-size: 0.82rem; }
.r2-ac-kind { display: inline-block; min-width: 64px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; color: #64748b; }
.r2-ac-kind--permit { color: #15803d; }
.r2-ac-kind--prohibit { color: #b91c1c; }
.r2-ac-kind--standard { color: #4338ca; }
.r2-env-drawer { margin-top: 10px; }
.r2-env-drawer-h { display: flex; justify-content: space-between; align-items: center; margin: 0 0 8px !important; }
.r2-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 1100px) {
  .r2-layout--nav { display: block; padding: 0; }
  .r2-nav { display: none; }
  .r2-layout--nav .r2-page { margin: 0 auto; padding: 32px 24px 80px; }
}
@media (max-width: 720px) {
  .r2-sections, .r2-slope-head { grid-template-columns: 1fr; }
  .r2-elig > summary { grid-template-columns: 1fr auto; }
  .r2-elig-why { grid-column: 1 / 3; }
  .r2-elig-checks li { grid-template-columns: 10px 80px minmax(0, 1fr); }
  .r2-elig-actual { grid-column: 2 / 4; }
  .r2-reqs { grid-template-columns: 1fr; }
  .r2-tenures { grid-template-columns: 1fr; }
  .r2-checks li { grid-template-columns: 10px 70px minmax(0, 1fr); }
  .r2-check-why { grid-column: 2 / 4; }
  .r2-risks { grid-template-columns: 1fr; }
  .r2-std { grid-template-columns: 1fr 1fr; }
  .r2-con { grid-template-columns: 1fr; gap: 6px; }
  .r2-split { grid-template-columns: 1fr; }
  .r2-top { padding: 10px 16px; }
  .r2-page { padding: 20px 16px 60px; }
}
@media print {
  .r2-nav { display: none; }
  .r2-layout--nav { display: block; }
  .r2-top { display: none; }
  .r2-foot a { display: none; }
}
</style>

<!-- The trace is built by a render function, which the scoped block above cannot reach; prefixed .r2 instead. -->
<style>
.r2 .r2-trace p { margin: 0 !important; }
.r2 .r2-trace-text { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 0.82rem; background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin: 0 0 8px; }
.r2 .r2-trace-list { margin: 2px 0 6px; padding-left: 18px; font-size: 0.8rem; display: grid; gap: 4px; }
.r2 .r2-trace-won { color: #15803d; }
.r2 .r2-trace-why { display: block; font-size: 0.74rem; color: var(--faint); }
.r2 .r2-trace-provs { margin-top: 8px; font-size: 0.8rem; }
.r2 .r2-trace-provs summary { cursor: pointer; color: var(--accent); }
.r2 .r2-trace-prov { padding: 8px 0; border-bottom: 1px solid var(--line); }
.r2 .r2-trace-quote { font-size: 0.78rem; color: var(--muted); white-space: pre-wrap; }
.r2 .r2-trace { font-family: inherit; font-size: 0.86rem; min-width: 0; }
.r2 .r2-trace .r2-ten-h { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin: 8px 0 2px; }
.r2 .r2-trace .r2-cl { color: #1d4ed8; text-decoration: none; }
.r2 a.r2-xl { color: #1d4ed8; text-decoration: none; border-bottom: 1px dotted #5eead4; }
.r2 a.r2-xl:hover { border-bottom-style: solid; }
.r2 .r2-trace .r2-small { font-size: 0.78rem; color: #64748b; }
</style>
