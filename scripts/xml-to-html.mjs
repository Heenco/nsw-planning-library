/**
 * Convert NSW Parliamentary Counsel EPI XML into structured HTML for the viewer.
 *
 * The markdown produced by xml-to-md.mjs strips every tag (`<[^>]+>` → ' '),
 * which was fine for its stated purpose — LLM ingest — but destroys the parts
 * of an LEP a reader needs: the Land Use Table, the acquisition tables, the
 * Dictionary, and the subclause/paragraph numbering. This emits the same shape
 * the DCP pipeline produces, so app/pages/doc-viewer.vue renders it through
 * renderHtmlDoc() with no viewer changes:
 *
 *   - every provision wrapped in <section id="..."> carrying the XML's own id,
 *     which is what shared/citation-format.ts already knows how to format
 *     (sec.5.10-ssec.1-para1.a → "cl 5.10(1)(a)")
 *   - headings as real h1–h6, so the sidebar contents builds itself
 *   - tables as tables, lists as lists, notes as notes
 *
 * Usage:
 *   node scripts/xml-to-html.mjs <in.xml> <out.html>
 *   node scripts/xml-to-html.mjs --all          convert every LEP that has XML
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── HTML plumbing ───────────────────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c])

/** Collapse the source's hard-wrapped whitespace without eating single spaces. */
const tidy = (s) => s.replace(/\s+/g, ' ')

// ── XML vocabulary ──────────────────────────────────────────────────────────
//
// Element census over the 146 LEPs: txt, entry, block, no, b, li, i, head,
// parentattributes, defterm, row, heading, tier, name, list, legref, level,
// note, content, extref, colspec, pre, deflist, sup, repealed, repealedtxt,
// table, tgroup, tbody, thead, citation, formula, graphic.

/** Carry no content of their own — metadata the reader never sees. */
const SKIP = new Set(['parentattributes', 'attrib', 'metadata', 'colspec', 'metacontent'])

/** Inline markup, rendered inside the enclosing paragraph. */
const INLINE = {
  b: 'strong',
  i: 'em',
  sup: 'sup',
  sub: 'sub',
}

/** `<level type>` → heading depth is positional, but these get a CSS hook. */
const LEVEL_CLASS = {
  part: 'lep-part',
  schedule: 'lep-schedule',
  division: 'lep-division',
  clausegroup: 'lep-zone',
  clause: 'lep-clause',
  dictionary: 'lep-dictionary',
  historicalnotes: 'lep-histnotes',
  tableleg: 'lep-histnotes',
  tableamends: 'lep-histnotes',
}

const child = (node, name) => {
  for (const c of Array.from(node.childNodes || [])) {
    if (c.nodeType === 1 && c.nodeName === name) return c
  }
  return null
}

const attr = (node, name) => (node.getAttribute ? node.getAttribute(name) : null) || ''

// ── Rendering ───────────────────────────────────────────────────────────────

/**
 * Render a node's children.
 *
 * `ctx.inCell` suppresses block wrappers inside table cells, where a <txt>
 * is a value rather than a paragraph.
 */
function renderChildren(node, ctx) {
  let out = ''
  for (const c of Array.from(node.childNodes || [])) out += render(c, ctx)
  return out
}

function render(node, ctx) {
  // Text
  if (node.nodeType === 3) return esc(tidy(node.nodeValue || ''))
  if (node.nodeType !== 1) return ''

  const name = node.nodeName
  if (SKIP.has(name)) return ''

  // <head> is consumed by whichever level/tier owns it.
  if (name === 'head') return ''

  if (INLINE[name]) return `<${INLINE[name]}>${renderChildren(node, ctx)}</${INLINE[name]}>`

  switch (name) {
    case 'level':
      return renderLevel(node, ctx)

    case 'tier':
      return renderTier(node, ctx)

    // A paragraph of text — unless it is a table cell's value.
    case 'txt':
      return ctx.inCell
        ? renderChildren(node, ctx)
        : `<p class="lep-txt">${renderChildren(node, ctx)}</p>`

    case 'block':
    case 'pre':
    case 'content':
    case 'included':
      return renderChildren(node, ctx)

    case 'list':
      return `<ul class="lep-list">${renderChildren(node, ctx)}</ul>`

    case 'li':
      return renderListItem(node, ctx)

    case 'note':
      return renderNote(node, ctx)

    case 'deflist':
      return `<div class="lep-deflist">${renderChildren(node, ctx)}</div>`

    // The defined term carries the anchor the Dictionary is navigated by.
    case 'defterm': {
      const id = attr(node, 'id')
      return `<dfn class="lep-defterm"${id ? ` id="${esc(id)}"` : ''}>${renderChildren(node, ctx)}</dfn>`
    }

    case 'table':
      return renderTable(node, ctx)

    case 'repealed':
    case 'repealedtxt':
      return `<p class="lep-repealed">${renderChildren(node, ctx)}</p>`

    case 'formulablock':
      return `<div class="lep-formula">${renderChildren(node, ctx)}</div>`
    case 'formula':
      return `<span class="lep-formula-inline">${renderChildren(node, ctx)}</span>`

    case 'graphic': {
      const href = attr(node, 'href') || attr(node, 'entity') || attr(node, 'src')
      return href ? `<img class="lep-graphic" src="${esc(href)}" alt="">` : ''
    }

    // References keep their text; the emphasis inside them is already marked up.
    case 'legref':
    case 'extref':
    case 'citation':
    case 'name':
      return `<span class="lep-ref">${renderChildren(node, ctx)}</span>`

    default:
      return renderChildren(node, ctx)
  }
}

/** `<head>` holds the provision's number and, usually, its heading text. */
function headParts(node, ctx) {
  const head = child(node, 'head')
  if (!head) return { no: '', heading: '' }
  const noEl = child(head, 'no')
  const headingEl = child(head, 'heading')
  return {
    no: noEl ? renderChildren(noEl, ctx).trim() : '',
    heading: headingEl ? renderChildren(headingEl, ctx).trim() : '',
    headingId: headingEl ? attr(headingEl, 'id') : '',
  }
}

/**
 * A level is a Part, Schedule, Division, zone group, clause or the Dictionary.
 *
 * Deliberately no `.dcp-part`/`data-part`: that grouping exists because a DCP
 * is merged from separate PDFs. An LEP's Part is a heading in the document, so
 * tagging it as a group too would list it twice — once as the group header and
 * again as the first row inside it. Nesting by heading level is enough.
 */
function renderLevel(node, ctx) {
  const type = attr(node, 'type')
  const id = attr(node, 'id')
  const { no, heading } = headParts(node, ctx)
  const depth = ctx.depth ?? 0

  const classes = ['lep-level', LEVEL_CLASS[type] || `lep-${type}`]

  // Heading text: "1.2 Aims of Plan", "Zone RU1 Primary Production".
  const label = [no, heading].filter(Boolean).join(' ')
  const level = Math.min(depth + 1, 6)
  const headingHtml = label
    ? `<h${level}>${no ? `<span class="lep-no">${no}</span> ` : ''}${heading}</h${level}>`
    : ''

  const inner = renderChildren(node, { ...ctx, depth: depth + 1 })
  return `<section class="${classes.join(' ')}"${id ? ` id="${esc(id)}"` : ''}>${headingHtml}${inner}</section>`
}

/**
 * A tier is a subclause. Most carry only a number — turning those into
 * headings would bury the contents list under thousands of "(1)" entries, so
 * the number becomes a hanging marker that still links to the provision.
 */
function renderTier(node, ctx) {
  const id = attr(node, 'id')
  const { no, heading } = headParts(node, ctx)
  const depth = ctx.depth ?? 0
  const inner = renderChildren(node, { ...ctx, depth: depth + 1 })

  if (heading) {
    const level = Math.min(depth + 1, 6)
    return `<section class="lep-level lep-subclause-titled"${id ? ` id="${esc(id)}"` : ''}>`
      + `<h${level}>${no ? `<span class="lep-no">${no}</span> ` : ''}${heading}</h${level}>`
      + `${inner}</section>`
  }

  return `<section class="lep-sub"${id ? ` id="${esc(id)}"` : ''}>`
    + `${marker(no, id)}<div class="lep-sub-body">${inner}</div></section>`
}

/**
 * The provision marker. Numbered markers link to themselves so a paragraph is
 * addressable; a bullet is decoration and gets no link.
 */
function marker(no, id) {
  if (!no) return '<span class="lep-no"></span>'
  const addressable = id && /[0-9a-z]/i.test(stripTags(no))
  return addressable
    ? `<a class="lep-no lep-no--link" href="#${esc(id)}">${no}</a>`
    : `<span class="lep-no">${no}</span>`
}

/** Paragraphs — (a), (b), (i) — keep the source's marker rather than a CSS counter. */
function renderListItem(node, ctx) {
  const id = attr(node, 'id')
  const noEl = child(node, 'no')
  const no = noEl ? renderChildren(noEl, ctx).trim() : ''
  let inner = ''
  for (const c of Array.from(node.childNodes || [])) {
    if (c.nodeType === 1 && c.nodeName === 'no') continue
    inner += render(c, ctx)
  }
  return `<li class="lep-li"${id ? ` id="${esc(id)}"` : ''}>${marker(no, id)}<div class="lep-li-body">${inner}</div></li>`
}

/** Notes are guidance, not operative text — cl 1.5 of every LEP says so. */
function renderNote(node, ctx) {
  const id = attr(node, 'id')
  const headingEl = child(node, 'heading')
  const label = headingEl ? renderChildren(headingEl, ctx).trim() : 'Note.'
  let inner = ''
  for (const c of Array.from(node.childNodes || [])) {
    if (c.nodeType === 1 && c.nodeName === 'heading') continue
    inner += render(c, ctx)
  }
  return `<aside class="lep-note"${id ? ` id="${esc(id)}"` : ''}>`
    + `<span class="lep-note-label">${label}</span>${inner}</aside>`
}

function renderTable(node, ctx) {
  const id = attr(node, 'id')
  const group = child(node, 'tgroup') || node
  const thead = child(group, 'thead')
  const tbody = child(group, 'tbody') || group

  const rows = (section, cellTag) => {
    if (!section) return ''
    let out = ''
    for (const row of Array.from(section.childNodes || [])) {
      if (row.nodeType !== 1 || row.nodeName !== 'row') continue
      let cells = ''
      for (const entry of Array.from(row.childNodes || [])) {
        if (entry.nodeType !== 1 || entry.nodeName !== 'entry') continue
        const rowspan = Number(attr(entry, 'morerows')) || 0
        const spans = [
          rowspan ? ` rowspan="${rowspan + 1}"` : '',
          attr(entry, 'namest') && attr(entry, 'nameend') && attr(entry, 'namest') !== attr(entry, 'nameend')
            ? ` colspan="${Math.abs(Number(attr(entry, 'nameend')) - Number(attr(entry, 'namest'))) + 1 || 2}"`
            : '',
        ].join('')
        const cellId = attr(entry, 'id')
        cells += `<${cellTag}${cellId ? ` id="${esc(cellId)}"` : ''}${spans}>`
          + renderChildren(entry, { ...ctx, inCell: true })
          + `</${cellTag}>`
      }
      out += `<tr>${cells}</tr>`
    }
    return out
  }

  const head = thead ? `<thead>${rows(thead, 'th')}</thead>` : ''
  const body = `<tbody>${rows(tbody, 'td')}</tbody>`
  return `<div class="lep-table-wrap"><table class="lep-table"${id ? ` id="${esc(id)}"` : ''}>${head}${body}</table></div>`
}

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

// ── Document ────────────────────────────────────────────────────────────────

export function convertXml(xml) {
  const parser = new DOMParser({
    // The DOCTYPE points at a DTD we do not ship; the markup itself is fine.
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw new Error(e) } },
  })
  const doc = parser.parseFromString(xml, 'text/xml')
  const exdoc = doc.documentElement
  const title = attr(exdoc, 'title')

  const body = renderChildren(exdoc, { depth: 0, inCell: false })
  return { title, html: `<article class="lep-doc">${body}</article>` }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function convertFile(xmlPath, outPath) {
  const { title, html } = convertXml(readFileSync(xmlPath, 'utf-8'))
  writeFileSync(outPath, html, 'utf-8')
  return { title, bytes: html.length }
}

/** Titles are hard-wrapped in the XML and double-spaced in instruments.json,
 *  so compare on collapsed whitespace rather than the raw string. */
const titleKey = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

function titleIndex() {
  // instruments.json is the list the frontend browses; match on title so the
  // .html lands beside the .md the viewer already resolves.
  const instruments = JSON.parse(readFileSync(join(root, 'public', 'instruments.json'), 'utf-8'))
  const byTitle = new Map()
  for (const state of Object.values(instruments)) {
    for (const cat of Object.values(state.categories || {})) {
      for (const item of cat.items || []) byTitle.set(titleKey(item.title), item)
    }
  }
  return byTitle
}

const [, , a, b] = process.argv

if (a === '--all') {
  const byTitle = titleIndex()
  const xmlDir = join(root, 'public', 'EPI', 'xml')
  let ok = 0, skipped = 0, failed = 0

  for (const file of readdirSync(xmlDir).filter((f) => f.endsWith('.xml'))) {
    const xmlPath = join(xmlDir, file)
    try {
      const { title, html } = convertXml(readFileSync(xmlPath, 'utf-8'))
      const item = byTitle.get(titleKey(title))
      if (!item) {
        console.warn(`skip  ${file} — "${title}" not in instruments.json`)
        skipped++
        continue
      }
      const outPath = join(root, 'public', item.file.replace(/\.md$/i, '.html'))
      if (!existsSync(dirname(outPath))) {
        console.warn(`skip  ${file} — no directory for ${item.file}`)
        skipped++
        continue
      }
      writeFileSync(outPath, html, 'utf-8')
      ok++
    } catch (err) {
      console.error(`FAIL  ${file} — ${err.message}`)
      failed++
    }
  }
  console.log(`\nconverted ${ok}, skipped ${skipped}, failed ${failed}`)
} else if (a && b) {
  const { title, bytes } = convertFile(a, b)
  console.log(`${title} → ${b} (${bytes.toLocaleString()} bytes)`)
} else if (a !== '--all') {
  console.error('Usage: node scripts/xml-to-html.mjs <in.xml> <out.html>')
  console.error('       node scripts/xml-to-html.mjs --all')
  process.exit(1)
}
