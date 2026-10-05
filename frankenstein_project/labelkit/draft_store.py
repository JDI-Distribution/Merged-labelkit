"""Saved document draft persistence and version snapshots."""

from __future__ import annotations

import copy
import json
from typing import Any, Dict, List, Optional

from fastapi import Request

from labelkit.draft_storage import (
    bounded_versions,
    decode_draft_row,
    encode_draft_row,
    normalize_document_type as normalize_draft_document_type,
)
from labelkit.reference_data import _dedupe_product_master_rows
from labelkit.runtime import (
    MPL_DRAFTS_FILE,
    MPL_DRAFTS_STORE,
    MPL_DRAFTS_TABLE,
    _chunked,
    _datastore_get_raw_rows,
    _datastore_table_named,
    _now_iso,
    _raise_datastore_unavailable,
    _store_requires_datastore,
)
from pipelines.kehe_pipeline import apply_product_master_to_mpl_draft


def _mpl_drafts_datastore_table(request: Optional[Request]) -> Any:
    if request is None:
        if _store_requires_datastore(MPL_DRAFTS_STORE):
            _raise_datastore_unavailable(MPL_DRAFTS_TABLE, "connect to it")
        return None
    return _datastore_table_named(
        request,
        MPL_DRAFTS_TABLE,
        MPL_DRAFTS_STORE,
    )


def _normalize_document_type(value: Any, default: str = "MPL") -> str:
    return normalize_draft_document_type(value, default)


def _datastore_row_to_mpl_draft(row: Dict[str, Any]) -> Dict[str, Any]:
    return decode_draft_row(row)


def _mpl_draft_to_datastore_row(record: Dict[str, Any]) -> Dict[str, Any]:
    return encode_draft_row(record, _now_iso())


def _mpl_draft_for_storage(draft: Dict[str, Any]) -> Dict[str, Any]:
    """Remove regenerable data that can overflow the Data Store JSON text column."""
    def clean(value: Any, key: str = "") -> Any:
        normalized_key = str(key or "").strip().lower()
        if normalized_key == "product_master":
            return None
        if normalized_key in {"_tihi_snapshot", "sheet_image_data_url", "image_data_url"}:
            return None
        if isinstance(value, dict):
            return {
                child_key: cleaned
                for child_key, child_value in value.items()
                if (cleaned := clean(child_value, child_key)) is not None
            }
        if isinstance(value, list):
            return [cleaned for item in value if (cleaned := clean(item)) is not None]
        return value

    cleaned_draft = clean(draft)
    return cleaned_draft if isinstance(cleaned_draft, dict) else {}


def _datastore_load_mpl_drafts(request: Optional[Request], document_type: str = "") -> Optional[List[Dict[str, Any]]]:
    table_service = _mpl_drafts_datastore_table(request)
    if table_service is None:
        return None
    try:
        raw_rows = _datastore_get_raw_rows(table_service)
        wanted_document_type = _normalize_document_type(document_type, "") if document_type else ""
        active_rows = [
            row for row in raw_rows
            if str(row.get("IS_ACTIVE", True)).lower() not in {"false", "0", "no"}
        ]
        mapped = [_datastore_row_to_mpl_draft(row) for row in active_rows]
        if wanted_document_type:
            mapped = [
                row for row in mapped
                if _normalize_document_type(row.get("document_type"), "") == wanted_document_type
            ]
        return mapped
    except Exception as exc:
        if _store_requires_datastore(MPL_DRAFTS_STORE):
            _raise_datastore_unavailable(MPL_DRAFTS_TABLE, "read from it", exc)
        return None


def _datastore_save_mpl_drafts(request: Optional[Request], drafts: List[Dict[str, Any]], document_type: str = "") -> bool:
    table_service = _mpl_drafts_datastore_table(request)
    if table_service is None:
        return False
    try:
        existing_rows = _datastore_get_raw_rows(table_service)
        wanted_document_type = _normalize_document_type(document_type, "") if document_type else ""

        filtered_existing: List[Dict[str, Any]] = []
        for row in existing_rows:
            if str(row.get("IS_ACTIVE", True)).lower() in {"false", "0", "no"}:
                continue
            mapped = _datastore_row_to_mpl_draft(row)
            if wanted_document_type and _normalize_document_type(mapped.get("document_type"), "") != wanted_document_type:
                continue
            filtered_existing.append(row)

        existing_by_id: Dict[str, Dict[str, Any]] = {}
        existing_rowid_by_id: Dict[str, Any] = {}
        for row in filtered_existing:
            draft_id = str(row.get("DRAFT_ID") or row.get("id") or "").strip()
            if not draft_id:
                continue
            existing_by_id[draft_id] = row
            existing_rowid_by_id[draft_id] = row.get("ROWID")

        incoming_by_id = {
            str(record.get("id") or "").strip(): record
            for record in drafts
            if str(record.get("id") or "").strip()
        }

        delete_rowids: List[Any] = []
        update_rows: List[Dict[str, Any]] = []
        insert_rows: List[Dict[str, Any]] = []

        for draft_id, row in existing_by_id.items():
            if draft_id not in incoming_by_id:
                rowid = existing_rowid_by_id.get(draft_id)
                if rowid:
                    delete_rowids.append(rowid)

        for draft_id, record in incoming_by_id.items():
            prepared_record = dict(record)
            if wanted_document_type:
                prepared_record["document_type"] = wanted_document_type
            next_row = _mpl_draft_to_datastore_row(prepared_record)
            existing_row = existing_by_id.get(draft_id)
            if existing_row is None:
                insert_rows.append(next_row)
                continue
            current_compare = dict(existing_row)
            current_compare.pop("ROWID", None)
            if current_compare == next_row:
                continue
            rowid = existing_rowid_by_id.get(draft_id)
            if rowid:
                next_row["ROWID"] = rowid
                update_rows.append(next_row)
            else:
                insert_rows.append(next_row)

        for batch in _chunked(update_rows, 100):
            if batch:
                table_service.update_rows(batch)
        for batch in _chunked(insert_rows, 100):
            if batch:
                table_service.insert_rows(batch)
        for batch in _chunked(delete_rowids, 200):
            if batch:
                table_service.delete_rows(batch)
        return True
    except Exception as exc:
        if _store_requires_datastore(MPL_DRAFTS_STORE):
            _raise_datastore_unavailable(MPL_DRAFTS_TABLE, "write to it", exc)
        return False


def _mpl_drafts_read(request: Optional[Request] = None, document_type: str = "") -> List[Dict[str, Any]]:
    wanted_document_type = _normalize_document_type(document_type, "") if document_type else ""
    datastore_rows = _datastore_load_mpl_drafts(request, wanted_document_type)
    if datastore_rows is not None:
        return datastore_rows
    try:
        if not MPL_DRAFTS_FILE.exists():
            return []
        data = json.loads(MPL_DRAFTS_FILE.read_text(encoding="utf-8"))
        drafts = data.get("drafts") if isinstance(data, dict) else data
        if not isinstance(drafts, list):
            return []
        rows = [draft for draft in drafts if isinstance(draft, dict)]
        if wanted_document_type:
            rows = [
                row for row in rows
                if _normalize_document_type(row.get("document_type"), "") == wanted_document_type
            ]
        return rows
    except Exception:
        return []


def _mpl_drafts_write(
    drafts: List[Dict[str, Any]],
    request: Optional[Request] = None,
    document_type: str = "",
) -> List[Dict[str, Any]]:
    wanted_document_type = _normalize_document_type(document_type, "") if document_type else ""
    if _datastore_save_mpl_drafts(request, drafts, wanted_document_type):
        return drafts

    existing_rows = _mpl_drafts_read(request=None)
    if wanted_document_type:
        existing_rows = [
            row for row in existing_rows
            if _normalize_document_type(row.get("document_type"), "") != wanted_document_type
        ] + [
            {**row, "document_type": wanted_document_type}
            for row in drafts
        ]
    else:
        existing_rows = drafts

    MPL_DRAFTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "drafts": existing_rows,
        "updated_at": _now_iso(),
    }
    MPL_DRAFTS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return drafts


def _mpl_draft_summary(record: Dict[str, Any]) -> Dict[str, Any]:
    draft = record.get("draft") if isinstance(record.get("draft"), dict) else {}
    mpl = {}
    packing_lists = draft.get("packing_lists") if isinstance(draft, dict) else []
    if isinstance(packing_lists, list) and packing_lists:
        mpl = packing_lists[0] if isinstance(packing_lists[0], dict) else {}
    items = mpl.get("items") if isinstance(mpl.get("items"), list) else []
    created_by = (
        record.get("created_by")
        or draft.get("_saved_draft_created_by", "")
        or draft.get("_saved_by", "")
    )
    updated_by = (
        record.get("updated_by")
        or draft.get("_saved_draft_updated_by", "")
        or draft.get("_saved_by", "")
    )
    return {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "status": record.get("status", "DRAFT"),
        "customer_code": record.get("customer_code", "") or draft.get("storefront", ""),
        "created_at": record.get("created_at", ""),
        "updated_at": record.get("updated_at", ""),
        "created_by": created_by,
        "updated_by": updated_by,
        "revision": int(record.get("revision") or 0),
        "customer_po_number": mpl.get("customer_po_number", ""),
        "order_number": mpl.get("order_no", ""),
        "ship_to": str(mpl.get("ship_to", "")).split("\n")[0] if mpl.get("ship_to") else "",
        "total_pallets": mpl.get("total_pallets", ""),
        "item_count": len(items),
    }


def _save_mpl_version_snapshot(request: Request, record: Dict[str, Any], reason: str) -> None:
    parent_id = str(record.get("id") or "")
    revision = int(record.get("revision") or 0)
    if not parent_id or revision < 1:
        return
    versions = _mpl_drafts_read(request, "MPL_VERSION")
    snapshot_draft = copy.deepcopy(record.get("draft") or {})
    snapshot_draft["_version_parent_id"] = parent_id
    snapshot_draft["_version_reason"] = str(reason or "Explicit save")
    version_record = {
        **record,
        "id": f"{parent_id}-v{revision}",
        "name": f"{record.get('name') or 'MPL'} · Version {revision}",
        "document_type": "MPL_VERSION",
        "draft": snapshot_draft,
    }
    versions = [row for row in versions if str(row.get("id")) != version_record["id"]]
    versions.append(version_record)
    _mpl_drafts_write(bounded_versions(versions, parent_id), request, "MPL_VERSION")


def _hydrate_saved_mpl_record(
    record: Dict[str, Any],
    product_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Refresh regenerable Product Master fields in a saved MPL response."""
    hydrated = copy.deepcopy(record)
    draft = hydrated.get("draft") if isinstance(hydrated.get("draft"), dict) else {}
    draft["product_master"] = _dedupe_product_master_rows(product_rows)
    apply_product_master_to_mpl_draft(draft, force=False)
    hydrated["draft"] = draft
    return hydrated


def _document_draft_summary(record: Dict[str, Any]) -> Dict[str, Any]:
    summary = {
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "document_type": _normalize_document_type(record.get("document_type") or "MPL"),
        "status": str(record.get("status") or ""),
        "customer_code": str(record.get("customer_code") or ""),
        "po_number": str(record.get("po_number") or ""),
        "created_at": record.get("created_at", ""),
        "updated_at": record.get("updated_at", ""),
        "created_by": record.get("created_by", ""),
        "updated_by": record.get("updated_by", ""),
    }
    if summary["document_type"] == "MPL":
        summary.update(_mpl_draft_summary(record))
    return summary
