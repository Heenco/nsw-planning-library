/**
 * RAG pilot - R4, the navigating agent (plan shared/rag-plan.ts P6.3): the model searches and reads with tools, hands its
 * candidate rules to the resolver, and answers from the resolver's ruling. It finds and explains; the resolver decides.
 *
 * Tools: search, open (the whole clause), overridden_by (what overrides a clause), follow (what a clause overrides,
 * refers to or is framed by), land_use_table (a zone), definition (a term), resolve (claims -> ruling with a trace).
 */
import { chat, MODELS, type ChatMessage } from './deepinfra'
import { search, provisionOf, clauseKey, queryVec, type Corpus, type Chunk } from './retrieve'
import { resolve, type Claim, type Rel, type Prov } from './resolver'
import { SYSTEM, parseAnswer, type Answer } from './answer'
import { embed } from './deepinfra'

const fn = (name: string, description: string, properties: Record<string, any>, required: string[]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } })
export const TOOLS = [
  fn('search', 'Hybrid search over the LEP and the Housing SEPP. Returns the best matching provisions with their place in the instrument.', { query: { type: 'string' } }, ['query']),
  fn('open', 'Read a whole clause or section, e.g. "Randwick LEP 2012 cl 4.1A" or "Housing SEPP s 169".', { ref: { type: 'string' } }, ['ref']),
  fn('overridden_by', 'What overrides a clause: provisions that apply despite it, prevail over it, displace it as a non-discretionary standard, or are more specific.', { ref: { type: 'string' } }, ['ref']),
  fn('follow', 'What a clause overrides, refers to, is subject to, and the conditions that limit where it applies.', { ref: { type: 'string' } }, ['ref']),
  fn('land_use_table', 'The Randwick LEP Land Use Table for one zone (objectives, permitted without consent, with consent, prohibited).', { zone: { type: 'string', description: 'e.g. R2' } }, ['zone']),
  fn('definition', 'The definition of a term in the LEP Dictionary or the Housing SEPP.', { term: { type: 'string' } }, ['term']),
  fn('resolve', 'Decide which of several provisions governs, by fixed precedence (despite, prevails, non-discretionary standards, SEPP over LEP, specific over general). Give every candidate rule you found; the ruling comes back with a trace. Use it whenever two provisions give different answers.', {
    claims: { type: 'array', items: { type: 'object', properties: {
      ref: { type: 'string', description: 'e.g. "Housing SEPP s 168(2)(d)"' }, effect: { type: 'string', enum: ['value', 'permit', 'prohibit'] },
      value: { type: 'number' }, unit: { type: 'string' }, comparator: { type: 'string', enum: ['max', 'min'] },
      applies: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'does this provision apply to this lot and proposal' },
      condition: { type: 'string', description: 'when applies is unknown: the fact that decides it' } }, required: ['ref', 'effect', 'applies'] } } }, ['claims']),
]

const clip = (s: string, n: number) => s.length > n ? s.slice(0, n) + ' ...' : s
const show = (c: Chunk) => `### ${c.header}\n${clip(c.body, 2500)}`

export async function runAgent(C: Corpus, question: string, lot: any, opts: { maxSteps?: number } = {}) {
  const maxSteps = opts.maxSteps ?? 8
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM + '\nYou have tools to search and read the instruments. Read whole clauses before relying on them, check what overrides each clause you rely on, and when provisions conflict call resolve and follow its ruling. When you have the answer, reply with the JSON only.' },
    { role: 'user', content: `Lot facts:\n${lot ? JSON.stringify(lot, null, 1) : '(no particular lot)'}\n\nQuestion: ${question}` },
  ]
  const trace: any[] = []; let tin = 0, tout = 0, cost = 0
  const clauseChunks = (ref: string) => { const id = provisionOf(C, ref); if (!id) return null; const p = C.provs.get(id)!; return { p, chunks: C.byClause.get(`${p.document_id}|${clauseKey(p.local_id, p.path)}`) ?? [] } }
  const relLine = (r: Corpus['rels'][number], dir: 'in' | 'out') => {
    const other = C.provs.get(dir === 'in' ? r.from : (r.to ?? '')); const head = other ? (C.byProvision.get(other.id)?.[0]?.header ?? (C.byClause.get(`${other.document_id}|${clauseKey(other.local_id, other.path)}`)?.[0]?.header ?? other.local_id)) : (r.to_ref ?? '?')
    return `- ${r.kind}${r.status === 'proposed' && r.basis === 'interpretive' ? ' (interpretive, proposed)' : ''}: ${head}${r.span ? ` - "${clip(r.span, 160)}"` : ''}`
  }
  const tools: Record<string, (a: any) => Promise<string> | string> = {
    search: async a => { const hits = search(C, 'R4', a.query, await queryVec(a.query, embed), 6); return hits.map(h => show(h.chunk)).join('\n\n') || 'no results' },
    open: a => { const x = clauseChunks(a.ref); return x?.chunks.length ? x.chunks.filter(c => c.role !== 'definition').map(show).join('\n\n') : `no such provision: ${a.ref}` },
    overridden_by: a => { const x = clauseChunks(a.ref); if (!x) return `no such provision: ${a.ref}`
      const ids = new Set([...C.provs.values()].filter(p => p.document_id === x.p.document_id && clauseKey(p.local_id, p.path) === clauseKey(x.p.local_id, x.p.path)).map(p => p.id))
      const lines = C.rels.filter(r => r.to && ids.has(r.to) && ['despite', 'displaces_standard', 'prevails_over', 'disapplies', 'more_specific_than', 'subject_to'].includes(r.kind)).map(r => relLine(r, 'in'))
      const instrument = C.rels.filter(r => r.kind === 'inconsistency_rule' || (r.kind === 'subject_to' && /SEPP that prevails/i.test(r.to_ref ?? ''))).map(r => relLine(r, 'in'))
      return [...new Set(lines)].slice(0, 25).join('\n') + (instrument.length ? `\nInstrument rules:\n${[...new Set(instrument)].join('\n')}` : '') || 'nothing overrides it' },
    follow: a => { const x = clauseChunks(a.ref); if (!x) return `no such provision: ${a.ref}`
      const ids = new Set([...C.provs.values()].filter(p => p.document_id === x.p.document_id && clauseKey(p.local_id, p.path) === clauseKey(x.p.local_id, x.p.path)).map(p => p.id))
      return [...new Set(C.rels.filter(r => ids.has(r.from) && r.kind !== 'defines').map(r => relLine(r, 'out')))].slice(0, 25).join('\n') || 'no outgoing relations' },
    land_use_table: a => { const z = String(a.zone).toUpperCase().replace(/^ZONE\s+/, ''); const g = [...C.provs.values()].find(p => p.local_id === `pt-cg1.Zone_${z}`)
      return g ? (C.byClause.get(`${g.document_id}|${g.local_id}`) ?? []).map(show).join('\n\n') : `no Land Use Table entry for ${z}` },
    definition: a => { const t = String(a.term).toLowerCase(); const hits = C.chunks.filter(c => c.role === 'definition' && c.header.toLowerCase().includes(`"${t}`)).slice(0, 3); return hits.map(show).join('\n\n') || `no definition of "${a.term}"` },
    resolve: a => {
      const claims: Claim[] = []; const bad: string[] = []
      for (const [i, c] of (a.claims ?? []).entries()) {
        const id = provisionOf(C, c.ref); if (!id) { bad.push(c.ref); continue }
        claims.push({ id: `c${i}`, provision: id, effect: c.effect, value: c.value ?? null, unit: c.unit ?? null, comparator: c.comparator ?? null,
          holds: c.applies === 'yes' ? true : c.applies === 'no' ? false : null, condition: c.condition ?? null, label: c.ref })
      }
      const provs = new Map<string, Prov>([...C.provs.values()].map(p => [p.id, { id: p.id, local_id: p.local_id, path: p.path, document_id: p.document_id, doc_kind: p.doc_kind }]))
      const rels: Rel[] = C.rels.map(r => ({ kind: r.kind, from_provision: r.from, to_provision: r.to, to_document: r.to_document, to_ref: r.to_ref, status: r.status, basis: r.basis, span: r.span }))
      const r = resolve(claims, rels, provs)
      trace.push({ resolver: r })
      return JSON.stringify({ ruling: r.verdict, answer: r.answer, branches: r.branches?.map(b => ({ if: b.if, answer: b.answer })), trace: r.trace.map(s => `${s.rule}: ${s.winner} > ${s.loser} (${s.why}; ${s.basis}${s.status === 'proposed' && s.basis === 'interpretive' ? ', interpretive' : ''})`), unresolved: r.unresolved, dropped: r.dropped, unknown_refs: bad })
    },
  }
  for (let step = 0; step < maxSteps; step++) {
    const r = await chat({ messages, tools: TOOLS, maxTokens: 1200, model: MODELS.answer })
    tin += r.tokens_in; tout += r.tokens_out; cost += r.cost_usd
    messages.push(r.message)
    if (!r.tool_calls.length) {
      const ans = parseAnswer(r.content)
      const empty = ans && ans.verdict == null && ans.value == null && !ans.controlling.length
      if (ans && !empty) return { answer: ans, raw: r.content, trace, tokens_in: tin, tokens_out: tout, cost_usd: cost, steps: step + 1 }
      messages.push({ role: 'user', content: empty ? 'That answer is empty. Use the tools to find the provisions, then reply with the JSON answer.' : 'Reply with the JSON answer only, in the format given.' }); continue
    }
    for (const call of r.tool_calls) {
      let args: any = {}; try { args = JSON.parse(call.function?.arguments ?? '{}') } catch { /* keep {} */ }
      const out = await Promise.resolve(tools[call.function?.name]?.(args) ?? `unknown tool ${call.function?.name}`).catch(e => `tool error: ${String(e).slice(0, 200)}`)
      trace.push({ tool: call.function?.name, args, chars: out.length })
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function?.name, content: clip(out, 12000) })
    }
  }
  // out of steps: ask for the answer from what it has
  messages.push({ role: 'user', content: 'Stop searching. Reply now with the JSON answer only, from what you have read.' })
  const r = await chat({ messages, maxTokens: 1000, model: MODELS.answer })
  tin += r.tokens_in; tout += r.tokens_out; cost += r.cost_usd
  return { answer: parseAnswer(r.content), raw: r.content, trace, tokens_in: tin, tokens_out: tout, cost_usd: cost, steps: maxSteps + 1 }
}
