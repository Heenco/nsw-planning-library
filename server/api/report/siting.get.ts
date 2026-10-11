/**
 * GET /api/report/siting?cadid=&type=dwelling house|dual occupancy[&detached=yes|no][&pathway=da|complying]
 *   - the brief a building of that type is sited against on this lot, and a first placement of it, for /report-2
 * GET /api/report/siting?cadid=&type=&topic=height|fsr|floor_area|lot_size|lot_width|permissibility
 *   - the full RAG trace behind one of those figures
 *
 * Every number has one source and says which:
 *   - permissibility, height, FSR / floor area, minimum lot size and lot width: the RAG engine (shared/rag/evaluate.ts),
 *     resolved for this type across the LEP and the SEPPs, with the clause labels that won;
 *   - setbacks: the council's DCP rules (server/utils/design-brief.ts dcpControls), the rows the envelope route uses;
 *   - the lot: derived.lot_frontage's ring and frontage runs - the shape the report's own Lot and frontage section draws.
 * The envelope (buildable area, edge roles) comes from buildEnvelopeModel, so it is the line craftbot draws.
 *
 * The page edits the placement and re-checks it itself (shared/siting.mjs) - nothing here is called again on a drag.
 */
import { evaluate, explain, loadEngine, writeAnswer, type Ask, type Engine, type Explained, type Result } from '#shared/rag/evaluate'
import { ragLotFacts } from '#shared/rag/lot-facts'
import { landUseKey } from '#shared/land-use-key'
import { buildEnvelopeModel } from '#shared/envelope-model.mjs'
import { templateBlocks, bindingControl, simplifyRing } from '#shared/siting.mjs'
import { nswQuery } from '../../utils/nsw-kg/pool'
import { ragEngine } from '../../utils/rag-engine'
import { dcpControls } from '../../utils/design-brief'
import { idsNamedIn, provisionIds, ragProvisions, type RagProvision } from '../../utils/rag-provisions'

const q = (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])

/** the shared engine, reloaded when the rag tables change (server/utils/rag-engine.ts) */
const engineOf = (): Promise<Engine> => ragEngine()
const lotCache = new Map<string, { at: number; lot: any }>()
async function lotOf(cadid: string): Promise<any> {
  const hit = lotCache.get(cadid)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.lot
  const lot = await ragLotFacts(q, cadid)
  lotCache.set(cadid, { at: Date.now(), lot })
  if (lotCache.size > 50) lotCache.delete(lotCache.keys().next().value!)
  return lot
}

/** The types the page can place, in the order a reader thinks of them. A type is offered only when it has a template. */
export const SITING_TYPES = ['dwelling house', 'dual occupancy'] as const
const TOPICS = ['height', 'fsr', 'floor_area', 'lot_size', 'lot_width'] as const

export interface SitingFigure {
  verdict: string
  value: number | null
  unit: string | null
  expr: string | null
  /** The clause labels the figure rests on. */
  by: string[]
  /** What it turns on, when undecided. */
  unknowns: string[]
}
export interface SitingBrief {
  siteArea: number
  frontage: number | null
  lotPolygon: number[][] | null
  buildablePolygon: number[][] | null
  edgeRoles: string[]
  insetApprox: boolean
  geometrySource: string
  height: number
  heightSource: string
  gfaCap: number | null
  gfaExpr: string | null
  /** decided | maybe | none - why there is or is not a cap */
  fsrVerdict: string
  minLotSize: number | null
  minLotWidth: number | null
  setbacks: { front: number; rear: number; side: number; secondary: number }
  setbackClauses: { front: string; rear: string; side: string; secondary: string }
  controls: any[]
  sources: Record<string, string>
}
export interface SitingResponse {
  engine: 'rag' | 'none'
  reason?: string
  plan: string | null
  address: string | null
  type: string
  types: { type: string; verdict: string; consent: 'with' | 'without' | null; by: string[] }[]
  figures: Record<string, SitingFigure>
  brief: SitingBrief | null
  blocks: any[]
  note: string | null
  binding: { binds: string; envelopeArea: number; capArea: number | null } | null
  ms: number
}
export interface SitingTrace { type: string; topic: string; verdict: string; text: string; explained: Explained; provisions: Record<string, RagProvision> }

const wonOf = (E: Engine, r: Result) => {
  const ids = new Set(r.ruling?.answer?.claims ?? [])
  const won = r.tested.filter(t => ids.has(t.claim.id)).map(t => t.claim) as any[]
  return { won, by: [...new Set(won.map(c => E.label(c.provision_id)))] }
}

export default defineEventHandler(async (event): Promise<SitingResponse | SitingTrace> => {
  const started = Date.now()
  const query = getQuery(event)
  const cadid = String(query.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const type = landUseKey(String(query.type ?? 'dwelling house'))
  // the kind named in the use decides it ("dual occupancy (detached)", as "What can I build" passes it); a parameter otherwise
  const detached = /\(detached\)/.test(type) ? true : /\(attached\)/.test(type) ? false
    : query.detached === 'yes' ? true : query.detached === 'no' ? false : null
  const pathway = query.pathway === 'complying' ? 'complying' as const : 'da' as const

  let lot: any
  try { lot = await lotOf(cadid) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }
  const plans = (await q(`SELECT title FROM rag.instrument WHERE kind = 'lep'`).catch(() => ({ rows: [] as any[] }))).rows.map(r => String(r.title))
  const plan = lot.epi ?? null
  const none = (reason: string): SitingResponse => ({ engine: 'none', reason, plan, address: lot.address ?? null, type, types: [], figures: {},
    brief: null, blocks: [], note: null, binding: null, ms: Date.now() - started })
  if (!plan || !plans.includes(plan)) {
    if (query.topic) throw createError({ statusCode: 404, statusMessage: 'The RAG does not hold this lot\'s plan' })
    return none(`The RAG holds ${plans.join(', ') || 'no plan'}; this lot is under ${plan ?? 'no mapped LEP'}.`)
  }
  setHeader(event, 'cache-control', 'public, max-age=60')
  const E = await engineOf()
  const ask = (use: string, topic: string | null): Ask => (topic && topic !== 'permissibility'
    ? { kind: 'standard', use, topic, proposal: 'development', detached, pathway }
    : { kind: 'permissibility', use, detached, pathway })

  // one figure's trace
  if (query.topic) {
    const topic = String(query.topic)
    const r = evaluate(E, ask(type, topic), lot)
    const x = explain(E, r)
    return { type, topic, verdict: r.verdict, text: writeAnswer(E, r, lot), explained: x, provisions: await ragProvisions(idsNamedIn(E, x, provisionIds(x))) }
  }

  // the use being sited, and whether the zone allows it - chosen in "What can I build", not here
  const types = [type].map((use) => {
    const p = evaluate(E, ask(use, null), lot)
    const w = wonOf(E, p)
    const consent = p.verdict === 'permitted' ? (w.won.some(c => c.consent === 'without') && !w.won.some(c => c.consent === 'with') ? 'without' as const : 'with' as const) : null
    return { type: use, verdict: p.verdict, consent, by: w.by }
  })

  const figures: Record<string, SitingFigure> = {}
  for (const t of TOPICS) {
    const r = evaluate(E, ask(type, t), lot)
    const a: any = r.answer
    figures[t] = {
      verdict: r.verdict,
      value: a?.effect === 'value' && a.value != null ? Number(a.value) : null,
      unit: a?.unit ?? null, expr: a?.expr ?? null,
      by: wonOf(E, r).by,
      unknowns: [...new Set(explain(E, r).notChecked)],
    }
  }

  // The lot as the report's Lot and frontage section has it: ring, frontage runs, recorded figures.
  const f = (await q(
    `SELECT ST_AsGeoJSON(ST_ForcePolygonCCW(ST_Transform(geom, 4326)), 8) AS ring, primary_frontage_length_m::float8 AS frontage, lot_depth_m::float8 AS depth,
            area_sqm::float8 AS area, is_corner_lot, is_battleaxe
       FROM derived.lot_frontage WHERE cadid::text = $1`, [cadid])).rows[0]
  const runs = (await q(`SELECT road_name, length_m::float8 AS length_m, is_primary FROM derived.lot_frontage_run WHERE cadid::text = $1 ORDER BY is_primary DESC, seq`, [cadid])).rows
  const ringJson = f?.ring ? JSON.parse(f.ring) : null
  const ring = ringJson?.type === 'Polygon' ? simplifyRing(ringJson.coordinates[0]) as number[][] : null

  const height = figures.height.value
  const storeys = 2
  const controls = await dcpControls({ landUses: [type], storeys, lga: lot.lga ?? null, zoneSym: lot.zone ?? null, frontage: f?.frontage ?? null })
  const envelopeLot = {
    address: lot.address ?? cadid,
    primary_frontage_length_m: f?.frontage ?? null, lot_depth_m: f?.depth ?? null, area_sqm: f?.area ?? lot.area_m2 ?? null,
    is_corner_lot: !!f?.is_corner_lot, is_battleaxe: !!f?.is_battleaxe,
    all_frontages: runs.map((r: any) => `${r.road_name ?? 'ROAD'}:${Number(r.length_m).toFixed(2)}m`).join(','),
    // The RAG's height for this type goes in as the mapped standard; the envelope still takes a lower DCP height if one binds.
    hob_max_b_h_m: height, zone: lot.zone ?? null, epi_name: plan,
  }
  const { meta } = buildEnvelopeModel(envelopeLot, controls.filter((c: any) => c.topic === 'setback' || c.topic === 'height'), ring) as any
  const siteArea = meta.lotPolygon ? Number(meta.polygonArea) || Number(f?.area) || 0 : Number(f?.area ?? lot.area_m2) || 0

  const floorArea = figures.floor_area.value
  const fsr = figures.fsr.value
  const gfaCap = floorArea ?? (fsr != null && siteArea ? fsr * siteArea : null)
  const gfaExpr = floorArea != null ? (figures.floor_area.expr ?? null) : fsr != null ? `FSR ${+fsr.toFixed(2)}:1 x ${Math.round(siteArea)} m²` : null
  const heightFromRag = height != null && meta.heightSource?.startsWith('HOB')
  const sources: Record<string, string> = {}
  if (figures.height.by.length) sources.height = figures.height.by.join(', ')
  if ((floorArea != null ? figures.floor_area : figures.fsr).by.length) sources.fsr = (floorArea != null ? figures.floor_area : figures.fsr).by.join(', ')
  if (figures.lot_size.by.length) sources.lot_size = figures.lot_size.by.join(', ')
  if (figures.lot_width.by.length) sources.lot_width = figures.lot_width.by.join(', ')

  const brief: SitingBrief = {
    siteArea,
    frontage: meta.frontageLength ?? f?.frontage ?? null,
    lotPolygon: meta.lotPolygon ?? null,
    buildablePolygon: meta.buildablePolygon ?? null,
    edgeRoles: meta.edgeRoles ?? [],
    insetApprox: !!meta.insetApprox,
    geometrySource: ring ? 'derived.lot_frontage (NSW cadastre)' : 'no boundary held',
    height: meta.height,
    heightSource: heightFromRag ? (sources.height ?? 'RAG') : meta.heightSource,
    gfaCap, gfaExpr, fsrVerdict: floorArea != null ? figures.floor_area.verdict : figures.fsr.verdict,
    minLotSize: figures.lot_size.value,
    minLotWidth: figures.lot_width.value,
    setbacks: { front: meta.front, rear: meta.rear, side: meta.side, secondary: meta.secondary },
    setbackClauses: { front: meta.frontClause, rear: meta.rearClause, side: meta.sideClause, secondary: meta.secondaryClause },
    controls,
    sources: { ...sources, height: heightFromRag ? (sources.height ?? 'RAG') : meta.heightSource },
  }
  const { blocks, note } = templateBlocks(type, brief, { detached })

  return { engine: 'rag', plan, address: lot.address ?? null, type, types, figures, brief, blocks, note, binding: bindingControl(brief), ms: Date.now() - started }
})
