/**
 * RAG pilot - the model calls (chat with tools, embeddings) with retries and token / cost accounting. Plain fetch, no
 * SDK, so the same module runs in scripts (tsx) and in Nitro.
 *
 *   chat     DeepInfra (OpenAI-compatible) for open models; a model id starting "claude-" goes to the Anthropic Messages
 *            API instead, with the OpenAI-shaped messages and tools translated both ways - so every caller (contexts,
 *            R0-R3, L0, the R4 agent with its tools) runs on either without change
 *   embed    DeepInfra bge-en-icl (Anthropic has no embeddings endpoint)
 *
 * Which models: RAG_LLM=anthropic in .env switches the defaults to Claude - contexts AND answers on Haiku 4.5 (Sonnet answers
 * cost about $29 for one plan's 173 answers on 2026-10-10: never the default); RAG_MODEL_ANSWER / RAG_MODEL_CONTEXT pick a
 * model outright. ANTHROPIC_API_KEY / DEEPINFRA_API_KEY are the keys.
 *
 * Spend is guarded, per process (one pipeline stage): a model with no price below is refused (its cost would count as 0 -
 * how that $29 went uncounted), unless RAG_ALLOW_UNPRICED=1; and calls stop once the stage has spent RAG_BUDGET_USD (default
 * 5). On Anthropic a message marked `cache` (a fixed prefix: L0's provisions) and the history of a multi-turn call (the R4
 * agent) are prompt-cached - read back at a tenth of the input price.
 */

const PROVIDER = (process.env.RAG_LLM ?? 'deepinfra').toLowerCase()
export const MODELS = {
  answer: process.env.RAG_MODEL_ANSWER ?? (PROVIDER === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'meta-llama/Llama-3.3-70B-Instruct'),
  context: process.env.RAG_MODEL_CONTEXT ?? (PROVIDER === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'meta-llama/Llama-3.3-70B-Instruct'),
  second: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  embed: 'BAAI/bge-en-icl',
}

/** USD per million tokens, list prices as read 2026-10 - for comparing variants, not for invoicing. A model not listed
 *  costs 0 here and says so once: add its price rather than trust the total */
export const PRICE: Record<string, { in: number; out: number }> = {
  'meta-llama/Llama-3.3-70B-Instruct': { in: 0.23, out: 0.40 },
  'Qwen/Qwen3-235B-A22B-Instruct-2507': { in: 0.13, out: 0.60 },
  'BAAI/bge-en-icl': { in: 0.01, out: 0 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}
const unpriced = new Set<string>()
/** what this process has spent, and the cap it stops at */
let spent = 0
const BUDGET = Number(process.env.RAG_BUDGET_USD ?? 5)
export const spentUsd = () => spent
function guard(model: string) {
  if (!PRICE[model] && process.env.RAG_ALLOW_UNPRICED !== '1')
    throw new Error(`${model} has no price in shared/rag/deepinfra.ts PRICE - refused, so its spend cannot go uncounted (add its price, or RAG_ALLOW_UNPRICED=1)`)
  if (spent >= BUDGET) throw new Error(`budget reached: $${spent.toFixed(2)} of RAG_BUDGET_USD=${BUDGET} spent in this stage - stopped`)
}
export const costOf = (model: string, tin: number, tout: number) => {
  if (!PRICE[model] && !unpriced.has(model)) { unpriced.add(model); console.warn(`[rag] no price listed for ${model}: its cost is counted as 0 (shared/rag/deepinfra.ts PRICE)`) }
  return ((PRICE[model]?.in ?? 0) * tin + (PRICE[model]?.out ?? 0) * tout) / 1e6
}

const BASE = 'https://api.deepinfra.com/v1/openai'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function post(path: string, body: unknown, key: string, tries = 5): Promise<any> {
  let last = ''
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as unknown as Response)
    if (res.ok) return res.json()
    last = `${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`
    if (res.status && res.status < 500 && res.status !== 429) break
    await sleep(1000 * 2 ** i)
  }
  throw new Error(`DeepInfra ${path}: ${last}`)
}

/** cache: a fixed prefix the next calls repeat word for word (prompt-cached on Anthropic; ignored elsewhere) */
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string; cache?: boolean }
export interface ChatResult { content: string; tool_calls: any[]; tokens_in: number; tokens_out: number; cost_usd: number; ms: number; message: ChatMessage }

export async function chat(opts: { messages: ChatMessage[]; model?: string; tools?: any[]; maxTokens?: number; temperature?: number; json?: boolean; key?: string }): Promise<ChatResult> {
  const model = opts.model ?? MODELS.answer
  guard(model)
  if (model.startsWith('claude-')) return anthropicChat({ ...opts, model })
  const key = opts.key ?? process.env.DEEPINFRA_API_KEY
  if (!key) throw new Error('DEEPINFRA_API_KEY is not set')
  const t0 = Date.now()
  const j = await post('/chat/completions', {
    model, messages: opts.messages, max_tokens: opts.maxTokens ?? 800, temperature: opts.temperature ?? 0,
    ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  }, key)
  const msg = j.choices?.[0]?.message ?? {}
  const tin = j.usage?.prompt_tokens ?? 0, tout = j.usage?.completion_tokens ?? 0
  const cost = costOf(model, tin, tout); spent += cost
  return { content: msg.content ?? '', tool_calls: msg.tool_calls ?? [], tokens_in: tin, tokens_out: tout, cost_usd: cost, ms: Date.now() - t0,
    message: { role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) } }
}

/**
 * The Anthropic Messages API behind the same contract: system messages become `system`; an assistant turn's tool_calls
 * become tool_use blocks and a tool message a tool_result block in a user turn (consecutive turns of one role merged, as
 * the API requires); tools take `input_schema`. JSON is asked for in words - there is no response_format.
 */
async function anthropicChat(opts: { messages: ChatMessage[]; model: string; tools?: any[]; maxTokens?: number; temperature?: number; json?: boolean; key?: string }): Promise<ChatResult> {
  const key = opts.key ?? process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set - add it to the app .env')
  const system = [...opts.messages.filter(m => m.role === 'system').map(m => m.content ?? ''), ...(opts.json ? ['Reply with one JSON object and nothing else.'] : [])].join('\n\n')
  const turns: { role: 'user' | 'assistant'; content: any[] }[] = []
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    if (!blocks.length) return
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content.push(...blocks); else turns.push({ role, content: blocks })
  }
  for (const m of opts.messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }])
    else if (m.role === 'assistant') push('assistant', [...(m.content ? [{ type: 'text', text: m.content }] : []),
      ...(m.tool_calls ?? []).map((t: any) => ({ type: 'tool_use', id: t.id, name: t.function?.name, input: (() => { try { return JSON.parse(t.function?.arguments || '{}') } catch { return {} } })() }))])
    else push('user', [{ type: 'text', text: m.content ?? '', ...(m.cache ? { cache_control: { type: 'ephemeral' } } : {}) }])
  }
  // a multi-turn call (the agent): the conversation so far is the next call's prefix - cache up to its last block
  if (turns.some(t => t.role === 'assistant')) { const lt = turns[turns.length - 1]!, lb = lt.content[lt.content.length - 1]; if (lb) lb.cache_control = { type: 'ephemeral' } }
  const body = {
    model: opts.model, max_tokens: opts.maxTokens ?? 800, ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}), messages: turns,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.tools?.length ? { tools: opts.tools.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) } : {}),
  }
  const t0 = Date.now()
  let j: any = null, last = ''
  for (let i = 0; i < 5 && !j; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as unknown as Response)
    if (res.ok) { j = await res.json(); break }
    last = `${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`
    if (res.status && res.status < 500 && res.status !== 429) break          // 529 overloaded and 5xx are retried
    await sleep(1000 * 2 ** i)
  }
  if (!j) throw new Error(`Anthropic messages (${opts.model}): ${last}`)
  const text = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  const tool_calls = (j.content ?? []).filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
  const u = j.usage ?? {}, read = u.cache_read_input_tokens ?? 0, wrote = u.cache_creation_input_tokens ?? 0
  const tin = (u.input_tokens ?? 0) + read + wrote, tout = u.output_tokens ?? 0
  // a cache write is 1.25x the input price, a read 0.1x
  const cost = costOf(opts.model, (u.input_tokens ?? 0) + wrote * 1.25 + read * 0.1, tout)
  spent += cost
  return { content: text, tool_calls, tokens_in: tin, tokens_out: tout, cost_usd: cost, ms: Date.now() - t0,
    message: { role: 'assistant', content: text || null, ...(tool_calls.length ? { tool_calls } : {}) } }
}

/** bge-en-icl embeddings; queries take an instruction prefix, documents do not (the model's own convention) */
export async function embed(texts: string[], opts: { query?: boolean; key?: string } = {}): Promise<{ vecs: number[][]; tokens: number }> {
  const key = opts.key ?? process.env.DEEPINFRA_API_KEY
  if (!key) throw new Error('DEEPINFRA_API_KEY is not set')
  const input = opts.query ? texts.map(t => `<instruct>Given a question about NSW planning law, retrieve the provisions that answer it.\n<query>${t}`) : texts
  const vecs: number[][] = []; let tokens = 0
  for (let i = 0; i < input.length; i += 32) {
    const j = await post('/embeddings', { model: MODELS.embed, input: input.slice(i, i + 32), encoding_format: 'float' }, key)
    for (const d of j.data) vecs.push(d.embedding)
    tokens += j.usage?.prompt_tokens ?? 0
  }
  return { vecs, tokens }
}

/** run fn over items with at most n in flight */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i) } }))
  return out
}
