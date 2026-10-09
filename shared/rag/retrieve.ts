/**
 * RAG pilot - retrieval over schema rag (plan shared/rag-plan.ts P6): the corpus in memory, hybrid search per variant,
 * relation expansion, and clause references read back into provisions.
 *
 *   R0  plain        BM25 over the words + the 'plain' embedding, fused (reciprocal rank)
 *   R1  structural   BM25 over header + words + the 'structural' embedding
 *   R2  contextual   BM25 over model context + header + words + the 'contextual' embedding
 *   R3  relations    R2, then each hit pulls in what overrides it (incoming despite / displaces_standard / prevails /
 *                    disapplies / more_specific_than), the frame that limits it (applies_only_if) and the instrument rule
 */
import { Bm25 } from './bm25'
import { instrumentOf, shortName, type Inst } from './refs'

export type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>
export interface Chunk { id: string; provision_id: string; role: string; header: string; body: string; llm_context: string | null; local_id: string; document_id: string; doc_kind: string; doc_title: string; path: string[]; clause: string }
export interface Corpus {
  chunks: Chunk[]; byId: Map<string, Chunk>; byProvision: Map<string, Chunk[]>; byClause: Map<string, Chunk[]>
  vec: Record<string, Map<string, Float32Array>>; bm25: Record<string, Bm25>
  rels: { kind: string; from: string; to: string | null; to_document: string | null; to_ref: string | null; status: string; basis: string; span: string | null }[]
  provs: Map<string, { id: string; local_id: string; document_id: string; doc_kind: string; path: string[]; parent_id: string | null; own_text: string }>
  insts: Inst[]
}

/** "Housing SEPP 2021", "Randwick LEP 2012" */
export const docLabel = (title: string) => `${shortName(title)} ${title.match(/\d{4}$/)?.[0] ?? ''}`.trim()

/** the top-level unit a provision belongs to - "sec.4.4A", "sec.168", "sch.1-sec.7", a Land Use Table zone group */
export const clauseKey = (local: string, path: string[] = []) => {
  if (local.startsWith('pt-cg')) return local
  const grp = path.find(p => p.startsWith('pt-cg')); if (grp) return grp
  const m = local.match(/^(sch\.[^-#]+-sec[^-#]*\.[^-#]+|sch\.[^-#]+|sec\.[^-#]+|dict)/); return m ? m[1]! : local.split(/[-#]/)[0]!
}

const vecOf = (s: string) => Float32Array.from(JSON.parse(s) as number[])
const cos = (a: Float32Array, b: Float32Array) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]! } return d / Math.sqrt(x * y) }

export async function loadCorpus(q: Query, model = 'BAAI/bge-en-icl'): Promise<Corpus> {
  const chunks: Chunk[] = (await q(`SELECT c.id, c.provision_id, c.role, c.header, c.body, c.llm_context, p.local_id, p.document_id, i.kind doc_kind, i.title doc_title, coalesce(p.path, '{}') path
                                      FROM rag.chunk c JOIN rag.provision p ON p.id = c.provision_id JOIN rag.instrument i ON i.document_id = p.document_id`)).rows
    .map(c => ({ ...c, clause: clauseKey(c.local_id, c.path) }))
  const byId = new Map(chunks.map(c => [c.id, c]))
  const byProvision = new Map<string, Chunk[]>(), byClause = new Map<string, Chunk[]>()
  for (const c of chunks) {
    byProvision.set(c.provision_id, [...(byProvision.get(c.provision_id) ?? []), c])
    const k = `${c.document_id}|${c.clause}`; byClause.set(k, [...(byClause.get(k) ?? []), c])
  }
  const vec: Corpus['vec'] = { plain: new Map(), structural: new Map(), contextual: new Map() }
  for (const r of (await q(`SELECT chunk_id, variant, vec::text v FROM rag.embedding WHERE model = $1`, [model])).rows) vec[r.variant]?.set(r.chunk_id, vecOf(r.v))
  const bm25 = {
    plain: new Bm25(chunks.map(c => ({ id: c.id, text: c.body }))),
    structural: new Bm25(chunks.map(c => ({ id: c.id, text: `${c.header}\n${c.body}` }))),
    contextual: new Bm25(chunks.map(c => ({ id: c.id, text: `${c.llm_context ?? ''}\n${c.header}\n${c.body}` }))),
  }
  const rels = (await q(`SELECT kind, from_provision "from", to_provision "to", to_document, to_ref, status, basis, span FROM rag.relation WHERE kind NOT IN ('part_of', 'next', 'refers_to')`)).rows
  const provs = new Map((await q(`SELECT p.id, p.local_id, p.document_id, i.kind doc_kind, coalesce(p.path, '{}') path, p.parent_id, coalesce(p.own_text, '') own_text
                                    FROM rag.provision p JOIN rag.instrument i USING (document_id)`)).rows.map(r => [r.id, r]))
  const insts: Inst[] = (await q(`SELECT document_id, kind, title FROM rag.instrument`)).rows
  return { chunks, byId, byProvision, byClause, vec, bm25, rels, provs, insts }
}

export const VARIANT_INDEX: Record<string, 'plain' | 'structural' | 'contextual'> = { R0: 'plain', R1: 'structural', R2: 'contextual', R3: 'contextual', R4: 'contextual' }

/** hybrid search: BM25 and cosine ranks fused by reciprocal rank (k = 60), definitions down-weighted unless asked for */
export function search(C: Corpus, variant: string, query: string, qvec: Float32Array, k = 8): { chunk: Chunk; score: number; why: string }[] {
  const idx = VARIANT_INDEX[variant] ?? 'contextual'
  const lex = C.bm25[idx]!.search(query, 60)
  const sem = [...C.vec[idx]!.entries()].map(([id, v]) => ({ id, s: cos(qvec, v) })).sort((a, b) => b.s - a.s).slice(0, 60)
  const fused = new Map<string, number>()
  lex.forEach((x, i) => fused.set(x.id, (fused.get(x.id) ?? 0) + 1 / (60 + i)))
  sem.forEach((x, i) => fused.set(x.id, (fused.get(x.id) ?? 0) + 1 / (60 + i)))
  return [...fused.entries()].map(([id, s]) => ({ chunk: C.byId.get(id)!, score: s * (C.byId.get(id)!.role === 'definition' && !/\bmean|defin/i.test(query) ? 0.7 : 1), why: 'hybrid' }))
    .sort((a, b) => b.score - a.score).slice(0, k)
}

const OVERRIDE_IN = ['despite', 'displaces_standard', 'prevails_over', 'disapplies', 'more_specific_than', 'subject_to']
/** R3: what overrides or frames each hit - the edges a reader would follow - added after the hits, deduplicated */
export function expand(C: Corpus, hits: Chunk[], limit = 8): { chunk: Chunk; why: string }[] {
  const have = new Set(hits.map(h => h.id)), out: { chunk: Chunk; why: string }[] = []
  const clauseIds = (c: Chunk) => new Set([c.provision_id, ...[...C.provs.values()].filter(p => p.document_id === c.document_id && clauseKey(p.local_id, p.path) === c.clause).map(p => p.id)])
  const add = (provId: string | null, why: string) => {
    if (!provId || out.length >= limit) return
    const p = C.provs.get(provId); if (!p) return
    for (const ch of C.byClause.get(`${p.document_id}|${clauseKey(p.local_id, p.path)}`) ?? []) if (!have.has(ch.id) && ch.role !== 'definition') { have.add(ch.id); out.push({ chunk: ch, why }); break }
  }
  for (const h of hits) {
    if (h.role === 'definition') continue
    const ids = clauseIds(h)
    for (const r of C.rels) {
      if (r.to && ids.has(r.to) && OVERRIDE_IN.includes(r.kind)) add(r.from, `${r.kind} -> ${h.clause}`)
      // and what the hit itself overrides: a reader of 4.4A needs the 4.4 map rule it departs from
      if (ids.has(r.from) && r.to && OVERRIDE_IN.includes(r.kind) && r.kind !== 'subject_to') add(r.to, `${h.clause} ${r.kind} it`)
      if (r.kind === 'applies_only_if' && ids.has(r.from) && r.to) add(r.to, `frame of ${h.clause}`)
      if (r.kind === 'subject_to' && ids.has(r.from) && r.to) add(r.to, `${h.clause} is subject to it`)
    }
  }
  // the instrument rule, once, if both instruments are in play
  if (new Set([...hits, ...out.map(o => o.chunk)].map(c => c.doc_kind)).size > 1) for (const r of C.rels) if (r.kind === 'inconsistency_rule') add(r.from, 'instrument rule')
  return out
}

/** "Randwick LEP 2012 cl 4.4A(2)", "s 168(2)(d)", "Housing SEPP section 169(3)(d)", "Land Use Table, Zone R2" -> a provision */
export function provisionOf(C: Corpus, ref: string, hint?: 'lep' | 'sepp'): string | null {
  // the instrument: named in the citation, else the hint, else by how it numbers ("s 168" is a section, "cl 4.4A" a clause)
  const inst = instrumentOf(ref, C.insts, hint ?? (/\bs(ection)?\.?\s*\d{2,3}\b/i.test(ref) && !/\d\.\d/.test(ref) ? 'sepp' : 'lep'))
  if (!inst) return null
  // the instrument's name and year are not the clause: "Housing SEPP 2021 s 168(2)(e)" is s 168, not s 2021
  ref = ref.replace(/\(([A-Za-z][A-Za-z ,&-]{3,})\)/g, ' $1 ').replace(/\b(19|20)\d{2}\b/g, ' ')
  const kind = inst.kind, doc = inst.document_id
  const byLocal = (local: string) => [...C.provs.values()].find(p => p.document_id === doc && p.local_id === local)?.id ?? null
  const zone = ref.match(/Land Use Table.*?\b(R\d|RE\d|B\d|E\d|SP\d|C\d|MU\d|IN\d|RU\d|W\d)\b/i) ?? ref.match(/\bZone\s+(R\d|RE\d|B\d|E\d|SP\d|C\d|MU\d|IN\d|RU\d|W\d)\b.*Land Use Table/i)
  if (zone && kind === 'lep') return byLocal(`pt-cg1.Zone_${zone[1]!.toUpperCase()}`)
  const sch = ref.match(/\bSch(?:edule)?\.?\s*(\d+[A-Z]?)(?:[,\s]+(?:s|section|cl|clause)\.?\s*(\d+[A-Z]?))?/i)
  if (sch) return byLocal(sch[2] ? `sch.${sch[1]}-sec.${sch[2]}` : `sch.${sch[1]}`) ?? byLocal(`sch.${sch[1]}`)
  const m = ref.match(/(?:cl(?:ause)?|s(?:ection)?|§)?\.?\s*(\d+(?:\.\d+)*[A-Z]{0,3})((?:\s*\(\w{1,4}\))*)/i); if (!m) return null
  const parts = [...m[2]!.matchAll(/\((\w+)\)/g)].map(x => x[1]!)
  const ids = [`sec.${m[1]}`]
  if (parts[0]) ids.push(`${ids[0]}-ssec.${parts[0]}`)
  if (parts[1]) ids.push(`${ids[1]}-para1.${parts[1]}`)
  if (parts[2]) ids.push(`${ids[2]}-para2.${parts[2]}`)
  for (const id of ids.reverse()) { const hit = byLocal(id); if (hit) return hit }
  return null
}

/** an answer-key citation "<instrument word>:<clause>" ("housing:s 168(2)(d)", "lep:cl 4.4") -> a provision */
export const keyedProvision = (C: Corpus, key: string) => { const i = key.indexOf(':'); return i < 0 ? provisionOf(C, key) : provisionOf(C, `${key.slice(0, i)} ${key.slice(i + 1)}`) }

/** the words of a provision and everything under it - what a quote or a figure must be found in */
export function subtreeText(C: Corpus, provId: string): string {
  const p = C.provs.get(provId); if (!p) return ''
  const out = [p.own_text]
  for (const x of C.provs.values()) if (x.document_id === p.document_id && (x.path ?? []).includes(p.local_id)) out.push(x.own_text)
  return out.join(' ')
}

/** query embedding, cached per process */
const qcache = new Map<string, Float32Array>()
export async function queryVec(text: string, embed: (t: string[], o: { query: boolean }) => Promise<{ vecs: number[][] }>) {
  if (!qcache.has(text)) qcache.set(text, Float32Array.from((await embed([text], { query: true })).vecs[0]!))
  return qcache.get(text)!
}
