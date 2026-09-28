"""KeHE product matching and MPL enrichment."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from labelkit.reference_data import _apply_product_hierarchy, normalize_packaging_level, normalize_product_master_row

from .asn_parser import _normalize


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _pallet_value(item: Dict[str, Any]) -> str:
    return _clean(item.get("location_on_pallet")) or "1"

_PACKAGING_LEVELS = {
    "CASE": "Case",
    "INNER PACK": "Inner Pack",
    "EACH": "Each",
    "SHIPPER CONTENTS": "Shipper Contents",
    "OTHER": "Other",
}


def _only_digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _canonical_id(value: Any) -> str:
    digits = _only_digits(value)
    return digits.lstrip("0") or digits


def _canonical_sku(value: Any) -> str:
    raw = str(value or "").strip().casefold()
    if re.fullmatch(r"\d+(?:\.0+)?", raw):
        raw = raw.split(".", 1)[0].lstrip("0") or "0"
    return re.sub(r"[\s_-]+", "", raw)


def _gtin14(value: Any) -> str:
    digits = _only_digits(value)
    if len(digits) == 14:
        return digits
    if len(digits) > 14:
        return digits[-14:]
    if len(digits) == 13:
        return "0" + digits
    return digits


def _normalize_packaging_level(value: Any) -> str:
    return normalize_packaging_level(value)


def _boolish(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    raw = str(value).strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "y", "on", "checked", "✅", "x"}:
        return True
    if raw in {"0", "false", "no", "n", "off", "unchecked", "barcode on product"}:
        return False
    if "barcode" in raw and "product" in raw:
        return False
    return default


def _product_in_packing_list(row: Dict[str, Any], packaging_level: str) -> bool:
    return _boolish(row.get("is_active", row.get("IS_ACTIVE", True)), True) and _normalize_packaging_level(packaging_level) == "Case"


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on", "checked"}


def _parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _format_lbs(value: Optional[float]) -> str:
    if value is None:
        return ""
    if abs(value - round(value)) < 0.005:
        return f"{int(round(value))} lbs"
    return f"{value:.2f}".rstrip("0").rstrip(".") + " lbs"


def _format_number(value: Optional[float]) -> str:
    if value is None:
        return ""
    if abs(value - round(value)) < 0.000001:
        return str(int(round(value)))
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _product_dimensions_display(product: Dict[str, Any]) -> str:
    values = [
        _format_number(_parse_float(product.get("length_in"))),
        _format_number(_parse_float(product.get("width_in"))),
        _format_number(_parse_float(product.get("height_in"))),
    ]
    return " x ".join(values) if all(values) else ""


def _legacy_product_master_adapter(row: Dict[str, Any]) -> Dict[str, Any]:
    """Convert one historical Product Master snapshot to the current fields."""
    adapted = dict(row)
    dimensions = str(
        row.get("dimensions_in")
        or row.get("DIMENSIONS_IN")
        or row.get("lwh_in")
        or row.get("L X W X H (in)")
        or row.get("dimensions")
        or ""
    ).strip()
    if dimensions and not all(adapted.get(key) not in (None, "") for key in ("length_in", "width_in", "height_in")):
        values = re.findall(r"-?\d+(?:\.\d+)?", dimensions.replace(",", ""))
        if len(values) >= 3:
            adapted.setdefault("length_in", values[0])
            adapted.setdefault("width_in", values[1])
            adapted.setdefault("height_in", values[2])
    if adapted.get("gross_weight_lbs") in (None, ""):
        adapted["gross_weight_lbs"] = row.get("weight_lbs") or row.get("WEIGHT_LBS") or row.get("WEIGHT(lbs)") or row.get("weight") or ""
    if adapted.get("default_copies") in (None, ""):
        adapted["default_copies"] = row.get("labels_per_unit") or row.get("LABELS_PER_UNIT") or row.get("Labels / Unit") or row.get("labels_to_print_per_unit") or row.get("label_copies_per_unit") or ""
    return adapted


def _normalize_product_master_rows(rows: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not rows:
        return out
    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        normalized = normalize_product_master_row(_legacy_product_master_adapter(row))
        normalized["line"] = row.get("line") or idx
        if not any([
            normalized.get("gtin"), normalized.get("description"), normalized.get("length_in"),
            normalized.get("width_in"), normalized.get("height_in"), normalized.get("gross_weight_lbs"),
            normalized.get("sku"), normalized.get("case_qty"), normalized.get("default_copies"),
            normalized.get("config_id"), normalized.get("display_sku"),
        ]) and normalized.get("packaging_level") == "Other":
            continue
        out.append(normalized)

    return _apply_product_hierarchy(out)


def _product_master_lookup(rows: List[Dict[str, Any]], *, packing_list_only: bool = False) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    normalized_rows = _normalize_product_master_rows(rows)
    outer_by_group: Dict[str, Dict[str, Any]] = {}
    for row in normalized_rows:
        identity = str(row.get("config_id") or row.get("display_sku") or row.get("sku") or "").strip().lower()
        group_key = f"{str(row.get('storefront') or 'KeHE').strip().lower()}|{identity}"
        if row.get("in_packing_list"):
            outer_by_group[group_key] = row
    for row in normalized_rows:
        identity = str(row.get("config_id") or row.get("display_sku") or row.get("sku") or "").strip().lower()
        group_key = f"{str(row.get('storefront') or 'KeHE').strip().lower()}|{identity}"
        target = outer_by_group.get(group_key) if packing_list_only else row
        if not target:
            continue
        barcode_key = _canonical_id(row.get("gtin"))
        if barcode_key:
            lookup.setdefault(barcode_key, target)
        for value in (row.get("sku"), row.get("display_sku"), row.get("customer_item_number")):
            sku_key = _canonical_sku(value)
            if sku_key:
                lookup.setdefault("sku:" + sku_key, target)
    return lookup


def _match_product_master_row(item: Dict[str, Any], rows: List[Dict[str, Any]], *, packing_list_only: bool = False) -> Optional[Dict[str, Any]]:
    lookup = _product_master_lookup(rows, packing_list_only=packing_list_only)
    for value in (item.get("gtin"), item.get("case_upc"), item.get("upc")):
        key = _canonical_id(value)
        if key and key in lookup:
            return lookup[key]
    for value in (item.get("item_number"), item.get("customer_item_number"), item.get("sku")):
        sku_key = _canonical_sku(value)
        if sku_key and ("sku:" + sku_key) in lookup:
            return lookup["sku:" + sku_key]
        if sku_key.isdigit() and sku_key in lookup:
            return lookup[sku_key]
    desc = _normalize(item.get("description") or "")
    if desc:
        for row in _normalize_product_master_rows(rows):
            if packing_list_only and not row.get("in_packing_list"):
                continue
            if _normalize(row.get("description") or "") == desc:
                return row
    return None


def _find_product_packaging_sibling(
    product: Dict[str, Any],
    rows: List[Dict[str, Any]],
    packaging_level: str,
) -> Optional[Dict[str, Any]]:
    """Find one packaging row in the same Product Group ID."""
    wanted_sku = str(product.get("sku") or "").strip().lower()
    wanted_config = str(product.get("config_id") or "").strip().lower()
    wanted_storefront = str(product.get("storefront") or "KeHE").strip().lower() or "kehe"
    wanted_level = _normalize_packaging_level(packaging_level)
    if not wanted_sku and not wanted_config:
        return None

    matches: List[Dict[str, Any]] = []
    seen_gtins: set[str] = set()
    for row in _normalize_product_master_rows(rows):
        if _normalize_packaging_level(row.get("packaging_level")) != wanted_level:
            continue
        row_config = str(row.get("config_id") or "").strip().lower()
        if wanted_config:
            if row_config != wanted_config:
                continue
        elif str(row.get("sku") or "").strip().lower() != wanted_sku:
            continue
        row_storefront = str(row.get("storefront") or "KeHE").strip().lower() or "kehe"
        if row_storefront != wanted_storefront:
            continue
        gtin = str(row.get("gtin") or "").strip()
        if not gtin:
            continue
        canonical_gtin = _canonical_id(gtin)
        if canonical_gtin in seen_gtins:
            continue
        seen_gtins.add(canonical_gtin)
        matches.append(row)
    return matches[0] if len(matches) == 1 else None


def _qty_value(value: Any) -> float:
    parsed = _parse_float(value)
    return parsed if parsed is not None else 0.0


def _apply_product_row_to_item(
    item: Dict[str, Any],
    product: Dict[str, Any],
    each_product: Optional[Dict[str, Any]] = None,
) -> None:
    each_gtin = str((each_product or {}).get("gtin") or "").strip()
    # KeHE's MPL Item Number is the consumer-unit (Each) GTIN. The Case GTIN
    # remains in gtin/case_upc for case identification and label generation.
    fallback_item_number = (
        _clean(item.get("sku"))
        or _clean(product.get("sku"))
        or _clean(item.get("item_number"))
    )
    item["item_number"] = each_gtin or fallback_item_number
    item["each_gtin"] = each_gtin
    if product.get("gtin"):
        item["gtin"] = product.get("gtin", "")
        item["case_upc"] = product.get("gtin", "")
    if product.get("sku"):
        item["sku"] = product.get("sku", "")
    if product.get("description") and not _clean(item.get("description")):
        item["description"] = product.get("description", "")
    item["packaging_level"] = product.get("packaging_level", "")
    item["length_in"] = product.get("length_in", "")
    item["width_in"] = product.get("width_in", "")
    item["height_in"] = product.get("height_in", "")
    item["dimensions_in"] = _product_dimensions_display(product)
    item["unit_weight_lbs"] = product.get("gross_weight_lbs", "")
    if not _clean(item.get("quantity_per_case")):
        item["quantity_per_case"] = product.get("case_qty", "")
    if not _clean(item.get("product_size")):
        each_weight = _clean(product.get("each_net_weight_g"))
        if each_weight:
            item["product_size"] = f"{each_weight} g"
    unit_weight = _parse_float(product.get("gross_weight_lbs"))
    if unit_weight is not None:
        item["calculated_weight_lbs"] = _format_lbs(unit_weight * _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty")))


def apply_product_master_to_mpl_draft(draft: Dict[str, Any], *, force: bool = False) -> Dict[str, Any]:
    """Fill MPL line-item metadata and blank pallet weights from product master rows.

    Manual pallet weights are preserved unless force=True. Frontend users can still
    override the generated values before rendering.
    """
    product_rows = _normalize_product_master_rows(draft.get("product_master") or draft.get("product_master_rows") or [])
    draft["product_master"] = product_rows

    for mpl in draft.get("packing_lists") or []:
        items = mpl.get("items") or []
        pallet_totals: Dict[str, float] = {}
        existing_warnings = [
            str(warning)
            for warning in (mpl.get("warnings") or [])
            if "required for MPL Item Number" not in str(warning)
            and "was not found as an enabled Case row in Product Master" not in str(warning)
        ]
        mpl["warnings"] = existing_warnings
        for item in items:
            product = _match_product_master_row(item, product_rows, packing_list_only=True)
            if not product:
                has_identity = any(
                    _clean(item.get(key))
                    for key in ("item_number", "sku", "gtin", "case_upc", "upc", "description")
                )
                if has_identity:
                    identity = (
                        _clean(item.get("sku"))
                        or _clean(item.get("gtin"))
                        or _clean(item.get("case_upc"))
                        or _clean(item.get("upc"))
                        or _clean(item.get("item_number"))
                        or "Unknown item"
                    )
                    item["item_number"] = _clean(item.get("sku")) or _clean(item.get("item_number")) or identity
                    item["each_gtin"] = ""
                    warning = f"SKU {identity}: using order data; add Product Master data for GTIN, weight, and TI-HI."
                    if warning not in mpl["warnings"]:
                        mpl["warnings"].append(warning)
                    mpl["status"] = "Needs Review"
                continue
            each_product = _find_product_packaging_sibling(product, product_rows, "Each")
            _apply_product_row_to_item(item, product, each_product)
            if not each_product:
                sku = str(product.get("sku") or item.get("sku") or "").strip() or "Unknown SKU"
                warning = f"SKU {sku}: no Each GTIN; using SKU as Item Number."
                if warning not in mpl["warnings"]:
                    mpl["warnings"].append(warning)
                mpl["status"] = "Needs Review"
            unit_weight = _parse_float(product.get("gross_weight_lbs"))
            if unit_weight is None:
                continue
            pallet = _pallet_value(item)
            pallet_totals[pallet] = pallet_totals.get(pallet, 0.0) + unit_weight * _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty"))

        if pallet_totals:
            if not isinstance(mpl.get("_pallet_weights"), dict):
                mpl["_pallet_weights"] = {}
            for pallet, total in pallet_totals.items():
                calculated = _format_lbs(total)
                if force or not _clean(mpl["_pallet_weights"].get(pallet)):
                    mpl["_pallet_weights"][pallet] = calculated
                for item in items:
                    if _pallet_value(item) == pallet and (force or not _clean(item.get("pallet_weight"))):
                        item["pallet_weight"] = mpl["_pallet_weights"].get(pallet) or calculated
    return draft


__all__ = [
    "_apply_product_row_to_item",
    "_match_product_master_row",
    "_normalize_product_master_rows",
    "_product_master_lookup",
    "apply_product_master_to_mpl_draft",
]
