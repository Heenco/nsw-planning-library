/**
 * The DCP controls that apply to one lot.
 *
 *   /api/frontage-dcp?lot=100//DP1139278&use=dwelling%20house
 *
 * The same rules the property report shows under "Key numerical rules", asked
 * for by lot rather than by coordinate, so the frontage tool can list them
 * beside the geometry it just measured.
 *
 * WHY THIS IS NOT A CALL TO /api/property-report
 *
 * That route is a streaming SSE answer that also runs the LLM narrative, the
 * permissibility resolver and the provisions lookup — seconds of work for a
 * panel that wants one table. It also keys on lat/lon, where everything on the
 * frontage page is keyed on a lot id.
 *
 * The query below is deliberately the report's, clause for clause, including
 * the two guards that took a while to get right there: the council scope, and
 * the rule that a clause naming no land use is general to its PART of the DCP
 * but must still match a development type. Both are load-bearing and the
 * reasons are recorded at the original in property-report.post.ts — this is a
 * second caller of one query shape, not a second opinion about which rules
 * apply. If they ever disagree, that is a bug in this file.
 *
 * COVERAGE
 *
 * up_property_d_4 is statewide, but the rule layer is Hornsby and Randwick.
 * A lot anywhere else gets `covered: false` and the councils named, which is a
 * result rather than an error — the frontage geometry is still valid for it.
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { resolveDcpScope } from '../../shared/dcp-scope'
import { PROPERTY_LGAS, PROPERTY_LGA_LABEL } from '../../shared/property-columns'
import { isoDate } from '../../shared/dates'

/** The report's own topic allowlist, so the two tables cannot drift. */
const TOPICS = [
  'setback', 'parking', 'landscaping', 'open_space', 'site_coverage', 'height',
  'floor_area', 'lot_size', 'density', 'fsr', 'width', 'privacy', 'solar_access',
  'deep_soil',
]

/** Reading order for the panel: what shapes the building, then the rest. */
const TOPIC_ORDER = [
  'setback', 'height', 'fsr', 'floor_area', 'site_coverage', 'lot_size', 'width',
  'landscaping', 'deep_soil', 'open_space', 'parking', 'density', 'privacy',
  'solar_access',
]

const TOPIC_LABEL: Record<string, string> = {
  setback: 'Setbacks', height: 'Height', fsr: 'Floor space ratio',
  floor_area: 'Floor area', site_coverage: 'Site coverage', lot_size: 'Lot size',
  width: 'Width', landscaping: 'Landscaping', deep_soil: 'Deep soil',
  open_space: 'Private open space', parking: 'Parking', density: 'Density',
  privacy: 'Privacy', solar_access: 'Solar access',
}

/**
 * Uses offered in the picker.
 *
 * The report derives these from the zone's land-use table; here they are a
 * fixed residential set, because the panel exists to answer "what would this
 * lot's controls be" rather than to enumerate permissibility. `dwelling house`
 * leads, being the default and the one most lots are asked about.
 */
export const DCP_USES = [
  'dwelling house', 'dual occupancy', 'secondary dwelling',
  'multi dwelling housing', 'residential flat building', 'shop top housing',
]

/**
 * Development types the DCPs actually tag rules with.
 *
 * Not a guess and not the whole Standard Instrument: these are the values
 * present in `rule_applicability` for `dimension = 'dev_type'` across the
 * ingested plans — Hornsby tags eight, Randwick three. Offering anything else
 * would be a dropdown entry that can only ever return nothing.
 *
 * `residential` leads because it is the default the resolver falls back to.
 */
export const DCP_DEV_TYPES = [
  'residential', 'business', 'industrial', 'rural',
  'community', 'heritage', 'river_settlement', 'subdivision',
]

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lotId = String(q.lot ?? '').trim().toUpperCase()
  const use = String(q.use ?? DCP_USES[0]).trim().toLowerCase()
  // Optional, and validated against the list rather than trusted: an unknown
  // value would otherwise quietly return an empty table that looks like "this
  // lot has no controls" instead of "that is not a development type".
  const askedDevType = String(q.devType ?? '').trim().toLowerCase()
  const devTypeFilter = DCP_DEV_TYPES.includes(askedDevType) ? askedDevType : null
  const coverage = PROPERTY_LGA_LABEL

  if (!lotId) return { ok: false as const, reason: 'no_input', message: 'Pass ?lot=' }

  const { rows: lots } = await nswQuery(
    `SELECT DISTINCT ON (lot_section_plan) lga_name, lzn_sym_code_p AS zone, address
       FROM nsw.up_property_d_4
      WHERE upper(lot_section_plan) = $1
      ORDER BY lot_section_plan, address`,
    [lotId],
  )
  const lot = lots[0]
  if (!lot) {
    return {
      ok: false as const, reason: 'no_property', lotId, coverage,
      message: `up_property_d_4 holds no row for ${lotId}, so there is no council or zone to scope a DCP to.`,
    }
  }

  const lga = String(lot.lga_name ?? '')
  const covered = PROPERTY_LGAS.some(l => l === lga.toUpperCase())
  if (!covered) {
    return {
      ok: true as const, covered: false as const, lotId, lga, zone: lot.zone ?? null,
      address: lot.address ?? null, use, uses: DCP_USES,
      devType: devTypeFilter, devTypeOptions: DCP_DEV_TYPES, coverage,
      message: `${lga || 'This council'} has no decomposed DCP in the rule layer. `
        + `Clause-level controls are held for ${coverage}.`,
    }
  }

  // Development types the zone allows, so a clause naming no land use can still
  // be matched to the kind of development being asked about.
  const scope = resolveDcpScope(lot.zone, [use], [], false)
  /**
   * The zone decides which development types are in play, unless the caller
   * names one.
   *
   * The report needs to ask "what does this plan say about heritage
   * development here", which is a question about a part of the DCP rather than
   * about what the zone permits — so a stated dev type replaces the zone's set
   * instead of intersecting with it, which would usually be empty.
   */
  const devTypes = devTypeFilter
    ? [devTypeFilter]
    : (scope.devTypes.length ? scope.devTypes : ['residential'])
  /**
   * Only the use that was asked for — NOT scope.landUses.
   *
   * This is the one place this route deliberately parts from the report.
   * resolveDcpScope returns every use the ZONE permits, plus the proposed one,
   * because the report answers "what governs this land" and wants the breadth:
   * tourist accommodation, child care, the lot's whole permissible list.
   *
   * Here that made the use picker inert — Hornsby R2 returned the same 160
   * controls for a dwelling house as for a dual occupancy, because both queries
   * were really asking for all of R2. A picker that changes nothing is worse
   * than no picker.
   *
   * Narrowing to the chosen use keeps the clauses tagged to it and the
   * dev-type-general clauses that name no use at all, which together are what
   * governs THIS proposal. The consequence to know: this panel can therefore
   * show fewer controls than the report for the same lot, and that is the
   * intended difference, not a gap.
   */
  const landUses = [use]

  const { rows: rules } = await nswQuery(
    `SELECT DISTINCT
            COALESCE(lu.value, dt.value) AS applies_to,
            CASE WHEN lu.value IS NOT NULL THEN 'land_use' ELSE 'dev_type' END AS axis,
            d.title AS source_document,
            d.instrument_slug AS document_slug,
            split_part(r.rule_key, ':', 1) AS anchor,
            sec.heading AS section_heading,
            r.part, r.clause, e.topic, e.comparator,
            e.value::float8 AS value, e.unit, e.measured_from,
            e.condition_metric, e.condition_lo, e.condition_hi
       FROM nsw.rule r
       JOIN nsw.rule_effect e ON e.rule_id = r.id
       JOIN nsw.document d ON d.id = r.document_id
       LEFT JOIN nsw.section sec ON sec.id = r.section_id
       LEFT JOIN nsw.rule_applicability lu
              ON lu.rule_id = r.id AND lu.dimension = 'land_use'
             AND lower(lu.value) = ANY($1)
       LEFT JOIN nsw.rule_applicability dt
              ON dt.rule_id = r.id AND dt.dimension = 'dev_type'
             AND dt.value = ANY($2)
      WHERE d.doc_type = 'dcp'
        AND upper(d.lga_name) = upper($4)
        AND e.value IS NOT NULL
        AND e.topic = ANY($3)
        AND (
          lu.value IS NOT NULL
          OR (dt.value IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM nsw.rule_applicability x
                WHERE x.rule_id = r.id AND x.dimension = 'land_use'))
        )
        -- A clause about an aerial, a pool or an excavation states a real
        -- setback for a real thing, and none of them is the building. Randwick
        -- C1 cl 8.3 ("Communications dishes and aerial antennae") requires
        -- 900mm from the rear boundary, and without this it was listed here as
        -- a rear setback for a dwelling. The envelope already excludes these;
        -- see migration 09.
        AND NOT EXISTS (
          SELECT 1 FROM nsw.rule_applicability anc
          WHERE anc.rule_id = r.id AND anc.dimension = 'dev_element'
            AND anc.value = 'ancillary')
      ORDER BY e.topic, e.measured_from NULLS LAST, value`,
    [landUses, devTypes, TOPICS, lga],
  )

  const { rows: docs } = await nswQuery(
    `SELECT title, instrument_slug AS slug, as_at_date, commenced_date,
            currency_basis, savings_provision, pending_parts
       FROM nsw.document
      WHERE doc_type = 'dcp' AND upper(lga_name) = upper($1)
      LIMIT 1`,
    [lga],
  )
  const doc = docs[0]

  /**
   * Specific beats general, per control.
   *
   * A clause naming the land use asked about outranks one that names none, for
   * the same control. Without this an RFB on a Randwick R3 lot was shown C1
   * Low density residential's front and side setbacks — admitted because they
   * carry dev_type 'residential' and name no use — alongside C2's rear setback
   * that names RFBs explicitly. Both are "residential"; only one governs a flat
   * building.
   *
   * Partitioned by topic AND datum, not by topic alone, so a plan that states a
   * use-specific rear setback and only a general front one keeps both. That is
   * exactly 7 Hill Street: cl 4.3.3 names RFBs for the rear, and nothing in
   * scope names a use for the front, so the general front setback stays rather
   * than the boundary going silent.
   *
   * The same partition the envelope route applies, for the same reason.
   */
  const byControl = new Map<string, any[]>()
  for (const r of rules as any[]) {
    const k = `${r.topic}|${r.measured_from ?? ''}`
    if (!byControl.has(k)) byControl.set(k, [])
    byControl.get(k)!.push(r)
  }
  const scoped: any[] = []
  for (const list of byControl.values()) {
    const named = list.filter(r => r.axis === 'land_use')
    scoped.push(...(named.length ? named : list))
  }

  // Grouped by topic rather than by what each rule applies to, which is how the
  // report does it. A panel this narrow is read by looking for one control —
  // "what is the side setback" — where the report is read top to bottom.
  const byTopic = new Map<string, any[]>()
  for (const r of scoped) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, [])
    byTopic.get(r.topic)!.push(r)
  }
  const groups = [...byTopic.entries()]
    .sort((a, b) => {
      const ia = TOPIC_ORDER.indexOf(a[0])
      const ib = TOPIC_ORDER.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map(([topic, list]) => ({
      topic,
      label: TOPIC_LABEL[topic] ?? topic.replace(/_/g, ' '),
      rules: list,
    }))

  setHeader(event, 'cache-control', 'public, max-age=300')
  return {
    ok: true as const,
    covered: true as const,
    lotId,
    lga,
    zone: lot.zone ?? null,
    address: lot.address ?? null,
    use,
    uses: DCP_USES,
    devType: devTypeFilter,
    devTypeOptions: DCP_DEV_TYPES,
    coverage,
    devTypes,
    landUses,
    ruleCount: scoped.length,
    document: doc
      ? {
          title: doc.title,
          slug: doc.slug,
          asAt: isoDate(doc.as_at_date),
          commenced: isoDate(doc.commenced_date),
          currencyBasis: doc.currency_basis ?? null,
          savingsProvision: doc.savings_provision ?? null,
          pendingParts: Array.isArray(doc.pending_parts) ? doc.pending_parts : null,
          viewerHref: `/doc-viewer?doc=${doc.slug}`,
        }
      : null,
    groups,
  }
})
