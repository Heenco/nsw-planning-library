/**
 * GET /api/norms/subdivision - can this lot be subdivided, and which kind? (docs/norms-trial.md)
 *
 *   ?cadid=102325171
 *   &purpose=dwelling house | dual occupancy | multi dwelling housing (terraces)     (what the new lots are for; optional)
 *   &lots=2                                                                          (Torrens: how many lots; default 2)
 *   &site=boarding house=no;secondary dwelling@housing-sepp-2021:ch.3-pt.1=no         (what the asker knows)
 *   &erects=dual occupancy                                                           (the same DA also erects it)
 *   &separates=principal dwelling|secondary dwelling
 *
 * For each kind - Torrens, strata, community title - one evaluation of the subdivision norms (Housing SEPP + the lot's
 * LEP, norms/subdivision/) through shared/norms/engine.ts: yes / no / maybe, the clause it rests on, what it depends on
 * (grouped by who can answer), and the standards with the lot's own arithmetic. Then the questions only the asker can
 * answer (each with the key the `site` / `purpose` / `erects` parameter takes), and the plan's subdivision clauses not
 * yet encoded - so a yes never hides a clause nobody read.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate } from '#shared/norms/engine'
import { lotFacts, refHitsFor } from '#shared/norms/facts'
import { graphNorms } from '#shared/norms/from-graph'
import type { Cond, Norm, Question } from '#shared/norms/schema'
import { landUseKey } from '#shared/land-use-key'
import { nswQuery } from '../../utils/nsw-kg/pool'

const KINDS = [
  { key: 'torrens', label: 'Torrens title' },
  { key: 'strata', label: 'Strata' },
  { key: 'community', label: 'Community title' },
] as const

const leaves = (c: Cond): any[] => 'all' in c ? c.all.flatMap(leaves) : 'any' in c ? c.any.flatMap(leaves) : 'not' in c ? leaves(c.not) : [c]

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const q = getQuery(event)
  const cadid = String(q.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const purpose = q.purpose ? String(q.purpose) : undefined
  const lots = q.lots ? Math.max(2, Number(q.lots)) : 2
  const site: Record<string, boolean> = {}
  for (const part of String(q.site ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const i = part.lastIndexOf('=')
    if (i > 0) site[part.slice(0, i).trim()] = /^(yes|true|1)$/i.test(part.slice(i + 1).trim())
  }

  // the norms: the Housing SEPP's subdivision clauses + the lot's own LEP - its Standard Instrument 2.6 / 4.1 (read
  // from its words by scripts/norms/build-subdivision.ts) and everything else from the graph's own rules for that plan
  const q2 = (sql: string, p?: unknown[]) => nswQuery<any>(sql, p as any[])
  const dir = join(process.cwd(), 'norms', 'subdivision')
  const load = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
  const housing = load(join(dir, 'housing-sepp-2021.json'))
  const leps = readdirSync(join(dir, 'lep')).filter(f => f.endsWith('.json')).map(f => load(join(dir, 'lep', f)))
  const sepTerms = (housing.norms as Norm[]).flatMap(n => leaves(n.when)).filter(l => l.fact === 'lot.in').map(l => String(l.value))
  let lot
  try { lot = await lotFacts(q2, cadid, landUseKey, [...new Set(sepTerms)]) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }
  const lep = leps.find(l => l.instrument === lot.epi) ?? null
  const lepDoc = lot.epi ? (await q2(`SELECT id, instrument_slug FROM nsw.document WHERE title = $1 LIMIT 1`, [lot.epi])).rows[0] : null
  const fromGraph = lepDoc ? await graphNorms(q2, lepDoc.id, lot.epi!, lepDoc.instrument_slug, {
    clauseFilter: `heading ~* 'subdivi|lot size' OR local_id IN ('sec.2.6', 'sec.4.1')`, covered: lep?.covered ?? [] }) : { norms: [], gaps: [], refIds: [] }
  lot.refHits = await refHitsFor(q2, cadid, fromGraph.refIds)
  const files = [housing, ...(lep ? [lep] : [])]
  const norms: Norm[] = [...files.flatMap(f => f.norms.map((n: Norm) => ({ ...n, instrument: f.instrument }))), ...fromGraph.norms]
  const sectionOf = new Map(norms.map(n => [n.id, n.section]))
  const sources = Object.fromEntries((await nswQuery<any>(`SELECT DISTINCT ON (title) title, source_url FROM nsw.document WHERE title = ANY($1) AND source_url IS NOT NULL ORDER BY title, ingested_at DESC`,
    [[...files.map(f => f.instrument), lot.epi].filter(Boolean)])).rows.map((d: any) => [d.title, d.source_url]))
  const link = (instrument: string, section: string | undefined) => sources[instrument] && section ? `${sources[instrument]}#${section}` : null

  const questionFor = (key: string, s: Record<string, boolean>, erects?: string, separates?: string): Question => ({ cadid, site: s,
    proposal: { kind: 'subdivision', subdivision_type: key as any, use: purpose, resulting_lots: key === 'torrens' ? lots : undefined,
                also_erects: erects, separates } })
  const erects0 = q.erects ? String(q.erects) : undefined
  const separates0 = q.separates ? String(q.separates) : undefined
  const kinds = KINDS.map(({ key, label }) => {
    const o = evaluate(norms, questionFor(key, site, erects0, separates0), lot!, landUseKey)
    const answer = o.outcome === 'permissible' ? 'yes' : o.outcome === 'prohibited' || o.outcome === 'no_permission' ? 'no' : 'maybe'
    const ctl = o.controlling.map(id => { const r = o.norms.find(x => x.id === id)!; return { id, instrument: r.instrument, clause: r.clause, url: link(r.instrument, sectionOf.get(id)) } })
    return { key, label, answer, outcome: o.outcome, pathway: o.pathway, controlling: ctl,
      dependsOn: o.dependsOn.map(d => ({ ...d, url: link(norms.find(n => n.clause === d.clause)?.instrument ?? '', norms.find(n => n.clause === d.clause)?.section) })),
      standards: o.standards.map(s => ({ ...s, instrument: o.norms.find(r => r.id === s.id)!.instrument, url: link(o.norms.find(r => r.id === s.id)!.instrument, sectionOf.get(s.id)) })),
      displaced: o.norms.filter(r => (r.defeatedBy ?? []).length && 'prohibit' in r.effect).map(r => ({ clause: r.clause, by: r.defeatedBy })) }
  })

  // the questions only the asker can answer, across the three kinds - each with the key its parameter takes
  const asks = new Map<string, { key: string; param: 'site' | 'purpose' | 'erects' | 'separates'; label: string; question: string; clauses: string[]; bars: boolean }>()
  const art = (u: unknown) => /(housing|accommodation|development)$/i.test(String(u)) ? String(u) : `${/^[aeiou]/i.test(String(u)) ? 'an' : 'a'} ${u}`
  for (const n of norms) for (const l of leaves(n.when)) {
    let key: string | null = null, param: any = 'site', label = ''
    // each with a question in plain words; the part of the SEPP a building was approved under is named, not coded
    const part = (u: string) => u.replace('housing-sepp-2021:ch.3-pt.1', 'the Housing SEPP (secondary dwellings, Ch 3 Pt 1)')
      .replace('housing-sepp-2021:ch.3-pt.5-div.8', 'the Housing SEPP (seniors housing by a relevant authority, Ch 3 Pt 5 Div 8)')
      .replace('housing-sepp-2021:ch.3-pt.5', 'the Housing SEPP (seniors housing, Ch 3 Pt 5)').replace('housing-sepp-2021:ch.3-pt.4', 'the Housing SEPP (build-to-rent, Ch 3 Pt 4)').replace('housing-sepp-2021:ch.3-pt.7', 'the Housing SEPP (serviced apartment conversion, Ch 3 Pt 7)')
      .replace('housing-sepp-2021:ch.2-pt.2-div.1', 'the Housing SEPP (in-fill affordable housing, Ch 2 Pt 2 Div 1)').replace('housing-sepp-2021:ch.7', 'the Housing SEPP Pattern Book (Ch 7)')
    let question = ''
    if (l.fact === 'site.has') { key = l.under ? `${l.value}@${l.under}` : String(l.value); label = l.under ? `${art(l.value)} built under ${part(l.under)}` : art(l.value)
      question = `Is there ${label} on the lot?` }
    else if (l.fact === 'site.consent_on_or_after' || l.fact === 'site.consent_before') { key = `${l.fact}:${l.value}:${l.text}`; label = `an existing ${l.value} approved ${l.fact === 'site.consent_before' ? 'before' : 'on or after'} ${l.text}`
      question = `Was the ${l.value} on the lot approved ${l.fact === 'site.consent_before' ? 'before' : 'on or after'} ${new Date(String(l.text)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}?` }
    else if (l.fact === 'site.approved_or_pending') { key = `${l.fact}:${l.value}`; label = `a consent in force, or an application pending, for ${l.value}`
      question = `Is there a consent in force, or an application not yet decided, for ${l.value} on the lot?` }
    else if (l.fact === 'proposal.also_erects') { key = String(l.value); param = 'erects'; label = `the same application also erects the ${l.value}`
      question = `Will the same application also build the ${l.value}?` }
    else if (l.fact === 'proposal.separates') { key = String(l.value); param = 'separates'; label = 'the subdivision puts the principal and the secondary dwelling on separate lots'
      question = 'Will the subdivision put the house and the secondary dwelling on separate lots?' }
    if (!key) continue
    const k = `${param}|${key}`
    const a = asks.get(k) ?? { key, param, label, question, clauses: [], bars: false }
    if (!a.clauses.includes(n.clause)) a.clauses.push(n.clause)
    // a bar: the question feeds a prohibition (s 27 "must not be granted for the subdivision of a boarding house") - what
    // "none of these is on the lot" answers; a dwelling house on the lot (4.1B) is not one
    if ('prohibit' in n.then) a.bars = true
    asks.set(k, a)
  }
  // a question is worth asking only if its answer changes something: flip it both ways and compare every kind's answer
  // and standards with the question left open; rank by how many of those it changes
  // the answer class and the standards - not which clause controls (a second grant that changes nothing is not worth asking)
  const sig = (s: Record<string, boolean>, erects?: string, separates?: string) => KINDS.map(({ key }) => {
    const o = evaluate(norms, questionFor(key, s, erects, separates), lot!, landUseKey)
    const cls = o.outcome === 'permissible' ? 'yes' : o.outcome === 'conditional' ? 'maybe' : 'no'
    // a matter for consideration (s 78) never decides anything - it does not make a question worth asking
    return `${cls}|${o.standards.filter(x => !/matter for consideration/.test(x.standard)).map(x => `${x.id}:${x.holds}`).join(',')}`
  })
  const open = [...asks.values()].filter(a => a.param === 'site' && !(a.key in site))
  // two baselines: as asked, and "clean" - every other open site question answered no (what "none of these" gives); a
  // question that only matters together with another (2.6(2): a secondary dwelling AND split off) shows on the second
  const clean = { ...site, ...Object.fromEntries(open.map(a => [a.key, false])) }
  const base = sig(site, erects0, separates0)
  const baseClean = sig(clean, erects0, separates0)
  const ranked = [...asks.values()].filter(a => {
    if (a.param === 'site' && a.key in site) return false
    if (a.param === 'erects' && erects0) return false
    if (a.param === 'separates' && separates0) return false
    return true
  }).map((a) => {
    const flip = (from: Record<string, boolean>, v: boolean) => a.param === 'site' ? sig({ ...from, [a.key]: v }, erects0, separates0)
      : a.param === 'erects' ? sig(from, v ? a.key : '-', separates0) : sig(from, erects0, v ? a.key : '-')
    const diff = (b: string[], x: string[]) => b.reduce((n, s, i) => n + (x[i] !== s ? 1 : 0), 0)
    const changes = diff(base, flip(site, true)) + diff(base, flip(site, false))
    const changesClean = diff(baseClean, flip(clean, true)) + diff(baseClean, flip(clean, false))
    return { ...a, changes: changes + changesClean, changesClean }
  }).filter(a => a.changes > 0).sort((x, y) => y.changesClean - x.changesClean || y.changes - x.changes)
  const derived = Object.keys(lot.site).filter(k => lot!.site[k] !== undefined)
  // what is not read: the Housing SEPP's own list, and every LEP subdivision clause whose graph rules carry no effect
  const uncheckedAll = [
    ...(housing.unchecked ?? []).map((u: any) => ({ ...u, instrument: housing.instrument, url: link(housing.instrument, u.section) })),
    ...fromGraph.gaps.map(g => ({ clause: g.parts.length ? g.parts.join(', ') : g.clause, section: g.section, instrument: lot!.epi!, url: link(lot!.epi!, g.section), zones: g.zones,
      why: `${g.heading ?? ''}${g.rules ? ` - in the graph (${g.rules} rule${g.rules === 1 ? '' : 's'}), no effect extracted` : ' - in the graph as text, no rule extracted'}` })),
  ]
  // a clause that says which zones it applies to, and not this lot's zone, cannot change this lot's answer
  const reaches = (u: any) => !u.zones || !lot!.zone || u.zones.includes(lot!.zone)
  const unchecked = uncheckedAll.filter(reaches)
  const notHere = uncheckedAll.filter(u => !reaches(u))

  // how many lots the area allows under each numeric minimum in play (Torrens)
  const t = kinds.find(k => k.key === 'torrens')!
  const minima = t.standards.filter(s => /resulting lot size/.test(s.standard)).map(s => {
    const n = Number(s.standard.match(/≥ (\d+(?:\.\d+)?)/)?.[1] ?? NaN)
    return Number.isFinite(n) && lot!.areaM2 ? { clause: s.clause, min: n, maxLots: Math.floor(lot!.areaM2 / n), applies: s.holds !== null || !/applies only if/.test(s.test) } : null
  }).filter(Boolean)

  return {
    ms: Date.now() - started,
    lot: { cadid, lotId: lot.lotId, zone: lot.zone, epi: lot.epi, lga: lot.lga, areaM2: lot.areaM2, frontageM: lot.frontageM,
           lotSizeMinM2: lot.lotSizeMinM2, onLotSizeMap: lot.onLotSizeMap, strata: lot.site[landUseKey('strata scheme')] ?? false },
    lepCovered: Boolean(lep), purpose: purpose ?? null, lots,
    // what the asker has answered, with the question - shown with the answer chosen, never dropped from view
    kinds, asks: ranked, derived, unchecked, notHere, minima,
    answered: [...asks.values()].map((a) => {
      const v = a.param === 'site' ? site[a.key] : a.param === 'erects' ? (erects0 == null ? undefined : erects0 === a.key)
        : a.param === 'separates' ? (separates0 == null ? undefined : separates0 === a.key) : undefined
      return v === undefined ? null : { ...a, value: v }
    }).filter(Boolean),
    sources,
  }
})
