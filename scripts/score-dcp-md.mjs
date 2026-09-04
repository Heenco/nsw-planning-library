/**
 * Score a converted DCP markdown file on the four axes that matter for a
 * citable planning library. Used to compare conversion pipelines on the
 * same document.
 *
 *   tables      — pipe-table rows. The controls (setbacks, heights, FSR,
 *                 parking rates) live here; a converter that flattens them
 *                 produces confidently wrong answers.
 *   hierarchy   — spread of heading levels. Docling collapses everything to
 *                 `##` unless heading hierarchy is enabled, which destroys
 *                 the parent/child relationships anchors depend on.
 *   provenance  — `<!-- SRC: file | PAGE: n -->` markers. DCP citations
 *                 resolve to `#page=N`, so one marker per file means every
 *                 citation in a 646-page document points at page 1.
 *   images      — figure links, and how many are tiny fragments rather than
 *                 whole diagrams.
 *
 * Usage:
 *   node scripts/score-dcp-md.mjs public/EPI/DCPs/*.md
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const files = process.argv.slice(2)
if (!files.length) {
  process.stderr.write('Usage: node scripts/score-dcp-md.mjs <file.md> [more.md ...]\n')
  process.exit(1)
}

function score(path) {
  const md = readFileSync(path, 'utf8')
  const lines = md.split('\n')

  // ── tables ──
  const tableRows = lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length
  // A separator row (|---|---|) marks the start of one table.
  const tableCount = lines.filter((l) => /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(l)).length

  // ── hierarchy ──
  const levels = {}
  for (const l of lines) {
    const m = l.match(/^(#{1,6})\s/)
    if (m) levels[m[1].length] = (levels[m[1].length] ?? 0) + 1
  }
  const headings = Object.values(levels).reduce((a, b) => a + b, 0)
  const distinctLevels = Object.keys(levels).length
  const topLevelShare = headings
    ? Math.max(...Object.values(levels)) / headings
    : 0

  // ── provenance ──
  const srcMarkers = [...md.matchAll(/<!--\s*SRC:\s*([^|]+?)\s*\|\s*PAGE:\s*(\d+)\s*-->/gi)]
  const distinctPages = new Set(srcMarkers.map((m) => m[2])).size

  // ── images ──
  const imgLinks = [...md.matchAll(/^!\[([^\]]*)\]\(([^)]+)\)/gm)]
  const dims = [...md.matchAll(/\((\d+)x(\d+)\)/g)].map((m) => [+m[1], +m[2]])
  const tiny = dims.filter(([w, h]) => w < 200 || h < 200).length
  const unmatched = (md.match(/<!-- image/g) || []).length

  return {
    doc: basename(path).replace(/\.md$/, ''),
    kb: Math.round(md.length / 1024),
    tableCount,
    tableRows,
    headings,
    distinctLevels,
    topLevelShare,
    srcMarkers: srcMarkers.length,
    distinctPages,
    images: imgLinks.length,
    tiny,
    unmatched,
  }
}

const rows = files.map(score)
const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

process.stdout.write(
  `${pad('document', 34)}${num('KB', 6)}${num('tables', 8)}${num('rows', 7)}` +
  `${num('headings', 9)}${num('levels', 7)}${num('flat%', 7)}` +
  `${num('SRC', 6)}${num('pages', 7)}${num('imgs', 6)}${num('tiny', 6)}\n`,
)
process.stdout.write('-'.repeat(108) + '\n')
for (const r of rows) {
  process.stdout.write(
    `${pad(r.doc.slice(0, 33), 34)}${num(r.kb, 6)}${num(r.tableCount, 8)}${num(r.tableRows, 7)}` +
    `${num(r.headings, 9)}${num(r.distinctLevels, 7)}${num((100 * r.topLevelShare).toFixed(0) + '%', 7)}` +
    `${num(r.srcMarkers, 6)}${num(r.distinctPages, 7)}${num(r.images, 6)}${num(r.tiny, 6)}\n`,
  )
}
process.stdout.write(
  '\nflat% = share of headings sitting at the single most common level ' +
  '(100% means no hierarchy at all)\n' +
  'pages = distinct page numbers across SRC markers (1 means no per-page provenance)\n',
)
