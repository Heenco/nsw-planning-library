/**
 * The shape of a layer catalogue, and how one is written.
 *
 * `cdc.layers` is the precedent: one row per layer the page can draw, saying where the layer came from
 * and what it is for, so the page never has to carry a second copy of the list in TypeScript. The lmr and
 * esa schemas had no such table - a constraint layer was described only by its table's COMMENT, and the
 * 37 SEPP land application layers on /lmr were described nowhere in the database at all. This module
 * builds the same catalogue for both, with the same columns, so the two read alike.
 *
 * THREE SOURCES, MERGED ON THE KEY
 *
 *   registry   the curated half: what the layer is for, which provision it serves, where it was fetched
 *              from and when, and the caveat worth knowing before trusting it. Hand-written, because
 *              none of it can be read off the data.
 *   database   the measured half: SRID, geometry type, row count and the table's own COMMENT. Read at
 *              build time, so the counts are never a stale number copied into a comment.
 *   manifest   the drawable half: the PMTiles archive, feature count, vertices, minimum zoom, extent and
 *              categories. A layer with no manifest entry is simply `tiled = false` - that is how the
 *              page can say "in the database but not on the map" instead of showing a silent absence.
 *
 * A registry entry whose table does not exist is kept, with `table_name` set and the measured columns
 * null, so a missing dataset stays visible as a gap.
 */

/** The catalogue's columns, in table order. Both schemas get all of them; `extra` adds schema-specific ones. */
const COLUMNS = [
  ['key', 'text primary key', 'The tile layer_key, and the key the page toggles on.'],
  ['title', 'text not null', 'The layer name as the page shows it.'],
  ['grp', 'text not null', 'The panel group the layer sits in.'],
  ['grp_title', 'text not null', 'That group\'s heading.'],
  ['grp_order', 'int not null', 'Group order in the panel, so the catalogue sorts the way the page reads.'],
  ['half', 'text not null', 'Which half of the page the layer belongs to; the two halves come from different builds.'],
  ['kind', 'text not null', 'exclusion, inclusion, context, cache or gap - what the layer does to a result, not what it holds.'],
  ['role', 'text', 'What the policy or clause uses the layer for, in one line.'],
  ['clause', 'text', 'The provision the layer serves.'],
  ['table_name', 'text', 'The relation holding it, schema-qualified. Null only where no dataset exists.'],
  ['source_kind', 'text not null', 'epi, urbanportaldbp, download, derived, mapbox or none - how the data got here.'],
  ['source', 'text', 'The dataset\'s own name and publisher, or the relation it was copied from.'],
  ['source_url', 'text', 'The service or file it was fetched from, where there is one to quote.'],
  ['filter', 'text', 'The predicate that cut this layer out of its source, where it is a slice of a larger table.'],
  ['srid', 'int', 'Measured from the data, not from the column type: two lmr tables are declared without one.'],
  ['geom_type', 'text', 'point, linestring or polygon.'],
  ['features', 'bigint', 'Rows in the table now.'],
  ['vertices', 'bigint', 'From the tile build; why a heavy layer is drawn only from min_zoom.'],
  ['source_date', 'date', 'Currency of the DATA - the publisher\'s own version or commencement date.'],
  ['loaded_at', 'date', 'When it was copied, downloaded or derived into planningai. Not the same thing as source_date.'],
  ['tiled', 'boolean not null default false', 'Whether the page can draw it.'],
  ['archive', 'text', 'The PMTiles archive it is drawn from.'],
  ['min_zoom', 'int', 'The zoom the tiles start at; 0 unless the layer was too heavy for the low-zoom tiles.'],
  ['bbox', 'float8[]', 'Extent as [west, south, east, north], for "zoom to".'],
  ['categories', 'jsonb', 'The values the page colours by, biggest first.'],
  ['note', 'text', 'What the layer is - the table\'s own COMMENT where it has one.'],
  ['caveat', 'text', 'The known limitation. A layer with a caveat is still usable; one without has simply not been questioned.'],
  ['checked_at', 'timestamptz not null', 'When this row was last rebuilt.'],
]

/**
 * Create (or replace) the catalogue table and write every row in one transaction.
 *
 * Dropped and rebuilt rather than upserted: the registry is the authority on what exists, so a layer
 * removed from it must disappear from the table too, and there is nothing in a catalogue row worth
 * preserving across a rebuild.
 */
export async function writeCatalogue(client, { schema, table = 'layers', comment, extra = [], rows }) {
  const cols = [...COLUMNS, ...extra]
  const names = cols.map(c => c[0])
  const ddl = cols.map(c => `  ${c[0]} ${c[1]}`).join(',\n')
  const qualified = `${schema}.${table}`

  await client.query('BEGIN')
  try {
    await client.query(`DROP TABLE IF EXISTS ${qualified}`)
    await client.query(`CREATE TABLE ${qualified} (\n${ddl}\n)`)
    await client.query(`COMMENT ON TABLE ${qualified} IS $c$${comment}$c$`)
    for (const [name, , cmt] of cols) {
      if (cmt) await client.query(`COMMENT ON COLUMN ${qualified}.${name} IS $c$${cmt}$c$`)
    }
    const placeholders = names.map((_, i) => `$${i + 1}`).join(', ')
    for (const row of rows) {
      await client.query(
        `INSERT INTO ${qualified} (${names.join(', ')}) VALUES (${placeholders})`,
        names.map(n => (row[n] === undefined ? null : row[n])))
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
  return rows.length
}

/**
 * Measured facts for every table in a schema: SRID and geometry type from the data (not from the column
 * type - lmr.town_centre_walking_catchments is declared plain `geometry` and reports SRID 0 in
 * geometry_columns while every row is GDA94), the row count, and the table's own COMMENT.
 *
 * One query per table, because a row count cannot be had any other way and these schemas hold at most a
 * few dozen tables.
 */
export async function tableFacts(client, schema) {
  const { rows: tables } = await client.query(`
    SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment,
           g.f_geometry_column AS gcol,
           nullif(g.srid, 0) AS declared_srid, g.type AS declared_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL (
      SELECT * FROM geometry_columns gc
      WHERE gc.f_table_schema = n.nspname AND gc.f_table_name = c.relname LIMIT 1) g ON true
    WHERE n.nspname = $1 AND c.relkind = 'r'
    ORDER BY c.relname`, [schema])

  const facts = new Map()
  for (const t of tables) {
    const base = { comment: t.comment, features: null, srid: null, geomType: null }
    if (!t.gcol) {
      const n = await client.query(`SELECT count(*)::bigint AS n FROM ${schema}."${t.name}"`)
      facts.set(t.name, { ...base, features: Number(n.rows[0].n) })
      continue
    }
    const q = await client.query(`
      SELECT count(*)::bigint AS n,
             mode() WITHIN GROUP (ORDER BY ST_SRID("${t.gcol}")) AS srid,
             mode() WITHIN GROUP (ORDER BY GeometryType("${t.gcol}")) AS gtype
      FROM ${schema}."${t.name}"`)
    const r = q.rows[0]
    // measured first, because two lmr tables are declared without a SRID while every row carries one;
    // the declared type is the fallback for an empty table, which can report neither
    facts.set(t.name, {
      ...base,
      features: Number(r.n),
      srid: r.srid ?? t.declared_srid ?? null,
      geomType: simpleGeomType(r.gtype) ?? simpleGeomType(t.declared_type),
    })
  }
  return facts
}

/**
 * The same measurements for ONE relation named in full, whatever its schema and whether it is a table or
 * a view.
 *
 * `tableFacts` sweeps a single schema for tables, which is the right shape for "what does this schema
 * hold" but the wrong one for a catalogue: a registry row can point at a view (esa.aobv) or at a
 * relation in another schema (bio_values.biodiversityvalues), and both came back unmeasured - reported
 * as though no dataset existed at all, which is the one thing a catalogue must never say wrongly.
 */
export async function relationFacts(client, qualified) {
  const [schema, name] = String(qualified).includes('.')
    ? String(qualified).split('.', 2)
    : ['public', String(qualified)]

  const meta = await client.query(`
    SELECT obj_description(c.oid, 'pg_class') AS comment,
           g.f_geometry_column AS gcol,
           nullif(g.srid, 0) AS declared_srid, g.type AS declared_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL (
      SELECT * FROM geometry_columns gc
      WHERE gc.f_table_schema = n.nspname AND gc.f_table_name = c.relname LIMIT 1) g ON true
    WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'v', 'm', 'p')`, [schema, name])
  if (!meta.rows.length) return null

  const m = meta.rows[0]
  // geometry_columns does not describe a view's geometry, so fall back to the column named `geom`
  const gcol = m.gcol ?? await geomColumn(client, schema, name)
  if (!gcol) {
    const n = await client.query(`SELECT count(*)::bigint AS n FROM "${schema}"."${name}"`)
    return { comment: m.comment, features: Number(n.rows[0].n), srid: null, geomType: null }
  }
  const q = await client.query(`
    SELECT count(*)::bigint AS n,
           mode() WITHIN GROUP (ORDER BY ST_SRID("${gcol}")) AS srid,
           mode() WITHIN GROUP (ORDER BY GeometryType("${gcol}")) AS gtype
    FROM "${schema}"."${name}"`)
  const r = q.rows[0]
  return {
    comment: m.comment,
    features: Number(r.n),
    srid: r.srid ?? m.declared_srid ?? null,
    geomType: simpleGeomType(r.gtype) ?? simpleGeomType(m.declared_type),
  }
}

/** The geometry column of a relation, for the views geometry_columns does not cover. */
async function geomColumn(client, schema, name) {
  const q = await client.query(`
    SELECT a.attname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = $1 AND c.relname = $2
      AND format_type(a.atttypid, null) = 'geometry'
    ORDER BY a.attnum LIMIT 1`, [schema, name])
  return q.rows[0]?.attname ?? null
}

/** POINT / MULTIPOLYGON / GEOMETRYCOLLECTION → the three words the manifests and the page use. */
export function simpleGeomType(t) {
  const s = String(t ?? '').toUpperCase()
  if (!s) return null
  if (s.includes('POINT')) return 'point'
  if (s.includes('LINE')) return 'linestring'
  if (s.includes('POLYGON')) return 'polygon'
  return s.toLowerCase()
}

/** Fetch a PMTiles manifest; null rather than a throw, so a catalogue can be built before any tile build. */
export async function manifest(base, file) {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/${file}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    process.stderr.write(`  ${file}: not readable (${err.message}); tile columns will be null\n`)
    return null
  }
}

/** The first sentence of a table COMMENT - what the page already shows as a layer's blurb. */
export function firstSentence(text) {
  if (!text) return null
  const m = String(text).match(/^.*?[.!?](?=\s|$)/s)
  return (m ? m[0] : String(text)).trim()
}
