/**
 * The DCP numeric controls /report shows under "Key numerical rules", as one
 * scope and one query.
 *
 * Two callers need exactly this: /api/property-report, which renders them, and
 * /api/testing/report-inputs, which exists to show what the report was built
 * from. When the testing page ran its own query it listed every rule held for
 * the council — LEP and DCP, one row per rule, no scope — and could not explain
 * a single row of the report's table. Sharing the query is what makes the two
 * pages checkable against each other.
 */
import type pg from 'pg'
import { parsePermissibleUses } from '../../../shared/property-columns'
import {
  resolveDcpScope, defaultProposedUse, candidateUsesForZone, normaliseUse,
} from '../../../shared/dcp-scope'
import { pickProposedUse } from './lot-requirements'

/**
 * Topics the numeric-rules table renders.
 *
 * `unspecified` (158 numeric effects) is left out on purpose: those are numbers
 * whose control type was never classified at ingest, so they would appear as
 * rows with a value and no idea what it governs.
 */
export const SITE_RULE_TOPICS = [
  'setback', 'parking', 'landscaping', 'open_space', 'site_coverage', 'height',
  'floor_area', 'lot_size', 'density', 'fsr', 'width', 'privacy', 'solar_access',
  'deep_soil',
]

export interface SiteRuleScope {
  proposedUse: string
  landUses: string[]
  devTypes: string[]
  permittedUses: string[]
}

/**
 * The use the report is about, and the land uses and development types its
 * controls are fetched for. `property` is a PROPERTY_SELECT row.
 */
export async function resolveSiteRuleScope(
  client: pg.PoolClient,
  property: any,
  requestedUse?: string | null,
): Promise<SiteRuleScope> {
  // up_permissiblelanduse (a zone x instrument lookup) was dropped along with
  // up_property_comprehensive and has no replacement here, so the uses come
  // from the lot's own resolved list.
  const permittedUses = parsePermissibleUses(property.permissible_uses)

  // The rule layer's own land_use vocabulary, so the scope is derived from
  // what the DCP actually holds rather than from a list kept in sync by hand.
  const vocab = await client.query(
    `SELECT DISTINCT lower(a.value) AS value
     FROM nsw.rule_applicability a
     JOIN nsw.rule r ON r.id = a.rule_id
     JOIN nsw.document d ON d.id = r.document_id
     WHERE d.doc_type = 'dcp' AND a.dimension = 'land_use'`)
  const ruleVocab = vocab.rows.map((x: any) => x.value as string)

  // The development this report is about. Everything numeric below is computed
  // for it: a floor space ratio only becomes a floor area, and a minimum lot
  // size only becomes a pass or a fail, once there is a proposal to test.
  //
  // Where the reader has not chosen, the use is picked by testing the lot
  // rather than assumed. Defaulting to the least intensive use produced a
  // report about a dwelling house on a 949 m² R2 lot whose whole interest was
  // that it clears cl 4.1C for a dual occupancy and cl 4.1D to subdivide it.
  const requested = String(requestedUse ?? '').trim()
  // Only uses the lot is actually permitted, so a zone-level list cannot scope
  // the report to something this lot may not do.
  //
  // Both lists, because they are different permissions. Galston's record does
  // not carry dual occupancy in `permissible_uses` at all -- it is permitted
  // there by the Housing SEPP and appears only in `sepp_landuses` -- so
  // filtering on the LEP list alone dropped the one use that made the site
  // worth a report.
  const permittedSet = new Set([
    ...permittedUses,
    ...String(property.sepp_landuses ?? '').split(/[;,]/),
  ].map(u => normaliseUse(String(u))).filter(Boolean))
  const candidates = candidateUsesForZone(property.zone)
    .filter(u => !permittedSet.size || permittedSet.has(normaliseUse(u)))
  const picked = requested
    ? { use: requested }
    : await pickProposedUse(client, property,
      candidates.length ? candidates : candidateUsesForZone(property.zone))
  const proposedUse = picked.use || defaultProposedUse(property.zone)

  const scope = resolveDcpScope(
    property.zone,
    permittedUses,
    ruleVocab,
    Boolean(property.heritage_id || property.heritage_name),
    proposedUse,
  )
  return { proposedUse, landUses: scope.landUses, devTypes: scope.devTypes, permittedUses }
}

/**
 * The FROM/WHERE both the query and its funnel share. $1 land uses, $2 dev
 * types, $3 LGA. The topic and value filters are applied by the callers so the
 * funnel can count what each one drops.
 */
const SCOPED_FROM = `
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
           -- Scope to the property's own council. Without this every
           -- ingested DCP matches: with two councils in the graph a Randwick
           -- lot was served Hornsby's setbacks alongside its own, and the
           -- report gave no way to tell which was which. Compared case-insensitively
           -- because the property table shouts its LGA ("RANDWICK") while the
           -- document records it as the council names it ("Randwick").
           AND upper(d.lga_name) = upper($3)`

/**
 * The lot-scope guard. A rule that names no land use at all is general to its
 * part of the DCP. Without this guard the 484 numeric effects on 131 such rules
 * are unreachable; with a looser guard (any dev_type match) a residential flat
 * building setback would be served to a dwelling house, since those rules are
 * tagged 'residential' too.
 */
const IN_SCOPE = `(
             lu.value IS NOT NULL
             OR (dt.value IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM nsw.rule_applicability x
                   WHERE x.rule_id = r.id AND x.dimension = 'land_use'))
           )`

/**
 * One row per (scope, effect) the report's table is built from.
 *
 * Modelled on PropCode's Rapid Planning Report: one row per control with the
 * clause beside it. Landscaping in this DCP is a band (10/15/20/30/40/45/50%)
 * whose selector was not captured in condition_metric, so every value is shown
 * as a range rather than collapsing to one figure that would be wrong for most
 * lots.
 */
export async function fetchSiteRules(
  client: pg.PoolClient,
  scope: { landUses: string[]; devTypes: string[] },
  lga: string | null | undefined,
): Promise<any[]> {
  const r = await client.query(
    `SELECT DISTINCT
            COALESCE(lu.value, dt.value) AS applies_to,
            CASE WHEN lu.value IS NOT NULL THEN 'land_use' ELSE 'dev_type' END AS axis,
            -- The document these clauses are actually in. up_property_d_3
            -- names "Hornsby DCP 2013 - as amended 31 May 2019", but the
            -- ingested rule layer is HDCP 2024 — attributing 2024 clause
            -- numbers to the 2013 plan would misstate the source.
            d.title AS source_document,
            -- The instrument and the in-document anchor, so a clause can
            -- be opened in the right document at the right clause. The
            -- anchor is rule_key, which is the section id the converter
            -- authored: for a multi-part DCP that is part-namespaced
            -- ("dcp.C1.2.1"), which "dcp." || clause cannot reconstruct
            -- because clause numbering restarts in every part.
            d.instrument_slug AS document_slug,
            -- Trimmed at ':' because a table row gets its own rule whose
            -- key is the owning clause plus a row locator
            -- ("dcp.B7.5:t4.r8"). That locator addresses a row in the
            -- rule layer, not an element in the document — the clause it
            -- came from is what a reader needs to open. Trimming lifts
            -- the share of clause links that resolve from 87% to 100%.
            split_part(r.rule_key, ':', 1) AS anchor,
            -- The section the clause sits under. DCP rules carry no zone
            -- applicability at all, so the heading is the only thing that
            -- separates cl 6.2.1 "Residential Lands Subdivision" from
            -- cl 6.3.1 "Rural Lands Subdivision" -- which is why a 949 m²
            -- suburban lot was being shown 2-to-40-hectare minimums.
            sec.heading AS section_heading,
            r.clause, e.topic, e.comparator,
            -- value_upper is null on all 887 DCP effects; not selected.
            e.value::float8 AS value, e.unit, e.measured_from, e.relative_to,
            e.condition_metric, e.condition_lo, e.condition_hi
     ${SCOPED_FROM}
           AND e.value IS NOT NULL
           AND e.topic = ANY($4)
           AND ${IN_SCOPE}
         ORDER BY axis, applies_to, e.topic, e.measured_from NULLS LAST, value`,
    [scope.landUses, scope.devTypes, lga ?? '', SITE_RULE_TOPICS],
  )
  return r.rows
}

/** How the council's DCP effects narrow to the report's rows. Counts effects, not rows. */
export interface SiteRuleFunnel {
  /** Every effect on every rule of the council's DCP. */
  effects: number
  noValue: number
  /** Has a value, but its topic is not one the table renders. */
  offTopic: number
  /** Has a value and a rendered topic, but names neither this lot's uses nor its dev types. */
  outOfScope: number
  /** Reach the report. */
  kept: number
}

export async function siteRuleFunnel(
  client: pg.PoolClient,
  scope: { landUses: string[]; devTypes: string[] },
  lga: string | null | undefined,
): Promise<SiteRuleFunnel> {
  // Per effect, so a rule matched on both axes (two join rows) counts once.
  const r = await client.query(
    `WITH e AS (
       SELECT e.id,
              bool_or(e.value IS NOT NULL) AS has_value,
              bool_or(e.topic = ANY($4)) AS on_topic,
              bool_or(${IN_SCOPE}) AS in_scope
       ${SCOPED_FROM}
       GROUP BY e.id)
     SELECT count(*)::int AS effects,
            count(*) FILTER (WHERE NOT has_value)::int AS no_value,
            count(*) FILTER (WHERE has_value AND NOT on_topic)::int AS off_topic,
            count(*) FILTER (WHERE has_value AND on_topic AND NOT in_scope)::int AS out_of_scope,
            count(*) FILTER (WHERE has_value AND on_topic AND in_scope)::int AS kept
       FROM e`,
    [scope.landUses, scope.devTypes, lga ?? '', SITE_RULE_TOPICS],
  )
  const x = r.rows[0] ?? {}
  return {
    effects: x.effects ?? 0, noValue: x.no_value ?? 0, offTopic: x.off_topic ?? 0,
    outOfScope: x.out_of_scope ?? 0, kept: x.kept ?? 0,
  }
}
