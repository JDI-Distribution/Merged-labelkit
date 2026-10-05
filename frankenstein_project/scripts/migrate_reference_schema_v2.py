"""Preview or apply the local Product/Address schema-v2 migration.

The command is intentionally local-only.  Catalyst must first run a release
containing the dual readers, then be backed up and migrated as a separate
operation.  A timestamped rollback copy is written beneath ``.local`` before
any local file is replaced.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


APP_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIR))

from labelkit.reference_data import (  # noqa: E402
    _dedupe_dc_directory_rows,
    _dedupe_product_master_rows,
)
from labelkit.reference_models import (  # noqa: E402
    CURRENT_ADDRESS_SCHEMA_VERSION,
    CURRENT_PRODUCT_SCHEMA_VERSION,
    read_schema_version,
)


PRODUCT_FILE = APP_DIR / "data" / "mpl_product_master.json"
ADDRESS_FILE = APP_DIR / "data" / "mpl_directory.json"
BACKUP_ROOT = APP_DIR / ".local" / "migration-backups"


def _read(path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rows", []) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError(f"{path} does not contain a row list")
    metadata = dict(payload) if isinstance(payload, dict) else {}
    metadata.pop("rows", None)
    return [dict(row) for row in rows if isinstance(row, dict)], metadata


def _write_atomic(path: Path, payload: Dict[str, Any]) -> None:
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def _version_counts(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for row in rows:
        key = str(read_schema_version(row))
        counts[key] = counts.get(key, 0) + 1
    return counts


def _duplicate_keys(rows: List[Dict[str, Any]]) -> List[str]:
    seen = set()
    duplicates = set()
    for row in rows:
        key = str(row.get("unique_key") or "").strip()
        if not key:
            continue
        if key in seen:
            duplicates.add(key)
        seen.add(key)
    return sorted(duplicates)


def build_plan() -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    products_before, product_metadata = _read(PRODUCT_FILE)
    addresses_before, address_metadata = _read(ADDRESS_FILE)
    # Migration v2 is deliberately additive.  Canonicalization is exercised to
    # prove every legacy row is readable, but existing fields are retained for
    # the rollback window and removed only in a later release.
    normalized_products = _dedupe_product_master_rows(products_before)
    normalized_addresses = _dedupe_dc_directory_rows(addresses_before)
    products_after = [
        {**row, "schema_version": CURRENT_PRODUCT_SCHEMA_VERSION}
        for row in products_before
    ]
    addresses_after = [
        {**row, "schema_version": CURRENT_ADDRESS_SCHEMA_VERSION}
        for row in addresses_before
    ]

    report = {
        "applied": False,
        "product_master": {
            "before": len(products_before),
            "after": len(products_after),
            "versions_before": _version_counts(products_before),
            "versions_after": _version_counts(products_after),
            "duplicate_keys_after": _duplicate_keys(normalized_products),
            "readable_after_normalization": len(normalized_products),
        },
        "directory": {
            "before": len(addresses_before),
            "after": len(addresses_after),
            "versions_before": _version_counts(addresses_before),
            "versions_after": _version_counts(addresses_after),
            "duplicate_keys_after": _duplicate_keys(normalized_addresses),
            "readable_after_normalization": len(normalized_addresses),
        },
    }
    product_payload = {
        **product_metadata,
        "schema_version": CURRENT_PRODUCT_SCHEMA_VERSION,
        "rows": products_after,
    }
    address_payload = {
        **address_metadata,
        "schema_version": CURRENT_ADDRESS_SCHEMA_VERSION,
        "rows": addresses_after,
    }
    return report, product_payload, address_payload


def run(apply: bool = False) -> Dict[str, Any]:
    report, product_payload, address_payload = build_plan()
    problems = []
    for section in ("product_master", "directory"):
        detail = report[section]
        if detail["before"] != detail["after"]:
            problems.append(f"{section} row count would change")
        if detail["before"] != detail["readable_after_normalization"]:
            problems.append(f"{section} normalization would change the row count")
        if detail["duplicate_keys_after"]:
            problems.append(f"{section} contains duplicate keys")
    report["validation_errors"] = problems
    if not apply or problems:
        return report

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = BACKUP_ROOT / f"reference-schema-v1-{timestamp}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    shutil.copy2(PRODUCT_FILE, backup_dir / PRODUCT_FILE.name)
    shutil.copy2(ADDRESS_FILE, backup_dir / ADDRESS_FILE.name)

    migrated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    product_payload["migrated_at"] = migrated_at
    address_payload["migrated_at"] = migrated_at
    _write_atomic(PRODUCT_FILE, product_payload)
    _write_atomic(ADDRESS_FILE, address_payload)
    report["applied"] = True
    report["backup_dir"] = str(backup_dir)
    report["migrated_at"] = migrated_at
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="back up and replace the two local JSON files")
    args = parser.parse_args()
    outcome = run(apply=args.apply)
    print(json.dumps(outcome, indent=2))
    if outcome.get("validation_errors"):
        raise SystemExit(2)
