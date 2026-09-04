// ── NSW PCO XML → SectionTree ───────────────────────────────────────────
//
// Parses the in-house NSW Parliamentary Counsel XML format used for LEPs
// and SEPPs into a generic SectionTreeNode structure.
//
// Schema observations (reverse-engineered from epi-2010-0433.xml and
// epi-2021-0714_2026-03-23.xml):
//
//   <exdoc id="epi-XXXX-XXXX" title="...">
//     <metadata>...</metadata>
//     <parentattributes>...</parentattributes>
//     <level type="part" id="pt.1">
//       <head><no>Part 1</no><heading>Preliminary</heading></head>
//       <level type="clause" id="sec.1.1">
//         <head><no>1.1</no><heading>Name of Plan</heading></head>
//         <block><txt>This Plan is ...</txt></block>
//       </level>
//       <level type="clause" id="sec.1.2">
//         <head><no>1.2</no><heading>Aims of Plan</heading></head>
//         <tier type="subclause" id="sec.1.2-ssec.1">
//           <head><no>(1)</no></head>
//           <block><txt>This Plan aims to ...</txt></block>
//         </tier>
//         <tier type="subclause" id="sec.1.2-ssec.2">
//           <head><no>(2)</no></head>
//           <block>
//             <txt>The particular aims ...</txt>
//             <list>
//               <li id="sec.1.2-ssec.2-para1.aa"><no>(aa)</no>
//                 <block><txt>...</txt></block>
//               </li>
//               ...
//             </list>
//           </block>
//         </tier>
//       </level>
//     </level>
//     <level type="schedule" id="sch.1">...</level>
//     <level type="dictionary" id="dict">...</level>
//   </exdoc>
//
// Both <level> and <tier> are structural containers. <li> elements inside
// <list> become "paragraph" sections.

import { DOMParser } from '@xmldom/xmldom'
import type { SectionTreeNode, SectionLevel } from '../types'

// ── Mapping XML type → our SectionLevel enum ────────────────────────────

const TYPE_MAP: Record<string, SectionLevel> = {
  chapter:     'chapter',
  part:        'part',
  division:    'division',
  subdivision: 'subdivision',
  clause:      'clause',
  subclause:   'subclause',
  paragraph:   'paragraph',
  schedule:    'schedule',
  dictionary:  'dictionary',
  appendix:    'appendix',
}

// ── Document-level metadata extracted from <exdoc> attributes ────────────

export interface ParsedDocument {
  id:         string                  // exdoc/@id e.g. 'epi-2010-0433'
  title:      string                  // exdoc/@title
  year:       string | null
  number:     string | null
  enacted:    string | null
  publication_date: string | null
  consolidation_id: string | null
  tree:       SectionTreeNode[]       // top-level children (Parts, Schedules, Dictionary)
}

// ── Public entry point ──────────────────────────────────────────────────

export function parseNswXml(xml: string): ParsedDocument {
  const dom = new DOMParser().parseFromString(xml, 'text/xml')

  const exdoc = dom.getElementsByTagName('exdoc')[0] as any
  if (!exdoc) throw new Error('parseNswXml: no <exdoc> root element found')

  const id    = exdoc.getAttribute('id') || ''
  const title = exdoc.getAttribute('title') || ''

  // Pull a few useful metadata fields
  const consolidation_id = getMetacontent(dom, 'last.consol.amend.id')
  const publication_date = getMetacontent(dom, 'publication.date')
  const year             = exdoc.getAttribute('year') || null
  const number           = exdoc.getAttribute('number') || null
  const enacted          = exdoc.getAttribute('enact.or.made.date') || null

  // Walk the structural tree. Structural elements live inside one or more
  // <content> wrappers under <exdoc>:
  //   <content type="body">       — Parts (LEP) or Chapters (SEPP)
  //   <content type="schedules">  — Schedules + Dictionary (LEP)
  //   <content type="coverdata">  — skip
  //   <content type="historynote">— skip
  //   <content type="auto-inserted"> — skip (boundary markers)
  //
  // Within those, we look for <level> elements at any depth.
  let sortOrder = { value: 0 }
  const tree: SectionTreeNode[] = []
  for (const content of childElements(exdoc)) {
    if (content.tagName !== 'content') continue
    const ctype = content.getAttribute('type')
    if (ctype !== 'body' && ctype !== 'schedules') continue
    for (const node of childElements(content)) {
      if (node.tagName !== 'level') continue
      const built = buildNode(node, 1, sortOrder, tree)
      if (built) tree.push(built)
    }
  }

  return {
    id, title,
    year, number, enacted,
    publication_date,
    consolidation_id,
    tree,
  }
}

// ── Recursive node builder ──────────────────────────────────────────────

function buildNode(el: any, depth: number, sortOrder: { value: number }, parentChildren?: SectionTreeNode[]): SectionTreeNode | null {
  const xmlType = el.getAttribute('type') || ''
  const level = TYPE_MAP[xmlType]
  if (!level) {
    // Unknown structural type (e.g. <level type="clausegroup">) — transparent
    // wrapper. Recurse into children and append them to the parent's children
    // array directly.
    if (parentChildren) {
      for (const child of childElements(el)) {
        if (child.tagName === 'level' || child.tagName === 'tier') {
          const sub = buildNode(child, depth, sortOrder, parentChildren)
          if (sub) parentChildren.push(sub)
        }
      }
    }
    return null
  }

  const localId = el.getAttribute('id') || `unknown.${sortOrder.value}`
  const headEl  = firstChildByTag(el, 'head')
  const number  = headEl ? textContent(firstChildByTag(headEl, 'no')) : null
  const heading = headEl ? textContent(firstChildByTag(headEl, 'heading')) : null

  const node: SectionTreeNode = {
    local_id:    localId,
    level,
    number:      number ? cleanNumber(number) : null,
    heading:     heading ? heading.trim() : null,
    raw_text:    '',
    depth,
    sort_order:  sortOrder.value++,
    children:    [],
    // Legislation (LEP/SEPP) ingested from XML has no split-PDF source —
    // citations use document.source_url + section.local_id instead.
    source_file: null,
    page:        null,
  }

  // Walk direct children for sub-structures and body content.
  // We need to recurse into:
  //   - <level type="..."> nested levels (parts→clauses, etc.)
  //   - <tier type="subclause"> sub-tiers
  //   - <block> containers — extract text content + nested <list><li>
  //   - <list><li> children become 'paragraph' nodes
  for (const child of childElements(el)) {
    const tag = child.tagName

    if (tag === 'level' || tag === 'tier') {
      const sub = buildNode(child, depth + 1, sortOrder, node.children)
      if (sub) node.children.push(sub)
      continue
    }

    if (tag === 'block') {
      // A direct body block of this level. Extract the text content (this also
      // descends into nested <list><li> if present).
      const { text, listItems } = extractBlock(child, depth + 1, sortOrder)
      if (text) {
        node.raw_text = node.raw_text ? `${node.raw_text}\n\n${text}` : text
      }
      // <list><li> items become paragraph children
      for (const para of listItems) node.children.push(para)
      continue
    }

    // Structural wrappers that carry no meaning of their own but hold half
    // the document beneath them. Skipping these dropped 50% of Hornsby's
    // structural elements and 73% of its text:
    //
    //   <content type="auto-inserted">  54 in Hornsby, 10 under a
    //     <level type="schedule">. This is why Schedule 1 "Additional
    //     permitted uses" parsed with zero children - every item sits inside
    //     one. It also held the entire Land Use Table (23 clausegroups ->
    //     92 clauses of permitted/prohibited uses per zone) and Parts 7-8.
    //   <pre type="auto-inserted">     24 in Hornsby, wrapping 29 subclauses
    //     including cl 4.4(1)-(2), the operative floor space ratio control.
    //
    // They are transparent: recurse through them so the tree keeps the shape
    // of the document rather than gaining a phantom level.
    if (tag === 'content' || tag === 'pre' || tag === 'post') {
      for (const inner of childElements(child)) {
        const innerTag = inner.tagName
        if (innerTag === 'level' || innerTag === 'tier') {
          const sub = buildNode(inner, depth + 1, sortOrder, node.children)
          if (sub) node.children.push(sub)
        } else if (innerTag === 'block') {
          const r = extractBlock(inner, depth + 1, sortOrder)
          if (r.text) {
            node.raw_text = node.raw_text
              ? `${node.raw_text}\n\n${r.text}`
              : r.text
          }
          for (const para of r.listItems) node.children.push(para)
        }
      }
      continue
    }

    // A <note> hanging directly off a level or tier rather than inside a
    // <block>. Schedule 2 "Exempt development" is built entirely of these,
    // so it parsed empty even with the wrapper fix above.
    if (tag === 'note') {
      const t = textContent(child).trim()
      if (t) {
        node.raw_text = node.raw_text
          ? `${node.raw_text}\n\n${t}`
          : t
      }
      continue
    }

    // Skip head, parentattributes, list inside head, etc.
  }

  return node
}

// ── Block / list extraction ─────────────────────────────────────────────

function extractBlock(blockEl: any, depth: number, sortOrder: { value: number }): {
  text: string
  listItems: SectionTreeNode[]
} {
  let textParts: string[] = []
  const listItems: SectionTreeNode[] = []

  for (const child of childElements(blockEl)) {
    const tag = child.tagName

    if (tag === 'txt') {
      const t = textContent(child).trim()
      if (t) textParts.push(t)
      continue
    }

    if (tag === 'list') {
      for (const li of childElements(child)) {
        if (li.tagName !== 'li') continue
        const para = buildParagraph(li, depth, sortOrder)
        if (para) listItems.push(para)
      }
      continue
    }

    if (tag === 'block') {
      // Nested block — recurse
      const inner = extractBlock(child, depth, sortOrder)
      if (inner.text) textParts.push(inner.text)
      listItems.push(...inner.listItems)
      continue
    }

    // Text-only capture for containers we do not model structurally.
    //
    // The comment here used to list <table> among them, but the condition
    // omitted it, so 12 tables and 75,002 characters were dropped from
    // Hornsby alone - Schedule 5 Environmental heritage (51,077 ch), the
    // cl 6.1 acid sulfate soils class table, and the cl 4.4(2A) floor space
    // ratio area table among them.
    //
    // <deflist> is the Dictionary: 453 defined terms, 108,821 characters,
    // none of which reached the graph. Flattening both to text is a stopgap.
    // Tables belong in nsw.section_table, which exists and is populated by
    // the DCP path but has no writer on the XML path; the Dictionary's terms
    // deserve their own nodes rather than one flat blob.
    if (tag === 'note' || tag === 'example' || tag === 'editorial'
        || tag === 'table' || tag === 'deflist') {
      const t = textContent(child).trim()
      if (t) textParts.push(t)
    }
  }

  return { text: textParts.join('\n'), listItems }
}

function buildParagraph(li: any, depth: number, sortOrder: { value: number }): SectionTreeNode | null {
  const localId = li.getAttribute('id') || `para.${sortOrder.value}`
  const noEl = firstChildByTag(li, 'no')
  const number = noEl ? textContent(noEl) : null

  const node: SectionTreeNode = {
    local_id:    localId,
    level:       'paragraph',
    number:      number ? cleanNumber(number) : null,
    heading:     null,
    raw_text:    '',
    depth,
    sort_order:  sortOrder.value++,
    children:    [],
    source_file: null,
    page:        null,
  }

  // Extract text from any <block> inside the <li>
  for (const child of childElements(li)) {
    if (child.tagName === 'block') {
      const { text, listItems } = extractBlock(child, depth + 1, sortOrder)
      if (text) node.raw_text = node.raw_text ? `${node.raw_text}\n\n${text}` : text
      for (const para of listItems) node.children.push(para)
    }
  }

  return node
}

// ── DOM helpers ─────────────────────────────────────────────────────────

function* childElements(el: any): Generator<any> {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i]
    if (c.nodeType === 1) yield c   // ELEMENT_NODE
  }
}

function firstChildByTag(el: any, tag: string): any | null {
  if (!el) return null
  for (const c of childElements(el)) {
    if (c.tagName === tag) return c
  }
  return null
}

function textContent(el: any): string {
  if (!el) return ''
  // Walk all descendant text nodes, joining with single spaces.
  // This collapses <txt>This is <i>important</i></txt> into "This is important"
  // and works across the inline <name>, <legref>, <extref>, <i>, <b> elements.
  const parts: string[] = []
  const stack: any[] = [el]
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue
    if (node.nodeType === 3) {
      // TEXT_NODE
      parts.push(node.nodeValue || '')
    } else if (node.nodeType === 1) {
      // ELEMENT_NODE — push children in reverse so iteration order is preserved
      const kids = node.childNodes
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function getMetacontent(dom: any, className: string): string | null {
  const metas = dom.getElementsByTagName('metacontent')
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i] as any
    if (m.getAttribute('class') === className) {
      const t = textContent(m)
      return t || null
    }
  }
  return null
}

function cleanNumber(n: string): string {
  // "Part 1" → "1", "Chapter 1" → "1", "Schedule 1" → "1", "Division 2" → "2"
  // "1.1" → "1.1", "(1)" → "(1)", "(aa)" → "(aa)"
  return n
    .replace(/^Part\s+/i, '')
    .replace(/^Chapter\s+/i, '')
    .replace(/^Schedule\s+/i, '')
    .replace(/^Division\s+/i, '')
    .replace(/^Subdivision\s+/i, '')
    .trim()
}

// ── Tree flattening for DB insert ───────────────────────────────────────

export interface FlatSection {
  local_id:    string
  parent_local_id: string | null
  level:       SectionLevel
  number:      string | null
  heading:     string | null
  raw_text:    string
  depth:       number
  sort_order:  number
  source_file: string | null
  page:        number | null
}

/** Walk the tree depth-first and produce a flat array of sections with
 *  parent_local_id pointers (so the upserter can resolve to UUIDs). */
export function flattenTree(tree: SectionTreeNode[]): FlatSection[] {
  const out: FlatSection[] = []
  const walk = (nodes: SectionTreeNode[], parent: string | null) => {
    for (const n of nodes) {
      out.push({
        local_id:        n.local_id,
        parent_local_id: parent,
        level:           n.level,
        number:          n.number,
        heading:         n.heading,
        raw_text:        n.raw_text,
        depth:           n.depth,
        sort_order:      n.sort_order,
        source_file:     n.source_file,
        page:            n.page,
      })
      if (n.children.length) walk(n.children, n.local_id)
    }
  }
  walk(tree, null)
  return out
}

/** Count leaf clauses (clauses, subclauses, paragraphs with non-empty raw_text)
 *  for progress reporting. */
export function countLeafClauses(tree: SectionTreeNode[]): number {
  let count = 0
  const walk = (nodes: SectionTreeNode[]) => {
    for (const n of nodes) {
      if (n.raw_text && n.raw_text.length > 0) count++
      if (n.children.length) walk(n.children)
    }
  }
  walk(tree)
  return count
}
