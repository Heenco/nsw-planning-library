/**
 * The dates an instrument manifest states, and where each one came from.
 *
 * ── Why the manifest is the authority for a DCP ────────────────────────
 *
 * For an LEP or a SEPP there is a departmental answer: the NSW legislation
 * register publishes an in-force date per consolidation, which is why
 * hornsby-local-environmental-plan-2013 carries a source_url ending
 * `/inforce/2026-04-07` and why its as_at_date is exactly that day.
 *
 * For a DCP there is not. DCPs are council instruments and are not on the
 * legislation register. The department's only complete index is
 * https://www.planningportal.nsw.gov.au/DCP — see fetch-dcp-register.mjs —
 * and it publishes a title and a link, with no date field of any kind
 * (re-checked 2026-09-09). It also lags adoption by years: it still lists
 * "Hornsby DCP 2013 - 2019" and "Randwick DCP 2013 - as amended Apr 2016",
 * both superseded by the plans we hold. `up_property_d_3.dcp_plan_name`
 * repeats that same stale naming on every lot and has no currency column.
 *
 * So the authority is the instrument itself, read once and evidenced in the
 * manifest. That reading is a documented reading, not an inference: Hornsby's
 * `date_evidence.as_at` quotes the amendments table and the part footers that
 * state 23 June 2025. `basis` below carries that quote through to the row so
 * the report can attribute the date instead of asserting it.
 *
 * ── The two dates ──────────────────────────────────────────────────────
 *
 * `commenced` is when the plan began; `as_at` is the latest date the version
 * we hold is current to. They differ the moment a plan is amended, and the
 * ingest used to write `commenced` into `as_at_date` and drop `as_at` on the
 * floor. Hornsby DCP 2024 commenced 18 July 2024 and was amended three times
 * after — 26 Aug 2024, 19 May 2025, 23 June 2025 — so the report showed a
 * plan as current to a day eleven months and three amendments behind itself.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** "23 June 2025", for prose that a reader sees. */
function longDay(iso) {
  if (!ISO_DAY.test(iso || '')) return iso
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)))
}

/**
 * Resolve a manifest's date fields.
 *
 * Returns `{ asAt, commenced, basis, savingsProvision, pendingParts }`, or
 * throws with the manifest path named if neither date is present — a DCP with
 * no stated date must fail loudly rather than default to the day of the run.
 */
export function resolveManifestDates(manifest, label = 'manifest') {
  const asAtRaw = (manifest.as_at || '').trim()
  const commenced = (manifest.commenced || '').trim()

  for (const [field, v] of [['as_at', asAtRaw], ['commenced', commenced]]) {
    if (v && !ISO_DAY.test(v)) {
      throw new Error(`${label}: ${field} must be YYYY-MM-DD, got "${v}"`)
    }
  }
  if (!asAtRaw && !commenced) {
    throw new Error(
      `${label}: neither as_at nor commenced is set. nsw.document.as_at_date is `
      + 'the date the instrument is current to; there is no safe default for it.',
    )
  }

  // `as_at` where the manifest has one, else `commenced`. Never the later of
  // the two by comparison: if a manifest ever states an as_at EARLIER than its
  // commencement that is a transcription error worth surfacing, not something
  // to paper over by silently preferring the bigger number.
  const asAt = asAtRaw || commenced
  if (asAtRaw && commenced && asAtRaw < commenced) {
    throw new Error(
      `${label}: as_at (${asAtRaw}) is before commenced (${commenced}). One of `
      + 'them is wrong — a plan cannot be current to a date before it began.',
    )
  }

  const evidence = manifest.date_evidence || {}
  const quoted = (evidence.as_at || '').trim()

  const basis = asAtRaw
    ? `Last amended ${longDay(asAtRaw)}, as stated by the instrument itself`
      + `${quoted ? `: ${quoted}` : ''}. `
      + 'NSW publishes no currency date for DCPs — the Planning Portal DCP '
      + 'register carries titles only — so this is a documented reading of the '
      + 'document, recorded in its manifest.'
    : `Commenced ${longDay(commenced)}`
      + `${(evidence.commenced || '').trim() ? `: ${evidence.commenced.trim()}` : ''}. `
      + 'The manifest records no later amendment, so commencement is also the '
      + 'date this version is current to.'

  return {
    asAt,
    commenced: commenced || null,
    basis,
    savingsProvision: (manifest.savings_provision || '').trim() || null,
    pendingParts: Array.isArray(manifest.stage_3_pending) && manifest.stage_3_pending.length
      ? manifest.stage_3_pending
      : null,
  }
}
