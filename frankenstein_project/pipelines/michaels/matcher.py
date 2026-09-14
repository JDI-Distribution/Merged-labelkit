"""Michaels shipping-label-to-ASN matching and audit reporting."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .common import MatchAuditRow, Pack, PageOcrData, _normalise_tracking
def build_pack_indexes(
    packs: List[Pack],
) -> Tuple[
    Dict[str, Pack],
    Dict[str, List[Pack]],
    Dict[str, List[Pack]],
    Dict[Tuple[str, str], List[Pack]],
]:
    """
    Return lookup maps for matching shipping-label OCR results to XML packs.
    Exact tracking is preferred; PO/store fallbacks are only used when they
    identify a single unambiguous pack.
    """
    by_tracking: Dict[str, Pack] = {}
    by_po: Dict[str, List[Pack]] = {}
    by_store: Dict[str, List[Pack]] = {}
    by_po_store: Dict[Tuple[str, str], List[Pack]] = {}

    for p in packs:
        t = _normalise_tracking(p.tracking)
        if t:
            by_tracking[t] = p

        po = (p.po or "").strip()
        if po:
            by_po.setdefault(po, []).append(p)

        st = (p.store or "").strip()
        if st:
            by_store.setdefault(st, []).append(p)

        if po and st:
            by_po_store.setdefault((po, st), []).append(p)

    return by_tracking, by_po, by_store, by_po_store


# ===========================================================================
# OCR helpers
# ===========================================================================


def _pack_debug_label(pack: Pack) -> str:
    return (
        f"PO={pack.po or 'missing'}, store={pack.store or 'missing'}, "
        f"tracking={pack.tracking or 'missing'}, SSCC={pack.sscc or 'missing'}"
    )


def _row_for_report(
    page_number: int,
    status: str,
    tracking: str,
    po: str,
    store: str,
    pack: Optional[Pack],
    match_method: str,
    note: str = "",
) -> Dict[str, Any]:
    return {
        "label_page": page_number,
        "status": status,
        "match_method": match_method,
        "ocr_tracking": tracking,
        "ocr_po": po,
        "ocr_store": store,
        "xml_tracking": pack.tracking if pack else "",
        "xml_po": pack.po if pack else "",
        "xml_store": pack.store if pack else "",
        "sscc": pack.sscc if pack else "",
        "note": note,
    }


def _match_pack(
    tracking: str,
    po: str,
    store: str,
    by_tracking: Dict[str, Pack],
    by_po: Dict[str, List[Pack]],
    by_store: Dict[str, List[Pack]],
    by_po_store: Dict[Tuple[str, str], List[Pack]],
) -> Tuple[Optional[Pack], str]:
    norm_t = _normalise_tracking(tracking)
    if norm_t and norm_t in by_tracking:
        return by_tracking[norm_t], f"Tracking={tracking}"

    po_key = (po or "").strip()
    store_key = (store or "").strip()

    if store_key:
        candidates = by_store.get(store_key, [])
        if len(candidates) == 1:
            return candidates[0], f"Store={store_key}"

    return None, ""


def _build_match_report(
    report_rows: List[Dict[str, Any]],
    all_packs: List[Pack],
    used_pack_ssccs: set[str],
    shipping_pages: int,
    output_order: str = "Uploaded PDF order",
) -> Dict[str, Any]:
    unused_packs: List[Pack] = []
    seen_ssccs: set[str] = set()
    for pack in all_packs:
        if pack.sscc in used_pack_ssccs or pack.sscc in seen_ssccs:
            continue
        seen_ssccs.add(pack.sscc)
        unused_packs.append(pack)

    matched_pages = sum(1 for row in report_rows if row.get("status") == "matched")
    report = {
        "matching_rules": [
            "1. Exact tracking number match",
            "2. Unique store-only match",
        ],
        "summary": {
            "output_order": output_order,
            "success": matched_pages == shipping_pages and len(unused_packs) == 0,
            "shipping_pages": shipping_pages,
            "xml_packs": len(all_packs),
            "matched_pages": matched_pages,
            "unmatched_pages": sum(1 for row in report_rows if row.get("status") != "matched"),
            "unused_xml_packs": len(unused_packs),
        },
        "rows": report_rows,
        "unused_xml_packs": [
            {
                "po": pack.po,
                "store": pack.store,
                "tracking": pack.tracking,
                "sscc": pack.sscc,
            }
            for pack in unused_packs
        ],
    }
    return report


def _build_match_failure_message(
    unmatched_details: List[PageOcrData],
    all_packs: List[Pack],
    used_pack_ssccs: set[str],
    duplicate_messages: Optional[List[str]] = None,
) -> str:
    lines = ["Shipping label to XML matching failed."]

    if unmatched_details:
        lines.append("Unmatched label pages:")
        for pd in unmatched_details:
            lines.append(
                f"- Label page {pd.page_idx + 1}: tracking={pd.tracking or 'not found'}, "
                f"PO={pd.po or 'not found'}, store={pd.store or 'not found'}"
            )

    if duplicate_messages:
        lines.append("Duplicate shipping labels matched the same XML pack:")
        lines.extend(duplicate_messages)

    unused_packs: List[Pack] = []
    seen_ssccs: set[str] = set()
    for pack in all_packs:
        if pack.sscc in used_pack_ssccs or pack.sscc in seen_ssccs:
            continue
        seen_ssccs.add(pack.sscc)
        unused_packs.append(pack)

    if unused_packs:
        lines.append("XML packs with no matched shipping label:")
        for pack in unused_packs[:20]:
            lines.append(f"- {_pack_debug_label(pack)}")
        if len(unused_packs) > 20:
            lines.append(f"- ... plus {len(unused_packs) - 20} more XML pack(s)")

    return "\n".join(lines)


__all__ = [
    "_build_match_failure_message",
    "_build_match_report",
    "_match_pack",
    "_pack_debug_label",
    "_row_for_report",
    "build_pack_indexes",
]
