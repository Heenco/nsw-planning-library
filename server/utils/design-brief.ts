/**
 * The site brief: everything a designer — human or model — needs about one lot,
 * assembled from the knowledge graph and the cadastre.
 *
 * Deliberately built on top of buildEnvelopeModel rather than beside it. The
 * envelope route and the design lab have to agree about where the setback line
 * falls, and the only way to guarantee that is for both to derive it from the
 * same call. What this adds is breadth: the envelope needs setbacks and height
 * and nothing else, while a design has to answer to floor space, site coverage,
 * landscaping, deep soil, private open space and parking as well.
 *
 * Nothing here is generative. This is the input, and it is the same every time
 * for a given lot — which is what makes a generated scheme reviewable, since
 * the reader can check the brief independently of whatever the model did
 * with it.
 */

import { nswQuery } from './nsw-kg/pool'
import { fetchLotRing } from './cadastre'
import { buildEnvelopeModel } from '#shared/envelope-model.mjs'
import { resolveDcpScope } from '../../shared/dcp-scope'

/** Topics a design has to answer to, beyond the two the envelope needs. */
const DESIGN_TOPICS = [
  'setback', 'height', 'site_coverage', 'landscaping', 'open_space',
  'deep_soil', 'parking', 'fsr', 'floor_area', 'privacy', 'solar_access', 'density',
]

export interface DesignBrief {
  address: string
  lotSectionPlan: string | null
  lga: string | null
  zone: string | null
  epiName: string | null
  dcpName: string | null
  siteArea: number
  frontage: number | null
  depth: number | null
  isCornerLot: boolean
  isBattleaxe: boolean
  orientationDegrees: number | null
  averageSlope: number | null
  height: number
  heightSource: string
  heightHob: number | null
  heightDcp: number | null
  fsr: number | null
  minLotSize: number | null
  setbacks: { front: number, rear: number, side: number, secondary: number }
  setbackClauses: { front: string, rear: string, side: string, secondary: string }
  edgeRoles: string[]
  geometrySource: string
  lotPolygon: number[][] | null
  buildablePolygon: number[][] | null
  buildableArea: number
  buildableBbox: { x0: number, y0: number, x1: number, y1: number } | null
  landUses: string[]
  storeys: number
  controls: any[]
  narrativeControls: string[]
  envelopeMeta: any
}

/** Shoelace area of a ring in the local metric frame. */
function ringArea(pts: number[][] | null): number {
  if (!pts || pts.length < 3) return 0
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % n]
    a += x0 * y1 - x1 * y0
  }
  return Math.abs(a / 2)
}

export async function loadDesignBrief(
  address: string,
  { landUses, storeys }: { landUses: string[], storeys: number },
): Promise<DesignBrief> {
  const lot = (await nswQuery(
    `SELECT address, lot_section_plan, area_sqm, perimeter_m, primary_frontage_length_m, lot_depth_m,
            is_corner_lot, is_battleaxe, all_frontages, lzn_sym_code_p, hob_max_b_h_m, fsr_fsr,
            lot_size, lot_size_units, epi_name, lga_name, dcp_plan_name,
            orientation_degrees, average_slope, permissible_uses
     FROM nsw.up_property_d_3 WHERE address = $1 LIMIT 1`,
    [address],
  )).rows[0]

  if (!lot) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  const scope = resolveDcpScope(lot.lzn_sym_code_p, landUses, [], false)
  const devTypes = scope.devTypes.length ? scope.devTypes : ['residential']

  // The envelope route's control query, widened from two topics to twelve. The
  // scoping is identical and deliberately so — the LGA guard, the untagged
  // fallback and its dev_type condition are each there because dropping one
  // put another council's controls on the lot. See envelope.get.ts for the
  // history behind every clause of this WHERE.
  const controls = (await nswQuery(
    `SELECT DISTINCT r.clause, e.topic, e.comparator, e.value::float8 AS value, e.unit,
            e.measured_from, e.condition_metric, e.condition_lo, e.condition_hi,
            lu.value AS land_use
     FROM nsw.rule r
     JOIN nsw.rule_effect e ON e.rule_id = r.id
     JOIN nsw.document d ON d.id = r.document_id
     LEFT JOIN nsw.rule_applicability lu
            ON lu.rule_id = r.id AND lu.dimension = 'land_use'
           AND lower(lu.value) = ANY($1)
     LEFT JOIN nsw.rule_applicability dt
            ON dt.rule_id = r.id AND dt.dimension = 'dev_type'
           AND dt.value = ANY($4)
     WHERE d.doc_type = 'dcp'
       AND upper(d.lga_name) = upper($3)
       AND (
         lu.value IS NOT NULL
         OR (dt.value IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM nsw.rule_applicability x
           WHERE x.rule_id = r.id AND x.dimension = 'land_use'))
       )
       AND e.topic = ANY($5) AND e.value IS NOT NULL
       AND ($2::numeric IS NULL OR e.condition_metric IS DISTINCT FROM 'storeys'
            OR ($2 >= COALESCE(e.condition_lo, -1e9) AND $2 <= COALESCE(e.condition_hi, 1e9)))`,
    [landUses, storeys, lot.lga_name ?? '', devTypes, DESIGN_TOPICS],
  )).rows as any[]

  // Specific beats general, per control — the same partition the envelope
  // route applies. Mixing the untagged set in wholesale takes Hornsby's 9 m
  // dwelling front setback to the 30 m of its rural-lands part.
  const byKey = new Map<string, any[]>()
  for (const c of controls) {
    const k = `${c.topic}|${c.measured_from ?? ''}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(c)
  }
  const scoped: any[] = []
  for (const rows of byKey.values()) {
    const named = rows.filter(r => r.land_use)
    scoped.push(...(named.length ? named : rows))
  }

  const { ring } = await fetchLotRing(lot.lot_section_plan, {
    area: lot.area_sqm, perimeter: lot.perimeter_m,
  })

  // Only the two topics the envelope understands go into it, so the geometry
  // produced here is byte-for-byte the geometry /api/property/envelope serves.
  const envelopeControls = scoped.filter(c => c.topic === 'setback' || c.topic === 'height')
  const { meta } = buildEnvelopeModel(lot, envelopeControls, ring) as any

  const buildablePolygon = meta.buildablePolygon ?? null
  const lotPolygon = meta.lotPolygon ?? null

  return {
    address: lot.address,
    lotSectionPlan: lot.lot_section_plan ?? null,
    lga: lot.lga_name ?? null,
    zone: lot.lzn_sym_code_p ?? null,
    epiName: lot.epi_name ?? null,
    dcpName: lot.dcp_plan_name ?? null,
    // The surveyed ring when we have it: the recorded area and the parcel can
    // disagree, and every area test here is measured off the geometry the
    // design is actually drawn on.
    siteArea: lotPolygon ? ringArea(lotPolygon) : (Number(lot.area_sqm) || 0),
    frontage: meta.frontageLength ?? null,
    depth: Number(lot.lot_depth_m) || null,
    isCornerLot: !!lot.is_corner_lot,
    isBattleaxe: !!lot.is_battleaxe || !!meta.handleTrimmed,
    orientationDegrees: Number(lot.orientation_degrees) || null,
    averageSlope: Number(lot.average_slope) || null,
    height: meta.height,
    heightSource: meta.heightSource,
    heightHob: meta.heightHob ?? null,
    heightDcp: meta.heightDcp ?? null,
    fsr: Number(lot.fsr_fsr) || null,
    minLotSize: Number(lot.lot_size) || null,
    setbacks: { front: meta.front, rear: meta.rear, side: meta.side, secondary: meta.secondary },
    setbackClauses: {
      front: meta.frontClause, rear: meta.rearClause,
      side: meta.sideClause, secondary: meta.secondaryClause,
    },
    edgeRoles: meta.edgeRoles ?? [],
    geometrySource: meta.geometrySource,
    lotPolygon,
    buildablePolygon,
    buildableArea: ringArea(buildablePolygon),
    buildableBbox: buildablePolygon
      ? {
          x0: Math.min(...buildablePolygon.map((p: number[]) => p[0])),
          x1: Math.max(...buildablePolygon.map((p: number[]) => p[0])),
          y0: Math.min(...buildablePolygon.map((p: number[]) => p[1])),
          y1: Math.max(...buildablePolygon.map((p: number[]) => p[1])),
        }
      : null,
    landUses,
    storeys,
    controls: scoped,
    // Controls whose value is prose rather than a number still shape a design;
    // they are handed over as text so the model can honour them without them
    // being scored as if they were measurable.
    narrativeControls: [...new Set(scoped
      .filter(c => ['privacy', 'solar_access'].includes(c.topic))
      .map(c => `${c.topic}: ${c.comparator ?? ''} ${c.value} ${c.unit ?? ''} (cl ${c.clause})`.replace(/\s+/g, ' ').trim()))],
    envelopeMeta: meta,
  }
}
