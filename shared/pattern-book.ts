/**
 * The Pattern Book designs and what each one needs from a lot, for /pattern-book.
 *
 * GENERATED from `07 - Pattern book` by scripts/gen-pattern-book.py - do not hand-edit.
 * Generated 2026-09-23. 22 rows covering 17 patterns.
 *
 * TWO PATHWAYS, NOT ONE
 *
 * 8 rows are the low-rise patterns. They can be complying development under the Pattern Book
 * Development Code - Part 3BA of the Codes SEPP - in zones R1, R2 and R3, and only if the general
 * complying development requirements (cl 1.17A, 1.18, 1.19) and the code's own exclusions (cl 3BA.6)
 * are met.
 *
 * 14 rows are the mid-rise patterns, under Housing SEPP Chapter 7 from 28 November 2025. They are
 * expressly NOT complying development: they need a development application. The Codes SEPP
 * prerequisites do not gate them, so nothing here should send a reader to /cdc for them.
 *
 * SLOPE IS A FALL IN METRES, NOT A GRADIENT
 *
 * The patterns state what the design can absorb as stairs - "adjustments of up to 2.5 m front to back,
 * and 2.1 m side to side" - not a percentage. `falls` carries those published metres and is the rule.
 * `slopes` carries the percentages the earlier workbook derived by dividing metres by an assumed site
 * length; they are only true for a site of that one length, and they are kept solely because the
 * notebook's pipeline and /api/pattern-book/at still read them.
 */

export interface PatternFalls {
  /** Published metres of fall along the lot. */
  frontToBackM?: number
  sideToSideM?: number
  /** Where a pattern splits the two directions rather than giving one figure. */
  upM?: number
  downM?: number
}

export interface PatternBlock {
  /** Which area this set of numbers applies to. */
  block: string
  minLotSizeM2: number | null
  minLotWidthM: number | null
  /** The pattern's own slope standard, in metres of fall. */
  falls: PatternFalls
  /** Derived percentages. Kept for the pipeline; not the standard. */
  slopes: Record<string, number>
  /** Outside an LMR area the LEP minimum lot size for the use applies as well. */
  lepMinLotSizeAlsoApplies: boolean
}

export interface PatternDesign {
  key: string
  category: string
  /** The pattern. Several rows can share it - they are storey variants, not separate designs. */
  design: string
  variant: string | null
  designer: string
  /** 'cdc' = Part 3BA complying development. 'da' = Housing SEPP Ch 7, development application. */
  pathway: 'cdc' | 'da'
  /** The substring the pipeline probes the permissible use list with. */
  requiredUse: string
  /** The Standard Instrument term, which is what a land use table is read against. */
  useTerm: string
  areaLogic: string
  areaWords: string
  requiresCornerLot: boolean
  /** The pattern's page or PDF on planning.nsw.gov.au. */
  source: string | null
  /** Anything the pattern says that these numbers cannot carry. */
  notes: string[]
  blocks: PatternBlock[]
}

export const PATTERN_CATEGORIES: string[] = ["Semis", "Manor Homes", "Row Homes", "Terraces", "Small Lot Apartments", "Corner Lot Apartments", "Large Lot Apartments"]
export const PATTERN_PREREQ_COUNT = 35
/** Patterns, not rows: storey variants of one pattern are not separate designs. */
export const PATTERN_DESIGN_COUNT = 17

/** Part 3BA limits the complying development pathway to these zones. Not tested here. */
export const PATTERN_CDC_ZONES = ['R1', 'R2', 'R3']

/**
 * Part 3BA, the Pattern Book Development Code, clause by clause.
 *
 * READ FROM THE INSTRUMENT, NOT FROM THE WORKBOOK. The Department's "CDC Rules - Part 3, 9 & HSEPP"
 * has a sheet for each of the other twelve codes and none for this one, so everything here comes from
 * the consolidated Codes SEPP (public/EPI/SEPP/exempt-and-complying-2008.md, re-checked against
 * epi-2008-0572_2026-03-26.xml). `text` is verbatim.
 *
 * `tested` and `data` say what the build actually answers, so a row the pipeline does not reach reads
 * as a gap rather than as a requirement quietly met. Two of these are stricter than any other code -
 * see the notes on 3BA.6(a) and 3BA.6(b).
 */
export interface Part3BARequirement {
  /** As the instrument numbers it. */
  clause: string
  /** The words of the requirement, verbatim. */
  text: string
  /** What makes it worth reading twice, or how it differs from the equivalent in another code. */
  note: string | null
  /** Whether anything on this page or in the prerequisite set answers it. */
  tested: boolean
  /** What we hold, or why we hold nothing. */
  data: string
}

export const PATTERN_3BA_URL =
  'https://legislation.nsw.gov.au/view/html/inforce/current/epi-2008-0572#sec.3BA.1'

export const PATTERN_3BA_REQUIREMENTS: Part3BARequirement[] = [
  {
    clause: '3BA.2',
    text: 'This part applies as follows— (a) for Lot 411, DP 1318801—from the commencement of '
      + 'this part, (b) for other land—from 30 July 2025.',
    note: 'In force state-wide since 30 July 2025, so this is not a code that is still coming.',
    tested: false,
    data: 'a commencement date, not a lot test',
  },
  {
    clause: '3BA.3(1)',
    text: 'This clause applies to land in Zone R1 General Residential, Zone R2 Low Density Residential '
      + 'and Zone R3 Medium Density Residential.',
    note: 'Three zones, and no RU5 — narrower than the Low Rise Housing Diversity Code beside it.',
    tested: true,
    data: 'the zone you choose above; the page says so when it is not one of these three',
  },
  {
    clause: '3BA.3(7)(a)',
    text: 'Subclauses (2)–(5) do not apply to a lot if the size of the lot is less than the minimum '
      + 'lot size for the erection of dual occupancies, manor houses, multi dwelling housing or multi '
      + 'dwelling housing (terraces), as the case requires, under an environmental planning instrument '
      + 'applying to the lot.',
    note: 'The lot size gate is the LEP minimum for the housing type. The code states no figure of its '
      + 'own — the numbers in the table above are the patterns’, not the code’s.',
    tested: false,
    data: 'named in the table as "+ the LEP minimum" but not resolved; lep_zones holds the figure',
  },
  {
    clause: '3BA.3(8)',
    text: 'Subclause (7)(a) does not apply to a lot if the lot is on land within the low and mid rise '
      + 'housing area.',
    note: 'Inside the LMR area the LEP minimum does not apply AT ALL. That is a stronger statement than '
      + 'the table above makes: it shows LMR as a smaller number, where the clause removes the LEP '
      + 'limb entirely and leaves only the pattern’s own figure.',
    tested: true,
    data: 'the LMR switch above picks the block; what is not modelled is that the second figure stops '
      + 'being a floor rather than becoming a larger one',
  },
  {
    clause: '3BA.3(7)(b)',
    text: 'Subclauses (2)–(5) do not apply to a lot if the lot will not have lawful access to a '
      + 'public road at the completion of the development.',
    note: null,
    tested: false,
    data: 'the frontage work distinguishes landlocked lots; not wired to this page',
  },
  {
    clause: '3BA.6(a)',
    text: 'development on bush fire prone land,',
    note: 'STRICTER THAN 1.19A. The general bush fire clause excludes BAL-40 and the flame zone; this '
      + 'one excludes bush fire prone land outright — which is how the prerequisite set already '
      + 'reads 1.19A. For this code alone, that reading is the right one.',
    tested: true,
    data: 'lmr.bushfire_prone_land, in full',
  },
  {
    clause: '3BA.6(b)',
    text: 'development on a flood control lot,',
    note: 'STRICTER THAN EVERY OTHER CODE. There is no "other than a part certified by the council or a '
      + 'professional engineer" limb in 3BA.6, and no part-lot rule: any flood control lot is out.',
    tested: false,
    data: 'the prerequisite set tests the EPI flood planning area, a different definition; the SDF 1% '
      + 'AEP column is empty for every property',
  },
  {
    clause: '3BA.6(c)',
    text: 'development that is complying development under the Housing Alterations Code,',
    note: null,
    tested: false,
    data: 'a question about the proposal, not the lot',
  },
  {
    clause: '3BA.6(d)',
    text: 'development on a battle-axe lot,',
    note: null,
    tested: false,
    data: 'derived.lot_frontage.is_battleaxe already measures this',
  },
  {
    clause: '3BA.6(e)',
    text: 'development on any lot on which there is a secondary dwelling or group home, whether or not '
      + 'the development is attached to the dwelling or home,',
    note: null,
    tested: false,
    data: 'not held',
  },
  {
    clause: '3BA.6(f)',
    text: 'the erection of a building over a registered easement,',
    note: null,
    tested: false,
    data: 'not held',
  },
  {
    clause: '3BA.6(h)',
    text: 'development on unsewered land,',
    note: null,
    tested: false,
    data: 'not held; no public state-wide layer',
  },
  {
    clause: '3BA.6(i)',
    text: 'development on land identified as susceptible to landslide risk in— (i) an environmental '
      + 'planning instrument applying to the land, or (ii) for land to which Warringah Local '
      + 'Environmental Plan 2011 applies—“Area C” or “Area E” on the '
      + 'Landslip Risk Map within the meaning of that plan.',
    note: null,
    tested: false,
    data: 'cdc.landslide_risk holds it and the landsliderisk column would answer it, but landslide is '
      + 'not in the general prerequisite set',
  },
]

export const PATTERN_DESIGNS: PatternDesign[] = [{"key": "Semis_01_Anthony_Gill", "category": "Semis", "design": "Semis 01", "variant": null, "designer": "Anthony Gill Architects", "pathway": "cdc", "requiredUse": "dual", "useTerm": "dual occupancy", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "semis-01-by-anthony-gill-architects.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 450, "minLotWidthM": 12, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 1.35, "sideToSideM": 1.2}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 565, "minLotWidthM": 15, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 1.35, "sideToSideM": 1.2}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Semis_02_Sibling", "category": "Semis", "design": "Semis 02", "variant": null, "designer": "Sibling Architecture", "pathway": "cdc", "requiredUse": "dual", "useTerm": "dual occupancy", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "semis-02-by-sibling-architecture.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 450, "minLotWidthM": 12, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 1.4, "sideToSideM": 1.4}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 650, "minLotWidthM": 15, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 1.4, "sideToSideM": 1.4}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Manor_Homes_01_Studio", "category": "Manor Homes", "design": "Manor Homes 01", "variant": null, "designer": "Studio Johnston", "pathway": "cdc", "requiredUse": "manor house", "useTerm": "manor house", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "manor-homes-01-by-studio-johnston.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 625, "minLotWidthM": 15, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 2.5, "sideToSideM": 2.1}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 840, "minLotWidthM": 18, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 2.5, "sideToSideM": 2.1}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Row_Homes_01_SAHA", "category": "Row Homes", "design": "Row Homes 01", "variant": null, "designer": "SAHA", "pathway": "cdc", "requiredUse": "multi dwelling housing", "useTerm": "multi dwelling housing", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "row-homes-01-by-saha.pdf", "notes": ["15.5 m mid-block; the pattern allows 13 m on corner or rear-lane sites"], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 500, "minLotWidthM": 13, "slopes": {"max_slope": 5}, "falls": {"frontToBackM": 2.7, "sideToSideM": 1.1}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 600, "minLotWidthM": 15.5, "slopes": {"max_slope": 5}, "falls": {"frontToBackM": 2.7, "sideToSideM": 1.1}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Terraces_01_Carter", "category": "Terraces", "design": "Terraces 01", "variant": null, "designer": "Carter Williamson", "pathway": "cdc", "requiredUse": "multi dwelling housing (terraces)", "useTerm": "multi dwelling housing (terraces)", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "terraces-01-by-carter-williamson.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 500, "minLotWidthM": 15, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 2.0, "sideToSideM": 1.5}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 600, "minLotWidthM": 18, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 2.0, "sideToSideM": 1.5}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Terraces_02_Sam_Crawford", "category": "Terraces", "design": "Terraces 02", "variant": null, "designer": "Sam Crawford Architects", "pathway": "cdc", "requiredUse": "multi dwelling housing (terraces)", "useTerm": "multi dwelling housing (terraces)", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "terraces-02-by-sam-crawford-architects.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 515, "minLotWidthM": 18.5, "slopes": {"max_slope": 7.5}, "falls": {"frontToBackM": 1.2, "sideToSideM": 1.2}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 670, "minLotWidthM": 21, "slopes": {"max_slope": 7.5}, "falls": {"frontToBackM": 1.2, "sideToSideM": 1.2}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Terraces_03_Officer_Woods", "category": "Terraces", "design": "Terraces 03", "variant": null, "designer": "Officer Woods Architects", "pathway": "cdc", "requiredUse": "multi dwelling housing (terraces)", "useTerm": "multi dwelling housing (terraces)", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "terraces-03-by-officer-woods-architects.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 500, "minLotWidthM": 18, "slopes": {"max_slope": 7}, "falls": {"frontToBackM": 2.3, "sideToSideM": 1.2}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 600, "minLotWidthM": 21, "slopes": {"max_slope": 7}, "falls": {"frontToBackM": 2.3, "sideToSideM": 1.2}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Terraces_04_Other", "category": "Terraces", "design": "Terraces 04", "variant": null, "designer": "Other Architects x NMBW", "pathway": "cdc", "requiredUse": "multi dwelling housing (terraces)", "useTerm": "multi dwelling housing (terraces)", "areaLogic": "lmr_vs_non_lmr", "areaWords": "Thresholds drop inside a low and mid-rise area", "requiresCornerLot": false, "source": "terraces-04-by-other-architects-x-nmbw.pdf", "notes": [], "blocks": [{"block": "In an LMR area", "minLotSizeM2": 595, "minLotWidthM": 18, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 3.0, "sideToSideM": 1.8}, "lepMinLotSizeAlsoApplies": false}, {"block": "Outside an LMR area", "minLotSizeM2": 695, "minLotWidthM": 21, "slopes": {"max_slope": 10}, "falls": {"frontToBackM": 3.0, "sideToSideM": 1.8}, "lepMinLotSizeAlsoApplies": true}]}, {"key": "Small_Lot_Apt_01_3storeys_min", "category": "Small Lot Apartments", "design": "Small Lot Apartments 01", "variant": "3 storeys, minimum pattern", "designer": "Collins and Turner", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-01-by-collins-and-turner", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 520, "minLotWidthM": 13, "slopes": {"max_upslope": 2.5, "max_downslope": 2.5}, "falls": {"frontToBackM": 1.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Small_Lot_Apt_01_3storeys", "category": "Small Lot Apartments", "design": "Small Lot Apartments 01", "variant": "3 storeys", "designer": "Collins and Turner", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-01-by-collins-and-turner", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 664, "minLotWidthM": 13.6, "slopes": {"max_upslope": 2.5, "max_downslope": 2.5}, "falls": {"frontToBackM": 1.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Small_Lot_Apt_01_4storeys", "category": "Small Lot Apartments", "design": "Small Lot Apartments 01", "variant": "4 storeys", "designer": "Collins and Turner", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-01-by-collins-and-turner", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 904, "minLotWidthM": 16.6, "slopes": {"max_upslope": 2.5, "max_downslope": 2.5}, "falls": {"frontToBackM": 1.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Small_Lot_Apt_02_3storeys", "category": "Small Lot Apartments", "design": "Small Lot Apartments 02", "variant": "3 storeys", "designer": "Nguluway DesignInc", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-02-by-nguluway-designinc", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 571, "minLotWidthM": 13.6, "slopes": {"max_upslope": 4, "max_downslope": 4}, "falls": {"frontToBackM": 1.66}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Small_Lot_Apt_02_4storeys", "category": "Small Lot Apartments", "design": "Small Lot Apartments 02", "variant": "4 storeys", "designer": "Nguluway DesignInc", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-02-by-nguluway-designinc", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 863, "minLotWidthM": 16.6, "slopes": {"max_upslope": 4, "max_downslope": 4}, "falls": {"frontToBackM": 1.66}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Small_Lot_Apt_03_4_6storeys", "category": "Small Lot Apartments", "design": "Small Lot Apartments 03", "variant": "4-6 storeys", "designer": "MHN Design Union", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-03-by-mhn-design-union", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 640, "minLotWidthM": 16, "slopes": {"max_upslope": 5.6, "max_downslope": 1.6}, "falls": {"upM": 2.25, "downM": 0.65}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Small_Lot_Apt_04_4_5storeys", "category": "Small Lot Apartments", "design": "Small Lot Apartments 04", "variant": "4-5 storeys", "designer": "Neeson Murcutt Neille", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": false, "source": "small-lot-apartments-04-by-neeson-murcutt-neille", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 600, "minLotWidthM": 16.5, "slopes": {"max_upslope": 5.5, "max_downslope": 2.8, "max_crossfall": 1.7}, "falls": {"frontToBackM": 2.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Corner_Lot_Apt_01_4_6storeys", "category": "Corner Lot Apartments", "design": "Corner Lot Apartments 01", "variant": "4-6 storeys", "designer": "Tonkin Zulaikha Greer", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": true, "source": "corner-lot-apartments-01-by-tonkin-zulaikha-greer", "notes": ["the workbook restricts this to TOD or LMR areas where a 0 m setback is permissible; not tested"], "blocks": [{"block": "Anywhere", "minLotSizeM2": 525, "minLotWidthM": 15, "slopes": {"max_upslope": 9.5, "max_downslope": 8.8}, "falls": {"frontToBackM": 3.8}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Corner_Lot_Apt_02_4_6storeys", "category": "Corner Lot Apartments", "design": "Corner Lot Apartments 02", "variant": "4-6 storeys", "designer": "Spacecraft Architects", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "lmr_or_tod", "areaWords": "Only inside a low and mid-rise area or a transport oriented development precinct", "requiresCornerLot": true, "source": "corner-lot-apartments-02-by-spacecraft-architects", "notes": ["the workbook restricts this to TOD or LMR areas where a 0 m setback is permissible; not tested"], "blocks": [{"block": "Anywhere", "minLotSizeM2": 614, "minLotWidthM": 17.9, "slopes": {"max_upslope": 11.6, "max_crossfall": 11.6}, "falls": {"frontToBackM": 4.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Large_Lot_Apt_01_4storeys", "category": "Large Lot Apartments", "design": "Large Lot Apartments 01", "variant": "4 storeys", "designer": "Silvester Fuller", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "any", "areaWords": "Anywhere the use is permitted", "requiresCornerLot": false, "source": "large-lot-apartments-01-by-silvester-fuller", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 1610, "minLotWidthM": 49.1, "slopes": {"max_upslope": 12, "max_downslope": 12}, "falls": {"frontToBackM": 4.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Large_Lot_Apt_01_6storeys", "category": "Large Lot Apartments", "design": "Large Lot Apartments 01", "variant": "6 storeys", "designer": "Silvester Fuller", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "any", "areaWords": "Anywhere the use is permitted", "requiresCornerLot": false, "source": "large-lot-apartments-01-by-silvester-fuller", "notes": ["the 6-storey minimums are not separately published; shown as the 4-storey figures"], "blocks": [{"block": "Anywhere", "minLotSizeM2": 1610, "minLotWidthM": 49.1, "slopes": {"max_upslope": 12, "max_downslope": 12}, "falls": {"frontToBackM": 4.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Large_Lot_Apt_02_3_4storeys", "category": "Large Lot Apartments", "design": "Large Lot Apartments 02", "variant": "3-4 storeys", "designer": "Bennett and Trimble", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "any", "areaWords": "Anywhere the use is permitted", "requiresCornerLot": false, "source": "large-lot-apartments-02-by-bennett-and-trimble", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 2052, "minLotWidthM": 36, "slopes": {"max_upslope": 7, "max_downslope": 7}, "falls": {"frontToBackM": 4.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Large_Lot_Apt_02_5_6storeys", "category": "Large Lot Apartments", "design": "Large Lot Apartments 02", "variant": "5-6 storeys", "designer": "Bennett and Trimble", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "any", "areaWords": "Anywhere the use is permitted", "requiresCornerLot": false, "source": "large-lot-apartments-02-by-bennett-and-trimble", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 2376, "minLotWidthM": 36, "slopes": {"max_upslope": 6, "max_downslope": 6}, "falls": {"frontToBackM": 4.0}, "lepMinLotSizeAlsoApplies": false}]}, {"key": "Large_Lot_Apt_03_4_6storeys", "category": "Large Lot Apartments", "design": "Large Lot Apartments 03", "variant": "4-6 storeys", "designer": "Andrew Burges Architects", "pathway": "da", "requiredUse": "residential flat", "useTerm": "residential flat building", "areaLogic": "any", "areaWords": "Anywhere the use is permitted", "requiresCornerLot": false, "source": "large-lot-apartments-03-by-andrew-burges-architects", "notes": [], "blocks": [{"block": "Anywhere", "minLotSizeM2": 3551, "minLotWidthM": 67, "slopes": {"max_upslope": 0.9, "max_downslope": 3.8}, "falls": {"frontToBackM": 2.0}, "lepMinLotSizeAlsoApplies": false}]}]
