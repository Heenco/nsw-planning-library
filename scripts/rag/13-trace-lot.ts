/**
 * RAG pilot - the deterministic path for one question, no model anywhere (variant D).
 *
 *   npx tsx scripts/rag/13-trace-lot.ts --cadid 100142195 --topic fsr --use "dual occupancies (attached)"
 *   npx tsx scripts/rag/13-trace-lot.ts --cadid 100142195 --topic permissibility --use "dual occupancies"
 *
 *   1 retrieval   BM25 (legal tokens) over the deterministic headers + text - no embedding, no model-written context
 *   2 expansion   rag.relation: what overrides each hit, what it overrides, the frame that limits it
 *   3 claims      the CDC pilot's propositions (pilot.proposition + pilot.scope, a deterministic extraction) in the
 *                 retrieved clauses, on the asked topic
 *   4 applies?    each claim's own scope and its clause's "applies" frames tested against the lot's frozen facts
 *                 (rag.question.lot_facts); a term no fact answers stays unknown - it is never guessed
 *   5 ruling      shared/rag/resolver.ts over rag.relation
 * Prints every step. Nothing here names a clause; the one binding from a scope term to a lot fact is TERM_FACTS below.
 */
import 'dotenv/config'
import pg from 'pg'
import { loadCorpus, expand, clauseKey, type Chunk } from '../../shared/rag/retrieve'
import { resolve, type Claim, type Rel, type Prov } from '../../shared/rag/resolver'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d }
const CADID = arg('--cadid'), TOPIC = arg('--topic', 'fsr'), USE = arg('--use', 'dual occupancies').toLowerCase()
/** what is proposed - a fact of the question, like the use: 'development' (erecting a building) or 'subdivision' (with --tenure) */
const PROPOSAL = arg('--proposal', 'development').toLowerCase(), TENURE = arg('--tenure', '').toLowerCase()

/** scope terms the lot facts can answer: term -> fact test (true / false / null). Everything else is unknown. */
const TERM_FACTS: Record<string, (l: any) => boolean | null> = {
  'low and mid rise housing area': l => l.low_mid_rise_area?.band ? l.low_mid_rise_area.class !== 'excluded' : false,
  'heritage item': l => l.heritage == null ? false : /item/i.test(l.heritage),
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const lot = (await q(`SELECT lot_facts FROM rag.question WHERE cadid = $1 AND lot_facts IS NOT NULL LIMIT 1`, [CADID])).rows[0]?.lot_facts
  if (!lot) throw new Error(`no frozen lot facts for ${CADID}`)
  const C = await loadCorpus(q)
  const question = TOPIC === 'permissibility' ? `Is development for the purposes of ${USE} permissible in Zone ${lot.zone}?`
    : `maximum ${TOPIC === 'fsr' ? 'floor space ratio' : TOPIC === 'height' ? 'building height' : 'minimum lot size'} for ${USE} in Zone ${lot.zone}`
  console.log(`LOT  ${lot.address} | ${lot.lot} | ${lot.area_m2} m2 | Zone ${lot.zone} | FSR map ${lot.fsr_map} | HOB map ${lot.height_map_m} | LSZ map ${lot.lot_size_map_m2} | LMR ${lot.low_mid_rise_area?.band ?? 'none'} ${lot.low_mid_rise_area?.class ?? ''} | heritage ${lot.heritage ?? 'none'}`)
  console.log(`QUERY  ${question}\n`)

  // 1 + 2: retrieval without a model, then the relation graph
  const hits = C.bm25.structural.search(question, 8).map(h => C.byId.get(h.id)!).filter(c => c.role !== 'definition')
  const extra = expand(C, hits, 8)
  console.log('1 RETRIEVED (BM25, deterministic headers):'); for (const h of hits) console.log('   ', h.header.slice(0, 120))
  console.log('2 PULLED IN BY RELATIONS:'); for (const e of extra) console.log('   ', e.chunk.header.slice(0, 100), ` [${e.why}]`)
  const clauses = new Set([...hits, ...extra.map(e => e.chunk)].map((c: Chunk) => `${c.doc_kind}|${c.clause}`))

  // 3: the pilot's propositions in those clauses
  const docKind: Record<string, string> = Object.fromEntries((await q(`SELECT i.kind, d.id FROM rag.instrument i JOIN nsw.document d ON d.title = i.title`)).rows.map(r => [r.id, r.kind]))
  const props = (await q(`
    SELECT p.id, n.local_id, n.document_id, p.modality, p.topic, p.comparator, p.value, p.unit, p.condition_metric, p.condition_lo, p.condition_hi,
           coalesce(json_agg(json_build_object('dim', sc.dimension, 'value', sc.value, 'polarity', sc.polarity, 'alt', sc.alt_group)) FILTER (WHERE sc.id IS NOT NULL), '[]') scope
      FROM pilot.proposition p JOIN pilot.node n ON n.id = p.node_id LEFT JOIN pilot.scope sc ON sc.proposition_id = p.id
     WHERE n.document_id = ANY($1::uuid[]) GROUP BY p.id, n.local_id, n.document_id`, [Object.keys(docKind)])).rows
    .map(p => ({ ...p, kind: docKind[p.document_id], clause: clauseKey(p.local_id) }))
  const inScope = props.filter(p => clauses.has(`${p.kind}|${p.clause}`))

  // 4: does it apply to this lot and use?
  const useHit = (v: string) => { const a = v.toLowerCase().replace(/ies\b/g, 'y').replace(/s\b/g, ''), b = USE.replace(/ies\b/g, 'y').replace(/s\b/g, ''); return a.includes(b) || b.includes(a) }
  const testScope = (scope: any[], why: string[]): boolean | null => {
    let out: boolean | null = true
    const byDim = new Map<string, any[]>(); for (const s of scope) byDim.set(s.dim, [...(byDim.get(s.dim) ?? []), s])
    for (const [dim, ss] of byDim) {
      let r: boolean | null
      if (dim === 'zone') r = ss.some(s => s.value.toUpperCase() === String(lot.zone).toUpperCase())
      else if (dim === 'land_use') r = ss.some(s => useHit(s.value))
      else if (dim === 'dev_type') r = ss.some(s => s.value.toLowerCase() === PROPOSAL || (s.value.toLowerCase() === 'development' && PROPOSAL !== 'subdivision'))
      else if (dim === 'tenure') r = PROPOSAL !== 'subdivision' ? false : TENURE ? ss.some(s => s.value.toLowerCase() === TENURE) : null
      else { const t = ss.map(s => TERM_FACTS[s.value.toLowerCase()]?.(lot) ?? null); r = t.includes(true) ? true : t.every(x => x === false) ? false : null }
      why.push(`${dim}=${ss.map(s => s.value).join('|')}: ${r == null ? 'unknown' : r}`)
      if (r === false) out = false; else if (r == null && out !== false) out = null
    }
    return out
  }
  const frames = (p: any) => props.filter(f => f.modality === 'applies' && f.document_id === p.document_id && f.clause === p.clause)
  const holds = (p: any) => {
    const why: string[] = []
    let h = testScope(p.scope, why)
    if (p.condition_metric === 'lot_size' && lot.area_m2 != null) {
      const ok = (p.condition_lo == null || lot.area_m2 >= Number(p.condition_lo)) && (p.condition_hi == null || lot.area_m2 < Number(p.condition_hi))
      why.push(`lot size ${lot.area_m2} in [${p.condition_lo ?? ''}, ${p.condition_hi ?? ''}): ${ok}`); if (!ok) h = false
    }
    // the clause's frames: list items under one stem are alternatives (any), separate stems all apply
    const fr = frames(p); const stems = new Map<string, any[]>()
    for (const f of fr) { const stem = f.local_id.replace(/-para\d\.[^-]+$/, ''); stems.set(stem, [...(stems.get(stem) ?? []), f]) }
    for (const [stem, fs] of stems) {
      const res = fs.map(f => testScope(f.scope, [])).filter(r => r !== true || true)
      const r = fs.length > 1 ? (res.includes(true) ? true : res.every(x => x === false) ? false : null) : res[0]!
      why.push(`frame ${stem}: ${r == null ? 'unknown' : r}`)
      if (r === false) h = false; else if (r == null && h !== false) h = null
    }
    return { h, why }
  }
  const want = TOPIC === 'permissibility' ? ['permit', 'prohibit'] : ['require']
  const cands = inScope.filter(p => want.includes(p.modality) && (TOPIC === 'permissibility' || p.topic === TOPIC))
  console.log(`3 CLAIMS FROM THE PILOT'S PROPOSITIONS (${cands.length} on "${TOPIC}" in the retrieved clauses):`)
  const claims: Claim[] = []
  for (const p of cands) {
    const { h, why } = holds(p)
    const value = p.unit === 'map' ? (TOPIC === 'fsr' ? lot.fsr_map : TOPIC === 'height' ? lot.height_map_m : lot.lot_size_map_m2) : p.value == null ? null : Number(p.value)
    const prov = [...C.provs.values()].find(x => x.local_id === p.local_id && x.doc_kind === p.kind)
    console.log(`   ${p.kind === 'sepp' ? 'Housing SEPP' : 'Randwick LEP'} ${p.local_id}  ${p.modality} ${value ?? ''}${p.unit === 'map' ? ' (map panel on the lot)' : ''}  applies: ${h == null ? 'UNKNOWN' : h}  <- ${why.join('; ') || 'no scope'}`)
    if (!prov) { console.log('      (not in the rag snapshot)'); continue }
    claims.push({ id: p.id, provision: prov.id, effect: TOPIC === 'permissibility' ? p.modality : 'value', value, unit: p.unit, comparator: p.comparator === 'gte' ? 'min' : 'max',
      holds: h, condition: h == null ? `${p.local_id}: ${why.filter(w => /unknown/.test(w)).join('; ')}` : null, label: `${p.kind === 'sepp' ? 'Housing SEPP' : 'LEP'} ${p.local_id} ${value ?? p.modality}` })
  }

  // 5: the resolver
  const provs = new Map<string, Prov>([...C.provs.values()].map(p => [p.id, { id: p.id, local_id: p.local_id, path: p.path, document_id: p.document_id, doc_kind: p.doc_kind }]))
  const rels: Rel[] = C.rels.map(r => ({ kind: r.kind, from_provision: r.from, to_provision: r.to, to_document: r.to_document, to_ref: r.to_ref, status: r.status, basis: r.basis, span: r.span }))
  const r = resolve(claims, rels, provs)
  console.log(`\n4 RULING: ${r.verdict}${r.answer ? ` -> ${r.answer.effect === 'value' ? r.answer.value : r.answer.effect}` : ''}`)
  for (const d of r.dropped) console.log(`   dropped ${claims.find(c => c.id === d.claim)?.label}: ${d.why}`)
  for (const s of r.trace) console.log(`   ${s.rule}: ${s.winner}  beats  ${s.loser}  [${s.why}; relation ${s.by.slice(0, 60)}, ${s.basis}/${s.status}]`)
  for (const b of r.branches ?? []) { console.log(`   if ${b.if}: ${b.answer ? (b.answer.value ?? b.answer.effect) : 'none'}`); for (const s of b.trace) console.log(`      ${s.rule}: ${s.winner} beats ${s.loser}`) }
  for (const u of r.unresolved) console.log('   unresolved:', u)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
