"""Michaels shipping-label-to-XML matching boundary."""

from .pipeline import (
    MatchAuditRow,
    MatchFailureError,
    _build_match_failure_message,
    _build_match_report,
    _match_pack,
    _pack_debug_label,
    _row_for_report,
    build_pack_indexes,
)

__all__ = [
    "MatchAuditRow",
    "MatchFailureError",
    "_build_match_failure_message",
    "_build_match_report",
    "_match_pack",
    "_pack_debug_label",
    "_row_for_report",
    "build_pack_indexes",
]
