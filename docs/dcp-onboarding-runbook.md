# DCP onboarding — runbook

How to take a council's DCP from "a page of PDFs on a council website" to a
queryable, citable instrument in the library and the knowledge graph.

Written after Hornsby (council #1) and while doing Randwick (council #2). Every
command and line reference below was verified against the tree on branch
`feat/library-ingest`. Where a step is *manual with no script*, it says so —
those are the steps that get forgotten.

Companion: [dcp-journey-log.md](dcp-journey-log.md) records what each council
taught us and why the pipeline looks the way it does. Design rationale for the
rule layer lives in [rule-layer-pipeline.md](rule-layer-pipeline.md).

---

## 0. Establish what the current instrument actually is

**Do not skip this, and do not trust the NSW Planning Portal register for it.**

`scripts/fetch-dcp-register.mjs` scrapes the Planning Portal DCP register, and
that register lags badly. Verified examples:

| council | portal register says | reality |
|---|---|---|
| Hornsby | "Hornsby DCP 2013 - 2019" | HDCP **2024** (book version, 26 June 2026) |
| Randwick | "Randwick DCP 2013 - as amended Apr 2016" | Randwick **DCP 2025**, commenced 27 July 2026 |

So the register is useful for *discovery* (579 entries, a starting URL per
council) and useless for *currency*. Always open the council's own DCP page and
read it.

Known register bug: `group` state leaks across entries — both Randwick rows
carry `"group": "Blacktown City Council Growth Centre Precincts Development
Control Plan 2010"`. Don't trust that field.

What to record from the council page, because it decides everything downstream:

- Is the DCP **one consolidated PDF** or **many part PDFs**? (Hornsby = one; Randwick = 43.)
- Does it have **staged commencement**, where a new plan supersedes an old one
  but keeps some old parts in force? (Randwick DCP 2025 retains three DCP 2013
  parts: D3 Randwick Junction Centre, D5 Matraville Centre, F2 Outdoor advertising.)
- Is there a **savings/transitional provision**? (Randwick: DAs lodged before
  27 July 2026 are assessed under the old DCP, *except* those relying on SEPP
  (Housing) 2021 affordable-housing / co-living / low-and-mid-rise provisions.)
- Are parts still **pending** in a later stage? (Randwick Stage 3: Designing with
  Country, noise, waste, signage, Matraville — due end 2026.)

## 1. Write a source manifest

Because `public/EPI/DCPs/pdf/` and `public/EPI/DCPs/images/` are **both
gitignored** (`.gitignore`), source PDFs and extracted images never enter version
control. Without a manifest, a conversion is unreproducible — we hit exactly this
with Hornsby, whose source PDF has no recorded provenance.

Write `public/EPI/DCPs/manifests/<instrument-slug>.json` (this directory *is*
committable). Model: `public/EPI/DCPs/manifests/randwick-dcp-2025.json`.

Instrument level: `instrument`, `title`, `council`, `lga`, `kind`, `supersedes`,
`endorsed`, `commenced`, `savings_provision`, `stage_N_pending`, `source_page`,
`retrieved_at`.

Per part: `part` code, `title`, `vintage`, `url`, `file`, `bytes`, `sha256`,
`pages`, `text_chars`, `has_text_layer`.

`commenced` matters especially — it is the correct value for the document's
legal currency date, and nothing else in the pipeline currently captures it
(see §5).

## 2. Download the PDFs

Council sites sit behind bot protection. Randwick's Cloudflare returns **403 to
a bare user-agent and to WebFetch**; it serves 200 only with a full browser
header set. The set that works:

```bash
curl -sL --compressed \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
  -H "Accept: application/pdf,text/html;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: en-AU,en;q=0.9" \
  -H "Referer: <the council DCP page>" \
  -H "Sec-Fetch-Dest: document" -H "Sec-Fetch-Mode: navigate" -H "Sec-Fetch-Site: same-origin" \
  -H "Upgrade-Insecure-Requests: 1" \
  -o "<dest>" "<url>"
```

The `Sec-Fetch-*` headers are the ones that matter. `legislation.nsw.gov.au`
blocks harder and 403s even with these — use the repo's own
`server/utils/nsw-kg/fetchers/legislation-nsw.ts` for LEPs.

Validate every download: HTTP 200, size > 10 KB, and first four bytes `%PDF`.
A Cloudflare challenge page is a valid 200 with HTML in it.

## 3. Pre-flight the text layers

`scripts/docling-extract.py` runs with **`do_ocr = False`** (deliberately —
RapidOCR throws `std::bad_alloc` on large pages on Windows). A scanned,
image-only PDF therefore converts to **nothing, silently**.

Check every part before converting:

```bash
for f in <pdfdir>/*.pdf; do
  txt=$(pdftotext -q "$f" -)
  pages=$(printf '%s' "$txt" | tr -cd '\f' | wc -c)   # one \f per page, incl. last
  chars=$(printf '%s' "$txt" | tr -d '[:space:]' | wc -c)
  echo "$(basename "$f") pages=$pages chars/page=$((chars/pages))"
done
```

Under ~200 chars/page means no usable text layer — that part needs OCR or a
different source. All 43 Randwick parts passed (minimum 472 chars/page).

Note `pdftotext` emits one form feed **per page including the last**, so the
form-feed count *is* the page count. Don't add one. (We did, and briefly
overstated Hornsby as 490 pages against the converter's own correct 489.) For an
authoritative count use `unpdf`'s `getDocumentProxy(...).numPages`.

## 4. Convert: PDF → Markdown + clause-structured HTML

`scripts/dcp-convert.mjs` takes **exactly one `--in` and one `--out`**
(`scripts/dcp-convert.mjs:62-78`). The `.md` and `.html` outputs are therefore
**two separate runs**:

```bash
node scripts/dcp-convert.mjs \
  --in  public/EPI/DCPs/pdf/<source>.pdf \
  --out public/EPI/DCPs/<slug>.md \
  --images <slug>

node scripts/dcp-convert.mjs \
  --in  public/EPI/DCPs/pdf/<source>.pdf \
  --out public/EPI/DCPs/<slug>.html \
  --images <slug>
```

**Always pass `--images` explicitly.** The default image dir is derived by
stripping only `.md` (`scripts/dcp-convert.mjs:64`), so an `.html` run without
it writes images to a directory literally named `<slug>.html`, and the two
format tabs then disagree about where figures live.

Requires `.venv/Scripts/python.exe` with `docling` importable
(`scripts/dcp-convert.mjs:141-148`). `--no-docling` runs without it but loses
real tables, which is the main reason the converter exists — don't use it for a
real conversion. `--docling-json <path>` reuses a cached extraction, worth doing
since Docling runs at 1–8 s/page.

What the HTML carries, and why it matters: `data-number` (clause identity),
`data-rubric` (`controls` / `objectives` / `note` — the routing signal that keeps
objectives out of the rule layer), `data-part`, `data-page-start` / `-end`
(citation deep links). The anchor `id` is authored by `anchorId()`
(`scripts/dcp-convert.mjs:100-128`), which resets clause context at every part
boundary.

### Multi-part DCPs

Most councils publish by part; Hornsby's single "book version" is the
exception. The converter is single-input, so parts are converted individually
and stitched by `scripts/dcp-merge.mjs`.

**Do not register each part as its own instrument** (the `liverpool-gcp-*`
shape). Every part restarts its clause numbering at 1, so "2.1" exists in B2,
C1 and D3 alike; independent instruments would each mint `dcp.2.1` and a
citation could not say which part it meant.

Instead, namespace each part at conversion time and let the merge assert
uniqueness. Three steps:

**(a) Extract every part in one process.** Constructing the Docling converter
loads ~500 MB of layout weights — about two minutes — which dwarfs the
per-page cost of a short part. Batch mode pays it once:

```bash
# one "<pdf>\t<out.json>" line per part
node -e 'const m=require("./public/EPI/DCPs/manifests/<instrument>.json");
  for(const p of m.parts) console.log(`public/EPI/DCPs/pdf/<instrument>/${p.file}\tbuild/dcp-parts/<instrument>/${p.anchor_prefix}.docling.json`)' \
  > build/dcp-parts/<instrument>/jobs.tsv

.venv/Scripts/python.exe scripts/docling-extract.py --batch build/dcp-parts/<instrument>/jobs.tsv
```

Randwick: 43 parts, 1,649 pages, **47.9 min**. Sequential single-PDF runs would
have added ~2 hours of pure model loading.

**(b) Convert each part, namespaced, reusing the cached extraction.**

```bash
node scripts/dcp-convert.mjs \
  --in  public/EPI/DCPs/pdf/<instrument>/<part>.pdf \
  --out build/dcp-parts/<instrument>/<PREFIX>.html \
  --images <instrument> \
  --anchor-prefix "<PREFIX>" \
  --part-label "<C1 Low density residential>" \
  --docling-json build/dcp-parts/<instrument>/<PREFIX>.docling.json
```

`--anchor-prefix C1` makes clause 2.1 `dcp.C1.2.1`. `--part-label` supplies the
council's own wording. Repeat for `.md`. A shared `--images <instrument>`
directory is correct and desirable: images are content-hashed, so letterheads
repeated across parts are written once.

Passing either flag also tells the converter this PDF **is** one part, so it
stops reading depth-1 outline nodes as constituent sub-PDFs — without that, a
part's own top-level sections ("1. Introduction") become bogus `dcp-part`
containers and `data-src` is mislabelled.

**(c) Merge.**

```bash
node scripts/dcp-merge.mjs --manifest public/EPI/DCPs/manifests/<instrument>.json --md
```

This emits one `<article>` carrying `data-parts`, `data-pages`,
`data-commenced` and `data-supersedes`, with one `dcp-part` section per part
stamped with `data-part-code`, `data-anchor-prefix`, `data-vintage` and
`data-source-pages` — the version metadata `instruments.json` has nowhere to
record. **It exits non-zero on any duplicate anchor id**, which is the point:
a duplicate means two clauses answer to one citation.

Namespacing per part rather than de-duplicating in one shared pass also keeps
anchors stable under change. A part's ids depend only on its own content, so
adding Randwick's pending Stage 3 parts, or re-converting one part after an
amendment, cannot renumber citations in any other part.

The doc-viewer needs no change for any of this: its part-based contents groups
purely on the `data-part` string (`app/pages/doc-viewer.vue:358-377`) and is
agnostic to how many PDFs produced it. `scripts/xml-to-html.mjs:183-188` says
so outright — LEPs deliberately omit `data-part` because *"that grouping exists
because a DCP is merged from separate PDFs."*

**Duplicate part codes.** Randwick's own council page labels two different parts
`D3` (2013 Randwick Junction Centre, and Stage-2 Maroubra Junction) while
Stage 2 introduced D2 as Randwick Junction Town Centre. Resolve collisions in
the manifest's `anchor_prefix` — the retained older part became `D3_2013` — so
the decision is recorded data rather than a conversion-time accident.

**Part numbering regimes.** `shared/dcp-part-label.mjs` reports which regime a
label uses: `numeric` (Hornsby's "Part 4", whose clauses are "4.x", so a
heading claiming "3.1" inside Part 4 is a misdetection worth rejecting) or
`coded` (Randwick's "C1", whose clauses restart per part, so there is no prefix
to check and no constraint to apply). Getting this explicit matters — the old
code returned a bare `null` for coded parts, which silently disabled the guard
with no way to tell intent from failure.

## 5. Check conversion quality

```bash
node scripts/score-dcp-md.mjs  --file public/EPI/DCPs/<slug>.md
node scripts/dcp-parse-check.mjs --file public/EPI/DCPs/<slug>.html
```

**Neither is a gate.** Both print diagnostics and always exit 0 — no thresholds,
no CI, and nothing persists the numbers. Read the output yourself, and record it
in the journey log. Always pass `--file`: `dcp-parse-check.mjs:11` defaults to
Hornsby's HTML, and its sample-clause lookup is hardcoded to Hornsby's `4.2.1`
(`:60`), which silently prints nothing for any other council.

What good looks like, using Hornsby as the reference (recomputed by hand, since
no score was ever saved):

| metric | Hornsby DCP 2024 | why it matters |
|---|---|---|
| distinct page markers | **489 of 489 pages** | full per-page provenance. Albury has 646 pages and a single `PAGE: 1` marker — that document cannot deep-link a citation. |
| heading levels | 6 levels, 66.5% top-level share | real hierarchy. 100% single-level means the structure was lost (every pre-rebuild Docling DCP was 100% `##`). |
| tables | 150 `<table>` | tables must be real tables, never prose — the rule layer extracts numbers from cells. |
| clauses with `data-number` | 389 | clause identity for `rule_key` and citations. |
| rubric split | 297 controls / 300 objectives / 170 note | objectives are aids to interpretation, not standards. Extracting them as obligations is a false-positive class. |

## 6. Register and make visible

Two **manual edits, no script**:

1. `public/instruments.json` — add `{slug, title, file, pdf}` under the DCP
   category. That's the whole schema: no parts, no dates, no `supersedes`.
2. `app/utils/instrument-visibility.ts` — add the slug to `VISIBLE_DCP_SLUGS`
   (`:15-17`). Until you do, the document is reachable by direct URL
   (`/doc-viewer?doc=<slug>`) but invisible in `/library` and on the landing
   page, both of which filter through `withVisibleDcpsOnly()`.

If the council should also deep-link from property reports, note that
`app/pages/report.vue:1056-1059` hardcodes `t.includes('hornsby') ?
'hornsby-dcp-2024' : null`.

## 7. Ingest into the knowledge graph

**The DCP path is `scripts/ingest-dcp.ts`, and it is the only code in the repo
that writes the rule layer.** It is deterministic — it reads `data-number` /
`data-rubric` / `data-part` / `data-page-start` straight off the HTML and makes
**zero LLM calls**. No `DEEPINFRA_API_KEY` needed.

Do not try to route DCP HTML through `server/utils/nsw-kg/ingest/orchestrator.ts`
— it handles only `xml` and `structured-md` and throws on anything else
(`orchestrator.ts:79-82`).

Before the first run against any database:

```bash
node scripts/kg-role-check.mjs          # can this role CREATE EXTENSION postgis?
node scripts/apply-nsw-migration.mjs --file db/nsw-schema-migration-05-rule-layer.sql --dry-run
# then 05, 06, 07 for real, in that order
npx tsx scripts/ingest-dcp.ts --file <html> --title <title> --lga <lga> --dry-run
```

`DATABASE_URL` is required by every ingest and diagnostic script but is **not
listed in `.env.example`** — set it explicitly. Do not rely on the
`server/utils/kgPool.ts:26-37` SSH-tunnel fallback: it carries hardcoded host,
user and a private-key path under a different Windows username.

There is **no migration-tracking table** anywhere, so nothing records whether
05/06/07 have already been applied to a given database. `--dry-run` each one
first.

Then run for real and check:

```bash
node scripts/kg-inventory.mjs      # did it write what you expect
node scripts/kg-recall-gaps.mjs dcp
node scripts/triage-empty-rules.mjs
node scripts/triage-prescriptive.mjs
```

### Identity and re-runs — the sharp edge

`scripts/ingest-dcp.ts:226` establishes identity with:

```sql
DELETE FROM nsw.document WHERE title = $1
```

using the `--title` argument verbatim, and `nsw.document` has **no unique
constraint** on `title` (only `id UUID PRIMARY KEY`). So a re-run with a
slightly different title string — "Randwick DCP 2025" vs "Randwick Development
Control Plan 2025" — does not replace the earlier document. It silently creates
a **second, duplicate** one. Pin the exact title string in the manifest and use
it verbatim every time.

### What the rule layer does and does not get

Written by `ingest-dcp.ts`: `document`, `ingest_run`, `section`,
`section_table`, `section_table_cell`, `objective`, `rule`,
`rule_applicability`, `rule_effect`, `proposition` (obvious numerics only),
`audit_finding`.

**Not written for a freshly-ingested document:** `rule_edge` (precedence /
overrides), `rule_spatial_ref` (geometry), `rule_proposition` (the rule →
evidence audit join). Those are reachable only via the one-off pilot importer
`scripts/import-pilot-lep.mjs`. `nsw.priority` is reserved and empty by design.

So after ingest you have grounded, citable controls — but no automated
override resolution and no rule-to-evidence join.

### No date or version modelling

There are **no** `commenced` / `repealed` / `superseded_by` / `effective_from`
/ `version` columns anywhere in `db/nsw-schema.sql` or migrations 01–07. The
single date column, `nsw.document.as_at_date`, is hardcoded to `CURRENT_DATE`
(`ingest-dcp.ts:232`) — the date the ingest *ran*, not the instrument's legal
currency date. The `resolver(property, proposal, date)` in
[rule-layer-pipeline.md](rule-layer-pipeline.md) is design, not code.

Consequence: the graph cannot represent "plan B supersedes plan A from date D,
except these parts." **Ingest only the currently in-force set as one document**
— for Randwick that means DCP 2025 including the three retained 2013 parts,
which is exactly what the manifest describes — and do not ingest the superseded
plan as a second document for the same LGA. Two documents for one LGA with no
supersession relationship double-counts rule coverage with nothing to
disambiguate them.

Also retire the stale entry in `server/utils/nsw-kg/ingest/sources.ts` when a
council's plan is replaced — `randwick-dcp` (`:283-290`) still points at the
2013 markdown and the council's old URL.

## 8. Anti-hallucination gate — what it actually does

Relevant only to the LLM path (LEP/SEPP XML and structured-md), not to
`ingest-dcp.ts`.

`server/utils/nsw-kg/verifiers/precision.ts:29-84` checks that every
proposition's `source_span` is a whitespace-normalised literal substring of the
clause, and that any numeric value appears literally in the span.

It **collects violations and returns them. It does not drop anything.**
`decomposer/decompose-clause.ts` retries once with a correction prompt; if that
still fails it returns `verification: 'flagged'` with the same propositions, and
`ingest/upsert-propositions.ts:69` inserts them with
`verification_status='flagged'`, raising an `nsw.question` row per violation for
human review.

[rule-layer-pipeline.md](rule-layer-pipeline.md) claims such items are
*"dropped, not corrected."* **That is not what the code does.** Treat flagged
propositions as unreviewed until the `nsw.question` queue is worked, and don't
cite the design doc as evidence the numbers are clean.

---

## Checklist

- [ ] Council page read; current instrument, staging, savings provision, pending parts recorded
- [ ] Manifest written to `public/EPI/DCPs/manifests/`, with `commenced` and per-part `vintage`
- [ ] PDFs downloaded and validated (`%PDF`, >10 KB, HTTP 200)
- [ ] Text layers pre-flighted (>200 chars/page for every part)
- [ ] Converted to `.md` and `.html`, `--images` passed explicitly on both runs
- [ ] Multi-part: one merged article, shared anchor state, no duplicate anchors
- [ ] Quality output read and recorded in the journey log
- [ ] `instruments.json` entry added
- [ ] `VISIBLE_DCP_SLUGS` updated
- [ ] Migrations dry-run then applied; `DATABASE_URL` set explicitly
- [ ] `ingest-dcp.ts --dry-run` clean before the real run
- [ ] Exact `--title` string pinned to the manifest
- [ ] Superseded plan not ingested as a competing document; stale `sources.ts` entry retired
- [ ] Acceptance checks run (`kg-inventory`, `kg-recall-gaps`, `triage-*`)
