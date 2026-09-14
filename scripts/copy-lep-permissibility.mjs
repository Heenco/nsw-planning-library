/**
 * Copy the resolver's output into the app's database.
 *
 *   node scripts/copy-lep-permissibility.mjs
 *
 * Notebook 01E writes urbanportaldbp.lep_permissibility on UrbanPortalDBP,
 * which is what the /permissibility page and the report's Land Use Table read
 * as nsw.lep_permissibility on planningai. This moves one to the other, whole:
 * a new table is filled beside the old one, indexed, and swapped in inside a
 * transaction, with the old table kept as nsw.lep_permissibility_prev. So a run
 * that turns out wrong is one rename away from undone, and the page never sees
 * a half-copied table.
 *
 * UrbanPortalDBP accepts no connections from outside its own box, so the read
 * side goes over SSH to the box and to Postgres on its loopback. The write side
 * is DATABASE_URL, as everywhere else in the app.
 *
 * Needs, in .env (all gitignored):
 *   DATABASE_URL             the app's database, ending in /planningai
 *   PIPELINE_SSH_HOST        the box (default 172.105.183.89)
 *   PIPELINE_SSH_USER        default root
 *   PIPELINE_SSH_PASSWORD    the box's SSH password
 *   PIPELINE_PG_PASSWORD     the postgres user's password on the box
 *
 * Refuses to copy a source that holds more than one run_id: 01E writes one per
 * full run, and two means a scoped run was left half-done.
 */

import fs from 'node:fs'
import net from 'node:net'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'

const require = createRequire(import.meta.url)
const pg = require('pg')
const { from: copyFrom, to: copyTo } = require('pg-copy-streams')
const { Client: SSH } = require('ssh2')

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]),
)
const need = k => { const v = process.env[k] ?? env[k]; if (!v) throw new Error(`${k} is not set (see .env.example)`); return v }

const targetUrl = need('DATABASE_URL')
const ssh = { host: env.PIPELINE_SSH_HOST || '172.105.183.89', port: 22, username: env.PIPELINE_SSH_USER || 'root', password: need('PIPELINE_SSH_PASSWORD'), readyTimeout: 20000 }
const srcPg = { host: '127.0.0.1', database: 'UrbanPortalDBP', user: 'postgres', password: need('PIPELINE_PG_PASSWORD') }

const SOURCE = 'urbanportaldbp.lep_permissibility'
const TARGET = 'nsw.lep_permissibility'
const COLS = `epicode text, epi_name text, zone_id text, zone_code text, zone_name text,
  land_use text, level text, status text, basis text, derived_from text, inherit_depth integer,
  resolved_against text, source_text text, run_id text, named_status text, named_source_text text`

const client = new SSH()
await new Promise((res, rej) => client.on('ready', res).on('error', rej).connect(ssh))
const tunnel = net.createServer(sock =>
  client.forwardOut('127.0.0.1', sock.localPort ?? 0, '127.0.0.1', 5432, (e, stream) => {
    if (e) { sock.destroy(); return }
    sock.pipe(stream).pipe(sock)
  }))
await new Promise(res => tunnel.listen(0, '127.0.0.1', res))

const src = new pg.Client({ ...srcPg, port: tunnel.address().port })
const dst = new pg.Client({ connectionString: targetUrl })
await src.connect()
await dst.connect()

try {
  const runs = (await src.query(`SELECT run_id, count(*)::int AS n FROM ${SOURCE} GROUP BY 1 ORDER BY 1 DESC`)).rows
  console.log('source:', JSON.stringify(runs))
  if (runs.length !== 1) throw new Error(`${SOURCE} holds ${runs.length} run_ids; refusing to copy`)
  const before = (await dst.query(`SELECT run_id, count(*)::int AS n FROM ${TARGET} GROUP BY 1`)).rows
  console.log('target before:', JSON.stringify(before))

  await dst.query(`DROP TABLE IF EXISTS ${TARGET}_new`)
  await dst.query(`CREATE TABLE ${TARGET}_new (${COLS})`)
  const t0 = Date.now()
  await pipeline(
    src.query(copyTo(`COPY ${SOURCE} TO STDOUT`)),
    dst.query(copyFrom(`COPY ${TARGET}_new FROM STDIN`)),
  )
  const n = (await dst.query(`SELECT count(*)::int AS n FROM ${TARGET}_new`)).rows[0].n
  console.log(`copied ${n.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (n !== runs[0].n) throw new Error(`row count mismatch: source ${runs[0].n}, copied ${n}`)

  // The indexes 01E builds on its own copy, which this table never had.
  for (const [name, cols] of [['key', '(epicode, zone_code)'], ['name', '(epi_name, zone_code)'], ['use', '(land_use)']]) {
    await dst.query(`CREATE INDEX idx_lep_perm_new_${name} ON ${TARGET}_new ${cols}`)
  }
  await dst.query(`ANALYZE ${TARGET}_new`)

  await dst.query('BEGIN')
  await dst.query(`DROP TABLE IF EXISTS ${TARGET}_prev`)
  await dst.query(`ALTER TABLE ${TARGET} RENAME TO lep_permissibility_prev`)
  await dst.query(`ALTER TABLE ${TARGET}_new RENAME TO lep_permissibility`)
  await dst.query('COMMIT')

  const after = (await dst.query(`SELECT run_id, count(*)::int AS n FROM ${TARGET} GROUP BY 1`)).rows
  console.log('target after:', JSON.stringify(after), `| previous kept as ${TARGET}_prev`)
} finally {
  await src.end().catch(() => {})
  await dst.end().catch(() => {})
  tunnel.close()
  client.end()
}
