/**
 * GET /api/report/build-controls?cadid=          - what could be built on this lot: every use the plans name, with the zone's verdict
 * GET /api/report/build-controls?cadid=&use=     - that use on this lot: whether it is permissible, and every development control
 *
 * Use first, for /report-2: the reader picks what they want to build and gets every control for it, rather than every
 * control in the plan with the uses scattered through it. All of it from the RAG engine (shared/rag/evaluate.ts):
 *
 *   options     every use a claim in this lot's LEP or a SEPP names (the Land Use Tables, the SEPP grants, the standards),
 *               each asked of the engine once - permitted with or without consent, depends, prohibited
 *   permission  the verdict for the chosen use, the clauses it rests on, the precedence steps, and the conditions the
 *               permission carries (the engine's limits)
 *   controls    height, FSR, floor area, lot size, lot width, parking - each resolved for this use on this lot, with the
 *               clause that wins, the clause it beats, what it turns on when undecided, and the bands of the same clause
 *               this lot is not in
 *   areas       mapped areas the lot sits in whose clauses reach this use
 *
 * Nothing is listed by hand and no figure is chosen here.
 */
import { evaluate, explain, lepFor, loadEngine, type Engine, type Result, instrumentsFor } from '#shared/rag/evaluate'
import { ragLotFacts } from '#shared/rag/lot-facts'
import { landUseKey } from '#shared/land-use-key'
import { nswQuery } from '../../utils/nsw-kg/pool'
import { ragEngine } from '../../utils/rag-engine'

const q = (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])

/** the shared engine, reloaded when the rag tables change (server/utils/rag-engine.ts) */
const engineOf = (tier: 'rag' | 'kg' = 'rag'): Promise<Engine> => ragEngine(tier)
const lotCache = new Map<string, { at: number; lot: any; options?: BuildOption[]; areas?: BuildArea[] }>()
async function lotOf(cadid: string, tier = 'rag', precinct = false) {
  const key = `${tier}:${precinct ? 'p:' : ''}${cadid}`
  const hit = lotCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit
  const entry = { at: Date.now(), lot: await ragLotFacts(q, cadid, tier as 'rag' | 'kg', { precinct }) as any }
  lotCache.set(key, entry)
  if (lotCache.size > 50) lotCache.delete(lotCache.keys().next().value!)
  return entry as { at: number; lot: any; options?: BuildOption[]; areas?: BuildArea[] }
}

/** The controls, in reading order. */
export const BUILD_TOPICS = [
  { key: 'height', label: 'Maximum height' },
  { key: 'fsr', label: 'Floor space ratio' },
  { key: 'floor_area', label: 'Floor area' },
  { key: 'lot_size', label: 'Minimum lot size' },
  { key: 'lot_width', label: 'Minimum lot width' },
  { key: 'parking', label: 'Parking' },
] as const

/**
 * Setbacks, asked only when the DCP tier is on (?dcp=1). They are mostly a DCP control - the LEPs
 * hold 247 of them and the four loaded DCPs 409 - and no endpoint has asked for them before, so
 * they stay behind the flag until a gold set says the answers are right.
 */
export const SETBACK_TOPICS = [
  { key: 'setback_primary', label: 'Front setback' },
  { key: 'setback_side', label: 'Side setback' },
  { key: 'setback_rear', label: 'Rear setback' },
  { key: 'setback_secondary', label: 'Secondary street setback' },
  { key: 'setback_boundary', label: 'Boundary setback' },
  { key: 'building_separation', label: 'Building separation' },
] as const

export interface BuildOption { use: string; label: string; verdict: 'permitted' | 'prohibited' | 'maybe'; consent: 'with' | 'without' | null }
export interface BuildFigure {
  verdict: string; value: number | null; unit: string | null; expr: string | null
  by: string[]
  /** the provisions behind `by`, same order - their words are served in `clauses` */
  byIds: string[]
  steps: { winner: string; loser: string; interpretive: boolean }[]
  /** the cases it splits into when a fact is not known: the figure in each and the fact */
  branches: { if: string; answer: string | null }[]
  /** undecided with no case split: the figures in contention */
  candidates: { label: string; value: number | null; unit: string | null }[]
  sepp: boolean; nonDiscretionary: boolean
}
/** one condition a clause's own words put on it, tested against this lot: null when it cannot be known in advance */
export interface BuildLimit { kind: 'area' | 'site' | 'discretion'; text: string; met: boolean | null }
/** why a figure in contention is in contention: what the engine tested, and what the clause's own text limits it to */
export interface BuildWhy { label: string; value: number | null; unit: string | null
  /** the engine tested at least one condition for it; false = it was given none and so "holds" everywhere */
  engineTested: boolean
  limits: BuildLimit[]
  /** read from its own words against this lot: false when a limit plainly fails here */
  reaches: boolean | null }
export interface BuildControl extends BuildFigure { key: string; label: string
  /** other bands of the clauses for this use that this lot does not fall in: "0.75:1 for sites 300-450 m2" */
  otherBands: { label: string; value: number | null; unit: string | null; band: string }[]
  /** when undecided: each figure in contention and why */
  why: BuildWhy[]
  /** when every figure the clauses' own words leave standing is the same: that figure, labelled as a reading, not the engine's */
  likely: { value: number | null; unit: string | null; by: string[] } | null }
/** a prohibition's "unless" list, read from the clause and tested on the lot: lifted when the lot meets one, stands when it meets none */
export interface BuildExceptions { clause: string; text: string; items: { text: string; met: boolean | null; how: string }[]; outcome: 'lifted' | 'stands' | 'open'
  /** the engine's claim carries these exceptions itself (rag.claim.excludes) - the reading is then a check, not a stand-in */
  engineHas: boolean }
export interface BuildArea { map: string; label: string; coverPct: number
  claims: { label: string; heading: string | null; kind: string; topic: string | null; value: number | null; unit: string | null; uses: string[] }[]
  lotRing: number[][]; areaRings: number[][][] }
export interface BuildResponse {
  engine: 'rag' | 'none'; reason?: string; plan: string | null; address: string | null
  lot: { areaM2: number | null; frontageM: number | null; zone: string | null } | null
  options: BuildOption[]
  use: string | null
  permission: (BuildFigure & { consent: 'with' | 'without' | null; conditions: { label: string; detail: string; status: string }[]
    /** each kind of the use the list holds ("dual occupancy (attached)"), asked on its own */
    kinds?: { use: string; label: string; verdict: string; consent: 'with' | 'without' | null; by: string[] }[]
    /** the narrower kinds the deciding clauses are about, when the answer rests on one */
    narrower?: string[]
    exceptions?: BuildExceptions | null }) | null
  controls: BuildControl[]
  areas: BuildArea[]
  /** the words of every clause the verdict and the controls cite, by its label - what a hover over the label shows */
  clauses: Record<string, { heading: string | null; text: string }>
  ms: number
}

const plainIf = (raw: string) => raw.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
  const open = inner.split(/; (?=[^;]*: (?:yes|no|unknown)(?:;|$))/).filter(x => /: unknown$/.test(x)).map(x => x.replace(/: unknown$/, ''))
  return open.length ? `[${open.join('; ')}]` : ''
}).replace(/^frame\s*/, '').replace(/: unknown/g, '').replace(/\s+/g, ' ').trim()

function figure(E: Engine, r: Result): BuildFigure {
  const ids = new Set(r.ruling?.answer?.claims ?? [])
  const won = r.tested.filter(t => ids.has(t.claim.id)).map(t => t.claim)
  const a: any = r.answer
  const x = explain(E, r)
  return {
    verdict: r.verdict,
    value: a?.effect === 'value' && a.value != null ? Number(a.value) : null,
    unit: a?.unit ?? null, expr: a?.expr ?? null,
    by: [...new Set(won.map(c => E.label(c.provision_id)))],
    byIds: [...new Map(won.map(c => [E.label(c.provision_id), c.provision_id])).values()],
    // one line per pair: the engine records a step for each claim of the losing provision (cl 6.11(2) over the R4 table, x3)
    steps: [...new Map(x.steps.map(s => [`${s.winner}|${s.loser}`, { winner: s.winner, loser: s.loser, interpretive: s.basis === 'interpretive' && s.status !== 'verified' }])).values()],
    branches: x.branches.map(b => ({ if: plainIf(b.if), answer: b.answer })),
    candidates: r.verdict === 'maybe' && !x.branches.length
      ? [...new Map(r.tested.filter(t => t.holds !== false && ((t as any).value ?? t.claim.value) != null)
        .map(t => [E.label(t.claim.provision_id), { label: E.label(t.claim.provision_id), value: (t as any).value ?? t.claim.value, unit: t.claim.unit }])).values()]
      : [],
    sepp: won.some(c => E.provs.get(c.provision_id)?.doc_kind === 'sepp'),
    nonDiscretionary: won.some(c => c.non_discretionary),
  }
}
/** The nearest heading up the provision tree - the clause's own name. */
const headingOf = (E: Engine, id: string): string | null => {
  for (let p = E.provs.get(id), i = 0; p && i < 8; p = p.parent_id ? E.provs.get(p.parent_id) : undefined, i++) if (p.heading) return p.heading
  return null
}

export default defineEventHandler(async (event): Promise<BuildResponse> => {
  const started = Date.now()
  const query = getQuery(event)
  const precinct = String(query.precinct ?? '') === '1'   // the governing-unit path (docs/precinct-sepp-pipeline.md); off = as before
  const cadid = String(query.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  // ?dcp=1 adds the council DCP tier (rank 10, below every statutory instrument). Off by default,
  // and read before lotOf because the per-lot option list is computed under whichever scope applies.
  const withDcp = query.dcp === '1' || query.dcp === 'true'
  const tier = withDcp ? 'kg' as const : 'rag' as const
  let entry: Awaited<ReturnType<typeof lotOf>>
  try { entry = await lotOf(cadid, tier, precinct) }
  catch (e: any) { throw createError({ statusCode: 404, statusMessage: e.message }) }
  const lot = entry.lot
  const E = await engineOf(tier)
  const lep = lepFor(E, lot).doc
  const lotInfo = { areaM2: lot.area_m2 ?? null, frontageM: lot.frontage_m ?? null, zone: lot.zone ?? null }
  if (!lep) {
    return { engine: 'none', reason: `The RAG does not hold ${lot.epi ?? 'this lot\'s plan'}.`, plan: lot.epi ?? null, address: lot.address ?? null,
      lot: lotInfo, options: [], use: null, permission: null, controls: [], areas: [], clauses: {}, ms: Date.now() - started }
  }
  setHeader(event, 'cache-control', 'public, max-age=60')
  // the lot's own LEP, any SEPP, and - only when asked - any DCP the engine holds. Rank decides
  // precedence elsewhere; this decides visibility, and a DCP that is invisible reads as "no control".
  const inScope = (docId: string | undefined) =>
    docId === lep || E.insts.some(i => i.document_id === docId && (i.kind === 'sepp' || (withDcp && i.kind === 'dcp')))

  // every use the plans name, each asked once per lot
  if (!entry.options) {
    // A use is a term the plans' own Dictionary defines AND a clause names. Claims alone carry extraction fragments
    // ("(c) food and drink premises", whole definition sentences); the Dictionary alone carries terms that are not uses
    // ("secondary road", "gross floor area"). The Dictionary's spelling is the one shown.
    const named = new Set<string>()
    for (const c of E.claims) {
      if (!['permit', 'prohibit', 'standard'].includes(c.kind) || !inScope(E.provs.get(c.provision_id)?.document_id)) continue
      for (const u of c.uses ?? []) if (u && u !== '*') named.add(landUseKey(u))
    }
    // What a Land Use Table names, in any LEP held: the planning vocabulary of things one builds, read from the data. Any
    // permit/prohibit clause let in terms that are not uses ("Area 1", "habitable room"); SEPP clauses did the same once
    // the Codes SEPP was read in ("attached", "storey", "Land Zoning Map", "Complying development certificate" - its
    // exempt and complying clauses name structures and conditions, not land uses). The verdict for each use is still the
    // engine's, SEPP grants included; only the list comes from the tables.
    const permitNamed = new Set<string>()
    for (const c of E.claims) {
      if (!['permit', 'prohibit'].includes(c.kind)) continue
      const p = E.provs.get(c.provision_id)
      if (!p || p.doc_kind !== 'lep') continue
      if (!(p.local_id.startsWith('pt-cg') || p.path.some(x => x.startsWith('pt-cg')))) continue
      // a map is never a use ("Land Zoning Map" comes through from a table row that refers to it)
      for (const u of c.uses ?? []) if (u && u !== '*' && !/\bmap$/i.test(u.trim())) permitNamed.add(landUseKey(u))
    }
    // the instruments that speak to this lot (claimsFor): the governing plan and the SEPPs that reach it, not a Precinct SEPP's
    // other appendices nor a Precinct SEPP the lot is not under
    const docs = [lep, ...[...instrumentsFor(E, lot, lep)].filter(d => d !== lep)]
    const terms = (await q(`SELECT heading FROM rag.provision WHERE kind = 'term' AND heading IS NOT NULL AND document_id = ANY($1::uuid[])
                            ORDER BY (document_id = $2::uuid) DESC`, [docs, lep])).rows
    const shown = new Map<string, string>()
    for (const t of terms) {
      // the key the clauses use: the Dictionary says "home business", the Land Use Table "home businesses", and landUseKey
      // keeps them apart ("home busines" / "home businesse") - asking with the Dictionary's key found no permission and
      // fell to the catch-all, so home business read as prohibited in R2
      // - and cl 5.4 names the singular, so the key a Land Use Table or SEPP grant uses is preferred over any other
      const keys = [t.heading, `${t.heading}s`, `${t.heading}es`].map(h => landUseKey(h))
      const k = keys.find(x => permitNamed.has(x))
      if (k && !shown.has(k)) shown.set(k, t.heading)
    }
    entry.options = [...shown.entries()].sort((a, b) => a[1].localeCompare(b[1])).flatMap(([use, label]) => {
      const r = evaluate(E, { kind: 'permissibility', use }, lot)
      if (!['permitted', 'prohibited', 'maybe'].includes(r.verdict)) return []
      const ids = new Set(r.ruling?.answer?.claims ?? [])
      const won = r.tested.filter(t => ids.has(t.claim.id)).map(t => t.claim)
      const consent = r.verdict === 'permitted' ? (won.some(c => c.consent === 'without') && !won.some(c => c.consent === 'with') ? 'without' as const : 'with' as const) : null
      return [{ use, label, verdict: r.verdict as BuildOption['verdict'], consent }]
    })
  }

  // the mapped areas the lot is in that a clause names (rag.map_polygon - what the engine tests "mapped:" terms against)
  if (!entry.areas) {
    const named = new Map<string, BuildArea['claims']>()
    for (const c of E.claims) {
      if (!inScope(E.provs.get(c.provision_id)?.document_id)) continue
      for (const term of c.terms ?? []) {
        const m = String(term).match(/^mapped:(.+) on the (.+?) Map$/i)
        if (!m) continue
        const key = `${m[2]!.toLowerCase()}|${m[1]!.toLowerCase()}`
        const list = named.get(key) ?? []
        if (!list.some(x => x.label === E.label(c.provision_id) && x.topic === c.topic && x.kind === c.kind)) {
          list.push({ label: E.label(c.provision_id), heading: headingOf(E, c.provision_id), kind: c.kind, topic: c.topic, value: c.value, unit: c.unit, uses: (c.uses ?? []).map(u => landUseKey(u)) })
        }
        named.set(key, list)
      }
    }
    const polys = (await q(`WITH l AS (SELECT geom g, ST_Transform(geom, 3308) m FROM cadastre.lot WHERE cadid::text = $1 LIMIT 1),
        c AS (SELECT ST_X(ST_Centroid(m)) cx, ST_Y(ST_Centroid(m)) cy, ST_Area(m) a FROM l)
      SELECT p.map, p.label,
             round((100 * ST_Area(ST_Intersection(ST_Transform(ST_Union(p.geom), 3308), l.m)) / NULLIF(c.a, 0))::numeric, 1)::float8 AS cover,
             ST_AsGeoJSON(ST_Translate(ST_Intersection(ST_Transform(ST_Union(p.geom), 3308), ST_Expand(l.m, 40)), -c.cx, -c.cy), 2) AS area,
             ST_AsGeoJSON(ST_Translate(l.m, -c.cx, -c.cy), 2) AS lot
        FROM rag.map_polygon p, l, c
       WHERE p.document_id = $2 AND (p.map || '|' || p.label) = ANY($3::text[]) AND p.geom && l.g AND ST_Intersects(p.geom, l.g)
       GROUP BY p.map, p.label, l.m, c.cx, c.cy, c.a`, [cadid, lep, [...named.keys()]]).catch(() => ({ rows: [] as any[] }))).rows
    const rings = (gj: string | null): number[][][] => {
      const g = gj ? JSON.parse(gj) : null
      if (!g) return []
      if (g.type === 'Polygon') return [g.coordinates[0]]
      if (g.type === 'MultiPolygon') return g.coordinates.map((p: any) => p[0])
      if (g.type === 'GeometryCollection') return g.geometries.flatMap((x: any) => rings(JSON.stringify(x)))
      return []
    }
    entry.areas = polys.filter(p => named.has(`${p.map}|${p.label}`) && Number(p.cover) >= 1)
      .map(p => ({ map: p.map, label: p.label, coverPct: Number(p.cover), claims: named.get(`${p.map}|${p.label}`)!, lotRing: rings(p.lot)[0] ?? [], areaRings: rings(p.area) }))
  }

  const base = { engine: 'rag' as const, plan: lot.epi ?? null, address: lot.address ?? null, lot: lotInfo, options: entry.options }
  const use = query.use ? landUseKey(String(query.use)) : null
  if (!use) return { ...base, use: null, permission: null, controls: [], areas: entry.areas, clauses: {}, ms: Date.now() - started }

  // the chosen use: is it permissible, and on what conditions
  const p = evaluate(E, { kind: 'permissibility', use }, lot)
  const pf = figure(E, p)
  const ids = new Set(p.ruling?.answer?.claims ?? [])
  const won = p.tested.filter(t => ids.has(t.claim.id)).map(t => t.claim)
  const permission = { ...pf,
    consent: p.verdict === 'permitted' ? (won.some(c => c.consent === 'without') && !won.some(c => c.consent === 'with') ? 'without' as const : 'with' as const) : null,
    conditions: p.limits.map(l => ({ label: l.label, detail: l.detail, status: l.status })) }

  /**
   * Why figures are in contention. The engine answers "depends" when claims that all hold collide with nothing to rank
   * them - and a claim holds everywhere when it was extracted without its conditions (Parramatta cl 4.4A(5) "on land
   * identified as 'Area 5' on the Floor Space Ratio Map ... if the consent authority is satisfied" came through as a bare
   * 6:1). So for each one, read what its own words (and its parent subclause's) limit it to, and test that on the lot:
   * a named map area against rag.map_polygon, a minimum site area against the lot's area. A consent authority's
   * satisfaction cannot be known in advance and stays open. This reads the text; it does not change the engine's answer.
   */
  const textCache = new Map<string, string>()
  async function textOf(ids: string[]) {
    const need = ids.filter(id => !textCache.has(id))
    if (need.length) for (const r of (await q(`SELECT id::text, coalesce(own_text, '') AS t FROM rag.provision WHERE id = ANY($1::uuid[])`, [need])).rows) textCache.set(r.id, r.t)
    return ids.map(id => textCache.get(id) ?? '').join(' ')
  }
  const chainOf = (id: string) => {
    const out: string[] = []
    for (let p = E.provs.get(id), i = 0; p && i < 6; p = p.parent_id ? E.provs.get(p.parent_id) : undefined, i++) {
      out.push(p.id)
      if (!p.local_id.split('#')[0]!.includes('-')) break            // up to the clause itself
    }
    return out
  }
  const areaCache = new Map<string, boolean | null>()
  async function lotInArea(map: string, label: string): Promise<boolean | null> {
    const k = `${map}|${label}`
    if (areaCache.has(k)) return areaCache.get(k)!
    const known = (await q(`SELECT 1 FROM rag.map_polygon WHERE document_id = $1 AND map = $2 AND label = $3 LIMIT 1`, [lep, map, label])).rows.length > 0
    const inside = known ? (await q(`SELECT 1 FROM rag.map_polygon p, cadastre.lot l
        WHERE l.cadid::text = $1 AND p.document_id = $2 AND p.map = $3 AND p.label = $4 AND p.geom && l.geom
          AND ST_Intersects(p.geom, ST_Transform(ST_Buffer(ST_Transform(l.geom, 3308), -0.1), 4283)) LIMIT 1`, [cadid, lep, map, label])).rows.length > 0 : null
    areaCache.set(k, inside)
    return inside
  }
  async function whyInContention(tested: Result['tested']): Promise<BuildWhy[]> {
    const out = new Map<string, BuildWhy>()
    for (const tt of tested) {
      const label = E.label(tt.claim.provision_id)
      const value = (tt as any).value ?? tt.claim.value
      if (out.has(`${label}|${value}`)) continue
      const text = (await textOf(chainOf(tt.claim.provision_id))).replace(/\s+/g, ' ')
      const limits: BuildLimit[] = []
      for (const m of text.matchAll(/identified as\s*[“"]([^”"]+)[”"]\s*on the\s+([A-Z][A-Za-z ]*?)\s+Map/g)) {
        const [area, map] = [m[1]!.trim(), m[2]!.trim()]
        if (limits.some(l => l.text.startsWith(`${area} on the ${map} Map`))) continue
        const inside = await lotInArea(map.toLowerCase(), area.toLowerCase())
        limits.push({ kind: 'area', text: `${area} on the ${map} Map${inside === null ? ' (no map geometry held)' : inside ? ' - the lot is in it' : ' - the lot is not in it'}`, met: inside })
      }
      const site = text.match(/site area (?:is |of )?at least\s*([\d,]+(?:\.\d+)?)\s*(m2|m²|square metres|hectares?)/i)
      if (site) {
        const min = Number(site[1]!.replace(/,/g, '')) * (/hectare/i.test(site[2]!) ? 10000 : 1)
        const a = lot.area_m2 != null ? Number(lot.area_m2) : null
        limits.push({ kind: 'site', text: `a site area of at least ${min.toLocaleString('en-AU')} m²${a != null ? ` - the lot is ${Math.round(a).toLocaleString('en-AU')} m²` : ''}`, met: a == null ? null : a >= min })
      }
      if (/if the consent authority is satisfied/i.test(text)) limits.push({ kind: 'discretion', text: 'the consent authority being satisfied - a judgement made on the application', met: null })
      out.set(`${label}|${value}`, { label, value, unit: tt.claim.unit, engineTested: tt.why.length > 0, limits,
        reaches: limits.some(l => l.met === false) ? false : limits.length && limits.every(l => l.met === true) ? true : limits.length ? null : true })
    }
    return [...out.values()]
  }

  /*
   * Two things the permission verdict can hide.
   *
   * KINDS. "Dual occupancy" has kinds the plans treat apart - attached and detached. A clause about one kind can decide
   * the verdict for the general use: Parramatta cl 6.11(2) prohibits dual occupancies (detached) and the engine answered
   * "dual occupancy: prohibited" on an R4 lot where attached dual occupancy is permitted with consent. So each kind the
   * list holds is asked on its own and shown beside the general answer, and the general answer says when the clause that
   * decided it is about a narrower kind.
   *
   * EXCEPTIONS. A clause that prohibits "unless the land—" lists its exceptions in child paragraphs, and those can be lost
   * in extraction (cl 6.11(2): heritage item, 2 street frontages, corner lot, South Parramatta Conservation Area). They are
   * read from the text and each tested where the lot data can answer it. As with the standards: this reads the text and
   * says so; it does not change the engine's verdict.
   */
  const kindsOf = (entry.options ?? []).filter(o => o.use.startsWith(`${use} (`))
  const kinds = kindsOf.map((o) => {
    const r = evaluate(E, { kind: 'permissibility', use: o.use }, lot)
    const ids2 = new Set(r.ruling?.answer?.claims ?? [])
    const w2 = r.tested.filter(t => ids2.has(t.claim.id)).map(t => t.claim)
    return { use: o.use, label: o.label, verdict: r.verdict,
      consent: r.verdict === 'permitted' ? (w2.some(c => c.consent === 'without') && !w2.some(c => c.consent === 'with') ? 'without' as const : 'with' as const) : null,
      by: [...new Set(w2.map(c => E.label(c.provision_id)))] }
  })
  const narrower = [...new Set(won.flatMap(c => c.uses ?? []).map(u => landUseKey(u)).filter(u => u.startsWith(`${use} (`)))]

  const facts = (await q(`SELECT f.is_corner_lot, f.frontage_count,
        EXISTS (SELECT 1 FROM epi.epi_heritage h, cadastre.lot l WHERE l.cadid = f.cadid AND h.lay_class ~* '^item' AND h.geom && l.geom
                  AND ST_Intersects(h.geom, ST_Transform(ST_Buffer(ST_Transform(l.geom, 3308), -0.1), 4283))) AS item,
        (SELECT string_agg(DISTINCT coalesce(h.h_name, ''), '; ') FROM epi.epi_heritage h, cadastre.lot l WHERE l.cadid = f.cadid AND h.lay_class ~* '^conservation' AND h.geom && l.geom
                  AND ST_Intersects(h.geom, ST_Transform(ST_Buffer(ST_Transform(l.geom, 3308), -0.1), 4283))) AS areas
      FROM derived.lot_frontage f WHERE f.cadid::text = $1`, [cadid]).catch(() => ({ rows: [] as any[] }))).rows[0] ?? null
  async function testException(text: string): Promise<{ met: boolean | null; how: string }> {
    if (/heritage item/i.test(text)) return facts ? { met: !!facts.item, how: facts.item ? 'a heritage item is on the lot' : 'no heritage item on the lot (Heritage Map)' } : { met: null, how: 'not known' }
    if (/\b(2|two) (street )?frontages/i.test(text)) return facts?.frontage_count != null ? { met: Number(facts.frontage_count) >= 2, how: `${facts.frontage_count} street frontage${Number(facts.frontage_count) === 1 ? '' : 's'}` } : { met: null, how: 'not known' }
    if (/corner lot/i.test(text)) return facts?.is_corner_lot != null ? { met: !!facts.is_corner_lot, how: facts.is_corner_lot ? 'a corner lot' : 'not a corner lot' } : { met: null, how: 'not known' }
    const m = text.match(/identified as\s*[“"]([^”"]+)[”"]\s*on the\s+([A-Z][A-Za-z ]*?)\s+Map/)
    if (m) {
      const [area, map] = [m[1]!.trim(), m[2]!.trim()]
      if (/^heritage$/i.test(map) && facts) {
        const inIt = String(facts.areas ?? '').toLowerCase().includes(area.toLowerCase().replace(/ conservation area$/, ''))
        return { met: inIt, how: inIt ? `in ${area}` : `not in ${area}` }
      }
      const inside = await lotInArea(map.toLowerCase(), area.toLowerCase())
      return { met: inside, how: inside == null ? `${area} on the ${map} Map - no geometry held` : inside ? `in ${area}` : `not in ${area}` }
    }
    return { met: null, how: 'the lot data cannot answer this' }
  }
  let exceptions: BuildExceptions | null = null
  for (const c of won.filter(c => c.kind === 'prohibit')) {
    const own = await textOf([c.provision_id])
    if (!/\bunless\b/i.test(own)) continue
    const children = [...E.provs.values()].filter(x => x.parent_id === c.provision_id).sort((a, b) => a.local_id.localeCompare(b.local_id, undefined, { numeric: true }))
    if (!children.length) continue
    const items = []
    for (const ch of children) {
      const t = (await textOf([ch.id])).replace(/\s+/g, ' ').replace(/[,;]?\s*(or|and)$/i, '').trim()
      items.push({ text: t, ...(await testException(t)) })
    }
    exceptions = { clause: E.label(c.provision_id), text: own.replace(/\s+/g, ' ').trim(), items, engineHas: (c.excludes ?? []).length > 0,
      outcome: items.some(i => i.met === true) ? 'lifted' : items.every(i => i.met === false) ? 'stands' : 'open' }
    break
  }
  Object.assign(permission, { kinds, narrower, exceptions })

  // every control for it
  const controls: BuildControl[] = []
  for (const t of (withDcp ? [...BUILD_TOPICS, ...SETBACK_TOPICS] : [...BUILD_TOPICS])) {
    const r = evaluate(E, { kind: 'standard', use, topic: t.key, proposal: 'development' }, lot)
    if (r.verdict === 'none') continue
    const f = figure(E, r)
    const wonLabels = new Set(f.by)
    // bands of the same table/clause this lot is not in - a site-area or frontage band, nothing else
    const otherBands = [...new Map(r.tested
      .filter(tt => tt.holds === false && tt.claim.topic === t.key)
      .map(tt => ({ tt, why: tt.why.filter(w => /: no$/.test(w)).join('; ') }))
      .filter(({ why }) => /(lot|frontage) [\d.]+ m2? in /.test(why) && !/zone |not inside/.test(why))
      .map(({ tt, why }) => {
        const label = E.label(tt.claim.provision_id)
        const band = (why.match(/(?:lot|frontage) [\d.]+ m2? in ([^;\]]+)/)?.[1] ?? '').replace(/: no$/, '').replace(/…/g, 'site').replace(/m2/g, 'm²')
        const value = (tt as any).value ?? tt.claim.value
        return [`${label}|${value}|${band}`, { label, value, unit: tt.claim.unit, band }] as const
      })).values()].filter(b => !wonLabels.has(b.label) || b.value !== f.value)
    const control: BuildControl = { key: t.key, label: t.label, ...f, otherBands, why: [], likely: null }
    if (r.verdict === 'maybe' && !f.branches.length) {
      // a floor area in contention is FSR clauses competing before the site area is applied
      const topics = t.key === 'floor_area' ? ['floor_area', 'fsr'] : [t.key]
      control.why = await whyInContention(r.tested.filter(tt => tt.holds !== false && topics.includes(tt.claim.topic ?? '') && ((tt as any).value ?? tt.claim.value) != null))
      const standing = control.why.filter(w => w.reaches !== false)
      if (standing.length && control.why.some(w => w.reaches === false) && new Set(standing.map(w => w.value)).size === 1) {
        control.likely = { value: standing[0]!.value, unit: standing[0]!.unit, by: standing.map(w => w.label) }
      }
    }
    controls.push(control)
  }

  // areas whose clauses reach this use (or every use)
  const areas = entry.areas.map(a => ({ ...a, claims: a.claims.filter(c => !c.uses.length || c.uses.includes('*') || c.uses.some(u => u === use || use.startsWith(`${u} (`) || u.startsWith(`${use} (`))) }))
    .filter(a => a.claims.length)

  // the clause words for the labels shown: own text, or the parent's when the provision is a table cell or a bare paragraph
  const clauses: BuildResponse['clauses'] = {}
  const cited = new Map<string, string>()
  for (const f of [permission, ...controls]) f.byIds.forEach((id, i) => { const l = f.by[i]; if (l && !cited.has(l)) cited.set(l, id) })
  for (const [label, id] of cited) {
    const own = (await textOf([id])).replace(/\s+/g, ' ').trim()
    const p = E.provs.get(id)
    const text = own.length > 40 || !p?.parent_id ? own : `${(await textOf([p.parent_id])).replace(/\s+/g, ' ').trim()} ${own}`.trim()
    clauses[label] = { heading: headingOf(E, id), text: text.length > 600 ? `${text.slice(0, 600)}…` : text }
  }

  return { ...base, use, permission, controls, areas, clauses, ms: Date.now() - started }
})
