/**
 * Follow-up question handler — routes like a professional urban planner.
 *
 * Routes:
 *   context_only  → answer from property facts + prior report, no KG.
 *   use_check     → "can I build X?" — check permitted uses + CDC eligibles
 *                   in context; if the use isn't listed or user asks why,
 *                   fall through to LEP lookup.
 *   cdc_sepp      → CDC / complying development / Codes SEPP questions → SEPP.
 *   dcp_controls  → setbacks, height controls, parking, landscape, design,
 *                   heritage controls, flood controls → DCP.
 *   new_lookup    → anything else → full KG pipeline.
 */

import { callLLM } from '../utils/sitewise/llm'
import { runQuery } from '../utils/nsw-kg/query/orchestrator'

function sseWrite(res: any, event: string, data: object) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

interface FollowupBody {
  question: string
  property: any
  permittedUses?: string[]
  previousAnswer?: string
}

type Route = 'context_only' | 'use_check' | 'cdc_sepp' | 'dcp_controls' | 'new_lookup'

function classifyRoute(q: string, previousAnswer: string): Route {

  // 1. Clarification of prior answer → context_only
  if (previousAnswer && /(above|previous|earlier|you (said|mentioned|wrote)|your (answer|response)|this report)/i.test(q)) {
    return 'context_only'
  }
  if (/^(what does|what is|explain|clarify|tell me more|can you (explain|clarify|elaborate)|summari[sz]e|tl;?dr|in (plain|simple) (english|terms))/i.test(q)) {
    return 'context_only'
  }

  // 2. CDC / Codes SEPP
  if (/\b(cdc|complying development|codes sepp|exempt development|state environmental planning policy.*codes)\b/i.test(q)) {
    return 'cdc_sepp'
  }

  // 3. Permissibility / "can I build" / "is X allowed"
  if (/\b(can i|could i|am i allowed to|is it (possible|allowed|permitted))\b/i.test(q) ||
      /\b(is|are) (a |an )?[\w\s-]{2,40} (permitted|allowed|permissible|ok)\b/i.test(q) ||
      /\b(build|construct|develop|put up|erect|subdivide|convert).{0,40}\b(here|on (this|the) (lot|site|property|land))/i.test(q)) {
    return 'use_check'
  }

  // 4. DCP-style development controls
  if (/\b(setback|boundary offset|side boundary|front boundary|rear boundary|landscape|landscaped area|deep soil|private open space|pos|solar access|overshadow|privacy|parking|car space|driveway|waste|bin|articulation|fa[çc]ade|design|character|streetscape|fence|retaining wall|excavation|cut and fill|site coverage|floor space|gross floor area|gfa|storey|stories|storeys|deck|balcony|pool|granny flat|secondary dwelling|dual occupancy)\b/i.test(q)) {
    return 'dcp_controls'
  }

  // 5. Plain property-fact questions → context_only
  if (/\b(what(\s|'s)(is)?\s*(the|my)?\s*(zone|zoning|fsr|floor space ratio|height|max height|lep|lga|council|lot size|min lot|area|suburb|heritage|flood|bushfire))/i.test(q)) {
    return 'context_only'
  }

  return 'new_lookup'
}

function buildContextBlock(p: any, permittedUses: string[], previousAnswer: string): string {
  const area = p.area_sqm ? Number(p.area_sqm) : null
  const frontage = p.frontage_m ? Number(p.frontage_m) : null
  const minLot = p.min_lot_size ? Number(p.min_lot_size) : null
  const fsr = p.fsr_value ? Number(p.fsr_value) : null
  const height = p.max_height_m ? Number(p.max_height_m) : null

  const facts: string[] = [
    `Address: ${p.address || 'unknown'}`,
    `LGA: ${p.lga_name || 'N/A'}`,
    `LEP: ${p.lep_name || 'N/A'}`,
    `Zone: ${p.zone || 'unknown'}${p.zone_class ? ' — ' + p.zone_class : ''}`,
  ]
  if (area) facts.push(`Lot area: ${Math.round(area)} sqm`)
  if (frontage) facts.push(`Frontage / width: ${frontage} m`)
  if (minLot) facts.push(`Min lot size (LEP cl.4.1): ${minLot} sqm`)
  if (fsr) facts.push(`FSR: ${fsr}:1${area ? ` → max GFA ≈ ${Math.round(area * fsr)} sqm` : ''}`)
  if (height) facts.push(`Max building height: ${height} m (≈ ${Math.floor(height / 3.1)} storeys)`)
  if (p.dcp_plan_name) facts.push(`DCP in force: ${p.dcp_plan_name}`)

  const env: string[] = []
  if (p.heritage_name) env.push(`Heritage: ${p.heritage_name}${p.heritage_class ? ' (' + p.heritage_class + ')' : ''} — DA required even for otherwise-exempt works; character controls apply`)
  if (p.floodmapping) env.push(`Flood-affected: ${p.floodmapping} — habitable floor level & evacuation controls apply; can disqualify CDC`)
  if (p.bushfireproneland) env.push(`Bushfire-prone: ${p.bushfireproneland} — Planning for Bushfire Protection (BAL) assessment required; can disqualify CDC`)
  if (p.biodiversity) env.push(`Biodiversity: ${p.biodiversity} — BDAR may be triggered`)
  if (p.acid_sulfate) env.push(`Acid sulfate soils: ${p.acid_sulfate} — excavation/dewatering controls (LEP cl.6.1)`)
  if (p.landsliderisk) env.push(`Landslide risk: ${p.landsliderisk} — geotechnical assessment required`)
  if (p.groundwatervulnerability) env.push(`Groundwater vulnerability: ${p.groundwatervulnerability}`)
  if (p.coastal_wetlands) env.push(`Coastal wetlands: ${p.coastal_wetlands}`)
  if (p.coastal_environment_area) env.push(`Coastal environment area: ${p.coastal_environment_area}`)
  if (p.coastal_use_area) env.push(`Coastal use area: ${p.coastal_use_area}`)
  if (p.riparianlandwatercourse) env.push(`Riparian land/watercourse: ${p.riparianlandwatercourse}`)
  if (p.drinking_water_catchment) env.push(`Drinking water catchment: ${p.drinking_water_catchment}`)
  if (p.scenicprotectionland) env.push(`Scenic protection land: ${p.scenicprotectionland}`)
  if (p.mine_subsidence_district) env.push(`Mine subsidence district: ${p.mine_subsidence_district}`)
  if (p.contamination_sitename) env.push(`Contamination: ${p.contamination_sitename} — site audit likely required`)

  // ── Pre-computed planner assessment (gating flags) ─────────────────────
  const assess: string[] = []
  if (area && minLot) {
    const ratio = area / minLot
    if (area < minLot) assess.push(`⚠ Lot is UNDER min lot size (${Math.round(area)} < ${minLot} sqm, ${(ratio*100).toFixed(0)}%) — subdivision to create new lots prohibited; some uses with area thresholds (dual occ, multi-dwelling) may not be available.`)
    else if (ratio >= 2) assess.push(`✓ Lot comfortably exceeds min lot size (${Math.round(area)} sqm vs ${minLot} min, ${ratio.toFixed(1)}×) — subdivision potentially possible subject to DCP.`)
    else assess.push(`✓ Lot meets min lot size (${Math.round(area)} ≥ ${minLot} sqm) but not large enough to subdivide into two compliant lots.`)
  }
  if (frontage) {
    if (frontage < 12) assess.push(`⚠ Narrow frontage (${frontage} m) — many dual-occ / multi-dwelling DCP standards require ≥ 15 m; check specific DCP frontage clause.`)
    else if (frontage >= 15) assess.push(`✓ Frontage ${frontage} m meets typical DCP minimums for dual-occ / battle-axe configurations.`)
  }
  if (area && fsr) assess.push(`Indicative max GFA: ${Math.round(area * fsr)} sqm (before DCP setbacks, POS, landscape reductions — real GFA will be lower).`)
  const constraintCount = env.length
  if (constraintCount === 0) assess.push(`✓ No mapped environmental constraints (heritage / flood / bushfire / biodiversity).`)
  else assess.push(`⚠ ${constraintCount} environmental constraint(s) apply — each can independently trigger DA pathway, add design controls, or disqualify CDC.`)
  if (p.cdc_eligible === 'true' && constraintCount === 0) assess.push(`✓ CDC pathway likely viable (${p.total_cdc_eligible || 'multiple'} pathways flagged, no disqualifying constraints).`)
  else if (p.cdc_eligible === 'true' && constraintCount > 0) assess.push(`⚠ CDC flagged available but environmental constraints may exclude specific pathways — verify against the Codes SEPP clause.`)
  else assess.push(`✗ CDC not flagged — DA pathway required.`)

  let block = `KNOWN PROPERTY FACTS:\n${facts.join('\n')}`
  if (env.length) block += `\n\nENVIRONMENTAL & HERITAGE CONSTRAINTS:\n${env.join('\n')}`
  else block += `\n\nENVIRONMENTAL & HERITAGE CONSTRAINTS:\nNone mapped.`

  block += `\n\nPLANNER ASSESSMENT (derived):\n- ${assess.join('\n- ')}`

  if (permittedUses?.length) {
    block += `\n\nPERMITTED USES IN ZONE ${p.zone} (from LEP land-use table):\n${permittedUses.slice(0, 60).join(', ')}`
  }

  if (previousAnswer && previousAnswer.length > 50) {
    block += `\n\nPREVIOUS REPORT (excerpt):\n${previousAnswer.slice(0, 3000)}`
  }
  return block
}

const PLANNER_PERSONA = `You are a senior NSW urban planner answering a follow-up question about one specific property. Reason like a professional — do not just list facts.

Reasoning checklist (apply silently, reflect in the answer):
1. ZONING — is the proposed use in the permitted list for this zone? If not listed, it is prohibited.
2. LOT DIMENSIONS — does lot area meet the LEP min lot size? Does frontage meet the DCP minimum for the proposed built form? Is the lot big enough for required setbacks, POS, and deep soil?
3. DEVELOPMENT STANDARDS — FSR and height caps, indicative GFA.
4. ENVIRONMENTAL & HERITAGE CONSTRAINTS — heritage forces DA and character controls; flood/bushfire add design requirements and often disqualify CDC; biodiversity can trigger BDAR.
5. PATHWAY — CDC vs DA, based on eligibility flag AND constraints.
6. CONCLUSION — yes / yes-with-conditions / no, and the single biggest risk or blocker.

The PLANNER ASSESSMENT block in the context has pre-computed gating flags (⚠ = concern, ✓ = compliant, ✗ = blocker) — trust and use them.

NO-HEDGING RULE — critical:
- You have the full property fact set AND the retrieved KG content. Do NOT say "subject to compliance", "better to check with council", "consult a planner", "verify with council", or similar generic disclaimers. These are forbidden.
- Answer with the confidence of a planner who has already done the search. The user hired you to give the answer, not to tell them to ask someone else.
- If — and only if — a SPECIFIC required input is missing (e.g. "no survey plan so exact frontage unknown"), state exactly which datum is missing and what it would change. Never a generic caveat.
- Conclude with a clear verdict: Yes / Yes-with-conditions (list them) / No / Needs-DA. Never trail off.

Formatting:
- Plain prose, 1-4 short paragraphs. Lead with the verdict on line one.
- Bullet list only for 3+ discrete items.
- NO markdown headings. NO forced "LEP/SEPP/DCP" sections.
- Bold only numeric values with units (e.g. **8.5 m**, **2:1 FSR**, **450 sqm**).
- Cite clauses with [sec.x.y] markers only when quoting retrieved KG content.`

async function streamDirectAnswer(res: any, config: any, system: string, user: string) {
  const useGroq = !!config.groqApiKey
  const result = await callLLM({
    provider: useGroq ? 'groq' : 'deepinfra',
    model: useGroq ? 'llama-3.3-70b-versatile' : 'meta-llama/Llama-3.3-70B-Instruct',
    system,
    user,
    apiKey: useGroq ? config.groqApiKey : config.deepinfraApiKey,
    temperature: 0.15,
    maxTokens: 900,
    timeoutMs: 30_000,
  })
  const text = result?.content ?? ''
  const CHUNK = 30
  for (let i = 0; i < text.length; i += CHUNK) {
    sseWrite(res, 'answer_chunk', { text: text.slice(i, i + CHUNK) })
  }
  sseWrite(res, 'citations', { citations: [], cite_index: {} })
  sseWrite(res, 'done', {})
  res.end()
}

export default defineEventHandler(async (event) => {
  const body = await readBody<FollowupBody>(event)
  const { question, property, permittedUses = [], previousAnswer = '' } = body || {} as any

  if (!question?.trim() || !property) {
    throw createError({ statusCode: 400, message: 'Missing question or property' })
  }

  const config = useRuntimeConfig()
  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const route = classifyRoute(question, previousAnswer)
  sseWrite(res, 'intent', { intent: route })

  const contextBlock = buildContextBlock(property, permittedUses, previousAnswer)

  try {
    // ── context_only ─────────────────────────────────────────────────────
    if (route === 'context_only') {
      await streamDirectAnswer(res, config,
        PLANNER_PERSONA + `\n\nAnswer using ONLY the context provided. Do not invent facts.`,
        `${contextBlock}\n\nFOLLOW-UP QUESTION: ${question}`)
      return
    }

    // ── use_check ────────────────────────────────────────────────────────
    // If the asked use is clearly in the permitted-uses list, answer from
    // context + CDC flag. Otherwise escalate to LEP lookup.
    if (route === 'use_check') {
      const asked = question.toLowerCase()
      const hit = permittedUses.find((u: string) => {
        const uL = u.toLowerCase()
        return asked.includes(uL) || uL.split(/\s+/).every((tok: string) => tok.length > 3 && asked.includes(tok))
      })
      if (hit) {
        await streamDirectAnswer(res, config,
          PLANNER_PERSONA + `\n\nThe user is asking about permissibility. The use appears in the zone's permitted-uses list. Confirm it, then advise on which development standards and environmental constraints will actually govern the proposal (FSR, height, min lot size, setbacks from DCP, flood/bushfire/heritage impacts). Flag if CDC is available.`,
          `${contextBlock}\n\nMATCHED USE IN PERMITTED LIST: "${hit}"\n\nFOLLOW-UP QUESTION: ${question}`)
        return
      }
      // Not in list → escalate to LEP lookup to check prohibited/permitted-with-consent
      const enriched = `${question}\n\n${contextBlock}\n\nPIPELINE: (1) identify which LEP/SEPP clause governs this use in this zone; (2) verify each criterion (permissibility, min lot size, frontage, environmental overlays) against the retrieved KG content; (3) give a firm verdict — Yes / Yes-with-conditions / No / Needs-DA. Do NOT hedge with "check with council" or "subject to compliance" — the facts are in front of you. If prohibited, name the nearest permissible alternative.`
      await runQuery({
        query: enriched,
        lgaFilter: property.lga_name || undefined,
        docTypeFilter: 'lep',
        apiKey: config.deepinfraApiKey,
        geminiKey: config.googleGeminiApiKey,
        groqKey: config.groqApiKey,
        res,
      })
      return
    }

    // ── cdc_sepp ─────────────────────────────────────────────────────────
    if (route === 'cdc_sepp') {
      const enriched = `${question}\n\n${contextBlock}\n\nPIPELINE: (1) identify which Codes SEPP pathway the question targets (General Housing Code, Housing Alterations Code, Rural Housing Code, etc.); (2) list the eligibility criteria for that pathway; (3) verify each criterion against the property facts (zone, lot area, frontage, heritage, flood, bushfire, biodiversity) — mark each pass/fail; (4) give a firm verdict: CDC available / CDC blocked by [specific criterion] / DA required. Cite the SEPP clause. Do NOT hedge — the constraint data is complete.`
      await runQuery({
        query: enriched,
        lgaFilter: property.lga_name || undefined,
        docTypeFilter: 'sepp',
        apiKey: config.deepinfraApiKey,
        geminiKey: config.googleGeminiApiKey,
        groqKey: config.groqApiKey,
        res,
      })
      return
    }

    // ── dcp_controls ─────────────────────────────────────────────────────
    if (route === 'dcp_controls') {
      const enriched = `${question}\n\n${contextBlock}\n\nPIPELINE: (1) locate the specific DCP clause(s) governing the asked control; (2) determine the correct control band using this property's lot area, frontage, zone, and constraints (DCP standards usually scale); (3) state the numeric requirement that applies to THIS lot — not the general range; (4) note any constraint-driven overlay (heritage character, flood FFL, BAL). Cite the DCP clause. Do NOT hedge — give the number that applies here.`
      await runQuery({
        query: enriched,
        lgaFilter: property.lga_name || undefined,
        docTypeFilter: 'dcp',
        apiKey: config.deepinfraApiKey,
        geminiKey: config.googleGeminiApiKey,
        groqKey: config.groqApiKey,
        res,
      })
      return
    }

    // ── new_lookup (general) ─────────────────────────────────────────────
    const enriched = `${question}\n\n${contextBlock}\n\nPIPELINE: (1) derive the criteria this question requires (zoning, dimensions, standards, constraints, pathway); (2) verify each criterion against the KG content you retrieved and the property facts above; (3) synthesise a firm answer. Cite [sec.x.y] when quoting KG content. Do NOT force LEP/SEPP/DCP section headings. Do NOT hedge with "subject to compliance" or "check with council" — you have the data, give the verdict.`
    await runQuery({
      query: enriched,
      lgaFilter: property.lga_name || undefined,
      apiKey: config.deepinfraApiKey,
      geminiKey: config.googleGeminiApiKey,
      groqKey: config.groqApiKey,
      res,
    })
  } catch (err) {
    sseWrite(res, 'error', { message: (err as Error).message || String(err) })
    try { res.end() } catch {}
  }
})
