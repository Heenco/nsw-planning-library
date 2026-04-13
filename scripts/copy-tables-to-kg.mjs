/**
 * Copy up_permissiblelanduse and up_property_comprehensive from PG14 (via SSH)
 * into the kg database on PG16 (via DATABASE_URL).
 *
 * Run: node scripts/copy-tables-to-kg.mjs
 */

import pg from 'pg'
import { Client as SSHClient } from 'ssh2'
import { readFileSync } from 'fs'
import net from 'net'

const TARGET_URL = 'postgresql://nsw_reader:heenco_nsw_2026@172.105.184.178:5432/kg'

// SSH tunnel config (to reach PG14 on host)
const SSH_CONFIG = {
  host: '45.79.118.32',
  port: 22,
  username: 'root',
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
        const port = server.address().port
        console.log(`SSH tunnel on localhost:${port} → ${PG14.host}:${PG14.port}`)
        resolve({ port, ssh, server })
      })
    })
    ssh.on('error', reject)
    ssh.connect(SSH_CONFIG)
  })
}

async function run() {
  // 1. Open SSH tunnel to PG14
  console.log('Opening SSH tunnel…')
  const tunnel = await createTunnel()

  const src = new pg.Client({ host: '127.0.0.1', port: tunnel.port, database: PG14.database, user: PG14.user, password: PG14.password })
  const dst = new pg.Client({ connectionString: TARGET_URL })
  await src.connect()
  await dst.connect()
  console.log('Connected to both databases')

  // 2. Copy up_permissiblelanduse (152K rows)
  console.log('\n── Copying up_permissiblelanduse ──')
  await dst.query('DROP TABLE IF EXISTS nsw.up_permissiblelanduse')
  await dst.query(`CREATE TABLE nsw.up_permissiblelanduse (
    epi_title varchar(150), lga_name varchar(50), epi_type varchar(5),
    lganame varchar(60), councilname varchar(80), region_name varchar(100),
    epititle varchar, zone varchar, permissiblelanduse varchar(200), suburbname varchar(200)
  )`)

  const permRes = await src.query('SELECT * FROM urbanportaldbp.up_permissiblelanduse')
  console.log(`Read ${permRes.rows.length} rows from source`)

  // Batch insert
  const BATCH = 5000
  for (let i = 0; i < permRes.rows.length; i += BATCH) {
    const batch = permRes.rows.slice(i, i + BATCH)
    const values = []
    const params = []
    let pi = 1
    for (const r of batch) {
      values.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++})`)
      params.push(r.epi_title, r.lga_name, r.epi_type, r.lganame, r.councilname, r.region_name, r.epititle, r.zone, r.permissiblelanduse, r.suburbname)
    }
    await dst.query(`INSERT INTO nsw.up_permissiblelanduse VALUES ${values.join(',')}`, params)
    process.stdout.write(`\r  Inserted ${Math.min(i + BATCH, permRes.rows.length)} / ${permRes.rows.length}`)
  }
  console.log('\n  Creating index…')
  await dst.query('CREATE INDEX idx_perm_epititle_zone ON nsw.up_permissiblelanduse (epititle, zone)')
  console.log('  ✓ up_permissiblelanduse done')

  // 3. Copy up_property_comprehensive (5.2M rows) — stream in batches
  console.log('\n── Copying up_property_comprehensive ──')

  // Get column list (skip geometry columns — we'll handle centroid_lat/lon instead)
  const colRes = await src.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='urbanportaldbp' AND table_name='up_property_comprehensive'
    AND data_type != 'USER-DEFINED'
    ORDER BY ordinal_position
  `)
  const cols = colRes.rows.map(r => r.column_name)
  console.log(`  ${cols.length} non-geometry columns`)

  // Create table on destination
  await dst.query('DROP TABLE IF EXISTS nsw.up_property_comprehensive')
  // Use text type for everything (simplest, works for queries)
  const colDefs = cols.map(c => `"${c}" text`).join(', ')
  await dst.query(`CREATE TABLE nsw.up_property_comprehensive (${colDefs})`)
  console.log('  Table created')

  // Stream data in chunks using cursor
  const CHUNK = 50000
  let offset = 0
  let total = 0
  const colList = cols.map(c => `"${c}"`).join(',')

  while (true) {
    const chunk = await src.query(`SELECT ${colList} FROM urbanportaldbp.up_property_comprehensive LIMIT ${CHUNK} OFFSET ${offset}`)
    if (chunk.rows.length === 0) break

    // Build COPY-style insert
    const placeholders = cols.map((_, ci) => `$${ci + 1}`).join(',')
    const insertSql = `INSERT INTO nsw.up_property_comprehensive (${colList}) VALUES (${placeholders})`

    // Use a transaction for the batch
    await dst.query('BEGIN')
    for (const row of chunk.rows) {
      await dst.query(insertSql, cols.map(c => row[c]))
    }
    await dst.query('COMMIT')

    total += chunk.rows.length
    offset += CHUNK
    process.stdout.write(`\r  Copied ${total} rows…`)
  }

  console.log(`\n  Total: ${total} rows`)
  console.log('  Creating indexes…')
  await dst.query(`CREATE INDEX idx_prop_address ON nsw.up_property_comprehensive USING gin ("address" gin_trgm_ops)`)
  await dst.query(`CREATE INDEX idx_prop_zone ON nsw.up_property_comprehensive ("lzn_sym_code")`)
  await dst.query(`CREATE INDEX idx_prop_lga ON nsw.up_property_comprehensive ("lga_name")`)
  await dst.query(`CREATE INDEX idx_prop_latlon ON nsw.up_property_comprehensive (("centroid_lat"::float8), ("centroid_lon"::float8))`)
  console.log('  ✓ up_property_comprehensive done')

  // Cleanup
  await src.end()
  await dst.end()
  tunnel.server.close()
  tunnel.ssh.end()
  console.log('\nAll done!')
}

run().catch(e => { console.error(e); process.exit(1) })
