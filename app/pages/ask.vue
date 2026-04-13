<template>
  <div class="ask-page">

    <!-- Disclaimer -->
    <div class="disclaimer">
      <strong>Testing Only</strong> — This AI assistant is experimental and covers a limited set of NSW planning instruments
      (selected LEPs, SEPPs, and some DCPs including Albury, Georges River, Parramatta, Randwick, and Sydney).
      Answers may be incomplete or inaccurate. Always verify with official sources.
    </div>

    <!-- Header -->
    <div class="ask-header">
      <NuxtLink to="/" class="back-link">&larr; Home</NuxtLink>
      <h1 class="ask-title">Ask a Planning Question</h1>
      <p class="ask-subtitle">Query NSW LEPs, SEPPs, and DCPs using AI-powered search</p>
    </div>

    <!-- General planning question -->
    <form class="ask-form" @submit.prevent="submitQuery">
      <div class="ask-search-card">
        <textarea
          v-model="query"
          class="ask-input"
          placeholder="Ask about zoning, land uses, development controls…"
          rows="1"
          :disabled="loading"
          @keydown.enter.exact.prevent="submitQuery"
          @input="autoResize"
        ></textarea>
        <button class="ask-send" :disabled="loading || !query.trim()" type="submit">
          <svg v-if="!loading" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          <span v-else class="spinner"></span>
        </button>
      </div>
    </form>

    <!-- Sample questions -->
    <div v-if="!answerText && !loading" class="samples">
      <div v-for="cat in sampleCategories" :key="cat.label" class="sample-group">
        <span class="sample-label">{{ cat.label }}</span>
        <div class="sample-chips">
          <button
            v-for="q in cat.questions"
            :key="q"
            class="sample-chip"
            @click="askSample(q)"
          >{{ q }}</button>
        </div>
      </div>
    </div>

    <!-- Property-specific question -->
    <div v-if="!answerText && !loading" class="property-section">
      <div class="property-divider">
        <span>or ask about a specific property</span>
      </div>
      <form class="property-form" @submit.prevent="submitPropertyQuery">
        <input
          v-model="address"
          type="text"
          class="property-input"
          placeholder="Enter an address — e.g. 15 Smith Street, Albury NSW"
          :disabled="loading"
        >
        <textarea
          v-model="propertyQuestion"
          class="property-question"
          placeholder="What would you like to know? e.g. What can I build here?"
          rows="1"
          :disabled="loading"
          @input="autoResizeProperty"
        ></textarea>
        <button class="property-btn" :disabled="loading || !address.trim() || !propertyQuestion.trim()" type="submit">
          Search property
        </button>
      </form>
    </div>

    <!-- Steps trace (collapsible) -->
    <details v-if="steps.length > 0" class="steps-panel">
      <summary class="steps-summary">Pipeline steps ({{ steps.length }})</summary>
      <div class="steps-list">
        <div v-for="(s, i) in steps" :key="i" class="step-item">
          <span :class="['step-status', 'step-status--' + s.status]">
            {{ s.status === 'running' ? '⏳' : s.status === 'done' ? '✓' : s.status === 'warn' ? '⚠' : '⏭' }}
          </span>
          <span class="step-agent">{{ s.agent }}</span>
          <span class="step-msg">{{ s.message }}</span>
          <span v-if="s.detail" class="step-detail">{{ s.detail }}</span>
        </div>
      </div>
    </details>

    <!-- Answer -->
    <div v-if="answerHtml || loading" class="answer-section">
      <h2 class="answer-heading">Answer</h2>
      <div class="answer-body" v-html="answerHtml"></div>
      <div v-if="loading && !answerText" class="answer-loading">Thinking...</div>
    </div>

    <!-- Citations / Sources -->
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

  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { renderMarkdownWithCitations, type Citation } from '~/utils/citation-render'

const query = ref('')
const address = ref('')
const propertyQuestion = ref('')
const loading = ref(false)
const answerText = ref('')
const citations = ref<Citation[]>([])
const citeIndex = ref<Record<string, number>>({})
const steps = ref<{ agent: string; status: string; message: string; detail?: string }[]>([])

// ── Sample questions ─────────────────────────────────────────────────────────

const sampleCategories = [
  {
    label: 'Zoning & Permissibility',
    questions: [
      'Is a dual occupancy permitted in zone R2 in Albury?',
      'What land uses are prohibited in zone B4?',
      'Can I operate a home business in a residential zone?',
    ],
  },
  {
    label: 'Development Standards',
    questions: [
      'What is the maximum building height in Parramatta CBD?',
      'What FSR applies to zone R3 in Randwick?',
      'What is the minimum lot size for subdivision in Albury?',
    ],
  },
  {
    label: 'DCP Controls',
    questions: [
      'What are the parking requirements in the Randwick DCP?',
      'What setback controls apply to residential development in Georges River?',
      'What landscaping requirements apply in the Albury DCP?',
    ],
  },
  {
    label: 'SEPP & State Policy',
    questions: [
      'What SEPP provisions apply to boarding houses?',
      'What are the requirements for secondary dwellings under the Housing SEPP?',
      'What exempt development is allowed under the Codes SEPP?',
    ],
  },
]

function askSample(q: string) {
  query.value = q
  nextTick(() => submitQuery())
}

// ── Computed ─────────────────────────────────────────────────────────────────

const answerHtml = computed(() => {
  if (!answerText.value) return ''
  return renderMarkdownWithCitations(answerText.value, citations.value, citeIndex.value)
})

// Auto-submit if arriving with ?q= from the landing page
const route = useRoute()
onMounted(() => {
  const q = String(route.query.q ?? '').trim()
  if (q) {
    query.value = q
    nextTick(() => submitQuery())
  }
})

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 260) + 'px'
}

function autoResizeProperty(e: Event) {
  autoResize(e)
}

async function submitPropertyQuery() {
  const addr = address.value.trim()
  const pq = propertyQuestion.value.trim()
  if (!addr || !pq || loading.value) return
  // Combine address + question into a single query for the graph
  query.value = `${pq} Address: ${addr}`
  await submitQuery()
}

async function submitQuery() {
  const q = query.value.trim()
  if (!q || loading.value) return

  loading.value = true
  answerText.value = ''
  citations.value = []
  citeIndex.value = {}
  steps.value = []

  try {
    const resp = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    })

    if (!resp.ok || !resp.body) {
      answerText.value = `Error: HTTP ${resp.status}`
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
  }
}

function handleSSE(type: string, data: any) {
  switch (type) {
    case 'agent_step':
      // Update or append step
      const existing = steps.value.findIndex(s => s.agent === data.agent)
      const step = { agent: data.agent, status: data.status, message: data.message, detail: data.detail }
      if (existing >= 0) {
        steps.value[existing] = step
      } else {
        steps.value.push(step)
      }
      break
    case 'answer_chunk':
      answerText.value += data.text
      break
    case 'citations':
      citations.value = data.citations || []
      citeIndex.value = data.cite_index || {}
      break
    case 'error':
      answerText.value += `\n\n**Error:** ${data.message}`
      break
  }
}
</script>

<style>
.ask-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Figtree", "Segoe UI", system-ui, sans-serif;
}

/* ── Disclaimer ─────────────────────────────────────────────────────────── */
.disclaimer {
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 0.82rem;
  color: #92400e;
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.ask-header {
  margin-bottom: 1.5rem;
}

.back-link {
  font-size: 0.8rem;
  color: #64748b;
  text-decoration: none;
}
.back-link:hover { color: #15803d; }

.ask-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0.5rem 0 0.25rem;
}

.ask-subtitle {
  font-size: 0.9rem;
  color: #64748b;
  margin: 0;
}

/* ── Form ───────────────────────────────────────────────────────────────── */
.ask-form {
  margin-bottom: 1.5rem;
}

.ask-search-card {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 18px;
  padding: 22px 20px 18px 24px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 10px 30px rgba(15, 23, 42, 0.07);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ask-search-card:focus-within {
  border-color: #15803d;
  box-shadow: 0 1px 3px rgba(21, 128, 61, 0.08), 0 10px 30px rgba(21, 128, 61, 0.14);
}

.ask-input {
  flex: 1;
  min-height: 72px;
  max-height: 260px;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-size: 1.05rem;
  line-height: 1.6;
  color: #0f172a;
  font-family: inherit;
  padding: 4px 0;
}
.ask-input::placeholder { color: #94a3b8; }

.ask-send {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: none;
  background: #15803d;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.1s;
}
.ask-send:hover:not(:disabled) { background: #166534; }
.ask-send:active:not(:disabled) { transform: scale(0.96); }
.ask-send:disabled { background: #cbd5e1; cursor: not-allowed; }

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Steps trace ────────────────────────────────────────────────────────── */
.steps-panel {
  margin-bottom: 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.steps-summary {
  padding: 0.5rem 0.8rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}

.steps-list {
  padding: 0 0.8rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.step-item {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.75rem;
}

.step-status { flex-shrink: 0; width: 1.2rem; text-align: center; }
.step-agent { font-weight: 600; color: #334155; }
.step-msg { color: #64748b; }
.step-detail { color: #94a3b8; font-size: 0.7rem; }

/* ── Answer ─────────────────────────────────────────────────────────────── */
.answer-section {
  margin-bottom: 1.5rem;
}

.answer-heading {
  font-size: 0.8rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 0.75rem;
}

.answer-body {
  font-size: 0.92rem;
  line-height: 1.75;
  color: #1e293b;
}

.answer-body p { margin: 0.5rem 0; }
.answer-body ul { padding-left: 1.2rem; margin: 0.5rem 0; }
.answer-body li { margin: 0.2rem 0; }
.answer-body strong { color: #0f172a; }
.answer-body code { background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.85em; }

.answer-loading {
  color: #94a3b8;
  font-size: 0.85rem;
  font-style: italic;
}

/* ── Citation chips (inline in answer) ──────────────────────────────────── */
.kg2-cite-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1em;
  height: 1.1em;
  padding: 0 0.25em;
  border-radius: 3px;
  font-size: 0.7em;
  font-weight: 700;
  vertical-align: super;
  text-decoration: none;
  cursor: default;
  margin: 0 1px;
}

.kg2-cite-num--lep { background: #dbeafe; color: #1d4ed8; }
.kg2-cite-num--sepp { background: #fef3c7; color: #b45309; }
.kg2-cite-num--dcp { background: #dcfce7; color: #15803d; }
.kg2-cite-num--unknown { background: #f1f5f9; color: #94a3b8; }

a.kg2-cite-num { cursor: pointer; }
a.kg2-cite-num:hover { filter: brightness(0.9); }

/* ── Heading overrides from LLM output ──────────────────────────────────── */
.kg2-h-sm {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  margin: 1rem 0 0.25rem;
}
.kg2-h-md {
  font-size: 0.88rem;
  font-weight: 700;
  color: #1e293b;
  margin: 1rem 0 0.25rem;
}

/* ── Sources ────────────────────────────────────────────────────────────── */
.sources-section {
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
}

.sources-heading {
  font-size: 0.8rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 0.75rem;
}

.sources-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.source-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.82rem;
  padding: 0.5rem 0.7rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.source-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.4em;
  height: 1.4em;
  background: #e2e8f0;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 700;
  color: #475569;
}

.source-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  letter-spacing: 0.03em;
}
.source-badge--lep { background: #dbeafe; color: #1d4ed8; }
.source-badge--sepp { background: #fef3c7; color: #b45309; }
.source-badge--dcp { background: #dcfce7; color: #15803d; }

.source-label { color: #334155; }
.source-link {
  font-size: 0.72rem;
  color: #15803d;
  text-decoration: none;
  margin-left: auto;
}
.source-link:hover { text-decoration: underline; }

.source-quote {
  width: 100%;
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: #64748b;
  font-style: italic;
  line-height: 1.5;
  border-left: 2px solid #e2e8f0;
  padding-left: 0.5rem;
}

/* ── Sample questions ─────────────────────────────────────────────────────── */
.samples {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.sample-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.sample-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

.sample-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.sample-chip {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 0.35rem 0.75rem;
  font-size: 0.78rem;
  color: #475569;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
  text-align: left;
  line-height: 1.4;
}
.sample-chip:hover {
  background: #f0fdf4;
  border-color: #15803d;
  color: #15803d;
}

/* ── Property section ─────────────────────────────────────────────────────── */
.property-section {
  margin-bottom: 2rem;
}

.property-divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 0 1.25rem;
  color: #94a3b8;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.property-divider::before,
.property-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.property-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 1rem 1.25rem;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  transition: border-color 0.15s;
}
.property-form:focus-within {
  border-color: #15803d;
}

.property-input {
  border: none;
  outline: none;
  font-size: 0.95rem;
  font-family: inherit;
  color: #0f172a;
  padding: 0.3rem 0;
  border-bottom: 1px solid #f1f5f9;
}
.property-input::placeholder { color: #94a3b8; }

.property-question {
  border: none;
  outline: none;
  resize: none;
  font-size: 0.88rem;
  font-family: inherit;
  color: #0f172a;
  padding: 0.3rem 0;
  min-height: 36px;
  max-height: 120px;
}
.property-question::placeholder { color: #b0bcc9; }

.property-btn {
  align-self: flex-end;
  padding: 0.5rem 1.2rem;
  background: #0f172a;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.property-btn:hover:not(:disabled) { background: #1e293b; }
.property-btn:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
