/**
 * Instrument dates, read in the zone the instrument has effect in.
 *
 * `nsw.document.as_at_date` is a Postgres DATE: a calendar day, with no time
 * and no zone. node-postgres parses it into a JS Date at the *server process's*
 * local midnight, so on a box running Australia/Sydney the DATE 2026-04-07
 * arrives as the instant 2026-04-06T14:00:00Z. The report then did
 *
 *     new Date(d.as_at_date).toISOString().slice(0, 10)
 *
 * which reads the UTC calendar day off that instant and prints 2026-04-06 —
 * every date on the report one day early.
 *
 * The proof it was a formatting fault and not bad data: both LEPs carry a
 * `source_url` ending `/inforce/2026-04-07`, the consolidation date the NSW
 * legislation register itself names, while the report displayed 2026-04-06.
 *
 * NSW planning instruments are made, amended, commenced and consolidated on
 * Sydney calendar days. Australia/Sydney is therefore the only zone in which
 * these values are the dates the source authority stated — not UTC, and not
 * whatever zone the reader's browser happens to be in.
 */

export const INSTRUMENT_TZ = 'Australia/Sydney'

/**
 * A bare calendar day, optionally carrying a midnight time that is an artefact
 * of how it was stored rather than a real instant:
 *
 *   "2026-07-27"               a DATE cast to text by Postgres
 *   "2023-04-26 00:00:00"      up_property_d_3.historic_commenced_date
 *   "2025-06-23T00:00:00.000Z"
 *
 * These carry no instant to reinterpret, so they pass through untouched.
 * Putting them through a Date and back out is exactly what lost the day.
 */
const CALENDAR_DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]00:00:00(?:\.0+)?Z?)?$/

/** Epoch milliseconds as a string — the shape `lep_currency_date` arrives in. */
const EPOCH_MS = /^\d{12,14}$/

function toInstant(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return Number.isNaN(v) ? null : new Date(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  // "2023-04-26 00:00:00" is not ISO-8601, and browsers parse it as local time
  // while Node parses it as UTC. Making it ISO first means both agree.
  const d = new Date(EPOCH_MS.test(s) ? Number(s) : s.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

function sydneyParts(d: Date): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-AU', {
    timeZone: INSTRUMENT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)) out[p.type] = p.value
  return out
}

/**
 * YYYY-MM-DD as the day reads in Sydney. Null for anything unparseable, so a
 * missing date stays visibly missing rather than quietly becoming today.
 */
export function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    const bare = v.trim().match(CALENDAR_DAY)
    if (bare) return bare[1]!
  }
  const d = toInstant(v)
  if (!d) return null
  const p = sydneyParts(d)
  return p.year && p.month && p.day ? `${p.year}-${p.month}-${p.day}` : null
}

/**
 * "23 Jun 2025" — the same day `isoDate` gives, written for a reader. Falls
 * back to the input's own text so an unrecognised value is shown rather than
 * swallowed.
 */
export function formatDay(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback
  const iso = isoDate(v)
  if (!iso) return String(v)
  const [y, m, day] = iso.split('-').map(Number) as [number, number, number]
  // Noon UTC: far enough from either boundary that the Sydney day is the day
  // just computed, whatever zone the host itself is running in.
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: INSTRUMENT_TZ, day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, day, 12)))
}
