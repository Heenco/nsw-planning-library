/**
 * Load the CDC type catalogue into Postgres, from the three files that used to be read at runtime.
 *
 *   npx tsx scripts/build-cdc-type-catalogue.ts [--dry]
 *
 * After this, `cdc.type`, `cdc.type_requirement` and `cdc.type_check` are authoritative: /cdc
 * renders them and /api/cdc/types evaluates them. The shared/*.ts files are the seed for the first
 * load, not a second source of truth.
 *
 * RE-RUNNABLE. Every load replaces the three tables in one transaction, so a half-written catalogue
 * is never visible to a reader — the same reason the GEODAAS loader swaps schemas rather than
 * truncating in place.
 *
 * WHAT IT MERGES
 *   cdc-criteria.ts          the 12 types, their 97 requirements and the 31 checks we can run
 *   cdc-type-corrections.ts  17 corrections; `diverge` ones are rows where OUR test contradicts
 *                            the clause, and they are carried onto the requirement they belong to
 *   cdc-permissibility.ts    clause 1.18(1)(b): the land use each code turns on
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDC_TYPES } from '../shared/cdc-criteria'
import { CDC_TYPE_NOTES } from '../shared/cdc-type-corrections'
import { INFERRED_USE, USE_FOR_TYPE } from '../shared/cdc-permissibility'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

/**
 * Sheets in the workbook that are NOT complying development, and so do not belong on /cdc.
 *
 * The workbook carries mid-rise because it is part of the same Housing SEPP reading, but clause 182
 * is a DEVELOPMENT APPLICATION pathway - there is no complying development certificate at the end
 * of it. Listing it beside the twelve codes invited the reading that a mid-rise proposal could be
 * certified, which is wrong in the expensive direction.
 *
 * Excluded at load rather than deleted from the seed: the seed is a faithful record of the
 * workbook, which does contain this sheet. What is recorded here is our judgement about it.
 *
 * Its own pathway is on /pattern-book, where the low-rise CDC and mid-rise DA routes are already
 * drawn apart.
 */
const EXCLUDED_TYPES: Record<string, string> = {
  'mid-rise-housing-pattern': 'Housing SEPP cl 182 is a DA pathway, not complying development',
}

function databaseUrl(): string {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='))
  if (!line) throw new Error('DATABASE_URL not in .env')
  return line.slice('DATABASE_URL='.length).trim()
}

/**
 * Requirements the workbook records as untested that we can in fact answer today.
 *
 * Every layer named here is already loaded and already tested for some other type - these clauses
 * were simply never mapped to a column. Keyed "type|clause", giving the column the route evaluates
 * and the phrase the page shows.
 *
 * In the loader rather than applied as SQL, because `npm run build:cdccatalogue` replaces the
 * tables: a one-off UPDATE would be erased by the next load, which is exactly the kind of silent
 * regression moving the catalogue into data was meant to end.
 */
const WIRING: Record<string, { column: string; says: string }> = {
  // bush fire: 269,248 features in cdc.bushfire_prone_land. Terraces only - 3B.2(g) does not reach
  // manor houses, which is one of the nine recorded divergences.
  'multi-dwelling-housing-terraces|3B.2(g)': { column: 'bushfire_prone', says: 'not on bush fire prone land' },

  // landslide: cdc.landslide_risk, 17,483 features, already tested for five other types
  'multi-dwelling-housing-terraces|3B.2(j)': { column: 'landsliderisk', says: 'no landslide risk mapped on the lot' },
  'manor-houses|3B.2(j)':                    { column: 'landsliderisk', says: 'no landslide risk mapped on the lot' },
  'inland-dwelling-houses|3D.4(l)':          { column: 'landsliderisk', says: 'no landslide risk mapped on the lot' },

  // the Greenfield Code EXCLUDES these codes from its area - the inverse of the test the greenfield
  // type itself runs, so it needs its own column rather than reusing ghc_lay_class
  'dwelling-houses|3C.3(b)':        { column: 'ghc_excluded', says: 'outside the Greenfield Housing Code area' },
  'inland-dwelling-houses|3D.1(2)': { column: 'ghc_excluded', says: 'outside the Greenfield Housing Code area' },
  'inland-farm-buildings|3D.1(2)':  { column: 'ghc_excluded', says: 'outside the Greenfield Housing Code area' },

  // 14 esa.* layers and 4 heritage layers already answer these for the general sweep
  'secondary-dwelling|54(3)(b)': { column: 'esa_land', says: 'not on an environmentally sensitive area' },
  'secondary-dwelling|54(3)(c)': { column: 'heritage_item', says: 'no heritage item or conservation area on the lot' },
}

/** The corrections that belong to one requirement, matched on the clause the workbook prints. */
function notesFor(typeKey: string, clause: string | null) {
  const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase()
  return (CDC_TYPE_NOTES as any[]).filter(n => n.type === typeKey && norm(n.clause) === norm(clause))
}

async function main() {
  const types = (CDC_TYPES as any[]).filter(t => !EXCLUDED_TYPES[t.key])
  for (const [k, why] of Object.entries(EXCLUDED_TYPES)) {
    const found = (CDC_TYPES as any[]).some(t => t.key === k)
    console.log(`excluded: ${k}${found ? '' : ' (NOT IN THE SEED - stale exclusion?)'} - ${why}`)
  }
  const rows = { type: 0, requirement: 0, check: 0, diverge: 0, textFix: 0, wired: 0 }

  const sql: { text: string; values: any[] }[] = []
  types.forEach((t, ti) => {
    const uses = USE_FOR_TYPE[t.key] ?? []
    sql.push({
      text: `INSERT INTO cdc.type (key, name, code, sheet, inherits_general, note, ord,
                                   land_uses, land_uses_inferred)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      values: [t.key, t.name, t.code, t.sheet ?? null, t.inheritsGeneral !== false,
               t.note ?? null, ti, uses, INFERRED_USE.has(t.key)],
    })
    rows.type++

    ;(t.requirements ?? []).forEach((r: any, ri: number) => {
      const ns = notesFor(t.key, r.clause)
      const diverge = ns.find(n => n.kind === 'diverge')
      const textFix = ns.find(n => n.kind === 'text')
      if (diverge) rows.diverge++
      if (textFix) rows.textFix++
      const wired = WIRING[`${t.key}|${r.clause}`]
      if (wired) rows.wired++
      sql.push({
        text: `INSERT INTO cdc.type_requirement
                 (type_key, ord, clause, text, sub_items, href, data_source, sources, source_note,
                  note, tested, tested_by, diverges, diverge_why, text_fix)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        values: [t.key, ri, r.clause ?? null, r.text ?? '', r.subItems ?? [], r.href ?? null,
                 r.dataSource ?? null, JSON.stringify(r.sources ?? []), r.sourceNote ?? null,
                 r.note ?? null, Boolean(r.tested) || Boolean(wired),
                 wired ? wired.column : (r.testedBy ?? null),
                 Boolean(diverge), diverge?.what ?? null, textFix?.what ?? null],
      })
      rows.requirement++
    })

    // a wired requirement is a check too, in its own test so it is never confused with a workbook
    // variant - the inland sheet's variants are real and must stay distinguishable
    const wiredHere = (t.requirements ?? [])
      .map((r: any) => ({ r, w: WIRING[`${t.key}|${r.clause}`] }))
      .filter((x: any) => x.w)
    wiredHere.forEach((x: any, i: number) => {
      sql.push({
        text: `INSERT INTO cdc.type_check (type_key, test_key, test_name, ord, column_tested, says)
               VALUES ($1,$2,$3,$4,$5,$6)`,
        values: [t.key, 'wired', 'Already answerable', i, x.w.column, `${x.r.clause}: ${x.w.says}`],
      })
      rows.check++
    })

    ;(t.tests ?? []).forEach((te: any) => {
      ;(te.checks ?? []).forEach((c: any, ci: number) => {
        sql.push({
          text: `INSERT INTO cdc.type_check (type_key, test_key, test_name, ord, column_tested, says)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
          values: [t.key, te.key, te.name ?? null, ci, c.column, c.says],
        })
        rows.check++
      })
    })
  })

  // every correction should have landed on a requirement; one that did not is a silent loss
  const placed = new Set<string>()
  types.forEach(t => (t.requirements ?? []).forEach((r: any) => {
    for (const n of notesFor(t.key, r.clause)) placed.add(`${n.type}|${n.clause}|${n.kind}`)
  }))
  const orphans = (CDC_TYPE_NOTES as any[])
    .filter(n => !EXCLUDED_TYPES[n.type])      // its type is gone; the note goes with it
    .filter(n => !placed.has(`${n.type}|${n.clause}|${n.kind}`))
    .map(n => `${n.type} ${n.clause} (${n.kind})`)

  console.log(`types ${rows.type} · requirements ${rows.requirement} · checks ${rows.check}`)
  console.log(`corrections placed: ${rows.diverge} diverge, ${rows.textFix} text`)
  console.log(`wired from untested: ${rows.wired}`)
  const unmatched = Object.keys(WIRING).filter(k => {
    const [tk, cl] = k.split('|')
    return !types.some(t => t.key === tk && (t.requirements ?? []).some((r: any) => r.clause === cl))
  })
  if (unmatched.length) {
    console.log(`\n${unmatched.length} wiring entr(ies) match no requirement - stale:`)
    for (const u of unmatched) console.log('   ' + u)
    throw new Error('a wiring entry names a requirement that does not exist')
  }
  if (orphans.length) {
    console.log(`\n${orphans.length} correction(s) matched NO requirement and would be lost:`)
    for (const o of orphans) console.log('   ' + o)
  }
  if (DRY) { console.log('\n--dry: nothing written'); return }
  if (orphans.length) {
    throw new Error('refusing to load while corrections would be dropped - fix the clause match first')
  }

  const c = new Client({ connectionString: databaseUrl(), statement_timeout: 600000 })
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query(fs.readFileSync(path.join(ROOT, 'db/nsw-schema-migration-15-cdc-type-catalogue.sql'), 'utf8'))
    // a replace, not an append: the load is the whole catalogue or none of it
    await c.query('TRUNCATE cdc.type_check, cdc.type_requirement, cdc.type RESTART IDENTITY CASCADE')
    for (const s of sql) await c.query(s.text, s.values)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  }

  const check = await c.query(`
    SELECT (SELECT count(*) FROM cdc.type) AS types,
           (SELECT count(*) FROM cdc.type_requirement) AS requirements,
           (SELECT count(*) FROM cdc.type_check) AS checks,
           (SELECT count(*) FROM cdc.type_requirement WHERE diverges) AS diverges,
           (SELECT count(*) FROM cdc.type WHERE cardinality(land_uses) > 0) AS with_land_use`)
  console.log('\nin the database:', JSON.stringify(check.rows[0]))
  await c.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
