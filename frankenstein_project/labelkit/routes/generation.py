"""Result polling, Michaels/KeHE generation, and KeHE render routes."""

from __future__ import annotations

import copy
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from labelkit.directory_store import _sync_kehe_dc_directory_for_pipeline
from labelkit.file_operations import (
    normalize_kit,
    sanitize_filename,
    save_upload_file,
    unique_upload_destination,
)
from labelkit.jobs import (
    RESULT_JOBS,
    RESULT_REPORTS,
    create_result_job,
    run_kehe_generation_job,
    run_kehe_master_packing_list_render_job,
    run_kehe_pack_label_render_job,
    run_kehe_pallet_label_render_job,
    run_michaels_generation_job,
)
from labelkit.product_store import _datastore_load_product_master, _shared_product_master_file_read
from labelkit.reference_data import (
    _dedupe_product_master_rows,
    _kehe_product_master_rows,
    parse_product_master_json,
)
from labelkit.runtime import KIT_CONFIG, LOGGER, _require_permission
from pipelines.kehe_pipeline import (
    apply_product_master_to_mpl_draft,
    build_kehe_master_packing_list_draft,
    build_kehe_pack_label_draft,
    build_kehe_pallet_label_draft,
)


router = APIRouter()


@router.get("/results/{result_id}/status")
def get_result_status(request: Request, result_id: str) -> JSONResponse:
    _require_permission(request, "view")
    job = RESULT_JOBS.get(result_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generation result not found.")

    return JSONResponse(
        content={
            "result_id": result_id,
            "kit": job.get("kit"),
            "status": job.get("status", "processing"),
            "detail": job.get("detail", "Processing…"),
            "report": job.get("report"),
            "file_ready": bool(job.get("output_path")),
            "output_filename": job.get("output_filename"),
            "media_type": job.get("media_type", "application/pdf"),
            "preview_ready": bool(job.get("preview_path") or job.get("output_path")),
            "separate_output_names": job.get("separate_output_names", []),
        }
    )


@router.get("/results/{result_id}/report")
def get_result_report(request: Request, result_id: str) -> JSONResponse:
    _require_permission(request, "view")
    report = RESULT_REPORTS.get(result_id)
    if report is None:
        job = RESULT_JOBS.get(result_id)
        if job is not None:
            report = job.get("report")
    if report is None:
        raise HTTPException(status_code=404, detail="Match report not found.")
    return JSONResponse(content=report)


@router.get("/results/{result_id}/file")
def get_result_file(request: Request, result_id: str) -> FileResponse:
    _require_permission(request, "view")
    job = RESULT_JOBS.get(result_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generated file not found.")
    if job.get("status") != "complete" or not job.get("output_path"):
        raise HTTPException(status_code=409, detail="PDF is not ready yet.")

    kit = str(job.get("kit") or "michaels")
    filename = (
        job.get("output_filename")
        or KIT_CONFIG.get(kit, KIT_CONFIG["michaels"])["output_filename"]
    )
    return FileResponse(
        path=job["output_path"],
        media_type=str(job.get("media_type") or "application/pdf"),
        filename=filename,
        headers={"Access-Control-Expose-Headers": "X-Result-Id"},
    )


@router.get("/results/{result_id}/preview")
def get_result_preview(request: Request, result_id: str) -> FileResponse:
    _require_permission(request, "view")
    job = RESULT_JOBS.get(result_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generated preview not found.")
    preview_path = job.get("preview_path") or job.get("output_path")
    if job.get("status") != "complete" or not preview_path:
        raise HTTPException(status_code=409, detail="PDF preview is not ready yet.")
    return FileResponse(
        path=preview_path,
        media_type="application/pdf",
        filename="michaels_combined_preview.pdf",
        headers={"Access-Control-Expose-Headers": "X-Result-Id"},
    )


@router.post("/generate/{kit}")
async def generate_for_kit(
    kit: str,
    request: Request,
    xml_files: List[UploadFile] = File(...),
    pdf_files: Optional[List[UploadFile]] = File(default=None),
    mode: Optional[str] = Form(default="xml"),
    group_by_pdf: bool = Form(default=True),
) -> JSONResponse:
    _require_permission(request, "generate")
    kit = normalize_kit(kit)
    if kit not in KIT_CONFIG:
        raise HTTPException(status_code=404, detail="Unknown label kit. Use 'michaels' or 'kehe'.")
    if not xml_files:
        raise HTTPException(status_code=400, detail="At least one XML file is required.")
    if kit == "michaels" and not pdf_files:
        raise HTTPException(status_code=400, detail="Michaels requires at least one shipping-label PDF file.")

    # mode is accepted for compatibility with older frontend bundles.
    _ = mode

    temp_dir = Path(tempfile.mkdtemp(prefix=KIT_CONFIG[kit]["temp_prefix"]))
    try:
        xml_paths: List[str] = []
        pdf_paths: List[str] = []
        pdf_display_names: List[str] = []
        reserved_upload_names: set[str] = set()

        for upload in xml_files:
            if not (upload.filename or "").lower().endswith(".xml"):
                raise HTTPException(status_code=400, detail=f"Invalid XML file: {upload.filename}")
            out_path = unique_upload_destination(
                temp_dir,
                upload.filename or "input.xml",
                reserved_upload_names,
            )
            await save_upload_file(upload, out_path)
            xml_paths.append(str(out_path))

        if pdf_files:
            for upload in pdf_files:
                if not (upload.filename or "").lower().endswith(".pdf"):
                    raise HTTPException(status_code=400, detail=f"Invalid PDF file: {upload.filename}")
                display_name = (upload.filename or "label.pdf").replace("\\", "/").rsplit("/", 1)[-1]
                pdf_display_names.append(display_name.strip() or "label.pdf")
                out_path = unique_upload_destination(
                    temp_dir,
                    upload.filename or "label.pdf",
                    reserved_upload_names,
                )
                await save_upload_file(upload, out_path)
                pdf_paths.append(str(out_path))

        result_id = create_result_job(temp_dir, kit)
        if kit == "michaels":
            worker = threading.Thread(
                target=run_michaels_generation_job,
                args=(result_id, xml_paths, pdf_paths, group_by_pdf, pdf_display_names),
                daemon=True,
            )
        else:
            worker = threading.Thread(
                target=run_kehe_generation_job,
                args=(result_id, xml_paths),
                daemon=True,
            )
        worker.start()

        return JSONResponse(
            content={
                "result_id": result_id,
                "kit": kit,
                "status": "processing",
                "detail": f"{KIT_CONFIG[kit]['label']} generation started…",
            },
            headers={
                "X-Result-Id": result_id,
                "Access-Control-Expose-Headers": "X-Result-Id",
            },
        )
    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return JSONResponse(status_code=500, content={"detail": str(exc)})


async def _with_kehe_prepare_xml_files(
    xml_files: List[UploadFile],
    *,
    temp_prefix: str,
    error_message: str,
    operation: Callable[[List[str]], Dict[str, Any]],
) -> JSONResponse:
    if not xml_files:
        raise HTTPException(status_code=400, detail="At least one XML file is required.")
    temp_dir = Path(tempfile.mkdtemp(prefix=temp_prefix))
    try:
        xml_paths: List[str] = []
        for upload in xml_files:
            if not (upload.filename or "").lower().endswith(".xml"):
                raise HTTPException(status_code=400, detail=f"Invalid XML file: {upload.filename}")
            out_path = temp_dir / sanitize_filename(upload.filename or "input.xml")
            await save_upload_file(upload, out_path)
            xml_paths.append(str(out_path))
        return JSONResponse(content=operation(xml_paths))
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception("%s", error_message)
        raise HTTPException(status_code=500, detail=f"{error_message}: {str(exc)}") from exc
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/prepare/kehe/pallet-label")
async def prepare_kehe_pallet_label(
    request: Request,
    xml_files: List[UploadFile] = File(...),
) -> JSONResponse:
    _require_permission(request, "generate")
    def build_draft(xml_paths: List[str]) -> Dict[str, Any]:
        _sync_kehe_dc_directory_for_pipeline(request)
        draft = build_kehe_pallet_label_draft(xml_paths)
        draft["extracted_headers"] = [
            {
                "source_file": pallet.get("id", ""),
                "customer_po_numbers": pallet.get("customer_po_numbers", ""),
                "pro_number": pallet.get("pro_number", ""),
                "bol_number": pallet.get("bol_number", ""),
                "ship_date": pallet.get("date", ""),
                "expected_delivery_date": pallet.get("expected_delivery_date", ""),
                "carrier": pallet.get("carrier", ""),
                "total_weight": "",
                "carton_count": pallet.get("carton_count", ""),
                "total_pallets": pallet.get("total_pallets", ""),
                "ship_via": pallet.get("carrier", ""),
                "dc": pallet.get("dc", ""),
                "ship_to_name": (pallet.get("ship_to") or "").split("\n")[0],
            }
            for pallet in (draft.get("pallets") or [])
        ]
        return draft

    return await _with_kehe_prepare_xml_files(
        xml_files,
        temp_prefix="kehe_pallet_prepare_",
        error_message="Error preparing pallet label draft",
        operation=build_draft,
    )


@router.post("/prepare/kehe/master-packing-list")
async def prepare_kehe_master_packing_list(
    request: Request,
    xml_files: List[UploadFile] = File(...),
    product_master_json: Optional[str] = Form(default="[]"),
) -> JSONResponse:
    _require_permission(request, "generate")

    def build_draft(xml_paths: List[str]) -> Dict[str, Any]:
        product_master_rows = parse_product_master_json(product_master_json)
        if not product_master_rows:
            product_master_rows = _datastore_load_product_master(request)
            if product_master_rows is None:
                product_master_rows = _shared_product_master_file_read()
            product_master_rows = _kehe_product_master_rows(product_master_rows)
        else:
            product_master_rows = _kehe_product_master_rows(product_master_rows)
        _sync_kehe_dc_directory_for_pipeline(request)
        draft = build_kehe_master_packing_list_draft(xml_paths, product_master_rows=product_master_rows)
        # Attach extracted_headers for the frontend Extracted Data table
        draft["extracted_headers"] = [
            {
                "source_file":             (m.get("source_files") or [""])[0],
                "customer_po_numbers":     m.get("customer_po_number", ""),
                "pro_number":              m.get("pro_number", ""),
                "bol_number":              "",
                "ship_date":               m.get("est_ship_date", ""),
                "expected_delivery_date":  m.get("expected_delivery_date", ""),
                "carrier":                 m.get("ship_via", ""),
                "total_weight":            m.get("total_weight", ""),
                "carton_count":            str(len(m.get("items") or [])),
                "total_pallets":           m.get("total_pallets", ""),
                "ship_via":                m.get("ship_via", ""),
                "dc":                      m.get("dc", ""),
                "ship_to_name":            (m.get("ship_to") or "").split("\n")[0],
            }
            for m in (draft.get("packing_lists") or [])
        ]
        return draft

    return await _with_kehe_prepare_xml_files(
        xml_files,
        temp_prefix="kehe_mpl_prepare_",
        error_message="Error preparing master packing list draft",
        operation=build_draft,
    )


@router.post("/prepare/kehe/pack-labels")
async def prepare_kehe_pack_labels(
    request: Request,
    xml_files: List[UploadFile] = File(...),
    product_master_json: Optional[str] = Form(default="[]"),
) -> JSONResponse:
    _require_permission(request, "generate")

    def build_draft(xml_paths: List[str]) -> Dict[str, Any]:
        product_master_rows = parse_product_master_json(product_master_json)
        if not product_master_rows:
            product_master_rows = _datastore_load_product_master(request)
            if product_master_rows is None:
                product_master_rows = _shared_product_master_file_read()
            product_master_rows = _kehe_product_master_rows(product_master_rows)
        else:
            product_master_rows = _kehe_product_master_rows(product_master_rows)
        _sync_kehe_dc_directory_for_pipeline(request)
        return build_kehe_pack_label_draft(xml_paths, product_master_rows=product_master_rows)

    return await _with_kehe_prepare_xml_files(
        xml_files,
        temp_prefix="kehe_pack_labels_prepare_",
        error_message="Error preparing pack label draft",
        operation=build_draft,
    )


def _refresh_mpl_render_product_master(
    request: Request,
    draft: Dict[str, Any],
) -> Dict[str, Any]:
    """Attach authoritative Product Master rows before starting an MPL render.

    Saved and open drafts can contain an older Product Master snapshot. The
    render worker must use the same current Datastore rows shown in the Product
    Master editor so a valid Each GTIN is not cleared by stale draft data.
    """
    refreshed_draft = copy.deepcopy(draft)
    product_master_rows = _datastore_load_product_master(request)
    if product_master_rows is None:
        product_master_rows = _shared_product_master_file_read()
    refreshed_draft["product_master"] = _dedupe_product_master_rows(product_master_rows)
    apply_product_master_to_mpl_draft(refreshed_draft, force=False)
    return refreshed_draft


@router.post("/render/kehe/pallet-label")
async def render_kehe_pallet_label_endpoint(request: Request, draft: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "generate")
    temp_dir = Path(tempfile.mkdtemp(prefix=KIT_CONFIG["kehe_pallet_label"]["temp_prefix"]))
    result_id = create_result_job(
        temp_dir,
        "kehe_pallet_label",
        output_filename=KIT_CONFIG["kehe_pallet_label"]["output_filename"],
    )
    worker = threading.Thread(
        target=run_kehe_pallet_label_render_job,
        args=(result_id, draft),
        daemon=True,
    )
    worker.start()
    return JSONResponse(
        content={
            "result_id": result_id,
            "kit": "kehe_pallet_label",
            "status": "processing",
            "detail": "KeHE Pallet Label generation started\u2026",
        },
        headers={
            "X-Result-Id": result_id,
            "Access-Control-Expose-Headers": "X-Result-Id",
        },
    )


@router.post("/render/kehe/master-packing-list")
async def render_kehe_master_packing_list_endpoint(request: Request, draft: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "generate")
    render_draft = _refresh_mpl_render_product_master(request, draft)
    temp_dir = Path(tempfile.mkdtemp(prefix=KIT_CONFIG["kehe_master_packing_list"]["temp_prefix"]))
    result_id = create_result_job(
        temp_dir,
        "kehe_master_packing_list",
        output_filename=KIT_CONFIG["kehe_master_packing_list"]["output_filename"],
    )
    worker = threading.Thread(
        target=run_kehe_master_packing_list_render_job,
        args=(result_id, render_draft),
        daemon=True,
    )
    worker.start()
    return JSONResponse(
        content={
            "result_id": result_id,
            "kit": "kehe_master_packing_list",
            "status": "processing",
            "detail": "KeHE Master Packing List generation started\u2026",
        },
        headers={
            "X-Result-Id": result_id,
            "Access-Control-Expose-Headers": "X-Result-Id",
        },
    )


@router.post("/render/kehe/pack-labels")
async def render_kehe_pack_labels_endpoint(request: Request, draft: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "generate")
    temp_dir = Path(tempfile.mkdtemp(prefix=KIT_CONFIG["kehe_pack_labels"]["temp_prefix"]))
    result_id = create_result_job(
        temp_dir,
        "kehe_pack_labels",
        output_filename=KIT_CONFIG["kehe_pack_labels"]["output_filename"],
    )
    worker = threading.Thread(
        target=run_kehe_pack_label_render_job,
        args=(result_id, draft),
        daemon=True,
    )
    worker.start()
    return JSONResponse(
        content={
            "result_id": result_id,
            "kit": "kehe_pack_labels",
            "status": "processing",
            "detail": "KeHE Pack Labels generation started…",
        },
        headers={
            "X-Result-Id": result_id,
            "Access-Control-Expose-Headers": "X-Result-Id",
        },
    )
