/**
 * The rows behind a cell on /pilot: findings, scope rows, propositions or keys of one document,
 * filtered by exactly what the cell says. Nothing is summarised here; the page renders whatever
 * columns come back, so a new column in the pilot schema shows up without a change to the page.
 *
 *   GET /api/pilot/rows?doc=<document id>&what=findings|scope|propositions|keys|nodes
 *       [&kind=..&tier=..&gating=true|false]                       findings
 *       [&dimension=..&value=..&resolution=..&polarity=..]         scope
 *       [&classification=..&modality=..&reader=..&topic=..]       propositions
 *       [&local_id=..]  any: the node (clause / subclause / paragraph) and its descendants
 *       [&q=..]         any: a text search in the row's text columns
 *       [&limit=200&offset=0]
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

const WHATS = ['findings', 'scope', 'propositions', 'keys', 'nodes'] as const
type What = typeof WHATS[number]

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const doc = String(q.doc ?? '').trim()
  const what = String(q.what ?? '') as What
  if (!/^[0-9a-f-]{36}$/i.test(doc)) throw createError({ statusCode: 400, statusMessage: 'doc (a document id) is required' })
  if (!WHATS.includes(what)) throw createError({ statusCode: 400, statusMessage: `what must be one of ${WHATS.join(', ')}` })
  const limit = Math.min(Math.max(Number(q.limit ?? 200) || 200, 1), 1000)
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0)
  setHeader(event, 'cache-control', 'no-store')

  const params: any[] = [doc]
  const where: string[] = []
  const add = (sqlCol: string, v: unknown, op = '=') => {
    if (v == null || v === '') return
    params.push(String(v))
    where.push(`${sqlCol} ${op} $${params.length}`)
  }
  const like = (cols: string[], v: unknown) => {
    if (v == null || v === '') return
    params.push(`%${String(v)}%`)
    where.push(`(${cols.map(c => `${c} ilike $${params.length}`).join(' or ')})`)
  }
  // a clause and everything under it: local_id = x or local_id like 'x-%' or 'x#%'
  const under = (col: string, v: unknown) => {
    if (v == null || v === '') return
    params.push(String(v)); const a = params.length
    params.push(`${String(v)}-%`); const b = params.length
    params.push(`${String(v)}#%`); const c = params.length
    where.push(`(${col} = $${a} or ${col} like $${b} or ${col} like $${c})`)
  }

  let select = '', from = '', order = ''
  if (what === 'findings') {
    select = `f.tier, f.kind, f.gating, f.detail, n.local_id, left(n.text, 300) as node_text, f.created_at`
    from = `pilot.finding f left join pilot.node n on n.id = f.node_id where f.document_id = $1`
    add('f.kind', q.kind); add('f.tier', q.tier); if (q.gating != null && q.gating !== '') add('f.gating', String(q.gating) === 'true' ? 'true' : 'false')
    under('n.local_id', q.local_id); like(['f.detail', 'n.text'], q.q)
    order = `f.tier, f.gating desc, f.kind, n.local_id`
  } else if (what === 'scope') {
    select = `n.local_id, s.dimension, s.value, s.polarity, s.alt_group, s.map_layer, s.resolution, s.resolver, (s.geom is not null) as has_polygon,
              p.modality, p.subject, p.topic, p.comparator, p.value as prop_value, p.unit, p.classification, p.reader, left(p.source_span, 240) as source_span`
    from = `pilot.scope s join pilot.proposition p on p.id = s.proposition_id join pilot.node n on n.id = p.node_id where n.document_id = $1`
    add('s.dimension', q.dimension); add('s.value', q.value); add('s.resolution', q.resolution); add('s.polarity', q.polarity)
    add('p.classification', q.classification); under('n.local_id', q.local_id); like(['s.value', 'p.source_span', 'p.subject'], q.q)
    order = `s.dimension, s.resolution, s.value, n.local_id`
  } else if (what === 'propositions') {
    select = `n.local_id, p.modality, p.subject, p.topic, p.comparator, p.value, p.value_upper, p.unit, p.relative_to,
              p.condition_metric, p.condition_lo, p.condition_hi, p.condition_unit, p.discretion, p.proposal_dependent,
              p.classification, p.reader, left(p.source_span, 240) as source_span,
              (select count(*)::int from pilot.scope s where s.proposition_id = p.id) as scope_rows,
              (select count(*)::int from pilot.scope s where s.proposition_id = p.id and s.resolution = 'unresolved') as unresolved_rows`
    from = `pilot.proposition p join pilot.node n on n.id = p.node_id where n.document_id = $1`
    add('p.classification', q.classification); add('p.modality', q.modality); add('p.reader', q.reader); add('p.topic', q.topic)
    under('n.local_id', q.local_id); like(['p.source_span', 'p.subject', 'p.relative_to'], q.q)
    order = `n.ordinal, p.id`
  } else if (what === 'keys') {
    select = `k.clause, k.cadid, k.question, k.expected, k.note, k.created_at`
    from = `pilot.key k where k.document_id = $1`
    add('k.clause', q.clause); like(['k.question', 'k.note', 'k.clause'], q.q)
    order = `k.clause, k.question`
  } else {
    select = `n.local_id, n.kind, n.list_role, n.discretion, n.heading, left(n.text, 400) as text,
              (select count(*)::int from pilot.proposition p where p.node_id = n.id) as propositions`
    from = `pilot.node n where n.document_id = $1`
    add('n.kind', q.kind); add('n.list_role', q.list_role); under('n.local_id', q.local_id); like(['n.text', 'n.heading'], q.q)
    order = `n.ordinal`
  }
  const whereSql = where.length ? ' and ' + where.join(' and ') : ''
  const total = (await nswQuery<any>(`select count(*)::int as n from ${from}${whereSql}`, params)).rows[0].n
  params.push(limit); params.push(offset)
  const rows = (await nswQuery<any>(`select ${select} from ${from}${whereSql} order by ${order} limit $${params.length - 1} offset $${params.length}`, params)).rows
  const columns = rows.length ? Object.keys(rows[0]) : []
  return { what, doc, filters: Object.fromEntries(Object.entries(q).filter(([k]) => !['doc', 'what', 'limit', 'offset'].includes(k))), total, limit, offset, columns, rows }
})
