"""Directory persistence (local JSON and Catalyst datastore)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Request

from labelkit.audit_log import _dc_row_key
from labelkit.reference_data import (
    _dedupe_dc_directory_rows,
    _kehe_dc_directory_rows,
    normalize_dc_directory_row,
)
from labelkit.runtime import (
    MPL_DIRECTORY_FILE,
    MPL_DIRECTORY_STORE,
    MPL_DIRECTORY_TABLE,
    _chunked,
    _datastore_get_raw_rows,
    _datastore_table_named,
    _now_iso,
    _raise_datastore_unavailable,
    _store_requires_datastore,
    _write_json_atomic,
)
from pipelines.kehe_pipeline import load_kehe_dc_directory


def _dc_directory_file_read(file_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    path = file_path or MPL_DIRECTORY_FILE
    try:
        if not path.exists():
            return []

        data = json.loads(path.read_text(encoding="utf-8"))

        if isinstance(data, dict):
            if isinstance(data.get("rows"), list):
                return _dedupe_dc_directory_rows([r for r in data.get("rows", []) if isinstance(r, dict)])
            rows = []
            for dc, row in data.items():
                if isinstance(row, dict):
                    merged = {"dc": dc, **row}
                    rows.append(merged)
            return _dedupe_dc_directory_rows(rows)

        if isinstance(data, list):
            return _dedupe_dc_directory_rows([r for r in data if isinstance(r, dict)])

        return []
    except Exception:
        return []


def _dc_directory_file_write(
    rows: List[Dict[str, Any]],
    file_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    path = file_path or MPL_DIRECTORY_FILE
    normalized = _dedupe_dc_directory_rows(rows)

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 2,
        "rows": normalized,
        "updated_at": _now_iso(),
    }
    _write_json_atomic(path, payload)

    try:
        load_kehe_dc_directory.cache_clear()
    except Exception:
        pass

    return normalized


def _shared_dc_directory_file_read() -> List[Dict[str, Any]]:
    return _dc_directory_file_read(MPL_DIRECTORY_FILE)


def _datastore_row_to_dc(row: Dict[str, Any]) -> Dict[str, Any]:
    return normalize_dc_directory_row(row)


def _dc_to_datastore_row(row: Dict[str, Any], include_storefront: bool = False) -> Dict[str, Any]:
    normalized = normalize_dc_directory_row(row)

    out = {
        "DC": normalized["dc"],
        "NAME": normalized["name"],
        "SHIP_FROM": normalized["ship_from"],
        "DELIVERY_ADDRESS": normalized["delivery_address"],
        "BILLING_ADDRESS": normalized["billing_address"],
        "MATCH_VALUES": json.dumps(normalized["match_values"]),
        "RECORD_TYPE": normalized.get("record_type", "DESTINATION"),
        "DEFAULT_LABEL_TEMPLATE_ID": normalized.get("default_label_template_id", ""),
        "VERIFICATION_STATUS": normalized.get("verification_status", ""),
        "UNIQUE_KEY": normalized["unique_key"],
        "IS_ACTIVE": bool(normalized.get("is_active", True)),
    }
    if include_storefront:
        out["STOREFRONT"] = normalized["storefront"]
    return out


def _dc_datastore_table_named(request: Request, table_name: str, store_mode: str) -> Any:
    return _datastore_table_named(request, table_name, store_mode)


def _datastore_load_dc_rows(request: Request, table_name: str, store_mode: str) -> Optional[List[Dict[str, Any]]]:
    table_service = _dc_datastore_table_named(request, table_name, store_mode)
    if table_service is None:
        return None

    try:
        raw_rows = _datastore_get_raw_rows(table_service)
        return _dedupe_dc_directory_rows([_datastore_row_to_dc(r) for r in raw_rows])
    except Exception as exc:
        if _store_requires_datastore(store_mode):
            _raise_datastore_unavailable(table_name, "read from it", exc)
        return None


def _datastore_load_dc_directory(request: Request) -> Optional[List[Dict[str, Any]]]:
    return _datastore_load_dc_rows(request, MPL_DIRECTORY_TABLE, MPL_DIRECTORY_STORE)


def _datastore_save_dc_rows(
    request: Request,
    rows: List[Dict[str, Any]],
    table_name: str,
    store_mode: str,
    *,
    include_storefront: bool = False,
) -> Optional[List[Dict[str, Any]]]:
    table_service = _dc_datastore_table_named(request, table_name, store_mode)
    if table_service is None:
        return None

    normalized = _dedupe_dc_directory_rows(rows)

    try:
        existing_rows = _datastore_get_raw_rows(table_service)
        existing_by_key = {
            _dc_row_key(_datastore_row_to_dc(raw)): raw
            for raw in existing_rows
            if raw.get("ROWID")
        }
        wanted_by_key = {_dc_row_key(row): row for row in normalized}
        update_rows: List[Dict[str, Any]] = []
        insert_rows: List[Dict[str, Any]] = []
        for key, row in wanted_by_key.items():
            datastore_row = _dc_to_datastore_row(row, include_storefront=include_storefront)
            existing = existing_by_key.get(key)
            if existing:
                datastore_row["ROWID"] = existing["ROWID"]
                update_rows.append(datastore_row)
            else:
                insert_rows.append(datastore_row)
        delete_ids = [
            raw.get("ROWID")
            for key, raw in existing_by_key.items()
            if key not in wanted_by_key and raw.get("ROWID")
        ]
        for batch in _chunked(update_rows, 100):
            if batch:
                table_service.update_rows(batch)
        for batch in _chunked(insert_rows, 100):
            if batch:
                table_service.insert_rows(batch)
        for batch in _chunked(delete_ids, 200):
            if batch:
                table_service.delete_rows(batch)

        return normalized
    except Exception as exc:
        if _store_requires_datastore(store_mode):
            _raise_datastore_unavailable(table_name, "write to it", exc)
        return None


def _datastore_save_dc_directory(request: Request, rows: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    return _datastore_save_dc_rows(
        request,
        _dedupe_dc_directory_rows(rows),
        MPL_DIRECTORY_TABLE,
        MPL_DIRECTORY_STORE,
        include_storefront=True,
    )


def _sync_kehe_dc_directory_for_pipeline(request: Request) -> List[Dict[str, Any]]:
    rows = _datastore_load_dc_directory(request)

    if rows is None:
        rows = _shared_dc_directory_file_read()
    elif not _store_requires_datastore(MPL_DIRECTORY_STORE):
        _dc_directory_file_write(rows, MPL_DIRECTORY_FILE)

    rows = _kehe_dc_directory_rows(rows)
    try:
        load_kehe_dc_directory.cache_clear()
    except Exception:
        pass

    return rows
