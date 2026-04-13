/**
 * Shared embedding utilities — cache, DeepInfra BAAI/bge-en-icl embeddings,
 * cosine similarity, and proposition-to-text conversion.
 */

// ── Embedding cache (in-memory, per-server lifetime) ──────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const embeddingCache = new Map<string, any>()

export function cacheKey(text: string): string {
  // Simple hash for cache lookup
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0
  }
  return `e_${h}`
}

// ── Embedding via DeepInfra (OpenAI-compatible) ──────────────────────────

export async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  // Check cache first
  const results: (number[] | null)[] = texts.map(t => embeddingCache.get(cacheKey(t)) ?? null)
  const uncachedIndices = results.map((r, i) => r === null ? i : -1).filter(i => i >= 0)

  if (uncachedIndices.length === 0) return results as number[][]

  const uncachedTexts = uncachedIndices.map(i => texts[i]!)

  // DeepInfra supports batch input in a single call
  const batchSize = 100
  for (let b = 0; b < uncachedTexts.length; b += batchSize) {
    const batch = uncachedTexts.slice(b, b + batchSize)

    const res = await fetch('https://api.deepinfra.com/v1/openai/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'BAAI/bge-en-icl',
        input: batch,
        encoding_format: 'float',
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Embedding error ${res.status}: ${detail.slice(0, 200)}`)
    }

    const json = await res.json() as { data?: Array<{ embedding: number[] }> }
    const embeddings = json.data ?? []

    for (let i = 0; i < embeddings.length; i++) {
      const vec = Array.from(new Float32Array(embeddings[i]!.embedding))
      const globalIdx = uncachedIndices[b + i]!
      results[globalIdx] = vec
      embeddingCache.set(cacheKey(texts[globalIdx]!), vec)
    }
  }

  return results as number[][]
}

// ── Cosine similarity ─────────────────────────────────────────────────────

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── Proposition → text representation ─────────────────────────────────────

export interface PropositionTextInput {
  type: string
  subject: string
  predicate: string
  object: string
  threshold?: { value: number; unit: string; comparator: string } | null
  condition_text?: string | null
  overrides_ref?: string | null
  // Contextual fields (optional — when provided, produces richer embeddings)
  document_title?: string | null
  section_heading?: string | null
  lga_name?: string | null
  scope?: string | null
}

/**
 * Converts a proposition to text for embedding.
 * When contextual fields are provided (document_title, section_heading, lga_name),
 * prepends a context prefix that situates the proposition within its source document.
 * This follows the Contextual Retrieval pattern — embeddings carry provenance,
 * improving retrieval accuracy by ~35%.
 */
export function propositionToText(p: PropositionTextInput): string {
  // Core proposition text
  let core = `[${p.type}] ${p.subject} ${p.predicate} ${p.object}`
  if (p.threshold) core += ` (${p.threshold.comparator} ${p.threshold.value} ${p.threshold.unit})`
  if (p.condition_text) core += ` IF: ${p.condition_text}`
  if (p.overrides_ref) core += ` REF: ${p.overrides_ref}`

  // Build context prefix from available metadata
  const parts: string[] = []
  if (p.document_title) parts.push(p.document_title)
  if (p.lga_name) parts.push(p.lga_name)
  else if (p.scope === 'state') parts.push('State-wide')
  if (p.section_heading) parts.push(p.section_heading)

  if (parts.length > 0) {
    return `${parts.join(' | ')} — ${core}`
  }
  return core
}
