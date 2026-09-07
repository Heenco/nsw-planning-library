/**
 * GET /api/design/brief?address=… — the site brief on its own.
 *
 * Split out from generation so the page can show what the model will be given
 * before anything is spent, and so the brief can be checked independently of
 * whatever a model did with it. No API key needed.
 */

import { loadDesignBrief } from '../../utils/design-brief'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const address = String(q.address ?? '').trim()
  if (!address) throw createError({ statusCode: 400, statusMessage: 'address required' })

  const landUses = String(q.use ?? 'dwelling house')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const storeys = Number(q.storeys) || 2

  const brief = await loadDesignBrief(address, { landUses, storeys })
  const { envelopeMeta, ...rest } = brief as any

  setHeader(event, 'cache-control', 'public, max-age=300')
  // controlCount travels alongside the rows so the page reads the same field
  // whether the brief came from here or back from a generation.
  return { ...rest, controlCount: brief.controls.length }
})
