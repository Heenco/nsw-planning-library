/**
 * Every spatial dataset the library holds, where it came from, and which page draws it.
 *
 *   /api/datasources/layers
 *
 * ONE ROW PER DATASET, NOT PER LAYER. The pages between them list far more layers than we hold
 * datasets: /cdc-map's 68 layers are mostly views over epi, esa and lmr, and 37 of /lmr's 63 are slices
 * of the single table epi.epi_land_application cut by (epi_name, lay_name). Counting those as separate
 * data items would say we hold about 210 things when the answer is nearer 107. So this route is keyed
 * on the RELATION, and `usedOn` carries the pages - a dataset drawn by three pages is one row with
 * three entries, which is the shape the question "what do we have" actually wants.
 *
 * WHERE EACH FIELD COMES FROM
 *
 *   epi           public.geodaas_latest_load - the 01A dump-gdal notebook writes one row per table per
 *                 run, with the zip it came from and that zip's date. The epi tables carry no COMMENT
 *                 of their own, so this registry is the only provenance they have.
 *   lmr, esa      their own catalogues (lmr.layers, esa.layers), which already hold source, source_kind,
 *                 source_date and loaded_at per layer.
 *   cdc           cdc.layers, but only for the three datasets cdc owns outright; its 63 views resolve
 *                 back to the relation they read, and show up as a page in that relation's `usedOn`.
 *   bio_values    its table COMMENT, in the form scripts/load-bio-values.py writes.
 *
 * `origin` is the answer to "is this epi or not", and it is three-valued rather than two because
 * "not epi" hides the distinction that matters most: a dataset someone else publishes and we fetched,
 * against one that exists nowhere and we computed. `generated` says how, for both.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

import type { DatasetRow, LayersResponse, Origin } from '#shared/datasources-nsw'

/** How a catalogue's source_kind reads as an origin, and the one-line method behind it. */
const KIND: Record<string, { origin: Origin; how: string }> = {
  epi: {
    origin: 'epi',
    how: 'Copied from the epi schema, not a view: 01A replaces epi with DROP SCHEMA CASCADE, which would '
      + 'drop a dependent view, so the slice is materialised and re-run after each EPI load.',
  },
  urbanportaldbp: { origin: 'external', how: 'Copied across from the UrbanPortalDBP pipeline host.' },
  download: { origin: 'external', how: 'Downloaded from the publisher\'s ArcGIS service, fetched by objectIds and reconciled feature by feature.' },
  mapbox: { origin: 'external', how: 'Built from the Mapbox Isochrone API (walking, generalize=0).' },
  notebook: { origin: 'external', how: 'Built by a Notebooks run from several published services, clipped to each plan\'s application area.' },
  derived: { origin: 'derived', how: 'Computed here in PostGIS from another table in this database; nobody publishes it.' },
}

export default defineEventHandler(async (event): Promise<LayersResponse> => {
  setHeader(event, 'cache-control', 'public, max-age=300')

  const [epi, lmr, esa, cdc, bio] = await Promise.all([
    nswQuery<any>(`
      SELECT table_name, row_count, source_zip, source_date, loaded_at
      FROM public.geodaas_latest_load WHERE schema_name = 'epi' ORDER BY table_name`)
      .catch(() => ({ rows: [] })),
    nswQuery<any>(`
      SELECT key, title, table_name, source, source_kind, source_date, loaded_at, features, half
      FROM lmr.layers ORDER BY key`).catch(() => ({ rows: [] })),
    nswQuery<any>(`
      SELECT key, title, table_name, source, source_kind, source_date, loaded_at, features
      FROM esa.layers WHERE table_name IS NOT NULL ORDER BY key`).catch(() => ({ rows: [] })),
    nswQuery<any>(`
      SELECT key, title, source, source_kind, features FROM cdc.layers ORDER BY key`)
      .catch(() => ({ rows: [] })),
    nswQuery<any>(`
      SELECT 'bio_values.biodiversityvalues' AS relation,
             obj_description('bio_values.biodiversityvalues'::regclass, 'pg_class') AS comment,
             (SELECT count(*)::int FROM bio_values.biodiversityvalues) AS features`)
      .catch(() => ({ rows: [] })),
  ])

  const by = new Map<string, DatasetRow>()
  const add = (r: DatasetRow) => { if (!by.has(r.relation)) by.set(r.relation, r) }
  const use = (relation: string | null, page: string) => {
    if (!relation) return
    const row = by.get(relation)
    if (row && !row.usedOn.includes(page)) row.usedOn.push(page)
  }

  // ── epi: the source everything else is measured against ───────────────────────────────────────
  for (const r of epi.rows) {
    add({
      relation: `epi.${r.table_name}`,
      schema: 'epi',
      title: r.table_name.replace(/^epi_/, '').replace(/_/g, ' '),
      source: r.source_zip ? `GEODAAS All-EPI geodatabase (${r.source_zip})` : 'GEODAAS All-EPI geodatabase',
      origin: 'epi',
      generated: 'Loaded by ogr2ogr on the database host from the geodatabase in the zip (01A dump-gdal).',
      sourceDate: iso(r.source_date),
      loadedAt: iso(r.loaded_at),
      features: r.row_count == null ? null : Number(r.row_count),
      usedOn: ['/epi'],
    })
  }

  // ── bio_values: one table, its provenance in its own COMMENT ──────────────────────────────────
  for (const r of bio.rows) {
    add({
      relation: r.relation, schema: 'bio_values', title: 'Biodiversity Values Map',
      source: 'LMBC Biodiversity Values Map data pack v19.5 (SEED)',
      origin: 'external',
      generated: 'Loaded by ogr2ogr on the database host from the SEED data pack geodatabase '
        + '(scripts/load-bio-values.py), not from the REST service - the two disagree.',
      sourceDate: '2026-09-11', loadedAt: '2026-09-20',
      features: r.features == null ? null : Number(r.features), usedOn: [],
    })
  }

  // ── lmr and esa: their own catalogues already answer every column ─────────────────────────────
  for (const r of lmr.rows) {
    // the 37 SEPP rows are all slices of one epi table; they are not datasets of their own
    if (r.half === 'sepp') { use(r.table_name, '/lmr'); continue }
    const k = KIND[r.source_kind] ?? { origin: 'external' as Origin, how: 'See the layer note.' }
    add({
      relation: r.table_name, schema: 'lmr', title: r.title, source: r.source,
      origin: k.origin, generated: k.how,
      sourceDate: iso(r.source_date), loadedAt: iso(r.loaded_at),
      features: r.features == null ? null : Number(r.features), usedOn: [],
    })
    use(r.table_name, '/lmr')
  }
  for (const r of esa.rows) {
    const k = KIND[r.source_kind] ?? { origin: 'external' as Origin, how: 'See the layer note.' }
    add({
      relation: r.table_name, schema: r.table_name.split('.')[0], title: r.title, source: r.source,
      origin: k.origin, generated: k.how,
      sourceDate: iso(r.source_date), loadedAt: iso(r.loaded_at),
      features: r.features == null ? null : Number(r.features), usedOn: [],
    })
    use(r.table_name, '/esa')
  }

  // ── cdc: three datasets of its own; the rest are views onto the above ─────────────────────────
  for (const r of cdc.rows) {
    const src: string = r.source ?? ''
    if (r.source_kind === 'view' && src.includes('.')) { use(src, '/cdc-map'); continue }
    if (r.source_kind === 'none') continue          // a gap holds no dataset to list
    add({
      relation: `cdc.${r.key}`, schema: 'cdc', title: r.title, source: src || null,
      origin: 'external',
      generated: r.source_kind === 'pulled'
        ? 'Copied across from the UrbanPortalDBP pipeline host.'
        : 'Downloaded from the publisher\'s ArcGIS service and reconciled against it.',
      sourceDate: null, loadedAt: null,
      features: r.features == null ? null : Number(r.features), usedOn: [],
    })
    use(`cdc.${r.key}`, '/cdc-map')
  }

  const datasets = [...by.values()]
    .map(d => ({ ...d, usedOn: d.usedOn.length ? d.usedOn.sort() : ['(held, not drawn)'] }))
    .sort((a, b) => a.relation.localeCompare(b.relation))

  return {
    datasets,
    summary: {
      datasets: datasets.length,
      epi: datasets.filter(d => d.origin === 'epi').length,
      external: datasets.filter(d => d.origin === 'external').length,
      derived: datasets.filter(d => d.origin === 'derived').length,
      pageLayers: { epi: epi.rows.length, lmr: lmr.rows.length, esa: esa.rows.length, cdc: cdc.rows.length },
    },
    generatedAt: new Date().toISOString(),
  }
})

const iso = (d: any): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null)
