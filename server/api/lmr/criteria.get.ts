/**
 * The low and mid-rise housing catalogue - Housing SEPP 2021 Chapter 6 - read from the database.
 *
 *   GET /api/lmr/criteria
 *
 * ONE AUTHORITY, as /api/cdc/criteria is for complying development: /lmr renders this and
 * /api/lmr/types evaluates the same rows, so the page can never cite one rule while the route tests
 * another. Loaded by scripts/build-lmr-type-catalogue.ts from shared/lmr-criteria.ts.
 *
 * Cached for five minutes: the catalogue changes when someone loads it, not per request.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface LmrRequirement {
  clause: string
  text: string
  href: string
  tested: boolean
  testedBy: string | null
  untestedWhy: string | null
  derived: string | null
}

export interface LmrAllowanceRow {
  band: 'any' | 'inner' | 'outer'
  fsr: number | null
  heightM: number | null
  forUse?: string
  storeys?: number | null
  parkingPerDwelling?: number | null
  clause: string
}

export interface LmrType {
  key: string
  name: string
  part: string
  sections: string
  zones: string[]
  landUses: string[]
  seppPermitsIn: string[]
  seppPermitsClause: string | null
  allowances: LmrAllowanceRow[]
  note: string | null
  requirements: LmrRequirement[]
  checks: { column: string; says: string }[]
  testedCount: number
}

export interface LmrGeneralItem {
  clause: string
  text: string
  href: string
  layerKeys: string[]
  failWhere: string | null
  unknownWhere: string | null
  lgaScope: string[] | null
  heldLgas: string[] | null
  coverage: 'full' | 'partial' | 'none'
  caveat: string | null
}

export interface LmrCriteria {
  types: LmrType[]
  general: LmrGeneralItem[]
  counts: { types: number; requirements: number; tested: number; checks: number; general: number; generalNotFull: number }
}

const CACHE_MS = 5 * 60 * 1000
let cached: { at: number; value: LmrCriteria } | null = null

export async function loadLmrCriteria(): Promise<LmrCriteria> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

  const [t, r, c, g] = await Promise.all([
    nswQuery<any>(`SELECT key, name, part, sections, zones, land_uses, sepp_permits_in, sepp_permits_clause,
                          allowances, note FROM lmr.type ORDER BY ord`),
    nswQuery<any>(`SELECT type_key, clause, text, href, tested, tested_by, untested_why, derived
                     FROM lmr.type_requirement ORDER BY type_key, ord`),
    nswQuery<any>(`SELECT type_key, column_tested, says FROM lmr.type_check ORDER BY type_key, ord`),
    nswQuery<any>(`SELECT clause, text, href, layer_keys, fail_where, unknown_where, lga_scope, held_lgas,
                          coverage, caveat FROM lmr.general ORDER BY ord`),
  ])

  const reqBy = new Map<string, LmrRequirement[]>()
  for (const x of r.rows) {
    const list = reqBy.get(x.type_key) ?? []
    list.push({ clause: x.clause, text: x.text, href: x.href, tested: Boolean(x.tested), testedBy: x.tested_by,
                untestedWhy: x.untested_why, derived: x.derived })
    reqBy.set(x.type_key, list)
  }
  const checkBy = new Map<string, { column: string; says: string }[]>()
  for (const x of c.rows) {
    const list = checkBy.get(x.type_key) ?? []
    list.push({ column: x.column_tested, says: x.says })
    checkBy.set(x.type_key, list)
  }

  const types: LmrType[] = t.rows.map((x) => {
    const requirements = reqBy.get(x.key) ?? []
    return {
      key: x.key, name: x.name, part: x.part, sections: x.sections,
      zones: x.zones ?? [], landUses: x.land_uses ?? [], seppPermitsIn: x.sepp_permits_in ?? [],
      seppPermitsClause: x.sepp_permits_clause, allowances: x.allowances ?? [], note: x.note,
      requirements, checks: checkBy.get(x.key) ?? [], testedCount: requirements.filter(q => q.tested).length,
    }
  })
  const general: LmrGeneralItem[] = g.rows.map(x => ({
    clause: x.clause, text: x.text, href: x.href, layerKeys: x.layer_keys ?? [],
    failWhere: x.fail_where, unknownWhere: x.unknown_where, lgaScope: x.lga_scope, heldLgas: x.held_lgas,
    coverage: x.coverage, caveat: x.caveat,
  }))

  const value: LmrCriteria = {
    types,
    general,
    counts: {
      types: types.length,
      requirements: types.reduce((n, x) => n + x.requirements.length, 0),
      tested: types.reduce((n, x) => n + x.testedCount, 0),
      checks: types.reduce((n, x) => n + x.checks.length, 0),
      general: general.length,
      generalNotFull: general.filter(x => x.coverage !== 'full').length,
    },
  }
  cached = { at: Date.now(), value }
  return value
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  return loadLmrCriteria()
})
