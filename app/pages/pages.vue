<!--
  /pages - every page in the app: built, being built, planned.

  A map of the app rather than a feature of it. The live pages are grouped by
  what they are for, the one being built is shown as such, and the planned
  ones are the notebooks in the pipeline that have no page yet. All of it is
  content, in shared/site-pages.ts; this file only lays it out, in the same
  shape as /datasources and /testing-spatial-services: sticky header, a rail
  of sections, one content column.
-->

<template>
  <div class="pg-page">
    <header class="pg-header">
      <div>
        <NuxtLink to="/" class="pg-back">&larr; Home</NuxtLink>
        <h1 class="pg-title">Pages</h1>
      </div>
      <div class="pg-header-stat">
        <strong>{{ live.length }}</strong> live · <strong>{{ building.length }}</strong> being built · <strong>{{ planned.length }}</strong> planned
      </div>
    </header>

    <div class="pg-shell">
      <aside class="pg-rail">
        <p class="pg-rail-state">On this page</p>
        <nav aria-label="Sections">
          <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="pg-rail-link" :class="{ 'pg-rail-link--on': activeSection === s.id }">{{ s.label }}</a>
        </nav>
      </aside>

      <main class="pg-main">
        <section v-for="g in PAGE_GROUPS" :id="g.id" :key="g.id" class="pg-section">
          <p class="pg-kicker">built</p>
          <h2 class="pg-h2">{{ g.label }}</h2>
          <p class="pg-lead">{{ g.lead }}</p>
          <ul class="pg-list">
            <li v-for="p in liveIn(g.kind)" :key="p.route" class="pg-card">
              <div class="pg-card-head">
                <NuxtLink :to="p.route" class="pg-name">{{ p.name }}</NuxtLink>
                <code class="pg-route">{{ p.route }}</code>
                <span v-if="p.added" class="pg-added">added {{ fmtDate(p.added) }}</span>
              </div>
              <p class="pg-summary">{{ p.summary }}</p>
              <p v-if="p.detail" class="pg-detail">{{ p.detail }}</p>
              <p v-if="p.reads?.length || p.notebook" class="pg-reads">
                <template v-if="p.reads?.length">
                  <span class="pg-reads-label">reads</span>
                  <code v-for="r in p.reads" :key="r">{{ r }}</code>
                </template>
                <template v-if="p.notebook">
                  <span class="pg-reads-label">built by</span>
                  <code>{{ p.notebook }}</code>
                </template>
              </p>
            </li>
          </ul>
        </section>

        <section id="building" class="pg-section">
          <p class="pg-kicker">in the working tree</p>
          <h2 class="pg-h2">Being built</h2>
          <p class="pg-lead">Exists and can be opened, but is not finished and has not been deployed.</p>
          <ul class="pg-list">
            <li v-for="p in building" :key="p.route" class="pg-card pg-card--building">
              <div class="pg-card-head">
                <NuxtLink :to="p.route" class="pg-name">{{ p.name }}</NuxtLink>
                <code class="pg-route">{{ p.route }}</code>
                <span class="pg-badge pg-badge--building">being built</span>
              </div>
              <p class="pg-summary">{{ p.summary }}</p>
              <p v-if="p.reads?.length || p.notebook" class="pg-reads">
                <template v-if="p.reads?.length">
                  <span class="pg-reads-label">reads</span>
                  <code v-for="r in p.reads" :key="r">{{ r }}</code>
                </template>
                <template v-if="p.notebook">
                  <span class="pg-reads-label">built by</span>
                  <code>{{ p.notebook }}</code>
                </template>
              </p>
            </li>
            <li v-if="!building.length" class="pg-empty">Nothing at the moment.</li>
          </ul>
        </section>

        <section id="planned" class="pg-section">
          <p class="pg-kicker">next</p>
          <h2 class="pg-h2">Planned</h2>
          <p class="pg-lead">
            Builds that exist as notebooks in the pipeline and have no page yet, in the order the
            pipeline runs them. The route names are provisional; the list is
            <code>shared/site-pages.ts</code>, so adding, renaming or dropping one is an edit there.
          </p>
          <ul class="pg-list">
            <li v-for="p in planned" :key="p.route" class="pg-card pg-card--planned">
              <div class="pg-card-head">
                <span class="pg-name pg-name--planned">{{ p.name }}</span>
                <code class="pg-route">{{ p.route }}</code>
                <span class="pg-badge">planned</span>
                <span class="pg-kind">{{ kindLabel(p.kind) }}</span>
              </div>
              <p class="pg-summary">{{ p.summary }}</p>
              <p v-if="p.notebook" class="pg-reads">
                <span class="pg-reads-label">from</span>
                <code>{{ p.notebook }}</code>
              </p>
            </li>
          </ul>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PAGE_GROUPS, SITE_PAGES, type PageKind } from '#shared/site-pages'

useHead({ title: 'Pages · Planning Library' })

const live = SITE_PAGES.filter(p => p.status === 'live')
const building = SITE_PAGES.filter(p => p.status === 'building')
const planned = SITE_PAGES.filter(p => p.status === 'planned')
const liveIn = (kind: PageKind) => live.filter(p => p.kind === kind)

const KIND_LABEL: Record<PageKind, string> = { answer: 'answers', browse: 'library', map: 'maps', testing: 'testing' }
const kindLabel = (k: PageKind) => KIND_LABEL[k]

const sections = computed(() => [
  ...PAGE_GROUPS.map(g => ({ id: g.id, label: g.label })),
  { id: 'building', label: 'Being built' },
  { id: 'planned', label: 'Planned' },
])

// Fixed month names rather than toLocaleDateString: the server and the
// browser format a locale date differently often enough to break hydration.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

// ── rail: which section is in view ──────────────────────────────────────────
// The observer only reports entries that changed, so the set of sections in
// the band is kept across callbacks; the first of them, in page order, wins -
// except at the very end of the page, where the last section is the one meant.
const activeSection = ref(sections.value[0]!.id)
let observer: IntersectionObserver | null = null
const inBand = new Map<string, boolean>()
function pickActive() {
  const order = sections.value.map(s => s.id)
  const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
  if (atEnd) { activeSection.value = order[order.length - 1]!; return }
  const first = order.find(id => inBand.get(id))
  if (first) activeSection.value = first
}
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) inBand.set((e.target as HTMLElement).id, e.isIntersecting)
    pickActive()
  }, { rootMargin: '-96px 0px -55% 0px', threshold: 0 })
  for (const s of sections.value) {
    const el = document.getElementById(s.id)
    if (el) observer.observe(el)
  }
  window.addEventListener('scroll', pickActive, { passive: true })
})
onBeforeUnmount(() => { observer?.disconnect(); window.removeEventListener('scroll', pickActive) })
</script>

<style scoped>
/* base: copied from testing-spatial-services */
.pg-page {
  min-height: 100vh;
  background: #f8fafb;
  color: #1e293b;
  font-family: -apple-system, BlinkMacSystemFont, "Figtree", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.pg-header {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap;
  padding: 1.25rem 2rem;
  background: #fff; border-bottom: 1px solid #e2e8f0;
  position: sticky; top: 0; z-index: 10;
}
.pg-back { display: inline-block; font-size: 0.78rem; color: #64748b; text-decoration: none; margin-bottom: 0.3rem; }
.pg-back:hover { color: #0f172a; }
.pg-title { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
.pg-header-stat { font-size: 0.8rem; color: #64748b; }
.pg-header-stat strong { color: #0f172a; font-weight: 700; }

.pg-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 2.25rem; max-width: 1360px; margin: 0 auto; padding: 1.5rem 2rem 5rem; align-items: start; }
@media (max-width: 900px) { .pg-shell { grid-template-columns: 1fr; } .pg-rail { position: static; } }
.pg-rail { position: sticky; top: 6rem; display: flex; flex-direction: column; gap: 0.1rem; }
.pg-rail-state { margin: 0 0 0.6rem; font-size: 0.95rem; font-weight: 800; color: #0f172a; }
.pg-rail-link { display: block; padding: 0.3rem 0.6rem; border-left: 2px solid #e2e8f0; font-size: 0.84rem; color: #475569; text-decoration: none; }
.pg-rail-link:hover { color: #0f172a; border-left-color: #94a3b8; }
.pg-rail-link--on { color: #4a3aa7; font-weight: 700; border-left-color: #4a3aa7; }

.pg-main { min-width: 0; }
.pg-section { scroll-margin-top: 6rem; padding-bottom: 2.5rem; margin-bottom: 2.5rem; border-bottom: 1px solid #e2e8f0; }
.pg-section:last-child { border-bottom: none; margin-bottom: 0; }
.pg-kicker { margin: 0 0 0.2rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #4a3aa7; }
.pg-h2 { margin: 0 0 0.5rem; font-size: 1.45rem; font-weight: 800; color: #0f172a; }
.pg-lead { margin: 0 0 1.25rem; font-size: 0.98rem; line-height: 1.6; color: #334155; max-width: 75ch; }
.pg-page code { font: 0.86em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; border-radius: 4px; padding: 0.05em 0.3em; }

/* the cards */
.pg-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
.pg-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0.9rem 1.1rem; }
.pg-card--building { border-color: #fcd34d; }
.pg-card--planned { background: #fafafa; border-style: dashed; }
.pg-card-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.7rem; margin-bottom: 0.35rem; }
.pg-name { font-size: 1.02rem; font-weight: 800; color: #0f172a; text-decoration: none; }
a.pg-name:hover { color: #4a3aa7; text-decoration: underline; }
.pg-name--planned { color: #475569; }
.pg-route { color: #4a3aa7; }
.pg-added, .pg-kind { font-size: 0.74rem; color: #94a3b8; }
.pg-badge { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; background: #f1f5f9; border-radius: 999px; padding: 0.1em 0.6em; }
.pg-badge--building { color: #92400e; background: #fef3c7; }
.pg-summary { margin: 0; font-size: 0.92rem; line-height: 1.55; color: #334155; max-width: 80ch; }
.pg-detail { margin: 0.3rem 0 0; font-size: 0.84rem; line-height: 1.5; color: #64748b; max-width: 80ch; }
.pg-reads { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem 0.4rem; margin: 0.55rem 0 0; font-size: 0.78rem; }
.pg-reads-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; margin-right: 0.15rem; }
.pg-reads-label:not(:first-child) { margin-left: 0.5rem; }
.pg-empty { color: #94a3b8; font-size: 0.9rem; }
@media (max-width: 560px) { .pg-shell { padding: 1rem 1rem 4rem; } .pg-card { padding: 0.8rem 0.9rem; } }
</style>
