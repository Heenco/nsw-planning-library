// ── Citation formatting helpers ────────────────────────────────────────
//
// Converts internal section_local_ids and document titles to NSW
// legal-citation style + short labels.
//
//   sec.4.3-ssec.2          → 'cl 4.3(2)'
//   sec.2.16-ssec.3-para1.a → 'cl 2.16(3)(a)'
//   sch.4A-sec.15-ssec.1    → 'Sch 4A cl 15(1)'
//   pt.4                    → 'Part 4'
//   ch.5-pt.2               → 'Ch 5 Pt 2'
//   dict                    → 'Dictionary'
//   dcp.10.4.2              → 's 10.4.2'
//
// And document titles → short labels for inline use.

// ── Section ID → NSW legal citation format ────────────────────────────

/** Parse a "ssec.N" segment into "(N)" — preserves alpha suffixes like (2A). */
function fmtSubclause(seg: string): string {
  const m = seg.match(/^ssec\.(.+)$/i)
  if (!m || !m[1]) return seg
  return `(${m[1]})`
}

/** "para1.a" → "(a)", "para2.iii" → "(iii)" */
function fmtParagraph(seg: string): string {
  const m = seg.match(/^para\d+\.(.+)$/i)
  if (!m || !m[1]) return seg
  return `(${m[1]})`
}

/** "sec.4.3" → "4.3", "sec.2.16" → "2.16" — used inside contexts that already
 *  carry the type word (Sch X **cl** Y, **cl** Z). */
function fmtSectionNumber(seg: string): string {
  const m = seg.match(/^sec\.(.+)$/i)
  if (!m || !m[1]) return seg
  return m[1]
}

/** "sch.4A" → "Sch 4A", "sch.1" → "Sch 1" */
function fmtSchedule(seg: string): string {
  const m = seg.match(/^sch\.(.+)$/i)
  if (!m || !m[1]) return seg
  return `Sch ${m[1]}`
}

/** "pt.4" → "Part 4", "pt.4A" → "Part 4A" */
function fmtPart(seg: string): string {
  const m = seg.match(/^pt\.(.+)$/i)
  if (!m || !m[1]) return seg
  return `Part ${m[1]}`
}

/** "ch.5" → "Ch 5" */
function fmtChapter(seg: string): string {
  const m = seg.match(/^ch\.(.+)$/i)
  if (!m || !m[1]) return seg
  return `Ch ${m[1]}`
}

/** "div.2" → "Div 2" */
function fmtDivision(seg: string): string {
  const m = seg.match(/^div\.(.+)$/i)
  if (!m || !m[1]) return seg
  return `Div ${m[1]}`
}

/**
 * Format a section_local_id into NSW legal citation style.
 *
 * Strategy: split on `-`, classify each segment, and stitch back together
 * with the right joiners. Examples:
 *
 *   sec.4.3-ssec.2          → cl 4.3(2)
 *   sec.2.16-ssec.3-para1.a → cl 2.16(3)(a)
 *   sch.4A-sec.15-ssec.1    → Sch 4A cl 15(1)
 *   ch.5-pt.2-sec.13        → Ch 5 Pt 2 cl 13
 *   pt.4                    → Part 4
 *   sch.5                   → Sch 5
 *   dict                    → Dictionary
 *   dcp.10.4.2              → s 10.4.2
 *   dcp.h4.5890.controls    → s 5890 (DCP heading-derived id)
 */
export function formatSectionId(localId: string, docType?: 'lep' | 'sepp' | 'dcp'): string {
  if (!localId) return ''
  const id = localId.trim()

  // Special cases first
  if (id === 'dict' || id === 'dictionary') return 'Dictionary'

  // DCP ids: 'dcp.10.4.2' or 'dcp.h4.5890.<slug>'
  if (id.startsWith('dcp.')) {
    const rest = id.slice(4)
    // dcp.h4.5890.<slug> — heading-derived, not a real numbered section
    if (/^h\d+\./.test(rest)) {
      const parts = rest.split('.')
      const slug = parts.slice(2).join('.').replace(/_/g, ' ')
      return slug ? `${slug} (DCP)` : 'DCP section'
    }
    // dcp.10.4.2 → s 10.4.2
    return `s ${rest}`
  }

  // LEP / SEPP ids: dot-segmented hierarchy joined with '-'
  const segments = id.split('-')
  const parts: string[] = []
  let lastWasClause = false

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    if (seg.startsWith('ch.')) {
      parts.push(fmtChapter(seg))
      lastWasClause = false
    } else if (seg.startsWith('pt.')) {
      // If this is the only segment, return "Part N". Otherwise abbreviate to "Pt N".
      if (segments.length === 1) return fmtPart(seg)
      parts.push(`Pt ${seg.slice(3)}`)
      lastWasClause = false
    } else if (seg.startsWith('div.')) {
      parts.push(fmtDivision(seg))
      lastWasClause = false
    } else if (seg.startsWith('sch.')) {
      // If this is the only segment, return "Sch N". Otherwise keep "Sch N" inline.
      parts.push(fmtSchedule(seg))
      lastWasClause = false
    } else if (seg.startsWith('sec.')) {
      // The "cl N" or "s N" prefix depends on doc_type
      const num = fmtSectionNumber(seg)
      const word = docType === 'sepp' ? 's' : 'cl'   // Acts use s, instruments use cl, but SEPPs by convention use s
      // Actually NSW SEPPs and LEPs both typically use "cl" for clauses.
      // Use "cl" universally for legislation, "s" for DCP.
      parts.push(`cl ${num}`)
      lastWasClause = true
    } else if (seg.startsWith('ssec.') && lastWasClause) {
      // Append (N) directly to the previous "cl N" — no space
      const idx = parts.length - 1
      parts[idx] = parts[idx] + fmtSubclause(seg)
    } else if (seg.startsWith('ssec.')) {
      parts.push(fmtSubclause(seg))
    } else if (seg.startsWith('para')) {
      // Append (a) directly to the previous segment
      if (parts.length > 0) {
        const idx = parts.length - 1
        parts[idx] = parts[idx] + fmtParagraph(seg)
      } else {
        parts.push(fmtParagraph(seg))
      }
    } else {
      // Unknown segment — keep as-is so we don't lose information
      parts.push(seg)
      lastWasClause = false
    }
  }

  return parts.join(' ')
}

// ── Document title → short label ──────────────────────────────────────

/** Convert a long official title to a friendly inline label. */
export function shortDocumentLabel(title: string, docType?: 'lep' | 'sepp' | 'dcp'): string {
  if (!title) return ''
  const t = title

  // LGA-prefixed local instruments
  if (/Albury Local Environmental Plan/i.test(t)) return 'Albury LEP'
  if (/Albury Development Control Plan/i.test(t)) return 'Albury DCP'

  // Specific SEPPs we ingested
  const seppMap: Array<[RegExp, string]> = [
    [/\(Housing\)/i,                                      'Housing SEPP'],
    [/\(Biodiversity and Conservation\)/i,                'Biodiversity & Conservation SEPP'],
    [/\(Industry and Employment\)/i,                      'Industry & Employment SEPP'],
    [/\(Planning Systems\)/i,                             'Planning Systems SEPP'],
    [/\(Primary Production\)/i,                           'Primary Production SEPP'],
    [/\(Resilience and Hazards\)/i,                       'Resilience & Hazards SEPP'],
    [/\(Resources and Energy\)/i,                         'Resources & Energy SEPP'],
    [/\(Transport and Infrastructure\)/i,                 'Transport & Infrastructure SEPP'],
    [/\(Sustainable Buildings\)/i,                        'Sustainable Buildings SEPP'],
    [/\(Exempt and Complying Development Codes\)/i,       'Exempt & Complying SEPP'],
    [/\(Precincts—Central River City\)/i,                 'Central River City SEPP'],
    [/\(Precincts—Eastern Harbour City\)/i,               'Eastern Harbour City SEPP'],
    [/\(Precincts—Regional\)/i,                           'Regional Precincts SEPP'],
    [/\(Precincts—Western Parkland City\)/i,              'Western Parkland City SEPP'],
  ]
  for (const [re, label] of seppMap) {
    if (re.test(t)) return label
  }

  // Generic fallback
  if (docType === 'sepp') {
    // Try to extract the parenthesised name
    const m = t.match(/\(([^)]+)\)/)
    if (m) return `${m[1]} SEPP`
    return 'SEPP'
  }
  if (docType === 'lep') return t.replace(/Local Environmental Plan.*/i, 'LEP').trim()
  if (docType === 'dcp') return t.replace(/Development Control Plan.*/i, 'DCP').trim()
  return t
}
