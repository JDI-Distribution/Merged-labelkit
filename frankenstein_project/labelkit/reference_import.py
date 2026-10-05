"""Excel/CSV import preview helpers for Product Master and Directory."""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from labelkit.audit_log import _audit_value, _dc_row_key, _normalized_for_audit, _product_row_key, _row_label
from labelkit.directory_store import _datastore_load_dc_directory, _shared_dc_directory_file_read
from labelkit.file_operations import MAX_UPLOAD_BYTES
from labelkit.product_quality import analyze_product_master_rows
from labelkit.product_store import _datastore_load_product_master, _shared_product_master_file_read
from labelkit.reference_data import (
    DEFAULT_DIRECTORY_SHIP_FROM,
    _dedupe_dc_directory_rows,
    _dedupe_product_master_rows,
    _format_decimal_string,
    _kehe_dc_directory_rows,
    _kehe_product_master_rows,
    _parse_decimal_value,
)
from labelkit.runtime import _require_permission
from labelkit.spreadsheets import _read_spreadsheet_bytes


def _canonical_import_key(header: str, table: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", str(header or "").strip().lower()).strip("_")
    product_aliases = {
        "storefront": "storefront",
        "store_front": "storefront",
        "store": "storefront",
        "storefront_customer": "storefront",
        "customer": "storefront",
        "customer_storefront": "storefront",
        # Transitional legacy headings are converted during normalization and
        # are never persisted or exported.
        "in_packing_list": "legacy_in_packing_list",
        "in_packing_list_": "legacy_in_packing_list",
        "packing_list": "legacy_in_packing_list",
        "include_in_packing_list": "legacy_in_packing_list",
        "include_mpl": "legacy_in_packing_list",
        "label_required": "legacy_label_required",
        "label": "legacy_label_required",
        "gtin": "gtin",
        "case_upc": "gtin",
        "upc": "gtin",
        "description": "description",
        "item_description": "description",
        "product_description": "description",
        "product_status": "verification_status",
        "packaging_level": "packaging_level",
        "packging_level": "packaging_level",
        "level": "packaging_level",
        "l_x_w_x_h_in": "dimensions_in",
        "dimensions": "dimensions_in",
        "dimensions_in": "dimensions_in",
        "lwh_in": "dimensions_in",
        "weight_lbs": "gross_weight_lbs",
        "weight": "gross_weight_lbs",
        "weight_lbs_": "gross_weight_lbs",
        "case_qty": "case_qty",
        "case_quantity": "case_qty",
        "units_per_case": "case_qty",
        "eaches_package": "case_qty",
        "eaches_per_package": "case_qty",
        "eaches_case": "case_qty",
        "eaches_per_case": "case_qty",
        "eaches_inner_pack": "case_qty",
        "eaches_per_inner_pack": "case_qty",
        "eaches_contained": "case_qty",
        "labels_unit": "default_copies",
        "labels_per_unit": "default_copies",
        "labels_to_print_per_unit": "default_copies",
        "sku": "sku",
        "level_sku": "sku",
        "item_number": "sku",
        "ecomdash_sku": "sku",
        "display_sku": "display_sku",
        "display_item_number": "display_sku",
        "display_sku_uom": "display_sku_uom",
        "incoming_uom": "display_sku_uom",
        "display_sku_represents": "display_sku_uom",
        "display_sku_unit": "display_sku_uom",
        "inner_packs_per_case": "inner_packs_per_case",
        "inners_per_case": "inner_packs_per_case",
        "config_id": "config_id",
        "product_sku": "config_id",
        "product_group_id": "config_id",
        "configuration_id": "config_id",
        "internal_configuration_id": "config_id",
        "customer_item_number": "customer_item_number",
        "customer_item": "customer_item_number",
        "label_template_id": "label_template_id",
        "template_id": "label_template_id",
        "barcode_type": "barcode_type",
        "barcode_encoding": "barcode_type",
        "barcode_level": "barcode_level",
        "length_in": "length_in",
        "level_length_in": "length_in",
        "width_in": "width_in",
        "level_width_in": "width_in",
        "width_breadth_in": "width_in",
        "breadth_in": "width_in",
        "breadth": "width_in",
        "height_in": "height_in",
        "level_height_in": "height_in",
        "final_length_in": "length_in",
        "final_width_in": "width_in",
        "final_width_breadth_in": "width_in",
        "final_height_in": "height_in",
        "each_net_weight_g": "each_net_weight_g",
        "each_net_weight_g_product_only": "each_net_weight_g",
        "each_weight_g": "each_net_weight_g",
        "each_net_weight": "each_net_weight",
        "each_weight_unit": "each_weight_unit",
        "packaging_tare_weight": "packaging_tare_weight",
        "packaging_weight_unit": "packaging_weight_unit",
        "package_net_weight_g": "package_net_weight_g",
        "package_net_weight_g_product_only": "package_net_weight_g",
        "total_product_weight_g": "package_net_weight_g",
        "gross_weight_lbs": "gross_weight_lbs",
        "packaged_weight_lb": "gross_weight_lbs",
        "gross_weight_lbs_product_packaging": "gross_weight_lbs",
        "total_weight_with_packaging_lb": "gross_weight_lbs",
        "default_copies": "default_copies",
        "verification_status": "verification_status",
        "label_enabled": "label_enabled",
        "source_note": "source_note",
        "is_active": "is_active",
        "active": "is_active",
        "level_active": "is_active",
    }
    directory_aliases = {
        "storefront": "storefront",
        "store_front": "storefront",
        "store": "storefront",
        "customer": "storefront",
        "customer_storefront": "storefront",
        "dc": "dc",
        "code": "dc",
        "location_code": "dc",
        "name": "name",
        "dc_name": "name",
        "destination_name": "name",
        "address_name": "name",
        "address_type": "address_type",
        "address_roles": "address_roles",
        "address_role": "address_roles",
        "roles": "address_roles",
        "address": "address",
        "ship_from": "ship_from",
        "ship_from_address": "ship_from",
        "ship_from_override": "ship_from",
        "delivery_address": "delivery_address",
        "ship_to": "delivery_address",
        "ship_to_address": "delivery_address",
        "billing_address": "billing_address",
        "bill_to": "billing_address",
        "bill_to_address": "billing_address",
        "match_values": "match_values",
        "matching_values": "match_values",
        "gln": "match_values",
        "record_type": "record_type",
        "default_label_template_id": "default_label_template_id",
        "default_label_template": "default_label_template_id",
        "manufacturer_name": "manufacturer_name",
        "manufacturer_address": "manufacturer_address",
        "receiving_email": "receiving_email",
        "docking_instructions": "docking_instructions",
        "verification_status": "verification_status",
        "source_note": "source_note",
        "is_active": "is_active",
    }
    aliases = {
        "kehe_product_master": product_aliases,
        "mpl_product_master": product_aliases,
        "kehe_dc_directory": directory_aliases,
        "mpl_directory": directory_aliases,
    }
    return aliases.get(table, {}).get(key, key)


def _is_import_usage_guide_row(row: Dict[str, Any]) -> bool:
    """Recognize human-readable guide rows shipped in import templates."""
    first_value = next((str(value or "").strip() for value in row.values() if str(value or "").strip()), "")
    normalized = re.sub(r"[^a-z0-9]+", " ", first_value.lower()).strip()
    return normalized.startswith("usage guide") or normalized.startswith("guide not imported")


def _weight_to_grams(value: Any, unit: Any) -> Optional[float]:
    parsed = _parse_decimal_value(value)
    if parsed is None:
        return None
    unit_key = str(unit or "g").strip().lower().replace(".", "")
    factor = {
        "g": 1.0,
        "gram": 1.0,
        "grams": 1.0,
        "kg": 1000.0,
        "kilogram": 1000.0,
        "kilograms": 1000.0,
        "lb": 453.59237,
        "lbs": 453.59237,
        "pound": 453.59237,
        "pounds": 453.59237,
        "oz": 28.349523125,
        "ounce": 28.349523125,
        "ounces": 28.349523125,
    }.get(unit_key)
    return parsed * factor if factor is not None else None


def _adapt_product_template_weights(row: Dict[str, Any]) -> Dict[str, Any]:
    """Convert the template's unit-aware weights into the app's stored units."""
    adapted = dict(row)
    each_grams = _weight_to_grams(adapted.get("each_net_weight"), adapted.get("each_weight_unit"))
    tare_grams = _weight_to_grams(adapted.get("packaging_tare_weight"), adapted.get("packaging_weight_unit"))
    eaches = _parse_decimal_value(adapted.get("case_qty"))

    if not str(adapted.get("each_net_weight_g") or "").strip() and each_grams is not None:
        adapted["each_net_weight_g"] = _format_decimal_string(each_grams)
    if each_grams is not None and eaches is not None:
        package_net_grams = each_grams * eaches
        if not str(adapted.get("package_net_weight_g") or "").strip():
            adapted["package_net_weight_g"] = _format_decimal_string(package_net_grams)
        if not str(adapted.get("gross_weight_lbs") or "").strip():
            gross_grams = package_net_grams + (tare_grams or 0.0)
            adapted["gross_weight_lbs"] = _format_decimal_string(gross_grams / 453.59237)
    return adapted


def _canonicalize_import_rows(rows: List[Dict[str, Any]], table: str) -> List[Dict[str, Any]]:
    canonical_rows: List[Dict[str, Any]] = []
    for row in rows:
        if _is_import_usage_guide_row(row):
            continue
        next_row: Dict[str, Any] = {}
        for key, value in row.items():
            next_row[_canonical_import_key(key, table)] = value
        if table in {"kehe_product_master", "mpl_product_master"}:
            next_row = _adapt_product_template_weights(next_row)
        canonical_rows.append(next_row)
    if table == "kehe_product_master":
        return _kehe_product_master_rows(canonical_rows)
    if table == "mpl_product_master":
        return _dedupe_product_master_rows(canonical_rows)
    if table == "kehe_dc_directory":
        return _kehe_dc_directory_rows(canonical_rows)
    if table == "mpl_directory":
        return _dedupe_dc_directory_rows(canonical_rows)
    return canonical_rows


def _preview_row_changes(
    *,
    table: str,
    current_rows: List[Dict[str, Any]],
    imported_rows: List[Dict[str, Any]],
    key_fn: Any,
) -> Dict[str, Any]:
    current_by_key = {key_fn(row): _normalized_for_audit(table, row) for row in current_rows}
    changes: List[Dict[str, Any]] = []
    added = updated = unchanged = 0

    for raw_row in imported_rows:
        key = key_fn(raw_row)
        imported = _normalized_for_audit(table, raw_row)
        current = current_by_key.get(key)
        if current is None:
            added += 1
            changes.append({
                "action": "add",
                "record_key": key,
                "record_label": _row_label(table, raw_row),
                "field": "__row__",
                "old_value": "",
                "new_value": _audit_value(imported),
            })
            continue

        row_changed = False
        for field in sorted(set(current) | set(imported)):
            old_value = _audit_value(current.get(field))
            new_value = _audit_value(imported.get(field))
            if old_value == new_value:
                continue
            row_changed = True
            changes.append({
                "action": "update",
                "record_key": key,
                "record_label": _row_label(table, raw_row),
                "field": field,
                "old_value": old_value,
                "new_value": new_value,
            })
        if row_changed:
            updated += 1
        else:
            unchanged += 1

    return {
        "summary": {
            "imported_rows": len(imported_rows),
            "added_rows": added,
            "updated_rows": updated,
            "unchanged_rows": unchanged,
            "change_count": len(changes),
        },
        "changes": changes,
    }


def _merge_import_rows(current_rows: List[Dict[str, Any]], imported_rows: List[Dict[str, Any]], key_fn: Any) -> List[Dict[str, Any]]:
    imported_by_key = {key_fn(row): row for row in imported_rows}
    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for row in current_rows:
        key = key_fn(row)
        if key in imported_by_key:
            merged.append(imported_by_key[key])
            seen.add(key)
        else:
            merged.append(row)
    for key, row in imported_by_key.items():
        if key not in seen:
            merged.append(row)
    return merged


def _apply_shared_directory_ship_from(
    imported_rows: List[Dict[str, Any]],
    current_rows: List[Dict[str, Any]],
) -> None:
    """Apply the current default origin while preserving explicit import overrides."""
    origin_counts: Dict[str, int] = {}
    for row in current_rows:
        origin = str(row.get("ship_from") or "").strip()
        if origin:
            origin_counts[origin] = origin_counts.get(origin, 0) + 1
    shared_ship_from = max(
        origin_counts,
        key=lambda origin: (origin_counts[origin], origin == DEFAULT_DIRECTORY_SHIP_FROM),
        default=DEFAULT_DIRECTORY_SHIP_FROM,
    )
    for row in imported_rows:
        if str(row.get("ship_from") or "").strip() in {"", DEFAULT_DIRECTORY_SHIP_FROM}:
            row["ship_from"] = shared_ship_from


async def _preview_excel_import(request: Request, upload: UploadFile, table: str) -> JSONResponse:
    _require_permission(request, "table_crud")
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    await upload.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Import file exceeds the 50 MB upload limit.")
    raw_rows = _read_spreadsheet_bytes(upload.filename or "upload.xlsx", data)
    # Normalize one row at a time so duplicate upload rows remain visible in
    # the preview and can be deselected instead of disappearing silently.
    imported_rows: List[Dict[str, Any]] = []
    import_quality_rows: List[Dict[str, Any]] = []
    for raw_row in raw_rows:
        if _is_import_usage_guide_row(raw_row):
            continue
        if table == "mpl_product_master":
            quality_row = {
                _canonical_import_key(key, table): value
                for key, value in raw_row.items()
            }
            import_quality_rows.append(_adapt_product_template_weights(quality_row))
        imported_rows.extend(_canonicalize_import_rows([raw_row], table))
    if table in {"kehe_product_master", "mpl_product_master"}:
        current_rows = _datastore_load_product_master(request)
        if current_rows is None:
            current_rows = _shared_product_master_file_read()
        if table == "kehe_product_master":
            current_rows = _kehe_product_master_rows(current_rows)
        else:
            current_rows = _dedupe_product_master_rows(current_rows)
        key_fn = _product_row_key
    else:
        current_rows = _datastore_load_dc_directory(request)
        if current_rows is None:
            current_rows = _shared_dc_directory_file_read()
        if table == "kehe_dc_directory":
            current_rows = _kehe_dc_directory_rows(current_rows)
        else:
            current_rows = _dedupe_dc_directory_rows(current_rows)
        if table == "mpl_directory":
            _apply_shared_directory_ship_from(imported_rows, current_rows)
        key_fn = _dc_row_key

    preview = _preview_row_changes(
        table=table,
        current_rows=current_rows,
        imported_rows=imported_rows,
        key_fn=key_fn,
    )
    quality = analyze_product_master_rows(import_quality_rows) if table == "mpl_product_master" else None
    if quality:
        preview["summary"].update({
            "duplicate_rows": quality["summary"]["duplicate_rows"],
            "invalid_rows": quality["summary"]["invalid_rows"],
            "needs_review_rows": quality["summary"]["needs_review_rows"],
        })
    batch_id = uuid.uuid4().hex
    return JSONResponse(content={
        "batch_id": batch_id,
        "filename": upload.filename,
        "table": table,
        "rows": imported_rows,
        "quality": quality,
        **preview,
    })
