// ── Structured Markdown → SectionTree ──────────────────────────────────
//
// Parses a DCP converted from PDF into a SectionTreeNode hierarchy.
//
// WHY THIS DOES NOT USE HEADING DEPTH
// -----------------------------------
// Docling emits every heading at the same level. Randwick's DCP has 3,422
// headings and all of them are `##` — zero `#`, zero `###`. Building the
// tree by counting hash marks therefore produces 3,422 flat siblings and
// destroys the document structure entirely.
//
// The hierarchy is instead recovered from the *numbering inside the heading
// text*, which the DCP itself uses as its address scheme. Randwick's own
// cross-references read:
//
//     "(see Section C1 Low Density Residential: 3.3.2 Side Setbacks)"
//
// so a citation path of part → clause → rubric is the document's native
// convention, not one we invented.
//
// BLOCK KINDS
// -----------
// NSW DCPs divide each numbered clause into an unnumbered rubric —
// Objectives / Explanation / Controls / Note — and only Controls is
// enforceable. Those rubric headings are 68% of all headings here, and
// without classification the decomposer treats background prose as binding.
//
//     ## 3.3.2. Side setbacks          → clause
//     ## Controls                      → rubric   (binding)
//     ## Residential flat buildings    → scope    (narrows Controls)
//     ## Note:                         → rubric   (not binding)
//     ## 3.3.3. Rear setbacks          → clause
//
// `rubric` is inherited down the subtree, so a scope block under Controls
// reports rubric='controls'. Stage 1 filters on it.

import type { SectionTreeNode, SectionLevel, BlockKind, Rubric } from '../types'

interface RawHeading {
  line:        number
  hashDepth:   number          // # count — retained for diagnostics only
  number:      string | null   // '3.3.2', 'C1', 'B2.10'
  title:       string
  raw:         string
  source_file: string | null
  page:        number | null

  // filled in by later passes
  body?:            string
  bodySourceFile?:  string | null
  bodyPage?:        number | null
  blockKind?:       BlockKind
  rubric?:          Rubric | null
  segments?:        string[]
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
const SRC_MARKER_RE = /^\s*<!--\s*SRC:\s*(.+?)\s*\|\s*PAGE:\s*(\d+)\s*-->\s*$/

// Section-number detection. Three accepted forms:
//   Pure numeric        "3.3.2. Side setbacks"        → "3.3.2"
//   Numeric with suffix "10.4.2A Dwelling Setbacks"   → "10.4.2A"
//   Letter-prefixed     "C1 Low Density Residential"  → "C1"
//                       "B2.10 Heritage Overlay"      → "B2.10"
// A trailing dot after the number is common in Docling output and is eaten.
const NUMBERED_RE = /^([A-Z]?\d+(?:\.\d+)*[A-Z]?)\.?\s+(.+)$/

// Bare letter part codes ("B General Controls"). Deliberately narrow: a
// single A–F followed by a short Title Case heading. Without the length and
// case guards this matches ordinary prose headings that happen to start
// with "A ", e.g. "A minimum of 25% of the front setback...".
const BARE_PART_RE = /^([A-F])\s+([A-Z][^.]{0,60})$/

/** Rubric lexicon. Matched against a normalised heading (lowercased,
 *  trailing punctuation and numbering stripped) so "Note 1:", "Notes" and
 *  "Note:" all land on 'note'. */
const RUBRIC_LEXICON: Array<[RegExp, Rubric]> = [
  [/^objectives?$/,                        'objectives'],
  [/^explanations?$/,                      'explanation'],
  [/^controls?$/,                          'controls'],
  [/^(performance )?requirements?$/,       'requirements'],
  [/^provisions?$/,                        'controls'],
  [/^notes?( \d+)?$/,                      'note'],
  [/^(background|commentary|introduction)$/, 'background'],
]

function normaliseHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:.–—-]+\s*$/, '')   // trailing punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

function matchRubric(title: string): Rubric | null {
  const n = normaliseHeading(title)
  for (const [re, rubric] of RUBRIC_LEXICON) {
    if (re.test(n)) return rubric
  }
  return null
}

/** Split a section number into hierarchy segments.
 *  '3.3.2' → ['3','3','2']   'C1' → ['C1']   'B2.10' → ['B2','10'] */
function toSegments(num: string): string[] {
  return num.split('.').filter(Boolean)
}

/** A part code detectable from a heading alone.
 *
 *  Deliberately limited to bare single letters. Letter+digit codes ('C1',
 *  'K1', 'S3') are NOT treated as parts: in Randwick every such heading is
 *  a zone code or a site name appearing in body content — "C1 Carpark Site"
 *  is not part C1, which is "Low Density Residential". Guessing produced
 *  six parts of which six were wrong, so we no longer guess.
 *
 *  Real part identity comes from the file the section was converted from
 *  (councils publish DCPs as one PDF per part) and is supplied by the
 *  caller via `opts.part`. Randwick's merged markdown carries a usable part
 *  heading for only 4 of its parts, and no other DCP in the library carries
 *  one at all. */
function isPartNumber(num: string): boolean {
  return /^[A-F]$/.test(num)
}

export interface ParsedDocument {
  title: string
  tree: SectionTreeNode[]
}

export interface ParseStats {
  headings:   number
  parts:      number
  clauses:    number
  rubrics:    number
  scopes:     number
  tocDropped: number
  maxDepth:   number
  rootNodes:  number
}

export interface ParseOptions {
  title: string
  /** Part code this markdown belongs to, e.g. 'C1'. Councils publish DCPs
   *  as one PDF per part, so this normally comes from the source filename.
   *  When supplied it wins over anything detected in the headings — the
   *  file knows what part it is and the prose does not. */
  part?: string
  /** Human name for the part, e.g. 'Low Density Residential'. */
  partTitle?: string
  onStats?: (s: ParseStats) => void
}

export function parseStructuredMd(md: string, opts: ParseOptions): ParsedDocument {
  const lines = md.split(/\r?\n/)

  // ── Pass 1: collect headings, tracking the active SRC marker ─────────
  const headings: RawHeading[] = []
  let currentFile: string | null = null
  let currentPage: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const srcMatch = line.match(SRC_MARKER_RE)
    if (srcMatch) {
      currentFile = srcMatch[1]!.trim()
      currentPage = Number(srcMatch[2])
      continue
    }

    const m = line.match(HEADING_RE)
    if (!m) continue
    const hashDepth = m[1]!.length
    const title = m[2]!.trim()

    const numMatch = title.match(NUMBERED_RE)
    const bareMatch = numMatch ? null : title.match(BARE_PART_RE)

    headings.push({
      line:        i,
      hashDepth,
      number:      numMatch?.[1] ?? bareMatch?.[1] ?? null,
      title:       (numMatch?.[2] ?? bareMatch?.[2] ?? title).trim(),
      raw:         line,
      source_file: currentFile,
      page:        currentPage,
    })
  }

  // ── Pass 2: extract body text per heading ────────────────────────────
  for (let i = 0; i < headings.length; i++) {
    const startLine = headings[i]!.line + 1
    const endLine = i + 1 < headings.length ? headings[i + 1]!.line : lines.length
    const extracted = extractBody(lines.slice(startLine, endLine))
    headings[i]!.body = extracted.text
    headings[i]!.bodySourceFile = extracted.source_file
    headings[i]!.bodyPage = extracted.page
  }

  // ── Pass 3: drop table-of-contents entries ───────────────────────────
  // A TOC entry is a numbered heading with an empty body whose exact
  // number+title recurs later in the document with real content. The old
  // parser only checked H1s, which never fires on an all-`##` file.
  const lastRealIndex = new Map<string, number>()
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!
    if (!h.number) continue
    if ((h.body ?? '').length > 0) lastRealIndex.set(`${h.number}|${h.title}`, i)
  }
  const toDrop = new Set<number>()
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]!
    if (!h.number) continue
    if ((h.body ?? '').length > 0) continue
    const later = lastRealIndex.get(`${h.number}|${h.title}`)
    if (later !== undefined && later > i) toDrop.add(i)
  }
  const filtered = headings.filter((_, i) => !toDrop.has(i))

  // ── Pass 4: classify every heading ───────────────────────────────────
  for (const h of filtered) {
    if (h.number) {
      // When the caller has declared the part, this markdown *is* one part
      // and nothing inside it can open another.
      h.blockKind = (!opts.part && isPartNumber(h.number)) ? 'part' : 'clause'
      h.segments = toSegments(h.number)
      h.rubric = null
      continue
    }
    const rubric = matchRubric(h.title)
    if (rubric) {
      h.blockKind = 'rubric'
      h.rubric = rubric
    } else {
      h.blockKind = 'scope'
      h.rubric = null      // resolved by inheritance during the tree build
    }
  }

  // ── Pass 5: build the tree from numbering, not hash depth ────────────
  const tree: SectionTreeNode[] = []
  const localIdSeen = new Map<string, number>()
  let sortOrder = 0

  // Clause stack: entries carry their numbering segments so a clause finds
  // its parent by longest-common-prefix rather than by heading depth.
  let clauseStack: Array<{ segments: string[]; node: SectionTreeNode }> = []
  let currentPartNode: SectionTreeNode | null = null
  let currentPart: string | null = null
  let currentRubricNode: SectionTreeNode | null = null
  let currentRubric: Rubric | null = null
  let stats: ParseStats = {
    headings: filtered.length, parts: 0, clauses: 0, rubrics: 0,
    scopes: 0, tocDropped: toDrop.size, maxDepth: 0, rootNodes: 0,
  }

  // A caller-declared part becomes a synthetic root that every clause hangs
  // under, so citation paths read "C1 Low Density Residential > 3.3.2 > ..."
  // even though the markdown itself never names the part.
  if (opts.part) {
    currentPart = opts.part
    currentPartNode = {
      local_id:   `dcp.${opts.part}`,
      level:      'part',
      number:     opts.part,
      heading:    opts.partTitle ?? opts.title,
      raw_text:   '',
      depth:      0,
      sort_order: sortOrder++,
      children:   [],
      source_file: null,
      page:        null,
      block_kind:  'part',
      rubric:      null,
      scope_label: null,
      part:        opts.part,
    }
    tree.push(currentPartNode)
    localIdSeen.set(currentPartNode.local_id, 1)
    stats.parts++
  }

  const attach = (node: SectionTreeNode, parent: SectionTreeNode | null) => {
    if (parent) parent.children.push(node)
    else tree.push(node)
  }

  const uniqueLocalId = (base: string): string => {
    const seen = localIdSeen.get(base) ?? 0
    localIdSeen.set(base, seen + 1)
    return seen === 0 ? base : `${base}#${seen + 1}`
  }

  for (const h of filtered) {
    const bodyFile = h.bodySourceFile ?? null
    const source_file = bodyFile ?? h.source_file
    const page = bodyFile !== null ? (h.bodyPage ?? null) : h.page

    let parent: SectionTreeNode | null = null
    let localIdBase: string
    let depth: number
    let level: SectionLevel
    let rubric: Rubric | null = null
    let scopeLabel: string | null = null

    if (h.blockKind === 'part') {
      clauseStack = []
      currentRubricNode = null
      currentRubric = null
      currentPart = h.number
      parent = null
      localIdBase = `dcp.${h.number}`
      depth = 0
      level = 'part'
      stats.parts++
    } else if (h.blockKind === 'clause') {
      const segs = h.segments!
      // Pop clauses that are not an ancestor of this one.
      while (clauseStack.length > 0 && !isPrefix(clauseStack[clauseStack.length - 1]!.segments, segs)) {
        clauseStack.pop()
      }
      currentRubricNode = null
      currentRubric = null
      parent = clauseStack.length > 0
        ? clauseStack[clauseStack.length - 1]!.node
        : currentPartNode
      localIdBase = currentPart ? `dcp.${currentPart}.${segs.join('.')}` : `dcp.${segs.join('.')}`
      depth = (currentPartNode ? 1 : 0) + segs.length - 1
      level = segs.length >= 3 ? 'subclause' : 'clause'
      stats.clauses++
    } else if (h.blockKind === 'rubric') {
      parent = clauseStack.length > 0
        ? clauseStack[clauseStack.length - 1]!.node
        : currentPartNode
      const parentId = parent?.local_id ?? `dcp.${currentPart ?? 'root'}`
      localIdBase = `${parentId}/${h.rubric}`
      depth = (parent?.depth ?? 0) + 1
      level = 'paragraph'
      rubric = h.rubric ?? null
      stats.rubrics++
    } else {
      // scope — narrows the active rubric, or hangs off the clause when the
      // document opened a sub-block without a rubric heading first.
      parent = currentRubricNode
        ?? (clauseStack.length > 0 ? clauseStack[clauseStack.length - 1]!.node : currentPartNode)
      const parentId = parent?.local_id ?? `dcp.${currentPart ?? 'root'}`
      localIdBase = `${parentId}/${slug(h.title)}`
      depth = (parent?.depth ?? 0) + 1
      level = 'paragraph'
      rubric = currentRubric          // inherited
      scopeLabel = h.title
      stats.scopes++
    }

    const node: SectionTreeNode = {
      local_id:    uniqueLocalId(localIdBase),
      level,
      number:      h.number,
      heading:     h.title,
      raw_text:    h.body ?? '',
      depth,
      sort_order:  sortOrder++,
      children:    [],
      source_file,
      page,
      block_kind:  h.blockKind,
      rubric,
      scope_label: scopeLabel,
      part:        currentPart,
    }

    attach(node, parent)
    if (depth > stats.maxDepth) stats.maxDepth = depth

    if (h.blockKind === 'part') currentPartNode = node
    else if (h.blockKind === 'clause') clauseStack.push({ segments: h.segments!, node })
    else if (h.blockKind === 'rubric') { currentRubricNode = node; currentRubric = h.rubric ?? null }
  }

  stats.rootNodes = tree.length
  opts.onStats?.(stats)

  return { title: opts.title, tree }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** True when `a` is a proper ancestor path of `b` — ['3','3'] of ['3','3','2']. */
function isPrefix(a: string[], b: string[]): boolean {
  if (a.length >= b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'block'
}

interface ExtractedBody {
  text: string
  source_file: string | null
  page: number | null
}

/** Strip structural markup from a section's body lines:
 *  - HTML comments (including SRC markers — the first one is recorded)
 *  - Standalone image links emitted by dcp-pdf-to-md
 *  - Horizontal rules, which the converter emits as page separators
 *  The LLM must never see image markup. */
function extractBody(lines: string[]): ExtractedBody {
  const out: string[] = []
  let source_file: string | null = null
  let page: number | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (source_file === null) {
      const srcMatch = trimmed.match(SRC_MARKER_RE)
      if (srcMatch) {
        source_file = srcMatch[1]!.trim()
        page = Number(srcMatch[2])
        continue
      }
    }

    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) continue
    if (/^---+$/.test(trimmed)) continue
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) continue

    out.push(trimmed)
  }

  return { text: out.join('\n'), source_file, page }
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
  block_kind?: BlockKind
  rubric?:     Rubric | null
  scope_label?: string | null
  part?:       string | null
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
        block_kind:      n.block_kind,
        rubric:          n.rubric,
        scope_label:     n.scope_label,
        part:            n.part,
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

/** Sections that carry binding obligations — the only ones Stage 1 should
 *  decompose into propositions. Objectives and Explanation are merit
 *  context; Note is explicitly non-binding. */
export function bindingSections(flat: FlatSection[]): FlatSection[] {
  return flat.filter(
    (s) => (s.rubric === 'controls' || s.rubric === 'requirements') && s.raw_text.length > 0,
  )
}

/** Citation path in the DCP's own address format:
 *  "C1 Low Density Residential > 3.3.2 > Controls (page 24)" */
export function citationPath(flat: FlatSection[], localId: string): string | null {
  const byId = new Map(flat.map((s) => [s.local_id, s]))
  const node = byId.get(localId)
  if (!node) return null

  const chain: FlatSection[] = []
  let cur: FlatSection | undefined = node
  while (cur) {
    chain.unshift(cur)
    cur = cur.parent_local_id ? byId.get(cur.parent_local_id) : undefined
  }

  const parts = chain.map((s) => {
    if (s.block_kind === 'part') return `${s.number} ${s.heading}`
    if (s.block_kind === 'clause') return s.number ?? s.heading ?? ''
    return s.heading ?? ''
  }).filter(Boolean)

  const path = parts.join(' > ')
  return node.page !== null ? `${path} (page ${node.page})` : path
}
