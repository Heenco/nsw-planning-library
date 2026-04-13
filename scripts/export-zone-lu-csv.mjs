/**
 * export-zone-lu-csv.mjs
 *
 * Flattens public/EPI/zone-lu-index.json into a CSV for review in Excel /
 * Google Sheets. One row per (epicode × clause × zone). Subclauses are
 * concatenated into a single pipe-delimited text column.
 *
 * Usage: node scripts/export-zone-lu-csv.mjs
 * Output: public/EPI/zone-lu-review.csv
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const inPath = join(root, 'public', 'EPI', 'zone-lu-index.json')
const outPath = join(root, 'public', 'EPI', 'zone-lu-review.csv')

const data = JSON.parse(readFileSync(inPath, 'utf-8'))

function esc(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

const headers = [
  'epicode',
  'epiTitle',
  'clauseId',
  'clauseHeading',
  'zoneCode',
  'zoneTitle',
  'zoneFamily',
  'appliesToAllZones',
  'landUses',
  'sqmValues',
  'mValues',
  'percentValues',
  'mapReferenced',
  'subclauses',
]

const rows = [headers.join(',')]

for (const r of data) {
  const subclauses = (r.subclauses ?? [])
    .map(sc => `${sc.no} ${sc.text}`.trim())
    .join(' | ')

  rows.push([
    esc(r.epicode),
    esc(r.epiTitle),
    esc(r.clauseId),
    esc(r.clauseHeading),
    esc(r.zoneCode),
    esc(r.zoneTitle),
    esc(r.zoneFamily),
    esc(r.appliesToAllZones),
    esc((r.landUses ?? []).join(' | ')),
    esc((r.sqmValues ?? []).join(' | ')),
    esc((r.mValues ?? []).join(' | ')),
    esc((r.percentValues ?? []).join(' | ')),
    esc(r.mapReferenced),
    esc(subclauses),
  ].join(','))
}

writeFileSync(outPath, rows.join('\n'), 'utf-8')
console.log(`Written ${rows.length - 1} rows → public/EPI/zone-lu-review.csv`)
