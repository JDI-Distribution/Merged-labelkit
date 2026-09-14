"""Compatibility wrapper for the KeHE pipeline public API."""

import sys as _sys
from pathlib import Path as _Path

_PROJECT_ROOT = _Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_PROJECT_ROOT))

from pipelines.kehe import (  # noqa: E402
    Address,
    Item,
    Order,
    Pack,
    apply_product_master_to_mpl_draft,
    build_document_shipments,
    build_kehe_master_packing_list_draft,
    build_kehe_pack_label_draft,
    build_kehe_pallet_label_draft,
    find_kehe_dc,
    format_sscc_groups,
    load_kehe_dc_directory,
    main,
    normalize_sscc,
    parse_asn,
    parse_kehe_document_header,
    parse_kehe_document_headers,
    render_gs1_label_page,
    render_kehe_master_packing_list_pdf,
    render_kehe_pack_label_pdf,
    render_kehe_pallet_label_pdf,
    run_pipeline,
    wrap_text,
)

__all__ = [
    "Address",
    "Item",
    "Order",
    "Pack",
    "apply_product_master_to_mpl_draft",
    "build_document_shipments",
    "build_kehe_master_packing_list_draft",
    "build_kehe_pack_label_draft",
    "build_kehe_pallet_label_draft",
    "find_kehe_dc",
    "format_sscc_groups",
    "load_kehe_dc_directory",
    "main",
    "normalize_sscc",
    "parse_asn",
    "parse_kehe_document_header",
    "parse_kehe_document_headers",
    "render_gs1_label_page",
    "render_kehe_master_packing_list_pdf",
    "render_kehe_pack_label_pdf",
    "render_kehe_pallet_label_pdf",
    "run_pipeline",
    "wrap_text",
]


if __name__ == "__main__":
    main()
