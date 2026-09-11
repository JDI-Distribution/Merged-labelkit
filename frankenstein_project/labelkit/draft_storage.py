"""Compact Catalyst draft serialization and bounded MPL version helpers."""

from __future__ import annotations

import base64
import json
import uuid
import zlib
from typing import Any, Dict, List


STORAGE_VERSION = 2
MPL_VERSION_LIMIT = 5
COMPACT_COLUMNS = {
    "DRAFT_ID", "NAME", "CREATED_AT", "UPDATED_AT", "DRAFT_JSON", "IS_ACTIVE",
}


def normalize_document_type(value: Any, default: str = "MPL") -> str:
    raw = str(value or "").strip().upper()
    return raw or default


def encode_draft_row(record: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
    payload = {
        "_labelkit_storage_version": STORAGE_VERSION,
        "record": {
            "document_type": normalize_document_type(record.get("document_type") or "MPL"),
            "status": str(record.get("status") or "DRAFT"),
            "customer_code": str(record.get("customer_code") or ""),
            "po_number": str(record.get("po_number") or ""),
            "created_by": str(record.get("created_by") or ""),
            "updated_by": str(record.get("updated_by") or ""),
            "revision": max(0, int(record.get("revision") or 0)),
        },
        "draft": record.get("draft") or {},
    }
    packed = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    compressed = base64.urlsafe_b64encode(zlib.compress(packed, level=9)).decode("ascii")
    return {
        "DRAFT_ID": str(record.get("id") or uuid.uuid4().hex),
        "NAME": str(record.get("name") or ""),
        "CREATED_AT": str(record.get("created_at") or now_iso),
        "UPDATED_AT": str(record.get("updated_at") or now_iso),
        "DRAFT_JSON": f"zlib:{compressed}",
        "IS_ACTIVE": True,
    }


def decode_draft_row(row: Dict[str, Any]) -> Dict[str, Any]:
    draft_raw = row.get("DRAFT_JSON") or row.get("draft") or {}
    draft = draft_raw if isinstance(draft_raw, dict) else {}
    embedded: Dict[str, Any] = {}
    if isinstance(draft_raw, str) and draft_raw.strip():
        try:
            encoded = draft_raw.strip()
            if encoded.startswith("zlib:"):
                encoded = zlib.decompress(
                    base64.urlsafe_b64decode(encoded[5:].encode("ascii"))
                ).decode("utf-8")
            parsed = json.loads(encoded)
            if isinstance(parsed, dict):
                if (
                    parsed.get("_labelkit_storage_version") == STORAGE_VERSION
                    and isinstance(parsed.get("record"), dict)
                    and isinstance(parsed.get("draft"), dict)
                ):
                    embedded = parsed["record"]
                    draft = parsed["draft"]
                else:
                    draft = parsed
        except Exception:
            draft = {}
    return {
        "id": row.get("DRAFT_ID") or row.get("id") or row.get("ROWID") or "",
        "name": row.get("NAME") or row.get("name") or "",
        "created_at": row.get("CREATED_AT") or row.get("created_at") or "",
        "updated_at": row.get("UPDATED_AT") or row.get("updated_at") or "",
        "document_type": normalize_document_type(
            row.get("DOCUMENT_TYPE") or row.get("document_type") or embedded.get("document_type") or "MPL"
        ),
        "status": str(row.get("STATUS") or row.get("status") or embedded.get("status") or "DRAFT"),
        "customer_code": str(row.get("CUSTOMER_CODE") or row.get("customer_code") or embedded.get("customer_code") or ""),
        "po_number": str(row.get("PO_NUMBER") or row.get("po_number") or embedded.get("po_number") or ""),
        "created_by": row.get("CREATED_BY") or row.get("created_by") or embedded.get("created_by") or "",
        "updated_by": row.get("UPDATED_BY") or row.get("updated_by") or embedded.get("updated_by") or "",
        "revision": max(0, int(embedded.get("revision") or row.get("REVISION") or 0)),
        "draft": draft,
    }


def bounded_versions(records: List[Dict[str, Any]], parent_id: str) -> List[Dict[str, Any]]:
    related = [
        record for record in records
        if str((record.get("draft") or {}).get("_version_parent_id") or "") == str(parent_id)
    ]
    unrelated = [record for record in records if record not in related]
    related.sort(key=lambda record: int(record.get("revision") or 0), reverse=True)
    return unrelated + related[:MPL_VERSION_LIMIT]
