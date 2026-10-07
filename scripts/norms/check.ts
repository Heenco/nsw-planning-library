/**
 * Norms trial, check: (1) the build gate over the reviewed norms, against the clause text in the graph; (2) the trial
 * answer keys (norms/trial/cases.json) through the engine.
 *
 *   npx tsx scripts/norms/check.ts            # gate + cases
 *   npx tsx scripts/norms/check.ts --verbose  # also print each case's trace
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { evaluate } from '../../shared/norms/engine'
import { lotFacts } from '../../shared/norms/facts'
import type { Norm } from '../../shared/norms/schema'
import { landUseKey } from '../../shared/land-use-key'
import { gateNorm, norm, numbersIn, operative, quantities } from './gate'

const VERBOSE = process.argv.includes('--verbose')
const DIR = 'norms/trial/reviewed'

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const query = (sql: string, params?: unknown[]) => client.query(sql, params as any[])
  const norms: Norm[] = []
  let gateFindings = 0
  console.log('── gate ──')
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.json'))) {
    const file = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
    const secs = (await query(`SELECT s.local_id, s.raw_text, s.route FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id WHERE d.title = $1`, [file.instrument])).rows
    const under = (root: string) => secs.filter(s => s.local_id === root || s.local_id.startsWith(root + '-'))
    const clauseOf = (section: string) => section.replace(/-.*$/, '')
    const ids = new Set<string>(file.norms.map((n: any) => n.id))
    const byClause = new Map<string, Norm[]>()
    for (const n of file.norms) {
      const clause = clauseOf(n.section)
      const text = under(clause).map(s => norm(s.raw_text)).join(' ')
      const ctx = (file.context?.[clause] ?? []).flatMap((c: string) => under(c).map(s => norm(s.raw_text))).join(' ')
      const { norm: g, notes } = gateNorm({ ...n, instrument: file.instrument }, text, ctx, ids)
      for (const x of notes) console.log(`  GATE ${x}`)
      gateFindings += notes.length
      norms.push(g)
      byClause.set(clause, [...(byClause.get(clause) ?? []), g])
    }
    // every quantity in each clause a norm was read from is used by one
    for (const [clause, ns] of byClause) {
      const used = new Set(numbersIn(ns))
      const q = quantities(under(clause).filter(s => s.route !== 'objective').map(s => operative(s.raw_text)).join(' '))
      for (const v of [...new Set(q)].filter(v => !used.has(v))) { console.log(`  GATE ${file.instrument} ${clause}: the number ${v} is used by no norm`); gateFindings++ }
    }
    console.log(`  ${f}: ${file.norms.length} norms`)
  }
  console.log(`  ${gateFindings ? 'FAIL' : 'PASS'}: ${gateFindings} gate findings over ${norms.length} norms`)

  console.log('\n── cases ──')
  const cases = JSON.parse(readFileSync('norms/trial/cases.json', 'utf8')).cases
  let pass = 0
  for (const c of cases) {
    const lot = await lotFacts(query, c.question.cadid, landUseKey)
    // the lot's own LEP and every SEPP (they apply State-wide; frames decide the rest)
    const inPlay = norms.filter(n => /State Environmental Planning Policy/.test(n.instrument) || n.instrument === lot.epi)
    const o = evaluate(inPlay, c.question, lot, landUseKey)
    const e = c.expect
    const fails: string[] = []
    const want = e.outcome ?? (lot.areaM2 != null && lot.areaM2 < 550 ? e.outcomeIfAreaUnder550 : null)
    const wantCtl = e.controlling ?? (lot.areaM2 != null && lot.areaM2 < 550 ? e.controllingIfAreaUnder550 : null)
    if (want && o.outcome !== want) fails.push(`outcome ${o.outcome} != ${want}`)
    if (e.pathway && o.pathway !== e.pathway) fails.push(`pathway ${o.pathway} != ${e.pathway}`)
    if (wantCtl && JSON.stringify(o.controlling) !== JSON.stringify(wantCtl)) fails.push(`controlling ${o.controlling.join(',')} != ${wantCtl.join(',')}`)
    for (const cl of e.dependsOnClauses ?? []) if (!o.dependsOn.some(d => d.clause === cl)) fails.push(`does not depend on ${cl}`)
    for (const [id, h] of Object.entries(e.standards ?? {})) {
      const s = o.standards.find(x => x.id === id)
      if (!s) fails.push(`standard ${id} not listed`)
      else if (s.holds !== h) fails.push(`standard ${id} holds ${s.holds} != ${h}`)
    }
    for (const id of e.notStandards ?? []) if (o.standards.some(x => x.id === id)) fails.push(`standard ${id} listed but must not be`)
    if (!fails.length) pass++
    console.log(`${fails.length ? 'FAIL' : 'PASS'}  ${c.name}`)
    console.log(`        -> ${o.outcome}${o.pathway ? ` (${o.pathway.replace(/_/g, ' ')})` : ''} by ${o.controlling.join(', ') || '-'}  [lot ${lot.zone}, ${lot.areaM2} m², Lot Size Map ${lot.onLotSizeMap === true ? lot.lotSizeMinM2 + ' m²' : lot.onLotSizeMap === false ? 'not on it' : 'unknown'}]`)
    for (const f of fails) console.log(`        - ${f}`)
    const asks = [...new Map(o.dependsOn.map(d => [`${d.clause}|${d.why}`, d])).values()]
    for (const d of asks) console.log(`        depends (${d.who}): s/cl ${d.clause} - ${d.why}`)
    for (const s of o.standards) console.log(`        standard ${s.clause}: ${s.standard} -> ${s.holds === true ? 'met' : s.holds === false ? 'NOT met' : 'open'}: ${s.test}`)
    if (VERBOSE) for (const r of o.norms.filter(r => r.holds !== false))
      console.log(`          · ${r.id} ${JSON.stringify(r.effect)} holds=${r.holds}${r.defeatedBy?.length ? ` defeated by ${r.defeatedBy}` : ''}${r.defeatedIf?.length ? ` defeated if ${r.defeatedIf}` : ''}`)
  }
  console.log(`\n${pass}/${cases.length} cases pass; ${gateFindings} gate findings`)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
