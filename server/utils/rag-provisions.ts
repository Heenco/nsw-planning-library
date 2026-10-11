/**
 * The words and the legislation link of every provision an explained RAG answer touches - so a trace on /report-2 can
 * quote and link each clause it names. The same query /api/rag/question uses for its provision panel.
 */
import type { Engine, Explained } from '#shared/rag/evaluate'
import { labelOf, urlOf } from '#shared/rag/refs'
import { nswQuery } from './nsw-kg/pool'

export interface RagProvision { label: string; heading: string | null; text: string; stem: string | null; url: string | null }

/** Every provision id an explained answer touches, its sub-answers included. */
export function provisionIds(x: Explained, out = new Set<string>()): Set<string> {
  for (const c of x.claims) { out.add(c.provision_id); c.subs.forEach(s => provisionIds(s, out)) }
  for (const s of [...x.steps, ...x.branches.flatMap(b => b.steps)]) for (const id of [s.winner_id, s.loser_id, s.relation_id]) if (id) out.add(id)
  for (const l of x.limits) { if (l.provision_id) out.add(l.provision_id); l.subs.forEach(s => provisionIds(s, out)) }
  return out
}

/**
 * Provisions named only in an answer's words - the frames a claim was tested under ("frame Housing SEPP s 169(2) [...]",
 * "s 164(1)") are recorded as text, not ids. Each name is looked up against the engine's own labels, so a trace can link
 * every clause it mentions, not only the claims.
 */
const labelIndex = new WeakMap<Engine, { idx: Map<string, string>; re: RegExp }>()
export function idsNamedIn(E: Engine, x: Explained, out = new Set<string>()): Set<string> {
  let li = labelIndex.get(E)
  if (!li) {
    const idx = new Map<string, string>()
    for (const id of E.provs.keys()) { const l = E.label(id); if (l && !idx.has(l)) idx.set(l, id) }
    // the plans' own short names ("Randwick LEP", "Housing SEPP"), so a match can never start at a capitalised word before one
    const plans = [...new Set([...idx.keys()].map(l => l.match(/^(.+?) (?:cl|s) /)?.[1]).filter(Boolean) as string[])]
      .sort((a, b) => b.length - a.length).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const re = new RegExp(`(?:${plans.join('|') || '$^'}) (?:cl|s) [0-9][0-9A-Za-z.]*(?:\\([0-9A-Za-z]+\\))*`, 'g')
    li = { idx, re }
    labelIndex.set(E, li)
  }
  const { idx, re } = li
  const texts: string[] = []
  const walk = (y: Explained) => {
    texts.push(y.note ?? '', ...y.notChecked, ...y.checks.map(c => `${c.text} ${c.how}`))
    for (const c of y.claims) { texts.push(...c.why); c.subs.forEach(walk) }
    for (const b of y.branches) texts.push(b.if)
    for (const s of [...y.steps, ...y.branches.flatMap(b => b.steps)]) texts.push(s.why, s.winner, s.loser)
    for (const l of y.limits) { texts.push(l.label, l.detail, l.text); l.subs.forEach(walk) }
  }
  walk(x)
  // the most specific provision named: "s 169(3)(d)", else "s 169(3)", else "s 169"
  for (const m of texts.join('\n').matchAll(re)) {
    let name = m[0]
    while (name) {
      const id = idx.get(name)
      if (id) { out.add(id); break }
      const shorter = name.replace(/\([0-9A-Za-z]+\)$/, '')
      name = shorter === name ? '' : shorter
    }
  }
  return out
}

export async function ragProvisions(ids: Iterable<string>): Promise<Record<string, RagProvision>> {
  const list = [...new Set(ids)]
  if (!list.length) return {}
  const rows = (await nswQuery<any>(`
    SELECT p.id, p.local_id, p.heading, coalesce(p.path, '{}') path, p.kind, i.kind doc_kind, i.title, i.source_url,
           left(concat_ws(' ', p.own_text, (SELECT string_agg(c.own_text, ' ' ORDER BY c.sort, c.local_id) FROM rag.provision c
             WHERE c.document_id = p.document_id AND c.local_id LIKE p.local_id || '-%' AND c.kind NOT IN ('cell', 'term'))), 1200) AS text,
           (SELECT pa.own_text FROM rag.provision pa WHERE pa.id = p.parent_id) AS stem
      FROM rag.provision p JOIN rag.instrument i USING (document_id) WHERE p.id = ANY($1::uuid[])`, [list])).rows
  return Object.fromEntries(rows.map((p: any) => [p.id, { label: labelOf(p), heading: p.heading, text: p.text, stem: p.stem, url: urlOf(p.source_url, p.local_id) }]))
}
