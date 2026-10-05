"""Frontend hosting, health, session, and diagnostics routes."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from labelkit.runtime import (
    ANALYTICS_ORDER_SOURCE,
    APP_ENV,
    APP_ID,
    APP_NAME,
    APP_VERSION,
    AUDIT_LOG_STORE,
    AUDIT_LOG_TABLE,
    FRONTEND_DIST,
    GIT_SHA,
    LABELKIT_CONFIG_PROFILE,
    MPL_DIRECTORY_STORE,
    MPL_DIRECTORY_TABLE,
    MPL_DRAFTS_STORE,
    MPL_DRAFTS_TABLE,
    MPL_PRODUCT_MASTER_STORE,
    MPL_PRODUCT_MASTER_TABLE,
    _app_runtime_config,
    _datastore_table_named,
    _require_permission,
)


router = APIRouter()


@router.get("/")
async def root() -> HTMLResponse:
    return serve_frontend_index()


@router.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "app": APP_NAME,
        "app_id": APP_ID,
        "version": APP_VERSION,
        "git_sha": GIT_SHA,
        "frontend_found": (FRONTEND_DIST / "index.html").exists(),
        "frontend_entry": "frontend/dist/index.html",
        "backend_entry": "server.py",
        "available_kits": {
            "michaels": "XML + shipping-label PDF matching workflow",
            "kehe": "XML-only GS1 label workflow",
            "mpl": "Packing List and Ti-Hi workspace",
            "b2b": "Editable customer case-pack label workflow",
            "partners": "Automatic DecoPac, Dutch Bros, and Fancy Sprinkles labels and packing-list workflow",
        },
    }


@router.get("/api/auth/session")
async def auth_session(request: Request) -> JSONResponse:
    return JSONResponse(content=_app_runtime_config(request))


@router.get("/api/admin/diagnostics")
async def admin_diagnostics(request: Request) -> JSONResponse:
    _require_permission(request, "admin")
    checks: Dict[str, Any] = {
        "profile": LABELKIT_CONFIG_PROFILE,
        "app_env": APP_ENV,
        "version": APP_VERSION,
        "git_sha": GIT_SHA,
        "frontend": (FRONTEND_DIST / "index.html").exists(),
        "analytics_source": ANALYTICS_ORDER_SOURCE,
        "tables": {},
    }
    table_configs = {
        "product_master": (MPL_PRODUCT_MASTER_TABLE, MPL_PRODUCT_MASTER_STORE),
        "directory": (MPL_DIRECTORY_TABLE, MPL_DIRECTORY_STORE),
        "mpl_drafts": (MPL_DRAFTS_TABLE, MPL_DRAFTS_STORE),
        "audit_log": (AUDIT_LOG_TABLE, AUDIT_LOG_STORE),
    }
    healthy = bool(checks["frontend"])
    for label, (table_name, store_mode) in table_configs.items():
        try:
            service = _datastore_table_named(request, table_name, store_mode)
            if service is None:
                checks["tables"][label] = {"ok": True, "mode": "file"}
                continue
            try:
                service.get_paged_rows(max_rows=1)
            except TypeError:
                service.get_paged_rows(None, 1)
            checks["tables"][label] = {"ok": True, "mode": "datastore", "table": table_name}
        except Exception:
            healthy = False
            checks["tables"][label] = {"ok": False, "mode": store_mode, "table": table_name}
    checks["ok"] = healthy
    return JSONResponse(status_code=200 if healthy else 503, content=checks)


def serve_frontend_index() -> HTMLResponse:
    index_path = FRONTEND_DIST / "index.html"
    if not index_path.exists():
        return HTMLResponse(
            "<h1>Frontend build not found</h1>"
            "<p>The bundled frontend/dist folder is missing.</p>",
            status_code=500,
        )
    html = index_path.read_text(encoding="utf-8")
    return HTMLResponse(
        html,
        media_type="text/html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.get("/{full_path:path}")
async def spa_fallback(full_path: str, request: Request):
    _ = request
    if full_path.startswith(("api", "generate", "prepare", "render", "results", "health", "docs", "openapi.json", "redoc", "accounts/")):
        raise HTTPException(status_code=404, detail="Not found")

    requested_path = FRONTEND_DIST / full_path
    if requested_path.is_file():
        if requested_path.name.lower() == "index.html":
            return serve_frontend_index()
        return FileResponse(requested_path)

    return serve_frontend_index()
