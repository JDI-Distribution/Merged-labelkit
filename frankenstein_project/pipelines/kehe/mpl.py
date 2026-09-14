"""KeHE Master Packing List draft and PDF rendering.

Implementations live here; shared models and low-level drawing helpers remain in
``common`` for compatibility and to prevent circular imports.
"""

from __future__ import annotations

import io
from typing import Any, Callable, Dict, List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from .common import (
    _COLOR_LABEL,
    _MPL_INNER_BOTTOM,
    _MPL_INNER_W,
    _MPL_MARGIN,
    _MPL_PAGE_H,
    _aggregate_mpl_items_for_editor,
    _billing_str,
    _dc_ship_from_str,
    _mpl_clean,
    _normalize_product_master_rows,
    _pallet_ids_for_total,
    _safe_positive_int,
    _ship_to_str,
    apply_product_master_to_mpl_draft,
    build_document_shipments,
    fit_text_lines,
)

from .tihi import _render_mpl_tihi_pages


def _validate_mpl_each_item_numbers(draft: Dict[str, Any]) -> List[str]:
    """Return MPL rows that still have no visible Item Number.

    Missing Product Master data is advisory for MPL rendering. The enrichment
    pass marks affected lists as Needs Review and preserves the order SKU as a
    visible fallback. TI-HI still ignores rows without the required Case
    measurements, and no TI-HI page is added when no valid layout entries remain.
    """
    missing: List[str] = []
    for mpl in draft.get("packing_lists") or []:
        for item in mpl.get("items") or []:
            has_identity = any(
                _mpl_clean(item.get(key))
                for key in ("sku", "gtin", "case_upc", "upc", "description")
            )
            if not has_identity or _mpl_clean(item.get("item_number")):
                continue
            identity = (
                _mpl_clean(item.get("sku"))
                or _mpl_clean(item.get("gtin"))
                or _mpl_clean(item.get("case_upc"))
                or _mpl_clean(item.get("upc"))
                or f"Line {_mpl_clean(item.get('line')) or '?'}"
            )
            if identity not in missing:
                missing.append(identity)
    return missing


def build_kehe_master_packing_list_draft(xml_paths: List[str], product_master_rows: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Parse XML files and return an editable master packing list draft."""
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

    packing_lists = []
    needs_review_count = 0

    for idx, ship in enumerate(shipments, start=1):
        header = ship["header"]
        dc_info = ship["dc_info"]
        packs = ship["packs"]
        needs_review = ship["needs_review"]

        if needs_review:
            needs_review_count += 1

        total_pallets = header.get("total_pallets") or header.get("xml_total_pallets") or "1"
        preserve_pack_pallets = bool(header.get("xml_total_pallets") or header.get("has_tare_pallets"))
        if not preserve_pack_pallets:
            total_pallets = "1"
        pallet_ids = _pallet_ids_for_total(total_pallets) if preserve_pack_pallets else ["1"]

        mpl_warnings: List[str] = list(header.get("warnings", []))
        palletization_source = "XML"
        palletization_note = "Using palletization from XML." if preserve_pack_pallets else (
            "XML did not include item-to-pallet assignment, so all line items were placed on Pallet 1 by default."
        )

        ship_from = _dc_ship_from_str(dc_info, header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)

        # Correct XML with HL03=T or TD101=PLT means each physical SSCC is a pallet.
        # Preserve that parent/child XML relationship. Do not round-robin distribute
        # aggregated item rows across pallets.
        if preserve_pack_pallets and len(packs) != _safe_positive_int(total_pallets, 1):
            mpl_warnings.append(
                f"XML says Total Pallets={total_pallets}, but {len(packs)} physical SSCC pallet records were found. Verify pallet grouping."
            )
        items = _aggregate_mpl_items_for_editor(
            packs,
            mpl_warnings,
            total_pallets=total_pallets,
            preserve_pack_pallets=preserve_pack_pallets,
            default_pallet="1",
        )
        if not items:
            raise ValueError(
                f"No item rows found in {header['source_file']}. "
                "Cannot generate Master Packing List."
            )

        packing_lists.append({
            "id": f"MPL-{idx}",
            "status": "Needs Review" if needs_review else "Ready",
            "dc": dc_info["dc"] if dc_info else "Unknown",
            "title": "MASTER PACKING LIST",
            "template_id": "kehe",
            "customer_po_number": header.get("customer_po_number", ""),
            "customer_no": header.get("customer_po_number", ""),
            "pro_number": header.get("pro_number", ""),
            "bol_number": header.get("bol_number", ""),
            "order_no": header.get("order_no", ""),
            "po_date": header.get("po_date", ""),
            "page_no": "1",
            "total_weight": header.get("total_weight", ""),
            "carton_count": header.get("carton_count") or header.get("pack_count", ""),
            "pack_count": header.get("pack_count", ""),
            "td1_package_code": header.get("td1_package_code", ""),
            "ship_via": header.get("carrier", ""),
            "total_pallets": str(_safe_positive_int(total_pallets, 1)),
            "xml_total_pallets": header.get("xml_total_pallets", ""),
            "palletization_source": palletization_source,
            "palletization_note": palletization_note,
            "_pallet_ids": pallet_ids,
            "_pallet_weights": {},
            "supplier_info": ship_from,
            "bill_to": billing,
            "ship_to": ship_to,
            "est_ship_date": header.get("ship_date", ""),
            "expected_delivery_date": header.get("expected_delivery_date", ""),
            "shipping_instructions": "",
            "source_files": [header["source_file"]],
            "warnings": mpl_warnings,
            "items": items,
        })

    draft = {
        "document_type": "kehe_master_packing_list",
        "version": 4,
        "template_id": "kehe",
        "summary": {
            "xml_files": len(xml_paths),
            "packing_lists": len(packing_lists),
            "needs_review": needs_review_count,
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": global_warnings,
        "product_master": _normalize_product_master_rows(product_master_rows or []),
        "packing_lists": packing_lists,
    }
    if product_master_rows:
        apply_product_master_to_mpl_draft(draft, force=True)
    return draft


from .mpl_renderer import (
    _MPL_BRAND_LOGO_PATHS,
    _MPL_BRAND_THEMES,
    _draw_centered_wrapped,
    _draw_info_cell,
    _draw_mpl_brand_logo,
    _draw_wrapped_left,
    _mpl_brand_id,
    _mpl_build_units,
    _mpl_col_widths,
    _mpl_date_mmddyyyy,
    _mpl_date_short,
    _mpl_exp_short,
    _mpl_group_items,
    _mpl_item_height,
    _mpl_item_number_display,
    _mpl_paginate_units,
    _mpl_prepare_items,
    _mpl_template_id,
    _mpl_template_theme,
    _mpl_units_on_pallet,
    _mpl_weight_label,
    _render_decopac_mpl_pages,
    _render_mpl_header,
    _render_mpl_item_row,
    _render_mpl_pallet_group_row,
    _render_mpl_table_header,

)

def render_kehe_master_packing_list_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render Master Packing List pages from an edited draft."""
    apply_product_master_to_mpl_draft(draft, force=False)
    _validate_mpl_each_item_numbers(draft)
    packing_lists = draft.get("packing_lists") or []
    if not packing_lists:
        raise ValueError("Draft contains no packing lists to render.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)

    total_pages_all = 0
    total_items_all = 0
    rows = []
    needs_review_count = 0

    for mpl in packing_lists:
        status = mpl.get("status", "Ready")
        if not _mpl_clean(mpl.get("ship_to")) or not _mpl_clean(mpl.get("customer_po_number")):
            status = "Needs Review"
            mpl["status"] = status
        if status == "Needs Review":
            needs_review_count += 1

        template_id = _mpl_template_id(draft, mpl)
        brand_id = _mpl_brand_id(draft, mpl)
        theme = _mpl_template_theme(template_id, brand_id)
        items = _mpl_prepare_items(mpl)
        total_items_all += len(items)

        if progress_callback:
            progress_callback(
                f"Rendering {mpl.get('id', 'MPL')} "
                f"({len(items)} item{'s' if len(items) != 1 else ''})..."
            )

        if template_id == "decopac":
            total_pages_all += _render_decopac_mpl_pages(
                c, mpl, items, brand_id, progress_callback, customer_heading="DECOPAC"
            )
        elif template_id == "dutch_bros":
            total_pages_all += _render_decopac_mpl_pages(
                c, mpl, items, brand_id, progress_callback, customer_heading="DUTCH BROS"
            )
        elif template_id == "fancy":
            total_pages_all += _render_decopac_mpl_pages(
                c, mpl, items, brand_id, progress_callback, customer_heading="FANCY SPRINKLES"
            )
        else:
            units = _mpl_build_units(items, template_id)
            available_h = (6.0 if template_id == "standard" else 6.85) * inch
            pages_units = _mpl_paginate_units(units, available_h=available_h)
            total_mpl_pages = len(pages_units)

            for page_idx, page_units in enumerate(pages_units, start=1):
                if progress_callback:
                    progress_callback(
                        f"Rendering {mpl.get('id', 'MPL')} page {page_idx}/{total_mpl_pages}..."
                    )

                c.setPageSize(A4)
                mpl_page = dict(mpl)
                y = _render_mpl_header(c, mpl_page, page_idx, total_mpl_pages, template_id, brand_id)
                y = _render_mpl_table_header(c, y, template_id, brand_id)

                alt = 0
                for kind, payload, height in page_units:
                    if y - height < _MPL_INNER_BOTTOM + 0.15 * inch:
                        break
                    if kind == "group":
                        y = _render_mpl_pallet_group_row(
                            c,
                            y,
                            height,
                            payload.get("pallet", "1"),
                            payload.get("pallet_weight", ""),
                            template_id,
                            brand_id,
                        )
                    else:
                        bg = (1, 1, 1) if alt % 2 == 0 else theme["row_alt"]
                        y = _render_mpl_item_row(c, payload, y, height, bg, template_id)
                        alt += 1

                c.setStrokeColorRGB(0.2, 0.2, 0.2)
                c.setLineWidth(0.8)
                c.rect(_MPL_MARGIN, _MPL_INNER_BOTTOM, _MPL_INNER_W, _MPL_PAGE_H - 2 * _MPL_MARGIN)

                if page_idx == 1 and mpl.get("warnings"):
                    warning_text = "; ".join(
                        w for w in mpl["warnings"]
                        if "defaulted to 1" not in w.lower()
                        and "pallet count" not in w.lower()
                    )
                    if warning_text:
                        warn_y = _MPL_INNER_BOTTOM + 0.07 * inch
                        c.setFillColorRGB(*_COLOR_LABEL)
                        warning_lines, warning_size = fit_text_lines(
                            warning_text,
                            "Helvetica-Oblique",
                            5.5,
                            _MPL_INNER_W - 0.10 * inch,
                            2,
                            min_font_size=3.5,
                        )
                        c.setFont("Helvetica-Oblique", warning_size)
                        for wline in warning_lines:
                            c.drawString(_MPL_MARGIN + 0.05 * inch, warn_y, wline)
                            warn_y += 6.5 * (warning_size / 5.5)
                        c.setFillColorRGB(0, 0, 0)

                c.showPage()
                total_pages_all += 1

        c.setPageSize(A4)
        total_pages_all += _render_mpl_tihi_pages(
            c,
            mpl,
            items,
            progress_callback=progress_callback,
        )

        ship_to_lines = (_mpl_clean(mpl.get("ship_to"))).split("\n")
        ship_to_display = ship_to_lines[0] if ship_to_lines else "-"
        rows.append({
            "document": "Master Packing List",
            "status": status,
            "dc": mpl.get("dc", ""),
            "po": mpl.get("customer_po_number", ""),
            "items": len(items),
            "total_weight": mpl.get("total_weight", ""),
            "ship_to": ship_to_display,
            "note": f"Generated with {_mpl_template_theme(template_id, brand_id)['title']} template",
        })

    c.save()
    buf.seek(0)
    with open(out_pdf, "wb") as f:
        f.write(buf.read())

    return {
        "summary": {
            "success": True,
            "packing_lists": len(packing_lists),
            "pages": total_pages_all,
            "items": total_items_all,
            "needs_review": needs_review_count,
        },
        "rows": rows,
    }


__all__ = [
    "build_kehe_master_packing_list_draft",
    "render_kehe_master_packing_list_pdf",
]
