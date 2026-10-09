/**
 * GET /api/rag/status - the live numbers behind /rag: what schema `rag` holds right now, stage by stage.
 *
 * The plan itself (phases, steps, decisions) is shared/rag-plan.ts; this route only counts. Every block degrades to
 * empty rather than failing, so the page renders while a stage has not run yet.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

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
    q(`SELECT id, stage, started_at, finished_at, counts, notes FROM rag.run ORDER BY started_at DESC LIMIT 12`),
  ])
  return { ms: Date.now() - started, measuredAt: new Date().toISOString(), instruments, kinds, relations, chunks, embeddings, questions,
    engine: engine[0] ?? { n: 0, runs: 0 }, answers, adjudications, runs }
})
