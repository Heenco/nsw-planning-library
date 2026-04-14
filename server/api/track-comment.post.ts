import { nswQuery } from '../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { questionId, name, comment } = body || {}

  if (!comment?.trim()) return { ok: false }

  try {
    await nswQuery(
      `INSERT INTO user_comments (question_id, name, comment) VALUES ($1, $2, $3)`,
      [questionId || null, name?.trim() || null, comment.trim()]
    )
    return { ok: true }
  } catch {
    return { ok: false }
  }
})
