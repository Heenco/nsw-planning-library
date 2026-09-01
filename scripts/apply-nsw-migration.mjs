/**
 * Apply a specific nsw schema migration file.
 *   node scripts/apply-nsw-migration.mjs <filename>
 */
import 'dotenv/config'
import pg from 'pg'
import { Client as SSH } from 'ssh2'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const filename = process.argv[2]
if (!filename) { console.error('usage: node scripts/apply-nsw-migration.mjs <filename>'); process.exit(1) }
const fullPath = path.isAbsolute(filename) ? filename : path.join(__dirname, '..', 'db', filename)

function createTunnel() {
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
      privateKey: readFileSync(process.env.KG_SSH_KEY_PATH ?? 'C:\\Users\\ManniKheradmandi\\Downloads\\dev_key'),
    })
  })
}

const sql = readFileSync(fullPath, 'utf8')
const { port, ssh, srv } = await createTunnel()
const pool = new Pool({
  host: '127.0.0.1', port,
  database: process.env.KG_PG_DATABASE ?? 'kg',
  user: process.env.KG_PG_USER ?? 'postgres',
  password: process.env.KG_PG_PASSWORD ?? '',
  max: 1,
})
const c = await pool.connect()
try {
  console.log(`[migration] applying ${path.basename(fullPath)}…`)
  await c.query(sql)
  console.log('[migration] ✓ applied')
} finally {
  c.release()
}
await pool.end()
srv.close()
ssh.end()
