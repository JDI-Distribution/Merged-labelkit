"""Michaels shared helpers and data model boundary."""

from .pipeline import (
    Address,
    Item,
    MatchFailureError,
    Order,
    Pack,
    _first_existing_path,
    _normalise_tracking,
    _status_log,
    format_michaels_item_number,
    format_sscc_groups,
    hard_wrap,
    normalize_sscc,
    wrap_text,
)

__all__ = [
    "Address",
    "Item",
    "MatchFailureError",
    "Order",
    "Pack",
    "_first_existing_path",
    "_normalise_tracking",
    "_status_log",
    "format_michaels_item_number",
    "format_sscc_groups",
    "hard_wrap",
    "normalize_sscc",
    "wrap_text",
]
