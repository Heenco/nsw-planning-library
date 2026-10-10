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
import { shortName } from './refs'

export type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>
/** pathway: a development application (the default) or a complying / exempt development certificate */
export interface Ask { kind: 'permissibility' | 'standard' | 'subdivision'; use: string; topic?: string; proposal?: 'development' | 'subdivision'; detached?: boolean | null; pathway?: 'da' | 'complying' | 'exempt'
  /** subdivision: how many lots, which title, when the consent for the development on the lot was granted, and whether the
   *  subdivision comes from one application with that development */
  lots?: number; tenure?: 'torrens' | 'strata' | 'community' | null; consentDate?: string | null; combinedDa?: boolean | null
  /** answer from one instrument only ("Under <instrument>, ..."): its document id */
  only?: string }
interface C { id: string; provision_id: string; kind: string; consent: string | null; uses: string[]; zones: string[]; terms: string[]; excludes: string[]; requires: any[]
  topic: string | null; comparator: string | null; value: number | null; unit: string | null; value_source: string | null; band: any; non_discretionary: boolean; unit_provision: string | null; span: string | null; reader: string }
interface PV { id: string; local_id: string; document_id: string; doc_kind: string; path: string[]; parent_id: string | null; heading: string | null }
/** how a claim's condition is tested (rag.claim_binding, decided when the graph was built - scripts/rag/02d-bindings.ts) */
interface Binding { claim_id: string; part: string; text: string; status: string; scope_terms: string[]; sources: string[]; assume_absent: boolean; note: string | null }
export interface Engine { claims: C[]; provs: Map<string, PV>; rels: Rel[]; provMap: Map<string, Prov>; zoneNames: Map<string, string>; label: (provId: string) => string
  bindings: Map<string, Binding[]>; shortNames: Map<string, string>
  /** the date each instrument's text is in force as at (nsw.document.as_at_date, Sydney date): every answer is the law on that day */
  asAt: Map<string, string>
  /** the instruments held: which LEP governs a lot is decided from these */
  insts: { document_id: string; title: string; kind: string }[] }

/** one condition as it was tested on the lot - or why it could not be */
export interface Check { text: string; result: boolean | null; how: string; could: boolean }
export interface Tested { claim: C; holds: boolean | null; why: string[]; notChecked: string[]; subs: Result[]; checks: Check[] }
export interface Limit { label: string; text: string; status: 'met' | 'not met' | 'depends' | 'applies'; detail: string; subs: Result[] }
export interface Result { ask: Ask; answer: { effect: string; value?: number | null; unit?: string | null; expr?: string } | null; verdict: string; ruling: Resolution | null
  tested: Tested[]; limits: Limit[]; notChecked: string[]; note?: string; checks: Check[] }

export { shortName }

export async function loadEngine(q: Query): Promise<Engine> {
  const claims: C[] = (await q(`SELECT c.*, c.value::float8 AS value FROM rag.claim c`)).rows
  const bindings = new Map<string, Binding[]>()
  for (const b of (await q(`SELECT claim_id, part, text, status, scope_terms, sources, assume_absent, note FROM rag.claim_binding`).catch(() => ({ rows: [] as any[] }))).rows)
    bindings.set(b.claim_id, [...(bindings.get(b.claim_id) ?? []), b])
  const insts = (await q(`SELECT document_id, title, kind FROM rag.instrument ORDER BY rank, title`)).rows
  const shortNames = new Map<string, string>(insts.map(r => [r.document_id, shortName(r.title)]))
  const asAt = new Map<string, string>((await q(`SELECT i.document_id, (d.as_at_date AT TIME ZONE 'Australia/Sydney')::date::text AS as_at
                                                   FROM rag.instrument i JOIN nsw.document d ON d.id = i.document_id WHERE d.as_at_date IS NOT NULL`).catch(() => ({ rows: [] as any[] }))).rows.map(r => [r.document_id, r.as_at]))
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
      return `${shortNames.get(p.document_id) ?? ''} Land Use Table, ${g.replace(/^pt-cg1\.Zone_/, 'Zone ')}${p.heading ? ` (${p.heading})` : ''}`.trim()
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
    return `${shortNames.get(p.document_id) ?? ''} ${s.trim()}`.trim()
  }
  return { claims, provs, rels, provMap, zoneNames, label, bindings, shortNames, asAt, insts }
}

const useMatch = (claimUse: string, asked: string) => {
  const a = landUseKey(asked), c = landUseKey(claimUse)
  return a === c || a.startsWith(c + ' (') || c.startsWith(a + ' (')
}

/**
 * The LEP that governs a lot: the plan its zoning comes from (lot.epi), else the one named for its council, else the only
 * LEP held. A lot under a plan the corpus does not hold has none - and is never answered from the SEPPs alone.
 */
export function lepFor(E: Engine, lot: any): { doc: string | null; why: string } {
  const leps = E.insts.filter(i => i.kind === 'lep')
  const named = (s: string) => leps.filter(l => new RegExp(`(^|[^a-z])${shortName(l.title).replace(/ LEP$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(s))
  if (lot?.epi) {
    const i = leps.find(l => l.title.toLowerCase() === String(lot.epi).toLowerCase())
    return i ? { doc: i.document_id, why: `zoned under ${shortName(i.title)}` } : { doc: null, why: `the lot is zoned under ${lot.epi}, which is not in the corpus` }
  }
  if (lot?.lga) {
    const i = named(String(lot.lga))
    if (i.length === 1) return { doc: i[0]!.document_id, why: `council ${lot.lga}` }
    return { doc: null, why: `no LEP held for council ${lot.lga}` }
  }
  if (leps.length === 1) return { doc: leps[0]!.document_id, why: 'the only LEP held' }
  return { doc: null, why: `which of the ${leps.length} LEPs held applies is not stated` }
}

export function evaluate(E0: Engine, ask: Ask, lot: any, depth = 0): Result {
  // the instruments that speak to this lot: the one asked about ("Under ..."), else the SEPPs and the lot's own LEP
  const docOf = (c: C) => E0.provs.get(c.provision_id)
  const lep = ask.only ? null : lepFor(E0, lot)
  if (lep && !lep.doc && E0.insts.some(i => i.kind === 'lep'))
    return { ask, answer: null, verdict: 'maybe', ruling: null, tested: [], limits: [], notChecked: [lep.why], checks: [],
      note: `${lep.why} - its Land Use Table and standards are not read, so no answer is given from the other instruments alone` }
  const E: Engine = ask.only ? { ...E0, claims: E0.claims.filter(c => docOf(c)?.document_id === ask.only) }
    : lep?.doc ? { ...E0, claims: E0.claims.filter(c => docOf(c)?.doc_kind !== 'lep' || docOf(c)?.document_id === lep.doc) } : E0
  // a lot the Height of Buildings / Floor Space Ratio / Lot Size Map splits (two or more figures over it): the question is
  // answered for each part, and the answer is that figure only if every part gets the same one - else "maybe", part by part
  const splitField = ask.kind === 'standard' ? ({ height: 'height_map_m', fsr: 'fsr_map', floor_area: 'fsr_map', lot_size: 'lot_size_map_m2' } as Record<string, string>)[ask.topic ?? ''] : undefined
  const split = splitField ? lot?.map_split?.[splitField] as { value: number; share: number }[] | undefined : undefined
  if (split && split.length > 1) {
    const { map_split: _ms, ...rest } = lot
    const parts = split.map(s => ({ s, r: evaluate(E0, ask, { ...rest, [splitField!]: s.value }, depth) }))
    const mapName = splitField === 'height_map_m' ? 'Height of Buildings Map' : splitField === 'fsr_map' ? 'Floor Space Ratio Map' : 'Lot Size Map'
    const said = `the ${mapName} gives this lot ${split.map(s => `${s.value} on ${Math.round(s.share * 100)}%`).join(', ')}`
    const same = new Set(parts.map(p => `${p.r.verdict}|${p.r.answer?.value ?? ''}|${p.r.answer?.expr ?? ''}`)).size === 1
    const check: Check = { text: `${mapName} on this lot`, result: null, how: said, could: !same ? false : true }
    if (same) return { ...parts[0]!.r, note: [parts[0]!.r.note, `${said} - the same answer on every part`].filter(Boolean).join('; '), checks: [...parts[0]!.r.checks, check] }
    const u = parts.find(p => p.r.answer?.unit)?.r.answer?.unit ?? ({ height_map_m: 'm', lot_size_map_m2: 'm2' } as Record<string, string>)[splitField!] ?? ''
    const fig = (v: unknown) => splitField === 'fsr_map' ? `${v}:1` : `${v} ${u === 'm2' ? 'm²' : u}`.trim()
    return { ask, verdict: 'maybe', answer: { effect: 'value', value: null, unit: u || null, expr: parts.map(p => `${p.r.answer?.value != null ? fig(p.r.answer.value) : p.r.answer?.expr ?? 'none'} on the part mapped ${fig(p.s.value)} (${Math.round(p.s.share * 100)}% of the lot)`).join('; ') },
      ruling: parts[0]!.r.ruling, tested: parts.flatMap(p => p.r.tested), limits: [], notChecked: [...new Set([...parts.flatMap(p => p.r.notChecked), `${said} - answered part by part`])],
      note: `${said}: the answer differs between the parts`, checks: [...parts.flatMap(p => p.r.checks), check] }
  }
  /** a map area of the claim's own instrument (map names repeat across LEPs: "Area 1 on the Key Sites Map") */
  const ownMap = (c: C, x: any) => !x.document_id || x.document_id === docOf(c)?.document_id
  /** a map label as rag.map_polygon stores it: lower case, any dash as "-" with no space round it */
  const nl = (s: unknown) => String(s ?? '').trim().replace(/^(?:a|an|the)\s+/i, '').replace(/\s*[-\u2013\u2014]\s*/g, '-').replace(/\s+/g, ' ').toLowerCase()
  const ancestors = (id: string | null): string[] => { const out: string[] = []; for (let x = id ? E.provs.get(id) : undefined; x; x = x.parent_id ? E.provs.get(x.parent_id) : undefined) out.push(x.id); return out }
  const framesFor = (c: C) => {
    const units = new Set([...ancestors(c.provision_id), ...ancestors(c.unit_provision)])
    return E.claims.filter(f => f.kind === 'frame' && f.unit_provision && units.has(f.unit_provision))
  }
  const proposal = ask.proposal ?? 'development'
  /**
   * A condition tested through the binding the graph build gave it: the registered layers (nsw.scope_layer, tested on
   * this lot into lot.terms), a council list, or nothing - and then it is said that it could not be checked, and why.
   */
  const viaBinding = (c: C, text: string, part: string): Check => {
    const b = E.bindings.get(c.id)?.find(x => x.part === part && x.text === text)
    if (!b) return { text, result: null, how: 'no binding: the graph build did not decide how to test it', could: false }
    if (b.status === 'bound') {
      const lgaT = b.scope_terms.filter(t => t.startsWith('lga:')), layerT = b.scope_terms.filter(t => !/^(lga:|map:|notmap:|unheld:|use:|fact:|!?zone:|zoneclass:|zonegroup:|area>=|lot$)/.test(t))
      // a fact of the proposal the item joins to the land ("a building with a height of at least 10m"): not given - unknown
      const factT = b.scope_terms.filter(t => t.startsWith('fact:')), factR = factT.length ? null : undefined
      // the use of the proposal (an item "hotel or motel accommodation"): one of the uses named, tested on the use asked about
      const useT = b.scope_terms.filter(t => t.startsWith('use:'))
      const useR = useT.length ? useT.some(t => t.slice(4).split('|').some(u => useMatch(u, ask.use))) : undefined
      const lgaR = lgaT.length ? (lot.lga ? lgaT.some(t => t.slice(4) === String(lot.lga).toUpperCase()) : null) : undefined
      // a list item's own tests: the lot's zone (named, excepted, by class name, or by the Standard Instrument's zone group -
      // "a rural or residential zone": RU1.., R1..), its area, a map label's polygon
      const zIn = b.scope_terms.filter(t => /^(zone|zoneclass|zonegroup):/.test(t)), zOut = b.scope_terms.filter(t => t.startsWith('!zone:'))
      const zName = E.zoneNames.get(String(lot.zone)) ?? ''
      const inZone = (t: string) => t.startsWith('zone:') ? t.slice(5) === String(lot.zone)
        : t.startsWith('zonegroup:') ? t.slice(10).split('|').some(g => new RegExp(`^${g}\\d{1,2}[A-Z]?$`).test(String(lot.zone)))
        : new RegExp(t.slice(10), 'i').test(zName)
      const zoneR = zIn.length || zOut.length ? (lot.zone == null ? null
        : (!zIn.length || zIn.some(inZone)) && !zOut.some(t => t.slice(6) === String(lot.zone))) : undefined
      const areaT = b.scope_terms.find(t => t.startsWith('area>='))
      const areaR = areaT ? (lot.area_m2 == null ? null : Number(lot.area_m2) >= Number(areaT.slice(6))) : undefined
      const mapT = b.scope_terms.filter(t => t.startsWith('map:'))
      const shareOf = (t: string) => { const [m, l] = t.slice(4).split('|'); return Math.max(0, ...(Array.isArray(lot.mapped) ? lot.mapped : []).filter((x: any) => ownMap(c, x) && String(x.map).toLowerCase().replace(/ map$/, '') === m && nl(x.label) === nl(l)).map((x: any) => Number(x.share))) }
      // a label the clause names that no layer draws (unheld:): outside the drawn ones is not outside - unknown
      const unheld = b.scope_terms.filter(t => t.startsWith('unheld:'))
      const mapR = mapT.length ? (!Array.isArray(lot.mapped) ? null : mapT.some(t => shareOf(t) >= 0.9) ? true : mapT.every(t => shareOf(t) <= 0.05) ? (unheld.length ? null : false) : null) : undefined
      // outside a map area ("that is not on land identified as "Area A""): wholly outside every label, or (almost) wholly in one
      const notT = b.scope_terms.filter(t => t.startsWith('notmap:')), notShare = (t: string) => shareOf(`map:${t.slice(7)}`)
      const notR = notT.length ? (!Array.isArray(lot.mapped) ? null : notT.every(t => notShare(t) <= 0.05) ? true : notT.some(t => notShare(t) >= 0.9) ? false : null) : undefined
      const layerRs = layerT.map(t => ({ t, f: lot.terms?.[t] as { holds: boolean | null; why: string } | undefined }))
      const both = /(both|all) must hold/.test(b.note ?? '')
      const layerR = !layerT.length ? undefined
        : both ? (layerRs.some(x => x.f?.holds === false) ? false : layerRs.every(x => x.f?.holds === true) ? true : null)
        : (layerRs.some(x => x.f?.holds === true) ? true : layerRs.every(x => x.f?.holds === false) ? false : null)
      const parts = [lgaR, layerR, zoneR, areaR, mapR, notR, useR, factR].filter(x => x !== undefined) as (boolean | null)[]
      const result = both ? (parts.includes(false) ? false : parts.every(x => x === true) ? true : null) : (parts.includes(true) ? true : parts.every(x => x === false) ? false : null)
      const how = [lgaT.length ? `council ${lot.lga ?? 'not recorded'}` : null,
        zoneR !== undefined ? `zone ${lot.zone ?? 'not recorded'}${zName ? ` (${zName})` : ''}` : null,
        areaT ? `lot area ${lot.area_m2 ?? '?'} m2 against ${areaT.slice(6)} m2 (${b.note ?? 'site area'})` : null,
        ...mapT.map(t => `${t.slice(4).replace('|', ': ')} - ${Array.isArray(lot.mapped) ? `${Math.round(shareOf(t) * 100)}% of the lot inside` : 'map facts not computed'}`),
        ...unheld.map(t => `${t.slice(7).replace('|', ': ')} - no polygon held`),
        ...notT.map(t => `outside ${t.slice(7).replace('|', ': ')} - ${Array.isArray(lot.mapped) ? `${Math.round(notShare(t) * 100)}% of the lot inside` : 'map facts not computed'}`),
        ...useT.map(t => `the use asked about (${ask.use}) against ${t.slice(4).replace(/\|/g, ' / ')}`),
        ...factT.map(t => `${t.slice(5)}: a fact of the proposed development, not given`),
        ...layerRs.map(x => `${x.t}: ${x.f ? `${x.f.holds == null ? 'unknown' : x.f.holds ? 'yes' : 'no'} (${x.f.why})` : 'not computed for this lot'}`)].filter(Boolean).join('; ')
      return { text, result, how, could: result !== null }
    }
    if (b.status === 'no_data') return b.assume_absent ? { text, result: false, how: `assumed absent - no dataset held (${b.note ?? b.scope_terms.join(', ')})`, could: true }
      : { text, result: null, how: `no dataset held for ${b.scope_terms.join(', ')}${b.note ? ` (${b.note})` : ''}`, could: false }
    return { text, result: null, how: b.status === 'no_polygon' ? 'no polygon for this map label' : b.status === 'no_match' ? 'no registered layer matches these words' : b.note ?? b.status, could: false }
  }
  const scope = (c: C, why: string[], notChecked: string[], subs: Result[], isFrame: boolean, checks: Check[] = []): boolean | null => {
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
      else if (t.startsWith('lots:') || t.startsWith('mapped:')) continue        // the land described: tested together below
      // a figure the consent authority may allow if it is satisfied: never assumed either way - the answer splits on it
      else if (t.startsWith('discretion:')) and(null, `the consent authority is satisfied (${t.slice(11, 120)})`)
      else if (t === 'detached') and(ask.detached ?? null, 'detached')
      else {
        const ch = viaBinding(c, t, 'term'); checks.push(ch)
        if (!ch.could) notChecked.push(`${t} - ${ch.how}`)
        and(ch.result, t)
      }
    }
    // the land a claim describes - by its lots and / or by a mapped area - is one place said two ways: in it if either
    // description says so. A lot only partly covered ("Part of Lot 7020", or a map polygon over part of the lot) is
    // "maybe" unless a map says the lot is (almost) wholly inside.
    const where = c.terms.filter(t => t.startsWith('lots:') || t.startsWith('mapped:'))
    if (where.length) {
      const results: (boolean | null)[] = []; const said: string[] = []
      for (const t of where) {
        if (t.startsWith('lots:')) {
          const ids = t.slice(5).split('|'), me = String(lot.lot ?? '').toUpperCase()
          const whole = ids.filter(i => !i.startsWith('~')).map(i => i.toUpperCase()), part = ids.filter(i => i.startsWith('~')).map(i => i.slice(1).toUpperCase())
          const sp = whole.filter(i => i.startsWith('SP')).some(i => me.endsWith(`//${i}`))
          const r = whole.includes(me) || sp ? true : part.includes(me) ? null : false
          results.push(r); said.push(`lot ${lot.lot} ${r === true ? 'is' : r === null ? 'is partly' : 'is not'} in the lots described`)
        } else {
          const m = t.slice(7).match(/^(.+) on the (.+?)(?: Map)?$/); if (!m) continue
          // "Area 21A, Area 21B and Area 21C": each label, and the whole in case the map draws a label with "and" in it
          const raw = m[1]!.split(/\s+or\s+|,\s*/).map(x => x.trim().toLowerCase()), map = m[2]!.toLowerCase()
          const labels = [...new Set([...raw, ...raw.flatMap(l => l.split(/\s+and\s+/).map(x => x.trim()))])]
          // fail closed: no polygon for the map label (decided at build), or the lot's map facts not computed -> unknown
          const b = E.bindings.get(c.id)?.find(x => x.part === 'mapped' && x.text === t.slice(7))
          if (b && b.status !== 'bound') { notChecked.push(`${t.slice(7)} - no polygon for this map label`); checks.push({ text: t.slice(7), result: null, how: 'no polygon for this map label', could: false }); results.push(null); said.push(`${t.slice(7)}: no polygon - not checked`); continue }
          if (!Array.isArray(lot.mapped)) { notChecked.push(`${t.slice(7)} - map facts not computed for this lot`); checks.push({ text: t.slice(7), result: null, how: 'map facts not computed for this lot', could: false }); results.push(null); said.push(`${t.slice(7)}: not computed`); continue }
          // the labels as the map draws them (the build matched "Area B" in the words to "B" on the layer), else the words'
          const drawn = (b?.scope_terms ?? []).filter(x => x.startsWith('map:')).map(x => x.slice(4).split('|')[1]!)
          const want = (drawn.length ? drawn : labels).map(nl)
          const hit = lot.mapped.filter((x: any) => ownMap(c, x) && String(x.map).toLowerCase() === map && want.includes(nl(x.label)))
          const share = Math.max(0, ...hit.map((x: any) => Number(x.share)))
          // a label the clause names that no layer draws: not inside the drawn ones is not "not inside" (fail closed)
          const unheld = (b?.scope_terms ?? []).filter(x => x.startsWith('unheld:')).map(x => x.slice(7).split('|')[1])
          const r = share >= 0.9 ? true : share > 0.05 ? null : unheld.length ? null : false
          checks.push({ text: t.slice(7), result: r, how: `map polygon (rag.map_polygon): ${share > 0 ? `${Math.round(share * 100)}% of the lot inside` : 'lot not inside'}${unheld.length ? `; no polygon held for ${unheld.join(', ')}` : ''}`, could: r !== null || !unheld.length })
          results.push(r); said.push(`${t.slice(7)}: ${share > 0 ? `${Math.round(share * 100)}% of the lot inside` : 'not inside'}`)
        }
      }
      and(results.includes(true) ? true : results.every(r => r === false) ? false : null, said.join('; '))
    }
    for (const ex of c.excludes) {
      if (ex.startsWith('zone:')) { const name = ex.slice(5); and(!new RegExp(name.replace(/ zone$/, ''), 'i').test(E.zoneNames.get(String(lot.zone)) ?? ''), `not in a ${name}`); continue }
      // an exclusion: the lot must be outside it - unknown when its layer could not answer (fail closed, said why)
      const ch = viaBinding(c, ex, 'exclude'); checks.push({ ...ch, text: `excluded if: ${ex}` })
      if (!ch.could) notChecked.push(`${ex} - ${ch.how}`)
      and(ch.result == null ? null : !ch.result, `not ${ex}`)
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
      // a frame whose condition is a list, bound item by item at build: each item tested, combined as the list says
      const fb = E.bindings.get(f.id) ?? [], itemsRow = fb.find(b => b.part === 'frame' && b.status === 'items')
      if (itemsRow) {
        const rs = fb.filter(b => b.part === 'item').map(b => {
          const ch: Check = b.status === 'proposal_fact' || b.status === 'discretion' ? { text: b.text, result: null, how: b.note ?? b.status, could: false } : viaBinding(f, b.text, 'item')
          checks.push({ ...ch, text: `${E.label(f.provision_id)}: ${b.text}` })
          if (!ch.could) notChecked.push(`${E.label(f.provision_id)}: ${b.text} - ${ch.how}`)
          return ch.result
        })
        const comb = itemsRow.note ?? 'unknown'
        const r = comb === 'any' ? (rs.includes(true) ? true : rs.every(x => x === false) ? false : null)
          : comb === 'all' ? (rs.includes(false) ? false : rs.every(x => x === true) ? true : null)
          : rs.every(x => x === true) ? true : rs.every(x => x === false) ? false : null
        and(r, `frame ${E.label(f.provision_id)} [${comb === 'any' ? 'any' : comb === 'all' ? 'all' : 'how they combine is not read; '} of ${rs.length} listed conditions]`); continue
      }
      // a frame whose scope the build could not read: the claim's reach is unknown, not "everywhere"
      if (fb.some(b => b.part === 'frame' && b.status === 'unscoped')) {
        notChecked.push(`where ${E.label(f.provision_id)} applies - its scope was not read`)
        checks.push({ text: `frame ${E.label(f.provision_id)}`, result: null, how: 'its scope was not read when the graph was built', could: false })
        and(null, `frame ${E.label(f.provision_id)} [scope not read]`); continue
      }
      // a frame about what the development is ("a fire alarm system that ..."): a fact of the proposal, not given
      const pf = fb.find(b => b.part === 'frame' && b.status === 'proposal_fact')
      if (pf) {
        notChecked.push(`${E.label(f.provision_id)}: ${pf.text} - a fact of the proposed development, not given with the question`)
        checks.push({ text: `frame ${E.label(f.provision_id)}`, result: null, how: `a fact of the proposed development: ${pf.text.slice(0, 120)}`, could: false })
        and(null, `frame ${E.label(f.provision_id)} [the development is: ${pf.text.slice(0, 80)}]`); continue
      }
      const w: string[] = []; const r = scope(f, w, notChecked, subs, true, checks)
      and(r, `frame ${E.label(f.provision_id)} [${w.join('; ')}]`)
    }
    return h
  }
  const test = (c: C): Tested => { const why: string[] = [], notChecked: string[] = [], subs: Result[] = [], checks: Check[] = []; const holds = scope(c, why, notChecked, subs, false, checks); return { claim: c, holds, why, notChecked, subs, checks } }
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
    comparator: (t.claim.comparator as any) ?? null, holds: t.holds, condition: t.holds == null ? t.why.filter(w => /unknown/.test(w)).join('; ') : null, label: E.label(t.claim.provision_id),
    bar: t.claim.kind === 'prohibit' && t.claim.reader === 'consent bar' })
  const notChecked = new Set<string>()
  /** the conditions tested for the rules that reach the lot, and every one that could not be tested - each once */
  // the checks behind the answer: every check of a claim that applies, every check no data could settle, and - for a
  // claim that does not apply - the check that ruled it out (an exclusion that holds, a condition that fails)
  const decisive = (ch: Check) => ch.could && (ch.text.startsWith('excluded if:') ? ch.result === true : ch.result === false)
  const aggChecks = (ts: Tested[]) => { const seen = new Map<string, Check>()
    for (const t of ts) for (const ch of t.checks) if (t.holds !== false || !ch.could || decisive(ch)) seen.set(`${ch.text}|${ch.how}`, ch)
    return [...seen.values()] }

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
    return { ask, answer: ruling.answer, verdict, ruling, tested, limits, notChecked: [...notChecked], note, checks: aggChecks(tested) }
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
      notChecked: min.notChecked, checks: min.checks }
  }

  // a figure: the standards on this topic that reach this lot and use
  const topic = ask.topic!
  // a subdivision's minimum is a standard on the resulting lots; a development's lot size is a standard on the site.
  // Each question reads only its own kind.
  const ofProposal = (c: C) => ask.proposal === 'subdivision' && topic === 'lot_size' ? c.terms.includes('proposal:subdivision') : !c.terms.includes('proposal:subdivision')
  const direct = E.claims.filter(c => c.kind === 'standard' && c.topic === topic && (aboutUse(c) || (!c.uses.length && !framesFor(c).some(f => f.uses.length))) && ofProposal(c))
  // a map figure, or the map figure plus what a clause lets it exceed by ("by up to 6 metres")
  const valueOf = (c: C) => { const base = c.value_source?.startsWith('map:') ? mapValue(c.value_source) : c.value
    return c.band?.add != null ? (base != null ? Number(base) + Number(c.band.add) : null) : base }
  const tested = direct.map(test).map(t => ({ ...t, value: valueOf(t.claim) }))
  tested.forEach(t => t.notChecked.forEach(n => notChecked.add(n)))
  const live = tested.filter(t => t.holds !== false && t.value != null)
  // floor area with no floor-area standard: the floor space ratio times the site area
  if (topic === 'floor_area' && !live.length && depth < 3) {
    const fsr = evaluate(E, { ...ask, topic: 'fsr' }, lot, depth + 1)
    const v = fsr.answer?.value != null && lot.area_m2 != null ? Math.round(Number(fsr.answer.value) * Number(lot.area_m2) * 10) / 10 : null
    return { ask, answer: v != null ? { effect: 'value', value: v, unit: 'm2', expr: `${fsr.answer!.value}:1 x ${lot.area_m2} m2` } : null, verdict: v != null ? 'decided' : fsr.verdict,
      ruling: fsr.ruling, tested: fsr.tested, limits: [{ label: 'derived', text: 'floor space ratio x site area', status: 'applies', detail: v != null ? `${v} m2` : 'unknown', subs: [fsr] }], notChecked: fsr.notChecked, checks: fsr.checks }
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
  return { ask, answer, verdict: ruling.verdict, ruling, tested, limits: [], notChecked: [...notChecked], checks: aggChecks(tested) }
}

/**
 * The whole result as data for the page: every claim tested (applies yes / no / unknown, and why), the precedence steps,
 * the case split, the limits and the sub-questions behind them - each step carrying the provision it rests on, so the
 * page can show the clause's words and link to it.
 */
export interface Explained {
  ask: Ask; verdict: string; answer: Result['answer']; note?: string; notChecked: string[]
  checks: Check[]
  /** the instruments the answer read, and the date their text is as at */
  asAt: { instrument: string; date: string | null }[]
  claims: { provision_id: string; label: string; kind: string; uses: string[]; zones: string[]; value: number | null; unit: string | null; topic: string | null; non_discretionary: boolean; holds: boolean | null; why: string[]; won: boolean; subs: Explained[] }[]
  steps: { rule: string; winner: string; winner_id: string | null; loser: string; loser_id: string | null; why: string; relation: string; relation_id: string | null; basis: string; status: string }[]
  branches: { if: string; answer: string | null; steps: Explained['steps'] }[]
  limits: { label: string; provision_id: string | null; detail: string; status: string; text: string; subs: Explained[] }[]
}
/** the instruments whose claims this answer tested (and its sub-questions), with the date their text is as at */
function asAtOf(E: Engine, r: Result): Explained['asAt'] {
  const docs = new Set<string>()
  const walk = (x: Result) => { for (const t of x.tested) { const d = E.provs.get(t.claim.provision_id)?.document_id; if (d) docs.add(d); t.subs.forEach(walk) } x.limits.forEach(l => l.subs.forEach(walk)) }
  walk(r)
  return [...docs].map(d => ({ instrument: E.shortNames.get(d) ?? d, date: E.asAt.get(d) ?? null })).sort((a, b) => a.instrument.localeCompare(b.instrument))
}

export function explain(E: Engine, r: Result, depth = 0): Explained {
  const idOf = (label: string) => r.tested.find(t => E.label(t.claim.provision_id) === label || t.claim.id === label)?.claim.provision_id
    ?? [...E.provs.values()].find(p => E.label(p.id) === label)?.id ?? null
  const steps = (tr: NonNullable<Result['ruling']>['trace']) => tr.map(s => ({ rule: s.rule, winner: s.winner, winner_id: s.winner_provision ?? idOf(s.winner), loser: s.loser, loser_id: s.loser_provision ?? idOf(s.loser),
    why: s.why, relation: s.by, relation_id: s.by_provision ?? null, basis: s.basis, status: s.status }))
  const won = new Set(r.ruling?.answer?.claims ?? [])
  const fig = (a: any) => a == null ? null : a.effect === 'value' ? `${a.value ?? ''}${a.unit ? ` ${a.unit}` : ''}`.trim() || null : a.effect
  return {
    ask: r.ask, verdict: r.verdict, answer: r.answer, note: r.note, notChecked: [...new Set(r.notChecked)], checks: r.checks ?? [], asAt: asAtOf(E, r),
    claims: r.tested.map(t => ({ provision_id: t.claim.provision_id, label: E.label(t.claim.provision_id), kind: t.claim.kind, uses: t.claim.uses, zones: t.claim.zones,
      value: (t as any).value ?? t.claim.value, unit: t.claim.unit, topic: t.claim.topic, non_discretionary: t.claim.non_discretionary, holds: t.holds, why: t.why, won: won.has(t.claim.id),
      subs: depth < 3 ? t.subs.map(s => explain(E, s, depth + 1)) : [] })),
    steps: steps(r.ruling?.trace ?? []),
    branches: (r.ruling?.branches ?? []).map(b => ({ if: b.if, answer: fig(b.answer), steps: steps(b.trace) })),
    limits: r.limits.map(l => ({ label: l.label, provision_id: idOf(l.label), detail: l.detail, status: l.status, text: l.text.startsWith('resolved:') || l.text.startsWith('group:') ? '' : l.text,
      subs: depth < 3 ? l.subs.map(s => explain(E, s, depth + 1)) : [] })),
  }
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
  // a precedence step that rests on a reading the text does not state (more_specific_than, proposed) says so
  const interp = (s: { basis: string; status: string }) => s.basis === 'interpretive' && s.status !== 'verified'
  const stepLine = (s: NonNullable<Result['ruling']>['trace'][number]) => `- ${s.winner} prevails over ${s.loser}: ${s.why}${interp(s) ? ' [an interpretive reading, not stated in the text - not yet verified]' : ''}.`
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
    for (const s of r.ruling?.trace ?? []) L.push(stepLine(s))
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
    for (const s of r.ruling?.trace ?? []) L.push(stepLine(s))
    // the answer split on a fact nobody gave: each case with its figure and the rule that decides it
    const br = r.ruling?.branches ?? (r.ask.kind === 'subdivision' ? r.limits[0]?.subs[0]?.ruling?.branches : undefined) ?? []
    for (const b of br) L.push(`- if ${b.if.replace(/frame [^[]*\[|\]|: unknown/g, '').trim()}: ${b.answer?.value != null ? `${b.answer.value}${r.ask.topic === 'fsr' ? ':1' : ` ${unitOf(b.answer.unit) || (r.ask.topic === 'height' ? 'm' : '')}`}` : 'no limit'}${b.trace.length ? ` (${b.trace.map(s => `${s.winner} over ${s.loser}`).join('; ')})` : ''}`)
    for (const t of r.tested.filter(t => t.holds !== false)) L.push(`- ${E.label(t.claim.provision_id)}: ${(t as any).value ?? ''} ${t.claim.unit ?? ''}${t.claim.non_discretionary ? ' (non-discretionary)' : ''}${t.holds == null ? ` - only if ${t.why.filter(w => /unknown/.test(w)).map(w => w.replace(/: unknown$/, '')).join('; ').slice(0, 140)}` : ''}`)
  }
  if (r.notChecked.length) L.push(`Not checked (no data held): ${[...new Set(r.notChecked)].slice(0, 8).join('; ')}${r.notChecked.length > 8 ? '; ...' : ''}.`)
  const at = asAtOf(E, r)
  if (at.length) L.push(`Law as at: ${at.map(a => `${a.instrument} ${a.date ?? '(date not recorded)'}`).join('; ')} - amendments after that date are not read.`)
  return L.join('\n')
}
