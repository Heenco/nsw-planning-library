// ── /api/use-analysis ───────────────────────────────────────────────────
//
// Given a property and a specific permissible use (e.g. "dual occupancy"),
// retrieve the use-scoped controls from LEP, SEPP, and DCP in parallel and
// stream each instrument's answer back as tagged SSE events:
//
//   lep_answer_chunk / sepp_answer_chunk / dcp_answer_chunk
//   lep_citations    / sepp_citations    / dcp_citations
//   lep_done         / sepp_done         / dcp_done
//
// The frontend routes each instrument into its own section (LEP / SEPP / DCP)
// on the report page.

import { runQuery } from '../utils/nsw-kg/query/orchestrator'

type Instrument = 'lep' | 'sepp' | 'dcp'

interface UseAnalysisBody {
  property: any
  use:      string
}

function sseWrite(res: any, event: string, data: object) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

// ── Professional, use-scoped system prompt ─────────────────────────────
//
// Baked per instrument — the base rules are identical; the trailing block
// tells the model which instrument it is answering for so it stays in its
// lane and does not duplicate what another instrument will cover.

const USE_ANALYSIS_BASE = `You are a senior NSW urban planner producing a use-specific controls summary for ONE property and ONE proposed land use. Your output is read by other planners, architects, and developers who need numeric controls and clause citations, not advice.

INPUTS YOU WILL RECEIVE
- PROPERTY FACTS: address, zone, LGA, LEP name, DCP name, lot area, frontage, FSR cap, height cap, min lot size, heritage, flood, bushfire, biodiversity, CDC flags.
- PROPOSED USE: a single land-use term as it appears in the LEP land-use table (e.g. "dual occupancy", "shop top housing", "boarding house", "secondary dwelling").
- PROPOSITIONS: clauses and standards retrieved from the instrument assigned to you — already filtered to this LGA and, where possible, to this use.

YOUR JOB
Produce the controls that apply to THIS USE on THIS LOT under the instrument you were given. Resolve the numbers down to this specific property wherever a control scales with lot attributes.

OUTPUT FORMAT — follow exactly

1. PERMISSIBILITY LINE (one sentence):
   "[Use] is [permitted without consent / permitted with consent / prohibited / permissible via SEPP override] in Zone [X] under [Instrument § clause]."

2. QUANTITATIVE CONTROLS (bullet list, only those that actually apply to this use on this lot):
   - Minimum lot size for this use: **N sqm** [clause]
   - Minimum frontage: **N m** [clause]
   - Maximum FSR / GFA: **N** or **N sqm** [clause]
   - Maximum height: **N m** / **N storeys** [clause]
   - Setbacks (front / side / rear): **N / N / N m** [clause]
   - Private open space / deep soil / landscaped area: **N sqm or %** [clause]
   - Parking rate: **N spaces per [unit/bedroom/GFA]** [clause]
   - Any use-specific numeric thresholds (e.g. max units, max guest rooms, communal open space) [clause]

3. DESIGN & PROCESS CONTROLS (short bullets, no numbers):
   - Character / streetscape / articulation requirements
   - Solar access, cross-ventilation, ADG-style rules where relevant
   - Heritage / flood / bushfire / biodiversity overlays that modify the above
   - Consent pathway: CDC / DA / LEC / integrated development / referrals

4. LOT-SPECIFIC ASSESSMENT (2-4 sentences):
   State whether this lot passes each gating numeric control using the property facts. Name any control this lot fails, and by how much. If a control depends on something unmapped (e.g. exact frontage from survey), say so in one clause and move on.

5. VERDICT (one line):
   Yes / Yes-with-conditions / No / Needs-DA — followed by the single biggest risk or blocker in ≤15 words.

RULES
- Cite every numeric control with [<section_local_id>] from the PROPOSITIONS. No matching clause → don't state the number.
- If the propositions don't cover a control, omit that bullet. Do NOT invent numbers from general zone controls unless they explicitly apply to this use.
- Compare every retrieved control to the property facts and apply it to this lot. Don't restate ranges.
- NO HEDGING. Do not write "consult a planner", "subject to compliance", "generally", "may be required", "verify with council". You are the planner.
- NO markdown headings beyond the 5 numbered sections above. NO preamble. NO summary paragraph.
- Bold only numbers with units.`

const INSTRUMENT_SUFFIX: Record<Instrument, string> = {
  lep: `\n\nINSTRUMENT FOCUS — LEP:
Stay on LEP content. Cover: land-use table permissibility for this use in this zone, definitions, Part 4 development standards (FSR, height, min lot size, frontage), and use-specific clauses (Clause 5.4 miscellaneous, dual occupancy / boarding house / secondary dwelling provisions). Do not restate DCP or SEPP controls — those are covered separately.`,
  sepp: `\n\nINSTRUMENT FOCUS — SEPP:
Stay on SEPP content. Cover: which SEPP chapter governs this use (Housing SEPP, Codes SEPP pathways, TOD/LMR overrides, Exempt/Complying Development Codes, Transport & Infrastructure SEPP). Call out any SEPP clause that REPLACES or OVERRIDES the LEP control for this use on this lot. Do not restate LEP or DCP.`,
  dcp: `\n\nINSTRUMENT FOCUS — DCP:
Stay on DCP content. Cover: the DCP chapter named after this use (or the residential chapter covering it). Give numeric DCP controls as they apply to this lot's frontage and area band (setbacks, POS, landscaping, deep soil, parking, building envelope, articulation). Do not restate LEP or SEPP.`,
}

// ── Query builder per instrument ───────────────────────────────────────

function buildPropertyContext(p: any): string {
  return [
    `Address: ${p.address || 'unknown'}`,
    `Zone: ${p.zone || 'unknown'}${p.zone_class ? ` (${p.zone_class})` : ''}`,
    `LGA: ${p.lga_name || 'unknown'}`,
    p.lep_name ? `LEP: ${p.lep_name}` : null,
    p.dcp_plan_name ? `DCP: ${p.dcp_plan_name}` : null,
    p.area_sqm ? `Lot area: ${Math.round(Number(p.area_sqm))} sqm` : null,
    p.min_lot_size ? `Zone min lot size: ${p.min_lot_size} ${p.lot_size_units || 'sqm'}` : null,
    p.primary_frontage_length_m ? `Primary frontage: ${p.primary_frontage_length_m} m` : null,
    p.min_width_m ? `Min lot width: ${p.min_width_m} m` : null,
    p.fsr_value ? `FSR cap: ${p.fsr_value}` : null,
    p.max_height_m ? `Max height cap: ${p.max_height_m} m` : null,
    p.is_corner_lot === 'true' ? 'Corner lot: Yes' : null,
    p.is_battleaxe === 'true' ? 'Battle-axe lot: Yes' : null,
    p.heritage_name ? `Heritage: ${p.heritage_name}` : null,
    p.floodmapping && p.floodmapping !== 'No' ? `Flood: ${p.floodmapping}` : null,
    p.bushfireproneland && p.bushfireproneland !== 'No' ? `Bushfire: ${p.bushfireproneland}` : null,
    p.biodiversity ? `Biodiversity: ${p.biodiversity}` : null,
    p.contamination_sitename ? `Contamination: ${p.contamination_sitename}` : null,
    p.cdc_eligible === 'true' ? `CDC flagged: Yes (${p.total_cdc_eligible || 'multiple'} pathways)` : 'CDC flagged: No',
    p.in_lmr_housing_area === 'true' ? 'In LMR Housing Area' : null,
  ].filter(Boolean).join('\n')
}

function buildQuery(use: string, p: any, instrument: Instrument): string {
  const ctx = buildPropertyContext(p)
  const zoneLabel = p.zone ? `Zone ${p.zone}` : 'the zone'

  const focus: Record<Instrument, string> = {
    lep: `Under the ${p.lep_name || 'applicable LEP'}, what controls apply to "${use}" in ${zoneLabel}? Cover: land-use table permissibility, definition of "${use}", Part 4 standards (min lot size, frontage, FSR, height) as they apply to THIS use (not the generic zone controls), and any use-specific LEP clauses.`,
    sepp: `Which State Environmental Planning Policies govern "${use}" in ${zoneLabel} in ${p.lga_name || 'this LGA'}? Cover: Housing SEPP chapters that apply to this use, Codes SEPP pathways (Exempt / Complying Development) for this use, TOD/LMR overrides if applicable, and any SEPP that overrides the LEP for this use.`,
    dcp: `Under the ${p.dcp_plan_name || 'applicable DCP'}, what detailed controls apply to "${use}" on a lot of this size and frontage in ${p.lga_name || 'this LGA'}? Cover: setbacks, POS, deep soil, landscaping, parking rates, building envelope / articulation, and any chapter specific to "${use}".`,
  }

  return [
    focus[instrument],
    '',
    'PROPOSED USE: ' + use,
    '',
    'PROPERTY FACTS:',
    ctx,
  ].join('\n')
}

// ── Handler ────────────────────────────────────────────────────────────

export default defineEventHandler(async (event) => {
  const body = await readBody<UseAnalysisBody>(event)
  const { property, use } = body || {} as any

  if (!property || !use?.trim()) {
    throw createError({ statusCode: 400, message: 'Missing property or use' })
  }

  const config = useRuntimeConfig()
  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  sseWrite(res, 'use_selected', { use })

  const instruments: Instrument[] = ['lep', 'sepp', 'dcp']

  // Fan out all three runQuery calls in parallel, each tagged so their
  // SSE events don't collide on the shared stream. keepOpen prevents
  // each orchestrator from ending the response prematurely.
  await Promise.allSettled(
    instruments.map((inst) =>
      runQuery({
        query:         buildQuery(use, property, inst),
        lgaFilter:     property.lga_name || undefined,
        docTypeFilter: inst,
        apiKey:        config.deepinfraApiKey,
        geminiKey:     config.googleGeminiApiKey,
        groqKey:       config.groqApiKey,
        systemPrompt:  USE_ANALYSIS_BASE + INSTRUMENT_SUFFIX[inst],
        eventTag:      inst,
        keepOpen:      true,
        res,
      }),
    ),
  )

  sseWrite(res, 'done', { ms: Date.now() })
  res.end()
})
