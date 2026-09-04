"""
Docling extraction sidecar — PDF → structured JSON item stream.

This is deliberately *not* `export_to_markdown()`. That call flattens the
document: it drops per-item page provenance (so citations cannot deep-link
to a page) and, unless heading hierarchy is enabled, collapses every heading
to one level. Both losses are visible in the existing DCP conversions —
albury-dcp-2010 has 646 pages but a single `PAGE: 1` marker, and every
Docling-produced DCP is 100% `##`.

Instead we walk `doc.iterate_items()` and emit one record per item, keeping:
  - `page`  from item.prov[0].page_no   → per-page SRC markers
  - `level` from the iteration depth     → heading hierarchy
  - `md`    from TableItem.export_to_markdown() → real pipe tables

The Node side (scripts/dcp-pdf-to-md.mjs) assembles the markdown, overlays
its own heading levels from the PDF outline / tag tree where those are
better, and merges the extracted images.

Config follows what the heenco pipeline established:
  do_ocr = False                  DCPs have text layers, and RapidOCR throws
                                  std::bad_alloc on large pages on Windows.
  generate_picture_images = False Images come from pdfjs, which is far faster.

Usage:
  python scripts/docling-extract.py --in <pdf> --out <json> [--pages 112-122]

  # Many PDFs, one converter (one model load instead of N):
  python scripts/docling-extract.py --batch jobs.tsv
  # jobs.tsv: one "<pdf>\t<out.json>" line per part
"""
import os
import sys
import json
import time
import argparse

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from pathlib import Path


def label_of(item) -> str:
    lab = getattr(item, "label", None)
    if lab is None:
        return type(item).__name__
    return getattr(lab, "value", None) or str(lab)


def page_of(item):
    prov = getattr(item, "prov", None)
    if not prov:
        return None
    try:
        return prov[0].page_no
    except Exception:
        return None


def table_md(item, doc):
    """Export a TableItem as a markdown pipe table, across API variants."""
    for attempt in (
        lambda: item.export_to_markdown(doc),
        lambda: item.export_to_markdown(),
    ):
        try:
            md = attempt()
            if md:
                return md
        except TypeError:
            continue
        except Exception:
            return None
    return None


def table_html(item, doc):
    """Export a TableItem as HTML.

    Markdown pipe tables cannot express what a DCP control table actually
    carries: `<caption>` binds the table number ("Table 3.1.2-a") that the
    surrounding prose cites, `<th>` distinguishes header cells including
    row headers, and colspan/rowspan record merged cells rather than
    duplicating their values across columns.
    """
    for attempt in (
        lambda: item.export_to_html(doc),
        lambda: item.export_to_html(),
    ):
        try:
            html = attempt()
            if html:
                return html
        except TypeError:
            continue
        except Exception:
            return None
    return None


def table_spans(item):
    """Count merged cells so the run can report what markdown would lose."""
    data = getattr(item, "data", None)
    cells = getattr(data, "table_cells", None) or []
    merged = 0
    for c in cells:
        rs = getattr(c, "row_span", 1) or 1
        cs = getattr(c, "col_span", 1) or 1
        if rs > 1 or cs > 1:
            merged += 1
    return len(cells), merged


def extract_one(conv, pdf: Path, out_path: str, pages, docling, heading_hierarchy) -> int:
    """Extract one PDF using an already-constructed converter.

    Split out of main() so batch mode can reuse one converter across many
    PDFs; `docling` and `heading_hierarchy` are passed in because they are
    established when the converter is built.
    """
    kwargs = {}
    if pages:
        a, _, b = pages.partition("-")
        kwargs["page_range"] = (int(a), int(b or a))

    t0 = time.time()
    try:
        result = conv.convert(pdf, **kwargs)
    except TypeError:
        # Older builds have no page_range; fall back to the whole document.
        kwargs.pop("page_range", None)
        result = conv.convert(pdf)
    doc = result.document
    elapsed = time.time() - t0

    items = []
    tables = 0
    pictures = 0
    merged_tables = 0
    merged_cells = 0
    for item, level in doc.iterate_items():
        lab = label_of(item)
        rec = {"label": lab, "level": level, "page": page_of(item)}

        if lab == "table" or type(item).__name__ == "TableItem":
            md = table_md(item, doc)
            html = table_html(item, doc)
            if md or html:
                if md:
                    rec["md"] = md
                if html:
                    rec["html"] = html
                ncells, nmerged = table_spans(item)
                rec["cells"] = ncells
                if nmerged:
                    rec["merged"] = nmerged
                    merged_tables += 1
                merged_cells += nmerged
                tables += 1
            else:
                rec["label"] = "table_failed"
        elif lab == "picture":
            pictures += 1
        else:
            txt = getattr(item, "text", None)
            if txt:
                rec["text"] = txt

        # Skip records that carry nothing usable.
        if (rec.get("text") or rec.get("md") or rec.get("html")
                or rec["label"] in ("picture", "table_failed")):
            items.append(rec)

    try:
        npages = len(doc.pages) if hasattr(doc, "pages") else 0
    except Exception:
        npages = 0

    out = {
        "meta": {
            "docling": getattr(docling, "__version__", "?"),
            "pages": npages,
            "items": len(items),
            "tables": tables,
            "pictures": pictures,
            "merged_tables": merged_tables,
            "merged_cells": merged_cells,
            "heading_hierarchy": heading_hierarchy,
            "seconds": round(elapsed, 1),
            "pages_with_provenance": len({i["page"] for i in items if i.get("page")}),
        },
        "items": items,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    m = out["meta"]
    sys.stderr.write(
        f"docling {m['docling']}: {m['pages']} pages, {m['items']} items, "
        f"{m['tables']} tables ({m['merged_tables']} with merged cells), {m['pictures']} pictures, "
        f"hierarchy={m['heading_hierarchy']}, "
        f"pages_with_prov={m['pages_with_provenance']}, {m['seconds']}s\n"
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default=None)
    ap.add_argument("--out", dest="out", default=None)
    ap.add_argument("--pages", dest="pages", default=None,
                    help="inclusive 1-based range, e.g. 112-122")
    ap.add_argument("--batch", dest="batch", default=None,
                    help="TSV of '<pdf>\\t<out.json>' lines; extracts all of "
                         "them in this one process")
    args = ap.parse_args()

    # A multi-part DCP is dozens of separate PDFs, and constructing the
    # converter loads ~500 MB of layout weights — about two minutes here,
    # which dwarfs the per-page cost for a short part. Paying that once for
    # 43 parts instead of 43 times is the difference between a ~2 hour job
    # and a ~4 hour one, so batch mode reuses one converter for every PDF.
    jobs: list[tuple[Path, str]] = []
    if args.batch:
        for line in Path(args.batch).read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            src, _, dst = line.partition("\t")
            jobs.append((Path(src.strip()), dst.strip()))
    elif args.inp and args.out:
        jobs.append((Path(args.inp), args.out))
    else:
        ap.error("need --in/--out, or --batch")

    missing = [str(p) for p, _ in jobs if not p.exists()]
    if missing:
        for _, dst in jobs:
            json.dump({"error": f"no such pdf: {missing[0]}"}, open(dst, "w"))
        sys.stderr.write(f"no such pdf: {missing[0]}\n")
        return 1

    import docling
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    opts = PdfPipelineOptions()
    opts.do_ocr = False
    opts.generate_picture_images = False

    # Without this, Docling emits every heading at level 1 and the Markdown
    # comes out flat. Not present in older builds, hence the probe.
    heading_hierarchy = False
    try:
        from docling.datamodel.pipeline_options import HeadingHierarchyOptions
        opts.heading_hierarchy_options = HeadingHierarchyOptions(enabled=True, max_level=6)
        heading_hierarchy = True
    except Exception:
        pass

    conv = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)},
    )

    rc = 0
    for i, (pdf, out_path) in enumerate(jobs, 1):
        if len(jobs) > 1:
            sys.stderr.write(f"[{i}/{len(jobs)}] {pdf.name}: ")
        rc |= extract_one(conv, pdf, out_path, args.pages, docling, heading_hierarchy)
    return rc


if __name__ == "__main__":
    sys.exit(main())
