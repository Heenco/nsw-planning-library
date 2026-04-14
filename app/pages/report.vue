<template>
  <div class="report-page">

    <!-- Header -->
    <div class="report-header">
      <NuxtLink to="/" class="back-link">&larr; Home</NuxtLink>
      <h1 class="report-title">Property Report</h1>
      <p class="report-subtitle">{{ personaLabel }} · {{ address || 'Loading…' }}</p>
    </div>

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
    <details v-if="property && (p.fsr_value || p.max_height_m || p.min_lot_size)" class="rpt-section" :open="persona === 'developer' || persona === 'planner'">
      <summary class="rpt-section-title">Development Standards</summary>
      <div class="facts-grid">
        <div class="fact" v-if="p.fsr_value"><span class="fact-label">Floor Space Ratio</span><span class="fact-value fact-value--num">{{ p.fsr_value }}<span class="fact-sub" v-if="p.fsr_lay_class">{{ p.fsr_lay_class }}</span></span></div>
        <div class="fact" v-if="p.max_height_m"><span class="fact-label">Max Building Height</span><span class="fact-value fact-value--num">{{ p.max_height_m }}m</span></div>
        <div class="fact" v-if="p.min_lot_size"><span class="fact-label">Min Lot Size</span><span class="fact-value fact-value--num">{{ p.min_lot_size }} {{ p.lot_size_units || 'sqm' }}</span></div>
      </div>
    </details>

    <!-- ── Section 3: Lot Map & Dimensions ────────────────────────────── -->
    <details v-if="property && p.centroid_lat && p.centroid_lon" class="rpt-section" :open="persona === 'developer'" @toggle="onMapToggle">
      <summary class="rpt-section-title">Lot Map & Dimensions</summary>
      <div class="lot-map-layout">
        <!-- Map -->
        <div class="lot-map-container">
          <div ref="mapEl" class="lot-map"></div>
        </div>
        <!-- Dimensions -->
        <div class="lot-dims">
          <div class="lot-dims-grid">
            <div class="dim" v-if="p.area_h"><span class="dim-label">Area</span><span class="dim-value">{{ Number(p.area_h).toFixed(3) }} ha</span></div>
            <div class="dim" v-if="p.longest_axis_m"><span class="dim-label">Longest axis</span><span class="dim-value">{{ Number(p.longest_axis_m).toFixed(1) }}m</span></div>
            <div class="dim" v-if="p.min_width_m"><span class="dim-label">Min width</span><span class="dim-value">{{ Number(p.min_width_m).toFixed(1) }}m</span></div>
            <div class="dim" v-if="p.average_slope"><span class="dim-label">Avg slope</span><span class="dim-value">{{ Number(p.average_slope).toFixed(1) }}°</span></div>
          </div>

          <!-- Edge measurements -->
          <div v-if="edgeMeasurements.length" class="edge-list">
            <div class="edge-heading">Side lengths</div>
            <div class="edge-items">
              <span v-for="(e, i) in edgeMeasurements" :key="i" class="edge-chip">{{ e }}</span>
            </div>
          </div>

          <!-- Frontages -->
          <div v-if="frontageItems.length" class="edge-list">
            <div class="edge-heading">Frontages</div>
            <div class="edge-items">
              <span v-for="(f, i) in frontageItems" :key="i" class="edge-chip edge-chip--frontage">{{ f }}</span>
            </div>
          </div>

          <!-- Flags -->
          <div class="lot-flags">
            <span v-if="p.is_corner_lot === 'true'" class="lot-flag lot-flag--green">Corner lot</span>
            <span v-if="p.is_battleaxe === 'true'" class="lot-flag lot-flag--amber">Battle-axe</span>
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
    <details v-if="property" class="rpt-section" :open="persona === 'developer' || persona === 'owner'">
      <summary class="rpt-section-title">Complying Development (CDC) Eligibility</summary>
      <div class="cdc-summary">
        <span :class="['cdc-badge', p.cdc_eligible === 'true' ? 'cdc-badge--yes' : 'cdc-badge--no']">
          {{ p.cdc_eligible === 'true' ? '✓ CDC Eligible' : '✗ Not CDC Eligible' }}
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

    <!-- ── Section 7: LMR Housing & Pattern Book ───────────────────────── -->
    <details v-if="property && (p.in_lmr_housing_area === 'true' || patternBookItems.length > 0)" class="rpt-section" :open="persona === 'developer'">
      <summary class="rpt-section-title">Low-Mid Rise Housing & Pattern Book</summary>
      <div v-if="p.in_lmr_housing_area === 'true'" class="lmr-badge">In LMR Housing Area</div>
      <div class="facts-grid" v-if="p.lmr_permissible || p.lmr_height_rfb || p.lmr_height_sth">
        <div class="fact" v-if="p.lmr_permissible"><span class="fact-label">LMR Permissible</span><span class="fact-value">{{ p.lmr_permissible }}</span></div>
        <div class="fact" v-if="p.lmr_height_rfb"><span class="fact-label">RFB Height</span><span class="fact-value">{{ p.lmr_height_rfb }}</span></div>
        <div class="fact" v-if="p.lmr_height_sth"><span class="fact-label">STH Height</span><span class="fact-value">{{ p.lmr_height_sth }}</span></div>
      </div>
      <div v-if="patternBookItems.length" class="cdc-grid" style="margin-top:0.5rem">
        <div v-for="pb in patternBookItems" :key="pb.key" class="cdc-item">
          <span :class="['cdc-dot', pb.eligible ? 'cdc-dot--yes' : 'cdc-dot--no']"></span>
          <span class="cdc-name">{{ pb.label }}</span>
        </div>
      </div>
    </details>

    <!-- ── Section 8: Proximity & Amenity ──────────────────────────────── -->
    <details v-if="property && (p.closest_school || p.closest_hospital || p.closest_railway_station)" class="rpt-section" :open="persona === 'owner'">
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
    <details v-if="permittedUses.length > 0" class="rpt-section">
      <summary class="rpt-section-title">Permitted Uses in Zone {{ p?.zone }} ({{ permittedUses.length }})</summary>
      <div class="uses-list">
        <span v-for="u in permittedUses" :key="u" class="use-chip">{{ u }}</span>
      </div>
    </details>

    <!-- Steps trace -->
    <details v-if="steps.length > 0" class="steps-panel">
      <summary class="steps-summary">Pipeline steps ({{ steps.length }})</summary>
      <div class="steps-list">
        <div v-for="(s, i) in steps" :key="i" :class="['step-item', 'step-item--' + s.status]">
          <span class="step-agent">{{ s.agent }}</span>
          <span class="step-msg">{{ s.message }}</span>
        </div>
      </div>
    </details>

    <!-- Planning Summary — split into LEP / SEPP / DCP sections -->
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

    <!-- Deep legal cards -->
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
    <div v-if="answerText && !loading && reportQId" class="feedback-section">
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
import { ref, computed } from 'vue'
import { renderMarkdownWithCitations, type Citation } from '~/utils/citation-render'
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
const personaLabel = PERSONA_LABELS[persona] || persona

const loading = ref(true)
const property = ref<any>(null)
const permittedUses = ref<string[]>([])
const answerText = ref('')
const citations = ref<Citation[]>([])

const lots = ref<any[]>([])
const legalCards = ref<any[]>([])
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

// ── Lot edge / frontage parsing ──────────────────────────────────────────────

const edgeMeasurements = computed(() => {
  const raw = p.value?.all_edges_measurements
  if (!raw) return []
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
})

const frontageItems = computed(() => {
  const raw = p.value?.all_frontages
  if (!raw) return []
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
})

// ── Map initialization ──────────────────────────────────────────────────────

async function initMap() {
  if (mapInstance || !mapEl.value || !p.value?.centroid_lat || !p.value?.centroid_lon) return
  if (!import.meta.client) return

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
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    center: [lng, lat],
    zoom: 18,
    pitch: 0,
    attributionControl: false,
  })

  mapInstance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

  mapInstance.on('load', () => {
    // Build approximate polygon from edge measurements + orientation
    const polygon = buildApproxPolygon(lat, lng)

    if (polygon) {
      mapInstance!.addSource('lot-boundary', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [polygon] },
        },
      })

      // Fill
      mapInstance!.addLayer({
        id: 'lot-fill',
        type: 'fill',
        source: 'lot-boundary',
        paint: { 'fill-color': '#15803d', 'fill-opacity': 0.15 },
      })

      // Outline
      mapInstance!.addLayer({
        id: 'lot-outline',
        type: 'line',
        source: 'lot-boundary',
        paint: { 'line-color': '#15803d', 'line-width': 2.5, 'line-opacity': 0.9 },
      })

      // Add edge labels at midpoints of each side
      const edges = edgeMeasurements.value
      for (let i = 0; i < polygon.length - 1 && i < edges.length; i++) {
        const [x1, y1] = polygon[i]
        const [x2, y2] = polygon[i + 1]
        const el = document.createElement('div')
        el.className = 'map-edge-label'
        el.textContent = edges[i]
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([(x1 + x2) / 2, (y1 + y2) / 2])
          .addTo(mapInstance!)
      }
    }

    // Add centroid marker
    new mapboxgl.Marker({ color: '#15803d', scale: 0.7 })
      .setLngLat([lng, lat])
      .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(
        `<div style="font-family:inherit;font-size:12px;line-height:1.4">
          <strong>${p.value.address || 'Property'}</strong><br/>
          ${p.value.area_h ? Number(p.value.area_h).toFixed(3) + ' ha' : ''}
          ${p.value.zone ? ' · Zone ' + p.value.zone : ''}
        </div>`
      ))
      .addTo(mapInstance!)
  })
}

/** Build an approximate polygon from edge measurements + orientation.
 *  Walks edges starting from centroid, turning by equal angles for each edge.
 *  Returns array of [lng, lat] coordinates (closed ring), or null. */
function buildApproxPolygon(lat: number, lng: number): [number, number][] | null {
  const edges = edgeMeasurements.value
  if (edges.length < 3) return null

  const edgeMs = edges.map((e: string) => parseFloat(e))
  if (edgeMs.some(isNaN)) return null

  const orientRad = (Number(p.value.orientation_degrees) || 0) * Math.PI / 180
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180)

  // Walk edges, turning by exterior angle (360° / N) each step
  const angleStep = (2 * Math.PI) / edgeMs.length
  let angle = orientRad
  const pts: [number, number][] = []
  let x = 0, y = 0

  for (const len of edgeMs) {
    pts.push([x, y])
    x += len * Math.sin(angle)
    y += len * Math.cos(angle)
    angle += angleStep
  }

  // Center the polygon on the centroid
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length

  const coords: [number, number][] = pts.map(([px, py]) => [
    lng + (px - cx) / mPerDegLon,
    lat + (py - cy) / mPerDegLat,
  ])
  coords.push(coords[0]) // close ring

  return coords
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
    { key: 'general', label: 'General', eligible: v.cdc_general === 'true', exclusions: v.cdc_general_exclusions },
    { key: 'dwelling', label: 'Dwelling Houses', eligible: v.cdc_dwelling_houses === 'true', exclusions: v.cdc_dwelling_houses_exclusions },
    { key: 'dual', label: 'Dual Occupancy', eligible: v.cdc_dual_occupancy === 'true', exclusions: v.cdc_dual_occupancy_exclusions },
    { key: 'secondary', label: 'Secondary Dwellings', eligible: v.cdc_secondary_dwellings === 'true', exclusions: v.cdc_secondary_dwellings_exclusions },
    { key: 'terraces', label: 'Multi-Dwelling Terraces', eligible: v.cdc_multi_dwelling_terraces === 'true', exclusions: v.cdc_multi_dwelling_terraces_exclusions },
    { key: 'manor', label: 'Manor Homes', eligible: v.cdc_manor_homes === 'true', exclusions: v.cdc_manor_homes_exclusions },
    { key: 'greenfield', label: 'Greenfield Housing', eligible: v.cdc_greenfield_housing === 'true', exclusions: v.cdc_greenfield_housing_exclusions },
    { key: 'rural', label: 'Rural Housing', eligible: v.cdc_rural_housing === 'true', exclusions: v.cdc_rural_housing_exclusions },
    { key: 'agri', label: 'Agritourism', eligible: v.cdc_agritourism === 'true', exclusions: v.cdc_agritourism_exclusions },
    { key: 'farmstay', label: 'Farmstay', eligible: v.cdc_farmstay === 'true', exclusions: v.cdc_farmstay_exclusions },
  ]
})

const patternBookItems = computed(() => {
  if (!property.value) return []
  const v = property.value
  return [
    { key: 'semis1', label: 'Semis — Anthony Gill', eligible: v.semis_01_anthony_gill_eligible === 'true' },
    { key: 'semis2', label: 'Semis — Sibling', eligible: v.semis_02_sibling_eligible === 'true' },
    { key: 'manor1', label: 'Manor Homes — Studio', eligible: v.manor_homes_01_studio_eligible === 'true' },
    { key: 'row1', label: 'Row Homes — SAHA', eligible: v.row_homes_01_saha_eligible === 'true' },
    { key: 'terr1', label: 'Terraces — Carter', eligible: v.terraces_01_carter_eligible === 'true' },
    { key: 'terr2', label: 'Terraces — Sam Crawford', eligible: v.terraces_02_sam_crawford_eligible === 'true' },
    { key: 'terr3', label: 'Terraces — Officer Woods', eligible: v.terraces_03_officer_woods_eligible === 'true' },
    { key: 'terr4', label: 'Terraces — Other', eligible: v.terraces_04_other_eligible === 'true' },
  ].filter(pb => pb.eligible || property.value.in_lmr_housing_area === 'true')
})

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

  // Build context from property
  const v = property.value
  const context = [
    `Address: ${v.address}`, `Zone: ${v.zone} (${v.zone_class || ''})`,
    `LEP: ${v.lep_name || 'N/A'}`, `LGA: ${v.lga_name || 'N/A'}`,
    v.fsr_value ? `FSR: ${v.fsr_value}` : null,
    v.max_height_m ? `Max height: ${v.max_height_m}m` : null,
    v.dcp_plan_name ? `DCP: ${v.dcp_plan_name}` : null,
  ].filter(Boolean).join(' | ')

  const SECTION_INSTRUCTION =
    `Structure your answer in 3 sections: ## LEP Findings, ## SEPP Findings, ## DCP Findings. ` +
    `If nothing found for a section, say so briefly.`

  const enrichedQuery = `${q}\n\nProperty context: ${context}\n\n${SECTION_INSTRUCTION}`

  try {
    const resp = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: enrichedQuery }),
    })

    if (!resp.ok || !resp.body) {
      followupAnswerText.value = `Error: HTTP ${resp.status}`
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      let eventType = ''
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

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = ''
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
.uses-list {
  padding: 0 1rem 0.75rem; display: flex; flex-wrap: wrap; gap: 0.3rem;
}
.use-chip {
  font-size: 0.72rem; padding: 0.2rem 0.5rem; border-radius: 10px;
  background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;
}

/* ── Steps ──────────────────────────────────────────────────────────────── */
.steps-panel {
  margin-bottom: 1rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;
}
.steps-summary { padding: 0.5rem 0.8rem; font-size: 0.75rem; font-weight: 600; color: #64748b; cursor: pointer; }
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
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  min-height: 280px;
}
.lot-map {
  width: 100%;
  height: 280px;
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
.edge-chip {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #e2e8f0;
}
.edge-chip--frontage {
  background: #f0fdf4;
  color: #15803d;
  border-color: #bbf7d0;
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
</style>
