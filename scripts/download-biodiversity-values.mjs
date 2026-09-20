/**
 * Load the LMBC Biodiversity Values map into `esa.biodiversity_values`.
 *
 *   node scripts/download-biodiversity-values.mjs [--fresh] [--classes=a,b] [--dry-run]
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * The Biodiversity Values map is the Biodiversity Offsets Scheme ENTRY map: land where the scheme is
 * triggered. It is not a list of clause 3.3 environmentally sensitive areas, and only one of its ten
 * BOSET_Class values - "Declared Area of Outstanding Biodiversity Value" - is a clause 3.3 item. The
 * rest (biodiverse riparian land, old growth, rainforest, threatened species with potential for serious
 * and irreversible impacts, land identified by the Environment Agency Head) are offsets triggers with no
 * exempt-or-complying-development role. Whatever is built on top of this table has to keep that apart, or
 * it turns 626k polygons into exclusions that the Codes SEPP never made.
 *
 * WHY THE PREVIOUS ATTEMPT FAILED, AND WHAT IS DIFFERENT HERE
 *
 * esa.clause33_layers has recorded this layer as "not loaded" since 07C: the service "answers at about
 * 9 s per 1,000 features and stopped returning JSON part way through". Both symptoms have one cause -
 * the loader started at OBJECTID 1, which is the head of the "Biodiverse riparian land" block, and the
 * OBJECTIDs are laid out in one contiguous run per class. Riparian averages about 970 vertices a feature
 * against 230 across the eight lighter classes, so a 1,000-id riparian batch is ~30 MB of GeoJSON and
 * 15 s of the service's time, where the same batch of anything else is a fraction of that.
 *
 * Feature weight varies enough WITHIN a class that sampling it is no guide - a 200-feature sample of the
 * koala class suggested 26 vertices a feature and the whole class came in at 330. That is why the batch
 * size is discovered by halving on failure rather than chosen up front from a probe.
 *
 * So this loader:
 *   - works CLASS BY CLASS, smallest first, and reconciles each class before moving on. A class that
 *     cannot be completed leaves the others already loaded and verified, instead of losing the run.
 *   - asks the service for ids first (returnIdsOnly answers for the whole layer in about 5 s) and then
 *     fetches those ids explicitly, so nothing depends on paging staying stable underneath us - the same
 *     id-reconciliation rule 07C settled on.
 *   - POSTs the id batches. A GET with 1,000 ids exceeds the URL limit and comes back as an HTML error
 *     page, which is the most likely reading of "stopped returning JSON".
 *   - asks for f=geojson, so ESRI ring orientation and holes are the server's problem rather than ours,
 *     and ST_GeomFromGeoJSON can read it directly.
 *   - HALVES THE BATCH, and KEEPS it halved for the rest of the class, when the service refuses one.
 *     A 1,000-id batch of riparian polygons is ~30 MB of GeoJSON; under load the service answers it
 *     with an HTML error page. Asking for less is the only thing that helps, and asking for less only
 *     for the one failed batch means paying two retries and a timeout to rediscover the same fact on
 *     the next one - which cost the second run 21 rediscoveries at about 90 s each.
 *   - resumes: ids already in the table are skipped, so re-running after a failure costs only what is
 *     missing.
 *
 * Geometry is stored exactly as the service returns it in GDA94 - not repaired. Invalid geometries are
 * counted and reported, which is what the other esa tables do; repairing on load would hide how much of
 * the source is broken.
 */

import 'dotenv/config'
import pg from 'pg'

const SERVICE = 'https://www.lmbc.nsw.gov.au/arcgis/rest/services/BV/BiodiversityValues/MapServer/0'
const QUERY = `${SERVICE}/query`
const TABLE = 'esa.biodiversity_values'
const BATCH = 1000          // the service's maxRecordCount
const INSERT_CHUNK = 250    // features per INSERT; keeps the largest parameter array near 5 MB
const RETRIES = 2         // a blip gets a retry; persistent failure gets a smaller batch instead
const MIN_BATCH = 25      // below this a failure is real, not a size problem

const DRY = process.argv.includes('--dry-run')
const FRESH = process.argv.includes('--fresh')
const ONLY = (process.argv.find(a => a.startsWith('--classes=')) ?? '').slice(10)
  .split(',').map(s => s.trim()).filter(Boolean)

const log = s => process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${s}\n`)

const DDL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  objectid           int primary key,
  boset_class        text not null,
  bv_category        text,
  date_added         date,
  ver_date           date,
  date_added_display text,
  area_geo           double precision,
  shape_length       double precision,
  shape_area         double precision,
  geom               geometry(MultiPolygon, 4283)
)`

const COLUMN_NOTES = {
  boset_class: 'Which of the ten Biodiversity Offsets Scheme entry classes the polygon belongs to. Only '
    + '"Declared Area of Outstanding Biodiversity Value" is a clause 3.3 environmentally sensitive area; the rest are '
    + 'offsets-scheme triggers and must not be read as exempt-or-complying-development exclusions.',
  bv_category: 'The renderer\'s own split: "Biodiversity Values", or "... added in the last 90 days" for the 133 '
    + 'polygons the map flags as recent. A recency flag, not a separate dataset.',
  date_added: 'When the polygon entered the map. 1900-01-01 is the service\'s own placeholder for "not recorded" - '
    + 'it comes with the display text "Land added over 2 years ago. Contact Map Review Team for information" - and is '
    + 'kept as the service sends it rather than nulled.',
  ver_date: 'The map version date. Every feature in the layer carries the same one.',
  area_geo: 'Hectares, as the service publishes it. Reconciles with the geometry feature by feature, but the '
    + 'riparian class SUMS to about 1.9M km2 against a state of 800,642 km2, so per-class totals are not trustworthy '
    + 'until that is explained. Do not quote an area off this column without checking.',
  geom: 'GDA94, exactly as the service returns it. Not repaired - count invalid geometries before a spatial test.',
}

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }

  log('asking the service what classes it holds…')
  const classes = await classCounts()
  const wanted = ONLY.length ? classes.filter(c => ONLY.some(o => c.name.toLowerCase().includes(o.toLowerCase()))) : classes
  const total = wanted.reduce((t, c) => t + c.n, 0)
  log(`${classes.length} classes, ${total.toLocaleString()} features to load, smallest class first:`)
  for (const c of wanted) log(`    ${String(c.n).padStart(7)}  ${c.name}`)
  if (DRY) { log('--dry-run: nothing fetched, nothing written.'); return }

  // A pool, not a single Client: a heavy class spends minutes at a time talking to the service with no
  // query in flight, and a Client that drops in that gap takes the whole run down with an unhandled
  // 'error' event. A pool hands out a fresh connection on the next query instead.
  const client = new pg.Pool({
    connectionString: dsn, max: 2, statement_timeout: 0,
    keepAlive: true, keepAliveInitialDelayMillis: 30_000, idleTimeoutMillis: 30_000,
  })
  client.on('error', err => log(`  (idle database connection dropped: ${err.message} - reconnecting)`))

  try {
    if (FRESH) { log(`dropping ${TABLE}`); await client.query(`DROP TABLE IF EXISTS ${TABLE}`) }
    await client.query(DDL)

    const t0 = Date.now()
    let done = 0
    const report = []

    for (const c of wanted) {
      const ct0 = Date.now()
      log(`${c.name}: ${c.n.toLocaleString()} features`)

      const ids = await ids4(c.name)
      if (ids.length !== c.n) {
        log(`  ! the service counted ${c.n} but listed ${ids.length} ids; going with the ids`)
      }

      const have = await client.query(
        `SELECT objectid FROM ${TABLE} WHERE boset_class = $1`, [c.name])
      const held = new Set(have.rows.map(r => r.objectid))
      const todo = ids.filter(id => !held.has(id))
      if (held.size) log(`  ${held.size.toLocaleString()} already held, ${todo.length.toLocaleString()} to fetch`)

      // The batch size is STICKY: once the service has refused 1,000 riparian polygons it will refuse
      // the next 1,000 too, and re-learning that every batch costs two retries and a timeout each time.
      // The first run did exactly that - 21 splits, about 90 s apiece, to rediscover the same fact. So a
      // failure halves the size for the REST of the class rather than for one batch.
      let written = 0
      let size = BATCH
      let i = 0
      let sinceLog = 0
      while (i < todo.length) {
        const slice = todo.slice(i, i + size)
        try {
          written += await fetchInto(client, slice)
        } catch (err) {
          if (size <= MIN_BATCH) throw err
          size = Math.max(MIN_BATCH, Math.floor(size / 2))
          log(`    too big for this class - ${size} a batch from here on (${err.message.slice(0, 60)})`)
          continue // same ids, smaller bite
        }
        i += slice.length
        done += slice.length
        sinceLog += slice.length
        if (sinceLog >= 10_000 || i >= todo.length) {
          sinceLog = 0
          const pct = (done / total * 100).toFixed(1)
          const rate = done / ((Date.now() - t0) / 1000)
          const left = (total - done) / Math.max(rate, 1) / 60
          log(`  ${i.toLocaleString()}/${todo.length.toLocaleString()}  ·  ${pct}% overall`
            + `  ·  ${rate.toFixed(0)}/s  ·  batch ${size}  ·  ~${left.toFixed(0)} min left`)
        }
      }

      // reconcile before moving on: a class is either whole or it is reported as short
      const now = await client.query(
        `SELECT count(*)::int AS n FROM ${TABLE} WHERE boset_class = $1`, [c.name])
      const ok = now.rows[0].n === ids.length
      report.push({ name: c.name, expected: ids.length, got: now.rows[0].n, ok })
      log(`  ${ok ? 'complete' : `SHORT by ${ids.length - now.rows[0].n}`}: ${now.rows[0].n.toLocaleString()} rows`
        + ` in ${((Date.now() - ct0) / 60000).toFixed(1)} min${written !== todo.length ? ` (${written} written of ${todo.length} fetched)` : ''}`)
    }

    log('indexing…')
    await client.query(`CREATE INDEX IF NOT EXISTS biodiversity_values_geom_idx ON ${TABLE} USING gist (geom)`)
    await client.query(`CREATE INDEX IF NOT EXISTS biodiversity_values_class_idx ON ${TABLE} (boset_class)`)
    await client.query(`ANALYZE ${TABLE}`)

    const summary = await client.query(`
      SELECT count(*)::int AS rows,
             count(*) FILTER (WHERE NOT ST_IsValid(geom))::int AS invalid,
             sum(ST_NPoints(geom))::bigint AS vertices,
             max(ver_date) AS ver
      FROM ${TABLE}`)
    const s = summary.rows[0]
    await comment(client, classes, s, report)

    log('')
    log(`${TABLE}: ${Number(s.rows).toLocaleString()} rows, ${Number(s.vertices).toLocaleString()} vertices, `
      + `${s.invalid.toLocaleString()} invalid, version ${String(s.ver).slice(0, 10)}`)
    for (const r of report) log(`  ${r.ok ? ' ok ' : 'SHORT'}  ${String(r.got).padStart(7)}/${String(r.expected).padStart(7)}  ${r.name}`)
    const short = report.filter(r => !r.ok)
    log(short.length
      ? `\n${short.length} class(es) short - re-run to pick up only what is missing.`
      : `\nEvery class reconciled against the service. Total ${((Date.now() - t0) / 60000).toFixed(1)} min.`)
  } finally {
    await client.end()
  }
}

/** The ten classes and their counts, smallest first - so the useful ones land in the first minute. */
async function classCounts() {
  const body = new URLSearchParams({
    where: '1=1', f: 'json',
    groupByFieldsForStatistics: 'BOSET_Class',
    outStatistics: JSON.stringify([
      { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]),
  })
  const j = await post(body)
  return j.features.map(f => ({ name: f.attributes.BOSET_Class, n: f.attributes.n }))
    .sort((a, b) => a.n - b.n)
}

/** Every OBJECTID in a class. The authority on what has to be fetched; paging is never trusted. */
async function ids4(className) {
  const body = new URLSearchParams({
    where: `BOSET_Class='${className.replace(/'/g, "''")}'`,
    returnIdsOnly: 'true', f: 'json',
  })
  const j = await post(body)
  return (j.objectIds ?? []).sort((a, b) => a - b)
}

/**
 * Fetch these ids and insert them. Failure is the caller's business: the class loop answers it by
 * halving the batch size for the rest of the class, which is the only thing that helps and the only
 * thing worth remembering.
 */
async function fetchInto(client, ids) {
  const features = await fetchOnce(ids)
  return insert(client, features)
}

/** One batch of features, by explicit id, as GeoJSON in GDA94. */
async function fetchOnce(ids) {
  const body = new URLSearchParams({
    objectIds: ids.join(','),
    // returnZ/M are asked for and ignored - the service sends [x, y, 0, null] positions regardless,
    // which is why ST_Force2D on insert is doing the real work
    outFields: '*', returnGeometry: 'true', returnZ: 'false', returnM: 'false', outSR: '4283', f: 'geojson',
  })
  const j = await post(body)
  return (j.features ?? []).filter(f => f.geometry)
}

/**
 * POST with a couple of retries for a transient blip. Persistent failure is left to the caller, which
 * answers it by asking for less rather than by asking again.
 */
async function post(body, attempt = 1) {
  try {
    const res = await fetch(QUERY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(180_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!text.trimStart().startsWith('{')) throw new Error(`not JSON: ${text.trim().slice(0, 80)}`)
    const j = JSON.parse(text)
    if (j.error) throw new Error(`service error ${j.error.code}: ${j.error.message}`)
    return j
  } catch (err) {
    if (attempt > RETRIES) throw err
    const wait = 2 ** attempt * 1000
    await new Promise(r => setTimeout(r, wait))
    return post(body, attempt + 1)
  }
}

/** Insert in chunks, letting PostGIS read the GeoJSON. Existing ids are left alone, so a re-run is cheap. */
async function insert(client, features) {
  let written = 0
  for (let i = 0; i < features.length; i += INSERT_CHUNK) {
    const chunk = features.slice(i, i + INSERT_CHUNK)
    const cols = [[], [], [], [], [], [], [], [], [], []]
    for (const f of chunk) {
      const p = f.properties
      cols[0].push(p.OBJECTID)
      cols[1].push(p.BOSET_Class)
      cols[2].push(p.BV_Category)
      cols[3].push(epochDate(p.Date_Added))
      cols[4].push(epochDate(p.VerDate))
      cols[5].push(p.Date_Added_Display)
      cols[6].push(p.Area_GEO)
      cols[7].push(p.Shape_Length)
      cols[8].push(p.Shape_Area)
      cols[9].push(JSON.stringify(f.geometry))
    }
    const res = await client.query(`
      INSERT INTO ${TABLE} (objectid, boset_class, bv_category, date_added, ver_date,
                            date_added_display, area_geo, shape_length, shape_area, geom)
      SELECT objectid, boset_class, bv_category, date_added, ver_date,
             date_added_display, area_geo, shape_length, shape_area,
             ST_Multi(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(gj), 4283)))
      FROM unnest($1::int[], $2::text[], $3::text[], $4::date[], $5::date[], $6::text[],
                  $7::float8[], $8::float8[], $9::float8[], $10::text[])
        AS t(objectid, boset_class, bv_category, date_added, ver_date,
             date_added_display, area_geo, shape_length, shape_area, gj)
      ON CONFLICT (objectid) DO NOTHING`, cols)
    written += res.rowCount
  }
  return written
}

/** ArcGIS sends dates as epoch milliseconds; null stays null. */
function epochDate(ms) {
  return ms == null ? null : new Date(ms).toISOString().slice(0, 10)
}

/**
 * The table's own description, in the form build-esa-layers.mjs parses, so the catalogue picks up the
 * source, the service and the load date without anyone editing the registry.
 */
async function comment(client, classes, summary, report) {
  // the mix the TABLE holds, not the mix the service offers: a run over some classes must not describe
  // itself as if it had loaded the rest
  const held = await client.query(
    `SELECT boset_class, count(*)::int AS n FROM ${TABLE} GROUP BY 1 ORDER BY 2 DESC`)
  const mix = held.rows.map(c => `${c.boset_class} ${c.n.toLocaleString()}`).join('; ')
  const absent = classes.filter(c => !held.rows.some(h => h.boset_class === c.name))
  const short = report.filter(r => !r.ok)
  const text =
    'The NSW Biodiversity Values map: land where the Biodiversity Offsets Scheme is triggered. '
    + 'This is the OFFSETS SCHEME ENTRY map, not a list of clause 3.3 environmentally sensitive areas - of its ten '
    + 'BOSET_Class values only "Declared Area of Outstanding Biodiversity Value" (2 polygons) is a clause 3.3 item, '
    + 'and the rest carry no exempt or complying development consequence. Classes: '
    + `${mix}. ${Number(summary.vertices).toLocaleString()} vertices, of which the riparian class is about 82%; `
    + `${summary.invalid.toLocaleString()} invalid geometries, kept unrepaired. Map version ${String(summary.ver).slice(0, 10)}. `
    + (short.length ? `INCOMPLETE: ${short.map(r => `${r.name} ${r.got}/${r.expected}`).join(', ')}. ` : '')
    + (absent.length ? `NOT LOADED: ${absent.map(c => `${c.name} (${c.n.toLocaleString()})`).join(', ')}. ` : '')
    + `Source: Biodiversity Values at ${SERVICE}, ${Number(summary.rows).toLocaleString()} features reported by the `
    + `service, ${Number(summary.rows).toLocaleString()} written, fetched by objectIds class by class and reconciled `
    + `per class on ${new Date().toISOString().slice(0, 10)}.`

  await client.query(`COMMENT ON TABLE ${TABLE} IS $c$${text}$c$`)
  for (const [col, note] of Object.entries(COLUMN_NOTES)) {
    await client.query(`COMMENT ON COLUMN ${TABLE}.${col} IS $c$${note}$c$`)
  }
}

await main()
