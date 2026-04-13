// ── SSE helpers for Sitewise ────────────────────────────────────────────

import type { SSEEvent, StepFn } from './types'

export function sseEvent(res: any, type: string, data: object) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

/** Create a step emitter bound to a response and start time */
export function createStepFn(res: any, t0: number): StepFn {
  return (agent: string, status: string, message: string, detail?: string) => {
    sseEvent(res, 'agent_step', { agent, status, message, detail, ms: Date.now() - t0 })
  }
}

/** Flush buffered SSE events from an agent output */
export function emitBufferedEvents(res: any, events: SSEEvent[]) {
  for (const evt of events) {
    sseEvent(res, evt.type, evt.payload)
  }
}
