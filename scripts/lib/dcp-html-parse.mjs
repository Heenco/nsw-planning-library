/**
 * Read a clause-structured DCP HTML document into a section tree.
 *
 * This is the stage-1 parser the pipeline design calls for, and it is
 * deliberately thin: everything it needs is an attribute the converter
 * already wrote, so there is nothing to infer.
 *
 *   <section class="dcp-clause" id="dcp.4.2.1" data-number="4.2.1"
 *            data-page-start="216" data-page-end="218">
 *     <h3>4.2.1 Scale</h3>
 *     <section class="dcp-rubric" data-rubric="controls" …>
 *
 * Compare with structured-md-parser.ts, which has to recover the same
 * information from heading levels and comment markers.
 */

import { parseDocument } from 'htmlparser2'
import { textContent, getAttributeValue, findAll, findOne } from 'domutils'

/** A section as read from the document, before it reaches the database. */
export function parseDcpHtml(html) {
  const doc = parseDocument(html, { decodeEntities: true })
  const article = findOne((e) => e.name === 'article', doc.children, true)
  if (!article) throw new Error('no <article> — is this a converted DCP?')

  const meta = {
    source: getAttributeValue(article, 'data-source') ?? null,
    pages: Number(getAttributeValue(article, 'data-pages')) || null,
    generated: getAttributeValue(article, 'data-generated') ?? null,
  }

  const sections = []
  let order = 0

  const walk = (node, depth, part) => {
    for (const child of node.children ?? []) {
      if (child.type !== 'tag' || child.name !== 'section') continue
      const cls = getAttributeValue(child, 'class') ?? ''
      const nextPart = getAttributeValue(child, 'data-part') ?? part

      // The heading is the section's own <h1..h6>, not a descendant's.
      const heading = (child.children ?? []).find(
        (c) => c.type === 'tag' && /^h[1-6]$/.test(c.name))

      const s = {
        id: getAttributeValue(child, 'id') ?? null,
        cls,
        kind: cls.includes('dcp-part') ? 'part'
          : cls.includes('dcp-clause') ? 'clause'
            : cls.includes('dcp-rubric') ? 'rubric' : 'block',
        number: getAttributeValue(child, 'data-number') ?? null,
        rubric: getAttributeValue(child, 'data-rubric') ?? null,
        part: nextPart,
        pageStart: Number(getAttributeValue(child, 'data-page-start')) || null,
        pageEnd: Number(getAttributeValue(child, 'data-page-end')) || null,
        heading: heading ? textContent(heading).trim() : null,
        level: heading ? Number(heading.name.slice(1)) : depth,
        depth,
        order: order++,
        // Own text: paragraphs and list items directly inside this section,
        // excluding nested sections, so a parent does not swallow its
        // children's text and become a 60k-character blob.
        text: ownText(child),
        lists: ownLists(child),
        tables: (child.children ?? [])
          .filter((c) => c.type === 'tag' && c.name === 'table')
          .map(parseTable),
        figures: findAll((e) => e.name === 'img', child.children ?? [])
          .filter((img) => !insideNestedSection(img, child))
          .map((img) => ({
            src: getAttributeValue(img, 'src') ?? '',
            alt: getAttributeValue(img, 'alt') ?? '',
          })),
      }
      sections.push(s)
      walk(child, depth + 1, nextPart)
    }
  }

  walk(article, 0, null)
  return { meta, sections }
}

/** Text of a section's own <p> children, not its nested sections'. */
function ownText(section) {
  return (section.children ?? [])
    .filter((c) => c.type === 'tag' && c.name === 'p')
    .map((p) => textContent(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** List items belonging to this section directly. */
function ownLists(section) {
  const out = []
  for (const c of section.children ?? []) {
    if (c.type !== 'tag' || (c.name !== 'ul' && c.name !== 'ol')) continue
    for (const li of c.children ?? []) {
      if (li.type === 'tag' && li.name === 'li') {
        const t = textContent(li).replace(/\s+/g, ' ').trim()
        if (t) out.push(t)
      }
    }
  }
  return out
}

function insideNestedSection(node, stopAt) {
  let p = node.parent
  while (p && p !== stopAt) {
    if (p.type === 'tag' && p.name === 'section') return true
    p = p.parent
  }
  return false
}

/**
 * A control table as a relation, not prose. `<caption>` carries the table
 * number the surrounding text cites ("comply with Table 3.1.2-a"), and
 * colspan is expanded so every cell keeps its column header.
 */
function parseTable(table) {
  const caption = findOne((e) => e.name === 'caption', table.children, true)
  const rows = findAll((e) => e.name === 'tr', table.children)
  const grid = []
  for (const tr of rows) {
    const cells = (tr.children ?? []).filter(
      (c) => c.type === 'tag' && (c.name === 'td' || c.name === 'th'))
    const row = []
    for (const c of cells) {
      const span = Number(getAttributeValue(c, 'colspan')) || 1
      const value = {
        text: textContent(c).replace(/\s+/g, ' ').trim(),
        header: c.name === 'th',
      }
      // Repeat a spanned value across the columns it covers, so a lookup by
      // column header still finds it.
      for (let i = 0; i < span; i++) row.push(value)
    }
    if (row.length) grid.push(row)
  }
  const headerRow = grid.find((r) => r.every((c) => c.header))
    ?? (grid[0]?.some((c) => c.header) ? grid[0] : null)
  return {
    caption: caption ? textContent(caption).replace(/\s+/g, ' ').trim() : null,
    headers: headerRow ? headerRow.map((c) => c.text) : [],
    rows: grid.filter((r) => r !== headerRow).map((r) => r.map((c) => c.text)),
  }
}
