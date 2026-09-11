"""Small, framework-native HTTP security helpers for LabelKit."""

from __future__ import annotations

import uuid
from typing import Iterable

from fastapi import Request


DEFAULT_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def allowed_origins(configured: Iterable[str]) -> list[str]:
    return [str(origin).strip().rstrip("/") for origin in configured if str(origin).strip()]


async def apply_security_headers(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    response = await call_next(request)
    for name, value in DEFAULT_SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    response.headers["X-Request-ID"] = request_id
    return response
