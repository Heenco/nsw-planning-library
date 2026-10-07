/**
 * Lot facts for the norms engine (trial): what our data can say about a lot, with nothing guessed.
 *   zone / plan  epi.epi_land_zoning at the lot's point on surface
 *   area         the cadastre polygon
 *   Lot Size Map epi.epi_lot_size at the same point; "not on the map" only when the plan HAS polygons in our copy -
 *                if it has none, whether the lot is on the map cannot be told (null)
 *   Land Use Table  nsw.lep_permissibility for the plan and zone
 *   site         only what the lot record itself shows: a strata plan ('//SP') means a strata scheme exists
 *   frontage     derived.lot_frontage.primary_frontage_length_m - lot width in every eligibility test
 *   terms        nsw.scope_layer terms (the graph's defined areas, maps, councils), tested the way /api/rules/at's
 *                testTerm does - upper / lower bounds, the lmr.layers registry, a council attribute. A copy for the
 *                trial: that function lives inside the route file, which the Codes SEPP session also edits.
 * Takes the query function, so the API route (nswQuery) and the scripts (a pg client) share it.
 */
import type { LotFacts } from './engine'
import { useGroups } from './groups'

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>

export async function lotFacts(query: Query, cadid: string, key: (u: string) => string, terms: string[] = [], refIds: string[] = []): Promise<LotFacts> {
  const row = (await query(`
    WITH p AS (SELECT l.cadid, l.lotidstring, ST_Area(l.geom::geography) AS area, ST_PointOnSurface(l.geom) AS pt FROM cadastre.lot l WHERE l.cadid::text = $1)
    SELECT p.cadid, p.lotidstring, p.area,
           (SELECT primary_frontage_length_m::float8 FROM derived.lot_frontage f WHERE f.cadid::text = p.cadid::text) AS frontage,
           (SELECT upper(lga_name) FROM derived.lot_lga g WHERE g.cadid::text = p.cadid::text) AS lga,
           (SELECT json_build_object('zone', z.sym_code, 'epi', z.epi_name) FROM epi.epi_land_zoning z
             WHERE z.geom && p.pt AND ST_Intersects(z.geom, p.pt) AND z.sym_code IS NOT NULL LIMIT 1) AS zoning
      FROM p`, [cadid])).rows[0]
  if (!row) throw new Error(`no lot ${cadid}`)
  const epi: string | null = row.zoning?.epi ?? null
  const zone: string | null = row.zoning?.zone?.trim() ?? null
  let lotSizeMinM2: number | null = null, onLotSizeMap: boolean | null = null
  if (epi) {
    const ls = (await query(`
      SELECT z.lot_size, z.units FROM epi.epi_lot_size z, cadastre.lot l
       WHERE l.cadid::text = $1 AND z.epi_name = $2 AND z.geom && ST_PointOnSurface(l.geom) AND ST_Intersects(z.geom, ST_PointOnSurface(l.geom)) LIMIT 1`, [cadid, epi])).rows[0]
    if (ls) { onLotSizeMap = true; lotSizeMinM2 = /ha/i.test(String(ls.units)) ? Number(ls.lot_size) * 10000 : Number(ls.lot_size) }
    else onLotSizeMap = (await query(`SELECT EXISTS (SELECT 1 FROM epi.epi_lot_size WHERE epi_name = $1) AS e`, [epi])).rows[0].e ? false : null
  }
  const lut: Record<string, string> = {}
  if (epi && zone) {
    for (const r of (await query(`SELECT land_use, status FROM nsw.lep_permissibility WHERE epi_name = $1 AND zone_code = $2`, [epi, zone])).rows) {
      const k = key(r.land_use)
      // a permitted row wins over a prohibited one under the same key ("dual occupancies" vs "(attached)")
      if (!lut[k] || /^permitted/.test(r.status)) lut[k] = r.status
    }
  }
  const lotId: string | null = row.lotidstring ?? null
  const tested: Record<string, { holds: boolean | null; why: string }> = {}
  const uniq = [...new Set(terms.map(x => x.toLowerCase()))]
  const results = await Promise.all(uniq.map(t => lotTerm(query, cadid, t, row.lga ?? null)))
  uniq.forEach((t, i) => { tested[t] = results[i]! })
  // the graph's place polygons the norms name: is the lot's point on surface in each?
  const refHits = await refHitsFor(query, cadid, refIds)
  // land use groups from the plan's own Dictionary in the graph
  const dict = epi ? (await query(`SELECT string_agg(s.raw_text, ' ') AS t FROM nsw.section s JOIN nsw.document d ON d.id = s.document_id
                                    WHERE d.title = $1 AND s.level = 'dictionary'`, [epi])).rows[0]?.t : null
  return { cadid, lotId, zone, epi, lga: row.lga ?? null, areaM2: row.area == null ? null : Math.round(Number(row.area)),
           lotSizeMinM2, onLotSizeMap, lut, site: { [key('strata scheme')]: /\/\/SP\d/i.test(String(lotId ?? '')) },
           frontageM: row.frontage == null ? null : Number(row.frontage), terms: tested, refHits, groups: dict ? useGroups(dict, key) : {} }
}

/** One nsw.scope_layer term against the lot: true / false / null (a gap, a bound that cannot decide, a failed query). */
export async function lotTerm(query: Query, cadid: string, term: string, lga: string | null): Promise<{ holds: boolean | null; why: string }> {
  const m = (await query(`SELECT * FROM nsw.scope_layer WHERE lower(term) = $1 ORDER BY dimension LIMIT 1`, [term.toLowerCase()])).rows[0]
  if (!m) return { holds: null, why: 'no scope_layer mapping' }
  if (m.source_kind === 'none') return { holds: null, why: `not held (${m.note ?? 'no dataset'})` }
  if (m.test === 'attribute' && m.source === 'derived.lot_lga') {
    if (!lga) return { holds: null, why: 'council not recorded' }
    const h = (await query(`SELECT EXISTS (SELECT 1 FROM derived.lot_lga WHERE cadid::text = $1 AND (${m.filter})) AS h`, [cadid])).rows[0].h
    if (m.upper_bound) return h ? { holds: null, why: `${lga}: inside the bound, the term itself not held` } : { holds: false, why: `${lga}: outside` }
    return { holds: Boolean(h), why: lga }
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
    const g = (await query(`SELECT srid, f_geometry_column AS col FROM geometry_columns WHERE f_table_schema || '.' || f_table_name = $1`, [t.table.replace(/"/g, '')])).rows[0] ?? { srid: 4283, col: 'geom' }
    const lotX = Number(g.srid) === 4283 ? 'l.geom' : `ST_Transform(l.geom, ${Number(g.srid)})`
    const within = m.within_m == null ? null : Number(m.within_m)
    const test = within == null ? `x."${g.col}" && ${lotX} AND ST_Intersects(x."${g.col}", ${lotX})`
      : `ST_DWithin(x."${g.col}"::geography, ${lotX}::geography, ${within})`
    const r = await query(`SELECT EXISTS (SELECT 1 FROM ${t.table} x, cadastre.lot l WHERE l.cadid::text = $1 AND ${test} ${t.filter ? `AND (${t.filter})` : ''}) AS h`, [cadid]).catch(() => null)
    if (!r) return { holds: null, why: `query failed on ${t.table}` }
    if (r.rows[0].h) any = true
  }
  const src = tables.map(t => t.table).join(' + ')
  if (m.lower_bound) return any ? { holds: true, why: `inside ${src}` } : { holds: null, why: `outside ${src} - the term itself not held` }
  if (m.upper_bound) return any ? { holds: null, why: `inside ${src} - the term itself not held` } : { holds: false, why: `outside ${src}` }
  return { holds: any, why: src }
}

/** The graph's place polygons (nsw.rule_spatial_ref ids) the lot's point on surface falls in: id -> true / false. */
export async function refHitsFor(query: Query, cadid: string, refIds: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  if (!refIds.length) return out
  for (const r of (await query(`SELECT sr.id::text AS id, ST_Intersects(sr.geom, ST_Transform(ST_PointOnSurface(l.geom), ST_SRID(sr.geom))) AS h
                                  FROM nsw.rule_spatial_ref sr, cadastre.lot l WHERE l.cadid::text = $1 AND sr.id::text = ANY($2) AND sr.geom IS NOT NULL`,
                                [cadid, refIds])).rows) out[r.id] = Boolean(r.h)
  return out
}
