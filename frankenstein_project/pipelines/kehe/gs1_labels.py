"""KeHE GS1-128 label generation.

Implementations live here; shared models and low-level drawing helpers remain in
``common`` for compatibility and to prevent circular imports.
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path
from typing import Any, Dict, List, Optional

import pymupdf as fitz
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from .common import (
    Pack,
    _draw_code128_centered,
    _draw_label,
    _draw_value_lines,
    _file_hash,
    _format_label_date_mmddyyyy,
    _pack_content_summary,
    _status_log,
    _zip_for_ai420,
    fit_text_lines,
    format_sscc_groups,
    normalize_sscc,
    parse_asn,
)

def render_gs1_label_page(pack: Pack, order_index: int, total_orders: int) -> bytes:
    """Render one 4 x 6 KeHE SSCC-18 / GS1-128 label page."""
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    gx0 = 0.10 * inch
    gx1 = W - 0.10 * inch
    gy0 = 0.10 * inch
    gy1 = H - 0.14 * inch
    mid = (gx0 + gx1) / 2

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)

    # Rebalanced zones:
    # A/B, C/D, E/F, and G/H get more room.
    # Zone I is reduced because it previously consumed too much vertical space.
    y_top = gy1
    y_ab = y_top - 1.05 * inch
    y_cd = y_ab - 1.15 * inch
    y_ef = y_cd - 1.25 * inch
    y_gh = y_ef - 0.95 * inch

    c.setLineWidth(0.8)
    c.rect(gx0, gy0, gx1 - gx0, gy1 - gy0)
    for row_y in [y_ab, y_cd, y_ef, y_gh]:
        c.line(gx0, row_y, gx1, row_y)
    c.line(mid, y_cd, mid, y_top)

    pad = 0.07 * inch
    left_x = gx0 + pad
    right_x = mid + pad
    left_w = mid - gx0 - 2 * pad
    right_w = gx1 - mid - 2 * pad

    package_type = (pack.package_type or "CTN").strip().upper()
    is_pallet = package_type.startswith("PLT")
    package_singular = "Pallet" if is_pallet else "Carton"
    package_plural = "Pallets" if is_pallet else "Cartons"

    def draw_pair(
        label: str,
        value: str,
        x: float,
        y: float,
        max_width: float,
        *,
        label_size: float = 10.2,
        value_size: float = 10.0,
        label_width: float = 0.76 * inch,
        max_lines: int = 1,
    ) -> float:
        if not value:
            return 0.19 * inch
        _draw_label(c, x, y, label, label_size)
        lines, fitted_size = fit_text_lines(
            value,
            "Helvetica",
            value_size,
            max_width - label_width,
            max_lines,
            min_font_size=2.5,
        )
        c.setFont("Helvetica", fitted_size)
        value_y = y
        for line in lines:
            c.drawString(x + label_width, value_y, line)
            value_y -= fitted_size * 1.05
        return max(0.19 * inch, len(lines) * fitted_size * 1.05 + 1.5)

    # Zone A: Ship From.
    sf = pack.ship_from
    y = y_top - 0.15 * inch
    _draw_label(c, left_x, y, "Ship From:", 9.5)
    y -= 0.16 * inch
    _draw_value_lines(
        c,
        [sf.name, sf.line1, sf.line2, f"{sf.city}, {sf.state} {sf.zip}".strip(", "), sf.country],
        left_x,
        y,
        left_w,
        size=9.0,
        leading=9.7,
        max_lines=5,
    )

    # Zone B: Ship To.
    st = pack.ship_to
    ship_to_name = st.name
    location_code = (pack.store or "").strip()
    if location_code and location_code.isdigit() and len(location_code) <= 2:
        dc_prefix = f"DC {int(location_code):02d}"
        if not ship_to_name.upper().startswith(dc_prefix):
            ship_to_name = f"{dc_prefix} - {ship_to_name}".strip(" -")
    elif location_code and location_code not in ship_to_name:
        ship_to_name = f"{ship_to_name} #{location_code}".strip()

    y = y_top - 0.15 * inch
    _draw_label(c, right_x, y, "Ship To:", 12.0)
    y -= 0.17 * inch
    _draw_value_lines(
        c,
        [ship_to_name, st.line1, st.line2, f"{st.city}, {st.state} {st.zip}".strip(", "), st.country],
        right_x,
        y,
        right_w,
        size=12.0,
        leading=11.7,
        max_lines=5,
    )

    # Zone C: Ship-to postal code barcode.
    zip_ai = _zip_for_ai420(st.zip)
    y = y_ab - 0.17 * inch
    c.setFont("Helvetica-Bold", 10.0)
    c.drawString(left_x, y, "(420) Ship To Postal Code")

    if zip_ai:
        _draw_code128_centered(
            c,
            "\xf1" + "420" + zip_ai,
            gx0 + 0.06 * inch,
            mid - 0.06 * inch,
            y_cd + 0.26 * inch,
            0.62 * inch,
            mid - gx0 - 0.12 * inch,
            bar_width=0.0155 * inch,
        )
        c.setFont("Helvetica", 9.0)
        c.drawCentredString((gx0 + mid) / 2, y_cd + 0.12 * inch, f"(420) {zip_ai}")

    # Zone D: Carrier / BOL / PRO / carton-or-pallet count.
    y = y_ab - 0.17 * inch
    carrier = pack.carrier_name or pack.scac

    y -= draw_pair("Carrier:", carrier, right_x, y, right_w, label_width=0.72 * inch, max_lines=2)

    y -= draw_pair("B/L:", pack.bol, right_x, y, right_w, label_width=0.42 * inch)

    y -= draw_pair("Pro:", pack.pro, right_x, y, right_w, value_size=9.8, label_width=0.42 * inch)

    count_label_y = y_cd + 0.38 * inch
    _draw_label(c, right_x, count_label_y, f"Number of {package_plural}:", 10.3)

    c.setFont("Helvetica-Bold", 10.4)
    c.drawString(right_x, y_cd + 0.18 * inch, f"{package_singular} {pack.carton_index} Of {pack.total_cartons}")

    # Zones E/F: Customer / retailer content.
    # Contents is first. Blank headings are skipped.
    summary = _pack_content_summary(pack)
    y = y_cd - 0.18 * inch
    content_label_w = 1.00 * inch
    value_w = gx1 - (left_x + content_label_w) - pad

    content_rows = [
        ("Contents:", summary["contents"]),
        ("PO #:", pack.po),
        ("Item #:", summary["item"]),
        ("Item Desc:", summary["desc"]),
        (f"{package_singular} Qty:", summary["qty"]),
    ]

    for label, value in content_rows:
        if not value:
            continue

        _draw_label(c, left_x, y, label, 10.2)
        lines, fitted_size = fit_text_lines(value, "Helvetica", 9.8, value_w, 2, min_font_size=2.5)
        c.setFont("Helvetica", fitted_size)
        value_y = y
        for line in lines:
            c.drawString(left_x + content_label_w, value_y, line)
            value_y -= fitted_size * 1.05

        y -= max(0.20 * inch, len(lines) * fitted_size * 1.05 + 6.0)

    # Zones G/H: Lot and traceability information.
    y = y_ef - 0.18 * inch
    trace_label_w = 1.55 * inch

    trace_rows = [
        ("Lot #:", summary["lot"]),
        ("Expiration Date:", _format_label_date_mmddyyyy(summary["expiration"])),
        ("Manufacturing Date:", _format_label_date_mmddyyyy(summary["manufacture"])),
        ("Manufacturing Plant #:", summary["plant"]),
    ]

    for label, value in trace_rows:
        _draw_label(c, left_x, y, label, 10.0)
        if value:
            trace_width = gx1 - (left_x + trace_label_w) - pad
            lines, fitted_size = fit_text_lines(value, "Helvetica", 9.6, trace_width, 2, min_font_size=2.5)
            c.setFont("Helvetica", fitted_size)
            value_y = y
            for line in lines:
                c.drawString(left_x + trace_label_w, value_y, line)
                value_y -= fitted_size * 1.05

        y -= max(0.17 * inch, len(lines) * fitted_size * 1.05 + 1.0) if value else 0.17 * inch

    # Zone I: SSCC barcode and human-readable text.
    # Reduced vertical height, but barcode is still kept wide.
    sscc18 = normalize_sscc(pack.sscc)
    c.setFont("Helvetica-Bold", 9.0)
    c.drawCentredString(W / 2, y_gh - 0.18 * inch, "Serialized Shipping Container Number")

    if sscc18:
        _draw_code128_centered(
            c,
            "\xf1" + "00" + sscc18,
            gx0 + 0.05 * inch,
            gx1 - 0.05 * inch,
            gy0 + 0.38 * inch,
            0.72 * inch,
            gx1 - gx0 - 0.10 * inch,
            bar_width=0.0165 * inch,
        )
        c.setFont("Helvetica", 8.8)
        c.drawCentredString(W / 2, gy0 + 0.17 * inch, f"(00) {format_sscc_groups(sscc18)}")

    c.showPage()
    c.save()
    return buf.getvalue()


def _bytes_to_fitz(data: bytes) -> fitz.Document:
    return fitz.open(stream=data, filetype="pdf")


def _build_generation_report(rows: List[Dict[str, Any]], xml_files: int) -> Dict[str, Any]:
    return {
        "summary": {
            "success": True,
            "xml_files": xml_files,
            "generated_labels": len(rows),
        },
        "rows": rows,
    }


def run_pipeline(
    xml_paths: List[str],
    out_pdf: str,
    shipping_pdf_path: Optional[str] = None,
    ocr_dpi: int = 200,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    if shipping_pdf_path:
        _status_log("Shipping PDF input was supplied but is ignored by the KeHE XML-only workflow.")
    _ = ocr_dpi

    all_packs: List[Pack] = []
    seen_file_hashes: set[str] = set()
    duplicate_files: List[str] = []
    for xp in xml_paths:
        fhash = _file_hash(xp) if Path(xp).exists() else xp
        if fhash in seen_file_hashes:
            duplicate_files.append(Path(xp).name)
            continue
        seen_file_hashes.add(fhash)
        _status_log(f"Parsing XML: {xp}")
        _orders, packs = parse_asn(xp)
        all_packs.extend(packs)

    if not all_packs:
        raise ValueError("No packs with SSCC values were found in the uploaded XML.")

    total = len(all_packs)

    _status_log(f"Rendering {total} KeHE GS1 label(s): {out_pdf}")
    out_doc = fitz.open()
    rows: List[Dict[str, Any]] = []

    for i, pack in enumerate(all_packs, start=1):
        if progress_callback:
            progress_callback(f"Rendering KeHE label {i} of {total}...")
        page_bytes = render_gs1_label_page(pack, order_index=i, total_orders=total)
        page_doc = _bytes_to_fitz(page_bytes)
        out_doc.insert_pdf(page_doc, from_page=0, to_page=0)
        page_doc.close()
        rows.append({
            "label": i,
            "po": pack.po,
            "store": pack.store,
            "ship_to": pack.ship_to.name,
            "ship_to_zip": pack.ship_to.zip,
            "sscc": normalize_sscc(pack.sscc),
            "package_type": pack.package_type or "CTN",
            "package": f"{'Pallet' if (pack.package_type or '').upper().startswith('PLT') else 'Carton'} {pack.carton_index} of {pack.total_cartons}",
            "carton": f"{pack.carton_index} of {pack.total_cartons}",
        })

    out_doc.save(out_pdf, garbage=4, deflate=True)
    out_doc.close()
    _status_log(f"Done -> {out_pdf}")
    return _build_generation_report(rows, xml_files=len(xml_paths))


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Generate KeHE GS1-128 labels from ASN XML")
    parser.add_argument("--xml", nargs="+", required=True, help="ASN XML file(s)")
    parser.add_argument("--out", required=True, help="Output PDF path")
    args = parser.parse_args(argv)
    run_pipeline(xml_paths=args.xml, out_pdf=args.out)


__all__ = [
    "render_gs1_label_page",
    "run_pipeline",
    "main",
]
