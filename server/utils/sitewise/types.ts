// ── Shared types for Sitewise multi-agent pipeline ──────────────────────

export interface GeoResult {
  lat: number
  lng: number
  place: string
}

export interface LotPolygon {
  rings: number[][][]
  area: number
  address?: string
  planlabel?: string     // Composite "lot/section/plan" label for display
  lotNumber?: string     // Raw lot number (e.g. "101")
  sectionNumber?: string // Raw section number (usually empty for modern DPs)
  planNumber?: string    // Raw plan number (e.g. "DP748167")
}

export interface GISResult {
  lat: number
  lng: number
  place: string
  zone: string
  lepName: string
  fsr: string | number | null
  fsrNote?: string | null
  maxHeight: string | number | null
  heightNote?: string | null
  minLotSize: string | number | null
  lotSizeClause?: string | null
  lotArea?: number
  lotPlan?: string           // Composite "lot/section/plan"
  lotNumber?: string
  sectionNumber?: string
  planNumber?: string
  lotRings?: number[][][]
}

export interface PermissibilityEntry {
  epicode: string
  zoneCode: string
  clauseHeading?: string
  sectionId?: string
  landUses?: string[]
  sqmValues?: string[]
  appliesToAllZones?: boolean
}

export interface LegalResult {
  permissibility: {
    status: 'Permitted WITH consent' | 'Permitted WITHOUT consent' | 'PROHIBITED' | 'unknown'
    clause?: string
    section?: string
    flag?: string
  }
  landUse: string
  landUseCategory: string
  epicode?: string
  lepSummary?: string
  todStatus: string
  todDetail?: string
  seppContext?: string
  applicableSepps: Array<{
    key: string
    label: string
    subLayerHits: Array<{ key: string; label: string; attrs?: any }>
  }>
  applicableDcp: Array<{ key: string; label: string }>
  lepAdditional: Array<{ key: string; label: string; attrs?: any }>
  lga?: string
  council?: string
}

export interface EnvironmentalResult {
  overlays: Array<{ key: string; label: string; attrs: any }>
  constraintSummary: string
}

export interface LocationCategory {
  id: string
  label: string
  count: number
  nearest: number
  score: number
  grade: string
  pois: Array<{ name: string; dist: number }>
}

export interface LocationResult {
  score: number
  label: string
  categories: LocationCategory[]
}

export interface StandardsResult {
  controls: Record<string, any>
  sections: string[]
  dcpContext?: string
}

// ── Agent output envelope ──────────────────────────────────────────────

export interface SSEEvent {
  type: string
  payload: any
}

export interface AgentOutput<T = any> {
  agent: string
  success: boolean
  data: T
  sseEvents: SSEEvent[]
  error?: string
  usage?: { inputTokens: number; outputTokens: number; cost: number }
}

// ── SSE step helper type ───────────────────────────────────────────────

export type StepFn = (agent: string, status: string, message: string, detail?: string) => void

// ── LLM provider types ─────────────────────────────────────────────────

export type LLMProvider = 'deepinfra' | 'groq' | 'gemini'

export interface LLMCallOptions {
  provider: LLMProvider
  model: string
  system: string
  user: string
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  tools?: any[]
  toolChoice?: string
  stream?: boolean
  timeoutMs?: number
}

export interface LLMResponse {
  content: string
  toolCalls?: any[]
  usage?: { input: number; output: number }
}

// ── SEPP catalogue types ───────────────────────────────────────────────

export interface SeppSubLayer {
  key: string
  label: string
  url: string
}

export interface SeppEntry {
  label: string
  landAppUrl: string
  subLayers?: SeppSubLayer[]
}
