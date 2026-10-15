/**
 * GET /api/precinct/at?cadid=&use=&proposal= - the /precinct bench: how the engine reads the lot's governing unit.
 *
 * For a lot the precinct path puts under a chapter or appendix of a Precinct SEPP (derived.lot_instrument), every
 * provision of that unit as a tree (parts > clauses > subclauses > paragraphs, with their text), and on each provision
 * the claims the RAG build read from it, each tested on this lot by the engine's own scope test (evaluate with
 * `audit`): holds yes / no / unknown and why. Claims of the other instruments that reach the lot (the Housing SEPP, the
 * Codes SEPP) come back as a flat list. Nothing is resolved here: the point is to see what was extracted from each clause
 * and subclause and what the engine made of it for this lot.
 *
 * `use` is the land use the use-dependent claims are read against (default: dwelling houses); `proposal` is
 * development (default) or subdivision.
 */
import { evaluate, lepFor, type Engine } from '#shared/rag/evaluate'
import { lotFactsShared } from '../../utils/lot-facts'
import { nswQuery } from '../../utils/nsw-kg/pool'
import { ragEngine } from '../../utils/rag-engine'

const q = (sql: string, p: unknown[] = []) => nswQuery<any>(sql, p as any[])

export interface AuditClaim {
  id: string; kind: string; consent: string | null; uses: string[]; zones: string[]; terms: string[]
  topic: string | null; comparator: string | null; value: number | null; unit: string | null; span: string | null; reader: string
  holds: boolean | null; why: string[]; notChecked: string[]
}
export interface AuditNode {
  id: string; local_id: string; kind: string; heading: string | null; text: string; label: string
  claims: AuditClaim[]; children: AuditNode[]
  /** claims on this node and below: tested, holding, failing, unknown */
  n: { claims: number; yes: number; no: number; unknown: number }
}
export interface PrecinctAtResponse {
  lot: { cadid: string; address: string | null; zone: string | null; epi: string | null; area_m2: number | null
    unit: { localId: string | null; heading: string | null; basis: string } | null
    units: Record<string, { unit: string | null; heading: string | null; basis: string; governing: boolean; cover: number | null }> }
  ask: { use: string; proposal: string }
  governing: { instrument: string | null; inCorpus: boolean; unit: string | null; heading: string | null; why: string }
  tree: AuditNode[]
  /** claims of the other instruments that hold or are unknown on this lot; the ruled-out ones are counted in othersRuledOut */
  others: { instrument: string; label: string; claim: AuditClaim }[]
  othersRuledOut: Record<string, number>
  /** the Residential Density Map (growth centre precinct plans): dwellings per hectare at the lot, the instrument's own layer */
  density: { value: string | null; number: number | null; label: string | null; plan: string | null; coverPct: number }[]
  summary: { provisions: number; withClaims: number; claims: number; yes: number; no: number; unknown: number; byKind: Record<string, number> }
  ms: number
}

export default defineEventHandler(async (event): Promise<PrecinctAtResponse> => {
  const started = Date.now()
  const query = getQuery(event)
  const cadid = String(query.cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'cadid is required' })
  const use = String(query.use ?? 'dwelling houses').trim() || 'dwelling houses'
  const proposal = String(query.proposal ?? 'development') === 'subdivision' ? 'subdivision' : 'development'
  setHeader(event, 'cache-control', 'no-store')

  const [E, lot]: [Engine, any] = await Promise.all([ragEngine('rag'), lotFactsShared(q, cadid, 'rag', { precinct: true })])
  const lep = lepFor(E, lot)
  const r = evaluate(E, { kind: 'permissibility', use, proposal, audit: true }, lot)
  const tested = new Map(r.tested.map(t => [t.claim.id, t]))

  // the governing unit's provisions, as a tree
  const inst = lep.doc ? E.insts.find(i => i.document_id === lep.doc) : null
  const unitId: string | null = lot.unit?.localId ?? null
  let tree: AuditNode[] = []
  // the response must stay readable in a browser: a claim's reasons are cut to the first few, its span to a line
  const toClaim = (t: any): AuditClaim => ({ id: t.claim.id, kind: t.claim.kind, consent: t.claim.consent, uses: t.claim.uses, zones: t.claim.zones, terms: t.claim.terms,
    topic: t.claim.topic, comparator: t.claim.comparator, value: t.claim.value, unit: t.claim.unit, span: t.claim.span ? String(t.claim.span).slice(0, 240) : null, reader: t.claim.reader,
    holds: t.holds, why: (t.why ?? []).slice(0, 4).map((w: string) => w.slice(0, 200)), notChecked: (t.notChecked ?? []).slice(0, 3) })
  // a Land Use Table claim about another zone of the same unit says nothing about this lot: not shown
  const aboutLot = (t: any) => !(t.claim.zones?.length && lot.zone && !t.claim.zones.includes(lot.zone))
  if (inst && unitId) {
    const rows = (await q(`
      WITH RECURSIVE u AS (SELECT id FROM rag.provision WHERE document_id = $1 AND local_id = $2),
      d AS (SELECT p.id, p.parent_id, p.local_id, p.kind, p.heading, p.own_text, p.sort FROM rag.provision p JOIN u ON p.id = u.id
            UNION ALL SELECT p.id, p.parent_id, p.local_id, p.kind, p.heading, p.own_text, p.sort FROM rag.provision p JOIN d ON p.parent_id = d.id)
      SELECT id, parent_id, local_id, kind, heading, coalesce(own_text, '') AS text, sort FROM d ORDER BY sort`, [lep.doc, unitId])).rows
    const claimsBy = new Map<string, AuditClaim[]>()
    for (const t of r.tested) {
      const p = E.provs.get(t.claim.provision_id)
      if (p?.document_id !== lep.doc || !aboutLot(t)) continue
      claimsBy.set(t.claim.provision_id, [...(claimsBy.get(t.claim.provision_id) ?? []), toClaim(t)])
    }
    const nodes = new Map<string, AuditNode>()
    for (const x of rows) nodes.set(x.id, { id: x.id, local_id: x.local_id, kind: x.kind, heading: x.heading, text: x.text, label: E.label(x.id),
      claims: claimsBy.get(x.id) ?? [], children: [], n: { claims: 0, yes: 0, no: 0, unknown: 0 } })
    for (const x of rows) { const n = nodes.get(x.id)!; const par = x.parent_id ? nodes.get(x.parent_id) : null; if (par) par.children.push(n); else tree.push(n) }
    // a table's cells and a dictionary's terms are noise here: fold cells into their row, drop empty paragraphs with no claims
    const count = (n: AuditNode): AuditNode['n'] => {
      const own = { claims: n.claims.length, yes: n.claims.filter(c => c.holds === true).length, no: n.claims.filter(c => c.holds === false).length, unknown: n.claims.filter(c => c.holds == null).length }
      for (const ch of n.children) { const m = count(ch); own.claims += m.claims; own.yes += m.yes; own.no += m.no; own.unknown += m.unknown }
      n.n = own; return own
    }
    for (const n of tree) count(n)
  }
  // the Residential Density Map, which /api/report/standards does not read (an LEP has no such map)
  const density = (await q(`
    WITH raw AS MATERIALIZED (SELECT ST_MakeValid(geom) AS g0 FROM cadastre.lot WHERE cadid = $1 LIMIT 1),
    t AS MATERIALIZED (SELECT CASE WHEN b IS NULL OR ST_IsEmpty(b) THEN g0 ELSE b END AS g, ST_Area(ST_Transform(g0, 3308)) AS area_m2
                         FROM raw, LATERAL (SELECT ST_Transform(ST_Buffer(ST_Transform(g0, 3308), -0.1), 4283) AS b) x)
    SELECT x.epi_name, x.label, x.lay_class, x.min_dwelling_density,
           100 * ST_Area(ST_Transform(ST_Union(ST_Intersection(ST_ClipByBox2D(x.geom, ST_Envelope(t.g)), t.g)), 3308)) / NULLIF(max(t.area_m2), 0) AS cover_pct
      FROM epi.epi_dwelling_density x, t WHERE x.geom && t.g AND ST_Intersects(x.geom, t.g)
     GROUP BY x.epi_name, x.label, x.lay_class, x.min_dwelling_density`, [cadid]).catch(() => ({ rows: [] as any[] }))).rows
    .filter((x: any) => Number(x.cover_pct) > 0.05 && (!inst || x.epi_name === inst.title))
    .map((x: any) => { const n = x.min_dwelling_density != null ? Number(x.min_dwelling_density) : (x.lay_class != null && !Number.isNaN(Number(x.lay_class)) ? Number(x.lay_class) : null)
      return { value: n != null ? `${n} dwellings/ha minimum` : null, number: n, label: x.label ?? null, plan: x.epi_name ?? null, coverPct: Math.min(100, Number(x.cover_pct)) } })
    .sort((a: any, b: any) => b.coverPct - a.coverPct)
  const otherTested = r.tested.filter(t => E.provs.get(t.claim.provision_id)?.document_id !== lep.doc)
  const instOf = (t: any) => E.insts.find(i => i.document_id === E.provs.get(t.claim.provision_id)?.document_id)?.title ?? '?'
  // what holds or is unknown, in full; what is ruled out only as a count per instrument (1,245 claims otherwise)
  const others = otherTested.filter(t => t.holds !== false).map(t => ({ instrument: instOf(t), label: E.label(t.claim.provision_id), claim: toClaim(t) }))
  const othersRuledOut: Record<string, number> = {}
  for (const t of otherTested.filter(t => t.holds === false)) othersRuledOut[instOf(t)] = (othersRuledOut[instOf(t)] ?? 0) + 1
  const own = r.tested.filter(t => E.provs.get(t.claim.provision_id)?.document_id === lep.doc && aboutLot(t))
  const byKind: Record<string, number> = {}
  for (const t of own) byKind[t.claim.kind] = (byKind[t.claim.kind] ?? 0) + 1
  const all = (ns: AuditNode[]): AuditNode[] => ns.flatMap(n => [n, ...all(n.children)])
  const flat = all(tree)
  return {
    lot: { cadid, address: lot.address ?? null, zone: lot.zone ?? null, epi: lot.epi ?? null, area_m2: lot.area_m2 ?? null, unit: lot.unit ?? null, units: lot.units ?? {} },
    ask: { use, proposal },
    governing: { instrument: inst?.title ?? lot.epi ?? null, inCorpus: !!inst, unit: unitId, heading: lot.unit?.heading ?? null, why: lep.why },
    tree, others, othersRuledOut, density,
    summary: { provisions: flat.length, withClaims: flat.filter(n => n.claims.length).length, claims: own.length,
      yes: own.filter(t => t.holds === true).length, no: own.filter(t => t.holds === false).length, unknown: own.filter(t => t.holds == null).length, byKind },
    ms: Date.now() - started,
  }
})
