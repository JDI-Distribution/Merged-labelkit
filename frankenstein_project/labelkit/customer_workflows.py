"""Configuration-backed customer workflow detection."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _normalized_phrase(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def load_customer_workflows(path: Path) -> List[Dict[str, Any]]:
    """Load and validate the customer workflow registry."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_workflows = payload.get("workflows") if isinstance(payload, dict) else None
    if not isinstance(raw_workflows, list):
        raise ValueError("Customer workflow configuration must contain a workflows list.")

    workflows: List[Dict[str, Any]] = []
    seen_ids = set()
    for raw in raw_workflows:
        if not isinstance(raw, dict):
            continue
        workflow_id = str(raw.get("id") or "").strip()
        label = str(raw.get("label") or "").strip()
        mpl_template_id = str(raw.get("mpl_template_id") or "").strip()
        if not workflow_id or not label or not mpl_template_id:
            raise ValueError("Every customer workflow requires id, label, and mpl_template_id.")
        if workflow_id in seen_ids:
            raise ValueError(f"Duplicate customer workflow id: {workflow_id}")
        seen_ids.add(workflow_id)
        workflows.append({
            "id": workflow_id,
            "label": label,
            "mpl_template_id": mpl_template_id,
            "label_template_ids": [
                str(value).strip()
                for value in raw.get("label_template_ids", [])
                if str(value).strip()
            ],
            "accent": str(raw.get("accent") or "green").strip(),
            "selector_hint": str(raw.get("selector_hint") or "").strip(),
            "detection_aliases": [
                normalized
                for value in raw.get("detection_aliases", [])
                if (normalized := _normalized_phrase(value))
            ],
        })
    return workflows


def detect_customer_id(value: Any, workflows: Iterable[Dict[str, Any]]) -> str:
    """Return the configured customer id found in free-form order text."""
    normalized = _normalized_phrase(value)
    if not normalized:
        return ""
    padded = f" {normalized} "
    compact = normalized.replace(" ", "")
    for workflow in workflows:
        for alias in workflow.get("detection_aliases", []):
            normalized_alias = _normalized_phrase(alias)
            compact_alias = normalized_alias.replace(" ", "")
            if normalized_alias and (
                f" {normalized_alias} " in padded
                or compact_alias in compact
            ):
                return str(workflow.get("id") or "")
    return ""
