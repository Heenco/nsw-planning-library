/**
 * Pilot engine key: evaluate one land-use question against a plan's PILOT shadow document, with the
 * engine the pages use, and print the verdict.
 *
 *   npx tsx scripts/norms/pilot-key.ts --plan "Parramatta Local Environmental Plan 2023" --cadid 100159514 --use "dual occupancies"
 *
 * The shadow document is "<plan title> (pilot)": its own sections (cloned), its own rules (projected
 * from pilot.*), doc_type 'pilot', chosen by no page. graphNorms is pointed at the shadow's id but
 * handed the REAL title as the instrument name, because evaluate() keeps the lot's own LEP in play
 * by instrument name (n.instrument === lot.epi), exactly as scripts/norms/check.ts does.
 */
import 'dotenv/config'
import pg from 'pg'
import { evaluate } from '../../shared/norms/engine'
import { lotFacts, lotTerm, refHitsFor } from '../../shared/norms/facts'
import { graphNorms } from '../../shared/norms/from-graph'
import type { Question } from '../../shared/norms/schema'
import { landUseKey } from '../../shared/land-use-key'

const arg = (k: string, d = '') => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
const PLAN = arg('--plan'), CADID = arg('--cadid'), USE = arg('--use', 'dual occupancies')
// A key asserts the CONTROLLING CLAUSE, not just the verdict. "prohibited" for lot 15//DP231049 passed
// once while cl 6.10 (sex services premises) was the controlling rule - right answer, wrong law.
const EXPECT = arg('--expect', ''), EXPECT_BY = arg('--expect-by', ''), FORBID_BY = arg('--forbid-by', '')
const clauseOf = (id: string) => (id.match(/:graph:(sec\.[^:]+)/)?.[1] ?? id)
  .replace(/^sec\./, '').replace(/-ssec\.([0-9A-Za-z]+)/, '($1)').replace(/-para1\.([a-z0-9]+)/, '($1)').replace(/-para2\.([a-z0-9]+)/, '($1)')

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const query = (sql: string, params?: unknown[]) => client.query(sql, params as any[])
  const shadow = (await query(`SELECT id, instrument_slug FROM nsw.document WHERE title = $1`, [PLAN + ' (pilot)'])).rows[0]
  if (!shadow) throw new Error(`no shadow document for ${PLAN}`)
  const lot = await lotFacts(query, CADID, landUseKey)
  const graph = await graphNorms(query, shadow.id, PLAN, shadow.instrument_slug, { clauseFilter: 'true', covered: [], assumeKind: null })
  /*
   * A PERMISSION IS ABOUT THE PROPOSAL. from-graph reads every land_use row as "the lot has X, or X
   * is proposed"; with "has" unknown for every use, all 25 permissions of the zone table came back
   * "conditional" on a dual-occupancy question and the controlling list was 60 clauses long. Here a
   * grant is tested on what is proposed only; prohibitions and conditions keep both readings.
   */
  const dropHas = (c: any): any => !c || typeof c !== 'object' ? c
    : Array.isArray(c) ? c.map(dropHas)
    : c.any ? (() => { const a = c.any.filter((x: any) => x.fact !== 'site.has'); return a.length === 1 ? dropHas(a[0]) : { ...c, any: a.map(dropHas) } })()
    : c.all ? { ...c, all: c.all.map(dropHas) } : c.not ? { ...c, not: dropHas(c.not) } : c
  for (const n of graph.norms as any[]) if (n.then?.permit || n.then?.prohibit) n.when = dropHas(n.when)
  /*
   * THE LAND USE TABLE ANSWERS FIRST, as it does on /land-use: lot.permits carries 01E's reading of
   * the zone table (nsw.lep_permissibility) per use. Hornsby's R2 table lists no dual occupancies at
   * all, so the zone prohibits them before cl 4.1C(3) is ever reached. A subtype asks for itself,
   * then for its parent use ("dual occupancies (detached)" -> "dual occupancies").
   */
  const baseUse = USE.replace(/\s*\(.*\)\s*$/, '')
  const permits = (lot as any).permits ?? {}
  const lut = (arg('--proposal', 'use') === 'subdivision' ? [] : ((permits[landUseKey(USE)] ?? permits[landUseKey(baseUse)] ?? []) as any[])).filter(p => p.source === 'lep')
  const lutStatus = lut.some(p => /^permitted/.test(p.status)) ? 'permitted' : lut.some(p => p.status === 'prohibited') ? 'prohibited'
    : lut.some(p => p.status === 'mixed') ? 'mixed' : 'none'
  console.log(`land use table: ${lutStatus}${lut.length ? ` (${lut.map(p => `${p.instrument}: ${p.status}`).join('; ')})` : ' - no row for this use'}`)
  // THE LOT'S FACTS ARE COMPLETED AFTER THE NORMS ARE KNOWN, as use.get.ts does (lines 119-126): the
  // terms the norms ask for are tested, and the polygon hits for the norms' spatial refs are merged
  // in. Without this every "is the lot inside X" condition is unknown, which is why cl 6.11(1)'s
  // "D" prohibition never fired here while subjectless blanket prohibitions did.
  const leaves = (c: any): any[] => !c ? [] : Array.isArray(c) ? c.flatMap(leaves)
    : c.any ? leaves(c.any) : c.all ? leaves(c.all) : c.not ? leaves(c.not) : [c]
  const all = graph.norms.flatMap((n: any) => leaves(n.when))
  const termsAsked = [...new Set(all.filter((l: any) => l.fact === 'lot.in').map((l: any) => String(l.value).toLowerCase()))]
  const tested = await Promise.all(termsAsked.map(t => lotTerm(query, CADID, t, (lot as any).lga ?? null)))
  ;(lot as any).terms = { ...((lot as any).terms ?? {}), ...Object.fromEntries(termsAsked.map((t, i) => [t, tested[i]!])) }
  ;(lot as any).refHits = { ...((lot as any).refHits ?? {}), ...(await refHitsFor(query, CADID, graph.refIds)) }
  ;(lot as any).handleRule = graph.handleRule
  console.log(`terms asked: ${termsAsked.length}, polygon refs: ${graph.refIds.length}, hits: ${Object.values((lot as any).refHits).filter(Boolean).length}`)
  // --proposal subdivision [--lots N] asks the subdivision question the trial cases use; otherwise a land use
  const PROPOSAL = arg('--proposal', 'use'), LOTS = Number(arg('--lots', '2'))
  const question: Question = PROPOSAL === 'subdivision'
    ? { cadid: CADID, site: {} as any, proposal: { kind: 'subdivision', subdivision_type: 'torrens', resulting_lots: LOTS, use: '-' } as any }
    : { cadid: CADID, site: {} as any, proposal: { kind: 'use', use: USE } as any }
  const o = evaluate(graph.norms, question, lot, landUseKey)
  console.log(`lot ${CADID}: zone ${lot.zone}, ${lot.areaM2} m², epi ${lot.epi}`)
  console.log(`norms from the shadow: ${graph.norms.length}  (kinds: ${[...new Set(graph.norms.map((n: any) => n.kind ?? n.then?.kind ?? '?'))].join(', ')})`)
  console.log(`\n${PROPOSAL === 'subdivision' ? `subdivision into ${LOTS} lots` : USE}: ${o.outcome}${o.pathway ? ` (${o.pathway})` : ''}  by ${o.controlling.join(', ') || '-'}`)
  for (const d of o.dependsOn ?? []) console.log(`   depends (${d.who}): cl ${d.clause} - ${d.why}`)
  for (const s of (o.standards ?? []).slice(0, 12)) console.log(`   standard ${s.id}: holds=${s.holds}`)
  // --trace <clause prefix>: the norms of that clause as the engine saw them, and the polygon hits
  const TRACE = arg('--trace', '')
  if (TRACE) {
    const mine = graph.norms.filter((n: any) => String(n.clause ?? '').startsWith(TRACE) || String(n.id).includes(`sec.${TRACE.replace(/\(/g, '-ssec.').replace(/\)/g, '')}`))
    console.log(`\n--- trace ${TRACE}: ${mine.length} norms`)
    for (const n of mine) console.log(JSON.stringify({ id: n.id, clause: n.clause, when: n.when, then: n.then, despite: (n as any).despite }, null, 0).slice(0, 4000))
    const hits = Object.entries((lot as any).refHits ?? {}).filter(([, v]) => v)
    console.log(`--- polygon hits (${hits.length}): ${hits.map(([k]) => k).join(', ')}`)
    console.log(`--- terms tested: ${JSON.stringify((lot as any).terms)}`)
    const ev = (o as any).evaluated ?? (o as any).trace ?? (o as any).norms
    const secId = 'sec.' + TRACE.replace(/\(/g, '-ssec.').replace(/\)/g, '')
    if (ev) console.log('--- evaluated: ' + JSON.stringify(ev.filter?.((x: any) => String(x.id ?? x.norm ?? '').includes(secId)) ?? ev).slice(0, 3000))
    const st = (o as any).standards?.filter((s: any) => String(s.id).includes('sec.' + TRACE.replace(/\(/g, '-ssec.').replace(/\)/g, '')))
    if (st?.length) console.log('--- standards: ' + JSON.stringify(st).slice(0, 600))
  }
  // the verdict: a firm prohibition from a clause, else the zone table, else what the clauses say
  let outcome: string = o.outcome
  let byClauses = o.controlling.map(clauseOf)
  if (outcome !== 'prohibited' && lutStatus === 'prohibited') { outcome = 'prohibited'; byClauses = ['LUT'] }
  else if (outcome !== 'prohibited' && (lutStatus === 'permitted' || lutStatus === 'mixed')) {
    outcome = 'conditional'; byClauses = ['LUT', ...byClauses.filter(c => c !== '3' && !c.startsWith('3-') && !c.startsWith('2-'))]
  }
  byClauses = [...new Set(byClauses)]
  const fails: string[] = []
  // --expect-standard "4.1C(2)=false": a standard of that clause must be listed with that holds value
  const ES = arg('--expect-standard', '')
  if (ES) {
    const [cl, want] = ES.split('=')
    const st = (o.standards ?? []).filter((x: any) => clauseOf(String(x.id)) === cl || String(x.clause) === cl || String(x.clause).replace(/ \[table\]$/, '') === cl)
    // "4.4A(2)=n:0.6": a standard of that clause in play carries the figure 0.6 (and none carries another)
    if (want?.startsWith('n:')) {
      const n = Number(want.slice(2))
      const figs = st.map((x: any) => Number((String(x.standard).match(/[≤≥=<>]\s*([\d.]+)/) ?? [])[1]))
      if (!st.length) fails.push(`no standard listed for ${cl}`)
      else if (!figs.includes(n)) fails.push(`standard ${cl} figures ${figs.join('/')} do not include ${n}`)
      else if (figs.some(f => f !== n)) fails.push(`standard ${cl} also lists ${figs.filter(f => f !== n).join('/')} - the band did not select`)
    } else {
    // a standard held open on an untested fact reports what it WOULD be; that reading counts
    const got = st.map((x: any) => x.holds == null ? (/^would NOT be met/.test(String(x.test)) ? 'false' : /^would be met/.test(String(x.test)) ? 'true' : 'null') : String(x.holds))
    if (!st.length) fails.push(`no standard listed for ${cl}`)
    else if (!got.includes(String(want))) fails.push(`standard ${cl} holds=${got.join('/')} != ${want}`)
    }
  }
  if (EXPECT && outcome !== EXPECT) fails.push(`outcome ${outcome} != ${EXPECT}`)
  if (EXPECT_BY && !byClauses.some(c => c === EXPECT_BY || c.startsWith(EXPECT_BY + '('))) fails.push(`not controlled by ${EXPECT_BY} (by ${byClauses.join(', ') || '-'})`)
  if (FORBID_BY && byClauses.some(c => c === FORBID_BY || c.startsWith(FORBID_BY + '('))) fails.push(`controlled by forbidden clause ${FORBID_BY}`)
  console.log(`\nverdict: ${outcome}  by ${byClauses.join(', ') || '-'}`)
  console.log('RESULT ' + JSON.stringify({ outcome, by: byClauses, lut: lutStatus, norms: graph.norms.length, fails }))
  await client.end()
  if (fails.length) process.exit(2)
}
main().catch(e => { console.error(e); process.exit(1) })
