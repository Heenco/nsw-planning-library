/**
 * RAG pilot - the deterministic evaluator over the rag engine's own claims (rag.claim, scripts/rag/02c-claims.ts).
 * No model, no pilot table. Plan shared/rag-plan.ts.
 *
 *   ask        { kind: 'permissibility' | 'standard', use, topic?, proposal?, detached? } for one lot (its frozen facts)
 *   applies?   a claim's own scope (use, zone, lot-size band, scope terms, the proposal) AND every frame above it -
 *              the frames of its clause, Part and Chapter, and of the unit it names ("development to which this Part
 *              applies"). A frame condition that is a question ("if a dwelling house is permissible on the land") is
 *              answered by asking it. A fact nobody holds is unknown, never assumed - except a frame exclusion no
 *              dataset answers, which is listed as "not checked" (so a whole Chapter is not lost to one unmapped layer)
 *   ruling     shared/rag/resolver.ts over rag.relation
 *   limits     for a permission: the conditions of the unit that grants it and the standards on the use, each tested
 *              on the lot; a cross-reference ("the maximum floor area permitted for a dwelling house ... under another
 *              environmental planning instrument") is asked as its own question
 *   text       writeAnswer() turns the result into sentences, from the result only
 */
import { landUseKey } from '../land-use-key'
import { resolve, type Claim as RClaim, type Rel, type Prov, type Resolution } from './resolver'

export type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>
/** pathway: a development application (the default) or a complying / exempt development certificate */
export interface Ask { kind: 'permissibility' | 'standard' | 'subdivision'; use: string; topic?: string; proposal?: 'development' | 'subdivision'; detached?: boolean | null; pathway?: 'da' | 'complying' | 'exempt'
  /** subdivision: how many lots, which title, when the consent for the development on the lot was granted, and whether the
   *  subdivision comes from one application with that development */
  lots?: number; tenure?: 'torrens' | 'strata' | 'community' | null; consentDate?: string | null; combinedDa?: boolean | null
  /** answer from one instrument only ("Under Randwick LEP 2012, ...") */
  only?: 'lep' | 'sepp' }
interface C { id: string; provision_id: string; kind: string; consent: string | null; uses: string[]; zones: string[]; terms: string[]; excludes: string[]; requires: any[]
  topic: string | null; comparator: string | null; value: number | null; unit: string | null; value_source: string | null; band: any; non_discretionary: boolean; unit_provision: string | null; span: string | null; reader: string }
interface PV { id: string; local_id: string; document_id: string; doc_kind: string; path: string[]; parent_id: string | null; heading: string | null }
export interface Engine { claims: C[]; provs: Map<string, PV>; rels: Rel[]; provMap: Map<string, Prov>; zoneNames: Map<string, string>; label: (provId: string) => string }

export interface Tested { claim: C; holds: boolean | null; why: string[]; notChecked: string[]; subs: Result[] }
export interface Limit { label: string; text: string; status: 'met' | 'not met' | 'depends' | 'applies'; detail: string; subs: Result[] }
export interface Result { ask: Ask; answer: { effect: string; value?: number | null; unit?: string | null; expr?: string } | null; verdict: string; ruling: Resolution | null
  tested: Tested[]; limits: Limit[]; notChecked: string[]; note?: string }

/** scope terms and frame exclusions the lot facts can answer; anything else is unknown (terms) or not checked (exclusions) */
const FACTS: [RegExp, (l: any) => boolean | null][] = [
  [/low and mid rise housing area/i, l => l.low_mid_rise_area?.band ? l.low_mid_rise_area.class !== 'excluded' : false],
  [/heritage item/i, l => l.heritage == null ? false : /item/i.test(l.heritage)],
]
const fact = (term: string, lot: any) => FACTS.find(([re]) => re.test(term))?.[1](lot) ?? undefined

export async function loadEngine(q: Query): Promise<Engine> {
  const claims: C[] = (await q(`SELECT c.*, c.value::float8 AS value FROM rag.claim c`)).rows
  const provs = new Map<string, PV>((await q(`SELECT p.id, p.local_id, p.document_id, i.kind doc_kind, coalesce(p.path, '{}') path, p.parent_id, p.heading
                                                FROM rag.provision p JOIN rag.instrument i USING (document_id)`)).rows.map(r => [r.id, r]))
  const rels: Rel[] = (await q(`SELECT kind, from_provision, to_provision, to_document, to_ref, status, basis, span FROM rag.relation WHERE kind NOT IN ('part_of', 'next', 'refers_to', 'defines')`)).rows
  const provMap = new Map<string, Prov>([...provs.values()].map(p => [p.id, { id: p.id, local_id: p.local_id, path: p.path, document_id: p.document_id, doc_kind: p.doc_kind }]))
  const zoneNames = new Map<string, string>((await q(`SELECT DISTINCT zone_code, zone_name FROM nsw.lep_permissibility WHERE zone_name IS NOT NULL`)).rows.map(r => [r.zone_code, r.zone_name]))
  const label = (id: string) => {
    const p = provs.get(id); if (!p) return id
    const segs = p.local_id.split('#')[0]!.split('-').filter(s => !/^oc\.\d+$/.test(s))
    if (p.path.some(x => x.startsWith('pt-cg')) || p.local_id.startsWith('pt-cg')) {
      const g = p.local_id.startsWith('pt-cg') ? p.local_id : p.path.find(x => x.startsWith('pt-cg'))!
      return `Randwick LEP Land Use Table, ${g.replace(/^pt-cg1\.Zone_/, 'Zone ')}${p.heading ? ` (${p.heading})` : ''}`
    }
    let s = ''
    for (const seg of segs) {
      let m: RegExpMatchArray | null
      if ((m = seg.match(/^sec\.(.+)$/))) s += p.doc_kind === 'sepp' ? `s ${m[1]}` : `cl ${m[1]}`
      else if ((m = seg.match(/^(?:ssec|para\d)\.(.+)$/))) s += `(${m[1]})`
      else if ((m = seg.match(/^sch\.(.+)$/))) s += `Sch ${m[1]} `
      else if ((m = seg.match(/^ch\.(.+)$/))) s += `Ch ${m[1]} `
      else if ((m = seg.match(/^pt\.(.+)$/))) s += `Pt ${m[1]} `
    }
    if (p.local_id.includes('#')) s += ' table'
    return `${p.doc_kind === 'sepp' ? 'Housing SEPP' : 'Randwick LEP'} ${s.trim()}`
  }
  return { claims, provs, rels, provMap, zoneNames, label }
}

const useMatch = (claimUse: string, asked: string) => {
  const a = landUseKey(asked), c = landUseKey(claimUse)
  return a === c || a.startsWith(c + ' (') || c.startsWith(a + ' (')
}

export function evaluate(E0: Engine, ask: Ask, lot: any, depth = 0): Result {
  const E: Engine = ask.only ? { ...E0, claims: E0.claims.filter(c => E0.provs.get(c.provision_id)?.doc_kind === ask.only) } : E0
  const ancestors = (id: string | null): string[] => { const out: string[] = []; for (let x = id ? E.provs.get(id) : undefined; x; x = x.parent_id ? E.provs.get(x.parent_id) : undefined) out.push(x.id); return out }
  const framesFor = (c: C) => {
    const units = new Set([...ancestors(c.provision_id), ...ancestors(c.unit_provision)])
    return E.claims.filter(f => f.kind === 'frame' && f.unit_provision && units.has(f.unit_provision))
  }
  const proposal = ask.proposal ?? 'development'
  const scope = (c: C, why: string[], notChecked: string[], subs: Result[], isFrame: boolean): boolean | null => {
    let h: boolean | null = true
    const and = (r: boolean | null, w: string) => { why.push(`${w}: ${r == null ? 'unknown' : r ? 'yes' : 'no'}`); if (r === false) h = false; else if (r == null && h !== false) h = null }
    if (c.uses.length) and(c.uses.some(u => useMatch(u, ask.use)), `use ${c.uses.join(' / ')}`)
    if (c.zones.length) and(c.zones.includes(String(lot.zone)), `zone ${c.zones.join(' / ')}`)
    for (const t of c.terms) {
      if (t === 'proposal:subdivision') and(proposal === 'subdivision', 'a subdivision')
      else if (t.startsWith('pathway:')) and((ask.pathway ?? 'da') === t.slice(8), `${t.slice(8)} development pathway`)
      else if (t.startsWith('tenure:')) and(ask.tenure ? ask.tenure === t.slice(7) : proposal === 'subdivision' ? null : false, `a ${t.slice(7)} title subdivision`)
      else if (t.startsWith('!tenure:')) and(ask.tenure ? ask.tenure !== t.slice(8) : proposal === 'subdivision' ? null : true, `not a ${t.slice(8)} title subdivision`)
      else if (t.startsWith('date:')) {
        // alternatives: any one that holds is enough
        const alts = t.slice(5).split('|').map(a => {
          const m = a.match(/^(consent|combined_da)(>=|<)(\d{4}-\d\d-\d\d)$/); if (!m) return null
          if (m[1] === 'consent') return ask.consentDate ? (m[2] === '>=' ? ask.consentDate >= m[3]! : ask.consentDate < m[3]!) : null
          return ask.combinedDa == null ? null : ask.combinedDa && (m[2] === '>=' ? (ask.consentDate ?? '9999') >= m[3]! : true)
        })
        and(alts.includes(true) ? true : alts.every(a => a === false) ? false : null, `${t.slice(5).replace(/\|/g, ' or ')}`)
      }
      else if (t.startsWith('lot:')) and(String(lot.lot ?? '').toUpperCase() === t.slice(4).toUpperCase(), `the named lot ${t.slice(4)}`)
      // a mapped area whose map no dataset holds: listed as not checked, and taken as not reaching the lot
      else if (t.startsWith('mapped:')) { notChecked.push(`${t.slice(7)} (map not held)`); and(false, `in ${t.slice(7)} (map not held - not checked)`) }
      else if (t === 'detached') and(ask.detached ?? null, 'detached')
      else { const f = fact(t, lot); and(f === undefined ? null : f, t) }
    }
    for (const ex of c.excludes) {
      if (ex.startsWith('zone:')) { const name = ex.slice(5); and(!new RegExp(name.replace(/ zone$/, ''), 'i').test(E.zoneNames.get(String(lot.zone)) ?? ''), `not in a ${name}`); continue }
      const f = fact(ex, lot)
      if (f === undefined) notChecked.push(ex); else and(!f, `not ${ex}`)
    }
    // a band on the lot's area or on its frontage (the rule here: a lot's width is its primary frontage)
    const bandValue = c.band?.metric === 'lot_size' ? lot.area_m2 : c.band?.metric === 'frontage' ? lot.frontage_m : undefined
    if (c.band?.metric && c.band.metric !== 'lot_size' && c.band.metric !== 'frontage') and(null, `${c.band.metric} band (no fact held)`)
    if (c.band?.metric === 'frontage' && lot.frontage_m == null) and(null, 'frontage band (frontage not known)')
    if ((c.band?.metric === 'lot_size' || c.band?.metric === 'frontage') && bandValue != null) {
      const a = Number(bandValue), b = c.band
      const ok = (b.lo == null || (b.lo_incl ? a >= b.lo : a > b.lo)) && (b.hi == null || (b.hi_incl ? a <= b.hi : a < b.hi))
      and(ok, `${b.metric === 'frontage' ? `frontage ${a} m` : `lot ${a} m2`} in ${b.lo ?? ''}${b.lo != null ? (b.lo_incl ? '≤' : '<') : ''}…${b.hi != null ? (b.hi_incl ? '≤' : '<') : ''}${b.hi ?? ''}`)
    }
    for (const r of c.requires) if (r.permissible && depth < 3) {
      const sub = evaluate(E, { kind: 'permissibility', use: r.permissible, proposal: 'development' }, lot, depth + 1)
      subs.push(sub); and(sub.verdict === 'permitted' ? true : sub.verdict === 'prohibited' ? false : null, `${r.permissible} permissible here`)
    }
    if (!isFrame) for (const f of framesFor(c)) {
      const w: string[] = []; const r = scope(f, w, notChecked, subs, true)
      and(r, `frame ${E.label(f.provision_id)} [${w.join('; ')}]`)
    }
    return h
  }
  const test = (c: C): Tested => { const why: string[] = [], notChecked: string[] = [], subs: Result[] = []; const holds = scope(c, why, notChecked, subs, false); return { claim: c, holds, why, notChecked, subs } }
  /** a claim with no use of its own speaks for the uses of its frames ("development to which this Part applies").
   *  A permission or prohibition of a narrower kind still answers the broader question (it is reported as "only as ...");
   *  a standard on a narrower kind (terraces) does not bind the broader use (multi dwelling housing). */
  const covers = (claimUse: string) => { const a = landUseKey(ask.use), c = landUseKey(claimUse); return a === c || a.startsWith(c + ' (') }
  const aboutUse = (c: C) => {
    const m = c.kind === 'standard' || c.kind === 'condition' ? covers : (u: string) => useMatch(u, ask.use)
    return c.uses.length ? c.uses.some(m) : framesFor(c).some(f => f.uses.some(m))
  }

  const mapValue = (src: string | null) => /Height/i.test(src ?? '') ? lot.height_map_m : /Floor Space/i.test(src ?? '') ? lot.fsr_map : /Lot Size/i.test(src ?? '') ? lot.lot_size_map_m2 : null
  const toR = (t: Tested, effect: 'value' | 'permit' | 'prohibit', value?: number | null): RClaim => ({ id: t.claim.id, provision: t.claim.provision_id, effect, value: value ?? null, unit: t.claim.unit,
    comparator: (t.claim.comparator as any) ?? null, holds: t.holds, condition: t.holds == null ? t.why.filter(w => /unknown/.test(w)).join('; ') : null, label: E.label(t.claim.provision_id) })
  const notChecked = new Set<string>()

  if (ask.kind === 'permissibility') {
    const tested = E.claims.filter(c => (c.kind === 'permit' || c.kind === 'prohibit') && aboutUse(c)).map(test)
    tested.forEach(t => t.notChecked.forEach(n => notChecked.add(n)))
    let ruling = resolve(tested.map(t => toR(t, t.claim.kind as any)), E.rels, E.provMap)
    // asked about a use whose kinds the table splits ("dual occupancies (attached)" permitted, "(detached)" prohibited):
    // the answer is yes for the permitted kinds - said, not left as a conflict
    let only: string[] = []
    if (ruling.verdict === 'maybe' && !ruling.branches?.length) {
      const live = tested.filter(t => t.holds !== false)
      const narrower = (t: Tested) => t.claim.uses.length > 0 && t.claim.uses.every(u => landUseKey(u) !== landUseKey(ask.use))
      if (live.length && live.every(narrower) && live.some(t => t.claim.kind === 'permit')) {
        only = [...new Set(live.filter(t => t.claim.kind === 'permit').flatMap(t => t.claim.uses))]
        ruling = { ...ruling, verdict: 'decided', answer: { effect: 'permit', claims: live.filter(t => t.claim.kind === 'permit').map(t => t.claim.id) }, unresolved: [] }
      }
    }
    const eff = ruling.answer?.effect
    const verdict = ruling.verdict === 'decided' ? (eff === 'permit' ? 'permitted' : 'prohibited') : ruling.verdict === 'maybe' ? 'maybe' : 'none'
    const note = only.length ? `only as ${only.join(' or ')} - other kinds of ${ask.use} are prohibited here` : undefined
    const limits: Limit[] = []
    if (verdict === 'permitted' || verdict === 'maybe') {
      const winners = tested.filter(t => t.holds !== false && t.claim.kind === 'permit' && (ruling.answer?.claims ?? tested.map(x => x.claim.id)).includes(t.claim.id))
      const units = new Set(winners.flatMap(w => [w.claim.unit_provision, ...ancestors(w.claim.provision_id)]).filter(Boolean) as string[])
      // the conditions of the unit that grants the permission
      for (const c of E.claims.filter(c => c.kind === 'condition' && c.unit_provision && units.has(c.unit_provision) && !c.terms.includes('proposal:subdivision'))) {
        const subs: Result[] = []
        for (const r of c.requires) if (r.standard && depth < 3) subs.push(evaluate(E, { kind: 'standard', use: r.use, topic: r.standard, proposal: 'development' }, lot, depth + 1))
        limits.push({ label: E.label(c.provision_id), text: c.span ?? '', status: 'applies', detail: c.value != null ? `${c.comparator ?? ''} ${c.value} ${c.unit ?? ''}`.trim() : '', subs })
      }
      for (const c of E.claims.filter(c => c.kind === 'condition' && c.unit_provision && units.has(c.unit_provision) && c.terms.includes('proposal:subdivision')))
        limits.push({ label: E.label(c.provision_id), text: c.span ?? '', status: 'applies', detail: 'after the development: no subdivision', subs: [] })
      // the standards on this use that reach the lot
      // standards on the use: named in the claim, or in the frame of the clause it sits in (s 168's leaves name no use;
      // s 168(1) does)
      for (const c of E.claims.filter(c => c.kind === 'standard' && aboutUse(c) && !c.terms.includes('proposal:subdivision'))) {
        const t = test(c); if (t.holds === false && !t.why.some(w => /^detached/.test(w))) continue
        const v = c.value_source?.startsWith('map:') ? mapValue(c.value_source) : c.value
        // alternatives ("whichever is the greater") are one limit: listed once, under the first of them
        if (c.band?.of && limits.some(l => l.text === `group:${c.band.of}`)) continue
        const alts = c.band?.of ? E.claims.filter(x => x.kind === 'standard' && x.band?.of === c.band.of) : [c]
        let status: Limit['status'] = 'applies'
        const fig = (x: C) => { const xv = x.value_source?.startsWith('map:') ? mapValue(x.value_source) : x.value; return x.band?.relative ? `${xv}${x.unit === '%' ? '%' : ` ${x.unit}`} of ${x.band.relative}` : `${xv} ${x.unit === 'm2' ? 'm²' : x.unit ?? ''}`.trim() }
        let detail = `${c.comparator === 'min' ? 'at least' : c.comparator === 'max' ? 'at most' : ''} ${alts.map(fig).join(' or ')}${c.band?.pick ? `, whichever is the ${c.band.pick}` : ''}`.trim()
        const detachedOnly = t.why.some(w => /^detached: unknown/.test(w))
        const subs: Result[] = []
        // any other figure on the use (FSR, height, width): the one that binds is a ruling over every standard on that topic
        if (c.topic && c.topic !== 'lot_size' && !c.band?.pick) {
          if (limits.some(l => l.text === `resolved:${c.topic}`)) continue
          const sub = evaluate(E, { kind: 'standard', use: ask.use, topic: c.topic, proposal: 'development', pathway: ask.pathway }, lot, depth + 1)
          const won = sub.tested.filter(x => sub.ruling?.answer?.claims?.includes(x.claim.id)).map(x => E.label(x.claim.provision_id))
          const u = sub.answer?.unit ?? ({ height: 'm', lot_width: 'm' } as Record<string, string>)[c.topic] ?? ''
          const val = sub.answer?.value != null ? `${sub.answer.value}${c.topic === 'fsr' ? ':1' : ` ${u === 'm2' ? 'm²' : u}`}` : 'not decided'
          // lot width is the primary frontage (the rule every eligibility test here uses)
          let status: Limit['status'] = 'applies', vs = ''
          if (c.topic === 'lot_width' && sub.answer?.value != null && lot.frontage_m != null) {
            const ok = Number(lot.frontage_m) >= Number(sub.answer.value); status = ok ? 'met' : 'not met'; vs = ` - frontage ${lot.frontage_m} m`
            // a non-discretionary standard that is not met does not bar consent: the proposal only loses its protection
            if (!ok && sub.tested.some(x => sub.ruling?.answer?.claims?.includes(x.claim.id) && x.claim.non_discretionary)) {
              status = 'depends'; vs += ' - not met, so this non-discretionary standard gives no protection; the council may still grant consent'
            }
          }
          limits.push({ label: c.topic === 'fsr' ? 'Maximum floor space ratio' : c.topic === 'height' ? 'Maximum building height' : c.topic === 'lot_width' ? 'Minimum lot width' : `${c.topic}`, text: `resolved:${c.topic}`, status,
            detail: `${val} (${won.join(', ') || '-'})${sub.ruling?.trace.length ? `; ${sub.ruling.trace.map(s => `${s.winner} ${/less onerous/.test(s.why) ? 'governs over' : 'displaces'} ${s.loser}`).join('; ')}` : ''}${vs}`, subs: [sub] })
          continue
        }
        if (c.topic === 'lot_size' && v != null && lot.area_m2 != null) {
          if (detachedOnly) {
            const ok = Number(lot.area_m2) >= v
            status = ok ? 'met' : 'depends'
            detail = `for a detached ${ask.use}: ${detail} - ${ok ? 'met' : `this lot has ${lot.area_m2} m², so only an attached one qualifies`}`
          } else {
            // the minimum that binds is a ruling, not this one claim: a non-discretionary standard may displace it
            if (limits.some(l => l.text === 'resolved:lot_size')) continue
            const sub = evaluate(E, { kind: 'standard', use: ask.use, topic: 'lot_size', proposal: 'development', pathway: ask.pathway }, lot, depth + 1)
            const min = sub.answer?.value != null ? Number(sub.answer.value) : v
            let ok = Number(lot.area_m2) >= min
            const ndWins = sub.tested.some(x => sub.ruling?.answer?.claims?.includes(x.claim.id) && x.claim.non_discretionary)
            const won = sub.tested.filter(x => sub.ruling?.answer?.claims?.includes(x.claim.id)).map(x => E.label(x.claim.provision_id))
            detail = `at least ${min} m² (${won.join(', ') || E.label(c.provision_id)})${sub.ruling?.trace.length ? `; ${sub.ruling.trace.map(s => `${s.winner} displaces ${s.loser}`).join('; ')}` : ''} - this lot has ${lot.area_m2} m²`
            if (!ok && ndWins) {
              // the safe harbour is not met: it gives no protection, and what it displaced binds again
              const E2: Engine = { ...E, claims: E.claims.filter(x => !x.non_discretionary) }
              const back = evaluate(E2, { kind: 'standard', use: ask.use, topic: 'lot_size', proposal: 'development', pathway: ask.pathway }, lot, depth + 1)
              const min2 = back.answer?.value != null ? Number(back.answer.value) : null
              ok = min2 == null || Number(lot.area_m2) >= min2
              detail += `; not met, so the non-discretionary standard gives no protection and ${min2 == null ? 'no other minimum applies' : `${back.tested.filter(x => back.ruling?.answer?.claims?.includes(x.claim.id)).map(x => E.label(x.claim.provision_id)).join(', ')} (${min2} m²) binds again`}`
              subs.push(back)
            }
            status = ok ? 'met' : 'not met'
            if (!ok) detail += '; consent cannot be granted unless the standard is varied under cl 4.6'
            limits.push({ label: 'Minimum lot size', text: 'resolved:lot_size', status, detail, subs: [sub, ...subs] })
            continue
          }
        }
        limits.push({ label: E.label(c.provision_id).replace(/\((a|i)\)$/, ''), text: c.band?.of ? `group:${c.band.of}` : (c.span ?? ''), status, detail: `${c.topic?.replace('_', ' ')}: ${detail}${c.non_discretionary ? ' (non-discretionary standard)' : ''}`, subs })
      }
    }
    return { ask, answer: ruling.answer, verdict, ruling, tested, limits, notChecked: [...notChecked], note }
  }

  // a subdivision: the minimum lot size is a ruling (it may turn on a date nobody gave - then each case is answered),
  // and each resulting lot is checked against it
  if (ask.kind === 'subdivision') {
    const lots = ask.lots ?? 2, each = lot.area_m2 != null ? Number(lot.area_m2) / lots : null
    const min = evaluate(E, { ...ask, kind: 'standard', topic: 'lot_size', proposal: 'subdivision' }, lot, depth + 1)
    // the binding minimum, given the claims that won: a non-discretionary minimum protects only if every standard in its
    // set is met (area and width per lot); otherwise what it displaced binds again - and with nothing else, nothing does
    const fallback = () => { const E2: Engine = { ...E, claims: E.claims.filter(x => !x.non_discretionary) }
      const r2 = evaluate(E2, { ...ask, kind: 'standard', topic: 'lot_size', proposal: 'subdivision' }, lot, depth + 1); return r2.answer?.value != null ? Number(r2.answer.value) : null }
    const can = (v: number | null | undefined, ids: string[] = []) => {
      if (each == null) return null
      if (v == null) return true                                            // no minimum binds
      const nd = min.tested.filter(t => ids.includes(t.claim.id) && t.claim.non_discretionary)
      if (!nd.length) return each >= v
      const set = E.claims.filter(c => c.non_discretionary && c.terms.includes('proposal:subdivision') && nd.some(t => t.claim.unit_provision === c.unit_provision))
      const width = set.find(c => c.topic === 'lot_width' && c.value != null)
      const met = each >= v && (!width || (lot.frontage_m != null ? Number(lot.frontage_m) / lots >= Number(width.value) : false)) && !lot.battle_axe
      if (met) return true
      const v2 = fallback(); return v2 == null ? true : each >= v2
    }
    let verdict: string, answer: Result['answer']
    if (min.verdict === 'maybe' && min.ruling?.branches?.length) {
      const outs = min.ruling.branches.map(b => can(b.answer?.value as number, b.answer?.claims ?? []))
      verdict = outs.every(o => o === true) ? 'yes' : outs.every(o => o === false) ? 'no' : 'maybe'
      answer = { effect: 'value', value: null, expr: min.ruling.branches.map(b => `${b.answer?.value ?? 'no minimum'} m² if ${b.if}`).join('; ') }
    } else {
      const v = min.answer?.value != null ? Number(min.answer.value) : null
      const c = v == null ? (min.verdict === 'none' ? true : null) : can(v, min.ruling?.answer?.claims ?? [])
      verdict = c === true ? 'yes' : c === false ? 'no' : 'maybe'
      answer = { effect: 'value', value: v, unit: 'm2' }
    }
    return { ask, answer, verdict, ruling: min.ruling, tested: min.tested,
      limits: [{ label: 'Each resulting lot', text: 'resolved:lot_size', status: verdict === 'yes' ? 'met' : verdict === 'no' ? 'not met' : 'depends', detail: `about ${each != null ? Math.round(each) : '?'} m² from ${lot.area_m2} m² in ${lots} lots`, subs: [min] }],
      notChecked: min.notChecked }
  }

  // a figure: the standards on this topic that reach this lot and use
  const topic = ask.topic!
  // a subdivision's minimum is a standard on the resulting lots; a development's lot size is a standard on the site.
  // Each question reads only its own kind.
  const ofProposal = (c: C) => ask.proposal === 'subdivision' && topic === 'lot_size' ? c.terms.includes('proposal:subdivision') : !c.terms.includes('proposal:subdivision')
  const direct = E.claims.filter(c => c.kind === 'standard' && c.topic === topic && (aboutUse(c) || (!c.uses.length && !framesFor(c).some(f => f.uses.length))) && ofProposal(c))
  const tested = direct.map(test).map(t => ({ ...t, value: t.claim.value_source?.startsWith('map:') ? mapValue(t.claim.value_source) : t.claim.value }))
  tested.forEach(t => t.notChecked.forEach(n => notChecked.add(n)))
  const live = tested.filter(t => t.holds !== false && t.value != null)
  // floor area with no floor-area standard: the floor space ratio times the site area
  if (topic === 'floor_area' && !live.length && depth < 3) {
    const fsr = evaluate(E, { ...ask, topic: 'fsr' }, lot, depth + 1)
    const v = fsr.answer?.value != null && lot.area_m2 != null ? Math.round(Number(fsr.answer.value) * Number(lot.area_m2) * 10) / 10 : null
    return { ask, answer: v != null ? { effect: 'value', value: v, unit: 'm2', expr: `${fsr.answer!.value}:1 x ${lot.area_m2} m2` } : null, verdict: v != null ? 'decided' : fsr.verdict,
      ruling: fsr.ruling, tested: fsr.tested, limits: [{ label: 'derived', text: 'floor space ratio x site area', status: 'applies', detail: v != null ? `${v} m2` : 'unknown', subs: [fsr] }], notChecked: fsr.notChecked }
  }
  // "whichever is the greater / lesser" of alternatives: one figure, or an expression when one side is relative
  const groups = new Map<string, typeof live>()
  for (const t of live) { const k = t.claim.band?.of ?? t.claim.id; groups.set(k, [...(groups.get(k) ?? []), t]) }
  const rclaims: RClaim[] = []
  let expr: string | undefined
  for (const [, g] of groups) {
    if (g.length > 1 && g[0]!.claim.band?.pick) {
      const abs = g.filter(t => !t.claim.band?.relative), rel = g.filter(t => t.claim.band?.relative)
      expr = [...abs.map(t => `${t.value} ${t.claim.unit}`), ...rel.map(t => `${t.value}${t.claim.unit === '%' ? '%' : ''} of ${t.claim.band.relative}`)].join(` or `) + `, whichever is the ${g[0]!.claim.band.pick}`
      if (abs[0]) rclaims.push(toR(abs[0], 'value', abs[0].value))
    } else for (const t of g) rclaims.push(toR(t, 'value', t.value))
  }
  const ruling = resolve(rclaims, E.rels, E.provMap)
  const answer = ruling.answer ? { ...ruling.answer, ...(expr ? { expr } : {}) } : null
  return { ask, answer, verdict: ruling.verdict, ruling, tested, limits: [], notChecked: [...notChecked] }
}

/** the answer in sentences - every clause and figure in it comes from the result */
export function writeAnswer(E: Engine, r: Result, lot: any): string {
  const L: string[] = []
  const unitOf = (u: string | null | undefined) => u === 'm2' ? 'm²' : u ?? ''
  const fmt = (x: Result) => !x.answer ? x.verdict : x.answer.effect !== 'value' ? x.answer.effect
    : x.ask.topic === 'fsr' ? `${x.answer.value}:1`
    : x.answer.expr && /x/.test(x.answer.expr) ? `${x.answer.value} ${unitOf(x.answer.unit)} (${x.answer.expr})`     // derived: 187.9 m² (0.65:1 x 289 m2)
    : x.answer.expr ?? `${x.answer.value} ${unitOf(x.answer.unit)}`.trim()
  const where = `${lot.address ?? lot.lot} (${lot.area_m2} m2, Zone ${lot.zone})`
  if (r.ask.kind === 'permissibility') {
    L.push(`${r.ask.use[0]!.toUpperCase()}${r.ask.use.slice(1)} on ${where}: ${r.verdict === 'permitted' ? `permissible ${r.answer && r.tested.find(t => t.claim.id === r.ruling?.answer?.claims?.[0])?.claim.consent === 'without' ? 'without' : 'with'} consent` : r.verdict === 'prohibited' ? 'prohibited' : r.verdict === 'maybe' ? 'it depends - see below' : 'no rule found'}${r.note ? ` (${r.note})` : ''}.`)
    for (const t of r.tested.filter(t => t.holds !== false)) {
      const c = t.claim
      // name the use when the claim is about a narrower one than asked ("dual occupancies (attached)" for "dual occupancy")
      const what = c.uses.length && !c.uses.some(u => landUseKey(u) === landUseKey(r.ask.use)) ? c.uses.join(', ') : 'it'
      if (c.kind === 'prohibit') L.push(`- ${E.label(c.provision_id)} prohibits ${what}${c.span?.startsWith('catchall') ? ', as development not listed in items 2 or 3' : ''}.`)
      else L.push(`- ${E.label(c.provision_id)} permits ${what}${c.consent === 'without' ? ' without consent' : ' with consent'}.`)
      for (const f of t.why.filter(w => /^frame/.test(w))) L.push(`    ${f.replace(/^frame /, 'applies because ').replace(/: yes$/, '')}`)
      for (const s of t.subs) L.push(`    (${s.ask.use}: ${s.verdict} - ${s.tested.filter(x => x.holds !== false).map(x => E.label(x.claim.provision_id)).join(', ')})`)
    }
    for (const s of r.ruling?.trace ?? []) L.push(`- ${s.winner} prevails over ${s.loser}: ${s.why}.`)
    for (const b of r.ruling?.branches ?? []) L.push(`- if ${b.if}: ${b.answer?.effect ?? 'no rule'}`)
    if (r.limits.length) {
      L.push('Limits:')
      for (const l of r.limits) {
        const subs = l.text.startsWith('resolved:') ? [] : l.subs.map(s => `${s.ask.use} ${s.ask.topic}: ${fmt(s)}${s.ruling?.answer?.claims?.length ? ` (${s.tested.filter(t => s.ruling!.answer!.claims.includes(t.claim.id)).map(t => E.label(t.claim.provision_id)).join(', ')})` : ''}`)
        const tag = l.text.startsWith('resolved:') ? (l.status === 'met' ? ' - met' : l.status === 'not met' ? ' - NOT MET' : '') : l.status === 'met' ? ' - met' : l.status === 'not met' ? ' - NOT met by this lot' : l.status === 'depends' ? ' - depends' : ''
        L.push(`- ${l.label}${l.detail ? `: ${l.detail}` : ''}${tag}${subs.length ? ` -> ${subs.join('; ')}` : ''}`)
        if (!l.detail && l.text) L.push(`    "${l.text.slice(0, 160)}"`)
      }
    }
  } else {
    const what = r.ask.kind === 'subdivision' ? `${r.ask.tenure ?? ''} subdivision into ${r.ask.lots ?? 2} lots - minimum lot size`.trim() : (r.ask.topic ?? '').replace('_', ' ')
    L.push(`${what[0]?.toUpperCase() ?? ''}${what.slice(1)} for ${r.ask.use} on ${where}: ${fmt(r)}${r.ask.kind === 'subdivision' ? ` - ${r.verdict === 'yes' ? 'each lot clears it' : r.verdict === 'no' ? 'the lots do not clear it' : 'depends'}` : r.verdict === 'maybe' ? ' (depends)' : ''}.`)
    for (const s of r.ruling?.trace ?? []) L.push(`- ${s.winner} prevails over ${s.loser}: ${s.why}.`)
    for (const t of r.tested.filter(t => t.holds !== false)) L.push(`- ${E.label(t.claim.provision_id)}: ${(t as any).value ?? ''} ${t.claim.unit ?? ''}${t.claim.non_discretionary ? ' (non-discretionary)' : ''}`)
  }
  if (r.notChecked.length) L.push(`Not checked (no data held): ${[...new Set(r.notChecked)].slice(0, 8).join('; ')}${r.notChecked.length > 8 ? '; ...' : ''}.`)
  return L.join('\n')
}
