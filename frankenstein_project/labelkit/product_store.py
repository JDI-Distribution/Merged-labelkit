"""Product Master persistence (local JSON and Catalyst datastore)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request
from labelkit.catalyst import replace_rows

from labelkit.audit_log import _product_row_key
from labelkit.reference_data import (
    _dedupe_product_master_rows,
    _parse_decimal_value,
    normalize_product_master_row,
    _prepare_product_configurations,
    _validate_configuration_rows,
)
from labelkit.runtime import (
    MPL_PRODUCT_MASTER_FILE,
    MPL_PRODUCT_MASTER_STORE,
    MPL_PRODUCT_MASTER_TABLE,
    _read_reference_datastore,
    _product_datastore_table,
    _raise_datastore_unavailable,
    _write_json_atomic,
)


def _product_master_file_read(file_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    path = file_path or MPL_PRODUCT_MASTER_FILE
    try:
        if not path.exists():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("rows") if isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise ValueError("Expected a list of product records.")
        if any(not isinstance(row, dict) for row in rows):
            raise ValueError("Invalid product record.")
        return _dedupe_product_master_rows([r for r in rows if isinstance(r, dict)])
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Product Master could not be read. The file was preserved; restore or repair it before saving.") from exc


def _product_master_file_write(rows: List[Dict[str, Any]], file_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    path = file_path or MPL_PRODUCT_MASTER_FILE
    prepared = _prepare_product_configurations(rows)
    _validate_configuration_rows(prepared)
    normalized = _dedupe_product_master_rows(prepared)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 2,
        "rows": normalized,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    _write_json_atomic(path, payload)
    return normalized


def _shared_product_master_file_read() -> List[Dict[str, Any]]:
    return _product_master_file_read(MPL_PRODUCT_MASTER_FILE)


def _datastore_row_to_product(row: Dict[str, Any]) -> Dict[str, Any]:
    return normalize_product_master_row(row)


def _product_to_datastore_row(row: Dict[str, Any], include_storefront: bool = False) -> Dict[str, Any]:
    normalized = normalize_product_master_row(row)

    length_in = _parse_decimal_value(normalized.get("length_in"))
    width_in = _parse_decimal_value(normalized.get("width_in"))
    height_in = _parse_decimal_value(normalized.get("height_in"))
    each_net_weight_g = _parse_decimal_value(normalized.get("each_net_weight_g"))
    package_net_weight_g = _parse_decimal_value(normalized.get("package_net_weight_g"))
    gross_weight_lbs = _parse_decimal_value(normalized.get("gross_weight_lbs"))

    default_copies_value = str(normalized.get("default_copies") or "").strip()
    default_copies = int(default_copies_value) if default_copies_value.isdigit() else None

    out = {
        "GTIN": normalized["gtin"],
        "DESCRIPTION": normalized["description"],
        "PACKAGING_LEVEL": normalized["packaging_level"],
        "CASE_QTY": normalized["case_qty"],
        "SKU": normalized["sku"],
        "DISPLAY_SKU": normalized.get("display_sku", ""),
        "DISPLAY_SKU_UOM": normalized.get("display_sku_uom", "Each"),
        "INNER_PACKS_PER_CASE": normalized.get("inner_packs_per_case", ""),
        "CONFIG_ID": normalized.get("config_id", ""),
        "CUSTOMER_ITEM_NUMBER": normalized.get("customer_item_number", ""),
        "LABEL_TEMPLATE_ID": normalized.get("label_template_id", ""),
        "BARCODE_TYPE": normalized.get("barcode_type", ""),
        # Compatibility column retained in Catalyst; its value is derived.
        "BARCODE_LEVEL": normalized["packaging_level"].upper().replace(" ", "_"),
        "LENGTH_IN": length_in,
        "WIDTH_IN": width_in,
        "HEIGHT_IN": height_in,
        "EACH_NET_WEIGHT_G": each_net_weight_g,
        "PACKAGE_NET_WEIGHT_G": package_net_weight_g,
        "GROSS_WEIGHT_LBS": gross_weight_lbs,
        "DEFAULT_COPIES": default_copies,
        "VERIFICATION_STATUS": normalized.get("verification_status", ""),
        "LABEL_ENABLED": bool(normalized.get("label_enabled")),
        "UNIQUE_KEY": normalized["unique_key"],
        "IS_ACTIVE": bool(normalized.get("is_active", True)),
    }
    if include_storefront:
        out["STOREFRONT"] = normalized["storefront"]
    return out


def _datastore_load_product_rows(request: Request, table_name: str, store_mode: str) -> Optional[List[Dict[str, str]]]:
    return _read_reference_datastore(
        _product_datastore_table(request, table_name, store_mode), table_name, store_mode,
        lambda rows: _dedupe_product_master_rows([_datastore_row_to_product(row) for row in rows]),
    )


def _datastore_load_product_master(request: Request) -> Optional[List[Dict[str, str]]]:
    return _datastore_load_product_rows(request, MPL_PRODUCT_MASTER_TABLE, MPL_PRODUCT_MASTER_STORE)


def _datastore_save_product_rows(
    request: Request,
    rows: List[Dict[str, Any]],
    table_name: str,
    store_mode: str,
    *,
    include_storefront: bool = False,
) -> Optional[List[Dict[str, str]]]:
    table_service = _product_datastore_table(request, table_name, store_mode)
    if table_service is None:
        return None
    prepared = _prepare_product_configurations(rows)
    _validate_configuration_rows(prepared)
    normalized = _dedupe_product_master_rows(prepared)
    try:
        replace_rows(table_service, normalized, key=_product_row_key, decode=_datastore_row_to_product,
                     encode=lambda row: _product_to_datastore_row(row, include_storefront=include_storefront))
        return normalized
    except Exception as exc:
        _raise_datastore_unavailable(table_name, "write to it", exc)


def _datastore_save_product_master(request: Request, rows: List[Dict[str, Any]]) -> Optional[List[Dict[str, str]]]:
    return _datastore_save_product_rows(
        request,
        rows,
        MPL_PRODUCT_MASTER_TABLE,
        MPL_PRODUCT_MASTER_STORE,
        include_storefront=True,
    )
