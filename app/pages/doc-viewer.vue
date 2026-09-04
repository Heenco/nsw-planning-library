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
    <div v-if="resolving" class="dv-loading">Loading document…</div>

    <div v-else-if="!docInfo" class="dv-error">
      <h1>Document not found</h1>
      <p>Unknown doc key: <code>{{ docKey }}</code></p>
      <p>Not in the instruments index. Known DCP keys: {{ availableDocs.join(', ') }}</p>
      <NuxtLink to="/library" class="dv-back">← Browse the library</NuxtLink>
    </div>

    <template v-else>
      <!-- Header -->
      <header class="dv-header" ref="headerEl">
        <div class="dv-header-left">
          <NuxtLink :to="backTo" class="dv-back">{{ backLabel }}</NuxtLink>
          <h1 class="dv-title">{{ docInfo.title }}</h1>
          <div class="dv-meta">{{ docInfo.lga }} · {{ docInfo.kind ?? 'DCP' }}</div>
        </div>
        <div class="dv-header-right">
          <!-- Only formats that actually exist on disk are offered. -->
          <div v-if="available.length > 1" class="dv-tabs" role="tablist">
            <button
              v-for="f in available"
              :key="f"
              type="button"
              role="tab"
              class="dv-tab"
              :class="{ 'dv-tab--on': format === f }"
              :aria-selected="format === f"
              @click="selectFormat(f)"
            >
              {{ FORMAT_LABEL[f] }}
            </button>
          </div>
          <button
            v-if="format !== 'pdf'"
            class="dv-toc-toggle"
            @click="tocOpen = !tocOpen"
          >
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

      <!-- Source PDF, rendered by the browser. Citations carrying a page
           land on it directly via #page=N. -->
      <div v-else-if="format === 'pdf'" class="dv-pdf-wrap">
        <iframe :src="pdfSrc" class="dv-pdf" :title="docInfo.title" />
      </div>

      <!-- Main layout -->
      <div v-else class="dv-layout">
        <!-- Sidebar ToC -->
        <aside v-if="tocOpen" class="dv-toc">
          <div class="dv-toc-head">
            <span class="dv-toc-title">Contents</span>
            <span class="dv-toc-actions">
              <button type="button" class="dv-toc-act" @click="expandAll">Expand all</button>
              <button type="button" class="dv-toc-act" @click="collapseAll">Collapse all</button>
            </span>
          </div>

          <div v-for="part in tocParts" :key="part.key" class="dv-part">
            <!-- Multi-part documents get a collapsible group per part. -->
            <button
              v-if="part.label"
              type="button"
              class="dv-part-btn"
              :class="{ 'dv-part-btn--on': openPart === part.key }"
              @click="togglePart(part.key)"
            >
              <span class="dv-part-caret">{{ openPart === part.key ? '▾' : '▸' }}</span>
              <span class="dv-part-label">{{ part.label }}</span>
              <span v-if="part.page" class="dv-toc-page">{{ part.page }}</span>
            </button>

            <ul v-if="!part.label || openPart === part.key" class="dv-toc-list">
              <li
                v-for="row in visibleRows(part.nodes)"
                :key="row.id"
                class="dv-toc-row"
                :style="{ paddingLeft: `${row.depth * 12}px` }"
              >
                <button
                  v-if="row.children.length"
                  type="button"
                  class="dv-toc-caret"
                  :aria-expanded="expanded.has(row.id)"
                  @click.stop="toggleNode(row.id)"
                >{{ expanded.has(row.id) ? '▾' : '▸' }}</button>
                <span v-else class="dv-toc-caret dv-toc-caret--leaf"></span>

                <a
                  class="dv-toc-link"
                  :class="`dv-toc-link--l${row.level}`"
                  :href="`#${row.id}`"
                  @click.prevent="scrollTo(row.id)"
                >{{ row.text }}</a>

                <span v-if="row.page" class="dv-toc-page">{{ row.page }}</span>
              </li>
            </ul>
          </div>
        </aside>

        <!-- Rendered content -->
        <main class="dv-content" ref="contentEl" @click="onContentClick">
          <div class="dv-body" v-html="renderedHtml" />
        </main>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import { formatSectionId } from '#shared/citation-format'
import { createHeadingResolver, HEADING_ID_SUFFIX_RE } from '~/utils/doc-anchors'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

interface DocEntry {
  title:    string
  lga:      string
  mdPath:   string
  /** Badge shown next to the LGA in the header. Defaults to DCP. */
  kind?:    string
  /** Source PDF, when a copy is served from public/. */
  pdfPath?: string
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
  /** Page the heading sits on, shown right-aligned like a printed contents. */
  page?: number | null
  /** Source part this heading belongs to, used to group the contents. */
  part?: string | null
}

/** A TocItem with its subordinate headings nested underneath. */
interface TocNode extends TocItem {
  children: TocNode[]
}

/** One part of a multi-part DCP, with its own contents tree. */
interface TocPart {
  key:   string
  label: string
  page:  number | null
  nodes: TocNode[]
}

const route = useRoute()
const docKey = computed(() => String(route.query.doc ?? ''))
const anchor = computed(() => String(route.query.anchor ?? ''))

// DOC_MAP above covers the DCPs, which carry hand-written keys and image
// rewriting. Everything else in the library — every LEP and SEPP — is
// resolved by slug out of /instruments.json instead, so the viewer works
// for the whole catalogue rather than the eight DCPs.
const resolvedDoc = ref<DocEntry | null>(null)
const resolving = ref(true)

const docInfo = computed(() => DOC_MAP[docKey.value] ?? resolvedDoc.value ?? undefined)
const availableDocs = Object.keys(DOC_MAP)

// ── Available formats ───────────────────────────────────────────────────
//
// A document can exist as structured HTML (tables with captions, authored
// anchor ids), as Markdown, and as the source PDF. Offer whichever are
// actually on disk rather than assuming — most documents are Markdown only.

type DocFormat = 'html' | 'md' | 'pdf'

const FORMAT_LABEL: Record<DocFormat, string> = {
  html: 'Structured',
  md:   'Markdown',
  pdf:  'PDF',
}

const available = ref<DocFormat[]>([])
const format = ref<DocFormat>('md')
/** Set once the reader picks a tab, so probing never overrides them. */
const formatChosen = ref(false)

function selectFormat(f: DocFormat) {
  formatChosen.value = true
  format.value = f
}

/** Sibling .html for a document whose canonical path is .md, and vice versa. */
const htmlPath = computed(() => {
  const p = docInfo.value?.mdPath ?? ''
  if (!p) return ''
  return /\.html?$/i.test(p) ? p : p.replace(/\.md$/i, '.html')
})
const mdPath = computed(() => {
  const p = docInfo.value?.mdPath ?? ''
  if (!p) return ''
  return /\.md$/i.test(p) ? p : p.replace(/\.html?$/i, '.md')
})

async function exists(url: string): Promise<boolean> {
  if (!url) return false
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function probeFormats() {
  // Probe the structured version only where one could exist. A miss under
  // public/ falls through to the SSR handler, which tries to match the path
  // as a route, logs "No match found" and renders a 404, so a blind probe
  // costs a wasted server render. DCPs and LEPs are both converted
  // (scripts/dcp-convert.mjs, scripts/xml-to-html.mjs); SEPPs mostly have no
  // XML to convert from, so they still go straight to markdown.
  const htmlPossible = docType.value === 'dcp'
    || docType.value === 'lep'
    || /\.html?$/i.test(docInfo.value?.mdPath ?? '')

  const [hasHtml, hasMd, hasPdf] = await Promise.all([
    htmlPossible ? exists(htmlPath.value) : Promise.resolve(false),
    exists(mdPath.value),
    exists(docInfo.value?.pdfPath ?? ''),
  ])
  const list: DocFormat[] = []
  if (hasHtml) list.push('html')
  if (hasMd) list.push('md')
  if (hasPdf) list.push('pdf')
  available.value = list
  // Default to the richest format on offer — `list` is ordered
  // structured → markdown → pdf, and the structured version is the one
  // with real tables and stable anchors that citations resolve against.
  // Only fall back to overriding once the reader has picked a tab.
  if (!formatChosen.value) format.value = list[0] ?? 'md'
  else if (!list.includes(format.value)) format.value = list[0] ?? 'md'
}

/** Jump the embedded PDF to the page a citation points at. */
const pdfSrc = computed(() => {
  const p = docInfo.value?.pdfPath
  if (!p) return ''
  const page = Number(route.query.page)
  return page > 0 ? `${p}#page=${page}` : p
})

// ── Document state ──────────────────────────────────────────────────────
//
// Declared before the contents tree below: `watch()` evaluates its source
// once at setup to capture the initial value, so a computed reading `toc`
// must not be watched before `toc` exists.
const loading = ref(true)
const loadError = ref<string | null>(null)
const rawMd = ref('')
const toc = ref<TocItem[]>([])
const renderedHtml = ref('')
const tocOpen = ref(true)
const contentEl = ref<HTMLElement | null>(null)

// ── Contents tree ───────────────────────────────────────────────────────
//
// A flat list is unusable for a 489-page DCP with 1,861 headings. Group by
// the source part, nest by heading level, and show the page number — the
// way the document's own printed contents reads.

/** "HDCP 2024 Part 4 Business - 23 June 2025.pdf" → "Part 4 – Business" */
function prettyPart(src: string): string {
  const m = src.match(/\bPart\s+(\d+)\s+([A-Za-z][A-Za-z\s&']*?)(?:\s*[-–]\s*\d|\.pdf|$)/i)
  if (m) return `Part ${m[1]} – ${m[2].trim()}`
  return src.replace(/\.pdf$/i, '').replace(/^D\d+\s*/, '').replace(/\s*[-–]\s*\d.*$/, '').trim() || src
}

/** Nest a level-ordered flat list into a tree. */
function nestToc(items: TocItem[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []
  for (const item of items) {
    const node: TocNode = { ...item, children: [] }
    while (stack.length && stack[stack.length - 1]!.level >= node.level) stack.pop()
    if (stack.length) stack[stack.length - 1]!.children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

const tocParts = computed<TocPart[]>(() => {
  const items = toc.value
  if (!items.length) return []
  const groups = new Map<string, TocItem[]>()
  for (const it of items) {
    const key = it.part ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(it)
  }
  // A single-part document needs no part grouping at all.
  if (groups.size <= 1) {
    return [{ key: '', label: '', page: null, nodes: nestToc(items) }]
  }
  return [...groups].map(([key, group]) => ({
    key,
    label: key ? prettyPart(key) : 'Front matter',
    page: group[0]?.page ?? null,
    nodes: nestToc(group),
  }))
})

const expanded = ref<Set<string>>(new Set())
const openPart = ref<string | null>(null)

// Open a part once the contents are built, otherwise the sidebar reads as
// empty. Prefer the first real part over the front matter. Not `immediate`:
// `toc` is declared further down, so evaluating this during setup would hit
// the temporal dead zone.
watch(tocParts, (parts) => {
  if (!parts.length) { openPart.value = null; return }
  if (openPart.value && parts.some((p) => p.key === openPart.value)) return
  const firstReal = parts.find((p) => /\bPart\s+\d/i.test(p.label)) ?? parts[0]!
  openPart.value = firstReal.key
})

function toggleNode(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function togglePart(key: string) {
  openPart.value = openPart.value === key ? null : key
}

function expandAll() {
  const all = new Set<string>()
  const walk = (nodes: TocNode[]) => nodes.forEach((n) => { all.add(n.id); walk(n.children) })
  tocParts.value.forEach((p) => walk(p.nodes))
  expanded.value = all
}

function collapseAll() {
  expanded.value = new Set()
}

/** Flatten one part's tree to the rows currently visible. */
function visibleRows(nodes: TocNode[], depth = 0): Array<TocNode & { depth: number }> {
  const rows: Array<TocNode & { depth: number }> = []
  for (const n of nodes) {
    rows.push({ ...n, depth })
    if (n.children.length && expanded.value.has(n.id)) {
      rows.push(...visibleRows(n.children, depth + 1))
    }
  }
  return rows
}

/** Which referencing regime this document follows. DOC_MAP entries carry
 *  no kind and are all DCPs. */
const docType = computed<'lep' | 'sepp' | 'dcp'>(() => {
  const k = (docInfo.value?.kind ?? 'dcp').toLowerCase()
  return k === 'lep' || k === 'sepp' ? k : 'dcp'
})

/** Where the "back" link points — set by whoever linked here. */
const BACK_TARGETS: Record<string, { to: string; label: string }> = {
  library: { to: '/library', label: '← Back to Library' },
  home:    { to: '/',        label: '← Back to Home' },
}
const backTarget = computed(
  () => BACK_TARGETS[String(route.query.from ?? '')] ?? { to: '/ask', label: '← Back to Ask' },
)
const backTo    = computed(() => backTarget.value.to)
const backLabel = computed(() => backTarget.value.label)

interface InstrumentItem { slug: string; title: string; file: string }

/** Look the doc key up in the shared instruments index. Cheap and cached
 *  by the browser; only runs when DOC_MAP misses. */
async function resolveFromIndex() {
  resolvedDoc.value = null
  if (!docKey.value || DOC_MAP[docKey.value]) {
    resolving.value = false
    return
  }
  resolving.value = true
  try {
    const res = await fetch('/instruments.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const index = await res.json() as Record<string, {
      label: string
      categories: Record<string, { label: string; items: InstrumentItem[] }>
    }>

    for (const state of Object.values(index)) {
      for (const [catKey, cat] of Object.entries(state.categories)) {
        const hit = cat.items.find(i => i.slug === docKey.value)
        if (!hit) continue

        const mdPath = '/' + hit.file.replace(/^\/+/, '')
        // The DCPs also live in DOC_MAP under a shorter hand-written key,
        // where they carry a proper LGA name. Prefer that entry when the
        // file matches so a DCP reads the same however it was opened.
        const known = Object.values(DOC_MAP).find(d => d.mdPath === mdPath)

        const pdfPath = (hit as any).pdf
          ? '/' + String((hit as any).pdf).replace(/^\/+/, '')
          : undefined
        resolvedDoc.value = known
          ? { ...known, pdfPath: known.pdfPath ?? pdfPath }
          : {
              title:  hit.title,
              lga:    state.label,
              mdPath,
              kind:   catKey.toUpperCase(),
              pdfPath,
            }
        return
      }
    }
  } catch {
    // Leave resolvedDoc null — the "not found" screen below explains it.
  } finally {
    resolving.value = false
  }
}


/** Images checked into public/ — served by Nuxt at this path. */
const LOCAL_IMG_BASE = '/EPI/DCPs'
/** Fallback for DCPs whose images live only on the CDN. */
const IMG_BASE = 'https://static.heenco.com/EPI/DCPs'

async function loadDoc() {
  if (!docInfo.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = null

  try {
    // The PDF is rendered by the browser in an iframe; nothing to fetch.
    if (format.value === 'pdf') {
      renderedHtml.value = ''
      toc.value = []
      return
    }

    const path = format.value === 'html' ? htmlPath.value : mdPath.value
    const res = await fetch(path)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
    rawMd.value = await res.text()
    // Documents converted to HTML already carry their structure — real
    // tables with captions and merged cells, and an authored id on every
    // heading. Rendering them means adopting that structure, not
    // re-deriving it the way the markdown path has to.
    if (format.value === 'html') renderHtmlDoc()
    else renderMarkdown()
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

/**
 * Adopt a pre-structured HTML document.
 *
 * Everything the markdown path has to reconstruct — heading levels, anchor
 * ids, table captions and headers — is already in the file, so this only
 * has to resolve image paths, attach the citation chips, and read the table
 * of contents off the ids that are already there.
 */
function renderHtmlDoc() {
  const doc = new DOMParser().parseFromString(rawMd.value, 'text/html')
  const kind = docType.value
  const tocItems: TocItem[] = []

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (src && !src.startsWith('http') && !src.startsWith('/')) {
      img.setAttribute('src', `${LOCAL_IMG_BASE}/${src}`)
      img.setAttribute('data-fallback', `${IMG_BASE}/${src}`)
    }
    img.classList.add('dv-img')
  }

  for (const h of Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
    const level = Number(h.tagName.slice(1))
    const text = (h.textContent ?? '').trim()
    // The id lives on the enclosing section, not the heading — a citation
    // points at the clause, not at its title. Older page-container output
    // put it on the heading, so accept both.
    const owner = h.parentElement?.matches('section[id]') ? h.parentElement : null
    const id = owner?.getAttribute('id') ?? h.getAttribute('id') ?? ''
    if (!id || !text) continue
    const paged = h.closest('[data-page-start]') ?? h.closest('.dcp-page')
    const part = h.closest('.dcp-part')
    tocItems.push({
      id,
      text,
      level,
      page: Number(paged?.getAttribute('data-page-start') ?? paged?.getAttribute('data-page')) || null,
      part: part?.getAttribute('data-part') ?? paged?.getAttribute('data-src') ?? null,
    })

    h.classList.add('dv-h', `dv-h-${level}`)
    const anchor = doc.createElement('a')
    anchor.className = 'dv-h-anchor'
    anchor.setAttribute('href', `#${id}`)
    anchor.setAttribute('title', 'Link to this section')
    anchor.textContent = '#'
    h.insertBefore(anchor, h.firstChild)

    // Land Use Table rows carry ids the XML numbers per zone (sec.1..sec.4),
    // so they would format as "cl 1".."cl 4" — real clause numbers belonging to
    // other provisions. The row is a cell of a table, not a citable clause.
    if (h.closest('.lep-zone')) continue

    const cite = formatSectionId(id, kind)
    if (!cite) continue
    const page = paged?.getAttribute('data-page-start') ?? paged?.getAttribute('data-page')
    const src = part?.getAttribute('data-src') ?? paged?.getAttribute('data-src')
    const chip = doc.createElement('button')
    chip.type = 'button'
    chip.className = 'dv-cite'
    chip.dataset.id = id
    chip.dataset.cite = cite
    if (page) chip.dataset.page = page
    if (src) chip.dataset.src = src
    chip.title = 'Copy citation'
    chip.textContent = cite
    h.appendChild(chip)
  }

  renderedHtml.value = doc.body.innerHTML
  toc.value = tocItems
}

function renderMarkdown() {
  const tocItems: TocItem[] = []
  const kind = docType.value
  const resolve = createHeadingResolver(rawMd.value, kind)

  const renderer = new marked.Renderer()

  renderer.heading = function(this: any, args: any) {
    const level: number = args.depth
    // args.text is raw markdown; parse the inline tokens so emphasis and
    // links inside a heading render, then strip the id marker off the end.
    const ref = resolve(args.text, level)
    const html = String(this.parser.parseInline(args.tokens))
      .replace(HEADING_ID_SUFFIX_RE, '')
    const cite = ref.citable ? formatSectionId(ref.id, kind) : ''

    tocItems.push({ id: ref.id, text: ref.text, level, page: ref.page, part: ref.srcFile })

    // The citation chip is the reference affordance: it shows the legal
    // form of the id and copies a full citation on click (delegated below).
    const chip = cite
      ? `<button type="button" class="dv-cite" data-id="${escapeAttr(ref.id)}"`
        + ` data-cite="${escapeAttr(cite)}"`
        + (ref.page ? ` data-page="${ref.page}"` : '')
        + (ref.srcFile ? ` data-src="${escapeAttr(ref.srcFile)}"` : '')
        + ` title="Copy citation">${escapeHtml(cite)}</button>`
      : ''

    return `<h${level} id="${escapeAttr(ref.id)}" class="dv-h dv-h-${level}">`
      + `<a class="dv-h-anchor" href="#${escapeAttr(ref.id)}" title="Link to this section">#</a>`
      + `${html}${chip}</h${level}>`
  }

  // Resolve image paths to static.heenco.com
  renderer.image = function(args: any) {
    const href: string = args.href
    const text: string = args.text
    if (href.startsWith('http') || href.startsWith('/')) {
      return `<img src="${href}" alt="${escapeAttr(text)}" class="dv-img" loading="lazy" />`
    }
    // DCP images are written relative ("images/hornsby/p0001-ab12.png").
    // Prefer the copy in public/, which Nuxt serves directly, and keep the
    // CDN as a fallback for the older DCPs whose images were never checked
    // in. Doing it in this order means a document converted locally shows
    // its figures immediately, and it survives static.heenco.com being
    // unreachable — which it currently is (521 on every path).
    const local = `${LOCAL_IMG_BASE}/${href}`
    const remote = `${IMG_BASE}/${href}`
    return `<img src="${local}" data-fallback="${remote}" alt="${escapeAttr(text)}" class="dv-img" loading="lazy" />`
  }

  marked.setOptions({ gfm: true, breaks: false })
  renderedHtml.value = marked.parse(rawMd.value, { renderer }) as string
  toc.value = tocItems
}

/**
 * Delegated click handler for the citation chips, which live inside
 * v-html and so can't carry Vue listeners of their own.
 *
 * Copies a reference that identifies the clause without the reader needing
 * this app — document title, legal citation, the DCP's source PDF and page
 * where we have one, then the deep link.
 */
async function onContentClick(ev: MouseEvent) {
  const el = ev.target as HTMLElement | null

  // In-document links — the document's own contents pages, and the `#` beside
  // each heading. Anchor ids are citation ids like `dcp.1.3`, and in a CSS
  // selector a dot separates classes: `#dcp.1.3` reads as id `dcp` with
  // classes `1` and `3`, matches nothing, and the router's querySelector-based
  // hash handling falls back to scrolling to the top of the page. Resolving by
  // id sidesteps selector parsing entirely.
  const link = el?.closest?.('a[href^="#"]') as HTMLAnchorElement | null
  if (link && ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
    const id = decodeURIComponent(link.getAttribute('href')!.slice(1))
    if (id && document.getElementById(id)) {
      ev.preventDefault()
      scrollTo(id)
      return
    }
  }

  const btn = el?.closest?.('.dv-cite') as HTMLElement | null
  if (!btn) return
  ev.preventDefault()

  const id = btn.dataset.id ?? ''
  const cite = btn.dataset.cite ?? ''
  const page = btn.dataset.page
  const src = btn.dataset.src

  const url = `${location.origin}/doc-viewer?doc=${encodeURIComponent(docKey.value)}#${id}`
  // Page numbers in a merged DCP are per source part, so they only mean
  // something alongside the file they came from.
  const locus = page ? (src ? ` (${src} p ${page})` : ` (p ${page})`) : ''
  const reference = `${docInfo.value?.title ?? ''}, ${cite}${locus} — ${url}`

  try {
    await navigator.clipboard.writeText(reference)
    btn.classList.add('dv-cite--copied')
    setTimeout(() => btn.classList.remove('dv-cite--copied'), 1400)
  } catch {
    // Clipboard blocked (insecure origin, denied permission) — the anchor
    // link beside the heading still gives the reader a copyable URL.
  }
}

/**
 * Swap an image to its CDN fallback when the local copy is missing.
 * `error` does not bubble from <img>, so this listens in the capture phase.
 * Each image is retried once — `data-fallback` is cleared on use so a
 * failing CDN cannot loop.
 */
function onImageError(ev: Event) {
  const el = ev.target as HTMLImageElement | null
  if (!el || el.tagName !== 'IMG') return
  const fallback = el.dataset.fallback
  if (!fallback) return
  delete el.dataset.fallback
  el.src = fallback
}

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Preserve history.state — vue-router keeps its navigation bookkeeping
    // there, and replacing it with null makes the router warn on every jump.
    history.replaceState(history.state, '', `#${id}`)
    holdTarget(el)
  }
}

let holdTimer: ReturnType<typeof setInterval> | null = null
let releaseHold: (() => void) | null = null

/**
 * Keep the target aligned while the page settles.
 *
 * The markdown path renders images lazily with no intrinsic size, so images
 * above the target finish loading after the scroll and push it hundreds of
 * pixels down — the reader ends up short of the section they clicked. Nudge
 * it back until the position holds, and stop the moment the reader scrolls
 * themselves so this never fights them.
 */
function holdTarget(el: HTMLElement) {
  releaseHold?.()

  const wanted = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  const stop = () => {
    if (holdTimer) clearInterval(holdTimer)
    holdTimer = null
    releaseHold = null
    for (const evt of ['wheel', 'touchstart', 'keydown'] as const) {
      window.removeEventListener(evt, stop)
    }
  }
  releaseHold = stop
  for (const evt of ['wheel', 'touchstart', 'keydown'] as const) {
    window.addEventListener(evt, stop, { passive: true, once: true })
  }

  // Let the smooth scroll finish first, then correct for ~3s of image loading.
  setTimeout(() => {
    if (releaseHold !== stop) return
    let checks = 0
    holdTimer = setInterval(() => {
      const drift = el.getBoundingClientRect().top - wanted
      if (Math.abs(drift) > 8) window.scrollBy({ top: drift, behavior: 'auto' })
      if (++checks >= 12) stop()
    }, 250)
  }, 800)
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

/** Publish the sticky header's height as --dv-chrome, so heading
 *  scroll-margin always clears it — including when it wraps to two lines. */
const headerEl = ref<HTMLElement | null>(null)
let headerObserver: ResizeObserver | null = null

function trackHeaderHeight() {
  const el = headerEl.value
  if (!el) return
  const apply = () => {
    const h = Math.round(el.getBoundingClientRect().height)
    if (h) document.documentElement.style.setProperty('--dv-chrome', `${h}px`)
  }
  apply()
  if (typeof ResizeObserver !== 'undefined') {
    headerObserver = new ResizeObserver(apply)
    headerObserver.observe(el)
  }
}

onMounted(async () => {
  document.addEventListener('error', onImageError, true)
  await resolveFromIndex()
  await probeFormats()
  await loadDoc()
  await nextTick()
  trackHeaderHeight()
  setTimeout(scrollToAnchor, 100)
})

// Switching tab reloads the body; the PDF pane needs no fetch.
watch(format, async () => {
  await loadDoc()
  await nextTick()
  setTimeout(scrollToAnchor, 100)
})

onBeforeUnmount(() => {
  document.removeEventListener('error', onImageError, true)
  headerObserver?.disconnect()
  releaseHold?.()
})

watch(() => route.fullPath, async () => {
  await resolveFromIndex()
  await probeFormats()
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

.dv-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dv-tabs {
  display: inline-flex;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}

.dv-tab {
  padding: 6px 12px;
  background: none;
  border: none;
  border-right: 1px solid #e2e8f0;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}
.dv-tab:last-child { border-right: none; }
.dv-tab:hover { background: #f8fafc; color: #0f172a; }
.dv-tab--on {
  background: #0f172a;
  color: #fff;
}
.dv-tab--on:hover { background: #0f172a; color: #fff; }

.dv-pdf-wrap {
  height: calc(100vh - 76px);
  background: #f1f5f9;
}
.dv-pdf {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
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
.dv-toc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.dv-toc-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #94a3b8;
}
.dv-toc-actions { display: flex; gap: 6px; }
.dv-toc-act {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 10px;
  color: #64748b;
  cursor: pointer;
  text-decoration: underline;
}
.dv-toc-act:hover { color: #0f172a; }

/* ── Parts ──────────────────────────────────────────────────────────── */
.dv-part { margin-bottom: 2px; }

.dv-part-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 6px;
  background: none;
  border: none;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
  text-align: left;
  cursor: pointer;
}
.dv-part-btn:hover { background: #f1f5f9; }
.dv-part-btn--on { background: #0f172a; color: #fff; }
.dv-part-btn--on:hover { background: #0f172a; }
.dv-part-caret { width: 10px; flex-shrink: 0; font-size: 9px; opacity: 0.7; }
.dv-part-label { flex: 1; }

/* ── Rows ───────────────────────────────────────────────────────────── */
.dv-toc-list { list-style: none; margin: 0 0 6px; padding: 0; }

.dv-toc-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 12px;
  line-height: 1.45;
}

.dv-toc-caret {
  flex-shrink: 0;
  width: 12px;
  padding: 0;
  background: none;
  border: none;
  font: inherit;
  font-size: 9px;
  color: #94a3b8;
  cursor: pointer;
}
.dv-toc-caret:hover { color: #0f172a; }
.dv-toc-caret--leaf { cursor: default; }

.dv-toc-link {
  flex: 1;
  min-width: 0;
  color: #475569;
  text-decoration: none;
  padding: 2px 4px;
  border-radius: 3px;
}
.dv-toc-link:hover { background: #f1f5f9; color: #0f172a; }
.dv-toc-link--l1,
.dv-toc-link--l2 { font-weight: 600; color: #0f172a; }
.dv-toc-link--l5,
.dv-toc-link--l6 { font-size: 11px; color: #94a3b8; }

/* Page number, right-aligned like a printed contents page. */
.dv-toc-page {
  flex-shrink: 0;
  font-size: 10px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  padding-left: 4px;
}

.dv-content {
  padding: 32px 48px;
  max-width: 900px;
}

.dv-body {
  line-height: 1.7;
  color: #1e293b;
}

/* The header is sticky, so anything scrolled to the top of the viewport sits
 * behind it and the reader lands ~a header's worth into the section, past the
 * title it clicked. This has to cover every scroll target, not just headings:
 * in the structured HTML the anchor id is on the enclosing <section>, while
 * the markdown path puts it on the heading itself. --dv-chrome is measured
 * from the header at runtime, so a wrapped header still clears. */
.dv-body :deep([id]),
.dv-body :deep(h1),
.dv-body :deep(h2),
.dv-body :deep(h3),
.dv-body :deep(h4),
.dv-body :deep(h5),
.dv-body :deep(h6) {
  scroll-margin-top: calc(var(--dv-chrome, 124px) + 16px);
}

.dv-body :deep(h1),
.dv-body :deep(h2),
.dv-body :deep(h3),
.dv-body :deep(h4) {
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

/* Citation chip — the legal form of the section id, click to copy. */
.dv-body :deep(.dv-cite) {
  margin-left: 10px;
  padding: 2px 7px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #f8fafc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  color: #64748b;
  text-transform: none;
  letter-spacing: 0;
  vertical-align: middle;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, border-color 0.15s, color 0.15s;
}
.dv-body :deep(h1:hover .dv-cite),
.dv-body :deep(h2:hover .dv-cite),
.dv-body :deep(h3:hover .dv-cite),
.dv-body :deep(h4:hover .dv-cite),
.dv-body :deep(.dv-cite:focus-visible) {
  opacity: 1;
}
.dv-body :deep(.dv-cite:hover) {
  border-color: #15803d;
  color: #15803d;
}
.dv-body :deep(.dv-cite--copied) {
  opacity: 1;
  border-color: #15803d;
  background: #dcfce7;
  color: #15803d;
}
.dv-body :deep(.dv-cite--copied)::after {
  content: " copied";
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

/* ── Structured HTML documents ──────────────────────────────────────── */

/* The caption carries the table number the surrounding prose cites
   ("comply with Table 3.1.2-a"), so keep it attached and legible. */
.dv-body :deep(caption) {
  caption-side: top;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  padding: 0 0 6px;
}

/* A control table can be far wider than the column; let it scroll rather
   than forcing the page to. */
.dv-body :deep(table) { display: block; overflow-x: auto; max-width: 100%; }

/* Diagrams are page-width artwork, so centre them rather than leaving them
   ragged against the text column. */
.dv-body :deep(figure) {
  margin: 1.4em auto;
  text-align: center;
}
/* Outranks the generic .dv-img rule below, which sets `margin: 1em 0`
   and would otherwise pin figures to the left edge. */
.dv-body :deep(figure img),
.dv-body :deep(figure .dv-img) {
  display: block;
  margin: 0 auto;
  max-width: 100%;
  height: auto;
}
.dv-body :deep(figcaption) {
  font-size: 12px;
  color: #64748b;
  margin-top: 0.4em;
}

/* ── Generated contents page ────────────────────────────────────────── */
.dv-body :deep(.dcp-contents) { margin: 1em 0 2em; }
.dv-body :deep(.dcp-contents ul) {
  list-style: none;
  margin: 0;
  padding: 0;
}
.dv-body :deep(.dcp-contents-row) {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  font-size: 13px;
  line-height: 1.5;
}
.dv-body :deep(.dcp-contents-row a) {
  color: #1e293b;
  text-decoration: none;
  flex: 1;
  min-width: 0;
}
.dv-body :deep(.dcp-contents-row a:hover) { color: #15803d; text-decoration: underline; }
/* Dotted leader, the way a printed contents page reads. */
.dv-body :deep(.dcp-contents-page) {
  flex-shrink: 0;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.dv-body :deep(.dcp-contents-row--part) {
  margin-top: 14px;
  font-weight: 700;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 4px;
}
.dv-body :deep(.dcp-contents-part) { flex: 1; color: #0f172a; }
.dv-body :deep(.dcp-contents-row--d1) { padding-left: 16px; }
.dv-body :deep(.dcp-contents-row--d2) { padding-left: 32px; }
.dv-body :deep(.dcp-contents-row--d3) { padding-left: 48px; font-size: 12px; }
.dv-body :deep(.dcp-contents-row--d4),
.dv-body :deep(.dcp-contents-row--d5) { padding-left: 64px; font-size: 12px; color: #64748b; }

/* Page boundaries are structural but not something to draw attention to. */
.dv-body :deep(.dcp-page) { margin: 0; }

/* ── Structured LEP / SEPP (scripts/xml-to-html.mjs) ─────────────────────── */

.dv-body :deep(.lep-txt) { margin: 0.55em 0; }

/* Hanging indent: the provision number sits in its own column, the way the
   legislation prints it, instead of running into the prose. */
.dv-body :deep(.lep-sub),
.dv-body :deep(.lep-li) {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr);
  align-items: start;
  margin: 0.5em 0;
}
.dv-body :deep(.lep-li) { grid-template-columns: 2.1rem minmax(0, 1fr); }

.dv-body :deep(.lep-sub > .lep-no),
.dv-body :deep(.lep-li > .lep-no) {
  color: #64748b;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  padding-top: 0.55em;
}
.dv-body :deep(.lep-no--link:hover) { color: #15803d; text-decoration: underline; }

.dv-body :deep(.lep-sub-body > *:first-child),
.dv-body :deep(.lep-li-body > *:first-child) { margin-top: 0; }
.dv-body :deep(.lep-sub-body > *:last-child),
.dv-body :deep(.lep-li-body > *:last-child) { margin-bottom: 0; }

/* The source supplies its own (a)/(i)/• markers — the browser must not add more. */
.dv-body :deep(.lep-list) { list-style: none; padding-left: 0; margin: 0.5em 0; }

/* Notes are guidance and do not form part of the plan (cl 1.5) — look like it. */
.dv-body :deep(.lep-note) {
  margin: 0.8em 0;
  padding: 0.5rem 0.8rem;
  border-left: 3px solid #cbd5e1;
  background: #f8fafc;
  color: #475569;
  font-size: 0.94em;
}
.dv-body :deep(.lep-note-label) {
  display: block;
  font-size: 0.75em; font-weight: 700; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.05em;
  margin-bottom: 0.15rem;
}
.dv-body :deep(.lep-note p) { margin: 0.35em 0; }

/* Land Use and acquisition tables scroll rather than squash the page. */
.dv-body :deep(.lep-table-wrap) { overflow-x: auto; margin: 0.9em 0; }

.dv-body :deep(.lep-defterm) { font-style: normal; font-weight: 700; color: #0f172a; }
.dv-body :deep(.lep-deflist) { margin: 0.4em 0; }
.dv-body :deep(.lep-repealed) { color: #94a3b8; font-style: italic; }

/* Clause number prefix inside a heading — present but not competing with the title. */
.dv-body :deep(h1 > .lep-no),
.dv-body :deep(h2 > .lep-no),
.dv-body :deep(h3 > .lep-no),
.dv-body :deep(h4 > .lep-no),
.dv-body :deep(h5 > .lep-no),
.dv-body :deep(h6 > .lep-no) { color: #64748b; margin-right: 0.15em; }

/* A zone is the landmark readers scan the Land Use Table for. */
.dv-body :deep(.lep-zone > h2) {
  color: #15803d;
  border-bottom: 2px solid #bbf7d0;
  padding-bottom: 4px;
}
.dv-body :deep(.dcp-caption) {
  font-size: 12px;
  color: #64748b;
  font-style: italic;
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
