/**
 * Fast copy of up_property_comprehensive from PG14 (SSH) to PG16 (direct).
 * Uses batched INSERT with smaller chunks to stay under PG parameter limits.
 */

import pg from 'pg'
import { Client as SSHClient } from 'ssh2'
import { readFileSync } from 'fs'
import net from 'net'

const TARGET_URL = 'postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg'

const SSH_CONFIG = {
  host: '45.79.118.32', port: 22, username: 'root',
  privateKey: readFileSync('C:\\Users\\ManniKheradmandi\\Downloads\\dev_key'),
}
const PG14 = { host: 'localhost', port: 5432, database: 'UrbanPortalDBP', user: 'postgres', password: 'X|($DM$25p%5' }

async function createTunnel() {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient()
    ssh.on('ready', () => {
      const server = net.createServer(sock => {
        ssh.forwardOut(sock.remoteAddress, sock.remotePort, PG14.host, PG14.port, (err, stream) => {
          if (err) { sock.end(); return }
          sock.pipe(stream).pipe(sock)
        })
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

  const src = new pg.Client({ host: '127.0.0.1', port: tunnel.port, database: PG14.database, user: PG14.user, password: PG14.password })
  const dst = new pg.Client({ connectionString: TARGET_URL })
  await src.connect()
  await dst.connect()
  console.log('Connected to both')

  // Get non-geometry columns
  const colRes = await src.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='urbanportaldbp' AND table_name='up_property_comprehensive'
    AND data_type != 'USER-DEFINED' ORDER BY ordinal_position
  `)
  const cols = colRes.rows.map(r => r.column_name)
  const colList = cols.map(c => `"${c}"`).join(',')
  const nCols = cols.length
  console.log(`${nCols} columns`)

  // Recreate target table
  await dst.query('DROP TABLE IF EXISTS nsw.up_property_comprehensive')
  await dst.query(`CREATE TABLE nsw.up_property_comprehensive (${cols.map(c => `"${c}" text`).join(', ')})`)
  console.log('Target table created')

  // PG max params = 65535. With 252 cols, max rows per batch = floor(65535/252) = 260
  // Use 200 to be safe.
  const BATCH_ROWS = 200
  const READ_CHUNK = 10000  // read from source in larger chunks, insert in smaller batches
  const t0 = Date.now()
  let copied = 0
  let offset = 0

  while (true) {
    const chunk = await src.query(`SELECT ${colList} FROM urbanportaldbp.up_property_comprehensive LIMIT ${READ_CHUNK} OFFSET ${offset}`)
    if (chunk.rows.length === 0) break

    // Insert in sub-batches of BATCH_ROWS
    for (let i = 0; i < chunk.rows.length; i += BATCH_ROWS) {
      const batch = chunk.rows.slice(i, i + BATCH_ROWS)
      const placeholders = []
      const values = []
      let pi = 1
      for (const row of batch) {
        placeholders.push(`(${cols.map(() => `$${pi++}`).join(',')})`)
        for (const c of cols) values.push(row[c] ?? null)
      }
      await dst.query(`INSERT INTO nsw.up_property_comprehensive (${colList}) VALUES ${placeholders.join(',')}`, values)
    }

    copied += chunk.rows.length
    offset += READ_CHUNK
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
    const rate = (copied / (Date.now() - t0) * 1000).toFixed(0)
    process.stdout.write(`\r  ${copied} rows (${elapsed}s, ~${rate}/s)`)
  }

  console.log(`\n  Total: ${copied} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log('  Creating indexes…')
  await dst.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  await dst.query(`CREATE INDEX idx_prop_address ON nsw.up_property_comprehensive USING gin ("address" gin_trgm_ops)`)
  await dst.query(`CREATE INDEX idx_prop_zone ON nsw.up_property_comprehensive ("lzn_sym_code")`)
  await dst.query(`CREATE INDEX idx_prop_lga ON nsw.up_property_comprehensive ("lga_name")`)
  console.log('  ✓ Done')

  await src.end()
  await dst.end()
  tunnel.server.close()
  tunnel.ssh.end()
}

run().catch(e => { console.error(e); process.exit(1) })
