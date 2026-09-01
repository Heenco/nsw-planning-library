/**
 * POST /api/library/ingest
 *
 * Runs the NSW KG v2 ingest pipeline (stage 0 parse + stage 1 LLM decompose)
 * against the `nsw` schema and streams progress as SSE.
 *
 * This is the write path v2 never had: previously `nsw.*` could only be
 * populated by `npx tsx scripts/ingest-nsw.ts` against a hardcoded registry.
 * The legacy /api/document/kg-*.post.ts endpoints write the v1 `public.kg_*`
 * tables and are NOT interchangeable with this one.
 *
 * Body — one of:
 *   { label: "randwick-lep" }              ingest a registered source
 *   { source: { ...DocumentSource } }      register then ingest (upload flow)
 *
 * Options:
 *   stage0Only  boolean  parse + sections only, skip the LLM (fast smoke test)
 *   maxClauses  number   cap clauses decomposed, for partial runs
 *
 * Events: stage_start, stage_progress, stage_done, flag, error, run_done, done
 */

import { runIngest } from '../../utils/nsw-kg/ingest/orchestrator'
import { getSource, upsertSource, type RegistrySource } from '../../utils/nsw-kg/ingest/registry'
import { sseEvent } from '../../utils/sitewise/sse'
import type { IngestEvent } from '../../utils/nsw-kg/types'

const REQUIRED_SOURCE_FIELDS = [
  'label', 'title', 'doc_type', 'scope', 'hierarchy_level',
  'source_url', 'raw_path', 'raw_format', 'as_at_date',
] as const

function validateSource(input: any): RegistrySource {
  const missing = REQUIRED_SOURCE_FIELDS.filter(
    (f) => input[f] === undefined || input[f] === null || input[f] === '',
  )
  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      message: `source is missing required field(s): ${missing.join(', ')}`,
    })
  }
  return {
    label:           String(input.label),
    title:           String(input.title),
    doc_type:        input.doc_type,
    scope:           input.scope,
    hierarchy_level: Number(input.hierarchy_level),
    lga_name:        input.lga_name ?? null,
    source_url:      String(input.source_url),
    raw_path:        String(input.raw_path),
    raw_format:      input.raw_format,
    as_at_date:      String(input.as_at_date),
    origin:          input.origin ?? 'upload',
    content_sha256:  input.content_sha256 ?? null,
    original_name:   input.original_name ?? null,
    enabled:         true,
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { label, source, stage0Only, maxClauses } = body || {}

  if (!label && !source) {
    throw createError({ statusCode: 400, message: 'Provide either "label" or "source"' })
  }

  const config = useRuntimeConfig()
  if (!stage0Only && !config.deepinfraApiKey) {
    throw createError({
      statusCode: 500,
      message: 'DEEPINFRA_API_KEY is not configured. Set it, or pass stage0Only to skip the LLM.',
    })
  }

  // Resolve the source before opening the stream so validation and
  // unknown-label errors return a real HTTP status instead of an SSE frame.
  const src: RegistrySource = source
    ? await upsertSource(validateSource(source))
    : await getSource(String(label))

  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const t0 = Date.now()
  sseEvent(res, 'accepted', {
    label: src.label,
    title: src.title,
    doc_type: src.doc_type,
    raw_format: src.raw_format,
    origin: src.origin,
    stage0Only: Boolean(stage0Only),
  })

  try {
    const result = await runIngest({
      src,
      stage0Only: Boolean(stage0Only),
      maxClauses: maxClauses ? Number(maxClauses) : undefined,
      deepinfraKey: config.deepinfraApiKey,
      onEvent: (evt: IngestEvent) => sseEvent(res, evt.type, evt as any),
    })

    sseEvent(res, 'done', { ...result, label: src.label, ms: Date.now() - t0 })
  } catch (err) {
    sseEvent(res, 'error', {
      stage: 'ingest',
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    res.end()
  }
})
