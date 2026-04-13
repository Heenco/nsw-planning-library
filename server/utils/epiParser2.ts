import { DOMParser } from '@xmldom/xmldom'
import { parseEPI } from './epiParser'
import type {
  EPIGraph,
  LandUse,
  Schedule1Site,
  HeritageItem,
  LocalProvision,
  LegalStructureNode,
  LegalStructureEdge,
  EPIGraph2,
} from '../../app/types/epi'

// ── Re-export base parser helpers duplicated here for locality ────────────────

function getChildren(el: any): any[] {
  if (!el) return []
  const result: any[] = []
  let node = el.firstChild
  while (node) {
    if (node.nodeType === 1) result.push(node)
    node = node.nextSibling
  }
  return result
}

function findChild(el: any, tag: string): any | null {
  for (const child of getChildren(el)) {
    if (child.tagName === tag) return child
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

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

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
  }
  return parts.join(' ')
}

function levelKind(type: string, id: string): LegalStructureNode['kind'] {
  if (type === 'part') return 'part'
  if (type === 'schedule') return 'schedule'
  if (type === 'clause') {
    if (/^sec\./.test(id)) return 'section'
    return 'clause'
  }
  return 'clause'
}

export function extractDocumentStructure(doc: any): { nodes: LegalStructureNode[]; edges: LegalStructureEdge[] } {
  const nodes: LegalStructureNode[] = []
  const edges: LegalStructureEdge[] = []
  const seenNodes = new Set<string>()
  let autoCounter = 0

  function pushNode(node: LegalStructureNode) {
    if (seenNodes.has(node.id)) return
    seenNodes.add(node.id)
    nodes.push(node)
  }

  function pushEdge(edge: LegalStructureEdge) {
    edges.push(edge)
  }

  function nextId(prefix: string) {
    autoCounter += 1
    return `${prefix}:${autoCounter}`
  }

  function addReferencesAndDefinitions(container: any, parentId: string) {
    for (const def of allByTag(container, 'defterm')) {
      const term = textOf(def)
      if (!term) continue
      const id = (def.getAttribute('id') as string | null) ?? `def:${toSlug(term)}`
      pushNode({ id, kind: 'definition', title: term, sourceId: id })
      pushEdge({ source: parentId, target: id, relation: 'defines' })
    }

    for (const refTag of ['extref', 'legref']) {
      for (const ref of allByTag(container, refTag)) {
        const refId = (ref.getAttribute('refid') as string | null)
          ?? (ref.getAttribute('source') as string | null)
          ?? textOf(ref)
        if (!refId) continue
        const id = `ref:${toSlug(refId)}`
        const title = textOf(findChild(ref, 'name')) || refId
        pushNode({ id, kind: 'reference', title, sourceId: refId })
        pushEdge({ source: parentId, target: id, relation: 'references' })
      }
    }
  }

  function walkTier(tierEl: any, parentId: string) {
    const tierId = (tierEl.getAttribute('id') as string | null) ?? nextId('tier')
    const head = findChild(tierEl, 'head')
    const no = textOf(findChild(head, 'no'))
    const heading = textOf(findChild(head, 'heading'))
    const block = findChild(tierEl, 'block')
    const text = block ? blockToText(block) : ''

    pushNode({
      id: tierId,
      kind: 'subclause',
      number: no || undefined,
      title: heading || no || tierId,
      text: text || undefined,
      sourceId: tierId,
    })
    pushEdge({ source: parentId, target: tierId, relation: 'contains' })
    addReferencesAndDefinitions(tierEl, tierId)

    if (block) walkBlock(block, tierId)

    for (const child of getChildren(tierEl)) {
      if (child.tagName === 'tier') walkTier(child, tierId)
    }
  }

  function walkList(listEl: any, parentId: string) {
    for (const li of getChildren(listEl)) {
      if (li.tagName !== 'li') continue
      const liNo = textOf(findChild(li, 'no'))
      const liBlock = findChild(li, 'block')
      const liText = liBlock ? blockToText(liBlock) : textOf(li)
      const liId = (li.getAttribute('id') as string | null) ?? nextId('li')

      pushNode({
        id: liId,
        kind: 'list-item',
        number: liNo || undefined,
        title: liNo || 'List item',
        text: liText || undefined,
        sourceId: liId,
      })
      pushEdge({ source: parentId, target: liId, relation: 'contains' })
      addReferencesAndDefinitions(li, liId)

      if (liBlock) walkBlock(liBlock, liId)
    }
  }

  function walkBlock(blockEl: any, parentId: string) {
    for (const child of getChildren(blockEl)) {
      if (child.tagName === 'txt') {
        const txt = textOf(child)
        if (!txt) continue
        const pId = (child.getAttribute('id') as string | null) ?? nextId('p')
        pushNode({ id: pId, kind: 'paragraph', title: 'Paragraph', text: txt, sourceId: pId })
        pushEdge({ source: parentId, target: pId, relation: 'contains' })
      } else if (child.tagName === 'list') {
        walkList(child, parentId)
      }
    }
  }

  function walkLevel(levelEl: any, parentId?: string) {
    const id = (levelEl.getAttribute('id') as string | null) ?? nextId('level')
    const type = (levelEl.getAttribute('type') as string | null) ?? ''
    const head = findChild(levelEl, 'head')
    const no = textOf(findChild(head, 'no'))
    const heading = textOf(findChild(head, 'heading'))
    const title = heading || no || id

    pushNode({
      id,
      kind: levelKind(type, id),
      number: no || undefined,
      title,
      sourceId: id,
    })
    if (parentId) pushEdge({ source: parentId, target: id, relation: 'contains' })
    addReferencesAndDefinitions(levelEl, id)

    for (const child of getChildren(levelEl)) {
      if (child.tagName === 'block') walkBlock(child, id)
      else if (child.tagName === 'tier') walkTier(child, id)
      else if (child.tagName === 'level') walkLevel(child, id)
    }
  }

  // Walk all top-level <level> elements (parts) — they sit inside <content>
  const allLevels: any[] = allByTag(doc, 'level')
  for (const el of allLevels) {
    const type = (el.getAttribute('type') as string | null) ?? ''
    // Only start walking from top-level parts (type="part" whose parent is not another level)
    if (type !== 'part') continue
    const parentTag = el.parentNode?.tagName
    if (parentTag === 'level') continue
    walkLevel(el)
  }

  return { nodes, edges }
}

// ── Regex helpers ─────────────────────────────────────────────────────────────

// Matches: "Lot 9, DP 862908" | "Lots 7300 and 7301, DP 1153423" | "Lot 2, DP 1129942"
const LOT_DP_RE = /(?:Lots?\s[\d\sand]+,\s*DP\s*[\d]+)/i

// Matches land use terms typically following "purposes of a/an" or "purposes of"
const PURPOSE_RE = /(?:purposes of (?:an? )?)([a-z][a-z ,\/()&-]+?)(?:\s+is permitted|\s+are permitted|,\s+vehicle|\s*\.|$)/gi

// ── Schedule 1 — Additional Permitted Uses ────────────────────────────────────

export function extractSchedule1Sites(doc: any, luMap: Map<string, LandUse>): Schedule1Site[] {
  const sites: Schedule1Site[] = []
  const allLevels: any[] = allByTag(doc, 'level')
  const sch1 = allLevels.find((el: any) => el.getAttribute('id') === 'sch.1')
  if (!sch1) return sites

  const clauses = (allByTag(sch1, 'level') as any[]).filter(
    (el: any) => el.getAttribute('type') === 'clause' && (el.getAttribute('id') ?? '').startsWith('sch.1-sec.')
  )

  for (const clause of clauses) {
    const clauseId = clause.getAttribute('id') ?? ''
    const cHead = findChild(clause, 'head')
    if (!cHead) continue
    const headingEl = findChild(cHead, 'heading')
    const heading = textOf(headingEl)
    if (!heading) continue

    // Subclause (1): land description + lot/DP
    // Subclause (2): permission grant text
    // Additional subclauses may extend the grant further

    const tiers: any[] = (allByTag(clause, 'tier') as any[]).filter(
      (t: any) => {
        const id = t.getAttribute('id') ?? ''
        return id.startsWith(clauseId + '-ssec.') && !id.slice((clauseId + '-ssec.').length).includes('-')
      }
    )

    if (tiers.length < 2) continue

    const ssec1Text = textOf(tiers[0])
    const lotDPMatch = ssec1Text.match(LOT_DP_RE)
    const lotDP = lotDPMatch ? lotDPMatch[0] : ''

    // Extract address from heading: strip "Use of certain land at " prefix
    const address = heading.replace(/^use of certain land at\s+/i, '').trim()

    // Combine subclauses 2..N as the permitted use grant text
    const permittedUsesText = tiers
      .slice(1)
      .map((t: any) => textOf(t))
      .join(' ')
      .trim()

    // Try to map extracted phrases to known land use IDs
    const permittedLandUseIds: string[] = []
    PURPOSE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PURPOSE_RE.exec(permittedUsesText)) !== null) {
      if (m[1]) {
        // Try comma-split for multi-term grants ("vehicle sales or hire premises, vehicle body repair workshop")
        const rawTerms = m[1].split(/\s*,\s*(?:and\s*)?/)
        for (const raw of rawTerms) {
          const slug = `lu:${toSlug(raw.trim())}`
          if (luMap.has(slug)) permittedLandUseIds.push(slug)
        }
      }
    }

    const siteIndex = clauseId.replace('sch.1-sec.', '')
    sites.push({
      id: `sch1:${siteIndex}`,
      clauseId,
      heading,
      address,
      lotDP,
      permittedUsesText,
      permittedLandUseIds: [...new Set(permittedLandUseIds)],
    })
  }

  return sites
}

// ── Schedule 5 — Heritage Items ───────────────────────────────────────────────

export function extractHeritageItems(doc: any): HeritageItem[] {
  const items: HeritageItem[] = []

  // Find the <table> element with id containing sch.5-pt.1-tbl
  const tables: any[] = allByTag(doc, 'table')
  const tbl = tables.find((el: any) => (el.getAttribute('id') ?? '').includes('sch.5-pt.1-tbl'))
  if (!tbl) return items

  // tbody rows — each data row id contains 'tblr' but NOT 'tblh' (header)
  const rows: any[] = allByTag(tbl, 'row').filter((el: any) => {
    const id = el.getAttribute('id') ?? ''
    return id.includes('tblr') && !id.includes('tblh')
  })

  for (const row of rows) {
    const entries: any[] = allByTag(row, 'entry')
    if (entries.length < 6) continue

    const suburb = textOf(entries[0])
    const name = textOf(entries[1])
    const address = textOf(entries[2])
    const lotDP = textOf(entries[3])
    const significance = textOf(entries[4])
    const itemNo = textOf(entries[5])

    if (!itemNo || !name) continue

    items.push({
      id: `heritage:${itemNo}`,
      itemNo,
      name,
      address,
      lotDP,
      suburb,
      significance,
    })
  }

  return items
}

// ── Part 6 — Local Provisions ─────────────────────────────────────────────────

export function extractLocalProvisions(doc: any): LocalProvision[] {
  const provisions: LocalProvision[] = []
  const allLevels: any[] = allByTag(doc, 'level')

  const pt6 = allLevels.find((el: any) => el.getAttribute('id') === 'pt.6')
  if (!pt6) return provisions

  const clauses = (allByTag(pt6, 'level') as any[]).filter(
    (el: any) =>
      el.getAttribute('type') === 'clause' &&
      /^sec\.6\.[0-9A-Z]+$/.test(el.getAttribute('id') ?? '') &&
      el.getAttribute('status') !== 'repealed'
  )

  for (const clause of clauses) {
    const sectionId = clause.getAttribute('id') ?? ''
    const cHead = findChild(clause, 'head')
    if (!cHead) continue
    const headingEl = findChild(cHead, 'heading')
    const noEl = findChild(cHead, 'no')
    const title = textOf(headingEl)
    if (!title) continue
    const clauseId = textOf(noEl)

    // Extract first operative subclause as summary (skip objectives)
    const tiers: any[] = (allByTag(clause, 'tier') as any[]).filter(
      (t: any) => {
        const id = t.getAttribute('id') ?? ''
        return id.startsWith(sectionId + '-ssec.') && !id.slice((sectionId + '-ssec.').length).includes('-')
      }
    )

    let summary = ''
    for (const tier of tiers) {
      const text = textOf(tier)
      if (text && !/^the objectives? of this clause/i.test(text)) {
        summary = text
        break
      }
    }

    provisions.push({ id: `prov:${sectionId}`, clauseId, sectionId, title, summary })
  }

  return provisions
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseEPI2(xmlString: string): EPIGraph2 {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml')

  const parseError = (doc as any).getElementsByTagName('parsererror')[0]
  if (parseError) {
    throw new Error(`XML parse error: ${textOf(parseError).slice(0, 200)}`)
  }

  // Run the base parser (re-parses — acceptable for server-side one-shot)
  const base: EPIGraph = parseEPI(xmlString)

  // Build luMap from the base landUses for term-matching
  const luMap = new Map<string, LandUse>(base.landUses.map(lu => [lu.id, lu]))

  const schedule1Sites = extractSchedule1Sites(doc, luMap)
  const heritageItems = extractHeritageItems(doc)
  const localProvisions = extractLocalProvisions(doc)
  const structure = extractDocumentStructure(doc)

  return {
    ...base,
    schedule1Sites,
    heritageItems,
    localProvisions,
    structure,
  }
}
