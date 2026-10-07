/**
 * /api/rules/sepp-coverage - how far each SEPP has come through the rule pipeline (docs/sepp-rule-pipeline.md),
 * for the /graph page. Every figure is read from the graph, per document:
 *   source     source_registry: the file's sha256 against the one last ingested (current / due / never)
 *   sections   hashed (step 2) and routed (step 4), operative among them
 *   chapters   how many chapters hold at least one pipeline rule (step 5) - the coverage that matters
 *   rules      frames (step 3) and rules by publish_state; effects, applicability rows, edges (step 6)
 *   terms      the place-like conditions the rules use (defined area, map area, LGA, land characteristic) and
 *              how many have no scope_layer row or one with no dataset (step 7)
 *   findings   open audit_finding rows, gating or not (steps 5 and 10)
 *   runs       the latest ingest_run per step, including the answer keys (step 10)
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

const byDoc = (rows: any[]) => new Map(rows.map(r => [String(r.doc), r]))

export default defineEventHandler(async () => {
  const started = Date.now()
  const docs = (await nswQuery<any>(
    `SELECT d.id AS doc, d.title, d.instrument_slug, d.as_at_date,
            sr.content_sha256, sr.last_ingested_sha256, sr.last_ingested_at
       FROM nsw.document d LEFT JOIN nsw.source_registry sr ON sr.document_id = d.id
      WHERE d.doc_type = 'sepp' ORDER BY d.title`)).rows

  const [sections, chapters, rules, effects, edges, terms, findings, runs] = await Promise.all([
    nswQuery<any>(`SELECT document_id AS doc, count(*)::int AS total, count(content_sha256)::int AS hashed,
                          count(route)::int AS routed, count(*) FILTER (WHERE route = 'operative')::int AS operative
                     FROM nsw.section s WHERE document_id IN (SELECT id FROM nsw.document WHERE doc_type = 'sepp')
                    GROUP BY 1`),
    // walk each pipeline rule's section up to its top unit: chapters, or parts where a SEPP has no chapters
    // (the Codes SEPP is in parts)
    nswQuery<any>(`WITH RECURSIVE top AS (
                     SELECT d.id AS doc, CASE WHEN EXISTS (SELECT 1 FROM nsw.section s WHERE s.document_id = d.id AND s.level = 'chapter')
                                              THEN 'chapter' ELSE 'part' END AS level
                       FROM nsw.document d WHERE d.doc_type = 'sepp'),
                   up AS (
                     SELECT s.id, s.parent_id, s.level, s.local_id, s.heading, s.document_id FROM nsw.section s
                      WHERE s.id IN (SELECT section_id FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id
                                      WHERE d.doc_type = 'sepp' AND r.kind <> 'frame' AND r.publish_state <> 'retired')
                     UNION
                     SELECT p.id, p.parent_id, p.level, p.local_id, p.heading, p.document_id FROM nsw.section p JOIN up ON p.id = up.parent_id)
                   SELECT top.doc, top.level AS unit, count(c.id)::int AS chapters,
                          (SELECT count(*)::int FROM up WHERE up.document_id = top.doc AND up.level = top.level) AS with_rules,
                          (SELECT json_agg(up.local_id || ' ' || coalesce(up.heading, '') ORDER BY up.local_id) FROM up
                            WHERE up.document_id = top.doc AND up.level = top.level) AS covered
                     FROM top LEFT JOIN nsw.section c ON c.document_id = top.doc AND c.level = top.level
                    GROUP BY top.doc, top.level`),
    nswQuery<any>(`SELECT r.document_id AS doc,
                          count(*) FILTER (WHERE r.kind = 'frame' AND r.publish_state <> 'retired')::int AS frames,
                          count(*) FILTER (WHERE r.kind <> 'frame' AND r.publish_state = 'held')::int AS held,
                          count(*) FILTER (WHERE r.kind <> 'frame' AND r.publish_state = 'published')::int AS published,
                          count(*) FILTER (WHERE r.kind <> 'frame' AND r.publish_state = 'retired')::int AS retired,
                          (SELECT count(*)::int FROM nsw.rule_applicability a JOIN nsw.rule r2 ON r2.id = a.rule_id
                            WHERE r2.document_id = r.document_id AND r2.publish_state <> 'retired') AS applicability
                     FROM nsw.rule r JOIN nsw.document d ON d.id = r.document_id WHERE d.doc_type = 'sepp' GROUP BY 1`),
    nswQuery<any>(`SELECT r.document_id AS doc, count(*)::int AS effects,
                          count(*) FILTER (WHERE e.value IS NOT NULL)::int AS numeric
                     FROM nsw.rule_effect e JOIN nsw.rule r ON r.id = e.rule_id JOIN nsw.document d ON d.id = r.document_id
                    WHERE d.doc_type = 'sepp' AND r.publish_state <> 'retired' GROUP BY 1`),
    nswQuery<any>(`SELECT r.document_id AS doc, count(*)::int AS edges,
                          json_object_agg_strict(e.edge_type, 1) AS types
                     FROM nsw.rule_edge e JOIN nsw.rule r ON r.id = e.from_rule_id JOIN nsw.document d ON d.id = r.document_id
                    WHERE d.doc_type = 'sepp' AND r.publish_state <> 'retired' GROUP BY 1`).catch(() =>
      nswQuery<any>(`SELECT r.document_id AS doc, count(*)::int AS edges, null AS types
                       FROM nsw.rule_edge e JOIN nsw.rule r ON r.id = e.from_rule_id JOIN nsw.document d ON d.id = r.document_id
                      WHERE d.doc_type = 'sepp' AND r.publish_state <> 'retired' GROUP BY 1`)),
    nswQuery<any>(`SELECT x.doc, count(*)::int AS used,
                          count(*) FILTER (WHERE sl.id IS NULL)::int AS unmapped,
                          count(*) FILTER (WHERE sl.source_kind = 'none')::int AS no_dataset,
                          json_agg(x.dimension || ': ' || x.v) FILTER (WHERE sl.id IS NULL OR sl.source_kind = 'none') AS gaps
                     FROM (SELECT DISTINCT r.document_id AS doc, a.dimension, lower(a.value) AS v
                             FROM nsw.rule_applicability a JOIN nsw.rule r ON r.id = a.rule_id JOIN nsw.document d ON d.id = r.document_id
                            WHERE d.doc_type = 'sepp' AND r.publish_state <> 'retired'
                              AND a.dimension IN ('defined_area', 'map_area', 'lga', 'land_characteristic')) x
                     LEFT JOIN nsw.scope_layer sl ON sl.dimension = x.dimension AND lower(sl.term) = x.v
                    GROUP BY x.doc`),
    nswQuery<any>(`SELECT f.document_id AS doc, count(*) FILTER (WHERE f.gating)::int AS gating,
                          count(*) FILTER (WHERE NOT f.gating)::int AS other
                     FROM nsw.audit_finding f JOIN nsw.document d ON d.id = f.document_id
                    WHERE d.doc_type = 'sepp' AND f.status = 'open' GROUP BY 1`),
    nswQuery<any>(`SELECT DISTINCT ON (i.document_id, i.stage_metrics->>'step')
                          i.document_id AS doc, i.stage_metrics->>'step' AS step, i.status, i.started_at, i.stage_metrics AS metrics
                     FROM nsw.ingest_run i JOIN nsw.document d ON d.id = i.document_id
                    WHERE d.doc_type = 'sepp' AND i.stage_metrics ? 'step'
                    ORDER BY i.document_id, i.stage_metrics->>'step', i.started_at DESC`),
  ])
  const S = byDoc(sections.rows), C = byDoc(chapters.rows), R = byDoc(rules.rows), E = byDoc(effects.rows)
  const G = byDoc(edges.rows), T = byDoc(terms.rows), F = byDoc(findings.rows)
  const runsBy = new Map<string, any[]>()
  for (const r of runs.rows) runsBy.set(String(r.doc), [...(runsBy.get(String(r.doc)) ?? []), r])

  const out = docs.map(d => {
    const k = String(d.doc)
    const s = S.get(k) ?? {}, c = C.get(k) ?? {}, r = R.get(k) ?? {}, e = E.get(k) ?? {}, g = G.get(k) ?? {}, t = T.get(k) ?? {}, f = F.get(k) ?? {}
    const source = !d.content_sha256 ? 'unregistered' : !d.last_ingested_sha256 ? 'never ingested'
      : d.content_sha256 === d.last_ingested_sha256 ? 'current' : 'due'
    const keys = (runsBy.get(k) ?? []).find(x => x.step === '10') ?? null
    return {
      title: d.title, slug: d.instrument_slug, asAt: d.as_at_date, source, lastIngestedAt: d.last_ingested_at,
      sections: { total: s.total ?? 0, hashed: s.hashed ?? 0, routed: s.routed ?? 0, operative: s.operative ?? 0 },
      chapters: { unit: c.unit ?? 'chapter', total: c.chapters ?? 0, withRules: c.with_rules ?? 0, covered: c.covered ?? [] },
      rules: { frames: r.frames ?? 0, held: r.held ?? 0, published: r.published ?? 0, retired: r.retired ?? 0,
               applicability: r.applicability ?? 0, effects: e.effects ?? 0, numeric: e.numeric ?? 0,
               edges: g.edges ?? 0, edgeTypes: Object.keys(g.types ?? {}) },
      terms: { used: t.used ?? 0, unmapped: t.unmapped ?? 0, noDataset: t.no_dataset ?? 0, gaps: t.gaps ?? [] },
      findings: { gating: f.gating ?? 0, other: f.other ?? 0 },
      answerKeys: keys ? { status: keys.status, at: keys.started_at, pass: keys.metrics.pass, cases: keys.metrics.cases,
                           explained: keys.metrics.explained } : null,
      steps: (runsBy.get(k) ?? []).map(x => ({ step: Number(x.step), status: x.status, at: x.started_at }))
        .sort((a, b) => a.step - b.step),
    }
  })
  return { ms: Date.now() - started, documents: out }
})
