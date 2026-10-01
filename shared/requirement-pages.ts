/**
 * The shape behind /build-to-rent and /affordable-housing: a Housing SEPP provision set out clause by
 * clause, the way /cdc sets out the Codes SEPP, with what we hold beside each clause.
 *
 * Neither page tests a lot yet. They exist so that the requirement as it was asked for, the
 * instrument, and whatever rule we already run can be read side by side before anything is built -
 * a rule written from the request alone would carry every gap in the request with it.
 *
 * Clause wording is quoted from the library's own copy, public/EPI/SEPP/housing-sepp-2021.md
 * (epi-2021-0714, amendments to 2026 (33)). legislation.nsw.gov.au refuses scripted reads, so a
 * provision made after that copy is marked `unverified` rather than paraphrased into it.
 */

export const HOUSING_SEPP_URL = 'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2021-0714'
/** The slug /doc-viewer resolves (public/instruments.json), not nsw.document.instrument_slug. */
export const HOUSING_SEPP_DOC = 'housing-sepp-2021'
export const HOUSING_SEPP_AMENDED_TO = '2026 (33)'

/** What a clause does in the provision. Drives the badge, and the order the page reads in. */
export type ClauseRole =
  | 'where'        // land the provision reaches
  | 'condition'    // must also be true, of the land or of the development
  | 'exclusion'    // land or development taken back out
  | 'outcome'      // what the provision then gives
  | 'standard'     // a standard the consent authority applies
  | 'definition'

/**
 * Whether a lot-level filter could answer this clause from data.
 *   held     - the layer is in planningai and says what the clause says
 *   partial  - a layer exists but answers a narrower or different question
 *   gap      - nothing held answers it
 *   proposal - not a fact about the land: it depends on what is proposed, so no layer ever will
 */
export type DataStatus = 'held' | 'partial' | 'gap' | 'proposal'

export interface ClauseRow {
  clause: string
  /** Verbatim from the instrument. */
  text: string
  role: ClauseRole
  data: DataStatus
  /** What we would read for it, or why nothing can be. */
  dataNote: string
  /** Tables, routes or files, shown as code. */
  tables?: string[]
  /** Something a reader would otherwise get wrong. */
  note?: string
  /** Section anchor for the doc viewer / legislation link; derived from `clause` when absent. */
  anchor?: string
  /** Cited, but the wording is not in the library's copy and has not been read. */
  unverified?: boolean
  /** A link to use instead of the Housing SEPP one (another instrument, or the Dictionary). */
  href?: string
}

export interface ClauseSection {
  id: string
  title: string
  lead: string
  rows: ClauseRow[]
}

/** One line of the requirement as it was handed to us, read against the instrument. */
export type RequestVerdict = 'matches' | 'narrower' | 'wider' | 'different' | 'missing' | 'unverified'

export interface RequestLine {
  /** The request's words. For a `missing` line, the clause the request leaves out. */
  said: string
  clause: string
  verdict: RequestVerdict
  why: string
}

/** A rule we already run somewhere, line by line against the clause. */
export interface OurRuleLine {
  says: string
  clause: string
  verdict: RequestVerdict
  why: string
}

export interface OurRule {
  name: string
  where: string
  lines: OurRuleLine[]
}

export interface WatchItem { lead: string; body: string }
export interface SourceLink { label: string; url: string; host: string }

export interface RequirementPage {
  title: string
  sub: string
  /** The provision's home in the instrument, for the header. */
  provision: string
  auditedOn: string
  /** The request as pasted, kept verbatim so the comparison below can be checked against it. */
  request: { heading: string; bullets: string[]; after?: { heading: string; bullets: string[] } }
  requestLines: RequestLine[]
  sections: ClauseSection[]
  ourRule?: OurRule
  /** How the land-side clauses would compose into one filter, in order. */
  filter: { step: string; clause: string; data: DataStatus }[]
  watch: WatchItem[]
  sources: SourceLink[]
  related: { to: string; label: string }[]
}

/** "72(2)(a)(i)" -> "sec.72", "15C(2A)" -> "sec.15C", "Dictionary" -> null. */
export function sectionOf(clause: string): string | null {
  const m = clause.match(/^(\d+[A-Z]?)/)
  return m ? `sec.${m[1]}` : null
}

export function legislationLink(row: Pick<ClauseRow, 'clause' | 'anchor' | 'href'>): string {
  if (row.href) return row.href
  const sec = row.anchor ?? sectionOf(row.clause)
  return sec ? `${HOUSING_SEPP_URL}#${sec}` : HOUSING_SEPP_URL
}

/** The library's own copy, which unlike legislation.nsw.gov.au always opens. */
export function docViewerLink(row: Pick<ClauseRow, 'clause' | 'anchor' | 'href'>): string | null {
  if (row.href) return null
  const sec = row.anchor ?? sectionOf(row.clause)
  return sec ? `/doc-viewer?doc=${HOUSING_SEPP_DOC}&anchor=${encodeURIComponent(sec)}` : null
}
