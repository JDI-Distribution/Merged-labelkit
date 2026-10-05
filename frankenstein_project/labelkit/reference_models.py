"""Version markers and compatibility helpers for reference-data records.

Reference data existed before LabelKit recorded schema versions.  Readers must
therefore accept both unversioned legacy rows and the current canonical shape.
Writers use version 2 for local files and API models; Catalyst column writes are
enabled separately after the production tables have been prepared.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping


LEGACY_REFERENCE_SCHEMA_VERSION = 1
CURRENT_PRODUCT_SCHEMA_VERSION = 2
CURRENT_ADDRESS_SCHEMA_VERSION = 2


def read_schema_version(row: Mapping[str, Any], default: int = LEGACY_REFERENCE_SCHEMA_VERSION) -> int:
    """Read a schema marker from JSON, API, or Catalyst column naming."""
    raw = row.get("schema_version", row.get("_schema_version", row.get("SCHEMA_VERSION")))
    try:
        version = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return version if version > 0 else default


@dataclass(frozen=True)
class ProductRecordV2:
    """Canonical versioned Product Master level row.

    Product configurations remain grouped by ``config_id``.  A row represents
    one packaging level so existing matching and Catalyst indexes stay stable.
    """

    values: Dict[str, Any]
    schema_version: int = CURRENT_PRODUCT_SCHEMA_VERSION

    def as_dict(self) -> Dict[str, Any]:
        return {"schema_version": self.schema_version, **self.values}


@dataclass(frozen=True)
class AddressRecordV2:
    """Canonical versioned reusable address row."""

    values: Dict[str, Any]
    schema_version: int = CURRENT_ADDRESS_SCHEMA_VERSION

    def as_dict(self) -> Dict[str, Any]:
        return {"schema_version": self.schema_version, **self.values}


def version_product_record(values: Mapping[str, Any]) -> Dict[str, Any]:
    clean = dict(values)
    clean.pop("schema_version", None)
    clean.pop("_schema_version", None)
    clean.pop("SCHEMA_VERSION", None)
    return ProductRecordV2(clean).as_dict()


def version_address_record(values: Mapping[str, Any]) -> Dict[str, Any]:
    clean = dict(values)
    clean.pop("schema_version", None)
    clean.pop("_schema_version", None)
    clean.pop("SCHEMA_VERSION", None)
    return AddressRecordV2(clean).as_dict()
