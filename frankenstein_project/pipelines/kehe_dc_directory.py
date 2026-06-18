"""
KeHE DC Directory
-----------------
Loads and queries the editable kehe_dc_directory.json file.
match_values are lookup tokens from XML (GLN, address fragments, ZIP codes).
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

DIRECTORY_PATH = Path(__file__).with_name("kehe_dc_directory.json")


def _normalize(value: str) -> str:
    value = (value or "").lower()
    value = value.replace(".", "")
    value = value.replace(",", "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


@lru_cache(maxsize=1)
def load_kehe_dc_directory() -> dict[str, dict[str, Any]]:
    with DIRECTORY_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("KeHE DC directory JSON must be an object keyed by DC number.")
    required = {"dc", "name", "delivery_address", "billing_address", "match_values"}
    for dc, row in data.items():
        missing = required - set(row)
        if missing:
            raise ValueError(
                f"KeHE DC directory row {dc} is missing: {', '.join(sorted(missing))}"
            )
        if not isinstance(row["match_values"], list):
            raise ValueError(
                f"KeHE DC directory row {dc} match_values must be a list."
            )
    return data


def find_kehe_dc(
    *,
    st_gln: str = "",
    line1: str = "",
    city: str = "",
    state: str = "",
    zip_code: str = "",
) -> dict[str, Any] | None:
    """Find a KeHE DC entry by GLN or address fragment.

    GLN match (exact) takes priority; falls back to normalized substring match
    against haystack built from all provided address fields.
    """
    directory = load_kehe_dc_directory()
    st_gln = (st_gln or "").strip()
    haystack = _normalize(" ".join([st_gln, line1, city, state, zip_code]))

    if st_gln:
        for row in directory.values():
            if st_gln in row.get("match_values", []):
                return row

    for row in directory.values():
        for raw_value in row.get("match_values", []):
            value = _normalize(raw_value)
            if value and value in haystack:
                return row

    return None
