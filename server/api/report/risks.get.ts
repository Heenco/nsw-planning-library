/**
 * The three hazards /report-2 reports on one lot - bush fire, flood, aircraft noise - one row per CATEGORY.
 *
 * SOURCES. What a plan maps is read from the epi tables, the same as every other section of /report-2: flood from
 * epi.epi_flood, an LEP's noise contours from epi.epi_noise_exposure_forecast. What no plan maps comes from its own
 * dataset and says so: bush fire prone land (RFS), the state 1% AEP flood extent, the Georges River floodplain study, and
 * the Defence and Sydney Airport noise contours.
 *
 * Why not /api/lmr/at: that endpoint answers "is the lot in this layer", so it folds every polygon of a layer
 * into one row and keeps the alphabetically first label. For a hazard the category is the answer: a lot in
 * ANEF 20-25 and 25-30 read "ANEF 20 - 25 - not excluded" there (lot 150857369), and a lot in Vegetation
 * Category 1 and the buffer read "Vegetation Buffer". Here each category keeps its own row and its own share
 * of the lot, and the page reports the worst.
 *
 * The test is the lot polygon shrunk by 10 cm, as in /api/epi/at, so a polygon that only shares the lot's
 * edge drops out. Every source table is GDA94 (4283) with a GiST index, so the lot is used as it is.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface RiskRow {
  /** Which dataset said so. */
  source: string
  /** The category: "Vegetation Category 1", "Flood Planning Area", "25 - 30". */
  cls: string
  /** More about the category where the source has it: the map's layer name, the noise metric, the study. */
  detail: string | null
  instrument: string | null
  clause: string | null
  /** The source's own verdict text, where it carries one (airport_noise.noise_verdict). */
  verdict: string | null
  coverPct: number
}

export interface RisksResponse {
  lot: { cadid: string; areaM2: number } | null
  bushfire: RiskRow[]
  flood: RiskRow[]
  noise: RiskRow[]
  /** Source dates, so the page can say how current each answer is. */
  asOf: Record<string, string | null>
  ms: number
}

/** cover_pct of the rows of one table, grouped by the given expressions. */
function part(kind: string, source: string, table: string, geom: string, cols: {
  cls: string; detail?: string; instrument?: string; clause?: string; verdict?: string
}, where = '') {
  const c = (e?: string) => (e ? `(${e})::text` : 'NULL::text')
  const caught = `ST_Union(ST_Intersection(ST_ClipByBox2D(x.${geom}, ST_Envelope(t.g)), t.g))`
  return `SELECT '${kind}'::text AS kind, '${source}'::text AS source,
      ${c(cols.cls)} AS cls, ${c(cols.detail)} AS detail, ${c(cols.instrument)} AS instrument,
      ${c(cols.clause)} AS clause, ${c(cols.verdict)} AS verdict,
      100 * ST_Area(ST_Transform(${caught}, 3308)) / NULLIF(max(t.area_m2), 0) AS cover_pct
    FROM ${table} x, t
    WHERE x.${geom} && t.g AND ST_Intersects(x.${geom}, t.g)${where ? ` AND ${where}` : ''}
    GROUP BY 1, 2, 3, 4, 5, 6, 7`
}

const SQL = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
  shrunk AS MATERIALIZED (
    SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g
    FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x),
  t AS MATERIALIZED (SELECT g, ST_Area(ST_Transform(g, 3308)) AS area_m2 FROM shrunk)
` + [
  part('bushfire', 'NSW RFS bush fire prone land map', 'lmr.bushfire_prone_land', 'geometry', { cls: 'x.d_category' }),
  part('flood', 'LEP flood planning map', 'epi.epi_flood', 'geom',
    { cls: 'x.lay_class', detail: 'x.lay_name', instrument: 'x.epi_name', clause: 'x.legis_ref_clause' }),
  // the two loads of the same 1% AEP extent agree only in part and neither is known to be authoritative,
  // so they are read as one (lmr.layers caveat)
  `SELECT 'flood', '1% AEP flood extent (state flood data)', '1% AEP flood extent', NULL, NULL, NULL, NULL,
      100 * ST_Area(ST_Transform(ST_Union(ST_Intersection(ST_ClipByBox2D(u.g, ST_Envelope(t.g)), t.g)), 3308)) / NULLIF(max(t.area_m2), 0)
    FROM (SELECT wkb_geometry AS g FROM lmr.flood_sfd_1aep UNION ALL SELECT geom FROM lmr.flood_sfd_1aep_1) u, t
    WHERE u.g && t.g AND ST_Intersects(u.g, t.g)`,
  part('flood', 'Georges River floodplain risk management study', 'flood.frmsp_georges_river', 'geom',
    { cls: 'x.rep_type', detail: `concat_ws(' - ', x.cat_name, x.report_title, x.rep_date::text)` }),
  part('noise', 'LEP noise exposure forecast map', 'epi.epi_noise_exposure_forecast', 'geom',
    { cls: 'coalesce(x.lay_class, x.anef_code, x.label)', detail: `CASE WHEN coalesce(x.lay_class, x.anef_code, x.label) ILIKE '%ANEC%' THEN 'ANEC' ELSE 'ANEF' END`, instrument: 'x.epi_name', clause: 'x.legis_ref_clause' }),
  // contours no EPI map carries: Defence ANEF/ANEC and Sydney Airport ANEI (the rows of lmr.airport_noise with no plan)
  part('noise', 'Defence and Sydney Airport noise contours (not an EPI map)', 'lmr.airport_noise', 'geom',
    { cls: 'coalesce(x.noise_band, x.anef_code)', detail: 'x.noise_metric', instrument: 'x.name', verdict: 'x.noise_verdict' }, 'x.epi_name IS NULL'),
].join('\nUNION ALL\n')

/**
 * Two rows that say the same thing. An LEP's ANEF map is in both epi (labelled "20") and airport_noise
 * ("20 - 25"), so a noise band is known by its instrument and lower bound; anything else by its text.
 */
const key = (kind: string, r: RiskRow) => {
  const band = kind === 'noise' ? r.cls.match(/\d+/)?.[0] : null
  const inst = (r.instrument ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `${inst}|${kind === 'noise' ? '' : r.detail ?? ''}|${band ?? r.cls.toLowerCase().replace(/\s+/g, '')}`
}

export default defineEventHandler(async (event): Promise<RisksResponse> => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'Give a cadid' })
  setHeader(event, 'cache-control', 'public, max-age=60')

  const [lot, res, dates] = await Promise.all([
    nswQuery<{ area: number }>(`SELECT ST_Area(geom::geography) AS area FROM cadastre.lot WHERE cadid = $1 LIMIT 1`, [cadid]),
    nswQuery<any>(SQL, [cadid]),
    nswQuery<{ table_name: string; source_date: string | null }>(
      `SELECT table_name, source_date FROM lmr.layers WHERE table_name IN ('lmr.bushfire_prone_land', 'lmr.airport_noise')`)
      .catch(() => ({ rows: [] as { table_name: string; source_date: string | null }[] })),
  ])
  if (!lot.rows[0]) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  const out: Pick<RisksResponse, 'bushfire' | 'flood' | 'noise'> = { bushfire: [], flood: [], noise: [] }
  const seen = new Set<string>()
  // of two copies, keep the one that says more: a verdict (airport_noise), then a clause (epi)
  const rank = (r: any) => (r.verdict ? 0 : r.clause ? 1 : 2)
  for (const r of [...res.rows].sort((a, b) => rank(a) - rank(b))) {
    const pct = Number(r.cover_pct)
    if (!Number.isFinite(pct) || pct <= 0.05 || !r.cls) continue
    const row: RiskRow = { source: r.source, cls: String(r.cls).trim(), detail: r.detail || null, instrument: r.instrument || null,
      clause: r.clause || null, verdict: r.verdict || null, coverPct: Math.min(100, pct) }
    // the LEP flood maps are in both epi and lmr, and an LEP's ANEF map in both epi and airport_noise
    const k = `${r.kind}|${key(r.kind, row)}`
    if (seen.has(k)) continue
    seen.add(k)
    out[r.kind as keyof typeof out].push(row)
  }
  for (const list of Object.values(out)) list.sort((a, b) => b.coverPct - a.coverPct)

  return {
    lot: { cadid, areaM2: Number(lot.rows[0].area) },
    ...out,
    asOf: Object.fromEntries(dates.rows.map(d => [d.table_name.replace(/^lmr\./, ''), d.source_date])),
    ms: Date.now() - started,
  }
})
