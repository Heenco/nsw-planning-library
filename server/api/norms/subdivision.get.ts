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
 * For each kind - Torrens, strata, community title - one evaluation of the subdivision norms from the graph: the clause
 * reader's norms in nsw.norm (scripts/norms/read-subdivision.ts) for the lot's LEP and for every SEPP whose frames the
 * graph holds, and - for an LEP clause the reader did not read - the graph's own rules (shared/norms/from-graph.ts).
 * Through shared/norms/engine.ts: yes / no / maybe, the clause it rests on, what it depends on
 * (grouped by who can answer), and the standards with the lot's own arithmetic. Then the questions only the asker can
 * answer (each with the key the `site` / `purpose` / `erects` parameter takes), and the plan's subdivision clauses not
 * yet encoded - so a yes never hides a clause nobody read.
 */
import { evaluate } from '#shared/norms/engine'
import { lotFacts, lotTerm, refHitsFor } from '#shared/norms/facts'
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

  // the norms, all from the graph
  const q2 = (sql: string, p?: unknown[]) => nswQuery<any>(sql, p as any[])
  let lot
  try { lot = await lotFacts(q2, cadid, landUseKey) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }
  // the lot's own LEP, and every SEPP whose frames (where each part applies) the graph holds - a SEPP without them would
  // reach every lot in the State
  const docs = (await q2(`SELECT d.id, d.title, d.instrument_slug, d.doc_type FROM nsw.document d
     WHERE d.title = $1 OR (d.doc_type = 'sepp' AND EXISTS (SELECT 1 FROM nsw.rule f WHERE f.document_id = d.id AND f.kind = 'frame'))`, [lot.epi ?? ''])).rows
  const read = (await q2(`SELECT n.id, n.section, n.clause, n."when", n."then", n.despite, n.subject_to, n.author, n.review, d.title AS instrument
      FROM nsw.norm n JOIN nsw.document d ON d.id = n.document_id
     WHERE n.family = 'subdivision' AND n.valid_to IS NULL AND n.document_id = ANY($1)`, [docs.map(d => d.id)])).rows
    .map((r: any) => ({ id: r.id, instrument: r.instrument, clause: r.clause, section: r.section, text: '', when: r.when, then: r.then,
                        despite: r.despite ?? [], subjectTo: r.subject_to ?? [], author: r.author, review: r.review ?? undefined }) as Norm)
  // an LEP clause the reader did not read: the graph's own rules for it
  const lepDoc = docs.find(d => d.title === lot!.epi)
  const readClauses = [...new Set(read.filter(n => n.instrument === lot!.epi).map(n => n.section.replace(/-.*$/, '')))]
  const fromGraph = lepDoc ? await graphNorms(q2, lepDoc.id, lepDoc.title, lepDoc.instrument_slug, {
    clauseFilter: `heading ~* 'subdivi|lot size' OR local_id IN ('sec.2.6', 'sec.4.1')`, covered: readClauses }) : { norms: [], gaps: [], refIds: [], handleRule: null }
  // the plan's own access-handle rule, so the lot-size arithmetic below can honour it
  lot.handleRule = fromGraph.handleRule
  const norms: Norm[] = [...read, ...fromGraph.norms]
  // statements the clause reader did not recognise, with where each clause reaches (its scope + its SEPP part's frame)
  const unreadRows = (await q2(`SELECT u.section, u.clause, u.why, u.zones, u."when", d.title AS instrument FROM nsw.norm_unchecked u JOIN nsw.document d ON d.id = u.document_id
     WHERE u.family = 'subdivision' AND u.document_id = ANY($1)`, [docs.map(d => d.id)])).rows
  // the places the norms and those reaches name, tested against the lot: mapped terms, and the graph's own polygons
  const all = [...norms.map(n => n.when), ...unreadRows.map((u: any) => u.when).filter(Boolean)].flatMap(c => leaves(c as Cond))
  const termsAsked = [...new Set(all.filter(l => l.fact === 'lot.in').map(l => String(l.value).toLowerCase()))]
  const tested = await Promise.all(termsAsked.map(t => lotTerm(q2, cadid, t, lot!.lga)))
  lot.terms = Object.fromEntries(termsAsked.map((t, i) => [t, tested[i]!]))
  lot.refHits = await refHitsFor(q2, cadid, [...new Set([...fromGraph.refIds, ...all.filter(l => l.fact === 'lot.on_ref').map(l => String(l.value))])])
  const sectionOf = new Map(norms.map(n => [n.id, n.section]))
  const sources = Object.fromEntries((await nswQuery<any>(`SELECT DISTINCT ON (title) title, source_url FROM nsw.document WHERE title = ANY($1) AND source_url IS NOT NULL ORDER BY title, ingested_at DESC`,
    [docs.map(d => d.title)])).rows.map((d: any) => [d.title, d.source_url]))
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
  // the part of an instrument a building was approved under, named from the graph: '<slug>:ch.3-pt.1' -> its instrument
  // and the part's own heading
  const unders = [...new Set(norms.flatMap(n => leaves(n.when)).map(l => l.under).filter(Boolean) as string[])]
  const partNames = new Map<string, string>()
  for (const u of unders) {
    const [slug, local] = u.split(':')
    const r = (await q2(`SELECT d.title, s.heading FROM nsw.document d LEFT JOIN nsw.section s ON s.document_id = d.id AND s.local_id = $2 WHERE d.instrument_slug = $1`, [slug, local])).rows[0]
    if (r) partNames.set(u, `${String(r.title).replace('State Environmental Planning Policy', 'the SEPP').replace(/ Local Environmental Plan /, ' LEP ')} - ${local.replace(/\./g, ' ').replace(/-/g, ' ')}${r.heading ? ` (${r.heading})` : ''}`)
  }
  const part = (u: string) => partNames.get(u) ?? u
  for (const n of norms) for (const l of leaves(n.when)) {
    let key: string | null = null, param: any = 'site', label = ''
    // each with a question in plain words
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
  // what is not read: statements the clause reader did not recognise (nsw.norm_unchecked) - unless the graph's own rules
  // supplied that clause - and LEP clauses whose graph rules carry no effect either
  const graphClauses = new Set(fromGraph.norms.map(n => n.section.replace(/-.*$/, '')))
  // instruments with a norm in play for this question - another pathway's provisions are not part of this answer
  const inPlay = new Set<string>([lot.epi ?? ''])
  for (const k of KINDS) for (const r of evaluate(norms, questionFor(k.key, site, erects0, separates0), lot, landUseKey).norms) if (r.holds !== false) inPlay.add(r.instrument)
  const uncheckedAll = [
    ...unreadRows.filter((u: any) => !graphClauses.has(u.section) && inPlay.has(u.instrument)).map((u: any) => ({ clause: u.clause, section: u.section, instrument: u.instrument, url: link(u.instrument, u.section), zones: u.zones, when: u.when as Cond | null, why: u.why })),
    ...fromGraph.gaps.filter(g => !unreadRows.some((u: any) => u.section === g.section)).map(g => ({ clause: g.parts.length ? g.parts.join(', ') : g.clause, section: g.section, instrument: lot!.epi!, url: link(lot!.epi!, g.section), zones: g.zones,
      why: `${g.heading ?? ''}${g.rules ? ` - in the graph (${g.rules} rule${g.rules === 1 ? '' : 's'}), no effect extracted` : ' - in the graph as text, no rule extracted'}` })),
  ]
  // a clause that cannot reach this lot cannot change its answer: its own scope (zones, mapped places) or its SEPP part's
  // frame is false here for every kind - tested by the same engine; anything not known keeps it listed (fail closed)
  const reachesHere = (u: any) => {
    if (!u.when) return true
    const probe: Norm = { id: `unread:${u.section}`, instrument: u.instrument, clause: u.clause, section: u.section, text: '', when: u.when,
                          then: { permit: 'with_consent' }, author: { by: 'unread clause reach', at: '' } }
    return KINDS.some(k => evaluate([probe], questionFor(k.key, site, erects0, separates0), lot!, landUseKey).norms[0]?.holds !== false)
  }
  const reaches = (u: any) => (!u.zones || !lot!.zone || u.zones.includes(lot!.zone)) && reachesHere(u)
  const unchecked = uncheckedAll.filter(reaches).map(({ when: _w, ...u }) => u)
  const notHere = uncheckedAll.filter(u => !reaches(u)).map(({ when: _w, ...u }) => u)

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
    lepCovered: Boolean(lepDoc), purpose: purpose ?? null, lots,
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
