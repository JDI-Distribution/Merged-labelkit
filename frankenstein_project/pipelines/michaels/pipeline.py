"""
label_pipeline.py
-----------------
Full pipeline: XML ASN + UPS shipping label PDF → output PDF
(GS1 label + packing list per pack, with shipping label page prepended).

Works with image-based shipping PDFs (ShipStation / UPS) by using
Tesseract OCR to extract tracking numbers when no text layer is present.

Iteration order: shipping label pages drive the output.
  For each shipping label page (in order):
    1. OCR → extract tracking / PO / store
    2. Find matching XML pack  (tracking → PO → store)
    3. Emit: shipping page  →  GS1 label  →  packing list

Requirements:
    pip install pymupdf reportlab pdf2image pytesseract pillow

    Tesseract OCR (Windows):
        https://github.com/UB-Mannheim/tesseract/wiki

    Poppler (Windows, required by pdf2image):
        https://github.com/oschwartz10612/poppler-windows/releases

Usage:
    python label_pipeline.py \
        --xml "my_asn.xml" \
        --shipping "Label (1).pdf" \
        --out "output.pdf"

    # Multiple XMLs combined:
    python label_pipeline.py \
        --xml "asn1.xml" "asn2.xml" \
        --shipping "Label .pdf" \
        --out "output.pdf"
"""

from __future__ import annotations

import argparse
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

import pymupdf as fitz
from pdf2image import convert_from_path


from .common import (
    Address,
    Item,
    MatchAuditRow,
    MatchFailureError,
    Order,
    PO_RE,
    PageOcrData,
    Pack,
    STORE_RE,
    UPS_RE,
    _first_existing_path,
    _normalise_tracking,
    _pdf2image_kwargs,
    _resolve_poppler_bin_dir,
    _resolve_tesseract_cmd,
    _status_log,
)

from .asn_parser import _parse_shipment_group, parse_asn

from .matcher import (
    _build_match_failure_message,
    _build_match_report,
    _match_pack,
    _pack_debug_label,
    _row_for_report,
    build_pack_indexes,
)
from .ocr import _extract_page_identifiers, _ocr_image, _shipping_page_to_bytes

from .renderers import (
    _bytes_to_fitz,
    format_michaels_item_number,
    format_sscc_groups,
    hard_wrap,
    normalize_sscc,
    render_gs1_label_page,
    render_no_xml_match_page,
    render_packing_list_pages,
    wrap_text,
)

def _render_shipping_label_first(
    fitz_doc: fitz.Document,
    shipping_pdf_path: str,
    all_packs: List[Pack],
    by_tracking: Dict[str, Pack],
    by_po: Dict[str, List[Pack]],
    by_store: Dict[str, List[Pack]],
    by_po_store: Dict[Tuple[str, str], List[Pack]],
    out_pdf: str,
    ocr_dpi: int,
    group_by_shipping_pdf: bool = True,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Iterate shipping label pages one by one.
    For each page:
      1. OCR → tracking / PO / store
      2. Look up matching XML pack  (tracking → PO → store)
      3. Emit: shipping page  →  GS1 label  →  packing list

    Uses fitz (PyMuPDF) for final assembly and avoids cross-document resource
    cross-linking bugs that corrupt page ordering when merging mixed sources.
    """
    n_pages = fitz_doc.page_count
    _status_log(f"  Shipping PDF has {n_pages} page(s). OCR-ing at {ocr_dpi} DPI...")

    pdf2image_kwargs = _pdf2image_kwargs()
    images = convert_from_path(shipping_pdf_path, dpi=ocr_dpi, **pdf2image_kwargs)
    total  = len(images)

    # ── Phase 1: Parallel OCR ─────────────────────────────────────────────
    _status_log(f"  Running OCR on {total} page(s) in parallel…")
    ocr_done  = [0]
    ocr_lock  = threading.Lock()

    def _ocr_one_page(args: Tuple[int, Any]) -> Tuple[int, str, str, str]:
        page_idx, img = args
        raw_text = _ocr_image(img)
        tracking, po, store = _extract_page_identifiers(raw_text)
        if not tracking and not po and not store:
            _status_log(f"  Page {page_idx+1}: nothing at {ocr_dpi} DPI, retrying at 300…")
            hd_imgs = convert_from_path(
                shipping_pdf_path, dpi=300,
                first_page=page_idx + 1, last_page=page_idx + 1,
                **pdf2image_kwargs,
            )
            if hd_imgs:
                raw_text = _ocr_image(hd_imgs[0])
                tracking, po, store = _extract_page_identifiers(raw_text)
        with ocr_lock:
            ocr_done[0] += 1
            done = ocr_done[0]
        if progress_callback:
            progress_callback(f"Scanning labels: {done} of {total} pages OCR'd…")
        return page_idx, tracking, po, store

    workers = min(4, total)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        # map preserves submission order → results[i] corresponds to page i
        ocr_results: List[Tuple[int, str, str, str]] = list(
            executor.map(_ocr_one_page, enumerate(images))
        )

    # ── Phase 2: Sequential match + render ───────────────────────────────
    out_doc         = fitz.open()
    used_pack_ssccs: set[str] = set()
    matched_page_by_sscc: Dict[str, int] = {}
    unmatched_pages: List[int] = []
    unmatched_details: List[PageOcrData] = []
    duplicate_messages: List[str] = []
    report_rows: List[Dict[str, Any]] = []
    bundle_ranges: List[Dict[str, int]] = []
    xml_order_by_pack = {
        (pack.sscc.strip(), pack.po.strip(), pack.store.strip()): index
        for index, pack in enumerate(all_packs)
    }
    order_index = 0

    for page_idx, tracking, po, store in ocr_results:
        # ── Match to XML pack ─────────────────────────────────────────────
        pack, match_method = _match_pack(
            tracking=tracking,
            po=po,
            store=store,
            by_tracking=by_tracking,
            by_po=by_po,
            by_store=by_store,
            by_po_store=by_po_store,
        )

        # ── Log ───────────────────────────────────────────────────────────
        ocr_tag = tracking or (f"PO={po}" if po else "") or (f"store={store}" if store else "") or "⚠ nothing"
        page_data = PageOcrData(page_idx=page_idx, tracking=tracking, po=po, store=store)

        # ── Progress callback ─────────────────────────────────────────────
        if progress_callback:
            matched_so_far = len(matched_page_by_sscc)
            progress_callback(
                f"Rendering page {page_idx + 1} of {total} — "
                f"{matched_so_far} matched so far…"
            )

        if pack and pack.sscc in matched_page_by_sscc:
            first_page = matched_page_by_sscc[pack.sscc]
            duplicate_note = f"Duplicate of label page {first_page}"
            duplicate_messages.append(
                f"- Label page {page_idx + 1} duplicated XML pack already used by label page {first_page}: "
                f"{_pack_debug_label(pack)}"
            )
            report_rows.append(
                _row_for_report(page_idx + 1, "duplicate", tracking, po, store, pack, match_method, duplicate_note)
            )
            unmatched_pages.append(page_idx + 1)
            unmatched_details.append(page_data)
            _status_log(
                f"  Page {page_idx+1:>3}  OCR={ocr_tag:<22}  →  ⚠ duplicate XML match "
                f"(already used on page {first_page})"
            )
            pack = None
        elif pack:
            matched_page_by_sscc[pack.sscc] = page_idx + 1
            order_index += 1
            report_rows.append(
                _row_for_report(page_idx + 1, "matched", tracking, po, store, pack, match_method, "Matched successfully")
            )
            _status_log(
                f"  Page {page_idx+1:>3}  OCR={ocr_tag:<22}  →  PO={pack.po}  store={pack.store}"
                f"  [{match_method}]"
            )
            used_pack_ssccs.add(pack.sscc)
        else:
            report_rows.append(
                _row_for_report(page_idx + 1, "unmatched", tracking, po, store, None, "", "No XML pack matched this label")
            )
            unmatched_pages.append(page_idx + 1)
            unmatched_details.append(page_data)
            _status_log(f"  Page {page_idx+1:>3}  OCR={ocr_tag:<22}  →  ⚠ no XML match")

        # ── 1. Shipping page — rasterised, guaranteed exactly one page ────
        bundle_start = out_doc.page_count
        ship_bytes = _shipping_page_to_bytes(fitz_doc, page_idx)
        ship_fitz  = _bytes_to_fitz(ship_bytes)
        out_doc.insert_pdf(ship_fitz, from_page=0, to_page=0)
        ship_fitz.close()

        # ── 2. GS1 label — always exactly one page ────────────────────────
        if pack:
            pack_key = (pack.sscc.strip(), pack.po.strip(), pack.store.strip())
            render_order_index = (
                order_index
                if group_by_shipping_pdf
                else xml_order_by_pack.get(pack_key, order_index - 1) + 1
            )
            gs1_bytes = render_gs1_label_page(pack, order_index=render_order_index, total_orders=total)
        else:
            pd_obj    = PageOcrData(page_idx=page_idx, tracking=tracking, po=po, store=store)
            gs1_bytes = render_no_xml_match_page(pd_obj)
        gs1_fitz = _bytes_to_fitz(gs1_bytes)
        out_doc.insert_pdf(gs1_fitz, from_page=0, to_page=0)
        gs1_fitz.close()

        # ── 3. Packing list — one or more pages ───────────────────────────
        if pack:
            pl_bytes = render_packing_list_pages(pack, order_index=render_order_index, total_orders=total)
            pl_fitz  = _bytes_to_fitz(pl_bytes)
            out_doc.insert_pdf(pl_fitz)          # all pages
            pl_fitz.close()
            bundle_ranges.append(
                {
                    "label_page": page_idx + 1,
                    "rank": render_order_index,
                    "from_page": bundle_start,
                    "to_page": out_doc.page_count - 1,
                }
            )

    unused_packs = []
    seen_unused_ssccs: set[str] = set()
    for pack in all_packs:
        if pack.sscc in used_pack_ssccs or pack.sscc in seen_unused_ssccs:
            continue
        seen_unused_ssccs.add(pack.sscc)
        unused_packs.append(pack)

    if unmatched_pages:
        _status_log(
            f"\n⚠  {len(unmatched_pages)} shipping page(s) had no XML match: "
            f"{unmatched_pages}"
        )
    if unused_packs:
        _status_log(
            f"\n⚠  {len(unused_packs)} XML pack(s) had no shipping label page: "
            f"{[_pack_debug_label(pack) for pack in unused_packs[:10]]}"
        )

    output_order = "Uploaded PDF order" if group_by_shipping_pdf else "ASN XML order"
    report = _build_match_report(
        report_rows,
        all_packs,
        used_pack_ssccs,
        n_pages,
        output_order=output_order,
    )

    if unmatched_pages or unused_packs or duplicate_messages:
        out_doc.close()
        raise MatchFailureError(
            _build_match_failure_message(
                unmatched_details,
                all_packs,
                used_pack_ssccs,
                duplicate_messages=duplicate_messages,
            ),
            report=report,
        )

    if not group_by_shipping_pdf:
        xml_order_doc = fitz.open()
        next_output_page = 0
        for bundle in sorted(bundle_ranges, key=lambda item: item["rank"]):
            from_page = bundle["from_page"]
            to_page = bundle["to_page"]
            xml_order_doc.insert_pdf(out_doc, from_page=from_page, to_page=to_page)
            bundle["final_from_page"] = next_output_page
            bundle["final_to_page"] = next_output_page + (to_page - from_page)
            next_output_page = bundle["final_to_page"] + 1
        out_doc.close()
        out_doc = xml_order_doc
    else:
        for bundle in bundle_ranges:
            bundle["final_from_page"] = bundle["from_page"]
            bundle["final_to_page"] = bundle["to_page"]

    output_range_by_label = {bundle["label_page"]: bundle for bundle in bundle_ranges}
    for row in report_rows:
        bundle = output_range_by_label.get(int(row.get("label_page") or 0))
        if bundle:
            row["output_start_page"] = bundle["final_from_page"] + 1
            row["output_end_page"] = bundle["final_to_page"] + 1

    out_doc.save(out_pdf, garbage=4, deflate=True)
    out_doc.close()
    _status_log(f"\n✓  All {n_pages} shipping page(s) matched to XML packs.")
    return report


# ===========================================================================
# Public API
# ===========================================================================

def run_pipeline(
    xml_paths: List[str],
    out_pdf: str,
    shipping_pdf_path: Optional[str] = None,
    ocr_dpi: int = 200,
    group_by_shipping_pdf: bool = True,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    all_packs: List[Pack] = []
    for xp in xml_paths:
        _status_log(f"Parsing XML: {xp}")
        _orders, packs = parse_asn(xp)
        all_packs.extend(packs)

    # Deduplicate by (sscc, po, store)
    seen_keys: set = set()
    deduped: List[Pack] = []
    for p in all_packs:
        key = (p.sscc.strip(), p.po.strip(), p.store.strip())
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(p)
    if len(deduped) < len(all_packs):
        _status_log(f"  Removed {len(all_packs) - len(deduped)} duplicate pack(s).")
    all_packs = deduped
    _status_log(f"  Total packs in XML: {len(all_packs)}")

    if shipping_pdf_path:
        by_tracking, by_po, by_store, by_po_store = build_pack_indexes(all_packs)
        fitz_doc = fitz.open(shipping_pdf_path)
        _status_log(f"\nRendering output PDF: {out_pdf}")
        report = _render_shipping_label_first(
            fitz_doc           = fitz_doc,
            shipping_pdf_path  = shipping_pdf_path,
            all_packs          = all_packs,
            by_tracking        = by_tracking,
            by_po              = by_po,
            by_store           = by_store,
            by_po_store        = by_po_store,
            out_pdf            = out_pdf,
            ocr_dpi            = ocr_dpi,
            group_by_shipping_pdf = group_by_shipping_pdf,
            progress_callback  = progress_callback,
        )
    else:
        # No shipping PDF — just GS1 + packing list, assembled with fitz
        _status_log(f"Rendering output PDF (no shipping labels): {out_pdf}")
        out_doc = fitz.open()
        total   = len(all_packs)
        report_rows: List[Dict[str, Any]] = []
        for i, pack in enumerate(all_packs, start=1):
            gs1_bytes = render_gs1_label_page(pack, order_index=i, total_orders=total)
            gs1_fitz  = _bytes_to_fitz(gs1_bytes)
            out_doc.insert_pdf(gs1_fitz, from_page=0, to_page=0)
            gs1_fitz.close()
            pl_bytes = render_packing_list_pages(pack, order_index=i, total_orders=total)
            pl_fitz  = _bytes_to_fitz(pl_bytes)
            out_doc.insert_pdf(pl_fitz)
            pl_fitz.close()
            report_rows.append(
                _row_for_report(i, "matched", "", pack.po, pack.store, pack, "No shipping PDF", "Generated from XML only")
            )
        out_doc.save(out_pdf, garbage=4, deflate=True)
        out_doc.close()
        report = _build_match_report(report_rows, all_packs, {p.sscc for p in all_packs}, len(report_rows))

    _status_log(f"✓  Done → {out_pdf}")
    return report


# ===========================================================================
# CLI C:\Users\JDID Employee\Downloads\label-app\label-app\src\label_pipeline.py
# ===========================================================================

def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Generate label + packing list PDF from ASN XML"
    )
    parser.add_argument("--xml",      nargs="+", required=True, help="ASN XML file(s)")
    parser.add_argument("--shipping", help="UPS shipping label PDF (image-based OK)")
    parser.add_argument("--out",      required=True, help="Output PDF path")
    parser.add_argument("--dpi",      type=int, default=300, help="OCR DPI (default 300)")
    parser.add_argument(
        "--asn-order",
        action="store_true",
        help="Arrange matched document groups in ASN XML order instead of shipping-PDF order",
    )
    args = parser.parse_args(argv)

    run_pipeline(
        xml_paths         = args.xml,
        out_pdf           = args.out,
        shipping_pdf_path = args.shipping,
        ocr_dpi           = args.dpi,
        group_by_shipping_pdf = not args.asn_order,
    )


if __name__ == "__main__":
    main()
