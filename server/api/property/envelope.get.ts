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
import { fetchLotRing } from '../../utils/cadastre'
import { resolveDcpScope } from '../../../shared/dcp-scope'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const address = String(q.address ?? '').trim()
  if (!address) throw createError({ statusCode: 400, statusMessage: 'address required' })

  const landUses = String(q.use ?? 'dwelling house,dual occupancy')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const storeys = q.storeys ? Number(q.storeys) : 2

  const lot = (await nswQuery(
    `SELECT address, lot_section_plan, area_sqm, perimeter_m, primary_frontage_length_m, lot_depth_m,
            is_corner_lot, is_battleaxe, all_frontages, lzn_sym_code_p, hob_max_b_h_m, lot_size, lot_size_units, epi_name, lga_name
     FROM nsw.up_property_d_3 WHERE address = $1 LIMIT 1`,
    [address],
  )).rows[0]

  if (!lot) throw createError({ statusCode: 404, statusMessage: 'Property not found' })

  // Development types this zone allows, so an untagged rule can be matched
  // to the kind of development being modelled rather than applied blindly.
  const scope = resolveDcpScope(lot.lzn_sym_code_p, landUses, [], false)
  const devTypes = scope.devTypes.length ? scope.devTypes : ['residential']

  const controls = (await nswQuery(
    `SELECT DISTINCT r.clause, e.topic, e.comparator, e.value::float8 AS value,
            e.measured_from,
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
       -- Scope to the lot's own council. Without this every ingested DCP
       -- matches, so with two councils in the graph a Randwick lot was given
       -- Hornsby setbacks and the envelope was built from the wrong plan.
       AND upper(d.lga_name) = upper($3)
       AND (
         lu.value IS NOT NULL
         -- A rule naming no land use is general to its part of the DCP, which
         -- is the only kind Randwick has — all 17 of its usable setbacks are
         -- untagged, so requiring a land_use match returned nothing and every
         -- Randwick lot fell back to hardcoded defaults.
         --
         -- It still has to match a development type. Without that the
         -- "general" set sweeps in location-specific precinct parts that do
         -- not apply here: D1 Kensington and Kingsford contributed a 9 m side
         -- setback, D2 Randwick Junction a 20 m height, C10 Industrial areas
         -- a 2.2 m one. With it, every rule comes from C1 Low density
         -- residential, which is the part that actually governs a dwelling.
         -- Same guard the property report uses.
         OR (dt.value IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM nsw.rule_applicability x
           WHERE x.rule_id = r.id AND x.dimension = 'land_use'))
       )
       AND e.topic IN ('setback', 'height') AND e.value IS NOT NULL
       AND ($2::numeric IS NULL OR e.condition_metric IS DISTINCT FROM 'storeys'
            OR ($2 >= COALESCE(e.condition_lo, -1e9) AND $2 <= COALESCE(e.condition_hi, 1e9)))
       -- Randwick keys its side setbacks on frontage width: 0.9 m under 12 m,
       -- 1.2 m at 12 m and above. Without this every band matched and the
       -- widest value won on every lot, so a 9 m frontage was given the 12 m
       -- setback. A lot whose frontage is unknown keeps them all rather than
       -- silently taking none.
       AND ($5::numeric IS NULL OR e.condition_metric IS DISTINCT FROM 'frontage_width'
            OR ($5 >= COALESCE(e.condition_lo, -1e9) AND $5 <= COALESCE(e.condition_hi, 1e9)))
       -- A clause about an aerial, a pool or an excavation states a real
       -- setback for a real thing, and none of them is the house. Randwick C1
       -- cl 8.3 requires 900 mm from the rear boundary for a satellite dish;
       -- taken as the dwelling's rear setback it put the back wall on the
       -- fence. See migration 09.
       AND NOT EXISTS (
         SELECT 1 FROM nsw.rule_applicability anc
         WHERE anc.rule_id = r.id AND anc.dimension = 'dev_element'
           AND anc.value = 'ancillary')`,
    [landUses, storeys, lot.lga_name ?? '', devTypes, Number(lot.primary_frontage_length_m) || null],
  )).rows

  /**
   * Specific beats general, per boundary.
   *
   * The untagged set is a fallback, not a supplement. Mixed in wholesale it
   * ruined the council that has good data: Hornsby's dwelling setbacks are
   * tagged to cl 3.1.2 (9 m front, 8 m rear, 1.5 m side), and adding untagged
   * dev_type matches pulled in Part 6 rural-lands controls, taking the modelled
   * front setback from 9 m to 30 m. So for each control, if any rule names one
   * of the requested land uses, only those are used; the general rules are
   * consulted only where nothing named a use at all.
   */
  const byKey = new Map<string, any[]>()
  for (const c of controls as any[]) {
    const k = `${c.topic}|${c.measured_from ?? ''}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(c)
  }
  const scopedControls: any[] = []
  for (const rows of byKey.values()) {
    const named = rows.filter(r => r.land_use)
    scopedControls.push(...(named.length ? named : rows))
  }

  // The surveyed parcel, when the cadastre can supply it and it agrees with
  // the figures we hold. Failure is not fatal: the model falls back to the
  // frontage x depth rectangle and says so in its own rationale.
  const { ring, reason } = await fetchLotRing(lot.lot_section_plan, {
    area: lot.area_sqm, perimeter: lot.perimeter_m,
  })

  const { model, meta } = buildEnvelopeModel(lot, scopedControls, ring)
  if (!ring && reason) meta.geometryNote = reason

  setHeader(event, 'cache-control', 'public, max-age=300')

  // ?format=rationale returns the design-rationale document the viewer shows
  // beside the model. Same route because the two are built from one derivation:
  // the document has to describe the geometry that was actually produced.
  if (String(q.format ?? '') === 'rationale') {
    setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
    // Name every use the setbacks were drawn from — they are the worst case
    // across all of them — and say so when none of the rules named a use.
    const named = scopedControls.some((c: any) => c.land_use)
    return buildEnvelopeRationale(meta, {
      landUse: landUses.join(' / '),
      storeys,
      generalOnly: scopedControls.length > 0 && !named,
    })
  }

  // The viewer reads the model; the meta is here for anything else that wants
  // the numbers without re-deriving them. The two rings are dropped: they are
  // for callers that design inside the envelope (see /api/design/*), and a
  // 40-vertex polygon would fill the header on its own.
  const { lotPolygon, buildablePolygon, ...headerMeta } = meta as any
  setHeader(event, 'x-envelope-meta', JSON.stringify(headerMeta).slice(0, 900))
  return model
})
