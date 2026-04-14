// ── Stage B — hybrid retrieval (vector + BM25 + RRF) ───────────────────
//
// Three SQL passes:
//   1. vector_top   = ORDER BY embedding <=> query_emb LIMIT 50
//   2. bm25_top     = ts_rank_cd(search_vector, plainto_tsquery) LIMIT 50
//   3. RRF merge in TS, return top N (default 30)
//
// Honors LGA + doc_type filters from the QueryPlan.

import { embedTexts } from '../../embeddings'
import { withNswClient } from '../pool'
import type { QueryPlan, RetrievalCandidate } from './types'

const VECTOR_K = 50
const BM25_K = 50
const RRF_K = 60
const TOP_N = 30

export interface RetrieveOptions {
  query:        string
  plan:         QueryPlan
  apiKey:       string
  lgaFilter?:   string             // overrides plan.entities.lga if set
  docTypeFilter?: 'lep' | 'sepp' | 'dcp'
}

interface DbCandidate {
  id:                string
  document_id:       string
  document_title:    string
  document_doc_type: 'lep' | 'sepp' | 'dcp'
  document_lga:      string | null
  document_hierarchy_level: number
  document_source_url: string | null
  section_id:        string
  section_local_id:  string
  section_number:    string | null
  section_heading:   string | null
  section_source_file: string | null
  section_page:      number | null
  type:              any
  subject:           string
  predicate:         string
  object:            string | null
  numeric_value:     number | null
  numeric_unit:      string | null
  numeric_comparator: string | null
  value_source:      string | null
  source_span:       string
  conditional_on:    string | null
  vector_distance?:  number | null
  bm25_score?:       number | null
}

const SELECT_FIELDS = `
  p.id, p.document_id,
  d.title AS document_title,
  d.doc_type AS document_doc_type,
  d.lga_name AS document_lga,
  d.hierarchy_level AS document_hierarchy_level,
  d.source_url AS document_source_url,
  p.section_id,
  s.local_id AS section_local_id,
  s.number AS section_number,
  s.heading AS section_heading,
  s.source_file AS section_source_file,
  s.page AS section_page,
  p.type, p.subject, p.predicate, p.object,
  p.numeric_value, p.numeric_unit, p.numeric_comparator, p.value_source,
  p.source_span, p.conditional_on
`

const JOINS = `
  FROM proposition p
  JOIN section s ON s.id = p.section_id
  JOIN document d ON d.id = p.document_id
`

function buildFilterClause(opts: RetrieveOptions, startIdx: number): { clause: string; params: any[] } {
  const params: any[] = []
  const conds: string[] = []
  let i = startIdx

  const lga = opts.lgaFilter ?? opts.plan.entities.lga
  if (lga) {
    // Normalize LGA names — strip common prefixes ("City of", "Shire of",
    // "Municipality of") and trailing suffixes ("City", "Council",
    // "Shire", "Regional Council") on both sides so e.g.
    // "ALBURY CITY" → "albury" and "Albury City Council" → "albury"
    // matches KG's "Albury".
    const normalizeSql = `LOWER(TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE($1, '^\\s*(city of|shire of|municipality of|council of)\\s+', '', 'i'),
          '\\s+(city council|regional council|shire council|council|city|shire)\\s*$', '', 'i'
        ),
        '\\s+', ' ', 'g'
      )
    ))`

    // Apply the same normalization to both sides
    const normDbLga = normalizeSql.replace(/\$1/g, 'd.lga_name')
    const normFilterIdx = i++
    const normFilterRef = normalizeSql.replace(/\$1/g, `$${normFilterIdx}`)

    const ilikeIdx = i++

    conds.push(`(
      ${normDbLga} = ${normFilterRef}
      OR d.lga_name ILIKE '%' || $${ilikeIdx} || '%'
      OR d.lga_name IS NULL
    )`)

    // Clean filter value for the ILIKE fallback
    const cleanLga = lga
      .replace(/^(city of|shire of|municipality of|council of)\s+/i, '')
      .replace(/\s+(city council|regional council|shire council|council|city|shire)\s*$/i, '')
      .trim()

    params.push(lga)       // for normalized match ($normFilterIdx)
    params.push(cleanLga)  // for ILIKE fallback ($ilikeIdx)
  }

  const docType = opts.docTypeFilter ?? opts.plan.entities.doc_type
  if (docType) {
    conds.push(`d.doc_type = $${i++}`)
    params.push(docType)
  }

  return {
    clause: conds.length > 0 ? `AND ${conds.join(' AND ')}` : '',
    params,
  }
}

export async function retrieveCandidates(opts: RetrieveOptions): Promise<RetrievalCandidate[]> {
  // Build the embedding-friendly query string
  const queryText = [opts.query, ...(opts.plan.keywords ?? [])].join(' ').slice(0, 800)

  // 1. Embed the query
  const [queryVec] = await embedTexts([queryText], opts.apiKey)
  if (!queryVec) throw new Error('failed to embed query')

  // The full 4096-dim embedding goes into the literal for re-ranking if needed.
  // For the initial HNSW search we use the first 2000 dims as a halfvec,
  // matching proposition.embedding_2k (see db/nsw-schema-migration-02-indexes.sql).
  const queryVec2k = queryVec.slice(0, 2000)
  const queryVec2kLiteral = `[${queryVec2k.join(',')}]`

  // Build BM25 search text — prefer keywords if present, else raw query.
  // plainto_tsquery handles tokenisation and AND'ing.
  const bm25Text = (opts.plan.keywords && opts.plan.keywords.length > 0)
    ? opts.plan.keywords.join(' ')
    : opts.query

  const filter = buildFilterClause(opts, 3)

  return withNswClient(async (client) => {
    // ── Vector search ──────────────────────────────────────────────────
    // Uses the HNSW-indexed halfvec(2000) column for O(log N) lookup instead
    // of full sequential scan over 4096-dim vectors.
    const vectorSql = `
      SELECT ${SELECT_FIELDS},
        (p.embedding_2k <=> $1::halfvec(2000)) AS vector_distance
      ${JOINS}
      WHERE p.embedding_2k IS NOT NULL
        ${filter.clause}
      ORDER BY p.embedding_2k <=> $1::halfvec(2000)
      LIMIT $2::int
    `
    const vectorRows = await client.query<DbCandidate>(
      vectorSql,
      [queryVec2kLiteral, VECTOR_K, ...filter.params],
    )

    // ── BM25 search ────────────────────────────────────────────────────
    const bm25Filter = buildFilterClause(opts, 3)
    const bm25Sql = `
      SELECT ${SELECT_FIELDS},
        ts_rank_cd(p.search_vector, q) AS bm25_score
      ${JOINS},
        plainto_tsquery('english', $1) AS q
      WHERE p.search_vector IS NOT NULL
        AND p.search_vector @@ q
        ${bm25Filter.clause}
      ORDER BY ts_rank_cd(p.search_vector, q) DESC
      LIMIT $2::int
    `
    const bm25Rows = await client.query<DbCandidate>(
      bm25Sql,
      [bm25Text, BM25_K, ...bm25Filter.params],
    )

    // ── Merge with RRF ────────────────────────────────────────────────
    const byId = new Map<string, RetrievalCandidate>()

    vectorRows.rows.forEach((r, idx) => {
      const rank = idx + 1
      byId.set(r.id, {
        id: r.id,
        document_id: r.document_id,
        document_title: r.document_title,
        document_doc_type: r.document_doc_type,
        document_lga: r.document_lga,
        document_hierarchy_level: r.document_hierarchy_level,
        document_source_url: r.document_source_url,
        section_id: r.section_id,
        section_local_id: r.section_local_id,
        section_number: r.section_number,
        section_heading: r.section_heading,
        section_source_file: r.section_source_file,
        section_page: r.section_page !== null ? Number(r.section_page) : null,
        type: r.type,
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
        numeric_value: r.numeric_value !== null ? Number(r.numeric_value) : null,
        numeric_unit: r.numeric_unit,
        numeric_comparator: r.numeric_comparator,
        value_source: r.value_source,
        source_span: r.source_span,
        conditional_on: r.conditional_on,
        vector_rank: rank,
        bm25_rank: null,
        vector_distance: r.vector_distance !== undefined ? Number(r.vector_distance) : null,
        bm25_score: null,
        rrf_score: 1 / (RRF_K + rank),
        source: 'retrieved',
        expanded_via: null,
      })
    })

    bm25Rows.rows.forEach((r, idx) => {
      const rank = idx + 1
      const existing = byId.get(r.id)
      if (existing) {
        existing.bm25_rank = rank
        existing.bm25_score = r.bm25_score !== undefined ? Number(r.bm25_score) : null
        existing.rrf_score += 1 / (RRF_K + rank)
      } else {
        byId.set(r.id, {
          id: r.id,
          document_id: r.document_id,
          document_title: r.document_title,
          document_doc_type: r.document_doc_type,
          document_lga: r.document_lga,
          document_hierarchy_level: r.document_hierarchy_level,
          document_source_url: r.document_source_url,
          section_id: r.section_id,
          section_local_id: r.section_local_id,
          section_number: r.section_number,
          section_heading: r.section_heading,
          section_source_file: r.section_source_file,
          section_page: r.section_page !== null ? Number(r.section_page) : null,
          type: r.type,
          subject: r.subject,
          predicate: r.predicate,
          object: r.object,
          numeric_value: r.numeric_value !== null ? Number(r.numeric_value) : null,
          numeric_unit: r.numeric_unit,
          numeric_comparator: r.numeric_comparator,
          value_source: r.value_source,
          source_span: r.source_span,
          conditional_on: r.conditional_on,
          vector_rank: null,
          bm25_rank: rank,
          vector_distance: null,
          bm25_score: r.bm25_score !== undefined ? Number(r.bm25_score) : null,
          rrf_score: 1 / (RRF_K + rank),
          source: 'retrieved',
          expanded_via: null,
        })
      }
    })

    // Sort by RRF, take top N
    return Array.from(byId.values())
      .sort((a, b) => b.rrf_score - a.rrf_score)
      .slice(0, TOP_N)
  })
}
