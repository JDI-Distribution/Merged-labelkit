"""
Merged LabelKit backend
-----------------------
FastAPI entry point. Feature routes live in labelkit.routes; shared configuration,
authentication, stores, and background jobs live in the labelkit package.

The frontend lives in frontend/dist/index.html.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from labelkit.routes import b2b, drafts, generation, orders, reference, system
from labelkit.runtime import APP_NAME, DEFAULT_PORT, FRONTEND_ASSETS, _config_value
from labelkit.security import allowed_origins, apply_security_headers

app = FastAPI(title=f"{APP_NAME} API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(_config_value(
        "CORS_ALLOWED_ORIGINS",
        "cors_allowed_origins",
        [
            "http://127.0.0.1:9000",
            "http://localhost:9000",
            "https://mergedlabelkit.development.catalystappsail.com",
        ],
    )),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "X-Request-ID"],
)
app.middleware("http")(apply_security_headers)


@app.middleware("http")
async def disable_frontend_asset_cache(request: Request, call_next):
    """Keep the local UI in sync with the checked-in frontend bundle."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


if FRONTEND_ASSETS.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_ASSETS)), name="assets")

for _router in (reference.router, b2b.router, orders.router, drafts.router, generation.router):
    app.include_router(_router)
# The SPA catch-all must be registered last.
app.include_router(system.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=DEFAULT_PORT,
        reload=False,
        log_level="info",
    )
