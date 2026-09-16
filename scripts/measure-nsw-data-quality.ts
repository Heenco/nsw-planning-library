/**
 * Measure how well the NSW land and address tables fit together, and record it
 * for the Data accuracy section of /datasources.
 *
 *   npm run data:quality                         # measure every check and record it
 *   npm run data:quality -- --dry                # measure and print, record nothing
 *   npm run data:quality -- --only=point-in-lot  # one or more checks, comma-separated
 *
 * Run it after each load by the "01A dump-gdal" notebook. The checks are the
 * ones shared/datasources-nsw.ts defines and the page explains, so what is
 * measured and what is described cannot drift apart.
 *
 * Each result becomes a row in public.geodaas_quality_check (created on first
 * run), stamped with when the data it measured was loaded. The page reads the
 * latest row per check, and flags a measurement taken before the latest load.
 * The table sits in `public` because the loader drops and recreates the data
 * schemas on every reload.
 *
 * Connects with DATABASE_URL, like the app. The server's default statement
 * timeout is too short for a few of the whole-table checks, so the session
 * raises it. The full set takes about two minutes.
 */

import 'dotenv/config'
import pg from 'pg'
import { QUALITY_CHECKS } from '../shared/datasources-nsw'

async function main() {
  const dry = process.argv.includes('--dry')
  const onlyArg = process.argv.find(a => a.startsWith('--only='))
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean)) : null
  if (only) {
    const unknown = [...only].filter(id => !QUALITY_CHECKS.some(c => c.id === id))
    if (unknown.length) throw new Error(`Unknown check id(s): ${unknown.join(', ')}. Known: ${QUALITY_CHECKS.map(c => c.id).join(', ')}`)
  }
  const checks = QUALITY_CHECKS.filter(c => !only || only.has(c.id))

  const url = (process.env.DATABASE_URL || '').trim()
  if (!url) throw new Error('DATABASE_URL is not set. Put it in .env, the way the app reads it.')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(`SET statement_timeout = '15min'`)

    const loaded = await client.query(`SELECT to_regclass('public.geodaas_latest_load') AS reg`)
    let dataLoadedAt: Date | null = null
    if (loaded.rows[0]?.reg) {
      const r = await client.query(
        `SELECT max(loaded_at) AS at FROM public.geodaas_latest_load WHERE schema_name IN ('cadastre', 'guras', 'integrated_address')`,
      )
      dataLoadedAt = r.rows[0]?.at ?? null
    }
    console.log(`Data last loaded: ${dataLoadedAt ? new Date(dataLoadedAt).toISOString() : 'unknown (no load log)'}`)
    console.log(dry ? 'Dry run: nothing will be recorded.\n' : '')

    if (!dry) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.geodaas_quality_check (
          id bigserial PRIMARY KEY,
          check_id text NOT NULL,
          measured_at timestamptz NOT NULL DEFAULT now(),
          numerator bigint NOT NULL,
          denominator bigint NOT NULL,
          ratio numeric,
          seconds numeric,
          sample text,
          data_loaded_at timestamptz
        )`)
      await client.query(`CREATE INDEX IF NOT EXISTS geodaas_quality_check_latest_idx ON public.geodaas_quality_check (check_id, measured_at DESC)`)
    }

    let failed = 0
    for (const check of checks) {
      const t0 = Date.now()
      try {
        const r = await client.query(check.sql)
        const numerator = Number(r.rows[0]?.numerator ?? 0)
        const denominator = Number(r.rows[0]?.denominator ?? 0)
        const seconds = (Date.now() - t0) / 1000
        const ratio = denominator ? numerator / denominator : null
        const share = ratio == null ? 'n/a' : `${(ratio * 100).toFixed(2)}%`
        console.log(`${check.id.padEnd(26)} ${numerator.toLocaleString().padStart(11)} / ${denominator.toLocaleString().padEnd(11)} ${share.padStart(8)}  ${seconds.toFixed(1)}s${check.sample ? `  (${check.sample})` : ''}`)
        if (!dry) {
          await client.query(
            `INSERT INTO public.geodaas_quality_check (check_id, numerator, denominator, ratio, seconds, sample, data_loaded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [check.id, numerator, denominator, ratio, seconds, check.sample ?? null, dataLoadedAt],
          )
        }
      } catch (err: any) {
        failed++
        console.error(`${check.id.padEnd(26)} FAILED: ${err?.message ?? err}`)
      }
    }
    if (failed) process.exitCode = 1
    console.log(`\n${checks.length - failed} of ${checks.length} checks measured${dry ? '' : ' and recorded in public.geodaas_quality_check'}.`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
