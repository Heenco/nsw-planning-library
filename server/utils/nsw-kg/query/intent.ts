// ── Stage A — intent + entity classifier ───────────────────────────────
//
// Single LLM call. Strict JSON schema. Validates output and falls back to
// a deterministic 'general' plan on failure.

import { callLLM } from '../../sitewise/llm'
import type { QueryPlan, QueryIntent } from './types'

const SYSTEM = `You are the intent classifier for a NSW planning law query agent. Read a user question and produce a JSON plan that downstream agents will use to retrieve and answer.

Return JSON only — no prose, no code fences.

Output schema:
{
  "intent": "permissibility" | "thresholds" | "definition" | "cross_doc" | "general",
  "entities": {
    "zone":        "<NSW zone code like R1, R2, E2, RU1, MU1, or empty>",
    "land_use":    "<noun phrase like 'dwelling house', 'dual occupancy', or empty>",
    "lga":         "<LGA name like 'Albury', or empty>",
    "doc_type":    "lep" | "sepp" | "dcp" | "",
    "topic":       "<short topic like 'flood', 'heritage', 'parking', 'setback', or empty>"
  },
  "keywords": ["array", "of", "topical", "keywords", "for", "retrieval"],
  "surface_overrides": <true if the user explicitly compares LEP/SEPP/DCP, else false>
}

Intent guide:
- "permissibility": user is asking whether a use is allowed, prohibited, or with consent
- "thresholds":    user is asking about a numeric standard (FSR, height, lot size, setback, parking, etc)
- "definition":    user is asking what a term means
- "cross_doc":     user explicitly mentions which document wins / overrides another
- "general":       anything else

Examples:
Q: "What is the maximum height for a dwelling house in Zone R2 in Albury?"
A: { "intent": "thresholds", "entities": { "zone": "R2", "land_use": "dwelling house", "lga": "Albury", "doc_type": "lep", "topic": "height" }, "keywords": ["maximum height", "building height", "height of buildings"], "surface_overrides": false }

Q: "Can I build a secondary dwelling on a 400 sqm lot in R1?"
A: { "intent": "permissibility", "entities": { "zone": "R1", "land_use": "secondary dwelling", "lga": "", "doc_type": "", "topic": "subdivision" }, "keywords": ["secondary dwelling", "minimum lot size", "permitted"], "surface_overrides": false }

Q: "What does 'dual occupancy' mean in the LEP?"
A: { "intent": "definition", "entities": { "zone": "", "land_use": "dual occupancy", "lga": "", "doc_type": "lep", "topic": "" }, "keywords": ["dual occupancy", "definition"], "surface_overrides": false }

Q: "Does the Housing SEPP override the Albury LEP for boarding house FSR?"
A: { "intent": "cross_doc", "entities": { "zone": "", "land_use": "boarding house", "lga": "Albury", "doc_type": "sepp", "topic": "fsr" }, "keywords": ["floor space ratio", "boarding house", "override"], "surface_overrides": true }
`

const ALLOWED_INTENTS: QueryIntent[] = ['permissibility', 'thresholds', 'definition', 'cross_doc', 'general']

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function tryParse(text: string): any {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  const start = Math.min(
    ...['{', '['].map((c) => { const i = t.indexOf(c); return i === -1 ? Infinity : i }),
  )
  if (!Number.isFinite(start)) throw new Error('no JSON object found')
  return JSON.parse(t.slice(start as number))
}

export interface IntentKeys {
  /** Gemini API key — preferred provider for the intent classifier (fast + cheap + good JSON). */
  geminiKey?:    string
  /** Groq key — intermediate fallback when Gemini 429s. Groq runs Llama 3.3
   *  70B in JSON mode at ~0.8s per call, much faster than DeepInfra's ~6s.
   *  Optional; if missing we skip straight to DeepInfra. */
  groqKey?:      string
  /** DeepInfra final fallback if Gemini and Groq both fail. */
  deepinfraKey:  string
}

export async function classifyIntent(query: string, keys: IntentKeys): Promise<QueryPlan> {
  const fallback: QueryPlan = {
    intent: 'general',
    entities: {},
    keywords: query.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 6),
    surface_overrides: false,
  }

  // Provider chain (fastest → slowest):
  //   1. Gemini 2.5 Flash Lite — free tier, ~500ms when not rate-limited,
  //      higher free-tier RPM than regular 2.5 Flash.
  //   2. Groq Llama 3.3 70B — ~0.8s in JSON mode, generous free-tier RPM.
  //      Kicks in when Gemini is missing or 429s.
  //   3. DeepInfra Llama 3.3 70B — ~5-7s, final fallback when both above
  //      fail. Slow but reliable.
  const userPrompt = `Question: """${query}"""\n\nReturn JSON only.`

  let result: { content: string } | null = null

  // 1. Gemini
  if (keys.geminiKey) {
    try {
      result = await callLLM({
        provider: 'gemini',
        model:    'gemini-2.5-flash-lite',
        apiKey:   keys.geminiKey,
        system:   SYSTEM,
        user:     userPrompt,
        maxTokens: 400,
        jsonMode:  true,
        temperature: 0.05,
      })
    } catch (err) {
      console.warn('[intent] Gemini failed, trying Groq:', (err as Error).message)
      result = null
    }
  }

  // 2. Groq
  if (!result && keys.groqKey) {
    try {
      result = await callLLM({
        provider: 'groq',
        model:    'llama-3.3-70b-versatile',
        apiKey:   keys.groqKey,
        system:   SYSTEM,
        user:     userPrompt,
        maxTokens: 400,
        jsonMode:  true,
        temperature: 0.05,
      })
    } catch (err) {
      console.warn('[intent] Groq failed, falling back to DeepInfra:', (err as Error).message)
      result = null
    }
  }

  // 3. DeepInfra (final fallback)
  if (!result) {
    try {
      result = await callLLM({
        provider: 'deepinfra',
        model:    'meta-llama/Llama-3.3-70B-Instruct',
        apiKey:   keys.deepinfraKey,
        system:   SYSTEM,
        user:     userPrompt,
        maxTokens: 400,
        jsonMode:  true,
        temperature: 0.05,
      })
    } catch (err) {
      console.error('[intent] all providers failed:', (err as Error).message)
      return fallback
    }
  }

  try {
    const parsed = tryParse(result.content)

    const intentRaw = asString(parsed.intent)
    const intent: QueryIntent = (ALLOWED_INTENTS as readonly string[]).includes(intentRaw)
      ? (intentRaw as QueryIntent)
      : 'general'

    const ent = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {}

    return {
      intent,
      entities: {
        zone:     asString(ent.zone)     || undefined,
        land_use: asString(ent.land_use) || undefined,
        lga:      asString(ent.lga)      || undefined,
        doc_type: ['lep', 'sepp', 'dcp'].includes(asString(ent.doc_type)) ? asString(ent.doc_type) as any : undefined,
        topic:    asString(ent.topic)    || undefined,
      },
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((k: any) => asString(k)).filter(Boolean).slice(0, 12)
        : fallback.keywords,
      surface_overrides: parsed.surface_overrides === true,
    }
  } catch (err) {
    return fallback
  }
}
