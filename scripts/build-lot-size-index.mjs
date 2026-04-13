/**
 * build-lot-size-index.mjs
 *
 * Parses all NSW LEP XML files and extracts lot size / subdivision clauses:
 *   - 4.1  Minimum subdivision lot size
 *   - 4.1A Strata / boundary adjustment variants
 *   - 4.1AA Community title schemes
 *   - 4.1B Split zones
 *   - 2.6  Subdivision consent requirements (secondary dwellings etc.)
 *
 * Output: public/EPI/lot-size-index.json
 * Usage:  node scripts/build-lot-size-index.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const xmlDir = join(root, 'public', 'EPI', 'xml')
const indexPath = join(root, 'public', 'EPI', 'epi-index.json')
const outPath = join(root, 'public', 'EPI', 'lot-size-index.json')

// ── DOM helpers (mirrored from epiParser.ts) ──────────────────────────────────

function getChildren(el) {
  const result = []
  let node = el.firstChild
  while (node) {
    if (node.nodeType === 1) result.push(node)
    node = node.nextSibling
  }
  return result
}

function findChild(el, tag) {
  for (const child of getChildren(el)) {
    if (child.tagName === tag) return child
  }
  return null
}

function allByTag(root, tag) {
  return Array.from(root.getElementsByTagName(tag))
}

function textOf(el) {
  if (!el) return ''
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function blockToText(block) {
  if (!block) return ''
  const parts = []
  for (const child of getChildren(block)) {
    if (child.tagName === 'txt') {
      const t = textOf(child)
      if (t) parts.push(t)
    } else if (child.tagName === 'list') {
      for (const li of getChildren(child)) {
        if (li.tagName !== 'li') continue
        const noEl = findChild(li, 'no')
        const liBlock = findChild(li, 'block')
        const no = textOf(noEl)
        const txt = liBlock ? blockToText(liBlock) : ''
        if (txt) parts.push(no ? `${no} ${txt}` : txt)
      }
    }
  }
  return parts.join(' ')
}

// ── Extraction ────────────────────────────────────────────────────────────────

// All Part 4 development standards + cl. 2.6 (subdivision consent requirements)
const PART4_SECTION_RE = /^sec\.4\.[0-9A-Z]/
const EXTRA_SECTION_IDS = new Set(['sec.2.6'])

const SQM_RE = /([\d,]+)\s*square metres?/gi
const HA_RE = /(\d+(?:\.\d+)?)\s*ha\b/gi

function extractLotSizeClauses(xml, epicode, epiTitle) {
  const parser = new DOMParser({
    errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e } },
  })
  const doc = parser.parseFromString(xml, 'text/xml')
  const allLevels = allByTag(doc, 'level')
  const results = []

  const matchingSectionIds = allLevels
    .filter(l => {
      const id = l.getAttribute('id') ?? ''
      const type = l.getAttribute('type') ?? ''
      const status = l.getAttribute('status') ?? ''
      return type === 'clause' && status !== 'repealed' && !id.includes('-') &&
        (PART4_SECTION_RE.test(id) || EXTRA_SECTION_IDS.has(id))
    })
    .map(l => l.getAttribute('id'))

  for (const sectionId of matchingSectionIds) {
    const el = allLevels.find(
      l => l.getAttribute('id') === sectionId && l.getAttribute('status') !== 'repealed',
    )
    if (!el) continue

    const head = findChild(el, 'head')
    if (!head) continue
    const headingEl = findChild(head, 'heading')
    const noEl = findChild(head, 'no')
    const clauseHeading = textOf(headingEl)
    const clauseNo = textOf(noEl)
    if (!clauseHeading) continue

    // Skip [Not adopted] clauses
    const fullText = textOf(el)
    if (/^\[not adopted\]/i.test(fullText.trimStart().slice(0, 60))) continue

    // Extract subclauses
    const tierIdPrefix = sectionId + '-ssec.'
    const subclauses = []
    for (const tier of allByTag(el, 'tier')) {
      const tierId = tier.getAttribute('id') ?? ''
      if (!tierId.startsWith(tierIdPrefix)) continue
      const suffix = tierId.slice(tierIdPrefix.length)
      if (suffix.includes('-')) continue // skip deeply nested items
      if (tier.getAttribute('status') === 'repealed') continue
      const tHead = findChild(tier, 'head')
      const tBlock = findChild(tier, 'block')
      const tNo = tHead ? textOf(findChild(tHead, 'no')) : ''
      const tText = tBlock ? blockToText(tBlock) : ''
      if (!tText || tText.length < 5) continue
      subclauses.push({ no: tNo, text: tText })
    }

    // Extract zone code mentions from full text
    const zoneRe = /Zone\s+([A-Z][A-Z0-9]*)/g
    const zonesReferenced = []
    let zm
    while ((zm = zoneRe.exec(fullText)) !== null) {
      if (zm[1] && !zonesReferenced.includes(zm[1])) zonesReferenced.push(zm[1])
    }

    // Extract sqm values with surrounding context
    const valuesFound = []
    let m

    const sqmRe = new RegExp(SQM_RE.source, 'gi')
    while ((m = sqmRe.exec(fullText)) !== null) {
      const sqm = parseInt(m[1].replace(/,/g, ''), 10)
      if (!isNaN(sqm)) {
        const start = Math.max(0, m.index - 100)
        valuesFound.push({ sqm, context: fullText.slice(start, m.index + m[0].length).trim() })
      }
    }

    const haRe = new RegExp(HA_RE.source, 'gi')
    while ((m = haRe.exec(fullText)) !== null) {
      const ha = parseFloat(m[1])
      if (!isNaN(ha)) {
        const sqm = Math.round(ha * 10000)
        const start = Math.max(0, m.index - 100)
        valuesFound.push({ sqm, ha, context: fullText.slice(start, m.index + m[0].length).trim() })
      }
    }

    // Deduplicate values by sqm
    const seen = new Set()
    const uniqueValues = valuesFound.filter(v => {
      if (seen.has(v.sqm)) return false
      seen.add(v.sqm)
      return true
    })

    results.push({
      epicode,
      epiTitle,
      clauseId: clauseNo || sectionId.replace('sec.', ''),
      sectionId,
      clauseHeading,
      zonesReferenced,
      valuesFound: uniqueValues,
      hasMapReference: /lot size map/i.test(fullText),
      subclauses,
      // Cap rawText to avoid huge file — full clause text for human review
      rawText: fullText.slice(0, 8000),
    })
  }

  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

const epiIndex = JSON.parse(readFileSync(indexPath, 'utf-8'))
const allRecords = []
let processed = 0
let skipped = 0

console.log(`Processing ${epiIndex.length} EPIs…\n`)

for (const { code, title } of epiIndex) {
  const xmlPath = join(xmlDir, `${code}.xml`)
  if (!existsSync(xmlPath)) {
    console.warn(`  SKIP ${code} — file not found`)
    skipped++
    continue
  }

  let xml
  try {
    xml = readFileSync(xmlPath, 'utf-8')
  } catch (e) {
    console.warn(`  READ ERROR ${code}: ${e.message}`)
    skipped++
    continue
  }

  try {
    const records = extractLotSizeClauses(xml, code, title)
    allRecords.push(...records)
    processed++
    process.stdout.write(`\r  ${processed}/${epiIndex.length} processed, ${allRecords.length} records found`)
  } catch (e) {
    console.warn(`\n  PARSE ERROR ${code}: ${e.message}`)
    skipped++
  }
}

console.log(`\n\nDone:`)
console.log(`  ${processed} EPIs processed, ${skipped} skipped`)
console.log(`  ${allRecords.length} total clause records extracted`)

const clauseCounts = {}
for (const r of allRecords) {
  clauseCounts[r.clauseId] = (clauseCounts[r.clauseId] ?? 0) + 1
}
console.log('\nClause breakdown:')
for (const [id, count] of Object.entries(clauseCounts).sort()) {
  console.log(`  ${id.padEnd(8)} ${count} EPIs`)
}

writeFileSync(outPath, JSON.stringify(allRecords, null, 2))
console.log(`\nOutput → public/EPI/lot-size-index.json (${(JSON.stringify(allRecords).length / 1024).toFixed(1)} KB)`)
