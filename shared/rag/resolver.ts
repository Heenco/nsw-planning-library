/**
 * RAG pilot - the resolver (plan shared/rag-plan.ts P5): several rules answer one question; fixed precedence decides,
 * and writes down why. The model finds and explains; this decides.
 *
 * Pure: no database, no model. It is given
 *   claims     what each candidate provision says about the question (a figure, a permission, a prohibition) and
 *              whether it holds for this lot and proposal - true, false or null (unknown, with the condition named)
 *   relations  rag.relation rows touching those provisions or their ancestors (loadRelations below fetches them)
 *   provs      the provisions' place: local id, path, instrument and its kind
 * and returns the surviving answer, a trace of every elimination with the relation and basis that justified it, and
 * "maybe" when a condition nobody knows would change the answer - with the answer on each side of it.
 *
 * Order of precedence (each step only decides between claims that still conflict):
 *   1 explicit      the text says so: despite, prevails over, subject to, displaces_standard (s 4.15(3)), disapplies
 *   2 instrument    an instrument-level rule: Housing SEPP s 8 inconsistency, LEP 1.9 / EP&A Act s 3.28 subject-to -
 *                   only where the two cannot both be obeyed: a permission against a prohibition, or a maximum below a
 *                   minimum. Two maxima (or two minima) are not inconsistent: both bind
 *   3 specific      more_specific_than (interpretive; status 'proposed' is reported as such in the trace)
 *   4 bar           a consent bar ("development consent must not be granted for X on ...") against a permission of the
 *                   same instrument: the bar operates on top of what the zone permits, so no consent can be granted
 *   5 cumulative    two standards of the same kind from different instruments, nothing above deciding: both apply, so
 *                   the more onerous is the one that binds
 *   6 conflict      nothing decides: "maybe - conflict", never a guess
 */

export type Tri = boolean | null
export interface Claim {
  id: string                        // caller's id for the claim
  provision: string                 // rag.provision id
  effect: 'value' | 'permit' | 'prohibit'
  value?: number | null             // for 'value'
  unit?: string | null
  comparator?: 'max' | 'min' | null // a maximum (FSR, height) or a minimum (lot size): decides which is "more onerous"
  holds: Tri                        // does it apply to this lot and proposal
  condition?: string | null         // what decides it, when holds is null
  label?: string                    // "Randwick LEP 2012 4.4A(2)" for the trace
  bar?: boolean                     // a prohibition read from "development consent must not be granted"
}
export interface Rel { kind: string; from_provision: string; to_provision: string | null; to_document: string | null; to_ref: string | null; status: string; basis: string; span?: string | null }
export interface Prov { id: string; local_id: string; path: string[]; document_id: string; doc_kind: 'lep' | 'sepp' | string }
/** winner_provision / loser_provision: the provisions themselves (labels repeat); by_provision: the one that states the relation */
export interface Step { rule: string; winner: string; loser: string; by: string; basis: string; status: string; why: string
  winner_provision?: string; loser_provision?: string; by_provision?: string | null }
export interface Resolution {
  verdict: 'decided' | 'maybe' | 'none'
  answer: { effect: Claim['effect']; value?: number | null; unit?: string | null; claims: string[] } | null
  branches?: { if: string; answer: Resolution['answer']; trace: Step[] }[]
  trace: Step[]
  unresolved: string[]
  dropped: { claim: string; why: string }[]
}

const keyOf = (c: Claim) => c.effect === 'value' ? `value:${c.value}` : c.effect
const conflicting = (a: Claim, b: Claim) => keyOf(a) !== keyOf(b)

export function resolve(claims: Claim[], relations: Rel[], provs: Map<string, Prov>): Resolution {
  const unknown = claims.filter(c => c.holds === null)
  if (!unknown.length) return decide(claims, relations, provs)
  // a condition nobody knows: decide with and without each unknown group; agree -> decided, else maybe with branches
  const conds = [...new Set(unknown.map(c => c.condition ?? 'an unstated condition'))]
  const branches: NonNullable<Resolution['branches']> = []
  for (let mask = 0; mask < 1 << conds.length; mask++) {
    const on = new Set(conds.filter((_, i) => mask & (1 << i)))
    const r = decide(claims.map(c => c.holds === null ? { ...c, holds: on.has(c.condition ?? 'an unstated condition') } : c), relations, provs)
    branches.push({ if: conds.map(c => `${on.has(c) ? '' : 'not '}${c}`).join(' and '), answer: r.answer, trace: r.trace })
  }
  const same = branches.every(b => JSON.stringify(b.answer && keyOfAnswer(b.answer)) === JSON.stringify(branches[0]!.answer && keyOfAnswer(branches[0]!.answer)))
  // the unknowns do not change the answer: report the ruling and trace that rest on known facts only
  if (same) return { ...decide(claims.map(c => c.holds === null ? { ...c, holds: false } : c), relations, provs), unresolved: [] }
  return { verdict: 'maybe', answer: null, branches, trace: [], unresolved: conds, dropped: [] }
}
const keyOfAnswer = (a: NonNullable<Resolution['answer']>) => `${a.effect}:${a.value ?? ''}`

function decide(all: Claim[], relations: Rel[], provs: Map<string, Prov>): Resolution {
  const dropped = all.filter(c => c.holds === false).map(c => ({ claim: c.id, why: 'does not apply to this lot or proposal' }))
  let live = all.filter(c => c.holds !== false)
  const trace: Step[] = []
  const P = (c: Claim) => provs.get(c.provision)
  const label = (c: Claim) => c.label ?? P(c)?.local_id ?? c.provision
  /** does a relation end (a provision id) cover this claim: the claim's provision or one of its ancestors */
  const covers = (provId: string | null, c: Claim) => {
    if (!provId) return false
    if (provId === c.provision) return true
    const target = provs.get(provId), p = P(c)
    return !!target && !!p && p.document_id === target.document_id && (p.path ?? []).includes(target.local_id)
  }
  const inClauseOf = (provId: string, c: Claim) => {
    const f = provs.get(provId), p = P(c); if (!f || !p || f.document_id !== p.document_id) return false
    const cl = f.local_id.split('-')[0]!
    return p.local_id === cl || p.local_id.startsWith(cl + '-')
  }
  const sameDoc = (a: Claim, b: Claim) => P(a)?.document_id === P(b)?.document_id
  const eliminate = (loser: Claim, winner: Claim, rule: string, r: Rel | null, why: string) => {
    live = live.filter(x => x.id !== loser.id)
    trace.push({ rule, winner: label(winner), loser: label(loser), by: r ? `${r.kind}${r.span ? ` "${r.span.slice(0, 80)}"` : ''}` : rule, basis: r?.basis ?? 'rule', status: r?.status ?? 'rule', why,
      winner_provision: winner.provision, loser_provision: loser.provision, by_provision: r?.from_provision ?? null })
  }
  const more = (a: Claim, b: Claim) => a.effect === 'value' && b.effect === 'value' && a.comparator && a.value != null && b.value != null
    ? (a.comparator === 'max' ? a.value < b.value : a.value > b.value) : true   // a is more onerous than b

  type Test = (a: Claim, b: Claim) => { rel: Rel | null; why: string } | null
  // 1 explicit: a beats b
  const explicit: Test = (a, b) => {
    for (const r of relations) {
      // "Despite ... another environmental planning instrument" is said once, in its own subclause, for the whole clause
      const epiWide = r.kind === 'despite' && !r.to_provision && !r.to_document && /environmental planning instrument/i.test(r.to_ref ?? '')
      if (!(epiWide ? inClauseOf(r.from_provision, a) : covers(r.from_provision, a))) continue
      if (['despite', 'prevails_over', 'displaces_standard', 'disapplies'].includes(r.kind) && covers(r.to_provision, b))
        return { rel: r, why: r.kind === 'displaces_standard' ? 'a non-discretionary standard: a more onerous standard cannot be required (EP&A Act s 4.15(3))' : `${r.kind.replace('_', ' ')} the other provision` }
      if (r.kind === 'despite' && !r.to_provision && !r.to_document && /environmental planning instrument/i.test(r.to_ref ?? '') && !sameDoc(a, b))
        return { rel: r, why: 'applies despite another environmental planning instrument' }
      if (r.kind === 'despite' && !r.to_provision && r.to_document && r.to_document === P(b)?.document_id && sameDoc(a, b))
        return { rel: r, why: 'applies despite any other provision of this instrument' }
    }
    for (const r of relations) if (r.kind === 'subject_to' && covers(r.from_provision, b) && covers(r.to_provision, a)) return { rel: r, why: 'the other provision is subject to this one' }
    return null
  }
  /** can a and b not both be obeyed: permit vs prohibit, or a maximum below a minimum */
  const inconsistent = (a: Claim, b: Claim) => a.effect !== 'value' || b.effect !== 'value' ? a.effect !== b.effect
    : a.comparator !== b.comparator && a.value != null && b.value != null && (a.comparator === 'max' ? a.value < b.value : b.value < a.value)
  // 2 instrument: a SEPP prevails over an LEP to the extent of the inconsistency (Housing SEPP s 8; LEP 1.9 / s 3.28)
  const instrument: Test = (a, b) => {
    if (P(a)?.doc_kind !== 'sepp' || P(b)?.doc_kind !== 'lep' || !inconsistent(a, b)) return null
    const rule = relations.find(r => r.kind === 'inconsistency_rule' && provs.get(r.from_provision)?.document_id === P(a)?.document_id)
      ?? relations.find(r => r.kind === 'subject_to' && /SEPP that prevails/i.test(r.to_ref ?? '') && provs.get(r.from_provision)?.document_id === P(b)?.document_id)
    return rule ? { rel: rule, why: 'a SEPP prevails over the LEP to the extent of the inconsistency' } : null
  }
  // 3 specific over general
  const specific: Test = (a, b) => {
    const r = relations.find(r => r.kind === 'more_specific_than' && covers(r.from_provision, a) && covers(r.to_provision, b))
    return r ? { rel: r, why: 'the more specific provision governs the general one' } : null
  }
  // 4 bar: a consent bar and a permission of the same instrument - the permission is not lost, but consent cannot be granted
  const bar: Test = (a, b) => a.effect === 'prohibit' && a.bar && b.effect === 'permit' && sameDoc(a, b)
    ? { rel: null, why: 'development consent must not be granted for it here: the bar applies on top of what the zone permits' } : null
  // 5 cumulative: two maxima or two minima from different instruments - both can be met, so both bind
  const cumulative: Test = (a, b) => a.effect === 'value' && b.effect === 'value' && a.comparator && a.comparator === b.comparator && !sameDoc(a, b) && more(a, b)
    ? { rel: null, why: `both apply - neither instrument displaces the other and they are not inconsistent - so the more onerous ${a.comparator === 'max' ? 'maximum' : 'minimum'} binds` } : null

  for (const [rule, test] of [['explicit', explicit], ['instrument', instrument], ['specific', specific], ['bar', bar], ['cumulative', cumulative]] as [string, Test][]) {
    let changed = true
    while (changed) {
      changed = false
      pairs: for (const a of live) for (const b of live) {
        if (a === b || !conflicting(a, b)) continue
        const hit = test(a, b)
        // a non-discretionary standard is a safe harbour, not a cap: it displaces only a MORE onerous standard, and where
        // the other standard is less onerous (an R3 map of 0.75:1 against 0.65:1) that one still permits more and governs
        if (hit && hit.rel?.kind === 'displaces_standard' && !more(b, a)) {
          eliminate(a, b, rule, hit.rel, 'a non-discretionary standard limits what may be required, not what may be permitted: the less onerous standard governs (EP&A Act s 4.15(3))')
          changed = true; break pairs
        }
        if (hit) { eliminate(b, a, rule, hit.rel, hit.why); changed = true; break pairs }
      }
    }
  }
  const groups = new Map<string, Claim[]>()
  for (const c of live) groups.set(keyOf(c), [...(groups.get(keyOf(c)) ?? []), c])
  if (!live.length) return { verdict: 'none', answer: null, trace, unresolved: [], dropped }
  if (groups.size > 1) return { verdict: 'maybe', answer: null, trace, unresolved: [...groups.values()].map(g => `${g.map(label).join(', ')}: ${keyOf(g[0]!)}`), dropped }
  const win = [...groups.values()][0]!
  return { verdict: 'decided', answer: { effect: win[0]!.effect, value: win[0]!.value ?? null, unit: win[0]!.unit ?? null, claims: win.map(c => c.id) }, trace, unresolved: [], dropped }
}

/** relations touching these provisions or any of their ancestors, plus the instrument-level rules */
export async function loadRelations(query: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>, provIds: string[]) {
  const provs = new Map<string, Prov>((await query(`
    WITH RECURSIVE up AS (SELECT p.id FROM rag.provision p WHERE p.id = ANY($1::uuid[]) UNION SELECT p.parent_id FROM rag.provision p JOIN up ON p.id = up.id WHERE p.parent_id IS NOT NULL)
    SELECT p.id, p.local_id, coalesce(p.path, '{}') path, p.document_id, i.kind doc_kind FROM rag.provision p JOIN rag.instrument i USING (document_id) WHERE p.id IN (SELECT id FROM up)`, [provIds])).rows.map(r => [r.id, r]))
  const ids = [...provs.keys()]
  const relations: Rel[] = (await query(`
    SELECT kind, from_provision, to_provision, to_document, to_ref, status, basis, span FROM rag.relation
     WHERE kind NOT IN ('part_of', 'next', 'refers_to', 'defines')
       AND (from_provision = ANY($1::uuid[]) OR to_provision = ANY($1::uuid[]) OR kind = 'inconsistency_rule' OR (kind = 'subject_to' AND to_ref ILIKE '%SEPP that prevails%'))`, [ids])).rows
  for (const r of relations) for (const id of [r.from_provision, r.to_provision]) if (id && !provs.has(id)) {
    const x = (await query(`SELECT p.id, p.local_id, coalesce(p.path, '{}') path, p.document_id, i.kind doc_kind FROM rag.provision p JOIN rag.instrument i USING (document_id) WHERE p.id = $1`, [id])).rows[0]
    if (x) provs.set(x.id, x)
  }
  return { relations, provs }
}
