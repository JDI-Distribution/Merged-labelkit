"""KeHE pallet-label draft and PDF rendering.

Implementations live here; shared models and low-level drawing helpers remain in
``common`` for compatibility and to prevent circular imports.
"""

from __future__ import annotations

import io
import re
from typing import Any, Callable, Dict, List, Optional

from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from .common import (
    Pack,
    _billing_str,
    _dc_ship_from_str,
    _draw_fitted_line,
    _draw_rect_with_fill,
    _draw_warning_box,
    _format_edi_date,
    _pack_item_count,
    _pack_po_numbers,
    _safe_positive_int,
    _ship_to_str,
    build_document_shipments,
    fit_text_lines,
    normalize_sscc,
)

def _build_pallet_label_entry(
    *,
    idx: int,
    status: str,
    dc: str,
    header: Dict[str, Any],
    ship_from: str,
    ship_to: str,
    billing: str,
    pallet_number: str,
    total_pallets: str,
    customer_po_numbers: str,
    carton_count: str,
    source_file: str,
    warnings: List[str],
    pack: Optional[Pack] = None,
) -> Dict[str, Any]:
    """Build one editable Pallet Placard draft record."""
    entry = {
        "id": f"PALLET-{idx}",
        "status": status,
        "dc": dc,
        "title": "PALLET PLACARD",
        "date": header.get("ship_date", ""),
        "ship_from": ship_from,
        "ship_to": ship_to,
        "billing": billing,
        "customer_po_numbers": customer_po_numbers,
        "bol_number": header.get("bol_number", ""),
        "pro_number": header.get("pro_number", ""),
        "carrier": header.get("carrier", ""),
        "pallet_number": pallet_number,
        "total_pallets": total_pallets,
        "carton_count": carton_count,
        "placement_note": (
            "Place one placard on the front and one placard on the back of the pallet."
        ),
        "copies": 2,
        "source_files": [source_file],
        "warnings": list(warnings),
    }
    if pack is not None:
        entry.update({
            "source_sscc": normalize_sscc(pack.sscc),
            "pack_index": str(pack.carton_index or pallet_number),
            "item_rows": str(len(pack.items or [])),
            "item_quantity": str(_pack_item_count(pack) or ""),
        })
    return entry


def build_kehe_pallet_label_draft(xml_paths: List[str]) -> Dict[str, Any]:
    """Parse XML files and return editable Pallet Placard drafts.

    Correct KeHE pallet XML uses HL03=T for tare/pallet SSCCs. Some legacy SPS
    XML exports used HL03=P with shipment TD101=PLT, so both are supported. The
    PO printed on a placard is aggregated from the physical SSCC's parent order(s),
    not from a first-PO-only shipment header.

    If XML does not explicitly identify pallets, preserve the legacy behavior: one
    editable placard draft per shipment/group, with pallet count defaulting to 1.
    """
    if not xml_paths:
        raise ValueError("At least one XML file is required.")

    result = build_document_shipments(xml_paths)
    shipments = result["shipments"]
    duplicate_files = result["duplicate_files"]

    global_warnings: List[str] = []
    if duplicate_files:
        global_warnings.append(
            f"Duplicate file(s) skipped: {', '.join(duplicate_files)}"
        )

    pallets: List[Dict[str, Any]] = []
    needs_review_count = 0

    for ship in shipments:
        header = ship["header"]
        dc_info = ship["dc_info"]
        packs: List[Pack] = ship["packs"]
        needs_review = ship["needs_review"]

        if needs_review:
            needs_review_count += 1

        status = "Needs Review" if needs_review else "Ready"
        dc = dc_info["dc"] if dc_info else "Unknown"
        ship_from = _dc_ship_from_str(dc_info, header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)
        source_file = header.get("source_file", "")

        total_pallets = str(_safe_positive_int(
            header.get("total_pallets") or header.get("xml_total_pallets") or "1",
            1,
        ))
        explicit_pallet_xml = bool(header.get("xml_total_pallets") or header.get("has_tare_pallets"))

        base_warnings: List[str] = list(header.get("warnings", []))

        if explicit_pallet_xml:
            if len(packs) != _safe_positive_int(total_pallets, 1):
                base_warnings.append(
                    f"XML says Total Pallets={total_pallets}, but {len(packs)} physical SSCC pallet records were found. Verify pallet labels."
                )
            for pack_index, pack in enumerate(packs, start=1):
                pallet_number = str(pack.carton_index or pack_index)
                po_on_pallet = _pack_po_numbers(pack, header.get("customer_po_number", ""))
                pallet_warnings = list(base_warnings)
                if not po_on_pallet:
                    pallet_warnings.append("PO number was not found for this pallet. Verify before printing.")
                pallets.append(_build_pallet_label_entry(
                    idx=len(pallets) + 1,
                    status=status,
                    dc=dc,
                    header=header,
                    ship_from=ship_from,
                    ship_to=ship_to,
                    billing=billing,
                    pallet_number=pallet_number,
                    total_pallets=total_pallets,
                    customer_po_numbers=po_on_pallet,
                    carton_count="1",
                    source_file=source_file,
                    warnings=pallet_warnings,
                    pack=pack,
                ))
        else:
            pallet_warnings = list(base_warnings)
            pallet_warnings.append(
                "Pallet count was not explicitly provided as TD101=PLT in XML. Defaulted to 1."
            )
            pallets.append(_build_pallet_label_entry(
                idx=len(pallets) + 1,
                status=status,
                dc=dc,
                header=header,
                ship_from=ship_from,
                ship_to=ship_to,
                billing=billing,
                pallet_number="1",
                total_pallets=total_pallets,
                customer_po_numbers=header.get("customer_po_number", ""),
                carton_count=header.get("carton_count") or header.get("pack_count", ""),
                source_file=source_file,
                warnings=pallet_warnings,
                pack=None,
            ))

    return {
        "document_type": "kehe_pallet_label",
        "version": 2,
        "summary": {
            "xml_files": len(xml_paths),
            "groups": len(pallets),
            "needs_review": needs_review_count,
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": global_warnings,
        "pallets": pallets,
    }


def _render_pallet_label_page(c: canvas.Canvas, pallet: Dict[str, Any]) -> None:
    """Render one Pallet Placard page at standard 4 x 6 inch size.

    Updated layout:
      - PALLET PLACARD title
      - DATE label with boxed value
      - SHIP FROM label with boxed multiline value
      - SHIP TO label with boxed multiline value
      - PALLET # row with large boxed X and Y values
      - KEHE PO#S ON THIS PALLET header box
      - PO# label with boxed PO value(s)
      - compact warning box only when needed
    """
    W, H = 4 * inch, 6 * inch
    margin = 0.16 * inch
    x0 = margin
    y0 = margin
    inner_w = W - 2 * margin
    inner_h = H - 2 * margin
    y_top = y0 + inner_h

    needs_review = pallet.get("status") == "Needs Review"
    pad = 0.06 * inch

    # Compact but cleaner row sizing to reduce empty bottom space.
    title_h = 0.40 * inch
    date_h = 0.40 * inch
    from_h = 0.92 * inch
    to_h = 1.18 * inch
    pallet_h = 0.52 * inch
    po_hdr_h = 0.30 * inch
    warn_h = 0.34 * inch if needs_review else 0.0

    used_h = title_h + date_h + from_h + to_h + pallet_h + po_hdr_h + warn_h
    po_val_h = max(0.70 * inch, inner_h - used_h)

    # Row bottoms
    title_bot = y_top - title_h
    date_bot = title_bot - date_h
    from_bot = date_bot - from_h
    to_bot = from_bot - to_h
    pallet_bot = to_bot - pallet_h
    po_hdr_bot = pallet_bot - po_hdr_h
    po_val_bot = po_hdr_bot - po_val_h

    # Outer border
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.0)
    c.rect(x0, y0, inner_w, inner_h)

    label_w = 0.95 * inch
    box_x = x0 + label_w
    box_w = inner_w - label_w - pad * 0.3

    def _normalize_date(value: str) -> str:
        return _format_edi_date(value or "")

    def _draw_left_label(y_mid: float, text: str, size: float = 10.5) -> None:
        c.setFont("Helvetica-Bold", size)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(x0 + 0.02 * inch, y_mid - size * 0.30, text)

    def _draw_box(x: float, y: float, w: float, h: float, line_width: float = 0.8) -> None:
        c.setLineWidth(line_width)
        c.setStrokeColorRGB(0, 0, 0)
        c.rect(x, y, w, h)

    def _draw_multiline_centered_box(
        x: float,
        y: float,
        w: float,
        h: float,
        text: str,
        font_name: str = "Helvetica-Bold",
        font_size: float = 10.0,
        leading: float = 11.5,
        padding: float = 5,
        max_lines: int = 8,
    ) -> None:
        _draw_box(x, y, w, h)
        clean_text = " | ".join(ln.strip() for ln in str(text or "").splitlines() if ln.strip())
        vertical_line_limit = max(1, min(max_lines, int((h - 2 * padding) // max(leading, 1))))
        wrapped_lines, fitted_size = fit_text_lines(
            clean_text,
            font_name,
            font_size,
            w - 2 * padding,
            vertical_line_limit,
            min_font_size=4.0,
        )
        wrapped_lines = wrapped_lines or [""]
        fitted_leading = leading * (fitted_size / font_size)
        total_h = len(wrapped_lines) * fitted_leading
        ty = y + (h + total_h) / 2 - fitted_leading * 0.82

        c.setFont(font_name, fitted_size)
        c.setFillColorRGB(0, 0, 0)
        for line in wrapped_lines:
            c.drawCentredString(x + w / 2, ty, line)
            ty -= fitted_leading

    def _draw_single_line_box(
        x: float,
        y: float,
        w: float,
        h: float,
        text: str,
        font_name: str = "Helvetica-Bold",
        font_size: float = 11.0,
    ) -> None:
        _draw_box(x, y, w, h)
        c.setFillColorRGB(0, 0, 0)
        _draw_fitted_line(
            c,
            text or "",
            x + w / 2,
            y + h / 2 - font_size * 0.34,
            w - 8,
            font_name,
            font_size,
            min_font_size=4.0,
            align="center",
        )

    # 1) Title
    _draw_rect_with_fill(c, x0, title_bot, inner_w, title_h, (0, 0, 0), (0, 0, 0), 1.0)
    c.setFont("Helvetica-Bold", 15)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(x0 + inner_w / 2, title_bot + title_h / 2 - 5.2, "PALLET PLACARD")

    # 2) Date row
    date_val = _normalize_date(pallet.get("expected_delivery_date") or pallet.get("date", ""))
    _draw_left_label(date_bot + date_h / 2, "DATE:", 10.5)
    _draw_single_line_box(
        box_x,
        date_bot + 0.03 * inch,
        box_w,
        date_h - 0.06 * inch,
        date_val,
        font_name="Helvetica-Bold",
        font_size=11.0,
    )

    # 3) Ship From box
    _draw_left_label(from_bot + from_h - 0.14 * inch, "SHIP FROM:", 10.5)
    _draw_multiline_centered_box(
        box_x,
        from_bot + 0.03 * inch,
        box_w,
        from_h - 0.06 * inch,
        pallet.get("ship_from", ""),
        font_name="Helvetica-Bold",
        font_size=10.0,
        leading=11.5,
        padding=5,
        max_lines=5,
    )

    # 4) Ship To box
    _draw_left_label(to_bot + to_h - 0.14 * inch, "SHIP TO:", 10.5)
    _draw_multiline_centered_box(
        box_x,
        to_bot + 0.03 * inch,
        box_w,
        to_h - 0.06 * inch,
        pallet.get("ship_to", ""),
        font_name="Helvetica-Bold",
        font_size=10.0,
        leading=11.3,
        padding=5,
        max_lines=6,
    )

    # 5) Pallet count row
    row_y = pallet_bot + pallet_h / 2

    c.setFont("Helvetica-Bold", 11)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(x0 + 0.02 * inch, row_y - 4, "PALLET #")

    num_box_w = 0.42 * inch
    num_box_h = 0.28 * inch

    x_box_1 = x0 + 1.28 * inch
    x_of = x_box_1 + num_box_w + 0.13 * inch
    x_box_2 = x_of + 0.34 * inch
    x_total = x_box_2 + num_box_w + 0.14 * inch

    _draw_single_line_box(
        x_box_1,
        pallet_bot + 0.12 * inch,
        num_box_w,
        num_box_h,
        str(pallet.get("pallet_number", "1")),
        font_name="Helvetica-Bold",
        font_size=13.0,
    )

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x_of, row_y - 4, "OF")

    _draw_single_line_box(
        x_box_2,
        pallet_bot + 0.12 * inch,
        num_box_w,
        num_box_h,
        str(pallet.get("total_pallets", "1")),
        font_name="Helvetica-Bold",
        font_size=13.0,
    )

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x_total, row_y - 4, "TOTAL")

    # 6) PO header box
    _draw_box(x0, po_hdr_bot, inner_w, po_hdr_h, line_width=0.9)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawCentredString(
        x0 + inner_w / 2,
        po_hdr_bot + po_hdr_h / 2 - 3.6,
        "KEHE PO#S ON THIS PALLET:"
    )

    # 7) PO value box
    po_raw = str(pallet.get("customer_po_numbers", "") or "")
    po_lines = [p.strip() for p in re.split(r"[,\n;]+", po_raw) if p.strip()]
    po_text = "\n".join(po_lines) if po_lines else po_raw

    _draw_left_label(po_val_bot + po_val_h - 0.16 * inch, "PO#:", 10.5)
    _draw_multiline_centered_box(
        box_x,
        po_val_bot + 0.04 * inch,
        box_w,
        po_val_h - 0.08 * inch,
        po_text,
        font_name="Helvetica-Bold",
        font_size=11.0,
        leading=12.0,
        padding=5,
        max_lines=6,
    )

    # 8) Warning box only when needed
    if needs_review and warn_h > 0:
        _draw_warning_box(
            c,
            "NEEDS REVIEW — Verify Ship-To before printing.",
            x0 + 0.02 * inch,
            po_val_bot,
            inner_w - 0.04 * inch,
            font_size=6.3,
            padding=3,
        )

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)


def render_kehe_pallet_label_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render Pallet Placard pages from an edited draft.

    Each pallet entry is rendered `copies` times (default 2).
    Returns a report dict suitable for the frontend report panel.
    """
    pallets = draft.get("pallets") or []
    if not pallets:
        raise ValueError("Draft contains no pallets to render.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(4 * inch, 6 * inch))

    total_pages = 0
    rows = []
    needs_review_count = 0

    for pallet in pallets:
        # Validate / sanitize user-edited copies field
        try:
            copies = max(1, int(str(pallet.get("copies") or "2").strip() or "2"))
        except (ValueError, TypeError):
            copies = 1
            pallet.setdefault("warnings", [])
            pallet["warnings"].append("'copies' was invalid; defaulted to 1.")

        try:
            total_pallets_val = str(int(str(pallet.get("total_pallets") or "1").strip() or "1"))
        except (ValueError, TypeError):
            total_pallets_val = "1"
            pallet.setdefault("warnings", [])
            pallet["warnings"].append("'total_pallets' was invalid; defaulted to 1.")
        pallet["total_pallets"] = total_pallets_val

        status = pallet.get("status", "Ready")
        if not pallet.get("ship_to", "").strip():
            status = "Needs Review"
            pallet["status"] = status
        if not pallet.get("customer_po_numbers", "").strip():
            status = "Needs Review"
            pallet["status"] = status

        if status == "Needs Review":
            needs_review_count += 1

        if progress_callback:
            progress_callback(
                f"Rendering pallet {pallet.get('id', '')} "
                f"({copies} {'copy' if copies == 1 else 'copies'})…"
            )

        for _ in range(copies):
            _render_pallet_label_page(c, pallet)
            c.showPage()
            total_pages += 1

        # Ship-to display name for report
        ship_to_lines = (pallet.get("ship_to") or "").split("\n")
        ship_to_display = ship_to_lines[0] if ship_to_lines else "—"

        rows.append({
            "document": "Pallet Label",
            "status": status,
            "dc": pallet.get("dc", ""),
            "po": pallet.get("customer_po_numbers", ""),
            "pallet": f"{pallet.get('pallet_number', '1')} of {pallet.get('total_pallets', '1')}",
            "copies": copies,
            "ship_to": ship_to_display,
            "note": "Generated from edited draft",
        })

    c.save()
    buf.seek(0)
    with open(out_pdf, "wb") as f:
        f.write(buf.read())

    return {
        "summary": {
            "success": True,
            "pallets": len(pallets),
            "pages": total_pages,
            "needs_review": needs_review_count,
        },
        "rows": rows,
    }


__all__ = [
    "build_kehe_pallet_label_draft",
    "render_kehe_pallet_label_pdf",
]
