/**
 * Querying a NSW ArcGIS layer, retrying only what is worth retrying.
 *
 * These services genuinely do fail under load — a timeout or a 503 on one
 * attempt and a clean answer on the next is normal, and giving up on the first
 * try reports "no hit" for a layer that was never actually searched. That is the
 * worst possible failure for an intersect tool, because it is indistinguishable
 * from a real answer.
 *
 * But most failures observed against the catalogue are NOT transient. Running
 * all 137 layers over one Randwick lot produced nine failures, and re-running
 * them immediately recovered **none**:
 *
 *   3 x HTTP 403                            services.ga.gov.au refusing outright
 *   6 x "Invalid or missing input parameters"  the layer rejecting the query itself
 *
 * Retrying those three times each costs three times the wall clock and changes
 * nothing. So the split matters: retry transport failures, never retry a
 * deterministic rejection, and tell the caller which kind it was so the UI can
 * say "could not be searched" rather than implying a maybe.
 */

export interface ArcgisResult {
  ok: boolean
  json?: any
  reason?: 'timeout' | 'unreachable' | 'upstream' | 'rejected'
  message?: string
  /** False when re-asking cannot help — a 4xx, or a query the layer refuses. */
  retryable?: boolean
  attempts: number
}

const BACKOFF_MS = [400, 1200]

/**
 * POST a query to an ArcGIS layer.
 *
 * POST rather than GET because a cadastral ring can carry hundreds of vertices
 * and would exceed a URL length limit.
 */
export async function arcgisQuery(
  serviceUrl: string,
  body: URLSearchParams,
  { timeoutMs = 18000, maxAttempts = 3 }: { timeoutMs?: number, maxAttempts?: number } = {},
): Promise<ArcgisResult> {
  let last: ArcgisResult = { ok: false, reason: 'unreachable', message: 'not attempted', attempts: 0 }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${serviceUrl}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        // 5xx and 429 are load; 4xx is the server telling us no, every time.
        const retryable = res.status >= 500 || res.status === 429
        last = { ok: false, reason: 'upstream', message: `HTTP ${res.status}`, retryable, attempts: attempt }
        if (!retryable) return last
      } else {
        const json = await res.json()
        if (json?.error) {
          // A 200 carrying an error is ArcGIS rejecting the parameters. Asking
          // again with the same parameters gets the same answer.
          return {
            ok: false, reason: 'rejected', retryable: false, attempts: attempt,
            message: String(json.error.message ?? 'query failed').slice(0, 120),
          }
        }
        return { ok: true, json, attempts: attempt }
      }
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError'
      last = {
        ok: false,
        reason: timedOut ? 'timeout' : 'unreachable',
        message: timedOut ? `timed out after ${timeoutMs / 1000}s` : String(err?.message ?? err).slice(0, 80),
        retryable: true,
        attempts: attempt,
      }
    }

    if (attempt < maxAttempts && last.retryable !== false) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 1200))
    } else {
      break
    }
  }

  return last
}
