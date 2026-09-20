/**
 * Complying development, type by type, computed for one lot.
 *
 *   /api/cdc/types?cadid=123456
 *
 * /api/cdc/at answers the GENERAL prerequisites - clause 1.17A, 1.18, 1.19, 1.19A and Schedule 5, the
 * ones that rule out every certificate at once. That is only half the question. The Codes SEPP has a
 * code per development type, each with its own zone list, lot size, width and land tests, and a lot can
 * clear the general prerequisites while failing every type or passing only one.
 *
 * This route answers all twelve types in shared/cdc-criteria.ts, which is the Department's workbook as
 * "07 - CDC rules" read it: 97 type requirements across Low Rise Housing Diversity, Housing, Rural
 * Housing, Inland, Greenfield Housing, Agritourism, Farm Stay and the Housing SEPP's mid-rise clause.
 *
 * WHAT IS RECOMPUTED, AND WHAT THE WORKBOOK ONLY DESCRIBES
 *
 * Of those 97, the workbook marks 29 as tested, and every one of those tests reduces to five columns of
 * the property table. All five are recomputed here from planningai rather than read from d_4:
 *
 *   lzn_sym_code   the zone            epi.epi_land_zoning, by lot polygon
 *   area_h         lot area            measured off the lot geometry
 *   do_width       lot width           derived.lot_profile.width_at_setback_m
 *   ghc_lay_class  Greenfield area     cdc.greenfield_housing_code
 *   landsliderisk  landslide risk      cdc.landslide_risk
 *
 * The remaining 68 requirements are real requirements that nothing here tests - setbacks, heights,
 * BASIX, the things that need a design rather than a lot. They are counted and returned per type as
 * `untested`, because a type reported "eligible" on four checks out of twelve is not the same claim as
 * one that has been fully tested, and a reader has to be able to tell.
 *
 * The `says` strings come from the workbook and are parsed rather than re-encoded, so a change there
 * reaches this without a second edit: "zone is RU5, R1, R2, R3", "lot area >= 400 m2",
 * "lot width >= 15 m", and the two that are simply a layer being present or absent.
 */
import { CDC_TYPES, type CdcType } from '#shared/cdc-criteria'
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface TypeCheck {
  column: string
  says: string
  /** What the lot has, in the same units. */
  actual: string | null
  /** null when nothing measured it - unknown is not failure. */
  pass: boolean | null
}

export interface CdcTypeResult {
  key: string
  name: string
  code: string
  /** Whether the type also has to clear the general prerequisites. */
  inheritsGeneral: boolean
  /** true / false / null when something it depends on was not measured. */
  eligible: boolean | null
  /** General prerequisite layers that caught this lot, when the type inherits them. */
  generalBlockers: { title: string; clauses: string[] }[]
  checks: TypeCheck[]
  /** Requirements the workbook records for this type that nothing here tests. */
  untested: number
  /** What each of those is actually waiting on - not one blanket reason for all of them. */
  untestedReasons: { reason: string; count: number }[]
  requirements: number
  /** One line a reader can act on. */
  verdict: string
}

export interface CdcTypesResponse {
  lot: {
    cadid: string | null
    lotId: string | null
    areaM2: number | null
    widthM: number | null
    zones: string[]
    inGreenfield: boolean
    landslideRisk: boolean
    isBattleaxe: boolean | null
    stemWidthM: number | null
    inInlandCode: boolean
  }
  types: CdcTypeResult[]
  summary: { eligible: number; notEligible: number; unknown: number; total: number; untestedTotal: number }
  /** General prerequisites that caught the lot, which knock out every inheriting type at once. */
  generalBlockers: { title: string; clauses: string[] }[]
  /** General checks with no dataset: nothing can be fully cleared while these exist. */
  generalGaps: { title: string; clauses: string[] }[]
  /** Set when the general sweep could not be read at all - every inheriting type is then undecided. */
  generalError: string
  ms: number
}

/** "zone is RU5, R1, R2, R3" → ['RU5','R1','R2','R3'] */
function zonesFrom(says: string): string[] {
  const m = says.match(/zone is (.+)$/i)
  return m ? m[1]!.split(/,\s*/).map(z => z.trim().toUpperCase()).filter(Boolean) : []
}

/** "lot area >= 400 m2" / "lot width >= 15 m" → 400 / 15. Handles the workbook's ≥ and commas. */
function thresholdFrom(says: string): number | null {
  const m = says.replace(/,/g, '').match(/([\d.]+)\s*m/i)
  return m ? Number(m[1]) : null
}

/**
 * Checks the workbook records as untested that a lot can nonetheless answer.
 *
 * The workbook's `tested` flag says what the notebook tested, not what is testable. Of its 68 untested
 * requirements only four genuinely need a design; the rest are land tests nobody wired up. These two are
 * taken because their clause text is unambiguous and the data is already held. They are marked
 * `source: 'derived'` so a reader can tell them from the workbook's own tests.
 *
 * DELIBERATELY NOT TAKEN, though the data exists:
 *   flood control lot (13 clauses) - the clause bars development "on any part of a flood control lot,
 *     OTHER THAN a part that the council or a professional engineer certifies as not being a flood
 *     storage area, floodway, flow path, high hazard or high risk area". Being on such a lot is not
 *     itself a bar, so failing a lot for intersecting a flood layer would be wrong in the over-strict
 *     direction.
 *   width at the building line (7 clauses) - the threshold is conditional: 12 m where the car parking
 *     is accessed only from a secondary road, parallel road or lane, 15 m otherwise. Nothing here knows
 *     the parking access, so neither figure can be applied without inventing the condition.
 */
function derivedChecks(t: CdcType, lot: any): TypeCheck[] {
  const out: TypeCheck[] = []
  for (const r of t.requirements) {
    if (r.tested) continue
    const txt = (r.text || '').toLowerCase()

    /*
     * Anchored, not a substring match. 3B.2(c) IS the prohibition - "Is not a battle-axe lot?" - while
     * 3A.9(b) reads "if the lot is in Zone R5 and is not a battle-axe lot-has a width... of at least",
     * where the same words are a CONDITION introducing a width rule. Matching loosely reported the
     * second as satisfied whenever the lot was not a battle-axe, which passes a clause it never tested.
     */
    if (/^is not a battle-axe lot/.test(txt)) {
      out.push({
        column: 'derived:is_battleaxe', says: `${r.clause}: is not a battle-axe lot`,
        actual: lot.isBattleaxe == null ? null : lot.isBattleaxe ? 'is a battle-axe lot' : 'is not a battle-axe lot',
        pass: lot.isBattleaxe == null ? null : !lot.isBattleaxe,
      })
    } else if (txt.includes('do not apply to land to which this code')) {
      // 3D.1(3): where the Inland Code applies, the Housing Code and Rural Housing Code do not
      out.push({
        column: 'derived:inland_code_area', says: `${r.clause}: the Inland Code does not take this land`,
        actual: lot.inInlandCode ? 'in the Inland Code area' : 'outside the Inland Code area',
        pass: !lot.inInlandCode,
      })
    }
  }
  return out
}

/** Why a requirement is not tested, so the page can say it instead of asserting one reason for all. */
function untestedReasons(t: CdcType, derivedFor: Set<string>): { reason: string; count: number }[] {
  const tally: Record<string, number> = {}
  for (const r of t.requirements) {
    if (r.tested || derivedFor.has(r.clause)) continue
    const txt = (r.text || '').toLowerCase()
    const reason = txt.includes('flood') ? "flood control lot - the clause turns on an engineer's certificate for the part built on"
      : txt.includes('width') ? 'width at the building line - the threshold depends on where car parking is accessed from'
        : txt.includes('unsewered') ? 'unsewered land - no dataset exists'
          : (txt.includes('battle-axe') || txt.includes('laneway')) ? 'battle-axe access dimensions - we hold the stem width but not the usable area'
            : (txt.includes('within 250m') || txt.includes('setback') || txt.includes('height') || txt.includes('storey'))
                ? 'needs a design, not a lot'
              : (txt.includes('secondary dwelling') || txt.includes('group home')) ? 'what is already built on the land'
                : 'not yet classified'
    tally[reason] = (tally[reason] ?? 0) + 1
  }
  return Object.entries(tally).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
}

function evaluate(t: CdcType, lot: any, generalBlockers: any[], generalError: string): CdcTypeResult {
  const checks: TypeCheck[] = []
  for (const test of t.tests) {
    for (const c of test.checks) {
      if (c.column === 'lzn_sym_code') {
        const want = zonesFrom(c.says)
        const have = lot.zones as string[]
        checks.push({
          column: c.column, says: c.says,
          actual: have.length ? have.join(', ') : null,
          pass: !have.length ? null : have.some(z => want.includes(z)),
        })
      } else if (c.column === 'area_h') {
        const need = thresholdFrom(c.says)
        checks.push({
          column: c.column, says: c.says,
          actual: lot.areaM2 == null ? null : `${Math.round(lot.areaM2).toLocaleString()} m²`,
          pass: lot.areaM2 == null || need == null ? null : lot.areaM2 >= need,
        })
      } else if (c.column === 'do_width') {
        const need = thresholdFrom(c.says)
        checks.push({
          column: c.column, says: c.says,
          actual: lot.widthM == null ? null : `${lot.widthM.toFixed(1)} m`,
          pass: lot.widthM == null || need == null ? null : lot.widthM >= need,
        })
      } else if (c.column === 'ghc_lay_class') {
        checks.push({
          column: c.column, says: c.says,
          actual: lot.inGreenfield ? 'inside the Greenfield Housing Code area' : 'outside it',
          pass: lot.inGreenfield,
        })
      } else if (c.column === 'landsliderisk') {
        checks.push({
          column: c.column, says: c.says,
          actual: lot.landslideRisk ? 'landslide risk mapped on the lot' : 'none mapped',
          pass: !lot.landslideRisk,
        })
      } else {
        // a column the workbook tests that nothing here recomputes - reported, never guessed
        checks.push({ column: c.column, says: c.says, actual: null, pass: null })
      }
    }
  }

  const derived = derivedChecks(t, lot)
  checks.push(...derived)
  const derivedFor = new Set(derived.map(d => d.says.split(':')[0]!))

  const blockers = t.inheritsGeneral ? generalBlockers : []
  // a type that inherits prerequisites we could not read is undecided, never eligible
  const generalUnknown = t.inheritsGeneral && generalError !== ''
  const failed = checks.some(c => c.pass === false)
  const unknown = checks.some(c => c.pass === null)
  /*
   * A type with NO evaluable checks is undecided, not eligible.
   *
   * mid-rise-housing-pattern is the case: twelve requirements, none of them reducible to a column, and
   * it does not inherit the general prerequisites either. Treating "nothing failed" as a pass would
   * have reported it eligible on the strength of having tested nothing at all - the most confident
   * answer on the page resting on the least evidence.
   */
  const eligible = blockers.length || failed ? false
    : (generalUnknown || unknown || checks.length === 0) ? null
      : true

  const tested = t.requirements.filter(r => r.tested).length
  const reasons = untestedReasons(t, derivedFor)
  const untested = reasons.reduce((n, r) => n + r.count, 0)

  let verdict: string
  if (generalUnknown) {
    verdict = `Cannot be decided: ${generalError}, and this type inherits the general prerequisites.`
  } else if (blockers.length) {
    verdict = `Ruled out by ${blockers.length === 1 ? 'a general prerequisite' : blockers.length + ' general prerequisites'}: `
      + blockers.map(b => b.title).join(', ') + '.'
  } else if (failed) {
    verdict = 'Fails ' + checks.filter(c => c.pass === false).map(c => c.says).join('; ') + '.'
  } else if (checks.length === 0) {
    verdict = 'Nothing here can test this type: the workbook records no check that reduces to a lot.'
  } else if (unknown) {
    verdict = 'Cannot be decided: ' + checks.filter(c => c.pass === null).map(c => c.column).join(', ') + ' not measured for this lot.'
  } else {
    verdict = `Clears every check this route can make (${checks.length}).`
  }
  if (untested) {
    // NOT "they need a design, not a lot" - that was true of four requirements out of 68 and false of
    // the rest. Each type now says what its own untested requirements actually wait on.
    verdict += ` ${untested} of its ${t.requirements.length} requirements are not tested here: `
      + reasons.map(r => `${r.count} ${r.reason}`).join('; ') + '.'
  }

  return {
    key: t.key, name: t.name, code: t.code, inheritsGeneral: t.inheritsGeneral,
    eligible, generalBlockers: blockers, checks, untested, untestedReasons: reasons,
    requirements: t.requirements.length, verdict,
  }
}

export default defineEventHandler(async (event): Promise<CdcTypesResponse> => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'Give a cadid' })
  setHeader(event, 'cache-control', 'public, max-age=60')

  // one round trip for everything the type tests need: the lot, its zones, its width, and the two
  // yes/no layers. The lot goes to each layer, never the layer to the lot.
  const res = await nswQuery<any>(`
    WITH l AS (SELECT cadid, lotidstring AS lot_id, geom, ST_Area(geom::geography) AS area_m2
               FROM cadastre.lot WHERE cadid = $1 LIMIT 1)
    SELECT l.cadid, l.lot_id, l.area_m2,
           p.width_at_setback_m, p.lot_width_max_m, p.is_battleaxe, p.stem_width_m,
           (SELECT array_agg(DISTINCT z.sym_code::text) FROM epi.epi_land_zoning z
             WHERE z.geom && l.geom AND ST_Intersects(z.geom, l.geom) AND z.sym_code IS NOT NULL) AS zones,
           EXISTS (SELECT 1 FROM cdc.greenfield_housing_code g
                    WHERE g.geom && l.geom AND ST_Intersects(g.geom, l.geom)) AS in_greenfield,
           EXISTS (SELECT 1 FROM cdc.landslide_risk r
                    WHERE r.geom && l.geom AND ST_Intersects(r.geom, l.geom)) AS landslide_risk,
           EXISTS (SELECT 1 FROM cdc.inland_code_area i
                    WHERE i.geom && l.geom AND ST_Intersects(i.geom, l.geom)) AS in_inland_code
    FROM l LEFT JOIN derived.lot_profile p ON p.cadid = l.cadid`, [cadid])

  const r = res.rows[0]
  if (!r) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  /*
   * The general prerequisites, from the same catalogue-driven sweep /cdc-map uses.
   *
   * event.$fetch, not $fetch: the app sits behind a password middleware, and a bare $fetch from inside a
   * route arrives without the request's context and is rejected. That failure used to be swallowed by a
   * .catch(() => null), which reported a bush-fire-excluded lot as having NO general prerequisite
   * against it - a false clear, which is the one direction this must never be wrong in.
   *
   * So the failure is now carried rather than hidden: if the sweep cannot be read, no type that
   * inherits the general prerequisites can be called eligible, and each says why.
   */
  let at: any = null
  let generalError = ''
  try {
    at = await event.$fetch('/api/cdc/at', { query: { cadid } })
  } catch (e: any) {
    generalError = e?.data?.statusMessage || e?.message || 'the general prerequisite sweep could not be read'
  }
  const generalBlockers = ((at?.hits ?? []) as any[])
    .filter(h => h.kind === 'exclusion' && h.scope === 'general')
    .map(h => ({ title: h.title, clauses: h.clauses ?? [] }))
  const generalGaps = ((at?.gaps ?? []) as any[]).map(g => ({ title: g.title, clauses: g.clauses ?? [] }))

  const lot = {
    cadid: r.cadid, lotId: r.lot_id,
    areaM2: r.area_m2 == null ? null : Number(r.area_m2),
    widthM: r.width_at_setback_m != null ? Number(r.width_at_setback_m)
      : r.lot_width_max_m != null ? Number(r.lot_width_max_m) : null,
    zones: (r.zones ?? []) as string[],
    inGreenfield: Boolean(r.in_greenfield),
    landslideRisk: Boolean(r.landslide_risk),
    isBattleaxe: r.is_battleaxe == null ? null : Boolean(r.is_battleaxe),
    stemWidthM: r.stem_width_m == null ? null : Number(r.stem_width_m),
    inInlandCode: Boolean(r.in_inland_code),
  }

  const types = CDC_TYPES.map(t => evaluate(t, lot, generalBlockers, generalError))
  return {
    lot,
    types,
    summary: {
      eligible: types.filter(t => t.eligible === true).length,
      notEligible: types.filter(t => t.eligible === false).length,
      unknown: types.filter(t => t.eligible === null).length,
      total: types.length,
      untestedTotal: types.reduce((n, t) => n + t.untested, 0),
    },
    generalBlockers,
    generalGaps,
    generalError,
    ms: Date.now() - started,
  }
})
