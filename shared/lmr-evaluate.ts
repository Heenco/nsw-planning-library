/**
 * The Chapter 6 verdict for one lot, as pure functions over facts already read.
 *
 * Shared by the two things that judge lots, so they can never disagree:
 *   /api/lmr/types              one lot, on a click ("This lot" on /lmr)
 *   scripts/build-lmr-lots.ts   every lot the walking catchments reach (lmr.lot_lmr, the LMR layer)
 *
 * Both read the same catalogue (lmr.type, lmr.type_check, lmr.general via /api/lmr/criteria's loader) and
 * gather the same facts in SQL; everything from facts to verdict happens here.
 */
import type { LmrAllowanceRow, LmrGeneralItem, LmrType } from '../server/api/lmr/criteria.get'

export type Band = 'inner' | 'outer'

export interface LmrTypeCheck {
  column: string
  says: string
  actual: string | null
  /** null when nothing measured it - unknown is not failure. */
  pass: boolean | null
}

export type GeneralStatus = 'clear' | 'excluded' | 'unknown' | 'gap' | 'n/a'

export interface LmrGeneralResult {
  clause: string
  text: string
  href: string
  coverage: 'full' | 'partial' | 'none'
  caveat: string | null
  /** excluded: the lot is in it. unknown: the data cannot say. gap: nothing answers it. n/a: the clause does not reach this council. */
  status: GeneralStatus
  why: string
  layers: string[]
  names: string[]
}

export interface LmrTypeResult {
  key: string
  name: string
  part: string
  sections: string
  eligible: boolean | null
  checks: LmrTypeCheck[]
  /** What the lot is allowed for this type in its band: standards the design has to meet. */
  allowances: LmrAllowanceRow[]
  untested: number
  untestedReasons: { reason: string; count: number }[]
  requirements: number
  verdict: string
}

export interface LmrLotFacts {
  cadid: string
  lotId: string | null
  lga: string | null
  areaM2: number | null
  widthM: number | null
  isBattleaxe: boolean | null
  zones: string[]
  band: Band | null
  /** What the band was measured from: '<station> (400 m)', '<town centre> (800 m)'. */
  measuredFrom: string[]
}

export interface Perm { epi: string; zone: string; landUse: string; status: string }

/** The layer hits for one s 164 item on one lot, summed over its layers. */
export interface GeneralHits { failN: number; unknownN: number; names: string[] }

export function evaluateGeneral(item: LmrGeneralItem, hits: GeneralHits, lga: string | null): LmrGeneralResult {
  const names = hits.names.slice(0, 4)
  const base = { clause: item.clause, text: item.text, href: item.href, coverage: item.coverage,
                 caveat: item.caveat, layers: item.layerKeys, names }

  if (item.coverage === 'none') return { ...base, status: 'gap', why: 'No dataset answers this, so the lot is untested against it.' }
  if (item.lgaScope && lga && !item.lgaScope.includes(lga)) {
    return { ...base, status: 'n/a', why: `Only reaches ${item.lgaScope.length} named councils; this lot is in ${lga}.` }
  }
  if (hits.failN) return { ...base, status: 'excluded', why: names.length ? `On the lot: ${names.join(', ')}.` : 'The lot is in it.' }
  if (hits.unknownN) return { ...base, status: 'unknown', why: `On the lot, but the data cannot decide it: ${names.join(', ') || 'see the layer'}.` }
  if (item.lgaScope && lga && item.heldLgas && !item.heldLgas.includes(lga)) {
    return { ...base, status: 'unknown', why: `${lga} is one of the councils this reaches, and we hold no map of it there.` }
  }
  if (item.lgaScope && !lga) return { ...base, status: 'unknown', why: 'The lot\'s council is not recorded, so whether this reaches it is not known.' }
  return { ...base, status: 'clear', why: 'Nothing on the lot.' }
}

function zonesFrom(says: string): string[] {
  const m = says.match(/zone is (.+)$/i)
  return m ? m[1]!.split(/,\s*/).map(z => z.trim().toUpperCase()) : []
}
function thresholdFrom(says: string): number | null {
  const m = says.replace(/,/g, '').match(/([\d.]+)\s*m/i)
  return m ? Number(m[1]) : null
}

function permissibility(t: LmrType, says: string, zones: string[], perm: Perm[]): LmrTypeCheck {
  const inTypeZones = zones.filter(z => t.zones.includes(z))
  // the SEPP's own grant wins whatever the LEP says: s 166 dual occupancies in R2, s 170, s 174, s 169(1A), s 173(1A)
  const granted = inTypeZones.filter(z => t.seppPermitsIn.includes(z))
  if (granted.length) {
    return { column: 'permissibility', says, pass: true,
             actual: `permitted with consent by s ${t.seppPermitsClause} in ${granted.join(', ')}, whatever the LEP says` }
  }
  if (!inTypeZones.length) return { column: 'permissibility', says, pass: null, actual: 'not in a zone this type applies in' }
  if (!t.landUses.length) return { column: 'permissibility', says, pass: null, actual: 'no land-use term to test' }
  const want = new Set(t.landUses.map(u => u.toLowerCase()))
  const rows = perm.filter(p => inTypeZones.includes(p.zone) && want.has(p.landUse.toLowerCase()))
  const yes = rows.find(p => p.status === 'permitted_with_consent')
  if (yes) return { column: 'permissibility', says, pass: true, actual: `${yes.landUse} permitted with consent in ${yes.zone} under ${yes.epi}` }
  if (!rows.length) {
    return { column: 'permissibility', says, pass: null,
             actual: `no permissibility recorded for ${t.landUses[0]} in ${inTypeZones.join(', ')}` }
  }
  const mixed = rows.find(p => p.status === 'mixed')
  if (mixed) return { column: 'permissibility', says, pass: null, actual: `${mixed.landUse} is permitted only in part of ${mixed.zone} under ${mixed.epi}` }
  const r = rows[0]!
  return { column: 'permissibility', says, pass: false, actual: `${r.landUse} ${r.status.replace(/_/g, ' ')} in ${r.zone} under ${r.epi}` }
}

export function evaluateType(t: LmrType, lot: LmrLotFacts, perm: Perm[],
                             excluded: LmrGeneralResult[], undecided: LmrGeneralResult[]): LmrTypeResult {
  const checks: LmrTypeCheck[] = t.checks.map((c) => {
    switch (c.column) {
      case 'lmr_area':
        return { ...c, pass: lot.band != null,
                 actual: lot.band ? `${lot.band === 'inner' ? 'inner area, within 400 m' : 'outer area, 400-800 m'} of ${lot.measuredFrom.join(', ')}`
                   : 'outside the 800 m walking catchments of every Town Centre and Schedule 11 station' }
      case 'zone': {
        const want = zonesFrom(c.says)
        return { ...c, actual: lot.zones.length ? lot.zones.join(', ') : null,
                 pass: lot.zones.length ? lot.zones.some(z => want.includes(z)) : null }
      }
      case 'permissibility':
        return permissibility(t, c.says, lot.zones, perm)
      case 'area': {
        const need = thresholdFrom(c.says)
        return { ...c, actual: lot.areaM2 == null ? null : `${Math.round(lot.areaM2).toLocaleString()} m²`,
                 pass: lot.areaM2 == null || need == null ? null : lot.areaM2 >= need }
      }
      case 'width': {
        const need = thresholdFrom(c.says)
        return { ...c, actual: lot.widthM == null ? 'no road frontage recorded' : `${lot.widthM.toFixed(1)} m of frontage`,
                 pass: lot.widthM == null || need == null ? null : lot.widthM >= need }
      }
      case 'derived:not_battleaxe':
        return { ...c, actual: lot.isBattleaxe == null ? null : lot.isBattleaxe ? 'is a battle-axe lot' : 'is not a battle-axe lot',
                 pass: lot.isBattleaxe == null ? null : !lot.isBattleaxe }
      default:
        return { ...c, actual: null, pass: null }
    }
  })

  const failed = checks.filter(c => c.pass === false)
  const unknown = checks.filter(c => c.pass === null)
  const eligible = excluded.length || failed.length ? false : (undecided.length || unknown.length) ? null : true

  const allowances = t.allowances.filter(a => a.band === 'any' || a.band === lot.band)
  const tally: Record<string, number> = {}
  for (const r of t.requirements) if (!r.tested && r.untestedWhy) tally[r.untestedWhy] = (tally[r.untestedWhy] ?? 0) + 1
  const untestedReasons = Object.entries(tally).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  const untested = untestedReasons.reduce((n, r) => n + r.count, 0)

  let verdict: string
  // an exclusion is the stronger answer: it holds wherever the catchments are later redrawn
  if (excluded.length) verdict = `Excluded by s ${excluded.map(e => e.clause).join(', s ')}: the chapter does not apply to this land.`
  else if (!lot.band) verdict = 'The chapter does not reach this lot: it is outside every low and mid rise housing area (s 163).'
  else if (failed.length) verdict = 'Fails ' + failed.map(c => c.says).join('; ') + '.'
  else if (undecided.length) verdict = `Clears its own checks, but s ${undecided.map(e => e.clause).join(', s ')} cannot be decided for this lot.`
  else if (unknown.length) verdict = 'Cannot be decided: ' + unknown.map(c => `${c.column} (${c.actual ?? 'not measured'})`).join('; ') + '.'
  else verdict = `Clears every check that reduces to a lot (${checks.length}).`
  if (eligible !== false && allowances.length) {
    verdict += ' Allowed: ' + allowances.map(a => [
      a.forUse, a.fsr != null ? `FSR ${a.fsr}:1` : null, a.heightM != null ? `${a.heightM} m` : null,
      a.storeys ? `${a.storeys} storeys` : null,
    ].filter(Boolean).join(' ')).join('; ') + '.'
  }
  if (untested) {
    verdict += ` ${untested} of its ${t.requirements.length} requirements are not tested here: `
      + untestedReasons.map(r => `${r.count} ${r.reason}`).join('; ') + '.'
  }

  return { key: t.key, name: t.name, part: t.part, sections: t.sections, eligible, checks, allowances,
           untested, untestedReasons, requirements: t.requirements.length, verdict }
}

/** The columns an s 164 layer's hit is named by, in order of preference. noise_verdict first: the Sydney
 *  Airport ANEI rows carry no name, and the verdict sentence is the useful label. */
export const NAME_COLUMNS = ['noise_verdict', 'label', 'name', 'itemname', 'h_name', 'council_name', 'station', 'lay_class', 'd_category']

/** The SQL that loads the catalogue, and the mapping from its rows - one copy for the route and the batch. */
export const CRITERIA_SQL = {
  types: `SELECT key, name, part, sections, zones, land_uses, sepp_permits_in, sepp_permits_clause,
                 allowances, note FROM lmr.type ORDER BY ord`,
  requirements: `SELECT type_key, clause, text, href, tested, tested_by, untested_why, derived
                   FROM lmr.type_requirement ORDER BY type_key, ord`,
  checks: `SELECT type_key, column_tested, says FROM lmr.type_check ORDER BY type_key, ord`,
  general: `SELECT clause, text, href, layer_keys, fail_where, unknown_where, lga_scope, held_lgas,
                   coverage, caveat FROM lmr.general ORDER BY ord`,
}

export function criteriaFromRows(t: any[], r: any[], c: any[], g: any[]): { types: LmrType[]; general: LmrGeneralItem[] } {
  const reqBy = new Map<string, LmrType['requirements']>()
  for (const x of r) {
    const list = reqBy.get(x.type_key) ?? []
    list.push({ clause: x.clause, text: x.text, href: x.href, tested: Boolean(x.tested), testedBy: x.tested_by,
                untestedWhy: x.untested_why, derived: x.derived })
    reqBy.set(x.type_key, list)
  }
  const checkBy = new Map<string, LmrType['checks']>()
  for (const x of c) {
    const list = checkBy.get(x.type_key) ?? []
    list.push({ column: x.column_tested, says: x.says })
    checkBy.set(x.type_key, list)
  }
  const types: LmrType[] = t.map((x) => {
    const requirements = reqBy.get(x.key) ?? []
    return {
      key: x.key, name: x.name, part: x.part, sections: x.sections,
      zones: x.zones ?? [], landUses: x.land_uses ?? [], seppPermitsIn: x.sepp_permits_in ?? [],
      seppPermitsClause: x.sepp_permits_clause, allowances: x.allowances ?? [], note: x.note,
      requirements, checks: checkBy.get(x.key) ?? [], testedCount: requirements.filter(q => q.tested).length,
    }
  })
  const general: LmrGeneralItem[] = g.map(x => ({
    clause: x.clause, text: x.text, href: x.href, layerKeys: x.layer_keys ?? [],
    failWhere: x.fail_where, unknownWhere: x.unknown_where, lgaScope: x.lga_scope, heldLgas: x.held_lgas,
    coverage: x.coverage, caveat: x.caveat,
  }))
  return { types, general }
}

/** The band from the nearest catchment distance the lot touches. */
export function bandFrom(stationMin: number | null, centreMin: number | null): Band | null {
  const nearest = Math.min(stationMin ?? Infinity, centreMin ?? Infinity)
  return nearest <= 400 ? 'inner' : nearest <= 800 ? 'outer' : null
}
