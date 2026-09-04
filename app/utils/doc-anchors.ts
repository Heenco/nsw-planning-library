// ── Stable heading anchors for the document viewer ──────────────────────
//
// Anchors are what citations point at, so they must survive an edit to the
// document. That rules out deriving them from heading text. Instead we take
// the id the source already carries:
//
//   LEP / SEPP — every clause heading ends with its canonical local_id,
//                e.g. `## Name of Plan [sec.1.1]`. That is the same id
//                nsw.section.local_id holds, so a citation produced by
//                /api/ask and an anchor rendered here agree by
//                construction rather than by a lookup table.
//
//   DCP        — PDF-derived, so the headings carry no ids. We keep the
//                numbering-derived `dcp.10.4.2` form the KG parser uses,
//                and bind each heading to the
//                `<!-- SRC: file.pdf | PAGE: n -->` marker in force above
//                it — the (source_file, page) pair nsw.section stores for
//                DCP citations.
//
// A slug of the heading text remains the last resort, for unnumbered
// headings only. Those are scroll targets, not legal references, and are
// reported as `citable: false` so the viewer does not offer a citation for
// something that cannot be cited.

export type DocKind = 'lep' | 'sepp' | 'dcp'

export interface HeadingRef {
  /** Anchor id. The source's own local_id wherever there is one. */
  id: string
  /** Heading text with the id marker stripped. */
  text: string
  /** True when `id` is a real section reference rather than a slug. */
  citable: boolean
  /** DCP only: the source PDF part this heading came from. */
  srcFile: string | null
  /** DCP only: page within that part. Meaningless without srcFile. */
  page: number | null
}

/** Trailing `[local_id]` marker on a heading. A markdown link cannot match:
 *  those are `[text](url)` and so never end the line at `]`. */
export const HEADING_ID_RE = /^(.*?)\s*\[([A-Za-z][A-Za-z0-9._-]*)\]$/

/** Same marker, for stripping off the end of already-rendered inline HTML. */
export const HEADING_ID_SUFFIX_RE = /\s*\[[A-Za-z][A-Za-z0-9._-]*\]\s*$/

interface SourceLocus {
  srcFile: string | null
  page: number | null
}

/**
 * Walk the raw markdown and record, for each heading, the SRC/PAGE marker
 * in force above it. Keyed by heading text because a DCP repeats headings
 * — "Contents" appears once per merged PDF part — so each key holds a
 * queue consumed in document order.
 */
export function scanSourceLoci(md: string): Map<string, SourceLocus[]> {
  const loci = new Map<string, SourceLocus[]>()
  let srcFile: string | null = null
  let page: number | null = null
  let inFence = false

  for (const line of md.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue

    const marker = line.match(/<!--\s*SRC:\s*([^|]+?)\s*\|\s*PAGE:\s*(\d+)\s*-->/i)
    if (marker) {
      srcFile = marker[1]!.trim()
      page = Number(marker[2])
      continue
    }

    const heading = line.match(/^#{1,6}\s+(.*?)\s*$/)
    if (!heading) continue
    const text = heading[1]!.trim()
    if (!loci.has(text)) loci.set(text, [])
    loci.get(text)!.push({ srcFile, page })
  }
  return loci
}

/**
 * Build a resolver for one document. Stateful across the document because
 * derived ids can repeat and need disambiguating; canonical local_ids are
 * unique already, by nsw.section's UNIQUE (document_id, local_id).
 */
export function createHeadingResolver(md: string, kind: DocKind) {
  const loci = scanSourceLoci(md)
  const seen = new Map<string, number>()

  return function resolve(raw: string, level: number): HeadingRef {
    const marker = raw.match(HEADING_ID_RE)
    const localId = marker ? marker[2]! : null
    const text = marker ? marker[1]!.trim() : raw.trim()

    let id: string
    let citable = localId !== null
    if (localId) {
      id = localId
    } else {
      const numbered = text.match(/^([A-Z]?\d+(?:\.\d+)*[A-Z]?)\s+(.+)$/)
      const prefix = kind === 'dcp' ? 'dcp.' : ''
      if (numbered) {
        id = `${prefix}${numbered[1]}`
        // Legislation without a marker is a Part or a preamble, not a
        // clause — numbering alone is not a citable reference there.
        citable = kind === 'dcp'
      } else {
        const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
        id = `${prefix}h${level}.${slug}`
      }
    }

    const count = seen.get(id) ?? 0
    seen.set(id, count + 1)
    // `#` is legal in an id but awkward in a URL fragment, so flatten it.
    const finalId = (count > 0 ? `${id}#${count + 1}` : id).replace(/#/g, '_')

    const locus = loci.get(text)?.shift() ?? loci.get(raw)?.shift() ?? null

    return {
      id: finalId,
      text,
      // A disambiguated duplicate is no longer the canonical id, so it is
      // no longer safe to present as a citation.
      citable: citable && count === 0,
      srcFile: locus?.srcFile ?? null,
      page: locus?.page ?? null,
    }
  }
}
