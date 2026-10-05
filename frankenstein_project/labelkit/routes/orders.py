"""Order lookup route for Order Documents."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from labelkit.order_intake import (
    _analytics_case_conversion,
    _analytics_order_details,
    _analytics_order_item_fallback,
    _analytics_quantity,
    _analytics_row_value,
    _analytics_source_metadata,
    _canonical_order_sku,
    _partner_customer_id_from_order,
    _preferred_shared_level_sku_row,
    _product_each_gtin,
    _select_analytics_order_instance,
    _validated_sales_order_number,
)
from labelkit.product_store import _datastore_load_product_master, _shared_product_master_file_read
from labelkit.reference_data import _dedupe_product_master_rows, normalize_packaging_level
from labelkit.runtime import (
    ANALYTICS_CLIENT,
    ANALYTICS_QUANTITY_COLUMN,
    ANALYTICS_SKU_COLUMN,
    _require_permission,
)


router = APIRouter()


@router.post("/api/mpl/orders/lookup")
def lookup_mpl_order(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "generate")
    sales_order_number = _validated_sales_order_number(payload)
    requested_ecomdash_id = str(payload.get("ecomdash_id") or "").strip() if isinstance(payload, dict) else ""

    analytics_rows = ANALYTICS_CLIENT.export_order_rows(request, sales_order_number)
    if not analytics_rows:
        raise HTTPException(
            status_code=404,
            detail=f"No rows were found for Sales Order Number '{sales_order_number}'.",
        )

    product_rows = _datastore_load_product_master(request)
    product_source = "datastore"
    if product_rows is None:
        product_rows = _shared_product_master_file_read()
        product_source = "file"

    analytics_rows, selected_ecomdash_id, selection = _select_analytics_order_instance(
        analytics_rows,
        requested_ecomdash_id,
        sales_order_number,
        product_rows,
    )
    if selection is not None:
        return JSONResponse(content=selection)

    aggregated: Dict[str, Dict[str, Any]] = {}
    ignored_rows = 0
    for row in analytics_rows:
        sku = _analytics_row_value(row, ANALYTICS_SKU_COLUMN)
        quantity = _analytics_quantity(_analytics_row_value(row, ANALYTICS_QUANTITY_COLUMN))
        sku_key = _canonical_order_sku(sku)
        if not sku_key or quantity is None:
            ignored_rows += 1
            continue
        if sku_key not in aggregated:
            aggregated[sku_key] = {
                "sku": sku,
                "quantity_ordered": quantity,
                **_analytics_order_item_fallback(row, sku),
            }
        else:
            total = float(aggregated[sku_key]["quantity_ordered"]) + float(quantity)
            aggregated[sku_key]["quantity_ordered"] = int(total) if total.is_integer() else round(total, 6)
            fallback = _analytics_order_item_fallback(row, sku)
            for field, value in fallback.items():
                if value and not aggregated[sku_key].get(field):
                    aggregated[sku_key][field] = value

    if not aggregated:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Rows were found for order '{sales_order_number}', but none had both "
                f"'{ANALYTICS_SKU_COLUMN}' and a positive '{ANALYTICS_QUANTITY_COLUMN}'."
            ),
        )

    normalized_product_rows = _dedupe_product_master_rows(product_rows)
    eligible_products = [
        row
        for row in normalized_product_rows
        if bool(row.get("is_active", True))
    ]
    products_by_sku: Dict[str, List[Dict[str, Any]]] = {}
    for product in eligible_products:
        product_keys = {
            _canonical_order_sku(product.get("sku")),
            _canonical_order_sku(product.get("display_sku")),
        }
        for key in product_keys:
            if key:
                products_by_sku.setdefault(key, []).append(product)

    items: List[Dict[str, Any]] = []
    matched_count = 0
    ambiguous_count = 0
    converted_to_cases = 0
    partial_case_items = 0
    missing_each_gtin = 0
    defaulted_level_skus = 0
    for sku_key, order_item in aggregated.items():
        needs_match_review = False
        raw_candidates = products_by_sku.get(sku_key, [])
        candidates_by_group: Dict[str, List[Dict[str, Any]]] = {}
        for candidate in raw_candidates:
            group_key = "|".join([
                str(candidate.get("storefront") or "").strip().lower(),
                str(candidate.get("config_id") or candidate.get("sku") or "").strip().lower(),
            ])
            candidates_by_group.setdefault(group_key, []).append(candidate)
        candidates = list(candidates_by_group.values())
        if len(candidates) == 1:
            matched_count += 1
            match_status = "matched"
            matching_rows = candidates[0]
            product = next(
                (row for level in ("Case", "Inner Pack", "Each") for row in matching_rows if normalize_packaging_level(row.get("packaging_level")) == level),
                matching_rows[0],
            )
            exact_sku_rows = [row for row in matching_rows if _canonical_order_sku(row.get("sku")) == sku_key]
            exact_sku_levels = {
                normalize_packaging_level(row.get("packaging_level"))
                for row in exact_sku_rows
            }
            if len(exact_sku_levels) > 1:
                exact_sku_row = _preferred_shared_level_sku_row(exact_sku_rows, matching_rows)
                matched_level = normalize_packaging_level((exact_sku_row or {}).get("packaging_level"))
                needs_match_review = True
                defaulted_level_skus += 1
                match_reason_code = "shared_level_sku_defaulted"
                match_reason = (
                    f"SKU '{order_item.get('sku')}' is shared by {', '.join(sorted(exact_sku_levels))}. "
                    f"Incoming quantity defaulted to {matched_level}; assign distinct level SKUs when available."
                )
            else:
                exact_sku_row = exact_sku_rows[0] if exact_sku_rows else None
            if exact_sku_row is None:
                display_uom = normalize_packaging_level(matching_rows[0].get("display_sku_uom") or "Each")
                exact_sku_row = next(
                    (row for row in matching_rows if normalize_packaging_level(row.get("packaging_level")) == display_uom),
                    None,
                )
                if exact_sku_row is None:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Display SKU '{order_item.get('sku')}' represents {display_uom}, "
                            f"but that packaging level is not configured in Product Master."
                        ),
                    )
            matched_level = normalize_packaging_level(exact_sku_row.get("packaging_level"))
            if not needs_match_review:
                match_reason_code = "matched_level_sku" if _canonical_order_sku(exact_sku_row.get("sku")) == sku_key else "matched_display_sku"
                match_reason = (
                    f"Matched the {matched_level} SKU in Product Master."
                    if match_reason_code == "matched_level_sku"
                    else f"Matched the alternate incoming SKU and interpreted it as {matched_level}."
                )
        elif len(candidates) > 1:
            ambiguous_count += 1
            match_status = "ambiguous"
            product = None
            exact_sku_row = None
            match_reason_code = "ambiguous_product_groups"
            match_reason = "This SKU belongs to more than one Product Master configuration."
        else:
            match_status = "unmatched"
            product = None
            exact_sku_row = None
            match_reason_code = "no_product_master_sku"
            match_reason = "No active Product Master Level SKU matches this order line."
        converted_order_item = dict(order_item)
        try:
            matched_config_id = str((exact_sku_row or {}).get("config_id") or "").strip().lower()
            uses_level_specific_skus = bool(matched_config_id and any(
                normalize_packaging_level(row.get("packaging_level")) == "Each"
                and str(row.get("config_id") or "").strip().lower() == matched_config_id
                and str(row.get("storefront") or "").strip().lower() == str((exact_sku_row or {}).get("storefront") or "").strip().lower()
                for row in normalized_product_rows
            ))
            conversion = _analytics_case_conversion(
                order_item.get("quantity_ordered"),
                exact_sku_row,
                normalized_product_rows,
                quantity_is_matched_uom=uses_level_specific_skus,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if conversion:
            product = conversion.pop("outermost_product", product)
            converted_order_item.update(conversion)
            converted_to_cases += 1
            if not conversion.get("case_conversion_exact"):
                partial_case_items += 1
        each_gtin = _product_each_gtin(product, normalized_product_rows)
        if product is not None and not each_gtin:
            missing_each_gtin += 1
        items.append({
            **converted_order_item,
            "match_status": match_status,
            "match_reason_code": match_reason_code,
            "match_reason": match_reason,
            "needs_match_review": needs_match_review,
            "product": product,
            "each_gtin": each_gtin,
            "candidate_storefronts": sorted({
                str(candidate.get("storefront") or "").strip()
                for candidate_group in candidates
                for candidate in candidate_group
                if str(candidate.get("storefront") or "").strip()
            }),
            "candidate_config_ids": sorted({
                str(candidate.get("config_id") or candidate.get("sku") or "").strip()
                for candidate_group in candidates
                for candidate in candidate_group
                if str(candidate.get("config_id") or candidate.get("sku") or "").strip()
            }),
        })

    order_details = _analytics_order_details(analytics_rows)

    return JSONResponse(content={
        "sales_order_number": sales_order_number,
        "order_details": order_details,
        "detected_partner_customer": _partner_customer_id_from_order(order_details, items),
        "source": _analytics_source_metadata(
            ecomdash_id=selected_ecomdash_id,
            product_master=product_source,
        ),
        "summary": {
            "analytics_rows": len(analytics_rows),
            "line_items": len(items),
            "matched_products": matched_count,
            "unmatched_products": len(items) - matched_count - ambiguous_count,
            "ambiguous_products": ambiguous_count,
            "ignored_rows": ignored_rows,
            "converted_to_cases": converted_to_cases,
            "partial_case_items": partial_case_items,
            "missing_each_gtin": missing_each_gtin,
            "defaulted_level_skus": defaulted_level_skus,
        },
        "items": items,
    })
