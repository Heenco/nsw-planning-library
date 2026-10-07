/**
 * Norms trial, build step: a model reads each clause and writes norms in the closed vocabulary
 * (shared/norms/schema.ts); a deterministic gate checks every one. Nothing the model says is taken on trust:
 *
 *   - every condition quotes its words (`span`), and the words must be in the clause
 *   - every fact is in the vocabulary, and every value is one the fact allows (a land use from the Standard Instrument
 *     vocabulary, a zone code, a listed value) - a leaf that fails is NOT dropped: it becomes `unparsed`, quoted, so the
 *     norm can only ever come out undecided on it (fail closed)
 *   - every number in the clause is used by a condition or a standard, or listed as a reference
 *   - every "despite" / "subject to" points at a norm that exists
 *
 *   npx tsx scripts/norms/author.ts                    # all trial clauses (cached by text + prompt + model)
 *   npx tsx scripts/norms/author.ts --fresh            # ignore the cache
 *
 * Writes norms/trial/model/<slug>.json - the model's norms as gated. They are reviewed into norms/trial/reviewed/
 * before the engine uses them. Model: DeepSeek-V4-Pro on DeepInfra, temperature 0 - the same provider the graph's
 * ingest already sends this public legislation to.
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { FACTS, type Norm } from '../../shared/norms/schema'
import { gateNorm, numbersIn, operative, quantities } from './gate'

const MODEL = 'deepseek-ai/DeepSeek-V4-Pro'
const FRESH = process.argv.includes('--fresh')
const OUT = 'norms/trial'
const CACHE = 'norms/.cache'

/** The trial slice: subdivision and secondary dwellings, Housing SEPP + Randwick LEP 2012. */
const SLICE = [
  { slug: 'housing-sepp-2021', title: 'State Environmental Planning Policy (Housing) 2021',
    context: ['sec.49', 'sec.50'],                 // read for meaning; no norms from them on their own
    clauses: ['sec.51', 'sec.52', 'sec.53', 'sec.27', 'sec.185'],
    parts: { 'sec.51': 'ch.3-pt.1', 'sec.52': 'ch.3-pt.1', 'sec.53': 'ch.3-pt.1', 'sec.27': 'ch.2-pt.2-div.2', 'sec.185': 'ch.7' } },
  { slug: 'randwick-lep-2012', title: 'Randwick Local Environmental Plan 2012',
    context: [],
    clauses: ['sec.2.6', 'sec.4.1', 'sec.4.1A', 'sec.4.1AA', 'sec.4.1B', 'sec.4.1C', 'sec.4.1D'],
    parts: {} as Record<string, string> },
]

const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim()
const OUT_MODEL = `${OUT}/model`

const VOCAB = Object.entries(FACTS).map(([k, f]: [string, any]) =>
  `- ${k} (answered by: ${f.who})${Array.isArray(f.values) ? ` values: ${f.values.map((v: string) => JSON.stringify(v)).join(', ')}`
    : f.values === 'land_use' ? ' value: a Standard Instrument land use term, singular ("dwelling house", "secondary dwelling", "boarding house", "dual occupancy"); optional "under": "<instrument slug>:<part>" when the clause says development carried out under a named part'
    : f.values === 'zone_code' ? ' value: a zone code ("R2")' : f.values === 'instrument_part' ? ' value: "<instrument slug>:<part id>" e.g. "housing-sepp-2021:ch.7"'
    : f.values === 'land_use_pair' ? ' value: "principal dwelling|secondary dwelling"' : f.values === 'date' ? ' value: ISO date' : ''}${f.cmp ? ' with "cmp" (lt|lte|eq|gte|gt) and "n" (number)' : ''}`).join('\n')

const SYSTEM = `You translate NSW planning law into norms: JSON a deterministic engine evaluates. Accuracy over coverage.

A norm = one operative provision: a permission, a prohibition ("consent must not be granted ... unless ..."), or a
standard. Shape:
{"id": "<slug>:<clause>", "clause": "4.1(3)", "section": "<the section id the words are in>",
 "when": <condition>, "then": <effect>, "despite": ["<norm id>" | "instrument:*"], "subjectTo": ["<norm id>"]}

condition: {"all": [...]} | {"any": [...]} | {"not": <condition>} | a leaf:
  {"fact": "<fact>", "value": "...", "under": "...", "cmp": "gte", "n": 450, "text": "...", "span": "<exact words copied from the clause>"}
facts (closed list - use nothing else):
${VOCAB}
- a zone group the instrument defines ("residential zone means ... Zone R1 ..., Zone R2 ...") is {"any": [one lot.zone leaf
  per code]}, each leaf's span the group's own words ("in a residential zone").
- "development carried out under this Part" (any kind) is site.has with value "development" and "under" the part.
- discretion: the consent authority's satisfaction or opinion; put its words in "text".
- unparsed: ANY condition you cannot express with the facts above; copy its words into "text". Never leave a
  condition out - a condition you drop makes the engine answer wrongly. When unsure, use unparsed.

effect: {"permit": "with_consent"|"without_consent"|"exempt"|"complying"} | {"prohibit": true} |
  {"require": {"topic": "resulting_lot_size"|"site_area"|"floor_area"|"dwellings_on_land"|"dwellings_per_resulting_lot"|"parking",
               "cmp": "gte", "n": 275, "from": "lot_size_map", "unit": "m2",
               "kind": "development_standard"|"non_discretionary"|"condition"}}

Rules:
1. Every norm's "when" says WHAT development it is about (proposal.kind, and proposal.subdivision_type / proposal.use
   where the clause narrows it) AND every condition in the words, including those in the section that says where the
   part applies (given as context).
2. "Development consent must not be granted for X unless Y" = prohibit when (X and not Y).
3. "This clause does not apply to Z" = add (not Z) to every norm of that clause.
4. "Despite subclause (3)" / "Despite any other provision in this Plan" -> "despite": the id of that norm, or "instrument:*".
5. A provision about what already exists on the land ("a lot on which development has been carried out under this
   Part", "land on which a secondary dwelling is situated", "a lot on which there is a dual occupancy",
   "of a boarding house") is a site.has fact - not a proposal fact.
6. Objectives, notes and definitions are not norms. A lot size "shown on the Lot Size Map" is {"from": "lot_size_map"}
   plus a lot.on_map condition where the clause applies only to land on the map.
7. "span" must be copied character for character from the clause text or the context given - EVERY leaf needs one.
Answer with JSON only: {"norms": [...], "references": [<numbers in the text that are references, not quantities>]}`

async function callModel(user: string): Promise<string> {
  const key = createHash('sha256').update(MODEL + SYSTEM + user).digest('hex').slice(0, 32)
  const file = `${CACHE}/${key}.json`
  if (!FRESH && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).content
  const res = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 8000, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] }),
  })
  if (!res.ok) throw new Error(`DeepInfra ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const content = ((await res.json()) as any).choices[0].message.content as string
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(file, JSON.stringify({ model: MODEL, at: new Date().toISOString(), content }, null, 1))
  return content
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  mkdirSync(OUT, { recursive: true })
  for (const ins of SLICE) {
    const secs = (await client.query(`SELECT s.local_id, s.heading, s.raw_text, s.route FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id
      WHERE d.title = $1 ORDER BY s.sort_order`, [ins.title])).rows
    const textOf = (root: string, operative = true) => secs.filter(s => s.local_id === root || s.local_id.startsWith(root + '-'))
      .filter(s => norm(s.raw_text) && (!operative || s.route !== 'objective'))
      .map(s => `[${s.local_id}] ${norm(s.raw_text)}`).join('\n')
    const context = ins.context.map(c => textOf(c, false)).join('\n')
    const all: Norm[] = []
    const report: string[] = []
    for (const clause of ins.clauses) {
      const head = secs.find(s => s.local_id === clause)
      const body = textOf(clause)
      const plain = secs.filter(s => s.local_id === clause || s.local_id.startsWith(clause + '-')).map(s => norm(s.raw_text)).join(' ')
      const user = `Instrument: ${ins.title} (slug ${ins.slug})${ins.parts[clause] ? `; this clause is in ${ins.slug}:${ins.parts[clause]}` : ''}
${context && clause !== ins.context.find(c => c === clause) ? `Context (meaning only - no norms from it unless it is the clause below):\n${context}\n` : ''}
Clause ${clause.replace('sec.', '')}${head?.heading ? ` - ${head.heading}` : ''}:
${body}`
      const raw = JSON.parse(await callModel(user))
      const ids = new Set<string>((raw.norms ?? []).map((n: any) => String(n.id)))
      const made = (raw.norms ?? []).map((n: any) => gateNorm({ ...n, author: { by: MODEL, at: new Date().toISOString() } }, plain,
        ins.context.map(c => secs.filter(s => s.local_id === c || s.local_id.startsWith(c + '-')).map(s => norm(s.raw_text)).join(' ')).join(' '), ids))
      const ns = made.map((m: any) => ({ ...m.norm, instrument: ins.title }))
      // every quantity in the clause is used, or declared a reference
      const used = new Set([...numbersIn(ns), ...(raw.references ?? []).map(Number)])
      const missing = [...new Set(quantities(secs.filter(s => (s.local_id === clause || s.local_id.startsWith(clause + '-')) && s.route !== 'objective').map(s => operative(s.raw_text)).join(' ')))].filter(v => !used.has(v))
      for (const v of missing) report.push(`${clause}: the number ${v} is used by no norm`)
      for (const m of made) report.push(...m.notes)
      all.push(...ns)
      console.log(`${ins.slug} ${clause}: ${ns.length} norms${made.some((m: any) => m.notes.length) ? `, ${made.reduce((k: number, m: any) => k + m.notes.length, 0)} gate notes` : ''}${missing.length ? `, numbers unused: ${missing.join(', ')}` : ''}`)
    }
    mkdirSync(OUT_MODEL, { recursive: true })
    writeFileSync(`${OUT_MODEL}/${ins.slug}.json`, JSON.stringify({ instrument: ins.title, model: MODEL, gate: report, norms: all }, null, 2))
    console.log(`  -> ${OUT_MODEL}/${ins.slug}.json: ${all.length} norms, ${report.length} gate findings`)
  }
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
