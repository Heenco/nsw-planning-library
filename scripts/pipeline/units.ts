/**
 * Step 3b of docs/precinct-sepp-pipeline.md: a reviewed profile's `unitKeys` become the authority for
 * nsw.instrument_unit_map.
 *
 *   npx tsx scripts/pipeline/units.ts --profile precincts-central-river-city-2021 --dry   # compare only
 *   npx tsx scripts/pipeline/units.ts --profile precincts-central-river-city-2021         # write
 *
 * For every unitKey in the profile the matching row (same layer, map_name, lay_class, label) is set to
 * status 'confirmed' with the profile's unit; a key the profile holds and the table does not is inserted;
 * a table row the profile does not mention is left 'proposed' and listed. A profile marked
 * "REVIEW STATUS: not reviewed" is refused without --dry: the review is the point (decision D3).
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import type { InstrumentProfile } from '../../profiles/housing-sepp-2021'

const argv = process.argv.slice(2)
const PROFILE = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1]! : null
const DRY = argv.includes('--dry')
if (!PROFILE) { console.error('usage: --profile <name> [--dry]'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params)

async function main() {
  const src = readFileSync(`profiles/${PROFILE}.ts`, 'utf8')
  const reviewed = !/REVIEW STATUS:\s*not reviewed/i.test(src)
  const profile: InstrumentProfile = (await import(`../../profiles/${PROFILE}.ts`)).default
  if (!profile.unitKeys?.length) { console.log(`${PROFILE}: no unitKeys`); await pool.end(); return }
  const doc = (await q(`SELECT id, title FROM nsw.document WHERE lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g')) = $1 OR instrument_slug = $1 LIMIT 1`, [profile.slug])).rows[0]
    ?? (await q(`SELECT id, title FROM nsw.document WHERE doc_type = 'sepp' AND title ILIKE $1 LIMIT 1`, ['%' + profile.label.replace(/^sepp-precincts-/, '').replace(/-2021$/, '').replace(/-/g, '%') + '%'])).rows[0]
  if (!doc) throw new Error(`no nsw.document for profile ${PROFILE} (slug ${profile.slug})`)
  if (!reviewed && !DRY) { console.error(`${PROFILE} is marked "REVIEW STATUS: not reviewed" - write refused (decision D3); use --dry`); process.exit(2) }
  const rows = (await q(`SELECT layer, map_name, lay_class, label, unit_local_id, status FROM nsw.instrument_unit_map WHERE document_id = $1`, [doc.id])).rows
  const key = (r: { layer: string; map_name: string | null; lay_class: string | null; label: string | null }) => [r.layer, r.map_name ?? '', r.lay_class ?? '', r.label ?? ''].join('\u0001')
  const have = new Map(rows.map(r => [key(r), r]))
  let same = 0, changed = 0, inserted = 0
  for (const k of profile.unitKeys) {
    const cur = have.get(key(k)); have.delete(key(k))
    const heading = k.unit ? (await q(`SELECT heading FROM nsw.section WHERE document_id = $1 AND local_id = $2 AND depth = 1`, [doc.id, k.unit])).rows[0]?.heading ?? null : null
    if (k.unit && heading == null) console.log(`  WARNING: ${k.unit} is not a top-level unit of ${doc.title}`)
    if (!cur) {
      inserted++
      console.log(`  insert   ${k.layer.replace('epi.epi_', '').padEnd(16)} ${(k.map_name ?? '').slice(0, 50).padEnd(50)} | ${(k.lay_class ?? '').slice(0, 24).padEnd(24)} | ${(k.label ?? '').slice(0, 28).padEnd(28)} -> ${k.unit ?? '(none)'} [${k.basis}]`)
      if (!DRY) await q(`INSERT INTO nsw.instrument_unit_map (document_id, layer, map_name, lay_class, label, unit_local_id, unit_heading, rule, matched_name, polygons, status, note)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 0, 'confirmed', $9)`,
        [doc.id, k.layer, k.map_name, k.lay_class, k.label, k.unit, heading, `profile ${PROFILE} (${k.basis})`, k.note ?? null])
      continue
    }
    if ((cur.unit_local_id ?? null) === (k.unit ?? null) && cur.status === 'confirmed') { same++; continue }
    changed++
    console.log(`  ${cur.unit_local_id === k.unit ? 'confirm ' : 'CHANGE  '} ${k.layer.replace('epi.epi_', '').padEnd(16)} ${(k.map_name ?? '').slice(0, 50).padEnd(50)} | ${(k.lay_class ?? '').slice(0, 24).padEnd(24)} | ${(k.label ?? '').slice(0, 28).padEnd(28)} ${cur.unit_local_id ?? '(none)'} -> ${k.unit ?? '(none)'} [${k.basis}]`)
    if (!DRY) await q(`UPDATE nsw.instrument_unit_map SET unit_local_id = $6, unit_heading = $7, status = 'confirmed', rule = $8, note = $9, computed_at = now()
                       WHERE document_id = $1 AND layer = $2 AND map_name IS NOT DISTINCT FROM $3 AND lay_class IS NOT DISTINCT FROM $4 AND label IS NOT DISTINCT FROM $5`,
      [doc.id, k.layer, k.map_name, k.lay_class, k.label, k.unit, heading, `profile ${PROFILE} (${k.basis})`, k.note ?? null])
  }
  for (const r of have.values()) console.log(`  unmentioned (left ${r.status}) ${r.layer.replace('epi.epi_', '')} ${(r.map_name ?? '').slice(0, 60)} | ${r.lay_class ?? ''} | ${r.label ?? ''} -> ${r.unit_local_id ?? '(none)'}`)
  console.log(`${doc.title}: ${profile.unitKeys.length} keys in the profile - ${same} already confirmed, ${changed} ${DRY ? 'would be ' : ''}confirmed/changed, ${inserted} ${DRY ? 'would be ' : ''}inserted, ${have.size} table rows the profile does not mention${DRY ? ' (dry)' : ''}`)
  await pool.end()
}
main().catch(e => { console.error(e); process.exit(1) })
