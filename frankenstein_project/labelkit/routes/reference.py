"""Product Master, Directory, and audit log routes."""

from __future__ import annotations

import uuid
from typing import Any, Dict

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from labelkit.audit_log import _audit_log_read, _audit_row_changes, _dc_row_key, _product_row_key
from labelkit.directory_store import (
    _datastore_load_dc_directory,
    _datastore_save_dc_directory,
    _dc_directory_file_write,
    _shared_dc_directory_file_read,
)
from labelkit.product_quality import analyze_product_master_rows
from labelkit.product_store import (
    _datastore_load_product_master,
    _datastore_save_product_master,
    _product_master_file_write,
    _shared_product_master_file_read,
)
from labelkit.reference_data import (
    _dedupe_dc_directory_rows,
    _dedupe_product_master_rows,
    _kehe_dc_directory_rows,
    _kehe_product_master_rows,
    _prepare_product_configurations,
    _validate_configuration_rows,
)
from labelkit.reference_import import (
    _apply_shared_directory_ship_from,
    _canonicalize_import_rows,
    _merge_import_rows,
    _preview_excel_import,
    _prepare_product_import_rows,
)
from labelkit.runtime import MPL_DIRECTORY_FILE, MPL_PRODUCT_MASTER_FILE, _require_permission, reference_revision, serialized_data_access


router = APIRouter()


def _payload_rows(payload):
    rows = payload.get("rows")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HTTPException(status_code=400, detail="rows must be a list of records.")
    return rows


def _check_revision(payload, rows):
    if not payload.get("expected_revision"):
        raise HTTPException(status_code=428, detail="Reload this table before saving; its revision is required.")
    if payload["expected_revision"] != reference_revision(rows):
        raise HTTPException(status_code=409, detail="This table changed. Reload it before applying your edits again.")


def _load_reference_rows(request, cloud_read, file_read):
    rows = cloud_read(request)
    return (file_read(), "file") if rows is None else (rows, "datastore")


def _save_reference_table(request, payload, rows, table, cloud_read, file_read, cloud_write, file_write, path, key):
    old_rows, _ = _load_reference_rows(request, cloud_read, file_read)
    _check_revision(payload, old_rows)
    saved_rows = cloud_write(request, rows)
    storage_source = "datastore"
    if saved_rows is None:
        saved_rows = file_write(rows, path)
        storage_source = "file"
    _audit_row_changes(
        request=request, table=table, old_rows=old_rows, new_rows=saved_rows, key_fn=key,
        source=str(payload.get("source") or "manual_edit"),
        batch_id=str(payload.get("batch_id") or ""), filename=str(payload.get("filename") or ""),
    )
    return JSONResponse(content={"rows": saved_rows, "saved": True, "source": storage_source,
                                 "revision": reference_revision(saved_rows)})


@router.get("/api/kehe/product-master")
@serialized_data_access
async def get_kehe_product_master(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows, source = _load_reference_rows(request, _datastore_load_product_master, _shared_product_master_file_read)
    rows = _kehe_product_master_rows(rows)
    return JSONResponse(content={"rows": rows, "source": source})


@router.put("/api/kehe/product-master")
async def save_kehe_product_master(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    raise HTTPException(
        status_code=405,
        detail="KeHE Product Master is read-only. Edit shared rows from Packing List & Ti-Hi Product Master.",
    )


@router.get("/api/mpl/product-master")
@serialized_data_access
async def get_mpl_product_master(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows, source = _load_reference_rows(request, _datastore_load_product_master, _shared_product_master_file_read)
    return JSONResponse(content={
        "rows": rows,
        "source": source,
        "quality": analyze_product_master_rows(rows),
        "revision": reference_revision(rows),
    })


@router.put("/api/mpl/product-master")
@serialized_data_access
async def save_mpl_product_master(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    rows = _payload_rows(payload)
    try:
        rows = _prepare_product_configurations(rows)
        _validate_configuration_rows(rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows = _dedupe_product_master_rows(rows)
    return _save_reference_table(request, payload, rows, "mpl_product_master",
                                 _datastore_load_product_master, _shared_product_master_file_read,
                                 _datastore_save_product_master, _product_master_file_write, MPL_PRODUCT_MASTER_FILE,
                                 _product_row_key)


@router.get("/api/kehe/dc-directory")
@serialized_data_access
async def get_kehe_dc_directory(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows, source = _load_reference_rows(request, _datastore_load_dc_directory, _shared_dc_directory_file_read)
    rows = _kehe_dc_directory_rows(rows)

    return JSONResponse(content={"rows": rows, "source": source, "revision": reference_revision(rows)})


@router.put("/api/kehe/dc-directory")
async def save_kehe_dc_directory(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    raise HTTPException(
        status_code=405,
        detail="KeHE DC Directory is read-only. Edit shared rows from Packing List & Ti-Hi Directory.",
    )


@router.get("/api/mpl/directory")
@serialized_data_access
async def get_mpl_directory(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows, source = _load_reference_rows(request, _datastore_load_dc_directory, _shared_dc_directory_file_read)

    return JSONResponse(content={"rows": rows, "source": source, "revision": reference_revision(rows)})


@router.put("/api/mpl/directory")
@serialized_data_access
async def save_mpl_directory(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    rows = _payload_rows(payload)
    return _save_reference_table(request, payload, _dedupe_dc_directory_rows(rows), "mpl_directory",
                                 _datastore_load_dc_directory, _shared_dc_directory_file_read,
                                 _datastore_save_dc_directory, _dc_directory_file_write, MPL_DIRECTORY_FILE,
                                 _dc_row_key)


@router.get("/api/kehe/audit-log")
async def get_kehe_audit_log(request: Request, limit: int = 200, table: str = "") -> JSONResponse:
    _require_permission(request, "audit_view")
    safe_limit = min(max(int(limit or 200), 1), 1000)
    return JSONResponse(content={"entries": _audit_log_read(limit=safe_limit, table=table, request=request)})


@router.post("/api/mpl/product-master/import-preview")
async def preview_mpl_product_master_import(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    return await _preview_excel_import(request, file, "mpl_product_master")


@router.post("/api/mpl/directory/import-preview")
async def preview_mpl_directory_import(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    return await _preview_excel_import(request, file, "mpl_directory")


@router.post("/api/mpl/product-master/import-confirm")
@serialized_data_access
async def confirm_mpl_product_master_import(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    imported_rows = _payload_rows(payload)
    current_rows = _datastore_load_product_master(request)
    if current_rows is None:
        current_rows = _shared_product_master_file_read()
    try:
        # Resolve and validate the whole upload before canonicalization dedupes.
        imported_rows = _prepare_product_import_rows(imported_rows, current_rows)
        _validate_configuration_rows(imported_rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    merged_rows = _merge_import_rows(current_rows, imported_rows, _product_row_key)
    return await save_mpl_product_master(request, {
        "rows": merged_rows,
        "expected_revision": reference_revision(current_rows),
        "source": "excel_import",
        "batch_id": str(payload.get("batch_id") or uuid.uuid4().hex),
        "filename": str(payload.get("filename") or ""),
    })


@router.post("/api/mpl/directory/import-confirm")
@serialized_data_access
async def confirm_mpl_directory_import(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    imported_rows = _payload_rows(payload)
    imported_rows = _canonicalize_import_rows([r for r in imported_rows if isinstance(r, dict)], "mpl_directory")
    current_rows = _datastore_load_dc_directory(request)
    if current_rows is None:
        current_rows = _shared_dc_directory_file_read()
    _apply_shared_directory_ship_from(imported_rows, current_rows)
    merged_rows = _merge_import_rows(current_rows, imported_rows, _dc_row_key)
    return await save_mpl_directory(request, {
        "rows": merged_rows,
        "expected_revision": reference_revision(current_rows),
        "source": "excel_import",
        "batch_id": str(payload.get("batch_id") or uuid.uuid4().hex),
        "filename": str(payload.get("filename") or ""),
    })
