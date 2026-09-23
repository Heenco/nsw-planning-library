"""Generate shared/pattern-book.ts from "07 - Pattern book".

    python scripts/gen-pattern-book.py

Reads the `pattern_book_types` dict out of cell 6 of the notebook by executing
that cell in an empty namespace - the notebook is the single definition of the
rules, and this file must never become a second place to edit them.

Replaces the old scratchpad/gen_criteria.py, which lived in a temp directory and
did not survive. Keep this one in the repo.

WHAT THE SHAPE HAS TO PRESERVE

`server/api/pattern-book/at.get.ts` reads `key`, `category`, `designer`,
`requiredUse`, `areaLogic`, `areaWords`, `requiresCornerLot` and
`blocks[].{block,minLotSizeM2,minLotWidthM,slopes}`, and that endpoint is what
/testing-spatial-services renders. Those fields stay exactly as they were.
Everything this adds - design, variant, pathway, useTerm, falls, notes - is new
alongside them, so the testing page keeps working untouched.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
NOTEBOOK = REPO.parent / "Notebooks" / "07 - Pattern book.ipynb"
OUT = REPO / "shared" / "pattern-book.ts"

AREA_WORDS = {
    "lmr_vs_non_lmr": "Thresholds drop inside a low and mid-rise area",
    "lmr_or_tod": "Only inside a low and mid-rise area or a transport oriented development precinct",
    "lmr_and_tod": "Only where a low and mid-rise area and a transport precinct overlap",
    "non_lmr_and_non_tod": "Only outside both the low and mid-rise areas and the transport precincts",
    "any": "Anywhere the use is permitted",
}

BLOCK_WORDS = {"LMR": "In an LMR area", "non_LMR": "Outside an LMR area", "single": "Anywhere"}

# the percent keys the notebook's own _resolve_slope_limit reads, kept so the
# pipeline and /api/pattern-book/at behave exactly as before
PCT_KEYS = ("max_slope", "max_upslope", "max_downslope", "max_crossfall")
# the pattern's own standard, in metres of fall
FALL_KEYS = {
    "max_fall_front_back_m": "frontToBackM",
    "max_fall_side_side_m": "sideToSideM",
    "max_fall_up_m": "upM",
    "max_fall_down_m": "downM",
}


def load_types() -> tuple[dict, int]:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    for cell in nb["cells"]:
        src = "".join(cell["source"])
        if "pattern_book_types = {" in src:
            ns: dict = {}
            exec(compile(src, "07 - Pattern book:cell", "exec"), ns)  # noqa: S102
            return ns["pattern_book_types"], len(ns["cdc_general_conditions"])
    raise SystemExit("pattern_book_types not found in the notebook")


def blocks_for(cfg: dict) -> list[dict]:
    out = []
    for name, c in cfg["constraints"].items():
        falls = {FALL_KEYS[k]: c[k] for k in FALL_KEYS if c.get(k) is not None}
        out.append({
            "block": BLOCK_WORDS.get(name, name),
            "minLotSizeM2": c.get("min_lot_size"),
            "minLotWidthM": c.get("min_lot_width"),
            "slopes": {k: c[k] for k in PCT_KEYS if c.get(k) is not None},
            "falls": falls,
            # outside an LMR area the pattern minimum is a floor, not the
            # requirement - the LEP minimum for the use applies as well
            "lepMinLotSizeAlsoApplies": name == "non_LMR",
        })
    return out


def main() -> None:
    types, prereq_count = load_types()

    designs = []
    for key, cfg in types.items():
        designs.append({
            "key": key,
            "category": cfg["category"],
            "design": cfg["design"],
            "variant": cfg.get("variant"),
            "designer": cfg["designer"],
            "pathway": cfg["pathway"],
            "requiredUse": cfg["required_use"],
            "useTerm": cfg["use_term"],
            "areaLogic": cfg["area_logic"],
            "areaWords": AREA_WORDS[cfg["area_logic"]],
            "requiresCornerLot": cfg["requires_corner_lot"],
            "source": cfg.get("source"),
            "notes": [cfg[k] for k in ("width_note", "setback_note", "unconfirmed") if cfg.get(k)],
            "blocks": blocks_for(cfg),
        })

    categories = list(dict.fromkeys(d["category"] for d in designs))
    n_designs = len(dict.fromkeys(d["design"] for d in designs))

    body = HEADER.format(
        generated=date.today().isoformat(),
        n_rows=len(designs),
        n_designs=n_designs,
        n_cdc=sum(1 for d in designs if d["pathway"] == "cdc"),
        n_da=sum(1 for d in designs if d["pathway"] == "da"),
    )
    body += f"export const PATTERN_CATEGORIES: string[] = {json.dumps(categories)}\n"
    body += f"export const PATTERN_PREREQ_COUNT = {prereq_count}\n"
    body += f"/** Patterns, not rows: storey variants of one pattern are not separate designs. */\nexport const PATTERN_DESIGN_COUNT = {n_designs}\n"
    body += FOOTER
    body += "export const PATTERN_DESIGNS: PatternDesign[] = " + json.dumps(designs, indent=None) + "\n"

    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)}: {len(designs)} rows, {n_designs} designs, {prereq_count} prerequisites")


HEADER = '''/**
 * The Pattern Book designs and what each one needs from a lot, for /pattern-book.
 *
 * GENERATED from `07 - Pattern book` by scripts/gen-pattern-book.py - do not hand-edit.
 * Generated {generated}. {n_rows} rows covering {n_designs} patterns.
 *
 * TWO PATHWAYS, NOT ONE
 *
 * {n_cdc} rows are the low-rise patterns. They can be complying development under the Pattern Book
 * Development Code - Part 3BA of the Codes SEPP - in zones R1, R2 and R3, and only if the general
 * complying development requirements (cl 1.17A, 1.18, 1.19) and the code's own exclusions (cl 3BA.6)
 * are met.
 *
 * {n_da} rows are the mid-rise patterns, under Housing SEPP Chapter 7 from 28 November 2025. They are
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

export interface PatternFalls {{
  /** Published metres of fall along the lot. */
  frontToBackM?: number
  sideToSideM?: number
  /** Where a pattern splits the two directions rather than giving one figure. */
  upM?: number
  downM?: number
}}

export interface PatternBlock {{
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
}}

export interface PatternDesign {{
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
}}

'''

FOOTER = '''
/** Part 3BA limits the complying development pathway to these zones. Not tested here. */
export const PATTERN_CDC_ZONES = ['R1', 'R2', 'R3']

/**
 * Clause 3BA.6 adds these to the general complying development exclusions. What the pipeline's
 * prerequisite set actually covers is in the third field - naming the gap the way /cdc does, rather
 * than leaving it out and reading as though it were tested.
 */
export const PATTERN_3BA6_EXCLUSIONS: { land: string; tested: boolean; note: string }[] = [
  { land: 'Bush fire prone land', tested: true, note: 'tested in full; unlike cl 1.19A(1)(a), this code excludes all bush fire prone land, not only BAL-40 and flame zone' },
  { land: 'Flood control lots', tested: false, note: 'the prerequisite set tests the EPI flood planning area, which is a different definition; the SDF 1% AEP column is empty for every property' },
  { land: 'Battle-axe lots', tested: false, note: 'derived.lot_frontage.is_battleaxe already measures this' },
  { land: 'A lot with an existing secondary dwelling or group home', tested: false, note: 'not held' },
  { land: 'Building over a registered easement', tested: false, note: 'not held' },
  { land: 'Unsewered land', tested: false, note: 'not held' },
  { land: 'Land susceptible to landslide risk', tested: false, note: 'landsliderisk is not in the general prerequisite set' },
]

'''

if __name__ == "__main__":
    main()
