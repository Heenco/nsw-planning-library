/**
 * Step 4 of the rule pipeline (docs/sepp-rule-pipeline.md): route every section of an instrument, and find
 * the profile's clause-wording signals in it.
 *
 *   npx tsx scripts/pipeline/route.ts --profile housing-sepp-2021          # write section.route / signals
 *   npx tsx scripts/pipeline/route.ts --profile housing-sepp-2021 --dry
 *
 * Deterministic, no model. Routes (nsw.section.route, migration 18):
 *   structural   chapter / part / division headings
 *   definition   a "Definitions" / "Interpretation" clause or the Dictionary schedule, and everything under it
 *   objective    an "Aim" / "Objective" clause and everything under it
 *   savings      savings and transitional provisions (Sch 7A, or a heading saying so)
 *   schedule     any other schedule content (standards in Sch 1/2/4, design principles in Sch 8/9, station lists)
 *   empty        a section with no text of its own (a clause whose words are all in its subclauses)
 *   oversize     more than 20,000 characters - a finding, never silently truncated (08C lesson)
 *   operative    everything else: where rules are extracted from (step 5)
 * Signals come from profile.signals and are matched case-insensitively on heading + text. A clause's own row
 * often has no text (s 168), so the "done when" check rolls signals up from a clause's descendants.
 */
import 'dotenv/config'
import pg from 'pg'
import type { InstrumentProfile } from '../../profiles/housing-sepp-2021'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : 'housing-sepp-2021'
const OVERSIZE = 20_000

const DEFINITION = /^(definitions?|interpretation|dictionary)\b|—\s*definitions?$|^definitions? for\b/i
const OBJECTIVE = /^(aims?|objectives?)\b/i
const SAVINGS = /savings|transitional/i
const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()

async function main() {
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const doc = (await client.query(`SELECT id FROM nsw.document WHERE instrument_slug = $1`, [profile.slug])).rows[0]
  const secs = (await client.query(
    `SELECT id, parent_id, local_id, level, heading, raw_text FROM nsw.section WHERE document_id = $1`, [doc.id])).rows
  const byId = new Map(secs.map(s => [s.id as string, s]))
  const chain = (s: any) => { const out: any[] = []; for (let x = s; x; x = x.parent_id ? byId.get(x.parent_id) : null) out.push(x); return out }
  const patterns = Object.entries(profile.signals).map(([k, ps]) => [k, ps.map(p => p.toLowerCase())] as const)

  const routed = secs.map((s) => {
    const up = chain(s)
    const text = norm(s.raw_text)
    const schedule = up.find(x => x.level === 'schedule')
    const clause = up.find(x => x.level === 'clause')
    const clauseHeading = norm(clause?.heading)
    let route: string
    if (['chapter', 'part', 'division'].includes(s.level)) route = 'structural'
    else if (text.length > OVERSIZE) route = 'oversize'
    else if (schedule) {
      const sh = norm(schedule.heading)
      route = /dictionary/i.test(sh) ? 'definition'
        : SAVINGS.test(sh) || /^sch\.7A\b/.test(schedule.local_id) ? 'savings'
        : !text ? 'empty' : 'schedule'
    } else if (clause && DEFINITION.test(clauseHeading)) route = 'definition'
    else if (clause && OBJECTIVE.test(clauseHeading)) route = 'objective'
    else if (clause && SAVINGS.test(clauseHeading)) route = 'savings'
    else if (!text) route = 'empty'
    else route = 'operative'
    const hay = `${norm(s.heading)} ${text}`.toLowerCase()
    const signals = patterns.filter(([, ps]) => ps.some(p => hay.includes(p))).map(([k]) => k)
    return { id: s.id as string, local_id: s.local_id as string, level: s.level as string, clause, route, signals }
  })

  if (!DRY) {
    await client.query(
      `UPDATE nsw.section s
          SET route = x.route,
              signals = CASE WHEN x.sig_csv = '' THEN NULL ELSE string_to_array(x.sig_csv, ',') END,
              routed_at = now()
         FROM unnest($1::uuid[], $2::text[], $3::text[]) AS x(id, route, sig_csv)
        WHERE s.id = x.id`,
      [routed.map(r => r.id), routed.map(r => r.route), routed.map(r => r.signals.join(','))])
  }
  await client.end()

  // ── report ──────────────────────────────────────────────────────────────────────────────────────
  const count = new Map<string, number>()
  for (const r of routed) count.set(r.route, (count.get(r.route) ?? 0) + 1)
  console.log(`${DRY ? '[dry] ' : ''}${routed.length} sections routed: ${[...count].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  const unrouted = routed.filter(r => !r.route).length
  const oversize = routed.filter(r => r.route === 'oversize').map(r => r.local_id)
  if (oversize.length) console.log(`  oversize (findings): ${oversize.join(', ')}`)

  // signals rolled up to their clause (a clause row is often empty; its words are in its subclauses)
  const byClause = new Map<string, Set<string>>()
  for (const r of routed) {
    const key = r.level === 'clause' ? r.local_id : r.clause?.local_id
    if (!key) continue
    if (!byClause.has(key)) byClause.set(key, new Set())
    for (const s of r.signals) byClause.get(key)!.add(s)
  }
  const have = (sig: string) => [...byClause].filter(([, s]) => s.has(sig)).map(([k]) => k)
  // the profile's spot check: which clauses each signal must reach, within a numbered range of sections
  const ck = profile.checks?.route
  const [lo, hi] = ck?.sections ?? [-Infinity, Infinity]
  const inRange = (ids: string[]) => ids.filter(k => { const n = Number(k.match(/^sec\.(\d+)/)?.[1]); return n >= lo && n <= hi })
  const expect: Record<string, string[]> = ck?.expect ?? {}
  let pass = unrouted === 0
  console.log(`\n  ${ck?.label ?? 'All'} signals (rolled up to clause):`)
  for (const sig of Object.keys(profile.signals)) {
    const found = inRange(have(sig))
    const want = expect[sig]
    const missing = want ? want.filter(w => !found.includes(w)) : []
    if (missing.length) pass = false
    console.log(`    ${sig.padEnd(26)} ${found.join(' ') || '-'}${want ? (missing.length ? `   MISSING ${missing.join(' ')}` : '   ok') : ''}`)
  }
  console.log(`\n  whole instrument, clauses with each signal: ${Object.keys(profile.signals).map(s => `${s} ${have(s).length}`).join(', ')}`)
  console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${unrouted} sections without a route; ${ck?.label ?? 'profile'} expected signals ${pass ? 'all found' : 'not all found'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
