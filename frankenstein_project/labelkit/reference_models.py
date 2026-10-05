"""Version markers and compatibility helpers for reference-data records.

Reference data existed before LabelKit recorded schema versions. Readers accept
both legacy rows and the current canonical shape. Local files and API models
carry an explicit version; Catalyst rows are recognized from their existing
business columns and do not require a dedicated ``SCHEMA_VERSION`` column.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping


LEGACY_REFERENCE_SCHEMA_VERSION = 1
CURRENT_PRODUCT_SCHEMA_VERSION = 2
CURRENT_ADDRESS_SCHEMA_VERSION = 2


_CURRENT_SCHEMA_COLUMNS = {
    # Product Master v2 fields.
    "CONFIG_ID",
    "DISPLAY_SKU",
    "DISPLAY_SKU_UOM",
    "INNER_PACKS_PER_CASE",
    "LENGTH_IN",
    "WIDTH_IN",
    "HEIGHT_IN",
    "EACH_NET_WEIGHT_G",
    "PACKAGE_NET_WEIGHT_G",
    "GROSS_WEIGHT_LBS",
    # Directory v2 fields.
    "ADDRESS_ROLES",
    "DEFAULT_LABEL_TEMPLATE_ID",
    "VERIFICATION_STATUS",
}


def _has_current_schema_columns(row: Mapping[str, Any]) -> bool:
    keys = {str(key).strip().upper() for key in row.keys()}
    return bool(keys.intersection(_CURRENT_SCHEMA_COLUMNS))


def read_schema_version(row: Mapping[str, Any], default: int = LEGACY_REFERENCE_SCHEMA_VERSION) -> int:
    """Read an explicit marker or infer v2 from existing Catalyst columns.

    ``ROWID``, ``CREATORID``, ``CREATEDTIME`` and ``MODIFIEDTIME`` are Catalyst
    system metadata. They are intentionally ignored when determining the
    LabelKit reference-data schema.
    """
    raw = row.get("schema_version", row.get("_schema_version", row.get("SCHEMA_VERSION")))
    try:
        version = int(str(raw).strip())
    except (TypeError, ValueError):
        return CURRENT_PRODUCT_SCHEMA_VERSION if _has_current_schema_columns(row) else default
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
