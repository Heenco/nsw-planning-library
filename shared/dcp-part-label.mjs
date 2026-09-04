/**
 * Part labels and part numbering regimes for DCPs.
 *
 * Shared because the converter authors these labels and the doc-viewer
 * re-derives them for its contents tree; two copies of the regex drifted
 * apart once already.
 *
 * Councils use two incompatible numbering regimes, and the difference
 * decides whether a clause number can be checked against its part:
 *
 *   numeric   Hornsby. Parts are "Part 4 Business" and clauses inside it
 *             are "4.2.1" — the clause number carries its part, so a
 *             heading claiming to be "3.1" inside Part 4 is a
 *             misdetection and can be rejected.
 *
 *   coded     Randwick. Parts are "C1 Low density residential" and every
 *             part restarts its clauses at "1." — so "2.1" is a valid
 *             clause in C1, B2 and D3 alike. There is no part prefix to
 *             check against, and pretending otherwise would reject real
 *             headings.
 *
 * `partNumberingOf()` reports which regime a label is in, so callers apply
 * the prefix constraint only where it means something instead of silently
 * skipping it.
 */

const norm = (s) => String(s).replace(/\s+/g, ' ').trim()

/** Letter+digits part code, e.g. "C1", "B15", "D3". */
const CODED_RE = /^([A-F]\d{1,2})\b/i

/** "Part 4", "Part 12". */
const NUMERIC_RE = /\bPart\s+(\d+)\b/i

/**
 * Which numbering regime a part label uses.
 *
 *   { kind: 'numeric', n: 4 }    clause numbers are prefixed by the part
 *   { kind: 'coded', code: 'C1' } clauses restart per part; no prefix
 *   null                          no part identity in the label at all
 */
export function partNumberingOf(label) {
  if (!label) return null
  const flat = norm(label)
  const coded = flat.match(CODED_RE)
  if (coded) return { kind: 'coded', code: coded[1].toUpperCase() }
  const numeric = flat.match(NUMERIC_RE)
  if (numeric) return { kind: 'numeric', n: Number(numeric[1]) }
  return null
}

/**
 * The numeric part prefix a clause number must carry, or null when the
 * regime does not constrain clause numbers.
 *
 * Kept as its own function because this is the only thing `levelFor()`
 * needs, and returning null for a coded part is a *correct* answer there,
 * not a failure to parse.
 */
export function partNumberOf(label) {
  const r = partNumberingOf(label)
  return r && r.kind === 'numeric' ? r.n : null
}

/** The part code used to namespace anchors, e.g. "C1". Null for numeric parts. */
export function partCodeOf(label) {
  const r = partNumberingOf(label)
  return r && r.kind === 'coded' ? r.code : null
}

/**
 * Human-readable part label from a source filename or heading.
 *
 *   "HDCP 2024 Part 4 Business - 23 June 2025.pdf" -> "Part 4 – Business"
 *   "C1 Low density residential"                   -> "C1 – Low density residential"
 *   "c1-low-density-residential.pdf"               -> "C1 – Low density residential"
 */
export function prettyPart(src) {
  if (!src) return ''
  const raw = norm(src)

  // Numeric regime, the Hornsby book-version shape.
  const numeric = raw.match(/\bPart\s+(\d+)\s+([A-Za-z][A-Za-z\s&']*?)(?:\s*[-–]\s*\d|\.pdf|$)/i)
  if (numeric) return `Part ${numeric[1]} – ${numeric[2].trim()}`

  // Coded regime. Accept both a display label ("C1 Low density residential")
  // and a slugified filename ("c1-low-density-residential.pdf").
  const stripped = raw.replace(/\.pdf$/i, '')
  const coded = stripped.match(/^([A-F]\d{1,2})[\s.\-–_]+(.+)$/i)
  if (coded) {
    const title = coded[2].replace(/[-_]+/g, ' ').replace(/\s*[-–]\s*\d.*$/, '').trim()
    return `${coded[1].toUpperCase()} – ${titleCase(title)}`
  }
  if (CODED_RE.test(stripped) && stripped.length <= 4) return stripped.toUpperCase()

  return stripped
    .replace(/^D\d+\s*/, '')
    .replace(/\s*[-–]\s*\d.*$/, '')
    .trim() || raw
}

/** Sentence case, preserving words that are already capitalised or acronyms. */
function titleCase(s) {
  if (!s) return s
  const words = s.split(' ')
  return words
    .map((w, i) => {
      if (/^[A-Z0-9&]{2,}$/.test(w)) return w          // acronym: SEPP, DCP, HIAs
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1)
      return w
    })
    .join(' ')
}
