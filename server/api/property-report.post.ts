import { withNswClient } from '../utils/nsw-kg/pool'
import { PROPERTY_TABLE, PROPERTY_SELECT, parsePermissibleUses } from '../../shared/property-columns'
import {
  resolveDcpScope, defaultProposedUse, conditionLabel, TOPIC_PROSE, unitLooksWrong,
  operativeStoreyBand, matchesStoreyBand,
} from '../../shared/dcp-scope'

/**
 * Topics the numeric-rules table renders.
 *
 * `unspecified` (158 numeric effects) is left out on purpose: those are numbers
 * whose control type was never classified at ingest, so they would appear as
 * rows with a value and no idea what it governs.
 */
const SITE_RULE_TOPICS = [
  'setback', 'parking', 'landscaping', 'open_space', 'site_coverage', 'height',
  'floor_area', 'lot_size', 'density', 'fsr', 'width', 'privacy', 'solar_access',
  'deep_soil',
]
import { runQuery } from '../utils/nsw-kg/query/orchestrator'
// Deep legal cards replaced by per-use controls panel (see /api/use-analysis).
// Kept commented for potential reuse.
// import { runDeepLegalCards } from '../utils/sitewise/deep-legal-cards'

/** Postgres returns these columns as real booleans; earlier code compared them
 *  to the string 'true', so every flag silently read false — pattern book
 *  never rendered and CDC always showed "No". Accept both shapes. */
function isYes(v: unknown): boolean {
  return v === true || v === 'true' || v === 't' || v === 1 || v === '1'
}

function sseWrite(res: any, event: string, data: object) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (typeof res.flush === 'function') res.flush()
}

// Shared instruction for 3-section output
const SECTION_INSTRUCTION =
  `Structure the answer in exactly these three markdown headings, in this order:
` +
  `## LEP Findings
` +
  `The Local Environmental Plan: which zone applies and what that means, the Part 4 ` +
  `principal development standards that bear on this lot — minimum lot size (cl 4.1 ` +
  `and its variants), height of buildings (cl 4.3), floor space ratio (cl 4.4) — and ` +
  `cl 4.6 where a variation is available. Where a clause defers its number to a map, ` +
  `say so and give the mapped value from the site context.
` +
  `## SEPP Findings
` +
  `State policies that apply. The site context lists the SEPPs covering this land and the uses they permit - report those, attributed to the property record, plus anything the propositions state.
` +
  `## DCP Findings
` +
  `Only controls from the DCP part that governs this development type. Give the ` +
  `setbacks per boundary (front, rear, side, secondary) exactly as listed in the ` +
  `setback block. Each line is tagged with the land use it applies to — report ` +
  `them grouped by that use and never merge values across uses, because a ` +
  `dwelling house and a residential flat building have different setbacks. ` +
  `setback block, with the storey condition where one is given. Do not state a DCP ` +
  `building height, site coverage or landscaping figure unless a proposition states ` +
  `it — the mapped height in the site context is the operative height standard.
` +
  `If a section has nothing applicable, write "No relevant [type] provisions found in ` +
  `the knowledge base." under that heading rather than filling it with controls for ` +
  `other development types.
`

// Persona-specific query templates
/**
 * One query, covering what the three personas used to ask separately: permitted
 * uses and constraints (owner), development standards and CDC pathways
 * (developer), and the controls themselves (planner). The report has a single
 * audience now and gives everyone the full picture.
 */
/**
 * One query for the whole report.
 *
 * Deliberately names the development type and the governing clauses: asked
 * only "what can be built here", retrieval came back with farm stay
 * accommodation and garden centre controls, because those propositions are
 * lexically close to a broad question. The zone and the standards narrow it to
 * the provisions that actually decide this lot.
 */
const PLANNING_QUERY = (addr: string, zone: string, lga: string) =>
  `For a dwelling house or dual occupancy on land in zone ${zone} in ${lga}: ` +
  `which uses are permitted with and without consent, and what are the ` +
  `principal development standards — minimum lot size, height of buildings, ` +
  `floor space ratio — and the clause 4.6 variation pathway? ` +
  `Then the residential DCP controls that apply to that development type: ` +
  `setbacks to each boundary, building height and storeys, site coverage, ` +
  `landscaping and private open space. Address: ${addr}

${SECTION_INSTRUCTION}`

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { lat, lng, address, persona, use } = body || {}

  if (!address && (!lat || !lng)) {
    throw createError({ statusCode: 400, message: 'Missing address and lat/lng' })
  }

  const config = useRuntimeConfig()
  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  try {
    // ── Phase 1: Property lookup via spatial intersection ──────────────
    sseWrite(res, 'agent_step', { agent: 'Property', status: 'running', message: 'Looking up property…' })

    const property = await withNswClient(async (client) => {
      const r = await client.query(
        `SELECT
          -- Identity
          ${PROPERTY_SELECT}
        FROM ${PROPERTY_TABLE}
        WHERE
          CASE
            WHEN $3::text IS NOT NULL AND $3 <> '' THEN address = $3
            ELSE centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
          END
        ORDER BY
          -- If address was provided, no ordering needed (exact match). Otherwise spatial KNN.
          CASE WHEN $3::text IS NOT NULL AND $3 <> '' THEN 0
               ELSE (centroid_lat::float8 - $1)^2 + (centroid_lon::float8 - $2)^2
          END
        LIMIT 1`,
        [lat, lng, address || null]
      )
      return r.rows[0] || null
    })

    if (!property) {
      sseWrite(res, 'agent_step', { agent: 'Property', status: 'warn', message: 'No property found at this location' })
      sseWrite(res, 'done', {})
      res.end()
      return
    }

    sseWrite(res, 'agent_step', { agent: 'Property', status: 'done', message: `Found: ${property.address}` })
    sseWrite(res, 'property', { property })

    // ── Phase 1b: Fetch all lots for this property (same propid) ──────
    let lots: any[] = []
    if (property.propid) {
      lots = await withNswClient(async (client) => {
        const r = await client.query(
          `SELECT DISTINCT ON (lotnumber, planlabel)
                  lotnumber, sectionnumber, planlabel AS plan_label,
                  area_h, lot_section_plan, address
           FROM ${PROPERTY_TABLE}
           WHERE propid = $1
           ORDER BY lotnumber, planlabel`,
          [property.propid]
        )
        return r.rows
      })
      if (lots.length > 1) {
        sseWrite(res, 'agent_step', { agent: 'Property', status: 'done', message: `${lots.length} lots found for this property` })
      }
    }
    sseWrite(res, 'lots', { lots })

    // ── Phase 2: Permissibility lookup ────────────────────────────────
    sseWrite(res, 'agent_step', { agent: 'Permissibility', status: 'running', message: 'Checking permitted uses…' })

    // up_permissiblelanduse (a zone x instrument lookup) was dropped along with
    // up_property_comprehensive and has no replacement here, so the uses come
    // from the lot's own resolved list. Narrower but more specific: what applies
    // to this lot, rather than everything permissible in the zone.
    const permittedUses = parsePermissibleUses(property.permissible_uses)

    sseWrite(res, 'agent_step', {
      agent: 'Permissibility',
      status: 'done',
      message: `${permittedUses.length} permitted uses in zone ${property.zone}`,
    })
    sseWrite(res, 'permissibility', { zone: property.zone, lep: property.lep_name, uses: permittedUses })

    // ── Phase 3: Knowledge graph query (persona-shaped) ───────────────
    const kgQuery = PLANNING_QUERY(
      property.address || address || '',
      property.zone || 'unknown',
      property.lga_name || 'unknown',
    )

    // Build a property context block to prepend
    const p = property
    /** True when a _p column lists more than one value - i.e. a split lot. */
    const multi = (v: unknown) => typeof v === 'string' && v.includes(',')
    const contextLines = [
      `Address: ${p.address}`,
      `Zone: ${p.zone} (${p.zone_class || ''})`,
      `LEP: ${p.lep_name || 'N/A'}`,
      `LGA: ${p.lga_name || 'N/A'}`,
      `Council: ${p.council_name || 'N/A'}`,
      // An unmapped standard is stated rather than omitted. 92% of Hornsby lots
      // have no FSR and 27% no minimum lot size, and an omitted line reads to
      // the model as missing information, so it hedges — where the finding a
      // planner needs is that no such standard constrains this lot.
      p.fsr_value ? `FSR: ${p.fsr_value}`
        : 'FSR: NOT MAPPED for this lot - no clause states this, report it with no citation',
      p.max_height_m ? `Max height: ${p.max_height_m}m (Height of Buildings Map)` : 'Max height: none mapped for this lot',
      p.min_lot_size
        ? `Min lot size: ${p.min_lot_size} ${p.lot_size_units || 'sqm'}`
        // Spelled out because the model kept attaching the minimum-lot-size
        // clause to the absence, sending the reader to a clause that does not
        // say it. No clause states that a standard is unmapped.
        : 'Min lot size: NOT MAPPED for this lot - no clause states this, report it with no citation',
      p.area_sqm ? `Lot area: ${Math.round(Number(p.area_sqm))} sqm` : null,
      p.primary_frontage_length_m ? `Primary frontage: ${p.primary_frontage_length_m}m (${p.primary_frontage_road || ''})` : null,
      p.min_width_m ? `Min lot width: ${p.min_width_m}m` : null,
      p.average_slope ? `Average slope: ${Number(p.average_slope).toFixed(1)}°` : null,
      isYes(p.is_corner_lot) ? 'Corner lot: Yes' : null,
      isYes(p.is_battleaxe) ? 'Battle-axe lot: Yes' : null,
      p.heritage_name ? `Heritage: ${p.heritage_name} (${p.heritage_class || ''})` : null,
      p.floodmapping ? `Flood mapping: ${p.floodmapping}` : null,
      p.bushfireproneland ? `Bushfire prone: ${p.bushfireproneland}` : null,
      p.biodiversity ? `Biodiversity: ${p.biodiversity}` : null,
      p.acid_sulfate ? `Acid sulfate soils: ${p.acid_sulfate}` : null,
      p.coastal_wetlands ? `Coastal wetlands: ${p.coastal_wetlands}` : null,
      p.riparianlandwatercourse ? `Riparian/watercourse: ${p.riparianlandwatercourse}` : null,
      p.contamination_sitename ? `Contamination: ${p.contamination_sitename}` : null,
      isYes(p.cdc_eligible) ? `CDC eligible: Yes (${p.total_cdc_eligible} pathways)` : 'CDC eligible: No',
      isYes(p.cdc_dwelling_houses) ? 'CDC dwelling houses: eligible' : null,
      isYes(p.cdc_dual_occupancy) ? 'CDC dual occupancy: eligible' : null,
      isYes(p.cdc_secondary_dwellings) ? 'CDC secondary dwellings: eligible' : null,
      isYes(p.in_lmr_housing_area) ? 'In Low-Mid Rise housing area: Yes' : null,
      p.dcp_plan_name ? `DCP: ${p.dcp_plan_name}` : null,

      // (5) The _p columns hold every value intersecting the lot, so a comma
      // means the lot is split - two zones, two FSRs, two minimum lot sizes.
      // The single-value columns above hide that, and a split lot is exactly
      // the case where a reader must not assume one control applies throughout.
      multi(p.lzn_sym_code_p) ? `Additional zoning on part of the lot: ${p.lzn_sym_code_p} (primary ${p.zone})` : null,
      multi(p.fsr_fsr_p) ? `Additional FSR values on the lot: ${p.fsr_fsr_p}` : null,
      multi(p.lsz_sym_code_p) ? `Additional minimum lot sizes on the lot: ${p.lsz_sym_code_p}` : null,

      // (7) SEPP cover comes from the property record; the knowledge graph
      // holds no SEPP at all, so without this the SEPP section can only ever
      // say "nothing found" for every property in the LGA.
      p.sepps ? `SEPPs applying: ${p.sepps}` : null,
      p.sepp_landuses ? `Uses permitted via SEPP: ${String(p.sepp_landuses).slice(0, 600)}` : null,
    ].filter(Boolean).join('\n')

    // ── DCP numeric controls, from the structured rule layer ──────────
    //
    // The proposition layer that retrieval searches never captured the
    // residential setback table (DCP cl 3.1.2) — its setback propositions are
    // for driveways, undercrofts and garden centres. nsw.rule_effect does have
    // it, and it is what scripts/build-envelope-model.mjs builds the envelope
    // from, so the controls are supplied here as established facts carrying
    // their clause. Without this the DCP section of the report comes back empty.
    // (2) The DCP is organised by development type, so the controls to fetch
    // depend on what the zone actually allows. Asking only for dwelling house
    // and dual occupancy handed R3/R4 lots the wrong setbacks — the rule layer
    // also holds residential flat building (77 rules) and medium density (23).
    const zoneCode = String(property.zone || '').trim().toUpperCase()

    // The rule layer's own land_use vocabulary, so the scope is derived from
    // what the DCP actually holds rather than from a list kept in sync by hand.
    const ruleVocab = await withNswClient(async (client) => {
      const r = await client.query(
        `SELECT DISTINCT lower(a.value) AS value
         FROM nsw.rule_applicability a
         JOIN nsw.rule r ON r.id = a.rule_id
         JOIN nsw.document d ON d.id = r.document_id
         WHERE d.doc_type = 'dcp' AND a.dimension = 'land_use'`)
      return r.rows.map((x: any) => x.value as string)
    })

    // The development this report is about. Everything numeric below is computed
    // for it: a floor space ratio only becomes a floor area, and a minimum lot
    // size only becomes a pass or a fail, once there is a proposal to test.
    const proposedUse = String(use ?? '').trim() || defaultProposedUse(property.zone)

    const scope = resolveDcpScope(
      property.zone,
      permittedUses,
      ruleVocab,
      Boolean(property.heritage_id || property.heritage_name),
      proposedUse,
    )
    const dcpLandUses = scope.landUses

    // ── Key numerical rules, for the report table ─────────────────────
    //
    // Modelled on PropCode's Rapid Planning Report: one row per control with
    // the clause beside it. Landscaping in this DCP is a band (10/15/20/30/40/
    // 45/50%) whose selector was not captured in condition_metric, so every
    // value is shown as a range rather than collapsing to one figure that
    // would be wrong for most lots.
    const siteRules = await withNswClient(async (client) => {
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
                r.clause, e.topic, e.comparator,
                -- value_upper is null on all 887 DCP effects; not selected.
                e.value::float8 AS value, e.unit, e.measured_from, e.relative_to,
                e.condition_metric, e.condition_lo, e.condition_hi
         FROM nsw.rule r
         JOIN nsw.rule_effect e ON e.rule_id = r.id
         JOIN nsw.document d ON d.id = r.document_id
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
           AND upper(d.lga_name) = upper($4)
           AND e.value IS NOT NULL
           AND e.topic = ANY($3)
           AND (
             lu.value IS NOT NULL
             -- A rule that names no land use at all is general to its part of
             -- the DCP. Without this guard the 484 numeric effects on 131
             -- such rules are unreachable; with a looser guard (any dev_type
             -- match) a residential flat building setback would be served to a
             -- dwelling house, since those rules are tagged 'residential' too.
             OR (dt.value IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM nsw.rule_applicability x
                   WHERE x.rule_id = r.id AND x.dimension = 'land_use'))
           )
         ORDER BY axis, applies_to, e.topic, e.measured_from NULLS LAST, value`,
        [dcpLandUses, scope.devTypes, SITE_RULE_TOPICS, property.lga_name ?? ''],
      )
      return r.rows
    })
    // Provisions that apply because of where the lot is, not what it is.
    // Additional permitted uses exist only in the graph -- up_property_d_3 has
    // no column for them -- and the Part 4 standards exist only as a clause in
    // the graph plus a number in the record, so neither source answers alone.
    const provisions = await withNswClient(c => getLotProvisions(c, property))
    sseWrite(res, 'provisions', provisions)

    // ── Figures derived for the proposed use ───────────────────────────
    //
    // A ratio is not what anyone builds to. 0.5:1 on a 651 m² lot is 325 m² of
    // gross floor area, and that is the number a planner checks a drawing
    // against. Same for the deep soil percentage and the storey count.
    const areaSqm = Number(property.area_sqm) || null
    const fsr = Number(property.fsr_value) || null
    const heightM = Number(property.max_height_m) || null

    const derived = {
      proposedUse,
      areaSqm,
      // Floor space ratio is expressed n:1, so the multiplier is the ratio.
      maxGrossFloorArea: areaSqm && fsr ? Math.round(areaSqm * fsr * 100) / 100 : null,
      fsr,
      heightM,
      // Storeys are not mapped anywhere; this is the DCP's own implied figure
      // for residential floor-to-floor, and is labelled as indicative.
      approxStoreys: heightM ? Math.max(1, Math.floor(heightM / 3.1)) : null,
      minLotSize: property.min_lot_size == null ? null : Number(property.min_lot_size),
      // Whether this lot meets the minimum its own LEP maps for it.
      meetsMinLotSize: areaSqm && property.min_lot_size != null
        ? areaSqm >= Number(property.min_lot_size) : null,
      frontageM: Number(property.primary_frontage_length_m) || null,
    }
    sseWrite(res, 'derived', derived)

    sseWrite(res, 'site_rules', {
      land_uses: dcpLandUses,
      dev_types: scope.devTypes,
      zone: zoneCode,
      source_documents: [...new Set((siteRules as any[]).map(r => r.source_document).filter(Boolean))],
      rules: siteRules,
    })

    // ── DCP setbacks for the prompt, from the rows the table shows ─────
    //
    // Built from siteRules rather than a second query. Two queries meant the
    // model could cite a control the report never displayed, and vice versa.
    //
    // The key carries the clause, the comparator and the storey condition for
    // the same reason the table's does: the DCP runs parallel clause sets by
    // building scale (3.3.x at 3 storeys, 3.4.x at 5, 3.5.x at 6+), and keying
    // on topic alone merged them into one invented range — the model was being
    // handed "3 / 6 / 8 / 10 / 12 m" for a front setback that is 6 m or 9 m
    // depending on which scale you are building at.
    const controlGroups = new Map<string, any[]>()
    for (const c of siteRules as any[]) {
      const cond = conditionLabel(c)
      const key = [c.axis, c.applies_to, c.topic, c.measured_from ?? c.relative_to ?? '',
        c.unit ?? '', c.clause, c.comparator ?? '', cond].join('|')
      if (!controlGroups.has(key)) controlGroups.set(key, [])
      controlGroups.get(key)!.push(c)
    }

    const BOUND: Record<string, string> = { gte: '>=', lte: '<=', gt: '>', lt: '<' }

    // Ordered the way the report's table orders its groups: use-specific before
    // general, best-evidenced first. Alphabetical order led with "community
    // facility" and the model answered an R4 lot as though it were a house —
    // the residential flat building controls, which are the ones that matter
    // there, came last and went unmentioned.
    const scopeWeight = new Map<string, number>()
    for (const c of siteRules as any[]) {
      const k = `${c.axis}|${c.applies_to}`
      scopeWeight.set(k, (scopeWeight.get(k) ?? 0) + 1)
    }
    // Which storey band this lot sits in, read off the DCP's own height table.
    // Without it the per-scope cap fed the model cl 3.3.x (the 3-storey set) for
    // a lot mapped at 16.5m, whose operative set is cl 3.4.x at 5 storeys — the
    // right clause numbers for the wrong building.
    const storeyBand = operativeStoreyBand(siteRules as any[], property.max_height_m)

    const orderedGroups = [...controlGroups.values()].sort((a, b) => {
      const ka = `${a[0].axis}|${a[0].applies_to}`
      const kb = `${b[0].axis}|${b[0].applies_to}`
      if (a[0].axis !== b[0].axis) return a[0].axis === 'land_use' ? -1 : 1
      const w = (scopeWeight.get(kb) ?? 0) - (scopeWeight.get(ka) ?? 0)
      if (w) return w
      // Inside a scope, the clause set this lot's height actually selects first,
      // so the cap trims the bands that do not apply rather than the ones that do.
      const ma = matchesStoreyBand(a[0], storeyBand) ? 0 : 1
      const mb = matchesStoreyBand(b[0], storeyBand) ? 0 : 1
      return (ma - mb) || String(a[0].clause).localeCompare(String(b[0].clause))
    })

    const describe = (group: any[]) => {
      const c = group[0]
      const unit = c.unit === 'metre' ? 'm' : c.unit === 'percent' ? '%' : c.unit ? ` ${c.unit}` : ''
      const where = c.measured_from || c.relative_to
        ? ` ${String(c.measured_from || c.relative_to).replace(/_/g, ' ')}` : ''
      const vals = [...new Set(group.map(g => Number(g.value)))].sort((a, b) => a - b)
      // No comparator recorded means no bound was stated; say so rather than
      // asserting a minimum the DCP never set.
      const bound = BOUND[c.comparator as string]
      const figures = vals.length > 1
        ? `${vals.join('/')}${unit} (most restrictive ${Math.max(...vals)}${unit})`
        : `${vals[0]}${unit}`
      const stated = bound ? `${bound} ${figures}` : figures
      const condText = conditionLabel(c)
      // Prose, not brackets: square brackets are the citation marker syntax, and
      // "[applies at 5 storeys]" came back rendered as a dead citation chip.
      const cond = condText ? ` at ${condText}` : ''

      return `    ${TOPIC_PROSE[c.topic as string] ?? c.topic}${where}: ${stated}${cond} [dcp.${c.clause}]`
    }

    // Capped per scope, not overall.
    //
    // A flat cap truncates the tail, and the tail is where the general
    // development-type controls sit — an R4 lot produced 183 lines of which the
    // last 23 were the subdivision and residential-general groups, so a single
    // 160-line cut removed exactly the controls nothing else covers. Every scope
    // now keeps a share, and a scope that is trimmed says by how much.
    const PER_SCOPE_CAP = 55
    const byScope = new Map<string, any[][]>()
    for (const g of orderedGroups) {
      const k = `${g[0].axis}|${g[0].applies_to}`
      if (!byScope.has(k)) byScope.set(k, [])
      byScope.get(k)!.push(g)
    }

    // The leading group is named as the principal one in the block itself.
    // Ordering alone was not enough: with the residential flat building controls
    // first, the model still opened an R4 lot with "for a dwelling house", which
    // is the least of what that zone allows.
    /**
     * Controls the summary must not assert.
     *
     * Withheld from the prompt rather than annotated in it: when they were sent
     * with a warning the model narrated the warning back — "landscaping >= 7m is
     * not a limit because no bound is recorded for it" — which is worse than
     * silence. The report's table still lists every one of them, flagged, so the
     * record is complete and only the prose is restrained.
     */
    const withhold = (c: any) =>
      !BOUND[c.comparator as string]
      || unitLooksWrong(c.topic, c.unit)
      || (storeyBand ? !matchesStoreyBand(c, storeyBand) : false)

    let first = true
    let withheldCount = 0
    const dcpSections: string[] = []
    for (const [, groups] of byScope) {
      const c = groups[0]![0]
      const lead = first ? ' - the principal use for this lot; report this group first' : ''
      first = false
      const heading = c.axis === 'land_use'
        ? `  For ${c.applies_to}${lead}:`
        : `  For ${c.applies_to} development generally (the DCP names no land use for these)${lead}:`
      const usable = groups.filter(g => !withhold(g[0]))
      withheldCount += groups.length - usable.length
      if (!usable.length) continue
      const kept = usable.slice(0, PER_SCOPE_CAP)
      dcpSections.push([
        heading,
        ...kept.map(describe),
        usable.length > kept.length
          ? `    (+${usable.length - kept.length} further controls for this use, not listed)`
          : '',
      ].filter(Boolean).join('\n'))
    }

    const dcpBlock = dcpSections.length
      ? [
          '',
          '',
          `DCP numeric controls in scope for this lot (zone ${zoneCode}), grouped by`,
          'what they apply to and ordered with the most significant use for this lot',
          'first. Do not carry a control from one group to another. The bracketed',
          'reference on each line is the citation marker to reproduce verbatim,',
          'e.g. [dcp.3.1.2]:',
          storeyBand
            ? `  This lot's mapped height of ${property.max_height_m}m puts it in the DCP's`
              + ` ${storeyBand.label} band, so the clause set stated for that band is the`
              + ` operative one. Where a control shows "[applies at ...]", state that`
              + ` condition with it - the same control has a different value at another scale.`
            : '',
          ...dcpSections,
        ].join('\n')
      : ''

    // ── Make the supplied clauses citable ──────────────────────────────
    //
    // Everything in dcpBlock is handed to the model as an established fact, so
    // the model cites it. Those clauses are not retrieval candidates — the DCP
    // control tables never reached the proposition layer — so without this the
    // chips render as [?] and the reader cannot open what the report relies on.
    // Only the clauses actually supplied are listed, so an invented clause
    // number still fails to resolve.
    const citableExtras = [...new Map(
      (siteRules as any[]).map((c) => {
        const localId = `dcp.${c.clause}`
        return [localId, {
          id: `dcp-rule-${c.clause}`,
          document_id: 'dcp-rule-layer',
          // The document the clause is in, not the one up_property_d_3 names.
          // The record says "Hornsby DCP 2013 - as amended 31 May 2019" while
          // the rule layer is HDCP 2024, and the Sources list would otherwise
          // cite a 2024 clause number against the 2013 plan.
          document_title: String(c.source_document || property.dcp_plan_name || 'Hornsby DCP'),
          document_doc_type: 'dcp' as const,
          document_lga: property.lga_name ?? null,
          document_hierarchy_level: 3,
          document_source_url: null,
          section_id: localId,
          section_local_id: localId,
          section_number: String(c.clause),
          section_heading: null,
          section_source_file: null,
          section_page: null,
          type: 'control' as any,
          subject: String(c.applies_to ?? ''),
          predicate: String(c.topic ?? ''),
          object: c.value == null ? null : String(c.value),
          source_span: `DCP cl ${c.clause}: ${c.topic}`
            + `${c.measured_from || c.relative_to ? ' ' + String(c.measured_from || c.relative_to).replace(/_/g, ' ') : ''}`
            + ` ${c.comparator ?? ''} ${c.value}${c.unit ? ' ' + c.unit : ''}`
            + ` (applies to ${c.applies_to}).`,
        }]
      }),
    ).values()] as any[]

    const useLine = `

This report is written about a proposed ${proposedUse} on this lot. `
      + 'Answer for that development. Where a control applies only to a different '
      + 'use, leave it out rather than reporting it as though it applied here.'
    const enrichedQuery = `${kgQuery}${useLine}\n\nKnown property facts:\n${contextLines}${dcpBlock}\n\nPermitted uses in zone ${property.zone}: ${permittedUses.slice(0, 30).join(', ') || 'unknown'}`

    // Persona-gated AI work:
    //   owner     → no AI (facts + permissibility only)
    //   developer → planning summary (KG query), no use-specific analysis
    //   planner   → planning summary + on-demand per-use controls (see /api/use-analysis)
    const runPlanningSummary = true

    // ── Phase 3b: Deep legal cards (disabled) ────────────────────────
    // The 8 static "Detailed Planning Analysis" cards have been superseded
    // by the per-use controls panel, which fires LEP/SEPP/DCP queries
    // scoped to a specific permissible use selected by the user in the UI.
    // Kept for potential reuse:
    //
    // if (persona === 'planner') {
    //   const lga = (property.lga_name || '').replace(/^(city of|shire of|municipality of)\s*/i, '').trim()
    //   const gisResult = { lat: Number(property.centroid_lat), lng: Number(property.centroid_lon),
    //     place: property.address || '', zone: property.zone || '', lepName: property.lep_name || '',
    //     fsr: property.fsr_value || null, maxHeight: property.max_height_m || null, minLotSize: property.min_lot_size || null }
    //   await runDeepLegalCards({ gis: gisResult as any, lga,
    //     deepinfraKey: config.deepinfraApiKey, geminiKey: config.googleGeminiApiKey,
    //     emit: (type, payload) => sseWrite(res, type, payload),
    //     step: (agent, status, message, detail) => sseWrite(res, 'agent_step', { agent, status, message, detail }),
    //   }).catch(() => {})
    // }

    // ── Phase 4: Main planning summary via KG query (developer + planner) ───
    if (runPlanningSummary) {
      await runQuery({
        query: enrichedQuery,
        lgaFilter: property.lga_name || undefined,
        apiKey: config.deepinfraApiKey,
        geminiKey: config.googleGeminiApiKey,
        groqKey: config.groqApiKey,
        citableExtras,
        res: {
          write: (chunk: string) => res.write(chunk),
          flush: () => { if (typeof (res as any).flush === 'function') (res as any).flush() },
          end: () => {},
        },
      })
    }

    sseWrite(res, 'done', { ms: Date.now() })
    res.end()
  } catch (err) {
    sseWrite(res, 'error', { message: (err as Error).message || String(err) })
    res.end()
  }
})
