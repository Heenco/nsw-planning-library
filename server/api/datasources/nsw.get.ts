/**
 * The live half of /datasources for NSW: what was loaded, when, and how the
 * accuracy checks measured.
 *
 *   /api/datasources/nsw
 *
 * Everything the page explains is static (shared/datasources-nsw.ts). What
 * changes with each load comes from three tables in `public`, which live
 * outside the reloaded schemas so a reload cannot drop them:
 *
 *   geodaas_latest_load   view: the latest successful load of every table,
 *                         written by the "01A dump-gdal" notebook
 *   geodaas_load_run      one row per notebook run, with its timings
 *   geodaas_quality_check one row per accuracy check per measurement, written
 *                         by scripts/measure-nsw-data-quality.ts
 *
 * Any of them can be missing: on a database the notebook never loaded, or
 * before the accuracy script first ran. The route then says so per part
 * (`available: false`) rather than failing, and the page falls back to the
 * baseline figures it ships with.
 *
 * All three reads are small and indexed or tiny, so this answers in tens of
 * milliseconds. It is cached for a minute: a load takes twenty.
 */

import { nswQuery } from '../../utils/nsw-kg/pool'

interface LoadedTable {
  schema: string
  table: string
  rowCount: number
  geometryType: string | null
  srid: number | null
  sizeBytes: number | null
  indexes: number | null
  loadedAt: string | null
  sourceZip: string | null
  sourceDate: string | null
  runId: string | null
}

interface LoadRun {
  runId: string
  startedAt: string | null
  finishedAt: string | null
  status: string | null
  loadMinutes: number | null
  totalMinutes: number | null
}

interface MeasuredCheck {
  numerator: number
  denominator: number
  measuredAt: string
  seconds: number | null
  sample: string | null
  dataLoadedAt: string | null
}

/**
 * The load log is shared with other states (01A dump-gdal-QLD loads schema qld),
 * so only NSW schemas count here: a QLD load must not move the NSW freshness,
 * the recent loads or the "measured before the latest load" flag.
 */
const NSW_SCHEMAS = ['cadastre', 'guras', 'integrated_address', 'epi']

const num = (v: unknown): number | null => (v == null ? null : Number(v))
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString())

export default defineEventHandler(async (event) => {
  let reg: { latest: string | null; runs: string | null; quality: string | null }
  try {
    const r = await nswQuery(`
      SELECT to_regclass('public.geodaas_latest_load')::text   AS latest,
             to_regclass('public.geodaas_load_run')::text      AS runs,
             to_regclass('public.geodaas_quality_check')::text AS quality`)
    reg = r.rows[0]
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `The database did not answer: ${err?.message ?? err}` })
  }

  const tables: LoadedTable[] = []
  if (reg.latest) {
    const r = await nswQuery(`
      SELECT schema_name, table_name, row_count, geometry_type, srid, size_bytes, n_indexes,
             loaded_at, source_zip, source_date, run_id
      FROM public.geodaas_latest_load
      WHERE schema_name = ANY($1)
      ORDER BY schema_name, table_name`, [NSW_SCHEMAS])
    for (const row of r.rows) {
      tables.push({
        schema: row.schema_name,
        table: row.table_name,
        rowCount: Number(row.row_count ?? 0),
        geometryType: row.geometry_type === 'table' ? null : row.geometry_type,
        srid: num(row.srid),
        sizeBytes: num(row.size_bytes),
        indexes: num(row.n_indexes),
        loadedAt: iso(row.loaded_at),
        sourceZip: row.source_zip,
        sourceDate: iso(row.source_date),
        runId: row.run_id,
      })
    }
  }

  const runs: LoadRun[] = []
  if (reg.runs) {
    const r = await nswQuery(`
      SELECT run_id, started_at, finished_at, status, load_minutes, total_minutes
      FROM public.geodaas_load_run r
      WHERE NOT EXISTS (SELECT 1 FROM public.geodaas_load_table t WHERE t.run_id = r.run_id)
         OR EXISTS (SELECT 1 FROM public.geodaas_load_table t WHERE t.run_id = r.run_id AND t.schema_name = ANY($1))
      ORDER BY started_at DESC NULLS LAST
      LIMIT 10`, [NSW_SCHEMAS])
    for (const row of r.rows) {
      runs.push({
        runId: row.run_id,
        startedAt: iso(row.started_at),
        finishedAt: iso(row.finished_at),
        status: row.status,
        loadMinutes: num(row.load_minutes),
        totalMinutes: num(row.total_minutes),
      })
    }
  }

  const checks: Record<string, MeasuredCheck> = {}
  if (reg.quality) {
    const r = await nswQuery(`
      SELECT DISTINCT ON (check_id) check_id, numerator, denominator, measured_at, seconds, sample, data_loaded_at
      FROM public.geodaas_quality_check
      ORDER BY check_id, measured_at DESC`)
    for (const row of r.rows) {
      checks[row.check_id] = {
        numerator: Number(row.numerator),
        denominator: Number(row.denominator),
        measuredAt: iso(row.measured_at)!,
        seconds: num(row.seconds),
        sample: row.sample,
        dataLoadedAt: iso(row.data_loaded_at),
      }
    }
  }

  setResponseHeader(event, 'Cache-Control', 'max-age=60')
  return {
    generatedAt: new Date().toISOString(),
    loads: { available: Boolean(reg.latest), tables, runs },
    quality: { available: Boolean(reg.quality), checks },
  }
})
