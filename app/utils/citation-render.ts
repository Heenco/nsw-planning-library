// ── Shared citation renderer ────────────────────────────────────────────
//
// Used by both ChatPanel.vue and sitewise-2.vue so the numbered-footnote
// citation UX is identical in both places.
//
// Exposes:
//   - Citation interface (mirrors the server's Citation type)
//   - renderMarkdownWithCitations(text, citations, cite_index) → HTML string
//   - boldifyNumbers(html) → HTML string (safe against pre-rendered chips)

export interface Citation {
  proposition_id:   string
  section_local_id: string
  section_number:   string | null
  section_heading:  string | null
  document_label:   string
  document_title:   string
  source_url:       string | null
  clause_url:       string | null
  number:           number
  citation_label:   string
  document_short:   string
  doc_type:         'lep' | 'sepp' | 'dcp'
  source_quote:     string
}

// ── boldifyNumbers ─────────────────────────────────────────────────────
//
// Bolds numeric facts in prose while protecting citation chip numbers.
// Strategy:
//   1. Mask any <a|span class="kg2-cite-num ...">N</a> chip with a
//      placeholder so the bolder can't see inside.
//   2. Walk text segments only (not HTML tags), tracking <strong> nesting.
//   3. Wrap standalone numbers + unit suffixes in <strong>.
//   4. Restore the chip placeholders.
//
// Recognises integers, decimals, ratios (0.5:1), and units (8.5m, 450 sqm,
// 12 rooms, 0.9 metres). Years like 1979/2021 are skipped.

export function boldifyNumbers(html: string): string {
  // 1. Mask citation chips
  const chipRe = /<(?:a|span)\b[^>]*class="kg2-cite-num[^"]*"[^>]*>[^<]*<\/(?:a|span)>/gi
  const chips: string[] = []
  const masked = html.replace(chipRe, (match) => {
    const idx = chips.length
    chips.push(match)
    return `\u0000CHIP${idx}\u0000`
  })

  // 2. Walk text segments
  const parts = masked.split(/(<[^>]+>)/)
  let inStrong = 0

  // Words that precede a clause/section/chapter number we should NOT bold.
  // "Clause 4.6", "Section 7.11", "Part 2", "Division 3", "Chapter 5", etc.
  const CLAUSE_CONTEXT_RE = /\b(?:clause|section|sec|chapter|ch|part|pt|division|div|schedule|sch|paragraph|para|subsection|ssec|item|point|rule|s)\s*$/i

  // Only bold numbers followed by a unit token. Stand-alone digits are NOT
  // worth bolding — they're usually clause numbers, years, counts the LLM
  // already framed in prose. Unit bolding is the useful signal.
  const NUMBER_WITH_UNIT_RE = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?(?::\d+)?)(\s*(?:m²|m2|sqm|square\s*metres?|metres?|km|hectares?|ha|%|percent|storeys?|spaces?|rooms?|dwellings?|persons?|days?|months?|years?|km\/h|kmh|mph)\b|\s*m(?=[\s,.;:)]|$))/g

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.startsWith('<')) {
      if (/^<strong\b/i.test(part))       inStrong++
      else if (/^<\/strong>/i.test(part)) inStrong = Math.max(0, inStrong - 1)
      continue
    }
    if (inStrong > 0) continue

    parts[i] = part.replace(NUMBER_WITH_UNIT_RE, (match, num, unit, offset, full) => {
      // Skip years (19xx, 20xx) even when a unit follows, unless the unit
      // is clearly spatial (m, m², ha, %) — "2010 years" is almost always
      // a hallucinated phrase, whereas "2010" is the Albury LEP year.
      if (/^(19|20)\d{2}$/.test(num) && /year/i.test(unit)) return match

      // Skip numbers that follow "Clause", "Section", "Chapter", "Part",
      // "Division" etc — those are legal references, not numeric facts.
      const before = (full as string).slice(Math.max(0, (offset as number) - 20), offset as number)
      if (CLAUSE_CONTEXT_RE.test(before)) return match

      return `<strong>${match}</strong>`
    })
  }

  // 3. Unmask chips
  let result = parts.join('')
  result = result.replace(/\u0000CHIP(\d+)\u0000/g, (_full, idx) => chips[Number(idx)] ?? '')
  return result
}

// ── renderMarkdownWithCitations ────────────────────────────────────────
//
// Lightweight markdown renderer with numbered footnote citations.
// - Escapes HTML
// - Bolds **x**, inline-codes `x`
// - Replaces [sec.x.y] markers with numbered <a> chips colored by doc_type
//   (or non-linked <span> for DCP which has no anchors)
// - Strips any trailing "Sources:" block the LLM may have emitted
// - Converts bullets and double-newlines to markup
// - Bolds standalone numbers (via boldifyNumbers)
//
// The cite_index map is keyed by lowercase section_local_id and maps to
// the 1-based footnote number. citations[] is used to look up the deep-link
// URL + doc_type + display label for each marker.

export function renderMarkdownWithCitations(
  text: string,
  citations: Citation[] = [],
  cite_index: Record<string, number> = {},
): string {
  if (!text) return ''

  // Strip any trailing "Sources:" / "**Sources**" block
  const cleaned = text
    .replace(/\n+\s*(?:\*\*?\s*Sources?\s*:?\s*\*\*?|Sources?\s*:)[\s\S]*$/i, '')
    .trimEnd()

  // Escape HTML
  let s = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Markdown headings → styled section labels (we don't want big H1/H2 in
  // chat cards, and the LLM sometimes emits them despite being told not to).
  // ### / #### / ##### → small uppercase label
  // ## / # → slightly larger bold label
  s = s.replace(/^\s*#{3,6}\s+(.+?)\s*$/gm, '<div class="kg2-h-sm">$1</div>')
  s = s.replace(/^\s*#{1,2}\s+(.+?)\s*$/gm,  '<div class="kg2-h-md">$1</div>')

  // Markdown basics
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Citation lookup
  const byRef = new Map<string, Citation>()
  for (const c of citations) byRef.set(c.section_local_id.toLowerCase(), c)

  // Replace [sec.x.y] markers with numbered chips
  s = s.replace(
    /\[((?:sec|cl|sch|pt|ch|dict)\.[\w.#-]+|dcp\.[\w.#-]+)\]/g,
    (_full, ref: string) => {
      const lower = ref.toLowerCase()
      const num = cite_index[lower]
      const cite = byRef.get(lower)
      if (!num || !cite) {
        return `<span class="kg2-cite-num kg2-cite-num--unknown">[?]</span>`
      }
      const docCls = `kg2-cite-num--${cite.doc_type}`
      const tooltip = `${cite.document_short} ${cite.citation_label}`
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
      if (cite.clause_url) {
        const url = cite.clause_url
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
        return `<a class="kg2-cite-num ${docCls}" href="${url}" target="_blank" rel="noopener" title="${tooltip}">${num}</a>`
      }
      return `<span class="kg2-cite-num ${docCls}" title="${tooltip}">${num}</span>`
    },
  )

  // Bullets + paragraphs
  s = s.replace(/^[*\-]\s+(.+)$/gm, '<li>$1</li>')
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
  s = s.replace(/\n\n+/g, '</p><p>')

  // Bold numbers (MUST run after chip insertion to protect chip digits)
  s = boldifyNumbers(s)

  return `<p>${s}</p>`
}
