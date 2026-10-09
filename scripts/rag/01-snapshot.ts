/**
 * RAG pilot, Phase 1 - the corpus snapshot (schema `rag`; plan in shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/01-snapshot.ts            # rebuild both instruments
 *   npx tsx scripts/rag/01-snapshot.ts --dry      # counts only
 *
 * Randwick LEP 2012 is copied from pilot.node - the CDC session's structure: stems with their list_role, leaves with
 * their connective, tables as table / row / cell nodes - and stamped with the pilot run it came from, because the pilot
 * is rebuilt several times a day. The Housing SEPP parts in scope are built from nsw.section the same way, with the
 * stem roles read from the stem's own words.
 *
 * A section's own text excludes a table the ingest flattened into it: the table is its own node, and left in the
 * sentence it dragged hundreds of Lot/DPs into Randwick Sch 5 (the cut is the pilot's own_text rule - at the whole
 * first row of the first attached table).
 */
import 'dotenv/config'
import { createHash } from 'node:crypto'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const RANDWICK = 'Randwick Local Environmental Plan 2012'
const HOUSING = 'State Environmental Planning Policy (Housing) 2021'
const HOUSING_SCOPE = ['ch.1', 'ch.3-pt.1', 'ch.6', 'sch.1', 'sch.7A', 'sch.10']
const CONTAINER_KINDS = new Set(['part', 'division', 'subdivision', 'chapter', 'schedule'])

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

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

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const doc = async (title: string) => (await q(`SELECT id, title, instrument_slug, doc_type, source_url FROM nsw.document WHERE title = $1`, [title])).rows[0]
  const R = await doc(RANDWICK), H = await doc(HOUSING)

  // ── Randwick: the pilot's nodes ───────────────────────────────────────────────────────────────
  const pilotRuns = (await q(`SELECT DISTINCT ON (stage) stage, id, started_at FROM pilot.run WHERE document_id = $1 ORDER BY stage, started_at DESC`, [R.id])).rows
  const nodes = (await q(`
    SELECT n.id, n.section_id, n.parent_id, n.local_id, n.kind, n.ordinal, n.heading, n.text, n.connective, n.list_role, n.run_id,
           coalesce(s.sort_order, ps.sort_order) AS sort
      FROM pilot.node n LEFT JOIN nsw.section s ON s.id = n.section_id
      LEFT JOIN pilot.node p ON p.id = n.parent_id LEFT JOIN nsw.section ps ON ps.id = p.section_id
     WHERE n.document_id = $1`, [R.id])).rows
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
  const randwick: Row[] = nodes.map(n => {
    const t = ownText(n)
    return { id: n.id, document_id: R.id, section_id: n.section_id, pilot_node_id: n.id, parent_id: n.parent_id, local_id: n.local_id, kind: n.kind,
      heading: n.heading, own_text: t, list_role: n.list_role, connective: n.connective, ordinal: n.ordinal, path: pathOf(n), container: containerOf(n),
      sort: Number(n.sort ?? 0), content_sha: sha(`${n.local_id}|${t}`) }
  })

  // ── Housing SEPP: the scoped parts from nsw.section ──────────────────────────────────────────
  const secs = (await q(`SELECT id, parent_id, local_id, level, heading, raw_text, route, sort_order FROM nsw.section WHERE document_id = $1 ORDER BY sort_order`, [H.id])).rows
  const sById = new Map(secs.map(s => [s.id, s]))
  const sKids = new Map<string, any[]>()
  for (const s of secs) if (s.parent_id) { if (!sKids.has(s.parent_id)) sKids.set(s.parent_id, []); sKids.get(s.parent_id)!.push(s) }
  const inScope = new Set<string>()
  const roots = secs.filter(s => HOUSING_SCOPE.includes(s.local_id))
  const walk = (s: any) => { inScope.add(s.id); for (const k of sKids.get(s.id) ?? []) walk(k) }
  roots.forEach(walk)
  const sPath = (s: any) => { const out: string[] = []; for (let p = s.parent_id ? sById.get(s.parent_id) : null; p; p = p.parent_id ? sById.get(p.parent_id) : null) out.unshift(p.local_id); return out }
  const sContainer = (s: any) => { for (let p = s.parent_id ? sById.get(s.parent_id) : null; p; p = p.parent_id ? sById.get(p.parent_id) : null) if (CONTAINER_KINDS.has(p.level)) return p.local_id; return null }
  const housing: Row[] = secs.filter(s => inScope.has(s.id)).map((s, i) => {
    const t = norm(s.raw_text)
    const kind = s.route === 'objective' ? 'objective' : s.route === 'definition' ? 'definition' : s.level
    const hasKids = (sKids.get(s.id) ?? []).length > 0
    return { id: s.id, document_id: H.id, section_id: s.id, pilot_node_id: null, parent_id: s.parent_id && inScope.has(s.parent_id) ? s.parent_id : null,
      local_id: s.local_id, kind, heading: s.heading, own_text: t, list_role: hasKids ? stemRole(t) : null, connective: connectiveOf(t),
      ordinal: i, path: sPath(s), container: sContainer(s), sort: Number(s.sort_order ?? i), content_sha: sha(`${s.local_id}|${t}`) }
  })

  // parents before children: batches are separate statements, so a parent must land in the same or an earlier one
  const all = [...randwick, ...housing].sort((a, b) => a.path.length - b.path.length)
  const counts = (rows: Row[]) => Object.fromEntries(Object.entries(rows.reduce((a: Record<string, number>, r) => ({ ...a, [r.kind]: (a[r.kind] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]))
  const sch5 = randwick.filter(r => r.local_id === 'sch.5' || r.local_id.startsWith('sch.5-')).filter(r => r.kind !== 'cell' && r.kind !== 'row')
  const sch5Max = Math.max(0, ...sch5.map(r => r.own_text.length))
  const stems = housing.filter(r => r.list_role).length, conns = housing.filter(r => r.connective).length
  console.log(`Randwick: ${randwick.length} provisions`, counts(randwick))
  console.log(`  pilot runs: ${pilotRuns.map(r => `${r.stage}@${new Date(r.started_at).toISOString().slice(0, 16)}`).join(', ')}`)
  console.log(`  Sch 5 longest own_text (non-row/cell): ${sch5Max} chars  (a flattened heritage list would be tens of thousands)`)
  console.log(`  missing path on non-root: ${randwick.filter(r => r.parent_id && !r.path.length).length}`)
  console.log(`Housing SEPP (${HOUSING_SCOPE.join(', ')}): ${housing.length} provisions`, counts(housing), `stems ${stems}, leaves with a connective ${conns}`)
  if (DRY) { await client.end(); return }

  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('snapshot', $1) RETURNING id`,
    [JSON.stringify({ housing_scope: HOUSING_SCOPE, pilot_runs: pilotRuns.map(r => ({ stage: r.stage, id: r.id, started_at: r.started_at })) })])).rows[0].id
  // replace: relations and chunks hang off provisions, so they go first (none survive a re-snapshot)
  await q(`DELETE FROM rag.embedding WHERE chunk_id IN (SELECT c.id FROM rag.chunk c JOIN rag.provision p ON p.id = c.provision_id WHERE p.document_id = ANY($1))`, [[R.id, H.id]])
  await q(`DELETE FROM rag.chunk WHERE provision_id IN (SELECT id FROM rag.provision WHERE document_id = ANY($1))`, [[R.id, H.id]])
  await q(`DELETE FROM rag.relation WHERE from_provision IN (SELECT id FROM rag.provision WHERE document_id = ANY($1)) OR to_provision IN (SELECT id FROM rag.provision WHERE document_id = ANY($1))`, [[R.id, H.id]])
  await q(`DELETE FROM rag.provision WHERE document_id = ANY($1)`, [[R.id, H.id]])
  for (const [d, kind, rank, scope] of [[R, 'lep', 10, null], [H, 'sepp', 20, HOUSING_SCOPE]] as const)
    await q(`INSERT INTO rag.instrument (document_id, title, slug, kind, rank, scope, source_url, snapshot_run) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (document_id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, kind = EXCLUDED.kind, rank = EXCLUDED.rank,
               scope = EXCLUDED.scope, source_url = EXCLUDED.source_url, snapshot_run = EXCLUDED.snapshot_run`,
      [d.id, d.title, d.instrument_slug, kind, rank, scope, d.source_url, run])
  // one statement per batch: a self-referencing FK is checked at the end of the statement, so parents and children can share it
  for (let i = 0; i < all.length; i += 2000) {
    const batch = all.slice(i, i + 2000).map(r => ({ ...r, snapshot_run: run }))
    await q(`INSERT INTO rag.provision (id, document_id, section_id, pilot_node_id, parent_id, local_id, kind, heading, own_text, list_role, connective, ordinal, path, container, sort, content_sha, snapshot_run)
             SELECT id, document_id, section_id, pilot_node_id, parent_id, local_id, kind, heading, own_text, list_role, connective, ordinal, path, container, sort, content_sha, snapshot_run
               FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, document_id uuid, section_id uuid, pilot_node_id uuid, parent_id uuid, local_id text, kind text, heading text,
                    own_text text, list_role text, connective text, ordinal int, path text[], container text, sort int, content_sha text, snapshot_run uuid)`, [JSON.stringify(batch)])
  }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ randwick: randwick.length, housing: housing.length, randwick_kinds: counts(randwick), housing_kinds: counts(housing), housing_stems: stems })])
  await q('COMMIT')
  console.log(`\nwritten: run ${run}`)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
