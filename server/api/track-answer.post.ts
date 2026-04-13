import { nswQuery } from '../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { questionId, answer, citations, durationMs } = body || {}

  if (!questionId || !answer) return { ok: false }

  try {
    await nswQuery(
      `UPDATE user_questions SET answer = $1, citations = $2, duration_ms = $3 WHERE id = $4`,
      [answer, citations ? JSON.stringify(citations) : null, durationMs || null, questionId]
    )
    return { ok: true }
  } catch {
    return { ok: false }
  }
})
