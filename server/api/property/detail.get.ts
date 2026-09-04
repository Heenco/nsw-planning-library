/**
 * Everything we hold about one Hornsby lot, in three parts:
 *
 *   facts     — nsw.up_property_d_3, split into categories (shared/property-fields)
 *   standards — LEP Part 4 clauses 4.1–4.6: minimum lot size, height, FSR
 *   envelope  — the DCP setback and height planes the lot has to build inside
 *
 * The last two are what the 3D viewer needs; the first is what a reader needs.
 * Values come from the lot's own record where the pipeline resolved one
 * (`hob_max_b_h_m`, `lot_size`), and from the rule layer where it did not — the
 * response says which, because a mapped value and a clause value are different
 * kinds of fact and should not be blended.
 */

import { nswQuery } from '../../utils/nsw-kg/pool'
import { categorise, patternEligibility } from '../../../shared/property-fields'

/** LEP Part 4 — principal development standards. 4.5/4.6 carry no number. */
const PART4 = ['4.1', '4.1A', '4.1AA', '4.1B', '4.1C', '4.1D', '4.2', '4.2A',
  '4.3', '4.4', '4.5', '4.6']

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const address = String(q.address ?? '').trim()
  const lsp = String(q.lot ?? '').trim()
  if (!address && !lsp) {
    throw createError({ statusCode: 400, statusMessage: 'address or lot required' })
  }

  const lot = (await nswQuery(
    `SELECT * FROM nsw.up_property_d_3
     WHERE ${address ? 'address = $1' : 'lot_section_plan = $1'}
     LIMIT 1`,
    [address || lsp],
  )).rows[0]

  if (!lot) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  // ── LEP Part 4 standards ──────────────────────────────────────────────
  const standards = (await nswQuery(
    `SELECT r.clause, e.topic, e.comparator, e.value, e.unit,
            e.measured_from, e.condition_metric, e.condition_lo, e.condition_hi,
            s.heading AS section_heading
     FROM nsw.rule r
     JOIN nsw.document d ON d.id = r.document_id
     LEFT JOIN nsw.rule_effect e ON e.rule_id = r.id
     LEFT JOIN nsw.section s ON s.id = r.section_id
     WHERE d.doc_type = 'lep' AND r.clause = ANY($1)
     ORDER BY r.clause, e.topic`,
    [PART4],
  )).rows

  // ── DCP setback and height planes ─────────────────────────────────────
  // Scoped by land use, which in a DCP means "the section that names it" —
  // see the coverage note in scripts/planningai-envelope.mjs.
  const landUse = String(q.use ?? 'dual occupancy')
  const storeys = q.storeys ? Number(q.storeys) : null

  const envelope = (await nswQuery(
    `SELECT DISTINCT r.clause, e.topic, e.comparator, e.value, e.unit,
            e.measured_from, e.relative_to, e.condition_metric, e.condition_lo, e.condition_hi
     FROM nsw.rule_applicability a
     JOIN nsw.rule r ON r.id = a.rule_id
     JOIN nsw.rule_effect e ON e.rule_id = r.id
     JOIN nsw.document d ON d.id = r.document_id
     WHERE d.doc_type = 'dcp'
       AND a.dimension = 'land_use' AND lower(a.value) = lower($1)
       AND e.topic IN ('setback', 'height')
       AND ($2::numeric IS NULL OR e.condition_metric IS DISTINCT FROM 'storeys'
            OR ($2 >= COALESCE(e.condition_lo, -1e9) AND $2 <= COALESCE(e.condition_hi, 1e9)))
     ORDER BY e.topic, e.measured_from NULLS LAST, e.value`,
    [landUse, storeys],
  )).rows

  // The lot's own resolved controls, where the pipeline mapped one.
  const mapped = {
    height_m: lot.hob_max_b_h_m ?? null,
    fsr: lot.fsr_fsr ?? lot.fsr_fsr_p ?? null,
    min_lot_size: lot.lot_size ?? null,
    min_lot_size_units: lot.lot_size_units ?? null,
    zone: lot.lzn_sym_code_p ?? lot.lzn_label ?? null,
    epi: lot.epi_name ?? lot.epi_name_p ?? null,
  }

  return {
    lot: {
      address: lot.address,
      lot_section_plan: lot.lot_section_plan,
      suburb: lot.suburbname,
      lga: lot.lga_name,
      area_sqm: lot.area_sqm,
      frontage_m: lot.primary_frontage_length_m,
      depth_m: lot.lot_depth_m,
      is_corner: lot.is_corner_lot,
      centroid: lot.centroid_lat != null ? [lot.centroid_lon, lot.centroid_lat] : null,
    },
    mapped,
    categories: categorise(lot),
    patterns: patternEligibility(lot),
    standards,
    envelope: { land_use: landUse, storeys, controls: envelope },
  }
})
