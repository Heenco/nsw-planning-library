/**
 * Whether one lot is environmentally sensitive under clause 3.3, layer by layer.
 *
 *   /api/esa/at?cadid=123456
 *   /api/esa/at?lon=151.2093&lat=-33.8688
 *
 * The same test as /epi and /cdc-map: the LOT POLYGON shrunk by 10 cm, not the address point. Clause 3.3
 * excludes land that IS environmentally sensitive, so a house on the dry half of a lot whose other half is
 * a coastal wetland is still on a lot that is caught - and a point test would say otherwise, wrong in the
 * direction that costs someone a certificate. The shrink is there because cadastre and planning layers
 * share their boundaries, so the raw parcel returns every neighbour that merely touches its edge.
 *
 * BOTH HALVES OF THE CLAUSE, KEPT APART
 *
 * The answer separates what applies everywhere from what one plan adds, because confusing them is the
 * easy mistake and the consequence differs:
 *
 *   statewide   the definition itself - coastal wetlands, littoral rainforest, Ramsar, world heritage,
 *               NPWS estate, AOBV and the rest. A hit is an exclusion.
 *   addition    what a local plan adds on top. A PRECISE addition is real geometry and a hit means what
 *               it says; an ADVISORY one covers the whole council area and a hit means only "this
 *               exception exists somewhere in this plan" - never that this lot is caught. The response
 *               marks them so the caller cannot read one as the other.
 *
 * WHY THE COLUMNS ARE RESOLVED RATHER THAN NAMED
 *
 * Unlike the cdc schema, whose layers are all views of the same four columns, these tables come from
 * eleven publishers and share no schema: the label is `label` in one, `itemname` in another, `reservename`
 * in a third. So the geometry and name columns are read out of the catalogue once and cached, exactly as
 * scripts/build-esa33-pmtiles.py does for the same tables.
 *
 * The registry is the authority on what exists. A row with no table is a gap and is returned as one: a
 * lot can never be fully cleared against clause 3.3 while any remain, and saying so is the point.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

/**
 * The label column, first match wins - these tables share no schema.
 *
 * Longer than the esa33 tile build's list, because that one was written against the column names it
 * happened to need and leaves several of these tables unlabelled: ramsar_wetlands calls it
 * `ramsar_name`, the stewardship register `agreementname`, and the AOBV view only has `boset_class`.
 * An unmatched table still answers, it just cannot say which feature caught the lot.
 */
const NAME_COLUMNS = ['label', 'name', 'itemname', 'h_name', 'reservename', 'reserve_name', 'wha_name',
  'ramsar_name', 'ramsar_nam', 'wetland_name', 'agreementname', 'site_name', 'decname', 'idname',
  'mpa_name', 'lay_class', 'lep_name', 'boset_class']

export interface EsaAtHit {
  key: string
  /** 'statewide' applies to every lot in NSW; 'addition' is what one local plan adds. */
  half: 'statewide' | 'addition'
  paragraph: string | null
  item: string
  /** What the layer calls the features that were hit, deduplicated. */
  names: string[]
  /** How much of the lot the layer covers, 0-100. */
  coverPct: number
  /** The caught part of the lot, for the map. */
  geom: unknown | null
  /** 'exclusion' catches the lot; 'context' is a fact about it and carries no consequence. */
  kind: 'exclusion' | 'context'
  /** Additions only: 'precise' is real geometry, 'advisory' is the whole plan area. */
  coverageType: string | null
  /** Additions only: the item has to be checked by hand before it is relied on. */
  verifyRequired: boolean
}

export interface EsaAtGap {
  key: string
  item: string
  paragraph: string | null
  reason: string
}

export interface EsaAtResponse {
  lon: number | null
  lat: number | null
  basis: 'lot' | 'point'
  lot: { cadid: string | null; lotId: string | null; lga: string | null; areaM2: number | null } | null
  lotGeom: unknown | null
  hits: EsaAtHit[]
  summary: {
    /** State-wide clause 3.3 EXCLUSIONS that caught the lot. Context hits are not counted here. */
    statewide: number
    /** Plan additions that caught it, of which `advisory` say only that the item exists in that plan. */
    additions: number
    advisory: number
    /** Layers actually tested, so "clear" can be read against something. */
    tested: number
    /** Registered items with no dataset: the lot cannot be cleared against these at all. */
    gaps: number
  }
  gaps: EsaAtGap[]
  ms: number
}

const CACHE_MS = 5 * 60 * 1000
let cached: { at: number; sql: string; meta: Map<string, any>; gaps: EsaAtGap[]; tested: number } | null = null

/** One UNION ALL over every clause 3.3 layer that holds features, plus the plan additions. */
async function build() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached

  // esa.layers rather than esa.clause33_layers: the catalogue already carries `kind`, and without it
  // the Biodiversity Values map reads as an exclusion when it is the Offsets Scheme entry map and
  // carries no exempt-or-complying-development consequence at all.
  const reg = await nswQuery<any>(`
    SELECT key, paragraph, item, table_name, kind, note
    FROM esa.layers
    WHERE half = 'clause33'
    ORDER BY coalesce(paragraph, 'z'), item`)

  // geometry column and SRID per table, and the columns each one actually has
  const cols = await nswQuery<any>(`
    SELECT n.nspname AS schema, c.relname AS rel,
           (SELECT g.f_geometry_column FROM geometry_columns g
             WHERE g.f_table_schema = n.nspname AND g.f_table_name = c.relname LIMIT 1) AS gcol,
           (SELECT g.srid FROM geometry_columns g
             WHERE g.f_table_schema = n.nspname AND g.f_table_name = c.relname LIMIT 1) AS srid,
           -- ::text matters. attname is Postgres type "name", so array_agg gives name[], which
           -- node-postgres has no parser for and returns as the raw string "{objectid,ramsar_name,...}".
           -- .includes() on that is a SUBSTRING test, which quietly matched "name" inside "ramsar_name"
           -- and produced a column reference that does not exist.
           array_agg(a.attname::text ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname IN ('esa', 'bio_values') AND c.relkind IN ('r', 'v', 'm')
    GROUP BY 1, 2`)
  const byRel = new Map(cols.rows.map(r => [`${r.schema}.${r.rel}`, r]))

  const parts: string[] = []
  const meta = new Map<string, any>()
  const gaps: EsaAtGap[] = []

  for (const r of reg.rows) {
    if (!r.table_name) {
      gaps.push({ key: r.key, item: r.item, paragraph: r.paragraph, reason: r.note ?? '' })
      continue
    }
    const t = byRel.get(r.table_name)
    if (!t?.gcol) continue
    const srid = Number(t.srid) || 4283
    const name = NAME_COLUMNS.find(c => (t.columns ?? []).includes(c))
    // the lot goes to the layer, never the layer to the lot: transforming the indexed column would stop
    // the GiST index being usable at all
    const g = `ST_Transform(t.g, ${srid})`
    // clip the layer polygon to the lot's envelope before the overlay, so a state-wide shape is not
    // intersected whole; the share is measured in NSW Lambert metres, not square degrees
    const caught = `ST_Union(ST_Intersection(ST_ClipByBox2D(c."${t.gcol}", ST_Envelope(${g})), ${g}))`
    const [schema, rel] = String(r.table_name).split('.')
    parts.push(`SELECT '${r.key}'::text AS key,
        ${name ? `array_agg(DISTINCT c."${name}"::text) FILTER (WHERE c."${name}" IS NOT NULL)` : 'NULL::text[]'} AS names,
        100 * ST_Area(ST_Transform(${caught}, 3308)) / NULLIF(max(t.area_m2), 0) AS cover_pct,
        ST_AsGeoJSON(ST_Transform(${caught}, 4283), 6) AS geojson,
        NULL::text AS coverage_type, false AS verify_required
      FROM "${schema}"."${rel}" c, t
      WHERE c."${t.gcol}" && ${g} AND ST_Intersects(c."${t.gcol}", ${g})`)
    meta.set(r.key, { half: 'statewide', paragraph: r.paragraph, item: r.item, kind: r.kind })
  }

  // the additions, one row per exception item rather than one per layer, so an advisory item keeps its
  // own tier and verify flag instead of being averaged into a layer
  const add = byRel.get('esa.additional_exceptions')
  if (add?.gcol) {
    const g = `ST_Transform(t.g, ${Number(add.srid) || 4326})`
    const caught = `ST_Union(ST_Intersection(ST_ClipByBox2D(c."${add.gcol}", ST_Envelope(${g})), ${g}))`
    parts.push(`SELECT 'addition:' || c.id::text AS key,
        array_agg(DISTINCT concat_ws(' ', c.lep_name, c.ref)) AS names,
        100 * ST_Area(ST_Transform(${caught}, 3308)) / NULLIF(max(t.area_m2), 0) AS cover_pct,
        ST_AsGeoJSON(ST_Transform(${caught}, 4283), 6) AS geojson,
        max(c.coverage_type)::text AS coverage_type,
        bool_or(coalesce(c.verify_required, false)) AS verify_required
      FROM esa.additional_exceptions c, t
      WHERE c."${add.gcol}" && ${g} AND ST_Intersects(c."${add.gcol}", ${g})
      GROUP BY c.id`)
  }

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
     t AS MATERIALIZED (SELECT g, ST_Area(ST_Transform(g, 3308)) AS area_m2 FROM shrunk)
`
    + parts.join('\nUNION ALL\n')

  cached = { at: Date.now(), sql, meta, gaps, tested: parts.length }
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
                     ST_AsEWKT(geom) AS ewkt, ST_AsGeoJSON(geom, 6) AS geojson`

export default defineEventHandler(async (event): Promise<EsaAtResponse> => {
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

  const { sql, meta, gaps, tested } = await build()
  const res = await nswQuery<any>(sql, [lot?.ewkt ?? point!])

  const hits: EsaAtHit[] = res.rows
    .filter(r => r.names != null || r.cover_pct != null)
    .map((r) => {
      const isAdd = String(r.key).startsWith('addition:')
      const m = meta.get(r.key) ?? {}
      const names: string[] = (r.names ?? []).filter(Boolean)
      return {
        key: r.key,
        half: isAdd ? 'addition' as const : 'statewide' as const,
        paragraph: m.paragraph ?? null,
        item: m.item ?? names[0] ?? r.key,
        names,
        coverPct: r.cover_pct == null ? 0 : Math.min(100, Number(r.cover_pct)),
        geom: r.geojson ? JSON.parse(r.geojson) : null,
        kind: m.kind === 'context' ? 'context' as const : 'exclusion' as const,
        coverageType: r.coverage_type ?? null,
        verifyRequired: Boolean(r.verify_required),
      }
    })
    // state-wide first - they are the exclusions - then the additions, biggest share first within each
    .sort((a, b) => (a.half === b.half
      ? b.coverPct - a.coverPct
      : a.half === 'statewide' ? -1 : 1))

  return {
    lon: havePoint ? lon : null,
    lat: havePoint ? lat : null,
    basis: lot?.ewkt ? 'lot' : 'point',
    lot: lot ? { cadid: lot.cadid, lotId: lot.lotId, lga: lot.lga, areaM2: lot.areaM2 } : null,
    lotGeom: lot?.geojson ? JSON.parse(lot.geojson) : null,
    hits,
    summary: {
      statewide: hits.filter(h => h.half === 'statewide' && h.kind === 'exclusion').length,
      additions: hits.filter(h => h.half === 'addition').length,
      advisory: hits.filter(h => h.coverageType === 'advisory').length,
      tested,
      gaps: gaps.length,
    },
    gaps,
    ms: Date.now() - started,
  }
})
