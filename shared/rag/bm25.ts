/**
 * RAG pilot - keyword search with a legal tokenizer (plan shared/rag-plan.ts P3.2).
 *
 * A general-purpose tokenizer breaks the tokens planning questions turn on: "4.1A(4)" becomes "4", "1a", "4"; "R2" loses
 * its zone sense; "0.65:1" and "450m2" split into bare numbers that match every clause. This one keeps them whole -
 * clause numbers (with and without their subclause), zone codes, "Area 1", "Schedule 5" / "Sch 5", "Part 4", ratios and
 * measures in one canonical unit - and stems the plain words lightly. The same function tokenizes the chunks and the
 * question, so a question that says "clause 4.1A" meets a chunk headed "4.1A".
 */

const STOP = new Set(('a an and are as at be by for from has have if in into is it its may must not of on or such that the their this to was were '
  + 'which with any other each than then there these those under being been will would can only also does do').split(' '))

const UNIT: [RegExp, string][] = [
  [/^(m2|m²|sqm|square metres?|square meters?)$/i, 'm2'],
  [/^(m|metres?|meters?)$/i, 'm'],
  [/^(ha|hectares?)$/i, 'ha'],
  [/^(%|per cent|percent)$/i, 'pct'],
]

const stem = (w: string) => w.length <= 4 ? w
  : w.endsWith('ies') ? w.slice(0, -3) + 'y'
  : w.endsWith('sses') ? w.slice(0, -2)
  : /[^s]s$/.test(w) && !w.endsWith('us') && !w.endsWith('is') ? w.slice(0, -1)
  : w

export function legalTokens(text: string): string[] {
  const out: string[] = []
  let s = ` ${text} `.replace(/[–—]/g, ' - ').replace(/[‘’“”"]/g, ' ')
  const take = (re: RegExp, f: (m: RegExpMatchArray) => string[]) => { s = s.replace(re, (...a) => { out.push(...f(a as unknown as RegExpMatchArray)); return ' ' }) }
  // ratios and measures, in one canonical unit: 0.65:1, 450m2, 9.5m, 12 metres, 30%
  take(/(\d+(?:\.\d+)?)\s*:\s*1\b/g, m => [`${m[1]}:1`])
  take(/(\d[\d,]*(?:\.\d+)?)\s*(m2|m²|sqm|square metres?|square meters?|hectares?|ha|metres?|meters?|m|per cent|percent|%)(?![\w²])/gi,
    m => { const n = m[1]!.replace(/,/g, ''); const u = UNIT.find(([r]) => r.test(m[2]!))?.[1] ?? m[2]!.toLowerCase(); return [`${n}${u}`] })
  // Schedule / Part / Chapter / Division / Area / item N
  take(/\b(Schedule|Sch|Part|Pt|Chapter|Ch|Division|Div|Area|item)\.?\s+(\d+[A-Z]?)\b/gi, m => {
    const k = ({ schedule: 'sch', sch: 'sch', part: 'part', pt: 'part', chapter: 'ch', ch: 'ch', division: 'div', div: 'div', area: 'area', item: 'item' } as Record<string, string>)[m[1]!.toLowerCase()]
    return [`${k}_${m[2]!.toLowerCase()}`]
  })
  // zone codes: R2, B4, SP2, RE1, E2, C4, MU1, IN1, RU4, W1
  take(/\b(Zone\s+)?((?:R|B|E|C|IN|RE|SP|RU|MU|W)\d[A-Z]?)\b/g, m => [`zone_${m[2]!.toLowerCase()}`])
  // clause and section numbers, with their subclauses: 4.1A, 4.1A(4)(a), s 169(2), section 3.28
  take(/\b(?:(?:clauses?|sections?|cl|s)\.?\s+)?(\d+(?:\.\d+)*[A-Z]{0,2})((?:\(\w{1,4}\))+)?(?![\w.]*\d)/g, m => {
    const base = m[1]!.toLowerCase()
    if (!/[.a-z]/.test(base) && !m[2] && !/(clause|section|cl|s)\b/i.test(m[0])) return [base]       // a bare number stays a number
    const t = [`cl_${base}`]
    if (m[2]) t.push(`cl_${base}${m[2].toLowerCase()}`)
    return t
  })
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) if (w && !STOP.has(w) && w.length > 1) out.push(stem(w))
  return out
}

export interface Bm25Doc { id: string; text: string }

/** Okapi BM25 over a few thousand chunks - in memory, built once per process. */
export class Bm25 {
  private tf: Map<string, number>[] = []
  private df = new Map<string, number>()
  private len: number[] = []
  private avg = 0
  constructor(private docs: Bm25Doc[], private k1 = 1.2, private b = 0.75) {
    for (const d of docs) {
      const m = new Map<string, number>()
      const toks = legalTokens(d.text)
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1)
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      this.tf.push(m); this.len.push(toks.length)
    }
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length)
  }
  search(query: string, k = 20): { id: string; score: number }[] {
    const q = [...new Set(legalTokens(query))], N = this.docs.length
    const scores: { id: string; score: number }[] = []
    for (let i = 0; i < N; i++) {
      let s = 0
      for (const t of q) {
        const f = this.tf[i]!.get(t); if (!f) continue
        const idf = Math.log(1 + (N - this.df.get(t)! + 0.5) / (this.df.get(t)! + 0.5))
        s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * this.len[i]! / this.avg))
      }
      if (s > 0) scores.push({ id: this.docs[i]!.id, score: s })
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, k)
  }
}
