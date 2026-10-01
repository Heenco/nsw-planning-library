/**
 * Build-to-rent (Housing SEPP s 72) and the in-fill affordable housing bonus (s 15C) for one lot, as pure
 * functions over facts /api/housing/at has already read.
 *
 * Three answers, never two: true, false, or null where the data cannot decide - a missing layer is ours to
 * fix, not a reason to call a lot clear or excluded. Every limb carries the clause it reads and a sentence
 * saying why, so the panel shows the reasoning rather than a bare yes.
 *
 * The clause text these follow is on /build-to-rent and /affordable-housing (shared/build-to-rent.ts,
 * shared/affordable-housing.ts); the Six Cities list is the EP&A Act, Schedule 9, as in force from
 * 1 November 2025.
 */

export type Tri = boolean | null

export interface Limb {
  clause: string
  label: string
  pass: Tri
  why: string
  /** Shown, but not counted: a limb no data can ever decide (a site compatibility certificate). */
  informational?: boolean
}

export interface Allowance { label: string; value: string; clause: string }

export interface HousingVerdict {
  eligible: Tri
  headline: string
  /** The routes in (s 72(2)) or the tests that must all hold (s 15C(1)). */
  limbs: Limb[]
  exclusions: Limb[]
  /** What it then gives (bonus FSR / height), where the land has the base control. */
  allowances: Allowance[]
  /** Conditions on the proposal a lot cannot answer. */
  flags: string[]
}

// ── the facts ────────────────────────────────────────────────────────────────────────────────────

export interface PermRow { epi: string; zone: string; landUse: string; status: string }

/** One Chapter 6 type, reduced to "is the use permissible under Chapter 6 on this lot". */
export interface Ch6Type { key: string; name: string; permissible: Tri; why: string }

export interface HousingFacts {
  cadid: string
  lotId: string | null
  lga: string | null
  areaM2: number | null
  zones: string[]
  perm: PermRow[]
  tod: string[]
  accelerated: string[]
  /** Labels on the State Significant Development Sites Map that the lot touches. */
  ssd: string[]
  sydneyOlympicPark: boolean
  fsr: number[]
  heightM: number[]
  trainIso: string[]
  busIso: { n: number; names: string[]; fallback: number }
  /** Straight-line distance to the nearest E1/E2/MU1/B1/B2/B4 polygon within ~1 km, metres. 0 = on it. */
  relevantZone: { zone: string; distanceM: number } | null
  ch6: Ch6Type[]
  /** The LMR band and what it was measured from, for the panel. */
  lmrBand: string | null
}

// ── the Six Cities Region, EP&A Act Schedule 9 (in force 1 Nov 2025), in derived.lot_lga's spelling ──

export const SIX_CITIES: Record<string, string[]> = {
  'Eastern Harbour City': ['BAYSIDE', 'BURWOOD', 'CANADA BAY', 'HORNSBY', 'HUNTERS HILL', 'INNER WEST', 'KU-RING-GAI',
    'LANE COVE', 'MOSMAN', 'NORTH SYDNEY', 'NORTHERN BEACHES', 'RANDWICK', 'RYDE', 'STRATHFIELD', 'SUTHERLAND SHIRE',
    'SYDNEY', 'WAVERLEY', 'WILLOUGHBY', 'WOOLLAHRA'],
  'Central River City': ['BLACKTOWN', 'CANTERBURY-BANKSTOWN', 'CUMBERLAND', 'GEORGES RIVER', 'CITY OF PARRAMATTA',
    'THE HILLS SHIRE'],
  'Lower Hunter and Greater Newcastle City': ['CESSNOCK', 'LAKE MACQUARIE', 'MAITLAND', 'NEWCASTLE', 'PORT STEPHENS'],
  'Western Parkland City': ['BLUE MOUNTAINS', 'CAMDEN', 'CAMPBELLTOWN', 'FAIRFIELD', 'HAWKESBURY', 'LIVERPOOL',
    'PENRITH', 'WOLLONDILLY'],
  'Central Coast City': ['CENTRAL COAST'],
  'Illawarra-Shoalhaven City': ['KIAMA', 'SHELLHARBOUR', 'SHOALHAVEN', 'WOLLONGONG'],
}
export const SIX_CITIES_SOURCE = 'Environmental Planning and Assessment Act 1979, Schedule 9 (version in force from 1 November 2025)'

export function sixCityOf(lga: string | null): string | null {
  if (!lga) return null
  const u = lga.toUpperCase()
  for (const [city, lgas] of Object.entries(SIX_CITIES)) if (lgas.includes(u)) return city
  return null
}

// ── vocabulary ───────────────────────────────────────────────────────────────────────────────────

const BTR_ZONES = ['E2', 'MU1', 'B3', 'B4', 'B8', 'SP5']
/** s 151: relevant residential zones; RFBs are permitted in them in a TOD area by s 154(1)(a). */
const TOD_RFB_ZONES = ['R1', 'R2', 'R3', 'R4', 'E1']
/** s 15C(3). */
export const RELEVANT_ZONES = ['E1', 'E2', 'MU1', 'B1', 'B2', 'B4']
/** s 15B(1): "residential development", in the Land Use Tables' own terms. Manor houses are not an SI term. */
export const RESIDENTIAL_DEVELOPMENT = ['attached dwellings', 'dual occupancies', 'dual occupancies (attached)',
  'dual occupancies (detached)', 'dwelling houses', 'multi dwelling housing', 'multi dwelling housing (terraces)',
  'residential flat buildings', 'semi-detached dwellings', 'shop top housing']
const BTR_CH6_TYPES = ['multi-dwelling-housing', 'multi-dwelling-terraces', 'rfb-shop-top-r1-r2', 'rfb-shop-top-r3-r4']
const BUSINESS_ZONES = ['E1', 'E2', 'E3', 'MU1', 'SP5', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']

const list = (xs: string[], n = 3) => xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} and ${xs.length - n} more`
const PERMITTED = new Set(['permitted_with_consent', 'permitted_without_consent'])

/** Is any of these uses permitted in any of the lot's zones under its LEP? */
function lepPermits(f: HousingFacts, uses: string[]): { pass: Tri; why: string } {
  const want = new Set(uses.map(u => u.toLowerCase()))
  const rows = f.perm.filter(p => want.has(p.landUse.toLowerCase()))
  const yes = rows.filter(p => PERMITTED.has(p.status))
  if (yes.length) {
    const r = yes[0]!
    return { pass: true, why: `${r.landUse} ${r.status === 'permitted_with_consent' ? 'permitted with consent' : 'permitted without consent'} in ${r.zone} under ${r.epi}` }
  }
  if (!f.zones.length) return { pass: null, why: 'no zone recorded for the lot' }
  if (!rows.length) return { pass: null, why: `no Land Use Table row for ${uses[0]} in ${f.zones.join(', ')}` }
  const mixed = rows.find(p => p.status === 'mixed')
  if (mixed) return { pass: null, why: `${mixed.landUse} is permitted in only part of ${mixed.zone} under ${mixed.epi}` }
  return { pass: false, why: `${uses.length > 2 ? 'none of the nine forms is' : `${rows[0]!.landUse} are`} prohibited in ${f.zones.join(', ')} under ${rows[0]!.epi}` }
}

function anyOf(limbs: Limb[]): Tri {
  const counted = limbs.filter(l => !l.informational)
  if (counted.some(l => l.pass === true)) return true
  if (counted.some(l => l.pass === null)) return null
  return false
}

// ── build-to-rent, s 72 ──────────────────────────────────────────────────────────────────────────

export function evaluateBtr(f: HousingFacts): HousingVerdict {
  const zoneHit = f.zones.filter(z => BTR_ZONES.includes(z))
  const rfb = lepPermits(f, ['residential flat buildings'])
  const todRfbZones = f.zones.filter(z => TOD_RFB_ZONES.includes(z)
    || (z === 'B2' && f.lga === 'CANTERBURY-BANKSTOWN'))
  const ch6 = f.ch6.filter(t => BTR_CH6_TYPES.includes(t.key))
  const ch6Yes = ch6.filter(t => t.permissible === true)
  const ch6Unknown = ch6.filter(t => t.permissible === null)
  const dive = f.ssd.includes('WestConnex Dive Site')

  const limbs: Limb[] = [
    {
      clause: '72(2)(a)(ia)–(v)', label: 'Zone E2, MU1, B3, B4, B8 or SP5',
      pass: zoneHit.length ? true : f.zones.length ? false : null,
      why: zoneHit.length ? `In ${zoneHit.join(', ')} - the zone is enough, whatever the LEP permits.`
        : f.zones.length ? `Zoned ${f.zones.join(', ')}.` : 'No zone recorded for the lot.',
    },
    {
      clause: '72(2)(a)(i)', label: 'Residential flat buildings permissible under another plan',
      pass: rfb.pass, why: rfb.pass === true ? `Yes: ${rfb.why}.` : `${rfb.why[0]!.toUpperCase()}${rfb.why.slice(1)}.`,
    },
    {
      clause: '72(2)(a1)', label: 'TOD area where residential flat buildings are permissible',
      pass: !f.tod.length ? false : (todRfbZones.length || rfb.pass === true) ? true : rfb.pass === null ? null : false,
      why: !f.tod.length ? 'Not in a Transport Oriented Development Area.'
        : todRfbZones.length ? `In the ${list(f.tod)} TOD area, zoned ${todRfbZones.join(', ')}: s 154 permits residential flat buildings there.`
          : rfb.pass === true ? `In the ${list(f.tod)} TOD area, and the LEP permits residential flat buildings.`
            : `In the ${list(f.tod)} TOD area, but zoned ${f.zones.join(', ') || 'unknown'}, where neither s 154 nor the LEP permits them.`,
    },
    {
      clause: '72(2)(a2)', label: 'MDH, RFB or shop top housing permissible under Chapter 6',
      pass: ch6Yes.length ? true : ch6Unknown.length ? null : false,
      why: ch6Yes.length ? `${list(ch6Yes.map(t => t.name), 2)} permissible under Chapter 6${f.lmrBand ? ` (${f.lmrBand})` : ''}.`
        : ch6Unknown.length ? `Cannot decide: ${ch6Unknown[0]!.why}`
          : ch6[0]?.why ?? 'Chapter 6 does not reach the lot.',
    },
    {
      clause: '72(2)(c)', label: 'The WestConnex Dive Site',
      pass: dive, why: dive ? 'On the WestConnex Dive Site (State Significant Development Sites Map).' : 'Not on it.',
    },
    {
      clause: '72(2)(b)', label: 'A site compatibility certificate (s 39)', pass: null, informational: true,
      why: 'Issued site by site; no register is published as data. Any lot can qualify this way if a certificate is issued.',
    },
  ]

  const eligible = anyOf(limbs)
  const via = limbs.filter(l => l.pass === true && !l.informational)
  const flags = [
    `s 72(3): at least 50 dwellings under residential tenancy agreements, all on the same lot${f.areaM2 ? ` - this lot is ${Math.round(f.areaM2).toLocaleString()} m²` : ''}.`,
    f.zones.some(z => ['E2', 'B3', 'SP5'].includes(z))
      ? 's 73(3)(a): in E2, B3 or SP5 the building must stay build-to-rent in perpetuity (one owner, no strata, one manager).'
      : 's 73: one owner, no strata subdivision and one on-site manager for 15 years from the occupation certificate.',
    ...(f.zones.some(z => BUSINESS_ZONES.includes(z)) ? ['s 76: in a business zone the building needs an active street frontage.'] : []),
  ]
  const headline = eligible === true
    ? `Build-to-rent is permitted with consent here, through s ${via.map(l => l.clause).join(' and s ')}.`
    : eligible === false
      ? 'None of the s 72(2) routes reaches this lot (unless a site compatibility certificate is issued).'
      : 'Cannot be decided from the data: ' + limbs.filter(l => l.pass === null && !l.informational).map(l => `s ${l.clause}`).join(', ') + ' is open.'

  return {
    eligible, headline, limbs, exclusions: [], flags,
    allowances: [
      ...(f.heightM.length ? [{ label: 'Height (no bonus)', value: `${Math.max(...f.heightM)} m`, clause: '74(2)(a)' }] : []),
      ...(f.fsr.length ? [{ label: 'FSR (no bonus)', value: `${Math.max(...f.fsr)}:1`, clause: '74(2)(b)–(c)' }] : []),
    ],
  }
}

// ── the in-fill affordable housing bonus, s 15C ──────────────────────────────────────────────────

export function evaluateAhb(f: HousingFacts, btr: HousingVerdict): HousingVerdict {
  // (a) permitted with consent: the LEP, build-to-rent, Chapter 5 or Chapter 6
  const lep = lepPermits(f, RESIDENTIAL_DEVELOPMENT)
  const todPermits = f.tod.length > 0 && f.zones.some(z => TOD_RFB_ZONES.includes(z) || ['E2'].includes(z)
    || (z === 'B2' && f.lga === 'CANTERBURY-BANKSTOWN'))
  const ch6Yes = f.ch6.filter(t => t.permissible === true)
  const ch6Unknown = f.ch6.filter(t => t.permissible === null)
  const routes: string[] = []
  if (lep.pass === true) routes.push(`the LEP (${lep.why})`)
  if (btr.eligible === true) routes.push('build-to-rent, Chapter 3 Part 4')
  if (todPermits) routes.push(`Chapter 5, the ${list(f.tod, 1)} TOD area`)
  if (ch6Yes.length) routes.push(`Chapter 6 (${list(ch6Yes.map(t => t.name), 2)})`)
  const permitted: Tri = routes.length ? true
    : (lep.pass === null || btr.eligible === null || ch6Unknown.length) ? null : false

  // (c) location: the test depends on the region
  const city = sixCityOf(f.lga)
  const carvedOut = f.lga === 'SHOALHAVEN' || f.lga === 'PORT STEPHENS'
  let location: Limb
  if (!f.lga) {
    location = { clause: '15C(1)(c)', label: 'Location', pass: null, why: 'The lot\'s council is not recorded, so which location test applies is not known.' }
  } else if (city && !carvedOut) {
    location = f.trainIso.length
      ? { clause: '15C(1)(c)(i)', label: 'In an accessible area (Six Cities)', pass: true,
          why: `${city}. Within 800 m walking of ${list(f.trainIso)}.` }
      : f.busIso.n
        // the walking isochrones are taken as decided (Manni, 2026-10-01): a bus catchment counts as accessible
        // without the hourly-service test
        ? { clause: '15C(1)(c)(i)', label: 'In an accessible area (Six Cities)', pass: true,
            why: `${city}. Within 400 m walking of ${f.busIso.n} bus stop${f.busIso.n > 1 ? 's' : ''} (${list(f.busIso.names, 2)}).` }
        : { clause: '15C(1)(c)(i)', label: 'In an accessible area (Six Cities)', pass: false,
            why: `${city}. Outside every station and bus stop walking catchment we hold (Sydney Ferries wharves are not held).` }
  } else {
    const rz = f.relevantZone
    const where = city ? `${f.lga} is carved out of the Six Cities test` : `${f.lga} is outside the Six Cities Region`
    location = !rz
      ? { clause: '15C(1)(c)(ii)', label: 'Within 800 m walking of E1, E2, MU1, B1, B2 or B4', pass: false,
          why: `${where}. No centre zone within 1 km in a straight line, so none within 800 m walking.` }
      : rz.distanceM === 0
        ? { clause: '15C(1)(c)(ii)', label: 'Within 800 m walking of E1, E2, MU1, B1, B2 or B4', pass: true,
            why: `${where}. The lot is itself in ${rz.zone}.` }
        : rz.distanceM > 800
          ? { clause: '15C(1)(c)(ii)', label: 'Within 800 m walking of E1, E2, MU1, B1, B2 or B4', pass: false,
              why: `${where}. The nearest ${rz.zone} is ${Math.round(rz.distanceM)} m away in a straight line, so further on foot.` }
          : { clause: '15C(1)(c)(ii)', label: 'Within 800 m walking of E1, E2, MU1, B1, B2 or B4', pass: null,
              why: `${where}. ${rz.zone} is ${Math.round(rz.distanceM)} m away in a straight line; the walking distance is not yet measured.` }
  }

  const limbs: Limb[] = [
    { clause: '15C(1)(a)', label: 'Residential development permitted with consent', pass: permitted,
      why: permitted === true ? `Through ${routes.join('; ')}.`
        : permitted === false ? `${lep.why[0]!.toUpperCase()}${lep.why.slice(1)}, and no SEPP route reaches the lot.`
          : `Cannot decide: ${lep.pass === null ? lep.why : ch6Unknown[0]?.why ?? 'build-to-rent is undecided'}.` },
    location,
    { clause: '15C(1)(b)', label: 'At least 10% affordable housing', pass: null, informational: true,
      why: 'A choice of the proposal: at least 10% of the gross floor area kept affordable for 15 years.' },
  ]

  const ssd = (name: string) => f.ssd.includes(name)
  const exclusions: Limb[] = [
    { clause: '15C(2A)(a)', label: 'Accelerated TOD Precinct', pass: f.accelerated.length > 0,
      why: f.accelerated.length ? `In the ${list(f.accelerated)} precinct.` : 'Not in one.' },
    { clause: '15C(2A)(b)', label: 'Warrawong Site', pass: ssd('Warrawong Site'), why: ssd('Warrawong Site') ? 'On it.' : 'Not on it.' },
    { clause: '15C(2A)(c)', label: 'Kanwal Site', pass: ssd('Kanwal Site'), why: ssd('Kanwal Site') ? 'On it.' : 'Not on it.' },
    { clause: '15C(2A)', label: 'Sydney Olympic Park (wording not yet read)', pass: f.sydneyOlympicPark,
      why: f.sydneyOlympicPark ? 'In the Sydney Olympic Park land application area.' : 'Not in it.' },
  ]
  const excludedBy = exclusions.filter(e => e.pass === true)

  const counted = limbs.filter(l => !l.informational)
  const eligible: Tri = excludedBy.length ? false
    : counted.some(l => l.pass === false) ? false
      : counted.every(l => l.pass === true) ? true : null

  const fsr = f.fsr.length ? Math.max(...f.fsr) : null
  const hob = f.heightM.length ? Math.max(...f.heightM) : null
  const allowances: Allowance[] = eligible === false ? [] : [
    fsr != null
      ? { label: 'FSR', value: `${fsr}:1 → up to ${+(fsr * 1.3).toFixed(2)}:1`, clause: '16(1)' }
      : { label: 'FSR', value: 'no maximum FSR on this land, so no FSR bonus', clause: '16(4)' },
    ...(hob != null ? [{ label: 'Height (RFB / shop top)', value: `${hob} m → up to ${+(hob * 1.3).toFixed(1)} m`, clause: fsr != null ? '16(3)' : '18' }] : []),
  ]

  const headline = excludedBy.length
    ? `Excluded by s ${excludedBy.map(e => e.clause).join(', s ')}.`
    : eligible === true
      ? 'The bonus is available here for development with at least 10% affordable housing.'
      : eligible === false
        ? `Not available: fails s ${counted.filter(l => l.pass === false).map(l => l.clause).join(' and s ')}.`
        : `Cannot be decided yet: s ${counted.filter(l => l.pass === null).map(l => l.clause).join(' and s ')} is open.`

  return {
    eligible, headline, limbs, exclusions, allowances,
    flags: [
      's 15C(1)(b), 21: at least 10% of the floor area affordable, managed by a registered community housing provider for 15 years.',
      's 15C(2A)(d): not for complying development under the Codes SEPP Parts 3B or 3BA (unless by or for LAHC).',
      ...(f.areaM2 != null && f.areaM2 < 450 ? [`s 19(2)(a): ${Math.round(f.areaM2)} m² is under the 450 m² non-discretionary site area - consent is still possible.`] : []),
      's 12A: stacked with another SEPP bonus, the total FSR is capped at 130% of the base.',
    ],
  }
}
