"""
Merged LabelKit backend
-----------------------
This FastAPI app merges two related workflows without mixing their PDF/XML logic.

BACKEND MAP
- /generate/michaels -> Michaels XML + shipping-label PDF workflow.
- /generate/kehe     -> KeHE XML-only GS1 label workflow.
- /results/{id}/*    -> shared async status/report/file endpoints used by both workflows.

The frontend lives in frontend/dist/index.html and calls the kit-specific backend
endpoint selected by the user.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import fitz
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# BACKEND SECTION 1: import the two separate processing engines.
# Do not merge these modules. Michaels and KeHE parse/render labels differently.
# ---------------------------------------------------------------------------
from pipelines.michaels_label_pipeline import (  # noqa: E402
    MatchFailureError as MichaelsMatchFailureError,
    run_pipeline as run_michaels_pipeline,
)
from pipelines.kehe_pipeline import (  # noqa: E402
    MatchFailureError as KeheMatchFailureError,
    run_pipeline as run_kehe_pipeline,
    build_kehe_master_packing_list_draft,
    build_kehe_pallet_label_draft,
    render_kehe_master_packing_list_pdf,
    render_kehe_pallet_label_pdf,
)

MatchFailureErrors = (MichaelsMatchFailureError, KeheMatchFailureError)

# ---------------------------------------------------------------------------
# BACKEND SECTION 2: shared app configuration and static frontend hosting.
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
FRONTEND_ASSETS = FRONTEND_DIST / "assets"
DEFAULT_PORT = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT", os.getenv("PORT", "9000")))
APP_NAME = "Merged LabelKit"
APP_ID = "merged-labelkit"
MAX_CACHED_REPORTS = 25

RESULT_REPORTS: Dict[str, Dict[str, Any]] = {}
RESULT_JOBS: Dict[str, Dict[str, Any]] = {}

KIT_CONFIG: Dict[str, Dict[str, str]] = {
    "michaels": {
        "label": "Michaels Label Kit",
        "output_filename": "michaels_rollo_output.pdf",
        "temp_prefix": "michaels_labelkit_",
    },
    "kehe": {
        "label": "KeHE Label Kit",
        "output_filename": "kehe_gs1_labels.pdf",
        "temp_prefix": "kehe_labelkit_",
    },
    "kehe_pallet_label": {
        "label": "KeHE Pallet Label",
        "output_filename": "kehe_pallet_labels.pdf",
        "temp_prefix": "kehe_pallet_label_",
    },
    "kehe_master_packing_list": {
        "label": "KeHE Master Packing List",
        "output_filename": "kehe_master_packing_list.pdf",
        "temp_prefix": "kehe_master_packing_list_",
    },
}

app = FastAPI(title=f"{APP_NAME} API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_ASSETS.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_ASSETS)), name="assets")


@app.get("/")
async def root() -> HTMLResponse:
    return serve_frontend_index()


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "app": APP_NAME,
        "app_id": APP_ID,
        "frontend_found": (FRONTEND_DIST / "index.html").exists(),
        "frontend_entry": "frontend/dist/index.html",
        "backend_entry": "server.py",
        "available_kits": {
            "michaels": "XML + shipping-label PDF matching workflow",
            "kehe": "XML-only GS1 label workflow",
        },
    }


# ---------------------------------------------------------------------------
# BACKEND SECTION 3: shared job cache used by both kit workflows.
# ---------------------------------------------------------------------------
def _prune_old_results() -> None:
    while len(RESULT_JOBS) > MAX_CACHED_REPORTS:
        oldest_key = next(iter(RESULT_JOBS))
        job = RESULT_JOBS.pop(oldest_key, None)
        RESULT_REPORTS.pop(oldest_key, None)
        if job and job.get("temp_dir"):
            shutil.rmtree(job["temp_dir"], ignore_errors=True)


def create_result_job(temp_dir: Path, kit: str, output_filename: Optional[str] = None) -> str:
    result_id = uuid.uuid4().hex
    RESULT_JOBS[result_id] = {
        "kit": kit,
        "status": "processing",
        "detail": "Files uploaded. Starting generation…",
        "report": None,
        "output_path": None,
        "output_filename": output_filename,
        "temp_dir": str(temp_dir),
        "created_at": time.time(),
    }
    _prune_old_results()
    return result_id


def update_result_job(result_id: str, **changes: Any) -> None:
    job = RESULT_JOBS.get(result_id)
    if job is not None:
        job.update(changes)


# ---------------------------------------------------------------------------
# BACKEND SECTION 4A: Michaels worker.
# Requires XML files and shipping-label PDF files. It uses OCR/matching.
# ---------------------------------------------------------------------------
def run_michaels_generation_job(result_id: str, xml_paths: List[str], pdf_paths: List[str]) -> None:
    job = RESULT_JOBS[result_id]
    temp_dir = Path(job["temp_dir"])
    output_path = temp_dir / KIT_CONFIG["michaels"]["output_filename"]

    try:
        update_result_job(result_id, detail="Combining Michaels shipping-label PDFs…")
        shipping_pdf_path = combine_shipping_pdfs(
            [Path(p) for p in pdf_paths],
            temp_dir / "combined_shipping_labels.pdf",
        )

        def _progress(message: str) -> None:
            update_result_job(result_id, detail=message)

        update_result_job(result_id, detail="Matching Michaels shipping-label pages to XML packs…")
        report = run_michaels_pipeline(
            xml_paths=xml_paths,
            out_pdf=str(output_path),
            shipping_pdf_path=str(shipping_pdf_path),
            progress_callback=_progress,
        )

        if not output_path.exists():
            raise RuntimeError("Output PDF was not generated.")

        RESULT_REPORTS[result_id] = report
        update_result_job(
            result_id,
            status="complete",
            detail="Michaels labels generated successfully.",
            report=report,
            output_path=str(output_path),
        )
    except MatchFailureErrors as exc:
        RESULT_REPORTS[result_id] = exc.report or {}
        update_result_job(result_id, status="error", detail=str(exc), report=exc.report)
    except ValueError as exc:
        update_result_job(result_id, status="error", detail=str(exc))
    except Exception as exc:
        update_result_job(result_id, status="error", detail=str(exc))


# ---------------------------------------------------------------------------
# BACKEND SECTION 4B: KeHE worker.
# Requires XML files only. Shipping-label PDFs are intentionally not used.
# ---------------------------------------------------------------------------
def run_kehe_generation_job(result_id: str, xml_paths: List[str]) -> None:
    job = RESULT_JOBS[result_id]
    temp_dir = Path(job["temp_dir"])
    output_path = temp_dir / KIT_CONFIG["kehe"]["output_filename"]

    try:
        def _progress(message: str) -> None:
            update_result_job(result_id, detail=message)

        update_result_job(result_id, detail="Generating KeHE GS1 labels from XML…")
        report = run_kehe_pipeline(
            xml_paths=xml_paths,
            out_pdf=str(output_path),
            progress_callback=_progress,
        )

        if not output_path.exists():
            raise RuntimeError("Output PDF was not generated.")

        RESULT_REPORTS[result_id] = report
        update_result_job(
            result_id,
            status="complete",
            detail="KeHE labels generated successfully.",
            report=report,
            output_path=str(output_path),
        )
    except MatchFailureErrors as exc:
        RESULT_REPORTS[result_id] = exc.report or {}
        update_result_job(result_id, status="error", detail=str(exc), report=exc.report)
    except ValueError as exc:
        update_result_job(result_id, status="error", detail=str(exc))
    except Exception as exc:
        update_result_job(result_id, status="error", detail=str(exc))


# ---------------------------------------------------------------------------
# BACKEND SECTION 5: shared result endpoints for frontend polling/download.
# ---------------------------------------------------------------------------
@app.get("/results/{result_id}/status")
def get_result_status(result_id: str) -> JSONResponse:
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
        }
    )


@app.get("/results/{result_id}/report")
def get_result_report(result_id: str) -> JSONResponse:
    report = RESULT_REPORTS.get(result_id)
    if report is None:
        job = RESULT_JOBS.get(result_id)
        if job is not None:
            report = job.get("report")
    if report is None:
        raise HTTPException(status_code=404, detail="Match report not found.")
    return JSONResponse(content=report)


@app.get("/results/{result_id}/file")
def get_result_file(result_id: str) -> FileResponse:
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
        media_type="application/pdf",
        filename=filename,
        headers={"Access-Control-Expose-Headers": "X-Result-Id"},
    )


# ---------------------------------------------------------------------------
# BACKEND SECTION 6: kit-specific generation endpoints.
# Frontend buttons choose one of these endpoints.
# ---------------------------------------------------------------------------
@app.post("/generate/{kit}")
async def generate_for_kit(
    kit: str,
    xml_files: List[UploadFile] = File(...),
    pdf_files: Optional[List[UploadFile]] = File(default=None),
    mode: Optional[str] = Form(default="xml"),
) -> JSONResponse:
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

        for upload in xml_files:
            if not (upload.filename or "").lower().endswith(".xml"):
                raise HTTPException(status_code=400, detail=f"Invalid XML file: {upload.filename}")
            out_path = temp_dir / sanitize_filename(upload.filename or "input.xml")
            await save_upload_file(upload, out_path)
            xml_paths.append(str(out_path))

        if pdf_files:
            for upload in pdf_files:
                if not (upload.filename or "").lower().endswith(".pdf"):
                    raise HTTPException(status_code=400, detail=f"Invalid PDF file: {upload.filename}")
                out_path = temp_dir / sanitize_filename(upload.filename or "label.pdf")
                await save_upload_file(upload, out_path)
                pdf_paths.append(str(out_path))

        result_id = create_result_job(temp_dir, kit)
        if kit == "michaels":
            worker = threading.Thread(
                target=run_michaels_generation_job,
                args=(result_id, xml_paths, pdf_paths),
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


# ---------------------------------------------------------------------------
# BACKEND SECTION 6B: KeHE document prepare endpoints (draft JSON only).
# These parse XML and return editable JSON. They do NOT generate PDFs.
# ---------------------------------------------------------------------------
@app.post("/prepare/kehe/pallet-label")
async def prepare_kehe_pallet_label(
    xml_files: List[UploadFile] = File(...),
) -> JSONResponse:
    if not xml_files:
        raise HTTPException(status_code=400, detail="At least one XML file is required.")
    temp_dir = Path(tempfile.mkdtemp(prefix="kehe_pallet_prepare_"))
    try:
        xml_paths: List[str] = []
        for upload in xml_files:
            if not (upload.filename or "").lower().endswith(".xml"):
                raise HTTPException(status_code=400, detail=f"Invalid XML file: {upload.filename}")
            out_path = temp_dir / sanitize_filename(upload.filename or "input.xml")
            await save_upload_file(upload, out_path)
            xml_paths.append(str(out_path))
        draft = build_kehe_pallet_label_draft(xml_paths)
        # Attach extracted_headers for the frontend Extracted Data table
        draft["extracted_headers"] = [
            {
                "source_file":             p.get("id", ""),
                "customer_po_numbers":     p.get("customer_po_numbers", ""),
                "pro_number":              p.get("pro_number", ""),
                "bol_number":              p.get("bol_number", ""),
                "ship_date":               p.get("date", ""),
                "expected_delivery_date":  p.get("expected_delivery_date", ""),
                "carrier":                 p.get("carrier", ""),
                "total_weight":            "",
                "carton_count":            p.get("carton_count", ""),
                "total_pallets":           p.get("total_pallets", ""),
                "ship_via":                p.get("carrier", ""),
                "dc":                      p.get("dc", ""),
                "ship_to_name":            (p.get("ship_to") or "").split("\n")[0],
            }
            for p in (draft.get("pallets") or [])
        ]
        return JSONResponse(content=draft)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/prepare/kehe/master-packing-list")
async def prepare_kehe_master_packing_list(
    xml_files: List[UploadFile] = File(...),
) -> JSONResponse:
    if not xml_files:
        raise HTTPException(status_code=400, detail="At least one XML file is required.")
    temp_dir = Path(tempfile.mkdtemp(prefix="kehe_mpl_prepare_"))
    try:
        xml_paths: List[str] = []
        for upload in xml_files:
            if not (upload.filename or "").lower().endswith(".xml"):
                raise HTTPException(status_code=400, detail=f"Invalid XML file: {upload.filename}")
            out_path = temp_dir / sanitize_filename(upload.filename or "input.xml")
            await save_upload_file(upload, out_path)
            xml_paths.append(str(out_path))
        draft = build_kehe_master_packing_list_draft(xml_paths)
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
        return JSONResponse(content=draft)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# BACKEND SECTION 6C: KeHE document render workers.
# ---------------------------------------------------------------------------
def run_kehe_pallet_label_render_job(result_id: str, draft: Dict[str, Any]) -> None:
    job = RESULT_JOBS[result_id]
    temp_dir = Path(job["temp_dir"])
    output_path = temp_dir / KIT_CONFIG["kehe_pallet_label"]["output_filename"]
    try:
        def _progress(message: str) -> None:
            update_result_job(result_id, detail=message)

        update_result_job(result_id, detail="Rendering edited KeHE Pallet Label PDF\u2026")
        report = render_kehe_pallet_label_pdf(
            draft=draft,
            out_pdf=str(output_path),
            progress_callback=_progress,
        )
        if not output_path.exists():
            raise RuntimeError("Output PDF was not generated.")
        RESULT_REPORTS[result_id] = report
        update_result_job(
            result_id,
            status="complete",
            detail="KeHE Pallet Label generated successfully.",
            report=report,
            output_path=str(output_path),
        )
    except Exception as exc:
        update_result_job(result_id, status="error", detail=str(exc))


def run_kehe_master_packing_list_render_job(result_id: str, draft: Dict[str, Any]) -> None:
    job = RESULT_JOBS[result_id]
    temp_dir = Path(job["temp_dir"])
    output_path = temp_dir / KIT_CONFIG["kehe_master_packing_list"]["output_filename"]
    try:
        def _progress(message: str) -> None:
            update_result_job(result_id, detail=message)

        update_result_job(result_id, detail="Rendering edited KeHE Master Packing List PDF\u2026")
        report = render_kehe_master_packing_list_pdf(
            draft=draft,
            out_pdf=str(output_path),
            progress_callback=_progress,
        )
        if not output_path.exists():
            raise RuntimeError("Output PDF was not generated.")
        RESULT_REPORTS[result_id] = report
        update_result_job(
            result_id,
            status="complete",
            detail="KeHE Master Packing List generated successfully.",
            report=report,
            output_path=str(output_path),
        )
    except Exception as exc:
        update_result_job(result_id, status="error", detail=str(exc))


# ---------------------------------------------------------------------------
# BACKEND SECTION 6D: KeHE document render endpoints.
# ---------------------------------------------------------------------------
@app.post("/render/kehe/pallet-label")
async def render_kehe_pallet_label_endpoint(draft: Dict[str, Any]) -> JSONResponse:
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


@app.post("/render/kehe/master-packing-list")
async def render_kehe_master_packing_list_endpoint(draft: Dict[str, Any]) -> JSONResponse:
    temp_dir = Path(tempfile.mkdtemp(prefix=KIT_CONFIG["kehe_master_packing_list"]["temp_prefix"]))
    result_id = create_result_job(
        temp_dir,
        "kehe_master_packing_list",
        output_filename=KIT_CONFIG["kehe_master_packing_list"]["output_filename"],
    )
    worker = threading.Thread(
        target=run_kehe_master_packing_list_render_job,
        args=(result_id, draft),
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


@app.post("/generate")
async def generate_compat(
    label_kit: Optional[str] = Form(default=None),
    kit: Optional[str] = Form(default=None),
    xml_files: List[UploadFile] = File(...),
    pdf_files: Optional[List[UploadFile]] = File(default=None),
    mode: Optional[str] = Form(default="xml"),
) -> JSONResponse:
    """Backward-compatible endpoint.

    New frontend code should call /generate/michaels or /generate/kehe directly.
    This endpoint guesses Michaels when PDFs are included, otherwise KeHE.
    """
    selected_kit = normalize_kit(label_kit or kit or ("michaels" if pdf_files else "kehe"))
    return await generate_for_kit(
        kit=selected_kit,
        xml_files=xml_files,
        pdf_files=pdf_files,
        mode=mode,
    )


# ---------------------------------------------------------------------------
# BACKEND SECTION 7: utility helpers.
# ---------------------------------------------------------------------------
async def save_upload_file(upload: UploadFile, destination: Path) -> None:
    with destination.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    await upload.close()


def combine_shipping_pdfs(pdf_paths: List[Path], combined_path: Path) -> Path:
    if len(pdf_paths) == 1:
        return pdf_paths[0]

    merged = fitz.open()
    try:
        for pdf_path in pdf_paths:
            src = fitz.open(pdf_path)
            try:
                merged.insert_pdf(src)
            finally:
                src.close()
        merged.save(combined_path)
    finally:
        merged.close()
    return combined_path


def sanitize_filename(name: str) -> str:
    keep = []
    for ch in name:
        if ch.isalnum() or ch in ("-", "_", ".", " "):
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep)


def normalize_kit(value: str) -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    aliases = {
        "michael": "michaels",
        "michaels-label-kit": "michaels",
        "michaels-labelkit": "michaels",
        "michaels-dts": "michaels",
        "kehe-label-kit": "kehe",
        "kehe-labelkit": "kehe",
        "kehe-gs1": "kehe",
    }
    return aliases.get(normalized, normalized)


def serve_frontend_index() -> HTMLResponse:
    index_path = FRONTEND_DIST / "index.html"
    if not index_path.exists():
        return HTMLResponse(
            "<h1>Frontend build not found</h1>"
            "<p>The bundled frontend/dist folder is missing.</p>",
            status_code=500,
        )
    html = index_path.read_text(encoding="utf-8")
    return HTMLResponse(html, media_type="text/html")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request):
    _ = request
    if full_path.startswith(("generate", "prepare", "render", "results", "health", "docs", "openapi.json", "redoc", "accounts/")):
        raise HTTPException(status_code=404, detail="Not found")

    requested_path = FRONTEND_DIST / full_path
    if requested_path.is_file():
        return FileResponse(requested_path)

    return serve_frontend_index()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=DEFAULT_PORT,
        reload=False,
        log_level="info",
    )


