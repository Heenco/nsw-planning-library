/**
 * Fast streaming re-copy of up_property_comprehensive from PG14 (SSH tunnel)
 * to PG16 (kg database) using COPY TO/FROM STDIN.
 *
 * Fixes the duplicate rows issue in the previous copy: only 2.1M unique
 * objectids were present in 5.2M total rows because LIMIT/OFFSET without
 * ORDER BY gave non-deterministic pagination.
 *
 * This version:
 * 1. Truncates the target table first.
 * 2. Uses a single COPY TO STDOUT stream on the source, piped into
 *    COPY FROM STDIN on the destination — guarantees every row is
 *    transferred exactly once and is 10-20x faster than batched INSERTs.
 */

import pg from 'pg'
import { Client as SSHClient } from 'ssh2'
import { readFileSync } from 'fs'
import net from 'net'
import { to as copyTo, from as copyFrom } from 'pg-copy-streams'
import { pipeline } from 'stream/promises'

const TARGET_URL = 'postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg'

const SSH_CONFIG = {
  host: '45.79.118.32',
  port: 22,
  username: 'root',
  privateKey: readFileSync('C:\\Users\\ManniKheradmandi\\Downloads\\dev_key'),
}
const PG14 = {
  host: 'localhost',
  port: 5432,
  database: 'UrbanPortalDBP',
  user: 'postgres',
  password: 'X|($DM$25p%5',
}

async function createTunnel() {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient()
    ssh.on('ready', () => {
      const server = net.createServer((sock) => {
        ssh.forwardOut(
          sock.remoteAddress,
          sock.remotePort,
          PG14.host,
          PG14.port,
          (err, stream) => {
            if (err) {
              sock.end()
              return
            }
            sock.pipe(stream).pipe(sock)
          },
        )
      })
      server.listen(0, '127.0.0.1', () => {
        console.log(`SSH tunnel on localhost:${server.address().port}`)
        resolve({ port: server.address().port, ssh, server })
      })
    })
    ssh.on('error', reject)
    ssh.connect(SSH_CONFIG)
  })
}

async function run() {
  console.log('Opening SSH tunnel…')
  const tunnel = await createTunnel()

  const src = new pg.Client({
    host: '127.0.0.1',
    port: tunnel.port,
    database: PG14.database,
    user: PG14.user,
    password: PG14.password,
  })
  const dst = new pg.Client({ connectionString: TARGET_URL })
  await src.connect()
  await dst.connect()
  console.log('Connected to both databases')

  // Get non-geometry columns
  const colRes = await src.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='urbanportaldbp' AND table_name='up_property_comprehensive'
    AND data_type != 'USER-DEFINED' ORDER BY ordinal_position
  `)
  const cols = colRes.rows.map((r) => r.column_name)
  const colList = cols.map((c) => `"${c}"`).join(',')
  console.log(`${cols.length} columns`)

  // Verify source count
  const srcCountRes = await src.query('SELECT count(*) as c FROM urbanportaldbp.up_property_comprehensive')
  const srcCount = parseInt(srcCountRes.rows[0].c)
  console.log(`Source rows: ${srcCount.toLocaleString()}`)

  // Truncate target — faster than DROP+CREATE since it preserves indexes
  // but we want to rebuild indexes after load for speed.
  console.log('Dropping indexes for faster load…')
  await dst.query('DROP INDEX IF EXISTS nsw.idx_prop_address')
  await dst.query('DROP INDEX IF EXISTS nsw.idx_prop_zone')
  await dst.query('DROP INDEX IF EXISTS nsw.idx_prop_lga')
  console.log('Truncating target table…')
  await dst.query('TRUNCATE TABLE nsw.up_property_comprehensive')

  // Stream: COPY TO STDOUT from source → COPY FROM STDIN to destination
  console.log('Starting streaming COPY…')
  const t0 = Date.now()

  // Use CSV format — the target table has all text columns, and CSV handles
  // cross-version compatibility better than binary format.
  // Column types on target are all text, so we cast everything to text on source.
  const castedCols = cols.map((c) => `"${c}"::text`).join(',')
  const sourceStream = src.query(
    copyTo(`COPY (SELECT ${castedCols} FROM urbanportaldbp.up_property_comprehensive) TO STDOUT WITH (FORMAT csv, HEADER false, NULL '')`),
  )
  const destStream = dst.query(
    copyFrom(`COPY nsw.up_property_comprehensive (${colList}) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '')`),
  )

  // Pipe source → dest. pipeline() handles cleanup + error propagation.
  let bytes = 0
  sourceStream.on('data', (chunk) => {
    bytes += chunk.length
    if (bytes % (50 * 1024 * 1024) < chunk.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
      process.stdout.write(`\r  Transferred ~${(bytes / 1024 / 1024).toFixed(0)} MB (${elapsed}s)`)
    }
  })

  await pipeline(sourceStream, destStream)

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\nCOPY complete in ${elapsed}s (${(bytes / 1024 / 1024).toFixed(0)} MB)`)

  // Verify
  const dstCountRes = await dst.query('SELECT count(*) as c, count(DISTINCT objectid) as distinct_ids FROM nsw.up_property_comprehensive')
  console.log(`Target rows: ${parseInt(dstCountRes.rows[0].c).toLocaleString()}`)
  console.log(`Distinct objectids: ${parseInt(dstCountRes.rows[0].distinct_ids).toLocaleString()}`)

  // Rebuild indexes
  console.log('Rebuilding indexes…')
  await dst.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  await dst.query(`CREATE INDEX idx_prop_address ON nsw.up_property_comprehensive USING gin ("address" gin_trgm_ops)`)
  console.log('  ✓ idx_prop_address')
  await dst.query(`CREATE INDEX idx_prop_zone ON nsw.up_property_comprehensive ("lzn_sym_code")`)
  console.log('  ✓ idx_prop_zone')
  await dst.query(`CREATE INDEX idx_prop_lga ON nsw.up_property_comprehensive ("lga_name")`)
  console.log('  ✓ idx_prop_lga')

  // Spot check
  const check = await dst.query(`SELECT address FROM nsw.up_property_comprehensive WHERE address ILIKE '%505 FIFTEENTH%' LIMIT 3`)
  console.log(`Spot check '505 FIFTEENTH': ${check.rows.length} rows`)
  check.rows.forEach((r) => console.log('  ', r.address))

  await src.end()
  await dst.end()
  tunnel.server.close()
  tunnel.ssh.end()
  console.log('Done')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
