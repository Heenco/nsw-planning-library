<template>
  <div class="fr">
    <!-- ── Rail ───────────────────────────────────────────────────────────── -->
    <nav class="rail">
      <button
        type="button" class="rail-btn" :class="{ 'rail-btn--on': panel === 'frontage' }"
        title="Frontage analysis" @click="togglePanel('frontage')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></svg>
        <span>Frontage</span>
      </button>
      <button
        type="button" class="rail-btn" :class="{ 'rail-btn--on': panel === 'intersect' }"
        title="Intersect this lot with every NSW layer" @click="togglePanel('intersect')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>
        <span>Intersect</span>
        <em v-if="isectHits.length" class="rail-badge">{{ isectHits.length }}</em>
      </button>
      <button
        type="button" class="rail-btn" :class="{ 'rail-btn--on': panel === 'layers' }"
        title="NSW planning, hazard and protection layers" @click="togglePanel('layers')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>
        <span>Layers</span>
        <em v-if="activeLayers.length" class="rail-badge">{{ activeLayers.length }}</em>
      </button>
      <button
        type="button" class="rail-btn" :class="{ 'rail-btn--on': panel === 'local' }"
        title="Layers we hold on the tile server but cannot resolve live" @click="togglePanel('local')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
        <span>Local</span>
        <em v-if="activeLocal.length" class="rail-badge rail-badge--local">{{ activeLocal.length }}</em>
      </button>
    </nav>

    <!-- ── Panel ──────────────────────────────────────────────────────────── -->
    <aside v-show="panel === 'frontage'" class="fr-panel">
      <header class="fr-head">
        <h1>Frontage — topological</h1>
        <p>
          Which boundaries face a road, decided from the parcel fabric rather than
          distance to a centreline.
        </p>
      </header>

      <form class="fr-form" @submit.prevent="run">
        <label class="fr-label" for="lot">Lot / section / plan</label>
        <div class="fr-row">
          <input id="lot" v-model="lotId" class="fr-input" placeholder="A//DP408911" spellcheck="false" autocomplete="off">
          <button class="fr-go" type="submit" :disabled="pending">{{ pending ? '…' : 'Run' }}</button>
        </div>
        <p class="fr-hint">
          Two slashes always — the section is usually empty. Try
          <button v-for="ex in EXAMPLES" :key="ex" type="button" class="fr-ex" @click="pick(ex)">{{ ex }}</button>
        </p>

        <details class="fr-adv">
          <summary>Search settings</summary>
          <label class="fr-adv-row">
            <span>Neighbour search radius</span>
            <input v-model.number="pad" type="number" min="50" max="3000" step="50"> m
          </label>
          <p class="fr-adv-note">
            The one way this method fails is missing a neighbour: a parcel left out makes
            its shared boundary look open. Raise this for large rural lots and watch
            whether the answer moves.
          </p>
        </details>
      </form>

      <p v-if="error" class="fr-msg fr-msg--bad">{{ error }}</p>
      <p v-else-if="miss" class="fr-msg" :class="miss.reason === 'cadastre_unavailable' ? 'fr-msg--bad' : 'fr-msg--warn'">
        {{ miss.message }}
        <button v-if="miss.reason === 'cadastre_unavailable'" type="button" class="fr-retry" @click="run">Retry</button>
      </p>

      <section v-if="data" class="fr-out">
        <dl class="fr-stats">
          <div><dt>Area</dt><dd>{{ data.area_sqm.toLocaleString() }} m²</dd></div>
          <div><dt>Boundary</dt><dd>{{ data.total_boundary_m }} m</dd></div>
          <div><dt>Open</dt><dd>{{ data.total_open_m }} m</dd></div>
          <div><dt>Neighbours</dt><dd :class="{ 'fr-warn': data.neighbourCount < 3 }">{{ data.neighbourCount }}</dd></div>
        </dl>

        <h2 class="fr-h2">Shape</h2>
        <div class="fr-shape">
          <span class="fr-chip" :class="data.is_corner_lot ? 'fr-chip--on' : 'fr-chip--off'">
            {{ data.is_corner_lot ? 'Corner lot' : 'Not a corner lot' }}
          </span>
          <span v-if="data.is_through_lot" class="fr-chip fr-chip--on">Through lot</span>
          <span v-if="data.is_battleaxe" class="fr-chip fr-chip--axe">Battle-axe</span>
          <span v-else-if="data.stem_width_m != null" class="fr-chip fr-chip--quiet">
            Narrow stem {{ data.stem_width_m }} m
          </span>
          <span v-else-if="data.handle_shape && data.handle_shape !== 'regular'" class="fr-chip fr-chip--quiet">
            {{ SHAPE_WORDS[data.handle_shape] ?? data.handle_shape }}
          </span>
          <span class="fr-chip fr-chip--quiet">
            {{ data.street_frontage_count }} street frontage{{ data.street_frontage_count === 1 ? '' : 's' }}
            · {{ data.total_street_frontage_m }} m
          </span>
        </div>
        <p v-if="data.corner_streets && data.corner_streets[0] && data.corner_streets[1]" class="fr-note">
          Corner of {{ data.corner_streets[0] }} and {{ data.corner_streets[1] }}.
        </p>
        <p v-else-if="data.is_corner_lot && data.corner_basis === 'geometry'" class="fr-note">
          Decided on bearings — the roads here are unnamed, so this is a corner by geometry,
          not by streets.
        </p>

        <h2 class="fr-h2">Primary frontage</h2>
        <div v-if="data.primary_frontage_length_m != null" class="fr-primary">
          <span class="fr-primary-road" :class="{ 'fr-primary-road--none': !data.primary_frontage_road }">
            {{ data.primary_frontage_road || 'unnamed frontage' }}
          </span>
          <span class="fr-primary-len">{{ data.primary_frontage_length_m }} m</span>
          <span class="fr-primary-basis" :title="PRIMARY_BASIS[data.primary_frontage_basis]?.why">
            {{ PRIMARY_BASIS[data.primary_frontage_basis]?.label ?? data.primary_frontage_basis }}
          </span>
        </div>
        <p v-else class="fr-msg fr-msg--warn">
          No street frontage on this lot — every boundary is either shared with a
          neighbouring parcel or faces a motorway.
        </p>

        <!--
          A primary with no name is not "no primary". The frontage is established
          from the parcel fabric; the name is a separate pass that can fail on its
          own, and conflating the two reported a lot with three frontages as
          having none.
        -->
        <p v-if="data.primary_frontage_length_m != null && !data.primary_frontage_road" class="fr-msg fr-msg--warn">
          The frontage is established, but no centreline within
          {{ NAME_SEARCH_M }} m could name it
          <template v-if="data.address"> — even though the lot is addressed to
            {{ data.address }}</template>.
          <template v-if="data.roadsFound">
            {{ data.roadsFound }} centrelines were read nearby, so this is usually a gap in
            the <code>road_segments</code> tiles over this area rather than a lot with no street.
          </template>
        </p>
        <p v-if="data.address" class="fr-note">Addressed as {{ data.address }}.</p>
        <p v-else-if="data.primary_frontage_road" class="fr-note">
          No address on file for this lot, so the primary is the longest frontage. Where an
          address is known it wins — on 260//DP979237 the address street is 6.7 m shorter than
          the longest one.
        </p>

        <h2 class="fr-h2">
          Frontages <span class="fr-count">{{ data.street_frontage_count }}</span>
          <span v-if="data.runs.length > data.street_frontage_count" class="fr-dim fr-h2-note">
            + {{ data.runs.length - data.street_frontage_count }} open boundary not counted
          </span>
        </h2>
        <p v-if="!data.runs.length" class="fr-msg fr-msg--warn">
          Every boundary is shared with a neighbouring parcel. This lot has no direct
          street frontage — access by easement or right of carriageway — or a road-reserve
          parcel sits between it and the street.
        </p>
        <ul v-else class="fr-runs">
          <li
            v-for="(run, i) in data.runs" :key="i" class="fr-run"
            :class="{ 'fr-run--on': hover === i }"
            @mouseenter="hover = i" @mouseleave="hover = null"
          >
            <span class="fr-swatch" :style="{ background: runColour(i) }" />
            <span class="fr-run-body">
              <span class="fr-run-top">
                <span class="fr-run-road" :class="{ 'fr-run-road--none': !run.road }">
                  {{ run.road || (run.road_basis === 'motorway_only' ? 'no street frontage' : 'unnamed') }}
                  <span v-if="run.is_primary" class="fr-primary-dot" title="Primary frontage">primary</span>
                </span>
                <span class="fr-run-len">{{ run.length_m }} m</span>
              </span>
              <span class="fr-run-meta">
                edge{{ run.edges.length > 1 ? 's' : '' }} {{ run.edges.join(', ') }} ·
                bearing {{ run.bearing_deg }}°
                <template v-if="run.road_distance_m != null"> · {{ run.road_distance_m }} m to centreline</template>
                <span
                  v-if="run.road_basis === 'motorway_only'" class="fr-tag"
                  title="The road alongside this boundary is access-controlled, so the boundary is open but carries no legal street frontage."
                >faces {{ run.abutsMotorway || 'a motorway' }} — not a street frontage</span>
                <span v-else-if="run.road_basis === 'no_road_data'" class="fr-tag">no road data</span>
                <span v-else-if="!run.road" class="fr-tag">no named road within range</span>
              </span>
            </span>
          </li>
        </ul>

        <p class="fr-note">
          Frontage is decided by the parcel fabric; the road name is a second pass over
          <code>road_segments</code> ({{ data.roadsFound }} centrelines read) that can only ever
          label a run, never remove one.
        </p>

        <h2 class="fr-h2">Dimensions</h2>
        <dl class="fr-dims">
          <div>
            <dt>Depth <span v-if="data.is_battleaxe" class="fr-dim-note">core</span></dt>
            <dd>{{ data.core_depth_m ?? '—' }} m</dd>
          </div>
          <div v-if="data.is_battleaxe">
            <dt>Depth <span class="fr-dim-note">incl. handle</span></dt>
            <dd class="fr-dim-muted">{{ data.lot_depth_m }} m</dd>
          </div>
          <div>
            <dt>Width <span class="fr-dim-note">at {{ data.width_setback_depth_m }} m in</span></dt>
            <dd>{{ data.width_at_setback_m ?? '—' }} m</dd>
          </div>
          <div>
            <dt>Width <span class="fr-dim-note">widest</span></dt>
            <dd>{{ data.lot_width_max_m ?? '—' }} m</dd>
          </div>
        </dl>
        <p class="fr-note">
          Depth is measured from the primary frontage inwards. On a battle-axe the
          handle is excluded — including it is what recorded 55 m for a lot 30 m deep.
          Width at a stated depth is a proxy for the front building line, which LEPs
          name but never define.
        </p>

        <template v-if="data.stem_width_m != null">
          <h2 class="fr-h2">{{ data.is_battleaxe ? 'Access handle' : 'Narrow stem' }}</h2>
          <dl class="fr-dims fr-dims--axe">
            <div>
              <dt>Stem <span class="fr-dim-note">narrowest</span></dt>
              <dd>{{ data.stem_width_m }} m</dd>
            </div>
            <div v-if="data.handle_neck_mean_m != null">
              <dt>Stem <span class="fr-dim-note">average</span></dt>
              <dd class="fr-dim-muted">{{ data.handle_neck_mean_m }} m</dd>
            </div>
            <div><dt>Stem length</dt><dd>{{ data.stem_length_m }} m</dd></div>
            <div><dt>Stem area</dt><dd>{{ data.stem_area_sqm }} m²</dd></div>
          </dl>
          <p v-if="!data.is_battleaxe" class="fr-msg fr-msg--warn">
            This lot has a stem, but at {{ data.stem_width_m }} m it is wider than the
            {{ HANDLE_POLICY_M }} m an access handle is taken to be, so it is not called a
            battle-axe and its area is not excluded. The stem is reported so you can apply a
            different threshold without recomputing.
          </p>
          <p v-else class="fr-note">
            Check a DCP minimum against the <strong>narrowest</strong> figure — a handle
            that pinches below the control can still average above it.
            <template v-if="data.effective_area_sqm != null">
              Lot area less the handle is <strong>{{ data.effective_area_sqm.toLocaleString() }} m²</strong>,
              which is the figure LEP lot-size clauses ask for.
            </template>
            <template v-if="data.handle_shape === 'irregular'">
              The handle is not a straight run, so these figures describe the narrow
              stretch at the street rather than a simple driveway.
            </template>
          </p>
        </template>

        <h2 class="fr-h2">Width profile</h2>
        <svg v-if="profilePath" class="fr-profile" :viewBox="`0 0 ${PROFILE_W} ${PROFILE_H}`" preserveAspectRatio="none">
          <rect v-if="handleBand" :x="handleBand.x" y="0" :width="handleBand.w" :height="PROFILE_H" class="fr-profile-handle" />
          <path :d="profilePath" class="fr-profile-line" />
        </svg>
        <p v-if="profilePath" class="fr-note">
          Lot width from the frontage (left) to the rear (right), peaking at
          {{ data.lot_width_max_m }} m over {{ data.lot_depth_m }} m of depth.
          <template v-if="data.is_battleaxe">The shaded band is the handle.</template>
        </p>

        <h2 class="fr-h2">Boundary edges</h2>
        <table class="fr-tbl">
          <thead><tr><th>#</th><th>Length</th><th>Shared</th><th>Open</th><th>Abuts</th></tr></thead>
          <tbody>
            <tr v-for="e in data.edges" :key="e.index" :class="{ 'fr-tr--open': e.open_m > 0 }">
              <td>{{ e.index }}</td><td>{{ e.length_m }}</td><td>{{ e.shared_m }}</td><td>{{ e.open_m }}</td>
              <td class="fr-abuts">
                <template v-if="e.abuts.length">{{ e.abuts.map((a: any) => data.neighbours[a.neighbour]).join(', ') }}</template>
                <template v-else>—</template>
              </td>
            </tr>
          </tbody>
        </table>

        <a class="fr-dl" :href="apiHref" target="_blank" rel="noopener">Open raw JSON →</a>
      </section>
    </aside>

    <!-- ── Layers ─────────────────────────────────────────────────────────── -->
    <aside v-if="panel === 'layers'" class="fr-panel layers-panel">
      <header class="layers-head">
        <h1>Map layers</h1>
        <p>
          The NSW services <code>01A - Read and write - Geojson</code> downloads, queried
          live for whatever is on screen rather than pulled down first.
        </p>
      </header>

      <label class="layers-filter">
        <input v-model="layerQuery" placeholder="Filter layers…" spellcheck="false">
        <button v-if="layerQuery" type="button" @click="layerQuery = ''">×</button>
      </label>

      <div class="layers-bar">
        <span>{{ activeLayers.length }} on · {{ MAP_SERVICES.length }} available</span>
        <button v-if="activeLayers.length" type="button" @click="clearNswLayers">Turn all off</button>
      </div>
      <p v-if="zoom < LAYER_MIN_ZOOM" class="fr-msg fr-msg--warn">
        Zoom in to at least z{{ LAYER_MIN_ZOOM }} to load layers — these are statewide
        services and a wide box asks for far more than a map can draw.
      </p>

      <section v-for="sec in visibleSections" :key="sec.name" class="layers-sec">
        <h2>{{ sec.name }} <span class="fr-dim">{{ sec.items.length }}</span></h2>
        <label v-for="svc in sec.items" :key="svc.id" class="layer-item">
          <input type="checkbox" :checked="!!layerState[svc.id]" @change="toggleLayer(svc)">
          <span class="layer-dot" :style="{ background: layerColour(svc.id) }" />
          <span class="layer-name">{{ svc.name }}</span>
          <span v-if="layerState[svc.id]?.loading" class="layer-note">…</span>
          <span v-else-if="layerState[svc.id]?.error" class="layer-note layer-note--bad" :title="layerState[svc.id].error">failed</span>
          <span v-else-if="layerState[svc.id]" class="layer-note">
            {{ layerState[svc.id].count }}<template v-if="layerState[svc.id].truncated">+</template>
          </span>
        </label>
      </section>
      <p v-if="!visibleSections.length" class="fr-msg">No layer matches “{{ layerQuery }}”.</p>
    </aside>

    <!-- ── Intersect ──────────────────────────────────────────────────────── -->
    <aside v-if="panel === 'intersect'" class="fr-panel layers-panel">
      <header class="layers-head">
        <h1>Intersect</h1>
        <p>
          This lot against all {{ MAP_SERVICES.length }} NSW layers — a true polygon
          intersect, so something merely beside the lot is not reported as on it.
        </p>
      </header>

      <div v-if="!data" class="fr-msg fr-msg--warn">Run a lot first, or click one on the map.</div>
      <template v-else>
        <div class="isect-lot">
          <strong>{{ data.lotId }}</strong>
          <span v-if="data.address" class="fr-dim">{{ data.address }}</span>
        </div>

        <div class="isect-actions">
          <button v-if="!isectRunning" class="fr-go" type="button" @click="runIntersect">
            {{ isectDone ? 'Run again' : 'Run intersect' }}
          </button>
          <button v-else class="fr-go isect-stop" type="button" @click="stopIntersect">Stop</button>
          <span v-if="isectRunning || isectDone" class="fr-dim">
            {{ isectChecked }}/{{ MAP_SERVICES.length }} checked ·
            {{ isectHits.length }} hit{{ isectHits.length === 1 ? '' : 's' }}
            <template v-if="isectFailed.length"> · {{ isectFailed.length }} failed</template>
          </span>
        </div>
        <div v-if="isectRunning" class="isect-bar">
          <i :style="{ width: (100 * isectChecked / MAP_SERVICES.length).toFixed(1) + '%' }" />
        </div>

        <div v-if="isectHits.length" class="isect-expand">
          <button type="button" @click="setAllOpen(true)">Expand all</button>
          <button type="button" @click="setAllOpen(false)">Collapse all</button>
        </div>

        <p v-if="isectDone && !isectHits.length" class="fr-msg">
          Nothing intersects this lot across {{ isectChecked }} layers checked.
        </p>

        <section v-for="grp in isectGrouped" :key="grp.section" class="layers-sec">
          <h2>{{ grp.section }} <span class="fr-dim">{{ grp.layers.length }}</span></h2>
          <details v-for="hit in grp.layers" :key="hit.id" class="isect-hit" :open="isectOpen[hit.id]">
            <summary class="isect-hit-head" @click="isectOpen[hit.id] = !isectOpen[hit.id]">
              <span class="layer-dot" :style="{ background: layerColour(hit.id) }" />
              <span class="isect-hit-name">{{ hit.name }}</span>
              <span class="fr-dim">{{ hit.count }}<template v-if="hit.truncated">+</template></span>
              <button
                type="button" class="isect-eye"
                :class="{ 'isect-eye--on': !!layerState[hit.id], 'isect-eye--busy': layerState[hit.id]?.loading }"
                :title="layerState[hit.id] ? 'Hide on map' : (zoom < LAYER_MIN_ZOOM ? `Zoom to z${LAYER_MIN_ZOOM}+ to draw this` : 'Show on map')"
                @click.stop.prevent="showHitOnMap(hit)"
              >
                <svg v-if="layerState[hit.id] && !layerState[hit.id].error" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/></svg>
              </button>
            </summary>
            <p v-if="layerState[hit.id]?.error" class="isect-eye-err">
              Could not draw: {{ layerState[hit.id].error }}
            </p>
            <p v-else-if="layerState[hit.id] && layerState[hit.id].count === 0" class="isect-eye-err">
              Intersects this lot, but nothing in the current view to draw — the map layer
              loads what is on screen, so pan or zoom to the lot.
            </p>
            <dl v-for="(f, i) in hit.features" :key="i" class="isect-attrs">
              <div v-for="(v, k) in f" :key="k">
                <dt>{{ k }}</dt><dd>{{ fmtIsect(k, v) }}</dd>
              </div>
            </dl>
          </details>
        </section>

        <details v-if="isectFailed.length" class="fr-adv">
          <summary>
            {{ isectFailed.length }} layer(s) not searched
            <template v-if="isectUnsearched.length">
              · {{ isectUnsearched.length }} unknown
            </template>
          </summary>
          <p class="fr-adv-note">
            None of these were searched, so treat them as <strong>unknown</strong>, not as
            "no hit". The two groups differ: the first could not answer however many times
            it is asked, the second gave up after {{ ISECT_ATTEMPTS }} attempts and may
            answer later.
          </p>

          <template v-if="isectPermanent.length">
            <h3 class="isect-fail-h">Cannot be searched ({{ isectPermanent.length }})</h3>
            <div v-for="f in isectPermanent" :key="f.id" class="isect-fail">
              {{ f.name }} <span class="fr-dim">{{ f.message }}</span>
            </div>
          </template>

          <template v-if="isectUnsearched.length">
            <h3 class="isect-fail-h">Did not answer ({{ isectUnsearched.length }})</h3>
            <div v-for="f in isectUnsearched" :key="f.id" class="isect-fail">
              {{ f.name }}
              <span class="fr-dim">{{ f.message }} · {{ f.attempts }} attempt(s)</span>
            </div>
            <button class="fr-go isect-retry" type="button" :disabled="isectRunning" @click="retryFailed">
              Retry these {{ isectUnsearched.length }}
            </button>
          </template>
        </details>
      </template>
    </aside>

    <!-- ── Local (tile server) ────────────────────────────────────────────── -->
    <aside v-if="panel === 'local'" class="fr-panel layers-panel">
      <header class="layers-head">
        <h1>Local layers</h1>
        <p>
          Held in UrbanPortalDBP and served as tiles, because NSW does not publish them
          live. Kept apart from the Layers panel on purpose — “NSW says so, now” and
          “our warehouse said so when it was last built” are different claims.
        </p>
      </header>

      <div class="layers-bar">
        <span>{{ activeLocal.length }} on · {{ LOCAL_LAYERS.length }} curated</span>
        <button v-if="activeLocal.length" type="button" @click="clearLocal">Turn all off</button>
      </div>
      <p v-if="zoom < LOCAL_MIN_ZOOM" class="fr-msg fr-msg--warn">
        Zoom to z{{ LOCAL_MIN_ZOOM }}+ to draw these. Martin publishes every column in the
        tile, so a wide view of the property tables is tens of megabytes.
      </p>

      <section v-for="grp in LOCAL_GROUPS" :key="grp.key" class="layers-sec">
        <h2>{{ grp.label }} <span class="fr-dim">{{ grp.layers.length }}</span></h2>
        <p class="attr-blurb">{{ grp.blurb }}</p>
        <div v-for="lyr in grp.layers" :key="lyr.id" class="local-item">
          <label class="layer-item">
            <input type="checkbox" :checked="!!localState[lyr.id]" @change="toggleLocal(lyr)">
            <span class="layer-dot" :style="{ background: layerColour(lyr.id) }" />
            <span class="layer-name">{{ lyr.label }}</span>
            <span v-if="lyr.minzoom" class="layer-note">z{{ lyr.minzoom }}+</span>
            <span v-if="localState[lyr.id]?.missing" class="layer-note layer-note--bad">not on server</span>
          </label>
          <p class="local-note"><code>{{ lyr.id }}</code> — {{ lyr.note }}</p>
        </div>
      </section>

      <details class="fr-adv">
        <summary>Everything else on the tile server ({{ otherSources.length }})</summary>
        <p class="fr-adv-note">
          The full Martin catalogue, read from the server rather than listed here, so it
          cannot go stale. Anything already curated above is omitted.
        </p>
        <label class="layers-filter">
          <input v-model="localQuery" placeholder="Filter sources…" spellcheck="false">
          <button v-if="localQuery" type="button" @click="localQuery = ''">×</button>
        </label>
        <label v-for="id in filteredOther" :key="id" class="layer-item">
          <input type="checkbox" :checked="!!localState[id]" @change="toggleLocal({ id, label: id, note: '' })">
          <span class="layer-dot" :style="{ background: layerColour(id) }" />
          <span class="layer-name">{{ id }}</span>
        </label>
        <p v-if="localQuery && !filteredOther.length" class="fr-msg">No source matches “{{ localQuery }}”.</p>
      </details>
    </aside>

    <!-- ── Map ────────────────────────────────────────────────────────────── -->
    <div class="map-wrap">
      <div ref="mapEl" class="map" />
      <p v-if="!hasToken" class="fr-notoken">
        NUXT_PUBLIC_MAPBOX_TOKEN is not set, so the map cannot load. The numbers on the
        left are unaffected.
      </p>

      <div class="map-search">
        <div class="map-search-box">
          <svg class="map-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input
            v-model="addr" type="text" class="map-search-input"
            placeholder="Find an address — anywhere in NSW"
            autocomplete="off"
            @keydown.down.prevent="addrIndex = Math.min(addrIndex + 1, addrResults.length - 1)"
            @keydown.up.prevent="addrIndex = Math.max(addrIndex - 1, 0)"
            @keydown.enter.prevent="addrResults.length ? selectAddr(addrResults[addrIndex]!) : null"
            @keydown.esc="addrResults = []"
            @blur="dismissAddr"
          >
          <span v-if="addrBusy" class="map-search-busy">…</span>
          <button v-if="addr" type="button" class="map-search-clear" title="Clear" @click="clearAddr">×</button>
        </div>

        <div v-if="addrResults.length || addrNote" class="map-search-drop">
          <p v-if="addrNote" class="map-search-note">{{ addrNote }}</p>
          <button
            v-for="(r, i) in addrResults" :key="r.id" type="button"
            class="map-search-item" :class="{ 'map-search-item--active': i === addrIndex }"
            @mousedown.prevent="selectAddr(r)"
          >
            <span class="map-search-main">
              {{ r.address }}
              <span v-if="r.source === 'mapbox'" class="map-search-tag">Mapbox</span>
            </span>
            <span class="map-search-context">
              <template v-if="r.lotId">{{ r.lotId }}</template>
              <template v-else>{{ r.context }}</template>
              <template v-if="r.lga"> · {{ r.lga }}</template>
            </span>
          </button>
        </div>
      </div>

      <div class="map-controls" :class="{ 'map-controls--shifted': showAttrs }">
        <div v-if="measureMode || measurePoints.length" class="measure-readout">
          <div v-if="measureTotal" class="measure-value">{{ measureTotal }}</div>
          <div v-if="measureSecondary" class="measure-secondary">{{ measureSecondary }}</div>
          <div class="measure-hint">
            <template v-if="measuring">
              {{ measurePoints.length < minPoints
                ? `Click ${minPoints - measurePoints.length} more point${minPoints - measurePoints.length > 1 ? 's' : ''}`
                : 'Double-click or Enter to finish' }} · Esc to cancel
            </template>
            <template v-else>Finished · {{ measurePoints.length }} points</template>
          </div>
        </div>

        <div class="measure-control">
          <button
            type="button" class="measure-btn" :class="{ 'measure-btn--on': measureMode === 'distance' }"
            title="Measure distance" @click="toggleMeasure('distance')"
          >distance</button>
          <button
            type="button" class="measure-btn" :class="{ 'measure-btn--on': measureMode === 'area' }"
            title="Measure area" @click="toggleMeasure('area')"
          >area</button>
          <button
            v-if="measurePoints.length" type="button" class="measure-btn measure-btn--clear"
            title="Clear measurement" @click="clearMeasure"
          >clear</button>
        </div>

        <button
          type="button" class="attr-btn" :class="{ 'attr-btn--on': showAttrs }"
          title="Everything up_property_d_3 holds for this lot"
          @click="toggleAttrs"
        >
          Attributes
          <span v-if="attrs?.ok" class="attr-btn-count">{{ attrs.populated_count }}/{{ attrs.column_count }}</span>
        </button>

        <label class="layer-toggle" title="The cadastre from the Martin tile server. Click any parcel to run it.">
          <input v-model="showLots" type="checkbox">
          <span class="layer-swatch layer-swatch--fill" :style="{ background: COLOR_LOTS }" />
          Lots — click to run
        </label>

        <label class="layer-toggle" title="road_segments, from the Martin tile server — the same lines the road names are read from">
          <input v-model="showRoads" type="checkbox">
          <span class="layer-swatch" :style="{ background: COLOR_ROADS }" />
          Road centrelines
        </label>
      </div>

      <!-- ── Attributes ─────────────────────────────────────────────────── -->
      <aside v-if="showAttrs" class="attr-panel">
        <header class="attr-head">
          <div>
            <h2>Property attributes</h2>
            <p v-if="attrs?.ok">
              {{ attrs.address || lotId }}
              <span class="attr-dim">· {{ attrs.populated_count }} of {{ attrs.column_count }} columns hold a value</span>
            </p>
            <p v-else class="attr-dim">up_property_d_3</p>
          </div>
          <button type="button" class="attr-close" title="Close" @click="showAttrs = false">×</button>
        </header>

        <p v-if="attrsPending" class="attr-msg">Loading…</p>
        <p v-else-if="attrs && !attrs.ok" class="attr-msg attr-msg--warn">{{ attrs.message }}</p>

        <template v-else-if="attrs?.ok">
          <label class="attr-filter">
            <input v-model="attrQuery" placeholder="Filter fields…" spellcheck="false">
            <button v-if="attrQuery" type="button" @click="attrQuery = ''">×</button>
          </label>
          <label class="attr-empty">
            <input v-model="attrShowEmpty" type="checkbox"> show empty columns
          </label>

          <section v-for="cat in visibleCategories" :key="cat.key" class="attr-cat">
            <h3>{{ cat.label }} <span class="attr-dim">{{ cat.fields.length }}</span></h3>
            <p v-if="cat.blurb" class="attr-blurb">{{ cat.blurb }}</p>
            <dl class="attr-list">
              <div v-for="f in cat.fields" :key="f.key" :class="{ 'attr-row--empty': isEmpty(f.value) }">
                <dt>
                  <code>{{ f.key }}</code>
                  <span class="attr-meaning">({{ f.label }})</span>
                </dt>
                <dd>{{ fmt(f) }}</dd>
              </div>
            </dl>
          </section>
          <p v-if="!visibleCategories.length" class="attr-msg">No field matches “{{ attrQuery }}”.</p>
        </template>
      </aside>
    </div>

  </div>
</template>

<script setup lang="ts">
/**
 * /frontage — run the topological frontage matcher on one lot, from the browser.
 *
 * Built for the stage before a rebuild: check lots one at a time, look at the
 * boundary it called open, and decide whether the method is right before it is
 * turned loose on 3.2M rows. So the page shows its working — every edge, how much
 * of it is shared and which parcel shares it — rather than just a frontage total.
 * `num_frontages = 0` with no way to see why is what sent us here.
 *
 * The map draws the frontage runs the API returns, which is the part the metrics
 * pipeline throws away — shared/frontage.mjs exists only to reconstruct that
 * geometry by matching length sums against consecutive edge runs.
 *
 * Road centrelines are drawn from the same Martin layer the naming pass reads,
 * so a name that looks wrong can be checked against the line it came from. The
 * search box and the ruler are /prop-width's, in the same corners, because
 * someone moving between the two pages should not have to relearn either.
 */

import { useMeasure } from '~/composables/useMeasure'
import { MAP_SERVICES, MAP_SECTIONS, type MapService } from '#shared/nsw-map-services'
import { LOCAL_GROUPS, LOCAL_LAYERS, type LocalLayer } from '#shared/local-tile-layers'
import { martinTileBase } from '#shared/martin'

const EXAMPLES = ['A//DP408911', '1//DP214129', '1//DP240566']

/** Distinct enough to tell two frontages apart on both basemaps. */
const RUN_COLOURS = ['#e11d48', '#2563eb', '#f59e0b', '#10b981', '#a855f7']
const runColour = (i: number) => RUN_COLOURS[i % RUN_COLOURS.length]

/** /prop-width's road colour, so the same line reads the same on both pages. */
const COLOR_ROADS = '#0ea5e9'
const ROAD_LAYER_ID = 'road_segments'

/**
 * How the primary frontage was chosen, in words.
 *
 * Shown rather than implied because the rules disagree on real lots and the
 * difference is not cosmetic: on a corner lot the primary street is the one the
 * setback controls key off.
 */
const PRIMARY_BASIS: Record<string, { label: string, why: string }> = {
  address: {
    label: 'from the address',
    why: 'The lot is addressed to this street, which is what the setback controls key off.',
  },
  shortest: {
    label: 'shortest frontage',
    why: 'An address was known but matched no frontage, so the shortest street frontage was used — a corner lot usually puts its short side to the primary street.',
  },
  shortest_no_address: {
    label: 'shortest street frontage',
    why: 'No address on file, so the shortest STREET frontage was used: a rectangular corner lot fronts the primary street on its short side and runs the long side down the secondary. Boundaries facing a motorway are not street frontage and take no part in this. Where an address is known it takes precedence.',
  },
  only_street_frontage: {
    label: 'the only street frontage',
    why: 'This lot has exactly one street frontage, so there was nothing to choose between.',
  },
  none: { label: 'none', why: 'No street frontage to nominate.' },
}

/** Shapes worth naming when the lot is not a battle-axe. */
const SHAPE_WORDS: Record<string, string> = {
  tapered: 'Tapers to a point',
  rear_tail: 'Narrow tail at the rear',
  waisted: 'Waisted',
  uniform_narrow: 'Narrow throughout',
  short_neck: 'Slight neck at the street',
  no_frontage: 'No frontage to measure from',
}

/** Mirrors HANDLE_MAX_WIDTH_M in shared/lot-shape.mjs — shown so the cut is visible. */
const HANDLE_POLICY_M = 10

const PROFILE_W = 300
const PROFILE_H = 70

const COLOR_LOTS = '#7c3aed'
const LOT_LAYER_ID = 'lot'
/**
 * Below this the cadastre tiles are enormous and every parcel is a few pixels,
 * so there is nothing worth clicking. /prop-width uses the same floor.
 */
const LOT_MIN_ZOOM = 15

const config = useRuntimeConfig()
const mapboxToken = String((config.public as any).mapboxToken || '')
const hasToken = computed(() => !!mapboxToken)

const route = useRoute()
const router = useRouter()

const lotId = ref(String(route.query.lot ?? 'A//DP408911'))
const pad = ref(Number(route.query.pad) || 300)
const pending = ref(false)
/** Only ever set for an unexpected failure — a network drop, a bug. */
const error = ref('')
/**
 * A lookup that answered, but not with a lot: a typo, a plan that no longer
 * exists, the cadastre being down. Held apart from `error` so the page can say
 * something useful about each instead of showing a stack trace.
 */
const miss = ref<any>(null)
const data = ref<any>(null)
const hover = ref<number | null>(null)
const showRoads = ref(true)
const showLots = ref(true)

/**
 * The width profile as a path, so the numbers above can be checked by eye.
 *
 * A battle-axe is unmistakable here — a long flat run near zero, then a step up
 * — which is worth more than any of the booleans when deciding whether the
 * detector got a particular lot right.
 */
/**
 * An excluded run longer than the primary.
 *
 * Only worth saying when it exists, and it is exactly what makes the primary
 * look wrong at a glance — the list shows a 208.6 m run above a 182.05 m
 * "longest" one.
 */
const excludedLonger = computed(() => {
  const d = data.value
  if (!d?.primary_frontage_length_m) return null
  return (d.runs ?? []).find((r: any) => r.road_basis === 'motorway_only'
    && r.length_m > d.primary_frontage_length_m) ?? null
})

const profilePath = computed(() => {
  const pts = data.value?.profile ?? []
  if (pts.length < 2 || !data.value?.lot_width_max_m) return ''
  const maxD = data.value.lot_depth_m || 1
  const maxW = data.value.lot_width_max_m || 1
  return pts.map((p: any, i: number) => {
    const x = (p.depth / maxD) * PROFILE_W
    const y = PROFILE_H - (p.width / maxW) * (PROFILE_H - 2)
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
})

const handleBand = computed(() => {
  const d = data.value
  if (!d?.is_battleaxe || !d.handle_length_m || !d.lot_depth_m) return null
  return { x: 0, w: (d.handle_length_m / d.lot_depth_m) * PROFILE_W }
})

const apiHref = computed(() => `/api/frontage?lot=${encodeURIComponent(lotId.value)}&pad=${pad.value}`)

// ── Property attributes ────────────────────────────────────────────────────
/**
 * The neighbouring question to this page's own: not "what shape is this lot"
 * but "what else do we know about it".
 *
 * Fetched lazily - the panel is closed by default and most sessions never open
 * it, so 307 columns are not worth pulling on every lookup.
 */
// Initialised from the URL so a lot and its attributes can be linked together,
// and so the panel can be rendered without a click.
const zoom = ref(15)
const showAttrs = ref(String(useRoute().query.attrs ?? '') === '1')
const attrs = ref<any>(null)
const attrsPending = ref(false)
const attrQuery = ref('')
const attrShowEmpty = ref(false)
let attrsFor = ''

const isEmpty = (v: any) => v === null || v === undefined || v === '' || v === 'null'

function fmt(f: any) {
  if (isEmpty(f.value)) return '—'
  if (typeof f.value === 'boolean') return f.value ? 'Yes' : 'No'
  if (typeof f.value === 'number') {
    const n = Number.isInteger(f.value) ? f.value.toLocaleString()
      : f.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    return f.unit ? `${n} ${f.unit}` : n
  }
  return String(f.value)
}

const visibleCategories = computed(() => {
  const cats = attrs.value?.categories ?? []
  const q = attrQuery.value.trim().toLowerCase()
  return cats
    .map((c: any) => ({
      ...c,
      fields: c.fields.filter((f: any) => {
        if (!attrShowEmpty.value && isEmpty(f.value)) return false
        if (!q) return true
        // Match the column name or its plain-English meaning, since a reader
        // may know either.
        return f.key.toLowerCase().includes(q) || String(f.label).toLowerCase().includes(q)
      }),
    }))
    .filter((c: any) => c.fields.length)
})

async function loadAttrs() {
  const id = lotId.value.trim().toUpperCase()
  if (!id || attrsFor === id) return
  attrsPending.value = true
  try {
    attrs.value = await $fetch('/api/frontage-property', { query: { lot: id } })
    attrsFor = id
  } catch (e: any) {
    attrs.value = { ok: false, message: String(e?.data?.message || e?.message || e) }
  } finally {
    attrsPending.value = false
  }
}

function toggleAttrs() {
  showAttrs.value = !showAttrs.value
  if (showAttrs.value) loadAttrs()
}

// Following the lot rather than the panel: open it once and every subsequent
// click on the map keeps it in step.
watch(() => data.value?.lotId, () => {
  attrsFor = ''
  attrs.value = null
  if (showAttrs.value) loadAttrs()
})

// ── Panels ─────────────────────────────────────────────────────────────────
/** One panel at a time; the rail switches between them. */
// Which panel is open comes from the URL, so a view can be linked: the panel is
// part of what you are looking at, not just a click you made.
const _p0 = String(useRoute().query.panel ?? '')
const panel = ref<'frontage' | 'layers' | 'intersect' | 'local' | null>(
  ['frontage', 'layers', 'intersect', 'local'].includes(_p0) ? _p0 as any : 'frontage')
function togglePanel(which: 'frontage' | 'layers' | 'intersect' | 'local') {
  panel.value = panel.value === which ? null : which
}

// ── NSW layers ─────────────────────────────────────────────────────────────
/**
 * Below this the bbox covers half a city and these statewide services return
 * more than a map can usefully draw - the request is refused rather than made.
 */
const LAYER_MIN_ZOOM = 12
/** Mirrors NAME_SEARCH_M in shared/frontage-roads.mjs. */
const NAME_SEARCH_M = 80

const layerQuery = ref('')
const layerState = ref<Record<string, any>>({})
const activeLayers = computed(() => Object.keys(layerState.value))

const LAYER_COLOURS = ['#0891b2', '#c026d3', '#ea580c', '#16a34a', '#4f46e5',
                       '#db2777', '#65a30d', '#0284c7', '#9333ea', '#dc2626']
function layerColour(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return LAYER_COLOURS[h % LAYER_COLOURS.length]
}

const visibleSections = computed(() => {
  const q = layerQuery.value.trim().toLowerCase()
  return MAP_SECTIONS
    .map(name => ({
      name,
      items: MAP_SERVICES.filter(s => s.section === name
        && (!q || s.name.toLowerCase().includes(q) || name.toLowerCase().includes(q))),
    }))
    .filter(sec => sec.items.length)
})

const srcId = (id: string) => `nsw-${id}`

function removeNswLayer(id: string) {
  if (!map) return
  for (const suffix of ['-fill', '-line', '-point']) {
    const lid = srcId(id) + suffix
    if (map.getLayer(lid)) map.removeLayer(lid)
  }
  if (map.getSource(srcId(id))) map.removeSource(srcId(id))
}

function drawLayer(svc: MapService, geojson: any) {
  if (!map || !map.isStyleLoaded()) return
  removeNswLayer(svc.id)
  const colour = layerColour(svc.id)
  map.addSource(srcId(svc.id), { type: 'geojson', data: geojson })
  // One source, three layers: a feature collection can mix polygons, lines and
  // points, and a single layer type would silently drop the rest.
  map.addLayer({
    id: srcId(svc.id) + '-fill', type: 'fill', source: srcId(svc.id),
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': colour, 'fill-opacity': 0.18 },
  })
  map.addLayer({
    id: srcId(svc.id) + '-line', type: 'line', source: srcId(svc.id),
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]],
    paint: { 'line-color': colour, 'line-width': 1.4, 'line-opacity': 0.85 },
  })
  map.addLayer({
    id: srcId(svc.id) + '-point', type: 'circle', source: srcId(svc.id),
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 4, 'circle-color': colour, 'circle-opacity': 0.85 },
  })
  restackMeasure()
}

async function fetchLayer(svc: MapService) {
  if (!map) return
  if (map.getZoom() < LAYER_MIN_ZOOM) return
  const b = map.getBounds()
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
    .map(n => n.toFixed(5)).join(',')
  layerState.value[svc.id] = { ...(layerState.value[svc.id] ?? {}), loading: true, error: null }
  try {
    const res: any = await $fetch('/api/map-layer', { query: { id: svc.id, bbox } })
    if (res?.ok) {
      layerState.value[svc.id] = { loading: false, error: null, count: res.count, truncated: res.truncated }
      drawLayer(svc, res.geojson)
    } else {
      layerState.value[svc.id] = { loading: false, error: res?.message ?? 'failed', count: 0 }
      removeNswLayer(svc.id)
    }
  } catch (e: any) {
    layerState.value[svc.id] = { loading: false, error: String(e?.message ?? e), count: 0 }
    removeNswLayer(svc.id)
  }
}

function toggleLayer(svc: MapService) {
  if (layerState.value[svc.id]) {
    delete layerState.value[svc.id]
    layerState.value = { ...layerState.value }
    removeNswLayer(svc.id)
  } else {
    fetchLayer(svc)
  }
}

/** Named for the NSW catalogue: clearLayers() already means the frontage overlays. */
function clearNswLayers() {
  for (const id of Object.keys(layerState.value)) removeNswLayer(id)
  layerState.value = {}
}

/** Refetch what is switched on whenever the view settles somewhere new. */
let moveTimer: any = null
function onMapSettled() {
  clearTimeout(moveTimer)
  moveTimer = setTimeout(() => {
    for (const id of Object.keys(layerState.value)) {
      const svc = MAP_SERVICES.find(s => s.id === id)
      if (svc) fetchLayer(svc)
    }
  }, 400)
}

// ── Intersect ──────────────────────────────────────────────────────────────
/**
 * Every layer is asked separately rather than in one server round trip.
 *
 * 137 layers behind services that are often slow: a single request would show
 * nothing until the slowest of them returned, and one dead host would cost the
 * whole answer. A small pool fills results in as they land, and a failure costs
 * one row.
 */
const ISECT_CONCURRENCY = 6
/** Mirrors maxAttempts in server/utils/arcgis-retry.ts. */
const ISECT_ATTEMPTS = 3

const isectRunning = ref(false)
const isectDone = ref(false)
const isectChecked = ref(0)
const isectHits = ref<any[]>([])
/**
 * Which hits are expanded. Closed by default: with 18 layers matching, the
 * attributes ran to several screens and the list of what actually applies to the
 * lot — the answer people came for — was buried inside it.
 */
const isectOpen = ref<Record<string, boolean>>({})
function setAllOpen(open: boolean) {
  isectOpen.value = Object.fromEntries(isectHits.value.map(h => [h.id, open]))
}
const isectFailed = ref<any[]>([])
let isectAbort = false

/**
 * A layer that refused the query is not the same as one that timed out.
 *
 * Running the catalogue over a Randwick lot produced nine failures and an
 * immediate retry recovered none of them: three 403s and six parameter
 * rejections. Presenting those next to a genuine timeout would imply they might
 * yet have a hit, when they cannot.
 */
const isectPermanent = computed(() => isectFailed.value.filter(f => f.retryable === false))
const isectUnsearched = computed(() => isectFailed.value.filter(f => f.retryable !== false))

/** Grouped the way the catalogue is, so a result reads like the layer list. */
const isectGrouped = computed(() => {
  const out: { section: string, layers: any[] }[] = []
  for (const sec of MAP_SECTIONS) {
    const layers = isectHits.value.filter(h => h.section === sec)
    if (layers.length) out.push({ section: sec, layers })
  }
  return out
})

/** These layers carry epoch-millisecond dates; raw they are unreadable. */
function fmtIsect(key: string, v: any) {
  if (typeof v === 'number' && /date$/i.test(String(key)) && v > 1e11) {
    return new Date(v).toISOString().slice(0, 10)
  }
  return String(v)
}

/** Re-ask only the layers that could plausibly answer this time. */
async function retryFailed() {
  const again = isectUnsearched.value.map(f => MAP_SERVICES.find(s => s.id === f.id)).filter(Boolean)
  if (!again.length || isectRunning.value) return
  const lot = data.value?.lotId
  if (!lot) return
  isectAbort = false
  isectRunning.value = true
  isectFailed.value = isectPermanent.value
  const queue = [...again] as any[]
  async function worker() {
    while (queue.length && !isectAbort) {
      const svc = queue.shift()
      try {
        const r: any = await $fetch('/api/lot-intersect', { query: { lot, id: svc.id } })
        if (r?.ok && r.count > 0) isectHits.value = [...isectHits.value, r]
        else if (r && !r.ok) isectFailed.value = [...isectFailed.value, r]
      } catch (e: any) {
        isectFailed.value = [...isectFailed.value, {
          id: svc.id, name: svc.name, reason: 'error', message: String(e?.message ?? e).slice(0, 80) }]
      }
    }
  }
  await Promise.all(Array.from({ length: ISECT_CONCURRENCY }, worker))
  isectRunning.value = false
}

/**
 * Draw the layer behind a hit, or hide it again.
 *
 * The two panels answer different questions and it shows here: the intersect ran
 * against the lot's own polygon, while the map layer loads whatever is in the
 * current view. A hit with nothing drawn is not a contradiction — it means the
 * view has moved off the lot — so that case is explained rather than left
 * looking broken.
 */
function showHitOnMap(hit: any) {
  const svc = MAP_SERVICES.find(s => s.id === hit.id)
  if (svc) toggleLayer(svc)
}

function stopIntersect() {
  isectAbort = true
  isectRunning.value = false
}

async function runIntersect() {
  const lot = data.value?.lotId
  if (!lot || isectRunning.value) return
  isectAbort = false
  isectRunning.value = true
  isectDone.value = false
  isectChecked.value = 0
  isectHits.value = []
  isectFailed.value = []
  isectOpen.value = {}

  const queue = [...MAP_SERVICES]
  async function worker() {
    while (queue.length && !isectAbort) {
      const svc = queue.shift()!
      try {
        const r: any = await $fetch('/api/lot-intersect', { query: { lot, id: svc.id } })
        if (r?.ok && r.count > 0) isectHits.value = [...isectHits.value, r]
        else if (r && !r.ok) isectFailed.value = [...isectFailed.value, r]
      } catch (e: any) {
        isectFailed.value = [...isectFailed.value, {
          id: svc.id, name: svc.name, reason: 'error', message: String(e?.message ?? e).slice(0, 80) }]
      }
      isectChecked.value++
    }
  }
  await Promise.all(Array.from({ length: ISECT_CONCURRENCY }, worker))
  isectRunning.value = false
  isectDone.value = !isectAbort
}

// A result belongs to the lot it was run for. Changing lots clears it rather
// than leaving the previous lot's hits on screen under a new heading.
watch(() => data.value?.lotId, () => {
  isectAbort = true
  isectRunning.value = false
  isectDone.value = false
  isectChecked.value = 0
  isectHits.value = []
  isectFailed.value = []
  isectOpen.value = {}
})

// ── Local tile layers ──────────────────────────────────────────────────────
/** Below this the property tables are tens of megabytes per tile. */
const LOCAL_MIN_ZOOM = 14

const localState = ref<Record<string, any>>({})
const localQuery = ref('')
const localCatalog = ref<string[]>([])
const activeLocal = computed(() => Object.keys(localState.value))

/** Everything Martin serves that is not already curated above. */
const otherSources = computed(() => {
  const known = new Set(LOCAL_LAYERS.map(l => l.id))
  return localCatalog.value.filter(id => !known.has(id))
})
const filteredOther = computed(() => {
  const q = localQuery.value.trim().toLowerCase()
  const list = otherSources.value
  // 400+ sources: without a filter this would be a wall, so nothing is shown
  // until something is typed.
  return q ? list.filter(id => id.toLowerCase().includes(q)).slice(0, 60) : []
})

/**
 * Read the catalogue from the server rather than hardcoding it.
 *
 * Martin publishes 440+ sources and the set changes as the notebooks add
 * tables; a list baked in here would be wrong within a week.
 */
async function loadLocalCatalog() {
  if (localCatalog.value.length) return
  try {
    const base = martinTileBase(String((config.public as any).martinUrl || ''))
    const res: any = await $fetch(`${base}/catalog`)
    const t = res?.tiles ?? res
    localCatalog.value = t && typeof t === 'object' ? Object.keys(t).sort() : []
  } catch {
    localCatalog.value = []
  }
}

const localSrc = (id: string) => `loc-${id}`

function removeLocal(id: string) {
  if (!map) return
  for (const suffix of ['-fill', '-line', '-point']) {
    const lid = localSrc(id) + suffix
    if (map.getLayer(lid)) map.removeLayer(lid)
  }
  if (map.getSource(localSrc(id))) map.removeSource(localSrc(id))
}

function addLocal(lyr: LocalLayer) {
  if (!map || map.getSource(localSrc(lyr.id))) return
  const base = martinTileBase(String((config.public as any).martinUrl || ''))
  if (!base) return
  const colour = layerColour(lyr.id)
  const minzoom = lyr.minzoom ?? LOCAL_MIN_ZOOM
  map.addSource(localSrc(lyr.id), {
    type: 'vector',
    tiles: [`${base}/${encodeURIComponent(lyr.id)}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 22,
  })
  // Martin names the tile's layer after the source, and a source can carry any
  // geometry type, so all three are added and filtered.
  map.addLayer({
    id: localSrc(lyr.id) + '-fill', type: 'fill', source: localSrc(lyr.id),
    'source-layer': lyr.id, minzoom,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': colour, 'fill-opacity': 0.16 },
  })
  map.addLayer({
    id: localSrc(lyr.id) + '-line', type: 'line', source: localSrc(lyr.id),
    'source-layer': lyr.id, minzoom,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]],
    paint: { 'line-color': colour, 'line-width': 1.3, 'line-opacity': 0.8 },
  })
  map.addLayer({
    id: localSrc(lyr.id) + '-point', type: 'circle', source: localSrc(lyr.id),
    'source-layer': lyr.id, minzoom,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 3.5, 'circle-color': colour, 'circle-opacity': 0.85 },
  })
  restackMeasure()

  // A source id that is not on the server yields tiles that never arrive and no
  // error; the catalogue says so up front instead.
  const missing = localCatalog.value.length > 0 && !localCatalog.value.includes(lyr.id)
  localState.value = { ...localState.value, [lyr.id]: { missing } }
}

function toggleLocal(lyr: LocalLayer) {
  if (localState.value[lyr.id]) {
    const next = { ...localState.value }
    delete next[lyr.id]
    localState.value = next
    removeLocal(lyr.id)
  } else {
    addLocal(lyr)
  }
}

function clearLocal() {
  for (const id of Object.keys(localState.value)) removeLocal(id)
  localState.value = {}
}

watch(panel, (v) => { if (v === 'local') loadLocalCatalog() })

const mapEl = ref<HTMLElement | null>(null)
let mapboxgl: any = null
let map: any = null

/**
 * The same click-to-measure tool /map and /prop-width use.
 *
 * Shared rather than reimplemented because the geodesic maths in
 * shared/geo-measure.mjs is what the property report measures with too, and a
 * page disagreeing with the report about a boundary length would be worse than
 * one offering no ruler at all. That matters more here than elsewhere: this page
 * exists to be argued with, so a reader checking a frontage by hand has to get
 * the number the tool printed.
 */
const {
  measureMode, measuring, measurePoints, minPoints, measureTotal, measureSecondary,
  ensureMeasureLayers, restackMeasure, toggleMeasure, clearMeasure,
  handleMeasureClick, onMeasureMove, onMeasureDblClick, onMeasureKey,
} = useMeasure(() => map)

// ── Address search ─────────────────────────────────────────────────────────
/**
 * Two sources, because neither alone covers the tool.
 *
 * up_property_d_3 maps an address straight to `lot_section_plan` — exact, no
 * second hop — but holds Randwick and Hornsby only. The frontage calculation
 * works on any lot in NSW, so restricting the search to those councils would
 * have made the page look far narrower than it is. Mapbox geocodes the rest of
 * the state, and /api/frontage-lot-at turns the coordinate into a lot id against
 * the statewide SIX cadastre.
 *
 * Local hits rank first: they name the lot without a round trip and cannot land
 * on the wrong parcel, which a geocoded point occasionally can.
 */
interface AddrHit {
  id: string
  address: string
  context: string
  source: 'local' | 'mapbox'
  lotId?: string
  lga?: string
  lat?: number
  lng?: number
}

const addr = ref('')
const addrResults = ref<AddrHit[]>([])
const addrIndex = ref(0)
const addrNote = ref('')
const addrBusy = ref(false)
let addrTimer: any = null
let addrSeq = 0

async function fetchLocalAddr(q: string): Promise<AddrHit[]> {
  try {
    const res: any = await $fetch('/api/frontage-lot-search', { query: { q } })
    return (res.results ?? []).map((r: any, i: number): AddrHit => ({
      id: `local-${r.lotId}-${i}`,
      address: r.address,
      context: r.lotId,
      source: 'local',
      lotId: r.lotId,
      lga: r.lga,
      lat: r.lat,
      lng: r.lon,
    }))
  } catch {
    return []
  }
}

async function fetchMapboxAddr(q: string): Promise<AddrHit[]> {
  if (!mapboxToken) return []
  const params = new URLSearchParams({
    q, access_token: mapboxToken, country: 'au', limit: '6',
    autocomplete: 'true', types: 'address,street',
  })
  if (map) {
    const c = map.getCenter()
    params.set('proximity', `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`)
  }
  try {
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`)
    if (!res.ok) return []
    const json: any = await res.json()
    return (json.features || []).map((f: any, i: number): AddrHit | null => {
      const p = f.properties || {}
      const [lng, lat] = f.geometry?.coordinates || []
      if (lng == null || lat == null) return null
      return {
        id: `mb-${p.mapbox_id || i}`,
        address: p.name || p.full_address || '',
        context: (p.place_formatted || '').replace(/, Australia$/, ''),
        source: 'mapbox',
        lat: Number(lat),
        lng: Number(lng),
      }
    }).filter(Boolean) as AddrHit[]
  } catch {
    return []
  }
}

watch(addr, (q) => {
  clearTimeout(addrTimer)
  addrIndex.value = 0
  if (q.trim().length < 3) { addrResults.value = []; addrNote.value = ''; addrBusy.value = false; return }
  addrBusy.value = true
  // Debounced: one query per keystroke would be one query per keystroke against
  // a 149k-row table and a metered geocoder.
  addrTimer = setTimeout(async () => {
    const seq = ++addrSeq
    const [local, mb] = await Promise.all([fetchLocalAddr(q.trim()), fetchMapboxAddr(q.trim())])
    if (seq !== addrSeq) return // a later keystroke already won
    // Drop geocoder hits duplicating a local one, which is exact.
    const seen = new Set(local.map(h => h.address.toUpperCase().replace(/\s+/g, ' ')))
    addrResults.value = [...local, ...mb.filter(h => !seen.has(h.address.toUpperCase().replace(/\s+/g, ' ')))]
    addrNote.value = addrResults.value.length ? '' : 'No match. The lot/DP box on the left always works.'
    addrBusy.value = false
  }, 250)
})

async function selectAddr(hit: AddrHit) {
  addr.value = hit.address
  addrResults.value = []
  addrNote.value = ''

  if (hit.lotId) { lotId.value = hit.lotId; return run() }

  // A geocoded hit is a coordinate, not a parcel — resolve it against the
  // cadastre before running.
  if (hit.lng == null || hit.lat == null) return
  addrBusy.value = true
  try {
    const res: any = await $fetch('/api/frontage-lot-at', { query: { lon: hit.lng, lat: hit.lat } })
    if (res?.ok) { lotId.value = res.lotId; await run() }
    else { data.value = null; miss.value = res; clearLayers() }
  } catch (e: any) {
    error.value = String(e?.message ?? e)
  } finally {
    addrBusy.value = false
  }
}

function clearAddr() { addr.value = ''; addrResults.value = []; addrNote.value = '' }
/** Deferred so a click on a result lands before the list is torn down. */
function dismissAddr() { setTimeout(() => { addrResults.value = []; addrNote.value = '' }, 150) }

// ── Lookup ─────────────────────────────────────────────────────────────────
function pick(id: string) { lotId.value = id; run() }

async function run() {
  const id = lotId.value.trim().toUpperCase()
  if (!id) return
  pending.value = true
  error.value = ''
  miss.value = null
  try {
    const res: any = await $fetch('/api/frontage', { query: { lot: id, pad: pad.value } })
    router.replace({ query: { lot: id, pad: String(pad.value) } })
    if (res?.ok === false) { data.value = null; miss.value = res; clearLayers() }
    else { data.value = res; draw() }
  } catch (e: any) {
    data.value = null
    error.value = e?.data?.message || e?.statusMessage || String(e?.message ?? e)
    clearLayers()
  } finally {
    pending.value = false
  }
}

/**
 * The SIX `lotidstring` for a cadastre tile feature.
 *
 * The tile carries the three parts separately and the id is simply them joined:
 * "A" + "" + "DP408911" is "A//DP408911", and a strata parcel with no lot or
 * section is "//SP1055". Verified against tiles over Albion Park and Randwick —
 * every id built this way resolves in the cadastre service.
 *
 * `sectionnumber` matters and is easy to miss: only 30 of 438 sampled parcels
 * carry one, so dropping it looks fine right up until it silently addresses the
 * wrong parcel in an older DP.
 */
function lotIdFromFeature(props) {
  const part = (v) => (v == null ? '' : String(v).trim())
  return `${part(props.lotnumber)}/${part(props.sectionnumber)}/${part(props.planlabel)}`.toUpperCase()
}

const LOT_ID_SHAPE = /^[^/]*\/[^/]*\/.+$/

/**
 * Run whatever parcel was clicked.
 *
 * The tile id is tried first because it costs nothing, but tiles can be stale
 * and parcels get resubdivided, so a miss falls back to asking the cadastre what
 * is actually at that coordinate. Without the fallback a click on a recently
 * changed parcel would report "no boundary published" and look broken.
 */
async function runAtClick(feature, lngLat) {
  const fromTile = feature ? lotIdFromFeature(feature.properties ?? {}) : ''
  if (fromTile && LOT_ID_SHAPE.test(fromTile)) {
    lotId.value = fromTile
    await run()
    if (!miss.value || miss.value.reason !== 'not_found') return
  }
  if (!lngLat) return
  try {
    const res = await $fetch('/api/frontage-lot-at', { query: { lon: lngLat.lng, lat: lngLat.lat } })
    if (res?.ok) { lotId.value = res.lotId; await run() }
    else { data.value = null; miss.value = res; clearLayers() }
  } catch (e) {
    error.value = String(e?.message ?? e)
  }
}

// ── Map layers ─────────────────────────────────────────────────────────────
const LAYER_IDS = ['fr-lot-fill', 'fr-lot-line', 'fr-runs']
const SOURCE_IDS = ['fr-lot', 'fr-runs']

function clearLayers() {
  if (!map || !map.isStyleLoaded?.()) return
  for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id)
  for (const id of SOURCE_IDS) if (map.getSource(id)) map.removeSource(id)
}

/**
 * Road centrelines, straight off Martin — the same `road_segments` the naming
 * pass reads, so a name can be checked against the line it came from.
 *
 * Added once and toggled by visibility rather than added and removed: dropping
 * the source discards its tile cache and every pan refetches.
 */
/**
 * The cadastre, as something to click.
 *
 * Drawn beneath everything the lookup produces, so a result always reads on top
 * of the parcel that produced it.
 */
function addLotLayer() {
  if (!map || map.getSource('fr-lots')) return
  const base = martinTileBase(String((config.public as any).martinUrl || ''))
  if (!base) return
  map.addSource('fr-lots', {
    type: 'vector',
    tiles: [`${base}/${encodeURIComponent(LOT_LAYER_ID)}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 22,
  })
  const visibility = showLots.value ? 'visible' : 'none'
  map.addLayer({
    id: 'fr-lots-fill', type: 'fill', source: 'fr-lots', 'source-layer': LOT_LAYER_ID,
    minzoom: LOT_MIN_ZOOM, layout: { visibility },
    paint: { 'fill-color': COLOR_LOTS, 'fill-opacity': 0.06 },
  })
  map.addLayer({
    id: 'fr-lots-line', type: 'line', source: 'fr-lots', 'source-layer': LOT_LAYER_ID,
    minzoom: LOT_MIN_ZOOM, layout: { visibility },
    paint: { 'line-color': COLOR_LOTS, 'line-width': 0.8, 'line-opacity': 0.5 },
  })
  map.addLayer({
    id: 'fr-lots-hover', type: 'fill', source: 'fr-lots', 'source-layer': LOT_LAYER_ID,
    minzoom: LOT_MIN_ZOOM, layout: { visibility },
    filter: ['==', ['get', 'objectid'], -1],
    paint: { 'fill-color': COLOR_LOTS, 'fill-opacity': 0.2 },
  })
}

watch(showLots, (on) => {
  for (const id of ['fr-lots-fill', 'fr-lots-line', 'fr-lots-hover']) {
    if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
})

function addRoadLayer() {
  if (!map || map.getSource('fr-roads')) return
  const base = martinTileBase(String((config.public as any).martinUrl || ''))
  if (!base) return
  map.addSource('fr-roads', {
    type: 'vector',
    tiles: [`${base}/${encodeURIComponent(ROAD_LAYER_ID)}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 22,
  })
  map.addLayer({
    id: 'fr-roads-line', type: 'line', source: 'fr-roads', 'source-layer': ROAD_LAYER_ID,
    minzoom: 12,
    layout: { visibility: showRoads.value ? 'visible' : 'none' },
    paint: { 'line-color': COLOR_ROADS, 'line-width': 1.4, 'line-opacity': 0.7 },
  })
}

watch(showRoads, (on) => {
  if (map?.getLayer('fr-roads-line')) {
    map.setLayoutProperty('fr-roads-line', 'visibility', on ? 'visible' : 'none')
  }
})

function draw() {
  if (!map || !data.value) return
  if (!map.isStyleLoaded()) { map.once('idle', draw); return }
  clearLayers()

  const ring = data.value.ring
  map.addSource('fr-lot', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
  })
  map.addLayer({
    id: 'fr-lot-fill', type: 'fill', source: 'fr-lot',
    paint: { 'fill-color': '#64748b', 'fill-opacity': 0.12 },
  })
  map.addLayer({
    id: 'fr-lot-line', type: 'line', source: 'fr-lot',
    paint: { 'line-color': '#334155', 'line-width': 1.5, 'line-dasharray': [2, 2] },
  })

  map.addSource('fr-runs', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.value.runs.map((run: any, i: number) => ({
        type: 'Feature',
        properties: { run: i, colour: runColour(i) },
        geometry: { type: 'LineString', coordinates: run.coords },
      })),
    },
  })
  map.addLayer({
    id: 'fr-runs', type: 'line', source: 'fr-runs',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'colour'],
      // The hovered run thickens, so the list and the map point at each other.
      'line-width': ['case', ['==', ['get', 'run'], hover.value ?? -1], 10, 5],
      'line-opacity': 0.9,
    },
  })

  // Ours were just added on top; put the ruler back above them.
  restackMeasure()

  const b = new mapboxgl.LngLatBounds()
  for (const c of ring) b.extend(c)
  map.fitBounds(b, { padding: 70, duration: 600 })
}

watch(hover, (h) => {
  if (map?.getLayer('fr-runs')) {
    map.setPaintProperty('fr-runs', 'line-width', ['case', ['==', ['get', 'run'], h ?? -1], 10, 5])
  }
})

onBeforeUnmount(() => { window.removeEventListener('keydown', onMeasureKey) })

onMounted(async () => {
  if (import.meta.dev) {
    (window as any).__frontageState = () => ({
      pending: pending.value,
      hasData: !!data.value,
      lotId: data.value?.lotId ?? '',
      error: error.value || '',
      miss: miss.value?.reason ?? '',
    })
  }
  if (mapboxToken) {
    const mod: any = await import('mapbox-gl')
    mapboxgl = mod.default || mod
    mapboxgl.accessToken = mapboxToken
    map = new mapboxgl.Map({
      container: mapEl.value!,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [151.2412, -33.9173],
      zoom: 15,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')

    // Dev-only handles for scripts/shoot-prop-width.mjs, mirroring the one
    // PropWidthMap exposes. The shooter has to know when the page has finished
    // rather than guess on a timer, and this page settles in two stages - the
    // map style, then the cadastre fetch and the topology pass over it - so it
    // reports both. Never shipped: import.meta.dev only.
    if (import.meta.dev) (window as any).__frontageMap = map
    map.on('load', () => { addLotLayer(); addRoadLayer(); ensureMeasureLayers(); if (data.value) draw() })

    // The ruler owns the click when it is armed, so measuring across a parcel
    // does not also load it.
    map.on('click', (e: any) => {
      if (handleMeasureClick(e)) return
      if (!showLots.value) return
      const hit = map.queryRenderedFeatures(e.point, { layers: ['fr-lots-fill'] })[0]
      if (hit || e.lngLat) runAtClick(hit, e.lngLat)
    })

    // Hover feedback, so it is obvious the parcels are clickable.
    map.on('mousemove', 'fr-lots-fill', (e: any) => {
      if (measuring.value) return
      map.getCanvas().style.cursor = 'pointer'
      const id = e.features?.[0]?.properties?.objectid
      if (id != null && map.getLayer('fr-lots-hover')) {
        map.setFilter('fr-lots-hover', ['==', ['get', 'objectid'], id])
      }
    })
    map.on('mouseleave', 'fr-lots-fill', () => {
      if (!measuring.value) map.getCanvas().style.cursor = ''
      if (map.getLayer('fr-lots-hover')) map.setFilter('fr-lots-hover', ['==', ['get', 'objectid'], -1])
    })
    map.on('mousemove', onMeasureMove)
    map.on('dblclick', onMeasureDblClick)
    map.on('moveend', onMapSettled)
    map.on('zoom', () => { zoom.value = map.getZoom() })
    window.addEventListener('keydown', onMeasureKey)
  }
  await run()
})
</script>

<style scoped>
.fr { display: flex; height: 100vh; overflow: hidden; font: 14px/1.45 system-ui, -apple-system, sans-serif; }

/* ── Panel ───────────────────────────────────────────────────────────────── */
.rail { width: 4.6rem; flex: none; display: flex; flex-direction: column; gap: 0.3rem; padding: 0.5rem 0.35rem; border-right: 1px solid #e2e8f0; background: #f8fafc; }
.rail-btn { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.2rem; padding: 0.55rem 0.2rem; border: 0; border-radius: 8px; background: transparent; color: #475569; font: inherit; font-size: 0.65rem; cursor: pointer; }
.rail-btn:hover { background: #e2e8f0; }
.rail-btn--on { background: #1e293b; color: #fff; }
.rail-badge { position: absolute; top: 0.25rem; right: 0.5rem; padding: 0 0.25rem; border-radius: 99px; background: #0891b2; color: #fff; font-size: 0.6rem; font-style: normal; }

.layers-panel { padding-top: 1rem; }
.layers-head h1 { margin: 0; font-size: 1.05rem; font-weight: 650; }
.layers-head p { margin: 0.3rem 0 0.9rem; color: #64748b; font-size: 0.8rem; }
.layers-head code { font-size: 0.72rem; background: #f1f5f9; padding: 0 0.2rem; border-radius: 3px; }
.layers-filter { display: flex; align-items: center; gap: 0.3rem; padding: 0.4rem 0.55rem; border: 1px solid #cbd5e1; border-radius: 6px; }
.layers-filter input { flex: 1; min-width: 0; border: 0; font: inherit; font-size: 0.82rem; }
.layers-filter input:focus { outline: none; }
.layers-filter button { border: 0; background: transparent; color: #94a3b8; font-size: 1rem; cursor: pointer; }
.layers-bar { display: flex; align-items: center; justify-content: space-between; margin-top: 0.5rem; color: #64748b; font-size: 0.74rem; }
.layers-bar button { border: 0; background: transparent; color: #2563eb; font: inherit; font-size: 0.74rem; cursor: pointer; }
.rail-badge--local { background: #7c3aed; }
.local-item { margin-bottom: 0.35rem; }
.local-note { margin: 0 0 0 1.55rem; color: #94a3b8; font-size: 0.7rem; line-height: 1.35; }
.local-note code { font-family: ui-monospace, monospace; font-size: 0.66rem; color: #64748b; }

.isect-lot { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.5rem 0.6rem; border-radius: 6px; background: #f8fafc; font-size: 0.85rem; }
.isect-actions { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.7rem; font-size: 0.76rem; }
.isect-stop { background: #b45309; }
.isect-bar { height: 3px; margin-top: 0.5rem; border-radius: 2px; background: #e2e8f0; overflow: hidden; }
.isect-bar i { display: block; height: 100%; background: #2563eb; transition: width 0.2s ease; }
.isect-hit { margin-bottom: 0.15rem; border-bottom: 1px solid #f1f5f9; }
.isect-hit-head { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.15rem; font-size: 0.83rem; cursor: pointer; list-style: none; }
.isect-hit-head::-webkit-details-marker { display: none; }
/* A caret that turns, rather than the default marker, so the row stays flush. */
.isect-hit-head::before { content: '▸'; color: #94a3b8; font-size: 0.7rem; transition: transform 0.12s ease; }
.isect-hit[open] > .isect-hit-head::before { transform: rotate(90deg); }
.isect-hit-head:hover { background: #f8fafc; }
.isect-hit-name { flex: 1; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
.isect-hit[open] { padding-bottom: 0.45rem; }
.isect-eye { flex: none; display: inline-flex; align-items: center; padding: 0.15rem 0.25rem; border: 1px solid #e2e8f0; border-radius: 5px; background: #fff; color: #94a3b8; cursor: pointer; }
.isect-eye:hover { background: #f1f5f9; color: #475569; }
.isect-eye--on { background: #1e293b; border-color: #1e293b; color: #fff; }
.isect-eye--busy { opacity: 0.5; }
.isect-eye-err { margin: 0.1rem 0 0.3rem 1.55rem; color: #92400e; font-size: 0.7rem; line-height: 1.35; }

.isect-expand { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
.isect-expand button { border: 0; background: transparent; color: #2563eb; font: inherit; font-size: 0.74rem; cursor: pointer; }
.isect-attrs { margin: 0.3rem 0 0; padding-left: 1rem; }
.isect-attrs > div { display: flex; justify-content: space-between; gap: 0.6rem; padding: 0.1rem 0; }
.isect-attrs dt { color: #64748b; font-size: 0.7rem; font-family: ui-monospace, monospace; }
.isect-attrs dd { margin: 0; max-width: 12rem; text-align: right; font-size: 0.74rem; font-weight: 600; overflow-wrap: anywhere; }
.isect-attrs + .isect-attrs { border-top: 1px dashed #e2e8f0; margin-top: 0.3rem; padding-top: 0.3rem; }
.isect-fail { padding: 0.15rem 0; font-size: 0.74rem; }
.isect-fail-h { margin: 0.6rem 0 0.2rem; font-size: 0.68rem; font-weight: 650; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
.isect-retry { margin-top: 0.5rem; padding: 0.3rem 0.7rem; font-size: 0.75rem; }

.layers-sec { margin-top: 1rem; }
.layers-sec h2 { margin: 0 0 0.25rem; font-size: 0.7rem; font-weight: 650; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
.layer-item { display: flex; align-items: center; gap: 0.45rem; padding: 0.22rem 0.15rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer; }
.layer-item:hover { background: #f8fafc; }
.layer-dot { width: 0.6rem; height: 0.6rem; border-radius: 2px; flex: none; opacity: 0.75; }
.layer-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.layer-note { flex: none; color: #94a3b8; font-size: 0.7rem; font-variant-numeric: tabular-nums; }
.layer-note--bad { color: #b45309; cursor: help; }

.fr-panel { width: 30rem; min-width: 0; flex: none; overflow-y: auto; padding: 1.25rem; border-right: 1px solid #e2e8f0; background: #fff; }
.fr-head h1 { margin: 0; font-size: 1.1rem; font-weight: 650; }
.fr-head p { margin: 0.3rem 0 1rem; color: #64748b; font-size: 0.85rem; }
.fr-label { display: block; font-size: 0.75rem; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
.fr-row { display: flex; gap: 0.5rem; margin-top: 0.35rem; }
.fr-input { flex: 1; padding: 0.5rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; font-family: ui-monospace, monospace; }
.fr-input:focus { outline: 2px solid #2563eb; outline-offset: -1px; border-color: transparent; }
.fr-go { padding: 0.5rem 1.1rem; border: 0; border-radius: 6px; background: #1e293b; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.fr-go:disabled { background: #94a3b8; cursor: default; }
.fr-hint { margin: 0.5rem 0 0; font-size: 0.78rem; color: #64748b; }
.fr-ex { margin-left: 0.35rem; padding: 0.1rem 0.35rem; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; font: inherit; font-size: 0.72rem; font-family: ui-monospace, monospace; cursor: pointer; }
.fr-ex:hover { background: #e2e8f0; }
.fr-adv { margin-top: 0.75rem; font-size: 0.8rem; }
.fr-adv summary { cursor: pointer; color: #475569; }
.fr-adv-row { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; color: #475569; }
.fr-adv-row input { width: 5rem; padding: 0.25rem 0.4rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; }
.fr-adv-note { margin: 0.4rem 0 0; color: #94a3b8; font-size: 0.75rem; }

.fr-msg { margin: 1rem 0 0; padding: 0.6rem 0.7rem; border-radius: 6px; font-size: 0.82rem; }
.fr-msg--bad { background: #fef2f2; color: #b91c1c; }
.fr-msg--warn { background: #fffbeb; color: #92400e; }
.fr-retry { margin-left: 0.5rem; padding: 0.1rem 0.5rem; border: 1px solid currentColor; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 0.75rem; cursor: pointer; }

.fr-out { margin-top: 1.25rem; }
.fr-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin: 0 0 1rem; }
.fr-stats div { padding: 0.45rem 0.5rem; border-radius: 6px; background: #f8fafc; }
.fr-stats dt { font-size: 0.68rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
.fr-stats dd { margin: 0.15rem 0 0; font-weight: 600; font-size: 0.9rem; }
.fr-warn { color: #b45309; }
.fr-h2 { margin: 1.1rem 0 0.5rem; font-size: 0.8rem; font-weight: 650; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
.fr-h2-note { margin-left: 0.4rem; font-size: 0.68rem; text-transform: none; letter-spacing: 0; }
.fr-count { display: inline-block; margin-left: 0.3rem; padding: 0 0.35rem; border-radius: 99px; background: #1e293b; color: #fff; font-size: 0.7rem; }

.fr-shape { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.fr-chip { padding: 0.15rem 0.5rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600; }
.fr-chip--on { background: #dcfce7; color: #166534; }
.fr-chip--off { background: #f1f5f9; color: #64748b; font-weight: 500; }
.fr-chip--quiet { background: #f1f5f9; color: #475569; font-weight: 500; }

.fr-primary { display: flex; align-items: baseline; gap: 0.5rem; padding: 0.5rem 0.6rem; border-radius: 6px; background: #eff6ff; }
.fr-primary-road { font-weight: 700; }
.fr-primary-road--none { color: #92400e; font-weight: 600; font-style: italic; }
.fr-primary-len { font-weight: 650; font-variant-numeric: tabular-nums; }
.fr-primary-basis { margin-left: auto; color: #1d4ed8; font-size: 0.72rem; cursor: help; }
.fr-primary-dot { margin-left: 0.35rem; padding: 0 0.3rem; border-radius: 3px; background: #dbeafe; color: #1d4ed8; font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }

.fr-runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.fr-run { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.4rem 0.5rem; border-radius: 6px; cursor: default; }
.fr-run--on { background: #f1f5f9; }
.fr-swatch { width: 0.7rem; height: 0.7rem; margin-top: 0.25rem; border-radius: 2px; flex: none; }
.fr-run-body { flex: 1; min-width: 0; }
.fr-run-top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.fr-run-road { font-weight: 650; }
.fr-run-road--none { color: #94a3b8; font-weight: 500; font-style: italic; }
.fr-run-len { font-weight: 650; font-variant-numeric: tabular-nums; }
.fr-run-meta { display: block; color: #64748b; font-size: 0.75rem; }
.fr-tag { display: inline-block; margin-left: 0.35rem; padding: 0 0.3rem; border-radius: 3px; background: #fef3c7; color: #92400e; font-size: 0.68rem; }
.fr-note { margin: 0.6rem 0 0; color: #94a3b8; font-size: 0.75rem; }
.fr-note code { font-size: 0.72rem; background: #f1f5f9; padding: 0 0.2rem; border-radius: 3px; }

.fr-dims { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.4rem; margin: 0 0 0.2rem; }
.fr-dims--axe div { background: #fef3c7; }
.fr-dims div { padding: 0.45rem 0.55rem; border-radius: 6px; background: #f8fafc; }
.fr-dims dt { font-size: 0.7rem; color: #64748b; }
.fr-dim-note { color: #94a3b8; font-size: 0.66rem; }
.fr-dims dd { margin: 0.1rem 0 0; font-weight: 650; font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.fr-dim-muted { color: #94a3b8; font-weight: 500; }
.fr-chip--axe { background: #fef3c7; color: #92400e; }

.fr-profile { width: 100%; height: 4.5rem; border-radius: 6px; background: #f8fafc; }
.fr-profile-line { fill: none; stroke: #2563eb; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
.fr-profile-handle { fill: #fde68a; opacity: 0.7; }

.fr-tbl { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.fr-tbl th { text-align: right; padding: 0.3rem 0.4rem; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 600; font-size: 0.7rem; text-transform: uppercase; }
.fr-tbl th:last-child, .fr-tbl td:last-child { text-align: left; }
.fr-tbl td { text-align: right; padding: 0.3rem 0.4rem; border-bottom: 1px solid #f1f5f9; font-variant-numeric: tabular-nums; }
.fr-tr--open td { background: #f0fdf4; }
.fr-abuts { color: #64748b; font-size: 0.72rem; font-family: ui-monospace, monospace; }
.fr-dl { display: inline-block; margin-top: 0.9rem; color: #2563eb; font-size: 0.8rem; text-decoration: none; }
.fr-dl:hover { text-decoration: underline; }

/* ── Map ─────────────────────────────────────────────────────────────────── */
/* min-width: 0 is load-bearing. A flex item defaults to min-width: auto, so the
   map refuses to shrink below the canvas's intrinsic width; adding the
   attributes panel then pushed it off-screen to the right behind a horizontal
   scrollbar rather than making room for it. */
.map-wrap { flex: 1; min-width: 0; position: relative; --attr-w: min(26rem, 92%); }
.map { position: absolute; inset: 0; }
.fr-notoken { position: absolute; inset: 0; display: grid; place-content: center; padding: 2rem; color: #64748b; text-align: center; }

.map-search { position: absolute; top: 0.75rem; left: 0.75rem; z-index: 2; width: min(25rem, calc(100% - 5rem)); }
.map-search-box { display: flex; align-items: center; gap: 0.45rem; padding: 0.45rem 0.6rem; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.18); }
.map-search-icon { color: #94a3b8; flex: none; }
.map-search-input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 0.85rem; }
.map-search-input:focus { outline: none; }
.map-search-busy { color: #94a3b8; font-size: 0.9rem; }
.map-search-clear { border: 0; background: transparent; color: #94a3b8; font-size: 1.1rem; line-height: 1; cursor: pointer; }
.map-search-drop { margin-top: 0.3rem; padding: 0.25rem; border-radius: 8px; background: #fff; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18); max-height: 17rem; overflow-y: auto; }
.map-search-note { margin: 0; padding: 0.5rem 0.55rem; color: #92400e; font-size: 0.75rem; }
.map-search-item { display: block; width: 100%; padding: 0.4rem 0.55rem; border: 0; border-radius: 5px; background: transparent; font: inherit; text-align: left; cursor: pointer; }
.map-search-item:hover, .map-search-item--active { background: #f1f5f9; }
.map-search-main { display: block; font-size: 0.82rem; }
.map-search-tag { margin-left: 0.3rem; padding: 0 0.25rem; border-radius: 3px; background: #e2e8f0; color: #64748b; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.03em; }
.map-search-context { display: block; color: #64748b; font-size: 0.72rem; font-family: ui-monospace, monospace; }

.map-controls { position: absolute; right: 0.75rem; bottom: 1.6rem; z-index: 7; transition: right 0.15s ease; display: flex; flex-direction: column; align-items: flex-end; gap: 0.4rem; }
.measure-readout { padding: 0.45rem 0.6rem; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.18); text-align: right; }
.measure-value { font-weight: 700; color: #b45309; font-variant-numeric: tabular-nums; }
.measure-secondary { color: #64748b; font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.measure-hint { margin-top: 0.15rem; color: #94a3b8; font-size: 0.68rem; }
.measure-control { display: flex; gap: 0.25rem; padding: 0.25rem; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.18); }
.measure-btn { padding: 0.25rem 0.55rem; border: 0; border-radius: 5px; background: transparent; font: inherit; font-size: 0.76rem; color: #475569; cursor: pointer; }
.measure-btn:hover { background: #f1f5f9; }
.measure-btn--on { background: #b45309; color: #fff; }
.measure-btn--clear { color: #b91c1c; }

.attr-btn { display: flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.6rem; border: 0; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(15,23,42,0.18); font: inherit; font-size: 0.76rem; color: #475569; cursor: pointer; }
.attr-btn:hover { background: #f1f5f9; }
.attr-btn--on { background: #1e293b; color: #fff; }
.attr-btn-count { padding: 0 0.3rem; border-radius: 3px; background: rgba(148,163,184,0.25); font-size: 0.68rem; font-variant-numeric: tabular-nums; }

/**
 * An overlay on the map, not a third flex column.
 *
 * As a flex sibling it depended on three widths cooperating and did not survive
 * contact with a real viewport — the panel was in the DOM with correct CSS and
 * still not visible. Anchored to the map's right edge it cannot be squeezed out
 * by anything, and the map stays usable underneath.
 */
.attr-panel {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 8;
  width: var(--attr-w); overflow-y: auto;
  padding: 1rem 1.1rem;
  border-left: 1px solid #e2e8f0; background: #fff;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.14);
}
.attr-head {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;
  margin: -1rem -1.1rem 0; padding: 0.8rem 1.1rem;
  background: #fff; border-bottom: 1px solid #e2e8f0;
}
.attr-head h2 { margin: 0; font-size: 0.95rem; font-weight: 650; }
.attr-head p { margin: 0.2rem 0 0; font-size: 0.78rem; color: #475569; }
.attr-dim { color: #94a3b8; font-weight: 400; }
.attr-close {
  flex: none; width: 1.9rem; height: 1.9rem; border: 1px solid #e2e8f0; border-radius: 6px;
  background: #f8fafc; color: #475569; font-size: 1.15rem; line-height: 1; cursor: pointer;
}
.attr-close:hover { background: #e2e8f0; color: #0f172a; }
.attr-msg { margin: 1rem 0 0; padding: 0.6rem 0.7rem; border-radius: 6px; background: #f8fafc; color: #475569; font-size: 0.8rem; }
.attr-msg--warn { background: #fffbeb; color: #92400e; }

.attr-filter { position: sticky; top: 4.1rem; z-index: 1; display: flex; align-items: center; gap: 0.3rem; margin-top: 0.9rem; background: #fff; padding: 0.35rem 0.5rem; border: 1px solid #cbd5e1; border-radius: 6px; }
.attr-filter input { flex: 1; min-width: 0; border: 0; font: inherit; font-size: 0.8rem; }
.attr-filter input:focus { outline: none; }
.attr-filter button { border: 0; background: transparent; color: #94a3b8; font-size: 1rem; cursor: pointer; }
.attr-empty { display: block; margin-top: 0.45rem; color: #64748b; font-size: 0.74rem; cursor: pointer; }

.attr-cat { margin-top: 1.1rem; }
.attr-cat h3 { margin: 0 0 0.15rem; font-size: 0.72rem; font-weight: 650; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
.attr-blurb { margin: 0 0 0.35rem; color: #94a3b8; font-size: 0.72rem; }
.attr-list { margin: 0; }
.attr-list > div { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; padding: 0.22rem 0; border-bottom: 1px solid #f1f5f9; }
.attr-row--empty { opacity: 0.45; }
.attr-list dt { min-width: 0; flex: 1; }
.attr-list dt code { font-size: 0.73rem; font-family: ui-monospace, monospace; color: #1e293b; }
.attr-meaning { margin-left: 0.3rem; color: #94a3b8; font-size: 0.7rem; }
.attr-list dd { margin: 0; flex: none; max-width: 11rem; text-align: right; font-size: 0.78rem; font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

.layer-toggle { display: flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.6rem; border-radius: 8px; background: #fff; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.18); font-size: 0.76rem; color: #475569; cursor: pointer; }
.layer-swatch { width: 1rem; height: 0.18rem; border-radius: 2px; }
.layer-swatch--fill { height: 0.7rem; opacity: 0.4; }

/* Panel open: shift the controls clear of it rather than letting it cover them. */
.map-controls--shifted { right: calc(0.75rem + var(--attr-w)); }
</style>
