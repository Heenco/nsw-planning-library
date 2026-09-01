// ── NSW KG v2 ingest orchestrator ───────────────────────────────────────
//
// Phase 2: Stages 0.
// Phase 3: Stages 1 (decompose) + 2 (verify, bundled into decomposeClause).
//
// Stage 0 = fetch + parse + section tree → DB
// Stage 1 = LLM per-clause atomic decomposition + verification
// Stage 2 = (bundled into Stage 1 via decomposeClause precision/recall)
// Stages 3-5 will bolt on in Phase 4.

import { readFile } from 'node:fs/promises'
import { fetchLegislationXml } from '../fetchers/legislation-nsw'
import { parseNswXml, flattenTree as flattenXmlTree, countLeafClauses as countXmlLeafClauses } from '../parsers/nsw-xml-parser'
import { parseStructuredMd, flattenTree as flattenMdTree, countLeafClauses as countMdLeafClauses } from '../parsers/structured-md-parser'
import { upsertDocument, updateDocumentCounts } from './upsert-document'
import { upsertSections } from './upsert-sections'
import { upsertClauseResult } from './upsert-propositions'
import { decomposeDocument, type ClauseInput } from '../decomposer/decompose-document'
import { withNswTx, nswQuery } from '../pool'
import type { DocumentSource, IngestEvent, SectionTreeNode, SectionLevel } from '../types'

const INGEST_MODEL = 'meta-llama/Llama-3.3-70B-Instruct'  // same as v1
const INGEST_PROVIDER = 'deepinfra'

// Sections shorter than this are skipped — they're structural (headers,
// empty parts) not content worth decomposing.
const MIN_CLAUSE_LENGTH = 30
// Sections longer than this are truncated before sending to the LLM (safety).
const MAX_CLAUSE_LENGTH = 6000

export interface OrchestratorOptions {
  src:            DocumentSource
  onEvent?:       (evt: IngestEvent) => void
  /** Phase 3 only. Set to true to run Stage 0 only (skip LLM decompose). */
  stage0Only?:    boolean
  /** Cap on clauses to decompose — useful for smoke tests / partial runs. */
  maxClauses?:    number
  deepinfraKey?:  string
}

export interface OrchestratorResult {
  document_id:   string
  sections:      number
  leaf_clauses:  number
  propositions:  number
  flagged:       number
  ms:            number
}

export async function runIngest(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const { src } = opts
  const emit = opts.onEvent ?? (() => {})
  const t0 = Date.now()

  // Open an ingest_run row for live progress
  const runId = await openIngestRun(src.label)

  try {
    // ── Stage 0a: fetch ─────────────────────────────────────────────
    emit({ type: 'stage_start', stage: 'fetch', message: src.title })
    const fetchT0 = Date.now()

    let raw: string
    let consolidation_id: string | null = null
    let raw_path = src.raw_path
    let source_url = src.source_url

    if (src.raw_format === 'xml') {
      const epiId = inferEpiId(src.raw_path)
      const fetched = await fetchLegislationXml({
        epiId,
        asAtDate: src.as_at_date,
        localPath: src.raw_path,
      })
      raw = fetched.xml
      consolidation_id = fetched.consolidation_id ?? null
      raw_path = fetched.raw_path || src.raw_path
      source_url = fetched.source_url
    } else if (src.raw_format === 'structured-md') {
      raw = await readFile(src.raw_path, 'utf8')
    } else {
      throw new Error(`Unknown raw_format '${(src as any).raw_format}'`)
    }

    emit({ type: 'stage_done', stage: 'fetch', ms: Date.now() - fetchT0, counts: { bytes: raw.length } })

    // ── Stage 0b: parse → SectionTree ───────────────────────────────
    emit({ type: 'stage_start', stage: 'parse', message: src.raw_format === 'xml' ? 'Parsing NSW PCO XML' : 'Parsing structured markdown' })
    const parseT0 = Date.now()

    let tree: SectionTreeNode[]
    let parsedConsolidation: string | null = null
    let flat: any[]
    let leafCount: number

    if (src.raw_format === 'xml') {
      const parsed = parseNswXml(raw)
      tree = parsed.tree
      parsedConsolidation = parsed.consolidation_id
      flat = flattenXmlTree(tree)
      leafCount = countXmlLeafClauses(tree)
    } else {
      const parsed = parseStructuredMd(raw, { title: src.title })
      tree = parsed.tree
      flat = flattenMdTree(tree)
      leafCount = countMdLeafClauses(tree)
    }

    emit({
      type: 'stage_done',
      stage: 'parse',
      ms: Date.now() - parseT0,
      counts: { sections: flat.length, leaf_clauses: leafCount, top_level: tree.length },
    })

    // ── Stage 0c: upsert document ───────────────────────────────────
    const doc = await upsertDocument({
      ...src,
      source_url,
      raw_path,
      consolidation_id: consolidation_id ?? parsedConsolidation,
      ingest_model: INGEST_MODEL,
      ingest_provider: INGEST_PROVIDER,
    })

    // Attach run to document
    await withNswTx(async (c) => {
      await c.query('UPDATE ingest_run SET document_id = $1::uuid WHERE id = $2::uuid', [doc.id, runId])
    })

    // ── Stage 0d: upsert sections ───────────────────────────────────
    emit({ type: 'stage_start', stage: 'parse', message: `Inserting ${flat.length} sections…` })
    const upsertT0 = Date.now()
    const inserted = await upsertSections(doc.id, flat)
    emit({
      type: 'stage_done',
      stage: 'parse',
      ms: Date.now() - upsertT0,
      counts: { sections_inserted: inserted.count },
    })

    await updateDocumentCounts(doc.id, { prop_count: 0, edge_count: 0 })

    // ── Stage 1 + 2: decompose clauses with LLM + verifier ──────────
    //
    // STREAMING: each clause writes its propositions to the DB as soon as
    // it's decomposed (via the onClauseComplete callback). This means:
    //   1. Crashes don't lose work
    //   2. The page polling /api/nsw/documents sees prop_count climbing
    //   3. ingest_run.totals JSON is updated periodically so live viewers work
    let propInserted = 0
    let flaggedClauses = 0
    let questionsCreated = 0
    if (!opts.stage0Only) {
      if (!opts.deepinfraKey) throw new Error('deepinfraKey is required for Stage 1 (set --stage0-only to skip)')

      const clauses = await buildClauseInputs(doc.id, opts.maxClauses)
      emit({ type: 'stage_start', stage: 'decompose', message: `${clauses.length} leaf clauses selected` })

      // Throttle the ingest_run totals update (DB round-trip every N clauses)
      const TOTALS_UPDATE_EVERY = 5
      let lastTotalsUpdate = 0

      await decomposeDocument({
        clauses,
        deepinfraKey: opts.deepinfraKey,
        onEvent: emit,
        onClauseComplete: async (result, running) => {
          // 1. Write this clause's propositions immediately
          const up = await upsertClauseResult(doc.id, result)
          propInserted      += up.inserted
          if (up.flagged)   flaggedClauses++
          questionsCreated  += up.questions

          // 2. Periodically push totals to ingest_run + document rows so the
          //    page (polling /api/nsw/documents + /api/nsw/runs/active) sees
          //    the numbers climbing in real time.
          if (running.done - lastTotalsUpdate >= TOTALS_UPDATE_EVERY || running.done === running.total) {
            lastTotalsUpdate = running.done
            await updateRunTotals(runId, {
              sections:           inserted.count,
              leaf_clauses:       leafCount,
              clauses_decomposed: running.done,
              clauses_total:      running.total,
              verified:           running.verified,
              flagged:            running.flagged,
              propositions:       propInserted,
              thresholds:         running.thresholds,
            })
            // Also bump the document's prop_count so the doc list shows live numbers
            await updateDocumentCounts(doc.id, { prop_count: propInserted })
          }
        },
      })

      emit({
        type: 'stage_done',
        stage: 'decompose',
        ms: 0, // decomposeDocument already emitted this
        counts: {
          propositions_inserted: propInserted,
          flagged_clauses:       flaggedClauses,
          questions:             questionsCreated,
        },
      })

      // Final count update
      await updateDocumentCounts(doc.id, { prop_count: propInserted })
    }

    const totalMs = Date.now() - t0
    const totals = {
      sections: inserted.count,
      leaf_clauses: leafCount,
      propositions: propInserted,
      flagged: flaggedClauses,
      questions: questionsCreated,
    }
    await closeIngestRun(runId, 'success', totals, totalMs)

    emit({ type: 'run_done', ms: totalMs, totals })

    return {
      document_id: doc.id,
      sections: inserted.count,
      leaf_clauses: leafCount,
      propositions: propInserted,
      flagged: flaggedClauses,
      ms: totalMs,
    }
  } catch (err) {
    const msg = (err as Error).message
    emit({ type: 'error', stage: 'fetch', message: msg })
    await closeIngestRun(runId, 'failed', {}, Date.now() - t0, msg)
    throw err
  }
}

// ── ingest_run helpers ──────────────────────────────────────────────────

async function openIngestRun(label: string): Promise<string> {
  return withNswTx(async (c) => {
    const r = await c.query(
      `INSERT INTO ingest_run (doc_label, status) VALUES ($1, 'running') RETURNING id`,
      [label],
    )
    return r.rows[0].id as string
  })
}

async function closeIngestRun(
  runId: string,
  status: 'success' | 'failed',
  totals: Record<string, number>,
  ms: number,
  error?: string,
): Promise<void> {
  await withNswTx(async (c) => {
    await c.query(
      `UPDATE ingest_run
       SET status = $1, finished_at = now(),
           totals = $2::jsonb,
           stage_metrics = jsonb_build_object('total_ms', $3::int),
           error = $4
       WHERE id = $5::uuid`,
      [status, JSON.stringify(totals), ms, error ?? null, runId],
    )
  })
}

/** Update ingest_run.totals while a run is still in progress. Called every
 *  ~5 clauses so the page polling sees live progress. */
async function updateRunTotals(
  runId: string,
  totals: Record<string, number>,
): Promise<void> {
  await withNswTx(async (c) => {
    await c.query(
      `UPDATE ingest_run SET totals = $1::jsonb WHERE id = $2::uuid`,
      [JSON.stringify(totals), runId],
    )
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────

function inferEpiId(filePath: string): string {
  // Filename is usually 'epi-2010-0433.xml' or 'epi-2021-0714_2026-03-23.xml'
  const base = filePath.split(/[\\/]/).pop() || ''
  const m = base.match(/^(epi-\d{4}-\d{4})/)
  if (!m || !m[1]) throw new Error(`Cannot infer EPI ID from path: ${filePath}`)
  return m[1]
}

// ── Build clause inputs for Stage 1 ─────────────────────────────────────
//
// Selects leaf sections (those with non-empty raw_text) and constructs
// a heading path by walking parents up to the document root. Returns
// input shape ready for decomposeDocument().

interface DbSectionRow {
  id:          string
  parent_id:   string | null
  local_id:    string
  level:       SectionLevel
  number:      string | null
  heading:     string | null
  raw_text:    string
  depth:       number
  sort_order:  number
}

async function buildClauseInputs(documentId: string, maxClauses?: number): Promise<ClauseInput[]> {
  const { rows } = await nswQuery<DbSectionRow>(`
    SELECT id, parent_id, local_id, level, number, heading, raw_text, depth, sort_order
    FROM section
    WHERE document_id = $1::uuid
    ORDER BY sort_order
  `, [documentId])

  // Index by id so we can walk parents
  const byId = new Map<string, DbSectionRow>()
  for (const r of rows) byId.set(r.id, r)

  // Build heading path (root → leaf) for each section with non-empty raw_text.
  const clauses: ClauseInput[] = []
  for (const row of rows) {
    if (!row.raw_text || row.raw_text.length < MIN_CLAUSE_LENGTH) continue
    // Only decompose leaf-ish sections. If a clause has children that
    // themselves carry text, prefer the children (which are more atomic).
    // Heuristic: skip a section if any descendant section has raw_text > 30 chars.
    if (hasTextChildren(row.id, rows)) continue

    const path: string[] = []
    let cur: DbSectionRow | undefined = row
    while (cur) {
      const part = formatHeading(cur)
      if (part) path.unshift(part)
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    }
    const heading = path.join(' > ')

    clauses.push({
      section_id: row.id,
      section_local_id: row.local_id,
      clause_heading: heading,
      clause_text: row.raw_text.length > MAX_CLAUSE_LENGTH
        ? row.raw_text.slice(0, MAX_CLAUSE_LENGTH) + '…'
        : row.raw_text,
    })
  }

  if (maxClauses && clauses.length > maxClauses) {
    return clauses.slice(0, maxClauses)
  }
  return clauses
}

function formatHeading(row: DbSectionRow): string {
  const num = row.number ? row.number : ''
  const head = row.heading ? row.heading : ''
  if (num && head) return `${capitalize(row.level)} ${num} ${head}`.trim()
  if (num)  return `${capitalize(row.level)} ${num}`.trim()
  if (head) return head
  return ''
}

function capitalize(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1)
}

function hasTextChildren(parentId: string, all: DbSectionRow[]): boolean {
  for (const r of all) {
    if (r.parent_id === parentId && r.raw_text && r.raw_text.length >= MIN_CLAUSE_LENGTH) {
      return true
    }
  }
  return false
}
