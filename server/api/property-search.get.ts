/**
 * Find lots by what they ARE, not by where they are.
 *
 *   /api/property-search?zone=R2&lga=HORNSBY&areaMin=600&areaMax=900
 *   /api/property-search?use=dual%20occupancies&lmr=true&limit=50
 *   /api/property-search?facets=1        → the dropdown vocabularies
 *
 * Every other lookup on this page starts from an address or a lot id and asks
 * what is true of it. This one runs the other way: state the conditions and get
 * the lots that satisfy them. That is the query a planner actually has — "R2 in
 * Hornsby between 600 and 900 m² that permits dual occupancies" — and nothing
 * in the app could answer it.
 *
 * WHY THE FILTERS ARE A CLOSED LIST
 *
 * `FIELDS` names every column that may be filtered and how. A request cannot
 * name a column, an operator or a table: it picks a key from this map and the
 * SQL is assembled here with bound parameters. The same discipline
 * nsw-map-services.ts applies to URLs, for the same reason.
 *
 * PERFORMANCE, MEASURED
 *
 * d_4 is 5.48M rows / 2,741 MB of heap with 327 columns, and there is no index
 * on most of these fields. That sounds fatal and is not, because every search
 * here carries a LIMIT: a filtered scan that stops at 50 rows costs ~12 ms
 * (3,804 buffers). What is expensive is counting — a bare `GROUP BY zone` over
 * the whole table reads 350,791 buffers, ~2.7 GB, for 494 ms. So:
 *
 *   - rows come back capped and unsorted by default, which is cheap
 *   - the total is NOT computed unless asked for (`count=1`), and is capped
 *   - the facet vocabularies are built once and held in memory
 *
 * If this ever needs true facet counts per keystroke, the fix is a narrow
 * projection of the ~26 searchable columns: they average 249 bytes of a
 * 3,696-byte row, so such a table is ~185 MB against 2,741 MB — a 15x cut in
 * scan cost without any extension. See docs, and ask before adding one.
 */

import { nswQuery } from '../utils/nsw-kg/pool'
import { PROPERTY_TABLE, scrubSentinels } from '../../shared/property-columns'

type FieldKind = 'text' | 'ilike' | 'list' | 'number' | 'bool' | 'present'

interface Field {
  column: string
  kind: FieldKind
  label: string
  /** Offer the distinct values as a dropdown, with this ceiling. */
  facet?: number
}

/**
 * The filterable columns.
 *
 * `text` is an exact match, `ilike` a contains match, `number` takes Min/Max
 * suffixes, `bool` a true/false, `present` asks only whether the column has any
 * value — which is how the overlay columns read, since "heritage_class is not
 * null" means the lot is in a heritage item and the class itself is detail.
 *
 * `list` is membership of a comma-separated list, and it exists because a lot
 * can span two zones. `lzn_sym_code_p` then reads "SP1, C2" — 52,366 lots
 * statewide are split like this, and 20,362 carry two minimum lot sizes. An
 * exact match on "R2" returned 454,498 lots and silently missed the 7,192
 * split-zoned ones that are also R2. Membership finds 463,176.
 */
const FIELDS: Record<string, Field> = {
  lga: { column: 'lga_name', kind: 'text', label: 'Council', facet: 200 },
  suburb: { column: 'suburbname', kind: 'text', label: 'Suburb' },
  zone: { column: 'lzn_sym_code_p', kind: 'list', label: 'Zone', facet: 60 },
  zoneClass: { column: 'lzn_lay_class_p', kind: 'ilike', label: 'Zone name' },
  // A comma-separated list of Standard Instrument uses, so contains is the only
  // sound test: "dual occupancies" must not match on a prefix of another term.
  use: { column: 'permissible_uses', kind: 'ilike', label: 'Permits use' },
  lsz: { column: 'lsz_lay_size_p', kind: 'list', label: 'Minimum lot size', facet: 200 },
  area: { column: 'area_sqm', kind: 'number', label: 'Lot area (m²)' },
  hob: { column: 'hob_max_b_h', kind: 'number', label: 'Height of building (m)' },
  fsr: { column: 'fsr_fsr', kind: 'number', label: 'Floor space ratio' },
  frontage: { column: 'primary_frontage_length_m', kind: 'number', label: 'Primary frontage (m)' },
  width: { column: 'width', kind: 'number', label: 'Width at setback (m)' },
  depth: { column: 'lot_depth_m', kind: 'number', label: 'Lot depth (m)' },
  lmr: { column: 'in_lmr_housing_area', kind: 'bool', label: 'Low and Mid-Rise area' },
  tod: { column: 'in_tod_area', kind: 'bool', label: 'Transport Oriented Development' },
  corner: { column: 'is_corner_lot', kind: 'bool', label: 'Corner lot' },
  battleaxe: { column: 'is_battleaxe', kind: 'bool', label: 'Battle-axe' },
  heritage: { column: 'heritage_class', kind: 'present', label: 'Heritage' },
  bushfire: { column: 'bushfireproneland', kind: 'present', label: 'Bushfire prone' },
  flood: { column: 'floodmapping', kind: 'present', label: 'Flood mapped' },
}

/** What a result row carries — enough to identify a lot and open it. */
const SELECT = `address, lot_section_plan, lga_name, suburbname,
  lzn_sym_code_p, lzn_lay_class_p, lsz_lay_size_p, area_sqm,
  hob_max_b_h, fsr_fsr, primary_frontage_road, primary_frontage_length_m,
  is_corner_lot, is_battleaxe, in_lmr_housing_area, in_tod_area,
  centroid_lat, centroid_lon`

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
/**
 * Counting stops here.
 *
 * "R2 anywhere in NSW" is 440,475 lots and nobody needs the exact figure — they
 * need to know the filter is too wide. Counting a bounded subquery keeps the
 * worst case flat and the answer reads "5,000+".
 */
const COUNT_CEILING = 5000

/** Built once: a full pass over 5.48M rows costs ~500 ms per column. */
let facetCache: { at: number, data: any } | null = null
const FACET_TTL_MS = 60 * 60 * 1000

async function buildFacets() {
  if (facetCache && Date.now() - facetCache.at < FACET_TTL_MS) return facetCache.data

  const out: Record<string, Array<{ value: string, count: number }>> = {}
  for (const [key, f] of Object.entries(FIELDS)) {
    if (!f.facet) continue
    // For a list column, count membership rather than the literal string, so
    // "R2" reports every R2 lot including the split-zoned ones, and the tail of
    // pairwise combinations ("C4, C2", "C2, C4"…) never reaches the dropdown.
    const expr = f.kind === 'list'
      ? `btrim(unnest(string_to_array(${f.column}::text, ',')))`
      : `${f.column}::text`
    const { rows } = await nswQuery(
      `SELECT value, count(*)::int AS count FROM (
         SELECT ${expr} AS value FROM ${PROPERTY_TABLE}
          WHERE ${f.column} IS NOT NULL AND ${f.column}::text <> ''
       ) z
        WHERE value <> ''
        GROUP BY 1 ORDER BY 2 DESC LIMIT $1`,
      [f.facet],
    )
    out[key] = rows as any
  }
  facetCache = { at: Date.now(), data: out }
  return out
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)

  if (String(q.facets ?? '') === '1') {
    setHeader(event, 'cache-control', 'public, max-age=3600')
    return {
      ok: true as const,
      fields: Object.entries(FIELDS).map(([key, f]) => ({ key, label: f.label, kind: f.kind })),
      facets: await buildFacets(),
    }
  }

  const where: string[] = []
  const params: unknown[] = []
  const applied: Array<{ key: string, label: string, value: string }> = []
  const bind = (v: unknown) => { params.push(v); return `$${params.length}` }

  for (const [key, f] of Object.entries(FIELDS)) {
    if (f.kind === 'number') {
      const lo = Number(q[`${key}Min`])
      const hi = Number(q[`${key}Max`])
      if (Number.isFinite(lo)) {
        where.push(`${f.column} >= ${bind(lo)}`)
        applied.push({ key, label: f.label, value: `≥ ${lo}` })
      }
      if (Number.isFinite(hi)) {
        where.push(`${f.column} <= ${bind(hi)}`)
        applied.push({ key, label: f.label, value: `≤ ${hi}` })
      }
      continue
    }

    const raw = q[key]
    if (raw === undefined || raw === null || String(raw).trim() === '') continue
    const v = String(raw).trim()

    if (f.kind === 'text') {
      where.push(`upper(${f.column}::text) = upper(${bind(v)})`)
      applied.push({ key, label: f.label, value: v })
    } else if (f.kind === 'list') {
      /**
       * Equality first, and the list test only for rows that are actually a
       * list. ~1% of lots are split (52,366 of 5.48M), so gating the expensive
       * branch behind a comma test keeps the common case at equality speed.
       * Measured on R2 + Hornsby + 600-900 m², LIMIT 12:
       *
       *   lzn_sym_code_p = 'R2'                        1.4 ms   (misses 15,070)
       *   ARRAY(SELECT btrim(unnest(…))) @> ARRAY[…]   668 ms
       *   wrapped LIKE, ungated                        106 ms
       *   equality OR (has-comma AND wrapped LIKE)     2.6 ms   ← this
       *
       * Spaces are stripped from both sides so "R2, C2" and "R2,C2" read the
       * same, and the value is wrapped in commas so "R2" cannot match "R21".
       * Both sides are bound parameters.
       */
      const bare = bind(v)
      const pattern = bind(`%,${v.replace(/\s+/g, '')},%`)
      where.push(`(${f.column}::text = ${bare} OR (${f.column}::text LIKE '%,%'`
        + ` AND (',' || replace(${f.column}::text, ' ', '') || ',') LIKE ${pattern}))`)
      applied.push({ key, label: f.label, value: v })
    } else if (f.kind === 'ilike') {
      where.push(`${f.column} ILIKE ${bind(`%${v}%`)}`)
      applied.push({ key, label: f.label, value: `contains “${v}”` })
    } else if (f.kind === 'bool') {
      const on = /^(1|true|yes|on)$/i.test(v)
      where.push(`${f.column} IS ${on ? 'TRUE' : 'NOT TRUE'}`)
      applied.push({ key, label: f.label, value: on ? 'yes' : 'no' })
    } else if (f.kind === 'present') {
      const on = /^(1|true|yes|on)$/i.test(v)
      where.push(on
        ? `(${f.column} IS NOT NULL AND ${f.column}::text <> '')`
        : `(${f.column} IS NULL OR ${f.column}::text = '')`)
      applied.push({ key, label: f.label, value: on ? 'yes' : 'no' })
    }
  }

  if (!where.length) {
    return {
      ok: false as const,
      reason: 'no_filter',
      message: 'Set at least one filter — an unfiltered search would scan 5.48M rows.',
    }
  }

  const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)

  /**
   * Deduplicated here, not by `DISTINCT ON`.
   *
   * `DISTINCT ON (lot_section_plan) … ORDER BY lot_section_plan` has to sort
   * every matching row before the LIMIT can apply, which on a filter matching
   * thousands of lots is the whole cost of the query. Measured on R2 in
   * Hornsby, 600–900 m²:
   *
   *   DISTINCT ON + ORDER BY, LIMIT 5    1,181 ms   (sorts all matches)
   *   plain LIMIT 20                         4 ms   (stops at 20)
   *
   * So the scan stops early and the duplicates are dropped in JS. Over-fetching
   * covers them: d_4 duplicates Randwick, which is at worst two rows per lot,
   * and OVERFETCH of 3 leaves room for any council loaded the same way.
   */
  const OVERFETCH = 3
  const sql = `SELECT ${SELECT}
     FROM ${PROPERTY_TABLE}
    WHERE ${where.join(' AND ')}
    LIMIT ${bind(limit * OVERFETCH)}`

  const started = Date.now()
  const { rows: raw } = await nswQuery(sql, params)
  const tookMs = Date.now() - started

  const seen = new Set<string>()
  const rows: any[] = []
  for (const r of raw as any[]) {
    const key = String(r.lot_section_plan ?? '').toUpperCase()
    // A row with no lot id cannot be deduplicated and cannot be opened either,
    // so it is kept but never collapses another.
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    rows.push(r)
    if (rows.length >= limit) break
  }

  // Opt-in, and bounded: see COUNT_CEILING.
  let total: number | null = null
  let totalCapped = false
  if (String(q.count ?? '') === '1') {
    const { rows: c } = await nswQuery(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM ${PROPERTY_TABLE} WHERE ${where.join(' AND ')} LIMIT ${COUNT_CEILING}
       ) z`,
      params.slice(0, params.length - 1),
    )
    total = c[0]?.n ?? 0
    totalCapped = total >= COUNT_CEILING
  }

  setHeader(event, 'cache-control', 'private, max-age=30')
  return {
    ok: true as const,
    applied,
    count: rows.length,
    limit,
    total,
    totalCapped,
    tookMs,
    results: rows.map((r: any) => {
      const row = scrubSentinels(r) as any
      return {
        lotId: row.lot_section_plan ? String(row.lot_section_plan).toUpperCase() : null,
        address: row.address,
        lga: row.lga_name,
        suburb: row.suburbname,
        zone: row.lzn_sym_code_p,
        zoneName: row.lzn_lay_class_p,
        minLotSize: row.lsz_lay_size_p,
        areaSqm: row.area_sqm,
        hob: row.hob_max_b_h,
        fsr: row.fsr_fsr,
        frontageRoad: row.primary_frontage_road,
        frontageM: row.primary_frontage_length_m,
        isCorner: row.is_corner_lot,
        isBattleaxe: row.is_battleaxe,
        inLmr: row.in_lmr_housing_area,
        inTod: row.in_tod_area,
        lat: row.centroid_lat,
        lon: row.centroid_lon,
      }
    }),
  }
})
