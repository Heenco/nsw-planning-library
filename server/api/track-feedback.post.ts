import { nswQuery } from '../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { questionId, feedback } = body || {}

  if (!questionId || !feedback) return { ok: false }

  try {
    await nswQuery(
      `UPDATE user_questions SET feedback = $1, feedback_at = now() WHERE id = $2`,
      [feedback, questionId]
    )
    return { ok: true }
  } catch {
    return { ok: false }
  }
})
