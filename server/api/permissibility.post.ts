import { withNswClient } from '../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const epititle = body?.epititle?.trim()
  const zone = body?.zone?.trim()?.toUpperCase()
  const landUse = body?.landUse?.trim()

  if (!epititle || !zone) {
    throw createError({ statusCode: 400, message: 'Missing epititle or zone' })
  }

  const result = await withNswClient(async (client) => {
    const res = await client.query(
      `SELECT DISTINCT permissiblelanduse
       FROM up_permissiblelanduse
       WHERE epititle ILIKE $1 AND zone = $2
         AND permissiblelanduse IS NOT NULL
       ORDER BY permissiblelanduse`,
      [epititle, zone]
    )

    const allUses = res.rows.map((r: any) => r.permissiblelanduse)

    if (!landUse) {
      return { status: 'enumerated', allUses, matchedEntries: [] }
    }

    // Fuzzy match the requested land use against permitted uses
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const needle = norm(landUse)
    const matched = allUses.filter((u: string) => {
      const hay = norm(u)
      return hay.includes(needle) || needle.includes(hay)
        || hay.split(' ')[0] === needle.split(' ')[0]  // head-word match
    })

    if (matched.length > 0) {
      return { status: 'permitted', allUses, matchedEntries: matched }
    }

    return { status: 'not_found', allUses, matchedEntries: [] }
  })

  return result
})
