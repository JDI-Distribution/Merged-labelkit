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


SUPPORTED_RENDERERS = {
    "bulk_further_processing_4x6",
    "compact_case_3x3",
    "decopac_case_4x6",
    "disney_case_3x3",
    "mixed_case_3x1_5",
    "standard_case_4x6",
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
    current = words.pop(0)
    for word in words:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
            if len(lines) >= max_lines - 1:
                break
    if len(lines) < max_lines:
        lines.append(current)
    return lines[:max_lines]


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
    leading = leading or size * 1.18
    for line in _wrap(_text(text), font, size, max_width, max_lines=max_lines):
        c.setFont(font, size)
        if centered:
            c.drawCentredString(x + (max_width / 2), y, line)
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


def _draw_decopac(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height)
    margin = 0.20 * inch
    c.setFont("Helvetica-Bold", 17)
    c.drawString(margin, height - 0.35 * inch, _job_value(job, "manufacturer_name", "name", default="DECOPAC, INC").upper())
    c.setFont("Helvetica", 10)
    c.drawRightString(width - margin, height - 0.32 * inch, _job_value(job, "delivery_address", default="ANOKA, MN USA").replace("\n", " "))
    c.line(margin, height - 0.48 * inch, width - margin, height - 0.48 * inch)

    y = height - 0.73 * inch
    y = _draw_value_row(c, "ITEM #:", _job_value(job, "customer_item_number", "sku"), margin, y, width - 2 * margin, size=11)
    y -= 0.05 * inch
    y = _draw_value_row(c, "DESCRIPTION:", _job_value(job, "description"), margin, y, width - 2 * margin, size=11, label_width=1.10 * inch)
    y -= 0.02 * inch
    y = _draw_value_row(
        c,
        "QTY:",
        _qty_or_pack_text(job, qty_prefix="Master Carton of ", default="Master Carton"),
        margin,
        y,
        width - 2 * margin,
        size=10,
    )
    y = _draw_value_row(c, "PO #:", _job_value(job, "po_number"), margin, y, (width / 2) - margin, size=10)
    _draw_value_row(c, "LOT #:", _job_value(job, "lot_number"), width / 2, y + 11.8, (width / 2) - margin, size=10)

    c.setFont("Helvetica-Bold", 18)
    c.drawRightString(width - margin, height - 1.78 * inch, _carton_text(carton, total))

    details_y = height - 2.22 * inch
    details_y = _draw_value_row(c, "NET ITEM:", _with_unit(_job_value(job, "each_net_weight_g"), "g"), margin, details_y, width - 2 * margin, size=9)
    details_y = _draw_value_row(c, "NET CASE:", _with_unit(_job_value(job, "package_net_weight_g"), "g"), margin, details_y, width - 2 * margin, size=9)
    dimensions = " × ".join(filter(None, [
        _job_value(job, "length_in"), _job_value(job, "width_in"), _job_value(job, "height_in")
    ]))
    details_y = _draw_value_row(c, "DIMENSIONS:", f"{dimensions} in" if dimensions else "", margin, details_y, width - 2 * margin, size=9)

    _draw_barcode(
        c,
        _job_value(job, "gtin"),
        _job_value(job, "barcode_type"),
        margin,
        0.20 * inch,
        width - 2 * margin,
        0.82 * inch,
    )


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
    _draw_border(c, width, height, inset=0.06 * inch)
    margin = 0.14 * inch
    customer = _job_value(job, "name", "storefront", default=customer_default)
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(width / 2, height - 0.28 * inch, customer.upper())
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

    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, 0.72 * inch if show_barcode else 0.34 * inch, _carton_text(carton, total))
    if show_barcode:
        _draw_barcode(c, _job_value(job, "gtin"), _job_value(job, "barcode_type"), margin, 0.10 * inch, width - 2 * margin, 0.48 * inch)


def _draw_disney(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height, inset=0.06 * inch)
    margin = 0.14 * inch
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, height - 0.30 * inch, _job_value(job, "name", "storefront", default="DISNEY").upper())
    c.line(margin, height - 0.41 * inch, width - margin, height - 0.41 * inch)
    item_description = " — ".join(filter(None, [
        _job_value(job, "customer_item_number"),
        _job_value(job, "description"),
    ]))
    _draw_wrapped(c, item_description, margin, height - 0.72 * inch, width - 2 * margin, font="Helvetica-Bold", size=11, centered=True, max_lines=3)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(width / 2, height - 1.38 * inch, f"PO # {_job_value(job, 'po_number')}")
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(width / 2, height - 1.80 * inch, _carton_text(carton, total))
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(width / 2, height - 2.20 * inch, "EXPECTED DELIVERY BY")
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(width / 2, height - 2.48 * inch, _job_value(job, "expected_delivery_date"))


def _draw_mixed(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height, inset=0.04 * inch)
    margin = 0.10 * inch
    c.setFont("Helvetica-Bold", 8)
    c.drawString(margin, height - 0.18 * inch, _job_value(job, "storefront", default="BAKELL MIXED CASE").upper())
    c.drawRightString(width - margin, height - 0.18 * inch, _carton_text(carton, total))
    _draw_wrapped(c, _job_value(job, "description"), margin, height - 0.39 * inch, width - 2 * margin, font="Helvetica-Bold", size=11, centered=True, max_lines=2)
    c.setFont("Helvetica", 7.5)
    c.drawString(margin, 0.27 * inch, f"SKU: {_job_value(job, 'sku', 'customer_item_number')}")
    c.drawRightString(width - margin, 0.27 * inch, _qty_or_pack_text(job, qty_suffix=" units"))
    c.setFont("Helvetica", 7)
    c.drawString(margin, 0.10 * inch, f"PO: {_job_value(job, 'po_number')}")


def _draw_standard_case(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    """Standard 4x6 Rollo case label from the horizontal/vertical source sheets."""
    _draw_border(c, width, height)
    margin = 0.24 * inch
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(width / 2, height - 0.48 * inch, _carton_text(carton, total))
    c.line(margin, height - 0.62 * inch, width - margin, height - 0.62 * inch)

    po_number = _job_value(job, "po_number", "order_number")
    if po_number:
        c.setFont("Helvetica-Bold", 18)
        c.drawCentredString(width / 2, height - 1.06 * inch, f"PO # {po_number}")
    y = height - 1.52 * inch
    y = _draw_wrapped(
        c,
        _job_value(job, "description"),
        margin,
        y,
        width - (2 * margin),
        font="Helvetica-Bold",
        size=17,
        leading=0.28 * inch,
        max_lines=4,
        centered=True,
    )
    pack = _qty_or_pack_text(job, qty_suffix=" units per case", default="Units per case")
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(width / 2, max(0.56 * inch, y - 0.18 * inch), pack)
    sku = _job_value(job, "sku", "customer_item_number")
    if sku:
        c.setFont("Helvetica", 9)
        c.drawString(margin, 0.23 * inch, f"SKU: {sku}")


def _draw_bulk(c: canvas.Canvas, job: Dict[str, Any], carton: int, total: int, width: float, height: float) -> None:
    _draw_border(c, width, height)
    margin = 0.20 * inch
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(width / 2, height - 0.35 * inch, _job_value(job, "project_name", "name", default="BULK PACKAGED ITEM").upper())
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

    manufacturer = "\n".join(filter(None, [
        _job_value(job, "manufacturer_name"),
        _job_value(job, "manufacturer_address"),
    ]))
    y -= 0.08 * inch
    c.setFont("Helvetica-Bold", 9)
    c.drawString(margin, y, "MANUFACTURED BY:")
    _draw_wrapped(c, manufacturer, margin, y - 0.18 * inch, width - 2 * margin, size=9, max_lines=3)

    statement = _job_value(
        job,
        "required_statement",
        default="Bulk Packaged Item – Further Processing and / or Labeling Needed for Retail Sale",
    )
    c.setLineWidth(1)
    c.rect(margin, 0.55 * inch, width - 2 * margin, 0.76 * inch)
    _draw_wrapped(c, statement, margin + 0.08 * inch, 1.08 * inch, width - 2 * margin - 0.16 * inch, font="Helvetica-Bold", size=10, centered=True, max_lines=3)
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(width / 2, 0.26 * inch, _carton_text(carton, total))


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
    return warnings


def render_b2b_label_pdf(
    job: Dict[str, Any],
    template: Dict[str, Any],
    out_pdf: str | Path | None = None,
) -> Dict[str, Any]:
    renderer = _renderer_for(template)
    width, height = _page_size(template)
    start = _positive_int(_job_value(job, "carton_start"), 1)
    end = _positive_int(_job_value(job, "carton_end"), start)
    total = _positive_int(_job_value(job, "carton_total"), end)
    if not (1 <= start <= end <= total):
        raise ValueError("Carton range must satisfy 1 <= start <= end <= total.")

    default_copies = _positive_int(template.get("default_copies"), 1)
    copies = _positive_int(_job_value(job, "copies"), default_copies)
    buffer = io.BytesIO()
    target: Any = str(out_pdf) if out_pdf else buffer
    pdf = canvas.Canvas(target, pagesize=(width, height), pageCompression=1)
    pages = 0
    for carton in range(start, end + 1):
        for _copy in range(copies):
            renderer(pdf, job, carton, total, width, height)
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
        "warnings": validate_b2b_job(job, template),
    }
