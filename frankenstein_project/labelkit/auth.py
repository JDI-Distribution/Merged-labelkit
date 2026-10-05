"""Catalyst identity resolution and LabelKit role permissions."""

from __future__ import annotations

from typing import Any, Callable, Mapping, Optional

from fastapi import HTTPException, Request


def init_catalyst(request: Request, scope: str = "") -> Any:
    try:
        import zcatalyst_sdk  # type: ignore
    except Exception:
        return None
    try:
        return zcatalyst_sdk.initialize(scope=scope, req=request) if scope else zcatalyst_sdk.initialize(req=request)
    except Exception:
        if scope:
            try:
                return zcatalyst_sdk.initialize(req=request)
            except Exception:
                return None
        return None


def role_from_name(role_name: str) -> str:
    normalized = str(role_name or "").strip().lower()
    if "admin" in normalized:
        return "Admin"
    if "editor" in normalized or "edit" in normalized:
        return "Editor"
    return "User"


def role_from_catalyst(role_name: str = "", role_id: str = "", role_id_map: Mapping[str, str] | None = None) -> str:
    mapped = (role_id_map or {}).get(str(role_id or "").strip())
    return role_from_name(mapped or role_name)


def request_user_from_headers(request: Request, auth_required: bool, role_id_map: Mapping[str, str] | None = None) -> dict[str, Any]:
    if auth_required:
        return {"authenticated": False, "name": "", "email": "", "user_id": "", "role": "User", "role_name": "User", "role_id": "", "source": "unauthenticated"}
    headers = request.headers
    role_name = headers.get("x-zc-user-role") or headers.get("x-zc-role-name") or headers.get("x-user-role") or headers.get("x-labelkit-role") or ""
    role_id = headers.get("x-zc-role-id") or headers.get("x-zc-user-role-id") or headers.get("x-user-role-id") or headers.get("x-labelkit-role-id") or ""
    user = {
        "authenticated": False,
        "name": headers.get("x-zc-user-name") or headers.get("x-user-name") or headers.get("x-forwarded-user") or headers.get("x-labelkit-user") or "",
        "email": headers.get("x-zc-user-email") or headers.get("x-user-email") or headers.get("x-forwarded-email") or headers.get("x-labelkit-email") or "",
        "user_id": headers.get("x-zc-user-id") or headers.get("x-user-id") or "",
        "role": role_from_catalyst(role_name, role_id, role_id_map),
        "role_name": role_name or "User", "role_id": role_id, "source": "headers",
    }
    user["authenticated"] = bool(user["email"] or user["name"])
    if not user["authenticated"]:
        user.update({"authenticated": True, "name": "Local user", "email": "", "user_id": "", "role": "Admin", "role_name": "Local Admin", "source": "local"})
    return user


def current_project_user(request: Request, *, auth_required: bool, role_id_map: Mapping[str, str] | None = None, catalyst_factory: Callable[[Request], Any] | None = None) -> dict[str, Any]:
    cached = getattr(request.state, "labelkit_user", None)
    if isinstance(cached, dict):
        return cached
    user = request_user_from_headers(request, auth_required, role_id_map)
    catalyst_app = catalyst_factory(request) if catalyst_factory else init_catalyst(request)
    if catalyst_app is not None:
        try:
            details = catalyst_app.user_management().get_current_user()
            if isinstance(details, dict):
                role_details = details.get("role_details") or {}
                role_name = str(role_details.get("role_name") or "") if isinstance(role_details, dict) else ""
                role_id = str(role_details.get("role_id") or role_details.get("roleId") or role_details.get("id") or "") if isinstance(role_details, dict) else ""
                name = " ".join([str(details.get("first_name") or "").strip(), str(details.get("last_name") or "").strip()]).strip()
                email = str(details.get("email_id") or details.get("email") or "")
                user = {"authenticated": bool(email or name), "name": name, "email": email, "user_id": str(details.get("user_id") or details.get("zuid") or ""), "role": role_from_catalyst(role_name, role_id, role_id_map), "role_name": role_name or "User", "role_id": role_id, "source": "catalyst"}
        except Exception:
            pass
    request.state.labelkit_user = user
    return user


def permissions_for_role(role: str) -> dict[str, bool]:
    role = role_from_name(role)
    is_admin = role == "Admin"
    is_editor = role in {"Admin", "Editor"}
    return {"view": True, "generate": True, "table_crud": is_editor, "save_mpl": is_editor, "delete_mpl": is_admin, "audit_view": is_editor, "admin": is_admin}


def require_permission(config: dict[str, Any], permission: str, auth_required: bool) -> dict[str, Any]:
    user = config["user"]
    if auth_required and not user.get("authenticated"):
        raise HTTPException(status_code=401, detail="Sign in with Catalyst Authentication to use LabelKit.")
    if not config["permissions"].get(permission, False):
        role_name = user.get("role_name") or user.get("role") or "User"
        raise HTTPException(status_code=403, detail=f"{role_name} does not have permission for this action.")
    return config
