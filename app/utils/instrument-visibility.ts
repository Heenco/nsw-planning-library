/**
 * Which instruments the frontend lists.
 *
 * This used to hold a hardcoded set of two DCP slugs. That was a third registry — a document had
 * to be added to public/instruments.json, to DOC_MAP in doc-viewer, AND here — and it is why a
 * DCP could be converted, published and still not appear anywhere.
 *
 * Now every DCP is listed, and the metadata the publisher writes onto each entry (`scope`,
 * `last_amended`, `councils`) is used to say WHAT each one is rather than to hide it. The concern
 * behind the old allowlist was real and is kept: Randwick DCP 2025 supersedes the 2013 plan, and
 * two entries with no distinction between them read as a choice when only one is in force. So a
 * superseded plan is marked, not removed — someone researching a DA lodged under the old plan
 * needs it, and hiding it makes the library quietly wrong rather than merely busy.
 *
 * Nothing here affects /api/ask or the document viewer; both always saw every ingested document.
 */

export interface InstrumentDoc {
  slug: string
  title: string
  file: string
  html?: string
  manifest?: string
  councils?: string[]
  /** 'citywide' | 'site_specific' | 'statewide' — written by scripts/dcp-publish.mjs. */
  scope?: string
  /** Latest amendment the library index carries; triage only, not the legal currency date. */
  last_amended?: string
  as_at?: string
  /** Derived below: this council's current city-wide plan. */
  current?: boolean
}
export interface InstrumentCategory { label: string; items: InstrumentDoc[] }
export interface InstrumentState { label: string; categories: Record<string, InstrumentCategory> }
export type InstrumentsIndex = Record<string, InstrumentState>

/**
 * Mark each council's current city-wide DCP.
 *
 * "Current" is the most recently amended city-wide plan for that council. Site-specific plans (a
 * precinct, an estate, a single address) are never marked current because they do not compete with
 * the city-wide plan — they sit alongside it and apply only where a lot falls inside them.
 *
 * A council can legitimately have several current plans at once: Inner West is governed by the
 * Ashfield, Leichhardt and Marrickville DCPs together, each for its own suburbs. So anything
 * amended within a year of that council's newest stays current rather than picking one winner.
 */
const CO_CURRENT_DAYS = 365

function markCurrent(items: InstrumentDoc[]): InstrumentDoc[] {
  const newestByCouncil = new Map<string, number>()
  const time = (d?: string) => (d ? Date.parse(d) : NaN)

  for (const i of items) {
    if (i.scope !== 'citywide') continue
    for (const c of i.councils ?? []) {
      const t = time(i.last_amended)
      if (!Number.isNaN(t) && t > (newestByCouncil.get(c) ?? -Infinity)) newestByCouncil.set(c, t)
    }
  }

  return items.map(i => {
    if (i.scope !== 'citywide') return { ...i, current: false }
    const t = time(i.last_amended)
    if (Number.isNaN(t)) return { ...i, current: false }
    const current = (i.councils ?? []).some(c => {
      const newest = newestByCouncil.get(c)
      return newest !== undefined && (newest - t) <= CO_CURRENT_DAYS * 86_400_000
    })
    return { ...i, current }
  })
}

/**
 * Apply once, right after loading /instruments.json, so counts, category tabs and item lists are
 * all derived from the same data.
 */
export function withVisibleDcpsOnly(raw: InstrumentsIndex): InstrumentsIndex {
  const out: InstrumentsIndex = {}

  for (const [stateKey, state] of Object.entries(raw || {})) {
    const categories: Record<string, InstrumentCategory> = {}

    for (const [catKey, cat] of Object.entries(state.categories || {})) {
      const items = catKey === 'dcp' ? markCurrent(cat.items || []) : (cat.items || [])
      if (items.length) categories[catKey] = { ...cat, items }
    }

    out[stateKey] = { ...state, categories }
  }

  return out
}
