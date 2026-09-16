/**
 * Follow one NSW lot through every table, for the "Trace a lot" panel on
 * /datasources. The address trace read the chain from an address down to the
 * land; this reads it the other way.
 *
 *   /api/datasources/nsw-lot?q=17//DP10140      → matching lots
 *   /api/datasources/nsw-lot?q=DP10140          → every lot in that plan
 *   /api/datasources/nsw-lot?cadid=101143132    → the full trace
 *
 * WHAT THE SEARCH ACCEPTS
 *
 * Lot references are written many ways, so what is typed is parsed into lot,
 * section and plan rather than matched as text: "17//DP10140", "17/DP10140",
 * "Lot 17 DP 10140", "20/36/DP758002", "//SP998", "CP//SP998" and a bare
 * "DP10140" all work. The canonical form lot/section/plan is then an exact
 * lookup on cadastre.lot.lotidstring, which is indexed.
 *
 * A reference that names a lot with no shape of its own - a strata unit lot
 * such as 38//SP67869, or a lot from a later strata plan such as 54//SP74478 -
 * is not in the lot map at all. Those are resolved through guras.propertylot,
 * which knows the lot reference and carries the cadid of the land it sits on,
 * and the answer says which site it landed on.
 *
 * WHAT THE TRACE RETURNS
 *
 * The lot itself, the properties built on it, every address on those
 * properties (each one linking into the address trace), how many address
 * points fall inside it, and the planning controls that cover it. The controls
 * are the one relationship on this page with no key behind it: the layers are
 * intersected with the lot, and each control reports the share of the lot it
 * covers, so a lot on a zone boundary shows both zones rather than a coin toss.
 */

import type pg from 'pg'
import { withNswClient } from '../../utils/nsw-kg/pool'
import { EPI_LAYER_GROUP, epiLayerTitle, type GeoJsonGeometry, type LotMatch, type LotTrace } from '#shared/datasources-nsw'

const SHAPE = (col: string) => `ST_AsGeoJSON(ST_SimplifyPreserveTopology(${col}, sqrt(ST_Area(${col})) / 400), 7)`

/**
 * Where each planning layer keeps the value that matters. Every layer also has
 * `label`, `sym_code` and `lay_class`, which is what the rest fall back to.
 */
const LAYER_VALUE: Record<string, { value: string; unit?: string; note?: string }> = {
  epi_land_zoning: { value: 'sym_code', note: 'lay_class' },
  epi_height_of_building: { value: 'max_b_h', unit: 'units' },
  epi_floor_space_ratio: { value: 'fsr' },
  epi_lot_size: { value: 'lot_size', unit: 'units' },
  epi_heritage: { value: 'h_name', note: 'lay_class' },
  epi_dwelling_density: { value: 'min_dwelling_density' },
  epi_obstacle_limitation_surface: { value: 'maximum_height', note: 'height_range' },
  epi_additional_permitted_uses: { value: 'apu_code', note: 'label' },
  epi_noise_exposure_forecast: { value: 'anef_code' },
  epi_land_reservation_acquisition: { value: 'lra_type', note: 'authority' },
  epi_local_provisions: { value: 'class_description', note: 'label' },
  epi_key_sites: { value: 'keysite_id', note: 'label' },
  epi_gross_floor_area: { value: 'label', unit: 'units' },
  epi_reduced_level: { value: 'label', unit: 'units' },
  epi_growth_centres: { value: 'precinct', note: 'label' },
  epi_map_tiles: { value: 'map_sheet', note: 'map_name' },
  epi_precinct_boundaries: { value: 'precinct', note: 'label' },
}
/** Empty in these layers is written three ways: NULL, an empty string, and the text "<Null>". */
const nz = (col: string) => `nullif(nullif(${col}::text, ''), '<Null>')`
/** What a layer with no value column of its own is described by, in order of preference. */
const DEFAULT_COLUMNS = ['label', 'sym_code', 'lay_class']

/**
 * One query that asks all 56 layers about one lot, built once per process.
 *
 * WHY THE LAYER POLYGON IS CLIPPED TO THE LOT'S BOX FIRST
 *
 * The share of the lot a control covers is the area they share over the area of
 * the lot, and intersecting is the expensive part: several of these layers are
 * single state-wide polygons with hundreds of thousands of vertices, and one
 * "where the plan applies" boundary can take seconds against a rural lot.
 * ST_ClipByBox2D throws away everything outside the lot's bounding box in one
 * linear pass, which leaves a small polygon for the intersection to work on.
 * Measured across a 511 m² house lot, a strata site, a 6.8 ha lot and a 547 ha
 * rural lot: every one answers in 200-480 ms, against 5-8 seconds unclipped.
 *
 * The candidate cap of 12 per layer bounds the work where a lot crosses many
 * polygons of one layer; the page only shows the first few of each anyway.
 */
let layersSql: Promise<{ sql: string; tables: string[] }> | null = null

function buildLayersSql(client: pg.PoolClient): Promise<{ sql: string; tables: string[] }> {
  layersSql ??= client
    .query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'epi' ORDER BY 1`)
    .then((r) => {
      const tables: string[] = r.rows.map(row => row.table_name)
      const branches = tables.map((t) => {
        const cfg = LAYER_VALUE[t]
        const value = cfg ? nz(`e.${cfg.value}`) : DEFAULT_COLUMNS.map(c => nz(`e.${c}`)).join(', ')
        const unit = cfg?.unit ? nz(`e.${cfg.unit}`) : 'NULL::text'
        const note = cfg?.note ? nz(`e.${cfg.note}`) : (cfg ? 'NULL::text' : nz('e.lay_class'))
        return `
  SELECT '${t}'::text AS layer, x.epi_name, x.value, x.unit, x.note, x.share
  FROM l, LATERAL (
    SELECT e.epi_name, coalesce(${value})::text AS value, ${unit} AS unit, ${note} AS note,
           least(100, round((100 * ST_Area(ST_Intersection(ST_MakeValid(ST_ClipByBox2D(e.geom, l.box)), l.geom))
                             / nullif(l.a, 0))::numeric, 1)) AS share
    FROM epi.${t} e
    WHERE e.geom && l.geom AND ST_Intersects(e.geom, l.geom)
    LIMIT 12) x`
      })
      const sql = `WITH l AS MATERIALIZED (
  SELECT ST_MakeValid(geom) AS geom, ST_Area(geom) AS a, ST_Envelope(geom) AS box
  FROM cadastre.lot WHERE cadid = $1)
${branches.join('\n  UNION ALL')}`
      return { sql, tables }
    })
    .catch((err) => { layersSql = null; throw err })
  return layersSql
}

interface ParsedRef { lot: string | null; section: string; plan: string }

function parseRef(raw: string): ParsedRef | null {
  const s = raw.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
  const plan = s.match(/\b(DP|SP)\s*(\d{1,8})\b/)
  if (!plan) return null
  const planLabel = `${plan[1]}${Number(plan[2])}`
  // everything before the plan is the lot and, when there are two parts, the section
  const before = s.slice(0, plan.index).replace(/\bLOT\b|\bSEC(TION)?\b|\bPT\b/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = before.split(/[\/\s]+/).map(p => p.trim()).filter(Boolean)
  if (!parts.length) return { lot: null, section: '', plan: planLabel }
  if (parts.length === 1) return { lot: parts[0]!, section: '', plan: planLabel }
  return { lot: parts[0]!, section: parts[1]!, plan: planLabel }
}

async function search(client: pg.PoolClient, raw: string): Promise<{ results: LotMatch[]; hint?: string }> {
  const ref = parseRef(raw)
  if (!ref) {
    return { results: [], hint: 'Name the plan, for example 17//DP10140, 20/36/DP758002, //SP998 or just DP10140.' }
  }

  // a plan on its own: list its lots
  if (!ref.lot) {
    const r = await client.query(
      `SELECT cadid, lotidstring, count(*) OVER () AS total
       FROM cadastre.lot WHERE planlabel = $1 ORDER BY length(lotnumber), lotnumber, sectionnumber LIMIT 24`,
      [ref.plan],
    )
    if (!r.rows.length) return { results: [], hint: `No lot in this data belongs to plan ${ref.plan}.` }
    const total = Number(r.rows[0].total)
    return {
      results: r.rows.map(row => ({ cadid: String(row.cadid), lotidstring: row.lotidstring, note: null })),
      hint: total > r.rows.length ? `Plan ${ref.plan} has ${total.toLocaleString('en-AU')} lots; showing the first ${r.rows.length}.` : undefined,
    }
  }

  const canonical = `${ref.lot}/${ref.section}/${ref.plan}`
  const drawn = await client.query(
    `SELECT cadid, lotidstring FROM cadastre.lot WHERE lotidstring = $1 LIMIT 5`,
    [canonical],
  )
  if (drawn.rows.length) {
    return { results: drawn.rows.map(row => ({ cadid: String(row.cadid), lotidstring: row.lotidstring, note: null })) }
  }

  // not drawn: a strata unit lot, common property, or a lot from a later plan
  const titled = await client.query(
    `SELECT DISTINCT pl.cadid, l.lotidstring, pl.propidtype
     FROM guras.propertylot pl
     JOIN cadastre.lot l ON l.cadid = pl.cadid
     WHERE pl.planlabel = $1 AND upper(pl.lotnumber) = $2 AND coalesce(pl.sectionnumber, '') = $3
     LIMIT 5`,
    [ref.plan, ref.lot.toUpperCase(), ref.section],
  )
  if (titled.rows.length) {
    return {
      results: titled.rows.map(row => ({
        cadid: String(row.cadid),
        lotidstring: row.lotidstring,
        note: Number(row.propidtype) === 3
          ? `${canonical} is common property; its land is ${row.lotidstring}`
          : `${canonical} is a strata lot with no shape of its own; it sits on ${row.lotidstring}`,
      })),
    }
  }
  return { results: [], hint: `No lot ${canonical} in this data. It may be a very new lot, or the plan may be spelled differently.` }
}

async function trace(client: pg.PoolClient, cadid: string): Promise<LotTrace | null> {
  const lot = (await client.query(
    `SELECT cadid, lotidstring, planlabel, lotnumber, sectionnumber, classsubtype, hasstratum, stratumlevel, itstitlestatus,
            planlotarea, planlotareaunits, urbanity, startdate, lastupdate,
            round(ST_Area(geom::geography)) AS area_m2, round(ST_Perimeter(geom::geography)) AS perimeter_m,
            ${SHAPE('geom')} AS geojson
     FROM cadastre.lot WHERE cadid = $1`,
    [cadid],
  )).rows[0]
  if (!lot) return null

  const links = (await client.query(
    `SELECT propid, propidtype, count(*)::int AS rows,
            min(lotnumber || '/' || coalesce(sectionnumber, '') || '/' || planlabel) AS first_title_lot
     FROM guras.propertylot WHERE cadid = $1 GROUP BY 1, 2 ORDER BY 2, 1 LIMIT 40`,
    [cadid],
  )).rows
  const propids = [...new Set(links.map(l => Number(l.propid)))]

  const properties = propids.length
    ? (await client.query(
        `SELECT DISTINCT ON (p.propid) p.propid, p.address, p.valnetpropertytype, p.valnetlotcount, p.principaladdresstype,
                round(ST_Area(p.geom::geography)) AS area_m2
         FROM cadastre.property p WHERE p.propid = ANY($1::int[])
         ORDER BY p.propid, p.principaladdresstype LIMIT 20`,
        [propids],
      )).rows
    : []

  const addresses = propids.length
    ? (await client.query(
        `SELECT count(*) OVER () AS total, a.msoid, a.address, a.unitnumber, a.principaladdresstype,
                CASE WHEN pl.lotnumber IS NULL THEN NULL ELSE pl.lotnumber || '/' || coalesce(pl.sectionnumber, '') || '/' || pl.planlabel END AS title_lot
         FROM guras.addressstring a
         LEFT JOIN guras.propertylot pl ON a.sppropid <> a.propid AND pl.sppropid = a.sppropid AND pl.propidtype = 2
         WHERE a.propid = ANY($1::int[])
         ORDER BY a.principaladdresstype, a.unitnumber NULLS FIRST, a.address
         LIMIT 60`,
        [propids],
      )).rows
    : []

  const points = (await client.query(
    `SELECT count(*)::int AS inside FROM guras.addresspoint ap, cadastre.lot l
     WHERE l.cadid = $1 AND ap.geom && l.geom AND ST_Intersects(ap.geom, l.geom)`,
    [cadid],
  )).rows[0]

  // Every planning layer, asked about this lot in one query.
  const { sql, tables } = await buildLayersSql(client)
  const hits = (await client.query(sql, [cadid])).rows

  const byLayer = new Map<string, typeof hits>()
  for (const row of hits) {
    const list = byLayer.get(row.layer) ?? []
    list.push(row)
    byLayer.set(row.layer, list)
  }

  const controls: LotTrace['controls'] = []
  for (const [layer, rows] of byLayer) {
    // The same control often arrives as several polygons; add their shares up.
    const merged = new Map<string, { value: string | null; unit: string | null; note: string | null; instrument: string | null; share: number }>()
    for (const row of rows) {
      const key = `${row.value}|${row.unit}|${row.note}|${row.epi_name}`
      const seen = merged.get(key)
      const share = row.share == null ? 0 : Number(row.share)
      if (seen) seen.share = Math.min(100, seen.share + share)
      else merged.set(key, { value: row.value, unit: row.unit, note: row.note, instrument: row.epi_name, share: Math.min(100, share) })
    }
    let values = [...merged.values()].sort((a, b) => b.share - a.share)
    // A boundary that merely grazes the lot reports a fraction of a percent; drop
    // those once something actually covers the lot, and keep them otherwise.
    if (values.some(v => v.share >= 0.5)) values = values.filter(v => v.share >= 0.5)
    controls.push({
      key: layer,
      label: epiLayerTitle(layer),
      group: EPI_LAYER_GROUP[layer] ?? 'Other',
      values: values.slice(0, 4),
    })
  }
  controls.sort((a, b) => (b.values[0]?.share ?? 0) - (a.values[0]?.share ?? 0) || a.label.localeCompare(b.label))

  // Which layers hold nothing at all in this download, so "does not cover" is not a surprise.
  const emptyLayers = new Set<string>(
    (await client.query(
      `SELECT table_name FROM public.geodaas_latest_load WHERE schema_name = 'epi' AND row_count = 0`,
    ).catch(() => ({ rows: [] as { table_name: string }[] }))).rows.map(r => r.table_name),
  )
  const otherLayers = tables
    .filter(t => !byLayer.has(t))
    .map(t => ({ key: t, label: epiLayerTitle(t), group: EPI_LAYER_GROUP[t] ?? 'Other', empty: emptyLayers.has(t) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))

  const neighbours: GeoJsonGeometry[] = (await client.query(
    `WITH site AS (SELECT geom, ST_Envelope(geom) AS box FROM cadastre.lot WHERE cadid = $1)
     SELECT ${SHAPE('l.geom')} AS geojson
     FROM cadastre.lot l, site
     WHERE l.geom && ST_Expand(site.box, greatest(ST_XMax(site.box) - ST_XMin(site.box), ST_YMax(site.box) - ST_YMin(site.box)) * 0.8)
       AND l.cadid <> $1
     LIMIT 80`,
    [cadid],
  )).rows.map(r => JSON.parse(r.geojson))

  const n = (v: unknown) => (v == null ? null : Number(v))
  const countOf = (t: number) => links.filter(l => Number(l.propidtype) === t).reduce((s, l) => s + Number(l.rows), 0)
  return {
    lot: {
      cadid: String(lot.cadid),
      lotidstring: lot.lotidstring,
      planlabel: lot.planlabel,
      lotnumber: lot.lotnumber,
      sectionnumber: lot.sectionnumber,
      classsubtype: n(lot.classsubtype),
      hasstratum: n(lot.hasstratum),
      stratumlevel: n(lot.stratumlevel),
      itstitlestatus: n(lot.itstitlestatus),
      planLotArea: n(lot.planlotarea),
      planLotAreaUnits: lot.planlotareaunits,
      urbanity: lot.urbanity,
      startDate: lot.startdate ? new Date(lot.startdate).toISOString() : null,
      areaM2: n(lot.area_m2),
      perimeterM: n(lot.perimeter_m),
      geometry: JSON.parse(lot.geojson),
    },
    propertyLotCounts: { ordinary: countOf(1), unit: countOf(2), common: countOf(3) },
    properties: properties.map(p => ({
      propid: Number(p.propid),
      address: p.address,
      valnetType: n(p.valnetpropertytype),
      valnetLotCount: n(p.valnetlotcount),
      areaM2: n(p.area_m2),
    })),
    addresses: {
      total: Number(addresses[0]?.total ?? 0),
      rows: addresses.map(a => ({
        msoid: Number(a.msoid),
        address: a.address,
        unitNumber: n(a.unitnumber),
        principalType: n(a.principaladdresstype),
        titleLot: a.title_lot,
      })),
    },
    pointsInside: Number(points?.inside ?? 0),
    controls,
    otherLayers,
    neighbours,
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const cadid = String(query.cadid ?? '').trim()
  const q = String(query.q ?? '').trim()

  if (/^\d{1,12}$/.test(cadid)) {
    const result = await withNswClient(client => trace(client, cadid))
    if (!result) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}.` })
    return result
  }
  if (q.length >= 3) return withNswClient(client => search(client, q))
  throw createError({ statusCode: 400, statusMessage: 'Pass ?q= with a lot or plan reference, or ?cadid= with a lot id to trace.' })
})
