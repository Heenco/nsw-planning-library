/**
 * Apply a specific nsw schema migration file.
 *   node scripts/apply-nsw-migration.mjs <filename>
 *
 * Connects the way the app does: DATABASE_URL when set (the `planningai`
 * database, direct), otherwise the SSH tunnel to the legacy `kg` box. Before
 * this it only knew the tunnel, so `npm run db:migrate` applied every file to
 * the wrong database while the app read from the right one — which is how
 * migration 11's indexes came to be declared but never built on the table the
 * routes query.
 *
 * The server's global `statement_timeout` is 60 s. An index build over d_4's
 * 10 GB heap takes longer than that, so the session lifts it; a migration that
 * needs it lower can SET it back itself.
 */
import 'dotenv/config'
import pg from 'pg'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const filename = process.argv[2]
if (!filename) { console.error('usage: node scripts/apply-nsw-migration.mjs <filename>'); process.exit(1) }
const fullPath = path.isAbsolute(filename) ? filename : path.join(__dirname, '..', 'db', filename)

async function createTunnel() {
  const { Client: SSH } = await import('ssh2')
  return new Promise((resolve, reject) => {
    const ssh = new SSH()
    ssh.on('ready', () => {
      const srv = net.createServer((sock) => {
        ssh.forwardOut('127.0.0.1', sock.localPort ?? 0,
          process.env.KG_PG_HOST ?? 'localhost',
          Number(process.env.KG_PG_PORT ?? 5432),
          (err, stream) => { if (err) { sock.destroy(); return }; sock.pipe(stream).pipe(sock) })
      })
      srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, ssh, srv }))
    })
    ssh.on('error', reject)
    ssh.connect({
      host: process.env.KG_SSH_HOST ?? '45.79.118.32',
      port: Number(process.env.KG_SSH_PORT ?? 22),
      username: process.env.KG_SSH_USER ?? 'root',
      privateKey: readFileSync(process.env.KG_SSH_KEY_PATH ?? 'C:\Users\ManniKheradmandi\Downloads\dev_key'),
    })
  })
}

const sql = readFileSync(fullPath, 'utf8')

const databaseUrl = (process.env.DATABASE_URL || '').trim()
let tunnel = null
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 1 })
  : await (async () => {
      tunnel = await createTunnel()
      return new Pool({
        host: '127.0.0.1', port: tunnel.port,
        database: process.env.KG_PG_DATABASE ?? 'kg',
        user: process.env.KG_PG_USER ?? 'postgres',
        password: process.env.KG_PG_PASSWORD ?? '',
        max: 1,
      })
    })()

const c = await pool.connect()
try {
  const { rows } = await c.query('SELECT current_database() AS db, current_user AS usr')
  console.log(`[migration] ${databaseUrl ? 'DATABASE_URL' : 'SSH tunnel'} → ${rows[0].db} as ${rows[0].usr}`)
  await c.query('SET statement_timeout = 0')
  console.log(`[migration] applying ${path.basename(fullPath)}…`)
  const started = Date.now()
  await c.query(sql)
  console.log(`[migration] ✓ applied in ${((Date.now() - started) / 1000).toFixed(1)} s`)
} finally {
  c.release()
}
await pool.end()
if (tunnel) { tunnel.srv.close(); tunnel.ssh.end() }
