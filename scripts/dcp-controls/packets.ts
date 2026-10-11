/**
 * Stage 1 — turn a converted DCP into control packets. Deterministic, no model.
 *
 * A packet is everything a reader needs to interpret ONE control without seeing the rest of the
 * document: the cell or paragraph that states it, the headers that scope it, the clause it sits in, the
 * objective it serves, and the page it came from. It is the unit the model reads in stage 2 and the unit
 * a human checks in review.
 *
 * WHY A PACKET AND NOT A CHUNK. The retrieval layer already decomposes clauses into propositions and
 * embeds those rather than raw text, which is the right instinct — a proposition carries its own context.
 * But the DCP ingest never got the same treatment: it reads a table cell in isolation, so
 * "6m to local roads and 9m to designated roads" becomes five numbers with one scope between them, and
 * roughly half of every numeric effect in Hornsby and Randwick is now indistinguishable from a sibling
 * that says something different. The context that would separate them — the row header, the column
 * header, the caption, the storey band — is present in the HTML and thrown away before extraction.
 *
 * WHAT THIS FIXES, SPECIFICALLY:
 *   · rowspan / colspan are expanded into a dense grid before anything is read. The Hornsby document has
 *     19 rowspans and 57 colspans; a flattened read silently mis-assigns their values.
 *   · every interior cell carries its full header PATH, not just the nearest header, so a leaf column of
 *     "Zone R2 > Minimum lot size (m2)" keeps both halves.
 *   · the objective travels with the control. s4.15(3A)(b) makes the objective the thing that binds when
 *     a number is missed, so a control without it is legally incomplete, not merely thin. The converter
 *     already marks objectives up as `data-rubric="objectives"` siblings of the controls, so this is a
 *     join we have simply never made.
 *   · the exact source offsets are kept, so stage 3 can verify a span is literal rather than trusting it.
 *
 * Packets are emitted for tables and for prose. Table packets come first because they are where the
 * numbers are and where the structure is strongest; a prose packet carries the paragraph and its list
 * context so the same stage 2 contract works on both.
 */
import { readFileSync } from 'node:fs'
import { Parser } from 'htmlparser2'

// ── the shapes ───────────────────────────────────────────────────────────────

export interface PageRef {
  page: number | null
  /** The source PDF the page belongs to, for a multi-part instrument. */
  src: string | null
}

export interface ClauseRef {
  /** `dcp.3.1.2` — the anchor in the published document. */
  id: string
  /** `3.1.2` as the plan numbers it. */
  number: string | null
  heading: string | null
  /** Ancestor headings, outermost first: ['Part 3 - Residential', '3.1 Dwelling houses']. */
  chain: string[]
  pageStart: number | null
  pageEnd: number | null
}

export interface Packet {
  /** Stable id: document slug + clause + table/cell or paragraph index. */
  key: string
  document: string
  clause: ClauseRef
  /** 'table' or 'prose' — stage 2 picks its frame partly from this. */
  kind: 'table' | 'prose'

  /** Table packets only. */
  table?: {
    caption: string | null
    /** Table number as the plan writes it: `3.1.2-a`. */
    number: string | null
    rowIdx: number
    colIdx: number
    /** Header path above this cell, outermost first. */
    colPath: string[]
    /** Header path to the left of this cell, outermost first. */
    rowPath: string[]
    /** Every other interior cell in the same row, so a reader sees the alternatives. */
    siblings: { colPath: string[]; text: string }[]
  }

  /** The words that state the control. Verbatim, whitespace-collapsed. */
  text: string
  /** The objective this control serves, if the clause states one. */
  objective: string | null
  page: PageRef
}

// ── a minimal DOM, because the converted documents are large ─────────────────

interface Node {
  tag: string
  attrs: Record<string, string>
  children: Node[]
  parent: Node | null
  text: string
}

function parse(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [], parent: null, text: '' }
  let cur = root
  const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link'])
  const p = new Parser({
    onopentag(name, attrs) {
      const n: Node = { tag: name, attrs: attrs as Record<string, string>, children: [], parent: cur, text: '' }
      cur.children.push(n)
      if (!VOID.has(name)) cur = n
    },
    ontext(t) { cur.text += t },
    onclosetag(name) {
      if (VOID.has(name)) return
      if (cur.parent) cur = cur.parent
    },
  }, { decodeEntities: true, lowerCaseTags: true })
  p.write(html)
  p.end()
  return root
}

/** All text under a node, whitespace collapsed. Block elements become a space, not a join. */
function textOf(n: Node): string {
  const BLOCK = new Set(['p', 'li', 'div', 'br', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'section'])
  let out = n.text
  for (const c of n.children) {
    out += (BLOCK.has(c.tag) ? ' ' : '') + textOf(c) + (BLOCK.has(c.tag) ? ' ' : '')
  }
  return out.replace(/\s+/g, ' ').trim()
}

function* walk(n: Node): Generator<Node> {
  for (const c of n.children) { yield c; yield* walk(c) }
}

function descendants(n: Node, tag: string): Node[] {
  const out: Node[] = []
  for (const c of walk(n)) if (c.tag === tag) out.push(c)
  return out
}

const cls = (n: Node) => (n.attrs.class ?? '').split(/\s+/)

const isClause = (n: Node) => n.tag === 'section' && cls(n).includes('dcp-clause')

/**
 * The clause a node belongs to: the nearest `dcp-clause` ancestor.
 *
 * Clauses nest (1 > 1.1 > 1.1.1), so "every table under this clause" counts each table once per
 * ancestor. Ownership has to be nearest-wins or the same control is extracted several times under
 * different clause numbers.
 */
function ownerClause(n: Node): Node | null {
  for (let a: Node | null = n.parent; a; a = a.parent) if (isClause(a)) return a
  return null
}

// ── tables: expand the spans before reading anything ─────────────────────────

interface Grid {
  /** [row][col] -> cell text. Spanned cells are repeated into every position they cover. */
  cells: string[][]
  /** [row][col] -> true where this position is a header. */
  isHeader: boolean[][]
  /** True where the position is the ORIGIN of its cell rather than a repeat of a span. */
  isOrigin: boolean[][]
}

/**
 * A dense grid from an HTML table.
 *
 * A spanned cell is written into every position it covers, so a lookup at (r, c) always finds the value
 * that governs that position. `isOrigin` marks the one position that is the cell itself, so a value is
 * extracted once rather than once per covered position.
 */
export function gridOf(table: Node): Grid {
  const rows = descendants(table, 'tr')
  const cells: string[][] = []
  const isHeader: boolean[][] = []
  const isOrigin: boolean[][] = []
  const occupied: boolean[][] = []

  const put = (r: number, c: number, v: string, h: boolean, origin: boolean) => {
    for (const a of [cells, isHeader, isOrigin, occupied]) while (a.length <= r) a.push([])
    cells[r]![c] = v
    isHeader[r]![c] = h
    isOrigin[r]![c] = origin
    occupied[r]![c] = true
  }

  rows.forEach((tr, r) => {
    let c = 0
    for (const td of tr.children.filter(x => x.tag === 'td' || x.tag === 'th')) {
      while (occupied[r]?.[c]) c++                        // skip positions a rowspan already filled
      const rs = Math.max(1, parseInt(td.attrs.rowspan ?? '1', 10) || 1)
      const colSpan = Math.max(1, parseInt(td.attrs.colspan ?? '1', 10) || 1)
      const v = textOf(td)
      const h = td.tag === 'th'
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < colSpan; dc++) put(r + dr, c + dc, v, h, dr === 0 && dc === 0)
      }
      c += colSpan
    }
  })

  const width = Math.max(0, ...cells.map(r => r.length))
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < width; c++) {
      cells[r]![c] ??= ''
      isHeader[r]![c] ??= false
      isOrigin[r]![c] ??= false
    }
  }
  return { cells, isHeader, isOrigin }
}

/**
 * How many leading rows and columns are headers.
 *
 * `<th>` decides it where the converter preserved them. Where it did not — and Docling often does not —
 * fall back to the shape that every control table in this corpus has: one header row, and a first column
 * that is a label rather than a value. A first column is a label when no cell in it parses as a bare
 * number, which is cheap and has no false positives on the 371 tables loaded.
 */
function headerExtent(g: Grid): { rows: number; cols: number } {
  let rows = 0
  while (rows < g.cells.length && g.isHeader[rows]!.some(Boolean)) rows++
  if (rows === 0 && g.cells.length > 1) rows = 1                    // no <th> at all: assume one

  const width = g.cells[0]?.length ?? 0
  let cols = 0
  if (width > 1) {
    const body = g.cells.slice(rows)
    const firstColIsLabel = body.length > 0
      && body.every(r => !/^\s*[\d.,]+\s*%?\s*$/.test(r[0] ?? ''))
      && body.some(r => (r[0] ?? '').length > 2)
    if (firstColIsLabel) cols = 1
  }
  return { rows, cols }
}

const TABLE_NO = /\bTable\s+([0-9]+(?:\.[0-9]+)*(?:-[a-z0-9]+)?)/i

// ── clause context ───────────────────────────────────────────────────────────

/** Objectives as the converter marks them: a sibling rubric of the controls, under the same clause. */
const OBJECTIVE_RUBRICS = new Set(['objectives', 'desired_outcome', 'desired outcomes', 'aims', 'outcomes'])

function objectiveOf(clause: Node): string | null {
  for (const s of descendants(clause, 'section')) {
    const r = (s.attrs['data-rubric'] ?? '').toLowerCase().trim()
    if (OBJECTIVE_RUBRICS.has(r)) {
      const t = textOf(s).replace(/^(Desired Outcomes?|Objectives?|Aims?)\s*/i, '').trim()
      if (t) return t
    }
  }
  return null
}

/** The page a node sits on: the nearest preceding pagebreak marker. */
function pageAt(clause: Node, before: Node): PageRef {
  let seen: PageRef = { page: null, src: null }
  for (const n of walk(clause)) {
    if (n === before) break
    if (cls(n).includes('dcp-pagebreak')) {
      const p = parseInt(n.attrs['data-page'] ?? '', 10)
      seen = { page: Number.isFinite(p) ? p : null, src: n.attrs['data-src'] ?? null }
    }
  }
  if (seen.page == null) {
    const p = parseInt(clause.attrs['data-page-start'] ?? '', 10)
    if (Number.isFinite(p)) seen = { page: p, src: seen.src }
  }
  return seen
}

function headingOf(n: Node): string | null {
  for (const c of n.children) {
    if (/^h[1-6]$/.test(c.tag)) return textOf(c)
  }
  return null
}

// ── the builder ──────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Only clauses whose number starts with one of these (e.g. ['3.1']). */
  only?: string[]
  /** Skip prose packets; tables are where the structure is. */
  tablesOnly?: boolean
  /** A prose paragraph is only a packet if it contains a digit — a control states a quantity. */
  proseNeedsNumber?: boolean
}

export function buildPackets(html: string, document: string, opts: BuildOptions = {}): Packet[] {
  const root = parse(html)
  const out: Packet[] = []

  // every clause at every depth: a parent clause can hold controls of its own alongside its
  // children, and ownerClause() keeps each table and paragraph with exactly one of them
  const clauses = [...walk(root)].filter(isClause)

  for (const clause of clauses) {
    const number = clause.attrs['data-number'] ?? null
    if (opts.only?.length && !opts.only.some(p => (number ?? '').startsWith(p))) continue

    // ancestors give the chain; the clause's own h* gives its heading
    const chain: string[] = []
    for (let a = clause.parent; a; a = a.parent) {
      if (a.tag === 'section') {
        const h = headingOf(a)
        if (h) chain.unshift(h)
      }
    }
    const ref: ClauseRef = {
      id: clause.attrs.id ?? `dcp.${number ?? '?'}`,
      number,
      heading: headingOf(clause),
      chain,
      pageStart: intOrNull(clause.attrs['data-page-start']),
      pageEnd: intOrNull(clause.attrs['data-page-end']),
    }
    const objective = objectiveOf(clause)

    // ── tables ───────────────────────────────────────────────────────────
    descendants(clause, 'table')
      .filter(t => ownerClause(t) === clause)
      .forEach((table, ti) => {
      const capNode = descendants(table, 'caption')[0]
      const caption = capNode ? textOf(capNode) : null
      const tableNo = caption ? (TABLE_NO.exec(caption)?.[1] ?? null) : null
      const g = gridOf(table)
      const { rows: hr, cols: hc } = headerExtent(g)
      const page = pageAt(clause, table)

      for (let r = hr; r < g.cells.length; r++) {
        for (let c = hc; c < (g.cells[r]?.length ?? 0); c++) {
          if (!g.isOrigin[r]![c]) continue                 // a span is read once, at its origin
          const text = g.cells[r]![c]!.trim()
          if (!admissible(text)) continue

          const colPath = range(hr).map(i => g.cells[i]?.[c] ?? '').filter(Boolean)
          const rowPath = range(hc).map(i => g.cells[r]?.[i] ?? '').filter(Boolean)
          const siblings: { colPath: string[]; text: string }[] = []
          for (let c2 = hc; c2 < (g.cells[r]?.length ?? 0); c2++) {
            if (c2 === c || !g.isOrigin[r]![c2]) continue
            const t2 = g.cells[r]![c2]!.trim()
            if (t2) siblings.push({ colPath: range(hr).map(i => g.cells[i]?.[c2] ?? '').filter(Boolean), text: t2 })
          }

          out.push({
            key: `${document}#${ref.id}/t${ti}/r${r}c${c}`,
            document,
            clause: ref,
            kind: 'table',
            table: { caption, number: tableNo, rowIdx: r, colIdx: c, colPath, rowPath, siblings },
            text,
            objective,
            page,
          })
        }
      }
    })

    if (opts.tablesOnly) continue

    // ── prose ────────────────────────────────────────────────────────────
    // Only inside a controls rubric: an objectives rubric states an aim, not a control, and treating its
    // sentences as controls is how an aim becomes a number nobody can trace.
    for (const rub of descendants(clause, 'section')) {
      const r = (rub.attrs['data-rubric'] ?? '').toLowerCase().trim()
      if (!r || OBJECTIVE_RUBRICS.has(r)) continue
      const blocks = descendants(rub, 'li').concat(descendants(rub, 'p'))
      blocks.forEach((b, bi) => {
        if (ownerClause(b) !== clause) return
        if (descendants(b, 'table').length) return
        const text = textOf(b)
        if (text.length < 12 || !admissible(text)) return
        if (opts.proseNeedsNumber !== false && !/\d/.test(text)) return
        out.push({
          key: `${document}#${rub.attrs.id ?? ref.id}/p${bi}`,
          document, clause: ref, kind: 'prose', text, objective, page: pageAt(clause, b),
        })
      })
    }
  }
  return out
}

/**
 * Could this text state a control at all?
 *
 * A converted PDF leaves debris in its tables: a stray "I" or "U" where a tick box was, a bare page
 * number, a URL, a lone punctuation mark. These are not controls that failed to extract — they were
 * never controls, and counting them as failures makes the denominator wrong. Nine of the fifty-three
 * residual failures in the last run were exactly this.
 *
 * Deliberately conservative. "Nil" and "0" ARE controls and must survive; so must "3m". The test is
 * whether there is enough substance to be a statement, not whether it looks like one.
 */
export function admissible(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return false
  // a lone letter or two, with no digit: tick-box debris, column letters, OCR noise
  if (/^[a-z]{1,2}$/i.test(t)) return false
  if (!/[a-z0-9]/i.test(t)) return false                      // punctuation or rules only
  if (/^(?:n\/?a|tba|tbc|nil applicable|\u2013|\u2014|-)$/i.test(t)) return false
  if (/^https?:\/\/|^www\.|\.com\/|arcgis\.com/i.test(t)) return false   // a link, not a control
  if (/^(?:page\s*)?\d{1,3}$/.test(t) && t.length <= 4 && !/\d{4}/.test(t)) {
    // a bare 1-3 digit number IS a control in a matrix cell, so only reject it when it reads as a
    // page number — which, inside a table, it does not. Keep it.
    return true
  }
  return true
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const intOrNull = (s: string | undefined) => {
  const n = parseInt(s ?? '', 10)
  return Number.isFinite(n) ? n : null
}

export function packetsFromFile(path: string, document: string, opts: BuildOptions = {}): Packet[] {
  return buildPackets(readFileSync(path, 'utf8'), document, opts)
}

/** The packet as the model sees it. Ordered widest scope first, so the control reads last. */
export function renderPacket(p: Packet): string {
  const L: string[] = []
  if (p.clause.chain.length) L.push(`Document part: ${p.clause.chain.join(' > ')}`)
  L.push(`Clause ${p.clause.number ?? '?'}${p.clause.heading ? ` — ${p.clause.heading}` : ''}`)
  if (p.objective) L.push(`Objective of this clause: ${p.objective}`)
  if (p.kind === 'table' && p.table) {
    if (p.table.caption) L.push(`Table: ${p.table.caption}`)
    if (p.table.rowPath.length) L.push(`Row header: ${p.table.rowPath.join(' > ')}`)
    if (p.table.colPath.length) L.push(`Column header: ${p.table.colPath.join(' > ')}`)
    if (p.table.siblings.length) {
      L.push(`Other columns in this row: ${p.table.siblings
        .map(s => `${s.colPath.join(' > ') || '?'} = ${s.text}`).join(' | ')}`)
    }
  }
  L.push(`CONTROL TEXT: ${p.text}`)
  return L.join('\n')
}
