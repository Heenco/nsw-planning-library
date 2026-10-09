/**
 * RAG pilot - stage B of spatial resolution: a registered term (nsw.scope_layer) tested on one lot.
 *
 * The same registry and the same reading as shared/norms/facts.ts lotTerm (attribute tests on derived tables, lmr.layers
 * registry entries, "+"-joined tables, within-m distances, lower / upper bounds), with one difference: a polygon layer
 * holds only when it covers at least 1 m2 of the lot. lotTerm's ST_Intersects also counts a polygon that only touches the
 * lot's boundary - a heritage item next door came back as "on the lot" (28 Eastern Av: 0 m2; 62 Carr St: a sliver
 * under 0.01 m2). Kept separate so the engine that uses lotTerm is not changed under it.
 */
type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>

export async function lotTermInterior(query: Query, cadid: string, term: string, lga: string | null): Promise<{ holds: boolean | null; why: string; source?: string }> {
  const m = (await query(`SELECT * FROM nsw.scope_layer WHERE lower(term) = $1 ORDER BY dimension LIMIT 1`, [term.toLowerCase()])).rows[0]
  if (!m) return { holds: null, why: 'no scope_layer mapping' }
  if (m.source_kind === 'none') return m.assume_absent ? { holds: false, why: `assumed absent - ${m.note ?? 'no dataset'}` } : { holds: null, why: `not held (${m.note ?? 'no dataset'})` }
  if (m.test === 'attribute') {
    if (!/^derived\.[a-z_0-9]+$/.test(String(m.source)) || !m.filter) return { holds: null, why: `attribute test needs a derived table and a filter (${m.source})` }
    if (m.source === 'derived.lot_lga' && !lga) return { holds: null, why: 'council not recorded' }
    const r = await query(`SELECT EXISTS (SELECT 1 FROM ${m.source} WHERE cadid::text = $1 AND (${m.filter})) AS h`, [cadid]).catch(() => null)
    if (!r) return { holds: null, why: `query failed on ${m.source}` }
    const h = r.rows[0].h
    if (m.upper_bound) return h ? { holds: null, why: `${m.source}: inside the bound, the term itself not held` } : { holds: false, why: `${m.source}: outside` }
    return { holds: Boolean(h), why: `${m.source}: ${m.filter}`, source: m.source }
  }
  let tables: { table: string; filter: string | null }[]
  if (m.source_kind === 'registry') {
    const reg = (await query(`SELECT table_name, filter FROM lmr.layers WHERE key = $1`, [String(m.source).replace(/^lmr\.layers:/, '')])).rows[0]
    if (!reg) return { holds: null, why: `registry entry ${m.source} missing` }
    const f = [reg.filter, m.filter].filter(Boolean).map((x: string) => `(${x})`).join(' AND ')
    tables = [{ table: String(reg.table_name).includes('.') ? reg.table_name : `lmr.${reg.table_name}`, filter: f || null }]
  } else tables = String(m.source).split('+').map((x: string) => ({ table: x.trim(), filter: m.filter ?? null }))
  let any = false
  for (const t of tables) {
    if (!/^[a-z_]+\.[a-z_0-9"]+$/i.test(t.table)) return { holds: null, why: `unreadable source ${t.table}` }
    const g = (await query(`SELECT srid, f_geometry_column AS col, type FROM geometry_columns WHERE f_table_schema || '.' || f_table_name = $1`, [t.table.replace(/"/g, '')])).rows[0] ?? { srid: 4283, col: 'geom', type: 'GEOMETRY' }
    const lotX = Number(g.srid) === 4283 ? 'l.geom' : `ST_Transform(l.geom, ${Number(g.srid)})`
    const within = m.within_m == null ? null : Number(m.within_m)
    // points and lines: on or in the lot; polygons: at least 1 m2 of overlap - a shared boundary, or the sliver two
    // slightly misaligned boundaries leave (62 Carr St: < 0.01 m2), is not "on the lot"
    const areal = /POLYGON|GEOMETRY/i.test(String(g.type))
    const test = within != null ? `ST_DWithin(x."${g.col}"::geography, ${lotX}::geography, ${within})`
      : areal ? `x."${g.col}" && ${lotX} AND ST_Intersects(x."${g.col}", ${lotX}) AND (GeometryType(x."${g.col}") NOT LIKE '%POLYGON%' OR ST_Area(ST_Intersection(x."${g.col}", ${lotX})::geography) >= 1)`
      : `x."${g.col}" && ${lotX} AND ST_Intersects(x."${g.col}", ${lotX})`
    const r = await query(`SELECT EXISTS (SELECT 1 FROM ${t.table} x, cadastre.lot l WHERE l.cadid::text = $1 AND ${test} ${t.filter ? `AND (${t.filter})` : ''}) AS h`, [cadid]).catch(() => null)
    if (!r) return { holds: null, why: `query failed on ${t.table}` }
    if (r.rows[0].h) any = true
  }
  const src = tables.map(t => t.table).join(' + ')
  if (m.lower_bound) return any ? { holds: true, why: `inside ${src}`, source: src } : { holds: null, why: `outside ${src} - the term itself not held` }
  if (m.upper_bound) return any ? { holds: null, why: `inside ${src} - the term itself not held` } : { holds: false, why: `outside ${src}`, source: src }
  return { holds: any, why: `${any ? 'inside' : 'outside'} ${src}`, source: src }
}
