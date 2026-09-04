/**
 * What can the connecting role actually do on this server?
 *
 * Full table grants inside one database say nothing about whether the role
 * may CREATE a new database — that is a role attribute, not a grant. Check
 * before planning around it. Read-only.
 *
 * Usage: node scripts/kg-role-check.mjs
 */

import 'dotenv/config'
import pg from 'pg'

const url = (process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || '').trim()
if (!url) { process.stderr.write('DATABASE_URL is not set (see .env).\n'); process.exit(1) }

const client = new pg.Client({ connectionString: url, statement_timeout: 60_000 })
const L = (s = '') => process.stdout.write(s + '\n')

try {
  await client.connect()

  const [me] = (await client.query(`
    SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
           r.rolcanlogin, r.rolreplication, r.rolbypassrls
    FROM pg_roles r WHERE r.rolname = current_user`)).rows
  L(`role: ${me.rolname}`)
  L(`  superuser   : ${me.rolsuper}`)
  L(`  CREATEDB    : ${me.rolcreatedb}   <- needed to create a new database`)
  L(`  CREATEROLE  : ${me.rolcreaterole}`)
  L(`  bypassrls   : ${me.rolbypassrls}`)

  const memberships = (await client.query(`
    SELECT g.rolname AS grp FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
    JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = current_user`)).rows
  L(`  member of   : ${memberships.map((r) => r.grp).join(', ') || '(none)'}`)

  const dbs = (await client.query(`
    SELECT d.datname,
           pg_get_userbyid(d.datdba) AS owner,
           pg_size_pretty(pg_database_size(d.datname)) AS size,
           has_database_privilege(current_user, d.datname, 'CONNECT') AS can_connect,
           has_database_privilege(current_user, d.datname, 'CREATE')  AS can_create_schema
    FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname`)).rows
  L('\ndatabases on this server:')
  L(`  ${'name'.padEnd(22)} ${'owner'.padEnd(14)} ${'size'.padStart(10)}  connect  create-schema`)
  for (const d of dbs) {
    L(`  ${d.datname.padEnd(22)} ${String(d.owner).padEnd(14)} ${String(d.size).padStart(10)}`
      + `  ${String(d.can_connect).padEnd(7)}  ${d.can_create_schema}`)
  }

  L('\nverdict:')
  if (me.rolsuper) L('  superuser — can create the database directly.')
  else if (me.rolcreatedb) L('  has CREATEDB — can create `planningai` directly.')
  else L('  CANNOT create a database. Needs a superuser, or CREATEDB granted:\n'
       + '    ALTER ROLE nsw_reader CREATEDB;');
} catch (err) {
  process.stderr.write(`\nFAILED: ${err.message}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
