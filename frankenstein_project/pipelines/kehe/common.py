"""Shared KeHE models, normalization, draft helpers, and drawing primitives.

Document-specific implementations live in the sibling ``gs1_labels``,
``pallet_labels``, ``pack_labels``, ``mpl``, and ``tihi`` modules. Lazy exports
at the bottom preserve historic imports from this module.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from reportlab.graphics.barcode import code128
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


# Compatibility imports for shared ASN models and legacy callers.
from .asn_parser import (
    DEFAULT_KEHE_SHIP_FROM,
    PROJECT_ROOT,
    Address,
    Item,
    Order,
    Pack,
    _append_unique_csv,
    _extract_bsn_hl_groups,
    _first_ref,
    _format_edi_date,
    _get_elem,
    _normalize,
    _parse_shipment_group,
    _scan_dates,
    _scan_ref_values,
    _segment_refs,
    _status_log,
    find_kehe_dc,
    load_kehe_dc_directory,
    parse_asn,
)

def wrap_text(text: str, font_name: str, font_size: float, max_width: float, max_lines: int = 99) -> List[str]:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return []
    words = text.split()
    lines: List[str] = []
    cur = ""
    for word in words:
        pieces = [word]
        if pdfmetrics.stringWidth(word, font_name, font_size) > max_width:
            pieces = []
            piece = ""
            for char in word:
                test_piece = piece + char
                if piece and pdfmetrics.stringWidth(test_piece, font_name, font_size) > max_width:
                    pieces.append(piece)
                    piece = char
                else:
                    piece = test_piece
            if piece:
                pieces.append(piece)
        for piece in pieces:
            test = (cur + " " + piece).strip()
            if not cur or pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
                cur = test
            else:
                lines.append(cur)
                cur = piece
            if len(lines) >= max_lines:
                return lines[:max_lines]
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    return lines


def fit_text_lines(
    text: Any,
    font_name: str,
    font_size: float,
    max_width: float,
    max_lines: int,
    min_font_size: float = 3.5,
) -> Tuple[List[str], float]:
    """Shrink text until every character fits in the requested line box."""
    clean = re.sub(r"\s+", " ", str(text or "").strip())
    if not clean:
        return [], font_size
    fitted_size = font_size
    while fitted_size > min_font_size:
        lines = wrap_text(clean, font_name, fitted_size, max_width, max_lines=9999)
        if len(lines) <= max_lines:
            return lines, fitted_size
        fitted_size = max(min_font_size, fitted_size - 0.5)
    return wrap_text(clean, font_name, fitted_size, max_width, max_lines=9999), fitted_size


def _draw_fitted_line(
    c: canvas.Canvas,
    text: Any,
    x: float,
    y: float,
    max_width: float,
    font_name: str,
    font_size: float,
    *,
    min_font_size: float = 3.5,
    align: str = "left",
) -> None:
    value = str(text or "").strip()
    fitted_size = font_size
    while fitted_size > min_font_size and pdfmetrics.stringWidth(value, font_name, fitted_size) > max_width:
        fitted_size = max(min_font_size, fitted_size - 0.5)
    c.setFont(font_name, fitted_size)
    if align == "center":
        c.drawCentredString(x, y, value)
    elif align == "right":
        c.drawRightString(x, y, value)
    else:
        c.drawString(x, y, value)


def normalize_sscc(sscc_raw: str) -> str:
    digits = re.sub(r"\D", "", sscc_raw or "")
    if len(digits) >= 20 and digits.startswith("00"):
        return digits[2:20]
    if len(digits) == 18:
        return digits
    return digits[-18:] if len(digits) > 18 else digits


def format_sscc_groups(sscc18: str) -> str:
    d = sscc18
    if len(d) != 18:
        return d
    return f"{d[0]} {d[1:3]} {d[3:8]} {d[8:17]} {d[17]}"


def _zip_for_ai420(zip_code: str) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", (zip_code or "").strip())


def _format_label_date_mmddyyyy(value: str) -> str:
    """Convert any label date value to MM/DD/YYYY. Leave MIXED/blank untouched."""
    value = (value or "").strip()
    if not value or value.upper() == "MIXED":
        return value

    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$", value)
    if m:
        mm = int(m.group(1))
        dd = int(m.group(2))
        year_s = m.group(3)
        year = int(year_s) + 2000 if len(year_s) == 2 else int(year_s)
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    digits = re.sub(r"\D", "", value)
    if len(digits) == 8 and 1900 <= int(digits[:4]) <= 2100:
        return f"{digits[4:6]}/{digits[6:8]}/{digits[0:4]}"
    if len(digits) == 8 and 1900 <= int(digits[4:8]) <= 2100:
        return f"{digits[0:2]}/{digits[2:4]}/{digits[4:8]}"
    if len(digits) == 6:
        return f"{digits[2:4]}/{digits[4:6]}/20{digits[0:2]}"

    return value


def _one_or_mixed(values: List[str], default: str = "") -> str:
    vals = [v.strip() for v in values if v and v.strip()]
    unique = []
    for v in vals:
        if v not in unique:
            unique.append(v)
    if not unique:
        return default
    if len(unique) == 1:
        return unique[0]
    return "MIXED"


def _pack_content_summary(pack: Pack) -> Dict[str, str]:
    qty = sum(max(0, it.qty) for it in pack.items)
    if not pack.items:
        return {
            "contents": "",
            "item": "",
            "desc": "",
            "qty": "",
            "lot": "",
            "expiration": "",
            "manufacture": "",
            "plant": "",
        }

    upcs = [it.upc or it.retailer_item or it.vendor_item for it in pack.items]
    descs = [it.description for it in pack.items]
    product_keys = {
        ((it.upc or it.retailer_item or it.vendor_item or "").strip(), (it.description or "").strip())
        for it in pack.items
        if (it.upc or it.retailer_item or it.vendor_item or it.description)
    }
    mixed = len(product_keys) > 1
    return {
        "contents": "MIXED" if mixed else (_one_or_mixed(upcs) or ""),
        "item": "MIXED" if mixed else (_one_or_mixed([it.retailer_item or it.upc or it.vendor_item for it in pack.items]) or ""),
        "desc": "MIXED" if mixed else (_one_or_mixed(descs) or ""),
        "qty": str(qty) if qty else "",
        "lot": _one_or_mixed([it.lot for it in pack.items]),
        "expiration": _one_or_mixed([it.expiration_date for it in pack.items]),
        "manufacture": _one_or_mixed([it.manufacture_date for it in pack.items]),
        "plant": _one_or_mixed([it.plant for it in pack.items]),
    }


def _draw_label(c: canvas.Canvas, x: float, y: float, text: str, size: float = 7.5) -> None:
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, text)


def _draw_value_lines(
    c: canvas.Canvas,
    lines: List[str],
    x: float,
    y: float,
    width: float,
    size: float = 7.5,
    leading: float = 9,
    max_lines: int = 4,
) -> float:
    source = " | ".join(str(line or "").strip() for line in lines if str(line or "").strip())
    wrapped, fitted_size = fit_text_lines(source, "Helvetica", size, width, max_lines, min_font_size=5.0)
    fitted_leading = leading * (fitted_size / size)
    c.setFont("Helvetica", fitted_size)
    for line in wrapped:
        c.drawString(x, y, line)
        y -= fitted_leading
    return y


def _draw_code128_centered(
    c: canvas.Canvas,
    value: str,
    x0: float,
    x1: float,
    y: float,
    height: float,
    max_width: float,
    bar_width: float = 0.014 * inch,
    min_bar_width: float = 0.0065 * inch,
) -> None:
    barcode = code128.Code128(value, barHeight=height, barWidth=bar_width, humanReadable=False)
    while barcode.width > max_width and bar_width > min_bar_width:
        bar_width *= 0.92
        barcode = code128.Code128(value, barHeight=height, barWidth=bar_width, humanReadable=False)
    barcode.drawOn(c, x0 + ((x1 - x0) - barcode.width) / 2, y)


# Shared document-draft helpers.

from .document_headers import (
    _addr_dict_to_str,
    _file_hash,
    build_document_shipments,
    parse_kehe_document_header,
    parse_kehe_document_headers,
)

def _ship_from_str(header: Dict[str, Any], packs: list) -> str:
    """Build ship-from address string from header or first pack."""
    sf = header.get("xml_ship_from") or {}
    if sf and sf.get("name"):
        return _addr_dict_to_str(sf)
    if packs:
        p = packs[0]
        addr = p.ship_from
        parts = []
        if addr.name:
            parts.append(addr.name.upper())
        if addr.line1:
            parts.append(addr.line1.upper())
        if addr.line2:
            parts.append(addr.line2.upper())
        city_line = ", ".join(filter(None, [addr.city.upper(), addr.state.upper()]))
        if addr.zip:
            city_line = f"{city_line} {addr.zip}".strip() if city_line else addr.zip
        if city_line:
            parts.append(city_line)
        if addr.country and addr.country.upper() not in ("US", "USA", ""):
            parts.append(addr.country.upper())
        else:
            parts.append("USA")
        return "\n".join(parts)
    return ""


def _dc_ship_from_str(dc_info: Optional[Dict[str, Any]], header: Dict[str, Any], packs: list) -> str:
    """Use XML ship-from for XML-generated documents; fall back only if XML is blank.

    DC Directory ship_from is intentionally used only by the frontend manual
    DC Directory Preview flow, not by XML-generated Pallet Label / MPL drafts.
    """
    return _ship_from_str(header, packs) or DEFAULT_KEHE_SHIP_FROM


def _ship_to_str(dc_info: Optional[Dict[str, Any]], xml_ship_to: Dict[str, str]) -> str:
    if dc_info:
        return dc_info["delivery_address"]
    raw = _addr_dict_to_str(xml_ship_to) if xml_ship_to else ""
    prefix = "NEEDS REVIEW \u2014 UNKNOWN KEHE DC\n\nXML Ship To:\n"
    return prefix + (raw or "(not found in XML)")


def _billing_str(dc_info: Optional[Dict[str, Any]]) -> str:
    if dc_info:
        return dc_info["billing_address"]
    return ""


def _pack_po_numbers(pack: Pack, fallback_po: str = "") -> str:
    """Return the PO number(s) that belong to one pallet/pack."""
    candidates = [pack.po, fallback_po]
    out: List[str] = []
    for value in candidates:
        value = (value or "").strip()
        if value and value not in out:
            out.append(value)
    return ", ".join(out)


def _pack_item_count(pack: Pack) -> int:
    return sum(max(0, int(getattr(item, "qty", 0) or 0)) for item in (pack.items or []))


def _display_uom(uom: str) -> str:
    value = (uom or "").strip().upper()
    if value == "CA":
        return "CASES"
    return value or "CASES"


def _safe_positive_int(value: Any, default: int = 1) -> int:
    try:
        n = int(str(value or "").strip())
        return n if n > 0 else default
    except (ValueError, TypeError):
        return default


def _pallet_ids_for_total(total_pallets: Any) -> List[str]:
    total = _safe_positive_int(total_pallets, 1)
    return [str(i) for i in range(1, total + 1)]


def _derive_case_upc(item: Item) -> str:
    if item.case_upc:
        return item.case_upc
    for value in (item.retailer_item, item.vendor_item):
        digits = re.sub(r"\D", "", value or "")
        if len(digits) >= 12:
            return value
    digits = re.sub(r"\D", "", item.upc or "")
    if len(digits) in (12, 13):
        return "2" + digits.zfill(13)
    return ""


def _aggregate_mpl_items_for_editor(
    packs: List[Pack],
    warnings: List[str],
    *,
    total_pallets: str = "1",
    preserve_pack_pallets: bool = False,
    default_pallet: str = "1",
) -> List[Dict[str, Any]]:
    """Aggregate XML item rows into editable MPL lines.

    Important KeHE rule:
      - If HL03=T or TD101 says PLT/Pallet, each physical SSCC stays with its parent pallet/pack loop.
        Items must stay with their parent pack/tare loop.
      - If TD101 says CTN/Carton or the XML is unclear, leave item rows
        Unassigned so the frontend/user can Auto Palletize or manually assign.

    The aggregation key includes pallet number whenever `preserve_pack_pallets`
    is true. That prevents the same UPC from being merged across different
    pallets and avoids the previous wrong round-robin pallet assignment.
    """
    aggregated: Dict[Tuple[str, str, str, str, str, str, str], Dict[str, Any]] = {}
    allowed_pallets = set(_pallet_ids_for_total(total_pallets))

    for fallback_idx, pack in enumerate(packs, start=1):
        pallet_number = str(pack.carton_index or fallback_idx) if preserve_pack_pallets else str(default_pallet or "")
        if preserve_pack_pallets and allowed_pallets and pallet_number not in allowed_pallets:
            # Keep real XML order, but do not create impossible pallet numbers when
            # TD102 and physical SSCC count disagree. User can still edit the draft.
            pallet_number = str(fallback_idx)

        for item in pack.items:
            upc = item.upc or item.retailer_item or item.vendor_item
            case_upc = _derive_case_upc(item)
            description = item.description or ""
            lot = item.lot or pack.lot or ""
            expiration_date = item.expiration_date or pack.expiration_date or ""
            uom = _display_uom(item.uom)
            key = (pallet_number if preserve_pack_pallets else "", upc, case_upc, description, lot, expiration_date, uom)

            if key not in aggregated:
                line_no = len(aggregated) + 1
                if not upc:
                    warnings.append(f"Line {line_no}: missing item UPC")
                if not item.qty:
                    warnings.append(f"Line {line_no}: missing quantity")
                if not expiration_date:
                    warnings.append(f"Line {line_no}: missing expiration date")

                aggregated[key] = {
                    "line": line_no,
                    "location_on_pallet": pallet_number,
                    "item_number": upc,
                    "upc": upc,
                    "case_upc": case_upc,
                    "description": description,
                    "lot": lot,
                    "expiration_date": expiration_date,
                    "uom": uom,
                    "gtin": case_upc or upc,
                    "sku": item.vendor_item or item.retailer_item,
                    "packaging_level": "",
                    "length_in": "",
                    "width_in": "",
                    "height_in": "",
                    "dimensions_in": "",
                    "unit_weight_lbs": "",
                    "calculated_weight_lbs": "",
                    "qty_on_pallet": 0,
                    "total_ordered": 0,
                    "total_shipped": 0,
                    "pallet_weight": "",
                    "notes": "",
                    "source_sscc": normalize_sscc(pack.sscc),
                    "customer_po_number": item.po or pack.po,
                }
            else:
                aggregated[key]["customer_po_number"] = _append_unique_csv(
                    aggregated[key].get("customer_po_number", ""),
                    item.po or pack.po,
                )

            qty = int(item.qty or 0)
            aggregated[key]["qty_on_pallet"] += qty
            aggregated[key]["total_ordered"] += qty
            aggregated[key]["total_shipped"] += qty

    rows = list(aggregated.values())
    for idx, row in enumerate(rows, start=1):
        row["line"] = idx
        for key in ("qty_on_pallet", "total_ordered", "total_shipped"):
            row[key] = str(row[key]) if row[key] else ""
    return rows


# Compatibility imports for Product Master helpers and legacy callers.

from .product_master import (
    _PACKAGING_LEVELS,
    _apply_product_row_to_item,
    _boolish,
    _canonical_id,
    _find_product_packaging_sibling,
    _format_lbs,
    _format_number,
    _gtin14,
    _legacy_product_master_adapter,
    _match_product_master_row,
    _normalize_packaging_level,
    _normalize_product_master_rows,
    _only_digits,
    _parse_float,
    _product_dimensions_display,
    _product_in_packing_list,
    _product_master_lookup,
    _qty_value,
    _truthy,
    apply_product_master_to_mpl_draft,
)


def _extracted_rows_from_shipments(shipments: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    headers: List[Dict[str, Any]] = []
    items: List[Dict[str, Any]] = []
    for ship in shipments:
        header = ship.get("header", {})
        dc_info = ship.get("dc_info")
        packs = ship.get("packs") or []
        headers.append({
            "document_type": "KeHE XML",
            "status": "Needs Review" if ship.get("needs_review") else "Ready",
            "source_file": header.get("source_file", ""),
            "dc": dc_info.get("dc", "") if dc_info else "Unknown",
            "dc_name": dc_info.get("name", "") if dc_info else "",
            "ship_to_gln": header.get("ship_to_gln", ""),
            "customer_po_numbers": header.get("customer_po_number", ""),
            "po_date": header.get("po_date", ""),
            "order_no": header.get("order_no", ""),
            "vendor_number": header.get("vendor_number", ""),
            "bsn": header.get("bsn", ""),
            "ship_date": header.get("ship_date", ""),
            "expected_delivery_date": header.get("expected_delivery_date", ""),
            "carrier": header.get("carrier", ""),
            "pro_number": header.get("pro_number", ""),
            "bol_number": header.get("bol_number", ""),
            "carton_count": header.get("carton_count", ""),
            "pack_count": header.get("pack_count", ""),
            "item_rows": sum(len(pack.items or []) for pack in packs),
            "total_weight": header.get("total_weight", ""),
            "cube": header.get("cube", ""),
            "total_pallets": header.get("total_pallets", ""),
            "ship_via": header.get("carrier", ""),
            "xml_ship_to": _addr_dict_to_str(header.get("xml_ship_to", {})) if header.get("xml_ship_to") else "",
            "final_ship_to": _ship_to_str(dc_info, header.get("xml_ship_to", {})),
            "ship_from": _dc_ship_from_str(dc_info, header, packs),
            "warnings": "; ".join(header.get("warnings", [])),
        })
        for pack_index, pack in enumerate(packs, start=1):
            for line, item in enumerate(pack.items or [], start=1):
                items.append({
                    "source_file": header.get("source_file", ""),
                    "dc": dc_info.get("dc", "") if dc_info else "Unknown",
                    "po": item.retailer_item or pack.po or header.get("customer_po_number", ""),
                    "customer_po_number": item.po or pack.po or header.get("customer_po_number", ""),
                    "carton": str(pack.carton_index or pack_index),
                    "sscc": normalize_sscc(pack.sscc),
                    "line": line,
                    "location_on_pallet": str(pack.carton_index or pack_index),
                    "item_number": item.upc or item.retailer_item or item.vendor_item,
                    "upc": item.upc,
                    "case_upc": _derive_case_upc(item),
                    "description": item.description,
                    "qty": str(item.qty or ""),
                    "uom": _display_uom(item.uom),
                    "lot": item.lot or pack.lot,
                    "expiration_date": item.expiration_date or pack.expiration_date,
                    "manufacture_date": item.manufacture_date,
                    "plant": item.plant or pack.plant,
                })
    return headers, items


# ===========================================================================
# PDF rendering helpers
# ===========================================================================

# App-theme color palette
_COLOR_NEEDS_REVIEW_FILL = (0xfe / 255, 0xf2 / 255, 0xf2 / 255)   # #fef2f2
_COLOR_NEEDS_REVIEW_BORDER = (0xfe / 255, 0xca / 255, 0xca / 255)  # #fecaca
_COLOR_NEEDS_REVIEW_TEXT = (0xb9 / 255, 0x1c / 255, 0x1c / 255)    # #b91c1c

_COLOR_HEADER_BG = (0xf8 / 255, 0xfa / 255, 0xfc / 255)  # #f8fafc
_COLOR_BORDER = (0xe2 / 255, 0xe8 / 255, 0xf0 / 255)     # #e2e8f0
_COLOR_LABEL = (0x64 / 255, 0x74 / 255, 0x8b / 255)      # #64748b (slate)


def _draw_rect_with_fill(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    fill_rgb: Tuple[float, float, float],
    stroke_rgb: Tuple[float, float, float],
    line_width: float = 0.5,
) -> None:
    c.setFillColorRGB(*fill_rgb)
    c.setStrokeColorRGB(*stroke_rgb)
    c.setLineWidth(line_width)
    c.rect(x, y, w, h, fill=1, stroke=1)


def _draw_warning_box(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    w: float,
    font_size: float = 7.5,
    padding: float = 6,
) -> float:
    """Draw a red warning box, return bottom y coordinate."""
    source_lines = [ln for ln in text.split("\n") if ln.strip()]
    lines: List[str] = []
    fitted_size = font_size
    for source_line in source_lines:
        source_wrapped, source_size = fit_text_lines(
            source_line,
            "Helvetica-Bold",
            font_size,
            w - padding * 2,
            2,
            min_font_size=4.0,
        )
        lines.extend(source_wrapped)
        fitted_size = min(fitted_size, source_size)
    leading = fitted_size + 2
    box_h = padding * 2 + len(lines) * leading
    by = y - box_h
    _draw_rect_with_fill(
        c, x, by, w, box_h,
        _COLOR_NEEDS_REVIEW_FILL,
        _COLOR_NEEDS_REVIEW_BORDER,
        line_width=0.75,
    )
    ty = y - padding - fitted_size
    c.setFont("Helvetica-Bold", fitted_size)
    c.setFillColorRGB(*_COLOR_NEEDS_REVIEW_TEXT)
    for line in lines:
        c.drawString(x + padding, ty, line)
        ty -= leading
    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    return by


# Shared MPL/TI-HI layout constants. KeHE's MPL uses full-page A4 output.
_MPL_PAGE_W, _MPL_PAGE_H = A4
_MPL_MARGIN = 0.32 * inch
_MPL_INNER_W = _MPL_PAGE_W - 2 * _MPL_MARGIN
_MPL_INNER_TOP = _MPL_PAGE_H - _MPL_MARGIN
_MPL_INNER_BOTTOM = _MPL_MARGIN

# Column definitions: (key, header label, relative_width)
_ITEM_COLUMNS: List[Tuple[str, str, float]] = [
    ("item_number",        "Item Number",                      0.17),
    ("_description_block", "Pallet Weight &\nItem Description", 0.39),
    ("uom",                "UOM",                              0.10),
    ("qty_on_pallet",      "Qty On\nPallet",                    0.11),
    ("total_ordered",      "Total\nOrdered",                    0.11),
    ("total_shipped",      "Total\nShipped",                    0.12),
]

_MPL_BLACK = (0, 0, 0)
_MPL_GRID = (0.30, 0.30, 0.30)
_MPL_GREY = (0.82, 0.82, 0.82)
_MPL_LIGHT_GREY = (0.90, 0.90, 0.90)
_MPL_CREAM = (0.98, 0.95, 0.82)
_MPL_ROW_ALT = (0.97, 0.97, 0.97)
_MPL_NAVY = (0.09, 0.21, 0.36)
_MPL_BLUE_LIGHT = (0.86, 0.92, 0.99)
_MPL_BLUE_PALE = (0.97, 0.985, 1.0)
_MPL_TEAL = (0.07, 0.37, 0.35)
_MPL_TEAL_LIGHT = (0.80, 0.98, 0.95)
_MPL_TEAL_PALE = (0.97, 1.0, 0.99)
_MPL_PALLET_LENGTH_IN = 48.0
_MPL_PALLET_WIDTH_IN = 40.0
_MPL_PALLET_MAX_HEIGHT_IN = 70.0
_MPL_PALLET_MAX_GROSS_LBS = 2000.0
_MPL_PALLET_TARE_LBS = 50.0
_MPL_PALLET_BUFFER_FACTOR = 1.05


def _mpl_clean(value: Any) -> str:
    return str(value or "").strip()


def _mpl_pallet_value(item: Dict[str, Any]) -> str:
    return _mpl_clean(item.get("location_on_pallet")) or "1"


def _mpl_pallet_sort_key(value: str) -> Tuple[int, Any]:
    v = _mpl_clean(value)
    m = re.search(r"\d+", v)
    if m:
        return (0, int(m.group(0)))
    return (1, v.lower())


def _mpl_pallet_label(value: str) -> str:
    v = _mpl_clean(value)
    m = re.search(r"\d+", v)
    return m.group(0) if m else (v or "1")


def _draw_mpl_cell(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    fill_rgb: Tuple[float, float, float],
    stroke_rgb: Tuple[float, float, float] = _MPL_GRID,
    line_width: float = 0.35,
) -> None:
    c.setFillColorRGB(*fill_rgb)
    c.setStrokeColorRGB(*stroke_rgb)
    c.setLineWidth(line_width)
    c.rect(x, y, w, h, fill=1, stroke=1)

# Lazy compatibility exports keep historic ``pipelines.kehe.common`` imports working
# without making this shared module import every document renderer at startup.
_KEHE_COMPAT_EXPORTS = {
    '_MPL_BRAND_LOGO_PATHS': ('mpl', '_MPL_BRAND_LOGO_PATHS'),
    '_MPL_BRAND_THEMES': ('mpl', '_MPL_BRAND_THEMES'),
    '_build_generation_report': ('gs1_labels', '_build_generation_report'),
    '_build_pallet_label_entry': ('pallet_labels', '_build_pallet_label_entry'),
    '_bytes_to_fitz': ('gs1_labels', '_bytes_to_fitz'),
    '_default_copies': ('pack_labels', '_default_copies'),
    '_draw_centered_wrapped': ('mpl', '_draw_centered_wrapped'),
    '_draw_info_cell': ('mpl', '_draw_info_cell'),
    '_draw_itf14_centered': ('pack_labels', '_draw_itf14_centered'),
    '_draw_mpl_brand_logo': ('mpl', '_draw_mpl_brand_logo'),
    '_draw_mpl_snapshot_page': ('tihi', '_draw_mpl_snapshot_page'),
    '_draw_pack_label_page': ('pack_labels', '_draw_pack_label_page'),
    '_draw_wrapped_left': ('mpl', '_draw_wrapped_left'),
    '_find_product_rows_for_xml_item': ('pack_labels', '_find_product_rows_for_xml_item'),
    '_is_kehe_pack_label_eligible': ('pack_labels', '_is_kehe_pack_label_eligible'),
    '_itf14_runs': ('pack_labels', '_itf14_runs'),
    '_mpl_best_tihi_orientation': ('tihi', '_mpl_best_tihi_orientation'),
    '_mpl_brand_id': ('mpl', '_mpl_brand_id'),
    '_mpl_build_pallet_tihi_layout': ('tihi', '_mpl_build_pallet_tihi_layout'),
    '_mpl_build_tihi_entries': ('tihi', '_mpl_build_tihi_entries'),
    '_mpl_build_tihi_layer_patterns': ('tihi', '_mpl_build_tihi_layer_patterns'),
    '_mpl_build_units': ('mpl', '_mpl_build_units'),
    '_mpl_col_widths': ('mpl', '_mpl_col_widths'),
    '_mpl_date_mmddyyyy': ('mpl', '_mpl_date_mmddyyyy'),
    '_mpl_date_short': ('mpl', '_mpl_date_short'),
    '_mpl_draw_tihi_pattern_mini': ('tihi', '_mpl_draw_tihi_pattern_mini'),
    '_mpl_draw_tihi_side_view': ('tihi', '_mpl_draw_tihi_side_view'),
    '_mpl_draw_tihi_top_view': ('tihi', '_mpl_draw_tihi_top_view'),
    '_mpl_exp_short': ('mpl', '_mpl_exp_short'),
    '_mpl_finalize_height_zone_patterns': ('tihi', '_mpl_finalize_height_zone_patterns'),
    '_mpl_group_items': ('mpl', '_mpl_group_items'),
    '_mpl_is_fully_covered_by_higher': ('tihi', '_mpl_is_fully_covered_by_higher'),
    '_mpl_item_height': ('mpl', '_mpl_item_height'),
    '_mpl_item_number_display': ('mpl', '_mpl_item_number_display'),
    '_mpl_paginate_units': ('mpl', '_mpl_paginate_units'),
    '_mpl_pick_best_layer_placement': ('tihi', '_mpl_pick_best_layer_placement'),
    '_mpl_prepare_items': ('mpl', '_mpl_prepare_items'),
    '_mpl_rect_length': ('tihi', '_mpl_rect_length'),
    '_mpl_rect_width': ('tihi', '_mpl_rect_width'),
    '_mpl_round_product_weight_for_pallet': ('tihi', '_mpl_round_product_weight_for_pallet'),
    '_mpl_score_gt': ('tihi', '_mpl_score_gt'),
    '_mpl_snapshot_image_reader': ('tihi', '_mpl_snapshot_image_reader'),
    '_mpl_subtract_rect': ('tihi', '_mpl_subtract_rect'),
    '_mpl_template_id': ('mpl', '_mpl_template_id'),
    '_mpl_template_theme': ('mpl', '_mpl_template_theme'),
    '_mpl_tihi_candidate_values': ('tihi', '_mpl_tihi_candidate_values'),
    '_mpl_tihi_case_qty': ('tihi', '_mpl_tihi_case_qty'),
    '_mpl_tihi_color': ('tihi', '_mpl_tihi_color'),
    '_mpl_tihi_color_key': ('tihi', '_mpl_tihi_color_key'),
    '_mpl_tihi_constraints': ('tihi', '_mpl_tihi_constraints'),
    '_mpl_tihi_edge_overlap_score': ('tihi', '_mpl_tihi_edge_overlap_score'),
    '_mpl_tihi_has_lighter_support_overlap': ('tihi', '_mpl_tihi_has_lighter_support_overlap'),
    '_mpl_tihi_internal_x_edges': ('tihi', '_mpl_tihi_internal_x_edges'),
    '_mpl_tihi_intersection_area': ('tihi', '_mpl_tihi_intersection_area'),
    '_mpl_tihi_item_label': ('tihi', '_mpl_tihi_item_label'),
    '_mpl_tihi_layer_capacity': ('tihi', '_mpl_tihi_layer_capacity'),
    '_mpl_tihi_layer_signature': ('tihi', '_mpl_tihi_layer_signature'),
    '_mpl_tihi_layer_variant_valid': ('tihi', '_mpl_tihi_layer_variant_valid'),
    '_mpl_tihi_pattern_letter': ('tihi', '_mpl_tihi_pattern_letter'),
    '_mpl_tihi_placement_options': ('tihi', '_mpl_tihi_placement_options'),
    '_mpl_tihi_rects_overlap': ('tihi', '_mpl_tihi_rects_overlap'),
    '_mpl_tihi_snapshot_payload': ('tihi', '_mpl_tihi_snapshot_payload'),
    '_mpl_tihi_support_levels': ('tihi', '_mpl_tihi_support_levels'),
    '_mpl_tihi_support_ratio': ('tihi', '_mpl_tihi_support_ratio'),
    '_mpl_tihi_support_surfaces': ('tihi', '_mpl_tihi_support_surfaces'),
    '_mpl_tihi_top_z': ('tihi', '_mpl_tihi_top_z'),
    '_mpl_tihi_transform_layer': ('tihi', '_mpl_tihi_transform_layer'),
    '_mpl_tihi_z_overlaps': ('tihi', '_mpl_tihi_z_overlaps'),
    '_mpl_units_on_pallet': ('mpl', '_mpl_units_on_pallet'),
    '_mpl_visible_top_placements': ('tihi', '_mpl_visible_top_placements'),
    '_mpl_weight_label': ('mpl', '_mpl_weight_label'),
    '_pack_label_kind': ('pack_labels', '_pack_label_kind'),
    '_product_case_qty': ('pack_labels', '_product_case_qty'),
    '_render_decopac_mpl_pages': ('mpl', '_render_decopac_mpl_pages'),
    '_render_mpl_header': ('mpl', '_render_mpl_header'),
    '_render_mpl_item_row': ('mpl', '_render_mpl_item_row'),
    '_render_mpl_pallet_group_row': ('mpl', '_render_mpl_pallet_group_row'),
    '_render_mpl_table_header': ('mpl', '_render_mpl_table_header'),
    '_render_mpl_tihi_card': ('tihi', '_render_mpl_tihi_card'),
    '_render_mpl_tihi_pages': ('tihi', '_render_mpl_tihi_pages'),
    '_render_pallet_label_page': ('pallet_labels', '_render_pallet_label_page'),
    '_same_sku': ('pack_labels', '_same_sku'),
    '_validate_mpl_each_item_numbers': ('mpl', '_validate_mpl_each_item_numbers'),
    '_xml_case_qty': ('pack_labels', '_xml_case_qty'),
    'build_kehe_master_packing_list_draft': ('mpl', 'build_kehe_master_packing_list_draft'),
    'build_kehe_pack_label_draft': ('pack_labels', 'build_kehe_pack_label_draft'),
    'build_kehe_pallet_label_draft': ('pallet_labels', 'build_kehe_pallet_label_draft'),
    'main': ('gs1_labels', 'main'),
    'render_gs1_label_page': ('gs1_labels', 'render_gs1_label_page'),
    'render_kehe_master_packing_list_pdf': ('mpl', 'render_kehe_master_packing_list_pdf'),
    'render_kehe_pack_label_pdf': ('pack_labels', 'render_kehe_pack_label_pdf'),
    'render_kehe_pallet_label_pdf': ('pallet_labels', 'render_kehe_pallet_label_pdf'),
    'run_pipeline': ('gs1_labels', 'run_pipeline'),
}

def __getattr__(name: str) -> Any:
    target = _KEHE_COMPAT_EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from importlib import import_module
    module_name, attribute = target
    module = import_module(f"{__package__}.{module_name}")
    return getattr(module, attribute)

def __dir__() -> List[str]:
    return sorted(set(globals()) | set(_KEHE_COMPAT_EXPORTS))
