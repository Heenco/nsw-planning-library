/**
 * GET /api/report/standards?cadid= - the four principal standards the LEP maps set for the lot, as figures, for /report-2.
 *
 * /api/epi/at answers every layer generically, so it carries the map's label ("P4", "U1") and the colour band, not the
 * value. Each of these four tables carries the value in its own column, which is the number the LEP map's legend gives
 * the letter:
 *   height  max_b_h (metres; max_b_h_m where set) - or max_b_h_rl, a level in metres AHD
 *   FSR     fsr (n:1)
 *   lot     lot_size with its units (m2 or ha)
 *   zone    sym_code with lay_class, the zone's name
 * A panel that is an Additional Controls area ("Area 1") may carry no value: its figure is set by the clause it cites,
 * which /api/report/additional-controls reads.
 *
 * Same test as the rest of /report-2: the lot shrunk by 10 cm, each panel with its share of the lot.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface StandardPanel {
  /** The figure, as a reader writes it: "18.1 m", "2.5:1", "450 m²", "R2 Low Density Residential". */
  value: string | null
  number: number | null
  /** The map's own label and colour band, kept as evidence. */
  label: string | null
  band: string | null
  /** An Additional Controls area on this map ("Area 1"), and the clause it cites. */
  area: string | null
  clause: string | null
  plan: string | null
  coverPct: number
  /** false = the panel belongs to an instrument that is only "also mapped" on the lot (a sliver, or an LEP a Precinct SEPP displaces) */
  governing: boolean
}
/** The lot's governing instrument and unit (derived.lot_instrument, docs/precinct-sepp-pipeline.md §1). */
export interface Governing {
  instrument: string
  /** top-level unit of the instrument; null = the whole plan (an LEP) */
  unit: string | null
  unitHeading: string | null
  /** root | land_application | land_zoning | unmapped | none */
  basis: string
  zone: string | null
  /** other instruments mapped on the lot with their cover, not governing */
  alsoMapped: { instrument: string; coverPct: number | null }[]
}
export interface StandardsResponse {
  zone: StandardPanel[]
  height: StandardPanel[]
  fsr: StandardPanel[]
  lotSize: StandardPanel[]
  /** null = derived.lot_instrument has not reached this lot */
  governing: Governing | null
  ms: number
}

const LOT = `WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
  t AS MATERIALIZED (
    SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g, ST_Area(ST_Transform(g0, 3308)) AS area_m2
      FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x)`
const cover = `100 * ST_Area(ST_Transform(ST_Union(ST_Intersection(ST_ClipByBox2D(x.geom, ST_Envelope(t.g)), t.g)), 3308)) / NULLIF(max(t.area_m2), 0)`
const clean = (v: unknown): string | null => { const s = v == null ? '' : String(v).trim(); return s && s !== '<Null>' ? s : null }
const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)))

async function governingOf(cadid: string): Promise<Governing | null> {
  const rows = (await nswQuery<any>(`SELECT document_title, unit_local_id, unit_heading, unit_basis, zone, cover_pct, governing
                                       FROM derived.lot_instrument WHERE cadid = $1 ORDER BY governing DESC, cover_pct DESC NULLS LAST`, [cadid])).rows
  const g = rows.find((r: any) => r.governing)
  if (!g) return null
  return { instrument: g.document_title, unit: g.unit_local_id ?? null, unitHeading: g.unit_heading ?? null, basis: g.unit_basis, zone: g.zone ?? null,
           alsoMapped: rows.filter((r: any) => !r.governing).map((r: any) => ({ instrument: r.document_title, coverPct: r.cover_pct == null ? null : Number(r.cover_pct) })) }
}

async function panels(cadid: string, table: string, cols: string, valueOf: (r: any) => { value: string | null; number: number | null }, gov: Governing | null): Promise<StandardPanel[]> {
  const rows = (await nswQuery<any>(`${LOT}
    SELECT x.epi_name, x.label, x.lay_class, x.legis_ref_area, x.legis_ref_clause, ${cols}, ${cover} AS cover_pct
      FROM epi.${table} x, t
     WHERE x.geom && t.g AND ST_Intersects(x.geom, t.g)
     GROUP BY x.epi_name, x.label, x.lay_class, x.legis_ref_area, x.legis_ref_clause, ${cols.replace(/\s+AS\s+\w+/gi, '')}`, [cadid])).rows
  return rows.filter((r: any) => Number(r.cover_pct) > 0.05).map((r: any) => {
    const v = valueOf(r)
    const label = clean(r.label)
    const area = clean(r.legis_ref_area) ?? (/^area\b/i.test(label ?? '') ? label : null)
    const plan = clean(r.epi_name)
    return { ...v, label, band: clean(r.lay_class), area, clause: clean(r.legis_ref_clause), plan, coverPct: Math.min(100, Number(r.cover_pct)),
             governing: gov == null || plan == null || plan === gov.instrument }
  }).sort((a, b) => Number(b.governing) - Number(a.governing) || b.coverPct - a.coverPct)
}

export default defineEventHandler(async (event): Promise<StandardsResponse> => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  setHeader(event, 'cache-control', 'public, max-age=60')
  const gov = await governingOf(cadid)
  const [zone, height, fsr, lotSize] = await Promise.all([
    panels(cadid, 'epi_land_zoning', 'x.sym_code', r => ({ value: [clean(r.sym_code), clean(r.lay_class)].filter(Boolean).join(' ') || null, number: null }), gov),
    panels(cadid, 'epi_height_of_building', 'x.max_b_h, x.max_b_h_m, x.max_b_h_rl, x.units', (r) => {
      const rl = num(r.max_b_h_rl), m = num(r.max_b_h_m) ?? num(r.max_b_h)
      if (rl != null && rl > 0 && m == null) return { value: `RL ${fmt(rl)} m AHD`, number: rl }
      return m != null && m > 0 ? { value: `${fmt(m)} ${clean(r.units) === 'm' || !clean(r.units) ? 'm' : clean(r.units)}`, number: m } : { value: null, number: null }
    }, gov),
    panels(cadid, 'epi_floor_space_ratio', 'x.fsr', (r) => { const f = num(r.fsr); return f != null && f > 0 ? { value: `${fmt(f)}:1`, number: f } : { value: null, number: null } }, gov),
    panels(cadid, 'epi_lot_size', 'x.lot_size, x.units', (r) => {
      const s = num(r.lot_size)
      if (s == null || s <= 0) return { value: null, number: null }
      const ha = /ha/i.test(String(r.units ?? ''))
      return { value: ha ? `${fmt(s)} ha` : `${Math.round(s).toLocaleString('en-AU')} m²`, number: ha ? s * 10000 : s }
    }, gov),
  ])
  return { zone, height, fsr, lotSize, governing: gov, ms: Date.now() - started }
})
