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
  lot: { centroid_lat: number | null; centroid_lon: number | null;
         lot_size: unknown; max_height_m: unknown; fsr_value: unknown },
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
    'Lot Size Map': lot.lot_size,
    'Height of Buildings Map': lot.max_height_m,
    'Floor Space Ratio Map': lot.fsr_value,
  }

  const mappedStandards: MappedStandard[] = (await client.query(
    `SELECT DISTINCT sr.clause, sr.value AS map_name, s.heading
       FROM nsw.rule_spatial_ref sr
       LEFT JOIN nsw.section s ON s.id = sr.section_id
      WHERE sr.geom IS NULL AND sr.ref_type = 'map'
      ORDER BY sr.clause`,
  )).rows
    .filter(r => r.map_name in MAP_TO_VALUE)
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

  return { additionalUses, areaProvisions, mappedStandards }
}
