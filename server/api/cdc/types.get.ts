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
 * This route answers every type in the cdc.type catalogue - the Department's workbook as
 * "07 - CDC rules" read it, across Low Rise Housing Diversity, Housing, Rural Housing, Inland,
 * Greenfield Housing, Agritourism and Farm Stay.
 *
 * The Housing SEPP's mid-rise clause 182 was in that workbook and is NOT here: it is a development
 * application pathway, not complying development, so it is excluded when the catalogue is loaded.
 * Its own pathway is on /pattern-book.
 *
 * WHAT IS RECOMPUTED, AND WHAT THE WORKBOOK ONLY DESCRIBES
 *
 * Of those 97, the workbook marks 29 as tested, and every one of those tests reduces to five columns of
 * the property table. All five are recomputed here from planningai rather than read from d_4:
 *
 *   lzn_sym_code   the zone            epi.epi_land_zoning, by lot polygon
 *   area_h         lot area            measured off the lot geometry
 *   do_width       lot width           derived.lot_profile.primary_frontage_length_m - the property frontage,
 *                                      as /lmr and the Pattern Book read it (2026-09-30; was width at the setback)
 *   ghc_lay_class  Greenfield area     cdc.greenfield_housing_code
 *   landsliderisk  landslide risk      cdc.landslide_risk
 *
 * The remaining 68 requirements are real requirements that nothing here tests - setbacks, heights,
 * BASIX, the things that need a design rather than a lot. They are counted and returned per type as
 * `untested`, because a type reported "eligible" on four checks out of twelve requirements is not the same claim as
 * one that has been fully tested, and a reader has to be able to tell.
 *
 * The `says` strings come from the workbook and are parsed rather than re-encoded, so a change there
 * reaches this without a second edit: "zone is RU5, R1, R2, R3", "lot area >= 400 m2",
 * "lot width >= 15 m", and the two that are simply a layer being present or absent.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { usesShown } from '#shared/cdc-permissibility'
// The catalogue, from cdc.type / cdc.type_requirement / cdc.type_check. /cdc renders the same rows,
// so the page can no longer cite one rule while this route tests another.
import { loadCriteria, type CriteriaType } from './criteria.get'

type CdcType = CriteriaType

export interface PermissibilityRow {
  source: 'lep' | 'sepp'
  instrument: string
  zone: string
  landUse: string
  status: string
}

/**
 * The clause is satisfied by consent-permissibility only.
 *
 * "permitted_without_consent" is land where the use needs no consent at all, which is not what
 * 1.18(1)(b) asks for - it asks that the use BE permissible with consent. Reported, never counted.
 */
function permits(rows: PermissibilityRow[], uses: string[]) {
  const want = new Set(uses.map(u => u.toLowerCase()))
  return rows.filter(r => want.has(r.landUse.toLowerCase()))
}

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
  generalBlockers: {
    title: string; clauses: string[]; note: string | null
    key: string | null; coverPct: number | null; source: string | null; names: string[] | null
    /** 'cdc' from the cdc.layers sweep, 'esa' from the clause 3.3 test. */
    via: 'cdc' | 'esa'
    /** For an ESA blocker: the LEP paragraph that makes the land sensitive. */
    clause: string | null
    coverageType: string | null
    verifyRequired: boolean
    half: string | null
  }[]
  checks: TypeCheck[]
  /** Requirements the workbook records for this type that nothing here tests. */
  untested: number
  /** The verdict as separate statements, one per line, rather than one run-on sentence. */
  verdictLines: { kind: string; text: string }[]
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
  generalBlockers: { title: string; clauses: string[]; note: string | null }[]
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
 *   property frontage (7 clauses) - what we hold is an ESTIMATE measured from the lot geometry, and
 *     "width at the building line" has no legal definition to measure against. The threshold is also
 *     conditional: 12 m where the car parking
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
      : txt.includes('width') ? 'property frontage - an estimate measured from the lot geometry, and the '
        + "clause's threshold also depends on where car parking is accessed from"
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

/**
 * cl 1.18(1)(b) for one type: is this code's land use permissible, with consent, here?
 *
 * Any zone under the lot permitting it counts, which is the same rule the zone check already uses
 * (`have.some(...)`) - a lot split across two zones is not automatically ineligible. Every zone is
 * named in the text so a reader can see the split rather than take the verdict on trust.
 */
function permissibilityCheck(t: CdcType, lot: any): TypeCheck {
  const uses = t.landUses
  /*
   * Named at the length of the other checks beside it - "zone is RU5, R1, R2, R3", "lot area >=
   * 400 m2". Saying "the use is permissible with consent under an EPI applying to the land" is the
   * clause, but it does not say WHICH use, which is the only part that differs per type.
   */
  const shown = usesShown(uses)
  const label = shown.length
    ? `cl 1.18(1)(b): ${shown.join(' or ')} permissible with consent`
    : 'cl 1.18(1)(b): permissible with consent under an EPI'

  if (!uses || uses.length === 0) {
    return { column: 'permissibility', says: label, pass: null,
             actual: `which land use the ${t.code} turns on has not been decided - no Standard `
                   + `Instrument term matches it, so this is not tested rather than guessed` }
  }
  const rows: PermissibilityRow[] = lot.permissibility ?? []
  if (!rows.length) {
    return { column: 'permissibility', says: label, pass: null,
             actual: 'no zoning or permissibility record for this lot' }
  }
  const mine = permits(rows, uses)
  if (!mine.length) {
    return { column: 'permissibility', says: label, pass: null,
             actual: `no permissibility recorded for ${uses[0]} in `
                   + `${[...new Set(rows.map(r => r.zone))].join(', ')}` }
  }
  // an inferred mapping is labelled everywhere it is used, not just where it is defined
  const caveat = t.landUsesInferred
    ? ` - "manor house" is not a Standard Instrument term, so this tests residential flat buildings `
      + `or multi dwelling housing instead`
    : ''
  const yes = mine.filter(r => r.status === 'permitted_with_consent')
  if (yes.length) {
    const r = yes[0]!
    return { column: 'permissibility', says: label, pass: true,
             actual: `${r.landUse} permitted with consent in ${r.zone} under ${r.instrument}${caveat}` }
  }
  const noConsent = mine.filter(r => r.status === 'permitted_without_consent')
  if (noConsent.length) {
    const r = noConsent[0]!
    return { column: 'permissibility', says: label, pass: false,
             actual: `${r.landUse} is permitted WITHOUT consent in ${r.zone} under ${r.instrument} `
                   + `- the clause asks for permissible with consent` }
  }
  /*
   * Name every use that was tested, not just the first.
   *
   * Manor houses pass if EITHER residential flat buildings or multi dwelling housing is permitted,
   * so a failure means both were checked and both failed. Reporting one of them read as though the
   * other had never been looked at.
   */
  const byUse = new Map<string, string>()
  for (const m of mine) if (!byUse.has(m.landUse)) byUse.set(m.landUse, m.status)
  const zones = [...new Set(mine.map(m => m.zone))].join(', ')
  const said = [...byUse].map(([u, s]) => `${u} ${s.replace(/_/g, ' ')}`).join('; ')
  return { column: 'permissibility', says: label, pass: false,
           actual: `${said} in ${zones} under ${mine[0]!.instrument}${caveat}` }
}

function evaluate(t: CdcType, lot: any, generalBlockers: any[], generalError: string): CdcTypeResult {
  // 1.18(1)(b) first: it is the prerequisite the code's own zone list is only a proxy for
  const checks: TypeCheck[] = [permissibilityCheck(t, lot)]
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
          actual: lot.widthM == null ? null : `${lot.widthM.toFixed(1)} m of frontage`,
          pass: lot.widthM == null || need == null ? null : lot.widthM >= need,
        })
      } else if (c.column === 'ghc_lay_class') {
        checks.push({
          column: c.column, says: c.says,
          actual: lot.inGreenfield ? 'inside the Greenfield Housing Code area' : 'outside it',
          pass: lot.inGreenfield,
        })
      } else if (c.column === 'bushfire_prone') {
        checks.push({
          column: c.column, says: c.says,
          actual: lot.bushfireProne == null ? null
            : lot.bushfireProne ? 'bush fire prone land mapped on the lot' : 'none mapped',
          pass: lot.bushfireProne == null ? null : !lot.bushfireProne,
        })
      } else if (c.column === 'ghc_excluded') {
        // the inverse of ghc_lay_class: these codes are excluded FROM the Greenfield area
        checks.push({
          column: c.column, says: c.says,
          actual: lot.inGreenfield ? 'inside the Greenfield Housing Code area' : 'outside it',
          pass: !lot.inGreenfield,
        })
      } else if (c.column === 'esa_land') {
        checks.push({
          column: c.column, says: c.says,
          actual: lot.inEsa == null ? null
            : lot.inEsa ? 'an environmentally sensitive area covers the lot' : 'none covers the lot',
          pass: lot.inEsa == null ? null : !lot.inEsa,
        })
      } else if (c.column === 'heritage_item') {
        checks.push({
          column: c.column, says: c.says,
          actual: lot.hasHeritage == null ? null
            : lot.hasHeritage ? 'a heritage layer covers the lot' : 'no heritage layer covers the lot',
          pass: lot.hasHeritage == null ? null : !lot.hasHeritage,
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
   * The case that proved it was mid-rise, since removed from the catalogue for not being complying
   * development at all: twelve requirements, none reducible to a column, and it did not inherit the
   * general prerequisites either. Treating "nothing failed" as a pass would have reported it
   * eligible on the strength of having tested nothing - the most confident answer on the page
   * resting on the least evidence. The rule stays because the next such type will not announce
   * itself.
   */
  const eligible = blockers.length || failed ? false
    : (generalUnknown || unknown || checks.length === 0) ? null
      : true

  const tested = t.requirements.filter(r => r.tested).length
  const reasons = untestedReasons(t, derivedFor)
  const untested = reasons.reduce((n, r) => n + r.count, 0)

  /*
   * The verdict, as separate statements rather than one sentence.
   *
   * It used to be assembled by string concatenation - headline, then every blocker comma-joined,
   * then every untested reason semicolon-joined - which on a ruled-out type ran to four lines of
   * prose with the actual reason buried mid-paragraph. These are distinct facts and each gets its
   * own line. `verdict` is still produced, unchanged, because it reads well in a log and an API
   * consumer may already depend on it.
   */
  const lines: { kind: 'head' | 'blocker' | 'fail' | 'unknown' | 'untested'; text: string }[] = []
  if (generalUnknown) {
    lines.push({ kind: 'head', text: `Cannot be decided: ${generalError}, and this type inherits the general prerequisites.` })
  } else if (blockers.length) {
    lines.push({ kind: 'head', text: `Ruled out by ${blockers.length === 1 ? 'a general prerequisite' : blockers.length + ' general prerequisites'}:` })
    for (const b of blockers) lines.push({ kind: 'blocker', text: b.title })
  } else if (failed) {
    lines.push({ kind: 'head', text: 'Fails:' })
    for (const c of checks.filter(c => c.pass === false)) lines.push({ kind: 'fail', text: c.says })
  } else if (checks.length === 0) {
    lines.push({ kind: 'head', text: 'Nothing here can test this type: the workbook records no check that reduces to a lot.' })
  } else if (unknown) {
    lines.push({ kind: 'head', text: 'Cannot be decided:' })
    for (const c of checks.filter(c => c.pass === null)) {
      lines.push({ kind: 'unknown', text: `${c.column} not measured for this lot` })
    }
  } else {
    lines.push({ kind: 'head', text: `Clears every check this route can make (${checks.length}).` })
  }
  if (untested) {
    // NOT "they need a design, not a lot" - that was true of four requirements out of 68 and false of
    // the rest. Each type says what its own untested requirements actually wait on.
    lines.push({ kind: 'head', text: `${untested} of its ${t.requirements.length} requirements are not tested here:` })
    for (const r of reasons) lines.push({ kind: 'untested', text: `${r.count} ${r.reason}` })
  }
  // the one-sentence form, kept for logs and any consumer already reading it
  const verdict = lines.map((l, i) => l.kind === 'head' ? (i ? ' ' : '') + l.text
    : (lines[i - 1]?.kind === 'head' ? ' ' : '; ') + l.text).join('').replace(/:\s/g, ': ')

  return {
    key: t.key, name: t.name, code: t.code, inheritsGeneral: t.inheritsGeneral,
    eligible, generalBlockers: blockers, checks, untested, untestedReasons: reasons,
    verdictLines: lines,
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
           p.primary_frontage_length_m, p.is_battleaxe, p.stem_width_m,
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
   * What each instrument over this lot says about the uses the codes turn on.
   *
   * A second round trip rather than a subquery on the first: this returns many rows per lot where
   * the other returns one, and the join key is (epi_name, zone) read off the SAME zoning polygons
   * the zone check uses, so the two can never disagree about which instrument applies.
   */
  const perm = await nswQuery<any>(`
    WITH z AS (
      SELECT DISTINCT z.epi_name, z.sym_code
        FROM cadastre.lot l
        JOIN epi.epi_land_zoning z ON z.geom && l.geom AND ST_Intersects(z.geom, l.geom)
       WHERE l.cadid = $1 AND z.sym_code IS NOT NULL)
    SELECT 'lep' AS source, z.epi_name AS instrument, z.sym_code AS zone,
           p.land_use, p.status
      FROM z JOIN nsw.lep_permissibility p
        ON p.epi_name = z.epi_name AND p.zone_code = z.sym_code
       AND lower(p.land_use) = ANY($2)
    UNION ALL
    -- the second route 1.18(1)(b) allows: an EPI other than the LEP applying to the same land
    SELECT 'sepp', s.sepp, z.sym_code, s.land_use, 'permitted_with_consent'
      FROM z JOIN nsw.sepp_permissible_landuse s
        ON s.zone = z.sym_code AND lower(s.land_use) = ANY($2)`,
    [cadid, [...new Set((await loadCriteria()).flatMap(x => x.landUses))].map(u => u.toLowerCase())])

  r.permissibility = perm.rows.map((x: any) => ({
    source: x.source, instrument: x.instrument, zone: x.zone,
    landUse: x.land_use, status: x.status,
  }))

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
  /*
   * The ESA test in full, beside the CDC sweep.
   *
   * cdc.layers holds 14 esa-sourced layers - about half the state-wide test and none of the 52
   * local-plan additions. /api/esa/at holds all of it, tiered and cited, so it is asked directly
   * rather than a copy of part of it being maintained here.
   */
  let esa: any = null
  let esaError = ''
  try {
    esa = await event.$fetch('/api/esa/at', { query: { cadid } })
  } catch (e: any) {
    esaError = e?.data?.statusMessage || e?.message || 'the environmentally sensitive area test could not be read'
  }
  const esaHits = ((esa?.hits ?? []) as any[]).filter(h => h.kind === 'exclusion')

  /*
   * Advisory geometry is the plan's whole area rather than the mapped item, so it cannot rule a lot
   * out - it flags. verify_required IS real geometry and does rule out, while saying it needs a
   * human. Getting either of these the wrong way round is expensive in one direction or the other.
   */
  const esaExcludes = esaHits.filter(h => h.coverageType !== 'advisory')
  const esaFlags = esaHits.filter(h => h.coverageType === 'advisory')

  /*
   * The same land, reported twice.
   *
   * Two ways it happens. 14 esa layers are in cdc.layers directly, matched on the source name. And
   * some are the same dataset loaded into both schemas under different names - cdc's
   * terrestrial_biodiversity is epi.epi_terrestrial_biodiversity (431,369 features) and esa's
   * epi_biodiversity_significance is the same GEODAAS source (431,416), both paragraph (g).
   *
   * The second is matched on evidence rather than a rule: the same definition paragraph AND the
   * same share of this lot to within 0.05 points. Dropping every cdc layer that merely shares a
   * paragraph would hide real second hits - paragraph (c) is coastal wetlands AND littoral
   * rainforest, two different things - and ESA has no (b) at all, so a blanket rule would lose it.
   */
  const esaKeys = new Set(esaHits.map(h => String(h.key)))
  const esaByPara = esaHits.filter(h => h.paragraph)
    .map(h => ({ para: String(h.paragraph).toLowerCase(), cover: Number(h.coverPct) || 0 }))

  function alreadyInEsa(h: any) {
    const src = typeof h.source === 'string' ? h.source : ''
    if (src.startsWith('esa.') && esaKeys.has(src.slice(4))) return true
    // "1.17A(1)(e)(g)" -> "g", the workbook's numbering for the definition paragraph
    const para = (h.clauses ?? [])
      .map((c: string) => /1\.17A\(1\)\(e\)\(([a-j])\)/.exec(String(c))?.[1])
      .find(Boolean)
    if (!para) return false
    const cover = Number(h.coverPct) || 0
    return esaByPara.some(e => e.para === para && Math.abs(e.cover - cover) < 0.05)
  }

  const generalBlockers = ((at?.hits ?? []) as any[])
    .filter(h => h.kind === 'exclusion' && h.scope === 'general')
    .filter(h => !alreadyInEsa(h))
    // the note travels with the blocker: clause 1.19(1)(a) bars development in a heritage conservation
    // area "unless the development is a detached outbuilding, detached development (other than a
    // detached studio) or swimming pool", and a bare "ruled out by: Heritage conservation areas" reads
    // as though nothing at all can be built there
    /*
     * Everything a reader needs to check the claim, not just the layer's name.
     *
     *   key       so the page can link to /cdc-map and say WHICH layer to draw
     *   coverPct  "62% of the lot" is a different fact from "this layer touches the lot"
     *   source    14 of the 66 live layers are esa.*, and those have their own page
     */
    .map(h => ({
      title: h.title, clauses: h.clauses ?? [], note: h.note ?? null,
      key: h.key ?? null, coverPct: h.coverPct ?? null,
      source: h.source ?? null, names: h.names ?? null,
      via: 'cdc' as const, clause: null as string | null,
      coverageType: null as string | null, verifyRequired: false, half: null as string | null,
    }))
    .concat(esaExcludes.map(h => ({
      // titled by the item, because "esa.crown_reserves" is not what the clause calls it
      title: h.item, clauses: [h.cdcClause].filter(Boolean) as string[],
      note: null, key: h.key ?? null, coverPct: h.coverPct ?? null,
      source: 'esa', names: h.names ?? null,
      via: 'esa' as const, clause: h.clause ?? null,
      coverageType: h.coverageType ?? null, verifyRequired: Boolean(h.verifyRequired),
      half: h.half ?? null,
    })))
  const generalGaps = ((at?.gaps ?? []) as any[]).map(g => ({ title: g.title, clauses: g.clauses ?? [] }))

  /*
   * Facts the type checks need that the general sweep has already measured.
   *
   * bush fire, landslide, the Greenfield area, the ESA layers and heritage are all cdc.layers, and
   * /api/cdc/at has just tested every one of them against this lot. Asking the database again would
   * be a second answer to a question already answered, and the two could disagree.
   *
   * null, not false, when the sweep failed: a clause we could not test is undecidable, and reading
   * "no heritage layer hit" off an empty result would report a heritage lot as clear.
   */
  const atHits = ((at?.hits ?? []) as any[])
  const hitWhere = (f: (h: any) => boolean) => generalError === '' ? atHits.some(f) : null

  const lot = {
    cadid: r.cadid, lotId: r.lot_id,
    bushfireProne: hitWhere(h => h.key === 'bushfire_prone_land'),
    inEsa: hitWhere(h => typeof h.source === 'string' && h.source.startsWith('esa.')),
    hasHeritage: hitWhere(h => h.group === 'heritage'),
    areaM2: r.area_m2 == null ? null : Number(r.area_m2),
    // the property frontage; a landlocked lot has none, and its width checks are undecided, not guessed
    widthM: r.primary_frontage_length_m != null ? Number(r.primary_frontage_length_m) : null,
    zones: (r.zones ?? []) as string[],
    permissibility: r.permissibility ?? [],
    inGreenfield: Boolean(r.in_greenfield),
    landslideRisk: Boolean(r.landslide_risk),
    isBattleaxe: r.is_battleaxe == null ? null : Boolean(r.is_battleaxe),
    stemWidthM: r.stem_width_m == null ? null : Number(r.stem_width_m),
    inInlandCode: Boolean(r.in_inland_code),
  }

  /*
   * Eligible first, then undecidable, then ruled out.
   *
   * These used to come back in catalogue order, so on a lot where only one of them works, the
   * answer could sit anywhere in the list and the reader had to scan for it. Ordered by
   * what the lot can actually do, the useful row is the first one.
   *
   * Sorted here rather than on the page because /report reads the same route, and two orderings of
   * the same answers is a difference a reader would have to explain to themselves.
   */
  const VERDICT_ORDER = (e: boolean | null) => (e === true ? 0 : e === null ? 1 : 2)
  const catalogue = await loadCriteria()
  const types = catalogue
    .map((t, i) => ({ ...evaluate(t, lot, generalBlockers, generalError), _i: i }))
    // declaration order is the tie-break, so the list is stable within a group
    .sort((a, b) => VERDICT_ORDER(a.eligible) - VERDICT_ORDER(b.eligible) || a._i - b._i)
    .map(({ _i, ...rest }) => rest)
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
    /*
     * Advisory ESA items: shown, never counted against a type. Their geometry is the plan's whole
     * area rather than the item the clause describes, so ruling a lot out on it would fail lots the
     * instrument does not catch. verify_required items DO rule out and are in generalBlockers.
     */
    esaFlags: esaFlags.map((h: any) => ({
      item: h.item, clause: h.clause ?? null, cdcClause: h.cdcClause ?? null,
      coverageType: h.coverageType ?? null, verifyRequired: Boolean(h.verifyRequired),
      coverPct: h.coverPct ?? null, half: h.half ?? null,
    })),
    /** Non-empty when the ESA test could not be read; its exclusions are then unknown, not absent. */
    esaError,
    ms: Date.now() - started,
  }
})
