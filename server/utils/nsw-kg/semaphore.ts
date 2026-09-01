// ── Bounded concurrency primitive ───────────────────────────────────────
//
// Cap the number of concurrent async tasks. Used by Stage 1 to fan out
// per-clause LLM calls without blowing the rate limit.
//
// Usage:
//   const sem = createSemaphore(12)
//   const results = await Promise.all(
//     items.map(item => sem.run(() => processItem(item))),
//   )

export interface Semaphore {
  /** Acquire a slot, run fn, release the slot. Resolves with fn's return value. */
  run<T>(fn: () => Promise<T>): Promise<T>
  /** Number of currently-running tasks. */
  active: () => number
  /** Number of tasks waiting in the queue. */
  pending: () => number
}

export function createSemaphore(max: number): Semaphore {
  if (max < 1 || !Number.isInteger(max)) throw new Error('max must be a positive integer')

  let running = 0
  const queue: Array<() => void> = []

  const next = () => {
    if (running >= max) return
    const job = queue.shift()
    if (job) job()
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= max) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    running++
    try {
      return await fn()
    } finally {
      running--
      next()
    }
  }

  return {
    run,
    active:  () => running,
    pending: () => queue.length,
  }
}

/** Map an iterable through an async fn with bounded concurrency.
 *  Preserves order in the result array. */
export async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const sem = createSemaphore(concurrency)
  return Promise.all(items.map((item, i) => sem.run(() => fn(item, i))))
}
