"""Saved draft routes."""

from __future__ import annotations

import copy
import uuid
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from labelkit.audit_log import _audit_log_append
from labelkit.draft_store import (
    _document_draft_summary,
    _hydrate_saved_mpl_record,
    _mpl_draft_for_storage,
    _mpl_draft_summary,
    _mpl_drafts_read,
    _mpl_drafts_write,
    _normalize_document_type,
    _save_mpl_version_snapshot,
)
from labelkit.product_store import _datastore_load_product_master, _shared_product_master_file_read
from labelkit.reference_data import _boolish
from labelkit.runtime import _now_iso, _request_actor, _require_permission


router = APIRouter()


@router.get("/api/kehe/mpl-drafts")
async def list_kehe_mpl_drafts(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    drafts = _mpl_drafts_read(request, "MPL")
    summaries = [_mpl_draft_summary(record) for record in drafts]
    summaries.sort(key=lambda row: str(row.get("updated_at", "")), reverse=True)
    return JSONResponse(content={"drafts": summaries})


@router.get("/api/kehe/mpl-drafts/{draft_id}")
async def get_kehe_mpl_draft(request: Request, draft_id: str) -> JSONResponse:
    _require_permission(request, "view")
    for record in _mpl_drafts_read(request, "MPL"):
        if str(record.get("id")) == draft_id:
            product_rows = _datastore_load_product_master(request)
            if product_rows is None:
                product_rows = _shared_product_master_file_read()
            return JSONResponse(content={
                "draft": _hydrate_saved_mpl_record(record, product_rows),
            })
    raise HTTPException(status_code=404, detail="Saved MPL draft not found.")


@router.post("/api/kehe/mpl-drafts")
async def save_kehe_mpl_draft(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "save_mpl")
    draft = payload.get("draft") if isinstance(payload, dict) else None
    if not isinstance(draft, dict):
        raise HTTPException(status_code=400, detail="MPL draft payload is required.")

    storage_draft = _mpl_draft_for_storage(draft)
    drafts = _mpl_drafts_read(request, "MPL")
    draft_id = str(payload.get("id") or draft.get("_saved_draft_id") or uuid.uuid4().hex)
    now = _now_iso()
    packing_lists = draft.get("packing_lists") if isinstance(draft.get("packing_lists"), list) else []
    first = packing_lists[0] if packing_lists and isinstance(packing_lists[0], dict) else {}
    name = str(payload.get("name") or draft.get("_saved_draft_name") or "").strip()
    if not name:
        name = str(first.get("customer_po_number") or first.get("id") or "Untitled MPL").strip()

    old_record = next((record for record in drafts if str(record.get("id")) == draft_id), None)
    current_revision = int((old_record or {}).get("revision") or 0)
    expected_revision_raw = payload.get("expected_revision")
    if old_record is not None and expected_revision_raw not in (None, ""):
        try:
            expected_revision = int(expected_revision_raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Expected revision must be a whole number.")
        if expected_revision != current_revision:
            return JSONResponse(status_code=409, content={
                "detail": "This MPL was updated by another user. Reopen the saved MPL before saving your changes.",
                "current_revision": current_revision,
                "updated_at": (old_record or {}).get("updated_at", ""),
                "updated_by": (old_record or {}).get("updated_by", ""),
            })
    created_at = old_record.get("created_at") if old_record else now
    actor = _request_actor(request)
    actor_label = str(actor.get("email") or actor.get("name") or "Local user")
    created_by = (
        old_record.get("created_by")
        if old_record else ""
    ) or str(draft.get("_saved_draft_created_by") or actor_label)
    storage_draft["_saved_draft_created_by"] = created_by
    storage_draft["_saved_draft_updated_by"] = actor_label
    record = {
        "id": draft_id,
        "name": name,
        "created_at": created_at,
        "updated_at": now,
        "document_type": "MPL",
        "status": str(payload.get("status") or "DRAFT"),
        "customer_code": str(payload.get("customer_code") or draft.get("storefront") or ""),
        "po_number": str(payload.get("po_number") or first.get("customer_po_number") or ""),
        "created_by": created_by,
        "updated_by": actor_label,
        "revision": current_revision + 1,
        "draft": storage_draft,
    }
    next_drafts = [record if str(existing.get("id")) == draft_id else existing for existing in drafts]
    if old_record is None:
        next_drafts.append(record)
    _mpl_drafts_write(next_drafts, request, "MPL")
    if _boolish(payload.get("create_version"), False):
        _save_mpl_version_snapshot(request, record, str(payload.get("version_reason") or "Explicit save"))

    _audit_log_append([{
        "id": uuid.uuid4().hex,
        "timestamp": now,
        "actor": actor,
        "table": "kehe_mpl_drafts",
        "action": "update" if old_record else "create",
        "record_key": draft_id,
        "record_label": name,
        "field": "draft",
        "old_value": old_record.get("name", "") if old_record else "",
        "new_value": name,
        "source": "mpl_save",
        "batch_id": "",
        "filename": "",
    }], request=request)

    return JSONResponse(content={"draft": record, "saved": True})


@router.get("/api/kehe/mpl-drafts/{draft_id}/versions")
async def list_kehe_mpl_draft_versions(request: Request, draft_id: str) -> JSONResponse:
    _require_permission(request, "view")
    versions = [
        record for record in _mpl_drafts_read(request, "MPL_VERSION")
        if str((record.get("draft") or {}).get("_version_parent_id") or "") == draft_id
    ]
    versions.sort(key=lambda record: int(record.get("revision") or 0), reverse=True)
    return JSONResponse(content={"versions": [{
        "id": record.get("id", ""),
        "name": record.get("name", ""),
        "revision": int(record.get("revision") or 0),
        "updated_at": record.get("updated_at", ""),
        "updated_by": record.get("updated_by", ""),
        "reason": str((record.get("draft") or {}).get("_version_reason") or "Explicit save"),
    } for record in versions]})


@router.get("/api/kehe/mpl-drafts/{draft_id}/versions/{version_id}")
async def get_kehe_mpl_draft_version(request: Request, draft_id: str, version_id: str) -> JSONResponse:
    _require_permission(request, "view")
    version = next((
        record for record in _mpl_drafts_read(request, "MPL_VERSION")
        if str(record.get("id")) == version_id
        and str((record.get("draft") or {}).get("_version_parent_id") or "") == draft_id
    ), None)
    if version is None:
        raise HTTPException(status_code=404, detail="Saved MPL version not found.")
    return JSONResponse(content={"version": version})


@router.post("/api/kehe/mpl-drafts/{draft_id}/versions/{version_id}/restore")
async def restore_kehe_mpl_draft_version(
    request: Request,
    draft_id: str,
    version_id: str,
    payload: Dict[str, Any],
) -> JSONResponse:
    _require_permission(request, "save_mpl")
    drafts = _mpl_drafts_read(request, "MPL")
    current = next((record for record in drafts if str(record.get("id")) == draft_id), None)
    version = next((record for record in _mpl_drafts_read(request, "MPL_VERSION") if str(record.get("id")) == version_id), None)
    if current is None or version is None or str((version.get("draft") or {}).get("_version_parent_id") or "") != draft_id:
        raise HTTPException(status_code=404, detail="Saved MPL version not found.")
    expected = payload.get("expected_revision")
    if expected not in (None, "") and int(expected) != int(current.get("revision") or 0):
        raise HTTPException(status_code=409, detail="This MPL changed after version history was opened. Reopen it and try again.")
    restored_draft = copy.deepcopy(version.get("draft") or {})
    restored_draft.pop("_version_parent_id", None)
    restored_draft.pop("_version_reason", None)
    now = _now_iso()
    actor = _request_actor(request)
    restored = {
        **current,
        "updated_at": now,
        "updated_by": str(actor.get("email") or actor.get("name") or "Local user"),
        "revision": int(current.get("revision") or 0) + 1,
        "draft": restored_draft,
    }
    next_drafts = [restored if str(row.get("id")) == draft_id else row for row in drafts]
    _mpl_drafts_write(next_drafts, request, "MPL")
    _save_mpl_version_snapshot(request, restored, f"Restored from version {version.get('revision') or ''}")
    return JSONResponse(content={"draft": restored, "restored": True})


@router.post("/api/kehe/mpl-drafts/{draft_id}/delete")
@router.delete("/api/kehe/mpl-drafts/{draft_id}")
async def delete_kehe_mpl_draft(request: Request, draft_id: str) -> JSONResponse:
    _require_permission(request, "delete_mpl")
    drafts = _mpl_drafts_read(request, "MPL")
    old_record = next((record for record in drafts if str(record.get("id")) == draft_id), None)
    if old_record is None:
        raise HTTPException(status_code=404, detail="Saved MPL draft not found.")

    next_drafts = [record for record in drafts if str(record.get("id")) != draft_id]
    _mpl_drafts_write(next_drafts, request, "MPL")
    versions = _mpl_drafts_read(request, "MPL_VERSION")
    remaining_versions = [
        record for record in versions
        if str((record.get("draft") or {}).get("_version_parent_id") or "") != draft_id
    ]
    if len(remaining_versions) != len(versions):
        _mpl_drafts_write(remaining_versions, request, "MPL_VERSION")

    now = _now_iso()
    _audit_log_append([{
        "id": uuid.uuid4().hex,
        "timestamp": now,
        "actor": _request_actor(request),
        "table": "kehe_mpl_drafts",
        "action": "delete",
        "record_key": draft_id,
        "record_label": old_record.get("name", ""),
        "field": "draft",
        "old_value": old_record.get("name", ""),
        "new_value": "",
        "source": "mpl_delete",
        "batch_id": "",
        "filename": "",
    }], request=request)

    return JSONResponse(content={"deleted": True, "id": draft_id})


@router.get("/api/documents/drafts")
async def list_document_drafts(request: Request, document_type: str = "") -> JSONResponse:
    _require_permission(request, "view")
    normalized_document_type = _normalize_document_type(document_type, "") if document_type else ""
    drafts = _mpl_drafts_read(request, normalized_document_type)
    summaries = [_document_draft_summary(record) for record in drafts]
    summaries.sort(key=lambda row: str(row.get("updated_at", "")), reverse=True)
    return JSONResponse(content={"drafts": summaries})


@router.get("/api/documents/drafts/{draft_id}")
async def get_document_draft(request: Request, draft_id: str, document_type: str = "") -> JSONResponse:
    _require_permission(request, "view")
    normalized_document_type = _normalize_document_type(document_type, "") if document_type else ""
    for record in _mpl_drafts_read(request, normalized_document_type):
        if str(record.get("id")) == draft_id:
            return JSONResponse(content={"draft": record})
    raise HTTPException(status_code=404, detail="Saved draft not found.")


@router.post("/api/documents/drafts")
async def save_document_draft(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "save_mpl")
    draft = payload.get("draft") if isinstance(payload, dict) else None
    if not isinstance(draft, dict):
        raise HTTPException(status_code=400, detail="Document draft payload is required.")

    document_type = _normalize_document_type(payload.get("document_type") or draft.get("document_type") or "MPL")
    drafts = _mpl_drafts_read(request, document_type)
    draft_id = str(payload.get("id") or draft.get("_saved_draft_id") or uuid.uuid4().hex)
    now = _now_iso()
    old_record = next((record for record in drafts if str(record.get("id")) == draft_id), None)
    actor = _request_actor(request)
    actor_label = str(actor.get("email") or actor.get("name") or "Local user")
    created_by = ((old_record or {}).get("created_by") or str(payload.get("created_by") or actor_label))

    record = {
        "id": draft_id,
        "name": str(payload.get("name") or draft.get("name") or "Untitled").strip() or "Untitled",
        "created_at": (old_record or {}).get("created_at") or now,
        "updated_at": now,
        "document_type": document_type,
        "status": str(payload.get("status") or "DRAFT"),
        "customer_code": str(payload.get("customer_code") or draft.get("storefront") or ""),
        "po_number": str(payload.get("po_number") or ""),
        "created_by": created_by,
        "updated_by": actor_label,
        "draft": _mpl_draft_for_storage(draft),
    }
    next_drafts = [record if str(existing.get("id")) == draft_id else existing for existing in drafts]
    if old_record is None:
        next_drafts.append(record)
    _mpl_drafts_write(next_drafts, request, document_type)

    return JSONResponse(content={"draft": record, "saved": True})


@router.delete("/api/documents/drafts/{draft_id}")
async def delete_document_draft(request: Request, draft_id: str, document_type: str = "") -> JSONResponse:
    _require_permission(request, "delete_mpl")
    normalized_document_type = _normalize_document_type(document_type, "") if document_type else ""
    drafts = _mpl_drafts_read(request, normalized_document_type)
    old_record = next((record for record in drafts if str(record.get("id")) == draft_id), None)
    if old_record is None:
        raise HTTPException(status_code=404, detail="Saved draft not found.")
    next_drafts = [record for record in drafts if str(record.get("id")) != draft_id]
    _mpl_drafts_write(next_drafts, request, normalized_document_type)
    return JSONResponse(content={"deleted": True, "id": draft_id})
