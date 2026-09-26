/**
 * Seed nsw.scope_layer, and MEASURE every mapping rather than trusting it.
 *
 * WHY MEASURE. cdc.layers earns its keep because `features` is counted at seed time, so a mapping
 * that names a table with no rows shows up as broken instead of looking fine. The same applies here
 * and more so: these mappings decide whether a clause reaches a lot, and one pointing at an empty
 * relation turns "this land is flood prone" into "this clause does not apply" — wrong in the
 * direction that costs someone money.
 *
 * WHAT THE MAPPINGS ARE. Every term the extractor has actually produced, plus the ones the corpus
 * survey says are coming. A term with nothing behind it gets source_kind 'none' and a note saying
 * what was looked for, because a recorded gap can be counted and an unrecorded one cannot.
 *
 * `bushfire` is the case that makes the point: there is no epi bush fire table — it is RFS data, and
 * the copy this app holds is lmr.layers/bush_fire_prone_land. A mapping straight to `epi` would have
 * measured zero and been quietly wrong.
 *
 * Usage:  node scripts/seed-scope-layers.mjs [--dry-run]
 */
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry-run')

/** dimension, term, title, source_kind, source, filter, test, kind, note */
const MAP = [
  // ── land characteristics ───────────────────────────────────────────────────────────────────
  ['land_characteristic', 'flood', 'Flood planning area', 'table', 'epi.epi_flood', null,
    'intersects', 'condition', null],
  ['land_characteristic', 'bushfire', 'Bush fire prone land', 'registry', 'lmr.layers:bushfire_prone_land',
    null, 'intersects', 'condition',
    'No epi table: bush fire prone land is RFS data, held here via the LMR load.'],
  ['land_characteristic', 'acid_sulfate', 'Acid sulfate soils', 'table', 'epi.epi_acid_sulfate_soils',
    null, 'intersects', 'condition', null],
  ['land_characteristic', 'salinity', 'Salinity', 'table', 'epi.epi_salinity', null,
    'intersects', 'condition', null],
  ['land_characteristic', 'biodiversity', 'Terrestrial biodiversity', 'table',
    'epi.epi_terrestrial_biodiversity', null, 'intersects', 'condition', null],
  ['land_characteristic', 'slope', 'Landslide risk', 'table', 'epi.epi_landslide_risk', null,
    'intersects', 'condition',
    'Landslide risk is the mapped proxy. derived.lot_slope holds a measured gradient per lot and is '
    + 'the better answer where a clause states a percentage rather than naming a map.'],
  ['land_characteristic', 'landslide', 'Landslide risk', 'table', 'epi.epi_landslide_risk', null,
    'intersects', 'condition', null],
  ['land_characteristic', 'groundwater', 'Groundwater vulnerability', 'table',
    'epi.epi_groundwater_vulnerability', null, 'intersects', 'condition', null],
  ['land_characteristic', 'coastal', 'Coastal wetlands and vulnerability', 'registry',
    'lmr.layers:sepp_coastal_wetlands', null, 'intersects', 'condition',
    'The Resilience and Hazards SEPP coastal layers; epi has no coastal table of its own.'],
  ['land_characteristic', 'wetland', 'Wetlands', 'table', 'epi.epi_wetlands', null,
    'intersects', 'condition', null],
  ['land_characteristic', 'watercourse', 'Riparian land and watercourses', 'table',
    'epi.epi_riparian_lands_watercourses', null, 'intersects', 'condition', null],
  ['land_characteristic', 'hydrological', 'Riparian land and watercourses', 'table',
    'epi.epi_riparian_lands_watercourses', null, 'intersects', 'condition',
    'The model\'s word for the riparian and watercourse clauses.'],
  ['land_characteristic', 'heritage', 'Heritage item or conservation area', 'table',
    'epi.epi_heritage', null, 'intersects', 'condition', null],
  ['land_characteristic', 'airport', 'Aircraft noise and obstacle limitation', 'table',
    'epi.epi_obstacle_limitation_surface', null, 'intersects', 'condition',
    'Two layers answer this: epi_obstacle_limitation_surface for height, '
    + 'epi_noise_exposure_forecast for ANEF. The height one is tested because that is what the '
    + 'LEP clauses turn on.'],
  ['land_characteristic', 'contamination', 'Contaminated land', 'none', null, null,
    'intersects', 'condition',
    'No contaminated land layer in epi, lmr or cdc. The register is held by councils and the EPA '
    + 'and is not in any dataset this app loads.'],
  ['land_characteristic', 'subsidence', 'Mine subsidence district', 'none', null, null,
    'intersects', 'condition',
    'Mine subsidence districts are Subsidence Advisory NSW data; not loaded.'],
  ['land_characteristic', 'environmentally sensitive', 'Environmentally sensitive land', 'table',
    'epi.epi_environmentally_sensitive_land', null, 'intersects', 'condition', null],
  ['land_characteristic', 'mean high water mark', 'Mean high water mark', 'none', null, null,
    'intersects', 'condition',
    'A tidal boundary, not a planning layer. Would come from the cadastre\'s water boundary or a '
    + 'hydro line, neither of which is loaded as a testable polygon.'],

  // ── the one that is computed, not looked up ────────────────────────────────────────────────
  ['land_characteristic', '2 street frontages', 'Two or more street frontages', 'derived',
    'derived.lot_frontage_run', null, 'derived', 'condition',
    'Not a planning layer and nobody publishes one. This build already measures every frontage run '
    + 'per lot, so a corner lot is a count of distinct road frontages. Parramatta cl 6.11 prohibits '
    + 'dual occupancies on land with two street frontages, and it is undecidable without this.'],

  // ── tenure ─────────────────────────────────────────────────────────────────────────────────
  ['tenure', 'strata', 'Strata title', 'derived', 'cadastre.lot', "lotidstring ILIKE '%//SP%'",
    'derived', 'condition',
    'A strata lot is a //SP lot id in the cadastre; there is no separate tenure layer.'],
  ['tenure', 'common_property', 'Common property', 'derived', 'cadastre.lot',
    "lotidstring ILIKE '%//SP%'", 'derived', 'condition',
    'Common property sits inside a strata plan; the cadastre has one polygon per strata lot and '
    + 'does not separate the common property parcel.'],
  ['tenure', 'community_title', 'Community title', 'none', null, null, 'derived', 'condition',
    'Community title schemes are DP-numbered like Torrens in the cadastre, so the lot id cannot '
    + 'distinguish them. Would need the plan type from the LRS.'],
  ['tenure', 'public_land_operational', 'Operational land', 'table', 'epi.epi_land_reclassification',
    null, 'intersects', 'condition',
    'The reclassification map carries the operational/community classification.'],
  ['tenure', 'public_land_community', 'Community land', 'table', 'epi.epi_land_reclassification',
    null, 'intersects', 'condition', null],

  // ── adjacency ──────────────────────────────────────────────────────────────────────────────
  ['adjacency', 'adjoins', 'Adjoins named land', 'none', null, null, 'derived', 'condition',
    'Needs the neighbouring parcels and what they are, which nothing computes. The cadastre can '
    + 'supply the neighbours cheaply (ST_Touches on the lot); what they must adjoin is the part '
    + 'that varies per clause.'],
  ['adjacency', 'abuts', 'Abuts named land', 'none', null, null, 'derived', 'condition',
    'As adjoins.'],
  ['adjacency', 'opposite', 'Immediately opposite', 'none', null, null, 'derived', 'condition',
    'Needs the road reserve between two parcels, not just adjacency.'],
  ['adjacency', 'zone_boundary', 'Within a distance of a zone boundary', 'derived',
    'epi.epi_land_zoning', null, 'derived', 'condition',
    'Standard Instrument cl 5.3, in 112 of the 146 plans. Computable now: the distance from the lot '
    + 'to the nearest edge of a differently-zoned polygon.'],

  // ── site references ────────────────────────────────────────────────────────────────────────
  ['site_ref', 'lot_dp', 'Lot and deposited plan', 'derived', 'cadastre.lot', null,
    'derived', 'condition',
    'A "Lot 10, DP 1228279" reference resolves against cadastre.lot.lotidstring. '
    + 'rule_spatial_ref already does this for the pilot LEPs: 38 of 52 resolved.'],
  ['site_ref', 'address', 'Street address', 'derived', 'derived.lot_address', null,
    'derived', 'condition',
    'Resolves via the address point; 27 of 31 resolved on the pilot LEPs.'],
]

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  await c.query("SET statement_timeout='300s'")

  let ok = 0, empty = 0, none = 0, broken = 0

  for (const [dimension, term, title, source_kind, source, filter, test, kind, note] of MAP) {
    let features = null
    let realKind = source_kind
    let realNote = note

    if (source_kind === 'table' || (source_kind === 'derived' && source && !source.includes(':'))) {
      const [schema, table] = String(source).split('.')
      try {
        const sql = `SELECT count(*)::bigint n FROM "${schema}"."${table}"`
          + (filter ? ` WHERE ${filter}` : '')
        features = Number((await c.query(sql)).rows[0].n)
      } catch (e) {
        // A mapping that names a relation which does not exist is worse than no mapping: it reads
        // as answered. Demote it rather than storing a promise nothing can keep.
        realKind = 'none'
        realNote = `${note ? note + ' ' : ''}[relation ${source} could not be read: ${e.message.slice(0, 80)}]`
        broken++
      }
    } else if (source_kind === 'registry') {
      const [schema, rest] = String(source).split('.')
      const key = rest.split(':')[1]
      try {
        const r = await c.query(`SELECT source, filter, features FROM ${schema}.layers WHERE key = $1`, [key])
        if (!r.rows.length) {
          realKind = 'none'
          realNote = `${note ? note + ' ' : ''}[no ${schema}.layers row with key '${key}']`
          broken++
        } else {
          features = r.rows[0].features == null ? null : Number(r.rows[0].features)
        }
      } catch (e) {
        realKind = 'none'
        realNote = `${note ? note + ' ' : ''}[${schema}.layers unreadable]`
        broken++
      }
    }

    if (realKind === 'none') none++
    else if (features === 0) { empty++ }
    else ok++

    const flag = realKind === 'none' ? 'none ' : features === 0 ? 'EMPTY' : features == null ? '  ?  ' : ' ok  '
    console.log(`  ${flag} ${dimension.slice(0, 19).padEnd(20)} ${term.slice(0, 26).padEnd(28)}`
      + `${features == null ? '' : features.toLocaleString().padStart(9)}  ${source ?? ''}`)

    if (DRY) continue
    await c.query(
      `INSERT INTO nsw.scope_layer
         (dimension, term, title, source_kind, source, filter, test, column_tested, kind, note,
          features, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10, now())
       ON CONFLICT (dimension, term) DO UPDATE SET
         title = EXCLUDED.title, source_kind = EXCLUDED.source_kind, source = EXCLUDED.source,
         filter = EXCLUDED.filter, test = EXCLUDED.test, kind = EXCLUDED.kind,
         note = EXCLUDED.note, features = EXCLUDED.features, checked_at = now()`,
      [dimension, term, title, realKind, realKind === 'none' ? null : source, filter, test, kind,
       realNote, features],
    )
  }

  console.log(`\n  ${ok} mapped and non-empty   ${empty} mapped but EMPTY   ${none} no layer`
    + `${broken ? `   (${broken} demoted: relation missing)` : ''}`)

  if (!DRY) {
    const { rows } = await c.query(
      `SELECT dimension, term, rules, documents, source_kind FROM nsw.scope_layer_gap LIMIT 12`)
    console.log(`\n  terms still blocking rules (nsw.scope_layer_gap):`)
    if (!rows.length) console.log('    (none)')
    for (const r of rows) {
      console.log(`    ${String(r.rules).padStart(3)} rules  ${r.dimension}/${r.term}`
        + `  ${r.source_kind ?? 'UNMAPPED'}`)
    }
  }
  await c.end()
}

main().catch(e => { console.error(e); process.exit(1) })
