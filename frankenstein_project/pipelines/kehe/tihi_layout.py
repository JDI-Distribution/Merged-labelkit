"""TI-HI pallet placement, support, and layer calculation algorithms."""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple

from .common import (
    _MPL_PALLET_BUFFER_FACTOR,
    _MPL_PALLET_LENGTH_IN,
    _MPL_PALLET_MAX_GROSS_LBS,
    _MPL_PALLET_MAX_HEIGHT_IN,
    _MPL_PALLET_TARE_LBS,
    _MPL_PALLET_WIDTH_IN,
    _canonical_id,
    _format_number,
    _mpl_clean,
    _mpl_pallet_label,
    _mpl_pallet_sort_key,
    _mpl_pallet_value,
    _normalize,
    _parse_float,
    _qty_value,
)

def _mpl_tihi_constraints(mpl: Optional[Dict[str, Any]] = None, pallet: str = "") -> Dict[str, float]:
    raw = (mpl or {}).get("_tihi_constraints") or {}
    pallet_key = _mpl_clean(pallet)
    pallet_constraints = (mpl or {}).get("_tihi_pallet_constraints") or {}
    if pallet_key and isinstance(pallet_constraints, dict) and isinstance(pallet_constraints.get(pallet_key), dict):
        raw = pallet_constraints.get(pallet_key) or {}
    def _positive(value: Any, fallback: float) -> float:
        parsed = _parse_float(value)
        return parsed if parsed is not None and parsed > 0 else fallback
    return {
        "max_length_in": _positive(raw.get("max_length_in"), _MPL_PALLET_LENGTH_IN),
        "max_width_in": _positive(raw.get("max_width_in"), _MPL_PALLET_WIDTH_IN),
        "max_height_in": _positive(raw.get("max_height_in"), _MPL_PALLET_MAX_HEIGHT_IN),
        "max_gross_lbs": _positive(raw.get("max_gross_lbs"), _MPL_PALLET_MAX_GROSS_LBS),
    }


def _mpl_tihi_case_qty(item: Dict[str, Any]) -> int:
    qty = _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty"))
    if qty <= 0:
        return 0
    return max(1, int(math.ceil(qty)))


def _mpl_tihi_item_label(item: Dict[str, Any]) -> str:
    return (
        _mpl_clean(item.get("sku"))
        or _mpl_clean(item.get("item_number"))
        or _mpl_clean(item.get("gtin"))
        or _mpl_clean(item.get("case_upc"))
        or _mpl_clean(item.get("description"))
        or f"Line {_mpl_clean(item.get('line')) or '?'}"
    )


def _mpl_tihi_color(index: int) -> Tuple[float, float, float]:
    palette = [
        (0.85, 0.60, 0.29),
        (0.49, 0.70, 0.98),
        (0.56, 0.82, 0.62),
        (0.96, 0.64, 0.64),
        (0.72, 0.63, 0.98),
        (0.50, 0.85, 0.82),
        (0.95, 0.81, 0.39),
        (0.94, 0.70, 0.48),
        (0.42, 0.77, 0.63),
        (0.71, 0.83, 0.44),
        (0.95, 0.55, 0.70),
        (0.53, 0.66, 0.96),
        (0.78, 0.62, 0.91),
        (0.44, 0.78, 0.91),
        (0.89, 0.71, 0.44),
        (0.62, 0.75, 0.63),
    ]
    return palette[index % len(palette)]


def _mpl_tihi_color_key(group: Dict[str, Any]) -> str:
    return (
        _canonical_id(group.get("sku") or group.get("item_number") or group.get("gtin"))
        or _normalize(group.get("description") or group.get("label") or "")
    )


def _mpl_best_tihi_orientation(dimensions: Tuple[float, float, float], constraints: Dict[str, float]) -> Optional[Dict[str, float]]:
    length, width, height = dimensions
    candidates: List[Dict[str, float]] = []
    seen: set[Tuple[float, float]] = set()
    for footprint_l, footprint_w in ((length, width), (width, length)):
        key = (footprint_l, footprint_w)
        if key in seen:
            continue
        seen.add(key)
        cols = int(constraints["max_length_in"] // footprint_l)
        rows = int(constraints["max_width_in"] // footprint_w)
        tie = cols * rows
        if tie < 1:
            continue
        fill_ratio = (
            (cols * footprint_l * rows * footprint_w)
            / (constraints["max_length_in"] * constraints["max_width_in"])
        )
        candidates.append({
            "case_length": footprint_l,
            "case_width": footprint_w,
            "case_height": height,
            "columns": cols,
            "rows": rows,
            "tie": tie,
            "fill_ratio": fill_ratio,
        })
    if not candidates:
        return None
    return max(candidates, key=lambda row: (row["tie"], row["fill_ratio"], -row["case_width"]))


def _mpl_round_product_weight_for_pallet(product_weight: float) -> float:
    return math.ceil((product_weight * _MPL_PALLET_BUFFER_FACTOR) / 10.0) * 10.0


def _mpl_tihi_placement_options(dimensions: Tuple[float, float, float]) -> List[Dict[str, Any]]:
    length, width, height = dimensions
    options: List[Dict[str, Any]] = []
    for case_length, case_width, rotated in ((length, width, False), (width, length, True)):
        if any(
            math.isclose(case_length, existing["case_length"], rel_tol=1e-9, abs_tol=1e-9)
            and math.isclose(case_width, existing["case_width"], rel_tol=1e-9, abs_tol=1e-9)
            for existing in options
        ):
            continue
        option = {
            "case_length": case_length,
            "case_width": case_width,
            "case_height": height,
            "rotated": rotated,
        }
        options.append(option)
    return options


def _mpl_score_gt(left: Tuple[float, ...], right: Tuple[float, ...]) -> bool:
    for index in range(max(len(left), len(right))):
        lv = left[index] if index < len(left) else 0.0
        rv = right[index] if index < len(right) else 0.0
        if lv == rv:
            continue
        return lv > rv
    return False


def _mpl_tihi_layer_capacity(group: Dict[str, Any], constraints: Dict[str, float]) -> int:
    orientation = group.get("base_orientation")
    if not orientation:
        orientation = _mpl_best_tihi_orientation(group.get("dimensions") or (0.0, 0.0, 0.0), constraints)
    try:
        return max(1, int((orientation or {}).get("tie") or 1))
    except (TypeError, ValueError):
        return 1


def _mpl_rect_length(rect: Dict[str, Any]) -> float:
    return float(rect["length"] if "length" in rect else rect.get("case_length") or 0.0)


def _mpl_rect_width(rect: Dict[str, Any]) -> float:
    return float(rect["width"] if "width" in rect else rect.get("case_width") or 0.0)


def _mpl_tihi_intersection_area(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    x1 = max(float(a.get("x") or 0.0), float(b.get("x") or 0.0))
    y1 = max(float(a.get("y") or 0.0), float(b.get("y") or 0.0))
    x2 = min(float(a.get("x") or 0.0) + _mpl_rect_length(a), float(b.get("x") or 0.0) + _mpl_rect_length(b))
    y2 = min(float(a.get("y") or 0.0) + _mpl_rect_width(a), float(b.get("y") or 0.0) + _mpl_rect_width(b))
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _mpl_tihi_rects_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return _mpl_tihi_intersection_area(a, b) > 0.001


def _mpl_tihi_top_z(placement: Dict[str, Any]) -> float:
    return float(placement.get("z") or 0.0) + float(placement.get("case_height") or placement.get("height") or 0.0)


def _mpl_tihi_z_overlaps(placement: Dict[str, Any], base_z: float, height: float) -> bool:
    bottom = float(placement.get("z") or 0.0)
    top = _mpl_tihi_top_z(placement)
    return bottom < base_z + height - 0.001 and top > base_z + 0.001


def _mpl_tihi_support_surfaces(
    placements: List[Dict[str, Any]],
    layer_base_z: float,
    constraints: Dict[str, float],
) -> List[Dict[str, float]]:
    if layer_base_z <= 0.001:
        return [{"x": 0.0, "y": 0.0, "length": constraints["max_length_in"], "width": constraints["max_width_in"]}]
    surfaces: List[Dict[str, float]] = []
    for placement in placements:
        top_z = float(placement.get("z") or 0.0) + float(placement.get("case_height") or 0.0)
        if abs(top_z - layer_base_z) <= 0.001:
            surfaces.append({
                "x": float(placement.get("x") or 0.0),
                "y": float(placement.get("y") or 0.0),
                "length": float(placement.get("case_length") or 0.0),
                "width": float(placement.get("case_width") or 0.0),
                "unit_weight": float(placement.get("unit_weight") or 0.0),
            })
    return surfaces


def _mpl_tihi_support_levels(
    placements: List[Dict[str, Any]],
    constraints: Dict[str, float],
) -> List[float]:
    levels = [0.0]
    for placement in placements:
        top_z = _mpl_tihi_top_z(placement)
        if top_z <= constraints["max_height_in"] + 0.001 and not any(abs(top_z - level) <= 0.001 for level in levels):
            levels.append(top_z)
    return sorted(levels)


def _mpl_tihi_support_ratio(
    placement: Dict[str, Any],
    support_surfaces: List[Dict[str, float]],
    min_support_weight: float = 0.0,
) -> float:
    area = _mpl_rect_length(placement) * _mpl_rect_width(placement)
    if area <= 0:
        return 0.0
    supported_area = sum(
        _mpl_tihi_intersection_area(placement, surface)
        for surface in support_surfaces
        if "unit_weight" not in surface or float(surface.get("unit_weight") or 0.0) + 0.001 >= min_support_weight
    )
    return min(1.0, supported_area / area)


def _mpl_tihi_has_lighter_support_overlap(
    placement: Dict[str, Any],
    support_surfaces: List[Dict[str, float]],
    min_support_weight: float = 0.0,
) -> bool:
    required_weight = float(min_support_weight or 0.0)
    if required_weight <= 0:
        return False
    return any(
        "unit_weight" in surface
        and float(surface.get("unit_weight") or 0.0) + 0.001 < required_weight
        and _mpl_tihi_intersection_area(placement, surface) > 0.001
        for surface in support_surfaces
    )


def _mpl_tihi_candidate_values(raw_values: List[float], max_value: float) -> List[float]:
    values: List[float] = []
    for value in raw_values:
        try:
            n = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(n):
            continue
        clamped = min(max(n, 0.0), max_value)
        if not any(abs(existing - clamped) < 0.001 for existing in values):
            values.append(clamped)
    return sorted(values)


def _mpl_pick_best_layer_placement(
    layer_placements: List[Dict[str, Any]],
    support_surfaces: List[Dict[str, float]],
    dimensions: Tuple[float, float, float],
    constraints: Dict[str, float],
    prefer_rotated: bool = False,
    min_support_weight: float = 0.0,
    blocking_placements: Optional[List[Dict[str, Any]]] = None,
    base_z: float = 0.0,
) -> Optional[Dict[str, Any]]:
    options = _mpl_tihi_placement_options(dimensions)
    best: Optional[Dict[str, Any]] = None
    blockers = blocking_placements if blocking_placements is not None else layer_placements
    for option in options:
        if option["case_length"] > constraints["max_length_in"] or option["case_width"] > constraints["max_width_in"]:
            continue
        max_x = constraints["max_length_in"] - option["case_length"]
        max_y = constraints["max_width_in"] - option["case_width"]
        x_seeds = [0.0, max_x]
        y_seeds = [0.0, max_y]
        for placed in blockers:
            x = float(placed.get("x") or 0.0)
            y = float(placed.get("y") or 0.0)
            x_seeds.extend([x, x + _mpl_rect_length(placed), x - option["case_length"]])
            y_seeds.extend([y, y + _mpl_rect_width(placed), y - option["case_width"]])
        for surface in support_surfaces:
            x = float(surface.get("x") or 0.0)
            y = float(surface.get("y") or 0.0)
            length = float(surface.get("length") or 0.0)
            width = float(surface.get("width") or 0.0)
            x_seeds.extend([x, x + length - option["case_length"], x + length, x - option["case_length"]])
            y_seeds.extend([y, y + width - option["case_width"], y + width, y - option["case_width"]])

        for x in _mpl_tihi_candidate_values(x_seeds, max_x):
            for y in _mpl_tihi_candidate_values(y_seeds, max_y):
                placement = {**option, "x": x, "y": y}
                if any(
                    _mpl_tihi_z_overlaps(existing, base_z, float(option["case_height"]))
                    and _mpl_tihi_rects_overlap(placement, existing)
                    for existing in blockers
                ):
                    continue
                if _mpl_tihi_has_lighter_support_overlap(placement, support_surfaces, min_support_weight):
                    continue
                support_ratio = _mpl_tihi_support_ratio(placement, support_surfaces, min_support_weight)
                if support_ratio < 0.8:
                    continue
                orientation_tie = math.floor(constraints["max_length_in"] / option["case_length"]) * math.floor(constraints["max_width_in"] / option["case_width"])
                score = (
                    1.0 if bool(option.get("rotated")) == prefer_rotated else 0.0,
                    float(orientation_tie),
                    support_ratio,
                    -y,
                    -x,
                )
                if best is None or _mpl_score_gt(score, best["score"]):
                    best = {"placement": placement, "score": score, "support_ratio": support_ratio}
    return best


def _mpl_subtract_rect(rect: Dict[str, float], cover: Dict[str, float]) -> List[Dict[str, float]]:
    x1 = max(rect["x"], cover["x"])
    y1 = max(rect["y"], cover["y"])
    x2 = min(rect["x"] + rect["length"], cover["x"] + cover["length"])
    y2 = min(rect["y"] + rect["width"], cover["y"] + cover["width"])
    if x2 <= x1 or y2 <= y1:
        return [rect]

    pieces: List[Dict[str, float]] = []
    if x1 > rect["x"]:
        pieces.append({"x": rect["x"], "y": rect["y"], "length": x1 - rect["x"], "width": rect["width"]})
    if x2 < rect["x"] + rect["length"]:
        pieces.append({"x": x2, "y": rect["y"], "length": rect["x"] + rect["length"] - x2, "width": rect["width"]})
    middle_length = x2 - x1
    if y1 > rect["y"]:
        pieces.append({"x": x1, "y": rect["y"], "length": middle_length, "width": y1 - rect["y"]})
    if y2 < rect["y"] + rect["width"]:
        pieces.append({"x": x1, "y": y2, "length": middle_length, "width": rect["y"] + rect["width"] - y2})
    return [piece for piece in pieces if piece["length"] > 0.001 and piece["width"] > 0.001]


def _mpl_is_fully_covered_by_higher(
    placement: Dict[str, Any],
    higher_placements: List[Dict[str, Any]],
) -> bool:
    uncovered = [{
        "x": float(placement.get("x") or 0.0),
        "y": float(placement.get("y") or 0.0),
        "length": float(placement.get("case_length") or 0.0),
        "width": float(placement.get("case_width") or 0.0),
    }]
    for higher in higher_placements:
        cover = {
            "x": float(higher.get("x") or 0.0),
            "y": float(higher.get("y") or 0.0),
            "length": float(higher.get("case_length") or 0.0),
            "width": float(higher.get("case_width") or 0.0),
        }
        next_uncovered: List[Dict[str, float]] = []
        for piece in uncovered:
            next_uncovered.extend(_mpl_subtract_rect(piece, cover))
        uncovered = next_uncovered
        if not uncovered:
            return True
    uncovered_area = sum(piece["length"] * piece["width"] for piece in uncovered)
    return uncovered_area <= 0.001


def _mpl_visible_top_placements(placements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    visible: List[Dict[str, Any]] = []
    for placement in placements:
        top_z = float(placement.get("z") or 0.0) + float(placement.get("case_height") or 0.0)
        higher = [
            other for other in placements
            if float(other.get("z") or 0.0) + float(other.get("case_height") or 0.0) > top_z + 0.001
        ]
        if not _mpl_is_fully_covered_by_higher(placement, higher):
            visible.append(placement)
    return sorted(
        visible,
        key=lambda row: (
            float(row.get("z") or 0.0) + float(row.get("case_height") or 0.0),
            int(row.get("layer_index") or 0),
        ),
    )


def _mpl_tihi_pattern_letter(index: int) -> str:
    n = max(0, int(index))
    label = ""
    while True:
        label = chr(65 + (n % 26)) + label
        n = (n // 26) - 1
        if n < 0:
            return label


def _mpl_tihi_layer_signature(layer_placements: List[Dict[str, Any]]) -> str:
    def q(value: Any) -> str:
        return f"{float(value or 0.0):.3f}"

    parts: List[str] = []
    for placement in sorted(
        layer_placements,
        key=lambda p: (
            float(p.get("y") or 0.0),
            float(p.get("x") or 0.0),
            _mpl_clean(p.get("label")),
        ),
    ):
        color = placement.get("color") or ()
        color_key = ",".join(q(v) for v in color) if isinstance(color, (list, tuple)) else str(color)
        parts.append(":".join([
            q(placement.get("x")),
            q(placement.get("y")),
            q(placement.get("case_length")),
            q(placement.get("case_width")),
            q(placement.get("case_height")),
            "R" if placement.get("rotated") else "N",
            _mpl_clean(placement.get("label")),
            color_key,
        ]))
    return "|".join(parts)


def _mpl_build_tihi_layer_patterns(placements: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    layer_buckets: Dict[int, List[Dict[str, Any]]] = {}
    for placement in placements:
        layer_buckets.setdefault(int(placement.get("layer_index") or 0), []).append(placement)

    signature_map: Dict[str, int] = {}
    patterns: List[Dict[str, Any]] = []
    rows: List[Dict[str, Any]] = []
    for layer_index in sorted(layer_buckets.keys()):
        layer = sorted(
            layer_buckets[layer_index],
            key=lambda p: (float(p.get("y") or 0.0), float(p.get("x") or 0.0)),
        )
        signature = _mpl_tihi_layer_signature(layer)
        pattern_index = signature_map.get(signature)
        if pattern_index is None:
            pattern_index = len(patterns)
            signature_map[signature] = pattern_index
            patterns.append({
                "letter": _mpl_tihi_pattern_letter(pattern_index),
                "signature": signature,
                "layers": [],
                "placements": [dict(p) for p in layer],
            })
        pattern = patterns[pattern_index]
        pattern["layers"].append(layer_index + 1)
        z = min((float(p.get("z") or 0.0) for p in layer), default=0.0)
        top = max((float(p.get("z") or 0.0) + float(p.get("case_height") or 0.0) for p in layer), default=z)
        for placement in layer:
            placement["pattern_letter"] = pattern["letter"]
            placement["pattern_index"] = pattern_index
        rows.append({
            "layer_index": layer_index,
            "layer_number": layer_index + 1,
            "letter": pattern["letter"],
            "z": z,
            "height": max(0.0, top - z),
            "placements": layer,
        })
    return patterns, rows


def _mpl_tihi_transform_layer(
    layer: List[Dict[str, Any]],
    constraints: Dict[str, float],
    flip_x: bool,
    flip_y: bool,
) -> List[Dict[str, Any]]:
    transformed: List[Dict[str, Any]] = []
    for placement in layer:
        x = float(placement.get("x") or 0.0)
        y = float(placement.get("y") or 0.0)
        length = float(placement.get("case_length") or 0.0)
        width = float(placement.get("case_width") or 0.0)
        transformed.append({
            **placement,
            "x": max(0.0, constraints["max_length_in"] - x - length) if flip_x else x,
            "y": max(0.0, constraints["max_width_in"] - y - width) if flip_y else y,
        })
    return transformed


def _mpl_tihi_internal_x_edges(layer: List[Dict[str, Any]], max_length: float) -> List[float]:
    edges: List[float] = []
    for placement in layer:
        x = float(placement.get("x") or 0.0)
        length = _mpl_rect_length(placement)
        for edge in (x, x + length):
            if 0.001 < edge < max_length - 0.001:
                edges.append(round(edge, 3))
    return edges


def _mpl_tihi_edge_overlap_score(left_edges: List[float], right_edges: List[float]) -> int:
    score = 0
    used: set[int] = set()
    for left in left_edges:
        for index, right in enumerate(right_edges):
            if index in used:
                continue
            if abs(left - right) <= 0.001:
                score += 1
                used.add(index)
                break
    return score


def _mpl_tihi_layer_variant_valid(
    original_layer: List[Dict[str, Any]],
    candidate_layer: List[Dict[str, Any]],
    placements: List[Dict[str, Any]],
    constraints: Dict[str, float],
    level_z: float,
) -> bool:
    support_surfaces = _mpl_tihi_support_surfaces(placements, level_z, constraints)
    layer_ids = {id(placement) for placement in original_layer}

    for placement in candidate_layer:
        placement_weight = float(placement.get("unit_weight") or 0.0)
        if _mpl_tihi_has_lighter_support_overlap(placement, support_surfaces, placement_weight):
            return False
        support_ratio = _mpl_tihi_support_ratio(placement, support_surfaces, placement_weight)
        if support_ratio < 0.8:
            return False
        placement["support_ratio"] = support_ratio

    for index, placement in enumerate(candidate_layer):
        for other_index, other in enumerate(candidate_layer):
            if index == other_index:
                continue
            if _mpl_tihi_z_overlaps(other, float(placement.get("z") or 0.0), float(placement.get("case_height") or 0.0)) and _mpl_tihi_rects_overlap(placement, other):
                return False
        for other in placements:
            if id(other) in layer_ids:
                continue
            if _mpl_tihi_z_overlaps(other, float(placement.get("z") or 0.0), float(placement.get("case_height") or 0.0)) and _mpl_tihi_rects_overlap(placement, other):
                return False
    return True


def _mpl_finalize_height_zone_patterns(
    placements: List[Dict[str, Any]],
    constraints: Dict[str, float],
) -> None:
    if not placements:
        return
    levels: List[float] = []
    for placement in placements:
        z = float(placement.get("z") or 0.0)
        if not any(abs(z - level) <= 0.001 for level in levels):
            levels.append(z)
    levels.sort()
    for level_index, level_z in enumerate(levels):
        layer = [placement for placement in placements if abs(float(placement.get("z") or 0.0) - level_z) <= 0.001]
        for placement in layer:
            placement["layer_index"] = level_index

        previous_layers = [
            [placement for placement in placements if abs(float(placement.get("z") or 0.0) - previous_z) <= 0.001]
            for previous_z in levels[max(0, level_index - 3):level_index]
        ]
        previous_edges = [
            _mpl_tihi_internal_x_edges(previous_layer, constraints["max_length_in"])
            for previous_layer in previous_layers
        ]
        previous_signature = _mpl_tihi_layer_signature(previous_layers[-1]) if previous_layers else ""

        variants = [
            (0, False, False),
            (1, True, False),
            (2, False, True),
            (3, True, True),
        ]
        best_variant: Optional[List[Dict[str, Any]]] = None
        best_score: Optional[Tuple[float, ...]] = None
        for transform_index, flip_x, flip_y in variants:
            candidate_layer = _mpl_tihi_transform_layer(layer, constraints, flip_x, flip_y)
            if not _mpl_tihi_layer_variant_valid(layer, candidate_layer, placements, constraints, level_z):
                continue

            candidate_edges = _mpl_tihi_internal_x_edges(candidate_layer, constraints["max_length_in"])
            immediate_penalty = _mpl_tihi_edge_overlap_score(candidate_edges, previous_edges[-1]) if previous_edges else 0
            recent_penalty = sum(_mpl_tihi_edge_overlap_score(candidate_edges, edges) for edges in previous_edges[:-1])
            signature = _mpl_tihi_layer_signature(candidate_layer)
            transform_preference = 1.0 if transform_index == level_index % 4 else 0.0
            score = (
                -float(immediate_penalty * 3 + recent_penalty),
                0.0 if signature == previous_signature else 1.0,
                transform_preference,
                -float(transform_index),
            )
            if best_score is None or _mpl_score_gt(score, best_score):
                best_score = score
                best_variant = candidate_layer

        if best_variant is None:
            continue

        for placement, candidate in zip(layer, best_variant):
            placement["x"] = candidate["x"]
            placement["y"] = candidate["y"]
            placement["support_ratio"] = candidate["support_ratio"]


def _mpl_build_pallet_tihi_layout(groups: List[Dict[str, Any]], constraints: Dict[str, float]) -> Dict[str, Any]:
    placements: List[Dict[str, Any]] = []
    overflow_count = 0

    active_groups = [
        {**group, "remaining_cases": int(group.get("assigned_cases") or 0)}
        for group in sorted(
            groups,
            key=lambda group: (-float(group.get("unit_weight") or 0.0), int(group.get("sort_index") or 0)),
        )
    ]

    while any(group["remaining_cases"] > 0 for group in active_groups):
        candidate: Optional[Dict[str, Any]] = None
        support_levels = _mpl_tihi_support_levels(placements, constraints)
        for group in active_groups:
            if group["remaining_cases"] <= 0:
                continue
            for level_index, base_z in enumerate(support_levels):
                if base_z >= constraints["max_height_in"] - 0.001:
                    continue
                support_surfaces = _mpl_tihi_support_surfaces(placements, base_z, constraints)
                if not support_surfaces:
                    continue
                best_fit = _mpl_pick_best_layer_placement(
                    [],
                    support_surfaces,
                    group["dimensions"],
                    constraints,
                    level_index % 2 == 1,
                    float(group.get("unit_weight") or 0.0),
                    placements,
                    base_z,
                )
                if best_fit is None:
                    continue
                placement = best_fit["placement"]
                if base_z + float(placement["case_height"]) > constraints["max_height_in"] + 0.001:
                    continue
                layer_capacity = _mpl_tihi_layer_capacity(group, constraints)
                layer_case_count = min(int(group.get("remaining_cases") or 0), layer_capacity)
                score = (
                    -float(base_z),
                    float(group.get("unit_weight") or 0.0),
                    1.0 if int(group.get("remaining_cases") or 0) >= layer_capacity else 0.0,
                    float(layer_case_count),
                    float(placement["case_length"]) * float(placement["case_width"]),
                    *tuple(best_fit.get("score") or ()),
                )
                if candidate is None or _mpl_score_gt(score, candidate["score"]):
                    candidate = {
                        "group": group,
                        "best_fit": best_fit,
                        "score": score,
                        "base_z": base_z,
                    }

        if candidate is None:
            for group in active_groups:
                overflow_count += max(0, int(group.get("remaining_cases") or 0))
                group["remaining_cases"] = 0
            break

        group = candidate["group"]
        best_fit = candidate["best_fit"]
        oriented = best_fit["placement"]
        base_z = float(candidate["base_z"])

        placed = {
            "x": oriented["x"],
            "y": oriented["y"],
            "z": base_z,
            "layer_index": 0,
            "case_length": oriented["case_length"],
            "case_width": oriented["case_width"],
            "case_height": oriented["case_height"],
            "rotated": bool(oriented.get("rotated")),
            "unit_weight": group.get("unit_weight") or 0.0,
            "label": group.get("label") or "",
            "color": group["color"],
            "support_ratio": float(best_fit.get("support_ratio") or 1.0),
        }
        placements.append(placed)

        group["remaining_cases"] = max(0, int(group["remaining_cases"]) - 1)

    _mpl_finalize_height_zone_patterns(placements, constraints)

    case_volume = sum(
        float(p.get("case_length") or 0.0)
        * float(p.get("case_width") or 0.0)
        * float(p.get("case_height") or 0.0)
        for p in placements
    )
    pallet_volume = constraints["max_length_in"] * constraints["max_width_in"] * constraints["max_height_in"]
    pallet_fill_pct = min(100.0, (case_volume / pallet_volume) * 100.0) if pallet_volume > 0 else 0.0
    return {
        "placements": placements,
        "used_height": max((_mpl_tihi_top_z(placement) for placement in placements), default=0.0),
        "overflow_count": overflow_count,
        "pallet_fill_pct": pallet_fill_pct,
    }


def _mpl_build_tihi_entries(
    mpl: Dict[str, Any],
    items: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    grouped: Dict[Tuple[str, str, str, str, str, str], Dict[str, Any]] = {}
    warnings: List[str] = []
    constraints = _mpl_tihi_constraints(mpl)

    for index, item in enumerate(items):
        pallet = _mpl_pallet_value(item)
        qty = _mpl_tihi_case_qty(item)
        if qty < 1:
            continue

        label = _mpl_tihi_item_label(item)
        length = _parse_float(item.get("length_in"))
        width = _parse_float(item.get("width_in"))
        height = _parse_float(item.get("height_in"))
        weight_raw = _mpl_clean(item.get("unit_weight_lbs"))
        dimensions = (length, width, height) if all(value is not None and value > 0 for value in (length, width, height)) else None
        unit_weight = _parse_float(weight_raw)

        if dimensions is None:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)} / {label}: missing Case dimensions in product master."
            )
            continue
        if unit_weight is None or unit_weight <= 0:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)} / {label}: missing Case weight in product master."
            )
            continue

        group_key = (
            pallet,
            _canonical_id(item.get("sku") or item.get("item_number") or item.get("gtin") or item.get("case_upc") or item.get("upc"))
            or _normalize(item.get("description") or "")
            or f"line-{_mpl_clean(item.get('line')) or '0'}",
            _format_number(length),
            _format_number(width),
            _format_number(height),
            weight_raw,
        )
        group = grouped.setdefault(group_key, {
            "pallet": pallet,
            "sku": _mpl_clean(item.get("sku")),
            "item_number": _mpl_clean(item.get("item_number")),
            "gtin": _mpl_clean(item.get("gtin") or item.get("case_upc") or item.get("upc")),
            "description": _mpl_clean(item.get("description")),
            "length_in": _format_number(length),
            "width_in": _format_number(width),
            "height_in": _format_number(height),
            "dimensions_in": " x ".join((_format_number(length), _format_number(width), _format_number(height))),
            "unit_weight_lbs": weight_raw,
            "dimensions": dimensions,
            "unit_weight": unit_weight,
            "assigned_cases": 0,
            "lines": [],
            "sort_index": index,
        })
        group["assigned_cases"] += qty
        if item.get("line") is not None:
            group["lines"].append(str(item.get("line")))

    pallet_groups: Dict[str, List[Dict[str, Any]]] = {}
    color_by_sku: Dict[str, Tuple[float, float, float]] = {}
    for group_index, group in enumerate(sorted(grouped.values(), key=lambda row: (_mpl_pallet_sort_key(row["pallet"]), row["sort_index"]))):
        label = group["sku"] or group["item_number"] or group["gtin"] or group["description"] or f"Item {group_index + 1}"
        group_constraints = _mpl_tihi_constraints(mpl, group["pallet"])
        orientation = _mpl_best_tihi_orientation(group["dimensions"], group_constraints)
        if orientation is None:
            warnings.append(
                f"Pallet {_mpl_pallet_label(group['pallet'])} / {label}: Case footprint exceeds the pallet base."
            )
            continue
        group["label"] = label
        color_key = _mpl_tihi_color_key({**group, "label": label}) or f"group-{group_index}"
        if color_key not in color_by_sku:
            color_by_sku[color_key] = _mpl_tihi_color(len(color_by_sku))
        group["color"] = color_by_sku[color_key]
        group["base_orientation"] = orientation
        group["lines"] = sorted(set(group["lines"]), key=lambda value: int(re.search(r"\d+", value).group(0)) if re.search(r"\d+", value) else value)
        pallet_groups.setdefault(group["pallet"], []).append(group)

    entries: List[Dict[str, Any]] = []
    for pallet, groups in sorted(pallet_groups.items(), key=lambda pair: _mpl_pallet_sort_key(pair[0])):
        pallet_constraints = _mpl_tihi_constraints(mpl, pallet)
        total_weight = sum(group["unit_weight"] * group["assigned_cases"] for group in groups)
        gross_weight = _mpl_round_product_weight_for_pallet(total_weight) + _MPL_PALLET_TARE_LBS
        if gross_weight > pallet_constraints["max_gross_lbs"]:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)}: gross pallet weight {int(round(gross_weight))} lbs exceeds the {pallet_constraints['max_gross_lbs']:.0f} lb limit."
            )

        groups = sorted(groups, key=lambda group: (-float(group.get("unit_weight") or 0.0), int(group.get("sort_index") or 0)))
        layout = _mpl_build_pallet_tihi_layout(groups, pallet_constraints)
        placements = layout["placements"]
        if not placements:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)}: no TI-Hi layout could be created from the assigned case measurements."
            )
            continue

        layer_buckets: Dict[int, List[Dict[str, Any]]] = {}
        for placement in placements:
            layer_buckets.setdefault(int(placement["layer_index"]), []).append(placement)
        max_layer = max(layer_buckets.keys())
        display_layer = max_layer
        top_placements = _mpl_visible_top_placements(placements)
        top_rows_used = len({(round(float(p["y"]), 4), round(float(p["case_width"]), 4)) for p in top_placements}) or 1
        max_cases_in_layer = max((len(layer) for layer in layer_buckets.values()), default=0)
        layer_patterns, layer_pattern_rows = _mpl_build_tihi_layer_patterns(placements)
        overflow_count = int(layout["overflow_count"])
        if overflow_count:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)}: {overflow_count} case(s) exceed the current pallet footprint/height constraints."
            )

        entries.append({
            "pallet": pallet,
            "pallet_label": _mpl_pallet_label(pallet),
            "constraints": pallet_constraints,
            "placements": placements,
            "top_placements": top_placements,
            "layer_patterns": layer_patterns,
            "layer_pattern_rows": layer_pattern_rows,
            "groups": groups,
            "assigned_cases": sum(group["assigned_cases"] for group in groups),
            "shown_cases": len(placements),
            "overflow_cases": overflow_count,
            "ti": max_cases_in_layer,
            "hi": max_layer + 1,
            "display_layer": display_layer,
            "top_rows_used": top_rows_used,
            "top_layer_cases": len(top_placements),
            "gross_weight_lbs": gross_weight,
            "pallet_fill_pct": float(layout.get("pallet_fill_pct") or 0.0),
            "used_height": float(layout["used_height"]),
            "lines": sorted({line for group in groups for line in group["lines"]}, key=lambda value: int(re.search(r"\d+", value).group(0)) if re.search(r"\d+", value) else value),
        })

    unique_warnings = list(dict.fromkeys(warnings))
    return entries, unique_warnings


__all__ = [
    '_mpl_tihi_constraints',
    '_mpl_tihi_case_qty',
    '_mpl_tihi_item_label',
    '_mpl_tihi_color',
    '_mpl_tihi_color_key',
    '_mpl_best_tihi_orientation',
    '_mpl_round_product_weight_for_pallet',
    '_mpl_tihi_placement_options',
    '_mpl_score_gt',
    '_mpl_tihi_layer_capacity',
    '_mpl_rect_length',
    '_mpl_rect_width',
    '_mpl_tihi_intersection_area',
    '_mpl_tihi_rects_overlap',
    '_mpl_tihi_top_z',
    '_mpl_tihi_z_overlaps',
    '_mpl_tihi_support_surfaces',
    '_mpl_tihi_support_levels',
    '_mpl_tihi_support_ratio',
    '_mpl_tihi_has_lighter_support_overlap',
    '_mpl_tihi_candidate_values',
    '_mpl_pick_best_layer_placement',
    '_mpl_subtract_rect',
    '_mpl_is_fully_covered_by_higher',
    '_mpl_visible_top_placements',
    '_mpl_tihi_pattern_letter',
    '_mpl_tihi_layer_signature',
    '_mpl_build_tihi_layer_patterns',
    '_mpl_tihi_transform_layer',
    '_mpl_tihi_internal_x_edges',
    '_mpl_tihi_edge_overlap_score',
    '_mpl_tihi_layer_variant_valid',
    '_mpl_finalize_height_zone_patterns',
    '_mpl_build_pallet_tihi_layout',
    '_mpl_build_tihi_entries',

]
