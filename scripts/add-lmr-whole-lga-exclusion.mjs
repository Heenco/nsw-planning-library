/**
 * Build `lmr.whole_lga_exclusion` - the four council areas the Low and Mid-Rise Housing Policy leaves out whole.
 *
 *   node scripts/add-lmr-whole-lga-exclusion.mjs [--dry-run]
 *
 * WHAT IT IS
 *
 * The Department excludes ALL land in the Bathurst Regional, Blue Mountains, Hawkesbury and Wollondilly local
 * government areas, whatever else is true of a lot there. None of the four hosts a nominated station or town
 * centre, so the exclusion rarely changes a result - but it is on the Department's list, and a lot there must
 * never be reported as inside the policy because a catchment happened to reach over a boundary.
 *
 * The Department's reasons, one per row in `reason`:
 *   Bathurst Regional    only two small R2 areas: one affected by Mount Panorama racetrack noise, the other by
 *                        sewage treatment plant odour
 *   Blue Mountains,      mainly bush fire, flood and evacuation risk
 *   Hawkesbury,
 *   Wollondilly
 *
 * WHERE THE SHAPES COME FROM
 *
 * No exclusion map exists for this - the Department names the councils. We hold no LGA boundary polygons on
 * planningai, so the four boundaries are read from ePlanning's own Local Government Area layer
 * (Planning_Portal_Administration/MapServer/5), in GDA94 (4283) like the rest of the lmr schema. The script
 * REFUSES unless exactly the four names come back: a missing council would silently put its land back inside
 * the policy.
 *
 * The table is built beside the live one and swapped in one transaction, so /lmr never reads a half-built
 * layer. Re-run to refresh the boundaries; then rebuild the tiles (scripts/build-lmr-pmtiles.py) and the
 * catalogue (scripts/build-lmr-layers.mjs).
 */

import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')
const SERVICE = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Administration/MapServer/5'

const REASONS = {
  'BATHURST REGIONAL': 'Only two small R2 areas, one affected by Mount Panorama racetrack noise and the other by sewage treatment plant odour.',
  'BLUE MOUNTAINS': 'Mainly bush fire, flood and evacuation risk.',
  'HAWKESBURY': 'Mainly bush fire, flood and evacuation risk.',
  'WOLLONDILLY': 'Mainly bush fire, flood and evacuation risk.',
}

async function fetchLgas() {
  const where = `LGANAME IN (${Object.keys(REASONS).map(n => `'${n}'`).join(',')})`
  const params = new URLSearchParams({
    where, outFields: 'LGANAME,COUNCILNAME,LASTUPDATE', returnGeometry: 'true', outSR: '4283', f: 'geojson',
  })
  const res = await fetch(`${SERVICE}/query?${params}`)
  if (!res.ok) throw new Error(`ePlanning answered ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`ePlanning error: ${JSON.stringify(body.error)}`)
  const got = (body.features ?? []).map(f => f.properties?.LGANAME)
  const missing = Object.keys(REASONS).filter(n => !got.includes(n))
  if (missing.length || got.length !== 4) {
    throw new Error(`expected the four councils, got ${JSON.stringify(got)}; missing ${JSON.stringify(missing)}`)
  }
  for (const f of body.features) {
    if (!f.geometry?.coordinates?.length) throw new Error(`${f.properties.LGANAME} came back without a geometry`)
  }
  return body.features
}

async function main() {
  const features = await fetchLgas()
  for (const f of features) {
    const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const vertices = rings.flat(1).reduce((n, r) => n + r.length, 0)
    console.log(`${f.properties.LGANAME.padEnd(18)} ${f.properties.COUNCILNAME.padEnd(30)} ${f.geometry.type} ${vertices.toLocaleString()} vertices`)
  }
  if (DRY) { console.log('dry run - nothing written'); return }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('DROP TABLE IF EXISTS lmr.whole_lga_exclusion__new')
    await client.query(`CREATE TABLE lmr.whole_lga_exclusion__new (
      id serial PRIMARY KEY,
      lga_name text NOT NULL UNIQUE,
      council_name text,
      reason text NOT NULL,
      lga_lastupdate timestamptz,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      geom geometry(MultiPolygon, 4283) NOT NULL)`)
    for (const f of features) {
      const p = f.properties
      await client.query(
        `INSERT INTO lmr.whole_lga_exclusion__new (lga_name, council_name, reason, lga_lastupdate, geom)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0),
                 ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($5), 4283)), 3)))`,
        [p.LGANAME, p.COUNCILNAME, REASONS[p.LGANAME], p.LASTUPDATE ?? null, JSON.stringify(f.geometry)])
    }
    const { rows: [check] } = await client.query(
      `SELECT count(*)::int n, bool_and(ST_IsValid(geom)) valid, round(sum(ST_Area(geom::geography)) / 1e6) km2
       FROM lmr.whole_lga_exclusion__new`)
    if (check.n !== 4 || !check.valid) throw new Error(`refusing to swap: ${JSON.stringify(check)}`)
    await client.query('CREATE INDEX ON lmr.whole_lga_exclusion__new USING gist (geom)')
    await client.query('DROP TABLE IF EXISTS lmr.whole_lga_exclusion')
    await client.query('ALTER TABLE lmr.whole_lga_exclusion__new RENAME TO whole_lga_exclusion')
    await client.query(`COMMENT ON TABLE lmr.whole_lga_exclusion IS ${pg.escapeLiteral(
      'Whole-LGA exclusions of the Low and Mid-Rise Housing Policy: all land in the Bathurst Regional, Blue Mountains, '
      + 'Hawkesbury and Wollondilly local government areas is excluded. Bathurst has only 2 small R2 areas, one affected '
      + 'by Mount Panorama racetrack noise and the other by sewage treatment plant odour; the other three are excluded '
      + 'mainly because of bush fire, flood and evacuation risk. '
      + `Source: ePlanning Local Government Area layer at ${SERVICE}, 4 features reported and 4 loaded, `
      + `on ${new Date().toISOString().slice(0, 10)}. Built by scripts/add-lmr-whole-lga-exclusion.mjs.`)}`)
    await client.query('COMMIT')
    console.log(`lmr.whole_lga_exclusion: ${check.n} council areas, ${Number(check.km2).toLocaleString()} km2`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
