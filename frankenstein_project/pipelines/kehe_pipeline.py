"""Compatibility wrapper for the KeHE pipeline public API."""

import sys as _sys
from pathlib import Path as _Path

_PROJECT_ROOT = _Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_PROJECT_ROOT))

from pipelines.kehe import (  # noqa: E402
    build_kehe_master_packing_list_draft,
    build_kehe_pack_label_draft,
    build_kehe_pallet_label_draft,
    find_kehe_dc,
    load_kehe_dc_directory,
    main,
    render_gs1_label_page,
    render_kehe_master_packing_list_pdf,
    render_kehe_pack_label_pdf,
    render_kehe_pallet_label_pdf,
    run_pipeline,
)

__all__ = [
    "build_kehe_master_packing_list_draft",
    "build_kehe_pack_label_draft",
    "build_kehe_pallet_label_draft",
    "find_kehe_dc",
    "load_kehe_dc_directory",
    "main",
    "render_gs1_label_page",
    "render_kehe_master_packing_list_pdf",
    "render_kehe_pack_label_pdf",
    "render_kehe_pallet_label_pdf",
    "run_pipeline",
]


if __name__ == "__main__":
    main()
