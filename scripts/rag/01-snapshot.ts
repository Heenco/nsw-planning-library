/**
 * RAG pilot, Phase 1 - the corpus snapshot (schema `rag`; plan in shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/01-snapshot.ts                 # every instrument in corpus.json that is new or whose source changed
 *   npx tsx scripts/rag/01-snapshot.ts --force         # re-snapshot every instrument
 *   npx tsx scripts/rag/01-snapshot.ts --dry           # counts only
 *
 * The corpus is scripts/rag/corpus.json. An LEP is copied from pilot.node - the CDC session's structure: stems with their
 * list_role, leaves with their connective, tables as table / row / cell nodes. A SEPP's parts in scope are built from
 * nsw.section the same way, with the stem roles read from the stem's own words.
 *
 * Only what changed is replaced. Each instrument's snapshot rows hash to a fingerprint (local id + text); an instrument
 * whose fingerprint is unchanged keeps its provisions - and so its chunks, model contexts and embeddings, which hang off
 * the provision ids. Provision ids are stable across rebuilds: the pilot reissues every node id each time it runs (same
 * local ids, same words), so a provision keeps the id it already had for its local id, and a new one is derived from
 * the instrument and the local id. An instrument dropped from corpus.json is removed.
 *
 * A section's own text excludes a table the ingest flattened into it: the table is its own node, and left in the
 * sentence it dragged hundreds of Lot/DPs into Randwick Sch 5 (the cut is the pilot's own_text rule - at the whole
 * first row of the first attached table).
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const DRY = process.argv.includes('--dry'), FORCE = process.argv.includes('--force')
const CORPUS = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8')) as { leps: string[]; sepps: { title: string; scope: string[] }[] }
const CONTAINER_KINDS = new Set(['part', 'division', 'subdivision', 'chapter', 'schedule'])

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
/** what an instrument's snapshot is: its rows' places and words - not ids, not the parents later stages move */
const fingerprint = (rows: { local_id: string; content_sha: string }[]) => sha(rows.map(r => `${r.local_id}|${r.content_sha}`).sort().join('\n'))
const uuidOf = (s: string) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` }
/** the id a provision keeps: the one it already has for its local id, else one derived from the instrument and local id */
const stableIds = (rows: Row[], had: Map<string, string>) => {
  const idOf = new Map(rows.map(r => [r.id, had.get(r.local_id) ?? uuidOf(`rag-provision|${r.document_id}|${r.local_id}`)]))
  return rows.map(r => ({ ...r, id: idOf.get(r.id)!, parent_id: r.parent_id ? idOf.get(r.parent_id) ?? null : null }))
}

/** A stem's role, read from its own closing words - the same roles the pilot uses. */
function stemRole(t: string): string | null {
  if (!/[—:]\s*$/.test(t)) return null
  if (/\bunless\b[^.]*[—:]\s*$/i.test(t)) return 'exception'
  if (/\b(applies|apply)\b[^.]*\b(to|if|only if)\b[^.]*[—:]\s*$/i.test(t)) return 'applicability'
  if (/\b(if|where|when)\s*[—:]\s*$/i.test(t)) return 'condition'
  if (/\b(at least|not less than|not more than|must not exceed|maximum|minimum)\b[^.]*[—:]\s*$/i.test(t)) return 'value'
  if (/\b(consider|take into consideration|satisfied)\b[^.]*[—:]\s*$/i.test(t)) return 'matters'
  if (/\bmeans\b[^.]*[—:]\s*$/i.test(t)) return 'interpretation'
  if (/\bfollowing\b[^.]*[—:]\s*$/i.test(t)) return 'list'
  return 'list'
}
const connectiveOf = (t: string) => /[,;]?\s+and\s*$/i.test(t) ? 'and' : /[,;]?\s+or\s*$/i.test(t) ? 'or' : null

interface Row {
  id: string; document_id: string; section_id: string | null; pilot_node_id: string | null; parent_id: string | null
  local_id: string; kind: string; heading: string | null; own_text: string; list_role: string | null; connective: string | null
  ordinal: number | null; path: string[]; container: string | null; sort: number; content_sha: string
}
type Q = (sql: string, p?: unknown[]) => Promise<pg.QueryResult<any>>

/** an LEP, or a SEPP taken whole: the pilot's nodes (a scope keeps only the top-level units named and what is under them) */
async function lepRows(q: Q, doc: any, scope: string[] | null = null) {
  const pilotRuns = (await q(`SELECT DISTINCT ON (stage) stage, id, started_at FROM pilot.run WHERE document_id = $1 ORDER BY stage, started_at DESC`, [doc.id])).rows
  const all = (await q(`
    SELECT n.id, n.section_id, n.parent_id, n.local_id, n.kind, n.ordinal, n.heading, n.text, n.connective, n.list_role, n.run_id,
           coalesce(s.sort_order, ps.sort_order) AS sort
      FROM pilot.node n LEFT JOIN nsw.section s ON s.id = n.section_id
      LEFT JOIN pilot.node p ON p.id = n.parent_id LEFT JOIN nsw.section ps ON ps.id = p.section_id
     WHERE n.document_id = $1`, [doc.id])).rows
  const allById = new Map(all.map(n => [n.id, n]))
  const topOf = (n: any) => { let x = n; while (x.parent_id && allById.get(x.parent_id)) x = allById.get(x.parent_id); return x.local_id }
  const nodes = scope ? all.filter(n => scope.includes(topOf(n))) : all
  const byId = new Map(nodes.map(n => [n.id, n]))
  const kids = new Map<string, any[]>()
  for (const n of nodes) if (n.parent_id) { if (!kids.has(n.parent_id)) kids.set(n.parent_id, []); kids.get(n.parent_id)!.push(n) }
  for (const v of kids.values()) v.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
  // the pilot's own_text: cut a flattened table at its whole first row
  const ownText = (n: any) => {
    let t = norm(n.text)
    for (const tb of (kids.get(n.id) ?? []).filter(k => k.kind === 'table')) {
      const firstRow = (kids.get(tb.id) ?? [])[0]
      const marker = firstRow ? (kids.get(firstRow.id) ?? []).map(c => norm(c.text)).filter(Boolean).join(' ') : ''
      if (marker && t.includes(marker)) { t = t.slice(0, t.indexOf(marker)).trimEnd(); break }
    }
    return t
  }
  const pathOf = (n: any) => { const out: string[] = []; for (let p = n.parent_id ? byId.get(n.parent_id) : null; p; p = p.parent_id ? byId.get(p.parent_id) : null) out.unshift(p.local_id); return out }
  const containerOf = (n: any) => { for (let p = n.parent_id ? byId.get(n.parent_id) : null; p; p = p.parent_id ? byId.get(p.parent_id) : null) if (CONTAINER_KINDS.has(p.kind)) return p.local_id; return null }
  const rows: Row[] = nodes.map(n => {
    const t = ownText(n)
    return { id: n.id, document_id: doc.id, section_id: n.section_id, pilot_node_id: n.id, parent_id: n.parent_id, local_id: n.local_id, kind: n.kind,
      heading: n.heading, own_text: t, list_role: n.list_role, connective: n.connective, ordinal: n.ordinal, path: pathOf(n), container: containerOf(n),
      sort: Number(n.sort ?? 0), content_sha: sha(`${n.local_id}|${t}`) }
  })
  return { rows, source: { pilot_runs: pilotRuns.map(r => ({ stage: r.stage, id: r.id, started_at: r.started_at })) } }
}

/** a SEPP: the scoped parts from nsw.section */
async function seppRows(q: Q, doc: any, scope: string[]) {
  const secs = (await q(`SELECT id, parent_id, local_id, level, heading, raw_text, route, sort_order FROM nsw.section WHERE document_id = $1 ORDER BY sort_order`, [doc.id])).rows
  const sById = new Map(secs.map(s => [s.id, s]))
  const sKids = new Map<string, any[]>()
  for (const s of secs) if (s.parent_id) { if (!sKids.has(s.parent_id)) sKids.set(s.parent_id, []); sKids.get(s.parent_id)!.push(s) }
  const inScope = new Set<string>()
  const walk = (s: any) => { inScope.add(s.id); for (const k of sKids.get(s.id) ?? []) walk(k) }
  secs.filter(s => scope.includes(s.local_id)).forEach(walk)
  const sPath = (s: any) => { const out: string[] = []; for (let p = s.parent_id ? sById.get(s.parent_id) : null; p; p = p.parent_id ? sById.get(p.parent_id) : null) out.unshift(p.local_id); return out }
  const sContainer = (s: any) => { for (let p = s.parent_id ? sById.get(s.parent_id) : null; p; p = p.parent_id ? sById.get(p.parent_id) : null) if (CONTAINER_KINDS.has(p.level)) return p.local_id; return null }
  const rows: Row[] = secs.filter(s => inScope.has(s.id)).map((s, i) => {
    const t = norm(s.raw_text)
    const kind = s.route === 'objective' ? 'objective' : s.route === 'definition' ? 'definition' : s.level
    const hasKids = (sKids.get(s.id) ?? []).length > 0
    return { id: s.id, document_id: doc.id, section_id: s.id, pilot_node_id: null, parent_id: s.parent_id && inScope.has(s.parent_id) ? s.parent_id : null,
      local_id: s.local_id, kind, heading: s.heading, own_text: t, list_role: hasKids ? stemRole(t) : null, connective: connectiveOf(t),
      ordinal: i, path: sPath(s), container: sContainer(s), sort: Number(s.sort_order ?? i), content_sha: sha(`${s.local_id}|${t}`) }
  })
  return { rows, source: { scope, sections: secs.length } }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q: Q = (sql, p = []) => client.query(sql, p as any[])
  const doc = async (title: string) => {
    const d = (await q(`SELECT id, title, instrument_slug, doc_type, source_url, (as_at_date AT TIME ZONE 'Australia/Sydney')::date::text AS as_at FROM nsw.document WHERE title = $1`, [title])).rows[0]
    if (!d) throw new Error(`corpus.json names "${title}", which is not in nsw.document`)
    return d
  }
  // a SEPP whose tables matter (the Codes SEPP's standards are tables by lot width) takes the pilot tree like an LEP:
  // nsw.section flattens tables into text. route 'pilot' with no scope is the whole instrument
  const wanted = [...CORPUS.leps.map(t => ({ title: t, kind: 'lep' as const, rank: 20, scope: null as string[] | null, route: 'pilot' as const })),
                  ...CORPUS.sepps.map(s => ({ title: s.title, kind: 'sepp' as const, rank: 30, scope: s.scope ?? null, route: (s.route ?? 'section') as 'pilot' | 'section' }))]
  const held = new Map<string, any>((await q(`SELECT document_id, title, source_fingerprint, snapshot_run FROM rag.instrument`)).rows.map(r => [r.document_id, r]))

  const plan: { d: any; w: typeof wanted[number]; rows: Row[]; source: any; fp: string; action: 'new' | 'changed' | 'unchanged' | 'forced' }[] = []
  for (const w of wanted) {
    const d = await doc(w.title)
    const got = w.route === 'pilot' ? await lepRows(q, d, w.scope) : await seppRows(q, d, w.scope!), source = got.source
    const had = new Map<string, string>((await q(`SELECT local_id, id FROM rag.provision WHERE document_id = $1`, [d.id])).rows.map(r => [r.local_id, r.id]))
    const rows = stableIds(got.rows, had)
    if (!rows.length) throw new Error(`${w.title}: no ${w.route === 'pilot' ? 'pilot.node rows - run the CDC pilot structure for it first' : 'nsw.section rows in scope'}`)
    const fp = fingerprint(rows), h = held.get(d.id)
    // an instrument loaded before fingerprints were kept: its own snapshot rows give the fingerprint it had
    const was = h?.source_fingerprint ?? (h ? fingerprint((await q(`SELECT local_id, content_sha FROM rag.provision WHERE document_id = $1 AND snapshot_run = $2`, [d.id, h.snapshot_run])).rows) : null)
    plan.push({ d, w, rows, source, fp, action: !h ? 'new' : FORCE ? 'forced' : was === fp ? 'unchanged' : 'changed' })
  }
  const drop = [...held.values()].filter(h => !plan.some(p => p.d.id === h.document_id))
  const counts = (rows: Row[]) => Object.fromEntries(Object.entries(rows.reduce((a: Record<string, number>, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 8))
  for (const p of plan) console.log(`${p.action.padEnd(9)} ${p.w.kind} ${p.d.title} (as at ${p.d.as_at}): ${p.rows.length} provisions`, counts(p.rows),
    p.w.route === 'pilot' ? `pilot ${p.source.pilot_runs.map((r: any) => `${r.stage}@${new Date(r.started_at).toISOString().slice(0, 16)}`).join(', ')}${p.w.scope ? ` scope ${p.w.scope.join(', ')}` : ''}` : `scope ${p.w.scope!.join(', ')}`)
  for (const h of drop) console.log(`drop      ${h.title} (no longer in corpus.json)`)
  const todo = plan.filter(p => p.action !== 'unchanged')
  if (DRY || (!todo.length && !drop.length)) { if (!todo.length && !drop.length) console.log('nothing to do'); await client.end(); return }

  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('snapshot', $1) RETURNING id`,
    [JSON.stringify({ corpus: CORPUS, replaced: todo.map(p => p.d.title), dropped: drop.map(h => h.title), sources: Object.fromEntries(todo.map(p => [p.d.title, p.source])) })])).rows[0].id
  // replace: what hangs off the old provisions goes first. Claims, bindings and terms are rebuilt by later stages for
  // every instrument; a relation from an instrument kept to one replaced loses its ends and is rebuilt by 02-relations
  const gone = [...todo.map(p => p.d.id), ...drop.map(h => h.document_id)]
  if (gone.length) {
    const ids = `SELECT id FROM rag.provision WHERE document_id = ANY($1::uuid[])`
    await q(`DELETE FROM rag.embedding WHERE chunk_id IN (SELECT id FROM rag.chunk WHERE provision_id IN (${ids}))`, [gone])
    await q(`DELETE FROM rag.chunk WHERE provision_id IN (${ids})`, [gone])
    await q(`DELETE FROM rag.relation WHERE from_provision IN (${ids}) OR to_provision IN (${ids})`, [gone])
    await q(`UPDATE rag.relation SET authority_provision = NULL WHERE authority_provision IN (${ids})`, [gone])
    await q(`UPDATE rag.adjudication SET source_provision = NULL WHERE source_provision IN (${ids})`, [gone]).catch(() => null)
    await q(`DELETE FROM rag.claim WHERE provision_id IN (${ids}) OR unit_provision IN (${ids})`, [gone]).catch(() => null)
    await q(`UPDATE rag.provision SET parent_id = NULL WHERE document_id = ANY($1::uuid[])`, [gone])
    await q(`DELETE FROM rag.provision WHERE document_id = ANY($1::uuid[])`, [gone])
  }
  for (const h of drop) await q(`DELETE FROM rag.instrument WHERE document_id = $1`, [h.document_id])
  // EP&A Act s 3.28 fallback ranks, on the CDC pilot's scale (dcp 10 / lep 20 / sepp 30) so one resolver serves both
  for (const p of plan)
    await q(`INSERT INTO rag.instrument (document_id, title, slug, kind, rank, scope, source_url, snapshot_run, source_fingerprint, as_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (document_id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, kind = EXCLUDED.kind, rank = EXCLUDED.rank, scope = EXCLUDED.scope,
               source_url = EXCLUDED.source_url, as_at = EXCLUDED.as_at, source_fingerprint = EXCLUDED.source_fingerprint,
               snapshot_run = CASE WHEN $11 THEN EXCLUDED.snapshot_run ELSE rag.instrument.snapshot_run END`,
      [p.d.id, p.d.title, p.d.instrument_slug, p.w.kind, p.w.rank, p.w.scope, p.d.source_url, run, p.fp, p.d.as_at, p.action !== 'unchanged'])
  // parents before children: batches are separate statements, so a parent must land in the same or an earlier one.
  // One statement per batch: a self-referencing FK is checked at the end of the statement
  const all = todo.flatMap(p => p.rows).sort((a, b) => a.path.length - b.path.length)
  for (let i = 0; i < all.length; i += 2000) {
    const batch = all.slice(i, i + 2000).map(r => ({ ...r, snapshot_run: run }))
    await q(`INSERT INTO rag.provision (id, document_id, section_id, pilot_node_id, parent_id, local_id, kind, heading, own_text, list_role, connective, ordinal, path, container, sort, content_sha, snapshot_run)
             SELECT id, document_id, section_id, pilot_node_id, parent_id, local_id, kind, heading, own_text, list_role, connective, ordinal, path, container, sort, content_sha, snapshot_run
               FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, document_id uuid, section_id uuid, pilot_node_id uuid, parent_id uuid, local_id text, kind text, heading text,
                    own_text text, list_role text, connective text, ordinal int, path text[], container text, sort int, content_sha text, snapshot_run uuid)`, [JSON.stringify(batch)])
  }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify(Object.fromEntries(plan.map(p => [p.d.title, { action: p.action, provisions: p.rows.length }])))])
  await q('COMMIT')
  console.log(`\nwritten: run ${run} - replaced ${todo.length}, dropped ${drop.length}, kept ${plan.length - todo.length}`)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
