/**
 * How much of each source document actually reached the graph.
 *
 * Every ingest failure this project has hit was silent. The XML parser skipped
 * three wrapper elements and dropped half the Hornsby LEP -- no error, and the
 * sections it did store looked perfectly well-formed. The pilot import produced
 * 59 sections where the document has 1214, and the report ran on it for months.
 * Schedule 1 parsed to a single empty node while still being citable.
 *
 * None of that is detectable by inspecting the database on its own, because
 * what is there is consistent; it is what is *missing* that matters. So every
 * measure here compares the database against the source file, which is
 * self-describing: the XML says how many clauses it contains, so the shortfall
 * is arithmetic rather than judgement.
 */

import { readFile } from 'node:fs/promises'
import type pg from 'pg'

export interface SourceStats {
  /** Structural elements the source declares: levels, tiers, list items. */
  elements: number
  /** Characters of body text, from <txt> and table <entry> nodes. */
  chars: number
  /** Approximate when the source is HTML rather than PCO XML. */
  approximate: boolean
}

export interface DocCoverage {
  slug: string
  title: string
  docType: string
  lga: string | null
  rawPath: string | null
  sourceMissing: boolean
  source: SourceStats | null
  db: {
    sections: number
    chars: number
    propositions: number
    rules: number
    effects: number
    spatialRefs: number
    tables: number
  }
  /** db ÷ source, null when the source could not be read. */
  structuralPct: number | null
  textPct: number | null
  /** How far down the pipeline this document got. */
  stage: 'none' | 'sections' | 'propositions' | 'rules'
  quality: {
    emptySections: number
    effectsWithoutBound: number
    effectsUnspecifiedTopic: number
    rulesWithoutApplicability: number
  }
}

// PCO XML is regular enough to count with patterns rather than a full parse:
// this runs over every document on each request, and parsing 30MB to produce
// two integers would make the page too slow to keep open.
const RE_LEVEL = /<level\b[^>]*\btype="[^"]*"/gi
const RE_TIER = /<tier\b[^>]*\btype="[^"]*"/gi
const RE_LI = /<li\b/gi
const RE_TXT = /<txt\b[^>]*>([\s\S]*?)<\/txt>/gi
const RE_ENTRY = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi
const RE_TAGS = /<[^>]+>/g

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) || []).length
}

/** Total visible text inside every match of `re`, tags stripped. */
function textIn(s: string, re: RegExp): number {
  let total = 0
  for (const m of s.matchAll(re)) total += (m[1] || '').replace(RE_TAGS, '').trim().length
  return total
}

export async function readSourceStats(rawPath: string | null): Promise<SourceStats | null> {
  if (!rawPath || rawPath.startsWith('pilot:')) return null
  let raw: string
  try {
    raw = await readFile(rawPath, 'utf-8')
  } catch {
    return null
  }

  if (/\.xml$/i.test(rawPath)) {
    return {
      elements: countMatches(raw, RE_LEVEL) + countMatches(raw, RE_TIER) + countMatches(raw, RE_LI),
      chars: textIn(raw, RE_TXT) + textIn(raw, RE_ENTRY),
      approximate: false,
    }
  }

  // HTML sources carry no structural vocabulary to count, so the element figure
  // is headings and list items and the comparison is indicative only. Marked
  // approximate so the page does not present it as the same kind of number.
  return {
    elements: countMatches(raw, /<h[1-6]\b/gi) + countMatches(raw, RE_LI),
    chars: raw.replace(RE_TAGS, ' ').replace(/\s+/g, ' ').trim().length,
    approximate: true,
  }
}

export async function getGraphCoverage(client: pg.PoolClient): Promise<DocCoverage[]> {
  const docs = (await client.query(`
    SELECT d.id, d.instrument_slug AS slug, d.title, d.doc_type, d.lga_name, d.raw_path,
           (SELECT count(*) FROM nsw.section s WHERE s.document_id = d.id) AS sections,
           (SELECT coalesce(sum(length(coalesce(s.raw_text, ''))), 0)
              FROM nsw.section s WHERE s.document_id = d.id) AS chars,
           (SELECT count(*) FROM nsw.proposition p WHERE p.document_id = d.id) AS propositions,
           (SELECT count(*) FROM nsw.rule r WHERE r.document_id = d.id) AS rules,
           (SELECT count(*) FROM nsw.rule_effect e JOIN nsw.rule r ON r.id = e.rule_id
             WHERE r.document_id = d.id) AS effects,
           (SELECT count(*) FROM nsw.rule_spatial_ref sr WHERE sr.document_id = d.id) AS spatial_refs,
           (SELECT count(*) FROM nsw.section_table st JOIN nsw.section s ON s.id = st.section_id
             WHERE s.document_id = d.id) AS tables,
           (SELECT count(*) FROM nsw.section s
             WHERE s.document_id = d.id AND coalesce(s.raw_text, '') = '') AS empty_sections,
           (SELECT count(*) FROM nsw.rule_effect e JOIN nsw.rule r ON r.id = e.rule_id
             WHERE r.document_id = d.id AND e.comparator IS NULL AND e.value IS NOT NULL) AS effects_no_bound,
           (SELECT count(*) FROM nsw.rule_effect e JOIN nsw.rule r ON r.id = e.rule_id
             WHERE r.document_id = d.id AND e.topic = 'unspecified') AS effects_unspecified,
           (SELECT count(*) FROM nsw.rule r WHERE r.document_id = d.id
              AND NOT EXISTS (SELECT 1 FROM nsw.rule_applicability a WHERE a.rule_id = r.id)) AS rules_no_app
      FROM nsw.document d
     ORDER BY d.doc_type, d.instrument_slug`)).rows

  const out: DocCoverage[] = []
  for (const d of docs) {
    const source = await readSourceStats(d.raw_path)
    const db = {
      sections: Number(d.sections),
      chars: Number(d.chars),
      propositions: Number(d.propositions),
      rules: Number(d.rules),
      effects: Number(d.effects),
      spatialRefs: Number(d.spatial_refs),
      tables: Number(d.tables),
    }

    // Capped at 100: a source count is a floor, not an exact target -- the
    // parser legitimately creates nodes the patterns above do not count, and a
    // figure over 100% would read as a fault when it is not one.
    const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : null)

    out.push({
      slug: d.slug,
      title: d.title,
      docType: d.doc_type,
      lga: d.lga_name,
      rawPath: d.raw_path,
      sourceMissing: !source,
      source,
      db,
      structuralPct: source ? pct(db.sections, source.elements) : null,
      textPct: source ? pct(db.chars, source.chars) : null,
      stage: db.rules > 0 ? 'rules'
        : db.propositions > 0 ? 'propositions'
          : db.sections > 0 ? 'sections' : 'none',
      quality: {
        emptySections: Number(d.empty_sections),
        effectsWithoutBound: Number(d.effects_no_bound),
        effectsUnspecifiedTopic: Number(d.effects_unspecified),
        rulesWithoutApplicability: Number(d.rules_no_app),
      },
    })
  }
  return out
}
