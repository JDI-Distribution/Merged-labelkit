"""Master Packing List themes and page-rendering helpers."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from .common import (
    PROJECT_ROOT,
    _ITEM_COLUMNS,
    _MPL_BLACK,
    _MPL_CREAM,
    _MPL_GREY,
    _MPL_GRID,
    _MPL_INNER_TOP,
    _MPL_INNER_W,
    _MPL_MARGIN,
    _MPL_ROW_ALT,
    _display_uom,
    _draw_fitted_line,
    _draw_mpl_cell,
    _draw_warning_box,
    _mpl_build_tihi_entries,
    _mpl_clean,
    _mpl_pallet_label,
    _mpl_pallet_sort_key,
    _mpl_pallet_value,
    _parse_float,
    _safe_positive_int,
    fit_text_lines,
)

_MPL_BRAND_THEMES: Dict[str, Dict[str, Any]] = {
    "brew_glitter": {
        "brand_label": "BREW GLITTER",
        "primary": (0.07, 0.07, 0.07),
        "accent": (0.90, 0.68, 0.25),
        "label_fill": (0.96, 0.84, 0.58),
        "value_fill": (1.0, 0.98, 0.93),
        "row_alt": (1.0, 0.97, 0.90),
    },
    "bakell": {
        "brand_label": "BAKELL",
        "primary": (0.66, 0.53, 0.42),
        "accent": (0.91, 0.69, 0.21),
        "label_fill": (0.95, 0.83, 0.55),
        "value_fill": (1.0, 0.98, 0.93),
        "row_alt": (0.99, 0.96, 0.90),
    },
    "pfg": {
        "brand_label": "PFG",
        "primary": (0.0, 0.66, 0.31),
        "accent": (0.47, 0.75, 0.26),
        "label_fill": (0.80, 0.93, 0.72),
        "value_fill": (0.96, 1.0, 0.95),
        "row_alt": (0.93, 0.99, 0.92),
    },
    "jdi_distribution": {
        "brand_label": "JDI DISTRIBUTION",
        "primary": (0.23, 0.23, 0.23),
        "accent": (0.94, 0.29, 0.23),
        "label_fill": (1.0, 0.84, 0.81),
        "value_fill": (1.0, 0.97, 0.96),
        "row_alt": (1.0, 0.94, 0.93),
    },
}

_MPL_BRAND_LOGO_PATHS: Dict[str, Path] = {
    "brew_glitter": PROJECT_ROOT / "frontend" / "dist" / "assets" / "img" / "mpl-brands" / "brew_glitter.png",
    "bakell": PROJECT_ROOT / "frontend" / "dist" / "assets" / "img" / "mpl-brands" / "bakell.png",
    "pfg": PROJECT_ROOT / "frontend" / "dist" / "assets" / "img" / "mpl-brands" / "pfg.png",
    "jdi_distribution": PROJECT_ROOT / "frontend" / "dist" / "assets" / "img" / "mpl-brands" / "jdi_distribution.png",
}


def _mpl_template_id(draft: Dict[str, Any], mpl: Dict[str, Any]) -> str:
    """Resolve allowed MPL templates while keeping KeHE XML drafts locked."""
    if not bool(draft.get("standalone_mpl")):
        mpl["template_id"] = "kehe"
        mpl["title"] = "MASTER PACKING LIST"
        return "kehe"
    requested = _mpl_clean(mpl.get("template_id") or draft.get("template_id") or "standard").lower()
    template_id = requested if requested in {"kehe", "decopac", "dutch_bros", "fancy", "standard"} else "standard"
    mpl["template_id"] = template_id
    draft["template_id"] = template_id
    current_title = _mpl_clean(mpl.get("title")).upper()
    if not current_title or current_title in {"PACKING LIST", "COMPACT PACKING LIST"}:
        mpl["title"] = {
            "kehe": "MASTER PACKING LIST",
            "decopac": "Pallet Breakdown",
            "dutch_bros": "Pallet Breakdown",
            "fancy": "Pallet Breakdown",
            "standard": "MASTER PACKING LIST",
        }[template_id]
    return template_id


def _mpl_brand_id(draft: Dict[str, Any], mpl: Dict[str, Any]) -> str:
    """Resolve standalone supplier branding without changing KeHE documents."""
    if not bool(draft.get("standalone_mpl")):
        return "kehe"
    requested = _mpl_clean(mpl.get("brand_id") or draft.get("brand_id")).lower()
    if requested not in _MPL_BRAND_THEMES:
        template_id = _mpl_clean(mpl.get("template_id") or draft.get("template_id")).lower()
        if template_id in {"decopac", "dutch_bros", "fancy"}:
            requested = "bakell"
        else:
            supplier = _mpl_clean(mpl.get("supplier_info")).lower()
            if "brew glitter" in supplier:
                requested = "brew_glitter"
            elif "bakell" in supplier:
                requested = "bakell"
            elif re.search(r"(^|\s)pfg($|\s)", supplier):
                requested = "pfg"
            elif "jdi" in supplier:
                requested = "jdi_distribution"
            else:
                requested = "jdi_distribution"
    mpl["brand_id"] = requested
    draft["brand_id"] = requested
    return requested


def _mpl_template_theme(template_id: str, brand_id: str = "") -> Dict[str, Any]:
    if template_id == "kehe":
        return {
            "title": "MASTER PACKING LIST",
            "brand_label": "",
            "primary": _MPL_BLACK,
            "accent": _MPL_BLACK,
            "label_fill": _MPL_GREY,
            "value_fill": _MPL_CREAM,
            "row_alt": _MPL_ROW_ALT,
            "compact": False,
        }

    titles = {
        "decopac": "Pallet Breakdown",
        "dutch_bros": "Pallet Breakdown",
        "fancy": "Pallet Breakdown",
        "standard": "MASTER PACKING LIST",
    }
    palette = _MPL_BRAND_THEMES.get(brand_id) or _MPL_BRAND_THEMES["jdi_distribution"]
    return {
        "title": titles.get(template_id, titles["standard"]),
        "compact": False,
        **palette,
    }


def _draw_mpl_brand_logo(
    c: canvas.Canvas,
    brand_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    """Draw the supplied supplier-logo artwork inside a fixed logo box."""
    theme = _MPL_BRAND_THEMES.get(brand_id) or _MPL_BRAND_THEMES["jdi_distribution"]
    c.saveState()
    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(0.82, 0.84, 0.87)
    c.setLineWidth(0.45)
    c.roundRect(x, y, w, h, 4, fill=1, stroke=1)
    logo_path = _MPL_BRAND_LOGO_PATHS.get(brand_id) or _MPL_BRAND_LOGO_PATHS["jdi_distribution"]
    try:
        reader = ImageReader(str(logo_path))
        image_w, image_h = reader.getSize()
        available_w = max(1.0, w - 12)
        available_h = max(1.0, h - 12)
        scale = min(available_w / image_w, available_h / image_h)
        draw_w = image_w * scale
        draw_h = image_h * scale
        c.drawImage(
            reader,
            x + (w - draw_w) / 2,
            y + (h - draw_h) / 2,
            width=draw_w,
            height=draw_h,
            preserveAspectRatio=True,
            mask="auto",
        )
    except Exception:
        c.setFillColorRGB(*theme["primary"])
        c.setFont("Helvetica-Bold", min(11, h * 0.20))
        c.drawCentredString(x + w / 2, y + h / 2 - 3, theme["brand_label"])
    c.restoreState()


def _mpl_item_number_display(item: Dict[str, Any]) -> str:
    item_number = _mpl_clean(item.get("item_number"))
    if item_number:
        return item_number
    sku = _mpl_clean(item.get("sku"))
    return f"SKU: {sku}" if sku else ""


def _mpl_date_mmddyyyy(value: str) -> str:
    """Normalize MPL dates to MM/DD/YYYY."""
    v = _mpl_clean(value)
    if not v:
        return ""

    # Already MM/DD/YYYY or MM-DD-YYYY.
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$", v)
    if m:
        mm = int(m.group(1))
        dd = int(m.group(2))
        yy = m.group(3)
        year = int(yy) + 2000 if len(yy) == 2 else int(yy)
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    # YYYY-MM-DD or YYYY/MM/DD.
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", v)
    if m:
        year = int(m.group(1))
        mm = int(m.group(2))
        dd = int(m.group(3))
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    digits = re.sub(r"\D", "", v)
    if len(digits) == 8:
        first4 = int(digits[:4])
        last4 = int(digits[4:8])

        # YYYYMMDD
        if 1900 <= first4 <= 2100:
            return f"{digits[4:6]}/{digits[6:8]}/{digits[0:4]}"

        # MMDDYYYY
        if 1900 <= last4 <= 2100:
            return f"{digits[0:2]}/{digits[2:4]}/{digits[4:8]}"

    if len(digits) == 6:
        return f"{digits[2:4]}/{digits[4:6]}/20{digits[0:2]}"

    return v


def _mpl_date_short(value: str) -> str:
    """Display MPL header dates as MM/DD/YYYY."""
    return _mpl_date_mmddyyyy(value)


def _mpl_exp_short(value: str) -> str:
    """Display MPL item expiration dates as MM/DD/YYYY."""
    return _mpl_date_mmddyyyy(value)


def _mpl_weight_label(raw: Any) -> str:
    v = _mpl_clean(raw)
    if not v:
        return ""
    if re.search(r"\b(lb|lbs|pound|pounds)\b", v, re.I):
        return v.upper().replace("POUNDS", "LBS").replace("POUND", "LBS")
    return f"{v} LBS"


def _mpl_group_items(items: List[Dict[str, Any]]) -> List[Tuple[str, List[Dict[str, Any]]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        pallet = _mpl_pallet_value(item)
        groups.setdefault(pallet, []).append(item)
    return sorted(groups.items(), key=lambda pair: _mpl_pallet_sort_key(pair[0]))


def _mpl_prepare_items(mpl: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = list(mpl.get("items") or [])
    for idx, item in enumerate(items, start=1):
        item["line"] = item.get("line") or idx
        item["location_on_pallet"] = _mpl_pallet_value(item)
        if not _mpl_clean(item.get("qty_on_pallet")):
            item["qty_on_pallet"] = item.get("total_shipped") or item.get("qty") or ""
        if not _mpl_clean(item.get("total_ordered")):
            item["total_ordered"] = item.get("qty_on_pallet") or item.get("total_shipped") or ""
        if not _mpl_clean(item.get("total_shipped")):
            item["total_shipped"] = item.get("qty_on_pallet") or ""
    max_pallet_num = 1
    for pallet, _rows in _mpl_group_items(items):
        m = re.search(r"\d+", pallet)
        if m:
            max_pallet_num = max(max_pallet_num, int(m.group(0)))
    declared = _safe_positive_int(mpl.get("total_pallets"), 1)
    mpl["total_pallets"] = str(max(declared, max_pallet_num))
    return items


def _mpl_col_widths() -> List[Tuple[str, str, float, float]]:
    out: List[Tuple[str, str, float, float]] = []
    x = _MPL_MARGIN
    for key, label, rel in _ITEM_COLUMNS:
        w = _MPL_INNER_W * rel
        out.append((key, label, x, w))
        x += w
    return out


def _draw_wrapped_left(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    w: float,
    font_name: str,
    font_size: float,
    max_lines: int = 2,
    leading: float = 8,
) -> float:
    lines, fitted_size = fit_text_lines(_mpl_clean(text), font_name, font_size, w, max_lines)
    lines = lines or [""]
    fitted_leading = leading * (fitted_size / font_size)
    c.setFont(font_name, fitted_size)
    for line in lines:
        c.drawString(x, y, line)
        y -= fitted_leading
    return y


def _draw_centered_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y_mid: float,
    w: float,
    font_name: str,
    font_size: float,
    max_lines: int = 2,
    leading: float = 7.5,
) -> None:
    lines, fitted_size = fit_text_lines(_mpl_clean(text), font_name, font_size, w - 5, max_lines)
    lines = lines or [""]
    fitted_leading = leading * (fitted_size / font_size)
    c.setFont(font_name, fitted_size)
    total = (len(lines) - 1) * fitted_leading
    ty = y_mid + total / 2 - fitted_size / 3
    for line in lines:
        c.drawCentredString(x + w / 2, ty, line)
        ty -= fitted_leading


def _draw_info_cell(
    c: canvas.Canvas,
    x: float,
    top_y: float,
    w: float,
    h: float,
    label: str,
    value: str,
    theme: Optional[Dict[str, Any]] = None,
) -> None:
    theme = theme or _mpl_template_theme("kehe")
    label_h = h * 0.42
    _draw_mpl_cell(c, x, top_y - h, w, h, theme["value_fill"], _MPL_GRID, 0.4)
    _draw_mpl_cell(c, x, top_y - label_h, w, label_h, theme["label_fill"], _MPL_GRID, 0.4)

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 7.4)
    c.drawCentredString(x + w / 2, top_y - label_h / 2 - 2.6, label)

    _draw_centered_wrapped(
        c,
        value,
        x,
        top_y - h + (h - label_h) / 2,
        w,
        "Helvetica-Bold",
        8.0,
        max_lines=1,
        leading=8.5,
    )


def _render_mpl_header(
    c: canvas.Canvas,
    mpl: Dict[str, Any],
    page_num: int,
    total_pages: int,
    template_id: str = "kehe",
    brand_id: str = "",
) -> float:
    """Draw MPL header block; return y position below header."""
    theme = _mpl_template_theme(template_id, brand_id)
    compact = bool(theme["compact"])
    x0 = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    y = _MPL_INNER_TOP

    if template_id != "kehe":
        logo_band_h = 0.72 * inch
        c.setFillColorRGB(*theme["value_fill"])
        c.setStrokeColorRGB(*theme["primary"])
        c.setLineWidth(0.7)
        c.rect(x0, y - logo_band_h, inner_w, logo_band_h, fill=1, stroke=1)
        c.setFillColorRGB(*theme["accent"])
        c.rect(x0, y - logo_band_h, 0.09 * inch, logo_band_h, fill=1, stroke=0)
        heading = _mpl_clean(mpl.get("standard_heading")) or "Packing List"
        subheading = _mpl_clean(mpl.get("standard_subheading")) or "Shipment and Pallet Detail"
        logo_w = 2.35 * inch
        copy_x = x0 + 0.18 * inch
        copy_w = inner_w - logo_w - 0.43 * inch

        heading_size = 13.0
        while heading_size > 8.0 and pdfmetrics.stringWidth(heading, "Helvetica-Bold", heading_size) > copy_w:
            heading_size -= 0.5
        subheading_size = 6.5
        while subheading_size > 5.0 and pdfmetrics.stringWidth(subheading.upper(), "Helvetica-Bold", subheading_size) > copy_w:
            subheading_size -= 0.25

        c.setFillColorRGB(*theme["primary"])
        c.setFont("Helvetica-Bold", heading_size)
        c.drawString(copy_x, y - 0.28 * inch, heading)
        c.setFillColorRGB(0.28, 0.32, 0.38)
        c.setFont("Helvetica-Bold", subheading_size)
        c.drawString(copy_x, y - 0.48 * inch, subheading.upper())
        _draw_mpl_brand_logo(c, brand_id, x0 + inner_w - logo_w - 0.08 * inch, y - logo_band_h + 0.05 * inch, logo_w, logo_band_h - 0.10 * inch)
        y -= logo_band_h + 0.07 * inch

    # Title bar.
    title_h = (0.20 if compact else 0.23) * inch
    _draw_mpl_cell(c, x0, y - title_h, inner_w, title_h, theme["primary"], theme["primary"], 0.6)
    if template_id != "kehe":
        c.setFillColorRGB(*theme["accent"])
        c.rect(x0, y - title_h, 0.07 * inch, title_h, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 6.4)
        c.drawString(x0 + 0.10 * inch, y - title_h / 2 - 2.2, theme["brand_label"])
    c.setFillColorRGB(1, 1, 1)
    title = _mpl_clean(mpl.get("title")) or theme["title"]
    _draw_fitted_line(c, title, x0 + inner_w / 2, y - title_h / 2 - 3.0, inner_w - 12, "Helvetica-Bold", 10, min_font_size=5.0, align="center")
    review_status = _mpl_clean(mpl.get("review_status") or "DRAFT").upper()
    if review_status in {"DRAFT", "REVIEWED", "APPROVED"}:
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 5.5)
        c.drawRightString(x0 + inner_w - 5, y - title_h / 2 - 2.0, review_status)
    y -= title_h + (0.07 if compact else 0.12) * inch

    if mpl.get("status") == "Needs Review":
        warning = (
            "NEEDS REVIEW - Unknown KeHE DC. Verify addresses before using."
            if template_id == "kehe"
            else "NEEDS REVIEW - Verify order, address, and pallet details before using."
        )
        y = _draw_warning_box(
            c,
            warning,
            x0,
            y,
            inner_w,
            font_size=6.5,
            padding=4,
        ) - 0.05 * inch

    # Top requirement grid.
    def draw_info_row(
        cells: List[Tuple[str, str, float]],
        row_h: float = (0.24 if compact else 0.28) * inch,
    ) -> None:
        nonlocal y
        cx = x0
        for label, value, rel_w in cells:
            cw = inner_w * rel_w
            _draw_info_cell(c, cx, y, cw, row_h, label, value, theme)
            cx += cw
        y -= row_h

    draw_info_row([
        ("Customer PO Number", _mpl_clean(mpl.get("customer_po_number")), 0.50),
        ("Pro No", _mpl_clean(mpl.get("pro_number")), 0.50),
    ])
    draw_info_row([
        ("Order No", _mpl_clean(mpl.get("order_no")), 0.25),
        ("PO Date", _mpl_date_short(_mpl_clean(mpl.get("po_date"))), 0.25),
        ("BOL No", _mpl_clean(mpl.get("bol_number")), 0.25),
        ("Page No", f"Page {page_num} of {total_pages}", 0.25),
    ])
    draw_info_row([
        ("Total Weight", _mpl_clean(mpl.get("total_weight")), 0.34),
        ("Ship Via", _mpl_clean(mpl.get("ship_via")), 0.33),
        ("Total Pallets", _mpl_clean(mpl.get("total_pallets")), 0.33),
    ])

    y -= (0.09 if compact else 0.16) * inch

    # Address blocks.
    addr_h = (0.72 if compact else 0.93) * inch
    col_gap = (0.07 if compact else 0.12) * inch
    col_w = (inner_w - 2 * col_gap) / 3
    addr_cells = [
        ("SUPPLIER INFO:", mpl.get("supplier_info", "")),
        ("BILL TO:", mpl.get("bill_to", "")),
        ("SHIP TO:", mpl.get("ship_to", "")),
    ]
    for idx, (label, value) in enumerate(addr_cells):
        cx = x0 + idx * (col_w + col_gap)
        _draw_mpl_cell(c, cx, y - addr_h, col_w, addr_h, theme["value_fill"], _MPL_GRID, 0.35)
        header_h = (0.18 if compact else 0.22) * inch
        _draw_mpl_cell(c, cx, y - header_h, col_w, header_h, theme["label_fill"], _MPL_GRID, 0.35)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(cx + col_w / 2, y - header_h / 2 - 2.7, label)
        address_font = 6.2 if compact else 6.8
        max_address_lines = 4 if compact else 5
        lines, fitted_address_font = fit_text_lines(
            _mpl_clean(value).replace("\n", " | "),
            "Helvetica",
            address_font,
            col_w - 12,
            max_address_lines,
            min_font_size=4.2,
        )
        c.setFont("Helvetica", fitted_address_font)
        ty = y - header_h - (0.09 if compact else 0.12) * inch
        address_leading = (7 if compact else 8) * (fitted_address_font / address_font)
        for line in lines:
            c.drawCentredString(cx + col_w / 2, ty, line)
            ty -= address_leading
    y -= addr_h + (0.09 if compact else 0.16) * inch

    # Customer / Ship Date / Shipping Instructions bar.
    header_h = (0.15 if compact else 0.18) * inch
    value_h = (0.23 if compact else 0.28) * inch
    cells = [
        ("Customer No", _mpl_clean(mpl.get("customer_no") or mpl.get("customer_po_number")), 0.25),
        ("Ship Date", _mpl_date_short(_mpl_clean(mpl.get("est_ship_date"))), 0.25),
        ("Shipping Instructions", _mpl_clean(mpl.get("shipping_instructions")), 0.50),
    ]
    cx = x0
    for label, _value, rel in cells:
        cw = inner_w * rel
        _draw_mpl_cell(c, cx, y - header_h, cw, header_h, theme["primary"], theme["primary"], 0.35)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 6.4)
        c.drawCentredString(cx + cw / 2, y - header_h / 2 - 2.3, label)
        cx += cw
    y -= header_h
    cx = x0
    for _label, value, rel in cells:
        cw = inner_w * rel
        _draw_mpl_cell(c, cx, y - value_h, cw, value_h, theme["value_fill"], _MPL_GRID, 0.35)
        c.setFillColorRGB(0, 0, 0)
        _draw_centered_wrapped(c, value, cx, y - value_h / 2, cw, "Helvetica", 7, max_lines=1)
        cx += cw
    y -= value_h + (0.13 if compact else 0.22) * inch

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    return y


def _render_mpl_table_header(
    c: canvas.Canvas,
    y: float,
    template_id: str = "kehe",
    brand_id: str = "",
) -> float:
    theme = _mpl_template_theme(template_id, brand_id)
    th = (0.30 if theme["compact"] else 0.36) * inch
    _draw_mpl_cell(c, _MPL_MARGIN, y - th, _MPL_INNER_W, th, theme["primary"], theme["primary"], 0.45)

    c.setFillColorRGB(1, 1, 1)
    for _key, header_lbl, x, w in _mpl_col_widths():
        lines = header_lbl.split("\n")
        c.setFont("Helvetica-Bold", 7.4)
        line_h = 7.8
        ty = y - th / 2 + (len(lines) - 1) * line_h / 2 - 2.6

        for ln in lines:
            c.drawCentredString(x + w / 2, ty, ln)
            ty -= line_h

        c.setStrokeColorRGB(0.18, 0.18, 0.18)
        c.setLineWidth(0.35)
        c.line(x, y - th, x, y)

    c.line(_MPL_MARGIN + _MPL_INNER_W, y - th, _MPL_MARGIN + _MPL_INNER_W, y)
    c.setFillColorRGB(0, 0, 0)
    return y - th


def _mpl_item_height(item: Dict[str, Any], template_id: str = "kehe") -> float:
    compact = bool(_mpl_template_theme(template_id)["compact"])
    desc = _mpl_clean(item.get("description"))
    desc_lines, _desc_size = fit_text_lines(
        desc.upper(),
        "Helvetica-Bold",
        7.2 if compact else 7.8,
        _MPL_INNER_W * 0.39 - 10,
        4,
    ) if desc else ([], 7.2 if compact else 7.8)

    # A4 has enough height. Use taller rows instead of compressed rows.
    extra = max(0, len(desc_lines) - 1) * (0.10 if compact else 0.13) * inch

    if _mpl_clean(item.get("expiration_date")):
        extra += (0.10 if compact else 0.13) * inch

    if template_id not in {"kehe", "standard"}:
        detail_values = [
            item.get("invoice_po_number"),
            item.get("lot"),
            item.get("color"),
            item.get("product_size"),
            item.get("quantity_per_case"),
            item.get("balance_owed"),
        ]
        if any(_mpl_clean(value) for value in detail_values):
            extra += (0.18 if compact else 0.24) * inch

    return max((0.36 if compact else 0.46) * inch, (0.33 if compact else 0.42) * inch + extra)


def _render_mpl_item_row(
    c: canvas.Canvas,
    item: Dict[str, Any],
    y: float,
    row_h: float,
    bg_rgb: Tuple[float, float, float],
    template_id: str = "kehe",
) -> float:
    compact = bool(_mpl_template_theme(template_id)["compact"])
    _draw_mpl_cell(c, _MPL_MARGIN, y - row_h, _MPL_INNER_W, row_h, bg_rgb, _MPL_GRID, 0.30)

    for key, _label, x, w in _mpl_col_widths():
        c.setStrokeColorRGB(_MPL_GRID[0], _MPL_GRID[1], _MPL_GRID[2])
        c.setLineWidth(0.30)
        c.line(x, y - row_h, x, y)

        if key == "_description_block":
            desc = _mpl_clean(item.get("description")).upper()
            exp = _mpl_exp_short(_mpl_clean(item.get("expiration_date")))

            ty = y - (0.11 if compact else 0.14) * inch
            c.setFillColorRGB(0, 0, 0)

            ty = _draw_wrapped_left(
                c,
                desc,
                x + 5,
                ty,
                w - 10,
                "Helvetica-Bold",
                7.2 if compact else 7.8,
                max_lines=4,
                leading=8.0 if compact else 8.9,
            )

            detail_rows = [] if template_id in {"kehe", "standard"} else [
                [
                    ("PO", item.get("invoice_po_number")),
                    ("LOT", item.get("lot")),
                    ("COLOR", item.get("color")),
                ],
                [
                    ("SIZE", item.get("product_size")),
                    ("QTY/CASE", item.get("quantity_per_case")),
                    ("BALANCE", item.get("balance_owed")),
                ],
            ]
            c.setFont("Helvetica", 5.8 if compact else 6.2)
            for detail_row in detail_rows:
                detail_text = "   |   ".join(
                    f"{label}: {_mpl_clean(value)}"
                    for label, value in detail_row
                    if _mpl_clean(value)
                )
                if detail_text:
                    _draw_fitted_line(
                        c,
                        detail_text,
                        x + 5,
                        ty - 1,
                        w - 10,
                        "Helvetica",
                        5.8 if compact else 6.2,
                        min_font_size=3.5,
                    )
                    ty -= 7.0 if compact else 7.5

            meta_y = max(y - row_h + 0.09 * inch, ty - 0.02 * inch)
            c.setFont("Helvetica-Oblique", 6.6 if compact else 7.2)

            if exp:
                _draw_fitted_line(c, f"EXP: {exp}", x + 5, meta_y, w - 10, "Helvetica-Oblique", 6.6 if compact else 7.2)

        else:
            value = item.get(key)
            if key == "item_number":
                value = _mpl_item_number_display(item)
            if key == "uom":
                value = _display_uom(value)

            c.setFillColorRGB(0, 0, 0)
            _draw_centered_wrapped(
                c,
                _mpl_clean(value),
                x,
                y - row_h / 2,
                w,
                "Helvetica-Bold",
                7.2 if compact else 7.8,
                max_lines=1,
                leading=8.5,
            )

    last_x = _MPL_MARGIN + _MPL_INNER_W
    c.line(last_x, y - row_h, last_x, y)
    return y - row_h


def _render_mpl_pallet_group_row(
    c: canvas.Canvas,
    y: float,
    row_h: float,
    pallet_num: str,
    pallet_weight: str,
    template_id: str = "kehe",
    brand_id: str = "",
) -> float:
    theme = _mpl_template_theme(template_id, brand_id)
    _draw_mpl_cell(c, _MPL_MARGIN, y - row_h, _MPL_INNER_W, row_h, theme["label_fill"], _MPL_GRID, 0.40)

    cols = _mpl_col_widths()
    item_x, item_w = cols[0][2], cols[0][3]
    desc_x, desc_w = cols[1][2], cols[1][3]

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 8.4)
    c.drawString(item_x + 5, y - row_h / 2 - 3.0, f"Pallet: {_mpl_pallet_label(pallet_num)}")

    weight = _mpl_weight_label(pallet_weight)
    if weight:
        c.drawCentredString(desc_x + desc_w / 2, y - row_h / 2 - 3.0, weight)

    return y - row_h


def _mpl_build_units(
    items: List[Dict[str, Any]],
    template_id: str = "kehe",
) -> List[Tuple[str, Dict[str, Any], float]]:
    compact = bool(_mpl_template_theme(template_id)["compact"])
    units: List[Tuple[str, Dict[str, Any], float]] = []
    for pallet, rows in _mpl_group_items(items):
        pallet_weight = ""
        for row in rows:
            if _mpl_clean(row.get("pallet_weight")):
                pallet_weight = _mpl_clean(row.get("pallet_weight"))
                break
        units.append(("group", {"pallet": pallet, "pallet_weight": pallet_weight}, (0.26 if compact else 0.32) * inch))
        for row in rows:
            units.append(("item", row, _mpl_item_height(row, template_id)))
    return units


def _mpl_paginate_units(units: List[Tuple[str, Dict[str, Any], float]], available_h: float) -> List[List[Tuple[str, Dict[str, Any], float]]]:
    pages: List[List[Tuple[str, Dict[str, Any], float]]] = []
    current: List[Tuple[str, Dict[str, Any], float]] = []
    used = 0.0
    current_group: Optional[Tuple[str, Dict[str, Any], float]] = None
    for unit in units:
        kind, payload, height = unit
        if kind == "group":
            current_group = unit
        if current and used + height > available_h:
            pages.append(current)
            if kind == "item" and current_group is not None:
                current = [current_group]
                used = current_group[2]
            else:
                current = []
                used = 0.0
        current.append(unit)
        used += height
    if current:
        pages.append(current)
    return pages or [[]]


def _mpl_units_on_pallet(item: Dict[str, Any]) -> str:
    explicit = _mpl_clean(item.get("units_on_pallet"))
    if explicit:
        return explicit
    cases = _parse_float(item.get("qty_on_pallet") or item.get("total_shipped"))
    units_per_case = _parse_float(item.get("quantity_per_case"))
    if cases is None or units_per_case is None:
        return ""
    units = cases * units_per_case
    return str(int(units)) if float(units).is_integer() else f"{units:.2f}".rstrip("0").rstrip(".")


def _render_decopac_mpl_pages(
    c: canvas.Canvas,
    mpl: Dict[str, Any],
    items: List[Dict[str, Any]],
    brand_id: str,
    progress_callback: Optional[Callable[[str], None]] = None,
    customer_heading: str = "DECOPAC",
) -> int:
    """Render the supplied DecoPac-style landscape pallet breakdown."""
    page_w, page_h = landscape(A4)
    margin = 0.30 * inch
    inner_w = page_w - 2 * margin
    theme = _mpl_template_theme("decopac", brand_id)
    rows_per_page = 7
    chunks = [items[i:i + rows_per_page] for i in range(0, len(items), rows_per_page)] or [[]]
    column_specs = [
        ("location_on_pallet", "Pallet #", 0.075),
        ("invoice_po_number", "Invoice / PO #", 0.105),
        ("item_number", "Item #", 0.085),
        ("lot", "Lot #", 0.075),
        ("color", "Color", 0.075),
        ("description", "Description", 0.180),
        ("product_size", "Product Size", 0.090),
        ("quantity_per_case", "Quantity Per Case", 0.090),
        ("qty_on_pallet", "# of Cases", 0.075),
        ("units_on_pallet", "Units on this Pallet", 0.095),
        ("balance_owed", "Balance Owed", 0.055),
    ]
    computed_tihi: Dict[str, str] = {}
    try:
        tihi_entries, _tihi_warnings = _mpl_build_tihi_entries(mpl, items)
        computed_tihi = {
            _mpl_clean(entry.get("pallet")): f"{entry.get('ti', '')} x {entry.get('hi', '')}"
            for entry in tihi_entries
        }
    except Exception:
        computed_tihi = {}

    for page_index, page_items in enumerate(chunks, start=1):
        if progress_callback:
            progress_callback(f"Rendering {mpl.get('id', 'MPL')} DecoPac page {page_index}/{len(chunks)}...")
        c.setPageSize((page_w, page_h))
        y = page_h - margin

        c.setFillColorRGB(*theme["primary"])
        c.rect(margin, y - 0.08 * inch, inner_w, 0.08 * inch, fill=1, stroke=0)
        y -= 0.20 * inch
        c.setFillColorRGB(*theme["accent"])
        c.setFont("Helvetica-Bold", 7.8)
        c.drawString(margin + 4, y, _mpl_clean(customer_heading).upper())
        y -= 0.18 * inch
        c.setFillColorRGB(0.05, 0.05, 0.05)
        pallet_heading = _mpl_clean(mpl.get("pallet_heading")) or "PALLET 1"
        _draw_fitted_line(c, pallet_heading, margin + 4, y, inner_w * 0.58, "Helvetica-Bold", 18, min_font_size=7.0)
        c.setFont("Helvetica-Bold", 8.2)
        info_x = margin + 4
        info_y = y - 0.27 * inch
        supplier_lines = [line for line in _mpl_clean(mpl.get("supplier_info")).splitlines() if line.strip()]
        supplier_name = _mpl_clean(mpl.get("delivery_from_name")) or (supplier_lines[0] if supplier_lines else theme["brand_label"])
        detail_lines = [
            ("DELIVERY FROM", supplier_name),
            ("SHIPPING DATE", _mpl_date_short(_mpl_clean(mpl.get("est_ship_date")))),
            ("SHIP TO ADDRESS", _mpl_clean(mpl.get("ship_to")).replace("\n", ", ")),
            ("PHONE #", _mpl_clean(mpl.get("phone_number"))),
            ("CUSTOMER PO(S)", _mpl_clean(mpl.get("customer_po_number"))),
        ]
        for label, value in detail_lines:
            c.setFont("Helvetica-Bold", 7.1)
            c.drawString(info_x, info_y, f"{label}:")
            value_x = info_x + 1.02 * inch
            _draw_fitted_line(c, value, value_x, info_y, inner_w * 0.54, "Helvetica", 7.1, min_font_size=4.0)
            info_y -= 0.16 * inch

        logo_w = 2.55 * inch
        logo_h = 0.90 * inch
        _draw_mpl_brand_logo(c, brand_id, margin + inner_w - logo_w, y - logo_h + 0.06 * inch, logo_w, logo_h)
        c.setFillColorRGB(*theme["primary"])
        c.setFont("Helvetica-Bold", 6.2)
        c.drawRightString(margin + inner_w, y - logo_h - 0.08 * inch, f"PAGE {page_index} OF {len(chunks)}")

        title_top = page_h - 1.90 * inch
        title_h = 0.28 * inch
        _draw_mpl_cell(c, margin, title_top - title_h, inner_w, title_h, theme["label_fill"], _MPL_GRID, 0.55)
        c.setFillColorRGB(0.08, 0.08, 0.08)
        title = _mpl_clean(mpl.get("title")) or "Pallet Breakdown"
        _draw_fitted_line(c, title, margin + inner_w / 2, title_top - title_h / 2 - 3.6, inner_w - 12, "Helvetica-Bold", 11.5, min_font_size=5.0, align="center")

        table_top = title_top - title_h
        header_h = 0.42 * inch
        x = margin
        c.setFillColorRGB(0.06, 0.06, 0.06)
        for _key, label, rel in column_specs:
            cell_w = inner_w * rel
            _draw_mpl_cell(c, x, table_top - header_h, cell_w, header_h, (1, 1, 1), _MPL_GRID, 0.45)
            c.setFillColorRGB(0.06, 0.06, 0.06)
            _draw_centered_wrapped(c, label, x, table_top - header_h / 2, cell_w, "Helvetica-BoldOblique", 6.4, max_lines=2, leading=6.8)
            x += cell_w
        y = table_top - header_h
        row_h = 0.42 * inch
        for row_index, item in enumerate(page_items):
            x = margin
            row_fill = (1, 1, 1) if row_index % 2 == 0 else theme["row_alt"]
            for key, _label, rel in column_specs:
                cell_w = inner_w * rel
                _draw_mpl_cell(c, x, y - row_h, cell_w, row_h, row_fill, _MPL_GRID, 0.35)
                c.setFillColorRGB(0, 0, 0)
                if key == "units_on_pallet":
                    value = _mpl_units_on_pallet(item)
                elif key == "invoice_po_number":
                    value = _mpl_clean(item.get(key)) or _mpl_clean(mpl.get("customer_po_number"))
                elif key == "qty_on_pallet":
                    value = item.get(key) or item.get("total_shipped") or ""
                elif key == "item_number":
                    value = _mpl_item_number_display(item)
                else:
                    value = item.get(key, "")
                _draw_centered_wrapped(c, _mpl_clean(value), x, y - row_h / 2, cell_w, "Helvetica", 5.9, max_lines=2, leading=6.3)
                x += cell_w
            y -= row_h

        if page_index == len(chunks):
            summary_title_y = y - 0.18 * inch
            c.setFillColorRGB(*theme["primary"])
            c.setFont("Helvetica-Bold", 7.4)
            c.drawString(margin, summary_title_y, "PALLET SUMMARY")
            summary_top = summary_title_y - 0.07 * inch
            summary_w = inner_w * 0.66
            summary_headers = [
                ("PALLET NUMBER", 0.20), ("DIMENSIONS", 0.25), ("WEIGHT", 0.18),
                ("TOTAL WEIGHT", 0.20), ("TIHI", 0.17),
            ]
            header_height = 0.20 * inch
            sx = margin
            for label, rel in summary_headers:
                sw = summary_w * rel
                _draw_mpl_cell(c, sx, summary_top - header_height, sw, header_height, theme["label_fill"], _MPL_GRID, 0.4)
                c.setFillColorRGB(0.10, 0.10, 0.10)
                c.setFont("Helvetica-Bold", 5.8)
                c.drawCentredString(sx + sw / 2, summary_top - header_height / 2 - 2, label)
                sx += sw
            summary_y = summary_top - header_height
            pallet_ids = [p for p, _rows in _mpl_group_items(items)] or ["1"]
            dimensions = mpl.get("_pallet_dimensions") if isinstance(mpl.get("_pallet_dimensions"), dict) else {}
            weights = mpl.get("_pallet_weights") if isinstance(mpl.get("_pallet_weights"), dict) else {}
            tihi = mpl.get("_pallet_tihi") if isinstance(mpl.get("_pallet_tihi"), dict) else {}
            for pallet_index, pallet_id in enumerate(pallet_ids[:3]):
                values = [
                    f"Pallet #{_mpl_pallet_label(pallet_id)}",
                    _mpl_clean(dimensions.get(pallet_id)) or "48 x 40 in",
                    _mpl_weight_label(weights.get(pallet_id)),
                    _mpl_clean(mpl.get("total_weight")) if pallet_index == 0 else "",
                    _mpl_clean(tihi.get(pallet_id)) or computed_tihi.get(pallet_id, ""),
                ]
                sx = margin
                cell_h = 0.19 * inch
                for value, (_label, rel) in zip(values, summary_headers):
                    sw = summary_w * rel
                    _draw_mpl_cell(c, sx, summary_y - cell_h, sw, cell_h, theme["value_fill"], _MPL_GRID, 0.35)
                    c.setFillColorRGB(0, 0, 0)
                    _draw_fitted_line(c, value, sx + sw / 2, summary_y - cell_h / 2 - 2, sw - 4, "Helvetica", 5.9, min_font_size=3.5, align="center")
                    sx += sw
                summary_y -= cell_h

        c.setStrokeColorRGB(*theme["primary"])
        c.setLineWidth(0.8)
        c.rect(margin, margin, inner_w, page_h - 2 * margin)
        c.showPage()
    return len(chunks)


__all__ = [
    '_mpl_template_id',
    '_mpl_brand_id',
    '_mpl_template_theme',
    '_draw_mpl_brand_logo',
    '_mpl_item_number_display',
    '_mpl_date_mmddyyyy',
    '_mpl_date_short',
    '_mpl_exp_short',
    '_mpl_weight_label',
    '_mpl_group_items',
    '_mpl_prepare_items',
    '_mpl_col_widths',
    '_draw_wrapped_left',
    '_draw_centered_wrapped',
    '_draw_info_cell',
    '_render_mpl_header',
    '_render_mpl_table_header',
    '_mpl_item_height',
    '_render_mpl_item_row',
    '_render_mpl_pallet_group_row',
    '_mpl_build_units',
    '_mpl_paginate_units',
    '_mpl_units_on_pallet',
    '_render_decopac_mpl_pages',
    "_MPL_BRAND_LOGO_PATHS",
    "_MPL_BRAND_THEMES",
]
