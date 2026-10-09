/**
 * GET /api/rag/status - the live numbers behind /rag: what schema `rag` holds right now, stage by stage.
 *
 * The plan itself (phases, steps, decisions) is shared/rag-plan.ts; this route only counts. Every block degrades to
 * empty rather than failing, so the page renders while a stage has not run yet.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'
import { labelOf, urlOf } from '#shared/rag/refs'

export default defineEventHandler(async () => {
  const started = Date.now()
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => {
    try { return (await nswQuery<any>(sql, p as any[])).rows as T[] } catch { return [] }
  }
  const [instruments, kinds, relations, chunks, embeddings, questions, engine, answers, adjudications, runs] = await Promise.all([
    q(`SELECT i.title, i.kind, i.rank, i.scope, r.finished_at AS snapshot_at,
              count(p.*)::int AS provisions,
              count(*) FILTER (WHERE p.list_role IS NOT NULL)::int AS stems,
              count(*) FILTER (WHERE p.connective IS NOT NULL)::int AS connectives,
              count(*) FILTER (WHERE p.kind IN ('table', 'row', 'cell'))::int AS table_nodes
         FROM rag.instrument i LEFT JOIN rag.provision p ON p.document_id = i.document_id LEFT JOIN rag.run r ON r.id = i.snapshot_run
        GROUP BY i.document_id, i.title, i.kind, i.rank, i.scope, r.finished_at ORDER BY i.rank`),
    q(`SELECT i.title, p.kind, count(*)::int AS n FROM rag.provision p JOIN rag.instrument i ON i.document_id = p.document_id GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
    q(`SELECT k.kind, k.meaning, count(r.*)::int AS n,
              count(*) FILTER (WHERE r.status = 'verified')::int AS verified,
              count(*) FILTER (WHERE r.status = 'proposed')::int AS proposed,
              count(*) FILTER (WHERE r.status = 'rejected')::int AS rejected,
              count(*) FILTER (WHERE r.id IS NOT NULL AND r.to_provision IS NULL)::int AS unresolved
         FROM rag.relation_kind k LEFT JOIN rag.relation r ON r.kind = k.kind GROUP BY k.kind, k.meaning ORDER BY 3 DESC, 1`),
    q(`SELECT role, count(*)::int AS n, count(llm_context)::int AS with_context FROM rag.chunk GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT variant, model, count(*)::int AS n FROM rag.embedding GROUP BY 1, 2 ORDER BY 1`),
    q(`SELECT set_name, kind, count(*)::int AS n FROM rag.question GROUP BY 1, 2 ORDER BY 1, 2`),
    q(`SELECT count(*)::int AS n, count(DISTINCT run_id)::int AS runs FROM rag.engine_answer`),
    q(`SELECT variant, model, count(*)::int AS n, round(avg(latency_ms))::int AS avg_ms, round(sum(cost_usd)::numeric, 4) AS cost
         FROM rag.answer GROUP BY 1, 2 ORDER BY 1`),
    q(`SELECT status, count(*)::int AS n FROM rag.adjudication GROUP BY 1`),
    q(`SELECT id, stage, started_at, finished_at, left(counts::text, 2000)::jsonb AS counts, notes FROM rag.run
        WHERE stage NOT IN ('retrieval', 'resolver_check', 'score') ORDER BY started_at DESC LIMIT 12`),
  ])
  // the latest measurement of each kind: retrieval recall, the resolver's precedence keys, the scores
  const latest = async (stage: string) => (await q(`SELECT started_at, counts FROM rag.run WHERE stage = $1 ORDER BY started_at DESC LIMIT 1`, [stage]))[0] ?? null
  const [retrieval, resolver, score] = await Promise.all([latest('retrieval'), latest('resolver_check'), latest('score')])
  const queue = await q(`SELECT q.set_name, q.clause, q.text, q.expected, a.note, left(a.quote, 600) AS quote, a.status, a.proposed->'wrong_sides' AS wrong_sides
                           FROM rag.adjudication a JOIN rag.question q ON q.id = a.question_id
                          ORDER BY jsonb_array_length(coalesce(a.proposed->'wrong_sides', '[]')) DESC, q.set_name, q.clause LIMIT 60`)
  // spatial resolution, stage 1 (building the graph): how each claim's condition is to be tested on a lot (rag.claim_binding)
  const bindingRows = await q(`SELECT b.status, b.part, b.text, b.scope_terms, b.sources, b.assume_absent, b.note, c.kind AS claim_kind,
                                      p.local_id, coalesce(p.path, '{}') path, p.heading, i.kind doc_kind, i.title, i.source_url
                                 FROM rag.claim_binding b JOIN rag.claim c ON c.id = b.claim_id JOIN rag.provision p ON p.id = c.provision_id
                                 JOIN rag.instrument i ON i.document_id = p.document_id ORDER BY b.status, i.rank, p.sort`)
  const bindings = bindingRows.map(b => ({ status: b.status, part: b.part, text: b.text, scope_terms: b.scope_terms, sources: b.sources, assume_absent: b.assume_absent,
    note: b.note, claim_kind: b.claim_kind, label: labelOf(b), url: urlOf(b.source_url, b.local_id) }))
  // stage 2 (each lot): of side D's latest answers, how many rest on a condition no data could settle, and which ones
  const lotChecks = (await q(`
    WITH d AS (SELECT DISTINCT ON (a.question_id) a.question_id, a.trace FROM rag.answer a JOIN rag.run r ON r.id = a.run_id WHERE a.variant = 'D' ORDER BY a.question_id, r.started_at DESC),
         -- trace.explain is one explanation per case the answer covers (an array), or one object
         e AS (SELECT d.question_id, CASE jsonb_typeof(d.trace->'explain') WHEN 'array' THEN d.trace->'explain' ELSE jsonb_build_array(d.trace->'explain') END AS ex FROM d),
         x AS (SELECT e.question_id, c FROM e, jsonb_array_elements(e.ex) one, jsonb_array_elements(coalesce(one->'checks', '[]')) c)
    SELECT (SELECT count(*) FROM d)::int AS answers,
           (SELECT count(DISTINCT question_id) FROM x WHERE (c->>'could')::boolean)::int AS with_checked,
           (SELECT count(DISTINCT question_id) FROM x WHERE NOT (c->>'could')::boolean)::int AS with_unchecked,
           (SELECT coalesce(jsonb_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT c->>'text' AS text, c->>'how' AS how, count(DISTINCT question_id)::int AS n
              FROM x WHERE NOT (c->>'could')::boolean GROUP BY 1, 2) t) AS unchecked,
           (SELECT coalesce(jsonb_agg(t ORDER BY t.n DESC), '[]') FROM (SELECT c->>'text' AS text, count(*) FILTER (WHERE c->>'result' = 'true')::int AS yes,
              count(*) FILTER (WHERE c->>'result' = 'false')::int AS no, count(DISTINCT question_id)::int AS n FROM x WHERE (c->>'could')::boolean GROUP BY 1) t) AS checked`))[0] ?? null
  return { ms: Date.now() - started, bindings, lotChecks, measuredAt: new Date().toISOString(), instruments, kinds, relations, chunks, embeddings, questions,
    engine: engine[0] ?? { n: 0, runs: 0 }, answers, adjudications, runs,
    retrieval: retrieval && { at: retrieval.started_at, summary: retrieval.counts?.summary ?? {}, misses: retrieval.counts?.r2_misses ?? [] },
    resolver: resolver && { at: resolver.started_at, pass: resolver.counts?.pass ?? 0, fail: resolver.counts?.fail ?? 0,
      cases: (resolver.counts?.cases ?? []).map((c: any) => ({ id: c.id, pass: c.pass, verdict: c.verdict, got: c.got, want: c.want, trace: (c.trace ?? []).map((s: any) => `${s.rule}: ${s.winner} > ${s.loser}`) })) },
    score: score && { at: score.started_at, summary: score.counts?.summary ?? {}, queue: score.counts?.adjudication_queue ?? 0 },
    queue }
})
