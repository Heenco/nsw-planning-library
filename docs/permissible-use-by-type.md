# Permissible use by type — cl 1.18(1)(b) and s 183(1)(a)

Every complying development certificate and every Pattern Book design turns on a **land use being
permissible, with consent, under an environmental planning instrument applying to the land**. This is
the map from each type or design to the use that test is run against.

Two surfaces, two clauses, and they are not interchangeable:

| surface | pathway | clause | words |
|---|---|---|---|
| `/cdc`, `/api/cdc/types` | complying development | **cl 1.18(1)(b)** (Codes SEPP) | "be permissible, with consent, under an environmental planning instrument applying to the land on which the development is carried out" |
| `/pattern-book`, `/api/pattern-book/at` (low rise) | complying development | **cl 1.18(1)(b)** (Codes SEPP) | as above |
| `/api/pattern-book/at` (mid rise) | development application | **s 183(1)(a)** (Housing SEPP Ch 7) | "the development is permitted with development consent under an environmental planning instrument that applies to the land" |

Different instruments, same substance: permissible **with consent**. Permitted *without* consent does
not satisfy either clause.

Values below were read from `planningai` on 2026-10-08. The `cdc.type` rows carry
`checked_at = 2026-09-28`.

---

## 1. CDC types

Source of truth: **`cdc.type.land_uses`** in `planningai`. Eleven types.

| # | CDC type | Code | Land use that must be permissible with consent | Terms matched in the DB |
|---|---|---|---|---|
| 1 | Dual occupancy | Low Rise Housing Diversity Code | dual occupancies (including attached and detached) | `dual occupancies`, `dual occupancies (attached)`, `dual occupancies (detached)`, `dual occupancy`, `dual occupancy (attached)`, `dual occupancy (detached)` |
| 2 | Multi dwelling housing (terraces) | Low Rise Housing Diversity Code | multi dwelling housing | `multi dwelling housing` |
| 3 | Secondary dwelling | Housing SEPP, Ch 3 | secondary dwellings | `secondary dwellings` |
| 4 | Dwelling houses | Housing Code | dwelling houses | `dwelling houses` |
| 5 | Manor houses | Low Rise Housing Diversity Code | residential flat buildings **or** multi dwelling housing — **inferred** | `residential flat buildings`, `multi dwelling housing` |
| 6 | Rural housing | Rural Housing Code | dwelling houses | `dwelling houses` |
| 7 | Inland dwelling houses | Inland Code | dwelling houses | `dwelling houses` |
| 8 | Inland farm buildings | Inland Code | farm buildings | `farm buildings` |
| 9 | Greenfield housing | Greenfield Housing Code | dwelling houses | `dwelling houses` |
| 10 | Agritourism | Agritourism Code, Part 9 | agritourism | `agritourism` |
| 11 | Farm stay accommodation | Farm Stay Code, Part 9 | farm stay accommodation | `farm stay accommodation` |

Only five distinct land uses do the work across eleven types. `dwelling houses` alone covers four of
them — Housing, Rural, Inland and Greenfield differ on dimensions and location, not on the use.

**Mid-rise housing is absent on purpose.** It is a DA pathway, not complying development, so it was
removed from the CDC catalogue. Its seed entry in `shared/cdc-permissibility.ts` still carries a
deliberately empty `[]` and a note saying why; it is not in `cdc.type` and never reaches the page.

---

## 2. Pattern Book designs

Source of truth: **`USE_TERMS`** in `server/api/pattern-book/at.get.ts`. Keyed on design category,
not on type. 22 designs across 7 categories.

| # | Category | Designs | Pathway | Clause | Land use that must be permissible with consent | Terms matched in the DB |
|---|---|---|---|---|---|---|
| 1 | Semis | 2 | CDC — Codes SEPP Pt 3BA | cl 1.18(1)(b) | dual occupancies (including attached and detached) | the same 6 spellings as CDC type 1 |
| 2 | Terraces | 4 | CDC — Codes SEPP Pt 3BA | cl 1.18(1)(b) | multi dwelling housing — **inferred** | `multi dwelling housing` |
| 3 | Row Homes | 1 | CDC — Codes SEPP Pt 3BA | cl 1.18(1)(b) | multi dwelling housing | `multi dwelling housing` |
| 4 | Manor Homes | 1 | CDC — Codes SEPP Pt 3BA | cl 1.18(1)(b) | residential flat buildings **or** multi dwelling housing — **inferred** | `residential flat buildings`, `multi dwelling housing` |
| 5 | Small Lot Apartments | 7 | **DA** — Housing SEPP Ch 7 | **s 183(1)(a)** | residential flat buildings | `residential flat buildings` |
| 6 | Large Lot Apartments | 5 | **DA** — Housing SEPP Ch 7 | **s 183(1)(a)** | residential flat buildings | `residential flat buildings` |
| 7 | Corner Lot Apartments | 2 | **DA** — Housing SEPP Ch 7 | **s 183(1)(a)** | residential flat buildings | `residential flat buildings` |

Four distinct land uses across 22 designs. `residential flat buildings` alone covers 14 of them — all
three apartment categories.

---

## 3. The three inferences

An inference is a type whose land use is **not** the instrument's own term. Each is labelled as one
everywhere it appears, rather than being passed off as a reading of the statute.

| where | inference | why |
|---|---|---|
| CDC `manor-houses`, Pattern Book `Manor Homes` | residential flat buildings **or** multi dwelling housing | "Manor house" is not one of the Standard Instrument's 203 terms. A manor house is three or four dwellings in one building, which the instruments reach through either form, so either satisfies it. |
| Pattern Book `Terraces` | multi dwelling housing | The vocabulary carries no "(terraces)" term at all. cl 3BA.3(5) describes them as "multi dwelling housing (terraces)", so plain multi dwelling housing is what is tested. |

The CDC catalogue records this in `cdc.type.land_uses_inferred`; the Pattern Book records it in the
`inferred` field of `USE_TERMS`, whose text is carried through to the gate's `why`.

Functionally `Terraces` and `Row Homes` test identically. `Terraces` is still marked as an inference
because the design name promises a term the instrument does not carry.

---

## 4. Why both spellings

The two sources do not agree on the vocabulary:

- `nsw.lep_permissibility` says **"dual occupancies"**
- `nsw.sepp_permissible_landuse` says **"Dual occupancy"**

Every spelling either source uses is listed, and matching is lower-cased. The duplicate spellings are
a join detail, not something to put on a page: `usesShown()` in `shared/cdc-permissibility.ts` folds
them back to one readable term by stripping the qualifier and stemming the plural, so six strings
display as "dual occupancies (including attached and detached)".

---

## 5. This is not the zone test

The Codes SEPP permits a dual occupancy in R2. Whether one is permissible on a **particular** R2 lot
depends on the LEP applying to that land, and 148 LEPs answer differently for the same zone code.

The join is: zoning polygons intersecting the lot give (instrument, zone code), then
`nsw.lep_permissibility` on instrument + zone + use, or `nsw.sepp_permissible_landuse` on zone + use.
Both surfaces run the same join against the same zoning polygons, so they cannot disagree about which
instrument applies.

Tested on a Lane Cove R2 lot, the zone check passes for multi dwelling housing and this one fails.

---

## 6. Worked example

Lot `102443157` — 33//DP11658, Fairfield, zones **R2 and R3**, 952.8 m², 15.4 m frontage.

**CDC: 8 of 11 pass.**

| verdict | types | what the instrument said |
|---|---|---|
| pass | Dual occupancy | dual occupancies (attached) permitted with consent in R2 under Fairfield LEP 2013 |
| pass | Multi dwelling housing (terraces), Manor houses | multi dwelling housing permitted with consent in R3 |
| pass | Secondary dwelling, Dwelling houses, Rural housing, Inland dwelling houses, Greenfield housing | permitted with consent in R2 |
| fail | Inland farm buildings | farm buildings prohibited in R2, R3 |
| fail | Agritourism | agritourism prohibited in R2, R3 |
| fail | Farm stay accommodation | farm stay accommodation prohibited in R2, R3 |

The three failures are the rural codes landing on a suburban lot, which is the check working.

**Pattern Book: 4 of 7 categories pass**, and the split falls cleanly along the pathway.

| verdict | categories | what the instrument said |
|---|---|---|
| pass | Semis | dual occupancies (attached) permitted with consent in R2 |
| pass | Terraces, Row Homes, Manor Homes | multi dwelling housing permitted with consent in R3 |
| fail | Small, Large and Corner Lot Apartments (14 designs) | residential flat buildings prohibited in R2, R3 |

All 14 apartment designs fail on the use alone, before a single dimension is read. A definite
statutory failure settles the row rather than deferring to "undecidable".

---

## 7. Where each table comes from

| | CDC | Pattern Book |
|---|---|---|
| runtime source | `cdc.type.land_uses` (DB) | `USE_TERMS` in `server/api/pattern-book/at.get.ts` |
| seed | `USE_FOR_TYPE` in `shared/cdc-permissibility.ts` | — |
| rebuild | `npm run build:cdccatalogue` | edit the constant |
| design list | `cdc.type` | `shared/pattern-book.ts`, generated by `scripts/gen-pattern-book.py` from "07 - Pattern book" |
| inference flag | `cdc.type.land_uses_inferred` | `inferred` field on the `USE_TERMS` entry |

**The two are not on the same footing.** CDC had its catalogue moved into the database so that one
source feeds both the page and the route; Pattern Book has not had that move, and its mapping is
still a constant in the endpoint. Worth closing if the Pattern Book mapping ever needs to be edited
by anyone who does not deploy.
