/**
 * Draw six clause 3.3 exception items from the `epi` schema instead of the ePlanning REST services.
 *
 * WHY
 *
 * "07 - ESA - exceptions" fetches each item's geometry from ePlanning by layer NAME, filtered on
 * EPI_NAME. When the name or the filter misses, the item falls back to the whole plan area - which is
 * how Wentworth (ja) came to cover 26,241 km2 and Hilltops (ja) 7,142 km2. But planningai already holds
 * the entire EPI map library in `epi`, loaded by 01A, so the right question was never "which service"
 * but "which epi table holds this layer for this LEP".
 *
 * Every item below was checked against the LEP's own clause 3.3(2) in Notebooks/pdf/<epi_code>.pdf,
 * because the clause - not the workbook and not the layer name - is what the item has to match.
 *
 * SAFETY. The script refuses if a source query returns no rows: replacing a whole-LGA fallback with an
 * empty geometry would turn a visible over-reach into a silent under-reach, which is worse. It is
 * idempotent - each run recomputes from epi and overwrites - so it can be re-run after 07 rebuilds the
 * table from its manifest and undoes all of this.
 *
 * AFTERWARDS. The tiles are built from this table, so re-run scripts/build-esa-pmtiles.py or the map
 * will keep drawing the old whole-LGA polygons.
 *
 * Usage:  node scripts/fix-esa-epi-sources.mjs [--dry-run]
 */
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')

/**
 * One correction. `where` is ANDed onto `epi_name = <the plan>`, and is the part that carries the
 * clause's own words - a class filter here is the difference between the foreshore area and the line
 * that bounds it.
 */
const FIXES = [
  {
    epiCode: 'epi-2022-0874',
    ref: '(ja)',
    lepName: 'Hilltops Local Environmental Plan 2022',
    lgaName: 'HILLTOPS',
    table: 'epi_riparian_lands_watercourses',
    where: null,
    label: 'epi.epi_riparian_lands_watercourses',
    verify: false,
    note: 'Drawn from the Riparian Land and Watercourses Map as held in planningai.epi, filtered to '
      + 'this plan. The clause names that map exactly. Replaces a whole-LGA fallback: the ePlanning '
      + 'service returned nothing for this plan.',
  },
  {
    epiCode: 'epi-2011-0680',
    ref: '(jb)',
    lepName: 'Kiama Local Environmental Plan 2011',
    lgaName: 'KIAMA',
    table: 'epi_foreshore_building_line',
    where: "lay_class = 'Land Below Foreshore Building Line'",
    label: 'epi.epi_foreshore_building_line',
    verify: false,
    note: 'The clause excludes "land in the foreshore area", and the LEP dictionary defines that as '
      + 'the land between the foreshore building line and the mean high water mark - which is the '
      + '"Land Below Foreshore Building Line" class of this layer. The "Foreshore Building Line" class '
      + 'is the line itself and is deliberately excluded.',
  },
  {
    epiCode: 'epi-2011-0680',
    ref: '(jd)',
    lepName: 'Kiama Local Environmental Plan 2011',
    lgaName: 'KIAMA',
    table: 'epi_riparian_lands_watercourses',
    where: null,
    label: 'epi.epi_riparian_lands_watercourses',
    verify: true,
    insert: true,
    text: 'land to which clause 6.5 applies',
    note: 'NEW ITEM - the manifest never carried it. Kiama clause 6.5 is "Riparian land and '
      + 'watercourses" and applies to Category 1, 2 and 3 watercourses on the Riparian Land and '
      + 'Watercourses Map. The map is drawn here; the clause ALSO reaches 40m, 20m and 10m from the '
      + 'top of the bank for the three categories, which this geometry does not add.',
  },
  {
    epiCode: 'epi-2010-0540',
    ref: '(jb)',
    lepName: 'Penrith Local Environmental Plan 2010',
    lgaName: 'PENRITH',
    table: 'epi_terrestrial_biodiversity',
    where: "lay_class = 'Sensitive Land'",
    label: 'epi.epi_terrestrial_biodiversity',
    verify: false,
    note: 'The Natural Resources Sensitivity Land Map is not in epi_local_provisions - ePlanning files '
      + 'natural-resource-sensitivity maps under the Terrestrial Biodiversity theme. These are '
      + 'Penrith’s rows there, class "Sensitive Land".',
  },
  {
    epiCode: 'epi-2011-0684',
    ref: '(ja)',
    lepName: 'Wentworth Local Environmental Plan 2011',
    lgaName: 'WENTWORTH',
    table: 'epi_local_provisions',
    where: "lay_name = 'River Front Building Line'",
    label: 'epi.epi_local_provisions',
    verify: true,
    note: 'PARTIAL. The clause is "land to which clause 7.6 or 7.8 apply". This is the River Front '
      + 'Building Line (Indicative) from local provisions, which stands in for the river front area of '
      + 'clause 7.6. Clause 7.8 - the bed and banks of the Murray River - is not mapped anywhere and is '
      + 'not included, so this geometry is narrower than the clause.',
  },
  {
    epiCode: 'epi-2010-0076',
    ref: '(ja)',
    lepName: 'Wollongong Local Environmental Plan 2009',
    lgaName: 'WOLLONGONG',
    table: 'epi_terrestrial_biodiversity',
    where: null,
    label: 'epi.epi_terrestrial_biodiversity',
    verify: true,
    note: 'PROXY, at Manni’s direction. The clause excludes land "identified as containing an '
      + 'endangered ecological community" under the Fisheries Management Act 1994 or the Threatened '
      + 'Species Conservation Act 1995 - a register, not a map. This is the council’s Terrestrial '
      + 'Biodiversity Map (class "Natural resource sensitivity - biodiversity") used as the nearest '
      + 'mapped stand-in. It is not the register, so it may both over- and under-cover; the item stays '
      + 'flagged for checking.',
  },
]

const SOURCE_TABLES = [...new Set(FIXES.map(f => f.label))]

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
  const db = new pg.Client({ connectionString: dsn, statement_timeout: 600_000 })
  await db.connect()

  try {
    // measure first, change nothing: a source that comes back empty aborts the whole run
    const plans = []
    for (const f of FIXES) {
      const where = ['epi_name = $1', f.where].filter(Boolean).join(' AND ')
      const { rows: [src] } = await db.query(
        `SELECT count(*)::int AS n,
                round((ST_Area(ST_Union(geom)::geography) / 1e6)::numeric, 2) AS km2
           FROM epi.${f.table} WHERE ${where}`, [f.lepName])
      const { rows: [before] } = await db.query(
        `SELECT coverage_type, round(area_km2::numeric, 1) AS km2, source_layers
           FROM esa.additional_exceptions WHERE epi_code = $1 AND ref = $2`, [f.epiCode, f.ref])
      plans.push({ f, src, before })

      const was = before
        ? `${before.coverage_type} ${before.km2} km2 [${before.source_layers || 'no layer'}]`
        : 'NOT IN TABLE'
      process.stdout.write(
        `${f.lgaName.padEnd(11)} ${f.ref.padEnd(7)} ${String(src.n).padStart(5)} feats `
        + `${String(src.km2).padStart(9)} km2   was: ${was}\n`)

      if (!src.n) throw new Error(`${f.lgaName} ${f.ref}: epi.${f.table} returned 0 rows - refusing`)
      if (!before && !f.insert) throw new Error(`${f.lgaName} ${f.ref}: no such row, and not marked insert`)
      if (before && f.insert) process.stdout.write(`            (row already present; updating in place)\n`)
    }

    if (DRY) { process.stdout.write('\n--dry-run: nothing written\n'); return }

    await db.query('BEGIN')
    for (const { f } of plans) {
      const where = ['epi_name = $1', f.where].filter(Boolean).join(' AND ')
      // ST_Multi(ST_MakeValid(...)) because a union of adjoining map polygons can self-touch
      const geom = `(SELECT ST_Multi(ST_MakeValid(ST_Transform(ST_Union(geom), 4326)))
                       FROM epi.${f.table} WHERE ${where})`
      const nFeat = `(SELECT count(*) FROM epi.${f.table} WHERE ${where})`

      const exists = await db.query(
        'SELECT 1 FROM esa.additional_exceptions WHERE epi_code = $1 AND ref = $2', [f.epiCode, f.ref])

      if (exists.rowCount) {
        await db.query(
          `UPDATE esa.additional_exceptions
              SET geometry = ${geom}, n_source_features = ${nFeat},
                  coverage_type = 'precise', status = 'layer_found',
                  verify_required = $4, source_layers = $5, attribute_filter = $6, source_note = $7,
                  source_services = ARRAY['planningai ${f.table}'], source_endpoints = NULL,
                  area_km2 = ST_Area(${geom}::geography) / 1e6
            WHERE epi_code = $2 AND ref = $3`,
          [f.lepName, f.epiCode, f.ref, f.verify, f.label, f.where, f.note])
      } else {
        await db.query(
          `INSERT INTO esa.additional_exceptions
             (id, epi_code, lep_name, lga_name, ref, exception_text, status, coverage_type,
              attribute_filter, verify_required, source_layers, n_source_features, geometry,
              area_km2, source_services, source_note)
           SELECT (SELECT max(id) + 1 FROM esa.additional_exceptions),
                  $2, $1, $8, $3, $9, 'layer_found', 'precise',
                  $6, $4, $5, ${nFeat}, ${geom},
                  ST_Area(${geom}::geography) / 1e6, ARRAY['planningai ${f.table}'], $7`,
          [f.lepName, f.epiCode, f.ref, f.verify, f.label, f.where, f.note, f.lgaName, f.text])
      }
    }

    // the catalogue the page filters by; counts recomputed so they cannot drift from the items
    for (const label of SOURCE_TABLES) {
      // delete-then-insert rather than ON CONFLICT: the table carries no unique key on layer_name,
      // so a plain upsert would quietly duplicate the row on the second run
      await db.query('DELETE FROM esa.source_layers WHERE layer_name = $1', [label])
      await db.query(
        `INSERT INTO esa.source_layers (layer_name, role, service, endpoint, items, leps)
         SELECT $1, 'source', $2, 'planningai', count(*)::int, count(DISTINCT epi_code)::int
           FROM esa.additional_exceptions WHERE source_layers = $1`,
        [label, `${label.replace('epi.', '')} - epi schema, loaded by 01A from the GEODAAS data dump`])
    }
    await db.query('COMMIT')

    process.stdout.write('\nafter:\n')
    const { rows } = await db.query(
      `SELECT lga_name, ref, coverage_type, n_source_features::int AS n,
              round(area_km2::numeric, 2) AS km2, verify_required
         FROM esa.additional_exceptions
        WHERE (epi_code, ref) IN (${FIXES.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})
        ORDER BY lga_name, ref`, FIXES.flatMap(f => [f.epiCode, f.ref]))
    for (const r of rows) {
      process.stdout.write(
        `  ${r.lga_name.padEnd(11)} ${r.ref.padEnd(7)} ${r.coverage_type.padEnd(9)} `
        + `${String(r.n).padStart(5)} feats ${String(r.km2).padStart(9)} km2`
        + `${r.verify_required ? '  (verify)' : ''}\n`)
    }
    const { rows: [tot] } = await db.query(
      `SELECT count(*)::int AS items,
              count(*) FILTER (WHERE coverage_type = 'precise')::int AS precise
         FROM esa.additional_exceptions`)
    process.stdout.write(`\n${tot.items} items, ${tot.precise} precise. Re-run build-esa-pmtiles.py for the map.\n`)
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {})
    process.stderr.write(`\nFAILED: ${e.message}\nnothing was written.\n`)
    process.exitCode = 1
  } finally {
    await db.end()
  }
}

main()
