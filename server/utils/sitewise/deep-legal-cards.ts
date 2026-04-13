// ── Deep legal cards ───────────────────────────────────────────────────
//
// Eight parallel graph-backed cards that sit below the main report
// sections. Each card answers a specific, high-value legal question
// about the property by firing a scoped runGraphQuery against the
// nsw-kg v2 index (LEP / SEPP / DCP propositions).
//
// Cards are fired together via Promise.allSettled — one slow or failed
// query never blocks the others. Each resolution emits a `legal_card`
// SSE event so the frontend can update the placeholder in-place.
//
// Currently Albury-focused. The card configs are static but the
// question text is built per-request from the GIS result so each
// query is zone- and land-use-aware.

import type { GISResult, SSEEvent } from './types'
import type { Citation } from '../nsw-kg/query/types'
import { runGraphQuery } from './graph-query'

export type CardId =
  | 'clause_46'
  | 'subdivision'
  | 'secondary_dwelling'
  | 'dual_occupancy'
  | 'setbacks_envelope'
  | 'parking_access'
  | 'heritage'
  | 'contributions'

export interface LegalCardSlot {
  id:          CardId
  title:       string
  icon:        string
  description: string       // one-line subtitle shown under the title
  docFilter:   'lep' | 'sepp' | 'dcp' | null
}

export interface LegalCardResult {
  id:         CardId
  answer:     string
  citations:  Citation[]
  ms:         number
  error:      string | null
}

// ── Card catalogue ─────────────────────────────────────────────────────

export const LEGAL_CARDS: LegalCardSlot[] = [
  {
    id:          'clause_46',
    title:       'Clause 4.6 Variations',
    icon:        '⚖',
    description: 'When height or FSR can be varied',
    docFilter:   'lep',
  },
  {
    id:          'subdivision',
    title:       'Subdivision',
    icon:        '⬚',
    description: 'Minimum lot size, frontage, restrictions',
    docFilter:   'lep',
  },
  {
    id:          'secondary_dwelling',
    title:       'Secondary Dwelling',
    icon:        '🏠',
    description: 'Granny flat conditions & limits',
    docFilter:   null,
  },
  {
    id:          'dual_occupancy',
    title:       'Dual Occupancy',
    icon:        '⟷',
    description: 'Site area, setbacks, attached vs detached',
    docFilter:   'lep',
  },
  {
    id:          'setbacks_envelope',
    title:       'Setbacks & Envelope',
    icon:        '▢',
    description: 'Front, side, rear + height plane',
    docFilter:   'dcp',
  },
  {
    id:          'parking_access',
    title:       'Parking & Access',
    icon:        '🅿',
    description: 'Parking rates + driveway requirements',
    docFilter:   'dcp',
  },
  {
    id:          'heritage',
    title:       'Heritage Considerations',
    icon:        '▣',
    description: 'HCA, listing, HIS requirements',
    docFilter:   'lep',
  },
  {
    id:          'contributions',
    title:       'Contributions & Levies',
    icon:        '$',
    description: 's7.11 and s7.12 plans',
    docFilter:   'lep',
  },
]

// ── Question builders (zone + land-use aware) ──────────────────────────

function buildQuestion(slot: LegalCardSlot, gis: GISResult, lga: string): string {
  const zone = gis.zone ? `Zone ${gis.zone}` : 'the subject zone'
  const lep  = gis.lepName || `${lga} LEP`

  switch (slot.id) {
    case 'clause_46':
      return `Under ${lep} clause 4.6, what development standards can be varied in ${zone}? What are the criteria and tests the consent authority applies when considering a variation to building height, floor space ratio, or minimum lot size?`

    case 'subdivision':
      return `What are the subdivision requirements for land in ${zone} under ${lep}? Include minimum lot size, minimum frontage, Torrens vs strata subdivision rules, and any exceptions for dual occupancies, attached dwellings, or existing undersized lots.`

    case 'secondary_dwelling':
      return `What are the conditions and limits for building a secondary dwelling (granny flat) on land in ${zone} in ${lga}? Cover: minimum lot size, maximum floor area, permissibility under ${lep}, and the Housing SEPP 2021 secondary dwelling provisions. Is it permitted without consent as complying development?`

    case 'dual_occupancy':
      return `What are the requirements for a dual occupancy in ${zone} under ${lep}? Include minimum site area, attached vs detached permissibility, front/side/rear setbacks, subdivision restrictions, and any zone-specific conditions.`

    case 'setbacks_envelope':
      return `What setbacks and building envelope controls apply to residential development in ${zone} in ${lga}? Include front setback, side setback, rear setback, building height, height plane/sky exposure, site coverage, and landscaped area requirements from the ${lga} DCP.`

    case 'parking_access':
      return `What are the off-street parking rates and vehicular access requirements for residential development in ${zone} in ${lga}? Include rates per dwelling house, secondary dwelling, dual occupancy, multi-dwelling housing, and visitor parking. Include driveway width and garage requirements from the ${lga} DCP.`

    case 'heritage':
      return `What heritage provisions apply under ${lep}? Include heritage conservation areas in ${lga}, listed heritage items in ${zone} if any, heritage impact statement requirements, and controls on demolition, alteration, or new buildings on heritage land. Cite ${lep} clause 5.10.`

    case 'contributions':
      return `What development contributions plans apply to development in ${lga}? Include any s7.11 local infrastructure contributions, s7.12 fixed-levy plans, and special contributions areas. What's the typical rate per dwelling or per square metre of gross floor area?`
  }
}

// ── Runner ─────────────────────────────────────────────────────────────

export interface RunDeepLegalCardsInput {
  gis:          GISResult
  lga:          string
  deepinfraKey: string
  geminiKey?:   string
  emit:         (type: string, payload: any) => void
  step:         (agent: string, status: string, message: string, detail?: string) => void
}

export async function runDeepLegalCards(input: RunDeepLegalCardsInput): Promise<LegalCardResult[]> {
  const { gis, lga, deepinfraKey, geminiKey, emit, step } = input

  // Emit init so the frontend can render placeholders for all 8 slots
  emit('legal_cards_init', { slots: LEGAL_CARDS })
  step('Legal Cards', 'running', `Firing ${LEGAL_CARDS.length} deep legal queries…`)

  const tasks = LEGAL_CARDS.map(async (slot): Promise<LegalCardResult> => {
    const t0 = Date.now()
    try {
      const q = buildQuestion(slot, gis, lga)
      const res = await runGraphQuery({
        query:         q,
        lgaFilter:     lga,
        docTypeFilter: slot.docFilter ?? undefined,
        apiKey:        deepinfraKey,
        geminiKey,
      })
      const result: LegalCardResult = {
        id:        slot.id,
        answer:    res.answer,
        citations: res.citations,
        ms:        Date.now() - t0,
        error:     null,
      }
      emit('legal_card', result)
      return result
    } catch (err) {
      const result: LegalCardResult = {
        id:        slot.id,
        answer:    '',
        citations: [],
        ms:        Date.now() - t0,
        error:     (err as Error).message,
      }
      emit('legal_card', result)
      return result
    }
  })

  const results = await Promise.allSettled(tasks)
  const ok    = results.filter((r) => r.status === 'fulfilled' && !(r as any).value.error).length
  const total = LEGAL_CARDS.length
  step('Legal Cards', 'done', `${ok}/${total} cards resolved`)

  return results.map((r) => (r.status === 'fulfilled'
    ? r.value
    : { id: 'clause_46' as CardId, answer: '', citations: [], ms: 0, error: String((r as any).reason) }))
}
