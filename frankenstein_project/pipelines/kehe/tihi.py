"""KeHE TI-HI calculation and layout rendering.

Implementations live here; shared models and low-level drawing helpers remain in
``common`` for compatibility and to prevent circular imports.
"""

from __future__ import annotations

import base64
import io
from typing import Any, Callable, Dict, List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .common import (
    _COLOR_LABEL,
    _MPL_BLACK,
    _MPL_GRID,
    _MPL_INNER_BOTTOM,
    _MPL_INNER_TOP,
    _MPL_INNER_W,
    _MPL_MARGIN,
    _draw_fitted_line,
    _draw_mpl_cell,
    _draw_warning_box,
    _mpl_clean,
)


from .tihi_layout import (
    _mpl_tihi_constraints,
    _mpl_tihi_case_qty,
    _mpl_tihi_item_label,
    _mpl_tihi_color,
    _mpl_tihi_color_key,
    _mpl_best_tihi_orientation,
    _mpl_round_product_weight_for_pallet,
    _mpl_tihi_placement_options,
    _mpl_score_gt,
    _mpl_tihi_layer_capacity,
    _mpl_rect_length,
    _mpl_rect_width,
    _mpl_tihi_intersection_area,
    _mpl_tihi_rects_overlap,
    _mpl_tihi_top_z,
    _mpl_tihi_z_overlaps,
    _mpl_tihi_support_surfaces,
    _mpl_tihi_support_levels,
    _mpl_tihi_support_ratio,
    _mpl_tihi_has_lighter_support_overlap,
    _mpl_tihi_candidate_values,
    _mpl_pick_best_layer_placement,
    _mpl_subtract_rect,
    _mpl_is_fully_covered_by_higher,
    _mpl_visible_top_placements,
    _mpl_tihi_pattern_letter,
    _mpl_tihi_layer_signature,
    _mpl_build_tihi_layer_patterns,
    _mpl_tihi_transform_layer,
    _mpl_tihi_internal_x_edges,
    _mpl_tihi_edge_overlap_score,
    _mpl_tihi_layer_variant_valid,
    _mpl_finalize_height_zone_patterns,
    _mpl_build_pallet_tihi_layout,
    _mpl_build_tihi_entries,

)

def _mpl_tihi_snapshot_payload(mpl: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw = mpl.get("_tihi_snapshot")
    if not isinstance(raw, dict):
        return None
    entries = raw.get("entries")
    warnings = raw.get("warnings")
    if not isinstance(entries, list):
        return None
    constraints = _mpl_tihi_constraints({"_tihi_constraints": raw.get("constraints") or mpl.get("_tihi_constraints") or {}})
    return {
        "entries": entries,
        "warnings": [str(warning) for warning in (warnings or [])],
        "constraints": constraints,
        "sheet_image_data_url": _mpl_clean(raw.get("sheet_image_data_url")),
    }


def _mpl_snapshot_image_reader(image_data_url: str) -> Optional[ImageReader]:
    raw = _mpl_clean(image_data_url)
    if not raw or not raw.startswith("data:image/"):
        return None
    try:
        _, encoded = raw.split(",", 1)
        return ImageReader(io.BytesIO(base64.b64decode(encoded)))
    except Exception:
        return None


def _draw_mpl_snapshot_page(
    c: canvas.Canvas,
    reader: ImageReader,
    title: str = "TI-HI LAYOUT PREVIEW",
    subtitle: str = "",
) -> bool:
    img_w, img_h = reader.getSize()
    if img_w <= 0 or img_h <= 0:
        return False
    page_w, page_h = A4
    margin = 0.36 * inch
    header_h = 0.62 * inch
    content_bottom = margin
    content_top = page_h - margin - header_h
    max_w = page_w - (2 * margin)
    max_h = content_top - content_bottom
    scale = min(max_w / img_w, max_h / img_h)
    draw_w = img_w * scale
    draw_h = img_h * scale
    draw_x = (page_w - draw_w) / 2
    # Anchor the preview directly below its heading. Vertical centering left a
    # large, inconsistent blank band above landscape-oriented snapshots.
    draw_y = content_top - draw_h

    c.setPageSize(A4)
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    c.setFillColorRGB(*_MPL_BLACK)
    c.rect(margin, page_h - margin - 0.34 * inch, max_w, 0.34 * inch, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    _draw_fitted_line(c, _mpl_clean(title).upper(), margin + 9, page_h - margin - 0.21 * inch, max_w - 18, "Helvetica-Bold", 9.2, min_font_size=5.0)
    if subtitle:
        c.setFillColorRGB(*_COLOR_LABEL)
        _draw_fitted_line(c, _mpl_clean(subtitle), margin + 2, content_top + 0.07 * inch, max_w - 4, "Helvetica", 6.2, min_font_size=4.0)

    c.setStrokeColorRGB(*_MPL_GRID)
    c.setLineWidth(0.7)
    c.rect(draw_x - 3, draw_y - 3, draw_w + 6, draw_h + 6, fill=0, stroke=1)
    c.drawImage(reader, draw_x, draw_y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask='auto')
    c.showPage()
    return True


def _mpl_draw_tihi_top_view(
    c: canvas.Canvas,
    entry: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    pad = 8
    scale = min((w - 2 * pad) / constraints["max_length_in"], (h - 2 * pad) / constraints["max_width_in"])
    pallet_w = constraints["max_length_in"] * scale
    pallet_h = constraints["max_width_in"] * scale
    px = x + (w - pallet_w) / 2
    py = y + (h - pallet_h) / 2
    _draw_mpl_cell(c, px, py, pallet_w, pallet_h, (1, 1, 1), _MPL_GRID, 0.6)

    for placement in entry.get("top_placements", []):
        rx = px + float(placement["x"]) * scale
        ry = py + pallet_h - ((float(placement["y"]) + float(placement["case_width"])) * scale)
        _draw_mpl_cell(
            c,
            rx,
            ry,
            float(placement["case_length"]) * scale,
            float(placement["case_width"]) * scale,
            placement.get("color") or (0.92, 0.72, 0.39),
            _MPL_GRID,
            0.35,
        )

    c.setFillColorRGB(*_COLOR_LABEL)
    c.setFont("Helvetica", 5.0)
    c.drawCentredString(px + pallet_w / 2, py - 7, f"{int(round(constraints['max_length_in']))} in")
    c.saveState()
    c.translate(px - 8, py + pallet_h / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, f"{int(round(constraints['max_width_in']))} in")
    c.restoreState()
    c.setFillColorRGB(0, 0, 0)


def _mpl_draw_tihi_side_view(
    c: canvas.Canvas,
    entry: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    pad = 8
    scale = min((w - 2 * pad) / constraints["max_length_in"], (h - 2 * pad) / constraints["max_height_in"])
    pallet_w = constraints["max_length_in"] * scale
    stack_h = min(constraints["max_height_in"], float(entry.get("used_height") or 0.0)) * scale
    px = x + (w - pallet_w) / 2
    py = y + 8

    pallet_base_h = 8
    c.setFillColorRGB(0.68, 0.62, 0.47)
    c.setStrokeColorRGB(*_MPL_GRID)
    c.setLineWidth(0.5)
    c.rect(px, py, pallet_w, pallet_base_h, fill=1, stroke=1)
    notch_w = pallet_w / 4.5
    c.setFillColorRGB(1, 1, 1)
    c.rect(px + notch_w * 0.75, py + 2.0, notch_w * 0.8, pallet_base_h - 4.0, fill=1, stroke=0)
    c.rect(px + notch_w * 2.5, py + 2.0, notch_w * 0.8, pallet_base_h - 4.0, fill=1, stroke=0)

    for placement in entry.get("placements", []):
        rx = px + float(placement["x"]) * scale
        ry = py + pallet_base_h + float(placement["z"]) * scale
        _draw_mpl_cell(
            c,
            rx,
            ry,
            float(placement["case_length"]) * scale,
            float(placement["case_height"]) * scale,
            placement.get("color") or (0.92, 0.72, 0.39),
            _MPL_GRID,
            0.35,
        )

    label_left_x = max(x + 5, px - 10)
    label_right_x = min(x + w - 5, px + pallet_w + 8)
    c.setFillColorRGB(0.86, 0.15, 0.15)
    c.setFont("Helvetica-Bold", 6.8)
    for index, row in enumerate(entry.get("layer_pattern_rows", [])):
        center_y = py + pallet_base_h + (float(row.get("z") or 0.0) + (float(row.get("height") or 0.0) / 2.0)) * scale
        label_x = label_left_x if index % 2 == 0 else label_right_x
        c.drawCentredString(label_x, center_y - 2.3, _mpl_clean(row.get("letter"))[:3])

    c.setFillColorRGB(*_COLOR_LABEL)
    c.setFont("Helvetica", 5.0)
    c.drawCentredString(px + pallet_w / 2, py - 7, f"{int(round(constraints['max_length_in']))} in")
    c.saveState()
    c.translate(px - 20, py + pallet_base_h + stack_h / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, f"{int(round(float(entry.get('used_height') or 0.0)))} in")
    c.restoreState()
    c.setFillColorRGB(0, 0, 0)


def _mpl_draw_tihi_pattern_mini(
    c: canvas.Canvas,
    pattern: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    pad = 3
    scale = min((w - 2 * pad) / constraints["max_length_in"], (h - 2 * pad) / constraints["max_width_in"])
    pallet_w = constraints["max_length_in"] * scale
    pallet_h = constraints["max_width_in"] * scale
    px = x + (w - pallet_w) / 2
    py = y + (h - pallet_h) / 2
    _draw_mpl_cell(c, px, py, pallet_w, pallet_h, (1, 1, 1), _MPL_GRID, 0.35)

    for placement in pattern.get("placements") or []:
        case_length = float(placement.get("case_length") or placement.get("length") or 0.0)
        case_width = float(placement.get("case_width") or placement.get("width") or 0.0)
        rx = px + float(placement.get("x") or 0.0) * scale
        ry = py + pallet_h - ((float(placement.get("y") or 0.0) + case_width) * scale)
        _draw_mpl_cell(
            c,
            rx,
            ry,
            case_length * scale,
            case_width * scale,
            placement.get("color") or (0.92, 0.72, 0.39),
            _MPL_GRID,
            0.25,
        )


def _render_mpl_tihi_card(
    c: canvas.Canvas,
    entry: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    top_y: float,
    w: float,
    h: float,
) -> float:
    bottom_y = top_y - h
    _draw_mpl_cell(c, x, bottom_y, w, h, (1, 1, 1), _MPL_GRID, 0.55)

    header_h = 0.21 * inch
    _draw_mpl_cell(c, x, top_y - header_h, w, header_h, _MPL_BLACK, _MPL_BLACK, 0.4)
    c.setFillColorRGB(1, 1, 1)
    title = f"Pallet {entry['pallet_label']} - Current edited layout"
    _draw_fitted_line(c, title, x + 6, top_y - header_h / 2 - 2.2, w - 12, "Helvetica-Bold", 6.9, min_font_size=4.0)
    c.setFillColorRGB(0, 0, 0)

    info_top = top_y - header_h - 7
    _draw_fitted_line(c, f"{len(entry.get('groups') or [])} item group(s) on this pallet", x + 6, info_top, w - 12, "Helvetica-Bold", 6.0, min_font_size=4.0)
    info_rows = [
        f"Assigned: {entry['assigned_cases']} case(s)   Shown: {entry['shown_cases']}   Gross pallet weight: {int(round(entry['gross_weight_lbs']))} lbs",
        f"TI x HI: {entry['ti']} x {entry['hi']}   Visible top surfaces: {entry['top_layer_cases']} case(s)   Used pallet volume: {entry['pallet_fill_pct']:.1f}%",
        f"Used stack height: {int(round(float(entry.get('used_height') or 0.0)))} in",
        f"Constraints: {int(round(constraints['max_length_in']))} x {int(round(constraints['max_width_in']))} x {int(round(constraints['max_height_in']))} in   Max gross: {int(round(constraints['max_gross_lbs']))} lbs",
    ]
    if entry.get("overflow_cases"):
        info_rows.append(f"Constraint warning: {entry['overflow_cases']} case(s) exceed the current pallet limits.")
    if entry.get("lines"):
        info_rows.append(f"MPL lines: {', '.join(entry['lines'])}")
    ty = info_top - 8
    for row in info_rows[:5]:
        _draw_fitted_line(c, row, x + 6, ty, w - 12, "Helvetica", 5.5, min_font_size=3.5)
        ty -= 6.4

    diagram_top = ty - 1
    legend_h = 0.42 * inch
    diagram_h = max(1.55 * inch, bottom_y + 10 + legend_h - diagram_top)
    gap = 8
    panel_w = (w - gap - 12) / 2
    panel_h = diagram_h
    left_x = x + 6
    right_x = left_x + panel_w + gap

    c.setFont("Helvetica-Bold", 6.0)
    c.drawCentredString(left_x + panel_w / 2, diagram_top - 7, 'TOP VIEW')
    c.drawCentredString(right_x + panel_w / 2, diagram_top - 7, 'SIDE VIEW')
    _mpl_draw_tihi_top_view(c, entry, constraints, left_x, diagram_top - panel_h, panel_w, panel_h)
    _mpl_draw_tihi_side_view(c, entry, constraints, right_x, diagram_top - panel_h, panel_w, panel_h)

    patterns = entry.get("layer_patterns") or []
    if patterns:
        pattern_y = bottom_y + 42
        c.setFont("Helvetica-Bold", 5.4)
        c.setFillColorRGB(*_COLOR_LABEL)
        c.drawString(x + 6, pattern_y + 31, "LAYER PATTERNS")
        max_patterns = min(6, len(patterns))
        pattern_gap = 5
        pattern_w = (w - 12 - ((max_patterns - 1) * pattern_gap)) / max_patterns
        for idx, pattern in enumerate(patterns[:max_patterns]):
            px = x + 6 + idx * (pattern_w + pattern_gap)
            _draw_mpl_cell(c, px, pattern_y, pattern_w, 28, (0.98, 0.99, 1.0), _MPL_GRID, 0.3)
            c.setFont("Helvetica-Bold", 6.6)
            c.setFillColorRGB(0, 0, 0)
            c.drawCentredString(px + 7, pattern_y + 15, _mpl_clean(pattern.get("letter"))[:3])
            _mpl_draw_tihi_pattern_mini(c, pattern, constraints, px + 15, pattern_y + 4, min(34, pattern_w - 18), 18)
            layers = ", ".join(str(layer) for layer in (pattern.get("layers") or []))
            _draw_fitted_line(c, f"L {layers}", px + pattern_w - 3, pattern_y + 4, pattern_w - 20, "Helvetica", 4.5, min_font_size=3.0, align="right")

    groups = entry.get("groups") or []
    c.setFont("Helvetica", 5.0)
    legend_cols = 2
    legend_w = (w - 14) / legend_cols
    legend_y = bottom_y + 8
    for idx, group in enumerate(groups[:6]):
        col = idx % legend_cols
        row = idx // legend_cols
        lx = x + 6 + (col * legend_w)
        ly = legend_y + (row * 11)
        color = group.get("color") or (0.92, 0.72, 0.39)
        c.setFillColorRGB(*color)
        c.setStrokeColorRGB(*_MPL_GRID)
        c.rect(lx, ly, 7, 7, fill=1, stroke=1)
        c.setFillColorRGB(0, 0, 0)
        legend_text = f"{_mpl_clean(group.get('label'))} | L {', '.join(group.get('lines') or [])} | {group.get('assigned_cases', 0)} cs"
        _draw_fitted_line(c, legend_text, lx + 10, ly + 1.5, legend_w - 14, "Helvetica", 5.0, min_font_size=3.0)

    return bottom_y


def _render_mpl_tihi_pages(
    c: canvas.Canvas,
    mpl: Dict[str, Any],
    items: List[Dict[str, Any]],
    progress_callback: Optional[Callable[[str], None]] = None,
) -> int:
    snapshot = _mpl_tihi_snapshot_payload(mpl)
    if snapshot is not None:
        entries = snapshot["entries"]
        warnings = snapshot["warnings"]
        constraints = snapshot["constraints"]
        sheet_reader = _mpl_snapshot_image_reader(snapshot.get("sheet_image_data_url", ""))
        if sheet_reader is not None:
            if progress_callback:
                progress_callback(f"Rendering {mpl.get('id', 'MPL')} TI-Hi layout summary image...")
            return 1 if _draw_mpl_snapshot_page(
                c,
                sheet_reader,
                "TI-HI LAYOUT SUMMARY",
                f"{mpl.get('id', 'MPL')}  |  PO {_mpl_clean(mpl.get('customer_po_number')) or '-'}",
            ) else 0
    else:
        entries, warnings = _mpl_build_tihi_entries(mpl, items)
        constraints = _mpl_tihi_constraints(mpl)

    if not entries:
        return 0

    snapshot_images = []
    for entry in entries:
        reader = _mpl_snapshot_image_reader(entry.get("image_data_url", ""))
        if reader is None:
            snapshot_images = []
            break
        snapshot_images.append((entry, reader))
    if snapshot_images:
        pages = 0
        for index, (entry, reader) in enumerate(snapshot_images, start=1):
            if progress_callback:
                progress_callback(
                    f"Rendering {mpl.get('id', 'MPL')} TI-Hi image page {index}/{len(snapshot_images)}..."
                )
            pallet_label = _mpl_clean(entry.get("pallet_label") or entry.get("pallet")) or str(index)
            if _draw_mpl_snapshot_page(
                c,
                reader,
                f"PALLET {pallet_label} TI-HI LAYOUT PREVIEW",
                f"{mpl.get('id', 'MPL')}  |  PO {_mpl_clean(mpl.get('customer_po_number')) or '-'}  |  Preview {index} of {len(snapshot_images)}",
            ):
                pages += 1
        return pages

    pages = 0
    entry_index = 0
    first_page = True

    while first_page or entry_index < len(entries):
        if progress_callback:
            progress_callback(
                f"Rendering {mpl.get('id', 'MPL')} TI-Hi page {pages + 1}..."
            )

        y = _MPL_INNER_TOP
        _draw_mpl_cell(c, _MPL_MARGIN, y - 0.20 * inch, _MPL_INNER_W, 0.20 * inch, _MPL_BLACK, _MPL_BLACK, 0.5)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 8.0)
        c.drawCentredString(
            _MPL_MARGIN + _MPL_INNER_W / 2,
            y - 0.10 * inch - 2,
            f"TI-HI LAYOUT SUMMARY - {mpl.get('id', 'MPL')}",
        )
        c.setFillColorRGB(0, 0, 0)
        y -= 0.26 * inch

        c.setFont("Helvetica", 5.8)
        c.drawString(_MPL_MARGIN, y, f"PO: {_mpl_clean(mpl.get('customer_po_number')) or '-'}")
        c.drawRightString(
            _MPL_MARGIN + _MPL_INNER_W,
            y,
            f"Constraints: {constraints['max_length_in']:.0f} x {constraints['max_width_in']:.0f} x {constraints['max_height_in']:.0f} in, max {constraints['max_gross_lbs']:.0f} lbs gross",
        )
        y -= 0.11 * inch
        c.setFont("Helvetica", 5.6)
        c.drawString(_MPL_MARGIN, y, "All dimensions shown in inches.")
        y -= 0.12 * inch

        if first_page:
            warning_text = "; ".join(warnings[:6])
            if warning_text:
                y = _draw_warning_box(
                    c,
                    warning_text,
                    _MPL_MARGIN,
                    y,
                    _MPL_INNER_W,
                    font_size=5.6,
                    padding=3,
                ) - 0.08 * inch

        card_h = 4.15 * inch
        card_gap = 0.10 * inch
        while entry_index < len(entries) and y - card_h >= _MPL_INNER_BOTTOM:
            entry_constraints = entries[entry_index].get("constraints") or constraints
            _render_mpl_tihi_card(c, entries[entry_index], entry_constraints, _MPL_MARGIN, y, _MPL_INNER_W, card_h)
            y -= card_h + card_gap
            entry_index += 1

        c.showPage()
        pages += 1
        first_page = False

    return pages


__all__ = [
]
