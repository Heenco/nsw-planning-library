/**
 * Step 10 of the rule pipeline (docs/sepp-rule-pipeline.md §6): run the answer keys.
 *
 *   npx tsx scripts/pipeline/answer-keys.ts --profile housing-sepp-2021                 # against localhost:3000
 *   npx tsx scripts/pipeline/answer-keys.ts --profile housing-sepp-2021 --base https://nsw-planning-library.vercel.app
 *   ... --record                                                                          # write findings
 *
 * For each case in tests/answer-keys/<profile>.json it calls /api/rules/at (the generated rules) and
 * /api/lmr/types (the hand-built lmr catalogue), and checks:
 *   - the verdict: permissible, controlling clause, displaced clause
 *   - which frames reach the lot
 *   - the SEPP standards that apply (and any that must not), the LEP standards that apply
 *   - agreement with the lmr catalogue on "is the use permissible under Chapter 6 on this lot" - a
 *     disagreement passes only if the case explains it (`lmrDisagrees`, with the clause)
 * "Done when": every case passes, or every failure is explained. --record writes each unexplained failure
 * as a gating audit_finding (step 12 holds the publish while any are open).
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const argv = process.argv.slice(2)
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'housing-sepp-2021'
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://localhost:3000'
const RECORD = argv.includes('--record')
const auth = 'Basic ' + Buffer.from(`user:${process.env.NUXT_APP_PASSWORD ?? ''}`).toString('base64')

async function get(path: string, query: Record<string, string>) {
  const u = new URL(path, BASE)
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  const r = await fetch(u, { headers: { authorization: auth } })
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return r.json() as Promise<any>
}

const close = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 1e-9

async function main() {
  const keys = JSON.parse(readFileSync(`tests/answer-keys/${PROFILE}.json`, 'utf8'))
  const results: { name: string; pass: boolean; fails: string[]; explained: string | null }[] = []

  for (const c of keys.cases) {
    const fails: string[] = []
    const r = await get('/api/rules/at', { cadid: c.cadid, use: c.use })
    const e = c.expect
    if ('permissible' in e && r.verdict.permissible !== e.permissible) fails.push(`permissible ${r.verdict.permissible} != ${e.permissible} (${r.verdict.wording})`)
    if (e.controllingClause && r.verdict.controlling?.clause !== e.controllingClause) fails.push(`controlling ${r.verdict.controlling?.clause ?? '-'} != ${e.controllingClause}`)
    if (e.displacedClause && !r.verdict.displaced.some((d: any) => d.clause === e.displacedClause)) fails.push(`does not displace ${e.displacedClause}`)
    for (const [clause, want] of Object.entries(e.frames ?? {})) {
      const f = r.frames.find((x: any) => x.clause === clause)
      if (!f || f.reaches !== want) fails.push(`frame ${clause} reaches ${f?.reaches} != ${want}`)
    }
    const applying = r.sepp.standards.filter((s: any) => s.applies === true)
    for (const [clause, topic, value] of e.seppStandards ?? []) {
      if (!applying.some((s: any) => s.clause === clause && s.topic === topic && close(s.value, value)))
        fails.push(`SEPP standard s ${clause} ${topic} ${value} not applying`)
    }
    if (Array.isArray(e.seppStandards) && e.seppStandards.length === 0 && applying.some((s: any) => s.value != null))
      fails.push(`expected no SEPP numeric standard, got ${applying.filter((s: any) => s.value != null).map((s: any) => `s ${s.clause} ${s.topic}`).join(', ')}`)
    for (const [clause, topic, value] of e.seppStandardsAbsent ?? []) {
      if (applying.some((s: any) => s.clause === clause && s.topic === topic && close(s.value, value)))
        fails.push(`SEPP standard s ${clause} ${topic} ${value} applies but must not`)
    }
    for (const [clause, topic, value] of e.lepStandards ?? []) {
      if (!r.lep.standards.some((s: any) => s.applies === true && String(s.clause).startsWith(clause) && s.topic === topic && close(s.value, value)))
        fails.push(`LEP standard cl ${clause} ${topic} ${value} not applying`)
    }
    const seppPerm = r.sepp.permissions.some((p: any) => p.applies === true)
    if ('seppPermissionApplies' in e && seppPerm !== e.seppPermissionApplies) fails.push(`SEPP permission applies ${seppPerm} != ${e.seppPermissionApplies}`)

    // the hand-built lmr catalogue: is the use permissible under Chapter 6 on this lot?
    let explained: string | null = null
    if (c.lmrType) {
      const lmr = await get('/api/lmr/types', { cadid: c.cadid })
      const t = lmr.types.find((x: any) => x.key === c.lmrType)
      const excluded = lmr.general.some((g: any) => g.status === 'excluded')
      const gate = ['lmr_area', 'zone', 'permissibility'].map(col => t?.checks.find((k: any) => k.column === col)?.pass)
      const lmrPermissible = !excluded && gate.every(p => p === true)
      if (lmrPermissible !== seppPerm) {
        if (c.lmrDisagrees) explained = `lmr says ${lmrPermissible}, pipeline says ${seppPerm}: ${c.lmrDisagrees}`
        else fails.push(`lmr catalogue says Ch 6 permissible = ${lmrPermissible}, pipeline says ${seppPerm}`)
      }
    }
    results.push({ name: `${c.name} [${c.use}]`, pass: fails.length === 0, fails, explained })
  }

  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    for (const f of x.fails) console.log(`        - ${f}`)
    if (x.explained) console.log(`        explained: ${x.explained.slice(0, 200)}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} cases pass; ${results.filter(r => r.explained).length} lmr disagreements explained`)

  if (RECORD) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    const profile = (await import(`../../profiles/${PROFILE}.ts`)).default
    const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
    if (doc) {
      await client.query(`DELETE FROM nsw.audit_finding WHERE document_id = $1 AND status = 'open' AND detail LIKE 'step10%'`, [doc.id])
      for (const f of failed) for (const m of f.fails) {
        await client.query(`INSERT INTO nsw.audit_finding (id, document_id, kind, gating, clause, value, detail, status)
                            VALUES ($1, $2, 'answer_key_mismatch', true, null, null, $3, 'open')`, [randomUUID(), doc.id, `step10 ${f.name}: ${m}`])
      }
    }
    await client.end()
  }
  console.log(failed.length ? 'FAIL' : 'PASS')
}

main().catch((e) => { console.error(e); process.exit(1) })
