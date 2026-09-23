# /pattern-book — review against the instrument

The same exercise done for `/cdc`: take what the page asserts, find the document
that actually says it, and compare line by line. For `/cdc` the authority was the
Codes SEPP workbook. Here there are three authorities, and the page is built on
none of them:

1. **Pattern Book Development Code — Part 3BA of the Codes SEPP.** The complying
   development pathway, for the **low-rise patterns only**.
2. **Housing SEPP Chapter 7** (commenced 28 November 2025). The **mid-rise**
   patterns — a *development application* pathway, expressly **not** complying
   development.
3. **Each pattern's own "Development standards and planning information" table**,
   published free as a PDF per design. This is where the numbers live.

What the page is actually built on is `07 - Pattern book` cell 6, which was typed
from `Desktop/GEODAAS/LMR and CDC/Pattern Book Rules - 251127.xlsx` — an early
internal transcription that has since been superseded by `Pattern Book Rules -
version2.xlsx` in the same folder.

**The short version:** the lot size and width numbers are right — seven of eight
low-rise patterns match the published standards exactly, which is a good result.
Everything around them is not. Every slope figure on the page is a percentage the
instrument never states; the page is missing the zone gate, the LEP minimum lot
size rule and six of the seven Part 3BA.6 exclusions; nine of the twenty-two rows
are mid-rise designs that cannot be complying development at all, yet the page
sends the reader to `/cdc` for their prerequisites.

---

## 1. Manor Homes 01 is wrong by 175 m² and 275 m²

| | page | pattern PDF |
|---|---|---|
| LMR minimum lot size | 450 m² | **625 m²** |
| LMR minimum lot width | 12 m | **15 m** |
| non-LMR minimum lot size | 565 m² | **840 m²** |
| non-LMR minimum lot width | 15 m | **18 m** |

The page's four numbers are Semis 01's four numbers. `Pattern Book Rules -
251127.xlsx` carries the same copy — sheet "Manor Homes 01 by Studio Johnst" reads
450 / 12 / 565 / 15 — and `version2.xlsx` corrects it to 625 / 15 / 840 / 18,
which is what *manor-homes-01-by-studio-johnston.pdf* and the design's own page on
planning.nsw.gov.au say. The notebook was built from the uncorrected sheet.

This is the page's default answer, not an edge case: the header defaults to
600 m² / 15 m / 5% in an LMR area, and Manor Homes 01 shows as fitting. It does
not fit — it is 25 m² short.

## 2. Every slope number is invented

The patterns do not state a gradient. They state **a fall in metres, front to back
and side to side**, because what the design has to absorb is a step count, not an
angle:

> This pattern accommodates internal stairs and adjustments of up to **2.5 m front
> to back, and 2.1 m side to side**. — Manor Homes 01

| design | page "max slope" | pattern's actual standard |
|---|---|---|
| Semis 01 | 10 % | 1.35 m front to back, 1.2 m side to side |
| Semis 02 | 10 % | 1.4 m, 1.4 m |
| Manor Homes 01 | 10 % | 2.5 m, 2.1 m |
| Row Homes 01 | 5 % | 2.7 m |
| Terraces 01 | 10 % | 2.0 m |
| Terraces 02 | 7.5 % | 1.2 m, 1.2 m |
| Terraces 03 | 7 % | 2.3 m, 1.2 m |
| Terraces 04 | 10 % | 3.0 m, 1.8 m |

The two columns are not the same quantity and the ranking is close to inverted.
Row Homes 01 is the strictest design on the page (5 %) and the second most
tolerant in the book (2.7 m). Semis 01 is the most permissive on the page (10 %)
and the strictest in the book (1.35 m) — on a 40 m deep lot the page allows 4 m of
fall where the pattern allows 1.35 m, so it passes lots that are three times too
steep.

The mid-rise rows show where the percentages came from. Small Lot Apartments 03
publishes *upslope 0–2.25 m, downslope 0–0.65 m, lot length 40–65 m*; the workbook
divided those metres by each site length and got two pairs — 5.6 % / 1.6 % for a
40 m site and 6 % / 6 % for a 65 m one. The notebook kept the 40 m pair and
dropped the other with the comment "collapsed to strictest values". So the page's
figure is only true for a lot of exactly one length, and silently wrong either
side of it.

Two consequences worth stating plainly:

- **The page asks for a quantity the instrument does not use.** "Slope %" in the
  header cannot be answered from the pattern; it can only be answered from a
  survey, and then it still has to be multiplied by the lot's depth to mean
  anything.
- **The side-to-side limit is missing for all eight low-rise designs.** Only two
  mid-rise rows carry a `max_crossfall`, and six of the eight low-rise patterns
  publish one.

This is fixable with what we hold: `derived.lot_profile.lot_depth_m` and
`core_depth_m` exist, so `fall ≈ slope% × depth` can be tested against the
pattern's metres directly.

## 3. Three gates the page does not have

**Zones.** Guidance §1.3: "The pattern book complying development pathway applies
in **zones R1, R2 and R3**." There is no zone test anywhere in
`shared/pattern-book.ts`, `server/api/pattern-book/at.get.ts` or the notebook's 35
prerequisites. The page's substitute is "needs the use: dual occupancy" — which is
a different question, and a weaker one.

**The LEP minimum lot size, outside an LMR area.** Every pattern's standards table
prints it inside the non-LMR cell:

> 840 m² min *(must also meet relevant LEP minimum lot size for this development
> type)*

Guidance §1.9 says the same in full sentences. The page's second figure is
therefore a floor, not the requirement: in most LGAs the LEP minimum for multi
dwelling housing is the larger number. We hold these — `rule_dimension` and the
Part 4 store — so the column could show `max(pattern, LEP)`.

**Clause 3BA.6.** The Pattern Book Development Code carries its own exclusions on
top of clauses 1.17A / 1.18 / 1.19. Against the notebook's 35 prerequisites:

| 3BA.6 exclusion | tested? |
|---|---|
| bush-fire prone land | yes — and here the blanket test is *right*, unlike under 1.19A(1)(a) where only BAL-40/FZ is excluded |
| flood control lots | no — `floodmapping` (EPI flood planning area) is a proxy for a differently defined thing, and `floodsdf_ogc_fid` is empty for every property |
| battle-axe lots | no — but `derived.lot_frontage.is_battleaxe` exists today |
| a lot with an existing secondary dwelling or group home | no |
| building over a registered easement | no |
| unsewered land | no |
| land susceptible to landslide risk | no — `landsliderisk` is not in the general set |

And the page's caveat — "every design also needs the property to clear 35
complying-development prerequisites … which the complying development page sets
out" — points at a page that does not contain this code. `/cdc` covers nine codes;
the Pattern Book Development Code is not among them.

## 4. Nine of the twenty-two rows are not complying development

The mid-rise patterns — Small Lot Apartments 01–04, Corner Lot Apartments 01–02,
Large Lot Apartments 01–03, nine designs — sit under Housing SEPP Chapter 7 and
require a development application. The commentary is blunt about it: "the new mid
rise patterns will **not** be a type of complying development." A targeted
assessment pathway has passed parliament but had not commenced as at the sources
reachable here; that status is worth re-checking before anything is written on the
page.

The page applies the same 35 CDC prerequisites to all 22 rows and links all of
them to `/cdc`. For nine of them that is the wrong instrument entirely — and it is
the strictest part of the page, so it will be rejecting apartment designs on
exclusion layers that do not gate a DA.

The workbook knew: the Large Lot Apartment sheets are headed "Permitted with
Development Consent under EPI". That header did not survive into the notebook.

## 5. Land use terms are collapsed

Guidance §1.2 names the use for each pattern in Standard Instrument terms:

| pattern | instrument | page |
|---|---|---|
| Semis 01, 02 | dual occupancy | dual occupancy ✓ |
| Manor Homes 01 | **manor house** | dual occupancy ✗ |
| Row Homes 01 | multi dwelling housing | multi dwelling housing ✓ |
| Terraces 01–04 | **multi dwelling housing (terraces)** | multi dwelling housing ✗ |

Both wrong ones matter because of what `01E` already showed: these are distinct
terms in a closed vocabulary with their own permissibility per zone. "Manor house"
is not a subset of "dual occupancy" — it is four dwellings — and "multi dwelling
housing (terraces)" is its own line in a land use table, permitted in places plain
multi dwelling housing is not, and vice versa. Five of eight low-rise rows tell
the reader to check the wrong row of the LUT.

## 6. Smaller things, in descending order

- **"22 designs" is 17 designs.** Small Lot Apartments 01 appears three times and
  02 twice (storey tiers), Large Lot 01 and 02 twice each. The headline count, the
  "N of 22 fit" score and the per-category "3 of 5" all double-count: a lot that
  clears Small Lot Apartments 01 at three heights is reported as fitting three
  designs.
- **The apartment designers are unattributed.** All nine mid-rise rows read
  "Pattern Book Design 01…04". They are published: Collins and Turner, Nguluway
  DesignInc, MHN Design Union, Neeson Murcutt Neille (small lot), Silvester
  Fuller, Bennett and Trimble, Andrew Burges Architects (large lot). Terraces 04
  is by "Other Architects **x NMBW**".
- **The frontage caveat is the wrong way round.** The page says: "The build reads
  the frontage the cadastre gives, not the width at the building line, which has
  no legal definition." Every pattern's standards table defines it: "**The minimum
  lot width is measured at the front building line.**" (Guidance §2.2 repeats it.)
  So the definition exists here, `at.get.ts` is right to prefer
  `width_at_setback_m`, and the caveat should say the build measures the right
  thing approximately rather than that the concept is undefined. The notebook,
  meanwhile, uses `primary_frontage_length_m` — frontage, not width — so `/report`
  and `/api/pattern-book/at` answer this differently for the same lot.
- **And so does slope.** The notebook compares `average_slope`; `at.get.ts`
  compares the lot's *maximum* gradient (documented, deliberately conservative);
  the page compares one number the reader types. Three answers, one lot.
- **Row Homes 01's non-LMR width is conditional.** The pattern says "15.5 m min
  (**13 m min for corner or rear-lane sites**)". The page carries the
  unconditional 15.5. Same shape as the DCP finding: the cell is a small decision
  table and we flattened it.
- **Corner Lot Apartments lost half their gate.** The workbook heads both sheets
  "Only in TOD or LMR areas **where 0 m setback is permissible**". Only the corner
  requirement survived.
- **The Large Lot area logic is unsupported.** `lmr_and_tod` for design 01,
  `non_lmr_and_non_tod` for 02, `any` for 03 were read off spreadsheet *column
  headers* that describe which height variant suits which area. Chapter 7 restricts
  small lot and corner patterns to TOD areas and LMR areas; the large lot patterns
  "can be used more generally". As it stands the page rules Large Lot 01 out
  everywhere outside a TOD precinct and Large Lot 02 out everywhere inside one.
- **Large Lot Apartments 01 has two identical rows** — 4 storeys and 6 storeys both
  1,610 m² / 49.1 m — while the published metrics give a range of 1,610–2,338 m²
  and 49.1–65.1 m across those heights. One of the two rows is the wrong end of
  the range.
- **Three numbers is not the test.** Each pattern's table also fixes maximum
  building height, FSR, front/side/rear/secondary setbacks, articulation zone,
  minimum landscaped area (15 %), off-street parking and — for terraces — maximum
  unbroken street frontage (45 m). The page's framing ("each one comes down to
  three numbers") is what makes the slope error feel small; it is not. At minimum
  the page should say the three numbers are the *site* test and the rest is the
  *design* test.

---

## What to fix, in order

1. **Manor Homes 01 → 625 / 15 and 840 / 18.** One-line fix in the notebook, then
   re-run `gen_criteria.py`. It is wrong on the default view of the page.
2. **Re-point the generator at `Pattern Book Rules - version2.xlsx`**, or better,
   at the eight pattern PDFs, which is the only source that is actually the
   instrument. The size and width numbers in all eight have now been checked
   against them; the table in §1–2 above is the check.
3. **Replace the slope percentages with the published metres**, and test them as
   `slope% × lot_depth_m`. Carry the side-to-side figure as a second limit.
4. **Split the page in two.** Low-rise: complying development under Part 3BA.
   Mid-rise: DA under Housing SEPP Chapter 7. They do not share a gate and should
   not share a caveat.
5. **Add the three missing gates** — R1/R2/R3, the LEP minimum lot size outside an
   LMR area, and the 3BA.6 exclusions. Battle-axe is free (`is_battleaxe`);
   landslide, easement, secondary dwelling and flood control lot should at least be
   *named as untested* the way `/cdc` names its gaps, rather than silently absent.
6. **Fix the use terms** to manor house and multi dwelling housing (terraces), and
   count designs rather than storey variants.

---

## What was applied, 2026-09-23

Everything in the list above except the pipeline re-run, which is a 5.4 M row job against
UrbanPortalDBP and is yours to start.

- **`07 - Pattern book`, cell 6.** Manor Homes 01 corrected to 625 / 15 and 840 / 18. Every design
  gained the published fall in metres beside the old percentage, its real designer, its Standard
  Instrument use term, `pathway` (`cdc` or `da`), `design` and `variant` so storey tiers stop counting
  as separate patterns, and a `source` naming the PDF or page each number came from. The **keys are
  untouched** — they name the columns in `up_property_pattern_book_eligibility` and in d_4, so
  renaming one would be a schema change — and the percent fields the notebook's own
  `_resolve_slope_limit` reads are still there, so the pipeline behaves exactly as before until you
  choose otherwise. The `required_use` probe now reads `manor house` and
  `multi dwelling housing (terraces)`, which is a real fix to the eligibility logic: it is a substring
  match against the permissible use list, so the precise term is what it needed all along.
- **`scripts/gen-pattern-book.py`** replaces the lost `scratchpad/gen_criteria.py`, in the repo this
  time, wired up as `npm run build:patternbook`. It reads the notebook cell and writes
  `shared/pattern-book.ts`: 22 rows, 17 patterns, 35 prerequisites.
- **`/pattern-book`** is now two sections with their own colours — low-rise in clay for the Part 3BA
  complying development pathway, mid-rise in indigo for the Chapter 7 DA one — on a warm page instead
  of the slate one it shared with `/cdc`. The lot gained a **depth** and a **zone**, slope is tested as
  metres of fall over that depth and over the width, the score counts patterns rather than rows, the
  non-LMR figure is labelled "+ the LEP minimum", a banner fires outside R1/R2/R3, and clause 3BA.6 is
  listed with each item marked tested or not.
- **Not touched, as asked: `/testing-spatial-services`.** The shape
  `/api/pattern-book/at` returns is unchanged, so that page renders exactly as before; it picks up the
  corrected Manor Homes numbers for free because it reads the same generated file. It still tests the
  percentages rather than the metres, which is now the one place on the site that does — there is a
  comment at the top of `at.get.ts` saying so, and `derived.lot_profile.lot_depth_m` is what it will
  need when you want it moved.

Still open: the pipeline re-run; `/report`, which reads d_4's stored flags and so keeps the old answers
until that happens; and Large Lot Apartments 01's 6-storey row, which repeats the 4-storey minimums
because the 6-storey end of the published range is not separately stated.

## Sources

- [Guidance for low-rise pattern book users (Feb 2026)](https://www.planning.nsw.gov.au/sites/default/files/2026-03/guidance-for-low-rise-pattern-book-users.pdf) — Part 3BA, zones, §1.5 exclusions, §1.9 LEP minimum lot size, §2.2 lot width
- [Pattern designs index](https://www.planning.nsw.gov.au/government-architect-nsw/housing-design/nsw-housing-pattern-book/pattern-designs) and the free per-pattern PDFs under `/sites/default/files/2025-07/<slug>.pdf` (low-rise) and `/2025-11/` (mid-rise)
- [Mid rise pattern book now in place: new Chapter 7 of the Housing SEPP](https://www.millsoakley.com.au/insights/mid-rise-pattern-book-now-in-place-new-chapter-7-of-the-housing-sepp-commences/) — Mills Oakley
- [The Pattern Book Development Code has launched](https://www.millsoakley.com.au/insights/the-pattern-book-development-code-has-launched/) and [Pattern Book Developments and CDCs](https://www.lindsaytaylorlawyers.com.au/in_focus/pattern-book-developments-and-cdcs/) — Lindsay Taylor Lawyers
- `Desktop/GEODAAS/LMR and CDC/Pattern Book Rules - 251127.xlsx` (what we built from) and `Pattern Book Rules - version2.xlsx` (the corrected one)

Not verified: legislation.nsw.gov.au was not read directly — as at the last
attempt it 403s every route — so clause 3BA.6's wording here is taken from the
department's own guidance and from the two law firm notes, which agree.
