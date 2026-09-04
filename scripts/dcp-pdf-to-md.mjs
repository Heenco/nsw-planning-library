/**
 * DCP PDF → structured Markdown.
 *
 * The earlier converter (heenco repo) emitted flat page text with no
 * headings at all, which is why DCP anchors are so weak: 63.5% of Randwick's
 * headings needed positional disambiguation because they were whatever
 * happened to look like a heading in raw PDF text.
 *
 * Most council DCPs ship as tagged PDFs carrying a bookmark outline — a real
 * heading tree with destinations. This converter uses that outline as the
 * structure, rather than guessing from text:
 *
 *   1. Read the outline into a flat list of { depth, title, page }.
 *   2. Treat depth-1 nodes as source-part boundaries. In a merged "book
 *      version" these are the constituent part PDFs (e.g. "D09360291 HDCP
 *      2024 Part 1 General - 23 June 2025 - CURRENT"), which gives every
 *      page an accurate `SRC` label without needing the split files.
 *   3. Extract each page's text (line breaks preserved) and raster images.
 *   4. Walk each page line by line. A line that matches an outline title for
 *      that page becomes a markdown heading at the outline's depth; every
 *      other line passes through. Matching in place keeps document order,
 *      which the outline itself does not guarantee — Hornsby lists 1.1.4
 *      before 1.1.2.
 *
 * Output is the format server/utils/nsw-kg/parsers/structured-md-parser.ts
 * already consumes, and that app/utils/doc-anchors.ts reads for citations:
 *
 *     <!-- SRC: HDCP 2024 Part 1 General.pdf | PAGE: 11 -->
 *
 *     ![page 11 img 1 (800x600)](images/hornsby/p0011-a3f8c2b1.png)
 *
 *     ### 1.1.1 Preamble
 *
 *     This Development Control Plan (DCP) applies to all land …
 *
 * Usage:
 *   node scripts/dcp-pdf-to-md.mjs --in public/EPI/DCPs/pdf/foo.pdf \
 *                                  --out public/EPI/DCPs/foo.md \
 *                                  --images hornsby
 *
 * Flags:
 *   --in <pdf>       source PDF (required)
 *   --out <md>       destination markdown (required)
 *   --images <dir>   subfolder under public/EPI/DCPs/images/ (default: out basename)
 *   --no-images      skip image extraction entirely (much faster)
 *   --max-pages <n>  only convert the first n pages (for a trial run)
 *   --quiet          suppress per-part progress
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { getDocumentProxy, extractText, extractImages, definePDFJSModule } from 'unpdf'

import { rawImageToPngBuffer } from './lib/pdf-image-utils.mjs'

const DCP_DIR = join('public', 'EPI', 'DCPs')
const IMAGES_ROOT = join(DCP_DIR, 'images')
/** Below this, an image is a bullet glyph or rule, not content. */
const MIN_IMAGE_DIMENSION = 32

// ── args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const inPath = val('--in', '')
const outPath = val('--out', '')
const noImages = argv.includes('--no-images')
const quiet = argv.includes('--quiet')
const maxPages = Number(val('--max-pages', '0')) || 0
const imageDir = val('--images', basename(outPath || 'dcp').replace(/\.md$/, ''))

if (!inPath || !outPath) {
  process.stderr.write('Usage: node scripts/dcp-pdf-to-md.mjs --in <pdf> --out <md> [--images <dir>]\n')
  process.exit(1)
}
if (!existsSync(inPath)) {
  process.stderr.write(`No such PDF: ${inPath}\n`)
  process.exit(1)
}

const log = (s) => { if (!quiet) process.stdout.write(s) }
/** The run summary always prints — --quiet only silences per-part progress. */
const summary = (s) => process.stdout.write(s)

// ── outline ─────────────────────────────────────────────────────────────

const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** Resolve a bookmark destination to a 1-based page number. */
async function resolvePage(pdf, item) {
  try {
    let dest = item.dest
    if (typeof dest === 'string') dest = await pdf.getDestination(dest)
    if (!Array.isArray(dest)) return null
    const ref = dest[0]
    if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref)) + 1
    if (typeof ref === 'number') return ref + 1
  } catch {
    // Broken destination — the heading still exists, we just cannot place it.
  }
  return null
}

async function readOutline(pdf) {
  const root = await pdf.getOutline()
  const flat = []
  const walk = async (items, depth) => {
    for (const it of items) {
      flat.push({ depth, title: norm(it.title ?? ''), page: await resolvePage(pdf, it) })
      if (it.items?.length) await walk(it.items, depth + 1)
    }
  }
  await walk(root ?? [], 1)
  return flat.filter((n) => n.title)
}

/**
 * Depth-1 outline nodes in a merged DCP are the constituent part documents.
 * Their titles are records-management filenames — "D09360291 HDCP 2024
 * Part 1 General - 23 June 2025 - CURRENT" — so strip the doc id and the
 * CURRENT suffix to get a usable source label.
 */
function partLabel(title) {
  return title
    .replace(/^D\d+\s*/i, '')
    .replace(/\s*[-–]\s*CURRENT.*$/i, '')
    .replace(/\(\d+\)\s*$/, '')
    .trim() || title
}

// ── images ──────────────────────────────────────────────────────────────

async function pageImages(pdf, pageNum, cache, stats) {
  if (noImages) return []
  let raw = []
  try {
    raw = await extractImages(pdf, pageNum)
  } catch {
    // Malformed XObject refs happen; text for the page is still good.
    return []
  }

  const out = []
  for (const img of raw) {
    stats.attempted++
    const width = Number(img.width)
    const height = Number(img.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue
    if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) { stats.tiny++; continue }

    const bytes = img.data instanceof Uint8Array
      ? img.data
      : new Uint8Array(img.data.buffer ?? img.data, img.data.byteOffset ?? 0, img.data.byteLength ?? img.data.length)
    const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 12)

    // Letterheads and logos repeat on every page — write them once.
    const hit = cache.get(hash)
    if (hit) { out.push(hit); stats.deduped++; continue }

    const png = rawImageToPngBuffer({ data: img.data, width, height, channels: img.channels })
    if (!png) { stats.failed++; continue }

    const relPath = `images/${imageDir}/p${String(pageNum).padStart(4, '0')}-${hash}.png`
    mkdirSync(join(IMAGES_ROOT, imageDir), { recursive: true })
    writeFileSync(join(DCP_DIR, relPath), png)
    stats.written++
    stats.bytes += png.length

    const rec = { relPath, width, height }
    cache.set(hash, rec)
    out.push(rec)
  }
  return out
}

// ── heading fallback for unbookmarked parts ─────────────────────────────
//
// A merged DCP's bookmarks are often partial. Hornsby's book version has a
// full outline for Parts 1 and 4 but only a top-level node for Parts 2, 3
// and 5 — around a fifth of the document would otherwise land as flat text.
//
// For pages with no outline coverage we recover headings from the text.
// Naively promoting any line that starts with a digit is far too eager:
// "18 metres wide, and" and "2 storey element = 1.5m" are body text. Two
// constraints make it precise — the number must be a multi-segment clause
// number *within the current part* (Part 3 → 3.1, 3.1.1), and the line must
// read like a heading rather than a wrapped sentence.

/** Rubric blocks that structure a NSW DCP clause. Unnumbered, so they need
 *  naming explicitly rather than by pattern. */
const RUBRIC_RE = /^(Desired Outcomes?|Prescriptive Measures?|Objectives?|Controls?|Notes?|Figures?|Legend|Explanation|Background|Requirements?)$/i

function fallbackHeading(line, partNum) {
  if (RUBRIC_RE.test(line)) return { level: 4, title: line }

  const m = line.match(/^(\d+(?:\.\d+){1,3})\s+(\S.*)$/)
  if (!m) return null
  const [, number, rest] = m

  // Must belong to the part we are inside — this is what rejects stray
  // measurements and cross-references that merely open with a digit.
  if (partNum !== null && !number.startsWith(`${partNum}.`)) return null
  // Headings are short, and do not trail off like wrapped prose.
  if (rest.length > 80) return null
  if (/[,;:]$/.test(rest) || /\b(and|or|the|to|of|in|for|with)$/i.test(rest)) return null
  if (!/^[A-Z(]/.test(rest)) return null
  // A part's own contents page repeats every heading with its page
  // reference — "3.1 Dwelling Houses and Dual Occupancies 3-5". Promoting
  // those would duplicate each real heading in the body.
  if (/\s\d+[-–]\d+$/.test(rest) || /\.{3,}\s*\d+$/.test(rest)) return null

  // 3.1 → h2, 3.1.1 → h3, matching the levels the outline produces.
  return { level: Math.min(number.split('.').length, 6), title: line }
}

/** Part number from a source label like "HDCP 2024 Part 3 Residential.pdf". */
function partNumberOf(label) {
  const m = label.match(/\bPart\s+(\d+)\b/i)
  return m ? Number(m[1]) : null
}

// ── page rendering ──────────────────────────────────────────────────────

/**
 * Emit one page: source marker, images, then the text with outline headings
 * promoted in place.
 *
 * `headings` are this page's outline nodes. Each is consumed at most once,
 * matched against a text line, so a title repeated in a running header does
 * not produce a second heading.
 */
function renderPage({ srcLabel, page, text, images, headings }, stats) {
  const partNum = partNumberOf(srcLabel)
  const lines = [`<!-- SRC: ${srcLabel} | PAGE: ${page} -->`, '']

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    lines.push(`![page ${page} img ${i + 1} (${img.width}x${img.height})](${img.relPath})`)
  }
  if (images.length) lines.push('')

  const pending = headings.map((h) => ({ ...h, used: false }))
  const src = text.split('\n')

  for (let i = 0; i < src.length; i++) {
    const line = src[i].trim()
    if (!line) { lines.push(''); continue }
    const flat = norm(line)

    // Exact match first, then a numbered-prefix fallback for titles whose
    // punctuation differs between the bookmark and the page text (e.g.
    // "4.3.1 Town Centre Masterplans –General" vs "– General").
    let hit = pending.find((h) => !h.used && h.title === flat)
    if (!hit) {
      const num = flat.match(/^(\d+(?:\.\d+)*)\s/)
      if (num) hit = pending.find((h) => !h.used && h.title.startsWith(num[1] + ' '))
    }

    if (!hit) {
      // No outline for this page — recover the heading from the text.
      if (!pending.length) {
        const fb = fallbackHeading(line, partNum)
        if (fb) {
          stats.fromText++
          lines.push('')
          lines.push(`${'#'.repeat(fb.level)} ${fb.title}`)
          lines.push('')
          continue
        }
      }
      lines.push(line)
      continue
    }

    // A long heading wraps across several lines in the page text — "1.1.5
    // Relationship to other plans and" / "policies". Consume the
    // continuation lines so they do not reappear as body text, then emit
    // the outline's own title, which is always the complete one. The
    // anchor is derived from this text, so a truncated heading would mean
    // a broken citation.
    let acc = flat
    while (acc.length < hit.title.length && i + 1 < src.length) {
      const next = norm(src[i + 1])
      if (!next) break
      const joined = norm(`${acc} ${next}`)
      if (!hit.title.startsWith(joined) && joined !== hit.title) break
      acc = joined
      i++
    }

    hit.used = true
    stats.headings++
    if (acc !== hit.title) stats.approximate++
    // Outline depth 2 is the top real heading (depth 1 is the part file).
    const level = Math.min(Math.max(hit.depth - 1, 1), 6)
    lines.push('')
    lines.push(`${'#'.repeat(level)} ${hit.title}`)
    lines.push('')
  }

  stats.unplaced += pending.filter((h) => !h.used).length
  lines.push('')
  lines.push('---')
  lines.push('')
  return lines.join('\n')
}

// ── main ────────────────────────────────────────────────────────────────

// unpdf's bundled pdf.js cannot initialise OpenJPEG, so every JPEG 2000
// figure fails to decode and is silently dropped — 44% of the images in
// Hornsby's DCP, measured. pdfjs-dist v4's legacy build decodes them all
// (0 failures over the same sample) and, unlike v6, loads cleanly under
// Node 24: v6 throws "hashOriginal.toHex is not a function" on import.
await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))

const pdf = await getDocumentProxy(new Uint8Array(readFileSync(inPath)))
const outline = await readOutline(pdf)
log(`Outline: ${outline.length} nodes\n`)

const { text: pageTexts } = await extractText(pdf, { mergePages: false })
const total = maxPages ? Math.min(maxPages, pageTexts.length) : pageTexts.length
log(`Pages: ${pageTexts.length}${maxPages ? ` (converting first ${total})` : ''}\n`)

// Part boundaries: depth-1 nodes, in page order. Everything from one node's
// page until the next belongs to that part.
const parts = outline
  .filter((n) => n.depth === 1 && n.page)
  .sort((a, b) => a.page - b.page)
  .map((n) => ({ page: n.page, label: `${partLabel(n.title)}.pdf` }))

const srcFor = (page) => {
  let label = parts.length ? parts[0].label : `${basename(inPath)}`
  for (const p of parts) { if (p.page <= page) label = p.label; else break }
  return label
}

// Headings by page — depth >= 2 only; depth 1 is the part boundary itself.
const headingsByPage = new Map()
for (const n of outline) {
  if (n.depth < 2 || !n.page) continue
  if (!headingsByPage.has(n.page)) headingsByPage.set(n.page, [])
  headingsByPage.get(n.page).push(n)
}

const imgStats = { attempted: 0, written: 0, deduped: 0, tiny: 0, failed: 0, bytes: 0 }
const stats = { headings: 0, unplaced: 0, approximate: 0, fromText: 0 }
const cache = new Map()
const chunks = []

let lastPart = null
for (let i = 0; i < total; i++) {
  const page = i + 1
  const srcLabel = srcFor(page)
  if (srcLabel !== lastPart) { log(`  → ${srcLabel} (from p${page})\n`); lastPart = srcLabel }

  chunks.push(renderPage({
    srcLabel,
    page,
    text: pageTexts[i] ?? '',
    images: await pageImages(pdf, page, cache, imgStats),
    headings: headingsByPage.get(page) ?? [],
  }, stats))
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, chunks.join('\n'), 'utf8')

// Count only headings on the pages actually converted — otherwise a
// --max-pages trial reports a meaningless placement rate against the
// whole document.
const expected = outline.filter((n) => n.depth >= 2 && n.page && n.page <= total).length
summary(`\nWrote ${outPath}\n`)
summary(`  from outline    : ${stats.headings}/${expected} bookmarked headings on pages 1-${total} (${(100 * stats.headings / Math.max(expected, 1)).toFixed(1)}%)\n`)
summary(`  unplaced        : ${stats.unplaced}${stats.approximate ? `, reflowed from wrapped text: ${stats.approximate}` : ''}\n`)
if (stats.fromText) {
  summary(`  from text       : ${stats.fromText} recovered on pages the outline does not cover\n`)
}
summary(`  headings total  : ${stats.headings + stats.fromText}\n`)
if (!noImages) {
  summary(`  images          : ${imgStats.written} written, ${imgStats.deduped} deduped, ${imgStats.tiny} too small, ${imgStats.failed} failed (${(imgStats.bytes / 1e6).toFixed(1)} MB)\n`)
}
