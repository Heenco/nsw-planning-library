/**
 * RAG pilot - the DeepInfra calls (chat with tools, embeddings) with retries and token / cost accounting.
 * Plain fetch, no SDK, so the same module runs in scripts (tsx) and in Nitro.
 */

export const MODELS = {
  answer: 'meta-llama/Llama-3.3-70B-Instruct',
  second: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  embed: 'BAAI/bge-en-icl',
} as const

/** USD per million tokens, DeepInfra list prices as read 2026-10 - for comparing variants, not for invoicing */
export const PRICE: Record<string, { in: number; out: number }> = {
  'meta-llama/Llama-3.3-70B-Instruct': { in: 0.23, out: 0.40 },
  'Qwen/Qwen3-235B-A22B-Instruct-2507': { in: 0.13, out: 0.60 },
  'BAAI/bge-en-icl': { in: 0.01, out: 0 },
}
export const costOf = (model: string, tin: number, tout: number) => ((PRICE[model]?.in ?? 0) * tin + (PRICE[model]?.out ?? 0) * tout) / 1e6

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

export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }
export interface ChatResult { content: string; tool_calls: any[]; tokens_in: number; tokens_out: number; cost_usd: number; ms: number; message: ChatMessage }

export async function chat(opts: { messages: ChatMessage[]; model?: string; tools?: any[]; maxTokens?: number; temperature?: number; json?: boolean; key?: string }): Promise<ChatResult> {
  const model = opts.model ?? MODELS.answer
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
  return { content: msg.content ?? '', tool_calls: msg.tool_calls ?? [], tokens_in: tin, tokens_out: tout, cost_usd: costOf(model, tin, tout), ms: Date.now() - t0,
    message: { role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) } }
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
