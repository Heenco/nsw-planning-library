import { DOMParser } from '@xmldom/xmldom'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanInfo {
  id: string
  title: string
  council: string
  year: string
}

export interface Zone {
  id: string
  code: string
  title: string
  family: string
  catchAll: 'PermittedWithConsent' | 'Prohibited' | null
}

export interface LandUse {
  id: string        // lu:{slug}
  term: string      // display term
  canonical: boolean
}

export interface Requirement {
  id: string
  clauseId: string   // e.g. "5.4(2)"
  sectionId: string  // e.g. "sec.5.4"
  description: string
  value: number | null
  unit: 'sqm' | 'm' | 'bedrooms' | '%' | 'map-reference' | null
  qualifier: 'max' | 'min' | null
  subclauses?: Array<{ no: string; text: string }>
  parentId?: string
}

export interface DocumentSection {
  id: string
  number: string
  title: string
  part: number
}

export interface PermitEdge {
  zoneId: string
  landUseId: string
  consent: 'NotRequired' | 'Required'
}

export interface ProhibitEdge {
  zoneId: string
  landUseId: string
}

export interface SubjectToEdge {
  landUseId: string
  requirementId: string
}

export interface AppliesToZoneEdge {
  requirementId: string
  zoneId: string
}

export interface ExclusionArea {
  id: string           // e.g. 'excl-a', 'excl-jb'
  letter: string       // 'a', 'b', ..., 'jb'
  text: string         // full text of the list item
  clauseRefs: string[] // internal clause numbers found in text, e.g. ['7.5']
}

export interface ScheduleItem {
  id: string
  heading: string
  consent: 'exempt' | 'complying'
  zones: string[]       // zone codes extracted from condition text; empty = all zones
  conditions: string[]  // one string per numbered subclause
}

export interface Part3Prerequisites {
  exempt: string[]      // eligibility conditions from sec.3.1
  complying: string[]   // eligibility conditions from sec.3.2
  excluded: string[]    // environmentally sensitive area categories from sec.3.3
}

export interface EPIGraph {
  plan: PlanInfo
  zones: Zone[]
  landUses: LandUse[]
  requirements: Requirement[]
  sections: DocumentSection[]
  scheduleItems: ScheduleItem[]
  exclusionAreas: ExclusionArea[]
  part3: Part3Prerequisites
  edges: {
    permits: PermitEdge[]
    prohibits: ProhibitEdge[]
    subjectTo: SubjectToEdge[]
    appliesToZone: AppliesToZoneEdge[]
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function getChildren(el: any): any[] {
  const result: any[] = []
  let node = el.firstChild
  while (node) {
    if (node.nodeType === 1) result.push(node)
    node = node.nextSibling
  }
  return result
}

function findChild(el: any, tag: string, attr?: string, val?: string): any | null {
  for (const child of getChildren(el)) {
    if (child.tagName !== tag) continue
    if (attr !== undefined && child.getAttribute(attr) !== val) continue
    return child
  }
  return null
}

function allByTag(root: any, tag: string): any[] {
  return Array.from(root.getElementsByTagName(tag) as ArrayLike<any>)
}

function textOf(el: any): string {
  if (!el) return ''
  return ((el.textContent as string) ?? '').replace(/\s+/g, ' ').trim()
}

// Renders a <block> to a human-readable string, including lettered list items.
// Each <li> is inlined as "(a) text". Nested lists are handled recursively.
function blockToText(block: any): string {
  if (!block) return ''
  const parts: string[] = []
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
    // skip <note> elements
  }
  return parts.join(' ')
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function zoneFamily(code: string): string {
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

// ── Plan info ─────────────────────────────────────────────────────────────────

function extractPlan(doc: any): PlanInfo {
  const root = doc.documentElement
  const metas: any[] = allByTag(doc, 'metacontent')
  const council = metas.find((m: any) => m.getAttribute('class') === 'council')?.textContent?.trim() ?? ''
  return {
    id: root.getAttribute('id') ?? '',
    title: root.getAttribute('title') ?? '',
    council,
    year: root.getAttribute('year') ?? '',
  }
}

// ── Dictionary → canonical LandUse map ───────────────────────────────────────

function extractDictionary(doc: any): Map<string, LandUse> {
  const map = new Map<string, LandUse>()
  const defterms: any[] = allByTag(doc, 'defterm')
  for (const el of defterms) {
    if (el.getAttribute('type') !== 'definition') continue
    const term = textOf(el)
    if (!term) continue
    const id = `lu:${toSlug(term)}`
    if (!map.has(id)) map.set(id, { id, term, canonical: true })
  }
  return map
}

// ── Zones + permit/prohibit edges ─────────────────────────────────────────────

function extractZones(
  doc: any,
  luMap: Map<string, LandUse>,
): { zones: Zone[]; permits: PermitEdge[]; prohibits: ProhibitEdge[] } {
  const zones: Zone[] = []
  const permits: PermitEdge[] = []
  const prohibits: ProhibitEdge[] = []

  function ensureLU(term: string): string {
    const id = `lu:${toSlug(term)}`
    if (!luMap.has(id)) luMap.set(id, { id, term, canonical: false })
    return id
  }

  const levelEls: any[] = allByTag(doc, 'level')

  for (const el of levelEls) {
    if (el.getAttribute('type') !== 'clausegroup') continue
    if (el.getAttribute('status') === 'repealed') continue

    const headEl = findChild(el, 'head')
    if (!headEl) continue

    const noEl = findChild(headEl, 'no')
    const headingEl = findChild(headEl, 'heading')
    if (!noEl) continue

    const noText = textOf(noEl)
    const codeMatch = noText.match(/^Zone\s+([A-Z][A-Z0-9]*)/)
    if (!codeMatch) continue

    const code = codeMatch[1]
    const title = textOf(headingEl)
    const zoneId = (el.getAttribute('id') as string | null) ?? `zone:${toSlug(code!)}`
    let catchAll: Zone['catchAll'] = null

    // Direct clause children only (avoids grabbing subclauses of subclauses)
    const clauseEls = getChildren(el).filter(
      (c: any) =>
        c.tagName === 'level' &&
        c.getAttribute('type') === 'clause' &&
        c.getAttribute('status') !== 'repealed',
    )

    for (const clause of clauseEls) {
      const cHead = findChild(clause, 'head')
      if (!cHead) continue
      const cHeadingEl = findChild(cHead, 'heading')
      const headingText = textOf(cHeadingEl).toLowerCase()

      let consent: 'NotRequired' | 'Required' | null = null
      let isProhibited = false

      if (headingText.includes('without consent')) consent = 'NotRequired'
      else if (headingText.includes('with consent')) consent = 'Required'
      else if (/^prohibited/.test(headingText)) isProhibited = true
      else continue // objectives or other clause

      const blockEl = findChild(clause, 'block')
      if (!blockEl) continue
      const txtEl = findChild(blockEl, 'txt')
      if (!txtEl) continue
      const rawText = textOf(txtEl)

      const uses = rawText
        .split(/;\s*/)
        .map((s: string) => s.trim())
        .filter((s: string) => {
          if (!s) return false
          // Detect and record catch-all clause ("Any [other] development not specified...")
          if (/^any (?:other )?development not specified/i.test(s)) {
            if (isProhibited) catchAll = 'Prohibited'
            else if (consent === 'Required') catchAll = 'PermittedWithConsent'
            return false
          }
          // Skip legislative references e.g. "Uses authorised under the Forestry Act 2012..."
          if (/^uses authorised under/i.test(s)) return false
          return true
        })

      for (const use of uses) {
        const luId = ensureLU(use)
        if (isProhibited) {
          prohibits.push({ zoneId, landUseId: luId })
        } else {
          permits.push({ zoneId, landUseId: luId, consent: consent! })
        }
      }
    }

    zones.push({ id: zoneId, code: code!, title, family: zoneFamily(code!), catchAll })
  }

  return { zones, permits, prohibits }
}

// ── Requirements from clause 5.4 ─────────────────────────────────────────────

const SQM_RE = /([\d,]+)\s*(?:square metres?)/i
const BEDROOM_RE = /no more than (\d+)\s*bedrooms?/i
const HEIGHT_RE = /(\d+(?:\.\d+)?)\s*metres?\s*(?:in height|AHD)?/i
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/

// Match a land use term (lowercased) against text, handling common plurals
function luMatchesText(term: string, text: string): boolean {
  if (text.includes(term)) return true
  if (term.endsWith('ies') && text.includes(term.replace(/ies$/, 'y'))) return true
  if (term.endsWith('s') && term.length > 4 && text.includes(term.slice(0, -1))) return true
  return false
}

function extractRequirements(
  doc: any,
  zones: Zone[],
  luMap: Map<string, LandUse>,
  linkedLuIds: Set<string>,
): { requirements: Requirement[]; subjectTo: SubjectToEdge[]; appliesToZone: AppliesToZoneEdge[] } {
  const requirements: Requirement[] = []
  const subjectTo: SubjectToEdge[] = []
  const appliesToZone: AppliesToZoneEdge[] = []

  const zoneByCode = new Map(zones.map(z => [z.code, z]))

  const allLevels: any[] = allByTag(doc, 'level')
  const sec54 = allLevels.find((el: any) => el.getAttribute('id') === 'sec.5.4')
  if (sec54) {
    // Only direct subclauses of 5.4 (identified by id prefix)
    const tiers: any[] = allByTag(sec54, 'tier').filter((el: any) => {
      const id = el.getAttribute('id') ?? ''
      return id.startsWith('sec.5.4-ssec.') && el.getAttribute('status') !== 'repealed'
    })

    for (const tier of tiers) {
      const tierId = tier.getAttribute('id') ?? ''
      const cHead = findChild(tier, 'head')
      if (!cHead) continue

      const headingEl = findChild(cHead, 'heading')
      if (!headingEl) continue
      const headingText = textOf(headingEl)
      if (!headingText) continue

      const blockEl = findChild(tier, 'block')
      if (!blockEl) continue
      const txtEl = findChild(blockEl, 'txt')
      if (!txtEl) continue
      const description = textOf(txtEl)
      if (/^\[not adopted\]/i.test(description)) continue

      let value: number | null = null
      let unit: Requirement['unit'] = null
      const qualifier: Requirement['qualifier'] = 'max'

      const sqmMatch = description.match(SQM_RE)
      if (sqmMatch?.[1]) {
        value = parseInt(sqmMatch[1].replace(/,/g, ''), 10)
        unit = 'sqm'
      }
      if (!sqmMatch) {
        const bedroomMatch = description.match(BEDROOM_RE)
        if (bedroomMatch?.[1]) {
          value = parseInt(bedroomMatch[1], 10)
          unit = 'bedrooms'
        }
      }

      // "sec.5.4-ssec.7AA" → "5.4(7AA)"
      const clauseId = tierId.replace(/^sec\./, '').replace(/-ssec\./, '(') + ')'
      const reqId = `req:${tierId}`

      requirements.push({ id: reqId, clauseId, sectionId: 'sec.5.4', description, value, unit, qualifier })

      // SUBJECT_TO: match heading to land use slug
      subjectTo.push({ landUseId: `lu:${toSlug(headingText)}`, requirementId: reqId })

      // APPLIES_TO_ZONE: extract zone mentions from description text
      const zoneRe = /Zone\s+([A-Z][A-Z0-9]*)/g
      let zm: RegExpExecArray | null
      while ((zm = zoneRe.exec(description)) !== null) {
        const zone = zm[1] ? zoneByCode.get(zm[1]) : undefined
        if (zone) appliesToZone.push({ requirementId: reqId, zoneId: zone.id })
      }
    }
  }

  // ── Part 4 development standards ──────────────────────────────────────────
  const part4Clauses = allLevels.filter((el: any) => {
    const id = el.getAttribute('id') ?? ''
    const type = el.getAttribute('type') ?? ''
    return (
      type === 'clause' &&
      /^sec\.4\.[0-9A-Z]+$/.test(id) &&
      !id.includes('-') &&
      el.getAttribute('status') !== 'repealed'
    )
  })

  for (const clause of part4Clauses) {
    const clauseId = clause.getAttribute('id') ?? ''
    const cHead = findChild(clause, 'head')
    if (!cHead) continue
    const headingEl = findChild(cHead, 'heading')
    const noEl = findChild(cHead, 'no')
    if (!headingEl) continue
    const headingText = textOf(headingEl)
    if (!headingText) continue

    // Skip [Not adopted] — look directly in <block><txt> child (no tier wrapper)
    const directBlock = findChild(clause, 'block')
    if (directBlock) {
      const directTxt = textOf(findChild(directBlock, 'txt'))
      if (/^\[not adopted\]/i.test(directTxt)) continue
    }

    const reqId = `req:${clauseId}`
    const clauseNo = textOf(noEl)
    const fullText = textOf(clause)

    // Collect operative subclauses — skip objectives and nested para items
    const tierIdPrefix = clauseId + '-ssec.'
    const subclauses: Array<{ no: string; text: string }> = []
    for (const tier of allByTag(clause, 'tier') as any[]) {
      const tierId = (tier.getAttribute('id') as string | null) ?? ''
      if (!tierId.startsWith(tierIdPrefix)) continue
      const suffix = tierId.slice(tierIdPrefix.length)
      if (suffix.includes('-')) continue // skip nested para items
      if (tier.getAttribute('status') === 'repealed') continue
      const tHead = findChild(tier, 'head')
      const tBlock = findChild(tier, 'block')
      const tNo = tHead ? textOf(findChild(tHead, 'no')) : ''
      const tText = tBlock ? blockToText(tBlock) : ''
      if (!tText || tText.length < 10) continue
      if (/^the objectives of this clause/i.test(tText)) continue
      subclauses.push({ no: tNo, text: tText })
    }

    requirements.push({
      id: reqId,
      clauseId: clauseNo || clauseId.replace('sec.', ''),
      sectionId: clauseId,
      description: headingText,
      value: null,
      unit: 'map-reference',
      qualifier: null,
      subclauses,
    })

    // Find explicit zone mentions; if none, applies universally (via map)
    const zoneRe4 = /Zone\s+([A-Z][A-Z0-9]*)/g
    let zm4: RegExpExecArray | null
    const mentionedZoneIds = new Set<string>()
    while ((zm4 = zoneRe4.exec(fullText)) !== null) {
      if (zm4[1]) {
        const zone = zoneByCode.get(zm4[1])
        if (zone) mentionedZoneIds.add(zone.id)
      }
    }

    const targetZones = mentionedZoneIds.size > 0 ? [...mentionedZoneIds] : zones.map(z => z.id)
    for (const zoneId of targetZones) {
      appliesToZone.push({ requirementId: reqId, zoneId })
    }

    // ── Sub-requirements: recursive tree — tier nodes → list items → nested lists ──
    // Helper: parse numeric metric from text
    function parseMetric4(text: string): { value: number | null; unit: Requirement['unit']; qualifier: Requirement['qualifier'] } {
      const sqm = text.match(SQM_RE)
      if (sqm?.[1]) return { value: parseInt(sqm[1].replace(/,/g, ''), 10), unit: 'sqm', qualifier: /not less than/i.test(text) ? 'min' : 'max' }
      const h = text.match(HEIGHT_RE)
      if (h?.[1]) return { value: parseFloat(h[1]), unit: 'm', qualifier: /not (?:more than|exceed)/i.test(text) ? 'max' : 'min' }
      const p = text.match(PERCENT_RE)
      if (p?.[1]) return { value: parseFloat(p[1]), unit: '%', qualifier: /not less than/i.test(text) ? 'min' : 'max' }
      return { value: null, unit: null, qualifier: null }
    }

    // Recursive list walker: creates child requirements from li items at any depth
    function walkList4(listEl: any, parentReqId: string, parentLabel: string) {
      for (const li of getChildren(listEl)) {
        if (li.tagName !== 'li') continue
        const liId = (li.getAttribute('id') as string | null) ?? `${parentReqId}-li`
        const liNoEl = findChild(li, 'no')
        const liBlock = findChild(li, 'block')
        if (!liBlock) continue
        const liNo = textOf(liNoEl)
        const liText = blockToText(liBlock)
        if (!liText) continue
        const liReqId = `req:${liId}`
        const liLabel = `${parentLabel}${liNo}`.replace(/\s+/g, '')
        if (requirements.some(r => r.id === liReqId)) continue
        const m = parseMetric4(liText)
        requirements.push({ id: liReqId, clauseId: liLabel, sectionId: liId, description: liText, value: m.value, unit: m.unit, qualifier: m.qualifier, subclauses: [], parentId: parentReqId })
        for (const zId of targetZones) appliesToZone.push({ requirementId: liReqId, zoneId: zId })
        const liLow = liText.toLowerCase()
        for (const [luId, lu] of luMap) { if (linkedLuIds.has(luId) && luMatchesText(lu.term.toLowerCase(), liLow)) subjectTo.push({ landUseId: luId, requirementId: liReqId }) }
        // Recurse into nested list
        const nested = findChild(liBlock, 'list')
        if (nested) walkList4(nested, liReqId, liLabel)
      }
    }

    // Each operative tier becomes a child requirement; its list (if any) is walked recursively
    for (const tier of allByTag(clause, 'tier') as any[]) {
      const tierId: string = (tier.getAttribute('id') as string | null) ?? ''
      if (!tierId.startsWith(tierIdPrefix)) continue
      const suffix = tierId.slice(tierIdPrefix.length)
      if (suffix.includes('-')) continue // only top-level subclauses of this clause
      if (tier.getAttribute('status') === 'repealed') continue

      const tHead = findChild(tier, 'head')
      const tBlock = findChild(tier, 'block')
      if (!tBlock) continue
      const tNo = tHead ? textOf(findChild(tHead, 'no')) : ''
      const leadTxt = textOf(findChild(tBlock, 'txt'))
      if (/^the objectives? of this clause/i.test(leadTxt)) continue

      const tierText = blockToText(tBlock)
      if (!tierText || tierText.length < 10) continue

      const tierReqId = `req:${tierId}`
      const tierLabel = `${clauseNo}${tNo}`.replace(/\s+/g, '')

      if (!requirements.some(r => r.id === tierReqId)) {
        const m = parseMetric4(tierText)
        requirements.push({ id: tierReqId, clauseId: tierLabel, sectionId: tierId, description: tierText, value: m.value, unit: m.unit, qualifier: m.qualifier, subclauses: [], parentId: reqId })
        for (const zId of targetZones) appliesToZone.push({ requirementId: tierReqId, zoneId: zId })
        const tierLow = tierText.toLowerCase()
        for (const [luId, lu] of luMap) { if (linkedLuIds.has(luId) && luMatchesText(lu.term.toLowerCase(), tierLow)) subjectTo.push({ landUseId: luId, requirementId: tierReqId }) }
      }

      // Walk list items within this tier recursively
      const listEl = findChild(tBlock, 'list')
      if (listEl) walkList4(listEl, tierReqId, tierLabel)
    }
  }

  // ── Part 5 local provisions / controls (full clause + subclause capture) ──
  const part5Clauses = allLevels.filter((el: any) => {
    const id = el.getAttribute('id') ?? ''
    const type = el.getAttribute('type') ?? ''
    return (
      type === 'clause' &&
      /^sec\.5\.[0-9A-Z]+$/.test(id) &&
      !id.includes('-') &&
      id !== 'sec.5.4' &&
      el.getAttribute('status') !== 'repealed'
    )
  })

  for (const clause of part5Clauses) {
    const clauseId = clause.getAttribute('id') ?? ''
    const cHead = findChild(clause, 'head')
    if (!cHead) continue
    const headingEl = findChild(cHead, 'heading')
    const noEl = findChild(cHead, 'no')
    if (!headingEl) continue
    const headingText = textOf(headingEl)
    if (!headingText) continue

    const directBlock = findChild(clause, 'block')
    if (directBlock) {
      const directTxt = textOf(findChild(directBlock, 'txt'))
      if (/^\[not adopted\]/i.test(directTxt)) continue
    }

    const reqId = `req:${clauseId}`
    const clauseNo = textOf(noEl)
    const fullText = textOf(clause)

    const tierIdPrefix = clauseId + '-ssec.'
    const subclauses: Array<{ no: string; text: string }> = []
    for (const tier of allByTag(clause, 'tier') as any[]) {
      const tierId = (tier.getAttribute('id') as string | null) ?? ''
      if (!tierId.startsWith(tierIdPrefix)) continue
      const suffix = tierId.slice(tierIdPrefix.length)
      if (suffix.includes('-')) continue
      if (tier.getAttribute('status') === 'repealed') continue
      const tHead = findChild(tier, 'head')
      const tBlock = findChild(tier, 'block')
      const tNo = tHead ? textOf(findChild(tHead, 'no')) : ''
      const tText = tBlock ? blockToText(tBlock) : ''
      if (!tText || tText.length < 10) continue
      if (/^the objectives? of this clause/i.test(tText)) continue
      subclauses.push({ no: tNo, text: tText })
    }

    requirements.push({
      id: reqId,
      clauseId: clauseNo || clauseId.replace('sec.', ''),
      sectionId: clauseId,
      description: headingText,
      value: null,
      unit: 'map-reference',
      qualifier: null,
      subclauses,
    })

    // Explicit zone mentions, otherwise all zones
    const zoneRe5 = /Zone\s+([A-Z][A-Z0-9]*)/g
    let zm5: RegExpExecArray | null
    const mentionedZoneIds = new Set<string>()
    while ((zm5 = zoneRe5.exec(fullText)) !== null) {
      if (zm5[1]) {
        const zone = zoneByCode.get(zm5[1])
        if (zone) mentionedZoneIds.add(zone.id)
      }
    }
    const targetZones = mentionedZoneIds.size > 0 ? [...mentionedZoneIds] : zones.map(z => z.id)
    for (const zId of targetZones) {
      appliesToZone.push({ requirementId: reqId, zoneId: zId })
    }

    // Add child requirements for direct list items under each Part 5 subclause
    for (const tier of allByTag(clause, 'tier') as any[]) {
      const tierId: string = (tier.getAttribute('id') as string | null) ?? ''
      if (!tierId.startsWith(tierIdPrefix)) continue
      const suffix = tierId.slice(tierIdPrefix.length)
      if (suffix.includes('-')) continue
      if (tier.getAttribute('status') === 'repealed') continue

      const tHead = findChild(tier, 'head')
      const tBlock = findChild(tier, 'block')
      if (!tBlock) continue
      const tNo = tHead ? textOf(findChild(tHead, 'no')) : ''

      const leadTxt = textOf(findChild(tBlock, 'txt'))
      if (/^the objectives? of this clause/i.test(leadTxt)) continue

      const listEl = findChild(tBlock, 'list')
      if (!listEl) continue

      for (const li of getChildren(listEl)) {
        if (li.tagName !== 'li') continue
        const liNoEl = findChild(li, 'no')
        const liBlock = findChild(li, 'block')
        if (!liBlock) continue

        const liNo = textOf(liNoEl)
        const liText = blockToText(liBlock)
        if (!liText) continue

        const liId = (li.getAttribute('id') as string | null) ?? `${tierId}-li-${liNo}`
        const subReqId = `req:${liId}`
        const subClauseLabel = `${clauseNo}${tNo}${liNo}`.replace(/\s+/g, '')

        if (requirements.some(r => r.id === subReqId)) continue

        requirements.push({
          id: subReqId,
          clauseId: subClauseLabel,
          sectionId: liId,
          description: `${leadTxt} ${liNo} ${liText}`.replace(/\s+/g, ' ').trim(),
          value: null,
          unit: null,
          qualifier: null,
          subclauses: [],
          parentId: reqId,
        })

        for (const zId of targetZones) {
          appliesToZone.push({ requirementId: subReqId, zoneId: zId })
        }

        const fullTierText = blockToText(tBlock).toLowerCase()
        for (const [luId, lu] of luMap) {
          if (linkedLuIds.has(luId) && luMatchesText(lu.term.toLowerCase(), fullTierText)) {
            subjectTo.push({ landUseId: luId, requirementId: subReqId })
          }
        }
      }
    }

    // ── Fallback: direct block→list→li for Part 5 clauses with no tiers (e.g. sec.5.5)
    // These clauses have their list items directly inside <block><list> with no <tier> wrapper.
    const directClauseBlock = findChild(clause, 'block')
    const directClauseList = directClauseBlock ? findChild(directClauseBlock, 'list') : null
    if (directClauseList) {
      function parseMetricFromText(text: string): { value: number | null; unit: Requirement['unit']; qualifier: Requirement['qualifier'] } {
        const sqm = text.match(SQM_RE)
        if (sqm?.[1]) return { value: parseInt(sqm[1].replace(/,/g, ''), 10), unit: 'sqm', qualifier: /not less than/i.test(text) ? 'min' : 'max' }
        const h = text.match(HEIGHT_RE)
        if (h?.[1]) return { value: parseFloat(h[1]), unit: 'm', qualifier: /not (?:more than|exceed)/i.test(text) ? 'max' : 'min' }
        const p = text.match(PERCENT_RE)
        if (p?.[1]) return { value: parseFloat(p[1]), unit: '%', qualifier: /not less than/i.test(text) ? 'min' : 'max' }
        return { value: null, unit: null, qualifier: null }
      }

      function walkDirectList(listEl: any, parentReqId: string, parentLabel: string, depth: number) {
        for (const li of getChildren(listEl)) {
          if (li.tagName !== 'li') continue
          const liId = (li.getAttribute('id') as string | null) ?? `${parentReqId}-li-${depth}`
          const liNoEl = findChild(li, 'no')
          const liBlock = findChild(li, 'block')
          const liNo = textOf(liNoEl)
          const liLeadTxt = liBlock ? textOf(findChild(liBlock, 'txt')) : ''
          const liFullText = liBlock ? blockToText(liBlock) : textOf(li)

          // Skip not-adopted/not-applicable items
          if (!liFullText || /^\[not (?:adopted|applicable)\]/i.test(liLeadTxt || liFullText)) continue

          const subReqId = `req:${liId}`
          const subLabel = `${parentLabel}${liNo}`.replace(/\s+/g, '')

          if (requirements.some(r => r.id === subReqId)) {
            // Already inserted — still recurse into nested list
            if (liBlock) {
              const nested = findChild(liBlock, 'list')
              if (nested) walkDirectList(nested, subReqId, subLabel, depth + 1)
            }
            continue
          }

          // Populate parent subclauses if this is a top-level list item
          if (depth === 0) subclauses.push({ no: liNo, text: liFullText })

          const metrics = parseMetricFromText(liFullText)

          requirements.push({
            id: subReqId,
            clauseId: subLabel,
            sectionId: liId,
            description: liFullText,
            value: metrics.value,
            unit: metrics.unit,
            qualifier: metrics.qualifier,
            subclauses: [],
            parentId: parentReqId,
          })

          for (const zId of targetZones) {
            appliesToZone.push({ requirementId: subReqId, zoneId: zId })
          }

          for (const [luId, lu] of luMap) {
            if (linkedLuIds.has(luId) && luMatchesText(lu.term.toLowerCase(), liFullText.toLowerCase())) {
              subjectTo.push({ landUseId: luId, requirementId: subReqId })
            }
          }

          // Recurse into nested list (e.g. (a)→(i),(ii))
          if (liBlock) {
            const nested = findChild(liBlock, 'list')
            if (nested) walkDirectList(nested, subReqId, subLabel, depth + 1)
          }
        }
      }

      walkDirectList(directClauseList, reqId, clauseNo, 0)
    }

    // Link clause to land uses mentioned in clause text
    const fullTextLower = fullText.toLowerCase()
    for (const [luId, lu] of luMap) {
      if (linkedLuIds.has(luId) && luMatchesText(lu.term.toLowerCase(), fullTextLower)) {
        subjectTo.push({ landUseId: luId, requirementId: reqId })
      }
    }
  }

  return { requirements, subjectTo, appliesToZone }
}

// ── Part 3 prerequisites (sec.3.1, sec.3.2, sec.3.3) ────────────────────────

function extractPart3Prerequisites(doc: any): Part3Prerequisites {
  const exempt: string[] = []
  const complying: string[] = []
  const excluded: string[] = []

  function collectSubclauses(clauseId: string, out: string[]) {
    const allLevels: any[] = allByTag(doc, 'level')
    const clause = allLevels.find((el: any) => el.getAttribute('id') === clauseId)
    if (!clause) return
    const prefix = clauseId + '-ssec.'
    for (const tier of allByTag(clause, 'tier') as any[]) {
      const tierId = (tier.getAttribute('id') as string | null) ?? ''
      if (!tierId.startsWith(prefix)) continue
      if (tierId.slice(prefix.length).includes('-')) continue
      if (tier.getAttribute('status') === 'repealed') continue
      const tBlock = findChild(tier, 'block')
      if (!tBlock) continue
      const text = blockToText(tBlock)
      if (!text || /^the objective/i.test(text)) continue
      out.push(text)
    }
  }

  collectSubclauses('sec.3.1', exempt)
  collectSubclauses('sec.3.2', complying)

  // sec.3.3(2) defines the environmentally sensitive area categories as a deflist
  const allLevels: any[] = allByTag(doc, 'level')
  const sec33 = allLevels.find((el: any) => el.getAttribute('id') === 'sec.3.3')
  if (sec33) {
    const ssec2 = (allByTag(sec33, 'tier') as any[]).find(
      (el: any) => el.getAttribute('id') === 'sec.3.3-ssec.2'
    )
    if (ssec2) {
      const deflist = findChild(findChild(ssec2, 'block'), 'deflist')
      if (deflist) {
        const innerBlock = findChild(deflist, 'block')
        if (innerBlock) {
          const listEl = findChild(innerBlock, 'list')
          if (listEl) {
            for (const li of getChildren(listEl)) {
              if (li.tagName !== 'li') continue
              const liBlock = findChild(li, 'block')
              const text = liBlock ? textOf(liBlock) : ''
              if (text) excluded.push(text)
            }
          }
        }
      }
    }
  }

  return { exempt, complying, excluded }
}

// ── Part 3.3 — Environmentally sensitive areas excluded ───────────────────────

function extractExclusionAreas(doc: any): ExclusionArea[] {
  const areas: ExclusionArea[] = []
  const allLevels: any[] = allByTag(doc, 'level')
  const sec33 = allLevels.find((el: any) => el.getAttribute('id') === 'sec.3.3')
  if (!sec33) return areas

  const ssec2 = (allByTag(sec33, 'tier') as any[]).find(
    (el: any) => el.getAttribute('id') === 'sec.3.3-ssec.2'
  )
  if (!ssec2) return areas

  const deflist = findChild(findChild(ssec2, 'block'), 'deflist')
  if (!deflist) return areas
  const innerBlock = findChild(deflist, 'block')
  if (!innerBlock) return areas
  const listEl = findChild(innerBlock, 'list')
  if (!listEl) return areas

  const clauseRefRe = /clause\s+(\d+(?:\.\d+[A-Z]*)*)/gi

  for (const li of getChildren(listEl)) {
    if (li.tagName !== 'li') continue
    const noEl = findChild(li, 'no')
    const letter = noEl ? textOf(noEl).replace(/[()]/g, '').trim() : ''
    if (!letter) continue
    const liBlock = findChild(li, 'block')
    const text = liBlock ? textOf(liBlock).trim() : ''
    if (!text) continue
    const clauseRefs: string[] = []
    clauseRefRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = clauseRefRe.exec(text)) !== null) {
      if (m[1]) clauseRefs.push(m[1])
    }
    areas.push({ id: `excl-${letter}`, letter, text, clauseRefs })
  }

  return areas
}

// ── Schedule 2 (exempt) + Schedule 3 (complying) ─────────────────────────────

function extractScheduleItems(doc: any, zones: Zone[]): ScheduleItem[] {
  const items: ScheduleItem[] = []
  const zoneByCode = new Map(zones.map(z => [z.code, z]))

  function zonesFromText(text: string): string[] {
    const codes = new Set<string>()
    const zoneRe = /Zone\s+([A-Z][A-Z0-9]*)/g
    let m: RegExpExecArray | null
    while ((m = zoneRe.exec(text)) !== null) {
      if (m[1] && zoneByCode.has(m[1])) codes.add(m[1])
    }
    return [...codes]
  }

  function parseClause(clause: any, consent: 'exempt' | 'complying') {
    if (clause.getAttribute('status') === 'repealed') return
    const id = (clause.getAttribute('id') as string | null) ?? ''
    const cHead = findChild(clause, 'head')
    if (!cHead) return
    const headingEl = findChild(cHead, 'heading')
    if (!headingEl) return
    const heading = textOf(headingEl)
    if (!heading) return

    const conditions: string[] = []
    const allZoneCodes = new Set<string>()
    const prefix = id + '-ssec.'

    for (const tier of allByTag(clause, 'tier') as any[]) {
      const tierId = (tier.getAttribute('id') as string | null) ?? ''
      if (!tierId.startsWith(prefix)) continue
      // skip nested para items e.g. -ssec.6-para1.a
      if (tierId.slice(prefix.length).includes('-')) continue
      if (tier.getAttribute('status') === 'repealed') continue
      const tBlock = findChild(tier, 'block')
      if (!tBlock) continue
      const text = blockToText(tBlock)
      if (!text) continue
      conditions.push(text)
      for (const code of zonesFromText(text)) allZoneCodes.add(code)
    }

    if (conditions.length === 0) return
    items.push({ id, heading, consent, zones: [...allZoneCodes], conditions })
  }

  const allLevels: any[] = allByTag(doc, 'level')

  // Schedule 2 — exempt development
  const sch2 = allLevels.find((el: any) => el.getAttribute('id') === 'sch.2')
  if (sch2) {
    const clauses = (allByTag(sch2, 'level') as any[]).filter((el: any) =>
      el.getAttribute('type') === 'clause'
    )
    for (const clause of clauses) parseClause(clause, 'exempt')
  }

  // Schedule 3 — complying development (Part 1 contains the actual devtypes)
  const sch3 = allLevels.find((el: any) => el.getAttribute('id') === 'sch.3')
  if (sch3) {
    const pt1 = (allByTag(sch3, 'level') as any[]).find((el: any) => el.getAttribute('id') === 'sch.3-pt.1')
    if (pt1) {
      const clauses = (allByTag(pt1, 'level') as any[]).filter((el: any) =>
        el.getAttribute('type') === 'clause'
      )
      for (const clause of clauses) parseClause(clause, 'complying')
    }
  }

  return items
}

// ── Document sections (Parts + significant clauses) ───────────────────────────

function extractSections(doc: any): DocumentSection[] {
  const sections: DocumentSection[] = []
  const levels: any[] = allByTag(doc, 'level').filter((el: any) => {
    const id = el.getAttribute('id') ?? ''
    const type = el.getAttribute('type') ?? ''
    return (
      (type === 'part' && /^pt\.\d+$/.test(id)) ||
      (type === 'clause' && /^sec\.[45]\.[0-9A-Z]+$/.test(id) && !id.includes('-'))
    )
  })

  for (const el of levels) {
    const id = el.getAttribute('id') ?? ''
    const headEl = findChild(el, 'head')
    if (!headEl) continue
    const noEl = findChild(headEl, 'no')
    const headingEl = findChild(headEl, 'heading')
    const number = textOf(noEl)
    const title = textOf(headingEl)
    if (!title) continue
    const partNum = id.startsWith('pt.')
      ? parseInt(id.replace('pt.', ''), 10)
      : parseInt(id.replace('sec.', '').split('.')[0], 10)
    sections.push({ id, number, title, part: partNum })
  }

  return sections
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseEPI(xmlString: string): EPIGraph {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml')

  // Check for XML parse errors
  const parseError = (doc as any).getElementsByTagName('parsererror')[0]
  if (parseError) {
    throw new Error(`XML parse error: ${textOf(parseError).slice(0, 200)}`)
  }

  const plan = extractPlan(doc)
  const luMap = extractDictionary(doc)
  const { zones, permits, prohibits } = extractZones(doc, luMap)
  const linkedLuIds = new Set<string>([
    ...permits.map(e => e.landUseId),
    ...prohibits.map(e => e.landUseId),
  ])
  const { requirements, subjectTo, appliesToZone } = extractRequirements(doc, zones, luMap, linkedLuIds)
  const sections = extractSections(doc)
  const scheduleItems = extractScheduleItems(doc, zones)
  const exclusionAreas = extractExclusionAreas(doc)
  const part3 = extractPart3Prerequisites(doc)

  return {
    plan,
    zones,
    landUses: Array.from(luMap.values()),
    requirements,
    sections,
    scheduleItems,
    exclusionAreas,
    part3,
    edges: { permits, prohibits, subjectTo, appliesToZone },
  }
}
