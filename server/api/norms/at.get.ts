/**
 * GET /api/norms/at - the norms trial (docs/norms-trial.md): a lot + a proposal + what the asker knows about the site,
 * through one general engine (shared/norms/engine.ts) over the reviewed norms in norms/trial/reviewed/.
 *
 *   ?cadid=102325171&kind=subdivision&type=torrens&lots=2&use=dwelling house
 *   &site=boarding house=no;secondary dwelling@housing-sepp-2021:ch.3-pt.1=no
 *   ?cadid=102325171&kind=use&use=secondary dwelling&floor=50
 *
 * Returns the outcome (permissible / prohibited / conditional / no_permission), the norms it rests on, every unknown
 * it turns on - grouped by who can answer it (the asker, our data, the consent authority, nobody: an unparsed
 * condition) - the standards with what the lot data says about them, and every norm's trace.
 * Trial scope only: subdivision and secondary dwellings, Housing SEPP + Randwick LEP 2012.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate } from '#shared/norms/engine'
import { lotFacts } from '#shared/norms/facts'
import type { Norm, Question } from '#shared/norms/schema'
import { landUseKey } from '#shared/land-use-key'
import { nswQuery } from '../../utils/nsw-kg/pool'

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const q = getQuery(event)
  const cadid = String(q.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const kind = String(q.kind ?? 'use') as Question['proposal']['kind']
  if (!['use', 'subdivision', 'works', 'change_of_use'].includes(kind)) throw createError({ statusCode: 400, statusMessage: `kind must be use, subdivision, works or change_of_use` })
  const num = (v: unknown) => v == null || v === '' ? undefined : Number(v)
  const site: Record<string, boolean> = {}
  for (const part of String(q.site ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = part.lastIndexOf('=')
    if (i > 0) site[part.slice(0, i).trim()] = /^(yes|true|1)$/i.test(part.slice(i + 1).trim())
  }
  const question: Question = {
    cadid,
    proposal: { kind, subdivision_type: q.type ? String(q.type) as any : undefined, use: q.use ? String(q.use) : undefined,
                under: q.under ? String(q.under) : undefined, proponent: q.proponent ? String(q.proponent) : undefined,
                resulting_lots: num(q.lots), separates: q.separates ? String(q.separates) : undefined, floor_area_m2: num(q.floor) },
    site,
  }

  const dir = join(process.cwd(), 'norms', 'trial', 'reviewed')
  const norms: Norm[] = readdirSync(dir).filter(f => f.endsWith('.json')).flatMap((f) => {
    const file = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    return file.norms.map((n: any) => ({ ...n, instrument: file.instrument }))
  })
  let lot
  try { lot = await lotFacts((sql, params) => nswQuery<any>(sql, params as any[]), cadid, landUseKey) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }
  const inPlay = norms.filter(n => /State Environmental Planning Policy/.test(n.instrument) || n.instrument === lot.epi)
  const result = evaluate(inPlay, question, lot, landUseKey)
  return {
    ms: Date.now() - started, question, lot: { ...lot, lut: undefined },
    scope: { instruments: [...new Set(inPlay.map(n => n.instrument))], norms: inPlay.length,
             note: 'Trial: subdivision and secondary dwellings only - Housing SEPP s 27, 51-53, 185; Randwick LEP 2012 Land Use Table, 2.6, 4.1-4.1D' },
    ...result,
  }
})
