/**
 * RAG pilot - the facts side D (shared/rag/evaluate.ts) reads for one lot. One recipe, used frozen by the question bank
 * (scripts/rag/06-questions.ts) and live by any endpoint that asks the engine about a lot, so the two cannot drift.
 *
 *   base       shared/norms/facts.ts lotFacts: zone, area, frontage, battle-axe, the FSR / height / lot size maps, council
 *   lmr        lmr.lot_lmr: the low and mid rise band and class
 *   mapped     the map areas the lot is in (rag.map_polygon: the plans' own epi map layers and nsw.rule_spatial_ref - the
 *              plan's own polygon preferred where both give one map label) with the share of the lot inside
 *   terms      every registered term the graph's claims are bound to (rag.claim_binding), tested with lotTermInterior:
 *              a polygon holds only where it covers 1 m2 or more of the lot
 */
import { lotFacts } from '../norms/facts'
import { lotTermInterior } from './lot-terms'
import { dcpGuardFacts, isGuardTerm } from '../dcp/guard-facts'
import { landUseKey } from '../land-use-key'

type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>

/** scope terms tested from the lot's own facts by the evaluator, not through nsw.scope_layer */
const OWN = /^(lga:|map:|notmap:|unheld:|near:|nearzone:|use:|fact:|!?zone:|zoneclass:|zonegroup:|area>=|lot$)/

export async function ragLotFacts(q: Query, cadid: string, tier: 'rag' | 'kg' = 'rag', opts: { precinct?: boolean } = {}) {
  const f: any = await lotFacts(q as any, cadid, landUseKey, [], [], opts)
  // every instrument at the lot's point with its unit (derived.lot_instrument): the governing one and the also-mapped ones
  // (precinct mode only: without `units` on the lot, the engine keeps every unit-bound instrument silent)
  const units: Record<string, { unit: string | null; heading: string | null; basis: string; governing: boolean; cover: number | null }> | undefined = opts.precinct ? {} : undefined
  if (units) for (const r of (await q(`SELECT document_title, unit_local_id, unit_heading, unit_basis, governing, cover_pct FROM derived.lot_instrument WHERE cadid = $1`, [cadid]).catch(() => ({ rows: [] as any[] }))).rows)
    units[r.document_title] = { unit: r.unit_local_id ?? null, heading: r.unit_heading ?? null, basis: r.unit_basis, governing: !!r.governing, cover: r.cover_pct == null ? null : Number(r.cover_pct) }
  const lmr = (await q(`SELECT band, class, measured_from, excluded_by, eligible_types FROM lmr.lot_lmr WHERE cadid::text = $1`, [cadid])).rows[0]
  const addr = (await q(`SELECT formatted_address FROM derived.lot_profile WHERE cadid::text = $1 ORDER BY is_primary_address DESC NULLS LAST, address_confidence DESC NULLS LAST LIMIT 1`, [cadid])).rows[0]
  // "Area 1 on the Key Sites Map" came back both from epi.epi_key_sites (Young Street, Randwick - right) and from
  // dpie_ppl_6 (Matraville - wrong): where the plan's own epi layer has the label anywhere, a resolver polygon for it is not used
  const mapped = (await q(`
    WITH lot AS (SELECT geom FROM cadastre.lot WHERE cadid::text = $1 LIMIT 1),
         hit AS (SELECT m.document_id, m.map, m.label, m.own, ST_Area(ST_Intersection(m.geom, lot.geom)::geography) / nullif(ST_Area(lot.geom::geography), 0) AS share
                   FROM rag.map_polygon m, lot WHERE m.geom && lot.geom AND ST_Intersects(m.geom, lot.geom))
    SELECT DISTINCT ON (h.document_id, h.map, h.label) h.document_id::text AS document_id, h.map, h.label, round(h.share::numeric, 2)::float8 AS share
      FROM hit h
     WHERE h.own OR NOT EXISTS (SELECT 1 FROM rag.map_polygon o WHERE o.own AND o.document_id = h.document_id AND o.map = h.map AND o.label = h.label)
     ORDER BY h.document_id, h.map, h.label, h.share DESC`, [cadid]).catch(() => ({ rows: [] as any[] }))).rows.filter((m: any) => m.share > 0.01)
  const boundTerms = (await q(`SELECT DISTINCT unnest(scope_terms) t FROM rag.claim_binding WHERE status = 'bound'`).catch(() => ({ rows: [] as any[] }))).rows
    .map(r => String(r.t)).filter(t => !OWN.test(t))
  const terms: Record<string, { holds: boolean | null; why: string }> = {}
  for (const t of boundTerms) terms[t] = await lotTermInterior(q as any, cadid, t, f.lga ?? null).catch(e => ({ holds: null, why: `query failed: ${String(e).slice(0, 80)}` }))

  // ── the DCP tier's own guards ───────────────────────────────────────────────────────────────
  // A DCP binds to facts no LEP ever needed - the road class of the frontage, the suburb, a named
  // address - which arrive as `<guard>:<literal>` terms that lotTermInterior cannot answer. Only
  // when the caller asked for the tier; the rag path never sees this query.
  if (tier === 'kg') {
    const dcpTerms = (await q(`SELECT DISTINCT unnest(scope_terms) t FROM dcp.claim_binding WHERE status = 'bound'`)
      .catch(() => ({ rows: [] as any[] }))).rows.map(r => String(r.t)).filter(isGuardTerm)
    Object.assign(terms, await dcpGuardFacts(q as any, cadid, dcpTerms).catch(() => ({})))
  }
  // "within N m of <label> on <map>": the lot within that distance of any polygon of the plan's map with that label
  const nearTerms = (await q(`SELECT DISTINCT unnest(scope_terms) t FROM rag.claim_binding WHERE status = 'bound'`).catch(() => ({ rows: [] as any[] }))).rows.map(r => String(r.t)).filter(t => t.startsWith('near:'))
  for (const t of nearTerms) {
    const [, doc, metres, key] = t.match(/^near:([^:]+):([\d.]+):(.+)$/) ?? []
    const [map, label] = String(key ?? '').split('|')
    if (!doc || !map) continue
    const r = (await q(`SELECT EXISTS (SELECT 1 FROM rag.map_polygon m, cadastre.lot l WHERE l.cadid::text = $1 AND m.document_id = $2 AND m.map = $3 AND m.label = $4
                          AND ST_DWithin(m.geom::geography, l.geom::geography, $5)) AS h`, [cadid, doc, map, label, Number(metres)]).catch(() => null))
    terms[t] = r ? { holds: Boolean(r.rows[0].h), why: `${r.rows[0].h ? 'within' : 'not within'} ${metres} m of ${label} on the ${map} map` } : { holds: null, why: 'distance query failed' }
  }
  // "within N m of a boundary between any 2 zones" (cl 5.3): the lot within N m of land the plan zones differently - any
  // other zone, or the zones named (nearzone:<m>|<zone-code pattern>), on the plan's own zoning map
  const zoneTerms = (await q(`SELECT DISTINCT unnest(scope_terms) t FROM rag.claim_binding WHERE status = 'bound'`).catch(() => ({ rows: [] as any[] }))).rows.map(r => String(r.t)).filter(t => t.startsWith('nearzone:'))
  for (const t of zoneTerms) {
    const [, metres, pat] = t.match(/^nearzone:([\d.]+)\|(.*)$/) ?? []
    if (metres == null || !f.epi || !f.zone) { terms[t] = { holds: null, why: 'the lot has no zone on the plan' }; continue }
    const r = (await q(`SELECT string_agg(DISTINCT z.sym_code, ', ') AS z FROM epi.epi_land_zoning z, cadastre.lot l
                         WHERE l.cadid::text = $1 AND z.epi_name = $2 AND z.sym_code IS DISTINCT FROM $3 AND ($4 = '' OR z.sym_code ~ ('^(' || $4 || ')$'))
                           AND z.geom && ST_Expand(l.geom, $5 / 80000.0) AND ST_DWithin(z.geom::geography, l.geom::geography, $5)`, [cadid, f.epi, f.zone, pat ?? '', Number(metres)]).catch(() => null))
    const near = r?.rows[0]?.z ?? null
    terms[t] = r ? { holds: near != null, why: near ? `within ${metres} m of land in ${near}` : `no land in ${pat ? 'the zones named' : 'another zone'} within ${metres} m` } : { holds: null, why: 'zone distance query failed' }
  }
  // the Height of Buildings, Floor Space Ratio and Lot Size maps over the whole lot, not at one point: each figure the plan's
  // map gives the lot, with the share of the lot under it. One figure over (almost) the whole of what is mapped is the lot's
  // figure; two or more each over more than 5% split the lot (map_split) - the evaluator answers each part
  const MAPS: [string, string, string][] = [['height_map_m', 'epi.epi_height_of_building', 'h.max_b_h::float8'], ['fsr_map', 'epi.epi_floor_space_ratio', 'h.fsr::float8'],
    ['lot_size_map_m2', 'epi.epi_lot_size', `CASE WHEN h.units ~* 'ha' THEN h.lot_size::float8 * 10000 ELSE h.lot_size::float8 END`]]
  const mapFig: Record<string, number | null> = {}, map_split: Record<string, { value: number; share: number }[]> = {}
  for (const [field, table, expr] of MAPS) {
    if (!f.epi) continue
    const rows = (await q(`
      WITH l AS (SELECT geom, ST_Area(geom::geography) AS a FROM cadastre.lot WHERE cadid::text = $1 LIMIT 1)
      SELECT ${expr} AS value, sum(ST_Area(ST_Intersection(h.geom, l.geom)::geography) / nullif(l.a, 0))::float8 AS share
        FROM ${table} h, l WHERE h.epi_name = $2 AND h.geom && l.geom AND ST_Intersects(h.geom, l.geom) GROUP BY 1 ORDER BY 2 DESC`, [cadid, f.epi]).catch(() => null))?.rows
    if (!rows) continue                                                  // a geometry the intersection could not take: the point value stands
    const parts = rows.filter((r: any) => r.value != null && r.share > 0.05).map((r: any) => ({ value: Number(r.value), share: Math.round(Number(r.share) * 100) / 100 }))
    const mapped = parts.reduce((s, p) => s + p.share, 0)
    if (parts.length === 1 || (parts[0] && parts[0].share >= 0.9 * mapped)) mapFig[field] = parts[0]!.value
    else if (parts.length > 1) { map_split[field] = parts; mapFig[field] = null }
  }
  const heritage = (await q(`SELECT string_agg(DISTINCT h.lay_class, ', ') c FROM epi.epi_heritage h, cadastre.lot l
                              WHERE l.cadid::text = $1 AND h.geom && l.geom AND ST_Intersects(h.geom, ST_PointOnSurface(l.geom))`, [cadid])).rows[0]?.c ?? null
  // the lot's shape the complying development codes test: its depth ("50% of the depth of the lot") and whether it fronts
  // two parallel roads (a "parallel road lot"), from the 04D lot profile
  const shape = (await q(`SELECT lot_depth_m, is_through_lot FROM derived.lot_profile WHERE cadid::text = $1 ORDER BY is_primary_address DESC NULLS LAST LIMIT 1`, [cadid]).catch(() => null))?.rows[0] ?? null
  return {
    cadid, lot: f.lotId, address: addr?.formatted_address ?? null, lga: f.lga, zone: f.zone, epi: f.epi, ...(units ? { unit: f.unit ?? null, units } : {}), area_m2: f.areaM2, frontage_m: f.frontageM ?? null,
    battle_axe: f.isBattleaxe ?? null, lot_depth_m: shape?.lot_depth_m != null ? Number(shape.lot_depth_m) : null, through_lot: shape?.is_through_lot ?? null,
    // the map figures over the whole lot where they could be measured, else at the lot's point (shared/norms/facts.ts)
    fsr_map: 'fsr_map' in mapFig ? mapFig.fsr_map : f.fsrMax ?? null, height_map_m: 'height_map_m' in mapFig ? mapFig.height_map_m : f.heightMaxM ?? null,
    lot_size_map_m2: 'lot_size_map_m2' in mapFig ? mapFig.lot_size_map_m2 : f.lotSizeMinM2, ...(Object.keys(map_split).length ? { map_split } : {}), heritage, mapped, terms,
    low_mid_rise_area: lmr ? { band: lmr.band, class: lmr.class, from: lmr.measured_from, excluded_by: lmr.excluded_by } : { band: null, note: 'not within a low and mid rise housing area' },
  }
}
