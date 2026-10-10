/**
 * RAG pilot, Phase 7.1 / 7.2 - scores per variant and per side, and the adjudication queue.
 *
 *   npx tsx scripts/rag/12-score.ts [--run <answer run id>]     # default: every answer, latest per (question, variant)
 *
 * Against each question's expected answer (status key or draft):
 *   correct            verdict questions: the same yes / no / maybe; figure questions: the same figure (1%);
 *                      "maybe" questions: the answer says maybe (or gives the figure for each case)
 *   confidently wrong  wrong AND definite (a yes / no, or a single figure) - the headline number; a definite answer
 *                      where the key says maybe counts here, a "maybe" where the key is definite does not (it abstained)
 *   controlling        the answer cites a clause the key names as controlling
 * plus the automatic checks stored with each answer, cost and latency. The deterministic engine (frozen in
 * rag.engine_answer) is scored the same way as side P. Every draft key and every question the sides disagree on goes to
 * rag.adjudication with the controlling clause's words, for Manni to confirm.
 */
import 'dotenv/config'
import pg from 'pg'
import { loadCorpus, provisionOf, keyedProvision, clauseKey, subtreeText, type Corpus } from '../../shared/rag/retrieve'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const yn = (v: unknown): 'yes' | 'no' | 'maybe' | null => {
  const s = String(v ?? '').toLowerCase()
  if (['yes', 'permissible', 'conditional', 'permitted', 'true'].includes(s)) return 'yes'
  if (['no', 'prohibited', 'no_permission', 'false'].includes(s)) return 'no'
  if (s === 'maybe' || s === 'unknown') return 'maybe'
  return null
}
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.01)

function clausesOf(C: Corpus, refs: string[], keyed = false): Set<string> {
  const out = new Set<string>()
  for (const r of refs ?? []) {
    const id = keyed ? keyedProvision(C, r) : provisionOf(C, r)
    const p = id ? C.provs.get(id) : null
    if (p) out.add(`${p.document_id}|${clauseKey(p.local_id, p.path)}`)
  }
  return out
}

/** an expected area found among the answer's: its label as a word, and its map when it names one */
const areaHit = (x: { value: string; map?: string | null }, said: string[]) => {
  const n = (s: string) => s.toLowerCase().replace(/[“”"]/g, '').replace(/\s*[-\u2013\u2014]\s*/g, '-').replace(/\s+/g, ' ')
  const v = n(x.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), m = x.map ? n(x.map).replace(/ map$/, '') : null
  return said.some(t => new RegExp(`(^|[^a-z0-9])${v}([^a-z0-9]|$)`).test(n(t)) && (!m || n(t).includes(m)))
}

export function score(C: Corpus, e: any, a: { verdict: any; value: any; values_if?: any[]; controlling?: string[]; figures?: number[]; areas?: string[] } | null) {
  if (!e || e.status === 'none' || e.status === 'retired' || !a) return null
  const expMaybe = yn(e.verdict) === 'maybe' || !!e.values
  const isFigure = e.value != null
  const isVerdict = !isFigure && !expMaybe && yn(e.verdict) != null
  const ctrlKey = clausesOf(C, e.controlling ?? [], true), ctrlAns = clausesOf(C, a.controlling ?? [])
  const controlling = ctrlKey.size ? [...ctrlKey].some(k => ctrlAns.has(k)) : null
  const av = yn(a.verdict), definite = (av === 'yes' || av === 'no') || (a.value != null && av !== 'maybe' && !(a.values_if?.length))
  let correct: boolean | null = null
  // the land a clause applies to: every expected area must be among the answer's
  const areasOk = e.areas?.length ? (a.areas?.length ? e.areas.every((x: any) => areaHit(x, a.areas!)) : false) : null
  // one of several figures the clause sets ("60 m2 or 33% ..., whichever is the greater") is the clause's answer
  const figureHit = (v: number) => (a.value != null && close(Number(a.value), v)) || !!a.figures?.some(f => close(Number(f), v))
  if (expMaybe) {
    const branches = (e.values ? Object.values(e.values) : (e.values_if ?? []).map((x: any) => x.value)).map(Number).filter(n => !isNaN(n))
    correct = av === 'maybe' || (!!a.values_if?.length && branches.every((b: number) => a.values_if!.some((x: any) => close(Number(x.value), b))))
  } else if (isFigure) correct = figureHit(Number(e.value)) && av !== 'maybe' && areasOk !== false
  else if (areasOk != null) correct = areasOk
  else if (isVerdict) correct = av === yn(e.verdict)
  else if (controlling != null) correct = controlling                                // e.g. "which prevails": the clause is the answer
  if (correct == null) return null
  const said = definite || !!a.areas?.length
  return { correct, confidently_wrong: !correct && said, abstained: !correct && !said, controlling }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const C = await loadCorpus(q)
  const RUN = arg('--run')
  // every summary key also exists per plan: "<key>@<LEP title>" (the /rag page shows one plan at a time)
  const answers = (await q(`SELECT DISTINCT ON (a.question_id, a.variant) a.*, qn.set_name, qn.expected, qn.kind, qn.clause qclause, i.title AS lep
                              FROM rag.answer a JOIN rag.question qn ON qn.id = a.question_id JOIN rag.run r ON r.id = a.run_id LEFT JOIN rag.instrument i ON i.document_id = qn.document_id WHERE coalesce(qn.expected->>'status', '') <> 'retired' ${RUN ? 'AND a.run_id = $1' : ''}
                             ORDER BY a.question_id, a.variant, r.started_at DESC`, RUN ? [RUN] : [])).rows
  // stability: where a question was answered more than once by a variant, does the decision repeat?
  const repeats = (await q(`SELECT a.variant, a.question_id, array_agg(coalesce(a.answer->>'verdict', '') || '|' || coalesce(a.answer->>'value', '')) d
                              FROM rag.answer a GROUP BY 1, 2 HAVING count(*) > 1`)).rows
  const stability: Record<string, { pairs: number; same: number }> = {}
  for (const r of repeats) { const s = (stability[r.variant] ??= { pairs: 0, same: 0 }); s.pairs++; if (new Set(r.d).size === 1) s.same++ }
  const engine = (await q(`SELECT e.*, qn.set_name, qn.expected, qn.kind, qn.clause qclause, coalesce(r.config->'plans'->>(qn.document_id::text), r.config->>'plan') AS plan, i.title AS lep
                             FROM rag.engine_answer e JOIN rag.question qn ON qn.id = e.question_id LEFT JOIN rag.run r ON r.id = e.run_id LEFT JOIN rag.instrument i ON i.document_id = qn.document_id WHERE coalesce(qn.expected->>'status', '') <> 'retired'`)).rows
  const withLep = (keys: string[], lep: string | null) => lep ? [...keys, ...keys.map(k => `${k}@${lep}`)] : keys
  type Acc = Record<string, number>
  const by: Record<string, Acc> = {}
  const bump = (k: string, f: string, n = 1) => { (by[k] ??= {})[f] = (by[k]![f] ?? 0) + n }
  const perQ = new Map<string, Record<string, any>>()
  for (const a of answers) {
    const ans = a.answer?.unparsed ? null : a.answer
    const s = score(C, a.expected, ans)
    for (const k of withLep([a.variant, `${a.variant}|${a.set_name}`, `${a.variant}|ground:${a.expected?.status}`, ...(a.set_name === 'grid' ? [`${a.variant}|${a.qclause}`] : [])], a.lep)) {
      bump(k, 'answers'); bump(k, 'cost', Number(a.cost_usd ?? 0)); bump(k, 'latency', Number(a.latency_ms ?? 0))
      if (!ans) bump(k, 'unparsed')
      const c = a.checks ?? {}
      bump(k, 'cites', c.cites ?? 0); bump(k, 'cites_resolved', c.cites_resolved ?? 0); bump(k, 'quotes', c.quotes ?? 0); bump(k, 'quotes_verbatim', c.quotes_verbatim_cited ?? 0)
      if (c.figure_in_cited != null) { bump(k, 'figures'); if (c.figure_in_cited) bump(k, 'figures_in_cited') }
      bump(k, 'unaddressed_overrides', (c.unaddressed_overrides ?? []).length)
      if (s) { bump(k, 'scored'); if (s.correct) bump(k, 'correct'); if (s.confidently_wrong) bump(k, 'confidently_wrong'); if (s.abstained) bump(k, 'abstained'); if (s.controlling != null) { bump(k, 'ctrl_n'); if (s.controlling) bump(k, 'ctrl_hit') } }
    }
    perQ.set(a.question_id, { ...(perQ.get(a.question_id) ?? {}), [a.variant]: { verdict: ans?.verdict ?? null, value: ans?.value ?? null, controlling: ans?.controlling ?? [], correct: s?.correct ?? null } })
  }
  for (const e of engine) {
    const ans = e.verdict === 'not_answered' || e.verdict === 'error' ? null : { verdict: e.verdict, value: null, controlling: (e.controlling ?? []).map((c: string) => `${e.plan ?? 'LEP'} cl ${c}`) }
    const s = score(C, e.expected, ans)
    for (const k of withLep(['P', `P|${e.set_name}`, `P|ground:${e.expected?.status}`, ...(e.set_name === 'grid' ? [`P|${e.qclause}`] : [])], e.lep)) {
      bump(k, 'answers'); if (!ans) bump(k, 'not_answered')
      if (s) { bump(k, 'scored'); if (s.correct) bump(k, 'correct'); if (s.confidently_wrong) bump(k, 'confidently_wrong'); if (s.abstained) bump(k, 'abstained') }
      else if (e.expected?.status !== 'none' && !ans) bump(k, 'abstained_unanswered')
    }
    perQ.set(e.question_id, { ...(perQ.get(e.question_id) ?? {}), P: { verdict: e.verdict, controlling: e.controlling, correct: s?.correct ?? null } })
  }
  const pct = (a = 0, b = 0) => b ? Math.round(100 * a / b) : null
  const summary = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, {
    answers: v.answers ?? 0, scored: v.scored ?? 0, accuracy: pct(v.correct, v.scored), confidently_wrong: pct(v.confidently_wrong, v.scored), abstained: pct(v.abstained, v.scored),
    controlling: pct(v.ctrl_hit, v.ctrl_n), cites_resolved: pct(v.cites_resolved, v.cites), quotes_verbatim: pct(v.quotes_verbatim, v.quotes), figure_in_cited: pct(v.figures_in_cited, v.figures),
    unaddressed_overrides_per_answer: v.answers ? +((v.unaddressed_overrides ?? 0) / v.answers).toFixed(2) : null, unparsed: v.unparsed ?? 0, not_answered: v.not_answered ?? 0,
    cost_per_answer: v.answers && v.cost ? +(v.cost / v.answers).toFixed(5) : null, latency_s: v.answers && v.latency ? +(v.latency / v.answers / 1000).toFixed(1) : null,
    stability: stability[k] ? pct(stability[k]!.same, stability[k]!.pairs) : null, stability_pairs: stability[k]?.pairs ?? 0,
  }]))
  console.log('stability (same decision on a repeat):', Object.entries(stability).map(([k, s]) => `${k} ${pct(s.same, s.pairs)}% of ${s.pairs}`).join(', '))
  console.log('side     answers scored  acc  conf.wrong  abstain  ctrl  cites  quotes  fig  overr  $/ans    s')
  for (const k of ['P', 'D', 'R0', 'R1', 'R2', 'R3', 'L0', 'R4u', 'R4']) {
    const s = summary[k]; if (!s) continue
    console.log(k.padEnd(8), String(s.answers).padStart(7), String(s.scored).padStart(6), `${s.accuracy}%`.padStart(5), `${s.confidently_wrong}%`.padStart(10), `${s.abstained}%`.padStart(8),
      `${s.controlling ?? '-'}%`.padStart(5), `${s.cites_resolved ?? '-'}%`.padStart(6), `${s.quotes_verbatim ?? '-'}%`.padStart(7), `${s.figure_in_cited ?? '-'}%`.padStart(5), String(s.unaddressed_overrides_per_answer ?? '-').padStart(6), String(s.cost_per_answer ?? '-').padStart(8), String(s.latency_s ?? '-').padStart(5))
  }

  // adjudication: every draft key, and every question where the sides disagree with each other or with a key
  const questions = (await q(`SELECT id, set_name, clause, text, expected FROM rag.question WHERE coalesce(expected->>'status', '') <> 'retired'`)).rows
  const queue: any[] = []
  for (const x of questions) {
    const sides = perQ.get(x.id) ?? {}
    const wrong = Object.entries(sides).filter(([, v]: any) => v.correct === false).map(([k]) => k)
    if (x.expected?.status === 'key' && !wrong.length) continue
    if (x.expected?.status === 'none' && !Object.keys(sides).length) continue
    const ctrl = (x.expected?.controlling ?? [])[0] as string | undefined
    const pid = ctrl ? keyedProvision(C, ctrl) : null
    queue.push({ question_id: x.id, proposed: { expected: x.expected, wrong_sides: wrong, sides }, quote: pid ? subtreeText(C, pid).slice(0, 1500) : null, source_provision: pid,
      note: x.expected?.status === 'draft' ? `Claude draft; ${wrong.length} side(s) disagree: ${wrong.join(', ') || 'none'}` : x.expected?.status === 'key' ? `key; ${wrong.join(', ')} disagree - is the key right?` : 'no key' })
  }
  await q('BEGIN')
  await q(`DELETE FROM rag.adjudication WHERE status = 'proposed'`)
  await q(`INSERT INTO rag.adjudication (question_id, proposed, quote, source_provision, status, note)
           SELECT question_id, proposed, quote, source_provision, 'proposed', note FROM jsonb_to_recordset($1::jsonb) AS x(question_id uuid, proposed jsonb, quote text, source_provision uuid, note text)
            WHERE NOT EXISTS (SELECT 1 FROM rag.adjudication d WHERE d.question_id = x.question_id)`, [JSON.stringify(queue)])
  await q(`INSERT INTO rag.run (stage, config, counts, finished_at) VALUES ('score', $1, $2, now())`, [JSON.stringify({ answer_run: RUN ?? 'latest per question and variant' }), JSON.stringify({ summary, adjudication_queue: queue.length })])
  await q('COMMIT')
  console.log('adjudication queue:', queue.length)
  await client.end()
}
if (process.argv[1]?.includes('12-score')) main().catch(e => { console.error(e); process.exit(1) })
