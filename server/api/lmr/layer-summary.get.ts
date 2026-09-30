/**
 * The LMR layer in numbers - lmr.lot_lmr, built by scripts/build-lmr-lots.ts - and how it compares with the
 * earlier 05_lmr result (nsw.up_property_d_4.in_lmr_housing_area).
 *
 *   GET /api/lmr/layer-summary
 *
 * What /lmr's "The layer" tab reads: how many residential lots the catchments reach and what Chapter 6 does
 * to them, which s 164 clauses take lots out, what each lot is eligible for, and - lot by lot - where this
 * build and 05_lmr disagree, with why. Cached for five minutes: the layer changes when the build runs.
 */
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface LmrLayerSummary {
  builtAt: string | null
  totals: { in: number; excluded: number; undecided: number; all: number }
  byBand: { band: string; in: number; excluded: number; undecided: number }[]
  excludedBy: { clause: string; lots: number }[]
  undecidedBy: { clause: string; lots: number }[]
  eligible: { type: string; lots: number; undecided: number }[]
  compare: {
    both: number
    oursOnly: number
    excludedButIn05: number
    undecidedButIn05: number
    theirsOnly: { why: string; lots: number }[]
  }
  byLga: { lga: string; in: number; excluded: number; undecided: number; in05: number; only05: number }[]
}

const CACHE_MS = 5 * 60 * 1000
let cached: { at: number; value: LmrLayerSummary } | null = null

export default defineEventHandler(async (event): Promise<LmrLayerSummary> => {
  setHeader(event, 'cache-control', 'public, max-age=300')
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

  const exists = await nswQuery<any>(`SELECT to_regclass('lmr.lot_lmr') IS NOT NULL AS ok`)
  if (!exists.rows[0]?.ok) throw createError({ statusCode: 404, statusMessage: 'The LMR layer has not been built yet (scripts/build-lmr-lots.ts)' })

  const [tot, band, exc, und, elig, cmp, only, lga] = await Promise.all([
    nswQuery<any>(`SELECT count(*) FILTER (WHERE class = 'in') AS "in", count(*) FILTER (WHERE class = 'excluded') AS excluded,
                          count(*) FILTER (WHERE class = 'undecided') AS undecided, count(*) AS "all", max(built_at) AS built_at
                     FROM lmr.lot_lmr`),
    nswQuery<any>(`SELECT band, count(*) FILTER (WHERE class = 'in') AS "in", count(*) FILTER (WHERE class = 'excluded') AS excluded,
                          count(*) FILTER (WHERE class = 'undecided') AS undecided FROM lmr.lot_lmr GROUP BY band ORDER BY band`),
    nswQuery<any>(`SELECT c AS clause, count(*) AS lots FROM lmr.lot_lmr, unnest(excluded_by) c GROUP BY 1 ORDER BY 2 DESC`),
    nswQuery<any>(`SELECT c AS clause, count(*) AS lots FROM lmr.lot_lmr, unnest(undecided_by) c GROUP BY 1 ORDER BY 2 DESC`),
    nswQuery<any>(`SELECT t.name AS type, t.ord,
                          (SELECT count(*) FROM lmr.lot_lmr l WHERE t.key = ANY(l.eligible_types)) AS lots,
                          (SELECT count(*) FROM lmr.lot_lmr l WHERE t.key = ANY(l.undecided_types)) AS undecided
                     FROM lmr.type t ORDER BY t.ord`),
    nswQuery<any>(`SELECT count(*) FILTER (WHERE class = 'in' AND in_05_lmr) AS both,
                          count(*) FILTER (WHERE class = 'in' AND NOT in_05_lmr) AS ours_only,
                          count(*) FILTER (WHERE class = 'excluded' AND in_05_lmr) AS excluded_but_05,
                          count(*) FILTER (WHERE class = 'undecided' AND in_05_lmr) AS undecided_but_05
                     FROM lmr.lot_lmr`),
    nswQuery<any>(`SELECT why, count(*) AS lots FROM lmr.lot_lmr_05_only GROUP BY 1 ORDER BY 2 DESC`),
    nswQuery<any>(`WITH a AS (
                     SELECT coalesce(lga, '(not recorded)') AS lga,
                            count(*) FILTER (WHERE class = 'in') AS "in", count(*) FILTER (WHERE class = 'excluded') AS excluded,
                            count(*) FILTER (WHERE class = 'undecided') AS undecided, count(*) FILTER (WHERE in_05_lmr) AS in05
                       FROM lmr.lot_lmr GROUP BY 1),
                   b AS (SELECT coalesce(lga, '(not recorded)') AS lga, count(*) AS only05 FROM lmr.lot_lmr_05_only GROUP BY 1)
                   SELECT coalesce(a.lga, b.lga) AS lga, coalesce(a."in", 0) AS "in", coalesce(a.excluded, 0) AS excluded,
                          coalesce(a.undecided, 0) AS undecided, coalesce(a.in05, 0) AS in05, coalesce(b.only05, 0) AS only05
                     FROM a FULL JOIN b USING (lga)
                    ORDER BY coalesce(a."in", 0) + coalesce(a.excluded, 0) + coalesce(a.undecided, 0) DESC`),
  ])

  const n = (v: any) => Number(v ?? 0)
  const t = tot.rows[0] ?? {}
  const c = cmp.rows[0] ?? {}
  const value: LmrLayerSummary = {
    builtAt: t.built_at ? new Date(t.built_at).toISOString() : null,
    totals: { in: n(t.in), excluded: n(t.excluded), undecided: n(t.undecided), all: n(t.all) },
    byBand: band.rows.map(r => ({ band: r.band, in: n(r.in), excluded: n(r.excluded), undecided: n(r.undecided) })),
    excludedBy: exc.rows.map(r => ({ clause: r.clause, lots: n(r.lots) })),
    undecidedBy: und.rows.map(r => ({ clause: r.clause, lots: n(r.lots) })),
    eligible: elig.rows.map(r => ({ type: r.type, lots: n(r.lots), undecided: n(r.undecided) })),
    compare: {
      both: n(c.both), oursOnly: n(c.ours_only), excludedButIn05: n(c.excluded_but_05), undecidedButIn05: n(c.undecided_but_05),
      theirsOnly: only.rows.map(r => ({ why: r.why, lots: n(r.lots) })),
    },
    byLga: lga.rows.map(r => ({ lga: r.lga, in: n(r.in), excluded: n(r.excluded), undecided: n(r.undecided), in05: n(r.in05), only05: n(r.only05) })),
  }
  cached = { at: Date.now(), value }
  return value
})
