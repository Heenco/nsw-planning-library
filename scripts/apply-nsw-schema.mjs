/**
 * Apply db/nsw-schema.sql against the kg database via the same SSH tunnel
 * the rest of the app uses. Idempotent — drops and recreates the nsw schema.
 *
 * Usage:  node scripts/apply-nsw-schema.mjs
 */
import 'dotenv/config'
import pg from 'pg'
import { Client as SSHClient } from 'ssh2'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_FILE = path.join(__dirname, '..', 'db', 'nsw-schema.sql')

function createTunnel() {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient()
    ssh.on('ready', () => {
      const srv = net.createServer((sock) => {
        ssh.forwardOut(
          '127.0.0.1', sock.localPort ?? 0,
          process.env.KG_PG_HOST ?? 'localhost',
          Number(process.env.KG_PG_PORT ?? 5432),
          (err, stream) => {
            if (err) { sock.destroy(); return }
            sock.pipe(stream).pipe(sock)
          },
        )
      })
      srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, ssh, srv }))
    })
    ssh.on('error', reject)
    ssh.connect({
      host: process.env.KG_SSH_HOST ?? '45.79.118.32',
      port: Number(process.env.KG_SSH_PORT ?? 22),
      username: process.env.KG_SSH_USER ?? 'root',
      privateKey: readFileSync(process.env.KG_SSH_KEY_PATH ?? 'C:\\Users\\ManniKheradmandi\\Downloads\\dev_key'),
    })
  })
}

async function run() {
  console.log(`[apply-nsw-schema] reading ${SCHEMA_FILE}`)
  const sql = readFileSync(SCHEMA_FILE, 'utf8')

  const { port, ssh, srv } = await createTunnel()
  console.log(`[apply-nsw-schema] tunnel ready on 127.0.0.1:${port}`)

  const pool = new Pool({
    host: '127.0.0.1',
    port,
    database: process.env.KG_PG_DATABASE ?? 'kg',
    user: process.env.KG_PG_USER ?? 'postgres',
    password: process.env.KG_PG_PASSWORD ?? '',
    max: 1,
  })

  const client = await pool.connect()
  try {
    console.log('[apply-nsw-schema] applying schema…')
    await client.query(sql)
    console.log('[apply-nsw-schema] ✓ schema applied')

    // Sanity check: list created tables
    const r = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'nsw'
      ORDER BY table_name
    `)
    console.log('[apply-nsw-schema] tables in nsw schema:')
    for (const row of r.rows) console.log(`  - nsw.${row.table_name}`)
  } finally {
    client.release()
  }

  await pool.end()
  srv.close()
  ssh.end()
  console.log('[apply-nsw-schema] done')
}

run().catch((err) => {
  console.error('[apply-nsw-schema] FAILED:', err)
  process.exit(1)
})
