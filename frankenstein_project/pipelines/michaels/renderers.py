"""Michaels GS1, packing-list, and fallback PDF renderers."""

from __future__ import annotations

import io
import re
from typing import List, Tuple

import pymupdf as fitz
from reportlab.graphics.barcode import code128
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from .common import Pack, PageOcrData
def wrap_text(text: str, font_name: str, font_size: float, max_width: float) -> List[str]:
    return hard_wrap(text, font_name, font_size, max_width)


def hard_wrap(text: str, font_name: str, font_size: float, max_width: float) -> List[str]:
    words = (text or "").strip().split()
    lines: List[str] = []
    for word in words:
        if pdfmetrics.stringWidth(word, font_name, font_size) <= max_width:
            if not lines:
                lines.append(word)
            else:
                test = lines[-1] + " " + word
                if pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
                    lines[-1] = test
                else:
                    lines.append(word)
        else:
            cur = ""
            for ch in word:
                test = cur + ch
                if pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
                    cur = test
                else:
                    if cur:
                        lines.append(cur)
                    cur = ch
            if cur:
                lines.append(cur)
    return lines or [""]


def fit_text_lines(
    text: str,
    font_name: str,
    font_size: float,
    max_width: float,
    max_lines: int,
    min_font_size: float = 4.0,
) -> Tuple[List[str], float]:
    fitted_size = font_size
    while fitted_size > min_font_size:
        lines = hard_wrap(text, font_name, fitted_size, max_width)
        if len(lines) <= max_lines:
            return lines, fitted_size
        fitted_size = max(min_font_size, fitted_size - 0.5)
    return hard_wrap(text, font_name, fitted_size, max_width), fitted_size


def draw_fitted_line(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font_name: str,
    font_size: float,
    *,
    min_font_size: float = 4.0,
    align: str = "left",
) -> None:
    value = str(text or "")
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


def format_michaels_item_number(raw_cb: str) -> str:
    s = (raw_cb or "").strip()
    if s.isdigit() and len(s) == 6:
        return "10" + s
    return s


# ===========================================================================
# PDF renderers
# ===========================================================================

def render_gs1_label_page(pack: Pack, order_index: int, total_orders: int) -> bytes:
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    FS_ADDR        = 12
    FS_INFO        = 14
    FS_STORE_LABEL = 12
    FS_STORE       = 36
    FS_BAR_HR      = 10
    LH_ADDR        = 0.155 * inch
    LH_INFO        = 0.24 * inch
    margin         = 0.12 * inch
    pad            = 0.10 * inch

    c.setLineWidth(2)
    c.rect(margin, margin, W - 2 * margin, H - 2 * margin)

    inner_left  = margin
    inner_right = W - margin
    xL          = inner_left + pad
    xR          = W / 2 + pad
    left_w      = W / 2 - margin - pad
    right_w     = W / 2 - pad - margin

    top_section_h = 1.65 * inch
    top_y0        = H - margin - top_section_h

    c.setLineWidth(1.5)
    c.line(inner_left, top_y0, inner_right, top_y0)
    c.line(W / 2, top_y0, W / 2, H - margin)

    sf = pack.ship_from
    st = pack.ship_to
    yT = H - margin - 0.28 * inch

    c.setFont("Helvetica-Bold", FS_ADDR)
    c.drawString(xL, yT, "SHIP FROM:")
    y = yT - 0.18 * inch
    from_text = " | ".join(line for line in [sf.name, sf.line1, sf.line2, f"{sf.city} {sf.state} {sf.zip}".strip()] if line.strip())
    from_lines, from_size = fit_text_lines(from_text, "Helvetica", FS_ADDR, left_w, 6, min_font_size=6.0)
    c.setFont("Helvetica", from_size)
    for line in from_lines:
        c.drawString(xL, y, line)
        y -= LH_ADDR * (from_size / FS_ADDR)

    y = yT
    c.setFont("Helvetica-Bold", FS_ADDR)
    c.drawString(xR, y, "SHIP TO:")
    y -= 0.18 * inch
    to_text = " | ".join(line for line in [st.name, st.line1, st.line2, f"{st.city} {st.state} {st.zip}".strip()] if line.strip())
    to_lines, to_size = fit_text_lines(to_text, "Helvetica", FS_ADDR, right_w, 6, min_font_size=6.0)
    c.setFont("Helvetica", to_size)
    for line in to_lines:
        c.drawString(xR, y, line)
        y -= LH_ADDR * (to_size / FS_ADDR)

    y = top_y0 - 0.25 * inch
    draw_fitted_line(c, f"PO# {pack.po}", xL, y, inner_right - xL - pad, "Helvetica-Bold", FS_INFO, min_font_size=7.0)
    y -= LH_INFO

    ec = (pack.event_code or "").strip()
    if ec in ("", "0", "00", "000", "0 0"):
        ec = ""
    c.setFont("Helvetica-Bold", FS_INFO)
    c.drawString(xL, y, "Event Code:")
    if ec:
        lw = pdfmetrics.stringWidth("Event Code:  ", "Helvetica-Bold", FS_INFO)
        draw_fitted_line(c, ec, xL + lw, y, inner_right - (xL + lw) - pad, "Helvetica", FS_INFO, min_font_size=6.0)
    y -= LH_INFO

    tv = (pack.tracking or "").strip()
    c.setFont("Helvetica-Bold", FS_INFO)
    c.drawString(xL, y, "Tracking Code:")
    if tv:
        lw      = pdfmetrics.stringWidth("Tracking Code: ", "Helvetica-Bold", FS_INFO)
        avail_w = inner_right - margin - (xL + lw)
        draw_fitted_line(c, tv, xL + lw, y, avail_w, "Helvetica", FS_INFO, min_font_size=6.0)
    y -= LH_INFO

    store_row_h = 0.92 * inch
    store_top   = y
    store_bot   = store_top - store_row_h

    c.setLineWidth(1.5)
    c.line(inner_left, store_top, inner_right, store_top)
    c.line(inner_left, store_bot, inner_right, store_bot)
    c.line(W / 2, store_bot, W / 2, store_top)

    store_mid = (store_top + store_bot) / 2
    c.setFont("Helvetica", FS_STORE_LABEL)
    c.drawCentredString(W / 2 + (W / 2 - margin) / 2, store_mid + 0.28 * inch, "STORE")
    draw_fitted_line(c, pack.store or "", W / 2 + (W / 2 - margin) / 2, store_mid - 0.22 * inch, right_w, "Helvetica-Bold", FS_STORE, min_font_size=12.0, align="center")

    sscc18    = normalize_sscc(pack.sscc)
    gs1_value = "\xf1" + "00" + sscc18
    bar_h     = 1.10 * inch
    sscc_bar  = code128.Code128(gs1_value, barHeight=bar_h, barWidth=0.0195 * inch)
    bc_y      = margin + 0.5 * inch
    bc_x      = (W - sscc_bar.width) / 2.0

    draw_fitted_line(c, f"(00) {format_sscc_groups(sscc18)}", W / 2, bc_y + bar_h + 0.10 * inch, W - 2 * margin - 10, "Helvetica-Bold", FS_BAR_HR, min_font_size=7.0, align="center")
    sscc_bar.drawOn(c, bc_x, bc_y)

    c.showPage()
    c.save()
    return buf.getvalue()


def render_packing_list_pages(pack: Pack, order_index: int, total_orders: int) -> bytes:
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    margin   = 0.12 * inch
    pad      = 0.10 * inch
    usable_w = W - 2 * margin
    right    = W - margin

    w_vendor = 0.70 * inch
    w_sku    = 0.49 * inch
    w_desc   = 1.22 * inch
    w_qo     = 0.32 * inch
    w_qf     = 0.30 * inch
    w_cases  = 0.30 * inch
    w_ppc    = usable_w - (w_vendor + w_sku + w_desc + w_qo + w_qf + w_cases)

    x_vendor = margin
    x_sku    = x_vendor + w_vendor
    x_desc   = x_sku + w_sku
    x_qo     = x_desc + w_desc
    x_qf     = x_qo + w_qo
    x_cases  = x_qf + w_qf
    x_ppc    = x_cases + w_cases

    font      = 6.5
    font_desc = 7.5
    line_h    = font + 3

    items   = sorted(pack.items, key=lambda it: (it.michaels_sku or ""))
    idx     = 0
    page_no = 1

    def estimate_total_pages() -> int:
        total = 1
        y = H - margin - 1.70 * inch
        for it in items:
            desc_lines = hard_wrap(it.description, "Helvetica", font_desc, w_desc - 4)
            vend_lines = hard_wrap(it.vendor_item,  "Helvetica", font,      w_vendor - 4)
            sku_lines = hard_wrap(format_michaels_item_number(it.michaels_sku), "Helvetica", font, w_sku - 4)
            row_height = max(len(vend_lines), len(sku_lines), len(desc_lines), 1) * line_h + 6
            if y - row_height < margin + 0.25 * inch:
                y = H - margin - 0.60 * inch
                total += 1
            y -= row_height
        return total

    total_pages = estimate_total_pages()

    def draw_table_header(y_top: float) -> float:
        header_h = 26
        c.setFillColorRGB(1, 1, 1)
        c.rect(margin, y_top - header_h, usable_w, header_h, fill=1, stroke=1)
        c.setFillColorRGB(0, 0, 0)
        c.setLineWidth(0.4)
        for x_div in [x_sku, x_desc, x_qo, x_qf, x_cases, x_ppc]:
            c.line(x_div, y_top - header_h, x_div, y_top)
        c.setFont("Helvetica-Bold", 5.6)
        ty = y_top - 8
        c.drawString(x_vendor + 2, ty,      "VENDOR")
        c.drawString(x_vendor + 2, ty - 7,  "ITEM")
        c.drawString(x_vendor + 2, ty - 14, "NUMBER")
        c.drawString(x_sku + 2,    ty,      "MICHAELS")
        c.drawString(x_sku + 2,    ty - 7,  "ITEM")
        c.drawString(x_sku + 2,    ty - 14, "SKU")
        c.drawString(x_desc + 2,   ty,      "ITEM")
        c.drawString(x_desc + 2,   ty - 7,  "DESCRIPTION")
        c.drawString(x_qo + 2,     ty,      "QTY")
        c.drawString(x_qo + 2,     ty - 7,  "ORD")
        c.drawString(x_qf + 2,     ty,      "QTY")
        c.drawString(x_qf + 2,     ty - 7,  "FUL")
        c.drawString(x_cases + 2,  ty,      "#")
        c.drawString(x_cases + 2,  ty - 7,  "CASE")
        c.drawString(x_ppc + 2,    ty,      "PCS/")
        c.drawString(x_ppc + 2,    ty - 7,  "CASE")
        return y_top - header_h

    while True:
        y = H - margin

        if page_no == 1:
            title_h = 16
            c.setFillColorRGB(0, 0, 0)
            c.rect(margin, y - title_h, usable_w, title_h, fill=1, stroke=0)
            c.setFillColorRGB(1, 1, 1)
            c.setFont("Helvetica-Bold", 10)
            c.drawCentredString(W / 2, y - title_h + 4, "PACKING LIST")
            c.setFillColorRGB(0, 0, 0)
            y -= title_h + 12

            sf = pack.ship_from
            st = pack.ship_to
            c.setFont("Helvetica-Bold", 6.5)
            c.drawString(margin, y, "SHIP FROM:")
            c.drawString(W / 2 + 4, y, "SHIP TO:")
            y -= 10

            left_lines  = [l for l in [sf.name, sf.line1, sf.line2,
                            f"{sf.city}, {sf.state} {sf.zip}".strip(", ")] if l.strip()]
            right_lines = [l for l in [st.name, st.line1, st.line2,
                            f"{st.city}, {st.state} {st.zip}".strip(", ")] if l.strip()]
            left_fitted, left_size = fit_text_lines(" | ".join(left_lines), "Helvetica", 6.2, W / 2 - margin - 8, 5, min_font_size=4.0)
            right_fitted, right_size = fit_text_lines(" | ".join(right_lines), "Helvetica", 6.2, W / 2 - margin - 8, 5, min_font_size=4.0)
            address_size = min(left_size, right_size)
            left_fitted = hard_wrap(" | ".join(left_lines), "Helvetica", address_size, W / 2 - margin - 8)
            right_fitted = hard_wrap(" | ".join(right_lines), "Helvetica", address_size, W / 2 - margin - 8)
            c.setFont("Helvetica", address_size)
            for i in range(max(len(left_fitted), len(right_fitted))):
                if i < len(left_fitted):
                    c.drawString(margin, y, left_fitted[i])
                if i < len(right_fitted):
                    c.drawString(W / 2 + 4, y, right_fitted[i])
                y -= 9 * (address_size / 6.2)

            y -= 4
            c.setLineWidth(0.5)
            c.line(margin, y, right, y)
            y -= 10

            draw_fitted_line(c, f"PO#: {pack.po}", margin, y, usable_w * 0.52, "Helvetica-Bold", 7, min_font_size=3.5)
            draw_fitted_line(
                c,
                f"Order {order_index} of {total_orders}",
                margin + usable_w * 0.62,
                y,
                usable_w * 0.16,
                "Helvetica-Bold",
                7,
                min_font_size=4.5,
                align="center",
            )
            draw_fitted_line(
                c,
                f"Ship Date: {pack.ship_date or '________'}",
                right,
                y,
                usable_w * 0.27,
                "Helvetica-Bold",
                7,
                min_font_size=4.5,
                align="right",
            )
            y -= 8


        else:
            draw_fitted_line(c, f"PO#: {pack.po} (cont..)", margin, y - 10, usable_w, "Helvetica-Bold", 7, min_font_size=4.5)
            y -= 20

        y = draw_table_header(y)
        bottom_limit = margin + 0.25 * inch

        while idx < len(items):
            it = items[idx]
            vend_lines = hard_wrap(it.vendor_item,  "Helvetica", font,      w_vendor - 4)
            sku_str    = format_michaels_item_number(it.michaels_sku)
            sku_lines  = hard_wrap(sku_str, "Helvetica", font, w_sku - 4)
            desc_lines = hard_wrap(it.description,  "Helvetica", font_desc, w_desc - 4)
            row_lines  = max(len(vend_lines), len(sku_lines), len(desc_lines), 1)
            row_height = row_lines * line_h + 6

            if y - row_height < bottom_limit:
                break

            c.setLineWidth(0.4)
            c.rect(x_vendor, y - row_height, usable_w, row_height)
            for x_div in [x_sku, x_desc, x_qo, x_qf, x_cases, x_ppc]:
                c.line(x_div, y - row_height, x_div, y)

            text_y = y - line_h + 1
            for li in range(row_lines):
                y_line = text_y - li * line_h
                if li < len(vend_lines):
                    c.setFont("Helvetica", font)
                    c.drawString(x_vendor + 2, y_line, vend_lines[li])
                if li < len(sku_lines):
                    c.setFont("Helvetica", font)
                    c.drawString(x_sku + 2, y_line, sku_lines[li])
                if li == 0:
                    c.setFont("Helvetica-Bold", 7.5)
                    c.drawCentredString(x_qo + w_qo / 2, y_line, str(it.qty))
                    c.setFont("Helvetica", font)
                    c.drawCentredString(x_qf    + w_qf / 2,    y_line, str(it.qty))
                    c.drawCentredString(x_cases + w_cases / 2, y_line, "1")
                    c.drawCentredString(x_ppc   + w_ppc / 2,  y_line, str(it.qty))
                if li < len(desc_lines):
                    c.setFont("Helvetica-Bold", font_desc)
                    c.drawString(x_desc + 2, y_line, desc_lines[li])

            y -= row_height
            idx += 1

        if total_pages > 1:
            c.setFont("Helvetica", 6)
            c.drawCentredString(W / 2, margin, f"Page {page_no} of {total_pages}")

        c.showPage()
        page_no += 1
        if idx >= len(items):
            break

    c.save()
    return buf.getvalue()


def render_no_xml_match_page(pd: PageOcrData) -> bytes:
    """Placeholder GS1/packing page when OCR found identifiers but no XML pack matched."""
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    margin = 0.20 * inch
    c.setLineWidth(1.5)
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.rect(margin, margin, W - 2 * margin, H - 2 * margin)

    c.setFillColorRGB(0.2, 0.2, 0.2)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, H / 2 + 0.55 * inch, "WARNING - NO XML MATCH FOUND")

    c.setFont("Helvetica", 9)
    if pd.tracking:
        c.drawCentredString(W / 2, H / 2 + 0.15 * inch, f"Tracking: {pd.tracking}")
    if pd.po:
        c.drawCentredString(W / 2, H / 2 - 0.10 * inch, f"PO: {pd.po}")
    if pd.store:
        c.drawCentredString(W / 2, H / 2 - 0.30 * inch, f"Store: {pd.store}")

    c.setFont("Helvetica", 7.5)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawCentredString(W / 2, margin + 0.15 * inch,
                        "Check XML - no pack matched this shipping label")
    c.showPage()
    c.save()
    return buf.getvalue()


# ===========================================================================
# Core rendering — shipping-label-first
# ===========================================================================

def _bytes_to_fitz(data: bytes) -> fitz.Document:
    """Open PDF bytes as a fitz Document."""
    return fitz.open(stream=data, filetype="pdf")


__all__ = [
    "_bytes_to_fitz",
    "format_michaels_item_number",
    "format_sscc_groups",
    "hard_wrap",
    "normalize_sscc",
    "render_gs1_label_page",
    "render_no_xml_match_page",
    "render_packing_list_pages",
    "wrap_text",
]
