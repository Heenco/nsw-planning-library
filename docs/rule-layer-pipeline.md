# Rule layer — pipeline design

How a planning document becomes queryable development controls. Modelled on
the LEP Part 4 pilot (`Notebooks/Data/lep_part4/lep_store.sqlite`), which
validated this vocabulary across 8 LEPs with full clause-by-clause audits and
found *no wrong numeric values and no hallucinated standards*.

The production graph stops at `proposition` — grounded atoms with literal
spans. That is the right evidence layer but it cannot answer "what applies to
this property, and which rule wins?". This adds the layer that can.

```
document → section → proposition        evidence: grounded atoms, literal spans
                          ↓ rollup
                        rule            normative unit: role, kind, precedence
                          ├── rule_applicability   scope, WITH polarity
                          ├── rule_effect          numbers / permissions / exemptions
                          ├── rule_spatial_ref     parcels + areas, real geometry
                          └── rule_edge            overrides / disapplies / can_vary
                          ↓
                    resolver(property, proposal, date) → effective controls
```

Schema: `db/nsw-schema-migration-05-rule-layer.sql`.

---

## 1. Two extraction brains, split by ownership

The pilot's central design decision, and the reason its audits came back
clean. Each brain owns what it is actually good at; neither second-guesses
the other.

| Brain | Owns | Why |
|---|---|---|
| **Deterministic** | document structure; tables (control grids, land-use × zone); map-deferred standards (`src='map'`); cadastral refs (Lot/DP, SP); objectives; excluded zones; DCP rubric routing | Structure is already in the source. Inferring it with a model adds error for nothing. |
| **AI (role-split)** | prose numerics with role (standard / threshold / variation_limit); conditions; effects; entities — each with a **verbatim span** | Only prose needs judgement. |

**The anti-hallucination gate is non-negotiable:** any AI item whose `span`
is not a verbatim substring of the source text is *dropped*, not corrected.
The pilot enforces this in `merge_packets.py`; this repo already has the same
rule in `verifiers/precision.ts`. It is what makes the numbers trustworthy.

### What the source now gives us for free

The clause-structured HTML converter (`scripts/dcp-convert.mjs`) means the
deterministic brain starts far ahead of where the pilot did:

| signal | attribute | used for |
|---|---|---|
| clause identity | `data-number` | `rule.clause`, `rule_key` |
| normative role | `data-rubric` | route: `controls` → rules, `objectives` → `objective` table |
| provenance | `data-page-start/end` | citation deep links |
| tables | real `<table>` + `<caption>` + `colspan` | `src='table'` extraction, never prose |
| part | `data-part` | `rule.part` |

`data-rubric` is the single highest-value routing signal: 48% of LEP Part 4
clauses open with an objectives subclause, and objectives are aids to
interpretation, not standards. Extracting them as obligations is a
false-positive class, not a miss.

---

## 2. Stages

```
0  convert     PDF → clause-structured HTML          scripts/dcp-convert.mjs      (done)
               XML → markdown with [sec.x] markers   (existing, LEP/SEPP)

1  structure   HTML/MD → section tree                structured-html-parser (TO BUILD)
               → nsw.section, with rubric + page range

2  route       classify each section by normative role — no LLM
               controls/operative  → stage 3
               objectives          → nsw.objective, stop
               contents/index      → skip
               table               → stage 3t

3  extract     prose  → propositions (role-split agents, verbatim spans)
   3t          tables → propositions directly from cells (deterministic)

4  verify      precision (span literal, numeric in span) + recall (every
               comparator+unit candidate claimed)      verifiers/*.ts (existing)

5  rollup      propositions → rule + rule_applicability + rule_effect
               + rule_spatial_ref + objective

6  relate      rule_edge: overrides / disapplies / can_vary / relaxes,
               each with `authority` (statute | instrument | specificity)

7  geocode     rule_spatial_ref.value → geom, from live NSW/DPIE endpoints;
               NULL when unresolved (a known gap, never a guess)

8  audit       deterministic gate → nsw.audit_finding; loop until zero open
               gating findings
```

Stages 1–3t are per-document and idempotent: a rebuild deletes and reinserts
one document's rows via `rule.rule_key`, leaving the rest of the graph alone.

### 2a. Stage 3t is not "find the number in the cell"

The first pass treated a control table as prose with pipes in it, and every
value it produced from Hornsby's Table 3.1.2-a was wrong. The table states
four things and the number is only one of them:

```
Boundary setback | Minimum building setback
Front boundary   | 6m to local roads and 9m to designated roads, except …
Side boundary    | Up to 1 storey = 0.9m   2 storey element = 1.5m
Waterfront       | See Clause 6.1 of HLEP Foreshore Building Line Map
```

| What the table states | Where it lives | Column |
|---|---|---|
| the value | the cell, or the words after each number | `value`, `unit` |
| the **datum** — measured from what | the row header, else the words after the number | `measured_from` |
| the **band** that selects between values | a storey phrase in the cell, or the column header | `condition_metric/lo/hi` |
| a **deferral** where there is no value | the cell text | `map_layer`, `value_source` |
| the direction | the caption ("Minimum Boundary Setbacks") | `comparator` |

Three rules follow from that, and each one was learned by getting it wrong:

- **The storey number is a condition, not a value.** Read left to right,
  "Up to 1 storey = 0.9m" yields `setback = 1 storey`: the qualifier keeps
  its unit while `0.9m` — flush against its unit — was not matched at all.
- **A datum is never inferred from the caption.** Every row of a table
  captioned "Minimum boundary setbacks" would inherit `property_boundary`,
  so the one row whose datum is actually the front boundary would come out
  stated and wrong. NULL is the correct answer when the row header is silent.
- **A cell with no number can still be the rule.** Five waterfront controls
  defer to the Foreshore Building Line Map. Dropping them is how a control
  silently becomes "no limit".

The tables themselves are persisted (`nsw.section_table`,
`nsw.section_table_cell`) rather than flattened into `section.raw_text`,
because a row header that survives only as a substring of `source_span` is
not something a resolver can join on.

### 2b. Measuring against the document, not against the last run

Coverage reports that ask "does this section have a rule?" scored 99.9% while
clause 3.1.2 held four effects that were each the wrong number. The check
that catches this reads control values off the PDF by hand and asserts the
database reproduces them — `scripts/planningai-datum-check.mjs`, 21 values
across three setback tables, failing loudly on a diff.

---

## 3. Where multi-agent actually pays

Not everywhere — it is expensive and most clauses do not need it. Use the
cheap single pass by default, and escalate on a *measured* signal.

**Escalate when:** the clause is in LEP Parts 4–6 or a Schedule; or the recall
verifier finds a comparator+unit candidate the first pass did not claim.

**Split by role, not by chunk** — each agent gets a narrow output schema, so
validation is tighter and a failure is localised and re-runnable:

| agent | owns |
|---|---|
| segmenter | split into atomic normative units; no interpretation |
| numeric | value, unit, comparator, range, and map deferral (`value_source`) |
| conditionality | "unless" / "despite" / "subject to" → conditions, exceptions |
| applicability | zone / use / area / size band, **and polarity** |
| reference | clause, Schedule, SEPP and Act refs |

Do **not** use self-reported confidence for routing: 22,091 of 22,109
existing propositions sit at 0.8–1.0, including the flagged 14%. The
deterministic verifiers are the only usable signal.

---

## 4. Precedence

Three independent inputs, kept separate so the resolver can explain itself:

1. `rule.instrument_rank` — statutory hierarchy. EP&A Act s3.28: an EPI
   displaces an inconsistent DCP provision outright. Derived from `doc_type`.
2. `rule.precedence` — ordering *within* an instrument (specific beats
   general).
3. `rule_edge` — explicit displacement, with `authority` recording *why*:
   `statute`, the instrument's own "relationship with other EPIs" clause
   (`instrument`), or `specificity`.

Sources worth targeting first, because they are few and well-defined:
LEP cl 4.6 (variation of development standards — the one clause with
identical wording in all 146 LEPs), each SEPP's relationship clause, and
Housing SEPP non-refusal standards.

**The resolver must return the defeated rules too.** "cl 4.3 gives 8.5 m,
displaced by Housing SEPP cl X" is the answer a planner needs; the bare
winning number is not.

---

## 5. Spatial binding

Two different mechanisms, do not conflate them:

- **Map-deferred values** (`rule_effect.map_layer`) — "as shown on the Height
  of Buildings Map". The value is not in the document. It resolves against the
  already-materialised columns on `nsw.up_property_comprehensive`
  (`hob_max_height_m`, `fsr_value`, `mls_lot_size`, `lzn_sym_code`, …).
  No geometry needed: the join is by property id.
- **Named parcels and areas** (`rule_spatial_ref`) — "Lot 1, DP 599645", a
  named precinct. These need real geometry, geocoded post-build from live
  NSW/DPIE endpoints. `geom` stays NULL when unresolved.

The second is what the production graph has never had (0 geometry columns),
and it is what proximity rules — heritage buffers, foreshore setbacks —
require.

---

## 6. The accuracy gate

The pilot's hardest-won lesson: **you cannot converge on correctness without
a number, and you cannot converge at all unless genuinely-unfixable findings
can be accepted and stop recurring.**

`nsw.audit_finding` holds the findings; a document PASSES when it has zero
open *gating* findings.

| check | gating | catches |
|---|---|---|
| every operative section yields ≥1 rule | yes | the 2,050 substantial DCP sections that produced nothing |
| every table yields rule rows | yes | the 39k-char "Parking Rates" blob that produced nothing |
| every named Lot/DP appears in `rule_spatial_ref` | yes | dropped parcels |
| every `data-rubric="controls"` block yields a rule | yes | rubric routed but never extracted |
| value+unit tokens vs `rule_effect` | no — a lead | wrong or missing numbers |

`status='accepted'` requires `accepted_reason` at the schema level, so the
allowlist cannot quietly absorb real bugs. The pilot's own file records the
kind of entry that belongs there: *"6.15 renumbered as 6.22/6.23 by 2014 (366)
Sch 2 — dead placeholder, not a live clause."*

**The loop:** audit → dispatch a targeted fix for each open finding
(re-extract only the named section, not the document) → rebuild → re-audit,
until the gate exits clean.

---

## 7. Applying it to Hornsby

Hornsby is the right pilot: already converted to clause-structured HTML, and
**not yet in the graph**, so nothing gets overwritten and the numbers are
directly comparable against the eight existing DCPs.

```
1. apply db/nsw-schema-migration-05-rule-layer.sql
2. build the structured-HTML parser (stage 1) — simpler than the markdown
   one: clause tree, numbers, rubric and page ranges are attributes to read,
   not patterns to infer
3. ingest Hornsby through stages 1–5
4. run the audit gate; iterate until clean
5. compare against Randwick (5,891 props, 21.9% flagged, 27.5% of substantial
   sections empty) on equal footing
```

Success criterion for the pilot: **zero substantial `controls` sections with
no rule**, which is precisely the failure mode the current DCP ingest has.

---

## 8. What the report reads back out

Onboarding a council is only finished when the report can answer with its
numbers. Two consumers depend on specific fields, and both fail *quietly* when
a field is missing — the section simply does not render — so each one has a
stated acceptance test to run against a real lot in the new LGA.

### `getLotProvisions` — additional permitted uses, area provisions, mapped standards

Needs `rule.kind = 'additional_use'`, `rule_applicability` rows carrying the
uses, and `rule_spatial_ref` with resolved geometry. Nothing else reaches the
report for Schedule 1.

### `getLotRequirements` — minimum lot size and subdivision (`server/utils/nsw-kg/lot-requirements.ts`)

Reads `rule_effect.topic = 'lot_size'` on `doc_type = 'lep'`, and depends on
three applicability dimensions, each of which changes the answer:

| dimension | value shape | what breaks without it |
|---|---|---|
| `act` | `subdivision`, `strata subdivision`, `community title subdivision`, `erection of a building` | Development standards and subdivision standards merge. Hornsby cl 4.1C (700–900 m² to *build* a dual occupancy) and cl 4.1D (350–450 m² to *subdivide* one) would be reported as one contradictory pair. The heading is only a fallback: cl 4.1B is a subdivision standard whose heading never says so. |
| `zone` | `R2`, `RU1`, … | Every clause applies everywhere. Rural subdivision lands on suburban lots. Note the scope is pooled **per clause**, not per rule: the ingest attaches the zone list to whichever subclause names it, and a sibling that inherits it looks unscoped. |
| `land_use` | `dual occupancy (attached)`, unqualified where the clause is | The variant that governs is lost. The report tests each qualified variant separately and reports "satisfied for attached, short 77.5 m² for detached" — collapsing them yields a minimum the instrument never states. |

A clause that states no figure is read as deferring to the Lot Size Map, whose
value for the lot comes from `up_property_d_3.min_lot_size`.

**Acceptance test.** Pick a lot in the new LGA and open its report:

1. The amber "not decomposed into testable rules yet" banner is **gone**.
   While it shows, the only figure in the section is the mapped one.
2. Minimum lot size rows name the proposed use and its variants, and each says
   satisfied or short by a number.
3. Subdivision rows name a type — Torrens, Strata, Community title. All rows
   reading "Torrens" usually means `act` was not populated.
4. No clause appears whose heading is obviously about another zone.
5. Clause chips resolve to `/doc-viewer` rather than rendering as `[?]`.

Run it for at least one lot in a residential zone and one in a rural or
split-zone one; the zone-pooling and `act` bugs both only surface on the second.

---

## 9. Onboarding a council, end to end

Randwick is the worked example. Its DCP already had a rule layer; its LEP had
1,173 sections and nothing else — no propositions, no rules, no spatial refs —
so every LEP-driven section of the report was either absent or answered from the
property record alone. This is the sequence that closed it, and the order
matters.

```
1. XML ingest        -> nsw.section          the full clause tree
2. pilot merge       -> nsw.rule + children  the numbers, scoped
3. verify on lots    -> a report per case    APU, area provision, lot size
```

### Step 2 is the one with a trap in it

`scripts/import-pilot-lep.mjs` seeds the rule layer from the audited Part 4
pilot store, which covers eight LEPs. **Run it with `--merge`.** Without that
flag it opens by deleting any document with the same title, and every section
cascading from it — which is how Hornsby's XML tree was destroyed once already
and had to be rebuilt by `scripts/migrate-lep-to-xml.mjs`.

```
node scripts/import-pilot-lep.mjs --epi epi-2013-0036 --merge          # rehearsal
node scripts/import-pilot-lep.mjs --epi epi-2013-0036 --merge --apply
```

`--merge` resolves every pilot clause onto the existing document's own section
ids, refuses to write if any clause is unresolvable, and replaces only the rule
layer — never sections, never the document row. It prints what it is about to
delete before deleting it.

Clause ids do not line up between the two sources, and they disagree differently
per instrument. `scripts/lib/lep-clause-map.mjs` holds the correspondences:

| pilot | XML | seen in |
|---|---|---|
| `4.1A` | `sec.4.1A` | everywhere |
| `Sch 1 item 6` | `sch.1-sec.6` | Hornsby, Randwick |
| `Sch 2 item 1` | `sch.2-sec` | Randwick — unnumbered items |
| `Sch 2 item 7` | `sch.2-sec-oc.7` | Randwick — ordinal suffix |

Every inferred correspondence is corroborated before it is used, by heading
match or by finding one of the clause's grounded spans — verbatim quotes from
the instrument — inside that section's own subtree. A guess that lands on a
plausible but wrong clause is worse than an import that fails, because nothing
downstream can tell the rule is in the wrong place.

### Scope is not a matter of pooling zones

`shared/lep-scope.ts` decides whether a clause reaches a lot, and it exists
because the obvious implementations are both wrong. Zone applicability is
recorded per *rule*, and a clause is several rules. Pooling every zone a clause
mentions drops Randwick's cl 4.3, the Height of Buildings clause, from an R2 lot
because one of its subclauses is R3-specific. Not filtering at all puts "Rural
subdivision" on a lot in Maroubra.

These two have identical applicability and opposite answers:

```
Hornsby  cl 4.2  Rural subdivision    { act, land_use=dwelling, zone=RU1..RU6 }
                                      { act }                    <- no zone
Randwick cl 4.3  Height of buildings  { land_use=dwelling house, zone=R3 }
                                      { act }                    <- no zone
```

So the module applies two rules. Zones on a *use-qualified* rule scope that
sub-provision, not the clause — which keeps cl 4.3. And a clause the instrument
names as rural does not reach a lot in no rural zone — which drops both cl 4.2s.
The second reads the heading because that is the only place the distinction
survives.

Two related traps, both cost a wrong figure on the page:

- **Fetch clause scope over every rule, not the ones your query already
  filtered.** Randwick's cl 4.2 keeps its rural zones on a `permission` rule
  that states no lot size, so a lot-size query cannot see them.
- **Pool the `act` per clause before naming the subdivision kind.** Randwick's
  cl 4.1A is two rules, `strata subdivision` and a bare `subdivision`; read
  separately the same clause appears twice, once as Strata and once as Torrens.

### Step 3: what to open, and what should be on the page

| case | Randwick lot | expect |
|---|---|---|
| Additional permitted use | 62 Carr Street Coogee | Sch 1 item 1, restaurant or cafe |
| APU, several uses | 6 Aeolia Street Randwick | Sch 1 item 5, five uses |
| Mapped area provision | 472 Bunnerong Road Matraville | cl 4.3A Area 3 and cl 6.27, each with the subclause that does the work |
| Area with a condition | 204-230 Marine Parade Maroubra | cl 4.3B Area 7 — height raised only on consolidation |
| Minimum lot size tested | 903 Anzac Parade Maroubra | cl 4.1C, 550 m², satisfied at 749.29 m² |

Then check the negatives, which are where the scope bugs show: no rural
subdivision clause on a suburban lot, no exception clause listed under "Set by"
in the mapped standards table, and cl 4.3 present with the lot's mapped height.

### Known gaps, carried forward

- **Schedule 2 imports but does nothing.** The 12 exempt-development rules
  resolve and load; no report section reads them, and CDC is still answered from
  `up_property_d_3`.
- **cl 6.24 resolves to the wrong land.** Its "Area 4" gets the Special
  Provisions Area Map polygon in Kensington, while the clause is headed "Use of
  certain land at Maroubra". Area labels appear to be resolved per map layer
  rather than per clause, so a clause referring to its own Area 4 can collect
  another map's. Three lots are affected; that is why 95 Anzac Parade Kensington
  is not a sample address.
- **Six map references go unread.** `MAP_TO_VALUE` in `provisions.ts` knows the
  Lot Size, Height of Buildings and Floor Space Ratio maps. Randwick's cl 6.19
  Non-Residential Floor Space Ratio Map, cl 6.20 Active Street Frontages Map and
  cl 4.3B Alternative Building Heights Map are in the graph and unused.
