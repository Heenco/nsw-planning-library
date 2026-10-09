/**
 * RAG pilot, Phase 5.3 - the precedence keys: does the resolver reach the ruled answer, by the right rule?
 *
 *   npx tsx scripts/rag/08-resolver-check.ts
 *
 * Each case is a claim set - the provisions that answer the question and whether each holds for the lot (from the
 * question's frozen lot facts) - as the R4 agent or the engine would hand it over. The resolver gets only these and
 * rag.relation; it names no clause. The fixtures are test data, not rules: they say which provisions are in play and
 * whether they apply, never which one wins.
 */
import 'dotenv/config'
import pg from 'pg'
import { resolve, loadRelations, type Claim } from '../../shared/rag/resolver'

type C = Omit<Claim, 'provision' | 'id'> & { doc: 'lep' | 'sepp'; local: string }
const CASES: { id: string; question: string; expect: { verdict: string; value?: number; effect?: string; branches?: number[] }; claims: C[] }[] = [
  { id: 'H1', question: '32 Holden St: maximum FSR, dual occupancy (attached), 646 m2, R2, LMR outer band', expect: { verdict: 'decided', value: 0.65 }, claims: [
    { doc: 'lep', local: 'sec.4.4-ssec.2', effect: 'value', value: 0.5, unit: ':1', comparator: 'max', holds: true, label: 'LEP 4.4(2) FSR map 0.5:1' },
    { doc: 'lep', local: 'sec.4.4A-ssec.2#t1r3c4', effect: 'value', value: 0.6, unit: ':1', comparator: 'max', holds: true, label: 'LEP 4.4A(2) dual occupancy (attached), R2, >=600 m2: 0.6:1' },
    { doc: 'sepp', local: 'sec.168-ssec.2-para1.d', effect: 'value', value: 0.65, unit: ':1', comparator: 'max', holds: true, label: 'Housing SEPP s 168(2)(d) 0.65:1' } ] },
  { id: 'H2', question: '32 Holden St: Torrens subdivision of a dual occupancy, consent date unknown', expect: { verdict: 'maybe', branches: [225, 275] }, claims: [
    { doc: 'lep', local: 'sec.4.1-ssec.3', effect: 'value', value: 275, unit: 'm2', comparator: 'min', holds: true, label: 'LEP 4.1(3) Lot Size Map 275 m2' },
    { doc: 'sepp', local: 'sec.169-ssec.3-para1.d', effect: 'value', value: 225, unit: 'm2', comparator: 'min', holds: null, condition: 's 169(2): dual occupancy consent on or after 28 Feb 2025', label: 'Housing SEPP s 169(3)(d) 225 m2' } ] },
  { id: 'H3', question: '32 Holden St: Torrens subdivision, consent 10 Mar 2025', expect: { verdict: 'decided', value: 225 }, claims: [
    { doc: 'lep', local: 'sec.4.1-ssec.3', effect: 'value', value: 275, unit: 'm2', comparator: 'min', holds: true, label: 'LEP 4.1(3) Lot Size Map 275 m2' },
    { doc: 'sepp', local: 'sec.169-ssec.3-para1.d', effect: 'value', value: 225, unit: 'm2', comparator: 'min', holds: true, label: 'Housing SEPP s 169(3)(d) 225 m2' } ] },
  { id: 'H4', question: '32 Holden St: Torrens subdivision, consent 1 Jun 2024', expect: { verdict: 'decided', value: 275 }, claims: [
    { doc: 'lep', local: 'sec.4.1-ssec.3', effect: 'value', value: 275, unit: 'm2', comparator: 'min', holds: true, label: 'LEP 4.1(3) Lot Size Map 275 m2' },
    { doc: 'sepp', local: 'sec.169-ssec.3-para1.d', effect: 'value', value: 225, unit: 'm2', comparator: 'min', holds: false, label: 'Housing SEPP s 169(3)(d) 225 m2 - s 169(2) not met' } ] },
  { id: 'H5', question: '32 Holden St: strata subdivision of a dual occupancy', expect: { verdict: 'decided', value: 275 }, claims: [
    { doc: 'lep', local: 'sec.4.1A-ssec.4-para1.a', effect: 'value', value: 275, unit: 'm2', comparator: 'min', holds: true, label: 'LEP 4.1A(4)(a) 275 m2' },
    { doc: 'sepp', local: 'sec.169-ssec.3-para1.d', effect: 'value', value: 225, unit: 'm2', comparator: 'min', holds: false, label: 'Housing SEPP s 169(3)(d) - s 169(4): not strata' } ] },
  { id: 'H6', question: '32 Holden St: secondary dwelling', expect: { verdict: 'decided', effect: 'permit' }, claims: [
    { doc: 'lep', local: 'sec.4-oc.3', effect: 'prohibit', holds: true, label: 'LEP Land Use Table R2 item 4: any other development prohibited' },
    { doc: 'sepp', local: 'sec.52-ssec.1', effect: 'permit', holds: true, label: 'Housing SEPP s 52(1) (s 50: dwelling houses permitted in R2)' } ] },
  { id: 'H8', question: '32 Holden St: multi dwelling housing', expect: { verdict: 'decided', effect: 'permit' }, claims: [
    { doc: 'lep', local: 'sec.4-oc.3', effect: 'prohibit', holds: true, label: 'LEP Land Use Table R2 item 4' },
    { doc: 'sepp', local: 'sec.170', effect: 'permit', holds: true, label: 'Housing SEPP s 170 (LMR area, R2)' } ] },
  { id: 'H13', question: 'dwelling house, 290 m2, R2, FSR map 0.5', expect: { verdict: 'decided', value: 0.65 }, claims: [
    { doc: 'lep', local: 'sec.4.4-ssec.2', effect: 'value', value: 0.5, unit: ':1', comparator: 'max', holds: true, label: 'LEP 4.4(2) FSR map 0.5:1' },
    { doc: 'lep', local: 'sec.4.4A-ssec.2#t1r4c4', effect: 'value', value: 0.65, unit: ':1', comparator: 'max', holds: true, label: 'LEP 4.4A(2) dwelling house, R2, 275-300 m2: 0.65:1' } ] },
  { id: 'H16', question: '26 Houston Rd: maximum FSR, dual occupancy (attached), 537 m2, R3, LMR outer band, FSR map 0.75', expect: { verdict: 'decided', value: 0.75 }, claims: [
    { doc: 'lep', local: 'sec.4.4-ssec.2', effect: 'value', value: 0.75, unit: ':1', comparator: 'max', holds: true, label: 'LEP 4.4(2) FSR map 0.75:1' },
    { doc: 'sepp', local: 'sec.168-ssec.2-para1.d', effect: 'value', value: 0.65, unit: ':1', comparator: 'max', holds: true, label: 'Housing SEPP s 168(2)(d) 0.65:1' } ] },
  { id: 'H17', question: '53 Harbourne Rd: maximum height, dual occupancy, R3, LMR inner band, height map 12 m', expect: { verdict: 'decided', value: 12 }, claims: [
    { doc: 'lep', local: 'sec.4.3-ssec.2', effect: 'value', value: 12, unit: 'm', comparator: 'max', holds: true, label: 'LEP 4.3(2) Height of Buildings Map 12 m' },
    { doc: 'sepp', local: 'sec.168-ssec.2-para1.e', effect: 'value', value: 9.5, unit: 'm', comparator: 'max', holds: true, label: 'Housing SEPP s 168(2)(e) 9.5 m' } ] },
  { id: 'H18', question: '53 Harbourne Rd: maximum height, dwelling house, R3, height map 12 m', expect: { verdict: 'decided', value: 9.5 }, claims: [
    { doc: 'lep', local: 'sec.4.3-ssec.2', effect: 'value', value: 12, unit: 'm', comparator: 'max', holds: true, label: 'LEP 4.3(2) Height of Buildings Map 12 m' },
    { doc: 'lep', local: 'sec.4.3-ssec.2A', effect: 'value', value: 9.5, unit: 'm', comparator: 'max', holds: true, label: 'LEP 4.3(2A) dwelling house in R3: 9.5 m' } ] },
  { id: 'H14', question: '28 Eastern Av: dual occupancy, 510 m2, R2, LMR outer band', expect: { verdict: 'decided', effect: 'permit' }, claims: [
    { doc: 'lep', local: 'sec.4.1C-ssec.2', effect: 'prohibit', holds: true, label: 'LEP 4.1C(2): no dual occupancy in R2 under 550 m2' },
    { doc: 'sepp', local: 'sec.166', effect: 'permit', holds: true, label: 'Housing SEPP s 166' } ] },
]

/** the instruments these hand-written cases cite ('lep' / 'sepp' in a case means these) */
const CASES_FOR = { lep: 'Randwick Local Environmental Plan 2012', sepp: 'State Environmental Planning Policy (Housing) 2021' }

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const byTitle = new Map((await q(`SELECT title, document_id FROM rag.instrument`)).rows.map(r => [r.title, r.document_id]))
  if (!byTitle.has(CASES_FOR.lep) || !byTitle.has(CASES_FOR.sepp)) { console.log(`resolver cases need ${CASES_FOR.lep} and ${CASES_FOR.sepp} in the corpus - skipped`); await client.end(); return }
  const docs: Record<string, string> = { lep: byTitle.get(CASES_FOR.lep)!, sepp: byTitle.get(CASES_FOR.sepp)! }
  const results: any[] = []
  for (const k of CASES) {
    const claims: Claim[] = []
    for (const [i, c] of k.claims.entries()) {
      const pid = (await q(`SELECT id FROM rag.provision WHERE document_id = $1 AND local_id = $2`, [docs[c.doc], c.local])).rows[0]?.id
      if (!pid) throw new Error(`${k.id}: no provision ${c.doc} ${c.local}`)
      const { doc: _d, local: _l, ...rest } = c
      claims.push({ ...rest, id: `${k.id}.${i}`, provision: pid })
    }
    const { relations, provs } = await loadRelations(q, claims.map(c => c.provision))
    const r = resolve(claims, relations, provs)
    const got = r.verdict === 'maybe' ? (r.branches ?? []).map(b => b.answer?.value).filter(v => v != null).sort() : r.answer?.value ?? r.answer?.effect
    const want = k.expect.verdict === 'maybe' ? [...(k.expect.branches ?? [])].sort() : k.expect.value ?? k.expect.effect
    const pass = r.verdict === k.expect.verdict && JSON.stringify(got) === JSON.stringify(want)
    results.push({ id: k.id, pass, verdict: r.verdict, got, want, trace: r.trace, branches: r.branches?.map(b => ({ if: b.if, value: b.answer?.value, trace: b.trace })) })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${k.id} ${k.question}\n     ${r.verdict}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`)
    for (const s of r.trace) console.log(`       ${s.rule.padEnd(10)} ${s.winner}  >  ${s.loser}   [${s.by.slice(0, 70)}; ${s.basis}, ${s.status}]`)
    for (const b of r.branches ?? []) { console.log(`       if ${b.if}: ${b.answer?.value ?? b.answer?.effect}`); for (const s of b.trace) console.log(`          ${s.rule.padEnd(10)} ${s.winner}  >  ${s.loser}   [${s.by.slice(0, 60)}]`) }
    if (r.unresolved.length) console.log('       unresolved:', r.unresolved.join(' | '))
  }
  const passed = results.filter(r => r.pass).length
  await q(`INSERT INTO rag.run (stage, config, counts, finished_at) VALUES ('resolver_check', '{}', $1, now())`, [JSON.stringify({ pass: passed, fail: results.length - passed, cases: results })])
  console.log(`\n${passed} / ${results.length} pass`)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
