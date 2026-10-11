/**
 * GET /api/report/cdc-requirements - every requirement of every complying development type, clause by clause, from the CDC
 * catalogue (cdc.type_requirement), for /report-2. Not lot-specific: the page lays each type's checks from /api/cdc/types
 * over these rows, so a clause no check tests still shows - as "not tested here" - rather than dropping out.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface CdcRequirement {
  typeKey: string
  ord: number
  clause: string
  text: string
  href: string | null
  tested: boolean
  /** What tests it, as stored: a column name, or JSON test specs ({column, says}). */
  testedBy: string
  note: string | null
}

export default defineEventHandler(async (event): Promise<CdcRequirement[]> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  const rows = (await nswQuery<any>(`SELECT type_key, ord, clause, text, href, tested, tested_by::text AS tested_by, note
                                       FROM cdc.type_requirement ORDER BY type_key, ord`)).rows
  return rows.map(r => ({ typeKey: r.type_key, ord: Number(r.ord), clause: r.clause ?? '', text: r.text ?? '', href: r.href ?? null,
    tested: !!r.tested, testedBy: r.tested_by ?? '', note: r.note ?? null }))
})
