/**
 * Knowledge Graph PostgreSQL pool with SSH tunnel.
 *
 * Lazily creates an SSH tunnel to the remote server,
 * then connects pg.Pool through it. Singleton — one tunnel + pool per process.
 */

import pg from 'pg'
import { readFileSync } from 'node:fs'
import net from 'node:net'

const { Pool } = pg

let pool: pg.Pool | null = null
let tunnel: net.Server | null = null
let sshClient: any = null
let localPort: number | null = null

/** Returns the local SSH tunnel port (after getKgPool() has been called). */
export function getTunnelPort(): number | null {
  return localPort
}

function getConfig() {
  return {
    ssh: {
      host: process.env.KG_SSH_HOST ?? '45.79.118.32',
      port: Number(process.env.KG_SSH_PORT ?? 22),
      username: process.env.KG_SSH_USER ?? 'root',
      privateKey: readFileSync(process.env.KG_SSH_KEY_PATH ?? 'C:\\Users\\ManniKheradmandi\\Downloads\\dev_key'),
    },
    pg: {
      host: process.env.KG_PG_HOST ?? 'localhost',
      port: Number(process.env.KG_PG_PORT ?? 5432),
      database: process.env.KG_PG_DATABASE ?? 'kg',
      user: process.env.KG_PG_USER ?? 'postgres',
      password: process.env.KG_PG_PASSWORD ?? '',
    },
  }
}

async function createTunnel(): Promise<number> {
  const { Client: SSHClient } = await import('ssh2')
  return new Promise((resolve, reject) => {
    const config = getConfig()
    sshClient = new SSHClient()

    sshClient.on('ready', () => {
      // Create a local TCP server that forwards to remote PG through SSH
      tunnel = net.createServer((sock) => {
        sshClient!.forwardOut(
          '127.0.0.1', sock.localPort ?? 0,
          config.pg.host, config.pg.port,
          (err: Error | undefined, stream: NodeJS.ReadWriteStream) => {
            if (err) { sock.destroy(); return }
            sock.pipe(stream).pipe(sock)
          },
        )
      })

      tunnel.listen(0, '127.0.0.1', () => {
        const addr = tunnel!.address() as net.AddressInfo
        localPort = addr.port
        console.log(`[KG] SSH tunnel ready: 127.0.0.1:${localPort} → ${config.ssh.host}:${config.pg.port}`)
        resolve(localPort)
      })

      tunnel.on('error', reject)
    })

    sshClient.on('error', (err: Error) => {
      console.error('[KG] SSH connection error:', err.message)
      reject(err)
    })

    sshClient.connect(config.ssh)
  })
}

export async function getKgPool(): Promise<pg.Pool> {
  // If pool exists, test it's still alive
  if (pool) {
    try {
      const client = await pool.connect()
      client.release()
      return pool
    } catch {
      console.warn('[KG] Pool stale, reconnecting...')
      destroyKgPool()
    }
  }

  // Direct connection via DATABASE_URL — works on Vercel and any
  // environment without SSH tunnel access. Preferred when set.
  const databaseUrl = (process.env.DATABASE_URL || '').trim()
  if (databaseUrl) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
    })
    pool.on('error', (err) => {
      console.error('[KG] Pool error:', err.message)
      destroyKgPool()
    })
    const client = await pool.connect()
    try {
      const res = await client.query('SELECT current_database() AS db')
      const db = res.rows[0]?.db
      console.log(`[KG] Connected via DATABASE_URL to: ${db}`)

      // This server carries two databases that both have an `nsw` schema:
      // `planningai` holds the 19 tables the app needs, `kg` an older 11-table
      // subset without up_property_d_3. Pointing at the wrong one connects
      // cleanly and resolves the schema, so the first symptom is a query
      // failing with `relation "nsw.up_property_d_3" does not exist` — which
      // reads like a migration problem rather than a wrong connection string.
      const probe = await client.query(`SELECT to_regclass('nsw.up_property_d_3') AS reg`)
      if (!probe.rows[0]?.reg) {
        destroyKgPool()
        throw new Error(
          `DATABASE_URL points at the "${db}" database, which has no nsw.up_property_d_3. `
          + 'The property routes and the whole rule layer need the database holding the '
          + 'full nsw schema (planningai). Check the database name at the end of '
          + 'DATABASE_URL for this environment.',
        )
      }
    } finally {
      client.release()
    }
    return pool
  }

  // Fallback: SSH tunnel (local dev)
  const config = getConfig()
  const port = await createTunnel()

  pool = new Pool({
    host: '127.0.0.1',
    port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
    max: 5,
    idleTimeoutMillis: 30_000,
  })

  // Handle pool errors gracefully
  pool.on('error', (err) => {
    console.error('[KG] Pool error:', err.message)
    destroyKgPool()
  })

  // Test connection
  const client = await pool.connect()
  try {
    const res = await client.query('SELECT current_database() AS db')
    console.log(`[KG] Connected to database: ${res.rows[0]?.db}`)
  } finally {
    client.release()
  }

  return pool
}

export function destroyKgPool() {
  if (pool) { pool.end().catch(() => {}); pool = null }
  if (tunnel) { tunnel.close(); tunnel = null }
  if (sshClient) { sshClient.end(); sshClient = null }
  localPort = null
}
