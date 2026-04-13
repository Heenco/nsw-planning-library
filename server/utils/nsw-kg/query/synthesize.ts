// ── Stage E — synthesis ─────────────────────────────────────────────────
//
// Builds a context block from the kept propositions, sends it to the LLM
// with a strict "answer only from the propositions, cite every claim"
// system prompt, streams the response back as text chunks via the
// onChunk callback, then extracts the citations the LLM emitted.

import type { Citation, FilteredContext, OverrideDecision, RetrievalCandidate, QueryPlan } from './types'
import { formatSectionId, shortDocumentLabel } from './citation-format'

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
function dcpDocKey(title: string): string | null {
  const t = title.toLowerCase()
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

/** Build a Citation from a RetrievalCandidate. */
function buildCitation(c: RetrievalCandidate, number: number): Citation {
  const isLegislation = c.document_doc_type === 'lep' || c.document_doc_type === 'sepp'

  // Hotlink priority:
  //   1. LEP/SEPP: document.source_url + #section_local_id (NSW PCO URLs)
  //   2. DCP: /doc-viewer?doc=<key>&anchor=<section_local_id>
  //      — opens the Docling-rendered markdown in-app, jumps to the section
  //   3. Otherwise: null (the UI will fall back to document_source_url)
  let clause_url: string | null = null
  if (isLegislation && c.document_source_url) {
    clause_url = `${c.document_source_url}#${c.section_local_id}`
  } else if (c.document_doc_type === 'dcp') {
    const key = dcpDocKey(c.document_title)
    if (key) {
      clause_url = `/doc-viewer?doc=${key}&anchor=${encodeURIComponent(c.section_local_id)}`
    }
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
1. Answer ONLY from the propositions provided. Never use general knowledge.
2. CITE every factual claim with the proposition's section id in square brackets, like [sec.4.3-ssec.2] or [dcp.10.4.2]. Use the EXACT section id from the propositions.
3. If a value is "deferred to map:Xxx_Map", say so explicitly — never invent a numeric value.
4. If the propositions don't contain enough information to answer, say so.
5. Prefer the higher-tier source when multiple instruments cover the same topic. SEPPs override LEPs, and the propositions block will tell you when overrides apply.

FORMATTING RULES (strict):
• Plain prose, 1-3 short paragraphs. Lead with the direct answer.
• Bullet lists only when listing 3+ discrete items. Use "- " at line start.
• NEVER emit markdown headings. No "#", "##", "###", "####" anywhere.
• NEVER write a "Sources:" or "References:" section — the UI renders citations separately.
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

  // Try Groq first when configured — ~10× faster streaming on the same
  // Llama 3.3 70B weights. Fall back to DeepInfra on any retryable error
  // (network, timeout, 429, 5xx). Non-retryable errors (bad key, malformed
  // request) bubble up as-is since the fallback would fail the same way.
  let result: StreamAttempt | null = null
  if (opts.groqKey) {
    result = await streamFromProvider(
      GROQ_URL, GROQ_MODEL, opts.groqKey,
      SYSTEM_PROMPT, userPrompt, 'groq', opts.onChunk,
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
      SYSTEM_PROMPT, userPrompt, 'deepinfra', opts.onChunk,
    )
    if (!result.ok) {
      throw new Error(`Synthesis failed: ${result.error}`)
    }
  }

  const fullText = result.fullText
  const { citations, cite_index } = extractCitations(fullText, opts.context.kept)

  return {
    full_text: fullText,
    citations,
    cite_index,
    ms: Date.now() - t0,
  }
}
