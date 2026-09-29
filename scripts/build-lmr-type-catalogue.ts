/**
 * Load the low and mid-rise housing catalogue - Housing SEPP 2021 Chapter 6 - into Postgres.
 *
 *   npx tsx scripts/build-lmr-type-catalogue.ts [--dry]
 *
 * After this, lmr.type, lmr.type_requirement, lmr.type_check and lmr.general are authoritative: /lmr
 * renders them and /api/lmr/types evaluates them. shared/lmr-criteria.ts is the seed, as
 * shared/cdc-criteria.ts is for the CDC catalogue (scripts/build-cdc-type-catalogue.ts).
 *
 * RE-RUNNABLE. Every load replaces the four tables in one transaction, so a half-written catalogue is
 * never visible to a reader.
 *
 * WHAT IT REFUSES
 *   - a requirement marked tested whose `testedBy` names no check of its type: the page would claim a test
 *     the route never runs
 *   - an s 164 item that names a layer table the lmr schema does not have: the route would read nothing
 *     and call the lot clear of it
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LMR_GENERAL, LMR_TYPES, lmrHref } from '../shared/lmr-criteria'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

function databaseUrl(): string {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='))
  if (!line) throw new Error('DATABASE_URL not in .env')
  return line.slice('DATABASE_URL='.length).trim()
}

async function main() {
  const problems: string[] = []
  const sql: { text: string; values: any[] }[] = []
  const rows = { type: 0, requirement: 0, check: 0, general: 0, tested: 0 }

  LMR_TYPES.forEach((t, ti) => {
    sql.push({
      text: `INSERT INTO lmr.type (key, name, part, sections, zones, land_uses, sepp_permits_in,
                                   sepp_permits_clause, allowances, note, ord)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      values: [t.key, t.name, t.part, t.sections, t.zones, t.landUses, t.seppPermitsIn,
               t.seppPermitsClause, JSON.stringify(t.allowances), t.note ?? null, ti],
    })
    rows.type++

    const columns = new Set(t.checks.map(c => c.column as string))
    t.requirements.forEach((r, ri) => {
      if (r.tested && (!r.testedBy || !columns.has(r.testedBy))) {
        problems.push(`${t.key} ${r.clause}: tested by "${r.testedBy}", which is not one of its checks`)
      }
      if (!r.tested && !r.untested) problems.push(`${t.key} ${r.clause}: untested with no reason`)
      sql.push({
        text: `INSERT INTO lmr.type_requirement (type_key, ord, clause, text, href, tested, tested_by, untested_why, derived)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        values: [t.key, ri, r.clause, r.text, lmrHref(r.clause), r.tested, r.testedBy ?? null,
                 r.untested ?? null, r.derived ?? null],
      })
      rows.requirement++
      if (r.tested) rows.tested++
    })

    t.checks.forEach((c, ci) => {
      sql.push({
        text: `INSERT INTO lmr.type_check (type_key, ord, column_tested, says) VALUES ($1,$2,$3,$4)`,
        values: [t.key, ci, c.column, c.says],
      })
      rows.check++
    })
  })

  LMR_GENERAL.forEach((g, gi) => {
    sql.push({
      text: `INSERT INTO lmr.general (clause, ord, text, href, layer_keys, fail_where, unknown_where,
                                      lga_scope, held_lgas, coverage, caveat)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      values: [g.clause, gi, g.text, lmrHref(g.clause), g.layers, g.failWhere ?? null, g.unknownWhere ?? null,
               g.lgaScope ?? null, g.heldLgas ?? null, g.coverage, g.caveat ?? null],
    })
    rows.general++
    if (g.coverage !== 'none' && !g.layers.length) problems.push(`${g.clause}: coverage ${g.coverage} with no layers`)
  })

  const c = new Client({ connectionString: databaseUrl(), statement_timeout: 600000 })
  await c.connect()
  try {
    // every layer an s 164 item names has to exist, or the route would read nothing and call the lot clear
    const { rows: have } = await c.query(
      `SELECT f_table_name AS t FROM geometry_columns WHERE f_table_schema = 'lmr'`)
    const tables = new Set(have.map((r: any) => r.t))
    for (const g of LMR_GENERAL) {
      for (const l of g.layers) if (!tables.has(l)) problems.push(`${g.clause}: layer lmr.${l} does not exist`)
    }

    console.log(`types ${rows.type} · requirements ${rows.requirement} (${rows.tested} tested) · checks ${rows.check} · s 164 items ${rows.general}`)
    if (problems.length) {
      console.log(`\n${problems.length} problem(s):`)
      for (const p of problems) console.log('   ' + p)
      throw new Error('refusing to load the catalogue until these are fixed')
    }
    if (DRY) { console.log('\n--dry: nothing written'); return }

    await c.query('BEGIN')
    await c.query(fs.readFileSync(path.join(ROOT, 'db/nsw-schema-migration-16-lmr-type-catalogue.sql'), 'utf8'))
    // a replace, not an append: the load is the whole catalogue or none of it
    await c.query('TRUNCATE lmr.type_check, lmr.type_requirement, lmr.type, lmr.general RESTART IDENTITY CASCADE')
    for (const s of sql) await c.query(s.text, s.values)
    await c.query('COMMIT')

    const check = await c.query(`
      SELECT (SELECT count(*) FROM lmr.type) AS types,
             (SELECT count(*) FROM lmr.type_requirement) AS requirements,
             (SELECT count(*) FROM lmr.type_requirement WHERE tested) AS tested,
             (SELECT count(*) FROM lmr.type_check) AS checks,
             (SELECT count(*) FROM lmr.general) AS general,
             (SELECT count(*) FROM lmr.general WHERE coverage <> 'full') AS general_not_full`)
    console.log('\nin the database:', JSON.stringify(check.rows[0]))
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
