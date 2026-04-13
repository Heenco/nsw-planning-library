import { nswQuery } from '../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { query, persona, address, lat, lng, page } = body || {}

  if (!query) return { ok: false }

  try {
    await nswQuery(
      `INSERT INTO user_questions (query, persona, address, lat, lng, page) VALUES ($1, $2, $3, $4, $5, $6)`,
      [query, persona || null, address || null, lat || null, lng || null, page || null]
    )
    return { ok: true }
  } catch {
    return { ok: false }
  }
})
