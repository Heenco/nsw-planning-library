/**
 * The rag engine's lot facts (shared/rag/lot-facts.ts), built once per lot and shared by the endpoints a page fires at
 * the same time for the same lot (/report-2, /precinct: standards, uses, subdivision, the audit). A build is ~190
 * statements, each a round trip to the database (5-6 s measured 2026-10-15); without this every endpoint paid it.
 * A build is kept for a minute - the facts change only when the data is reloaded - and a failed one is not kept.
 */
import { ragLotFacts } from '#shared/rag/lot-facts'

const TTL_MS = 60_000, MAX = 200
const cache = new Map<string, { at: number; p: Promise<any> }>()

export function lotFactsShared(q: (sql: string, p?: unknown[]) => Promise<any>, cadid: string, tier: 'rag' | 'kg' = 'rag', opts: { precinct?: boolean } = {}): Promise<any> {
  const key = `${tier}|${cadid}|${opts.precinct ? 'precinct' : 'legacy'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p
  const p = ragLotFacts(q, cadid, tier, opts).catch((e: unknown) => { cache.delete(key); throw e })
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), p })
  return p
}
