/**
 * Merge the converted parts of a multi-part DCP into one instrument.
 *
 * Most councils do not publish a DCP as one file. Randwick DCP 2025 is 43
 * separate PDFs of two vintages; Hornsby's "book version" is the exception,
 * not the rule. The converter handles one PDF at a time, so parts are
 * converted individually and stitched here.
 *
 * Why stitch rather than register each part as its own instrument (the
 * `liverpool-gcp-*` shape): anchor identity. Each part restarts its clause
 * numbering at 1, so "2.1" exists in B2, C1 and D3 alike. Independent
 * instruments would each mint `dcp.2.1` and a citation could not say which
 * part it meant. Conversion therefore namespaces every part
 * (`--anchor-prefix C1` → `dcp.C1.2.1`) and this step asserts that the
 * merged document has no duplicate ids at all.
 *
 * Namespacing per part, rather than de-duplicating across a single shared
 * pass, also keeps anchors stable under change: a part's ids depend only on
 * that part's own content, so adding Randwick's pending Stage 3 parts — or
 * re-converting one part after an amendment — cannot renumber the citations
 * in any other part.
 *
 * Usage:
 *   node scripts/dcp-merge.mjs --manifest public/EPI/DCPs/manifests/randwick-dcp-2025.json
 *
 * Flags:
 *   --manifest <p>   instrument manifest (required)
 *   --parts <dir>    where the per-part conversions live
 *                    (default build/dcp-parts/<instrument>)
 *   --out <p>        merged output (default public/EPI/DCPs/<instrument>.html)
 *   --md             also merge the per-part markdown
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

const argv = process.argv.slice(2)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const manifestPath = val('--manifest', '')
if (!manifestPath || !existsSync(manifestPath)) {
  process.stderr.write('Usage: node scripts/dcp-merge.mjs --manifest <manifest.json> [--parts <dir>] [--out <file>] [--md]\n')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const instrument = manifest.instrument
const partsDir = val('--parts', join('build', 'dcp-parts', instrument))
const outPath = val('--out', join('public', 'EPI', 'DCPs', `${instrument}.html`))
const alsoMd = argv.includes('--md')

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')
const say = (s) => process.stdout.write(s)

/** The content of a converted part, unwrapped from its own <article>. */
function innerOf(html, label) {
  const m = html.match(/^\s*<article[^>]*>\n?([\s\S]*?)\n?<\/article>\s*$/)
  if (!m) throw new Error(`${label}: not a single <article> document`)
  return m[1]
}

// ── collect parts ───────────────────────────────────────────────────────

const missing = []
const collected = []
for (const p of manifest.parts) {
  const prefix = p.anchor_prefix ?? p.part
  const file = join(partsDir, `${prefix}.html`)
  if (!existsSync(file)) { missing.push(`${prefix} (${file})`); continue }
  collected.push({ ...p, prefix, file, html: readFileSync(file, 'utf8') })
}

if (missing.length) {
  process.stderr.write(`Missing ${missing.length} of ${manifest.parts.length} converted parts:\n`)
  for (const m of missing) process.stderr.write(`  ${m}\n`)
  process.stderr.write('Convert every part before merging — a silently partial instrument is worse than none.\n')
  process.exit(1)
}

// ── merge ───────────────────────────────────────────────────────────────

const out = []
const idCounts = new Map()
const partRows = []
let totalPages = 0

for (const p of collected) {
  let inner = innerOf(p.html, p.prefix)

  // Stamp part identity and provenance onto the part container. `data-part`
  // is already there from conversion; the rest is what the flat
  // instruments.json schema has nowhere to record, and is exactly what a
  // reader needs to know when two vintages sit in one plan.
  inner = inner.replace(
    /<section class="dcp-part"/,
    `<section class="dcp-part" id="dcp.${escAttr(p.prefix)}"`
    + ` data-part-code="${escAttr(p.part)}"`
    + ` data-anchor-prefix="${escAttr(p.prefix)}"`
    + ` data-vintage="${escAttr(p.vintage)}"`
    + ` data-source-pdf="${escAttr(p.file ? basename(p.url ?? '') || p.file : '')}"`
    + ` data-source-pages="${p.pages ?? ''}"`,
  )

  for (const m of inner.matchAll(/\sid="([^"]+)"/g)) {
    idCounts.set(m[1], (idCounts.get(m[1]) ?? 0) + 1)
  }

  // Top-level clauses of this part, for the document contents listing.
  const clauses = [...inner.matchAll(
    /<section class="dcp-clause" id="([^"]+)" data-number="([^"]+)"[^>]*>\s*\n\s*<h(\d)>([\s\S]*?)<\/h\3>/g,
  )].map((m) => ({ id: m[1], number: m[2], depth: Number(m[3]), title: m[4].trim() }))
  const topDepth = clauses.length ? Math.min(...clauses.map((c) => c.depth)) : 0

  partRows.push({
    prefix: p.prefix,
    label: p.part_label ?? p.part,
    vintage: p.vintage,
    pages: p.pages,
    clauses: clauses.filter((c) => c.depth === topDepth),
  })
  totalPages += p.pages ?? 0
  out.push(inner)
}

// ── duplicate-id assertion ──────────────────────────────────────────────
//
// The whole reason for namespacing anchors. A duplicate id means two
// clauses answer to one citation, so fail loudly rather than publish it.

const dupes = [...idCounts.entries()].filter(([, n]) => n > 1)
if (dupes.length) {
  process.stderr.write(`\n${dupes.length} duplicate anchor id(s) in the merged document:\n`)
  for (const [id, n] of dupes.slice(0, 20)) process.stderr.write(`  ${id} ×${n}\n`)
  if (dupes.length > 20) process.stderr.write(`  … and ${dupes.length - 20} more\n`)
  process.stderr.write('Every part needs a distinct --anchor-prefix (see manifest anchor_prefix).\n')
  process.exit(1)
}

// ── contents ────────────────────────────────────────────────────────────

const VINTAGE_LABEL = {
  'stage-2-2025': null,                    // the default; no badge needed
  'dcp-2013-retained': 'DCP 2013 — retained',
}

const contents = () => {
  const rows = []
  for (const p of partRows) {
    const badge = VINTAGE_LABEL[p.vintage]
    rows.push(
      `<li class="dcp-contents-row dcp-contents-row--part">`
      + `<a href="#dcp.${escAttr(p.prefix)}">${esc(p.label)}</a>`
      + (badge ? `<span class="dcp-contents-vintage">${esc(badge)}</span>` : '')
      + (p.pages ? `<span class="dcp-contents-page">${p.pages} pp</span>` : '')
      + `</li>`,
    )
    for (const c of p.clauses) {
      rows.push(
        `<li class="dcp-contents-row dcp-contents-row--d1">`
        + `<a href="#${escAttr(c.id)}">${esc(c.title)}</a></li>`,
      )
    }
  }
  return `<nav class="dcp-contents" aria-label="Contents"><ul>${rows.join('')}</ul></nav>`
}

const generated = new Date().toISOString().slice(0, 10)
const header = `<article class="dcp-doc" data-source="${escAttr(basename(manifestPath))}"`
  + ` data-instrument="${escAttr(instrument)}"`
  + ` data-parts="${collected.length}"`
  + ` data-pages="${totalPages}"`
  + (manifest.commenced ? ` data-commenced="${escAttr(manifest.commenced)}"` : '')
  + (manifest.supersedes ? ` data-supersedes="${escAttr(manifest.supersedes)}"` : '')
  + ` data-generated="${generated}">`

mkdirSync(dirname(outPath), { recursive: true })
const html = [header, contents(), ...out, '</article>'].join('\n')
writeFileSync(outPath, html, 'utf8')

// ── merged quality sidecar ──────────────────────────────────────────────

const perPart = []
for (const p of collected) {
  const q = `${p.file}.quality.json`
  if (existsSync(q)) perPart.push({ prefix: p.prefix, ...JSON.parse(readFileSync(q, 'utf8')) })
}
const sum = (f) => perPart.reduce((a, q) => a + (f(q) ?? 0), 0)
const quality = {
  instrument,
  output: outPath,
  generated: new Date().toISOString(),
  parts: collected.length,
  parts_with_sidecar: perPart.length,
  source_pages: totalPages,
  bytes: Buffer.byteLength(html),
  unique_anchor_ids: idCounts.size,
  duplicate_anchor_ids: 0,
  vintages: Object.fromEntries(
    [...new Set(collected.map((p) => p.vintage))].map((v) => [v, collected.filter((p) => p.vintage === v).length]),
  ),
  totals: {
    headings: sum((q) => q.headings?.total),
    tables: sum((q) => q.tables),
    list_items: sum((q) => q.list_items),
    images_placed: sum((q) => q.images?.placed),
    prose_demoted: sum((q) => q.prose_demoted),
    page_markers: sum((q) => q.page_provenance?.markers),
  },
  // Parts whose pages are not all accounted for by provenance markers, or
  // whose headings all sit at one level — the two failure modes that make a
  // converted DCP uncitable.
  weak_parts: perPart
    .filter((q) => (q.page_coverage ?? 0) < 0.95 || (q.headings?.distinct_levels ?? 0) < 2)
    .map((q) => ({ prefix: q.prefix, page_coverage: q.page_coverage, distinct_levels: q.headings?.distinct_levels })),
}
writeFileSync(`${outPath}.quality.json`, JSON.stringify(quality, null, 2), 'utf8')

say(`\nMerged ${collected.length} parts -> ${outPath}\n`)
say(`  pages           : ${totalPages}\n`)
say(`  anchors         : ${idCounts.size} unique, 0 duplicates\n`)
say(`  vintages        : ${Object.entries(quality.vintages).map(([k, v]) => `${k}=${v}`).join(', ')}\n`)
say(`  headings/tables : ${quality.totals.headings} / ${quality.totals.tables}\n`)
say(`  page markers    : ${quality.totals.page_markers}/${totalPages}\n`)
if (quality.weak_parts.length) {
  say(`  weak parts      : ${quality.weak_parts.length} (see sidecar)\n`)
  for (const w of quality.weak_parts.slice(0, 8)) {
    say(`      ${w.prefix}: page_coverage=${w.page_coverage} levels=${w.distinct_levels}\n`)
  }
}

// ── markdown ────────────────────────────────────────────────────────────

if (alsoMd) {
  const mdOut = outPath.replace(/\.html?$/i, '.md')
  const chunks = []
  let mdMissing = 0
  for (const p of collected) {
    const f = join(partsDir, `${p.prefix}.md`)
    if (!existsSync(f)) { mdMissing++; continue }
    // Page numbers restart per part, so the part heading is what makes a
    // page marker in the merged file unambiguous.
    chunks.push(`\n# ${p.part_label ?? p.part}\n`)
    chunks.push(readFileSync(f, 'utf8').trim())
  }
  writeFileSync(mdOut, chunks.join('\n') + '\n', 'utf8')
  say(`  markdown        : ${mdOut}${mdMissing ? ` (${mdMissing} parts had no .md)` : ''}\n`)
}
