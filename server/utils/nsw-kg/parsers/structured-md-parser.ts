// ── Structured Markdown → SectionTree ──────────────────────────────────
//
// Parses a markdown file with `# 1 PART NAME`, `## 1.2 Subpart`, etc. into
// a SectionTreeNode hierarchy. Used for all DCPs ingested via the NSW v2
// pipeline — the upstream PDF→MD converter (scripts/dcp-pdf-to-md.ts)
// produces per-page text blocks interleaved with two kinds of comment
// markers that this parser understands:
//
//   `<!-- SRC: file.pdf | PAGE: 12 -->`  — new, carries citation hotlink
//                                          metadata (source split file
//                                          + page number). First SRC
//                                          seen at or before a heading
//                                          is bound to that section.
//   `<!-- Page N -->`                     — legacy, from the old Albury
//                                          preprocessor. Stripped.
//
// Heading detection:
//   `# 1 INTRODUCTION TO THE DEVELOPMENT CONTROL PLAN`  → part   number=1
//   `## 5.2 TREE PRESERVATION ORDER`                    → clause number=5.2
//   `### 6.2.1 Flood Referral Areas`                    → clause number=6.2.1
//   `#### Objectives`                                   → clause heading=Objectives
//   `#### Controls`                                     → clause heading=Controls
//
// TOC duplicates: the first occurrence of each H1 is treated as a TOC
// entry (no body) and the second occurrence becomes the real Part section.
// We detect this by looking for an H1 with no real content between it and
// the next H1.

import type { SectionTreeNode, SectionLevel } from '../types'

interface RawHeading {
  line:        number
  depth:       number          // 1..6 from # count
  number:      string | null   // '5.2', '6.2.1', or null for textual headings
  title:       string          // 'TREE PRESERVATION ORDER' or 'Objectives'
  raw:         string          // original line
  source_file: string | null   // SRC marker in effect at this heading's line
  page:        number | null
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
// Section-number detection — accepts three forms:
//   Pure numeric:       "5.2 TREE PRESERVATION"            → "5.2"
//   Numeric with suffix:"10.4.2A Dwelling Setbacks"        → "10.4.2A"
//   Letter-prefixed:    "A1 About this DCP"                → "A1"
//                       "B2.10 Heritage Overlay"           → "B2.10"
// (Randwick DCP uses A1..F5 for Parts, with decimal sub-sections within.)
const NUMBERED_RE = /^([A-Z]?\d+(?:\.\d+)*[A-Z]?)\s+(.+)$/
const SRC_MARKER_RE = /^\s*<!--\s*SRC:\s*(.+?)\s*\|\s*PAGE:\s*(\d+)\s*-->\s*$/

export interface ParsedDocument {
  title: string
  tree: SectionTreeNode[]
}

export function parseStructuredMd(md: string, opts: { title: string }): ParsedDocument {
  const lines = md.split(/\r?\n/)
  const headings: RawHeading[] = []

  // ── Pass 1: walk lines once, tracking the active SRC marker and
  // collecting headings with the SRC state as-of their line. We scan the
  // whole file so that body extraction (Pass 3) can also use the same
  // line→(file, page) association if we ever need to reconstruct it.
  let currentFile: string | null = null
  let currentPage: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Update the active SRC marker if this line is one.
    const srcMatch = line.match(SRC_MARKER_RE)
    if (srcMatch) {
      currentFile = srcMatch[1]!.trim()
      currentPage = Number(srcMatch[2])
      continue
    }

    const m = line.match(HEADING_RE)
    if (!m) continue
    const depth = m[1]!.length
    const title = m[2]!.trim()
    const numMatch = title.match(NUMBERED_RE)
    headings.push({
      line:        i,
      depth,
      number:      numMatch?.[1] ?? null,
      title:       numMatch ? numMatch[2]!.trim() : title,
      raw:         line,
      source_file: currentFile,
      page:        currentPage,
    })
  }

  // ── Pass 2: collapse TOC duplicates ──────────────────────────────────
  // Strategy: if an H1 with the same number+title appears twice, keep only the
  // second occurrence (the real body — TOC always comes first).
  const seenH1 = new Map<string, number>() // key → first index
  const toDrop = new Set<number>()
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!
    if (h.depth !== 1) continue
    const key = `${h.number ?? ''}|${h.title}`
    if (seenH1.has(key)) {
      // Drop the FIRST occurrence (TOC)
      toDrop.add(seenH1.get(key)!)
      seenH1.set(key, i)   // remember the latest
    } else {
      seenH1.set(key, i)
    }
  }
  const filtered = headings.filter((_, i) => !toDrop.has(i))

  // ── Pass 3: extract body text per heading ────────────────────────────
  // Body of heading[i] = lines (heading[i].line+1 .. heading[i+1].line-1),
  // stripping comments (including SRC markers), image links, and
  // horizontal rules. Also returns the first SRC marker seen inside the
  // body so the section can be bound to a specific page.
  for (let i = 0; i < filtered.length; i++) {
    const startLine = filtered[i]!.line + 1
    const endLine = i + 1 < filtered.length ? filtered[i + 1]!.line : lines.length
    const extracted = extractBody(lines.slice(startLine, endLine))
    ;(filtered[i] as any).body = extracted.text
    ;(filtered[i] as any).bodySourceFile = extracted.source_file
    ;(filtered[i] as any).bodyPage = extracted.page
  }

  // ── Pass 4: build the tree from heading depths ───────────────────────
  // Each filtered heading becomes a SectionTreeNode. Parents are determined
  // by tracking the most recent heading at each depth.
  const tree: SectionTreeNode[] = []
  const stack: Array<{ depth: number; node: SectionTreeNode }> = []
  const localIdSeen = new Map<string, number>()    // for collision avoidance
  let sortOrder = 0

  for (const h of filtered) {
    let localId = buildLocalId(h)
    // Numbered headings can repeat within a DCP (e.g. two different "7.4"
    // sections). Append a #N suffix on collision so the unique constraint holds.
    const seenCount = localIdSeen.get(localId) ?? 0
    if (seenCount > 0) localId = `${localId}#${seenCount + 1}`
    localIdSeen.set(buildLocalId(h), seenCount + 1)

    // Prefer the SRC marker found INSIDE the body (first one wins) — that's
    // the earliest page containing actual section content. If the body has
    // no marker (e.g. purely structural headings like "#### Objectives"
    // whose body is empty), fall back to the SRC active at the heading line
    // itself. This gives every node a best-effort (file, page) hotlink.
    const bodyFile = (h as any).bodySourceFile as string | null
    const bodyPage = (h as any).bodyPage as number | null
    const source_file = bodyFile ?? h.source_file
    const page = bodyFile !== null ? bodyPage : h.page

    const node: SectionTreeNode = {
      local_id:    localId,
      level:       mapDepthToLevel(h.depth, h.number),
      number:      h.number,
      heading:     h.title,
      raw_text:    ((h as any).body as string) ?? '',
      depth:       h.depth,
      sort_order:  sortOrder++,
      children:    [],
      source_file,
      page,
    }
    // Pop the stack until we find a parent at strictly lower depth
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= h.depth) {
      stack.pop()
    }
    if (stack.length === 0) {
      tree.push(node)
    } else {
      stack[stack.length - 1]!.node.children.push(node)
    }
    stack.push({ depth: h.depth, node })
  }

  return { title: opts.title, tree }
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface ExtractedBody {
  text: string
  /** First `<!-- SRC: file.pdf | PAGE: N -->` marker seen in the body, or null. */
  source_file: string | null
  page: number | null
}

/** Strip structural markup from a section's body lines:
 *  - HTML comments (including SRC markers — but we record the first one)
 *  - Standalone image links like `![alt](images/foo.png)` from dcp-pdf-to-md
 *  - Horizontal rules (`---`), which the PDF converter emits as page separators
 *  Returns the cleaned text joined by newlines, plus the first SRC marker
 *  found inside the body (used to bind the section to a specific page). */
function extractBody(lines: string[]): ExtractedBody {
  const out: string[] = []
  let source_file: string | null = null
  let page: number | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Record the first SRC marker, then strip it
    if (source_file === null) {
      const srcMatch = trimmed.match(SRC_MARKER_RE)
      if (srcMatch) {
        source_file = srcMatch[1]!.trim()
        page = Number(srcMatch[2])
        continue
      }
    }

    // Strip any other HTML comment (subsequent SRC markers, legacy page
    // markers, DCP title comments)
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) continue
    // Strip horizontal rules (PDF page separators from dcp-pdf-to-md)
    if (/^---+$/.test(trimmed)) continue
    // Strip standalone markdown image links (the proof-of-coverage images
    // embedded by dcp-pdf-to-md). The LLM must never see these.
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) continue

    out.push(trimmed)
  }

  return { text: out.join('\n'), source_file, page }
}

function buildLocalId(h: RawHeading): string {
  if (h.number) return `dcp.${h.number}`
  // Numberless headings (like '#### Objectives' or '#### Controls') need a
  // unique id — use the line number to disambiguate.
  const slug = h.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
  return `dcp.h${h.depth}.${h.line}.${slug}`
}

function mapDepthToLevel(depth: number, number: string | null): SectionLevel {
  // # = part, ## / ### / #### with a number = clause, #### without = paragraph
  if (depth === 1) return 'part'
  if (number) return 'clause'
  return 'paragraph'
}

// ── Tree flattening — same shape as nsw-xml-parser exports ───────────────

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
