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
  id: string
  term: string
  canonical: boolean
}

export interface Requirement {
  id: string
  clauseId: string
  sectionId: string
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

// ── Extended ontology types (EPIGraph2) ───────────────────────────────────────

export interface Schedule1Site {
  id: string             // 'sch1:1', 'sch1:2', ...
  clauseId: string       // 'sch.1-sec.1'
  heading: string        // 'Use of certain land at 201 Canambe Street, Armidale'
  address: string        // '201 Canambe Street, Armidale'
  lotDP: string          // 'Lot 9, DP 862908' (first extracted lot reference)
  permittedUsesText: string    // full text of the subclause granting permission
  permittedLandUseIds: string[]  // normalised lu:slug IDs if recognisable
}

export interface HeritageItem {
  id: string             // 'heritage:I001'
  itemNo: string         // 'I001'
  name: string           // 'Aberfoyle Cemetery'
  address: string        // '1824 Aberfoyle Road'
  lotDP: string          // 'Lots 7300 and 7301, DP 1153423'
  suburb: string         // 'Aberfoyle'
  significance: string   // 'Local' | 'State' (text as-is from table)
}

export interface LocalProvision {
  id: string             // 'prov:sec.6.1'
  clauseId: string       // '6.1'
  sectionId: string      // 'sec.6.1'
  title: string          // 'Earthworks'
  summary: string        // first operative subclause text
}

export interface LegalStructureNode {
  id: string
  kind: 'part' | 'section' | 'schedule' | 'clause' | 'subclause' | 'paragraph' | 'list-item' | 'definition' | 'reference'
  number?: string
  title: string
  text?: string
  sourceId?: string
}

export interface LegalStructureEdge {
  source: string
  target: string
  relation: 'contains' | 'defines' | 'references'
}

export interface EPIGraph2 extends EPIGraph {
  schedule1Sites: Schedule1Site[]
  heritageItems: HeritageItem[]
  localProvisions: LocalProvision[]
  structure: {
    nodes: LegalStructureNode[]
    edges: LegalStructureEdge[]
  }
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
