"""Audit log persistence and change summaries for reference data."""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Request

from labelkit.reference_data import (
    _dc_directory_base_key,
    _product_storefront_level_sku_key,
    normalize_dc_directory_row,
    normalize_product_master_row,
)
from labelkit.runtime import (
    AUDIT_LOG_FILE,
    AUDIT_LOG_STORE,
    AUDIT_LOG_TABLE,
    _chunked,
    _datastore_get_raw_rows,
    _datastore_table_named,
    _now_iso,
    _raise_datastore_unavailable,
    _request_actor,
    _store_requires_datastore,
)


def _audit_datastore_table(request: Optional[Request]) -> Any:
    if request is None:
        if _store_requires_datastore(AUDIT_LOG_STORE):
            _raise_datastore_unavailable(AUDIT_LOG_TABLE, "connect to it")
        return None
    return _datastore_table_named(
        request,
        AUDIT_LOG_TABLE,
        AUDIT_LOG_STORE,
    )


def _datastore_row_to_audit(row: Dict[str, Any]) -> Dict[str, Any]:
    actor_raw = row.get("ACTOR_JSON") or row.get("actor") or {}
    actor = actor_raw if isinstance(actor_raw, dict) else {}
    if isinstance(actor_raw, str) and actor_raw.strip():
        try:
            parsed = json.loads(actor_raw)
            if isinstance(parsed, dict):
                actor = parsed
        except Exception:
            actor = {}
    return {
        "id": row.get("AUDIT_ID") or row.get("id") or row.get("ROWID") or "",
        "timestamp": row.get("EVENT_TIMESTAMP") or row.get("TIMESTAMP") or row.get("timestamp") or "",
        "actor": actor,
        "table": row.get("TABLE_NAME") or row.get("table") or "",
        "action": row.get("ACTION") or row.get("action") or "",
        "record_key": row.get("RECORD_KEY") or row.get("record_key") or "",
        "record_label": row.get("RECORD_LABEL") or row.get("record_label") or "",
        "field": row.get("FIELD_NAME") or row.get("field") or "",
        "old_value": row.get("OLD_VALUE") or row.get("old_value") or "",
        "new_value": row.get("NEW_VALUE") or row.get("new_value") or "",
        "source": row.get("SOURCE") or row.get("source") or "",
        "batch_id": row.get("BATCH_ID") or row.get("batch_id") or "",
        "filename": row.get("FILENAME") or row.get("filename") or "",
    }


def _audit_to_datastore_row(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "AUDIT_ID": str(entry.get("id") or uuid.uuid4().hex),
        "EVENT_TIMESTAMP": str(entry.get("timestamp") or _now_iso()),
        "ACTOR_JSON": json.dumps(entry.get("actor") or {}, sort_keys=True),
        "TABLE_NAME": str(entry.get("table") or ""),
        "ACTION": str(entry.get("action") or ""),
        "RECORD_KEY": str(entry.get("record_key") or ""),
        "RECORD_LABEL": str(entry.get("record_label") or ""),
        "FIELD_NAME": str(entry.get("field") or ""),
        "OLD_VALUE": str(entry.get("old_value") or ""),
        "NEW_VALUE": str(entry.get("new_value") or ""),
        "SOURCE": str(entry.get("source") or ""),
        "BATCH_ID": str(entry.get("batch_id") or ""),
        "FILENAME": str(entry.get("filename") or ""),
        "IS_ACTIVE": True,
    }


def _datastore_load_audit_log(request: Optional[Request], limit: Optional[int] = None, table: str = "") -> Optional[List[Dict[str, Any]]]:
    table_service = _audit_datastore_table(request)
    if table_service is None:
        return None
    try:
        raw_rows = _datastore_get_raw_rows(table_service)
        active_rows = [
            row for row in raw_rows
            if str(row.get("IS_ACTIVE", True)).lower() not in {"false", "0", "no"}
        ]
        rows = [_datastore_row_to_audit(row) for row in active_rows]
        if table:
            rows = [row for row in rows if str(row.get("table", "")) == table]
        rows.sort(key=lambda row: str(row.get("timestamp", "")), reverse=True)
        return rows[:limit] if limit else rows
    except Exception as exc:
        if _store_requires_datastore(AUDIT_LOG_STORE):
            _raise_datastore_unavailable(AUDIT_LOG_TABLE, "read from it", exc)
        return None


def _datastore_append_audit_log(request: Optional[Request], entries: List[Dict[str, Any]]) -> bool:
    table_service = _audit_datastore_table(request)
    if table_service is None:
        return False
    try:
        insert_rows = [_audit_to_datastore_row(entry) for entry in entries]
        for batch in _chunked(insert_rows, 100):
            if batch:
                table_service.insert_rows(batch)
        return True
    except Exception as exc:
        if _store_requires_datastore(AUDIT_LOG_STORE):
            _raise_datastore_unavailable(AUDIT_LOG_TABLE, "write to it", exc)
        return False


def _audit_log_read(limit: Optional[int] = None, table: str = "", request: Optional[Request] = None) -> List[Dict[str, Any]]:
    datastore_rows = _datastore_load_audit_log(request, limit=limit, table=table)
    if datastore_rows is not None:
        return datastore_rows
    try:
        if not AUDIT_LOG_FILE.exists():
            return []
        data = json.loads(AUDIT_LOG_FILE.read_text(encoding="utf-8"))
        entries = data.get("entries") if isinstance(data, dict) else data
        if not isinstance(entries, list):
            return []
        rows = [entry for entry in entries if isinstance(entry, dict)]
        if table:
            rows = [row for row in rows if str(row.get("table", "")) == table]
        rows.sort(key=lambda row: str(row.get("timestamp", "")), reverse=True)
        return rows[:limit] if limit else rows
    except Exception:
        return []


def _audit_log_append(entries: List[Dict[str, Any]], request: Optional[Request] = None) -> None:
    if not entries:
        return
    if _datastore_append_audit_log(request, entries):
        return
    AUDIT_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    existing = _audit_log_read()
    combined = entries + existing
    payload = {
        "entries": combined[:1000],
        "updated_at": _now_iso(),
    }
    AUDIT_LOG_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _audit_value(value: Any) -> str:
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True)
    return str(value if value is not None else "")


def _product_row_key(row: Dict[str, Any]) -> str:
    normalized = normalize_product_master_row(row)
    return _product_storefront_level_sku_key(normalized)


def _dc_row_key(row: Dict[str, Any]) -> str:
    normalized = normalize_dc_directory_row(row)
    return str(normalized.get("unique_key") or _dc_directory_base_key(
        normalized.get("dc", ""), normalized.get("storefront", "")
    ))


def _row_label(table: str, row: Dict[str, Any]) -> str:
    if table in {"kehe_product_master", "mpl_product_master"}:
        normalized = normalize_product_master_row(row)
        return normalized.get("description") or normalized.get("gtin") or normalized.get("sku") or "Product row"
    if table in {"kehe_dc_directory", "mpl_directory"}:
        normalized = normalize_dc_directory_row(row)
        return normalized.get("name") or normalized.get("dc") or "DC row"
    if table == "kehe_mpl_drafts":
        return str(row.get("name") or row.get("id") or "MPL draft")
    return "Record"


def _normalized_for_audit(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    if table in {"kehe_product_master", "mpl_product_master"}:
        normalized = normalize_product_master_row(row)
        normalized.pop("unique_key", None)
        return normalized
    if table in {"kehe_dc_directory", "mpl_directory"}:
        normalized = normalize_dc_directory_row(row)
        normalized.pop("unique_key", None)
        normalized.pop("id", None)
        return normalized
    return dict(row)


def _audit_row_changes(
    *,
    request: Request,
    table: str,
    old_rows: List[Dict[str, Any]],
    new_rows: List[Dict[str, Any]],
    key_fn: Any,
    source: str,
    batch_id: str = "",
    filename: str = "",
) -> None:
    actor = _request_actor(request)
    timestamp = _now_iso()
    old_by_key = {key_fn(row): _normalized_for_audit(table, row) for row in old_rows}
    new_by_key = {key_fn(row): _normalized_for_audit(table, row) for row in new_rows}
    labels = {key_fn(row): _row_label(table, row) for row in [*old_rows, *new_rows]}
    entries: List[Dict[str, Any]] = []

    for key in sorted(set(old_by_key) | set(new_by_key)):
        old = old_by_key.get(key)
        new = new_by_key.get(key)
        if old is None and new is not None:
            entries.append({
                "id": uuid.uuid4().hex,
                "timestamp": timestamp,
                "actor": actor,
                "table": table,
                "action": "create",
                "record_key": key,
                "record_label": labels.get(key, ""),
                "field": "__row__",
                "old_value": "",
                "new_value": _audit_value(new),
                "source": source,
                "batch_id": batch_id,
                "filename": filename,
            })
            continue
        if old is not None and new is None:
            entries.append({
                "id": uuid.uuid4().hex,
                "timestamp": timestamp,
                "actor": actor,
                "table": table,
                "action": "delete",
                "record_key": key,
                "record_label": labels.get(key, ""),
                "field": "__row__",
                "old_value": _audit_value(old),
                "new_value": "",
                "source": source,
                "batch_id": batch_id,
                "filename": filename,
            })
            continue
        if old is None or new is None:
            continue
        for field in sorted(set(old) | set(new)):
            old_value = _audit_value(old.get(field))
            new_value = _audit_value(new.get(field))
            if old_value == new_value:
                continue
            entries.append({
                "id": uuid.uuid4().hex,
                "timestamp": timestamp,
                "actor": actor,
                "table": table,
                "action": "update",
                "record_key": key,
                "record_label": labels.get(key, ""),
                "field": field,
                "old_value": old_value,
                "new_value": new_value,
                "source": source,
                "batch_id": batch_id,
                "filename": filename,
            })

    _audit_log_append(entries, request=request)
