/**
 * Norms trial, critic: a SECOND model, of another family than the author, reads each clause beside its norms rendered
 * in plain English, and lists (a) conditions or exceptions in the words that no norm has, (b) conditions a norm has
 * that the words do not. The gate checks form (spans, vocabulary, numbers); this checks meaning - the trial's draft
 * of s 53(2)(a) passed the gate with an invented condition and a dropped "detached", which is what this is for.
 *
 *   npx tsx scripts/norms/critic.ts                       # the reviewed norms
 *   npx tsx scripts/norms/critic.ts --dir norms/trial/model
 *
 * Writes norms/trial/critic.json. The critic never edits a norm: its findings go to review.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import type { Cond, Norm } from '../../shared/norms/schema'
import { norm } from './gate'

const MODEL = 'Qwen/Qwen3.8-Max'
const DIR = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1]! : 'norms/trial/reviewed'
const CACHE = 'norms/.cache'

const say = (c: Cond): string => 'all' in c ? `ALL OF (${c.all.map(say).join('; ')})` : 'any' in c ? `ANY OF (${c.any.map(say).join('; ')})`
  : 'not' in c ? `NOT (${say(c.not)})` : c.fact === 'unparsed' || c.fact === 'discretion' ? `[${c.fact}: ${c.text}]`
  : `${c.fact}${c.value ? ` = ${c.value}` : ''}${c.under ? ` (under ${c.under})` : ''}${c.cmp ? ` ${c.cmp} ${c.n}` : ''}`
const effect = (n: Norm) => 'permit' in n.then ? `PERMITTED (${n.then.permit})` : 'prohibit' in n.then ? 'PROHIBITED (consent must not be granted)'
  : `STANDARD ${JSON.stringify(n.then.require)}`

const SYSTEM = `You check a translation of NSW planning law into rules. You are given a clause's exact words and the rules
written from it. Report only real differences in MEANING:
- "missing": a condition, exception, limit or scope in the words that no rule expresses (quote the words)
- "invented": a condition in a rule that the words do not support (name the rule and the condition)
- "wrong": a rule whose effect or number differs from the words
Ignore style. [unparsed: ...] means the condition is kept but not machine-readable - that is not missing.
Answer JSON only: {"missing": [{"words": "...", "why": "..."}], "invented": [{"rule": "...", "condition": "...", "why": "..."}], "wrong": [{"rule": "...", "why": "..."}]}`

async function ask(user: string): Promise<any> {
  const key = createHash('sha256').update(MODEL + SYSTEM + user).digest('hex').slice(0, 32)
  const file = `${CACHE}/critic-${key}.json`
  if (existsSync(file)) return JSON.parse(JSON.parse(readFileSync(file, 'utf8')).content)
  const res = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 3000, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
  })
  if (!res.ok) throw new Error(`DeepInfra ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const content = ((await res.json()) as any).choices[0].message.content as string
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(file, JSON.stringify({ model: MODEL, at: new Date().toISOString(), content }, null, 1))
  return JSON.parse(content)
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const out: any[] = []
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.json'))) {
    const file = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
    const secs = (await client.query(`SELECT s.local_id, s.raw_text FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id WHERE d.title = $1 ORDER BY s.sort_order`, [file.instrument])).rows
    const byClause = new Map<string, Norm[]>()
    for (const n of file.norms as Norm[]) { const c = n.section.replace(/-.*$/, ''); byClause.set(c, [...(byClause.get(c) ?? []), n]) }
    for (const [clause, ns] of byClause) {
      const words = secs.filter(s => s.local_id === clause || s.local_id.startsWith(clause + '-')).map(s => `[${s.local_id}] ${norm(s.raw_text)}`).join('\n')
      const ctx = (file.context?.[clause] ?? []).flatMap((c: string) => secs.filter(s => s.local_id === c || s.local_id.startsWith(c + '-')).map(s => `[${s.local_id}] ${norm(s.raw_text)}`)).join('\n')
      const rules = ns.map(n => `${n.id}: ${effect(n)} WHEN ${say(n.when)}${n.despite?.length ? ` DESPITE ${n.despite.join(', ')}` : ''}`).join('\n')
      const r = await ask(`${file.instrument}, ${clause.replace('sec.', 'clause ')}\nWords:\n${words}${ctx ? `\nContext (where the Part applies, its definitions):\n${ctx}` : ''}\n\nRules:\n${rules}`)
      const n = (r.missing?.length ?? 0) + (r.invented?.length ?? 0) + (r.wrong?.length ?? 0)
      console.log(`${file.slug ?? f} ${clause}: ${n ? `${n} finding(s)` : 'no difference'}`)
      for (const m of r.missing ?? []) console.log(`   missing  "${String(m.words).slice(0, 90)}" - ${m.why}`)
      for (const m of r.invented ?? []) console.log(`   invented ${m.rule}: ${m.condition} - ${m.why}`)
      for (const m of r.wrong ?? []) console.log(`   wrong    ${m.rule}: ${m.why}`)
      out.push({ instrument: file.instrument, clause, model: MODEL, ...r })
    }
  }
  writeFileSync('norms/trial/critic.json', JSON.stringify(out, null, 2))
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
