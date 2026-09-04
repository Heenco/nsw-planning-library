/**
 * The planning envelope for one lot, as craftbot-model JSON.
 *
 * Served rather than pre-generated: Hornsby has 73,595 lots, and writing a file
 * per lot is neither practical nor needed — the viewer does a plain fetch() on
 * whatever path it is handed, so /craftbot?model=/api/property/envelope?address=…
 * works exactly like a static model file.
 *
 * Previously the report only offered a 3D link for the four lots someone had
 * run the script over, which is why the link appeared to be missing for
 * everything else.
 */

import { nswQuery } from '../../utils/nsw-kg/pool'
// #shared is Nuxt's alias for shared/ — a relative path to a .mjs file gets
// rewritten by the Nitro bundler and resolves outside the project root.
import { buildEnvelopeModel, buildEnvelopeRationale } from '#shared/envelope-model.mjs'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const address = String(q.address ?? '').trim()
  if (!address) throw createError({ statusCode: 400, statusMessage: 'address required' })

  const landUses = String(q.use ?? 'dwelling house,dual occupancy')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const storeys = q.storeys ? Number(q.storeys) : 2

  const lot = (await nswQuery(
    `SELECT address, lot_section_plan, area_sqm, primary_frontage_length_m, lot_depth_m,
            is_corner_lot, lzn_sym_code_p, hob_max_b_h_m, lot_size, epi_name
     FROM nsw.up_property_d_3 WHERE address = $1 LIMIT 1`,
    [address],
  )).rows[0]

  if (!lot) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  const controls = (await nswQuery(
    `SELECT DISTINCT r.clause, e.topic, e.comparator, e.value::float8 AS value,
            e.measured_from
     FROM nsw.rule_applicability a
     JOIN nsw.rule r ON r.id = a.rule_id
     JOIN nsw.rule_effect e ON e.rule_id = r.id
     JOIN nsw.document d ON d.id = r.document_id
     WHERE d.doc_type = 'dcp'
       AND a.dimension = 'land_use' AND lower(a.value) = ANY($1)
       AND e.topic IN ('setback', 'height') AND e.value IS NOT NULL
       AND ($2::numeric IS NULL OR e.condition_metric IS DISTINCT FROM 'storeys'
            OR ($2 >= COALESCE(e.condition_lo, -1e9) AND $2 <= COALESCE(e.condition_hi, 1e9)))`,
    [landUses, storeys],
  )).rows

  const { model, meta } = buildEnvelopeModel(lot, controls)

  setHeader(event, 'cache-control', 'public, max-age=300')

  // ?format=rationale returns the design-rationale document the viewer shows
  // beside the model. Same route because the two are built from one derivation:
  // the document has to describe the geometry that was actually produced.
  if (String(q.format ?? '') === 'rationale') {
    setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
    return buildEnvelopeRationale(meta, { landUse: landUses[0], storeys })
  }

  // The viewer reads the model; the meta is here for anything else that wants
  // the numbers without re-deriving them.
  setHeader(event, 'x-envelope-meta', JSON.stringify(meta).slice(0, 900))
  return model
})
