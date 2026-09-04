/**
 * Clause-structured HTML for a DCP.
 *
 * The obvious way to emit HTML from a page-by-page PDF extraction is to make
 * each page a container. That is wrong for a planning instrument: a clause
 * routinely spans several pages, so page containers cut clauses in half and
 * you cannot address "clause 4.2.1" as a single subtree — which is precisely
 * what a citation, an excerpt, or an ingest step needs.
 *
 * Here the clause is the container and the page is an attribute:
 *
 *   <section class="dcp-part" data-part="Part 4 – Business"
 *            data-page-start="211" data-page-end="314">
 *     <h1>4 Business</h1>
 *     <section class="dcp-clause" id="dcp.4.2" data-number="4.2"
 *              data-page-start="216" data-page-end="233">
 *       <h2>4.2 Business Lands</h2>
 *       <section class="dcp-clause" id="dcp.4.2.1" data-number="4.2.1"
 *                data-page-start="216" data-page-end="217">
 *         <h3>4.2.1 Scale</h3>
 *         <section class="dcp-rubric" id="dcp.4.2.1.desired_outcome"
 *                  data-rubric="desired-outcome" data-page-start="216">
 *           <h4>Desired Outcome</h4>
 *           <ul>…</ul>
 *         </section>
 *       </section>
 *     </section>
 *   </section>
 *
 * Page boundaries survive as inline markers, so provenance is not lost:
 *   <span class="dcp-pagebreak" data-page="217" data-src="…pdf"></span>
 *
 * The id sits on the section, not the heading — a citation points at the
 * clause, not at its title. Rubric blocks carry `data-rubric` using the
 * vocabulary already in server/utils/nsw-kg/types.ts, so the decomposer can
 * tell an objective from a binding control without re-reading the prose.
 *
 * Built as a tree and serialised at the end, because a section's end page is
 * only known once it closes.
 */

const RUBRIC_MAP = [
  [/^desired outcomes?$/i,      'objectives'],
  [/^objectives?$/i,            'objectives'],
  [/^prescriptive measures?$/i, 'controls'],
  [/^controls?$/i,              'controls'],
  [/^requirements?$/i,          'controls'],
  [/^explanation$/i,            'explanation'],
  [/^background$/i,             'background'],
  [/^notes?:?$/i,               'note'],
  [/^figures?:?$/i,             'note'],
  [/^legend$/i,                 'note'],
]

/** Map a heading to the DCP rubric vocabulary, or null if it is not one. */
export function rubricOf(title) {
  const t = String(title).trim()
  for (const [re, kind] of RUBRIC_MAP) if (re.test(t)) return kind
  return null
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s) => esc(s).replace(/"/g, '&quot;')

/**
 * Accumulates sections and content into a tree, then serialises.
 *
 * `openSection` closes everything at or below the incoming level first, so
 * the nesting follows heading rank without the caller tracking a stack.
 */
export function createHtmlBuilder({ docSource, totalPages, generated }) {
  const root = { kind: 'root', children: [] }
  const stack = [root]
  let curPage = null

  const top = () => stack[stack.length - 1]

  function note(page) {
    // Record the furthest page reached on every open section.
    for (const s of stack) {
      if (s.kind === 'root') continue
      if (s.pageStart == null) s.pageStart = page
      s.pageEnd = page
    }
  }

  return {
    /** Record a page boundary; emitted inline so provenance survives. */
    page(page, src) {
      if (page === curPage) return
      curPage = page
      note(page)
      top().children.push({ kind: 'pagebreak', page, src })
    },

    /** Open a section at `level`, closing any peers or descendants first. */
    section({ level, id, title, number, rubric, cls, part, src }) {
      while (stack.length > 1 && top().level >= level) stack.pop()
      const node = {
        kind: 'section',
        level,
        id,
        title,
        number,
        rubric,
        part,
        src,
        cls: cls ?? (number ? 'dcp-clause' : rubric ? 'dcp-rubric' : 'dcp-block'),
        pageStart: curPage,
        pageEnd: curPage,
        children: [],
      }
      top().children.push(node)
      stack.push(node)
      note(curPage)
    },

    /** Close every open section — used at a part boundary. */
    closeAll() {
      while (stack.length > 1) stack.pop()
    },

    /**
     * Mark the section just opened as the document's contents page.
     *
     * The source contents arrives as hundreds of loose fragments — numbers
     * and titles as separate text runs — which is unusable. Rather than drop
     * it, we replace it at serialise time with a listing generated from the
     * clause tree, so it is complete, linked, and correct by construction.
     */
    markContents() {
      const s = top()
      if (s.kind === 'section') s.isContents = true
    },

    /** Append raw HTML (a table, a figure) or a text block. */
    push(html) {
      top().children.push({ kind: 'raw', html })
      note(curPage)
    },

    serialise() {
      const out = []

      /**
       * Build the contents listing from the clause tree itself.
       *
       * Numbered clauses and the headings that introduce a part, but not
       * rubric blocks — a contents page that lists every "Desired Outcome"
       * and "Prescriptive Measures" is 1,872 rows and no longer a contents
       * page. Matches how the document's own printed contents reads.
       */
      const buildContents = () => {
        const rows = []
        const walk = (node, depth, part) => {
          for (const c of node.children) {
            if (c.kind !== 'section') continue
            const nextPart = c.part ?? part
            if (c.part) {
              rows.push({ depth: 0, text: c.part, id: null, page: c.pageStart, part: true })
            } else if (c.title && c.id && (c.number || (!c.rubric && depth <= 1))) {
              rows.push({ depth, text: c.title, id: c.id, page: c.pageStart, part: false })
            }
            walk(c, c.part ? 0 : depth + 1, nextPart)
          }
        }
        walk(root, 0, null)
        if (!rows.length) return ''
        const lis = rows.map((r) => {
          const label = r.id
            ? `<a href="#${escAttr(r.id)}">${esc(r.text)}</a>`
            : `<span class="dcp-contents-part">${esc(r.text)}</span>`
          const page = r.page != null ? `<span class="dcp-contents-page">${r.page}</span>` : ''
          return `<li class="dcp-contents-row dcp-contents-row--d${Math.min(r.depth, 5)}`
            + `${r.part ? ' dcp-contents-row--part' : ''}">${label}${page}</li>`
        })
        return `<nav class="dcp-contents" aria-label="Contents"><ul>${lis.join('')}</ul></nav>`
      }

      out.push(
        `<article class="dcp-doc" data-source="${escAttr(docSource)}"`
        + ` data-pages="${totalPages}" data-generated="${generated}">`,
      )
      const walk = (node, depth) => {
        const pad = '  '.repeat(depth)
        for (const c of node.children) {
          if (c.kind === 'pagebreak') {
            out.push(
              `${pad}<span class="dcp-pagebreak" data-page="${c.page}"`
              + `${c.src ? ` data-src="${escAttr(c.src)}"` : ''} aria-hidden="true"></span>`,
            )
          } else if (c.kind === 'raw') {
            out.push(pad + c.html)
          } else {
            const attrs = [
              `class="${c.cls}"`,
              c.id ? `id="${escAttr(c.id)}"` : '',
              c.number ? `data-number="${escAttr(c.number)}"` : '',
              c.rubric ? `data-rubric="${escAttr(c.rubric)}"` : '',
              c.part ? `data-part="${escAttr(c.part)}"` : '',
              c.src ? `data-src="${escAttr(c.src)}"` : '',
              c.pageStart != null ? `data-page-start="${c.pageStart}"` : '',
              c.pageEnd != null ? `data-page-end="${c.pageEnd}"` : '',
            ].filter(Boolean).join(' ')
            out.push(`${pad}<section ${attrs}>`)
            if (c.title) {
              const h = Math.min(Math.max(c.level, 1), 6)
              out.push(`${pad}  <h${h}>${esc(c.title)}</h${h}>`)
            }
            if (c.isContents) out.push(pad + '  ' + buildContents())
            walk(c, depth + 1)
            out.push(`${pad}</section>`)
          }
        }
      }
      walk(root, 1)
      out.push('</article>')
      return out.join('\n')
    },
  }
}
