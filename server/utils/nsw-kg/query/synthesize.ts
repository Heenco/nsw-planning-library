// ── Stage E — synthesis ─────────────────────────────────────────────────
//
// Builds a context block from the kept propositions, sends it to the LLM
// with a strict "answer only from the propositions, cite every claim"
// system prompt, streams the response back as text chunks via the
// onChunk callback, then extracts the citations the LLM emitted.

import type { Citation, FilteredContext, OverrideDecision, RetrievalCandidate, QueryPlan } from './types'
import { formatSectionId, shortDocumentLabel } from '../../../../shared/citation-format'

// Provider config — Groq is preferred because its LPU inference runs
// Llama 3.3 70B at ~10× the throughput of DeepInfra (~500-1000 tok/s vs
// ~50-80 tok/s). Same model weights, different inference engine, so
// answer quality is identical. DeepInfra stays as the fallback when
// Groq is unavailable or rate-limited.
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL   = 'llama-3.3-70b-versatile'
const FALLBACK_URL   = 'https://api.deepinfra.com/v1/openai/chat/completions'
const FALLBACK_MODEL = 'meta-llama/Llama-3.3-70B-Instruct'

// Cap the number of propositions sent to the LLM. The default is generous
// (60) and we trim by RRF score / source priority.
const MAX_CONTEXT_PROPS = 60

export interface SynthesizeOptions {
  query:    string
  plan:     QueryPlan
  context:  FilteredContext
  /** DeepInfra key — always required as the fallback path. */
  apiKey:   string
  /** Optional Groq key — when present, Groq is tried first for ~10× faster
   *  streaming. Falls back to DeepInfra on any error (timeout, 429, 5xx). */
  groqKey?: string
  /** Optional override for the default NSW planning system prompt. Use-case
   *  specific callers (e.g. per-use controls analysis) inject their own prompt
   *  while still getting the full retrieval + citation pipeline. */
  systemPrompt?: string
  /**
   * Sources supplied to the model as established facts rather than retrieved.
   *
   * The report hands the model DCP controls straight from nsw.rule_effect,
   * because the proposition layer never captured those tables. The model then
   * cites the clause it was given, extractCitations finds no matching retrieval
   * candidate, and the chip renders as an unresolvable [?]. Listing them here
   * makes exactly the clauses we supplied citable — and nothing else, so a
   * clause the model invents still fails to resolve.
   */
  citableExtras?: RetrievalCandidate[]
  onChunk:  (text: string) => void
}

export interface SynthesizeResult {
  full_text:  string
  citations:  Citation[]
  /** Map from raw section_local_id (lowercase) → 1-based citation number.
   *  Used by the frontend to replace `[sec.x.y]` markers with `<sup>N</sup>`. */
  cite_index: Record<string, number>
  ms:         number
}

// ── Citation extractor ─────────────────────────────────────────────────
//
// We tell the LLM to cite using the format [<section_local_id>] inline.
// After streaming completes, we scan the full text for these markers and
// resolve each one to its proposition row.

const CITATION_RE = /\[((?:sec|cl|sch|pt|ch|dict)\.[\w.-]+(?:#\d+)?|dcp\.[\w.#-]+)\]/gi

/** Walk the LLM output for [sec.x.y] markers in order, dedupe by
 *  section_local_id, and build a numbered Citation list. Also returns
 *  cite_index so the frontend can substitute raw markers with numbers. */
function extractCitations(
  text: string,
  candidates: RetrievalCandidate[],
): { citations: Citation[]; cite_index: Record<string, number> } {
  const cite_index: Record<string, number> = {}
  const ordered: Citation[] = []
  const matches = text.matchAll(CITATION_RE)

  for (const m of matches) {
    const ref = (m[1] || '').trim().toLowerCase()
    if (!ref) continue
    if (cite_index[ref] != null) continue   // already numbered

    const hit = candidates.find((c) => c.section_local_id.toLowerCase() === ref)
    if (!hit) continue                       // hallucinated id, skip silently

    const number = ordered.length + 1
    cite_index[ref] = number
    ordered.push(buildCitation(hit, number))
  }

  return { citations: ordered, cite_index }
}

/**
 * Map document_title → doc-viewer key. The doc-viewer page at
 * /doc-viewer?doc=<key> uses these keys to resolve the MD file.
 * Keys must match DOC_MAP in app/pages/doc-viewer.vue.
 */
/**
 * Slug for a document we hold locally, so a citation can open in /doc-viewer
 * at the exact clause instead of leaving the app.
 *
 * Hornsby was missing, which is why its DCP citations rendered as dead text:
 * with no key, clause_url stayed null and the renderer emitted a span.
 *
 * LEPs are included now too. The XML-to-HTML conversion carries the source's
 * own ids, so a citation's section_local_id ("sec.4.6") is already the anchor
 * in our rendered copy — the deep link lands on the clause.
 */
function docViewerKey(title: string, docType?: string): string | null {
  const t = (title || '').toLowerCase()

  if (docType === 'dcp') {
    if (t.includes('hornsby')) return 'hornsby-dcp-2024'
    if (t.includes('albury')) return 'albury-dcp'
    if (t.includes('georges river')) return 'georges-river-dcp'
    if (t.includes('parramatta')) return 'parramatta-dcp'
    if (t.includes('randwick')) return 'randwick-dcp'
    if (t.includes('liverpool')) {
      if (t.includes('schedule 1')) return 'liverpool-dcp-sch1'
      if (t.includes('schedule 2')) return 'liverpool-dcp-sch2'
      if (t.includes('schedule 3')) return 'liverpool-dcp-sch3'
      return 'liverpool-dcp-main'
    }
    return null
  }

  // LEP / SEPP: instruments.json slugs are the kebab-cased title.
  if (t.includes('local environmental plan') || t.includes('state environmental planning policy')) {
    return t.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }
  return null
}

/** Build a Citation from a RetrievalCandidate. */
function buildCitation(c: RetrievalCandidate, number: number): Citation {
  const isLegislation = c.document_doc_type === 'lep' || c.document_doc_type === 'sepp'

  // Hotlink priority:
  //   1. LEP/SEPP: document.source_url + #section_local_id (NSW PCO URLs)
  //   2. DCP: /doc-viewer?doc=<key>&anchor=<section_local_id>
  //      — opens the Docling-rendered markdown in-app, jumps to the section
  //   3. Otherwise: null (the UI will fall back to document_source_url)
  let clause_url: string | null = null
  const viewerKey = docViewerKey(c.document_title, c.document_doc_type)
  if (viewerKey) {
    // Our own rendering, anchored at the clause — keeps the reader in the app
    // and works for the DCP, which has no public per-clause URL.
    clause_url = `/doc-viewer?doc=${viewerKey}&anchor=${encodeURIComponent(c.section_local_id)}`
  } else if (isLegislation && c.document_source_url) {
    clause_url = `${c.document_source_url}#${c.section_local_id}`
  }

  // Trim source_quote to first sentence or 200 chars
  const span = (c.source_span || '').trim()
  let source_quote = span
  const firstStop = span.search(/[.!?](?:\s|$)/)
  if (firstStop > 20 && firstStop < 240) {
    source_quote = span.slice(0, firstStop + 1)
  } else if (span.length > 200) {
    source_quote = span.slice(0, 200) + '…'
  }

  return {
    proposition_id:   c.id,
    section_local_id: c.section_local_id,
    section_number:   c.section_number,
    section_heading:  c.section_heading,
    document_label:   docLabel(c.document_doc_type),
    document_title:   c.document_title,
    source_url:       c.document_source_url,
    clause_url,
    number,
    citation_label:   formatSectionId(c.section_local_id, c.document_doc_type),
    document_short:   shortDocumentLabel(c.document_title, c.document_doc_type),
    doc_type:         c.document_doc_type,
    source_quote,
  }
}

function docLabel(doc_type: string): string {
  switch (doc_type) {
    case 'lep':  return 'LEP'
    case 'sepp': return 'SEPP'
    case 'dcp':  return 'DCP'
    default:     return doc_type.toUpperCase()
  }
}

// ── Context formatter ──────────────────────────────────────────────────

function formatProposition(c: RetrievalCandidate, idx: number): string {
  const lines: string[] = []
  lines.push(`${idx}. [${c.section_local_id}] (${c.document_doc_type.toUpperCase()} · ${c.type})`)

  let factLine = `   ${c.subject} ${c.predicate}`
  if (c.object) factLine += ` ${c.object}`
  if (c.numeric_value != null) {
    factLine += `  →  ${c.numeric_comparator ?? ''} ${c.numeric_value}${c.numeric_unit ? ' ' + c.numeric_unit : ''}`
  } else if (c.value_source) {
    factLine += `  →  defers to ${c.value_source}`
  }
  lines.push(factLine)

  if (c.source_span && c.source_span.length < 240) {
    lines.push(`   "${c.source_span}"`)
  } else if (c.source_span) {
    lines.push(`   "${c.source_span.slice(0, 240)}…"`)
  }
  return lines.join('\n')
}

function buildContextBlock(context: FilteredContext): string {
  // Prioritise: retrieved (rank-sorted) first, then expanded
  const retrieved = context.kept.filter((c) => c.source === 'retrieved')
  const expanded  = context.kept.filter((c) => c.source === 'expanded')

  const ordered = [
    ...retrieved.sort((a, b) => b.rrf_score - a.rrf_score),
    ...expanded,
  ].slice(0, MAX_CONTEXT_PROPS)

  return ordered.map((c, i) => formatProposition(c, i + 1)).join('\n\n')
}

function buildOverridesBlock(decisions: OverrideDecision[]): string {
  if (decisions.length === 0) return ''
  const lines: string[] = []
  lines.push('OVERRIDES (these LEP/DCP propositions are dropped because higher-tier instruments override them):')
  for (const d of decisions) {
    lines.push(
      `  • "${d.loser_subject}" from ${d.loser_doc} (level ${d.loser_level}) ` +
      `overridden by ${d.winner_doc} (level ${d.winner_level})`,
    )
  }
  return lines.join('\n')
}

// ── System prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a NSW planning law assistant. Your job is to answer questions about NSW Local Environmental Plans (LEP), State Environmental Planning Policies (SEPP), and Development Control Plans (DCP).

CRITICAL RULES:
1. Answer ONLY from the sources provided. Never use general knowledge.
2. CITE a claim only with a proposition that actually states it. Use the EXACT section id, like [sec.4.3-ssec.2] or [dcp.10.4.2].
2a. NEVER attach a citation to a fact that no source states. An absence is never citable: "no floor space ratio is mapped for this lot" and "no minimum lot size applies" come from the site context and take no clause reference at all, because no clause says a standard is absent. For example, the zone of a parcel comes from the site context, not from a clause — write "is in zone R2" with no citation, never "is in zone R2 [sec.6.9]". Facts given in the site context (zone, mapped height, minimum lot size, lot dimensions) are already established — report them plainly, and say where they came from ("from the Height of Buildings Map", "from the property record"). A wrong citation is worse than none. Square brackets are reserved for citation markers: write "from the Height of Buildings Map" as ordinary prose, never "[from the property record]", which renders as a broken citation chip.
2b. If the sources do not cover something the question asks about, say the instruments do not state it — "the DCP does not set a site coverage control for this use". Do not substitute a nearby clause, and do not describe the state of this system.
3. If a value is "deferred to map:Xxx_Map", say so explicitly — never invent a numeric value.
4. If the sources don't contain enough to answer, say which instrument is silent on the point.
5. Prefer the higher-tier source when multiple instruments cover the same topic. SEPPs override LEPs, and the propositions block will tell you when overrides apply.
6. A DCP section applies only to the development type named in its heading. If a proposition comes from a section about a different development type (for example "Garden Centres" or "Industrial Development" when the question is about a dwelling), it does not apply here — leave it out rather than reporting it as a control.
7. Do not convert a control for one boundary into another. Front, rear, side and secondary setbacks are separate controls with separate values.
8. Never use the words "proposition", "knowledge base", "provided context" or "the data" in the answer. The reader is a planner reading a planning report, not a user of this system. Write "the LEP does not state" or "no floor space ratio is mapped for this lot", never "not explicitly stated in the provided propositions".
9. A standard that is absent is a finding, not a gap, and carries no citation. When the site context says no floor space ratio or no minimum lot size is mapped for the lot, report that plainly as the result — it means no such standard constrains the development, which is what the reader needs to know. Do not hedge it as missing information.
10. Do not write a sentence that carries no fact. Never write "certain", "some", "various" or "a certain limit" in place of the thing a control governs — if the source does not say what the 2.4m applies to, drop the control rather than writing "the maximum height of certain elements is 2.4m". Likewise "a dwelling cannot be erected on a lot below the minimum lot size" says nothing when no minimum lot size applies. Name the thing or leave it out.
11. Do not contradict the site context. If it says no minimum lot size or no floor space ratio is mapped, do not then write that development is "subject to the minimum lot size" — no such standard applies here, and a clause that mentions one does not reinstate it. Say nothing further about it.
11a. The DCP controls are grouped by land use, most significant for this lot first. Report the first group in full and name the use it belongs to ("For a residential flat building..."). Where a later group states materially different figures, give those too under their own use. Never merge two uses into one set of numbers, and never answer an R3 or R4 lot as though a dwelling house were the only thing that could be built on it.
12. A control shown with "[applies at N storeys]" only holds at that building scale. State the condition alongside the value ("12m at 3 storeys"), never the bare number — the same control takes a different value at another scale, and a height quoted without its band is the wrong height for most buildings.
13. Do not end with a coverage disclaimer. "No other relevant controls were found", "nothing further was located" and similar closing sentences describe this system rather than the planning controls, and they are wrong whenever a control exists that you simply did not list. Stop after the last fact.

FORMATTING RULES (strict):
• Plain prose, 1-3 short paragraphs. Lead with the direct answer.
• Bullet lists only when listing 3+ discrete items. Use "- " at line start.
• The DCP controls ARE such a list. Never run them together into one paragraph — one control per bullet, and a separate short lead-in line per land use.
• No markdown headings UNLESS the question specifies a section structure. When it does, use exactly the headings it names and no others.
• NEVER write a "Sources:" or "References:" section — the UI renders citations separately.
• NEVER end with a coverage sentence. "No other relevant provisions were found", "nothing further applies", "no other controls were located" — all forbidden. The last sentence of the answer must be a planning fact. This is the single most common thing to get wrong: stop writing after the last control.
• Use **bold** ONLY for numeric values with units (e.g. **8.5m**, **450 m²**, **2:1 FSR**).
• Do NOT bold clause references, section numbers, chapter numbers, years, zone codes, or instrument names. Leave them plain.
• Don't repeat the same citation more than necessary. If three facts come from the same clause, cite it once.

Cite using the format [<section_local_id>] — e.g. [sec.4.3-ssec.2] or [dcp.6.2.1].`

function buildUserPrompt(query: string, plan: QueryPlan, contextBlock: string, overridesBlock: string): string {
  const parts: string[] = []
  parts.push(`User question: """${query}"""`)
  if (plan.entities.lga || plan.entities.zone || plan.entities.land_use) {
    const ent: string[] = []
    if (plan.entities.lga) ent.push(`LGA: ${plan.entities.lga}`)
    if (plan.entities.zone) ent.push(`Zone: ${plan.entities.zone}`)
    if (plan.entities.land_use) ent.push(`Land use: ${plan.entities.land_use}`)
    parts.push(`Detected context: ${ent.join(' · ')}`)
  }
  parts.push('')
  parts.push('PROPOSITIONS:')
  parts.push(contextBlock)
  if (overridesBlock) {
    parts.push('')
    parts.push(overridesBlock)
  }
  parts.push('')
  parts.push('Now answer the question. Cite every claim using the section ids above. Markdown only.')
  return parts.join('\n')
}

// ── Streaming synthesizer ──────────────────────────────────────────────

interface StreamAttemptResult {
  ok:        true
  fullText:  string
  provider:  'groq' | 'deepinfra'
}
interface StreamAttemptFailure {
  ok:        false
  error:     string
  retryable: boolean
}
type StreamAttempt = StreamAttemptResult | StreamAttemptFailure

/**
 * One attempt at streaming synthesis from a given provider.
 * On success: returns the accumulated text after the stream ends AND
 *   has already forwarded each chunk to opts.onChunk during streaming.
 * On failure: returns { ok:false, retryable } so the caller can decide
 *   whether to fall back to a different provider.
 *
 * IMPORTANT: we only call opts.onChunk once we've successfully opened the
 * stream (HTTP 200 + body). If the HTTP call itself fails or returns an
 * error status, the UI sees nothing and can cleanly retry with a
 * fallback provider without double-printing.
 */
async function streamFromProvider(
  url:      string,
  model:    string,
  apiKey:   string,
  systemPrompt: string,
  userPrompt:   string,
  provider: 'groq' | 'deepinfra',
  onChunk:  (text: string) => void,
): Promise<StreamAttempt> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1500,
        stream: true,
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (err) {
    // Network / DNS / timeout before the response arrived
    return {
      ok: false,
      error: `${provider} fetch failed: ${(err as Error).message}`,
      retryable: true,
    }
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    // 429 rate limit and 5xx are retryable on the fallback provider.
    // 400/401/403 are not — the request is malformed or the key is bad.
    const retryable = res.status === 429 || res.status >= 500
    return {
      ok: false,
      error: `${provider} ${res.status}: ${body.slice(0, 200)}`,
      retryable,
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data).choices?.[0]?.delta?.content ?? ''
        if (chunk) {
          fullText += chunk
          onChunk(chunk)
        }
      } catch {}
    }
  }

  return { ok: true, fullText, provider }
}

export async function synthesize(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const t0 = Date.now()

  if (opts.context.kept.length === 0) {
    const text = "I couldn't find any propositions in the knowledge graph that match this question. Try rephrasing or being more specific about the document, zone, or topic."
    opts.onChunk(text)
    return { full_text: text, citations: [], cite_index: {}, ms: Date.now() - t0 }
  }

  const contextBlock = buildContextBlock(opts.context)
  const overridesBlock = buildOverridesBlock(opts.context.decisions)
  const userPrompt = buildUserPrompt(opts.query, opts.plan, contextBlock, overridesBlock)
  const systemPrompt = opts.systemPrompt || SYSTEM_PROMPT

  // Try Groq first when configured — ~10× faster streaming on the same
  // Llama 3.3 70B weights. Fall back to DeepInfra on any retryable error
  // (network, timeout, 429, 5xx). Non-retryable errors (bad key, malformed
  // request) bubble up as-is since the fallback would fail the same way.
  let result: StreamAttempt | null = null
  if (opts.groqKey) {
    result = await streamFromProvider(
      GROQ_URL, GROQ_MODEL, opts.groqKey,
      systemPrompt, userPrompt, 'groq', opts.onChunk,
    )
    if (!result.ok && !result.retryable) {
      throw new Error(`Synthesis failed: ${result.error}`)
    }
    if (!result.ok) {
      console.warn(`[synthesize] Groq failed, falling back to DeepInfra: ${result.error}`)
    }
  }

  if (!result || !result.ok) {
    result = await streamFromProvider(
      FALLBACK_URL, FALLBACK_MODEL, opts.apiKey,
      systemPrompt, userPrompt, 'deepinfra', opts.onChunk,
    )
    if (!result.ok) {
      throw new Error(`Synthesis failed: ${result.error}`)
    }
  }

  const fullText = result.fullText
  const { citations, cite_index } = extractCitations(
    fullText,
    [...opts.context.kept, ...(opts.citableExtras ?? [])],
  )

  return {
    full_text: fullText,
    citations,
    cite_index,
    ms: Date.now() - t0,
  }
}
