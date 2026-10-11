/**
 * The structure-first pilot, document by document, for /pilot.
 *
 * Everything here is read from schema `pilot` and nsw.document; nothing is computed on the page
 * that the chain did not already write. For each document the chain has touched: the latest run of
 * every stage with the counts that stage recorded, the classification of its propositions, how its
 * scope rows resolved, the findings by tier (gating or noted), its keys, and how many rounds it has
 * been through. The chain itself is `Notebooks/08D - LEP pilot chain/run_chain.sh`.
 *
 *   GET /api/pilot/progress
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

interface StageRun { stage: string; started_at: string; counts: any }

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'public, max-age=30')

  const docs = (await nswQuery<any>(`
    select d.id, d.title, d.doc_type, d.lga_name,
           (select count(*)::int from nsw.section s where s.document_id = d.id) as sections,
           (select count(*)::int from pilot.node n where n.document_id = d.id) as nodes,
           (select count(*)::int from pilot.run r where r.document_id = d.id and r.stage = 'propositions') as rounds,
           (select min(r.started_at) from pilot.run r where r.document_id = d.id) as first_run,
           (select max(r.started_at) from pilot.run r where r.document_id = d.id) as last_run
      from nsw.document d
     where d.doc_type in ('lep', 'sepp')
       and exists (select 1 from pilot.run r where r.document_id = d.id)
     order by d.doc_type, d.title`)).rows

  const latest = (await nswQuery<any>(`
    select distinct on (document_id, stage) document_id, stage, started_at, counts
      from pilot.run
     order by document_id, stage, started_at desc`)).rows as (StageRun & { document_id: string })[]

  const classification = (await nswQuery<any>(`
    select n.document_id, p.classification, count(*)::int as n
      from pilot.proposition p join pilot.node n on n.id = p.node_id
     group by 1, 2`)).rows

  const scope = (await nswQuery<any>(`
    select n.document_id, s.dimension, s.resolution, count(*)::int as n
      from pilot.scope s join pilot.proposition p on p.id = s.proposition_id join pilot.node n on n.id = p.node_id
     group by 1, 2, 3`)).rows

  const unresolved = (await nswQuery<any>(`
    select n.document_id, s.dimension, s.value, count(*)::int as n
      from pilot.scope s join pilot.proposition p on p.id = s.proposition_id join pilot.node n on n.id = p.node_id
     where s.resolution = 'unresolved'
     group by 1, 2, 3
     order by 1, 4 desc`)).rows

  const findings = (await nswQuery<any>(`
    select document_id, tier, kind, gating, count(*)::int as n
      from pilot.finding
     group by 1, 2, 3, 4`)).rows

  const keys = (await nswQuery<any>(`
    select document_id, count(*)::int as total, count(cadid)::int as engine
      from pilot.key
     group by 1`)).rows

  const byDoc = <T extends { document_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) { const a = m.get(r.document_id) ?? []; a.push(r); m.set(r.document_id, a) }
    return m
  }
  const latestBy = byDoc(latest), classBy = byDoc(classification), scopeBy = byDoc(scope)
  const unresBy = byDoc(unresolved), findBy = byDoc(findings), keysBy = byDoc(keys)

  const documents = docs.map((d: any) => {
    const stages: Record<string, StageRun> = {}
    for (const r of latestBy.get(d.id) ?? []) stages[r.stage] = { stage: r.stage, started_at: r.started_at, counts: r.counts }
    const cls: Record<string, number> = {}
    for (const r of classBy.get(d.id) ?? []) cls[r.classification] = r.n
    const propositions = Object.values(cls).reduce((a, b) => a + b, 0)
    const scopeRows: Record<string, { resolved: number; unresolved: number }> = {}
    for (const r of scopeBy.get(d.id) ?? []) {
      const s = scopeRows[r.dimension] ?? { resolved: 0, unresolved: 0 }
      if (r.resolution === 'unresolved') s.unresolved += r.n; else s.resolved += r.n
      scopeRows[r.dimension] = s
    }
    const gaps = (unresBy.get(d.id) ?? []).slice(0, 12).map((r: any) => ({ dimension: r.dimension, value: r.value, n: r.n }))
    const f = findBy.get(d.id) ?? []
    const gating = f.filter((x: any) => x.gating).reduce((a: number, x: any) => a + x.n, 0)
    const noted = f.filter((x: any) => !x.gating).reduce((a: number, x: any) => a + x.n, 0)
    const byKind = f.map((x: any) => ({ tier: x.tier, kind: x.kind, gating: x.gating, n: x.n }))
      .sort((a: any, b: any) => (b.gating ? 1 : 0) - (a.gating ? 1 : 0) || a.tier - b.tier || b.n - a.n)
    const k = keysBy.get(d.id)?.[0] ?? { total: 0, engine: 0 }
    const prop = stages.propositions?.counts ?? {}
    const ek = stages.engine_keys?.counts ?? {}
    return {
      id: d.id, title: d.title, docType: d.doc_type, lga: d.lga_name,
      sections: d.sections, nodes: d.nodes, rounds: d.rounds, firstRun: d.first_run, lastRun: d.last_run,
      propositions, classification: cls,
      controlNumbers: prop.control_numbers ?? null, numbersUnaccounted: prop.numbers_unaccounted ?? null,
      tier1Gating: prop.tier1_gating ?? null, tier1Noted: prop.tier1_noted ?? null, tier2: prop.tier2 ?? null,
      keys: { total: k.total, engine: k.engine, pass: prop.keys?.pass ?? null, fail: prop.keys?.fail ?? null, deferred: prop.keys?.deferred ?? null },
      engineKeys: { pass: ek.pass ?? null, fail: ek.fail ?? null },
      project: stages.project?.counts ?? null,
      structure: stages.structure?.counts ?? null,
      scope: scopeRows, gaps, findings: { gating, noted, byKind },
      stages: Object.fromEntries(Object.entries(stages).map(([s, r]) => [s, r.started_at])),
    }
  })

  const totals = {
    documents: documents.length,
    leps: documents.filter(d => d.docType === 'lep').length,
    sepps: documents.filter(d => d.docType === 'sepp').length,
    propositions: documents.reduce((a, d) => a + d.propositions, 0),
    gating: documents.reduce((a, d) => a + d.findings.gating, 0),
    keys: documents.reduce((a, d) => a + d.keys.total, 0),
    keysFailing: documents.reduce((a, d) => a + (d.keys.fail ?? 0) + (d.engineKeys.fail ?? 0), 0),
    lastRun: documents.reduce((a: string | null, d) => (!a || d.lastRun > a ? d.lastRun : a), null),
  }
  return { totals, documents, generatedAt: new Date().toISOString() }
})
