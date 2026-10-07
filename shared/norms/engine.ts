/**
 * The norms engine (trial) - one evaluator for every norm, no per-clause code.
 *
 *   1. every condition leaf is answered yes / no / unknown, and an unknown says WHO could answer it
 *      (the asker: a proposal or site fact; our data; the consent authority; nobody - an unparsed condition)
 *   2. a norm whose conditions are false is not in play; true = in play; unknown = in play "if ..."
 *   3. permits and prohibitions in play are resolved by defeat, the way the instruments say it:
 *        - X "despite" Y, or Y "subject to" X  -> X defeats Y
 *        - otherwise a SEPP defeats an LEP where they conflict (EP&A Act s 3.28; Housing SEPP s 8(1))
 *   4. the outcome:
 *        prohibited    a prohibition holds and nothing that holds defeats it
 *        permissible   a permit holds and no prohibition in play survives
 *        conditional   it turns on unknowns - listed, by who can answer them
 *        no_permission nothing permits it
 *   5. standards (development standards, non-discretionary standards) are listed after the outcome, each tested
 *      against the lot where the data allows ("each resulting lot >= 325 m2": the 247 m2 lot cannot meet it)
 */
import type { Cond, Effect, FactName, Norm, Question, Who } from './schema'
import { FACTS } from './schema'

export type Tri = boolean | null
export interface LotFacts {
  cadid: string; lotId: string | null; zone: string | null; epi: string | null; lga: string | null; areaM2: number | null
  /** the Lot Size Map minimum on the lot; null with onLotSizeMap false = not on the map; onLotSizeMap null = cannot tell */
  lotSizeMinM2: number | null; onLotSizeMap: Tri
  /** Land Use Table: use key -> status */
  lut: Record<string, string>
  /** our data's own site facts (a strata plan in the lot id), keyed as in Question.site */
  site: Record<string, boolean>
  /** the primary frontage (m) - lot width in every eligibility test is the frontage (Manni's rule) */
  frontageM?: number | null
  /** nsw.scope_layer terms the norms ask about, tested against the lot before evaluation: 'term' -> result */
  terms?: Record<string, { holds: Tri; why: string }>
}
export interface Leaf { fact: FactName; value?: string; under?: string; v: Tri; who: Who; why: string; span: string }
export interface NormResult {
  id: string; instrument: string; clause: string; effect: Effect; holds: Tri; leaves: Leaf[]
  defeatedBy?: string[]; defeatedIf?: string[]
}
export interface Outcome {
  outcome: 'prohibited' | 'permissible' | 'conditional' | 'no_permission'
  pathway: string | null
  controlling: string[]            // the norm ids the outcome rests on
  dependsOn: { who: Who; fact: string; span: string; clause: string; why: string }[]
  standards: { id: string; clause: string; standard: string; holds: Tri; test: string; displacedBy?: string[] }[]
  norms: NormResult[]
}

const and3 = (xs: Tri[]): Tri => xs.includes(false) ? false : xs.includes(null) ? null : true
const or3 = (xs: Tri[]): Tri => xs.includes(true) ? true : xs.includes(null) ? null : false
const not3 = (x: Tri): Tri => x === null ? null : !x
const cmpOf = (a: number, op: string, b: number) => op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'eq' ? a === b : op === 'gte' ? a >= b : a > b
const CMP: Record<string, string> = { lt: '<', lte: '≤', eq: '=', gte: '≥', gt: '>' }

export function evaluate(norms: Norm[], q: Question, lot: LotFacts, key: (u: string) => string): Outcome {
  const siteKey = (v: string, under?: string) => under ? `${key(v)}@${under}` : key(v)
  const asked = Object.fromEntries(Object.entries(q.site ?? {}).map(([k, b]) => {
    const [u, under] = k.split('@'); return [siteKey(u!, under), b]
  }))

  const leaf = (c: Extract<Cond, { fact: FactName }>): Leaf => {
    const who = FACTS[c.fact].who as Who
    const base = { fact: c.fact, value: c.value, under: c.under, who, span: c.span }
    const p = q.proposal
    const eq = (have: string | undefined, label: string): Leaf => have == null
      ? { ...base, v: null, why: `${label} not stated` }
      : { ...base, v: key(have) === key(String(c.value)), why: `${label}: ${have}` }
    switch (c.fact) {
      case 'proposal.kind': return { ...base, v: p.kind === c.value, why: `the proposal is ${p.kind.replace(/_/g, ' ')}` }
      case 'proposal.subdivision_type': return eq(p.subdivision_type, 'subdivision type')
      case 'proposal.use': return eq(p.use, 'the use proposed')
      case 'proposal.under': return eq(p.under, 'the instrument part it is carried out under')
      case 'proposal.proponent': return eq(p.proponent, 'who carries it out')
      case 'proposal.separates': return eq(p.separates, 'what the subdivision separates')
      case 'proposal.resulting_lots': return p.resulting_lots == null ? { ...base, v: null, why: 'number of lots not stated' }
        : { ...base, v: cmpOf(p.resulting_lots, c.cmp!, c.n!), why: `${p.resulting_lots} lots` }
      case 'proposal.floor_area_m2': return (p as any).floor_area_m2 == null ? { ...base, v: null, why: 'floor area not stated' }
        : { ...base, v: cmpOf((p as any).floor_area_m2, c.cmp!, c.n!), why: `${(p as any).floor_area_m2} m²` }
      case 'site.has': {
        const k = siteKey(String(c.value), c.under)
        if (k in asked) return { ...base, v: asked[k]!, why: `stated: ${asked[k] ? '' : 'no '}${c.value}${c.under ? ` under ${c.under}` : ''}` }
        if (k in lot.site) return { ...base, v: lot.site[k]!, why: `from the lot record (${lot.lotId})` }
        return { ...base, v: null, why: `whether the lot already has ${c.value}${c.under ? ` built under ${c.under}` : ''} is not recorded` }
      }
      case 'site.consent_before':
      case 'site.consent_on_or_after': {
        const k = `${c.fact}:${c.value}:${c.text}`
        const said = (q.site ?? {})[k]
        if (said != null) return { ...base, v: said, why: `stated: ${said ? 'yes' : 'no'}` }
        return { ...base, v: null, why: `whether the existing ${c.value} was approved ${c.fact === 'site.consent_before' ? 'before' : 'on or after'} ${c.text} is not recorded` }
      }
      case 'proposal.also_erects': return eq(p.also_erects, 'what the same application also erects')
      case 'site.approved_or_pending': {
        const said = (q.site ?? {})[`${c.fact}:${c.value}`]
        return said != null ? { ...base, v: said, why: `stated: ${said ? 'yes' : 'no'}` }
          : { ...base, v: null, why: `whether a consent is in force or an application pending for ${c.value} is not recorded` }
      }
      case 'lot.in': {
        const t = lot.terms?.[String(c.value).toLowerCase()]
        return t ? { ...base, v: t.holds, who: t.holds === null ? 'lot' : 'lot', why: `${c.value}: ${t.why}` }
          : { ...base, v: null, why: `${c.value}: not tested` }
      }
      case 'lot.frontage_m': return lot.frontageM == null ? { ...base, v: null, why: 'frontage not recorded' }
        : { ...base, v: cmpOf(lot.frontageM, c.cmp!, c.n!), why: `frontage ${lot.frontageM.toFixed(1)} m` }
      case 'lot.zone': return lot.zone == null ? { ...base, who: 'lot', v: null, why: 'zone not recorded' }
        : { ...base, v: lot.zone === String(c.value).toUpperCase(), why: `zone ${lot.zone}` }
      case 'lot.area_m2': return lot.areaM2 == null ? { ...base, v: null, why: 'area not recorded' }
        : { ...base, v: cmpOf(lot.areaM2, c.cmp!, c.n!), why: `${lot.areaM2} m²` }
      case 'lot.on_map': return { ...base, v: lot.onLotSizeMap,
        why: lot.onLotSizeMap === true ? `on the Lot Size Map (${lot.lotSizeMinM2} m²)` : lot.onLotSizeMap === false ? 'not on the Lot Size Map in our copy' : 'Lot Size Map not held for this plan' }
      case 'lot.permits': {
        // '$proposal.use': the Land Use Table asked about whatever use is proposed
        const use = c.value === '$proposal.use' ? p.use : String(c.value)
        if (!use) return { ...base, v: null, why: 'the use proposed is not stated' }
        const s = lot.lut[key(use)]
        base.value = use
        // "mixed": the Land Use Table splits the use ("dual occupancies (attached)" permitted, "(detached)" prohibited) -
        // which one is proposed decides, so it is the asker's to answer, never a no
        if (s === 'mixed') {
          const kinds = Object.entries(lot.lut).filter(([k]) => k.startsWith(key(use) + ' (')).map(([k, v]) => `${k.slice(key(use).length + 1)} ${v.replace(/_/g, ' ')}`)
          return { ...base, who: 'proposal', v: null, why: `${use} in ${lot.zone} depends on its form: ${kinds.join('; ') || 'mixed'}` }
        }
        return s == null ? { ...base, v: null, why: `no Land Use Table row for ${c.value} in ${lot.zone}` }
          : { ...base, v: /^permitted/.test(s), why: `${c.value} ${s.replace(/_/g, ' ')} in ${lot.zone}` }
      }
      case 'discretion': return { ...base, v: null, why: `the consent authority decides: ${c.text ?? c.span}` }
      case 'unparsed': return { ...base, v: null, why: `not read into the vocabulary: "${c.text ?? c.span}"` }
    }
  }
  const evalCond = (c: Cond, out: Leaf[]): Tri => {
    if ('all' in c) return and3(c.all.map(x => evalCond(x, out)))
    if ('any' in c) return or3(c.any.map(x => evalCond(x, out)))
    if ('not' in c) return not3(evalCond(c.not, out))
    const l = leaf(c); out.push(l); return l.v
  }

  const results: NormResult[] = norms.map(n => { const leaves: Leaf[] = []; return { id: n.id, instrument: n.instrument, clause: n.clause, effect: n.then, holds: evalCond(n.when, leaves), leaves } })
  const live = results.filter(r => r.holds !== false)
  const byId = new Map(norms.map(n => [n.id, n]))
  const rank = (r: NormResult) => /State Environmental Planning Policy/.test(r.instrument) ? 2 : 1
  const defeats = (x: NormResult, y: NormResult) => {
    const nx = byId.get(x.id)!, ny = byId.get(y.id)!
    if (nx.despite?.some(d => d === y.id || (d === 'instrument:*' && nx.instrument === ny.instrument))) return true
    if (ny.subjectTo?.includes(x.id)) return true
    if (ny.despite?.some(d => d === x.id || (d === 'instrument:*' && nx.instrument === ny.instrument))) return false
    return rank(x) > rank(y)
  }
  const permits = live.filter(r => 'permit' in r.effect)
  const bans = live.filter(r => 'prohibit' in r.effect)
  for (const b of bans) {
    b.defeatedBy = permits.filter(p => p.holds === true && defeats(p, b)).map(p => p.id)
    b.defeatedIf = permits.filter(p => p.holds === null && defeats(p, b)).map(p => p.id)
  }
  for (const p of permits) {
    p.defeatedBy = bans.filter(b => b.holds === true && defeats(b, p)).map(b => b.id)
    p.defeatedIf = bans.filter(b => b.holds === null && defeats(b, p)).map(b => b.id)
  }
  const standingBans = bans.filter(b => !b.defeatedBy!.length)
  const standingPermits = permits.filter(p => !p.defeatedBy!.length)
  const unknowns = (rs: NormResult[]) => rs.flatMap(r => r.leaves.filter(l => l.v === null)
    .map(l => ({ who: l.who, fact: l.value ? `${l.fact}: ${l.value}${l.under ? ` (under ${l.under})` : ''}` : l.fact, span: l.span, clause: r.clause, why: l.why })))

  let outcome: Outcome['outcome'], controlling: NormResult[], depends: NormResult[]
  const firmBan = standingBans.find(b => b.holds === true && !b.defeatedIf!.length)
  const openBan = standingBans.find(b => b.holds === true)
  const firmPermit = standingPermits.find(p => p.holds === true && !p.defeatedIf!.length)
  if (firmBan) { outcome = 'prohibited'; controlling = [firmBan]; depends = [] }
  else if (openBan) { outcome = 'conditional'; controlling = [openBan]; depends = openBan.defeatedIf!.map(id => results.find(r => r.id === id)!) }
  else if (firmPermit || standingPermits.some(p => p.holds === true)) {
    const p = firmPermit ?? standingPermits.find(x => x.holds === true)!
    const open = standingBans.filter(b => b.holds === null)
    outcome = open.length || p.defeatedIf!.length ? 'conditional' : 'permissible'
    controlling = [p]; depends = [...open, ...p.defeatedIf!.map(id => results.find(r => r.id === id)!)]
  } else if (standingPermits.length) { outcome = 'conditional'; controlling = standingPermits; depends = standingPermits }
  else { outcome = 'no_permission'; controlling = []; depends = [] }
  const pathway = controlling[0] && 'permit' in controlling[0].effect ? controlling[0].effect.permit : null

  // standards: those in play, tested against the lot where the data allows
  // a standard "despite" another replaces it where it holds ("Despite subclause (3), if the subdivision is of a lot on
  // which there is a dual occupancy— ... not less than 275m2", Randwick LEP 4.1A(4)); where it is undecided, both show
  const stds = live.filter(r => 'require' in r.effect)
  const replaced = new Set(stds.filter(r => r.holds === true).flatMap(r => byId.get(r.id)!.despite ?? []))
  // a grant "despite the provisions of another environmental planning instrument" (Housing SEPP s 169(1A)) that holds
  // displaces the LEPs' standards for this development - shown as displaced, never silently dropped
  const overLep = live.filter(r => r.holds === true && 'permit' in r.effect && (byId.get(r.id)!.despite ?? []).includes('doc_type:lep'))
  const standards = stds.filter(r => !replaced.has(r.id)).map(r => {
    if (overLep.length && rank(r) === 1) {
      const s0 = (r.effect as Extract<Effect, { require: unknown }>).require
      return { id: r.id, clause: r.clause, standard: `${s0.topic.replace(/_/g, ' ')} (${s0.kind.replace(/_/g, ' ')})`, holds: null as Tri,
               test: `displaced: ${overLep.map(x => x.clause).join(', ')} applies despite the provisions of another environmental planning instrument`,
               displacedBy: overLep.map(x => x.id) }
    }
    const s = (r.effect as Extract<Effect, { require: unknown }>).require
    const min = s.n ?? (s.from === 'lot_size_map' ? lot.lotSizeMinM2 : null)
    const label = `${s.topic.replace(/_/g, ' ')} ${CMP[s.cmp]} ${min ?? (s.from === 'lot_size_map' ? 'the Lot Size Map minimum' : s.from === 'existing' ? 'the number on the site before the development' : '?')}${s.unit && min != null ? ' ' + s.unit : ''} (${s.kind.replace(/_/g, ' ')})`
    let holds: Tri = null, test = 'not tested here'
    if (s.topic === 'resulting_lot_size' && min != null && lot.areaM2 != null && (s.cmp === 'gte' || s.cmp === 'gt')) {
      const lots = q.proposal.resulting_lots
      if (lots) { holds = lot.areaM2 / lots >= min; test = `${lots} lots from ${lot.areaM2} m² average ${Math.round(lot.areaM2 / lots)} m²${holds ? ' - possible; the layout decides' : ` - below ${min} m²`}` }
      else if (lot.areaM2 < 2 * min) { holds = false; test = `${lot.areaM2} m² cannot make 2 lots of ${min} m² (needs ${2 * min} m²)${lot.areaM2 < min ? `; the lot is itself under ${min} m²` : ''}` }
      else test = `${lot.areaM2} m² allows up to ${Math.floor(lot.areaM2 / min)} lots of ${min} m² - the layout decides`
    } else if (s.topic === 'resulting_lot_width' && s.n != null && lot.frontageM != null) {
      // side-by-side lots share the frontage (a battle-axe lot is the other way, and some clauses forbid it)
      const lots = q.proposal.resulting_lots ?? 2
      holds = lot.frontageM >= lots * s.n
      test = `frontage ${lot.frontageM.toFixed(1)} m for ${lots} lots side by side needs ${lots * s.n} m${holds ? '' : ' - not enough'}`
    } else if (s.topic === 'site_area' && s.n != null && lot.areaM2 != null) {
      holds = cmpOf(lot.areaM2, s.cmp, s.n); test = `site ${lot.areaM2} m²`
    }
    // a standard that may not apply is never reported as met or failed - only what it would be if it applies
    return { id: r.id, clause: r.clause, standard: label, holds: r.holds === null ? null : holds,
             test: r.holds === null ? `${holds === false ? 'would NOT be met: ' : holds === true ? 'would be met: ' : ''}${test}; applies only if ${r.leaves.filter(l => l.v === null).map(l => l.why).join('; ')}` : test }
  })

  // once per question asked: a norm reached two ways (an open prohibition that would also defeat the permit) asks once
  const dependsOn = [...new Map(unknowns([...new Set(depends)]).map(d => [`${d.clause}|${d.fact}|${d.why}`, d])).values()]
  return { outcome, pathway, controlling: controlling.map(r => r.id), dependsOn, standards, norms: results }
}
