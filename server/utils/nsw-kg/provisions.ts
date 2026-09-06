/**
 * Provisions that apply to one lot because of where it is.
 *
 * This is the bridge between the two halves of the data, neither of which can
 * answer the question alone:
 *
 *   nsw.up_property_d_3  what layers touch this lot -- 307 mapped attributes,
 *                        precise per parcel, with no notion of a provision. It
 *                        has no column for additional permitted uses at all.
 *   the knowledge graph  what the instrument requires -- clauses, thresholds and
 *                        the land each applies to, with no notion of this lot
 *                        except through nsw.rule_spatial_ref.
 *
 * Schedule 1 "Additional permitted uses" falls squarely in that gap: it is a
 * provision attached to specific land, so the property table cannot see it and
 * the graph cannot place it. The join is spatial -- the lot's centroid inside
 * the clause's resolved polygon.
 *
 * Part 4 works the other way round. cl 4.1, 4.3 and 4.4 do not state numbers;
 * they defer to the Lot Size, Height of Buildings and Floor Space Ratio Maps,
 * and those numbers are exactly what the property table holds. So the clause
 * comes from the graph and the value comes from the record, and a report that
 * shows the value without the clause is unciteable while one that shows the
 * clause without the value says nothing.
 */

import type pg from 'pg'
import { clauseAppliesToLot } from '../../../shared/lep-scope'

export interface AdditionalUse {
  clause: string
  uses: string[]
  ref_type: string
  ref_value: string
}

export interface AreaProvision {
  clause: string
  heading: string | null
  kind: string | null
  area: string
  map_layer: string | null
  ref_type: string
  /** The subclauses that actually say what happens on this land. */
  effect: Array<{ local_id: string; number: string | null; text: string }>
  /**
   * The figure this clause sets for this particular area, where it states one
   * in a table. cl 4.4(2A) tabulates a ratio per area; only the row for the
   * lot's own area is of any use to the reader.
   */
  values: Array<{ area: string; value: string }>
}

export interface MappedStandard {
  clause: string
  heading: string | null
  map_name: string
  /** The value the property record carries for this standard, if any. */
  value: string | null
  /** True when no value is mapped, which is a finding rather than a gap. */
  unmapped: boolean
}

export interface LotProvisions {
  additionalUses: AdditionalUse[]
  areaProvisions: AreaProvision[]
  mappedStandards: MappedStandard[]
}

/**
 * A lot centroid inside a clause's polygon.
 *
 * Centroid rather than parcel overlap because up_property_d_3 stores its
 * geometry columns as WKT text rather than PostGIS types, so centroid_lat and
 * centroid_lon are the only spatial values that can be queried directly. A lot
 * straddling the edge of an area is therefore decided by its centre, which is
 * the same convention the mapped attributes already use.
 */
const CONTAINS = `
  ST_Contains(sr.geom, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326))`

export async function getLotProvisions(
  client: pg.PoolClient,
  // Named as PROPERTY_SELECT aliases them, not as up_property_d_3 spells them.
  // The projection renames lot_size to min_lot_size, and reading lot.lot_size
  // here yielded undefined on every lot, so the Lot Size Map row always claimed
  // "none mapped" -- including for the lots that do carry a minimum. `unknown`
  // hid it: the property object is `any`, so nothing objected to a field that
  // was never there.
  lot: { centroid_lat: number | null; centroid_lon: number | null;
         min_lot_size: string | number | null; max_height_m: string | number | null;
         fsr_value: string | number | null;
         // Typed, not `unknown`: reading a field the projection does not have
         // is exactly how the Lot Size Map row came to say "none mapped" on
         // every lot, and nothing objected because the property object is any.
         zone?: string | null;
         lga_name?: string | null },
): Promise<LotProvisions> {
  const lat = Number(lot.centroid_lat)
  const lon = Number(lot.centroid_lon)
  const placed = Number.isFinite(lat) && Number.isFinite(lon)

  // ── Additional permitted uses ──────────────────────────────────────
  const additionalUses: AdditionalUse[] = placed ? (await client.query(
    `SELECT DISTINCT r.clause, sr.ref_type, sr.value AS ref_value,
            (SELECT array_agg(DISTINCT a.value ORDER BY a.value)
               FROM nsw.rule_applicability a
              WHERE a.rule_id = r.id AND a.dimension = 'land_use') AS uses
       FROM nsw.rule r
       JOIN nsw.rule_spatial_ref sr ON sr.rule_id = r.id AND sr.geom IS NOT NULL
      WHERE r.kind = 'additional_use' AND ${CONTAINS}
      ORDER BY r.clause`,
    [lat, lon],
  )).rows.map(r => ({ ...r, uses: r.uses ?? [] })) : []

  // ── Area-based provisions elsewhere in the instrument ──────────────
  //
  // The same spatial test, for clauses that are not additional uses: the FSR
  // areas under cl 4.4, and the site-specific provisions in Part 6. Excludes
  // refs with no geometry, which are the map pointers handled below.
  const areaProvisions: AreaProvision[] = placed ? (await client.query(
    `SELECT DISTINCT sr.clause, sr.value AS area, sr.map_layer, sr.ref_type,
            s.heading, r.kind
       FROM nsw.rule_spatial_ref sr
       LEFT JOIN nsw.rule r ON r.id = sr.rule_id
       LEFT JOIN nsw.section s ON s.id = sr.section_id
      WHERE sr.geom IS NOT NULL
        AND (r.kind IS NULL OR r.kind <> 'additional_use')
        AND ${CONTAINS}
      ORDER BY sr.clause`,
    [lat, lon],
  )).rows : []

  // ── Standards the instrument defers to a map ───────────────────────
  //
  // cl 4.1/4.1A/4.2 -> Lot Size Map, cl 4.3 -> Height of Buildings Map,
  // cl 4.4 -> Floor Space Ratio Map. The graph knows which clause points at
  // which map; the property record holds the number the map carries here.
  const MAP_TO_VALUE: Record<string, unknown> = {
    'Lot Size Map': lot.min_lot_size,
    'Height of Buildings Map': lot.max_height_m,
    'Floor Space Ratio Map': lot.fsr_value,
  }

  // Scoped by LGA for the same reason clauseEffectForArea is: these refs carry
  // no geometry, so nothing else confines them to this lot's council, and every
  // LEP has its own cl 4.3 pointing at its own Height of Buildings Map. It is
  // latent rather than visible today only because nsw.rule_spatial_ref holds
  // Hornsby's 26 rows and nobody else's -- the rule layer exists for one
  // council. Giving Randwick one would have put its clauses on Hornsby reports.
  const mappedStandards: MappedStandard[] = (await client.query(
    `SELECT DISTINCT sr.clause, sr.value AS map_name, s.heading,
            -- The clause's rules, each with the zones and uses it names. A
            -- spatial ref carries no applicability of its own, so the rules are
            -- the only record of where the clause bites -- and without them
            -- cl 4.2, Rural subdivision, was listed as a standard for a lot in
            -- Maroubra. Zones and uses both, because a zone attached to a
            -- use-qualified rule scopes that sub-provision and not the clause:
            -- see shared/lep-scope.ts.
            (SELECT jsonb_agg(jsonb_build_object('zones', z.zones, 'uses', z.uses))
               FROM (SELECT
                       coalesce((SELECT array_agg(a.value) FROM nsw.rule_applicability a
                                  WHERE a.rule_id = r2.id AND a.dimension = 'zone'), '{}') AS zones,
                       coalesce((SELECT array_agg(a.value) FROM nsw.rule_applicability a
                                  WHERE a.rule_id = r2.id AND a.dimension = 'land_use'), '{}') AS uses
                     FROM nsw.rule r2
                    WHERE r2.document_id = sr.document_id AND r2.clause = sr.clause) z) AS clause_rules
       FROM nsw.rule_spatial_ref sr
       JOIN nsw.document d ON d.id = sr.document_id
       LEFT JOIN nsw.section s ON s.id = sr.section_id
      WHERE sr.geom IS NULL AND sr.ref_type = 'map'
        AND ($1::text IS NULL OR lower(d.lga_name) = lower($1))
      ORDER BY sr.clause`,
    [lot.lga_name ?? null],
  )).rows
    .filter(r => clauseAppliesToLot(r.clause_rules ?? [], r.heading, lot.zone))
    .filter(r => r.map_name in MAP_TO_VALUE)
    // A clause that excepts from a standard does not set it.
    //
    // Randwick's cl 4.3A and 4.3B both cite the Height of Buildings Map, but
    // they are headed "Exceptions to height of buildings in Matraville" and
    // "...on land with dual frontages": they vary the mapped figure inside a
    // named area, they do not establish it. Listed under "Set by" they read as
    // three clauses each independently setting 13 m, which is not what the plan
    // says -- and the area provisions section already reports what they
    // actually do, with the subclause that does it.
    //
    // Read off the instrument's own heading rather than inferred from geometry:
    // Hornsby's cl 4.4 carries four FSR-area geometries and is still the clause
    // that sets the floor space ratio, so "has an area" would drop a real one.
    .filter(r => !/^exception/i.test(String(r.heading ?? '').trim()))
    .map((r) => {
      const v = MAP_TO_VALUE[r.map_name]
      const has = v !== null && v !== undefined && String(v).trim() !== ''
      return {
        clause: r.clause,
        heading: r.heading,
        map_name: r.map_name,
        value: has ? String(v) : null,
        unmapped: !has,
      }
    })

  // ── What the area provisions actually do ───────────────────────────
  //
  // Naming the area is only half a finding. cl 4.4(2A) caps residential
  // accommodation in Area 3 at 1:1 where the map shows 5, and cl 6.12 caps
  // seniors housing in its Area 3 at 20.5m where the map shows 35.5m -- so on
  // those lots the mapped figure is not the operative limit for those uses.
  // Saying "this lot is in Area 3" without that is a flag the reader cannot act
  // on.
  for (const prov of areaProvisions) {
    const { effect, values } = await clauseEffectForArea(
      client, prov.clause, prov.area, lot.lga_name ?? null)
    prov.effect = effect
    prov.values = values
  }

  return { additionalUses, areaProvisions, mappedStandards }
}

/**
 * The subclauses of `clause` that govern `area`, in this lot's own LEP.
 *
 * A clause can carry a separate rule per area -- cl 4.4 has (2A) for Areas 3
 * and 6, (2C) for Area 5 and (2D) for Area 8 -- so returning the whole clause
 * would show a reader the rules for land they are not on. This takes the
 * subclause that names the area and the ones following it, stopping at the next
 * subclause that names a different area. That keeps cl 6.12(1) with its
 * operative (2), and keeps cl 4.4(2A) away from (2C).
 *
 * Scoped by LGA as well as by level. Every LEP numbers its clauses the same way,
 * so `sec.4.4-ssec.1` exists in Hornsby's and Randwick's alike; without the LGA
 * filter the two interleave by sort_order and the walk below terminates on the
 * wrong council's text, which is how this first showed up -- as empty results
 * rather than as visibly foreign clauses.
 *
 * The level filter still does useful work: it excludes the pilot-imported
 * document, which produced no subclause or paragraph rows, so no document id has
 * to be named here and nothing changes at cutover.
 */
async function clauseEffectForArea(
  client: pg.PoolClient,
  clause: string,
  area: string,
  lgaName: string | null,
): Promise<{
  effect: Array<{ local_id: string; number: string | null; text: string }>
  values: Array<{ area: string; value: string }>
}> {
  const rows = (await client.query(
    `SELECT s.local_id, s.number, s.raw_text, s.sort_order
       FROM nsw.section s
       JOIN nsw.document d ON d.id = s.document_id
      WHERE d.doc_type = 'lep'
        -- Case-insensitive: the source registry records "Hornsby" while
        -- up_property_d_3 carries "HORNSBY", and an exact match silently
        -- returned nothing.
        AND ($2::text IS NULL OR lower(d.lga_name) = lower($2))
        AND s.level IN ('subclause', 'paragraph')
        AND s.local_id LIKE $1
        AND coalesce(s.raw_text, '') <> ''
      ORDER BY s.sort_order`,
    [`sec.${clause}-%`, lgaName],
  )).rows

  // Compared as bare tokens rather than by building a regex from `area`,
  // which would need escaping for no benefit: the values are always
  // "Area <n>".
  const AREA_TOKEN = /\bArea\s+(\w+)\b/gi
  const areasIn = (t: string) => [...t.matchAll(AREA_TOKEN)].map(m => m[1]!.toLowerCase())
  const target = (area.match(/\bArea\s+(\w+)\b/i)?.[1] ?? area).toLowerCase()

  const out: Array<{ local_id: string; number: string | null; text: string }> = []
  const values: Array<{ area: string; value: string }> = []
  let collecting = false
  for (const r of rows) {
    const raw = String(r.raw_text)
    const found = areasIn(raw)
    const mentionsThisArea = found.includes(target)
    const namesOnlyOthers = found.length > 0 && !mentionsThisArea
    if (mentionsThisArea) { collecting = true }
    else if (collecting && namesOnlyOthers) { break }
    if (!collecting) continue

    // A table in the source arrives as one flattened line, because the XML path
    // has no writer for nsw.section_table and extractBlock falls back to text.
    // Rendered as prose it reads "Column 1 Column 2 Area Floor space ratio Area
    // 3 1:1 Area 6 0.6:1", which is not something to put in front of a planner.
    // The row for this lot's area is pulled out as a value; the rest of the
    // table is dropped, since the ratios for other land are not this lot's.
    const prose: string[] = []
    for (const line of raw.split('\n')) {
      if (/^Column\s+\d/i.test(line.trim())) {
        for (const m of line.matchAll(/\bArea\s+(\w+)\s+(\d[\d.]*(?::[\d.]+)?%?)/gi)) {
          if (m[1]!.toLowerCase() === target) values.push({ area: `Area ${m[1]}`, value: m[2]! })
        }
        continue
      }
      if (line.trim()) prose.push(line.trim())
    }
    out.push({ local_id: r.local_id, number: r.number ?? null, text: prose.join(' ') })
  }
  return { effect: out, values }
}
