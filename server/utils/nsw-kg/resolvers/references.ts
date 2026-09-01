// ── Reference resolver (Stage 3) ────────────────────────────────────────
//
// Takes raw cross-references found in clause source_spans (either emitted
// by the LLM in the `refs` JSONB column, or extracted by regex as a
// fallback) and resolves them to target `nsw.section.id` UUIDs within the
// same document.
//
// Strategy:
//   1. Build a lookup map of {number → section UUIDs} for this document
//      (keyed by clause number "4.1", subclause "(1)", schedule number, etc.)
//   2. For each proposition with refs[], look each ref up. Successes go
//      into refs_resolved[]. Failures get queued as nsw.question rows
//      (type='unresolved_ref') — but only if severity warrants it.
//   3. Also run a regex pass over each proposition's source_span to catch
//      refs the LLM missed or wasn't present in `refs`.
//
// The output of this stage feeds the `requires` edge builder, which turns
// every resolved reference into an edge.

import { withNswTx } from '../pool'

// ── Regex patterns for explicit clause references ───────────────────────
//
// NSW legislation uses a narrow phrasebook for cross-references. Order
// matters — more specific first.

interface RawRef {
  type:   'clause' | 'subclause' | 'paragraph' | 'schedule' | 'part' | 'dictionary' | 'unknown'
  ref:    string    // normalized reference string, e.g. '4.1', '1', '(2)'
  raw:    string    // the exact substring that matched
  offset: number    // character offset in source_span
}

// The canonical clause pattern:
//   "clause 4.1" | "clauses 4.1 and 4.2" | "section 3.20" | "cl. 4.1"
// Most NSW refs use "clause" even though statute sections use "section".
const CLAUSE_RE = /\b(?:clauses?|cl\.?|sections?|sec\.?)\s+(\d+\.?\d*[A-Z]{0,3})\b/gi

// Subclause pattern:
//   "subclause (2)" | "subclauses (1) and (2)"
const SUBCLAUSE_RE = /\bsubclauses?\s+\(([^)]+)\)/gi

// Schedule pattern:
const SCHEDULE_RE = /\bSchedules?\s+(\d+[A-Z]?)\b/g

// Part pattern:
const PART_RE = /\bParts?\s+(\d+[A-Z]?)\b/g

// Dictionary ref:
const DICT_RE = /\bthe\s+Dictionary\b/gi

export function extractReferences(text: string): RawRef[] {
  if (!text) return []
  const refs: RawRef[] = []

  for (const m of text.matchAll(CLAUSE_RE)) {
    refs.push({ type: 'clause', ref: (m[1] || '').trim(), raw: m[0], offset: m.index ?? 0 })
  }
  for (const m of text.matchAll(SUBCLAUSE_RE)) {
    refs.push({ type: 'subclause', ref: `(${(m[1] || '').trim()})`, raw: m[0], offset: m.index ?? 0 })
  }
  for (const m of text.matchAll(SCHEDULE_RE)) {
    refs.push({ type: 'schedule', ref: (m[1] || '').trim(), raw: m[0], offset: m.index ?? 0 })
  }
  for (const m of text.matchAll(PART_RE)) {
    refs.push({ type: 'part', ref: (m[1] || '').trim(), raw: m[0], offset: m.index ?? 0 })
  }
  for (const m of text.matchAll(DICT_RE)) {
    refs.push({ type: 'dictionary', ref: 'dict', raw: m[0], offset: m.index ?? 0 })
  }

  // Dedupe by (type, ref, offset)
  const seen = new Set<string>()
  return refs.filter((r) => {
    const k = `${r.type}|${r.ref}|${r.offset}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ── Section lookup index ─────────────────────────────────────────────────

export interface SectionLookup {
  /** Map from normalized key ('clause:4.1', 'schedule:1', 'part:4', 'dict') → section UUID */
  byKey: Map<string, string>
}

export async function buildSectionLookup(documentId: string): Promise<SectionLookup> {
  const byKey = new Map<string, string>()

  await withNswTx(async (client) => {
    const { rows } = await client.query<{ id: string; level: string; number: string | null; local_id: string }>(
      `SELECT id, level, number, local_id FROM section WHERE document_id = $1::uuid`,
      [documentId],
    )

    for (const r of rows) {
      // Dictionary
      if (r.level === 'dictionary') byKey.set('dict', r.id)
      // Part
      if (r.level === 'part' && r.number) byKey.set(`part:${r.number}`, r.id)
      // Schedule
      if (r.level === 'schedule' && r.number) byKey.set(`schedule:${r.number}`, r.id)
      // Clause
      if (r.level === 'clause' && r.number) byKey.set(`clause:${r.number}`, r.id)
      // Subclause — key by the parent clause + subclause number
      // Example: local_id = 'sec.4.1-ssec.2', number = '(2)'. The parent clause
      // number can be parsed from the local_id ('sec.4.1') so the subclause key
      // is 'subclause:4.1:(2)'. But since subclauses are usually referenced
      // inside their parent clause, we also just key 'subclause:(2)' which won't
      // be unique but is a best-effort fallback.
      if (r.level === 'subclause' && r.number) {
        // Parse parent clause from local_id
        const m = r.local_id.match(/^sec\.([\d.]+[A-Z]*)-ssec/)
        if (m) byKey.set(`subclause:${m[1]}:${r.number}`, r.id)
      }
    }
  })

  return { byKey }
}

export function lookupRef(lookup: SectionLookup, ref: RawRef): string | null {
  if (ref.type === 'dictionary') return lookup.byKey.get('dict') ?? null
  const key = `${ref.type}:${ref.ref}`
  return lookup.byKey.get(key) ?? null
}

// ── Per-proposition resolution ───────────────────────────────────────────

export interface ResolvedRef {
  type:       string
  ref:        string
  raw:        string
  offset:     number
  section_id: string   // UUID
}

export interface ResolutionStats {
  propositions_scanned:  number
  references_found:      number
  references_resolved:   number
  references_unresolved: number
  propositions_updated:  number
}

/** Walk every proposition in the document, extract refs from source_span,
 *  resolve them to section UUIDs, and write results to refs_resolved. */
export async function resolveReferencesForDocument(
  documentId: string,
  lookup: SectionLookup,
): Promise<ResolutionStats> {
  const stats: ResolutionStats = {
    propositions_scanned:  0,
    references_found:      0,
    references_resolved:   0,
    references_unresolved: 0,
    propositions_updated:  0,
  }

  return withNswTx(async (client) => {
    const { rows } = await client.query<{ id: string; source_span: string; refs: any }>(
      `SELECT id, source_span, refs FROM proposition WHERE document_id = $1::uuid`,
      [documentId],
    )

    for (const row of rows) {
      stats.propositions_scanned++

      // Prefer LLM-emitted refs if present; fall back to regex over source_span.
      const llmRefs: RawRef[] = Array.isArray(row.refs)
        ? row.refs.map((r: any) => ({ type: r.type, ref: r.ref, raw: r.raw ?? r.ref, offset: 0 }))
        : []
      const regexRefs = extractReferences(row.source_span || '')

      // Merge — dedupe by (type, ref)
      const combinedMap = new Map<string, RawRef>()
      for (const r of [...llmRefs, ...regexRefs]) {
        combinedMap.set(`${r.type}|${r.ref}`, r)
      }
      const combined = Array.from(combinedMap.values())

      if (combined.length === 0) continue
      stats.references_found += combined.length

      const resolved: ResolvedRef[] = []
      for (const ref of combined) {
        const sectionId = lookupRef(lookup, ref)
        if (sectionId) {
          stats.references_resolved++
          resolved.push({
            type: ref.type, ref: ref.ref, raw: ref.raw, offset: ref.offset,
            section_id: sectionId,
          })
        } else {
          stats.references_unresolved++
          // Not flagging as a question for now — too noisy. Unresolved refs
          // are expected (e.g., references to the EP&A Act itself).
        }
      }

      if (resolved.length > 0) {
        await client.query(
          `UPDATE proposition SET refs_resolved = $1::jsonb WHERE id = $2::uuid`,
          [JSON.stringify(resolved), row.id],
        )
        stats.propositions_updated++
      }
    }

    return stats
  })
}
