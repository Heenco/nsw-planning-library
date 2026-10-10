/**
 * Side D's engine for live endpoints (/api/rag/lot-controls, /api/rag/answer): the claims, bindings and relations the
 * pipeline built (shared/rag/evaluate.ts loadEngine), loaded once and kept until the pipeline writes a newer bindings run.
 */
import { nswQuery } from './nsw-kg/pool'
import { loadEngine, type Engine } from '#shared/rag/evaluate'

let cached: { run: string | null; E: Engine } | null = null

export const ragQuery = async (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])

export async function ragEngine(): Promise<Engine> {
  const run = (await ragQuery(`SELECT id::text FROM rag.run WHERE stage = 'bindings' AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`)).rows[0]?.id ?? null
  if (!cached || cached.run !== run) cached = { run, E: await loadEngine(ragQuery as any) }
  return cached.E
}
