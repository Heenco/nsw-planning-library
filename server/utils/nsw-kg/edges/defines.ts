// ── defines edge builder ────────────────────────────────────────────────
//
// For every proposition in a document, find every Dictionary term whose
// name appears in its source_span, and create a `defines` edge from the
// Dictionary proposition → the proposition that uses the term.
//
// "defines" direction: the Dictionary proposition is the FROM (it defines
// a term), and every proposition that references that term is a TO target.
// This matches the semantic "definition → consumer" — traversing outward
// from a definition finds everywhere the term is used.
//
// Implementation: we use the pg_trgm extension's @@ operator… actually no,
// we just iterate. Dictionary sizes are small (<500 terms) and clauses are
// short, so a simple substring scan is fine and avoids pulling in a real
// Aho-Corasick library.

import { withNswTx } from '../pool'

export interface DefinesResult {
  dictionary_terms:    number
  definitions_found:   number
  edges_inserted:      number
}

export async function buildDefinesEdges(documentId: string): Promise<DefinesResult> {
  return withNswTx(async (client) => {
    // 1. Wipe existing defines edges for this document (idempotent)
    await client.query(`
      DELETE FROM edge
      WHERE type = 'defines'
        AND from_id IN (SELECT id FROM proposition WHERE document_id = $1::uuid)
    `, [documentId])

    // 2. Fetch all definition propositions in this document.
    //    These are typically in the Dictionary section, but a document can
    //    define terms inline too (e.g., "For the purposes of this Part, X means Y").
    const defs = await client.query<{ id: string; subject: string }>(`
      SELECT id, subject
      FROM proposition
      WHERE document_id = $1::uuid
        AND type = 'definition'
    `, [documentId])

    if (defs.rows.length === 0) {
      return { dictionary_terms: 0, definitions_found: 0, edges_inserted: 0 }
    }

    // 3. Build a list of (defId, subject, subjectLower, subjectLowerWithSpaces)
    //    for matching. We only match subjects of length >= 3 to avoid false
    //    positives from words like "it" or "a".
    const terms: Array<{ id: string; subject: string; needle: string }> = []
    for (const d of defs.rows) {
      const subj = d.subject.trim()
      if (subj.length < 3) continue
      // Normalize: lowercase, collapse whitespace. Consumers' source_spans
      // will also be lowercased for matching.
      terms.push({
        id: d.id,
        subject: subj,
        needle: subj.toLowerCase().replace(/\s+/g, ' '),
      })
    }

    // 4. Fetch every proposition in this document. We'll scan each
    //    proposition's source_span against every term.
    const props = await client.query<{ id: string; source_span: string }>(`
      SELECT id, source_span
      FROM proposition
      WHERE document_id = $1::uuid
    `, [documentId])

    // 5. Match. For each proposition, for each term, check substring match.
    //    Collect (fromDefId, toPropId) pairs, deduped.
    const edges: Array<{ from_id: string; to_id: string }> = []
    const seen = new Set<string>()

    for (const p of props.rows) {
      const haystack = (p.source_span || '').toLowerCase().replace(/\s+/g, ' ')
      if (!haystack) continue

      for (const t of terms) {
        if (t.id === p.id) continue   // a definition shouldn't define itself
        if (!haystack.includes(t.needle)) continue

        // Word boundary check: the needle must not be a substring of a
        // longer word. Cheap check: the chars immediately before/after must
        // be non-alphanumeric.
        const start = haystack.indexOf(t.needle)
        const before = start === 0 ? ' ' : haystack[start - 1]!
        const after  = start + t.needle.length >= haystack.length ? ' ' : haystack[start + t.needle.length]!
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue

        const key = `${t.id}|${p.id}`
        if (seen.has(key)) continue
        seen.add(key)

        edges.push({ from_id: t.id, to_id: p.id })
      }
    }

    // 6. Bulk insert
    let insertedCount = 0
    if (edges.length > 0) {
      // Postgres has a parameter limit of 65535 — chunk at 10k pairs
      const CHUNK = 5000
      for (let i = 0; i < edges.length; i += CHUNK) {
        const chunk = edges.slice(i, i + CHUNK)
        const fromIds = chunk.map((e) => e.from_id)
        const toIds   = chunk.map((e) => e.to_id)
        const res = await client.query(`
          INSERT INTO edge (from_id, to_id, type, target_kind, source, confidence, cross_document)
          SELECT f, t, 'defines', 'proposition', 'aho_corasick', 0.9, false
          FROM unnest($1::uuid[], $2::uuid[]) AS u(f, t)
          RETURNING 1
        `, [fromIds, toIds])
        insertedCount += res.rowCount ?? 0
      }
    }

    return {
      dictionary_terms:    terms.length,
      definitions_found:   terms.length,
      edges_inserted:      insertedCount,
    }
  })
}
