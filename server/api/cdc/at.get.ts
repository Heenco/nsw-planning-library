/**
 * Whether one lot clears the complying development prerequisites, layer by layer.
 *
 * Same test as /epi: the LOT POLYGON, shrunk by 10 cm, not the address point. A house on the dry half of
 * a flood line still sits on a lot that is partly in the flood planning area, and a point test would say
 * otherwise - wrong in the direction that costs someone money. The shrink is there because cadastre and
 * planning layers share their boundaries, so the raw parcel returns every neighbour that merely touches
 * its edge, each covering 0% of it.
 *
 * What is different here is that the answer is a verdict rather than a list. Each layer in cdc.layers
 * carries whether a hit is an exclusion or just context, so a hit on bush fire prone land reads as
 * excluded while a hit on the zoning layer reads as a fact - every lot in NSW is inside a zone, and
 * reporting that as a failure would exclude the state.
 *
 * The lot is transformed into each layer's own SRID rather than the layers into one common SRID. epi is
 * in 4283 and one lmr table is in 4326, and transforming the layer side would make its GiST index
 * unusable: the predicate would no longer be on the indexed column. Transforming the single small lot
 * costs nothing and keeps every index a real index.
 *
 * Each hit carries the intersection clipped to the lot, so the map can draw exactly the part of the lot
 * that is caught rather than a statewide polygon.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

/**
 * What a hit bears on, which is not the same as whether it is an exclusion.
 *
 *   general    a prerequisite of clause 1.17A, 1.18, 1.19, 1.19A or Schedule 5, so it rules out every
 *              certificate type
 *   code       a requirement of one code only, so it rules out that code and nothing else
 *   midrise    clause 182 of the Housing SEPP, which gates the Pattern Book and no Codes SEPP pathway
 *   unmapped   we exclude on it, but the workbook gives no clause that says to
 *   condition  the clause asks for an approval before the certificate issues, not for the land to be
 *              clear - a hit is work to do, not a disqualification
 *   context    being inside it is a fact about the lot, not a disqualification
 */
export type CdcScope = 'general' | 'code' | 'midrise' | 'unmapped' | 'condition' | 'context'

/**
 * The catalogue's `kind`, narrowed.
 *
 * It used to be two-valued, and every reader wrote `=== 'context' ? 'context' : 'exclusion'`, which
 * silently turned anything new into an exclusion. `condition` is the third value: clause 1.18(1)(f)
 * does not say a mine subsidence district cannot take complying development, it says the development
 * needs prior approval from Subsidence Advisory NSW. Treating that as an exclusion refuses lots the
 * clause allows.
 */
export type CdcKind = 'exclusion' | 'condition' | 'context'

export function kindOf(raw: string | null | undefined): CdcKind {
  return raw === 'context' || raw === 'condition' ? raw : 'exclusion'
}

/** Exclusions first, then the things to do, then the facts. */
const KIND_ORDER: Record<CdcKind, number> = { exclusion: 0, condition: 1, context: 2 }

export function scopeOf(clauses: string[], kind: string): CdcScope {
  if (kind === 'context') return 'context'
  if (kind === 'condition') return 'condition'
  if (!clauses.length) return 'unmapped'
  if (clauses.some(c => /^(1\.1[789]|Schedule)/.test(c))) return 'general'
  if (clauses.some(c => /^18[0-9]/.test(c))) return 'midrise'
  return 'code'
}

export interface CdcHit {
  key: string
  title: string
  group: string
  groupTitle: string
  clauses: string[]
  scope: CdcScope
  kind: CdcKind
  columnTested: string | null
  note: string | null
  /** What the layer calls the features that were hit, deduplicated. */
  names: string[]
  /** How much of the lot the layer covers, 0-100. */
  coverPct: number
  /** The caught part of the lot, for the map. */
  geom: unknown | null
}

export interface CdcGap {
  key: string
  title: string
  clauses: string[]
  reason: string
}

export interface CdcAtResponse {
  lon: number | null
  lat: number | null
  basis: 'lot' | 'point'
  lot: { cadid: string | null; lotId: string | null; lga: string | null; areaM2: number | null } | null
  lotGeom: unknown | null
  /** Every layer that caught the lot. */
  hits: CdcHit[]
  verdict: {
    /** Prerequisites of 1.17A to Schedule 5 that caught it. Any one of these rules out every type. */
    general: number
    /** Requirements of one code only, which rule out that code and nothing else. */
    code: number
    /** Clause 182 of the Housing SEPP, which gates the Pattern Book and no Codes SEPP pathway. */
    midrise: number
    /** Layers we exclude on with no clause behind them. */
    unmapped: number
    /** Exclusion layers tested and clear. */
    clear: number
    /** Layers with no dataset behind them, which cannot be answered either way. */
    unknown: number
    tested: number
  }
  gaps: CdcGap[]
  ms: number
}

const CACHE_MS = 5 * 60 * 1000
let cached: { at: number; sql: string; gaps: CdcGap[] } | null = null

/** One UNION ALL over every cdc layer that holds features, with the lot parsed once. */
async function build(): Promise<{ sql: string; gaps: CdcGap[] }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached

  const cat = await nswQuery<any>(`
    SELECT key, srid, features, source_kind, title, clauses, note
    FROM cdc.layers ORDER BY grp, title`)

  const live = cat.rows.filter(r => Number(r.features) > 0)
  const parts = live.map((r) => {
    const srid = Number(r.srid) || 4283
    // the lot goes to the layer, never the layer to the lot: transforming the indexed column would
    // stop the GiST index being usable at all
    const g = `ST_Transform(t.g, ${srid})`
    // ST_ClipByBox2D cuts the layer polygon to the lot's envelope before the overlay, which spares it
    // from the statewide shapes. The share is measured in NSW Lambert metres, not in square degrees.
    const caught = `ST_Union(ST_Intersection(ST_ClipByBox2D(c.geom, ST_Envelope(${g})), ${g}))`
    return `SELECT '${r.key}'::text AS key,
                   array_agg(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) AS names,
                   100 * ST_Area(ST_Transform(${caught}, 3308))
                       / NULLIF(max(t.area_m2), 0) AS cover_pct,
                   ST_AsGeoJSON(ST_Transform(${caught}, 4283), 6) AS geojson
            FROM cdc."${r.key}" c, t
            WHERE c.geom && ${g} AND ST_Intersects(c.geom, ${g})`
  })

  /*
   * The 10 cm shrink, in NSW Lambert so it is a real 10 cm rather than a tenth of a degree. A sliver of a
   * lot narrower than 20 cm would vanish entirely, so the unshrunk shape is kept in that case, and a
   * point is never buffered.
   */
  const sql = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(ST_GeomFromEWKT($1)) AS g0),
     shrunk AS MATERIALIZED (
       SELECT CASE WHEN ST_Dimension(g0) <> 2 THEN g0
                   WHEN b IS NULL OR ST_IsEmpty(b) THEN g0
                   ELSE b END AS g
       FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x),
     t AS MATERIALIZED (
       SELECT g, ST_Area(ST_Transform(g, 3308)) AS area_m2 FROM shrunk)
`
    + parts.join('\nUNION ALL\n')

  const gaps: CdcGap[] = cat.rows
    .filter(r => r.source_kind === 'none')
    .map(r => ({ key: r.key, title: r.title, clauses: r.clauses ?? [], reason: r.note ?? '' }))

  cached = { at: Date.now(), sql, gaps }
  return cached
}

interface LotRow {
  cadid: string | null
  lotId: string | null
  lga: string | null
  areaM2: number | null
  ewkt: string | null
  geojson: string | null
}

const LOT_COLUMNS = `cadid, lotidstring AS "lotId", lganame AS lga,
                     ST_Area(geom::geography) AS "areaM2",
                     ST_AsEWKT(geom) AS ewkt, ST_AsGeoJSON(geom, 7) AS geojson`

export default defineEventHandler(async (event): Promise<CdcAtResponse> => {
  const q = getQuery(event)
  const cadid = q.cadid == null ? null : String(q.cadid).trim()
  const lon = Number(q.lon)
  const lat = Number(q.lat)
  const havePoint = Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= 140 && lon <= 155 && lat >= -38 && lat <= -27

  if (!cadid && !havePoint) {
    throw createError({ statusCode: 400, statusMessage: 'Give either cadid, or lon and lat inside NSW' })
  }
  setHeader(event, 'cache-control', 'public, max-age=60')

  const started = Date.now()
  const point = havePoint ? `SRID=4283;POINT(${lon} ${lat})` : null

  const lotRes = await (cadid
    ? nswQuery<LotRow>(`SELECT ${LOT_COLUMNS} FROM cadastre.lot WHERE cadid = $1 LIMIT 1`, [cadid])
    : nswQuery<LotRow>(
        `SELECT ${LOT_COLUMNS} FROM cadastre.lot
         WHERE geom && $1::geometry AND ST_Intersects(geom, $1::geometry)
         ORDER BY shape_area NULLS LAST LIMIT 1`, [point])
  ).catch(() => ({ rows: [] as LotRow[] }))

  const lot = lotRes.rows[0] ?? null
  if (!lot?.ewkt && !point) {
    throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })
  }

  const { sql, gaps } = await build()
  const cat = await nswQuery<any>(`
    SELECT key, title, grp, grp_title, clauses, kind, column_tested, note, features
    FROM cdc.layers`)
  const meta = new Map(cat.rows.map(r => [r.key, r]))

  const res = await nswQuery<any>(sql, [lot?.ewkt ?? point!])

  const hits: CdcHit[] = res.rows
    .filter(r => r.names != null || r.cover_pct != null)
    .map((r) => {
      const m = meta.get(r.key) ?? {}
      return {
        key: r.key,
        title: m.title ?? r.key,
        group: m.grp ?? '',
        groupTitle: m.grp_title ?? '',
        clauses: m.clauses ?? [],
        scope: scopeOf(m.clauses ?? [], m.kind),
        kind: kindOf(m.kind),
        columnTested: m.column_tested ?? null,
        note: m.note ?? null,
        names: (r.names ?? []).filter(Boolean),
        coverPct: r.cover_pct == null ? 0 : Math.min(100, Number(r.cover_pct)),
        geom: r.geojson ? JSON.parse(r.geojson) : null,
      }
    })
    .sort((a, b) => (a.kind === b.kind ? b.coverPct - a.coverPct : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]))

  const testedLayers = cat.rows.filter(r => Number(r.features) > 0 && r.kind !== 'context').length
  const count = (s: CdcScope) => hits.filter(h => h.scope === s).length
  // only an exclusion rules the lot out; a condition is work to do and clear must not count it as a pass
  const excluded = hits.filter(h => h.kind === 'exclusion').length
  const conditions = hits.filter(h => h.kind === 'condition').length

  return {
    lon: havePoint ? lon : null,
    lat: havePoint ? lat : null,
    basis: lot?.ewkt ? 'lot' : 'point',
    lot: lot ? { cadid: lot.cadid, lotId: lot.lotId, lga: lot.lga, areaM2: lot.areaM2 } : null,
    lotGeom: lot?.geojson ? JSON.parse(lot.geojson) : null,
    hits,
    verdict: {
      general: count('general'),
      code: count('code'),
      midrise: count('midrise'),
      unmapped: count('unmapped'),
      condition: conditions,
      clear: testedLayers - excluded - conditions,
      unknown: gaps.length,
      tested: testedLayers,
    },
    gaps,
    ms: Date.now() - started,
  }
})
