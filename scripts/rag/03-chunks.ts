/**
 * RAG pilot, Phase 3.1 - retrieval chunks with deterministic headers (schema rag; plan shared/rag-plan.ts, page /rag).
 *
 *   npx tsx scripts/rag/03-chunks.ts            # rebuild rag.chunk (embeddings of unchanged chunks are kept)
 *   npx tsx scripts/rag/03-chunks.ts --dry      # counts and samples
 *
 * A chunk never loses its stem. The unit is the whole clause when it fits (MAX_CHARS) - "whole-clause reading" - and
 * otherwise each subclause, recursively, with the stem kept as a chunk of its own; every chunk is headed by its place in
 * the instrument: "Randwick LEP 2012 > Part 4 Principal development standards > 4.4A Exceptions to floor space ratio -
 * Zones R2 and R3 > (2)". Land Use Table items carry their zone (01b-groups.py). Generic: nothing names a clause.
 *
 *   unit        a clause, or a subclause of a clause too long to read whole
 *   stem        the own words of a clause or subclause that had to be split (so "This section applies only if-" is found)
 *   row         one row of a control table, as "caption: value; ...", headed by the clause it sits in
 *   definition  one term, headed by the dictionary or clause that scopes it
 *
 * Register tables (a table that is the whole of a schedule part - Sch 5 heritage items, Sch 4 land classification) are
 * not chunked: they are data, served as lot facts. Their row counts are reported.
 */
import 'dotenv/config'
import pg from 'pg'
import { createHash } from 'node:crypto'

const DRY = process.argv.includes('--dry')
const MAX_CHARS = 4000
const STRUCTURAL = new Set(['part', 'division', 'chapter', 'schedule', 'dictionary', 'group'])
const SKIP = new Set(['table', 'row', 'cell', 'term', 'empty'])

interface P { id: string; document_id: string; parent_id: string | null; local_id: string; kind: string; heading: string | null; own_text: string; sort: number; ordinal: number | null }
interface Chunk { id: string; provision_id: string; role: string; header: string; body: string; tokens: number; content_sha: string }

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const uuidOf = (s: string) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` }
const sha = (s: string) => createHash('sha1').update(s).digest('hex')

/** "Randwick Local Environmental Plan 2012" -> "Randwick LEP 2012"; "State Environmental Planning Policy (Housing) 2021" -> "Housing SEPP 2021" */
const shortTitle = (t: string) => t.replace(/^State Environmental Planning Policy \(([^)]+)\) (\d{4})$/, '$1 SEPP $2').replace(/Local Environmental Plan/, 'LEP')

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect()
  const q = (sql: string, p: unknown[] = []) => client.query(sql, p as any[])
  const insts = new Map((await q(`SELECT document_id, title, kind FROM rag.instrument`)).rows.map(r => [r.document_id as string, r]))
  const provs: P[] = (await q(`SELECT id, document_id, parent_id, local_id, kind, heading, coalesce(own_text, '') own_text, sort, ordinal FROM rag.provision`)).rows
  const byId = new Map(provs.map(p => [p.id, p]))
  const kids = new Map<string, P[]>()
  for (const p of provs) if (p.parent_id) { if (!kids.has(p.parent_id)) kids.set(p.parent_id, []); kids.get(p.parent_id)!.push(p) }
  for (const v of kids.values()) v.sort((a, b) => a.sort - b.sort || (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.local_id.localeCompare(b.local_id))
  const isSepp = (p: P) => insts.get(p.document_id)?.kind === 'sepp'

  /** what a provision is called where it sits: "Part 4", "4.4A", "s 168", "(2)", "(a)", "Schedule 1" */
  const labelOf = (p: P): string => {
    const segs = p.local_id.split('#')[0]!.split('-').filter(s => !/^oc\.\d+$/.test(s))
    const last = segs.at(-1) ?? ''
    let m: RegExpMatchArray | null
    if (p.kind === 'group' || p.kind === 'term') return ''
    if ((m = last.match(/^pt\.(.+)$/))) return `Part ${m[1]}`
    if ((m = last.match(/^ch\.(.+)$/))) return `Chapter ${m[1]}`
    if ((m = last.match(/^sch\.(.+)$/))) return `Schedule ${m[1]}`
    if ((m = last.match(/^s?div\.(.+)$/))) return `${last.startsWith('s') ? 'Subdivision' : 'Division'} ${m[1]}`
    if ((m = last.match(/^sec\.(.+)$/))) return isSepp(p) || segs.length > 1 ? `s ${m[1]}` : m[1]!
    if ((m = last.match(/^ssec\.(.+)$/))) return `(${m[1]})`
    if ((m = last.match(/^para\d\.(.+)$/))) return `(${m[1]})`
    if (last === 'dict') return 'Dictionary'
    return ''
  }
  const titleOf = (p: P) => {
    if (p.kind === 'term') return ''
    const lab = labelOf(p), head = p.heading && !['head', 'body'].includes(p.heading) ? norm(p.heading) : ''
    return head.toLowerCase().startsWith(lab.toLowerCase()) && lab ? head : norm(`${lab} ${head}`)     // "Dictionary", not "Dictionary Dictionary"
  }
  const ancestors = (p: P): P[] => { const out: P[] = []; for (let x = p.parent_id ? byId.get(p.parent_id) : undefined; x; x = x.parent_id ? byId.get(x.parent_id) : undefined) out.unshift(x); return out }
  const headerOf = (p: P, extra?: string) => [shortTitle(insts.get(p.document_id)!.title), ...ancestors(p).map(titleOf).filter(Boolean), titleOf(p) || null, extra ?? null].filter(Boolean).join(' > ')

  // register tables: the whole of a schedule part (or schedule) - data, not text to retrieve
  const isRegister = (t: P) => { const pa = t.parent_id ? byId.get(t.parent_id) : undefined; return !!pa && STRUCTURAL.has(pa.kind) && /^sch\./.test(pa.local_id) }
  // an empty cell under a filled one is a row-spanned cell: it carries the value above (as the pilot reads it)
  const filled = new Map<string, string>()
  for (const t of provs.filter(p => p.kind === 'table')) {
    const above: string[] = []
    for (const r of (kids.get(t.id) ?? []).filter(r => r.kind === 'row' && r.heading !== 'head')) {
      const cells = (kids.get(r.id) ?? []).filter(c => c.kind === 'cell')
      const parts = cells.map((c, i) => { const v = norm(c.own_text) || above[i] || ''; above[i] = v; return `${norm(c.heading) || `column ${i + 1}`}: ${v || '-'}` })
      filled.set(r.id, parts.join('; '))
    }
  }
  const rowText = (r: P) => filled.get(r.id) || norm(r.own_text)

  /** the provision and everything under it, labelled, tables inline as rows */
  const render = (p: P, depth = 0): string => {
    const lines: string[] = []
    const own = norm(p.own_text)
    const lab = depth === 0 ? '' : labelOf(p)
    if (p.kind === 'table') {
      if (isRegister(p)) return ''
      for (const r of kids.get(p.id) ?? []) if (r.kind === 'row' && r.heading !== 'head') lines.push(`${'  '.repeat(depth)}- ${rowText(r)}`)
      return lines.join('\n')
    }
    if (own || lab) lines.push(`${'  '.repeat(depth)}${p.kind === 'note' ? 'Note: ' : ''}${lab ? lab + ' ' : ''}${own}`.trimEnd())
    for (const k of kids.get(p.id) ?? []) if (!['row', 'cell', 'term', 'empty'].includes(k.kind)) { const r = render(k, depth + 1); if (r) lines.push(r) }
    return lines.join('\n')
  }

  const chunks: Chunk[] = []
  const push = (p: P, role: string, header: string, body: string) => {
    body = body.trim(); if (!body) return
    chunks.push({ id: uuidOf(`${p.id}|${role}`), provision_id: p.id, role, header, body, tokens: Math.ceil((header.length + body.length) / 4), content_sha: sha(`${header}\n${body}`) })
  }
  const stats = { register_rows: 0, split: 0, dictionaries: 0 }

  // a dictionary is read through its terms: a provision too long to be one chunk whose words are terms is not chunked itself
  const isDictionary = (p: P) => norm(p.own_text).length > MAX_CHARS && (kids.get(p.id) ?? []).some(k => k.kind === 'term')
  const unitize = (p: P) => {
    if (SKIP.has(p.kind)) return
    if (isDictionary(p)) { stats.dictionaries++; for (const k of kids.get(p.id) ?? []) if (k.kind !== 'term') unitize(k); return }
    if (STRUCTURAL.has(p.kind)) {
      if (norm(p.own_text).length >= 40) push(p, 'stem', headerOf(p), norm(p.own_text))
      for (const k of kids.get(p.id) ?? []) unitize(k)
      return
    }
    const body = render(p)
    const childUnits = (kids.get(p.id) ?? []).filter(k => !SKIP.has(k.kind))
    if (body.length <= MAX_CHARS || !childUnits.length) push(p, 'unit', headerOf(p), body)
    else {
      stats.split++
      if (norm(p.own_text)) push(p, 'stem', headerOf(p), norm(p.own_text))
      for (const k of kids.get(p.id) ?? []) if (k.kind === 'table') { /* rows below */ } else unitize(k)
    }
  }
  const roots = provs.filter(p => !p.parent_id)
  for (const r of roots) unitize(r)

  // control-table rows, each on its own (the 4.4A row a question about 0.65:1 must find)
  for (const t of provs.filter(p => p.kind === 'table')) {
    const rows = (kids.get(t.id) ?? []).filter(r => r.kind === 'row' && r.heading !== 'head')
    if (isRegister(t)) { stats.register_rows += rows.length; continue }
    const holder = t.parent_id ? byId.get(t.parent_id)! : t
    for (const r of rows) push(r, 'row', headerOf(holder, 'table row'), rowText(r))
  }

  // terms, each headed by the scope that holds it
  for (const t of provs.filter(p => p.kind === 'term')) push(t, 'definition', headerOf(t, `"${norm(t.heading)}"`), norm(t.own_text))

  const byRole = chunks.reduce((a: Record<string, number>, c) => ({ ...a, [c.role]: (a[c.role] ?? 0) + 1 }), {})
  const tokens = chunks.reduce((a, c) => a + c.tokens, 0)
  const longest = [...chunks].sort((a, b) => b.tokens - a.tokens).slice(0, 3).map(c => `${c.header.slice(0, 90)} (${c.tokens})`)
  console.log('chunks', chunks.length, byRole, 'tokens', tokens, stats, '\nlongest', longest)
  for (const probe of [/> 4\.4A /, /> s 169 /, /4\.4A .*table row/, /Zone R2 Low Density Residential > 3 /, /"secondary dwelling"$/]) {
    const c = chunks.find(c => probe.test(c.header)); if (c) console.log('\n--', c.role, '|', c.header, '\n' + c.body.slice(0, 700))
  }
  if (DRY) { await client.end(); return }

  await q('BEGIN')
  const run = (await q(`INSERT INTO rag.run (stage, config) VALUES ('chunks', $1) RETURNING id`, [JSON.stringify({ max_chars: MAX_CHARS })])).rows[0].id
  const old = new Map((await q(`SELECT id, content_sha FROM rag.chunk`)).rows.map(r => [r.id as string, r.content_sha as string]))
  const keep = new Set(chunks.map(c => c.id))
  await q(`DELETE FROM rag.chunk WHERE NOT (id = ANY($1::uuid[]))`, [[...keep]])
  const changed = chunks.filter(c => old.get(c.id) !== c.content_sha)
  // a changed chunk loses its embeddings and its model-written context: both were made from the old text
  await q(`DELETE FROM rag.embedding WHERE chunk_id = ANY($1::uuid[])`, [changed.map(c => c.id)])
  for (let i = 0; i < changed.length; i += 1000) {
    await q(`INSERT INTO rag.chunk (id, provision_id, role, header, body, tokens, content_sha, run_id, tsv)
             SELECT id, provision_id, role, header, body, tokens, content_sha, $2, to_tsvector('english', header || ' ' || body)
               FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, provision_id uuid, role text, header text, body text, tokens int, content_sha text)
             ON CONFLICT (id) DO UPDATE SET role = excluded.role, header = excluded.header, body = excluded.body, tokens = excluded.tokens,
               content_sha = excluded.content_sha, run_id = excluded.run_id, tsv = excluded.tsv, llm_context = NULL`, [JSON.stringify(changed.slice(i, i + 1000)), run])
  }
  await q(`UPDATE rag.run SET finished_at = now(), counts = $2 WHERE id = $1`, [run, JSON.stringify({ chunks: chunks.length, by_role: byRole, tokens, changed: changed.length, ...stats })])
  await q('COMMIT')
  console.log('written: run', run, 'changed', changed.length)
  await client.end()
}
main().catch(e => { console.error(e); process.exit(1) })
