/**
 * RAG pilot - answering and the automatic checks (plan shared/rag-plan.ts P6.2 / P6.3).
 *
 * One answer shape for every variant, so they can be scored alike:
 *   verdict      yes | no | maybe | null (null for a question that asks for a figure or a text)
 *   value/unit   the figure, when one is asked for; values_if when it depends on a fact nobody gave
 *   controlling  the provisions the answer rests on, cited by instrument and clause
 *   quotes       the exact words relied on, each with its citation
 *   unknowns     facts the answer depends on that were not given
 *
 * The checks need no model: every cited provision exists; every quote is verbatim in the provision it is cited to;
 * the figure appears in a cited provision (the check that catches "225 m2, cl 4.1A(4)(a)"); and an override the answer
 * did not address (an incoming despite / displaces_standard / prevails edge on a cited clause from a clause not cited).
 */
import { provisionOf, subtreeText, clauseKey, type Corpus, type Chunk } from './retrieve'

export interface Answer {
  verdict: 'yes' | 'no' | 'maybe' | null; value: number | null; unit: string | null; values_if?: { if: string; value: number }[]
  controlling: string[]; quotes: { cite: string; text: string }[]; unknowns: string[]; reasoning: string
}

export const SYSTEM = `You answer questions about NSW planning law for one lot, from the provisions you are given: Randwick Local Environmental Plan 2012 (the LEP) and parts of State Environmental Planning Policy (Housing) 2021 (the Housing SEPP).
Rules:
- Use only the provisions and lot facts provided. Do not rely on outside knowledge of these instruments.
- Several provisions may answer the same question. Work out which one governs: a provision that applies "despite" another, a SEPP that prevails over the LEP, a non-discretionary development standard, a more specific provision over a general one. Say which and why.
- If the answer depends on a fact you were not given (a date, a proposal detail, a map you cannot see), the verdict is "maybe": list the unknown facts, and give the answer for each case in values_if when it is a figure.
- If the provisions given do not settle the question, say "maybe" and explain - never guess.
- Cite provisions as "<instrument> <clause>", e.g. "Randwick LEP 2012 cl 4.4A(2)" or "Housing SEPP s 168(2)(d)".
- Quotes must be copied exactly, word for word, from the provision cited.
Reply with JSON only:
{"verdict": "yes" | "no" | "maybe" | null, "value": number | null, "unit": string | null, "values_if": [{"if": string, "value": number}], "controlling": [string], "quotes": [{"cite": string, "text": string}], "unknowns": [string], "reasoning": string}
verdict: for "is X permissible" yes = permissible (with or without consent), no = prohibited; for "can it be subdivided" yes/no; null when the question only asks for a figure or a description.`

const shortDoc = (c: Chunk) => c.doc_kind === 'sepp' ? 'Housing SEPP 2021' : 'Randwick LEP 2012'
const clauseLabel = (c: Chunk) => c.clause.replace(/^sec\./, c.doc_kind === 'sepp' ? 's ' : 'cl ').replace(/^pt-cg1\.Zone_/, 'Land Use Table, Zone ').replace(/^sch\./, 'Sch ')

/** how a chunk is shown to the model: R0 with its instrument and clause only, R1+ with the full structural header */
export function showChunk(c: Chunk, variant: string, why?: string): string {
  const head = variant === 'R0' ? `${shortDoc(c)} ${clauseLabel(c)}` : c.header
  return `### ${head}${why ? `  [${why}]` : ''}\n${c.body}`
}

export function userPrompt(question: string, lot: any, context: string): string {
  return `Lot facts:\n${lot ? JSON.stringify(lot, null, 1) : '(no particular lot)'}\n\nProvisions:\n${context}\n\nQuestion: ${question}`
}

export function parseAnswer(raw: string): Answer | null {
  const m = raw.match(/\{[\s\S]*\}/); if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const v = String(j.verdict ?? '').toLowerCase()
    return { verdict: (['yes', 'no', 'maybe'].includes(v) ? v : null) as Answer['verdict'], value: j.value == null || j.value === '' ? null : Number(String(j.value).replace(/:1$/, '')),
      unit: j.unit ?? null, values_if: Array.isArray(j.values_if) ? j.values_if.filter((x: any) => x && x.value != null).map((x: any) => ({ if: String(x.if), value: Number(String(x.value).replace(/:1$/, '')) })) : [],
      controlling: (j.controlling ?? []).map(String), quotes: (j.quotes ?? []).filter((x: any) => x?.text).map((x: any) => ({ cite: String(x.cite ?? ''), text: String(x.text) })),
      unknowns: (j.unknowns ?? []).map(String), reasoning: String(j.reasoning ?? '') }
  } catch { return null }
}

const normText = (s: string) => s.toLowerCase().replace(/[‘’“”"']/g, '').replace(/[–—-]/g, '-').replace(/\s+/g, ' ').replace(/\s*([,;:.()])\s*/g, '$1').trim()
const figureIn = (v: number, text: string) => new RegExp(`(?<![\\d.])${String(v).replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(text.replace(/(\d),(\d{3})/g, '$1$2'))

export function checks(C: Corpus, a: Answer) {
  const cited = a.controlling.map(r => ({ ref: r, id: provisionOf(C, r) }))
  const citedIds = cited.map(c => c.id).filter(Boolean) as string[]
  const citedText = citedIds.map(id => normText(subtreeText(C, id))).join(' || ')
  const quotes = a.quotes.map(qu => {
    const id = provisionOf(C, qu.cite); const t = normText(qu.text)
    return { cite: qu.cite, found_cited: !!id && normText(subtreeText(C, id)).includes(t), found_anywhere: t.length > 12 && [...C.provs.values()].some(p => normText(p.own_text).includes(t)) }
  })
  const figure = a.value == null ? null : figureIn(a.value, citedIds.map(id => subtreeText(C, id)).join(' '))
  // overrides on a cited clause from a clause the answer did not cite
  const citedClauses = new Set(citedIds.map(id => { const p = C.provs.get(id)!; return `${p.document_id}|${clauseKey(p.local_id, p.path)}` }))
  const unaddressed = new Set<string>()
  for (const r of C.rels) {
    if (!['despite', 'displaces_standard', 'prevails_over'].includes(r.kind) || !r.to) continue
    const to = C.provs.get(r.to), from = C.provs.get(r.from); if (!to || !from) continue
    const toKey = `${to.document_id}|${clauseKey(to.local_id, to.path)}`, fromKey = `${from.document_id}|${clauseKey(from.local_id, from.path)}`
    if (citedClauses.has(toKey) && !citedClauses.has(fromKey)) unaddressed.add(`${from.doc_kind === 'sepp' ? 'Housing ' : 'LEP '}${clauseKey(from.local_id, from.path)} ${r.kind} ${clauseKey(to.local_id, to.path)}`)
  }
  return {
    cites: cited.length, cites_resolved: cited.filter(c => c.id).length, unresolved_cites: cited.filter(c => !c.id).map(c => c.ref),
    quotes: quotes.length, quotes_verbatim_cited: quotes.filter(q => q.found_cited).length, quotes_verbatim_anywhere: quotes.filter(q => q.found_anywhere).length,
    figure_in_cited: figure, unaddressed_overrides: [...unaddressed].slice(0, 12),
    maybe_without_unknowns: a.verdict === 'maybe' && !a.unknowns.length,
    cited_text_chars: citedText.length,
  }
}
