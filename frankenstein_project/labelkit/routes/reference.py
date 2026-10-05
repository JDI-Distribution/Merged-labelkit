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
)
from labelkit.reference_import import (
    _apply_shared_directory_ship_from,
    _canonicalize_import_rows,
    _merge_import_rows,
    _preview_excel_import,
)
from labelkit.runtime import MPL_DIRECTORY_FILE, MPL_PRODUCT_MASTER_FILE, _require_permission


router = APIRouter()


@router.get("/api/kehe/product-master")
async def get_kehe_product_master(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows = _datastore_load_product_master(request)
    source = "datastore"
    if rows is None:
        rows = _shared_product_master_file_read()
        source = "file"
    rows = _kehe_product_master_rows(rows)
    return JSONResponse(content={"rows": rows, "source": source})


@router.put("/api/kehe/product-master")
async def save_kehe_product_master(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    raise HTTPException(
        status_code=405,
        detail="KeHE Product Master is read-only. Edit shared rows from Packing List & Ti-Hi Product Master.",
    )


@router.get("/api/mpl/product-master")
async def get_mpl_product_master(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows = _datastore_load_product_master(request)
    source = "datastore"
    if rows is None:
        rows = _shared_product_master_file_read()
        source = "file"
        if rows and not MPL_PRODUCT_MASTER_FILE.exists():
            rows = _product_master_file_write(rows, MPL_PRODUCT_MASTER_FILE)
    return JSONResponse(content={
        "rows": rows,
        "source": source,
        "quality": analyze_product_master_rows(rows),
    })


@router.put("/api/mpl/product-master")
async def save_mpl_product_master(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    rows = payload.get("rows") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []
    rows = _dedupe_product_master_rows(rows)
    source = str(payload.get("source") or "manual_edit") if isinstance(payload, dict) else "manual_edit"
    batch_id = str(payload.get("batch_id") or "") if isinstance(payload, dict) else ""
    filename = str(payload.get("filename") or "") if isinstance(payload, dict) else ""

    old_rows = _datastore_load_product_master(request)
    if old_rows is None:
        old_rows = _shared_product_master_file_read()

    saved_rows = _datastore_save_product_master(request, rows)
    storage_source = "datastore"
    if saved_rows is None:
        saved_rows = _product_master_file_write(rows, MPL_PRODUCT_MASTER_FILE)
        storage_source = "file"

    _audit_row_changes(
        request=request,
        table="mpl_product_master",
        old_rows=old_rows,
        new_rows=saved_rows,
        key_fn=_product_row_key,
        source=source,
        batch_id=batch_id,
        filename=filename,
    )

    return JSONResponse(content={"rows": saved_rows, "saved": True, "source": storage_source})


@router.get("/api/kehe/dc-directory")
async def get_kehe_dc_directory(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows = _datastore_load_dc_directory(request)
    source = "datastore"

    if rows is None:
        rows = _shared_dc_directory_file_read()
        source = "file"
    rows = _kehe_dc_directory_rows(rows)

    return JSONResponse(content={"rows": rows, "source": source})


@router.put("/api/kehe/dc-directory")
async def save_kehe_dc_directory(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    raise HTTPException(
        status_code=405,
        detail="KeHE DC Directory is read-only. Edit shared rows from Packing List & Ti-Hi Directory.",
    )


@router.get("/api/mpl/directory")
async def get_mpl_directory(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    rows = _datastore_load_dc_directory(request)
    source = "datastore"

    if rows is None:
        rows = _shared_dc_directory_file_read()
        source = "file"
        if rows and not MPL_DIRECTORY_FILE.exists():
            rows = _dc_directory_file_write(
                rows,
                MPL_DIRECTORY_FILE,
            )

    return JSONResponse(content={"rows": rows, "source": source})


@router.put("/api/mpl/directory")
async def save_mpl_directory(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    rows = payload.get("rows") if isinstance(payload, dict) else []

    if not isinstance(rows, list):
        rows = []
    source = str(payload.get("source") or "manual_edit") if isinstance(payload, dict) else "manual_edit"
    batch_id = str(payload.get("batch_id") or "") if isinstance(payload, dict) else ""
    filename = str(payload.get("filename") or "") if isinstance(payload, dict) else ""

    rows = _dedupe_dc_directory_rows(rows)
    old_rows = _datastore_load_dc_directory(request)
    if old_rows is None:
        old_rows = _shared_dc_directory_file_read()

    saved_rows = _datastore_save_dc_directory(request, rows)
    storage_source = "datastore"

    if saved_rows is None:
        saved_rows = _dc_directory_file_write(
            rows,
            MPL_DIRECTORY_FILE,
        )
        storage_source = "file"

    _audit_row_changes(
        request=request,
        table="mpl_directory",
        old_rows=old_rows,
        new_rows=saved_rows,
        key_fn=_dc_row_key,
        source=source,
        batch_id=batch_id,
        filename=filename,
    )

    return JSONResponse(content={"rows": saved_rows, "saved": True, "source": storage_source})


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
async def confirm_mpl_product_master_import(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    imported_rows = payload.get("rows") if isinstance(payload, dict) else []
    if not isinstance(imported_rows, list):
        imported_rows = []
    imported_rows = _canonicalize_import_rows([r for r in imported_rows if isinstance(r, dict)], "mpl_product_master")
    current_rows = _datastore_load_product_master(request)
    if current_rows is None:
        current_rows = _shared_product_master_file_read()
    merged_rows = _merge_import_rows(current_rows, imported_rows, _product_row_key)
    return await save_mpl_product_master(request, {
        "rows": merged_rows,
        "source": "excel_import",
        "batch_id": str(payload.get("batch_id") or uuid.uuid4().hex),
        "filename": str(payload.get("filename") or ""),
    })


@router.post("/api/mpl/directory/import-confirm")
async def confirm_mpl_directory_import(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "table_crud")
    imported_rows = payload.get("rows") if isinstance(payload, dict) else []
    if not isinstance(imported_rows, list):
        imported_rows = []
    imported_rows = _canonicalize_import_rows([r for r in imported_rows if isinstance(r, dict)], "mpl_directory")
    current_rows = _datastore_load_dc_directory(request)
    if current_rows is None:
        current_rows = _shared_dc_directory_file_read()
    _apply_shared_directory_ship_from(imported_rows, current_rows)
    merged_rows = _merge_import_rows(current_rows, imported_rows, _dc_row_key)
    return await save_mpl_directory(request, {
        "rows": merged_rows,
        "source": "excel_import",
        "batch_id": str(payload.get("batch_id") or uuid.uuid4().hex),
        "filename": str(payload.get("filename") or ""),
    })
