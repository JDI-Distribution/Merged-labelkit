"""Application configuration, authentication glue, and datastore access shared by all features."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Request

from labelkit.analytics import AnalyticsClient, AnalyticsSettings, LOCAL_SOURCE_VALUES
from labelkit.app_config import ConfigResolver, env_bool, is_catalyst_runtime, load_config
from labelkit.auth import (
    current_project_user,
    init_catalyst,
    permissions_for_role,
    request_user_from_headers,
    require_permission,
    role_from_catalyst,
    role_from_name,
)
from labelkit.catalyst import datastore_unavailable, get_raw_rows, store_requires_datastore, table_named
from labelkit.customer_workflows import load_customer_workflows
from labelkit.order_intake import configure_order_intake
from labelkit.spreadsheets import _read_spreadsheet_bytes


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
FRONTEND_ASSETS = FRONTEND_DIST / "assets"


DEFAULT_PORT = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT", os.getenv("PORT", "9000")))


APP_NAME = "Merged LabelKit"


APP_ID = "merged-labelkit"


APP_VERSION = str(os.getenv("APP_VERSION", "dev") or "dev").strip()


GIT_SHA = str(os.getenv("GIT_SHA", "unknown") or "unknown").strip()


LOGGER = logging.getLogger("labelkit")


def _env_bool(name: str, default: bool = False) -> bool:
    return env_bool(name, default)


APP_CONFIG_FILE = Path(os.getenv("LABELKIT_CONFIG_FILE", str(BASE_DIR / "labelkit_config.json")))


def _load_labelkit_config() -> Dict[str, Any]:
    return load_config(APP_CONFIG_FILE)


def _is_catalyst_runtime() -> bool:
    return is_catalyst_runtime()


LABELKIT_CONFIG = _load_labelkit_config()


HAS_LABELKIT_CONFIG = bool(LABELKIT_CONFIG)


CONFIG = ConfigResolver(LABELKIT_CONFIG, BASE_DIR)


def _resolve_labelkit_profile() -> tuple[str, Dict[str, Any]]:
    return CONFIG.profile_name, CONFIG.profile


LABELKIT_CONFIG_PROFILE, ACTIVE_LABELKIT_CONFIG = _resolve_labelkit_profile()


ALLOW_CONFIG_ENV_OVERRIDES = bool(
    LABELKIT_CONFIG.get("allow_environment_overrides", not HAS_LABELKIT_CONFIG)
)


def _config_value(env_name: str, key: str, default: Any = "") -> Any:
    return CONFIG.value(env_name, key, default)


def _config_bool(env_name: str, key: str, default: bool = False) -> bool:
    return CONFIG.boolean(env_name, key, default)


def _config_path(env_name: str, key: str, default: str) -> Path:
    return CONFIG.path(env_name, key, default)


APP_ENV = str(_config_value("APP_ENV", "app_env", os.getenv("ENVIRONMENT", "local"))).strip().lower()


AUTH_REQUIRED = _config_bool("AUTH_REQUIRED", "auth_required", APP_ENV in {"production", "prod"})


AUTH_MODE = str(_config_value("AUTH_MODE", "auth_mode", "embedded" if AUTH_REQUIRED else "none") or "none").strip().lower()


ALLOW_LOCAL_JSON_FALLBACK = _config_bool("ALLOW_LOCAL_JSON_FALLBACK", "allow_local_json_fallback", not AUTH_REQUIRED)


ALLOW_BROWSER_LOCAL_CACHE = _config_bool("ALLOW_BROWSER_LOCAL_CACHE", "allow_browser_local_cache", not AUTH_REQUIRED)


ANALYTICS_SETTINGS = AnalyticsSettings.from_config(CONFIG, BASE_DIR)


ANALYTICS_ORDER_SOURCE = ANALYTICS_SETTINGS.order_source


ANALYTICS_LOCAL_SOURCE_VALUES = LOCAL_SOURCE_VALUES


ANALYTICS_LOCAL_FILE = ANALYTICS_SETTINGS.local_file


ANALYTICS_CONNECTION_LINK_NAME = ANALYTICS_SETTINGS.connection_link_name


ANALYTICS_WORKSPACE_ID = ANALYTICS_SETTINGS.workspace_id


ANALYTICS_VIEW_ID = ANALYTICS_SETTINGS.view_id


ANALYTICS_VIEW_NAME = ANALYTICS_SETTINGS.view_name


ANALYTICS_ORDER_COLUMN = ANALYTICS_SETTINGS.order_column


ANALYTICS_SKU_COLUMN = ANALYTICS_SETTINGS.sku_column


ANALYTICS_QUANTITY_COLUMN = ANALYTICS_SETTINGS.quantity_column


ANALYTICS_CUSTOMER_EMAIL_COLUMN = ANALYTICS_SETTINGS.customer_email_column


ANALYTICS_ITEM_DESCRIPTION_COLUMNS = ANALYTICS_SETTINGS.item_description_columns


ANALYTICS_ITEM_NUMBER_COLUMNS = ANALYTICS_SETTINGS.item_number_columns


ANALYTICS_ITEM_GTIN_COLUMNS = ANALYTICS_SETTINGS.item_gtin_columns


ANALYTICS_ITEM_UNIT_WEIGHT_COLUMNS = ANALYTICS_SETTINGS.item_unit_weight_columns


ANALYTICS_ITEM_PALLET_WEIGHT_COLUMNS = ANALYTICS_SETTINGS.item_pallet_weight_columns


ANALYTICS_ORDER_INSTANCE_ID_COLUMN = ANALYTICS_SETTINGS.order_instance_id_column


ANALYTICS_ORDER_INSTANCE_DATE_COLUMN = ANALYTICS_SETTINGS.order_instance_date_column


ANALYTICS_ORDER_INSTANCE_STOREFRONT_COLUMN = ANALYTICS_SETTINGS.order_instance_storefront_column


ANALYTICS_ORDER_DETAIL_COLUMNS = ANALYTICS_SETTINGS.order_detail_columns


ANALYTICS_CLIENT = AnalyticsClient(
    ANALYTICS_SETTINGS,
    lambda request: _init_catalyst_app(request),
    lambda filename, data: _read_spreadsheet_bytes(filename, data),
)


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


MPL_PRODUCT_MASTER_TABLE = str(
    _config_value("MPL_PRODUCT_MASTER_TABLE", "mpl_product_master_table", "mpl_product_master")
    or "mpl_product_master"
)


MPL_PRODUCT_MASTER_STORE = str(_config_value(
    "MPL_PRODUCT_MASTER_STORE",
    "mpl_product_master_store",
    "datastore" if AUTH_REQUIRED and not ALLOW_LOCAL_JSON_FALLBACK else "auto",
)).strip().lower()


MPL_PRODUCT_MASTER_FILE = Path(
    os.getenv("MPL_PRODUCT_MASTER_FILE", str(BASE_DIR / "data" / "mpl_product_master.json"))
)


DEFAULT_KEHE_SHIP_FROM = "BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373\nUSA"


MPL_DIRECTORY_TABLE = str(
    _config_value("MPL_DIRECTORY_TABLE", "mpl_directory_table", "mpl_directory")
    or "mpl_directory"
)


MPL_DIRECTORY_STORE = str(
    _config_value("MPL_DIRECTORY_STORE", "mpl_directory_store", MPL_PRODUCT_MASTER_STORE)
).strip().lower()


MPL_DIRECTORY_FILE = Path(
    os.getenv("MPL_DIRECTORY_FILE", str(BASE_DIR / "data" / "mpl_directory.json"))
)


MPL_DRAFTS_TABLE = str(
    _config_value("MPL_DRAFTS_TABLE", "mpl_drafts_table", "kehe_mpl_drafts")
    or "kehe_mpl_drafts"
)


MPL_DRAFTS_STORE = str(_config_value(
    "MPL_DRAFTS_STORE",
    "mpl_drafts_store",
    os.getenv("KEHE_MPL_DRAFTS_STORE", MPL_PRODUCT_MASTER_STORE) if ALLOW_CONFIG_ENV_OVERRIDES else MPL_PRODUCT_MASTER_STORE,
)).strip().lower()


MPL_DRAFTS_FILE = _config_path(
    "MPL_DRAFTS_FILE",
    "mpl_drafts_file",
    os.getenv("KEHE_MPL_DRAFTS_FILE", str(BASE_DIR / "data" / "kehe_mpl_drafts.json")),
)


B2B_LABEL_TEMPLATES_FILE = _config_path(
    "B2B_LABEL_TEMPLATES_FILE",
    "b2b_label_templates_file",
    str(BASE_DIR / "data" / "b2b_label_templates.json"),
)


AUDIT_LOG_TABLE = str(
    _config_value("AUDIT_LOG_TABLE", "audit_log_table", "kehe_audit_log")
    or "kehe_audit_log"
)


AUDIT_LOG_STORE = str(_config_value(
    "AUDIT_LOG_STORE",
    "audit_log_store",
    os.getenv("KEHE_AUDIT_LOG_STORE", MPL_PRODUCT_MASTER_STORE) if ALLOW_CONFIG_ENV_OVERRIDES else MPL_PRODUCT_MASTER_STORE,
)).strip().lower()


AUDIT_LOG_FILE = Path(
    os.getenv(
        "AUDIT_LOG_FILE",
        os.getenv("KEHE_AUDIT_LOG_FILE", str(BASE_DIR / "data" / "kehe_audit_log.json")),
    )
)


CUSTOMER_WORKFLOWS_FILE = BASE_DIR / "data" / "customer_workflows.json"


CUSTOMER_WORKFLOWS = load_customer_workflows(CUSTOMER_WORKFLOWS_FILE)


def _init_catalyst_app(request: Request) -> Any:
    return init_catalyst(request, "admin")


def _init_catalyst_user_app(request: Request) -> Any:
    return init_catalyst(request)


def _config_role_id_map() -> Dict[str, str]:
    raw = ACTIVE_LABELKIT_CONFIG.get("role_id_map", {})
    if not isinstance(raw, dict):
        return {}
    return {str(role_id).strip(): str(role).strip() for role_id, role in raw.items() if str(role_id).strip()}


def _role_from_role_id(role_id: str) -> str:
    mapped = _config_role_id_map().get(str(role_id or "").strip())
    return _role_from_name(mapped) if mapped else ""


def _role_from_name(role_name: str) -> str:
    return role_from_name(role_name)


def _role_from_catalyst(role_name: str = "", role_id: str = "") -> str:
    return role_from_catalyst(role_name, role_id, _config_role_id_map())


def _request_user_from_headers(request: Request) -> Dict[str, Any]:
    return request_user_from_headers(request, AUTH_REQUIRED, _config_role_id_map())


def _current_project_user(request: Request) -> Dict[str, Any]:
    return current_project_user(
        request,
        auth_required=AUTH_REQUIRED,
        role_id_map=_config_role_id_map(),
        catalyst_factory=_init_catalyst_user_app,
    )


def _permissions_for_role(role: str) -> Dict[str, bool]:
    return permissions_for_role(role)


def _app_runtime_config(request: Optional[Request] = None) -> Dict[str, Any]:
    user = _current_project_user(request) if request is not None else {
        "authenticated": not AUTH_REQUIRED,
        "name": "Local user" if not AUTH_REQUIRED else "",
        "email": "",
        "user_id": "",
        "role": "Admin" if not AUTH_REQUIRED else "User",
        "role_name": "Local Admin" if not AUTH_REQUIRED else "User",
        "source": "local",
    }
    return {
        "app_env": APP_ENV,
        "config_profile": LABELKIT_CONFIG_PROFILE,
        "config_file": str(APP_CONFIG_FILE),
        "auth_required": AUTH_REQUIRED,
        "auth_mode": AUTH_MODE,
        "authenticated": bool(user.get("authenticated")),
        "allow_local_json_fallback": ALLOW_LOCAL_JSON_FALLBACK,
        "allow_browser_local_cache": ALLOW_BROWSER_LOCAL_CACHE,
        "user": user,
        "permissions": _permissions_for_role(str(user.get("role") or "User")),
        "store_modes": {
            "product_master": MPL_PRODUCT_MASTER_STORE,
            "directory": MPL_DIRECTORY_STORE,
            "mpl_drafts": MPL_DRAFTS_STORE,
            "audit_log": AUDIT_LOG_STORE,
        },
    }


def _require_permission(request: Request, permission: str = "view") -> Dict[str, Any]:
    config = _app_runtime_config(request)
    return require_permission(config, permission, AUTH_REQUIRED)


def _store_requires_datastore(store_mode: str) -> bool:
    return store_requires_datastore(store_mode)


def _raise_datastore_unavailable(table_name: str, action: str, exc: Optional[Exception] = None) -> None:
    datastore_unavailable(table_name, action, exc, app_env=APP_ENV, logger=LOGGER)


def _datastore_table_named(request: Request, table_name: str, store_mode: str) -> Any:
    return table_named(request, table_name, store_mode, _init_catalyst_app, app_env=APP_ENV, logger=LOGGER)


def _product_datastore_table(request: Request, table_name: str, store_mode: str) -> Any:
    return _datastore_table_named(request, table_name, store_mode)


def _datastore_get_raw_rows(table_service: Any) -> List[Dict[str, Any]]:
    return get_raw_rows(table_service)


def _chunked(values: List[Any], size: int) -> List[List[Any]]:
    return [values[i:i + size] for i in range(0, len(values), size)]


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    """Write JSON without exposing readers to a partially written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def _request_actor(request: Request) -> Dict[str, str]:
    user = _current_project_user(request)
    name = str(user.get("name") or "")
    email = str(user.get("email") or "")
    user_id = str(user.get("user_id") or "")
    if not name and not email:
        name = "Local user"
    return {
        "name": name,
        "email": email,
        "user_id": user_id,
        "role": str(user.get("role") or ""),
        "role_name": str(user.get("role_name") or ""),
        "client": request.client.host if request.client else "",
    }


configure_order_intake(
    ANALYTICS_SKU_COLUMN=ANALYTICS_SKU_COLUMN,
    ANALYTICS_QUANTITY_COLUMN=ANALYTICS_QUANTITY_COLUMN,
    ANALYTICS_CUSTOMER_EMAIL_COLUMN=ANALYTICS_CUSTOMER_EMAIL_COLUMN,
    ANALYTICS_ITEM_DESCRIPTION_COLUMNS=ANALYTICS_ITEM_DESCRIPTION_COLUMNS,
    ANALYTICS_ITEM_NUMBER_COLUMNS=ANALYTICS_ITEM_NUMBER_COLUMNS,
    ANALYTICS_ITEM_GTIN_COLUMNS=ANALYTICS_ITEM_GTIN_COLUMNS,
    ANALYTICS_ITEM_UNIT_WEIGHT_COLUMNS=ANALYTICS_ITEM_UNIT_WEIGHT_COLUMNS,
    ANALYTICS_ITEM_PALLET_WEIGHT_COLUMNS=ANALYTICS_ITEM_PALLET_WEIGHT_COLUMNS,
    ANALYTICS_ORDER_INSTANCE_ID_COLUMN=ANALYTICS_ORDER_INSTANCE_ID_COLUMN,
    ANALYTICS_ORDER_INSTANCE_DATE_COLUMN=ANALYTICS_ORDER_INSTANCE_DATE_COLUMN,
    ANALYTICS_ORDER_INSTANCE_STOREFRONT_COLUMN=ANALYTICS_ORDER_INSTANCE_STOREFRONT_COLUMN,
    ANALYTICS_ORDER_DETAIL_COLUMNS=ANALYTICS_ORDER_DETAIL_COLUMNS,
    ANALYTICS_ORDER_SOURCE=ANALYTICS_ORDER_SOURCE,
    ANALYTICS_LOCAL_SOURCE_VALUES=ANALYTICS_LOCAL_SOURCE_VALUES,
    ANALYTICS_LOCAL_FILE=ANALYTICS_LOCAL_FILE,
    ANALYTICS_CONNECTION_LINK_NAME=ANALYTICS_CONNECTION_LINK_NAME,
    ANALYTICS_WORKSPACE_ID=ANALYTICS_WORKSPACE_ID,
    ANALYTICS_VIEW_ID=ANALYTICS_VIEW_ID,
    ANALYTICS_VIEW_NAME=ANALYTICS_VIEW_NAME,
    CUSTOMER_WORKFLOWS=CUSTOMER_WORKFLOWS,
)
