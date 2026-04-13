// ── nsw-kg pool wrapper ─────────────────────────────────────────────────
//
// Reuses the existing kgPool SSH tunnel + pg.Pool but ensures every
// checked-out client has `search_path` set to `nsw, public` so unqualified
// table references resolve into the v2 schema.
//
// Use `withNswClient(fn)` for queries — never call getKgPool() directly
// from nsw-kg modules.

import type pg from 'pg'
import { getKgPool } from '../kgPool'

/** Run a callback with a pg client whose search_path is set to nsw, public.
 *  Releases the client automatically. */
export async function withNswClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = await getKgPool()
  const client = await pool.connect()
  try {
    await client.query('SET search_path TO nsw, public')
    return await fn(client)
  } finally {
    client.release()
  }
}

/** Convenience: single-statement query. */
export async function nswQuery<R extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<R>> {
  return withNswClient((c) => c.query<R>(text, params))
}

/** Run a function inside a transaction with search_path set. Rolls back on throw. */
export async function withNswTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withNswClient(async (client) => {
    await client.query('BEGIN')
    try {
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    }
  })
}
