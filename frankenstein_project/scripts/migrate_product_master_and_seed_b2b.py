"""Migrate local reference data to the current schema and merge B2B seeds.

The command is a dry run unless --apply is supplied. It never replaces an
existing nonblank value with a different seed value and writes JSON atomically.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

APP_DIR = Path(__file__).resolve().parents[1]
PRODUCT_FILE = APP_DIR / "data" / "mpl_product_master.json"
DIRECTORY_FILE = APP_DIR / "data" / "mpl_directory.json"
PRODUCT_SEED = APP_DIR / "data" / "seeds" / "b2b_product_master_seed.csv"
DIRECTORY_SEED = APP_DIR / "data" / "seeds" / "b2b_directory_seed.csv"
EXPECTED_PRODUCT_SEED_ROWS = 32
EXPECTED_DIRECTORY_SEED_ROWS = 2

PRODUCT_FIELDS = (
    "storefront", "config_id", "sku", "customer_item_number", "description",
    "packaging_level", "gtin", "barcode_type", "barcode_level", "length_in",
    "width_in", "height_in", "case_qty", "each_net_weight_g",
    "package_net_weight_g", "gross_weight_lbs", "label_template_id",
    "default_copies", "pack_statement", "verification_status", "label_enabled",
    "is_active", "source_note",
)
DIRECTORY_FIELDS = (
    "storefront", "dc", "name", "ship_from", "delivery_address",
    "billing_address", "match_values", "record_type",
    "default_label_template_id", "manufacturer_name", "manufacturer_address",
    "receiving_email", "docking_instructions", "is_active",
    "verification_status", "source_note",
)
LEGACY_PRODUCT_FIELDS = {
    "dimensions_in", "DIMENSIONS_IN", "weight_lbs", "WEIGHT_LBS",
    "labels_per_unit", "LABELS_PER_UNIT", "label_required", "LABEL_REQUIRED",
    "in_packing_list", "IN_PACKING_LIST",
}


def _read_document(path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rows", []) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError(f"{path} does not contain a row list")
    metadata = {key: value for key, value in payload.items() if key != "rows"} if isinstance(payload, dict) else {}
    return [dict(row) for row in rows if isinstance(row, dict)], metadata


def _read_seed(path: Path, expected: int) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != expected:
        raise ValueError(f"{path.name}: expected {expected} rows, found {len(rows)}")
    return [{str(key): str(value or "").strip() for key, value in row.items()} for row in rows]


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    raw = str(value or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "y"}:
        return True
    if raw in {"0", "false", "no", "n"}:
        return False
    return default


def _number(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not match:
        return None
    parsed = float(match.group(0))
    return parsed if parsed > 0 else None


def _number_text(value: Any) -> str:
    parsed = _number(value)
    if parsed is None:
        return ""
    return str(int(parsed)) if math.isclose(parsed, round(parsed), abs_tol=1e-9) else f"{parsed:.6f}".rstrip("0").rstrip(".")


def _parse_dimensions(value: Any) -> Tuple[str, str, str] | None:
    raw = str(value or "").strip().lower().replace("×", "x")
    for symbol, replacement in {"¼": ".25", "½": ".5", "¾": ".75", "⅛": ".125", "⅜": ".375", "⅝": ".625", "⅞": ".875"}.items():
        raw = raw.replace(symbol, replacement)
    values = re.findall(r"-?\d+(?:\.\d+)?", raw)
    if len(values) != 3:
        return None
    parsed = tuple(_number_text(value) for value in values)
    return parsed if all(parsed) else None


def _same_number(left: Any, right: Any) -> bool:
    left_number, right_number = _number(left), _number(right)
    if left_number is None or right_number is None:
        return left_number is right_number
    return math.isclose(left_number, right_number, rel_tol=0, abs_tol=1e-9)


def _product_key(row: Dict[str, Any]) -> str:
    store = str(row.get("storefront") or row.get("STOREFRONT") or "KeHE").strip().lower()
    config = str(row.get("config_id") or row.get("CONFIG_ID") or "").strip().lower()
    level = str(row.get("packaging_level") or row.get("PACKAGING_LEVEL") or "Other").strip().lower()
    if config:
        return f"{store}|{config}|{level}"
    sku = str(row.get("sku") or row.get("SKU") or "").strip().lower()
    return f"{store}|{level}|{sku}"


def _directory_key(row: Dict[str, Any]) -> str:
    store = str(row.get("storefront") or row.get("STOREFRONT") or "KeHE").strip().lower()
    dc = str(row.get("dc") or row.get("DC") or "").strip().lower()
    return f"{store}|{dc}"


def _migrate_product(row: Dict[str, Any], counts: Counter, conflicts: List[Dict[str, str]]) -> Dict[str, Any]:
    migrated = dict(row)
    key = _product_key(row)

    legacy_dimensions = row.get("dimensions_in", row.get("DIMENSIONS_IN", ""))
    parsed_dimensions = _parse_dimensions(legacy_dimensions) if str(legacy_dimensions or "").strip() else None
    numeric_dimensions = tuple(_number_text(row.get(field, row.get(field.upper(), ""))) for field in ("length_in", "width_in", "height_in"))
    if str(legacy_dimensions or "").strip() and parsed_dimensions is None:
        conflicts.append({"key": key, "field": "dimensions", "detail": f"unparsed: {legacy_dimensions}"})
    elif parsed_dimensions and all(numeric_dimensions) and any(not _same_number(left, right) for left, right in zip(parsed_dimensions, numeric_dimensions)):
        conflicts.append({"key": key, "field": "dimensions", "detail": f"legacy={parsed_dimensions}; numeric={numeric_dimensions}"})
    elif parsed_dimensions:
        for field, value in zip(("length_in", "width_in", "height_in"), parsed_dimensions):
            if not _number_text(migrated.get(field)):
                migrated[field] = value
                counts["dimensions_backfilled"] += 1

    legacy_weight = row.get("weight_lbs", row.get("WEIGHT_LBS", ""))
    new_weight = row.get("gross_weight_lbs", row.get("GROSS_WEIGHT_LBS", ""))
    if str(legacy_weight or "").strip() and _number(legacy_weight) is None:
        conflicts.append({"key": key, "field": "gross_weight_lbs", "detail": f"unparsed legacy weight: {legacy_weight}"})
    elif _number(legacy_weight) is not None and _number(new_weight) is not None and not _same_number(legacy_weight, new_weight):
        conflicts.append({"key": key, "field": "gross_weight_lbs", "detail": f"legacy={legacy_weight}; new={new_weight}"})
    elif _number(legacy_weight) is not None and _number(new_weight) is None:
        migrated["gross_weight_lbs"] = _number_text(legacy_weight)
        counts["weight_backfilled"] += 1

    legacy_copies = row.get("labels_per_unit", row.get("LABELS_PER_UNIT", ""))
    new_copies = row.get("default_copies", row.get("DEFAULT_COPIES", ""))
    if str(legacy_copies or "").strip() and (not str(legacy_copies).strip().isdigit() or int(str(legacy_copies).strip()) < 1):
        conflicts.append({"key": key, "field": "default_copies", "detail": f"invalid legacy copies: {legacy_copies}"})
    elif str(legacy_copies or "").strip() and str(new_copies or "").strip() and str(legacy_copies).strip() != str(new_copies).strip():
        conflicts.append({"key": key, "field": "default_copies", "detail": f"legacy={legacy_copies}; new={new_copies}"})
    elif str(legacy_copies or "").strip() and not str(new_copies or "").strip():
        migrated["default_copies"] = str(int(str(legacy_copies).strip()))
        counts["copies_backfilled"] += 1

    level = str(row.get("packaging_level") or row.get("PACKAGING_LEVEL") or "").strip().lower()
    active = _bool(row.get("is_active", row.get("IS_ACTIVE", True)), True)
    expected_required = active and level == "case"
    legacy_required = row.get("label_required", row.get("LABEL_REQUIRED", None))
    if legacy_required is not None and str(legacy_required).strip():
        if _bool(legacy_required, expected_required) != expected_required:
            conflicts.append({"key": key, "field": "label_required", "detail": f"legacy={legacy_required}; derived={expected_required}"})
        else:
            counts["label_required_validated"] += 1

    for field in LEGACY_PRODUCT_FIELDS:
        migrated.pop(field, None)
    migrated["storefront"] = str(row.get("storefront") or row.get("STOREFRONT") or "KeHE").strip() or "KeHE"
    migrated["packaging_level"] = str(row.get("packaging_level") or row.get("PACKAGING_LEVEL") or "Other").strip() or "Other"
    migrated["is_active"] = active
    label_enabled_supplied = "label_enabled" in row or "LABEL_ENABLED" in row
    migrated["label_enabled"] = _bool(row.get("label_enabled", row.get("LABEL_ENABLED", False)), False) if label_enabled_supplied else False
    # KeHE eligibility is derived separately and never uses this B2B switch.
    if str(migrated["storefront"]).strip().lower() == "kehe" and not str(migrated.get("config_id") or "").strip():
        migrated["label_enabled"] = False
    migrated["unique_key"] = _product_key(migrated)
    return migrated


def _normalize_seed_product(row: Dict[str, str]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {field: row.get(field, "") for field in PRODUCT_FIELDS}
    for field in ("length_in", "width_in", "height_in", "each_net_weight_g", "package_net_weight_g", "gross_weight_lbs"):
        normalized[field] = _number_text(normalized[field])
    normalized["case_qty"] = str(normalized["case_qty"] or "").strip()
    normalized["default_copies"] = str(normalized["default_copies"] or "").strip()
    normalized["label_enabled"] = _bool(normalized["label_enabled"], False)
    normalized["is_active"] = _bool(normalized["is_active"], True)
    normalized["unique_key"] = _product_key(normalized)
    return normalized


def _normalize_seed_directory(row: Dict[str, str]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {field: row.get(field, "") for field in DIRECTORY_FIELDS}
    normalized["match_values"] = [value.strip() for value in str(normalized["match_values"]).split("|") if value.strip()]
    normalized["is_active"] = _bool(normalized["is_active"], False)
    normalized["unique_key"] = _directory_key(normalized)
    return normalized


def _comparable(value: Any) -> Any:
    if isinstance(value, list):
        return [str(item).strip() for item in value]
    if isinstance(value, bool):
        return value
    return str(value or "").strip()


def _merge_seed(
    existing_rows: List[Dict[str, Any]],
    seed_rows: Iterable[Dict[str, Any]],
    fields: Iterable[str],
    key_fn: Any,
) -> Tuple[List[Dict[str, Any]], Counter, List[Dict[str, Any]]]:
    merged = list(existing_rows)
    index_by_key = {key_fn(row): index for index, row in enumerate(merged)}
    counts: Counter = Counter()
    conflicts: List[Dict[str, Any]] = []
    for seed in seed_rows:
        key = key_fn(seed)
        index = index_by_key.get(key)
        if index is None:
            merged.append(seed)
            index_by_key[key] = len(merged) - 1
            counts["INSERT"] += 1
            continue
        existing = merged[index]
        conflict_fields = [
            field for field in fields
            if _comparable(existing.get(field)) not in ("", [])
            and _comparable(seed.get(field)) not in ("", [])
            and _comparable(existing.get(field)) != _comparable(seed.get(field))
        ]
        if conflict_fields:
            counts["CONFLICT"] += 1
            conflicts.append({"key": key, "fields": conflict_fields})
            continue
        updated = dict(existing)
        changed = False
        for field in fields:
            seed_value = seed.get(field)
            if _comparable(existing.get(field)) in ("", []) and _comparable(seed_value) not in ("", []):
                updated[field] = seed_value
                changed = True
        updated["unique_key"] = key
        merged[index] = updated
        counts["UPDATE" if changed else "IDENTICAL"] += 1
    return merged, counts, conflicts


def _write_atomic(path: Path, rows: List[Dict[str, Any]], metadata: Dict[str, Any]) -> None:
    payload = {"rows": rows, **metadata}
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


def run(apply: bool) -> Dict[str, Any]:
    product_rows, product_metadata = _read_document(PRODUCT_FILE)
    directory_rows, directory_metadata = _read_document(DIRECTORY_FILE)
    product_seed = [
        _normalize_seed_product(row)
        for row in _read_seed(PRODUCT_SEED, EXPECTED_PRODUCT_SEED_ROWS)
    ]
    directory_seed = [
        _normalize_seed_directory(row)
        for row in _read_seed(DIRECTORY_SEED, EXPECTED_DIRECTORY_SEED_ROWS)
    ]

    migration_counts: Counter = Counter()
    migration_conflicts: List[Dict[str, str]] = []
    migrated_products = [_migrate_product(row, migration_counts, migration_conflicts) for row in product_rows]
    if migration_conflicts:
        return {"applied": False, "migration_counts": dict(migration_counts), "migration_conflicts": migration_conflicts}

    final_products, product_counts, product_conflicts = _merge_seed(
        migrated_products, product_seed, PRODUCT_FIELDS, _product_key
    )
    final_directory, directory_counts, directory_conflicts = _merge_seed(
        directory_rows, directory_seed, DIRECTORY_FIELDS, _directory_key
    )
    result = {
        "applied": False,
        "product_master": dict(product_counts),
        "directory": dict(directory_counts),
        "migration_counts": dict(migration_counts),
        "conflicts": {"product_master": product_conflicts, "directory": directory_conflicts},
        "row_counts": {
            "product_master_before": len(product_rows),
            "product_master_after": len(final_products),
            "directory_before": len(directory_rows),
            "directory_after": len(final_directory),
        },
        "seed_checks": {
            "product_rows": len(product_seed),
            "directory_rows": len(directory_seed),
            "enabled_product_rows": sum(1 for row in product_seed if row["label_enabled"]),
            "active_directory_rows": sum(1 for row in directory_seed if row["is_active"]),
        },
    }
    if apply and not product_conflicts and not directory_conflicts:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if final_products != product_rows or not product_metadata.get("updated_at"):
            _write_atomic(PRODUCT_FILE, final_products, {**product_metadata, "updated_at": timestamp})
        if final_directory != directory_rows or not directory_metadata.get("updated_at"):
            _write_atomic(DIRECTORY_FILE, final_directory, {**directory_metadata, "updated_at": timestamp})
        result["applied"] = True
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write the validated migration and seed merge")
    args = parser.parse_args()
    report = run(args.apply)
    print(json.dumps(report, indent=2))
    if report.get("migration_conflicts") or any(report.get("conflicts", {}).values()):
        raise SystemExit(2)
