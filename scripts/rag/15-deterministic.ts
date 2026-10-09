/**
 * RAG pilot - side D: the deterministic rag engine (rag.claim + shared/rag/evaluate.ts) answers the whole question bank.
 * No model, no pilot table. Stored in rag.answer as variant 'D' (model 'deterministic'), checked like every variant.
 *
 *   npx tsx scripts/rag/15-deterministic.ts            # every question
 *   npx tsx scripts/rag/15-deterministic.ts --show     # print each answer's text
 *
 * The question is read by its structure, the same way for every question - its kind and use (rag.question), and in its
 * words: the topic ("floor space ratio", "height", "minimum lot size"), "Under Randwick LEP 2012" (answer from the LEP
 * alone), the title type, a consent date, a separate application, the number of lots, and for a question with no lot
 * the facts it states ("a 290 m2 lot in Zone R2 where the Floor Space Ratio Map shows 0.5:1").
 */
import 'dotenv/config'
import pg from 'pg'
import { loadEngine, evaluate, writeAnswer, type Ask, type Result, type Engine } from '../../shared/rag/evaluate'
import { loadCorpus } from '../../shared/rag/retrieve'
import { checks } from '../../shared/rag/answer'
import { landUseKey } from '../../shared/land-use-key'

const SHOW = process.argv.includes('--show')
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const isoOf = (t: string) => { const m = t.match(/(\d{1,2}) (january|february|march|april|may|june|july|august|september|october|november|december) (\d{4})/i); return m ? `${m[3]}-${String(MONTHS.indexOf(m[2]!.toLowerCase()) + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null }

/** the land uses the claims know, longest first: a question names its use in these words */
let VOCAB: string[] = []
function askOf(q: any): { ask: Ask | null; mode: string; lot: any } {
  const t: string = q.text
  const keyText = landUseKey(t)
  const use = q.use_term ? landUseKey(q.use_term) : VOCAB.find(u => new RegExp(`(^|[^a-z])${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(keyText)) ?? 'dwelling house'
  const only = /^under randwick lep 2012/i.test(t) ? 'lep' as const : undefined
  let lot = q.lot_facts
  if (!lot) {   // a lot-free question states its facts
    const area = t.match(/(\d[\d,.]*)\s*m2 lot/i)?.[1], zone = t.match(/Zone (R\d|[A-Z]{1,2}\d)/)?.[1], fsr = t.match(/Floor Space Ratio Map shows ([\d.]+):1/i)?.[1]
    lot = area || zone ? { address: 'a lot', lot: null, area_m2: area ? Number(area.replace(/,/g, '')) : null, zone, fsr_map: fsr ? Number(fsr) : null } : null
  }
  if (q.kind === 'precedence') return { ask: null, mode: 'precedence', lot }
  if (q.kind === 'extraction') return { ask: null, mode: 'extraction', lot }
  if (q.kind === 'subdivision' || /subdivi/i.test(t)) {
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
  VOCAB = [...new Set(E.claims.flatMap(c => c.uses))].filter(u => u.length > 3).sort((a, b) => b.length - a.length)
  const questions = (await q(`SELECT id, set_name, clause, kind, use_term, text, lot_facts FROM rag.question ORDER BY set_name, clause, cadid`)).rows
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('answer', $1) RETURNING id`, [JSON.stringify({ variants: ['D'], model: 'deterministic', claims: E.claims.length })])).rows[0].id
  await q(`DELETE FROM rag.answer WHERE variant = 'D'`)
  const label = (r: Result, ids?: string[]) => r.tested.filter(t => (ids ?? r.ruling?.answer?.claims ?? []).includes(t.claim.id)).map(t => E.label(t.claim.provision_id))
  const tally: Record<string, number> = {}
  for (const x of questions) {
    const t0 = Date.now()
    const { ask, mode, lot } = askOf(x)
    let answer: any = { verdict: null, value: null, unit: null, values_if: [], controlling: [], quotes: [], unknowns: [], reasoning: '' }
    if (mode === 'precedence') {
      const rule = E.rels.find(r => r.kind === 'inconsistency_rule'), sub = E.rels.find(r => r.kind === 'subject_to' && /SEPP that prevails/i.test(r.to_ref ?? ''))
      answer.controlling = [rule && E.label(rule.from_provision), sub && E.label(sub.from_provision)].filter(Boolean)
      answer.reasoning = rule ? `${E.label(rule.from_provision)}: the Policy prevails over another environmental planning instrument to the extent of an inconsistency${sub ? `; ${E.label(sub.from_provision)} makes the Plan subject to a SEPP that prevails` : ''}.` : 'no instrument rule held'
    } else if (mode === 'extraction') {
      // the clause's own standards, read from the claims on it
      const m = String(x.clause).match(/^([\d.]+[A-Z]*)((?:\(\w+\))*)$/)
      const local = m ? [`sec.${m[1]}`, ...[...m[2]!.matchAll(/\((\w+)\)/g)].map((p, i) => i === 0 ? `-ssec.${p[1]}` : `-para${i}.${p[1]}`)].join('') : ''
      const cs = E.claims.filter(c => c.kind === 'standard' && E.provs.get(c.provision_id)?.doc_kind === 'lep' && (E.provs.get(c.provision_id)!.local_id === local || E.provs.get(c.provision_id)!.local_id.startsWith(local + '-') || E.provs.get(c.provision_id)!.local_id.startsWith(local + '#')))
      const c = cs.find(c => c.value != null) ?? cs[0]
      if (c) { answer = { ...answer, value: c.value, unit: c.unit, controlling: [E.label(c.provision_id)], reasoning: `${E.label(c.provision_id)}: ${c.topic} ${c.comparator ?? ''} ${c.value ?? c.value_source ?? ''} ${c.unit ?? ''} (${cs.length} standard claim(s) on the clause)` } }
      else answer.reasoning = `no standard claim on ${x.clause}`
    } else if (ask && lot) {
      const r = evaluate(E, ask, lot)
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
    await q(`INSERT INTO rag.answer (run_id, question_id, variant, model, retrieved, answer, checks, trace, latency_ms, tokens_in, tokens_out, cost_usd)
             VALUES ($1, $2, 'D', 'deterministic', '[]', $3, $4, $5, $6, 0, 0, 0)`, [run, x.id, JSON.stringify(answer), JSON.stringify(checks(C, answer)), JSON.stringify({ mode, ask }), Date.now() - t0])
    if (SHOW) console.log(`\n### ${x.set_name} ${x.clause}: ${x.text}\n${answer.reasoning}`)
  }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ answers: questions.length, tally })])
  console.log(tally)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
