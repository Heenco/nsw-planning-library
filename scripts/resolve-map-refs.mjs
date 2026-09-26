/**
 * Resolve rule_spatial_ref map references to geometry.
 *
 * WHY. A clause scopes itself with a map far more often than with a zone — in Parramatta half its
 * clauses do — and until the label becomes a polygon, none of those clauses can be tested against a
 * lot. They are the largest untestable group in the graph: 35 refs, 0 resolved, and they include
 * cl 4.3 and cl 4.4A, the height and floor space ratio bands.
 *
 * THE JOIN. Not legis_ref_area, which looks like the right column and is null in 2,485 of 2,486
 * Parramatta height rows. The labels live in `label` / `sym_code`, and the map is `map_name` — one
 * epi table holds many maps (epi_local_provisions carries 11 for Parramatta alone, including the
 * Dual Occupancy Prohibition Map's 576 polygons). So the match is
 *
 *     epi_name ~ the plan   AND   map_name ~ the ref's map_layer   AND   label|sym_code = the value
 *
 * WHY THE PAIR MATTERS. "Area 1" in Parramatta resolves to the Additional Local Provisions Map (33
 * polygons), the Affordable Housing Map (1) and the Key Sites Map (1) — three different places. A
 * label on its own is not a location, which is why the extractor now records the map with it and why
 * this refuses to guess when the map is missing.
 *
 * CONFIDENCE. Recorded per ref, not assumed:
 *   1.00  map_name and label both matched, in one layer
 *   0.60  label matched in exactly one layer but the map_name did not agree
 *   null  no match, or matched in several layers — left unresolved rather than picked arbitrarily
 *
 * Usage:  node scripts/resolve-map-refs.mjs [--lep <slug fragment>] [--dry-run]
 */
import 'dotenv/config'
import pg from 'pg'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const LEP = args.includes('--lep') ? args[args.indexOf('--lep') + 1] : null

// The epi tables that carry labelled areas. epi_local_provisions is first because it holds the most
// maps; the search stops at the first table that gives an unambiguous answer for the pair.
const LAYER_TABLES = [
  'epi_local_provisions',
  'epi_key_sites',
  'epi_height_of_building',
  'epi_floor_space_ratio',
  'epi_lot_size',
  'epi_heritage',
  'epi_special_provision',
  'epi_active_street_frontages',
  'epi_additional_permitted_uses',
  'epi_urban_release_area',
  'epi_terrestrial_biodiversity',
  'epi_foreshore_building_line',
]

/** "Height of Buildings Map" and "Height of Buildings" are the same map. */
const normMap = s => String(s ?? '').toLowerCase().replace(/\bmaps?\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query("SET statement_timeout='300s'")

  const { rows: refs } = await client.query(
    `SELECT sr.id, sr.clause, sr.value, sr.map_layer, sr.ref_type, d.instrument_slug, d.lga_name
       FROM nsw.rule_spatial_ref sr
       JOIN nsw.document d ON d.id = sr.document_id
      WHERE sr.geom IS NULL
        AND sr.value IS NOT NULL
        AND ($1::text IS NULL OR d.instrument_slug ILIKE '%' || $1 || '%')
      ORDER BY d.instrument_slug, sr.ref_type, sr.map_layer, sr.value`,
    [LEP],
  )
  console.log(`${refs.length} unresolved spatial refs${LEP ? ` for ${LEP}` : ''}\n`)

  let exact = 0, weak = 0, ambiguous = 0, none = 0, noMap = 0

  let addrOk = 0, addrMiss = 0

  for (const ref of refs) {
    // A street address read from a clause heading resolves against the address points, not a map.
    // "5 Aird Street" is stored without its suburb, so it is matched as a prefix within the
    // council — which is why the LGA filter matters: "1 Church Street" exists in many of them.
    if (ref.ref_type === 'address') {
      const q = String(ref.value).replace(/\s+/g, ' ').trim().toUpperCase()
      const r = await client.query(
        `SELECT count(*)::int n FROM derived.lot_address a
          WHERE upper(a.address) LIKE $1 || '%'`, [q])
      if (!r.rows[0].n) {
        addrMiss++
        console.log(`  no address     cl ${ref.clause}  ${JSON.stringify(ref.value)}`)
        continue
      }
      addrOk++
      if (DRY) {
        console.log(`  address        cl ${ref.clause}  ${JSON.stringify(ref.value)} -> ${r.rows[0].n} lots`)
        continue
      }
      await client.query(
        `UPDATE nsw.rule_spatial_ref
            SET geom = (SELECT ST_Multi(ST_Union(ST_Transform(l.geom, 4326)))
                          FROM derived.lot_address a
                          JOIN cadastre.lot l ON l.cadid = a.cadid
                         WHERE upper(a.address) LIKE $2 || '%'),
                geom_source = 'derived.lot_address',
                match_confidence = CASE WHEN $3::int = 1 THEN 1.0 ELSE 0.8 END
          WHERE id = $1`,
        [ref.id, q, r.rows[0].n],
      )
      continue
    }

    if (!ref.map_layer) {
      // Without a map the label is not a location. Guessing here is how "Area 1" ends up pointing
      // at whichever layer happened to be searched first.
      noMap++
      console.log(`  no map_layer   cl ${ref.clause}  ${JSON.stringify(ref.value)}`)
      continue
    }

    const hits = []
    for (const t of LAYER_TABLES) {
      let r
      try {
        r = await client.query(
          `SELECT map_name, count(*)::int n
             FROM epi."${t}"
            WHERE epi_name ILIKE '%' || $1 || '%'
              AND (lower(btrim(coalesce(label,''))) = lower(btrim($2))
                OR lower(btrim(coalesce(sym_code,''))) = lower(btrim($2)))
            GROUP BY 1`,
          [ref.lga_name ?? '', ref.value],
        )
      } catch {
        continue                              // layer without these columns; not every epi table has them
      }
      for (const row of r.rows) hits.push({ table: t, map_name: row.map_name, n: row.n })
    }

    if (!hits.length) {
      // Worth printing rather than counting. Some are real gaps (a map the epi export does not
      // label), others are bad extractions — a `value` of "Heritage Map" is the map name in the
      // label's place, and no amount of resolving fixes that.
      none++
      console.log(`  no match       cl ${ref.clause}  ${JSON.stringify(ref.value)} on "${ref.map_layer}"`)
      continue
    }

    const want = normMap(ref.map_layer)
    const onMap = hits.filter(h => {
      const got = normMap(h.map_name)
      return got === want || got.includes(want) || want.includes(got)
    })

    let pick = null, conf = null
    if (onMap.length === 1) { pick = onMap[0]; conf = 1.0 }
    else if (onMap.length > 1) {
      // Same label on the same map in two tables: take the one with polygons, if only one has any.
      const withRows = onMap.filter(h => h.n > 0)
      if (withRows.length === 1) { pick = withRows[0]; conf = 1.0 }
    } else if (hits.length === 1) { pick = hits[0]; conf = 0.6 }

    if (!pick) {
      ambiguous++
      console.log(`  ambiguous      cl ${ref.clause}  ${JSON.stringify(ref.value)} on `
        + `"${ref.map_layer}" -> ` + hits.map(h => `${h.map_name} x${h.n}`).join(' | '))
      continue
    }

    if (conf === 1.0) exact++; else weak++
    if (DRY) {
      console.log(`  ${conf === 1 ? 'exact' : 'weak '}          cl ${ref.clause}  `
        + `${JSON.stringify(ref.value)} -> ${pick.table}/${pick.map_name} x${pick.n}`)
      continue
    }

    // One geometry per ref: the union of every polygon carrying that label on that map. A clause
    // that names "Area 1" means all of Area 1, which is 33 polygons here, not one of them.
    await client.query(
      // ST_Transform on the RESULT, not in a predicate. The epi layers are GDA94 (4283) and this
      // column is declared 4326, so an untransformed union is rejected outright.
      `UPDATE nsw.rule_spatial_ref
          SET geom = (SELECT ST_Multi(ST_Transform(ST_Union(e.geom), 4326))
                        FROM epi."${pick.table}" e
                       WHERE e.epi_name ILIKE '%' || $2 || '%'
                         AND e.map_name = $3
                         AND (lower(btrim(coalesce(e.label,''))) = lower(btrim($4))
                           OR lower(btrim(coalesce(e.sym_code,''))) = lower(btrim($4)))),
              geom_source = $5,
              match_confidence = $6
        WHERE id = $1`,
      [ref.id, ref.lga_name ?? '', pick.map_name, ref.value, `epi.${pick.table}`, conf],
    )
  }

  const { rows: [after] } = await client.query(
    `SELECT count(*)::int n, count(geom)::int g FROM nsw.rule_spatial_ref
      WHERE ($1::text IS NULL OR document_id IN
             (SELECT id FROM nsw.document WHERE instrument_slug ILIKE '%' || $1 || '%'))`,
    [LEP],
  )
  console.log(`\n  exact ${exact}   weak ${weak}   ambiguous ${ambiguous}   `
    + `no match ${none}   no map_layer ${noMap}`)
  console.log(`  ${after.g}/${after.n} refs now carry geometry${DRY ? '  (dry run — nothing written)' : ''}`)
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
