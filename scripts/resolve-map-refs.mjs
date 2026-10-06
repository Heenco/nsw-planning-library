/**
 * Resolve rule_spatial_ref map references to geometry.
 *
 * WHY. A clause scopes itself with a map far more often than with a zone — in Parramatta half its
 * clauses do — and until the label becomes a polygon, none of those clauses can be tested against a
 * lot. They are the largest untestable group in the graph, and they include cl 4.3 and cl 4.4A, the
 * height and floor space ratio bands.
 *
 * THE JOIN. The labels live in `label` / `sym_code`, and since the EPI data dump also in
 * `legis_ref_area` (it carries each additional control as its own polygon in the base table, marked
 * "Area 1" there). The map is `map_name` — one epi table holds many maps (epi_local_provisions carries
 * 11 for Parramatta alone). So the match is
 *
 *     epi_name ~ the plan   AND   map_name ~ the ref's map_layer   AND   label|sym_code|legis_ref_area = the value
 *
 * A label may also carry its value after the name: Willoughby's Affordable Housing Map labels its areas
 * "Area 1 = 4%", so "Area 1" matches a label that STARTS with it - only ever together with the map.
 *
 * WHY THE PAIR MATTERS. "Area 1" in Parramatta resolves to the Additional Local Provisions Map (33
 * polygons), the Affordable Housing Map (1) and the Key Sites Map (1) — three different places. A
 * label on its own is not a location. When a ref names a map and the label is not on it, the ref stays
 * unresolved: the old 0.60 "label matched in some other layer" pick is gone, because that is how
 * Willoughby's FSR "Area 6" and "Area 8" came to carry the Special Provisions Area Map's polygons.
 * Refs left at 0.60 by earlier runs are re-evaluated on every run.
 *
 * FIXED 2026-10-07 (Willoughby, 13 Park Avenue Chatswood):
 *   - `sym_code` is an integer in the FSR and height tables, so coalesce(sym_code, '') raised, the
 *     error was swallowed as "layer without these columns", and those two tables were never searched.
 *     Columns are now read from the catalogue and compared as text.
 *   - The column is GDA94 (4283) since 2026-09; the writes still transformed to 4326 and would be
 *     rejected. Geometry is written in the column's own SRID, read from geometry_columns.
 *
 * WHOLE-MAP REFS. A value that is the map's own name ("Heritage Map" on the Heritage Map) or a generic
 * word ("land" on the Height of Buildings Map) means the land shown on that map: every polygon of the
 * plan on it. Confidence 0.80.
 *
 * REFS WITH NO MAP. Mostly a clause heading's place name ("…at Tyneside Avenue") recorded as a ref,
 * while the clause's own text scopes it by a map area ("Area 4" on the Special Provisions Area Map).
 * Second pass: such a ref takes the union of its clause's resolved map refs (same clause number,
 * polarity 'applies'), confidence 0.90; failing that, a label of the plan that CONTAINS the name, if
 * exactly one map has it ("Nest Transport Oriented Development Precinct" -> "Crows Nest …"), 0.80.
 *
 * CONFIDENCE:
 *   1.00  map_name and label both matched, in one layer
 *   0.90  heading place name, inherited from its clause's own map refs
 *   0.80  whole map, or a unique label containing the name, or an address with several lots
 *   null  no match, or matched in several layers — left unresolved rather than picked arbitrarily
 *
 * Usage:  node scripts/resolve-map-refs.mjs [--lep <slug fragment>] [--dry-run]
 */
import 'dotenv/config'
import pg from 'pg'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const LEP = args.includes('--lep') ? args[args.indexOf('--lep') + 1] : null

// The epi tables that carry labelled areas, searched in this order.
const LAYER_TABLES = [
  'epi_local_provisions',
  'epi_key_sites',
  'epi_height_of_building',
  'epi_floor_space_ratio',
  'epi_lot_size',
  'epi_land_zoning',
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
const sameMap = (a, b) => { const x = normMap(a), y = normMap(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)) }
/** Values that mean "the land shown on the map" rather than a labelled part of it. */
const GENERIC = new Set(['land', 'the land', 'any land'])
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query("SET statement_timeout='300s'")

  const { rows: [{ srid }] } = await client.query(
    `SELECT srid FROM geometry_columns WHERE f_table_schema = 'nsw' AND f_table_name = 'rule_spatial_ref' AND f_geometry_column = 'geom'`)
  const toCol = g => `ST_Multi(ST_Transform(${g}, ${Number(srid)}))`

  // which label-ish columns each table has, so a missing one is left out rather than raising
  const { rows: colRows } = await client.query(
    `SELECT table_name, array_agg(column_name::text) AS cols FROM information_schema.columns
      WHERE table_schema = 'epi' AND table_name = ANY($1) GROUP BY 1`, [LAYER_TABLES])
  const COLS = new Map(colRows.map(r => [r.table_name, new Set(r.cols)]))
  const labelCols = t => ['label', 'sym_code', 'legis_ref_area'].filter(c => COLS.get(t)?.has(c))
  /** The label predicate for a table: exact on any label column, or `label` starting with the value. */
  const labelPred = (t, a, eqParam, preParam) => {
    const eq = labelCols(t).map(c => `lower(btrim(coalesce(${a}"${c}"::text, ''))) = lower(btrim(${eqParam}))`)
    if (COLS.get(t)?.has('label')) eq.push(`lower(btrim(coalesce(${a}label::text, ''))) ~ ${preParam}`)
    return eq.length ? `(${eq.join(' OR ')})` : 'false'
  }

  const { rows: refs } = await client.query(
    `SELECT sr.id, sr.document_id, sr.clause, sr.value, sr.map_layer, sr.ref_type, sr.polarity,
            sr.match_confidence, d.instrument_slug, d.lga_name, s.local_id
       FROM nsw.rule_spatial_ref sr
       JOIN nsw.document d ON d.id = sr.document_id
       LEFT JOIN nsw.section s ON s.id = sr.section_id
      WHERE (sr.geom IS NULL OR sr.match_confidence < 0.7)
        AND sr.value IS NOT NULL
        AND ($1::text IS NULL OR d.instrument_slug ILIKE '%' || $1 || '%')
      ORDER BY d.instrument_slug, sr.ref_type, sr.map_layer, sr.value`,
    [LEP],
  )
  console.log(`${refs.length} refs to resolve${LEP ? ` for ${LEP}` : ''} (unresolved, or left at 0.60)\n`)

  const tally = { exact: 0, wholeMap: 0, inherited: 0, contains: 0, ambiguous: 0, none: 0, noMap: 0, cleared: 0, addrOk: 0, addrMiss: 0 }
  const resolvedNow = new Map() // ref id -> true, for the second pass in a dry run

  /** Write a geometry (SQL expression over params) to a ref, or log it in a dry run. */
  async function write(ref, sql, params, source, conf, note) {
    console.log(`  ${note}`)
    resolvedNow.set(ref.id, true)
    if (DRY) return
    await client.query(
      `UPDATE nsw.rule_spatial_ref SET geom = (${sql}), geom_source = $2, match_confidence = $3 WHERE id = $1`,
      [ref.id, source, conf, ...params])
  }
  /** A 0.60 ref this run could not confirm: its geometry came from the wrong map, so drop it. */
  async function clearWeak(ref) {
    if (ref.match_confidence == null || Number(ref.match_confidence) >= 0.7) return
    tally.cleared++
    console.log(`  cleared 0.60   cl ${ref.clause}  ${JSON.stringify(ref.value)} - its old geometry was from another map`)
    if (!DRY) await client.query(`UPDATE nsw.rule_spatial_ref SET geom = NULL, geom_source = NULL, match_confidence = NULL WHERE id = $1`, [ref.id])
  }

  const withMap = refs.filter(r => r.ref_type === 'address' || r.map_layer)
  const noMap = refs.filter(r => r.ref_type !== 'address' && !r.map_layer)

  // ── pass 1: addresses and refs that name their map ─────────────────────────────────────────────
  for (const ref of withMap) {
    // A street address read from a clause heading resolves against the address points, not a map.
    // "5 Aird Street" is stored without its suburb, so it is matched as a prefix within the council.
    if (ref.ref_type === 'address') {
      const q = String(ref.value).replace(/\s+/g, ' ').trim().toUpperCase()
      const r = await client.query(`SELECT count(*)::int n FROM derived.lot_address a WHERE upper(a.address) LIKE $1 || '%'`, [q])
      if (!r.rows[0].n) { tally.addrMiss++; console.log(`  no address     cl ${ref.clause}  ${JSON.stringify(ref.value)}`); continue }
      tally.addrOk++
      await write(ref,
        `SELECT ${toCol('ST_Union(l.geom)')} FROM derived.lot_address a JOIN cadastre.lot l ON l.cadid = a.cadid
          WHERE upper(a.address) LIKE $4 || '%'`,
        [q], 'derived.lot_address', r.rows[0].n === 1 ? 1.0 : 0.8,
        `address        cl ${ref.clause}  ${JSON.stringify(ref.value)} -> ${r.rows[0].n} lots`)
      continue
    }

    const value = String(ref.value).trim()
    const plan = ref.lga_name ?? ''

    // whole-map refs: the map's own name, or a generic word, means every polygon of the plan on it
    if (GENERIC.has(value.toLowerCase()) || sameMap(value, ref.map_layer)) {
      const maps = []
      for (const t of LAYER_TABLES) {
        if (!COLS.get(t)?.has('map_name')) continue
        const r = await client.query(
          `SELECT map_name, count(*)::int n FROM epi."${t}" WHERE epi_name ILIKE '%' || $1 || '%' GROUP BY 1`, [plan])
        for (const row of r.rows) if (sameMap(row.map_name, ref.map_layer)) maps.push({ table: t, ...row })
      }
      if (maps.length === 1) {
        tally.wholeMap++
        const m = maps[0]
        await write(ref,
          `SELECT ${toCol('ST_Union(e.geom)')} FROM epi."${m.table}" e WHERE e.epi_name ILIKE '%' || $4 || '%' AND e.map_name = $5`,
          [plan, m.map_name], `epi.${m.table} (whole map)`, 0.8,
          `whole map      cl ${ref.clause}  ${JSON.stringify(value)} -> ${m.table}/${m.map_name} x${m.n}`)
      } else {
        tally.none++
        console.log(`  no map         cl ${ref.clause}  ${JSON.stringify(value)}: "${ref.map_layer}" is ${maps.length ? 'on several tables' : 'not in the epi data'} for this plan`)
        await clearWeak(ref)
      }
      continue
    }

    const prefix = `^${escRe(value.toLowerCase())}([^a-z0-9]|$)`
    const hits = []
    for (const t of LAYER_TABLES) {
      if (!COLS.get(t)?.has('map_name')) continue
      const r = await client.query(
        `SELECT map_name, count(*)::int n FROM epi."${t}"
          WHERE epi_name ILIKE '%' || $1 || '%' AND ${labelPred(t, '', '$2', '$3')}
          GROUP BY 1`, [plan, value, prefix])
      for (const row of r.rows) hits.push({ table: t, map_name: row.map_name, n: row.n })
    }
    const onMap = hits.filter(h => sameMap(h.map_name, ref.map_layer))

    if (onMap.length !== 1) {
      if (!hits.length) { tally.none++; console.log(`  no match       cl ${ref.clause}  ${JSON.stringify(value)} on "${ref.map_layer}"`) }
      else {
        tally.ambiguous++
        console.log(`  ${onMap.length ? 'ambiguous ' : 'not on map'}     cl ${ref.clause}  ${JSON.stringify(value)} on "${ref.map_layer}" -> `
          + hits.map(h => `${h.map_name} x${h.n}`).join(' | '))
      }
      await clearWeak(ref)
      continue
    }

    const pick = onMap[0]
    tally.exact++
    // One geometry per ref: the union of every polygon carrying that label on that map. A clause that
    // names "Area 1" means all of Area 1, which is 33 polygons in Parramatta, not one of them.
    await write(ref,
      `SELECT ${toCol('ST_Union(e.geom)')} FROM epi."${pick.table}" e
        WHERE e.epi_name ILIKE '%' || $4 || '%' AND e.map_name = $5 AND ${labelPred(pick.table, 'e.', '$6', '$7')}`,
      [plan, pick.map_name, value, prefix], `epi.${pick.table}`, 1.0,
      `exact          cl ${ref.clause}  ${JSON.stringify(value)} -> ${pick.table}/${pick.map_name} x${pick.n}`)
  }

  // ── pass 2: refs with no map — a clause heading's place name ───────────────────────────────────
  for (const ref of noMap) {
    const value = String(ref.value).trim()
    const base = String(ref.local_id ?? '').split('-')[0]          // "sec.6.20-ssec.2" -> "sec.6.20"

    // the clause's own map refs, resolved (in the database, or earlier in this dry run)
    if (base) {
      const { rows: sib } = await client.query(
        `SELECT sr2.id, sr2.value, sr2.map_layer, sr2.geom IS NOT NULL AS has_geom
           FROM nsw.rule_spatial_ref sr2 JOIN nsw.section s2 ON s2.id = sr2.section_id
          WHERE sr2.document_id = $1 AND sr2.map_layer IS NOT NULL AND sr2.polarity = 'applies'
            AND (s2.local_id = $2 OR s2.local_id LIKE $2 || '-%')`, [ref.document_id, base])
      const ok = sib.filter(s => s.has_geom || resolvedNow.has(s.id))
      if (ok.length) {
        tally.inherited++
        const names = [...new Set(ok.map(s => `"${s.value}" on ${s.map_layer}`))].join(', ')
        await write(ref,
          `SELECT ${toCol('ST_Union(sr2.geom)')} FROM nsw.rule_spatial_ref sr2 WHERE sr2.id = ANY($4::uuid[])`,
          [ok.map(s => s.id)], 'inherited: clause map refs', 0.9,
          `inherited      cl ${ref.clause}  ${JSON.stringify(value)} (${base}) -> ${names}`)
        continue
      }
    }

    // a label of this plan that contains the name, on exactly one map
    const plan = ref.lga_name ?? ''
    const contains = []
    for (const t of LAYER_TABLES) {
      if (!COLS.get(t)?.has('map_name') || !COLS.get(t)?.has('label')) continue
      const r = await client.query(
        `SELECT map_name, label, count(*)::int n FROM epi."${t}"
          WHERE epi_name ILIKE '%' || $1 || '%' AND label ILIKE '%' || $2 || '%' GROUP BY 1, 2`, [plan, value])
      for (const row of r.rows) contains.push({ table: t, ...row })
    }
    if (contains.length === 1) {
      tally.contains++
      const c = contains[0]
      await write(ref,
        `SELECT ${toCol('ST_Union(e.geom)')} FROM epi."${c.table}" e
          WHERE e.epi_name ILIKE '%' || $4 || '%' AND e.map_name = $5 AND e.label = $6`,
        [plan, c.map_name, c.label], `epi.${c.table} (label contains)`, 0.8,
        `contains       cl ${ref.clause}  ${JSON.stringify(value)} -> "${c.label}" on ${c.map_name} x${c.n}`)
      continue
    }
    tally.noMap++
    console.log(`  no map_layer   cl ${ref.clause}  ${JSON.stringify(value)} (${base || 'no section'}): no map ref in its clause`
      + (contains.length ? `, and the name is in ${contains.length} labels` : ''))
    await clearWeak(ref)
  }

  const { rows: [after] } = await client.query(
    `SELECT count(*)::int n, count(geom)::int g FROM nsw.rule_spatial_ref
      WHERE ($1::text IS NULL OR document_id IN
             (SELECT id FROM nsw.document WHERE instrument_slug ILIKE '%' || $1 || '%'))`,
    [LEP],
  )
  console.log(`\n  exact ${tally.exact}   whole map ${tally.wholeMap}   inherited ${tally.inherited}   contains ${tally.contains}   `
    + `address ${tally.addrOk}/${tally.addrOk + tally.addrMiss}   ambiguous ${tally.ambiguous}   no match ${tally.none}   `
    + `no map ${tally.noMap}   0.60 cleared ${tally.cleared}`)
  console.log(`  ${DRY ? `${after.g}/${after.n} refs carry geometry before this run; it would resolve ${resolvedNow.size} (dry run — nothing written)`
    : `${after.g}/${after.n} refs now carry geometry`}`)
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
