<!--
  /doc-viewer?doc=<key>&anchor=<section-local-id>

  Renders a DCP markdown file with:
  - Auto-generated ID on each heading (matches section_local_id from parser)
  - Sidebar ToC for navigation
  - Scroll-to-anchor on mount
  - Tables preserved, images from static.heenco.com
-->

<template>
  <div class="dv-page">
    <div v-if="!docInfo" class="dv-error">
      <h1>Document not found</h1>
      <p>Unknown doc key: <code>{{ docKey }}</code></p>
      <p>Available: {{ availableDocs.join(', ') }}</p>
      <NuxtLink to="/ask" class="dv-back">← Back to Ask</NuxtLink>
    </div>

    <template v-else>
      <!-- Header -->
      <header class="dv-header">
        <div class="dv-header-left">
          <NuxtLink to="/ask" class="dv-back">← Back to Ask</NuxtLink>
          <h1 class="dv-title">{{ docInfo.title }}</h1>
          <div class="dv-meta">{{ docInfo.lga }} · DCP</div>
        </div>
        <div class="dv-header-right">
          <button class="dv-toc-toggle" @click="tocOpen = !tocOpen">
            {{ tocOpen ? 'Hide' : 'Show' }} Contents
          </button>
        </div>
      </header>

      <!-- Loading -->
      <div v-if="loading" class="dv-loading">Loading {{ docInfo.title }}…</div>
      <div v-else-if="loadError" class="dv-error">
        <h2>Failed to load document</h2>
        <pre>{{ loadError }}</pre>
      </div>

      <!-- Main layout -->
      <div v-else class="dv-layout">
        <!-- Sidebar ToC -->
        <aside v-if="tocOpen" class="dv-toc">
          <div class="dv-toc-title">Table of Contents</div>
          <ul class="dv-toc-list">
            <li
              v-for="item in toc"
              :key="item.id"
              :class="`dv-toc-item dv-toc-item--l${item.level}`"
            >
              <a :href="`#${item.id}`" @click.prevent="scrollTo(item.id)">
                {{ item.text }}
              </a>
            </li>
          </ul>
        </aside>

        <!-- Rendered content -->
        <main class="dv-content" ref="contentEl">
          <div class="dv-body" v-html="renderedHtml" />
        </main>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'

interface DocEntry {
  title:    string
  lga:      string
  mdPath:   string
}

const DOC_MAP: Record<string, DocEntry> = {
  'albury-dcp': {
    title: 'Albury DCP 2010',
    lga:   'Albury',
    mdPath: '/EPI/DCPs/albury-dcp-2010.md',
  },
  'georges-river-dcp': {
    title: 'Georges River DCP 2021',
    lga:   'Georges River',
    mdPath: '/EPI/DCPs/georges-river-dcp-2021.md',
  },
  'parramatta-dcp': {
    title: 'Parramatta DCP 2023',
    lga:   'Parramatta',
    mdPath: '/EPI/DCPs/parramatta-dcp-2023.md',
  },
  'randwick-dcp': {
    title: 'Randwick Comprehensive DCP 2013',
    lga:   'Randwick',
    mdPath: '/EPI/DCPs/randwick-comprehensive-dcp-2013.md',
  },
  'liverpool-dcp-main': {
    title: 'Liverpool Growth Centre Precincts DCP — Main Body',
    lga:   'Liverpool',
    mdPath: '/EPI/DCPs/liverpool-gcp-main-body.md',
  },
  'liverpool-dcp-sch1': {
    title: 'Liverpool Growth Centre Precincts DCP — Schedule 1',
    lga:   'Liverpool',
    mdPath: '/EPI/DCPs/liverpool-gcp-schedule-1.md',
  },
  'liverpool-dcp-sch2': {
    title: 'Liverpool Growth Centre Precincts DCP — Schedule 2',
    lga:   'Liverpool',
    mdPath: '/EPI/DCPs/liverpool-gcp-schedule-2.md',
  },
  'liverpool-dcp-sch3': {
    title: 'Liverpool Growth Centre Precincts DCP — Schedule 3',
    lga:   'Liverpool',
    mdPath: '/EPI/DCPs/liverpool-gcp-schedule-3.md',
  },
}

interface TocItem {
  id:    string
  text:  string
  level: number
}

const route = useRoute()
const docKey = computed(() => String(route.query.doc ?? ''))
const anchor = computed(() => String(route.query.anchor ?? ''))

const docInfo = computed(() => DOC_MAP[docKey.value])
const availableDocs = Object.keys(DOC_MAP)

const loading = ref(true)
const loadError = ref<string | null>(null)
const rawMd = ref('')
const toc = ref<TocItem[]>([])
const renderedHtml = ref('')
const tocOpen = ref(true)
const contentEl = ref<HTMLElement | null>(null)

const IMG_BASE = 'https://static.heenco.com/EPI/DCPs'

async function loadDoc() {
  if (!docInfo.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = null

  try {
    const res = await fetch(docInfo.value.mdPath)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${docInfo.value.mdPath}`)
    rawMd.value = await res.text()
    renderMarkdown()
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function renderMarkdown() {
  const localIdSeen = new Map<string, number>()
  const tocItems: TocItem[] = []

  const renderer = new marked.Renderer()

  renderer.heading = function(args: any) {
    const text = args.text
    const level = args.depth
    const numMatch = text.match(/^([A-Z]?\d+(?:\.\d+)*[A-Z]?)\s+(.+)$/)
    let id: string
    if (numMatch) {
      id = `dcp.${numMatch[1]}`
    } else {
      const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
      id = `dcp.h${level}.${slug}`
    }

    const seenCount = localIdSeen.get(id) ?? 0
    const finalId = seenCount > 0 ? `${id}#${seenCount + 1}` : id
    localIdSeen.set(id, seenCount + 1)

    const domId = finalId.replace(/#/g, '_')
    tocItems.push({ id: domId, text, level })

    return `<h${level} id="${domId}" class="dv-h dv-h-${level}"><a class="dv-h-anchor" href="#${domId}">#</a>${text}</h${level}>`
  }

  // Resolve image paths to static.heenco.com
  renderer.image = function(args: any) {
    const href = args.href
    const text = args.text
    const resolvedHref = href.startsWith('http') || href.startsWith('/')
      ? href
      : `${IMG_BASE}/${href}`
    return `<img src="${resolvedHref}" alt="${text}" class="dv-img" loading="lazy" />`
  }

  marked.setOptions({ gfm: true, breaks: false })
  renderedHtml.value = marked.parse(rawMd.value, { renderer }) as string
  toc.value = tocItems
}

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }
}

function scrollToAnchor() {
  if (!anchor.value) return
  const candidates = [
    anchor.value,
    `dcp.${anchor.value}`,
    `dcp.${anchor.value.replace(/^sec\./, '')}`,
  ]
  for (const cand of candidates) {
    const domId = cand.replace(/#/g, '_')
    const el = document.getElementById(domId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
  }
}

onMounted(async () => {
  await loadDoc()
  await nextTick()
  setTimeout(scrollToAnchor, 100)
})

watch(() => route.fullPath, async () => {
  await loadDoc()
  await nextTick()
  setTimeout(scrollToAnchor, 100)
})
</script>

<style scoped>
.dv-page {
  min-height: 100vh;
  background: #fafafa;
  font-family: system-ui, -apple-system, sans-serif;
  color: #0f172a;
}

.dv-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 32px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
}

.dv-back {
  display: inline-block;
  font-size: 13px;
  color: #64748b;
  text-decoration: none;
  margin-bottom: 8px;
}
.dv-back:hover { color: #0f172a; }

.dv-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  color: #0f172a;
}
.dv-meta {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
}

.dv-toc-toggle {
  padding: 6px 12px;
  background: #0f172a;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.dv-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 0;
  max-width: 1400px;
  margin: 0 auto;
}

.dv-toc {
  position: sticky;
  top: 92px;
  max-height: calc(100vh - 92px);
  overflow-y: auto;
  padding: 20px 16px 20px 32px;
  border-right: 1px solid #e5e7eb;
  background: #fff;
}
.dv-toc-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #94a3b8;
  margin-bottom: 12px;
}
.dv-toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.dv-toc-item {
  font-size: 12px;
  line-height: 1.4;
  margin-bottom: 4px;
}
.dv-toc-item a {
  color: #475569;
  text-decoration: none;
  display: block;
  padding: 2px 6px;
  border-radius: 3px;
}
.dv-toc-item a:hover {
  background: #f1f5f9;
  color: #0f172a;
}
.dv-toc-item--l1 { font-weight: 700; color: #0f172a; padding-top: 6px; }
.dv-toc-item--l1 a { color: #0f172a; }
.dv-toc-item--l2 { padding-left: 12px; }
.dv-toc-item--l3 { padding-left: 24px; font-size: 11px; }
.dv-toc-item--l4 { padding-left: 36px; font-size: 11px; color: #94a3b8; }

.dv-content {
  padding: 32px 48px;
  max-width: 900px;
}

.dv-body {
  line-height: 1.7;
  color: #1e293b;
}

.dv-body :deep(h1),
.dv-body :deep(h2),
.dv-body :deep(h3),
.dv-body :deep(h4) {
  scroll-margin-top: 100px;
  color: #0f172a;
  font-weight: 700;
  line-height: 1.3;
  margin-top: 2em;
  margin-bottom: 0.5em;
}
.dv-body :deep(h1) { font-size: 28px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
.dv-body :deep(h2) { font-size: 22px; }
.dv-body :deep(h3) { font-size: 18px; }
.dv-body :deep(h4) { font-size: 15px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }

.dv-body :deep(.dv-h-anchor) {
  color: #cbd5e1;
  text-decoration: none;
  margin-right: 8px;
  font-weight: 400;
  opacity: 0;
  transition: opacity 0.15s;
}
.dv-body :deep(h1:hover .dv-h-anchor),
.dv-body :deep(h2:hover .dv-h-anchor),
.dv-body :deep(h3:hover .dv-h-anchor),
.dv-body :deep(h4:hover .dv-h-anchor) {
  opacity: 1;
}

.dv-body :deep(p) { margin: 0.8em 0; }
.dv-body :deep(ul),
.dv-body :deep(ol) { margin: 0.8em 0; padding-left: 1.6em; }
.dv-body :deep(li) { margin: 0.3em 0; }

.dv-body :deep(table) {
  border-collapse: collapse;
  margin: 1.2em 0;
  font-size: 13px;
  width: 100%;
}
.dv-body :deep(th),
.dv-body :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}
.dv-body :deep(th) {
  background: #f8fafc;
  font-weight: 600;
}

.dv-body :deep(.dv-img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 1em 0;
  border: 1px solid #e5e7eb;
}

.dv-body :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 3px;
}

.dv-loading,
.dv-error {
  padding: 60px 32px;
  text-align: center;
  color: #64748b;
}
.dv-error h1,
.dv-error h2 { color: #b91c1c; }
.dv-error pre {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: #fef2f2;
  padding: 12px;
  border-radius: 6px;
  margin: 20px auto;
  max-width: 600px;
  text-align: left;
}
</style>
