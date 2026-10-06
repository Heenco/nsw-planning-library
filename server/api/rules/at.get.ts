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
    const r = await nswQuery<any>(`SELECT EXISTS (SELECT 1 FROM derived.lot_lga WHERE cadid = $1 AND ${m.filter}) AS h`, [cadid])
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
  for (const t of tables) {
    if (!/^[a-z_]+\.[a-z_0-9"]+$/i.test(t.table)) return { holds: null, why: `unreadable source ${t.table}` }
    const g = geo.get(t.table.replace(/"/g, '')) ?? { srid: 4283, col: 'geom' }
    const lotX = g.srid === 4283 ? 't.g' : g.srid === 0 ? 'ST_SetSRID(t.g, 0)' : `ST_Transform(t.g, ${g.srid})`
    const gc = `x."${g.col}"`
    const r = await nswQuery<any>(`${SHRUNK}
      SELECT EXISTS (SELECT 1 FROM ${t.table} x, t WHERE ${gc} && ${lotX} AND ST_Intersects(${gc}, ${lotX})
                       ${t.filter ? `AND (${t.filter})` : ''}) AS h`, [cadid]).catch(() => null)
    if (!r) return { holds: null, why: `query failed on ${t.table}` }
    if (r.rows[0].h) any = true
  }
  // an upper-bound source (scope_layer.upper_bound): missing it rules the term out; hitting it decides nothing
  if (m.upper_bound) return any ? { holds: null, why: `inside ${tables.map(t => t.table).join(' + ')} - the term itself is not held` }
                                : { holds: false, why: `outside ${tables.map(t => t.table).join(' + ')}, which contains every instance of the term` }
  return { holds: any, why: tables.map(t => t.table).join(' + ') }
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
  const scope = new Map((await nswQuery<any>(`SELECT dimension, lower(term) AS term, source_kind, source, filter, test, note, upper_bound, except_term FROM nsw.scope_layer`))
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
    `SELECT r.id, r.rule_key, r.clause, r.frame_rule_id, r.publish_state, r.notes, d.title AS instrument, d.instrument_slug,
            coalesce((SELECT json_agg(json_build_object('dimension', a.dimension, 'value', a.value, 'polarity', a.polarity))
                        FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '[]') AS conditions,
            coalesce((SELECT json_agg(json_build_object('edge', e.edge_type, 'to', e.to_ref, 'span', e.source_span))
                        FROM nsw.rule_edge e WHERE e.from_rule_id = r.id), '[]') AS edges
       FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
      WHERE d.doc_type = 'sepp' AND r.kind = 'frame' AND r.publish_state <> 'retired'`)).rows
  const frames = new Map<string, any>()
  for (const f of frameRows) {
    const conds: any[] = []
    for (const c of f.conditions) {
      if (['pathway', 'proponent', 'proposal_metric', 'temporal', 'dev_type'].includes(c.dimension)) {
        conds.push({ ...c, holds: null, why: 'a fact about the proposal, not the lot', proposal: true }); continue
      }
      const k = `${c.dimension}|${String(c.value).toLowerCase()}`
      await termHolds(k)
      conds.push({ ...c, ...termCache.get(k) })
    }
    frames.set(f.id, { ...f, conds })
  }
  const reaches = (id: string | null): Tri => {
    if (!id) return true
    const f = frames.get(id)
    if (!f) return null
    const parent = reaches(f.frame_rule_id)
    if (parent === false) return false
    const lotConds = f.conds.filter((c: any) => !c.proposal)
    if (lotConds.some((c: any) => c.polarity === 'excludes' && c.holds === true)) return false
    if (lotConds.some((c: any) => c.polarity === 'applies' && c.holds === false)) return false
    if (parent === null || lotConds.some((c: any) => c.holds === null)) return null
    return true
  }
  const chainOf = (id: string | null) => { const out: any[] = []; for (let x = id ? frames.get(id) : null; x; x = x.frame_rule_id ? frames.get(x.frame_rule_id) : null) out.push(x); return out }
  // the lot conditions left undecided on a rule's frame chain, for the wording
  const frameWhy = (p: any) => [...frames.values()].filter(f => p.frames.includes(f.clause))
    .flatMap(f => f.conds.filter((c: any) => !c.proposal && c.holds === null).map((c: any) => `s ${f.clause}: ${c.value}`)).join('; ')

  // ── 3. permissions and 6. standards from SEPP rules ───────────────────────────────────────────
  const seppRules = (await nswQuery<any>(
    `SELECT r.id, r.rule_key, r.clause, r.kind, r.role, r.frame_rule_id, r.publish_state, d.title AS instrument,
            coalesce((SELECT json_agg(json_build_object('dimension', a.dimension, 'value', a.value, 'polarity', a.polarity))
                        FROM nsw.rule_applicability a WHERE a.rule_id = r.id), '[]') AS app,
            coalesce((SELECT json_agg(json_build_object('type', e.effect_type, 'topic', e.topic, 'comparator', e.comparator,
                        'value', e.value, 'unit', e.unit, 'measured_from', e.measured_from, 'condition_metric', e.condition_metric,
                        'condition_hi', e.condition_hi, 'relative_to', e.relative_to, 'span', e.source_span))
                        FROM nsw.rule_effect e WHERE e.rule_id = r.id), '[]') AS eff,
            coalesce((SELECT json_agg(json_build_object('edge', e.edge_type, 'to', e.to_ref, 'span', e.source_span))
                        FROM nsw.rule_edge e WHERE e.from_rule_id = r.id), '[]') AS edges
       FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
      WHERE d.doc_type = 'sepp' AND r.kind <> 'frame' AND r.publish_state <> 'retired'`)).rows

  const seppPermissions: any[] = []
  const seppStandards: any[] = []
  for (const r of seppRules) {
    const uses = r.app.filter((a: any) => a.dimension === 'land_use' && a.polarity === 'applies').map((a: any) => landUseKey(a.value))
    const permitsUse = r.eff.some((e: any) => e.type === 'permits_use' && landUseKey(e.topic) === useKey)
    if (!permitsUse && !uses.includes(useKey)) continue
    const zones = r.app.filter((a: any) => a.dimension === 'zone').map((a: any) => a.value)
    const inZone: Tri = !zones.length ? true : !zone ? null : zones.includes(zone)
    const areas = r.app.filter((a: any) => a.dimension === 'defined_area' && a.polarity === 'applies')
    let inArea: Tri = true
    for (const a of areas) {
      const k = `defined_area|${String(a.value).toLowerCase()}`
      await termHolds(k)
      const h = termCache.get(k)!.holds
      if (h === false) { inArea = false; break }
      if (h === null) inArea = null
    }
    const frameReach = reaches(r.frame_rule_id)
    const applies: Tri = [frameReach, inZone, inArea].includes(false) ? false
      : [frameReach, inZone, inArea].includes(null) ? null : true
    const chain = chainOf(r.frame_rule_id)
    const why = frameReach === false ? `frame ${chain.find((f: any) => reaches(f.id) === false)?.clause ?? ''} does not reach the lot`
      : inZone === false ? `zone ${zone} is not ${zones.join('/')}` : inArea === false ? `not in ${areas.map((a: any) => a.value).join(' / ')}`
      : applies === null ? 'cannot be decided from the data' : 'reaches the lot'
    const base = { instrument: r.instrument, clause: r.clause, ruleKey: r.rule_key, publishState: r.publish_state, applies, why,
                   frames: chain.map((f: any) => f.clause) }
    if (permitsUse) seppPermissions.push({ ...base, edges: [...r.edges, ...chain.flatMap((f: any) => f.edges)] })
    for (const e of r.eff.filter((e: any) => e.type !== 'permits_use')) seppStandards.push({ ...base, ...e })
  }

  // ── 3/4. the LEP: Land Use Table and rules withholding consent ────────────────────────────────
  const lepDoc = (await nswQuery<any>(
    `SELECT id, title FROM nsw.document WHERE doc_type = 'lep' AND (lower(title) = lower($1) OR ($1::text IS NULL AND upper(lga_name) = $2)) LIMIT 1`,
    [lot.epi, lot.lga])).rows[0] ?? null
  const lut = lot.epi && zone ? (await nswQuery<any>(
    `SELECT land_use, status FROM nsw.lep_permissibility WHERE epi_name = $1 AND zone_code = $2`, [lot.epi, zone])).rows
    .filter(r => landUseKey(r.land_use) === useKey) : []
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
  const grant = seppPermissions.find(p => p.applies === true) ?? null
  const grantOpen = !grant && seppPermissions.some(p => p.applies === null)
  const block = lepBlocks.find(b => b.applies === true) ?? null
  const lutPermits = lutStatus === 'permitted_with_consent' || lutStatus === 'permitted_without_consent'
  const prevail = grant?.edges.find((e: any) => e.edge === 'prevails_over' && e.to === 'doc_type:lep') ?? null
  // an undecided SEPP permission that would prevail over the LEP leaves a local "no" undecided too
  const openPrevailing = grant ? null : seppPermissions.find(p => p.applies === null
    && p.edges.some((e: any) => e.edge === 'prevails_over' && e.to === 'doc_type:lep')) ?? null
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
      wording = `${use}: permissible with consent — ${grant.instrument} s ${grant.clause}`
        + (displaced.length ? `, prevails over ${displaced.map(d => `${d.instrument} ${d.clause === 'Land Use Table' ? 'Land Use Table' : 'cl ' + d.clause}`).join(' and ')} by s ${by}` : '')
    } else {
      permissible = null
      wording = `${use}: ${grant.instrument} s ${grant.clause} permits it and the LEP does not; no prevails edge decides between them`
    }
  } else if (grant) {
    permissible = true
    controlling = { instrument: grant.instrument, clause: grant.clause }
    wording = `${use}: permissible with consent — ${grant.instrument} s ${grant.clause} (the LEP also permits it in ${zone})`
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
  const caveat = displaced.length
    ? 'A SEPP displacing a local clause "to the extent of the inconsistency" is a legal reading - confirm with the council before relying on it.'
    : null

  return {
    lot, use, ms: Date.now() - started,
    verdict: { permissible, wording, controlling, displaced, caveat },
    frames: [...frames.values()].map(f => ({
      instrument: f.instrument, ruleKey: f.rule_key, clause: f.clause, publishState: f.publish_state, reaches: reaches(f.id),
      conditions: f.conds.map((c: any) => ({ dimension: c.dimension, value: c.value, polarity: c.polarity, holds: c.holds, why: c.why })),
    })),
    sepp: { permissions: seppPermissions, standards: seppStandards },
    lep: { document: lepDoc?.title ?? null, landUseTable: lutStatus, withholdsConsent: lepBlocks, standards: lepStandards },
  }
})
