/**
 * Build `esa.layers` - the catalogue of every layer /esa can draw, and where each one came from.
 *
 *   node scripts/build-esa-layers.mjs [--dry-run]
 *
 * WHY THIS EXISTS
 *
 * The esa schema already had two partial catalogues and no whole one. `esa.clause33_layers` says which
 * layer serves each paragraph of clause 3.3 and whether it reconciled, but not the service it came
 * from, when it was fetched, its SRID or its geometry type - those live in each table's COMMENT, in
 * prose. `esa.source_layers` lists the 19 services behind the plan additions, which is a different
 * question again. Neither describes `esa.additional_exceptions` itself. This table is the one place
 * that answers "where did this layer come from, when, and what does it do to a result" for all of them.
 *
 * It does not replace either: clause33_layers is still the registry this build reads, and source_layers
 * is still the record of what the exceptions notebook fetched. This is the view across both, with the
 * measured facts joined in.
 *
 * WHAT IS PARSED RATHER THAN RETYPED
 *
 * The table comments are already precise about provenance, in a regular form the loader wrote:
 *
 *   Source: <name> at <url>, N features reported by the service, N written, fetched by objectIds and
 *   reconciled feature by feature on YYYY-MM-DD.
 *   Copied YYYY-MM-DD from epi on planningai.
 *   Derived YYYY-MM-DD from esa.<table>; rebuild whenever that table is rebuilt.
 *
 * So source, source_url and loaded_at are read out of the comment instead of being typed again here -
 * one fewer copy to drift. Counts, SRIDs and geometry types are measured. Only the caveats that are not
 * already written down are curated below.
 *
 * Re-run after 07C, after the exceptions notebook, or after a tile build.
 */

import 'dotenv/config'
import pg from 'pg'
import { firstSentence, manifest, relationFacts, simpleGeomType, tableFacts, writeCatalogue } from './lib/layer-catalogue.mjs'

const DRY = process.argv.includes('--dry-run')
const TILE_BASE = process.env.NUXT_SEPP_PMTILES_BASE || 'http://172.105.184.178/pmtiles'

/** Registries and catalogues in the esa schema - records about layers, not layers. */
const NOT_LAYERS = {
  clause33_layers: 'the clause 3.3 registry this build reads',
  source_layers: 'the record of the services the exceptions notebook fetched',
  layers: 'this catalogue',
}

/**
 * The caveats that are not already in a comment or in the clause33 registry note. Everything else about
 * a layer is read from the database, so this list stays short on purpose.
 */
const CAVEATS = {
  crown_reserves: 'Clause 3.3(i) catches only reserves dedicated for environmental protection, so the purpose fields '
    + 'have to be read before this layer is treated as an exclusion - it is not an exclusion layer as it stands. '
    + 'Published in NSW Lambert and reprojected to GDA94 by the service on request.',
  ramsar_wetlands: 'All states, not just NSW: filter on the state field. Nobody publishes the 100 m proximity the '
    + 'paragraph needs, which is why esa.proximity_100m_ramsar is derived here.',
  world_heritage_areas: 'All states, not just NSW. NSW holds the Greater Blue Mountains, Gondwana Rainforests, '
    + 'Willandra Lakes, Lord Howe and the Australian Convict Sites.',
  marine_protected_areas: 'Marine parks and aquatic reserves are in one layer; the type field separates them.',
  npws_estate: 'The Planning Portal rendering of the estate, at parcel level. Two coarser cuts of the same estate '
    + 'exist (Tenure/NPWS_AllManagedLand, EDP/Estate); this one is used because it is the one a planner sees.',
  epi_biodiversity_significance: 'The terrestrial biodiversity maps plus the environmental conservation area maps. '
    + 'high_significance flags the classes whose wording says "high", for the narrow reading of paragraph (g) - the '
    + 'broad reading takes the whole layer, and the two differ by a lot. 431k polygons and 14,401 invalid geometries.',
  epi_environmentally_sensitive_land: 'One input to paragraph (g), not the whole of it: only a handful of plans draw '
    + 'an Environmentally Sensitive Land map.',
  epi_critical_habitat: 'Empty as expected - the layer exists in the EPI data model but no plan currently maps '
    + 'anything. An empty table here is not the same as "no critical habitat": see critical_habitat_register.',
  wilderness: 'Listed as a clause 3.3 item in the CDC rules block of 01A, but the paragraph letter has not been '
    + 'confirmed against the instrument, which is why paragraph is null.',
  biodiversity_stewardship_sites: 'The public view of the register. Several advisory items in '
    + 'esa.additional_exceptions name conservation agreements and biobanking sites with nothing to draw; this is the '
    + 'layer that can draw them. 53 invalid geometries.',
  additional_exceptions: 'An advisory item covers its WHOLE council area: it says the exception exists somewhere in '
    + 'that plan, never that a given lot is caught by it. A precise item whose source returned nothing also falls '
    + 'back to the plan area and is marked verify_required, so no item is silently lost. The geometry is whatever the '
    + 'source services returned on the day of the build, so a rebuild can change a shape. The services behind it are '
    + 'listed in esa.source_layers.',
}

/** What a paragraph of clause 3.3 is called in the panel. The letters are the instrument's own. */
const paragraphGroup = p => (p
  ? { key: `para-${p}`, title: `Clause 3.3, paragraph (${p})`, order: p.charCodeAt(0) - 96 }
  : { key: 'unassigned', title: 'Clause 3.3, paragraph not yet confirmed', order: 90 })

const ADDITIONS_GROUP = { key: 'additions', title: 'What local plans add', order: 95 }

const EXTRA_COLUMNS = [
  ['paragraph', 'text', 'The paragraph of clause 3.3 the layer answers, where it is settled.'],
  ['item', 'text', 'The item as clause 3.3 names it.'],
  ['verified', 'boolean', 'Whether the load reconciled against its source, feature by feature.'],
  ['source_count', 'bigint', 'Features the source reported, against which `features` reconciled.'],
  ['invalid_geoms', 'bigint', 'Invalid geometries in the load - repair before using the layer in a spatial test.'],
]

const TABLE_COMMENT =
  'One row per layer /esa can draw, and where it came from. half = \'clause33\' is the state-wide definition, '
  + 'which applies to every lot in NSW (built by "07C - ESA - clause 3.3 state-wide"); half = \'additions\' is '
  + 'what 30 local plans add on top (built by "07 - ESA - exceptions"). Confusing the two is the easy mistake, '
  + 'which is why they are a column rather than a note. source_kind \'none\' with kind \'gap\' means no dataset '
  + 'was found and the item has to be checked by hand - a lot can never be fully cleared against clause 3.3 while '
  + 'those exist. source_date is the currency of the DATA where the source publishes one; loaded_at is when we '
  + 'fetched it. Counts, SRIDs and geometry types are measured at build time. This is the view across '
  + 'esa.clause33_layers and esa.source_layers, not a replacement for either. Built by '
  + 'nsw-planning-library/scripts/build-esa-layers.mjs.'

async function main() {
  const dsn = (process.env.DATABASE_URL || '').trim()
  if (!dsn) { process.stderr.write('DATABASE_URL is not set.\n'); process.exit(1) }
  const client = new pg.Client({ connectionString: dsn, statement_timeout: 600_000 })
  await client.connect()
  const log = s => process.stdout.write(s + '\n')

  try {
    log('reading the tile manifests…')
    const [wideTiles, addTiles] = await Promise.all([
      manifest(TILE_BASE, 'esa-clause33.json'),
      manifest(TILE_BASE, 'esa-exceptions.json'),
    ])
    const drawn = new Map((wideTiles?.layers ?? []).map(l => [l.key, l]))

    log('measuring the esa schema…')
    const facts = await tableFacts(client, 'esa')
    const registry = await client.query(`
      SELECT key, paragraph, item, table_name, provenance, source, source_count, row_count,
             invalid_geoms, verified, note, built_at
      FROM esa.clause33_layers
      ORDER BY coalesce(paragraph, 'z'), item`)

    const checkedAt = new Date()
    const rows = []
    const catalogued = new Set()

    // ── the state-wide half: one row per registered clause 3.3 item ───────────────────────────────
    for (const r of registry.rows) {
      const short = r.table_name?.startsWith('esa.') ? r.table_name.slice(4) : null
      if (short) catalogued.add(short)
      // measured by the registry's own qualified name, so a view (esa.aobv) and a relation in another
      // schema (bio_values.biodiversityvalues) are measured like anything else rather than silently
      // reported as no dataset at all
      const f = r.table_name ? await relationFacts(client, r.table_name) : null
      const prov = parseComment(f?.comment)
      const t = drawn.get(r.key)
      const g = paragraphGroup(r.paragraph)

      rows.push({
        key: r.key,
        title: r.item,
        grp: g.key,
        grp_title: g.title,
        grp_order: g.order,
        half: 'clause33',
        kind: r.provenance === 'gap' ? 'gap' : (r.key === 'biodiversity_values' ? 'context' : 'exclusion'),
        role: r.item,
        clause: r.paragraph ? `Codes SEPP cl 3.3(${r.paragraph})` : 'Codes SEPP cl 3.3',
        table_name: r.table_name,
        // the registry's own word for where it came from - but nothing held is nothing loaded, whatever
        // the intent was, so an item with no table reads 'none' and carries no date
        source_kind: f ? r.provenance : 'none',
        source: prov.source ?? r.source,
        source_url: prov.url ?? (/^https?:/.test(r.source ?? '') ? r.source : null),
        filter: null,
        srid: f?.srid ?? null,
        geom_type: f?.geomType ?? simpleGeomType(t?.geometry),
        features: f?.features ?? null,
        vertices: t?.vertices ?? null,
        source_date: short ? await sourceDate(client, 'esa', short) : null,   // EPI copies only
        loaded_at: f ? (prov.date ?? (r.built_at ? isoDate(r.built_at) : null)) : null,
        tiled: Boolean(t?.tiled),
        archive: t?.tiled ? wideTiles.archive : null,
        min_zoom: t?.tiled ? t.minZoom : null,
        bbox: t?.bbox ?? null,
        categories: t?.categories?.length ? JSON.stringify(t.categories) : null,
        note: firstSentence(f?.comment) ?? r.item,
        caveat: CAVEATS[r.key] ?? blank(r.note) ?? restOfComment(f?.comment),
        checked_at: checkedAt,
        paragraph: r.paragraph,
        item: r.item,
        verified: r.verified,
        source_count: r.source_count,
        invalid_geoms: r.invalid_geoms,
      })
    }

    // ── the additions half: the exceptions layer itself ───────────────────────────────────────────
    const add = facts.get('additional_exceptions')
    if (add) {
      catalogued.add('additional_exceptions')
      const prov = parseComment(add.comment)
      const sources = await client.query(
        "SELECT count(*) FILTER (WHERE role = 'source')::int AS n FROM esa.source_layers")
      const tiers = await client.query(`
        SELECT count(*) FILTER (WHERE coverage_type = 'precise')::int AS precise,
               count(*) FILTER (WHERE coverage_type = 'advisory')::int AS advisory,
               count(*) FILTER (WHERE verify_required)::int AS verify,
               count(DISTINCT lep_name)::int AS leps
        FROM esa.additional_exceptions`)
      const s = tiers.rows[0]
      rows.push({
        key: 'additional_exceptions',
        title: 'Additional exceptions added by local plans',
        grp: ADDITIONS_GROUP.key,
        grp_title: ADDITIONS_GROUP.title,
        grp_order: ADDITIONS_GROUP.order,
        half: 'additions',
        kind: 'exclusion',
        role: `The items ${s.leps} local plans add to clause 3.3: ${s.precise} precise, ${s.advisory} advisory, `
          + `${s.verify} needing verification.`,
        clause: 'Codes SEPP cl 3.3 - what a local plan adds',
        table_name: 'esa.additional_exceptions',
        source_kind: 'notebook',
        source: `"07 - ESA - exceptions", from ${sources.rows[0].n} ePlanning and WaterNSW services (see esa.source_layers) `
          + 'clipped to each plan\'s LEP application area',
        source_url: null,
        filter: null,
        srid: add.srid,
        geom_type: add.geomType,
        features: add.features,
        vertices: null,
        source_date: null,
        loaded_at: prov.date,
        tiled: Boolean(addTiles),
        archive: addTiles?.archive ?? null,
        min_zoom: addTiles?.minZoom ?? null,
        bbox: null,
        categories: JSON.stringify([
          { name: 'precise', features: s.precise },
          { name: 'advisory', features: s.advisory },
        ]),
        note: firstSentence(add.comment),
        caveat: CAVEATS.additional_exceptions,
        checked_at: checkedAt,
        paragraph: null,
        item: 'Additional environmentally sensitive areas named by a local plan',
        verified: null,
        source_count: null,
        invalid_geoms: null,
      })
    }

    const missed = [...facts.keys()].filter(t => !catalogued.has(t) && !NOT_LAYERS[t])
    if (missed.length) process.stderr.write(`  esa tables in neither the registry nor this build: ${missed.join(', ')}\n`)
    for (const [t, why] of Object.entries(NOT_LAYERS)) {
      if (facts.has(t)) log(`  skipping esa.${t}: ${why}`)
    }

    if (DRY) {
      log(`\n--dry-run: ${rows.length} rows, nothing written.`)
      for (const r of rows) {
        log(`  ${(r.paragraph ? `(${r.paragraph})` : '   ').padEnd(4)} ${r.key.padEnd(40)} ${r.kind.padEnd(9)} `
          + `${String(r.source_kind).padEnd(10)} ${String(r.features ?? '—').padStart(7)} `
          + `${r.loaded_at ? String(r.loaded_at).slice(0, 10) : '—'} ${r.tiled ? 'tiled' : ''}`)
      }
      return
    }

    const n = await writeCatalogue(client, {
      schema: 'esa', comment: TABLE_COMMENT, extra: EXTRA_COLUMNS, rows,
    })
    log(`\nesa.layers: ${n} rows`)
    log(`  ${rows.filter(r => r.half === 'clause33').length} state-wide, ${rows.filter(r => r.half === 'additions').length} plan additions`)
    log(`  ${rows.filter(r => r.kind === 'gap').length} gaps, ${rows.filter(r => !r.tiled).length} not drawn, `
      + `${rows.filter(r => r.verified).length} reconciled against their source`)
  } finally {
    await client.end()
  }
}

/**
 * The currency of the data itself, from whichever date column the source publishes.
 *
 * currency_date is the EPI map's own version date. verdate is what the agency services carry, and comes
 * two ways - a real timestamp in the EPI copies, epoch milliseconds in text or bigint in the ArcGIS
 * downloads (esa.wilderness holds '1419984000000'). Anything else is left null rather than guessed at.
 */
async function sourceDate(client, schema, table) {
  const cols = await client.query(`
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = $1 AND c.relname = $2 AND a.attname IN ('currency_date', 'verdate')`, [schema, table])
  const by = Object.fromEntries(cols.rows.map(r => [r.attname, r.type]))

  let expr = null
  if (by.currency_date?.startsWith('timestamp')) expr = 'max(currency_date)::date'
  else if (by.verdate?.startsWith('timestamp')) expr = 'max(verdate)::date'
  else if (by.verdate && /text|character|bigint|numeric/.test(by.verdate)) {
    expr = "to_timestamp(max(nullif(verdate::text, ''))::bigint / 1000)::date"
  }
  if (!expr) return null
  try {
    const q = await client.query(`SELECT ${expr} AS d FROM ${schema}."${table}"`)
    return q.rows[0]?.d ?? null
  } catch {
    return null // an unexpected format is not worth failing the build over
  }
}

/**
 * Provenance out of a table COMMENT, in the three forms the loaders write. Returns whatever it finds and
 * nulls for the rest; a comment in none of these forms simply yields nothing rather than a wrong guess.
 */
function parseComment(comment) {
  const c = String(comment ?? '')
  const src = c.match(/Source:\s*(.+?)\s+at\s+(https?:\/\/\S+?),/s)
  const fetched = c.match(/on (\d{4}-\d{2}-\d{2})\.\s*$/)
  if (src) return { source: src[1], url: src[2], date: fetched?.[1] ?? null }

  const copied = c.match(/Copied (\d{4}-\d{2}-\d{2}) from (\S+?) on planningai/)
  if (copied) return { source: `planningai ${copied[2]} schema (GEODAAS All-EPI geodatabase)`, url: null, date: copied[1] }

  const derived = c.match(/Derived (\d{4}-\d{2}-\d{2}) from ([\w.]+)/)
  if (derived) return { source: `derived from ${derived[2]}`, url: null, date: derived[1] }

  const built = c.match(/copied here (\d{4}-\d{2}-\d{2})/)
  if (built) return { source: null, url: null, date: built[1] }

  return { source: null, url: null, date: null }
}

/** The comment after its first sentence, with the provenance sentence dropped - what is left is caveat. */
function restOfComment(comment) {
  if (!comment) return null
  const first = firstSentence(comment)
  const rest = String(comment).slice(first.length)
    .replace(/Source:.*$/s, '')
    .replace(/Copied \d{4}-\d{2}-\d{2} from \S+ on planningai\./, '')
    .replace(/Derived \d{4}-\d{2}-\d{2} from [\w.]+;?/, '')
    .trim()
  return rest || null
}

const blank = s => (s && String(s).trim() ? String(s).trim() : null)
const isoDate = d => new Date(d).toISOString().slice(0, 10)

await main()
