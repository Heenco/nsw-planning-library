/**
 * GET /api/precinct/samples - sample lots for the /precinct bench: for every instrument the precinct schema holds a
 * Land Use Table for, every governing unit and every zone the state-wide build found lots in (derived.lot_instrument),
 * one addressed lot - so every (unit, zone) table can be opened and a missing one shows as a lot with no table.
 * Measured from the data, not typed; cached for the process (a unit bound by its precinct boundary counts like any other).
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface PrecinctSample { cadid: string; address: string | null; instrument: string; unit: string | null; heading: string | null; zone: string | null; lots: number }
let cache: { at: number; rows: PrecinctSample[] } | null = null

export default defineEventHandler(async (event): Promise<{ samples: PrecinctSample[] }> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return { samples: cache.rows }
  const rows = (await nswQuery<any>(`
    WITH units AS (
      SELECT document_title, unit_local_id, unit_heading, zone, count(*) AS lots
        FROM derived.lot_instrument
       WHERE governing AND document_id IS NOT NULL
         AND document_title IN (SELECT DISTINCT epi_name FROM precinct.lut_permissibility)
       GROUP BY 1, 2, 3, 4),
    picks AS (
      SELECT u.document_title, u.unit_local_id, u.unit_heading, u.zone, u.lots, s.cadid, s.address
        FROM units u JOIN LATERAL (
          SELECT i.cadid, a.address FROM derived.lot_instrument i
            JOIN LATERAL (SELECT a.address FROM derived.lot_address a WHERE a.cadid = i.cadid AND a.address IS NOT NULL AND a.address !~ '^[A-Z ]+$'
                            ORDER BY a.is_primary_address DESC NULLS LAST LIMIT 1) a ON true
           WHERE i.governing AND i.document_title = u.document_title AND i.unit_local_id IS NOT DISTINCT FROM u.unit_local_id AND i.zone IS NOT DISTINCT FROM u.zone
           ORDER BY i.cadid LIMIT 1) s ON true)
    SELECT p.cadid, p.address, p.document_title AS instrument, p.unit_local_id AS unit, p.unit_heading AS heading, p.zone, p.lots
      FROM picks p ORDER BY p.document_title, p.unit_local_id, p.zone`)).rows
  cache = { at: Date.now(), rows: rows.map((r: any) => ({ cadid: String(r.cadid), address: r.address ?? null, instrument: r.instrument, unit: r.unit ?? null, heading: r.heading ?? null, zone: r.zone ?? null, lots: Number(r.lots) })) }
  return { samples: cache.rows }
})
