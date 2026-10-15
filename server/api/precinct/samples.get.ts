/**
 * GET /api/precinct/samples - sample lots inside the Precinct SEPPs for the /precinct bench: for every instrument and
 * every governing unit the state-wide build found lots under (derived.lot_instrument), a few addressed lots in a
 * residential or centre zone. Measured from the data, not typed; cached for the process.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface PrecinctSample { cadid: string; address: string | null; instrument: string; unit: string | null; heading: string | null; zone: string | null; lots: number }
let cache: { at: number; rows: PrecinctSample[] } | null = null

export default defineEventHandler(async (event): Promise<{ samples: PrecinctSample[] }> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return { samples: cache.rows }
  const rows = (await nswQuery<any>(`
    WITH units AS (
      SELECT document_title, unit_local_id, unit_heading, count(*) AS lots
        FROM derived.lot_instrument
       WHERE governing AND document_id IS NOT NULL AND doc_type = 'sepp'
         AND EXISTS (SELECT 1 FROM nsw.instrument_unit_map m WHERE m.document_id = derived.lot_instrument.document_id AND m.unit_local_id IS NOT NULL)
       GROUP BY 1, 2, 3),
    picks AS (
      SELECT u.document_title, u.unit_local_id, u.unit_heading, u.lots, s.cadid, s.zone,
             row_number() OVER (PARTITION BY u.document_title, u.unit_local_id ORDER BY (s.zone ~ '^R[1-4]$') DESC, (s.zone ~ '^(E1|E2|MU1|B[1-4]|SP[1-4]|C[1-4]|IN[1-2])$') DESC, s.cadid) AS rn
        FROM units u JOIN LATERAL (
          SELECT i.cadid, i.zone FROM derived.lot_instrument i
           WHERE i.governing AND i.document_title = u.document_title AND i.unit_local_id IS NOT DISTINCT FROM u.unit_local_id
             AND EXISTS (SELECT 1 FROM derived.lot_address a WHERE a.cadid = i.cadid AND a.address IS NOT NULL AND a.address !~ '^[A-Z ]+$')
           ORDER BY (i.zone ~ '^R[1-4]$') DESC, (i.zone ~ '^(E1|E2|MU1|B[1-4]|SP[1-4]|C[1-4]|IN[1-2])$') DESC, i.cadid LIMIT 6) s ON true)
    SELECT DISTINCT ON (p.document_title, p.unit_local_id, address) p.cadid, address,
           p.document_title AS instrument, p.unit_local_id AS unit, p.unit_heading AS heading, p.zone, p.lots
      FROM picks p CROSS JOIN LATERAL (SELECT a.address FROM derived.lot_address a WHERE a.cadid = p.cadid ORDER BY a.is_primary_address DESC NULLS LAST LIMIT 1) a
     WHERE p.rn <= 3 ORDER BY p.document_title, p.unit_local_id, address, p.cadid`)).rows
    .sort((x: any, y: any) => String(x.instrument).localeCompare(String(y.instrument)) || Number(y.lots) - Number(x.lots) || String(x.unit).localeCompare(String(y.unit)))
  cache = { at: Date.now(), rows: rows.map((r: any) => ({ cadid: String(r.cadid), address: r.address ?? null, instrument: r.instrument, unit: r.unit ?? null, heading: r.heading ?? null, zone: r.zone ?? null, lots: Number(r.lots) })) }
  return { samples: cache.rows }
})
