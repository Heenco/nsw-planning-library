/**
 * Pick the addresses the /prop-width test sheet is built from.
 *
 * Chosen rather than sampled. A random 30 would be ~28 ordinary single-frontage
 * lots, which tells you almost nothing: the page already handles those, and the
 * cases worth looking at by eye are the ones that stress the frontage matcher —
 * corner lots with two roads, lots with three or more, battle-axes whose
 * frontage is a handle, strata plans where many addresses share one parcel,
 * unnamed roads, and the extremes of frontage width.
 *
 * Each bucket carries the reason it is in the sheet, so a reviewer knows what
 * they are meant to be checking in that row.
 *
 * Both councils in the table are represented, because the DCP pipeline and the
 * data differ between them.
 */

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

/**
 * Lots too small or too odd to be a meaningful visual test.
 *
 * The address must start with a street number. /api/address-autocomplete ranks
 * on the street number and falls back to alphabetical order without one, so a
 * numberless address like "ALEXANDRIA PARADE WAHROONGA" resolves to whichever
 * lot on that street sorts first — the sheet then screenshots a different lot
 * from the one it describes. That is a property of the lookup, not of this
 * page, so the fix is to test with addresses that identify one lot.
 */
const SANE = `
  address IS NOT NULL AND address ~ '^[0-9]'
  AND centroid_lat IS NOT NULL AND centroid_lon IS NOT NULL
  AND area_sqm > 40
`

/**
 * One query per bucket. `weight` is its share of the sheet, not a row count —
 * quotas are scaled to whatever length is asked for, so --limit 50 widens every
 * bucket instead of running out of buckets at 30.
 *
 * Ordered by `md5(propid)` — deterministic, so a rerun produces the same sheet
 * and two runs can be compared, but spread across the table rather than
 * clustered. Plain `ORDER BY address` looked reproducible and was: it returned
 * thirty addresses all beginning "100", because that is what sorts first.
 */
const BUCKETS = [
  {
    name: 'Single frontage',
    why: 'The ordinary case: one road, one boundary run.',
    weight: 5,
    sql: `${SANE} AND propertyfrontagecount = '1' AND primary_frontage_road IS NOT NULL
          AND is_corner_lot = false AND is_battleaxe = false
          AND primary_frontage_length_m BETWEEN 10 AND 25`,
  },
  {
    name: 'Corner lot',
    why: 'Two frontages on two roads — both should be drawn and named.',
    weight: 5,
    sql: `${SANE} AND is_corner_lot = true AND propertyfrontagecount = '2'
          AND all_frontages IS NOT NULL`,
  },
  {
    name: 'Three to five frontages',
    why: 'Stresses the run matcher: several frontages competing for edges.',
    weight: 4,
    sql: `${SANE} AND propertyfrontagecount IN ('3','4','5')
          AND all_frontages IS NOT NULL`,
  },
  {
    name: 'Six or more frontages',
    why: 'The extreme: every frontage must find its own stretch of boundary.',
    weight: 3,
    sql: `${SANE} AND propertyfrontagecount ~ '^[0-9]+$'
          AND propertyfrontagecount::int >= 6 AND all_frontages IS NOT NULL`,
  },
  {
    name: 'Many boundary edges',
    why: 'A boundary split into a dozen-plus edges, so most runs are multi-edge.',
    weight: 3,
    sql: `${SANE} AND corners_count >= 12 AND primary_frontage_road IS NOT NULL`,
  },
  {
    name: 'Battle-axe',
    why: 'Frontage is the access handle, not the building envelope.',
    weight: 3,
    sql: `${SANE} AND is_battleaxe = true AND primary_frontage_road IS NOT NULL`,
  },
  {
    name: 'Strata plan',
    why: 'Many addresses on one parcel — the panel should list them all.',
    weight: 3,
    sql: `${SANE} AND lot_section_plan LIKE '//SP%' AND primary_frontage_road IS NOT NULL`,
  },
  {
    name: 'Narrow frontage',
    why: 'Under 8 m — the label has to stay legible on a short edge.',
    weight: 3,
    sql: `${SANE} AND primary_frontage_length_m > 0 AND primary_frontage_length_m < 8
          AND primary_frontage_road IS NOT NULL`,
  },
  {
    name: 'Wide frontage',
    why: 'Over 60 m — usually several edges summed into one run.',
    weight: 3,
    sql: `${SANE} AND primary_frontage_length_m > 60 AND primary_frontage_road IS NOT NULL`,
  },
  {
    name: 'Large lot',
    why: 'Over 5,000 m² — the lot can outrun the viewport at the zoom used.',
    weight: 3,
    sql: `${SANE} AND area_sqm > 5000 AND primary_frontage_road IS NOT NULL`,
  },
  {
    name: 'Unnamed road',
    why: 'Frontage onto a road with no name; should read "Unnamed road".',
    weight: 2,
    sql: `${SANE} AND all_frontages ILIKE '%unnamed%'`,
  },
  {
    name: 'No frontage recorded',
    why: 'Nothing to draw — the panel must say so rather than look broken.',
    weight: 2,
    sql: `${SANE} AND (propertyfrontagecount = '0' OR primary_frontage_road IS NULL)`,
  },
]

/**
 * Split `limit` rows across the buckets in proportion to their weights.
 *
 * Largest-remainder, so the quotas always sum to exactly `limit` rather than
 * landing a row or two short after rounding.
 */
function quotas(limit) {
  const total = BUCKETS.reduce((s, b) => s + b.weight, 0)
  const exact = BUCKETS.map(b => (b.weight * limit) / total)
  const out = exact.map(Math.floor)
  const order = exact
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  let short = limit - out.reduce((a, b) => a + b, 0)
  for (let k = 0; short > 0; k++, short--) out[order[k % order.length].i]++
  return out
}

const COLUMNS = `
  propid, address, lga_name, suburbname, lot_section_plan,
  propertyfrontagecount, primary_frontage_road, primary_frontage_length_m,
  all_frontages, all_edges_measurements, area_sqm, perimeter_m,
  lot_depth_m, is_corner_lot, is_battleaxe, centroid_lat, centroid_lon
`

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = Object.fromEntries(
    fs.readFileSync('.env', 'utf8').split(/\r?\n/)
      .filter(l => /^[A-Z][A-Z0-9_]*=/.test(l))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
  )
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set, and .env has none')
  return env.DATABASE_URL
}

/**
 * `limit` addresses, spread across the buckets.
 *
 * Buckets are filled in order and each is split between the two councils where
 * it can be, so no bucket ends up being entirely one LGA. A bucket that cannot
 * fill its quota gives its remainder back to the ones that follow, so the sheet
 * still comes out the requested length.
 */
export async function pickAddresses(limit = 30, { withMeta = false } = {}) {
  const client = new pg.Client({ connectionString: connectionString() })
  await client.connect()

  const picked = []
  // Keyed on the lot, not the address: a strata plan has one parcel and dozens
  // of addresses, and two rows drawing the identical boundary waste a row of
  // the sheet.
  const seen = new Set()
  const want = quotas(limit)

  /** Take up to `n` more from this bucket's queue, alternating councils. */
  const drawFrom = (pools, bucket, n) => {
    let taken = 0
    for (let i = 0; taken < n && pools.some(p => p.length); i++) {
      const row = pools[i % pools.length].shift()
      if (!row) continue
      const key = row.lot_section_plan || row.address
      if (seen.has(key)) continue
      seen.add(key)
      picked.push({ ...row, bucket: bucket.name, why: bucket.why })
      taken++
    }
    return taken
  }

  try {
    const queues = []
    for (const [b, bucket] of BUCKETS.entries()) {
      // `address` breaks the tie, and has to: the table holds duplicate rows
      // for a propid, so ORDER BY lot_section_plan, propid leaves DISTINCT ON
      // choosing arbitrarily between them. Two calls then returned different
      // strata addresses for the same lot, and the sheet's metadata no longer
      // matched the run it was describing.
      const { rows } = await client.query(
        `SELECT ${COLUMNS} FROM (
           SELECT DISTINCT ON (lot_section_plan) ${COLUMNS}
             FROM nsw.up_property_d_3
            WHERE ${bucket.sql}
            ORDER BY lot_section_plan, propid, address
         ) one_per_lot
         ORDER BY md5(propid::text), address
         LIMIT 600`,
      )

      // Interleave the councils rather than taking the first N of one.
      const byLga = new Map()
      for (const r of rows) {
        const k = r.lga_name || '?'
        if (!byLga.has(k)) byLga.set(k, [])
        byLga.get(k).push(r)
      }
      const pools = [...byLga.values()]
      queues.push({ bucket, pools })
      drawFrom(pools, bucket, Math.min(want[b], limit - picked.length))
    }

    // A bucket the table cannot fill — there may be no lot with six frontages
    // in one council — would otherwise shorten the sheet. Redistribute its
    // shortfall over the buckets that still have rows, a row at a time so the
    // spread stays even rather than the first bucket absorbing all of it.
    let guard = 0
    while (picked.length < limit && guard++ < limit * 2) {
      const before = picked.length
      for (const { bucket, pools } of queues) {
        if (picked.length >= limit) break
        drawFrom(pools, bucket, 1)
      }
      if (picked.length === before) break   // nothing left anywhere
    }
  } finally {
    await client.end()
  }

  return withMeta ? picked : picked.map(r => r.address)
}

// pathToFileURL, not string surgery: this repo's path contains spaces, which
// import.meta.url percent-encodes and a hand-built file:// URL does not, so the
// naive comparison is always false on Windows and the script silently no-ops.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = await pickAddresses(Number(process.argv[2] || 30), { withMeta: true })
  console.log(`${rows.length} addresses\n`)
  for (const r of rows) {
    console.log(`${r.bucket.padEnd(26)} ${r.lga_name.padEnd(9)} ${r.address}`)
    console.log(`${''.padEnd(26)} ${''.padEnd(9)} frontages=${r.propertyfrontagecount} · ${r.all_frontages ?? '—'}`)
  }
}
