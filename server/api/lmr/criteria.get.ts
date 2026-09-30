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
import { CRITERIA_SQL, criteriaFromRows } from '#shared/lmr-evaluate'

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
    nswQuery<any>(CRITERIA_SQL.types),
    nswQuery<any>(CRITERIA_SQL.requirements),
    nswQuery<any>(CRITERIA_SQL.checks),
    nswQuery<any>(CRITERIA_SQL.general),
  ])
  // the mapping is shared with scripts/build-lmr-lots.ts, so the batch reads the catalogue identically
  const { types, general } = criteriaFromRows(t.rows, r.rows, c.rows, g.rows)

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
