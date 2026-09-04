/**
 * DCP PDF → structured Markdown (unified converter).
 *
 * Supersedes scripts/dcp-pdf-to-md.mjs. It combines the three sources of
 * structure a council DCP actually offers, because measurement showed no
 * single one is sufficient:
 *
 *   Docling      layout-aware body text and, critically, TABLES. The
 *                planning controls (setbacks, heights, FSR, parking rates)
 *                live in tables; a converter that flattens them produces
 *                confidently wrong answers. Docling is also the only source
 *                that gives per-item page provenance for body content.
 *
 *   PDF outline  the bookmark tree, which gives a real heading hierarchy.
 *   / tag tree   Docling collapses headings to a single level, so every
 *                existing DCP conversion is 100% `##` with no parent/child
 *                structure at all. The outline fixes that.
 *
 *   pdfjs        embedded raster images, deduplicated by content hash.
 *
 * Two failures in the previous pipelines this is built to avoid:
 *   1. `export_to_markdown()` discards page provenance, so albury-dcp-2010
 *      carries one `PAGE: 1` marker for 646 pages and every citation in it
 *      deep-links to the wrong page. Here every page emits its own marker.
 *   2. Using pdfjs alone (the mistake in dcp-pdf-to-md.mjs) yields zero
 *      tables.
 *
 * Usage:
 *   node scripts/dcp-convert.mjs --in <pdf> --out <md> --images <dir>
 *
 * Flags:
 *   --in <pdf>            source PDF (required)
 *   --out <md>            destination markdown (required)
 *   --images <dir>        subfolder under public/EPI/DCPs/images/
 *   --anchor-prefix <c>   namespace anchors for one part of a multi-part DCP
 *                         (--anchor-prefix C1 makes clause 2.1 `dcp.C1.2.1`).
 *                         Required when parts restart clause numbering.
 *   --part-label <s>      the council's own part wording, e.g.
 *                         "C1 Low density residential"
 *   --docling-json <p>    reuse a previous extraction instead of re-running
 *   --no-docling          skip Docling (outline-only; no tables)
 *   --no-images           skip image extraction
 *   --pages a-b           convert only this page range (trial runs)
 *   --python <path>       python executable (default .venv/Scripts/python.exe)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { getDocumentProxy, extractText, extractImages, definePDFJSModule } from 'unpdf'

import { rawImageToPngBuffer } from './lib/pdf-image-utils.mjs'
import { createHtmlBuilder, rubricOf } from './lib/dcp-html.mjs'
import { prettyPart, partNumberOf, partNumberingOf } from '../shared/dcp-part-label.mjs'

const DCP_DIR = join('public', 'EPI', 'DCPs')
const IMAGES_ROOT = join(DCP_DIR, 'images')
const MIN_IMAGE_DIMENSION = 32

// ── args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const inPath = val('--in', '')
const outPath = val('--out', '')
// Strip either extension: defaulting off an .html output used to yield an
// image directory literally named "<slug>.html", so the .md and .html runs
// of the same document disagreed about where the figures live.
const imageDir = val('--images', basename(outPath || 'dcp').replace(/\.(md|html?)$/i, ''))
const pages = val('--pages', '')
// Namespace anchors for a part of a multi-part DCP: --anchor-prefix C1 makes
// clause 2.1 `dcp.C1.2.1`. Required whenever parts restart their clause
// numbering, which is the norm outside merged "book version" PDFs — without
// it every part owns `dcp.2.1` and the winner depends on conversion order.
const anchorPrefix = val('--anchor-prefix', '').trim()
// Override the label derived from the source filename, so a part carries the
// council's own wording ("C1 Low density residential") rather than a slug.
const partLabelArg = val('--part-label', '').trim()
const pythonExe = val('--python', join('.venv', 'Scripts', 'python.exe'))
const doclingJsonArg = val('--docling-json', '')
const noDocling = argv.includes('--no-docling')
const noImages = argv.includes('--no-images')

if (!inPath || !outPath) {
  process.stderr.write('Usage: node scripts/dcp-convert.mjs --in <pdf> --out <md> --images <dir>\n')
  process.exit(1)
}
if (!existsSync(inPath)) {
  process.stderr.write(`No such PDF: ${inPath}\n`)
  process.exit(1)
}

const say = (s) => process.stdout.write(s)
const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** Emit HTML when the output file asks for it. */
const asHtml = /\.html?$/i.test(outPath)

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

// ── anchor ids ──────────────────────────────────────────────────────────
//
// Authored into the HTML once, rather than re-derived from heading text at
// render time — the text can be reworded, and a citation must not break
// when it is.
//
// A numbered clause owns its number ("3.1.2" → dcp.3.1.2). An unnumbered
// rubric heading inherits the clause it sits under ("Desired Outcome" under
// 3.1.2 → dcp.3.1.2.desired_outcome), which is what makes the ~800 rubric
// headings unique and citable instead of colliding on a bare slug.

const seenIds = new Map()
let currentClause = null

function slugify(s) {
  return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

/** A part boundary ends the clause context. Without this the first heading
 *  of Part 4 inherits Part 3's last clause and is issued an id like
 *  `dcp.3.5.15.hornsby_development_control_plan_2024`. */
function resetClauseContext() {
  currentClause = null
}

/** `dcp.` or, for one part of a multi-part DCP, `dcp.C1.` */
const ANCHOR_ROOT = anchorPrefix ? `dcp.${anchorPrefix}` : 'dcp'

function anchorId(title) {
  const num = norm(title).match(/^(\d+(?:\.\d+)*)[\s.]/)
  let base
  if (num) {
    currentClause = num[1]
    base = `${ANCHOR_ROOT}.${num[1]}`
  } else {
    const slug = slugify(title) || 'section'
    base = currentClause ? `${ANCHOR_ROOT}.${currentClause}.${slug}` : `${ANCHOR_ROOT}.${slug}`
  }
  const n = (seenIds.get(base) ?? 0) + 1
  seenIds.set(base, n)
  return n > 1 ? `${base}_${n}` : base
}

// ── step 1: Docling extraction ──────────────────────────────────────────

function runDocling() {
  if (noDocling) return null
  const jsonPath = doclingJsonArg || join(
    process.env.TEMP || '.', `docling-${basename(inPath).replace(/\W+/g, '_')}.json`,
  )
  if (doclingJsonArg && existsSync(doclingJsonArg)) {
    say(`Reusing Docling extraction: ${doclingJsonArg}\n`)
    return JSON.parse(readFileSync(doclingJsonArg, 'utf8'))
  }
  if (!existsSync(pythonExe)) {
    process.stderr.write(
      `Docling python not found at ${pythonExe}.\n` +
      `Create it with:  python -m venv .venv && .venv/Scripts/pip install docling\n` +
      `Or pass --no-docling to convert without tables.\n`,
    )
    process.exit(1)
  }

  const args = ['scripts/docling-extract.py', '--in', inPath, '--out', jsonPath]
  if (pages) args.push('--pages', pages)
  say(`Running Docling (this is the slow step — roughly 1-8 s/page on CPU)…\n`)
  const r = spawnSync(pythonExe, args, { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) {
    process.stderr.write(`Docling extraction failed (exit ${r.status}).\n`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(jsonPath, 'utf8'))
}

// ── step 2: outline (heading hierarchy) ─────────────────────────────────

async function resolvePage(pdf, item) {
  try {
    let dest = item.dest
    if (typeof dest === 'string') dest = await pdf.getDestination(dest)
    if (!Array.isArray(dest)) return null
    const ref = dest[0]
    if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref)) + 1
    if (typeof ref === 'number') return ref + 1
  } catch { /* unresolvable destination */ }
  return null
}

async function readOutline(pdf) {
  const root = await pdf.getOutline().catch(() => null)
  const flat = []
  const walk = async (items, depth) => {
    for (const it of items) {
      flat.push({ depth, title: norm(it.title ?? ''), page: await resolvePage(pdf, it) })
      if (it.items?.length) await walk(it.items, depth + 1)
    }
  }
  await walk(root ?? [], 1)
  return flat.filter((n) => n.title && n.page)
}

/** The label this run gives its part: the council's wording when supplied,
 *  otherwise derived from the source filename. */
const labelFor = (src) => partLabelArg || prettyPart(src)

const RUBRIC_RE = /^(Desired Outcomes?|Prescriptive Measures?|Objectives?|Controls?|Notes?|Figures?|Legend|Explanation|Background|Requirements?)$/i

/**
 * Heading level for a piece of text on a page, or null when the text is not
 * plausibly a heading at all.
 *
 * The outline is authoritative where it covers the page. Otherwise we accept
 * rubric words and part-constrained clause numbers, and reject everything
 * that reads like prose — Docling labels a quarter of its `section_header`
 * items with whole sentences ("Setbacks that are compatible with adjacent
 * development…"), and promoting those wrecks the hierarchy that the anchors
 * depend on.
 */
/** Level of the most recent numbered clause, so unnumbered headings can
 *  nest beneath it instead of becoming its sibling. Without this the
 *  contents tree flattens: rubric blocks and sub-headings ("Desired
 *  Outcome", "Main roads") end up ranked alongside 4.1 and 4.2. */
let lastClauseLevel = 1

function levelFor(text, page, outlineByPage, partNum, doclingLevel) {
  const flat = norm(text)

  // 1. The document's own outline wins outright.
  const candidates = outlineByPage.get(page) ?? []
  const hit = candidates.find((h) => h.title === flat)
    ?? candidates.find((h) => {
      const num = flat.match(/^(\d+(?:\.\d+)*)\s/)
      return num && h.title.startsWith(num[1] + ' ')
    })
  if (hit) {
    const level = Math.min(Math.max(hit.depth - 1, 1), 6)
    if (/^\d+(?:\.\d+)*[\s.]/.test(hit.title)) lastClauseLevel = level
    return { level, title: hit.title }
  }

  // 2. Rubric blocks that structure every DCP clause — always children of
  //    the clause they qualify.
  if (RUBRIC_RE.test(flat)) {
    return { level: Math.min(lastClauseLevel + 1, 6), title: flat }
  }

  // 3. A numbered clause belonging to the part we are inside.
  //
  //    `partNum` is non-null only under the numeric regime (Hornsby's
  //    "Part 4", whose clauses are "4.x"), where a heading claiming to be
  //    "3.1" inside Part 4 is a misdetection. Under the coded regime
  //    (Randwick's "C1", whose clauses restart at 1 in every part) there is
  //    no prefix to check and null is the correct answer — the remaining
  //    shape guards below still do the filtering. See
  //    shared/dcp-part-label.mjs.
  //    The number may carry a trailing dot and may be a bare integer:
  //    Randwick writes "1. Introduction" and "1.1. Objectives", Hornsby
  //    writes "4.2.1 Scale". Requiring whitespace straight after the digits,
  //    and at least one `.n` group, silently rejected both Randwick forms —
  //    so in the two parts whose PDFs carry no outline at all every heading
  //    fell through to the unnumbered branch below and came out at one
  //    level. D11 was 204 headings across 97 pages with no hierarchy.
  //    `anchorId()` already accepted the trailing dot, which is why
  //    `data-number` was extracted correctly while the level was not.
  const m = flat.match(/^(\d+(?:\.\d+){0,3})\.?\s+(\S.*)$/)
  if (m) {
    const [, number, rest] = m
    const ok = (partNum === null || number.startsWith(`${partNum}.`))
      && rest.length <= 80
      && !/[,;:]$/.test(rest)
      && !/\b(and|or|the|to|of|in|for|with)$/i.test(rest)
      && /^[A-Z(]/.test(rest)
      && !/\s\d+[-–]\d+$/.test(rest)
    if (ok) {
      const level = Math.min(number.split('.').length, 6)
      lastClauseLevel = level
      return { level, title: flat }
    }
  }

  // 4. Otherwise trust Docling only if the text looks like a heading:
  //    short, not a sentence, not trailing punctuation.
  const headingish = flat.length <= 80
    && !/[.;,]$/.test(flat)
    && /^[A-Z0-9(]/.test(flat)
    && flat.split(/\s+/).length <= 12
  if (!headingish) return null

  // Unnumbered, so it qualifies the clause in force rather than ranking
  // beside it. Docling's own level is unreliable here — it is what makes
  // "Main roads" a sibling of "4.2 Business Lands".
  return { level: Math.min(lastClauseLevel + 1, 6), title: flat }
}

// ── step 3: images ──────────────────────────────────────────────────────

async function extractAllImages(pdf, total, stats) {
  const byPage = new Map()
  if (noImages) return byPage
  const cache = new Map()
  for (let p = 1; p <= total; p++) {
    let raw = []
    try { raw = await extractImages(pdf, p) } catch { continue }
    const list = []
    for (const img of raw) {
      const width = Number(img.width)
      const height = Number(img.height)
      if (!Number.isFinite(width) || !Number.isFinite(height)) continue
      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) { stats.tiny++; continue }
      const bytes = img.data instanceof Uint8Array
        ? img.data
        : new Uint8Array(img.data.buffer ?? img.data, img.data.byteOffset ?? 0, img.data.byteLength ?? img.data.length)
      const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 12)
      const hit = cache.get(hash)
      if (hit) { list.push(hit); stats.deduped++; continue }
      const png = rawImageToPngBuffer({ data: img.data, width, height, channels: img.channels })
      if (!png) { stats.failed++; continue }
      const relPath = `images/${imageDir}/p${String(p).padStart(4, '0')}-${hash}.png`
      mkdirSync(join(IMAGES_ROOT, imageDir), { recursive: true })
      writeFileSync(join(DCP_DIR, relPath), png)
      stats.written++
      stats.bytes += png.length
      const rec = { relPath, width, height }
      cache.set(hash, rec)
      list.push(rec)
    }
    if (list.length) byPage.set(p, list)
  }
  return byPage
}

// ── main ────────────────────────────────────────────────────────────────

const docling = runDocling()

await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
const pdf = await getDocumentProxy(new Uint8Array(readFileSync(inPath)))

const outline = await readOutline(pdf)
const outlineByPage = new Map()
for (const n of outline) {
  if (n.depth < 2) continue
  if (!outlineByPage.has(n.page)) outlineByPage.set(n.page, [])
  outlineByPage.get(n.page).push(n)
}

// Depth-1 outline nodes are the constituent part PDFs of a merged "book
// version"; they give each page an accurate source label.
//
// That inference only holds for a merged document. When this run *is* one
// part of a multi-part DCP, the depth-1 nodes are that part's own top-level
// sections ("1. Introduction"), and treating them as source parts both
// mislabels `data-src` and splits the part into several `dcp-part`
// containers. Naming the part explicitly says the PDF is already one part.
const singlePart = !!(partLabelArg || anchorPrefix)
const parts = singlePart ? [] : outline
  .filter((n) => n.depth === 1)
  .sort((a, b) => a.page - b.page)
  .map((n) => ({
    page: n.page,
    label: `${n.title.replace(/^D\d+\s*/i, '').replace(/\s*[-–]\s*CURRENT.*$/i, '').replace(/\(\d+\)\s*$/, '').trim()}.pdf`,
  }))
const srcFor = (page) => {
  let label = parts.length ? parts[0].label : basename(inPath)
  for (const p of parts) { if (p.page <= page) label = p.label; else break }
  return label
}

const total = pdf.numPages
const imgStats = { written: 0, deduped: 0, tiny: 0, failed: 0, bytes: 0 }
const imagesByPage = await extractAllImages(pdf, total, imgStats)

// Fall back to raw page text when Docling was skipped.
let pageTexts = null
if (!docling) {
  ;({ text: pageTexts } = await extractText(pdf, { mergePages: false }))
}

const out = []
const stats = { headings: 0, tables: 0, images: 0, pagesEmitted: 0, demoted: 0, listItems: 0, captions: 0, tocSkipped: 0, mergedTables: 0, tablesFromPipes: 0, contentsSkipped: 0, captionsDeduped: 0, contentsGenerated: 0 }
let curPage = null
const imgIdx = new Map()

/** Emit any images on `page` that Docling never referenced, so every image
 *  still appears under its own page rather than in a trailing block. */
function flushImagesFor(page) {
  const list = imagesByPage.get(page)
  if (!list) return
  let i = imgIdx.get(page) ?? 0
  if (i >= list.length) return
  for (; i < list.length; i++) emitImage(page, i, list[i])
  imgIdx.set(page, i)
  if (!asHtml) out.push('')
}

function openPage(page) {
  if (page === curPage) return
  // Leaving a page: anything Docling did not place still belongs here.
  if (curPage !== null) {
    flushImagesFor(curPage)
    if (asHtml) out.push('</section>')
  }
  curPage = page
  stats.pagesEmitted++
  if (asHtml) {
    // The page is a real element rather than a comment, so provenance
    // survives any downstream transform and is queryable from the DOM.
    out.push('')
    out.push(`<section class="dcp-page" data-page="${page}" data-src="${escAttr(srcFor(page))}">`)
  } else {
    out.push('')
    out.push(`<!-- SRC: ${srcFor(page)} | PAGE: ${page} -->`)
    out.push('')
  }
}

// ── emitters ────────────────────────────────────────────────────────────

let listOpen = false
function openList() {
  if (!asHtml || listOpen) return
  out.push('<ul>')
  listOpen = true
}
function closeList() {
  if (!asHtml || !listOpen) return
  out.push('</ul>')
  listOpen = false
}

function emitHeading(level, title) {
  stats.headings++
  if (asHtml) {
    const id = anchorId(title)
    out.push(`<h${level} id="${escAttr(id)}">${esc(title)}</h${level}>`)
  } else {
    out.push('')
    out.push(`${'#'.repeat(level)} ${title}`)
    out.push('')
  }
}

function emitParagraph(text) {
  if (asHtml) out.push(`<p>${esc(norm(text))}</p>`)
  else { out.push(norm(text)); out.push('') }
}

function emitListItem(text) {
  stats.listItems++
  if (asHtml) out.push(`<li>${esc(norm(text))}</li>`)
  else out.push(`- ${norm(text)}`)
}

function emitCaption(text) {
  stats.captions++
  if (asHtml) out.push(`<p class="dcp-caption">${esc(norm(text))}</p>`)
  else { out.push(''); out.push(`*${norm(text)}*`); out.push('') }
}

/** Convert a markdown pipe table to HTML. Used only when Docling could not
 *  give us HTML for a table — spans and captions are unavailable in the
 *  pipe form, but a real <table> still beats dumping the pipes verbatim. */
function pipeTableToHtml(md) {
  const rows = md.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  if (!rows.length) return null
  const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const isSep = (line) => /^\|[\s:|-]*-[\s:|-]*\|$/.test(line)

  const body = []
  let head = null
  for (const [i, line] of rows.entries()) {
    if (isSep(line)) { if (i === 1) head = cells(rows[0]); continue }
    if (head === null && i === 0 && rows[1] && isSep(rows[1])) continue
    body.push(cells(line))
  }
  const th = head ? `<thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : ''
  const tb = `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${th}${tb}</table>`
}

function emitTable(item) {
  stats.tables++
  if (item.merged) stats.mergedTables++
  if (!asHtml) {
    out.push(item.md ?? '')
    out.push('')
    return
  }
  if (item.html) {
    // Docling's own HTML, which carries <caption>, <th> and colspan/rowspan.
    // Markdown flattens the caption into a detached paragraph and duplicates
    // merged values across columns.
    out.push(item.html.trim())
    return
  }
  const fallback = item.md ? pipeTableToHtml(item.md) : null
  if (fallback) {
    stats.tablesFromPipes++
    out.push(fallback)
  } else {
    out.push(`<pre class="dcp-table-fallback">${esc(item.md ?? '')}</pre>`)
  }
}

function emitImage(page, i, img) {
  stats.images++
  if (asHtml) {
    out.push(
      `<figure><img src="${escAttr(img.relPath)}" alt="page ${page} img ${i + 1}"`
      + ` width="${img.width}" height="${img.height}" loading="lazy"></figure>`,
    )
  } else {
    out.push(`![page ${page} img ${i + 1} (${img.width}x${img.height})](${img.relPath})`)
  }
}

function emitImagesFor(page) {
  const list = imagesByPage.get(page)
  if (!list) return
  const i = imgIdx.get(page) ?? 0
  if (i >= list.length) return
  imgIdx.set(page, i + 1)
  emitImage(page, i, list[i])
  if (!asHtml) out.push('')
}

if (asHtml && docling) {
  // ── Clause-structured HTML ────────────────────────────────────────────
  // The clause is the container and the page an attribute, so a clause that
  // spans pages stays one addressable subtree.
  const builder = createHtmlBuilder({
    docSource: basename(inPath),
    totalPages: total,
    generated: new Date().toISOString().slice(0, 10),
  })

  // A page Docling typed as a contents listing is navigation, not content.
  // Its entries also arrive as loose text — 113 fragments on page 3 alone —
  // which is what turns the contents into a column of orphaned numbers.
  // Drop the text on those pages; the generated contents replaces it.
  const contentsPages = new Set(
    docling.items.filter((i) => i.label === 'document_index' && i.page).map((i) => i.page),
  )

  /** Caption text already carried inside a table's own <caption>. */
  const captionOf = (html) => {
    const m = html?.match(/<caption>([\s\S]*?)<\/caption>/)
    return m ? norm(m[1].replace(/<[^>]*>/g, '')) : ''
  }
  let lastTableCaption = ''

  let lastPage = 1
  let lastSrc = null
  let listBuf = []

  const flushList = () => {
    if (!listBuf.length) return
    builder.push(`<ul>${listBuf.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)
    stats.listItems += listBuf.length
    listBuf = []
  }
  const flushImages = (page) => {
    const list = imagesByPage.get(page)
    if (!list) return
    let i = imgIdx.get(page) ?? 0
    for (; i < list.length; i++) {
      const img = list[i]
      stats.images++
      builder.push(
        `<figure><img src="${escAttr(img.relPath)}" alt="page ${page} img ${i + 1}"`
        + ` width="${img.width}" height="${img.height}" loading="lazy"></figure>`,
      )
    }
    imgIdx.set(page, i)
  }

  for (const item of docling.items) {
    const page = item.page ?? lastPage
    lastPage = page
    const src = srcFor(page)

    if (item.label !== 'list_item') flushList()

    // A new source part closes everything and starts a fresh container.
    if (src !== lastSrc) {
      flushList()
      builder.closeAll()
      builder.page(page, src)
      builder.section({
        level: 0,
        cls: 'dcp-part',
        part: labelFor(src),
        src,
      })
      lastSrc = src
      resetClauseContext()
      lastClauseLevel = 1
      stats.pagesEmitted++
    }
    builder.page(page, src)

    if (item.label === 'document_index') {
      stats.tocSkipped++
    } else if (contentsPages.has(page) && (item.label === 'text' || item.label === 'list_item')) {
      // Loose fragments of the document's own contents listing. Restricted
      // to text: a contents page can also carry a real table (page 61 has
      // both), and dropping that would lose content.
      stats.contentsSkipped++
    } else if (item.label === 'table' && (item.html || item.md)) {
      stats.tables++
      if (item.merged) stats.mergedTables++
      const html = item.html?.trim() || pipeTableToHtml(item.md)
      lastTableCaption = captionOf(html)
      if (html) builder.push(html)
      else builder.push(`<pre class="dcp-table-fallback">${esc(item.md ?? '')}</pre>`)
    } else if (item.label === 'picture') {
      const list = imagesByPage.get(page)
      const i = imgIdx.get(page) ?? 0
      if (list && i < list.length) {
        imgIdx.set(page, i + 1)
        stats.images++
        builder.push(
          `<figure><img src="${escAttr(list[i].relPath)}" alt="page ${page} img ${i + 1}"`
          + ` width="${list[i].width}" height="${list[i].height}" loading="lazy"></figure>`,
        )
      }
    } else if (item.label === 'section_header' && item.text) {
      const h = levelFor(item.text, page, outlineByPage, partNumberOf(src), item.level)
      if (h) {
        stats.headings++
        const number = norm(h.title).match(/^(\d+(?:\.\d+)*)[\s.]/)?.[1] ?? null
        builder.section({
          level: h.level,
          id: anchorId(h.title),
          title: h.title,
          number,
          rubric: number ? null : rubricOf(h.title),
        })
        // The document's own contents page: its entries were dropped as
        // unusable fragments, so regenerate the listing from the clause
        // tree instead of leaving the section empty.
        if (contentsPages.has(page) && /^contents$/i.test(norm(h.title))) {
          builder.markContents()
          stats.contentsGenerated++
        }
      } else {
        stats.demoted++
        builder.push(`<p>${esc(norm(item.text))}</p>`)
      }
    } else if (item.label === 'list_item' && item.text) {
      listBuf.push(norm(item.text))
    } else if (item.label === 'caption' && item.text) {
      // Docling emits a captioned table's title twice — once inside the
      // table's <caption> and again as a standalone caption item. Keep the
      // one bound to the table.
      if (norm(item.text) === lastTableCaption) {
        stats.captionsDeduped++
      } else {
        stats.captions++
        builder.push(`<p class="dcp-caption">${esc(norm(item.text))}</p>`)
      }
    } else if (item.text) {
      builder.push(`<p>${esc(norm(item.text))}</p>`)
    }
  }
  flushList()
  // Pages Docling produced no items for still carry their figures.
  for (const page of [...imagesByPage.keys()].sort((a, b) => a - b)) {
    const list = imagesByPage.get(page)
    if ((imgIdx.get(page) ?? 0) >= list.length) continue
    builder.page(page, srcFor(page))
    flushImages(page)
  }
  out.push(builder.serialise())
} else if (docling) {
  let lastPage = 1
  for (const item of docling.items) {
    const page = item.page ?? lastPage
    lastPage = page
    openPage(page)

    // In HTML a run of list items has to sit inside one <ul>; close it as
    // soon as the run ends.
    if (item.label !== 'list_item') closeList()

    if (item.label === 'document_index') {
      // Docling types a part's contents page as a table. It is navigation,
      // not content: emitting it duplicates every heading in the part and
      // pollutes the anchors. Drop it deliberately.
      stats.tocSkipped++
    } else if (item.label === 'table' && (item.html || item.md)) {
      emitTable(item)
    } else if (item.label === 'picture') {
      emitImagesFor(page)
    } else if (item.label === 'section_header' && item.text) {
      const partNum = partNumberOf(srcFor(page))
      const h = levelFor(item.text, page, outlineByPage, partNum, item.level)
      if (h) {
        emitHeading(h.level, h.title)
      } else {
        // Docling called it a heading but it reads as prose — keep the
        // content, drop the promotion.
        stats.demoted++
        emitParagraph(item.text)
      }
    } else if (item.label === 'list_item' && item.text) {
      // DCP controls are overwhelmingly lettered lists; keeping them as
      // list items preserves the a./b./c. structure the decomposer reads.
      openList()
      emitListItem(item.text)
    } else if (item.label === 'caption' && item.text) {
      emitCaption(item.text)
    } else if (item.text) {
      // Justified PDF text arrives with padded inter-word spacing
      // ("and  planted  along"); collapse it so the prose reads normally
      // and the decomposer sees clean sentences.
      emitParagraph(item.text)
    }
  }
  closeList()
  // Flush the final page, then any page Docling skipped entirely (a page
  // of pure figure with no text yields no items at all).
  if (curPage !== null) flushImagesFor(curPage)
  for (const page of [...imagesByPage.keys()].sort((a, b) => a - b)) {
    const list = imagesByPage.get(page)
    if ((imgIdx.get(page) ?? 0) >= list.length) continue
    openPage(page)
    flushImagesFor(page)
  }
} else {
  for (let p = 1; p <= total; p++) {
    openPage(p)
    const list = imagesByPage.get(p) ?? []
    list.forEach((img, i) => {
      stats.images++
      out.push(`![page ${p} img ${i + 1} (${img.width}x${img.height})](${img.relPath})`)
    })
    if (list.length) out.push('')
    const partNum = partNumberOf(srcFor(p))
    for (const raw of (pageTexts[p - 1] ?? '').split('\n')) {
      const line = raw.trim()
      if (!line) { out.push(''); continue }
      const candidates = outlineByPage.get(p) ?? []
      const isHeading = candidates.some((h) => h.title === norm(line))
        || RUBRIC_RE.test(norm(line))
      if (isHeading) {
        const { level, title } = levelFor(line, p, outlineByPage, partNum, null)
        stats.headings++
        out.push('')
        out.push(`${'#'.repeat(level)} ${title}`)
        out.push('')
      } else {
        out.push(line)
      }
    }
  }
}

// The clause-structured path emits its own <article>; only the legacy
// page-container path needs closing and wrapping here.
if (asHtml && !docling) {
  closeList()
  if (curPage !== null) out.push('</section>')
  out.unshift(
    `<article class="dcp-doc" data-source="${escAttr(basename(inPath))}"`
    + ` data-pages="${total}" data-generated="${new Date().toISOString().slice(0, 10)}">`,
  )
  out.push('</article>')
}

mkdirSync(dirname(outPath), { recursive: true })
const rendered = out.join('\n')
writeFileSync(outPath, rendered, 'utf8')

// ── quality sidecar ─────────────────────────────────────────────────────
//
// The scoring scripts print these numbers and exit 0, so nothing recorded
// what any existing conversion actually scored — Hornsby's had to be
// recomputed by hand months later. Written next to the output so a
// document's conversion quality is a fact on disk, diffable across
// re-conversions.

/** Heading level distribution and the share held by the commonest level.
 *  A 100% share means the hierarchy was lost, the defect that made every
 *  pre-rebuild Docling DCP a flat wall of `##`. */
function headingProfile(text, isHtml) {
  const levels = new Map()
  const re = isHtml ? /<h([1-6])\b/gi : /^(#{1,6})\s/gm
  for (const m of text.matchAll(re)) {
    const lvl = isHtml ? Number(m[1]) : m[1].length
    levels.set(lvl, (levels.get(lvl) ?? 0) + 1)
  }
  const counts = [...levels.values()]
  const total = counts.reduce((a, b) => a + b, 0)
  return {
    total,
    distinct_levels: levels.size,
    by_level: Object.fromEntries([...levels.entries()].sort((a, b) => a[0] - b[0])),
    top_level_share: total ? Number((Math.max(0, ...counts) / total).toFixed(3)) : 0,
  }
}

/** Distinct pages carrying provenance. One distinct page across hundreds is
 *  the albury-dcp-2010 failure: every citation deep-links to page 1. */
function pageProvenance(text, isHtml) {
  const re = isHtml ? /data-page(?:-start)?="(\d+)"/g : /\|\s*PAGE:\s*(\d+)\s*-->/g
  const seen = new Set()
  for (const m of text.matchAll(re)) seen.add(Number(m[1]))
  return { markers: seen.size, min: seen.size ? Math.min(...seen) : null, max: seen.size ? Math.max(...seen) : null }
}

const regime = partNumberingOf(partLabelArg || basename(inPath))
const heading = headingProfile(rendered, asHtml)
const provenance = pageProvenance(rendered, asHtml)
const quality = {
  output: outPath,
  format: asHtml ? 'html' : 'md',
  source: basename(inPath),
  source_pages: total,
  bytes: Buffer.byteLength(rendered),
  generated: new Date().toISOString(),
  part_label: partLabelArg || null,
  anchor_prefix: anchorPrefix || null,
  part_numbering: regime ? regime.kind : null,
  docling: docling ? { version: docling.meta.docling, items: docling.meta.items, tables: docling.meta.tables, hierarchy: docling.meta.heading_hierarchy, seconds: docling.meta.seconds } : null,
  headings: heading,
  page_provenance: provenance,
  // Every page should carry provenance. Anything well below 1.0 means
  // citations in the shortfall cannot deep-link.
  page_coverage: total ? Number((provenance.markers / total).toFixed(3)) : 0,
  tables: stats.tables,
  merged_tables: stats.mergedTables,
  list_items: stats.listItems,
  captions: stats.captions,
  prose_demoted: stats.demoted,
  contents_skipped: { index_tables: stats.tocSkipped, loose_entries: stats.contentsSkipped, regenerated: !!stats.contentsGenerated },
  images: { placed: stats.images, written: imgStats.written, deduped: imgStats.deduped, too_small: imgStats.tiny, failed: imgStats.failed, bytes: imgStats.bytes },
}
const qualityPath = `${outPath}.quality.json`
writeFileSync(qualityPath, JSON.stringify(quality, null, 2), 'utf8')

say(`\nWrote ${outPath}\n`)
say(`  quality sidecar : ${qualityPath}\n`)
say(`  page provenance : ${provenance.markers}/${total} pages (${(quality.page_coverage * 100).toFixed(1)}%)\n`)
say(`  heading levels  : ${heading.distinct_levels} distinct, top level holds ${(heading.top_level_share * 100).toFixed(1)}%\n`)
if (docling) {
  const m = docling.meta
  say(`  docling         : ${m.docling}, ${m.items} items, ${m.tables} tables, hierarchy=${m.heading_hierarchy}, ${m.seconds}s\n`)
}
say(asHtml && docling
  ? `  parts           : ${stats.pagesEmitted}\n`
  : `  pages emitted   : ${stats.pagesEmitted}\n`)
say(`  tables          : ${stats.tables}\n`)
say(`  headings        : ${stats.headings}${stats.demoted ? ` (${stats.demoted} prose items demoted to body text)` : ''}\n`)
if (stats.listItems || stats.captions) {
  say(`  lists/captions  : ${stats.listItems} list items, ${stats.captions} captions`
    + `${stats.captionsDeduped ? ` (${stats.captionsDeduped} duplicates of a table caption dropped)` : ''}\n`)
}
if (stats.tocSkipped || stats.contentsSkipped) {
  say(`  contents pages  : ${stats.tocSkipped} index tables, ${stats.contentsSkipped} loose entries skipped`
    + `${stats.contentsGenerated ? ', listing regenerated from the clause tree' : ''}\n`)
}
say(`  images          : ${stats.images} placed, ${imgStats.written} written, ${imgStats.deduped} deduped, ${imgStats.tiny} too small (${(imgStats.bytes / 1e6).toFixed(1)} MB)\n`)
