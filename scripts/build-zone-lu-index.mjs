/**
 * build-zone-lu-index.mjs
 *
 * Produces a flat, self-contained lookup table:
 *   public/EPI/zone-lu-index.json
 *
 * Each row answers: "For this EPI × zone × land use, what are the Part 4
 * development standards and subdivision rules?"
 *
 * Key design decisions:
 *  - Zone resolution uses appliesToZone edges (authoritative, from XML structure),
 *    not text scanning. If no zone is mentioned → applies to ALL zones.
 *  - Land use resolution uses subjectTo edges. If none → null (general rule).
 *  - Covers all Part 4 clauses (4.1–4.6 families) + cl. 2.6.
 *  - Subclauses and sqm values are included inline (self-contained).
 *
 * Usage: node scripts/build-zone-lu-index.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMParser } from '@xmldom/xmldom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const xmlDir = join(root, 'public', 'EPI', 'xml')
const indexPath = join(root, 'public', 'EPI', 'epi-index.json')
const outPath = join(root, 'public', 'EPI', 'zone-lu-index.json')

// ── DOM helpers ───────────────────────────────────────────────────────────────

function getChildren(el) {
  const out = []
  let n = el.firstChild
  while (n) { if (n.nodeType === 1) out.push(n); n = n.nextSibling }
  return out
}
function findChild(el, tag) {
  for (const c of getChildren(el)) if (c.tagName === tag) return c
  return null
}
function allByTag(root, tag) { return Array.from(root.getElementsByTagName(tag)) }
function textOf(el) { return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : '' }
function toSlug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }
function zoneFamily(code) {
  if (/^RU/.test(code)) return 'RU'
  if (/^R\d/.test(code)) return 'R'
  if (/^B/.test(code)) return 'B'
  if (/^MU/.test(code)) return 'MU'
  if (/^IN/.test(code)) return 'IN'
  if (/^SP/.test(code)) return 'SP'
  if (/^RE/.test(code)) return 'RE'
  if (/^C/.test(code)) return 'C'
  if (/^W/.test(code)) return 'W'
  if (/^E/.test(code)) return 'E'
  return 'OTHER'
}

function blockToText(block) {
  if (!block) return ''
  const parts = []
  for (const child of getChildren(block)) {
    if (child.tagName === 'txt') {
      const t = textOf(child); if (t) parts.push(t)
    } else if (child.tagName === 'list') {
      for (const li of getChildren(child)) {
        if (li.tagName !== 'li') continue
        const no = textOf(findChild(li, 'no'))
        const txt = blockToText(findChild(li, 'block'))
        if (txt) parts.push(no ? `${no} ${txt}` : txt)
      }
    }
  }
  return parts.join(' ')
}

// ── Metric extraction ─────────────────────────────────────────────────────────

const SQM_RE = /([\d,]+)\s*(?:square metres?|m2|m²)/gi
const HA_RE = /(\d+(?:\.\d+)?)\s*ha\b/gi
const M_RE = /(\d+(?:\.\d+)?)\s*metres?\s*(?:in height|AHD|\b)/gi
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/g

function extractMetrics(text) {
  const sqmValues = []
  const mValues = []
  const percentValues = []

  let m
  const sqmRe = new RegExp(SQM_RE.source, 'gi')
  while ((m = sqmRe.exec(text)) !== null) {
    const v = parseInt(m[1].replace(/,/g, ''), 10)
    if (!isNaN(v) && !sqmValues.includes(v)) sqmValues.push(v)
  }
  const haRe = new RegExp(HA_RE.source, 'gi')
  while ((m = haRe.exec(text)) !== null) {
    const v = Math.round(parseFloat(m[1]) * 10000)
    if (!isNaN(v) && !sqmValues.includes(v)) sqmValues.push(v)
  }
  const mRe = new RegExp(M_RE.source, 'gi')
  while ((m = mRe.exec(text)) !== null) {
    const v = parseFloat(m[1])
    if (!isNaN(v) && !mValues.includes(v)) mValues.push(v)
  }
  const pRe = new RegExp(PERCENT_RE.source, 'g')
  while ((m = pRe.exec(text)) !== null) {
    const v = parseFloat(m[1])
    if (!isNaN(v) && !percentValues.includes(v)) percentValues.push(v)
  }
  return { sqmValues, mValues, percentValues }
}

// ── Zone extraction ───────────────────────────────────────────────────────────

function extractZones(doc) {
  const zones = []
  const zoneByCode = new Map()
  const levelEls = allByTag(doc, 'level')
  for (const el of levelEls) {
    if (el.getAttribute('type') !== 'clausegroup') continue
    if (el.getAttribute('status') === 'repealed') continue
    const head = findChild(el, 'head')
    if (!head) continue
    const noEl = findChild(head, 'no')
    if (!noEl) continue
    const noText = textOf(noEl)
    const codeMatch = noText.match(/^Zone\s+([A-Z][A-Z0-9]*)/)
    if (!codeMatch) continue
    const code = codeMatch[1]
    const title = textOf(findChild(head, 'heading'))
    const id = el.getAttribute('id') ?? `zone:${toSlug(code)}`
    const zone = { id, code, title, family: zoneFamily(code) }
    zones.push(zone)
    zoneByCode.set(code, zone)
  }
  return { zones, zoneByCode }
}

// ── Land use terms from zone permit/prohibit lists ────────────────────────────
// Returns a Map of slug → canonical term using the exact text from zone tables.
// This avoids the slug-mismatch problem between singular dictionary terms
// (e.g. "dual occupancy") and plural zone list terms ("Dual occupancies").

function extractZonedLuTerms(doc) {
  const map = new Map() // slug → term (first occurrence wins)
  const levelEls = allByTag(doc, 'level')
  for (const el of levelEls) {
    if (el.getAttribute('type') !== 'clausegroup') continue
    if (el.getAttribute('status') === 'repealed') continue
    const clauseEls = getChildren(el).filter(
      c => c.tagName === 'level' && c.getAttribute('type') === 'clause' && c.getAttribute('status') !== 'repealed'
    )
    for (const clause of clauseEls) {
      const cHead = findChild(clause, 'head')
      if (!cHead) continue
      const headingText = textOf(findChild(cHead, 'heading')).toLowerCase()
      if (!headingText.includes('with consent') && !headingText.includes('without consent') && !/^prohibited/.test(headingText)) continue
      const blockEl = findChild(clause, 'block')
      const txtEl = blockEl ? findChild(blockEl, 'txt') : null
      if (!txtEl) continue
      const raw = textOf(txtEl)
      raw.split(/;\s*/).map(s => s.trim()).filter(s => s.length > 3).forEach(term => {
        const slug = toSlug(term)
        if (!map.has(slug)) map.set(slug, term.toLowerCase())
      })
    }
  }
  return map
}

// ── Part 4 + cl.2.6 clause extraction ────────────────────────────────────────

const PART4_RE = /^sec\.4\.[0-9A-Z]/

function extractPart4Clauses(doc, zones, zoneByCode, zonedLuTerms) {
  const allLevels = allByTag(doc, 'level')

  const targetClauses = allLevels.filter(el => {
    const id = el.getAttribute('id') ?? ''
    const type = el.getAttribute('type') ?? ''
    const status = el.getAttribute('status') ?? ''
    return type === 'clause' && status !== 'repealed' && !id.includes('-') &&
      (PART4_RE.test(id) || id === 'sec.2.6')
  })

  const results = []

  for (const clause of targetClauses) {
    const sectionId = clause.getAttribute('id')
    const cHead = findChild(clause, 'head')
    if (!cHead) continue
    const headingEl = findChild(cHead, 'heading')
    const noEl = findChild(cHead, 'no')
    const clauseHeading = textOf(headingEl)
    const clauseNo = textOf(noEl)
    if (!clauseHeading) continue

    // Skip [Not adopted]
    const directBlock = findChild(clause, 'block')
    if (directBlock) {
      const directTxt = textOf(findChild(directBlock, 'txt'))
      if (/^\[not adopted\]/i.test(directTxt)) continue
    }

    const fullText = textOf(clause)

    // ── Zone resolution via text mention ──────────────────────────────────────
    // appliesToZone edges are built from zone mentions in full text.
    // If no zones mentioned → applies to all zones.
    const mentionedZoneCodes = []
    const zoneRe = /Zone\s+([A-Z][A-Z0-9]*)/g
    let zm
    while ((zm = zoneRe.exec(fullText)) !== null) {
      if (zm[1] && zoneByCode.has(zm[1]) && !mentionedZoneCodes.includes(zm[1])) {
        mentionedZoneCodes.push(zm[1])
      }
    }
    const appliesTo = mentionedZoneCodes.length > 0
      ? mentionedZoneCodes.map(c => zoneByCode.get(c))
      : zones  // applies to all zones

    // ── Subclause extraction ──────────────────────────────────────────────────
    const tierIdPrefix = sectionId + '-ssec.'
    const subclauses = []
    for (const tier of allByTag(clause, 'tier')) {
      const tierId = tier.getAttribute('id') ?? ''
      if (!tierId.startsWith(tierIdPrefix)) continue
      const suffix = tierId.slice(tierIdPrefix.length)
      if (suffix.includes('-')) continue
      if (tier.getAttribute('status') === 'repealed') continue
      const tHead = findChild(tier, 'head')
      const tBlock = findChild(tier, 'block')
      const tNo = tHead ? textOf(findChild(tHead, 'no')) : ''
      const tText = tBlock ? blockToText(tBlock) : ''
      if (!tText || tText.length < 5) continue
      if (/^the objectives? of this clause/i.test(tText)) continue
      subclauses.push({ no: tNo, text: tText })
    }

    // ── Land use mentions — search heading + all subclause text ─────────────
    // Use terms from zone permit/prohibit lists (authoritative, as-used in zone tables).
    // Search both the clause heading and subclause body — headings often name the
    // land use (e.g. "Minimum lot size for dual occupancies") even when the body doesn't.
    const searchText = (clauseHeading + ' ' + subclauses.map(s => s.text).join(' ')).toLowerCase()
    const mentionedLandUses = []
    for (const [slug, term] of zonedLuTerms) {
      const lu = term // already lowercased
      const matches = searchText.includes(lu)
        || (lu.endsWith('y') && searchText.includes(lu.replace(/y$/, 'ies')))
        || (lu.endsWith('ies') && searchText.includes(lu.replace(/ies$/, 'y')))
        || (lu.endsWith('s') && lu.length > 4 && searchText.includes(lu.slice(0, -1)))
      if (matches) mentionedLandUses.push(term)
    }

    // ── Metrics ───────────────────────────────────────────────────────────────
    const metrics = extractMetrics(searchText)

    // ── Emit one row per applicable zone ─────────────────────────────────────
    for (const zone of appliesTo) {
      results.push({
        sectionId,
        clauseId: clauseNo || sectionId.replace('sec.', ''),
        clauseHeading,
        zoneCode: zone.code,
        zoneTitle: zone.title,
        zoneFamily: zone.family,
        appliesToAllZones: mentionedZoneCodes.length === 0,
        landUses: mentionedLandUses.length > 0 ? mentionedLandUses : null,
        sqmValues: metrics.sqmValues,
        mValues: metrics.mValues,
        percentValues: metrics.percentValues,
        mapReferenced: /lot size map/i.test(fullText),
        subclauses,
      })
    }
  }

  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

const epiIndex = JSON.parse(readFileSync(indexPath, 'utf-8'))
const allRows = []
let processed = 0, skipped = 0

console.log(`Processing ${epiIndex.length} EPIs…\n`)

for (const { code, title } of epiIndex) {
  const xmlPath = join(xmlDir, `${code}.xml`)
  if (!existsSync(xmlPath)) { skipped++; continue }

  let xml
  try { xml = readFileSync(xmlPath, 'utf-8') }
  catch { skipped++; continue }

  try {
    const doc = new DOMParser({
      errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e } },
    }).parseFromString(xml, 'text/xml')

    const { zones, zoneByCode } = extractZones(doc)
    const zonedLuTerms = extractZonedLuTerms(doc)
    const clauses = extractPart4Clauses(doc, zones, zoneByCode, zonedLuTerms)

    for (const c of clauses) {
      allRows.push({ epicode: code, epiTitle: title, ...c })
    }

    processed++
    process.stdout.write(`\r  ${processed}/${epiIndex.length} processed — ${allRows.length} rows`)
  } catch (e) {
    console.warn(`\n  PARSE ERROR ${code}: ${e.message}`)
    skipped++
  }
}

console.log(`\n\nDone: ${processed} EPIs, ${skipped} skipped, ${allRows.length} total rows`)

// Stats
const byClause = {}
for (const r of allRows) {
  byClause[r.clauseId] = (byClause[r.clauseId] ?? 0) + 1
}
const topClauses = Object.entries(byClause).sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log('\nTop clauses by row count:')
for (const [id, n] of topClauses) console.log(`  ${id.padEnd(10)} ${n} rows`)

writeFileSync(outPath, JSON.stringify(allRows))
const kb = (JSON.stringify(allRows).length / 1024).toFixed(0)
console.log(`\nOutput → public/EPI/zone-lu-index.json (${kb} KB)`)
