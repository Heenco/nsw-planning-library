/**
 * The boundary of one parcel, validated, for the 3D envelope and the design
 * brief.
 *
 * No parcel polygon is stored in the property table - `buffered_geom` is an
 * inward buffer whose area runs ~15% under the recorded `area_sqm`. The Martin
 * `lot` tiles have the real boundary, and cadastre-tiles.ts reads them on the
 * server; this is the thin layer over that which callers building a model
 * want: one ring, already checked against the recorded area and perimeter,
 * with a reason in words when there is none.
 *
 * This used to query SIX Maps by `lotidstring`. Why the app no longer relies
 * on SIX is set out in cadastre-tiles.ts; the validation is unchanged, because
 * it is what stops an envelope being built on the wrong parcel whatever the
 * source: `wholeRingFor` refuses a ring whose area or perimeter is more than
 * 5% off the record, which is also how a clipped tile fragment is rejected.
 *
 * `recorded` lets a caller that already holds the row pass its figures; when
 * it does not, the property table is asked, which also supplies the location
 * the tiles are addressed by.
 */

import { locateLot, lotRingById } from './cadastre-tiles'

/**
 * Process-local cache.
 *
 * A parcel boundary does not change between requests, and the report and the
 * viewer can ask for the same lot in quick succession. Bounded so a long-lived
 * server cannot grow without limit; `null` results are cached too, so a lot
 * that cannot be resolved is not retried on every request.
 */
const cache = new Map<string, { ring: [number, number][] | null, reason?: string }>()
const CACHE_MAX = 500

export interface LotRingResult {
  ring: [number, number][] | null
  /** Why the boundary was rejected, for the model's own provenance note. */
  reason?: string
}

/**
 * The outer ring of one parcel, as [lng, lat] pairs, or null.
 *
 * `recorded` is used only to validate - never to correct. A boundary that
 * disagrees with it is discarded, because the alternative is a 3D envelope
 * built on the wrong parcel.
 */
export async function fetchLotRing(
  lotIdString: string,
  recorded: { area?: number | null; perimeter?: number | null } = {},
): Promise<LotRingResult> {
  const id = String(lotIdString ?? '').trim().toUpperCase()
  if (!id) return { ring: null, reason: 'no lot/plan identifier on the property record' }

  const hit = cache.get(id)
  if (hit) return hit.ring ? { ring: hit.ring } : { ring: null, reason: hit.reason ?? 'boundary previously unavailable for this lot' }

  let result: LotRingResult
  try {
    const rec = await locateLot(id)
    if (!rec) {
      result = { ring: null, reason: 'the property table has no row for this lot/plan, so nothing locates it in the cadastre' }
    } else {
      result = await lotRingById(id, {
        ...rec,
        area: Number(recorded.area) > 0 ? Number(recorded.area) : rec.area,
        perimeter: Number(recorded.perimeter) > 0 ? Number(recorded.perimeter) : rec.perimeter,
      })
    }
  } catch (err: any) {
    result = {
      ring: null,
      reason: err?.name === 'TimeoutError'
        ? 'the cadastre tile server timed out'
        : `the cadastre could not be read (${String(err?.message ?? err).slice(0, 60)})`,
    }
  }

  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(id, result)
  return result
}
