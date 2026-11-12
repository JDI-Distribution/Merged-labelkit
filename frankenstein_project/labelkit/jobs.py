"""In-memory result jobs and background generation workers."""

from __future__ import annotations

import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import pymupdf as fitz
from fastapi import HTTPException

from labelkit.file_operations import (
    MAX_MICHAELS_OUTPUT_PAGES,
    combine_shipping_pdfs,
    split_michaels_output_by_page_limit,
    split_michaels_output_by_shipping_pdf,
)
from labelkit.runtime import KIT_CONFIG
from pipelines.kehe_pipeline import (
    render_kehe_master_packing_list_pdf,
    render_kehe_pack_label_pdf,
    render_kehe_pallet_label_pdf,
    run_pipeline as run_kehe_pipeline,
)
from pipelines.michaels_label_pipeline import (
    MatchFailureError as MichaelsMatchFailureError,
    run_pipeline as run_michaels_pipeline,
)


MAX_CACHED_REPORTS = 25
MAX_ACTIVE_JOBS = 2


RESULT_REPORTS: Dict[str, Dict[str, Any]] = {}


RESULT_JOBS: Dict[str, Dict[str, Any]] = {}


RESULT_JOBS_LOCK = threading.RLock()


MatchFailureErrors = (MichaelsMatchFailureError,)


def _prune_old_results() -> None:
    with RESULT_JOBS_LOCK:
        while len(RESULT_JOBS) > MAX_CACHED_REPORTS:
            evictable_key = next(
                (
                    result_id
                    for result_id, job in RESULT_JOBS.items()
                    if str(job.get("status") or "").lower() != "processing" and not job.get("downloads")
                ),
                None,
            )
            if evictable_key is None:
                return
            job = RESULT_JOBS.pop(evictable_key, None)
            RESULT_REPORTS.pop(evictable_key, None)
            if job and job.get("temp_dir"):
                shutil.rmtree(job["temp_dir"], ignore_errors=True)


def create_result_job(temp_dir: Path, kit: str, output_filename: Optional[str] = None) -> str:
    result_id = uuid.uuid4().hex
    with RESULT_JOBS_LOCK:
        if sum(job.get("status") == "processing" for job in RESULT_JOBS.values()) >= MAX_ACTIVE_JOBS:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise HTTPException(status_code=429, detail="Two document jobs are already running. Wait for one to finish, then retry.")
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


def release_result_download(result_id: str) -> None:
    with RESULT_JOBS_LOCK:
        if result_id in RESULT_JOBS:
            job = RESULT_JOBS[result_id]
            job["downloads"] = max(0, job.get("downloads", 0) - 1)
    _prune_old_results()


def update_result_job(result_id: str, **changes: Any) -> None:
    with RESULT_JOBS_LOCK:
        job = RESULT_JOBS.get(result_id)
        if job is not None:
            job.update(changes)
    _prune_old_results()


def run_michaels_generation_job(
    result_id: str,
    xml_paths: List[str],
    pdf_paths: List[str],
    group_by_pdf: bool = True,
    pdf_display_names: Optional[List[str]] = None,
) -> None:
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
            group_by_shipping_pdf=group_by_pdf,
            progress_callback=_progress,
        )

        if not output_path.exists():
            raise RuntimeError("Output PDF was not generated.")
        rendered_pdf = fitz.open(output_path)
        try:
            output_page_count = rendered_pdf.page_count
        finally:
            rendered_pdf.close()

        download_path = output_path
        download_filename = KIT_CONFIG["michaels"]["output_filename"]
        download_media_type = "application/pdf"
        separate_output_names = [download_filename]
        preview_path = output_path
        page_limited_split = False
        if len(pdf_paths) > 1:
            (
                download_path,
                separate_output_names,
                preview_path,
            ) = split_michaels_output_by_shipping_pdf(
                combined_output_path=output_path,
                shipping_pdf_paths=[Path(path) for path in pdf_paths],
                shipping_pdf_names=pdf_display_names,
                report=report,
                temp_dir=temp_dir,
            )
            download_filename = "michaels_separate_outputs.zip"
            download_media_type = "application/zip"
            page_limited_split = len(separate_output_names) > len(pdf_paths)
        elif output_page_count > MAX_MICHAELS_OUTPUT_PAGES:
            download_path, separate_output_names = split_michaels_output_by_page_limit(
                    combined_output_path=output_path,
                    report=report,
                    temp_dir=temp_dir,
                    base_filename=Path(download_filename).stem,
            )
            download_filename = "michaels_output_parts.zip"
            download_media_type = "application/zip"
            page_limited_split = True

        report.setdefault("summary", {})["output_pages"] = output_page_count
        report["summary"]["page_limit_per_file"] = MAX_MICHAELS_OUTPUT_PAGES
        report["summary"]["page_limited_split"] = page_limited_split
        report.setdefault("summary", {})["separate_output_files"] = len(separate_output_names)
        report.setdefault("summary", {})["output_files"] = len(separate_output_names)
        report["output_files"] = separate_output_names

        RESULT_REPORTS[result_id] = report
        update_result_job(
            result_id,
            status="complete",
            detail=(
                f"Michaels generated {output_page_count} output pages in {len(separate_output_names)} files."
                if page_limited_split
                else "Michaels labels generated successfully."
            ),
            report=report,
            output_path=str(download_path),
            output_filename=download_filename,
            media_type=download_media_type,
            preview_path=str(preview_path),
            separate_output_names=separate_output_names,
        )
    except MatchFailureErrors as exc:
        RESULT_REPORTS[result_id] = exc.report or {}
        update_result_job(result_id, status="error", detail=str(exc), report=exc.report)
    except ValueError as exc:
        update_result_job(result_id, status="error", detail=str(exc))
    except Exception as exc:
        update_result_job(result_id, status="error", detail=str(exc))


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


def _run_document_render_job(result_id, draft, renderer):
    job = RESULT_JOBS[result_id]
    config = KIT_CONFIG[job["kit"]]
    output_path = Path(job["temp_dir"]) / config["output_filename"]
    try:
        update_result_job(result_id, detail=f"Rendering edited {config['label']} PDF…")
        report = renderer(
            draft=draft, out_pdf=str(output_path),
            progress_callback=lambda message: update_result_job(result_id, detail=message),
        )
        if not output_path.exists():
            raise RuntimeError("Output PDF was not generated.")
        RESULT_REPORTS[result_id] = report
        update_result_job(result_id, status="complete", detail=f"{config['label']} generated successfully.",
                          report=report, output_path=str(output_path))
    except Exception as exc:
        update_result_job(result_id, status="error", detail=str(exc))


def run_kehe_pallet_label_render_job(result_id: str, draft: Dict[str, Any]) -> None:
    _run_document_render_job(result_id, draft, render_kehe_pallet_label_pdf)


def run_kehe_master_packing_list_render_job(result_id: str, draft: Dict[str, Any]) -> None:
    _run_document_render_job(result_id, draft, render_kehe_master_packing_list_pdf)


def run_kehe_pack_label_render_job(result_id: str, draft: Dict[str, Any]) -> None:
    _run_document_render_job(result_id, draft, render_kehe_pack_label_pdf)
