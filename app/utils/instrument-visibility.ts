/**
 * Which instruments the frontend lists.
 *
 * Every DCP stays ingested, indexed and answerable — /api/ask and the document
 * viewer are untouched. This only trims what the browse lists show, so the
 * landing page and /library agree on one rule instead of two.
 */

export interface InstrumentDoc { slug: string; title: string; file: string }
export interface InstrumentCategory { label: string; items: InstrumentDoc[] }
export interface InstrumentState { label: string; categories: Record<string, InstrumentCategory> }
export type InstrumentsIndex = Record<string, InstrumentState>

/** The only DCPs shown in the instrument lists. LEPs and SEPPs are all shown. */
export const VISIBLE_DCP_SLUGS = new Set([
  'hornsby-dcp-2024',
  // Randwick DCP 2025 (commenced 27 July 2026) supersedes the 2013 plan, so
  // the 2013 entry stays in the catalogue as history but is deliberately not
  // listed — two Randwick DCPs in the browse list would read as a choice
  // when only one is in force.
  'randwick-dcp-2025',
])

/**
 * Drop the DCPs that aren't in VISIBLE_DCP_SLUGS.
 *
 * Apply this once, right after loading /instruments.json, so counts, category
 * tabs and item lists are all derived from the same filtered data. A category
 * left with no items is removed so empty tabs don't appear.
 */
export function withVisibleDcpsOnly(raw: InstrumentsIndex): InstrumentsIndex {
  const out: InstrumentsIndex = {}

  for (const [stateKey, state] of Object.entries(raw || {})) {
    const categories: Record<string, InstrumentCategory> = {}

    for (const [catKey, cat] of Object.entries(state.categories || {})) {
      const items = catKey === 'dcp'
        ? (cat.items || []).filter(i => VISIBLE_DCP_SLUGS.has(i.slug))
        : (cat.items || [])
      if (items.length) categories[catKey] = { ...cat, items }
    }

    out[stateKey] = { ...state, categories }
  }

  return out
}
