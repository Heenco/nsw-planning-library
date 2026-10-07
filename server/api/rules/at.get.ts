/**
 * What the instruments together say about one land use on one lot (docs/sepp-rule-pipeline.md, step 9).
 *
 *   /api/rules/at?cadid=100096265&use=dual occupancies
 *   /api/rules/at?lon=151.06&lat=-33.75&use=residential flat buildings
 *
 * The stack, generically - nothing here names the Housing SEPP:
 *   1. the lot: zone (largest share, from the polygon), council, area, frontage
 *   2. SEPP frames (nsw.rule kind 'frame') and whether each reaches the lot: every condition is a
 *      (dimension, value) whose test is read from nsw.scope_layer (step 7) and run against the lot shrunk
 *      10 cm. A frame reaches the lot only if its parent does; an untestable condition makes it undecided.
 *   3. permissions: SEPP rules granting the use (permits_use) under a frame that reaches the lot, in the
 *      lot's zone; the LEP's own Land Use Table (nsw.lep_permissibility)
 *   4. prohibitions: the Land Use Table, and LEP rules that withhold consent for the use ("development
 *      consent must not be granted ... on land identified as 'D'"), stored as land_use excludes +
 *      act=development consent excludes, tested through the plan's resolved map refs
 *   5. conflicts: a SEPP permission against an LEP prohibition is decided by a prevails_over edge on the
 *      permission's frame chain (the instrument frame's s 8(1) edge, or a clause's own "despite" edge)
 *   6. standards: SEPP rules for the use whose frames reach the lot, and LEP rules for the use in the zone
 *
 * Held SEPP rules (decision D6) ARE read here - this route is the pipeline's own evaluator - and every
 * SEPP-derived line says so (`publish_state`). Nothing else in the app reads them yet.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { cadidFromQuery } from '../lmr/types.get'
import { landUseKey } from '#shared/land-use-key'

type Tri = boolean | null

const SHRUNK = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
  t AS MATERIALIZED (SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g
                       FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x)`

/** Test one scope_layer mapping against the lot. null = cannot be tested (a gap, or a source we cannot read). */
async function testTerm(cadid: string, m: any, lga: string | null, geo: Map<string, { srid: number; col: string }>): Promise<{ holds: Tri; why: string }> {
  if (!m) return { holds: null, why: 'no scope_layer mapping' }
  if (m.source_kind === 'none') return { holds: null, why: `gap: ${m.note ?? 'no dataset'}` }
  if (m.test === 'attribute' && m.source === 'derived.lot_lga') {
    if (!lga) return { holds: null, why: 'council not recorded' }
    const r = await nswQuery<any>(`SELECT EXISTS (SELECT 1 FROM derived.lot_lga WHERE cadid = $1 AND (${m.filter})) AS h`, [cadid])
    // an upper bound by council ("both localities lie in Northern Beaches"): outside it = no, inside = undecided
    if (m.upper_bound) return r.rows[0].h ? { holds: null, why: `${lga}: inside the council that holds every instance of the term` }
                                          : { holds: false, why: `${lga}: outside the council that holds every instance of the term` }
    return { holds: Boolean(r.rows[0].h), why: lga }
  }
  // tables to intersect, with the filter that belongs to each
  let tables: { table: string; filter: string | null }[] = []
  if (m.source_kind === 'registry') {
    const key = String(m.source).replace(/^lmr\.layers:/, '')
    const reg = (await nswQuery<any>(`SELECT table_name, filter FROM lmr.layers WHERE key = $1`, [key])).rows[0]
    if (!reg) return { holds: null, why: `registry entry ${key} missing` }
    const tbl = String(reg.table_name).includes('.') ? reg.table_name : `lmr.${reg.table_name}`
    // the registry's own filter (which rows of a shared table are this layer) AND the term's
    const f = [reg.filter, m.filter].filter(Boolean).map(x => `(${x})`).join(' AND ')
    tables = [{ table: tbl, filter: f || null }]
  } else {
    tables = String(m.source).split('+').map((s: string) => ({ table: s.trim(), filter: m.filter ?? null }))
  }
  let any = false
  const within = m.within_m == null ? null : Number(m.within_m)
  for (const t of tables) {
    if (!/^[a-z_]+\.[a-z_0-9"]+$/i.test(t.table)) return { holds: null, why: `unreadable source ${t.table}` }
    const g = geo.get(t.table.replace(/"/g, '')) ?? { srid: 4283, col: 'geom' }
    const lotX = g.srid === 4283 ? 't.g' : g.srid === 0 ? 'ST_SetSRID(t.g, 0)' : `ST_Transform(t.g, ${g.srid})`
    const gc = `x."${g.col}"`
    // a distance term (scope_layer.within_m): metres on the ellipsoid for lon/lat sources, the source's own
    // units otherwise; the bbox is widened generously (1 degree >= 80 km in NSW) so the index still prunes
    const geographic = [4283, 4326, 7844, 4202].includes(g.srid)
    const test = within == null ? `${gc} && ${lotX} AND ST_Intersects(${gc}, ${lotX})`
      : geographic ? `${gc} && ST_Expand(${lotX}, ${within / 80000}) AND ST_DWithin(${gc}::geography, ${lotX}::geography, ${within})`
        : `${gc} && ST_Expand(${lotX}, ${within}) AND ST_DWithin(${gc}, ${lotX}, ${within})`
    const r = await nswQuery<any>(`${SHRUNK}
      SELECT EXISTS (SELECT 1 FROM ${t.table} x, t WHERE ${test}
                       ${t.filter ? `AND (${t.filter})` : ''}) AS h,
             ${within == null ? 'false' : `EXISTS (SELECT 1 FROM ${t.table} x, t WHERE ${gc} && ${lotX} AND ST_Intersects(${gc}, ${lotX})
                       ${t.filter ? `AND (${t.filter})` : ''})`} AS on_it`, [cadid]).catch(() => null)
    if (!r) return { holds: null, why: `query failed on ${t.table}` }
    if (r.rows[0].h) any = true
    // on the source itself: within any distance of it, walking or not
    if (r.rows[0].on_it) return { holds: true, why: `on ${t.table} itself (distance 0)` }
  }
  const src = `${tables.map(t => t.table).join(' + ')}${within == null ? '' : ` within ${within} m in a straight line`}`
  // a lower-bound source (scope_layer.lower_bound, migration 23): hitting it puts the lot in the term; missing it decides nothing
  if (m.lower_bound) return any ? { holds: true, why: `inside ${src}, which lies wholly within the term` }
                                : { holds: null, why: `outside ${src} - the term itself is not held` }
  // an upper-bound source (scope_layer.upper_bound): missing it rules the term out; hitting it decides nothing
  if (m.upper_bound) return any ? { holds: null, why: `inside ${src} - the term itself is not held` }
                                : { holds: false, why: `outside ${src}, which contains every instance of the term` }
  return { holds: any, why: src }
}

export default defineEventHandler(async (event) => {
  const started = Date.now()
  const q = getQuery(event)
  const cadid = await cadidFromQuery(q)
  const use = String(q.use ?? '').trim()
  if (!use) throw createError({ statusCode: 400, statusMessage: 'Give use=<land use>, e.g. use=dual occupancies' })
  const useKey = landUseKey(use)

  // ── 1. the lot ────────────────────────────────────────────────────────────────────────────────
  const lotRow = (await nswQuery<any>(`${SHRUNK}
    SELECT l.cadid, l.lotidstring AS lot_id, ST_Area(l.geom::geography) AS area_m2,
           (SELECT upper(lga_name) FROM derived.lot_lga WHERE cadid = l.cadid) AS lga,
           (SELECT primary_frontage_length_m::float8 FROM derived.lot_frontage WHERE cadid = l.cadid) AS frontage_m,
           (SELECT json_build_object('zone', z.sym_code, 'epi', z.epi_name) FROM epi.epi_land_zoning z
             WHERE z.geom && t.g AND ST_Intersects(z.geom, t.g) AND z.sym_code IS NOT NULL
             ORDER BY ST_Area(ST_Intersection(z.geom, t.g)) DESC LIMIT 1) AS zoning
      FROM cadastre.lot l, t WHERE l.cadid = $1`, [cadid])).rows[0]
  if (!lotRow) throw createError({ statusCode: 404, statusMessage: `No lot ${cadid}` })
  const zone: string | null = lotRow.zoning?.zone?.trim() ?? null
  const lot = { cadid, lotId: lotRow.lot_id, lga: lotRow.lga, zone, epi: lotRow.zoning?.epi ?? null,
                areaM2: Math.round(Number(lotRow.area_m2)), frontageM: lotRow.frontage_m == null ? null : Number(lotRow.frontage_m) }

  const geo = new Map((await nswQuery<any>(`SELECT f_table_schema || '.' || f_table_name AS t, srid, f_geometry_column AS col FROM geometry_columns`))
    .rows.map(r => [r.t as string, { srid: Number(r.srid), col: String(r.col) }]))
  const scope = new Map((await nswQuery<any>(`SELECT dimension, lower(term) AS term, source_kind, source, filter, test, note, upper_bound, lower_bound, except_term, within_m FROM nsw.scope_layer`))
    .rows.map(r => [`${r.dimension}|${r.term}`, r]))
  const termCache = new Map<string, { holds: Tri; why: string }>()
  // a term, tested once per request; an except_term (migration 21) is carved out of it
  const termHolds = async (k: string): Promise<{ holds: Tri; why: string }> => {
    if (termCache.has(k)) return termCache.get(k)!
    const m = scope.get(k)
    let t = await testTerm(cadid, m, lot.lga, geo)
    if (m?.except_term && t.holds !== false) {
      const x = await termHolds(`${m.dimension}|${String(m.except_term).toLowerCase()}`)
      t = x.holds === true ? { holds: false, why: `${t.why}, but in ${m.except_term}` }
        : x.holds === null ? { holds: null, why: `${t.why}; ${m.except_term} undecided` } : t
    }
    termCache.set(k, t)
    return t
  }

  // ── 2. SEPP frames ────────────────────────────────────────────────────────────────────────────
  const frameRows = (await nswQuery<any>(
    `SELECT r.id, r.rule_key, r.clause, r.frame_rule_id, r.publish_state, r.notes, r.document_id, d.title AS instrument, d.instrument_slug,
            (WITH RECURSIVE up AS (SELECT s.id, s.parent_id, s.local_id FROM nsw.section s WHERE s.id = r.section_id
                                   UNION ALL SELECT p.id, p.parent_id, p.local_id FROM nsw.section p JOIN up ON p.id = up.parent_id)
              SELECT array_agg(local_id) FROM up) AS ancestors,
            coalesce((SELECT json_agg(json_build_object('dimension', a.dimension, 'value', a.value, 'polarity', a.polarity,
                                                        'alt_group', a.alt_group))
                        FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '[]') AS conditions,
            coalesce((SELECT json_agg(json_build_object('edge', e.edge_type, 'to', e.to_ref, 'span', e.source_span))
                        FROM nsw.rule_edge e WHERE e.from_rule_id = r.id), '[]') AS edges
       FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
      WHERE d.doc_type = 'sepp' AND r.kind = 'frame' AND r.publish_state <> 'retired'`)).rows
  const PROPOSAL_DIMS = ['pathway', 'proponent', 'proposal_metric', 'temporal', 'dev_type', 'route_condition']
  const frames = new Map<string, any>()
  for (const f of frameRows) {
    const conds: any[] = []
    for (const c of f.conditions) {
      if (PROPOSAL_DIMS.includes(c.dimension)) {
        conds.push({ ...c, holds: null, why: 'a fact about the proposal, not the lot', proposal: true }); continue
      }
      // the lot's own zone is read natively, like the rules' zone rows
      if (c.dimension === 'zone') { conds.push({ ...c, holds: zone ? zone === c.value : null, why: zone ? `zone ${zone}` : 'zone not recorded' }); continue }
      // a condition on another rule's answer - resolved once the rules are loaded (below)
      if (c.dimension === 'permissible_under') { conds.push({ ...c, holds: null, why: 'not yet resolved', deferred: true }); continue }
      const k = `${c.dimension}|${String(c.value).toLowerCase()}`
      conds.push({ ...c, ...(await termHolds(k)) })
    }
    frames.set(f.id, { ...f, conds })
  }
  const and3 = (xs: Tri[]): Tri => (xs.includes(false) ? false : xs.includes(null) ? null : true)
  const or3 = (xs: Tri[]): Tri => (xs.includes(true) ? true : xs.includes(null) ? null : false)
  const condValue = (c: any): Tri => (c.holds === null ? null : c.polarity === 'excludes' ? !c.holds : c.holds)
  /**
   * A frame reaches the lot when its parent does, every plain condition holds (an exclusion: does not hold), and
   * every alternative group (rule_applicability.alt_group '<group>#<branch>', migration 22) has a branch whose
   * conditions all hold. Proposal facts are assumed; a branch made only of proposal facts (s 72(2)(b), a site
   * compatibility certificate) is listed but cannot decide the group from the lot.
   */
  const reaches = (id: string | null): Tri => {
    if (!id) return true
    const f = frames.get(id)
    if (!f) return null
    const parent = reaches(f.frame_rule_id)
    if (parent === false) return false
    const plain = f.conds.filter((c: any) => !c.proposal && !c.alt_group).map(condValue)
    const groups = new Map<string, Map<string, any[]>>()
    for (const c of f.conds.filter((c: any) => c.alt_group)) {
      const [g, b = ''] = String(c.alt_group).split('#')
      if (!groups.has(g!)) groups.set(g!, new Map())
      const br = groups.get(g!)!
      br.set(b, [...(br.get(b) ?? []), c])
    }
    const groupValues = [...groups.values()].map((branches) => {
      const decidable = [...branches.values()].filter(cs => cs.some(c => !c.proposal))
      return decidable.length ? or3(decidable.map(cs => and3(cs.filter(c => !c.proposal).map(condValue)))) : null
    })
    return and3([parent, ...plain, ...groupValues])
  }
  const chainOf = (id: string | null) => { const out: any[] = []; for (let x = id ? frames.get(id) : null; x; x = x.frame_rule_id ? frames.get(x.frame_rule_id) : null) out.push(x); return out }
  // the lot conditions left undecided on a rule's frame chain, for the wording
  const frameWhy = (p: any) => [...frames.values()].filter(f => p.frames.includes(f.clause))
    .flatMap(f => f.conds.filter((c: any) => !c.proposal && c.holds === null).map((c: any) => `s ${f.clause}: ${c.value}`)).join('; ')

  // ── 3. permissions and 6. standards from SEPP rules ───────────────────────────────────────────
  const seppRules = (await nswQuery<any>(
    `SELECT r.id, r.rule_key, r.clause, r.kind, r.role, r.frame_rule_id, r.publish_state, r.document_id, d.title AS instrument,
            (WITH RECURSIVE up AS (SELECT s.id, s.parent_id, s.local_id FROM nsw.section s WHERE s.id = r.section_id
                                   UNION ALL SELECT p.id, p.parent_id, p.local_id FROM nsw.section p JOIN up ON p.id = up.parent_id)
              SELECT array_agg(local_id) FROM up) AS ancestors,
            coalesce((SELECT json_agg(json_build_object('dimension', a.dimension, 'value', a.value, 'polarity', a.polarity,
                                                        'alt_group', a.alt_group))
                        FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '[]') AS app,
            coalesce((SELECT json_agg(json_build_object('type', e.effect_type, 'topic', e.topic, 'comparator', e.comparator,
                        'value', e.value, 'unit', e.unit, 'measured_from', e.measured_from, 'condition_metric', e.condition_metric,
                        'condition_lo', e.condition_lo, 'condition_hi', e.condition_hi, 'condition_unit', e.condition_unit,
                        'value_source', e.value_source, 'relative_to', e.relative_to, 'span', e.source_span))
                        FROM nsw.rule_effect e WHERE e.rule_id = r.id), '[]') AS eff,
            coalesce((SELECT json_agg(json_build_object('edge', e.edge_type, 'to', e.to_ref, 'span', e.source_span))
                        FROM nsw.rule_edge e WHERE e.from_rule_id = r.id), '[]') AS edges
       FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
      WHERE d.doc_type = 'sepp' AND r.kind <> 'frame' AND r.publish_state <> 'retired'`)).rows

  /** Whether one SEPP rule reaches the lot: its frame chain, its zones, its defined areas. */
  const evalRule = async (r: any) => {
    const plain = r.app.filter((a: any) => !a.alt_group)
    // zones named are alternatives; a zone excluded ("for development on other land—") must not be the lot's
    const zones = plain.filter((a: any) => a.dimension === 'zone' && a.polarity === 'applies').map((a: any) => a.value)
    const notZones = plain.filter((a: any) => a.dimension === 'zone' && a.polarity === 'excludes').map((a: any) => a.value)
    const inZone: Tri = !zones.length && !notZones.length ? true : !zone ? null
      : (!zones.length || zones.includes(zone)) && !notZones.includes(zone)
    const areas = plain.filter((a: any) => a.dimension === 'defined_area')
    let inArea: Tri = true
    for (const a of areas) {
      const h0 = (await termHolds(`defined_area|${String(a.value).toLowerCase()}`)).holds
      // an excluded area ("otherwise—", s 74(2)(d)(ii)) holds when the lot is NOT in it
      const h = h0 === null ? null : a.polarity === 'excludes' ? !h0 : h0
      if (h === false) { inArea = false; break }
      if (h === null) inArea = null
    }
    // a condition on the LEP's own table ("in a residential zone where residential flat buildings are not permitted",
    // s 84(2)(c)) - lutFor is defined below and is in place before any rule is evaluated
    for (const a of plain.filter((a: any) => a.dimension === 'permissible_under' && String(a.value).startsWith('lep:'))) {
      const h0 = lutFor(landUseKey(String(a.value).slice(4))).holds
      const h = h0 === null ? null : a.polarity === 'excludes' ? !h0 : h0
      if (h === false) { inArea = false; break }
      if (h === null) inArea = null
    }
    // alternatives on the rule itself (rule_applicability.alt_group): a group holds when a branch does; a group
    // named '!...' is an exception ("must not be carried out ... unless— (a) ..., or (b) ...") and holds when NO branch does
    const groups = new Map<string, Map<string, any[]>>()
    for (const a of r.app.filter((a: any) => a.alt_group)) {
      const [g, b = ''] = String(a.alt_group).split('#')
      if (!groups.has(g!)) groups.set(g!, new Map())
      groups.get(g!)!.set(b, [...(groups.get(g!)!.get(b) ?? []), a])
    }
    const groupNotes: string[] = []
    const groupVals: Tri[] = []
    for (const [g, branches] of groups) {
      const vals: Tri[] = []
      for (const rows of branches.values()) {
        const hs: Tri[] = []
        for (const a of rows) {
          const h0: Tri = a.dimension === 'zone' ? (zone ? zone === a.value : null)
            : (await termHolds(`${a.dimension}|${String(a.value).toLowerCase()}`)).holds
          hs.push(h0 === null ? null : a.polarity === 'excludes' ? !h0 : h0)
        }
        vals.push(and3(hs))
      }
      const any = or3(vals)
      const v: Tri = g.startsWith('!') ? (any === null ? null : !any) : any
      groupVals.push(v)
      if (g.startsWith('!')) groupNotes.push(any === true ? 'an exception applies' : any === false ? 'no exception applies' : 'whether an exception applies cannot be decided')
    }
    const frameReach = reaches(r.frame_rule_id)
    const applies: Tri = and3([frameReach, inZone, inArea, ...groupVals])
    const chain = chainOf(r.frame_rule_id)
    const why = frameReach === false ? `frame ${chain.find((f: any) => reaches(f.id) === false)?.clause ?? ''} does not reach the lot`
      : inZone === false ? `zone ${zone} is ${notZones.includes(zone!) ? 'excluded' : `not ${zones.join('/')}`}` : inArea === false ? `area test fails: ${areas.map((a: any) => `${a.polarity === 'excludes' ? 'outside' : 'in'} ${a.value}`).join(' and ')}`
      : groupVals.includes(false) ? groupNotes.join('; ') || 'an alternative fails'
      : applies === null ? `cannot be decided from the data${groupNotes.length ? ` (${groupNotes.join('; ')})` : ''}`
      : `reaches the lot${groupNotes.length ? ` (${groupNotes.join('; ')})` : ''}`
    return { instrument: r.instrument, clause: r.clause, ruleKey: r.rule_key, publishState: r.publish_state, applies, why,
             frames: chain.map((f: any) => f.clause), chain }
  }
  const usesOf = (r: any) => r.app.filter((a: any) => a.dimension === 'land_use' && a.polarity === 'applies').map((a: any) => landUseKey(a.value))
  const permits = (r: any, key: string) => r.eff.some((e: any) => e.type === 'permits_use' && landUseKey(e.topic) === key)
  // the lot's whole Land Use Table row set, for the use asked and for conditions naming another use
  const lutAll = lot.epi && zone ? (await nswQuery<any>(
    `SELECT land_use, status FROM nsw.lep_permissibility WHERE epi_name = $1 AND zone_code = $2`, [lot.epi, zone])).rows : []
  const lutFor = (key: string): { holds: Tri; why: string } => {
    const rows = lutAll.filter(r => landUseKey(r.land_use) === key)
    if (!lot.epi || !zone) return { holds: null, why: 'zone or plan not recorded' }
    if (rows.some(r => r.status === 'permitted_with_consent' || r.status === 'permitted_without_consent'))
      return { holds: true, why: `${rows[0]!.land_use} permitted in ${zone} under ${lot.epi}` }
    if (!rows.length) return { holds: null, why: `no Land Use Table row for it in ${zone}` }
    return { holds: false, why: `${rows[0]!.land_use} ${String(rows[0]!.status).replace(/_/g, ' ')} in ${zone} under ${lot.epi}` }
  }
  // permissible_under conditions (migration 22): 'lep:<use>' and 'sepp:<section>:<use>' now; 'verdict' after the
  // verdict. Two passes, so a frame resting on another frame's permission sees it resolved.
  for (let pass = 0; pass < 2; pass++) {
    for (const f of frames.values()) {
      for (const c of f.conds.filter((c: any) => c.deferred && c.value !== 'verdict')) {
        const v = String(c.value)
        if (v.startsWith('lep:')) Object.assign(c, lutFor(landUseKey(v.slice(4))))
        else if (v.startsWith('sepp:')) {
          const [, sec, use] = v.split(':')
          const key = landUseKey(use)
          const under = seppRules.filter((r: any) => r.document_id === f.document_id && (r.ancestors ?? []).includes(sec))
          const rs = under.filter((r: any) => permits(r, key))
          // nothing extracted under that chapter yet = undecided; extracted, but it grants no such use = no
          // not extracted yet: still "no" where the chapter's own frame (where it applies) does not reach the lot
          const chapterFrames = [...frames.values()].filter((x: any) => x.document_id === f.document_id && (x.ancestors ?? []).includes(sec))
          const chapterReach = chapterFrames.length ? or3(chapterFrames.map((x: any) => reaches(x.id))) : null
          if (!under.length && chapterReach === false)
            Object.assign(c, { holds: false, why: `${sec} does not apply to the lot (s ${chapterFrames.map((x: any) => x.clause).join(', ')})` })
          else if (!under.length) Object.assign(c, { holds: null, why: `${sec} is not extracted yet` })
          else if (!rs.length) Object.assign(c, { holds: false, why: `${sec} grants no ${use} permission` })
          else {
            const vs = await Promise.all(rs.map(evalRule))
            Object.assign(c, { holds: or3(vs.map(x => x.applies)), why: vs.map(x => `s ${x.clause}: ${x.why}`).join('; ') })
          }
        } else Object.assign(c, { holds: null, why: `unknown condition ${v}` })
      }
    }
  }

  // the permissions for the use asked about
  const seppPermissions: any[] = []
  for (const r of seppRules.filter((r: any) => permits(r, useKey))) {
    const b = await evalRule(r)
    // a grant carrying conditions of its own ("if ... at least 50 dwellings", s 72(3)) is conditional: it permits
    // the use only for a proposal that meets them
    const conditions = r.eff.filter((e: any) => e.type !== 'permits_use')
      .map((e: any) => `${String(e.topic ?? '').replace(/_/g, ' ')} ${e.comparator === 'gte' ? 'at least' : e.comparator === 'lte' ? 'at most' : ''} ${e.value ?? ''}`.trim())
    // ... and so is one only some proponents may use ("by or on behalf of a public authority or social housing provider",
    // s 37; "by or on behalf of a relevant authority", s 29): it is a route for them, not an answer for everyone
    const proponents = b.chain.flatMap((f: any) => f.conds.filter((c: any) => c.dimension === 'proponent' && c.polarity === 'applies').map((c: any) => c.value))
    for (const v of proponents) conditions.push(`carried out by ${v}`)
    // ... or one for a kind of proposal the question does not assume (migration 24: an existing serviced apartment
    // building, s 116; a site compatibility certificate, s 138; s 141F(3)'s public authority / approved project)
    const routes = b.chain.flatMap((f: any) => f.conds.filter((c: any) => c.dimension === 'route_condition' && c.polarity === 'applies').map((c: any) => c.value))
    conditions.push(...routes)
    // how the grant permits it, in its own words: "is exempt development" (s 111), "may be carried out without
    // development consent" (s 135), else with consent
    const span = String(r.eff.find((e: any) => e.type === 'permits_use' && landUseKey(e.topic) === useKey)?.span ?? '')
    const pathway = /\bis exempt development\b/i.test(span) ? 'as exempt development (no consent needed)'
      : /\b(?:without (?:development )?consent|is permitted without consent)\b/i.test(span) ? 'without consent' : 'with consent'
    seppPermissions.push({ ...b, chain: undefined, conditional: conditions.length > 0, proponentLimited: proponents.length + routes.length > 0, conditions, pathway,
                           edges: [...r.edges, ...b.chain.flatMap((f: any) => f.edges)] })
  }
  // SEPP prohibitions of the use ("must not be carried out on land in Zone R2 ... unless ...", s 23(2))
  const seppProhibitions: any[] = []
  for (const r of seppRules.filter((r: any) => r.eff.some((e: any) => e.type === 'prohibits_use' && landUseKey(e.topic) === useKey))) {
    const b = await evalRule(r)
    seppProhibitions.push({ ...b, chain: undefined, edges: [...r.edges, ...b.chain.flatMap((f: any) => f.edges)] })
  }

  // ── 3/4. the LEP: Land Use Table and rules withholding consent ────────────────────────────────
  const lepDoc = (await nswQuery<any>(
    `SELECT id, title FROM nsw.document WHERE doc_type = 'lep' AND (lower(title) = lower($1) OR ($1::text IS NULL AND upper(lga_name) = $2)) LIMIT 1`,
    [lot.epi, lot.lga])).rows[0] ?? null
  const lut = lutAll.filter(r => landUseKey(r.land_use) === useKey)
  const lutStatus: string | null = lut.find(r => r.status === 'permitted_with_consent')?.status
    ?? lut.find(r => r.status === 'permitted_without_consent')?.status ?? lut[0]?.status ?? null

  const lepBlocks: any[] = []
  const lepStandards: any[] = []
  if (lepDoc) {
    const lepRules = (await nswQuery<any>(
      `SELECT r.id, r.clause, r.kind,
              coalesce((SELECT json_agg(json_build_object('dimension', a.dimension, 'value', a.value, 'polarity', a.polarity, 'map_layer', a.map_layer))
                          FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '[]') AS app,
              coalesce((SELECT json_agg(json_build_object('type', e.effect_type, 'topic', e.topic, 'comparator', e.comparator,
                          'value', e.value, 'unit', e.unit, 'measured_from', e.measured_from, 'span', e.source_span))
                          FROM nsw.rule_effect e WHERE e.rule_id = r.id), '[]') AS eff
         FROM nsw.rule r WHERE r.document_id = $1 AND r.publish_state = 'published'`, [lepDoc.id])).rows
    const refs = (await nswQuery<any>(`${SHRUNK}
      SELECT lower(sr.value) AS v, lower(coalesce(sr.map_layer, '')) AS m,
             bool_or(CASE WHEN sr.geom IS NULL THEN NULL ELSE ST_Intersects(sr.geom, ST_Transform(t.g, ST_SRID(sr.geom))) END) AS covers
        FROM nsw.rule_spatial_ref sr, t WHERE sr.document_id = $2 GROUP BY 1, 2`, [cadid, lepDoc.id])).rows
    const mapKey = (m: string | null) => String(m ?? '').toLowerCase().replace(/ map$/, '')
    const labelCovers = (v: string, m: string | null): Tri => {
      const hits = refs.filter(r => r.v === v.toLowerCase() && (!m || mapKey(r.m) === mapKey(m)))
      if (hits.some(h => h.covers === true)) return true
      if (hits.some(h => h.covers === null) || !hits.length) return null
      return false
    }
    for (const r of lepRules) {
      const usesEx = r.app.filter((a: any) => a.dimension === 'land_use' && a.polarity === 'excludes').map((a: any) => landUseKey(a.value))
      const usesIn = r.app.filter((a: any) => a.dimension === 'land_use' && a.polarity === 'applies').map((a: any) => landUseKey(a.value))
      const withholds = usesEx.includes(useKey) && r.app.some((a: any) => a.dimension === 'act' && /development consent/i.test(a.value) && a.polarity === 'excludes')
      const forUse = withholds || usesIn.includes(useKey)
      if (!forUse) continue
      // The rule's other conditions against the lot. Rows WITHIN a dimension are alternatives ("Zones R2, R3
      // and R4" is three rows and an R2 lot satisfies it); ACROSS dimensions all must hold. Dimensions that
      // describe the proposal (dev_type, act, temporal, ...) are assumptions of the question, not lot facts.
      let holds: Tri = true
      const why: string[] = []
      const PROPOSAL = new Set(['dev_type', 'act', 'temporal', 'pathway', 'proponent', 'proposal_metric', 'dev_element', 'size_band_lo', 'size_band_hi'])
      const byDim = new Map<string, any[]>()
      for (const a of r.app.filter((a: any) => a.polarity === 'applies' && a.dimension !== 'land_use' && !PROPOSAL.has(a.dimension))) {
        if (!byDim.has(a.dimension)) byDim.set(a.dimension, [])
        byDim.get(a.dimension)!.push(a)
      }
      for (const [dim, rows] of byDim) {
        let d: Tri = false
        const seen: string[] = []
        for (const a of rows) {
          let h: Tri = null
          if (dim === 'zone') h = zone ? a.value === zone : null
          else if (dim === 'area_label' || dim === 'map_area') h = labelCovers(a.value, a.map_layer)
          if (h === true) { d = true; seen.push(dim === 'zone' ? `zone ${a.value}` : `"${a.value}" on the ${a.map_layer ?? ''} map`); break }
          if (h === null) d = null
        }
        if (d === false) { holds = false; why.push(dim === 'zone' ? `zone ${zone} is not ${rows.map(x => x.value).join('/')}` : `not ${rows.map(x => `"${x.value}"`).join(' / ')}`) }
        else if (d === null) { if (holds !== false) holds = null; why.push(`${dim} ${rows.map(x => x.value).join('/')} not decidable here`) }
        else why.push(...seen)
      }
      const assumed = r.app.filter((a: any) => PROPOSAL.has(a.dimension) && a.polarity === 'applies').map((a: any) => `${a.dimension}=${a.value}`)
      if (assumed.length) why.push(`assumes ${assumed.join(', ')}`)
      const line = { instrument: lepDoc.title, clause: r.clause, applies: holds, why: why.join('; ') || 'no further conditions' }
      if (withholds) lepBlocks.push(line)
      else for (const e of r.eff) lepStandards.push({ ...line, ...e })
    }
  }

  // ── 5. the verdict ────────────────────────────────────────────────────────────────────────────
  // an unconditional grant controls ahead of one that holds only for some proposals; the others are alternatives
  // a grant only some proponents may use (public authorities, social housing providers) is never the general answer: it
  // is listed as a route for them
  const granting = seppPermissions.filter(p => p.applies === true && !p.proponentLimited).sort((a, b) => Number(a.conditional) - Number(b.conditional))
  const grant = granting[0] ?? null
  const alternatives = [...granting.slice(1), ...seppPermissions.filter(p => p.applies === true && p.proponentLimited)]
    .map(p => ({ instrument: p.instrument, clause: p.clause, conditions: p.conditions }))
  const grantOpen = !grant && seppPermissions.some(p => p.applies === null && !p.conditional)
  const block = lepBlocks.find(b => b.applies === true) ?? null
  const lutPermits = lutStatus === 'permitted_with_consent' || lutStatus === 'permitted_without_consent'
  const prevail = grant?.edges.find((e: any) => e.edge === 'prevails_over' && e.to === 'doc_type:lep') ?? null
  // an undecided SEPP permission that would prevail over the LEP leaves a local "no" undecided too
  // (a conditional grant - some proposals, some proponents - does not make the general answer undecided; it is listed)
  const openPrevailing = grant ? null : seppPermissions.find(p => p.applies === null && !p.conditional
    && p.edges.some((e: any) => e.edge === 'prevails_over' && e.to === 'doc_type:lep')) ?? null
  for (const p of seppPermissions.filter(p => p.applies === null && p.conditional))
    alternatives.push({ instrument: p.instrument, clause: p.clause, conditions: [...p.conditions, 'whether it reaches the lot is undecided'] })
  const openWhy = openPrevailing
    ? `; ${openPrevailing.instrument} s ${openPrevailing.clause} would permit it and prevail, but whether it reaches the lot cannot be decided`
      + (frameWhy(openPrevailing) ? ` (${frameWhy(openPrevailing)})` : '')
    : ''

  let permissible: Tri
  let wording: string
  let controlling: any = null
  const displaced: any[] = []
  if (grant && (block || !lutPermits)) {
    if (prevail) {
      permissible = true
      controlling = { instrument: grant.instrument, clause: grant.clause }
      if (block) displaced.push({ instrument: block.instrument, clause: block.clause, why: block.why })
      if (!lutPermits && lutStatus) displaced.push({ instrument: lepDoc?.title, clause: 'Land Use Table', why: `${use} ${lutStatus.replace(/_/g, ' ')} in ${zone}` })
      const by = String(prevail.span ?? '').match(/^(\d+[A-Z]?\(\d+[A-Z]?\))/)?.[1] ?? 'its relationship clause'
      wording = `${use}: permissible ${grant.pathway} — ${grant.instrument} s ${grant.clause}`
        + (displaced.length ? `, prevails over ${displaced.map(d => `${d.instrument} ${d.clause === 'Land Use Table' ? 'Land Use Table' : 'cl ' + d.clause}`).join(' and ')} by s ${by}` : '')
    } else {
      permissible = null
      wording = `${use}: ${grant.instrument} s ${grant.clause} permits it and the LEP does not; no prevails edge decides between them`
    }
  } else if (grant && grant.conditional) {
    // the LEP permits it outright; a SEPP grant that holds only for some proposals is an alternative, not the answer
    permissible = true
    controlling = { instrument: lepDoc?.title ?? lot.epi, clause: 'Land Use Table' }
    wording = `${use}: ${lutStatus!.replace(/_/g, ' ')} in ${zone} under ${lepDoc?.title ?? lot.epi}`
    alternatives.unshift({ instrument: grant.instrument, clause: grant.clause, conditions: grant.conditions })
  } else if (grant) {
    permissible = true
    controlling = { instrument: grant.instrument, clause: grant.clause }
    wording = `${use}: permissible ${grant.pathway} — ${grant.instrument} s ${grant.clause} (the LEP also permits it in ${zone})`
  } else if (block) {
    permissible = openPrevailing ? null : false
    controlling = { instrument: block.instrument, clause: block.clause }
    wording = `${use}: consent must not be granted — ${block.instrument} cl ${block.clause} (${block.why})`
      + (openWhy || (grantOpen ? '; a SEPP permission might reach the lot but cannot be decided' : ''))
  } else if (lutPermits) {
    permissible = true
    controlling = { instrument: lepDoc?.title ?? lot.epi, clause: 'Land Use Table' }
    wording = `${use}: ${lutStatus!.replace(/_/g, ' ')} in ${zone} under ${lepDoc?.title ?? lot.epi}`
  } else {
    permissible = lutStatus && !openPrevailing ? false : null
    wording = (lutStatus ? `${use}: ${lutStatus.replace(/_/g, ' ')} in ${zone}` : `${use}: no Land Use Table row for ${zone}`) + openWhy
  }
  // a SEPP prohibition that reaches the lot ends it, over the LEP and over a SEPP grant, where the SEPP prevails
  // (s 8(1)); one that cannot be decided leaves a "yes" undecided
  const bar = seppProhibitions.find(p => p.applies === true) ?? null
  const barOpen = !bar ? seppProhibitions.find(p => p.applies === null) ?? null : null
  if (bar && permissible !== false) {
    const prevailsBar = bar.edges.some((e: any) => e.edge === 'prevails_over' && e.to === 'doc_type:lep')
    if (prevailsBar || !lutPermits) {
      if (lutPermits) displaced.push({ instrument: lepDoc?.title ?? lot.epi, clause: 'Land Use Table', why: `${use} ${lutStatus!.replace(/_/g, ' ')} in ${zone}` })
      if (grant) displaced.push({ instrument: grant.instrument, clause: grant.clause, why: 'its permission is limited by the prohibition' })
      permissible = false
      controlling = { instrument: bar.instrument, clause: bar.clause }
      wording = `${use}: must not be carried out here — ${bar.instrument} s ${bar.clause} (${bar.why})`
    } else {
      permissible = null
      wording += `; ${bar.instrument} s ${bar.clause} prohibits it here and no prevails edge decides against the LEP`
    }
  } else if (barOpen && permissible === true) {
    permissible = null
    wording += `; but ${barOpen.instrument} s ${barOpen.clause} may prohibit it here: ${barOpen.why}`
  }
  const caveat = displaced.length
    ? 'A SEPP displacing a local clause "to the extent of the inconsistency" is a legal reading - confirm with the council before relying on it.'
    : null

  // a frame conditioned on the verdict itself (s 15C(1)(a): "the development is permitted with consent ...")
  for (const f of frames.values()) {
    for (const c of f.conds.filter((c: any) => c.deferred && c.value === 'verdict')) Object.assign(c, { holds: permissible, why: wording })
  }

  // ── 6. standards for the use, now that every frame condition is resolved ──────────────────────
  const seppStandards: any[] = []
  for (const r of seppRules) {
    if (!usesOf(r).includes(useKey) && !permits(r, useKey)) continue
    const effs = r.eff.filter((e: any) => e.type !== 'permits_use' && e.type !== 'prohibits_use')
    if (!effs.length) continue
    const b = await evalRule(r)
    for (const e of effs) seppStandards.push({ ...b, chain: undefined, ...e })
  }

  // each instrument's legislation.nsw.gov.au page, as ingested: a clause's local_id (sec.166, sec.8-ssec.1) is the
  // page's own anchor, so the UI can link any clause it shows
  const titles = [...new Set([...[...frames.values()].map(f => f.instrument), ...seppPermissions.map(p => p.instrument),
    ...seppProhibitions.map((p: any) => p.instrument), ...seppStandards.map((s: any) => s.instrument), lepDoc?.title].filter(Boolean))]
  const sources = Object.fromEntries((await nswQuery<any>(
    `SELECT DISTINCT ON (title) title, source_url FROM nsw.document WHERE title = ANY($1) AND source_url IS NOT NULL ORDER BY title, ingested_at DESC`,
    [titles])).rows.map((d: any) => [d.title, d.source_url]))

  return {
    lot, use, ms: Date.now() - started, sources,
    verdict: { permissible, wording,
               controlling: controlling && grant?.conditional && controlling.clause === grant.clause ? { ...controlling, conditions: grant.conditions } : controlling,
               displaced, caveat, alternatives },
    frames: [...frames.values()].map(f => ({
      instrument: f.instrument, ruleKey: f.rule_key, clause: f.clause, publishState: f.publish_state, reaches: reaches(f.id),
      conditions: f.conds.map((c: any) => ({ dimension: c.dimension, value: c.value, polarity: c.polarity, altGroup: c.alt_group ?? null,
                                              holds: c.holds, why: c.why })),
    })),
    sepp: { permissions: seppPermissions, prohibitions: seppProhibitions, standards: seppStandards },
    lep: { document: lepDoc?.title ?? null, landUseTable: lutStatus, withholdsConsent: lepBlocks, standards: lepStandards },
  }
})
