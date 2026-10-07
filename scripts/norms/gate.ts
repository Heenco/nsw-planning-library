/**
 * The norms build gate (trial): deterministic checks on a norm, whoever wrote it - a model or a person.
 *
 *   - every leaf quotes its words (`span`) and the words are in the clause, or in the context it was read with
 *     (the part's application clause, its definitions)
 *   - every fact is in the vocabulary, every value one the fact allows
 *   - every number in the clause is used by a norm, or declared a reference
 *   - every "despite" / "subject to" points at a norm that exists
 * A leaf that fails is never dropped: it becomes `unparsed`, quoted, so the norm can only come out undecided on it.
 */
import { FACTS, type Cond, type Norm } from '../../shared/norms/schema'
// @ts-expect-error - plain .mjs reader (the closed Standard Instrument land use vocabulary)
import { matchLandUses } from '../lib/si-landuse.mjs'

export const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim()

/** Uses the vocabulary allows beyond the Standard Instrument list: parts of a use, and "any development under <part>". */
const EXTRA_USES = /^(secondary dwelling|principal dwelling|dwelling|strata scheme|development|construction workers accommodation|manufactured home estate|\$proposal\.use)$/i

export function gateNorm(n: any, clauseText: string, contextText: string, ids: Set<string>): { norm: Norm; notes: string[] } {
  const notes: string[] = []
  const hay = `${clauseText}\n${contextText}`
  const fix = (c: any): Cond => {
    if (c?.all) return { all: c.all.map(fix) }
    if (c?.any) return { any: c.any.map(fix) }
    if (c?.not) return { not: fix(c.not) }
    const span = norm(c?.span)
    const reject = (why: string): Cond => {
      notes.push(`${n.id}: ${why} - kept as unparsed`)
      return { fact: 'unparsed', text: c?.text ?? (span || `${c?.fact ?? '?'}=${c?.value ?? ''}${c?.under ? '@' + c.under : ''}`), span: hay.includes(span) ? span : '' }
    }
    if (!span) return reject(`no span (${c?.fact}=${c?.value ?? ''})`)
    if (!hay.includes(span)) return reject(`span not in the clause or its context: "${span.slice(0, 80)}"`)
    const f = (FACTS as any)[c.fact]
    if (!f) return reject(`unknown fact "${c.fact}"`)
    if (c.fact === 'unparsed' || c.fact === 'discretion') return { fact: c.fact, text: c.text ?? span, span }
    if (Array.isArray(f.values) && !f.values.includes(c.value)) return reject(`${c.fact} value "${c.value}" not in the vocabulary`)
    if (f.values === 'land_use' && !EXTRA_USES.test(String(c.value)) && !((matchLandUses(String(c.value)) ?? []) as string[]).length)
      return reject(`${c.fact} value "${c.value}" is not a Standard Instrument land use`)
    if (f.values === 'zone_code' && !/^[A-Z]{1,2}\d{0,2}$/.test(String(c.value))) return reject(`zone "${c.value}" is not a zone code`)
    if (f.values === 'instrument_part' && !/^[a-z0-9-]+:(ch|pt|div|sec)\.[\w.-]+$/.test(String(c.value))) return reject(`"${c.value}" is not <slug>:<part>`)
    if (c.under && !/^[a-z0-9-]+:(ch|pt|div|sec)\.[\w.-]+$/.test(String(c.under))) return reject(`under "${c.under}" is not <slug>:<part>`)
    if (f.cmp && (!c.cmp || typeof c.n !== 'number')) return reject(`${c.fact} needs cmp and n`)
    return { fact: c.fact, value: c.value, under: c.under, cmp: c.cmp, n: c.n, text: c.text, span }
  }
  const when = fix(n.when ?? { fact: 'unparsed', text: 'no conditions given', span: '' })
  for (const d of [...(n.despite ?? []), ...(n.subjectTo ?? [])]) if (d !== 'instrument:*' && !ids.has(d)) notes.push(`${n.id}: refers to "${d}", which no norm has`)
  const then = n.then
  if (!then || !('permit' in then || 'prohibit' in then || 'require' in then)) notes.push(`${n.id}: no effect`)
  return { norm: { id: n.id, instrument: n.instrument ?? '', clause: n.clause, section: n.section, text: clauseText, when, then,
                   despite: n.despite, subjectTo: n.subjectTo, author: n.author, review: n.review, gate: notes.length ? notes : undefined }, notes }
}

/** A section's operative words: without its "Note." / "Notes. 1 ... 2 ..." (notes are not part of the provision). */
export const operative = (t: unknown) => norm(t).replace(/(^|\s)Notes?(\.|—|:)\s*[\s\S]*$/, '').trim()

/** Numbers in operative text a norm must use - references, years and dates excepted. */
export function quantities(t: string): number[] {
  const out: number[] = []
  for (const m of t.matchAll(/(?<![\w.(])(\d+(?:\.\d+)?)(?![\w)])/g)) {
    const before = t.slice(Math.max(0, m.index! - 25), m.index!)
    if (/\b(sections?|subsections?|clauses?|subclauses?|Parts?|Chapters?|Divisions?|Schedules?|s|cl|item|paragraphs?)\s*$/i.test(before)) continue
    if (/^(19|20)\d\d$/.test(m[1]!)) continue
    if (/^\d+\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(t.slice(m.index!))) continue
    out.push(Number(m[1]))
  }
  return out
}

/** Every number the norms use - leaves and standards. */
export function numbersIn(ns: Norm[]): number[] {
  const out: number[] = []
  const walk = (c: Cond) => { if ('all' in c) c.all.forEach(walk); else if ('any' in c) c.any.forEach(walk); else if ('not' in c) walk(c.not); else if (c.n != null) out.push(c.n) }
  for (const x of ns) { walk(x.when); if ('require' in x.then && x.then.require.n != null) out.push(x.then.require.n) }
  return out
}
