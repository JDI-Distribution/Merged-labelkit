"""Zoho Analytics order-row normalization and Product Master matching."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from labelkit.customer_workflows import detect_customer_id
from labelkit.reference_data import (
    _dedupe_product_master_rows,
    _is_kehe_storefront,
    _normalize_storefront,
    normalize_packaging_level,
    normalize_product_master_row,
)

ANALYTICS_SKU_COLUMN = "SKUNumber"
ANALYTICS_QUANTITY_COLUMN = "Quantity Ordered"
ANALYTICS_CUSTOMER_EMAIL_COLUMN = "Email"
ANALYTICS_ITEM_DESCRIPTION_COLUMNS = ("Product Name", "Item Description", "Description")
ANALYTICS_ITEM_NUMBER_COLUMNS = ("Item Number", "Customer Item Number")
ANALYTICS_ITEM_GTIN_COLUMNS = ("GTIN", "UPC", "UPC Code", "Barcode")
ANALYTICS_ITEM_UNIT_WEIGHT_COLUMNS = (
    "Unit Weight Lbs", "Unit Weight", "Item Weight Lbs", "Item Weight", "Gross Weight Lbs",
)
ANALYTICS_ITEM_PALLET_WEIGHT_COLUMNS = ("Pallet Weight Lbs", "Pallet Weight")
ANALYTICS_ORDER_INSTANCE_ID_COLUMN = "Ecomdash ID"
ANALYTICS_ORDER_INSTANCE_DATE_COLUMN = "Invoice Date"
ANALYTICS_ORDER_INSTANCE_STOREFRONT_COLUMN = "Storefront"
ANALYTICS_ORDER_DETAIL_COLUMNS: Dict[str, str] = {}
ANALYTICS_ORDER_SOURCE = "zoho_analytics"
ANALYTICS_LOCAL_SOURCE_VALUES: set[str] = set()
ANALYTICS_LOCAL_FILE: Optional[Path] = None
ANALYTICS_CONNECTION_LINK_NAME = ""
ANALYTICS_WORKSPACE_ID = ""
ANALYTICS_VIEW_ID = ""
ANALYTICS_VIEW_NAME = ""
CUSTOMER_WORKFLOWS: List[Dict[str, Any]] = []


def configure_order_intake(**values: Any) -> None:
    """Bind deployment-configured column names and source metadata once at startup."""
    globals_dict = globals()
    for name, value in values.items():
        if name in globals_dict:
            globals_dict[name] = value

def _analytics_row_value(row: Dict[str, Any], column_name: str) -> str:
    wanted = str(column_name or "").strip().lower()
    for key, value in row.items():
        if str(key or "").strip().lower() == wanted:
            return str(value or "").strip()
    return ""


def _analytics_first_row_value(row: Dict[str, Any], column_names: Tuple[str, ...]) -> str:
    for column_name in column_names:
        value = _analytics_row_value(row, column_name)
        if value:
            return value
    return ""


def _analytics_order_details(rows: List[Dict[str, Any]]) -> Dict[str, str]:
    return {
        field_name: next(
            (
                value
                for row in rows
                if (value := _analytics_row_value(row, column_name))
            ),
            "",
        )
        for field_name, column_name in ANALYTICS_ORDER_DETAIL_COLUMNS.items()
    }


def _partner_customer_id_from_text(value: Any) -> str:
    return detect_customer_id(value, CUSTOMER_WORKFLOWS)


def _analytics_order_item_fallback(row: Dict[str, Any], sku: str) -> Dict[str, str]:
    """Keep usable line data when Product Master has no matching SKU.

    Values come only from the order export. SKU is the visible Item Number
    fallback; identifiers, weights, and descriptions are never guessed.
    """
    order_item_number = _analytics_first_row_value(row, ANALYTICS_ITEM_NUMBER_COLUMNS)
    return {
        "item_number": order_item_number or str(sku or "").strip(),
        "customer_item_number": order_item_number or str(sku or "").strip(),
        "description": _analytics_first_row_value(row, ANALYTICS_ITEM_DESCRIPTION_COLUMNS),
        "gtin": _analytics_first_row_value(row, ANALYTICS_ITEM_GTIN_COLUMNS),
        "unit_weight_lbs": _analytics_first_row_value(row, ANALYTICS_ITEM_UNIT_WEIGHT_COLUMNS),
        "pallet_weight": _analytics_first_row_value(row, ANALYTICS_ITEM_PALLET_WEIGHT_COLUMNS),
        "storefront": _analytics_row_value(row, ANALYTICS_ORDER_INSTANCE_STOREFRONT_COLUMN),
    }


def _canonical_order_sku(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if re.fullmatch(r"\d+(?:\.0+)?", raw):
        raw = raw.split(".", 1)[0].lstrip("0") or "0"
    return re.sub(r"[\s_-]+", "", raw)


def _canonical_order_number(value: Any) -> str:
    raw = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", raw):
        raw = raw.split(".", 1)[0]
    return raw.casefold()


def _analytics_order_instance_groups(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}
    group_order: List[str] = []
    for row in rows:
        raw_ecomdash_id = _analytics_row_value(row, ANALYTICS_ORDER_INSTANCE_ID_COLUMN)
        canonical_ecomdash_id = _canonical_order_number(raw_ecomdash_id)
        invoice_date = _analytics_row_value(row, ANALYTICS_ORDER_INSTANCE_DATE_COLUMN)
        storefront = _analytics_row_value(row, ANALYTICS_ORDER_INSTANCE_STOREFRONT_COLUMN)
        email_id = _analytics_row_value(row, ANALYTICS_CUSTOMER_EMAIL_COLUMN)
        billing_customer_name = _analytics_row_value(row, "Billing Customer Name")
        if canonical_ecomdash_id:
            group_key = f"ecomdash:{canonical_ecomdash_id}"
        else:
            group_key = "missing:" + "|".join([
                invoice_date.casefold(),
                storefront.casefold(),
                email_id.casefold(),
                billing_customer_name.casefold(),
            ])
        if group_key not in groups:
            groups[group_key] = {
                "key": group_key,
                "ecomdash_id": raw_ecomdash_id,
                "storefront": storefront,
                "email_id": email_id,
                "billing_customer_name": billing_customer_name,
                "invoice_date": invoice_date,
                "rows": [],
            }
            group_order.append(group_key)
        groups[group_key]["rows"].append(row)

    instances: List[Dict[str, Any]] = []
    for group_key in group_order:
        group = groups[group_key]
        sku_keys = {
            _canonical_order_sku(_analytics_row_value(row, ANALYTICS_SKU_COLUMN))
            for row in group["rows"]
            if _canonical_order_sku(_analytics_row_value(row, ANALYTICS_SKU_COLUMN))
        }
        group["line_count"] = len(group["rows"])
        group["sku_count"] = len(sku_keys)
        instances.append(group)
    return instances


def _analytics_order_instance_summary(instance: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "ecomdash_id": instance.get("ecomdash_id", ""),
        "storefront": instance.get("storefront", ""),
        "email_id": instance.get("email_id", ""),
        "billing_customer_name": instance.get("billing_customer_name", ""),
        "invoice_date": instance.get("invoice_date", ""),
        "line_count": instance.get("line_count", 0),
        "sku_count": instance.get("sku_count", 0),
    }


def _validated_sales_order_number(payload: Any) -> str:
    sales_order_number = str(payload.get("sales_order_number") or "").strip() if isinstance(payload, dict) else ""
    if not sales_order_number:
        raise HTTPException(status_code=400, detail="Sales Order Number is required.")
    if len(sales_order_number) > 120 or any(ord(char) < 32 for char in sales_order_number):
        raise HTTPException(status_code=400, detail="Sales Order Number is invalid.")
    return sales_order_number


def _analytics_source_metadata(**extra: Any) -> Dict[str, Any]:
    local_file_source = ANALYTICS_ORDER_SOURCE in ANALYTICS_LOCAL_SOURCE_VALUES
    source = {
        "service": "local_file" if local_file_source else "zoho_analytics",
        "connection": "" if local_file_source else ANALYTICS_CONNECTION_LINK_NAME,
        "local_file": ANALYTICS_LOCAL_FILE.name if local_file_source and ANALYTICS_LOCAL_FILE else "",
        "workspace_id": ANALYTICS_WORKSPACE_ID,
        "view_id": ANALYTICS_VIEW_ID,
        "view_name": ANALYTICS_VIEW_NAME,
    }
    source.update(extra)
    return source


def _select_analytics_order_instance(
    analytics_rows: List[Dict[str, Any]],
    requested_ecomdash_id: str,
    sales_order_number: str,
) -> tuple[List[Dict[str, Any]], str, Optional[Dict[str, Any]]]:
    """Select one reused sales-order instance or return selector response data."""
    order_instances = _analytics_order_instance_groups(analytics_rows)
    if requested_ecomdash_id:
        wanted_ecomdash_id = _canonical_order_number(requested_ecomdash_id)
        selected = next(
            (
                instance
                for instance in order_instances
                if _canonical_order_number(instance.get("ecomdash_id")) == wanted_ecomdash_id
            ),
            None,
        )
        if selected is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Ecomdash ID '{requested_ecomdash_id}' was not found for "
                    f"Sales Order Number '{sales_order_number}'."
                ),
            )
        return selected["rows"], str(selected.get("ecomdash_id") or ""), None

    if len(order_instances) > 1:
        selection = {
            "sales_order_number": sales_order_number,
            "requires_order_selection": True,
            "order_instances": [_analytics_order_instance_summary(instance) for instance in order_instances],
            "source": _analytics_source_metadata(),
        }
        return analytics_rows, "", selection

    if order_instances:
        selected = order_instances[0]
        return selected["rows"], str(selected.get("ecomdash_id") or ""), None
    return analytics_rows, "", None


def _analytics_quantity(value: Any) -> Optional[float | int]:
    raw = str(value or "").strip().replace(",", "")
    if not raw:
        return None
    try:
        quantity = float(raw)
    except (TypeError, ValueError):
        return None
    if quantity <= 0 or quantity != quantity:
        return None
    return int(quantity) if quantity.is_integer() else round(quantity, 6)


def _b2b_analytics_order_items_for_products(
    analytics_rows: List[Dict[str, Any]],
    product_rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    aggregated: Dict[str, Dict[str, Any]] = {}
    for row in analytics_rows:
        sku = _analytics_row_value(row, ANALYTICS_SKU_COLUMN)
        quantity = _analytics_quantity(_analytics_row_value(row, ANALYTICS_QUANTITY_COLUMN))
        sku_key = _canonical_order_sku(sku)
        if not sku_key or quantity is None:
            continue
        if sku_key not in aggregated:
            aggregated[sku_key] = {
                "sku": sku,
                "quantity_ordered": quantity,
                **_analytics_order_item_fallback(row, sku),
            }
        else:
            aggregated[sku_key]["quantity_ordered"] = float(aggregated[sku_key]["quantity_ordered"]) + float(quantity)
            fallback = _analytics_order_item_fallback(row, sku)
            for field, value in fallback.items():
                if value and not aggregated[sku_key].get(field):
                    aggregated[sku_key][field] = value

    normalized_product_rows = _dedupe_product_master_rows(product_rows)
    products_by_sku: Dict[str, List[Dict[str, Any]]] = {}
    for product in normalized_product_rows:
        if not bool(product.get("is_active", True)):
            continue
        sku_keys = {
            _canonical_order_sku(product.get("sku")),
            _canonical_order_sku(product.get("display_sku")),
        }
        for product_sku_key in sku_keys:
            if product_sku_key:
                products_by_sku.setdefault(product_sku_key, []).append(product)

    items: List[Dict[str, Any]] = []
    for sku_key, order_item in aggregated.items():
        raw_candidates = products_by_sku.get(sku_key, [])
        candidates_by_group: Dict[str, List[Dict[str, Any]]] = {}
        for candidate in raw_candidates:
            group_key = "|".join([
                str(candidate.get("storefront") or "").strip().lower(),
                str(candidate.get("config_id") or candidate.get("sku") or "").strip().lower(),
            ])
            candidates_by_group.setdefault(group_key, []).append(candidate)
        candidates = list(candidates_by_group.values())
        if len(candidates) > 1:
            match_status = "ambiguous"
            product = None
        elif len(candidates) == 1:
            matching_rows = candidates[0]
            product = next((row for row in matching_rows if _canonical_order_sku(row.get("sku")) == sku_key), None)
            if product is None:
                display_uom = normalize_packaging_level(matching_rows[0].get("display_sku_uom") or "Each")
                product = next((row for row in matching_rows if normalize_packaging_level(row.get("packaging_level")) == display_uom), None)
            match_status = "matched" if product is not None else "unmatched"
        else:
            match_status = "unmatched"
            product = None

        converted_order_item = dict(order_item)
        if product is not None:
            matched_config_id = str(product.get("config_id") or "").strip().lower()
            uses_level_specific_skus = bool(matched_config_id and any(
                normalize_packaging_level(row.get("packaging_level")) == "Each"
                and str(row.get("config_id") or "").strip().lower() == matched_config_id
                and str(row.get("storefront") or "").strip().lower() == str(product.get("storefront") or "").strip().lower()
                for row in normalized_product_rows
            ))
            if uses_level_specific_skus:
                conversion = _analytics_case_conversion(
                    order_item.get("quantity_ordered"),
                    product,
                    normalized_product_rows,
                    quantity_is_matched_uom=True,
                )
                if conversion:
                    product = conversion.pop("outermost_product", product)
                    converted_order_item.update(conversion)

        item = {
            **converted_order_item,
            "quantity_ordered": int(converted_order_item["quantity_ordered"]) if float(converted_order_item["quantity_ordered"]).is_integer() else round(float(converted_order_item["quantity_ordered"]), 6),
            "match_status": match_status,
            "product": product,
        }
        if product is not None:
            item["label_template_id"] = str(product.get("label_template_id") or "")
        items.append(item)
    return items


def _analytics_case_conversion(
    quantity_ordered: Any,
    product: Optional[Dict[str, Any]],
    packaging_rows: Optional[List[Dict[str, Any]]] = None,
    *,
    quantity_is_matched_uom: bool = False,
) -> Optional[Dict[str, Any]]:
    """Convert the matched SKU unit to the configuration's outermost unit."""
    ordered_quantity = _analytics_quantity(quantity_ordered)
    if ordered_quantity is None or not isinstance(product, dict):
        return None

    normalized_product = normalize_product_master_row(product)
    if not str(product.get("packaging_level") or product.get("PACKAGING_LEVEL") or "").strip() and float(_analytics_quantity(product.get("case_qty")) or 0) > 1:
        normalized_product["packaging_level"] = "Case"
    wanted_storefront = _normalize_storefront(normalized_product.get("storefront")).lower()
    wanted_config = str(normalized_product.get("config_id") or "").strip().lower()
    wanted_sku = _canonical_order_sku(normalized_product.get("sku"))
    group_rows: List[Dict[str, Any]] = []
    for raw_row in packaging_rows or []:
        row = normalize_product_master_row(raw_row)
        if _normalize_storefront(row.get("storefront")).lower() != wanted_storefront:
            continue
        same_group = bool(wanted_config) and str(row.get("config_id") or "").strip().lower() == wanted_config
        legacy_group = not wanted_config and _canonical_order_sku(row.get("sku")) == wanted_sku
        if same_group or legacy_group:
            group_rows.append(row)
    product_identity = (
        str(normalized_product.get("config_id") or "").strip().lower(),
        normalize_packaging_level(normalized_product.get("packaging_level")),
        _canonical_order_sku(normalized_product.get("sku")),
    )
    if not any((str(row.get("config_id") or "").strip().lower(), normalize_packaging_level(row.get("packaging_level")), _canonical_order_sku(row.get("sku"))) == product_identity for row in group_rows):
        group_rows.append(normalized_product)

    by_level = {normalize_packaging_level(row.get("packaging_level")): row for row in group_rows}
    outermost = by_level.get("Case") or by_level.get("Inner Pack") or by_level.get("Each") or normalized_product
    matched_level = normalize_packaging_level(normalized_product.get("packaging_level")) if quantity_is_matched_uom else "Each"
    outer_level = normalize_packaging_level(outermost.get("packaging_level"))
    input_eaches = 1.0 if matched_level == "Each" else float(_analytics_quantity(normalized_product.get("case_qty")) or 1)
    outer_eaches = 1.0 if outer_level == "Each" else float(_analytics_quantity(outermost.get("case_qty")) or 1)
    if not quantity_is_matched_uom and outer_eaches <= 1:
        return None
    ordered_eaches = float(ordered_quantity) * input_eaches
    raw_outer_quantity = ordered_eaches / outer_eaches
    nearest_whole = round(raw_outer_quantity)
    exact_multiple = abs(raw_outer_quantity - nearest_whole) < 1e-9
    if not exact_multiple and "fancy" in wanted_storefront:
        raise ValueError(
            f"Fancy Sprinkles SKU '{product.get('sku')}' quantity {ordered_quantity:g} "
            f"does not divide exactly into the configured {outer_level} quantity of {outer_eaches:g}."
        )
    outer_quantity = int(nearest_whole if exact_multiple else math.ceil(raw_outer_quantity))
    full_units = math.floor(raw_outer_quantity)
    remainder_eaches_value = 0.0 if exact_multiple else ordered_eaches - (full_units * outer_eaches)
    remainder_eaches: float | int = (
        int(round(remainder_eaches_value))
        if abs(remainder_eaches_value - round(remainder_eaches_value)) < 1e-9
        else round(remainder_eaches_value, 6)
    )

    inner_row = by_level.get("Inner Pack")
    eaches_per_inner_pack = _analytics_quantity((inner_row or {}).get("case_qty"))
    inner_packs_per_case = _analytics_quantity((by_level.get("Case") or {}).get("inner_packs_per_case"))
    if inner_packs_per_case is None and eaches_per_inner_pack and outer_level == "Case":
        calculated_inners = outer_eaches / float(eaches_per_inner_pack)
        nearest_inners = round(calculated_inners)
        inner_packs_per_case = int(nearest_inners) if abs(calculated_inners - nearest_inners) < 1e-9 else round(calculated_inners, 6)

    return {
        "quantity_ordered_eaches": int(ordered_eaches) if ordered_eaches.is_integer() else round(ordered_eaches, 6),
        "quantity_ordered_cases": outer_quantity,
        "quantity_ordered": outer_quantity,
        "quantity_uom": outer_level.upper().replace(" ", "_"),
        "source_packaging_level": matched_level,
        "outermost_packaging_level": outer_level,
        "eaches_per_inner_pack": eaches_per_inner_pack,
        "inner_packs_per_case": inner_packs_per_case,
        "eaches_per_case": outer_eaches if outer_level == "Case" else None,
        "case_pack_source": "product_master",
        "case_conversion_exact": exact_multiple,
        "case_conversion_remainder_eaches": remainder_eaches,
        "outermost_product": outermost,
    }


def _analytics_kehe_case_conversion(
    quantity_ordered: Any,
    product: Optional[Dict[str, Any]],
    packaging_rows: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Backward-compatible KeHE-only conversion helper used by older callers."""
    if not isinstance(product, dict) or not _is_kehe_storefront(product.get("storefront")):
        return None
    return _analytics_case_conversion(quantity_ordered, product, packaging_rows)


def _product_each_gtin(
    product: Optional[Dict[str, Any]],
    packaging_rows: Optional[List[Dict[str, Any]]],
) -> str:
    """Return the unique Each GTIN in the Case row's Storefront + SKU group."""
    if not isinstance(product, dict):
        return ""
    normalized_product = normalize_product_master_row(product)
    wanted_sku = _canonical_order_sku(normalized_product.get("sku"))
    wanted_config = str(normalized_product.get("config_id") or "").strip().lower()
    wanted_storefront = _normalize_storefront(normalized_product.get("storefront")).lower()
    if not wanted_sku:
        return ""

    matches: Dict[str, str] = {}
    for raw_row in packaging_rows or []:
        row = normalize_product_master_row(raw_row)
        if normalize_packaging_level(row.get("packaging_level")) != "Each":
            continue
        same_group = bool(wanted_config) and str(row.get("config_id") or "").strip().lower() == wanted_config
        legacy_group = not wanted_config and _canonical_order_sku(row.get("sku")) == wanted_sku
        if not (same_group or legacy_group):
            continue
        if _normalize_storefront(row.get("storefront")).lower() != wanted_storefront:
            continue
        gtin = str(row.get("gtin") or "").strip()
        if gtin:
            matches.setdefault(re.sub(r"\D", "", gtin).lstrip("0") or gtin.lower(), gtin)
    return next(iter(matches.values())) if len(matches) == 1 else ""
