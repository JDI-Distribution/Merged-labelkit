"""Application configuration loading independent of FastAPI and server startup."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def load_config(path: Path) -> dict[str, Any]:
    try:
        if not path.exists():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def is_catalyst_runtime(environment: Mapping[str, str] | None = None) -> bool:
    values = environment or os.environ
    markers = {
        "X_ZOHO_CATALYST_LISTEN_PORT", "X_ZOHO_CATALYST_PROJECT_ID",
        "X_ZOHO_CATALYST_ORG_ID", "X_ZOHO_CATALYST_APP_NAME",
        "CATALYST_PROJECT_ID", "CATALYST_APP_NAME", "CATALYST_OPTIONS",
    }
    return any(values.get(marker) for marker in markers)


class ConfigResolver:
    def __init__(self, config: dict[str, Any], base_dir: Path):
        self.config = config
        self.base_dir = base_dir
        self.has_config = bool(config)
        self.profile_name, self.profile = self._resolve_profile()
        self.allow_environment_overrides = bool(
            config.get("allow_environment_overrides", not self.has_config)
        )

    def _resolve_profile(self) -> tuple[str, dict[str, Any]]:
        profiles = self.config.get("profiles")
        if not isinstance(profiles, dict):
            profiles = {}
        requested = str(
            os.getenv("LABELKIT_PROFILE")
            or self.config.get("active_profile")
            or "local"
        ).strip().lower()
        if requested == "auto":
            requested = "catalyst" if is_catalyst_runtime() else "local"
        profile = profiles.get(requested, {})
        return requested, profile if isinstance(profile, dict) else {}

    def value(self, env_name: str, key: str, default: Any = "") -> Any:
        if self.allow_environment_overrides:
            raw = os.getenv(env_name)
            if raw is not None:
                return raw
        return self.profile.get(key, default)

    def boolean(self, env_name: str, key: str, default: bool = False) -> bool:
        if self.allow_environment_overrides and os.getenv(env_name) is not None:
            return env_bool(env_name, default)
        raw = self.profile.get(key, default)
        return raw if isinstance(raw, bool) else str(raw).strip().lower() in {"1", "true", "yes", "on"}

    def path(self, env_name: str, key: str, default: str) -> Path:
        path = Path(str(self.value(env_name, key, default) or default))
        return path if path.is_absolute() else self.base_dir / path
