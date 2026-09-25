"""Product Master completeness, GTIN, unit, duplicate, and hierarchy checks."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List

from .reference_data import normalize_packaging_level, normalize_product_master_row


GTIN_LENGTHS = {8, 12, 13, 14}
MEASUREMENT_FIELDS = ("length_in", "width_in", "height_in")
WEIGHT_FIELDS = ("each_net_weight_g", "gross_weight_lbs")


def gtin_check_digit_valid(value: Any) -> bool:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) not in GTIN_LENGTHS:
        return False
    body = [int(char) for char in digits[:-1]]
    check = int(digits[-1])
    weighted = sum(number * (3 if offset % 2 == 0 else 1) for offset, number in enumerate(reversed(body)))
    return (10 - (weighted % 10)) % 10 == check


def _positive_number(value: Any, *, whole: bool = False) -> bool:
    raw = str(value or "").strip().replace(",", "")
    if not raw:
        return False
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return False
    return number > 0 and (not whole or number.is_integer())


def _group_key(row: Dict[str, Any], index: int) -> str:
    storefront = str(row.get("storefront") or "").strip().lower() or "no-storefront"
    identity = str(
        row.get("config_id")
        or row.get("sku")
        or row.get("customer_item_number")
        or row.get("gtin")
        or f"row-{index + 1}"
    ).strip().lower()
    return f"{storefront}|{identity}"


def _duplicate_key(row: Dict[str, Any]) -> str:
    values = (
        row.get("storefront"),
        row.get("sku"),
        normalize_packaging_level(row.get("packaging_level")),
        re.sub(r"\D", "", str(row.get("gtin") or "")),
        row.get("config_id"),
    )
    return "|".join(str(value or "").strip().lower() for value in values)


def _issue(code: str, message: str, severity: str = "review") -> Dict[str, str]:
    return {"code": code, "message": message, "severity": severity}


def analyze_product_master_rows(rows: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    raw_rows = [dict(row) for row in rows if isinstance(row, dict)]
    normalized = [normalize_product_master_row(row) for row in raw_rows]
    groups: Dict[str, List[int]] = defaultdict(list)
    for index, row in enumerate(normalized):
        groups[_group_key(row, index)].append(index)

    duplicate_counts = Counter(_duplicate_key(row) for row in normalized)
    row_issues: List[List[Dict[str, str]]] = [[] for _ in normalized]
    group_results: List[Dict[str, Any]] = []

    for index, row in enumerate(normalized):
        raw = raw_rows[index]
        gtin = str(row.get("gtin") or "").strip()
        if not gtin:
            row_issues[index].append(_issue("missing_gtin", "GTIN is missing."))
        elif not gtin_check_digit_valid(gtin):
            row_issues[index].append(_issue("invalid_gtin", "GTIN check digit or length is invalid.", "invalid"))

        for field in MEASUREMENT_FIELDS:
            raw_value = raw.get(field, row.get(field))
            if str(raw_value or "").strip() and not _positive_number(raw_value):
                row_issues[index].append(_issue("invalid_dimensions", f"{field.replace('_', ' ')} must be a positive number in inches.", "invalid"))
        for field in WEIGHT_FIELDS:
            raw_value = raw.get(field, row.get(field))
            if str(raw_value or "").strip() and not _positive_number(raw_value):
                unit = "pounds" if field == "gross_weight_lbs" else "grams"
                row_issues[index].append(_issue("invalid_weight", f"{field.replace('_', ' ')} must be a positive number in {unit}.", "invalid"))

        quantity = raw.get("case_qty", row.get("case_qty"))
        if str(quantity or "").strip() and not _positive_number(quantity, whole=True):
            row_issues[index].append(_issue("invalid_case_quantity", "Eaches / Package must be a positive whole number.", "invalid"))
        if _duplicate_key(row).strip("|") and duplicate_counts[_duplicate_key(row)] > 1:
            row_issues[index].append(_issue("duplicate_row", "Duplicate Storefront + SKU + Packaging Level + GTIN + Config ID.", "duplicate"))

    for key, indexes in groups.items():
        group_rows = [normalized[index] for index in indexes]
        levels = [normalize_packaging_level(row.get("packaging_level")) for row in group_rows]
        level_counts = Counter(levels)
        each_row = next((row for row in group_rows if normalize_packaging_level(row.get("packaging_level")) == "Each"), None)
        inner_row = next((row for row in group_rows if normalize_packaging_level(row.get("packaging_level")) == "Inner Pack"), None)
        case_row = next((row for row in group_rows if normalize_packaging_level(row.get("packaging_level")) == "Case"), None)
        primary = case_row or inner_row or each_row or group_rows[0]

        group_issues: List[Dict[str, str]] = []
        if not each_row or not str(each_row.get("gtin") or "").strip():
            group_issues.append(_issue("missing_each_gtin", "Each-level GTIN is missing."))
        for level, count in level_counts.items():
            if level != "Other" and count > 1:
                group_issues.append(_issue("duplicate_level", f"Packaging hierarchy contains {count} {level} rows.", "duplicate"))

        def quantity(row: Dict[str, Any] | None) -> int | None:
            value = str((row or {}).get("case_qty") or "").strip()
            return int(float(value)) if _positive_number(value, whole=True) else None

        each_qty = quantity(each_row)
        inner_qty = quantity(inner_row)
        case_qty = quantity(case_row)
        inners_per_case = quantity({"case_qty": (case_row or {}).get("inner_packs_per_case")})
        if each_row and each_qty not in (None, 1):
            group_issues.append(_issue("hierarchy_conflict", "Each packaging quantity must equal 1.", "invalid"))
        if inner_row and case_row and (not inners_per_case or not inner_qty or case_qty != inner_qty * inners_per_case):
            group_issues.append(_issue("hierarchy_conflict", "Case quantity must equal eaches per inner × inner packs per case.", "invalid"))

        criteria = {
            "identity": bool(primary.get("sku") or primary.get("config_id")),
            "description": bool(primary.get("description")),
            "gtin": bool(primary.get("gtin")) and gtin_check_digit_valid(primary.get("gtin")),
            "each_gtin": bool(each_row and each_row.get("gtin") and gtin_check_digit_valid(each_row.get("gtin"))),
            "package_quantity": normalize_packaging_level(primary.get("packaging_level")) == "Each" or _positive_number(primary.get("case_qty"), whole=True),
            "dimensions": all(_positive_number(primary.get(field)) for field in MEASUREMENT_FIELDS),
            "weight": _positive_number(primary.get("gross_weight_lbs")),
            "each_weight": _positive_number((each_row or {}).get("each_net_weight_g") or primary.get("each_net_weight_g")),
            "label_template": bool(primary.get("label_template_id")) if primary.get("label_enabled") else True,
            "verified": str(primary.get("verification_status") or "").upper() == "VERIFIED",
            "hierarchy": not any(issue["severity"] in {"invalid", "duplicate"} for issue in group_issues),
        }
        score = round(100 * sum(criteria.values()) / len(criteria))
        for index in indexes:
            row_issues[index].extend(group_issues)
            if not all(_positive_number(primary.get(field)) for field in MEASUREMENT_FIELDS):
                row_issues[index].append(_issue("missing_dimensions", f"{primary.get('packaging_level') or 'Outermost'} dimensions are incomplete."))
            if not _positive_number(primary.get("gross_weight_lbs")):
                row_issues[index].append(_issue("missing_weight", "Outermost packaged weight is missing."))
            if not _positive_number((each_row or {}).get("each_net_weight_g") or primary.get("each_net_weight_g")):
                row_issues[index].append(_issue("missing_weight", "Each weight is missing."))
            if normalize_packaging_level(primary.get("packaging_level")) != "Each" and not _positive_number(primary.get("case_qty"), whole=True):
                row_issues[index].append(_issue("missing_case_quantity", f"{primary.get('packaging_level')} quantity is missing."))
            if primary.get("label_enabled") and not primary.get("label_template_id"):
                row_issues[index].append(_issue("missing_label_template", "Label template is missing."))
            if str(primary.get("verification_status") or "").upper() != "VERIFIED":
                row_issues[index].append(_issue("needs_review", "Configuration status requires review."))
        group_results.append({
            "key": key,
            "storefront": primary.get("storefront", ""),
            "sku": primary.get("sku", ""),
            "config_id": primary.get("config_id", ""),
            "description": primary.get("description", ""),
            "score": score,
            "criteria": criteria,
            "issues": group_issues,
            "row_indexes": indexes,
        })

    rows_result = []
    for index, row in enumerate(normalized):
        issues = list({(issue["code"], issue["message"]): issue for issue in row_issues[index]}.values())
        group = next((item for item in group_results if index in item["row_indexes"]), None)
        rows_result.append({
            "index": index,
            "unique_key": row.get("unique_key", ""),
            "score": (group or {}).get("score", 0),
            "status": "invalid" if any(issue["severity"] == "invalid" for issue in issues)
            else "duplicate" if any(issue["severity"] == "duplicate" for issue in issues)
            else "review" if issues else "ready",
            "issues": issues,
        })

    return {
        "summary": {
            "configurations": len(group_results),
            "ready_configurations": sum(1 for group in group_results if group["score"] == 100),
            "average_score": round(sum(group["score"] for group in group_results) / len(group_results)) if group_results else 0,
            "duplicate_rows": sum(1 for row in rows_result if row["status"] == "duplicate"),
            "invalid_rows": sum(1 for row in rows_result if row["status"] == "invalid"),
            "needs_review_rows": sum(1 for row in rows_result if row["status"] in {"review", "duplicate", "invalid"}),
        },
        "groups": group_results,
        "rows": rows_result,
    }


__all__ = ["analyze_product_master_rows", "gtin_check_digit_valid"]
