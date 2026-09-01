// ── Section bulk upsert ─────────────────────────────────────────────────
//
// Insert all sections for a document in one transaction. Sections are
// inserted in two passes:
//
//   Pass 1: insert all rows with parent_id = NULL, capturing local_id → uuid
//   Pass 2: UPDATE parent_id from the local_id → uuid map
//
// This avoids ordering constraints on the self-referencing FK.

import { withNswTx } from '../pool'
import type { FlatSection } from '../parsers/nsw-xml-parser'

export interface InsertedSections {
  byLocalId: Map<string, string>      // local_id → uuid
  count:     number
}

export async function upsertSections(
  documentId: string,
  flat: FlatSection[],
): Promise<InsertedSections> {
  return withNswTx(async (client) => {
    const byLocalId = new Map<string, string>()

    if (flat.length === 0) return { byLocalId, count: 0 }

    // ── Pass 1: bulk insert without parent_id ─────────────────────────
    // Use UNNEST for a single round-trip insert. Postgres handles ~50k rows
    // per call comfortably.
    const localIds:    string[] = []
    const levels:      string[] = []
    const numbers:     (string | null)[] = []
    const headings:    (string | null)[] = []
    const rawTexts:    string[] = []
    const depths:      number[] = []
    const sortOrders:  number[] = []
    const sourceFiles: (string | null)[] = []
    const pages:       (number | null)[] = []

    for (const s of flat) {
      localIds.push(s.local_id)
      levels.push(s.level)
      numbers.push(s.number)
      headings.push(s.heading)
      rawTexts.push(s.raw_text)
      depths.push(s.depth)
      sortOrders.push(s.sort_order)
      sourceFiles.push(s.source_file)
      pages.push(s.page)
    }

    // Param map:
    //   $1  documentId    (uuid)
    //   $2  localIds      (text[])    → l
    //   $3  levels        (text[])    → lvl
    //   $4  numbers       (text[])    → num
    //   $5  headings      (text[])    → hd
    //   $6  rawTexts      (text[])    → rt
    //   $7  depths        (int[])     → d
    //   $8  sortOrders    (int[])     → so
    //   $9  sourceFiles   (text[])    → sf    — DCP hotlink: split PDF file
    //   $10 pages         (int[])     → pg   — DCP hotlink: page within file
    const insertSql = `
      INSERT INTO section (
        document_id, parent_id, local_id, level, number, heading, raw_text, depth, sort_order, source_file, page
      )
      SELECT $1::uuid, NULL, l, lvl, num, hd, rt, d, so, sf, pg
      FROM unnest(
        $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::text[], $10::int[]
      ) AS t(l, lvl, num, hd, rt, d, so, sf, pg)
      RETURNING id, local_id
    `
    const ins = await client.query(insertSql, [
      documentId, localIds, levels, numbers, headings, rawTexts, depths, sortOrders, sourceFiles, pages,
    ])

    for (const row of ins.rows) {
      byLocalId.set(row.local_id, row.id)
    }

    // ── Pass 2: set parent_id from local_id → uuid map ─────────────────
    // Build two parallel arrays: child uuid + parent uuid
    const childIds:  string[] = []
    const parentIds: string[] = []
    for (const s of flat) {
      if (s.parent_local_id) {
        const childId  = byLocalId.get(s.local_id)
        const parentId = byLocalId.get(s.parent_local_id)
        if (childId && parentId) {
          childIds.push(childId)
          parentIds.push(parentId)
        }
      }
    }

    if (childIds.length > 0) {
      await client.query(`
        UPDATE section AS s
        SET parent_id = u.parent
        FROM unnest($1::uuid[], $2::uuid[]) AS u(child, parent)
        WHERE s.id = u.child
      `, [childIds, parentIds])
    }

    return { byLocalId, count: flat.length }
  })
}
