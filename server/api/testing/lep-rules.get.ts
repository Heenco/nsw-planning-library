/**
 * Every LEP rule in the graph, decided against one lot.
 *
 * WHAT THIS ADDS. /testing-spatial-services already works out the facts an LEP clause scopes itself
 * on — the zone from the lot polygon, the epi/lmr/cdc layers the lot falls in, whether it is strata,
 * its area and frontage. It just never joins them to the rule layer. This does that join, and says
 * for each rule whether it reaches this lot.
 *
 * THE VERDICT IS FOUR-WAY, NOT TWO. A rule that cannot be decided is its own answer and the most
 * important one on the page: it means the graph holds the clause but cannot place it. Collapsing
 * "does not apply" and "cannot tell" would let an unresolved map reference read as a clean pass,
 * which is wrong in the direction that costs someone money. Same reasoning as the `untested` column
 * on the CDC section.
 *
 *   applies         every dimension tested, all matched
 *   excluded        a dimension matched but its polarity is `excludes`
 *   not_applicable  a dimension was tested and did not match
 *   untestable      a dimension could not be tested at all — and `missing` says which
 *
 * BANDS ARE RESOLVED AGAINST THE LOT. cl 4.3 states four heights, selected by site area. Listing
 * all four is the raw data; picking the one this lot falls in is the answer. condition_lo/hi carry
 * the band, so the effect returns `inBand` and the page can show "39 m, band >2,100–3,200 m²" next
 * to the lot's own 2,400 m².
 *
 * WHY THE EVALUATION IS SERVER-SIDE. /report needs the same decision. Two implementations of "does
 * this clause reach this lot" drift the moment either is touched, the same reason the extractor and
 * the recall gate share one number detector.
 *
 *   GET /api/testing/lep-rules?cadid=...[&use=dual occupancies]
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

type Verdict = 'applies' | 'excluded' | 'not_applicable' | 'untestable'

/**
 * Acts that subsume every other act, so proposing something specific never fails them.
 *
 * Measured against nsw.rule_applicability: of 49 distinct act values across the three LEPs, these
 * are the ones that name development in general rather than a particular operation. Getting this
 * list wrong in the other direction - treating "development" as disjoint from "erection of a
 * building" - would drop clauses that do bind, which is the failure that costs someone money.
 */
const UMBRELLA_ACTS = new Set([
  'development', 'any development', 'carried out', 'carrying out', 'carrying out development',
  'carrying out of development', 'carrying out of any development', 'carrying out of works',
  'grant development consent', 'development consent', 'granting of development consent',
])

export interface LepRuleEffect {
  topic: string | null
  comparator: string | null
  value: number | null
  unit: string | null
  valueSource: string | null
  mapLayer: string | null
  conditionMetric: string | null
  conditionLo: number | null
  conditionHi: number | null
  /** null when the effect carries no band, else whether THIS lot falls in it. */
  inBand: boolean | null
  sourceSpan: string | null
}

export interface LepRuleRow {
  clause: string
  /** nsw.section.local_id - what /doc-viewer?anchor= scrolls to. */
  anchor: string | null
  heading: string | null
  ruleKey: string
  src: string | null
  kind: string | null
  documentSlug: string
  verdict: Verdict
  /** Dimensions that matched, why they matched, and the words they were read from. */
  matched: Array<{ dimension: string; value: string; span: string | null; how: string }>
  failed: Array<{ dimension: string; value: string; lotHas: string | null }>
  missing: Array<{ dimension: string; value: string; why: string }>
  /** Proposal-side requirements still open: the rule reaches this lot IF these hold. */
  conditionalOn: Array<{ dimension: string; value: string; span: string | null }>
  /** Polygons covering this lot whose own legis_ref_clause names this clause. */
  mapEvidence: Array<{ map: string; label: string | null; value: number | null
                       topic: string | null; unit: string | null; coverPct: number | null }>
  effects: LepRuleEffect[]
}

export interface LepRulesResponse {
  lot: {
    cadid: string | null
    lotId: string | null
    lga: string | null
    zone: string | null
    areaM2: number | null
    frontageM: number | null
    isStrata: boolean | null
  } | null
  document: { slug: string; title: string } | null
  /** The proposed use the caller asked about, if any. Rules scoped to other uses go untestable. */
  use: string | null
  counts: Record<Verdict, number> & { total: number }
  /** Why rules could not be decided, most common first — the page's honest footer. */
  blockers: Array<{ dimension: string; why: string; rules: number }>
  /** What the spatial references contributed: tested, resolved, and how many reach this lot. */
  spatial: { refs: number; resolved: number; covering: number }
  rules: LepRuleRow[]
  ms: number
}

/** Zone code -> the development types it implies. Mirrors shared/dcp-scope.ts ZONE_DEV_TYPES. */
const ZONE_DEV_TYPES: Record<string, string[]> = {
  R1: ['residential'], R2: ['residential'], R3: ['residential'], R4: ['residential'],
  R5: ['residential'], MU1: ['residential', 'business'],
  E1: ['business'], E2: ['business'], E3: ['business', 'industrial'],
  E4: ['industrial'], E5: ['industrial'],
  RU1: ['rural'], RU2: ['rural'], RU3: ['rural'], RU4: ['rural'], RU5: ['rural'], RU6: ['rural'],
  C1: ['rural'], C2: ['rural'], C3: ['rural'], C4: ['rural'],
  RE1: ['community'], RE2: ['community'],
  SP1: ['community'], SP2: ['community'], SP3: ['community'],
  W1: ['river_settlement'], W2: ['river_settlement'], W3: ['river_settlement'],
  W4: ['river_settlement'],
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

export default defineEventHandler(async (event): Promise<LepRulesResponse> => {
  const q = getQuery(event)
  const cadid = q.cadid == null ? null : String(q.cadid).trim()
  const use = q.use == null ? null : String(q.use).trim() || null
  const act = q.act == null ? null : String(q.act).trim() || null
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  setHeader(event, 'cache-control', 'public, max-age=60')
  const started = Date.now()

  // ---- the lot, and the facts a clause can be tested against -------------------------------
  // cadastre.lot.lganame is NULL for all 3,355,661 rows, so the council cannot come from here. It
  // comes from the zoning layer below, which also names the instrument outright.
  const lot = (await nswQuery<any>(
    `SELECT l.cadid, l.lotidstring AS lot_id,
            round(st_area(st_transform(l.geom, 3308))::numeric, 1)::float8 AS area_m2,
            (l.lotidstring ILIKE '%//SP%') AS is_strata
       FROM cadastre.lot l WHERE l.cadid = $1 LIMIT 1`,
    [cadid],
  )).rows[0] ?? null
  if (!lot) throw createError({ statusCode: 404, statusMessage: 'No lot for that cadid' })

  // Zone from the polygon, not from a property record — the same basis the permissibility section
  // states, so the two sections cannot disagree about which zone this lot is in. epi_name carries
  // the instrument's own title ("Parramatta Local Environmental Plan 2023"), which matches
  // nsw.document.title exactly and is a better key than the LGA name: the cadastre says nothing,
  // epi says "CITY OF PARRAMATTA" and nsw.document says "Parramatta".
  const zoneRow = (await nswQuery<any>(
    `SELECT z.sym_code, z.epi_name, z.lga_name,
            100 * st_area(st_intersection(z.geom, l.geom)) / nullif(st_area(l.geom), 0) AS cover
       FROM cadastre.lot l
       JOIN epi.epi_land_zoning z
         ON z.geom && st_buffer(l.geom, -0.000001)
        AND st_intersects(z.geom, st_buffer(l.geom, -0.000001))
      WHERE l.cadid = $1
      ORDER BY cover DESC NULLS LAST LIMIT 1`,
    [cadid],
  )).rows[0] ?? null
  const zone: string | null = zoneRow?.sym_code ?? null
  lot.lga = zoneRow?.lga_name ?? null

  const frontage = (await nswQuery<any>(
    `SELECT primary_frontage_length_m::float8 AS f FROM derived.lot_frontage WHERE cadid = $1`,
    [cadid],
  ).catch(() => ({ rows: [] as any[] }))).rows[0]?.f ?? null

  const doc = (await nswQuery<any>(
    `SELECT id, instrument_slug, title FROM nsw.document
      WHERE doc_type = 'lep'
        AND (lower(title) = lower($1)
          -- the zoning layer names the instrument; the LGA is the fallback for a lot whose
          -- zoning row is missing or whose plan has been retitled since the export
          OR ($1::text IS NULL AND lower(lga_name) = lower($2)))
      LIMIT 1`,
    [zoneRow?.epi_name ?? null, lot.lga],
  )).rows[0] ?? null

  if (!doc) {
    return {
      lot: { cadid: lot.cadid, lotId: lot.lot_id, lga: lot.lga, zone, areaM2: lot.area_m2,
             frontageM: frontage, isStrata: lot.is_strata },
      document: null, use, act, actOptions: [],
      counts: { applies: 0, excluded: 0, not_applicable: 0, untestable: 0, total: 0 },
      blockers: [{ dimension: 'document', why: `no LEP ingested for ${lot.lga}`, rules: 0 }],
      rules: [], ms: Date.now() - started,
    }
  }

  // ---- what can answer a scoping term, and does it hold for THIS lot? ---------------------
  // Read from nsw.scope_layer rather than a literal in this file. The mapping is per term and
  // serves all 146 LEPs; a term with source_kind 'none' carries the reason, so "cannot be decided"
  // is a recorded fact with a cause rather than an absence nobody looked into.
  const mappings = (await nswQuery<any>(
    `SELECT sl.dimension, lower(sl.term) AS term, sl.title, sl.source_kind, sl.source, sl.filter,
            sl.test, sl.note, sl.features,
            -- a registry mapping borrows the registry's own resolved source and filter
            coalesce(reg.source, sl.source) AS eff_source,
            coalesce(reg.filter, sl.filter) AS eff_filter
       FROM nsw.scope_layer sl
       LEFT JOIN LATERAL (
         SELECT l.source, l.filter FROM lmr.layers l
          WHERE sl.source_kind = 'registry' AND sl.source = 'lmr.layers:' || l.key
       ) reg ON true`,
    [],
  )).rows
  const mapByTerm = new Map<string, any>()
  for (const m of mappings) mapByTerm.set(`${m.dimension}|${m.term}`, m)

  /** term key -> true | false | null (could not be tested) */
  const termHolds = new Map<string, boolean | null>()

  // Only test the terms this document's rules actually name. Sweeping all 30 mappings for every
  // lot would cost more than the rest of the endpoint put together.
  const neededRows = (await nswQuery<any>(
    `SELECT DISTINCT a.dimension, lower(a.value) AS term
       FROM nsw.rule_applicability a JOIN nsw.rule r ON r.id = a.rule_id
      WHERE r.document_id = $1
        AND a.dimension IN ('land_characteristic','tenure','adjacency')`,
    [doc.id],
  )).rows

  const spatialTerms: any[] = []
  for (const n of neededRows) {
    const m = mapByTerm.get(`${n.dimension}|${n.term}`)
    if (!m || m.source_kind === 'none') { termHolds.set(`${n.dimension}|${n.term}`, null); continue }
    if (m.test === 'intersects' && m.eff_source && /^[a-z_]+\.[a-z_0-9]+$/i.test(m.eff_source)) {
      spatialTerms.push({ ...n, ...m })
    } else {
      termHolds.set(`${n.dimension}|${n.term}`, null)   // derived, handled below
    }
  }

  // One round trip for every spatial term. `&&` before ST_Intersects so the GiST index is the
  // probe; the lot is shrunk 10 cm for the same reason /api/epi/at does it - cadastre and planning
  // layers share boundaries, so a raw parcel catches every neighbour that merely touches its edge.
  if (spatialTerms.length) {
    const parts = spatialTerms.map((t, i) => `SELECT $${i + 2}::text AS k, EXISTS(
        SELECT 1 FROM ${t.eff_source} x, cadastre.lot l
         WHERE l.cadid = $1 AND x.geom && ST_Buffer(l.geom, -0.000001)
           AND ST_Intersects(x.geom, ST_Buffer(l.geom, -0.000001))
           ${t.eff_filter ? `AND (${t.eff_filter})` : ''}) AS hit`)
    try {
      const r = await nswQuery<any>(parts.join(' UNION ALL '),
        [cadid, ...spatialTerms.map(t => `${t.dimension}|${t.term}`)])
      for (const row of r.rows) termHolds.set(String(row.k), Boolean(row.hit))
    } catch {
      // One bad mapping must not take the whole answer down; they stay null and read as undecided.
    }
  }

  // ---- the derived tests: computed from the lot, not looked up on a map --------------------
  // Nobody publishes a "corner lot" layer. This build measures every frontage run, so two street
  // frontages is a count of distinct road names - and it is what Parramatta cl 6.11 turns on.
  const frontageRoads = (await nswQuery<any>(
    `SELECT count(DISTINCT road_name)::int n FROM derived.lot_frontage_run
      WHERE cadid = $1 AND road_name IS NOT NULL`, [cadid],
  ).catch(() => ({ rows: [{ n: null }] }))).rows[0]?.n ?? null

  const setDerived = (dim: string, term: string, v: boolean | null) => {
    if (neededRows.some(n => n.dimension === dim && n.term === term)) {
      termHolds.set(`${dim}|${term}`, v)
    }
  }
  setDerived('land_characteristic', '2 street frontages',
    frontageRoads == null ? null : frontageRoads >= 2)
  setDerived('tenure', 'strata', lot.is_strata)
  setDerived('tenure', 'common_property', lot.is_strata)

  // ---- what the MAPS say, and which clause each one answers to --------------------------
  // The decisive signal, and the one this pipeline spent its whole life trying to recover from
  // prose: 170,515 of 209,299 epi polygons (81%) carry legis_ref_clause - the clause the polygon
  // exists to serve. cl 6.11's text says "land identified as 'D' on the Dual Occupancy Prohibition
  // Map"; the Dual Occupancy Prohibition Map says, in a column, legis_ref_clause = 'Clause 6.11'
  // and label = 'D'. The extractor missed the sentence; the dataset states the fact outright.
  //
  // So map scope is read from the DATA, and the text extraction becomes the cross-check rather than
  // the only source. Several of these layers also carry the control's VALUE (max_b_h, fsr,
  // lot_size), which answers every "shown on the Map" clause that has no number to extract at all.
  const mapEvidence = (await nswQuery<any>(
    `WITH lot AS (SELECT geom, ST_Buffer(geom, -0.000001) AS g FROM cadastre.lot WHERE cadid = $1)
     SELECT * FROM (
       SELECT 'Height of Buildings' AS map_name, x.label, x.legis_ref_clause AS ref,
              x.max_b_h::float8 AS value, 'height' AS topic, 'metre' AS unit,
              100 * ST_Area(ST_Intersection(x.geom, lot.geom)) / nullif(ST_Area(lot.geom),0) AS cover
         FROM epi.epi_height_of_building x, lot
        WHERE x.geom && lot.g AND ST_Intersects(x.geom, lot.g)
       UNION ALL
       SELECT 'Floor Space Ratio', x.label, x.legis_ref_clause, x.fsr::float8, 'fsr', 'ratio',
              100 * ST_Area(ST_Intersection(x.geom, lot.geom)) / nullif(ST_Area(lot.geom),0)
         FROM epi.epi_floor_space_ratio x, lot
        WHERE x.geom && lot.g AND ST_Intersects(x.geom, lot.g)
       UNION ALL
       SELECT 'Lot Size', x.label, x.legis_ref_clause, x.lot_size::float8, 'lot_size', 'sqm',
              100 * ST_Area(ST_Intersection(x.geom, lot.geom)) / nullif(ST_Area(lot.geom),0)
         FROM epi.epi_lot_size x, lot
        WHERE x.geom && lot.g AND ST_Intersects(x.geom, lot.g)
       UNION ALL
       SELECT x.map_name, x.label, x.legis_ref_clause, NULL, NULL, NULL,
              100 * ST_Area(ST_Intersection(x.geom, lot.geom)) / nullif(ST_Area(lot.geom),0)
         FROM epi.epi_local_provisions x, lot
        WHERE x.geom && lot.g AND ST_Intersects(x.geom, lot.g)
       UNION ALL
       SELECT 'Key Sites', x.label, x.legis_ref_clause, NULL, NULL, NULL,
              100 * ST_Area(ST_Intersection(x.geom, lot.geom)) / nullif(ST_Area(lot.geom),0)
         FROM epi.epi_key_sites x, lot
        WHERE x.geom && lot.g AND ST_Intersects(x.geom, lot.g)
       UNION ALL
       SELECT 'Heritage', x.label, x.legis_ref_clause, NULL, NULL, NULL,
              100 * ST_Area(ST_Intersection(x.geom, lot.geom)) / nullif(ST_Area(lot.geom),0)
         FROM epi.epi_heritage x, lot
        WHERE x.geom && lot.g AND ST_Intersects(x.geom, lot.g)
     ) t WHERE ref IS NOT NULL ORDER BY cover DESC NULLS LAST`,
    [cadid],
  )).rows

  // "Clause 6.11" -> "6.11"; a polygon may name several ("Clauses 4.3 and 7.2").
  const byClause = new Map<string, any[]>()
  for (const m of mapEvidence) {
    for (const cl of String(m.ref).match(/\d+[A-Z]?(?:\.\d+[A-Z]*)*/g) ?? []) {
      if (!byClause.has(cl)) byClause.set(cl, [])
      byClause.get(cl)!.push(m)
    }
  }

  // ---- the rules, with every applicability row and effect ---------------------------------
  const ruleRows = (await nswQuery<any>(
    `SELECT r.id, r.clause, r.rule_key, r.src, r.kind,
            -- The id /doc-viewer scrolls to. Taken from the section rather than rebuilt from
            -- r.clause, because the two disagree exactly where it matters: clause "5.4(3)" is
            -- anchored "sec.5.4-ssec.3" and "Sch 1 item 7" is "sch.1-sec.7". A "sec." + clause
            -- guess lands on neither, which is why every link on the page opened at the top.
            coalesce(s.local_id, anc.local_id) AS anchor,
            -- A rule is keyed on a subclause and a subclause has no heading; walk up to the
            -- clause that does. Without this every row on the page is a blank title.
            coalesce(s.heading, anc.heading) AS heading
       FROM nsw.rule r
       LEFT JOIN nsw.section s ON s.id = r.section_id
       LEFT JOIN nsw.section anc ON anc.id = s.parent_id
      WHERE r.document_id = $1
      -- Plain text order only. This used to cast the digits of r.clause to int[], which
      -- overflowed on two Randwick rules whose clause column holds extracted prose
      -- ("4.4A(2) - 275m2 and 300m2 0 65 1 300m2 0 6 1" -> 4.422752300206513002061) and 500ed
      -- the whole council. It was redundant anyway: out.sort() below re-orders every row with a
      -- numeric-aware localeCompare, so this only has to be deterministic.
      ORDER BY r.clause`,
    [doc.id],
  )).rows

  const appRows = (await nswQuery<any>(
    `SELECT a.rule_id, a.dimension, a.value, a.polarity, a.source_span, a.map_layer
       FROM nsw.rule_applicability a JOIN nsw.rule r ON r.id = a.rule_id
      WHERE r.document_id = $1`,
    [doc.id],
  )).rows

  const effRows = (await nswQuery<any>(
    `SELECT e.rule_id, e.topic, e.comparator, e.value::float8 AS value, e.unit, e.value_source,
            e.map_layer, e.condition_metric, e.condition_lo::float8 AS condition_lo,
            e.condition_hi::float8 AS condition_hi, e.source_span
       FROM nsw.rule_effect e JOIN nsw.rule r ON r.id = e.rule_id
      WHERE r.document_id = $1`,
    [doc.id],
  )).rows

  // Which spatial refs cover this lot. A ref with no geometry is not a miss — it is undecidable,
  // and it has to stay distinguishable from one tested and found not to cover.
  const spatial = (await nswQuery<any>(
    `SELECT sr.rule_id, sr.value, sr.map_layer, sr.geom IS NOT NULL AS resolved,
            CASE WHEN sr.geom IS NULL THEN NULL
                 ELSE st_intersects(sr.geom, st_transform(l.geom, 4326)) END AS covers
       FROM nsw.rule_spatial_ref sr, cadastre.lot l
      WHERE sr.document_id = $1 AND l.cadid = $2`,
    [doc.id, cadid],
  )).rows
  const spatialByRule = new Map<string, any[]>()
  for (const s of spatial) {
    if (!spatialByRule.has(s.rule_id)) spatialByRule.set(s.rule_id, [])
    spatialByRule.get(s.rule_id)!.push(s)
  }

  const appByRule = new Map<string, any[]>()
  for (const a of appRows) {
    if (!appByRule.has(a.rule_id)) appByRule.set(a.rule_id, [])
    appByRule.get(a.rule_id)!.push(a)
  }
  const effByRule = new Map<string, any[]>()
  for (const e of effRows) {
    if (!effByRule.has(e.rule_id)) effByRule.set(e.rule_id, [])
    effByRule.get(e.rule_id)!.push(e)
  }

  const devTypes = new Set(zone ? ZONE_DEV_TYPES[zone.toUpperCase()] ?? [] : [])
  const out: LepRuleRow[] = []
  const counts = { applies: 0, excluded: 0, not_applicable: 0, untestable: 0, total: 0 }
  const blockers = new Map<string, { dimension: string; why: string; rules: number }>()

  for (const r of ruleRows) {
    const apps = appByRule.get(r.id) ?? []
    // Evidence from the data rather than the text. Positive proof that this clause reaches this
    // lot, and it stands whether or not the extractor found the map reference in the prose.
    // "6.11(1)" -> "6.11": a map names the clause, not the subclause.
    const baseClause = String(r.clause).trim().replace(/\(.*$/, '')
    const ev = (byClause.get(baseClause) ?? []).filter(m => (m.cover ?? 0) > 0)
    const mapEv: LepRuleRow['mapEvidence'] = ev.map(m => ({
      map: String(m.map_name), label: m.label, value: m.value, topic: m.topic, unit: m.unit,
      coverPct: m.cover == null ? null : Math.round(Number(m.cover) * 10) / 10,
    }))
    const matched: LepRuleRow['matched'] = []
    const failed: LepRuleRow['failed'] = []
    const missing: LepRuleRow['missing'] = []
    const conditionalOn: LepRuleRow['conditionalOn'] = []
    let excluded = false

    for (const a of apps) {
      const dim = a.dimension as string
      const val = String(a.value ?? '')
      const v = norm(val)
      const excl = a.polarity === 'excludes'
      const hit = (how: string) => {
        matched.push({ dimension: dim, value: val, span: a.source_span, how })
        if (excl) excluded = true
      }

      if (dim === 'zone') {
        if (!zone) missing.push({ dimension: dim, value: val, why: 'no zoning layer covers this lot' })
        else if (norm(zone) === v) hit(`lot is ${zone}`)
        else failed.push({ dimension: dim, value: val, lotHas: zone })
      } else if (dim === 'dev_type') {
        if (!zone) missing.push({ dimension: dim, value: val, why: 'no zone, so no development type' })
        else if (devTypes.has(v)) hit(`${zone} implies ${val}`)
        else failed.push({ dimension: dim, value: val, lotHas: [...devTypes].join(', ') || null })
      } else if (dim === 'land_use') {
        // Proposal-side, not land-side. With no proposal stated the rule is not undecidable — it is
        // decided FOR THIS LOT and waiting on what you want to build. "Applies if you propose a dual
        // occupancy" is a useful answer; "cannot tell" is not, and it would bury 78 of 112 rules.
        if (!use) conditionalOn.push({ dimension: dim, value: val, span: a.source_span })
        else if (norm(use) === v || v.startsWith(norm(use)) || norm(use).startsWith(v))
          hit(`proposal is ${use}`)
        else failed.push({ dimension: dim, value: val, lotHas: use })
      } else if (dim === 'act') {
        // Proposal-side, exactly like land_use: what you are doing, not what the land is.
        //
        // The vocabulary is not disjoint, and treating it as if it were would be wrong in the
        // expensive direction. "development", "carried out" and their paraphrases are UMBRELLA
        // acts - erecting a building IS development - so a clause scoped to "development" is not
        // made inapplicable by proposing a building. Only genuinely disjoint acts can fail each
        // other: subdivision vs erection vs demolition vs change of use.
        if (!act) conditionalOn.push({ dimension: dim, value: val, span: a.source_span })
        else if (UMBRELLA_ACTS.has(v)) hit(`${val} covers what you propose`)
        else if (norm(act) === v || v.startsWith(norm(act)) || norm(act).startsWith(v))
          hit(`proposal is ${val}`)
        else failed.push({ dimension: dim, value: val, lotHas: act })
      } else if (dim === 'tenure' || dim === 'land_characteristic' || dim === 'adjacency') {
        // All three now answer the same way: look up what the term MEANS in nsw.scope_layer, then
        // read whether it held for this lot. The mapping carries its own reason when nothing can
        // answer, so an undecidable term explains itself instead of being a blank.
        const m = mapByTerm.get(`${dim}|${v}`)
        const held = termHolds.get(`${dim}|${v}`)
        if (!m) {
          missing.push({ dimension: dim, value: val, why: `"${val}" is not a mapped term` })
        } else if (m.source_kind === 'none') {
          missing.push({ dimension: dim, value: val,
                         why: m.note ? String(m.note).split('. ')[0] : `no layer answers "${val}"` })
        } else if (held === true) {
          hit(m.title ? `${m.title} covers this lot` : `${val} holds for this lot`)
        } else if (held === false) {
          failed.push({ dimension: dim, value: val, lotHas: `${m.title ?? val}: no` })
        } else {
          missing.push({ dimension: dim, value: val, why: `${m.title ?? val} could not be tested` })
        }
      } else if (dim === 'area_label' || dim === 'site_ref') {
        // A label is exclusive on its own map: a parcel carries one. So if the map that covers
        // this lot is the map this row names, and it marks a DIFFERENT label, the row fails -
        // no spatial ref needed. cl 4.3(2A) wants "Area 1" on the Height of Buildings Map and
        // that map marks this lot "J1", which settles it.
        const sameMap = a.map_layer
          ? mapEv.filter(m => norm(m.map).replace(/ map$/, '')
                            === norm(a.map_layer).replace(/ map$/, ''))
          : []
        if (sameMap.length && !sameMap.some(m => norm(m.label) === v)) {
          failed.push({ dimension: dim, value: val,
                        lotHas: `${sameMap[0]!.map} Map marks this lot "${sameMap[0]!.label}"` })
          continue
        }
        const refs = (spatialByRule.get(r.id) ?? []).filter(s => norm(s.value) === v)
        if (!refs.length) missing.push({ dimension: dim, value: val, why: 'no spatial ref for this label' })
        else if (refs.every(s => !s.resolved))
          missing.push({ dimension: dim, value: val,
                         why: `"${val}" on the ${a.map_layer ?? '?'} Map is not resolved to geometry` })
        else if (refs.some(s => s.covers)) hit(`lot falls inside ${val}`)
        else failed.push({ dimension: dim, value: val, lotHas: 'outside that area' })
      } else {
        missing.push({ dimension: dim, value: val, why: `${dim} is not evaluated` })
      }
    }

    let verdict: Verdict
    // WITHIN a dimension the rows are ALTERNATIVES; ACROSS dimensions they are conditions that must
    // all hold. "Zones R2, R3 and R4" is three rows and an R2 lot satisfies it — requiring all three
    // made cl 4.1C not_applicable on the very lots it governs. cl 6.11 is the same shape: it
    // prohibits dual occupancies on land that is heritage OR has two street frontages.
    //
    // So each dimension resolves to matched / untestable / failed, and only then are the dimensions
    // combined. A dimension is untestable rather than failed when nothing matched but something in
    // it could not be tested, because "one alternative ruled out and the other unknown" is not a
    // ruling-out.
    const dims = new Set<string>([
      ...matched.map(m => m.dimension), ...failed.map(f => f.dimension), ...missing.map(m => m.dimension),
    ])
    let anyFailedDim = false
    let anyMissingDim = false
    for (const d of dims) {
      if (matched.some(m => m.dimension === d)) continue      // an alternative matched: satisfied
      if (missing.some(m => m.dimension === d)) anyMissingDim = true
      else anyFailedDim = true
    }

    // A polygon that names this clause and covers this lot IS the land-side test, passed. It
    // settles an area_label the extractor missed and overrides one it got wrong: the dataset is
    // the authority on where its own polygons are.
    if (mapEv.length) {
      for (const m of mapEv) {
        matched.push({
          dimension: 'area_label',
          value: m.label == null ? m.map : String(m.label),
          span: null,
          how: `the ${m.map} Map marks this lot${m.label ? ` "${m.label}"` : ''} for cl ${r.clause}`,
        })
      }
      // Supersede an UNRESOLVED reference freely - the map has answered what the text could not.
      for (let i = missing.length - 1; i >= 0; i--) {
        if (missing[i]!.dimension === 'area_label' || missing[i]!.dimension === 'site_ref') {
          missing.splice(i, 1)
        }
      }
      // A FAILED one only where the label agrees. cl 4.3(2A) is scoped to "Area 1"; the map marks
      // this lot "J1". Clearing that failure would put the City Centre band table back on a
      // Beecroft house, which is the exact error the subclause split exists to fix.
      const evLabels = new Set(mapEv.map(m => String(m.label ?? '').toLowerCase()).filter(Boolean))
      for (let i = failed.length - 1; i >= 0; i--) {
        const f = failed[i]!
        if ((f.dimension === 'area_label' || f.dimension === 'site_ref')
            && evLabels.has(String(f.value).toLowerCase())) {
          failed.splice(i, 1)
        }
      }
    }

    // The verdict is about the LAND. Proposal-side gaps do not make a rule undecidable, they make
    // it conditional, and `conditionalOn` carries them so the page can say what it waits on.
    if (!apps.length && !mapEv.length) verdict = 'untestable'
    else if (anyFailedDim) verdict = 'not_applicable'
    else if (anyMissingDim) verdict = 'untestable'
    else if (excluded) verdict = 'excluded'
    else verdict = 'applies'

    // Only report the alternatives that actually decided it. Listing "FAILED zone=R3" beside
    // "matched zone=R2" is noise: R3 was never required.
    const satisfiedDims = new Set(matched.map(m => m.dimension))
    const failedShown = failed.filter(f => !satisfiedDims.has(f.dimension))
    const missingShown = missing.filter(m => !satisfiedDims.has(m.dimension))

    if (!apps.length) {
      const k = 'none'
      blockers.set(k, { dimension: 'none', why: 'rule carries no applicability at all',
                        rules: (blockers.get(k)?.rules ?? 0) + 1 })
    }
    if (verdict === 'untestable') {
      for (const m of missingShown) {
        const k = `${m.dimension}|${m.why}`
        blockers.set(k, { dimension: m.dimension, why: m.why, rules: (blockers.get(k)?.rules ?? 0) + 1 })
      }
    }

    // cl 9.3 states "at least 10 m" in three subclauses and the rule carries all three. Identical
    // rows are the same fact repeated, and a control listed three times reads as three controls.
    const seenEff = new Set<string>()
    const effects: LepRuleEffect[] = (effByRule.get(r.id) ?? []).filter(e => {
      const k = [e.topic, e.comparator, e.value, e.unit, e.condition_lo, e.condition_hi].join('|')
      if (seenEff.has(k)) return false
      seenEff.add(k)
      return true
    }).map(e => {
      let inBand: boolean | null = null
      if (e.condition_lo != null || e.condition_hi != null) {
        const metric = e.condition_metric === 'frontage_width' ? frontage : lot.area_m2
        inBand = metric == null ? null
          : metric > (e.condition_lo ?? -Infinity) && metric <= (e.condition_hi ?? Infinity)
      }
      return {
        topic: e.topic, comparator: e.comparator, value: e.value, unit: e.unit,
        valueSource: e.value_source, mapLayer: e.map_layer,
        conditionMetric: e.condition_metric, conditionLo: e.condition_lo,
        conditionHi: e.condition_hi, inBand, sourceSpan: e.source_span,
      }
    })

    counts[verdict]++
    counts.total++
    out.push({
      clause: r.clause, heading: r.heading, ruleKey: r.rule_key, src: r.src, kind: r.kind,
      anchor: r.anchor == null ? null : String(r.anchor),
      documentSlug: doc.instrument_slug, verdict, matched,
      failed: failedShown, missing: missingShown, effects,
      mapEvidence: mapEv,
      conditionalOn: conditionalOn.filter(
        (c, i, arr) => arr.findIndex(o => o.dimension === c.dimension && o.value === c.value) === i),
    })
  }

  const ORDER: Record<Verdict, number> = { applies: 0, excluded: 1, untestable: 2, not_applicable: 3 }
  out.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]
    || (b.effects.length - a.effects.length)
    || String(a.clause).localeCompare(String(b.clause), undefined, { numeric: true }))

  return {
    lot: { cadid: lot.cadid, lotId: lot.lot_id, lga: lot.lga, zone, areaM2: lot.area_m2,
           frontageM: frontage, isStrata: lot.is_strata },
    document: { slug: doc.instrument_slug, title: doc.title },
    spatial: {
      refs: spatial.length,
      resolved: spatial.filter(x => x.resolved).length,
      covering: spatial.filter(x => x.covers).length,
    },
    use, act, counts,
    /** Every act this document scopes a rule by, so the picker offers only real options. */
    actOptions: [...new Set(appRows.filter(a => a.dimension === 'act')
      .map(a => String(a.value)))].filter(v => !UMBRELLA_ACTS.has(norm(v))).sort(),
    blockers: [...blockers.values()].sort((a, b) => b.rules - a.rules),
    rules: out,
    ms: Date.now() - started,
  }
})
