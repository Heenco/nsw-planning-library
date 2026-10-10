/**
 * RAG pilot - does side D see a lot's mapped controls the way /report-2 shows them? (needs the dev server)
 *
 *   npx tsx scripts/rag/16-compare-report2.ts                 # every lot in the question bank, against http://localhost:3000
 *   npx tsx scripts/rag/16-compare-report2.ts --lots 186430962,100113681
 *   RAG_BASE=http://localhost:3001 npx tsx scripts/rag/16-compare-report2.ts
 *
 * For each lot: /api/report/additional-controls (report-2's Planning constraints, from epi.additional_controls and the
 * plan's words) against /api/rag/lot-controls (rag.map_polygon + rag.area_clause). On the maps report-2 reads, every area
 * either side puts the lot in is matched by (map, label): in both, and do the clauses each names overlap; only in
 * report-2; only in rag. Read-only on both sides; the result goes to rag.run (stage 'compare_report2') for /rag.
 * Basic auth from NUXT_APP_PASSWORD in .env (never printed).
 */
import 'dotenv/config'
import pg from 'pg'

const BASE = process.env.RAG_BASE ?? 'http://localhost:3000'
const AUTH = 'Basic ' + Buffer.from(`x:${process.env.NUXT_APP_PASSWORD ?? ''}`).toString('base64')
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const norm = (s: unknown) => String(s ?? '').trim().replace(/^(?:a|an|the)\s+/i, '').replace(/\s*[-–—]\s*/g, '-').replace(/\s+/g, ' ').toLowerCase()
const mapKey = (s: unknown) => norm(s).replace(/ map$/, '')
/** "sec.4.4-ssec.2B-para1.c" -> "sec.4.4": the clause both sides can agree on */
const clauseOf = (id: string) => id.match(/^(sch\.[^-]+-sec(?:\.[^-]+|-oc\.\d+)|sec\.[^-]+)/)?.[1] ?? id

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: AUTH } })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json() as Promise<any>
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const lots = arg('--lots')?.split(',') ?? (await client.query(`SELECT DISTINCT cadid FROM rag.question WHERE cadid IS NOT NULL AND coalesce(expected->>'status', '') <> 'retired' ORDER BY cadid`)).rows.map(r => String(r.cadid))
  const out: any[] = [], tally: Record<string, number> = { lots: 0, both: 0, clauses_agree: 0, clauses_differ: 0, only_report2: 0, only_rag: 0, errors: 0 }
  for (const cadid of lots) {
    try {
      const [r2, rg] = await Promise.all([get(`/api/report/additional-controls?cadid=${cadid}`), get(`/api/rag/lot-controls?cadid=${cadid}`)])
      tally.lots!++
      const theirs = (r2.controls ?? []).map((c: any) => ({ map: mapKey(c.map), label: norm(c.area ?? c.label), alt: norm(c.label), clauses: [...new Set((c.provisions ?? []).map((p: any) => clauseOf(String(p.localId))))] as string[] }))
      const maps = new Set(theirs.map((t: any) => t.map))
      const ours = [...(rg.areas ?? []).map((a: any) => ({ map: a.map, label: a.label, clauses: [...new Set(a.clauses.map((c: any) => clauseOf(String(c.local_id))))] as string[] })),
        ...(rg.otherLabels ?? []).map((a: any) => ({ map: a.map, label: a.label, clauses: [] as string[] }))].filter((a: any) => maps.has(a.map))
      const rows: any[] = []
      for (const t of theirs) {
        const o = ours.find((x: any) => x.map === t.map && (x.label === t.label || x.label === t.alt))
        if (!o) { rows.push({ result: 'only_report2', map: t.map, label: t.label, report2: t.clauses }); tally.only_report2!++; continue }
        tally.both!++
        const agree = !t.clauses.length || !o.clauses.length ? null : t.clauses.some((c: string) => o.clauses.includes(c))
        if (agree === false) tally.clauses_differ!++; else if (agree) tally.clauses_agree!++
        rows.push({ result: agree === false ? 'clauses_differ' : 'both', map: t.map, label: t.label, report2: t.clauses, rag: o.clauses })
      }
      for (const o of ours) if (o.clauses.length && !theirs.some((t: any) => t.map === o.map && (t.label === o.label || t.alt === o.label))) {
        rows.push({ result: 'only_rag', map: o.map, label: o.label, rag: o.clauses }); tally.only_rag!++
      }
      out.push({ cadid, address: rg.address, plan: rg.plan?.title, rows })
      const odd = rows.filter(r => r.result !== 'both')
      if (odd.length) console.log(cadid, rg.address, odd.map(r => `${r.result}: ${r.map} / ${r.label} (report-2 ${r.report2?.join(' ') ?? '-'}, rag ${r.rag?.join(' ') ?? '-'})`).join('; '))
    } catch (e) { tally.errors!++; out.push({ cadid, error: String(e).slice(0, 160) }); console.log(cadid, 'error', String(e).slice(0, 120)) }
  }
  console.log(tally)
  await client.query(`INSERT INTO rag.run (stage, config, counts, finished_at) VALUES ('compare_report2', $1, $2, now())`, [JSON.stringify({ base: BASE, lots: lots.length }), JSON.stringify({ tally, lots: out })])
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
