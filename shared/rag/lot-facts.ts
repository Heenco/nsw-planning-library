/**
 * RAG pilot - the facts side D (shared/rag/evaluate.ts) reads for one lot. One recipe, used frozen by the question bank
 * (scripts/rag/06-questions.ts) and live by any endpoint that asks the engine about a lot, so the two cannot drift.
 *
 *   base       shared/norms/facts.ts lotFacts: zone, area, frontage, battle-axe, the FSR / height / lot size maps, council
 *   lmr        lmr.lot_lmr: the low and mid rise band and class
 *   mapped     the map areas the lot is in (nsw.rule_spatial_ref, the plan's own epi polygon preferred where two refs give
 *              one map label different polygons) with the share of the lot inside
 *   terms      every registered term the graph's claims are bound to (rag.claim_binding), tested with lotTermInterior:
 *              a polygon holds only where it covers 1 m2 or more of the lot
 */
import { lotFacts } from '../norms/facts'
import { lotTermInterior } from './lot-terms'
import { landUseKey } from '../land-use-key'

type Query = (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>

/** scope terms tested from the lot's own facts by the evaluator, not through nsw.scope_layer */
const OWN = /^(lga:|map:|!?zone:|zoneclass:|area>=|lot$)/

export async function ragLotFacts(q: Query, cadid: string) {
  const f: any = await lotFacts(q as any, cadid, landUseKey)
  const lmr = (await q(`SELECT band, class, measured_from, excluded_by, eligible_types FROM lmr.lot_lmr WHERE cadid::text = $1`, [cadid])).rows[0]
  const addr = (await q(`SELECT formatted_address FROM derived.lot_profile WHERE cadid::text = $1 ORDER BY is_primary_address DESC NULLS LAST, address_confidence DESC NULLS LAST LIMIT 1`, [cadid])).rows[0]
  // "Area 1 on the Key Sites Map" came back both from epi.epi_key_sites (Young Street, Randwick - right) and from
  // dpie_ppl_6 (Matraville - wrong): where the plan's own epi layer has the label, it wins
  const mapped = (await q(`
    WITH refs AS (
      SELECT regexp_replace(r.map_layer, ' Map$', '') AS map, r.value AS label, r.geom, (r.geom_source LIKE 'epi.%') AS own,
             bool_or(r.geom_source LIKE 'epi.%') OVER (PARTITION BY regexp_replace(r.map_layer, ' Map$', ''), r.value) AS has_own
        FROM nsw.rule_spatial_ref r JOIN rag.instrument i ON i.kind = 'lep' AND r.document_id = i.document_id WHERE r.geom IS NOT NULL)
    SELECT DISTINCT ON (refs.map, refs.label) refs.map, refs.label,
           round((ST_Area(ST_Intersection(refs.geom, ST_Transform(l.geom, ST_SRID(refs.geom)))) / nullif(ST_Area(ST_Transform(l.geom, ST_SRID(refs.geom))), 0))::numeric, 2)::float8 AS share
      FROM refs, cadastre.lot l
     WHERE l.cadid::text = $1 AND (refs.own OR NOT refs.has_own) AND ST_Intersects(refs.geom, ST_Transform(l.geom, ST_SRID(refs.geom)))
     ORDER BY refs.map, refs.label, 3 DESC`, [cadid]).catch(() => ({ rows: [] as any[] }))).rows.filter((m: any) => m.share > 0.01)
  const boundTerms = (await q(`SELECT DISTINCT unnest(scope_terms) t FROM rag.claim_binding WHERE status = 'bound'`).catch(() => ({ rows: [] as any[] }))).rows
    .map(r => String(r.t)).filter(t => !OWN.test(t))
  const terms: Record<string, { holds: boolean | null; why: string }> = {}
  for (const t of boundTerms) terms[t] = await lotTermInterior(q as any, cadid, t, f.lga ?? null).catch(e => ({ holds: null, why: `query failed: ${String(e).slice(0, 80)}` }))
  const heritage = (await q(`SELECT string_agg(DISTINCT h.lay_class, ', ') c FROM epi.epi_heritage h, cadastre.lot l
                              WHERE l.cadid::text = $1 AND h.geom && l.geom AND ST_Intersects(h.geom, ST_PointOnSurface(l.geom))`, [cadid])).rows[0]?.c ?? null
  return {
    cadid, lot: f.lotId, address: addr?.formatted_address ?? null, lga: f.lga, zone: f.zone, epi: f.epi, area_m2: f.areaM2, frontage_m: f.frontageM ?? null,
    battle_axe: f.isBattleaxe ?? null, fsr_map: f.fsrMax ?? null, height_map_m: f.heightMaxM ?? null, lot_size_map_m2: f.lotSizeMinM2, heritage, mapped, terms,
    low_mid_rise_area: lmr ? { band: lmr.band, class: lmr.class, from: lmr.measured_from, excluded_by: lmr.excluded_by } : { band: null, note: 'not within a low and mid rise housing area' },
  }
}
