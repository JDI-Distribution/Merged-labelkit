"""Product Master and shared customer-reference normalization."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

DEFAULT_CASE_QTY_BY_LEVEL = {
    "Case": "",
    "Inner Pack": "",
    "Each": "1",
    "Master Case": "",
    "Pallet": "",
    "Shipper Contents": "",
    "Other": "",
}
B2B_VERIFICATION_STATUSES = {"DRAFT", "NEEDS_REVIEW", "VERIFIED", "BLOCKED"}
B2B_DIRECTORY_RECORD_TYPES = {
    "CUSTOMER_DEFAULT", "DESTINATION", "DISTRIBUTION_CENTER",
    "SHIP_FROM", "SHIP_TO", "BILL_TO",
}
DEFAULT_DIRECTORY_SHIP_FROM = "BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373\nUSA"

def normalize_packaging_level(value: Any) -> str:
    raw = re.sub(r"\s+", " ", str(value or "").strip().lower())
    compact = raw.replace(" ", "")
    if raw in {"master case", "master carton"} or compact in {"mastercase", "mastercarton"}:
        return "Master Case"
    if raw in {"pallet", "plt"}:
        return "Pallet"
    if raw in {"case", "cases", "master pack", "master packs", "mp", "case pack", "case packs"} or compact == "casepack":
        return "Case"
    if raw in {"inner pack", "inner packs", "inner", "ip"} or compact in {"innerpack", "innerpacks"}:
        return "Inner Pack"
    if raw in {"each", "ea"}:
        return "Each"
    if raw in {"shipper contents", "shipper content", "shipper", "display shipper"}:
        return "Shipper Contents"
    if raw == "other":
        return "Other"
    return "Other"


def _normalize_verification_status(value: Any) -> str:
    raw = re.sub(r"\s+", "_", str(value or "").strip().upper())
    if raw in {"APPROVED", "READY"}:
        return "VERIFIED"
    if raw in B2B_VERIFICATION_STATUSES:
        return raw
    return "NEEDS_REVIEW" if raw else "DRAFT"


def _normalize_directory_record_type(value: Any) -> str:
    raw = re.sub(r"\s+", "_", str(value or "").strip().upper())
    return raw if raw in B2B_DIRECTORY_RECORD_TYPES else "DESTINATION"


DIRECTORY_ADDRESS_ROLES = ("SHIP_FROM", "SHIP_TO", "BILL_TO")


def _parse_directory_roles(value: Any) -> List[str]:
    """Return the selected address roles in a stable display order."""
    values = value if isinstance(value, list) else re.split(r"[,;|]+", str(value or ""))
    selected = {
        re.sub(r"\s+", "_", str(item or "").strip().upper())
        for item in values
    }
    return [role for role in DIRECTORY_ADDRESS_ROLES if role in selected]


def _first_value(row: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        if key in row and row.get(key) is not None:
            return str(row.get(key)).strip()
    return ""


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
    """Derive MPL inclusion; it is intentionally not stored in Product Master."""
    is_active = _boolish(_first_value(row, "is_active", "IS_ACTIVE"), True)
    return is_active and normalize_packaging_level(packaging_level) == "Case"


def _normalize_storefront(value: Any) -> str:
    clean = str(value or "").strip()
    return clean or "KeHE"


def _is_kehe_storefront(value: Any) -> bool:
    return _normalize_storefront(value).lower() == "kehe"


def _parse_decimal_value(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if parsed > 0 else None
    raw = str(value or "").strip()
    if not raw:
        return None
    raw = raw.replace(",", "")
    mixed_fraction = re.match(r"^(-?\d+)\s+(\d+)/(\d+)$", raw)
    if mixed_fraction:
        whole = float(mixed_fraction.group(1))
        numerator = float(mixed_fraction.group(2))
        denominator = float(mixed_fraction.group(3))
        if denominator == 0:
            return None
        parsed = whole + (numerator / denominator)
        return parsed if parsed > 0 else None
    simple_fraction = re.match(r"^(\d+)/(\d+)$", raw)
    if simple_fraction:
        numerator = float(simple_fraction.group(1))
        denominator = float(simple_fraction.group(2))
        if denominator == 0:
            return None
        parsed = numerator / denominator
        return parsed if parsed > 0 else None
    match = re.search(r"-?\d+(?:\.\d+)?", raw)
    if not match:
        return None
    parsed = float(match.group(0))
    return parsed if parsed > 0 else None


def _format_decimal_string(value: Optional[float]) -> str:
    if value is None:
        return ""
    if abs(value - round(value)) < 0.000001:
        return str(int(round(value)))
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _parse_legacy_dimensions(value: Any) -> Optional[tuple[float, float, float]]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    fraction_map = {
        "¼": ".25",
        "½": ".5",
        "¾": ".75",
        "⅛": ".125",
        "⅜": ".375",
        "⅝": ".625",
        "⅞": ".875",
    }
    for symbol, replacement in fraction_map.items():
        raw = raw.replace(symbol, replacement)
    raw = re.sub(r"(\d+)\s+(\d+)/(\d+)", lambda m: str(float(m.group(1)) + (float(m.group(2)) / float(m.group(3)))), raw)
    raw = re.sub(r"\((?:l|w|b|h)\)", "", raw)
    raw = raw.replace("×", "x")
    numbers = re.findall(r"-?\d+(?:\.\d+)?", raw)
    if len(numbers) < 3:
        return None
    length = _parse_decimal_value(numbers[0])
    width = _parse_decimal_value(numbers[1])
    height = _parse_decimal_value(numbers[2])
    if length is None or width is None or height is None:
        return None
    return (length, width, height)


def _resolve_dimensions(row: Dict[str, Any]) -> tuple[str, str, str, str, bool]:
    dimensions_in_raw = _first_value(row, "dimensions_in", "DIMENSIONS_IN", "L_X_W_X_H_IN", "L × W × H (in)")
    length = _parse_decimal_value(_first_value(row, "length_in", "LENGTH_IN", "length", "Length"))
    width = _parse_decimal_value(_first_value(row, "width_in", "WIDTH_IN", "breadth_in", "BREADTH_IN", "width", "breadth", "Width / Breadth"))
    height = _parse_decimal_value(_first_value(row, "height_in", "HEIGHT_IN", "height", "Height"))

    parsed_from_legacy = False
    if (length is None or width is None or height is None) and dimensions_in_raw:
        parsed = _parse_legacy_dimensions(dimensions_in_raw)
        if parsed is not None:
            parsed_from_legacy = True
            if length is None:
                length = parsed[0]
            if width is None:
                width = parsed[1]
            if height is None:
                height = parsed[2]

    length_s = _format_decimal_string(length)
    width_s = _format_decimal_string(width)
    height_s = _format_decimal_string(height)
    if length_s and width_s and height_s:
        dimensions_in = f"{length_s} x {width_s} x {height_s}"
    else:
        dimensions_in = dimensions_in_raw
    return length_s, width_s, height_s, dimensions_in, parsed_from_legacy


def normalize_product_master_row(row: Dict[str, Any]) -> Dict[str, Any]:
    storefront = _normalize_storefront(_first_value(row, "storefront", "STOREFRONT", "Storefront"))
    gtin = _first_value(row, "gtin", "GTIN", "case_upc", "CASE_UPC", "upc", "UPC")
    config_id = _first_value(row, "config_id", "CONFIG_ID", "config", "configuration_id")
    packaging_level = normalize_packaging_level(
        _first_value(row, "packaging_level", "packging_level", "PACKAGING_LEVEL", "PACKGING LEVEL", "Packaging Level")
    )
    in_packing_list = _product_in_packing_list(row, packaging_level)
    case_qty = _first_value(
        row,
        "case_qty",
        "CASE_QTY",
        "Case Qty",
        "Eaches / Package",
        "eaches_per_package",
        "eaches_per_case",
        "eaches_per_inner_pack",
    )
    sku = _first_value(row, "sku", "SKU", "item_number", "ITEM_NUMBER")
    display_sku = _first_value(row, "display_sku", "DISPLAY_SKU", "display_item_number", "DISPLAY_ITEM_NUMBER")
    display_sku_uom = normalize_packaging_level(
        _first_value(row, "display_sku_uom", "DISPLAY_SKU_UOM", "display_sku_represents", "DISPLAY_SKU_REPRESENTS") or "Each"
    )
    if display_sku_uom not in {"Each", "Inner Pack", "Case"}:
        display_sku_uom = "Each"
    inner_packs_per_case = _first_value(
        row,
        "inner_packs_per_case",
        "INNER_PACKS_PER_CASE",
        "inners_per_case",
        "INNERS_PER_CASE",
    )
    customer_item_number = _first_value(row, "customer_item_number", "CUSTOMER_ITEM_NUMBER", "customer_item", "item_number_customer")
    label_template_id = _first_value(row, "label_template_id", "LABEL_TEMPLATE_ID", "template_id")
    barcode_type = _first_value(row, "barcode_type", "BARCODE_TYPE")
    barcode_level = _first_value(row, "barcode_level", "BARCODE_LEVEL")
    each_net_weight_g = _first_value(row, "each_net_weight_g", "EACH_NET_WEIGHT_G")
    package_net_weight_g = _first_value(row, "package_net_weight_g", "PACKAGE_NET_WEIGHT_G")
    gross_weight_lbs = _first_value(
        row,
        "gross_weight_lbs",
        "GROSS_WEIGHT_LBS",
        # One-transition import/read adapter. This value is never written back.
        "weight_lbs",
        "WEIGHT_LBS",
        "Weight (lbs)",
    )
    default_copies = _first_value(
        row,
        "default_copies",
        "DEFAULT_COPIES",
        # One-transition import/read adapter. This value is never written back.
        "labels_per_unit",
        "LABELS_PER_UNIT",
        "Labels / Unit",
    )
    verification_status = _normalize_verification_status(
        _first_value(row, "verification_status", "VERIFICATION_STATUS")
    )
    source_note = _first_value(row, "source_note", "SOURCE_NOTE")

    length_in, width_in, height_in, legacy_dimension_display, parsed_legacy_dimensions = _resolve_dimensions(row)
    if not case_qty:
        case_qty = _default_case_qty_for_product(packaging_level)
    label_enabled_raw = _first_value(row, "label_enabled", "LABEL_ENABLED")
    label_enabled = _boolish(label_enabled_raw, False)
    is_active = _boolish(_first_value(row, "is_active", "IS_ACTIVE"), True)

    return {
        "id": _first_value(row, "id", "ROWID", "rowid"),
        "storefront": storefront,
        "in_packing_list": in_packing_list,
        "gtin": gtin,
        "description": _first_value(row, "description", "DESCRIPTION", "Description"),
        "packaging_level": packaging_level,
        "length_in": length_in,
        "width_in": width_in,
        "height_in": height_in,
        "each_net_weight_g": each_net_weight_g,
        "package_net_weight_g": package_net_weight_g,
        "gross_weight_lbs": gross_weight_lbs,
        "case_qty": case_qty,
        "sku": sku,
        "display_sku": display_sku,
        "display_sku_uom": display_sku_uom,
        "inner_packs_per_case": inner_packs_per_case,
        "config_id": config_id,
        "customer_item_number": customer_item_number,
        "label_template_id": label_template_id,
        "barcode_type": barcode_type,
        "barcode_level": barcode_level,
        "default_copies": default_copies,
        "verification_status": verification_status,
        "label_enabled": label_enabled,
        "source_note": source_note,
        "is_active": is_active,
        "unique_key": _product_master_unique_key(gtin, packaging_level, storefront, sku, config_id=config_id),
    }


def _product_master_unique_key(
    gtin: str,
    packaging_level: str,
    storefront: str = "",
    sku: str = "",
    config_id: str = "",
) -> str:
    store = _normalize_storefront(storefront)
    if str(config_id or "").strip():
        return "|".join([
            store.strip().lower(),
            str(config_id or "").strip().lower(),
            normalize_packaging_level(packaging_level).strip().lower(),
        ])
    return "|".join([
        store.strip().lower(),
        normalize_packaging_level(packaging_level).strip().lower(),
        str(sku or "").strip().lower(),
    ])


def _product_storefront_level_sku_key(row: Dict[str, Any]) -> str:
    normalized = normalize_product_master_row(row)
    return _product_master_unique_key(
        normalized.get("gtin", ""),
        normalized.get("packaging_level", ""),
        normalized.get("storefront", ""),
        normalized.get("sku", ""),
        normalized.get("config_id", ""),
    )


def _default_case_qty_for_product(packaging_level: str) -> str:
    return DEFAULT_CASE_QTY_BY_LEVEL.get(normalize_packaging_level(packaging_level), "")


def parse_product_master_json(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [normalize_product_master_row(r) for r in data if isinstance(r, dict)]


def _dedupe_product_master_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: Dict[str, Dict[str, Any]] = {}
    fallback_index = 0
    for raw in rows:
        row = normalize_product_master_row(raw)
        has_data = any(
            row.get(k)
            for k in (
                "gtin",
                "description",
                "length_in",
                "width_in",
                "height_in",
                "gross_weight_lbs",
                "case_qty",
                "default_copies",
                "sku",
                "display_sku",
                "config_id",
                "customer_item_number",
                "label_template_id",
            )
        )
        if not has_data:
            continue
        key = row.get("unique_key") or ""
        if not str(key).strip() or str(key).strip("|") in {"other", "kehe|other"}:
            fallback_index += 1
            key = f"row-{fallback_index}"
        deduped[key] = row
    return list(deduped.values())


def _kehe_product_master_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    return [row for row in _dedupe_product_master_rows(rows) if _is_kehe_storefront(row.get("storefront"))]


def _parse_match_values(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]

    raw = str(value or "").strip()
    if not raw:
        return []

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(v).strip() for v in parsed if str(v).strip()]
    except Exception:
        pass

    return [v.strip() for v in re.split(r"[\n,]+", raw) if v.strip()]


def normalize_dc_directory_row(row: Dict[str, Any]) -> Dict[str, Any]:
    storefront = _normalize_storefront(_first_value(row, "storefront", "STOREFRONT", "Storefront"))
    dc = _first_value(row, "dc", "DC")
    name = _first_value(row, "name", "NAME")
    ship_from = (
        _first_value(row, "ship_from", "SHIP_FROM", "ship_from_address", "SHIP_FROM_ADDRESS", "Ship From")
        or DEFAULT_DIRECTORY_SHIP_FROM
    )
    delivery_address = _first_value(row, "delivery_address", "DELIVERY_ADDRESS")
    billing_address = _first_value(row, "billing_address", "BILLING_ADDRESS")
    match_values = _parse_match_values(row.get("match_values", row.get("MATCH_VALUES", [])))
    raw_record_type = _first_value(row, "record_type", "RECORD_TYPE", "address_type", "ADDRESS_TYPE")
    roles_value: Any = row.get("address_roles", row.get("ADDRESS_ROLES", raw_record_type))
    address_roles = _parse_directory_roles(roles_value)
    legacy_record_type = _normalize_directory_record_type(raw_record_type)
    if not address_roles and legacy_record_type in DIRECTORY_ADDRESS_ROLES:
        address_roles = [legacy_record_type]
    record_type = ",".join(address_roles) if address_roles else legacy_record_type
    address = _first_value(row, "address", "ADDRESS")
    if not address:
        if "SHIP_FROM" in address_roles:
            address = ship_from
        elif "BILL_TO" in address_roles:
            address = billing_address
        else:
            address = delivery_address
    if address_roles:
        ship_from = address if "SHIP_FROM" in address_roles else ""
        delivery_address = address if "SHIP_TO" in address_roles else ""
        billing_address = address if "BILL_TO" in address_roles else ""
    default_label_template_id = _first_value(row, "default_label_template_id", "DEFAULT_LABEL_TEMPLATE_ID")
    manufacturer_name = _first_value(row, "manufacturer_name", "MANUFACTURER_NAME")
    manufacturer_address = _first_value(row, "manufacturer_address", "MANUFACTURER_ADDRESS")
    receiving_email = _first_value(row, "receiving_email", "RECEIVING_EMAIL")
    docking_instructions = _first_value(row, "docking_instructions", "DOCKING_INSTRUCTIONS")
    verification_status = _normalize_verification_status(
        _first_value(row, "verification_status", "VERIFICATION_STATUS")
    )
    source_note = _first_value(row, "source_note", "SOURCE_NOTE")
    is_active = _boolish(_first_value(row, "is_active", "IS_ACTIVE"), True)
    return {
        "id": _first_value(row, "id", "ROWID", "rowid"),
        "storefront": storefront,
        "dc": dc,
        "name": name,
        "ship_from": ship_from,
        "delivery_address": delivery_address,
        "billing_address": billing_address,
        "match_values": match_values,
        "address_type": address_roles[0] if address_roles else legacy_record_type,
        "address_roles": address_roles,
        "address": address,
        "record_type": record_type,
        "default_label_template_id": default_label_template_id,
        "manufacturer_name": manufacturer_name,
        "manufacturer_address": manufacturer_address,
        "receiving_email": receiving_email,
        "docking_instructions": docking_instructions,
        "verification_status": verification_status,
        "source_note": source_note,
        "is_active": is_active,
        "unique_key": _dc_directory_unique_key(
            dc,
            storefront,
            name,
            delivery_address,
            billing_address,
            match_values,
            record_type,
        ),
    }


def _dc_directory_base_key(dc: str, storefront: str = "") -> str:
    store = _normalize_storefront(storefront)
    return f"{store.strip().lower()}|{str(dc or '').strip().lower()}"


def _dc_directory_unique_key(
    dc: str,
    storefront: str = "",
    name: str = "",
    delivery_address: str = "",
    billing_address: str = "",
    match_values: Optional[List[str]] = None,
    record_type: str = "",
) -> str:
    base = _dc_directory_base_key(dc, storefront)
    normalized_roles = _parse_directory_roles(record_type)
    if normalized_roles:
        return f"{base}|{'+'.join(role.lower() for role in normalized_roles)}"
    return base


def _dedupe_dc_directory_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: Dict[str, Dict[str, Any]] = {}
    fallback_index = 0

    for raw in rows:
        row = normalize_dc_directory_row(raw)
        if not any([
            row.get("dc"),
            row.get("name"),
            row.get("delivery_address"),
            row.get("billing_address"),
            row.get("match_values"),
            row.get("default_label_template_id"),
            row.get("manufacturer_name"),
        ]):
            continue

        key = str(row.get("unique_key") or row.get("dc") or "").strip()
        if not key:
            fallback_index += 1
            key = f"row-{fallback_index}"

        deduped[key] = row

    return list(deduped.values())


def _kehe_dc_directory_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [row for row in _dedupe_dc_directory_rows(rows) if _is_kehe_storefront(row.get("storefront"))]
