// ── Unified LLM caller for Sitewise agents ─────────────────────────────

import type { LLMCallOptions, LLMResponse } from './types'

/** Call an LLM with a unified interface across providers */
export async function callLLM(opts: LLMCallOptions): Promise<LLMResponse> {
  const timeout = opts.timeoutMs ?? 45000

  if (opts.provider === 'gemini') {
    return callGemini(opts, timeout)
  }

  // DeepInfra and Groq both use OpenAI-compatible format
  return callOpenAICompat(opts, timeout)
}

// ── OpenAI-compatible (DeepInfra, Groq) ──────────────────────────────────

const PROVIDER_URLS: Record<string, string> = {
  deepinfra: 'https://api.deepinfra.com/v1/openai/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
}

async function callOpenAICompat(opts: LLMCallOptions, timeout: number): Promise<LLMResponse> {
  const url = PROVIDER_URLS[opts.provider]
  if (!url) throw new Error(`Unknown provider: ${opts.provider}`)

  const body: any = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 1000,
  }

  if (opts.jsonMode) body.response_format = { type: 'json_object' }
  if (opts.tools) { body.tools = opts.tools; body.tool_choice = opts.toolChoice ?? 'auto' }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })

  if (!res.ok) throw new Error(`${opts.provider} ${res.status}`)
  const json = await res.json() as any
  const msg = json.choices?.[0]?.message

  return {
    content: msg?.content ?? '',
    toolCalls: msg?.tool_calls,
    usage: json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : undefined,
  }
}

// ── Gemini ────────────────────────────────────────────────────────────────

async function callGemini(opts: LLMCallOptions, timeout: number): Promise<LLMResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    systemInstruction: { parts: [{ text: opts.system }] },
    generationConfig: {
      temperature: opts.temperature ?? 0.1,
      maxOutputTokens: opts.maxTokens ?? 1000,
    },
  }

  if (opts.jsonMode) {
    body.generationConfig.responseMimeType = 'application/json'
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })

  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const json = await res.json() as any
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const usage = json.usageMetadata

  return {
    content: text,
    usage: usage ? { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 } : undefined,
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────────

/** Simple JSON-mode call via DeepInfra Llama */
export async function callDeepInfra(system: string, user: string, apiKey: string, maxTokens = 1000): Promise<string> {
  const result = await callLLM({
    provider: 'deepinfra',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    system,
    user,
    maxTokens,
    jsonMode: true,
    apiKey,
  })
  return result.content
}

// Extend LLMCallOptions with apiKey at runtime
declare module './types' {
  interface LLMCallOptions {
    apiKey?: string
  }
}
