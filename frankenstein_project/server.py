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

import json
import os
import re
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
    build_kehe_pack_label_draft,
    render_kehe_master_packing_list_pdf,
    render_kehe_pallet_label_pdf,
    render_kehe_pack_label_pdf,
    load_kehe_dc_directory,
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
    "kehe_pack_labels": {
        "label": "KeHE Pack Labels",
        "output_filename": "kehe_pack_labels.pdf",
        "temp_prefix": "kehe_pack_labels_",
    },
}

# KeHE GTIN / Packaging Master Table persistence.
# Use Catalyst Data Store when the Python SDK is available in AppSail; otherwise
# fall back to a JSON file so local Docker/dev remains functional.
KEHE_PRODUCT_MASTER_TABLE = os.getenv("KEHE_PRODUCT_MASTER_TABLE", "kehe_product_master")
KEHE_PRODUCT_MASTER_STORE = os.getenv("KEHE_PRODUCT_MASTER_STORE", "auto").strip().lower()
KEHE_PRODUCT_MASTER_FILE = Path(
    os.getenv("KEHE_PRODUCT_MASTER_FILE", str(BASE_DIR / "data" / "kehe_product_master.json"))
)

# Defaults used when older Product Master rows do not yet contain the new columns.
DEFAULT_PRODUCT_LABEL_REQUIRED = "✅"
BARCODE_ON_PRODUCT = "Barcode on Product"
DEFAULT_CASE_QTY_BY_LEVEL = {
    "Case": "36",
    "Inner Pack": "6",
    "Each": "",
    "Shipper Contents": "",
    "Other": "",
}
DEFAULT_LABELS_PER_UNIT_BY_LEVEL = {
    "Case": "2",
    "Inner Pack": "6",
    "Each": "",
    "Shipper Contents": "",
    "Other": "",
}
# These each-level display packs still need generated pack labels.
DEFAULT_EACH_LABEL_GTINS = {"850068684939", "850068684991"}

# Default Ship From used only for manual DC Directory rows when no value exists.
DEFAULT_KEHE_SHIP_FROM = "BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373\nUSA"

# KeHE DC Directory persistence.
# File mode updates data/kehe_dc_directory.json.
# Data Store mode mirrors Data Store rows into that JSON file before KeHE document preparation,
# because kehe_pipeline.py reads the DC directory from JSON.
KEHE_DC_DIRECTORY_TABLE = os.getenv("KEHE_DC_DIRECTORY_TABLE", "kehe_dc_directory")
KEHE_DC_DIRECTORY_STORE = os.getenv("KEHE_DC_DIRECTORY_STORE", KEHE_PRODUCT_MASTER_STORE).strip().lower()
KEHE_DC_DIRECTORY_FILE = Path(
    os.getenv("KEHE_DC_DIRECTORY_FILE", str(BASE_DIR / "data" / "kehe_dc_directory.json"))
)


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
# BACKEND SECTION 4C: KeHE product master persistence.
# Frontend uses these APIs as the primary source for the GTIN / Packaging table.
# localStorage remains only a browser-side fallback cache.
# ---------------------------------------------------------------------------
def normalize_packaging_level(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"case", "master pack", "mp"}:
        return "Case"
    if raw in {"inner pack", "inner", "ip"}:
        return "Inner Pack"
    if raw in {"each", "ea"}:
        return "Each"
    if raw in {"shipper contents", "shipper content", "shipper", "display shipper"}:
        return "Shipper Contents"
    if raw == "other":
        return "Shipper Contents"
    return "Other"


def _first_value(row: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        if key in row and row.get(key) is not None:
            return str(row.get(key) or "").strip()
    return ""


def normalize_product_master_row(row: Dict[str, Any]) -> Dict[str, str]:
    gtin = _first_value(row, "gtin", "GTIN", "case_upc", "CASE_UPC", "upc", "UPC")
    packaging_level = normalize_packaging_level(
        _first_value(row, "packaging_level", "PACKAGING_LEVEL", "Packaging Level")
    )
    label_required = _first_value(row, "label_required", "LABEL_REQUIRED", "Label Required")
    case_qty = _first_value(row, "case_qty", "CASE_QTY", "Case Qty")
    labels_per_unit = _first_value(row, "labels_per_unit", "LABELS_PER_UNIT", "Labels / Unit")

    if not label_required:
        label_required = _default_label_required_for_product(gtin, packaging_level)
    if not case_qty:
        case_qty = _default_case_qty_for_product(packaging_level)
    if not labels_per_unit:
        labels_per_unit = _default_labels_per_unit_for_product(packaging_level)

    return {
        "id": _first_value(row, "id", "ROWID", "rowid"),
        "label_required": label_required,
        "gtin": gtin,
        "description": _first_value(row, "description", "DESCRIPTION", "Description"),
        "packaging_level": packaging_level,
        "dimensions_in": _first_value(row, "dimensions_in", "DIMENSIONS_IN", "L_X_W_X_H_IN", "L × W × H (in)"),
        "weight_lbs": _first_value(row, "weight_lbs", "WEIGHT_LBS", "Weight (lbs)"),
        "case_qty": case_qty,
        "labels_per_unit": labels_per_unit,
        "sku": _first_value(row, "sku", "SKU", "item_number", "ITEM_NUMBER"),
        "unique_key": _product_master_unique_key(gtin, packaging_level),
    }


def _product_master_unique_key(gtin: str, packaging_level: str) -> str:
    return f"{str(gtin or '').strip()}|{normalize_packaging_level(packaging_level)}"



def _default_label_required_for_product(gtin: str, packaging_level: str) -> str:
    level = normalize_packaging_level(packaging_level)
    if level in {"Case", "Inner Pack"}:
        return DEFAULT_PRODUCT_LABEL_REQUIRED
    if level == "Each" and str(gtin or "").strip() in DEFAULT_EACH_LABEL_GTINS:
        return DEFAULT_PRODUCT_LABEL_REQUIRED
    return BARCODE_ON_PRODUCT


def _default_case_qty_for_product(packaging_level: str) -> str:
    return DEFAULT_CASE_QTY_BY_LEVEL.get(normalize_packaging_level(packaging_level), "")


def _default_labels_per_unit_for_product(packaging_level: str) -> str:
    return DEFAULT_LABELS_PER_UNIT_BY_LEVEL.get(normalize_packaging_level(packaging_level), "")


def parse_product_master_json(raw: Optional[str]) -> List[Dict[str, str]]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [normalize_product_master_row(r) for r in data if isinstance(r, dict)]


def _dedupe_product_master_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    deduped: Dict[str, Dict[str, str]] = {}
    fallback_index = 0
    for raw in rows:
        row = normalize_product_master_row(raw)
        has_data = any(row.get(k) for k in ("gtin", "description", "dimensions_in", "weight_lbs", "case_qty", "labels_per_unit", "sku"))
        if not has_data:
            continue
        key = row.get("unique_key") or ""
        if key == "|Other":
            fallback_index += 1
            key = f"row-{fallback_index}"
        deduped[key] = row
    return list(deduped.values())


def _product_master_file_read() -> List[Dict[str, str]]:
    try:
        if not KEHE_PRODUCT_MASTER_FILE.exists():
            return []
        data = json.loads(KEHE_PRODUCT_MASTER_FILE.read_text(encoding="utf-8"))
        rows = data.get("rows") if isinstance(data, dict) else data
        if not isinstance(rows, list):
            return []
        return _dedupe_product_master_rows([r for r in rows if isinstance(r, dict)])
    except Exception:
        return []


def _product_master_file_write(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    normalized = _dedupe_product_master_rows(rows)
    KEHE_PRODUCT_MASTER_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "rows": normalized,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    KEHE_PRODUCT_MASTER_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return normalized


def _datastore_row_to_product(row: Dict[str, Any]) -> Dict[str, str]:
    return normalize_product_master_row(row)


def _product_to_datastore_row(row: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_product_master_row(row)
    return {
        "LABEL_REQUIRED": normalized["label_required"],
        "GTIN": normalized["gtin"],
        "DESCRIPTION": normalized["description"],
        "PACKAGING_LEVEL": normalized["packaging_level"],
        "DIMENSIONS_IN": normalized["dimensions_in"],
        "WEIGHT_LBS": normalized["weight_lbs"],
        "CASE_QTY": normalized["case_qty"],
        "LABELS_PER_UNIT": normalized["labels_per_unit"],
        "SKU": normalized["sku"],
        "UNIQUE_KEY": normalized["unique_key"],
        "IS_ACTIVE": True,
    }


def _init_catalyst_app(request: Request) -> Any:
    try:
        import zcatalyst_sdk  # type: ignore
    except Exception:
        return None
    try:
        return zcatalyst_sdk.initialize(req=request)
    except Exception:
        try:
            return zcatalyst_sdk.initialize(request)
        except Exception:
            return None


def _datastore_table_named(request: Request, table_name: str, store_mode: str) -> Any:
    if store_mode == "file":
        return None

    catalyst_app = _init_catalyst_app(request)
    if catalyst_app is None:
        return None

    try:
        return catalyst_app.datastore().table(table_name)
    except Exception:
        return None


def _datastore_table(request: Request) -> Any:
    return _datastore_table_named(
        request,
        KEHE_PRODUCT_MASTER_TABLE,
        KEHE_PRODUCT_MASTER_STORE,
    )


def _datastore_get_raw_rows(table_service: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    next_token: Optional[str] = None
    more_records = True

    while more_records:
        try:
            if next_token:
                page = table_service.get_paged_rows(next_token, max_rows=100)
            else:
                page = table_service.get_paged_rows(max_rows=100)
        except TypeError:
            page = table_service.get_paged_rows(next_token, 100)

        content = page.get("content", []) if isinstance(page, dict) else []
        rows.extend([r for r in content if isinstance(r, dict)])
        more_records = bool(page.get("more_records")) if isinstance(page, dict) else False
        next_token = page.get("next_token") if isinstance(page, dict) else None
        if not next_token:
            more_records = False

    return rows


def _datastore_load_product_master(request: Request) -> Optional[List[Dict[str, str]]]:
    table_service = _datastore_table(request)
    if table_service is None:
        return None
    try:
        raw_rows = _datastore_get_raw_rows(table_service)
        active_rows = [r for r in raw_rows if str(r.get("IS_ACTIVE", True)).lower() not in {"false", "0", "no"}]
        return _dedupe_product_master_rows([_datastore_row_to_product(r) for r in active_rows])
    except Exception:
        return None


def _chunked(values: List[Any], size: int) -> List[List[Any]]:
    return [values[i:i + size] for i in range(0, len(values), size)]


def _datastore_save_product_master(request: Request, rows: List[Dict[str, Any]]) -> Optional[List[Dict[str, str]]]:
    table_service = _datastore_table(request)
    if table_service is None:
        return None
    normalized = _dedupe_product_master_rows(rows)
    try:
        existing_rows = _datastore_get_raw_rows(table_service)
        row_ids = [r.get("ROWID") for r in existing_rows if r.get("ROWID")]
        for batch in _chunked(row_ids, 200):
            table_service.delete_rows(batch)
        insert_rows = [_product_to_datastore_row(r) for r in normalized]
        for batch in _chunked(insert_rows, 100):
            if batch:
                table_service.insert_rows(batch)
        return normalized
    except Exception:
        return None


@app.get("/api/kehe/product-master")
async def get_kehe_product_master(request: Request) -> JSONResponse:
    rows = _datastore_load_product_master(request)
    source = "datastore"
    if rows is None:
        rows = _product_master_file_read()
        source = "file"
    return JSONResponse(content={"rows": rows, "source": source})


@app.put("/api/kehe/product-master")
async def save_kehe_product_master(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    rows = payload.get("rows") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []

    saved_rows = _datastore_save_product_master(request, rows)
    source = "datastore"
    if saved_rows is None:
        saved_rows = _product_master_file_write(rows)
        source = "file"

    return JSONResponse(content={"rows": saved_rows, "saved": True, "source": source})


# ---------------------------------------------------------------------------
# BACKEND SECTION 4D: KeHE DC Directory persistence.
# Frontend uses these APIs for the editable DC Directory modal.
# ---------------------------------------------------------------------------
def _parse_match_values(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]

    raw = str(value or "").strip()
    if not raw:
        return []

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(v).strip() for v in parsed if str(v).strip()]
    except Exception:
        pass

    return [v.strip() for v in re.split(r"[\n,]+", raw) if v.strip()]


def normalize_dc_directory_row(row: Dict[str, Any]) -> Dict[str, Any]:
    dc = _first_value(row, "dc", "DC")
    ship_from = _first_value(row, "ship_from", "SHIP_FROM", "ship_from_address", "SHIP_FROM_ADDRESS", "Ship From")
    return {
        "id": _first_value(row, "id", "ROWID", "rowid"),
        "dc": dc,
        "name": _first_value(row, "name", "NAME"),
        "ship_from": ship_from or DEFAULT_KEHE_SHIP_FROM,
        "delivery_address": _first_value(row, "delivery_address", "DELIVERY_ADDRESS"),
        "billing_address": _first_value(row, "billing_address", "BILLING_ADDRESS"),
        "match_values": _parse_match_values(row.get("match_values", row.get("MATCH_VALUES", []))),
        "unique_key": dc,
    }


def _dedupe_dc_directory_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: Dict[str, Dict[str, Any]] = {}
    fallback_index = 0

    for raw in rows:
        row = normalize_dc_directory_row(raw)
        if not any([row.get("dc"), row.get("name"), row.get("ship_from"), row.get("delivery_address"), row.get("billing_address"), row.get("match_values")]):
            continue

        key = str(row.get("dc") or "").strip()
        if not key:
            fallback_index += 1
            key = f"row-{fallback_index}"

        deduped[key] = row

    return list(deduped.values())


def _dc_rows_to_directory_object(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}

    for row in _dedupe_dc_directory_rows(rows):
        dc = str(row.get("dc") or "").strip()
        if not dc:
            continue

        out[dc] = {
            "dc": dc,
            "name": row.get("name", ""),
            "ship_from": row.get("ship_from", DEFAULT_KEHE_SHIP_FROM),
            "delivery_address": row.get("delivery_address", ""),
            "billing_address": row.get("billing_address", ""),
            "match_values": row.get("match_values", []),
        }

    return out


def _dc_directory_file_read() -> List[Dict[str, Any]]:
    try:
        if not KEHE_DC_DIRECTORY_FILE.exists():
            return []

        data = json.loads(KEHE_DC_DIRECTORY_FILE.read_text(encoding="utf-8"))

        if isinstance(data, dict):
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


def _dc_directory_file_write(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = _dedupe_dc_directory_rows(rows)
    directory_object = _dc_rows_to_directory_object(normalized)

    KEHE_DC_DIRECTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEHE_DC_DIRECTORY_FILE.write_text(
        json.dumps(directory_object, indent=2),
        encoding="utf-8",
    )

    try:
        load_kehe_dc_directory.cache_clear()
    except Exception:
        pass

    return normalized


def _datastore_row_to_dc(row: Dict[str, Any]) -> Dict[str, Any]:
    return normalize_dc_directory_row(row)


def _dc_to_datastore_row(row: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_dc_directory_row(row)

    return {
        "DC": normalized["dc"],
        "NAME": normalized["name"],
        "SHIP_FROM": normalized["ship_from"],
        "DELIVERY_ADDRESS": normalized["delivery_address"],
        "BILLING_ADDRESS": normalized["billing_address"],
        "MATCH_VALUES": json.dumps(normalized["match_values"]),
        "UNIQUE_KEY": normalized["unique_key"],
        "IS_ACTIVE": True,
    }


def _dc_datastore_table(request: Request) -> Any:
    return _datastore_table_named(
        request,
        KEHE_DC_DIRECTORY_TABLE,
        KEHE_DC_DIRECTORY_STORE,
    )


def _datastore_load_dc_directory(request: Request) -> Optional[List[Dict[str, Any]]]:
    table_service = _dc_datastore_table(request)
    if table_service is None:
        return None

    try:
        raw_rows = _datastore_get_raw_rows(table_service)
        active_rows = [
            r for r in raw_rows
            if str(r.get("IS_ACTIVE", True)).lower() not in {"false", "0", "no"}
        ]
        return _dedupe_dc_directory_rows([_datastore_row_to_dc(r) for r in active_rows])
    except Exception:
        return None


def _datastore_save_dc_directory(request: Request, rows: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    table_service = _dc_datastore_table(request)
    if table_service is None:
        return None

    normalized = _dedupe_dc_directory_rows(rows)

    try:
        existing_rows = _datastore_get_raw_rows(table_service)
        row_ids = [r.get("ROWID") for r in existing_rows if r.get("ROWID")]

        for batch in _chunked(row_ids, 200):
            table_service.delete_rows(batch)

        insert_rows = [_dc_to_datastore_row(r) for r in normalized]

        for batch in _chunked(insert_rows, 100):
            if batch:
                table_service.insert_rows(batch)

        # Keep pipeline JSON mirror updated for the current runtime.
        _dc_directory_file_write(normalized)

        return normalized
    except Exception:
        return None


def _sync_kehe_dc_directory_for_pipeline(request: Request) -> List[Dict[str, Any]]:
    rows = _datastore_load_dc_directory(request)

    if rows is None:
        rows = _dc_directory_file_read()

    # This keeps kehe_pipeline.py using the latest DC directory.
    _dc_directory_file_write(rows)

    return rows


@app.get("/api/kehe/dc-directory")
async def get_kehe_dc_directory(request: Request) -> JSONResponse:
    rows = _datastore_load_dc_directory(request)
    source = "datastore"

    if rows is None:
        rows = _dc_directory_file_read()
        source = "file"

    return JSONResponse(content={"rows": rows, "source": source})


@app.put("/api/kehe/dc-directory")
async def save_kehe_dc_directory(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    rows = payload.get("rows") if isinstance(payload, dict) else []

    if not isinstance(rows, list):
        rows = []

    saved_rows = _datastore_save_dc_directory(request, rows)
    source = "datastore"

    if saved_rows is None:
        saved_rows = _dc_directory_file_write(rows)
        source = "file"

    return JSONResponse(content={"rows": saved_rows, "saved": True, "source": source})


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
    request: Request,
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
        _sync_kehe_dc_directory_for_pipeline(request)
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
    except HTTPException:
        raise
    except Exception as exc:
        print(f"DEBUG prepare_kehe_pallet_label error: {exc}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error preparing pallet label draft: {str(exc)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/prepare/kehe/master-packing-list")
async def prepare_kehe_master_packing_list(
    request: Request,
    xml_files: List[UploadFile] = File(...),
    product_master_json: Optional[str] = Form(default="[]"),
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
        product_master_rows = parse_product_master_json(product_master_json)
        if not product_master_rows:
            product_master_rows = _datastore_load_product_master(request) or _product_master_file_read()
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
        return JSONResponse(content=draft)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"DEBUG prepare_kehe_master_packing_list error: {exc}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error preparing master packing list draft: {str(exc)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/prepare/kehe/pack-labels")
async def prepare_kehe_pack_labels(
    request: Request,
    xml_files: List[UploadFile] = File(...),
    product_master_json: Optional[str] = Form(default="[]"),
) -> JSONResponse:
    if not xml_files:
        raise HTTPException(status_code=400, detail="At least one XML file is required.")
    temp_dir = Path(tempfile.mkdtemp(prefix="kehe_pack_labels_prepare_"))
    try:
        xml_paths: List[str] = []
        for upload in xml_files:
            if not (upload.filename or "").lower().endswith(".xml"):
                raise HTTPException(status_code=400, detail=f"Invalid XML file: {upload.filename}")
            out_path = temp_dir / sanitize_filename(upload.filename or "input.xml")
            await save_upload_file(upload, out_path)
            xml_paths.append(str(out_path))

        product_master_rows = parse_product_master_json(product_master_json)
        if not product_master_rows:
            product_master_rows = _datastore_load_product_master(request) or _product_master_file_read()
        _sync_kehe_dc_directory_for_pipeline(request)
        draft = build_kehe_pack_label_draft(xml_paths, product_master_rows=product_master_rows)
        return JSONResponse(content=draft)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"DEBUG prepare_kehe_pack_labels error: {exc}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error preparing pack label draft: {str(exc)}")
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


def run_kehe_pack_label_render_job(result_id: str, draft: Dict[str, Any]) -> None:
    job = RESULT_JOBS[result_id]
    temp_dir = Path(job["temp_dir"])
    output_path = temp_dir / KIT_CONFIG["kehe_pack_labels"]["output_filename"]
    try:
        def _progress(message: str) -> None:
            update_result_job(result_id, detail=message)

        update_result_job(result_id, detail="Rendering edited KeHE Pack Labels PDF…")
        report = render_kehe_pack_label_pdf(
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
            detail="KeHE Pack Labels generated successfully.",
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


@app.post("/render/kehe/pack-labels")
async def render_kehe_pack_labels_endpoint(draft: Dict[str, Any]) -> JSONResponse:
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
    if full_path.startswith(("api", "generate", "prepare", "render", "results", "health", "docs", "openapi.json", "redoc", "accounts/")):
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


