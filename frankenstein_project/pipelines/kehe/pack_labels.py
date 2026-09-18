"""KeHE case and inner-pack label generation.

Implementations live here; shared models and low-level drawing helpers remain in
``common`` for compatibility and to prevent circular imports.
"""

from __future__ import annotations

import io
from typing import Any, Callable, Dict, List, Optional, Tuple

from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from .common import (
    _boolish,
    _canonical_id,
    _draw_fitted_line,
    _extracted_rows_from_shipments,
    _format_label_date_mmddyyyy,
    _format_lbs,
    _gtin14,
    _match_product_master_row,
    _normalize,
    _normalize_packaging_level,
    _normalize_product_master_rows,
    _only_digits,
    _parse_float,
    _product_dimensions_display,
    _qty_value,
    _truthy,
    build_document_shipments,
    fit_text_lines,
)

_PACK_LABEL_PAGE = (4 * inch, 4 * inch)
_PACK_LABEL_PLACEMENT_NOTE = (
    "Apply GTIN-14 labels on at least two sides of each case, including the longest side; "
    "place the barcode at least 0.25 in from the case-wall edge and 1.25 in from the case bottom."
)
_ITF14_DIGIT_PATTERNS = {
    "0": "nnwwn",
    "1": "wnnnw",
    "2": "nwnnw",
    "3": "wwnnn",
    "4": "nnwnw",
    "5": "wnwnn",
    "6": "nwwnn",
    "7": "nnnww",
    "8": "wnnwn",
    "9": "nwnwn",
}

def _pack_label_kind(packaging_level: str) -> str:
    level = _normalize_packaging_level(packaging_level)
    if level == "Inner Pack":
        return "IP"
    if level == "Case":
        return "MP"
    return "OTHER"


def _is_kehe_pack_label_eligible(product: Dict[str, Any]) -> bool:
    level = _normalize_packaging_level(product.get("packaging_level"))
    return (
        _boolish(product.get("is_active", True), True)
        and level in {"Case", "Inner Pack"}
        and bool(str(product.get("gtin") or "").strip())
    )


def _xml_case_qty(item: Dict[str, Any]) -> int:
    qty = _qty_value(item.get("qty") or item.get("qty_on_pallet") or item.get("total_shipped"))
    if qty <= 0:
        return 1
    return max(1, int(round(qty)))


def _product_case_qty(product: Dict[str, Any]) -> int:
    parsed = _parse_float(product.get("case_qty"))
    if parsed is not None and parsed > 0:
        return max(1, int(round(parsed)))
    level = _normalize_packaging_level(product.get("packaging_level"))
    if level == "Inner Pack":
        return 6
    if level == "Case":
        return 1
    return 1


def _label_weight_lbs(product: Dict[str, Any], case_product: Dict[str, Any]) -> str:
    """Return the printed case/inner weight from the simplified product model."""
    level = _normalize_packaging_level(product.get("packaging_level"))
    if level == "Inner Pack":
        each_weight_g = _parse_float(case_product.get("each_net_weight_g"))
        inner_eaches = _parse_float(product.get("case_qty"))
        if each_weight_g is not None and inner_eaches is not None and each_weight_g > 0 and inner_eaches > 0:
            weight_lbs = (each_weight_g * inner_eaches) / 453.59237
            return f"{weight_lbs:.3f}".rstrip("0").rstrip(".")
        return ""
    return str(case_product.get("gross_weight_lbs") or "").strip()


def _default_copies(product: Dict[str, Any]) -> int:
    parsed = _parse_float(product.get("default_copies"))
    level = _normalize_packaging_level(product.get("packaging_level"))
    if parsed is not None and parsed > 0:
        count = max(1, int(round(parsed)))
        return max(2, count) if level in {"Case", "Inner Pack"} else count
    if level == "Inner Pack":
        return 6
    if level == "Case":
        return 2
    return 1


def _same_sku(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    return bool(str(left.get("sku") or "").strip()) and str(left.get("sku") or "").strip().lower() == str(right.get("sku") or "").strip().lower()


def _find_product_rows_for_xml_item(item: Dict[str, Any], product_rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Return Case row plus related Inner Pack row(s) for an XML item.

    Matching stays aligned with the existing lookup order: XML GTIN/case UPC/UPC/item/SKU,
    then description fallback. Inner Pack rows are derived by SKU from the matched Case row.
    """
    printable = [row for row in product_rows if _is_kehe_pack_label_eligible(row)]
    case_rows = [row for row in printable if _normalize_packaging_level(row.get("packaging_level")) == "Case"]
    inner_rows = [row for row in printable if _normalize_packaging_level(row.get("packaging_level")) == "Inner Pack"]

    case_product = None
    for row in case_rows:
        if _match_product_master_row(item, [row]):
            case_product = row
            break

    if case_product is None:
        return [], None

    related = [case_product]
    for inner in inner_rows:
        if _same_sku(case_product, inner):
            related.append(inner)
    return related, case_product


def build_kehe_pack_label_draft(
    xml_paths: List[str],
    product_master_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Parse XML and product master rows into editable 4 x 4 pack label drafts.

    Only XML-present Case/MP products are output. If the same SKU has an Inner Pack/IP
    row in the master table, related IP labels are also output. Copies are controlled by
    the Product Master Default Copies value. Case Qty prints from Product Master.
    """
    if not xml_paths:
        raise ValueError("At least one XML file is required.")

    result = build_document_shipments(xml_paths)
    shipments = result["shipments"]
    duplicate_files = result["duplicate_files"]
    extracted_headers, extracted_items = _extracted_rows_from_shipments(shipments)
    product_rows = _normalize_product_master_rows(product_master_rows or [])

    if not product_rows:
        # Seed editable rows from XML so the frontend can still open the editor.
        seen: set[str] = set()
        for item in extracted_items:
            gtin = item.get("case_upc") or item.get("upc") or item.get("item_number") or ""
            key = _canonical_id(gtin) or _normalize(item.get("description") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            product_rows.append({
                "line": len(product_rows) + 1,
                "is_active": True,
                "gtin": gtin,
                "description": item.get("description", ""),
                "packaging_level": "Case",
                "length_in": "",
                "width_in": "",
                "height_in": "",
                "gross_weight_lbs": "",
                "case_qty": "1",
                "default_copies": "2",
                "sku": item.get("item_number", ""),
            })

    labels: List[Dict[str, Any]] = []
    warnings: List[str] = []
    if duplicate_files:
        warnings.append(f"Duplicate file(s) skipped: {', '.join(duplicate_files)}")

    label_accumulator: Dict[Tuple[str, str, str, str, str], Dict[str, Any]] = {}

    for item in extracted_items:
        matched_products, case_product = _find_product_rows_for_xml_item(item, product_rows)
        if not matched_products or not case_product:
            continue

        xml_cases = _xml_case_qty(item)
        lot = item.get("lot", "")
        best_before = item.get("expiration_date", "")
        source_file = item.get("source_file", "")

        for product in matched_products:
            level = _normalize_packaging_level(product.get("packaging_level"))
            kind = _pack_label_kind(level)
            if kind not in ("MP", "IP"):
                continue

            label_weight_lbs = _label_weight_lbs(product, case_product)

            label_warnings: List[str] = []
            gtin = _gtin14(product.get("gtin"))
            if len(_only_digits(gtin)) != 14:
                label_warnings.append("GTIN must be 14 digits for ITF-14.")
            if not product.get("description"):
                label_warnings.append("Description is blank.")
            if not label_weight_lbs:
                label_warnings.append("Weight is blank.")

            default_copies = _default_copies(product)
            copies = max(1, xml_cases * default_copies)
            case_qty = str(_product_case_qty(product))

            key = (
                gtin,
                level,
                str(lot or ""),
                str(best_before or ""),
                str(source_file or ""),
            )

            if key in label_accumulator:
                existing = label_accumulator[key]
                existing["copies"] = int(existing.get("copies") or 0) + copies
                continue

            label = {
                "id": f"{kind}-{len(labels) + 1}",
                "status": "Needs Review" if label_warnings else "Ready",
                "print_selected": True,
                "matched_in_xml": True,
                "gtin": gtin,
                "description": product.get("description", ""),
                "brand": "",
                "packaging_level": level,
                "pack_prefix": kind,
                "length_in": product.get("length_in", ""),
                "width_in": product.get("width_in", ""),
                "height_in": product.get("height_in", ""),
                "dimensions_in": _product_dimensions_display(product),
                "gross_weight_lbs": label_weight_lbs,
                "sku": product.get("sku", ""),
                "lot": lot,
                "best_before": best_before,
                "case_qty": case_qty,
                "default_copies": str(default_copies),
                "copies": copies,
                "source_file": source_file,
                "warnings": label_warnings,
            }
            label_accumulator[key] = label
            labels.append(label)

    if not labels:
        warnings.append("No active Case/MP rows with a GTIN were matched from the uploaded XML.")

    return {
        "document_type": "kehe_pack_labels",
        "version": 2,
        "summary": {
            "xml_files": len(xml_paths),
            "labels": len(labels),
            "selected_labels": sum(1 for label in labels if label.get("print_selected")),
            "matched_labels": sum(1 for label in labels if label.get("matched_in_xml")),
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": warnings,
        "product_master": product_rows,
        "extracted_headers": extracted_headers,
        "extracted_items": extracted_items,
        "pack_labels": labels,
    }


def _itf14_runs(value: str, wide_ratio: float = 2.5) -> Tuple[List[Tuple[bool, float]], float]:
    runs: List[Tuple[bool, float]] = []

    def _append(is_bar: bool, width_code: str) -> None:
        runs.append((is_bar, wide_ratio if width_code == "w" else 1.0))

    # Start: narrow bar, narrow space, narrow bar, narrow space.
    for is_bar in (True, False, True, False):
        _append(is_bar, "n")

    for index in range(0, len(value), 2):
        bars = _ITF14_DIGIT_PATTERNS.get(value[index], _ITF14_DIGIT_PATTERNS["0"])
        spaces = _ITF14_DIGIT_PATTERNS.get(value[index + 1], _ITF14_DIGIT_PATTERNS["0"])
        for bar_code, space_code in zip(bars, spaces):
            _append(True, bar_code)
            _append(False, space_code)

    # Stop: wide bar, narrow space, narrow bar.
    _append(True, "w")
    _append(False, "n")
    _append(True, "n")
    total_units = sum(width for _is_bar, width in runs)
    return runs, total_units


def _draw_itf14_centered(c: canvas.Canvas, gtin14: str, x: float, y: float, w: float, h: float) -> None:
    """Draw GTIN-14 as ITF-14.

    ITF-14 uses Interleaved 2 of 5 as the barcode symbology, but the
    case-label presentation needs bearer bars around the barcode.
    """
    value = _gtin14(gtin14)
    if not value:
        return

    # ITF / Interleaved 2 of 5 encodes digit pairs.
    # Valid GTIN-14 is already even length, but keep this fallback safe.
    if len(value) % 2:
        value = "0" + value

    # Bearer bars for ITF-14 case/carton scanning.
    bearer_h = 0.16 * inch
    side_bearer_w = 0.20 * inch
    quiet_zone = 0.25 * inch

    panel_x = x + side_bearer_w
    panel_y = y + bearer_h
    panel_w = max(0.25 * inch, w - (2 * side_bearer_w))
    panel_h = max(0.30 * inch, h - (2 * bearer_h))
    inner_x = panel_x + quiet_zone
    inner_y = y + bearer_h
    inner_w = max(0.25 * inch, panel_w - (2 * quiet_zone))
    inner_h = panel_h

    runs, total_units = _itf14_runs(value)
    unit_w = inner_w / total_units if total_units else 0.0

    # Filled bearer frame, then white symbol field inside it.
    c.setFillColorRGB(0, 0, 0)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.rect(panel_x, panel_y, panel_w, panel_h, stroke=0, fill=1)

    c.setFillColorRGB(0, 0, 0)
    cursor = inner_x
    for is_bar, width_units in runs:
        run_w = width_units * unit_w
        if is_bar and run_w > 0:
            c.rect(cursor, inner_y, run_w, inner_h, stroke=0, fill=1)
        cursor += run_w


def _draw_pack_label_page(c: canvas.Canvas, label: Dict[str, Any]) -> None:
    W, H = _PACK_LABEL_PAGE
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.2)
    c.rect(0.02 * inch, 0.02 * inch, W - 0.04 * inch, H - 0.04 * inch)

    desc = str(label.get("description") or "").upper().strip()
    title_font = 19
    title_lines, fitted_title_font = fit_text_lines(desc, "Helvetica-Bold", title_font, W - 0.22 * inch, 3, min_font_size=7.0)
    y = H - 0.30 * inch
    c.setFillColorRGB(0, 0, 0)
    for line in title_lines:
        c.setFont("Helvetica-Bold", fitted_title_font)
        c.drawCentredString(W / 2, y, line)
        y -= 0.32 * inch * (fitted_title_font / title_font)

    lot = str(label.get("lot") or "").strip()
    best_before = _format_label_date_mmddyyyy(str(label.get("best_before") or ""))
    row_y = 3.04 * inch
    _draw_fitted_line(c, f"LOT# {lot}" if lot else "LOT#", 0.34 * inch, row_y, 1.30 * inch, "Helvetica-Bold", 14, min_font_size=4.0)

    c.setFont("Helvetica-Bold", 14)
    c.drawString(1.76 * inch, row_y, "Best Before:")

    _draw_fitted_line(c, best_before, 3.00 * inch, row_y, W - 3.18 * inch, "Helvetica", 14, min_font_size=7.0)

    # `weight_lbs` is retained only as a historical pack-label draft adapter.
    weight = str(label.get("gross_weight_lbs") or label.get("weight_lbs") or "").strip()
    weight_display = _format_lbs(_parse_float(weight)) if weight else ""
    weight_y = 2.58 * inch
    c.setFont("Helvetica-Bold", 23)
    c.drawRightString(2.10 * inch, weight_y, "WEIGHT:")
    _draw_fitted_line(c, weight_display or weight, 2.20 * inch, weight_y, W - 2.42 * inch, "Helvetica", 23, min_font_size=9.0)

    kind = str(label.get("pack_prefix") or _pack_label_kind(label.get("packaging_level"))).upper()
    qty = str(label.get("case_qty") or "").strip()
    qty_y = 2.24 * inch
    c.setFont("Helvetica-Bold", 23)
    c.drawRightString(2.40 * inch, qty_y, f"{kind} Case Qty:")
    _draw_fitted_line(c, f"{qty} Units" if qty else "Units", 2.50 * inch, qty_y, W - 2.72 * inch, "Helvetica", 23, min_font_size=9.0)

    # ITF-14 barcode with bearer bars and continuous human-readable GTIN.
    gtin = _only_digits(label.get("gtin", ""))

    bx = 0.30 * inch
    bw = W - 0.60 * inch

    hri_strip_h = 0.34 * inch
    hri_y = 0.06 * inch

    barcode_y = hri_y + hri_strip_h
    barcode_h = 1.72 * inch

    # White barcode/HRI panel.
    c.setFillColorRGB(1, 1, 1)
    c.rect(bx, hri_y, bw, hri_strip_h + barcode_h, stroke=0, fill=1)

    _draw_itf14_centered(
        c,
        gtin,
        bx,
        barcode_y,
        bw,
        barcode_h,
    )

    # Human-readable text strip.
    c.setFillColorRGB(1, 1, 1)
    c.rect(bx, hri_y, bw, hri_strip_h, stroke=0, fill=1)

    c.setFillColorRGB(0, 0, 0)
    _draw_fitted_line(c, gtin if gtin else "", W / 2, hri_y + 0.07 * inch, bw - 10, "Helvetica", 21, min_font_size=9.0, align="center")


def render_kehe_pack_label_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render 4 x 4 Master Pack / Inner Pack ITF-14 labels from an edited draft."""
    labels = draft.get("pack_labels") or []
    if not labels:
        raise ValueError("Draft contains no Master Pack / Inner Pack labels to render.")

    selected_labels = [label for label in labels if _truthy(label.get("print_selected", label.get("selected", True)))]
    if not selected_labels:
        raise ValueError("No Pack Labels are selected to print. Check at least one Print checkbox in the Pack Labels editor.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=_PACK_LABEL_PAGE)
    rows: List[Dict[str, Any]] = []
    total_pages = 0
    needs_review = 0

    for label in selected_labels:
        gtin = _gtin14(label.get("gtin"))
        label["gtin"] = gtin
        warnings = label.setdefault("warnings", [])
        status = label.get("status", "Ready")
        if len(_only_digits(gtin)) != 14:
            status = "Needs Review"
            if "GTIN must be 14 digits for ITF-14." not in warnings:
                warnings.append("GTIN must be 14 digits for ITF-14.")
        if not str(label.get("description") or "").strip():
            status = "Needs Review"
            if "Description is blank." not in warnings:
                warnings.append("Description is blank.")
        label["status"] = status
        if status == "Needs Review":
            needs_review += 1
        try:
            copies = max(1, int(str(label.get("copies") or "1").strip() or "1"))
        except (ValueError, TypeError):
            copies = 1
        label["pack_prefix"] = str(label.get("pack_prefix") or _pack_label_kind(label.get("packaging_level"))).upper()
        if label["pack_prefix"] in {"MP", "IP"}:
            copies = max(2, copies)
            label["copies"] = copies
        if progress_callback:
            progress_callback(f"Rendering {label.get('id', 'pack label')} ({copies} copy{'ies' if copies != 1 else ''})...")
        for _ in range(copies):
            _draw_pack_label_page(c, label)
            c.showPage()
            total_pages += 1
        rows.append({
            "document": "Pack Label",
            "status": status,
            "gtin": label.get("gtin", ""),
            "description": label.get("description", ""),
            "packaging_level": label.get("packaging_level", ""),
            "gross_weight_lbs": label.get("gross_weight_lbs", label.get("weight_lbs", "")),
            "case_qty": label.get("case_qty", ""),
            "copies": copies,
            "note": "; ".join(warnings) if warnings else _PACK_LABEL_PLACEMENT_NOTE,
        })

    c.save()
    buf.seek(0)
    with open(out_pdf, "wb") as f:
        f.write(buf.read())

    return {
        "summary": {
            "success": True,
            "labels": len(selected_labels),
            "available_labels": len(labels),
            "pages": total_pages,
            "needs_review": needs_review,
        },
        "rows": rows,
    }


__all__ = [
    "build_kehe_pack_label_draft",
    "render_kehe_pack_label_pdf",
]
