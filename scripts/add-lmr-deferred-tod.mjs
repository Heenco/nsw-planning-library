/**
 * Build the deferred TOD layer - Housing SEPP 2021 Schedule 12 - and the land s 164(1)(k) excludes around it.
 *
 *   node scripts/add-lmr-deferred-tod.mjs [--dry-run]
 *
 * s 164(1)(k): Chapter 6 does not apply to "land within 800m of a public entrance to a railway, metro or light
 * rail station listed in Schedule 12". Schedule 12 is the eight deferred Transport Oriented Development
 * stations. The list is not in the library's copy of the SEPP (it holds the sections, not the schedules), and
 * the Department's "Deferred Transport Oriented Development Areas Map" (Planning/SEPP_Housing_2021/MapServer/5)
 * is published with no features - so the stations are named here, from Mills Oakley's and Lindsay Taylor
 * Lawyers' readings of the amendment, and located from NSW Spatial Services' Train Station layer, the same
 * source as lmr.lmr_train_stations.
 *
 * STRAIGHT LINE, NOT WALKING. s 164(1)(k) says "within 800m", where s 163 says "800m walking distance". So the
 * area is an 800 m buffer, not an isochrone - wider than a walking catchment, as the clause is.
 *
 * FROM THE STATION POINT, NOT EACH ENTRANCE. The clause measures from a public entrance; the service gives one
 * point per station. At a large station an entrance can be tens of metres from that point, so the edge of the
 * area can be off by that much.
 *
 * Writes lmr.deferred_tod_stations (8 points) and lmr.deferred_tod_areas (8 buffers, in each station's own
 * GDA94 MGA zone so 800 m is 800 m). REFUSES unless all eight stations are found. Built beside the live tables
 * and swapped in one transaction.
 */

import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')
const SERVICE = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/MapServer/1'
const STATIONS = ['Belmore', 'Canterbury', 'Cockle Creek', 'Lakemba', 'North Wollongong', 'Punchbowl', 'St Marys', 'Wiley Park']
const SOURCE_NOTE = 'Schedule 12 of the Housing SEPP 2021, as read by Mills Oakley and Lindsay Taylor Lawyers; the SEPP copy in the library holds no schedules'

async function fetchStations() {
  const names = STATIONS.map(s => `'${s.toUpperCase()} RAILWAY STATION'`).join(',')
  const params = new URLSearchParams({
    where: `upper(generalname) IN (${names})`, outFields: 'generalname,operationalstatus,featuremoddate',
    returnGeometry: 'true', outSR: '4283', f: 'json',
  })
  const res = await fetch(`${SERVICE}/query?${params}`)
  if (!res.ok) throw new Error(`the Train Station service answered ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`the Train Station service: ${JSON.stringify(body.error)}`)
  const found = new Map(body.features.map(f => [f.attributes.generalname.toUpperCase(), f]))
  const missing = STATIONS.filter(s => !found.has(`${s.toUpperCase()} RAILWAY STATION`))
  if (missing.length || found.size !== STATIONS.length) {
    throw new Error(`expected all ${STATIONS.length} Schedule 12 stations, missing ${JSON.stringify(missing)}`)
  }
  return STATIONS.map(s => ({ station: s, f: found.get(`${s.toUpperCase()} RAILWAY STATION`) }))
}

async function main() {
  const rows = await fetchStations()
  for (const r of rows) console.log(`${r.station.padEnd(18)} ${r.f.geometry.x.toFixed(5)}, ${r.f.geometry.y.toFixed(5)}`)
  if (DRY) { console.log('dry run - nothing written'); return }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query('DROP TABLE IF EXISTS lmr.deferred_tod_stations__new, lmr.deferred_tod_areas__new')
    await c.query(`CREATE TABLE lmr.deferred_tod_stations__new (
      id serial PRIMARY KEY, station text NOT NULL UNIQUE, foi_name text NOT NULL, foi_moddate timestamptz,
      fetched_at timestamptz NOT NULL DEFAULT now(), geom geometry(Point, 4283) NOT NULL)`)
    for (const r of rows) {
      await c.query(`INSERT INTO lmr.deferred_tod_stations__new (station, foi_name, foi_moddate, geom)
                     VALUES ($1, $2, to_timestamp($3 / 1000.0), ST_SetSRID(ST_MakePoint($4, $5), 4283))`,
        [r.station, r.f.attributes.generalname, r.f.attributes.featuremoddate ?? null, r.f.geometry.x, r.f.geometry.y])
    }
    // 800 m in each station's own MGA zone (56 east of 150 E, 55 west of it), so the radius is true metres
    await c.query(`CREATE TABLE lmr.deferred_tod_areas__new AS
      SELECT s.id, s.station, 800 AS radius_m,
             'within 800 m (straight line) of ' || s.station || ' station - Housing SEPP s 164(1)(k), Schedule 12' AS label,
             ST_Multi(ST_Transform(ST_Buffer(ST_Transform(s.geom, z.srid), 800, 32), 4283))::geometry(MultiPolygon, 4283) AS geom
        FROM lmr.deferred_tod_stations__new s,
             LATERAL (SELECT CASE WHEN ST_X(s.geom) >= 150 THEN 28356 ELSE 28355 END AS srid) z`)
    const { rows: [check] } = await c.query(`SELECT count(*)::int n, round(min(ST_Area(geom::geography))) min_m2,
                                                    round(max(ST_Area(geom::geography))) max_m2 FROM lmr.deferred_tod_areas__new`)
    if (check.n !== STATIONS.length) throw new Error(`refusing to swap: ${JSON.stringify(check)}`)
    await c.query('CREATE INDEX ON lmr.deferred_tod_stations__new USING gist (geom)')
    await c.query('CREATE INDEX ON lmr.deferred_tod_areas__new USING gist (geom)')
    await c.query('DROP TABLE IF EXISTS lmr.deferred_tod_stations, lmr.deferred_tod_areas')
    await c.query('ALTER TABLE lmr.deferred_tod_stations__new RENAME TO deferred_tod_stations')
    await c.query('ALTER TABLE lmr.deferred_tod_areas__new RENAME TO deferred_tod_areas')
    const today = new Date().toISOString().slice(0, 10)
    await c.query(`COMMENT ON TABLE lmr.deferred_tod_stations IS ${pg.escapeLiteral(
      `The eight deferred Transport Oriented Development stations of Housing SEPP 2021 Schedule 12 (${SOURCE_NOTE}). `
      + `Located from ${SERVICE}, one point per station, on ${today}. Built by scripts/add-lmr-deferred-tod.mjs.`)}`)
    await c.query(`COMMENT ON TABLE lmr.deferred_tod_areas IS ${pg.escapeLiteral(
      `Land within 800 m of a Schedule 12 deferred TOD station, which Housing SEPP s 164(1)(k) excludes from Chapter 6. `
      + `A straight-line buffer, as the clause says - not a walking catchment - measured from the station point rather `
      + `than each public entrance. Built ${today} by scripts/add-lmr-deferred-tod.mjs.`)}`)
    await c.query('COMMIT')
    console.log(`lmr.deferred_tod_areas: ${check.n} areas, ${Number(check.min_m2).toLocaleString()}-${Number(check.max_m2).toLocaleString()} m² each`)
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
