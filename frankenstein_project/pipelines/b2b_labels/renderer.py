"""Render the customer-specific B2B case-pack labels captured in the source workbook.

The workbook contains several genuinely different physical labels.  This module
keeps the renderers separate while sharing pagination, text wrapping, and barcode
helpers.  Product values are supplied by Product Master; job values remain
run-specific and are never written back by the renderer.
"""

from __future__ import annotations

import io
import re
from functools import partial
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Tuple

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import createBarcodeDrawing
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from pipelines.kehe.common import _draw_pack_label_page, _render_pallet_label_page


SUPPORTED_RENDERERS = {
    "bulk_further_processing_4x6",
    "compact_case_3x3",
    "decopac_case_4x6",
    "disney_case_3x3",
    "fancy_pallet_3x3",
    "mixed_case_3x1_5",
    "standard_case_4x6",
    "standard_case_vertical_4x6",
    "total_wine_kehe_pack_4x4",
    "total_wine_kehe_pallet_4x6",
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", _text(value))


def _with_unit(value: Any, unit: str) -> str:
    text = _text(value)
    if not text or re.search(r"[A-Za-z]", text):
        return text
    return f"{text} {unit}"


def _positive_int(value: Any, default: int = 1) -> int:
    try:
        parsed = int(float(_text(value)))
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def _wrap(text: str, font: str, size: float, max_width: float, max_lines: int = 4) -> List[str]:
    words = _text(text).split()
    if not words:
        return []
    lines: List[str] = []
    current = ""
    for word in words:
        pieces = [word]
        if stringWidth(word, font, size) > max_width:
            pieces = []
            piece = ""
            for char in word:
                candidate = piece + char
                if piece and stringWidth(candidate, font, size) > max_width:
                    pieces.append(piece)
                    piece = char
                else:
                    piece = candidate
            if piece:
                pieces.append(piece)
        for piece in pieces:
            candidate = f"{current} {piece}".strip()
            if not current or stringWidth(candidate, font, size) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = piece
    if current:
        lines.append(current)
    return lines


def _fit_lines(
    text: Any,
    font: str,
    size: float,
    max_width: float,
    max_lines: int,
    *,
    min_size: float = 3.5,
) -> Tuple[List[str], float]:
    fitted_size = size
    while fitted_size > min_size:
        lines = _wrap(_text(text), font, fitted_size, max_width, max_lines=max_lines)
        if len(lines) <= max_lines:
            return lines, fitted_size
        fitted_size = max(min_size, fitted_size - 0.5)
    return _wrap(_text(text), font, fitted_size, max_width, max_lines=max_lines), fitted_size


def _draw_fitted_line(
    c: canvas.Canvas,
    text: Any,
    x: float,
    y: float,
    max_width: float,
    *,
    font: str = "Helvetica",
    size: float = 10,
    min_size: float = 4.0,
    align: str = "left",
) -> None:
    value = _text(text)
    fitted_size = size
    while fitted_size > min_size and stringWidth(value, font, fitted_size) > max_width:
        fitted_size = max(min_size, fitted_size - 0.5)
    c.setFont(font, fitted_size)
    if align == "center":
        c.drawCentredString(x, y, value)
    elif align == "right":
        c.drawRightString(x, y, value)
    else:
        c.drawString(x, y, value)


def _draw_wrapped(
    c: canvas.Canvas,
    text: Any,
    x: float,
    y: float,
    max_width: float,
    *,
    font: str = "Helvetica",
    size: float = 10,
    leading: float | None = None,
    max_lines: int = 4,
    centered: bool = False,
) -> float:
    lines, fitted_size = _fit_lines(text, font, size, max_width, max_lines)
    fitted_leading = (leading or size * 1.18) * (fitted_size / size)
    for line in lines:
        c.setFont(font, fitted_size)
        if centered:
            c.drawCentredString(x + (max_width / 2), y, line)
        else:
            c.drawString(x, y, line)
        y -= fitted_leading
    return y


def _draw_wrapped_in_box(
    c: canvas.Canvas,
    text: Any,
    x: float,
    top_y: float,
    max_width: float,
    bottom_y: float,
    *,
    font: str = "Helvetica",
    size: float = 10,
    max_lines: int = 4,
    centered: bool = False,
) -> float:
    """Fit all text inside an explicit vertical box without clipping."""
    fitted_size = size
    lines: List[str] = []
    leading = size * 1.18
    while fitted_size >= 2.5:
        lines = _wrap(text, font, fitted_size, max_width, max_lines=9999)
        leading = fitted_size * 1.18
        needed = fitted_size + max(0, len(lines) - 1) * leading
        if len(lines) <= max_lines and needed <= max(0, top_y - bottom_y):
            break
        fitted_size -= 0.5
    fitted_size = max(2.5, fitted_size)
    c.setFont(font, fitted_size)
    y = top_y
    for line in lines:
        if centered:
            c.drawCentredString(x + max_width / 2, y, line)
        else:
            c.drawString(x, y, line)
        y -= leading
    return y


def _draw_value_row(
    c: canvas.Canvas,
    label: str,
    value: Any,
    x: float,
    y: float,
    width: float,
    *,
    size: float = 9,
    label_width: float = 0.88 * inch,
) -> float:
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, label)
    c.setFont("Helvetica", size)
    return _draw_wrapped(c, value, x + label_width, y, width - label_width, size=size, max_lines=2)


def _draw_border(c: canvas.Canvas, width: float, height: float, inset: float = 0.08 * inch) -> None:
    c.setLineWidth(1.2)
    c.rect(inset, inset, width - (2 * inset), height - (2 * inset), stroke=1, fill=0)


def _draw_barcode(
    c: canvas.Canvas,
    value: Any,
    barcode_type: Any,
    x: float,
    y: float,
    max_width: float,
    max_height: float,
) -> None:
    digits = _digits(value)
    kind = _text(barcode_type).upper().replace("-", "_")
    if not digits or kind in {"", "NONE"}:
        return

    code_name = "Code128"
    encoded = digits
    if kind in {"UPC", "UPC_A", "UPCA"} and len(digits) == 12:
        code_name = "UPCA"
    elif kind in {"EAN", "EAN_13", "EAN13"} and len(digits) == 13:
        code_name = "EAN13"

    try:
        drawing = createBarcodeDrawing(
            code_name,
            value=encoded,
            humanReadable=True,
            barHeight=max_height,
        )
    except Exception:
        drawing = createBarcodeDrawing(
            "Code128",
            value=encoded,
            humanReadable=True,
            barHeight=max_height,
        )

    scale = min(max_width / drawing.width, max_height / drawing.height, 1.0)
    draw_width = drawing.width * scale
    c.saveState()
    c.translate(x + ((max_width - draw_width) / 2), y)
    c.scale(scale, scale)
    renderPDF.draw(drawing, c, 0, 0)
    c.restoreState()


def _product(job: Dict[str, Any]) -> Dict[str, Any]:
    value = job.get("product")
    return value if isinstance(value, dict) else {}


def _directory(job: Dict[str, Any]) -> Dict[str, Any]:
    value = job.get("directory")
    return value if isinstance(value, dict) else {}


def _run(job: Dict[str, Any]) -> Dict[str, Any]:
    value = job.get("run")
    return value if isinstance(value, dict) else {}


def _job_value(job: Dict[str, Any], *keys: str, default: str = "") -> str:
    for source in (_run(job), _product(job), _directory(job), job):
        for key in keys:
            value = source.get(key)
            if _text(value):
                return _text(value)
    return default


def _qty_or_pack_text(
    job: Dict[str, Any],
    *,
    qty_prefix: str = "",
    qty_suffix: str = "",
    default: str = "",
) -> str:
    qty_value = _job_value(job, "case_qty", "qty", "quantity", "pack_qty")
    if qty_value:
        return f"{qty_prefix}{qty_value}{qty_suffix}".strip()
    return default


def _carton_text(carton_number: int, carton_total: int) -> str:
    return f"Box {carton_number} of {carton_total}"


def _boolish(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return _text(value).lower() in {"1", "true", "yes", "y", "on", "checked"}


def _barcode_requested(job: Dict[str, Any]) -> bool:
    for source in (_run(job), job):
        if "print_barcode" in source:
            return _boolish(source.get("print_barcode"), False)
    return False


def _draw_decopac_panel(
    c: canvas.Canvas,
    job: Dict[str, Any],
    carton: int,
    total: int,
    width: float,
    height: float,
    *,
    detail_panel: bool,
) -> None:
    """Draw one half of the supplied DecoPac A/B combined 4x6 label."""
    margin = 0.10 * inch
    c.setLineWidth(0.8)
    c.rect(0.02 * inch, 0.02 * inch, width - 0.04 * inch, height - 0.04 * inch)
    _draw_fitted_line(c, _job_value(job, "manufacturer_name", "name", default="DECOPAC, INC").upper(), margin, height - 0.24 * inch, width * 0.35, font="Helvetica-Bold", size=11)
    _draw_fitted_line(c, _job_value(job, "delivery_address", default="ANOKA, MN USA").replace("\n", " "), margin, height - 0.50 * inch, width * 0.38, font="Helvetica-Bold", size=8)
    if _barcode_requested(job):
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), width * 0.42, height - 0.65 * inch, width * 0.54, 0.55 * inch)

    y = height - 0.78 * inch
    y = _draw_value_row(c, "ITEM#", _job_value(job, "customer_item_number", "sku"), margin, y, width - 2 * margin, size=7.7, label_width=0.82 * inch)
    y = _draw_value_row(c, "DESCRIPTION:", _job_value(job, "description"), margin, y, width - 2 * margin, size=7.7, label_width=0.82 * inch)
    y = _draw_value_row(c, "QTY:", _qty_or_pack_text(job, qty_prefix="Master Carton of ", default="Master Carton"), margin, y, width - 2 * margin, size=7.5, label_width=0.82 * inch)
    if detail_panel:
        item_weight = _with_unit(_job_value(job, "each_net_weight_g"), "g")
        case_weight = _with_unit(_job_value(job, "package_net_weight_g"), "g")
        dimensions = " x ".join(filter(None, [_job_value(job, "length_in"), _job_value(job, "width_in"), _job_value(job, "height_in")]))
        y = _draw_value_row(c, "NET ITEM:", item_weight, margin, y, width - 2 * margin, size=7.2, label_width=0.82 * inch)
        y = _draw_value_row(c, "NET CASE:", case_weight, margin, y, width - 2 * margin, size=7.2, label_width=0.82 * inch)
        _draw_value_row(c, "DIMENSIONS:", f"{dimensions} in" if dimensions else "", margin, y, width - 2 * margin, size=7.2, label_width=0.82 * inch)
    else:
        y = _draw_value_row(c, "PO#:", _job_value(job, "po_number"), margin, y, width - 2 * margin, size=7.5, label_width=0.82 * inch)
        y = _draw_value_row(c, "LOT#:", _job_value(job, "lot_number"), margin, y, width - 2 * margin, size=7.5, label_width=0.82 * inch)
        _draw_fitted_line(c, _job_value(job, "country_of_origin", default="Made in the USA"), margin, y, width * 0.52, font="Helvetica-Bold", size=7.5)
    _draw_fitted_line(c, f"Carton No.  {carton} of {total}", width - margin, 0.10 * inch, width * 0.40, font="Helvetica-Bold", size=8.5, align="right")


def _draw_decopac(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Render the required A and B DecoPac panels together on one 4x6 page."""
    panel_h = height / 2
    c.saveState()
    c.translate(0, panel_h)
    _draw_decopac_panel(c, job, carton, total, width, panel_h, detail_panel=False)
    c.restoreState()
    _draw_decopac_panel(c, job, carton, total, width, panel_h, detail_panel=True)


def _draw_compact_case_panel(
    c: canvas.Canvas,
    job: Dict[str, Any],
    carton: int,
    total: int,
    width: float,
    height: float,
    *,
    customer_default: str,
    show_invoice: bool = False,
    show_barcode: bool = False,
) -> None:
    _draw_border(c, width, height, inset=0.06 * inch)
    margin = 0.14 * inch
    customer = _job_value(job, "name", "storefront", default=customer_default)
    _draw_fitted_line(c, customer.upper(), width / 2, height - 0.28 * inch, width - 2 * margin, font="Helvetica-Bold", size=13, align="center")
    c.line(margin, height - 0.38 * inch, width - margin, height - 0.38 * inch)

    y = height - 0.60 * inch
    y = _draw_wrapped(c, _job_value(job, "description"), margin, y, width - 2 * margin, font="Helvetica-Bold", size=10, centered=True, max_lines=3)
    y -= 0.02 * inch
    y = _draw_value_row(c, "SKU:", _job_value(job, "sku", "customer_item_number"), margin, y, width - 2 * margin, size=8, label_width=0.44 * inch)
    y = _draw_value_row(c, "PO:", _job_value(job, "po_number"), margin, y, width - 2 * margin, size=8, label_width=0.44 * inch)
    if show_invoice and _job_value(job, "invoice_number"):
        y = _draw_value_row(c, "INV:", _job_value(job, "invoice_number"), margin, y, width - 2 * margin, size=8, label_width=0.44 * inch)
    pack = _qty_or_pack_text(job)
    y = _draw_value_row(c, "PACK:", pack, margin, y, width - 2 * margin, size=8, label_width=0.50 * inch)

    show_barcode = show_barcode or _barcode_requested(job)
    _draw_fitted_line(c, _carton_text(carton, total), width / 2, 0.72 * inch if show_barcode else 0.34 * inch, width - 2 * margin, font="Helvetica-Bold", size=14, align="center")
    if show_barcode:
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), margin, 0.10 * inch, width - 2 * margin, 0.48 * inch)


def _draw_compact_case(
    c: canvas.Canvas,
    job: Dict[str, Any],
    carton: int,
    total: int,
    width: float,
    height: float,
    *,
    customer_default: str,
    show_invoice: bool = False,
    show_barcode: bool = False,
) -> None:
    """Render two intentionally repeated case-label panels on one 4x6 page."""
    panel_w = width / 2
    for panel_index in range(2):
        c.saveState()
        c.translate(panel_index * panel_w, 0)
        _draw_compact_case_panel(
            c,
            job,
            carton,
            total,
            panel_w,
            height,
            customer_default=customer_default,
            show_invoice=show_invoice,
            show_barcode=show_barcode,
        )
        c.restoreState()


def _draw_disney(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height, inset=0.06 * inch)
    margin = 0.14 * inch
    _draw_fitted_line(c, _job_value(job, "name", "storefront", default="DISNEY").upper(), width / 2, height - 0.30 * inch, width - 2 * margin, font="Helvetica-Bold", size=14, align="center")
    c.line(margin, height - 0.41 * inch, width - margin, height - 0.41 * inch)
    item_description = " - ".join(filter(None, [
        _job_value(job, "customer_item_number"),
        _job_value(job, "description"),
    ]))
    _draw_wrapped(c, item_description, margin, height - 0.72 * inch, width - 2 * margin, font="Helvetica-Bold", size=11, centered=True, max_lines=3)
    _draw_fitted_line(c, f"PO # {_job_value(job, 'po_number')}", width / 2, height - 1.38 * inch, width - 2 * margin, font="Helvetica-Bold", size=10, align="center")
    _draw_fitted_line(c, _carton_text(carton, total), width / 2, height - 1.80 * inch, width - 2 * margin, font="Helvetica-Bold", size=15, align="center")
    barcode = _barcode_requested(job)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(width / 2, 0.88 * inch if barcode else height - 2.20 * inch, "EXPECTED DELIVERY BY")
    _draw_fitted_line(c, _job_value(job, "expected_delivery_date"), width / 2, 0.66 * inch if barcode else height - 2.48 * inch, width - 2 * margin, font="Helvetica-Bold", size=12, align="center")
    if barcode:
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), margin, 0.08 * inch, width - 2 * margin, 0.40 * inch)


def _draw_fancy_pallet(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Render the supplied editable Fancy Sprinkles 3x3 pallet label."""
    _draw_border(c, width, height, inset=0.05 * inch)
    margin = 0.13 * inch
    rows = [
        ("DATE:", _job_value(job, "ship_date", "expected_delivery_date")),
        ("SKU:", _job_value(job, "sku", "customer_item_number")),
        ("NAME:", _job_value(job, "description")),
        ("QTY:", _job_value(job, "quantity_label", "qty", default=_qty_or_pack_text(job))),
        ("LOT CODE:", _job_value(job, "lot_number")),
        ("BB DATE:", _job_value(job, "best_before")),
    ]
    y = height - 0.34 * inch
    for label, value in rows:
        y = _draw_value_row(c, label, value, margin, y, width - 2 * margin, size=12.5, label_width=1.08 * inch)
        y -= 0.03 * inch
    if total > 1:
        _draw_fitted_line(c, f"Pallet {carton} of {total}", width - margin, 0.12 * inch, width * 0.48, font="Helvetica-Bold", size=7.5, align="right")


def _draw_total_wine_kehe_pack(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Adapt a B2B/order job to the existing KeHE MP/IP renderer."""
    level = _job_value(job, "packaging_level", default="Case")
    kind = "IP" if level.strip().lower().startswith("inner") else "MP"
    label = {
        "description": _job_value(job, "description"),
        "gtin": _job_value(job, "gtin") if _barcode_requested(job) else "",
        "packaging_level": level,
        "pack_prefix": kind,
        "lot": _job_value(job, "lot_number"),
        "best_before": _job_value(job, "best_before"),
        "gross_weight_lbs": _job_value(job, "gross_weight_lbs", "weight_lbs"),
        "case_qty": _job_value(job, "case_qty"),
    }
    _draw_pack_label_page(c, label)


def _draw_total_wine_kehe_pallet(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Adapt a B2B/order job to the existing KeHE pallet-placard renderer."""
    pallet = {
        "id": f"TW-PALLET-{carton}",
        "status": "Ready" if _job_value(job, "delivery_address", "ship_to") and _job_value(job, "po_number") else "Needs Review",
        "expected_delivery_date": _job_value(job, "ship_date", "expected_delivery_date"),
        "ship_from": _job_value(job, "manufacturer_address", "ship_from"),
        "ship_to": _job_value(job, "delivery_address", "ship_to"),
        "pallet_number": str(carton),
        "total_pallets": str(total),
        "customer_po_numbers": _job_value(job, "po_number", "order_number"),
    }
    _render_pallet_label_page(c, pallet)


def _draw_mixed(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height, inset=0.04 * inch)
    margin = 0.10 * inch
    _draw_fitted_line(c, _job_value(job, "storefront", default="BAKELL MIXED CASE").upper(), margin, height - 0.18 * inch, width * 0.55, font="Helvetica-Bold", size=8)
    _draw_fitted_line(c, _carton_text(carton, total), width - margin, height - 0.18 * inch, width * 0.35, font="Helvetica-Bold", size=8, align="right")
    _draw_wrapped(c, _job_value(job, "description"), margin, height - 0.39 * inch, width - 2 * margin, font="Helvetica-Bold", size=11, centered=True, max_lines=2)
    barcode = _barcode_requested(job)
    footer_width = (width * 0.45) if barcode else (width - 2 * margin)
    _draw_fitted_line(c, f"SKU: {_job_value(job, 'sku', 'customer_item_number')}", margin, 0.27 * inch, footer_width, size=7.5)
    if not barcode:
        _draw_fitted_line(c, _qty_or_pack_text(job, qty_suffix=" units"), width - margin, 0.27 * inch, width * 0.30, size=7.5, align="right")
    _draw_fitted_line(c, f"PO: {_job_value(job, 'po_number')}", margin, 0.10 * inch, footer_width, size=7)
    if barcode:
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), width * 0.50, 0.06 * inch, width * 0.46, 0.36 * inch)


def _draw_standard_case_panel(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    margin = min(0.18 * inch, width * 0.06)
    _draw_border(c, width, height, inset=0.04 * inch)
    barcode = _barcode_requested(job)
    pack = _qty_or_pack_text(job, qty_suffix=" units", default="Units per case")
    if height <= 2.25 * inch:
        _draw_fitted_line(c, _carton_text(carton, total), width / 2, height - 0.27 * inch, width - 2 * margin, font="Helvetica-Bold", size=13, align="center")
        po_number = _job_value(job, "po_number", "order_number")
        _draw_fitted_line(c, f"PO # {po_number}" if po_number else "", width / 2, height - 0.55 * inch, width - 2 * margin, font="Helvetica-Bold", size=9, align="center")
        _draw_wrapped_in_box(
            c,
            _job_value(job, "description"),
            margin,
            height - 0.82 * inch,
            width - 2 * margin,
            0.88 * inch,
            font="Helvetica-Bold",
            size=8.5,
            max_lines=4,
            centered=True,
        )
        _draw_fitted_line(c, pack, width / 2, 0.50 * inch if barcode else 0.28 * inch, width - 2 * margin, font="Helvetica-Bold", size=8.5, align="center")
        if barcode:
            _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), width * 0.34, 0.05 * inch, width * 0.32, 0.30 * inch)
        return
    _draw_fitted_line(c, _carton_text(carton, total), width / 2, height - 0.38 * inch, width - 2 * margin, font="Helvetica-Bold", size=20, align="center")
    po_number = _job_value(job, "po_number", "order_number")
    _draw_fitted_line(c, f"PO # {po_number}" if po_number else "", width / 2, height - 0.78 * inch, width - 2 * margin, font="Helvetica-Bold", size=13, align="center")
    _draw_wrapped(c, _job_value(job, "description"), margin, height - 1.18 * inch, width - 2 * margin, font="Helvetica-Bold", size=11, centered=True, max_lines=3)
    _draw_fitted_line(c, pack, width / 2, 0.78 * inch if barcode else 0.38 * inch, width - 2 * margin, font="Helvetica-Bold", size=11, align="center")
    if barcode:
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), margin, 0.08 * inch, width - 2 * margin, 0.52 * inch)


def _draw_standard_case(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Render the repeated horizontal Standard Case Pack panels on one 4x6 page."""
    panel_w = width / 2
    for panel_index in range(2):
        c.saveState()
        c.translate(panel_index * panel_w, 0)
        _draw_standard_case_panel(c, job, carton, total, panel_w, height)
        c.restoreState()


def _draw_standard_case_vertical(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Render the repeated vertical Standard Case Pack panels on one 4x6 page."""
    panel_h = height / 2
    for panel_index in range(2):
        c.saveState()
        c.translate(0, panel_index * panel_h)
        _draw_standard_case_panel(c, job, carton, total, width, panel_h)
        c.restoreState()


def _draw_bulk(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height)
    margin = 0.20 * inch
    _draw_fitted_line(c, _job_value(job, "project_name", "name", default="BULK PACKAGED ITEM").upper(), width / 2, height - 0.35 * inch, width - 2 * margin, font="Helvetica-Bold", size=15, align="center")
    y = height - 0.72 * inch
    y = _draw_value_row(c, "ORDER #:", _job_value(job, "order_number"), margin, y, width - 2 * margin, size=10)
    y = _draw_value_row(c, "PO #:", _job_value(job, "po_number"), margin, y, width - 2 * margin, size=10)
    y = _draw_value_row(c, "LOT #:", _job_value(job, "lot_number"), margin, y, width - 2 * margin, size=10)
    y = _draw_value_row(c, "DESCRIPTION:", _job_value(job, "description"), margin, y, width - 2 * margin, size=10, label_width=1.05 * inch)
    y = _draw_value_row(c, "ALLERGENS:", _job_value(job, "allergens", default="NONE"), margin, y, width - 2 * margin, size=10, label_width=0.92 * inch)
    net_weight = _job_value(job, "net_weight")
    if not net_weight:
        gross_weight = _job_value(job, "gross_weight_lbs")
        net_weight = _with_unit(gross_weight, "lb") if gross_weight else _with_unit(_job_value(job, "package_net_weight_g"), "g")
    y = _draw_value_row(c, "NET WT:", net_weight, margin, y, width - 2 * margin, size=10)

    barcode = _barcode_requested(job)
    statement_y = 0.92 * inch if barcode else 0.55 * inch
    manufacturer = "\n".join(filter(None, [
        _job_value(job, "manufacturer_name"),
        _job_value(job, "manufacturer_address"),
    ]))
    y -= 0.06 * inch
    _draw_wrapped_in_box(
        c,
        f"MANUFACTURED BY: {manufacturer}",
        margin,
        y,
        width - 2 * margin,
        statement_y + 0.80 * inch,
        font="Helvetica-Bold",
        size=8,
        max_lines=2,
    )

    statement = _job_value(
        job,
        "required_statement",
        default="Bulk Packaged Item - Further Processing and / or Labeling Needed for Retail Sale",
    )
    c.setLineWidth(1)
    c.rect(margin, statement_y, width - 2 * margin, 0.76 * inch)
    _draw_wrapped(c, statement, margin + 0.08 * inch, statement_y + 0.53 * inch, width - 2 * margin - 0.16 * inch, font="Helvetica-Bold", size=10, centered=True, max_lines=3)
    _draw_fitted_line(c, _carton_text(carton, total), width / 2, 0.66 * inch if barcode else 0.26 * inch, width - 2 * margin, font="Helvetica-Bold", size=16, align="center")
    if barcode:
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), margin, 0.08 * inch, width - 2 * margin, 0.42 * inch)


def _page_size(template: Dict[str, Any]) -> Tuple[float, float]:
    width = float(template.get("physical_width_in") or template.get("pdf_width_in") or 4)
    height = float(template.get("physical_height_in") or template.get("pdf_height_in") or 6)
    return width * inch, height * inch


def _renderer_for(template: Dict[str, Any]) -> Callable[[canvas.Canvas, Dict[str, Any], int, int, float, float], None]:
    key = _text(template.get("renderer_key"))
    if key == "decopac_case_4x6":
        return _draw_decopac
    if key == "disney_case_3x3":
        return _draw_disney
    if key == "fancy_pallet_3x3":
        return _draw_fancy_pallet
    if key == "compact_case_3x3":
        options = template.get("renderer_options") if isinstance(template.get("renderer_options"), dict) else {}
        return partial(
            _draw_compact_case,
            customer_default=_text(options.get("customer_default")) or _text(template.get("name")) or "CASE PACK",
            show_invoice=bool(options.get("show_invoice")),
            show_barcode=bool(options.get("show_barcode")),
        )
    if key == "mixed_case_3x1_5":
        return _draw_mixed
    if key == "standard_case_4x6":
        return _draw_standard_case
    if key == "standard_case_vertical_4x6":
        return _draw_standard_case_vertical
    if key == "total_wine_kehe_pack_4x4":
        return _draw_total_wine_kehe_pack
    if key == "total_wine_kehe_pallet_4x6":
        return _draw_total_wine_kehe_pallet
    if key == "bulk_further_processing_4x6":
        return _draw_bulk
    raise ValueError(f"Unsupported B2B label renderer: {key}")


def validate_b2b_job(job: Dict[str, Any], template: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    renderer_key = _text(template.get("renderer_key"))
    if renderer_key not in SUPPORTED_RENDERERS:
        warnings.append(f"Renderer {renderer_key or '(blank)'} is not available.")
    for field in template.get("required_product_fields") or []:
        if not _job_value(job, _text(field)):
            warnings.append(f"Product field {_text(field)} is blank.")
    for field in template.get("required_run_fields") or []:
        if not _job_value(job, _text(field)):
            warnings.append(f"Job field {_text(field)} is blank.")
    start = _positive_int(_job_value(job, "carton_start"), 1)
    end = _positive_int(_job_value(job, "carton_end"), start)
    total = _positive_int(_job_value(job, "carton_total"), end)
    if not (1 <= start <= end <= total):
        warnings.append("Carton range must satisfy 1 <= start <= end <= total.")
    if _barcode_requested(job):
        if not _job_value(job, "gtin"):
            warnings.append("Barcode is selected but GTIN / UPC is blank.")
        if _job_value(job, "barcode_type").upper() in {"", "NONE"}:
            warnings.append("Barcode is selected but Barcode Type is not configured.")
    return warnings


def render_b2b_label_pdf(
    job: Dict[str, Any],
    template: Dict[str, Any],
    out_pdf: str | Path | None = None,
) -> Dict[str, Any]:
    renderer = _renderer_for(template)
    render_job = dict(job)
    render_run = dict(_run(job))
    if "print_barcode" not in render_run:
        policy = _text(template.get("barcode_policy")).upper()
        options = template.get("renderer_options") if isinstance(template.get("renderer_options"), dict) else {}
        render_run["print_barcode"] = policy in {"OPTIONAL", "REQUIRED"} or bool(options.get("show_barcode"))
    render_job["run"] = render_run
    width, height = _page_size(template)
    start = _positive_int(_job_value(render_job, "carton_start"), 1)
    end = _positive_int(_job_value(render_job, "carton_end"), start)
    total = _positive_int(_job_value(render_job, "carton_total"), end)
    if not (1 <= start <= end <= total):
        raise ValueError("Carton range must satisfy 1 <= start <= end <= total.")

    default_copies = _positive_int(template.get("default_copies"), 1)
    copies = _positive_int(_job_value(render_job, "copies"), default_copies)
    buffer = io.BytesIO()
    target: Any = str(out_pdf) if out_pdf else buffer
    pdf = canvas.Canvas(target, pagesize=(width, height), pageCompression=1)
    pages = 0
    for carton in range(start, end + 1):
        for _copy in range(copies):
            renderer(pdf, render_job, carton, total, width, height)
            pdf.showPage()
            pages += 1
    pdf.save()

    pdf_bytes = b""
    if out_pdf is None:
        pdf_bytes = buffer.getvalue()
    return {
        "pdf_bytes": pdf_bytes,
        "pages": pages,
        "cartons": (end - start) + 1,
        "copies": copies,
        "template_id": _text(template.get("template_id")),
        "template_version": template.get("version"),
        "warnings": validate_b2b_job(render_job, template),
    }
