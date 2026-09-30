/**
 * Which Pattern Book designs a lot can take, measured rather than looked up.
 *
 *   /api/pattern-book/at?cadid=123456
 *
 * /report answers this from d_4's stored flags. This recomputes it from the lot itself: the area and
 * width that "02C - Lot profile with frontage" measured, the slope that 03 measured, whether the lot is
 * a corner, and whether it sits in a transport oriented development precinct - tested against the
 * thresholds in shared/pattern-book.ts, which is the Pattern Book's own table.
 *
 * TWO PATHWAYS, TWO DIFFERENT GATES
 *
 * The 8 low-rise patterns are complying development under Codes SEPP Part 3BA, so cl 1.17A, 1.18,
 * 1.19 and 1.19A gate them - cl 3BA.3 says so in an express Note - along with the code's own cl
 * 3BA.6 exclusions and the cl 3BA.3(7) lot tests. The general prerequisites come from /api/cdc/at,
 * which carries the whole clause 3.3 ESA test with it.
 *
 * The 14 mid-rise patterns are Housing SEPP Chapter 7 and are NOT complying development: s 183
 * turns on a consent authority being satisfied, and "complying development" appears once in that
 * whole chapter, inside a borrowed definition. The Codes SEPP does not reach them. They are gated
 * on s 182's own exclusion list and on s 183 needing a TOD or LMR area.
 *
 * THE LMR AREA IS HELD, AND DECIDES THE BRANCH
 *
 * This route used to say planningai held no low and mid-rise housing area and showed every gated
 * design both ways. That was true when it was written and was overtaken by the Chapter 6 work:
 * lmr.lot_lmr classifies 232,043 lots into an inner or outer band, built by
 * scripts/build-lmr-lots.ts from the same shared/lmr-evaluate.ts that /api/lmr/types reads. The
 * band is looked up here, so the area gate is decided and only the block that governs is marked as
 * governing - the other is still returned, because the other set of numbers is a fact about the
 * design worth seeing, but it is no longer presented as half an answer.
 *
 * cl 3BA.3(8) disapplies the (7)(a) lot-size floor inside an LMR area. That is the only thing the
 * LMR area changes for the low-rise pathway; it does not switch off any Part 1 requirement.
 *
 * SLOPE IS MEASURED IN MAGNITUDE ONLY. The designs distinguish up-slope, down-slope and cross-fall;
 * derived.lot_slope carries mean/min/max gradient without direction. Each directional limit is
 * therefore tested against the lot's maximum gradient, which is the conservative reading - it can call
 * a lot short that a directional measure would pass, never the other way round - and the check says so.
 *
 * SLOPE IS A FALL IN METRES, ON BOTH SURFACES NOW
 *
 * The patterns state what the design absorbs as stairs - "up to 2.5 m front to back" - not a
 * gradient. The percentages were a workbook conversion for one assumed site length, wrong either
 * side of it by up to three times. This route now computes the fall the way /pattern-book does,
 * gradient x run, with derived.lot_profile.lot_depth_m as the run front to back and the frontage
 * as the run side to side. `slopes` stays on the data only because the notebook still writes it.
 */
import { PATTERN_DESIGNS, type PatternDesign } from '#shared/pattern-book'
import { nswQuery } from '../../utils/nsw-kg/pool'

export interface PatternCheck {
  label: string
  /** What the lot has. Null when nothing measured it. */
  actual: number | null
  required: number
  unit: string
  /** null when `actual` is null - unknown is not the same as failed. */
  pass: boolean | null
  note?: string
}

export interface PatternBlockResult {
  block: string
  checks: PatternCheck[]
  /** true only when every check passed; null when any is unknown. */
  qualifies: boolean | null
  /**
   * Whether THIS block is the one that applies to the lot.
   *
   * Both are still returned - the other set of numbers is a fact about the design worth seeing -
   * but only one governs, now that lmr.lot_lmr says which side of the line the lot is on. Before
   * the band was held, every gated design had to be shown both ways and neither was the answer.
   */
  governs: boolean
}

/** One statutory gate in front of a design: passed, failed, or not testable here. */
export interface PatternGate {
  clause: string
  what: string
  /** true = clear, false = ruled out, null = we hold nothing that answers it. */
  pass: boolean | null
  why: string
}

export interface PatternDesignResult {
  key: string
  category: string
  designer: string
  requiredUse: string
  areaLogic: string
  areaWords: string
  requiresCornerLot: boolean
  /** Settled from the TOD layer where the design's gate allows it; null when it turns on the LMR area. */
  areaGate: boolean | null
  areaGateWhy: string
  /** 'cdc' = Part 3BA complying development; 'da' = Housing SEPP Ch 7, development application. */
  pathway: string
  /** What stands in front of the dimensions: a different list for each pathway. */
  gates: PatternGate[]
  /** false when any gate failed - the dimensions then cannot make it eligible. */
  gatesClear: boolean | null
  blocks: PatternBlockResult[]
}

export interface PatternBookAtResponse {
  lot: {
    cadid: string | null
    lotId: string | null
    areaM2: number | null
    widthM: number | null
    widthBasis: string | null
    isCorner: boolean | null
    maxSlopePct: number | null
    meanSlopePct: number | null
    inTod: boolean
  }
  designs: PatternDesignResult[]
  summary: {
    /** Designs the lot clears whichever way the LMR question goes. */
    qualifiesEitherWay: number
    /** Designs it clears only inside an LMR area. */
    onlyInLmr: number
    /** Designs ruled out on measurements alone, whatever the LMR answer. */
    ruledOut: number
    /** Designs that could not be decided because something was not measured. */
    unknown: number
    total: number
  }
  /** What stopped a full answer, named rather than left as a silent null. */
  caveats: string[]
  ms: number
}

const num = (v: any): number | null => (v == null || v === '' ? null : Number(v))

function check(label: string, actual: number | null, required: number, unit: string, ok: (a: number) => boolean, note?: string): PatternCheck {
  return { label, actual, required, unit, pass: actual == null ? null : ok(actual), note }
}

/** Every threshold in one block, against what the lot measured. */
function evaluateBlock(d: PatternDesign, b: any, lot: any): PatternBlockResult {
  const checks: PatternCheck[] = [
    check('Lot size', lot.areaM2, b.minLotSizeM2, 'm²', a => a >= b.minLotSizeM2),
    check('Lot width', lot.widthM, b.minLotWidthM, 'm', a => a >= b.minLotWidthM,
      lot.widthBasis ? `measured as ${lot.widthBasis}` : undefined),
  ]
  /*
   * The published standard is a FALL IN METRES, not a gradient.
   *
   * The patterns say what the design absorbs as stairs - "adjustments of up to 2.5 m front to back,
   * and 2.1 m side to side". The percentages this used to test were a workbook conversion for one
   * assumed site length, and are wrong either side of it by up to three times. `falls` is the rule;
   * `slopes` is kept on the data only because the notebook pipeline still writes it.
   *
   * The fall is gradient x run, the same arithmetic /pattern-book does, so the two surfaces agree:
   * the run is the lot's DEPTH front to back and up or down, and its WIDTH side to side.
   */
  const f = b.falls ?? {}
  const g = lot.maxSlopePct == null ? null : lot.maxSlopePct / 100
  const fallNote = lot.meanSlopePct == null
    ? 'gradient x run, from the steepest gradient anywhere on the lot'
    : `gradient x run, from the steepest gradient anywhere on the lot; its mean is `
      + `${lot.meanSlopePct.toFixed(1)}% - the limit is about the building platform, which this does not measure`
  for (const [k, label, run] of [
    ['frontToBackM', 'Fall front to back', lot.depthM],
    ['upM', 'Fall up', lot.depthM],
    ['downM', 'Fall down', lot.depthM],
    ['sideToSideM', 'Fall side to side', lot.widthM],
  ] as const) {
    const limit = (f as any)[k]
    if (limit == null) continue
    // no run measured is not a pass: the fall cannot be computed at all
    const actual = g == null || run == null ? null : Math.round(g * run * 100) / 100
    checks.push(check(label, actual, Number(limit), 'm', a => a <= Number(limit),
      run == null ? 'no run measured for this lot, so the fall cannot be computed' : fallNote))
  }
  if (d.requiresCornerLot) {
    checks.push({
      label: 'Corner lot', actual: null, required: 1, unit: '',
      pass: lot.isCorner == null ? null : lot.isCorner === true,
      note: lot.isCorner == null ? 'not measured' : lot.isCorner ? 'is a corner lot' : 'is not a corner lot',
    })
  }
  const anyUnknown = checks.some(c => c.pass === null)
  // "In an LMR area" / "Outside an LMR area" are the two block names the notebook writes
  const governs = !/LMR area/i.test(b.block) || (/Outside/i.test(b.block) ? !lot.inLmr : lot.inLmr)
  return { block: b.block, checks, qualifies: anyUnknown ? null : checks.every(c => c.pass), governs }
}

/**
 * Whether the design's area gate is met, from the band Chapter 6 puts the lot in.
 *
 * This used to answer "we do not hold an LMR area" and show every gated design both ways. The area
 * IS held: lmr.lot_lmr classifies 232,043 lots into an inner or outer band, built by
 * scripts/build-lmr-lots.ts from the same shared/lmr-evaluate.ts that /api/lmr/types reads - so a
 * design's gate here and a lot's colour on /lmr cannot disagree.
 */
function areaGate(d: PatternDesign, inTod: boolean, inLmr: boolean, band: string | null):
    { gate: boolean | null; why: string } {
  const where = inLmr ? `in the ${band} band of a low and mid rise housing area` : 'in no low and mid rise housing area'
  switch (d.areaLogic) {
    case 'any':
      return { gate: true, why: 'Available anywhere the use is permitted.' }
    case 'lmr_or_tod':
      return inTod || inLmr
        ? { gate: true, why: inTod ? 'In a transport oriented development precinct.' : `The lot is ${where}.` }
        : { gate: false, why: 'Needs a TOD precinct or a low and mid rise housing area; the lot is in neither.' }
    case 'lmr_and_tod':
      return inTod && inLmr
        ? { gate: true, why: `In a TOD precinct and ${where}.` }
        : { gate: false, why: inTod ? `In a TOD precinct, but ${where}.` : 'Not in a TOD precinct.' }
    case 'non_lmr_and_non_tod':
      return !inTod && !inLmr
        ? { gate: true, why: 'Outside both a TOD precinct and a low and mid rise housing area.' }
        : { gate: false, why: inTod ? 'Only applies outside a TOD precinct, and the lot is in one.' : `Only applies outside an LMR area; the lot is ${where}.` }
    case 'lmr_vs_non_lmr':
    default:
      // both blocks are still returned; this says which one governs
      return { gate: true, why: `Thresholds differ by area; the lot is ${where}, so that block governs.` }
  }
}

/** The four councils Housing SEPP s 182(1)(e) puts outside Chapter 7 entirely. */
const S182_EXCLUDED_LGAS = ['BATHURST REGIONAL', 'BLUE MOUNTAINS', 'HAWKESBURY', 'WOLLONDILLY']

/**
 * The 23 councils whose flood planning area s 182(1)(g) excludes. Our flood planning coverage is
 * partial, so a lot in one of these with no mapped flood planning area is undecided, not clear -
 * the missing map is ours.
 */
const S182_FLOOD_LGAS = ['ARMIDALE REGIONAL', 'BALLINA', 'BELLINGEN', 'BYRON', 'CESSNOCK',
  'CLARENCE VALLEY', 'COFFS HARBOUR', 'DUNGOG', 'GOULBURN MULWAREE', 'KEMPSEY', 'KYOGLE', 'LISMORE',
  'MAITLAND', 'NAMBUCCA VALLEY', 'NEWCASTLE', 'PORT STEPHENS', 'QUEANBEYAN-PALERANG REGIONAL',
  'RICHMOND VALLEY', 'SHOALHAVEN', 'SINGLETON', 'TWEED', 'UPPER HUNTER SHIRE', 'WALCHA']

const lgaIn = (lga: string | null, list: string[]) =>
  lga != null && list.some(x => String(lga).toUpperCase().includes(x))

/**
 * Housing SEPP Chapter 7: the gates in front of a mid-rise pattern.
 *
 * NOT the Codes SEPP prerequisites. s 183 turns on a consent authority being satisfied, and
 * "complying development" appears once in the whole chapter - inside a borrowed definition of ANEF
 * contour. This is a development application pathway with its own exclusions at s 182.
 */
function midRiseGates(lot: any): PatternGate[] {
  const L = lot.layers
  const g: PatternGate[] = [
    { clause: 's 183(1)(b)', what: 'in a TOD area or a low and mid rise housing area',
      pass: lot.inTod || lot.inLmr,
      why: lot.inTod ? 'in a transport oriented development area'
        : lot.inLmr ? `in the ${lot.lmrBand} band of a low and mid rise housing area`
          : 'in neither' },
    { clause: 's 182(1)(a)', what: 'not bush fire prone land', pass: !L.bushfire,
      why: L.bushfire ? 'bush fire prone land covers the lot' : 'none mapped' },
    { clause: 's 182(1)(b)', what: 'not a coastal vulnerability area, coastal wetland or littoral rainforest',
      pass: !(L.coastalVuln || L.coastalWetlands || L.littoral),
      why: L.coastalVuln ? 'in a coastal vulnerability area'
        : L.coastalWetlands ? 'in coastal wetlands' : L.littoral ? 'in littoral rainforest' : 'none mapped' },
    { clause: 's 182(1)(c)', what: 'not a heritage item', pass: !L.heritage,
      why: L.heritage ? 'a heritage item or State Heritage Register curtilage covers the lot' : 'none mapped' },
    { clause: 's 182(1)(d)', what: 'not in a heritage conservation area', pass: !L.hca,
      why: L.hca ? 'in a heritage conservation area' : 'none mapped' },
    { clause: 's 182(1)(e)', what: 'not in one of the four excluded councils',
      pass: lot.lga == null ? null : !lgaIn(lot.lga, S182_EXCLUDED_LGAS),
      why: lot.lga == null ? 'no council recorded for this lot'
        : lgaIn(lot.lga, S182_EXCLUDED_LGAS) ? `${lot.lga} is excluded by s 182(1)(e)` : String(lot.lga) },
    // no dataset: the Georges River and Hawkesbury-Nepean flood prone land of B&C SEPP Chapter 6
    { clause: 's 182(1)(f)', what: 'not flood prone land in the Georges River or Hawkesbury-Nepean catchment',
      pass: null, why: 'no dataset exists for it - the same gap /api/lmr/types records at 164(1)(f)' },
    { clause: 's 182(1)(h)', what: 'not in an ANEF contour of 25 or greater', pass: !L.anef,
      why: L.anef ? 'in an ANEF 25 or greater contour' : 'none mapped' },
    { clause: 's 182(1)(i)', what: 'not within 200 m of a relevant pipeline', pass: !L.pipeline,
      why: L.pipeline ? 'within 200 m of a gas or oil pipeline' : 'none within 200 m' },
    { clause: 's 182(1)(k)', what: 'not within 800 m of a Schedule 12 station', pass: !L.sched12,
      why: L.sched12 ? 'within 800 m of a deferred TOD station' : 'none within 800 m' },
    { clause: 's 182(1)(l)', what: 'not an Accelerated TOD Precinct', pass: !L.todAccelerated,
      why: L.todAccelerated ? 'in an Accelerated TOD Precinct' : 'none mapped' },
  ]
  // (g) only bites in its 23 councils, and only where we hold the map
  if (lgaIn(lot.lga, S182_FLOOD_LGAS)) {
    g.push({ clause: 's 182(1)(g)', what: 'not in a flood planning area, in one of the 23 named councils',
      pass: L.floodPlanning ? false : null,
      why: L.floodPlanning ? 'in a mapped flood planning area'
        : `${lot.lga} is one of the 23 councils and we hold no flood planning map for it` })
  }
  return g
}

/**
 * Codes SEPP Part 3BA: the gates in front of a low-rise pattern.
 *
 * These ARE complying development, so Part 1 applies - cl 3BA.3 says so in terms: "Note - Clauses
 * 1.17A, 1.18 and 1.19 set out additional requirements for complying development." The general
 * prerequisites come from /api/cdc/at, which already carries the whole clause 3.3 ESA test.
 *
 * cl 3BA.3(8) disapplies the (7)(a) lot-size floor inside a low and mid rise housing area. That is
 * the only thing the LMR area changes for this pathway.
 */
function lowRiseGates(lot: any, blockers: any[], cdcError: string): PatternGate[] {
  const L = lot.layers
  const g: PatternGate[] = [
    { clause: 'cl 1.17A, 1.18, 1.19, 1.19A',
      what: 'clears the general complying development prerequisites',
      pass: cdcError ? null : blockers.length === 0,
      why: cdcError ? cdcError
        : blockers.length ? blockers.map((b: any) => b.title).join('; ') : 'nothing catches the lot' },
    { clause: 'cl 3BA.6(a)', what: 'not on bush fire prone land', pass: !L.bushfire,
      why: L.bushfire ? 'bush fire prone land covers the lot' : 'none mapped' },
    { clause: 'cl 3BA.6(b)', what: 'not a flood control lot',
      pass: L.floodPlanning ? false : null,
      why: L.floodPlanning ? 'in a mapped flood planning area'
        : 'a flood control lot is a council determination we hold no dataset for' },
    { clause: 'cl 3BA.6(d)', what: 'not a battle-axe lot',
      pass: lot.isBattleaxe == null ? null : !lot.isBattleaxe,
      why: lot.isBattleaxe == null ? 'not measured' : lot.isBattleaxe ? 'is a battle-axe lot' : 'is not' },
    { clause: 'cl 3BA.6(e)', what: 'no secondary dwelling or group home on the lot', pass: null,
      why: 'what is already built on the land is not held' },
    { clause: 'cl 3BA.6(f)', what: 'no building over a registered easement', pass: null,
      why: 'easements are not held' },
    { clause: 'cl 3BA.6(h)', what: 'not unsewered land', pass: null,
      why: 'no dataset exists - the same gap cdc.layers records for unsewered_land' },
    { clause: 'cl 3BA.3(7)(b)', what: 'will have lawful access to a public road',
      pass: lot.widthM == null ? null : lot.widthM > 0,
      why: lot.widthM == null ? 'no frontage measured for this lot'
        : `${lot.widthM.toFixed(1)} m of primary frontage` },
  ]
  // cl 3BA.3(7)(a): the LEP minimum lot size for the use - disapplied inside an LMR area by (8)
  g.push({ clause: 'cl 3BA.3(7)(a)', what: 'meets the LEP minimum lot size for the use',
    pass: lot.inLmr ? true : null,
    why: lot.inLmr
      ? `disapplied by cl 3BA.3(8): the lot is in the ${lot.lmrBand} band of a low and mid rise housing area`
      : 'the LEP minimum for this use is not read per design here - see the Land Use Table above' })
  return g
}

export default defineEventHandler(async (event): Promise<PatternBookAtResponse> => {
  const started = Date.now()
  const cadid = String(getQuery(event).cadid ?? '').trim()
  if (!cadid) throw createError({ statusCode: 400, statusMessage: 'Give a cadid' })
  setHeader(event, 'cache-control', 'public, max-age=60')

  /*
   * One round trip for the lot and every layer either pathway needs.
   *
   * The lot goes to each layer, never the layer to the lot, so the GiST index stays usable - and it
   * is shrunk 10 cm first, as /api/cdc/at and /api/lmr/types do, so a neighbour that only touches
   * the boundary is not a hit.
   */
  const res = await nswQuery<any>(`
    WITH l AS (
      SELECT cadid, lotidstring AS lot_id, lganame, geom,
             CASE WHEN ST_Area(geom::geography) > 40 THEN ST_Buffer(geom, -0.000001) ELSE geom END AS g,
             ST_Area(geom::geography) AS area_m2
        FROM cadastre.lot WHERE cadid = $1 LIMIT 1)
    SELECT l.cadid, l.lot_id AS "lotId", l.area_m2 AS "areaM2",
           coalesce(l.lganame, p.lga_name, m.lga) AS lganame,
           p.primary_frontage_length_m, p.core_width_min_m, p.is_corner_lot, p.lot_depth_m,
           p.is_battleaxe,
           s.max_slope_pct, s.mean_slope_pct,
           -- the band Chapter 6 puts the lot in; null means no low and mid rise housing area
           m.band AS lmr_band, m.class AS lmr_class,
           EXISTS (SELECT 1 FROM lmr.sepp_tod_areas t
                    WHERE t.geom && l.g AND ST_Intersects(t.geom, l.g)) AS in_tod,
           -- cl 3BA.6 and Housing SEPP s 182 share several of these
           EXISTS (SELECT 1 FROM cdc.bushfire_prone_land x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS bushfire,
           EXISTS (SELECT 1 FROM cdc.flood_planning x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS flood_planning,
           EXISTS (SELECT 1 FROM cdc.coastal_vulnerability x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS coastal_vuln,
           EXISTS (SELECT 1 FROM cdc.coastal_wetlands x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS coastal_wetlands,
           EXISTS (SELECT 1 FROM cdc.littoral_rainforest x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS littoral,
           EXISTS (SELECT 1 FROM cdc.heritage_items x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS heritage_item,
           EXISTS (SELECT 1 FROM cdc.heritage_points x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS heritage_point,
           EXISTS (SELECT 1 FROM cdc.shr_curtilage x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS shr,
           EXISTS (SELECT 1 FROM cdc.heritage_conservation_areas x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS hca,
           EXISTS (SELECT 1 FROM cdc.airport_noise x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS anef,
           EXISTS (SELECT 1 FROM cdc.tod_accelerated x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS tod_accelerated,
           EXISTS (SELECT 1 FROM lmr.deferred_tod_areas x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS sched12_800m,
           EXISTS (SELECT 1 FROM lmr.gas_pipelines_buffer_200m x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS gas_200m,
           EXISTS (SELECT 1 FROM lmr.oil_pipelines_buffer_200m x
                    WHERE x.geom && l.g AND ST_Intersects(x.geom, l.g)) AS oil_200m
    FROM l
    LEFT JOIN derived.lot_profile p ON p.cadid = l.cadid
    LEFT JOIN derived.lot_slope   s ON s.cadid = l.cadid
    LEFT JOIN lmr.lot_lmr         m ON m.cadid = l.cadid`, [cadid])

  const r = res.rows[0]
  if (!r) throw createError({ statusCode: 404, statusMessage: `No lot with cadid ${cadid}` })

  // lot width is the property's primary frontage (Manni, 2026-09-30) - the same figure /cdc and /lmr test,
  // and what 07 - Pattern book read. A landlocked lot has none, and its width check is then undecided.
  const widthM = num(r.primary_frontage_length_m)
  const widthBasis = widthM != null ? 'primary frontage' : null

  const lot = {
    cadid: r.cadid, lotId: r.lotId, lga: r.lganame ?? null, areaM2: num(r.areaM2), widthM, widthBasis,
    depthM: num(r.lot_depth_m),
    isCorner: r.is_corner_lot == null ? null : Boolean(r.is_corner_lot),
    isBattleaxe: r.is_battleaxe == null ? null : Boolean(r.is_battleaxe),
    maxSlopePct: num(r.max_slope_pct), meanSlopePct: num(r.mean_slope_pct),
    inTod: Boolean(r.in_tod),
    /** Chapter 6's band for this lot: 'inner', 'outer', or null for no LMR area. */
    lmrBand: (r.lmr_band ?? null) as string | null,
    inLmr: Boolean(r.lmr_band),
    layers: {
      bushfire: Boolean(r.bushfire), floodPlanning: Boolean(r.flood_planning),
      coastalVuln: Boolean(r.coastal_vuln), coastalWetlands: Boolean(r.coastal_wetlands),
      littoral: Boolean(r.littoral),
      heritage: Boolean(r.heritage_item) || Boolean(r.heritage_point) || Boolean(r.shr),
      hca: Boolean(r.hca), anef: Boolean(r.anef), todAccelerated: Boolean(r.tod_accelerated),
      sched12: Boolean(r.sched12_800m), pipeline: Boolean(r.gas_200m) || Boolean(r.oil_200m),
    },
  }

  /*
   * The general prerequisites, for the low-rise half only.
   *
   * event.$fetch, not $fetch: the app sits behind a password middleware and a bare $fetch from
   * inside a route arrives without the request's context. Fetched once, not per design.
   */
  let cdcError = ''
  let blockers: any[] = []
  try {
    const at: any = await event.$fetch('/api/cdc/at', { query: { cadid } })
    blockers = ((at?.hits ?? []) as any[]).filter(h => h.kind === 'exclusion' && h.scope === 'general')
  } catch (e: any) {
    cdcError = e?.data?.statusMessage || e?.message || 'the general prerequisite sweep could not be read'
  }

  const designs: PatternDesignResult[] = PATTERN_DESIGNS.map((d) => {
    const { gate, why } = areaGate(d, lot.inTod, lot.inLmr, lot.lmrBand)
    const pathway = (d as any).pathway ?? 'cdc'
    // the gate list IS the pathway difference: Part 3BA is complying development, Chapter 7 is a DA
    const gates = pathway === 'da' ? midRiseGates(lot) : lowRiseGates(lot, blockers, cdcError)
    const gatesClear = gates.some(x => x.pass === false) ? false
      : gates.some(x => x.pass === null) ? null : true
    return {
      key: d.key, category: d.category, designer: d.designer, requiredUse: d.requiredUse,
      areaLogic: d.areaLogic, areaWords: d.areaWords, requiresCornerLot: d.requiresCornerLot,
      areaGate: gate, areaGateWhy: why, pathway, gates, gatesClear,
      blocks: d.blocks.map(b => evaluateBlock(d, b, lot)),
    }
  })

  // a design "qualifies either way" only when every block it could fall under passes; one that passes
  // in an LMR area and fails outside is reported as turning on the branch, not as a pass
  const verdict = (d: PatternDesignResult) => {
    // a statutory gate outranks the dimensions: clearing the numbers cannot cure an exclusion
    if (d.gatesClear === false) return 'ruledOut'
    if (d.areaGate === false) return 'ruledOut'
    if (d.gatesClear === null) return 'unknown'
    // only the block that applies decides it; the other is shown for comparison
    const gov = d.blocks.filter(b => b.governs)
    const qs = (gov.length ? gov : d.blocks).map(b => b.qualifies)
    if (qs.some(q => q === null)) return 'unknown'
    if (qs.every(q => q === true)) return d.areaGate === true ? 'qualifiesEitherWay' : 'qualifiesEitherWay'
    if (qs.some(q => q === true)) return 'onlyInLmr'
    return 'ruledOut'
  }
  const tally = { qualifiesEitherWay: 0, onlyInLmr: 0, ruledOut: 0, unknown: 0 }
  for (const d of designs) tally[verdict(d) as keyof typeof tally]++

  const caveats: string[] = []
  if (!lot.inLmr) {
    caveats.push('This lot is in no low and mid rise housing area, so the thresholds outside one apply '
      + 'and cl 3BA.3(7)(a) - the LEP minimum lot size for the use - is not disapplied.')
  }
  if (lot.maxSlopePct == null) caveats.push('No slope has been measured for this lot, so every slope check is unknown.')
  else if (lot.meanSlopePct != null && lot.maxSlopePct > lot.meanSlopePct * 3 && lot.maxSlopePct > 10) {
    caveats.push(`Slope is judged on this lot's steepest gradient (${lot.maxSlopePct.toFixed(1)}%) while its mean `
      + `is ${lot.meanSlopePct.toFixed(1)}%. On a lot that uneven it will rule out designs a building platform `
      + 'would clear - read every slope failure below as a prompt to look, not as an answer.')
  }
  else if (lot.meanSlopePct != null && lot.maxSlopePct > lot.meanSlopePct * 3 && lot.maxSlopePct > 10) {
    caveats.push(`Slope is judged on the lot's steepest gradient (${lot.maxSlopePct.toFixed(1)}%) while its mean is `
      + `${lot.meanSlopePct.toFixed(1)}%. On a lot this uneven that is likely to rule out designs a building `
      + 'platform would clear - treat every slope failure here as a prompt to look, not an answer.')
  }
  if (widthM == null) caveats.push('No width has been measured for this lot, so every width check is unknown.')
  if (lot.isCorner == null) caveats.push('Whether this is a corner lot has not been measured.')
  caveats.push('The use each design needs is not tested here - check it against the zone\'s Land Use Table above.')

  return { lot, designs, summary: { ...tally, total: designs.length }, caveats, ms: Date.now() - started }
})
