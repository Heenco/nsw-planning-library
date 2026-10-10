/**
 * RAG pilot - side D: the deterministic rag engine (rag.claim + shared/rag/evaluate.ts) answers the whole question bank.
 * No model, no pilot table. Stored in rag.answer as variant 'D' (model 'deterministic'), checked like every variant.
 *
 *   npx tsx scripts/rag/15-deterministic.ts            # every question
 *   npx tsx scripts/rag/15-deterministic.ts --show     # print each answer's text
 *
 * The question is read by its structure, the same way for every question - its kind and use (rag.question), and in its
 * words: the topic ("floor space ratio", "height", "minimum lot size"), "Under <an instrument>, ..." (answer from that
 * instrument alone), the title type, a consent date, a separate application, the number of lots, and for a question with no lot
 * the facts it states ("a 290 m2 lot in Zone R2 where the Floor Space Ratio Map shows 0.5:1").
 */
import 'dotenv/config'
import pg from 'pg'
import { loadEngine, evaluate, writeAnswer, explain, type Ask, type Result, type Engine } from '../../shared/rag/evaluate'
import { loadCorpus } from '../../shared/rag/retrieve'
import { instrumentOf, type Inst } from '../../shared/rag/refs'
import { checks } from '../../shared/rag/answer'
import { landUseKey } from '../../shared/land-use-key'

const SHOW = process.argv.includes('--show')
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const isoOf = (t: string) => { const m = t.match(/(\d{1,2}) (january|february|march|april|may|june|july|august|september|october|november|december) (\d{4})/i); return m ? `${m[3]}-${String(MONTHS.indexOf(m[2]!.toLowerCase()) + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null }

/** the land uses the claims know, longest first: a question names its use in these words */
let VOCAB: string[] = []
let INSTS: Inst[] = []
function askOf(q: any): { ask: Ask | null; mode: string; lot: any } {
  const t: string = q.text
  const keyText = landUseKey(t)
  const use = q.use_term ? landUseKey(q.use_term) : VOCAB.find(u => new RegExp(`(^|[^a-z])${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(keyText)) ?? 'dwelling house'
  const under = t.match(/^under ([^,]+),/i)?.[1]
  const only = under ? instrumentOf(under, INSTS)?.document_id : undefined
  let lot = q.lot_facts
  if (!lot) {   // a lot-free question states its facts
    const area = t.match(/(\d[\d,.]*)\s*m2 lot/i)?.[1], zone = t.match(/Zone (R\d|[A-Z]{1,2}\d)/)?.[1], fsr = t.match(/Floor Space Ratio Map shows ([\d.]+):1/i)?.[1]
    // a hypothetical lot is exactly what the question states: on no mapped area it does not name (said in the answer)
    lot = area || zone ? { address: 'a hypothetical lot', lot: null, area_m2: area ? Number(area.replace(/,/g, '')) : null, zone, fsr_map: fsr ? Number(fsr) : null, mapped: [], terms: {},
      assumed: 'the question states all the facts: the lot is on no mapped area it does not name' } : null
  }
  // what a plan's map gives the lot (keyed from the live Planning Portal map service): read from D's own lot facts
  if (q.kind === 'map') return { ask: null, mode: 'map', lot }
  if (q.kind === 'precedence') return { ask: null, mode: 'precedence', lot }
  if (q.kind === 'extraction') return { ask: null, mode: 'extraction', lot }
  if (q.kind === 'subdivision' || /subdivi/i.test(t)) {
    // a question across title types ("Torrens, community and strata ... alike?") asks each of them
    const named = ['torrens', 'community', 'strata'].filter(x => new RegExp(x, 'i').test(t))
    if (named.length > 1) return { ask: { kind: 'subdivision', use, lots: 2, proposal: 'subdivision', only, consentDate: isoOf(t), combinedDa: null }, mode: `tenure-compare:${named.join(',')}`, lot }
    const tenure = /strata/i.test(t) ? 'strata' : /community/i.test(t) ? 'community' : 'torrens'
    const date = isoOf(t), separate = /separate|not known/i.test(t) ? (date || /not known/i.test(t) ? (/not known/i.test(t) ? null : false) : null) : null
    const lots = Number(t.match(/into (\d+) lots/i)?.[1] ?? 2)
    return { ask: { kind: 'subdivision', use, lots, tenure, consentDate: date, combinedDa: separate, proposal: 'subdivision', only }, mode: /minimum (lot )?size|minimum size/i.test(t) ? 'subdivision-min' : 'subdivision-can', lot }
  }
  if (q.kind === 'permissibility') return { ask: { kind: 'permissibility', use, only }, mode: 'permissibility', lot }
  const topic = /floor space ratio|total floor area/i.test(t) ? 'fsr' : /height/i.test(t) ? 'height' : /minimum lot size|lot size/i.test(t) ? 'lot_size' : /width|frontage/i.test(t) ? 'lot_width' : null
  if (!topic) return { ask: null, mode: 'unparsed', lot }
  return { ask: { kind: 'standard', use, topic, only, proposal: 'development' }, mode: /total floor area/i.test(t) ? 'floor-area-by-reference' : 'standard', lot }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const E = await loadEngine(q), C = await loadCorpus(q)
  INSTS = C.insts
  VOCAB = [...new Set(E.claims.flatMap(c => c.uses))].filter(u => u.length > 3).sort((a, b) => b.length - a.length)
  const questions = (await q(`SELECT id, set_name, document_id, clause, kind, use_term, text, lot_facts FROM rag.question WHERE coalesce(expected->>'status', '') <> 'retired' ORDER BY set_name, clause, cadid`)).rows
  const outcomes: Record<string, string> = {}
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('answer', $1) RETURNING id`, [JSON.stringify({ variants: ['D'], model: 'deterministic', claims: E.claims.length })])).rows[0].id
  await q(`DELETE FROM rag.answer WHERE variant = 'D'`)
  const label = (r: Result, ids?: string[]) => r.tested.filter(t => (ids ?? r.ruling?.answer?.claims ?? []).includes(t.claim.id)).map(t => E.label(t.claim.provision_id))
  const tally: Record<string, number> = {}
  for (const x of questions) {
    const t0 = Date.now()
    const { ask, mode, lot } = askOf(x)
    let answer: any = { verdict: null, value: null, unit: null, values_if: [], controlling: [], quotes: [], unknowns: [], reasoning: '' }
    // the full reasoning as data (shared/rag/evaluate.ts explain): what /rag shows, clause by clause
    const explained: any[] = [], cited: string[] = []
    if (mode === 'map') {
      const t = String(x.text), field = /Land Zoning Map/i.test(t) ? 'zone' : /Height of Buildings/i.test(t) ? 'height_map_m' : /Floor Space Ratio/i.test(t) ? 'fsr_map' : /Lot Size/i.test(t) ? 'lot_size_map_m2' : null
      const split = field && field !== 'zone' ? lot?.map_split?.[field] : null
      if (field === 'zone') { const code = t.match(/in Zone ([A-Z]{1,3}\d{1,2}[A-Z]?)(?![A-Za-z0-9])/)?.[1]; answer.verdict = lot?.zone == null ? null : String(lot.zone) === code ? 'yes' : 'no'; answer.reasoning = `the lot is zoned ${lot?.zone ?? 'not known'} (${lot?.epi ?? 'no plan'})` }
      else if (split?.length) { answer.verdict = 'maybe'; answer.values_if = split.map((s: any) => ({ if: `${Math.round(s.share * 100)}% of the lot`, value: s.value })); answer.reasoning = `the map splits the lot: ${split.map((s: any) => `${s.value} on ${Math.round(s.share * 100)}%`).join(', ')}` }
      else if (field) { answer.value = lot?.[field] ?? null; answer.unit = field === 'height_map_m' ? 'm' : field === 'fsr_map' ? 'ratio' : 'm2'; answer.reasoning = `the map gives the lot ${answer.value ?? 'no figure'}` }
      else answer.reasoning = 'not answered: no map named'
    } else if (mode === 'precedence') {
      const rule = E.rels.find(r => r.kind === 'inconsistency_rule'), sub = E.rels.find(r => r.kind === 'subject_to' && /SEPP that prevails/i.test(r.to_ref ?? ''))
      answer.controlling = [rule && E.label(rule.from_provision), sub && E.label(sub.from_provision)].filter(Boolean)
      cited.push(...[rule?.from_provision, sub?.from_provision].filter(Boolean) as string[])
      answer.reasoning = rule ? `${E.label(rule.from_provision)}: the Policy prevails over another environmental planning instrument to the extent of an inconsistency${sub ? `; ${E.label(sub.from_provision)} makes the Plan subject to a SEPP that prevails` : ''}.` : 'no instrument rule held'
    } else if (mode === 'extraction') {
      // the clause's own standards, read from the claims on it
      const m = String(x.clause).match(/^([\d.]+[A-Z]*)((?:\(\w+\))*)$/)
      const local = m ? [`sec.${m[1]}`, ...[...m[2]!.matchAll(/\((\w+)\)/g)].map((p, i) => i === 0 ? `-ssec.${p[1]}` : `-para${i}.${p[1]}`)].join('') : ''
      const ofQ = (pid: string) => E.provs.get(pid)?.doc_kind === 'lep' && (!x.document_id || E.provs.get(pid)?.document_id === x.document_id)
      // the clause's own standard comes before its paragraphs' ("7.6(1): 20.5 m" before "(1)(c): at least 1,300 m2 ...")
      const depthOf = (pid: string) => (E.provs.get(pid)!.local_id.match(/-/g) ?? []).length
      const cs = E.claims.filter(c => c.kind === 'standard' && ofQ(c.provision_id) && (E.provs.get(c.provision_id)!.local_id === local || E.provs.get(c.provision_id)!.local_id.startsWith(local + '-') || E.provs.get(c.provision_id)!.local_id.startsWith(local + '#')))
        .sort((a, b) => depthOf(a.provision_id) - depthOf(b.provision_id))
      /** the land a claim names: its mapped areas, and what it excludes ("contains a heritage item", "has 2 street frontages") */
      const areasOf = (cl: any[]) => [...new Set(cl.flatMap(c => [...c.terms.filter((t: string) => t.startsWith('mapped:')).map((t: string) => t.slice(7)), ...(c.excludes ?? []).filter((x: string) => !x.startsWith('zone:')).map((x: string) => `not where: ${x}`)]))]
      const under = (pid: string) => { const p = C.provs.get(pid); const l = p?.local_id ?? ''; return (!x.document_id || p?.document_id === x.document_id) && (l === local || l.startsWith(local + '-') || l.startsWith(local + '#')) }
      const fig = x.text.match(/(\d[\d,]*(?:\.\d+)?)\s*(m2|square metres|metres|%)/i)?.[1]?.replace(/,/g, '')
      if (/standard or (?:part of )?a definition|part of a definition/i.test(x.text) && fig) {
        // is the figure a standard, or inside a definition? look in the clause's terms and its standards
        const term = [...C.provs.values()].find(p => p.local_id.includes('-def.') && under(p.id) && p.own_text.replace(/,/g, '').includes(fig))
        const std = cs.find(c => String(c.value) === fig)
        answer.controlling = [E.label(term?.id ?? std?.provision_id ?? '') || x.clause].filter(Boolean)
        answer.reasoning = term ? `part of a definition: "${term.own_text.slice(0, 160)}" - not a development standard` : std ? `a development standard: ${E.label(std.provision_id)}` : `the figure ${fig} is in neither a definition nor a standard of ${x.clause}`
        answer.kind_of_figure = term ? 'definition' : std ? 'standard' : null
        cited.push(...[term?.id, std?.provision_id].filter(Boolean) as string[])
      } else if (/which areas|which map|what land/i.test(x.text) && !/development standard/i.test(x.text)) {
        // (a question that asks for the standard as well - "... set, and on which mapped area?" - is answered below, areas included)
        // the land the clause applies to - and does not: from every claim under it (frames, permissions, prohibitions with
        // their exceptions, standards), not only its frames
        const own = E.claims.filter(c => ofQ(c.provision_id) && under(c.provision_id))
        const areas = areasOf(own)
        const used = own.filter(c => areasOf([c]).length)
        answer.controlling = [...new Set(used.map(c => E.label(c.provision_id)))]
        answer.reasoning = areas.length ? `applies to: ${areas.join('; ')}` : `no mapped area or land condition read for ${x.clause}`
        answer.areas = areas
        cited.push(...used.map(c => c.provision_id))
      } else {
        const c = cs.find(c => c.value != null) ?? cs[0]
        // a standard set as one of several figures ("whichever of the following is the greater- (a) 60 m2, (b) 33% of ..."):
        // every figure, and the rule that picks between them
        const group = c?.band?.pick ? cs.filter(o => o.band?.pick && o.band?.of === c.band.of && o.value != null) : c ? [c] : []
        const fmtOf = (o: any) => `${o.value}${o.unit === 'ratio' ? ':1' : o.unit === '%' ? '%' : ` ${o.unit ?? ''}`}${o.band?.relative ? ` of ${o.band.relative}` : ''}`.trim()
        const condOf = (o: any) => o.band?.metric && !o.band?.pick ? ` where ${o.band.metric} ${o.band.lo != null ? `> ${o.band.lo}` : ''}${o.band.hi != null ? ` < ${o.band.hi}` : ''}`.trimEnd() : ''
        if (c) cited.push(...group.map(o => o.provision_id))
        if (c) {
          answer = { ...answer, value: c.value, unit: c.unit, controlling: [...new Set(group.map(o => E.label(o.provision_id)))],
            figures: group.length > 1 ? group.map(o => o.value) : undefined, areas: areasOf([c]),
            reasoning: group.length > 1
              ? `${E.label(c.provision_id).replace(/\(\w+\)$/, '')}: ${c.topic} ${c.comparator ?? ''} ${group.map(fmtOf).join(' or ')}, whichever is the ${c.band.pick} (${cs.length} standard claim(s) on the clause)`
              : `${E.label(c.provision_id)}: ${c.topic} ${c.comparator ?? ''} ${c.value ?? c.value_source ?? ''} ${c.unit ?? ''}${condOf(c)}${c.band?.relative ? ` of ${c.band.relative}` : ''}${areasOf([c]).length ? ` on ${areasOf([c]).join('; ')}` : ''} (${cs.length} standard claim(s) on the clause)` }
        }
        else answer.reasoning = `no standard claim on ${x.clause}`
      }
    } else if (ask && lot && mode.startsWith('tenure-compare:')) {
      // the same subdivision under each title type: is the minimum the same for all?
      const per = mode.slice(15).split(',').map(tn => {
        const r = evaluate(E, { ...ask, tenure: tn as any }, lot)
        explained.push({ case: tn, ...explain(E, r) })
        const min = r.limits[0]?.subs[0]
        const v = r.answer?.value ?? null, expr = r.answer?.expr ?? null
        return { tn, v, expr, by: min ? label(min) : [], branches: (min?.ruling?.branches ?? []).map(b => ({ if: b.if, value: Number(b.answer?.value) })) }
      })
      const sig = (p: typeof per[number]) => p.branches.length ? JSON.stringify(p.branches.map(b => b.value).sort()) : String(p.v)
      answer.verdict = per.every(p => sig(p) === sig(per[0]!)) ? 'yes' : 'no'
      answer.controlling = [...new Set(per.flatMap(p => p.by))]
      answer.reasoning = per.map(p => `${p.tn}: ${p.expr ?? (p.v != null ? `${p.v} m²` : 'no minimum')} (${p.by.join(', ') || '-'})`).join('; ')
      answer.values_if = per.filter(p => p.v != null).map(p => ({ if: p.tn, value: Number(p.v) }))
    } else if (ask && lot) {
      const r = evaluate(E, ask, lot)
      if (mode !== 'floor-area-by-reference') explained.push(explain(E, r))
      const text = writeAnswer(E, r, lot)
      if (mode === 'permissibility') {
        // a permitted use whose binding (not non-discretionary) minimum lot size this lot fails cannot get consent as of right
        const bar = r.limits.find(l => l.text === 'resolved:lot_size' && l.status === 'not met')
        answer.verdict = r.verdict === 'permitted' ? (bar ? 'no' : 'yes') : r.verdict === 'prohibited' ? 'no' : 'maybe'
        answer.controlling = [...label(r), ...(bar ? bar.subs.flatMap(s => label(s)) : [])]
        if (bar) answer.unknowns = ['unless the minimum lot size is varied under cl 4.6']
      } else if (mode === 'subdivision-can' || mode === 'subdivision-min') {
        const min = r.limits[0]?.subs[0]
        answer.verdict = mode === 'subdivision-can' ? r.verdict : r.verdict === 'maybe' && r.answer?.value == null ? 'maybe' : null
        answer.value = r.answer?.value ?? null; answer.unit = 'm2'
        answer.values_if = (min?.ruling?.branches ?? []).map(b => ({ if: b.if, value: Number(b.answer?.value) })).filter(v => !isNaN(v.value))
        answer.controlling = min ? (min.ruling?.branches?.length ? [...new Set(min.ruling.branches.flatMap(b => label(min, b.answer?.claims)))] : label(min)) : []
        if (min?.ruling?.unresolved?.length) answer.unknowns = min.ruling.unresolved
      } else if (mode === 'floor-area-by-reference') {
        // "the total floor area of the principal and secondary dwellings" is set by a cross-reference in the use's permission
        const perm = evaluate(E, { kind: 'permissibility', use: ask.use, only: ask.only }, lot)
        explained.push(explain(E, perm))
        const ref = perm.limits.flatMap(l => l.subs).find(s => s.ask.topic === 'floor_area' && s.ask.use !== ask.use)
        const fsr = ref?.limits[0]?.subs[0] ?? (ref ? null : evaluate(E, ask, lot))
        answer.value = fsr?.answer?.value ?? null; answer.unit = 'ratio'; answer.controlling = fsr ? label(fsr) : []
        answer.reasoning = ref ? `via the permission's cross-reference to the maximum floor area of a ${ref.ask.use}: ${writeAnswer(E, ref, lot)}` : text
      } else {
        answer.value = r.answer?.value ?? null; answer.unit = r.answer?.unit ?? null; answer.controlling = label(r)
        if (r.verdict === 'maybe') { answer.verdict = 'maybe'; answer.values_if = (r.ruling?.branches ?? []).map(b => ({ if: b.if, value: Number(b.answer?.value) })) }
      }
      if (!answer.reasoning) answer.reasoning = text
      answer.not_checked = r.notChecked
    } else answer.reasoning = `not answered: ${mode}${lot ? '' : ' (no lot facts)'}`
    const k = `${x.set_name}:${answer.verdict ?? (answer.value != null ? 'value' : answer.controlling.length ? 'cited' : 'none')}`; tally[k] = (tally[k] ?? 0) + 1
    // each answer's outcome, kept with the run: the next build's page shows which answers changed (status.get.ts)
    outcomes[x.id] = [answer.verdict ?? '', answer.value ?? '', answer.unit ?? '', (answer.values_if ?? []).map((v: any) => v.value).join('/')].join('|')
    await q(`INSERT INTO rag.answer (run_id, question_id, variant, model, retrieved, answer, checks, trace, latency_ms, tokens_in, tokens_out, cost_usd)
             VALUES ($1, $2, 'D', 'deterministic', '[]', $3, $4, $5, $6, 0, 0, 0)`, [run, x.id, JSON.stringify(answer), JSON.stringify(checks(C, answer)), JSON.stringify({ mode, ask, explain: explained, cited }), Date.now() - t0])
    if (SHOW) console.log(`\n### ${x.set_name} ${x.clause}: ${x.text}\n${answer.reasoning}`)
  }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ answers: questions.length, tally, outcomes })])
  console.log(tally)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
